//! Native Cline Hub transport. This module does not implement or translate ACP.
mod auth;
mod config;
mod events;
mod failure;
mod login;
mod platform;
#[cfg(all(test, feature = "extended-tests"))]
mod tests;
mod transport;

use crate::{
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig},
    builtin_tool_runtime::BuiltinToolProcessConfig,
    context::PreparedSessionBootstrap,
    managed_process::ManagedProcess,
    mcp::McpServerDefinition,
    runtime_fleet::{
        AgentRuntimeFleetManager, FleetAcquireRequest, FleetReleaseDisposition,
        RuntimeCompatibilityKey, RuntimeProcessHost,
    },
};
use anyhow::{Context, Result, bail};
use futures_util::{SinkExt, StreamExt, stream::SplitSink};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        Arc, Weak,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    net::TcpStream,
    sync::{Mutex, RwLock, mpsc, oneshot},
    time::{Instant, timeout, timeout_at},
};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, tungstenite::Message};

pub(crate) const PROTOCOL: &str = "cline-hub-v1";
pub(crate) const APPROVAL_METHOD: &str = "cline-hub/approval.requested";
pub(crate) fn native_configuration_digest() -> Result<String> {
    crate::command::canonical_json_digest(&json!({
        "native":crate::cline::runtime_configuration_digest()?, "rules":config::rules_digest()?
    }))
}
type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;
use failure::HubFailure;
type HubReply = std::result::Result<Value, HubFailure>;
type Pending = oneshot::Sender<HubReply>;

pub(crate) enum HubIncoming {
    Event {
        runtime: Arc<ClineHubRuntime>,
        sequence: u64,
        event: String,
        payload: Value,
    },
    Exited {
        host: String,
        run: String,
        epoch: i64,
    },
    Flushed(oneshot::Sender<()>),
}

pub(crate) struct ClineHubHost {
    id: String,
    executable: PathBuf,
    pid: Option<u32>,
    child: Mutex<ManagedProcess>,
    socket: Mutex<SplitSink<Socket, Message>>,
    pending: Mutex<HashMap<String, Pending>>,
    owner: RwLock<Weak<ClineHubRuntime>>,
    incoming: mpsc::UnboundedSender<HubIncoming>,
    alive: AtomicBool,
    root: PathBuf,
    session_config: Value,
    models: Vec<crate::agent_profile::ModelDescriptor>,
    auth_lease: Mutex<Option<auth::NativeAuthLease>>,
    native_account: bool,
    sessions: Mutex<HashMap<String, ()>>,
    builtin_tools: Option<BuiltinToolProcessConfig>,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn owned_discovery(path: &Path, root: &Path) -> Result<Value> {
    let meta = std::fs::symlink_metadata(path)?;
    if !meta.is_file()
        || meta.file_type().is_symlink()
        || !path.canonicalize()?.starts_with(root.canonicalize()?)
    {
        bail!("cline_hub_discovery_not_owned");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.mode() & 0o077 != 0 || meta.uid() != unsafe { libc::geteuid() } {
            bail!("cline_hub_discovery_not_private");
        }
    }
    let value = config::read_json(path)?.context("cline_hub_discovery_missing")?;
    let url = url::Url::parse(
        value["url"]
            .as_str()
            .context("cline_hub_discovery_invalid")?,
    )?;
    if url.scheme() != "ws"
        || url.host_str() != Some("127.0.0.1")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/hub"
        || value["host"] != "127.0.0.1"
        || url.port().map(u64::from) != value["port"].as_u64()
        || value["protocolVersion"] != "v1"
        || value["pid"]
            .as_u64()
            .is_none_or(|pid| pid == 0 || pid > i32::MAX as u64)
        || value["authToken"]
            .as_str()
            .is_none_or(|token| token.is_empty() || token.len() > 4096)
    {
        bail!("cline_hub_discovery_invalid");
    }
    Ok(value)
}

struct HubHostLaunch {
    executable: PathBuf,
    selected_model: Option<String>,
    cwd: PathBuf,
    bootstrap: String,
    servers: BTreeMap<String, McpServerDefinition>,
    builtin_tools: Option<BuiltinToolProcessConfig>,
}

impl ClineHubHost {
    async fn spawn(
        request: &HubHostLaunch,
        root: PathBuf,
        history: PathBuf,
        incoming: mpsc::UnboundedSender<HubIncoming>,
    ) -> Result<Arc<Self>> {
        let (child, socket, daemon_pid, configuration) =
            platform::launch(request, &root, &history).await?;
        let (sink, mut source) = socket.split();
        let native_account = configuration.auth_lease.is_some();
        let host = Arc::new(Self {
            id: uuid::Uuid::new_v4().to_string(),
            executable: request.executable.clone(),
            pid: Some(daemon_pid),
            child: Mutex::new(child),
            socket: Mutex::new(sink),
            pending: Mutex::new(HashMap::new()),
            owner: RwLock::new(Weak::new()),
            incoming,
            alive: AtomicBool::new(true),
            root,
            session_config: configuration.session,
            models: configuration.models,
            auth_lease: Mutex::new(configuration.auth_lease),
            native_account,
            sessions: Mutex::new(HashMap::new()),
            builtin_tools: request.builtin_tools.clone(),
        });
        let read_host = host.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_millis(100));
            let failure = loop {
                tokio::select! {
                    _ = tick.tick() => {
                        let mut child = read_host.child.lock().await;
                        let _ = child.try_wait();
                        if !read_host.is_alive() || !child.owns_live_pid(daemon_pid).unwrap_or(false) {
                            break HubFailure::disconnected();
                        }
                    },
                    frame = source.next() => {
                        let frame = match frame {
                            Some(Ok(frame)) => frame,
                            Some(Err(error)) => break transport::socket_failure(&error),
                            None => break HubFailure::disconnected(),
                        };
                        match frame {
                            Message::Text(text) => {
                                let Ok(frame) = serde_json::from_str::<Value>(&text) else {
                                    break HubFailure::Transport { code: "cline_hub_invalid_json" };
                                };
                                if read_host.receive(frame).await.is_err() {
                                    break HubFailure::Transport { code: "cline_hub_protocol_rejected" };
                                }
                            },
                            Message::Ping(bytes) => {
                                if read_host.socket.lock().await.send(Message::Pong(bytes)).await.is_err() {
                                    break HubFailure::disconnected();
                                }
                            },
                            Message::Pong(_) => {},
                            _ => break HubFailure::disconnected(),
                        }
                    }
                }
            };
            read_host.alive.store(false, Ordering::Release);
            for (_, pending) in read_host.pending.lock().await.drain() {
                let _ = pending.send(Err(failure.clone()));
            }
            if let Some(runtime) = read_host.owner.read().await.upgrade() {
                let _ = read_host.incoming.send(HubIncoming::Exited {
                    host: read_host.id.clone(),
                    run: runtime.run.clone(),
                    epoch: runtime.epoch,
                });
            }
        });
        let registered = host.command("client.register", json!({"clientId":host.id,"clientType":"rovai","displayName":"Rovai","transport":"websocket","capabilities":[]}), None).await;
        if let Err(error) = registered {
            host.shutdown_and_reap().await;
            return Err(error);
        }
        if let Err(error) = host
            .send(json!({"kind":"stream.subscribe","clientId":host.id}))
            .await
        {
            host.shutdown_and_reap().await;
            return Err(error);
        }
        Ok(host)
    }

    async fn send(&self, value: Value) -> Result<()> {
        if !self.is_alive() {
            bail!("cline_hub_disconnected");
        }
        timeout(Duration::from_secs(10), async {
            self.socket
                .lock()
                .await
                .send(Message::Text(transport::encode(&value)?.into()))
                .await
                .map_err(|_| anyhow::anyhow!("cline_hub_send_outcome_unknown"))
        })
        .await
        .context("cline_hub_send_timeout_outcome_unknown")?
    }

    async fn begin(
        &self,
        id: &str,
        command: &str,
        payload: Value,
        session: Option<&str>,
    ) -> Result<oneshot::Receiver<HubReply>> {
        let (tx, rx) = oneshot::channel();
        match self.pending.lock().await.entry(id.to_owned()) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(tx);
            }
            std::collections::hash_map::Entry::Occupied(_) => bail!("cline_hub_duplicate_command"),
        }
        let mut envelope = json!({"version":"v1","requestId":id,"clientId":self.id,"command":command,"payload":payload});
        if let Some(session) = session {
            envelope["sessionId"] = json!(session);
        }
        let sent = self
            .send(json!({"kind":"command","envelope":envelope}))
            .await;
        if let Err(error) = sent {
            self.pending.lock().await.remove(id);
            self.alive.store(false, Ordering::Release);
            return Err(error);
        }
        Ok(rx)
    }

    async fn command(&self, command: &str, payload: Value, session: Option<&str>) -> Result<Value> {
        let id = uuid::Uuid::new_v4().to_string();
        let restores_history = command == "session.create" && payload["initialMessages"].is_array();
        let rx = self
            .begin(&id, command, payload, session)
            .await
            .map_err(|error| {
                if restores_history
                    && matches!(
                        error.downcast_ref::<HubFailure>(),
                        Some(HubFailure::LocalLimit { .. })
                    )
                {
                    anyhow::Error::new(crate::runtime_failure::RuntimeFailureError::new(
                        HubFailure::LocalLimit {
                            code: "cline_hub_history_restore_limit_exceeded",
                        }
                        .public_view(),
                    ))
                } else {
                    error
                }
            })?;
        let result = timeout(Duration::from_secs(45), rx).await;
        self.pending.lock().await.remove(&id);
        match result {
            Ok(Ok(result)) => result.map_err(|failure| {
                if command == "session.messages"
                    && matches!(
                        failure,
                        HubFailure::Transport {
                            code: "cline_hub_message_limit_exceeded"
                        }
                    )
                {
                    HubFailure::Transport {
                        code: "cline_hub_history_limit_exceeded",
                    }
                    .into()
                } else {
                    failure.into()
                }
            }),
            _ => {
                self.alive.store(false, Ordering::Release);
                bail!("cline_hub_command_outcome_unknown");
            }
        }
    }

    async fn receive(&self, frame: Value) -> Result<()> {
        let envelope = &frame["envelope"];
        match frame["kind"].as_str() {
            Some("reply") => {
                let id = envelope["requestId"]
                    .as_str()
                    .context("cline_hub_reply_without_identity")?;
                if let Some(pending) = self.pending.lock().await.remove(id) {
                    let result = match envelope["ok"].as_bool() {
                        Some(true) => Ok(envelope["payload"].clone()),
                        Some(false) => Err(HubFailure::native(&envelope["error"])),
                        None => Err(HubFailure::Transport {
                            code: "cline_hub_invalid_reply",
                        }),
                    };
                    let _ = pending.send(result);
                }
            }
            Some("event") => {
                let Some(runtime) = self.owner.read().await.upgrade() else {
                    return Ok(());
                };
                if envelope["sessionId"].as_str() != Some(runtime.session.as_str())
                    || !runtime.submitted.load(Ordering::Acquire)
                {
                    return Ok(());
                }
                let event = envelope["event"]
                    .as_str()
                    .context("cline_hub_event_without_kind")?;
                let payload = envelope["payload"].clone();
                if event == "capability.requested" {
                    runtime.hook(&payload).await?;
                    // Hook response is always observational. No context/control
                    // fields, replacement compressor or model request mutation.
                    self.send(json!({"kind":"command","envelope":{"version":"v1","clientId":self.id,"requestId":uuid::Uuid::new_v4().to_string(),"command":"capability.respond","sessionId":runtime.session,"payload":{"requestId":payload["requestId"],"ok":true,"payload":{}}}})).await?;
                } else if runtime.native_run.read().await.is_some()
                    && !matches!(
                        event,
                        "run.started"
                            | "run.completed"
                            | "run.failed"
                            | "run.aborted"
                            | "usage.updated"
                    )
                {
                    if event == "approval.requested" {
                        let approval = payload["approvalId"]
                            .as_str()
                            .filter(|id| !id.is_empty())
                            .context("cline_hub_approval_missing_id")?;
                        let tool = payload["toolCallId"]
                            .as_str()
                            .filter(|id| !id.is_empty())
                            .context("cline_hub_approval_missing_tool")?;
                        let mut pending = runtime.approvals.lock().await;
                        if pending.len() >= 1024 || pending.contains_key(approval) {
                            bail!("cline_hub_approval_identity_invalid");
                        }
                        pending.insert(approval.into(), tool.into());
                    }
                    runtime.emit(event, payload);
                }
            }
            // The installed Hub may acknowledge a stream subscription.
            Some("stream.subscribed") => {}
            _ => bail!("cline_hub_invalid_frame"),
        }
        Ok(())
    }

    pub(crate) fn host_instance_id(&self) -> &str {
        &self.id
    }
    pub(crate) fn executable_path(&self) -> &Path {
        &self.executable
    }
    pub(crate) fn pid(&self) -> Option<u32> {
        self.pid
    }
    pub(crate) fn builtin_tool_process_config(&self) -> Option<&BuiltinToolProcessConfig> {
        self.builtin_tools.as_ref()
    }
    pub(crate) fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }
    pub(crate) async fn is_quiescent(&self) -> bool {
        self.is_alive()
            && self.pending.lock().await.is_empty()
            && self.owner.read().await.upgrade().is_none()
    }
    pub(crate) async fn force_reap_until(&self, deadline: Instant) -> bool {
        self.alive.store(false, Ordering::Release);
        let Ok(mut child) = timeout_at(deadline, self.child.lock()).await else {
            return false;
        };
        let _ = child.force_terminate_tree();
        let _ = timeout_at(deadline, child.wait()).await;
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        while Instant::now() < deadline {
            if child.captured_tree_is_empty().unwrap_or(false) {
                let mut lease = self.auth_lease.lock().await;
                if let Some(lease) = lease.as_mut() {
                    if lease.process_absent().is_err() {
                        return false;
                    }
                }
                lease.take();
                let _ = std::fs::remove_dir_all(&self.root);
                return true;
            }
            let _ = child.force_terminate_tree();
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        false
    }
    pub(crate) async fn shutdown_and_reap(&self) {
        self.force_reap_until(Instant::now() + Duration::from_secs(4))
            .await;
    }
}

pub(crate) struct ClineHubRuntime {
    host: Arc<ClineHubHost>,
    run: String,
    camp: String,
    epoch: i64,
    session: String,
    prompt: String,
    delivery: String,
    native_run: RwLock<Option<String>>,
    submitted: AtomicBool,
    observed_model: AtomicBool,
    cancelled: AtomicBool,
    settled: AtomicBool,
    sequence: AtomicU64,
    terminal: RwLock<(Option<String>, Option<String>)>,
    failure: RwLock<Option<HubFailure>>,
    tools: Mutex<HashMap<String, Value>>,
    approvals: Mutex<HashMap<String, String>>,
    denied_tools: Mutex<HashSet<String>>,
    bootstrap: String,
    mode: String,
}

impl ClineHubRuntime {
    fn emit(self: &Arc<Self>, event: &str, payload: Value) {
        let _ = self.host.incoming.send(HubIncoming::Event {
            runtime: self.clone(),
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed),
            event: event.to_owned(),
            payload,
        });
    }
    pub(crate) fn host_instance_id(&self) -> &str {
        &self.host.id
    }
    pub(crate) fn session_id(&self) -> &str {
        &self.session
    }
    pub(crate) fn prompt_id(&self) -> &str {
        &self.prompt
    }
    pub(crate) fn delivery_id(&self) -> &str {
        &self.delivery
    }
    pub(crate) fn run_id(&self) -> &str {
        &self.run
    }
    pub(crate) fn epoch(&self) -> i64 {
        self.epoch
    }
    pub(crate) fn builtin_tool_process_config(&self) -> Option<&BuiltinToolProcessConfig> {
        self.host.builtin_tools.as_ref()
    }
    pub(crate) async fn terminal(&self) -> (Option<String>, Option<String>) {
        self.terminal.read().await.clone()
    }

    pub(crate) async fn terminal_failure(
        &self,
    ) -> Option<crate::runtime_failure::RuntimeFailureView> {
        self.failure
            .read()
            .await
            .as_ref()
            .map(HubFailure::public_view)
    }

    pub(crate) async fn start_prompt(self: &Arc<Self>, text: &str) -> Result<()> {
        if self.submitted.swap(true, Ordering::AcqRel) {
            bail!("cline_hub_input_already_submitted");
        }
        let rx = self
            .host
            .begin(
                &self.prompt,
                "run.start",
                json!({"prompt":text,"mode":self.mode}),
                Some(&self.session),
            )
            .await?;
        let runtime = self.clone();
        tokio::spawn(async move {
            let result = rx.await;
            let (text, mut reason) = match result {
                Ok(Ok(payload)) => {
                    let result = &payload["result"];
                    let reason = match result["finishReason"].as_str() {
                        Some("stop" | "end_turn" | "complete" | "completed") => "stop",
                        Some("aborted" | "cancelled") => "aborted",
                        _ => "failed",
                    };
                    (
                        result["text"]
                            .as_str()
                            .filter(|s| !s.trim().is_empty())
                            .map(str::to_owned),
                        reason,
                    )
                }
                Ok(Err(failure)) => {
                    let reason = if failure.is_native()
                        || matches!(failure, HubFailure::LocalLimit { .. })
                    {
                        "failed"
                    } else {
                        "unknown"
                    };
                    *runtime.failure.write().await = Some(failure);
                    (None, reason)
                }
                Err(_) => {
                    *runtime.failure.write().await = Some(HubFailure::disconnected());
                    (None, "unknown")
                }
            };
            if reason == "stop"
                && (runtime.native_run.read().await.is_none()
                    || !runtime.observed_model.load(Ordering::Acquire))
            {
                reason = "failed";
            }
            *runtime.terminal.write().await = (text, Some(reason.into()));
            runtime.settled.store(true, Ordering::Release);
            runtime.emit("settled", json!({"status":reason}));
        });
        Ok(())
    }

    pub(crate) async fn respond(&self, id: Value, result: Value) -> Result<()> {
        if !self.submitted.load(Ordering::Acquire)
            || self.settled.load(Ordering::Acquire)
            || self.cancelled.load(Ordering::Acquire)
        {
            bail!("cline_hub_approval_fenced");
        }
        let approved = result["approved"]
            .as_bool()
            .context("cline_hub_approval_invalid")?;
        let approval = id.as_str().context("cline_hub_approval_missing_id")?;
        let tool = self
            .approvals
            .lock()
            .await
            .get(approval)
            .cloned()
            .context("cline_hub_approval_fenced")?;
        if !approved {
            self.denied_tools.lock().await.insert(tool);
        }
        self.host
            .command(
                "approval.respond",
                json!({"approvalId":approval,"approved":approved}),
                Some(&self.session),
            )
            .await?;
        self.approvals.lock().await.remove(approval);
        Ok(())
    }
    pub(crate) async fn cancel(&self) -> Result<()> {
        self.cancelled.store(true, Ordering::Release);
        platform::capture_descendants(&mut *self.host.child.lock().await)?;
        self.host
            .command("run.abort", json!({}), Some(&self.session))
            .await?;
        Ok(())
    }
    pub(crate) async fn detach_and_flush_ingress(&self) -> bool {
        let mut owner = self.host.owner.write().await;
        if owner
            .upgrade()
            .is_some_and(|value| value.run == self.run && value.epoch == self.epoch)
        {
            *owner = Weak::new();
        }
        drop(owner);
        let (tx, rx) = oneshot::channel();
        self.host.incoming.send(HubIncoming::Flushed(tx)).is_ok()
            && timeout(Duration::from_secs(3), rx).await.is_ok()
    }
}

pub(crate) struct HubRuntimeRequest<'a> {
    pub run: &'a str,
    pub epoch: i64,
    pub camp: &'a str,
    pub agent: &'a str,
    pub auto_approve: bool,
    pub cwd: &'a Path,
    pub runtime: &'a FrozenAgentRuntimeConfig,
    pub digest: &'a str,
    pub native_session: Option<&'a str>,
    pub delivery: &'a str,
    pub prompt: &'a str,
    pub bootstrap: &'a PreparedSessionBootstrap,
    pub builtin_tools: &'a BuiltinToolProcessConfig,
    pub servers: &'a BTreeMap<String, McpServerDefinition>,
}

pub(crate) struct ClineHubAdapter {
    active: Mutex<HashMap<String, Arc<ClineHubRuntime>>>,
    creation: Mutex<()>,
    root: PathBuf,
    incoming: mpsc::UnboundedSender<HubIncoming>,
    fleet: Arc<AgentRuntimeFleetManager>,
    login: Mutex<Option<Arc<login::Login>>>,
}

impl ClineHubAdapter {
    pub(crate) fn new(
        data: &Path,
        incoming: mpsc::UnboundedSender<HubIncoming>,
        fleet: Arc<AgentRuntimeFleetManager>,
    ) -> Self {
        Self {
            active: Mutex::new(HashMap::new()),
            creation: Mutex::new(()),
            root: data.join("runtime/cline-hub"),
            incoming,
            fleet,
            login: Mutex::new(None),
        }
    }
    pub(crate) fn initialize_storage(&self) -> Result<()> {
        config::private_dir(&self.root.join("hosts"))?;
        #[cfg(target_os = "macos")]
        config::recover_hosts(&self.root.join("hosts"))?;
        Ok(())
    }
    pub(crate) async fn ensure(
        &self,
        request: HubRuntimeRequest<'_>,
    ) -> Result<Arc<ClineHubRuntime>> {
        let _creation = self.creation.lock().await;
        config::private_dir(&self.root.join("hosts"))?;
        if request.runtime.protocol_version != PROTOCOL {
            bail!("cline_hub_backend_mismatch");
        }
        if !matches!(
            request.runtime.permissions.values["mode"].as_str(),
            Some("act" | "plan")
        ) {
            bail!("cline_hub_mode_invalid");
        }
        let existing = self.active.lock().await.get(request.run).cloned();
        if let Some(existing) = existing {
            if existing.epoch > request.epoch {
                bail!("cline_hub_stale_epoch");
            }
            if existing.epoch == request.epoch {
                return Ok(existing);
            }
            self.forget_agent_run(request.run, existing.epoch).await;
        }
        let host_root = self
            .root
            .join("hosts")
            .join(uuid::Uuid::new_v4().to_string());
        let history = self
            .root
            .join("sessions")
            .join(crate::command::canonical_json_digest(&json!([
                request.camp,
                request.agent
            ]))?);
        let launch = HubHostLaunch {
            executable: request.runtime.executable_path.clone().into(),
            selected_model: (request.runtime.model.source == "explicit")
                .then(|| request.runtime.model.model_id.clone()),
            cwd: request.cwd.into(),
            bootstrap: request.bootstrap.payload.clone(),
            servers: request.servers.clone(),
            builtin_tools: Some(request.builtin_tools.clone()),
        };
        let incoming = self.incoming.clone();
        let lease = self
            .fleet
            .acquire(
                FleetAcquireRequest {
                    agent_run_id: request.run.into(),
                    execution_epoch: request.epoch,
                    adapter_kind: AdapterKind::ClineCli,
                    compatibility: RuntimeCompatibilityKey::member(
                        request.camp,
                        request.agent,
                        request.digest,
                    ),
                },
                move || async move {
                    Ok(RuntimeProcessHost::ClineHub(
                        ClineHubHost::spawn(&launch, host_root, history, incoming).await?,
                    ))
                },
            )
            .await?;
        let host = lease.host.into_cline_hub()?;
        let activation = self.activate(&host, &request).await;
        let session = match activation {
            Ok(session) => session,
            Err(error) => {
                self.fleet
                    .release(request.run, request.epoch, FleetReleaseDisposition::Stop)
                    .await;
                return Err(error);
            }
        };
        let runtime = Arc::new(ClineHubRuntime {
            host: host.clone(),
            run: request.run.into(),
            camp: request.camp.into(),
            epoch: request.epoch,
            session,
            prompt: request.prompt.into(),
            delivery: request.delivery.into(),
            native_run: RwLock::new(None),
            submitted: AtomicBool::new(false),
            observed_model: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
            settled: AtomicBool::new(false),
            sequence: AtomicU64::new(1),
            terminal: RwLock::new((None, None)),
            failure: RwLock::new(None),
            tools: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
            denied_tools: Mutex::new(HashSet::new()),
            bootstrap: request.bootstrap.payload.clone(),
            mode: request.runtime.permissions.values["mode"]
                .as_str()
                .context("cline_hub_mode_missing")?
                .to_owned(),
        });
        *host.owner.write().await = Arc::downgrade(&runtime);
        self.active
            .lock()
            .await
            .insert(request.run.into(), runtime.clone());
        Ok(runtime)
    }
    async fn activate(
        &self,
        host: &ClineHubHost,
        request: &HubRuntimeRequest<'_>,
    ) -> Result<String> {
        if !host.is_quiescent().await {
            bail!("cline_hub_host_not_quiescent");
        }
        if let Some(session) = request.native_session {
            if session.is_empty() || session.len() > 512 || session.contains(['/', '\\', '\0']) {
                bail!("cline_hub_session_id_invalid");
            }
            if host.sessions.lock().await.contains_key(session) {
                return Ok(session.into());
            }
        }
        let mut session_config = host.session_config.clone();
        let mut initial_messages = Value::Null;
        if let Some(session) = request.native_session {
            let metadata = host
                .command("session.get", json!({"sessionId":session}), Some(session))
                .await?;
            if metadata["session"]["sessionId"].as_str() != Some(session) {
                bail!("cline_hub_resume_continuity_lost");
            }
            let mut history = host
                .command(
                    "session.messages",
                    json!({"sessionId":session}),
                    Some(session),
                )
                .await?;
            if !history["messages"].is_array() {
                bail!("cline_hub_resume_history_invalid");
            }
            session_config["sessionId"] = json!(session);
            // The official Hub reader owns all history conversion. Reuse its
            // complete messages verbatim, including native compaction rewrites.
            initial_messages = history["messages"].take();
        }
        let auto = request.auto_approve;
        session_config["mode"] = request.runtime.permissions.values["mode"].clone();
        let created = host.command("session.create", json!({"workspaceRoot":request.cwd,"initialMessages":initial_messages,"sessionConfig":session_config,
            "toolPolicies":{"*":{"autoApprove":auto}}, "runtimeOptions":{"configExtensions":["rules","skills","workflows","plugins","hooks"],
            "clientContributions":[{"kind":"hook","name":"beforeRun","capabilityName":"rovai.beforeRun"},{"kind":"hook","name":"beforeModel","capabilityName":"rovai.beforeModel"},{"kind":"hook","name":"afterModel","capabilityName":"rovai.afterModel"}]}}), None).await?;
        let session = created["session"]["sessionId"]
            .as_str()
            .context("cline_hub_session_create_invalid")?;
        if request
            .native_session
            .is_some_and(|expected| expected != session)
        {
            bail!("cline_hub_resume_identity_changed");
        }
        host.sessions.lock().await.insert(session.into(), ());
        Ok(session.into())
    }
    pub(crate) async fn get_agent_run(
        &self,
        run: &str,
        epoch: i64,
    ) -> Option<Arc<ClineHubRuntime>> {
        self.active
            .lock()
            .await
            .get(run)
            .filter(|v| v.epoch == epoch)
            .cloned()
    }
    pub(crate) async fn get_agent_run_on_host(
        &self,
        host: &str,
        run: &str,
        epoch: i64,
    ) -> Option<Arc<ClineHubRuntime>> {
        self.get_agent_run(run, epoch)
            .await
            .filter(|v| v.host.id == host)
    }
    async fn release(&self, run: &str, epoch: i64, reusable: bool) {
        let mut active = self.active.lock().await;
        if !active.get(run).is_some_and(|v| v.epoch == epoch) {
            return;
        }
        let runtime = active.remove(run).unwrap();
        drop(active);
        *runtime.host.owner.write().await = Weak::new();
        let reusable = reusable
            // Until native cross-process refresh is qualified, account Hosts
            // relinquish the credential source only after their whole tree exits.
            && !runtime.host.native_account
            && runtime.settled.load(Ordering::Acquire)
            && runtime.host.is_quiescent().await;
        self.fleet
            .release(
                run,
                epoch,
                if reusable {
                    FleetReleaseDisposition::Reusable
                } else {
                    FleetReleaseDisposition::Stop
                },
            )
            .await;
    }
    pub(crate) async fn complete_agent_run(&self, run: &str, epoch: i64) {
        self.release(run, epoch, true).await;
    }
    pub(crate) async fn forget_agent_run(&self, run: &str, epoch: i64) {
        self.release(run, epoch, false).await;
    }
    pub(crate) async fn shutdown_all(&self) {
        if let Some(login) = self.login.lock().await.take() {
            login.stop().await;
        }
        let runs: Vec<_> = self
            .active
            .lock()
            .await
            .values()
            .map(|v| (v.run.clone(), v.epoch))
            .collect();
        for (run, epoch) in runs {
            self.forget_agent_run(&run, epoch).await;
        }
    }
    pub(crate) async fn forget_camp(&self, camp: &str) {
        let runs: Vec<_> = self
            .active
            .lock()
            .await
            .values()
            .filter(|v| v.camp == camp)
            .map(|v| (v.run.clone(), v.epoch))
            .collect();
        for (run, epoch) in runs {
            self.forget_agent_run(&run, epoch).await;
        }
        self.fleet.invalidate_camp(camp).await;
    }

    pub(crate) async fn start_login(&self, executable: &Path) -> Result<Value> {
        let mut current = self.login.lock().await;
        if current.as_ref().is_some_and(|login| login.running()) {
            bail!("cline_native_login_already_running");
        }
        let login = login::Login::start(
            executable,
            self.root
                .join("hosts")
                .join(format!("login-{}", uuid::Uuid::new_v4())),
        )
        .await?;
        let result = login.view();
        *current = Some(login);
        Ok(result)
    }

    pub(crate) async fn login_interaction(
        &self,
        method: &str,
        id: &str,
        input: Option<&str>,
    ) -> Result<Value> {
        let login = self
            .login
            .lock()
            .await
            .as_ref()
            .filter(|login| login.id == id)
            .cloned()
            .context("cline_native_login_attempt_not_found")?;
        match method {
            "runtime.clineLogin.read" => {}
            "runtime.clineLogin.input" => {
                login
                    .write(input.context("cline_login_input_missing")?)
                    .await?
            }
            "runtime.clineLogin.cancel" => {
                if !login.stop().await {
                    bail!("cline_login_cleanup_unconfirmed");
                }
            }
            _ => bail!("cline_login_method_invalid"),
        }
        Ok(login.view())
    }
}

/// Readiness exercises the selected executable and private authenticated Hub
/// without submitting model input. It is independent of ACP's version gate.
pub(crate) async fn capability_snapshot(
    executable: &Path,
    observed_at: String,
    data_directory: &Path,
) -> Result<(
    crate::agent_profile::AdapterCapabilitySnapshot,
    Option<crate::runtime_failure::RuntimeFailureView>,
)> {
    use crate::agent_runtime_adapter::{AgentRuntimeAdapterRegistry, executable_fingerprint};
    let version = config::native_cli_output(executable, "--version")
        .await
        .ok()
        .and_then(|value| {
            value
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty() && line.len() < 128)
                .map(str::to_owned)
        });
    let mut snapshot = AgentRuntimeAdapterRegistry::default().light_ready_snapshot(
        AdapterKind::ClineCli,
        version,
        executable_fingerprint(executable)?,
        observed_at.clone(),
    )?;
    // Diagnostics can be interrupted by Core exit just like execution. Keep
    // their kernel ownership ledger in the same startup recovery boundary.
    let root = data_directory
        .join("runtime/cline-hub/hosts")
        .join(format!("probe-{}", uuid::Uuid::new_v4()));
    let launch = HubHostLaunch {
        executable: executable.into(),
        selected_model: None,
        cwd: root.clone(),
        bootstrap: "Rovai Cline Hub readiness probe. No model input is submitted.".into(),
        servers: BTreeMap::new(),
        builtin_tools: None,
    };
    let result = async {
        let (incoming,_receiver) = mpsc::unbounded_channel();
        let host = ClineHubHost::spawn(&launch,root.clone(),root.join("history"),incoming).await?;
        let probe = async {
            let created = host.command("session.create",json!({"workspaceRoot":root,"sessionConfig":host.session_config,
                "runtimeOptions":{"configExtensions":["rules","skills","workflows","plugins","hooks"]}}),None).await?;
            let session = created["session"]["sessionId"].as_str().context("cline_hub_probe_missing_session")?;
            host.command("session.get",json!({}),Some(session)).await?;
            let messages = host.command("session.messages",json!({}),Some(session)).await?;
            if !messages["messages"].is_array() { bail!("cline_hub_probe_invalid_history"); }
            Ok::<_,anyhow::Error>(host.models.clone())
        }.await;
        if !host.force_reap_until(Instant::now()+Duration::from_secs(5)).await { bail!("cline_hub_probe_cleanup_unconfirmed"); }
        probe
    }.await;
    let mut failure = None;
    if let Ok(models) = &result {
        snapshot.probe_status = "ready".into();
        snapshot.authentication_status = "authenticated".into();
        snapshot.protocols = vec![PROTOCOL.into()];
        snapshot.native_session_compatibility_key = Some(format!("cline-cli:{PROTOCOL}"));
        snapshot.capabilities = [
            "cline.hub.v1",
            "session.resume",
            "session.load",
            "structured_permission_request",
            "context.charter.managed_system_prompt",
            crate::builtin_tool_transport::BUILTIN_TOOL_RUNTIME_CAPABILITY,
        ]
        .into_iter()
        .map(str::to_owned)
        .collect();
        snapshot.models = models.clone();
        snapshot.last_successful_probe_at = Some(observed_at);
        snapshot.last_error = None;
        let _ = std::fs::remove_dir_all(&root);
    } else if let Err(error) = result {
        let public = failure::probe_failure(&error);
        let requires_auth =
            public.phase == crate::runtime_failure::RuntimeFailurePhase::Authentication;
        snapshot.probe_status = if requires_auth {
            "authentication_required"
        } else {
            "probe_failed"
        }
        .into();
        snapshot.authentication_status = if requires_auth {
            "authentication_required"
        } else {
            "unknown"
        }
        .into();
        snapshot.last_error = Some(public.code.clone());
        failure = Some(public);
        // Ownership ledgers remain available when cleanup is unconfirmed.
    }
    Ok((snapshot, failure))
}
