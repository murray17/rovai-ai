//! Shared local file snapshots. Neither this module nor the CLI owns Camp authorization.
use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::{
    collections::BTreeSet,
    ffi::{CStr, CString},
    os::fd::{AsRawFd, FromRawFd},
    os::unix::ffi::{OsStrExt, OsStringExt},
};
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub const MAX_PREPARED_ATTACHMENTS: usize = 10;
pub const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_DRAFT_ATTACHMENT_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_PREVIEW_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_DIRECTORY_FILES: u64 = 2_000;
pub const MAX_DIRECTORY_ENTRIES: u64 = 4_000;
pub const MAX_DIRECTORY_DEPTH: usize = 32;
pub const DIRECTORY_MEDIA_TYPE: &str = "inode/directory";

const _: () = {
    assert!(MAX_PREVIEW_BYTES < MAX_ATTACHMENT_BYTES);
    assert!(MAX_ATTACHMENT_BYTES < MAX_DRAFT_ATTACHMENT_BYTES);
};

const INSPECTION_PREFIX_BYTES: usize = 64 * 1024;
const MAX_PREVIEW_EDGE: u64 = 16_384;
const MAX_PREVIEW_PIXELS: u64 = 40_000_000;
pub(crate) fn inspect_runtime_attachment_copy(path: &Path) -> Result<RuntimeAttachmentCopyReceipt> {
    let authority_safe_leaf = path
        .file_name()
        .and_then(|name| name.to_str())
        .context("Runtime Attachment copy has no UTF-8 safe leaf")?
        .to_string();
    validate_runtime_safe_leaf(&authority_safe_leaf)?;
    let mut source = open_source_without_following(path)?;
    let metadata = inspect_open_node(&source)?;
    if metadata.kind == OpenedNodeKind::RegularFile {
        if metadata.link_count != 1 {
            anyhow::bail!("Runtime Attachment copy contains a hard-linked file");
        }
        let (byte_size, digest) = inspect_open_regular_file(&mut source)?;
        return Ok(RuntimeAttachmentCopyReceipt {
            authority_safe_leaf,
            kind: "file".to_string(),
            file_count: 1,
            directory_count: 0,
            node_count: 1,
            byte_size,
            content_digest: format!(
                "sha256:{}",
                digest
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>()
            ),
        });
    }
    if metadata.kind != OpenedNodeKind::Directory {
        return Err(anyhow::Error::new(LocalAttachmentError::Unsupported)
            .context("Runtime Attachment copy contains an unsupported root node"));
    }
    let mut state = DirectorySnapshotState {
        hasher: Sha256::new(),
        file_count: 0,
        directory_count: 1,
        entry_count: 0,
        byte_size: 0,
    };
    state.hasher.update(b"rovai-directory-snapshot-v1\0");
    inspect_open_directory_snapshot(
        &source,
        Path::new(""),
        0,
        fingerprint_volume(&metadata.fingerprint),
        &mut state,
    )?;
    Ok(RuntimeAttachmentCopyReceipt {
        authority_safe_leaf,
        kind: "directory".to_string(),
        file_count: state.file_count,
        directory_count: state.directory_count,
        node_count: state
            .file_count
            .checked_add(state.directory_count)
            .context("Runtime Attachment node count overflow")?,
        byte_size: state.byte_size,
        content_digest: format!("sha256:{:x}", state.hasher.finalize()),
    })
}

#[derive(Debug)]
pub struct LocalAttachmentSnapshot {
    pub path: PathBuf,
    pub display_name: String,
    pub kind: String,
    pub file_count: u64,
    pub directory_count: u64,
    pub node_count: u64,
    pub media_type: String,
    pub byte_size: u64,
    pub content_digest: String,
    pub preview_kind: String,
}

pub(crate) fn copy_and_inspect(
    source_path: &Path,
    destination: &Path,
) -> Result<LocalAttachmentSnapshot> {
    let source_path = source_path.components().collect::<PathBuf>();
    let mut source = open_source_without_following(&source_path)?;
    let opened = inspect_open_node(&source)?;
    if opened.kind == OpenedNodeKind::Directory {
        return copy_directory_snapshot(&source, destination);
    }
    if opened.kind != OpenedNodeKind::RegularFile {
        return Err(anyhow::Error::new(LocalAttachmentError::Unsupported)
            .context("Only regular files and directories can be attached"));
    }
    if fingerprint_size(&opened.fingerprint) > MAX_ATTACHMENT_BYTES {
        return Err(anyhow::Error::new(LocalAttachmentError::Limit)
            .context("Attachment exceeds the 25 MiB per-file limit"));
    }
    let temporary = destination.with_file_name(format!(".{}.tmp", Uuid::new_v4()));
    let mut destination_options = OpenOptions::new();
    destination_options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        destination_options.mode(0o600);
    }
    let mut output = destination_options.create_new(true).open(&temporary)?;
    let mut hasher = Sha256::new();
    let mut prefix = Vec::with_capacity(INSPECTION_PREFIX_BYTES);
    let mut byte_size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    let copied = (|| -> Result<()> {
        loop {
            let read = source.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            byte_size = byte_size
                .checked_add(read as u64)
                .context("Attachment size overflow")?;
            if byte_size > MAX_ATTACHMENT_BYTES {
                return Err(anyhow::Error::new(LocalAttachmentError::Limit)
                    .context("Attachment exceeds the 25 MiB per-file limit"));
            }
            if prefix.len() < INSPECTION_PREFIX_BYTES {
                let remaining = INSPECTION_PREFIX_BYTES - prefix.len();
                prefix.extend_from_slice(&buffer[..read.min(remaining)]);
            }
            hasher.update(&buffer[..read]);
            output.write_all(&buffer[..read])?;
        }
        output.sync_all()?;
        Ok(())
    })();
    if let Err(error) = copied {
        drop(output);
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    let after = inspect_open_node(&source)?;
    if after.kind != OpenedNodeKind::RegularFile
        || byte_size != fingerprint_size(&opened.fingerprint)
        || after.fingerprint != opened.fingerprint
    {
        drop(output);
        let _ = fs::remove_file(&temporary);
        return Err(anyhow::Error::new(LocalAttachmentError::Changed)
            .context("Attachment changed while it was being copied"));
    }
    set_read_only(&temporary)?;
    drop(output);
    commit_temporary(&temporary, destination)?;
    sync_parent(destination)?;
    let inspection = inspect_prefix(&prefix, byte_size);
    Ok(LocalAttachmentSnapshot {
        path: destination.to_path_buf(),
        display_name: destination
            .file_name()
            .and_then(|name| name.to_str())
            .context("Attachment display name is unavailable")?
            .to_string(),
        kind: "file".to_string(),
        file_count: 1,
        directory_count: 0,
        node_count: 1,
        media_type: inspection.media_type,
        byte_size,
        content_digest: format!("sha256:{:x}", hasher.finalize()),
        preview_kind: inspection.preview_kind,
    })
}

#[cfg(any(unix, windows))]
#[derive(Debug)]
struct DirectorySnapshotState {
    hasher: Sha256,
    file_count: u64,
    directory_count: u64,
    entry_count: u64,
    byte_size: u64,
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MetadataFingerprint {
    device: u64,
    inode: u64,
    link_count: u64,
    size: u64,
    modified_seconds: i64,
    modified_nanoseconds: i64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
}

#[cfg(windows)]
type MetadataFingerprint = crate::platform::windows_file_tree::FileFingerprint;

#[cfg(any(unix, windows))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenedNodeKind {
    RegularFile,
    Directory,
    #[cfg(unix)]
    Unsupported,
}

#[cfg(any(unix, windows))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OpenedNodeMetadata {
    kind: OpenedNodeKind,
    fingerprint: MetadataFingerprint,
    link_count: u64,
}

#[cfg(any(unix, windows))]
fn copy_directory_snapshot(source: &File, destination: &Path) -> Result<LocalAttachmentSnapshot> {
    let root_metadata = inspect_open_node(source)?;
    if root_metadata.kind != OpenedNodeKind::Directory {
        return Err(anyhow::Error::new(LocalAttachmentError::Changed)
            .context("Attachment directory changed before snapshotting"));
    }

    ensure_directory(destination)?;
    let mut state = DirectorySnapshotState {
        hasher: Sha256::new(),
        file_count: 0,
        directory_count: 1,
        entry_count: 0,
        byte_size: 0,
    };
    state.hasher.update(b"rovai-directory-snapshot-v1\0");
    copy_open_directory(
        source,
        destination,
        Path::new(""),
        0,
        fingerprint_volume(&root_metadata.fingerprint),
        &mut state,
    )?;
    set_directory_read_only(destination)?;
    sync_parent(destination)?;
    Ok(LocalAttachmentSnapshot {
        path: destination.to_path_buf(),
        display_name: destination
            .file_name()
            .and_then(|name| name.to_str())
            .context("Attachment display name is unavailable")?
            .to_string(),
        kind: "directory".to_string(),
        file_count: state.file_count,
        directory_count: state.directory_count,
        node_count: state
            .file_count
            .checked_add(state.directory_count)
            .context("Attachment directory node count overflow")?,
        media_type: DIRECTORY_MEDIA_TYPE.to_string(),
        byte_size: state.byte_size,
        content_digest: format!("sha256:{:x}", state.hasher.finalize()),
        preview_kind: "none".to_string(),
    })
}

#[cfg(any(unix, windows))]
fn copy_open_directory(
    source: &File,
    destination: &Path,
    relative_path: &Path,
    depth: usize,
    root_volume: u64,
    state: &mut DirectorySnapshotState,
) -> Result<()> {
    if depth > MAX_DIRECTORY_DEPTH {
        return Err(anyhow::Error::new(LocalAttachmentError::Limit)
            .context("Attachment directory exceeds the 32-level depth limit"));
    }
    let before = inspect_open_node(source)?;
    if before.kind != OpenedNodeKind::Directory {
        return Err(anyhow::Error::new(LocalAttachmentError::Changed)
            .context("Attachment directory changed while it was being copied"));
    }
    if fingerprint_volume(&before.fingerprint) != root_volume {
        return Err(anyhow::Error::new(LocalAttachmentError::Unsupported)
            .context("Attachment directory contains a mount or volume escape"));
    }
    hash_tree_entry(&mut state.hasher, b'D', relative_path, 0, None)?;
    let names = read_directory_names(source, MAX_DIRECTORY_ENTRIES as usize)?;
    for name in &names {
        state.entry_count = state
            .entry_count
            .checked_add(1)
            .context("Attachment directory entry count overflow")?;
        if state.entry_count > MAX_DIRECTORY_ENTRIES {
            return Err(anyhow::Error::new(LocalAttachmentError::Limit)
                .context("Attachment directory exceeds the 4000-entry limit"));
        }
        let mut child = open_child_without_following(source, name)?;
        let metadata = inspect_open_node(&child)?;
        if fingerprint_volume(&metadata.fingerprint) != root_volume {
            return Err(anyhow::Error::new(LocalAttachmentError::Unsupported)
                .context("Attachment directory contains a mount or volume escape"));
        }
        let child_relative = relative_path.join(name);
        let child_destination = destination.join(name);
        if metadata.kind == OpenedNodeKind::Directory {
            state.directory_count = state
                .directory_count
                .checked_add(1)
                .context("Attachment directory count overflow")?;
            ensure_directory(&child_destination)?;
            copy_open_directory(
                &child,
                &child_destination,
                &child_relative,
                depth + 1,
                root_volume,
                state,
            )?;
            set_directory_read_only(&child_destination)?;
        } else if metadata.kind == OpenedNodeKind::RegularFile {
            state.file_count = state
                .file_count
                .checked_add(1)
                .context("Attachment directory file count overflow")?;
            if state.file_count > MAX_DIRECTORY_FILES {
                return Err(anyhow::Error::new(LocalAttachmentError::Limit)
                    .context("Attachment directory exceeds the 2000-file limit"));
            }
            let child_size = fingerprint_size(&metadata.fingerprint);
            if child_size > MAX_ATTACHMENT_BYTES {
                return Err(anyhow::Error::new(LocalAttachmentError::Limit).context(
                    "A file in the attachment directory exceeds the 25 MiB per-file limit",
                ));
            }
            if state.byte_size.saturating_add(child_size) > MAX_DRAFT_ATTACHMENT_BYTES {
                return Err(anyhow::Error::new(LocalAttachmentError::Limit)
                    .context("Attachment directory exceeds the 64 MiB total limit"));
            }
            let copied = copy_open_regular_file(&mut child, &child_destination)?;
            state.byte_size = state
                .byte_size
                .checked_add(copied.byte_size)
                .context("Attachment directory size overflow")?;
            hash_tree_entry(
                &mut state.hasher,
                b'F',
                &child_relative,
                copied.byte_size,
                Some(&copied.digest),
            )?;
        } else {
            return Err(
                anyhow::Error::new(LocalAttachmentError::Unsupported).context(format!(
                    "Attachment directory contains an unsupported item: {}",
                    child_relative.to_string_lossy()
                )),
            );
        }
    }
    let after = inspect_open_node(source)?;
    if names != read_directory_names(source, MAX_DIRECTORY_ENTRIES as usize)?
        || after.kind != OpenedNodeKind::Directory
        || before.fingerprint != after.fingerprint
    {
        return Err(anyhow::Error::new(LocalAttachmentError::Changed)
            .context("Attachment directory changed while it was being copied"));
    }
    Ok(())
}

#[cfg(any(unix, windows))]
struct CopiedDirectoryFile {
    byte_size: u64,
    digest: [u8; 32],
}

#[cfg(any(unix, windows))]
fn copy_open_regular_file(source: &mut File, destination: &Path) -> Result<CopiedDirectoryFile> {
    let before = inspect_open_node(source)?;
    if before.kind != OpenedNodeKind::RegularFile {
        return Err(anyhow::Error::new(LocalAttachmentError::Changed)
            .context("Attachment directory item changed type while it was being copied"));
    }
    if fingerprint_size(&before.fingerprint) > MAX_ATTACHMENT_BYTES {
        return Err(anyhow::Error::new(LocalAttachmentError::Limit)
            .context("A file in the attachment directory exceeds the 25 MiB per-file limit"));
    }
    let temporary = destination.with_file_name(format!(".{}.tmp", Uuid::new_v4()));
    let mut destination_options = OpenOptions::new();
    destination_options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        destination_options.mode(0o600);
    }
    let mut output = destination_options.open(&temporary)?;
    let mut hasher = Sha256::new();
    let mut byte_size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    let copied = (|| -> Result<()> {
        loop {
            let read = source.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            byte_size = byte_size
                .checked_add(read as u64)
                .context("Attachment file size overflow")?;
            if byte_size > MAX_ATTACHMENT_BYTES {
                return Err(anyhow::Error::new(LocalAttachmentError::Limit).context(
                    "A file in the attachment directory exceeds the 25 MiB per-file limit",
                ));
            }
            hasher.update(&buffer[..read]);
            output.write_all(&buffer[..read])?;
        }
        output.sync_all()?;
        Ok(())
    })();
    if let Err(error) = copied {
        drop(output);
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    let after = inspect_open_node(source)?;
    if after.kind != OpenedNodeKind::RegularFile
        || byte_size != fingerprint_size(&before.fingerprint)
        || before.fingerprint != after.fingerprint
    {
        drop(output);
        let _ = fs::remove_file(&temporary);
        return Err(anyhow::Error::new(LocalAttachmentError::Changed)
            .context("A file in the attachment directory changed while it was being copied"));
    }
    set_read_only(&temporary)?;
    drop(output);
    commit_temporary(&temporary, destination)?;
    sync_parent(destination)?;
    Ok(CopiedDirectoryFile {
        byte_size,
        digest: hasher.finalize().into(),
    })
}

fn inspect_open_regular_file(source: &mut File) -> Result<(u64, [u8; 32])> {
    let before = inspect_open_node(source)?;
    if before.kind != OpenedNodeKind::RegularFile || before.link_count != 1 {
        anyhow::bail!("Runtime Attachment file identity is unsafe");
    }
    if fingerprint_size(&before.fingerprint) > MAX_ATTACHMENT_BYTES {
        return Err(anyhow::Error::new(LocalAttachmentError::Limit)
            .context("Runtime Attachment file exceeds the per-file limit"));
    }
    let mut hasher = Sha256::new();
    let mut byte_size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = source.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        byte_size = byte_size
            .checked_add(read as u64)
            .context("Runtime Attachment file size overflow")?;
        if byte_size > MAX_ATTACHMENT_BYTES {
            return Err(anyhow::Error::new(LocalAttachmentError::Limit)
                .context("Runtime Attachment file exceeds the per-file limit"));
        }
        hasher.update(&buffer[..read]);
    }
    let after = inspect_open_node(source)?;
    if after.kind != OpenedNodeKind::RegularFile
        || after.link_count != 1
        || byte_size != fingerprint_size(&before.fingerprint)
        || before.fingerprint != after.fingerprint
    {
        return Err(anyhow::Error::new(LocalAttachmentError::Changed)
            .context("Runtime Attachment file changed while it was inspected"));
    }
    Ok((byte_size, hasher.finalize().into()))
}

fn inspect_open_directory_snapshot(
    source: &File,
    relative_path: &Path,
    depth: usize,
    root_volume: u64,
    state: &mut DirectorySnapshotState,
) -> Result<()> {
    if depth > MAX_DIRECTORY_DEPTH {
        return Err(anyhow::Error::new(LocalAttachmentError::Limit)
            .context("Runtime Attachment directory exceeds the depth limit"));
    }
    let before = inspect_open_node(source)?;
    if before.kind != OpenedNodeKind::Directory
        || fingerprint_volume(&before.fingerprint) != root_volume
    {
        anyhow::bail!("Runtime Attachment directory identity is unsafe");
    }
    hash_tree_entry(&mut state.hasher, b'D', relative_path, 0, None)?;
    let names = read_directory_names(source, MAX_DIRECTORY_ENTRIES as usize)?;
    for name in &names {
        state.entry_count = state
            .entry_count
            .checked_add(1)
            .context("Runtime Attachment directory entry count overflow")?;
        if state.entry_count > MAX_DIRECTORY_ENTRIES {
            return Err(anyhow::Error::new(LocalAttachmentError::Limit)
                .context("Runtime Attachment directory exceeds the entry limit"));
        }
        let mut child = open_child_without_following(source, name)?;
        let metadata = inspect_open_node(&child)?;
        if fingerprint_volume(&metadata.fingerprint) != root_volume {
            return Err(anyhow::Error::new(LocalAttachmentError::Unsupported)
                .context("Runtime Attachment directory contains a mount or volume escape"));
        }
        let child_relative = relative_path.join(name);
        if metadata.kind == OpenedNodeKind::Directory {
            state.directory_count = state
                .directory_count
                .checked_add(1)
                .context("Runtime Attachment directory count overflow")?;
            inspect_open_directory_snapshot(
                &child,
                &child_relative,
                depth + 1,
                root_volume,
                state,
            )?;
        } else if metadata.kind == OpenedNodeKind::RegularFile {
            if metadata.link_count != 1 {
                anyhow::bail!("Runtime Attachment directory contains a hard-linked file");
            }
            state.file_count = state
                .file_count
                .checked_add(1)
                .context("Runtime Attachment directory file count overflow")?;
            if state.file_count > MAX_DIRECTORY_FILES {
                return Err(anyhow::Error::new(LocalAttachmentError::Limit)
                    .context("Runtime Attachment directory exceeds the file-count limit"));
            }
            let (byte_size, digest) = inspect_open_regular_file(&mut child)?;
            state.byte_size = state
                .byte_size
                .checked_add(byte_size)
                .context("Runtime Attachment directory size overflow")?;
            if state.byte_size > MAX_DRAFT_ATTACHMENT_BYTES {
                return Err(anyhow::Error::new(LocalAttachmentError::Limit)
                    .context("Runtime Attachment directory exceeds the byte limit"));
            }
            hash_tree_entry(
                &mut state.hasher,
                b'F',
                &child_relative,
                byte_size,
                Some(&digest),
            )?;
        } else {
            return Err(anyhow::Error::new(LocalAttachmentError::Unsupported)
                .context("Runtime Attachment directory contains an unsupported node"));
        }
    }
    let after = inspect_open_node(source)?;
    if names != read_directory_names(source, MAX_DIRECTORY_ENTRIES as usize)?
        || after.kind != OpenedNodeKind::Directory
        || before.fingerprint != after.fingerprint
    {
        return Err(anyhow::Error::new(LocalAttachmentError::Changed)
            .context("Runtime Attachment directory changed while it was inspected"));
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn open_source_without_following(path: &Path) -> Result<File> {
    use std::os::unix::fs::OpenOptionsExt;

    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
    match options.open(path) {
        Ok(file) => Ok(file),
        Err(error) if error.raw_os_error() == Some(libc::ELOOP) => {
            Err(anyhow::Error::new(LocalAttachmentError::Unsupported)
                .context("Attachment symlinks are not supported"))
        }
        Err(error) => {
            Err(error).with_context(|| format!("failed to open attachment {}", path.display()))
        }
    }
}

#[cfg(windows)]
pub(crate) fn open_source_without_following(path: &Path) -> Result<File> {
    crate::platform::windows_file_tree::open_path_without_following(path)
}

#[cfg(unix)]
fn open_child_without_following(directory: &File, name: &OsString) -> Result<File> {
    let name_bytes = name.as_os_str().as_bytes();
    let c_name = CString::new(name_bytes).context("Attachment name contains a NUL byte")?;
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            c_name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
        )
    };
    if descriptor < 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ELOOP) {
            return Err(anyhow::Error::new(LocalAttachmentError::Unsupported)
                .context("Attachment directory contains a symbolic link"));
        }
        return Err(error).with_context(|| {
            format!(
                "failed to open attachment directory item {}",
                name.to_string_lossy()
            )
        });
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(windows)]
fn open_child_without_following(directory: &File, name: &OsString) -> Result<File> {
    crate::platform::windows_file_tree::open_child_without_following(directory, name)
}

#[cfg(unix)]
fn read_directory_names(directory: &File, maximum_names: usize) -> Result<Vec<OsString>> {
    let duplicated = unsafe { libc::dup(directory.as_raw_fd()) };
    if duplicated < 0 {
        return Err(std::io::Error::last_os_error())
            .context("failed to duplicate directory handle");
    }
    let stream = unsafe { libc::fdopendir(duplicated) };
    if stream.is_null() {
        let error = std::io::Error::last_os_error();
        unsafe { libc::close(duplicated) };
        return Err(error).context("failed to enumerate attachment directory");
    }
    unsafe { libc::rewinddir(stream) };
    let mut names = Vec::new();
    loop {
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            break;
        }
        let bytes = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if bytes == b"." || bytes == b".." {
            continue;
        }
        names.push(OsString::from_vec(bytes.to_vec()));
        if names.len() > maximum_names {
            unsafe { libc::closedir(stream) };
            return Err(anyhow::Error::new(LocalAttachmentError::Limit)
                .context("Attachment directory exceeds the 4000-entry limit"));
        }
    }
    let close_result = unsafe { libc::closedir(stream) };
    if close_result != 0 {
        return Err(std::io::Error::last_os_error()).context("failed to close directory handle");
    }
    names.sort_by(|left, right| {
        left.as_os_str()
            .as_bytes()
            .cmp(right.as_os_str().as_bytes())
    });
    let unique = names
        .iter()
        .map(|name| name.as_os_str().as_bytes())
        .collect::<BTreeSet<_>>();
    if unique.len() != names.len() {
        anyhow::bail!("Attachment directory contains duplicate entry names");
    }
    Ok(names)
}

#[cfg(unix)]
fn inspect_open_node(file: &File) -> Result<OpenedNodeMetadata> {
    use std::os::unix::fs::MetadataExt;

    let metadata = file.metadata()?;
    let kind = if metadata.is_file() {
        OpenedNodeKind::RegularFile
    } else if metadata.is_dir() {
        OpenedNodeKind::Directory
    } else {
        OpenedNodeKind::Unsupported
    };
    Ok(OpenedNodeMetadata {
        kind,
        fingerprint: MetadataFingerprint {
            device: metadata.dev(),
            inode: metadata.ino(),
            link_count: metadata.nlink(),
            size: metadata.size(),
            modified_seconds: metadata.mtime(),
            modified_nanoseconds: metadata.mtime_nsec(),
            changed_seconds: metadata.ctime(),
            changed_nanoseconds: metadata.ctime_nsec(),
        },
        link_count: metadata.nlink(),
    })
}

#[cfg(unix)]
fn hash_tree_entry(
    hasher: &mut Sha256,
    kind: u8,
    relative_path: &Path,
    byte_size: u64,
    digest: Option<&[u8; 32]>,
) -> Result<()> {
    let path = relative_path.as_os_str().as_bytes();
    hasher.update([kind]);
    hasher.update((path.len() as u64).to_be_bytes());
    hasher.update(path);
    hasher.update(byte_size.to_be_bytes());
    if let Some(digest) = digest {
        hasher.update(digest);
    }
    Ok(())
}

#[cfg(windows)]
fn inspect_open_node(file: &File) -> Result<OpenedNodeMetadata> {
    use crate::platform::windows_file_tree::NodeKind;

    let metadata = crate::platform::windows_file_tree::inspect_node(file).map_err(|error| {
        // Preserve Core's existing diagnostic; the CLI only projects the typed category.
        let message = error.to_string();
        error
            .context(LocalAttachmentError::Unsupported)
            .context(message)
    })?;
    Ok(OpenedNodeMetadata {
        kind: match metadata.kind {
            NodeKind::RegularFile => OpenedNodeKind::RegularFile,
            NodeKind::Directory => OpenedNodeKind::Directory,
        },
        fingerprint: metadata.fingerprint,
        link_count: metadata.number_of_links as u64,
    })
}

#[cfg(unix)]
fn fingerprint_volume(fingerprint: &MetadataFingerprint) -> u64 {
    fingerprint.device
}

#[cfg(windows)]
fn fingerprint_volume(fingerprint: &MetadataFingerprint) -> u64 {
    fingerprint.volume_serial_number
}

#[cfg(windows)]
fn read_directory_names(directory: &File, maximum_names: usize) -> Result<Vec<OsString>> {
    crate::platform::windows_file_tree::read_directory_names(directory, maximum_names)
}

#[cfg(windows)]
fn hash_tree_entry(
    hasher: &mut Sha256,
    kind: u8,
    relative_path: &Path,
    byte_size: u64,
    digest: Option<&[u8; 32]>,
) -> Result<()> {
    let mut path = Vec::new();
    for component in relative_path.components() {
        let std::path::Component::Normal(name) = component else {
            anyhow::bail!("Attachment directory produced a non-relative canonical path");
        };
        if !path.is_empty() {
            path.push(b'/');
        }
        path.extend_from_slice(
            name.to_str()
                .context("Attachment filename is not valid Unicode")?
                .as_bytes(),
        );
    }
    hasher.update([kind]);
    hasher.update((path.len() as u64).to_be_bytes());
    hasher.update(&path);
    hasher.update(byte_size.to_be_bytes());
    if let Some(digest) = digest {
        hasher.update(digest);
    }
    Ok(())
}

#[cfg(unix)]
fn fingerprint_size(fingerprint: &MetadataFingerprint) -> u64 {
    fingerprint.size
}

#[cfg(windows)]
fn fingerprint_size(fingerprint: &MetadataFingerprint) -> u64 {
    fingerprint.size
}

#[derive(Debug)]
pub(crate) struct PrefixInspection {
    pub(crate) media_type: String,
    pub(crate) preview_kind: String,
}

pub(crate) fn inspect_prefix(prefix: &[u8], byte_size: u64) -> PrefixInspection {
    let image = image_dimensions(prefix);
    if let Some((media_type, width, height)) = image {
        let safe_dimensions = width > 0
            && height > 0
            && width <= MAX_PREVIEW_EDGE
            && height <= MAX_PREVIEW_EDGE
            && width.saturating_mul(height) <= MAX_PREVIEW_PIXELS;
        return PrefixInspection {
            media_type: media_type.to_string(),
            preview_kind: if safe_dimensions && byte_size <= MAX_PREVIEW_BYTES {
                "image"
            } else {
                "none"
            }
            .to_string(),
        };
    }
    let media_type = if prefix.starts_with(b"%PDF-") {
        "application/pdf"
    } else if prefix.starts_with(b"PK\x03\x04") {
        "application/zip"
    } else if std::str::from_utf8(prefix).is_ok() && !prefix.contains(&0) {
        "text/plain; charset=utf-8"
    } else {
        "application/octet-stream"
    };
    PrefixInspection {
        media_type: media_type.to_string(),
        preview_kind: "none".to_string(),
    }
}

fn image_dimensions(bytes: &[u8]) -> Option<(&'static str, u64, u64)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() >= 24 {
        return Some((
            "image/png",
            u32::from_be_bytes(bytes[16..20].try_into().ok()?) as u64,
            u32::from_be_bytes(bytes[20..24].try_into().ok()?) as u64,
        ));
    }
    if (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) && bytes.len() >= 10 {
        return Some((
            "image/gif",
            u16::from_le_bytes(bytes[6..8].try_into().ok()?) as u64,
            u16::from_le_bytes(bytes[8..10].try_into().ok()?) as u64,
        ));
    }
    if bytes.starts_with(b"\xff\xd8") {
        return jpeg_dimensions(bytes).map(|(width, height)| ("image/jpeg", width, height));
    }
    if bytes.len() >= 30 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return webp_dimensions(bytes).map(|(width, height)| ("image/webp", width, height));
    }
    None
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u64, u64)> {
    let mut offset = 2_usize;
    while offset + 4 <= bytes.len() {
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        let marker = *bytes.get(offset)?;
        offset += 1;
        if marker == 0xd9 || marker == 0xda {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        let length = u16::from_be_bytes(bytes.get(offset..offset + 2)?.try_into().ok()?) as usize;
        if length < 2 || offset + length > bytes.len() {
            return None;
        }
        if matches!(
            marker,
            0xc0 | 0xc1
                | 0xc2
                | 0xc3
                | 0xc5
                | 0xc6
                | 0xc7
                | 0xc9
                | 0xca
                | 0xcb
                | 0xcd
                | 0xce
                | 0xcf
        ) && length >= 8
        {
            let height =
                u16::from_be_bytes(bytes.get(offset + 3..offset + 5)?.try_into().ok()?) as u64;
            let width =
                u16::from_be_bytes(bytes.get(offset + 5..offset + 7)?.try_into().ok()?) as u64;
            return Some((width, height));
        }
        offset += length;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u64, u64)> {
    match bytes.get(12..16)? {
        b"VP8X" if bytes.len() >= 30 => {
            let width = 1 + u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]) as u64;
            let height = 1 + u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]) as u64;
            Some((width, height))
        }
        b"VP8L" if bytes.len() >= 25 && bytes[20] == 0x2f => {
            let bits = u32::from_le_bytes(bytes[21..25].try_into().ok()?);
            Some((
                ((bits & 0x3fff) + 1) as u64,
                (((bits >> 14) & 0x3fff) + 1) as u64,
            ))
        }
        b"VP8 " if bytes.len() >= 30 && &bytes[23..26] == b"\x9d\x01\x2a" => Some((
            (u16::from_le_bytes(bytes[26..28].try_into().ok()?) & 0x3fff) as u64,
            (u16::from_le_bytes(bytes[28..30].try_into().ok()?) & 0x3fff) as u64,
        )),
        _ => None,
    }
}

pub(crate) fn normalize_display_name(value: &str) -> Result<String> {
    let normalized = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\'
                        | ':'
                        | '\0'
                        | '\u{202a}'
                        | '\u{202b}'
                        | '\u{202c}'
                        | '\u{202d}'
                        | '\u{202e}'
                        | '\u{2066}'
                        | '\u{2067}'
                        | '\u{2068}'
                        | '\u{2069}'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    let normalized = normalized.trim_matches([' ', '.']).trim();
    if normalized.is_empty() {
        anyhow::bail!("Attachment file name is empty");
    }
    Ok(normalized.chars().take(120).collect())
}

pub(crate) fn validate_runtime_safe_leaf(value: &str) -> Result<()> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.ends_with([' ', '.'])
        || value
            .chars()
            .any(|character| matches!(character, '/' | '\\' | ':' | '\0'))
    {
        anyhow::bail!("Authority Attachment safe leaf is invalid for Runtime View");
    }
    let stem = value
        .split('.')
        .next()
        .unwrap_or(value)
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem.strip_prefix("COM").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
        || stem.strip_prefix("LPT").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        });
    if reserved {
        anyhow::bail!("Authority Attachment safe leaf is a reserved Runtime View name");
    }
    Ok(())
}

pub(crate) fn validate_runtime_source_tree(path: &Path, depth: usize) -> Result<()> {
    if depth > MAX_DIRECTORY_DEPTH {
        return Err(anyhow::Error::new(LocalAttachmentError::Limit)
            .context("Camp Attachment Runtime View source exceeds the depth limit"));
    }
    let source = open_source_without_following(path)?;
    let metadata = inspect_open_node(&source)?;
    if metadata.kind == OpenedNodeKind::RegularFile {
        if metadata.link_count != 1 {
            anyhow::bail!("Camp Attachment Runtime View source contains a hard-linked file");
        }
        return Ok(());
    }
    if metadata.kind != OpenedNodeKind::Directory {
        return Err(anyhow::Error::new(LocalAttachmentError::Unsupported)
            .context("Camp Attachment Runtime View source contains an unsupported node"));
    }
    let mut children = fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()?;
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        validate_runtime_source_tree(&child.path(), depth + 1)?;
    }
    Ok(())
}

pub(crate) fn ensure_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("Attachment directory is unsafe");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub(crate) fn allow_directory_update(_path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(_path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub(crate) fn set_read_only(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o400))?;
    }
    #[cfg(not(unix))]
    {
        let mut permissions = fs::metadata(path)?.permissions();
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

pub(crate) fn set_directory_read_only(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o500))?;
    }
    #[cfg(windows)]
    {
        // FILE_ATTRIBUTE_READONLY has no directory access-control semantics.
        // The Windows managed root supplies the private DACL; freezing its
        // descendant ACLs is owned by the separate private-storage checkpoint.
        let _ = path;
    }
    Ok(())
}

pub(crate) fn remove_attachment_directory(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        anyhow::bail!("Attachment directory is unsafe");
    }
    make_owned_tree_removable(path)?;
    fs::remove_dir_all(path)?;
    Ok(())
}

pub(crate) fn make_owned_tree_removable(path: &Path) -> Result<()> {
    allow_directory_update(path)?;
    let children = fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()?;
    for child in children {
        let child_path = child.path();
        let metadata = fs::symlink_metadata(&child_path)?;
        if metadata.file_type().is_symlink() {
            return Err(anyhow::Error::new(LocalAttachmentError::Unsupported)
                .context("Attachment directory contains an unsafe symbolic link"));
        }
        if metadata.is_dir() {
            make_owned_tree_removable(&child_path)?;
        } else {
            allow_file_update(&child_path)?;
        }
    }
    Ok(())
}

fn allow_file_update(_path: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        crate::platform::windows_file_tree::clear_read_only(_path)?;
    }
    Ok(())
}

#[cfg(unix)]
pub(crate) fn commit_temporary(source: &Path, destination: &Path) -> Result<()> {
    fs::rename(source, destination)?;
    Ok(())
}

#[cfg(windows)]
pub(crate) fn commit_temporary(source: &Path, destination: &Path) -> Result<()> {
    crate::platform::windows_file_tree::commit_temporary(source, destination)
}

#[cfg(unix)]
pub fn sync_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(windows)]
pub fn sync_parent(_path: &Path) -> Result<()> {
    // Windows documents FlushFileBuffers for writable file handles, not as a
    // directory-fsync primitive. Files are flushed before MOVEFILE_WRITE_THROUGH
    // commits their same-directory rename in commit_temporary.
    Ok(())
}

/// Safe categories survive internal anyhow context without exposing source paths.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalAttachmentError {
    Unsupported,
    Changed,
    Limit,
    InvalidPath,
}

impl std::fmt::Display for LocalAttachmentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Unsupported => "attachment type is unsupported",
            Self::Changed => "attachment changed while being copied",
            Self::Limit => "attachment exceeds the size or tree limit",
            Self::InvalidPath => "attachment path is invalid",
        })
    }
}
impl std::error::Error for LocalAttachmentError {}

/// Copy into a caller-owned private directory using exactly the Core ingest primitives.
pub fn snapshot_local_attachment(
    source: &Path,
    destination_root: &Path,
) -> Result<LocalAttachmentSnapshot> {
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .context(LocalAttachmentError::InvalidPath)?;
    let display_name = normalize_display_name(name)?;
    ensure_directory(destination_root)?;
    copy_and_inspect(source, &destination_root.join(display_name))
}

/// Bounded metadata preflight. Core still checks actual bytes during its own copy.
/// Source hard links are allowed, just as in copy_and_inspect; the copy never preserves them.
pub fn local_attachment_byte_size(path: &Path) -> Result<u64> {
    let source = open_source_without_following(path)?;
    let metadata = inspect_open_node(&source)?;
    let mut state = SourceSize::default();
    measure_source(
        &source,
        0,
        fingerprint_volume(&metadata.fingerprint),
        &mut state,
    )?;
    Ok(state.bytes)
}

#[derive(Default)]
struct SourceSize {
    bytes: u64,
    files: u64,
    entries: u64,
}

fn measure_source(source: &File, depth: usize, volume: u64, state: &mut SourceSize) -> Result<()> {
    let metadata = inspect_open_node(source)?;
    if depth > MAX_DIRECTORY_DEPTH || state.entries > MAX_DIRECTORY_ENTRIES {
        return Err(LocalAttachmentError::Limit.into());
    }
    if fingerprint_volume(&metadata.fingerprint) != volume {
        return Err(LocalAttachmentError::Unsupported.into());
    }
    match metadata.kind {
        OpenedNodeKind::RegularFile => {
            let bytes = fingerprint_size(&metadata.fingerprint);
            state.files += 1;
            state.bytes = state
                .bytes
                .checked_add(bytes)
                .context(LocalAttachmentError::Limit)?;
            if bytes > MAX_ATTACHMENT_BYTES
                || state.bytes > MAX_DRAFT_ATTACHMENT_BYTES
                || state.files > MAX_DIRECTORY_FILES
            {
                return Err(LocalAttachmentError::Limit.into());
            }
        }
        OpenedNodeKind::Directory => {
            for name in read_directory_names(source, MAX_DIRECTORY_ENTRIES as usize)? {
                state.entries += 1;
                let child = open_child_without_following(source, &name)?;
                // Core's depth limit counts directories, not leaf files.
                let child_depth = depth
                    + usize::from(inspect_open_node(&child)?.kind == OpenedNodeKind::Directory);
                measure_source(&child, child_depth, volume, state)?;
            }
        }
        #[cfg(unix)]
        OpenedNodeKind::Unsupported => return Err(LocalAttachmentError::Unsupported.into()),
    }
    Ok(())
}

/// Roots may have OS aliases above them (for example macOS /var). Descendant aliases are rejected.
pub fn reject_symlink_path(admitted_root: &Path, requested_source: &Path) -> Result<()> {
    let relative = requested_source
        .strip_prefix(admitted_root)
        .context(LocalAttachmentError::InvalidPath)?;
    let mut current = admitted_root.to_path_buf();
    for component in relative.components() {
        current.push(component.as_os_str());
        // A known child only requires ancestor traversal permission, not permission to list each parent.
        let metadata = fs::symlink_metadata(&current)?;
        #[cfg(windows)]
        let is_link = {
            use std::os::windows::fs::MetadataExt;
            metadata.file_attributes() & 0x400 != 0
        };
        #[cfg(not(windows))]
        let is_link = metadata.file_type().is_symlink();
        if is_link {
            return Err(anyhow::Error::new(LocalAttachmentError::Unsupported)
                .context("Attachment source path contains a symbolic link or reparse point"));
        }
    }
    Ok(())
}

/// Remove only a caller-owned tree, including frozen directories. Never chmod/follow a link.
pub fn remove_local_snapshot_tree(path: &Path) -> Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    #[cfg(windows)]
    let is_link = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let is_link = metadata.file_type().is_symlink();
    if is_link {
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_DIRECTORY;
            // symlink_metadata().is_dir() is false for directory symlinks/junctions.
            if metadata.file_attributes() & FILE_ATTRIBUTE_DIRECTORY != 0 {
                return fs::remove_dir(path).map_err(Into::into);
            }
        }
        return fs::remove_file(path).map_err(Into::into);
    }
    if metadata.is_dir() {
        allow_directory_update(path)?;
        for child in fs::read_dir(path)? {
            remove_local_snapshot_tree(&child?.path())?;
        }
        fs::remove_dir(path)?;
    } else {
        #[cfg(windows)]
        {
            // Delete this name without clearing attributes shared by any other hard link.
            let file = crate::platform::windows_file_tree::open_path_for_removal(path)?;
            crate::platform::windows_file_tree::delete_on_close(&file)?;
        }
        #[cfg(not(windows))]
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Retains the admitted directory handle so path replacement cannot silently change its identity.
pub struct LocalSnapshotRoot {
    path: PathBuf,
    directory: File,
}
impl LocalSnapshotRoot {
    pub fn open(path: &Path) -> Result<Self> {
        let directory = open_source_without_following(path)?;
        if inspect_open_node(&directory)?.kind != OpenedNodeKind::Directory {
            return Err(LocalAttachmentError::Unsupported.into());
        }
        Ok(Self {
            path: path.to_path_buf(),
            directory,
        })
    }
    pub fn validate(&self) -> Result<()> {
        let current = open_source_without_following(&self.path)?;
        let expected = inspect_open_node(&self.directory)?;
        let observed = inspect_open_node(&current)?;
        #[cfg(unix)]
        let same = expected.fingerprint.device == observed.fingerprint.device
            && expected.fingerprint.inode == observed.fingerprint.inode;
        #[cfg(windows)]
        let same = expected.fingerprint.volume_serial_number
            == observed.fingerprint.volume_serial_number
            && expected.fingerprint.file_id == observed.fingerprint.file_id;
        if !same || observed.kind != OpenedNodeKind::Directory {
            return Err(LocalAttachmentError::Changed.into());
        }
        Ok(())
    }
}

/// Publish a complete request directory without replacing any existing entry.
/// The caller must track the new owned path before calling sync_parent.
pub fn promote_local_snapshot_root(source: &Path, destination: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(source)?.sync_all()?;
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let from = CString::new(source.as_os_str().as_bytes())?;
        let to = CString::new(destination.as_os_str().as_bytes())?;
        // Both C strings are live for the call. Exclusive rename never replaces another request.
        #[cfg(target_os = "macos")]
        let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
        #[cfg(target_os = "linux")]
        let result = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                from.as_ptr(),
                libc::AT_FDCWD,
                to.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        if result != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{MOVEFILE_WRITE_THROUGH, MoveFileExW};
        let from = source
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let to = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        // NUL-terminated paths remain live; omitting REPLACE_EXISTING makes promotion exclusive.
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    anyhow::bail!("Exclusive attachment promotion is unsupported on this platform");
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RuntimeAttachmentCopyReceipt {
    pub authority_safe_leaf: String,
    pub kind: String,
    pub file_count: u64,
    pub directory_count: u64,
    pub node_count: u64,
    pub byte_size: u64,
    pub content_digest: String,
}
