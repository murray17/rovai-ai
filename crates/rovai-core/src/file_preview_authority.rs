use std::{
    path::{Component, Path},
    str::FromStr,
};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{
    agent_run_file_change::{find_run_file_change_summary, read_run_file_changes},
    canonical_activity,
    db::Database,
    managed_blob::ManagedBlobStore,
    managed_skills::{TOOLBOX_SKILLS, managed_skills_root},
    runtime_diff::CommandDiffProjection,
    runtime_file_operation,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveFilePreviewSourceParams {
    pub kind: String,
    pub camp_id: String,
    #[serde(default)]
    pub message_id: Option<String>,
    #[serde(default)]
    pub raw_reference: Option<String>,
    #[serde(default)]
    pub agent_run_id: Option<String>,
    #[serde(default)]
    pub execution_epoch: Option<i64>,
    #[serde(default)]
    pub evidence_file_id: Option<String>,
    #[serde(default)]
    pub evidence_id: Option<String>,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub skill_id: Option<String>,
}

pub fn resolve_skill_preview_source(
    database: &Database,
    data_dir: &Path,
    params: &ResolveFilePreviewSourceParams,
) -> Result<Option<ResolvedFilePreviewSource>> {
    let camp_id = required_bounded(Some(&params.camp_id), "campId", 128)?;
    let skill_id = required_bounded(params.skill_id.as_deref(), "skillId", 128)?;
    if params.raw_reference.as_deref() != Some("SKILL.md") {
        return Ok(None);
    }
    let active: i64 = database.connection().query_row(
        "SELECT EXISTS(SELECT 1 FROM camp WHERE id = ?1 AND activation_state = 'active' AND deletion_operation_id IS NULL)",
        [camp_id],
        |row| row.get(0),
    )?;
    if active == 0 {
        return Ok(None);
    }
    let root = if let Some(name) = skill_id.strip_prefix("rovai:") {
        if !TOOLBOX_SKILLS.contains(&name) {
            return Ok(None);
        }
        let published = managed_skills_root(data_dir)?;
        let path = published.join(name);
        if std::fs::symlink_metadata(&path).is_err()
            || std::fs::symlink_metadata(path.join("SKILL.md")).is_err()
            || std::fs::symlink_metadata(&path)?.file_type().is_symlink()
            || std::fs::symlink_metadata(path.join("SKILL.md"))?
                .file_type()
                .is_symlink()
        {
            return Ok(None);
        }
        let published = published.canonicalize()?;
        let path = path.canonicalize()?;
        if !path.starts_with(&published) {
            return Ok(None);
        }
        path
    } else if skill_id.starts_with("native:") {
        let record: Option<(String, String, String, String, String)> = database.connection().query_row(
            "SELECT name, entry_path, canonical_path, source_scope, adapter_kind FROM native_skill_reference WHERE id = ?1",
            [skill_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).optional()?;
        let Some((name, path, canonical, scope, adapter)) = record else {
            return Ok(None);
        };
        let entry = Path::new(&path);
        if entry.file_name().is_none_or(|value| value != "SKILL.md")
            || entry.canonicalize().ok().as_deref() != Some(Path::new(&canonical))
        {
            return Ok(None);
        }
        let adapter = match crate::agent_profile::AdapterKind::from_str(&adapter) {
            Ok(adapter) => adapter,
            Err(_) => return Ok(None),
        };
        let observed =
            crate::native_skills::read_native_skill(entry, Path::new(&canonical), &scope, adapter);
        if !matches!(observed, Ok(ref skill) if skill.id == skill_id && skill.name == name) {
            return Ok(None);
        }
        Path::new(&canonical)
            .parent()
            .context("Skill entry has no directory")?
            .to_path_buf()
    } else {
        return Ok(None);
    };
    let root = root.to_string_lossy().into_owned();
    Ok(Some(ResolvedFilePreviewSource::FileTarget {
        camp_id: camp_id.to_string(),
        source_kind: "skill_reference".to_string(),
        source_identity: format!("skill:{skill_id}"),
        root_path: root.clone(),
        base_path: root,
        raw_reference: "SKILL.md".to_string(),
        allow_children: true,
    }))
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ResolvedFilePreviewSource {
    FileTarget {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "sourceKind")]
        source_kind: String,
        #[serde(rename = "sourceIdentity")]
        source_identity: String,
        #[serde(rename = "rootPath")]
        root_path: String,
        #[serde(rename = "basePath")]
        base_path: String,
        #[serde(rename = "rawReference")]
        raw_reference: String,
        #[serde(rename = "allowChildren")]
        allow_children: bool,
    },
    EvidenceReview {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "agentRunId")]
        agent_run_id: String,
        #[serde(rename = "executionEpoch")]
        execution_epoch: i64,
        #[serde(rename = "evidenceFileId")]
        evidence_file_id: String,
    },
    EvidenceIdentityUnavailable {
        #[serde(rename = "campId")]
        camp_id: String,
        #[serde(rename = "agentRunId")]
        agent_run_id: String,
        #[serde(rename = "executionEpoch")]
        execution_epoch: i64,
        #[serde(rename = "evidenceFileId")]
        evidence_file_id: String,
    },
}

fn required_bounded<'a>(value: Option<&'a str>, field: &str, maximum: usize) -> Result<&'a str> {
    let value = value.context(format!("{field} is required"))?.trim();
    if value.is_empty() || value.chars().count() > maximum || value.contains(['\0', '\r', '\n']) {
        anyhow::bail!("{field} is invalid");
    }
    Ok(value)
}

fn directory_camp_root(database: &Database, camp_id: &str) -> Result<Option<String>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT project_path
            FROM camp
            WHERE id = ?1
              AND activation_state = 'active'
              AND deletion_operation_id IS NULL
              AND project_binding_kind = 'directory'
            "#,
            [camp_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to resolve the Camp workspace")
}

fn workspace_execution_root(workspace_json: Option<&str>) -> Option<String> {
    workspace_json
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .and_then(|workspace| {
            workspace
                .get("executionRoot")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .filter(|path| Path::new(path).is_absolute())
}

fn run_evidence_root(
    database: &Database,
    camp_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
) -> Result<Option<String>> {
    let row = database
        .connection()
        .query_row(
            r#"
            SELECT agent_run.workspace_json, camp.project_binding_kind, camp.project_path
            FROM agent_run
            LEFT JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            JOIN camp ON camp.id = COALESCE(agent_run.camp_id, camp_turn.camp_id)
            WHERE agent_run.id = ?1
              AND agent_run.execution_epoch = ?2
              AND camp.id = ?3
              AND camp.activation_state = 'active'
              AND camp.deletion_operation_id IS NULL
            "#,
            params![agent_run_id, execution_epoch, camp_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .context("failed to resolve the AgentRun file workspace")?;
    let Some((workspace_json, binding_kind, project_path)) = row else {
        return Ok(None);
    };
    Ok(
        workspace_execution_root(workspace_json.as_deref()).or_else(|| {
            (binding_kind == "directory" && Path::new(&project_path).is_absolute())
                .then_some(project_path)
        }),
    )
}

fn strip_balanced_reference_wrapper(value: &str) -> &str {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return value;
    };
    let expected = match first {
        '`' => '`',
        '"' => '"',
        '\'' => '\'',
        '(' => ')',
        '[' => ']',
        '{' => '}',
        '<' => '>',
        _ => return value,
    };
    value
        .strip_prefix(first)
        .and_then(|inner| inner.strip_suffix(expected))
        .unwrap_or(value)
}

fn reference_has_disallowed_scheme(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("file://") {
        return false;
    }
    let bytes = value.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
    {
        return false;
    }
    let Some(colon) = value.find(':') else {
        return false;
    };
    let prefix = &value[..colon];
    !prefix.is_empty()
        && prefix.as_bytes()[0].is_ascii_alphabetic()
        && prefix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-'))
}

fn plausible_file_reference(value: &str) -> bool {
    let value = strip_balanced_reference_wrapper(value.trim());
    !value.is_empty()
        && value.chars().count() <= 4_096
        && !value.contains(['\0', '\r', '\n'])
        && !reference_has_disallowed_scheme(value)
}

fn visible_markdown_without_fences(body: &str) -> String {
    let mut result = String::with_capacity(body.len());
    let mut fence: Option<char> = None;
    for line in body.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let marker = if trimmed.starts_with("```") {
            Some('`')
        } else if trimmed.starts_with("~~~") {
            Some('~')
        } else {
            None
        };
        if marker.is_some_and(|candidate| fence.is_none() || fence == Some(candidate)) {
            fence = if fence.is_some() { None } else { marker };
            result.push('\n');
            continue;
        }
        if fence.is_some() {
            result.push('\n');
        } else {
            result.push_str(line);
        }
    }
    result
}

fn markdown_without_inline_code(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut result = String::with_capacity(value.len());
    let mut retained_from = 0_usize;
    let mut offset = 0_usize;
    while offset < bytes.len() {
        if bytes[offset] != b'`' {
            offset += 1;
            continue;
        }
        let opener = offset;
        while offset < bytes.len() && bytes[offset] == b'`' {
            offset += 1;
        }
        let delimiter_length = offset - opener;
        let mut candidate = offset;
        let mut closing_end = None;
        while candidate < bytes.len() {
            if bytes[candidate] != b'`' {
                candidate += 1;
                continue;
            }
            let closing_start = candidate;
            while candidate < bytes.len() && bytes[candidate] == b'`' {
                candidate += 1;
            }
            if candidate - closing_start == delimiter_length {
                closing_end = Some(candidate);
                break;
            }
        }
        let Some(end) = closing_end else {
            continue;
        };
        result.push_str(&value[retained_from..opener]);
        retained_from = end;
        offset = end;
    }
    result.push_str(&value[retained_from..]);
    result
}

fn byte_is_escaped(bytes: &[u8], offset: usize) -> bool {
    bytes[..offset]
        .iter()
        .rev()
        .take_while(|byte| **byte == b'\\')
        .count()
        % 2
        == 1
}

fn markdown_destination_has_link_label(before: &str, marker: &str) -> bool {
    let Some(label_end) = before.len().checked_sub(marker.len()) else {
        return false;
    };
    let bytes = before.as_bytes();
    let mut nested = 0_usize;
    for offset in (0..label_end).rev() {
        if byte_is_escaped(bytes, offset) {
            continue;
        }
        match bytes[offset] {
            b']' => nested += 1,
            b'[' if nested > 0 => nested -= 1,
            b'[' => {
                return offset == 0
                    || bytes[offset - 1] != b'!'
                    || byte_is_escaped(bytes, offset - 1);
            }
            _ => {}
        }
    }
    false
}

fn markdown_segment_authorizes_reference(segment: &str, raw_reference: &str) -> bool {
    for (offset, _) in segment.match_indices(raw_reference) {
        let before = &segment[..offset];
        let after = &segment[offset + raw_reference.len()..];
        let markdown_destination = if before.ends_with("](<") {
            after.starts_with('>') && markdown_destination_has_link_label(before, "](<")
        } else if before.ends_with("](") {
            (after.starts_with(')') || after.starts_with(char::is_whitespace))
                && markdown_destination_has_link_label(before, "](")
        } else {
            false
        };
        if markdown_destination {
            return true;
        }
    }
    false
}

fn message_authorizes_reference(body: &str, raw_reference: &str) -> bool {
    if !plausible_file_reference(raw_reference) {
        return false;
    }
    let visible = visible_markdown_without_fences(body);
    markdown_segment_authorizes_reference(&markdown_without_inline_code(&visible), raw_reference)
}

fn message_source(
    database: &Database,
    camp_id: &str,
    message_id: &str,
    raw_reference: &str,
) -> Result<Option<ResolvedFilePreviewSource>> {
    let row = database
        .connection()
        .query_row(
            r#"
            SELECT message.body, message.source_agent_run_id,
                   camp.project_binding_kind, camp.project_path,
                   source_run.workspace_json
            FROM camp_message AS message
            JOIN camp ON camp.id = message.camp_id
            LEFT JOIN agent_run AS source_run ON source_run.id = message.source_agent_run_id
            WHERE message.id = ?1 AND message.camp_id = ?2
              AND message.tombstoned_at IS NULL
              AND camp.activation_state = 'active'
              AND camp.deletion_operation_id IS NULL
            "#,
            params![message_id, camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()
        .context("failed to resolve the CampMessage file reference")?;
    let Some((body, source_agent_run_id, binding_kind, project_path, workspace_json)) = row else {
        return Ok(None);
    };
    if !message_authorizes_reference(&body, raw_reference) {
        return Ok(None);
    }
    let run_root = workspace_execution_root(workspace_json.as_deref());
    let root_path = match run_root {
        Some(path) => path,
        None if binding_kind == "directory" && Path::new(&project_path).is_absolute() => {
            project_path
        }
        None => return Ok(None),
    };
    Ok(Some(ResolvedFilePreviewSource::FileTarget {
        camp_id: camp_id.to_string(),
        source_kind: "message_reference".to_string(),
        source_identity: format!(
            "message:{message_id}:{}",
            source_agent_run_id.as_deref().unwrap_or("camp")
        ),
        base_path: root_path.clone(),
        root_path,
        raw_reference: raw_reference.to_string(),
        allow_children: true,
    }))
}

fn evidence_review(
    database: &Database,
    camp_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    evidence_file_id: &str,
) -> Result<Option<ResolvedFilePreviewSource>> {
    let exists = find_run_file_change_summary(
        database.connection(),
        camp_id,
        agent_run_id,
        execution_epoch,
        evidence_file_id,
    )?
    .is_some();
    Ok(exists.then(|| ResolvedFilePreviewSource::EvidenceReview {
        camp_id: camp_id.to_string(),
        agent_run_id: agent_run_id.to_string(),
        execution_epoch,
        evidence_file_id: evidence_file_id.to_string(),
    }))
}

fn is_supported_run_evidence_path(path: &str) -> bool {
    // Callers bind the path to exact Run evidence before Main grants one file.
    let path = Path::new(path);
    path.is_absolute()
        || !path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

fn run_activity_authorizes_file(
    database: &Database,
    camp_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    evidence_id: &str,
    path: &str,
) -> Result<bool> {
    let authorization = database
        .connection()
        .query_row(
            r#"
            SELECT activity.diff_projection_json, evidence.payload_preview_json,
                   evidence.phase, activity.outcome
            FROM agent_run_execution_evidence AS evidence
            JOIN agent_run ON agent_run.id = evidence.agent_run_id
            LEFT JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            JOIN camp ON camp.id = COALESCE(agent_run.camp_id, camp_turn.camp_id)
            JOIN canonical_runtime_activity AS activity
              ON activity.agent_run_id = evidence.agent_run_id
             AND activity.execution_epoch = evidence.execution_epoch
            WHERE evidence.id = ?1
              AND evidence.agent_run_id = ?2
              AND evidence.execution_epoch = ?3
              AND camp.id = ?4
              AND camp.activation_state = 'active'
              AND camp.deletion_operation_id IS NULL
              AND activity.classifier_version IN (?5, ?6, ?7, ?8)
              AND EXISTS (
                  SELECT 1
                  FROM json_each(activity.source_evidence_ids_json)
                  WHERE json_each.value = evidence.id
              )
            ORDER BY CASE activity.classifier_version
                WHEN ?5 THEN 0
                WHEN ?6 THEN 1
                WHEN ?7 THEN 2
                ELSE 3
            END
            LIMIT 1
            "#,
            params![
                evidence_id,
                agent_run_id,
                execution_epoch,
                camp_id,
                canonical_activity::CLASSIFIER_VERSION,
                canonical_activity::PREVIOUS_CLASSIFIER_VERSION,
                canonical_activity::INTERMEDIATE_CLASSIFIER_VERSION,
                canonical_activity::LEGACY_CLASSIFIER_VERSION,
            ],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .context("failed to resolve the Run activity file projection")?;
    let Some((projection_json, payload_json, evidence_phase, activity_outcome)) = authorization
    else {
        return Ok(false);
    };
    if let Some(projection_json) = projection_json {
        let projection: CommandDiffProjection = serde_json::from_str(&projection_json)
            .context("Run activity file projection is invalid")?;
        if projection.status == "available"
            && projection
                .source_evidence_ids
                .iter()
                .any(|candidate| candidate == evidence_id)
            && projection
                .entries
                .as_ref()
                .is_some_and(|entries| entries.iter().any(|entry| entry.path == path))
        {
            return Ok(true);
        }
    }
    if evidence_phase != "completed" || activity_outcome != "succeeded" {
        return Ok(false);
    }
    let payload: serde_json::Value =
        serde_json::from_str(&payload_json).context("Run activity file evidence is invalid")?;
    Ok(runtime_file_operation::operation_from_evidence(&payload)
        .is_some_and(|operation| operation.path == path))
}

fn run_activity_file(
    database: &Database,
    camp_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    evidence_id: &str,
    raw_reference: &str,
) -> Result<Option<ResolvedFilePreviewSource>> {
    if !is_supported_run_evidence_path(raw_reference)
        || !run_activity_authorizes_file(
            database,
            camp_id,
            agent_run_id,
            execution_epoch,
            evidence_id,
            raw_reference,
        )?
    {
        return Ok(None);
    }
    let Some(root_path) = run_evidence_root(database, camp_id, agent_run_id, execution_epoch)?
    else {
        return Ok(None);
    };
    Ok(Some(ResolvedFilePreviewSource::FileTarget {
        camp_id: camp_id.to_string(),
        source_kind: "run_activity_file".to_string(),
        source_identity: format!(
            "run-activity-file:{agent_run_id}:{execution_epoch}:{evidence_id}"
        ),
        base_path: root_path.clone(),
        root_path,
        raw_reference: raw_reference.to_string(),
        allow_children: true,
    }))
}

fn evidence_current_file(
    database: &Database,
    blob_store: &ManagedBlobStore,
    camp_id: &str,
    agent_run_id: &str,
    execution_epoch: i64,
    evidence_file_id: &str,
) -> Result<Option<ResolvedFilePreviewSource>> {
    let unavailable = || ResolvedFilePreviewSource::EvidenceIdentityUnavailable {
        camp_id: camp_id.to_string(),
        agent_run_id: agent_run_id.to_string(),
        execution_epoch,
        evidence_file_id: evidence_file_id.to_string(),
    };
    let Some(summary) = find_run_file_change_summary(
        database.connection(),
        camp_id,
        agent_run_id,
        execution_epoch,
        evidence_file_id,
    )?
    else {
        return Ok(None);
    };
    let detail =
        match read_run_file_changes(database, blob_store, camp_id, agent_run_id, execution_epoch) {
            Ok(detail) => detail,
            Err(_) => return Ok(Some(unavailable())),
        };
    let Some(detail_file) = detail
        .files
        .iter()
        .find(|file| file.evidence_file_id == evidence_file_id)
    else {
        return Ok(Some(unavailable()));
    };
    if detail_file.path != summary.path {
        return Ok(Some(unavailable()));
    }
    if !is_supported_run_evidence_path(&summary.path) {
        return Ok(Some(unavailable()));
    }
    let Some(root_path) = run_evidence_root(database, camp_id, agent_run_id, execution_epoch)?
    else {
        return Ok(Some(unavailable()));
    };
    Ok(Some(ResolvedFilePreviewSource::FileTarget {
        camp_id: camp_id.to_string(),
        source_kind: "run_evidence".to_string(),
        source_identity: format!(
            "run-evidence:{agent_run_id}:{execution_epoch}:{evidence_file_id}"
        ),
        base_path: root_path.clone(),
        root_path,
        raw_reference: summary.path,
        allow_children: true,
    }))
}

pub fn resolve_file_preview_source(
    database: &Database,
    blob_store: &ManagedBlobStore,
    params: ResolveFilePreviewSourceParams,
) -> Result<Option<ResolvedFilePreviewSource>> {
    let camp_id = required_bounded(Some(&params.camp_id), "campId", 128)?;
    match params.kind.as_str() {
        "camp_workspace" => {
            let raw_reference =
                required_bounded(params.raw_reference.as_deref(), "rawReference", 4_096)?;
            let Some(root_path) = directory_camp_root(database, camp_id)? else {
                return Ok(None);
            };
            Ok(Some(ResolvedFilePreviewSource::FileTarget {
                camp_id: camp_id.to_string(),
                source_kind: params.kind,
                source_identity: format!("camp:{camp_id}"),
                base_path: root_path.clone(),
                root_path,
                raw_reference: raw_reference.to_string(),
                allow_children: true,
            }))
        }
        "message_reference" => message_source(
            database,
            camp_id,
            required_bounded(params.message_id.as_deref(), "messageId", 128)?,
            required_bounded(params.raw_reference.as_deref(), "rawReference", 4_096)?,
        ),
        "run_evidence" if params.action.as_deref() == Some("review") => evidence_review(
            database,
            camp_id,
            required_bounded(params.agent_run_id.as_deref(), "agentRunId", 128)?,
            params
                .execution_epoch
                .context("executionEpoch is required")?,
            required_bounded(params.evidence_file_id.as_deref(), "evidenceFileId", 256)?,
        ),
        "run_evidence" if params.action.as_deref() == Some("open_current") => {
            evidence_current_file(
                database,
                blob_store,
                camp_id,
                required_bounded(params.agent_run_id.as_deref(), "agentRunId", 128)?,
                params
                    .execution_epoch
                    .context("executionEpoch is required")?,
                required_bounded(params.evidence_file_id.as_deref(), "evidenceFileId", 256)?,
            )
        }
        "run_evidence" => Ok(None),
        "run_activity_file" => run_activity_file(
            database,
            camp_id,
            required_bounded(params.agent_run_id.as_deref(), "agentRunId", 128)?,
            params
                .execution_epoch
                .context("executionEpoch is required")?,
            required_bounded(params.evidence_id.as_deref(), "evidenceId", 256)?,
            required_bounded(params.raw_reference.as_deref(), "rawReference", 4_096)?,
        ),
        _ => anyhow::bail!("unsupported file preview source kind"),
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use rusqlite::params;
    use serde_json::json;
    use uuid::Uuid;

    use super::{
        ResolveFilePreviewSourceParams, ResolvedFilePreviewSource, is_supported_run_evidence_path,
        message_authorizes_reference, resolve_file_preview_source, resolve_skill_preview_source,
        run_evidence_root,
    };
    use crate::{
        agent_run_file_change::AgentRunFileChangeProjector, db::Database,
        execution_evidence::ExecutionEvidenceService, managed_blob::ManagedBlobStore,
    };

    fn run_workspace_fixture() -> (Database, PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "rovai-file-preview-run-workspace-test-{}",
            Uuid::new_v4()
        ));
        let project_root = root.join("project");
        let execution_root = root.join("mission-worktree");
        std::fs::create_dir_all(&project_root).unwrap();
        std::fs::create_dir_all(&execution_root).unwrap();
        let (database, data_dir) = crate::test_support::seeded_runtime_database_fast();
        let now = "2026-09-16T00:00:00Z";
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, project_binding_kind, project_path,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES ('preview-camp', 'Preview', 'directory', ?1, 0, 1, ?2, ?2)
                "#,
                params![project_root.to_string_lossy().as_ref(), now],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO conversation(id, camp_id, agent_id, created_at, updated_at)
                VALUES ('preview-conversation', 'preview-camp', 'agent_1', ?1, ?1)
                "#,
                [now],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_turn(
                    id, camp_id, trigger_type, trigger_id, status, created_at, updated_at
                ) VALUES (
                    'preview-turn', 'preview-camp', 'system_event',
                    'preview-trigger', 'running', ?1, ?1
                )
                "#,
                [now],
            )
            .unwrap();
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
                    'preview-run', 'preview-turn', 'preview-conversation', 0, 0,
                    'preview-responsibility', 'initial', 'preview current file', 'required',
                    '{"runtimeAdapter":"opencode-cli"}', ?1,
                    'running', 'preview-run', 'opencode-cli', 1, ?2, ?2, ?2
                )
                "#,
                params![
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
        (database, data_dir, root, execution_root)
    }

    fn clean_run_workspace_fixture(database: Database, data_dir: PathBuf, root: PathBuf) {
        drop(database);
        std::fs::remove_dir_all(data_dir).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn skill_preview_requires_exact_registered_native_source_and_active_camp() {
        let (database, data_dir, root, _) = run_workspace_fixture();
        let skill_root = root.join("native/custom");
        std::fs::create_dir_all(&skill_root).unwrap();
        let entry = skill_root.join("SKILL.md");
        std::fs::write(
            &entry,
            "---\nname: custom\ndescription: Preview\n---\nGuide\n",
        )
        .unwrap();
        let canonical = entry.canonicalize().unwrap();
        let skill = crate::native_skills::read_native_skill(
            &entry,
            &canonical,
            "project",
            crate::agent_profile::AdapterKind::CodexCli,
        )
        .unwrap();
        database.connection().execute(
            "INSERT INTO native_skill_reference(id, name, entry_path, canonical_path, source_scope, adapter_kind, discovered_at) VALUES (?1, ?2, ?3, ?4, 'project', 'codex-cli', '2026-09-24T00:00:00Z')",
            params![skill.id, skill.name, skill.entry_path, skill.canonical_path],
        ).unwrap();
        let request = ResolveFilePreviewSourceParams {
            kind: "skill_reference".to_string(),
            camp_id: "preview-camp".to_string(),
            message_id: None,
            raw_reference: Some("SKILL.md".to_string()),
            agent_run_id: None,
            execution_epoch: None,
            evidence_file_id: None,
            evidence_id: None,
            action: None,
            skill_id: Some(skill.id.clone()),
        };
        assert!(
            matches!(resolve_skill_preview_source(&database, &data_dir, &request).unwrap(), Some(ResolvedFilePreviewSource::FileTarget { source_kind, .. }) if source_kind == "skill_reference")
        );
        let mut changed = request.clone();
        changed.raw_reference = Some("other.md".to_string());
        assert!(
            resolve_skill_preview_source(&database, &data_dir, &changed)
                .unwrap()
                .is_none()
        );
        changed = request.clone();
        changed.camp_id = "another-camp".to_string();
        assert!(
            resolve_skill_preview_source(&database, &data_dir, &changed)
                .unwrap()
                .is_none()
        );
        std::fs::write(
            &entry,
            "---\nname: changed\ndescription: Preview\n---\nGuide\n",
        )
        .unwrap();
        assert!(
            resolve_skill_preview_source(&database, &data_dir, &request)
                .unwrap()
                .is_none()
        );
        clean_run_workspace_fixture(database, data_dir, root);
    }

    fn project_run_file_operations(
        database: &mut Database,
        data_dir: &Path,
        paths: &[&str],
    ) -> Vec<(String, String)> {
        let blob_store = ManagedBlobStore::new(data_dir);
        for (index, path) in paths.iter().enumerate() {
            ExecutionEvidenceService
                .record_runtime_event(
                    database,
                    &blob_store,
                    "preview-run",
                    1,
                    "runtime.action",
                    &json!({
                        "eventId": format!("preview-event-{index}"),
                        "toolCallId": format!("preview-tool-{index}"),
                        "status": "completed",
                        "kind": "edit",
                        "runtimeFileOperation": {
                            "adapterKind": "opencode-cli",
                            "protocolFamily": "acp-v1",
                            "sourceEventKind": "session/update.tool_call_update.completed",
                            "operationKind": "write",
                            "path": path
                        }
                    }),
                )
                .unwrap()
                .expect("file evidence should be recorded");
        }
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'succeeded', ended_at = updated_at WHERE id = 'preview-run'",
                [],
            )
            .unwrap();
        AgentRunFileChangeProjector
            .project_terminal_run(database, &blob_store, "preview-run", 1)
            .unwrap()
            .expect("terminal file changes should be projected")
            .files
            .into_iter()
            .map(|file| (file.path, file.evidence_file_id))
            .collect()
    }

    fn resolve_open_current(
        database: &Database,
        data_dir: &Path,
        evidence_file_id: &str,
    ) -> ResolvedFilePreviewSource {
        resolve_file_preview_source(
            database,
            &ManagedBlobStore::new(data_dir),
            ResolveFilePreviewSourceParams {
                kind: "run_evidence".to_string(),
                camp_id: "preview-camp".to_string(),
                message_id: None,
                raw_reference: None,
                agent_run_id: Some("preview-run".to_string()),
                execution_epoch: Some(1),
                evidence_file_id: Some(evidence_file_id.to_string()),
                evidence_id: None,
                action: Some("open_current".to_string()),
                skill_id: None,
            },
        )
        .unwrap()
        .expect("projected evidence should resolve")
    }

    fn record_run_activity_diff(
        database: &mut Database,
        data_dir: &Path,
        execution_root: &Path,
        paths: &[&str],
    ) -> String {
        let entries = paths
            .iter()
            .map(|path| {
                json!({
                    "path": execution_root.join(path),
                    "oldText": "before\n",
                    "newText": "after\n"
                })
            })
            .collect::<Vec<_>>();
        ExecutionEvidenceService
            .record_runtime_event(
                database,
                &ManagedBlobStore::new(data_dir),
                "preview-run",
                1,
                "runtime.action",
                &json!({
                    "eventId": "preview-diff-event",
                    "toolCallId": "preview-diff-tool",
                    "status": "completed",
                    "kind": "edit",
                    "runtimeDiff": {
                        "adapterKind": "opencode-cli",
                        "protocolFamily": "acp-v1",
                        "sourceEventKind": "session/update.tool_call_update.completed",
                        "semanticKind": "complete_before_after",
                        "entries": entries
                    }
                }),
            )
            .unwrap()
            .expect("Run activity diff evidence should be recorded")
            .id
            .clone()
    }

    fn resolve_run_activity_file(
        database: &Database,
        data_dir: &Path,
        agent_run_id: &str,
        execution_epoch: i64,
        evidence_id: &str,
        path: &str,
    ) -> Option<ResolvedFilePreviewSource> {
        resolve_run_activity_file_for_camp(
            database,
            data_dir,
            "preview-camp",
            agent_run_id,
            execution_epoch,
            evidence_id,
            path,
        )
    }

    fn resolve_run_activity_file_for_camp(
        database: &Database,
        data_dir: &Path,
        camp_id: &str,
        agent_run_id: &str,
        execution_epoch: i64,
        evidence_id: &str,
        path: &str,
    ) -> Option<ResolvedFilePreviewSource> {
        resolve_file_preview_source(
            database,
            &ManagedBlobStore::new(data_dir),
            ResolveFilePreviewSourceParams {
                kind: "run_activity_file".to_string(),
                camp_id: camp_id.to_string(),
                message_id: None,
                raw_reference: Some(path.to_string()),
                agent_run_id: Some(agent_run_id.to_string()),
                execution_epoch: Some(execution_epoch),
                evidence_file_id: None,
                evidence_id: Some(evidence_id.to_string()),
                action: None,
                skill_id: None,
            },
        )
        .unwrap()
    }

    #[test]
    fn message_reference_requires_an_explicit_markdown_destination() {
        assert!(message_authorizes_reference(
            "请看 [说明](README.md) 和 `notes.txt`。",
            "README.md"
        ));
        assert!(!message_authorizes_reference(
            "请看 [说明](README.md) 和 `notes.txt`。",
            "notes.txt"
        ));
        assert!(!message_authorizes_reference(
            "修改位于 ./src/app.ts:42。",
            "./src/app.ts:42"
        ));
        assert!(!message_authorizes_reference(
            "查看 `notebook.ipynb` 与 `data.sqlite`。",
            "notebook.ipynb"
        ));
        assert!(!message_authorizes_reference(
            "查看 `notebook.ipynb` 与 `data.sqlite`。",
            "data.sqlite"
        ));
        assert!(message_authorizes_reference(
            "查看 [代码](src/app.ts:42)。",
            "src/app.ts:42"
        ));
        assert!(message_authorizes_reference(
            "查看 [`代码`](src/app.ts:42)。",
            "src/app.ts:42"
        ));
        assert!(!message_authorizes_reference(
            "普通文字里提到了 README.md，但没有可点击语法。",
            "README.md"
        ));
        assert!(!message_authorizes_reference("请采用 `方案 B`。", "方案 B"));
    }

    #[test]
    fn message_reference_rejects_fenced_code_urls_and_partial_matches() {
        assert!(!message_authorizes_reference(
            "```text\n./src/app.ts\n```",
            "./src/app.ts"
        ));
        assert!(!message_authorizes_reference(
            "https://example.com/src/app.ts",
            "src/app.ts"
        ));
        assert!(!message_authorizes_reference(
            "prefix./src/app.ts-suffix",
            "./src/app.ts"
        ));
        assert!(!message_authorizes_reference(
            "[网页](https://example.com/src/app.ts)",
            "src/app.ts"
        ));
        assert!(!message_authorizes_reference(
            "![图片](src/image.png)",
            "src/image.png"
        ));
        assert!(!message_authorizes_reference(
            "查看 ``[伪链接](src/secret.ts)``。",
            "src/secret.ts"
        ));
    }

    #[test]
    fn run_evidence_prefers_the_exact_run_execution_root() {
        let (database, data_dir, root, execution_root) = run_workspace_fixture();
        assert_eq!(
            run_evidence_root(&database, "preview-camp", "preview-run", 1).unwrap(),
            Some(execution_root.to_string_lossy().into_owned())
        );
        assert_eq!(
            run_evidence_root(&database, "another-camp", "preview-run", 1).unwrap(),
            None,
            "a Run workspace must not authorize another Camp"
        );
        assert_eq!(
            run_evidence_root(&database, "preview-camp", "preview-run", 2).unwrap(),
            None,
            "a stale execution epoch must not authorize the current Run workspace"
        );
        clean_run_workspace_fixture(database, data_dir, root);
    }

    #[test]
    fn open_current_resolves_run_relative_and_external_absolute_files() {
        let (mut database, data_dir, root, execution_root) = run_workspace_fixture();
        let external_file = root.join("external-worktree/src/shared.ts");
        let external_path = external_file.to_string_lossy().replace('\\', "/");
        let project_root: PathBuf = database
            .connection()
            .query_row(
                "SELECT project_path FROM camp WHERE id = 'preview-camp'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(PathBuf::from)
            .unwrap();
        std::fs::create_dir_all(project_root.join("src")).unwrap();
        std::fs::create_dir_all(execution_root.join("src")).unwrap();
        std::fs::create_dir_all(external_file.parent().unwrap()).unwrap();
        std::fs::write(project_root.join("src/shared.ts"), "project\n").unwrap();
        std::fs::write(execution_root.join("src/shared.ts"), "mission\n").unwrap();
        std::fs::write(&external_file, "external\n").unwrap();
        std::fs::write(execution_root.join("src/new.ts"), "new mission file\n").unwrap();
        let evidence = project_run_file_operations(
            &mut database,
            &data_dir,
            &["src/shared.ts", "src/new.ts", &external_path],
        );
        for expected_path in ["src/shared.ts", "src/new.ts", &external_path] {
            let evidence_file_id = evidence
                .iter()
                .find_map(|(path, id)| (path == expected_path).then_some(id))
                .expect("projected file identity");
            let ResolvedFilePreviewSource::FileTarget {
                root_path,
                raw_reference,
                ..
            } = resolve_open_current(&database, &data_dir, evidence_file_id)
            else {
                panic!("open_current should authorize a current file target")
            };
            assert_eq!(Path::new(&root_path), execution_root);
            assert_eq!(raw_reference, expected_path);
        }
        assert_eq!(
            std::fs::read_to_string(execution_root.join("src/shared.ts")).unwrap(),
            "mission\n",
            "the original project's same-named file must not be selected"
        );
        assert!(!project_root.join("src/new.ts").exists());
        assert_eq!(
            std::fs::read_to_string(&external_file).unwrap(),
            "external\n"
        );
        clean_run_workspace_fixture(database, data_dir, root);
    }

    #[test]
    fn run_activity_file_uses_the_exact_evidence_and_mission_worktree() {
        let (mut database, data_dir, root, execution_root) = run_workspace_fixture();
        let evidence_id = record_run_activity_diff(
            &mut database,
            &data_dir,
            &execution_root,
            &["src/generated.ts"],
        );
        let ResolvedFilePreviewSource::FileTarget {
            source_kind,
            root_path,
            raw_reference,
            ..
        } = resolve_run_activity_file(
            &database,
            &data_dir,
            "preview-run",
            1,
            &evidence_id,
            "src/generated.ts",
        )
        .expect("the exact canonical diff path should resolve")
        else {
            panic!("Run activity should resolve a file target")
        };
        assert_eq!(source_kind, "run_activity_file");
        assert_eq!(Path::new(&root_path), execution_root);
        assert_eq!(raw_reference, "src/generated.ts");

        for (run_id, epoch, candidate_evidence, path) in [
            ("other-run", 1, evidence_id.as_str(), "src/generated.ts"),
            ("preview-run", 2, evidence_id.as_str(), "src/generated.ts"),
            ("preview-run", 1, "other-evidence", "src/generated.ts"),
            (
                "preview-run",
                1,
                evidence_id.as_str(),
                "src/not-reported.ts",
            ),
            ("preview-run", 1, evidence_id.as_str(), "../generated.ts"),
        ] {
            assert!(
                resolve_run_activity_file(
                    &database,
                    &data_dir,
                    run_id,
                    epoch,
                    candidate_evidence,
                    path,
                )
                .is_none(),
                "a mismatched Run activity locator must fail closed"
            );
        }
        let operation_path = "src/operation-only.ts";
        let project_root: PathBuf = database
            .connection()
            .query_row(
                "SELECT project_path FROM camp WHERE id = 'preview-camp'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(PathBuf::from)
            .unwrap();
        std::fs::create_dir_all(project_root.join("src")).unwrap();
        std::fs::create_dir_all(execution_root.join("src")).unwrap();
        std::fs::write(project_root.join(operation_path), "project\n").unwrap();
        std::fs::write(execution_root.join(operation_path), "mission\n").unwrap();
        let operation_evidence = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &ManagedBlobStore::new(&data_dir),
                "preview-run",
                1,
                "runtime.action",
                &json!({
                    "eventId": "preview-operation-event",
                    "toolCallId": "preview-operation-tool",
                    "status": "completed",
                    "kind": "edit",
                    "runtimeFileOperation": {
                        "adapterKind": "opencode-cli",
                        "protocolFamily": "acp-v1",
                        "sourceEventKind": "session/update.tool_call_update.completed",
                        "operationKind": "write",
                        "path": operation_path
                    }
                }),
            )
            .unwrap()
            .expect("path-only file evidence should be recorded");
        let ResolvedFilePreviewSource::FileTarget {
            root_path,
            raw_reference,
            ..
        } = resolve_run_activity_file(
            &database,
            &data_dir,
            "preview-run",
            1,
            &operation_evidence.evidence.id,
            operation_path,
        )
        .expect("the exact path-only file operation should resolve in the Run worktree")
        else {
            panic!("Run file operation should resolve a file target")
        };
        assert_eq!(Path::new(&root_path), execution_root);
        assert_eq!(raw_reference, operation_path);
        assert_eq!(
            std::fs::read_to_string(Path::new(&root_path).join(&raw_reference)).unwrap(),
            "mission\n",
            "the operation-only row must not open the Camp project's same-named file"
        );
        let read_evidence = ExecutionEvidenceService
            .record_runtime_event(
                &mut database,
                &ManagedBlobStore::new(&data_dir),
                "preview-run",
                1,
                "runtime.action",
                &json!({
                    "eventId": "preview-read-event",
                    "toolCallId": "preview-read-tool",
                    "status": "completed",
                    "kind": "read",
                    "runtimeFileOperation": {
                        "adapterKind": "opencode-cli",
                        "protocolFamily": "acp-v1",
                        "sourceEventKind": "session/update.tool_call_update.completed",
                        "operationKind": "read",
                        "path": operation_path
                    }
                }),
            )
            .unwrap()
            .expect("path-only read evidence should be recorded");
        let ResolvedFilePreviewSource::FileTarget { root_path, .. } = resolve_run_activity_file(
            &database,
            &data_dir,
            "preview-run",
            1,
            &read_evidence.evidence.id,
            operation_path,
        )
        .expect("the exact path-only read should resolve in the Run worktree") else {
            panic!("Run read operation should resolve a file target")
        };
        assert_eq!(Path::new(&root_path), execution_root);
        for (run_id, epoch, path) in [
            ("other-run", 1, operation_path),
            ("preview-run", 2, operation_path),
            ("preview-run", 1, "src/not-reported.ts"),
            ("preview-run", 1, "../operation-only.ts"),
        ] {
            assert!(
                resolve_run_activity_file(
                    &database,
                    &data_dir,
                    run_id,
                    epoch,
                    &operation_evidence.evidence.id,
                    path,
                )
                .is_none(),
                "path-only evidence must not authorize another Run, epoch or path"
            );
        }
        database
            .connection()
            .execute(
                "UPDATE agent_run_execution_evidence
                 SET payload_preview_json=json_set(
                   payload_preview_json, '$.runtimeFileOperation.status', 'unavailable'
                 ) WHERE id=?1",
                [&operation_evidence.evidence.id],
            )
            .unwrap();
        assert!(
            resolve_run_activity_file(
                &database,
                &data_dir,
                "preview-run",
                1,
                &operation_evidence.evidence.id,
                operation_path,
            )
            .is_none(),
            "an unavailable operation must not authorize a file"
        );
        clean_run_workspace_fixture(database, data_dir, root);
    }

    #[test]
    fn direct_camp_run_activity_file_uses_exact_evidence_for_run_and_external_files() {
        let (mut database, data_dir, root, execution_root) = run_workspace_fixture();
        let external_file = root.join("external-worktree/src/shared.ts");
        let external_path = external_file.to_string_lossy().replace('\\', "/");
        let project_root: PathBuf = database
            .connection()
            .query_row(
                "SELECT project_path FROM camp WHERE id = 'preview-camp'",
                [],
                |row| row.get::<_, String>(0),
            )
            .map(PathBuf::from)
            .unwrap();
        std::fs::create_dir_all(project_root.join("src")).unwrap();
        std::fs::create_dir_all(execution_root.join("src")).unwrap();
        std::fs::create_dir_all(external_file.parent().unwrap()).unwrap();
        std::fs::write(project_root.join("src/shared.ts"), "project\n").unwrap();
        std::fs::write(execution_root.join("src/shared.ts"), "mission\n").unwrap();
        std::fs::write(&external_file, "external\n").unwrap();
        std::fs::write(
            execution_root.join("src/worktree-only.ts"),
            "mission only\n",
        )
        .unwrap();
        let evidence_id = record_run_activity_diff(
            &mut database,
            &data_dir,
            &execution_root,
            &["src/shared.ts", "src/worktree-only.ts", &external_path],
        );
        database
            .connection()
            .execute_batch(
                r#"
                INSERT INTO camp_message(
                    id, camp_id, sequence, author_type, author_id, body,
                    structured_content_json, content_digest, address_mode,
                    addressed_agent_ids_json, version, created_at, updated_at
                ) VALUES (
                    'preview-message', 'preview-camp', 1, 'user', 'local_user', '执行',
                    '[{"kind":"text","text":"执行"}]', 'preview-message',
                    'explicit', '["agent_1"]', 1,
                    '2026-09-16T00:01:00Z', '2026-09-16T00:01:00Z'
                );
                UPDATE camp SET last_message_sequence = 1 WHERE id = 'preview-camp';
                UPDATE agent_run
                SET invocation_kind = 'batch',
                    camp_id = 'preview-camp',
                    camp_turn_id = NULL,
                    anchor_message_id = 'preview-message',
                    current_public_tail_sequence = 1
                WHERE id = 'preview-run';
                "#,
            )
            .unwrap();

        for path in ["src/shared.ts", "src/worktree-only.ts", &external_path] {
            let ResolvedFilePreviewSource::FileTarget {
                root_path,
                raw_reference,
                ..
            } = resolve_run_activity_file(
                &database,
                &data_dir,
                "preview-run",
                1,
                &evidence_id,
                path,
            )
            .expect("a direct-Camp Run should authorize its exact canonical diff path")
            else {
                panic!("Run activity should resolve a file target")
            };
            assert_eq!(Path::new(&root_path), execution_root);
            assert_eq!(raw_reference, path);
        }
        assert_eq!(
            std::fs::read_to_string(execution_root.join("src/shared.ts")).unwrap(),
            "mission\n",
            "the same-named file must stay rooted in the Mission worktree"
        );
        assert!(!project_root.join("src/worktree-only.ts").exists());
        assert_eq!(
            std::fs::read_to_string(&external_file).unwrap(),
            "external\n"
        );

        assert!(
            resolve_run_activity_file_for_camp(
                &database,
                &data_dir,
                "another-camp",
                "preview-run",
                1,
                &evidence_id,
                "src/shared.ts",
            )
            .is_none(),
            "another Camp must not reuse the Run activity authority"
        );
        for (run_id, epoch, candidate_evidence, path) in [
            ("other-run", 1, evidence_id.as_str(), "src/shared.ts"),
            ("preview-run", 2, evidence_id.as_str(), "src/shared.ts"),
            ("preview-run", 1, "other-evidence", "src/shared.ts"),
            (
                "preview-run",
                1,
                evidence_id.as_str(),
                "src/not-reported.ts",
            ),
            ("preview-run", 1, evidence_id.as_str(), "../shared.ts"),
        ] {
            assert!(
                resolve_run_activity_file(
                    &database,
                    &data_dir,
                    run_id,
                    epoch,
                    candidate_evidence,
                    path,
                )
                .is_none(),
                "a mismatched direct-Camp Run activity locator must fail closed"
            );
        }
        assert!(
            resolve_run_activity_file(
                &database,
                &data_dir,
                "preview-run",
                1,
                &evidence_id,
                execution_root
                    .join("src/shared.ts")
                    .to_string_lossy()
                    .as_ref(),
            )
            .is_none(),
            "an absolute spelling not present in the canonical diff must not be accepted"
        );
        clean_run_workspace_fixture(database, data_dir, root);
    }

    #[test]
    fn run_activity_file_falls_back_to_the_project_for_a_legacy_run() {
        let (mut database, data_dir, root, execution_root) = run_workspace_fixture();
        let evidence_id = record_run_activity_diff(
            &mut database,
            &data_dir,
            &execution_root,
            &["src/generated.ts"],
        );
        let project_root: String = database
            .connection()
            .query_row(
                "SELECT project_path FROM camp WHERE id = 'preview-camp'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET workspace_json = NULL WHERE id = 'preview-run'",
                [],
            )
            .unwrap();
        let ResolvedFilePreviewSource::FileTarget { root_path, .. } = resolve_run_activity_file(
            &database,
            &data_dir,
            "preview-run",
            1,
            &evidence_id,
            "src/generated.ts",
        )
        .expect("legacy Run activity should use the Camp project") else {
            panic!("Run activity should resolve a file target")
        };
        assert_eq!(root_path, project_root);
        clean_run_workspace_fixture(database, data_dir, root);
    }

    #[test]
    fn ordinary_and_legacy_runs_fall_back_to_the_camp_project() {
        let (database, data_dir, root, _) = run_workspace_fixture();
        let project_root: String = database
            .connection()
            .query_row(
                "SELECT project_path FROM camp WHERE id = 'preview-camp'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET workspace_json = ?1 WHERE id = 'preview-run'",
                [
                    serde_json::to_string(&json!({ "executionRoot": project_root.clone() }))
                        .unwrap(),
                ],
            )
            .unwrap();
        assert_eq!(
            run_evidence_root(&database, "preview-camp", "preview-run", 1).unwrap(),
            Some(project_root.clone()),
            "an ordinary Camp Run remains rooted at its project"
        );

        database
            .connection()
            .execute(
                "UPDATE agent_run SET workspace_json = NULL WHERE id = 'preview-run'",
                [],
            )
            .unwrap();
        assert_eq!(
            run_evidence_root(&database, "preview-camp", "preview-run", 1).unwrap(),
            Some(project_root.clone()),
            "a historical Run without workspace evidence uses the Camp project"
        );

        database
            .connection()
            .execute(
                "UPDATE agent_run SET workspace_json = '{\"executionRoot\":\"relative/path\"}' WHERE id = 'preview-run'",
                [],
            )
            .unwrap();
        assert_eq!(
            run_evidence_root(&database, "preview-camp", "preview-run", 1).unwrap(),
            Some(project_root),
            "an invalid historical execution root cannot escape the fallback policy"
        );
        clean_run_workspace_fixture(database, data_dir, root);
    }

    #[test]
    fn run_evidence_paths_allow_absolute_files_but_reject_relative_parent_traversal() {
        assert!(is_supported_run_evidence_path("src/generated.txt"));
        assert!(is_supported_run_evidence_path("generated.txt"));
        assert!(!is_supported_run_evidence_path("../generated.txt"));
        assert!(!is_supported_run_evidence_path("src/../../generated.txt"));
        assert!(is_supported_run_evidence_path(
            &crate::test_support::absolute_test_path("/tmp/generated.txt")
        ));
    }
}
