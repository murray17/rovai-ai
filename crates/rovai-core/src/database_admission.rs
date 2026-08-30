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
        Self::assess_with_recovery(lease, true)
    }

    fn assess_with_recovery<'lease>(
        lease: &'lease CoreDataDirLease,
        allow_recovery: bool,
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

        let classification = match probe_contract(artifacts, OpenFlags::SQLITE_OPEN_READ_ONLY) {
            Ok(classification) => classification,
            Err(error) => {
                if let Some(recovery) = error.recovery_kind() {
                    // One engine recovery per assessment. If a new writer makes
                    // recovery necessary again, retry admission rather than
                    // misreporting a read-only probe as a filesystem denial.
                    if !allow_recovery {
                        return Ok(AdmissionAssessment::Blocked(Box::new(
                            AuthorityBlock::Busy {
                                stage: BusyStage::Revalidation,
                            },
                        )));
                    }
                    match recover_sqlite_journal(lease, &observed, namespace, recovery) {
                        Ok(()) => return Self::assess_with_recovery(lease, false),
                        Err(ObservationFailure::Blocked(block)) => {
                            return Ok(AdmissionAssessment::Blocked(Box::new(block)));
                        }
                        Err(ObservationFailure::Infrastructure(error)) => return Err(error),
                    }
                }
                return Ok(AdmissionAssessment::Blocked(Box::new(
                    error.into_block(artifacts),
                )));
            }
        };
        let refreshed = match observe_namespace(lease, namespace) {
            Ok(refreshed) => refreshed,
            Err(ObservationFailure::Blocked(block)) => {
                return Ok(AdmissionAssessment::Blocked(Box::new(block)));
            }
            Err(ObservationFailure::Infrastructure(error)) => return Err(error),
        };
        if !artifacts.matches_read_probe(&refreshed) {
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
    fn authority_unchanged(&self, other: &Self) -> bool {
        [
            (&self.main, &other.main),
            (&self.wal, &other.wal),
            (&self.rollback_journal, &other.rollback_journal),
        ]
        .into_iter()
        .all(|(before, after)| {
            before.as_ref().map(|artifact| &artifact.identity)
                == after.as_ref().map(|artifact| &artifact.identity)
        })
    }

    fn matches_read_probe(&self, other: &Self) -> bool {
        if self.authority_unchanged(other) {
            return true;
        }
        // Reading a clean WAL-mode database can materialize an empty WAL and
        // rebuildable SHM. Only this absent -> zero-byte transition is benign:
        // main/journal must be identical, and existing WAL changes still fail.
        // Tickets retain the refreshed WAL identity and are revalidated strictly.
        self.main.is_some()
            && self.main.as_ref().map(|artifact| &artifact.identity)
                == other.main.as_ref().map(|artifact| &artifact.identity)
            && self
                .rollback_journal
                .as_ref()
                .map(|artifact| &artifact.identity)
                == other
                    .rollback_journal
                    .as_ref()
                    .map(|artifact| &artifact.identity)
            && self.wal.is_none()
            && other
                .wal
                .as_ref()
                .is_some_and(|artifact| artifact.identity.byte_length == 0)
    }

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
    fn namespace(&self, namespace: AuthorityNamespace) -> &NamespaceArtifactSet {
        match namespace {
            AuthorityNamespace::Rovai => &self.rovai,
            AuthorityNamespace::Lumen => &self.lumen,
        }
    }

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

#[derive(Debug, Clone, Copy)]
enum SqliteJournalRecovery {
    Rollback,
    Wal,
}

struct ContractProbeFailure {
    stage: BusyStage,
    error: rusqlite::Error,
}

impl ContractProbeFailure {
    fn recovery_kind(&self) -> Option<SqliteJournalRecovery> {
        match &self.error {
            rusqlite::Error::SqliteFailure(sqlite, _) => match sqlite.extended_code {
                rusqlite::ffi::SQLITE_READONLY_ROLLBACK => Some(SqliteJournalRecovery::Rollback),
                rusqlite::ffi::SQLITE_READONLY_RECOVERY => Some(SqliteJournalRecovery::Wal),
                _ => None,
            },
            _ => None,
        }
    }

    fn into_block(self, artifacts: &NamespaceArtifactSet) -> AuthorityBlock {
        sqlite_block(
            &artifacts.main_path(),
            self.stage,
            artifacts.wal.is_some(),
            self.error,
        )
    }
}

fn probe_contract(
    artifacts: &NamespaceArtifactSet,
    access: OpenFlags,
) -> Result<DatabaseContractClassification, ContractProbeFailure> {
    let target = artifacts.main_path();
    let flags = access | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_NOFOLLOW;
    let connection =
        Connection::open_with_flags(&target, flags).map_err(|error| ContractProbeFailure {
            stage: BusyStage::Open,
            error,
        })?;
    connection
        .busy_timeout(AUTHORITY_BUSY_TIMEOUT)
        .map_err(|error| ContractProbeFailure {
            stage: BusyStage::Open,
            error,
        })?;
    connection
        .execute_batch("PRAGMA query_only = ON; PRAGMA foreign_keys = ON;")
        .map_err(|error| ContractProbeFailure {
            stage: BusyStage::ContractQuery,
            error,
        })?;
    classify_database_contract(&connection).map_err(|error| ContractProbeFailure {
        stage: BusyStage::ContractQuery,
        error,
    })
}

fn recover_sqlite_journal(
    lease: &CoreDataDirLease,
    expected: &CompleteArtifactObservation,
    namespace: AuthorityNamespace,
    recovery: SqliteJournalRecovery,
) -> Result<(), ObservationFailure> {
    let artifacts = expected.namespace(namespace);
    let changed = || {
        ObservationFailure::Blocked(AuthorityBlock::IdentityChanged {
            target: artifacts.main_path(),
            stage: BusyStage::Revalidation,
        })
    };
    let map_ticket_error = |error| match error {
        TicketValidationError::Blocked(block) => ObservationFailure::Blocked(*block),
        TicketValidationError::Infrastructure(error) => ObservationFailure::Infrastructure(error),
    };
    revalidate_lease(lease).map_err(map_ticket_error)?;
    let current = observe_all(lease)?;
    if !expected.rovai.authority_unchanged(&current.rovai)
        || !expected.lumen.authority_unchanged(&current.lumen)
        || match recovery {
            SqliteJournalRecovery::Rollback => artifacts.rollback_journal.is_none(),
            SqliteJournalRecovery::Wal => artifacts.wal.is_none(),
        }
    {
        return Err(changed());
    }

    // This is SQLite's own transaction recovery, not an application write or
    // migration. No CREATE flag, no schema changes, no manual journal deletion.
    // query_only prevents application DML while SQLite may recover before SELECT.
    probe_contract(artifacts, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|error| ObservationFailure::Blocked(error.into_block(artifacts)))?;

    revalidate_lease(lease).map_err(map_ticket_error)?;
    let recovered = observe_all(lease)?;
    let after = recovered.namespace(namespace);
    if artifacts
        .main
        .as_ref()
        .map(|artifact| &artifact.identity.object)
        != after
            .main
            .as_ref()
            .map(|artifact| &artifact.identity.object)
    {
        return Err(changed());
    }
    // Recovery can rewrite/truncate bytes and remove sidecars, but cannot
    // replace main or a surviving sidecar with a different filesystem object.
    for (before, after) in [
        (&artifacts.wal, &after.wal),
        (&artifacts.rollback_journal, &after.rollback_journal),
    ] {
        if let Some(after) = after
            && before.as_ref().map(|artifact| &artifact.identity.object)
                != Some(&after.identity.object)
        {
            return Err(changed());
        }
    }
    let other = match namespace {
        AuthorityNamespace::Rovai => AuthorityNamespace::Lumen,
        AuthorityNamespace::Lumen => AuthorityNamespace::Rovai,
    };
    if !expected
        .namespace(other)
        .authority_unchanged(recovered.namespace(other))
    {
        return Err(changed());
    }
    Ok(())
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
    if expected.authority_unchanged(&actual) {
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
    use std::process::{Child, Command, Stdio};

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
        for (mode, namespace, migrate) in [
            ("DELETE", AuthorityNamespace::Rovai, false),
            ("DELETE", AuthorityNamespace::Lumen, true),
            ("WAL", AuthorityNamespace::Rovai, false),
        ] {
            let directory = TestDirectory::new("crashed-writer");
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
            let runtime_root = database.runtime_camp_files_root().to_path_buf();
            let runtime_identity = database
                .runtime_camp_files_root_identity_digest()
                .to_string();
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
                    .env(
                        "ROVAI_SQLITE_CRASH_TEST_MIGRATE",
                        if migrate { "1" } else { "0" },
                    )
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
                AdmissionAssessment::AdmittedExisting(ticket) if !migrate => {
                    crate::db::Database::open_admitted(*ticket).unwrap()
                }
                AdmissionAssessment::RequiresMigration(ticket) if migrate => {
                    crate::authority_migration::AuthorityMigrationRunner::run(
                        *ticket,
                        &runtime_root,
                        &runtime_identity,
                    )
                    .unwrap()
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
        let lease = CoreDataDirLease::acquire(&directory).unwrap();
        let AdmissionAssessment::AdmittedExisting(ticket) =
            DatabaseAdmission::assess(&lease).unwrap()
        else {
            panic!("crash writer requires an admitted current authority");
        };
        let database = crate::db::Database::open_admitted(*ticket).unwrap();
        if std::env::var("ROVAI_SQLITE_CRASH_TEST_MIGRATE").unwrap() == "1" {
            crate::db::downgrade_current_schema_to_v115_source_for_test(database.connection());
        }
        let mode = std::env::var("ROVAI_SQLITE_CRASH_TEST_JOURNAL_MODE").unwrap();
        assert!(matches!(mode.as_str(), "DELETE" | "WAL"));
        database
            .connection()
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
    fn read_probe_tolerates_only_a_new_empty_wal_not_authority_changes() {
        let directory = TestDirectory::new("read-probe-side-effects");
        let lease = CoreDataDirLease::acquire(&directory.0).unwrap();
        let main = directory.0.join("rovai.sqlite");
        let wal = directory.0.join("rovai.sqlite-wal");
        std::fs::write(&main, b"unchanged authority").unwrap();
        let before = observe_namespace(&lease, AuthorityNamespace::Rovai)
            .ok()
            .unwrap();
        std::fs::write(&wal, b"").unwrap();
        let empty_wal = observe_namespace(&lease, AuthorityNamespace::Rovai)
            .ok()
            .unwrap();
        assert!(before.matches_read_probe(&empty_wal));
        assert!(!before.authority_unchanged(&empty_wal));

        // A post-probe ticket must fence even this newly observed empty WAL.
        let ticket = ExistingAuthorityTicket {
            lease: &lease,
            namespace: AuthorityNamespace::Rovai,
            artifacts: empty_wal.clone(),
        };
        std::fs::write(&wal, b"concurrent frames").unwrap();
        let nonempty_wal = observe_namespace(&lease, AuthorityNamespace::Rovai)
            .ok()
            .unwrap();
        assert!(!before.matches_read_probe(&nonempty_wal));
        assert!(!empty_wal.matches_read_probe(&nonempty_wal));
        assert!(matches!(
            ticket.into_open(),
            Err(TicketValidationError::Blocked(block))
                if matches!(*block, AuthorityBlock::IdentityChanged { .. })
        ));

        for kind in [
            AuthorityArtifactKind::Main,
            AuthorityArtifactKind::RollbackJournal,
        ] {
            let mut changed = empty_wal.clone();
            match kind {
                AuthorityArtifactKind::Main => {
                    changed.main.as_mut().unwrap().identity.byte_length += 1;
                }
                AuthorityArtifactKind::RollbackJournal => {
                    changed.rollback_journal = changed.wal.clone();
                }
                _ => unreachable!(),
            }
            assert!(!before.matches_read_probe(&changed), "changed {kind:?}");
        }
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
        crate::test_support::assert_production_database_configuration(&initialized);
        assert_eq!(initialized.path(), lease.data_dir().join("rovai.sqlite"));
        assert!(matches!(
            classify_database_contract(initialized.connection()).unwrap(),
            DatabaseContractClassification::Current(_)
        ));
        drop(initialized);

        let ticket = match DatabaseAdmission::assess(&lease).unwrap() {
            AdmissionAssessment::AdmittedExisting(ticket) => ticket,
            other => panic!("new authority must reopen normally, got {other:?}"),
        };
        let reopened = crate::db::Database::open_admitted(*ticket).unwrap();
        crate::test_support::assert_production_database_configuration(&reopened);
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
