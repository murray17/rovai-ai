use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

use crate::agent_profile::AdapterKind;

pub const COMMAND_DIFF_SCHEMA_VERSION: u32 = 1;
pub(crate) const RUNTIME_DIFF_MANAGED_OUTPUT_ROOT: &str = "runtime_diff_managed_output_root";
const MAX_DIFF_FILES: usize = 256;
const MAX_DIFF_BYTES: usize = 8 * 1024 * 1024;
const MAX_SINGLE_DIFF_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedDiffEntry {
    pub path: String,
    pub change_kind: String,
    pub additions: u64,
    pub deletions: u64,
    pub diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandDiffProjection {
    pub schema_version: u32,
    pub source: String,
    pub revision: i64,
    pub source_evidence_ids: Vec<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<NormalizedDiffEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub safe_reason_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdmittedCommandDiff {
    pub semantic_kind: String,
    pub entries: Vec<NormalizedDiffEntry>,
    pub evidence_entries: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ExactMutationEvidenceEntry {
    semantics: String,
    path: String,
    old_text: String,
    new_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FullBeforeAfterEvidenceEntry {
    semantics: String,
    path: String,
    change_kind: String,
    before: Option<String>,
    after: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct UnifiedDiffEvidenceEntry {
    semantics: String,
    path: String,
    change_kind: String,
    diff: String,
}

pub fn admit_runtime_diff(
    payload: &Value,
    execution_root: &Path,
    frozen_adapter_kind: Option<&str>,
) -> Option<Result<AdmittedCommandDiff, &'static str>> {
    admit_runtime_diff_with_file_operation_path_and_managed_output_root(
        payload,
        execution_root,
        frozen_adapter_kind,
        None,
        None,
    )
}

pub fn admit_runtime_diff_with_file_operation_path(
    payload: &Value,
    execution_root: &Path,
    frozen_adapter_kind: Option<&str>,
    file_operation_path: Option<&str>,
) -> Option<Result<AdmittedCommandDiff, &'static str>> {
    admit_runtime_diff_with_file_operation_path_and_managed_output_root(
        payload,
        execution_root,
        frozen_adapter_kind,
        file_operation_path,
        None,
    )
}

pub fn admit_runtime_diff_with_file_operation_path_and_managed_output_root(
    payload: &Value,
    execution_root: &Path,
    frozen_adapter_kind: Option<&str>,
    file_operation_path: Option<&str>,
    managed_output_root: Option<&Path>,
) -> Option<Result<AdmittedCommandDiff, &'static str>> {
    let candidate = payload.get("runtimeDiff")?;
    Some(admit_candidate(
        candidate,
        execution_root,
        frozen_adapter_kind,
        file_operation_path,
        managed_output_root,
    ))
}

fn admit_candidate(
    candidate: &Value,
    execution_root: &Path,
    frozen_adapter_kind: Option<&str>,
    file_operation_path: Option<&str>,
    managed_output_root: Option<&Path>,
) -> Result<AdmittedCommandDiff, &'static str> {
    let adapter_kind = candidate
        .get("adapterKind")
        .and_then(Value::as_str)
        .ok_or("runtime_diff_source_invalid")?;
    if frozen_adapter_kind != Some(adapter_kind) {
        return Err("runtime_diff_adapter_mismatch");
    }
    let protocol_family = candidate
        .get("protocolFamily")
        .and_then(Value::as_str)
        .ok_or("runtime_diff_source_invalid")?;
    let source_event_kind = candidate
        .get("sourceEventKind")
        .and_then(Value::as_str)
        .ok_or("runtime_diff_source_invalid")?;
    let semantic_kind = candidate
        .get("semanticKind")
        .and_then(Value::as_str)
        .ok_or("runtime_diff_semantics_invalid")?;
    let adapter = adapter_kind
        .parse::<AdapterKind>()
        .map_err(|_| "runtime_diff_adapter_invalid")?;
    let admitted_source = match adapter {
        AdapterKind::CodexCli => {
            protocol_family == "codex-app-server"
                && source_event_kind == "item/completed.fileChange.completed"
                && semantic_kind == "codex_file_change_snapshot"
        }
        adapter if adapter.uses_acp() => {
            protocol_family == "acp-v1"
                && source_event_kind == "session/update.tool_call_update.completed"
                && semantic_kind == "complete_before_after"
        }
        AdapterKind::ClaudeCodeCli => {
            protocol_family == "claude-stream-json"
                && source_event_kind == "assistant.tool_use.Edit+user.tool_result.completed"
                && semantic_kind == "exact_mutation"
        }
        _ => false,
    };
    if !admitted_source {
        return Err("runtime_diff_source_not_allowlisted");
    }

    let raw_entries = candidate
        .get("entries")
        .and_then(Value::as_array)
        .ok_or("runtime_diff_entries_invalid")?;
    if raw_entries.is_empty() || raw_entries.len() > MAX_DIFF_FILES {
        return Err("runtime_diff_file_limit");
    }
    if semantic_kind == "exact_mutation" {
        return admit_exact_mutations(raw_entries, execution_root, managed_output_root);
    }
    let mut total_bytes = 0_usize;
    let mut entries = Vec::with_capacity(raw_entries.len());
    let mut evidence_entries = Vec::with_capacity(raw_entries.len());
    let mut excluded_managed_output = false;
    for raw in raw_entries {
        let raw_path = raw
            .get("path")
            .and_then(Value::as_str)
            .ok_or("runtime_diff_path_invalid")?;
        let move_path = raw
            .pointer("/kind/movePath")
            .or_else(|| raw.pointer("/kind/move_path"))
            .and_then(Value::as_str);
        if managed_output_root.is_some_and(|root| {
            reported_path_is_within_root(execution_root, raw_path, root)
                || move_path
                    .is_some_and(|path| reported_path_is_within_root(execution_root, path, root))
        }) {
            excluded_managed_output = true;
            continue;
        }
        let source_path = (adapter == AdapterKind::KiroCli && raw_entries.len() == 1)
            .then(|| reconcile_kiro_rooted_diff_path(raw_path, file_operation_path))
            .flatten()
            .or_else(|| normalize_reported_path_for_display(execution_root, raw_path))
            .ok_or("runtime_diff_path_invalid")?;
        let change_kind = normalized_change_kind(raw, semantic_kind)?;
        let path = if adapter == AdapterKind::CodexCli && change_kind == "update" {
            move_path
                .map(|move_path| {
                    normalize_reported_path_for_display(execution_root, move_path)
                        .ok_or("runtime_diff_path_invalid")
                })
                .transpose()?
                .unwrap_or_else(|| source_path.clone())
        } else {
            source_path.clone()
        };
        let (diff, evidence_entry) = match semantic_kind {
            "codex_file_change_snapshot" => {
                let content = raw
                    .get("diff")
                    .and_then(Value::as_str)
                    .ok_or("runtime_diff_content_invalid")?;
                if content.len() > MAX_SINGLE_DIFF_BYTES {
                    return Err("runtime_diff_item_limit");
                }
                match change_kind.as_str() {
                    "add" => (
                        unified_diff_from_before_after(&path, None, content),
                        serde_json::to_value(FullBeforeAfterEvidenceEntry {
                            semantics: "full_before_after".to_string(),
                            path: path.clone(),
                            change_kind: change_kind.clone(),
                            before: None,
                            after: Some(content.to_string()),
                        })
                        .map_err(|_| "runtime_diff_entries_invalid")?,
                    ),
                    "delete" => (
                        unified_diff_for_delete(&source_path, content),
                        serde_json::to_value(FullBeforeAfterEvidenceEntry {
                            semantics: "full_before_after".to_string(),
                            path: source_path.clone(),
                            change_kind: change_kind.clone(),
                            before: Some(content.to_string()),
                            after: None,
                        })
                        .map_err(|_| "runtime_diff_entries_invalid")?,
                    ),
                    "update" if !content.is_empty() => (
                        content.to_string(),
                        serde_json::to_value(UnifiedDiffEvidenceEntry {
                            semantics: "unified_diff_snapshot".to_string(),
                            path: path.clone(),
                            change_kind: change_kind.clone(),
                            diff: content.to_string(),
                        })
                        .map_err(|_| "runtime_diff_entries_invalid")?,
                    ),
                    "update" => return Err("runtime_diff_content_invalid"),
                    _ => return Err("runtime_diff_change_kind_invalid"),
                }
            }
            "complete_before_after" => {
                let old_text = match raw.get("oldText") {
                    Some(Value::String(value)) => Some(value.as_str()),
                    Some(Value::Null) | None => None,
                    _ => return Err("runtime_diff_content_invalid"),
                };
                let new_text = raw
                    .get("newText")
                    .and_then(Value::as_str)
                    .ok_or("runtime_diff_content_invalid")?;
                if old_text.is_some_and(|old_text| old_text == new_text) {
                    return Err("runtime_diff_no_changes");
                }
                if old_text.is_some_and(|old_text| old_text.len() > MAX_SINGLE_DIFF_BYTES)
                    || new_text.len() > MAX_SINGLE_DIFF_BYTES
                {
                    return Err("runtime_diff_item_limit");
                }
                (
                    unified_diff_from_before_after(&path, old_text, new_text),
                    serde_json::to_value(FullBeforeAfterEvidenceEntry {
                        semantics: "full_before_after".to_string(),
                        path: path.clone(),
                        change_kind: change_kind.clone(),
                        before: old_text.map(str::to_string),
                        after: Some(new_text.to_string()),
                    })
                    .map_err(|_| "runtime_diff_entries_invalid")?,
                )
            }
            _ => return Err("runtime_diff_semantics_invalid"),
        };
        if diff.len() > MAX_SINGLE_DIFF_BYTES {
            return Err("runtime_diff_item_limit");
        }
        total_bytes = total_bytes
            .checked_add(diff.len())
            .ok_or("runtime_diff_size_limit")?;
        if total_bytes > MAX_DIFF_BYTES {
            return Err("runtime_diff_size_limit");
        }
        let (additions, deletions) = unified_diff_counts(&diff);
        entries.push(NormalizedDiffEntry {
            path,
            change_kind,
            additions,
            deletions,
            diff,
        });
        evidence_entries.push(evidence_entry);
    }
    if entries.is_empty() && excluded_managed_output {
        return Err(RUNTIME_DIFF_MANAGED_OUTPUT_ROOT);
    }
    Ok(AdmittedCommandDiff {
        semantic_kind: if semantic_kind == "codex_file_change_snapshot" {
            "unified_diff_snapshot".to_string()
        } else {
            semantic_kind.to_string()
        },
        entries,
        evidence_entries: Value::Array(evidence_entries),
    })
}

fn admit_exact_mutations(
    raw_entries: &[Value],
    execution_root: &Path,
    managed_output_root: Option<&Path>,
) -> Result<AdmittedCommandDiff, &'static str> {
    let mut total_bytes = 0_usize;
    let mut evidence_entries = Vec::with_capacity(raw_entries.len());
    let mut projection_entries = Vec::with_capacity(raw_entries.len());
    let mut excluded_managed_output = false;
    for raw in raw_entries {
        if raw.get("semantics").and_then(Value::as_str) != Some("exact_mutation") {
            return Err("runtime_diff_semantics_invalid");
        }
        for replace_all in [raw.get("replace_all"), raw.get("replaceAll")] {
            match replace_all {
                None | Some(Value::Bool(false)) => {}
                Some(Value::Bool(true)) | Some(_) => {
                    return Err("runtime_diff_replace_all_unsupported");
                }
            }
        }
        let raw_path = raw
            .get("path")
            .and_then(Value::as_str)
            .ok_or("runtime_diff_path_invalid")?;
        if managed_output_root
            .is_some_and(|root| reported_path_is_within_root(execution_root, raw_path, root))
        {
            excluded_managed_output = true;
            continue;
        }
        let path = normalize_reported_path_for_display(execution_root, raw_path)
            .ok_or("runtime_diff_path_invalid")?;
        let old_text = raw
            .get("oldText")
            .and_then(Value::as_str)
            .ok_or("runtime_diff_content_invalid")?;
        let new_text = raw
            .get("newText")
            .and_then(Value::as_str)
            .ok_or("runtime_diff_content_invalid")?;
        if old_text == new_text {
            return Err("runtime_diff_no_changes");
        }
        let source_bytes = old_text
            .len()
            .checked_add(new_text.len())
            .ok_or("runtime_diff_size_limit")?;
        if source_bytes > MAX_SINGLE_DIFF_BYTES {
            return Err("runtime_diff_item_limit");
        }
        total_bytes = total_bytes
            .checked_add(source_bytes)
            .ok_or("runtime_diff_size_limit")?;
        if total_bytes > MAX_DIFF_BYTES {
            return Err("runtime_diff_size_limit");
        }
        let diff = exact_mutation_fragment(old_text, new_text);
        if diff.len() > MAX_SINGLE_DIFF_BYTES {
            return Err("runtime_diff_item_limit");
        }
        evidence_entries.push(ExactMutationEvidenceEntry {
            semantics: "exact_mutation".to_string(),
            path: path.clone(),
            old_text: old_text.to_string(),
            new_text: new_text.to_string(),
        });
        projection_entries.push(NormalizedDiffEntry {
            path,
            change_kind: "update".to_string(),
            additions: fragment_line_count(new_text),
            deletions: fragment_line_count(old_text),
            diff,
        });
    }
    if projection_entries.is_empty() && excluded_managed_output {
        return Err(RUNTIME_DIFF_MANAGED_OUTPUT_ROOT);
    }
    Ok(AdmittedCommandDiff {
        semantic_kind: "exact_mutation".to_string(),
        entries: projection_entries,
        evidence_entries: serde_json::to_value(evidence_entries)
            .map_err(|_| "runtime_diff_entries_invalid")?,
    })
}

fn normalized_change_kind(raw: &Value, semantic_kind: &str) -> Result<String, &'static str> {
    let explicit = raw
        .get("changeKind")
        .and_then(Value::as_str)
        .or_else(|| raw.pointer("/kind/type").and_then(Value::as_str));
    if let Some(kind) = explicit {
        return match kind {
            "add" | "delete" | "update" => Ok(kind.to_string()),
            _ => Err("runtime_diff_change_kind_invalid"),
        };
    }
    if semantic_kind != "complete_before_after" {
        return Err("runtime_diff_change_kind_invalid");
    }
    let old_text = raw.get("oldText");
    Ok(if old_text.is_none_or(Value::is_null) {
        "add"
    } else {
        "update"
    }
    .to_string())
}

pub(crate) fn normalize_reported_path_for_display(
    display_root: &Path,
    reported: &str,
) -> Option<String> {
    let display_root = normalize_absolute_path(display_root)?;
    let resolved = resolve_reported_absolute_path(&display_root, reported)?;
    display_path_from_resolved(&display_root, resolved)
}

pub(crate) fn reported_path_is_within_root(
    display_root: &Path,
    reported: &str,
    root: &Path,
) -> bool {
    let Some(display_root) = normalize_absolute_path(display_root) else {
        return false;
    };
    let Some(resolved) = resolve_reported_absolute_path(&display_root, reported) else {
        return false;
    };
    let Some(root) = normalize_absolute_path(root) else {
        return false;
    };
    path_starts_with(&resolved, &root)
}

fn path_starts_with(path: &Path, root: &Path) -> bool {
    if cfg!(windows) {
        let mut path_components = path.components();
        root.components().all(|root_component| {
            path_components.next().is_some_and(|path_component| {
                path_component
                    .as_os_str()
                    .eq_ignore_ascii_case(root_component.as_os_str())
            })
        })
    } else {
        path.starts_with(root)
    }
}

fn resolve_reported_absolute_path(display_root: &Path, reported: &str) -> Option<PathBuf> {
    if reported.trim().is_empty() || reported.contains('\0') {
        return None;
    }
    let file_url_path;
    let reported_path = if reported.starts_with("file:") {
        let url = Url::parse(reported).ok()?;
        if url.scheme() != "file" {
            return None;
        }
        file_url_path = url.to_file_path().ok()?;
        file_url_path.as_path()
    } else if reported.contains("://") {
        return None;
    } else {
        Path::new(reported)
    };
    Some(if reported_path.is_absolute() {
        normalize_absolute_path(reported_path)?
    } else {
        normalize_absolute_path(&display_root.join(reported_path))?
    })
}

fn display_path_from_resolved(display_root: &Path, resolved: PathBuf) -> Option<String> {
    if resolved == display_root {
        return None;
    }
    let display_path = resolved
        .strip_prefix(display_root)
        .ok()
        .filter(|relative| !relative.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or(resolved);
    if display_path.components().any(|component| {
        matches!(component, Component::Normal(value) if value.to_string_lossy().eq_ignore_ascii_case(".git"))
    }) {
        return None;
    }
    Some(display_path.to_string_lossy().replace('\\', "/"))
}

pub(crate) fn filter_unified_diff_snapshot_outside_root(
    diff: &str,
    display_root: &Path,
    excluded_root: &Path,
) -> Option<String> {
    if diff.trim().is_empty() {
        return Some(diff.to_string());
    }
    let sections = split_unified_diff_sections(diff);
    if sections.is_empty() {
        return None;
    }
    let mut retained = String::new();
    for section in sections {
        let (source_path, destination_path) = unified_diff_section_paths(&section)?;
        if !reported_path_is_within_root(display_root, &source_path, excluded_root)
            && !reported_path_is_within_root(display_root, &destination_path, excluded_root)
        {
            retained.push_str(&section);
        }
    }
    Some(retained)
}

pub(crate) fn split_unified_diff_sections(diff: &str) -> Vec<String> {
    let starts = diff
        .match_indices("diff --git ")
        .filter(|(index, _)| *index == 0 || diff.as_bytes().get(index - 1) == Some(&b'\n'))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    starts
        .iter()
        .enumerate()
        .map(|(index, start)| {
            diff[*start..starts.get(index + 1).copied().unwrap_or(diff.len())].to_string()
        })
        .collect()
}

pub(crate) fn unified_diff_section_identity(section: &str) -> Option<(String, String)> {
    let (_, path) = unified_diff_section_paths(section)?;
    let change_kind = if section
        .lines()
        .any(|line| line.starts_with("new file mode "))
    {
        "add"
    } else if section
        .lines()
        .any(|line| line.starts_with("deleted file mode "))
    {
        "delete"
    } else {
        "update"
    };
    Some((path, change_kind.to_string()))
}

fn unified_diff_section_paths(section: &str) -> Option<(String, String)> {
    let header = section.lines().next()?;
    let marker = header
        .rfind(" b/")
        .filter(|_| header.starts_with("diff --git a/"))?;
    Some((
        header["diff --git a/".len()..marker].trim().to_string(),
        header[marker + 3..].trim().to_string(),
    ))
}

fn normalize_absolute_path(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let mut clean = PathBuf::new();
    let mut normal_components = 0_usize;
    for component in path.components() {
        match component {
            Component::Normal(value) => {
                clean.push(value);
                normal_components = normal_components.saturating_add(1);
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if normal_components == 0 || !clean.pop() {
                    return None;
                }
                normal_components -= 1;
            }
            Component::RootDir | Component::Prefix(_) => clean.push(component.as_os_str()),
        }
    }
    clean.is_absolute().then_some(clean)
}

fn reconcile_kiro_rooted_diff_path(
    reported_diff_path: &str,
    normalized_file_operation_path: Option<&str>,
) -> Option<String> {
    let reported_path = Path::new(reported_diff_path);
    if !reported_path.is_absolute() {
        return None;
    }
    let mut rooted_relative = PathBuf::new();
    for component in reported_path.components() {
        match component {
            Component::Normal(value) => {
                if value.to_string_lossy().eq_ignore_ascii_case(".git") {
                    return None;
                }
                rooted_relative.push(value);
            }
            Component::RootDir | Component::Prefix(_) | Component::CurDir => {}
            Component::ParentDir => return None,
        }
    }
    let rooted_relative = rooted_relative.to_string_lossy().replace('\\', "/");
    let normalized_file_operation_path = normalized_file_operation_path?;
    if Path::new(normalized_file_operation_path).is_absolute() {
        return None;
    }
    (rooted_relative == normalized_file_operation_path)
        .then(|| normalized_file_operation_path.to_string())
}

pub fn unified_diff_counts(diff: &str) -> (u64, u64) {
    let mut additions = 0_u64;
    let mut deletions = 0_u64;
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            additions = additions.saturating_add(1);
        } else if line.starts_with('-') {
            deletions = deletions.saturating_add(1);
        }
    }
    (additions, deletions)
}

pub fn unified_diff_from_before_after(
    path: &str,
    old_text: Option<&str>,
    new_text: &str,
) -> String {
    let old_lines = split_preserving_line_endings(old_text.unwrap_or_default());
    let new_lines = split_preserving_line_endings(new_text);
    let mut prefix = 0_usize;
    while prefix < old_lines.len()
        && prefix < new_lines.len()
        && old_lines[prefix] == new_lines[prefix]
    {
        prefix += 1;
    }
    let mut suffix = 0_usize;
    while suffix < old_lines.len().saturating_sub(prefix)
        && suffix < new_lines.len().saturating_sub(prefix)
        && old_lines[old_lines.len() - 1 - suffix] == new_lines[new_lines.len() - 1 - suffix]
    {
        suffix += 1;
    }
    let context_before = prefix.min(3);
    let context_after = suffix.min(3);
    let old_changed_end = old_lines.len().saturating_sub(suffix);
    let new_changed_end = new_lines.len().saturating_sub(suffix);
    let old_start = prefix.saturating_sub(context_before);
    let new_start = prefix.saturating_sub(context_before);
    let old_count = old_changed_end.saturating_sub(old_start) + context_after;
    let new_count = new_changed_end.saturating_sub(new_start) + context_after;
    let old_header = if old_text.is_none() {
        "/dev/null".to_string()
    } else {
        unified_diff_display_path(path, "a")
    };
    let new_header = unified_diff_display_path(path, "b");
    let mut output = format!(
        "--- {old_header}\n+++ {new_header}\n@@ -{},{} +{},{} @@\n",
        if old_count == 0 { 0 } else { old_start + 1 },
        old_count,
        if new_count == 0 { 0 } else { new_start + 1 },
        new_count,
    );
    for line in &old_lines[old_start..prefix] {
        append_unified_line(&mut output, ' ', line);
    }
    for line in &old_lines[prefix..old_changed_end] {
        append_unified_line(&mut output, '-', line);
    }
    for line in &new_lines[prefix..new_changed_end] {
        append_unified_line(&mut output, '+', line);
    }
    for line in &new_lines[new_changed_end..new_changed_end + context_after] {
        append_unified_line(&mut output, ' ', line);
    }
    output
}

fn unified_diff_for_delete(path: &str, old_text: &str) -> String {
    let old_lines = split_preserving_line_endings(old_text);
    let old_header = unified_diff_display_path(path, "a");
    let mut output = format!(
        "--- {old_header}\n+++ /dev/null\n@@ -{},{} +0,0 @@\n",
        if old_lines.is_empty() { 0 } else { 1 },
        old_lines.len(),
    );
    for line in old_lines {
        append_unified_line(&mut output, '-', line);
    }
    output
}

fn unified_diff_display_path(path: &str, side: &str) -> String {
    if Path::new(path).is_absolute() {
        path.to_string()
    } else {
        format!("{side}/{path}")
    }
}

fn split_preserving_line_endings(value: &str) -> Vec<&str> {
    if value.is_empty() {
        Vec::new()
    } else {
        value.split_inclusive('\n').collect()
    }
}

fn append_unified_line(output: &mut String, prefix: char, line: &str) {
    output.push(prefix);
    output.push_str(line);
    if !line.ends_with('\n') {
        output.push('\n');
        output.push_str("\\ No newline at end of file\n");
    }
}

fn fragment_line_count(value: &str) -> u64 {
    if value.is_empty() {
        0
    } else {
        u64::try_from(value.split_inclusive('\n').count()).unwrap_or(u64::MAX)
    }
}

pub(crate) fn exact_mutation_fragment(old_text: &str, new_text: &str) -> String {
    let mut output = String::with_capacity(
        old_text
            .len()
            .saturating_add(new_text.len())
            .saturating_add(fragment_line_count(old_text) as usize)
            .saturating_add(fragment_line_count(new_text) as usize),
    );
    append_exact_fragment_lines(&mut output, '-', old_text);
    append_exact_fragment_lines(&mut output, '+', new_text);
    output
}

pub(crate) fn unified_diff_from_complete_states(
    path: &str,
    before: Option<&str>,
    after: Option<&str>,
) -> Option<String> {
    if before == after {
        return None;
    }
    match (before, after) {
        (_, Some(after)) => Some(unified_diff_from_before_after(path, before, after)),
        (Some(before), None) => Some(unified_diff_for_delete(path, before)),
        (None, None) => None,
    }
}

fn append_exact_fragment_lines(output: &mut String, prefix: char, text: &str) {
    for line in text.split_inclusive('\n') {
        output.push(prefix);
        let content = line.strip_suffix('\n').unwrap_or(line);
        output.push_str(content.strip_suffix('\r').unwrap_or(content));
        output.push('\n');
    }
}

pub fn projection_from_admitted(
    admitted: AdmittedCommandDiff,
    evidence_id: &str,
) -> CommandDiffProjection {
    CommandDiffProjection {
        schema_version: COMMAND_DIFF_SCHEMA_VERSION,
        source: "runtime_reported".to_string(),
        revision: 1,
        source_evidence_ids: vec![evidence_id.to_string()],
        status: "available".to_string(),
        semantic_kind: Some(admitted.semantic_kind),
        entries: Some(admitted.entries),
        safe_reason_code: None,
    }
}

pub fn projection_from_evidence(
    payload: &Value,
    evidence_id: &str,
) -> Option<CommandDiffProjection> {
    let diff = payload.get("runtimeDiff")?;
    if diff.get("schemaVersion").and_then(Value::as_u64)
        != Some(u64::from(COMMAND_DIFF_SCHEMA_VERSION))
    {
        return None;
    }
    match diff.get("status").and_then(Value::as_str) {
        Some("available") => {
            let semantic_kind = diff.get("semanticKind")?.as_str()?.to_string();
            let raw_entries = diff.get("entries")?.as_array()?;
            let entries = raw_entries
                .iter()
                .map(command_diff_entry_from_evidence)
                .collect::<Option<Vec<_>>>()?;
            Some(projection_from_admitted(
                AdmittedCommandDiff {
                    semantic_kind,
                    evidence_entries: diff.get("entries")?.clone(),
                    entries,
                },
                evidence_id,
            ))
        }
        Some("unavailable") => Some(unavailable_projection(
            diff.get("safeReasonCode")
                .and_then(Value::as_str)
                .unwrap_or("runtime_diff_unavailable"),
            evidence_id,
        )),
        _ => None,
    }
}

fn command_diff_entry_from_evidence(entry: &Value) -> Option<NormalizedDiffEntry> {
    match entry.get("semantics")?.as_str()? {
        "exact_mutation" => {
            let entry = serde_json::from_value::<ExactMutationEvidenceEntry>(entry.clone()).ok()?;
            (entry.old_text != entry.new_text).then(|| NormalizedDiffEntry {
                path: entry.path,
                change_kind: "update".to_string(),
                additions: fragment_line_count(&entry.new_text),
                deletions: fragment_line_count(&entry.old_text),
                diff: exact_mutation_fragment(&entry.old_text, &entry.new_text),
            })
        }
        "full_before_after" => {
            let entry =
                serde_json::from_value::<FullBeforeAfterEvidenceEntry>(entry.clone()).ok()?;
            let patch = unified_diff_from_complete_states(
                &entry.path,
                entry.before.as_deref(),
                entry.after.as_deref(),
            )?;
            let (additions, deletions) = unified_diff_counts(&patch);
            Some(NormalizedDiffEntry {
                path: entry.path,
                change_kind: entry.change_kind,
                additions,
                deletions,
                diff: patch,
            })
        }
        "unified_diff_snapshot" => {
            let entry = serde_json::from_value::<UnifiedDiffEvidenceEntry>(entry.clone()).ok()?;
            let (additions, deletions) = unified_diff_counts(&entry.diff);
            Some(NormalizedDiffEntry {
                path: entry.path,
                change_kind: entry.change_kind,
                additions,
                deletions,
                diff: entry.diff,
            })
        }
        _ => None,
    }
}

pub fn unavailable_projection(reason: &str, evidence_id: &str) -> CommandDiffProjection {
    CommandDiffProjection {
        schema_version: COMMAND_DIFF_SCHEMA_VERSION,
        source: "runtime_reported".to_string(),
        revision: 1,
        source_evidence_ids: vec![evidence_id.to_string()],
        status: "unavailable".to_string(),
        semantic_kind: None,
        entries: None,
        safe_reason_code: Some(reason.to_string()),
    }
}

pub fn merge_projection(
    current: Option<CommandDiffProjection>,
    incoming: CommandDiffProjection,
) -> CommandDiffProjection {
    let Some(mut current) = current else {
        return incoming;
    };
    for evidence_id in incoming.source_evidence_ids {
        if !current.source_evidence_ids.contains(&evidence_id) {
            current.source_evidence_ids.push(evidence_id);
        }
    }
    let same_conclusion = current.status == incoming.status
        && current.semantic_kind == incoming.semantic_kind
        && current.entries == incoming.entries
        && current.safe_reason_code == incoming.safe_reason_code;
    if same_conclusion {
        return current;
    }
    current.revision = current.revision.saturating_add(1);
    current.status = "conflict".to_string();
    current.semantic_kind = None;
    current.entries = None;
    current.safe_reason_code = Some("runtime_diff_conflicting_terminal_snapshots".to_string());
    current
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn codex_terminal_snapshot_is_normalized_inside_the_execution_root() {
        let result = admit_runtime_diff(
            &json!({
                "runtimeDiff": {
                    "adapterKind": "codex-cli",
                    "protocolFamily": "codex-app-server",
                    "sourceEventKind": "item/completed.fileChange.completed",
                    "semanticKind": "codex_file_change_snapshot",
                    "entries": [{
                        "path": "/repo/src/app.ts",
                        "kind": {"type": "update"},
                        "diff": "@@ -1 +1,2 @@\n-old\n+new\n+next\n"
                    }]
                }
            }),
            Path::new("/repo"),
            Some("codex-cli"),
        )
        .expect("candidate should be present")
        .expect("candidate should be admitted");
        assert_eq!(result.entries[0].path, "src/app.ts");
        assert_eq!(
            (result.entries[0].additions, result.entries[0].deletions),
            (2, 1)
        );
        assert_eq!(result.semantic_kind, "unified_diff_snapshot");
    }

    #[test]
    fn codex_add_and_delete_content_become_renderable_unified_diffs() {
        let result = admit_runtime_diff(
            &json!({
                "runtimeDiff": {
                    "adapterKind": "codex-cli",
                    "protocolFamily": "codex-app-server",
                    "sourceEventKind": "item/completed.fileChange.completed",
                    "semanticKind": "codex_file_change_snapshot",
                    "entries": [{
                        "path": "/repo/new.txt",
                        "kind": {"type": "add"},
                        "diff": "first\nsecond\n"
                    }, {
                        "path": "/repo/old.txt",
                        "kind": {"type": "delete"},
                        "diff": "gone\n"
                    }]
                }
            }),
            Path::new("/repo"),
            Some("codex-cli"),
        )
        .expect("candidate should be present")
        .expect("candidate should be admitted");

        assert_eq!(
            (result.entries[0].additions, result.entries[0].deletions),
            (2, 0)
        );
        assert!(
            result.entries[0]
                .diff
                .contains("--- /dev/null\n+++ b/new.txt")
        );
        assert_eq!(
            (result.entries[1].additions, result.entries[1].deletions),
            (0, 1)
        );
        assert!(
            result.entries[1]
                .diff
                .contains("--- a/old.txt\n+++ /dev/null")
        );
    }

    #[test]
    fn cross_root_diffs_keep_user_files_and_exclude_managed_run_output() {
        let managed_output_root = Path::new("/rovai/runtime/builtin-tools/process/run-tmp");
        let result = admit_runtime_diff_with_file_operation_path_and_managed_output_root(
            &json!({
                "runtimeDiff": {
                    "adapterKind": "codex-cli",
                    "protocolFamily": "codex-app-server",
                    "sourceEventKind": "item/completed.fileChange.completed",
                    "semanticKind": "codex_file_change_snapshot",
                    "entries": [
                        {"path": "../secret", "kind": {"type": "update"}, "diff": "+x"},
                        {
                            "path": "/rovai/runtime/builtin-tools/process/run-tmp/report.html",
                            "kind": {"type": "add"},
                            "diff": "temporary\n"
                        }
                    ]
                }
            }),
            Path::new("/repo"),
            Some("codex-cli"),
            None,
            Some(managed_output_root),
        )
        .expect("candidate should be present")
        .expect("an explicit cross-root Runtime path should be admitted");
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].path, "/secret");

        let managed_only = admit_runtime_diff_with_file_operation_path_and_managed_output_root(
            &json!({
                "runtimeDiff": {
                    "adapterKind": "codex-cli",
                    "protocolFamily": "codex-app-server",
                    "sourceEventKind": "item/completed.fileChange.completed",
                    "semanticKind": "codex_file_change_snapshot",
                    "entries": [{
                        "path": "/rovai/runtime/builtin-tools/process/run-tmp/report.html",
                        "kind": {"type": "add"},
                        "diff": "temporary\n"
                    }]
                }
            }),
            Path::new("/repo"),
            Some("codex-cli"),
            None,
            Some(managed_output_root),
        )
        .expect("candidate should be present");
        assert_eq!(managed_only, Err(RUNTIME_DIFF_MANAGED_OUTPUT_ROOT));

        let managed_snapshot = concat!(
            "diff --git a//rovai/runtime/builtin-tools/process/run-tmp/report.html ",
            "b//rovai/runtime/builtin-tools/process/run-tmp/report.html\n",
            "new file mode 100644\n--- /dev/null\n",
            "+++ b//rovai/runtime/builtin-tools/process/run-tmp/report.html\n@@ -0,0 +1 @@\n+x\n",
        );
        let managed_source_snapshot = concat!(
            "diff --git a//rovai/runtime/builtin-tools/process/run-tmp/source.html ",
            "b/src/published.html\n",
            "similarity index 100%\n",
            "rename from /rovai/runtime/builtin-tools/process/run-tmp/source.html\n",
            "rename to src/published.html\n",
        );
        let snapshot = format!(
            "diff --git a/src/app.ts b/src/app.ts\n\
             --- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n{managed_snapshot}{managed_source_snapshot}"
        );
        let filtered = filter_unified_diff_snapshot_outside_root(
            &snapshot,
            Path::new("/repo"),
            managed_output_root,
        )
        .expect("a structured snapshot should be filterable");
        assert!(filtered.contains("src/app.ts"));
        assert!(!filtered.contains("run-tmp/report.html"));
        assert!(!filtered.contains("src/published.html"));
        assert_eq!(
            filter_unified_diff_snapshot_outside_root(
                managed_snapshot,
                Path::new("/repo"),
                managed_output_root,
            )
            .as_deref(),
            Some("")
        );
    }

    #[test]
    fn file_uris_and_paths_use_relative_inside_and_absolute_outside_display_root() {
        assert_eq!(
            normalize_reported_path_for_display(
                Path::new("/repo with space"),
                "file:///repo%20with%20space/src/app.ts"
            )
            .as_deref(),
            Some("src/app.ts")
        );
        assert_eq!(
            normalize_reported_path_for_display(Path::new("/repo"), "file:///outside/app.ts")
                .as_deref(),
            Some("/outside/app.ts")
        );
        assert_eq!(
            normalize_reported_path_for_display(Path::new("/repo"), "../outside/app.ts").as_deref(),
            Some("/outside/app.ts")
        );
        assert!(
            normalize_reported_path_for_display(Path::new("/repo"), "https://example.com/app.ts")
                .is_none()
        );
        assert!(
            normalize_reported_path_for_display(Path::new("/repo"), "/outside/.git/config")
                .is_none()
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_managed_output_exclusion_uses_exact_path_components() {
        let execution_root = Path::new(r"C:\workspace");
        let managed_output_root = Path::new(
            r"C:\Users\murray\AppData\Local\Rovai AI\Core\runtime\builtin-tools\process\run-tmp",
        );
        assert!(reported_path_is_within_root(
            execution_root,
            r"c:/Users/murray/AppData/Local/ROVAI AI/Core/runtime/builtin-tools/process/run-tmp/report.html",
            managed_output_root,
        ));
        assert!(!reported_path_is_within_root(
            execution_root,
            r"C:\Users\murray\AppData\Local\Rovai AI\Core\runtime\builtin-tools\process\run-tmp-copy\report.html",
            managed_output_root,
        ));
    }

    #[test]
    fn kiro_single_diff_can_reconcile_to_the_same_tool_calls_admitted_file_location() {
        let result = admit_runtime_diff_with_file_operation_path(
            &json!({
                "runtimeDiff": {
                    "adapterKind": "kiro-cli",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "semanticKind": "complete_before_after",
                    "entries": [{
                        "path": "/src/app.ts",
                        "oldText": "before\n",
                        "newText": "after\n"
                    }]
                }
            }),
            Path::new("/repo"),
            Some("kiro-cli"),
            Some("src/app.ts"),
        )
        .expect("candidate should be present")
        .expect("Kiro single-file location should reconcile the malformed rooted path");

        assert_eq!(result.entries[0].path, "src/app.ts");

        let mismatched_kiro = admit_runtime_diff_with_file_operation_path(
            &json!({
                "runtimeDiff": {
                    "adapterKind": "kiro-cli",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "semanticKind": "complete_before_after",
                    "entries": [{
                        "path": "/src/other.ts",
                        "oldText": "before\n",
                        "newText": "after\n"
                    }]
                }
            }),
            Path::new("/repo"),
            Some("kiro-cli"),
            Some("src/app.ts"),
        )
        .expect("candidate should be present")
        .expect("a real absolute cross-root Kiro path should remain absolute");
        assert_eq!(mismatched_kiro.entries[0].path, "/src/other.ts");

        let qoder = admit_runtime_diff_with_file_operation_path(
            &json!({
                "runtimeDiff": {
                    "adapterKind": "qoder-cli",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "semanticKind": "complete_before_after",
                    "entries": [{
                        "path": "/src/app.ts",
                        "oldText": "before\n",
                        "newText": "after\n"
                    }]
                }
            }),
            Path::new("/repo"),
            Some("qoder-cli"),
            Some("src/app.ts"),
        )
        .expect("candidate should be present")
        .expect("ACP adapters should retain an absolute path outside the display root");
        assert_eq!(qoder.entries[0].path, "/src/app.ts");
    }

    #[test]
    fn generated_unified_diff_uses_absolute_headers_for_cross_root_files() {
        let patch =
            unified_diff_from_complete_states("/outside/app.ts", Some("before\n"), Some("after\n"))
                .expect("different complete states should produce a patch");
        assert!(patch.starts_with("--- /outside/app.ts\n+++ /outside/app.ts\n"));
        assert!(!patch.contains("a//outside"));
    }

    #[test]
    fn complete_before_after_generates_a_bounded_inline_patch() {
        let patch = unified_diff_from_before_after(
            "src/app.ts",
            Some("one\ntwo\nthree\n"),
            "one\nchanged\nthree\n",
        );
        assert!(patch.contains("-two\n+changed"));
        assert_eq!(unified_diff_counts(&patch), (1, 1));
    }

    #[test]
    fn full_before_after_evidence_preserves_source_states_and_rebuilds_command_diff() {
        let admitted = admit_runtime_diff(
            &json!({
                "runtimeDiff": {
                    "adapterKind": "qoder-cli",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "semanticKind": "complete_before_after",
                    "entries": [{
                        "path": "src/app.ts",
                        "oldText": "before\n",
                        "newText": "after\n"
                    }]
                }
            }),
            Path::new("/repo"),
            Some("qoder-cli"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            admitted.evidence_entries.pointer("/0/semantics"),
            Some(&json!("full_before_after"))
        );
        assert_eq!(
            admitted.evidence_entries.pointer("/0/before"),
            Some(&json!("before\n"))
        );
        assert!(admitted.evidence_entries.pointer("/0/diff").is_none());

        let projection = projection_from_evidence(
            &json!({
                "runtimeDiff": {
                    "schemaVersion": COMMAND_DIFF_SCHEMA_VERSION,
                    "status": "available",
                    "semanticKind": "complete_before_after",
                    "entries": admitted.evidence_entries
                }
            }),
            "full-state-evidence",
        )
        .expect("full state Evidence should derive a Command Diff projection");
        assert!(
            projection.entries.unwrap()[0]
                .diff
                .contains("-before\n+after")
        );
    }

    #[test]
    fn complete_before_after_preserves_a_trailing_newline_only_change() {
        let patch = unified_diff_from_before_after("src/app.ts", Some("same\n"), "same");
        assert!(patch.contains("-same\n+same\n\\ No newline at end of file\n"));
        assert_eq!(unified_diff_counts(&patch), (1, 1));
    }

    #[test]
    fn acp_empty_new_content_is_not_guessed_to_mean_file_deletion() {
        let result = admit_runtime_diff(
            &json!({
                "runtimeDiff": {
                    "adapterKind": "cursor-agent",
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "semanticKind": "complete_before_after",
                    "entries": [{"path": "empty.txt", "oldText": "content\n", "newText": ""}]
                }
            }),
            Path::new("/repo"),
            Some("cursor-agent"),
        )
        .expect("candidate should be present")
        .expect("candidate should be admitted");
        assert_eq!(result.entries[0].change_kind, "update");
        assert_eq!(
            (result.entries[0].additions, result.entries[0].deletions),
            (0, 1)
        );
    }

    #[test]
    fn every_acp_adapter_uses_the_standard_terminal_diff_content_contract() {
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
            let payload = json!({
                "runtimeDiff": {
                    "adapterKind": adapter.as_str(),
                    "protocolFamily": "acp-v1",
                    "sourceEventKind": "session/update.tool_call_update.completed",
                    "semanticKind": "complete_before_after",
                    "entries": [{
                        "path": "src/app.ts",
                        "oldText": "before\n",
                        "newText": "after\n"
                    }]
                }
            });
            let admitted = admit_runtime_diff(&payload, Path::new("/repo"), Some(adapter.as_str()))
                .expect("ACP diff candidate should exist")
                .unwrap_or_else(|reason| {
                    panic!("{} should be admitted: {reason}", adapter.as_str())
                });
            assert_eq!(admitted.entries.len(), 1);
            assert_eq!(
                (admitted.entries[0].additions, admitted.entries[0].deletions),
                (1, 1)
            );
        }
    }

    #[test]
    fn claude_successful_edit_is_admitted_as_an_exact_mutation_without_fake_hunks() {
        let payload = json!({
            "runtimeDiff": {
                "adapterKind": "claude-code-cli",
                "protocolFamily": "claude-stream-json",
                "sourceEventKind": "assistant.tool_use.Edit+user.tool_result.completed",
                "semanticKind": "exact_mutation",
                "entries": [{
                    "semantics": "exact_mutation",
                    "path": "/repo/src/app.ts",
                    "oldText": "const enabled = false",
                    "newText": "const enabled = true"
                }]
            }
        });
        let admitted = admit_runtime_diff(&payload, Path::new("/repo"), Some("claude-code-cli"))
            .expect("candidate should be present")
            .expect("Claude Edit exact mutation should be admitted");

        assert_eq!(admitted.semantic_kind, "exact_mutation");
        assert_eq!(admitted.entries[0].path, "src/app.ts");
        assert_eq!(
            (admitted.entries[0].additions, admitted.entries[0].deletions),
            (1, 1)
        );
        assert_eq!(
            admitted.entries[0].diff,
            "-const enabled = false\n+const enabled = true\n"
        );
        assert!(!admitted.entries[0].diff.contains("@@"));
        assert_eq!(
            admitted.evidence_entries.pointer("/0/semantics"),
            Some(&json!("exact_mutation"))
        );
        assert_eq!(
            admitted.evidence_entries.pointer("/0/oldText"),
            Some(&json!("const enabled = false"))
        );

        let projection = projection_from_evidence(
            &json!({
                "runtimeDiff": {
                    "schemaVersion": 1,
                    "source": "runtime_reported",
                    "status": "available",
                    "semanticKind": "exact_mutation",
                    "entries": admitted.evidence_entries
                }
            }),
            "evidence-claude-edit",
        )
        .expect("exact mutation Evidence should produce a projection");
        assert_eq!(projection.semantic_kind.as_deref(), Some("exact_mutation"));
        assert_eq!(
            projection.entries.as_ref().unwrap()[0].diff,
            "-const enabled = false\n+const enabled = true\n"
        );
    }

    #[test]
    fn claude_exact_mutation_rejects_replace_all_and_incomplete_content() {
        for entry in [
            json!({
                "semantics": "exact_mutation",
                "path": "src/app.ts",
                "oldText": "before",
                "newText": "after",
                "replace_all": true
            }),
            json!({
                "semantics": "exact_mutation",
                "path": "src/app.ts",
                "oldText": "before",
                "newText": "after",
                "replaceAll": "false"
            }),
            json!({
                "semantics": "exact_mutation",
                "path": "src/app.ts",
                "oldText": "before"
            }),
        ] {
            let payload = json!({
                "runtimeDiff": {
                    "adapterKind": "claude-code-cli",
                    "protocolFamily": "claude-stream-json",
                    "sourceEventKind": "assistant.tool_use.Edit+user.tool_result.completed",
                    "semanticKind": "exact_mutation",
                    "entries": [entry]
                }
            });
            assert!(
                admit_runtime_diff(&payload, Path::new("/repo"), Some("claude-code-cli"))
                    .expect("candidate should be present")
                    .is_err()
            );
        }
    }

    #[test]
    fn antigravity_stream_json_cannot_promote_tool_inputs_into_diff_evidence() {
        let payload = json!({
            "runtimeDiff": {
                "adapterKind": "antigravity-app",
                "protocolFamily": "stream-json",
                "sourceEventKind": "tool/result.completed",
                "semanticKind": "complete_before_after",
                "entries": [{"path": "src/app.ts", "oldText": "before", "newText": "after"}]
            }
        });
        assert_eq!(
            admit_runtime_diff(&payload, Path::new("/repo"), Some("antigravity-app"))
                .expect("candidate should be present"),
            Err("runtime_diff_source_not_allowlisted")
        );
    }

    #[test]
    fn projection_merge_keeps_lineage_and_fails_closed_on_conflicting_terminal_snapshots() {
        let admitted = AdmittedCommandDiff {
            semantic_kind: "unified_diff_snapshot".to_string(),
            entries: vec![NormalizedDiffEntry {
                path: "src/app.ts".to_string(),
                change_kind: "update".to_string(),
                additions: 1,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+new\n".to_string(),
            }],
            evidence_entries: Value::Null,
        };
        let first = projection_from_admitted(admitted.clone(), "evidence-1");
        let replayed = merge_projection(
            Some(first.clone()),
            projection_from_admitted(admitted, "evidence-2"),
        );
        assert_eq!(replayed.revision, 1);
        assert_eq!(replayed.source_evidence_ids, ["evidence-1", "evidence-2"]);

        let conflicting = merge_projection(
            Some(replayed),
            projection_from_admitted(
                AdmittedCommandDiff {
                    semantic_kind: "unified_diff_snapshot".to_string(),
                    entries: vec![NormalizedDiffEntry {
                        path: "src/app.ts".to_string(),
                        change_kind: "update".to_string(),
                        additions: 1,
                        deletions: 1,
                        diff: "@@ -1 +1 @@\n-old\n+different\n".to_string(),
                    }],
                    evidence_entries: Value::Null,
                },
                "evidence-3",
            ),
        );
        assert_eq!(conflicting.revision, 2);
        assert_eq!(conflicting.status, "conflict");
        assert!(conflicting.entries.is_none());
        assert_eq!(
            conflicting.safe_reason_code.as_deref(),
            Some("runtime_diff_conflicting_terminal_snapshots")
        );
    }
}
