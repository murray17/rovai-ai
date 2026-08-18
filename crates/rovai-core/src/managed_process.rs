use std::{
    collections::BTreeMap,
    env,
    ffi::OsString,
    io,
    path::{Path, PathBuf},
    process::ExitStatus,
};

#[cfg(unix)]
use std::{os::unix::process::CommandExt, process::Stdio};

use anyhow::{Context, Result, bail};
use tokio::process::Command;

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
    ownership: String,
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
        let application = PathBuf::from(command.get_program());
        if !application.is_absolute() || !application.is_file() {
            bail!(
                "managed_process.invalid_application: expected an absolute file, got {}",
                application.display()
            );
        }
        #[cfg(windows)]
        if !application
            .extension()
            .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("exe"))
        {
            bail!(
                "managed_process.invalid_application: expected a native Windows EXE, got {}",
                application.display()
            );
        }
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
            let mut command = command_from_spec(&spec);
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
fn command_from_spec(spec: &ManagedProcessLaunchSpec) -> Command {
    let mut command = Command::new(&spec.application);
    command
        .args(&spec.arguments)
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
    command
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
}
