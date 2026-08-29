use std::{
    io,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{Connection, ErrorCode, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::{
    core_data_dir_lock::{CoreDataDirLease, FilesystemObjectIdentity},
    db::{DatabaseContractClassification, DatabaseContractMarker, classify_database_contract},
};

const AUTHORITY_BUSY_TIMEOUT: Duration = Duration::from_millis(250);
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
}

impl AdmissionInfrastructureError {
    fn filesystem(operation: &str, path: &Path, error: &io::Error) -> Self {
        Self {
            code: "authority_admission_filesystem_failed".to_string(),
            message: format!("failed to {operation} {}: {error}", path.display()),
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
pub enum TicketValidationError {
    Blocked(Box<AuthorityBlock>),
    Infrastructure(AdmissionInfrastructureError),
}

impl std::fmt::Display for TicketValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Blocked(block) => write!(formatter, "authority ticket was blocked: {block:?}"),
            Self::Infrastructure(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for TicketValidationError {}

#[derive(Debug)]
pub enum AdmissionAssessment<'lease> {
    AdmittedExisting(Box<ExistingAuthorityTicket<'lease>>),
    Initializable(Box<NewAuthorityTicket<'lease>>),
    RequiresMigration(Box<MigrationAuthorityTicket<'lease>>),
    Blocked(Box<AuthorityBlock>),
}

#[derive(Debug)]
pub struct ExistingAuthorityTicket<'lease> {
    lease: &'lease CoreDataDirLease,
    namespace: AuthorityNamespace,
    artifacts: NamespaceArtifactSet,
}

#[derive(Debug)]
pub struct NewAuthorityTicket<'lease> {
    lease: &'lease CoreDataDirLease,
    observed: CompleteArtifactObservation,
}

#[derive(Debug)]
pub struct MigrationAuthorityTicket<'lease> {
    lease: &'lease CoreDataDirLease,
    state: MigrationTicketState,
}

#[derive(Debug)]
enum MigrationTicketState {
    Upgrade {
        namespace: AuthorityNamespace,
        artifacts: Box<NamespaceArtifactSet>,
        source_contract: DatabaseContractMarker,
    },
    Interrupted {
        manifest: PathBuf,
    },
}

#[derive(Debug)]
pub(crate) struct ExistingAuthorityOpen<'lease> {
    lease: &'lease CoreDataDirLease,
    pub path: PathBuf,
    artifacts: NamespaceArtifactSet,
}

#[derive(Debug)]
pub(crate) struct NewAuthorityOpen<'lease> {
    lease: &'lease CoreDataDirLease,
    pub path: PathBuf,
}

#[derive(Debug)]
pub(crate) enum MigrationAuthorityOpen<'lease> {
    Upgrade {
        lease: &'lease CoreDataDirLease,
        path: PathBuf,
        namespace: AuthorityNamespace,
        source_contract: DatabaseContractMarker,
        artifacts: Box<NamespaceArtifactSet>,
    },
    Interrupted {
        lease: &'lease CoreDataDirLease,
        manifest: PathBuf,
    },
}

impl<'lease> ExistingAuthorityTicket<'lease> {
    pub(crate) fn into_open(self) -> Result<ExistingAuthorityOpen<'lease>, TicketValidationError> {
        debug_assert_eq!(self.namespace, self.artifacts.namespace);
        revalidate_lease(self.lease)?;
        revalidate_namespace_artifacts(self.lease, &self.artifacts, BusyStage::Revalidation)?;
        Ok(ExistingAuthorityOpen {
            lease: self.lease,
            path: self.artifacts.main_path(),
            artifacts: self.artifacts,
        })
    }
}

impl ExistingAuthorityOpen<'_> {
    pub(crate) fn revalidate(&self) -> Result<(), TicketValidationError> {
        revalidate_lease(self.lease)?;
        revalidate_namespace_artifacts(self.lease, &self.artifacts, BusyStage::Revalidation)
    }
}

impl<'lease> NewAuthorityTicket<'lease> {
    pub(crate) fn into_initialization(
        self,
    ) -> Result<NewAuthorityOpen<'lease>, TicketValidationError> {
        revalidate_lease(self.lease)?;
        let current = observe_all(self.lease).map_err(observation_to_ticket_error)?;
        if current.rovai.main.is_some()
            || current.lumen.main.is_some()
            || current.rovai.wal.is_some()
            || current.lumen.wal.is_some()
            || current.rovai.rollback_journal.is_some()
            || current.lumen.rollback_journal.is_some()
        {
            return Err(TicketValidationError::Blocked(Box::new(
                AuthorityBlock::IdentityChanged {
                    target: self.lease.data_dir().to_path_buf(),
                    stage: BusyStage::Revalidation,
                },
            )));
        }
        revalidate_optional_shm(&self.observed.rovai.shm, &current.rovai.shm)?;
        revalidate_optional_shm(&self.observed.lumen.shm, &current.lumen.shm)?;
        for shm in [current.rovai.shm, current.lumen.shm].into_iter().flatten() {
            std::fs::remove_file(&shm.path).map_err(|error| {
                TicketValidationError::Infrastructure(AdmissionInfrastructureError::filesystem(
                    "remove confirmed orphan SHM",
                    &shm.path,
                    &error,
                ))
            })?;
        }
        let final_observation = observe_all(self.lease).map_err(observation_to_ticket_error)?;
        if !final_observation.has_no_authority_artifacts() {
            return Err(TicketValidationError::Blocked(Box::new(
                AuthorityBlock::IdentityChanged {
                    target: self.lease.data_dir().to_path_buf(),
                    stage: BusyStage::Revalidation,
                },
            )));
        }
        Ok(NewAuthorityOpen {
            lease: self.lease,
            path: self
                .lease
                .data_dir()
                .join(AuthorityNamespace::Rovai.main_file_name()),
        })
    }
}

impl NewAuthorityOpen<'_> {
    pub(crate) fn revalidate_absence(&self) -> Result<(), TicketValidationError> {
        revalidate_lease(self.lease)?;
        let current = observe_all(self.lease).map_err(observation_to_ticket_error)?;
        if current.has_no_authority_artifacts() {
            Ok(())
        } else {
            Err(TicketValidationError::Blocked(Box::new(
                AuthorityBlock::IdentityChanged {
                    target: self.lease.data_dir().to_path_buf(),
                    stage: BusyStage::Revalidation,
                },
            )))
        }
    }
}

impl<'lease> MigrationAuthorityTicket<'lease> {
    pub(crate) fn into_migration(
        self,
    ) -> Result<MigrationAuthorityOpen<'lease>, TicketValidationError> {
        revalidate_lease(self.lease)?;
        match self.state {
            MigrationTicketState::Upgrade {
                namespace,
                artifacts,
                source_contract,
            } => {
                revalidate_namespace_artifacts(self.lease, &artifacts, BusyStage::Revalidation)?;
                Ok(MigrationAuthorityOpen::Upgrade {
                    lease: self.lease,
                    path: artifacts.main_path(),
                    namespace,
                    source_contract,
                    artifacts,
                })
            }
            MigrationTicketState::Interrupted { manifest } => {
                let metadata = std::fs::symlink_metadata(&manifest).map_err(|error| {
                    TicketValidationError::Infrastructure(AdmissionInfrastructureError::filesystem(
                        "revalidate migration manifest",
                        &manifest,
                        &error,
                    ))
                })?;
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(TicketValidationError::Blocked(Box::new(
                        AuthorityBlock::MigrationRecoveryRequired {
                            manifest,
                            message: "migration manifest is not a regular file".to_string(),
                        },
                    )));
                }
                Ok(MigrationAuthorityOpen::Interrupted {
                    lease: self.lease,
                    manifest,
                })
            }
        }
    }
}

impl MigrationAuthorityOpen<'_> {
    pub(crate) fn revalidate(&self) -> Result<(), TicketValidationError> {
        match self {
            Self::Upgrade {
                lease, artifacts, ..
            } => {
                revalidate_lease(lease)?;
                revalidate_namespace_artifacts(lease, artifacts, BusyStage::Revalidation)
            }
            Self::Interrupted { lease, manifest } => {
                revalidate_lease(lease)?;
                if manifest.is_file() {
                    Ok(())
                } else {
                    Err(TicketValidationError::Blocked(Box::new(
                        AuthorityBlock::MigrationRecoveryRequired {
                            manifest: manifest.clone(),
                            message: "migration manifest disappeared before recovery".to_string(),
                        },
                    )))
                }
            }
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
                    MigrationAuthorityTicket {
                        lease,
                        state: MigrationTicketState::Interrupted {
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
                NewAuthorityTicket { lease, observed },
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

        let classification = match probe_contract(artifacts) {
            Ok(classification) => classification,
            Err(block) => return Ok(AdmissionAssessment::Blocked(Box::new(block))),
        };
        let refreshed = match observe_namespace(lease, namespace) {
            Ok(refreshed) => refreshed,
            Err(ObservationFailure::Blocked(block)) => {
                return Ok(AdmissionAssessment::Blocked(Box::new(block)));
            }
            Err(ObservationFailure::Infrastructure(error)) => return Err(error),
        };
        if artifacts.main.as_ref().map(|artifact| &artifact.identity)
            != refreshed.main.as_ref().map(|artifact| &artifact.identity)
            || artifacts.wal.as_ref().map(|artifact| &artifact.identity)
                != refreshed.wal.as_ref().map(|artifact| &artifact.identity)
            || artifacts
                .rollback_journal
                .as_ref()
                .map(|artifact| &artifact.identity)
                != refreshed
                    .rollback_journal
                    .as_ref()
                    .map(|artifact| &artifact.identity)
        {
            return Ok(AdmissionAssessment::Blocked(Box::new(
                AuthorityBlock::IdentityChanged {
                    target: artifacts.main_path(),
                    stage: BusyStage::Revalidation,
                },
            )));
        }

        match classification {
            DatabaseContractClassification::Current(_) => Ok(
                AdmissionAssessment::AdmittedExisting(Box::new(ExistingAuthorityTicket {
                    lease,
                    namespace,
                    artifacts: refreshed,
                })),
            ),
            DatabaseContractClassification::SupportedMigrationSource(source_contract) => Ok(
                AdmissionAssessment::RequiresMigration(Box::new(MigrationAuthorityTicket {
                    lease,
                    state: MigrationTicketState::Upgrade {
                        namespace,
                        artifacts: Box::new(refreshed),
                        source_contract,
                    },
                })),
            ),
            DatabaseContractClassification::Unknown(marker) => Ok(AdmissionAssessment::Blocked(
                Box::new(unknown_contract_block(artifacts.main_path(), marker)),
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ArtifactIdentity {
    object: FilesystemObjectIdentity,
    byte_length: u64,
    state_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthorityArtifactIdentityToken {
    object_key: String,
    byte_length: u64,
    state_key: String,
}

#[derive(Debug, Clone)]
struct ObservedArtifact {
    namespace: AuthorityNamespace,
    kind: AuthorityArtifactKind,
    path: PathBuf,
    identity: ArtifactIdentity,
}

impl ObservedArtifact {
    fn summary(&self) -> AuthorityArtifactSummary {
        AuthorityArtifactSummary {
            namespace: self.namespace,
            kind: self.kind,
            path: self.path.clone(),
            byte_length: self.identity.byte_length,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct NamespaceArtifactSet {
    namespace: AuthorityNamespace,
    main: Option<ObservedArtifact>,
    wal: Option<ObservedArtifact>,
    rollback_journal: Option<ObservedArtifact>,
    shm: Option<ObservedArtifact>,
}

impl NamespaceArtifactSet {
    fn main_path(&self) -> PathBuf {
        self.main
            .as_ref()
            .expect("authority ticket always contains a main-file identity")
            .path
            .clone()
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

fn observation_to_ticket_error(error: ObservationFailure) -> TicketValidationError {
    match error {
        ObservationFailure::Blocked(block) => TicketValidationError::Blocked(Box::new(block)),
        ObservationFailure::Infrastructure(error) => TicketValidationError::Infrastructure(error),
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
        namespace,
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
    let object = FilesystemObjectIdentity::observe(&path).map_err(|error| {
        ObservationFailure::Infrastructure(AdmissionInfrastructureError::filesystem(
            "observe authority artifact identity",
            &path,
            &error,
        ))
    })?;
    Ok(Some(ObservedArtifact {
        namespace,
        kind,
        path,
        identity: ArtifactIdentity {
            object,
            byte_length: metadata.len(),
            state_key: artifact_state_key(&metadata),
        },
    }))
}

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

fn probe_contract(
    artifacts: &NamespaceArtifactSet,
) -> Result<DatabaseContractClassification, AuthorityBlock> {
    let target = artifacts.main_path();
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY
        | OpenFlags::SQLITE_OPEN_NO_MUTEX
        | OpenFlags::SQLITE_OPEN_NOFOLLOW;
    let connection = Connection::open_with_flags(&target, flags)
        .map_err(|error| sqlite_block(&target, BusyStage::Open, artifacts.wal.is_some(), error))?;
    connection
        .busy_timeout(AUTHORITY_BUSY_TIMEOUT)
        .map_err(|error| sqlite_block(&target, BusyStage::Open, artifacts.wal.is_some(), error))?;
    connection
        .execute_batch("PRAGMA query_only = ON; PRAGMA foreign_keys = ON;")
        .map_err(|error| {
            sqlite_block(
                &target,
                BusyStage::ContractQuery,
                artifacts.wal.is_some(),
                error,
            )
        })?;
    classify_database_contract(&connection).map_err(|error| {
        sqlite_block(
            &target,
            BusyStage::ContractQuery,
            artifacts.wal.is_some(),
            error,
        )
    })
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
    if matches!(
        code,
        Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
    ) {
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

fn revalidate_lease(lease: &CoreDataDirLease) -> Result<(), TicketValidationError> {
    match lease.revalidate_identity() {
        Ok(true) => Ok(()),
        Ok(false) => Err(TicketValidationError::Blocked(Box::new(
            AuthorityBlock::DataDirectoryIdentityChanged,
        ))),
        Err(error) => Err(TicketValidationError::Infrastructure(
            AdmissionInfrastructureError::filesystem(
                "revalidate data-directory identity",
                lease.data_dir(),
                &error,
            ),
        )),
    }
}

fn revalidate_namespace_artifacts(
    lease: &CoreDataDirLease,
    expected: &NamespaceArtifactSet,
    stage: BusyStage,
) -> Result<(), TicketValidationError> {
    let actual =
        observe_namespace(lease, expected.namespace).map_err(observation_to_ticket_error)?;
    let same = expected.main.as_ref().map(|artifact| &artifact.identity)
        == actual.main.as_ref().map(|artifact| &artifact.identity)
        && expected.wal.as_ref().map(|artifact| &artifact.identity)
            == actual.wal.as_ref().map(|artifact| &artifact.identity)
        && expected
            .rollback_journal
            .as_ref()
            .map(|artifact| &artifact.identity)
            == actual
                .rollback_journal
                .as_ref()
                .map(|artifact| &artifact.identity);
    if same {
        Ok(())
    } else {
        Err(TicketValidationError::Blocked(Box::new(
            AuthorityBlock::IdentityChanged {
                target: expected.main_path(),
                stage,
            },
        )))
    }
}

fn revalidate_optional_shm(
    expected: &Option<ObservedArtifact>,
    actual: &Option<ObservedArtifact>,
) -> Result<(), TicketValidationError> {
    if expected.as_ref().map(|artifact| &artifact.identity)
        == actual.as_ref().map(|artifact| &artifact.identity)
    {
        Ok(())
    } else {
        let target = expected
            .as_ref()
            .or(actual.as_ref())
            .map(|artifact| artifact.path.clone())
            .unwrap_or_default();
        Err(TicketValidationError::Blocked(Box::new(
            AuthorityBlock::IdentityChanged {
                target,
                stage: BusyStage::Revalidation,
            },
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core_data_dir_lock::CoreDataDirLease;

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
    fn orphan_wal_blocks_initialization() {
        let directory = TestDirectory::new("orphan-wal");
        let lease = CoreDataDirLease::acquire(&directory.0).unwrap();
        std::fs::write(directory.0.join("rovai.sqlite-wal"), b"retained authority").unwrap();

        assert!(matches!(
            DatabaseAdmission::assess(&lease).unwrap(),
            AdmissionAssessment::Blocked(block)
                if matches!(*block, AuthorityBlock::IncompleteAuthorityArtifacts { .. })
        ));
        assert!(!directory.0.join("rovai.sqlite").exists());
    }

    #[test]
    fn orphan_shm_is_a_ticketed_initialization_cleanup() {
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
    fn changing_an_orphan_shm_invalidates_the_ticket_instead_of_deleting_it() {
        let directory = TestDirectory::new("shm-race");
        let lease = CoreDataDirLease::acquire(&directory.0).unwrap();
        let shm = directory.0.join("rovai.sqlite-shm");
        std::fs::write(&shm, b"first").unwrap();
        let AdmissionAssessment::Initializable(ticket) = DatabaseAdmission::assess(&lease).unwrap()
        else {
            panic!("orphan SHM alone must remain initializable");
        };
        std::fs::write(&shm, b"changed identity state").unwrap();

        assert!(matches!(
            ticket.into_initialization(),
            Err(TicketValidationError::Blocked(block))
                if matches!(*block, AuthorityBlock::IdentityChanged { .. })
        ));
        assert!(shm.exists());
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
            Err(TicketValidationError::Blocked(block))
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
        assert_eq!(initialized.path(), lease.data_dir().join("rovai.sqlite"));
        assert!(matches!(
            classify_database_contract(initialized.connection()).unwrap(),
            DatabaseContractClassification::Current(_)
        ));
        drop(initialized);

        let AdmissionAssessment::AdmittedExisting(ticket) =
            DatabaseAdmission::assess(&lease).unwrap()
        else {
            panic!("initialized authority must be admitted on restart");
        };
        let reopened = crate::db::Database::open_admitted(*ticket).unwrap();
        assert_eq!(reopened.path(), lease.data_dir().join("rovai.sqlite"));
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
