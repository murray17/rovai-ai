use std::{collections::HashSet, path::Path};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize, Serializer};
use serde_json::{Value, json};

use crate::{
    agent_profile::AdapterKind,
    agent_runtime_adapter::{AgentRuntimeAdapterRegistry, SkillDeliveryGroupKey},
    camp_content::StructuredCampMessageSegment,
    command::canonical_json_digest,
    skill_projection::PreparedSkillExposure,
};

pub const SKILL_SELECTION_SCHEMA_VERSION: i64 = 2;
pub const CURRENT_INPUT_SKILL_RESOLUTION_SCHEMA_VERSION: i64 = 2;
pub const EMPTY_SKILL_SELECTION_JSON: &str = r#"{"entries":[],"schemaVersion":2}"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillSource {
    Rovai,
    Native,
    Legacy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillSelectionOmissionReason {
    MissingAtSend,
    InactiveAtSend,
    DisabledAtSend,
    NameMismatchAtSend,
    RuntimeGroupUnassignedAtSend,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillSelectionEntry {
    pub skill_id: String,
    pub name_at_send: String,
    pub first_segment_index: usize,
    #[serde(default)]
    pub first_message_index: usize,
    #[serde(default)]
    pub source: Option<SkillSource>,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default = "bool_true")]
    pub eligible_at_send: bool,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub omission_reason: Option<SkillSelectionOmissionReason>,
}

fn bool_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillSelectionSnapshot {
    pub schema_version: i64,
    pub entries: Vec<SkillSelectionEntry>,
}

impl Serialize for SkillSelectionSnapshot {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let entries: Vec<Value> = self
            .entries
            .iter()
            .map(|entry| {
                if self.schema_version == 2 {
                    json!({
                        "skillId": entry.skill_id, "nameAtSend": entry.name_at_send,
                        "source": entry.source, "sourcePath": entry.source_path,
                        "firstMessageIndex": entry.first_message_index,
                        "firstSegmentIndex": entry.first_segment_index,
                    })
                } else {
                    let mut value = json!({
                        "skillId": entry.skill_id, "nameAtSend": entry.name_at_send,
                        "firstSegmentIndex": entry.first_segment_index,
                        "eligibleAtSend": entry.eligible_at_send,
                    });
                    if let Some(reason) = entry.omission_reason {
                        value["omissionReason"] = json!(reason);
                    }
                    value
                }
            })
            .collect();
        json!({"schemaVersion":self.schema_version,"entries":entries}).serialize(serializer)
    }
}

impl Default for SkillSelectionSnapshot {
    fn default() -> Self {
        Self {
            schema_version: SKILL_SELECTION_SCHEMA_VERSION,
            entries: Vec::new(),
        }
    }
}

impl SkillSelectionSnapshot {
    pub fn canonical_digest(&self) -> Result<String> {
        validate_selection_snapshot(self)?;
        canonical_json_digest(&serde_json::to_value(self)?)
    }

    pub fn canonical_json_and_digest(&self) -> Result<(String, String)> {
        Ok((serde_json::to_string(self)?, self.canonical_digest()?))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum RunSkillAvailabilityView {
    Missing,
    Present {
        active: bool,
        enabled: bool,
        name: String,
        #[serde(rename = "matchingGroupKeys")]
        matching_group_keys: Vec<String>,
    },
}
impl Default for RunSkillAvailabilityView {
    fn default() -> Self {
        Self::Missing
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CurrentInputSkillResolutionOutcome {
    Included,
    Omitted,
    Available,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CurrentInputSkillOmissionReason {
    NotEligibleAtSend,
    MissingAtStart,
    InactiveAtStart,
    DisabledAtStart,
    NameMismatchAtStart,
    RuntimeGroupUnassignedAtStart,
    ExposureMissing,
    ExposureNameMismatch,
    ExposureNotReady,
    ExposureGroupIncompatible,
    SkillFileUnavailable,
    SourceMissing,
    SourceUnreadable,
    LegacyUnresolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentInputSkillResolutionEntry {
    pub skill_id: String,
    pub name_at_send: String,
    #[serde(default)]
    pub first_segment_index: usize,
    #[serde(default)]
    pub source: Option<SkillSource>,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default = "bool_true")]
    pub eligible_at_send: bool,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub send_omission_reason: Option<SkillSelectionOmissionReason>,
    #[serde(default)]
    pub run_availability: RunSkillAvailabilityView,
    pub outcome: CurrentInputSkillResolutionOutcome,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<CurrentInputSkillOmissionReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivered_via_group_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentInputSkillResolution {
    pub schema_version: i64,
    pub selection_snapshot_digest: String,
    #[serde(default)]
    pub skill_exposure_digest: String,
    pub entries: Vec<CurrentInputSkillResolutionEntry>,
}

impl Serialize for CurrentInputSkillResolution {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        if self.schema_version == 2 {
            let entries: Vec<Value> = self
                .entries
                .iter()
                .map(|entry| {
                    let mut value = json!({
                        "skillId": entry.skill_id, "nameAtSend": entry.name_at_send,
                        "source": entry.source, "sourcePath": entry.source_path,
                        "outcome": entry.outcome,
                    });
                    if let Some(reason) = entry.reason {
                        value["reason"] = json!(reason);
                    }
                    value
                })
                .collect();
            json!({"schemaVersion": 2, "selectionSnapshotDigest": self.selection_snapshot_digest,
                "entries": entries})
            .serialize(serializer)
        } else {
            let entries: Vec<Value> = self
                .entries
                .iter()
                .map(|entry| {
                    let mut value = json!({
                        "skillId": entry.skill_id, "nameAtSend": entry.name_at_send,
                        "firstSegmentIndex": entry.first_segment_index,
                        "eligibleAtSend": entry.eligible_at_send,
                        "runAvailability": entry.run_availability, "outcome": entry.outcome,
                    });
                    for (key, field) in [
                        ("sendOmissionReason", json!(entry.send_omission_reason)),
                        ("reason", json!(entry.reason)),
                        ("path", json!(entry.path)),
                        ("revisionId", json!(entry.revision_id)),
                        ("contentDigest", json!(entry.content_digest)),
                        ("groupKey", json!(entry.group_key)),
                        ("deliveredViaGroupKey", json!(entry.delivered_via_group_key)),
                    ] {
                        if !field.is_null() {
                            value[key] = field;
                        }
                    }
                    value
                })
                .collect();
            json!({"schemaVersion":self.schema_version,
                "selectionSnapshotDigest":self.selection_snapshot_digest,
                "skillExposureDigest":self.skill_exposure_digest,"entries":entries})
            .serialize(serializer)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentInputSkillLink {
    pub name: String,
    pub path: String,
    #[serde(skip)]
    pub skill_id: Option<String>,
    #[serde(skip)]
    pub message_index: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedCurrentInputSkillResolution {
    pub resolution: CurrentInputSkillResolution,
    pub digest: String,
    pub links: Vec<CurrentInputSkillLink>,
}

/// Builds the same Runtime-facing Skill links used by `RUN_INPUT` while a
/// Delivery batch is still being selected. Projection reconciliation happens
/// later at execution preparation, but its destination is deterministic from
/// the frozen adapter and execution root.
pub(crate) fn projected_skill_links_for_claim(
    connection: &Connection,
    selection: &SkillSelectionSnapshot,
    adapter_kind: AdapterKind,
    execution_root: &Path,
) -> Result<Vec<CurrentInputSkillLink>> {
    validate_selection_snapshot(selection)?;
    if selection.schema_version == 2 {
        return Ok(selection
            .entries
            .iter()
            .filter_map(|entry| {
                resolve_v2_source(connection, entry, adapter_kind)
                    .ok()
                    .and_then(|result| result.ok())
                    .map(|path| CurrentInputSkillLink {
                        name: entry.name_at_send.clone(),
                        path,
                        skill_id: Some(entry.skill_id.clone()),
                        message_index: Some(entry.first_message_index),
                    })
            })
            .collect());
    }
    let delivery_groups = AgentRuntimeAdapterRegistry::default()
        .skill_discovery(adapter_kind)
        .delivery_groups;
    let canonical_root = execution_root
        .canonicalize()
        .unwrap_or_else(|_| execution_root.to_path_buf());
    let mut links = Vec::new();
    for selected in &selection.entries {
        if !selected.eligible_at_send {
            continue;
        }
        let Some(state) = load_skill_state(connection, &selected.skill_id, &delivery_groups)?
        else {
            continue;
        };
        if state.lifecycle_status != "active"
            || !state.enabled
            || state.name != selected.name_at_send
        {
            continue;
        }
        let Some(group) = delivery_groups.iter().find(|group| {
            state
                .matching_group_keys
                .iter()
                .any(|key| key == group.as_str())
        }) else {
            continue;
        };
        links.push(CurrentInputSkillLink {
            name: selected.name_at_send.clone(),
            path: canonical_root
                .join(group.relative_path())
                .join(&selected.name_at_send)
                .join("SKILL.md")
                .to_string_lossy()
                .to_string(),
            skill_id: None,
            message_index: None,
        });
    }
    Ok(links)
}

pub fn freeze_skill_selection(
    transaction: &Transaction<'_>,
    content: &[StructuredCampMessageSegment],
    adapter_kind: AdapterKind,
) -> Result<SkillSelectionSnapshot> {
    freeze_skill_selection_with_messages(
        transaction,
        content,
        &vec![0; content.len()],
        adapter_kind,
    )
}

pub fn freeze_skill_selection_with_messages(
    transaction: &Transaction<'_>,
    content: &[StructuredCampMessageSegment],
    message_indices: &[usize],
    adapter_kind: AdapterKind,
) -> Result<SkillSelectionSnapshot> {
    anyhow::ensure!(
        content.len() == message_indices.len(),
        "Skill selection message positions are incomplete"
    );
    let v2_available: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_skill_reference')",
        [], |row| row.get(0)
    )?;
    if v2_available {
        return freeze_skill_selection_v2(transaction, content, message_indices);
    }
    let delivery_groups = AgentRuntimeAdapterRegistry::default()
        .skill_discovery(adapter_kind)
        .delivery_groups;
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    for (index, segment) in content.iter().enumerate() {
        let StructuredCampMessageSegment::SkillMention {
            skill_id,
            name_at_send,
        } = segment
        else {
            continue;
        };
        if !seen.insert(skill_id.as_str()) {
            continue;
        }
        let state = load_skill_state(transaction, skill_id, &delivery_groups)?;
        let omission_reason = match state {
            None => Some(SkillSelectionOmissionReason::MissingAtSend),
            Some(ref state) if state.lifecycle_status != "active" => {
                Some(SkillSelectionOmissionReason::InactiveAtSend)
            }
            Some(ref state) if !state.enabled => Some(SkillSelectionOmissionReason::DisabledAtSend),
            Some(ref state) if state.name != *name_at_send => {
                Some(SkillSelectionOmissionReason::NameMismatchAtSend)
            }
            Some(ref state) if state.matching_group_keys.is_empty() => {
                Some(SkillSelectionOmissionReason::RuntimeGroupUnassignedAtSend)
            }
            Some(_) => None,
        };
        entries.push(SkillSelectionEntry {
            skill_id: skill_id.clone(),
            name_at_send: name_at_send.clone(),
            first_segment_index: index,
            first_message_index: 0,
            source: None,
            source_path: None,
            eligible_at_send: omission_reason.is_none(),
            omission_reason,
        });
    }
    let snapshot = SkillSelectionSnapshot {
        schema_version: 1,
        entries,
    };
    validate_selection_snapshot(&snapshot)?;
    Ok(snapshot)
}

fn freeze_skill_selection_v2(
    transaction: &Transaction<'_>,
    content: &[StructuredCampMessageSegment],
    message_indices: &[usize],
) -> Result<SkillSelectionSnapshot> {
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    let db_path: String = transaction.query_row("PRAGMA database_list", [], |row| row.get(2))?;
    let managed_root = Path::new(&db_path)
        .parent()
        .filter(|_| !db_path.is_empty())
        .and_then(|data_dir| crate::managed_skills::managed_skills_root(data_dir).ok());
    for (index, segment) in content.iter().enumerate() {
        let StructuredCampMessageSegment::SkillMention {
            skill_id,
            name_at_send,
        } = segment
        else {
            continue;
        };
        if !seen.insert(skill_id.as_str()) {
            continue;
        }
        let (source, source_path) = if let Some(name) = skill_id.strip_prefix("rovai:") {
            let trusted =
                name == name_at_send && crate::managed_skills::TOOLBOX_SKILLS.contains(&name);
            (
                SkillSource::Rovai,
                trusted
                    .then(|| {
                        managed_root.as_ref().map(|root| {
                            root.join(name)
                                .join("SKILL.md")
                                .to_string_lossy()
                                .into_owned()
                        })
                    })
                    .flatten(),
            )
        } else if skill_id.starts_with("native:") {
            let registered: Option<(String, String, String)> = transaction.query_row(
                "SELECT name, entry_path, canonical_path FROM native_skill_reference WHERE id = ?1",
                [skill_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            ).optional()?;
            let path = registered.and_then(|(name, entry, canonical)| {
                (name == *name_at_send && native_identity(&canonical) == *skill_id).then_some(entry)
            });
            (SkillSource::Native, path)
        } else {
            (SkillSource::Legacy, None)
        };
        entries.push(SkillSelectionEntry {
            skill_id: skill_id.clone(),
            name_at_send: name_at_send.clone(),
            first_message_index: message_indices[index],
            first_segment_index: content[..index]
                .iter()
                .enumerate()
                .rev()
                .take_while(|(previous, _)| message_indices[*previous] == message_indices[index])
                .count(),
            source: Some(source),
            source_path,
            eligible_at_send: true,
            omission_reason: None,
        });
    }
    let snapshot = SkillSelectionSnapshot {
        schema_version: 2,
        entries,
    };
    validate_selection_snapshot(&snapshot)?;
    Ok(snapshot)
}

fn native_identity(canonical: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("native:{:x}", Sha256::digest(canonical.as_bytes()))
}

pub fn parse_skill_selection_snapshot(
    snapshot_json: &str,
    expected_digest: &str,
) -> Result<SkillSelectionSnapshot> {
    let snapshot: SkillSelectionSnapshot = serde_json::from_str(snapshot_json)
        .context("AgentRun Skill selection snapshot is invalid")?;
    validate_selection_snapshot(&snapshot)?;
    if snapshot.canonical_digest()? != expected_digest {
        anyhow::bail!("AgentRun Skill selection snapshot digest is invalid");
    }
    Ok(snapshot)
}

pub fn resolve_current_input_skills(
    connection: &Connection,
    selection: &SkillSelectionSnapshot,
    selection_digest: &str,
    exposure: &PreparedSkillExposure,
    adapter_kind: AdapterKind,
) -> Result<PreparedCurrentInputSkillResolution> {
    validate_selection_snapshot(selection)?;
    if selection.canonical_digest()? != selection_digest {
        anyhow::bail!("AgentRun Skill selection snapshot digest is invalid");
    }
    if selection.schema_version == 2 {
        return resolve_current_input_skills_v2(
            connection,
            selection,
            selection_digest,
            adapter_kind,
        );
    }
    if exposure.snapshot.schema_version != 2
        || canonical_json_digest(&serde_json::to_value(&exposure.snapshot)?)? != exposure.digest
    {
        anyhow::bail!("Prepared Skill exposure digest is invalid");
    }
    let delivery_groups = AgentRuntimeAdapterRegistry::default()
        .skill_discovery(adapter_kind)
        .delivery_groups;
    let mut entries = Vec::with_capacity(selection.entries.len());
    let mut links = Vec::new();
    for selected in &selection.entries {
        let availability = load_skill_state(connection, &selected.skill_id, &delivery_groups)?
            .map_or(RunSkillAvailabilityView::Missing, |state| {
                RunSkillAvailabilityView::Present {
                    active: state.lifecycle_status == "active",
                    enabled: state.enabled,
                    name: state.name,
                    matching_group_keys: state.matching_group_keys,
                }
            });
        let mut entry = CurrentInputSkillResolutionEntry {
            skill_id: selected.skill_id.clone(),
            name_at_send: selected.name_at_send.clone(),
            first_segment_index: selected.first_segment_index,
            source: None,
            source_path: None,
            eligible_at_send: selected.eligible_at_send,
            send_omission_reason: selected.omission_reason,
            run_availability: availability,
            outcome: CurrentInputSkillResolutionOutcome::Omitted,
            reason: None,
            path: None,
            revision_id: None,
            content_digest: None,
            group_key: None,
            delivered_via_group_key: None,
        };
        if let Some(reason) = start_omission_reason(selected, &entry.run_availability) {
            entry.reason = Some(reason);
            entries.push(entry);
            continue;
        }
        let matching_groups = match &entry.run_availability {
            RunSkillAvailabilityView::Present {
                matching_group_keys,
                ..
            } => matching_group_keys,
            RunSkillAvailabilityView::Missing => unreachable!("missing availability was omitted"),
        };
        let by_id = exposure
            .snapshot
            .skills
            .iter()
            .filter(|candidate| candidate.skill_id == selected.skill_id)
            .collect::<Vec<_>>();
        if by_id.is_empty() {
            entry.reason = Some(CurrentInputSkillOmissionReason::ExposureMissing);
            entries.push(entry);
            continue;
        }
        let by_name = by_id
            .into_iter()
            .filter(|candidate| candidate.name == selected.name_at_send)
            .collect::<Vec<_>>();
        if by_name.is_empty() {
            entry.reason = Some(CurrentInputSkillOmissionReason::ExposureNameMismatch);
            entries.push(entry);
            continue;
        }
        let ready = by_name
            .into_iter()
            .filter(|candidate| candidate.status == "ready")
            .collect::<Vec<_>>();
        if ready.is_empty() {
            entry.reason = Some(CurrentInputSkillOmissionReason::ExposureNotReady);
            entries.push(entry);
            continue;
        }
        let mut compatible = ready
            .into_iter()
            .filter_map(|candidate| {
                matching_groups
                    .iter()
                    .position(|group| {
                        group == &candidate.group_key
                            || candidate.delivered_via_group_key.as_ref() == Some(group)
                    })
                    .map(|precedence| (precedence, candidate))
            })
            .collect::<Vec<_>>();
        if compatible.is_empty() {
            entry.reason = Some(CurrentInputSkillOmissionReason::ExposureGroupIncompatible);
            entries.push(entry);
            continue;
        }
        compatible.sort_by(|(left_precedence, left), (right_precedence, right)| {
            left_precedence.cmp(right_precedence).then_with(|| {
                match (&left.entry_path, &right.entry_path) {
                    (Some(left), Some(right)) => left.as_bytes().cmp(right.as_bytes()),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => std::cmp::Ordering::Equal,
                }
            })
        });
        let candidate = compatible[0].1;
        let Some(entry_path) = candidate.entry_path.as_deref() else {
            entry.reason = Some(CurrentInputSkillOmissionReason::SkillFileUnavailable);
            entries.push(entry);
            continue;
        };
        let skill_file = Path::new(entry_path).join("SKILL.md");
        if !trusted_skill_file_is_available(&skill_file) {
            entry.reason = Some(CurrentInputSkillOmissionReason::SkillFileUnavailable);
            entries.push(entry);
            continue;
        }
        let skill_file = skill_file.to_string_lossy().to_string();
        entry.outcome = CurrentInputSkillResolutionOutcome::Included;
        entry.path = Some(skill_file.clone());
        entry.revision_id = Some(candidate.revision_id.clone());
        entry.content_digest = Some(candidate.content_digest.clone());
        entry.group_key = Some(candidate.group_key.clone());
        entry.delivered_via_group_key = candidate.delivered_via_group_key.clone();
        links.push(CurrentInputSkillLink {
            name: selected.name_at_send.clone(),
            path: skill_file,
            skill_id: None,
            message_index: None,
        });
        entries.push(entry);
    }
    let resolution = CurrentInputSkillResolution {
        schema_version: 1,
        selection_snapshot_digest: selection_digest.to_string(),
        skill_exposure_digest: exposure.digest.clone(),
        entries,
    };
    let digest = canonical_json_digest(&serde_json::to_value(&resolution)?)?;
    Ok(PreparedCurrentInputSkillResolution {
        resolution,
        digest,
        links,
    })
}

fn resolve_current_input_skills_v2(
    connection: &Connection,
    selection: &SkillSelectionSnapshot,
    selection_digest: &str,
    adapter_kind: AdapterKind,
) -> Result<PreparedCurrentInputSkillResolution> {
    let mut entries = Vec::with_capacity(selection.entries.len());
    let mut links = Vec::new();
    for selected in &selection.entries {
        let result = resolve_v2_source(connection, selected, adapter_kind)?;
        let (outcome, reason, path) = match result {
            Ok(path) => (
                CurrentInputSkillResolutionOutcome::Available,
                None,
                Some(path),
            ),
            Err(reason) => (
                CurrentInputSkillResolutionOutcome::Unavailable,
                Some(reason),
                None,
            ),
        };
        if let Some(path) = &path {
            links.push(CurrentInputSkillLink {
                name: selected.name_at_send.clone(),
                path: path.clone(),
                skill_id: Some(selected.skill_id.clone()),
                message_index: Some(selected.first_message_index),
            });
        }
        entries.push(CurrentInputSkillResolutionEntry {
            skill_id: selected.skill_id.clone(),
            name_at_send: selected.name_at_send.clone(),
            first_segment_index: selected.first_segment_index,
            source: selected.source,
            source_path: selected.source_path.clone(),
            eligible_at_send: true,
            send_omission_reason: None,
            run_availability: RunSkillAvailabilityView::Missing,
            outcome,
            reason,
            path,
            revision_id: None,
            content_digest: None,
            group_key: None,
            delivered_via_group_key: None,
        });
    }
    let resolution = CurrentInputSkillResolution {
        schema_version: 2,
        selection_snapshot_digest: selection_digest.to_owned(),
        skill_exposure_digest: String::new(),
        entries,
    };
    let digest = canonical_json_digest(&serde_json::to_value(&resolution)?)?;
    Ok(PreparedCurrentInputSkillResolution {
        resolution,
        digest,
        links,
    })
}

fn resolve_v2_source(
    connection: &Connection,
    selected: &SkillSelectionEntry,
    adapter_kind: AdapterKind,
) -> Result<std::result::Result<String, CurrentInputSkillOmissionReason>> {
    use CurrentInputSkillOmissionReason as Reason;
    let Some(source) = selected.source else {
        return Ok(Err(Reason::SourceMissing));
    };
    if source == SkillSource::Legacy {
        return Ok(Err(Reason::LegacyUnresolved));
    }
    let Some(path) = selected.source_path.as_deref() else {
        return Ok(Err(Reason::SourceMissing));
    };
    let entry = Path::new(path);
    if !entry.is_absolute() || entry.file_name().is_none_or(|name| name != "SKILL.md") {
        return Ok(Err(Reason::SourceMissing));
    }
    if !entry.exists() {
        return Ok(Err(Reason::SourceMissing));
    }
    if !entry.is_file() {
        return Ok(Err(Reason::SourceUnreadable));
    }
    match source {
        SkillSource::Rovai => {
            let Some(name) = selected.skill_id.strip_prefix("rovai:") else {
                return Ok(Err(Reason::SourceMissing));
            };
            if name != selected.name_at_send
                || !crate::managed_skills::TOOLBOX_SKILLS.contains(&name)
            {
                return Ok(Err(Reason::SourceMissing));
            }
            let db_path: String =
                connection.query_row("PRAGMA database_list", [], |row| row.get(2))?;
            let expected = Path::new(&db_path)
                .parent()
                .filter(|_| !db_path.is_empty())
                .and_then(|dir| crate::managed_skills::managed_skills_root(dir).ok())
                .map(|root| root.join(name).join("SKILL.md"));
            if expected.as_deref() != Some(entry) {
                return Ok(Err(Reason::SourceMissing));
            }
            if crate::managed_skills::read_frontmatter(entry, name).is_err() {
                return Ok(Err(Reason::SourceUnreadable));
            }
        }
        SkillSource::Native => {
            let Ok(canonical) = entry.canonicalize() else {
                return Ok(Err(Reason::SourceUnreadable));
            };
            if native_identity(&canonical.to_string_lossy()) != selected.skill_id {
                return Ok(Err(Reason::SourceMissing));
            }
            let Ok(skill) =
                crate::native_skills::read_native_skill(entry, &canonical, "user", adapter_kind)
            else {
                return Ok(Err(Reason::SourceUnreadable));
            };
            if skill.name != selected.name_at_send {
                return Ok(Err(Reason::SourceMissing));
            }
        }
        SkillSource::Legacy => unreachable!(),
    }
    Ok(Ok(path.to_owned()))
}

pub fn validate_persisted_resolution(
    resolution_json: &str,
    expected_digest: &str,
    selection: &SkillSelectionSnapshot,
    selection_digest: &str,
    exposure_digest: &str,
) -> Result<CurrentInputSkillResolution> {
    let resolution: CurrentInputSkillResolution = serde_json::from_str(resolution_json)
        .context("Stored ContextManifest Current Input Skill resolution is invalid")?;
    if resolution.schema_version != selection.schema_version
        || resolution.selection_snapshot_digest != selection_digest
        || (resolution.schema_version == 1 && resolution.skill_exposure_digest != exposure_digest)
        || canonical_json_digest(&serde_json::to_value(&resolution)?)? != expected_digest
    {
        anyhow::bail!("Stored ContextManifest Current Input Skill resolution is inconsistent");
    }
    if resolution.entries.len() != selection.entries.len() {
        anyhow::bail!("Stored ContextManifest Current Input Skill resolution is incomplete");
    }
    if resolution.schema_version == 2 {
        for (entry, selected) in resolution.entries.iter().zip(&selection.entries) {
            if entry.skill_id != selected.skill_id
                || entry.name_at_send != selected.name_at_send
                || entry.source != selected.source
                || entry.source_path != selected.source_path
                || !matches!(
                    (entry.outcome, entry.reason),
                    (CurrentInputSkillResolutionOutcome::Available, None)
                        | (
                            CurrentInputSkillResolutionOutcome::Unavailable,
                            Some(
                                CurrentInputSkillOmissionReason::SourceMissing
                                    | CurrentInputSkillOmissionReason::SourceUnreadable
                                    | CurrentInputSkillOmissionReason::LegacyUnresolved
                            )
                        )
                )
            {
                anyhow::bail!("Stored ContextManifest Skill source resolution is inconsistent");
            }
        }
        return Ok(resolution);
    }
    for (entry, selected) in resolution.entries.iter().zip(&selection.entries) {
        if entry.skill_id != selected.skill_id
            || entry.name_at_send != selected.name_at_send
            || entry.first_segment_index != selected.first_segment_index
            || entry.eligible_at_send != selected.eligible_at_send
            || entry.send_omission_reason != selected.omission_reason
        {
            anyhow::bail!("Stored ContextManifest Current Input Skill selection reference changed");
        }
        let included_shape = entry.outcome == CurrentInputSkillResolutionOutcome::Included
            && entry.reason.is_none()
            && entry.path.as_deref().is_some_and(|path| {
                Path::new(path).is_absolute()
                    && Path::new(path)
                        .file_name()
                        .is_some_and(|name| name == "SKILL.md")
            })
            && entry
                .revision_id
                .as_deref()
                .is_some_and(|value| !value.is_empty())
            && entry
                .content_digest
                .as_deref()
                .is_some_and(|value| !value.is_empty())
            && entry.group_key.as_deref().is_some_and(|group| {
                let RunSkillAvailabilityView::Present {
                    matching_group_keys,
                    ..
                } = &entry.run_availability
                else {
                    return false;
                };
                matching_group_keys.iter().any(|matching| {
                    matching == group || entry.delivered_via_group_key.as_ref() == Some(matching)
                })
            });
        let omitted_shape = entry.outcome == CurrentInputSkillResolutionOutcome::Omitted
            && entry.reason.is_some()
            && entry.path.is_none()
            && entry.revision_id.is_none()
            && entry.content_digest.is_none()
            && entry.group_key.is_none()
            && entry.delivered_via_group_key.is_none();
        if !included_shape && !omitted_shape {
            anyhow::bail!("Stored ContextManifest Current Input Skill outcome is malformed");
        }
        match start_omission_reason(selected, &entry.run_availability) {
            Some(expected)
                if entry.outcome != CurrentInputSkillResolutionOutcome::Omitted
                    || entry.reason != Some(expected) =>
            {
                anyhow::bail!(
                    "Stored ContextManifest Current Input Skill availability outcome changed"
                );
            }
            Some(_) => {}
            None if entry.outcome == CurrentInputSkillResolutionOutcome::Omitted
                && !matches!(
                    entry.reason,
                    Some(
                        CurrentInputSkillOmissionReason::ExposureMissing
                            | CurrentInputSkillOmissionReason::ExposureNameMismatch
                            | CurrentInputSkillOmissionReason::ExposureNotReady
                            | CurrentInputSkillOmissionReason::ExposureGroupIncompatible
                            | CurrentInputSkillOmissionReason::SkillFileUnavailable
                    )
                ) =>
            {
                anyhow::bail!(
                    "Stored ContextManifest Current Input Skill omission reason is invalid"
                );
            }
            None => {}
        }
    }
    Ok(resolution)
}

#[derive(Debug)]
struct SkillState {
    name: String,
    lifecycle_status: String,
    enabled: bool,
    matching_group_keys: Vec<String>,
}

fn load_skill_state(
    connection: &Connection,
    skill_id: &str,
    delivery_groups: &[SkillDeliveryGroupKey],
) -> Result<Option<SkillState>> {
    let row = connection
        .query_row(
            "SELECT name, lifecycle_status, enabled FROM skill WHERE id = ?1",
            [skill_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((name, lifecycle_status, enabled)) = row else {
        return Ok(None);
    };
    let mut matching_group_keys = Vec::new();
    for group in delivery_groups {
        let assigned: bool = connection.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM skill_group_assignment
                WHERE skill_id = ?1 AND group_key = ?2
            )
            "#,
            params![skill_id, group.as_str()],
            |row| row.get(0),
        )?;
        if assigned {
            matching_group_keys.push(group.as_str().to_string());
        }
    }
    Ok(Some(SkillState {
        name,
        lifecycle_status,
        enabled,
        matching_group_keys,
    }))
}

fn validate_selection_snapshot(snapshot: &SkillSelectionSnapshot) -> Result<()> {
    if !matches!(snapshot.schema_version, 1 | 2) {
        anyhow::bail!("unsupported AgentRun Skill selection snapshot version");
    }
    let mut seen = HashSet::new();
    let mut previous_position = None;
    for entry in &snapshot.entries {
        if entry.skill_id.is_empty()
            || entry.skill_id.trim() != entry.skill_id
            || entry.skill_id.len() > 256
        {
            anyhow::bail!("AgentRun Skill selection has an invalid Skill ID");
        }
        crate::skill::validate_skill_name(&entry.name_at_send)?;
        let position = (entry.first_message_index, entry.first_segment_index);
        if !seen.insert(entry.skill_id.as_str())
            || previous_position.is_some_and(|previous| position <= previous)
            || (snapshot.schema_version == 1
                && entry.eligible_at_send == entry.omission_reason.is_some())
            || (snapshot.schema_version == 2
                && (entry.source.is_none()
                    || !entry.eligible_at_send
                    || entry.omission_reason.is_some()
                    || entry
                        .source_path
                        .as_deref()
                        .is_some_and(|path| !Path::new(path).is_absolute())))
        {
            anyhow::bail!("AgentRun Skill selection entries are inconsistent");
        }
        previous_position = Some(position);
    }
    Ok(())
}

fn start_omission_reason(
    selected: &SkillSelectionEntry,
    availability: &RunSkillAvailabilityView,
) -> Option<CurrentInputSkillOmissionReason> {
    if !selected.eligible_at_send {
        return Some(CurrentInputSkillOmissionReason::NotEligibleAtSend);
    }
    match availability {
        RunSkillAvailabilityView::Missing => Some(CurrentInputSkillOmissionReason::MissingAtStart),
        RunSkillAvailabilityView::Present { active: false, .. } => {
            Some(CurrentInputSkillOmissionReason::InactiveAtStart)
        }
        RunSkillAvailabilityView::Present { enabled: false, .. } => {
            Some(CurrentInputSkillOmissionReason::DisabledAtStart)
        }
        RunSkillAvailabilityView::Present { name, .. } if name != &selected.name_at_send => {
            Some(CurrentInputSkillOmissionReason::NameMismatchAtStart)
        }
        RunSkillAvailabilityView::Present {
            matching_group_keys,
            ..
        } if matching_group_keys.is_empty() => {
            Some(CurrentInputSkillOmissionReason::RuntimeGroupUnassignedAtStart)
        }
        RunSkillAvailabilityView::Present { .. } => None,
    }
}

fn trusted_skill_file_is_available(path: &Path) -> bool {
    path.is_absolute()
        && path.file_name().and_then(|name| name.to_str()) == Some("SKILL.md")
        && path.metadata().is_ok_and(|metadata| metadata.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skill_projection::{SkillExposureEntry, SkillExposureSnapshot};
    use uuid::Uuid;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE skill(
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    lifecycle_status TEXT NOT NULL,
                    enabled INTEGER NOT NULL
                );
                CREATE TABLE skill_group_assignment(
                    group_key TEXT NOT NULL,
                    skill_id TEXT NOT NULL,
                    PRIMARY KEY(group_key, skill_id)
                );
                "#,
            )
            .unwrap();
        connection
    }

    #[test]
    fn empty_selection_digest_is_stable() {
        let snapshot = SkillSelectionSnapshot::default();
        assert_eq!(
            snapshot.canonical_json_and_digest().unwrap().0,
            EMPTY_SKILL_SELECTION_JSON
        );
        assert_eq!(snapshot.canonical_digest().unwrap().len(), 64);
    }

    #[test]
    fn send_snapshot_deduplicates_identity_and_freezes_recipient_eligibility() {
        let mut connection = connection();
        connection
            .execute_batch(
                r#"
                INSERT INTO skill(id, name, lifecycle_status, enabled) VALUES
                    ('ready', 'review-pr', 'active', 1),
                    ('inactive', 'retired-skill', 'deleting', 0),
                    ('disabled', 'current-grilling', 'active', 0),
                    ('renamed', 'new-name', 'active', 1),
                    ('unassigned', 'worktree', 'active', 1);
                INSERT INTO skill_group_assignment(group_key, skill_id) VALUES
                    ('opencode', 'ready'),
                    ('opencode', 'renamed');
                "#,
            )
            .unwrap();
        let transaction = connection.transaction().unwrap();
        let snapshot = freeze_skill_selection(
            &transaction,
            &[
                StructuredCampMessageSegment::Text {
                    text: "先 ".to_string(),
                },
                StructuredCampMessageSegment::SkillMention {
                    skill_id: "ready".to_string(),
                    name_at_send: "review-pr".to_string(),
                },
                StructuredCampMessageSegment::SkillMention {
                    skill_id: "ready".to_string(),
                    name_at_send: "ignored-duplicate".to_string(),
                },
                StructuredCampMessageSegment::SkillMention {
                    skill_id: "inactive".to_string(),
                    name_at_send: "retired-skill".to_string(),
                },
                StructuredCampMessageSegment::SkillMention {
                    skill_id: "disabled".to_string(),
                    name_at_send: "grilling".to_string(),
                },
                StructuredCampMessageSegment::SkillMention {
                    skill_id: "renamed".to_string(),
                    name_at_send: "old-name".to_string(),
                },
                StructuredCampMessageSegment::SkillMention {
                    skill_id: "unassigned".to_string(),
                    name_at_send: "worktree".to_string(),
                },
                StructuredCampMessageSegment::SkillMention {
                    skill_id: "missing".to_string(),
                    name_at_send: "missing".to_string(),
                },
            ],
            AdapterKind::OpencodeCli,
        )
        .unwrap();
        let codex_recipient = freeze_skill_selection(
            &transaction,
            &[StructuredCampMessageSegment::SkillMention {
                skill_id: "ready".to_string(),
                name_at_send: "review-pr".to_string(),
            }],
            AdapterKind::CodexCli,
        )
        .unwrap();
        transaction.commit().unwrap();

        assert_eq!(snapshot.entries.len(), 6);
        assert_eq!(snapshot.entries[0].first_segment_index, 1);
        assert!(snapshot.entries[0].eligible_at_send);
        assert_eq!(
            snapshot.entries[1].omission_reason,
            Some(SkillSelectionOmissionReason::InactiveAtSend)
        );
        assert_eq!(
            snapshot.entries[2].omission_reason,
            Some(SkillSelectionOmissionReason::DisabledAtSend)
        );
        assert_eq!(
            snapshot.entries[3].omission_reason,
            Some(SkillSelectionOmissionReason::NameMismatchAtSend)
        );
        assert_eq!(
            snapshot.entries[4].omission_reason,
            Some(SkillSelectionOmissionReason::RuntimeGroupUnassignedAtSend)
        );
        assert_eq!(
            snapshot.entries[5].omission_reason,
            Some(SkillSelectionOmissionReason::MissingAtSend)
        );
        assert_eq!(
            codex_recipient.entries[0].omission_reason,
            Some(SkillSelectionOmissionReason::RuntimeGroupUnassignedAtSend)
        );
    }

    #[test]
    fn resolver_uses_group_precedence_and_late_disable_only_omits_the_link() {
        let mut connection = connection();
        connection
            .execute_batch(
                r#"
                INSERT INTO skill(id, name, lifecycle_status, enabled)
                VALUES ('skill-1', 'review-pr', 'active', 1);
                INSERT INTO skill_group_assignment(group_key, skill_id) VALUES
                    ('opencode', 'skill-1'),
                    ('claude_compatible', 'skill-1');
                "#,
            )
            .unwrap();
        let transaction = connection.transaction().unwrap();
        let selection = freeze_skill_selection(
            &transaction,
            &[StructuredCampMessageSegment::SkillMention {
                skill_id: "skill-1".to_string(),
                name_at_send: "review-pr".to_string(),
            }],
            AdapterKind::OpencodeCli,
        )
        .unwrap();
        transaction.commit().unwrap();
        let selection_digest = selection.canonical_digest().unwrap();

        let root = std::env::temp_dir().join(format!(
            "rovai-current-input-skill-resolution-{}",
            Uuid::new_v4()
        ));
        let opencode = root.join("opencode/review-pr");
        let claude = root.join("claude/review-pr");
        std::fs::create_dir_all(&opencode).unwrap();
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::write(opencode.join("SKILL.md"), "opencode").unwrap();
        std::fs::write(claude.join("SKILL.md"), "claude").unwrap();
        let exposure_snapshot = SkillExposureSnapshot {
            schema_version: 2,
            skills: vec![
                SkillExposureEntry {
                    skill_id: "skill-1".to_string(),
                    name: "review-pr".to_string(),
                    revision_id: "revision-1".to_string(),
                    content_digest: "sha256:one".to_string(),
                    group_key: "opencode".to_string(),
                    delivered_via_group_key: None,
                    status: "ready".to_string(),
                    entry_path: None,
                    reason_code: None,
                    conflict_statuses: Vec::new(),
                },
                SkillExposureEntry {
                    skill_id: "skill-1".to_string(),
                    name: "review-pr".to_string(),
                    revision_id: "revision-1".to_string(),
                    content_digest: "sha256:one".to_string(),
                    group_key: "claude_compatible".to_string(),
                    delivered_via_group_key: None,
                    status: "ready".to_string(),
                    entry_path: Some(claude.to_string_lossy().to_string()),
                    reason_code: None,
                    conflict_statuses: Vec::new(),
                },
                SkillExposureEntry {
                    skill_id: "skill-1".to_string(),
                    name: "review-pr".to_string(),
                    revision_id: "revision-1".to_string(),
                    content_digest: "sha256:one".to_string(),
                    group_key: "opencode".to_string(),
                    delivered_via_group_key: None,
                    status: "ready".to_string(),
                    entry_path: Some(opencode.to_string_lossy().to_string()),
                    reason_code: None,
                    conflict_statuses: Vec::new(),
                },
            ],
        };
        let exposure = PreparedSkillExposure {
            digest: canonical_json_digest(&serde_json::to_value(&exposure_snapshot).unwrap())
                .unwrap(),
            snapshot: exposure_snapshot,
        };

        let included = resolve_current_input_skills(
            &connection,
            &selection,
            &selection_digest,
            &exposure,
            AdapterKind::OpencodeCli,
        )
        .unwrap();
        assert_eq!(
            included.links,
            [CurrentInputSkillLink {
                name: "review-pr".to_string(),
                path: opencode.join("SKILL.md").to_string_lossy().to_string(),
                skill_id: None,
                message_index: None,
            }]
        );
        assert_eq!(
            included.resolution.entries[0].outcome,
            CurrentInputSkillResolutionOutcome::Included
        );

        let forwarded = root.join("forwarded/review-pr");
        std::fs::create_dir_all(&forwarded).unwrap();
        std::fs::write(forwarded.join("SKILL.md"), "forwarded").unwrap();
        let forwarded_snapshot = SkillExposureSnapshot {
            schema_version: 2,
            skills: vec![SkillExposureEntry {
                skill_id: "skill-1".to_string(),
                name: "review-pr".to_string(),
                revision_id: "revision-forwarded".to_string(),
                content_digest: "sha256:forwarded".to_string(),
                group_key: "codex".to_string(),
                delivered_via_group_key: Some("opencode".to_string()),
                status: "ready".to_string(),
                entry_path: Some(forwarded.to_string_lossy().to_string()),
                reason_code: None,
                conflict_statuses: Vec::new(),
            }],
        };
        let forwarded_exposure = PreparedSkillExposure {
            digest: canonical_json_digest(&serde_json::to_value(&forwarded_snapshot).unwrap())
                .unwrap(),
            snapshot: forwarded_snapshot,
        };
        let forwarded_resolution = resolve_current_input_skills(
            &connection,
            &selection,
            &selection_digest,
            &forwarded_exposure,
            AdapterKind::OpencodeCli,
        )
        .unwrap();
        assert_eq!(
            forwarded_resolution.links[0].path,
            forwarded.join("SKILL.md").to_string_lossy()
        );
        assert_eq!(
            forwarded_resolution.resolution.entries[0]
                .delivered_via_group_key
                .as_deref(),
            Some("opencode")
        );

        let mut tampered_exposure = exposure.clone();
        tampered_exposure.digest = "0".repeat(64);
        assert!(
            resolve_current_input_skills(
                &connection,
                &selection,
                &selection_digest,
                &tampered_exposure,
                AdapterKind::OpencodeCli,
            )
            .unwrap_err()
            .to_string()
            .contains("exposure digest")
        );

        connection
            .execute("UPDATE skill SET enabled = 0 WHERE id = 'skill-1'", [])
            .unwrap();
        let omitted = resolve_current_input_skills(
            &connection,
            &selection,
            &selection_digest,
            &exposure,
            AdapterKind::OpencodeCli,
        )
        .unwrap();
        assert!(omitted.links.is_empty());
        assert_eq!(
            omitted.resolution.entries[0].reason,
            Some(CurrentInputSkillOmissionReason::DisabledAtStart)
        );
        assert_eq!(omitted.resolution.entries[0].send_omission_reason, None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolver_records_each_omission_reason_without_changing_selection_order() {
        let connection = connection();
        connection
            .execute_batch(
                r#"
                INSERT INTO skill(id, name, lifecycle_status, enabled) VALUES
                    ('ineligible', 'ineligible', 'active', 1),
                    ('inactive', 'inactive', 'deleting', 1),
                    ('disabled', 'disabled', 'active', 0),
                    ('renamed', 'new-name', 'active', 1),
                    ('unassigned', 'unassigned', 'active', 1),
                    ('exposure-missing', 'exposure-missing', 'active', 1),
                    ('exposure-name', 'exposure-name', 'active', 1),
                    ('exposure-not-ready', 'exposure-not-ready', 'active', 1),
                    ('exposure-incompatible', 'exposure-incompatible', 'active', 1),
                    ('file-unavailable', 'file-unavailable', 'active', 1);
                INSERT INTO skill_group_assignment(group_key, skill_id) VALUES
                    ('opencode', 'ineligible'),
                    ('opencode', 'inactive'),
                    ('opencode', 'disabled'),
                    ('opencode', 'renamed'),
                    ('opencode', 'exposure-missing'),
                    ('opencode', 'exposure-name'),
                    ('opencode', 'exposure-not-ready'),
                    ('opencode', 'exposure-incompatible'),
                    ('opencode', 'file-unavailable');
                "#,
            )
            .unwrap();
        let definitions = [
            (
                "ineligible",
                "ineligible",
                false,
                Some(SkillSelectionOmissionReason::DisabledAtSend),
            ),
            ("missing", "missing", true, None),
            ("inactive", "inactive", true, None),
            ("disabled", "disabled", true, None),
            ("renamed", "old-name", true, None),
            ("unassigned", "unassigned", true, None),
            ("exposure-missing", "exposure-missing", true, None),
            ("exposure-name", "exposure-name", true, None),
            ("exposure-not-ready", "exposure-not-ready", true, None),
            ("exposure-incompatible", "exposure-incompatible", true, None),
            ("file-unavailable", "file-unavailable", true, None),
        ];
        let selection = SkillSelectionSnapshot {
            schema_version: 1,
            entries: definitions
                .into_iter()
                .enumerate()
                .map(
                    |(first_segment_index, (skill_id, name_at_send, eligible, reason))| {
                        SkillSelectionEntry {
                            skill_id: skill_id.to_string(),
                            name_at_send: name_at_send.to_string(),
                            first_segment_index,
                            first_message_index: 0,
                            source: None,
                            source_path: None,
                            eligible_at_send: eligible,
                            omission_reason: reason,
                        }
                    },
                )
                .collect(),
        };
        let selection_digest = selection.canonical_digest().unwrap();
        let exposure_snapshot = SkillExposureSnapshot {
            schema_version: 2,
            skills: vec![
                SkillExposureEntry {
                    skill_id: "exposure-name".to_string(),
                    name: "other-name".to_string(),
                    revision_id: "revision-name".to_string(),
                    content_digest: "sha256:name".to_string(),
                    group_key: "opencode".to_string(),
                    delivered_via_group_key: None,
                    status: "ready".to_string(),
                    entry_path: None,
                    reason_code: None,
                    conflict_statuses: Vec::new(),
                },
                SkillExposureEntry {
                    skill_id: "exposure-not-ready".to_string(),
                    name: "exposure-not-ready".to_string(),
                    revision_id: "revision-not-ready".to_string(),
                    content_digest: "sha256:not-ready".to_string(),
                    group_key: "opencode".to_string(),
                    delivered_via_group_key: None,
                    status: "shadowed".to_string(),
                    entry_path: None,
                    reason_code: Some("shadowed".to_string()),
                    conflict_statuses: vec!["shadowed".to_string()],
                },
                SkillExposureEntry {
                    skill_id: "exposure-incompatible".to_string(),
                    name: "exposure-incompatible".to_string(),
                    revision_id: "revision-incompatible".to_string(),
                    content_digest: "sha256:incompatible".to_string(),
                    group_key: "codex".to_string(),
                    delivered_via_group_key: None,
                    status: "ready".to_string(),
                    entry_path: None,
                    reason_code: None,
                    conflict_statuses: Vec::new(),
                },
                SkillExposureEntry {
                    skill_id: "file-unavailable".to_string(),
                    name: "file-unavailable".to_string(),
                    revision_id: "revision-file".to_string(),
                    content_digest: "sha256:file".to_string(),
                    group_key: "opencode".to_string(),
                    delivered_via_group_key: None,
                    status: "ready".to_string(),
                    entry_path: None,
                    reason_code: None,
                    conflict_statuses: Vec::new(),
                },
            ],
        };
        let exposure = PreparedSkillExposure {
            digest: canonical_json_digest(&serde_json::to_value(&exposure_snapshot).unwrap())
                .unwrap(),
            snapshot: exposure_snapshot,
        };
        let resolved = resolve_current_input_skills(
            &connection,
            &selection,
            &selection_digest,
            &exposure,
            AdapterKind::OpencodeCli,
        )
        .unwrap();

        assert!(resolved.links.is_empty());
        assert_eq!(
            resolved
                .resolution
                .entries
                .iter()
                .map(|entry| entry.reason.unwrap())
                .collect::<Vec<_>>(),
            vec![
                CurrentInputSkillOmissionReason::NotEligibleAtSend,
                CurrentInputSkillOmissionReason::MissingAtStart,
                CurrentInputSkillOmissionReason::InactiveAtStart,
                CurrentInputSkillOmissionReason::DisabledAtStart,
                CurrentInputSkillOmissionReason::NameMismatchAtStart,
                CurrentInputSkillOmissionReason::RuntimeGroupUnassignedAtStart,
                CurrentInputSkillOmissionReason::ExposureMissing,
                CurrentInputSkillOmissionReason::ExposureNameMismatch,
                CurrentInputSkillOmissionReason::ExposureNotReady,
                CurrentInputSkillOmissionReason::ExposureGroupIncompatible,
                CurrentInputSkillOmissionReason::SkillFileUnavailable,
            ]
        );
    }
}
