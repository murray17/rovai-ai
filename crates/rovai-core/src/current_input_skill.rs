use std::{collections::HashSet, path::Path};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

use crate::{
    agent_profile::AdapterKind,
    agent_runtime_adapter::{AgentRuntimeAdapterRegistry, SkillDeliveryGroupKey},
    camp_content::StructuredCampMessageSegment,
    command::canonical_json_digest,
    skill_projection::PreparedSkillExposure,
};

pub const SKILL_SELECTION_SCHEMA_VERSION: i64 = 1;
pub const CURRENT_INPUT_SKILL_RESOLUTION_SCHEMA_VERSION: i64 = 1;
pub const EMPTY_SKILL_SELECTION_JSON: &str = r#"{"schemaVersion":1,"entries":[]}"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillSelectionOmissionReason {
    MissingAtSend,
    InactiveAtSend,
    DisabledAtSend,
    NameMismatchAtSend,
    RuntimeGroupUnassignedAtSend,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillSelectionEntry {
    pub skill_id: String,
    pub name_at_send: String,
    pub first_segment_index: usize,
    pub eligible_at_send: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub omission_reason: Option<SkillSelectionOmissionReason>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillSelectionSnapshot {
    pub schema_version: i64,
    pub entries: Vec<SkillSelectionEntry>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CurrentInputSkillResolutionOutcome {
    Included,
    Omitted,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentInputSkillResolutionEntry {
    pub skill_id: String,
    pub name_at_send: String,
    pub first_segment_index: usize,
    pub eligible_at_send: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub send_omission_reason: Option<SkillSelectionOmissionReason>,
    pub run_availability: RunSkillAvailabilityView,
    pub outcome: CurrentInputSkillResolutionOutcome,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentInputSkillResolution {
    pub schema_version: i64,
    pub selection_snapshot_digest: String,
    pub skill_exposure_digest: String,
    pub entries: Vec<CurrentInputSkillResolutionEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentInputSkillLink {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedCurrentInputSkillResolution {
    pub resolution: CurrentInputSkillResolution,
    pub digest: String,
    pub links: Vec<CurrentInputSkillLink>,
}

pub fn freeze_skill_selection(
    transaction: &Transaction<'_>,
    content: &[StructuredCampMessageSegment],
    adapter_kind: AdapterKind,
) -> Result<SkillSelectionSnapshot> {
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
            eligible_at_send: omission_reason.is_none(),
            omission_reason,
        });
    }
    let snapshot = SkillSelectionSnapshot {
        schema_version: SKILL_SELECTION_SCHEMA_VERSION,
        entries,
    };
    validate_selection_snapshot(&snapshot)?;
    Ok(snapshot)
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
        });
        entries.push(entry);
    }
    let resolution = CurrentInputSkillResolution {
        schema_version: CURRENT_INPUT_SKILL_RESOLUTION_SCHEMA_VERSION,
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

pub fn validate_persisted_resolution(
    resolution_json: &str,
    expected_digest: &str,
    selection: &SkillSelectionSnapshot,
    selection_digest: &str,
    exposure_digest: &str,
) -> Result<CurrentInputSkillResolution> {
    let resolution: CurrentInputSkillResolution = serde_json::from_str(resolution_json)
        .context("Stored ContextManifest Current Input Skill resolution is invalid")?;
    if resolution.schema_version != CURRENT_INPUT_SKILL_RESOLUTION_SCHEMA_VERSION
        || resolution.selection_snapshot_digest != selection_digest
        || resolution.skill_exposure_digest != exposure_digest
        || canonical_json_digest(&serde_json::to_value(&resolution)?)? != expected_digest
    {
        anyhow::bail!("Stored ContextManifest Current Input Skill resolution is inconsistent");
    }
    if resolution.entries.len() != selection.entries.len() {
        anyhow::bail!("Stored ContextManifest Current Input Skill resolution is incomplete");
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
    if snapshot.schema_version != SKILL_SELECTION_SCHEMA_VERSION {
        anyhow::bail!("unsupported AgentRun Skill selection snapshot version");
    }
    let mut seen = HashSet::new();
    let mut previous_index = None;
    for entry in &snapshot.entries {
        if entry.skill_id.is_empty()
            || entry.skill_id.trim() != entry.skill_id
            || entry.skill_id.len() > 256
        {
            anyhow::bail!("AgentRun Skill selection has an invalid Skill ID");
        }
        crate::skill::validate_skill_name(&entry.name_at_send)?;
        if !seen.insert(entry.skill_id.as_str())
            || previous_index.is_some_and(|previous| entry.first_segment_index <= previous)
            || entry.eligible_at_send == entry.omission_reason.is_some()
        {
            anyhow::bail!("AgentRun Skill selection entries are inconsistent");
        }
        previous_index = Some(entry.first_segment_index);
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
