use std::{
    collections::BTreeMap,
    env,
    ffi::{OsStr, OsString},
    fs,
    future::Future,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{OnceLock, RwLock},
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::{
    io::Read,
    os::unix::{fs::PermissionsExt, process::CommandExt},
    process::Command,
    thread,
};

use anyhow::{Context, Result};
#[cfg(target_os = "macos")]
use plist::Value as PlistValue;
use serde::Serialize;
use tokio::process::Command as TokioCommand;
#[cfg(unix)]
use uuid::Uuid;

#[cfg(windows)]
use crate::runtime_discovery_windows::{
    WindowsRegistryPathValues, is_cmd_path, paths_equal, read_registry_path_values,
    registry_path_directories, resolve_codex_cmd_shim,
};
use crate::{
    agent_profile::{AdapterKind, InstallationSource},
    agent_runtime_adapter::{executable_fingerprint, grok_build_minimum_version_satisfied},
    runtime_probe_process::{ProbeCommandLimits, run_bounded_command},
};

#[cfg(unix)]
const SHELL_PATH_TIMEOUT: Duration = Duration::from_secs(3);
const VERSION_TIMEOUT: Duration = Duration::from_secs(2);
const CODEBUDDY_VERSION_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(unix)]
const MAX_SHELL_PATH_BYTES: u64 = 64 * 1024;
const MAX_VERSION_OUTPUT_BYTES: usize = 8 * 1024;
const GO_BUILD_INFO_MAGIC: &[u8] = b"\xff Go buildinf:";

static ACTIVE_RUNTIME_COMMAND_PATH: OnceLock<RwLock<OsString>> = OnceLock::new();
tokio::task_local! {
    static SCOPED_RUNTIME_COMMAND_PATH: OsString;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchPathSource {
    InheritedPath,
    LoginShell,
    KnownLocation,
}

impl SearchPathSource {
    fn installation_source(self) -> InstallationSource {
        match self {
            Self::InheritedPath => InstallationSource::InheritedPath,
            Self::LoginShell => InstallationSource::LoginShell,
            Self::KnownLocation => InstallationSource::KnownLocation,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPathEntry {
    pub path: PathBuf,
    pub sources: Vec<SearchPathSource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellPathStatus {
    Captured,
    Unavailable,
    TimedOut,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellPathDiagnostic {
    pub status: ShellPathStatus,
    pub interactive: bool,
    pub shell_name: Option<String>,
    pub entry_count: usize,
    pub elapsed_millis: u128,
}

#[derive(Debug, Clone)]
pub struct RuntimeSearchEnvironment {
    generation: u64,
    path_entries: Vec<SearchPathEntry>,
    path_value: OsString,
    executable_suffixes: Vec<OsString>,
    created_at: String,
    shell_diagnostic: ShellPathDiagnostic,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSearchEnvironmentSummary {
    pub generation: u64,
    pub created_at: String,
    pub path_entry_count: usize,
    pub shell: ShellPathDiagnostic,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeExecutableCandidate {
    pub path: PathBuf,
    pub source: InstallationSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeDiscoveryStatus {
    Detecting,
    Found,
    Missing,
}

/// Every Runtime child process must have an explicit product purpose. Some
/// third-party CLIs perform credential-store initialization even for metadata
/// commands, so each Adapter policy must name the user and background purposes
/// it accepts rather than relying on the call site alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeLaunchPurpose {
    DiscoveryVersion,
    AvailabilityCheck,
    InstallationRefresh,
    HealthProbe,
    DispatchPreflight,
    AgentExecution,
}

pub fn runtime_launch_allowed(_kind: AdapterKind, _purpose: RuntimeLaunchPurpose) -> bool {
    // Every current Product Runtime participates in the same purpose-scoped
    // lifecycle. Keeping this gate central ensures new Adapters must still make
    // an explicit launch-policy decision without reintroducing caller-local
    // exceptions.
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiscoveryObservation {
    pub runtime_kind: AdapterKind,
    pub discovery_status: RuntimeDiscoveryStatus,
    pub executable_path: Option<String>,
    pub source: Option<InstallationSource>,
    pub reported_version: Option<String>,
    pub executable_fingerprint: Option<String>,
    pub search_generation: u64,
    pub observed_at: String,
    pub diagnostic_code: Option<String>,
}

impl RuntimeDiscoveryObservation {
    pub fn detecting(kind: AdapterKind, search_generation: u64) -> Self {
        Self {
            runtime_kind: kind,
            discovery_status: RuntimeDiscoveryStatus::Detecting,
            executable_path: None,
            source: None,
            reported_version: None,
            executable_fingerprint: None,
            search_generation,
            observed_at: chrono::Utc::now().to_rfc3339(),
            diagnostic_code: None,
        }
    }
}

impl RuntimeSearchEnvironment {
    #[cfg(feature = "slow-tests")]
    pub fn for_test_paths(generation: u64, paths: Vec<PathBuf>) -> Self {
        let path_entries = paths
            .into_iter()
            .map(|path| SearchPathEntry {
                path,
                sources: vec![SearchPathSource::InheritedPath],
            })
            .collect::<Vec<_>>();
        let path_value = env::join_paths(path_entries.iter().map(|entry| entry.path.as_os_str()))
            .unwrap_or_default();
        Self {
            generation: generation.max(1),
            path_entries,
            path_value,
            executable_suffixes: runtime_executable_suffixes(),
            created_at: chrono::Utc::now().to_rfc3339(),
            shell_diagnostic: ShellPathDiagnostic {
                status: ShellPathStatus::Captured,
                interactive: false,
                shell_name: None,
                entry_count: 0,
                elapsed_millis: 0,
            },
        }
    }

    pub fn capture_initial() -> Self {
        Self::capture(1, false)
    }

    pub fn rescan(generation: u64, interactive: bool) -> Self {
        Self::capture(generation.max(1), interactive)
    }

    fn capture(generation: u64, interactive: bool) -> Self {
        let mut entries = Vec::new();
        if let Some(inherited) = env::var_os("PATH") {
            extend_paths(
                &mut entries,
                env::split_paths(&inherited),
                SearchPathSource::InheritedPath,
            );
        }
        #[cfg(windows)]
        {
            let registry_paths = read_registry_path_values();
            let environment = env::vars_os().collect::<Vec<_>>();
            extend_windows_registry_paths(&mut entries, &registry_paths, &environment);
        }

        let shell_start = Instant::now();
        let (shell_status, shell_name, shell_paths) = capture_shell_path(interactive);
        let shell_entry_count = shell_paths.len();
        extend_paths(
            &mut entries,
            shell_paths.into_iter(),
            SearchPathSource::LoginShell,
        );
        extend_paths(
            &mut entries,
            known_runtime_directories().into_iter(),
            SearchPathSource::KnownLocation,
        );
        let path_value = env::join_paths(entries.iter().map(|entry| entry.path.as_os_str()))
            .unwrap_or_else(|_| env::var_os("PATH").unwrap_or_default());
        Self {
            generation,
            path_entries: entries,
            path_value,
            executable_suffixes: runtime_executable_suffixes(),
            created_at: chrono::Utc::now().to_rfc3339(),
            shell_diagnostic: ShellPathDiagnostic {
                status: shell_status,
                interactive,
                shell_name,
                entry_count: shell_entry_count,
                elapsed_millis: shell_start.elapsed().as_millis(),
            },
        }
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn path_value(&self) -> &OsStr {
        &self.path_value
    }

    pub fn path_entries(&self) -> &[SearchPathEntry] {
        &self.path_entries
    }

    pub fn resolve_command_path(&self, command_name: &str) -> Option<PathBuf> {
        let command_path = Path::new(command_name);
        if command_name.is_empty()
            || command_path.components().count() != 1
            || command_path.file_name() != Some(OsStr::new(command_name))
        {
            return None;
        }
        for entry in &self.path_entries {
            for suffix in &self.executable_suffixes {
                let mut executable_name = OsString::from(command_name);
                executable_name.push(suffix);
                let candidate = entry.path.join(executable_name);
                if is_executable_file(&candidate)
                    && let Ok(canonical) = candidate.canonicalize()
                {
                    return Some(canonical);
                }
            }
        }
        None
    }

    pub fn summary(&self) -> RuntimeSearchEnvironmentSummary {
        RuntimeSearchEnvironmentSummary {
            generation: self.generation,
            created_at: self.created_at.clone(),
            path_entry_count: self.path_entries.len(),
            shell: self.shell_diagnostic.clone(),
        }
    }

    pub fn configure_tokio_command(&self, command: &mut TokioCommand) {
        command.env("PATH", &self.path_value);
    }

    pub fn activate_for_runtime_commands(&self) {
        let store =
            ACTIVE_RUNTIME_COMMAND_PATH.get_or_init(|| RwLock::new(self.path_value.clone()));
        if let Ok(mut active) = store.write() {
            *active = self.path_value.clone();
        }
    }

    pub fn candidates(
        &self,
        kind: AdapterKind,
        manual_candidates: impl IntoIterator<Item = PathBuf>,
    ) -> Vec<RuntimeExecutableCandidate> {
        self.candidates_with_override(
            kind,
            manual_candidates,
            env::var_os(kind.override_environment_key()).map(PathBuf::from),
        )
    }

    fn candidates_with_override(
        &self,
        kind: AdapterKind,
        manual_candidates: impl IntoIterator<Item = PathBuf>,
        override_path: Option<PathBuf>,
    ) -> Vec<RuntimeExecutableCandidate> {
        let mut candidates = Vec::new();
        for path in manual_candidates {
            if !push_candidates_for_kind(
                &mut candidates,
                path,
                InstallationSource::Manual,
                kind,
                &self.executable_suffixes,
            ) {
                return Vec::new();
            }
        }
        if let Some(path) = override_path
            && !push_candidates_for_kind(
                &mut candidates,
                path,
                InstallationSource::Env,
                kind,
                &self.executable_suffixes,
            )
        {
            return Vec::new();
        }
        for entry in &self.path_entries {
            let source = entry
                .sources
                .first()
                .copied()
                .unwrap_or(SearchPathSource::KnownLocation)
                .installation_source();
            push_candidates_for_kind(
                &mut candidates,
                entry.path.clone(),
                source,
                kind,
                &self.executable_suffixes,
            );
        }
        candidates
    }
}

pub fn configure_active_runtime_command(command: &mut TokioCommand) {
    if let Ok(path) = SCOPED_RUNTIME_COMMAND_PATH.try_with(Clone::clone) {
        command.env("PATH", path);
        return;
    }
    if let Some(path) = ACTIVE_RUNTIME_COMMAND_PATH
        .get()
        .and_then(|path| path.read().ok().map(|path| path.clone()))
    {
        command.env("PATH", path);
    }
}

pub async fn with_runtime_search_environment<F, T>(
    search: &RuntimeSearchEnvironment,
    future: F,
) -> T
where
    F: Future<Output = T>,
{
    SCOPED_RUNTIME_COMMAND_PATH
        .scope(search.path_value.clone(), future)
        .await
}

pub fn discover_runtime_path(
    kind: AdapterKind,
    search: &RuntimeSearchEnvironment,
) -> RuntimeDiscoveryObservation {
    discover_runtime_path_from_candidates(kind, search, search.candidates(kind, std::iter::empty()))
}

fn discover_runtime_path_from_candidates(
    kind: AdapterKind,
    search: &RuntimeSearchEnvironment,
    candidates: impl IntoIterator<Item = RuntimeExecutableCandidate>,
) -> RuntimeDiscoveryObservation {
    let observed_at = chrono::Utc::now().to_rfc3339();
    for candidate in candidates {
        if !is_executable_file(&candidate.path) {
            continue;
        }
        let canonical = candidate
            .path
            .canonicalize()
            .unwrap_or_else(|_| candidate.path.clone());
        let canonical = runtime_visible_path(canonical);
        match executable_fingerprint(&canonical) {
            Ok(fingerprint) => {
                return RuntimeDiscoveryObservation {
                    runtime_kind: kind,
                    discovery_status: RuntimeDiscoveryStatus::Found,
                    executable_path: Some(canonical.to_string_lossy().to_string()),
                    source: Some(candidate.source),
                    reported_version: None,
                    executable_fingerprint: Some(fingerprint),
                    search_generation: search.generation,
                    observed_at,
                    diagnostic_code: None,
                };
            }
            Err(_) => continue,
        }
    }
    RuntimeDiscoveryObservation {
        runtime_kind: kind,
        discovery_status: RuntimeDiscoveryStatus::Missing,
        executable_path: None,
        source: None,
        reported_version: None,
        executable_fingerprint: None,
        search_generation: search.generation,
        observed_at,
        diagnostic_code: Some("runtime_not_found".to_string()),
    }
}

pub async fn discover_runtime_version(
    observation: &mut RuntimeDiscoveryObservation,
    search: &RuntimeSearchEnvironment,
) {
    let Some(path) = observation.executable_path.as_deref() else {
        return;
    };
    if !runtime_launch_allowed(
        observation.runtime_kind,
        RuntimeLaunchPurpose::DiscoveryVersion,
    ) {
        observation.reported_version =
            discover_static_runtime_version(observation.runtime_kind, Path::new(path));
        observation.diagnostic_code = observation
            .reported_version
            .is_none()
            .then(|| "runtime_version_unavailable_static_only".to_string());
        observation.observed_at = chrono::Utc::now().to_rfc3339();
        return;
    }
    match bounded_version_command(
        observation.runtime_kind,
        RuntimeLaunchPurpose::DiscoveryVersion,
        Path::new(path),
        version_arguments(observation.runtime_kind),
        search,
    )
    .await
    {
        Ok(version)
            if !version.is_empty()
                && (observation.runtime_kind != AdapterKind::CursorAgent
                    || is_cursor_agent_version(&version)) =>
        {
            if observation.runtime_kind == AdapterKind::GrokBuild
                && !grok_build_minimum_version_satisfied(Some(&version))
            {
                observation.diagnostic_code = Some("runtime_version_below_minimum".to_string());
            }
            observation.reported_version = Some(version)
        }
        Ok(_) if observation.runtime_kind == AdapterKind::CursorAgent => {
            observation.diagnostic_code = Some("runtime_identity_mismatch".to_string())
        }
        Ok(_) => observation.diagnostic_code = Some("runtime_version_empty".to_string()),
        Err(error) => observation.diagnostic_code = Some(format!("{error:#}")),
    }
    observation.observed_at = chrono::Utc::now().to_rfc3339();
}

/// Reads version metadata without starting the target executable. Unknown is
/// an honest result: fingerprints identify content but are not semantic
/// versions.
pub fn discover_static_runtime_version(kind: AdapterKind, executable: &Path) -> Option<String> {
    if kind != AdapterKind::TraeCnCli {
        return None;
    }
    static_bundle_version(executable).or_else(|| static_go_main_module_version(executable))
}

#[cfg(target_os = "macos")]
fn static_bundle_version(executable: &Path) -> Option<String> {
    let contents = executable.ancestors().find(|ancestor| {
        ancestor.file_name() == Some(OsStr::new("Contents"))
            && ancestor
                .parent()
                .and_then(Path::extension)
                .is_some_and(|extension| extension == "app")
    })?;
    let plist = PlistValue::from_file(contents.join("Info.plist")).ok()?;
    let dictionary = plist.as_dictionary()?;
    ["CFBundleShortVersionString", "CFBundleVersion"]
        .into_iter()
        .filter_map(|key| dictionary.get(key).and_then(PlistValue::as_string))
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(not(target_os = "macos"))]
fn static_bundle_version(_executable: &Path) -> Option<String> {
    None
}

fn static_go_main_module_version(executable: &Path) -> Option<String> {
    let bytes = fs::read(executable).ok()?;
    let offset = bytes
        .windows(GO_BUILD_INFO_MAGIC.len())
        .position(|window| window == GO_BUILD_INFO_MAGIC)?;
    let header = bytes.get(offset..offset.checked_add(32)?)?;
    let flags = *header.get(15)?;
    // Modern Go binaries inline two varint-prefixed strings after the header.
    // Pointer-based legacy records require executable virtual-address mapping
    // and are deliberately treated as unknown rather than guessed.
    if flags & 2 == 0 {
        return None;
    }
    let mut cursor = offset.checked_add(32)?;
    let _go_toolchain = take_go_build_string(&bytes, &mut cursor)?;
    let module_info = take_go_build_string(&bytes, &mut cursor)?;
    let module_info = strip_go_module_framing(module_info);
    module_info.lines().find_map(|line| {
        let mut fields = line.split('\t');
        if fields.next()? != "mod" {
            return None;
        }
        let module_path = fields.next()?;
        let version = fields.next()?.trim();
        let product_path = module_path.to_ascii_lowercase();
        if !product_path.contains("trae")
            || version.is_empty()
            || matches!(version, "(devel)" | "devel")
        {
            return None;
        }
        Some(version.to_string())
    })
}

fn take_go_build_string<'a>(bytes: &'a [u8], cursor: &mut usize) -> Option<&'a str> {
    let length = take_uvarint(bytes, cursor)?;
    let length = usize::try_from(length).ok()?;
    let end = cursor.checked_add(length)?;
    let value = std::str::from_utf8(bytes.get(*cursor..end)?).ok()?;
    *cursor = end;
    Some(value)
}

fn take_uvarint(bytes: &[u8], cursor: &mut usize) -> Option<u64> {
    let mut value = 0_u64;
    for shift in (0..=63).step_by(7) {
        let byte = *bytes.get(*cursor)?;
        *cursor += 1;
        if byte < 0x80 {
            return (shift != 63 || byte <= 1).then_some(value | u64::from(byte) << shift);
        }
        value |= u64::from(byte & 0x7f) << shift;
    }
    None
}

fn strip_go_module_framing(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 33 && bytes.get(bytes.len() - 17) == Some(&b'\n') {
        &value[16..value.len() - 16]
    } else {
        value
    }
}

fn version_arguments(kind: AdapterKind) -> &'static [&'static str] {
    match kind {
        AdapterKind::AntigravityApp => &["--version"],
        _ => &["--version"],
    }
}

fn version_timeout(kind: AdapterKind) -> Duration {
    match kind {
        AdapterKind::CodebuddyCli => CODEBUDDY_VERSION_TIMEOUT,
        _ => VERSION_TIMEOUT,
    }
}

async fn bounded_version_command(
    kind: AdapterKind,
    purpose: RuntimeLaunchPurpose,
    executable: &Path,
    arguments: &[&str],
    search: &RuntimeSearchEnvironment,
) -> Result<String> {
    if !runtime_launch_allowed(kind, purpose) {
        anyhow::bail!("runtime_launch_disallowed_for_{purpose:?}");
    }
    let mut command = TokioCommand::new(executable);
    command.args(arguments).stdin(Stdio::null());
    search.configure_tokio_command(&mut command);
    let output = run_bounded_command(
        &mut command,
        ProbeCommandLimits {
            deadline: version_timeout(kind),
            stdout_bytes: MAX_VERSION_OUTPUT_BYTES,
            stderr_bytes: MAX_VERSION_OUTPUT_BYTES,
            cleanup_timeout: Duration::from_secs(1),
        },
    )
    .await
    .context("runtime_version_command_failed")?;
    if !output.status.success() {
        anyhow::bail!("runtime_version_failed");
    }
    if output.stdout.truncated || output.stderr.truncated {
        anyhow::bail!("runtime_version_output_truncated");
    }
    let stdout_text = String::from_utf8_lossy(&output.stdout.bytes);
    let stderr_text = String::from_utf8_lossy(&output.stderr.bytes);
    let first_line = stdout_text
        .lines()
        .chain(stderr_text.lines())
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default()
        .trim();
    Ok(first_line.chars().take(256).collect())
}

#[cfg(unix)]
fn capture_shell_path(interactive: bool) -> (ShellPathStatus, Option<String>, Vec<PathBuf>) {
    let Some(shell) = env::var_os("SHELL").filter(|value| !value.is_empty()) else {
        return (ShellPathStatus::Unavailable, None, Vec::new());
    };
    let shell_path = PathBuf::from(&shell);
    if !shell_path.is_file() {
        return (
            ShellPathStatus::Unavailable,
            shell_path
                .file_name()
                .map(|value| value.to_string_lossy().to_string()),
            Vec::new(),
        );
    }
    capture_shell_path_from(&shell_path, interactive, SHELL_PATH_TIMEOUT)
}

#[cfg(not(unix))]
fn capture_shell_path(_interactive: bool) -> (ShellPathStatus, Option<String>, Vec<PathBuf>) {
    (ShellPathStatus::Unavailable, None, Vec::new())
}

#[cfg(unix)]
fn capture_shell_path_from(
    shell_path: &Path,
    interactive: bool,
    timeout: Duration,
) -> (ShellPathStatus, Option<String>, Vec<PathBuf>) {
    let shell_name = shell_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string());
    let marker = format!("__ROVAI_PATH_{}__", Uuid::new_v4().simple());
    let script = format!("printf '%s\\n%s\\n%s\\n' '{marker}' \"$PATH\" '{marker}'");
    let mut command = Command::new(shell_path);
    command
        .arg(if interactive { "-ilc" } else { "-lc" })
        .arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => return (ShellPathStatus::Failed, shell_name, Vec::new()),
    };
    let stdout = child.stdout.take();
    let reader = stdout.map(|stdout| {
        thread::spawn(move || {
            let mut output = Vec::new();
            let result = stdout
                .take(MAX_SHELL_PATH_BYTES + 1)
                .read_to_end(&mut output);
            (result, output)
        })
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let pid = child.id();
                // SAFETY: pid identifies only the child process group created immediately above.
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGKILL);
                }
                let _ = child.kill();
                let _ = child.wait();
                if let Some(reader) = reader {
                    let _ = reader.join();
                }
                return (ShellPathStatus::TimedOut, shell_name, Vec::new());
            }
            Err(_) => {
                if let Some(reader) = reader {
                    let _ = reader.join();
                }
                return (ShellPathStatus::Failed, shell_name, Vec::new());
            }
        }
    };
    let Some(reader) = reader else {
        return (ShellPathStatus::Failed, shell_name, Vec::new());
    };
    let Ok((read_result, output)) = reader.join() else {
        return (ShellPathStatus::Failed, shell_name, Vec::new());
    };
    if !status.is_some_and(|status| status.success()) {
        return (ShellPathStatus::Failed, shell_name, Vec::new());
    }
    if read_result.is_err() || output.len() as u64 > MAX_SHELL_PATH_BYTES {
        return (ShellPathStatus::Failed, shell_name, Vec::new());
    }
    let text = String::from_utf8_lossy(&output);
    let mut lines = text.lines();
    let Some(start) = lines.position(|line| line == marker) else {
        return (ShellPathStatus::Failed, shell_name, Vec::new());
    };
    let _ = start;
    let Some(path_value) = lines.next() else {
        return (ShellPathStatus::Failed, shell_name, Vec::new());
    };
    if lines.next() != Some(marker.as_str()) {
        return (ShellPathStatus::Failed, shell_name, Vec::new());
    }
    (
        ShellPathStatus::Captured,
        shell_name,
        env::split_paths(OsStr::new(path_value)).collect(),
    )
}

fn extend_paths(
    entries: &mut Vec<SearchPathEntry>,
    paths: impl Iterator<Item = PathBuf>,
    source: SearchPathSource,
) {
    for path in paths {
        if path.as_os_str().is_empty() {
            continue;
        }
        let normalized = normalize_directory(path);
        if let Some(existing) = entries
            .iter_mut()
            .find(|entry| runtime_paths_equal(&entry.path, &normalized))
        {
            if !existing.sources.contains(&source) {
                existing.sources.push(source);
            }
        } else {
            entries.push(SearchPathEntry {
                path: normalized,
                sources: vec![source],
            });
        }
    }
}

#[cfg(windows)]
fn extend_windows_registry_paths(
    entries: &mut Vec<SearchPathEntry>,
    registry_paths: &WindowsRegistryPathValues,
    environment: &[(OsString, OsString)],
) {
    // Preserve the process's inherited PATH precedence. Fresh User and then
    // Machine registry values fill in entries installed after Desktop startup.
    extend_paths(
        entries,
        registry_path_directories(registry_paths.user.as_deref(), environment).into_iter(),
        SearchPathSource::InheritedPath,
    );
    extend_paths(
        entries,
        registry_path_directories(registry_paths.machine.as_deref(), environment).into_iter(),
        SearchPathSource::InheritedPath,
    );
}

fn runtime_paths_equal(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        paths_equal(left, right)
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn normalize_directory(path: PathBuf) -> PathBuf {
    let normalized = path.canonicalize().unwrap_or(path);
    runtime_visible_path(normalized)
}

pub fn runtime_visible_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path
}

fn push_candidates(
    candidates: &mut Vec<RuntimeExecutableCandidate>,
    path_or_directory: PathBuf,
    source: InstallationSource,
    command_name: &str,
    executable_suffixes: &[OsString],
) {
    if path_or_directory.is_dir() {
        for suffix in executable_suffixes {
            let mut executable_name = OsString::from(command_name);
            executable_name.push(suffix);
            push_concrete_candidate(candidates, path_or_directory.join(executable_name), source);
        }
        return;
    }
    push_concrete_candidate(candidates, path_or_directory, source);
}

fn push_candidates_for_kind(
    candidates: &mut Vec<RuntimeExecutableCandidate>,
    path_or_directory: PathBuf,
    source: InstallationSource,
    kind: AdapterKind,
    executable_suffixes: &[OsString],
) -> bool {
    #[cfg(windows)]
    if kind == AdapterKind::CodexCli && is_cmd_path(&path_or_directory) {
        let Some(executable) = resolve_codex_cmd_shim(&path_or_directory) else {
            return false;
        };
        push_concrete_candidate(candidates, executable, source);
        return true;
    }

    if path_or_directory.is_dir() {
        for command_name in kind.command_names() {
            push_candidates(
                candidates,
                path_or_directory.clone(),
                source,
                command_name,
                executable_suffixes,
            );
        }
        #[cfg(windows)]
        if kind == AdapterKind::CodexCli {
            let shim = path_or_directory.join("codex.cmd");
            if shim.is_file()
                && let Some(executable) = resolve_codex_cmd_shim(&shim)
            {
                push_concrete_candidate(candidates, executable, source);
            }
        }
        return true;
    }
    push_concrete_candidate(candidates, path_or_directory, source);
    true
}

/// Cursor's current CLI reports a date-based build such as
/// `2026.08.11-e8db854`. Requiring this product-owned shape prevents the
/// generic `agent` alias from binding Grok Build or another unrelated CLI.
pub fn is_cursor_agent_version(version: &str) -> bool {
    let Some((date, build)) = version.trim().split_once('-') else {
        return false;
    };
    let mut parts = date.split('.');
    let valid_date = matches!(
        (parts.next(), parts.next(), parts.next(), parts.next()),
        (Some(year), Some(month), Some(day), None)
            if year.len() == 4
                && month.len() == 2
                && day.len() == 2
                && year.bytes().all(|value| value.is_ascii_digit())
                && month.bytes().all(|value| value.is_ascii_digit())
                && day.bytes().all(|value| value.is_ascii_digit())
    );
    valid_date
        && !build.is_empty()
        && build
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'.')
}

fn push_concrete_candidate(
    candidates: &mut Vec<RuntimeExecutableCandidate>,
    path: PathBuf,
    source: InstallationSource,
) {
    let canonical = runtime_visible_path(path.canonicalize().unwrap_or(path));
    if candidates
        .iter()
        .any(|candidate| runtime_paths_equal(&candidate.path, &canonical))
    {
        return;
    }
    candidates.push(RuntimeExecutableCandidate {
        path: canonical,
        source,
    });
}

#[cfg(unix)]
pub fn is_executable_file(path: &Path) -> bool {
    fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(windows)]
pub fn is_executable_file(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("exe"))
        && fs::metadata(path).is_ok_and(|metadata| metadata.is_file())
}

#[cfg(not(any(unix, windows)))]
pub fn is_executable_file(_path: &Path) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn known_runtime_directories() -> Vec<PathBuf> {
    let mut result = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(pnpm_home) = env::var_os("PNPM_HOME").filter(|value| !value.is_empty()) {
        result.push(PathBuf::from(pnpm_home));
    }
    let Some(home) = dirs::home_dir() else {
        result.retain(|path| path.is_dir());
        return result;
    };
    for relative in [
        ".local/bin",
        ".npm-global/bin",
        ".volta/bin",
        ".cargo/bin",
        "go/bin",
        ".deno/bin",
        "Library/pnpm",
        ".local/share/pnpm",
    ] {
        result.push(home.join(relative));
    }
    let nvm_versions = home.join(".nvm/versions/node");
    if let Ok(entries) = fs::read_dir(nvm_versions) {
        let mut version_bins = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path().join("bin"))
            .collect::<Vec<_>>();
        version_bins.sort();
        version_bins.reverse();
        result.extend(version_bins);
    }
    result.retain(|path| path.is_dir());
    result
}

#[cfg(windows)]
fn known_runtime_directories() -> Vec<PathBuf> {
    known_windows_runtime_directories(
        env::var_os("PNPM_HOME"),
        env::var_os("LOCALAPPDATA"),
        env::var_os("APPDATA"),
        env::var_os("USERPROFILE"),
    )
}

#[cfg(windows)]
fn known_windows_runtime_directories(
    pnpm_home: Option<OsString>,
    local_app_data: Option<OsString>,
    app_data: Option<OsString>,
    user_profile: Option<OsString>,
) -> Vec<PathBuf> {
    let mut result = Vec::new();
    if let Some(pnpm_home) = pnpm_home.filter(|value| !value.is_empty()) {
        result.push(PathBuf::from(pnpm_home));
    }
    if let Some(local_app_data) = local_app_data.filter(|value| !value.is_empty()) {
        let local_app_data = PathBuf::from(local_app_data);
        result.push(local_app_data.join("pnpm"));
        result.push(local_app_data.join("Microsoft/WinGet/Links"));
        // The official Codex installer adds this directory to User PATH for
        // future shells, so an already-running Desktop must know it directly.
        result.push(local_app_data.join("Programs/OpenAI/Codex/bin"));
    }
    if let Some(app_data) = app_data.filter(|value| !value.is_empty()) {
        result.push(PathBuf::from(app_data).join("npm"));
    }
    if let Some(user_profile) = user_profile.filter(|value| !value.is_empty()) {
        let user_profile = PathBuf::from(user_profile);
        result.push(user_profile.join(".cargo/bin"));
        result.push(user_profile.join(".local/bin"));
    }
    result.retain(|path| path.is_dir());
    result
}

#[cfg(not(any(target_os = "macos", windows)))]
fn known_runtime_directories() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(windows)]
fn runtime_executable_suffixes() -> Vec<OsString> {
    windows_executable_suffixes_from(env::var_os("PATHEXT").as_deref())
}

#[cfg(not(windows))]
fn runtime_executable_suffixes() -> Vec<OsString> {
    vec![OsString::new()]
}

#[cfg(any(windows, test))]
fn windows_executable_suffixes_from(path_ext: Option<&OsStr>) -> Vec<OsString> {
    let Some(path_ext) = path_ext.filter(|value| !value.is_empty()) else {
        return vec![OsString::from(".exe")];
    };
    let mut executable = Vec::new();
    for suffix in path_ext.to_string_lossy().split(';') {
        let suffix = suffix.trim();
        let normalized = if suffix.starts_with('.') {
            suffix.to_string()
        } else {
            format!(".{suffix}")
        };
        if normalized.eq_ignore_ascii_case(".exe") && executable.is_empty() {
            executable.push(OsString::from(".exe"));
        }
    }
    executable
}

pub fn catalog_entries() -> Vec<BTreeMap<&'static str, &'static str>> {
    AdapterKind::ALL
        .into_iter()
        .map(|kind| {
            BTreeMap::from([
                ("runtimeKind", kind.as_str()),
                ("displayName", kind.display_name()),
                ("commandName", kind.command_name()),
            ])
        })
        .collect()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn test_search(entries: Vec<SearchPathEntry>) -> RuntimeSearchEnvironment {
        RuntimeSearchEnvironment {
            generation: 7,
            path_value: env::join_paths(entries.iter().map(|entry| entry.path.as_os_str()))
                .unwrap(),
            path_entries: entries,
            executable_suffixes: vec![OsString::new()],
            created_at: "2026-07-29T00:00:00Z".to_string(),
            shell_diagnostic: ShellPathDiagnostic {
                status: ShellPathStatus::Captured,
                interactive: false,
                shell_name: Some("zsh".to_string()),
                entry_count: 0,
                elapsed_millis: 1,
            },
        }
    }

    fn executable(path: &Path, body: &str) {
        fs::write(path, body).unwrap();
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(path, permissions).unwrap();
    }

    #[test]
    fn known_catalog_covers_each_adapter_kind_exactly_once() {
        let entries = catalog_entries();
        let expected = AdapterKind::ALL
            .into_iter()
            .map(AdapterKind::as_str)
            .collect::<std::collections::BTreeSet<_>>();
        let actual = entries
            .iter()
            .map(|entry| entry["runtimeKind"])
            .collect::<std::collections::BTreeSet<_>>();

        assert_eq!(entries.len(), expected.len());
        assert_eq!(actual.len(), entries.len(), "runtimeKind must be unique");
        assert_eq!(actual, expected, "catalog must not omit or invent products");
        for entry in &entries {
            let kind = entry["runtimeKind"]
                .parse::<AdapterKind>()
                .expect("every runtimeKind must parse as a known AdapterKind");
            assert_eq!(kind.as_str(), entry["runtimeKind"]);
            assert!(!entry["displayName"].trim().is_empty());
            assert!(!entry["commandName"].trim().is_empty());
        }
    }

    #[test]
    fn windows_pathext_keeps_only_native_exe_candidates() {
        assert_eq!(
            windows_executable_suffixes_from(Some(OsStr::new(".COM;.EXE;.CMD;.BAT;.PS1;.exe"))),
            [OsString::from(".exe")]
        );
        assert_eq!(
            windows_executable_suffixes_from(Some(OsStr::new("COM;CMD;BAT;PS1"))),
            Vec::<OsString>::new()
        );
        assert_eq!(
            windows_executable_suffixes_from(None),
            [OsString::from(".exe")]
        );
    }

    #[test]
    fn windows_directory_search_materializes_only_the_native_exe_name() {
        let directory = env::temp_dir().join(format!("rovai-windows-search-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("codex.exe"), b"native fixture").unwrap();
        fs::write(directory.join("codex.cmd"), b"script fixture").unwrap();
        let search = RuntimeSearchEnvironment {
            executable_suffixes: windows_executable_suffixes_from(Some(OsStr::new(
                ".EXE;.CMD;.BAT;.PS1",
            ))),
            ..test_search(vec![SearchPathEntry {
                path: directory.clone(),
                sources: vec![SearchPathSource::InheritedPath],
            }])
        };

        let candidates =
            search.candidates_with_override(AdapterKind::CodexCli, std::iter::empty(), None);
        assert_eq!(candidates.len(), 1);
        assert_eq!(
            candidates[0].path.file_name(),
            Some(OsStr::new("codex.exe"))
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn command_resolution_returns_the_first_executable_as_an_absolute_path() {
        let directory =
            env::temp_dir().join(format!("rovai-command-resolution-{}", Uuid::new_v4()));
        let first = directory.join("first");
        let second = directory.join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        fs::write(first.join("git"), "not executable").unwrap();
        executable(&second.join("git"), "#!/bin/sh\nexit 0\n");
        let search = test_search(vec![
            SearchPathEntry {
                path: first,
                sources: vec![SearchPathSource::InheritedPath],
            },
            SearchPathEntry {
                path: second.clone(),
                sources: vec![SearchPathSource::LoginShell],
            },
        ]);

        assert_eq!(
            search.resolve_command_path("git"),
            Some(second.join("git").canonicalize().unwrap())
        );
        assert_eq!(search.resolve_command_path("missing-command"), None);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn duplicate_paths_keep_all_provenance_without_changing_priority() {
        let mut entries = Vec::new();
        extend_paths(
            &mut entries,
            [PathBuf::from("/usr/bin")].into_iter(),
            SearchPathSource::InheritedPath,
        );
        extend_paths(
            &mut entries,
            [PathBuf::from("/usr/bin")].into_iter(),
            SearchPathSource::LoginShell,
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].sources,
            [
                SearchPathSource::InheritedPath,
                SearchPathSource::LoginShell
            ]
        );
    }

    #[test]
    fn candidate_priority_is_manual_then_override_then_inherited_shell_and_known() {
        let directory =
            env::temp_dir().join(format!("rovai-discovery-priority-{}", Uuid::new_v4()));
        let sources = [
            ("manual", SearchPathSource::KnownLocation),
            ("override", SearchPathSource::KnownLocation),
            ("inherited", SearchPathSource::InheritedPath),
            ("shell", SearchPathSource::LoginShell),
            ("known", SearchPathSource::KnownLocation),
        ];
        for (name, _) in sources {
            let bin = directory.join(name);
            fs::create_dir_all(&bin).unwrap();
            executable(&bin.join("codex"), "#!/bin/sh\nexit 0\n");
        }
        let search = test_search(
            sources[2..]
                .iter()
                .map(|(name, source)| SearchPathEntry {
                    path: directory.join(name),
                    sources: vec![*source],
                })
                .collect(),
        );
        let candidates = search.candidates_with_override(
            AdapterKind::CodexCli,
            [directory.join("manual")],
            Some(directory.join("override")),
        );
        assert_eq!(
            candidates
                .iter()
                .map(|candidate| candidate.source)
                .collect::<Vec<_>>(),
            [
                InstallationSource::Manual,
                InstallationSource::Env,
                InstallationSource::InheritedPath,
                InstallationSource::LoginShell,
                InstallationSource::KnownLocation,
            ]
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn shell_path_capture_times_out_and_terminates_its_process_group() {
        let directory = env::temp_dir().join(format!("rovai-shell-timeout-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let shell = directory.join("slow-shell");
        executable(&shell, "#!/bin/sh\nsleep 30\n");
        let started = Instant::now();
        let (status, _, paths) = capture_shell_path_from(&shell, false, Duration::from_millis(100));
        assert_eq!(status, ShellPathStatus::TimedOut);
        assert!(paths.is_empty());
        assert!(started.elapsed() < Duration::from_secs(2));
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn quick_discovery_does_not_execute_the_runtime_before_version_enrichment() {
        let directory = env::temp_dir().join(format!("rovai-discovery-layer-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let marker = directory.join("executed");
        let runtime = directory.join("codex");
        executable(
            &runtime,
            &format!(
                "#!/bin/sh\nprintf ran > '{}'\nprintf 'codex 1.2.3\\n'\n",
                marker.display()
            ),
        );
        let search = test_search(vec![SearchPathEntry {
            path: directory.clone(),
            sources: vec![SearchPathSource::InheritedPath],
        }]);
        let mut observation = discover_runtime_path(AdapterKind::CodexCli, &search);
        assert_eq!(observation.discovery_status, RuntimeDiscoveryStatus::Found);
        assert!(!marker.exists(), "path discovery must not execute the CLI");

        discover_runtime_version(&mut observation, &search).await;
        assert_eq!(
            observation.reported_version.as_deref(),
            Some("codex 1.2.3"),
            "version diagnostic: {:?}",
            observation.diagnostic_code
        );
        assert!(
            marker.exists(),
            "version enrichment is a separate bounded step"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn installed_catalog_discovery_runs_only_bounded_identity_commands() {
        let directory = env::temp_dir().join(format!(
            "rovai-discovery-catalog-light-only-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).unwrap();
        let marker = directory.join("invocations");
        for kind in AdapterKind::ALL {
            let version = if kind == AdapterKind::CursorAgent {
                "2026.08.11-e8db854"
            } else {
                "1.2.3"
            };
            executable(
                &directory.join(kind.command_name()),
                &format!(
                    "#!/bin/sh\nprintf '%s\\n' \"$0:$*\" >> '{}'\nprintf '{}\\n'\n",
                    marker.display(),
                    version
                ),
            );
        }
        let search = test_search(vec![SearchPathEntry {
            path: directory.clone(),
            sources: vec![SearchPathSource::InheritedPath],
        }]);

        for kind in AdapterKind::ALL {
            let mut observation = discover_runtime_path(kind, &search);
            discover_runtime_version(&mut observation, &search).await;
            assert!(observation.reported_version.is_some());
        }

        let invocations = fs::read_to_string(&marker).unwrap();
        let lines = invocations.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), AdapterKind::ALL.len());
        assert!(lines.iter().all(|line| line.ends_with(":--version")));
        assert!(!invocations.contains("acp"));
        assert!(!invocations.contains("session"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn cursor_agent_alias_rejects_an_unrelated_agent_binary() {
        let directory =
            env::temp_dir().join(format!("rovai-cursor-agent-collision-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        executable(
            &directory.join("agent"),
            "#!/bin/sh\nprintf 'grok 0.2.118\\n'\n",
        );
        let search = test_search(vec![SearchPathEntry {
            path: directory.clone(),
            sources: vec![SearchPathSource::InheritedPath],
        }]);

        let mut observation = discover_runtime_path(AdapterKind::CursorAgent, &search);
        assert_eq!(observation.discovery_status, RuntimeDiscoveryStatus::Found);
        discover_runtime_version(&mut observation, &search).await;
        assert_eq!(observation.reported_version, None);
        assert_eq!(
            observation.diagnostic_code.as_deref(),
            Some("runtime_identity_mismatch")
        );
        assert!(is_cursor_agent_version("2026.08.11-e8db854"));
        assert!(!is_cursor_agent_version("grok 0.2.118"));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn runtime_launch_policy_is_uniform_for_every_product_runtime() {
        for purpose in [
            RuntimeLaunchPurpose::DiscoveryVersion,
            RuntimeLaunchPurpose::AvailabilityCheck,
            RuntimeLaunchPurpose::InstallationRefresh,
            RuntimeLaunchPurpose::HealthProbe,
            RuntimeLaunchPurpose::DispatchPreflight,
            RuntimeLaunchPurpose::AgentExecution,
        ] {
            for kind in AdapterKind::ALL {
                assert!(runtime_launch_allowed(kind, purpose));
            }
        }
    }

    #[tokio::test]
    async fn trae_version_enrichment_runs_the_same_bounded_light_check_as_other_runtimes() {
        let directory = env::temp_dir().join(format!("rovai-trae-light-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let marker = directory.join("executed");
        let runtime = directory.join("traecli");
        executable(
            &runtime,
            &format!(
                "#!/bin/sh\nprintf ran > '{}'\nprintf 'trae 9.9.9\\n'\n",
                marker.display()
            ),
        );
        let search = test_search(vec![SearchPathEntry {
            path: directory.clone(),
            sources: vec![SearchPathSource::InheritedPath],
        }]);
        let mut observation = discover_runtime_path(AdapterKind::TraeCnCli, &search);
        discover_runtime_version(&mut observation, &search).await;
        assert!(
            marker.exists(),
            "TRAE light verification must execute --version"
        );
        assert_eq!(observation.reported_version.as_deref(), Some("trae 9.9.9"));
        assert_eq!(observation.diagnostic_code, None);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn trae_static_version_accepts_bundle_and_go_module_metadata_only() {
        let directory = env::temp_dir().join(format!("rovai-trae-version-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();

        #[cfg(target_os = "macos")]
        {
            let executable = directory.join("TRAE.app/Contents/MacOS/traecli");
            fs::create_dir_all(executable.parent().unwrap()).unwrap();
            fs::write(&executable, b"not launched").unwrap();
            fs::write(
                directory.join("TRAE.app/Contents/Info.plist"),
                br#"<?xml version="1.0" encoding="UTF-8"?>
                <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
                <plist version="1.0"><dict>
                  <key>CFBundleShortVersionString</key><string>0.120.99</string>
                </dict></plist>"#,
            )
            .unwrap();
            assert_eq!(
                discover_static_runtime_version(AdapterKind::TraeCnCli, &executable).as_deref(),
                Some("0.120.99")
            );
        }

        let go_binary = directory.join("trae-go");
        let mut build_info = Vec::from(GO_BUILD_INFO_MAGIC);
        build_info.extend([8, 2]);
        build_info.extend([0; 16]);
        append_go_build_string(&mut build_info, "go1.25.0");
        append_go_build_string(
            &mut build_info,
            "path\tgithub.com/trae-ai/trae-cli\nmod\tgithub.com/trae-ai/trae-cli\tv0.121.0\n",
        );
        fs::write(&go_binary, build_info).unwrap();
        assert_eq!(
            discover_static_runtime_version(AdapterKind::TraeCnCli, &go_binary).as_deref(),
            Some("v0.121.0")
        );
        assert_eq!(
            discover_static_runtime_version(AdapterKind::CodexCli, &go_binary),
            None
        );
        fs::remove_dir_all(directory).unwrap();
    }

    fn append_go_build_string(target: &mut Vec<u8>, value: &str) {
        let mut length = value.len() as u64;
        while length >= 0x80 {
            target.push((length as u8) | 0x80);
            length >>= 7;
        }
        target.push(length as u8);
        target.extend_from_slice(value.as_bytes());
    }
}

#[cfg(all(test, windows))]
mod windows_path_tests {
    use super::*;

    #[test]
    fn normalized_runtime_path_entries_do_not_expose_verbatim_prefixes() {
        let directory = env::temp_dir().join(format!(
            "rovai-runtime-visible-path-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).unwrap();
        let executable = directory.join("runtime.exe");
        fs::write(&executable, b"native fixture").unwrap();

        let normalized = normalize_directory(directory.clone());
        assert!(!normalized.to_string_lossy().starts_with(r"\\?\"));
        let executable = runtime_visible_path(executable.canonicalize().unwrap());
        assert!(!executable.to_string_lossy().starts_with(r"\\?\"));

        fs::remove_dir_all(directory).unwrap();
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use serde_json::json;

    fn test_search(
        generation: u64,
        path_entries: Vec<SearchPathEntry>,
    ) -> RuntimeSearchEnvironment {
        RuntimeSearchEnvironment {
            generation,
            path_value: env::join_paths(path_entries.iter().map(|entry| entry.path.as_os_str()))
                .unwrap(),
            path_entries,
            executable_suffixes: vec![OsString::from(".exe")],
            created_at: "2026-08-25T00:00:00Z".to_string(),
            shell_diagnostic: ShellPathDiagnostic {
                status: ShellPathStatus::Unavailable,
                interactive: false,
                shell_name: None,
                entry_count: 0,
                elapsed_millis: 0,
            },
        }
    }

    fn npm_codex_installation(root: &Path) -> (PathBuf, PathBuf) {
        const VERSION: &str = "0.149.1";
        let main_package = root.join("node_modules/@openai/codex");
        let entrypoint = main_package.join("bin/codex.js");
        fs::create_dir_all(entrypoint.parent().unwrap()).unwrap();
        fs::write(&entrypoint, b"#!/usr/bin/env node\n").unwrap();
        fs::write(
            main_package.join("package.json"),
            serde_json::to_vec_pretty(&json!({
                "name": "@openai/codex",
                "version": VERSION,
                "bin": { "codex": "bin/codex.js" },
                "optionalDependencies": {
                    "@openai/codex-win32-x64": format!(
                        "npm:@openai/codex@{VERSION}-win32-x64"
                    )
                }
            }))
            .unwrap(),
        )
        .unwrap();

        let platform_package = root.join("node_modules/@openai/codex-win32-x64");
        let executable = platform_package.join("vendor/x86_64-pc-windows-msvc/bin/codex.exe");
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(
            platform_package.join("package.json"),
            serde_json::to_vec_pretty(&json!({
                "name": "@openai/codex",
                "version": format!("{VERSION}-win32-x64"),
                "os": ["win32"],
                "cpu": ["x64"]
            }))
            .unwrap(),
        )
        .unwrap();
        fs::write(&executable, b"real native codex executable").unwrap();

        let target = r"%dp0%\node_modules\@openai\codex\bin\codex.js";
        let shim_content = format!(
            concat!(
                "@ECHO off\r\n",
                "GOTO start\r\n",
                ":find_dp0\r\n",
                "SET dp0=%~dp0\r\n",
                "EXIT /b\r\n",
                ":start\r\n",
                "SETLOCAL\r\n",
                "CALL :find_dp0\r\n",
                "\r\n",
                "IF EXIST \"%dp0%\\node.exe\" (\r\n",
                "  SET \"_prog=%dp0%\\node.exe\"\r\n",
                ") ELSE (\r\n",
                "  SET \"_prog=node\"\r\n",
                ")\r\n",
                "\r\n",
                "endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & \"%_prog%\"  \"{target}\" %*\r\n"
            ),
            target = target
        );
        let shim = root.join("codex.cmd");
        fs::write(&shim, shim_content).unwrap();
        (shim, executable)
    }

    fn inherited_entries(paths: impl IntoIterator<Item = PathBuf>) -> Vec<SearchPathEntry> {
        let mut entries = Vec::new();
        extend_paths(
            &mut entries,
            paths.into_iter(),
            SearchPathSource::InheritedPath,
        );
        entries
    }

    #[test]
    fn executable_file_gate_accepts_exe_and_rejects_script_shims() {
        let directory =
            env::temp_dir().join(format!("rovai-windows-executable-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let executable = directory.join("runtime.exe");
        let command_shim = directory.join("runtime.cmd");
        fs::write(&executable, b"native fixture").unwrap();
        fs::write(&command_shim, b"script fixture").unwrap();

        assert!(is_executable_file(&executable));
        assert!(!is_executable_file(&command_shim));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn windows_known_locations_include_codex_installer_directory() {
        let local_app_data = env::temp_dir().join(format!(
            "rovai-windows-codex-location-{}",
            uuid::Uuid::new_v4()
        ));
        let codex_bin = local_app_data.join("Programs/OpenAI/Codex/bin");
        fs::create_dir_all(&codex_bin).unwrap();

        let locations = known_windows_runtime_directories(
            None,
            Some(local_app_data.clone().into_os_string()),
            None,
            None,
        );

        assert_eq!(locations, [codex_bin]);

        fs::remove_dir_all(local_app_data).unwrap();
    }

    #[test]
    fn windows_npm_shim_discovery_binds_path_and_fingerprint_to_real_executable() {
        let root = env::temp_dir().join(format!(
            "rovai-windows-npm-discovery-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let (shim, executable) = npm_codex_installation(&root);
        let search = test_search(3, inherited_entries([root.clone()]));
        let canonical_executable = runtime_visible_path(executable.canonicalize().unwrap());

        let explicit_candidates =
            search.candidates_with_override(AdapterKind::CodexCli, [shim], None);
        assert_eq!(explicit_candidates.len(), 2);
        assert_eq!(explicit_candidates[0].path, canonical_executable);
        assert_eq!(explicit_candidates[0].source, InstallationSource::Manual);

        let candidates =
            search.candidates_with_override(AdapterKind::CodexCli, std::iter::empty(), None);
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[1].path, canonical_executable);
        assert_eq!(candidates[1].source, InstallationSource::InheritedPath);

        let observation =
            discover_runtime_path_from_candidates(AdapterKind::CodexCli, &search, candidates);
        assert_eq!(observation.discovery_status, RuntimeDiscoveryStatus::Found);
        assert_eq!(
            observation.executable_path.as_deref(),
            Some(canonical_executable.to_string_lossy().as_ref())
        );
        assert_eq!(
            observation.executable_fingerprint,
            Some(executable_fingerprint(&canonical_executable).unwrap())
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn windows_native_codex_executable_precedes_cmd_shim_in_same_directory() {
        let root = env::temp_dir().join(format!(
            "rovai-windows-native-codex-priority-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let (_, shim_executable) = npm_codex_installation(&root);
        let native_executable = root.join("codex.exe");
        fs::write(&native_executable, b"official installer fixture").unwrap();
        let search = test_search(4, inherited_entries([root.clone()]));

        let candidates =
            search.candidates_with_override(AdapterKind::CodexCli, std::iter::empty(), None);
        assert_eq!(candidates.len(), 2);
        assert_eq!(
            candidates[0].path,
            runtime_visible_path(native_executable.canonicalize().unwrap())
        );
        assert_eq!(
            candidates[1].path,
            runtime_visible_path(shim_executable.canonicalize().unwrap())
        );

        let observation =
            discover_runtime_path_from_candidates(AdapterKind::CodexCli, &search, candidates);
        assert_eq!(
            observation.executable_path.as_deref(),
            Some(
                runtime_visible_path(native_executable.canonicalize().unwrap())
                    .to_string_lossy()
                    .as_ref()
            )
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn explicit_invalid_codex_cmd_fails_closed_without_path_fallback() {
        let root = env::temp_dir().join(format!(
            "rovai-windows-explicit-codex-shim-{}",
            uuid::Uuid::new_v4()
        ));
        let explicit = root.join("explicit");
        let fallback = root.join("fallback");
        fs::create_dir_all(&explicit).unwrap();
        fs::create_dir_all(&fallback).unwrap();
        let invalid_shim = explicit.join("codex.cmd");
        fs::write(&invalid_shim, b"@malformed shim\r\n").unwrap();
        let unknown_shim = explicit.join("renamed.cmd");
        fs::write(&unknown_shim, b"@malformed shim\r\n").unwrap();
        fs::write(fallback.join("codex.exe"), b"fallback must not win").unwrap();
        let search = test_search(5, inherited_entries([fallback]));

        assert!(
            search
                .candidates_with_override(AdapterKind::CodexCli, [invalid_shim.clone()], None)
                .is_empty()
        );
        assert!(
            search
                .candidates_with_override(
                    AdapterKind::CodexCli,
                    std::iter::empty(),
                    Some(invalid_shim)
                )
                .is_empty()
        );
        assert!(
            search
                .candidates_with_override(AdapterKind::CodexCli, [unknown_shim], None)
                .is_empty()
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn windows_rescan_hydrates_new_user_path_without_restart() {
        let root = env::temp_dir().join(format!(
            "rovai-windows-user-path-rescan-{}",
            uuid::Uuid::new_v4()
        ));
        let inherited = root.join("inherited");
        let newly_installed = root.join("new-user-path");
        fs::create_dir_all(&inherited).unwrap();
        fs::create_dir_all(&newly_installed).unwrap();
        fs::write(newly_installed.join("codex.exe"), b"newly installed").unwrap();

        let initial = test_search(1, inherited_entries([inherited.clone()]));
        let initial_candidates =
            initial.candidates_with_override(AdapterKind::CodexCli, std::iter::empty(), None);
        assert_eq!(
            discover_runtime_path_from_candidates(
                AdapterKind::CodexCli,
                &initial,
                initial_candidates,
            )
            .discovery_status,
            RuntimeDiscoveryStatus::Missing
        );

        let mut rescanned_entries = inherited_entries([inherited]);
        extend_windows_registry_paths(
            &mut rescanned_entries,
            &WindowsRegistryPathValues {
                user: Some(newly_installed.clone().into_os_string()),
                machine: None,
            },
            &[],
        );
        let rescanned = test_search(2, rescanned_entries);
        let rescanned_candidates =
            rescanned.candidates_with_override(AdapterKind::CodexCli, std::iter::empty(), None);
        let observation = discover_runtime_path_from_candidates(
            AdapterKind::CodexCli,
            &rescanned,
            rescanned_candidates,
        );
        assert_eq!(observation.discovery_status, RuntimeDiscoveryStatus::Found);
        assert_eq!(observation.search_generation, 2);
        assert_eq!(
            observation.executable_path.as_deref(),
            Some(
                runtime_visible_path(newly_installed.join("codex.exe").canonicalize().unwrap())
                    .to_string_lossy()
                    .as_ref()
            )
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn windows_hydration_order_is_inherited_user_machine_then_known() {
        let root = env::temp_dir().join(format!(
            "rovai-windows-path-priority-{}",
            uuid::Uuid::new_v4()
        ));
        let inherited = root.join("inherited-current");
        let user = root.join("user-current");
        let machine = root.join("machine-old");
        let known = root.join("known-fallback");
        for (directory, body) in [
            (&inherited, b"inherited".as_slice()),
            (&user, b"user".as_slice()),
            (&machine, b"machine".as_slice()),
            (&known, b"known".as_slice()),
        ] {
            fs::create_dir_all(directory).unwrap();
            fs::write(directory.join("codex.exe"), body).unwrap();
        }

        let mut entries = inherited_entries([inherited.clone()]);
        extend_windows_registry_paths(
            &mut entries,
            &WindowsRegistryPathValues {
                user: Some(user.clone().into_os_string()),
                machine: Some(machine.clone().into_os_string()),
            },
            &[],
        );
        extend_paths(
            &mut entries,
            [known.clone()].into_iter(),
            SearchPathSource::KnownLocation,
        );
        let expected_paths = [&inherited, &user, &machine, &known]
            .into_iter()
            .map(|path| normalize_directory(path.clone()))
            .collect::<Vec<_>>();
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.path.clone())
                .collect::<Vec<_>>(),
            expected_paths
        );

        let search = test_search(6, entries);
        let candidates =
            search.candidates_with_override(AdapterKind::CodexCli, std::iter::empty(), None);
        let observation =
            discover_runtime_path_from_candidates(AdapterKind::CodexCli, &search, candidates);
        assert_eq!(
            observation.executable_path.as_deref(),
            Some(
                runtime_visible_path(inherited.join("codex.exe").canonicalize().unwrap())
                    .to_string_lossy()
                    .as_ref()
            )
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unavailable_registry_keeps_inherited_path_and_case_duplicates_collapse() {
        let mut entries = inherited_entries([PathBuf::from(r"C:\Users\Example\Codex\bin")]);
        extend_windows_registry_paths(&mut entries, &WindowsRegistryPathValues::default(), &[]);
        assert_eq!(entries.len(), 1);

        extend_paths(
            &mut entries,
            [PathBuf::from(r"c:\users\example\codex\BIN")].into_iter(),
            SearchPathSource::KnownLocation,
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].sources,
            [
                SearchPathSource::InheritedPath,
                SearchPathSource::KnownLocation
            ]
        );
    }

    #[test]
    fn codebuddy_version_probe_allows_its_windows_cold_start() {
        assert_eq!(
            version_timeout(AdapterKind::CodebuddyCli),
            Duration::from_secs(5)
        );
        assert_eq!(
            version_timeout(AdapterKind::CodexCli),
            Duration::from_secs(2)
        );
    }
}
