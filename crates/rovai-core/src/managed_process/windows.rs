use std::{
    cmp::Ordering,
    ffi::{OsStr, OsString, c_void},
    fs::File,
    io,
    mem::{size_of, size_of_val},
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::ExitStatusExt,
    },
    path::Path,
    process::ExitStatus,
    ptr::{null, null_mut},
    time::Duration,
};

use anyhow::{Result, anyhow, bail};
use windows_sys::Win32::{
    Foundation::{
        GENERIC_READ, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, SetHandleInformation,
        WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    Globalization::{CSTR_EQUAL, CSTR_GREATER_THAN, CSTR_LESS_THAN, CompareStringOrdinal},
    Security::SECURITY_ATTRIBUTES,
    Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_BASIC_INFO, FILE_ID_INFO, FILE_SHARE_READ,
        FILE_STANDARD_INFO, FILE_TYPE_DISK, FileBasicInfo, FileIdInfo, FileStandardInfo,
        GetFileInformationByHandleEx, GetFileType, OPEN_EXISTING,
    },
    System::{
        JobObjects::{
            CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject,
        },
        Pipes::CreatePipe,
        Threading::{
            CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, CreateProcessW,
            DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess,
            InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION,
            STARTF_USESTDHANDLES, STARTUPINFOEXW, UpdateProcThreadAttribute, WaitForSingleObject,
        },
    },
};

#[cfg(test)]
use windows_sys::Win32::{
    Foundation::ERROR_INVALID_PARAMETER,
    System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE},
};

use super::{
    ManagedChildStderr, ManagedChildStdin, ManagedChildStdout, ManagedProcessLaunchSpec,
    ManagedStdinPolicy, ManagedWindowsArgvDialect,
};

const WINDOWS_COMMAND_LINE_LIMIT: usize = 32_767;
const WINDOWS_ENVIRONMENT_BLOCK_LIMIT: usize = 32_767;
const MANAGED_PROCESS_TERMINATION_CODE: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WindowsApplicationIdentity {
    volume_serial_number: u64,
    file_id: [u8; 16],
    end_of_file: i64,
    creation_time: i64,
    last_write_time: i64,
    change_time: i64,
}

pub(super) struct WindowsManagedProcess {
    process: OwnedHandle,
    job: OwnedHandle,
    pid: u32,
    stdin: Option<ManagedChildStdin>,
    stdout: Option<ManagedChildStdout>,
    stderr: Option<ManagedChildStderr>,
    exit_code: Option<u32>,
}

impl WindowsManagedProcess {
    pub(super) fn spawn(spec: &ManagedProcessLaunchSpec) -> Result<Self> {
        let application = wide_nul(spec.application().as_os_str(), "application")?;
        let working_directory =
            wide_nul(spec.working_directory().as_os_str(), "working directory")?;
        let mut command_line = serialize_command_line(
            spec.windows_argv_dialect(),
            spec.application().as_os_str(),
            spec.arguments(),
        )?;
        let environment = serialize_environment(spec.environment())?;

        // Holding a non-delete/non-write-share handle closes the path replacement
        // window between validation and CreateProcessW. The handle is deliberately
        // non-inheritable and absent from HANDLE_LIST.
        let application_lock = open_application_for_launch(&application)?;
        if &application_identity_from_handle(raw_handle(&application_lock))?
            != spec.application_identity()
        {
            bail!(
                "managed_process.invalid_application: application identity changed before launch"
            );
        }
        let job = create_kill_on_close_job()?;

        let (child_stdin, parent_stdin) = child_read_pipe()?;
        let parent_stdin = match spec.stdin_policy() {
            ManagedStdinPolicy::Null => None,
            ManagedStdinPolicy::Piped => Some(parent_stdin),
        };
        let (child_stdout, parent_stdout) = child_write_pipe()?;
        let (child_stderr, parent_stderr) = child_write_pipe()?;

        let job_handles = [raw_handle(&job)];
        let inherited_handles = [
            raw_handle(&child_stdin),
            raw_handle(&child_stdout),
            raw_handle(&child_stderr),
        ];
        let mut attributes = ProcThreadAttributeList::new(2)?;
        attributes.update(
            PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
            job_handles.as_ptr().cast(),
            size_of::<HANDLE>(),
            "managed_process.atomic_assignment_failed",
        )?;
        attributes.update(
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
            inherited_handles.as_ptr().cast(),
            size_of_val(&inherited_handles),
            "managed_process.handle_policy_failed",
        )?;

        let mut startup = STARTUPINFOEXW::default();
        startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = inherited_handles[0];
        startup.StartupInfo.hStdOutput = inherited_handles[1];
        startup.StartupInfo.hStdError = inherited_handles[2];
        startup.lpAttributeList = attributes.as_ptr();

        let mut process_information = PROCESS_INFORMATION::default();
        let created = unsafe {
            // SAFETY: every pointer targets storage that remains alive and stable
            // through CreateProcessW. HANDLE_LIST contains exactly the three
            // inheritable stdio handles; JOB_LIST contains the non-inheritable Job.
            CreateProcessW(
                application.as_ptr(),
                command_line.as_mut_ptr(),
                null(),
                null(),
                1,
                CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
                environment.as_ptr().cast(),
                working_directory.as_ptr(),
                &startup.StartupInfo,
                &mut process_information,
            )
        };
        if created == 0 {
            return Err(last_os_error("managed_process.atomic_assignment_failed"));
        }

        let process = owned_handle(process_information.hProcess, "managed_process.spawn_failed")?;
        let thread = owned_handle(process_information.hThread, "managed_process.spawn_failed")?;
        drop(thread);
        drop(child_stdin);
        drop(child_stdout);
        drop(child_stderr);

        Ok(Self {
            process,
            job,
            pid: process_information.dwProcessId,
            stdin: parent_stdin.map(tokio_file),
            stdout: Some(tokio_file(parent_stdout)),
            stderr: Some(tokio_file(parent_stderr)),
            exit_code: None,
        })
    }

    pub(super) fn id(&self) -> u32 {
        self.pid
    }

    pub(super) fn take_stdin(&mut self) -> Option<ManagedChildStdin> {
        self.stdin.take()
    }

    pub(super) fn take_stdout(&mut self) -> Option<ManagedChildStdout> {
        self.stdout.take()
    }

    pub(super) fn take_stderr(&mut self) -> Option<ManagedChildStderr> {
        self.stderr.take()
    }

    pub(super) async fn wait(&mut self) -> io::Result<ExitStatus> {
        if let Some(exit_code) = self.exit_code {
            return Ok(ExitStatus::from_raw(exit_code));
        }
        loop {
            match unsafe {
                // SAFETY: process is an owned, live process handle.
                WaitForSingleObject(raw_handle(&self.process), 0)
            } {
                WAIT_OBJECT_0 => {
                    let exit_code = process_exit_code(&self.process)?;
                    self.exit_code = Some(exit_code);
                    return Ok(ExitStatus::from_raw(exit_code));
                }
                WAIT_TIMEOUT => tokio::time::sleep(Duration::from_millis(10)).await,
                _ => return Err(io::Error::last_os_error()),
            }
        }
    }

    pub(super) fn terminate_job(&mut self) -> io::Result<()> {
        let terminated = unsafe {
            // SAFETY: job is owned by this process wrapper and never inherited.
            TerminateJobObject(raw_handle(&self.job), MANAGED_PROCESS_TERMINATION_CODE)
        };
        if terminated != 0 {
            Ok(())
        } else {
            let termination_error = io::Error::last_os_error();
            if process_has_exited(&self.process)? {
                Ok(())
            } else {
                Err(termination_error)
            }
        }
    }
}

fn create_kill_on_close_job() -> Result<OwnedHandle> {
    let job = unsafe {
        // SAFETY: a null SECURITY_ATTRIBUTES pointer creates a non-inheritable,
        // unnamed Job owned solely by this launcher.
        CreateJobObjectW(null(), null())
    };
    let job = owned_handle(job, "managed_process.job_create_failed")?;
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let configured = unsafe {
        // SAFETY: limits has the exact structure and size required by the
        // JobObjectExtendedLimitInformation information class.
        SetInformationJobObject(
            raw_handle(&job),
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if configured == 0 {
        return Err(last_os_error("managed_process.job_create_failed"));
    }
    Ok(job)
}

fn open_application_for_launch(application: &[u16]) -> Result<OwnedHandle> {
    let handle = unsafe {
        // SAFETY: application is a NUL-terminated absolute path. Null security
        // attributes make the validation handle non-inheritable.
        CreateFileW(
            application.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ,
            null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            null_mut(),
        )
    };
    let handle = owned_handle(handle, "managed_process.invalid_application")?;
    let file_type = unsafe {
        // SAFETY: handle is a valid owned file handle.
        GetFileType(raw_handle(&handle))
    };
    if file_type != FILE_TYPE_DISK {
        bail!("managed_process.invalid_application: application is not a disk file");
    }
    Ok(handle)
}

pub(super) fn capture_application_identity(path: &Path) -> Result<WindowsApplicationIdentity> {
    let file = File::open(path).map_err(|error| {
        anyhow!("managed_process.invalid_application: failed to open application: {error}")
    })?;
    application_identity_from_handle(file.as_raw_handle())
}

fn application_identity_from_handle(handle: HANDLE) -> Result<WindowsApplicationIdentity> {
    let mut file_id = FILE_ID_INFO::default();
    read_file_information(handle, FileIdInfo, &mut file_id)?;
    let mut standard = FILE_STANDARD_INFO::default();
    read_file_information(handle, FileStandardInfo, &mut standard)?;
    if standard.Directory || standard.EndOfFile < 0 {
        bail!("managed_process.invalid_application: application is not a regular file");
    }
    let mut basic = FILE_BASIC_INFO::default();
    read_file_information(handle, FileBasicInfo, &mut basic)?;
    Ok(WindowsApplicationIdentity {
        volume_serial_number: file_id.VolumeSerialNumber,
        file_id: file_id.FileId.Identifier,
        end_of_file: standard.EndOfFile,
        creation_time: basic.CreationTime,
        last_write_time: basic.LastWriteTime,
        change_time: basic.ChangeTime,
    })
}

fn read_file_information<T>(handle: HANDLE, class: i32, output: &mut T) -> Result<()> {
    let read = unsafe {
        // SAFETY: output points to the exact structure selected by each caller's
        // FILE_INFO_BY_HANDLE_CLASS and remains writable for the declared size.
        GetFileInformationByHandleEx(
            handle,
            class,
            (output as *mut T).cast(),
            size_of::<T>() as u32,
        )
    };
    if read == 0 {
        Err(last_os_error("managed_process.invalid_application"))
    } else {
        Ok(())
    }
}

fn child_read_pipe() -> Result<(OwnedHandle, OwnedHandle)> {
    create_inheritable_pipe(true)
}

fn child_write_pipe() -> Result<(OwnedHandle, OwnedHandle)> {
    create_inheritable_pipe(false)
}

fn create_inheritable_pipe(child_reads: bool) -> Result<(OwnedHandle, OwnedHandle)> {
    let security = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    };
    let mut read_handle = null_mut();
    let mut write_handle = null_mut();
    let created = unsafe {
        // SAFETY: output pointers and SECURITY_ATTRIBUTES are valid for the call.
        CreatePipe(&mut read_handle, &mut write_handle, &security, 0)
    };
    if created == 0 {
        return Err(last_os_error("managed_process.handle_policy_failed"));
    }
    let read_handle = owned_handle(read_handle, "managed_process.handle_policy_failed")?;
    let write_handle = owned_handle(write_handle, "managed_process.handle_policy_failed")?;
    let (child, parent) = if child_reads {
        (read_handle, write_handle)
    } else {
        (write_handle, read_handle)
    };
    let protected = unsafe {
        // SAFETY: parent is a valid handle. Clearing inheritance before process
        // creation prevents it from entering even the explicit HANDLE_LIST.
        SetHandleInformation(raw_handle(&parent), HANDLE_FLAG_INHERIT, 0)
    };
    if protected == 0 {
        return Err(last_os_error("managed_process.handle_policy_failed"));
    }
    Ok((child, parent))
}

struct ProcThreadAttributeList {
    pointer: LPPROC_THREAD_ATTRIBUTE_LIST,
    _storage: Vec<usize>,
}

impl ProcThreadAttributeList {
    fn new(attribute_count: u32) -> Result<Self> {
        let mut bytes = 0usize;
        unsafe {
            // SAFETY: the documented sizing call uses a null list and returns
            // the required byte count through bytes.
            InitializeProcThreadAttributeList(null_mut(), attribute_count, 0, &mut bytes);
        }
        if bytes == 0 {
            return Err(last_os_error("managed_process.atomic_assignment_failed"));
        }
        let words = bytes.div_ceil(size_of::<usize>());
        let mut storage = vec![0usize; words];
        let pointer = storage.as_mut_ptr().cast();
        let initialized = unsafe {
            // SAFETY: storage is aligned and has at least the sized-call capacity.
            InitializeProcThreadAttributeList(pointer, attribute_count, 0, &mut bytes)
        };
        if initialized == 0 {
            return Err(last_os_error("managed_process.atomic_assignment_failed"));
        }
        Ok(Self {
            pointer,
            _storage: storage,
        })
    }

    fn as_ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.pointer
    }

    fn update(
        &mut self,
        attribute: usize,
        value: *const c_void,
        value_bytes: usize,
        stable_error: &str,
    ) -> Result<()> {
        let updated = unsafe {
            // SAFETY: value storage remains alive until after CreateProcessW and
            // the attribute list remains initialized for this update.
            UpdateProcThreadAttribute(
                self.pointer,
                0,
                attribute,
                value,
                value_bytes,
                null_mut(),
                null(),
            )
        };
        if updated == 0 {
            return Err(last_os_error(stable_error));
        }
        Ok(())
    }
}

impl Drop for ProcThreadAttributeList {
    fn drop(&mut self) {
        unsafe {
            // SAFETY: pointer was successfully initialized and storage is still alive.
            DeleteProcThreadAttributeList(self.pointer);
        }
    }
}

fn serialize_command_line(
    dialect: ManagedWindowsArgvDialect,
    application: &OsStr,
    arguments: &[OsString],
) -> Result<Vec<u16>> {
    match dialect {
        ManagedWindowsArgvDialect::MicrosoftCrt => {
            let mut command_line = Vec::new();
            append_microsoft_crt_argument(
                &mut command_line,
                &application.encode_wide().collect::<Vec<_>>(),
            );
            for argument in arguments {
                command_line.push(b' ' as u16);
                append_microsoft_crt_argument(
                    &mut command_line,
                    &argument.encode_wide().collect::<Vec<_>>(),
                );
            }
            if command_line.len() + 1 > WINDOWS_COMMAND_LINE_LIMIT {
                bail!("managed_process.invalid_argument: Windows command line is too long");
            }
            command_line.push(0);
            Ok(command_line)
        }
    }
}

/// Quotes one argument for the Microsoft CRT backslash/quote decoder. Quoting
/// every argument avoids a second branch for whitespace and preserves empty
/// arguments without changing the decoder semantics.
fn append_microsoft_crt_argument(output: &mut Vec<u16>, argument: &[u16]) {
    output.push(b'"' as u16);
    let mut backslashes = 0usize;
    for &unit in argument {
        if unit == b'\\' as u16 {
            backslashes += 1;
            continue;
        }
        if unit == b'"' as u16 {
            output.extend(std::iter::repeat_n(b'\\' as u16, backslashes * 2 + 1));
            output.push(unit);
        } else {
            output.extend(std::iter::repeat_n(b'\\' as u16, backslashes));
            output.push(unit);
        }
        backslashes = 0;
    }
    output.extend(std::iter::repeat_n(b'\\' as u16, backslashes * 2));
    output.push(b'"' as u16);
}

fn serialize_environment(
    environment: &std::collections::BTreeMap<OsString, OsString>,
) -> Result<Vec<u16>> {
    let mut entries = environment
        .iter()
        .map(|(key, value)| {
            let key = key.encode_wide().collect::<Vec<_>>();
            let value = value.encode_wide().collect::<Vec<_>>();
            if key.is_empty()
                || key.contains(&0)
                || !valid_environment_key(&key)
                || value.contains(&0)
            {
                bail!("managed_process.invalid_argument: invalid Windows environment entry");
            }
            Ok((key, value))
        })
        .collect::<Result<Vec<_>>>()?;
    entries.sort_by(|left, right| compare_windows_names(&left.0, &right.0));
    if entries
        .windows(2)
        .any(|pair| compare_windows_names(&pair[0].0, &pair[1].0) == Ordering::Equal)
    {
        bail!("managed_process.invalid_argument: duplicate Windows environment key");
    }

    let mut block = Vec::new();
    for (key, value) in entries {
        block.extend(key);
        block.push(b'=' as u16);
        block.extend(value);
        block.push(0);
    }
    block.push(0);
    if block.len() == 1 {
        block.push(0);
    }
    if block.len() > WINDOWS_ENVIRONMENT_BLOCK_LIMIT {
        bail!("managed_process.invalid_argument: Windows environment block is too large");
    }
    Ok(block)
}

fn valid_environment_key(key: &[u16]) -> bool {
    if !key.contains(&(b'=' as u16)) {
        return true;
    }
    key.len() == 3
        && key[0] == b'=' as u16
        && ((key[1] >= b'A' as u16 && key[1] <= b'Z' as u16)
            || (key[1] >= b'a' as u16 && key[1] <= b'z' as u16))
        && key[2] == b':' as u16
}

fn compare_windows_names(left: &[u16], right: &[u16]) -> Ordering {
    let result = unsafe {
        // SAFETY: both pointers and explicit lengths describe live UTF-16 slices.
        CompareStringOrdinal(
            left.as_ptr(),
            left.len() as i32,
            right.as_ptr(),
            right.len() as i32,
            1,
        )
    };
    match result {
        CSTR_LESS_THAN => Ordering::Less,
        CSTR_EQUAL => Ordering::Equal,
        CSTR_GREATER_THAN => Ordering::Greater,
        _ => left.cmp(right),
    }
}

pub(super) fn environment_keys_equal(left: &OsStr, right: &OsStr) -> bool {
    compare_windows_names(
        &left.encode_wide().collect::<Vec<_>>(),
        &right.encode_wide().collect::<Vec<_>>(),
    ) == Ordering::Equal
}

fn wide_nul(value: &OsStr, label: &str) -> Result<Vec<u16>> {
    let mut value = value.encode_wide().collect::<Vec<_>>();
    if value.contains(&0) {
        bail!("managed_process.invalid_argument: {label} contains NUL");
    }
    value.push(0);
    Ok(value)
}

fn process_exit_code(process: &OwnedHandle) -> io::Result<u32> {
    let mut exit_code = 0u32;
    let read = unsafe {
        // SAFETY: process is an owned process handle and exit_code is writable.
        GetExitCodeProcess(raw_handle(process), &mut exit_code)
    };
    if read == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(exit_code)
    }
}

fn process_has_exited(process: &OwnedHandle) -> io::Result<bool> {
    match unsafe {
        // SAFETY: process is an owned process handle.
        WaitForSingleObject(raw_handle(process), 0)
    } {
        WAIT_OBJECT_0 => Ok(true),
        WAIT_TIMEOUT => Ok(false),
        _ => Err(io::Error::last_os_error()),
    }
}

#[cfg(test)]
pub(super) fn process_is_running_for_test(pid: u32) -> io::Result<bool> {
    let process = unsafe {
        // SAFETY: this opens a non-inheritable synchronization handle for a PID
        // produced by the test helper; it does not mutate the target process.
        OpenProcess(PROCESS_SYNCHRONIZE, 0, pid)
    };
    if process.is_null() {
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_INVALID_PARAMETER as i32) {
            return Ok(false);
        }
        return Err(error);
    }
    let process = owned_handle(process, "managed_process.spawn_failed")
        .map_err(|error| io::Error::other(error.to_string()))?;
    process_has_exited(&process).map(|exited| !exited)
}

#[cfg(test)]
pub(super) fn set_file_inheritable_for_test(file: &File, inheritable: bool) -> io::Result<()> {
    let updated = unsafe {
        // SAFETY: file owns a live handle; this changes only its inheritance bit.
        SetHandleInformation(
            file.as_raw_handle(),
            HANDLE_FLAG_INHERIT,
            if inheritable { HANDLE_FLAG_INHERIT } else { 0 },
        )
    };
    if updated == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
pub(super) fn raw_file_handle_for_test(file: &File) -> usize {
    file.as_raw_handle() as usize
}

#[cfg(test)]
pub(super) fn file_identity_for_raw_handle_for_test(raw: usize) -> io::Result<String> {
    let mut identity = FILE_ID_INFO::default();
    let read = unsafe {
        // SAFETY: callers use either an owned test file handle or a candidate
        // inherited value. Invalid or unrelated values fail or yield another ID.
        GetFileInformationByHandleEx(
            raw as HANDLE,
            FileIdInfo,
            (&mut identity as *mut FILE_ID_INFO).cast(),
            size_of::<FILE_ID_INFO>() as u32,
        )
    };
    if read == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut identifier = String::with_capacity(identity.FileId.Identifier.len() * 2);
    for byte in identity.FileId.Identifier {
        use std::fmt::Write as _;
        write!(&mut identifier, "{byte:02x}").expect("writing to String cannot fail");
    }
    Ok(format!("{:016x}:{identifier}", identity.VolumeSerialNumber))
}

fn tokio_file(handle: OwnedHandle) -> tokio::fs::File {
    let file: File = handle.into();
    tokio::fs::File::from_std(file)
}

fn owned_handle(handle: HANDLE, stable_error: &str) -> Result<OwnedHandle> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(last_os_error(stable_error));
    }
    Ok(unsafe {
        // SAFETY: the successful Win32 call transferred one unique owned handle.
        OwnedHandle::from_raw_handle(handle)
    })
}

fn raw_handle(handle: &OwnedHandle) -> HANDLE {
    handle.as_raw_handle()
}

fn last_os_error(stable_error: &str) -> anyhow::Error {
    anyhow!("{stable_error}: {}", io::Error::last_os_error())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quoted(value: &str) -> String {
        let mut output = Vec::new();
        append_microsoft_crt_argument(&mut output, &value.encode_utf16().collect::<Vec<_>>());
        String::from_utf16(&output).unwrap()
    }

    #[test]
    fn microsoft_crt_serializer_covers_closed_argument_edges() {
        assert_eq!(quoted(""), "\"\"");
        assert_eq!(quoted("two words"), "\"two words\"");
        assert_eq!(quoted("say\"hello"), "\"say\\\"hello\"");
        assert_eq!(quoted("tail\\"), "\"tail\\\\\"");
        assert_eq!(quoted("中文🙂"), "\"中文🙂\"");
    }

    #[test]
    fn command_line_limit_fails_before_create_process() {
        let application = OsString::from("C:\\Rovai\\rovai.exe");
        let argument = OsString::from("x".repeat(WINDOWS_COMMAND_LINE_LIMIT));
        let error = serialize_command_line(
            ManagedWindowsArgvDialect::MicrosoftCrt,
            &application,
            &[argument],
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("managed_process.invalid_argument")
        );
    }

    #[test]
    fn environment_serializer_accepts_only_windows_drive_current_directory_keys() {
        let environment = std::collections::BTreeMap::from([
            (OsString::from("=C:"), OsString::from("C:\\Rovai")),
            (OsString::from("Path"), OsString::from("C:\\Windows")),
        ]);
        let block = serialize_environment(&environment).unwrap();
        assert_eq!(
            String::from_utf16(&block[..block.len() - 1]).unwrap(),
            "=C:=C:\\Rovai\0Path=C:\\Windows\0"
        );

        let invalid = std::collections::BTreeMap::from([(
            OsString::from("ROVAI=INJECTED"),
            OsString::from("value"),
        )]);
        assert!(serialize_environment(&invalid).is_err());
    }
}
