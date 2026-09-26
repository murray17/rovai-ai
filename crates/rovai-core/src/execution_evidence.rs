use std::{ops::Deref, path::Path};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

use crate::{
    builtin_tool_cli_output::project_envelope,
    builtin_tool_transport::BuiltinToolInvocationEnvelope,
    canonical_activity::{self, CanonicalRuntimeActivity, EvidenceActivityFacts},
    db::Database,
    managed_blob::{
        GC_OWNER_EXECUTION_LIFECYCLE, MAX_BLOB_BYTES, ManagedBlobStore, attach_gc_candidate,
        detach_gc_candidate,
    },
    runtime_compaction_display::RUNTIME_COMPACTION_DISPLAY_EVENT,
    runtime_diff::{self, COMMAND_DIFF_SCHEMA_VERSION},
    runtime_file_operation::{
        self, FILE_OPERATION_SCHEMA_VERSION, RUNTIME_FILE_OPERATION_MANAGED_OUTPUT_ROOT,
    },
    runtime_search_operation,
};

const INLINE_PAYLOAD_LIMIT_BYTES: usize = 16 * 1024;
pub const PERSISTED_TOOL_OUTPUT_LIMIT_BYTES: usize = 7_680;
const RUNTIME_RUN_DIFF_EXECUTION_ROOT_MISSING: &str = "runtime_run_diff_execution_root_missing";
const RUNTIME_RUN_DIFF_MANAGED_OUTPUT_FILTER_UNSAFE: &str =
    "runtime_run_diff_managed_output_filter_unsafe";
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
    pub operation_id: Option<String>,
    pub revision: Option<i64>,
    pub change_sequence: Option<i64>,
    pub event_type: String,
    pub kind: String,
    pub phase: String,
    pub payload: Value,
    pub content_blob_id: Option<String>,
    pub content_byte_count: i64,
    pub is_truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_truncated: Option<bool>,
    pub occurred_at: String,
    pub canonical: Option<CanonicalRuntimeActivity>,
}

#[derive(Debug, Clone)]
pub struct RecordedExecutionEvidence {
    pub evidence: AgentRunExecutionEvidence,
    pub inserted: bool,
    pub file_facts_changed: bool,
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

#[derive(Debug, Clone)]
struct LifecycleContentPart {
    value: Value,
    preview_json: String,
    blob_id: Option<String>,
    byte_count: i64,
    state: String,
}

#[derive(Debug, Clone)]
struct LifecycleEvidenceRow {
    id: String,
    sequence: i64,
    event_type: String,
    kind: String,
    phase: String,
    occurred_at: String,
    revision: i64,
    change_sequence: i64,
    output_truncated: Option<bool>,
    input: LifecycleContentPart,
    result: Option<LifecycleContentPart>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PersistableOutputUpdate {
    CompleteSnapshot,
    OrderedDelta,
    MetadataOnly,
}

#[derive(Debug, Clone)]
struct SelectedPersistableOutput {
    value: Value,
    typed_text_blocks: bool,
}

#[derive(Debug, Clone)]
struct PersistableResult {
    payload: Value,
    output_truncated: Option<bool>,
    output_update: Option<PersistableOutputUpdate>,
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

pub(crate) fn allocate_change_sequence(
    transaction: &rusqlite::Transaction<'_>,
    agent_run_id: &str,
) -> Result<i64> {
    transaction
        .query_row(
            r#"
            UPDATE agent_run
            SET execution_evidence_change_sequence = MAX(
                execution_evidence_change_sequence,
                COALESCE((
                    SELECT MAX(sequence)
                    FROM agent_run_execution_evidence
                    WHERE agent_run_id = ?1
                ), 0)
            ) + 1
            WHERE id = ?1
            RETURNING execution_evidence_change_sequence
            "#,
            [agent_run_id],
            |row| row.get(0),
        )
        .context("AgentRun does not exist while allocating an Evidence change sequence")
}

pub(crate) fn advance_file_facts_watermark(
    transaction: &rusqlite::Transaction<'_>,
    agent_run_id: &str,
    execution_epoch: i64,
    change_sequence: i64,
    changed_at: &str,
) -> Result<()> {
    transaction.execute(
        r#"
        INSERT INTO agent_run_execution_epoch_state(
            agent_run_id, execution_epoch, file_facts_change_sequence, updated_at
        ) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(agent_run_id, execution_epoch) DO UPDATE SET
            file_facts_change_sequence = MAX(
                agent_run_execution_epoch_state.file_facts_change_sequence,
                excluded.file_facts_change_sequence
            ),
            updated_at = excluded.updated_at
        "#,
        params![agent_run_id, execution_epoch, change_sequence, changed_at],
    )?;
    Ok(())
}

#[derive(Debug, Default)]
pub struct ExecutionEvidenceService;

impl ExecutionEvidenceService {
    pub fn is_durable_runtime_evidence_event(event_type: &str) -> bool {
        matches!(
            event_type,
            "agent.reasoning.summary.delta"
                | "agent.reasoning.summary.block"
                | "agent.thought.delta"
                | "agent.thought.block"
                | "agent.text.delta"
                | "agent.text.completed"
                | "agent.text.boundary"
                | "runtime.plan"
                | "runtime.plan.delta"
                | "runtime.diagnostic"
                | "runtime.fast.observed"
                | RUNTIME_COMPACTION_DISPLAY_EVENT
                | "file.change.updated"
                | "runtime.file_changes.snapshot"
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
            "agent.text.delta" | "runtime.plan.delta" | "file.change.updated"
        )
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
        if prepared
            .iter()
            .any(|item| crate::execution_text::is_text_delta(&item.event_type))
        {
            anyhow::bail!(
                "Text fragments require per-item aggregation, not transactional batch retry"
            );
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
            let change_sequence = allocate_change_sequence(&transaction, agent_run_id)?;
            transaction.execute(
                r#"
                INSERT INTO agent_run_execution_evidence(
                    id, agent_run_id, execution_epoch, sequence,
                    event_type, kind, phase, source_event_key,
                    payload_preview_json, content_blob_id,
                    content_byte_count, is_truncated, occurred_at,
                    revision, change_sequence, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL,
                    ?8, NULL, ?9, 0, ?10, 1, ?11, ?10
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
                    change_sequence,
                ],
            )?;
            let file_facts_changed = payload_affects_file_facts(&evidence.payload);
            if file_facts_changed {
                advance_file_facts_watermark(
                    &transaction,
                    agent_run_id,
                    execution_epoch,
                    change_sequence,
                    &evidence.occurred_at,
                )?;
            }
            let facts = canonical_activity::classify_evidence(
                agent_run_id,
                execution_epoch,
                &id,
                &evidence.event_type,
                &evidence.kind,
                &evidence.phase,
                &evidence.payload,
            );
            let previous_facts = canonical_activity::classify_evidence_with_version(
                canonical_activity::PREVIOUS_CLASSIFIER_VERSION,
                agent_run_id,
                execution_epoch,
                &id,
                &evidence.event_type,
                &evidence.kind,
                &evidence.phase,
                &evidence.payload,
            );
            let intermediate_facts = canonical_activity::classify_evidence_with_version(
                canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION,
                agent_run_id,
                execution_epoch,
                &id,
                &evidence.event_type,
                &evidence.kind,
                &evidence.phase,
                &evidence.payload,
            );
            let legacy_facts = canonical_activity::classify_evidence_with_version(
                canonical_activity::LEGACY_CLASSIFIER_VERSION,
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
                EvidenceActivityClassifications {
                    current: &facts,
                    previous: &previous_facts,
                    intermediate: &intermediate_facts,
                    legacy: &legacy_facts,
                },
            )?;
            recorded.push(Some(RecordedExecutionEvidence {
                evidence: AgentRunExecutionEvidence {
                    id,
                    agent_run_id: agent_run_id.to_string(),
                    execution_epoch,
                    sequence,
                    operation_id: None,
                    revision: Some(1),
                    change_sequence: Some(change_sequence),
                    event_type: evidence.event_type,
                    kind: evidence.kind,
                    phase: evidence.phase,
                    payload: evidence.payload,
                    content_blob_id: None,
                    content_byte_count: evidence.content_byte_count,
                    is_truncated: false,
                    output_truncated: None,
                    occurred_at: evidence.occurred_at,
                    canonical,
                },
                inserted: true,
                file_facts_changed,
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
        self.record_runtime_event_with_managed_output_root(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            event_type,
            payload,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_runtime_event_with_managed_output_root(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
        event_type: &str,
        payload: &Value,
        managed_output_root: Option<&Path>,
    ) -> Result<Option<RecordedExecutionEvidence>> {
        self.record_runtime_event_with_fence_policy(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            event_type,
            payload,
            false,
            managed_output_root,
        )
    }

    /// ZCode's native background observer survives its Run, but grants no
    /// execution authority. Late evidence must match a previously admitted
    /// task identity in this exact epoch; ordinary Runtime fencing is unchanged.
    pub fn record_zcode_background_event(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
        registration: bool,
        payload: &Value,
    ) -> Result<Option<RecordedExecutionEvidence>> {
        let identity = &payload["zcodeBackground"];
        for field in [
            "taskId",
            "toolCallId",
            "inputId",
            "turnId",
            "sessionId",
            "hostInstanceId",
            "nativePromptId",
            "deliveryId",
        ] {
            if !identity[field].as_str().is_some_and(|s| !s.is_empty()) {
                anyhow::bail!("ZCode background evidence identity missing");
            }
        }
        let mut digest_input = identity.clone();
        digest_input.as_object_mut().unwrap().remove("status");
        digest_input
            .as_object_mut()
            .unwrap()
            .remove("identityDigest");
        if identity["identityDigest"].as_str()
            != Some(crate::command::canonical_json_digest(&digest_input)?.as_str())
        {
            return Ok(None);
        }
        let adapter: Option<String> = database
            .connection()
            .query_row(
                "SELECT runtime_adapter_kind FROM agent_run WHERE id = ?1 AND execution_epoch = ?2
                 AND (?3 = 0 OR (status IN ('running', 'waiting') AND ended_at IS NULL)
                      OR (status = 'cancelled' AND cancel_requested_at IS NOT NULL))",
                params![agent_run_id, execution_epoch, registration],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        if adapter.as_deref() != Some("zcode-app") {
            return Ok(None);
        }
        if !registration {
            let registered: bool = database.connection().query_row(
                "SELECT EXISTS(SELECT 1 FROM agent_run_execution_evidence
                 WHERE agent_run_id = ?1 AND execution_epoch = ?2 AND event_type = 'runtime.action'
                 AND json_extract(payload_preview_json, '$.zcodeBackground.identityDigest') = ?3)",
                params![
                    agent_run_id,
                    execution_epoch,
                    identity["identityDigest"].as_str()
                ],
                |row| row.get(0),
            )?;
            if !registered {
                return Ok(None);
            }
        }
        self.record_runtime_event_with_fence_policy(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            "runtime.action",
            payload,
            // Cancellation revokes execution authority, but must not discard
            // a task already accepted by the native input before stop settled.
            true,
            None,
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
            None,
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
            None,
        )
    }

    pub fn record_terminal_run_diff_snapshot(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
        payload: &Value,
    ) -> Result<Option<RecordedExecutionEvidence>> {
        self.record_terminal_run_diff_snapshot_with_managed_output_root(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            payload,
            None,
        )
    }

    pub fn record_terminal_run_diff_snapshot_with_managed_output_root(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
        payload: &Value,
        managed_output_root: Option<&Path>,
    ) -> Result<Option<RecordedExecutionEvidence>> {
        let run_diff = payload
            .get("runtimeRunDiff")
            .context("terminal Run diff Evidence has no runtimeRunDiff")?;
        if run_diff.get("status").and_then(Value::as_str) != Some("available")
            || run_diff.get("semanticKind").and_then(Value::as_str) != Some("unified_diff_snapshot")
            || run_diff.get("diff").and_then(Value::as_str).is_none()
        {
            anyhow::bail!("terminal Run diff Evidence is incomplete");
        }
        self.record_runtime_event_with_fence_policy(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            "runtime.file_changes.snapshot",
            payload,
            true,
            managed_output_root,
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
            None,
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
        managed_output_root: Option<&Path>,
    ) -> Result<Option<RecordedExecutionEvidence>> {
        if let Some(handled) = crate::execution_text::observe(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            event_type,
            payload,
        )? {
            return Ok(handled);
        }
        let Some((kind, phase)) = evidence_classification(event_type, payload) else {
            return Ok(None);
        };
        let current = database
            .connection()
            .query_row(
                r#"
                SELECT status, execution_epoch, cancel_requested_at,
                       workspace_json, runtime_adapter_kind,
                       runtime_reported_version
                FROM agent_run
                WHERE id = ?1
                "#,
                [agent_run_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                    ))
                },
            )
            .optional()?;
        let Some((
            status,
            current_epoch,
            cancel_requested_at,
            workspace_json,
            runtime_adapter_kind,
            runtime_reported_version,
        )) = current
        else {
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
        let source_payload = payload;
        let mut payload = normalize_public_payload(event_type, source_payload);
        insert_codex_command_read_candidate(
            &mut payload,
            event_type,
            source_payload,
            runtime_adapter_kind.as_deref(),
        );
        normalize_runtime_search_operation_evidence(
            &mut payload,
            event_type,
            source_payload,
            runtime_adapter_kind.as_deref(),
            runtime_reported_version.as_deref(),
        );
        normalize_runtime_file_operation_evidence(
            &mut payload,
            workspace_json.as_deref(),
            runtime_adapter_kind.as_deref(),
            runtime_reported_version.as_deref(),
            managed_output_root,
        );
        normalize_runtime_diff_evidence(
            &mut payload,
            workspace_json.as_deref(),
            runtime_adapter_kind.as_deref(),
            runtime_reported_version.as_deref(),
            managed_output_root,
        );
        normalize_runtime_run_diff_evidence(
            &mut payload,
            workspace_json.as_deref(),
            managed_output_root,
        );
        let output_update = persistable_output_update(event_type, &payload);
        let PersistableResult {
            payload,
            output_truncated,
            output_update,
        } = prepare_persistable_result(event_type, payload, output_update)?;
        if let Some(recorded) = self.record_operation_lifecycle(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            event_type,
            kind,
            phase,
            source_event_key.as_deref(),
            &payload,
            output_update,
            output_truncated,
            allow_fenced_terminal_tool_result,
        )? {
            return Ok(recorded);
        }
        let encoded = serde_json::to_vec(&payload)?;
        let (preview, content_blob_id, is_truncated) = if encoded.len() > INLINE_PAYLOAD_LIMIT_BYTES
        {
            let privacy = if payload
                .pointer("/runtimeDiff/status")
                .and_then(Value::as_str)
                == Some("available")
                || payload
                    .pointer("/runtimeRunDiff/status")
                    .and_then(Value::as_str)
                    == Some("available")
            {
                "sensitive"
            } else {
                "normal"
            };
            let blob = blob_store.put_bytes_candidate(
                database,
                &encoded,
                "application/json",
                privacy,
                GC_OWNER_EXECUTION_LIFECYCLE,
            )?;
            (bounded_preview(&payload), Some(blob.id), true)
        } else {
            (payload.clone(), None, false)
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
                file_facts_changed: false,
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
        let change_sequence = allocate_change_sequence(&transaction, agent_run_id)?;
        transaction.execute(
            r#"
            INSERT INTO agent_run_execution_evidence(
                id, agent_run_id, execution_epoch, sequence,
                event_type, kind, phase, source_event_key,
                payload_preview_json, content_blob_id,
                content_byte_count, is_truncated, occurred_at,
                output_truncated, revision, change_sequence, updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12, ?13, ?14, 1, ?15, ?13
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
                output_truncated.map(i64::from),
                change_sequence,
            ],
        )?;
        if let Some(blob_id) = content_blob_id.as_deref() {
            attach_gc_candidate(&transaction, blob_id)?;
        }
        let file_facts_changed = payload_affects_file_facts(&payload);
        if file_facts_changed {
            advance_file_facts_watermark(
                &transaction,
                agent_run_id,
                execution_epoch,
                change_sequence,
                &occurred_at,
            )?;
        }
        let facts = canonical_activity::classify_evidence(
            agent_run_id,
            execution_epoch,
            &id,
            event_type,
            kind,
            phase,
            &payload,
        );
        let previous_facts = canonical_activity::classify_evidence_with_version(
            canonical_activity::PREVIOUS_CLASSIFIER_VERSION,
            agent_run_id,
            execution_epoch,
            &id,
            event_type,
            kind,
            phase,
            &payload,
        );
        let intermediate_facts = canonical_activity::classify_evidence_with_version(
            canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION,
            agent_run_id,
            execution_epoch,
            &id,
            event_type,
            kind,
            phase,
            &payload,
        );
        let legacy_facts = canonical_activity::classify_evidence_with_version(
            canonical_activity::LEGACY_CLASSIFIER_VERSION,
            agent_run_id,
            execution_epoch,
            &id,
            event_type,
            kind,
            phase,
            &payload,
        );
        let canonical = upsert_canonical_activity(
            &transaction,
            agent_run_id,
            execution_epoch,
            sequence,
            &id,
            &occurred_at,
            EvidenceActivityClassifications {
                current: &facts,
                previous: &previous_facts,
                intermediate: &intermediate_facts,
                legacy: &legacy_facts,
            },
        )?;
        transaction.commit()?;
        Ok(Some(RecordedExecutionEvidence {
            evidence: AgentRunExecutionEvidence {
                id,
                agent_run_id: agent_run_id.to_string(),
                execution_epoch,
                sequence,
                operation_id: None,
                revision: Some(1),
                change_sequence: Some(change_sequence),
                event_type: event_type.to_string(),
                kind: kind.to_string(),
                phase: phase.to_string(),
                payload: preview,
                content_blob_id,
                content_byte_count: encoded.len() as i64,
                is_truncated,
                output_truncated,
                occurred_at,
                canonical,
            },
            inserted: true,
            file_facts_changed,
        }))
    }

    #[allow(clippy::too_many_arguments)]
    fn record_operation_lifecycle(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
        event_type: &str,
        kind: &str,
        phase: &str,
        source_event_key: Option<&str>,
        payload: &Value,
        output_update: Option<PersistableOutputUpdate>,
        incoming_output_truncated: Option<bool>,
        allow_fenced_terminal_tool_result: bool,
    ) -> Result<Option<Option<RecordedExecutionEvidence>>> {
        let proposed_id = Uuid::new_v4().to_string();
        let proposed_facts = canonical_activity::classify_evidence(
            agent_run_id,
            execution_epoch,
            &proposed_id,
            event_type,
            kind,
            phase,
            payload,
        );
        if !proposed_facts.is_activity || proposed_facts.identity_authority == "evidence" {
            return Ok(None);
        }
        let operation_id = proposed_facts.operation_id.clone();
        let existing = load_lifecycle_evidence(
            database,
            blob_store,
            agent_run_id,
            execution_epoch,
            &operation_id,
        )?;
        if existing.is_none() {
            let legacy_started: bool = database.connection().query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1
                    FROM canonical_runtime_activity AS activity
                    JOIN json_each(activity.source_evidence_ids_json) AS source
                    JOIN agent_run_execution_evidence AS evidence ON evidence.id = source.value
                    WHERE activity.agent_run_id = ?1
                      AND activity.execution_epoch = ?2
                      AND activity.operation_id = ?3
                      AND evidence.operation_id IS NULL
                )
                "#,
                params![agent_run_id, execution_epoch, operation_id],
                |row| row.get(0),
            )?;
            if legacy_started {
                return Ok(None);
            }
        }

        let incoming_input = lifecycle_input_payload(payload);
        let mut next_input = existing
            .as_ref()
            .map(|row| row.input.value.clone())
            .unwrap_or(Value::Null);
        fill_missing(&mut next_input, &incoming_input);
        if next_input.is_null() {
            next_input = incoming_input;
        }

        let incoming_terminal = lifecycle_terminal_status(payload);
        let existing_payload = existing.as_ref().map(lifecycle_combined_payload);
        let existing_terminal = existing_payload
            .as_ref()
            .and_then(lifecycle_terminal_status);
        let terminal_conflict = existing_payload
            .as_ref()
            .is_some_and(lifecycle_has_terminal_conflict)
            || existing_terminal
                .as_deref()
                .zip(incoming_terminal.as_deref())
                .is_some_and(|(old, new)| old != new);
        let incoming_is_start =
            phase == "started" || payload.get("status").and_then(Value::as_str) == Some("started");
        let mut next_result = existing
            .as_ref()
            .and_then(|row| row.result.as_ref())
            .map(|part| part.value.clone());
        let mut next_output_truncated = existing.as_ref().and_then(|row| row.output_truncated);
        if !incoming_is_start {
            let incoming_result = json_difference(payload, &next_input).unwrap_or_else(
                || serde_json::json!({"_rovaiLifecycle": {"resultObserved": true}}),
            );
            next_result = Some(match next_result {
                Some(mut old) if terminal_conflict => {
                    fill_missing(&mut old, &incoming_result);
                    let mut statuses = lifecycle_observed_terminal_statuses(&old);
                    for status in [existing_terminal.clone(), incoming_terminal.clone()]
                        .into_iter()
                        .flatten()
                    {
                        if !statuses.iter().any(|observed| observed == &status) {
                            statuses.push(status);
                        }
                    }
                    old["status"] = Value::String("unsettled".to_string());
                    old["_rovaiLifecycle"] = serde_json::json!({
                        "terminalConflict": true,
                        "observedStatuses": statuses,
                    });
                    old
                }
                Some(mut old) if output_update == Some(PersistableOutputUpdate::OrderedDelta) => {
                    next_output_truncated = Some(append_ordered_delta(
                        &mut old,
                        &incoming_result,
                        next_output_truncated,
                        incoming_output_truncated,
                    ));
                    let mut incoming_metadata = incoming_result;
                    remove_persisted_output_aliases(&mut incoming_metadata);
                    fill_missing(&mut incoming_metadata, &old);
                    incoming_metadata
                }
                Some(old) if output_update == Some(PersistableOutputUpdate::CompleteSnapshot) => {
                    let mut old_metadata = old;
                    remove_persisted_output_aliases(&mut old_metadata);
                    let mut latest = incoming_result;
                    fill_missing(&mut latest, &old_metadata);
                    next_output_truncated = incoming_output_truncated;
                    latest
                }
                Some(old) => {
                    let mut latest = incoming_result;
                    fill_missing(&mut latest, &old);
                    latest
                }
                None => {
                    next_output_truncated = match output_update {
                        Some(PersistableOutputUpdate::CompleteSnapshot) => {
                            incoming_output_truncated
                        }
                        Some(PersistableOutputUpdate::OrderedDelta) => {
                            Some(incoming_output_truncated.unwrap_or(false))
                        }
                        _ => next_output_truncated,
                    };
                    incoming_result
                }
            });
        }
        if terminal_conflict {
            next_output_truncated = existing.as_ref().and_then(|row| row.output_truncated);
        }

        let existing_is_terminal = existing
            .as_ref()
            .is_some_and(|row| matches!(row.phase.as_str(), "completed" | "failed"));
        let next_phase = if existing_is_terminal {
            existing.as_ref().unwrap().phase.clone()
        } else {
            phase.to_string()
        };
        let (next_event_type, next_kind) = if existing_is_terminal && incoming_is_start {
            let row = existing.as_ref().unwrap();
            (row.event_type.clone(), row.kind.clone())
        } else {
            (event_type.to_string(), kind.to_string())
        };
        let semantically_unchanged = existing.as_ref().is_some_and(|row| {
            row.input.value == next_input
                && row.result.as_ref().map(|part| &part.value) == next_result.as_ref()
                && row.phase == next_phase
                && row.event_type == next_event_type
                && row.kind == next_kind
                && row.output_truncated == next_output_truncated
        });

        let occurred_at = chrono::Utc::now().to_rfc3339();
        let still_current = |transaction: &rusqlite::Transaction<'_>| -> Result<bool> {
            Ok(transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM agent_run
                    WHERE id = ?1 AND execution_epoch = ?2
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
            )?)
        };
        if semantically_unchanged {
            let transaction = database
                .connection_mut()
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            if !still_current(&transaction)? {
                transaction.commit()?;
                return Ok(Some(None));
            }
            let row = existing.expect("semantic equality requires an existing lifecycle row");
            let canonical = load_canonical_for_evidence(&transaction, &row.id)?;
            transaction.commit()?;
            return Ok(Some(Some(RecordedExecutionEvidence {
                evidence: lifecycle_evidence_view(
                    agent_run_id,
                    execution_epoch,
                    &operation_id,
                    &row,
                    canonical,
                ),
                inserted: false,
                file_facts_changed: false,
            })));
        }

        let input_changed = existing
            .as_ref()
            .is_none_or(|row| row.input.value != next_input);
        let result_changed = existing
            .as_ref()
            .is_none_or(|row| row.result.as_ref().map(|part| &part.value) != next_result.as_ref());
        let next_input_part = if input_changed {
            prepare_lifecycle_part(
                database,
                blob_store,
                &next_input,
                payload_affects_file_facts(&next_input),
            )?
        } else {
            existing.as_ref().unwrap().input.clone()
        };
        let next_result_part = match (result_changed, next_result.as_ref()) {
            (true, Some(value)) => Some(prepare_lifecycle_part(
                database,
                blob_store,
                value,
                payload_affects_file_facts(value),
            )?),
            (true, None) => None,
            (false, _) => existing.as_ref().and_then(|row| row.result.clone()),
        };
        let next_combined = combine_lifecycle_values(
            &next_input_part.value,
            next_result_part.as_ref().map(|part| &part.value),
        );
        let preview = combine_lifecycle_values(
            &serde_json::from_str(&next_input_part.preview_json)?,
            next_result_part
                .as_ref()
                .map(|part| serde_json::from_str::<Value>(&part.preview_json))
                .transpose()?
                .as_ref(),
        );
        let preview_json = serde_json::to_string(&preview)?;
        let content_byte_count = next_input_part
            .byte_count
            .saturating_add(next_result_part.as_ref().map_or(0, |part| part.byte_count));
        let is_truncated = next_input_part.state != "inline"
            || next_result_part
                .as_ref()
                .is_some_and(|part| part.state != "inline");

        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if !still_current(&transaction)? {
            transaction.commit()?;
            return Ok(Some(None));
        }
        let (id, sequence, revision, inserted, original_occurred_at) = match &existing {
            Some(row) => (
                row.id.clone(),
                row.sequence,
                row.revision + 1,
                false,
                row.occurred_at.clone(),
            ),
            None => {
                let sequence = transaction.query_row(
                    "SELECT COALESCE(MAX(sequence), 0) + 1 FROM agent_run_execution_evidence WHERE agent_run_id = ?1",
                    [agent_run_id],
                    |row| row.get(0),
                )?;
                (proposed_id, sequence, 1, true, occurred_at.clone())
            }
        };
        let change_sequence = allocate_change_sequence(&transaction, agent_run_id)?;
        if inserted {
            transaction.execute(
                r#"
                INSERT INTO agent_run_execution_evidence(
                    id, agent_run_id, execution_epoch, sequence,
                    event_type, kind, phase, source_event_key,
                    payload_preview_json, content_blob_id,
                    content_byte_count, is_truncated, occurred_at,
                    operation_id, revision, change_sequence,
                    input_preview_json, input_blob_id, input_byte_count, input_content_state,
                    result_preview_json, result_blob_id, result_byte_count, result_content_state,
                    output_truncated, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11, ?12,
                    ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25
                )
                "#,
                params![
                    id,
                    agent_run_id,
                    execution_epoch,
                    sequence,
                    next_event_type,
                    next_kind,
                    next_phase,
                    source_event_key,
                    preview_json,
                    content_byte_count,
                    i64::from(is_truncated),
                    original_occurred_at,
                    operation_id,
                    revision,
                    change_sequence,
                    next_input_part.preview_json,
                    next_input_part.blob_id,
                    next_input_part.byte_count,
                    next_input_part.state,
                    next_result_part.as_ref().map(|part| &part.preview_json),
                    next_result_part
                        .as_ref()
                        .and_then(|part| part.blob_id.as_ref()),
                    next_result_part.as_ref().map(|part| part.byte_count),
                    next_result_part.as_ref().map(|part| &part.state),
                    next_output_truncated.map(i64::from),
                    occurred_at,
                ],
            )?;
        } else {
            transaction.execute(
                r#"
                UPDATE agent_run_execution_evidence
                SET event_type = ?2, kind = ?3, phase = ?4,
                    source_event_key = COALESCE(source_event_key, ?5),
                    payload_preview_json = ?6, content_blob_id = NULL,
                    content_byte_count = ?7, is_truncated = ?8,
                    revision = ?9, change_sequence = ?10,
                    input_preview_json = ?11, input_blob_id = ?12,
                    input_byte_count = ?13, input_content_state = ?14,
                    result_preview_json = ?15, result_blob_id = ?16,
                    result_byte_count = ?17, result_content_state = ?18,
                    output_truncated = ?19, updated_at = ?20
                WHERE id = ?1
                "#,
                params![
                    id,
                    next_event_type,
                    next_kind,
                    next_phase,
                    source_event_key,
                    preview_json,
                    content_byte_count,
                    i64::from(is_truncated),
                    revision,
                    change_sequence,
                    next_input_part.preview_json,
                    next_input_part.blob_id,
                    next_input_part.byte_count,
                    next_input_part.state,
                    next_result_part.as_ref().map(|part| &part.preview_json),
                    next_result_part
                        .as_ref()
                        .and_then(|part| part.blob_id.as_ref()),
                    next_result_part.as_ref().map(|part| part.byte_count),
                    next_result_part.as_ref().map(|part| &part.state),
                    next_output_truncated.map(i64::from),
                    occurred_at,
                ],
            )?;
        }
        for blob_id in [
            next_input_part.blob_id.as_deref(),
            next_result_part
                .as_ref()
                .and_then(|part| part.blob_id.as_deref()),
        ]
        .into_iter()
        .flatten()
        {
            attach_gc_candidate(&transaction, blob_id)?;
        }
        if let Some(row) = &existing {
            for old_blob_id in [
                row.input.blob_id.as_deref(),
                row.result.as_ref().and_then(|part| part.blob_id.as_deref()),
            ]
            .into_iter()
            .flatten()
            .filter(|old| {
                next_input_part.blob_id.as_deref() != Some(*old)
                    && next_result_part
                        .as_ref()
                        .and_then(|part| part.blob_id.as_deref())
                        != Some(*old)
            }) {
                detach_gc_candidate(
                    &transaction,
                    old_blob_id,
                    GC_OWNER_EXECUTION_LIFECYCLE,
                    &occurred_at,
                )?;
            }
        }

        let old_file_facts = existing_payload
            .as_ref()
            .map(file_fact_projection)
            .unwrap_or(Value::Null);
        let new_file_facts = file_fact_projection(&next_combined);
        let file_facts_changed = old_file_facts != new_file_facts;
        if file_facts_changed {
            advance_file_facts_watermark(
                &transaction,
                agent_run_id,
                execution_epoch,
                change_sequence,
                &occurred_at,
            )?;
        }

        let facts = canonical_activity::classify_evidence(
            agent_run_id,
            execution_epoch,
            &id,
            &next_event_type,
            &next_kind,
            &next_phase,
            &next_combined,
        );
        let previous_facts = canonical_activity::classify_evidence_with_version(
            canonical_activity::PREVIOUS_CLASSIFIER_VERSION,
            agent_run_id,
            execution_epoch,
            &id,
            &next_event_type,
            &next_kind,
            &next_phase,
            &next_combined,
        );
        let intermediate_facts = canonical_activity::classify_evidence_with_version(
            canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION,
            agent_run_id,
            execution_epoch,
            &id,
            &next_event_type,
            &next_kind,
            &next_phase,
            &next_combined,
        );
        let legacy_facts = canonical_activity::classify_evidence_with_version(
            canonical_activity::LEGACY_CLASSIFIER_VERSION,
            agent_run_id,
            execution_epoch,
            &id,
            &next_event_type,
            &next_kind,
            &next_phase,
            &next_combined,
        );
        let canonical = upsert_canonical_activity(
            &transaction,
            agent_run_id,
            execution_epoch,
            sequence,
            &id,
            &occurred_at,
            EvidenceActivityClassifications {
                current: &facts,
                previous: &previous_facts,
                intermediate: &intermediate_facts,
                legacy: &legacy_facts,
            },
        )?;
        if incoming_is_start && let Some(canonical) = canonical.as_ref() {
            transaction.execute(
                r#"
                UPDATE canonical_runtime_activity
                SET started_at = COALESCE(started_at, ?5), updated_at = ?5
                WHERE agent_run_id = ?1 AND execution_epoch = ?2
                  AND operation_id = ?3 AND classifier_version = ?4
                "#,
                params![
                    agent_run_id,
                    execution_epoch,
                    canonical.operation_id,
                    canonical.classifier_version,
                    occurred_at,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(Some(Some(RecordedExecutionEvidence {
            evidence: AgentRunExecutionEvidence {
                id,
                agent_run_id: agent_run_id.to_string(),
                execution_epoch,
                sequence,
                operation_id: Some(operation_id),
                revision: Some(revision),
                change_sequence: Some(change_sequence),
                event_type: next_event_type,
                kind: next_kind,
                phase: next_phase,
                payload: next_combined,
                content_blob_id: None,
                content_byte_count,
                is_truncated,
                output_truncated: next_output_truncated,
                occurred_at: original_occurred_at,
                canonical,
            },
            inserted,
            file_facts_changed,
        })))
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
                SELECT evidence.agent_run_id, evidence.execution_epoch,
                       evidence.operation_id, evidence.payload_preview_json,
                       evidence.content_blob_id
                FROM agent_run_execution_evidence AS evidence
                JOIN agent_run ON agent_run.id = evidence.agent_run_id
                LEFT JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                WHERE evidence.id = ?1 AND COALESCE(agent_run.camp_id, camp_turn.camp_id) = ?2
                "#,
                params![evidence_id, camp_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()?
            .context("Execution Evidence does not exist in this Camp")?;
        if let Some(payload) = crate::execution_text::live_payload(database, evidence_id)? {
            return Ok(payload);
        }
        if let Some(operation_id) = row.2.as_deref() {
            let lifecycle =
                load_lifecycle_evidence(database, blob_store, &row.0, row.1, operation_id)?
                    .context("Operation lifecycle Evidence is incomplete")?;
            return Ok(lifecycle_combined_payload(&lifecycle));
        }
        let bytes = match row.4 {
            Some(blob_id) => blob_store.read_bytes(database, &blob_id)?,
            None => row.3.into_bytes(),
        };
        serde_json::from_slice(&bytes).context("Execution Evidence payload is not valid JSON")
    }

    pub(crate) fn read_full_payload_unscoped(
        &self,
        database: &Database,
        blob_store: &ManagedBlobStore,
        evidence_id: &str,
    ) -> Result<Value> {
        let row = database
            .connection()
            .query_row(
                r#"
                SELECT agent_run_id, execution_epoch, operation_id,
                       payload_preview_json, content_blob_id
                FROM agent_run_execution_evidence WHERE id = ?1
                "#,
                [evidence_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()?
            .context("Execution Evidence does not exist")?;
        if let Some(payload) = crate::execution_text::live_payload(database, evidence_id)? {
            return Ok(payload);
        }
        if let Some(operation_id) = row.2.as_deref() {
            return load_lifecycle_evidence(database, blob_store, &row.0, row.1, operation_id)?
                .map(|row| lifecycle_combined_payload(&row))
                .context("Operation lifecycle Evidence is incomplete");
        }
        let bytes = match row.4 {
            Some(blob_id) => blob_store.read_bytes(database, &blob_id)?,
            None => row.3.into_bytes(),
        };
        serde_json::from_slice(&bytes).context("Execution Evidence payload is not valid JSON")
    }
}

// Adapter/Core normalization has already reduced each supported protocol to these public result
// carriers. A non-null carrier, including an explicit empty string, is therefore a complete
// snapshot; an omitted/null carrier is a metadata-only observation. The lifecycle reducer consumes
// this closed state and never re-infers output semantics from phase or payload shape.
fn persistable_output_update(event_type: &str, payload: &Value) -> Option<PersistableOutputUpdate> {
    match event_type {
        "command.output.delta" => Some(PersistableOutputUpdate::OrderedDelta),
        "runtime.action" => Some(if has_persistable_output(payload) {
            PersistableOutputUpdate::CompleteSnapshot
        } else {
            PersistableOutputUpdate::MetadataOnly
        }),
        "activity.started" | "activity.completed" if is_persistable_tool_item(payload) => {
            Some(if has_persistable_output(payload) {
                PersistableOutputUpdate::CompleteSnapshot
            } else {
                PersistableOutputUpdate::MetadataOnly
            })
        }
        _ => None,
    }
}

fn has_persistable_output(payload: &Value) -> bool {
    select_persistable_output(payload).is_some()
        || select_output_field(payload, &["summary"], &["summary"]).is_some()
        || select_persistable_error(payload).is_some()
}

fn is_persistable_tool_item(payload: &Value) -> bool {
    matches!(
        payload.pointer("/item/type").and_then(Value::as_str),
        Some(
            "commandExecution"
                | "mcpToolCall"
                | "dynamicToolCall"
                | "webSearch"
                | "imageGeneration"
                | "collabToolCall"
                | "collabAgentToolCall"
        )
    )
}

fn prepare_persistable_result(
    event_type: &str,
    mut payload: Value,
    output_update: Option<PersistableOutputUpdate>,
) -> Result<PersistableResult> {
    let Some(output_update) = output_update else {
        return Ok(PersistableResult {
            payload,
            output_truncated: None,
            output_update: None,
        });
    };

    if let Some(projection) = payload
        .get_mut("operationProjection")
        .and_then(Value::as_object_mut)
    {
        projection.remove("canonicalResult");
    }

    let main = select_persistable_output(&payload);
    let summary = (main.is_none())
        .then(|| select_output_field(&payload, &["summary"], &["summary"]))
        .flatten();
    let error = select_persistable_error(&payload);
    let result_digest = main
        .as_ref()
        .map(|output| persistable_output_digest(&output.value))
        .transpose()?;
    remove_persisted_output_aliases(&mut payload);

    if output_update == PersistableOutputUpdate::MetadataOnly {
        return Ok(PersistableResult {
            payload,
            output_truncated: None,
            output_update: Some(output_update),
        });
    }

    let main_text = match main.as_ref() {
        Some(output) => selected_output_text(output)?,
        None => summary
            .as_ref()
            .map(output_value_text)
            .transpose()?
            .flatten(),
    };
    let error_text = error.as_ref().map(error_value_text).transpose()?.flatten();
    let combined = combine_output_and_error(main_text.as_deref(), error_text.as_deref());
    let (persisted, output_truncated) = combined
        .as_deref()
        .map(|text| truncate_utf8_prefix(text, PERSISTED_TOOL_OUTPUT_LIMIT_BYTES))
        .unwrap_or_else(|| (String::new(), false));
    if combined.is_some() {
        store_persisted_output(event_type, &mut payload, persisted);
    }
    if let Some(digest) = result_digest {
        payload["resultDigest"] = Value::String(digest);
    }
    Ok(PersistableResult {
        payload,
        output_truncated: Some(output_truncated),
        output_update: Some(output_update),
    })
}

fn select_persistable_output(payload: &Value) -> Option<SelectedPersistableOutput> {
    let item = payload.get("item").filter(|item| item.is_object());
    if let Some(value) = item
        .and_then(|item| item.get("aggregatedOutput"))
        .or_else(|| payload.get("aggregatedOutput"))
        .filter(|value| !value.is_null())
    {
        return Some(SelectedPersistableOutput {
            value: value.clone(),
            typed_text_blocks: false,
        });
    }
    if let Some(value) = item
        .and_then(|item| item.get("output"))
        .or_else(|| payload.get("output"))
        .filter(|value| !value.is_null())
    {
        return Some(SelectedPersistableOutput {
            value: value.clone(),
            typed_text_blocks: item
                .and_then(|item| item.get("type"))
                .and_then(Value::as_str)
                == Some("mcpToolCall"),
        });
    }
    if let Some(value) = stdout_stderr_output(payload) {
        return Some(SelectedPersistableOutput {
            value,
            typed_text_blocks: false,
        });
    }
    item.and_then(|item| item.get("content"))
        .or_else(|| payload.get("content"))
        .filter(|value| !value.is_null())
        .map(|value| SelectedPersistableOutput {
            value: value.clone(),
            typed_text_blocks: true,
        })
}

fn select_output_field(
    payload: &Value,
    item_fields: &[&str],
    root_fields: &[&str],
) -> Option<Value> {
    for field in item_fields {
        if let Some(value) = payload
            .pointer(&format!("/item/{field}"))
            .filter(|value| !value.is_null())
        {
            return Some(value.clone());
        }
    }
    for field in root_fields {
        if let Some(value) = payload.get(*field).filter(|value| !value.is_null()) {
            return Some(value.clone());
        }
    }
    None
}

fn stdout_stderr_output(payload: &Value) -> Option<Value> {
    let item = payload.get("item").unwrap_or(&Value::Null);
    let source = if item.is_object() { item } else { payload };
    let stdout = source.get("stdout").and_then(Value::as_str);
    let stderr = source.get("stderr").and_then(Value::as_str);
    match (stdout, stderr) {
        (None, None) => None,
        (Some(stdout), None) => Some(Value::String(stdout.to_string())),
        (None, Some(stderr)) => Some(Value::String(stderr.to_string())),
        (Some(stdout), Some(stderr)) => Some(Value::String(format!("{stdout}\n{stderr}"))),
    }
}

fn select_persistable_error(payload: &Value) -> Option<Value> {
    payload
        .pointer("/item/error")
        .filter(|value| !value.is_null())
        .or_else(|| payload.get("error").filter(|value| !value.is_null()))
        .cloned()
}

fn output_value_text(value: &Value) -> Result<Option<String>> {
    if let Some(value) = value.as_str() {
        return Ok(Some(value.to_string()));
    }
    Ok(Some(serde_json::to_string(value)?))
}

fn selected_output_text(output: &SelectedPersistableOutput) -> Result<Option<String>> {
    if !output.typed_text_blocks {
        return output_value_text(&output.value);
    }
    let content = match &output.value {
        Value::Array(content) => Some(content.as_slice()),
        Value::Object(object) if object.len() == 1 => object
            .get("content")
            .and_then(Value::as_array)
            .map(Vec::as_slice),
        _ => None,
    };
    let Some(content) = content.filter(|content| !content.is_empty()) else {
        return output_value_text(&output.value);
    };
    let text = content
        .iter()
        .map(|block| {
            (block.get("type").and_then(Value::as_str) == Some("text"))
                .then(|| block.get("text").and_then(Value::as_str))
                .flatten()
        })
        .collect::<Option<Vec<_>>>();
    match text {
        Some(text) => Ok(Some(text.join("\n"))),
        None => output_value_text(&output.value),
    }
}

fn error_value_text(value: &Value) -> Result<Option<String>> {
    if let Some(value) = value.as_str() {
        return Ok(Some(value.to_string()));
    }
    let messages = ["message", "stack"]
        .into_iter()
        .filter_map(|field| value.get(field).and_then(Value::as_str))
        .collect::<Vec<_>>();
    if !messages.is_empty() {
        return Ok(Some(messages.join("\n")));
    }
    output_value_text(value)
}

fn combine_output_and_error(output: Option<&str>, error: Option<&str>) -> Option<String> {
    match (output, error) {
        (None, None) => None,
        (Some(output), None) => Some(output.to_string()),
        (None, Some(error)) => Some(error.to_string()),
        (Some(""), Some(error)) => Some(error.to_string()),
        (Some(output), Some("")) => Some(output.to_string()),
        (Some(output), Some(error)) => Some(format!("{output}\n{error}")),
    }
}

fn persistable_output_digest(value: &Value) -> Result<String> {
    let digest_value = value
        .as_str()
        .and_then(|text| serde_json::from_str::<Value>(text.trim()).ok())
        .unwrap_or_else(|| value.clone());
    crate::command::canonical_json_digest(&digest_value)
}

fn truncate_utf8_prefix(value: &str, max_bytes: usize) -> (String, bool) {
    if value.len() <= max_bytes {
        return (value.to_string(), false);
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    (value[..end].to_string(), true)
}

fn remove_persisted_output_aliases(payload: &mut Value) {
    if let Some(object) = payload.as_object_mut() {
        for field in ["output", "stdout", "stderr", "content", "summary", "error"] {
            object.remove(field);
        }
        if let Some(item) = object.get_mut("item").and_then(Value::as_object_mut) {
            for field in [
                "aggregatedOutput",
                "output",
                "result",
                "stdout",
                "stderr",
                "content",
                "summary",
                "error",
            ] {
                item.remove(field);
            }
        }
    }
}

fn store_persisted_output(event_type: &str, payload: &mut Value, output: String) {
    if matches!(event_type, "activity.started" | "activity.completed") {
        let is_command =
            payload.pointer("/item/type").and_then(Value::as_str) == Some("commandExecution");
        if is_command {
            payload["item"]["aggregatedOutput"] = Value::String(output);
        } else {
            payload["item"]["output"] = Value::String(output);
        }
    } else {
        payload["output"] = Value::String(output);
    }
}

fn persisted_output_text(payload: &Value) -> Option<&str> {
    payload
        .pointer("/item/aggregatedOutput")
        .or_else(|| payload.pointer("/item/output"))
        .or_else(|| payload.get("output"))
        .and_then(Value::as_str)
}

fn set_existing_persisted_output(payload: &mut Value, output: String) {
    if payload.pointer("/item/aggregatedOutput").is_some() {
        payload["item"]["aggregatedOutput"] = Value::String(output);
    } else if payload.pointer("/item/output").is_some() {
        payload["item"]["output"] = Value::String(output);
    } else {
        payload["output"] = Value::String(output);
    }
}

fn append_ordered_delta(
    existing: &mut Value,
    incoming: &Value,
    existing_truncated: Option<bool>,
    incoming_truncated: Option<bool>,
) -> bool {
    if existing_truncated == Some(true) {
        return true;
    }
    let current = persisted_output_text(existing).unwrap_or_default();
    let delta = persisted_output_text(incoming).unwrap_or_default();
    let combined = format!("{current}{delta}");
    let (persisted, truncated) = truncate_utf8_prefix(&combined, PERSISTED_TOOL_OUTPUT_LIMIT_BYTES);
    set_existing_persisted_output(existing, persisted);
    truncated || incoming_truncated == Some(true)
}

fn lifecycle_input_payload(payload: &Value) -> Value {
    let mut input = payload.clone();
    if let Some(object) = input.as_object_mut() {
        for field in [
            "output",
            "rawOutputDigest",
            "resultDigest",
            "errorCode",
            "runtimeDiff",
            "runtimeFileOperation",
            "runtimeRunDiff",
            "coreEnvelope",
        ] {
            object.remove(field);
        }
        if let Some(item) = object.get_mut("item").and_then(Value::as_object_mut) {
            for field in [
                "durationMs",
                "exitCode",
                "aggregatedOutput",
                "output",
                "result",
                "summary",
                "changes",
                "error",
                "errorCode",
            ] {
                item.remove(field);
            }
        }
    }
    input
}

fn json_difference(value: &Value, base: &Value) -> Option<Value> {
    if value == base {
        return None;
    }
    match (value, base) {
        (Value::Object(value), Value::Object(base)) => {
            let difference = value
                .iter()
                .filter_map(|(key, value)| {
                    json_difference(value, base.get(key).unwrap_or(&Value::Null))
                        .map(|value| (key.clone(), value))
                })
                .collect::<Map<_, _>>();
            (!difference.is_empty()).then_some(Value::Object(difference))
        }
        _ => Some(value.clone()),
    }
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

fn combine_lifecycle_values(input: &Value, result: Option<&Value>) -> Value {
    let mut combined = result.cloned().unwrap_or(Value::Null);
    fill_missing(&mut combined, input);
    combined
}

fn lifecycle_terminal_status(payload: &Value) -> Option<String> {
    payload
        .get("status")
        .and_then(Value::as_str)
        .or_else(|| payload.pointer("/item/status").and_then(Value::as_str))
        .filter(|status| {
            matches!(
                *status,
                "completed"
                    | "succeeded"
                    | "success"
                    | "failed"
                    | "error"
                    | "declined"
                    | "denied"
                    | "cancelled"
                    | "canceled"
                    | "not_executed"
            )
        })
        .map(str::to_string)
}

fn lifecycle_has_terminal_conflict(payload: &Value) -> bool {
    payload
        .pointer("/_rovaiLifecycle/terminalConflict")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn lifecycle_observed_terminal_statuses(payload: &Value) -> Vec<String> {
    payload
        .pointer("/_rovaiLifecycle/observedStatuses")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

fn file_fact_projection(payload: &Value) -> Value {
    let mut projection = serde_json::json!({
        "runtimeDiff": payload.get("runtimeDiff"),
        "runtimeFileOperation": payload.get("runtimeFileOperation"),
        "runtimeRunDiff": payload.get("runtimeRunDiff"),
        "patch": payload.get("patch"),
        "changes": payload.get("changes").or_else(|| payload.pointer("/item/changes")),
    });
    let has_file_facts = projection
        .as_object()
        .is_some_and(|object| object.values().any(|value| !value.is_null()));
    if has_file_facts {
        projection["trustState"] = serde_json::json!({
            "terminalConflict": payload
                .pointer("/_rovaiLifecycle/terminalConflict")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            "contentComplete": payload
                .pointer("/_rovaiContent/complete")
                .and_then(Value::as_bool),
            "contentState": payload
                .pointer("/_rovaiContent/state")
                .and_then(Value::as_str),
        });
    }
    projection
}

pub(crate) fn payload_affects_file_facts(payload: &Value) -> bool {
    let projection = file_fact_projection(payload);
    projection
        .as_object()
        .is_some_and(|object| object.values().any(|value| !value.is_null()))
}

fn lifecycle_part_preview(value: &Value, byte_count: usize, state: &str) -> Result<String> {
    let mut preview = if state == "inline" {
        value.clone()
    } else {
        bounded_preview(value)
    };
    if matches!(state, "too_large" | "unavailable") {
        let digest = crate::command::canonical_json_digest(value)?;
        if !preview.is_object() {
            preview = serde_json::json!({"value": preview});
        }
        preview["_rovaiContent"] = serde_json::json!({
            "state": state,
            "complete": false,
            "byteCount": byte_count,
            "digest": digest,
        });
    }
    serde_json::to_string(&preview).map_err(Into::into)
}

fn prepare_lifecycle_part(
    database: &mut Database,
    blob_store: &ManagedBlobStore,
    value: &Value,
    sensitive: bool,
) -> Result<LifecycleContentPart> {
    let encoded = serde_json::to_vec(value)?;
    let byte_count = i64::try_from(encoded.len()).context("Lifecycle content size overflow")?;
    let (blob_id, state) = if encoded.len() <= INLINE_PAYLOAD_LIMIT_BYTES {
        (None, "inline")
    } else if encoded.len() as u64 <= MAX_BLOB_BYTES {
        let blob = blob_store.put_bytes_candidate(
            database,
            &encoded,
            "application/json",
            if sensitive { "sensitive" } else { "normal" },
            GC_OWNER_EXECUTION_LIFECYCLE,
        )?;
        (Some(blob.id), "blob")
    } else {
        (None, "too_large")
    };
    Ok(LifecycleContentPart {
        value: if state == "too_large" {
            serde_json::from_str(&lifecycle_part_preview(value, encoded.len(), state)?)?
        } else {
            value.clone()
        },
        preview_json: lifecycle_part_preview(value, encoded.len(), state)?,
        blob_id,
        byte_count,
        state: state.to_string(),
    })
}

fn load_lifecycle_part(
    database: &Database,
    blob_store: &ManagedBlobStore,
    preview_json: String,
    blob_id: Option<String>,
    byte_count: i64,
    state: String,
) -> Result<LifecycleContentPart> {
    let preview: Value = serde_json::from_str(&preview_json)
        .context("Lifecycle content preview is not valid JSON")?;
    let value = match (state.as_str(), blob_id.as_deref()) {
        ("blob", Some(blob_id)) => match blob_store.read_bytes(database, blob_id) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .context("Lifecycle Blob content is not valid JSON")?,
            Err(_) => {
                let mut unavailable = preview.clone();
                if !unavailable.is_object() {
                    unavailable = serde_json::json!({"value": unavailable});
                }
                unavailable["_rovaiContent"] = serde_json::json!({
                    "state": "unavailable",
                    "complete": false,
                    "byteCount": byte_count,
                });
                unavailable
            }
        },
        _ => preview.clone(),
    };
    Ok(LifecycleContentPart {
        value,
        preview_json,
        blob_id,
        byte_count,
        state,
    })
}

fn load_lifecycle_evidence(
    database: &Database,
    blob_store: &ManagedBlobStore,
    agent_run_id: &str,
    execution_epoch: i64,
    operation_id: &str,
) -> Result<Option<LifecycleEvidenceRow>> {
    let row = database
        .connection()
        .query_row(
            r#"
            SELECT id, sequence, event_type, kind, phase, occurred_at,
                   revision, change_sequence, output_truncated,
                   input_preview_json, input_blob_id, input_byte_count, input_content_state,
                   result_preview_json, result_blob_id, result_byte_count, result_content_state
            FROM agent_run_execution_evidence
            WHERE agent_run_id = ?1 AND execution_epoch = ?2 AND operation_id = ?3
            "#,
            params![agent_run_id, execution_epoch, operation_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, Option<i64>>(8)?.map(|value| value != 0),
                    row.get::<_, String>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, i64>(11)?,
                    row.get::<_, String>(12)?,
                    row.get::<_, Option<String>>(13)?,
                    row.get::<_, Option<String>>(14)?,
                    row.get::<_, Option<i64>>(15)?,
                    row.get::<_, Option<String>>(16)?,
                ))
            },
        )
        .optional()?;
    let Some((
        id,
        sequence,
        event_type,
        kind,
        phase,
        occurred_at,
        revision,
        change_sequence,
        output_truncated,
        input_preview,
        input_blob,
        input_bytes,
        input_state,
        result_preview,
        result_blob,
        result_bytes,
        result_state,
    )) = row
    else {
        return Ok(None);
    };
    let input = load_lifecycle_part(
        database,
        blob_store,
        input_preview,
        input_blob,
        input_bytes,
        input_state,
    )?;
    let result = match (result_preview, result_bytes, result_state) {
        (Some(preview), Some(bytes), Some(state)) => Some(load_lifecycle_part(
            database,
            blob_store,
            preview,
            result_blob,
            bytes,
            state,
        )?),
        _ => None,
    };
    Ok(Some(LifecycleEvidenceRow {
        id,
        sequence,
        event_type,
        kind,
        phase,
        occurred_at,
        revision,
        change_sequence,
        output_truncated,
        input,
        result,
    }))
}

fn lifecycle_combined_payload(row: &LifecycleEvidenceRow) -> Value {
    combine_lifecycle_values(
        &row.input.value,
        row.result.as_ref().map(|part| &part.value),
    )
}

fn lifecycle_evidence_view(
    agent_run_id: &str,
    execution_epoch: i64,
    operation_id: &str,
    row: &LifecycleEvidenceRow,
    canonical: Option<CanonicalRuntimeActivity>,
) -> AgentRunExecutionEvidence {
    let payload = lifecycle_combined_payload(row);
    AgentRunExecutionEvidence {
        id: row.id.clone(),
        agent_run_id: agent_run_id.to_string(),
        execution_epoch,
        sequence: row.sequence,
        operation_id: Some(operation_id.to_string()),
        revision: Some(row.revision),
        change_sequence: Some(row.change_sequence),
        event_type: row.event_type.clone(),
        kind: row.kind.clone(),
        phase: row.phase.clone(),
        content_byte_count: row
            .input
            .byte_count
            .saturating_add(row.result.as_ref().map_or(0, |part| part.byte_count)),
        payload,
        content_blob_id: None,
        is_truncated: row.input.state != "inline"
            || row
                .result
                .as_ref()
                .is_some_and(|part| part.state != "inline"),
        output_truncated: row.output_truncated,
        occurred_at: row.occurred_at.clone(),
        canonical,
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
        "runtime.fast.observed" => Some(("step", "updated")),
        RUNTIME_COMPACTION_DISPLAY_EVENT => match payload.get("phase").and_then(Value::as_str) {
            Some("imminent" | "started") => Some(("step", "started")),
            Some("completed") => Some(("step", "completed")),
            _ => None,
        },
        "file.change.updated" => Some(("file_change", "updated")),
        "runtime.file_changes.snapshot" => Some(("file_change", "completed")),
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
        "runtime.fast.observed" => {
            let state = payload
                .get("state")
                .and_then(|state| {
                    serde_json::from_value::<crate::camp_fast::ObservedFastState>(state.clone())
                        .ok()
                })
                .unwrap_or_default();
            let tier = payload
                .get("observedServiceTier")
                .and_then(Value::as_str)
                .filter(|tier| matches!(*tier, "priority" | "fast" | "default" | "standard"));
            serde_json::json!({ "state": state, "observedServiceTier": tier })
        }
        RUNTIME_COMPACTION_DISPLAY_EVENT => serde_json::json!({
            "schemaVersion": payload.get("schemaVersion"),
            "compactionId": payload.get("compactionId"),
            "adapterKind": payload.get("adapterKind"),
            "phase": payload.get("phase"),
            "completionEvidence": payload.get("completionEvidence"),
            "tokens": {
                "before": payload.pointer("/tokens/before"),
                "after": payload.pointer("/tokens/after"),
                "current": payload.pointer("/tokens/current"),
                "contextWindow": payload.pointer("/tokens/contextWindow"),
                "usagePercent": payload.pointer("/tokens/usagePercent"),
            },
            "messages": {
                "compacted": payload.pointer("/messages/compacted"),
            },
            "elapsedMs": payload.get("elapsedMs"),
            "summaryText": payload.get("summaryText"),
        }),
        "file.change.updated" => serde_json::json!({
            "itemId": payload.get("itemId"),
            "patch": payload.get("patch").or_else(|| payload.get("delta")),
        }),
        "runtime.file_changes.snapshot" => serde_json::json!({
            "eventId": payload.get("eventId"),
            "runtimeRunDiff": payload.get("runtimeRunDiff"),
        }),
        "runtime.action" => {
            let core_envelope = payload.get("coreEnvelope");
            let agent_output_digest = builtin_agent_output_digest(payload);
            let public_output = payload
                .get("output")
                .filter(|value| !value.is_null())
                .or_else(|| core_envelope.and_then(|envelope| envelope.get("result")));
            let public_error = payload
                .get("error")
                .filter(|value| !value.is_null())
                .or_else(|| core_envelope.and_then(|envelope| envelope.get("error")));
            let public_error_code = payload
                .get("errorCode")
                .filter(|value| !value.is_null())
                .or_else(|| public_error.and_then(|error| error.get("code")));
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
                "output": public_output,
                "stdout": payload.get("stdout"),
                "stderr": payload.get("stderr"),
                "content": payload.get("content"),
                "summary": payload.get("summary"),
                "error": public_error,
                "rawInputDigest": payload.get("rawInputDigest"),
                "rawOutputDigest": payload.get("rawOutputDigest"),
                "agentOutputDigest": agent_output_digest,
                "errorCode": public_error_code,
                "idempotentReplay": payload.get("idempotentReplay"),
                "receiptId": payload.get("receiptId"),
                "operationProjection": payload.get("operationProjection"),
                "runtimeFileOperation": payload.get("runtimeFileOperation"),
                "runtimeDiff": payload.get("runtimeDiff"),
            });
            if let Some(background) = payload.get("zcodeBackground") {
                normalized["zcodeBackground"] = background.clone();
            }
            if let Some(core_envelope) = payload.get("coreEnvelope") {
                normalized["coreEnvelope"] = public_core_envelope(core_envelope);
            }
            normalized
        }
        "activity.started" | "activity.completed" => {
            let item = payload.get("item").unwrap_or(&Value::Null);
            serde_json::json!({
                "runtimeDiff": payload.get("runtimeDiff"),
                "runtimeFileOperation": payload.get("runtimeFileOperation"),
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
                    "output": public_activity_output(item),
                    "stdout": item.get("stdout"),
                    "stderr": item.get("stderr"),
                    "content": item.get("content"),
                    "summary": item.get("summary"),
                    "changes": item.get("changes"),
                    "tool": item.get("tool"),
                    "server": item.get("server"),
                    "error": item.get("error"),
                    "errorCode": item.get("errorCode")
                        .filter(|value| !value.is_null())
                        .or_else(|| payload.get("errorCode").filter(|value| !value.is_null()))
                        .or_else(|| item.pointer("/error/code"))
                        .or_else(|| payload.pointer("/error/code")),
                }
            })
        }
        _ => Value::Null,
    }
}

fn builtin_agent_output_digest(payload: &Value) -> Option<String> {
    let envelope = serde_json::from_value::<BuiltinToolInvocationEnvelope>(
        payload.get("coreEnvelope")?.clone(),
    )
    .ok()?;
    let output = project_envelope(envelope).ok()?;
    crate::command::canonical_json_digest(&output).ok()
}

fn public_core_envelope(envelope: &Value) -> Value {
    serde_json::json!({
        "contractVersion": envelope.get("contractVersion"),
        "ok": envelope.get("ok"),
        "operation": envelope.get("operation"),
        "requestId": envelope.get("requestId"),
        "receipt": envelope.get("receipt"),
        "error": {
            "code": envelope.pointer("/error/code"),
            "recovery": envelope.pointer("/error/recovery"),
        }
    })
}

fn public_activity_output(item: &Value) -> Option<Value> {
    // Structured images have a local-only consumer before Evidence normalization. Never duplicate
    // their bytes/path into the public Tool output (including interrupted or started activities).
    if item.get("type").and_then(Value::as_str) == Some("imageGeneration") {
        return None;
    }
    if item.get("type").and_then(Value::as_str) == Some("mcpToolCall")
        && let Some(content) = item.pointer("/result/content").and_then(Value::as_array)
        && content
            .iter()
            .any(|block| block.get("type").and_then(Value::as_str) == Some("image"))
    {
        let text = content
            .iter()
            .filter_map(|block| {
                (block.get("type").and_then(Value::as_str) == Some("text"))
                    .then(|| block.get("text").and_then(Value::as_str))
                    .flatten()
            })
            .collect::<Vec<_>>()
            .join("\n");
        return (!text.is_empty()).then_some(Value::String(text));
    }
    item.get("output").or_else(|| item.get("result")).cloned()
}

fn normalize_runtime_search_operation_evidence(
    payload: &mut Value,
    event_type: &str,
    source_payload: &Value,
    frozen_adapter_kind: Option<&str>,
    observed_runtime_version: Option<&str>,
) {
    let Some(admitted) = runtime_search_operation::admit_runtime_search_operation(
        event_type,
        source_payload,
        frozen_adapter_kind,
        observed_runtime_version,
    ) else {
        return;
    };
    let projection = match admitted {
        Ok(admitted) => {
            if event_type == "runtime.action" {
                payload["kind"] = Value::String("web_search".to_string());
            }
            admitted.into_projection()
        }
        Err(reason) => runtime_search_operation::unavailable_projection(
            reason,
            source_payload.get(runtime_search_operation::SEARCH_OPERATION_CANDIDATE_FIELD),
            observed_runtime_version,
        ),
    };
    payload["runtimeSearchOperation"] = projection;
}

fn normalize_runtime_diff_evidence(
    payload: &mut Value,
    workspace_json: Option<&str>,
    frozen_adapter_kind: Option<&str>,
    observed_runtime_version: Option<&str>,
    managed_output_root: Option<&Path>,
) {
    let Some(candidate) = payload.get("runtimeDiff").cloned() else {
        return;
    };
    if candidate.is_null() {
        return;
    }
    let execution_root = workspace_json
        .and_then(|workspace| serde_json::from_str::<Value>(workspace).ok())
        .and_then(|workspace| {
            workspace
                .get("executionRoot")
                .and_then(Value::as_str)
                .map(str::to_string)
        });
    let file_operation_path =
        runtime_file_operation::path_from_evidence(payload).map(str::to_string);
    let file_operation_was_managed = payload
        .pointer("/runtimeFileOperation/safeReasonCode")
        .and_then(Value::as_str)
        == Some(RUNTIME_FILE_OPERATION_MANAGED_OUTPUT_ROOT);
    let single_diff_entry = candidate
        .get("entries")
        .and_then(Value::as_array)
        .is_some_and(|entries| entries.len() == 1);
    let admitted = execution_root.as_deref().map(Path::new).map(|root| {
        if file_operation_was_managed && single_diff_entry {
            return Err(runtime_diff::RUNTIME_DIFF_MANAGED_OUTPUT_ROOT);
        }
        runtime_diff::admit_runtime_diff_with_file_operation_path_and_managed_output_root(
            payload,
            root,
            frozen_adapter_kind,
            file_operation_path.as_deref(),
            managed_output_root,
        )
        .unwrap_or(Err("runtime_diff_candidate_missing"))
    });
    let source = serde_json::json!({
        "adapterKind": candidate.get("adapterKind"),
        "observedRuntimeVersion": observed_runtime_version,
        "sourceEventKind": candidate.get("sourceEventKind"),
    });
    payload["runtimeDiff"] = match admitted {
        Some(Ok(admitted)) => {
            serde_json::json!({
                "schemaVersion": COMMAND_DIFF_SCHEMA_VERSION,
                "source": "runtime_reported",
                "status": "available",
                "semanticKind": admitted.semantic_kind,
                "entries": admitted.evidence_entries,
                "sourceMetadata": source,
            })
        }
        Some(Err(reason)) => serde_json::json!({
            "schemaVersion": COMMAND_DIFF_SCHEMA_VERSION,
            "source": "runtime_reported",
            "status": "unavailable",
            "safeReasonCode": reason,
            "sourceMetadata": source,
        }),
        None => serde_json::json!({
            "schemaVersion": COMMAND_DIFF_SCHEMA_VERSION,
            "source": "runtime_reported",
            "status": "unavailable",
            "safeReasonCode": "runtime_diff_execution_root_unavailable",
            "sourceMetadata": source,
        }),
    };
}

fn normalize_runtime_file_operation_evidence(
    payload: &mut Value,
    workspace_json: Option<&str>,
    frozen_adapter_kind: Option<&str>,
    observed_runtime_version: Option<&str>,
    managed_output_root: Option<&Path>,
) {
    let Some(candidate) = payload.get("runtimeFileOperation").cloned() else {
        return;
    };
    if candidate.is_null() {
        return;
    }
    let execution_root = workspace_json
        .and_then(|workspace| serde_json::from_str::<Value>(workspace).ok())
        .and_then(|workspace| {
            workspace
                .get("executionRoot")
                .and_then(Value::as_str)
                .map(str::to_string)
        });
    let admitted = execution_root.as_deref().map(Path::new).map(|root| {
        runtime_file_operation::admit_runtime_file_operation_with_managed_output_root(
            payload,
            root,
            frozen_adapter_kind,
            managed_output_root,
        )
        .unwrap_or(Err("runtime_file_operation_candidate_missing"))
    });
    let source = serde_json::json!({
        "adapterKind": candidate.get("adapterKind"),
        "observedRuntimeVersion": observed_runtime_version,
        "sourceEventKind": candidate.get("sourceEventKind"),
    });
    payload["runtimeFileOperation"] = match admitted {
        Some(Ok(admitted)) => {
            let mut projection = serde_json::json!({
                "schemaVersion": FILE_OPERATION_SCHEMA_VERSION,
                "source": "runtime_reported",
                "status": "available",
                "operationKind": admitted.operation_kind,
                "path": admitted.path,
                "sourceMetadata": source,
            });
            if let Some(change_kind) = admitted.change_kind {
                projection["changeKind"] = Value::String(change_kind);
            }
            projection
        }
        Some(Err(reason)) => serde_json::json!({
            "schemaVersion": FILE_OPERATION_SCHEMA_VERSION,
            "source": "runtime_reported",
            "status": "unavailable",
            "safeReasonCode": reason,
            "sourceMetadata": source,
        }),
        None => serde_json::json!({
            "schemaVersion": FILE_OPERATION_SCHEMA_VERSION,
            "source": "runtime_reported",
            "status": "unavailable",
            "safeReasonCode": "runtime_file_operation_execution_root_missing",
            "sourceMetadata": source,
        }),
    };
}

fn insert_codex_command_read_candidate(
    payload: &mut Value,
    event_type: &str,
    source_payload: &Value,
    frozen_adapter_kind: Option<&str>,
) {
    if frozen_adapter_kind != Some("codex-cli") {
        return;
    }
    if let Some(object) = payload.as_object_mut() {
        object.remove("runtimeFileOperation");
    }
    if !matches!(event_type, "activity.started" | "activity.completed")
        || source_payload.pointer("/item/type").and_then(Value::as_str) != Some("commandExecution")
    {
        return;
    }
    let Some(actions) = source_payload
        .pointer("/item/commandActions")
        .and_then(Value::as_array)
        .filter(|actions| !actions.is_empty())
    else {
        return;
    };
    let mut unique_path: Option<&str> = None;
    for action in actions {
        if action.get("type").and_then(Value::as_str) != Some("read") {
            return;
        }
        let Some(path) = action
            .get("path")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|path| !path.is_empty())
        else {
            return;
        };
        match unique_path {
            Some(existing) if existing != path => return,
            None => unique_path = Some(path),
            _ => {}
        }
    }
    let Some(path) = unique_path else {
        return;
    };
    payload["runtimeFileOperation"] = serde_json::json!({
        "adapterKind": "codex-cli",
        "protocolFamily": "codex-app-server",
        "sourceEventKind": "activity.commandExecution.read",
        "operationKind": "read",
        "path": path,
    });
}

fn normalize_runtime_run_diff_evidence(
    payload: &mut Value,
    workspace_json: Option<&str>,
    managed_output_root: Option<&Path>,
) {
    let Some(managed_output_root) = managed_output_root else {
        return;
    };
    let Some(diff) = payload
        .pointer("/runtimeRunDiff/diff")
        .and_then(Value::as_str)
    else {
        return;
    };
    let Some(execution_root) = workspace_json
        .and_then(|workspace| serde_json::from_str::<Value>(workspace).ok())
        .and_then(|workspace| {
            workspace
                .get("executionRoot")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
    else {
        set_runtime_run_diff_unavailable(payload, RUNTIME_RUN_DIFF_EXECUTION_ROOT_MISSING);
        return;
    };
    let filtered = runtime_diff::filter_unified_diff_snapshot_outside_root(
        diff,
        Path::new(&execution_root),
        managed_output_root,
    );
    match filtered {
        Some(filtered) => payload["runtimeRunDiff"]["diff"] = Value::String(filtered),
        None => {
            set_runtime_run_diff_unavailable(
                payload,
                RUNTIME_RUN_DIFF_MANAGED_OUTPUT_FILTER_UNSAFE,
            );
        }
    }
}

fn set_runtime_run_diff_unavailable(payload: &mut Value, safe_reason_code: &'static str) {
    let source_metadata = payload["runtimeRunDiff"]
        .get("sourceMetadata")
        .cloned()
        .unwrap_or(Value::Null);
    payload["runtimeRunDiff"] = serde_json::json!({
        "schemaVersion": 1,
        "source": "runtime_reported",
        "status": "unavailable",
        "safeReasonCode": safe_reason_code,
        "sourceMetadata": source_metadata,
    });
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
        .or_else(|| payload.get("compactionId"))
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
    let phase = if event_type == RUNTIME_COMPACTION_DISPLAY_EVENT {
        payload
            .get("phase")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
    } else {
        phase_from_payload(payload)
    };
    Some(format!(
        "{event_type}:{identity}:{phase}{replay_observation}"
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
                   content_blob_id, content_byte_count, is_truncated, occurred_at,
                   operation_id, revision, change_sequence, output_truncated
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
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, Option<i64>>(13)?,
                    row.get::<_, Option<i64>>(14)?,
                    row.get::<_, Option<i64>>(15)?.map(|value| value != 0),
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
                operation_id,
                revision,
                change_sequence,
                output_truncated,
            )| {
                Ok(AgentRunExecutionEvidence {
                    id,
                    agent_run_id,
                    execution_epoch,
                    sequence,
                    operation_id,
                    revision,
                    change_sequence,
                    event_type,
                    kind,
                    phase,
                    payload: serde_json::from_str(&payload)?,
                    content_blob_id,
                    content_byte_count,
                    is_truncated,
                    output_truncated,
                    occurred_at,
                    canonical: None,
                })
            },
        )
        .transpose()
}

struct EvidenceActivityClassifications<'a> {
    current: &'a EvidenceActivityFacts,
    previous: &'a EvidenceActivityFacts,
    intermediate: &'a EvidenceActivityFacts,
    legacy: &'a EvidenceActivityFacts,
}

fn upsert_canonical_activity(
    transaction: &rusqlite::Transaction<'_>,
    agent_run_id: &str,
    execution_epoch: i64,
    sequence: i64,
    evidence_id: &str,
    occurred_at: &str,
    classifications: EvidenceActivityClassifications<'_>,
) -> Result<Option<CanonicalRuntimeActivity>> {
    let facts = classifications.current;
    if !facts.is_activity {
        return Ok(None);
    }
    let existing = transaction
        .query_row(
            r#"
            SELECT operation_id, classifier_version, activity_domain,
                   semantic_kind, tool_name, presentation_hint,
                   diff_projection_json, phase, outcome,
                   credibility, coverage_level, source_authority,
                   source_evidence_ids_json, first_evidence_sequence,
                   last_evidence_sequence, revision
            FROM canonical_runtime_activity
            WHERE agent_run_id = ?1
              AND execution_epoch = ?2
              AND operation_id = ?3
              AND classifier_version IN (?4, ?5, ?6, ?7)
            ORDER BY CASE classifier_version
                WHEN ?4 THEN 0
                WHEN ?5 THEN 1
                WHEN ?6 THEN 2
                ELSE 3
            END
            LIMIT 1
            "#,
            params![
                agent_run_id,
                execution_epoch,
                facts.operation_id,
                canonical_activity::CLASSIFIER_VERSION,
                canonical_activity::PREVIOUS_CLASSIFIER_VERSION,
                canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION,
                canonical_activity::LEGACY_CLASSIFIER_VERSION,
            ],
            canonical_activity_row,
        )
        .optional()?;
    let selected_facts = match existing
        .as_ref()
        .map(|projection| projection.classifier_version.as_str())
    {
        Some(canonical_activity::PREVIOUS_CLASSIFIER_VERSION) => classifications.previous,
        Some(canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION) => classifications.intermediate,
        Some(canonical_activity::LEGACY_CLASSIFIER_VERSION) => classifications.legacy,
        _ => facts,
    };
    let projection = match existing {
        Some(existing) => canonical_activity::merge_projection(
            existing,
            selected_facts.clone(),
            evidence_id,
            sequence,
        ),
        None => canonical_activity::new_projection_for_version(
            selected_facts.clone(),
            canonical_activity::CLASSIFIER_VERSION,
            evidence_id,
            sequence,
        )
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
            diff_projection_json, phase, outcome, credibility, coverage_level, source_authority,
            source_evidence_ids_json, first_evidence_sequence,
            last_evidence_sequence, revision, created_at, updated_at,
            started_at, terminal_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16, ?17, ?18, ?19, ?19, ?20, ?21
        )
        ON CONFLICT(agent_run_id, execution_epoch, operation_id, classifier_version)
        DO UPDATE SET
            activity_domain = excluded.activity_domain,
            semantic_kind = excluded.semantic_kind,
            tool_name = excluded.tool_name,
            presentation_hint = excluded.presentation_hint,
            diff_projection_json = excluded.diff_projection_json,
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
            projection
                .diff_projection
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
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
                   activity.diff_projection_json,
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
              AND activity.classifier_version IN (?2, ?3, ?4, ?5)
              AND EXISTS (
                  SELECT 1
                  FROM json_each(activity.source_evidence_ids_json)
                  WHERE json_each.value = evidence.id
              )
            ORDER BY CASE activity.classifier_version
                WHEN ?2 THEN 0
                WHEN ?3 THEN 1
                WHEN ?4 THEN 2
                ELSE 3
            END
            LIMIT 1
            "#,
            params![
                evidence_id,
                canonical_activity::CLASSIFIER_VERSION,
                canonical_activity::PREVIOUS_CLASSIFIER_VERSION,
                canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION,
                canonical_activity::LEGACY_CLASSIFIER_VERSION,
            ],
            canonical_activity_row,
        )
        .optional()
        .map_err(Into::into)
}

fn canonical_activity_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CanonicalRuntimeActivity> {
    let diff_projection: Option<String> = row.get(6)?;
    let source_evidence_ids: String = row.get(12)?;
    Ok(CanonicalRuntimeActivity {
        operation_id: row.get(0)?,
        classifier_version: row.get(1)?,
        activity_domain: row.get(2)?,
        semantic_kind: row.get(3)?,
        tool_name: row.get(4)?,
        presentation_hint: row.get(5)?,
        diff_projection: diff_projection
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    6,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?,
        phase: row.get(7)?,
        outcome: row.get(8)?,
        credibility: row.get(9)?,
        coverage_level: row.get(10)?,
        source_authority: row.get(11)?,
        source_evidence_ids: serde_json::from_str(&source_evidence_ids).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                12,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        first_evidence_sequence: row.get(13)?,
        last_evidence_sequence: row.get(14)?,
        revision: row.get(15)?,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::absolute_test_path;
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
            AgentRunWorkspace, CancelAgentRunCommand, ClaimAgentRunCommand, ExecutionRuntimeService,
        },
        team_tool::TeamToolService,
    };
    use serde_json::json;

    #[test]
    fn persistable_tool_result_uses_closed_updates_and_a_utf8_byte_budget() {
        let oversized = format!("{}界NEVER_PERSIST", "a".repeat(7_679));
        let prepared = prepare_persistable_result(
            "activity.completed",
            json!({
                "item": {
                    "id": "command-1",
                    "type": "commandExecution",
                    "status": "completed",
                    "aggregatedOutput": oversized,
                    "output": "lower-priority alias",
                    "summary": "fallback only",
                }
            }),
            Some(PersistableOutputUpdate::CompleteSnapshot),
        )
        .unwrap();
        let output = prepared.payload["item"]["aggregatedOutput"]
            .as_str()
            .unwrap();
        assert_eq!(output.len(), 7_679);
        assert!(output.is_char_boundary(output.len()));
        assert!(!output.contains("NEVER_PERSIST"));
        assert_eq!(prepared.output_truncated, Some(true));
        assert!(prepared.payload["item"].get("output").is_none());
        assert!(prepared.payload["item"].get("summary").is_none());
        serde_json::to_string(&prepared.payload).unwrap();
        let (emoji_prefix, emoji_truncated) = truncate_utf8_prefix(
            &format!("{}🙂", "a".repeat(7_679)),
            PERSISTED_TOOL_OUTPUT_LIMIT_BYTES,
        );
        assert_eq!(emoji_prefix.len(), 7_679);
        assert!(emoji_truncated);

        let explicit_empty = prepare_persistable_result(
            "activity.completed",
            json!({
                "item": {
                    "id": "command-2",
                    "type": "commandExecution",
                    "status": "completed",
                    "aggregatedOutput": "",
                    "output": "must not become the result",
                    "summary": "must not become the result",
                }
            }),
            Some(PersistableOutputUpdate::CompleteSnapshot),
        )
        .unwrap();
        assert_eq!(explicit_empty.payload["item"]["aggregatedOutput"], "");
        assert_eq!(explicit_empty.output_truncated, Some(false));

        let shared_error_budget = prepare_persistable_result(
            "activity.completed",
            json!({
                "item": {
                    "id": "tool-3",
                    "type": "mcpToolCall",
                    "status": "failed",
                    "output": {"content": [
                        {"type": "text", "text": "a".repeat(7_679)}
                    ]},
                    "error": {"message": "ERROR_MUST_NOT_SURVIVE", "stack": "stack"}
                }
            }),
            Some(PersistableOutputUpdate::CompleteSnapshot),
        )
        .unwrap();
        let output = shared_error_budget.payload["item"]["output"]
            .as_str()
            .unwrap();
        assert_eq!(output.len(), PERSISTED_TOOL_OUTPUT_LIMIT_BYTES);
        assert!(output.ends_with('\n'));
        assert!(!output.contains("ERROR_MUST_NOT_SURVIVE"));
        assert_eq!(shared_error_budget.output_truncated, Some(true));
        assert_eq!(
            output_value_text(&json!({"b": 2, "a": 1})).unwrap(),
            Some(r#"{"a":1,"b":2}"#.to_string())
        );

        let generic_result = json!([
            {"path":"src/a.ts","line":12,"text":"匹配内容 A"},
            {"path":"src/b.ts","line":35,"text":"匹配内容 B"}
        ]);
        let (event_type, payload) = crate::codex::normalize_event(
            "item/completed",
            &json!({
                "item": {
                    "id": "dynamic-1",
                    "type": "dynamicToolCall",
                    "status": "completed",
                    "output": generic_result.clone(),
                }
            }),
        );
        let payload = normalize_public_payload(event_type, &payload);
        let generic_json = prepare_persistable_result(
            event_type,
            payload.clone(),
            persistable_output_update(event_type, &payload),
        )
        .unwrap();
        let persisted = generic_json.payload["item"]["output"].as_str().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(persisted).unwrap(),
            generic_result
        );
        assert_eq!(generic_json.output_truncated, Some(false));

        let result_with_content_metadata = json!({
            "content": [{"type":"text","text":"typed text"}],
            "rowCount": 1,
        });
        let payload = normalize_public_payload(
            "activity.completed",
            &json!({
                "item": {
                    "id": "mcp-structured-1",
                    "type": "mcpToolCall",
                    "status": "completed",
                    "result": result_with_content_metadata.clone(),
                }
            }),
        );
        let structured_json = prepare_persistable_result(
            "activity.completed",
            payload.clone(),
            persistable_output_update("activity.completed", &payload),
        )
        .unwrap();
        let persisted = structured_json.payload["item"]["output"].as_str().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(persisted).unwrap(),
            result_with_content_metadata
        );

        assert_eq!(
            persistable_output_update("command.output.delta", &Value::Null),
            Some(PersistableOutputUpdate::OrderedDelta)
        );
        assert_eq!(
            persistable_output_update(
                "activity.started",
                &json!({"item":{"type":"commandExecution"}})
            ),
            Some(PersistableOutputUpdate::MetadataOnly)
        );
        assert_eq!(
            persistable_output_update(
                "activity.started",
                &json!({"item":{"type":"commandExecution","aggregatedOutput":"partial"}})
            ),
            Some(PersistableOutputUpdate::CompleteSnapshot)
        );
        assert_eq!(
            persistable_output_update(
                "activity.completed",
                &json!({"item":{"type":"commandExecution","status":"completed"}})
            ),
            Some(PersistableOutputUpdate::MetadataOnly)
        );
        assert_eq!(
            persistable_output_update(
                "runtime.action",
                &json!({"status":"in_progress","output":"partial"})
            ),
            Some(PersistableOutputUpdate::CompleteSnapshot)
        );
        assert_eq!(
            persistable_output_update(
                "runtime.action",
                &json!({"status":"completed","output":null})
            ),
            Some(PersistableOutputUpdate::MetadataOnly)
        );
        assert_eq!(
            persistable_output_update("runtime.action", &json!({"status":"completed","output":""})),
            Some(PersistableOutputUpdate::CompleteSnapshot)
        );
    }

    #[test]
    fn builtin_agent_output_digest_keeps_carrier_proof_without_a_second_result_body() {
        let raw_result = json!({
            "status": "accepted",
            "messageId": "msg_123",
            "agentAddressingMode": "automatic",
            "visibility": "camp_public",
            "campTurnId": "turn_1",
            "effectiveRecipients": ["agent_27"],
            "recipientPresentation": {},
            "recipientSetDigest": "sha256:digest",
            "deliveryIds": ["delivery_1"],
            "allocatedAgentRunResponsibilities": 1
        });
        let envelope = BuiltinToolInvocationEnvelope::success(
            "camp.message.send",
            "7b5db24c-4a43-4cab-9217-d982b08f7691",
            raw_result.clone(),
        )
        .unwrap();
        let agent_output = project_envelope(envelope.clone()).unwrap();
        let agent_output_digest = crate::command::canonical_json_digest(&agent_output).unwrap();
        let raw_output_digest = crate::command::canonical_json_digest(&raw_result).unwrap();
        assert_ne!(agent_output_digest, raw_output_digest);

        let normalized = normalize_public_payload(
            "runtime.action",
            &json!({
                "toolCallId": "builtin-1",
                "status": "completed",
                "kind": "builtin_tool_invocation",
                "sourceAuthority": "core",
                "canonicalTool": "camp.message.send",
                "rawOutputDigest": raw_output_digest,
                "operationProjection": {"canonicalResult": agent_output},
                "coreEnvelope": envelope,
            }),
        );
        assert_eq!(normalized["agentOutputDigest"], agent_output_digest);
        assert_eq!(normalized["errorCode"], Value::Null);

        let prepared = prepare_persistable_result(
            "runtime.action",
            normalized,
            Some(PersistableOutputUpdate::CompleteSnapshot),
        )
        .unwrap();
        assert_eq!(prepared.payload["resultDigest"], raw_output_digest);
        assert_eq!(prepared.payload["agentOutputDigest"], agent_output_digest);
        assert!(prepared.payload["coreEnvelope"].get("result").is_none());
        assert!(
            prepared.payload["operationProjection"]
                .get("canonicalResult")
                .is_none()
        );

        let failed = normalize_public_payload(
            "runtime.action",
            &json!({
                "status": "failed",
                "error": {"code": "tool.failed", "message": "failed"}
            }),
        );
        assert_eq!(failed["errorCode"], "tool.failed");
        let failed_activity = normalize_public_payload(
            "activity.completed",
            &json!({
                "errorCode": "command.failed",
                "item": {"type": "commandExecution", "status": "failed"}
            }),
        );
        assert_eq!(failed_activity["item"]["errorCode"], "command.failed");
    }

    #[test]
    fn ordered_delta_appends_only_remaining_budget_and_metadata_preserves_loss_state() {
        let mut existing = json!({"item": {"aggregatedOutput": "a".repeat(7_678)}});
        let incoming = json!({"item": {"aggregatedOutput": "界tail"}});
        assert!(append_ordered_delta(
            &mut existing,
            &incoming,
            Some(false),
            Some(false),
        ));
        assert_eq!(
            existing["item"]["aggregatedOutput"].as_str().unwrap().len(),
            7_678
        );

        let before = existing.clone();
        assert!(append_ordered_delta(
            &mut existing,
            &json!({"item": {"aggregatedOutput": "ignored"}}),
            Some(true),
            Some(false),
        ));
        assert_eq!(existing, before);

        let metadata = prepare_persistable_result(
            "activity.started",
            json!({
                "status": "inProgress",
                "item": {"type": "commandExecution", "aggregatedOutput": "must disappear"}
            }),
            Some(PersistableOutputUpdate::MetadataOnly),
        )
        .unwrap();
        assert_eq!(metadata.output_truncated, None);
        assert!(metadata.payload["item"].get("aggregatedOutput").is_none());
    }

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
                    "query": "password=公开测试词 token=也照常展示",
                    "command": "pnpm test",
                    "commandActions": [{
                        "type": "read",
                        "name": "test",
                        "path": absolute_test_path("/repo/package.json"),
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
        assert!(normalized["item"].get("query").is_none());
        assert_eq!(normalized["item"]["commandActions"][0]["type"], "read");
        assert_eq!(
            normalized["item"]["commandActions"][0]["path"],
            absolute_test_path("/repo/package.json")
        );
        assert!(normalized["item"]["commandActions"][0]["command"].is_null());
        assert!(!encoded.contains("hiddenProviderPacket"));
        assert!(!encoded.contains("providerPrivateState"));
        assert!(!encoded.contains("internal-thread"));
        for event in ["activity.started", "activity.completed"] {
            let generated = normalize_public_payload(
                event,
                &json!({"item": {
                    "id":"image-native", "type":"imageGeneration", "status":"completed",
                    "result":"private-image-base64", "savedPath":"/private/generated.png"
                }}),
            );
            assert!(generated["item"]["output"].is_null());
            assert!(!generated.to_string().contains("private-image-base64"));
            assert!(!generated.to_string().contains("/private/generated.png"));
            let mcp = normalize_public_payload(
                event,
                &json!({"item": {
                    "id":"image-mcp", "type":"mcpToolCall", "status":"completed",
                    "result":{"content":[
                        {"type":"text","text":"Before image"},
                        {"type":"image","data":"private-image-base64","uri":"/private/generated.png","mimeType":"image/png"},
                        {"type":"text","text":"After image"}
                    ]}
                }}),
            );
            assert_eq!(mcp["item"]["output"], "Before image\nAfter image");
            assert!(!mcp.to_string().contains("private-image-base64"));
            assert!(!mcp.to_string().contains("/private/generated.png"));
        }
    }

    #[test]
    fn generic_query_is_not_public_but_an_admitted_search_operation_is() {
        let generic = normalize_public_payload(
            "runtime.action",
            &json!({
                "toolCallId": "database-1",
                "status": "completed",
                "kind": "tool",
                "toolName": "database.execute",
                "query": "SELECT * FROM users",
                "providerPrivate": "must-not-persist"
            }),
        );
        assert!(generic.get("query").is_none());
        assert!(generic.get("runtimeSearchOperation").is_none());
        assert!(generic.get("providerPrivate").is_none());

        let query = "password=公开测试词 token=也照常展示";
        let candidate = runtime_search_operation::claude_web_search_candidate(
            "assistant.tool_use.WebSearch",
            "WebSearch",
            Some(&json!([query, "第二个搜索词"])),
        )
        .unwrap();
        let mut source = json!({
            "toolCallId": "web-search-1",
            "toolName": "WebSearch",
            "status": "in_progress",
            "kind": "web_search",
        });
        runtime_search_operation::insert_candidate(&mut source, Some(candidate));
        let mut normalized = normalize_public_payload("runtime.action", &source);
        normalize_runtime_search_operation_evidence(
            &mut normalized,
            "runtime.action",
            &source,
            Some("claude-code-cli"),
            Some("2.1.220"),
        );
        assert!(normalized.get("query").is_none());
        assert_eq!(normalized["runtimeSearchOperation"]["status"], "available");
        assert_eq!(normalized["runtimeSearchOperation"]["searchKind"], "web");
        assert_eq!(normalized["runtimeSearchOperation"]["query"], query);
        assert_eq!(
            normalized["runtimeSearchOperation"]["queries"],
            json!([query, "第二个搜索词"])
        );
        assert_eq!(
            normalized["runtimeSearchOperation"]["sourceMetadata"]["observedRuntimeVersion"],
            "2.1.220"
        );
        assert_eq!(normalized["kind"], "web_search");

        let candidate = runtime_search_operation::acp_web_search_candidate(
            crate::agent_profile::AdapterKind::KiroCli,
            Some("tool_call_update"),
            "completed",
            "search",
            Some(&json!({"query": "network query"})),
        )
        .unwrap();
        let mut source = json!({"status": "completed", "kind": "search"});
        runtime_search_operation::insert_candidate(&mut source, Some(candidate));
        let mut unqualified = normalize_public_payload("runtime.action", &source);
        normalize_runtime_search_operation_evidence(
            &mut unqualified,
            "runtime.action",
            &source,
            Some("kiro-cli"),
            Some("2.19.0"),
        );
        assert_eq!(unqualified["kind"], "search");
        assert_eq!(
            unqualified["runtimeSearchOperation"]["status"],
            "unavailable"
        );
        assert!(unqualified["runtimeSearchOperation"].get("query").is_none());
    }

    #[test]
    fn an_inflight_v1_operation_keeps_settling_into_its_v1_projection() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-execution-evidence-v1-continuity-test-{}",
            Uuid::new_v4()
        ));
        let mut database = crate::test_support::fresh_schema_database_fast_at(&directory);
        let payload = json!({
            "toolCallId": "search-1",
            "status": "completed",
            "kind": "search"
        });
        let current_facts = canonical_activity::classify_evidence(
            "run-v1",
            1,
            "terminal-evidence",
            "runtime.action",
            "tool_call",
            "terminal",
            &payload,
        );
        let previous_facts = canonical_activity::classify_evidence_with_version(
            canonical_activity::PREVIOUS_CLASSIFIER_VERSION,
            "run-v1",
            1,
            "terminal-evidence",
            "runtime.action",
            "tool_call",
            "terminal",
            &payload,
        );
        let intermediate_facts = canonical_activity::classify_evidence_with_version(
            canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION,
            "run-v1",
            1,
            "terminal-evidence",
            "runtime.action",
            "tool_call",
            "terminal",
            &payload,
        );
        let legacy_facts = canonical_activity::classify_evidence_with_version(
            canonical_activity::LEGACY_CLASSIFIER_VERSION,
            "run-v1",
            1,
            "terminal-evidence",
            "runtime.action",
            "tool_call",
            "terminal",
            &payload,
        );
        assert_eq!(current_facts.semantic_kind.as_deref(), Some("tool.search"));
        assert_eq!(
            legacy_facts.semantic_kind.as_deref(),
            Some("tool.web.search")
        );

        database
            .connection()
            .execute_batch("PRAGMA foreign_keys = OFF;")
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO canonical_runtime_activity(
                    agent_run_id, execution_epoch, operation_id, classifier_version,
                    activity_domain, semantic_kind, tool_name, presentation_hint,
                    phase, outcome, credibility, coverage_level, source_authority,
                    source_evidence_ids_json, first_evidence_sequence,
                    last_evidence_sequence, revision, created_at, updated_at
                ) VALUES (
                    'run-v1', 1, ?1, 'activity-v1',
                    'tool', 'tool.web.search', NULL, 'Web 搜索',
                    'started', 'unknown', 'runtime_structured', 'fine_grained',
                    'runtime', '["started-evidence"]', 1, 1, 1,
                    datetime('now'), datetime('now')
                )
                "#,
                [current_facts.operation_id.as_str()],
            )
            .unwrap();

        let transaction = database.connection_mut().transaction().unwrap();
        let projection = upsert_canonical_activity(
            &transaction,
            "run-v1",
            1,
            2,
            "terminal-evidence",
            "2026-08-29T00:00:00Z",
            EvidenceActivityClassifications {
                current: &current_facts,
                previous: &previous_facts,
                intermediate: &intermediate_facts,
                legacy: &legacy_facts,
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            projection.classifier_version,
            canonical_activity::LEGACY_CLASSIFIER_VERSION
        );
        assert_eq!(projection.semantic_kind.as_deref(), Some("tool.web.search"));
        assert_eq!(projection.phase, "terminal");
        transaction.commit().unwrap();

        let versions: (i64, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT
                    SUM(CASE WHEN classifier_version = 'activity-v1' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN classifier_version = 'activity-v2' THEN 1 ELSE 0 END)
                FROM canonical_runtime_activity
                WHERE agent_run_id = 'run-v1' AND operation_id = ?1
                "#,
                [current_facts.operation_id.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(versions, (1, 0));

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn inflight_v2_and_v3_command_reads_keep_their_frozen_classifier() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-execution-evidence-v2-continuity-test-{}",
            Uuid::new_v4()
        ));
        let mut database = crate::test_support::fresh_schema_database_fast_at(&directory);
        let payload = json!({
            "item": {"id":"read-1","type":"commandExecution","status":"completed"},
            "runtimeFileOperation": {
                "schemaVersion": 2,
                "source": "runtime_reported",
                "status": "available",
                "operationKind": "read",
                "path": "docs/README.md"
            }
        });
        let current = canonical_activity::classify_evidence(
            "run-v2",
            1,
            "terminal",
            "activity.completed",
            "command",
            "terminal",
            &payload,
        );
        let previous = canonical_activity::classify_evidence_with_version(
            canonical_activity::PREVIOUS_CLASSIFIER_VERSION,
            "run-v2",
            1,
            "terminal",
            "activity.completed",
            "command",
            "terminal",
            &payload,
        );
        let intermediate = canonical_activity::classify_evidence_with_version(
            canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION,
            "run-v2",
            1,
            "terminal",
            "activity.completed",
            "command",
            "terminal",
            &payload,
        );
        let legacy = canonical_activity::classify_evidence_with_version(
            canonical_activity::LEGACY_CLASSIFIER_VERSION,
            "run-v2",
            1,
            "terminal",
            "activity.completed",
            "command",
            "terminal",
            &payload,
        );
        assert_eq!(current.semantic_kind.as_deref(), Some("file.read"));
        assert_eq!(previous.semantic_kind.as_deref(), Some("file.read"));
        assert_eq!(intermediate.semantic_kind.as_deref(), Some("shell.execute"));
        database
            .connection()
            .execute_batch("PRAGMA foreign_keys = OFF;")
            .unwrap();
        database
            .connection()
            .execute(
                r#"INSERT INTO canonical_runtime_activity(
                agent_run_id, execution_epoch, operation_id, classifier_version,
                activity_domain, semantic_kind, tool_name, presentation_hint,
                phase, outcome, credibility, coverage_level, source_authority,
                source_evidence_ids_json, first_evidence_sequence,
                last_evidence_sequence, revision, created_at, updated_at
            ) VALUES (
                'run-v2', 1, ?1, 'activity-v2', 'shell', 'shell.execute', NULL, NULL,
                'started', 'unknown', 'runtime_structured', 'fine_grained', 'runtime',
                '["started"]', 1, 1, 1, datetime('now'), datetime('now')
            )"#,
                [current.operation_id.as_str()],
            )
            .unwrap();
        let transaction = database.connection_mut().transaction().unwrap();
        let projection = upsert_canonical_activity(
            &transaction,
            "run-v2",
            1,
            2,
            "terminal",
            "2026-09-06T00:00:00Z",
            EvidenceActivityClassifications {
                current: &current,
                previous: &previous,
                intermediate: &intermediate,
                legacy: &legacy,
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            projection.classifier_version,
            canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION
        );
        assert_eq!(projection.semantic_kind.as_deref(), Some("shell.execute"));
        assert_eq!(projection.phase, "terminal");
        transaction.commit().unwrap();
        let count: i64 = database.connection().query_row(
            "SELECT COUNT(*) FROM canonical_runtime_activity WHERE agent_run_id='run-v2' AND operation_id=?1",
            [current.operation_id.as_str()],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 1);

        let current_v3 = canonical_activity::classify_evidence(
            "run-v3",
            1,
            "terminal-v3",
            "activity.completed",
            "command",
            "terminal",
            &payload,
        );
        let previous_v3 = canonical_activity::classify_evidence_with_version(
            canonical_activity::PREVIOUS_CLASSIFIER_VERSION,
            "run-v3",
            1,
            "terminal-v3",
            "activity.completed",
            "command",
            "terminal",
            &payload,
        );
        let intermediate_v3 = canonical_activity::classify_evidence_with_version(
            canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION,
            "run-v3",
            1,
            "terminal-v3",
            "activity.completed",
            "command",
            "terminal",
            &payload,
        );
        let legacy_v3 = canonical_activity::classify_evidence_with_version(
            canonical_activity::LEGACY_CLASSIFIER_VERSION,
            "run-v3",
            1,
            "terminal-v3",
            "activity.completed",
            "command",
            "terminal",
            &payload,
        );
        database
            .connection()
            .execute(
                r#"INSERT INTO canonical_runtime_activity(
                    agent_run_id, execution_epoch, operation_id, classifier_version,
                    activity_domain, semantic_kind, tool_name, presentation_hint,
                    phase, outcome, credibility, coverage_level, source_authority,
                    source_evidence_ids_json, first_evidence_sequence,
                    last_evidence_sequence, revision, created_at, updated_at
                ) VALUES (
                    'run-v3', 1, ?1, 'activity-v3', 'file', 'file.read', NULL, NULL,
                    'started', 'unknown', 'runtime_structured', 'fine_grained', 'runtime',
                    '["started-v3"]', 1, 1, 1, datetime('now'), datetime('now')
                )"#,
                [current_v3.operation_id.as_str()],
            )
            .unwrap();
        let transaction = database.connection_mut().transaction().unwrap();
        let projection_v3 = upsert_canonical_activity(
            &transaction,
            "run-v3",
            1,
            2,
            "terminal-v3",
            "2026-09-07T00:00:00Z",
            EvidenceActivityClassifications {
                current: &current_v3,
                previous: &previous_v3,
                intermediate: &intermediate_v3,
                legacy: &legacy_v3,
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            projection_v3.classifier_version,
            canonical_activity::PREVIOUS_CLASSIFIER_VERSION
        );
        assert_eq!(projection_v3.semantic_kind.as_deref(), Some("file.read"));
        transaction.commit().unwrap();
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
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
    fn claude_exact_mutation_remains_append_only_evidence_and_projects_without_line_numbers() {
        let mut started_payload = normalize_public_payload(
            "runtime.action",
            &json!({
                "toolCallId": "toolu_edit_1",
                "toolName": "Edit",
                "status": "in_progress",
                "kind": "edit"
            }),
        );
        normalize_runtime_diff_evidence(
            &mut started_payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some("claude-code-cli"),
            Some("1.0.100"),
            None,
        );
        assert!(
            runtime_diff::projection_from_evidence(&started_payload, "evidence-edit-started")
                .is_none(),
            "a null started candidate must not become an unavailable terminal snapshot"
        );

        let mut payload = normalize_public_payload(
            "runtime.action",
            &json!({
                "toolCallId": "toolu_edit_1",
                "toolName": "Edit",
                "status": "completed",
                "kind": "edit",
                "runtimeDiff": {
                    "adapterKind": "claude-code-cli",
                    "protocolFamily": "claude-stream-json",
                    "sourceEventKind": "assistant.tool_use.Edit+user.tool_result.completed",
                    "semanticKind": "exact_mutation",
                    "entries": [{
                        "semantics": "exact_mutation",
                        "path": absolute_test_path("/repo/src/CampWorkspace.tsx"),
                        "oldText": "const enabled = false",
                        "newText": "const enabled = true"
                    }]
                }
            }),
        );
        normalize_runtime_diff_evidence(
            &mut payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some("claude-code-cli"),
            Some("1.0.100"),
            None,
        );

        assert_eq!(payload["runtimeDiff"]["status"], "available");
        assert_eq!(payload["runtimeDiff"]["semanticKind"], "exact_mutation");
        assert_eq!(
            payload.pointer("/runtimeDiff/entries/0"),
            Some(&json!({
                "semantics": "exact_mutation",
                "path": "src/CampWorkspace.tsx",
                "oldText": "const enabled = false",
                "newText": "const enabled = true"
            }))
        );
        assert!(payload.pointer("/runtimeDiff/entries/0/diff").is_none());

        let projection = runtime_diff::projection_from_evidence(&payload, "evidence-edit-1")
            .expect("normalized exact mutation should project");
        assert_eq!(projection.semantic_kind.as_deref(), Some("exact_mutation"));
        let entry = &projection.entries.as_ref().unwrap()[0];
        assert_eq!((entry.additions, entry.deletions), (1, 1));
        assert_eq!(
            entry.diff,
            "-const enabled = false\n+const enabled = true\n"
        );
        assert!(!entry.diff.contains("@@"));
    }

    #[test]
    fn pi_edit_patch_becomes_normalized_append_only_diff_evidence() {
        let mut payload = normalize_public_payload(
            "runtime.action",
            &json!({
                "toolCallId": "pi-edit-1",
                "toolName": "edit",
                "status": "completed",
                "kind": "edit",
                "runtimeFileOperation": {
                    "adapterKind": "pi",
                    "protocolFamily": "pi-jsonl-rpc-v1",
                    "sourceEventKind": "tool_execution_end.completed",
                    "operationKind": "write",
                    "path": absolute_test_path("/repo/src/app.ts")
                },
                "runtimeDiff": {
                    "adapterKind": "pi",
                    "protocolFamily": "pi-jsonl-rpc-v1",
                    "sourceEventKind": "tool_execution_end.completed",
                    "semanticKind": "pi_edit_patch",
                    "entries": [{
                        "path": absolute_test_path("/repo/src/app.ts"),
                        "changeKind": "update",
                        "diff": concat!(
                            "--- /repo/src/app.ts\n",
                            "+++ /repo/src/app.ts\n",
                            "@@ -1 +1,2 @@\n-old\n+new\n+next\n"
                        ).replace("/repo", &absolute_test_path("/repo"))
                    }]
                }
            }),
        );
        normalize_runtime_file_operation_evidence(
            &mut payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some("pi"),
            Some("0.84.4"),
            None,
        );
        normalize_runtime_diff_evidence(
            &mut payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some("pi"),
            Some("0.84.4"),
            None,
        );

        assert_eq!(payload["runtimeFileOperation"]["path"], "src/app.ts");
        assert_eq!(payload["runtimeDiff"]["status"], "available");
        assert_eq!(
            payload["runtimeDiff"]["semanticKind"],
            "unified_diff_snapshot"
        );
        assert_eq!(
            payload.pointer("/runtimeDiff/sourceMetadata/adapterKind"),
            Some(&json!("pi"))
        );
        let projection = runtime_diff::projection_from_evidence(&payload, "evidence-pi-edit")
            .expect("normalized Pi edit Evidence should project");
        let entry = &projection.entries.as_ref().unwrap()[0];
        assert_eq!(entry.path, "src/app.ts");
        assert_eq!((entry.additions, entry.deletions), (2, 1));
        assert!(
            entry
                .diff
                .starts_with("--- a/src/app.ts\n+++ b/src/app.ts\n")
        );
    }

    #[test]
    fn acp_file_operation_path_is_durable_without_fabricating_a_diff_projection() {
        let mut payload = normalize_public_payload(
            "runtime.action",
            &json!({
                "toolCallId": "qoder-edit",
                "status": "completed",
                "kind": "edit",
                "runtimeFileOperation": {
                    "adapterKind": "qoder-cli",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "operationKind": "write",
                    "path": absolute_test_path("/repo/rovai-runtime-validation/qoder-cli.txt")
                }
            }),
        );
        normalize_runtime_file_operation_evidence(
            &mut payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some("qoder-cli"),
            Some("1.1.28"),
            None,
        );
        normalize_runtime_diff_evidence(
            &mut payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some("qoder-cli"),
            Some("1.1.28"),
            None,
        );

        assert_eq!(payload["runtimeFileOperation"]["status"], "available");
        assert_eq!(
            payload["runtimeFileOperation"]["path"],
            "rovai-runtime-validation/qoder-cli.txt"
        );
        assert!(payload["runtimeDiff"].is_null());
        assert!(runtime_diff::projection_from_evidence(&payload, "evidence-qoder").is_none());

        let mut add_payload = normalize_public_payload(
            "runtime.action",
            &json!({
                "toolCallId": "opencode-add",
                "status": "completed",
                "kind": "edit",
                "runtimeFileOperation": {
                    "adapterKind": "opencode-cli",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "operationKind": "write",
                    "changeKind": "add",
                    "path": absolute_test_path("/repo/src/new-file.ts")
                }
            }),
        );
        normalize_runtime_file_operation_evidence(
            &mut add_payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some("opencode-cli"),
            Some("1.18.20"),
            None,
        );
        assert_eq!(add_payload["runtimeFileOperation"]["status"], "available");
        assert_eq!(
            add_payload["runtimeFileOperation"]["operationKind"],
            "write"
        );
        assert_eq!(add_payload["runtimeFileOperation"]["changeKind"], "add");
        assert_eq!(
            add_payload["runtimeFileOperation"]["path"],
            "src/new-file.ts"
        );

        let mut managed_payload = normalize_public_payload(
            "runtime.action",
            &json!({
                "toolCallId": "qoder-managed-output",
                "status": "completed",
                "kind": "edit",
                "runtimeFileOperation": {
                    "adapterKind": "qoder-cli",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "operationKind": "write",
                    "path": absolute_test_path("/rovai/runtime/builtin-tools/process/run-tmp/report.html")
                }
            }),
        );
        normalize_runtime_file_operation_evidence(
            &mut managed_payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some("qoder-cli"),
            Some("1.1.28"),
            Some(Path::new(&absolute_test_path(
                "/rovai/runtime/builtin-tools/process/run-tmp",
            ))),
        );
        assert_eq!(
            managed_payload["runtimeFileOperation"]["safeReasonCode"],
            RUNTIME_FILE_OPERATION_MANAGED_OUTPUT_ROOT
        );
        assert!(
            runtime_file_operation::path_from_evidence(&managed_payload).is_none(),
            "managed output must not create a Command file row or Run-card path"
        );
    }

    #[test]
    fn codex_read_projection_uses_only_one_structured_read_path() {
        for command in [
            "cat docs/README.md",
            "head -n 20 docs/README.md",
            "tail -n 20 docs/README.md",
            "sed -n '1,20p' docs/README.md",
        ] {
            let source = json!({
                "item": {
                    "id": "read-1",
                    "type": "commandExecution",
                    "status": "completed",
                    "command": command,
                    "commandActions": [{
                        "type": "read",
                        "name": "read",
                        "path": absolute_test_path("/repo/docs/README.md")
                    }]
                }
            });
            let mut payload = normalize_public_payload("activity.completed", &source);
            insert_codex_command_read_candidate(
                &mut payload,
                "activity.completed",
                &source,
                Some("codex-cli"),
            );
            normalize_runtime_file_operation_evidence(
                &mut payload,
                Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
                Some("codex-cli"),
                Some("codex-test"),
                None,
            );
            assert_eq!(payload["runtimeFileOperation"]["schemaVersion"], 2);
            assert_eq!(payload["runtimeFileOperation"]["status"], "available");
            assert_eq!(payload["runtimeFileOperation"]["operationKind"], "read");
            assert_eq!(payload["runtimeFileOperation"]["path"], "docs/README.md");
        }

        for actions in [
            json!([]),
            json!([{"type":"read","path":absolute_test_path("/repo/a")},{"type":"read","path":absolute_test_path("/repo/b")}]),
            json!([{"type":"read","path":absolute_test_path("/repo/a")},{"type":"search","query":"needle"}]),
            json!([{"type":"read","path":""}]),
        ] {
            let source = json!({
                "item": {
                    "id": "not-one-read",
                    "type": "commandExecution",
                    "status": "completed",
                    "commandActions": actions
                }
            });
            let mut payload = normalize_public_payload("activity.completed", &source);
            insert_codex_command_read_candidate(
                &mut payload,
                "activity.completed",
                &source,
                Some("codex-cli"),
            );
            assert!(payload.get("runtimeFileOperation").is_none());
        }
    }

    #[test]
    fn kiro_single_diff_uses_the_same_tool_calls_normalized_location_when_diff_path_is_rooted_wrong()
     {
        let mut payload = normalize_public_payload(
            "runtime.action",
            &json!({
                "toolCallId": "kiro-edit",
                "status": "completed",
                "kind": "edit",
                "runtimeFileOperation": {
                    "adapterKind": "kiro-cli",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "operationKind": "write",
                    "path": absolute_test_path("/repo/rovai-runtime-validation/kiro-cli.txt")
                },
                "runtimeDiff": {
                    "adapterKind": "kiro-cli",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "semanticKind": "complete_before_after",
                    "entries": [{
                        "path": absolute_test_path("/rovai-runtime-validation/kiro-cli.txt"),
                        "oldText": "state=before\n",
                        "newText": "state=after\n"
                    }]
                }
            }),
        );
        normalize_runtime_file_operation_evidence(
            &mut payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some("kiro-cli"),
            Some("kiro-cli 2.18.1"),
            None,
        );
        normalize_runtime_diff_evidence(
            &mut payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some("kiro-cli"),
            Some("kiro-cli 2.18.1"),
            None,
        );

        assert_eq!(payload["runtimeDiff"]["status"], "available");
        assert_eq!(
            payload["runtimeDiff"]["entries"][0]["path"],
            "rovai-runtime-validation/kiro-cli.txt"
        );
        let projection = runtime_diff::projection_from_evidence(&payload, "evidence-kiro")
            .expect("Kiro diff should project after structured path reconciliation");
        assert_eq!(
            projection.entries.as_ref().unwrap()[0].path,
            "rovai-runtime-validation/kiro-cli.txt"
        );

        let mut managed_payload = normalize_public_payload(
            "runtime.action",
            &json!({
                "toolCallId": "kiro-managed-edit",
                "status": "completed",
                "kind": "edit",
                "runtimeFileOperation": {
                    "adapterKind": "kiro-cli",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "operationKind": "write",
                    "path": absolute_test_path("/rovai/runtime/builtin-tools/process/run-tmp/report.html")
                },
                "runtimeDiff": {
                    "adapterKind": "kiro-cli",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "semanticKind": "complete_before_after",
                    "entries": [{
                        "path": absolute_test_path("/report.html"),
                        "oldText": "before\n",
                        "newText": "after\n"
                    }]
                }
            }),
        );
        let managed_output_path =
            absolute_test_path("/rovai/runtime/builtin-tools/process/run-tmp");
        let managed_output_root = Path::new(&managed_output_path);
        normalize_runtime_file_operation_evidence(
            &mut managed_payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some("kiro-cli"),
            Some("kiro-cli 2.18.1"),
            Some(managed_output_root),
        );
        normalize_runtime_diff_evidence(
            &mut managed_payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some("kiro-cli"),
            Some("kiro-cli 2.18.1"),
            Some(managed_output_root),
        );
        assert_eq!(
            managed_payload["runtimeDiff"]["safeReasonCode"],
            runtime_diff::RUNTIME_DIFF_MANAGED_OUTPUT_ROOT
        );
        let managed_projection =
            runtime_diff::projection_from_evidence(&managed_payload, "evidence-kiro-managed")
                .expect("unavailable runtime diffs retain their safe diagnostic projection");
        assert_eq!(managed_projection.status, "unavailable");
        assert!(managed_projection.entries.is_none());
        assert_eq!(
            managed_projection.safe_reason_code.as_deref(),
            Some(runtime_diff::RUNTIME_DIFF_MANAGED_OUTPUT_ROOT)
        );
    }

    #[test]
    fn terminal_run_snapshot_drops_managed_output_before_it_becomes_durable_evidence() {
        let managed_output_path =
            absolute_test_path("/rovai/runtime/builtin-tools/process/run-tmp");
        let managed_output_root = Path::new(&managed_output_path);
        let mut payload = normalize_public_payload(
            "runtime.file_changes.snapshot",
            &json!({
                "eventId": "codex-turn-diff",
                "runtimeRunDiff": {
                    "status": "available",
                    "semanticKind": "unified_diff_snapshot",
                    "diff": concat!(
                        "diff --git a/src/app.ts b/src/app.ts\n",
                        "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
                        "diff --git a//rovai/runtime/builtin-tools/process/run-tmp/report.html ",
                        "b//rovai/runtime/builtin-tools/process/run-tmp/report.html\n",
                        "new file mode 100644\n--- /dev/null\n",
                        "+++ b//rovai/runtime/builtin-tools/process/run-tmp/report.html\n",
                        "@@ -0,0 +1 @@\n+temporary\n"
                    ).replace("/rovai/", &format!("{}/", absolute_test_path("/rovai")))
                }
            }),
        );
        normalize_runtime_run_diff_evidence(
            &mut payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some(managed_output_root),
        );
        let diff = payload["runtimeRunDiff"]["diff"].as_str().unwrap();
        assert!(diff.contains("src/app.ts"));
        assert!(!diff.contains("run-tmp/report.html"));

        payload["runtimeRunDiff"] = json!({
            "status": "available",
            "semanticKind": "unified_diff_snapshot",
            "diff": "not a structured diff /rovai/runtime/builtin-tools/process/run-tmp/report.html"
        });
        normalize_runtime_run_diff_evidence(
            &mut payload,
            Some(&json!({"executionRoot": absolute_test_path("/repo")}).to_string()),
            Some(managed_output_root),
        );
        assert_eq!(payload["runtimeRunDiff"]["status"], "unavailable");
        assert_eq!(
            payload["runtimeRunDiff"]["safeReasonCode"],
            RUNTIME_RUN_DIFF_MANAGED_OUTPUT_FILTER_UNSAFE
        );
        assert!(payload["runtimeRunDiff"].get("diff").is_none());

        payload["runtimeRunDiff"] = json!({
            "status": "available",
            "semanticKind": "unified_diff_snapshot",
            "diff": "diff --git a/src/app.ts b/src/app.ts\n"
        });
        normalize_runtime_run_diff_evidence(&mut payload, None, Some(managed_output_root));
        assert_eq!(
            payload["runtimeRunDiff"]["safeReasonCode"],
            RUNTIME_RUN_DIFF_EXECUTION_ROOT_MISSING
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
    fn compaction_display_is_durable_local_evidence_without_canonical_activity() {
        let summary = "summary line\n".repeat(2_000);
        let source = json!({
            "schemaVersion": 1,
            "compactionId": "compact-1",
            "adapterKind": "kimi-code-cli",
            "phase": "completed",
            "completionEvidence": "native_terminal",
            "tokens": {"before": 128_420, "after": 61_208},
            "messages": {"compacted": 37},
            "elapsedMs": 1_420,
            "summaryText": summary,
            "nativeSessionId": "must-not-persist",
        });
        assert!(ExecutionEvidenceService::is_durable_runtime_evidence_event(
            RUNTIME_COMPACTION_DISPLAY_EVENT
        ));
        let prepared = ExecutionEvidenceService
            .prepare_runtime_event(RUNTIME_COMPACTION_DISPLAY_EVENT, &source)
            .unwrap()
            .unwrap();
        assert_eq!(prepared.kind, "step");
        assert_eq!(prepared.phase, "completed");
        assert_eq!(prepared.payload["summaryText"], source["summaryText"]);
        assert!(prepared.payload.get("nativeSessionId").is_none());
        assert_eq!(
            source_event_key(RUNTIME_COMPACTION_DISPLAY_EVENT, &source).as_deref(),
            Some("runtime.compaction.display:compact-1:completed")
        );
        let mut started = source.clone();
        started["phase"] = json!("started");
        assert_eq!(
            source_event_key(RUNTIME_COMPACTION_DISPLAY_EVENT, &started).as_deref(),
            Some("runtime.compaction.display:compact-1:started")
        );
        let facts = canonical_activity::classify_evidence(
            "run-1",
            1,
            "evidence-1",
            RUNTIME_COMPACTION_DISPLAY_EVENT,
            "step",
            "completed",
            &prepared.payload,
        );
        assert!(!facts.is_activity);
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
                        expected_membership_generation: 1,
                        capability_overrides: json!({}),
                        source: None,
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
        let durable_delta_count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM agent_run_execution_evidence WHERE agent_run_id = ?1 AND event_type = 'command.output.delta'",
                [&run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(durable_delta_count, 0);

        let discarded_output_marker = "OUTPUT_AFTER_7680_MUST_NOT_PERSIST";
        let output = format!("{}{discarded_output_marker}", "x".repeat(7_680));
        let structured_diff = format!("DIFF_REMAINS_READABLE\n{}", "d".repeat(20_000));
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
                        "aggregatedOutput": output,
                        "changes": [{
                            "path": "src/output-limit.rs",
                            "changeKind": "update",
                            "diff": structured_diff,
                        }],
                    }
                }),
            )
            .unwrap()
            .unwrap();
        assert!(!evidence.inserted);
        assert!(evidence.is_truncated);
        assert_eq!(evidence.output_truncated, Some(true));
        assert!(evidence.content_blob_id.is_none());
        assert_eq!(evidence.id, started_command.id);
        assert_eq!(evidence.sequence, 1);
        assert_eq!(evidence.revision, Some(2));
        assert!(evidence.change_sequence > started_command.change_sequence);
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
        let saved_output = full_payload["item"]["aggregatedOutput"].as_str().unwrap();
        assert_eq!(
            saved_output.as_bytes().len(),
            PERSISTED_TOOL_OUTPUT_LIMIT_BYTES
        );
        assert!(!full_payload.to_string().contains(discarded_output_marker));
        assert!(full_payload.to_string().contains("DIFF_REMAINS_READABLE"));
        let (payload_preview, result_preview, result_blob_id): (String, Option<String>, Option<String>) =
            database.connection().query_row(
                "SELECT payload_preview_json, result_preview_json, result_blob_id FROM agent_run_execution_evidence WHERE id = ?1",
                [&evidence.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ).unwrap();
        assert!(!payload_preview.contains(discarded_output_marker));
        assert!(!result_preview.unwrap().contains(discarded_output_marker));
        let result_blob_id =
            result_blob_id.expect("structured diff should keep the result Blob-backed");
        let result_blob = blob_store.read_bytes(&database, &result_blob_id).unwrap();
        let result_blob = String::from_utf8(result_blob).unwrap();
        assert!(!result_blob.contains(discarded_output_marker));
        assert!(result_blob.contains("DIFF_REMAINS_READABLE"));
        let serialized_event = serde_json::to_string(&evidence.evidence).unwrap();
        assert!(!serialized_event.contains(discarded_output_marker));
        assert!(serialized_event.contains("\"outputTruncated\":true"));

        let metadata_only = ExecutionEvidenceService
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
                        "title": "late metadata",
                        "aggregatedOutput": "must not replace the accepted snapshot",
                    }
                }),
            )
            .unwrap()
            .unwrap();
        assert_eq!(metadata_only.output_truncated, Some(true));
        assert_eq!(
            ExecutionEvidenceService
                .read_full_payload(&database, &blob_store, &camp_id, &evidence.id)
                .unwrap()["item"]["aggregatedOutput"],
            saved_output
        );

        let replacement = ExecutionEvidenceService
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
                        "aggregatedOutput": "short replacement",
                    }
                }),
            )
            .unwrap()
            .unwrap();
        assert_eq!(replacement.output_truncated, Some(false));
        assert_eq!(
            replacement.payload["item"]["aggregatedOutput"],
            "short replacement"
        );
        assert!(
            replacement
                .payload
                .to_string()
                .contains("DIFF_REMAINS_READABLE")
        );
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
        let before_batch = database.connection().total_changes();
        assert!(
            ExecutionEvidenceService
                .record_prepared_runtime_event_batch(
                    &mut database,
                    &run_id,
                    execution_epoch,
                    prepared_batch.clone()
                )
                .is_err()
        );
        assert_eq!(database.connection().total_changes(), before_batch);
        let batch = prepared_batch
            .into_iter()
            .map(|item| {
                ExecutionEvidenceService
                    .record_runtime_event(
                        &mut database,
                        &blob_store,
                        &run_id,
                        execution_epoch,
                        &item.event_type,
                        &item.payload,
                    )
                    .unwrap()
                    .unwrap()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            batch
                .iter()
                .map(|evidence| evidence.sequence)
                .collect::<Vec<_>>(),
            vec![2, 3, 4]
        );
        assert_eq!(batch[0].payload["delta"], "hello ");
        assert!(batch.iter().all(|evidence| evidence.canonical.is_none()));
        let durable_deltas: i64 = database.connection().query_row(
            "SELECT COUNT(*) FROM agent_run_execution_evidence WHERE agent_run_id = ?1 AND event_type IN ('agent.text.delta', 'agent.thought.delta', 'agent.reasoning.summary.delta')",
            [&run_id], |row| row.get(0),
        ).unwrap();
        assert_eq!(
            durable_deltas, 0,
            "transport fragments must not become durable Evidence"
        );

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

        for (state, tier, expected_tier) in [
            ("fast", "priority", json!("priority")),
            ("standard", "default", json!("default")),
            ("cooldown", "standard", json!("standard")),
            ("unknown", "private-unrecognized-tier", Value::Null),
        ] {
            let observed = ExecutionEvidenceService
                .record_runtime_event(
                    &mut database,
                    &blob_store,
                    &run_id,
                    execution_epoch,
                    "runtime.fast.observed",
                    &json!({
                        "state": state,
                        "observedServiceTier": tier,
                        "rawDetail": "private-token",
                    }),
                )
                .unwrap()
                .unwrap();
            assert_eq!(observed.agent_run_id, run_id);
            assert_eq!(observed.execution_epoch, execution_epoch);
            assert_eq!(observed.payload["state"], state);
            assert_eq!(observed.payload["observedServiceTier"], expected_tier);
            assert!(observed.payload.get("rawDetail").is_none());
            assert!(
                observed.canonical.is_none(),
                "Fast metadata is not a tool activity"
            );
        }

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

        let terminal_first = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                "activity.completed",
                &json!({
                    "item": {
                        "id": "terminal-first-command",
                        "type": "commandExecution",
                        "status": "completed",
                        "exitCode": 0,
                    }
                }),
            )
            .unwrap()
            .unwrap();
        assert!(terminal_first.inserted);
        assert_eq!(terminal_first.sequence, 9);
        assert_eq!(terminal_first.revision, Some(1));
        let late_start_payload = json!({
            "item": {
                "id": "terminal-first-command",
                "type": "commandExecution",
                "command": "printf late-start",
                "status": "inProgress",
            }
        });
        let late_start = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                "activity.started",
                &late_start_payload,
            )
            .unwrap()
            .unwrap();
        assert!(!late_start.inserted);
        assert_eq!(late_start.id, terminal_first.id);
        assert_eq!(late_start.sequence, terminal_first.sequence);
        assert_eq!(late_start.revision, Some(2));
        assert!(late_start.change_sequence > terminal_first.change_sequence);
        assert_eq!(late_start.phase, "completed");
        assert_eq!(late_start.payload["item"]["status"], "completed");
        assert_eq!(late_start.payload["item"]["command"], "printf late-start");
        let canonical_started: bool = database.connection().query_row(
            "SELECT started_at IS NOT NULL FROM canonical_runtime_activity WHERE agent_run_id = ?1 AND operation_id = ?2",
            params![run_id, late_start.canonical.as_ref().unwrap().operation_id],
            |row| row.get(0),
        ).unwrap();
        assert!(
            canonical_started,
            "a late start must fill the canonical start time"
        );
        let duplicate_late_start = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                "activity.started",
                &late_start_payload,
            )
            .unwrap()
            .unwrap();
        assert_eq!(duplicate_late_start.revision, late_start.revision);
        assert_eq!(
            duplicate_late_start.change_sequence,
            late_start.change_sequence
        );
        let conflicting_terminal_payload = json!({
            "item": {
                "id": "terminal-first-command",
                "type": "commandExecution",
                "status": "failed",
            },
            "errorCode": "late_conflict",
        });
        let conflicting_terminal = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                "activity.completed",
                &conflicting_terminal_payload,
            )
            .unwrap()
            .unwrap();
        assert_eq!(conflicting_terminal.id, terminal_first.id);
        assert_eq!(conflicting_terminal.sequence, terminal_first.sequence);
        assert_eq!(conflicting_terminal.revision, Some(3));
        assert_eq!(
            conflicting_terminal.canonical.as_ref().unwrap().outcome,
            "unsettled"
        );
        assert_eq!(conflicting_terminal.payload["status"], "unsettled");
        let duplicate_conflict = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                "activity.completed",
                &conflicting_terminal_payload,
            )
            .unwrap()
            .unwrap();
        assert_eq!(duplicate_conflict.revision, conflicting_terminal.revision);
        assert_eq!(
            duplicate_conflict.change_sequence,
            conflicting_terminal.change_sequence
        );
        assert_eq!(duplicate_conflict.payload["status"], "unsettled");
        assert_eq!(
            duplicate_conflict.canonical.as_ref().unwrap().outcome,
            "unsettled"
        );

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
        assert_eq!(started_tool.sequence, 10);

        let (pi_event_type, pi_update) = crate::pi::normalize_event(&json!({
            "type": "tool_execution_update",
            "toolCallId": "pi-streamed-result",
            "toolName": "grep",
            "args": {"query": "needle"},
            "partialResult": {
                "content": [{"type": "text", "text": "找到 3 个文件……"}]
            }
        }));
        let pi_streamed = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                pi_event_type,
                &pi_update,
            )
            .unwrap()
            .unwrap();
        assert!(pi_streamed.inserted);
        assert_eq!(pi_streamed.sequence, 11);
        assert_eq!(pi_streamed.payload["output"], "找到 3 个文件……");
        assert_eq!(pi_streamed.output_truncated, Some(false));

        let (pi_event_type, pi_terminal) = crate::pi::normalize_event(&json!({
            "type": "tool_execution_end",
            "toolCallId": "pi-streamed-result",
            "toolName": "grep",
            "args": {"query": "needle"},
            "isError": false
        }));
        let pi_terminal = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                pi_event_type,
                &pi_terminal,
            )
            .unwrap()
            .unwrap();
        assert!(!pi_terminal.inserted);
        assert_eq!(pi_terminal.id, pi_streamed.id);
        assert_eq!(pi_terminal.payload["output"], "找到 3 个文件……");
        assert_eq!(pi_terminal.output_truncated, Some(false));

        let snapshot_marker = "TERMINAL_SNAPSHOT_TAIL_MUST_NOT_PERSIST";
        let terminal_snapshot = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                "runtime.action",
                &json!({
                    "eventId": "pi-terminal-snapshot",
                    "toolCallId": "pi-streamed-result",
                    "toolName": "grep",
                    "status": "completed",
                    "kind": "read",
                    "output": format!("{}{snapshot_marker}", "s".repeat(7_680)),
                }),
            )
            .unwrap()
            .unwrap();
        let saved_terminal_snapshot = terminal_snapshot.payload["output"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            saved_terminal_snapshot.len(),
            PERSISTED_TOOL_OUTPUT_LIMIT_BYTES
        );
        assert!(!saved_terminal_snapshot.contains(snapshot_marker));
        assert_eq!(terminal_snapshot.output_truncated, Some(true));

        let terminal_metadata = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                "runtime.action",
                &json!({
                    "eventId": "pi-terminal-metadata",
                    "toolCallId": "pi-streamed-result",
                    "toolName": "grep",
                    "status": "completed",
                    "kind": "read",
                    "title": "completed without repeated output",
                }),
            )
            .unwrap()
            .unwrap();
        assert_eq!(terminal_metadata.payload["output"], saved_terminal_snapshot);
        assert_eq!(terminal_metadata.output_truncated, Some(true));

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
        assert_eq!(interrupted_started.sequence, 12);

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
        assert!(!context.rendered_payload.contains(discarded_output_marker));

        let run_version: i64 = database
            .connection()
            .query_row(
                "SELECT version FROM agent_run WHERE id = ?1",
                [&run_id],
                |row| row.get(0),
            )
            .unwrap();
        runtime
            .request_agent_run_cancellation(
                &mut database,
                &CommandEnvelope {
                    command_id: Uuid::new_v4().to_string(),
                    actor: ActorRef::User {
                        user_id: "test-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: CancelAgentRunCommand {
                        camp_id,
                        agent_run_id: run_id.clone(),
                        expected_version: run_version,
                    },
                },
            )
            .unwrap();
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
        assert_eq!(interrupted.id, interrupted_started.id);
        assert_eq!(interrupted.sequence, 12);
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
                    .record_runtime_event(
                        &mut database,
                        &blob_store,
                        &run_id,
                        execution_epoch,
                        "agent.text.delta",
                        &json!({"itemId": "message-3", "delta": delta}),
                    )
                    .unwrap()
            })
            .collect::<Vec<_>>();
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
        assert_eq!(failed.sequence, 13);
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
        assert!(!replay.inserted);
        assert_eq!(replay.id, failed.id);
        assert_eq!(replay.sequence, 13);
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
        assert!(!replay_duplicate.inserted);
        assert_eq!(replay_duplicate.id, replay.id);
        assert_eq!(replay_duplicate.sequence, 13);

        // Extend the existing durable fencing owner: only a registered ZCode
        // background identity may update its original completed epoch.
        database.connection().execute("UPDATE agent_run SET status = 'running', ended_at = NULL, cancel_requested_at = NULL, cancel_reason_code = NULL, runtime_adapter_kind = 'zcode-app' WHERE id = ?1", [&run_id]).unwrap();
        let mut identity = json!({"taskId":"bg-task", "toolCallId":"bg-tool", "inputId":"input",
            "turnId":"turn", "sessionId":"session", "hostInstanceId":"host", "nativePromptId":"prompt", "deliveryId":"delivery"});
        identity["identityDigest"] =
            json!(crate::command::canonical_json_digest(&identity).unwrap());
        identity["status"] = json!("running");
        let mut bg = json!({"eventId":"bg-start", "toolCallId":"bg-tool", "kind":"execute", "status":"in_progress", "zcodeBackground":identity});
        assert!(
            ExecutionEvidenceService
                .record_zcode_background_event(
                    &mut database,
                    &blob_store,
                    &run_id,
                    execution_epoch,
                    false,
                    &bg
                )
                .unwrap()
                .is_none()
        );
        // A stop request can race the native background registration. Evidence
        // survives that revocation; it grants no new Tool or bundled CLI lease.
        database.connection().execute("UPDATE agent_run SET cancel_requested_at = '2026-09-10T00:00:00Z', cancel_reason_code = 'test_cancel' WHERE id = ?1", [&run_id]).unwrap();
        let started = ExecutionEvidenceService
            .record_zcode_background_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                true,
                &bg,
            )
            .unwrap()
            .unwrap();
        assert_eq!(started.payload["zcodeBackground"]["taskId"], "bg-task");
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'succeeded', ended_at = '2026-09-10T00:00:00Z', cancel_requested_at = NULL, cancel_reason_code = NULL WHERE id = ?1",
                [&run_id],
            )
            .unwrap();
        bg["eventId"] = json!("bg-end");
        bg["status"] = json!("failed");
        bg["zcodeBackground"]["status"] = json!("failed");
        assert!(
            ExecutionEvidenceService
                .record_runtime_event(
                    &mut database,
                    &blob_store,
                    &run_id,
                    execution_epoch,
                    "runtime.action",
                    &bg
                )
                .unwrap()
                .is_none()
        );
        let mut foreign = bg.clone();
        foreign["zcodeBackground"]["turnId"] = json!("next-turn");
        assert!(
            ExecutionEvidenceService
                .record_zcode_background_event(
                    &mut database,
                    &blob_store,
                    &run_id,
                    execution_epoch,
                    false,
                    &foreign
                )
                .unwrap()
                .is_none()
        );
        assert!(
            ExecutionEvidenceService
                .record_zcode_background_event(
                    &mut database,
                    &blob_store,
                    &run_id,
                    execution_epoch + 1,
                    false,
                    &bg
                )
                .unwrap()
                .is_none()
        );
        let ended = ExecutionEvidenceService
            .record_zcode_background_event(
                &mut database,
                &blob_store,
                &run_id,
                execution_epoch,
                false,
                &bg,
            )
            .unwrap()
            .unwrap();
        assert_eq!(ended.agent_run_id, run_id);
        assert_eq!(ended.payload["status"], "failed");
        assert_eq!(ended.canonical.as_ref().unwrap().phase, "terminal");
        assert!(
            !ExecutionEvidenceService
                .record_zcode_background_event(
                    &mut database,
                    &blob_store,
                    &run_id,
                    execution_epoch,
                    false,
                    &bg
                )
                .unwrap()
                .unwrap()
                .inserted
        );
        database
            .connection()
            .execute(
                "UPDATE agent_run SET runtime_adapter_kind = 'grok-build' WHERE id = ?1",
                [&run_id],
            )
            .unwrap();
        assert!(
            ExecutionEvidenceService
                .record_zcode_background_event(
                    &mut database,
                    &blob_store,
                    &run_id,
                    execution_epoch,
                    false,
                    &bg
                )
                .unwrap()
                .is_none()
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
