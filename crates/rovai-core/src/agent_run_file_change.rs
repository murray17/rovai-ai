use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    db::Database,
    managed_blob::ManagedBlobStore,
    runtime_diff::{
        exact_mutation_fragment, normalize_reported_path_for_display, split_unified_diff_sections,
        unified_diff_counts, unified_diff_from_complete_states, unified_diff_section_identity,
    },
};

pub const AGENT_RUN_FILE_CHANGES_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunChangedFileSummaryView {
    pub path: String,
    pub change_kind: String,
    pub presentation_kind: String,
    pub operation_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additions: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunFileChangesView {
    pub schema_version: u32,
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub files: Vec<AgentRunChangedFileSummaryView>,
    pub file_count: u64,
    pub operation_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additions: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u64>,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunFileChangeBlockView {
    pub sequence: i64,
    pub semantics: String,
    pub change_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additions: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunChangedFileDetailView {
    pub path: String,
    pub change_kind: String,
    pub presentation_kind: String,
    pub operation_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additions: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<u64>,
    pub blocks: Vec<AgentRunFileChangeBlockView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunFileChangesDetailView {
    pub schema_version: u32,
    pub card: AgentRunFileChangesView,
    pub files: Vec<AgentRunChangedFileDetailView>,
}

#[derive(Debug, Clone)]
struct SequencedEvidence {
    id: String,
    sequence: i64,
    payload: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ObservedSemantics {
    FullBeforeAfter {
        before: Option<String>,
        after: Option<String>,
    },
    UnifiedDiffSnapshot {
        diff: String,
    },
    ExactMutation {
        old_text: String,
        new_text: String,
    },
    OperationOnly,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ObservedChange {
    sequence: i64,
    path: String,
    change_kind: String,
    semantics: ObservedSemantics,
}

#[derive(Debug)]
struct AggregatedProjection {
    details: AgentRunFileChangesDetailView,
    source_evidence_ids: Vec<String>,
}

#[derive(Debug, Default)]
pub struct AgentRunFileChangeProjector;

impl AgentRunFileChangeProjector {
    pub fn project_terminal_run(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<Option<AgentRunFileChangesView>> {
        if let Some(status) = load_projection_status(database, agent_run_id, execution_epoch)? {
            return match status.as_str() {
                "complete" => load_card(database, agent_run_id, execution_epoch),
                "no_changes" => Ok(None),
                _ => anyhow::bail!("AgentRun file-change projection has an invalid status"),
            };
        }
        let terminal = database
            .connection()
            .query_row(
                r#"
                SELECT agent_run.status, agent_run.ended_at, agent_run.workspace_json
                FROM agent_run
                WHERE agent_run.id = ?1 AND agent_run.execution_epoch = ?2
                "#,
                params![agent_run_id, execution_epoch],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()?;
        let Some((status, completed_at, workspace_json)) = terminal else {
            return Ok(None);
        };
        if !matches!(status.as_str(), "succeeded" | "failed" | "cancelled") {
            return Ok(None);
        }
        let completed_at = completed_at.context("terminal AgentRun has no ended_at")?;
        let execution_root = workspace_json
            .as_deref()
            .and_then(|workspace| serde_json::from_str::<Value>(workspace).ok())
            .and_then(|workspace| {
                workspace
                    .get("executionRoot")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .context("terminal AgentRun has no frozen execution root")?;
        let evidence = load_full_evidence(database, blob_store, agent_run_id, execution_epoch)?;
        let Some(mut projection) = aggregate_evidence(
            agent_run_id,
            execution_epoch,
            &completed_at,
            Path::new(&execution_root),
            &evidence,
        ) else {
            insert_no_changes_projection(database, agent_run_id, execution_epoch, &completed_at)?;
            return Ok(None);
        };
        projection.details.card.completed_at = completed_at.clone();
        let encoded = serde_json::to_vec(&projection.details)?;
        let blob = blob_store.put_bytes(
            database,
            &encoded,
            "application/vnd.rovai.agent-run-file-changes+json",
            "sensitive",
        )?;
        let summary_json = serde_json::to_string(&projection.details.card.files)?;
        let source_evidence_ids_json = serde_json::to_string(&projection.source_evidence_ids)?;
        let now = chrono::Utc::now().to_rfc3339();
        database.connection().execute(
            r#"
            INSERT OR IGNORE INTO agent_run_file_change_projection(
                agent_run_id, execution_epoch, schema_version, status,
                file_count, operation_count, additions, deletions,
                files_summary_json, details_blob_id,
                source_evidence_ids_json, completed_at, created_at
            ) VALUES (?1, ?2, ?3, 'complete', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
            params![
                agent_run_id,
                execution_epoch,
                i64::from(AGENT_RUN_FILE_CHANGES_SCHEMA_VERSION),
                projection.details.card.file_count as i64,
                projection.details.card.operation_count as i64,
                projection.details.card.additions.map(|value| value as i64),
                projection.details.card.deletions.map(|value| value as i64),
                summary_json,
                blob.id,
                source_evidence_ids_json,
                completed_at,
                now,
            ],
        )?;
        load_card(database, agent_run_id, execution_epoch)
    }

    pub fn recover_terminal_runs(
        &self,
        database: &mut Database,
        blob_store: &ManagedBlobStore,
    ) -> Result<usize> {
        let candidates = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT agent_run.id, agent_run.execution_epoch
                FROM agent_run
                WHERE agent_run.status IN ('succeeded', 'failed', 'cancelled')
                  AND NOT EXISTS (
                      SELECT 1 FROM agent_run_file_change_projection AS projection
                      WHERE projection.agent_run_id = agent_run.id
                        AND projection.execution_epoch = agent_run.execution_epoch
                  )
                  AND EXISTS (
                      SELECT 1 FROM agent_run_execution_evidence AS evidence
                      WHERE evidence.agent_run_id = agent_run.id
                        AND evidence.execution_epoch = agent_run.execution_epoch
                  )
                ORDER BY agent_run.ended_at, agent_run.id
                "#,
            )?;
            statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut recovered = 0_usize;
        for (agent_run_id, execution_epoch) in candidates {
            if self
                .project_terminal_run(database, blob_store, &agent_run_id, execution_epoch)?
                .is_some()
            {
                recovered = recovered.saturating_add(1);
            }
        }
        Ok(recovered)
    }
}

pub fn list_completed_run_file_changes(
    connection: &rusqlite::Connection,
    camp_id: &str,
) -> Result<Vec<AgentRunFileChangesView>> {
    let mut statement = connection.prepare(
        r#"
        SELECT projection.agent_run_id, projection.execution_epoch,
               projection.file_count, projection.operation_count,
               projection.additions, projection.deletions,
               projection.files_summary_json, projection.completed_at
        FROM agent_run_file_change_projection AS projection
        JOIN agent_run ON agent_run.id = projection.agent_run_id
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        WHERE camp_turn.camp_id = ?1
          AND projection.status = 'complete'
        ORDER BY projection.completed_at, projection.agent_run_id, projection.execution_epoch
        "#,
    )?;
    statement
        .query_map([camp_id], card_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

pub fn read_run_file_changes(
    database: &Database,
    blob_store: &ManagedBlobStore,
    camp_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
) -> Result<AgentRunFileChangesDetailView> {
    let blob_id = database
        .connection()
        .query_row(
            r#"
            SELECT projection.details_blob_id
            FROM agent_run_file_change_projection AS projection
            JOIN agent_run ON agent_run.id = projection.agent_run_id
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE projection.agent_run_id = ?1
              AND projection.execution_epoch = ?2
              AND camp_turn.camp_id = ?3
              AND projection.status = 'complete'
            "#,
            params![agent_run_id, execution_epoch, camp_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .context("AgentRun file changes do not exist in this Camp")?;
    let bytes = blob_store.read_bytes(database, &blob_id)?;
    let detail = serde_json::from_slice::<AgentRunFileChangesDetailView>(&bytes)
        .context("AgentRun file changes are not valid JSON")?;
    if detail.schema_version != AGENT_RUN_FILE_CHANGES_SCHEMA_VERSION
        || detail.card.agent_run_id != agent_run_id
        || detail.card.execution_epoch != execution_epoch
    {
        anyhow::bail!("AgentRun file changes identity is invalid");
    }
    Ok(detail)
}

fn load_card(
    database: &Database,
    agent_run_id: &str,
    execution_epoch: i64,
) -> Result<Option<AgentRunFileChangesView>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT agent_run_id, execution_epoch, file_count, operation_count,
                   additions, deletions, files_summary_json, completed_at
            FROM agent_run_file_change_projection
            WHERE agent_run_id = ?1 AND execution_epoch = ?2 AND status = 'complete'
            "#,
            params![agent_run_id, execution_epoch],
            card_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn load_projection_status(
    database: &Database,
    agent_run_id: &str,
    execution_epoch: i64,
) -> Result<Option<String>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT status
            FROM agent_run_file_change_projection
            WHERE agent_run_id = ?1 AND execution_epoch = ?2
            "#,
            params![agent_run_id, execution_epoch],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

fn insert_no_changes_projection(
    database: &Database,
    agent_run_id: &str,
    execution_epoch: i64,
    completed_at: &str,
) -> Result<()> {
    database.connection().execute(
        r#"
        INSERT OR IGNORE INTO agent_run_file_change_projection(
            agent_run_id, execution_epoch, schema_version, status,
            file_count, operation_count, additions, deletions,
            files_summary_json, details_blob_id,
            source_evidence_ids_json, completed_at, created_at
        ) VALUES (?1, ?2, ?3, 'no_changes', 0, 0, NULL, NULL, '[]', NULL, '[]', ?4, ?5)
        "#,
        params![
            agent_run_id,
            execution_epoch,
            i64::from(AGENT_RUN_FILE_CHANGES_SCHEMA_VERSION),
            completed_at,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn card_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentRunFileChangesView> {
    let files_json = row.get::<_, String>(6)?;
    let files = serde_json::from_str(&files_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            files_json.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;
    Ok(AgentRunFileChangesView {
        schema_version: AGENT_RUN_FILE_CHANGES_SCHEMA_VERSION,
        agent_run_id: row.get(0)?,
        execution_epoch: row.get(1)?,
        file_count: row.get::<_, i64>(2)? as u64,
        operation_count: row.get::<_, i64>(3)? as u64,
        additions: row.get::<_, Option<i64>>(4)?.map(|value| value as u64),
        deletions: row.get::<_, Option<i64>>(5)?.map(|value| value as u64),
        files,
        completed_at: row.get(7)?,
    })
}

fn load_full_evidence(
    database: &Database,
    blob_store: &ManagedBlobStore,
    agent_run_id: &str,
    execution_epoch: i64,
) -> Result<Vec<SequencedEvidence>> {
    let rows = {
        let mut statement = database.connection().prepare(
            r#"
            SELECT id, sequence, payload_preview_json, content_blob_id
            FROM agent_run_execution_evidence
            WHERE agent_run_id = ?1 AND execution_epoch = ?2
            ORDER BY sequence, id
            "#,
        )?;
        statement
            .query_map(params![agent_run_id, execution_epoch], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    rows.into_iter()
        .map(|(id, sequence, preview, blob_id)| {
            let bytes = match blob_id {
                Some(blob_id) => blob_store.read_bytes(database, &blob_id)?,
                None => preview.into_bytes(),
            };
            Ok(SequencedEvidence {
                id,
                sequence,
                payload: serde_json::from_slice(&bytes)
                    .context("Execution Evidence payload is not valid JSON")?,
            })
        })
        .collect()
}

fn aggregate_evidence(
    agent_run_id: &str,
    execution_epoch: i64,
    completed_at: &str,
    execution_root: &Path,
    evidence: &[SequencedEvidence],
) -> Option<AggregatedProjection> {
    let mut changes = Vec::new();
    let mut latest_run_snapshot: Option<(i64, String)> = None;
    let mut source_evidence_ids = Vec::new();
    for item in evidence {
        if let Some(diff) = item
            .payload
            .pointer("/runtimeRunDiff/diff")
            .and_then(Value::as_str)
            .filter(|_| {
                item.payload
                    .pointer("/runtimeRunDiff/status")
                    .and_then(Value::as_str)
                    == Some("available")
            })
        {
            latest_run_snapshot = Some((item.sequence, diff.to_string()));
            source_evidence_ids.push(item.id.clone());
        }
        let before = changes.len();
        append_diff_changes(&mut changes, item.sequence, execution_root, &item.payload);
        append_operation_only_change(&mut changes, item.sequence, execution_root, &item.payload);
        if changes.len() != before {
            source_evidence_ids.push(item.id.clone());
        }
    }
    source_evidence_ids.sort();
    source_evidence_ids.dedup();

    let observed_counts = operation_counts_by_path(&changes);
    let files = match latest_run_snapshot {
        Some((sequence, diff)) => file_details_with_authoritative_snapshot(
            sequence,
            execution_root,
            &diff,
            changes,
            &observed_counts,
        ),
        None => file_details_from_operations(changes),
    };
    if files.is_empty() {
        return None;
    }
    let all_files_have_counts = files
        .iter()
        .all(|file| file.additions.is_some() && file.deletions.is_some());
    let (additions, deletions) = if all_files_have_counts {
        sum_known_counts(files.iter().map(|file| (file.additions, file.deletions)))
    } else {
        (None, None)
    };
    let operation_count = files
        .iter()
        .map(|file| file.operation_count)
        .fold(0_u64, u64::saturating_add);
    let summaries = files
        .iter()
        .map(|file| AgentRunChangedFileSummaryView {
            path: file.path.clone(),
            change_kind: file.change_kind.clone(),
            presentation_kind: file.presentation_kind.clone(),
            operation_count: file.operation_count,
            additions: file.additions,
            deletions: file.deletions,
        })
        .collect::<Vec<_>>();
    let card = AgentRunFileChangesView {
        schema_version: AGENT_RUN_FILE_CHANGES_SCHEMA_VERSION,
        agent_run_id: agent_run_id.to_string(),
        execution_epoch,
        file_count: summaries.len() as u64,
        operation_count,
        additions,
        deletions,
        files: summaries,
        completed_at: completed_at.to_string(),
    };
    Some(AggregatedProjection {
        details: AgentRunFileChangesDetailView {
            schema_version: AGENT_RUN_FILE_CHANGES_SCHEMA_VERSION,
            card,
            files,
        },
        source_evidence_ids,
    })
}

fn append_diff_changes(
    changes: &mut Vec<ObservedChange>,
    sequence: i64,
    execution_root: &Path,
    payload: &Value,
) {
    let Some(diff) = payload.get("runtimeDiff") else {
        return;
    };
    if diff.get("status").and_then(Value::as_str) != Some("available") {
        return;
    }
    let Some(entries) = diff.get("entries").and_then(Value::as_array) else {
        return;
    };
    let single_operation_path = (entries.len() == 1)
        .then(|| normalized_file_operation_path(payload, execution_root))
        .flatten();
    for entry in entries {
        let Some(raw_path) = entry.get("path").and_then(Value::as_str) else {
            continue;
        };
        let Some(path) = single_operation_path
            .clone()
            .or_else(|| normalize_reported_path_for_display(execution_root, raw_path))
        else {
            continue;
        };
        let semantics = entry
            .get("semantics")
            .and_then(Value::as_str)
            .or_else(|| diff.get("semanticKind").and_then(Value::as_str));
        let observed = match semantics {
            Some("full_before_after" | "complete_before_after") => {
                let Some(before) =
                    optional_text(entry.get("before").or_else(|| entry.get("oldText")))
                else {
                    continue;
                };
                let Some(after) =
                    optional_text(entry.get("after").or_else(|| entry.get("newText")))
                else {
                    continue;
                };
                if before == after {
                    continue;
                }
                let change_kind = normalized_change_kind(entry, &before, &after);
                ObservedChange {
                    sequence,
                    path,
                    change_kind,
                    semantics: ObservedSemantics::FullBeforeAfter { before, after },
                }
            }
            Some("unified_diff_snapshot" | "codex_file_change_snapshot") => {
                let Some(diff) = entry.get("diff").and_then(Value::as_str) else {
                    continue;
                };
                if diff.is_empty() {
                    continue;
                }
                ObservedChange {
                    sequence,
                    path,
                    change_kind: entry
                        .get("changeKind")
                        .and_then(Value::as_str)
                        .unwrap_or("update")
                        .to_string(),
                    semantics: ObservedSemantics::UnifiedDiffSnapshot {
                        diff: diff.to_string(),
                    },
                }
            }
            Some("exact_mutation") => {
                let Some(old_text) = entry
                    .get("oldText")
                    .or_else(|| entry.get("oldFragment"))
                    .and_then(Value::as_str)
                else {
                    continue;
                };
                let Some(new_text) = entry
                    .get("newText")
                    .or_else(|| entry.get("newFragment"))
                    .and_then(Value::as_str)
                else {
                    continue;
                };
                if old_text == new_text {
                    continue;
                }
                ObservedChange {
                    sequence,
                    path,
                    change_kind: "update".to_string(),
                    semantics: ObservedSemantics::ExactMutation {
                        old_text: old_text.to_string(),
                        new_text: new_text.to_string(),
                    },
                }
            }
            _ => continue,
        };
        changes.push(observed);
    }
}

fn append_operation_only_change(
    changes: &mut Vec<ObservedChange>,
    sequence: i64,
    execution_root: &Path,
    payload: &Value,
) {
    if payload
        .pointer("/runtimeDiff/status")
        .and_then(Value::as_str)
        == Some("unavailable")
        && payload
            .pointer("/runtimeDiff/safeReasonCode")
            .and_then(Value::as_str)
            == Some("runtime_diff_no_changes")
    {
        return;
    }
    let Some(operation) = payload.get("runtimeFileOperation") else {
        return;
    };
    let Some(path) = normalized_file_operation_path(payload, execution_root) else {
        return;
    };
    if changes
        .iter()
        .rev()
        .take_while(|change| change.sequence == sequence)
        .any(|change| change.path == path)
    {
        return;
    }
    changes.push(ObservedChange {
        sequence,
        path,
        change_kind: operation
            .get("changeKind")
            .and_then(Value::as_str)
            .unwrap_or("update")
            .to_string(),
        semantics: ObservedSemantics::OperationOnly,
    });
}

fn normalized_file_operation_path(payload: &Value, execution_root: &Path) -> Option<String> {
    let operation = payload.get("runtimeFileOperation")?;
    if operation.get("status").and_then(Value::as_str) != Some("available") {
        return None;
    }
    let raw_path = operation.get("path").and_then(Value::as_str)?;
    normalize_reported_path_for_display(execution_root, raw_path)
}

fn optional_text(value: Option<&Value>) -> Option<Option<String>> {
    match value {
        None | Some(Value::Null) => Some(None),
        Some(Value::String(text)) => Some(Some(text.clone())),
        Some(_) => None,
    }
}

fn normalized_change_kind(
    entry: &Value,
    before: &Option<String>,
    after: &Option<String>,
) -> String {
    entry
        .get("changeKind")
        .and_then(Value::as_str)
        .filter(|kind| matches!(*kind, "add" | "update" | "delete"))
        .unwrap_or(match (before, after) {
            (None, Some(_)) => "add",
            (Some(_), None) => "delete",
            _ => "update",
        })
        .to_string()
}

fn operation_counts_by_path(changes: &[ObservedChange]) -> BTreeMap<String, u64> {
    let mut counts = BTreeMap::new();
    for change in changes {
        *counts.entry(change.path.clone()).or_default() += 1;
    }
    counts
}

fn file_details_from_operations(
    changes: Vec<ObservedChange>,
) -> Vec<AgentRunChangedFileDetailView> {
    let mut by_path = BTreeMap::<String, Vec<ObservedChange>>::new();
    for change in changes {
        by_path.entry(change.path.clone()).or_default().push(change);
    }
    by_path
        .into_iter()
        .filter_map(|(path, mut operations)| {
            operations.sort_by_key(|operation| operation.sequence);
            file_detail_from_operations(path, operations)
        })
        .collect()
}

fn file_detail_from_operations(
    path: String,
    operations: Vec<ObservedChange>,
) -> Option<AgentRunChangedFileDetailView> {
    let operation_count = operations.len() as u64;
    let operation_only = operations
        .iter()
        .filter(|operation| matches!(operation.semantics, ObservedSemantics::OperationOnly))
        .cloned()
        .collect::<Vec<_>>();
    let diff_operations = operations
        .iter()
        .filter(|operation| !matches!(operation.semantics, ObservedSemantics::OperationOnly))
        .cloned()
        .collect::<Vec<_>>();
    if diff_operations.is_empty() {
        return Some(AgentRunChangedFileDetailView {
            path,
            change_kind: combined_change_kind(&operations),
            presentation_kind: "operation_only".to_string(),
            operation_count,
            additions: None,
            deletions: None,
            blocks: operations.iter().map(operation_block).collect(),
        });
    }
    let Some(mut detail) = file_detail_from_diff_operations(path.clone(), diff_operations) else {
        if operation_only.is_empty() {
            return None;
        }
        return Some(AgentRunChangedFileDetailView {
            path,
            change_kind: combined_change_kind(&operation_only),
            presentation_kind: "operation_only".to_string(),
            operation_count,
            additions: None,
            deletions: None,
            blocks: operation_only.iter().map(operation_block).collect(),
        });
    };
    if !operation_only.is_empty() {
        return Some(AgentRunChangedFileDetailView {
            path,
            change_kind: combined_change_kind(&operations),
            presentation_kind: "operation_history".to_string(),
            operation_count,
            additions: detail.additions,
            deletions: detail.deletions,
            blocks: operations.iter().map(operation_block).collect(),
        });
    }
    detail.operation_count = operation_count;
    Some(detail)
}

fn file_detail_from_diff_operations(
    path: String,
    operations: Vec<ObservedChange>,
) -> Option<AgentRunChangedFileDetailView> {
    if operations.iter().all(|operation| {
        matches!(
            operation.semantics,
            ObservedSemantics::FullBeforeAfter { .. }
        )
    }) {
        return continuous_full_state_detail(path, operations);
    }
    if operations.len() == 1
        && matches!(
            operations[0].semantics,
            ObservedSemantics::UnifiedDiffSnapshot { .. }
        )
    {
        let operation = &operations[0];
        let ObservedSemantics::UnifiedDiffSnapshot { diff } = &operation.semantics else {
            unreachable!();
        };
        let (additions, deletions) = unified_diff_counts(diff);
        return Some(AgentRunChangedFileDetailView {
            path,
            change_kind: operation.change_kind.clone(),
            presentation_kind: "full_net_diff".to_string(),
            operation_count: 1,
            additions: Some(additions),
            deletions: Some(deletions),
            blocks: vec![AgentRunFileChangeBlockView {
                sequence: operation.sequence,
                semantics: "full_net_diff".to_string(),
                change_kind: operation.change_kind.clone(),
                additions: Some(additions),
                deletions: Some(deletions),
                diff: Some(diff.clone()),
            }],
        });
    }
    let exact_only = operations
        .iter()
        .all(|operation| matches!(operation.semantics, ObservedSemantics::ExactMutation { .. }));
    let change_kind = combined_change_kind(&operations);
    let blocks = operations.iter().map(operation_block).collect::<Vec<_>>();
    let (additions, deletions) = sum_known_counts(
        blocks
            .iter()
            .map(|block| (block.additions, block.deletions)),
    );
    Some(AgentRunChangedFileDetailView {
        path,
        change_kind,
        presentation_kind: if exact_only {
            "exact_mutations"
        } else {
            "operation_history"
        }
        .to_string(),
        operation_count: operations.len() as u64,
        additions,
        deletions,
        blocks,
    })
}

fn continuous_full_state_detail(
    path: String,
    operations: Vec<ObservedChange>,
) -> Option<AgentRunChangedFileDetailView> {
    let first = operations.first()?;
    let ObservedSemantics::FullBeforeAfter {
        before: baseline,
        after: first_after,
    } = &first.semantics
    else {
        return None;
    };
    let mut current = first_after.clone();
    let mut continuous = true;
    for operation in operations.iter().skip(1) {
        let ObservedSemantics::FullBeforeAfter { before, after } = &operation.semantics else {
            continuous = false;
            break;
        };
        if before != &current {
            continuous = false;
            break;
        }
        current = after.clone();
    }
    if !continuous {
        let change_kind = combined_change_kind(&operations);
        let blocks = operations.iter().map(operation_block).collect::<Vec<_>>();
        let (additions, deletions) = sum_known_counts(
            blocks
                .iter()
                .map(|block| (block.additions, block.deletions)),
        );
        return Some(AgentRunChangedFileDetailView {
            path,
            change_kind,
            presentation_kind: "operation_history".to_string(),
            operation_count: operations.len() as u64,
            additions,
            deletions,
            blocks,
        });
    }
    if baseline == &current {
        return None;
    }
    let change_kind = match (baseline, &current) {
        (None, Some(_)) => "add",
        (Some(_), None) => "delete",
        _ => "update",
    }
    .to_string();
    let diff = unified_diff_from_complete_states(&path, baseline.as_deref(), current.as_deref())?;
    let (additions, deletions) = unified_diff_counts(&diff);
    Some(AgentRunChangedFileDetailView {
        path,
        change_kind: change_kind.clone(),
        presentation_kind: "full_net_diff".to_string(),
        operation_count: operations.len() as u64,
        additions: Some(additions),
        deletions: Some(deletions),
        blocks: vec![AgentRunFileChangeBlockView {
            sequence: first.sequence,
            semantics: "full_net_diff".to_string(),
            change_kind,
            additions: Some(additions),
            deletions: Some(deletions),
            diff: Some(diff),
        }],
    })
}

fn operation_block(operation: &ObservedChange) -> AgentRunFileChangeBlockView {
    let (semantics, diff) = match &operation.semantics {
        ObservedSemantics::FullBeforeAfter { before, after } => (
            "full_before_after",
            unified_diff_from_complete_states(&operation.path, before.as_deref(), after.as_deref()),
        ),
        ObservedSemantics::UnifiedDiffSnapshot { diff } => {
            ("unified_diff_snapshot", Some(diff.clone()))
        }
        ObservedSemantics::ExactMutation { old_text, new_text } => (
            "exact_mutation",
            Some(exact_mutation_fragment(old_text, new_text)),
        ),
        ObservedSemantics::OperationOnly => ("operation_only", None),
    };
    let (additions, deletions) = diff
        .as_deref()
        .map(unified_diff_counts)
        .map_or((None, None), |(additions, deletions)| {
            (Some(additions), Some(deletions))
        });
    AgentRunFileChangeBlockView {
        sequence: operation.sequence,
        semantics: semantics.to_string(),
        change_kind: operation.change_kind.clone(),
        additions,
        deletions,
        diff,
    }
}

fn sum_known_counts(
    counts: impl IntoIterator<Item = (Option<u64>, Option<u64>)>,
) -> (Option<u64>, Option<u64>) {
    let mut found = false;
    let mut additions = 0_u64;
    let mut deletions = 0_u64;
    for (known_additions, known_deletions) in counts {
        if let (Some(known_additions), Some(known_deletions)) = (known_additions, known_deletions) {
            found = true;
            additions = additions.saturating_add(known_additions);
            deletions = deletions.saturating_add(known_deletions);
        }
    }
    if found {
        (Some(additions), Some(deletions))
    } else {
        (None, None)
    }
}

fn combined_change_kind(operations: &[ObservedChange]) -> String {
    let kinds = operations
        .iter()
        .map(|operation| operation.change_kind.as_str())
        .collect::<BTreeSet<_>>();
    if kinds.len() == 1 {
        kinds.into_iter().next().unwrap_or("update").to_string()
    } else {
        "update".to_string()
    }
}

fn file_details_from_authoritative_snapshot(
    sequence: i64,
    execution_root: &Path,
    diff: &str,
    observed_counts: &BTreeMap<String, u64>,
) -> Option<Vec<AgentRunChangedFileDetailView>> {
    let sections = split_unified_diff_sections(diff);
    if sections.is_empty() {
        return None;
    }
    let mut files = Vec::new();
    for section in sections {
        let (raw_path, change_kind) = unified_diff_section_identity(&section)?;
        let path = normalize_reported_path_for_display(execution_root, &raw_path)?;
        let (additions, deletions) = unified_diff_counts(&section);
        let operation_count = observed_counts.get(&path).copied().unwrap_or(1);
        files.push(AgentRunChangedFileDetailView {
            path,
            change_kind: change_kind.clone(),
            presentation_kind: "full_net_diff".to_string(),
            operation_count,
            additions: Some(additions),
            deletions: Some(deletions),
            blocks: vec![AgentRunFileChangeBlockView {
                sequence,
                semantics: "full_net_diff".to_string(),
                change_kind,
                additions: Some(additions),
                deletions: Some(deletions),
                diff: Some(section),
            }],
        });
    }
    Some(files)
}

fn file_details_with_authoritative_snapshot(
    sequence: i64,
    execution_root: &Path,
    diff: &str,
    changes: Vec<ObservedChange>,
    observed_counts: &BTreeMap<String, u64>,
) -> Vec<AgentRunChangedFileDetailView> {
    let outside_operations = changes
        .iter()
        .filter(|change| Path::new(&change.path).is_absolute())
        .cloned()
        .collect::<Vec<_>>();
    if diff.trim().is_empty() {
        return file_details_from_operations(outside_operations);
    }
    let Some(mut snapshot_files) =
        file_details_from_authoritative_snapshot(sequence, execution_root, diff, observed_counts)
    else {
        return file_details_from_operations(changes);
    };
    let snapshot_paths = snapshot_files
        .iter()
        .map(|file| file.path.clone())
        .collect::<BTreeSet<_>>();
    let missing_outside_operations = outside_operations
        .into_iter()
        .filter(|change| !snapshot_paths.contains(&change.path))
        .collect::<Vec<_>>();
    snapshot_files.extend(file_details_from_operations(missing_outside_operations));
    snapshot_files
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution_evidence::ExecutionEvidenceService;
    use serde_json::json;
    use uuid::Uuid;

    fn evidence(sequence: i64, payload: Value) -> SequencedEvidence {
        SequencedEvidence {
            id: format!("evidence-{sequence}"),
            sequence,
            payload,
        }
    }

    fn full(sequence: i64, before: Option<&str>, after: Option<&str>) -> SequencedEvidence {
        full_at(sequence, "src/app.ts", before, after)
    }

    fn full_at(
        sequence: i64,
        path: &str,
        before: Option<&str>,
        after: Option<&str>,
    ) -> SequencedEvidence {
        evidence(
            sequence,
            json!({
                "runtimeDiff": {
                    "status": "available",
                    "semanticKind": "complete_before_after",
                    "entries": [{
                        "semantics": "full_before_after",
                        "path": path,
                        "changeKind": "update",
                        "before": before,
                        "after": after
                    }]
                }
            }),
        )
    }

    #[test]
    fn continuous_full_states_form_one_net_diff() {
        let projection = aggregate_evidence(
            "run-1",
            1,
            "2026-08-27T00:00:00Z",
            Path::new("/repo"),
            &[
                full(1, Some("A\n"), Some("B\n")),
                full(2, Some("B\n"), Some("C\n")),
            ],
        )
        .expect("continuous changes should project");

        let file = &projection.details.files[0];
        assert_eq!(file.presentation_kind, "full_net_diff");
        assert_eq!(file.operation_count, 2);
        let diff = file.blocks[0].diff.as_deref().unwrap();
        assert!(diff.contains("-A"));
        assert!(diff.contains("+C"));
        assert!(!diff.contains("-B"));
    }

    #[test]
    fn full_state_round_trip_removes_the_file_from_the_card() {
        assert!(
            aggregate_evidence(
                "run-1",
                1,
                "2026-08-27T00:00:00Z",
                Path::new("/repo"),
                &[
                    full(1, Some("A\n"), Some("B\n")),
                    full(2, Some("B\n"), Some("A\n"))
                ],
            )
            .is_none()
        );
    }

    #[test]
    fn discontinuous_full_states_degrade_only_that_file_to_operation_history() {
        let projection = aggregate_evidence(
            "run-1",
            1,
            "2026-08-27T00:00:00Z",
            Path::new("/repo"),
            &[
                full(1, Some("A\n"), Some("B\n")),
                full(2, Some("X\n"), Some("C\n")),
            ],
        )
        .unwrap();
        let file = &projection.details.files[0];
        assert_eq!(file.presentation_kind, "operation_history");
        assert_eq!(file.blocks.len(), 2);
        assert_eq!(file.additions, Some(2));
        assert_eq!(file.deletions, Some(2));
        assert_eq!(projection.details.card.additions, Some(2));
        assert_eq!(projection.details.card.deletions, Some(2));
    }

    #[test]
    fn exact_mutations_remain_chronological_fragments_with_known_totals() {
        let projection = aggregate_evidence(
            "run-1",
            1,
            "2026-08-27T00:00:00Z",
            Path::new("/repo"),
            &[
                evidence(1, json!({"runtimeDiff": {"status": "available", "semanticKind": "exact_mutation", "entries": [{"semantics": "exact_mutation", "path": "src/app.ts", "oldText": "A", "newText": "B"}]}})),
                evidence(2, json!({"runtimeDiff": {"status": "available", "semanticKind": "exact_mutation", "entries": [{"semantics": "exact_mutation", "path": "src/app.ts", "oldText": "B", "newText": "C"}]}})),
            ],
        )
        .unwrap();
        let file = &projection.details.files[0];
        assert_eq!(file.presentation_kind, "exact_mutations");
        assert_eq!(file.blocks.len(), 2);
        assert_eq!(file.blocks[0].diff.as_deref(), Some("-A\n+B\n"));
        assert_eq!(file.blocks[1].diff.as_deref(), Some("-B\n+C\n"));
        assert_eq!(file.additions, Some(2));
        assert_eq!(file.deletions, Some(2));
        assert_eq!(projection.details.card.additions, Some(2));
        assert_eq!(projection.details.card.deletions, Some(2));
    }

    #[test]
    fn path_only_operation_stays_counted_while_reliable_diffs_form_the_file_totals() {
        let projection = aggregate_evidence(
            "run-qoder",
            1,
            "2026-08-28T00:00:00Z",
            Path::new("/repo"),
            &[
                evidence(
                    1,
                    json!({
                        "runtimeFileOperation": {
                            "status": "available",
                            "path": "src/app.ts",
                            "changeKind": "update"
                        }
                    }),
                ),
                full(2, Some("state=pending"), Some("state=completed")),
                evidence(
                    3,
                    json!({
                        "runtimeFileOperation": {
                            "status": "available",
                            "path": "src/worker.ts",
                            "changeKind": "update"
                        }
                    }),
                ),
                full_at(
                    4,
                    "src/worker.ts",
                    Some("phase=queued\nmode=safe\n"),
                    Some("phase=done\n"),
                ),
            ],
        )
        .expect("the reliable Qoder edit should remain reviewable");

        assert_eq!(projection.details.files.len(), 2);
        for file in &projection.details.files {
            assert_eq!(file.presentation_kind, "operation_history");
            assert_eq!(file.operation_count, 2);
            assert_eq!(file.blocks.len(), 2);
            assert_eq!(file.blocks[0].semantics, "operation_only");
            assert!(file.blocks[0].diff.is_none());
            assert_eq!(file.blocks[1].semantics, "full_before_after");
            assert!(file.blocks[1].diff.is_some());
        }
        assert_eq!(projection.details.files[0].additions, Some(1));
        assert_eq!(projection.details.files[0].deletions, Some(1));
        assert_eq!(projection.details.files[1].additions, Some(1));
        assert_eq!(projection.details.files[1].deletions, Some(2));
        assert_eq!(projection.details.card.operation_count, 4);
        assert_eq!(projection.details.card.additions, Some(2));
        assert_eq!(projection.details.card.deletions, Some(3));
    }

    #[test]
    fn operation_only_path_creates_a_card_without_diff_or_counts() {
        let projection = aggregate_evidence(
            "run-1",
            1,
            "2026-08-27T00:00:00Z",
            Path::new("/repo"),
            &[evidence(1, json!({"runtimeFileOperation": {"status": "available", "path": "src/app.ts", "changeKind": "update"}}))],
        )
        .unwrap();
        let file = &projection.details.files[0];
        assert_eq!(file.presentation_kind, "operation_only");
        assert!(file.blocks[0].diff.is_none());
        assert_eq!(projection.details.card.additions, None);
    }

    #[test]
    fn managed_output_unavailable_evidence_does_not_create_a_files_changed_card() {
        assert!(
            aggregate_evidence(
                "run-1",
                1,
                "2026-08-28T00:00:00Z",
                Path::new("/repo"),
                &[evidence(
                    1,
                    json!({
                        "runtimeFileOperation": {
                            "status": "unavailable",
                            "safeReasonCode": "runtime_file_operation_managed_output_root"
                        },
                        "runtimeDiff": {
                            "status": "unavailable",
                            "safeReasonCode": "runtime_diff_managed_output_root"
                        }
                    }),
                )],
            )
            .is_none()
        );
    }

    #[test]
    fn one_operation_only_file_keeps_the_whole_card_on_operation_counts() {
        let projection = aggregate_evidence(
            "run-1",
            1,
            "2026-08-28T00:00:00Z",
            Path::new("/repo"),
            &[
                full(1, Some("A\n"), Some("B\n")),
                evidence(
                    2,
                    json!({
                        "runtimeFileOperation": {
                            "status": "available",
                            "path": "src/path-only.ts",
                            "changeKind": "update"
                        }
                    }),
                ),
            ],
        )
        .expect("both observed files should remain in the card");

        assert_eq!(projection.details.card.file_count, 2);
        assert_eq!(projection.details.card.operation_count, 2);
        assert_eq!(projection.details.card.additions, None);
        assert_eq!(projection.details.card.deletions, None);
    }

    #[test]
    fn explicit_runtime_no_change_does_not_fall_back_to_operation_only() {
        assert!(
            aggregate_evidence(
                "run-1",
                1,
                "2026-08-28T00:00:00Z",
                Path::new("/repo"),
                &[evidence(
                    1,
                    json!({
                        "runtimeDiff": {
                            "status": "unavailable",
                            "safeReasonCode": "runtime_diff_no_changes"
                        },
                        "runtimeFileOperation": {
                            "status": "available",
                            "path": "src/app.ts",
                            "changeKind": "update"
                        }
                    }),
                )],
            )
            .is_none(),
            "an explicit no-change result must not become a Files Changed card"
        );
    }

    #[test]
    fn explicit_runtime_no_change_is_omitted_from_a_mixed_card() {
        let projection = aggregate_evidence(
            "run-1",
            1,
            "2026-08-28T00:00:00Z",
            Path::new("/repo"),
            &[
                full(1, Some("A\n"), Some("B\n")),
                evidence(
                    2,
                    json!({
                        "runtimeDiff": {
                            "status": "unavailable",
                            "safeReasonCode": "runtime_diff_no_changes"
                        },
                        "runtimeFileOperation": {
                            "status": "available",
                            "path": "src/unchanged.ts",
                            "changeKind": "update"
                        }
                    }),
                ),
            ],
        )
        .unwrap();

        assert_eq!(projection.details.card.file_count, 1);
        assert_eq!(projection.details.files[0].path, "src/app.ts");
        assert_eq!(projection.details.card.additions, Some(1));
        assert_eq!(projection.details.card.deletions, Some(1));
    }

    #[test]
    fn single_terminal_diff_uses_the_matching_file_operation_path_identity() {
        for (diff_path, operation_path) in [
            (
                "/private/tmp/rovai-outside/outside-alpha.txt",
                "/tmp/rovai-outside/outside-alpha.txt",
            ),
            ("outside-alpha.txt", "/tmp/rovai-outside/outside-alpha.txt"),
        ] {
            let projection = aggregate_evidence(
                "run-1",
                1,
                "2026-08-28T00:00:00Z",
                Path::new("/repo"),
                &[evidence(
                    1,
                    json!({
                        "runtimeDiff": {
                            "status": "available",
                            "semanticKind": "complete_before_after",
                            "entries": [{
                                "semantics": "full_before_after",
                                "path": diff_path,
                                "changeKind": "update",
                                "before": "before\n",
                                "after": "after\n"
                            }]
                        },
                        "runtimeFileOperation": {
                            "status": "available",
                            "path": operation_path,
                            "changeKind": "update"
                        }
                    }),
                )],
            )
            .expect("the terminal file change should project");

            assert_eq!(projection.details.card.file_count, 1);
            assert_eq!(projection.details.files.len(), 1);
            let file = &projection.details.files[0];
            assert_eq!(file.path, operation_path);
            assert_eq!(file.presentation_kind, "full_net_diff");
            assert_eq!(file.operation_count, 1);
            assert!(
                file.blocks[0]
                    .diff
                    .as_deref()
                    .is_some_and(|diff| diff.contains("-before") && diff.contains("+after"))
            );
        }
    }

    #[test]
    fn multi_file_diff_does_not_relabel_every_entry_as_the_operation_path() {
        let projection = aggregate_evidence(
            "run-1",
            1,
            "2026-08-28T00:00:00Z",
            Path::new("/repo"),
            &[evidence(
                1,
                json!({
                    "runtimeDiff": {
                        "status": "available",
                        "semanticKind": "exact_mutation",
                        "entries": [
                            {
                                "semantics": "exact_mutation",
                                "path": "src/a.ts",
                                "oldText": "A",
                                "newText": "B"
                            },
                            {
                                "semantics": "exact_mutation",
                                "path": "src/b.ts",
                                "oldText": "C",
                                "newText": "D"
                            }
                        ]
                    },
                    "runtimeFileOperation": {
                        "status": "available",
                        "path": "/tmp/rovai-outside/outside-alpha.txt",
                        "changeKind": "update"
                    }
                }),
            )],
        )
        .expect("the reported changes should project");

        let paths = projection
            .details
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(paths.len(), 3);
        assert!(paths.contains("src/a.ts"));
        assert!(paths.contains("src/b.ts"));
        assert!(paths.contains("/tmp/rovai-outside/outside-alpha.txt"));
    }

    #[test]
    fn latest_authoritative_run_snapshot_wins_without_recombining_operations() {
        let projection = aggregate_evidence(
            "run-1",
            1,
            "2026-08-27T00:00:00Z",
            Path::new("/repo"),
            &[
                full(1, Some("A\n"), Some("B\n")),
                evidence(2, json!({"runtimeRunDiff": {"status": "available", "diff": "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-A\n+C\n"}})),
            ],
        )
        .unwrap();
        let diff = projection.details.files[0].blocks[0]
            .diff
            .as_deref()
            .unwrap();
        assert!(diff.contains("+C"));
        assert!(!diff.contains("+B"));
    }

    #[test]
    fn empty_authoritative_run_snapshot_suppresses_terminal_operation_fallback() {
        assert!(
            aggregate_evidence(
                "run-1",
                1,
                "2026-08-27T00:00:00Z",
                Path::new("/repo"),
                &[
                    full(1, Some("A\n"), Some("B\n")),
                    evidence(
                        2,
                        json!({"runtimeRunDiff": {"status": "available", "diff": ""}}),
                    ),
                ],
            )
            .is_none()
        );
    }

    #[test]
    fn authoritative_snapshot_keeps_explicit_cross_root_terminal_changes() {
        let projection = aggregate_evidence(
            "run-1",
            1,
            "2026-08-28T00:00:00Z",
            Path::new("/repo"),
            &[
                full(1, Some("inside-before\n"), Some("inside-after\n")),
                evidence(
                    2,
                    json!({
                        "runtimeDiff": {
                            "status": "available",
                            "semanticKind": "complete_before_after",
                            "entries": [{
                                "semantics": "full_before_after",
                                "path": "../shared/outside.ts",
                                "changeKind": "update",
                                "before": "outside-before\n",
                                "after": "outside-after\n"
                            }]
                        }
                    }),
                ),
                evidence(
                    3,
                    json!({"runtimeRunDiff": {"status": "available", "diff": ""}}),
                ),
            ],
        )
        .expect("cross-root terminal evidence should remain visible");

        assert_eq!(projection.details.card.file_count, 1);
        assert_eq!(projection.details.files[0].path, "/shared/outside.ts");
        assert_eq!(
            projection.details.files[0].presentation_kind,
            "full_net_diff"
        );
        assert!(
            projection.details.files[0].blocks[0]
                .diff
                .as_deref()
                .is_some_and(|diff| diff.contains("--- /shared/outside.ts"))
        );
    }

    #[test]
    fn nonempty_authoritative_snapshot_adds_only_missing_cross_root_operations() {
        let projection = aggregate_evidence(
            "run-1",
            1,
            "2026-08-28T00:00:00Z",
            Path::new("/repo"),
            &[
                evidence(1, json!({"runtimeFileOperation": {"status": "available", "path": "src/roundtrip.ts", "changeKind": "update"}})),
                evidence(2, json!({"runtimeFileOperation": {"status": "available", "path": "/shared/outside.ts", "changeKind": "update"}})),
                evidence(3, json!({"runtimeRunDiff": {"status": "available", "diff": "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-A\n+B\n"}})),
            ],
        )
        .expect("snapshot and cross-root operation should project together");

        assert_eq!(
            projection
                .details
                .files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            vec!["src/app.ts", "/shared/outside.ts"]
        );
        assert_eq!(projection.details.card.additions, None);
        assert_eq!(projection.details.card.operation_count, 2);
    }

    #[test]
    fn terminal_runs_in_a_non_git_directory_project_independent_replayable_cards() {
        let directory =
            std::env::temp_dir().join(format!("rovai-run-file-changes-test-{}", Uuid::new_v4()));
        let execution_root = directory.join("plain-directory");
        std::fs::create_dir_all(&execution_root).unwrap();
        assert!(!execution_root.join(".git").exists());
        let (mut database, data_dir) = crate::test_support::seeded_runtime_database_fast();
        let now = "2026-08-27T00:00:00Z";
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, project_binding_kind, project_path,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES ('file-change-camp', 'File changes', 'directory', ?1, 0, 1, ?2, ?2)
                "#,
                params![execution_root.to_string_lossy().as_ref(), now],
            )
            .unwrap();
        for (index, agent_id) in ["agent_1", "agent_2", "agent_3"].into_iter().enumerate() {
            database
                .connection()
                .execute(
                    r#"
                    INSERT INTO conversation(id, camp_id, agent_id, created_at, updated_at)
                    VALUES (?1, 'file-change-camp', ?2, ?3, ?3)
                    "#,
                    params![format!("file-change-conversation-{index}"), agent_id, now],
                )
                .unwrap();
        }
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_turn(
                    id, camp_id, trigger_type, trigger_id, status, created_at, updated_at
                ) VALUES (
                    'file-change-turn', 'file-change-camp', 'system_event',
                    'file-change-trigger', 'running', ?1, ?1
                )
                "#,
                [now],
            )
            .unwrap();
        for index in 0..3 {
            database
                .connection()
                .execute(
                    r#"
                    INSERT INTO agent_run(
                        id, camp_turn_id, conversation_id,
                        initial_camp_context_through_sequence,
                        initial_conversation_context_through_sequence,
                        responsibility_key, start_reason, purpose,
                        completion_role, effective_config_json, workspace_json,
                        status, idempotency_key, runtime_adapter_kind, execution_epoch,
                        created_at, started_at, updated_at
                    ) VALUES (
                        ?1, 'file-change-turn', ?2, 0, 0, ?3,
                        'initial', 'test Runtime-reported file changes', 'required',
                        '{"runtimeAdapter":"qoder-cli"}', ?4,
                        'running', ?1, 'qoder-cli', 1, ?5, ?5, ?5
                    )
                    "#,
                    params![
                        format!("file-change-run-{index}"),
                        format!("file-change-conversation-{index}"),
                        format!("file-change-responsibility-{index}"),
                        serde_json::to_string(&json!({
                            "executionRoot": execution_root,
                            "access": "write",
                            "isolation": "shared"
                        }))
                        .unwrap(),
                        now,
                    ],
                )
                .unwrap();
        }

        let blob_store = ManagedBlobStore::new(&data_dir);
        for index in 0..3 {
            ExecutionEvidenceService
                .record_runtime_event(
                    &mut database,
                    &blob_store,
                    &format!("file-change-run-{index}"),
                    1,
                    "runtime.action",
                    &json!({
                        "eventId": format!("file-change-event-{index}"),
                        "toolCallId": format!("file-change-tool-{index}"),
                        "status": "completed",
                        "kind": "edit",
                        "runtimeFileOperation": {
                            "adapterKind": "qoder-cli",
                            "protocolFamily": "acp-v1",
                            "sourceEventKind": "session/update.tool_call_update.completed",
                            "operationKind": "write",
                            "path": format!("src/run-{index}.ts")
                        }
                    }),
                )
                .unwrap()
                .expect("successful file operation should be persisted");
        }
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'failed', ended_at = ?1, updated_at = ?1 WHERE id = 'file-change-run-0'",
                [now],
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'cancelled', ended_at = ?1, updated_at = ?1 WHERE id = 'file-change-run-1'",
                [now],
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'succeeded', ended_at = ?1, updated_at = ?1 WHERE id = 'file-change-run-2'",
                [now],
            )
            .unwrap();
        ExecutionEvidenceService
            .record_terminal_run_diff_snapshot(
                &mut database,
                &blob_store,
                "file-change-run-2",
                1,
                &json!({
                    "eventId": "empty-authoritative-snapshot",
                    "runtimeRunDiff": {
                        "status": "available",
                        "semanticKind": "unified_diff_snapshot",
                        "diff": ""
                    }
                }),
            )
            .unwrap()
            .expect("an empty authoritative terminal snapshot should be durable");

        assert_eq!(
            AgentRunFileChangeProjector
                .recover_terminal_runs(&mut database, &blob_store)
                .unwrap(),
            2
        );
        let cards =
            list_completed_run_file_changes(database.connection(), "file-change-camp").unwrap();
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].files[0].path, "src/run-0.ts");
        assert_eq!(cards[1].files[0].path, "src/run-1.ts");
        assert_eq!(cards[0].additions, None);
        assert_eq!(cards[1].additions, None);
        let detail = read_run_file_changes(
            &database,
            &blob_store,
            "file-change-camp",
            "file-change-run-1",
            1,
        )
        .unwrap();
        assert_eq!(detail.files[0].presentation_kind, "operation_only");
        assert_eq!(
            AgentRunFileChangeProjector
                .recover_terminal_runs(&mut database, &blob_store)
                .unwrap(),
            0,
            "replay must not create a second card for the same Run epoch"
        );

        drop(database);
        std::fs::remove_dir_all(data_dir).unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }
}
