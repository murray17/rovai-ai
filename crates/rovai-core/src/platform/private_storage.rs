use std::{
    fs::File,
    io::Write,
    path::{Path, PathBuf},
};

#[cfg(windows)]
use std::io::Read;

use anyhow::{Context, Result};
use serde::Serialize;
#[cfg(windows)]
use serde::de::DeserializeOwned;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsDataRootLayout {
    pub root: PathBuf,
    pub core: PathBuf,
    pub electron_user_data: PathBuf,
    pub electron_session_data: PathBuf,
    pub logs: PathBuf,
    pub crash_dumps: PathBuf,
}

impl WindowsDataRootLayout {
    pub fn from_root(root: &Path) -> Result<Self> {
        if !root.is_absolute()
            || root.components().any(|component| {
                matches!(
                    component,
                    std::path::Component::CurDir | std::path::Component::ParentDir
                )
            })
        {
            anyhow::bail!(
                "windows_storage.host_unsupported: Windows data root must be a normalized absolute path"
            );
        }
        let electron = root.join("Electron");
        Ok(Self {
            root: root.to_path_buf(),
            core: root.join("Core"),
            electron_user_data: electron.join("User Data"),
            electron_session_data: electron.join("Session Data"),
            logs: root.join("Logs"),
            crash_dumps: root.join("CrashDumps"),
        })
    }
}

/// Creates the complete Windows Desktop data-root layout with native private
/// directory creation before Electron binds any of the paths.
pub fn prepare_windows_data_root(root: &Path) -> Result<WindowsDataRootLayout> {
    let layout = WindowsDataRootLayout::from_root(root)?;
    prepare_windows_data_root_platform(&layout)?;
    Ok(layout)
}

/// Creates or admits a private directory and returns its canonical path.
///
/// Windows uses native creation with a protected DACL and rejects an existing
/// object that does not already satisfy the private-storage contract. Other
/// platforms retain their established data-directory behavior.
pub(crate) fn prepare_private_directory(path: &Path) -> Result<PathBuf> {
    prepare_private_directory_platform(path)
}

/// Creates exactly one new private directory.
///
/// Unlike [`prepare_private_directory`], this rejects an existing leaf. It is
/// used for immutable/staging tree children where merging into an unexpected
/// case-alias or concurrently-created directory would be unsafe.
#[cfg(windows)]
pub(crate) fn create_private_directory(path: &Path) -> Result<PathBuf> {
    create_private_directory_platform(path)
}

/// Admits one existing Windows private directory without creating a missing
/// leaf. Verification paths use this to avoid turning a disappearance race
/// into a new empty managed object.
#[cfg(windows)]
pub(crate) fn admit_private_directory(path: &Path) -> Result<PathBuf> {
    windows::admit_private_directory(path)
}

#[cfg(windows)]
pub(crate) fn repair_private_directory(path: &Path) -> Result<()> {
    windows::repair_private_object(path, true)
}

#[cfg(windows)]
pub(crate) fn repair_private_file(path: &Path) -> Result<()> {
    windows::repair_private_object(path, false)
}

#[cfg(windows)]
pub(crate) fn commit_private_directory_temporary(source: &Path, destination: &Path) -> Result<()> {
    windows::commit_private_directory_temporary(source, destination)
}

/// Opens a retained private read/write file, creating it atomically when absent.
///
/// This is intentionally narrower than `OpenOptions`: callers cannot request a
/// truncating or inheritable handle, and Windows existing-object admission is
/// mandatory before the handle is returned.
pub(crate) fn open_private_read_write_file(path: &Path) -> Result<File> {
    open_private_read_write_file_platform(path)
}

/// Opens an existing private regular file without ever creating a replacement.
#[cfg(windows)]
pub(crate) fn open_private_read_file(path: &Path) -> Result<File> {
    open_private_read_file_platform(path)
}

/// Creates a new private, non-inheritable file and rejects an existing leaf.
pub(crate) fn create_private_new_file(path: &Path) -> Result<File> {
    create_private_new_file_platform(path)
}

/// Creates one private JSON document and rejects any existing destination.
#[cfg(windows)]
pub(crate) fn create_private_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let parent = path.parent().context("private JSON path has no parent")?;
    prepare_private_directory(parent)?;
    let bytes = serde_json::to_vec_pretty(value)?;
    let mut file = create_private_new_file(path)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(windows)]
pub(crate) fn create_private_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("private file path has no parent")?;
    prepare_private_directory(parent)?;
    let mut file = create_private_new_file(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

/// Reads one admitted private JSON document with a strict byte bound.
#[cfg(windows)]
pub(crate) fn read_private_json<T: DeserializeOwned>(
    path: &Path,
    maximum_bytes: usize,
) -> Result<T> {
    let mut file = open_private_read_file(path)?;
    let read_limit = u64::try_from(maximum_bytes)
        .context("private JSON byte limit is too large")?
        .saturating_add(1);
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(read_limit)
        .read_to_end(&mut bytes)?;
    if bytes.len() > maximum_bytes {
        anyhow::bail!("private JSON exceeds the {} byte limit", maximum_bytes);
    }
    serde_json::from_slice(&bytes).context("private JSON is invalid")
}

/// Writes JSON through a fresh private sibling, flushes its bytes, and then
/// publishes it atomically. Existing destinations must already satisfy the
/// private-file admission policy before they may be replaced.
pub(crate) fn atomic_write_private_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value)?;
    atomic_write_private_bytes(path, &bytes)
}

pub(crate) fn atomic_write_private_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("private JSON path has no parent")?;
    prepare_private_directory(parent)?;
    if path.exists() {
        drop(open_private_read_write_file(path)?);
    }
    let temporary = parent.join(format!(".{}.tmp", Uuid::new_v4()));
    let result = (|| -> Result<()> {
        let mut file = create_private_new_file(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        commit_private_temporary(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

/// Publishes a fully written private sibling to its final name.
///
/// Callers must create, validate, flush, and close `source` before invoking
/// this operation. On Windows this uses the native replace-existing path;
/// Unix uses same-filesystem rename semantics.
pub(crate) fn publish_private_temporary_file(source: &Path, destination: &Path) -> Result<()> {
    commit_private_temporary(source, destination)
}

/// Publishes a fully written private sibling only when the final name is still absent.
///
/// The hard-link creation is the no-overwrite commit point. Removing the temporary
/// name afterwards never changes the published file's contents.
pub(crate) fn publish_private_new_temporary_file(source: &Path, destination: &Path) -> Result<()> {
    std::fs::hard_link(source, destination).with_context(|| {
        format!(
            "failed to publish new private file {} to {}",
            source.display(),
            destination.display()
        )
    })?;
    std::fs::remove_file(source).with_context(|| {
        format!(
            "published private file but failed to remove temporary name {}",
            source.display()
        )
    })?;
    Ok(())
}

#[cfg(windows)]
fn prepare_windows_data_root_platform(layout: &WindowsDataRootLayout) -> Result<()> {
    prepare_private_directory(&layout.root)?;
    prepare_private_directory(&layout.core)?;
    let electron = layout
        .electron_user_data
        .parent()
        .expect("Windows Electron User Data always has an Electron parent");
    prepare_private_directory(electron)?;
    prepare_private_directory(&layout.electron_user_data)?;
    prepare_private_directory(&layout.electron_session_data)?;
    prepare_private_directory(&layout.logs)?;
    prepare_private_directory(&layout.crash_dumps)?;
    Ok(())
}

#[cfg(not(windows))]
fn prepare_windows_data_root_platform(_layout: &WindowsDataRootLayout) -> Result<()> {
    anyhow::bail!(
        "windows_storage.host_unsupported: Windows data-root preparation requires Windows"
    )
}

#[cfg(unix)]
fn prepare_private_directory_platform(path: &Path) -> Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::create_dir_all(path).with_context(|| {
        format!(
            "failed to create private Rovai data directory {}",
            path.display()
        )
    })?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
        .with_context(|| format!("failed to restrict private directory {}", path.display()))?;
    path.canonicalize().with_context(|| {
        format!(
            "failed to resolve private Rovai data directory {}",
            path.display()
        )
    })
}

#[cfg(unix)]
fn open_private_read_write_file_platform(path: &Path) -> Result<File> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    use anyhow::Context;

    let mut options = std::fs::OpenOptions::new();
    options
        .create(true)
        .read(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW);
    let file = options
        .open(path)
        .with_context(|| format!("failed to open private file {}", path.display()))?;
    if !file.metadata()?.is_file() {
        anyhow::bail!("private path is not a regular file: {}", path.display());
    }
    file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    Ok(file)
}

#[cfg(unix)]
fn create_private_new_file_platform(path: &Path) -> Result<File> {
    use std::os::unix::fs::OpenOptionsExt;

    let parent = path.parent().context("private file has no parent")?;
    if !parent.is_dir() {
        anyhow::bail!("private file parent is unavailable: {}", parent.display());
    }
    std::fs::OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .with_context(|| format!("failed to create private file {}", path.display()))
}

#[cfg(unix)]
fn commit_private_temporary(source: &Path, destination: &Path) -> Result<()> {
    std::fs::rename(source, destination).with_context(|| {
        format!(
            "failed to publish private file {} to {}",
            source.display(),
            destination.display()
        )
    })
}

#[cfg(windows)]
mod windows {
    use std::{
        ffi::OsStr,
        fs::File,
        io,
        mem::size_of,
        os::windows::{
            ffi::OsStrExt,
            io::{AsRawHandle, FromRawHandle, OwnedHandle},
        },
        path::{Component, Path, PathBuf, Prefix},
        ptr::{null, null_mut},
    };

    use anyhow::{Context, Result, anyhow, bail};
    use windows_sys::Win32::{
        Foundation::{
            ERROR_ALREADY_EXISTS, ERROR_FILE_EXISTS, GENERIC_READ, GENERIC_WRITE, HANDLE,
            HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, SetHandleInformation,
        },
        Storage::FileSystem::{
            CREATE_NEW, CreateDirectoryW, CreateFileW, FILE_ATTRIBUTE_DIRECTORY,
            FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO,
            FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_INFO,
            FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
            FileAttributeTagInfo, FileIdInfo, GetDriveTypeW, GetFileInformationByHandleEx,
            GetVolumeInformationW, GetVolumePathNameW, MOVEFILE_REPLACE_EXISTING,
            MOVEFILE_WRITE_THROUGH, MoveFileExW, OPEN_EXISTING, READ_CONTROL, WRITE_DAC,
        },
        System::WindowsProgramming::DRIVE_FIXED,
    };

    use crate::platform::windows_security::{PrivateObjectKind, PrivateSecurityDescriptor};

    const HOST_UNSUPPORTED: &str = "windows_storage.host_unsupported";
    const NOT_LOCAL: &str = "windows_storage.not_local";
    const NOT_NTFS: &str = "windows_storage.not_ntfs";
    const IDENTITY_UNAVAILABLE: &str = "windows_storage.identity_unavailable";
    const REPARSE_ROOT_REJECTED: &str = "windows_storage.reparse_root_rejected";
    const PRIVATE_ACL_INVALID: &str = "windows_storage.private_acl_invalid";

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    struct FileIdentity {
        volume_serial_number: u64,
        file_id: [u8; 16],
    }

    pub(super) fn prepare_private_directory(path: &Path) -> Result<PathBuf> {
        validate_native_absolute_path(path)?;
        if !path.exists() {
            prepare_parent(path)?;
            if let Err(error) = create_private_directory_native(path) {
                // A concurrent creator may win between the existence probe and
                // CreateDirectoryW. Admission below still requires exact type,
                // volume identity, non-reparse state, and the protected DACL.
                if !path.exists() {
                    return Err(error);
                }
            }
        }

        admit_private_directory(path)
    }

    pub(super) fn admit_private_directory(path: &Path) -> Result<PathBuf> {
        validate_native_absolute_path(path)?;
        let opened = open_path(path, ExpectedObjectKind::Directory)?;
        admit_volume(path)?;
        let identity = file_identity(&opened)?;
        verify_private_acl(
            &opened,
            PrivateObjectKind::Directory,
            "private data directory",
        )
        .map_err(|error| blocker(PRIVATE_ACL_INVALID, format!("{error:#}")))?;
        let canonical = path.canonicalize().map_err(|error| {
            blocker(
                IDENTITY_UNAVAILABLE,
                format!("failed to canonicalize {}: {error}", path.display()),
            )
        })?;
        let reopened = open_path(&canonical, ExpectedObjectKind::Directory)?;
        if file_identity(&reopened)? != identity {
            bail!(
                "{IDENTITY_UNAVAILABLE}: data directory identity changed during admission: {}",
                path.display()
            );
        }
        Ok(canonical)
    }

    pub(super) fn create_private_directory(path: &Path) -> Result<PathBuf> {
        validate_native_absolute_path(path)?;
        prepare_parent(path)?;
        create_private_directory_native(path)?;
        prepare_private_directory(path)
    }

    pub(super) fn open_private_read_write_file(path: &Path) -> Result<File> {
        validate_native_absolute_path(path)?;
        let parent = path.parent().ok_or_else(|| {
            blocker(
                HOST_UNSUPPORTED,
                format!("private file path has no parent: {}", path.display()),
            )
        })?;
        let admitted_parent = prepare_private_directory(parent)?;
        let parent_handle = open_path(&admitted_parent, ExpectedObjectKind::Directory)?;
        let parent_identity = file_identity(&parent_handle)?;

        let descriptor = PrivateSecurityDescriptor::new(PrivateObjectKind::File)
            .map_err(|error| blocker(PRIVATE_ACL_INVALID, format!("{error:#}")))?;
        let attributes = descriptor.attributes();
        let wide_path = wide_path(path)?;
        let mut created = true;
        let raw = unsafe {
            // SAFETY: wide_path is NUL-terminated, attributes borrows the live
            // descriptor, and all other arguments are value types. CREATE_NEW
            // prevents opening an unknown existing object under creation ACLs.
            CreateFileW(
                wide_path.as_ptr(),
                GENERIC_READ | GENERIC_WRITE | READ_CONTROL,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                &attributes,
                CREATE_NEW,
                FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT,
                null_mut(),
            )
        };
        let handle = if raw == INVALID_HANDLE_VALUE {
            let error = io::Error::last_os_error();
            if matches!(
                error.raw_os_error().map(|code| code as u32),
                Some(ERROR_FILE_EXISTS) | Some(ERROR_ALREADY_EXISTS)
            ) {
                created = false;
                open_existing_private_file(path).map_err(|open_error| {
                    blocker(
                        PRIVATE_ACL_INVALID,
                        format!(
                            "failed to open existing private file {}: {open_error:#}",
                            path.display()
                        ),
                    )
                })?
            } else {
                return Err(error)
                    .with_context(|| format!("failed to create private file {}", path.display()));
            }
        } else {
            owned_handle(raw)?
        };

        clear_handle_inheritance(&handle)?;
        let file_identity = inspect_handle(&handle, ExpectedObjectKind::File)?;
        if file_identity.volume_serial_number != parent_identity.volume_serial_number {
            bail!(
                "{IDENTITY_UNAVAILABLE}: private file and parent resolved to different volumes: {}",
                path.display()
            );
        }
        verify_private_acl(&handle, PrivateObjectKind::File, "private file").map_err(|error| {
            blocker(
                PRIVATE_ACL_INVALID,
                format!(
                    "{} private file {} failed admission: {error:#}",
                    if created { "new" } else { "existing" },
                    path.display()
                ),
            )
        })?;
        Ok(File::from(handle))
    }

    pub(super) fn open_private_read_file(path: &Path) -> Result<File> {
        validate_native_absolute_path(path)?;
        let parent = path.parent().ok_or_else(|| {
            blocker(
                HOST_UNSUPPORTED,
                format!("private file path has no parent: {}", path.display()),
            )
        })?;
        let admitted_parent = admit_private_directory(parent)?;
        let parent_handle = open_path(&admitted_parent, ExpectedObjectKind::Directory)?;
        let parent_identity = file_identity(&parent_handle)?;
        let handle = open_existing_private_file(path)?;
        let identity = inspect_handle(&handle, ExpectedObjectKind::File)?;
        if identity.volume_serial_number != parent_identity.volume_serial_number {
            bail!(
                "{IDENTITY_UNAVAILABLE}: private file and parent resolved to different volumes: {}",
                path.display()
            );
        }
        verify_private_acl(&handle, PrivateObjectKind::File, "private file").map_err(|error| {
            blocker(
                PRIVATE_ACL_INVALID,
                format!(
                    "private file {} failed admission: {error:#}",
                    path.display()
                ),
            )
        })?;
        Ok(File::from(handle))
    }

    pub(super) fn create_private_new_file(path: &Path) -> Result<File> {
        validate_native_absolute_path(path)?;
        let parent = path.parent().ok_or_else(|| {
            blocker(
                HOST_UNSUPPORTED,
                format!("private file path has no parent: {}", path.display()),
            )
        })?;
        let admitted_parent = prepare_private_directory(parent)?;
        let parent_handle = open_path(&admitted_parent, ExpectedObjectKind::Directory)?;
        let parent_identity = file_identity(&parent_handle)?;

        let descriptor = PrivateSecurityDescriptor::new(PrivateObjectKind::File)
            .map_err(|error| blocker(PRIVATE_ACL_INVALID, format!("{error:#}")))?;
        let attributes = descriptor.attributes();
        let wide_path = wide_path(path)?;
        let raw = unsafe {
            // SAFETY: wide_path is NUL-terminated and attributes borrows the
            // live protected descriptor. CREATE_NEW rejects every existing leaf.
            CreateFileW(
                wide_path.as_ptr(),
                GENERIC_READ | GENERIC_WRITE | READ_CONTROL,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                &attributes,
                CREATE_NEW,
                FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT,
                null_mut(),
            )
        };
        if raw == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error())
                .with_context(|| format!("failed to create private file {}", path.display()));
        }
        let handle = owned_handle(raw)?;
        clear_handle_inheritance(&handle)?;
        let identity = inspect_handle(&handle, ExpectedObjectKind::File)?;
        if identity.volume_serial_number != parent_identity.volume_serial_number {
            bail!(
                "{IDENTITY_UNAVAILABLE}: private file and parent resolved to different volumes: {}",
                path.display()
            );
        }
        verify_private_acl(&handle, PrivateObjectKind::File, "private file").map_err(|error| {
            blocker(
                PRIVATE_ACL_INVALID,
                format!(
                    "new private file {} failed admission: {error:#}",
                    path.display()
                ),
            )
        })?;
        Ok(File::from(handle))
    }

    pub(super) fn commit_private_temporary(source: &Path, destination: &Path) -> Result<()> {
        validate_native_absolute_path(source)?;
        validate_native_absolute_path(destination)?;
        let source_wide = wide_path(source)?;
        let destination_wide = wide_path(destination)?;
        let moved = unsafe {
            // SAFETY: both paths are NUL-terminated and remain live. The
            // source was created with the private-file policy and is closed.
            MoveFileExW(
                source_wide.as_ptr(),
                destination_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if moved == 0 {
            Err(io::Error::last_os_error()).with_context(|| {
                format!(
                    "failed to publish private file {} to {}",
                    source.display(),
                    destination.display()
                )
            })
        } else {
            Ok(())
        }
    }

    pub(super) fn repair_private_object(path: &Path, directory: bool) -> Result<()> {
        validate_native_absolute_path(path)?;
        admit_volume(path)?;
        let expected = if directory {
            ExpectedObjectKind::Directory
        } else {
            ExpectedObjectKind::File
        };
        let kind = if directory {
            PrivateObjectKind::Directory
        } else {
            PrivateObjectKind::File
        };
        let handle = open_path_for_acl_repair(path, expected)?;
        let policy = PrivateSecurityDescriptor::new(kind)
            .map_err(|error| blocker(PRIVATE_ACL_INVALID, format!("{error:#}")))?;
        policy
            .apply_file_dacl(handle.as_raw_handle() as HANDLE)
            .map_err(|error| blocker(PRIVATE_ACL_INVALID, format!("{error:#}")))?;
        verify_private_acl(&handle, kind, "repaired private storage object")
            .map_err(|error| blocker(PRIVATE_ACL_INVALID, format!("{error:#}")))
    }

    pub(super) fn commit_private_directory_temporary(
        source: &Path,
        destination: &Path,
    ) -> Result<()> {
        validate_native_absolute_path(source)?;
        validate_native_absolute_path(destination)?;
        if source.parent() != destination.parent() {
            bail!("private staging directory must share its destination parent");
        }
        let parent = source
            .parent()
            .context("private staging directory has no parent")?;
        admit_private_directory(parent)?;
        let source_handle = open_path(source, ExpectedObjectKind::Directory)?;
        verify_private_acl(
            &source_handle,
            PrivateObjectKind::Directory,
            "private staging directory",
        )?;
        if std::fs::symlink_metadata(destination).is_ok() {
            bail!(
                "private projection destination already exists: {}",
                destination.display()
            );
        }
        let source_identity = file_identity(&source_handle)?;
        let source_wide = wide_path(source)?;
        let destination_wide = wide_path(destination)?;
        let moved = unsafe {
            // SAFETY: both paths are NUL-terminated and source_handle permits
            // deletion sharing. Omitting REPLACE preserves immutable targets.
            MoveFileExW(
                source_wide.as_ptr(),
                destination_wide.as_ptr(),
                MOVEFILE_WRITE_THROUGH,
            )
        };
        if moved == 0 {
            return Err(io::Error::last_os_error()).with_context(|| {
                format!(
                    "failed to publish private directory {} to {}",
                    source.display(),
                    destination.display()
                )
            });
        }
        let destination_handle = open_path(destination, ExpectedObjectKind::Directory)?;
        if file_identity(&destination_handle)? != source_identity {
            bail!("private directory identity changed while it was published");
        }
        verify_private_acl(
            &destination_handle,
            PrivateObjectKind::Directory,
            "published private directory",
        )
    }

    fn prepare_parent(path: &Path) -> Result<()> {
        let parent = path.parent().ok_or_else(|| {
            blocker(
                HOST_UNSUPPORTED,
                format!("private directory has no parent: {}", path.display()),
            )
        })?;
        if parent.exists() {
            let parent_handle = open_path(parent, ExpectedObjectKind::Directory)?;
            inspect_handle(&parent_handle, ExpectedObjectKind::Directory)?;
            admit_volume(parent)?;
        } else {
            prepare_private_directory(parent)?;
        }
        Ok(())
    }

    fn create_private_directory_native(path: &Path) -> Result<()> {
        let descriptor = PrivateSecurityDescriptor::new(PrivateObjectKind::Directory)
            .map_err(|error| blocker(PRIVATE_ACL_INVALID, format!("{error:#}")))?;
        let attributes = descriptor.attributes();
        let wide_path = wide_path(path)?;
        let created = unsafe {
            // SAFETY: wide_path is NUL-terminated and attributes borrows the
            // live protected descriptor for the duration of the native call.
            CreateDirectoryW(wide_path.as_ptr(), &attributes)
        };
        if created != 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        Err(error).with_context(|| format!("failed to create private directory {}", path.display()))
    }

    #[derive(Debug, Clone, Copy)]
    enum ExpectedObjectKind {
        Directory,
        File,
    }

    fn open_path(path: &Path, expected: ExpectedObjectKind) -> Result<OwnedHandle> {
        let wide_path = wide_path(path)?;
        let flags = FILE_FLAG_OPEN_REPARSE_POINT
            | match expected {
                ExpectedObjectKind::Directory => FILE_FLAG_BACKUP_SEMANTICS,
                ExpectedObjectKind::File => FILE_ATTRIBUTE_NORMAL,
            };
        let raw = unsafe {
            // SAFETY: wide_path is NUL-terminated. Null security attributes make
            // the returned handle non-inheritable and OPEN_EXISTING never creates.
            CreateFileW(
                wide_path.as_ptr(),
                FILE_READ_ATTRIBUTES | READ_CONTROL,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null(),
                OPEN_EXISTING,
                flags,
                null_mut(),
            )
        };
        if raw == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error())
                .with_context(|| format!("failed to open storage object {}", path.display()));
        }
        let handle = owned_handle(raw)?;
        clear_handle_inheritance(&handle)?;
        inspect_handle(&handle, expected)?;
        Ok(handle)
    }

    fn open_path_for_acl_repair(path: &Path, expected: ExpectedObjectKind) -> Result<OwnedHandle> {
        let wide_path = wide_path(path)?;
        let flags = FILE_FLAG_OPEN_REPARSE_POINT
            | match expected {
                ExpectedObjectKind::Directory => FILE_FLAG_BACKUP_SEMANTICS,
                ExpectedObjectKind::File => FILE_ATTRIBUTE_NORMAL,
            };
        let raw = unsafe {
            // SAFETY: wide_path is NUL-terminated. OPEN_EXISTING cannot create
            // an object and OPEN_REPARSE_POINT keeps inspection on the leaf.
            CreateFileW(
                wide_path.as_ptr(),
                FILE_READ_ATTRIBUTES | READ_CONTROL | WRITE_DAC,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null(),
                OPEN_EXISTING,
                flags,
                null_mut(),
            )
        };
        if raw == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error()).with_context(|| {
                format!("failed to open storage ACL for repair {}", path.display())
            });
        }
        let handle = owned_handle(raw)?;
        clear_handle_inheritance(&handle)?;
        inspect_handle(&handle, expected)?;
        Ok(handle)
    }

    fn open_existing_private_file(path: &Path) -> Result<OwnedHandle> {
        let wide_path = wide_path(path)?;
        let raw = unsafe {
            // SAFETY: wide_path is NUL-terminated. Null security attributes make
            // the existing handle non-inheritable and OPEN_EXISTING never creates.
            CreateFileW(
                wide_path.as_ptr(),
                GENERIC_READ | GENERIC_WRITE | READ_CONTROL,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                null(),
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT,
                null_mut(),
            )
        };
        if raw == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error())
                .with_context(|| format!("failed to open private file {}", path.display()));
        }
        let handle = owned_handle(raw)?;
        clear_handle_inheritance(&handle)?;
        inspect_handle(&handle, ExpectedObjectKind::File)?;
        Ok(handle)
    }

    fn inspect_handle(handle: &OwnedHandle, expected: ExpectedObjectKind) -> Result<FileIdentity> {
        let mut attributes = FILE_ATTRIBUTE_TAG_INFO::default();
        read_file_information(handle, FileAttributeTagInfo, &mut attributes)
            .map_err(|error| blocker(IDENTITY_UNAVAILABLE, format!("{error:#}")))?;
        if attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            bail!("{REPARSE_ROOT_REJECTED}: storage object is a reparse point");
        }
        let is_directory = attributes.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0;
        if is_directory != matches!(expected, ExpectedObjectKind::Directory) {
            bail!("{IDENTITY_UNAVAILABLE}: storage object has the wrong type");
        }
        file_identity(handle)
    }

    fn file_identity(handle: &OwnedHandle) -> Result<FileIdentity> {
        let mut info = FILE_ID_INFO::default();
        read_file_information(handle, FileIdInfo, &mut info)
            .map_err(|error| blocker(IDENTITY_UNAVAILABLE, format!("{error:#}")))?;
        Ok(FileIdentity {
            volume_serial_number: info.VolumeSerialNumber,
            file_id: info.FileId.Identifier,
        })
    }

    fn read_file_information<T>(handle: &OwnedHandle, class: i32, output: &mut T) -> Result<()> {
        let read = unsafe {
            // SAFETY: output points to the exact structure selected by each
            // caller's FILE_INFO_BY_HANDLE_CLASS and has the declared size.
            GetFileInformationByHandleEx(
                handle.as_raw_handle(),
                class,
                (output as *mut T).cast(),
                size_of::<T>() as u32,
            )
        };
        if read == 0 {
            Err(io::Error::last_os_error()).context("GetFileInformationByHandleEx failed")
        } else {
            Ok(())
        }
    }

    fn verify_private_acl(
        handle: &OwnedHandle,
        kind: PrivateObjectKind,
        label: &str,
    ) -> Result<()> {
        PrivateSecurityDescriptor::new(kind)
            .and_then(|policy| policy.verify_file_handle(handle.as_raw_handle() as HANDLE))
            .with_context(|| format!("{label} does not have the required protected DACL"))
    }

    fn admit_volume(path: &Path) -> Result<()> {
        let wide_path = wide_path(path)?;
        let mut volume_root = vec![0_u16; 32_768];
        if unsafe {
            // SAFETY: both buffers are live and volume_root advertises its exact
            // capacity in UTF-16 code units.
            GetVolumePathNameW(
                wide_path.as_ptr(),
                volume_root.as_mut_ptr(),
                volume_root.len() as u32,
            )
        } == 0
        {
            return Err(blocker(
                IDENTITY_UNAVAILABLE,
                format!(
                    "failed to resolve the storage volume for {}: {}",
                    path.display(),
                    io::Error::last_os_error()
                ),
            ));
        }
        let drive_type = unsafe {
            // SAFETY: GetVolumePathNameW produced a NUL-terminated root path.
            GetDriveTypeW(volume_root.as_ptr())
        };
        if drive_type != DRIVE_FIXED {
            bail!(
                "{NOT_LOCAL}: storage path is not on a local fixed volume: {}",
                path.display()
            );
        }

        let mut filesystem = [0_u16; 64];
        if unsafe {
            // SAFETY: the root path is NUL-terminated; unused optional outputs
            // are null and filesystem has the advertised writable capacity.
            GetVolumeInformationW(
                volume_root.as_ptr(),
                null_mut(),
                0,
                null_mut(),
                null_mut(),
                null_mut(),
                filesystem.as_mut_ptr(),
                filesystem.len() as u32,
            )
        } == 0
        {
            return Err(blocker(
                IDENTITY_UNAVAILABLE,
                format!(
                    "failed to inspect the storage filesystem for {}: {}",
                    path.display(),
                    io::Error::last_os_error()
                ),
            ));
        }
        let filesystem = utf16_until_nul(&filesystem)?;
        if !filesystem.eq_ignore_ascii_case("NTFS") {
            bail!(
                "{NOT_NTFS}: storage filesystem is {filesystem}, expected NTFS: {}",
                path.display()
            );
        }
        Ok(())
    }

    fn validate_native_absolute_path(path: &Path) -> Result<()> {
        if !path.is_absolute() {
            bail!(
                "{HOST_UNSUPPORTED}: Windows private storage path must be absolute: {}",
                path.display()
            );
        }
        let prefix = path.components().next();
        let supported = matches!(
            prefix,
            Some(Component::Prefix(component))
                if matches!(component.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        );
        if !supported {
            bail!(
                "{NOT_LOCAL}: UNC, device, and non-drive storage paths are not admitted: {}",
                path.display()
            );
        }
        Ok(())
    }

    fn clear_handle_inheritance(handle: &OwnedHandle) -> Result<()> {
        let cleared = unsafe {
            // SAFETY: handle is live and owned; clearing HANDLE_FLAG_INHERIT
            // cannot broaden its rights.
            SetHandleInformation(handle.as_raw_handle(), HANDLE_FLAG_INHERIT, 0)
        };
        if cleared == 0 {
            Err(io::Error::last_os_error()).context("failed to make storage handle non-inheritable")
        } else {
            Ok(())
        }
    }

    fn owned_handle(raw: HANDLE) -> Result<OwnedHandle> {
        if raw.is_null() || raw == INVALID_HANDLE_VALUE {
            Err(io::Error::last_os_error()).context("Windows returned an invalid storage handle")
        } else {
            Ok(unsafe {
                // SAFETY: raw is a newly returned, valid handle and ownership is
                // transferred exactly once into OwnedHandle.
                OwnedHandle::from_raw_handle(raw)
            })
        }
    }

    fn wide_path(path: &Path) -> Result<Vec<u16>> {
        wide_os(path.as_os_str()).map_err(|error| {
            blocker(
                HOST_UNSUPPORTED,
                format!("invalid Windows storage path {}: {error:#}", path.display()),
            )
        })
    }

    fn wide_os(value: &OsStr) -> Result<Vec<u16>> {
        let mut wide = value.encode_wide().collect::<Vec<_>>();
        if wide.contains(&0) {
            bail!("path contains an interior NUL");
        }
        wide.push(0);
        Ok(wide)
    }

    fn utf16_until_nul(value: &[u16]) -> Result<String> {
        let length = value
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(value.len());
        String::from_utf16(&value[..length]).context("Windows returned invalid UTF-16")
    }

    fn blocker(code: &'static str, detail: impl std::fmt::Display) -> anyhow::Error {
        anyhow!("{code}: {detail}")
    }
}

#[cfg(windows)]
fn prepare_private_directory_platform(path: &Path) -> Result<PathBuf> {
    windows::prepare_private_directory(path)
}

#[cfg(windows)]
fn create_private_directory_platform(path: &Path) -> Result<PathBuf> {
    windows::create_private_directory(path)
}

#[cfg(windows)]
fn open_private_read_write_file_platform(path: &Path) -> Result<File> {
    windows::open_private_read_write_file(path)
}

#[cfg(windows)]
fn open_private_read_file_platform(path: &Path) -> Result<File> {
    windows::open_private_read_file(path)
}

#[cfg(windows)]
fn create_private_new_file_platform(path: &Path) -> Result<File> {
    windows::create_private_new_file(path)
}

#[cfg(windows)]
fn commit_private_temporary(source: &Path, destination: &Path) -> Result<()> {
    windows::commit_private_temporary(source, destination)
}

#[cfg(not(any(unix, windows)))]
fn prepare_private_directory_platform(_path: &Path) -> Result<PathBuf> {
    anyhow::bail!("private Rovai storage is unsupported on this platform")
}

#[cfg(not(any(unix, windows)))]
fn open_private_read_write_file_platform(_path: &Path) -> Result<File> {
    anyhow::bail!("private Rovai storage is unsupported on this platform")
}

#[cfg(not(any(unix, windows)))]
fn create_private_new_file_platform(_path: &Path) -> Result<File> {
    anyhow::bail!("private Rovai storage is unsupported on this platform")
}

#[cfg(not(any(unix, windows)))]
fn commit_private_temporary(_source: &Path, _destination: &Path) -> Result<()> {
    anyhow::bail!("private Rovai storage is unsupported on this platform")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_data_root_layout_has_closed_children() {
        let root = std::env::temp_dir().join("rovai-windows-layout");
        let layout = WindowsDataRootLayout::from_root(&root).unwrap();
        assert_eq!(layout.root, root);
        assert_eq!(layout.core, root.join("Core"));
        assert_eq!(
            layout.electron_user_data,
            root.join("Electron").join("User Data")
        );
        assert_eq!(
            layout.electron_session_data,
            root.join("Electron").join("Session Data")
        );
        assert_eq!(layout.logs, root.join("Logs"));
        assert_eq!(layout.crash_dumps, root.join("CrashDumps"));
    }

    #[test]
    fn windows_data_root_layout_rejects_relative_or_parent_paths() {
        assert!(WindowsDataRootLayout::from_root(Path::new("relative-root")).is_err());
        let parent_path = std::env::temp_dir().join("child").join("..").join("root");
        assert!(WindowsDataRootLayout::from_root(&parent_path).is_err());
    }

    #[test]
    fn new_private_publish_never_replaces_an_existing_destination() {
        let root = std::env::temp_dir().join(format!(
            "rovai-private-new-publish-{}",
            uuid::Uuid::new_v4()
        ));
        prepare_private_directory(&root).unwrap();
        let source = root.join("staging");
        let destination = root.join("authority");
        std::fs::write(&source, b"new").unwrap();
        std::fs::write(&destination, b"existing").unwrap();

        assert!(publish_private_new_temporary_file(&source, &destination).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"existing");
        assert_eq!(std::fs::read(&source).unwrap(), b"new");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_data_root_is_created_as_one_private_closed_layout() {
        let root =
            std::env::temp_dir().join(format!("rovai-windows-data-root-{}", uuid::Uuid::new_v4()));
        let layout = prepare_windows_data_root(&root).unwrap();
        for directory in [
            &layout.root,
            &layout.core,
            &layout.electron_user_data,
            &layout.electron_session_data,
            &layout.logs,
            &layout.crash_dumps,
        ] {
            assert!(directory.is_dir(), "missing {}", directory.display());
        }
        let admitted_again = prepare_windows_data_root(&root).unwrap();
        assert_eq!(admitted_again, layout);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn private_json_replacement_remains_admissible() {
        let root = std::env::temp_dir().join(format!(
            "rovai-windows-private-json-{}",
            uuid::Uuid::new_v4()
        ));
        prepare_private_directory(&root).unwrap();
        let path = root.join("state.json");

        atomic_write_private_json(&path, &serde_json::json!({"state": "prepared"})).unwrap();
        atomic_write_private_json(&path, &serde_json::json!({"state": "verified"})).unwrap();

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value, serde_json::json!({"state": "verified"}));
        drop(open_private_read_write_file(&path).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
}
