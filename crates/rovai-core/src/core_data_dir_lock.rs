use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::platform::private_storage::{open_private_read_write_file, prepare_private_directory};

pub const CORE_DATA_DIR_LOCK_FILE: &str = ".rovai-core-instance.lock";
const MAX_OWNER_METADATA_BYTES: u64 = 8 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoreDataDirOwner {
    schema_version: u32,
    process_id: u32,
    executable_path: String,
    acquired_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreDataDirOwnerSummary {
    pub process_id: u32,
    pub executable_path: String,
    pub acquired_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FilesystemObjectIdentity {
    platform_key: String,
}

impl FilesystemObjectIdentity {
    pub(crate) fn observe(path: &Path) -> io::Result<Self> {
        let metadata = std::fs::symlink_metadata(path)?;
        if metadata.file_type().is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("filesystem identity refuses symlink {}", path.display()),
            ));
        }
        Ok(Self {
            platform_key: platform_identity_key(path, &metadata)?,
        })
    }

    pub(crate) fn platform_key(&self) -> &str {
        &self.platform_key
    }
}

#[cfg(unix)]
fn platform_identity_key(_path: &Path, metadata: &std::fs::Metadata) -> io::Result<String> {
    use std::os::unix::fs::MetadataExt;

    Ok(format!("unix:{}:{}", metadata.dev(), metadata.ino()))
}

#[cfg(windows)]
fn platform_identity_key(path: &Path, _metadata: &std::fs::Metadata) -> io::Result<String> {
    use std::os::windows::{
        fs::{MetadataExt, OpenOptionsExt},
        io::AsRawHandle,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_DEVICE, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_INFO, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE, FileIdInfo, GetFileInformationByHandleEx,
    };

    // MetadataExt's file-index APIs are unstable. Retain a metadata-only handle
    // and inspect the opened leaf, including a replacement racing the path stat.
    let file = std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    if file.metadata()?.file_attributes() & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DEVICE)
        != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "filesystem identity refuses reparse/device object {}",
                path.display()
            ),
        ));
    }
    let mut identity = FILE_ID_INFO::default();
    let read = unsafe {
        // SAFETY: file remains open, and the output buffer's type and size
        // match FileIdInfo. The operation neither creates nor modifies data.
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            (&mut identity as *mut FILE_ID_INFO).cast(),
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )
    };
    if read == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(format!(
        "windows:{}:{}",
        identity.VolumeSerialNumber,
        u128::from_le_bytes(identity.FileId.Identifier)
    ))
}

#[cfg(not(any(unix, windows)))]
fn platform_identity_key(path: &Path, _metadata: &std::fs::Metadata) -> io::Result<String> {
    Ok(format!("path:{}", path.canonicalize()?.display()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CoreDataDirLeaseInfrastructureStage {
    PrepareDirectory,
    ObserveIdentity,
    OpenLockFile,
    AcquireLock,
    RecordOwner,
}

#[derive(Debug)]
pub struct CoreDataDirLeaseInfrastructureError {
    pub stage: CoreDataDirLeaseInfrastructureStage,
    pub message: String,
}

impl std::fmt::Display for CoreDataDirLeaseInfrastructureError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CoreDataDirLeaseInfrastructureError {}

#[derive(Debug)]
pub enum CoreDataDirLeaseAcquisition {
    Acquired(CoreDataDirLease),
    OwnedByActiveCore {
        data_dir: PathBuf,
        owner: Option<CoreDataDirOwnerSummary>,
    },
}

/// Holds the process-wide exclusive lease for one Rovai data directory.
///
/// The lock file is intentionally retained after shutdown. Removing a locked
/// file would allow another process to create and lock a different inode for
/// the same path. The operating-system lock is released when this handle is
/// dropped, and the next owner overwrites the diagnostic metadata in place.
#[derive(Debug)]
pub struct CoreDataDirLease {
    file: File,
    canonical_data_dir: PathBuf,
    data_dir_identity: FilesystemObjectIdentity,
}

impl CoreDataDirLease {
    pub fn try_acquire(
        data_dir: &Path,
    ) -> std::result::Result<CoreDataDirLeaseAcquisition, CoreDataDirLeaseInfrastructureError> {
        let canonical_data_dir = prepare_private_directory(data_dir).map_err(|error| {
            CoreDataDirLeaseInfrastructureError {
                stage: CoreDataDirLeaseInfrastructureStage::PrepareDirectory,
                message: format!(
                    "failed to prepare Rovai Core data directory before locking {}: {error:#}",
                    data_dir.display()
                ),
            }
        })?;
        let data_dir_identity =
            FilesystemObjectIdentity::observe(&canonical_data_dir).map_err(|error| {
                CoreDataDirLeaseInfrastructureError {
                    stage: CoreDataDirLeaseInfrastructureStage::ObserveIdentity,
                    message: format!(
                        "failed to observe Rovai Core data-directory identity {}: {error}",
                        canonical_data_dir.display()
                    ),
                }
            })?;
        let lock_path = canonical_data_dir.join(CORE_DATA_DIR_LOCK_FILE);
        let mut file = open_private_read_write_file(&lock_path).map_err(|error| {
            CoreDataDirLeaseInfrastructureError {
                stage: CoreDataDirLeaseInfrastructureStage::OpenLockFile,
                message: format!(
                    "failed to open Core lock file {}: {error:#}",
                    lock_path.display()
                ),
            }
        })?;

        match try_lock_exclusive(&file) {
            Ok(true) => {}
            Ok(false) => {
                return Ok(CoreDataDirLeaseAcquisition::OwnedByActiveCore {
                    data_dir: canonical_data_dir,
                    owner: read_owner_summary(&mut file),
                });
            }
            Err(error) => {
                return Err(CoreDataDirLeaseInfrastructureError {
                    stage: CoreDataDirLeaseInfrastructureStage::AcquireLock,
                    message: format!(
                        "failed to lock Rovai Core data directory {}: {error}",
                        canonical_data_dir.display()
                    ),
                });
            }
        }

        let owner = CoreDataDirOwner {
            schema_version: 1,
            process_id: std::process::id(),
            executable_path: std::env::current_exe()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_else(|_| "unavailable".to_string()),
            acquired_at: chrono::Utc::now().to_rfc3339(),
        };
        write_owner(&mut file, &owner).map_err(|error| CoreDataDirLeaseInfrastructureError {
            stage: CoreDataDirLeaseInfrastructureStage::RecordOwner,
            message: format!(
                "failed to record Rovai Core data-directory owner in {}: {error:#}",
                lock_path.display()
            ),
        })?;

        Ok(CoreDataDirLeaseAcquisition::Acquired(Self {
            file,
            canonical_data_dir,
            data_dir_identity,
        }))
    }

    pub fn acquire(data_dir: &Path) -> Result<Self> {
        match Self::try_acquire(data_dir)? {
            CoreDataDirLeaseAcquisition::Acquired(lease) => Ok(lease),
            CoreDataDirLeaseAcquisition::OwnedByActiveCore { data_dir, owner } => {
                let owner = owner
                    .map(|owner| {
                        format!(
                            "pid {}, executable {}, acquired {}",
                            owner.process_id, owner.executable_path, owner.acquired_at
                        )
                    })
                    .unwrap_or_else(|| "owner metadata unavailable".to_string());
                anyhow::bail!(
                    "Rovai Core refused to open data directory {} because another Core owns it ({owner}). Use a distinct --data-dir for development and acceptance; no SQLite recovery was attempted",
                    data_dir.display(),
                );
            }
        }
    }

    pub fn data_dir(&self) -> &Path {
        &self.canonical_data_dir
    }

    pub(crate) fn revalidate_identity(&self) -> io::Result<bool> {
        Ok(FilesystemObjectIdentity::observe(&self.canonical_data_dir)? == self.data_dir_identity)
    }
}

impl Drop for CoreDataDirLease {
    fn drop(&mut self) {
        unlock(&self.file);
    }
}

pub type CoreDataDirLock = CoreDataDirLease;

#[cfg(unix)]
fn try_lock_exclusive(file: &File) -> io::Result<bool> {
    use std::os::fd::AsRawFd;

    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        return Ok(true);
    }
    let error = io::Error::last_os_error();
    if error.kind() == io::ErrorKind::WouldBlock {
        Ok(false)
    } else {
        Err(error)
    }
}

#[cfg(not(unix))]
fn try_lock_exclusive(file: &File) -> io::Result<bool> {
    match file.try_lock() {
        Ok(()) => Ok(true),
        Err(std::fs::TryLockError::WouldBlock) => Ok(false),
        Err(std::fs::TryLockError::Error(error)) => Err(error),
    }
}

#[cfg(unix)]
fn unlock(file: &File) {
    use std::os::fd::AsRawFd;

    let _ = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) };
}

#[cfg(not(unix))]
fn unlock(file: &File) {
    let _ = file.unlock();
}

fn write_owner(file: &mut File, owner: &CoreDataDirOwner) -> Result<()> {
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    serde_json::to_writer(&mut *file, owner)?;
    file.write_all(b"\n")?;
    file.sync_data()?;
    Ok(())
}

fn read_owner_summary(file: &mut File) -> Option<CoreDataDirOwnerSummary> {
    if file.seek(SeekFrom::Start(0)).is_err() {
        return None;
    }
    let mut contents = String::new();
    if file
        .take(MAX_OWNER_METADATA_BYTES)
        .read_to_string(&mut contents)
        .is_err()
    {
        return None;
    }
    let Ok(owner) = serde_json::from_str::<CoreDataDirOwner>(&contents) else {
        return None;
    };
    Some(CoreDataDirOwnerSummary {
        process_id: owner.process_id,
        executable_path: owner.executable_path,
        acquired_at: owner.acquired_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "rovai-core-data-lock-{label}-{}",
                uuid::Uuid::new_v4()
            ));
            #[cfg(unix)]
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn filesystem_identity_tracks_objects_not_paths_or_contents() {
        let directory = TestDirectory::new("identity");
        let root = prepare_private_directory(&directory.0).unwrap();
        let directory_identity = FilesystemObjectIdentity::observe(&root).unwrap();
        let file = root.join("authority");
        std::fs::write(&file, b"committed").unwrap();
        let original = FilesystemObjectIdentity::observe(&file).unwrap();
        std::fs::write(&file, b"updated").unwrap();
        assert_eq!(original, FilesystemObjectIdentity::observe(&file).unwrap());
        // Keep the old object alive under another name so inode/file-ID reuse
        // cannot make the replacement assertion dependent on allocator timing.
        std::fs::rename(&file, root.join("retained-authority")).unwrap();
        std::fs::write(&file, b"replacement").unwrap();
        assert_ne!(original, FilesystemObjectIdentity::observe(&file).unwrap());
        assert_eq!(
            directory_identity,
            FilesystemObjectIdentity::observe(&root).unwrap()
        );
    }

    #[test]
    fn a_second_owner_is_rejected_until_the_first_handle_is_dropped() {
        let directory = TestDirectory::new("exclusive");
        let first = CoreDataDirLock::acquire(&directory.0).unwrap();

        let error = CoreDataDirLock::acquire(&directory.0).unwrap_err();
        let diagnostic = format!("{error:#}");
        assert!(diagnostic.contains("another Core owns it"));
        assert!(diagnostic.contains("no SQLite recovery was attempted"));

        drop(first);
        let second = CoreDataDirLock::acquire(&directory.0).unwrap();
        // Windows byte-range locks also reject reads through a separate file
        // handle. Release the lease before reopening the retained diagnostic
        // file; the persistence assertion does not require the lease itself.
        drop(second);
        let owner: CoreDataDirOwner = serde_json::from_slice(
            &std::fs::read(directory.0.join(CORE_DATA_DIR_LOCK_FILE)).unwrap(),
        )
        .unwrap();
        assert_eq!(owner.schema_version, 1);
        assert_eq!(owner.process_id, std::process::id());
    }

    #[cfg(unix)]
    #[test]
    fn canonical_aliases_contend_for_the_same_lock() {
        use std::os::unix::fs::symlink;

        let root = TestDirectory::new("alias");
        let data_dir = root.0.join("data");
        let alias = root.0.join("alias");
        std::fs::create_dir(&data_dir).unwrap();
        symlink(&data_dir, &alias).unwrap();

        let _first = CoreDataDirLock::acquire(&data_dir).unwrap();
        let error = CoreDataDirLock::acquire(&alias).unwrap_err();
        assert!(format!("{error:#}").contains("another Core owns it"));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_cannot_redirect_the_lock_file() {
        use std::os::unix::fs::symlink;

        let directory = TestDirectory::new("symlink");
        let outside = directory.0.join("outside");
        std::fs::write(&outside, "do not overwrite").unwrap();
        symlink(&outside, directory.0.join(CORE_DATA_DIR_LOCK_FILE)).unwrap();

        let error = CoreDataDirLock::acquire(&directory.0).unwrap_err();
        assert!(format!("{error:#}").contains("failed to open Core lock file"));
        assert_eq!(
            std::fs::read_to_string(outside).unwrap(),
            "do not overwrite"
        );
    }

    #[cfg(windows)]
    #[test]
    fn an_existing_directory_with_inherited_acl_is_rejected() {
        let directory = TestDirectory::new("inherited-directory");
        std::fs::create_dir_all(&directory.0).unwrap();

        let error = CoreDataDirLock::acquire(&directory.0).unwrap_err();
        assert!(
            format!("{error:#}").contains("windows_storage.private_acl_invalid"),
            "unexpected error: {error:#}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn an_existing_lock_file_with_inherited_acl_is_rejected() {
        let directory = TestDirectory::new("inherited-file");
        let lock = CoreDataDirLock::acquire(&directory.0).unwrap();
        drop(lock);
        let lock_path = directory.0.join(CORE_DATA_DIR_LOCK_FILE);
        std::fs::remove_file(&lock_path).unwrap();
        std::fs::write(&lock_path, b"unknown owner").unwrap();

        let error = CoreDataDirLock::acquire(&directory.0).unwrap_err();
        assert!(
            format!("{error:#}").contains("windows_storage.private_acl_invalid"),
            "unexpected error: {error:#}"
        );
    }
}
