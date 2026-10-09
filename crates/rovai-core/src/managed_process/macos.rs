//! Capture descendants before cancellation severs their ancestry. Signals use
//! Darwin audit-token PID versions, never a bare PID that might have been reused.
use std::{
    collections::{BTreeMap, VecDeque},
    io, mem,
    sync::OnceLock,
};

// libproc's stable combined BSD/unique-identity layout (flavor 18). The unique
// identity ABI is documented in Apple's xnu/bsd/sys/proc_info_private.h.
#[repr(C)]
#[derive(Clone, Copy)]
struct UniqueIdentity {
    executable_uuid: [u8; 16],
    unique_id: u64,
    parent_unique_id: u64,
    pid_version: i32,
    original_parent_version: i32,
    reserved: [u64; 2],
}
const _: () = assert!(mem::size_of::<UniqueIdentity>() == 56);

#[repr(C)]
struct ProcessInfo {
    bsd: libc::proc_bsdinfo,
    identity: UniqueIdentity,
}

fn info(pid: i32) -> io::Result<Option<ProcessInfo>> {
    // SAFETY: this C output structure consists only of integer fields/arrays.
    let mut value: ProcessInfo = unsafe { mem::zeroed() };
    let size = mem::size_of::<ProcessInfo>() as i32;
    // SAFETY: the output buffer has the exact combined libproc layout and size.
    let read =
        unsafe { libc::proc_pidinfo(pid, 18, 0, (&mut value as *mut ProcessInfo).cast(), size) };
    if read == size {
        return Ok(Some(value));
    }
    let error = io::Error::last_os_error();
    if read == 0 && error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(None);
    }
    #[cfg(test)]
    eprintln!("managed identity query failed: pid={pid} read={read} expected={size} error={error}");
    Err(if read == 0 {
        error
    } else {
        io::Error::other("incomplete managed process identity")
    })
}

#[derive(Clone, Copy)]
struct Process {
    pid: i32,
    identity: UniqueIdentity,
}

impl Process {
    fn exited(&self) -> io::Result<bool> {
        Ok(info(self.pid)?.is_none_or(|current| {
            current.identity.unique_id != self.identity.unique_id || current.bsd.pbi_status == 5 // SZOMB: no more user execution.
        }))
    }

    fn signal(&self, signal: i32) -> io::Result<()> {
        let Some(current) = info(self.pid)? else {
            return Ok(());
        };
        if current.identity.unique_id != self.identity.unique_id || current.bsd.pbi_status == 5 {
            return Ok(());
        }
        type Signal = unsafe extern "C" fn(*mut [u32; 8], i32) -> i32;
        static SIGNAL: OnceLock<Option<Signal>> = OnceLock::new();
        let function = SIGNAL
            .get_or_init(|| {
                // SAFETY: libproc is already linked for proc_pidinfo. Dynamic lookup
                // lets older systems retain an honest unconfirmed cleanup result.
                let address = unsafe {
                    libc::dlsym(libc::RTLD_DEFAULT, c"proc_signal_with_audittoken".as_ptr())
                };
                if address.is_null() {
                    None
                } else {
                    // SAFETY: this is the documented libproc function ABI.
                    Some(unsafe { mem::transmute::<*mut libc::c_void, Signal>(address) })
                }
            })
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::Unsupported,
                    "identity-bound process signalling unavailable",
                )
            })?;
        let mut token = [0_u32; 8];
        token[5] = self.pid as u32;
        // exec changes the audit-token version without changing process
        // ownership. First match the lifetime identity, then signal its current
        // version; an intervening exit/exec is rejected by the kernel.
        token[7] = current.identity.pid_version as u32;
        // SAFETY: the kernel matches PID+version before authorizing a signal.
        // Other audit fields do not grant authority; normal caller checks apply.
        let error = unsafe { function(&mut token, signal) };
        if error == 0 || error == libc::ESRCH {
            Ok(())
        } else {
            #[cfg(test)]
            eprintln!(
                "managed audit-token signal failed: pid={} error={error}",
                self.pid
            );
            Err(io::Error::from_raw_os_error(error))
        }
    }
}

pub(super) struct ProcessTree {
    processes: BTreeMap<i32, Process>,
}

impl ProcessTree {
    pub(super) fn new(pid: i32) -> io::Result<Self> {
        let root =
            info(pid)?.ok_or_else(|| io::Error::other("managed root identity unavailable"))?;
        Ok(Self {
            processes: BTreeMap::from([(
                pid,
                Process {
                    pid,
                    identity: root.identity,
                },
            )]),
        })
    }

    pub(super) fn capture(&mut self) -> io::Result<()> {
        let mut pending: VecDeque<_> = self.processes.values().copied().collect();
        let mut children = vec![0_i32; 16384];
        // SAFETY: geteuid has no preconditions.
        let uid = unsafe { libc::geteuid() };
        while let Some(parent) = pending.pop_front() {
            if parent.exited()? {
                continue;
            }
            // Clear errno: libproc returns zero both for no children and errors.
            // SAFETY: __error returns this thread's errno pointer.
            unsafe {
                *libc::__error() = 0;
            }
            // SAFETY: children is a live initialized PID output buffer.
            let count = unsafe {
                libc::proc_listchildpids(
                    parent.pid,
                    children.as_mut_ptr().cast(),
                    mem::size_of_val(children.as_slice()) as i32,
                )
            };
            if count < 0 || (count == 0 && io::Error::last_os_error().raw_os_error() != Some(0)) {
                #[cfg(test)]
                eprintln!(
                    "managed child query failed: pid={} count={count} error={}",
                    parent.pid,
                    io::Error::last_os_error()
                );
                return Err(io::Error::last_os_error());
            }
            if count as usize >= children.len() {
                return Err(io::Error::other(
                    "managed descendant capture limit exceeded",
                ));
            }
            for pid in &children[..count as usize] {
                if self.processes.contains_key(pid) {
                    continue;
                }
                let Some(child) = info(*pid)? else {
                    continue;
                };
                if child.bsd.pbi_ppid != parent.pid as u32
                    || child.identity.parent_unique_id != parent.identity.unique_id
                {
                    continue;
                }
                if child.bsd.pbi_uid != uid {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "managed descendant changed user; cleanup cannot be confirmed",
                    ));
                }
                if self.processes.len() >= 16384 {
                    return Err(io::Error::other(
                        "managed descendant capture limit exceeded",
                    ));
                }
                let process = Process {
                    pid: *pid,
                    identity: child.identity,
                };
                self.processes.insert(*pid, process);
                pending.push_back(process);
            }
        }
        Ok(())
    }

    pub(super) fn signal(&self, signal: i32) -> io::Result<()> {
        let mut result = Ok(());
        for process in self.processes.values().rev() {
            if let Err(error) = process.signal(signal) {
                result = Err(error);
            }
        }
        result
    }

    pub(super) fn is_empty(&self) -> io::Result<bool> {
        for process in self.processes.values() {
            if !process.exited()? {
                return Ok(false);
            }
        }
        Ok(true)
    }
}
