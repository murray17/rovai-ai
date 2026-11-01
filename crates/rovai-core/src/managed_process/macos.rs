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
    sync::OnceLock,
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
const _: () = assert!(std::mem::size_of::<UniqueInfo>() == 56);

#[repr(C)]
struct ProcessInfo {
    bsd: libc::proc_bsdinfo,
    unique: UniqueInfo,
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
        let Some(current) = identity(self.pid)? else {
            return Ok(());
        };
        if current.unique != self.unique || current.uid != self.uid {
            return Ok(());
        }
        signal_audited(self.pid, current.version, signal)
    }
}

fn signal_audited(pid: i32, version: i32, signal: i32) -> io::Result<()> {
    type Signal = unsafe extern "C" fn(*mut [u32; 8], i32) -> i32;
    static SIGNAL: OnceLock<Option<Signal>> = OnceLock::new();
    let function = SIGNAL
        .get_or_init(|| {
            // SAFETY: libproc is linked; absence must remain an unsupported
            // cleanup result, never a fallback to signalling a bare PID.
            let address =
                unsafe { libc::dlsym(libc::RTLD_DEFAULT, c"proc_signal_with_audittoken".as_ptr()) };
            if address.is_null() {
                None
            } else {
                Some(unsafe { std::mem::transmute::<*mut libc::c_void, Signal>(address) })
            }
        })
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::Unsupported,
                "identity-bound process signalling unavailable",
            )
        })?;
    let mut token = [0; 8];
    token[5] = pid as u32;
    // exec keeps the lifetime identity but advances its audit-token version.
    token[7] = version as u32;
    // SAFETY: the token names a process captured through an owned ancestor.
    // XNU checks PID version atomically with the signal, avoiding PID reuse.
    let error = unsafe { function(&mut token, signal) };
    match error {
        0 | libc::ESRCH => Ok(()),
        _ => Err(io::Error::from_raw_os_error(error)),
    }
}

// Cancellation requires a fresh snapshot: a shared TTL may predate the last
// fork and leave a stdio-holding child alive after its root has been killed.
fn check_deadline(deadline: Option<Instant>) -> io::Result<()> {
    if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "historical process cleanup budget exhausted",
        ));
    }
    Ok(())
}

fn snapshot_before(deadline: Option<Instant>) -> io::Result<Vec<Identity>> {
    check_deadline(deadline)?;
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
    let mut rows = Vec::new();
    for pid in &pids[..bytes as usize / 4] {
        check_deadline(deadline)?;
        if let Some(row) = identity(*pid).ok().flatten().filter(|row| row.uid == uid) {
            rows.push(row);
        }
    }
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
    path: Option<PathBuf>,
}

impl ProcessTree {
    pub(super) fn new(pid: i32) -> io::Result<Self> {
        let root =
            identity(pid)?.ok_or_else(|| io::Error::other("managed root exited before capture"))?;
        let owner = identity(std::process::id() as i32)?
            .ok_or_else(|| io::Error::other("Core identity unavailable"))?;
        if root.parent != owner.unique || root.uid != owner.uid {
            return Err(io::Error::other("managed root is not owned by this Core"));
        }
        Ok(Self {
            ledger: Ledger {
                schema: 1,
                boot: boot_session()?,
                owner,
                root: root.unique,
                processes: BTreeMap::from([(root.unique, root)]),
            },
            path: None,
        })
    }

    pub(super) fn track(&mut self, directory: &Path) -> io::Result<()> {
        if self.path.is_some() {
            return Err(io::Error::other("managed process ledger already assigned"));
        }
        fs::create_dir_all(directory)?;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
        self.path = Some(directory.join(format!("{}.json", uuid::Uuid::new_v4())));
        self.persist()
    }

    fn persist(&self) -> io::Result<()> {
        let Some(path) = self.path.as_ref() else {
            return Ok(());
        };
        let temporary = path.with_extension("pending");
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)?;
        let result = (|| {
            file.write_all(&serde_json::to_vec(&self.ledger).map_err(io::Error::other)?)?;
            file.sync_all()?;
            fs::rename(&temporary, path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }

    pub(super) fn capture(&mut self) -> io::Result<()> {
        self.capture_before(None)
    }

    fn capture_before(&mut self, deadline: Option<Instant>) -> io::Result<()> {
        let rows = snapshot_before(deadline)?;
        let mut changed = false;
        loop {
            let count = self.ledger.processes.len();
            for row in rows.iter() {
                check_deadline(deadline)?;
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
        self.is_empty_before(None)
    }

    fn is_empty_before(&self, deadline: Option<Instant>) -> io::Result<bool> {
        for process in self.ledger.processes.values() {
            check_deadline(deadline)?;
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
        self.retire_before(None)
    }

    fn retire_before(&self, deadline: Option<Instant>) -> io::Result<()> {
        if !self.is_empty_before(deadline)? {
            return Err(io::Error::other("managed process cleanup unconfirmed"));
        }
        check_deadline(deadline)?;
        let Some(path) = self.path.as_ref() else {
            return Ok(());
        };
        match fs::remove_file(path) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            result => result,
        }
    }
}

pub(super) fn recover(directory: &Path, report: &mut super::HistoricalProcessCleanup) {
    recover_with_owner_query(directory, report, Identity::alive);
}

fn recover_with_owner_query(
    directory: &Path,
    report: &mut super::HistoricalProcessCleanup,
    owner_alive: impl Fn(&Identity) -> io::Result<bool>,
) {
    if report.expired() {
        return;
    }
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return,
        Err(error) => {
            report.skip("owned_process_directory", error);
            return;
        }
    };
    let current = boot_session().and_then(|boot| {
        identity(std::process::id() as i32)?
            .map(|owner| (boot, owner))
            .ok_or_else(|| io::Error::other("current Core identity unavailable"))
    });
    let (boot, owner) = match current {
        Ok(current) => current,
        Err(error) => {
            report.skip("current_core_identity", error);
            return;
        }
    };
    for entry in entries {
        if report.expired() {
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                report.skip("owned_process_entry", error);
                continue;
            }
        };
        if entry.path().extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        match recover_record(
            &entry,
            &boot,
            &owner,
            report.record_deadline(),
            &owner_alive,
        ) {
            Ok(true) => report.cleaned += 1,
            Ok(false) => report.skipped += 1,
            Err(error) => report.skip("owned_process_record", error),
        }
    }
}

fn recover_record(
    entry: &fs::DirEntry,
    boot: &str,
    owner: &Identity,
    deadline: Instant,
    owner_alive: &impl Fn(&Identity) -> io::Result<bool>,
) -> io::Result<bool> {
    check_deadline(Some(deadline))?;
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
        return Ok(true);
    }
    // New Hosts may write ledgers while this worker runs. The immutable
    // kernel lifetime identity excludes this Core without a startup scan.
    if (ledger.owner.unique == owner.unique && ledger.owner.uid == owner.uid)
        || owner_alive(&ledger.owner)?
    {
        return Ok(false);
    }
    let mut tree = ProcessTree {
        ledger,
        path: Some(entry.path()),
    };
    loop {
        check_deadline(Some(deadline))?;
        tree.capture_before(Some(deadline))?;
        let mut signal_result = Ok(());
        for process in tree.ledger.processes.values().rev() {
            check_deadline(Some(deadline))?;
            if let Err(error) = process.signal(libc::SIGKILL) {
                signal_result = Err(error);
            }
        }
        // Other captured processes were still attempted; an unreadable
        // identity never permits retiring the file as confirmed empty.
        signal_result?;
        check_deadline(Some(deadline))?;
        if tree.is_empty_before(Some(deadline))? {
            tree.retire_before(Some(deadline))?;
            return Ok(true);
        }
        std::thread::sleep(
            Duration::from_millis(20).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
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
        wrong.unique = wrong.unique.wrapping_add(1);
        wrong.signal(libc::SIGKILL).unwrap();
        signal_audited(
            other_identity.pid,
            other_identity.version.wrapping_add(1),
            libc::SIGKILL,
        )
        .unwrap();
        assert!(
            other_identity.alive().unwrap(),
            "stale PID version must not target a live process"
        );
        let status = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "managed_process::process_tree::tests::crash_owner_helper",
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
        // Preserve the incident shape: one old owner PID cannot be queried,
        // while another valid old tree and a current Core tree share the batch.
        let mut current = ProcessTree::new(other.id() as i32).unwrap();
        current.track(&directory).unwrap();
        let current_path = current.path.clone().unwrap();
        let current_bytes = fs::read(&current_path).unwrap();
        let write = |path: &Path, bytes: &[u8]| {
            fs::write(path, bytes).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        };
        let denied_owner = Identity {
            pid: 42,
            unique: u64::MAX,
            parent: 0,
            version: 1,
            uid: unsafe { libc::geteuid() },
        };
        let denied = Ledger {
            schema: 1,
            boot: boot_session().unwrap(),
            owner: denied_owner.clone(),
            root: other_identity.unique,
            processes: BTreeMap::from([(other_identity.unique, other_identity.clone())]),
        };
        let denied_path = directory.join("permission-query.json");
        let denied_bytes = serde_json::to_vec(&denied).unwrap();
        write(&denied_path, &denied_bytes);
        for n in 0..20 {
            write(
                &directory.join(format!("corrupt-{n}.json")),
                format!("{}{{", " ".repeat(n)).as_bytes(),
            );
        }
        let mut unsupported = denied;
        unsupported.schema = 2;
        write(
            &directory.join("unsupported.json"),
            &serde_json::to_vec(&unsupported).unwrap(),
        );
        let wrong_mode = directory.join("wrong-mode.json");
        write(&wrong_mode, b"{}");
        fs::set_permissions(&wrong_mode, fs::Permissions::from_mode(0o644)).unwrap();
        let mut recycled = other_identity.clone();
        recycled.unique = u64::MAX - 9;
        let reused_pid_path = directory.join("reused-pid.json");
        let reused_pid = Ledger {
            schema: 1,
            boot: boot_session().unwrap(),
            owner: Identity {
                unique: u64::MAX - 1,
                ..denied_owner
            },
            root: recycled.unique,
            processes: BTreeMap::from([(recycled.unique, recycled)]),
        };
        write(&reused_pid_path, &serde_json::to_vec(&reused_pid).unwrap());
        let mut no_budget = super::super::HistoricalProcessCleanup::new(Duration::ZERO);
        recover(&directory, &mut no_budget);
        assert!(no_budget.budget_exhausted);
        assert_eq!(no_budget.cleaned, 0);
        assert!(child.alive().unwrap());
        let mut report = super::super::HistoricalProcessCleanup::new(Duration::from_secs(3));
        recover_with_owner_query(&directory, &mut report, |owner| {
            if owner.unique == u64::MAX {
                Err(io::Error::from_raw_os_error(libc::EPERM))
            } else if owner.unique == u64::MAX - 1 {
                Ok(false)
            } else {
                owner.alive()
            }
        });
        let gone = !child.alive().unwrap();
        let unrelated_alive = other_identity.alive().unwrap();
        // Ensure fixture-owned children are reaped even when an assertion fails.
        child.signal(libc::SIGKILL).unwrap();
        other_identity.signal(libc::SIGKILL).unwrap();
        other.wait().unwrap();
        assert_eq!(fs::read(&denied_path).unwrap(), denied_bytes);
        assert_eq!(fs::read(&current_path).unwrap(), current_bytes);
        assert!(
            !reused_pid_path.exists(),
            "known PID reuse retires only the old record"
        );
        assert_eq!(
            report.cleaned, 2,
            "bad files cannot abort the valid old tree or reused PID record"
        );
        assert_eq!(report.skipped, 24);
        assert_eq!(
            report.diagnostics.len(),
            16,
            "diagnostics must remain bounded"
        );
        assert!(gone, "restart must reclaim the exact prior Core tree");
        assert!(
            unrelated_alive,
            "recovery must preserve another owned test process"
        );
        // Directory/read/unlink failures are diagnostics, with the files left
        // in place. They do not change shared identity/stop semantics.
        let unreadable = directory.join("unreadable");
        fs::create_dir(&unreadable).unwrap();
        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000)).unwrap();
        let mut unreadable_report =
            super::super::HistoricalProcessCleanup::new(Duration::from_secs(1));
        recover(&unreadable, &mut unreadable_report);
        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(unreadable_report.skipped, 1);
        assert!(unreadable_report.diagnostics[0].contains("owned_process_directory"));
        let undeletable = directory.join("undeletable");
        fs::create_dir(&undeletable).unwrap();
        let mut old_boot = reused_pid;
        old_boot.boot = "previous-system-boot".into();
        let old_path = undeletable.join("old.json");
        write(&old_path, &serde_json::to_vec(&old_boot).unwrap());
        fs::set_permissions(&undeletable, fs::Permissions::from_mode(0o500)).unwrap();
        let mut unlink_report = super::super::HistoricalProcessCleanup::new(Duration::from_secs(1));
        recover(&undeletable, &mut unlink_report);
        fs::set_permissions(&undeletable, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(unlink_report.cleaned, 0);
        assert_eq!(unlink_report.skipped, 1);
        assert!(old_path.exists());
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
        let mut tree = ProcessTree::new(child.id() as i32).unwrap();
        tree.track(&directory).unwrap();
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
