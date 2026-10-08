//! Same-UID descendants, including native shells that create another session.
//! Signals use Darwin's PID-version check, never an unqualified recycled PID.
//! The private ledger permits cleanup after the owning Core restarts; it is not
//! an OS Job and does not promise cleanup while Core remains stopped.
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::{self, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

// XNU libproc ABI: PROC_PIDT_BSDINFOWITHUNIQID. Both structures have fixed size.
#[repr(C)]
struct UniqueInfo {
    uuid: [u8; 16],
    unique: u64,
    parent: u64,
    version: i32,
    original_parent_version: i32,
    reserved: [u64; 2],
}

#[repr(C)]
struct ProcessInfo {
    bsd: libc::proc_bsdinfo,
    unique: UniqueInfo,
}

unsafe extern "C" {
    fn proc_signal_with_audittoken(token: *const [u32; 8], signal: i32) -> i32;
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct Identity {
    pid: i32,
    unique: u64,
    parent: u64,
    version: i32,
    uid: u32,
}

fn identity(pid: i32) -> io::Result<Option<Identity>> {
    // SAFETY: proc_pidinfo receives an initialized buffer of its exact ABI size.
    let mut info: ProcessInfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<ProcessInfo>();
    let count = unsafe {
        libc::proc_pidinfo(
            pid,
            18,
            0,
            (&mut info as *mut ProcessInfo).cast(),
            size as i32,
        )
    };
    if count != size as i32 {
        let error = io::Error::last_os_error();
        return if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(None)
        } else {
            Err(io::Error::other(format!(
                "macOS process identity unavailable: {error}"
            )))
        };
    }
    // A zombie can no longer execute or write; its parent owns wait/reaping.
    if info.bsd.pbi_status == libc::SZOMB as u32 {
        return Ok(None);
    }
    Ok(Some(Identity {
        pid,
        unique: info.unique.unique,
        parent: info.unique.parent,
        version: info.unique.version,
        uid: info.bsd.pbi_uid,
    }))
}

impl Identity {
    fn alive(&self) -> io::Result<bool> {
        Ok(identity(self.pid)?.is_some_and(|now| now.unique == self.unique && now.uid == self.uid))
    }

    fn signal(&self, signal: i32) -> io::Result<()> {
        let mut token = [0; 8];
        token[5] = self.pid as u32;
        token[7] = self.version as u32;
        // SAFETY: the token names a process captured through an owned ancestor.
        // XNU checks PID version atomically with the signal, avoiding PID reuse.
        let error = unsafe { proc_signal_with_audittoken(&token, signal) };
        match error {
            0 | libc::ESRCH => Ok(()),
            _ => Err(io::Error::from_raw_os_error(error)),
        }
    }
}

type Snapshot = Option<(Instant, Arc<Vec<Identity>>)>;
static SNAPSHOT: LazyLock<Mutex<Snapshot>> = LazyLock::new(|| Mutex::new(None));

fn snapshot() -> io::Result<Arc<Vec<Identity>>> {
    let mut cached = SNAPSHOT
        .lock()
        .map_err(|_| io::Error::other("process snapshot poisoned"))?;
    if let Some((at, rows)) = cached.as_ref()
        && at.elapsed() < Duration::from_millis(100)
    {
        return Ok(rows.clone());
    }
    let mut pids = vec![0_i32; 32768];
    // SAFETY: the output points at a writable PID array. Type 1 is PROC_ALL_PIDS.
    let bytes =
        unsafe { libc::proc_listpids(1, 0, pids.as_mut_ptr().cast(), (pids.len() * 4) as i32) };
    if bytes <= 0 || bytes as usize >= pids.len() * 4 {
        return Err(io::Error::other(
            "macOS process snapshot unavailable or over limit",
        ));
    }
    // SAFETY: geteuid has no preconditions.
    let uid = unsafe { libc::geteuid() };
    let rows: Arc<Vec<Identity>> = Arc::new(
        pids[..bytes as usize / 4]
            .iter()
            .filter_map(|pid| identity(*pid).ok().flatten().filter(|row| row.uid == uid))
            .collect(),
    );
    *cached = Some((Instant::now(), rows.clone()));
    Ok(rows)
}

fn boot_session() -> io::Result<String> {
    let mut bytes = [0_u8; 128];
    let mut len = bytes.len();
    // SAFETY: name is NUL terminated; output and length are valid writable buffers.
    if unsafe {
        libc::sysctlbyname(
            c"kern.bootsessionuuid".as_ptr(),
            bytes.as_mut_ptr().cast(),
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    if len < 2 || len > bytes.len() {
        return Err(io::Error::other("invalid macOS boot identity"));
    }
    String::from_utf8(bytes[..len - 1].to_vec()).map_err(io::Error::other)
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Ledger {
    schema: u8,
    boot: String,
    owner: Identity,
    root: u64,
    processes: BTreeMap<u64, Identity>,
}

pub(super) struct ProcessTree {
    ledger: Ledger,
    path: PathBuf,
}

impl ProcessTree {
    pub(super) fn new(pid: i32, directory: &Path) -> io::Result<Self> {
        let root =
            identity(pid)?.ok_or_else(|| io::Error::other("managed root exited before capture"))?;
        let owner = identity(std::process::id() as i32)?
            .ok_or_else(|| io::Error::other("Core identity unavailable"))?;
        if root.parent != owner.unique || root.uid != owner.uid {
            return Err(io::Error::other("managed root is not owned by this Core"));
        }
        fs::create_dir_all(directory)?;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
        let tree = Self {
            ledger: Ledger {
                schema: 1,
                boot: boot_session()?,
                owner,
                root: root.unique,
                processes: BTreeMap::from([(root.unique, root)]),
            },
            path: directory.join(format!("{}.json", uuid::Uuid::new_v4())),
        };
        tree.persist()?;
        Ok(tree)
    }

    fn persist(&self) -> io::Result<()> {
        let temporary = self.path.with_extension("pending");
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)?;
        let result = (|| {
            file.write_all(&serde_json::to_vec(&self.ledger).map_err(io::Error::other)?)?;
            file.sync_all()?;
            fs::rename(&temporary, &self.path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }

    pub(super) fn capture(&mut self) -> io::Result<()> {
        let rows = snapshot()?;
        let mut changed = false;
        loop {
            let count = self.ledger.processes.len();
            for row in rows.iter() {
                if let Some(owned) = self.ledger.processes.get_mut(&row.unique) {
                    // exec may advance PID version without changing the process's
                    // unique identity. Refresh only that already-owned identity.
                    if owned.uid == row.uid && *owned != *row {
                        *owned = row.clone();
                        changed = true;
                    }
                }
                if self.ledger.processes.contains_key(&row.parent)
                    && !self.ledger.processes.contains_key(&row.unique)
                {
                    if self.ledger.processes.len() >= 16384 {
                        return Err(io::Error::other("owned process capture limit exceeded"));
                    }
                    // Parent unique IDs survive reparenting. Keep ancestor identities
                    // until this whole tree is gone, even after an intermediate exits.
                    self.ledger.processes.insert(row.unique, row.clone());
                    changed = true;
                }
            }
            if count == self.ledger.processes.len() {
                break;
            }
        }
        if changed {
            self.persist()?;
        }
        Ok(())
    }

    pub(super) fn signal(&self, signal: i32) -> io::Result<()> {
        let mut result = Ok(());
        for process in self.ledger.processes.values().rev() {
            if let Err(error) = process.signal(signal) {
                result = Err(error);
            }
        }
        result
    }

    pub(super) fn is_empty(&self) -> io::Result<bool> {
        for process in self.ledger.processes.values() {
            if process.alive()? {
                return Ok(false);
            }
        }
        Ok(true)
    }

    #[cfg(test)]
    pub(super) fn owns_live_pid(&self, pid: u32) -> io::Result<bool> {
        for process in self.ledger.processes.values() {
            if process.pid == pid as i32 && process.alive()? {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub(super) fn retire(&self) -> io::Result<()> {
        if !self.is_empty()? {
            return Err(io::Error::other("managed process cleanup unconfirmed"));
        }
        match fs::remove_file(&self.path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            result => result,
        }
    }
}

pub(super) fn recover(directory: &Path) -> io::Result<()> {
    if !directory.exists() {
        return Ok(());
    }
    let boot = boot_session()?;
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if entry.path().extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        let metadata = entry.metadata()?;
        // Private same-UID regular files only; never follow a substituted symlink.
        if !entry.file_type()?.is_file()
            || metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o077 != 0
            || metadata.len() > 2 * 1024 * 1024
        {
            return Err(io::Error::other("invalid managed process ledger"));
        }
        let ledger: Ledger =
            serde_json::from_slice(&fs::read(entry.path())?).map_err(io::Error::other)?;
        if ledger.schema != 1
            || !ledger.processes.contains_key(&ledger.root)
            || ledger
                .processes
                .values()
                .any(|p| p.pid <= 1 || p.uid != ledger.owner.uid)
        {
            return Err(io::Error::other("invalid managed process ownership"));
        }
        if ledger.boot != boot {
            fs::remove_file(entry.path())?;
            continue;
        }
        if ledger.owner.alive()? {
            continue;
        }
        let mut tree = ProcessTree {
            ledger,
            path: entry.path(),
        };
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            tree.capture()?;
            tree.signal(libc::SIGKILL)?;
            if tree.is_empty()? {
                tree.retire()?;
                break;
            }
            if Instant::now() >= deadline {
                return Err(io::Error::other("orphan Runtime cleanup unconfirmed"));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    Ok(())
}

#[cfg(all(test, feature = "extended-tests"))]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    #[test]
    fn pid_version_and_restart_ledger_preserve_process_ownership() {
        let directory =
            std::env::temp_dir().join(format!("rovai-macos-owner-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let mut other = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        let other_identity = identity(other.id() as i32).unwrap().unwrap();
        let mut wrong = other_identity.clone();
        wrong.version = wrong.version.wrapping_add(1);
        wrong.signal(libc::SIGKILL).unwrap();
        assert!(
            other_identity.alive().unwrap(),
            "stale PID version must not target a live process"
        );
        let status = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "managed_process::macos::tests::crash_owner_helper",
                "--nocapture",
            ])
            .env("ROVAI_TEST_MACOS_OWNER_DIR", &directory)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(19));
        let child: Identity =
            serde_json::from_slice(&fs::read(directory.join("child.identity")).unwrap()).unwrap();
        assert!(
            child.alive().unwrap(),
            "helper must leave a live detached child"
        );
        let recovery = recover(&directory);
        let gone = !child.alive().unwrap();
        let unrelated_alive = other_identity.alive().unwrap();
        // Ensure fixture-owned children are reaped even when an assertion fails.
        child.signal(libc::SIGKILL).unwrap();
        other_identity.signal(libc::SIGKILL).unwrap();
        other.wait().unwrap();
        recovery.unwrap();
        assert!(gone, "restart must reclaim the exact prior Core tree");
        assert!(
            unrelated_alive,
            "recovery must preserve another owned test process"
        );
        recover(&directory).unwrap();
        assert!(!fs::read_dir(&directory).unwrap().any(|e| {
            e.unwrap()
                .path()
                .extension()
                .is_some_and(|ext| ext == "json")
        }));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn crash_owner_helper() {
        let Some(directory) = std::env::var_os("ROVAI_TEST_MACOS_OWNER_DIR") else {
            return;
        };
        let directory = PathBuf::from(directory);
        let child = Command::new("/usr/bin/python3")
            .args(["-c", "import os,time; os.setsid(); time.sleep(30)"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut tree = ProcessTree::new(child.id() as i32, &directory).unwrap();
        std::thread::sleep(Duration::from_millis(150));
        tree.capture().unwrap();
        assert!(tree.owns_live_pid(child.id()).unwrap());
        assert!(!tree.owns_live_pid(std::process::id()).unwrap());
        fs::write(
            directory.join("child.identity"),
            serde_json::to_vec(&identity(child.id() as i32).unwrap().unwrap()).unwrap(),
        )
        .unwrap();
        std::process::exit(19);
    }
}
