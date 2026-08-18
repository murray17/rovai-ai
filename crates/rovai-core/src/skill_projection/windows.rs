use std::{
    fs, io,
    path::{Component, Path, PathBuf},
    thread,
    time::Duration,
};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    Database, EntryState, ManagedEntry, SkillDeliveryGroupKey, SkillLibraryService,
    SkillProjectionGateBusy, SkillView, delete_observation, upsert_observation_for_operation,
};
use crate::platform::{
    private_storage::{
        admit_private_directory, atomic_write_private_json, create_private_json,
        open_private_read_file, prepare_private_directory, read_private_json,
    },
    windows_file_tree::{self, NodeKind},
};

const JOURNAL_SCHEMA_VERSION: i64 = 2;
const JOURNAL_DIRECTORY: &str = ".projection-journals";
const JOURNAL_MAX_BYTES: usize = 64 * 1024;
const JOURNAL_MAX_COUNT: usize = 1_024;
const RECOVERY_REQUIRED: &str = "skill_projection_recovery_required";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum JournalState {
    Prepared,
    OldMovedToBackup,
    NewPromoted,
    Verified,
    MetadataCommitted,
    CleanupPending,
    Completed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectionJournal {
    schema_version: i64,
    operation_id: String,
    root_identity: String,
    entry_path: String,
    staging_path: String,
    backup_path: String,
    skill_id: String,
    old_revision_id: Option<String>,
    old_content_digest: Option<String>,
    old_entry_identity: Option<String>,
    new_revision_id: String,
    new_content_digest: String,
    new_entry_identity: String,
    state: JournalState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DirectObservation {
    revision_id: String,
    entry_path: String,
    state: String,
    operation_id: Option<String>,
    entry_identity: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TreeEvidence {
    Missing,
    Expected,
    Foreign,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResumeOutcome {
    Completed,
    RestoredOld,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CrashPoint {
    BeforeStagingCopy,
    AfterStagingCopy,
    BeforePreparedJournal,
    AfterPreparedJournal,
    BeforeOldRename,
    AfterOldRename,
    BeforeOldMovedState,
    AfterOldMovedState,
    BeforeNewRename,
    AfterNewRename,
    BeforeNewPromotedState,
    AfterNewPromotedState,
    BeforeFinalVerification,
    AfterFinalVerification,
    BeforeVerifiedState,
    AfterVerifiedState,
    BeforeMetadataCommit,
    AfterMetadataCommit,
    BeforeMetadataCommittedState,
    AfterMetadataCommittedState,
    BeforeBackupDelete,
    AfterBackupDelete,
    BeforeCleanupPendingState,
    AfterCleanupPendingState,
    BeforeCompletedState,
    AfterCompletedState,
    BeforeJournalDelete,
    AfterJournalDelete,
}

#[cfg(test)]
thread_local! {
    static INJECTED_CRASH_POINT: std::cell::Cell<Option<CrashPoint>> = const {
        std::cell::Cell::new(None)
    };
}

struct ValidatedJournal {
    entry_path: PathBuf,
    staging_path: PathBuf,
    backup_path: PathBuf,
    group_key: SkillDeliveryGroupKey,
    skill: SkillView,
}

pub(super) fn recover_root(
    database: &mut Database,
    library: &SkillLibraryService,
    execution_root: &Path,
    mutation_allowed: bool,
) -> Result<()> {
    let root_identity = root_identity(execution_root)?;
    let journal_root = journal_root(library)?;
    let mut paths = fs::read_dir(&journal_root)?
        .collect::<io::Result<Vec<_>>>()?
        .into_iter()
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    paths.sort();
    if paths.len() > JOURNAL_MAX_COUNT {
        return recovery_bail("private journal directory exceeds its entry limit");
    }

    for path in paths {
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            return recovery_bail("private journal directory contains a non-Unicode entry");
        };
        if name.starts_with('.') && name.ends_with(".tmp") {
            // atomic_write_private_json can leave a private sibling only if the
            // process terminates between flush and rename. It is not authority.
            let file = open_private_read_file(&path)?;
            if file.metadata()?.len() > JOURNAL_MAX_BYTES as u64 {
                return recovery_bail("private journal temporary exceeds its byte limit");
            }
            drop(file);
            fs::remove_file(&path)?;
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            return recovery_bail("private journal directory contains an unknown entry");
        }
        let mut journal: ProjectionJournal = read_private_json(&path, JOURNAL_MAX_BYTES)
            .with_context(|| format!("{RECOVERY_REQUIRED}: invalid journal {}", path.display()))?;
        let entry_path = Path::new(&journal.entry_path);
        if journal.root_identity != root_identity && !entry_path.starts_with(execution_root) {
            continue;
        }
        if !mutation_allowed {
            return Err(SkillProjectionGateBusy {
                execution_root: path_text(execution_root)?.to_string(),
            }
            .into());
        }
        let outcome = resume_journal(database, library, execution_root, &path, &mut journal)?;
        if outcome == ResumeOutcome::RestoredOld {
            // The normal reconciliation pass immediately following recovery
            // will create a fresh operation for the still-desired Revision.
            continue;
        }
    }
    Ok(())
}

pub(super) fn publish_managed_copy(
    database: &mut Database,
    library: &SkillLibraryService,
    execution_root: &Path,
    skill: &SkillView,
    entry_path: &Path,
    old: Option<&ManagedEntry>,
) -> Result<()> {
    let operation_id = Uuid::new_v4().to_string();
    let parent = entry_path
        .parent()
        .context("Windows Skill projection entry has no parent")?;
    ensure_directory_chain(execution_root, parent)?;
    let staging_path = parent.join(format!(".rovai-skill-projection-{operation_id}.staging"));
    let backup_path = parent.join(format!(".rovai-skill-projection-{operation_id}.backup"));
    require_absent(&staging_path, "staging")?;
    require_absent(&backup_path, "backup")?;

    let (old_revision_id, old_content_digest, old_entry_identity) = if let Some(old) = old {
        let digest = revision_digest(database, &old.skill_id, &old.revision_id)?
            .context("managed Windows Skill projection has no immutable Revision")?;
        let group_key = group_for_entry(execution_root, entry_path, &skill.name)
            .context("managed Windows Skill projection is outside every delivery group")?;
        let observation = direct_observation(
            database,
            path_text(execution_root)?,
            group_key,
            &old.skill_id,
        )?
        .context("managed Windows Skill projection has no ownership observation")?;
        if observation.revision_id != old.revision_id
            || observation.entry_path != path_text(entry_path)?
        {
            return recovery_bail("managed Windows Skill projection ownership changed");
        }
        let identity = observation
            .entry_identity
            .context("managed Windows Skill projection has no entry identity")?;
        verify_tree_identity(library, entry_path, &skill.name, &digest, Some(&identity))?;
        (Some(old.revision_id.clone()), Some(digest), Some(identity))
    } else {
        (None, None, None)
    };

    maybe_crash(CrashPoint::BeforeStagingCopy)?;
    library.copy_revision_to_projection_staging(&skill.current_revision, &staging_path)?;
    let new_entry_identity = verify_tree_identity(
        library,
        &staging_path,
        &skill.name,
        &skill.current_revision.content_digest,
        None,
    )?;
    maybe_crash(CrashPoint::AfterStagingCopy)?;
    let journal = ProjectionJournal {
        schema_version: JOURNAL_SCHEMA_VERSION,
        operation_id: operation_id.clone(),
        root_identity: root_identity(execution_root)?,
        entry_path: path_text(entry_path)?.to_string(),
        staging_path: path_text(&staging_path)?.to_string(),
        backup_path: path_text(&backup_path)?.to_string(),
        skill_id: skill.id.clone(),
        old_revision_id,
        old_content_digest,
        old_entry_identity,
        new_revision_id: skill.current_revision.id.clone(),
        new_content_digest: skill.current_revision.content_digest.clone(),
        new_entry_identity,
        state: JournalState::Prepared,
    };
    let journal_path = journal_path(library, &operation_id)?;
    maybe_crash(CrashPoint::BeforePreparedJournal)?;
    if let Err(error) = create_private_json(&journal_path, &journal) {
        let _ = remove_owned_tree(&staging_path, &operation_id);
        return Err(error).context("failed to create Windows Skill projection journal");
    }
    maybe_crash(CrashPoint::AfterPreparedJournal)?;
    let mut journal = journal;
    let outcome = resume_journal(
        database,
        library,
        execution_root,
        &journal_path,
        &mut journal,
    )?;
    if outcome != ResumeOutcome::Completed {
        return recovery_bail("a new projection operation unexpectedly restored its old Revision");
    }
    Ok(())
}

pub(super) fn inspect_entry(
    database: &Database,
    library: &SkillLibraryService,
    entry_path: &Path,
) -> Result<EntryState> {
    let metadata = match fs::symlink_metadata(entry_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(EntryState::Missing),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Ok(EntryState::ProjectOwned("project_entry_exists"));
    }
    let observation = direct_observation_for_entry(database, entry_path)?;
    let Some((skill_id, observation)) = observation else {
        return Ok(EntryState::ProjectOwned("project_entry_exists"));
    };
    if observation.state == "shadowed" {
        return Ok(EntryState::ProjectOwned("project_entry_exists"));
    }
    let Some(operation_id) = observation.operation_id.as_deref() else {
        return Ok(EntryState::ProjectOwned(
            "managed_operation_identity_missing",
        ));
    };
    let Some(entry_identity) = observation.entry_identity.as_deref() else {
        return Ok(EntryState::ProjectOwned("managed_entry_identity_missing"));
    };
    if Uuid::parse_str(operation_id)
        .ok()
        .is_none_or(|value| value.to_string() != operation_id)
    {
        return Ok(EntryState::ProjectOwned(
            "managed_operation_identity_invalid",
        ));
    }
    let Some((name, digest)) = revision_identity(database, &skill_id, &observation.revision_id)?
    else {
        return Ok(EntryState::ProjectOwned("unknown_managed_target"));
    };
    if entry_path.file_name().and_then(|value| value.to_str()) != Some(name.as_str()) {
        return Ok(EntryState::ProjectOwned("managed_target_name_mismatch"));
    }
    if verify_tree_identity(library, entry_path, &name, &digest, Some(entry_identity)).is_err() {
        return Ok(EntryState::ProjectOwned("managed_target_corrupted"));
    }
    Ok(EntryState::Managed(ManagedEntry {
        skill_id,
        revision_id: observation.revision_id,
    }))
}

pub(super) fn remove_managed_copy(
    database: &mut Database,
    library: &SkillLibraryService,
    execution_root: &str,
    group_key: SkillDeliveryGroupKey,
    skill: &SkillView,
    entry_path: &Path,
    actual: &ManagedEntry,
) -> Result<()> {
    let observation = direct_observation(database, execution_root, group_key, &skill.id)?
        .context("Windows Skill projection ownership observation is missing")?;
    if observation.revision_id != actual.revision_id
        || observation.entry_path != path_text(entry_path)?
        || observation.state == "shadowed"
    {
        return recovery_bail("Windows Skill projection delete ownership evidence does not agree");
    }
    let digest = revision_digest(database, &skill.id, &actual.revision_id)?
        .context("Windows Skill projection delete Revision is missing")?;
    let entry_identity = observation
        .entry_identity
        .as_deref()
        .context("Windows Skill projection delete entry identity is missing")?;
    verify_tree_identity(
        library,
        entry_path,
        &skill.name,
        &digest,
        Some(entry_identity),
    )?;
    let operation_id = observation
        .operation_id
        .as_deref()
        .context("Windows Skill projection delete operation identity is missing")?;
    let parsed = Uuid::parse_str(operation_id)
        .context("Windows Skill projection delete operation identity is invalid")?;
    if parsed.to_string() != operation_id {
        return recovery_bail(
            "Windows Skill projection delete operation identity is not canonical",
        );
    }
    remove_owned_tree(entry_path, operation_id)?;
    delete_observation(database, execution_root, group_key, &skill.id)
}

pub(super) fn audit_temporary_paths(
    library: &SkillLibraryService,
    native_root: &Path,
) -> Result<()> {
    let entries = match fs::read_dir(native_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let Some(operation_id) = temporary_operation_id(&name) else {
            continue;
        };
        let operation_journal = journal_path(library, operation_id)?;
        if operation_journal.is_file() {
            return recovery_bail("a journal-owned temporary path remained after root recovery");
        }
        return recovery_bail("an unjournaled Skill projection temporary path was found");
    }
    Ok(())
}

pub(super) fn prune_run_registrations(database: &mut Database) -> Result<()> {
    database.connection().execute(
        r#"
        DELETE FROM skill_projection_run_registration AS registration
        WHERE NOT EXISTS (
            SELECT 1
            FROM agent_run
            WHERE agent_run.id = registration.agent_run_id
              AND agent_run.execution_epoch = registration.execution_epoch
              AND agent_run.status IN ('running', 'waiting')
        )
        "#,
        [],
    )?;
    Ok(())
}

pub(super) fn has_active_run_registration(
    database: &Database,
    execution_root: &Path,
    ignored_agent_run_id: Option<&str>,
) -> Result<bool> {
    let identity = root_identity(execution_root)?;
    let active: i64 = database.connection().query_row(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM skill_projection_run_registration AS registration
            JOIN agent_run ON agent_run.id = registration.agent_run_id
            WHERE registration.root_identity = ?1
              AND registration.agent_run_id <> COALESCE(?2, '')
              AND registration.execution_epoch = agent_run.execution_epoch
              AND agent_run.status IN ('running', 'waiting')
        )
        "#,
        params![identity, ignored_agent_run_id],
        |row| row.get(0),
    )?;
    Ok(active != 0)
}

pub(super) fn register_run(
    database: &mut Database,
    execution_root: &Path,
    agent_run_id: &str,
) -> Result<()> {
    let (execution_epoch, status, workspace_json, project_path): (
        i64,
        String,
        Option<String>,
        String,
    ) = database.connection().query_row(
        r#"
        SELECT agent_run.execution_epoch, agent_run.status,
               agent_run.workspace_json, camp.project_path
        FROM agent_run
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        JOIN camp ON camp.id = camp_turn.camp_id
        WHERE agent_run.id = ?1
        "#,
        [agent_run_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    if !matches!(status.as_str(), "running" | "waiting") || execution_epoch < 1 {
        anyhow::bail!("AgentRun is not active for Windows Skill projection registration");
    }
    let persisted_root =
        super::workspace_execution_root(workspace_json.as_deref()).unwrap_or(project_path);
    let persisted_identity = root_identity(Path::new(&persisted_root))?;
    let identity = root_identity(execution_root)?;
    if persisted_identity != identity {
        return recovery_bail("AgentRun root identity changed before projection registration");
    }
    let existing: Option<String> = database
        .connection()
        .query_row(
            r#"
            SELECT root_identity
            FROM skill_projection_run_registration
            WHERE agent_run_id = ?1
            "#,
            [agent_run_id],
            |row| row.get(0),
        )
        .optional()?;
    if existing.as_deref().is_some_and(|value| value != identity) {
        return recovery_bail("AgentRun projection registration changed root identity");
    }
    database.connection().execute(
        r#"
        INSERT INTO skill_projection_run_registration(
            agent_run_id, execution_epoch, execution_root,
            root_identity, registered_at
        ) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(agent_run_id) DO UPDATE SET
            execution_epoch = excluded.execution_epoch,
            execution_root = excluded.execution_root,
            registered_at = excluded.registered_at
        "#,
        params![
            agent_run_id,
            execution_epoch,
            path_text(execution_root)?,
            identity,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn resume_journal(
    database: &mut Database,
    library: &SkillLibraryService,
    execution_root: &Path,
    journal_path: &Path,
    journal: &mut ProjectionJournal,
) -> Result<ResumeOutcome> {
    let validated = validate_journal(database, library, execution_root, journal_path, journal)?;
    loop {
        let direct = direct_observation(
            database,
            path_text(execution_root)?,
            validated.group_key,
            &journal.skill_id,
        )?;
        validate_observation_lineage(journal, direct.as_ref())?;

        if journal.state == JournalState::Completed {
            audit_committed_observation(journal, direct.as_ref())?;
            maybe_crash(CrashPoint::BeforeJournalDelete)?;
            fs::remove_file(journal_path)?;
            maybe_crash(CrashPoint::AfterJournalDelete)?;
            return Ok(ResumeOutcome::Completed);
        }

        let final_evidence = tree_evidence(
            library,
            &validated.entry_path,
            &validated.skill.name,
            journal,
        );
        let staging_evidence = tree_evidence(
            library,
            &validated.staging_path,
            &validated.skill.name,
            journal,
        );
        let backup_evidence = old_tree_evidence(
            library,
            &validated.backup_path,
            &validated.skill.name,
            journal,
        );

        match (final_evidence, staging_evidence, backup_evidence) {
            (TreeEvidence::Expected, TreeEvidence::Missing, backup) => {
                if backup == TreeEvidence::Foreign {
                    return recovery_bail("backup content does not match the journal");
                }
                advance(journal_path, journal, JournalState::NewPromoted)?;
                maybe_crash(CrashPoint::BeforeFinalVerification)?;
                verify_tree_identity(
                    library,
                    &validated.entry_path,
                    &validated.skill.name,
                    &journal.new_content_digest,
                    Some(&journal.new_entry_identity),
                )?;
                maybe_crash(CrashPoint::AfterFinalVerification)?;
                advance_with_crash(
                    journal_path,
                    journal,
                    JournalState::Verified,
                    CrashPoint::BeforeVerifiedState,
                    CrashPoint::AfterVerifiedState,
                )?;
                maybe_crash(CrashPoint::BeforeMetadataCommit)?;
                commit_observation(database, journal, &validated, execution_root)?;
                maybe_crash(CrashPoint::AfterMetadataCommit)?;
                advance_with_crash(
                    journal_path,
                    journal,
                    JournalState::MetadataCommitted,
                    CrashPoint::BeforeMetadataCommittedState,
                    CrashPoint::AfterMetadataCommittedState,
                )?;
                if backup == TreeEvidence::Expected {
                    maybe_crash(CrashPoint::BeforeBackupDelete)?;
                    remove_owned_tree(&validated.backup_path, &journal.operation_id)?;
                    maybe_crash(CrashPoint::AfterBackupDelete)?;
                }
                advance_with_crash(
                    journal_path,
                    journal,
                    JournalState::CleanupPending,
                    CrashPoint::BeforeCleanupPendingState,
                    CrashPoint::AfterCleanupPendingState,
                )?;
                advance_with_crash(
                    journal_path,
                    journal,
                    JournalState::Completed,
                    CrashPoint::BeforeCompletedState,
                    CrashPoint::AfterCompletedState,
                )?;
                let committed = direct_observation(
                    database,
                    path_text(execution_root)?,
                    validated.group_key,
                    &journal.skill_id,
                )?;
                audit_committed_observation(journal, committed.as_ref())?;
                maybe_crash(CrashPoint::BeforeJournalDelete)?;
                fs::remove_file(journal_path)?;
                maybe_crash(CrashPoint::AfterJournalDelete)?;
                return Ok(ResumeOutcome::Completed);
            }
            (TreeEvidence::Missing, TreeEvidence::Expected, TreeEvidence::Expected)
                if journal.old_revision_id.is_some() =>
            {
                if journal.state >= JournalState::NewPromoted {
                    return recovery_bail(
                        "journal claims promotion but only staging and backup remain",
                    );
                }
                advance(journal_path, journal, JournalState::OldMovedToBackup)?;
                maybe_crash(CrashPoint::BeforeNewRename)?;
                rename_sibling(
                    &validated.staging_path,
                    &validated.entry_path,
                    &journal.operation_id,
                )?;
                maybe_crash(CrashPoint::AfterNewRename)?;
                verify_tree_identity(
                    library,
                    &validated.entry_path,
                    &validated.skill.name,
                    &journal.new_content_digest,
                    Some(&journal.new_entry_identity),
                )?;
                advance_with_crash(
                    journal_path,
                    journal,
                    JournalState::NewPromoted,
                    CrashPoint::BeforeNewPromotedState,
                    CrashPoint::AfterNewPromotedState,
                )?;
            }
            (TreeEvidence::Missing, TreeEvidence::Expected, TreeEvidence::Missing)
                if journal.old_revision_id.is_none() =>
            {
                if journal.state >= JournalState::NewPromoted {
                    return recovery_bail("journal claims promotion but only staging remains");
                }
                maybe_crash(CrashPoint::BeforeNewRename)?;
                rename_sibling(
                    &validated.staging_path,
                    &validated.entry_path,
                    &journal.operation_id,
                )?;
                maybe_crash(CrashPoint::AfterNewRename)?;
                verify_tree_identity(
                    library,
                    &validated.entry_path,
                    &validated.skill.name,
                    &journal.new_content_digest,
                    Some(&journal.new_entry_identity),
                )?;
                advance_with_crash(
                    journal_path,
                    journal,
                    JournalState::NewPromoted,
                    CrashPoint::BeforeNewPromotedState,
                    CrashPoint::AfterNewPromotedState,
                )?;
            }
            (TreeEvidence::Foreign, TreeEvidence::Expected, TreeEvidence::Missing)
                if journal.old_revision_id.is_some()
                    && journal.state == JournalState::Prepared
                    && old_tree_matches_path(
                        library,
                        &validated.entry_path,
                        &validated.skill.name,
                        journal,
                    ) =>
            {
                maybe_crash(CrashPoint::BeforeOldRename)?;
                rename_sibling(
                    &validated.entry_path,
                    &validated.backup_path,
                    &journal.operation_id,
                )?;
                maybe_crash(CrashPoint::AfterOldRename)?;
                verify_old_tree(
                    library,
                    &validated.backup_path,
                    &validated.skill.name,
                    journal,
                )?;
                advance_with_crash(
                    journal_path,
                    journal,
                    JournalState::OldMovedToBackup,
                    CrashPoint::BeforeOldMovedState,
                    CrashPoint::AfterOldMovedState,
                )?;
            }
            (TreeEvidence::Foreign, TreeEvidence::Missing, TreeEvidence::Missing)
                if journal.old_revision_id.is_some()
                    && journal.state == JournalState::Prepared
                    && old_tree_matches_path(
                        library,
                        &validated.entry_path,
                        &validated.skill.name,
                        journal,
                    ) =>
            {
                // The new staging tree disappeared before the old tree moved.
                // Preserve the proven old final and abandon only this journal.
                fs::remove_file(journal_path)?;
                return Ok(ResumeOutcome::RestoredOld);
            }
            (TreeEvidence::Missing, TreeEvidence::Missing, TreeEvidence::Expected)
                if journal.old_revision_id.is_some()
                    && journal.state <= JournalState::OldMovedToBackup
                    && direct.as_ref().is_some_and(|value| {
                        value.operation_id.as_deref() != Some(&journal.operation_id)
                    }) =>
            {
                rename_sibling(
                    &validated.backup_path,
                    &validated.entry_path,
                    &journal.operation_id,
                )?;
                verify_old_tree(
                    library,
                    &validated.entry_path,
                    &validated.skill.name,
                    journal,
                )?;
                fs::remove_file(journal_path)?;
                return Ok(ResumeOutcome::RestoredOld);
            }
            _ => return recovery_bail("journal paths are ambiguous or externally changed"),
        }
    }
}

fn validate_journal(
    database: &Database,
    library: &SkillLibraryService,
    execution_root: &Path,
    journal_file: &Path,
    journal: &ProjectionJournal,
) -> Result<ValidatedJournal> {
    if journal.schema_version != JOURNAL_SCHEMA_VERSION {
        return recovery_bail("journal schema is unsupported");
    }
    let operation_id = Uuid::parse_str(&journal.operation_id)
        .context("Skill projection journal operation ID is invalid")?;
    if operation_id.to_string() != journal.operation_id {
        return recovery_bail("journal operation ID is not canonical");
    }
    let expected_journal_path = journal_path(library, &journal.operation_id)?;
    if journal_file != expected_journal_path {
        return recovery_bail("journal filename does not match its operation ID");
    }
    if journal.root_identity != root_identity(execution_root)? {
        return recovery_bail("journal root identity does not match the opened execution root");
    }
    validate_digest(&journal.new_content_digest)?;
    validate_file_identity(&journal.new_entry_identity)?;
    match (
        &journal.old_revision_id,
        &journal.old_content_digest,
        &journal.old_entry_identity,
    ) {
        (Some(revision_id), Some(digest), Some(identity)) => {
            Uuid::parse_str(revision_id).context("old Skill Revision ID is invalid")?;
            validate_digest(digest)?;
            validate_file_identity(identity)?;
        }
        (None, None, None) => {}
        _ => return recovery_bail("journal old Revision evidence is incomplete"),
    }
    Uuid::parse_str(&journal.skill_id).context("journal Skill ID is invalid")?;
    Uuid::parse_str(&journal.new_revision_id).context("new Skill Revision ID is invalid")?;

    let skill = library
        .get(database, &journal.skill_id)?
        .context("journal Skill no longer exists")?;
    let new_digest = revision_digest(database, &journal.skill_id, &journal.new_revision_id)?
        .context("journal new Skill Revision no longer exists")?;
    if new_digest != journal.new_content_digest {
        return recovery_bail("journal new Revision digest disagrees with the database");
    }
    if let (Some(old_revision_id), Some(old_digest)) = (
        journal.old_revision_id.as_deref(),
        journal.old_content_digest.as_deref(),
    ) && revision_digest(database, &journal.skill_id, old_revision_id)?.as_deref()
        != Some(old_digest)
    {
        return recovery_bail("journal old Revision digest disagrees with the database");
    }

    let entry_path = validate_absolute_path(&journal.entry_path)?;
    let staging_path = validate_absolute_path(&journal.staging_path)?;
    let backup_path = validate_absolute_path(&journal.backup_path)?;
    if !entry_path.starts_with(execution_root)
        || entry_path.parent() != staging_path.parent()
        || entry_path.parent() != backup_path.parent()
    {
        return recovery_bail("journal paths are not same-parent children of the execution root");
    }
    if entry_path.file_name().and_then(|value| value.to_str()) != Some(skill.name.as_str()) {
        return recovery_bail("journal entry name does not match the Skill name");
    }
    let expected_staging = format!(".rovai-skill-projection-{}.staging", journal.operation_id);
    let expected_backup = format!(".rovai-skill-projection-{}.backup", journal.operation_id);
    if staging_path.file_name().and_then(|value| value.to_str()) != Some(expected_staging.as_str())
        || backup_path.file_name().and_then(|value| value.to_str())
            != Some(expected_backup.as_str())
    {
        return recovery_bail("journal staging or backup name is invalid");
    }
    let group_key = group_for_entry(execution_root, &entry_path, &skill.name)
        .context("journal entry is outside every Skill delivery group")?;
    Ok(ValidatedJournal {
        entry_path,
        staging_path,
        backup_path,
        group_key,
        skill,
    })
}

fn validate_observation_lineage(
    journal: &ProjectionJournal,
    observation: Option<&DirectObservation>,
) -> Result<()> {
    if let Some(observation) = observation
        && observation.operation_id.as_deref() == Some(journal.operation_id.as_str())
    {
        if observation.revision_id != journal.new_revision_id
            || observation.entry_path != journal.entry_path
            || observation.state != "ready"
            || observation.entry_identity.as_deref() != Some(journal.new_entry_identity.as_str())
        {
            return recovery_bail("operationId is bound to a different DB observation");
        }
        return Ok(());
    }
    match (journal.old_revision_id.as_deref(), observation) {
        (None, None) => Ok(()),
        (Some(old_revision_id), Some(observation))
            if observation.revision_id == old_revision_id
                && observation.entry_path == journal.entry_path
                && observation.state != "shadowed"
                && observation.entry_identity.as_deref()
                    == journal.old_entry_identity.as_deref() =>
        {
            Ok(())
        }
        _ => recovery_bail("DB observation does not match journal lineage"),
    }
}

fn commit_observation(
    database: &mut Database,
    journal: &ProjectionJournal,
    validated: &ValidatedJournal,
    execution_root: &Path,
) -> Result<()> {
    let existing = operation_observation(database, &journal.operation_id)?;
    if let Some(existing) = existing {
        audit_committed_observation(journal, Some(&existing))?;
        return Ok(());
    }
    upsert_observation_for_operation(
        database,
        path_text(execution_root)?,
        validated.group_key,
        &validated.skill,
        &journal.new_revision_id,
        &validated.entry_path,
        "ready",
        None,
        &journal.operation_id,
        &journal.new_entry_identity,
    )?;
    let committed = operation_observation(database, &journal.operation_id)?;
    audit_committed_observation(journal, committed.as_ref())
}

fn audit_committed_observation(
    journal: &ProjectionJournal,
    observation: Option<&DirectObservation>,
) -> Result<()> {
    let Some(observation) = observation else {
        return recovery_bail("journal metadata commit has no durable DB observation");
    };
    if observation.operation_id.as_deref() != Some(journal.operation_id.as_str())
        || observation.revision_id != journal.new_revision_id
        || observation.entry_path != journal.entry_path
        || observation.state != "ready"
        || observation.entry_identity.as_deref() != Some(journal.new_entry_identity.as_str())
    {
        return recovery_bail("journal metadata commit does not match the durable DB observation");
    }
    Ok(())
}

fn advance(path: &Path, journal: &mut ProjectionJournal, state: JournalState) -> Result<()> {
    if state <= journal.state {
        return Ok(());
    }
    journal.state = state;
    atomic_write_private_json(path, journal)
}

fn advance_with_crash(
    path: &Path,
    journal: &mut ProjectionJournal,
    state: JournalState,
    before: CrashPoint,
    after: CrashPoint,
) -> Result<()> {
    maybe_crash(before)?;
    advance(path, journal, state)?;
    maybe_crash(after)
}

fn tree_evidence(
    library: &SkillLibraryService,
    path: &Path,
    name: &str,
    journal: &ProjectionJournal,
) -> TreeEvidence {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => TreeEvidence::Missing,
        Err(_) => TreeEvidence::Foreign,
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            TreeEvidence::Foreign
        }
        Ok(_) => match verify_tree_identity(
            library,
            path,
            name,
            &journal.new_content_digest,
            Some(&journal.new_entry_identity),
        ) {
            Ok(_) => TreeEvidence::Expected,
            Err(_) => TreeEvidence::Foreign,
        },
    }
}

fn old_tree_evidence(
    library: &SkillLibraryService,
    path: &Path,
    name: &str,
    journal: &ProjectionJournal,
) -> TreeEvidence {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => TreeEvidence::Missing,
        Err(_) => TreeEvidence::Foreign,
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            TreeEvidence::Foreign
        }
        Ok(_) => {
            if old_tree_matches_path(library, path, name, journal) {
                TreeEvidence::Expected
            } else {
                TreeEvidence::Foreign
            }
        }
    }
}

fn old_tree_matches_path(
    library: &SkillLibraryService,
    path: &Path,
    name: &str,
    journal: &ProjectionJournal,
) -> bool {
    journal
        .old_content_digest
        .as_deref()
        .zip(journal.old_entry_identity.as_deref())
        .is_some_and(|(digest, identity)| {
            verify_tree_identity(library, path, name, digest, Some(identity)).is_ok()
        })
}

fn verify_old_tree(
    library: &SkillLibraryService,
    path: &Path,
    name: &str,
    journal: &ProjectionJournal,
) -> Result<()> {
    let digest = journal
        .old_content_digest
        .as_deref()
        .context("journal has no old content digest")?;
    let identity = journal
        .old_entry_identity
        .as_deref()
        .context("journal has no old entry identity")?;
    verify_tree_identity(library, path, name, digest, Some(identity)).map(|_| ())
}

fn direct_observation(
    database: &Database,
    execution_root: &str,
    group_key: SkillDeliveryGroupKey,
    skill_id: &str,
) -> Result<Option<DirectObservation>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT revision_id, entry_path, state, operation_id, entry_identity
            FROM skill_projection_observation
            WHERE execution_root = ?1 AND group_key = ?2 AND skill_id = ?3
            "#,
            params![execution_root, group_key.as_str(), skill_id],
            |row| {
                Ok(DirectObservation {
                    revision_id: row.get(0)?,
                    entry_path: row.get(1)?,
                    state: row.get(2)?,
                    operation_id: row.get(3)?,
                    entry_identity: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn direct_observation_for_entry(
    database: &Database,
    entry_path: &Path,
) -> Result<Option<(String, DirectObservation)>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT skill_id, revision_id, entry_path, state, operation_id, entry_identity
            FROM skill_projection_observation
            WHERE entry_path = ?1 AND group_key = delivered_via_group_key
            "#,
            [path_text(entry_path)?],
            |row| {
                Ok((
                    row.get(0)?,
                    DirectObservation {
                        revision_id: row.get(1)?,
                        entry_path: row.get(2)?,
                        state: row.get(3)?,
                        operation_id: row.get(4)?,
                        entry_identity: row.get(5)?,
                    },
                ))
            },
        )
        .optional()
        .map_err(Into::into)
}

fn operation_observation(
    database: &Database,
    operation_id: &str,
) -> Result<Option<DirectObservation>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT revision_id, entry_path, state, operation_id, entry_identity
            FROM skill_projection_observation WHERE operation_id = ?1
            "#,
            [operation_id],
            |row| {
                Ok(DirectObservation {
                    revision_id: row.get(0)?,
                    entry_path: row.get(1)?,
                    state: row.get(2)?,
                    operation_id: row.get(3)?,
                    entry_identity: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn revision_digest(
    database: &Database,
    skill_id: &str,
    revision_id: &str,
) -> Result<Option<String>> {
    database
        .connection()
        .query_row(
            "SELECT content_digest FROM skill_revision WHERE skill_id = ?1 AND id = ?2",
            params![skill_id, revision_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

fn revision_identity(
    database: &Database,
    skill_id: &str,
    revision_id: &str,
) -> Result<Option<(String, String)>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT skill.name, revision.content_digest
            FROM skill_revision AS revision
            JOIN skill ON skill.id = revision.skill_id
            WHERE revision.skill_id = ?1 AND revision.id = ?2
            "#,
            params![skill_id, revision_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(Into::into)
}

fn group_for_entry(
    execution_root: &Path,
    entry_path: &Path,
    skill_name: &str,
) -> Option<SkillDeliveryGroupKey> {
    SkillDeliveryGroupKey::ALL
        .into_iter()
        .find(|group| execution_root.join(group.relative_path()).join(skill_name) == entry_path)
}

fn root_identity(root: &Path) -> Result<String> {
    let opened = windows_file_tree::open_path_without_following(root)
        .context("failed to open Windows Skill projection execution root")?;
    let metadata = windows_file_tree::inspect_node(&opened)
        .context("failed to inspect Windows Skill projection execution root")?;
    if metadata.kind != NodeKind::Directory {
        return recovery_bail("execution root is not a directory");
    }
    let file_id = metadata
        .fingerprint
        .file_id
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!(
        "{:016x}-{file_id}",
        metadata.fingerprint.volume_serial_number
    ))
}

fn verify_tree_identity(
    library: &SkillLibraryService,
    path: &Path,
    name: &str,
    expected_digest: &str,
    expected_identity: Option<&str>,
) -> Result<String> {
    if let Some(expected_identity) = expected_identity {
        validate_file_identity(expected_identity)?;
    }
    let before = root_identity(path)?;
    if expected_identity.is_some_and(|expected| expected != before) {
        return recovery_bail("Skill projection directory identity changed");
    }
    library.verify_projected_revision(path, name, expected_digest)?;
    let after = root_identity(path)?;
    if after != before {
        return recovery_bail("Skill projection directory changed while it was verified");
    }
    Ok(before)
}

fn ensure_directory_chain(root: &Path, directory: &Path) -> Result<()> {
    let relative = directory
        .strip_prefix(root)
        .context("Skill projection directory escaped its execution root")?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return recovery_bail("Skill projection directory is not normalized");
        };
        current.push(name);
        match fs::create_dir(&current) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        let opened = windows_file_tree::open_path_without_following(&current)?;
        if windows_file_tree::inspect_node(&opened)?.kind != NodeKind::Directory {
            return recovery_bail(
                "Skill projection parent contains a non-directory or reparse point",
            );
        }
    }
    Ok(())
}

fn rename_sibling(source: &Path, destination: &Path, operation_id: &str) -> Result<()> {
    if source.parent() != destination.parent() {
        return recovery_bail("Skill projection rename paths are not siblings");
    }
    require_absent(destination, "rename destination")?;
    retry_sharing(operation_id, || {
        windows_file_tree::commit_temporary(source, destination)
    })
}

fn remove_owned_tree(path: &Path, operation_id: &str) -> Result<()> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
        Ok(_) => {}
    }
    admit_private_directory(path)?;
    retry_sharing(operation_id, || remove_owned_tree_once(path))
}

fn remove_owned_tree_once(path: &Path) -> Result<()> {
    let opened = windows_file_tree::open_path_for_removal(path)?;
    remove_owned_node(opened)
}

fn remove_owned_node(opened: fs::File) -> Result<()> {
    let before = windows_file_tree::inspect_node(&opened)?;
    match before.kind {
        NodeKind::Directory => {
            let names = windows_file_tree::read_directory_names(&opened, 1_001)?;
            for name in names {
                let child = windows_file_tree::open_child_for_removal(&opened, &name)?;
                remove_owned_node(child)?;
            }
            let after = windows_file_tree::inspect_node(&opened)?;
            if after.kind != before.kind
                || after.fingerprint.volume_serial_number != before.fingerprint.volume_serial_number
                || after.fingerprint.file_id != before.fingerprint.file_id
            {
                return recovery_bail("Skill projection directory changed while it was removed");
            }
            windows_file_tree::delete_on_close(&opened)?;
        }
        NodeKind::RegularFile => {
            if windows_file_tree::inspect_node(&opened)? != before {
                return recovery_bail("Skill projection file changed while it was removed");
            }
            windows_file_tree::delete_on_close(&opened)?;
        }
    }
    Ok(())
}

fn retry_sharing<T>(operation_id: &str, mut operation: impl FnMut() -> Result<T>) -> Result<T> {
    const DELAYS_MS: [u64; 5] = [12, 28, 56, 104, 176];
    for (attempt, delay) in DELAYS_MS.into_iter().enumerate() {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error) if retryable_sharing_error(&error) => {
                let jitter = operation_id.as_bytes()[attempt % operation_id.len()] as u64 % 13;
                thread::sleep(Duration::from_millis(delay + jitter));
            }
            Err(error) => return Err(error),
        }
    }
    operation().context("Windows Skill projection sharing retry budget was exhausted")
}

fn retryable_sharing_error(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<io::Error>()
            .and_then(io::Error::raw_os_error)
            .is_some_and(|code| matches!(code, 5 | 32 | 33))
    })
}

fn journal_root(library: &SkillLibraryService) -> Result<PathBuf> {
    prepare_private_directory(&library.root().join(JOURNAL_DIRECTORY))
}

fn journal_path(library: &SkillLibraryService, operation_id: &str) -> Result<PathBuf> {
    Uuid::parse_str(operation_id).context("Skill projection operation ID is invalid")?;
    Ok(journal_root(library)?.join(format!("{operation_id}.json")))
}

fn temporary_operation_id(name: &std::ffi::OsStr) -> Option<&str> {
    let name = name.to_str()?;
    let rest = name.strip_prefix(".rovai-skill-projection-")?;
    let operation_id = rest
        .strip_suffix(".staging")
        .or_else(|| rest.strip_suffix(".backup"))?;
    let parsed = Uuid::parse_str(operation_id).ok()?;
    (parsed.to_string() == operation_id).then_some(operation_id)
}

fn validate_absolute_path(value: &str) -> Result<PathBuf> {
    let path = PathBuf::from(value);
    if value.is_empty()
        || !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return recovery_bail("journal contains an invalid absolute path");
    }
    Ok(path)
}

fn validate_digest(value: &str) -> Result<()> {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return recovery_bail("journal digest has an unsupported algorithm");
    };
    if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return recovery_bail("journal digest is malformed");
    }
    Ok(())
}

fn validate_file_identity(value: &str) -> Result<()> {
    let Some((volume, file_id)) = value.split_once('-') else {
        return recovery_bail("journal file identity is malformed");
    };
    let canonical_hex = |byte: u8| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte);
    if volume.len() != 16
        || file_id.len() != 32
        || !volume.bytes().all(canonical_hex)
        || !file_id.bytes().all(canonical_hex)
    {
        return recovery_bail("journal file identity is malformed");
    }
    Ok(())
}

fn require_absent(path: &Path, label: &str) -> Result<()> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
        Ok(_) => anyhow::bail!(
            "{RECOVERY_REQUIRED}: Windows Skill projection {label} already exists: {}",
            path.display()
        ),
    }
}

fn path_text(path: &Path) -> Result<&str> {
    path.to_str()
        .context("Windows Skill projection paths must be lossless Unicode")
}

#[cfg(test)]
fn set_crash_point(point: CrashPoint) {
    INJECTED_CRASH_POINT.with(|current| current.set(Some(point)));
}

#[cfg(test)]
fn maybe_crash(point: CrashPoint) -> Result<()> {
    let injected = INJECTED_CRASH_POINT.with(|current| {
        if current.get() == Some(point) {
            current.set(None);
            true
        } else {
            false
        }
    });
    if injected {
        anyhow::bail!("injected Windows Skill projection crash at {point:?}");
    }
    Ok(())
}

#[cfg(not(test))]
fn maybe_crash(_point: CrashPoint) -> Result<()> {
    Ok(())
}

fn recovery_bail<T>(detail: &str) -> Result<T> {
    anyhow::bail!("{RECOVERY_REQUIRED}: {detail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn journal_schema_is_closed_and_uses_all_durable_states() {
        let states = [
            JournalState::Prepared,
            JournalState::OldMovedToBackup,
            JournalState::NewPromoted,
            JournalState::Verified,
            JournalState::MetadataCommitted,
            JournalState::CleanupPending,
            JournalState::Completed,
        ];
        let encoded = states
            .into_iter()
            .map(|state| serde_json::to_value(state).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            encoded,
            vec![
                "prepared",
                "old_moved_to_backup",
                "new_promoted",
                "verified",
                "metadata_committed",
                "cleanup_pending",
                "completed",
            ]
        );
    }

    mod integration {
        use super::*;
        use crate::{
            agent_profile::AdapterKind,
            command::{ActorRef, CommandEnvelope},
            skill::{
                CommitSkillImportCommand, SetSkillEnabledCommand, SetSkillGroupAssignmentsCommand,
            },
            skill_projection::SkillProjectionReconciler,
        };

        struct TestPaths {
            root: PathBuf,
            data: PathBuf,
            library: PathBuf,
            source: PathBuf,
        }

        impl TestPaths {
            fn new(prefix: &str) -> Self {
                let token = Uuid::new_v4();
                let root = std::env::temp_dir().join(format!("{prefix}-root-{token}"));
                let data = std::env::temp_dir().join(format!("{prefix}-data-{token}"));
                let library = std::env::temp_dir().join(format!("{prefix}-library-{token}"));
                let source = std::env::temp_dir().join(format!("{prefix}-source-{token}"));
                fs::create_dir_all(&root).unwrap();
                fs::create_dir_all(&source).unwrap();
                Self {
                    root,
                    data,
                    library,
                    source,
                }
            }
        }

        impl Drop for TestPaths {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.root);
                let _ = fs::remove_dir_all(&self.data);
                let _ = fs::remove_dir_all(&self.library);
                let _ = fs::remove_dir_all(&self.source);
            }
        }

        fn user_envelope<P>(payload: P) -> CommandEnvelope<P> {
            CommandEnvelope {
                command_id: Uuid::new_v4().to_string(),
                actor: ActorRef::User {
                    user_id: "windows-projection-test-user".to_string(),
                },
                camp_id: None,
                expected_versions: Vec::new(),
                execution_epoch: None,
                payload,
            }
        }

        fn write_source(source: &Path, name: &str, body: &str) {
            let skill_root = source.join(name);
            fs::create_dir_all(&skill_root).unwrap();
            fs::write(
                skill_root.join("SKILL.md"),
                format!(
                    "---\nname: {name}\ndescription: Windows projection fixture\n---\n\n{body}\n"
                ),
            )
            .unwrap();
        }

        fn import_skill(
            database: &mut Database,
            library: &SkillLibraryService,
            source: &Path,
            name: &str,
            expected: Option<&SkillView>,
        ) -> SkillView {
            let inspection = library.inspect_import(database, source).unwrap();
            let candidate = inspection
                .candidates
                .into_iter()
                .find(|candidate| candidate.name == name)
                .unwrap();
            library
                .commit_import(
                    database,
                    &user_envelope(CommitSkillImportCommand {
                        staging_token: inspection.staging_token,
                        candidate_name: candidate.name,
                        expected_digest: candidate.content_digest,
                        expected_skill_version: expected.map(|skill| skill.version),
                        confirm_update: expected.is_some(),
                    }),
                )
                .unwrap();
            let skill = library
                .list(database)
                .unwrap()
                .into_iter()
                .find(|skill| skill.name == name)
                .unwrap();
            if expected.is_none() {
                library
                    .set_group_assignments(
                        database,
                        &user_envelope(SetSkillGroupAssignmentsCommand {
                            skill_id: skill.id.clone(),
                            expected_version: skill.version,
                            group_keys: vec![SkillDeliveryGroupKey::Codex],
                        }),
                    )
                    .unwrap();
                return library.get(database, &skill.id).unwrap().unwrap();
            }
            skill
        }

        fn operation_id(database: &Database, root: &Path, skill_id: &str) -> String {
            database
                .connection()
                .query_row(
                    r#"
                    SELECT operation_id
                    FROM skill_projection_observation
                    WHERE execution_root = ?1 AND group_key = 'codex' AND skill_id = ?2
                    "#,
                    params![path_text(root).unwrap(), skill_id],
                    |row| row.get(0),
                )
                .unwrap()
        }

        fn observed_entry_identity(database: &Database, root: &Path, skill_id: &str) -> String {
            database
                .connection()
                .query_row(
                    r#"
                    SELECT entry_identity
                    FROM skill_projection_observation
                    WHERE execution_root = ?1 AND group_key = 'codex' AND skill_id = ?2
                    "#,
                    params![path_text(root).unwrap(), skill_id],
                    |row| row.get(0),
                )
                .unwrap()
        }

        fn assert_no_operation_artifacts(library: &SkillLibraryService, root: &Path) {
            assert_eq!(
                fs::read_dir(journal_root(library).unwrap())
                    .unwrap()
                    .count(),
                0
            );
            let native_root = root.join(SkillDeliveryGroupKey::Codex.relative_path());
            if native_root.is_dir() {
                for entry in fs::read_dir(native_root).unwrap() {
                    assert!(temporary_operation_id(&entry.unwrap().file_name()).is_none());
                }
            }
        }

        fn insert_active_run(database: &Database, execution_root: &Path) {
            let now = chrono::Utc::now().to_rfc3339();
            database
                .connection()
                .execute(
                    r#"
                    INSERT INTO camp(
                        id, title, project_binding_kind, project_path,
                        last_message_sequence, version, created_at, updated_at
                    ) VALUES (
                        'windows-projection-camp', 'Projection', 'directory', ?1,
                        0, 1, ?2, ?2
                    )
                    "#,
                    params![path_text(execution_root).unwrap(), now],
                )
                .unwrap();
            database
                .connection()
                .execute(
                    r#"
                    INSERT INTO conversation(
                        id, camp_id, agent_id, created_at, updated_at
                    ) VALUES (
                        'windows-projection-conversation', 'windows-projection-camp',
                        'agent_1', ?1, ?1
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
                        'windows-projection-turn', 'windows-projection-camp',
                        'system_event', 'windows-projection-trigger', 'running', ?1, ?1
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
                        'windows-projection-run', 'windows-projection-turn',
                        'windows-projection-conversation', 0, 0,
                        'windows-projection-trigger-message', 'windows-projection-test',
                        'initial', 'test', 'required',
                        '{"runtimeAdapter":"codex-cli"}', ?1, 'running',
                        'windows-projection-run', 'codex-cli', 1, ?2, ?2, ?2
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

        fn run_crash_recovery_case(point: CrashPoint, expect_ambiguous_orphan: bool) {
            let paths = TestPaths::new(&format!("rovai-windows-projection-crash-{point:?}"));
            let mut database = crate::test_support::fresh_schema_database_fast_at(&paths.data);
            let library = SkillLibraryService::new(paths.library.clone()).unwrap();
            let name = "windows-projection-crash";
            write_source(&paths.source, name, "revision one");
            let first = import_skill(&mut database, &library, &paths.source, name, None);
            SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap();
            write_source(&paths.source, name, "revision two");
            let second = import_skill(&mut database, &library, &paths.source, name, Some(&first));

            set_crash_point(point);
            let injected = SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap_err();
            assert!(
                format!("{injected:#}").contains("injected Windows Skill projection crash"),
                "unexpected failure at {point:?}: {injected:#}"
            );

            let entry = paths.root.join(".codex/skills").join(name);
            if expect_ambiguous_orphan {
                let recovery = SkillProjectionReconciler
                    .reconcile_root(
                        &mut database,
                        &library,
                        &paths.root,
                        &[SkillDeliveryGroupKey::Codex],
                    )
                    .unwrap_err();
                assert!(
                    format!("{recovery:#}").contains(RECOVERY_REQUIRED),
                    "orphan at {point:?} did not close admission: {recovery:#}"
                );
                library
                    .verify_projected_revision(&entry, name, &first.current_revision.content_digest)
                    .unwrap();
                return;
            }

            SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap_or_else(|error| panic!("recovery failed at {point:?}: {error:#}"));
            library
                .verify_projected_revision(&entry, name, &second.current_revision.content_digest)
                .unwrap();
            assert_no_operation_artifacts(&library, &paths.root);
        }

        #[test]
        fn windows_skill_projection_crash_windows_recover_or_close_admission() {
            let cases = [
                (CrashPoint::BeforeStagingCopy, false),
                (CrashPoint::AfterStagingCopy, true),
                (CrashPoint::BeforePreparedJournal, true),
                (CrashPoint::AfterPreparedJournal, false),
                (CrashPoint::BeforeOldRename, false),
                (CrashPoint::AfterOldRename, false),
                (CrashPoint::BeforeOldMovedState, false),
                (CrashPoint::AfterOldMovedState, false),
                (CrashPoint::BeforeNewRename, false),
                (CrashPoint::AfterNewRename, false),
                (CrashPoint::BeforeNewPromotedState, false),
                (CrashPoint::AfterNewPromotedState, false),
                (CrashPoint::BeforeFinalVerification, false),
                (CrashPoint::AfterFinalVerification, false),
                (CrashPoint::BeforeVerifiedState, false),
                (CrashPoint::AfterVerifiedState, false),
                (CrashPoint::BeforeMetadataCommit, false),
                (CrashPoint::AfterMetadataCommit, false),
                (CrashPoint::BeforeMetadataCommittedState, false),
                (CrashPoint::AfterMetadataCommittedState, false),
                (CrashPoint::BeforeBackupDelete, false),
                (CrashPoint::AfterBackupDelete, false),
                (CrashPoint::BeforeCleanupPendingState, false),
                (CrashPoint::AfterCleanupPendingState, false),
                (CrashPoint::BeforeCompletedState, false),
                (CrashPoint::AfterCompletedState, false),
                (CrashPoint::BeforeJournalDelete, false),
                (CrashPoint::AfterJournalDelete, false),
            ];
            for (point, expect_ambiguous_orphan) in cases {
                run_crash_recovery_case(point, expect_ambiguous_orphan);
            }
        }

        #[test]
        fn windows_skill_projection_ambiguous_recovery_preserves_every_path() {
            let paths = TestPaths::new("rovai-windows-projection-ambiguous");
            let mut database = crate::test_support::fresh_schema_database_fast_at(&paths.data);
            let library = SkillLibraryService::new(paths.library.clone()).unwrap();
            let name = "windows-projection-ambiguous";
            write_source(&paths.source, name, "revision one");
            let first = import_skill(&mut database, &library, &paths.source, name, None);
            SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap();
            write_source(&paths.source, name, "revision two");
            let second = import_skill(&mut database, &library, &paths.source, name, Some(&first));
            set_crash_point(CrashPoint::AfterOldMovedState);
            SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap_err();

            let journal_file = fs::read_dir(journal_root(&library).unwrap())
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .path();
            let journal: ProjectionJournal =
                read_private_json(&journal_file, JOURNAL_MAX_BYTES).unwrap();
            let staging = PathBuf::from(&journal.staging_path);
            let backup = PathBuf::from(&journal.backup_path);
            fs::write(staging.join("SKILL.md"), "externally changed staging").unwrap();

            let recovery = SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap_err();
            assert!(format!("{recovery:#}").contains(RECOVERY_REQUIRED));
            assert!(journal_file.is_file());
            assert!(staging.is_dir());
            assert!(backup.is_dir());
            assert!(!paths.root.join(".codex/skills").join(name).exists());
            library
                .verify_projected_revision(&backup, name, &first.current_revision.content_digest)
                .unwrap();
            assert!(
                library
                    .verify_projected_revision(
                        &staging,
                        name,
                        &second.current_revision.content_digest,
                    )
                    .is_err()
            );
        }

        #[test]
        fn windows_skill_projection_publishes_replaces_and_removes_owned_copy() {
            let paths = TestPaths::new("rovai-windows-projection-lifecycle");
            let mut database = crate::test_support::fresh_schema_database_fast_at(&paths.data);
            let library = SkillLibraryService::new(paths.library.clone()).unwrap();
            let name = "windows-projection-fixture";
            write_source(&paths.source, name, "revision one");
            let first = import_skill(&mut database, &library, &paths.source, name, None);

            let first_report = SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap();
            assert_eq!(first_report.observations.len(), 1);
            assert_eq!(first_report.observations[0].state, "ready");
            assert!(!first_report.observations[0].duplicate_visible);
            let entry = paths.root.join(".codex/skills").join(name);
            let metadata = fs::symlink_metadata(&entry).unwrap();
            assert!(metadata.is_dir());
            assert!(!metadata.file_type().is_symlink());
            library
                .verify_projected_revision(&entry, name, &first.current_revision.content_digest)
                .unwrap();
            let first_operation = operation_id(&database, &paths.root, &first.id);
            Uuid::parse_str(&first_operation).unwrap();
            let first_entry_identity = observed_entry_identity(&database, &paths.root, &first.id);
            assert_eq!(first_entry_identity, root_identity(&entry).unwrap());
            assert_no_operation_artifacts(&library, &paths.root);

            write_source(&paths.source, name, "revision two");
            let second = import_skill(&mut database, &library, &paths.source, name, Some(&first));
            SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap();
            library
                .verify_projected_revision(&entry, name, &second.current_revision.content_digest)
                .unwrap();
            assert!(
                fs::read_to_string(entry.join("SKILL.md"))
                    .unwrap()
                    .contains("revision two")
            );
            let second_operation = operation_id(&database, &paths.root, &second.id);
            assert_ne!(second_operation, first_operation);
            let second_entry_identity = observed_entry_identity(&database, &paths.root, &second.id);
            assert_eq!(second_entry_identity, root_identity(&entry).unwrap());
            assert_ne!(second_entry_identity, first_entry_identity);
            assert_no_operation_artifacts(&library, &paths.root);

            library
                .set_enabled(
                    &mut database,
                    &user_envelope(SetSkillEnabledCommand {
                        skill_id: second.id.clone(),
                        expected_version: second.version,
                        enabled: false,
                    }),
                )
                .unwrap();
            SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap();
            assert!(!entry.exists());
            assert!(
                super::direct_observation(
                    &database,
                    path_text(&paths.root).unwrap(),
                    SkillDeliveryGroupKey::Codex,
                    &second.id,
                )
                .unwrap()
                .is_none()
            );
        }

        #[test]
        fn windows_skill_projection_preserves_git_exclude_and_hides_managed_copy() {
            let paths = TestPaths::new("rovai-windows-projection-git");
            let initialized = std::process::Command::new("git")
                .args(["init", "-b", "main"])
                .current_dir(&paths.root)
                .output()
                .unwrap();
            assert!(
                initialized.status.success(),
                "git init failed: {}",
                String::from_utf8_lossy(&initialized.stderr)
            );
            let exclude = paths.root.join(".git/info/exclude");
            fs::write(&exclude, "# user rule\n/local-only\n").unwrap();
            let mut database = crate::test_support::fresh_schema_database_fast_at(&paths.data);
            let library = SkillLibraryService::new(paths.library.clone()).unwrap();
            let name = "windows-projection-git";
            write_source(&paths.source, name, "managed Git bytes");
            import_skill(&mut database, &library, &paths.source, name, None);

            SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap();
            let content = fs::read_to_string(exclude).unwrap();
            assert!(content.contains("# user rule\n/local-only"));
            assert!(content.contains("/.codex/skills/windows-projection-git"));
            let status = std::process::Command::new("git")
                .args(["status", "--porcelain", "--untracked-files=all"])
                .current_dir(&paths.root)
                .output()
                .unwrap();
            assert!(status.status.success());
            assert_eq!(String::from_utf8(status.stdout).unwrap(), "");
        }

        #[test]
        fn windows_skill_projection_preserves_externally_changed_copy() {
            let paths = TestPaths::new("rovai-windows-projection-drift");
            let mut database = crate::test_support::fresh_schema_database_fast_at(&paths.data);
            let library = SkillLibraryService::new(paths.library.clone()).unwrap();
            let name = "windows-projection-drift";
            write_source(&paths.source, name, "managed bytes");
            let skill = import_skill(&mut database, &library, &paths.source, name, None);
            SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap();
            let entry = paths.root.join(".codex/skills").join(name);
            fs::write(entry.join("SKILL.md"), "externally changed").unwrap();

            let report = SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap();
            let observation = report
                .observations
                .iter()
                .find(|observation| observation.skill_id == skill.id)
                .unwrap();
            assert_eq!(observation.state, "shadowed");
            assert_eq!(
                observation.last_error_code.as_deref(),
                Some("managed_target_corrupted")
            );
            assert_eq!(
                fs::read_to_string(entry.join("SKILL.md")).unwrap(),
                "externally changed"
            );
        }

        #[test]
        fn windows_skill_projection_rejects_same_content_with_a_new_file_identity() {
            let paths = TestPaths::new("rovai-windows-projection-identity-drift");
            let mut database = crate::test_support::fresh_schema_database_fast_at(&paths.data);
            let library = SkillLibraryService::new(paths.library.clone()).unwrap();
            let name = "windows-projection-identity-drift";
            write_source(&paths.source, name, "managed bytes");
            let skill = import_skill(&mut database, &library, &paths.source, name, None);
            SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap();
            let entry = paths.root.join(".codex/skills").join(name);
            let owned_identity = observed_entry_identity(&database, &paths.root, &skill.id);

            fs::remove_dir_all(&entry).unwrap();
            library
                .copy_revision_to_projection_staging(&skill.current_revision, &entry)
                .unwrap();
            let replacement_identity = root_identity(&entry).unwrap();
            assert_ne!(replacement_identity, owned_identity);
            library
                .verify_projected_revision(&entry, name, &skill.current_revision.content_digest)
                .unwrap();

            let report = SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap();
            let observation = report
                .observations
                .iter()
                .find(|observation| observation.skill_id == skill.id)
                .unwrap();
            assert_eq!(observation.state, "shadowed");
            assert_eq!(
                observation.last_error_code.as_deref(),
                Some("managed_target_corrupted")
            );
            assert_eq!(root_identity(&entry).unwrap(), replacement_identity);
        }

        #[test]
        fn windows_skill_projection_defers_update_until_active_run_is_terminal() {
            let paths = TestPaths::new("rovai-windows-projection-gate");
            let mut database = crate::test_support::fresh_schema_database_fast_at(&paths.data);
            let library = SkillLibraryService::new(paths.library.clone()).unwrap();
            let name = "windows-projection-gate";
            write_source(&paths.source, name, "revision one");
            let first = import_skill(&mut database, &library, &paths.source, name, None);
            insert_active_run(&database, &paths.root);
            let prepared = SkillProjectionReconciler
                .prepare_run_exposure(
                    &mut database,
                    &library,
                    "windows-projection-run",
                    &paths.root,
                    AdapterKind::CodexCli,
                )
                .unwrap();
            assert_eq!(prepared.snapshot.skills.len(), 1);
            assert_eq!(prepared.snapshot.skills[0].status, "ready");
            assert!(has_active_run_registration(&database, &paths.root, None).unwrap());
            let registered_epoch: i64 = database
                .connection()
                .query_row(
                    r#"
                    SELECT execution_epoch
                    FROM skill_projection_run_registration
                    WHERE agent_run_id = 'windows-projection-run'
                    "#,
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(registered_epoch, 1);
            write_source(&paths.source, name, "revision two");
            let second = import_skill(&mut database, &library, &paths.source, name, Some(&first));
            SkillProjectionReconciler
                .mark_observed_roots_dirty(&mut database, false)
                .unwrap();

            let report = SkillProjectionReconciler
                .reconcile_root(
                    &mut database,
                    &library,
                    &paths.root,
                    &[SkillDeliveryGroupKey::Codex],
                )
                .unwrap();
            let observation = report
                .observations
                .iter()
                .find(|observation| observation.skill_id == second.id)
                .unwrap();
            assert_eq!(observation.state, "stale");
            assert_eq!(observation.revision_id, first.current_revision.id);
            assert_eq!(
                observation.last_error_code.as_deref(),
                Some("projection_update_waiting_for_active_run")
            );
            let entry = paths.root.join(".codex/skills").join(name);
            assert!(
                fs::read_to_string(entry.join("SKILL.md"))
                    .unwrap()
                    .contains("revision one")
            );
            let dirty: i64 = database
                .connection()
                .query_row(
                    "SELECT dirty FROM skill_projection_root_state WHERE execution_root = ?1",
                    [path_text(&paths.root).unwrap()],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(dirty, 1);

            let now = chrono::Utc::now().to_rfc3339();
            database
                .connection()
                .execute(
                    r#"
                    UPDATE agent_run
                    SET status = 'succeeded', ended_at = ?1, updated_at = ?1
                    WHERE id = 'windows-projection-run'
                    "#,
                    [&now],
                )
                .unwrap();
            SkillProjectionReconciler
                .reconcile_after_run_terminal(&mut database, &library, &paths.root)
                .unwrap();
            assert!(!has_active_run_registration(&database, &paths.root, None).unwrap());
            library
                .verify_projected_revision(&entry, name, &second.current_revision.content_digest)
                .unwrap();
            assert!(
                fs::read_to_string(entry.join("SKILL.md"))
                    .unwrap()
                    .contains("revision two")
            );
        }
    }
}
