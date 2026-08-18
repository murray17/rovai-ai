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
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};

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
    ownership: String,
}

impl ManagedProcessLaunchSpec {
    pub fn capture(
        command: &Command,
        purpose: ManagedProcessPurpose,
        stdin_policy: ManagedStdinPolicy,
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

        let mut environment = env::vars_os().collect::<BTreeMap<_, _>>();
        for (key, value) in command.get_envs() {
            match value {
                Some(value) => {
                    environment.insert(key.to_os_string(), value.to_os_string());
                }
                None => {
                    environment.remove(key);
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
}

/// Cross-platform ownership boundary for a Runtime process tree. Platform
/// handles remain private; callers can only use stdio, PID, wait, and bounded
/// tree termination.
pub struct ManagedProcess {
    child: Child,
    #[cfg(unix)]
    process_group_id: Option<i32>,
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
            let _ = spec;
            bail!(
                "managed_process.atomic_assignment_failed: Windows Job-list backend is not available"
            );
        }

        #[cfg(not(any(unix, windows)))]
        {
            let _ = spec;
            bail!("managed_process.spawn_failed: unsupported host platform");
        }
    }

    pub fn id(&self) -> Option<u32> {
        self.child.id()
    }

    pub fn take_stdin(&mut self) -> Option<ChildStdin> {
        self.child.stdin.take()
    }

    pub fn take_stdout(&mut self) -> Option<ChildStdout> {
        self.child.stdout.take()
    }

    pub fn take_stderr(&mut self) -> Option<ChildStderr> {
        self.child.stderr.take()
    }

    pub async fn wait(&mut self) -> io::Result<ExitStatus> {
        self.child.wait().await
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
        self.child.start_kill()
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
        match self.child.start_kill() {
            Ok(()) => {
                self.tree_termination_requested = true;
                Ok(())
            }
            Err(error) if error.kind() == io::ErrorKind::InvalidInput => {
                self.tree_termination_requested = true;
                Ok(())
            }
            Err(error) => Err(error),
        }
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

    #[test]
    fn capture_requires_absolute_application_and_nonempty_owner() {
        let relative = Command::new("runtime");
        assert!(
            ManagedProcessLaunchSpec::capture(
                &relative,
                ManagedProcessPurpose::RuntimeProbe,
                ManagedStdinPolicy::Null,
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
        }
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
    #[test]
    fn windows_backend_fails_before_unmanaged_spawn() {
        let command = Command::new(std::env::current_exe().unwrap());
        let spec = ManagedProcessLaunchSpec::capture(
            &command,
            ManagedProcessPurpose::RuntimeProbe,
            ManagedStdinPolicy::Null,
            "probe:test",
        )
        .unwrap();
        let error = ManagedProcess::spawn(spec).err().expect("spawn must fail");
        assert!(
            error
                .to_string()
                .contains("managed_process.atomic_assignment_failed")
        );
    }
}
