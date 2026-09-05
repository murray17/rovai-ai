use std::{
    ffi::{OsStr, OsString},
    fs::File,
    io,
    mem::{offset_of, size_of},
    os::windows::{
        ffi::{OsStrExt, OsStringExt},
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    path::{Component, Path, Prefix},
    ptr::{null, null_mut},
};

use anyhow::{Context, Result, bail};
use windows_sys::{
    Wdk::{
        Foundation::OBJECT_ATTRIBUTES,
        Storage::FileSystem::{
            FILE_OPEN, FILE_OPEN_FOR_BACKUP_INTENT, FILE_OPEN_REPARSE_POINT,
            FILE_SYNCHRONOUS_IO_NONALERT, NtCreateFile,
        },
    },
    Win32::{
        Foundation::{
            ERROR_NO_MORE_FILES, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE,
            RtlNtStatusToDosError, SetHandleInformation, UNICODE_STRING,
        },
        Storage::FileSystem::{
            CreateFileW, DELETE, FILE_ATTRIBUTE_DEVICE, FILE_ATTRIBUTE_DIRECTORY,
            FILE_ATTRIBUTE_READONLY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO,
            FILE_BASIC_INFO, FILE_DISPOSITION_FLAG_DELETE,
            FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE, FILE_DISPOSITION_FLAG_POSIX_SEMANTICS,
            FILE_DISPOSITION_INFO, FILE_DISPOSITION_INFO_EX, FILE_FLAG_BACKUP_SEMANTICS,
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_GENERIC_READ, FILE_ID_BOTH_DIR_INFO, FILE_ID_INFO,
            FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_STANDARD_INFO,
            FileAttributeTagInfo, FileBasicInfo, FileDispositionInfo, FileDispositionInfoEx,
            FileIdBothDirectoryInfo, FileIdBothDirectoryRestartInfo, FileIdInfo, FileStandardInfo,
            GetFileAttributesW, GetFileInformationByHandleEx, INVALID_FILE_ATTRIBUTES,
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW, OPEN_EXISTING,
            SetFileAttributesW, SetFileInformationByHandle,
        },
        System::IO::IO_STATUS_BLOCK,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NodeKind {
    RegularFile,
    Directory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FileFingerprint {
    pub(crate) volume_serial_number: u64,
    pub(crate) file_id: [u8; 16],
    pub(crate) size: u64,
    pub(crate) last_write_time: i64,
    pub(crate) change_time: i64,
    pub(crate) attributes: u32,
    pub(crate) number_of_links: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct NodeMetadata {
    pub(crate) kind: NodeKind,
    pub(crate) fingerprint: FileFingerprint,
    pub(crate) number_of_links: u32,
}

/// Opens the selected source itself, rather than whatever a final reparse
/// point resolves to. Ancestors are resolved once by Windows; every descendant
/// is subsequently opened relative to this retained handle.
pub(crate) fn open_path_without_following(path: &Path) -> Result<File> {
    open_path_with_access(path, FILE_GENERIC_READ)
}

pub(crate) fn open_path_for_removal(path: &Path) -> Result<File> {
    open_path_with_access(path, FILE_GENERIC_READ | DELETE)
}

fn open_path_with_access(path: &Path, desired_access: u32) -> Result<File> {
    validate_source_path(path)?;
    let wide_path = wide_nul(path.as_os_str())?;
    let raw = unsafe {
        // SAFETY: wide_path is NUL-terminated. Null security attributes make
        // the new handle non-inheritable and OPEN_EXISTING creates no object.
        CreateFileW(
            wide_path.as_ptr(),
            desired_access,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            null_mut(),
        )
    };
    if raw == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error())
            .with_context(|| format!("failed to open attachment {}", path.display()));
    }
    owned_file(raw)
}

/// Opens exactly one enumerated child below `directory`. The object manager
/// receives the retained directory handle as RootDirectory, so no absolute
/// child path is re-resolved between enumeration and opening.
pub(crate) fn open_child_without_following(directory: &File, name: &OsStr) -> Result<File> {
    open_child_with_access(directory, name, FILE_GENERIC_READ)
}

pub(crate) fn open_child_for_removal(directory: &File, name: &OsStr) -> Result<File> {
    open_child_with_access(directory, name, FILE_GENERIC_READ | DELETE)
}

fn open_child_with_access(directory: &File, name: &OsStr, desired_access: u32) -> Result<File> {
    let mut name_wide = direct_name(name)?;
    let byte_length = name_wide
        .len()
        .checked_mul(size_of::<u16>())
        .context("attachment name length overflow")?;
    let byte_length = u16::try_from(byte_length).context("attachment name is too long")?;
    let object_name = UNICODE_STRING {
        Length: byte_length,
        MaximumLength: byte_length,
        Buffer: name_wide.as_mut_ptr(),
    };
    let attributes = OBJECT_ATTRIBUTES {
        Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: directory.as_raw_handle(),
        ObjectName: &object_name,
        Attributes: 0,
        SecurityDescriptor: null(),
        SecurityQualityOfService: null(),
    };
    let mut raw: HANDLE = null_mut();
    let mut io_status = IO_STATUS_BLOCK::default();
    let status = unsafe {
        // SAFETY: all structures and the UTF-16 name remain live for this call.
        // FILE_OPEN_REPARSE_POINT returns a handle to a final reparse point
        // instead of following it; inspect_node rejects such a handle.
        NtCreateFile(
            &mut raw,
            desired_access,
            &attributes,
            &mut io_status,
            null(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            FILE_OPEN,
            FILE_OPEN_FOR_BACKUP_INTENT | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            null(),
            0,
        )
    };
    if status < 0 {
        let error = ntstatus_error(status);
        return Err(error).with_context(|| {
            format!(
                "failed to open attachment directory item {}",
                name.to_string_lossy()
            )
        });
    }
    owned_file(raw)
}

/// Unlinks the exact opened file or empty directory using Windows 10 POSIX
/// disposition semantics. This removes the name even while a warm Runtime
/// retains a delete-sharing handle, so verified child names cannot keep their
/// parent directory artificially non-empty. Older filesystems fall back to
/// delete-on-close. Both forms target the retained handle, so a same-path
/// replacement cannot redirect this mutation to a different node.
pub(crate) fn delete_on_close(file: &File) -> Result<()> {
    let disposition_ex = FILE_DISPOSITION_INFO_EX {
        Flags: FILE_DISPOSITION_FLAG_DELETE
            | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS
            | FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
    };
    let deleted = unsafe {
        // SAFETY: file remains live and was opened with DELETE access. The
        // buffer has the exact type and byte length required by the class.
        SetFileInformationByHandle(
            file.as_raw_handle(),
            FileDispositionInfoEx,
            (&disposition_ex as *const FILE_DISPOSITION_INFO_EX).cast(),
            size_of::<FILE_DISPOSITION_INFO_EX>() as u32,
        )
    };
    if deleted != 0 {
        return Ok(());
    }
    let extended_error = io::Error::last_os_error();
    if !matches!(extended_error.raw_os_error(), Some(1 | 50 | 87)) {
        return Err(extended_error).context("failed to unlink opened Windows file-tree node");
    }

    let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
    let deleted = unsafe {
        // SAFETY: file remains live and was opened with DELETE access. The
        // buffer has the exact type and byte length required by the class.
        SetFileInformationByHandle(
            file.as_raw_handle(),
            FileDispositionInfo,
            (&disposition as *const FILE_DISPOSITION_INFO).cast(),
            size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    };
    if deleted == 0 {
        Err(io::Error::last_os_error()).context("failed to delete opened Windows file-tree node")
    } else {
        Ok(())
    }
}

pub(crate) fn inspect_node(file: &File) -> Result<NodeMetadata> {
    let mut attributes = FILE_ATTRIBUTE_TAG_INFO::default();
    read_file_information(file, FileAttributeTagInfo, &mut attributes)?;
    if attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        bail!("Attachment contains a Windows reparse point");
    }
    if attributes.FileAttributes & FILE_ATTRIBUTE_DEVICE != 0 {
        bail!("Attachment contains a Windows device object");
    }

    let mut standard = FILE_STANDARD_INFO::default();
    read_file_information(file, FileStandardInfo, &mut standard)?;
    if standard.DeletePending {
        bail!("Attachment changed while it was being inspected");
    }
    if standard.EndOfFile < 0 {
        bail!("Attachment has an invalid negative size");
    }
    let attribute_directory = attributes.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0;
    if attribute_directory != standard.Directory {
        bail!("Attachment returned inconsistent Windows type metadata");
    }
    let kind = if standard.Directory {
        NodeKind::Directory
    } else {
        NodeKind::RegularFile
    };

    let mut identity = FILE_ID_INFO::default();
    read_file_information(file, FileIdInfo, &mut identity)
        .context("Attachment filesystem does not expose stable file identity")?;
    let mut basic = FILE_BASIC_INFO::default();
    read_file_information(file, FileBasicInfo, &mut basic)?;
    Ok(NodeMetadata {
        kind,
        fingerprint: FileFingerprint {
            volume_serial_number: identity.VolumeSerialNumber,
            file_id: identity.FileId.Identifier,
            size: standard.EndOfFile as u64,
            last_write_time: basic.LastWriteTime,
            change_time: basic.ChangeTime,
            attributes: basic.FileAttributes,
            number_of_links: standard.NumberOfLinks,
        },
        number_of_links: standard.NumberOfLinks,
    })
}

/// Enumerates the retained directory handle from the beginning. Names are
/// admitted only when they have a lossless Unicode representation, then sorted
/// by their unnormalised UTF-8 bytes to match the canonical attachment tree.
pub(crate) fn read_directory_names(
    directory: &File,
    maximum_names: usize,
) -> Result<Vec<OsString>> {
    const BUFFER_BYTES: usize = 64 * 1024;
    let mut storage = vec![0_u64; BUFFER_BYTES / size_of::<u64>()];
    let buffer = unsafe {
        // SAFETY: storage is aligned for FILE_ID_BOTH_DIR_INFO and the byte
        // slice covers exactly its initialized allocation.
        std::slice::from_raw_parts_mut(storage.as_mut_ptr().cast::<u8>(), BUFFER_BYTES)
    };
    let mut restart = true;
    let mut names = Vec::new();
    loop {
        buffer.fill(0);
        let class = if restart {
            FileIdBothDirectoryRestartInfo
        } else {
            FileIdBothDirectoryInfo
        };
        let read = unsafe {
            // SAFETY: buffer is writable, correctly aligned, and advertises its
            // exact byte capacity. The directory handle remains live.
            GetFileInformationByHandleEx(
                directory.as_raw_handle(),
                class,
                buffer.as_mut_ptr().cast(),
                buffer.len() as u32,
            )
        };
        if read == 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error().map(|code| code as u32) == Some(ERROR_NO_MORE_FILES) {
                break;
            }
            return Err(error).context("failed to enumerate attachment directory handle");
        }
        restart = false;
        parse_directory_buffer(buffer, maximum_names, &mut names)?;
    }

    names.sort_by(|left, right| {
        left.to_str()
            .expect("Windows attachment names were validated as Unicode")
            .as_bytes()
            .cmp(
                right
                    .to_str()
                    .expect("Windows attachment names were validated as Unicode")
                    .as_bytes(),
            )
    });
    if names.windows(2).any(|pair| pair[0] == pair[1]) {
        bail!("Attachment directory contains duplicate entry names");
    }
    Ok(names)
}

/// Windows has no documented directory-fsync equivalent. Each temporary file
/// is flushed before this call, then MOVEFILE_WRITE_THROUGH requests the native
/// write-through form of the same-directory rename.
pub(crate) fn commit_temporary(source: &Path, destination: &Path) -> Result<()> {
    move_file(source, destination, MOVEFILE_WRITE_THROUGH)
}

pub(crate) fn replace_temporary(source: &Path, destination: &Path) -> Result<()> {
    move_file(
        source,
        destination,
        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
    )
}

fn move_file(source: &Path, destination: &Path, flags: u32) -> Result<()> {
    let source_wide = wide_nul(source.as_os_str())?;
    let destination_wide = wide_nul(destination.as_os_str())?;
    let moved = unsafe {
        // SAFETY: both paths are NUL-terminated and remain live. The selected
        // flags request only same-volume move/replace behavior, never copy.
        MoveFileExW(source_wide.as_ptr(), destination_wide.as_ptr(), flags)
    };
    if moved == 0 {
        Err(io::Error::last_os_error()).with_context(|| {
            format!(
                "failed to commit attachment {} to {}",
                source.display(),
                destination.display()
            )
        })
    } else {
        Ok(())
    }
}

pub(crate) fn clear_read_only(path: &Path) -> Result<()> {
    let wide_path = wide_nul(path.as_os_str())?;
    let attributes = unsafe {
        // SAFETY: wide_path is NUL-terminated and remains live for the call.
        GetFileAttributesW(wide_path.as_ptr())
    };
    if attributes == INVALID_FILE_ATTRIBUTES {
        return Err(io::Error::last_os_error())
            .with_context(|| format!("failed to inspect attachment {}", path.display()));
    }
    if attributes & FILE_ATTRIBUTE_READONLY != 0
        && unsafe {
            // SAFETY: wide_path remains live and the new mask changes only the
            // read-only attribute on this already-admitted owned file.
            SetFileAttributesW(wide_path.as_ptr(), attributes & !FILE_ATTRIBUTE_READONLY)
        } == 0
    {
        return Err(io::Error::last_os_error())
            .with_context(|| format!("failed to make attachment removable {}", path.display()));
    }
    Ok(())
}

fn parse_directory_buffer(
    buffer: &[u8],
    maximum_names: usize,
    names: &mut Vec<OsString>,
) -> Result<()> {
    let header_bytes = offset_of!(FILE_ID_BOTH_DIR_INFO, FileName);
    let mut offset = 0_usize;
    loop {
        let fixed_end = offset
            .checked_add(size_of::<FILE_ID_BOTH_DIR_INFO>())
            .context("Windows directory record offset overflow")?;
        let header_end = offset
            .checked_add(header_bytes)
            .context("Windows directory record offset overflow")?;
        if fixed_end > buffer.len() {
            bail!("Windows returned a truncated attachment directory record");
        }
        let entry = unsafe {
            // SAFETY: fixed_end above proves the complete fixed header is in
            // buffer. read_unaligned avoids relying on record alignment here.
            buffer
                .as_ptr()
                .add(offset)
                .cast::<FILE_ID_BOTH_DIR_INFO>()
                .read_unaligned()
        };
        let name_bytes = entry.FileNameLength as usize;
        if !name_bytes.is_multiple_of(size_of::<u16>()) {
            bail!("Windows returned a malformed attachment filename length");
        }
        let name_end = header_end
            .checked_add(name_bytes)
            .context("Windows attachment filename offset overflow")?;
        if name_end > buffer.len() {
            bail!("Windows returned a truncated attachment filename");
        }
        let name_units = unsafe {
            // SAFETY: the bounds and even byte length were checked above. The
            // kernel aligns the filename field to u16; use the exact live bytes.
            std::slice::from_raw_parts(
                buffer.as_ptr().add(header_end).cast::<u16>(),
                name_bytes / size_of::<u16>(),
            )
        };
        if name_units != [b'.' as u16] && name_units != [b'.' as u16, b'.' as u16] {
            validate_enumerated_name(name_units)?;
            names.push(OsString::from_wide(name_units));
            if names.len() > maximum_names {
                bail!("Attachment directory exceeds the 4000-entry limit");
            }
        }

        if entry.NextEntryOffset == 0 {
            break;
        }
        let next = entry.NextEntryOffset as usize;
        if !next.is_multiple_of(8) || next < header_bytes.saturating_add(name_bytes) {
            bail!("Windows returned an invalid attachment directory record offset");
        }
        offset = offset
            .checked_add(next)
            .context("Windows directory record offset overflow")?;
        if offset >= buffer.len() {
            bail!("Windows returned an out-of-bounds attachment directory record");
        }
    }
    Ok(())
}

fn validate_enumerated_name(name: &[u16]) -> Result<()> {
    if name.is_empty()
        || name
            .iter()
            .any(|unit| *unit == 0 || [b'/' as u16, b'\\' as u16, b':' as u16].contains(unit))
    {
        bail!("Attachment directory contains an unsafe Windows filename");
    }
    let name = String::from_utf16(name)
        .context("Attachment directory contains a filename that is not valid Unicode")?;
    if name == "."
        || name == ".."
        || name.chars().any(char::is_control)
        || name.ends_with([' ', '.'])
        || is_reserved_dos_name(&name)
    {
        bail!("Attachment directory contains an unsafe Windows filename");
    }
    Ok(())
}

fn is_reserved_dos_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name);
    if ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"]
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
    {
        return true;
    }
    let bytes = stem.as_bytes();
    bytes.len() == 4
        && (bytes[..3].eq_ignore_ascii_case(b"COM") || bytes[..3].eq_ignore_ascii_case(b"LPT"))
        && matches!(bytes[3], b'1'..=b'9')
}

fn direct_name(name: &OsStr) -> Result<Vec<u16>> {
    let wide = name.encode_wide().collect::<Vec<_>>();
    validate_enumerated_name(&wide)?;
    Ok(wide)
}

fn validate_source_path(path: &Path) -> Result<()> {
    if !path.is_absolute()
        || !matches!(
            path.components().next(),
            Some(Component::Prefix(component))
                if matches!(component.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        )
    {
        bail!("Windows attachments require an absolute local drive path");
    }
    let mut normal_components = 0_usize;
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => {}
            Component::Normal(name) => {
                direct_name(name)?;
                normal_components += 1;
            }
            Component::CurDir | Component::ParentDir => {
                bail!("Windows attachment path must be normalized")
            }
        }
    }
    if normal_components == 0 {
        bail!("Windows volume roots cannot be attached");
    }
    Ok(())
}

fn read_file_information<T>(file: &File, class: i32, output: &mut T) -> Result<()> {
    let read = unsafe {
        // SAFETY: output is the exact structure selected by the caller's
        // FILE_INFO_BY_HANDLE_CLASS and has the declared writable size.
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
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

fn owned_file(raw: HANDLE) -> Result<File> {
    if raw.is_null() || raw == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error()).context("Windows returned an invalid file handle");
    }
    let handle = unsafe {
        // SAFETY: raw is a newly returned valid handle and ownership moves once.
        OwnedHandle::from_raw_handle(raw)
    };
    if unsafe {
        // SAFETY: handle is live and clearing inheritance cannot broaden rights.
        SetHandleInformation(handle.as_raw_handle(), HANDLE_FLAG_INHERIT, 0)
    } == 0
    {
        return Err(io::Error::last_os_error())
            .context("failed to make attachment handle non-inheritable");
    }
    Ok(File::from(handle))
}

fn ntstatus_error(status: i32) -> io::Error {
    let code = unsafe {
        // SAFETY: conversion accepts any NTSTATUS value and returns a Win32 code.
        RtlNtStatusToDosError(status)
    };
    io::Error::from_raw_os_error(code as i32)
}

pub(super) fn wide_nul(value: &OsStr) -> Result<Vec<u16>> {
    let path = Path::new(value);
    let mut wide = Vec::new();
    if matches!(
        path.components().next(),
        Some(Component::Prefix(component)) if matches!(component.kind(), Prefix::Disk(_))
    ) {
        // Win32 path APIs still apply MAX_PATH to ordinary drive paths in
        // some process configurations. All callers operate on normalized
        // absolute local paths, so use the extended-length spelling and keep
        // deep Runtime View staging commits deterministic on Windows.
        wide.extend(OsStr::new(r"\\?\").encode_wide());
    }
    wide.extend(value.encode_wide().map(|unit| {
        if unit == b'/' as u16 {
            b'\\' as u16
        } else {
            unit
        }
    }));
    if wide.contains(&0) {
        bail!("Windows attachment path contains an interior NUL");
    }
    wide.push(0);
    Ok(wide)
}
