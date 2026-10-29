use std::{
    io,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{Connection, ErrorCode, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::{
    core_data_dir_lock::{CoreDataDirLease, FilesystemObjectIdentity},
    db::{DatabaseContractClassification, DatabaseContractMarker, classify_startup_contract},
};

const AUTHORITY_BUSY_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const AUTHORITY_MIGRATION_MANIFEST_FILE: &str = ".rovai-authority-migration-v1.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorityNamespace {
    Rovai,
    Lumen,
}

impl AuthorityNamespace {
    fn main_file_name(self) -> &'static str {
        match self {
            Self::Rovai => "rovai.sqlite",
            Self::Lumen => "lumen.sqlite",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorityArtifactKind {
    Main,
    Wal,
    RollbackJournal,
    Shm,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityArtifactSummary {
    pub namespace: AuthorityNamespace,
    pub kind: AuthorityArtifactKind,
    pub path: PathBuf,
    pub byte_length: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BusyStage {
    Open,
    ContractQuery,
    Revalidation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthorityBlock {
    AmbiguousAuthorityCandidates {
        candidates: Vec<AuthorityArtifactSummary>,
    },
    IncompleteAuthorityArtifacts {
        artifacts: Vec<AuthorityArtifactSummary>,
    },
    UnsupportedAuthorityArtifact {
        artifact: AuthorityArtifactSummary,
        reason: String,
    },
    PermissionDenied {
        path: PathBuf,
        operation: String,
    },
    Busy {
        stage: BusyStage,
    },
    WalRecoveryRequired {
        target: PathBuf,
        message: String,
    },
    UnknownDataContract {
        target: PathBuf,
        contract_version: Option<String>,
        projection_schema_version: Option<i64>,
        classifier_version: Option<String>,
    },
    CorruptOrUnreadable {
        target: PathBuf,
        sqlite_code: Option<i32>,
        message: String,
    },
    IdentityChanged {
        target: PathBuf,
        stage: BusyStage,
    },
    DataDirectoryIdentityChanged,
    MigrationRecoveryRequired {
        manifest: PathBuf,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmissionInfrastructureError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl AdmissionInfrastructureError {
    fn filesystem(operation: &str, path: &Path, error: &io::Error) -> Self {
        Self {
            code: "authority_admission_filesystem_failed".to_string(),
            message: format!("failed to {operation} {}: {error}", path.display()),
            retryable: io_error_is_transient(error),
        }
    }
}

impl std::fmt::Display for AdmissionInfrastructureError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for AdmissionInfrastructureError {}

#[derive(Debug)]
pub enum AuthorityPathError {
    Blocked(Box<AuthorityBlock>),
    Infrastructure(AdmissionInfrastructureError),
}

impl std::fmt::Display for AuthorityPathError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Blocked(block) => write!(formatter, "authority path was blocked: {block:?}"),
            Self::Infrastructure(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for AuthorityPathError {}

#[derive(Debug)]
pub enum AdmissionAssessment<'lease> {
    AdmittedExisting(Box<ExistingAuthorityOpen<'lease>>),
    Initializable(Box<NewAuthorityTarget<'lease>>),
    RequiresMigration(Box<MigrationAuthorityOpen<'lease>>),
    Blocked(Box<AuthorityBlock>),
}

impl AdmissionAssessment<'_> {
    pub fn source_contract_version(&self) -> Option<&str> {
        match self {
            Self::AdmittedExisting(_) => Some(crate::db::CURRENT_DATA_CONTRACT_VERSION),
            Self::RequiresMigration(open) => match &open.state {
                MigrationOperation::Upgrade {
                    source_contract, ..
                } => Some(&source_contract.contract_version),
                MigrationOperation::Interrupted { .. } => None,
            },
            _ => None,
        }
    }
}

/// The already-open SQLite connection stays with its directory lease through
/// version checking, migration and runtime use. There is no file-state ticket.
#[derive(Debug)]
pub struct ExistingAuthorityOpen<'lease> {
    lease: &'lease CoreDataDirLease,
    pub(crate) path: PathBuf,
    namespace: AuthorityNamespace,
    main_identity: FilesystemObjectIdentity,
    pub(crate) connection: Connection,
}

impl ExistingAuthorityOpen<'_> {
    pub(crate) fn into_parts(self) -> Result<(PathBuf, Connection), AuthorityPathError> {
        verify_selected_main(self.lease, &self.path, self.namespace, &self.main_identity)?;
        Ok((self.path, self.connection))
    }
}

/// Creation is a separate operation and still requires confirmed absence.
#[derive(Debug)]
pub struct NewAuthorityTarget<'lease> {
    lease: &'lease CoreDataDirLease,
}

#[derive(Debug)]
pub(crate) struct NewAuthorityOpen<'lease> {
    lease: &'lease CoreDataDirLease,
    pub path: PathBuf,
}

#[derive(Debug)]
pub struct MigrationAuthorityOpen<'lease> {
    pub(crate) state: MigrationOperation<'lease>,
}

#[derive(Debug)]
pub(crate) enum MigrationOperation<'lease> {
    Upgrade {
        lease: &'lease CoreDataDirLease,
        path: PathBuf,
        namespace: AuthorityNamespace,
        source_contract: DatabaseContractMarker,
        main_identity: FilesystemObjectIdentity,
        connection: Connection,
    },
    Interrupted {
        lease: &'lease CoreDataDirLease,
        manifest: PathBuf,
    },
}

impl<'lease> NewAuthorityTarget<'lease> {
    pub(crate) fn into_initialization(
        self,
    ) -> Result<NewAuthorityOpen<'lease>, AuthorityPathError> {
        revalidate_lease(self.lease)?;
        let current = observe_all(self.lease).map_err(observation_to_path_error)?;
        if current.rovai.main.is_some()
            || current.lumen.main.is_some()
            || !current.authoritative_sidecars().is_empty()
        {
            return Err(AuthorityPathError::Blocked(Box::new(
                AuthorityBlock::IdentityChanged {
                    target: self.lease.data_dir().to_path_buf(),
                    stage: BusyStage::Revalidation,
                },
            )));
        }
        // No main or recovery log exists. SHM is only SQLite's rebuildable index;
        // do not compare timestamps or contents of this disposable cache.
        for shm in [current.rovai.shm, current.lumen.shm].into_iter().flatten() {
            std::fs::remove_file(&shm.path).map_err(|error| {
                AuthorityPathError::Infrastructure(AdmissionInfrastructureError::filesystem(
                    "remove orphan SHM",
                    &shm.path,
                    &error,
                ))
            })?;
        }
        Ok(NewAuthorityOpen {
            lease: self.lease,
            path: self.lease.data_dir().join("rovai.sqlite"),
        })
    }
}

impl NewAuthorityOpen<'_> {
    pub(crate) fn revalidate_absence(&self) -> Result<(), AuthorityPathError> {
        revalidate_lease(self.lease)?;
        let current = observe_all(self.lease).map_err(observation_to_path_error)?;
        if current.has_no_authority_artifacts() {
            Ok(())
        } else {
            Err(AuthorityPathError::Blocked(Box::new(
                AuthorityBlock::IdentityChanged {
                    target: self.lease.data_dir().to_path_buf(),
                    stage: BusyStage::Revalidation,
                },
            )))
        }
    }
}

impl MigrationAuthorityOpen<'_> {
    pub(crate) fn revalidate(&self) -> Result<(), AuthorityPathError> {
        match &self.state {
            MigrationOperation::Upgrade {
                lease,
                path,
                namespace,
                main_identity,
                ..
            } => verify_selected_main(lease, path, *namespace, main_identity),
            MigrationOperation::Interrupted { lease, .. } => revalidate_lease(lease),
        }
    }
}

pub struct DatabaseAdmission;

impl DatabaseAdmission {
    pub fn assess<'lease>(
        lease: &'lease CoreDataDirLease,
    ) -> Result<AdmissionAssessment<'lease>, AdmissionInfrastructureError> {
        if !lease.revalidate_identity().map_err(|error| {
            AdmissionInfrastructureError::filesystem(
                "revalidate data-directory identity",
                lease.data_dir(),
                &error,
            )
        })? {
            return Ok(AdmissionAssessment::Blocked(Box::new(
                AuthorityBlock::DataDirectoryIdentityChanged,
            )));
        }
        let migration_manifest = lease.data_dir().join(AUTHORITY_MIGRATION_MANIFEST_FILE);
        match std::fs::symlink_metadata(&migration_manifest) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                return Ok(AdmissionAssessment::RequiresMigration(Box::new(
                    MigrationAuthorityOpen {
                        state: MigrationOperation::Interrupted {
                            lease,
                            manifest: migration_manifest,
                        },
                    },
                )));
            }
            Ok(_) => {
                return Ok(AdmissionAssessment::Blocked(Box::new(
                    AuthorityBlock::MigrationRecoveryRequired {
                        manifest: migration_manifest,
                        message: "migration manifest is not a regular file".to_string(),
                    },
                )));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
                return Ok(AdmissionAssessment::Blocked(Box::new(
                    AuthorityBlock::PermissionDenied {
                        path: migration_manifest,
                        operation: "inspect migration manifest".to_string(),
                    },
                )));
            }
            Err(error) => {
                return Err(AdmissionInfrastructureError::filesystem(
                    "inspect migration manifest",
                    &migration_manifest,
                    &error,
                ));
            }
        }
        let observed = match observe_all(lease) {
            Ok(observed) => observed,
            Err(ObservationFailure::Blocked(block)) => {
                return Ok(AdmissionAssessment::Blocked(Box::new(block)));
            }
            Err(ObservationFailure::Infrastructure(error)) => return Err(error),
        };

        Self::assess_observed_authority(lease, observed)
    }

    fn assess_observed_authority<'lease>(
        lease: &'lease CoreDataDirLease,
        observed: CompleteArtifactObservation,
    ) -> Result<AdmissionAssessment<'lease>, AdmissionInfrastructureError> {
        let main_candidates = [observed.rovai.main.as_ref(), observed.lumen.main.as_ref()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        if main_candidates.len() > 1 {
            return Ok(AdmissionAssessment::Blocked(Box::new(
                AuthorityBlock::AmbiguousAuthorityCandidates {
                    candidates: main_candidates
                        .into_iter()
                        .map(ObservedArtifact::summary)
                        .collect(),
                },
            )));
        }
        if main_candidates.is_empty() {
            let incomplete = observed.authoritative_sidecars();
            if !incomplete.is_empty() {
                return Ok(AdmissionAssessment::Blocked(Box::new(
                    AuthorityBlock::IncompleteAuthorityArtifacts {
                        artifacts: incomplete,
                    },
                )));
            }
            return Ok(AdmissionAssessment::Initializable(Box::new(
                NewAuthorityTarget { lease },
            )));
        }

        let (namespace, artifacts, other) = if observed.rovai.main.is_some() {
            (AuthorityNamespace::Rovai, &observed.rovai, &observed.lumen)
        } else {
            (AuthorityNamespace::Lumen, &observed.lumen, &observed.rovai)
        };
        let other_incomplete = other.authoritative_sidecars();
        if !other_incomplete.is_empty() {
            return Ok(AdmissionAssessment::Blocked(Box::new(
                AuthorityBlock::IncompleteAuthorityArtifacts {
                    artifacts: other_incomplete,
                },
            )));
        }

        let path = artifacts.main_path();
        let main_identity = FilesystemObjectIdentity::observe(&path).map_err(|error| {
            AdmissionInfrastructureError::filesystem("observe selected database", &path, &error)
        })?;
        // SQLite owns WAL and hot-journal recovery. Existing files never receive
        // CREATE, and failure never falls back to first-run initialization.
        let connection = match Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        ) {
            Ok(connection) => connection,
            Err(error) => {
                return Ok(AdmissionAssessment::Blocked(Box::new(sqlite_block(
                    &path,
                    BusyStage::Open,
                    artifacts.wal.is_some(),
                    error,
                ))));
            }
        };
        let classify = || -> rusqlite::Result<_> {
            connection.busy_timeout(AUTHORITY_BUSY_TIMEOUT)?;
            let transaction = connection.unchecked_transaction()?;
            let classification = classify_startup_contract(&transaction)?;
            transaction.commit()?;
            Ok(classification)
        };
        let classification = match classify() {
            Ok(classification) => classification,
            Err(error) => {
                return Ok(AdmissionAssessment::Blocked(Box::new(sqlite_block(
                    &path,
                    BusyStage::ContractQuery,
                    artifacts.wal.is_some(),
                    error,
                ))));
            }
        };
        match classification {
            DatabaseContractClassification::Current(_) => Ok(
                AdmissionAssessment::AdmittedExisting(Box::new(ExistingAuthorityOpen {
                    lease,
                    path,
                    namespace,
                    main_identity,
                    connection,
                })),
            ),
            DatabaseContractClassification::SupportedMigrationSource(source_contract) => Ok(
                AdmissionAssessment::RequiresMigration(Box::new(MigrationAuthorityOpen {
                    state: MigrationOperation::Upgrade {
                        lease,
                        path,
                        namespace,
                        source_contract,
                        main_identity,
                        connection,
                    },
                })),
            ),
            DatabaseContractClassification::Unknown(marker) => Ok(AdmissionAssessment::Blocked(
                Box::new(unknown_contract_block(path, marker)),
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthorityArtifactIdentityToken {
    object_key: String,
    byte_length: u64,
    state_key: String,
}

impl AuthorityArtifactIdentityToken {
    /// Only old manifest recovery may explain a rename's ctime change. Ordinary
    /// admission still compares the entire token strictly. Object, size and
    /// content mtime must all match; a replacement or content write is refused.
    pub(crate) fn matches_legacy_rename(&self, before: &Self) -> bool {
        if self == before {
            return true;
        }
        #[cfg(unix)]
        {
            let after_times = self.state_key.split(':').collect::<Vec<_>>();
            let before_times = before.state_key.split(':').collect::<Vec<_>>();
            self.object_key == before.object_key
                && self.byte_length == before.byte_length
                && after_times.len() == 4
                && before_times.len() == 4
                && after_times[..2] == before_times[..2]
        }
        #[cfg(not(unix))]
        {
            false
        }
    }
}

#[derive(Debug, Clone)]
struct ObservedArtifact {
    namespace: AuthorityNamespace,
    kind: AuthorityArtifactKind,
    path: PathBuf,
    byte_length: u64,
}

impl ObservedArtifact {
    fn summary(&self) -> AuthorityArtifactSummary {
        AuthorityArtifactSummary {
            namespace: self.namespace,
            kind: self.kind,
            path: self.path.clone(),
            byte_length: self.byte_length,
        }
    }
}

#[derive(Debug, Clone)]
struct NamespaceArtifactSet {
    main: Option<ObservedArtifact>,
    wal: Option<ObservedArtifact>,
    rollback_journal: Option<ObservedArtifact>,
    shm: Option<ObservedArtifact>,
}

impl NamespaceArtifactSet {
    fn main_path(&self) -> PathBuf {
        self.main.as_ref().expect("selected main file").path.clone()
    }
    fn authoritative_sidecars(&self) -> Vec<AuthorityArtifactSummary> {
        [self.wal.as_ref(), self.rollback_journal.as_ref()]
            .into_iter()
            .flatten()
            .map(ObservedArtifact::summary)
            .collect()
    }
}

#[derive(Debug, Clone)]
struct CompleteArtifactObservation {
    rovai: NamespaceArtifactSet,
    lumen: NamespaceArtifactSet,
}

impl CompleteArtifactObservation {
    fn authoritative_sidecars(&self) -> Vec<AuthorityArtifactSummary> {
        self.rovai
            .authoritative_sidecars()
            .into_iter()
            .chain(self.lumen.authoritative_sidecars())
            .collect()
    }

    fn has_no_authority_artifacts(&self) -> bool {
        self.rovai.main.is_none()
            && self.rovai.wal.is_none()
            && self.rovai.rollback_journal.is_none()
            && self.rovai.shm.is_none()
            && self.lumen.main.is_none()
            && self.lumen.wal.is_none()
            && self.lumen.rollback_journal.is_none()
            && self.lumen.shm.is_none()
    }
}

enum ObservationFailure {
    Blocked(AuthorityBlock),
    Infrastructure(AdmissionInfrastructureError),
}

fn observation_to_path_error(error: ObservationFailure) -> AuthorityPathError {
    match error {
        ObservationFailure::Blocked(block) => AuthorityPathError::Blocked(Box::new(block)),
        ObservationFailure::Infrastructure(error) => AuthorityPathError::Infrastructure(error),
    }
}

fn observe_all(
    lease: &CoreDataDirLease,
) -> Result<CompleteArtifactObservation, ObservationFailure> {
    Ok(CompleteArtifactObservation {
        rovai: observe_namespace(lease, AuthorityNamespace::Rovai)?,
        lumen: observe_namespace(lease, AuthorityNamespace::Lumen)?,
    })
}

fn observe_namespace(
    lease: &CoreDataDirLease,
    namespace: AuthorityNamespace,
) -> Result<NamespaceArtifactSet, ObservationFailure> {
    let main_name = namespace.main_file_name();
    Ok(NamespaceArtifactSet {
        main: observe_artifact(
            lease.data_dir().join(main_name),
            namespace,
            AuthorityArtifactKind::Main,
        )?,
        wal: observe_artifact(
            lease.data_dir().join(format!("{main_name}-wal")),
            namespace,
            AuthorityArtifactKind::Wal,
        )?,
        rollback_journal: observe_artifact(
            lease.data_dir().join(format!("{main_name}-journal")),
            namespace,
            AuthorityArtifactKind::RollbackJournal,
        )?,
        shm: observe_artifact(
            lease.data_dir().join(format!("{main_name}-shm")),
            namespace,
            AuthorityArtifactKind::Shm,
        )?,
    })
}

fn observe_artifact(
    path: PathBuf,
    namespace: AuthorityNamespace,
    kind: AuthorityArtifactKind,
) -> Result<Option<ObservedArtifact>, ObservationFailure> {
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) if io_error_is_transient(&error) => {
            return Err(ObservationFailure::Infrastructure(
                AdmissionInfrastructureError::filesystem(
                    "inspect authority artifact",
                    &path,
                    &error,
                ),
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            return Err(ObservationFailure::Blocked(
                AuthorityBlock::PermissionDenied {
                    path,
                    operation: "inspect authority artifact".to_string(),
                },
            ));
        }
        Err(error) => {
            return Err(ObservationFailure::Infrastructure(
                AdmissionInfrastructureError::filesystem(
                    "inspect authority artifact",
                    &path,
                    &error,
                ),
            ));
        }
    };
    let summary = AuthorityArtifactSummary {
        namespace,
        kind,
        path: path.clone(),
        byte_length: metadata.len(),
    };
    if metadata.file_type().is_symlink() {
        return Err(ObservationFailure::Blocked(
            AuthorityBlock::UnsupportedAuthorityArtifact {
                artifact: summary,
                reason: "symbolic links are not admitted for authority artifacts".to_string(),
            },
        ));
    }
    if !metadata.is_file() {
        return Err(ObservationFailure::Blocked(
            AuthorityBlock::UnsupportedAuthorityArtifact {
                artifact: summary,
                reason: "authority artifact is not a regular file".to_string(),
            },
        ));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
        {
            return Err(ObservationFailure::Blocked(
                AuthorityBlock::UnsupportedAuthorityArtifact {
                    artifact: summary,
                    reason: "authority artifact is a reparse point".to_string(),
                },
            ));
        }
    }
    Ok(Some(ObservedArtifact {
        namespace,
        kind,
        path,
        byte_length: metadata.len(),
    }))
}

// File state is retained only for recovery of the old copy/switch manifest.
#[cfg(unix)]
fn artifact_state_key(metadata: &std::fs::Metadata) -> String {
    use std::os::unix::fs::MetadataExt;

    format!(
        "{}:{}:{}:{}",
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.ctime(),
        metadata.ctime_nsec()
    )
}

#[cfg(windows)]
fn artifact_state_key(metadata: &std::fs::Metadata) -> String {
    use std::os::windows::fs::MetadataExt;

    format!("{}:{}", metadata.last_write_time(), metadata.file_size())
}

#[cfg(not(any(unix, windows)))]
fn artifact_state_key(metadata: &std::fs::Metadata) -> String {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| format!("{}:{}", duration.as_secs(), duration.subsec_nanos()))
        .unwrap_or_else(|| "modified-time-unavailable".to_string())
}

pub(crate) fn observe_authority_identity_token(
    path: &Path,
) -> io::Result<AuthorityArtifactIdentityToken> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "authority identity target is not a regular file: {}",
                path.display()
            ),
        ));
    }
    Ok(AuthorityArtifactIdentityToken {
        object_key: FilesystemObjectIdentity::observe(path)?
            .platform_key()
            .to_string(),
        byte_length: metadata.len(),
        state_key: artifact_state_key(&metadata),
    })
}

pub(crate) fn sqlite_error_is_transient(error: &rusqlite::Error) -> bool {
    matches!(error, rusqlite::Error::SqliteFailure(sqlite, _)
        if matches!(sqlite.code, ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
            || sqlite.extended_code == rusqlite::ffi::SQLITE_IOERR_BLOCKED)
}

pub(crate) fn io_error_is_transient(error: &io::Error) -> bool {
    matches!(error.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted)
        // Windows sharing / lock violations, not a general access-denied retry.
        || (cfg!(windows) && matches!(error.raw_os_error(), Some(32 | 33)))
}

fn sqlite_block(
    target: &Path,
    stage: BusyStage,
    wal_present: bool,
    error: rusqlite::Error,
) -> AuthorityBlock {
    let (code, extended_code) = match &error {
        rusqlite::Error::SqliteFailure(sqlite, _) => {
            (Some(sqlite.code), Some(sqlite.extended_code))
        }
        _ => (None, None),
    };
    if sqlite_error_is_transient(&error) {
        return AuthorityBlock::Busy { stage };
    }
    if matches!(
        code,
        Some(ErrorCode::PermissionDenied | ErrorCode::ReadOnly)
    ) {
        return AuthorityBlock::PermissionDenied {
            path: target.to_path_buf(),
            operation: format!("SQLite authority probe at {stage:?}"),
        };
    }
    if wal_present
        && matches!(
            code,
            Some(ErrorCode::CannotOpen | ErrorCode::SystemIoFailure)
        )
    {
        return AuthorityBlock::WalRecoveryRequired {
            target: target.to_path_buf(),
            message: error.to_string(),
        };
    }
    AuthorityBlock::CorruptOrUnreadable {
        target: target.to_path_buf(),
        sqlite_code: extended_code,
        message: error.to_string(),
    }
}

fn unknown_contract_block(
    target: PathBuf,
    marker: Option<DatabaseContractMarker>,
) -> AuthorityBlock {
    AuthorityBlock::UnknownDataContract {
        target,
        contract_version: marker
            .as_ref()
            .map(|marker| marker.contract_version.clone()),
        projection_schema_version: marker
            .as_ref()
            .map(|marker| marker.projection_schema_version),
        classifier_version: marker.map(|marker| marker.classifier_version),
    }
}

pub(crate) fn verify_selected_main(
    lease: &CoreDataDirLease,
    path: &Path,
    namespace: AuthorityNamespace,
    identity: &FilesystemObjectIdentity,
) -> Result<(), AuthorityPathError> {
    revalidate_lease(lease)?;
    let other = match namespace {
        AuthorityNamespace::Rovai => AuthorityNamespace::Lumen,
        AuthorityNamespace::Lumen => AuthorityNamespace::Rovai,
    };
    let other = observe_namespace(lease, other).map_err(observation_to_path_error)?;
    let actual = match FilesystemObjectIdentity::observe(path) {
        Ok(actual) => Some(actual),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::InvalidData
            ) =>
        {
            None
        }
        Err(error) if io_error_is_transient(&error) => {
            return Err(AuthorityPathError::Infrastructure(
                AdmissionInfrastructureError::filesystem("inspect selected database", path, &error),
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            return Err(AuthorityPathError::Blocked(Box::new(
                AuthorityBlock::PermissionDenied {
                    path: path.to_path_buf(),
                    operation: "inspect selected database".into(),
                },
            )));
        }
        Err(error) => {
            return Err(AuthorityPathError::Infrastructure(
                AdmissionInfrastructureError::filesystem("inspect selected database", path, &error),
            ));
        }
    };
    if actual.as_ref() == Some(identity)
        && other.main.is_none()
        && other.authoritative_sidecars().is_empty()
    {
        Ok(())
    } else {
        Err(AuthorityPathError::Blocked(Box::new(
            AuthorityBlock::IdentityChanged {
                target: path.to_path_buf(),
                stage: BusyStage::Revalidation,
            },
        )))
    }
}

fn revalidate_lease(lease: &CoreDataDirLease) -> Result<(), AuthorityPathError> {
    match lease.revalidate_identity() {
        Ok(true) => Ok(()),
        Ok(false) => Err(AuthorityPathError::Blocked(Box::new(
            AuthorityBlock::DataDirectoryIdentityChanged,
        ))),
        Err(error) => Err(AuthorityPathError::Infrastructure(
            AdmissionInfrastructureError::filesystem(
                "revalidate data-directory identity",
                lease.data_dir(),
                &error,
            ),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core_data_dir_lock::CoreDataDirLease;
    use crate::db::classify_database_contract;
    use std::process::{Child, Command, Stdio};

    #[cfg(target_os = "macos")]
    fn attach_macos_provenance(path: &Path) {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};

        let path = CString::new(path.as_os_str().as_bytes()).unwrap();
        let value = [1_u8, 2_u8];
        assert_eq!(
            unsafe {
                libc::setxattr(
                    path.as_ptr(),
                    c"com.apple.provenance".as_ptr(),
                    value.as_ptr().cast(),
                    value.len(),
                    0,
                    0,
                )
            },
            0
        );
    }

    #[test]
    fn legacy_rename_explains_only_ctime_not_replacement_or_content_changes() {
        let before = AuthorityArtifactIdentityToken {
            object_key: "device:inode".to_string(),
            byte_length: 4096,
            state_key: "10:123:11:456".to_string(),
        };
        assert!(before.matches_legacy_rename(&before));
        let mut renamed = before.clone();
        renamed.state_key = "10:123:12:789".to_string();
        assert_eq!(renamed.matches_legacy_rename(&before), cfg!(unix));
        assert_ne!(
            renamed, before,
            "legacy recovery distinguishes rename from unchanged files"
        );
        for changed in ["object", "length", "mtime", "malformed"] {
            let mut after = renamed.clone();
            match changed {
                "object" => after.object_key.push_str("-replaced"),
                "length" => after.byte_length += 1,
                "mtime" => after.state_key = "10:124:12:789".to_string(),
                "malformed" => after.state_key = "10:123:12".to_string(),
                _ => unreachable!(),
            }
            assert!(!after.matches_legacy_rename(&before), "{changed}");
        }
    }

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            Self(std::env::temp_dir().join(format!(
                "rovai-database-admission-{label}-{}",
                uuid::Uuid::new_v4()
            )))
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    struct CrashWriter(Child);

    impl Drop for CrashWriter {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    // This process seam owns SQLite crash recovery, not migration-switch recovery:
    // dropping a Connection would roll back cleanly and could never expose this regression.
    #[test]
    fn crashed_sqlite_writer_is_recovered_and_readmitted() {
        for (mode, namespace) in [
            ("DELETE", AuthorityNamespace::Rovai),
            ("DELETE", AuthorityNamespace::Lumen),
            ("WAL", AuthorityNamespace::Rovai),
        ] {
            let directory = TestDirectory::new("crashed-writer");
            crate::platform::private_storage::prepare_private_directory(&directory.0).unwrap();
            let database = crate::test_support::fresh_schema_database_fast_at(&directory.0);
            database.connection().execute_batch(
                "CREATE TABLE admission_recovery_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL);",
            ).unwrap();
            for id in 0..8 {
                database.connection().execute(
                    "INSERT INTO admission_recovery_probe VALUES (?1, 'committed-' || hex(zeroblob(4096)))",
                    [id],
                ).unwrap();
            }
            drop(database);
            let path = directory.0.join(namespace.main_file_name());
            if namespace == AuthorityNamespace::Lumen {
                std::fs::rename(directory.0.join("rovai.sqlite"), &path).unwrap();
            }
            let marker = directory.0.join("writer-active.test-marker");
            let mut child = CrashWriter(
                Command::new(std::env::current_exe().unwrap())
                    .args([
                        "--exact",
                        "database_admission::tests::sqlite_crash_writer_helper",
                        "--nocapture",
                    ])
                    .env("ROVAI_SQLITE_CRASH_TEST_DATA_DIR", &directory.0)
                    .env("ROVAI_SQLITE_CRASH_TEST_JOURNAL_MODE", mode)
                    .stdout(Stdio::null())
                    .stderr(Stdio::inherit())
                    .spawn()
                    .unwrap(),
            );
            let deadline = std::time::Instant::now() + Duration::from_secs(20);
            while !marker.exists() {
                assert!(
                    child.0.try_wait().unwrap().is_none(),
                    "writer exited before its transaction was interrupted"
                );
                assert!(
                    std::time::Instant::now() < deadline,
                    "writer did not reach its active transaction"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
            child.0.kill().unwrap();
            assert!(!child.0.wait().unwrap().success());
            drop(child);

            if mode == "DELETE" {
                let read_only =
                    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
                let error = classify_database_contract(&read_only).unwrap_err();
                assert!(matches!(error, rusqlite::Error::SqliteFailure(sqlite, _)
                    if sqlite.extended_code == rusqlite::ffi::SQLITE_READONLY_ROLLBACK));
            }
            let lease = CoreDataDirLease::acquire(&directory.0).unwrap();
            let reopened = match DatabaseAdmission::assess(&lease).unwrap() {
                AdmissionAssessment::AdmittedExisting(ticket) => {
                    crate::db::Database::open_admitted(*ticket).unwrap()
                }
                other => {
                    panic!("SQLite must recover and readmit {namespace:?}/{mode}, got {other:?}")
                }
            };
            crate::test_support::assert_production_database_configuration(&reopened);
            let committed: i64 = reopened
                .connection()
                .query_row(
                    "SELECT count(*) FROM admission_recovery_probe WHERE value LIKE 'committed-%'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                committed, 8,
                "the interrupted transaction must not replace committed data"
            );
            let integrity: String = reopened
                .connection()
                .query_row("PRAGMA quick_check", [], |row| row.get(0))
                .unwrap();
            assert_eq!(integrity, "ok");
            assert_eq!(
                reopened.path(),
                lease.data_dir().join(namespace.main_file_name())
            );
            if namespace == AuthorityNamespace::Lumen {
                assert!(!directory.0.join("rovai.sqlite").exists());
            }
        }
    }

    #[test]
    fn sqlite_crash_writer_helper() {
        let Some(directory) = std::env::var_os("ROVAI_SQLITE_CRASH_TEST_DATA_DIR") else {
            return;
        };
        let directory = PathBuf::from(directory);
        // Only the parent exercises Core admission. This child owns a live SQLite
        // write transaction; opening Core here makes its handshake depend on
        // unrelated startup work when the full test suite runs concurrently.
        let path = directory.join(if directory.join("lumen.sqlite").exists() {
            "lumen.sqlite"
        } else {
            "rovai.sqlite"
        });
        let database = Connection::open(path).unwrap();
        let mode = std::env::var("ROVAI_SQLITE_CRASH_TEST_JOURNAL_MODE").unwrap();
        assert!(matches!(mode.as_str(), "DELETE" | "WAL"));
        database
            .execute_batch(&format!(
            "PRAGMA journal_mode = {mode}; PRAGMA synchronous = FULL; PRAGMA wal_autocheckpoint = 0;
             PRAGMA cache_size = 5; PRAGMA cache_spill = ON;
             BEGIN IMMEDIATE;
             UPDATE admission_recovery_probe SET value = 'uncommitted-' || hex(zeroblob(4096));"
        ))
            .unwrap();
        std::fs::write(directory.join("writer-active.test-marker"), b"active").unwrap();
        loop {
            std::thread::park();
        }
    }

    #[test]
    fn confirmed_absence_is_initializable_without_creating_a_database() {
        let directory = TestDirectory::new("absent");
        let lease = CoreDataDirLease::acquire(&directory.0).unwrap();

        assert!(matches!(
            DatabaseAdmission::assess(&lease).unwrap(),
            AdmissionAssessment::Initializable(_)
        ));
        assert!(!directory.0.join("rovai.sqlite").exists());
        assert!(!directory.0.join("lumen.sqlite").exists());
    }

    #[test]
    fn orphan_authoritative_logs_block_initialization_without_deletion() {
        for name in [
            "rovai.sqlite-wal",
            "rovai.sqlite-journal",
            "lumen.sqlite-wal",
            "lumen.sqlite-journal",
        ] {
            let directory = TestDirectory::new("orphan-log");
            let lease = CoreDataDirLease::acquire(&directory.0).unwrap();
            let path = directory.0.join(name);
            std::fs::write(&path, b"retained authority").unwrap();
            assert!(matches!(DatabaseAdmission::assess(&lease).unwrap(),
                AdmissionAssessment::Blocked(block)
                    if matches!(*block, AuthorityBlock::IncompleteAuthorityArtifacts { .. })));
            assert!(!directory.0.join("rovai.sqlite").exists());
            assert!(!directory.0.join("lumen.sqlite").exists());
            assert_eq!(std::fs::read(path).unwrap(), b"retained authority");
        }
    }

    #[test]
    fn orphan_shm_is_cleaned_only_for_confirmed_initialization() {
        let directory = TestDirectory::new("orphan-shm");
        let lease = CoreDataDirLease::acquire(&directory.0).unwrap();
        let shm = directory.0.join("rovai.sqlite-shm");
        std::fs::write(&shm, b"ephemeral").unwrap();

        let AdmissionAssessment::Initializable(ticket) = DatabaseAdmission::assess(&lease).unwrap()
        else {
            panic!("orphan SHM alone must remain initializable");
        };
        let open = ticket.into_initialization().unwrap();
        assert_eq!(open.path, lease.data_dir().join("rovai.sqlite"));
        assert!(!shm.exists());
        assert!(!open.path.exists());
    }

    #[test]
    fn a_lumen_main_never_causes_a_rovai_main_to_be_created_during_assessment() {
        let directory = TestDirectory::new("lumen-exact-target");
        let lease = CoreDataDirLease::acquire(&directory.0).unwrap();
        Connection::open(directory.0.join("lumen.sqlite")).unwrap();

        assert!(matches!(
            DatabaseAdmission::assess(&lease).unwrap(),
            AdmissionAssessment::Blocked(block)
                if matches!(*block, AuthorityBlock::UnknownDataContract { .. })
        ));
        assert!(!directory.0.join("rovai.sqlite").exists());
    }

    #[test]
    fn new_authority_open_refuses_a_canonical_target_that_appears_before_publish() {
        let directory = TestDirectory::new("initialize-publish-race");
        let lease = CoreDataDirLease::acquire(&directory.0).unwrap();
        let AdmissionAssessment::Initializable(ticket) = DatabaseAdmission::assess(&lease).unwrap()
        else {
            panic!("empty data directory must be initializable");
        };
        let open = ticket.into_initialization().unwrap();
        std::fs::write(&open.path, b"concurrent authority").unwrap();

        assert!(matches!(
            open.revalidate_absence(),
            Err(AuthorityPathError::Blocked(block))
                if matches!(*block, AuthorityBlock::IdentityChanged { .. })
        ));
        assert_eq!(std::fs::read(&open.path).unwrap(), b"concurrent authority");
    }

    #[test]
    fn confirmed_absence_initializes_and_reopens_a_current_authority() {
        let directory = TestDirectory::new("initialize-current");
        let lease = CoreDataDirLease::acquire(&directory.0).unwrap();
        let AdmissionAssessment::Initializable(ticket) = DatabaseAdmission::assess(&lease).unwrap()
        else {
            panic!("empty data directory must be initializable");
        };
        let initialized = crate::db::Database::initialize_new(*ticket).unwrap();
        crate::test_support::assert_production_database_configuration(&initialized);
        assert_eq!(initialized.path(), lease.data_dir().join("rovai.sqlite"));
        assert!(matches!(
            classify_database_contract(initialized.connection()).unwrap(),
            DatabaseContractClassification::Current(_)
        ));
        initialized
            .connection()
            .execute(
                "UPDATE agent_profile SET display_name = '保留的队员' WHERE id = 'agent_1'",
                [],
            )
            .unwrap();

        #[cfg(target_os = "macos")]
        {
            let wal = directory.0.join("rovai.sqlite-wal");
            attach_macos_provenance(&wal);
            attach_macos_provenance(initialized.path());
            let AdmissionAssessment::AdmittedExisting(open) =
                DatabaseAdmission::assess(&lease).unwrap()
            else {
                panic!("metadata changes must open on the first attempt");
            };
            // Neither an unrelated xattr nor a committed WAL update invalidates
            // the live connection. SQLite supplies the current committed rows.
            initialized.connection().execute("UPDATE agent_profile SET display_name = '保留的队员（更新）' WHERE id = 'agent_1'", []).unwrap();
            attach_macos_provenance(initialized.path());
            let reopened = crate::db::Database::open_admitted(*open).unwrap();
            assert_eq!(
                reopened
                    .connection()
                    .query_row(
                        "SELECT display_name FROM agent_profile WHERE id = 'agent_1'",
                        [],
                        |row| row.get::<_, String>(0)
                    )
                    .unwrap(),
                "保留的队员（更新）"
            );
        }
        drop(initialized);
        drop(lease);
        #[cfg(windows)]
        assert_windows_ordinary_permissions(&directory.0);
        let lease = CoreDataDirLease::acquire(&directory.0).unwrap();

        let ticket = match DatabaseAdmission::assess(&lease).unwrap() {
            AdmissionAssessment::AdmittedExisting(ticket) => ticket,
            other => panic!("new authority must reopen normally, got {other:?}"),
        };
        ticket
            .connection
            .execute_batch(
                "CREATE TEMP TABLE same_connection (value); INSERT INTO same_connection VALUES (1)",
            )
            .unwrap();
        let reopened = crate::db::Database::open_admitted(*ticket).unwrap();
        assert_eq!(
            reopened
                .connection()
                .query_row("SELECT value FROM same_connection", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1,
            "opening/configuration must retain the already-open SQLite connection"
        );
        crate::test_support::assert_production_database_configuration(&reopened);
        assert_eq!(reopened.path(), lease.data_dir().join("rovai.sqlite"));
        let display_name: String = reopened
            .connection()
            .query_row(
                "SELECT display_name FROM agent_profile WHERE id = 'agent_1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            display_name,
            if cfg!(target_os = "macos") {
                "保留的队员（更新）"
            } else {
                "保留的队员"
            }
        );

        drop(reopened);
        let path = directory.0.join("rovai.sqlite");
        let writer = Connection::open(&path).unwrap();
        writer
            .execute_batch("PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE")
            .unwrap();
        let releasing = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(250));
            writer.execute_batch("ROLLBACK").unwrap();
        });
        let AdmissionAssessment::AdmittedExisting(open) =
            DatabaseAdmission::assess(&lease).unwrap()
        else {
            panic!("SQLite must wait for a short lock without user retry");
        };
        releasing.join().unwrap();
        drop(crate::db::Database::open_admitted(*open).unwrap());
        let writer = Connection::open(&path).unwrap();
        writer
            .execute_batch("PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE")
            .unwrap();
        assert!(
            matches!(DatabaseAdmission::assess(&lease).unwrap(), AdmissionAssessment::Blocked(block)
            if matches!(*block, AuthorityBlock::Busy { .. }))
        );
        writer.execute_batch("ROLLBACK").unwrap();
        writer
            .execute_batch("PRAGMA journal_mode=WAL; BEGIN IMMEDIATE")
            .unwrap();
        let AdmissionAssessment::AdmittedExisting(open) =
            DatabaseAdmission::assess(&lease).unwrap()
        else {
            panic!("a WAL writer permits version reads");
        };
        let error = crate::db::Database::open_admitted(*open)
            .err()
            .expect("held WAL writer must block startup writes");
        assert!(
            error.retryable(),
            "WAL write contention must remain retryable: {error}"
        );
        writer
            .execute_batch("ROLLBACK; PRAGMA journal_mode=DELETE")
            .unwrap();
        // These are recovery outcomes, never permission to replace the database.
        let source = std::fs::read(&path).unwrap();
        for problem in ["future", "unfinished", "ambiguous", "corrupt"] {
            match problem {
                "future" => {
                    writer
                        .execute(
                            "UPDATE rovai_data_contract SET projection_schema_version=99999",
                            [],
                        )
                        .unwrap();
                }
                "unfinished" => {
                    writer
                        .execute(
                            "UPDATE rovai_data_contract SET projection_schema_version=?1",
                            [crate::db::CURRENT_PROJECTION_SCHEMA_VERSION],
                        )
                        .unwrap();
                    writer
                        .execute("DELETE FROM schema_migration WHERE version=218", [])
                        .unwrap();
                }
                "ambiguous" => {
                    std::fs::write(directory.0.join("lumen.sqlite"), b"other authority").unwrap();
                }
                "corrupt" => {
                    std::fs::write(&path, b"retained corrupt database").unwrap();
                }
                _ => unreachable!(),
            }
            let before = std::fs::read(&path).unwrap();
            assert!(
                matches!(
                    DatabaseAdmission::assess(&lease).unwrap(),
                    AdmissionAssessment::Blocked(_)
                ),
                "{problem}"
            );
            assert_eq!(std::fs::read(&path).unwrap(), before, "{problem}");
            if problem == "ambiguous" {
                std::fs::remove_file(directory.0.join("lumen.sqlite")).unwrap();
            }
        }
        drop(writer);
        std::fs::write(&path, source).unwrap();
    }

    #[cfg(windows)]
    fn assert_windows_ordinary_permissions(root: &Path) {
        use std::os::windows::{fs::OpenOptionsExt, process::CommandExt};
        use windows_sys::Win32::{
            Storage::FileSystem::{FILE_FLAG_BACKUP_SEMANTICS, WRITE_DAC},
            System::Threading::CREATE_NO_WINDOW,
        };
        let system = PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32");
        let output = Command::new(system.join("whoami.exe"))
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .unwrap();
        assert!(output.status.success());
        let user = String::from_utf8(output.stdout).unwrap().trim().to_owned();
        let acl = |path: &Path, args: &[&str]| {
            let output = Command::new(system.join("icacls.exe"))
                .arg(path)
                .args(args)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "ACL fixture failed for {path:?} {args:?}: {output:?}"
            );
            output.stdout
        };
        let main = root.join("rovai.sqlite");
        for permissions in ["inherited", "extra-entry", "modify-only"] {
            match permissions {
                "inherited" => {
                    acl(root, &["/reset", "/T", "/Q"]);
                }
                "extra-entry" => {
                    acl(root, &["/grant", "*S-1-1-0:(OI)(CI)R", "/T", "/Q"]);
                }
                "modify-only" => {
                    // Finish each leaf before the parent; recursive ACL edits
                    // could inherit a deny before the next child is prepared.
                    // Install WDAC deny as the LAST ACL write, while preserving
                    // normal file I/O regardless of runner group membership.
                    let lock = root.join(crate::core_data_dir_lock::CORE_DATA_DIR_LOCK_FILE);
                    for (path, mask) in [
                        (main.as_path(), "F"),
                        (lock.as_path(), "F"),
                        (root, "(OI)(CI)F"),
                    ] {
                        acl(
                            path,
                            &[
                                "/grant:r",
                                &format!("{user}:{mask}"),
                                &format!("*S-1-3-4:{mask}"),
                                "/Q",
                            ],
                        );
                        acl(path, &["/inheritance:r", "/Q"]);
                        acl(path, &["/deny", &format!("{user}:(WDAC)"), "/Q"]);
                    }
                    for path in [root, main.as_path()] {
                        let denied = std::fs::OpenOptions::new()
                            .access_mode(WRITE_DAC)
                            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
                            .open(path)
                            .unwrap_err();
                        assert_eq!(denied.kind(), io::ErrorKind::PermissionDenied);
                    }
                }
                _ => unreachable!(),
            }
            let before = [acl(root, &[]), acl(&main, &[])];
            let lease = CoreDataDirLease::acquire(root).unwrap();
            let AdmissionAssessment::AdmittedExisting(open) =
                DatabaseAdmission::assess(&lease).unwrap()
            else {
                panic!("{permissions}: usable existing database must open");
            };
            let database = crate::db::Database::open_admitted(*open).unwrap();
            database
                .connection()
                .execute(
                    "UPDATE agent_profile SET display_name=display_name WHERE id='agent_1'",
                    [],
                )
                .unwrap();
            assert_eq!(
                database
                    .connection()
                    .query_row(
                        "SELECT display_name FROM agent_profile WHERE id='agent_1'",
                        [],
                        |r| r.get::<_, String>(0)
                    )
                    .unwrap(),
                "保留的队员"
            );
            assert!(CoreDataDirLease::acquire(root).is_err());
            drop(database);
            drop(lease);
            assert_eq!(
                [acl(root, &[]), acl(&main, &[])],
                before,
                "startup must not rewrite ACLs"
            );
        }
        let mut permissions = std::fs::metadata(&main).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&main, permissions.clone()).unwrap();
        let before = std::fs::read(&main).unwrap();
        let lease = CoreDataDirLease::acquire(root).unwrap();
        match DatabaseAdmission::assess(&lease).unwrap() {
            AdmissionAssessment::Blocked(_) => {}
            AdmissionAssessment::AdmittedExisting(open) => {
                assert!(crate::db::Database::open_admitted(*open).is_err());
            }
            other => panic!("read-only existing data must never initialize: {other:?}"),
        }
        assert_eq!(std::fs::read(&main).unwrap(), before);
        permissions.set_readonly(false);
        std::fs::set_permissions(main, permissions).unwrap();
    }

    #[test]
    fn a_current_lumen_database_opens_exactly_without_creating_rovai() {
        let directory = TestDirectory::new("current-lumen-exact");
        let lease = CoreDataDirLease::acquire(&directory.0).unwrap();
        let AdmissionAssessment::Initializable(ticket) = DatabaseAdmission::assess(&lease).unwrap()
        else {
            panic!("empty data directory must be initializable");
        };
        drop(crate::db::Database::initialize_new(*ticket).unwrap());
        std::fs::rename(
            lease.data_dir().join("rovai.sqlite"),
            lease.data_dir().join("lumen.sqlite"),
        )
        .unwrap();

        let AdmissionAssessment::AdmittedExisting(ticket) =
            DatabaseAdmission::assess(&lease).unwrap()
        else {
            panic!("current legacy-named authority must be admitted exactly");
        };
        let database = crate::db::Database::open_admitted(*ticket).unwrap();
        assert_eq!(database.path(), lease.data_dir().join("lumen.sqlite"));
        assert!(!lease.data_dir().join("rovai.sqlite").exists());
    }
}
