use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    process::Command,
    str::FromStr,
};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt, symlink};

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    agent_profile::AdapterKind,
    agent_runtime_adapter::{AgentRuntimeAdapterRegistry, SkillDeliveryGroupKey},
    command::{DomainCommand, canonical_json_digest, sealed},
    db::Database,
    skill::{SkillLibraryService, SkillView},
};

#[cfg(windows)]
#[path = "skill_projection/windows.rs"]
mod windows_projection;

const GIT_EXCLUDE_BEGIN: &str = "# BEGIN ROVAI MANAGED SKILL PROJECTIONS";
const GIT_EXCLUDE_END: &str = "# END ROVAI MANAGED SKILL PROJECTIONS";
const MANAGED_GIT_EXCLUDE_MARKERS: [(&str, &str); 3] = [
    (GIT_EXCLUDE_BEGIN, GIT_EXCLUDE_END),
    (
        "# BEGIN HORIZONWARD MANAGED SKILL PROJECTIONS",
        "# END HORIZONWARD MANAGED SKILL PROJECTIONS",
    ),
    (
        "# BEGIN LUMEN MANAGED SKILL PROJECTIONS",
        "# END LUMEN MANAGED SKILL PROJECTIONS",
    ),
];
#[cfg(unix)]
const MANAGED_TEMP_PREFIX: &str = ".rovai-skill-projection-";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReconcileSkillProjectionsCommand {}

impl sealed::Sealed for ReconcileSkillProjectionsCommand {}
impl DomainCommand for ReconcileSkillProjectionsCommand {
    const TYPE: &'static str = "skill.projections.reconcile";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRootSkillRequirement {
    pub execution_root: String,
    pub delivery_groups: Vec<SkillDeliveryGroupKey>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillProjectionObservationView {
    pub execution_root: String,
    pub group_key: SkillDeliveryGroupKey,
    pub skill_id: String,
    pub revision_id: String,
    pub entry_path: String,
    pub delivered_via_group_key: Option<SkillDeliveryGroupKey>,
    pub duplicate_visible: bool,
    pub state: String,
    pub last_error_code: Option<String>,
    pub last_observed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillProjectionReport {
    pub execution_root: String,
    pub active_run_present: bool,
    pub observations: Vec<SkillProjectionObservationView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillProjectionRootAccessResult {
    pub execution_root: String,
    pub access_state: String,
    pub cleanup_pending: bool,
}

#[derive(Debug)]
pub struct SkillProjectionGateBusy {
    execution_root: String,
}

impl std::fmt::Display for SkillProjectionGateBusy {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "Windows Skill projection is waiting for active Runs in {}",
            self.execution_root
        )
    }
}

impl std::error::Error for SkillProjectionGateBusy {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillProjectionIssue {
    pub execution_root: String,
    pub group_key: SkillDeliveryGroupKey,
    pub skill_id: String,
    pub skill_name: String,
    pub revision_id: String,
    pub entry_path: String,
    pub state: String,
    pub error_code: Option<String>,
    pub observed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillExposureEntry {
    pub skill_id: String,
    pub name: String,
    pub revision_id: String,
    pub content_digest: String,
    pub group_key: String,
    pub delivered_via_group_key: Option<String>,
    pub status: String,
    pub entry_path: Option<String>,
    pub reason_code: Option<String>,
    pub conflict_statuses: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillExposureSnapshot {
    pub schema_version: i64,
    pub skills: Vec<SkillExposureEntry>,
}

impl Default for SkillExposureSnapshot {
    fn default() -> Self {
        Self {
            schema_version: 2,
            skills: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedSkillExposure {
    pub snapshot: SkillExposureSnapshot,
    pub digest: String,
}

#[derive(Debug)]
struct ManagedEntry {
    skill_id: String,
    revision_id: String,
}

#[derive(Debug)]
enum EntryState {
    Missing,
    Managed(ManagedEntry),
    ProjectOwned(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReconcileRepairPolicy {
    PreserveProjectEntries,
    RepairRetiredLumenLinks,
}

#[derive(Debug, Default)]
pub struct SkillProjectionReconciler;

impl SkillProjectionReconciler {
    pub fn synchronize_removed_execution_roots(
        &self,
        database: &mut Database,
        removed_execution_roots: &[String],
    ) -> Result<()> {
        let removed_execution_roots = removed_execution_roots
            .iter()
            .map(|root| {
                validate_persisted_execution_root(root)?;
                Ok(root.clone())
            })
            .collect::<Result<BTreeSet<_>>>()?;
        let existing_removed = {
            let mut statement = database.connection().prepare(
                "SELECT execution_root FROM skill_projection_root_state WHERE access_state = 'removed'",
            )?;
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let now = Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        for execution_root in existing_removed {
            if removed_execution_roots.contains(&execution_root) {
                continue;
            }
            transaction.execute(
                r#"
                UPDATE skill_projection_root_state
                SET access_state = 'active', dirty = 1,
                    cleanup_required = 0, removed_at = NULL, updated_at = ?2
                WHERE execution_root = ?1 AND access_state = 'removed'
                "#,
                params![execution_root, now],
            )?;
        }
        for execution_root in removed_execution_roots {
            let observed: i64 = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM skill_projection_observation WHERE execution_root = ?1)",
                [&execution_root],
                |row| row.get(0),
            )?;
            transaction.execute(
                r#"
                INSERT INTO skill_projection_root_state(
                    execution_root, access_state, dirty,
                    cleanup_required, removed_at, updated_at
                ) VALUES (?1, 'removed', ?2, ?2, ?3, ?3)
                ON CONFLICT(execution_root) DO UPDATE SET
                    access_state = 'removed',
                    dirty = MAX(
                        skill_projection_root_state.cleanup_required,
                        excluded.dirty
                    ),
                    cleanup_required = MAX(
                        skill_projection_root_state.cleanup_required,
                        excluded.cleanup_required
                    ),
                    removed_at = COALESCE(skill_projection_root_state.removed_at, excluded.removed_at),
                    updated_at = excluded.updated_at
                "#,
                params![execution_root, observed, now],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn remove_execution_root(
        &self,
        database: &mut Database,
        library: &SkillLibraryService,
        execution_root: &Path,
    ) -> Result<SkillProjectionRootAccessResult> {
        let execution_root_text = execution_root.to_string_lossy().to_string();
        validate_persisted_execution_root(&execution_root_text)?;
        let observed: i64 = database.connection().query_row(
            "SELECT EXISTS(SELECT 1 FROM skill_projection_observation WHERE execution_root = ?1)",
            [&execution_root_text],
            |row| row.get(0),
        )?;
        upsert_root_access_state(
            database,
            &execution_root_text,
            "removed",
            observed != 0,
            observed != 0,
        )?;

        let mutation_blocked = if observed == 0 {
            false
        } else {
            match projection_mutation_blocked(database, execution_root, &execution_root_text, None)
            {
                Ok(blocked) => blocked,
                Err(error) => {
                    eprintln!(
                        "deferred removed Skill projection cleanup for {}: {error:#}",
                        execution_root.display()
                    );
                    true
                }
            }
        };
        if observed != 0 && !mutation_blocked {
            match self.reconcile_root_internal(
                database,
                library,
                execution_root,
                &[],
                None,
                ReconcileRepairPolicy::PreserveProjectEntries,
            ) {
                Ok(report) => {
                    if finish_reconciliation_state(database, &report)? {
                        self.finalize_deleting_skills(database, library)?;
                    }
                }
                Err(error) => eprintln!(
                    "failed to clean removed Skill projection root {}: {error:#}",
                    execution_root.display()
                ),
            }
        }
        let cleanup_pending = root_cleanup_pending(database, &execution_root_text)?;
        Ok(SkillProjectionRootAccessResult {
            execution_root: execution_root_text,
            access_state: "removed".to_string(),
            cleanup_pending,
        })
    }

    pub fn restore_execution_root(
        &self,
        database: &mut Database,
        execution_root: &str,
    ) -> Result<SkillProjectionRootAccessResult> {
        validate_persisted_execution_root(execution_root)?;
        upsert_root_access_state(database, execution_root, "active", true, false)?;
        Ok(SkillProjectionRootAccessResult {
            execution_root: execution_root.to_string(),
            access_state: "active".to_string(),
            cleanup_pending: false,
        })
    }

    pub fn execution_root_is_removed(
        &self,
        database: &Database,
        execution_root: &str,
    ) -> Result<bool> {
        root_access_is_removed(database, execution_root)
    }

    pub fn mark_observed_roots_dirty(
        &self,
        database: &mut Database,
        cleanup_required: bool,
    ) -> Result<usize> {
        let now = Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction()?;
        let inserted = transaction.execute(
            r#"
            INSERT INTO skill_projection_root_state(
                execution_root, access_state, dirty,
                cleanup_required, removed_at, updated_at
            )
            SELECT DISTINCT execution_root, 'active', 1, ?1, NULL, ?2
            FROM skill_projection_observation
            WHERE 1 = 1
            ON CONFLICT(execution_root) DO UPDATE SET
                dirty = 1,
                cleanup_required = MAX(
                    skill_projection_root_state.cleanup_required,
                    excluded.cleanup_required
                ),
                updated_at = excluded.updated_at
            "#,
            params![if cleanup_required { 1 } else { 0 }, now],
        )?;
        transaction.commit()?;
        Ok(inserted)
    }

    pub fn finalize_unprojected_deletions(
        &self,
        database: &mut Database,
        library: &SkillLibraryService,
    ) -> Result<()> {
        self.finalize_deleting_skills(database, library)
    }

    pub fn reconcile_after_run_terminal(
        &self,
        database: &mut Database,
        library: &SkillLibraryService,
        execution_root: &Path,
    ) -> Result<()> {
        let execution_root = execution_root.canonicalize().with_context(|| {
            format!(
                "Skill projection execution root is unavailable after Run terminal: {}",
                execution_root.display()
            )
        })?;
        let execution_root_text = execution_root.to_string_lossy().to_string();
        if !root_is_dirty(database, &execution_root_text)? {
            return Ok(());
        }
        let removed = root_access_is_removed(database, &execution_root_text)?;
        let active_run_present = has_active_run(database, &execution_root_text, None, None)?;
        if removed && active_run_present {
            return Ok(());
        }
        if cfg!(windows)
            && projection_mutation_blocked(database, &execution_root, &execution_root_text, None)?
        {
            return Ok(());
        }
        let required_delivery_groups = if removed {
            Vec::new()
        } else {
            let mut groups = observed_delivery_groups(database, &execution_root_text)?;
            groups.extend(active_run_delivery_groups(
                database,
                &execution_root_text,
                None,
            )?);
            groups.into_iter().collect()
        };
        let report = self.reconcile_root_internal(
            database,
            library,
            &execution_root,
            &required_delivery_groups,
            None,
            ReconcileRepairPolicy::PreserveProjectEntries,
        )?;
        if finish_reconciliation_state(database, &report)? {
            self.finalize_deleting_skills(database, library)?;
        }
        Ok(())
    }

    pub fn known_execution_roots(
        &self,
        database: &Database,
    ) -> Result<Vec<ExecutionRootSkillRequirement>> {
        let registry = AgentRuntimeAdapterRegistry::default();
        let mut requirements = BTreeMap::<String, BTreeSet<SkillDeliveryGroupKey>>::new();
        {
            let mut statement = database.connection().prepare(
                r#"
                SELECT DISTINCT camp.project_path, installation.adapter_kind
                FROM camp
                JOIN camp_member
                  ON camp_member.camp_id = camp.id
                 AND camp_member.status = 'active'
                 AND camp_member.leave_requested_at IS NULL
                JOIN agent_profile
                  ON agent_profile.id = camp_member.agent_id
                 AND agent_profile.profile_status = 'present'
                JOIN adapter_installation AS installation
                  ON installation.id = agent_profile.default_runtime_installation_id
                 AND installation.enabled = 1
                "#,
            )?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (execution_root, adapter_kind) = row?;
                let adapter_kind = AdapterKind::from_str(&adapter_kind)?;
                let capability = registry.skill_discovery(adapter_kind);
                requirements
                    .entry(execution_root)
                    .or_default()
                    .extend(capability.delivery_groups);
            }
        }
        {
            let mut statement = database.connection().prepare(
                r#"
                SELECT agent_run.workspace_json, camp.project_path,
                       agent_run.runtime_adapter_kind
                FROM agent_run
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                JOIN camp ON camp.id = camp_turn.camp_id
                WHERE agent_run.status IN ('running', 'waiting')
                  AND agent_run.runtime_adapter_kind IS NOT NULL
                "#,
            )?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;
            for row in rows {
                let (workspace_json, project_path, adapter_kind) = row?;
                let execution_root =
                    workspace_execution_root(workspace_json.as_deref()).unwrap_or(project_path);
                let capability = registry.skill_discovery(AdapterKind::from_str(&adapter_kind)?);
                requirements
                    .entry(execution_root)
                    .or_default()
                    .extend(capability.delivery_groups);
            }
        }
        let mut result = Vec::new();
        for (execution_root, delivery_groups) in requirements {
            if root_access_is_removed(database, &execution_root)? {
                continue;
            }
            result.push(ExecutionRootSkillRequirement {
                execution_root,
                delivery_groups: delivery_groups.into_iter().collect(),
            });
        }
        Ok(result)
    }

    pub fn reconcile_known_roots(
        &self,
        database: &mut Database,
        library: &SkillLibraryService,
    ) -> Result<Vec<SkillProjectionReport>> {
        let requirements = self.known_execution_roots(database)?;
        let mut reports = Vec::new();
        let mut all_roots_available = true;
        for requirement in requirements {
            let result = self
                .reconcile_root_internal(
                    database,
                    library,
                    Path::new(&requirement.execution_root),
                    &requirement.delivery_groups,
                    None,
                    ReconcileRepairPolicy::RepairRetiredLumenLinks,
                )
                .and_then(|report| {
                    finish_reconciliation_state(database, &report)?;
                    Ok(report)
                });
            match result {
                Ok(report) => reports.push(report),
                Err(error) => {
                    all_roots_available = false;
                    eprintln!(
                        "failed to reconcile Skill projections for {}: {error:#}",
                        requirement.execution_root
                    );
                }
            }
        }
        if all_roots_available {
            self.finalize_deleting_skills(database, library)?;
        }
        Ok(reports)
    }

    pub fn prepare_run_exposure(
        &self,
        database: &mut Database,
        library: &SkillLibraryService,
        agent_run_id: &str,
        execution_root: &Path,
        adapter_kind: AdapterKind,
    ) -> Result<PreparedSkillExposure> {
        let registry = AgentRuntimeAdapterRegistry::default();
        let capability = registry.skill_discovery(adapter_kind);
        let assigned_skills = library
            .list(database)?
            .into_iter()
            .filter(|skill| {
                skill.lifecycle_status == "active"
                    && skill.group_assignments.iter().any(|assignment| {
                        capability.delivery_groups.contains(&assignment.group_key)
                    })
            })
            .collect::<Vec<_>>();

        let requested_root_text = execution_root.to_string_lossy().to_string();
        if root_access_is_removed(database, &requested_root_text)? {
            anyhow::bail!(
                "Skill projection access is suspended for removed Project: {}",
                execution_root.display()
            );
        }
        let canonical_root = execution_root.canonicalize().with_context(|| {
            format!(
                "Skill projection execution root is unavailable: {}",
                execution_root.display()
            )
        })?;
        let canonical_root_text = canonical_root.to_string_lossy().to_string();
        if root_access_is_removed(database, &canonical_root_text)? {
            anyhow::bail!(
                "Skill projection access is suspended for removed Project: {}",
                canonical_root.display()
            );
        }
        let mut delivery_groups = capability
            .delivery_groups
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        delivery_groups.extend(active_run_delivery_groups(
            database,
            &canonical_root_text,
            Some(agent_run_id),
        )?);
        let report = self.reconcile_root_internal(
            database,
            library,
            &canonical_root,
            &delivery_groups.iter().copied().collect::<Vec<_>>(),
            Some(agent_run_id),
            ReconcileRepairPolicy::PreserveProjectEntries,
        )?;
        let reconciliation_finished = finish_reconciliation_state(database, &report)?;
        #[cfg(windows)]
        if !reconciliation_finished {
            return Err(SkillProjectionGateBusy {
                execution_root: canonical_root_text,
            }
            .into());
        }
        if reconciliation_finished {
            self.finalize_deleting_skills(database, library)?;
        }

        let mut entries = Vec::new();
        for group_key in &capability.delivery_groups {
            for skill in &assigned_skills {
                if !skill
                    .group_assignments
                    .iter()
                    .any(|assignment| assignment.group_key == *group_key)
                {
                    continue;
                }
                let observation =
                    load_observation(database, &canonical_root_text, *group_key, &skill.id)?;
                if !skill.enabled && observation.is_none() {
                    continue;
                }
                let (
                    revision_id,
                    content_digest,
                    delivered_via_group_key,
                    status,
                    entry_path,
                    reason_code,
                    conflict_statuses,
                ) = if let Some(observation) = observation {
                    let conflict_statuses = exposure_conflict_statuses(&observation);
                    let content_digest = database
                            .connection()
                            .query_row(
                                "SELECT content_digest FROM skill_revision WHERE id = ?1 AND skill_id = ?2",
                                params![observation.revision_id, skill.id],
                                |row| row.get::<_, String>(0),
                            )
                            .optional()?
                            .unwrap_or_else(|| skill.current_revision.content_digest.clone());
                    (
                        observation.revision_id,
                        content_digest,
                        observation
                            .delivered_via_group_key
                            .map(|value| value.as_str().to_string()),
                        normalize_exposure_status(&observation.state).to_string(),
                        Some(observation.entry_path),
                        observation.last_error_code,
                        conflict_statuses,
                    )
                } else {
                    (
                        skill.current_revision.id.clone(),
                        skill.current_revision.content_digest.clone(),
                        None,
                        "error".to_string(),
                        Some(
                            canonical_root
                                .join(group_key.relative_path())
                                .join(&skill.name)
                                .to_string_lossy()
                                .to_string(),
                        ),
                        Some("projection_observation_missing".to_string()),
                        vec!["error".to_string()],
                    )
                };
                entries.push(SkillExposureEntry {
                    skill_id: skill.id.clone(),
                    name: skill.name.clone(),
                    revision_id,
                    content_digest,
                    group_key: group_key.as_str().to_string(),
                    delivered_via_group_key,
                    status,
                    entry_path,
                    reason_code,
                    conflict_statuses,
                });
            }
        }
        entries.sort_by(|left, right| {
            left.group_key
                .cmp(&right.group_key)
                .then_with(|| left.name.cmp(&right.name))
                .then_with(|| left.skill_id.cmp(&right.skill_id))
        });
        let verification_failures = entries
            .iter()
            .filter(|entry| matches!(entry.status.as_str(), "error" | "stale"))
            .map(|entry| {
                format!(
                    "{} ({}, {})",
                    entry.name,
                    entry.group_key,
                    entry
                        .reason_code
                        .as_deref()
                        .unwrap_or(entry.status.as_str())
                )
            })
            .collect::<Vec<_>>();
        if !verification_failures.is_empty() {
            anyhow::bail!(
                "Skill projection verification failed: {}",
                verification_failures.join(", ")
            );
        }
        let snapshot = SkillExposureSnapshot {
            schema_version: 2,
            skills: entries,
        };
        let prepared = PreparedSkillExposure {
            digest: canonical_json_digest(&serde_json::to_value(&snapshot)?)?,
            snapshot,
        };
        #[cfg(windows)]
        if !capability.delivery_groups.is_empty() {
            windows_projection::register_run(database, &canonical_root, agent_run_id)?;
        }
        Ok(prepared)
    }

    pub fn reconcile_root(
        &self,
        database: &mut Database,
        library: &SkillLibraryService,
        execution_root: &Path,
        required_delivery_groups: &[SkillDeliveryGroupKey],
    ) -> Result<SkillProjectionReport> {
        let report = self.reconcile_root_internal(
            database,
            library,
            execution_root,
            required_delivery_groups,
            None,
            ReconcileRepairPolicy::PreserveProjectEntries,
        )?;
        finish_reconciliation_state(database, &report)?;
        Ok(report)
    }

    fn reconcile_root_internal(
        &self,
        database: &mut Database,
        library: &SkillLibraryService,
        execution_root: &Path,
        required_delivery_groups: &[SkillDeliveryGroupKey],
        ignored_agent_run_id: Option<&str>,
        repair_policy: ReconcileRepairPolicy,
    ) -> Result<SkillProjectionReport> {
        let execution_root = execution_root.canonicalize().with_context(|| {
            format!(
                "Skill projection execution root is unavailable: {}",
                execution_root.display()
            )
        })?;
        if !execution_root.is_dir() {
            anyhow::bail!(
                "Skill projection execution root is not a directory: {}",
                execution_root.display()
            );
        }
        let execution_root_text = execution_root.to_string_lossy().to_string();
        #[cfg(windows)]
        windows_projection::prune_run_registrations(database)?;
        let active_run_present = has_active_run(database, &execution_root_text, None, None)?;
        #[cfg(windows)]
        let mutation_allowed = !windows_projection::has_active_run_registration(
            database,
            &execution_root,
            ignored_agent_run_id,
        )?;
        #[cfg(not(windows))]
        let mutation_allowed = true;
        #[cfg(not(windows))]
        let _ = ignored_agent_run_id;
        #[cfg(windows)]
        windows_projection::recover_root(database, library, &execution_root, mutation_allowed)?;
        let required_delivery_groups = required_delivery_groups
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        let skills = library.list(database)?;
        let mut managed_git_entries = BTreeSet::new();

        // Claude-compatible discovery is shared by Claude, OpenCode and Copilot. Reconcile it
        // first so the latter groups can reuse a healthy .claude projection without duplicating
        // links in their runtime-specific directories.
        const RECONCILE_ORDER: [SkillDeliveryGroupKey; 13] = [
            SkillDeliveryGroupKey::ClaudeCompatible,
            SkillDeliveryGroupKey::Codex,
            SkillDeliveryGroupKey::Pi,
            SkillDeliveryGroupKey::Opencode,
            SkillDeliveryGroupKey::Copilot,
            SkillDeliveryGroupKey::Antigravity,
            SkillDeliveryGroupKey::Kiro,
            SkillDeliveryGroupKey::Qoder,
            SkillDeliveryGroupKey::Codebuddy,
            SkillDeliveryGroupKey::Qwen,
            SkillDeliveryGroupKey::Trae,
            SkillDeliveryGroupKey::Cursor,
            SkillDeliveryGroupKey::Kimi,
        ];
        for group_key in RECONCILE_ORDER {
            let native_root = execution_root.join(group_key.relative_path());
            cleanup_safe_temporary_links(database, library, &native_root)?;
            for skill in &skills {
                let desired = required_delivery_groups.contains(&group_key)
                    && skill.enabled
                    && skill.lifecycle_status == "active"
                    && skill
                        .group_assignments
                        .iter()
                        .any(|assignment| assignment.group_key == group_key);
                let entry_path = native_root.join(&skill.name);
                repair_retired_lumen_link_if_recorded(
                    database,
                    &execution_root_text,
                    group_key,
                    skill,
                    &entry_path,
                    repair_policy,
                )?;
                let state = inspect_entry(database, library, &entry_path)?;
                let claude_observation = if desired
                    && matches!(
                        group_key,
                        SkillDeliveryGroupKey::Opencode | SkillDeliveryGroupKey::Copilot
                    )
                    && required_delivery_groups.contains(&SkillDeliveryGroupKey::ClaudeCompatible)
                    && skill.group_assignments.iter().any(|assignment| {
                        assignment.group_key == SkillDeliveryGroupKey::ClaudeCompatible
                    }) {
                    load_observation(
                        database,
                        &execution_root_text,
                        SkillDeliveryGroupKey::ClaudeCompatible,
                        &skill.id,
                    )?
                    .filter(|observation| observation.state == "ready")
                } else {
                    None
                };
                if let Some(claude_observation) = claude_observation {
                    reconcile_undesired_entry(
                        database,
                        library,
                        &execution_root_text,
                        group_key,
                        skill,
                        &entry_path,
                        state,
                        mutation_allowed,
                    )?;
                    let pending_direct_removal =
                        load_observation(database, &execution_root_text, group_key, &skill.id)?
                            .is_some_and(|observation| observation.state == "pending_removal");
                    if !pending_direct_removal {
                        upsert_forwarded_observation(
                            database,
                            &execution_root_text,
                            group_key,
                            skill,
                            &claude_observation,
                            &entry_path,
                        )?;
                    }
                } else if desired {
                    reconcile_desired_entry(
                        database,
                        library,
                        &execution_root_text,
                        group_key,
                        skill,
                        &entry_path,
                        state,
                        mutation_allowed,
                    )?;
                } else {
                    reconcile_undesired_entry(
                        database,
                        library,
                        &execution_root_text,
                        group_key,
                        skill,
                        &entry_path,
                        state,
                        mutation_allowed,
                    )?;
                }
            }
            if native_root.is_dir() {
                collect_managed_git_entries(
                    database,
                    library,
                    &execution_root,
                    &native_root,
                    &mut managed_git_entries,
                )?;
            }
        }
        update_git_exclude(&execution_root, &managed_git_entries)?;
        Ok(SkillProjectionReport {
            execution_root: execution_root_text.clone(),
            active_run_present,
            observations: list_observations_for_root(database, &execution_root_text)?,
        })
    }

    pub fn list_issues(&self, database: &Database) -> Result<Vec<SkillProjectionIssue>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT observation.execution_root, observation.group_key,
                   observation.skill_id, skill.name, observation.revision_id,
                   observation.entry_path, observation.state,
                   observation.last_error_code, observation.last_observed_at
            FROM skill_projection_observation AS observation
            JOIN skill ON skill.id = observation.skill_id
            WHERE observation.state <> 'ready'
            ORDER BY observation.last_observed_at DESC,
                     observation.execution_root, skill.name
            "#,
        )?;
        Ok(statement
            .query_map([], |row| {
                let group_key = row.get::<_, String>(1)?;
                Ok(SkillProjectionIssue {
                    execution_root: row.get(0)?,
                    group_key: SkillDeliveryGroupKey::from_str(&group_key).map_err(to_sql_error)?,
                    skill_id: row.get(2)?,
                    skill_name: row.get(3)?,
                    revision_id: row.get(4)?,
                    entry_path: row.get(5)?,
                    state: row.get(6)?,
                    error_code: row.get(7)?,
                    observed_at: row.get(8)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn stored_diagnostic_summary(
        &self,
        database: &Database,
    ) -> Result<(usize, BTreeSet<String>)> {
        let mut codes = BTreeSet::new();
        let mut issue_count = 0usize;
        let mut statement = database.connection().prepare(
            r#"
            SELECT observation.last_error_code
            FROM skill_projection_observation AS observation
            LEFT JOIN skill_projection_root_state AS root_state
              ON root_state.execution_root = observation.execution_root
            WHERE observation.state <> 'ready'
              AND COALESCE(root_state.access_state, 'active') <> 'removed'
              AND (
                  EXISTS (
                      SELECT 1 FROM camp
                      WHERE camp.project_path = observation.execution_root
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM agent_run
                      JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                      JOIN camp ON camp.id = camp_turn.camp_id
                      WHERE agent_run.status IN ('running', 'waiting')
                        AND COALESCE(
                            json_extract(agent_run.workspace_json, '$.executionRoot'),
                            camp.project_path
                        ) = observation.execution_root
                  )
              )
            "#,
        )?;
        let rows = statement.query_map([], |row| row.get::<_, Option<String>>(0))?;
        for row in rows {
            issue_count += 1;
            codes.insert(row?.unwrap_or_else(|| "projection_not_ready".to_string()));
        }
        let dirty_count: i64 = database.connection().query_row(
            r#"
            SELECT COUNT(*)
            FROM skill_projection_root_state AS root_state
            WHERE root_state.access_state = 'active'
              AND root_state.dirty = 1
              AND (
                  EXISTS (
                      SELECT 1 FROM camp
                      WHERE camp.project_path = root_state.execution_root
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM agent_run
                      JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                      JOIN camp ON camp.id = camp_turn.camp_id
                      WHERE agent_run.status IN ('running', 'waiting')
                        AND COALESCE(
                            json_extract(agent_run.workspace_json, '$.executionRoot'),
                            camp.project_path
                        ) = root_state.execution_root
                  )
              )
            "#,
            [],
            |row| row.get(0),
        )?;
        if dirty_count > 0 {
            issue_count += dirty_count as usize;
            codes.insert("projection_dirty".to_string());
        }
        Ok((issue_count, codes))
    }

    /// Re-evaluate every known managed projection from filesystem and Library facts without
    /// reconciling links, updating observations, resuming Runs, or completing deletions.
    pub fn audit_known_roots(
        &self,
        database: &Database,
        library: &SkillLibraryService,
    ) -> Result<Vec<SkillProjectionIssue>> {
        const AUDIT_ORDER: [SkillDeliveryGroupKey; 13] = [
            SkillDeliveryGroupKey::ClaudeCompatible,
            SkillDeliveryGroupKey::Codex,
            SkillDeliveryGroupKey::Pi,
            SkillDeliveryGroupKey::Opencode,
            SkillDeliveryGroupKey::Copilot,
            SkillDeliveryGroupKey::Antigravity,
            SkillDeliveryGroupKey::Kiro,
            SkillDeliveryGroupKey::Qoder,
            SkillDeliveryGroupKey::Codebuddy,
            SkillDeliveryGroupKey::Qwen,
            SkillDeliveryGroupKey::Trae,
            SkillDeliveryGroupKey::Cursor,
            SkillDeliveryGroupKey::Kimi,
        ];

        let requirements = self.known_execution_roots(database)?;
        let skills = library.list(database)?;
        let now = Utc::now().to_rfc3339();
        let mut issues = Vec::new();
        let mut normalized_requirements =
            BTreeMap::<String, BTreeSet<SkillDeliveryGroupKey>>::new();

        for requirement in requirements {
            let canonical_root = match Path::new(&requirement.execution_root).canonicalize() {
                Ok(root) if root.is_dir() => root,
                _ => {
                    issues.push(SkillProjectionIssue {
                        execution_root: requirement.execution_root.clone(),
                        group_key: SkillDeliveryGroupKey::Codex,
                        skill_id: "execution-root".to_string(),
                        skill_name: "Skill execution root".to_string(),
                        revision_id: String::new(),
                        entry_path: requirement.execution_root,
                        state: "error".to_string(),
                        error_code: Some("execution_root_unavailable".to_string()),
                        observed_at: now.clone(),
                    });
                    continue;
                }
            };
            normalized_requirements
                .entry(canonical_root.to_string_lossy().to_string())
                .or_default()
                .extend(requirement.delivery_groups);
        }

        for (execution_root, required_groups) in normalized_requirements {
            let canonical_root = Path::new(&execution_root);
            let observations = list_observations_for_root(database, &execution_root)?;
            let observation_by_key = observations
                .iter()
                .map(|observation| {
                    (
                        (observation.group_key, observation.skill_id.as_str()),
                        observation,
                    )
                })
                .collect::<BTreeMap<_, _>>();

            for group_key in AUDIT_ORDER {
                for skill in &skills {
                    let desired = required_groups.contains(&group_key)
                        && skill.enabled
                        && skill.lifecycle_status == "active"
                        && skill
                            .group_assignments
                            .iter()
                            .any(|assignment| assignment.group_key == group_key);
                    let observation = observation_by_key
                        .get(&(group_key, skill.id.as_str()))
                        .copied();
                    if !desired {
                        if let Some(observation) = observation {
                            issues.push(issue_from_observation(
                                skill,
                                observation,
                                "pending_removal",
                                "projection_no_longer_desired",
                                &now,
                            ));
                        }
                        continue;
                    }

                    let Some(observation) = observation else {
                        issues.push(SkillProjectionIssue {
                            execution_root: execution_root.clone(),
                            group_key,
                            skill_id: skill.id.clone(),
                            skill_name: skill.name.clone(),
                            revision_id: skill.current_revision.id.clone(),
                            entry_path: canonical_root
                                .join(group_key.relative_path())
                                .join(&skill.name)
                                .to_string_lossy()
                                .to_string(),
                            state: "stale".to_string(),
                            error_code: Some("projection_observation_missing".to_string()),
                            observed_at: now.clone(),
                        });
                        continue;
                    };

                    if library
                        .verify_revision_content(&skill.current_revision)
                        .is_err()
                    {
                        issues.push(issue_from_observation(
                            skill,
                            observation,
                            "error",
                            "revision_corrupted",
                            &now,
                        ));
                        continue;
                    }
                    if observation.state != "ready" {
                        issues.push(issue_from_observation(
                            skill,
                            observation,
                            &observation.state,
                            observation
                                .last_error_code
                                .as_deref()
                                .unwrap_or("projection_not_ready"),
                            &now,
                        ));
                        continue;
                    }
                    if observation.duplicate_visible {
                        issues.push(issue_from_observation(
                            skill,
                            observation,
                            "shadowed",
                            "duplicate_visible",
                            &now,
                        ));
                        continue;
                    }
                    if observation.revision_id != skill.current_revision.id {
                        issues.push(issue_from_observation(
                            skill,
                            observation,
                            "stale",
                            "projection_revision_stale",
                            &now,
                        ));
                        continue;
                    }

                    match inspect_entry(database, library, Path::new(&observation.entry_path))? {
                        EntryState::Managed(actual)
                            if actual.skill_id == skill.id
                                && actual.revision_id == skill.current_revision.id => {}
                        EntryState::Missing => issues.push(issue_from_observation(
                            skill,
                            observation,
                            "stale",
                            "projection_entry_missing",
                            &now,
                        )),
                        EntryState::Managed(_) => issues.push(issue_from_observation(
                            skill,
                            observation,
                            "shadowed",
                            "entry_owned_by_another_rovai_skill",
                            &now,
                        )),
                        EntryState::ProjectOwned(reason) => issues.push(issue_from_observation(
                            skill,
                            observation,
                            "shadowed",
                            reason,
                            &now,
                        )),
                    }
                }
            }
        }

        issues.sort_by(|left, right| {
            left.execution_root
                .cmp(&right.execution_root)
                .then_with(|| left.skill_name.cmp(&right.skill_name))
                .then_with(|| left.group_key.cmp(&right.group_key))
        });
        Ok(issues)
    }

    fn finalize_deleting_skills(
        &self,
        database: &mut Database,
        library: &SkillLibraryService,
    ) -> Result<()> {
        let deleting = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT skill.id, skill.name
                FROM skill
                WHERE skill.lifecycle_status = 'deleting'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM skill_projection_observation
                      WHERE skill_projection_observation.skill_id = skill.id
                  )
                ORDER BY skill.id
                "#,
            )?;
            statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        for (skill_id, name) in deleting {
            let now = Utc::now().to_rfc3339();
            let transaction = database.connection_mut().transaction()?;
            transaction.execute("DELETE FROM skill WHERE id = ?1", [&skill_id])?;
            transaction.execute(
                r#"
                INSERT INTO event_log(
                    event_id, event_type, payload_json,
                    entity_type, entity_id,
                    actor_type, actor_id, created_at
                ) VALUES (?1, 'skill.deleted', ?2, 'skill', ?3,
                          'system', 'skill-projection-reconciler', ?4)
                "#,
                params![
                    Uuid::new_v4().to_string(),
                    serde_json::to_string(&serde_json::json!({
                        "skillId": skill_id,
                        "name": name,
                        "contentUnavailable": true,
                    }))?,
                    skill_id,
                    now,
                ],
            )?;
            transaction.commit()?;
            library.remove_skill_content(&skill_id)?;
        }
        Ok(())
    }
}

fn issue_from_observation(
    skill: &SkillView,
    observation: &SkillProjectionObservationView,
    state: &str,
    error_code: &str,
    observed_at: &str,
) -> SkillProjectionIssue {
    SkillProjectionIssue {
        execution_root: observation.execution_root.clone(),
        group_key: observation.group_key,
        skill_id: skill.id.clone(),
        skill_name: skill.name.clone(),
        revision_id: observation.revision_id.clone(),
        entry_path: observation.entry_path.clone(),
        state: state.to_string(),
        error_code: Some(error_code.to_string()),
        observed_at: observed_at.to_string(),
    }
}

fn normalize_exposure_status(state: &str) -> &str {
    match state {
        "ready" | "stale" | "shadowed" | "error" => state,
        "pending_removal" => "stale",
        _ => "error",
    }
}

fn exposure_conflict_statuses(observation: &SkillProjectionObservationView) -> Vec<String> {
    let mut statuses = Vec::new();
    if observation.state != "ready" {
        statuses.push(observation.state.clone());
    }
    if observation.duplicate_visible {
        statuses.push("duplicate_visible".to_string());
    }
    statuses
}

fn load_observation(
    database: &Database,
    execution_root: &str,
    group_key: SkillDeliveryGroupKey,
    skill_id: &str,
) -> Result<Option<SkillProjectionObservationView>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT execution_root, group_key, skill_id, revision_id,
                   entry_path, delivered_via_group_key, duplicate_visible,
                   state, last_error_code, last_observed_at
            FROM skill_projection_observation
            WHERE execution_root = ?1 AND group_key = ?2 AND skill_id = ?3
            "#,
            params![execution_root, group_key.as_str(), skill_id],
            |row| {
                let group_key = row.get::<_, String>(1)?;
                let delivered_via_group_key = row.get::<_, Option<String>>(5)?;
                Ok(SkillProjectionObservationView {
                    execution_root: row.get(0)?,
                    group_key: SkillDeliveryGroupKey::from_str(&group_key).map_err(to_sql_error)?,
                    skill_id: row.get(2)?,
                    revision_id: row.get(3)?,
                    entry_path: row.get(4)?,
                    delivered_via_group_key: delivered_via_group_key
                        .map(|value| SkillDeliveryGroupKey::from_str(&value))
                        .transpose()
                        .map_err(to_sql_error)?,
                    duplicate_visible: row.get(6)?,
                    state: row.get(7)?,
                    last_error_code: row.get(8)?,
                    last_observed_at: row.get(9)?,
                })
            },
        )
        .optional()
        .context("failed to load Skill projection observation")
}

#[allow(clippy::too_many_arguments)]
fn reconcile_desired_entry(
    database: &mut Database,
    library: &SkillLibraryService,
    execution_root: &str,
    group_key: SkillDeliveryGroupKey,
    skill: &SkillView,
    entry_path: &Path,
    state: EntryState,
    mutation_allowed: bool,
) -> Result<()> {
    let observed_revision_id = match &state {
        EntryState::Managed(actual) if actual.skill_id == skill.id => actual.revision_id.as_str(),
        _ => skill.current_revision.id.as_str(),
    };
    if let Err(error) = library.verify_revision_content(&skill.current_revision) {
        upsert_observation(
            database,
            execution_root,
            group_key,
            skill,
            observed_revision_id,
            entry_path,
            "error",
            Some("revision_corrupted"),
        )?;
        eprintln!(
            "Skill Revision {} is corrupted and was not projected: {error:#}",
            skill.current_revision.id
        );
        return Ok(());
    }
    #[cfg(windows)]
    let mutation_required = match &state {
        EntryState::Missing => true,
        EntryState::Managed(actual) => {
            actual.skill_id == skill.id && actual.revision_id != skill.current_revision.id
        }
        EntryState::ProjectOwned(_) => false,
    };
    #[cfg(windows)]
    if !mutation_allowed && mutation_required {
        return upsert_observation(
            database,
            execution_root,
            group_key,
            skill,
            observed_revision_id,
            entry_path,
            "stale",
            Some("projection_update_waiting_for_active_run"),
        );
    }
    #[cfg(not(windows))]
    let _ = mutation_allowed;
    #[cfg(unix)]
    let desired_target = library.revision_content_path(&skill.id, &skill.current_revision.id);
    match state {
        EntryState::Missing => {
            #[cfg(unix)]
            {
                publish_managed_link(&desired_target, entry_path, false)?;
                upsert_observation(
                    database,
                    execution_root,
                    group_key,
                    skill,
                    &skill.current_revision.id,
                    entry_path,
                    "ready",
                    None,
                )
            }
            #[cfg(windows)]
            {
                // A ready observation can point at a shared Claude-compatible
                // projection even though this group's direct entry is absent.
                // Once that shared entry is shadowed, Windows must retire the
                // forwarded observation before starting a new journal whose
                // old-entry lineage is intentionally empty.
                delete_observation(database, execution_root, group_key, &skill.id)?;
                windows_projection::publish_managed_copy(
                    database,
                    library,
                    Path::new(execution_root),
                    skill,
                    entry_path,
                    None,
                )
            }
            #[cfg(not(any(unix, windows)))]
            {
                anyhow::bail!("skill_projection_platform_not_supported")
            }
        }
        EntryState::ProjectOwned(reason) => upsert_observation(
            database,
            execution_root,
            group_key,
            skill,
            &skill.current_revision.id,
            entry_path,
            "shadowed",
            Some(reason),
        ),
        EntryState::Managed(actual)
            if actual.skill_id == skill.id && actual.revision_id == skill.current_revision.id =>
        {
            ensure_observation_proves_entry(
                database,
                execution_root,
                group_key,
                entry_path,
                &actual,
            )?;
            upsert_observation(
                database,
                execution_root,
                group_key,
                skill,
                &actual.revision_id,
                entry_path,
                "ready",
                None,
            )
        }
        EntryState::Managed(actual) if actual.skill_id == skill.id => {
            ensure_observation_proves_entry(
                database,
                execution_root,
                group_key,
                entry_path,
                &actual,
            )?;
            #[cfg(unix)]
            {
                publish_managed_link(&desired_target, entry_path, true)?;
                upsert_observation(
                    database,
                    execution_root,
                    group_key,
                    skill,
                    &skill.current_revision.id,
                    entry_path,
                    "ready",
                    None,
                )
            }
            #[cfg(windows)]
            {
                windows_projection::publish_managed_copy(
                    database,
                    library,
                    Path::new(execution_root),
                    skill,
                    entry_path,
                    Some(&actual),
                )
            }
            #[cfg(not(any(unix, windows)))]
            {
                anyhow::bail!("skill_projection_platform_not_supported")
            }
        }
        EntryState::Managed(_) => upsert_observation(
            database,
            execution_root,
            group_key,
            skill,
            &skill.current_revision.id,
            entry_path,
            "shadowed",
            Some("entry_owned_by_another_rovai_skill"),
        ),
    }
}

#[allow(clippy::too_many_arguments)]
fn reconcile_undesired_entry(
    database: &mut Database,
    library: &SkillLibraryService,
    execution_root: &str,
    group_key: SkillDeliveryGroupKey,
    skill: &SkillView,
    entry_path: &Path,
    state: EntryState,
    mutation_allowed: bool,
) -> Result<()> {
    #[cfg(not(windows))]
    let _ = library;
    match state {
        EntryState::Managed(actual) if actual.skill_id == skill.id => {
            #[cfg(windows)]
            if !mutation_allowed {
                return upsert_observation(
                    database,
                    execution_root,
                    group_key,
                    skill,
                    &actual.revision_id,
                    entry_path,
                    "pending_removal",
                    Some("projection_removal_waiting_for_active_run"),
                );
            }
            #[cfg(not(windows))]
            let _ = mutation_allowed;
            ensure_observation_proves_entry(
                database,
                execution_root,
                group_key,
                entry_path,
                &actual,
            )?;
            #[cfg(unix)]
            {
                fs::remove_file(entry_path)
                    .with_context(|| format!("failed to remove {}", entry_path.display()))?;
                delete_observation(database, execution_root, group_key, &skill.id)
            }
            #[cfg(windows)]
            {
                windows_projection::remove_managed_copy(
                    database,
                    library,
                    execution_root,
                    group_key,
                    skill,
                    entry_path,
                    &actual,
                )
            }
            #[cfg(not(any(unix, windows)))]
            {
                anyhow::bail!("skill_projection_platform_not_supported")
            }
        }
        #[cfg(windows)]
        EntryState::ProjectOwned(_) if skill.lifecycle_status == "deleting" => {
            delete_observation(database, execution_root, group_key, &skill.id)
        }
        #[cfg(windows)]
        EntryState::ProjectOwned(reason)
            if load_observation(database, execution_root, group_key, &skill.id)?.is_some() =>
        {
            upsert_observation(
                database,
                execution_root,
                group_key,
                skill,
                &skill.current_revision.id,
                entry_path,
                "shadowed",
                Some(reason),
            )
        }
        EntryState::Missing | EntryState::ProjectOwned(_) | EntryState::Managed(_) => {
            delete_observation(database, execution_root, group_key, &skill.id)
        }
    }
}

#[cfg(unix)]
fn repair_retired_lumen_link_if_recorded(
    database: &Database,
    execution_root: &str,
    group_key: SkillDeliveryGroupKey,
    skill: &SkillView,
    entry_path: &Path,
    repair_policy: ReconcileRepairPolicy,
) -> Result<()> {
    if repair_policy != ReconcileRepairPolicy::RepairRetiredLumenLinks {
        return Ok(());
    }
    let Some(observation) = load_observation(database, execution_root, group_key, &skill.id)?
    else {
        return Ok(());
    };
    if Path::new(&observation.entry_path) != entry_path {
        return Ok(());
    }
    let metadata = match fs::symlink_metadata(entry_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if !metadata.file_type().is_symlink() {
        return Ok(());
    }
    let raw_target = fs::read_link(entry_path)?;
    let target = if raw_target.is_absolute() {
        raw_target
    } else {
        entry_path
            .parent()
            .context("Skill projection entry has no parent")?
            .join(raw_target)
    };
    if target
        .components()
        .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Ok(());
    }
    match fs::metadata(&target) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Ok(_) | Err(_) => return Ok(()),
    }
    let Some(home) = dirs::home_dir() else {
        return Ok(());
    };
    let retired_revision_root = home.join(".lumen/skills/revisions");
    let Ok(relative) = target.strip_prefix(&retired_revision_root) else {
        return Ok(());
    };
    let components = relative
        .components()
        .map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>();
    let Some([skill_id, revision_id]) = components.as_deref() else {
        return Ok(());
    };
    if Uuid::parse_str(skill_id).is_err() || Uuid::parse_str(revision_id).is_err() {
        return Ok(());
    }
    fs::remove_file(entry_path).with_context(|| {
        format!(
            "failed to remove recorded retired .lumen Skill projection {}",
            entry_path.display()
        )
    })
}

#[cfg(not(unix))]
fn repair_retired_lumen_link_if_recorded(
    _database: &Database,
    _execution_root: &str,
    _group_key: SkillDeliveryGroupKey,
    _skill: &SkillView,
    _entry_path: &Path,
    _repair_policy: ReconcileRepairPolicy,
) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn inspect_entry(
    database: &Database,
    library: &SkillLibraryService,
    entry_path: &Path,
) -> Result<EntryState> {
    let metadata = match fs::symlink_metadata(entry_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(EntryState::Missing);
        }
        Err(error) => return Err(error.into()),
    };
    if !metadata.file_type().is_symlink() {
        return Ok(EntryState::ProjectOwned("project_entry_exists"));
    }
    let raw_target = fs::read_link(entry_path)?;
    let target = if raw_target.is_absolute() {
        raw_target
    } else {
        entry_path
            .parent()
            .context("Skill projection entry has no parent")?
            .join(raw_target)
    };
    let canonical_target = match target.canonicalize() {
        Ok(target) => target,
        Err(_) => return Ok(EntryState::ProjectOwned("broken_or_unavailable_symlink")),
    };
    let library_root = library.root().canonicalize()?;
    let Some((skill_id, revision_id)) =
        parse_managed_revision_target(&library_root, &canonical_target)
    else {
        return Ok(EntryState::ProjectOwned("external_symlink"));
    };
    let revision = database
        .connection()
        .query_row(
            r#"
            SELECT skill.name, revision.content_digest
            FROM skill_revision AS revision
            JOIN skill ON skill.id = revision.skill_id
            WHERE revision.skill_id = ?1 AND revision.id = ?2
            "#,
            params![skill_id, revision_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((skill_name, content_digest)) = revision else {
        return Ok(EntryState::ProjectOwned("unknown_managed_target"));
    };
    if entry_path.file_name().and_then(|value| value.to_str()) != Some(skill_name.as_str()) {
        return Ok(EntryState::ProjectOwned("managed_target_name_mismatch"));
    }
    if library
        .verify_revision_identity(&skill_id, &revision_id, &skill_name, &content_digest)
        .is_err()
    {
        return Ok(EntryState::ProjectOwned("managed_target_corrupted"));
    }
    Ok(EntryState::Managed(ManagedEntry {
        skill_id,
        revision_id,
    }))
}

#[cfg(windows)]
fn inspect_entry(
    database: &Database,
    library: &SkillLibraryService,
    entry_path: &Path,
) -> Result<EntryState> {
    windows_projection::inspect_entry(database, library, entry_path)
}

#[cfg(unix)]
fn parse_managed_revision_target(library_root: &Path, target: &Path) -> Option<(String, String)> {
    let relative = target.strip_prefix(library_root).ok()?;
    let components = relative
        .components()
        .map(|component| match component {
            Component::Normal(value) => value.to_str().map(str::to_string),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    match components.as_slice() {
        [revisions, skill_id, revision_id]
            if revisions == "revisions"
                && Uuid::parse_str(skill_id).is_ok()
                && Uuid::parse_str(revision_id).is_ok() =>
        {
            Some((skill_id.clone(), revision_id.clone()))
        }
        _ => None,
    }
}

fn ensure_observation_proves_entry(
    database: &mut Database,
    execution_root: &str,
    group_key: SkillDeliveryGroupKey,
    entry_path: &Path,
    actual: &ManagedEntry,
) -> Result<()> {
    let current = database
        .connection()
        .query_row(
            r#"
            SELECT revision_id, entry_path
            FROM skill_projection_observation
            WHERE execution_root = ?1
              AND group_key = ?2
              AND skill_id = ?3
            "#,
            params![execution_root, group_key.as_str(), actual.skill_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let expected_entry = entry_path.to_string_lossy();
    if current.as_ref().is_some_and(|(revision_id, path)| {
        revision_id == &actual.revision_id && path == expected_entry.as_ref()
    }) {
        return Ok(());
    }
    database.connection().execute(
        r#"
        INSERT INTO skill_projection_observation(
            execution_root, group_key, skill_id, revision_id,
            entry_path, delivered_via_group_key, duplicate_visible,
            state, last_error_code, last_observed_at, operation_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?2, 0, 'stale',
                  'observation_rebuilt_from_managed_target', ?6, NULL)
        ON CONFLICT(execution_root, group_key, skill_id) DO UPDATE SET
            revision_id = excluded.revision_id,
            entry_path = excluded.entry_path,
            delivered_via_group_key = excluded.delivered_via_group_key,
            duplicate_visible = excluded.duplicate_visible,
            state = excluded.state,
            last_error_code = excluded.last_error_code,
            last_observed_at = excluded.last_observed_at,
            operation_id = NULL,
            entry_identity = NULL
        "#,
        params![
            execution_root,
            group_key.as_str(),
            actual.skill_id,
            actual.revision_id,
            expected_entry.as_ref(),
            Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn upsert_observation(
    database: &mut Database,
    execution_root: &str,
    group_key: SkillDeliveryGroupKey,
    skill: &SkillView,
    revision_id: &str,
    entry_path: &Path,
    state: &str,
    last_error_code: Option<&str>,
) -> Result<()> {
    upsert_observation_internal(
        database,
        execution_root,
        group_key,
        skill,
        revision_id,
        entry_path,
        state,
        last_error_code,
        None,
        None,
    )
}

#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn upsert_observation_for_operation(
    database: &mut Database,
    execution_root: &str,
    group_key: SkillDeliveryGroupKey,
    skill: &SkillView,
    revision_id: &str,
    entry_path: &Path,
    state: &str,
    last_error_code: Option<&str>,
    operation_id: &str,
    entry_identity: &str,
) -> Result<()> {
    Uuid::parse_str(operation_id).context("Skill projection operation ID is invalid")?;
    upsert_observation_internal(
        database,
        execution_root,
        group_key,
        skill,
        revision_id,
        entry_path,
        state,
        last_error_code,
        Some(operation_id),
        Some(entry_identity),
    )
}

#[allow(clippy::too_many_arguments)]
fn upsert_observation_internal(
    database: &mut Database,
    execution_root: &str,
    group_key: SkillDeliveryGroupKey,
    skill: &SkillView,
    revision_id: &str,
    entry_path: &Path,
    state: &str,
    last_error_code: Option<&str>,
    operation_id: Option<&str>,
    entry_identity: Option<&str>,
) -> Result<()> {
    let duplicate_visible = exact_duplicate_visible(
        Path::new(execution_root),
        group_key,
        &skill.name,
        Some(entry_path),
    );
    database.connection().execute(
        r#"
        INSERT INTO skill_projection_observation(
            execution_root, group_key, skill_id, revision_id,
            entry_path, delivered_via_group_key, duplicate_visible,
            state, last_error_code, last_observed_at, operation_id,
            entry_identity
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?2, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(execution_root, group_key, skill_id) DO UPDATE SET
            revision_id = excluded.revision_id,
            entry_path = excluded.entry_path,
            delivered_via_group_key = excluded.delivered_via_group_key,
            duplicate_visible = excluded.duplicate_visible,
            state = excluded.state,
            last_error_code = excluded.last_error_code,
            last_observed_at = excluded.last_observed_at,
            operation_id = COALESCE(
                excluded.operation_id,
                skill_projection_observation.operation_id
            ),
            entry_identity = COALESCE(
                excluded.entry_identity,
                skill_projection_observation.entry_identity
            )
        "#,
        params![
            execution_root,
            group_key.as_str(),
            skill.id,
            revision_id,
            entry_path.to_string_lossy().as_ref(),
            duplicate_visible,
            state,
            last_error_code,
            Utc::now().to_rfc3339(),
            operation_id,
            entry_identity,
        ],
    )?;
    Ok(())
}

fn upsert_forwarded_observation(
    database: &mut Database,
    execution_root: &str,
    assignment_group_key: SkillDeliveryGroupKey,
    skill: &SkillView,
    delivered: &SkillProjectionObservationView,
    direct_entry_path: &Path,
) -> Result<()> {
    let delivered_via = delivered
        .delivered_via_group_key
        .unwrap_or(delivered.group_key);
    let duplicate_visible = exact_duplicate_visible(
        Path::new(execution_root),
        assignment_group_key,
        &skill.name,
        Some(direct_entry_path),
    );
    database.connection().execute(
        r#"
        INSERT INTO skill_projection_observation(
            execution_root, group_key, skill_id, revision_id,
            entry_path, delivered_via_group_key, duplicate_visible,
            state, last_error_code, last_observed_at, operation_id
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ready', NULL, ?8, NULL)
        ON CONFLICT(execution_root, group_key, skill_id) DO UPDATE SET
            revision_id = excluded.revision_id,
            entry_path = excluded.entry_path,
            delivered_via_group_key = excluded.delivered_via_group_key,
            duplicate_visible = excluded.duplicate_visible,
            state = excluded.state,
            last_error_code = excluded.last_error_code,
            last_observed_at = excluded.last_observed_at,
            operation_id = NULL,
            entry_identity = NULL
        "#,
        params![
            execution_root,
            assignment_group_key.as_str(),
            skill.id,
            delivered.revision_id,
            delivered.entry_path,
            delivered_via.as_str(),
            duplicate_visible,
            Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn exact_duplicate_visible(
    execution_root: &Path,
    group_key: SkillDeliveryGroupKey,
    skill_name: &str,
    direct_entry_path: Option<&Path>,
) -> bool {
    let legacy_agents_entry = execution_root.join(".agents/skills").join(skill_name);
    if fs::symlink_metadata(&legacy_agents_entry).is_ok() {
        return true;
    }
    #[cfg(unix)]
    if direct_entry_path.is_some_and(|path| {
        fs::symlink_metadata(path).is_ok_and(|metadata| !metadata.file_type().is_symlink())
    }) {
        return true;
    }
    let Some(user_home) = dirs::home_dir() else {
        return false;
    };
    let user_entry = user_home.join(group_key.relative_path()).join(skill_name);
    if direct_entry_path.is_some_and(|path| path == user_entry) {
        return false;
    }
    fs::symlink_metadata(user_entry).is_ok()
}

fn delete_observation(
    database: &mut Database,
    execution_root: &str,
    group_key: SkillDeliveryGroupKey,
    skill_id: &str,
) -> Result<()> {
    database.connection().execute(
        r#"
        DELETE FROM skill_projection_observation
        WHERE execution_root = ?1 AND group_key = ?2 AND skill_id = ?3
        "#,
        params![execution_root, group_key.as_str(), skill_id],
    )?;
    Ok(())
}

#[cfg(unix)]
fn publish_managed_link(target: &Path, entry_path: &Path, replace: bool) -> Result<()> {
    let parent = entry_path
        .parent()
        .context("Skill projection entry has no parent")?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!("{MANAGED_TEMP_PREFIX}{}.tmp", Uuid::new_v4()));
    symlink(target, &temporary).with_context(|| {
        format!(
            "failed to stage Skill projection {} -> {}",
            temporary.display(),
            target.display()
        )
    })?;
    let result = if replace {
        let metadata = fs::symlink_metadata(entry_path)
            .with_context(|| format!("Skill projection disappeared: {}", entry_path.display()))?;
        if !metadata.file_type().is_symlink() {
            anyhow::bail!(
                "Skill projection replacement refused because {} is no longer a symlink",
                entry_path.display()
            );
        }
        fs::rename(&temporary, entry_path)
    } else if fs::symlink_metadata(entry_path).is_ok() {
        anyhow::bail!(
            "Skill projection creation refused because {} appeared concurrently",
            entry_path.display()
        );
    } else {
        fs::rename(&temporary, entry_path)
    };
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error).with_context(|| {
            format!(
                "failed to publish Skill projection at {}",
                entry_path.display()
            )
        });
    }
    Ok(())
}

#[cfg(unix)]
fn cleanup_safe_temporary_links(
    database: &Database,
    library: &SkillLibraryService,
    native_root: &Path,
) -> Result<()> {
    let entries = match fs::read_dir(native_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(MANAGED_TEMP_PREFIX) || !name.ends_with(".tmp") {
            continue;
        }
        if load_managed_symlink_target(database, library, &entry.path())?.is_some() {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn cleanup_safe_temporary_links(
    _database: &Database,
    library: &SkillLibraryService,
    native_root: &Path,
) -> Result<()> {
    // Windows staging and backup paths are governed by the private operation
    // journal and are recovered once per root before group reconciliation.
    windows_projection::audit_temporary_paths(library, native_root)
}

#[cfg(unix)]
fn load_managed_symlink_target(
    database: &Database,
    library: &SkillLibraryService,
    entry_path: &Path,
) -> Result<Option<ManagedEntry>> {
    let metadata = match fs::symlink_metadata(entry_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if !metadata.file_type().is_symlink() {
        return Ok(None);
    }
    let raw_target = fs::read_link(entry_path)?;
    let target = if raw_target.is_absolute() {
        raw_target
    } else {
        entry_path
            .parent()
            .context("Skill projection entry has no parent")?
            .join(raw_target)
    };
    let canonical_target = match target.canonicalize() {
        Ok(target) => target,
        Err(_) => return Ok(None),
    };
    let library_root = library.root().canonicalize()?;
    let Some((skill_id, revision_id)) =
        parse_managed_revision_target(&library_root, &canonical_target)
    else {
        return Ok(None);
    };
    let revision = database
        .connection()
        .query_row(
            r#"
            SELECT skill.name, revision.content_digest
            FROM skill_revision AS revision
            JOIN skill ON skill.id = revision.skill_id
            WHERE revision.skill_id = ?1 AND revision.id = ?2
            "#,
            params![skill_id, revision_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((skill_name, content_digest)) = revision else {
        return Ok(None);
    };
    if library
        .verify_revision_identity(&skill_id, &revision_id, &skill_name, &content_digest)
        .is_err()
    {
        return Ok(None);
    }
    Ok(Some(ManagedEntry {
        skill_id,
        revision_id,
    }))
}

fn collect_managed_git_entries(
    database: &Database,
    library: &SkillLibraryService,
    execution_root: &Path,
    native_root: &Path,
    managed_entries: &mut BTreeSet<PathBuf>,
) -> Result<()> {
    for entry in fs::read_dir(native_root)? {
        let entry = entry?;
        if matches!(
            inspect_entry(database, library, &entry.path())?,
            EntryState::Managed(_)
        ) {
            let relative = entry
                .path()
                .strip_prefix(execution_root)
                .context("Skill projection escaped its execution root")?
                .to_path_buf();
            managed_entries.insert(relative);
        }
    }
    Ok(())
}

fn validate_persisted_execution_root(execution_root: &str) -> Result<()> {
    let path = Path::new(execution_root);
    if execution_root.is_empty() || execution_root.len() > 8_192 || !path.is_absolute() {
        anyhow::bail!("Skill projection execution root must be an absolute path");
    }
    if path
        .components()
        .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        anyhow::bail!("Skill projection execution root must be normalized");
    }
    Ok(())
}

fn upsert_root_access_state(
    database: &mut Database,
    execution_root: &str,
    access_state: &str,
    dirty: bool,
    cleanup_required: bool,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let removed_at = (access_state == "removed").then_some(now.as_str());
    database.connection().execute(
        r#"
        INSERT INTO skill_projection_root_state(
            execution_root, access_state, dirty,
            cleanup_required, removed_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(execution_root) DO UPDATE SET
            access_state = excluded.access_state,
            dirty = excluded.dirty,
            cleanup_required = excluded.cleanup_required,
            removed_at = excluded.removed_at,
            updated_at = excluded.updated_at
        "#,
        params![
            execution_root,
            access_state,
            if dirty { 1 } else { 0 },
            if cleanup_required { 1 } else { 0 },
            removed_at,
            now,
        ],
    )?;
    Ok(())
}

fn mark_root_reconciled(database: &mut Database, execution_root: &str) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    database.connection().execute(
        r#"
        INSERT INTO skill_projection_root_state(
            execution_root, access_state, dirty,
            cleanup_required, removed_at, updated_at
        ) VALUES (?1, 'active', 0, 0, NULL, ?2)
        ON CONFLICT(execution_root) DO UPDATE SET
            dirty = 0,
            cleanup_required = 0,
            updated_at = excluded.updated_at
        "#,
        params![execution_root, now],
    )?;
    Ok(())
}

fn finish_reconciliation_state(
    database: &mut Database,
    report: &SkillProjectionReport,
) -> Result<bool> {
    if !reconciliation_has_deferred_mutation(report) {
        mark_root_reconciled(database, &report.execution_root)?;
        return Ok(true);
    }
    let now = Utc::now().to_rfc3339();
    database.connection().execute(
        r#"
        INSERT INTO skill_projection_root_state(
            execution_root, access_state, dirty,
            cleanup_required, removed_at, updated_at
        ) VALUES (?1, 'active', 1, 0, NULL, ?2)
        ON CONFLICT(execution_root) DO UPDATE SET
            dirty = 1,
            updated_at = excluded.updated_at
        "#,
        params![report.execution_root, now],
    )?;
    Ok(false)
}

fn reconciliation_has_deferred_mutation(report: &SkillProjectionReport) -> bool {
    report.observations.iter().any(|observation| {
        matches!(
            observation.last_error_code.as_deref(),
            Some(
                "projection_update_waiting_for_active_run"
                    | "projection_removal_waiting_for_active_run"
            )
        )
    })
}

fn root_access_is_removed(database: &Database, execution_root: &str) -> Result<bool> {
    Ok(database
        .connection()
        .query_row(
            "SELECT access_state FROM skill_projection_root_state WHERE execution_root = ?1",
            [execution_root],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .is_some_and(|state| state == "removed"))
}

fn root_is_dirty(database: &Database, execution_root: &str) -> Result<bool> {
    Ok(database
        .connection()
        .query_row(
            "SELECT dirty FROM skill_projection_root_state WHERE execution_root = ?1",
            [execution_root],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some_and(|dirty| dirty != 0))
}

fn root_cleanup_pending(database: &Database, execution_root: &str) -> Result<bool> {
    Ok(database
        .connection()
        .query_row(
            "SELECT cleanup_required FROM skill_projection_root_state WHERE execution_root = ?1",
            [execution_root],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some_and(|pending| pending != 0))
}

fn observed_delivery_groups(
    database: &Database,
    execution_root: &str,
) -> Result<BTreeSet<SkillDeliveryGroupKey>> {
    let mut statement = database.connection().prepare(
        "SELECT DISTINCT group_key FROM skill_projection_observation WHERE execution_root = ?1",
    )?;
    statement
        .query_map([execution_root], |row| row.get::<_, String>(0))?
        .map(|row| SkillDeliveryGroupKey::from_str(&row?).map_err(to_sql_error))
        .collect::<rusqlite::Result<BTreeSet<_>>>()
        .map_err(Into::into)
}

fn active_run_delivery_groups(
    database: &Database,
    execution_root: &str,
    ignored_agent_run_id: Option<&str>,
) -> Result<BTreeSet<SkillDeliveryGroupKey>> {
    let registry = AgentRuntimeAdapterRegistry::default();
    let mut groups = BTreeSet::new();
    for (agent_run_id, candidate_root, adapter_kind) in active_runs(database)? {
        if ignored_agent_run_id == Some(agent_run_id.as_str()) || candidate_root != execution_root {
            continue;
        }
        let Some(adapter_kind) = adapter_kind else {
            continue;
        };
        groups.extend(
            registry
                .skill_discovery(AdapterKind::from_str(&adapter_kind)?)
                .delivery_groups,
        );
    }
    Ok(groups)
}

#[cfg(windows)]
fn projection_mutation_blocked(
    database: &Database,
    execution_root: &Path,
    _execution_root_text: &str,
    ignored_agent_run_id: Option<&str>,
) -> Result<bool> {
    windows_projection::has_active_run_registration(database, execution_root, ignored_agent_run_id)
}

#[cfg(not(windows))]
fn projection_mutation_blocked(
    database: &Database,
    _execution_root: &Path,
    execution_root_text: &str,
    ignored_agent_run_id: Option<&str>,
) -> Result<bool> {
    has_active_run(database, execution_root_text, ignored_agent_run_id, None)
}

fn has_active_run(
    database: &Database,
    execution_root: &str,
    ignored_agent_run_id: Option<&str>,
    delivery_group: Option<SkillDeliveryGroupKey>,
) -> Result<bool> {
    let registry = AgentRuntimeAdapterRegistry::default();
    for (agent_run_id, candidate_root, adapter_kind) in active_runs(database)? {
        if ignored_agent_run_id == Some(agent_run_id.as_str()) || candidate_root != execution_root {
            continue;
        }
        if let Some(delivery_group) = delivery_group {
            let Some(adapter_kind) = adapter_kind else {
                continue;
            };
            if !registry
                .skill_discovery(AdapterKind::from_str(&adapter_kind)?)
                .delivery_groups
                .contains(&delivery_group)
            {
                continue;
            }
        }
        return Ok(true);
    }
    Ok(false)
}

fn active_runs(database: &Database) -> Result<Vec<(String, String, Option<String>)>> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT agent_run.id, agent_run.workspace_json, camp.project_path,
               agent_run.runtime_adapter_kind
        FROM agent_run
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        JOIN camp ON camp.id = camp_turn.camp_id
        JOIN conversation ON conversation.id = agent_run.conversation_id
        WHERE (
            agent_run.status = 'running'
            OR (
                agent_run.status = 'waiting'
                AND (
                    conversation.native_session_id IS NOT NULL
                    OR EXISTS (
                        SELECT 1 FROM context_manifest
                        WHERE context_manifest.agent_run_id = agent_run.id
                    )
                )
            )
        )
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    let mut active = Vec::new();
    for row in rows {
        let (agent_run_id, workspace_json, project_path, adapter_kind) = row?;
        let candidate = workspace_execution_root(workspace_json.as_deref()).unwrap_or(project_path);
        active.push((agent_run_id, candidate, adapter_kind));
    }
    Ok(active)
}

fn workspace_execution_root(workspace_json: Option<&str>) -> Option<String> {
    let workspace = serde_json::from_str::<serde_json::Value>(workspace_json?).ok()?;
    workspace
        .get("executionRoot")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn list_observations_for_root(
    database: &Database,
    execution_root: &str,
) -> Result<Vec<SkillProjectionObservationView>> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT execution_root, group_key, skill_id, revision_id,
               entry_path, delivered_via_group_key, duplicate_visible,
               state, last_error_code, last_observed_at
        FROM skill_projection_observation
        WHERE execution_root = ?1
        ORDER BY group_key, entry_path
        "#,
    )?;
    Ok(statement
        .query_map([execution_root], |row| {
            let group_key = row.get::<_, String>(1)?;
            let delivered_via_group_key = row.get::<_, Option<String>>(5)?;
            Ok(SkillProjectionObservationView {
                execution_root: row.get(0)?,
                group_key: SkillDeliveryGroupKey::from_str(&group_key).map_err(to_sql_error)?,
                skill_id: row.get(2)?,
                revision_id: row.get(3)?,
                entry_path: row.get(4)?,
                delivered_via_group_key: delivered_via_group_key
                    .map(|value| SkillDeliveryGroupKey::from_str(&value))
                    .transpose()
                    .map_err(to_sql_error)?,
                duplicate_visible: row.get(6)?,
                state: row.get(7)?,
                last_error_code: row.get(8)?,
                last_observed_at: row.get(9)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn update_git_exclude(execution_root: &Path, managed_entries: &BTreeSet<PathBuf>) -> Result<()> {
    let top_level = run_git_path(execution_root, &["rev-parse", "--show-toplevel"])?;
    let Some(top_level) = top_level else {
        return Ok(());
    };
    let top_level = PathBuf::from(top_level).canonicalize()?;
    let execution_prefix = execution_root
        .strip_prefix(&top_level)
        .context("Git execution root is outside its reported top-level directory")?;
    let exclude = run_git_path(execution_root, &["rev-parse", "--git-path", "info/exclude"])?
        .context("Git did not return an info/exclude path")?;
    let exclude = {
        let path = PathBuf::from(exclude);
        if path.is_absolute() {
            path
        } else {
            execution_root.join(path)
        }
    };
    let existing = match fs::read_to_string(&exclude) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.into()),
    };
    let (without_managed, had_managed_block) = strip_managed_exclude_block(&existing)?;
    let patterns = managed_entries
        .iter()
        .map(|relative| execution_prefix.join(relative))
        .map(|relative| format!("/{}", path_to_git_pattern(&relative)))
        .collect::<Vec<_>>();
    if patterns.is_empty() && !had_managed_block {
        return Ok(());
    }
    let mut next = without_managed;
    if !patterns.is_empty() {
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        next.push_str(GIT_EXCLUDE_BEGIN);
        next.push('\n');
        for pattern in patterns {
            next.push_str(&pattern);
            next.push('\n');
        }
        next.push_str(GIT_EXCLUDE_END);
        next.push('\n');
    }
    if next == existing {
        return Ok(());
    }
    let parent = exclude.parent().context("Git exclude path has no parent")?;
    fs::create_dir_all(parent)?;
    #[cfg(unix)]
    let mode = fs::metadata(&exclude)
        .map(|metadata| metadata.permissions().mode() & 0o777)
        .unwrap_or(0o644);
    let temporary = parent.join(format!(".rovai-info-exclude-{}.tmp", Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    options.mode(mode);
    let mut file = options.open(&temporary)?;
    file.write_all(next.as_bytes())?;
    file.sync_all()?;
    drop(file);
    if let Err(error) = replace_git_exclude(&temporary, &exclude) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

#[cfg(unix)]
fn replace_git_exclude(source: &Path, destination: &Path) -> Result<()> {
    fs::rename(source, destination).context("failed to publish Git Skill projection exclusions")
}

#[cfg(windows)]
fn replace_git_exclude(source: &Path, destination: &Path) -> Result<()> {
    crate::platform::windows_file_tree::replace_temporary(source, destination)
        .context("failed to publish Git Skill projection exclusions")
}

fn run_git_path(cwd: &Path, arguments: &[&str]) -> Result<Option<String>> {
    run_git_path_with_executable(cwd, arguments, std::ffi::OsStr::new("git"))
}

fn run_git_path_with_executable(
    cwd: &Path,
    arguments: &[&str],
    executable: &std::ffi::OsStr,
) -> Result<Option<String>> {
    let output = match Command::new(executable)
        .arg("-C")
        .arg(cwd)
        .args(arguments)
        .output()
    {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error).context("failed to launch git for Skill projection metadata");
        }
    };
    if !output.status.success() {
        return Ok(None);
    }
    let value = String::from_utf8(output.stdout)?.trim().to_string();
    Ok((!value.is_empty()).then_some(value))
}

fn strip_managed_exclude_block(content: &str) -> Result<(String, bool)> {
    let mut output = String::new();
    let mut expected_end = None;
    let mut block_count = 0;
    for segment in content.split_inclusive('\n') {
        let line = segment.strip_suffix('\n').unwrap_or(segment);
        let line = line.strip_suffix('\r').unwrap_or(line);
        if let Some((_, end)) = MANAGED_GIT_EXCLUDE_MARKERS
            .iter()
            .find(|(begin, _)| line == *begin)
        {
            if expected_end.is_some() {
                anyhow::bail!("Git info/exclude contains a nested Rovai-ai managed block");
            }
            expected_end = Some(*end);
            block_count += 1;
            continue;
        }
        if MANAGED_GIT_EXCLUDE_MARKERS
            .iter()
            .any(|(_, end)| line == *end)
        {
            if expected_end != Some(line) {
                anyhow::bail!("Git info/exclude contains an unmatched Rovai-ai end marker");
            }
            expected_end = None;
            continue;
        }
        if expected_end.is_none() {
            output.push_str(segment);
        }
    }
    if expected_end.is_some() {
        anyhow::bail!("Git info/exclude contains an unterminated Rovai-ai managed block");
    }
    Ok((output, block_count > 0))
}

fn path_to_git_pattern(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .map(escape_gitignore_component)
        .collect::<Vec<_>>()
        .join("/")
}

fn escape_gitignore_component(component: &str) -> String {
    let mut escaped = String::with_capacity(component.len());
    for character in component.chars() {
        if matches!(character, '\\' | ' ' | '#' | '!' | '[' | ']' | '*' | '?') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn to_sql_error(error: anyhow::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            error.to_string(),
        )),
    )
}

#[cfg(all(test, feature = "slow-tests", unix))]
mod slow_tests {
    use super::*;
    use crate::{
        command::{ActorRef, CommandEnvelope},
        context::ContextService,
        skill::{
            CommitSkillImportCommand, DeleteSkillCommand, SetSkillEnabledCommand,
            SetSkillGroupAssignmentsCommand, SkillLibraryService,
        },
    };

    fn temporary_directory(prefix: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("{prefix}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn missing_git_executable_does_not_block_non_git_skill_projection() {
        let root = temporary_directory("rovai-projection-without-git");
        let result = run_git_path_with_executable(
            &root,
            &["rev-parse", "--show-toplevel"],
            std::ffi::OsStr::new("/missing/rovai-git"),
        )
        .unwrap();
        assert_eq!(result, None);
        fs::remove_dir_all(root).unwrap();
    }

    fn user_envelope<P>(command_id: &str, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: "projection-test-user".to_string(),
            },
            camp_id: None,
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn initialize_git(root: &Path) {
        let output = Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git init failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn import_skill(
        database: &mut Database,
        library: &SkillLibraryService,
        source_root: &Path,
        name: &str,
    ) -> SkillView {
        let source = source_root.join(name);
        fs::create_dir_all(&source).unwrap();
        fs::write(
            source.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: Projection test\n---\n\nTest.\n"),
        )
        .unwrap();
        let inspection = library.inspect_import(database, &source).unwrap();
        let candidate = inspection.candidates[0].clone();
        let result = library
            .commit_import(
                database,
                &user_envelope(
                    "import-projection-skill",
                    CommitSkillImportCommand {
                        staging_token: inspection.staging_token,
                        candidate_name: candidate.name,
                        expected_digest: candidate.content_digest,
                        expected_skill_version: None,
                        confirm_update: false,
                    },
                ),
            )
            .unwrap();
        assert_eq!(result.result.code, "skill_imported");
        let skill = library
            .list(database)
            .unwrap()
            .into_iter()
            .find(|skill| skill.name == name)
            .unwrap();
        assign_skill_to_groups(
            database,
            library,
            &skill,
            &[SkillDeliveryGroupKey::Codex],
            "assign-imported-projection-skill",
        )
    }

    fn assign_skill_to_groups(
        database: &mut Database,
        library: &SkillLibraryService,
        skill: &SkillView,
        group_keys: &[SkillDeliveryGroupKey],
        command_id: &str,
    ) -> SkillView {
        library
            .set_group_assignments(
                database,
                &user_envelope(
                    command_id,
                    SetSkillGroupAssignmentsCommand {
                        skill_id: skill.id.clone(),
                        expected_version: skill.version,
                        group_keys: group_keys.to_vec(),
                    },
                ),
            )
            .unwrap();
        library.get(database, &skill.id).unwrap().unwrap()
    }

    fn install_official_and_assign(
        database: &mut Database,
        library: &SkillLibraryService,
        group_keys: &[SkillDeliveryGroupKey],
    ) -> SkillView {
        let skill = library
            .install_bundled_skill_for_test(database, "analyze-agent-codebase")
            .unwrap();
        database
            .connection()
            .execute("DELETE FROM skill_group_assignment", [])
            .unwrap();
        assign_skill_to_groups(
            database,
            library,
            &skill,
            group_keys,
            "assign-official-projection-skill",
        )
    }

    fn insert_active_run(database: &Database, execution_root: &Path) {
        let now = Utc::now().to_rfc3339();
        let execution_root = execution_root.canonicalize().unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, project_binding_kind, project_path,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES (
                    'projection-camp', 'Projection', 'directory', ?1,
                    0, 1, ?2, ?2
                )
                "#,
                params![execution_root.to_string_lossy().as_ref(), now],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO conversation(
                    id, camp_id, agent_id, created_at, updated_at
                ) VALUES (
                    'projection-conversation', 'projection-camp', 'agent_1', ?1, ?1
                )
                "#,
                [&now],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp_turn(
                    id, camp_id, trigger_type, trigger_id, status,
                    created_at, updated_at
                ) VALUES (
                    'projection-turn', 'projection-camp', 'system_event',
                    'projection-trigger', 'running', ?1, ?1
                )
                "#,
                [&now],
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
                    trigger_conversation_message_id,
                    responsibility_key, start_reason, purpose,
                    completion_role, effective_config_json, workspace_json,
                    status, idempotency_key, runtime_adapter_kind, execution_epoch,
                    created_at, started_at, updated_at
                ) VALUES (
                    'projection-run', 'projection-turn', 'projection-conversation',
                    0, 0, 'projection-trigger-message',
                    'projection-test', 'initial', 'test',
                    'required', '{"runtimeAdapter":"codex-cli"}', ?1,
                    'running', 'projection-run', 'codex-cli', 1, ?2, ?2, ?2
                )
                "#,
                params![
                    serde_json::to_string(&serde_json::json!({
                        "executionRoot": execution_root,
                        "access": "read_only",
                        "isolation": "shared",
                    }))
                    .unwrap(),
                    now,
                ],
            )
            .unwrap();
    }

    fn insert_second_active_run(database: &Database, execution_root: &Path) {
        let now = Utc::now().to_rfc3339();
        let execution_root = execution_root.canonicalize().unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO conversation(
                    id, camp_id, agent_id, created_at, updated_at
                ) VALUES (
                    'projection-conversation-new', 'projection-camp', 'agent_2', ?1, ?1
                )
                "#,
                [&now],
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
                    trigger_conversation_message_id,
                    responsibility_key, start_reason, purpose,
                    completion_role, effective_config_json, workspace_json,
                    status, idempotency_key, runtime_adapter_kind, execution_epoch,
                    created_at, started_at, updated_at
                ) VALUES (
                    'projection-run-new', 'projection-turn', 'projection-conversation-new',
                    0, 0, 'projection-trigger-message',
                    'projection-test-new', 'initial', 'test',
                    'required', '{"runtimeAdapter":"codex-cli"}', ?1,
                    'running', 'projection-run-new', 'codex-cli', 1, ?2, ?2, ?2
                )
                "#,
                params![
                    serde_json::to_string(&serde_json::json!({
                        "executionRoot": execution_root,
                        "access": "read_only",
                        "isolation": "shared",
                    }))
                    .unwrap(),
                    now,
                ],
            )
            .unwrap();
    }

    #[test]
    fn projection_uses_minimum_native_roots_and_preserves_git_exclude_content() {
        let root = temporary_directory("rovai-projection-root");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        initialize_git(&root);
        let exclude = root.join(".git/info/exclude");
        fs::write(&exclude, "# user rule\n/local-only\n").unwrap();
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root.clone()).unwrap();
        install_official_and_assign(
            &mut database,
            &library,
            &[
                SkillDeliveryGroupKey::Codex,
                SkillDeliveryGroupKey::ClaudeCompatible,
            ],
        );

        let report = SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[
                    SkillDeliveryGroupKey::Codex,
                    SkillDeliveryGroupKey::ClaudeCompatible,
                ],
            )
            .unwrap();
        assert_eq!(report.observations.len(), 2);
        assert!(
            report
                .observations
                .iter()
                .all(|observation| observation.state == "ready")
        );
        let codex = root.join(".codex/skills/analyze-agent-codebase");
        let claude = root.join(".claude/skills/analyze-agent-codebase");
        assert!(
            fs::symlink_metadata(&codex)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert!(
            fs::symlink_metadata(&claude)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(
            codex.canonicalize().unwrap(),
            claude.canonicalize().unwrap()
        );
        assert!(!root.join(".agents/skills").exists());
        assert!(!root.join(".agent/skills").exists());
        assert!(!root.join(".opencode/skills").exists());
        assert!(!root.join(".github/skills").exists());
        let exclude_content = fs::read_to_string(exclude).unwrap();
        assert!(exclude_content.contains("# user rule\n/local-only"));
        assert!(exclude_content.contains("/.codex/skills/analyze-agent-codebase"));
        assert!(exclude_content.contains("/.claude/skills/analyze-agent-codebase"));
        let status = Command::new("git")
            .args(["status", "--porcelain", "--untracked-files=all"])
            .current_dir(&root)
            .output()
            .unwrap();
        assert!(status.status.success());
        assert_eq!(String::from_utf8(status.stdout).unwrap(), "");
    }

    #[test]
    fn audit_detects_missing_managed_link_without_repairing_it() {
        let root = temporary_directory("rovai-projection-audit-root");
        let data = temporary_directory("rovai-projection-audit-db");
        let library_root = temporary_directory("rovai-projection-audit-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        let skill =
            install_official_and_assign(&mut database, &library, &[SkillDeliveryGroupKey::Codex]);
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();
        insert_active_run(&database, &root);
        let initial_issues = SkillProjectionReconciler
            .audit_known_roots(&database, &library)
            .unwrap();
        assert!(initial_issues.is_empty(), "{initial_issues:#?}");

        let entry = root.join(".codex/skills").join(&skill.name);
        fs::remove_file(&entry).unwrap();
        let issues = SkillProjectionReconciler
            .audit_known_roots(&database, &library)
            .unwrap();
        assert!(issues.iter().any(|issue| {
            issue.skill_id == skill.id
                && issue.error_code.as_deref() == Some("projection_entry_missing")
        }));
        assert!(fs::symlink_metadata(entry).is_err());

        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn run_preflight_records_project_owned_shadowing_without_overwriting_it() {
        let root = temporary_directory("rovai-projection-exposure");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        install_official_and_assign(&mut database, &library, &[SkillDeliveryGroupKey::Codex]);
        let conflict = root.join(".codex/skills/analyze-agent-codebase");
        fs::create_dir_all(&conflict).unwrap();
        fs::write(conflict.join("SKILL.md"), "project owned").unwrap();
        insert_active_run(&database, &root);

        let exposure = SkillProjectionReconciler
            .prepare_run_exposure(
                &mut database,
                &library,
                "projection-run",
                &root,
                AdapterKind::CodexCli,
            )
            .unwrap();
        assert_eq!(exposure.snapshot.schema_version, 2);
        assert_eq!(exposure.snapshot.skills.len(), 1);
        let shadowed = exposure
            .snapshot
            .skills
            .iter()
            .find(|skill| skill.name == "analyze-agent-codebase")
            .unwrap();
        assert_eq!(shadowed.status, "shadowed");
        assert_eq!(
            shadowed.reason_code.as_deref(),
            Some("project_entry_exists")
        );
        assert_eq!(shadowed.group_key, "codex");
        assert_eq!(shadowed.delivered_via_group_key, Some("codex".to_string()));
        assert_eq!(
            exposure.digest,
            canonical_json_digest(&serde_json::to_value(&exposure.snapshot).unwrap()).unwrap()
        );
    }

    #[test]
    fn waiting_native_session_is_an_active_projection_reader() {
        let root = temporary_directory("rovai-projection-wait-lock");
        let data = temporary_directory("rovai-projection-db");
        let database = crate::test_support::fresh_schema_database_fast_at(&data);
        insert_active_run(&database, &root);
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'waiting', wait_reason = 'runtime_recovery'
                WHERE id = 'projection-run'
                "#,
                [],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                UPDATE conversation SET native_session_id = 'native-session'
                WHERE id = 'projection-conversation'
                "#,
                [],
            )
            .unwrap();
        let canonical = root.canonicalize().unwrap();
        assert!(
            has_active_run(&database, canonical.to_string_lossy().as_ref(), None, None,).unwrap()
        );
    }

    #[test]
    fn project_owned_entry_wins_and_lost_observation_is_rebuilt_safely() {
        let root = temporary_directory("rovai-projection-conflict");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        install_official_and_assign(&mut database, &library, &[SkillDeliveryGroupKey::Codex]);
        let conflict = root.join(".codex/skills/analyze-agent-codebase");
        fs::create_dir_all(&conflict).unwrap();
        fs::write(conflict.join("SKILL.md"), "project owned").unwrap();

        let report = SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();
        let shadowed = report
            .observations
            .iter()
            .find(|observation| observation.entry_path.ends_with("/analyze-agent-codebase"))
            .unwrap();
        assert_eq!(shadowed.state, "shadowed");
        assert_eq!(
            fs::read_to_string(conflict.join("SKILL.md")).unwrap(),
            "project owned"
        );

        fs::remove_dir_all(&conflict).unwrap();
        let managed = root.join(".codex/skills/analyze-agent-codebase");
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();
        assert!(managed.canonicalize().is_ok());
        let managed_entry_path = root
            .canonicalize()
            .unwrap()
            .join(".codex/skills/analyze-agent-codebase")
            .to_string_lossy()
            .to_string();
        database
            .connection()
            .execute(
                "DELETE FROM skill_projection_observation WHERE entry_path = ?1",
                [&managed_entry_path],
            )
            .unwrap();
        let report = SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();
        assert!(
            report.observations.iter().any(|observation| {
                observation.entry_path == managed_entry_path && observation.state == "ready"
            }),
            "{report:?}"
        );
    }

    #[test]
    fn imported_delete_finishes_after_current_root_reconcile_removes_the_projection() {
        let root = temporary_directory("rovai-projection-delete");
        let source = temporary_directory("rovai-projection-source");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        let skill = import_skill(&mut database, &library, &source, "delete-me");
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();
        let entry = root.join(".codex/skills/delete-me");
        assert!(entry.canonicalize().is_ok());
        let content = library.revision_content_path(&skill.id, &skill.current_revision.id);
        assert!(content.is_dir());

        let current = library.get(&database, &skill.id).unwrap().unwrap();
        library
            .request_delete(
                &mut database,
                &user_envelope(
                    "delete-projection-skill",
                    DeleteSkillCommand {
                        skill_id: skill.id.clone(),
                        expected_version: current.version,
                    },
                ),
            )
            .unwrap();
        SkillProjectionReconciler
            .reconcile_root(&mut database, &library, &root, &[])
            .unwrap();
        SkillProjectionReconciler
            .finalize_unprojected_deletions(&mut database, &library)
            .unwrap();
        assert!(fs::symlink_metadata(&entry).is_err());
        assert!(library.get(&database, &skill.id).unwrap().is_none());
        assert!(!content.exists());
        let tombstone: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM event_log WHERE event_type = 'skill.deleted' AND entity_id = ?1",
                [&skill.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tombstone, 1);
    }

    #[test]
    fn disabling_marks_projection_dirty_without_touching_the_execution_root() {
        let root = temporary_directory("rovai-projection-dirty");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        install_official_and_assign(&mut database, &library, &[SkillDeliveryGroupKey::Codex]);
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();
        let skill = library
            .list(&database)
            .unwrap()
            .into_iter()
            .find(|skill| skill.name == "analyze-agent-codebase")
            .unwrap();
        let entry = root.join(".codex/skills/analyze-agent-codebase");
        library
            .set_enabled(
                &mut database,
                &user_envelope(
                    "disable-during-run",
                    SetSkillEnabledCommand {
                        skill_id: skill.id,
                        expected_version: skill.version,
                        enabled: false,
                    },
                ),
            )
            .unwrap();
        SkillProjectionReconciler
            .mark_observed_roots_dirty(&mut database, true)
            .unwrap();
        assert!(entry.canonicalize().is_ok());
        let state: (i64, i64) = database
            .connection()
            .query_row(
                "SELECT dirty, cleanup_required FROM skill_projection_root_state WHERE execution_root = ?1",
                [root.canonicalize().unwrap().to_string_lossy().as_ref()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(state, (1, 1));
    }

    #[test]
    fn new_run_reconciles_latest_skill_state_while_an_older_run_continues() {
        let root = temporary_directory("rovai-projection-new-run-latest");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        install_official_and_assign(&mut database, &library, &[SkillDeliveryGroupKey::Codex]);
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();
        insert_active_run(&database, &root);
        let skill = library
            .list(&database)
            .unwrap()
            .into_iter()
            .find(|skill| skill.name == "analyze-agent-codebase")
            .unwrap();
        library
            .set_enabled(
                &mut database,
                &user_envelope(
                    "disable-before-new-run",
                    SetSkillEnabledCommand {
                        skill_id: skill.id,
                        expected_version: skill.version,
                        enabled: false,
                    },
                ),
            )
            .unwrap();
        insert_second_active_run(&database, &root);
        let prepared = ContextService
            .prepare_skill_exposure(&mut database, &library, "projection-run-new", 1)
            .unwrap();
        assert!(prepared.snapshot.skills.is_empty());
        assert!(fs::symlink_metadata(root.join(".codex/skills/analyze-agent-codebase")).is_err());
        let runs: (String, String) = database
            .connection()
            .query_row(
                r#"
                SELECT
                    (SELECT status FROM agent_run WHERE id = 'projection-run'),
                    (SELECT status FROM agent_run WHERE id = 'projection-run-new')
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(runs, ("running".to_string(), "running".to_string()));
    }

    #[test]
    fn new_run_projects_the_latest_revision_without_waiting_for_an_older_agent() {
        let root = temporary_directory("rovai-projection-new-revision");
        let source = temporary_directory("rovai-projection-source");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        let original = import_skill(&mut database, &library, &source, "revision-change");
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();
        insert_active_run(&database, &root);
        let entry = root.join(".codex/skills/revision-change");
        let original_target = entry.canonicalize().unwrap();

        fs::write(
            source.join("revision-change/SKILL.md"),
            "---\nname: revision-change\ndescription: Projection test v2\n---\n\nVersion two.\n",
        )
        .unwrap();
        let inspection = library
            .inspect_import(&database, &source.join("revision-change"))
            .unwrap();
        let candidate = inspection.candidates[0].clone();
        library
            .commit_import(
                &mut database,
                &user_envelope(
                    "update-projection-skill-during-older-run",
                    CommitSkillImportCommand {
                        staging_token: inspection.staging_token,
                        candidate_name: candidate.name,
                        expected_digest: candidate.content_digest,
                        expected_skill_version: Some(original.version),
                        confirm_update: true,
                    },
                ),
            )
            .unwrap();
        insert_second_active_run(&database, &root);

        let exposure = ContextService
            .prepare_skill_exposure(&mut database, &library, "projection-run-new", 1)
            .unwrap();
        let updated = library.get(&database, &original.id).unwrap().unwrap();

        assert_ne!(updated.current_revision.id, original.current_revision.id);
        assert_eq!(
            exposure.snapshot.skills[0].revision_id,
            updated.current_revision.id
        );
        assert_ne!(entry.canonicalize().unwrap(), original_target);
        let active_run_count: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM agent_run WHERE status = 'running'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active_run_count, 2);
    }

    #[test]
    fn observation_history_does_not_schedule_an_execution_root() {
        let root = temporary_directory("rovai-projection-observation-only");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        install_official_and_assign(&mut database, &library, &[SkillDeliveryGroupKey::Codex]);
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();

        assert!(
            SkillProjectionReconciler
                .known_execution_roots(&database)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn startup_access_sync_records_a_missing_removed_root_without_resolving_it() {
        let data = temporary_directory("rovai-projection-db");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let missing = std::env::temp_dir()
            .join(format!("rovai-removed-missing-{}", Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        assert!(!Path::new(&missing).exists());

        SkillProjectionReconciler
            .synchronize_removed_execution_roots(&mut database, std::slice::from_ref(&missing))
            .unwrap();

        assert!(
            SkillProjectionReconciler
                .execution_root_is_removed(&database, &missing)
                .unwrap()
        );
        assert!(!Path::new(&missing).exists());
    }

    #[test]
    fn startup_access_sync_does_not_turn_db_only_dirty_state_into_removed_root_cleanup() {
        let data = temporary_directory("rovai-projection-db");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let missing = std::env::temp_dir()
            .join(format!("rovai-removed-dirty-missing-{}", Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        assert!(!Path::new(&missing).exists());
        upsert_root_access_state(&mut database, &missing, "active", true, false).unwrap();

        SkillProjectionReconciler
            .synchronize_removed_execution_roots(&mut database, std::slice::from_ref(&missing))
            .unwrap();

        let state: (String, i64, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT access_state, dirty, cleanup_required
                FROM skill_projection_root_state
                WHERE execution_root = ?1
                "#,
                [&missing],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(state, ("removed".to_string(), 0, 0));
        assert!(!Path::new(&missing).exists());
    }

    #[test]
    fn removed_root_waits_for_its_active_run_then_cleans_once() {
        let root = temporary_directory("rovai-projection-removed-root");
        let canonical_root = root.canonicalize().unwrap();
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        install_official_and_assign(&mut database, &library, &[SkillDeliveryGroupKey::Codex]);
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &canonical_root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();
        insert_active_run(&database, &canonical_root);
        let entry = canonical_root.join(".codex/skills/analyze-agent-codebase");

        let removal = SkillProjectionReconciler
            .remove_execution_root(&mut database, &library, &canonical_root)
            .unwrap();
        assert!(removal.cleanup_pending);
        assert!(entry.canonicalize().is_ok());

        let now = Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'succeeded', ended_at = ?1, updated_at = ?1 WHERE id = 'projection-run'",
                [&now],
            )
            .unwrap();
        SkillProjectionReconciler
            .reconcile_after_run_terminal(&mut database, &library, &canonical_root)
            .unwrap();
        assert!(fs::symlink_metadata(&entry).is_err());
        assert!(
            !root_cleanup_pending(&database, canonical_root.to_string_lossy().as_ref(),).unwrap()
        );

        fs::remove_dir_all(&canonical_root).unwrap();
        let error = SkillProjectionReconciler
            .prepare_run_exposure(
                &mut database,
                &library,
                "removed-root-new-run",
                &canonical_root,
                AdapterKind::CodexCli,
            )
            .unwrap_err();
        assert!(format!("{error:#}").contains("access is suspended"));
    }

    #[test]
    fn run_preflight_repairs_a_deleted_managed_projection() {
        let root = temporary_directory("rovai-projection-preflight-repair");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        install_official_and_assign(&mut database, &library, &[SkillDeliveryGroupKey::Codex]);
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();
        let entry = root.join(".codex/skills/analyze-agent-codebase");
        fs::remove_file(&entry).unwrap();

        let exposure = SkillProjectionReconciler
            .prepare_run_exposure(
                &mut database,
                &library,
                "preflight-repair-run",
                &root,
                AdapterKind::CodexCli,
            )
            .unwrap();

        assert!(entry.canonicalize().is_ok());
        assert_eq!(exposure.snapshot.skills.len(), 1);
        assert_eq!(exposure.snapshot.skills[0].status, "ready");
    }

    #[test]
    fn run_preflight_rejects_a_corrupted_library_revision() {
        let root = temporary_directory("rovai-projection-preflight-corrupted");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        let skill =
            install_official_and_assign(&mut database, &library, &[SkillDeliveryGroupKey::Codex]);
        fs::write(
            library
                .revision_content_path(&skill.id, &skill.current_revision.id)
                .join("SKILL.md"),
            "corrupted after import",
        )
        .unwrap();

        let error = SkillProjectionReconciler
            .prepare_run_exposure(
                &mut database,
                &library,
                "preflight-corrupted-run",
                &root,
                AdapterKind::CodexCli,
            )
            .unwrap_err();

        let message = format!("{error:#}");
        assert!(message.contains("Skill projection verification failed"));
        assert!(message.contains("analyze-agent-codebase"));
        assert!(!root.join(".codex/skills/analyze-agent-codebase").exists());
    }

    #[test]
    fn explicit_reconciliation_unions_active_adapters_and_repairs_recorded_lumen_links() {
        let root = temporary_directory("rovai-projection-known-root");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        let skill = install_official_and_assign(
            &mut database,
            &library,
            &[
                SkillDeliveryGroupKey::Codex,
                SkillDeliveryGroupKey::ClaudeCompatible,
                SkillDeliveryGroupKey::Antigravity,
            ],
        );
        let now = Utc::now().to_rfc3339();
        for (installation_id, adapter_kind, profile_id) in [
            ("projection-codex", "codex-cli", "agent_1"),
            ("projection-claude", "claude-code-cli", "agent_3"),
            ("projection-antigravity", "antigravity-app", "agent_2"),
        ] {
            database
                .connection()
                .execute(
                    r#"
                    INSERT INTO adapter_installation(
                        id, adapter_kind, executable_path, command_name,
                        installation_class, source, auth_scope,
                        enabled, version, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, 'test-runtime', 'custom',
                              'custom', 'test', 1, 1, ?4, ?4)
                    "#,
                    params![
                        installation_id,
                        adapter_kind,
                        format!("/tmp/{installation_id}"),
                        now,
                    ],
                )
                .unwrap();
            database
                .connection()
                .execute(
                    r#"
                    UPDATE agent_profile
                    SET selected_runtime_adapter_kind = ?1,
                        default_runtime_installation_id = ?2,
                        default_model_selection_json = '{"mode":"runtime_default"}',
                        default_permission_config_json = ?3
                    WHERE id = ?4
                    "#,
                    params![
                        adapter_kind,
                        installation_id,
                        serde_json::to_string(&serde_json::json!({
                            "adapterKind": adapter_kind,
                            "schemaVersion": 1,
                            "values": {},
                        }))
                        .unwrap(),
                        profile_id,
                    ],
                )
                .unwrap();
        }
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, project_binding_kind, project_path,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES (
                    'known-root-camp', 'Known Root', 'directory', ?1,
                    0, 1, ?2, ?2
                )
                "#,
                params![root.to_string_lossy().as_ref(), now],
            )
            .unwrap();
        for profile_id in ["agent_1", "agent_3", "agent_2"] {
            database
                .connection()
                .execute(
                    r#"
                    INSERT INTO camp_member(
                        camp_id, agent_id, status,
                        capability_overrides_json, version, joined_at
                    ) VALUES (
                        'known-root-camp', ?1, 'active', '{}', 1, ?2
                    )
                    "#,
                    params![profile_id, now],
                )
                .unwrap();
        }

        let requirements = SkillProjectionReconciler
            .known_execution_roots(&database)
            .unwrap();
        assert_eq!(requirements.len(), 1);
        assert_eq!(
            requirements[0].delivery_groups,
            [
                SkillDeliveryGroupKey::Codex,
                SkillDeliveryGroupKey::ClaudeCompatible,
                SkillDeliveryGroupKey::Antigravity,
            ]
        );
        let reports = SkillProjectionReconciler
            .reconcile_known_roots(&mut database, &library)
            .unwrap();
        assert_eq!(reports.len(), 1);
        for native_root in [".codex/skills", ".claude/skills", ".agent/skills"] {
            assert!(
                root.join(native_root)
                    .join("analyze-agent-codebase")
                    .canonicalize()
                    .is_ok()
            );
        }

        let codex_entry = root.join(".codex/skills/analyze-agent-codebase");
        fs::remove_file(&codex_entry).unwrap();
        let old_lumen_target = dirs::home_dir()
            .unwrap()
            .join(".lumen/skills/revisions")
            .join(Uuid::new_v4().to_string())
            .join(Uuid::new_v4().to_string());
        assert!(!old_lumen_target.exists());
        symlink(&old_lumen_target, &codex_entry).unwrap();

        let automatic_report = SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();
        assert_eq!(fs::read_link(&codex_entry).unwrap(), old_lumen_target);
        assert!(automatic_report.observations.iter().any(|observation| {
            observation.group_key == SkillDeliveryGroupKey::Codex
                && observation.skill_id == skill.id
                && observation.state == "shadowed"
                && observation.last_error_code.as_deref() == Some("broken_or_unavailable_symlink")
        }));

        SkillProjectionReconciler
            .reconcile_known_roots(&mut database, &library)
            .unwrap();
        assert_eq!(
            codex_entry.canonicalize().unwrap(),
            library
                .revision_content_path(&skill.id, &skill.current_revision.id)
                .canonicalize()
                .unwrap()
        );

        fs::remove_file(&codex_entry).unwrap();
        let external_broken_target =
            std::env::temp_dir().join(format!("rovai-external-broken-{}", Uuid::new_v4()));
        symlink(&external_broken_target, &codex_entry).unwrap();
        SkillProjectionReconciler
            .reconcile_known_roots(&mut database, &library)
            .unwrap();
        assert_eq!(
            fs::read_link(&codex_entry).unwrap(),
            external_broken_target,
            "explicit repair must preserve broken links outside the retired .lumen revision tree"
        );
    }

    #[test]
    fn opencode_and_copilot_reuse_a_healthy_claude_projection_then_fall_back() {
        let root = temporary_directory("rovai-projection-overlap");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        install_official_and_assign(
            &mut database,
            &library,
            &[
                SkillDeliveryGroupKey::Opencode,
                SkillDeliveryGroupKey::Copilot,
                SkillDeliveryGroupKey::ClaudeCompatible,
            ],
        );
        let required = [
            SkillDeliveryGroupKey::Opencode,
            SkillDeliveryGroupKey::Copilot,
            SkillDeliveryGroupKey::ClaudeCompatible,
        ];

        let report = SkillProjectionReconciler
            .reconcile_root(&mut database, &library, &root, &required)
            .unwrap();

        let name = "analyze-agent-codebase";
        assert!(
            root.join(".claude/skills")
                .join(name)
                .canonicalize()
                .is_ok()
        );
        assert!(!root.join(".opencode/skills").exists());
        assert!(!root.join(".github/skills").exists());
        for group_key in [
            SkillDeliveryGroupKey::Opencode,
            SkillDeliveryGroupKey::Copilot,
        ] {
            let observation = report
                .observations
                .iter()
                .find(|observation| observation.group_key == group_key)
                .unwrap();
            assert_eq!(observation.state, "ready");
            assert_eq!(
                observation.delivered_via_group_key,
                Some(SkillDeliveryGroupKey::ClaudeCompatible)
            );
        }

        let claude_entry = root.join(".claude/skills").join(name);
        fs::remove_file(&claude_entry).unwrap();
        fs::create_dir_all(&claude_entry).unwrap();
        fs::write(claude_entry.join("SKILL.md"), "runtime native").unwrap();
        let report = SkillProjectionReconciler
            .reconcile_root(&mut database, &library, &root, &required)
            .unwrap();
        assert!(
            root.join(".opencode/skills")
                .join(name)
                .canonicalize()
                .is_ok()
        );
        assert!(
            root.join(".github/skills")
                .join(name)
                .canonicalize()
                .is_ok()
        );
        assert!(report.observations.iter().any(|observation| {
            observation.group_key == SkillDeliveryGroupKey::ClaudeCompatible
                && observation.state == "shadowed"
        }));
    }

    #[test]
    fn agents_native_duplicate_is_observed_but_never_managed() {
        let root = temporary_directory("rovai-projection-native-duplicate");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        install_official_and_assign(&mut database, &library, &[SkillDeliveryGroupKey::Codex]);
        let native = root.join(".agents/skills/analyze-agent-codebase");
        fs::create_dir_all(&native).unwrap();
        fs::write(native.join("SKILL.md"), "runtime native").unwrap();

        let report = SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();

        assert_eq!(
            fs::read_to_string(native.join("SKILL.md")).unwrap(),
            "runtime native"
        );
        assert!(
            root.join(".codex/skills/analyze-agent-codebase")
                .canonicalize()
                .is_ok()
        );
        assert_eq!(report.observations.len(), 1);
        assert!(report.observations[0].duplicate_visible);
    }

    #[test]
    fn git_exclude_block_removal_preserves_every_user_owned_byte() {
        let user_only = "# user rule\n\n/local-only\n";
        assert_eq!(
            strip_managed_exclude_block(user_only).unwrap(),
            (user_only.to_string(), false)
        );
        let with_block = format!(
            "# user rule\n\n{GIT_EXCLUDE_BEGIN}\n/.agents/skills/demo\n{GIT_EXCLUDE_END}\n/local-only\n\n"
        );
        assert_eq!(
            strip_managed_exclude_block(&with_block).unwrap(),
            ("# user rule\n\n/local-only\n\n".to_string(), true)
        );
        let legacy_blocks = concat!(
            "# BEGIN HORIZONWARD MANAGED SKILL PROJECTIONS\n",
            "/.agents/skills/recent\n",
            "# END HORIZONWARD MANAGED SKILL PROJECTIONS\n",
            "# BEGIN LUMEN MANAGED SKILL PROJECTIONS\n",
            "/.agents/skills/old\n",
            "# END LUMEN MANAGED SKILL PROJECTIONS\n",
            "/user-owned\n",
        );
        assert_eq!(
            strip_managed_exclude_block(legacy_blocks).unwrap(),
            ("/user-owned\n".to_string(), true)
        );
    }

    #[test]
    fn replaced_external_symlink_is_never_removed_as_a_rovai_projection() {
        let root = temporary_directory("rovai-projection-external-link");
        let external = temporary_directory("rovai-projection-external-target");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = crate::test_support::fresh_schema_database_fast_at(&data);
        let library = SkillLibraryService::new(library_root).unwrap();
        install_official_and_assign(&mut database, &library, &[SkillDeliveryGroupKey::Codex]);
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();
        let skill = library
            .list(&database)
            .unwrap()
            .into_iter()
            .find(|skill| skill.name == "analyze-agent-codebase")
            .unwrap();
        let entry = root.join(".codex/skills/analyze-agent-codebase");
        fs::remove_file(&entry).unwrap();
        symlink(&external, &entry).unwrap();
        library
            .set_enabled(
                &mut database,
                &user_envelope(
                    "disable-replaced-link",
                    SetSkillEnabledCommand {
                        skill_id: skill.id,
                        expected_version: skill.version,
                        enabled: false,
                    },
                ),
            )
            .unwrap();
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[SkillDeliveryGroupKey::Codex],
            )
            .unwrap();
        assert_eq!(
            entry.canonicalize().unwrap(),
            external.canonicalize().unwrap()
        );
    }
}
