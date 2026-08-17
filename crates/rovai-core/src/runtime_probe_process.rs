use std::{
    io,
    process::{ExitStatus, Stdio},
    time::Duration,
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use anyhow::{Context, Result, anyhow, bail};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    task::JoinHandle,
    time::{Instant, timeout, timeout_at},
};

pub const DEFAULT_CAPTURE_LIMIT: usize = 64 * 1024;
pub const DEFAULT_LINE_LIMIT: usize = 256 * 1024;
pub const DEFAULT_CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);

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
    configure_probe_command(command, false);
    let mut child = command.spawn().context("runtime_probe_spawn_failed")?;
    let process_group_id = process_group_id(&child);
    let mut tree_guard = ProcessTreeGuard::new(process_group_id);
    let stdout = child
        .stdout
        .take()
        .context("runtime_probe_stdout_unavailable")?;
    let stderr = child
        .stderr
        .take()
        .context("runtime_probe_stderr_unavailable")?;
    let mut stdout_task = tokio::spawn(read_bounded(stdout, limits.stdout_bytes));
    let mut stderr_task = tokio::spawn(read_bounded(stderr, limits.stderr_bytes));
    let deadline = Instant::now() + limits.deadline;

    let status = match timeout_at(deadline, child.wait()).await {
        Ok(result) => result.context("runtime_probe_wait_failed")?,
        Err(_) => {
            terminate_process_tree(&mut child, process_group_id, limits.cleanup_timeout).await;
            tree_guard.disarm();
            abort_reader(&mut stdout_task).await;
            abort_reader(&mut stderr_task).await;
            bail!("runtime_probe_timed_out");
        }
    };

    // A successful leader can leave descendants holding inherited stdio. Always terminate the
    // probe-owned group before waiting for readers so completion remains bounded.
    terminate_process_tree(&mut child, process_group_id, limits.cleanup_timeout).await;
    tree_guard.disarm();
    let stdout = join_reader(&mut stdout_task, limits.cleanup_timeout, "stdout").await?;
    let stderr = join_reader(&mut stderr_task, limits.cleanup_timeout, "stderr").await?;
    Ok(BoundedCommandOutput {
        status,
        stdout,
        stderr,
    })
}

pub struct RuntimeProbeProcess {
    child: Child,
    process_group_id: Option<i32>,
    stdin: Option<ChildStdin>,
    stdout: Option<BoundedLineReader<ChildStdout>>,
    stderr_task: Option<JoinHandle<io::Result<BoundedCapture>>>,
    cleanup_timeout: Duration,
    cleaned: bool,
}

struct ProcessTreeGuard {
    process_group_id: Option<i32>,
    armed: bool,
}

impl ProcessTreeGuard {
    fn new(process_group_id: Option<i32>) -> Self {
        Self {
            process_group_id,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for ProcessTreeGuard {
    fn drop(&mut self) {
        if self.armed {
            kill_process_group(self.process_group_id);
        }
    }
}

impl RuntimeProbeProcess {
    pub fn spawn(
        command: &mut Command,
        stdout_bytes: usize,
        stderr_bytes: usize,
        max_line_bytes: usize,
        cleanup_timeout: Duration,
    ) -> Result<Self> {
        configure_probe_command(command, true);
        let mut child = command.spawn().context("runtime_probe_spawn_failed")?;
        let process_group_id = process_group_id(&child);
        let stdin = child
            .stdin
            .take()
            .context("runtime_probe_stdin_unavailable")?;
        let stdout = child
            .stdout
            .take()
            .context("runtime_probe_stdout_unavailable")?;
        let stderr = child
            .stderr
            .take()
            .context("runtime_probe_stderr_unavailable")?;
        Ok(Self {
            child,
            process_group_id,
            stdin: Some(stdin),
            stdout: Some(BoundedLineReader::new(stdout, stdout_bytes, max_line_bytes)),
            stderr_task: Some(tokio::spawn(read_bounded(stderr, stderr_bytes))),
            cleanup_timeout,
            cleaned: false,
        })
    }

    pub fn stdin_mut(&mut self) -> Result<&mut ChildStdin> {
        self.stdin
            .as_mut()
            .context("runtime_probe_stdin_unavailable")
    }

    pub fn stdout_mut(&mut self) -> Result<&mut BoundedLineReader<ChildStdout>> {
        self.stdout
            .as_mut()
            .context("runtime_probe_stdout_unavailable")
    }

    pub fn split_io(&mut self) -> Result<(&mut ChildStdin, &mut BoundedLineReader<ChildStdout>)> {
        match (&mut self.stdin, &mut self.stdout) {
            (Some(stdin), Some(stdout)) => Ok((stdin, stdout)),
            _ => bail!("runtime_probe_stdio_unavailable"),
        }
    }

    pub async fn finish(mut self) -> Result<BoundedCapture> {
        self.stdin.take();
        self.stdout.take();
        terminate_process_tree(&mut self.child, self.process_group_id, self.cleanup_timeout).await;
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
        kill_process_group(self.process_group_id);
        let _ = self.child.start_kill();
        if let Some(task) = self.stderr_task.take() {
            task.abort();
        }
    }
}

pub struct BoundedLineReader<R> {
    reader: BufReader<R>,
    total_limit: usize,
    max_line_bytes: usize,
    observed_bytes: usize,
    truncated: bool,
}

impl<R: AsyncRead + Unpin> BoundedLineReader<R> {
    pub fn new(reader: R, total_limit: usize, max_line_bytes: usize) -> Self {
        Self {
            reader: BufReader::new(reader),
            total_limit,
            max_line_bytes,
            observed_bytes: 0,
            truncated: false,
        }
    }

    pub fn truncated(&self) -> bool {
        self.truncated
    }

    pub async fn next_line(&mut self) -> io::Result<Option<String>> {
        let mut line = Vec::new();
        loop {
            let available = self.reader.fill_buf().await?;
            if available.is_empty() {
                if line.is_empty() {
                    return Ok(None);
                }
                return decode_line(line).map(Some);
            }
            let newline = available.iter().position(|byte| *byte == b'\n');
            let consumed = newline.map_or(available.len(), |index| index + 1);
            self.observed_bytes = self.observed_bytes.saturating_add(consumed);
            if self.observed_bytes > self.total_limit {
                self.truncated = true;
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "runtime_probe_stdout_limit_exceeded",
                ));
            }
            let content_len = newline.unwrap_or(consumed);
            if line.len().saturating_add(content_len) > self.max_line_bytes {
                self.truncated = true;
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "runtime_probe_line_limit_exceeded",
                ));
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

fn configure_probe_command(command: &mut Command, interactive: bool) {
    command
        .stdin(if interactive {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.as_std_mut().process_group(0);
}

fn process_group_id(child: &Child) -> Option<i32> {
    child.id().and_then(|pid| i32::try_from(pid).ok())
}

fn kill_process_group(process_group_id: Option<i32>) {
    #[cfg(unix)]
    if let Some(process_group_id) = process_group_id.filter(|value| *value > 1) {
        // SAFETY: the ID comes from a child placed in a fresh process group immediately before
        // spawn. It cannot name Rovai's group or a caller-owned group.
        unsafe {
            libc::killpg(process_group_id, libc::SIGKILL);
        }
    }
    #[cfg(not(unix))]
    let _ = process_group_id;
}

async fn terminate_process_tree(
    child: &mut Child,
    process_group_id: Option<i32>,
    cleanup_timeout: Duration,
) {
    kill_process_group(process_group_id);
    let _ = child.start_kill();
    let _ = timeout(cleanup_timeout, child.wait()).await;
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
            run_bounded_command(
                &mut command,
                ProbeCommandLimits::new(Duration::from_secs(30)),
            )
            .await
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

    #[tokio::test]
    async fn bounded_reader_reports_truncation_before_allocating_past_limit() {
        let input = vec![b'a'; 4097];
        let mut reader = BoundedLineReader::new(input.as_slice(), 4096, 4096);
        let error = reader.next_line().await.expect_err("input must be bounded");
        assert_eq!(error.to_string(), "runtime_probe_stdout_limit_exceeded");
        assert!(reader.truncated());
    }
}
