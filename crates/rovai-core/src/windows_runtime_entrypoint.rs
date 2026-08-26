use std::{
    ffi::{OsStr, OsString},
    fs::{self, File},
    io::Read,
    os::windows::{ffi::OsStrExt, ffi::OsStringExt, fs::MetadataExt},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use sha2::{Digest, Sha256};
use windows_sys::Win32::{
    Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT,
    System::SystemInformation::GetSystemDirectoryW,
};

const MAX_WINDOWS_COMMAND_SHIM_BYTES: u64 = 128 * 1024;
const WINDOWS_COMMAND_LINE_LIMIT: usize = 32_767;
const WINDOWS_COMMAND_SHIM_FINGERPRINT_DOMAIN: &[u8] = b"rovai.windows-command-shim.v1\0";
const WINDOWS_RESOLVED_COMMAND_SHIM_FINGERPRINT_DOMAIN: &[u8] =
    b"rovai.windows-resolved-command-shim.v1\0";
pub(crate) const WINDOWS_COMMAND_SHIM_PATH_ENVIRONMENT_KEY: &str =
    "ROVAI_INTERNAL_WINDOWS_COMMAND_SHIM";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WindowsCommandShimExtension {
    Cmd,
    Bat,
}

impl WindowsCommandShimExtension {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Cmd => "cmd",
            Self::Bat => "bat",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WindowsCommandShimIdentity {
    pub(crate) shim: PathBuf,
    pub(crate) extension: WindowsCommandShimExtension,
    pub(crate) content_digest: String,
    pub(crate) interpreter: PathBuf,
    pub(crate) interpreter_fingerprint: String,
}

impl WindowsCommandShimIdentity {
    pub(crate) fn compatibility_fingerprint(&self) -> String {
        let mut digest = Sha256::new();
        digest.update(WINDOWS_COMMAND_SHIM_FINGERPRINT_DOMAIN);
        digest.update(self.extension.as_str().as_bytes());
        digest.update([0]);
        update_digest_with_windows_path(&mut digest, &self.shim);
        digest.update(self.content_digest.as_bytes());
        digest.update([0]);
        update_digest_with_windows_path(&mut digest, &self.interpreter);
        digest.update(self.interpreter_fingerprint.as_bytes());
        format!("sha256:{:x}", digest.finalize())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedWindowsCommandShimIdentity {
    pub(crate) locator: WindowsCommandShimIdentity,
    pub(crate) target: PathBuf,
    pub(crate) target_fingerprint: String,
}

impl ResolvedWindowsCommandShimIdentity {
    pub(crate) fn compatibility_fingerprint(&self) -> String {
        let mut digest = Sha256::new();
        digest.update(WINDOWS_RESOLVED_COMMAND_SHIM_FINGERPRINT_DOMAIN);
        digest.update(self.locator.compatibility_fingerprint().as_bytes());
        digest.update([0]);
        update_digest_with_windows_path(&mut digest, &self.target);
        digest.update(self.target_fingerprint.as_bytes());
        format!("sha256:{:x}", digest.finalize())
    }
}

pub(crate) fn command_shim_extension(path: &Path) -> Option<WindowsCommandShimExtension> {
    let extension = path.extension()?.to_string_lossy();
    if extension.eq_ignore_ascii_case("cmd") {
        Some(WindowsCommandShimExtension::Cmd)
    } else if extension.eq_ignore_ascii_case("bat") {
        Some(WindowsCommandShimExtension::Bat)
    } else {
        None
    }
}

pub(crate) fn capture_windows_command_shim(path: &Path) -> Result<WindowsCommandShimIdentity> {
    let extension = command_shim_extension(path).with_context(|| {
        format!(
            "managed_process.invalid_application: expected a Windows command shim, got {}",
            path.display()
        )
    })?;
    let requested_metadata = fs::symlink_metadata(path).with_context(|| {
        format!(
            "managed_process.invalid_application: command shim is unavailable: {}",
            path.display()
        )
    })?;
    if !requested_metadata.is_file()
        || requested_metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || requested_metadata.len() > MAX_WINDOWS_COMMAND_SHIM_BYTES
    {
        bail!(
            "managed_process.invalid_application: command shim is not a bounded regular file: {}",
            path.display()
        );
    }
    let shim = path.canonicalize().with_context(|| {
        format!(
            "managed_process.invalid_application: command shim is unavailable: {}",
            path.display()
        )
    })?;
    let shim = windows_process_visible_path(shim);
    let metadata = fs::metadata(&shim).with_context(|| {
        format!(
            "managed_process.invalid_application: command shim is unavailable: {}",
            shim.display()
        )
    })?;
    if !metadata.is_file()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || metadata.len() > MAX_WINDOWS_COMMAND_SHIM_BYTES
    {
        bail!(
            "managed_process.invalid_application: command shim is not a bounded regular file: {}",
            shim.display()
        );
    }
    let content_digest = bounded_file_sha256(&shim, MAX_WINDOWS_COMMAND_SHIM_BYTES)?;
    let interpreter = system_cmd_executable()?;
    let interpreter_fingerprint = file_sha256(&interpreter)?;
    Ok(WindowsCommandShimIdentity {
        shim,
        extension,
        content_digest,
        interpreter,
        interpreter_fingerprint,
    })
}

pub(crate) fn capture_resolved_windows_command_shim(
    shim: &Path,
    target: &Path,
) -> Result<ResolvedWindowsCommandShimIdentity> {
    let locator = capture_windows_command_shim(shim)?;
    let target = target.canonicalize().with_context(|| {
        format!(
            "managed_process.invalid_application: resolved Runtime target is unavailable: {}",
            target.display()
        )
    })?;
    let target = windows_process_visible_path(target);
    let metadata = fs::metadata(&target).with_context(|| {
        format!(
            "managed_process.invalid_application: resolved Runtime target is unavailable: {}",
            target.display()
        )
    })?;
    if !metadata.is_file()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || !target
            .extension()
            .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("exe"))
    {
        bail!(
            "managed_process.invalid_application: resolved Runtime target is not a regular native executable: {}",
            target.display()
        );
    }
    let target_fingerprint = file_sha256(&target)?;
    Ok(ResolvedWindowsCommandShimIdentity {
        locator,
        target,
        target_fingerprint,
    })
}

pub(crate) fn system_cmd_executable() -> Result<PathBuf> {
    let mut capacity = 260usize;
    let directory = loop {
        let mut buffer = vec![0_u16; capacity];
        let length = unsafe {
            // SAFETY: `buffer` is writable for the capacity passed to the API.
            GetSystemDirectoryW(
                buffer.as_mut_ptr(),
                u32::try_from(buffer.len())
                    .context("managed_process.invalid_application: System32 path is too long")?,
            )
        };
        if length == 0 {
            return Err(std::io::Error::last_os_error())
                .context("managed_process.invalid_application: System32 is unavailable");
        }
        let length = usize::try_from(length)
            .context("managed_process.invalid_application: invalid System32 path length")?;
        if length < buffer.len() {
            buffer.truncate(length);
            break PathBuf::from(OsString::from_wide(&buffer));
        }
        capacity = length.saturating_add(1);
        if capacity > 32_767 {
            bail!("managed_process.invalid_application: System32 path is too long");
        }
    };
    let interpreter = windows_process_visible_path(
        directory.join("cmd.exe").canonicalize().with_context(|| {
            format!(
                "managed_process.invalid_application: cmd.exe is unavailable below {}",
                directory.display()
            )
        })?,
    );
    if !interpreter.is_file()
        || !interpreter
            .extension()
            .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("exe"))
    {
        bail!("managed_process.invalid_application: System32 cmd.exe is not a native executable");
    }
    Ok(interpreter)
}

pub(crate) fn serialize_command_shim_command_line(
    interpreter: &OsStr,
    shim: &Path,
    arguments: &[OsString],
) -> Result<Vec<u16>> {
    reject_cmd_line_breaks(interpreter, "interpreter")?;
    reject_cmd_line_breaks(shim.as_os_str(), "command shim")?;
    let shim_units = shim.as_os_str().encode_wide().collect::<Vec<_>>();
    if shim_units.contains(&(b'"' as u16)) || shim_units.last() == Some(&(b'\\' as u16)) {
        bail!("managed_process.invalid_application: invalid Windows command shim path");
    }

    // CreateProcessW is pinned to the canonical System32 cmd.exe separately. The
    // command line uses cmd.exe as argv[0] and follows the batch-specific encoding
    // used by Rust's standard library instead of the Microsoft CRT encoding.
    let mut command_line = "cmd.exe /e:on /v:off /d /c \"\"%"
        .encode_utf16()
        .collect::<Vec<_>>();
    command_line.extend(WINDOWS_COMMAND_SHIM_PATH_ENVIRONMENT_KEY.encode_utf16());
    command_line.extend("%\"".encode_utf16());
    for argument in arguments {
        command_line.push(b' ' as u16);
        append_command_shim_argument(&mut command_line, argument, false)?;
    }
    command_line.push(b'"' as u16);
    if command_line.len() + 1 > WINDOWS_COMMAND_LINE_LIMIT {
        bail!("managed_process.invalid_argument: Windows command line is too long");
    }
    command_line.push(0);
    Ok(command_line)
}

fn bounded_file_sha256(path: &Path, limit: u64) -> Result<String> {
    let mut file = File::open(path)
        .with_context(|| format!("failed to open command shim {}", path.display()))?;
    let mut digest = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        if total > limit {
            bail!(
                "managed_process.invalid_application: command shim exceeds the bounded read limit"
            );
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn file_sha256(path: &Path) -> Result<String> {
    let mut file =
        File::open(path).with_context(|| format!("failed to open {}", path.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn update_digest_with_windows_path(digest: &mut Sha256, path: &Path) {
    for unit in path.as_os_str().encode_wide() {
        for byte in unit.to_le_bytes() {
            digest.update([byte]);
        }
    }
    digest.update([0, 0]);
}

fn windows_process_visible_path(path: PathBuf) -> PathBuf {
    let units = path.as_os_str().encode_wide().collect::<Vec<_>>();
    let verbatim = r"\\?\".encode_utf16().collect::<Vec<_>>();
    let verbatim_unc = r"\\?\UNC\".encode_utf16().collect::<Vec<_>>();
    if units.starts_with(&verbatim_unc) {
        let mut visible = r"\\".encode_utf16().collect::<Vec<_>>();
        visible.extend_from_slice(&units[verbatim_unc.len()..]);
        return PathBuf::from(OsString::from_wide(&visible));
    }
    if units.starts_with(&verbatim) {
        return PathBuf::from(OsString::from_wide(&units[verbatim.len()..]));
    }
    path
}

fn reject_cmd_line_breaks(value: &OsStr, label: &str) -> Result<()> {
    if value
        .encode_wide()
        .any(|unit| unit == 0 || unit == u16::from(b'\r') || unit == u16::from(b'\n'))
    {
        bail!("managed_process.invalid_argument: {label} contains a command-line break");
    }
    Ok(())
}

fn append_command_shim_argument(
    command_line: &mut Vec<u16>,
    value: &OsStr,
    force_quotes: bool,
) -> Result<()> {
    reject_cmd_line_breaks(value, "argv")?;
    let units = value.encode_wide().collect::<Vec<_>>();
    if units
        .iter()
        .any(|unit| *unit == b'"' as u16 || *unit == b'%' as u16)
        || units.last() == Some(&(b'\\' as u16))
    {
        // A batch file receives a raw command string rather than an argv array.
        // Literal quotes cannot be represented for every possible `%1`/`%*`
        // consumer, and percent sequences can be expanded again inside the
        // batch file. A trailing backslash is likewise consumer-dependent once
        // the script reconstructs `%1`/`%*`. Refuse these forms instead of
        // silently changing argv semantics.
        bail!(
            "managed_process.invalid_argument: Windows command shim argv contains an unrepresentable quote, percent, or trailing backslash"
        );
    }
    let mut quoted = force_quotes || units.is_empty();
    for &unit in &units {
        let ascii_needs_quotes = u8::try_from(unit).ok().is_some_and(|byte| {
            !(byte.is_ascii_alphanumeric() || br"#$*+-./:?@\_".contains(&byte))
        });
        if ascii_needs_quotes || unit < b' ' as u16 || unit == 0x7f {
            quoted = true;
        }
    }
    if quoted {
        command_line.push(b'"' as u16);
    }
    let mut backslashes = 0usize;
    for unit in units {
        if unit == b'\\' as u16 {
            backslashes += 1;
        } else {
            if unit == b'"' as u16 {
                command_line.extend(std::iter::repeat_n(b'\\' as u16, backslashes));
                command_line.push(b'"' as u16);
            }
            backslashes = 0;
        }
        command_line.push(unit);
    }
    if quoted {
        command_line.extend(std::iter::repeat_n(b'\\' as u16, backslashes));
        command_line.push(b'"' as u16);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn escaped_argument(value: &str) -> String {
        let mut command_line = Vec::new();
        append_command_shim_argument(&mut command_line, OsStr::new(value), false).unwrap();
        String::from_utf16(&command_line).unwrap()
    }

    #[test]
    fn cmd_argument_builder_covers_spaces_and_supported_shell_metacharacters() {
        assert_eq!(escaped_argument(""), "\"\"");
        assert_eq!(escaped_argument("two words"), "\"two words\"");
        let escaped = escaped_argument("&|<>^! done");
        for marker in ["&", "|", "<", ">", "^", "!"] {
            assert!(
                escaped.contains(marker),
                "missing {marker:?} in {escaped:?}"
            );
        }
        assert!(escaped.starts_with('"'));
        assert!(escaped.ends_with('"'));
    }

    #[test]
    fn cmd_argument_builder_rejects_unrepresentable_quote_percent_and_trailing_backslash() {
        for value in ["say\"quoted", "%ROVAI_ARGUMENT%", "trailing\\"] {
            assert!(
                append_command_shim_argument(&mut Vec::new(), OsStr::new(value), false).is_err(),
                "{value:?} must fail closed instead of changing batch argv semantics"
            );
        }
    }

    #[test]
    fn cmd_builder_rejects_line_break_injection() {
        assert!(
            append_command_shim_argument(&mut Vec::new(), OsStr::new("ok\r\nwhoami"), false)
                .is_err()
        );
    }

    #[test]
    fn cmd_builder_pins_flags_and_indirects_the_script_path_through_frozen_environment() {
        let command_line = serialize_command_shim_command_line(
            OsStr::new(r"C:\Windows\System32\cmd.exe"),
            Path::new(r"C:\Runtime %PATH% ! & ^\runtime shim.bat"),
            &[OsString::from("--version")],
        )
        .unwrap();
        let command_line =
            String::from_utf16(&command_line[..command_line.len().saturating_sub(1)]).unwrap();
        assert!(command_line.starts_with("cmd.exe /e:on /v:off /d /c \"\"%"));
        assert!(command_line.contains(WINDOWS_COMMAND_SHIM_PATH_ENVIRONMENT_KEY));
        assert!(!command_line.contains(r"C:\Runtime"));
        assert!(!command_line.contains("%PATH%"));
        assert!(command_line.ends_with(" --version\""));
    }

    #[test]
    fn command_shim_capture_is_bounded_and_binds_system_interpreter() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-command-shim-identity-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let shim = directory.join("runtime.cmd");
        std::fs::write(&shim, b"@echo runtime 1.0.0\r\n").unwrap();
        let identity = capture_windows_command_shim(&shim).unwrap();
        assert_eq!(identity.extension, WindowsCommandShimExtension::Cmd);
        assert_eq!(
            identity.shim,
            windows_process_visible_path(shim.canonicalize().unwrap())
        );
        assert_eq!(identity.interpreter, system_cmd_executable().unwrap());
        assert!(identity.content_digest.starts_with("sha256:"));
        assert!(identity.interpreter_fingerprint.starts_with("sha256:"));

        let oversized = directory.join("oversized.bat");
        std::fs::write(
            &oversized,
            vec![b'x'; MAX_WINDOWS_COMMAND_SHIM_BYTES as usize + 1],
        )
        .unwrap();
        assert!(capture_windows_command_shim(&oversized).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn resolved_command_shim_identity_binds_locator_interpreter_and_native_target() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-resolved-command-shim-identity-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let shim = directory.join("codex.cmd");
        let target = directory.join("codex.exe");
        std::fs::write(&shim, b"@echo off\r\n").unwrap();
        std::fs::write(&target, b"native-v1").unwrap();

        let first = capture_resolved_windows_command_shim(&shim, &target).unwrap();
        let first_fingerprint = first.compatibility_fingerprint();
        assert_eq!(
            first.locator.shim,
            windows_process_visible_path(shim.canonicalize().unwrap())
        );
        assert_eq!(
            first.target,
            windows_process_visible_path(target.canonicalize().unwrap())
        );

        std::fs::write(&shim, b"@echo off\r\nrem changed\r\n").unwrap();
        let changed_shim = capture_resolved_windows_command_shim(&shim, &target).unwrap();
        assert_ne!(
            first_fingerprint,
            changed_shim.compatibility_fingerprint(),
            "the locator content must fence compatibility even when the target is unchanged"
        );

        std::fs::write(&target, b"native-v2").unwrap();
        let changed_target = capture_resolved_windows_command_shim(&shim, &target).unwrap();
        assert_ne!(
            changed_shim.compatibility_fingerprint(),
            changed_target.compatibility_fingerprint(),
            "the native target fingerprint must fence compatibility"
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
