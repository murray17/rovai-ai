use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom, Write},
    path::Path,
};

use anyhow::{Context, Result};
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

/// Holds the process-wide exclusive lease for one Rovai data directory.
///
/// The lock file is intentionally retained after shutdown. Removing a locked
/// file would allow another process to create and lock a different inode for
/// the same path. The operating-system lock is released when this handle is
/// dropped, and the next owner overwrites the diagnostic metadata in place.
#[derive(Debug)]
pub struct CoreDataDirLock {
    file: File,
}

impl CoreDataDirLock {
    pub fn acquire(data_dir: &Path) -> Result<Self> {
        let canonical_data_dir = prepare_private_directory(data_dir).with_context(|| {
            format!(
                "failed to prepare Rovai Core data directory before locking {}",
                data_dir.display()
            )
        })?;
        let lock_path = canonical_data_dir.join(CORE_DATA_DIR_LOCK_FILE);
        let mut file = open_private_read_write_file(&lock_path)
            .with_context(|| format!("failed to open Core lock file {}", lock_path.display()))?;

        match try_lock_exclusive(&file) {
            Ok(true) => {}
            Ok(false) => {
                let owner = read_owner_summary(&mut file);
                anyhow::bail!(
                    "Rovai Core refused to open data directory {} because another Core owns it ({owner}). Use a distinct --data-dir for development and acceptance; no SQLite recovery was attempted",
                    canonical_data_dir.display(),
                );
            }
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to lock Rovai Core data directory {}",
                        canonical_data_dir.display()
                    )
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
        write_owner(&mut file, &owner).with_context(|| {
            format!(
                "failed to record Rovai Core data-directory owner in {}",
                lock_path.display()
            )
        })?;

        Ok(Self { file })
    }
}

impl Drop for CoreDataDirLock {
    fn drop(&mut self) {
        unlock(&self.file);
    }
}

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

fn read_owner_summary(file: &mut File) -> String {
    if file.seek(SeekFrom::Start(0)).is_err() {
        return "owner metadata unavailable".to_string();
    }
    let mut contents = String::new();
    if file
        .take(MAX_OWNER_METADATA_BYTES)
        .read_to_string(&mut contents)
        .is_err()
    {
        return "owner metadata unavailable".to_string();
    }
    let Ok(owner) = serde_json::from_str::<CoreDataDirOwner>(&contents) else {
        return "owner metadata unavailable".to_string();
    };
    format!(
        "pid {}, executable {}, acquired {}",
        owner.process_id, owner.executable_path, owner.acquired_at
    )
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
    fn a_second_owner_is_rejected_until_the_first_handle_is_dropped() {
        let directory = TestDirectory::new("exclusive");
        let first = CoreDataDirLock::acquire(&directory.0).unwrap();

        let error = CoreDataDirLock::acquire(&directory.0).unwrap_err();
        let diagnostic = format!("{error:#}");
        assert!(diagnostic.contains("another Core owns it"));
        assert!(diagnostic.contains("no SQLite recovery was attempted"));

        drop(first);
        let second = CoreDataDirLock::acquire(&directory.0).unwrap();
        let owner: CoreDataDirOwner = serde_json::from_slice(
            &std::fs::read(directory.0.join(CORE_DATA_DIR_LOCK_FILE)).unwrap(),
        )
        .unwrap();
        assert_eq!(owner.schema_version, 1);
        assert_eq!(owner.process_id, std::process::id());
        drop(second);
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
