use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt, symlink},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    command::{DomainCommand, sealed},
    db::Database,
    memory::{MemoryScopeKind, MemoryService, ProjectedMemoryEntry},
};

pub const MEMORY_PROJECTION_FORMATTER_VERSION: i64 = 1;
pub const MEMORY_GUIDE_SCHEMA_VERSION: i64 = 1;
pub const MEMORY_PROJECTION_FILE_MAX_BYTES: usize = 256 * 1024;
pub const MEMORY_GUIDE_MAX_BYTES: usize = 8 * 1024;

const UNAVAILABLE_BODY: &str = concat!(
    "# Lumen Memory — UNAVAILABLE\n\n",
    "This projection is unavailable. Do not infer or reconstruct its contents.\n",
);
const TEMP_PREFIX: &str = ".lumen-memory-";
const GENERATION_PREFIX: &str = ".generation-";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReconcileMemoryProjectionsCommand {}

impl sealed::Sealed for ReconcileMemoryProjectionsCommand {}
impl DomainCommand for ReconcileMemoryProjectionsCommand {
    const TYPE: &'static str = "memory.projections.reconcile";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryGuideLocation {
    pub scope: String,
    pub path: String,
    pub state: String,
    pub digest: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryGuideSnapshot {
    pub schema_version: i64,
    pub formatter_version: i64,
    pub guide: String,
    pub locations: Vec<MemoryGuideLocation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProjectionObservationView {
    pub logical_key: String,
    pub view_kind: String,
    pub camp_id: Option<String>,
    pub perspective_agent_profile_id: Option<String>,
    pub path: String,
    pub formatter_version: i64,
    pub source_digest: String,
    pub published_digest: Option<String>,
    pub state: String,
    pub last_error_code: Option<String>,
    pub last_observed_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryProjectionReport {
    pub reconciled: usize,
    pub ready: usize,
    pub empty: usize,
    pub unavailable: usize,
    pub write_failed: usize,
}

#[derive(Debug, Clone)]
pub struct MemoryProjectionService {
    root: PathBuf,
}

struct FileProjectionTarget<'a> {
    logical_key: &'a str,
    view_kind: &'a str,
    camp_id: Option<&'a str>,
    perspective_agent_profile_id: Option<&'a str>,
    path: &'a Path,
}

impl MemoryProjectionService {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            root: data_dir.join("memory").join("projections").join("v1"),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn reconcile_all(&self, database: &mut Database) -> Result<MemoryProjectionReport> {
        ensure_private_directory(&self.root)?;
        let memory = MemoryService::default();
        let mut observations = Vec::new();

        observations.push(self.reconcile_file(
            database,
            FileProjectionTarget {
                logical_key: "hearth",
                view_kind: "hearth",
                camp_id: None,
                perspective_agent_profile_id: None,
                path: &self.root.join("hearth").join("current.md"),
            },
            memory.projection_entries(database, MemoryScopeKind::Hearth, None, None)?,
        ));

        let active_agents = active_agent_ids(database)?;
        for agent_id in &active_agents {
            observations.push(
                self.reconcile_file(
                    database,
                    FileProjectionTarget {
                        logical_key: &format!("companion:{agent_id}"),
                        view_kind: "companion",
                        camp_id: None,
                        perspective_agent_profile_id: Some(agent_id),
                        path: &self
                            .root
                            .join("companions")
                            .join(agent_id)
                            .join("current.md"),
                    },
                    memory.projection_entries(
                        database,
                        MemoryScopeKind::Companion,
                        Some(agent_id),
                        None,
                    )?,
                ),
            );
        }

        for (camp_id, members) in active_camp_members(database)? {
            for agent_id in &members {
                let mut files = BTreeMap::new();
                for counterparty in &members {
                    if counterparty == agent_id {
                        continue;
                    }
                    files.insert(
                        format!("{counterparty}.md"),
                        memory.projection_entries(
                            database,
                            MemoryScopeKind::Relationship,
                            Some(agent_id),
                            Some(counterparty),
                        )?,
                    );
                }
                observations.push(
                    self.reconcile_relationship_directory(database, &camp_id, agent_id, &files),
                );
            }
        }

        let expected_keys = observations
            .iter()
            .map(|observation| observation.logical_key.clone())
            .collect::<Vec<_>>();
        remove_obsolete_observations(database, &expected_keys)?;

        let mut report = MemoryProjectionReport {
            reconciled: observations.len(),
            ready: 0,
            empty: 0,
            unavailable: 0,
            write_failed: 0,
        };
        for observation in observations {
            match observation.state.as_str() {
                "ready" => report.ready += 1,
                "empty" => report.empty += 1,
                "unavailable" => report.unavailable += 1,
                _ => report.write_failed += 1,
            }
        }
        Ok(report)
    }

    pub fn prepare_guide(
        &self,
        database: &mut Database,
        camp_id: &str,
        agent_profile_id: &str,
    ) -> Result<MemoryGuideSnapshot> {
        self.reconcile_all(database)?;
        let specifications = [
            (
                "hearth".to_string(),
                "hearth".to_string(),
                self.root.join("hearth").join("current.md"),
            ),
            (
                "companion".to_string(),
                format!("companion:{agent_profile_id}"),
                self.root
                    .join("companions")
                    .join(agent_profile_id)
                    .join("current.md"),
            ),
            (
                "relationship".to_string(),
                format!("relationship:{camp_id}:{agent_profile_id}"),
                self.root
                    .join("camps")
                    .join(camp_id)
                    .join("agents")
                    .join(agent_profile_id)
                    .join("relationships")
                    .join("current"),
            ),
        ];
        let mut locations = Vec::new();
        for (scope, logical_key, path) in specifications {
            let observation = load_observation(database, &logical_key)?;
            locations.push(MemoryGuideLocation {
                scope,
                path: path.to_string_lossy().to_string(),
                state: observation
                    .as_ref()
                    .map_or_else(|| "unavailable".to_string(), |value| value.state.clone()),
                digest: observation.and_then(|value| value.published_digest),
            });
        }
        let guide = render_guide(&locations);
        if guide.len() > MEMORY_GUIDE_MAX_BYTES {
            anyhow::bail!("memory.projection_unavailable: Memory Guide exceeds 8 KiB");
        }
        Ok(MemoryGuideSnapshot {
            schema_version: MEMORY_GUIDE_SCHEMA_VERSION,
            formatter_version: MEMORY_PROJECTION_FORMATTER_VERSION,
            guide,
            locations,
        })
    }

    pub fn list_issues(&self, database: &Database) -> Result<Vec<MemoryProjectionObservationView>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT logical_key, view_kind, camp_id, perspective_agent_profile_id,
                   path, formatter_version, source_digest, published_digest,
                   state, last_error_code, last_observed_at
            FROM memory_projection_observation
            WHERE state IN ('unavailable', 'write_failed')
            ORDER BY last_observed_at DESC, logical_key
            "#,
        )?;
        statement
            .query_map([], observation_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    fn reconcile_file(
        &self,
        database: &mut Database,
        target: FileProjectionTarget<'_>,
        entries: Vec<ProjectedMemoryEntry>,
    ) -> MemoryProjectionObservationView {
        let rendered = render_memory_file(target.view_kind, &entries);
        let source_digest = digest(rendered.as_bytes());
        let state = if entries.is_empty() { "empty" } else { "ready" };
        let published = if rendered.len() > MEMORY_PROJECTION_FILE_MAX_BYTES {
            atomic_write_private(target.path, UNAVAILABLE_BODY.as_bytes())
                .map(|_| {
                    (
                        Some(digest(UNAVAILABLE_BODY.as_bytes())),
                        "unavailable",
                        None,
                    )
                })
                .unwrap_or_else(|_| (None, "write_failed", Some("memory_projection_write_failed")))
        } else {
            atomic_write_private(target.path, rendered.as_bytes())
                .map(|_| (Some(source_digest.clone()), state, None))
                .unwrap_or_else(|_| {
                    let _ = atomic_write_private(target.path, UNAVAILABLE_BODY.as_bytes());
                    (None, "write_failed", Some("memory_projection_write_failed"))
                })
        };
        let observation = MemoryProjectionObservationView {
            logical_key: target.logical_key.to_string(),
            view_kind: target.view_kind.to_string(),
            camp_id: target.camp_id.map(str::to_string),
            perspective_agent_profile_id: target.perspective_agent_profile_id.map(str::to_string),
            path: target.path.to_string_lossy().to_string(),
            formatter_version: MEMORY_PROJECTION_FORMATTER_VERSION,
            source_digest,
            published_digest: published.0,
            state: published.1.to_string(),
            last_error_code: published.2.map(str::to_string),
            last_observed_at: Utc::now().to_rfc3339(),
        };
        if let Err(error) = upsert_observation(database, &observation) {
            eprintln!("failed to record Memory projection observation: {error:#}");
        }
        observation
    }

    fn reconcile_relationship_directory(
        &self,
        database: &mut Database,
        camp_id: &str,
        agent_profile_id: &str,
        files: &BTreeMap<String, Vec<ProjectedMemoryEntry>>,
    ) -> MemoryProjectionObservationView {
        let parent = self
            .root
            .join("camps")
            .join(camp_id)
            .join("agents")
            .join(agent_profile_id)
            .join("relationships");
        let current = parent.join("current");
        let logical_key = format!("relationship:{camp_id}:{agent_profile_id}");
        let mut source_items = Vec::new();
        let mut rendered_files = Vec::new();
        let mut has_entries = false;
        let mut oversized = false;
        for (name, entries) in files {
            has_entries |= !entries.is_empty();
            let rendered = render_memory_file("relationship", entries);
            oversized |= rendered.len() > MEMORY_PROJECTION_FILE_MAX_BYTES;
            let file_digest = digest(rendered.as_bytes());
            source_items.push(format!("{name}\0{file_digest}\n"));
            rendered_files.push((name, rendered));
        }
        let source_digest = digest(source_items.concat().as_bytes());

        let publication = (|| -> Result<(String, &'static str)> {
            ensure_private_directory(&parent)?;
            let generation_name = format!("{GENERATION_PREFIX}{}", Uuid::new_v4());
            let generation = parent.join(&generation_name);
            ensure_private_directory(&generation)?;
            if oversized {
                atomic_write_private(
                    &generation.join("UNAVAILABLE.md"),
                    UNAVAILABLE_BODY.as_bytes(),
                )?;
            } else {
                for (name, rendered) in &rendered_files {
                    atomic_write_private(&generation.join(name), rendered.as_bytes())?;
                }
            }
            replace_relative_symlink(&current, &generation_name)?;
            cleanup_generations(&parent, &generation_name)?;
            let published_digest = if oversized {
                digest(UNAVAILABLE_BODY.as_bytes())
            } else {
                source_digest.clone()
            };
            Ok((
                published_digest,
                if oversized {
                    "unavailable"
                } else if has_entries {
                    "ready"
                } else {
                    "empty"
                },
            ))
        })();

        let (published_digest, state, last_error_code) = match publication {
            Ok((published_digest, state)) => (Some(published_digest), state, None),
            Err(_) => {
                let _ = publish_unavailable_generation(&parent, &current);
                (
                    None,
                    "write_failed",
                    Some("memory_projection_write_failed".to_string()),
                )
            }
        };
        let observation = MemoryProjectionObservationView {
            logical_key,
            view_kind: "relationship".to_string(),
            camp_id: Some(camp_id.to_string()),
            perspective_agent_profile_id: Some(agent_profile_id.to_string()),
            path: current.to_string_lossy().to_string(),
            formatter_version: MEMORY_PROJECTION_FORMATTER_VERSION,
            source_digest,
            published_digest,
            state: state.to_string(),
            last_error_code,
            last_observed_at: Utc::now().to_rfc3339(),
        };
        if let Err(error) = upsert_observation(database, &observation) {
            eprintln!("failed to record Relationship projection observation: {error:#}");
        }
        observation
    }
}

fn render_memory_file(view_kind: &str, entries: &[ProjectedMemoryEntry]) -> String {
    let title = match view_kind {
        "hearth" => "Hearth Memory",
        "companion" => "Companion Memory",
        _ => "Relationship Memory",
    };
    let mut output =
        format!("<!-- lumen-memory-projection:v1; read-only; source=SQLite -->\n# {title}\n\n");
    if entries.is_empty() {
        output.push_str("_No active memory._\n");
        return output;
    }
    for entry in entries {
        output.push_str(&format!(
            "## {}\n\n- memoryId: `{}`\n- revisionId: `{}`\n",
            kind_name(entry),
            entry.memory_id,
            entry.revision_id,
        ));
        if let Some(direction) = entry.direction {
            output.push_str(&format!("- direction: `{direction:?}`\n").to_ascii_lowercase());
        }
        output.push('\n');
        for line in entry.body.lines() {
            output.push_str("    ");
            output.push_str(line);
            output.push('\n');
        }
        output.push('\n');
    }
    output
}

fn kind_name(entry: &ProjectedMemoryEntry) -> &'static str {
    match entry.kind {
        crate::memory::MemoryKind::Preference => "Preference",
        crate::memory::MemoryKind::Agreement => "Agreement",
        crate::memory::MemoryKind::Lesson => "Lesson",
    }
}

fn render_guide(locations: &[MemoryGuideLocation]) -> String {
    let mut output = String::from(
        "[MEMORY_GUIDE]\n\
Long-term memory is user-governed background for durable preferences, agreements, and lessons.\n\
Read a listed path only when it is relevant. Current user input, the Work Brief or Task, permissions, collaboration context, and real repository state always take priority.\n\
These are live read-only projections and may change during this AgentRun. Never edit them directly.\n",
    );
    for location in locations {
        output.push_str(&format!(
            "- {}: {} [{}]\n",
            location.scope, location.path, location.state
        ));
    }
    output.push_str(
        "For relationship memory, inspect only the listed directory when needed; its child files are per counterparty.\n\
Do not rely on an unavailable scope. Use memory.propose_change for a durable suggestion; a saved proposal is pending and is not effective until the user accepts it.\n\
[/MEMORY_GUIDE]",
    );
    output
}

fn active_agent_ids(database: &Database) -> Result<Vec<String>> {
    let mut statement = database.connection().prepare(
        "SELECT id FROM agent_profile WHERE profile_status = 'active' ORDER BY member_order, id",
    )?;
    statement
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn active_camp_members(database: &Database) -> Result<Vec<(String, Vec<String>)>> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT camp.id, camp_member.agent_profile_id
        FROM camp
        JOIN camp_member ON camp_member.camp_id = camp.id
        JOIN agent_profile ON agent_profile.id = camp_member.agent_profile_id
        WHERE camp.status = 'active'
          AND camp_member.status = 'active'
          AND camp_member.leave_requested_at IS NULL
          AND agent_profile.profile_status = 'active'
        ORDER BY camp.id, agent_profile.member_order, agent_profile.id
        "#,
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut camps = BTreeMap::<String, Vec<String>>::new();
    for (camp_id, agent_id) in rows {
        camps.entry(camp_id).or_default().push(agent_id);
    }
    Ok(camps.into_iter().collect())
}

fn upsert_observation(
    database: &mut Database,
    observation: &MemoryProjectionObservationView,
) -> Result<()> {
    database.connection_mut().execute(
        r#"
        INSERT INTO memory_projection_observation(
            logical_key, view_kind, camp_id, perspective_agent_profile_id,
            path, formatter_version, source_digest, published_digest,
            state, last_error_code, last_observed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(logical_key) DO UPDATE SET
            view_kind = excluded.view_kind,
            camp_id = excluded.camp_id,
            perspective_agent_profile_id = excluded.perspective_agent_profile_id,
            path = excluded.path,
            formatter_version = excluded.formatter_version,
            source_digest = excluded.source_digest,
            published_digest = excluded.published_digest,
            state = excluded.state,
            last_error_code = excluded.last_error_code,
            last_observed_at = excluded.last_observed_at
        "#,
        params![
            observation.logical_key,
            observation.view_kind,
            observation.camp_id,
            observation.perspective_agent_profile_id,
            observation.path,
            observation.formatter_version,
            observation.source_digest,
            observation.published_digest,
            observation.state,
            observation.last_error_code,
            observation.last_observed_at,
        ],
    )?;
    Ok(())
}

fn load_observation(
    database: &Database,
    logical_key: &str,
) -> Result<Option<MemoryProjectionObservationView>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT logical_key, view_kind, camp_id, perspective_agent_profile_id,
                   path, formatter_version, source_digest, published_digest,
                   state, last_error_code, last_observed_at
            FROM memory_projection_observation
            WHERE logical_key = ?1
            "#,
            [logical_key],
            observation_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn observation_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<MemoryProjectionObservationView> {
    Ok(MemoryProjectionObservationView {
        logical_key: row.get(0)?,
        view_kind: row.get(1)?,
        camp_id: row.get(2)?,
        perspective_agent_profile_id: row.get(3)?,
        path: row.get(4)?,
        formatter_version: row.get(5)?,
        source_digest: row.get(6)?,
        published_digest: row.get(7)?,
        state: row.get(8)?,
        last_error_code: row.get(9)?,
        last_observed_at: row.get(10)?,
    })
}

fn remove_obsolete_observations(database: &mut Database, expected_keys: &[String]) -> Result<()> {
    let mut statement = database
        .connection()
        .prepare("SELECT logical_key, path FROM memory_projection_observation")?;
    let existing = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    for (key, path) in existing {
        if !expected_keys.contains(&key) {
            let candidate = PathBuf::from(path);
            if candidate.starts_with(&database_memory_root(database)?) {
                remove_projection_entry(&candidate);
            }
            database.connection_mut().execute(
                "DELETE FROM memory_projection_observation WHERE logical_key = ?1",
                [key],
            )?;
        }
    }
    Ok(())
}

fn database_memory_root(database: &Database) -> Result<PathBuf> {
    database
        .path()
        .parent()
        .map(|path| path.join("memory").join("projections").join("v1"))
        .context("Database has no Data Dir parent")
}

fn remove_projection_entry(path: &Path) {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || metadata.is_file() => {
            let _ = fs::remove_file(path);
        }
        Ok(metadata) if metadata.is_dir() => {
            let _ = fs::remove_dir_all(path);
        }
        _ => {}
    }
}

fn atomic_write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("Projection file has no parent")?;
    ensure_private_directory(parent)?;
    let temporary = parent.join(format!("{TEMP_PREFIX}{}", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)
        .with_context(|| format!("failed to create {}", temporary.display()))?;
    let write_result = (|| -> Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

fn ensure_private_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn replace_relative_symlink(current: &Path, target_name: &str) -> Result<()> {
    let parent = current.parent().context("current has no parent")?;
    let temporary = parent.join(format!("{TEMP_PREFIX}current-{}", Uuid::new_v4()));
    symlink(target_name, &temporary)?;
    if fs::symlink_metadata(current)
        .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
    {
        // Everything below the private Projection root is disposable read-side state.
        // A real directory at `current` cannot be atomically replaced by rename(2);
        // remove this externally polluted entry so the new generation can fail closed.
        fs::remove_dir_all(current)?;
    }
    let result = fs::rename(&temporary, current);
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(Into::into)
}

fn cleanup_generations(parent: &Path, current_generation: &str) -> Result<()> {
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(GENERATION_PREFIX) && name != current_generation {
            let path = entry.path();
            if fs::symlink_metadata(&path)?.is_dir() {
                fs::remove_dir_all(path)?;
            }
        }
    }
    Ok(())
}

fn publish_unavailable_generation(parent: &Path, current: &Path) -> Result<()> {
    ensure_private_directory(parent)?;
    let generation_name = format!("{GENERATION_PREFIX}{}", Uuid::new_v4());
    let generation = parent.join(&generation_name);
    ensure_private_directory(&generation)?;
    atomic_write_private(
        &generation.join("UNAVAILABLE.md"),
        UNAVAILABLE_BODY.as_bytes(),
    )?;
    replace_relative_symlink(current, &generation_name)?;
    cleanup_generations(parent, &generation_name)
}

fn digest(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        command::{ActorRef, CommandEnvelope},
        memory::{CreateMemoryCommand, MemoryKind},
    };

    fn database() -> (Database, PathBuf) {
        let root = std::env::temp_dir().join(format!("lumen-memory-projection-{}", Uuid::new_v4()));
        (Database::open(&root).unwrap(), root)
    }

    #[test]
    fn deterministic_projection_is_read_only_and_private() {
        let (mut database, root) = database();
        let memory = MemoryService::default();
        memory
            .create(
                &mut database,
                &CommandEnvelope {
                    command_id: "create-hearth".to_string(),
                    actor: ActorRef::User {
                        user_id: "local-user".to_string(),
                    },
                    camp_id: None,
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: CreateMemoryCommand {
                        scope: MemoryScopeKind::Hearth,
                        kind: MemoryKind::Preference,
                        body: "Prefer concise status updates.".to_string(),
                        companion_agent_profile_id: None,
                        relationship_agent_profile_ids: vec![],
                        direction: None,
                        directed_actor_agent_profile_id: None,
                        review_after: None,
                    },
                },
            )
            .unwrap();
        let projection = MemoryProjectionService::new(&root);
        projection.reconcile_all(&mut database).unwrap();
        let path = projection.root().join("hearth/current.md");
        let first = fs::read(&path).unwrap();
        fs::write(&path, b"externally polluted").unwrap();
        projection.reconcile_all(&mut database).unwrap();
        assert_eq!(first, fs::read(&path).unwrap());
        database
            .connection()
            .execute(
                "DELETE FROM memory_projection_observation WHERE logical_key = 'hearth'",
                [],
            )
            .unwrap();
        projection.reconcile_all(&mut database).unwrap();
        assert_eq!(first, fs::read(&path).unwrap());
        assert!(
            String::from_utf8(first)
                .unwrap()
                .contains("Prefer concise status updates.")
        );
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn relationship_projection_is_perspective_filtered() {
        let (mut database, root) = database();
        let memory = MemoryService::default();
        for (command_id, direction, actor, body) in [
            (
                "mutual",
                crate::memory::RelationshipDirection::Mutual,
                None,
                "Coordinate before changing shared interfaces.",
            ),
            (
                "a-to-b",
                crate::memory::RelationshipDirection::Directed,
                Some("agent-luoke"),
                "Luoke reviews migrations before handing them to Muwa.",
            ),
            (
                "b-to-a",
                crate::memory::RelationshipDirection::Directed,
                Some("agent-muwa"),
                "Muwa gives Luoke a concise verification summary.",
            ),
        ] {
            memory
                .create(
                    &mut database,
                    &CommandEnvelope {
                        command_id: command_id.to_string(),
                        actor: ActorRef::User {
                            user_id: "local-user".to_string(),
                        },
                        camp_id: None,
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: CreateMemoryCommand {
                            scope: MemoryScopeKind::Relationship,
                            kind: MemoryKind::Agreement,
                            body: body.to_string(),
                            companion_agent_profile_id: None,
                            relationship_agent_profile_ids: vec![
                                "agent-luoke".to_string(),
                                "agent-muwa".to_string(),
                            ],
                            direction: Some(direction),
                            directed_actor_agent_profile_id: actor.map(str::to_string),
                            review_after: None,
                        },
                    },
                )
                .unwrap();
        }
        let for_luoke = memory
            .projection_entries(
                &database,
                MemoryScopeKind::Relationship,
                Some("agent-luoke"),
                Some("agent-muwa"),
            )
            .unwrap();
        let for_muwa = memory
            .projection_entries(
                &database,
                MemoryScopeKind::Relationship,
                Some("agent-muwa"),
                Some("agent-luoke"),
            )
            .unwrap();
        assert_eq!(for_luoke.len(), 2);
        assert_eq!(for_muwa.len(), 2);
        assert!(
            for_luoke
                .iter()
                .any(|entry| entry.body.contains("Luoke reviews"))
        );
        assert!(
            !for_luoke
                .iter()
                .any(|entry| entry.body.contains("Muwa gives"))
        );
        assert!(
            for_muwa
                .iter()
                .any(|entry| entry.body.contains("Muwa gives"))
        );
        assert!(
            !for_muwa
                .iter()
                .any(|entry| entry.body.contains("Luoke reviews"))
        );
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn polluted_relationship_current_directory_is_replaced_by_unavailable_generation() {
        let root =
            std::env::temp_dir().join(format!("lumen-memory-current-pollution-{}", Uuid::new_v4()));
        let parent = root.join("relationships");
        let current = parent.join("current");
        fs::create_dir_all(&current).unwrap();
        fs::write(current.join("polluted.md"), b"must not remain readable").unwrap();

        publish_unavailable_generation(&parent, &current).unwrap();

        assert!(
            fs::symlink_metadata(&current)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(
            fs::read_to_string(current.join("UNAVAILABLE.md")).unwrap(),
            UNAVAILABLE_BODY
        );
        assert!(!current.join("polluted.md").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
