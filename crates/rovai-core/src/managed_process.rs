use std::{
    collections::BTreeMap,
    env,
    ffi::{OsStr, OsString},
    io,
    path::{Path, PathBuf},
    process::ExitStatus,
};

#[cfg(unix)]
use std::{os::unix::process::CommandExt, process::Stdio};

use anyhow::{Context, Result, bail};
use tokio::process::Command;

#[cfg(windows)]
use crate::windows_runtime_entrypoint::{
    WINDOWS_COMMAND_SHIM_PATH_ENVIRONMENT_KEY, WindowsCommandShimIdentity,
    capture_windows_command_shim, command_shim_extension,
};

#[cfg(target_os = "macos")]
use std::sync::OnceLock;

#[cfg(unix)]
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};

#[cfg(windows)]
#[path = "managed_process/windows.rs"]
mod windows;

#[cfg(unix)]
pub type ManagedChildStdin = ChildStdin;
#[cfg(unix)]
pub type ManagedChildStdout = ChildStdout;
#[cfg(unix)]
pub type ManagedChildStderr = ChildStderr;

#[cfg(windows)]
pub type ManagedChildStdin = tokio::fs::File;
#[cfg(windows)]
pub type ManagedChildStdout = tokio::fs::File;
#[cfg(windows)]
pub type ManagedChildStderr = tokio::fs::File;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManagedProcessPurpose {
    RuntimeProbe,
    RuntimeHost,
    RuntimeOneShot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManagedStdinPolicy {
    Null,
    Piped,
}

/// The Windows command-line decoder expected by the target executable. This
/// declaration selects a serializer only; Runtime Platform Admission remains
/// the authority for whether an Adapter may launch on Windows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManagedWindowsArgvDialect {
    MicrosoftCrt,
}

#[cfg(windows)]
#[derive(Debug, Clone, PartialEq, Eq)]
enum WindowsRuntimeEntrypoint {
    NativeExecutable {
        executable: PathBuf,
    },
    CommandShim {
        shim: PathBuf,
        interpreter: PathBuf,
        resolved_target: Option<PathBuf>,
        identity: WindowsCommandShimIdentity,
    },
}

/// Immutable launch snapshot consumed by the platform backend. Callers may use
/// their existing adapter-specific command builders, but no mutable Command
/// crosses the launch boundary.
#[derive(Debug, Clone)]
pub struct ManagedProcessLaunchSpec {
    purpose: ManagedProcessPurpose,
    application: PathBuf,
    arguments: Vec<OsString>,
    working_directory: PathBuf,
    environment: BTreeMap<OsString, OsString>,
    stdin_policy: ManagedStdinPolicy,
    windows_argv_dialect: ManagedWindowsArgvDialect,
    #[cfg(windows)]
    application_identity: windows::WindowsApplicationIdentity,
    #[cfg(windows)]
    windows_entrypoint: WindowsRuntimeEntrypoint,
    #[cfg(target_os = "macos")]
    user_automation_denial_root: Option<PathBuf>,
    ownership: String,
}

#[cfg(target_os = "macos")]
static USER_AUTOMATION_DENIAL_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Configures the Desktop User Automation credential tree that every
/// Core-managed Runtime process must be unable to read or mutate. This is a
/// process-global launch invariant because every Runtime entry point funnels
/// through `ManagedProcessLaunchSpec`.
#[cfg(target_os = "macos")]
pub fn configure_user_automation_denial_root(root: &Path) -> Result<()> {
    if !root.is_absolute()
        || root
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        bail!(
            "managed_process.invalid_user_automation_denial_root: {}",
            root.display()
        );
    }
    let root = if root.exists() {
        std::fs::canonicalize(root)?
    } else {
        let parent = root.parent().context(
            "managed_process.invalid_user_automation_denial_root: missing parent directory",
        )?;
        let file_name = root.file_name().context(
            "managed_process.invalid_user_automation_denial_root: missing final component",
        )?;
        std::fs::canonicalize(parent)?.join(file_name)
    };
    if let Some(existing) = USER_AUTOMATION_DENIAL_ROOT.get() {
        if existing != &root {
            bail!(
                "managed_process.user_automation_denial_root_already_configured: {}",
                existing.display()
            );
        }
        return Ok(());
    }
    USER_AUTOMATION_DENIAL_ROOT
        .set(root)
        .map_err(|_| anyhow::anyhow!("managed_process.user_automation_denial_root_race"))
}

impl ManagedProcessLaunchSpec {
    pub fn capture(
        command: &Command,
        purpose: ManagedProcessPurpose,
        stdin_policy: ManagedStdinPolicy,
        windows_argv_dialect: ManagedWindowsArgvDialect,
        ownership: impl Into<String>,
    ) -> Result<Self> {
        let command = command.as_std();
        let requested_application = PathBuf::from(command.get_program());
        if !requested_application.is_absolute() || !requested_application.is_file() {
            bail!(
                "managed_process.invalid_application: expected an absolute file, got {}",
                requested_application.display()
            );
        }
        #[cfg(windows)]
        let (application, windows_entrypoint) =
            capture_windows_runtime_entrypoint(&requested_application)?;
        #[cfg(not(windows))]
        let application = requested_application;
        #[cfg(windows)]
        let application_identity = windows::capture_application_identity(&application)?;
        let arguments = command.get_args().map(OsString::from).collect::<Vec<_>>();
        if arguments
            .iter()
            .any(|argument| argument.to_string_lossy().contains('\0'))
        {
            bail!("managed_process.invalid_argument: argv contains NUL");
        }
        let working_directory = match command.get_current_dir() {
            Some(path) if path.is_absolute() => path.to_path_buf(),
            Some(path) => env::current_dir()
                .context("managed_process.invalid_argument: current directory is unavailable")?
                .join(path),
            None => env::current_dir()
                .context("managed_process.invalid_argument: current directory is unavailable")?,
        };
        if !working_directory.is_absolute() || !working_directory.is_dir() {
            bail!(
                "managed_process.invalid_argument: working directory is unavailable: {}",
                working_directory.display()
            );
        }

        let mut environment = BTreeMap::new();
        for (key, value) in env::vars_os() {
            insert_environment(&mut environment, key, value);
        }
        for (key, value) in command.get_envs() {
            match value {
                Some(value) => {
                    insert_environment(&mut environment, key.to_os_string(), value.to_os_string());
                }
                None => {
                    remove_environment(&mut environment, key);
                }
            }
        }
        #[cfg(windows)]
        if let WindowsRuntimeEntrypoint::CommandShim {
            shim, interpreter, ..
        } = &windows_entrypoint
        {
            insert_environment(
                &mut environment,
                OsString::from("ComSpec"),
                interpreter.as_os_str().to_os_string(),
            );
            insert_environment(
                &mut environment,
                OsString::from(WINDOWS_COMMAND_SHIM_PATH_ENVIRONMENT_KEY),
                shim.as_os_str().to_os_string(),
            );
        }
        let ownership = ownership.into();
        if ownership.trim().is_empty() {
            bail!("managed_process.invalid_argument: ownership identity is empty");
        }

        Ok(Self {
            purpose,
            application,
            arguments,
            working_directory,
            environment,
            stdin_policy,
            windows_argv_dialect,
            #[cfg(windows)]
            application_identity,
            #[cfg(windows)]
            windows_entrypoint,
            #[cfg(target_os = "macos")]
            user_automation_denial_root: USER_AUTOMATION_DENIAL_ROOT.get().cloned(),
            ownership,
        })
    }

    /// Derives a one-shot child from an already-admitted Runtime launch. The
    /// requested application is resolved only after the request's final cwd and
    /// environment overlay are known, so portable commands use the exact child
    /// context without introducing a shell command string.
    pub fn derive_runtime_one_shot_command(
        &self,
        requested_application: &OsStr,
        arguments: Vec<OsString>,
        working_directory: PathBuf,
        environment_overrides: BTreeMap<OsString, OsString>,
        ownership: impl Into<String>,
    ) -> Result<Self> {
        if arguments
            .iter()
            .any(|argument| argument.to_string_lossy().contains('\0'))
        {
            bail!("managed_process.invalid_argument: argv contains NUL");
        }
        if !working_directory.is_absolute() || !working_directory.is_dir() {
            bail!(
                "managed_process.invalid_argument: working directory is unavailable: {}",
                working_directory.display()
            );
        }
        let mut environment = self.environment.clone();
        for (key, value) in environment_overrides {
            if key.is_empty()
                || key.to_string_lossy().contains(['\0', '='])
                || value.to_string_lossy().contains('\0')
            {
                bail!("managed_process.invalid_argument: environment override is invalid");
            }
            insert_environment(&mut environment, key, value);
        }
        let requested_application = Path::new(requested_application);
        #[cfg(windows)]
        let (application, windows_entrypoint) = capture_windows_runtime_entrypoint(
            &resolve_captured_application(requested_application, &working_directory, &environment)?,
        )?;
        #[cfg(not(windows))]
        let application =
            prepare_unix_derived_application(requested_application, &working_directory)?;
        #[cfg(windows)]
        let application_identity = windows::capture_application_identity(&application)?;
        #[cfg(windows)]
        if let WindowsRuntimeEntrypoint::CommandShim {
            shim, interpreter, ..
        } = &windows_entrypoint
        {
            insert_environment(
                &mut environment,
                OsString::from("ComSpec"),
                interpreter.as_os_str().to_os_string(),
            );
            insert_environment(
                &mut environment,
                OsString::from(WINDOWS_COMMAND_SHIM_PATH_ENVIRONMENT_KEY),
                shim.as_os_str().to_os_string(),
            );
        }
        let ownership = ownership.into();
        if ownership.trim().is_empty() {
            bail!("managed_process.invalid_argument: ownership identity is empty");
        }
        Ok(Self {
            purpose: ManagedProcessPurpose::RuntimeOneShot,
            application,
            arguments,
            working_directory,
            environment,
            stdin_policy: ManagedStdinPolicy::Null,
            windows_argv_dialect: self.windows_argv_dialect,
            #[cfg(windows)]
            application_identity,
            #[cfg(windows)]
            windows_entrypoint,
            #[cfg(target_os = "macos")]
            user_automation_denial_root: self.user_automation_denial_root.clone(),
            ownership,
        })
    }

    pub fn application(&self) -> &Path {
        &self.application
    }

    pub fn purpose(&self) -> ManagedProcessPurpose {
        self.purpose
    }

    pub fn ownership(&self) -> &str {
        &self.ownership
    }

    pub fn arguments(&self) -> &[OsString] {
        &self.arguments
    }

    pub fn working_directory(&self) -> &Path {
        &self.working_directory
    }

    pub fn environment(&self) -> &BTreeMap<OsString, OsString> {
        &self.environment
    }

    pub fn stdin_policy(&self) -> ManagedStdinPolicy {
        self.stdin_policy
    }

    pub fn windows_argv_dialect(&self) -> ManagedWindowsArgvDialect {
        self.windows_argv_dialect
    }

    #[cfg(windows)]
    fn application_identity(&self) -> &windows::WindowsApplicationIdentity {
        &self.application_identity
    }

    #[cfg(windows)]
    fn windows_entrypoint(&self) -> &WindowsRuntimeEntrypoint {
        &self.windows_entrypoint
    }
}

#[cfg(windows)]
fn capture_windows_runtime_entrypoint(
    requested_application: &Path,
) -> Result<(PathBuf, WindowsRuntimeEntrypoint)> {
    if requested_application
        .extension()
        .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("exe"))
    {
        let executable = requested_application.canonicalize().with_context(|| {
            format!(
                "managed_process.invalid_application: executable is unavailable: {}",
                requested_application.display()
            )
        })?;
        return Ok((
            executable.clone(),
            WindowsRuntimeEntrypoint::NativeExecutable { executable },
        ));
    }
    if command_shim_extension(requested_application).is_some() {
        let identity = capture_windows_command_shim(requested_application)?;
        let interpreter = identity.interpreter.clone();
        let shim = identity.shim.clone();
        return Ok((
            interpreter.clone(),
            WindowsRuntimeEntrypoint::CommandShim {
                shim,
                interpreter,
                resolved_target: None,
                identity,
            },
        ));
    }
    bail!(
        "managed_process.invalid_application: expected a native Windows EXE or a .cmd/.bat command shim, got {}",
        requested_application.display()
    )
}

#[cfg(windows)]
fn environment_value<'a>(
    environment: &'a BTreeMap<OsString, OsString>,
    key: &std::ffi::OsStr,
) -> Option<&'a std::ffi::OsStr> {
    #[cfg(windows)]
    let value = environment
        .iter()
        .find(|(candidate, _)| windows::environment_keys_equal(candidate, key))
        .map(|(_, value)| value);
    #[cfg(not(windows))]
    let value = environment.get(key);
    value.map(OsString::as_os_str)
}

#[cfg(windows)]
fn resolve_captured_application(
    requested: &Path,
    working_directory: &Path,
    environment: &BTreeMap<OsString, OsString>,
) -> Result<PathBuf> {
    validate_requested_application(requested)?;
    if requested.is_absolute() {
        if !requested.is_file() {
            bail!(
                "managed_process.invalid_application: expected an absolute file, got {}",
                requested.display()
            );
        }
        return Ok(requested.to_path_buf());
    }

    let is_command_name =
        requested.components().count() == 1 && requested.file_name() == Some(requested.as_os_str());
    if is_command_name {
        let path = environment_value(environment, std::ffi::OsStr::new("PATH"))
            .context("managed_process.invalid_application: Runtime PATH is unavailable")?;
        for directory in env::split_paths(path) {
            let directory = if directory.is_absolute() {
                directory
            } else {
                working_directory.join(directory)
            };
            for candidate in platform_application_candidates(&directory.join(requested)) {
                if let Ok(application) = canonical_launch_candidate(&candidate) {
                    return Ok(application);
                }
            }
        }
        bail!(
            "managed_process.invalid_application: command is not available on Runtime PATH: {}",
            requested.display()
        );
    }

    for candidate in platform_application_candidates(&working_directory.join(requested)) {
        if let Ok(application) = canonical_launch_candidate(&candidate) {
            return Ok(application);
        }
    }
    bail!(
        "managed_process.invalid_application: relative application is unavailable from the Runtime working directory: {}",
        requested.display()
    )
}

#[cfg(not(windows))]
fn prepare_unix_derived_application(requested: &Path, working_directory: &Path) -> Result<PathBuf> {
    validate_requested_application(requested)?;
    let is_command_name =
        requested.components().count() == 1 && requested.file_name() == Some(requested.as_os_str());
    if is_command_name {
        return Ok(requested.to_path_buf());
    }
    let candidate = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        working_directory.join(requested)
    };
    canonical_launch_candidate(&candidate)
}

fn validate_requested_application(requested: &Path) -> Result<()> {
    if requested.as_os_str().is_empty() || requested.as_os_str().to_string_lossy().contains('\0') {
        bail!("managed_process.invalid_application: application must not be empty or contain NUL");
    }
    Ok(())
}

#[cfg(windows)]
fn platform_application_candidates(path: &Path) -> Vec<PathBuf> {
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase());
    if matches!(extension.as_deref(), Some("exe" | "cmd" | "bat")) {
        return vec![path.to_path_buf()];
    }
    [".exe", ".cmd", ".bat"]
        .into_iter()
        .map(|suffix| {
            let mut candidate = path.as_os_str().to_os_string();
            candidate.push(suffix);
            PathBuf::from(candidate)
        })
        .collect()
}

fn canonical_launch_candidate(path: &Path) -> Result<PathBuf> {
    let application = path.canonicalize().with_context(|| {
        format!(
            "managed_process.invalid_application: executable is unavailable: {}",
            path.display()
        )
    })?;
    if !application.is_file() {
        bail!(
            "managed_process.invalid_application: expected a file, got {}",
            application.display()
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if application.metadata()?.permissions().mode() & 0o111 == 0 {
            bail!(
                "managed_process.invalid_application: file is not executable: {}",
                application.display()
            );
        }
    }
    Ok(application)
}

fn insert_environment(
    environment: &mut BTreeMap<OsString, OsString>,
    key: OsString,
    value: OsString,
) {
    remove_environment(environment, &key);
    environment.insert(key, value);
}

fn remove_environment(environment: &mut BTreeMap<OsString, OsString>, key: &std::ffi::OsStr) {
    #[cfg(windows)]
    let existing = environment
        .keys()
        .find(|candidate| windows::environment_keys_equal(candidate, key))
        .cloned();
    #[cfg(not(windows))]
    let existing = environment.contains_key(key).then(|| key.to_os_string());
    if let Some(existing) = existing {
        environment.remove(&existing);
    }
}

/// Cross-platform ownership boundary for a Runtime process tree. Platform
/// handles remain private; callers can only use stdio, PID, wait, and bounded
/// tree termination.
pub struct ManagedProcess {
    #[cfg(unix)]
    child: Child,
    #[cfg(unix)]
    process_group_id: Option<i32>,
    #[cfg(windows)]
    child: windows::WindowsManagedProcess,
    tree_termination_requested: bool,
}

impl ManagedProcess {
    pub fn spawn(spec: ManagedProcessLaunchSpec) -> Result<Self> {
        #[cfg(unix)]
        {
            let mut command = command_from_spec(&spec)?;
            command.as_std_mut().process_group(0);
            let child = command.spawn().with_context(|| {
                format!(
                    "managed_process.spawn_failed: {}",
                    spec.application.display()
                )
            })?;
            let process_group_id = child.id().and_then(|pid| i32::try_from(pid).ok());
            Ok(Self {
                child,
                process_group_id,
                tree_termination_requested: false,
            })
        }

        #[cfg(windows)]
        {
            let child = windows::WindowsManagedProcess::spawn(&spec)?;
            Ok(Self {
                child,
                tree_termination_requested: false,
            })
        }

        #[cfg(not(any(unix, windows)))]
        {
            let _ = spec;
            bail!("managed_process.spawn_failed: unsupported host platform");
        }
    }

    pub fn id(&self) -> Option<u32> {
        #[cfg(unix)]
        {
            return self.child.id();
        }
        #[cfg(windows)]
        {
            return Some(self.child.id());
        }
        #[allow(unreachable_code)]
        None
    }

    pub fn take_stdin(&mut self) -> Option<ManagedChildStdin> {
        #[cfg(unix)]
        {
            return self.child.stdin.take();
        }
        #[cfg(windows)]
        {
            return self.child.take_stdin();
        }
        #[allow(unreachable_code)]
        None
    }

    pub fn take_stdout(&mut self) -> Option<ManagedChildStdout> {
        #[cfg(unix)]
        {
            return self.child.stdout.take();
        }
        #[cfg(windows)]
        {
            return self.child.take_stdout();
        }
        #[allow(unreachable_code)]
        None
    }

    pub fn take_stderr(&mut self) -> Option<ManagedChildStderr> {
        #[cfg(unix)]
        {
            return self.child.stderr.take();
        }
        #[cfg(windows)]
        {
            return self.child.take_stderr();
        }
        #[allow(unreachable_code)]
        None
    }

    pub async fn wait(&mut self) -> io::Result<ExitStatus> {
        #[cfg(unix)]
        {
            return self.child.wait().await;
        }
        #[cfg(windows)]
        {
            return self.child.wait().await;
        }
        #[allow(unreachable_code)]
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "managed process is unsupported on this host",
        ))
    }

    pub fn request_graceful_termination(&mut self) -> io::Result<()> {
        #[cfg(unix)]
        if let Some(process_group_id) = self.process_group_id.filter(|value| *value > 1) {
            // SAFETY: the process was created as the leader of a fresh group by
            // this module; the ID cannot name Rovai's own process group.
            let result = unsafe { libc::killpg(process_group_id, libc::SIGTERM) };
            if result == 0 {
                return Ok(());
            }
            return Err(io::Error::last_os_error());
        }
        #[cfg(unix)]
        {
            return self.child.start_kill();
        }
        #[cfg(windows)]
        {
            self.child.terminate_job()?;
            self.tree_termination_requested = true;
            return Ok(());
        }
        #[allow(unreachable_code)]
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "managed process is unsupported on this host",
        ))
    }

    pub fn force_terminate_tree(&mut self) -> io::Result<()> {
        if self.tree_termination_requested {
            return Ok(());
        }
        #[cfg(unix)]
        if let Some(process_group_id) = self.process_group_id.filter(|value| *value > 1) {
            // SAFETY: the process group is created and owned by this instance.
            let result = unsafe { libc::killpg(process_group_id, libc::SIGKILL) };
            if result == 0 {
                self.tree_termination_requested = true;
                return Ok(());
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                return Err(error);
            }
        }
        #[cfg(unix)]
        {
            return match self.child.start_kill() {
                Ok(()) => {
                    self.tree_termination_requested = true;
                    Ok(())
                }
                Err(error) if error.kind() == io::ErrorKind::InvalidInput => {
                    self.tree_termination_requested = true;
                    Ok(())
                }
                Err(error) => Err(error),
            };
        }
        #[cfg(windows)]
        {
            match self.child.terminate_job() {
                Ok(()) => {
                    self.tree_termination_requested = true;
                    return Ok(());
                }
                Err(error) => return Err(error),
            }
        }
        #[allow(unreachable_code)]
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "managed process is unsupported on this host",
        ))
    }
}

impl Drop for ManagedProcess {
    fn drop(&mut self) {
        if !self.tree_termination_requested {
            let _ = self.force_terminate_tree();
        }
    }
}

#[cfg(unix)]
fn command_from_spec(spec: &ManagedProcessLaunchSpec) -> Result<Command> {
    #[cfg(target_os = "macos")]
    let (application, arguments) = if let Some(root) = &spec.user_automation_denial_root {
        let sandbox_executable = Path::new("/usr/bin/sandbox-exec");
        if !sandbox_executable.is_file() {
            bail!("managed_process.runtime_sandbox_unavailable");
        }
        let root = root.to_str().with_context(|| {
            format!(
                "managed_process.invalid_user_automation_denial_root: {}",
                root.display()
            )
        })?;
        let root_literal = serde_json::to_string(root)?;
        let profile = format!(
            "(version 1) (allow default) (deny file-read* (subpath {root_literal})) (deny file-write* (subpath {root_literal}))"
        );
        let mut arguments = vec![
            OsString::from("-p"),
            OsString::from(profile),
            OsString::from("--"),
            spec.application.as_os_str().to_os_string(),
        ];
        arguments.extend(spec.arguments.iter().cloned());
        (sandbox_executable, arguments)
    } else {
        (spec.application.as_path(), spec.arguments.clone())
    };
    #[cfg(not(target_os = "macos"))]
    let (application, arguments) = (spec.application.as_path(), spec.arguments.clone());

    let mut command = Command::new(application);
    command
        .args(arguments)
        .current_dir(&spec.working_directory)
        .env_clear()
        .envs(&spec.environment)
        .stdin(match spec.stdin_policy {
            ManagedStdinPolicy::Null => Stdio::null(),
            ManagedStdinPolicy::Piped => Stdio::piped(),
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    use std::time::Duration;

    #[cfg(windows)]
    const WINDOWS_HELPER_MODE: &str = "ROVAI_MANAGED_PROCESS_HELPER_MODE";
    #[cfg(windows)]
    const WINDOWS_HELPER_FILE: &str = "ROVAI_MANAGED_PROCESS_HELPER_FILE";
    #[cfg(windows)]
    const WINDOWS_HELPER_HANDLE: &str = "ROVAI_MANAGED_PROCESS_HELPER_HANDLE";
    #[cfg(windows)]
    const WINDOWS_HELPER_IDENTITY: &str = "ROVAI_MANAGED_PROCESS_HELPER_IDENTITY";

    #[test]
    fn capture_requires_absolute_application_and_nonempty_owner() {
        let relative = Command::new("runtime");
        assert!(
            ManagedProcessLaunchSpec::capture(
                &relative,
                ManagedProcessPurpose::RuntimeProbe,
                ManagedStdinPolicy::Null,
                ManagedWindowsArgvDialect::MicrosoftCrt,
                "probe:test",
            )
            .unwrap_err()
            .to_string()
            .contains("managed_process.invalid_application")
        );

        let absolute = Command::new(std::env::current_exe().unwrap());
        assert!(
            ManagedProcessLaunchSpec::capture(
                &absolute,
                ManagedProcessPurpose::RuntimeProbe,
                ManagedStdinPolicy::Null,
                ManagedWindowsArgvDialect::MicrosoftCrt,
                "",
            )
            .unwrap_err()
            .to_string()
            .contains("managed_process.invalid_argument")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn derived_runtime_one_shot_resolves_against_the_final_request_context() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "rovai-managed-derived-command-{}",
            uuid::Uuid::new_v4()
        ));
        let host_cwd = root.join("host");
        let request_cwd = root.join("request");
        let request_bin = root.join("request-bin");
        std::fs::create_dir_all(&host_cwd).unwrap();
        std::fs::create_dir_all(request_cwd.join("scripts")).unwrap();
        std::fs::create_dir_all(&request_bin).unwrap();

        let bare = request_bin.join("terminal-context-tool");
        std::fs::write(&bare, "#!/bin/sh\nprintf 'request-path:%s' \"$PWD\"\n").unwrap();
        std::fs::set_permissions(&bare, std::fs::Permissions::from_mode(0o700)).unwrap();
        let relative = request_cwd.join("scripts/build");
        std::fs::write(&relative, "#!/bin/sh\nprintf relative-cwd\n").unwrap();
        std::fs::set_permissions(&relative, std::fs::Permissions::from_mode(0o700)).unwrap();

        let mut host = Command::new("/bin/sh");
        host.current_dir(&host_cwd).env("PATH", "/usr/bin:/bin");
        let template = ManagedProcessLaunchSpec::capture(
            &host,
            ManagedProcessPurpose::RuntimeHost,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "runtime-host:derived-command-test",
        )
        .unwrap();

        let bare_spec = template
            .derive_runtime_one_shot_command(
                OsStr::new("terminal-context-tool"),
                Vec::new(),
                request_cwd.clone(),
                BTreeMap::from([(
                    OsString::from("PATH"),
                    std::env::join_paths([&request_bin]).unwrap(),
                )]),
                "runtime-child:derived-bare-command-test",
            )
            .unwrap();
        assert_eq!(bare_spec.application(), Path::new("terminal-context-tool"));
        let mut bare_process = ManagedProcess::spawn(bare_spec).unwrap();
        let mut bare_stdout = bare_process.take_stdout().unwrap();
        let mut bare_output = Vec::new();
        tokio::io::AsyncReadExt::read_to_end(&mut bare_stdout, &mut bare_output)
            .await
            .unwrap();
        assert!(bare_process.wait().await.unwrap().success());
        assert_eq!(
            String::from_utf8(bare_output).unwrap(),
            format!(
                "request-path:{}",
                request_cwd.canonicalize().unwrap().display()
            )
        );
        bare_process.force_terminate_tree().unwrap();

        let relative_spec = template
            .derive_runtime_one_shot_command(
                OsStr::new("scripts/build"),
                Vec::new(),
                request_cwd,
                BTreeMap::new(),
                "runtime-child:derived-relative-command-test",
            )
            .unwrap();
        assert_eq!(
            relative_spec.application(),
            relative.canonicalize().unwrap()
        );
        let mut relative_process = ManagedProcess::spawn(relative_spec).unwrap();
        let mut relative_stdout = relative_process.take_stdout().unwrap();
        let mut relative_output = Vec::new();
        tokio::io::AsyncReadExt::read_to_end(&mut relative_stdout, &mut relative_output)
            .await
            .unwrap();
        assert!(relative_process.wait().await.unwrap().success());
        assert_eq!(relative_output, b"relative-cwd");
        relative_process.force_terminate_tree().unwrap();

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn runtime_entrypoints_have_no_direct_command_spawn() {
        for (name, source) in [
            (
                "runtime_probe_process",
                include_str!("runtime_probe_process.rs"),
            ),
            ("health", include_str!("health.rs")),
            ("acp", include_str!("acp.rs")),
            ("codex", include_str!("codex.rs")),
            ("claude", include_str!("claude.rs")),
            ("antigravity", include_str!("antigravity.rs")),
        ] {
            assert!(
                !source.contains(".spawn()"),
                "{name} bypassed ManagedProcess with a direct Command spawn"
            );
            assert!(
                !source.contains(".env_clear()"),
                "{name} used an environment mutation that cannot be captured by stable Command APIs"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_environment_overlay_is_case_insensitive() {
        let mut environment = BTreeMap::new();
        insert_environment(
            &mut environment,
            OsString::from("Path"),
            OsString::from("old"),
        );
        insert_environment(
            &mut environment,
            OsString::from("PATH"),
            OsString::from("current"),
        );
        assert_eq!(environment.len(), 1);
        assert_eq!(
            environment.get(&OsString::from("PATH")),
            Some(&OsString::from("current"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_derived_runtime_one_shot_uses_final_path_and_command_shim_identity() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-derived-command-shim-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let shim = directory.join("terminal-context-tool.cmd");
        std::fs::write(&shim, "@echo off\r\nexit /b 0\r\n").unwrap();

        let host = Command::new(std::env::current_exe().unwrap());
        let template = ManagedProcessLaunchSpec::capture(
            &host,
            ManagedProcessPurpose::RuntimeHost,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "runtime-host:derived-command-shim-test",
        )
        .unwrap();
        let spec = template
            .derive_runtime_one_shot_command(
                OsStr::new("terminal-context-tool"),
                Vec::new(),
                directory.clone(),
                BTreeMap::from([(
                    OsString::from("PATH"),
                    std::env::join_paths([&directory]).unwrap(),
                )]),
                "runtime-child:derived-command-shim-test",
            )
            .unwrap();

        assert!(matches!(
            spec.windows_entrypoint(),
            WindowsRuntimeEntrypoint::CommandShim { shim: captured, .. }
                if captured == &shim.canonicalize().unwrap()
        ));
        assert_eq!(
            environment_value(spec.environment(), std::ffi::OsStr::new("ComSpec")),
            Some(
                crate::windows_runtime_entrypoint::system_cmd_executable()
                    .unwrap()
                    .as_os_str()
            )
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn unix_backend_owns_stdio_pid_and_reap() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "printf managed"]);
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeProbe,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "probe:test",
        )
        .unwrap();
        assert_eq!(spec.application(), Path::new("/bin/sh"));
        assert_eq!(spec.purpose(), ManagedProcessPurpose::RuntimeProbe);
        assert_eq!(spec.ownership(), "probe:test");

        let mut process = ManagedProcess::spawn(spec).unwrap();
        assert!(process.id().is_some());
        let mut stdout = process.take_stdout().unwrap();
        let mut bytes = Vec::new();
        tokio::io::AsyncReadExt::read_to_end(&mut stdout, &mut bytes)
            .await
            .unwrap();
        assert!(process.wait().await.unwrap().success());
        process.force_terminate_tree().unwrap();
        assert_eq!(bytes, b"managed");
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn macos_runtime_sandbox_denies_user_automation_root_but_keeps_other_files_visible() {
        let root = std::env::temp_dir().join(format!(
            "rovai-managed-automation-deny-{}",
            uuid::Uuid::new_v4()
        ));
        let protected = root.join("automation-v1");
        let allowed = root.join("allowed.txt");
        std::fs::create_dir_all(&protected).unwrap();
        std::fs::write(protected.join("connection-v1.json"), b"credential").unwrap();
        std::fs::write(&allowed, b"allowed").unwrap();
        let protected = std::fs::canonicalize(protected).unwrap();
        let mut command = Command::new("/bin/sh");
        command
            .args([
                "-c",
                "if cat \"$PROTECTED\" >/dev/null 2>&1; then exit 41; fi; test \"$(cat \"$ALLOWED\")\" = allowed || exit 42",
            ])
            .env("PROTECTED", protected.join("connection-v1.json"))
            .env("ALLOWED", &allowed);
        let mut spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeProbe,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "probe:automation-denial",
        )
        .unwrap();
        spec.user_automation_denial_root = Some(protected);

        let mut process = ManagedProcess::spawn(spec).unwrap();
        let status = process.wait().await.unwrap();
        assert!(status.success(), "sandbox probe exited with {status}");
        process.force_terminate_tree().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_backend_creates_an_already_managed_process() {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command.arg("--list");
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeProbe,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "probe:test",
        )
        .unwrap();
        let mut process = ManagedProcess::spawn(spec).unwrap();
        assert!(process.id().is_some());
        let mut stdout = process.take_stdout().unwrap();
        let reader = tokio::spawn(async move {
            let mut output = Vec::new();
            tokio::io::AsyncReadExt::read_to_end(&mut stdout, &mut output)
                .await
                .unwrap();
            output
        });
        assert!(process.wait().await.unwrap().success());
        process.force_terminate_tree().unwrap();
        assert!(!reader.await.unwrap().is_empty());
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_bat_entrypoint_uses_system_cmd_and_preserves_batch_safe_argv() {
        let directory = std::env::temp_dir().join(format!(
            "rovai command shim %ROVAI_SHIM_PATH% ! & ^ {}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let script = directory.join("argv fixture.bat");
        let javascript = directory.join("argv.js");
        std::fs::write(
            &javascript,
            concat!(
                "var args = WScript.Arguments;\r\n",
                "for (var i = 0; i < args.length; i++) {\r\n",
                "  WScript.StdOut.WriteLine(i + '=' + encodeURIComponent(args(i)));\r\n",
                "}\r\n"
            ),
        )
        .unwrap();
        std::fs::write(
            &script,
            concat!(
                "@echo off\r\n",
                "\"%SystemRoot%\\System32\\cscript.exe\" //nologo \"%~dp0argv.js\" %*\r\n"
            ),
        )
        .unwrap();

        let arguments = [
            "",
            "two words",
            r"middle\slash",
            "amp&pipe|angle<>caret^",
            "bang!ROVAI_SHIM_PATH!",
            "Unicode雪",
        ];
        let mut command = Command::new(&script);
        command
            .args(arguments)
            .env("ROVAI_SHIM_PATH", "must-not-rewrite-script-path");
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeProbe,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "probe:command-shim-argv",
        )
        .unwrap();
        assert!(
            spec.application()
                .file_name()
                .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("cmd.exe"))
        );
        assert_eq!(
            environment_value(spec.environment(), std::ffi::OsStr::new("ComSpec")),
            Some(
                crate::windows_runtime_entrypoint::system_cmd_executable()
                    .unwrap()
                    .as_os_str()
            )
        );
        let mut process = ManagedProcess::spawn(spec).unwrap();
        let mut stdout = process.take_stdout().unwrap();
        let mut stderr = process.take_stderr().unwrap();
        let stdout_reader = tokio::spawn(async move {
            let mut output = Vec::new();
            tokio::io::AsyncReadExt::read_to_end(&mut stdout, &mut output)
                .await
                .unwrap();
            output
        });
        let stderr_reader = tokio::spawn(async move {
            let mut output = Vec::new();
            tokio::io::AsyncReadExt::read_to_end(&mut stderr, &mut output)
                .await
                .unwrap();
            output
        });
        let status = process.wait().await.unwrap();
        process.force_terminate_tree().unwrap();
        let stdout = String::from_utf8_lossy(&stdout_reader.await.unwrap()).replace("\r\n", "\n");
        let stderr = String::from_utf8_lossy(&stderr_reader.await.unwrap()).into_owned();
        assert!(
            status.success(),
            "batch failed: {stderr}; stdout={stdout:?}"
        );
        assert_eq!(
            stdout,
            concat!(
                "0=\n",
                "1=two%20words\n",
                "2=middle%5Cslash\n",
                "3=amp%26pipe%7Cangle%3C%3Ecaret%5E\n",
                "4=bang!ROVAI_SHIM_PATH!\n",
                "5=Unicode%E9%9B%AA\n"
            )
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_command_shim_rejects_quote_and_percent_before_process_creation() {
        let directory = std::env::temp_dir().join(format!(
            "rovai command shim rejected argv {}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let script = directory.join("runtime.cmd");
        std::fs::write(&script, "@echo off\r\nexit /b 0\r\n").unwrap();
        for argument in ["say\"quoted", "%ROVAI_ARGUMENT%", "trailing\\"] {
            let mut command = Command::new(&script);
            command.arg(argument);
            let spec = ManagedProcessLaunchSpec::capture(
                &command,
                ManagedProcessPurpose::RuntimeProbe,
                ManagedStdinPolicy::Null,
                ManagedWindowsArgvDialect::MicrosoftCrt,
                "probe:command-shim-rejected-argv",
            )
            .unwrap();
            let error = ManagedProcess::spawn(spec)
                .err()
                .expect("unrepresentable batch argv must fail before CreateProcessW");
            assert!(
                error
                    .to_string()
                    .contains("unrepresentable quote, percent, or trailing backslash")
            );
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_command_shim_arguments_cannot_inject_cmd_metacharacters() {
        let directory = std::env::temp_dir().join(format!(
            "rovai command shim injection {}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let script = directory.join("runtime fixture.cmd");
        let sentinel = directory.join("injected.txt");
        std::fs::write(&script, "@echo off\r\nexit /b 0\r\n").unwrap();
        let injected_command = "echo injected>injected.txt";
        let arguments = [
            format!("& {injected_command}"),
            format!("| {injected_command}"),
            "> injected.txt".to_string(),
            "< injected.txt".to_string(),
            format!("^& {injected_command}"),
            "!ROVAI_CMD_INJECTION!".to_string(),
        ];
        let mut command = Command::new(&script);
        command
            .args(arguments)
            .current_dir(&directory)
            .env("ROVAI_CMD_INJECTION", injected_command);
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeProbe,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "probe:command-shim-injection",
        )
        .unwrap();
        let mut process = ManagedProcess::spawn(spec).unwrap();
        let status = process.wait().await.unwrap();
        process.force_terminate_tree().unwrap();
        assert!(status.success());
        assert!(
            !sentinel.exists(),
            "command-shim argv escaped into cmd syntax"
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_bat_entrypoint_job_owns_the_complete_child_tree() {
        let directory =
            std::env::temp_dir().join(format!("rovai command shim tree {}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let handshake = directory.join("grandchild.pid");
        let script = directory.join("runtime tree.bat");
        std::fs::write(
            &script,
            "@echo off\r\n\"%ROVAI_TEST_EXE%\" --exact managed_process::tests::windows_job_child_helper --ignored --nocapture\r\n",
        )
        .unwrap();
        let mut command = Command::new(&script);
        command
            .env("ROVAI_TEST_EXE", std::env::current_exe().unwrap())
            .env(WINDOWS_HELPER_MODE, "child")
            .env(WINDOWS_HELPER_FILE, &handshake);
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeProbe,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "probe:command-shim-tree",
        )
        .unwrap();
        let mut process = ManagedProcess::spawn(spec).unwrap();
        let leader_status = tokio::time::timeout(Duration::from_secs(10), process.wait())
            .await
            .expect("command shim leader did not exit")
            .expect("command shim leader wait failed");
        assert!(leader_status.success());
        let grandchild_pid = std::fs::read_to_string(&handshake)
            .expect("grandchild handshake was not written")
            .trim()
            .parse::<u32>()
            .expect("grandchild handshake PID was invalid");
        assert!(windows::process_is_running_for_test(grandchild_pid).unwrap());

        process.force_terminate_tree().unwrap();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while windows::process_is_running_for_test(grandchild_pid).unwrap()
            && tokio::time::Instant::now() < deadline
        {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(!windows::process_is_running_for_test(grandchild_pid).unwrap());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_command_shim_change_invalidates_captured_launch() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-command-shim-change-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let script = directory.join("runtime.cmd");
        std::fs::write(&script, "@echo first\r\n").unwrap();
        let command = Command::new(&script);
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeProbe,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "probe:command-shim-change",
        )
        .unwrap();
        std::fs::write(&script, "@echo other\r\n").unwrap();
        let error = ManagedProcess::spawn(spec)
            .err()
            .expect("changed shim must fail before launch");
        assert!(
            error
                .to_string()
                .contains("command shim identity changed before launch")
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_job_contains_an_immediate_grandchild_after_leader_exit() {
        let handshake = std::env::temp_dir().join(format!(
            "rovai-managed-process-grandchild-{}.pid",
            uuid::Uuid::new_v4()
        ));
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "managed_process::tests::windows_job_child_helper",
                "--ignored",
                "--nocapture",
            ])
            .env(WINDOWS_HELPER_MODE, "child")
            .env(WINDOWS_HELPER_FILE, &handshake);
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeProbe,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "probe:immediate-grandchild-test",
        )
        .unwrap();
        let mut process = ManagedProcess::spawn(spec).unwrap();
        let mut stdout = process.take_stdout().unwrap();
        let mut stderr = process.take_stderr().unwrap();
        let stdout_reader = tokio::spawn(async move {
            let mut output = Vec::new();
            let _ = tokio::io::AsyncReadExt::read_to_end(&mut stdout, &mut output).await;
            output
        });
        let stderr_reader = tokio::spawn(async move {
            let mut output = Vec::new();
            let _ = tokio::io::AsyncReadExt::read_to_end(&mut stderr, &mut output).await;
            output
        });
        let leader_status = tokio::time::timeout(Duration::from_secs(10), process.wait())
            .await
            .expect("managed leader did not exit")
            .expect("managed leader wait failed");
        assert!(leader_status.success());
        let grandchild_pid = std::fs::read_to_string(&handshake)
            .expect("grandchild handshake was not written")
            .trim()
            .parse::<u32>()
            .expect("grandchild handshake PID was invalid");
        assert!(windows::process_is_running_for_test(grandchild_pid).unwrap());

        process.force_terminate_tree().unwrap();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while windows::process_is_running_for_test(grandchild_pid).unwrap()
            && tokio::time::Instant::now() < deadline
        {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(!windows::process_is_running_for_test(grandchild_pid).unwrap());
        tokio::time::timeout(Duration::from_secs(2), stdout_reader)
            .await
            .expect("stdout handle remained inherited after Job termination")
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), stderr_reader)
            .await
            .expect("stderr handle remained inherited after Job termination")
            .unwrap();
        let _ = std::fs::remove_file(handshake);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_handle_list_excludes_unrelated_inheritable_handle() {
        let sentinel_path = std::env::temp_dir().join(format!(
            "rovai-managed-process-handle-{}.sentinel",
            uuid::Uuid::new_v4()
        ));
        let sentinel = std::fs::OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&sentinel_path)
            .unwrap();
        let raw_handle = windows::raw_file_handle_for_test(&sentinel);
        let expected_identity = windows::file_identity_for_raw_handle_for_test(raw_handle).unwrap();
        windows::set_file_inheritable_for_test(&sentinel, true).unwrap();

        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "managed_process::tests::windows_handle_probe_helper",
                "--ignored",
                "--nocapture",
            ])
            .env(WINDOWS_HELPER_MODE, "handle-probe")
            .env(WINDOWS_HELPER_HANDLE, raw_handle.to_string())
            .env(WINDOWS_HELPER_IDENTITY, &expected_identity);
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeProbe,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "probe:handle-list-test",
        )
        .unwrap();
        let spawned = ManagedProcess::spawn(spec);
        windows::set_file_inheritable_for_test(&sentinel, false).unwrap();
        let mut process = spawned.unwrap();
        let mut stdout = process.take_stdout().unwrap();
        let mut stderr = process.take_stderr().unwrap();
        let stdout_reader = tokio::spawn(async move {
            let mut output = Vec::new();
            let _ = tokio::io::AsyncReadExt::read_to_end(&mut stdout, &mut output).await;
            output
        });
        let stderr_reader = tokio::spawn(async move {
            let mut output = Vec::new();
            let _ = tokio::io::AsyncReadExt::read_to_end(&mut stderr, &mut output).await;
            output
        });
        let status = tokio::time::timeout(Duration::from_secs(10), process.wait())
            .await
            .expect("handle probe did not exit")
            .expect("handle probe wait failed");
        process.force_terminate_tree().unwrap();
        let stdout = stdout_reader.await.unwrap();
        let stderr = stderr_reader.await.unwrap();
        assert!(
            status.success(),
            "handle probe failed: stdout={} stderr={}",
            String::from_utf8_lossy(&stdout),
            String::from_utf8_lossy(&stderr)
        );
        drop(sentinel);
        let _ = std::fs::remove_file(sentinel_path);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_job_closes_when_its_core_owner_is_force_killed() {
        let handshake = std::env::temp_dir().join(format!(
            "rovai-managed-process-owner-kill-{}.pid",
            uuid::Uuid::new_v4()
        ));
        let mut owner = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "managed_process::tests::windows_job_owner_helper",
                "--ignored",
                "--nocapture",
            ])
            .env(WINDOWS_HELPER_MODE, "job-owner")
            .env(WINDOWS_HELPER_FILE, &handshake)
            .spawn()
            .expect("failed to spawn Job owner helper");
        let handshake_deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while !handshake.is_file() && tokio::time::Instant::now() < handshake_deadline {
            if owner.try_wait().unwrap().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let runtime_pid = std::fs::read_to_string(&handshake)
            .expect("owned Runtime handshake was not written")
            .trim()
            .parse::<u32>()
            .expect("owned Runtime handshake PID was invalid");
        assert!(windows::process_is_running_for_test(runtime_pid).unwrap());

        owner.kill().expect("failed to force-kill Job owner");
        owner.wait().expect("failed to reap Job owner");
        let termination_deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while windows::process_is_running_for_test(runtime_pid).unwrap()
            && tokio::time::Instant::now() < termination_deadline
        {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(!windows::process_is_running_for_test(runtime_pid).unwrap());
        let _ = std::fs::remove_file(handshake);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_main_force_kill_closes_core_stdin_and_runtime_job() {
        let handshake = std::env::temp_dir().join(format!(
            "rovai-managed-process-main-kill-{}.pid",
            uuid::Uuid::new_v4()
        ));
        let mut main_owner = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "managed_process::tests::windows_main_owner_helper",
                "--ignored",
                "--nocapture",
            ])
            .env(WINDOWS_HELPER_MODE, "main-owner")
            .env(WINDOWS_HELPER_FILE, &handshake)
            .spawn()
            .expect("failed to spawn Main owner helper");
        let handshake_deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while !handshake.is_file() && tokio::time::Instant::now() < handshake_deadline {
            if main_owner.try_wait().unwrap().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let runtime_pid = std::fs::read_to_string(&handshake)
            .expect("Main-owned Core did not start its Runtime")
            .trim()
            .parse::<u32>()
            .expect("Main-owned Runtime handshake PID was invalid");
        assert!(windows::process_is_running_for_test(runtime_pid).unwrap());

        main_owner.kill().expect("failed to force-kill Main owner");
        main_owner.wait().expect("failed to reap Main owner");
        let termination_deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while windows::process_is_running_for_test(runtime_pid).unwrap()
            && tokio::time::Instant::now() < termination_deadline
        {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(!windows::process_is_running_for_test(runtime_pid).unwrap());
        let _ = std::fs::remove_file(handshake);
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "managed process subprocess helper"]
    fn windows_job_child_helper() {
        if std::env::var(WINDOWS_HELPER_MODE).as_deref() != Ok("child") {
            return;
        }
        let handshake = std::env::var_os(WINDOWS_HELPER_FILE).expect("missing helper file");
        let mut grandchild = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "managed_process::tests::windows_job_grandchild_helper",
                "--ignored",
                "--nocapture",
            ])
            .env(WINDOWS_HELPER_MODE, "grandchild")
            .env(WINDOWS_HELPER_FILE, &handshake)
            .spawn()
            .expect("failed to create immediate grandchild");
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !std::path::Path::new(&handshake).is_file() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(std::path::Path::new(&handshake).is_file());
        assert!(grandchild.try_wait().unwrap().is_none());
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "managed process subprocess helper"]
    fn windows_job_grandchild_helper() {
        if std::env::var(WINDOWS_HELPER_MODE).as_deref() != Ok("grandchild") {
            return;
        }
        let handshake = std::env::var_os(WINDOWS_HELPER_FILE).expect("missing helper file");
        std::fs::write(handshake, std::process::id().to_string())
            .expect("failed to write grandchild handshake");
        std::thread::sleep(Duration::from_secs(30));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "managed process subprocess helper"]
    fn windows_handle_probe_helper() {
        if std::env::var(WINDOWS_HELPER_MODE).as_deref() != Ok("handle-probe") {
            return;
        }
        let raw_handle = std::env::var(WINDOWS_HELPER_HANDLE)
            .expect("missing helper handle")
            .parse::<usize>()
            .expect("invalid helper handle");
        let expected_identity =
            std::env::var(WINDOWS_HELPER_IDENTITY).expect("missing helper identity");
        let observed = windows::file_identity_for_raw_handle_for_test(raw_handle).ok();
        assert_ne!(observed.as_deref(), Some(expected_identity.as_str()));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "managed process subprocess helper"]
    fn windows_job_owner_helper() {
        if std::env::var(WINDOWS_HELPER_MODE).as_deref() != Ok("job-owner") {
            return;
        }
        let handshake = std::env::var_os(WINDOWS_HELPER_FILE).expect("missing helper file");
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "managed_process::tests::windows_owned_runtime_helper",
                "--ignored",
                "--nocapture",
            ])
            .env(WINDOWS_HELPER_MODE, "owned-runtime")
            .env(WINDOWS_HELPER_FILE, &handshake);
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeOneShot,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "runtime-owner:force-kill-test",
        )
        .unwrap();
        let _runtime = ManagedProcess::spawn(spec).expect("failed to spawn owned Runtime");
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !std::path::Path::new(&handshake).is_file() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(std::path::Path::new(&handshake).is_file());
        std::thread::sleep(Duration::from_secs(30));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "managed process subprocess helper"]
    fn windows_owned_runtime_helper() {
        if std::env::var(WINDOWS_HELPER_MODE).as_deref() != Ok("owned-runtime") {
            return;
        }
        let handshake = std::env::var_os(WINDOWS_HELPER_FILE).expect("missing helper file");
        std::fs::write(handshake, std::process::id().to_string())
            .expect("failed to write owned Runtime handshake");
        std::thread::sleep(Duration::from_secs(30));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "managed process subprocess helper"]
    fn windows_main_owner_helper() {
        if std::env::var(WINDOWS_HELPER_MODE).as_deref() != Ok("main-owner") {
            return;
        }
        let handshake = std::env::var_os(WINDOWS_HELPER_FILE).expect("missing helper file");
        let mut core = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "managed_process::tests::windows_core_eof_helper",
                "--ignored",
                "--nocapture",
            ])
            .env(WINDOWS_HELPER_MODE, "core-eof")
            .env(WINDOWS_HELPER_FILE, &handshake)
            .stdin(std::process::Stdio::piped())
            .spawn()
            .expect("failed to spawn Core EOF helper");
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !std::path::Path::new(&handshake).is_file() && std::time::Instant::now() < deadline {
            assert!(core.try_wait().unwrap().is_none());
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(std::path::Path::new(&handshake).is_file());
        std::thread::sleep(Duration::from_secs(30));
        let _ = core.kill();
        let _ = core.wait();
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "managed process subprocess helper"]
    fn windows_core_eof_helper() {
        if std::env::var(WINDOWS_HELPER_MODE).as_deref() != Ok("core-eof") {
            return;
        }
        let handshake = std::env::var_os(WINDOWS_HELPER_FILE).expect("missing helper file");
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "managed_process::tests::windows_owned_runtime_helper",
                "--ignored",
                "--nocapture",
            ])
            .env(WINDOWS_HELPER_MODE, "owned-runtime")
            .env(WINDOWS_HELPER_FILE, &handshake);
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeOneShot,
            ManagedStdinPolicy::Null,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            "runtime-owner:main-eof-test",
        )
        .unwrap();
        let _runtime = ManagedProcess::spawn(spec).expect("failed to spawn Main-owned Runtime");
        let watchdog = std::thread::spawn(|| {
            std::thread::sleep(Duration::from_secs(20));
            std::process::exit(91);
        });
        let mut input = Vec::new();
        std::io::Read::read_to_end(&mut std::io::stdin(), &mut input)
            .expect("failed to observe Main stdin EOF");
        drop(watchdog);
    }
}
