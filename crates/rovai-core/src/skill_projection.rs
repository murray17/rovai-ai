use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt, symlink},
    path::{Component, Path, PathBuf},
    process::Command,
    str::FromStr,
};

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    agent_profile::AdapterKind,
    agent_runtime_adapter::{AgentRuntimeAdapterRegistry, NativeSkillRootKind},
    command::{DomainCommand, canonical_json_digest, sealed},
    db::Database,
    skill::{SkillLibraryService, SkillView},
};

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
    pub native_roots: Vec<NativeSkillRootKind>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillProjectionObservationView {
    pub execution_root: String,
    pub native_root_kind: NativeSkillRootKind,
    pub skill_id: String,
    pub revision_id: String,
    pub entry_path: String,
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
pub struct SkillProjectionIssue {
    pub execution_root: String,
    pub native_root_kind: NativeSkillRootKind,
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
    pub native_root_kind: String,
    pub status: String,
    pub entry_path: Option<String>,
    pub reason_code: Option<String>,
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
            schema_version: 1,
            skills: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedSkillExposure {
    pub snapshot: SkillExposureSnapshot,
    pub digest: String,
    pub drain_required: bool,
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

#[derive(Debug, Default)]
pub struct SkillProjectionReconciler;

impl SkillProjectionReconciler {
    pub fn known_execution_roots(
        &self,
        database: &Database,
    ) -> Result<Vec<ExecutionRootSkillRequirement>> {
        let registry = AgentRuntimeAdapterRegistry::default();
        let mut requirements = BTreeMap::<String, BTreeSet<NativeSkillRootKind>>::new();
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
                  ON agent_profile.id = camp_member.agent_profile_id
                 AND agent_profile.profile_status = 'present'
                JOIN adapter_installation AS installation
                  ON installation.id = agent_profile.default_runtime_installation_id
                 AND installation.enabled = 1
                WHERE camp.status = 'active'
                "#,
            )?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (execution_root, adapter_kind) = row?;
                let adapter_kind = AdapterKind::from_str(&adapter_kind)?;
                let capability = registry.skill_discovery(adapter_kind);
                if capability.supported {
                    requirements
                        .entry(execution_root)
                        .or_default()
                        .extend(capability.native_roots);
                }
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
                if capability.supported {
                    requirements
                        .entry(execution_root)
                        .or_default()
                        .extend(capability.native_roots);
                }
            }
        }
        {
            let mut statement = database
                .connection()
                .prepare("SELECT DISTINCT execution_root FROM skill_projection_observation")?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            for row in rows {
                requirements.entry(row?).or_default();
            }
        }
        Ok(requirements
            .into_iter()
            .map(
                |(execution_root, native_roots)| ExecutionRootSkillRequirement {
                    execution_root,
                    native_roots: native_roots.into_iter().collect(),
                },
            )
            .collect())
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
            match self.reconcile_root(
                database,
                library,
                Path::new(&requirement.execution_root),
                &requirement.native_roots,
            ) {
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
        self.resume_projection_waits(database)?;
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
        let enabled_skills = library
            .list(database)?
            .into_iter()
            .filter(|skill| skill.enabled && skill.lifecycle_status == "active")
            .collect::<Vec<_>>();
        if !capability.supported {
            let snapshot = SkillExposureSnapshot {
                schema_version: 1,
                skills: enabled_skills
                    .into_iter()
                    .map(|skill| SkillExposureEntry {
                        skill_id: skill.id,
                        name: skill.name,
                        revision_id: skill.current_revision.id,
                        content_digest: skill.current_revision.content_digest,
                        native_root_kind: "unsupported".to_string(),
                        status: "unsupported".to_string(),
                        entry_path: None,
                        reason_code: Some("adapter_skill_discovery_unsupported".to_string()),
                    })
                    .collect(),
            };
            return Ok(PreparedSkillExposure {
                digest: canonical_json_digest(&serde_json::to_value(&snapshot)?)?,
                snapshot,
                drain_required: false,
            });
        }

        let canonical_root = execution_root.canonicalize().with_context(|| {
            format!(
                "Skill projection execution root is unavailable: {}",
                execution_root.display()
            )
        })?;
        let canonical_root_text = canonical_root.to_string_lossy().to_string();
        let mut native_roots = capability
            .native_roots
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        for requirement in self.known_execution_roots(database)? {
            if Path::new(&requirement.execution_root)
                .canonicalize()
                .is_ok_and(|root| root == canonical_root)
            {
                native_roots.extend(requirement.native_roots);
            }
        }
        self.reconcile_root_internal(
            database,
            library,
            &canonical_root,
            &native_roots.iter().copied().collect::<Vec<_>>(),
            Some(agent_run_id),
        )?;

        let drain_required =
            has_pending_removal(database, &canonical_root_text, &capability.native_roots)?;
        let mut entries = Vec::new();
        for native_root_kind in &capability.native_roots {
            for skill in &enabled_skills {
                let observation =
                    load_observation(database, &canonical_root_text, *native_root_kind, &skill.id)?;
                let (revision_id, content_digest, status, entry_path, reason_code) = if let Some(
                    observation,
                ) =
                    observation
                {
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
                        normalize_exposure_status(&observation.state).to_string(),
                        Some(observation.entry_path),
                        observation.last_error_code,
                    )
                } else {
                    (
                        skill.current_revision.id.clone(),
                        skill.current_revision.content_digest.clone(),
                        "error".to_string(),
                        Some(
                            canonical_root
                                .join(native_root_kind.relative_path())
                                .join(&skill.name)
                                .to_string_lossy()
                                .to_string(),
                        ),
                        Some("projection_observation_missing".to_string()),
                    )
                };
                entries.push(SkillExposureEntry {
                    skill_id: skill.id.clone(),
                    name: skill.name.clone(),
                    revision_id,
                    content_digest,
                    native_root_kind: native_root_kind.as_str().to_string(),
                    status,
                    entry_path,
                    reason_code,
                });
            }
        }
        entries.sort_by(|left, right| {
            left.native_root_kind
                .cmp(&right.native_root_kind)
                .then_with(|| left.name.cmp(&right.name))
                .then_with(|| left.skill_id.cmp(&right.skill_id))
        });
        let snapshot = SkillExposureSnapshot {
            schema_version: 1,
            skills: entries,
        };
        Ok(PreparedSkillExposure {
            digest: canonical_json_digest(&serde_json::to_value(&snapshot)?)?,
            snapshot,
            drain_required,
        })
    }

    pub fn reconcile_root(
        &self,
        database: &mut Database,
        library: &SkillLibraryService,
        execution_root: &Path,
        required_native_roots: &[NativeSkillRootKind],
    ) -> Result<SkillProjectionReport> {
        self.reconcile_root_internal(
            database,
            library,
            execution_root,
            required_native_roots,
            None,
        )
    }

    fn reconcile_root_internal(
        &self,
        database: &mut Database,
        library: &SkillLibraryService,
        execution_root: &Path,
        required_native_roots: &[NativeSkillRootKind],
        ignored_agent_run_id: Option<&str>,
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
        let active_run_present = has_active_run(database, &execution_root, ignored_agent_run_id)?;
        let required_native_roots = required_native_roots
            .iter()
            .copied()
            .collect::<BTreeSet<_>>();
        let skills = library.list(database)?;
        let mut managed_git_entries = BTreeSet::new();

        for native_root_kind in [
            NativeSkillRootKind::Agents,
            NativeSkillRootKind::Claude,
            NativeSkillRootKind::Antigravity,
        ] {
            let native_root = execution_root.join(native_root_kind.relative_path());
            cleanup_safe_temporary_links(database, library, &native_root)?;
            for skill in &skills {
                let desired = required_native_roots.contains(&native_root_kind)
                    && skill.enabled
                    && skill.lifecycle_status == "active";
                let entry_path = native_root.join(&skill.name);
                let state = inspect_entry(database, library, &entry_path)?;
                if desired {
                    reconcile_desired_entry(
                        database,
                        library,
                        &execution_root_text,
                        native_root_kind,
                        skill,
                        &entry_path,
                        state,
                        active_run_present,
                    )?;
                } else {
                    reconcile_undesired_entry(
                        database,
                        &execution_root_text,
                        native_root_kind,
                        skill,
                        &entry_path,
                        state,
                        active_run_present,
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
            SELECT observation.execution_root, observation.native_root_kind,
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
                let root_kind = row.get::<_, String>(1)?;
                Ok(SkillProjectionIssue {
                    execution_root: row.get(0)?,
                    native_root_kind: NativeSkillRootKind::from_str(&root_kind)
                        .map_err(to_sql_error)?,
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

    fn finalize_deleting_skills(
        &self,
        database: &mut Database,
        library: &SkillLibraryService,
    ) -> Result<()> {
        let active_run_count: i64 = database.connection().query_row(
            "SELECT COUNT(*) FROM agent_run WHERE status IN ('running', 'waiting')",
            [],
            |row| row.get(0),
        )?;
        if active_run_count != 0 {
            return Ok(());
        }
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

    fn resume_projection_waits(&self, database: &mut Database) -> Result<()> {
        let waiting = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT agent_run.id, agent_run.workspace_json, camp.project_path,
                       agent_run.camp_turn_id, camp_turn.camp_id,
                       agent_run.execution_epoch
                FROM agent_run
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                JOIN camp ON camp.id = camp_turn.camp_id
                WHERE agent_run.status = 'waiting'
                  AND agent_run.wait_reason = 'skill_projection_drain'
                  AND NOT EXISTS (
                      SELECT 1 FROM context_manifest
                      WHERE context_manifest.agent_run_id = agent_run.id
                  )
                ORDER BY agent_run.created_at, agent_run.id
                "#,
            )?;
            statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        for (run_id, workspace_json, project_path, turn_id, camp_id, execution_epoch) in waiting {
            let execution_root =
                workspace_execution_root(workspace_json.as_deref()).unwrap_or(project_path);
            let canonical_root = match Path::new(&execution_root).canonicalize() {
                Ok(root) => root.to_string_lossy().to_string(),
                Err(_) => continue,
            };
            let pending: i64 = database.connection().query_row(
                r#"
                SELECT COUNT(*) FROM skill_projection_observation
                WHERE execution_root = ?1 AND state = 'pending_removal'
                "#,
                [&canonical_root],
                |row| row.get(0),
            )?;
            if pending != 0 {
                continue;
            }
            let now = Utc::now().to_rfc3339();
            let transaction = database.connection_mut().transaction()?;
            let updated = transaction.execute(
                r#"
                UPDATE agent_run
                SET status = 'queued', wait_reason = NULL,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1 AND status = 'waiting'
                  AND wait_reason = 'skill_projection_drain'
                  AND execution_epoch = ?3
                "#,
                params![run_id, now, execution_epoch],
            )?;
            if updated == 1 {
                transaction.execute(
                    r#"
                    UPDATE camp_turn
                    SET status = 'running', version = version + 1, updated_at = ?2
                    WHERE id = ?1 AND status = 'waiting'
                    "#,
                    params![turn_id, now],
                )?;
                transaction.execute(
                    r#"
                    INSERT INTO event_log(
                        event_id, event_type, payload_json,
                        camp_id, entity_type, entity_id,
                        execution_epoch, actor_type, actor_id, created_at
                    ) VALUES (?1, 'skill.projection_drain_completed', ?2,
                              ?3, 'agent_run', ?4, ?5,
                              'system', 'skill-projection-reconciler', ?6)
                    "#,
                    params![
                        Uuid::new_v4().to_string(),
                        serde_json::to_string(&serde_json::json!({
                            "agentRunId": run_id,
                            "executionEpoch": execution_epoch,
                        }))?,
                        camp_id,
                        run_id,
                        execution_epoch,
                        now,
                    ],
                )?;
            }
            transaction.commit()?;
        }
        Ok(())
    }
}

fn normalize_exposure_status(state: &str) -> &str {
    match state {
        "ready" | "stale" | "shadowed" | "unsupported" | "error" => state,
        _ => "error",
    }
}

fn has_pending_removal(
    database: &Database,
    execution_root: &str,
    native_roots: &[NativeSkillRootKind],
) -> Result<bool> {
    for native_root in native_roots {
        let count: i64 = database.connection().query_row(
            r#"
            SELECT COUNT(*) FROM skill_projection_observation
            WHERE execution_root = ?1 AND native_root_kind = ?2
              AND state = 'pending_removal'
            "#,
            params![execution_root, native_root.as_str()],
            |row| row.get(0),
        )?;
        if count != 0 {
            return Ok(true);
        }
    }
    Ok(false)
}

fn load_observation(
    database: &Database,
    execution_root: &str,
    native_root_kind: NativeSkillRootKind,
    skill_id: &str,
) -> Result<Option<SkillProjectionObservationView>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT execution_root, native_root_kind, skill_id, revision_id,
                   entry_path, state, last_error_code, last_observed_at
            FROM skill_projection_observation
            WHERE execution_root = ?1 AND native_root_kind = ?2 AND skill_id = ?3
            "#,
            params![execution_root, native_root_kind.as_str(), skill_id],
            |row| {
                let root_kind = row.get::<_, String>(1)?;
                Ok(SkillProjectionObservationView {
                    execution_root: row.get(0)?,
                    native_root_kind: NativeSkillRootKind::from_str(&root_kind)
                        .map_err(to_sql_error)?,
                    skill_id: row.get(2)?,
                    revision_id: row.get(3)?,
                    entry_path: row.get(4)?,
                    state: row.get(5)?,
                    last_error_code: row.get(6)?,
                    last_observed_at: row.get(7)?,
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
    native_root_kind: NativeSkillRootKind,
    skill: &SkillView,
    entry_path: &Path,
    state: EntryState,
    active_run_present: bool,
) -> Result<()> {
    if let Err(error) = library.verify_revision_content(&skill.current_revision) {
        upsert_observation(
            database,
            execution_root,
            native_root_kind,
            skill,
            &skill.current_revision.id,
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
    let desired_target = library.revision_content_path(&skill.id, &skill.current_revision.id);
    match state {
        EntryState::Missing if active_run_present => upsert_observation(
            database,
            execution_root,
            native_root_kind,
            skill,
            &skill.current_revision.id,
            entry_path,
            "stale",
            Some("active_run_projection_change_deferred"),
        ),
        EntryState::Missing => {
            publish_managed_link(&desired_target, entry_path, false)?;
            upsert_observation(
                database,
                execution_root,
                native_root_kind,
                skill,
                &skill.current_revision.id,
                entry_path,
                "ready",
                None,
            )
        }
        EntryState::ProjectOwned(reason) => upsert_observation(
            database,
            execution_root,
            native_root_kind,
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
                native_root_kind,
                entry_path,
                &actual,
            )?;
            upsert_observation(
                database,
                execution_root,
                native_root_kind,
                skill,
                &actual.revision_id,
                entry_path,
                "ready",
                None,
            )
        }
        EntryState::Managed(actual) if actual.skill_id == skill.id && active_run_present => {
            ensure_observation_proves_entry(
                database,
                execution_root,
                native_root_kind,
                entry_path,
                &actual,
            )?;
            upsert_observation(
                database,
                execution_root,
                native_root_kind,
                skill,
                &actual.revision_id,
                entry_path,
                "stale",
                Some("active_run_revision_switch_deferred"),
            )
        }
        EntryState::Managed(actual) if actual.skill_id == skill.id => {
            ensure_observation_proves_entry(
                database,
                execution_root,
                native_root_kind,
                entry_path,
                &actual,
            )?;
            publish_managed_link(&desired_target, entry_path, true)?;
            upsert_observation(
                database,
                execution_root,
                native_root_kind,
                skill,
                &skill.current_revision.id,
                entry_path,
                "ready",
                None,
            )
        }
        EntryState::Managed(_) => upsert_observation(
            database,
            execution_root,
            native_root_kind,
            skill,
            &skill.current_revision.id,
            entry_path,
            "shadowed",
            Some("entry_owned_by_another_rovai_skill"),
        ),
    }
}

fn reconcile_undesired_entry(
    database: &mut Database,
    execution_root: &str,
    native_root_kind: NativeSkillRootKind,
    skill: &SkillView,
    entry_path: &Path,
    state: EntryState,
    active_run_present: bool,
) -> Result<()> {
    match state {
        EntryState::Managed(actual) if actual.skill_id == skill.id && active_run_present => {
            ensure_observation_proves_entry(
                database,
                execution_root,
                native_root_kind,
                entry_path,
                &actual,
            )?;
            upsert_observation(
                database,
                execution_root,
                native_root_kind,
                skill,
                &actual.revision_id,
                entry_path,
                "pending_removal",
                Some("active_run_projection_removal_deferred"),
            )
        }
        EntryState::Managed(actual) if actual.skill_id == skill.id => {
            ensure_observation_proves_entry(
                database,
                execution_root,
                native_root_kind,
                entry_path,
                &actual,
            )?;
            fs::remove_file(entry_path)
                .with_context(|| format!("failed to remove {}", entry_path.display()))?;
            delete_observation(database, execution_root, native_root_kind, &skill.id)
        }
        EntryState::Missing | EntryState::ProjectOwned(_) | EntryState::Managed(_) => {
            delete_observation(database, execution_root, native_root_kind, &skill.id)
        }
    }
}

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
        [skill_id, revisions, revision_id, content]
            if revisions == "revisions"
                && content == "content"
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
    native_root_kind: NativeSkillRootKind,
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
              AND native_root_kind = ?2
              AND skill_id = ?3
            "#,
            params![execution_root, native_root_kind.as_str(), actual.skill_id],
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
            execution_root, native_root_kind, skill_id, revision_id,
            entry_path, state, last_error_code, last_observed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'stale',
                  'observation_rebuilt_from_managed_target', ?6)
        ON CONFLICT(execution_root, native_root_kind, skill_id) DO UPDATE SET
            revision_id = excluded.revision_id,
            entry_path = excluded.entry_path,
            state = excluded.state,
            last_error_code = excluded.last_error_code,
            last_observed_at = excluded.last_observed_at
        "#,
        params![
            execution_root,
            native_root_kind.as_str(),
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
    native_root_kind: NativeSkillRootKind,
    skill: &SkillView,
    revision_id: &str,
    entry_path: &Path,
    state: &str,
    last_error_code: Option<&str>,
) -> Result<()> {
    database.connection().execute(
        r#"
        INSERT INTO skill_projection_observation(
            execution_root, native_root_kind, skill_id, revision_id,
            entry_path, state, last_error_code, last_observed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(execution_root, native_root_kind, skill_id) DO UPDATE SET
            revision_id = excluded.revision_id,
            entry_path = excluded.entry_path,
            state = excluded.state,
            last_error_code = excluded.last_error_code,
            last_observed_at = excluded.last_observed_at
        "#,
        params![
            execution_root,
            native_root_kind.as_str(),
            skill.id,
            revision_id,
            entry_path.to_string_lossy().as_ref(),
            state,
            last_error_code,
            Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn delete_observation(
    database: &mut Database,
    execution_root: &str,
    native_root_kind: NativeSkillRootKind,
    skill_id: &str,
) -> Result<()> {
    database.connection().execute(
        r#"
        DELETE FROM skill_projection_observation
        WHERE execution_root = ?1 AND native_root_kind = ?2 AND skill_id = ?3
        "#,
        params![execution_root, native_root_kind.as_str(), skill_id],
    )?;
    Ok(())
}

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

fn has_active_run(
    database: &Database,
    execution_root: &Path,
    ignored_agent_run_id: Option<&str>,
) -> Result<bool> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT agent_run.id, agent_run.workspace_json, camp.project_path
        FROM agent_run
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        JOIN camp ON camp.id = camp_turn.camp_id
        JOIN conversation ON conversation.id = agent_run.conversation_id
        WHERE (
            agent_run.status = 'running'
            OR (
                agent_run.status = 'waiting'
                AND (
                    agent_run.wait_reason IS NULL
                    OR agent_run.wait_reason <> 'skill_projection_drain'
                )
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
        ))
    })?;
    for row in rows {
        let (agent_run_id, workspace_json, project_path) = row?;
        if ignored_agent_run_id == Some(agent_run_id.as_str()) {
            continue;
        }
        let candidate = workspace_execution_root(workspace_json.as_deref()).unwrap_or(project_path);
        if Path::new(&candidate)
            .canonicalize()
            .is_ok_and(|value| value == execution_root)
        {
            return Ok(true);
        }
    }
    Ok(false)
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
        SELECT execution_root, native_root_kind, skill_id, revision_id,
               entry_path, state, last_error_code, last_observed_at
        FROM skill_projection_observation
        WHERE execution_root = ?1
        ORDER BY native_root_kind, entry_path
        "#,
    )?;
    Ok(statement
        .query_map([execution_root], |row| {
            let root_kind = row.get::<_, String>(1)?;
            Ok(SkillProjectionObservationView {
                execution_root: row.get(0)?,
                native_root_kind: NativeSkillRootKind::from_str(&root_kind)
                    .map_err(to_sql_error)?,
                skill_id: row.get(2)?,
                revision_id: row.get(3)?,
                entry_path: row.get(4)?,
                state: row.get(5)?,
                last_error_code: row.get(6)?,
                last_observed_at: row.get(7)?,
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
    let mode = fs::metadata(&exclude)
        .map(|metadata| metadata.permissions().mode() & 0o777)
        .unwrap_or(0o644);
    let temporary = parent.join(format!(".rovai-info-exclude-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(mode)
        .open(&temporary)?;
    file.write_all(next.as_bytes())?;
    file.sync_all()?;
    fs::rename(&temporary, &exclude)?;
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        command::{ActorRef, CommandEnvelope},
        context::{ContextService, SkillExposurePreparation},
        skill::{
            CommitSkillImportCommand, DeleteSkillCommand, SetSkillEnabledCommand,
            SkillLibraryService,
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
        library
            .set_enabled(
                database,
                &user_envelope(
                    "enable-projection-skill",
                    SetSkillEnabledCommand {
                        skill_id: skill.id.clone(),
                        expected_version: skill.version,
                        enabled: true,
                    },
                ),
            )
            .unwrap();
        library.get(database, &skill.id).unwrap().unwrap()
    }

    fn insert_active_run(database: &Database, execution_root: &Path) {
        let now = Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, project_binding_kind, project_path, status,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES (
                    'projection-camp', 'Projection', 'directory', ?1,
                    'active', 0, 1, ?2, ?2
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
                    id, camp_id, agent_profile_id, created_at, updated_at
                ) VALUES (
                    'projection-conversation', 'projection-camp', 'agent-luoke', ?1, ?1
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
                    responsibility_key, start_reason, purpose, expected_output,
                    completion_role, effective_config_json, workspace_json,
                    status, idempotency_key, runtime_adapter_kind, execution_epoch,
                    created_at, started_at, updated_at
                ) VALUES (
                    'projection-run', 'projection-turn', 'projection-conversation',
                    0, 0, 'projection-trigger-message',
                    'projection-test', 'initial', 'test', 'test',
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
        database
            .connection()
            .execute(
                r#"
                INSERT INTO conversation(
                    id, camp_id, agent_profile_id, created_at, updated_at
                ) VALUES (
                    'projection-conversation-new', 'projection-camp', 'agent-muwa', ?1, ?1
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
                    responsibility_key, start_reason, purpose, expected_output,
                    completion_role, effective_config_json, workspace_json,
                    status, idempotency_key, runtime_adapter_kind, execution_epoch,
                    created_at, started_at, updated_at
                ) VALUES (
                    'projection-run-new', 'projection-turn', 'projection-conversation-new',
                    0, 0, 'projection-trigger-message',
                    'projection-test-new', 'initial', 'test', 'test',
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
        let mut database = Database::open(&data).unwrap();
        let library = SkillLibraryService::new(library_root.clone()).unwrap();
        library.install_bundled_skills(&mut database).unwrap();

        let report = SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[NativeSkillRootKind::Agents, NativeSkillRootKind::Claude],
            )
            .unwrap();
        assert_eq!(report.observations.len(), 6);
        assert!(
            report
                .observations
                .iter()
                .all(|observation| observation.state == "ready")
        );
        for name in ["grill-me", "grill-with-docs", "memory-stewardship"] {
            let agents = root.join(".agents/skills").join(name);
            let claude = root.join(".claude/skills").join(name);
            assert!(
                fs::symlink_metadata(&agents)
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
                agents.canonicalize().unwrap(),
                claude.canonicalize().unwrap()
            );
        }
        assert!(!root.join(".agent/skills").exists());
        assert!(!root.join(".opencode/skills").exists());
        assert!(!root.join(".github/skills").exists());
        let exclude_content = fs::read_to_string(exclude).unwrap();
        assert!(exclude_content.contains("# user rule\n/local-only"));
        assert!(exclude_content.contains("/.agents/skills/grill-me"));
        assert!(exclude_content.contains("/.claude/skills/grill-with-docs"));
        let status = Command::new("git")
            .args(["status", "--porcelain", "--untracked-files=all"])
            .current_dir(&root)
            .output()
            .unwrap();
        assert!(status.status.success());
        assert_eq!(String::from_utf8(status.stdout).unwrap(), "");
    }

    #[test]
    fn run_preflight_ignores_only_itself_and_records_actual_exposure() {
        let root = temporary_directory("rovai-projection-exposure");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = Database::open(&data).unwrap();
        let library = SkillLibraryService::new(library_root).unwrap();
        library.install_bundled_skills(&mut database).unwrap();
        let conflict = root.join(".agents/skills/grill-me");
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
        assert!(!exposure.drain_required);
        assert_eq!(exposure.snapshot.schema_version, 1);
        assert_eq!(exposure.snapshot.skills.len(), 3);
        let shadowed = exposure
            .snapshot
            .skills
            .iter()
            .find(|skill| skill.name == "grill-me")
            .unwrap();
        assert_eq!(shadowed.status, "shadowed");
        assert_eq!(
            shadowed.reason_code.as_deref(),
            Some("project_entry_exists")
        );
        let ready = exposure
            .snapshot
            .skills
            .iter()
            .find(|skill| skill.name == "grill-with-docs")
            .unwrap();
        assert_eq!(ready.status, "ready");
        assert_eq!(
            exposure.digest,
            canonical_json_digest(&serde_json::to_value(&exposure.snapshot).unwrap()).unwrap()
        );
    }

    #[test]
    fn waiting_native_session_protects_projection_except_for_projection_drain() {
        let root = temporary_directory("rovai-projection-wait-lock");
        let data = temporary_directory("rovai-projection-db");
        let database = Database::open(&data).unwrap();
        insert_active_run(&database, &root);
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'waiting', wait_reason = 'context_compaction'
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
        assert!(has_active_run(&database, &canonical, None).unwrap());
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_run SET wait_reason = 'skill_projection_drain'
                WHERE id = 'projection-run'
                "#,
                [],
            )
            .unwrap();
        assert!(!has_active_run(&database, &canonical, None).unwrap());
    }

    #[test]
    fn project_owned_entry_wins_and_lost_observation_is_rebuilt_safely() {
        let root = temporary_directory("rovai-projection-conflict");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = Database::open(&data).unwrap();
        let library = SkillLibraryService::new(library_root).unwrap();
        library.install_bundled_skills(&mut database).unwrap();
        let conflict = root.join(".agents/skills/grill-me");
        fs::create_dir_all(&conflict).unwrap();
        fs::write(conflict.join("SKILL.md"), "project owned").unwrap();

        let report = SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[NativeSkillRootKind::Agents],
            )
            .unwrap();
        let shadowed = report
            .observations
            .iter()
            .find(|observation| observation.entry_path.ends_with("/grill-me"))
            .unwrap();
        assert_eq!(shadowed.state, "shadowed");
        assert_eq!(
            fs::read_to_string(conflict.join("SKILL.md")).unwrap(),
            "project owned"
        );

        let managed = root.join(".agents/skills/grill-with-docs");
        assert!(managed.canonicalize().is_ok());
        let managed_entry_path = root
            .canonicalize()
            .unwrap()
            .join(".agents/skills/grill-with-docs")
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
                &[NativeSkillRootKind::Agents],
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
    fn imported_delete_drains_projection_then_hard_deletes_content_and_metadata() {
        let root = temporary_directory("rovai-projection-delete");
        let source = temporary_directory("rovai-projection-source");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = Database::open(&data).unwrap();
        let library = SkillLibraryService::new(library_root).unwrap();
        let skill = import_skill(&mut database, &library, &source, "delete-me");
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[NativeSkillRootKind::Agents],
            )
            .unwrap();
        let entry = root.join(".agents/skills/delete-me");
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
            .reconcile_known_roots(&mut database, &library)
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
    fn disabling_waits_for_active_run_before_removing_a_managed_entry() {
        let root = temporary_directory("rovai-projection-drain");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = Database::open(&data).unwrap();
        let library = SkillLibraryService::new(library_root).unwrap();
        library.install_bundled_skills(&mut database).unwrap();
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[NativeSkillRootKind::Agents],
            )
            .unwrap();
        let skill = library
            .list(&database)
            .unwrap()
            .into_iter()
            .find(|skill| skill.name == "grill-me")
            .unwrap();
        let entry = root.join(".agents/skills/grill-me");
        insert_active_run(&database, &root);
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
        let report = SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[NativeSkillRootKind::Agents],
            )
            .unwrap();
        assert!(entry.canonicalize().is_ok());
        assert!(report.observations.iter().any(|observation| {
            observation.entry_path.ends_with("/grill-me") && observation.state == "pending_removal"
        }));

        let now = Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'succeeded', ended_at = ?1, updated_at = ?1 WHERE id = 'projection-run'",
                [&now],
            )
            .unwrap();
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[NativeSkillRootKind::Agents],
            )
            .unwrap();
        assert!(fs::symlink_metadata(entry).is_err());
    }

    #[test]
    fn disabled_projection_blocks_new_run_until_the_previous_run_drains() {
        let root = temporary_directory("rovai-projection-new-run-drain");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = Database::open(&data).unwrap();
        let library = SkillLibraryService::new(library_root).unwrap();
        library.install_bundled_skills(&mut database).unwrap();
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[NativeSkillRootKind::Agents],
            )
            .unwrap();
        insert_active_run(&database, &root);
        let skill = library
            .list(&database)
            .unwrap()
            .into_iter()
            .find(|skill| skill.name == "grill-me")
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
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[NativeSkillRootKind::Agents],
            )
            .unwrap();
        insert_second_active_run(&database, &root);
        let waiting = ContextService
            .prepare_skill_exposure(&mut database, &library, "projection-run-new", 1)
            .unwrap();
        assert!(matches!(
            waiting,
            SkillExposurePreparation::Waiting(ref wait)
                if wait.reason == "skill_projection_drain"
        ));

        let now = Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'succeeded', ended_at = ?1, updated_at = ?1
                WHERE id = 'projection-run'
                "#,
                [&now],
            )
            .unwrap();
        SkillProjectionReconciler
            .reconcile_known_roots(&mut database, &library)
            .unwrap();
        let resumed: (String, Option<String>) = database
            .connection()
            .query_row(
                "SELECT status, wait_reason FROM agent_run WHERE id = 'projection-run-new'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(resumed, ("queued".to_string(), None));
        assert!(fs::symlink_metadata(root.join(".agents/skills/grill-me")).is_err());
    }

    #[test]
    fn startup_requirements_union_active_camp_member_adapters() {
        let root = temporary_directory("rovai-projection-known-root");
        let data = temporary_directory("rovai-projection-db");
        let library_root = temporary_directory("rovai-projection-library");
        let mut database = Database::open(&data).unwrap();
        let library = SkillLibraryService::new(library_root).unwrap();
        library.install_bundled_skills(&mut database).unwrap();
        let now = Utc::now().to_rfc3339();
        for (installation_id, adapter_kind, profile_id) in [
            ("projection-codex", "codex-cli", "agent-luoke"),
            ("projection-claude", "claude-code-cli", "agent-mianzhi"),
            ("projection-antigravity", "antigravity-app", "agent-muwa"),
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
                    "UPDATE agent_profile SET default_runtime_installation_id = ?1 WHERE id = ?2",
                    params![installation_id, profile_id],
                )
                .unwrap();
        }
        database
            .connection()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, project_binding_kind, project_path, status,
                    last_message_sequence, version, created_at, updated_at
                ) VALUES (
                    'known-root-camp', 'Known Root', 'directory', ?1,
                    'active', 0, 1, ?2, ?2
                )
                "#,
                params![root.to_string_lossy().as_ref(), now],
            )
            .unwrap();
        for profile_id in ["agent-luoke", "agent-mianzhi", "agent-muwa"] {
            database
                .connection()
                .execute(
                    r#"
                    INSERT INTO camp_member(
                        camp_id, agent_profile_id, status,
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
            requirements[0].native_roots,
            [
                NativeSkillRootKind::Agents,
                NativeSkillRootKind::Claude,
                NativeSkillRootKind::Antigravity,
            ]
        );
        let reports = SkillProjectionReconciler
            .reconcile_known_roots(&mut database, &library)
            .unwrap();
        assert_eq!(reports.len(), 1);
        for native_root in [".agents/skills", ".claude/skills", ".agent/skills"] {
            assert!(
                root.join(native_root)
                    .join("grill-me")
                    .canonicalize()
                    .is_ok()
            );
        }
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
        let mut database = Database::open(&data).unwrap();
        let library = SkillLibraryService::new(library_root).unwrap();
        library.install_bundled_skills(&mut database).unwrap();
        SkillProjectionReconciler
            .reconcile_root(
                &mut database,
                &library,
                &root,
                &[NativeSkillRootKind::Agents],
            )
            .unwrap();
        let skill = library
            .list(&database)
            .unwrap()
            .into_iter()
            .find(|skill| skill.name == "grill-me")
            .unwrap();
        let entry = root.join(".agents/skills/grill-me");
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
                &[NativeSkillRootKind::Agents],
            )
            .unwrap();
        assert_eq!(
            entry.canonicalize().unwrap(),
            external.canonicalize().unwrap()
        );
    }
}
