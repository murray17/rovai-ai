use std::{
    collections::BTreeMap,
    env,
    ffi::{OsStr, OsString},
    fs,
    future::Future,
    io::Read,
    os::unix::{fs::PermissionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{OnceLock, RwLock},
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use serde::Serialize;
use tokio::{io::AsyncReadExt, process::Command as TokioCommand, time::timeout};
use uuid::Uuid;

use crate::{
    agent_profile::{AdapterKind, InstallationSource},
    agent_runtime_adapter::executable_fingerprint,
};

const SHELL_PATH_TIMEOUT: Duration = Duration::from_secs(3);
const VERSION_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_SHELL_PATH_BYTES: u64 = 64 * 1024;
const MAX_VERSION_OUTPUT_BYTES: usize = 8 * 1024;

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
            known_macos_runtime_directories().into_iter(),
            SearchPathSource::KnownLocation,
        );
        let path_value = env::join_paths(entries.iter().map(|entry| entry.path.as_os_str()))
            .unwrap_or_else(|_| env::var_os("PATH").unwrap_or_default());
        Self {
            generation,
            path_entries: entries,
            path_value,
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
            push_candidate(
                &mut candidates,
                path,
                InstallationSource::Manual,
                kind.command_name(),
            );
        }
        if let Some(path) = override_path {
            push_candidate(
                &mut candidates,
                path,
                InstallationSource::Env,
                kind.command_name(),
            );
        }
        for entry in &self.path_entries {
            let source = entry
                .sources
                .first()
                .copied()
                .unwrap_or(SearchPathSource::KnownLocation)
                .installation_source();
            push_candidate(
                &mut candidates,
                entry.path.clone(),
                source,
                kind.command_name(),
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
    let observed_at = chrono::Utc::now().to_rfc3339();
    for candidate in search.candidates(kind, std::iter::empty()) {
        if !is_executable_file(&candidate.path) {
            continue;
        }
        let canonical = candidate
            .path
            .canonicalize()
            .unwrap_or_else(|_| candidate.path.clone());
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
    match bounded_version_command(
        Path::new(path),
        version_arguments(observation.runtime_kind),
        search,
    )
    .await
    {
        Ok(version) if !version.is_empty() => observation.reported_version = Some(version),
        Ok(_) => observation.diagnostic_code = Some("runtime_version_empty".to_string()),
        Err(error) => observation.diagnostic_code = Some(error.to_string()),
    }
    observation.observed_at = chrono::Utc::now().to_rfc3339();
}

fn version_arguments(kind: AdapterKind) -> &'static [&'static str] {
    match kind {
        AdapterKind::AntigravityApp => &["--version"],
        _ => &["--version"],
    }
}

async fn bounded_version_command(
    executable: &Path,
    arguments: &[&str],
    search: &RuntimeSearchEnvironment,
) -> Result<String> {
    let mut command = TokioCommand::new(executable);
    command
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    command.as_std_mut().process_group(0);
    search.configure_tokio_command(&mut command);
    let mut child = command.spawn().context("runtime_version_spawn_failed")?;
    let pid = child.id();
    let mut stdout = child
        .stdout
        .take()
        .context("runtime_version_stdout_unavailable")?;
    let reader = tokio::spawn(async move {
        let mut kept = Vec::new();
        let mut buffer = [0_u8; 1024];
        loop {
            let read = stdout.read(&mut buffer).await?;
            if read == 0 {
                break;
            }
            if kept.len() < MAX_VERSION_OUTPUT_BYTES {
                let remaining = MAX_VERSION_OUTPUT_BYTES - kept.len();
                kept.extend_from_slice(&buffer[..read.min(remaining)]);
            }
        }
        Ok::<_, std::io::Error>(kept)
    });
    let status = match timeout(VERSION_TIMEOUT, child.wait()).await {
        Ok(result) => result.context("runtime_version_wait_failed")?,
        Err(_) => {
            if let Some(pid) = pid {
                // SAFETY: pid is the just-spawned child process group, never a broad or inferred
                // target. A failed kill is followed by Child::start_kill as a fallback.
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGKILL);
                }
            }
            let _ = child.start_kill();
            let _ = child.wait().await;
            reader.abort();
            anyhow::bail!("runtime_version_timed_out");
        }
    };
    let output = reader
        .await
        .context("runtime_version_reader_join_failed")?
        .context("runtime_version_read_failed")?;
    if !status.success() {
        anyhow::bail!("runtime_version_failed");
    }
    let output_text = String::from_utf8_lossy(&output);
    let first_line = output_text
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default()
        .trim();
    Ok(first_line.chars().take(256).collect())
}

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
        if let Some(existing) = entries.iter_mut().find(|entry| entry.path == normalized) {
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

fn normalize_directory(path: PathBuf) -> PathBuf {
    path.canonicalize().unwrap_or(path)
}

fn push_candidate(
    candidates: &mut Vec<RuntimeExecutableCandidate>,
    path_or_directory: PathBuf,
    source: InstallationSource,
    command_name: &str,
) {
    let path = if path_or_directory.is_dir() {
        path_or_directory.join(command_name)
    } else {
        path_or_directory
    };
    let canonical = path.canonicalize().unwrap_or(path);
    if candidates
        .iter()
        .any(|candidate| candidate.path == canonical)
    {
        return;
    }
    candidates.push(RuntimeExecutableCandidate {
        path: canonical,
        source,
    });
}

pub fn is_executable_file(path: &Path) -> bool {
    fs::metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

fn known_macos_runtime_directories() -> Vec<PathBuf> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_search(entries: Vec<SearchPathEntry>) -> RuntimeSearchEnvironment {
        RuntimeSearchEnvironment {
            generation: 7,
            path_value: env::join_paths(entries.iter().map(|entry| entry.path.as_os_str()))
                .unwrap(),
            path_entries: entries,
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
    fn known_catalog_has_exactly_ten_stable_products() {
        let entries = catalog_entries();
        assert_eq!(entries.len(), 10);
        assert_eq!(entries[0]["runtimeKind"], "codex-cli");
        assert!(
            entries
                .iter()
                .any(|entry| entry["runtimeKind"] == "qwen-code")
        );
        assert!(
            entries
                .iter()
                .any(|entry| entry["runtimeKind"] == "trae-cn-cli")
        );
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
}
