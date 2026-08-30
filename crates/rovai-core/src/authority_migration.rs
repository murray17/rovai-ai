use std::{
    fs::File,
    io::{self, Read},
    path::{Component, Path, PathBuf},
    thread,
    time::Duration,
};

use rusqlite::{Connection, OpenFlags, backup::StepResult};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    core_data_dir_lock::CoreDataDirLease,
    database_admission::{
        AUTHORITY_MIGRATION_MANIFEST_FILE, AdmissionAssessment, AuthorityArtifactIdentityToken,
        AuthorityArtifactKind, AuthorityBlock, AuthorityNamespace, DatabaseAdmission,
        MigrationAuthorityOpen, MigrationAuthorityTicket, TicketValidationError,
        observe_authority_identity_token,
    },
    db::{Database, DatabaseMigrationError, DatabaseOpenError},
    platform::private_storage::{
        atomic_write_private_json, create_private_new_file, prepare_private_directory,
        publish_private_temporary_file,
    },
};

const MIGRATION_BACKUP_ROOT: &str = ".rovai-authority-migration-backups";
const MANIFEST_MAX_BYTES: u64 = 128 * 1024;
const BACKUP_PAGES_PER_STEP: i32 = 256;
const BACKUP_BUSY_RETRY_LIMIT: usize = 200;
const BACKUP_BUSY_PAUSE: Duration = Duration::from_millis(25);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorityMigrationPhase {
    RecoveringInterruptedSwitch,
    CreatingSnapshot,
    MigratingCopy,
    ValidatingCopy,
    PreservingOriginal,
    SwitchingAuthority,
    Reassessing,
    Completed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityMigrationProgress {
    pub phase: AuthorityMigrationPhase,
    pub copied_pages: Option<i32>,
    pub total_pages: Option<i32>,
}

pub struct AuthorityMigrationRunner;

impl AuthorityMigrationRunner {
    pub fn run(
        ticket: MigrationAuthorityTicket<'_>,
        runtime_camp_files_root: &Path,
        runtime_camp_files_root_identity_digest: &str,
    ) -> Result<Database, DatabaseMigrationError> {
        Self::run_with_progress(
            ticket,
            runtime_camp_files_root,
            runtime_camp_files_root_identity_digest,
            |_| {},
        )
    }

    pub fn run_with_progress(
        ticket: MigrationAuthorityTicket<'_>,
        runtime_camp_files_root: &Path,
        runtime_camp_files_root_identity_digest: &str,
        mut progress: impl FnMut(AuthorityMigrationProgress),
    ) -> Result<Database, DatabaseMigrationError> {
        run_with_progress_inner(
            ticket,
            runtime_camp_files_root,
            runtime_camp_files_root_identity_digest,
            &mut progress,
        )
    }
}

fn run_with_progress_inner(
    ticket: MigrationAuthorityTicket<'_>,
    runtime_camp_files_root: &Path,
    runtime_camp_files_root_identity_digest: &str,
    progress: &mut dyn FnMut(AuthorityMigrationProgress),
) -> Result<Database, DatabaseMigrationError> {
    let open = ticket
        .into_migration()
        .map_err(DatabaseMigrationError::from_ticket)?;
    match open {
        MigrationAuthorityOpen::Interrupted { lease, manifest } => {
            progress(phase(AuthorityMigrationPhase::RecoveringInterruptedSwitch));
            recover_interrupted_switch(lease, &manifest)?;
            progress(phase(AuthorityMigrationPhase::Reassessing));
            continue_after_reassessment(
                lease,
                runtime_camp_files_root,
                runtime_camp_files_root_identity_digest,
                progress,
            )
        }
        open @ MigrationAuthorityOpen::Upgrade { .. } => migrate_upgrade(
            open,
            runtime_camp_files_root,
            runtime_camp_files_root_identity_digest,
            progress,
        ),
    }
}

fn continue_after_reassessment(
    lease: &CoreDataDirLease,
    runtime_camp_files_root: &Path,
    runtime_camp_files_root_identity_digest: &str,
    progress: &mut dyn FnMut(AuthorityMigrationProgress),
) -> Result<Database, DatabaseMigrationError> {
    match DatabaseAdmission::assess(lease).map_err(DatabaseMigrationError::from_admission)? {
        AdmissionAssessment::AdmittedExisting(ticket) => {
            let database = Database::open_admitted_with_runtime_camp_files_root(
                *ticket,
                runtime_camp_files_root,
                runtime_camp_files_root_identity_digest,
            )
            .map_err(DatabaseMigrationError::from_open)?;
            Ok(database)
        }
        AdmissionAssessment::RequiresMigration(ticket) => run_with_progress_inner(
            *ticket,
            runtime_camp_files_root,
            runtime_camp_files_root_identity_digest,
            progress,
        ),
        AdmissionAssessment::Initializable(_) => Err(DatabaseMigrationError::operation(
            "authority_migration_reassessment_lost_authority",
            "migration recovery unexpectedly found no authority database",
            false,
        )),
        AdmissionAssessment::Blocked(block) => Err(DatabaseMigrationError::blocked(
            *block,
            "migration reassessment was blocked",
        )),
    }
}

fn migrate_upgrade(
    open: MigrationAuthorityOpen<'_>,
    runtime_camp_files_root: &Path,
    runtime_camp_files_root_identity_digest: &str,
    progress: &mut dyn FnMut(AuthorityMigrationProgress),
) -> Result<Database, DatabaseMigrationError> {
    let MigrationAuthorityOpen::Upgrade {
        lease,
        path: source,
        namespace,
        source_contract,
        ..
    } = &open
    else {
        unreachable!("upgrade path is selected by the caller")
    };
    debug_assert!(!source_contract.contract_version.is_empty());
    open.revalidate()
        .map_err(DatabaseMigrationError::from_ticket)?;
    let operation_id = Uuid::new_v4();
    let staging_file_name = format!(".rovai-authority-migration-{operation_id}.sqlite");
    let staging = lease.data_dir().join(&staging_file_name);
    drop(create_private_new_file(&staging).map_err(|error| {
        DatabaseMigrationError::io(
            "authority_migration_staging_create_failed",
            "create migration staging database",
            &staging,
            io::Error::other(error.to_string()),
        )
    })?);

    let migration_result = (|| {
        progress(phase(AuthorityMigrationPhase::CreatingSnapshot));
        backup_authority(source, &staging, progress)?;
        open.revalidate()
            .map_err(DatabaseMigrationError::from_ticket)?;

        progress(phase(AuthorityMigrationPhase::MigratingCopy));
        Database::migrate_staged_authority_copy(
            &staging,
            runtime_camp_files_root,
            runtime_camp_files_root_identity_digest,
        )
        .map_err(DatabaseMigrationError::from_open)?;
        progress(phase(AuthorityMigrationPhase::ValidatingCopy));
        let migrated_identity = observe_authority_identity_token(&staging).map_err(|error| {
            DatabaseMigrationError::io(
                "authority_migration_staging_identity_failed",
                "observe validated migration staging database",
                &staging,
                error,
            )
        })?;
        open.revalidate()
            .map_err(DatabaseMigrationError::from_ticket)?;

        progress(phase(AuthorityMigrationPhase::PreservingOriginal));
        let backup_directory = prepare_backup_directory(lease, operation_id)?;
        let artifacts = observe_source_artifacts(source, *namespace)?;
        let source_main_identity = artifacts
            .iter()
            .find(|artifact| artifact.kind == AuthorityArtifactKind::Main)
            .map(|artifact| artifact.identity.clone())
            .ok_or_else(|| {
                DatabaseMigrationError::operation(
                    "authority_migration_source_main_missing",
                    "migration source main database disappeared",
                    false,
                )
            })?;
        let mut manifest_artifacts = Vec::with_capacity(artifacts.len());
        for artifact in artifacts {
            let backup_file_name = format!("original-{}", artifact_kind_name(artifact.kind));
            let backup_path = backup_directory.join(&backup_file_name);
            copy_private_file(&artifact.path, &backup_path)?;
            let backup_identity =
                observe_authority_identity_token(&backup_path).map_err(|error| {
                    DatabaseMigrationError::io(
                        "authority_migration_backup_identity_failed",
                        "observe preserved authority artifact",
                        &backup_path,
                        error,
                    )
                })?;
            manifest_artifacts.push(MigrationManifestArtifact {
                kind: artifact.kind,
                source_file_name: leaf_name(&artifact.path)?,
                backup_file_name,
                detached_file_name: if artifact.kind == AuthorityArtifactKind::Main {
                    None
                } else {
                    Some(format!("detached-{}", artifact_kind_name(artifact.kind)))
                },
                source_identity: artifact.identity,
                backup_identity,
            });
        }
        open.revalidate()
            .map_err(DatabaseMigrationError::from_ticket)?;

        let manifest_path = lease.data_dir().join(AUTHORITY_MIGRATION_MANIFEST_FILE);
        let mut manifest = AuthorityMigrationManifest {
            schema_version: 1,
            operation_id,
            namespace: *namespace,
            source_file_name: leaf_name(source)?,
            staging_file_name,
            backup_operation_id: operation_id,
            source_main_identity,
            migrated_main_identity: migrated_identity,
            artifacts: manifest_artifacts,
            stage: MigrationSwitchStage::Prepared,
        };
        atomic_write_private_json(&manifest_path, &manifest).map_err(|error| {
            DatabaseMigrationError::io(
                "authority_migration_manifest_write_failed",
                "write authority migration manifest",
                &manifest_path,
                io::Error::other(error.to_string()),
            )
        })?;

        if let Err(error) = detach_source_sidecars(lease, &backup_directory, &manifest) {
            let _ = restore_original_sidecars(lease, &backup_directory, &manifest);
            return Err(error);
        }
        manifest.stage = MigrationSwitchStage::SidecarsDetached;
        atomic_write_private_json(&manifest_path, &manifest).map_err(|error| {
            let _ = restore_original_sidecars(lease, &backup_directory, &manifest);
            DatabaseMigrationError::io(
                "authority_migration_manifest_write_failed",
                "record detached authority sidecars",
                &manifest_path,
                io::Error::other(error.to_string()),
            )
        })?;

        progress(phase(AuthorityMigrationPhase::SwitchingAuthority));
        if let Err(error) = publish_private_temporary_file(&staging, source) {
            let restore = restore_original_sidecars(lease, &backup_directory, &manifest);
            return Err(match restore {
                Ok(()) => DatabaseMigrationError::io(
                    "authority_migration_publish_failed",
                    "publish migrated authority database",
                    source,
                    io::Error::other(error.to_string()),
                ),
                Err(restore_error) => DatabaseMigrationError::operation(
                    "authority_migration_publish_and_restore_failed",
                    &format!(
                        "failed to publish migrated authority database ({error:#}); original sidecar restore also failed ({restore_error})"
                    ),
                    false,
                ),
            });
        }
        manifest.stage = MigrationSwitchStage::Published;
        atomic_write_private_json(&manifest_path, &manifest).map_err(|error| {
            DatabaseMigrationError::io(
                "authority_migration_manifest_write_failed",
                "record published authority database",
                &manifest_path,
                io::Error::other(error.to_string()),
            )
        })?;
        std::fs::remove_file(&manifest_path).map_err(|error| {
            DatabaseMigrationError::io(
                "authority_migration_manifest_remove_failed",
                "remove completed authority migration manifest",
                &manifest_path,
                error,
            )
        })?;
        progress(phase(AuthorityMigrationPhase::Reassessing));
        continue_after_reassessment(
            lease,
            runtime_camp_files_root,
            runtime_camp_files_root_identity_digest,
            progress,
        )
    })();

    if migration_result.is_err() {
        remove_generated_sqlite_files(&staging);
    }
    let database = migration_result?;
    progress(phase(AuthorityMigrationPhase::Completed));
    Ok(database)
}

fn backup_authority(
    source: &Path,
    destination: &Path,
    progress: &mut dyn FnMut(AuthorityMigrationProgress),
) -> Result<(), DatabaseMigrationError> {
    let source_connection = Connection::open_with_flags(
        source,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(|error| {
        DatabaseMigrationError::operation(
            "authority_migration_source_open_failed",
            &format!(
                "failed to open migration source {}: {error}",
                source.display()
            ),
            sqlite_retryable(&error),
        )
    })?;
    source_connection
        .busy_timeout(Duration::from_millis(250))
        .map_err(|error| {
            DatabaseMigrationError::operation(
                "authority_migration_source_busy_timeout_failed",
                &format!("failed to configure migration source busy timeout: {error}"),
                sqlite_retryable(&error),
            )
        })?;
    let mut destination_connection = Connection::open_with_flags(
        destination,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(|error| {
        DatabaseMigrationError::operation(
            "authority_migration_snapshot_open_failed",
            &format!(
                "failed to open migration snapshot {}: {error}",
                destination.display()
            ),
            sqlite_retryable(&error),
        )
    })?;
    let backup = rusqlite::backup::Backup::new(&source_connection, &mut destination_connection)
        .map_err(|error| {
            DatabaseMigrationError::operation(
                "authority_migration_backup_start_failed",
                &format!("failed to start SQLite Backup API snapshot: {error}"),
                sqlite_retryable(&error),
            )
        })?;
    let mut busy_retries = 0usize;
    loop {
        let step = backup.step(BACKUP_PAGES_PER_STEP).map_err(|error| {
            DatabaseMigrationError::operation(
                "authority_migration_backup_step_failed",
                &format!("SQLite Backup API snapshot failed: {error}"),
                sqlite_retryable(&error),
            )
        })?;
        let snapshot = backup.progress();
        progress(AuthorityMigrationProgress {
            phase: AuthorityMigrationPhase::CreatingSnapshot,
            copied_pages: Some(snapshot.pagecount.saturating_sub(snapshot.remaining)),
            total_pages: Some(snapshot.pagecount),
        });
        match step {
            StepResult::Done => break,
            StepResult::More => busy_retries = 0,
            StepResult::Busy | StepResult::Locked => {
                busy_retries += 1;
                if busy_retries > BACKUP_BUSY_RETRY_LIMIT {
                    return Err(DatabaseMigrationError::operation(
                        "authority_migration_backup_busy",
                        "SQLite Backup API remained busy after the bounded retry window",
                        true,
                    ));
                }
            }
            _ => {
                return Err(DatabaseMigrationError::operation(
                    "authority_migration_backup_unknown_step",
                    "SQLite Backup API returned an unknown step result",
                    false,
                ));
            }
        }
        thread::sleep(BACKUP_BUSY_PAUSE);
    }
    drop(backup);
    drop(destination_connection);
    drop(source_connection);
    Ok(())
}

fn recover_interrupted_switch(
    lease: &CoreDataDirLease,
    manifest_path: &Path,
) -> Result<(), DatabaseMigrationError> {
    let manifest = read_manifest(manifest_path)?;
    validate_manifest_paths(lease, &manifest)?;
    let source = lease.data_dir().join(&manifest.source_file_name);
    let backup_directory = backup_directory(lease, manifest.backup_operation_id);
    let current_identity = observe_authority_identity_token(&source).map_err(|error| {
        DatabaseMigrationError::io(
            "authority_migration_recovery_source_identity_failed",
            "observe interrupted migration authority target",
            &source,
            error,
        )
    })?;
    if current_identity == manifest.source_main_identity {
        restore_original_sidecars(lease, &backup_directory, &manifest)?;
        let staging = lease.data_dir().join(&manifest.staging_file_name);
        remove_generated_file_if_identity(&staging, &manifest.migrated_main_identity)?;
    } else if current_identity == manifest.migrated_main_identity {
        preserve_stray_original_sidecars(lease, &backup_directory, &manifest)?;
    } else {
        return Err(DatabaseMigrationError::blocked(
            AuthorityBlock::MigrationRecoveryRequired {
                manifest: manifest_path.to_path_buf(),
                message: "authority main-file identity matches neither the original nor the validated migration copy"
                    .to_string(),
            },
            "interrupted migration cannot be recovered automatically",
        ));
    }
    std::fs::remove_file(manifest_path).map_err(|error| {
        DatabaseMigrationError::io(
            "authority_migration_recovery_manifest_remove_failed",
            "remove recovered migration manifest",
            manifest_path,
            error,
        )
    })?;
    Ok(())
}

#[derive(Debug, Clone)]
struct SourceArtifact {
    kind: AuthorityArtifactKind,
    path: PathBuf,
    identity: AuthorityArtifactIdentityToken,
}

fn observe_source_artifacts(
    source: &Path,
    namespace: AuthorityNamespace,
) -> Result<Vec<SourceArtifact>, DatabaseMigrationError> {
    let mut artifacts = Vec::new();
    for (kind, path) in [
        (AuthorityArtifactKind::Main, source.to_path_buf()),
        (
            AuthorityArtifactKind::Wal,
            PathBuf::from(format!("{}-wal", source.as_os_str().to_string_lossy())),
        ),
        (
            AuthorityArtifactKind::RollbackJournal,
            PathBuf::from(format!("{}-journal", source.as_os_str().to_string_lossy())),
        ),
        (
            AuthorityArtifactKind::Shm,
            PathBuf::from(format!("{}-shm", source.as_os_str().to_string_lossy())),
        ),
    ] {
        match observe_authority_identity_token(&path) {
            Ok(identity) => artifacts.push(SourceArtifact {
                kind,
                path,
                identity,
            }),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(DatabaseMigrationError::io(
                    "authority_migration_artifact_observation_failed",
                    &format!("observe {namespace:?} migration source artifact"),
                    &path,
                    error,
                ));
            }
        }
    }
    Ok(artifacts)
}

fn prepare_backup_directory(
    lease: &CoreDataDirLease,
    operation_id: Uuid,
) -> Result<PathBuf, DatabaseMigrationError> {
    let root = lease.data_dir().join(MIGRATION_BACKUP_ROOT);
    prepare_private_directory(&root).map_err(|error| {
        DatabaseMigrationError::io(
            "authority_migration_backup_root_failed",
            "prepare authority migration backup root",
            &root,
            io::Error::other(error.to_string()),
        )
    })?;
    let operation = backup_directory(lease, operation_id);
    if operation.exists() {
        return Err(DatabaseMigrationError::operation(
            "authority_migration_backup_collision",
            &format!(
                "migration backup directory already exists: {}",
                operation.display()
            ),
            false,
        ));
    }
    prepare_private_directory(&operation).map_err(|error| {
        DatabaseMigrationError::io(
            "authority_migration_backup_directory_failed",
            "prepare authority migration backup directory",
            &operation,
            io::Error::other(error.to_string()),
        )
    })?;
    Ok(operation)
}

fn backup_directory(lease: &CoreDataDirLease, operation_id: Uuid) -> PathBuf {
    lease
        .data_dir()
        .join(MIGRATION_BACKUP_ROOT)
        .join(operation_id.to_string())
}

fn copy_private_file(source: &Path, destination: &Path) -> Result<(), DatabaseMigrationError> {
    let mut input = open_existing_no_follow(source).map_err(|error| {
        DatabaseMigrationError::io(
            "authority_migration_backup_source_open_failed",
            "open authority artifact for preservation",
            source,
            error,
        )
    })?;
    let mut output = create_private_new_file(destination).map_err(|error| {
        DatabaseMigrationError::io(
            "authority_migration_backup_destination_create_failed",
            "create preserved authority artifact",
            destination,
            io::Error::other(error.to_string()),
        )
    })?;
    io::copy(&mut input, &mut output).map_err(|error| {
        DatabaseMigrationError::io(
            "authority_migration_backup_copy_failed",
            "copy authority artifact for preservation",
            source,
            error,
        )
    })?;
    output.sync_all().map_err(|error| {
        DatabaseMigrationError::io(
            "authority_migration_backup_sync_failed",
            "flush preserved authority artifact",
            destination,
            error,
        )
    })?;
    Ok(())
}

#[cfg(unix)]
fn open_existing_no_follow(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;

    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(windows)]
fn open_existing_no_follow(path: &Path) -> io::Result<File> {
    crate::platform::private_storage::open_private_read_file(path)
        .map_err(|error| io::Error::other(error.to_string()))
}

#[cfg(not(any(unix, windows)))]
fn open_existing_no_follow(path: &Path) -> io::Result<File> {
    File::open(path)
}

fn detach_source_sidecars(
    lease: &CoreDataDirLease,
    backup_directory: &Path,
    manifest: &AuthorityMigrationManifest,
) -> Result<(), DatabaseMigrationError> {
    for artifact in manifest
        .artifacts
        .iter()
        .filter(|artifact| artifact.kind != AuthorityArtifactKind::Main)
    {
        let source = lease.data_dir().join(&artifact.source_file_name);
        if observe_authority_identity_token(&source).map_err(|error| {
            DatabaseMigrationError::io(
                "authority_migration_sidecar_revalidation_failed",
                "revalidate source sidecar before detach",
                &source,
                error,
            )
        })? != artifact.source_identity
        {
            return Err(DatabaseMigrationError::blocked(
                AuthorityBlock::IdentityChanged {
                    target: source,
                    stage: crate::database_admission::BusyStage::Revalidation,
                },
                "authority sidecar changed before migration switch",
            ));
        }
        let detached = backup_directory.join(
            artifact
                .detached_file_name
                .as_ref()
                .expect("non-main migration artifact has detached name"),
        );
        std::fs::rename(&source, &detached).map_err(|error| {
            DatabaseMigrationError::io(
                "authority_migration_sidecar_detach_failed",
                "detach original authority sidecar",
                &source,
                error,
            )
        })?;
    }
    Ok(())
}

fn restore_original_sidecars(
    lease: &CoreDataDirLease,
    backup_directory: &Path,
    manifest: &AuthorityMigrationManifest,
) -> Result<(), DatabaseMigrationError> {
    for artifact in manifest
        .artifacts
        .iter()
        .filter(|artifact| artifact.kind != AuthorityArtifactKind::Main)
    {
        let source = lease.data_dir().join(&artifact.source_file_name);
        match observe_authority_identity_token(&source) {
            Ok(identity) if identity == artifact.source_identity => continue,
            Ok(_) => {
                return Err(DatabaseMigrationError::operation(
                    "authority_migration_restore_target_changed",
                    &format!(
                        "refused to overwrite changed authority sidecar {}",
                        source.display()
                    ),
                    false,
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(DatabaseMigrationError::io(
                    "authority_migration_restore_target_observation_failed",
                    "observe authority sidecar restore target",
                    &source,
                    error,
                ));
            }
        }
        let detached = backup_directory.join(
            artifact
                .detached_file_name
                .as_ref()
                .expect("non-main migration artifact has detached name"),
        );
        match observe_authority_identity_token(&detached) {
            Ok(identity) if identity == artifact.source_identity => {
                std::fs::rename(&detached, &source).map_err(|error| {
                    DatabaseMigrationError::io(
                        "authority_migration_sidecar_restore_failed",
                        "restore detached authority sidecar",
                        &source,
                        error,
                    )
                })?;
                continue;
            }
            Ok(_) => {
                return Err(DatabaseMigrationError::operation(
                    "authority_migration_detached_sidecar_changed",
                    &format!("detached authority sidecar changed: {}", detached.display()),
                    false,
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(DatabaseMigrationError::io(
                    "authority_migration_detached_sidecar_observation_failed",
                    "observe detached authority sidecar",
                    &detached,
                    error,
                ));
            }
        }
        let backup = backup_directory.join(&artifact.backup_file_name);
        let backup_identity = observe_authority_identity_token(&backup).map_err(|error| {
            DatabaseMigrationError::io(
                "authority_migration_backup_sidecar_observation_failed",
                "observe preserved authority sidecar",
                &backup,
                error,
            )
        })?;
        if backup_identity != artifact.backup_identity {
            return Err(DatabaseMigrationError::operation(
                "authority_migration_backup_sidecar_changed",
                &format!("preserved authority sidecar changed: {}", backup.display()),
                false,
            ));
        }
        copy_private_file(&backup, &source)?;
    }
    Ok(())
}

fn preserve_stray_original_sidecars(
    lease: &CoreDataDirLease,
    backup_directory: &Path,
    manifest: &AuthorityMigrationManifest,
) -> Result<(), DatabaseMigrationError> {
    for artifact in manifest
        .artifacts
        .iter()
        .filter(|artifact| artifact.kind != AuthorityArtifactKind::Main)
    {
        let source = lease.data_dir().join(&artifact.source_file_name);
        match observe_authority_identity_token(&source) {
            Ok(identity) if identity == artifact.source_identity => {
                let recovered = backup_directory
                    .join(format!("recovered-{}", artifact_kind_name(artifact.kind)));
                if recovered.exists() {
                    return Err(DatabaseMigrationError::operation(
                        "authority_migration_recovered_sidecar_collision",
                        &format!(
                            "recovered sidecar path already exists: {}",
                            recovered.display()
                        ),
                        false,
                    ));
                }
                std::fs::rename(&source, &recovered).map_err(|error| {
                    DatabaseMigrationError::io(
                        "authority_migration_stray_sidecar_preserve_failed",
                        "preserve original sidecar after published migration",
                        &source,
                        error,
                    )
                })?;
            }
            Ok(_) => {
                return Err(DatabaseMigrationError::operation(
                    "authority_migration_published_sidecar_unknown",
                    &format!(
                        "unknown sidecar appeared beside published authority database: {}",
                        source.display()
                    ),
                    false,
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(DatabaseMigrationError::io(
                    "authority_migration_published_sidecar_observation_failed",
                    "observe sidecar beside published authority database",
                    &source,
                    error,
                ));
            }
        }
    }
    Ok(())
}

fn remove_generated_file_if_identity(
    path: &Path,
    expected: &AuthorityArtifactIdentityToken,
) -> Result<(), DatabaseMigrationError> {
    match observe_authority_identity_token(path) {
        Ok(identity) if &identity == expected => std::fs::remove_file(path).map_err(|error| {
            DatabaseMigrationError::io(
                "authority_migration_staging_cleanup_failed",
                "remove recovered migration staging file",
                path,
                error,
            )
        }),
        Ok(_) => Err(DatabaseMigrationError::operation(
            "authority_migration_staging_identity_changed",
            &format!(
                "refused to remove changed migration staging file: {}",
                path.display()
            ),
            false,
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(DatabaseMigrationError::io(
            "authority_migration_staging_observation_failed",
            "observe recovered migration staging file",
            path,
            error,
        )),
    }
}

fn remove_generated_sqlite_files(path: &Path) {
    let name = path.as_os_str().to_string_lossy();
    let _ = std::fs::remove_file(path);
    for suffix in ["-wal", "-shm", "-journal"] {
        let _ = std::fs::remove_file(format!("{name}{suffix}"));
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum MigrationSwitchStage {
    Prepared,
    SidecarsDetached,
    Published,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MigrationManifestArtifact {
    kind: AuthorityArtifactKind,
    source_file_name: String,
    backup_file_name: String,
    detached_file_name: Option<String>,
    source_identity: AuthorityArtifactIdentityToken,
    backup_identity: AuthorityArtifactIdentityToken,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthorityMigrationManifest {
    schema_version: u32,
    operation_id: Uuid,
    namespace: AuthorityNamespace,
    source_file_name: String,
    staging_file_name: String,
    backup_operation_id: Uuid,
    source_main_identity: AuthorityArtifactIdentityToken,
    migrated_main_identity: AuthorityArtifactIdentityToken,
    artifacts: Vec<MigrationManifestArtifact>,
    stage: MigrationSwitchStage,
}

fn read_manifest(path: &Path) -> Result<AuthorityMigrationManifest, DatabaseMigrationError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        DatabaseMigrationError::io(
            "authority_migration_manifest_observation_failed",
            "observe authority migration manifest",
            path,
            error,
        )
    })?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MANIFEST_MAX_BYTES
    {
        return Err(DatabaseMigrationError::blocked(
            AuthorityBlock::MigrationRecoveryRequired {
                manifest: path.to_path_buf(),
                message: "migration manifest is not an admitted bounded regular file".to_string(),
            },
            "migration manifest cannot be admitted",
        ));
    }
    let mut file = open_existing_no_follow(path).map_err(|error| {
        DatabaseMigrationError::io(
            "authority_migration_manifest_open_failed",
            "open authority migration manifest",
            path,
            error,
        )
    })?;
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MANIFEST_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            DatabaseMigrationError::io(
                "authority_migration_manifest_read_failed",
                "read authority migration manifest",
                path,
                error,
            )
        })?;
    if bytes.len() as u64 > MANIFEST_MAX_BYTES {
        return Err(DatabaseMigrationError::operation(
            "authority_migration_manifest_too_large",
            "authority migration manifest exceeds its byte limit",
            false,
        ));
    }
    let manifest: AuthorityMigrationManifest = serde_json::from_slice(&bytes).map_err(|error| {
        DatabaseMigrationError::operation(
            "authority_migration_manifest_invalid",
            &format!("authority migration manifest is invalid: {error}"),
            false,
        )
    })?;
    if manifest.schema_version != 1 {
        return Err(DatabaseMigrationError::operation(
            "authority_migration_manifest_schema_unknown",
            &format!(
                "unsupported authority migration manifest schema {}",
                manifest.schema_version
            ),
            false,
        ));
    }
    Ok(manifest)
}

fn validate_manifest_paths(
    lease: &CoreDataDirLease,
    manifest: &AuthorityMigrationManifest,
) -> Result<(), DatabaseMigrationError> {
    let expected_source = match manifest.namespace {
        AuthorityNamespace::Rovai => "rovai.sqlite",
        AuthorityNamespace::Lumen => "lumen.sqlite",
    };
    if manifest.source_file_name != expected_source
        || manifest.staging_file_name
            != format!(
                ".rovai-authority-migration-{}.sqlite",
                manifest.operation_id
            )
        || manifest.backup_operation_id != manifest.operation_id
        || !is_leaf(&manifest.source_file_name)
        || !is_leaf(&manifest.staging_file_name)
    {
        return Err(DatabaseMigrationError::blocked(
            AuthorityBlock::MigrationRecoveryRequired {
                manifest: lease.data_dir().join(AUTHORITY_MIGRATION_MANIFEST_FILE),
                message: "migration manifest contains an invalid authority path".to_string(),
            },
            "migration manifest path validation failed",
        ));
    }
    for artifact in &manifest.artifacts {
        if !is_leaf(&artifact.source_file_name)
            || !is_leaf(&artifact.backup_file_name)
            || artifact
                .detached_file_name
                .as_ref()
                .is_some_and(|name| !is_leaf(name))
        {
            return Err(DatabaseMigrationError::operation(
                "authority_migration_manifest_artifact_path_invalid",
                "migration manifest contains an invalid artifact path",
                false,
            ));
        }
    }
    Ok(())
}

fn is_leaf(value: &str) -> bool {
    let mut components = Path::new(value).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

fn leaf_name(path: &Path) -> Result<String, DatabaseMigrationError> {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| is_leaf(name))
        .map(str::to_string)
        .ok_or_else(|| {
            DatabaseMigrationError::operation(
                "authority_migration_non_utf8_path",
                &format!(
                    "migration authority path is not a valid leaf: {}",
                    path.display()
                ),
                false,
            )
        })
}

fn artifact_kind_name(kind: AuthorityArtifactKind) -> &'static str {
    match kind {
        AuthorityArtifactKind::Main => "main.sqlite",
        AuthorityArtifactKind::Wal => "wal",
        AuthorityArtifactKind::RollbackJournal => "journal",
        AuthorityArtifactKind::Shm => "shm",
    }
}

fn sqlite_retryable(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(sqlite, _)
            if matches!(
                sqlite.code,
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
            )
    )
}

fn phase(phase: AuthorityMigrationPhase) -> AuthorityMigrationProgress {
    AuthorityMigrationProgress {
        phase,
        copied_pages: None,
        total_pages: None,
    }
}

impl DatabaseMigrationError {
    fn from_ticket(error: TicketValidationError) -> Self {
        match error {
            TicketValidationError::Blocked(block) => {
                Self::blocked(*block, "authority migration ticket failed revalidation")
            }
            TicketValidationError::Infrastructure(error) => Self::operation(
                "authority_migration_ticket_infrastructure_failed",
                &error.message,
                false,
            ),
        }
    }

    fn from_admission(error: crate::database_admission::AdmissionInfrastructureError) -> Self {
        Self::operation(&error.code, &error.message, false)
    }

    fn from_open(error: DatabaseOpenError) -> Self {
        let block = error.authority_block().cloned();
        Self {
            code: error.code().to_string(),
            message: error.to_string(),
            retryable: matches!(block.as_ref(), Some(AuthorityBlock::Busy { .. })),
            authority_block: block.map(Box::new),
        }
    }

    fn io(code: &'static str, operation: &str, path: &Path, error: io::Error) -> Self {
        Self::operation(
            code,
            &format!("failed to {operation} {}: {error}", path.display()),
            matches!(
                error.kind(),
                io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
            ),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        database_admission::{AdmissionAssessment, DatabaseAdmission},
        db::{DatabaseContractClassification, classify_database_contract},
    };
    use std::process::{Command, Stdio};

    #[test]
    fn manifest_paths_reject_parent_traversal() {
        assert!(is_leaf("rovai.sqlite"));
        assert!(!is_leaf("../rovai.sqlite"));
        assert!(!is_leaf("nested/rovai.sqlite"));
        assert!(!is_leaf(""));
    }

    #[test]
    fn supported_database_is_migrated_on_a_copy_and_atomically_readmitted() {
        let directory =
            std::env::temp_dir().join(format!("rovai-authority-migration-test-{}", Uuid::new_v4()));
        let database = crate::test_support::fresh_schema_database_fast_at(&directory);
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET display_name = '迁移保留值' WHERE id = 'agent_1'",
                [],
            )
            .unwrap();
        crate::db::downgrade_current_schema_to_v115_source_for_test(database.connection());
        let runtime_root = database.runtime_camp_files_root().to_path_buf();
        let runtime_root_identity = database
            .runtime_camp_files_root_identity_digest()
            .to_string();
        drop(database);

        let lease = CoreDataDirLease::acquire(&directory).unwrap();
        let AdmissionAssessment::RequiresMigration(ticket) =
            DatabaseAdmission::assess(&lease).unwrap()
        else {
            panic!("supported historical contract must produce a migration ticket");
        };
        let migrated =
            AuthorityMigrationRunner::run(*ticket, &runtime_root, &runtime_root_identity).unwrap();
        crate::test_support::assert_production_database_configuration(&migrated);
        assert!(matches!(
            classify_database_contract(migrated.connection()).unwrap(),
            DatabaseContractClassification::Current(_)
        ));
        let display_name: String = migrated
            .connection()
            .query_row(
                "SELECT display_name FROM agent_profile WHERE id = 'agent_1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(display_name, "迁移保留值");
        assert!(!directory.join(AUTHORITY_MIGRATION_MANIFEST_FILE).exists());
        assert!(directory.join(MIGRATION_BACKUP_ROOT).is_dir());

        drop(migrated);
        drop(lease);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn process_kill_during_switch_is_recovered_without_losing_authority() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-authority-migration-kill-test-{}",
            Uuid::new_v4()
        ));
        let database = crate::test_support::fresh_schema_database_fast_at(&directory);
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET display_name = '中断后仍保留' WHERE id = 'agent_1'",
                [],
            )
            .unwrap();
        crate::db::downgrade_current_schema_to_v115_source_for_test(database.connection());
        let runtime_root = database.runtime_camp_files_root().to_path_buf();
        let runtime_root_identity = database
            .runtime_camp_files_root_identity_digest()
            .to_string();
        drop(database);

        let marker = directory.join("migration-switch-reached.test-marker");
        let executable = std::env::current_exe().unwrap();
        let mut child = Command::new(executable)
            .arg("--exact")
            .arg("authority_migration::tests::migration_process_kill_helper")
            .arg("--nocapture")
            .env("ROVAI_MIGRATION_KILL_HELPER_DATA_DIR", &directory)
            .env("ROVAI_MIGRATION_KILL_HELPER_RUNTIME_ROOT", &runtime_root)
            .env(
                "ROVAI_MIGRATION_KILL_HELPER_RUNTIME_IDENTITY",
                &runtime_root_identity,
            )
            .env("ROVAI_MIGRATION_KILL_HELPER_MARKER", &marker)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();

        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        while !marker.exists() {
            if let Some(status) = child.try_wait().unwrap() {
                let output = child.wait_with_output().unwrap();
                panic!(
                    "migration helper exited before the switch marker ({status}):\nstdout:\n{}\nstderr:\n{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr),
                );
            }
            assert!(
                std::time::Instant::now() < deadline,
                "migration helper did not reach the switch boundary"
            );
            thread::sleep(Duration::from_millis(20));
        }
        child.kill().unwrap();
        let status = child.wait().unwrap();
        assert!(
            !status.success(),
            "helper must be terminated at the failpoint"
        );
        std::fs::remove_file(&marker).unwrap();
        assert!(directory.join(AUTHORITY_MIGRATION_MANIFEST_FILE).is_file());

        let lease = CoreDataDirLease::acquire(&directory).unwrap();
        let AdmissionAssessment::RequiresMigration(ticket) =
            DatabaseAdmission::assess(&lease).unwrap()
        else {
            panic!("interrupted switch must be represented by a recovery ticket");
        };
        let migrated =
            AuthorityMigrationRunner::run(*ticket, &runtime_root, &runtime_root_identity).unwrap();
        assert!(matches!(
            classify_database_contract(migrated.connection()).unwrap(),
            DatabaseContractClassification::Current(_)
        ));
        let display_name: String = migrated
            .connection()
            .query_row(
                "SELECT display_name FROM agent_profile WHERE id = 'agent_1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(display_name, "中断后仍保留");
        assert!(!directory.join(AUTHORITY_MIGRATION_MANIFEST_FILE).exists());

        drop(migrated);
        drop(lease);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn migration_process_kill_helper() {
        let Some(directory) = std::env::var_os("ROVAI_MIGRATION_KILL_HELPER_DATA_DIR") else {
            return;
        };
        let directory = PathBuf::from(directory);
        let runtime_root =
            PathBuf::from(std::env::var_os("ROVAI_MIGRATION_KILL_HELPER_RUNTIME_ROOT").unwrap());
        let runtime_identity =
            std::env::var("ROVAI_MIGRATION_KILL_HELPER_RUNTIME_IDENTITY").unwrap();
        let marker = PathBuf::from(std::env::var_os("ROVAI_MIGRATION_KILL_HELPER_MARKER").unwrap());
        let lease = CoreDataDirLease::acquire(&directory).unwrap();
        let AdmissionAssessment::RequiresMigration(ticket) =
            DatabaseAdmission::assess(&lease).unwrap()
        else {
            panic!("kill helper requires a supported migration source");
        };
        let _ = AuthorityMigrationRunner::run_with_progress(
            *ticket,
            &runtime_root,
            &runtime_identity,
            |progress| {
                if progress.phase != AuthorityMigrationPhase::SwitchingAuthority {
                    return;
                }
                std::fs::write(&marker, b"ready").unwrap();
                loop {
                    thread::sleep(Duration::from_secs(1));
                }
            },
        );
        unreachable!("parent process must terminate the migration helper");
    }
}
