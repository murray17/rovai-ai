use super::*;
use std::sync::Mutex as StdMutex;
use tokio::sync::{Semaphore, broadcast, watch};

const REQUEST_CAPACITY: usize = 128;
const EVENT_CAPACITY: usize = 256;
const CONTROL_CAPACITY: usize = 16;

/// A reply from the trusted in-process application seam. Domain errors retain
/// their structured transport body; transport loss does not imply non-execution.
#[derive(Debug)]
pub struct CoreReply {
    pub result: Option<Value>,
    pub error: Option<Value>,
}

/// Only the process owner installs this local control capability. Public Web
/// requests never enter this seam; its operations are deliberately closed.
#[derive(Clone, Copy)]
pub enum HostWebOperation {
    Status,
    Start,
    Stop,
    Rotate,
}

pub struct HostControlError {
    pub code: &'static str,
    pub message: String,
}

pub type HostControlFuture<'a> = std::pin::Pin<
    Box<dyn Future<Output = std::result::Result<Value, HostControlError>> + Send + 'a>,
>;

pub trait HostControl: Send + Sync {
    fn web(&self, operation: HostWebOperation, params: Value) -> HostControlFuture<'_>;
}

/// Trusted Rust host capability, not a network RPC surface. The Host must apply
/// its closed operation mapping and verified caller policy before invoking it.
/// Dropping a request future or an event receiver never cancels admitted work.
#[derive(Clone)]
pub struct CoreService {
    requests: mpsc::Sender<Request>,
    control: mpsc::Sender<Request>,
    control_capacity: Arc<Semaphore>,
    output: Arc<EmbeddedOutput>,
    capacity: Arc<Semaphore>,
}

impl CoreService {
    pub fn startup(&self) -> watch::Receiver<Value> {
        self.output.startup.subscribe()
    }

    /// Subscriptions are bounded. A lag error requires a new authorized snapshot;
    /// consumers must never treat dropped invalidations as a continuous stream.
    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.output.events.subscribe()
    }

    pub async fn wait_ready(&self) -> Result<Value> {
        let mut startup = self.startup();
        loop {
            let frame = startup.borrow_and_update().clone();
            match frame.get("status").and_then(Value::as_str) {
                Some("ready") => return Ok(frame),
                Some("blocked" | "failed" | "stopped") => {
                    anyhow::bail!("Core authority is unavailable: {frame}");
                }
                _ => startup
                    .changed()
                    .await
                    .context("Core startup channel closed")?,
            }
        }
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<CoreReply> {
        self.request_for_editor(
            method,
            params,
            rovai_core::draft_client::DraftClient::default(),
        )
        .await
    }

    pub async fn request_for_editor(
        &self,
        method: &str,
        params: Value,
        client: rovai_core::draft_client::DraftClient,
    ) -> Result<CoreReply> {
        let (ingress, capacity) = if is_control_request(method) {
            (&self.control, &self.control_capacity)
        } else {
            (&self.requests, &self.capacity)
        };
        let permit = capacity
            .clone()
            .acquire_owned()
            .await
            .context("Core admission closed")?;
        if self
            .output
            .startup
            .borrow()
            .get("status")
            .and_then(Value::as_str)
            != Some("ready")
        {
            anyhow::bail!("Core authority is not ready");
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (reply, receiver) = oneshot::channel();
        self.output
            .pending
            .lock()
            .expect("Core reply registry poisoned")
            .insert(
                id.clone(),
                PendingReply {
                    reply,
                    _permit: permit,
                },
            );
        let mut registration = PendingRegistration {
            output: self.output.clone(),
            id: id.clone(),
            admitted: false,
        };
        ingress
            .send(Request {
                client,
                id: Value::String(id),
                method: method.to_string(),
                params,
            })
            .await
            .context("Core request ingress closed")?;
        registration.admitted = true;
        receiver.await.context(
            "Core reply unavailable; reconcile admitted commands by their original commandId",
        )
    }
}

struct PendingRegistration {
    output: Arc<EmbeddedOutput>,
    id: String,
    admitted: bool,
}

impl Drop for PendingRegistration {
    fn drop(&mut self) {
        // An admitted command owns its quota until Core settles it, even when
        // the HTTP caller disconnects. Only unsubmitted calls release it here.
        if self.admitted {
            return;
        }
        self.output
            .pending
            .lock()
            .expect("Core reply registry poisoned")
            .remove(&self.id);
    }
}

struct PendingReply {
    reply: oneshot::Sender<CoreReply>,
    _permit: tokio::sync::OwnedSemaphorePermit,
}

pub(super) struct EmbeddedOutput {
    pending: StdMutex<HashMap<String, PendingReply>>,
    startup: watch::Sender<Value>,
    events: broadcast::Sender<Value>,
}

impl EmbeddedOutput {
    fn publish(&self, mut frame: Value) -> bool {
        if frame.get("kind").and_then(Value::as_str) == Some("core_startup") {
            self.startup.send_replace(frame);
        } else if let Some(id) = frame.get("id").and_then(Value::as_str) {
            let reply = self
                .pending
                .lock()
                .expect("Core reply registry poisoned")
                .remove(id);
            if let Some(reply) = reply {
                let _ = reply.reply.send(CoreReply {
                    result: frame.get_mut("result").map(Value::take),
                    error: frame.get_mut("error").map(Value::take),
                });
                return true;
            }
        } else if frame.get("id").is_none() {
            // No subscriber is normal (e.g. a disconnected browser). Core work
            // proceeds independently of observation.
            let _ = self.events.send(frame);
        }
        false
    }

    fn finish(&self) {
        self.pending
            .lock()
            .expect("Core reply registry poisoned")
            .clear();
        let status = self
            .startup
            .borrow()
            .get("status")
            .and_then(Value::as_str)
            .map(str::to_string);
        if !matches!(status.as_deref(), Some("blocked" | "failed")) {
            self.startup.send_replace(
                json!({"kind":"core_startup", "schemaVersion":1, "status":"stopped"}),
            );
        }
    }
}

/// The unique runner returned alongside its service handle. The embedding Host
/// owns and awaits `run`; Web listener lifetime does not own this value.
pub struct CoreRunner {
    config: CoreConfig,
    environment: Arc<RuntimeSearchEnvironment>,
    requests: mpsc::Receiver<Request>,
    control: mpsc::Receiver<Request>,
    output: Arc<EmbeddedOutput>,
    completion: RunnerCompletion,
    desktop_stdio: bool,
    host_control: Option<Arc<dyn HostControl>>,
}

struct RunnerCompletion(Arc<EmbeddedOutput>);

impl Drop for RunnerCompletion {
    fn drop(&mut self) {
        self.0.finish();
    }
}

impl CoreRunner {
    /// Adds the original Desktop pipe to this same Core owner. EOF retains the
    /// legacy parent-loss semantics; Web cannot keep a dead Desktop alive.
    pub fn with_desktop_stdio(mut self, control: Arc<dyn HostControl>) -> Self {
        self.desktop_stdio = true;
        self.host_control = Some(control);
        self
    }

    pub async fn run(self) -> Result<()> {
        // The completion guard is also owned by an unpolled runner, so callers
        // never wait forever when a host abandons startup before spawning it.
        let _completion = self.completion;
        let input = if self.desktop_stdio {
            CoreInput::Desktop {
                lines: BufReader::new(tokio::io::stdin()).lines(),
                requests: self.requests,
                control: self.control,
            }
        } else {
            CoreInput::Embedded {
                requests: self.requests,
                control: self.control,
            }
        };
        let output = if self.desktop_stdio {
            OutputTarget::Desktop(self.output)
        } else {
            OutputTarget::Embedded(self.output)
        };
        run_core(
            self.config,
            self.environment,
            Instant::now(),
            input,
            output,
            self.host_control,
        )
        .await
    }
}

/// Creates a single runner and a clonable trusted service handle without opening
/// any database or spawning another process. Capture the runtime search snapshot
/// before starting Tokio, as the Desktop adapter does.
pub fn embedded(
    config: CoreConfig,
    environment: Arc<RuntimeSearchEnvironment>,
) -> Result<(CoreService, CoreRunner)> {
    config.validate()?;
    let (requests, receiver) = mpsc::channel(REQUEST_CAPACITY);
    let (control, control_receiver) = mpsc::channel(CONTROL_CAPACITY);
    let (startup, _) =
        watch::channel(json!({"kind":"core_startup", "schemaVersion":1, "status":"starting"}));
    let (events, _) = broadcast::channel(EVENT_CAPACITY);
    let output = Arc::new(EmbeddedOutput {
        pending: StdMutex::new(HashMap::new()),
        startup,
        events,
    });
    Ok((
        CoreService {
            requests,
            control,
            control_capacity: Arc::new(Semaphore::new(CONTROL_CAPACITY)),
            output: output.clone(),
            capacity: Arc::new(Semaphore::new(REQUEST_CAPACITY)),
        },
        CoreRunner {
            config,
            environment,
            requests: receiver,
            control: control_receiver,
            completion: RunnerCompletion(output.clone()),
            output,
            desktop_stdio: false,
            host_control: None,
        },
    ))
}

fn is_control_request(method: &str) -> bool {
    matches!(
        method,
        "core.shutdown"
            | "campTurns.cancel"
            | "agentRuns.cancel"
            | "singleChat.end"
            | "runtime.pendingExecution.cancel"
            | "action.approvals.resolve"
            | "channels.executionConsole.agentRun.cancel"
            | "channels.dingtalk.executionConsole.agentRun.cancel"
    )
}

pub(super) enum CoreInput {
    Stdio(tokio::io::Lines<BufReader<tokio::io::Stdin>>),
    Desktop {
        lines: tokio::io::Lines<BufReader<tokio::io::Stdin>>,
        requests: mpsc::Receiver<Request>,
        control: mpsc::Receiver<Request>,
    },
    Embedded {
        requests: mpsc::Receiver<Request>,
        control: mpsc::Receiver<Request>,
    },
}

impl CoreInput {
    pub(super) async fn next_request(&mut self) -> Result<Option<Request>> {
        match self {
            Self::Desktop {
                lines,
                requests,
                control,
            } => {
                tokio::select! {
                    biased;
                    // Parent EOF must win even if a remote caller keeps sending.
                    request = read_stdio_request(lines) => request,
                    request = control.recv(), if !control.is_closed() || !control.is_empty() => Ok(request),
                    request = requests.recv(), if !requests.is_closed() || !requests.is_empty() => Ok(request),
                }
            }
            Self::Embedded { requests, control } => {
                tokio::select! {
                    biased;
                    request = control.recv() => match request {
                        Some(request) => Ok(Some(request)),
                        None => Ok(requests.recv().await),
                    },
                    request = requests.recv() => match request {
                        Some(request) => Ok(Some(request)),
                        None => Ok(control.recv().await),
                    },
                }
            }
            Self::Stdio(lines) => read_stdio_request(lines).await,
        }
    }
}

async fn read_stdio_request(
    lines: &mut tokio::io::Lines<BufReader<tokio::io::Stdin>>,
) -> Result<Option<Request>> {
    loop {
        let line = match lines.next_line().await {
            Ok(Some(line)) => line,
            Ok(None) => return Ok(None),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                tokio::time::sleep(Duration::from_millis(5)).await;
                continue;
            }
            Err(error) => return Err(error).context("failed reading Core stdin"),
        };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Request>(&line) {
            Ok(request) => return Ok(Some(request)),
            Err(error) => eprintln!("invalid request: {error}"),
        }
    }
}

#[derive(Clone)]
pub(super) enum OutputTarget {
    Stdio,
    Desktop(Arc<EmbeddedOutput>),
    Embedded(Arc<EmbeddedOutput>),
}

impl OutputTarget {
    pub(super) fn startup(&self, frame: Value) -> Result<()> {
        match self {
            Self::Stdio | Self::Desktop(_) => {
                if let Self::Desktop(output) = self {
                    output.publish(frame.clone());
                }
                use std::io::Write as _;
                let stdout = std::io::stdout();
                let mut output = stdout.lock();
                serde_json::to_writer(&mut output, &frame)?;
                output.write_all(b"\n")?;
                output.flush()?;
            }
            Self::Embedded(output) => {
                output.publish(frame);
            }
        }
        Ok(())
    }

    pub(super) async fn write_line(
        &self,
        stdout: &mut BufWriter<tokio::io::Stdout>,
        line: &str,
    ) -> Result<()> {
        match self {
            Self::Stdio | Self::Desktop(_) => {
                if let Self::Desktop(output) = self {
                    // A Web reply is delivered only to its registered waiter.
                    // Forwarding it to Desktop would leak another client's draft.
                    if output
                        .publish(serde_json::from_str(line).context("invalid Core output frame")?)
                    {
                        return Ok(());
                    }
                }
                stdout.write_all(line.as_bytes()).await?;
                stdout.write_all(b"\n").await?;
                stdout.flush().await?;
            }
            Self::Embedded(output) => {
                output.publish(serde_json::from_str(line).context("invalid Core output frame")?);
            }
        }
        Ok(())
    }

    pub(super) async fn flush(&self, stdout: &mut BufWriter<tokio::io::Stdout>) -> Result<()> {
        if matches!(self, Self::Stdio | Self::Desktop(_)) {
            stdout
                .flush()
                .await
                .context("failed to flush Core stdout")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // No authority, Skill Library, process, or Runtime is opened by these tests.
    // This owner covers the new in-process transport lifetime, which the existing
    // stdio subprocess tests cannot exercise.
    fn transport() -> (CoreService, CoreRunner) {
        let root = std::env::temp_dir().join("rovai-in-process-transport-no-io");
        embedded(
            CoreConfig {
                data_dir: root.join("data"),
                skill_library_root: root.join("skills"),
                runtime_camp_files_root: root.join("files"),
                mcp_config_path: Some(root.join("mcp.json")),
                require_existing_authority: false,
                automation_scheduler_control: None,
                removed_skill_project_roots: RemovedSkillProjectRoots::default(),
            },
            Arc::new(RuntimeSearchEnvironment::for_test_paths(1, Vec::new())),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn dropped_waiter_preserves_admission_and_replies_remain_correlated() {
        let (service, mut runner) = transport();
        runner
            .output
            .publish(json!({"kind":"core_startup", "status":"ready"}));
        let first_service = service.clone();
        let first = tokio::spawn(async move {
            first_service
                .request("first", json!({"commandId":"original"}))
                .await
        });
        let admitted = runner.requests.recv().await.unwrap();
        first.abort();
        let _ = first.await;
        assert_eq!(admitted.params["commandId"], "original");
        assert_eq!(runner.output.pending.lock().unwrap().len(), 1);
        assert_eq!(service.capacity.available_permits(), REQUEST_CAPACITY - 1);
        // Core can still settle and publish a reply after the caller disconnects.
        runner
            .output
            .publish(json!({"id":admitted.id, "result":"settled"}));

        // Ordinary in-flight work cannot consume the cancellation/approval quota.
        let all_ordinary = service
            .capacity
            .clone()
            .acquire_many_owned(REQUEST_CAPACITY as u32)
            .await
            .unwrap();
        let control_service = service.clone();
        let control_call = tokio::spawn(async move {
            control_service
                .request("agentRuns.cancel", json!({"agentRunId":"exact"}))
                .await
        });
        let control = runner.control.recv().await.unwrap();
        assert_eq!(control.params["agentRunId"], "exact");
        runner
            .output
            .publish(json!({"id":control.id, "result":true}));
        assert_eq!(
            control_call.await.unwrap().unwrap().result,
            Some(json!(true))
        );
        drop(all_ordinary);

        let next_service = service.clone();
        let next = tokio::spawn(async move { next_service.request("next", Value::Null).await });
        let next_request = runner.requests.recv().await.unwrap();
        let last = tokio::spawn(async move { service.request("last", Value::Null).await });
        let last_request = runner.requests.recv().await.unwrap();
        // Existing independent channels may finish out of order. Transport IDs
        // must route each outcome to its own waiter without changing command IDs.
        runner
            .output
            .publish(json!({"id":last_request.id, "error":{"code":"domain_rejected"}}));
        runner
            .output
            .publish(json!({"id":next_request.id, "result":17}));
        assert_eq!(next.await.unwrap().unwrap().result, Some(json!(17)));
        assert_eq!(
            last.await.unwrap().unwrap().error.unwrap()["code"],
            "domain_rejected"
        );
        assert!(runner.output.pending.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn abandoned_startup_closes_waiters_and_slow_events_report_a_gap() {
        for blocked in [false, true] {
            let (service, runner) = transport();
            if blocked {
                runner.output.publish(json!({"kind":"core_startup", "status":"blocked", "authorityState":{"kind":"owned_by_active_core"}}));
            }
            drop(runner);
            assert!(service.wait_ready().await.is_err());
            assert_eq!(
                service.startup().borrow()["status"],
                if blocked { "blocked" } else { "stopped" }
            );
            assert!(service.request("members.list", Value::Null).await.is_err());
        }
        let (service, runner) = transport();
        let mut events = service.subscribe();
        // Capacity + 1 deliberately crosses the finite retention window once.
        for sequence in 0..=EVENT_CAPACITY {
            runner
                .output
                .publish(json!({"method":"changed", "sequence":sequence}));
        }
        assert!(matches!(
            events.recv().await,
            Err(broadcast::error::RecvError::Lagged(1))
        ));
        assert_eq!(events.recv().await.unwrap()["sequence"], 1);
    }
}
