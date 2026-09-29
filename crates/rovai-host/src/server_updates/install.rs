//! Verified package staging and the post-settlement program switch. Never opens business data.
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Prepared {
    version: String,
    staging: PathBuf,
    incoming: PathBuf,
    root: PathBuf,
    expected_info: String,
    managed_prefix: Option<PathBuf>,
    revision: String,
    arguments: Vec<String>,
    data: PathBuf,
}
pub(super) struct Handoff {
    prepared: Prepared,
    #[cfg(windows)]
    pipe: std::process::ChildStdin,
}

/// Releases the advisory lock explicitly before closing the file. On Unix a
/// forked child briefly inherits open file descriptions before exec; relying
/// on close alone can therefore retain a lock after the owning scope returns.
struct ScopedFileLock(fs::File);

impl ScopedFileLock {
    fn acquire(file: fs::File) -> std::io::Result<Self> {
        file.try_lock()?;
        Ok(Self(file))
    }
}

impl Drop for ScopedFileLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

pub(super) fn prepare(
    root: &Path,
    data: &Path,
    staging: &Path,
    version: &str,
    target: &str,
    revision: &str,
    arguments: Vec<String>,
) -> Result<Prepared> {
    let expected_info = fs::read_to_string(root.join("package-info"))
        .context("Updates require a complete installed Server package")?;
    ensure!(
        expected_info
            .lines()
            .any(|l| l == format!("target={target}")),
        "installed target mismatch"
    );
    ensure!(
        expected_info
            .lines()
            .any(|l| l == format!("version={}", env!("CARGO_PKG_VERSION"))),
        "installed version mismatch"
    );
    ensure!(
        !fs::canonicalize(data)?.starts_with(fs::canonicalize(root)?),
        "Server data must be outside its program directory before updating"
    );
    let prefix = staging.join("verified");
    let script = staging.join(if cfg!(windows) {
        "install-server.ps1"
    } else {
        "install-server.sh"
    });
    fs::write(
        &script,
        if cfg!(windows) {
            include_str!("../../../../scripts/install-server.ps1")
        } else {
            include_str!("../../../../scripts/install-server.sh")
        },
    )?;
    let mut command = if cfg!(windows) {
        let mut c = Command::new("powershell.exe");
        c.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script)
        .arg("-Version")
        .arg(version)
        .arg("-FromDirectory")
        .arg(staging)
        .arg("-InstallDirectory")
        .arg(&prefix)
        .arg("-NoModifyPath");
        c
    } else {
        let mut c = Command::new("/bin/sh");
        c.arg(&script)
            .arg("--version")
            .arg(version)
            .arg("--from-dir")
            .arg(staging)
            .arg("--prefix")
            .arg(&prefix)
            .arg("--bin-dir")
            .arg(staging.join("bin"))
            .arg("--no-modify-path");
        c
    };
    let output = command.current_dir(staging).stdin(Stdio::null()).output()?;
    ensure!(
        output.status.success(),
        "Server package validation failed: {}",
        String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(1000)
            .collect::<String>()
    );
    let payload = fs::canonicalize(prefix.join("current"))?;
    for name in [
        program("rovai-server"),
        program("rovai-host"),
        program("rovai"),
        "web-ui/index.html".into(),
        "skills/cli-operations/SKILL.md".into(),
    ] {
        ensure!(payload.join(name).is_file(), "Server package is incomplete");
    }
    let managed_prefix = if cfg!(unix)
        && root
            .parent()
            .and_then(Path::file_name)
            .is_some_and(|v| v == "revisions")
    {
        let parent = root
            .parent()
            .and_then(Path::parent)
            .context("managed installation root")?;
        ensure!(
            fs::read_to_string(parent.join("INSTALLER-V1"))?.trim() == "rovai-server",
            "unknown installation owner"
        );
        Some(parent.to_owned())
    } else {
        None
    };
    let parent = managed_prefix
        .as_deref()
        .unwrap_or(root.parent().context("program parent")?);
    let incoming = parent.join(format!(".rovai-update-{}", rovai_web::new_token()?));
    let result = copy_tree(&payload, &incoming);
    if result.is_err() {
        let _ = fs::remove_dir_all(&incoming);
    }
    result?;
    let prepared = Prepared {
        version: version.into(),
        staging: staging.into(),
        incoming,
        root: root.into(),
        expected_info,
        managed_prefix,
        revision: revision.into(),
        arguments,
        data: data.into(),
    };
    fs::write(staging.join("install.json"), serde_json::to_vec(&prepared)?)?;
    Ok(prepared)
}

impl Prepared {
    pub(super) fn version(&self) -> &str {
        &self.version
    }
    pub(super) fn discard(self) {
        let _ = fs::remove_dir_all(self.incoming);
        let _ = fs::remove_dir_all(self.staging);
    }
    fn unchanged(&self) -> Result<()> {
        ensure!(
            fs::read_to_string(self.root.join("package-info"))? == self.expected_info,
            "Server installation changed; download again"
        );
        if let Some(prefix) = &self.managed_prefix {
            ensure!(
                fs::canonicalize(prefix.join("current"))? == self.root,
                "Server installation changed; download again"
            );
        }
        ensure!(
            self.incoming.join(program("rovai-server")).is_file(),
            "prepared update missing"
        );
        Ok(())
    }
    pub(super) fn handoff(&self) -> Result<Handoff> {
        self.unchanged()?;
        // A helper is needed only on Windows, which locks the running executable.
        #[cfg(windows)]
        let pipe = {
            use std::os::windows::process::CommandExt;
            let executable = self.staging.join("rovai-update-helper.exe");
            let _ = fs::remove_file(self.staging.join("helper-ready"));
            fs::copy(std::env::current_exe()?, &executable)?;
            let mut child = Command::new(executable)
                .arg("update-helper")
                .arg(self.staging.join("install.json"))
                .current_dir(&self.staging)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(0x08000000)
                .spawn()?;
            let ready = self.staging.join("helper-ready");
            let mut started = false;
            for _ in 0..100 {
                if ready.is_file() {
                    started = true;
                    break;
                }
                if child.try_wait()?.is_some() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            if !started {
                let _ = child.kill();
                let _ = child.wait();
                anyhow::bail!("update helper did not become ready");
            }
            child.stdin.take().context("update helper pipe")?
        };
        Ok(Handoff {
            prepared: self.clone(),
            #[cfg(windows)]
            pipe,
        })
    }
    fn apply(&self) -> Result<PathBuf> {
        self.unchanged()?;
        let _program_lease =
            ScopedFileLock::acquire(fs::File::open(self.root.join(program("rovai-server")))?)
                .context("another Server is using this program installation")?;
        let parent = self
            .managed_prefix
            .as_deref()
            .unwrap_or(self.root.parent().context("program parent")?);
        let _update_lock = ScopedFileLock::acquire(
            fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(parent.join(".rovai-update.lock"))?,
        )
        .context("another Server update is in progress")?;
        #[cfg(windows)]
        let _installer_lease = {
            use std::os::windows::fs::OpenOptionsExt;
            if self.root.file_name().is_some_and(|name| name == "current")
                && parent.join("INSTALLER-V1").is_file()
            {
                ensure!(
                    fs::read_to_string(parent.join("INSTALLER-V1"))?.trim() == "rovai-server",
                    "unknown installation owner"
                );
                Some(
                    fs::OpenOptions::new()
                        .read(true)
                        .write(true)
                        .create(true)
                        .truncate(false)
                        .share_mode(0)
                        .open(parent.join(".install-lock"))
                        .context("native installer is in progress")?,
                )
            } else {
                None
            }
        };
        self.unchanged()?;
        if let Some(prefix) = &self.managed_prefix {
            // Cooperate with the existing Unix installer's lock and revision layout.
            let installer_lock = prefix.join(".install-lock");
            fs::create_dir(&installer_lock).context("native installer is in progress")?;
            let result = (|| {
                let revision = prefix.join("revisions").join(&self.revision);
                ensure!(
                    !revision.exists(),
                    "revision already present; use the native installer to select it"
                );
                fs::rename(&self.incoming, &revision)?;
                #[cfg(unix)]
                {
                    let next = installer_lock.join("current");
                    std::os::unix::fs::symlink(Path::new("revisions").join(&self.revision), &next)?;
                    fs::rename(next, prefix.join("current"))?;
                }
                Ok(prefix.join("current").join(program("rovai-server")))
            })();
            let _ = fs::remove_dir_all(installer_lock);
            return result;
        }
        // Portable packages and the Windows installer both have a directory entry.
        // Preserve the old program; rollback here is only a failed file switch, never data/schema rollback.
        // Windows cannot rename a directory containing our open executable handle.
        // The shared lease preflight above rejects other instances; loaded images
        // still prevent the directory move if an instance starts during this switch.
        #[cfg(windows)]
        drop(_program_lease);
        let backup = parent.join(format!(".rovai-previous-{}", rovai_web::new_token()?));
        switch_directory(&self.root, &self.incoming, &backup)?;
        Ok(self.root.join(program("rovai-server")))
    }
    fn launch(&self, executable: PathBuf) -> Result<()> {
        let mut command = Command::new(executable);
        command
            .args(&self.arguments)
            .current_dir(self.root.parent().context("program parent")?);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            Err(command.exec().into())
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(0x08000000)
                .spawn()?;
            Ok(())
        }
    }
    fn apply_and_launch(&self) -> Result<()> {
        std::env::set_current_dir(self.root.parent().context("program parent")?)?;
        let result = self.apply();
        match result {
            Ok(executable) => self.launch(executable),
            Err(error) => {
                fs::write(
                    self.data.join("updates/last-failure.txt"),
                    format!("Program update was not applied: {error:#}"),
                )?;
                // A failed preflight/switch has not opened the data with new code.
                self.launch(self.root.join(program("rovai-server")))
            }
        }
    }
}
impl Handoff {
    pub(super) fn finish(self, settled: bool) -> Result<()> {
        if !settled {
            fs::write(
                self.prepared.data.join("updates/last-failure.txt"),
                "Update aborted: durable shutdown was not confirmed.",
            )?;
            return Ok(());
        }
        #[cfg(windows)]
        {
            {
                use std::io::Write;
                let mut pipe = self.pipe;
                pipe.write_all(b"apply\n")?;
            };
            Ok(())
        }
        #[cfg(unix)]
        {
            self.prepared.apply_and_launch()
        }
    }
}

pub(super) fn helper(path: PathBuf) -> Result<()> {
    // Only the original process owns the inherited pipe. EOF without a completed
    // settlement marker aborts; a crash or failed shutdown cannot install a package.
    let prepared: Prepared = serde_json::from_slice(&fs::read(path)?)?;
    prepared.unchanged()?;
    fs::write(prepared.staging.join("helper-ready"), "ready")?;
    let mut signal = String::new();
    std::io::stdin().take(16).read_to_string(&mut signal)?;
    ensure!(
        signal == "apply\n",
        "update was not armed after durable shutdown"
    );
    #[cfg(windows)]
    {
        // The parent has closed the pipe, but may still be releasing its executable.
        for _ in 0..100 {
            if fs::OpenOptions::new()
                .write(true)
                .open(prepared.root.join(program("rovai-server")))
                .is_ok()
            {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    prepared.apply_and_launch()
}
fn program(name: &str) -> String {
    format!("{name}{}", if cfg!(windows) { ".exe" } else { "" })
}
fn switch_directory(root: &Path, incoming: &Path, backup: &Path) -> Result<()> {
    fs::rename(root, backup).context("move current Server program to backup")?;
    if let Err(error) = fs::rename(incoming, root) {
        fs::rename(backup, root).context("restore program after failed switch")?;
        return Err(error).context("activate prepared Server program");
    }
    Ok(())
}
fn copy_tree(source: &Path, target: &Path) -> Result<()> {
    fs::create_dir(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        ensure!(
            kind.is_file() || kind.is_dir(),
            "update contains a link or special file"
        );
        if kind.is_dir() {
            copy_tree(&entry.path(), &target.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), target.join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    // Owns the program transaction and preservation of unrelated data; installer
    // archive validation is already covered by server-install and the update pipeline.
    #[test]
    fn directory_switch_restores_old_program_on_failure_and_retains_it_on_success() {
        let fixture = std::env::temp_dir().join(format!(
            "rovai-update-switch-{}",
            rovai_web::new_token().unwrap()
        ));
        let root = fixture.join("program");
        let incoming = fixture.join("incoming");
        let backup = fixture.join("backup");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("version"), "old").unwrap();
        fs::write(fixture.join("data"), "business data").unwrap();
        assert!(switch_directory(&root, &incoming, &backup).is_err());
        assert_eq!(fs::read_to_string(root.join("version")).unwrap(), "old");
        assert!(!backup.exists());
        fs::create_dir(&incoming).unwrap();
        fs::write(incoming.join("version"), "new").unwrap();
        switch_directory(&root, &incoming, &backup).unwrap();
        assert_eq!(fs::read_to_string(root.join("version")).unwrap(), "new");
        assert_eq!(fs::read_to_string(backup.join("version")).unwrap(), "old");
        assert_eq!(
            fs::read_to_string(fixture.join("data")).unwrap(),
            "business data"
        );
        #[cfg(unix)]
        {
            // A Runtime process can fork while the update preflight is holding
            // this lease. Its inherited descriptor must not extend the lock.
            let lease_path = fixture.join("inherited-lease");
            fs::write(&lease_path, "lease").unwrap();
            let lease_file = fs::File::open(&lease_path).unwrap();
            let inherited = lease_file.try_clone().unwrap();
            drop(ScopedFileLock::acquire(lease_file).unwrap());
            drop(ScopedFileLock::acquire(fs::File::open(&lease_path).unwrap()).unwrap());
            drop(inherited);

            let prefix = fixture.join("managed");
            let old = prefix.join("revisions/old");
            let candidate = prefix.join("incoming");
            fs::create_dir_all(&old).unwrap();
            fs::create_dir(&candidate).unwrap();
            fs::write(old.join("package-info"), "old").unwrap();
            fs::write(old.join("rovai-server"), "old").unwrap();
            fs::write(candidate.join("package-info"), "new").unwrap();
            fs::write(candidate.join("rovai-server"), "new").unwrap();
            std::os::unix::fs::symlink("revisions/old", prefix.join("current")).unwrap();
            let prepared = Prepared {
                version: "999.0.0".into(),
                staging: fixture.clone(),
                incoming: candidate,
                root: fs::canonicalize(&old).unwrap(),
                expected_info: "old".into(),
                managed_prefix: Some(prefix.clone()),
                revision: "new".into(),
                arguments: vec![],
                data: fixture.clone(),
            };
            fs::create_dir(prefix.join(".install-lock")).unwrap();
            assert!(
                prepared.apply().is_err(),
                "native installer owns the switch"
            );
            assert_eq!(
                fs::canonicalize(prefix.join("current")).unwrap(),
                prepared.root
            );
            fs::remove_dir(prefix.join(".install-lock")).unwrap();
            assert_eq!(
                prepared.apply().unwrap(),
                prefix.join("current/rovai-server")
            );
            assert_eq!(
                fs::read_to_string(prefix.join("current/package-info")).unwrap(),
                "new"
            );
            assert_eq!(fs::read_to_string(old.join("package-info")).unwrap(), "old");
            assert!(
                prepared.apply().is_err(),
                "a changed active revision cannot be installed again"
            );
        }
        fs::remove_dir_all(fixture).unwrap();
    }

    // This process seam cannot be proven by a directory swap: EOF must abort,
    // and only an armed handoff may execute the new program with retained arguments.
    // The next "Server" is this test executable, so no Core/database is started.
    #[test]
    fn handoff_requires_settlement_then_runs_the_new_program_with_original_arguments() {
        use std::io::Write;
        const TEST: &str = "server_updates::install::tests::handoff_requires_settlement_then_runs_the_new_program_with_original_arguments";
        if let Some(path) = std::env::var_os("ROVAI_TEST_UPDATE_PLAN") {
            let path = PathBuf::from(path);
            let plan: Prepared = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            if fs::canonicalize(std::env::current_exe().unwrap().parent().unwrap()).unwrap()
                == fs::canonicalize(&plan.root).unwrap()
            {
                fs::write(
                    plan.data.join("restarted"),
                    serde_json::to_vec(&std::env::args().skip(1).collect::<Vec<_>>()).unwrap(),
                )
                .unwrap();
                return;
            }
            helper(path).unwrap();
            return;
        }
        let fixture = std::env::temp_dir().join(format!(
            "rovai-update-handoff-{}",
            rovai_web::new_token().unwrap()
        ));
        let root = fixture.join("program");
        let incoming = fixture.join("incoming");
        let data = fixture.join("data");
        let staging = fixture.join("staging");
        for path in [&root, &incoming, &data, &staging] {
            fs::create_dir_all(path).unwrap();
        }
        fs::copy(
            std::env::current_exe().unwrap(),
            root.join(program("rovai-server")),
        )
        .unwrap();
        fs::copy(
            std::env::current_exe().unwrap(),
            incoming.join(program("rovai-server")),
        )
        .unwrap();
        fs::write(root.join("package-info"), "old").unwrap();
        fs::write(incoming.join("package-info"), "new").unwrap();
        fs::write(data.join("sentinel"), "retained data").unwrap();
        fs::create_dir(data.join("updates")).unwrap();
        let arguments = vec![TEST.into(), "--exact".into(), "--nocapture".into()];
        let prepared = Prepared {
            version: "999.0.0".into(),
            staging: staging.clone(),
            incoming,
            root: root.clone(),
            expected_info: "old".into(),
            managed_prefix: None,
            revision: "a".repeat(64),
            arguments: arguments.clone(),
            data: data.clone(),
        };
        let plan = staging.join("install.json");
        fs::write(&plan, serde_json::to_vec(&prepared).unwrap()).unwrap();
        let run = |armed: bool| {
            let mut child = Command::new(std::env::current_exe().unwrap())
                .args(&arguments)
                .env("ROVAI_TEST_UPDATE_PLAN", &plan)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            if armed {
                child.stdin.as_mut().unwrap().write_all(b"apply\n").unwrap();
            }
            drop(child.stdin.take());
            child.wait_with_output().unwrap()
        };
        assert!(!run(false).status.success());
        assert_eq!(
            fs::read_to_string(root.join("package-info")).unwrap(),
            "old"
        );
        assert!(!data.join("restarted").exists());
        let active_program = fs::File::open(root.join(program("rovai-server"))).unwrap();
        active_program.try_lock_shared().unwrap();
        // Another live instance pins the program. The attempted update must
        // return to the old executable, retaining the staged candidate for retry.
        let blocked = run(true);
        assert!(
            blocked.status.success(),
            "{}",
            String::from_utf8_lossy(&blocked.stderr)
        );
        for _ in 0..100 {
            if data.join("restarted").exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert_eq!(
            fs::read_to_string(root.join("package-info")).unwrap(),
            "old"
        );
        assert!(data.join("updates/last-failure.txt").is_file());
        fs::remove_file(data.join("restarted")).unwrap();
        drop(active_program);
        let result = run(true);
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        for _ in 0..100 {
            if data.join("restarted").exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert_eq!(
            serde_json::from_slice::<Vec<String>>(&fs::read(data.join("restarted")).unwrap())
                .unwrap(),
            arguments
        );
        assert_eq!(
            fs::read_to_string(root.join("package-info")).unwrap(),
            "new",
            "{}",
            fs::read_to_string(data.join("updates/last-failure.txt")).unwrap_or_default()
        );
        assert_eq!(
            fs::read_to_string(data.join("sentinel")).unwrap(),
            "retained data"
        );
        // Windows may still be closing the new test executable after writing its receipt.
        for _ in 0..100 {
            if fs::remove_dir_all(&fixture).is_ok() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        fs::remove_dir_all(fixture).unwrap();
    }
}
