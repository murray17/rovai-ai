use std::{ffi::OsStr, io, process::ExitStatus, time::Duration};

use anyhow::{Context, Result, anyhow, bail};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    task::JoinHandle,
    time::{Instant, timeout, timeout_at},
};

use crate::managed_process::{
    ManagedChildStdin, ManagedChildStdout, ManagedProcess, ManagedProcessLaunchSpec,
    ManagedProcessPurpose, ManagedStdinPolicy, ManagedWindowsArgvDialect,
};

pub const DEFAULT_CAPTURE_LIMIT: usize = 64 * 1024;
pub const DEFAULT_PROTOCOL_FRAME_BYTES: usize = 64 * 1024 * 1024;
pub const PROTOCOL_FRAME_BYTES_ENV: &str = "ROVAI_RUNTIME_PROBE_MAX_FRAME_BYTES";
pub const DEFAULT_CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);

/// Core-owned read capacity, independent of native Runtime configuration.
pub fn protocol_frame_bytes() -> Result<usize> {
    let value = std::env::var(PROTOCOL_FRAME_BYTES_ENV);
    match value {
        Ok(value) => parse_protocol_frame_bytes(&value),
        Err(std::env::VarError::NotPresent) => Ok(DEFAULT_PROTOCOL_FRAME_BYTES),
        Err(_) => bail!(
            "runtime_probe_frame_capacity_invalid: {PROTOCOL_FRAME_BYTES_ENV} must be a positive byte count"
        ),
    }
}

fn parse_protocol_frame_bytes(value: &str) -> Result<usize> {
    value.trim().parse::<usize>().ok()
        .filter(|limit| *limit > 0 && *limit < isize::MAX as usize)
        .with_context(|| format!("runtime_probe_frame_capacity_invalid: {PROTOCOL_FRAME_BYTES_ENV} must be a positive byte count below {}", isize::MAX))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundedCapture {
    pub bytes: Vec<u8>,
    pub truncated: bool,
}

impl BoundedCapture {
    pub fn lossy_text(&self) -> String {
        String::from_utf8_lossy(&self.bytes).into_owned()
    }
}

#[derive(Debug)]
pub struct BoundedCommandOutput {
    pub status: ExitStatus,
    pub stdout: BoundedCapture,
    pub stderr: BoundedCapture,
}

#[derive(Debug, Clone, Copy)]
pub struct ProbeCommandLimits {
    pub deadline: Duration,
    pub stdout_bytes: usize,
    pub stderr_bytes: usize,
    pub cleanup_timeout: Duration,
}

impl ProbeCommandLimits {
    pub fn new(deadline: Duration) -> Self {
        Self {
            deadline,
            stdout_bytes: DEFAULT_CAPTURE_LIMIT,
            stderr_bytes: DEFAULT_CAPTURE_LIMIT,
            cleanup_timeout: DEFAULT_CLEANUP_TIMEOUT,
        }
    }
}

pub async fn run_bounded_command(
    command: &mut Command,
    limits: ProbeCommandLimits,
) -> Result<BoundedCommandOutput> {
    run_bounded_command_with_input(command, None, limits).await
}

pub async fn run_bounded_command_with_input(
    command: &mut Command,
    input: Option<&[u8]>,
    limits: ProbeCommandLimits,
) -> Result<BoundedCommandOutput> {
    let stdin_policy = if input.is_some() {
        ManagedStdinPolicy::Piped
    } else {
        ManagedStdinPolicy::Null
    };
    let mut child = spawn_managed_probe(command, stdin_policy)?;
    let mut stdin = if input.is_some() {
        Some(
            child
                .take_stdin()
                .context("runtime_probe_stdin_unavailable")?,
        )
    } else {
        None
    };
    let stdout = child
        .take_stdout()
        .context("runtime_probe_stdout_unavailable")?;
    let stderr = child
        .take_stderr()
        .context("runtime_probe_stderr_unavailable")?;
    let mut stdout_task = tokio::spawn(read_bounded(stdout, limits.stdout_bytes));
    let mut stderr_task = tokio::spawn(read_bounded(stderr, limits.stderr_bytes));
    let deadline = Instant::now() + limits.deadline;

    if let (Some(input), Some(mut stdin)) = (input, stdin.take()) {
        let write_result = timeout_at(deadline, async {
            stdin.write_all(input).await?;
            stdin.shutdown().await
        })
        .await;
        match write_result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                terminate_process_tree(&mut child, limits.cleanup_timeout).await;
                abort_reader(&mut stdout_task).await;
                abort_reader(&mut stderr_task).await;
                return Err(error).context("runtime_probe_stdin_write_failed");
            }
            Err(_) => {
                terminate_process_tree(&mut child, limits.cleanup_timeout).await;
                abort_reader(&mut stdout_task).await;
                abort_reader(&mut stderr_task).await;
                bail!("runtime_probe_timed_out");
            }
        }
    }

    let status = match timeout_at(deadline, child.wait()).await {
        Ok(result) => result.context("runtime_probe_wait_failed")?,
        Err(_) => {
            terminate_process_tree(&mut child, limits.cleanup_timeout).await;
            abort_reader(&mut stdout_task).await;
            abort_reader(&mut stderr_task).await;
            bail!("runtime_probe_timed_out");
        }
    };

    // A successful leader can leave descendants holding inherited stdio. Always terminate the
    // probe-owned group before waiting for readers so completion remains bounded.
    terminate_process_tree(&mut child, limits.cleanup_timeout).await;
    let stdout = join_reader(&mut stdout_task, limits.cleanup_timeout, "stdout").await?;
    let stderr = join_reader(&mut stderr_task, limits.cleanup_timeout, "stderr").await?;
    Ok(BoundedCommandOutput {
        status,
        stdout,
        stderr,
    })
}

pub struct RuntimeProbeProcess {
    child: ManagedProcess,
    stdin: Option<ManagedChildStdin>,
    stdout: Option<BoundedLineReader<ManagedChildStdout>>,
    stderr_task: Option<JoinHandle<io::Result<BoundedCapture>>>,
    cleanup_timeout: Duration,
    cleaned: bool,
}

impl RuntimeProbeProcess {
    pub fn spawn(
        command: &mut Command,
        stderr_bytes: usize,
        cleanup_timeout: Duration,
    ) -> Result<Self> {
        let max_frame_bytes = protocol_frame_bytes()?;
        let mut child = spawn_managed_probe(command, ManagedStdinPolicy::Piped)?;
        let stdin = child
            .take_stdin()
            .context("runtime_probe_stdin_unavailable")?;
        let stdout = child
            .take_stdout()
            .context("runtime_probe_stdout_unavailable")?;
        let stderr = child
            .take_stderr()
            .context("runtime_probe_stderr_unavailable")?;
        Ok(Self {
            child,
            stdin: Some(stdin),
            stdout: Some(BoundedLineReader::new(stdout, max_frame_bytes)),
            stderr_task: Some(tokio::spawn(read_bounded(stderr, stderr_bytes))),
            cleanup_timeout,
            cleaned: false,
        })
    }

    pub fn stdin_mut(&mut self) -> Result<&mut ManagedChildStdin> {
        self.stdin
            .as_mut()
            .context("runtime_probe_stdin_unavailable")
    }

    pub fn stdout_mut(&mut self) -> Result<&mut BoundedLineReader<ManagedChildStdout>> {
        self.stdout
            .as_mut()
            .context("runtime_probe_stdout_unavailable")
    }

    pub fn split_io(
        &mut self,
    ) -> Result<(
        &mut ManagedChildStdin,
        &mut BoundedLineReader<ManagedChildStdout>,
    )> {
        match (&mut self.stdin, &mut self.stdout) {
            (Some(stdin), Some(stdout)) => Ok((stdin, stdout)),
            _ => bail!("runtime_probe_stdio_unavailable"),
        }
    }

    pub async fn finish(mut self) -> Result<BoundedCapture> {
        self.stdin.take();
        self.stdout.take();
        terminate_process_tree(&mut self.child, self.cleanup_timeout).await;
        self.cleaned = true;
        let mut stderr_task = self
            .stderr_task
            .take()
            .context("runtime_probe_stderr_reader_unavailable")?;
        join_reader(&mut stderr_task, self.cleanup_timeout, "stderr").await
    }
}

impl Drop for RuntimeProbeProcess {
    fn drop(&mut self) {
        if self.cleaned {
            return;
        }
        let _ = self.child.force_terminate_tree();
        if let Some(task) = self.stderr_task.take() {
            task.abort();
        }
    }
}

pub struct BoundedLineReader<R> {
    reader: BufReader<R>,
    max_frame_bytes: usize,
    truncated: bool,
}

impl<R: AsyncRead + Unpin> BoundedLineReader<R> {
    pub fn new(reader: R, max_frame_bytes: usize) -> Self {
        Self {
            reader: BufReader::new(reader),
            max_frame_bytes,
            truncated: false,
        }
    }

    pub fn truncated(&self) -> bool {
        self.truncated
    }

    pub async fn next_line(&mut self) -> io::Result<Option<String>> {
        let mut line = Vec::new();
        loop {
            tokio::task::consume_budget().await;
            let available = self.reader.fill_buf().await?;
            if available.is_empty() {
                if line.is_empty() {
                    return Ok(None);
                }
                if line.len() > self.max_frame_bytes {
                    self.truncated = true;
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!(
                            "runtime_probe_frame_capacity_exceeded: protocol frame exceeds {} bytes; increase {PROTOCOL_FRAME_BYTES_ENV} in the Rovai Core environment and retry",
                            self.max_frame_bytes
                        ),
                    ));
                }
                return decode_line(line).map(Some);
            }
            let newline = available.iter().position(|byte| *byte == b'\n');
            let consumed = newline.map_or(available.len(), |index| index + 1);
            let content_len = newline.unwrap_or(consumed);
            let next_len = line.len().saturating_add(content_len);
            // A trailing CR can be the first half of CRLF, including across reads.
            // Permit that delimiter byte without charging it to the JSON payload.
            let trailing_cr = if content_len == 0 {
                line.last() == Some(&b'\r')
            } else {
                available.get(content_len - 1) == Some(&b'\r')
            };
            let payload_len = next_len.saturating_sub(usize::from(trailing_cr));
            if payload_len > self.max_frame_bytes {
                self.truncated = true;
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "runtime_probe_frame_capacity_exceeded: protocol frame exceeds {} bytes; increase {PROTOCOL_FRAME_BYTES_ENV} in the Rovai Core environment and retry",
                        self.max_frame_bytes
                    ),
                ));
            }
            if next_len > line.capacity() {
                let capacity = line
                    .capacity()
                    .saturating_mul(2)
                    .max(8192)
                    .max(next_len)
                    .min(self.max_frame_bytes.saturating_add(1));
                line.try_reserve_exact(capacity.saturating_sub(line.len()))
                    .map_err(|_| {
                        io::Error::new(
                            io::ErrorKind::OutOfMemory,
                            "runtime_probe_frame_allocation_failed",
                        )
                    })?;
            }
            line.extend_from_slice(&available[..content_len]);
            self.reader.consume(consumed);
            if newline.is_some() {
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                return decode_line(line).map(Some);
            }
        }
    }
}

fn spawn_managed_probe(
    command: &Command,
    stdin_policy: ManagedStdinPolicy,
) -> Result<ManagedProcess> {
    let ownership = format!(
        "runtime-probe:{}",
        PathLabel(command.as_std().get_program())
    );
    let spec = ManagedProcessLaunchSpec::capture(
        command,
        ManagedProcessPurpose::RuntimeProbe,
        stdin_policy,
        ManagedWindowsArgvDialect::MicrosoftCrt,
        ownership,
    )?;
    ManagedProcess::spawn(spec).context("runtime_probe_spawn_failed")
}

async fn terminate_process_tree(child: &mut ManagedProcess, cleanup_timeout: Duration) {
    let _ = child.force_terminate_tree();
    let _ = timeout(cleanup_timeout, child.wait()).await;
}

struct PathLabel<'a>(&'a OsStr);

impl std::fmt::Display for PathLabel<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let path = std::path::Path::new(self.0);
        path.file_name()
            .unwrap_or(self.0)
            .to_string_lossy()
            .fmt(formatter)
    }
}

async fn read_bounded<R: AsyncRead + Unpin>(
    mut reader: R,
    limit: usize,
) -> io::Result<BoundedCapture> {
    let mut bytes = Vec::with_capacity(limit.min(8 * 1024));
    let mut buffer = [0_u8; 8 * 1024];
    let mut truncated = false;
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(bytes.len());
        if remaining > 0 {
            bytes.extend_from_slice(&buffer[..read.min(remaining)]);
        }
        truncated |= read > remaining;
    }
    Ok(BoundedCapture { bytes, truncated })
}

async fn join_reader(
    task: &mut JoinHandle<io::Result<BoundedCapture>>,
    cleanup_timeout: Duration,
    stream: &str,
) -> Result<BoundedCapture> {
    match timeout(cleanup_timeout, &mut *task).await {
        Ok(result) => result
            .with_context(|| format!("runtime_probe_{stream}_reader_join_failed"))?
            .with_context(|| format!("runtime_probe_{stream}_read_failed")),
        Err(_) => {
            task.abort();
            let _ = task.await;
            Err(anyhow!("runtime_probe_{stream}_cleanup_timed_out"))
        }
    }
}

async fn abort_reader(task: &mut JoinHandle<io::Result<BoundedCapture>>) {
    task.abort();
    let _ = task.await;
}

fn decode_line(line: Vec<u8>) -> io::Result<String> {
    String::from_utf8(line).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "runtime_probe_stdout_was_not_utf8",
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[tokio::test]
    async fn successful_leader_with_stdio_holding_descendant_finishes_bounded() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "(sleep 30) & printf 'ready\\n'"]);
        let started = Instant::now();
        let output = run_bounded_command(
            &mut command,
            ProbeCommandLimits {
                deadline: Duration::from_secs(1),
                stdout_bytes: 1024,
                stderr_bytes: 1024,
                cleanup_timeout: Duration::from_millis(500),
            },
        )
        .await
        .expect("probe should terminate its descendant");
        assert!(output.status.success());
        assert_eq!(output.stdout.bytes, b"ready\n");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn infinite_stderr_is_captured_with_a_fixed_limit() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "while :; do printf 0123456789 >&2; done"]);
        let error = run_bounded_command(
            &mut command,
            ProbeCommandLimits {
                deadline: Duration::from_millis(100),
                stdout_bytes: 16,
                stderr_bytes: 4096,
                cleanup_timeout: Duration::from_millis(500),
            },
        )
        .await
        .expect_err("probe must time out");
        assert!(error.to_string().contains("timed_out"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn completed_stderr_records_truncation_at_the_configured_capacity() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "head -c 16384 /dev/zero >&2"]);
        let output = run_bounded_command(
            &mut command,
            ProbeCommandLimits {
                deadline: Duration::from_secs(1),
                stdout_bytes: 16,
                stderr_bytes: 4096,
                cleanup_timeout: Duration::from_millis(500),
            },
        )
        .await
        .expect("bounded stderr command should finish");
        assert!(output.status.success());
        assert_eq!(output.stderr.bytes.len(), 4096);
        assert!(output.stderr.truncated);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancelling_the_owner_kills_the_spawned_process_group() {
        for protocol in [false, true] {
            let directory = std::env::temp_dir().join(format!(
                "rovai-runtime-probe-cancel-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&directory).unwrap();
            let pid_file = directory.join("descendant.pid");
            let script = format!(
                "(sleep 30) & child=$!; printf '%s' \"$child\" > '{}'; wait",
                pid_file.display()
            );
            let task = tokio::spawn(async move {
                let mut command = Command::new("/bin/sh");
                command.args(["-c", &script]);
                if protocol {
                    let mut process =
                        RuntimeProbeProcess::spawn(&mut command, 1024, DEFAULT_CLEANUP_TIMEOUT)?;
                    process.stdout_mut()?.next_line().await?;
                    process.finish().await?;
                } else {
                    run_bounded_command(
                        &mut command,
                        ProbeCommandLimits::new(Duration::from_secs(30)),
                    )
                    .await?;
                }
                Ok::<_, anyhow::Error>(())
            });
            let pid = tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    if let Ok(value) = std::fs::read_to_string(&pid_file)
                        && let Ok(pid) = value.parse::<i32>()
                    {
                        break pid;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("descendant pid should be published");
            task.abort();
            let _ = task.await;
            let gone = tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    // SAFETY: pid was written by the owned descendant immediately before cancellation.
                    let result = unsafe { libc::kill(pid, 0) };
                    if result == -1
                        && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
                    {
                        break;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await;
            let _ = std::fs::remove_dir_all(directory);
            assert!(gone.is_ok(), "cancelled probe descendant must be gone");
        }
    }

    #[cfg(windows)]
    #[tokio::test(start_paused = true)]
    async fn timed_out_bat_probe_cleans_its_complete_process_tree() {
        let directory =
            std::env::temp_dir().join(format!("rovai bat probe timeout {}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let script = directory.join("runtime probe.bat");
        let pid_file = directory.join("descendant.pid");
        std::fs::write(
            &script,
            concat!(
                "@echo off\r\n",
                "\"%ROVAI_TEST_EXE%\" --exact managed_process::tests::windows_job_child_helper --ignored --nocapture\r\n",
                "\"%SystemRoot%\\System32\\ping.exe\" -t 127.0.0.1 >nul\r\n"
            ),
        )
        .unwrap();
        let task = tokio::spawn({
            let script = script.clone();
            let pid_file = pid_file.clone();
            async move {
                let mut command = Command::new(script);
                command
                    .env("ROVAI_TEST_EXE", std::env::current_exe().unwrap())
                    .env("ROVAI_MANAGED_PROCESS_HELPER_MODE", "child")
                    .env("ROVAI_MANAGED_PROCESS_HELPER_FILE", pid_file);
                run_bounded_command(
                    &mut command,
                    ProbeCommandLimits {
                        deadline: Duration::from_secs(1),
                        stdout_bytes: 1024,
                        stderr_bytes: 1024,
                        cleanup_timeout: Duration::from_secs(1),
                    },
                )
                .await
            }
        });
        // OS process startup is not the timeout under test. A blocking handshake
        // inhibits Tokio's automatic clock advance until the descendant exists.
        let descendant_pid = tokio::task::spawn_blocking(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(20);
            loop {
                if let Ok(value) = std::fs::read_to_string(&pid_file)
                    && let Ok(pid) = value.trim().parse::<u32>()
                {
                    break pid;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "batch descendant PID was not published"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
        })
        .await
        .unwrap();
        tokio::time::resume();
        let error = task
            .await
            .unwrap()
            .expect_err("bounded batch probe must time out");
        assert!(error.to_string().contains("runtime_probe_timed_out"));
        let gone = tokio::time::timeout(Duration::from_secs(2), async {
            while windows_process_is_running(descendant_pid) {
                tokio::task::yield_now().await;
            }
        })
        .await;
        assert!(gone.is_ok(), "timed-out batch descendant must be gone");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    fn windows_process_is_running(pid: u32) -> bool {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, WAIT_TIMEOUT},
            System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
        };

        let process = unsafe {
            // SAFETY: the PID was written by the exact descendant created by the fixture.
            OpenProcess(PROCESS_SYNCHRONIZE, 0, pid)
        };
        if process.is_null() {
            return false;
        }
        let running = unsafe {
            // SAFETY: `process` is a valid synchronization handle until closed below.
            WaitForSingleObject(process, 0) == WAIT_TIMEOUT
        };
        unsafe {
            // SAFETY: `process` is owned by this function and closed exactly once.
            CloseHandle(process);
        }
        running
    }

    #[tokio::test]
    async fn protocol_reader_bounds_only_the_current_complete_frame() {
        // Large legal JSON must survive both former probe thresholds and the
        // exact default boundary; parsing borrows the payload instead of copying it.
        for size in [
            300 * 1024,
            1024 * 1024,
            4 * 1024 * 1024 + 1,
            DEFAULT_PROTOCOL_FRAME_BYTES - 1,
            DEFAULT_PROTOCOL_FRAME_BYTES,
        ] {
            let mut input = vec![b'a'; size + 2];
            input[0] = b'"';
            input[size - 1] = b'"';
            input[size] = b'\r';
            input[size + 1] = b'\n';
            let mut reader = BoundedLineReader::new(input.as_slice(), DEFAULT_PROTOCOL_FRAME_BYTES);
            let line = reader.next_line().await.unwrap().unwrap();
            assert_eq!(line.len(), size);
            assert_eq!(serde_json::from_str::<&str>(&line).unwrap().len(), size - 2);
            assert!(!reader.truncated());
            drop(line);
            assert!(reader.next_line().await.unwrap().is_none());
        }
        // A single read can contain several frames; cumulative consumption has no cap.
        let input = format!("\"{}\"\n", "a".repeat(256 * 1024 - 2)).repeat(20);
        let mut reader = BoundedLineReader::new(input.as_bytes(), 256 * 1024);
        for _ in 0..20 {
            assert_eq!(reader.next_line().await.unwrap().unwrap().len(), 256 * 1024);
        }
        assert!(reader.next_line().await.unwrap().is_none());

        // All UTF-8 and CRLF split positions, plus multiple lines in one buffer.
        for chunk in 1..=16 {
            for delimiter in ["\n", "\r\n", ""] {
                let input = format!("\"花💐\"{delimiter}");
                let size = "\"花💐\"".len();
                for limit in [size - 1, size, size + 1] {
                    let mut reader = BoundedLineReader::new(input.as_bytes(), limit);
                    reader.reader = BufReader::with_capacity(chunk, input.as_bytes());
                    let result = reader.next_line().await;
                    if limit < size {
                        assert!(
                            result
                                .unwrap_err()
                                .to_string()
                                .contains("runtime_probe_frame_capacity_exceeded")
                        );
                        assert!(reader.truncated());
                    } else {
                        assert_eq!(result.unwrap().unwrap(), "\"花💐\"");
                        assert!(reader.next_line().await.unwrap().is_none());
                    }
                }
            }
        }
        let mut reader = BoundedLineReader::new(b"1\n2\r\n3".as_slice(), 1);
        for value in ["1", "2", "3"] {
            assert_eq!(reader.next_line().await.unwrap().unwrap(), value);
        }
        let mut reader = BoundedLineReader::new(b"1\r".as_slice(), 1);
        assert!(
            reader.next_line().await.is_err(),
            "a CR without LF is payload at EOF"
        );
        let mut reader = BoundedLineReader::new(b"\xff\n".as_slice(), 1);
        assert!(
            reader
                .next_line()
                .await
                .unwrap_err()
                .to_string()
                .contains("not_utf8")
        );
        let mut reader = BoundedLineReader::new(tokio::io::repeat(b'x'), 4096);
        let error = timeout(Duration::from_secs(1), reader.next_line())
            .await
            .unwrap()
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("runtime_probe_frame_capacity_exceeded")
        );
        assert!(reader.truncated());

        for invalid in ["", "0", "-1", "not-bytes", "18446744073709551616"] {
            assert!(parse_protocol_frame_bytes(invalid).is_err());
        }
        assert!(parse_protocol_frame_bytes(&isize::MAX.to_string()).is_err());
        let larger = DEFAULT_PROTOCOL_FRAME_BYTES + 1;
        assert_eq!(
            parse_protocol_frame_bytes(&larger.to_string()).unwrap(),
            larger
        );
        let input = vec![b'x'; larger];
        let mut reader = BoundedLineReader::new(input.as_slice(), DEFAULT_PROTOCOL_FRAME_BYTES);
        assert!(reader.next_line().await.is_err());
        let mut reader = BoundedLineReader::new(input.as_slice(), larger);
        assert_eq!(reader.next_line().await.unwrap().unwrap().len(), larger);
    }
}
