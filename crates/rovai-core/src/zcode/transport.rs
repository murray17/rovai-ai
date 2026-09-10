//! In-process translation of the official NDJSON protocol into Core's existing
//! session transport. The child is the official App kernel, never an ACP package.

use super::{
    NativeConfig,
    events::{NativeTurnFailure, RUNTIME_HEADERS_UNAVAILABLE, SessionEvents},
};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{
        AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader,
        DuplexStream,
    },
    sync::{Mutex, mpsc, oneshot},
    task::JoinSet,
};

type Writer = Box<dyn AsyncWrite + Unpin + Send>;
type Reply = oneshot::Sender<Result<Value>>;
const FRAME_LIMIT: usize = 4 * 1024 * 1024;

/// Basic native-environment connection check, without model generation.
/// Only cwd and socket/TMPDIR are private; native initialization may write normal
/// state under the user's existing HOME/storage. Credentials remain in memory.
pub async fn probe(
    executable: &std::path::Path,
    include_session: bool,
) -> Result<(Value, Option<Value>, bool)> {
    use crate::managed_process::{
        ManagedProcess, ManagedProcessLaunchSpec, ManagedProcessPurpose, ManagedStdinPolicy,
        ManagedWindowsArgvDialect,
    };
    struct Root(PathBuf);
    impl Drop for Root {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let root = Root(PathBuf::from("/tmp").join(format!("rvzp-{}", uuid::Uuid::new_v4().simple())));
    std::fs::create_dir(&root.0)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&root.0, std::fs::Permissions::from_mode(0o700))?;
    }
    let mut config = NativeConfig::load(&std::env::current_dir()?)?;
    // Native login and BYOK both resolve here. Report setup guidance before spawning.
    config.runtime_model(None)?;
    config.value["mcp"] = json!({"enabled":false,"servers":{}});
    config.value["memory"] = json!({"use":false});
    let mut command = super::command(executable)?;
    command
        .arg("app-server")
        .current_dir(&root.0)
        .env("TMPDIR", &root.0)
        .env_remove("ROVAI_ZCODE_CLI_CONTEXT_DIR")
        .env(
            "ROVAI_ZCODE_OWNER_REPORT",
            root.0.join("owner-cleanup.json"),
        );
    let spec = ManagedProcessLaunchSpec::capture(
        &command,
        ManagedProcessPurpose::RuntimeProbe,
        ManagedStdinPolicy::Piped,
        ManagedWindowsArgvDialect::MicrosoftCrt,
        "zcode-capability-probe",
    )?;
    let mut child = ManagedProcess::spawn(spec)?;
    let stderr = child.take_stderr().context("ZCode probe stderr missing")?;
    let drain = tokio::spawn(async move {
        tokio::io::copy(&mut BufReader::new(stderr), &mut tokio::io::sink()).await
    });
    let stream = start(
        child.take_stdin().context("ZCode probe stdin missing")?,
        child.take_stdout().context("ZCode probe stdout missing")?,
        config,
        root.0.clone(),
        "plan".to_string(),
    );
    let (read, write) = tokio::io::split(stream);
    let writer: Mutex<Writer> = Mutex::new(Box::new(write));
    let mut reader = BufReader::new(read);
    let mut frame = Vec::new();
    let result = tokio::time::timeout(Duration::from_secs(45), async {
        write_frame(
            &writer,
            &json!({"id":1,"method":"initialize","params":{"protocolVersion":1}}),
        )
        .await?;
        let initialize = read_frame(&mut reader, &mut frame)
            .await?
            .context("ZCode probe closed")?;
        if initialize.get("error").is_some() {
            bail!("ZCode native configuration and connection check failed");
        }
        let session = if include_session {
            write_frame(
                &writer,
                &json!({"id":2,"method":"session/new","params":{"cwd":root.0,"mcpServers":[]}}),
            )
            .await?;
            let response = read_frame(&mut reader, &mut frame)
                .await?
                .context("ZCode Session probe closed")?;
            if response.get("error").is_some() {
                bail!("ZCode Session capability probe failed");
            }
            Some(response["result"].clone())
        } else {
            None
        };
        Ok((initialize["result"].clone(), session, false))
    })
    .await
    .context("ZCode capability probe timed out")
    .and_then(|result| result);
    drop(reader);
    drop(writer);
    let _ = child.force_terminate_tree();
    let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
    let cleanup = confirm_owner_cleanup(
        &root.0,
        tokio::time::Instant::now() + Duration::from_millis(2500),
    )
    .await;
    drain.abort();
    if !cleanup {
        bail!("ZCode probe process-group cleanup unconfirmed");
    }
    result
}

pub async fn confirm_owner_cleanup(root: &std::path::Path, deadline: tokio::time::Instant) -> bool {
    loop {
        if let Ok(bytes) = tokio::fs::read(root.join("owner-cleanup.json")).await
            && let Ok(report) = serde_json::from_slice::<Value>(&bytes)
        {
            return report["confirmed"] == true && report["pendingGroups"] == 0;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

struct Session {
    events: SessionEvents,
    terminal: Option<Reply>,
    cancelled: bool,
    cancel_input: Option<String>,
    cancel_requests: std::collections::HashSet<String>,
    acceptance_compaction: Option<oneshot::Sender<()>>,
}

struct PendingPermission {
    session_id: String,
    native_id: Value,
    options: Vec<Value>,
}

struct Bridge {
    native: Mutex<Writer>,
    core: Mutex<Writer>,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, Reply>>,
    permissions: Mutex<HashMap<String, PendingPermission>>,
    sessions: Mutex<HashMap<String, Session>>,
    finished: mpsc::Sender<(String, Result<Value>)>,
    background_settle: mpsc::Sender<String>,
    config: NativeConfig,
    cwd: PathBuf,
    mode: String,
    acceptance_compacted: AtomicBool,
}

/// Dropping the returned stream aborts every bridge task. ManagedProcess still
/// owns process-tree termination and its bounded wait/reap contract.
pub fn start<R, W>(
    stdin: W,
    stdout: R,
    config: NativeConfig,
    cwd: PathBuf,
    mode: String,
) -> DuplexStream
where
    R: AsyncRead + Send + Unpin + 'static,
    W: AsyncWrite + Send + Unpin + 'static,
{
    let (core, bridge) = tokio::io::duplex(256 * 1024);
    let (core_read, core_write) = tokio::io::split(bridge);
    let (finished, mut finished_rx) = mpsc::channel::<(String, Result<Value>)>(8);
    let (background_settle, mut background_rx) = mpsc::channel::<String>(256);
    let bridge = Arc::new(Bridge {
        native: Mutex::new(Box::new(stdin)),
        core: Mutex::new(Box::new(core_write)),
        next_id: AtomicU64::new(1),
        pending: Mutex::new(HashMap::new()),
        permissions: Mutex::new(HashMap::new()),
        sessions: Mutex::new(HashMap::new()),
        config,
        cwd,
        mode,
        finished,
        background_settle,
        acceptance_compacted: AtomicBool::new(false),
    });
    tokio::spawn(async move {
        let (events_tx, mut events_rx) = mpsc::channel(256);
        let mut workers = JoinSet::<Result<()>>::new();
        let native_bridge = bridge.clone();
        workers.spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut frame = Vec::new();
            while let Some(message) = read_frame(&mut reader, &mut frame).await? {
                if message.get("method").is_none() {
                    if let Some(id) = message.get("id").and_then(Value::as_u64)
                        && let Some(reply) = native_bridge.pending.lock().await.remove(&id)
                    {
                        let result = if message.get("error").is_some() {
                            // Native errors can echo a model configuration containing secrets.
                            Err(anyhow::anyhow!(
                                "Official ZCode rejected the protocol request"
                            ))
                        } else {
                            Ok(message.get("result").cloned().unwrap_or(Value::Null))
                        };
                        let _ = reply.send(result);
                    }
                } else {
                    events_tx
                        .send(message)
                        .await
                        .context("ZCode event reader closed")?;
                }
            }
            Ok(())
        });
        let event_bridge = bridge.clone();
        workers.spawn(async move {
            while let Some(message) = events_rx.recv().await {
                event_bridge.receive(message).await?;
            }
            Ok(())
        });
        let finish_bridge = bridge.clone();
        let background_bridge = bridge.clone();
        workers.spawn(async move {
            while let Some(session_id) = background_rx.recv().await {
                if background_bridge.settle_foreground(&session_id, true).await.is_ok() {
                    write_frame(&background_bridge.core, &json!({"method":"_zcode/backgroundIdle","params":{"sessionId":session_id}})).await?;
                }
                // If still busy, retain the Host pin. The next native terminal
                // retries this bounded observation; no foreground Run waits here.
            }
            Ok(())
        });
        workers.spawn(async move {
            while let Some((session_id,terminal)) = finished_rx.recv().await {
                let jobs = finish_bridge.settle_foreground(&session_id, terminal.is_err()).await?;
                let (messages,reply,cancel_tasks) = {
                    let mut sessions = finish_bridge.sessions.lock().await;
                    let session = sessions.get_mut(&session_id).context("ZCode finishing Session missing")?;
                    let messages = session.events.finish(&session_id,&jobs)?;
                    let cancel_tasks = if session.cancelled {
                        session.events.background_tasks_for_input(session.cancel_input.as_deref())
                    } else { Vec::new() };
                    (messages,session.terminal.take(),cancel_tasks)
                };
                for mut message in messages {
                    recover_command_output(&mut message,&finish_bridge.config.output_root()?).await;
                    write_frame(&finish_bridge.core,&message).await?;
                }
                // A task can be backgrounded while stop is in flight. The final
                // snapshot must join that task to the cancelled input as well.
                for task_id in cancel_tasks {
                    finish_bridge.cancel_background_task(&session_id,&task_id).await?;
                }
                if terminal.is_ok() && std::env::var("ROVAI_INTERNAL_ZCODE_COMPACTION_ACCEPTANCE").as_deref()==Ok("1")
                    && !finish_bridge.acceptance_compacted.swap(true,Ordering::AcqRel) {
                    // Explicit isolated smoke seam, analogous to Grok's native
                    // compaction acceptance hook. It invokes the real official
                    // operation; the normal event observer must prove redelivery.
                    let (tx,rx) = oneshot::channel();
                    finish_bridge.sessions.lock().await.get_mut(&session_id).context("ZCode acceptance Session missing")?.acceptance_compaction = Some(tx);
                    finish_bridge.call("session/compact",json!({"sessionId":session_id,"inputId":format!("rovai-compact-{}",uuid::Uuid::new_v4()),"instructions":"Preserve the session charter, member identity and current task facts."})).await?;
                    tokio::time::timeout(Duration::from_secs(90),rx).await.context("ZCode acceptance compaction timed out")?.context("ZCode acceptance compaction closed")?;
                }
                if let Some(reply) = reply { let _ = reply.send(terminal); }
            }
            Ok(())
        });
        let request_bridge = bridge.clone();
        workers.spawn(async move {
            let mut reader = BufReader::new(core_read);
            let mut frame = Vec::new();
            let mut requests = JoinSet::new();
            loop {
                tokio::select! {
                    message = read_frame(&mut reader, &mut frame) => {
                        let Some(message) = message? else { return Ok(()); };
                        let request_bridge = request_bridge.clone();
                        requests.spawn(async move { request_bridge.request(message).await });
                    }
                    result = requests.join_next(), if !requests.is_empty() => {
                        let _ = result.context("ZCode request task unavailable")???;
                    }
                }
            }
        });
        // Any transport failure poisons this Host; no partially live bridge can
        // be recycled under a new owner. Close the facade to wake all RPCs.
        let _ = workers.join_next().await;
        workers.abort_all();
        while workers.join_next().await.is_some() {}
        let _ = bridge.core.lock().await.shutdown().await;
    });
    core
}

async fn read_frame<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    bytes: &mut Vec<u8>,
) -> Result<Option<Value>> {
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            if bytes.is_empty() {
                return Ok(None);
            }
            bail!("ZCode truncated protocol frame");
        }
        let end = available.iter().position(|b| *b == b'\n').map(|i| i + 1);
        let length = end.unwrap_or(available.len());
        if bytes.len() + length > FRAME_LIMIT {
            bail!("ZCode protocol frame exceeds limit");
        }
        bytes.extend_from_slice(&available[..length]);
        reader.consume(length);
        if end.is_some() {
            if bytes.iter().all(u8::is_ascii_whitespace) {
                bytes.clear();
                continue;
            }
            let message = serde_json::from_slice(bytes).context("Invalid ZCode protocol frame")?;
            bytes.clear();
            return Ok(Some(message));
        }
    }
}

async fn write_frame(writer: &Mutex<Writer>, message: &Value) -> Result<()> {
    let mut bytes = serde_json::to_vec(message)?;
    if bytes.len() > FRAME_LIMIT {
        bail!("ZCode outbound frame exceeds limit");
    }
    bytes.push(b'\n');
    let mut writer = writer.lock().await;
    writer.write_all(&bytes).await?;
    writer.flush().await?;
    Ok(())
}

impl Bridge {
    async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        let result = async {
            write_frame(
                &self.native,
                &json!({"id":id,"method":method,"params":params}),
            )
            .await?;
            tokio::time::timeout(Duration::from_secs(30), rx)
                .await
                .context("ZCode protocol request timed out")?
                .context("ZCode protocol closed")?
        }
        .await;
        self.pending.lock().await.remove(&id);
        result
    }

    async fn command(
        &self,
        session: Option<&str>,
        kind: &str,
        command_id: &str,
        payload: Value,
    ) -> Result<Value> {
        let result = self
            .call(
                "v4/command",
                json!({
                    "commandId":command_id,"clientId":"rovai","sessionId":session,
                    "type":kind,"payload":payload,"issuedAt":chrono::Utc::now().timestamp_millis()
                }),
            )
            .await?;
        if !matches!(
            result.get("status").and_then(Value::as_str),
            Some("accepted" | "duplicate")
        ) {
            bail!("ZCode did not accept the command");
        }
        Ok(result)
    }

    fn workspace(&self) -> Value {
        json!({"workspacePath":self.cwd,"workspaceKey":self.cwd})
    }

    async fn request(&self, message: Value) -> Result<bool> {
        let id = message.get("id").cloned();
        if message.get("method").is_none() {
            if let Some(key) = id.as_ref().and_then(Value::as_str)
                && let Some(PendingPermission {
                    session_id,
                    native_id,
                    options,
                }) = self.permissions.lock().await.remove(key)
            {
                let selected = message
                    .pointer("/result/outcome/optionId")
                    .and_then(Value::as_str);
                let still_active = self
                    .sessions
                    .lock()
                    .await
                    .get(&session_id)
                    .is_some_and(|s| s.terminal.is_some());
                let result = if still_active {
                    selected
                        .and_then(|id| {
                            options
                                .iter()
                                .find(|o| o.get("optionId").and_then(Value::as_str) == Some(id))
                        })
                        .and_then(|o| o.get("response"))
                        .cloned()
                } else {
                    None
                }
                .unwrap_or_else(|| json!({"decision":"deny","reason":"Cancelled"}));
                write_frame(&self.native, &json!({"id":native_id,"result":result})).await?;
            }
            return Ok(true);
        }
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let params = &message["params"];
        let result = self.dispatch(method, params).await;
        let failed = result
            .as_ref()
            .err()
            .is_some_and(|error| error.downcast_ref::<NativeTurnFailure>().is_none());
        if let Some(id) = id {
            let response = match result {
                Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
                Err(error) => {
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":format!("Official ZCode request failed: {error}")}})
                }
            };
            write_frame(&self.core, &response).await?;
        } else {
            result?;
        }
        if failed {
            bail!("ZCode Host is no longer reusable after protocol failure");
        }
        Ok(true)
    }

    async fn dispatch(&self, method: &str, params: &Value) -> Result<Value> {
        match method {
            "initialize" => {
                if let Some(registry) = self.config.app_provider_registry()? {
                    let applied = self.call("workspace/updateProviderRegistry", json!({"workspace":self.workspace(),"registry":registry,"includeWorkspaceState":false})).await?;
                    if applied["appliedProviderRevision"] != self.config.digest
                        || !matches!(applied["status"].as_str(), Some("applied" | "unchanged"))
                        || applied["providerCount"].as_u64()
                            != registry["providers"]
                                .as_array()
                                .map(|providers| providers.len() as u64)
                    {
                        bail!("ZCode App provider registry was not confirmed");
                    }
                }
                self.call("workspace/readState", json!({"workspace":self.workspace(),"runtimeModel":self.config.runtime_model(None)?})).await?;
                Ok(json!({"protocolVersion":1,"agentInfo":{"name":"ZCode"},
                    "agentCapabilities":{"loadSession":false,"sessionCapabilities":{"resume":{}},"mcpCapabilities":{"http":true,"sse":true}},"authMethods":[]}))
            }
            "session/new" | "session/resume" => {
                if params.get("cwd").and_then(Value::as_str) != self.cwd.to_str() {
                    bail!("ZCode workspace mismatch");
                }
                let runtime_model = self.config.runtime_model(None)?;
                let servers = self.config.mcp_servers(params.get("mcpServers"))?;
                // Deferred native creation does not generate a title or run the
                // model. The first input remains the Core-owned Bootstrap.
                let snapshot = if method == "session/new" {
                    self.call("session/create", json!({"workspace":self.workspace(),"persistence":"deferred",
                        "mode":self.mode,"runtimeModel":runtime_model,"mcpServers":servers,"titleGenerationEnabled":false})).await?
                } else {
                    self.call(
                        "session/resume",
                        json!({"sessionId":params["sessionId"],"workspace":self.workspace(),
                        "runtimeModel":runtime_model,"mcpServers":servers}),
                    )
                    .await?
                };
                let session_id = snapshot
                    .pointer("/session/sessionId")
                    .or_else(|| snapshot.get("sessionId"))
                    .and_then(Value::as_str)
                    .context("ZCode native Session ID missing")?;
                if method == "session/resume" && params["sessionId"].as_str() != Some(session_id) {
                    bail!("ZCode exact resume mismatch");
                }
                let subscription = self.call("session/subscribe", json!({"sessionId":session_id,"deliveryKind":"desktop-continuous","includeSnapshot":false})).await?;
                self.sessions.lock().await.insert(
                    session_id.to_string(),
                    Session {
                        events: SessionEvents::new(
                            subscription
                                .get("eventSeq")
                                .and_then(Value::as_u64)
                                .unwrap_or(0),
                        ),
                        terminal: None,
                        cancelled: false,
                        cancel_input: None,
                        cancel_requests: Default::default(),
                        acceptance_compaction: None,
                    },
                );
                self.call(
                    "session/setMode",
                    json!({"sessionId":session_id,"mode":self.mode}),
                )
                .await?;
                self.config.session_catalog(session_id, &snapshot)
            }
            "session/set_model" | "session/set_config_option" => {
                let session_id = params["sessionId"]
                    .as_str()
                    .context("ZCode Session ID missing")?;
                let key = params
                    .get("configId")
                    .and_then(Value::as_str)
                    .unwrap_or("model");
                let selected = params
                    .get("modelId")
                    .or_else(|| params.get("value"))
                    .and_then(Value::as_str)
                    .context("ZCode model missing")?;
                if key != "model" {
                    bail!("Unsupported ZCode model option");
                }
                let runtime_model = self.config.runtime_model(Some(selected))?;
                let applied = self.call("session/setModel", json!({"sessionId":session_id,"model":runtime_model["model"],"runtimeModel":runtime_model})).await?;
                if applied
                    .pointer("/model/current")
                    .or_else(|| applied.pointer("/settings/model/current"))
                    != Some(&runtime_model["model"])
                {
                    bail!("ZCode model selection was not confirmed");
                }
                Ok(json!({}))
            }
            "session/prompt" => {
                let session_id = params["sessionId"]
                    .as_str()
                    .context("ZCode Session ID missing")?;
                let prompt = params["prompt"]
                    .as_array()
                    .context("ZCode prompt missing")?;
                let mut text = Vec::new();
                for block in prompt {
                    if block.get("type").and_then(Value::as_str) != Some("text") {
                        bail!("ZCode supports text prompts only");
                    }
                    text.push(block["text"].as_str().context("Invalid ZCode text block")?);
                }
                let input_id = format!("rovai-{}", uuid::Uuid::new_v4());
                let (tx, rx) = oneshot::channel();
                {
                    let mut sessions = self.sessions.lock().await;
                    let session = sessions
                        .get_mut(session_id)
                        .context("Unknown ZCode Session")?;
                    if session.terminal.is_some() {
                        bail!("ZCode Session is busy");
                    }
                    session.events.begin(&input_id)?;
                    session.cancelled = false;
                    session.cancel_input = None;
                    session.cancel_requests.clear();
                    session.terminal = Some(tx);
                }
                let ack = self
                    .command(
                        Some(session_id),
                        "sendText",
                        &input_id,
                        json!({"text":text.join("\n"),"requestedDelivery":"startNow"}),
                    )
                    .await;
                match ack {
                    Ok(ack)
                        if ack.pointer("/result/inputId").and_then(Value::as_str)
                            == Some(input_id.as_str()) =>
                    {
                        write_frame(&self.core, &json!({"method":"_zcode/inputAccepted","params":{"sessionId":session_id,"inputId":input_id}})).await?;
                    }
                    _ => {
                        // Acceptance is ambiguous: do not retry a model input.
                        self.stop(session_id).await?;
                        bail!("ZCode input acceptance unavailable");
                    }
                }
                rx.await.context("ZCode turn closed without terminal")?
            }
            "session/cancel" | "_zcode/cancelFence" => {
                self.stop(
                    params["sessionId"]
                        .as_str()
                        .context("ZCode Session ID missing")?,
                )
                .await?;
                if method == "_zcode/cancelFence" {
                    self.settle_foreground(params["sessionId"].as_str().unwrap(), true)
                        .await?;
                }
                Ok(json!({}))
            }
            _ => bail!("Unsupported internal ZCode operation"),
        }
    }

    async fn stop(&self, session_id: &str) -> Result<()> {
        if let Some(session) = self.sessions.lock().await.get_mut(session_id) {
            if !session.cancelled {
                session.cancel_input = session.events.input_id().map(str::to_string);
            }
            session.cancelled = true;
        }
        self.command(
            Some(session_id),
            "stop",
            &format!("rovai-stop-{}", uuid::Uuid::new_v4()),
            json!({}),
        )
        .await?;
        // Cancel only background work launched by this input. Older Session
        // services do not acquire the successor Run's cancellation scope.
        let tasks = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| {
                s.events
                    .background_tasks_for_input(s.cancel_input.as_deref())
            })
            .unwrap_or_default();
        for task_id in tasks {
            self.cancel_background_task(session_id, &task_id).await?;
        }
        Ok(())
    }

    async fn cancel_background_task(&self, session_id: &str, task_id: &str) -> Result<()> {
        let first = self
            .sessions
            .lock()
            .await
            .get_mut(session_id)
            .context("ZCode cancelled Session missing")?
            .cancel_requests
            .insert(task_id.to_string());
        if first {
            self.call(
                "session/cancelBackgroundTask",
                json!({"sessionId":session_id,"taskId":task_id}),
            )
            .await?;
        }
        Ok(())
    }

    async fn settle_foreground(&self, session_id: &str, allow_failed: bool) -> Result<Vec<Value>> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        loop {
            let snapshot = self
                .call("session/read", json!({"sessionId":session_id}))
                .await?;
            let jobs = snapshot
                .pointer("/projection/backgroundJobs")
                .and_then(Value::as_array)
                .context("ZCode background state unavailable")?;
            let quiescent = foreground_quiescent(&snapshot, allow_failed);
            if quiescent {
                return Ok(jobs.clone());
            }
            if tokio::time::Instant::now() >= deadline {
                bail!("ZCode foreground Tool or permission did not settle");
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    async fn receive(&self, message: Value) -> Result<()> {
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let params = &message["params"];
        if let Some(id) = message.get("id") {
            if method == "session/requestRuntimePreferences" {
                return write_frame(
                    &self.native,
                    &json!({"id":id,"result":self.config.preferences()}),
                )
                .await;
            }
            if method == "interaction/requestProviderRuntimeHeaders" {
                // The official App obtains fresh verification headers in its
                // Renderer. Config Authorization alone cannot confirm that step.
                // Native preparation replaces this cause with a generic error.
                if params["workspace"] == self.workspace()
                    && let Some(session) = self
                        .sessions
                        .lock()
                        .await
                        .get_mut(params["sessionId"].as_str().unwrap_or(""))
                {
                    session
                        .events
                        .reject_runtime_headers(params["turnId"].as_str());
                }
                return write_frame(
                    &self.native,
                    &json!({"id":id,"result":{
                        "headersApplied":false,"errorMessage":RUNTIME_HEADERS_UNAVAILABLE
                    }}),
                )
                .await;
            }
            if method == "interaction/requestPermission" {
                let session_id = params["sessionId"]
                    .as_str()
                    .context("ZCode permission Session missing")?;
                let active = self
                    .sessions
                    .lock()
                    .await
                    .get(session_id)
                    .is_some_and(|s| s.events.owns_turn(params["turnId"].as_str()));
                let options = params["options"]
                    .as_array()
                    .context("ZCode permission options missing")?;
                if active
                    && !options.is_empty()
                    && options
                        .iter()
                        .all(|o| o.get("response").is_some() && o.get("optionId").is_some())
                {
                    let key = format!("zcode-permission-{}", uuid::Uuid::new_v4());
                    self.permissions.lock().await.insert(
                        key.clone(),
                        PendingPermission {
                            session_id: session_id.to_string(),
                            native_id: id.clone(),
                            options: options.clone(),
                        },
                    );
                    let options = options.iter().map(|o| json!({"optionId":o["optionId"],"name":o["name"],"kind":if o["kind"] == "deny" { json!("reject_once") } else { o["kind"].clone() }})).collect::<Vec<_>>();
                    return write_frame(&self.core, &json!({"id":key,"method":"session/request_permission","params":{
                        "sessionId":session_id,"options":options,"toolCall":{"toolCallId":params["toolCallId"],"title":params["toolName"],"rawInput":params["input"]}}})).await;
                }
                return write_frame(
                    &self.native,
                    &json!({"id":id,"result":{"decision":"deny","reason":"No active Rovai owner"}}),
                )
                .await;
            }
            return write_frame(&self.native, &json!({"id":id,"error":{"code":-32601,"message":"Unsupported Rovai host interaction"}})).await;
        }
        if method != "session/event" {
            return Ok(());
        }
        let Some(session_id) = params["sessionId"].as_str() else {
            return Ok(());
        };
        let translated = {
            let mut sessions = self.sessions.lock().await;
            let Some(session) = sessions.get_mut(session_id) else {
                return Ok(());
            };
            session.events.receive(params)?
        };
        if params["type"] == "turn.started"
            && params
                .pointer("/payload/inputSource")
                .and_then(Value::as_str)
                == Some("background_task")
        {
            // Native completion notifications start an extra model Turn without
            // a Rovai Input. Stop only that exact native foreground execution;
            // the background service and its real result keep their own scope.
            let foreground = params
                .pointer("/payload/foregroundExecutionId")
                .and_then(Value::as_str)
                .context("ZCode background notification execution ID missing")?;
            let result = self.call("v4/command", json!({"commandId":format!("rovai-notification-stop-{}",uuid::Uuid::new_v4()),
                "clientId":"rovai","sessionId":session_id,"type":"stop", "payload":{"expectedForegroundExecutionId":foreground},
                "issuedAt":chrono::Utc::now().timestamp_millis()})).await?;
            write_frame(&self.core, &json!({"method":"_zcode/backgroundNotificationStop","params":{
                "sessionId":session_id,"nativeTurnId":params["turnId"],"foregroundExecutionId":foreground,"commandStatus":result["status"]}})).await?;
        }
        let mut background_finished = false;
        for mut event in translated.messages {
            recover_command_output(&mut event, &self.config.output_root()?).await;
            write_frame(&self.core, &event).await?;
            background_finished |= event["method"] == "_zcode/background"
                && matches!(
                    event
                        .pointer("/params/background/status")
                        .and_then(Value::as_str),
                    Some("completed" | "failed" | "cancelled")
                );
            if event["method"] == "_zcode/compaction"
                && let Some(session) = self.sessions.lock().await.get_mut(session_id)
                && let Some(reply) = session.acceptance_compaction.take()
            {
                let _ = reply.send(());
            }
        }
        if background_finished
            || matches!(
                params["type"].as_str(),
                Some("turn.completed" | "turn.failed")
            )
        {
            self.background_settle
                .try_send(session_id.to_string())
                .context("ZCode background observer queue unavailable")?;
        }
        if let Some(terminal) = translated.terminal {
            // Foreground closure is independent of managed background jobs.
            self.finished
                .send((session_id.to_string(), terminal))
                .await
                .context("ZCode terminal collector closed")?;
        }
        Ok(())
    }
}

// A provider failure leaves the native projection in error, not idle. It can
// settle only a failed/cancelled path; successful Final retains the idle gate.
fn foreground_quiescent(snapshot: &Value, allow_failed: bool) -> bool {
    let status = snapshot
        .pointer("/projection/status")
        .and_then(Value::as_str);
    (status == Some("idle") || (allow_failed && status == Some("error")))
        && snapshot
            .pointer("/runtime/activeTurnId")
            .is_none_or(Value::is_null)
        && [
            "/projection/activeToolCalls",
            "/projection/pendingPermissions",
            "/runtime/pendingRequestIds",
        ]
        .iter()
        .all(|path| {
            snapshot
                .pointer(path)
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
        })
}

/// Only a correlated native Bash result may identify an output artifact. Never
/// follow a path scraped from text, another Session, a symlink, or a device.
async fn recover_command_output(event: &mut Value, output_root: &std::path::Path) {
    use tokio::io::AsyncReadExt;
    const OUTPUT_LIMIT: u64 = 256 * 1024;
    let params = &event["params"];
    let update = &params["update"];
    if update["sessionUpdate"] != "tool_call_update"
        || update["toolName"] != "Bash"
        || update
            .pointer("/rawOutput/budgetStrategy")
            .and_then(Value::as_str)
            != Some("artifact")
        || update
            .pointer("/rawOutput/artifactPath")
            .and_then(Value::as_str)
            .is_none()
    {
        return;
    }
    let result = async {
        let session = params["sessionId"].as_str().context("missing Session")?;
        let tool = update["toolCallId"].as_str().context("missing Tool")?;
        let safe = |id: &str| {
            id.bytes()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || b"._-".contains(&c) {
                        c as char
                    } else {
                        '_'
                    }
                })
                .take(120)
                .collect::<String>()
        };
        let root = tokio::fs::canonicalize(output_root).await?;
        let parent = root.join(safe(session));
        if tokio::fs::canonicalize(&parent).await? != parent {
            bail!("artifact Session directory is a link");
        }
        let expected = parent.join(format!("{}-stdout.log", safe(tool)));
        let reported = update
            .pointer("/rawOutput/artifactPath")
            .and_then(Value::as_str)
            .context("missing artifact")?;
        if tokio::fs::canonicalize(reported).await? != expected {
            bail!("artifact identity mismatch");
        }
        let mut options = tokio::fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        let file = options.open(expected).await?;
        let metadata = file.metadata().await?;
        if !metadata.is_file() {
            bail!("artifact is not a regular file");
        }
        let mut bytes = Vec::new();
        file.take(OUTPUT_LIMIT + 1).read_to_end(&mut bytes).await?;
        let truncated = bytes.len() as u64 > OUTPUT_LIMIT
            || update
                .pointer("/rawOutput/outputBytes")
                .and_then(Value::as_u64)
                .is_some_and(|size| size > metadata.len());
        bytes.truncate(OUTPUT_LIMIT as usize);
        let mut text = String::from_utf8_lossy(&bytes).into_owned();
        if truncated {
            text.push_str("\n[ZCode command output truncated; native artifact retained]");
        }
        Ok::<_, anyhow::Error>((text, truncated))
    }
    .await;
    let update = &mut event["params"]["update"];
    match result {
        Ok((text, truncated)) => {
            update["rawOutput"]["output"] = json!(text);
            update["rawOutput"]["truncated"] = json!(truncated);
            update["content"] = json!([{"type":"content","content":{"type":"text","text":text}}]);
        }
        Err(_) => {
            update["rawOutput"]["truncated"] = json!(true);
            if let Some(text) = update.pointer_mut("/content/0/content/text") {
                *text = json!(format!(
                    "{}\n[ZCode command output is a preview; native artifact unavailable]",
                    text.as_str().unwrap_or("")
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Owns terminal delivery across the facade's concurrent reader/settler/request
    // workers. Pure event mapping cannot catch a failed projection closing the
    // facade before Core receives the provider failure. No process, disk or DB.
    #[tokio::test]
    async fn provider_failure_reaches_core_without_poisoning_the_host() {
        let snapshot = json!({"projection":{"status":"error","activeToolCalls":[],"pendingPermissions":[]},
            "runtime":{"pendingRequestIds":[]}});
        assert!(foreground_quiescent(&snapshot, true));
        assert!(!foreground_quiescent(&snapshot, false));
        for path in [
            "/projection/activeToolCalls",
            "/projection/pendingPermissions",
            "/runtime/pendingRequestIds",
        ] {
            let mut busy = snapshot.clone();
            *busy.pointer_mut(path).unwrap() = json!([{"id":"pending"}]);
            assert!(!foreground_quiescent(&busy, true));
        }
        let mut active = snapshot;
        active["runtime"]["activeTurnId"] = json!("t1");
        assert!(!foreground_quiescent(&active, true));
        let config = NativeConfig {
            value: json!({"model":{"main":"fixture/model"},"provider":{"fixture":{"kind":"anthropic",
                "options":{"apiKey":"PRIVATE_TEST_KEY","baseURL":"https://example.invalid"},
                "models":{"model":{}}}}}),
            digest: "fixture".into(),
            app_config: false,
        };
        let (native, adapter) = tokio::io::duplex(64 * 1024);
        let (native_read, native_write) = tokio::io::split(native);
        let (adapter_read, adapter_write) = tokio::io::split(adapter);
        let peer = tokio::spawn(async move {
            let mut reader = BufReader::new(native_read);
            let writer: Mutex<Writer> = Mutex::new(Box::new(native_write));
            let mut frame = Vec::new();
            while let Some(request) = read_frame(&mut reader, &mut frame).await.unwrap() {
                let result = match request["method"].as_str().unwrap() {
                    "session/create" => json!({"session":{"sessionId":"s1"},"settings":{"model":{
                        "current":{"providerId":"fixture","modelId":"model"},
                        "available":[{"ref":{"providerId":"fixture","modelId":"model"}}]}}}),
                    "session/subscribe" => json!({"eventSeq":0}),
                    "v4/command" => {
                        let input = request["params"]["commandId"].clone();
                        write_frame(
                            &writer,
                            &json!({"method":"session/event","params":{"sessionId":"s1","seq":1,
                            "turnId":"t1","type":"turn.started","payload":{"inputId":input}}}),
                        )
                        .await
                        .unwrap();
                        write_frame(&writer,&json!({"id":"headers","method":"interaction/requestProviderRuntimeHeaders",
                            "params":{"sessionId":"s1","turnId":"t1","reason":"model-request",
                                "workspace":{"workspacePath":"/fixture","workspaceKey":"/fixture"}}})).await.unwrap();
                        let callback = read_frame(&mut reader, &mut frame).await.unwrap().unwrap();
                        assert_eq!(callback["id"], "headers");
                        assert_eq!(callback["result"]["headersApplied"], false);
                        write_frame(&writer,&json!({"method":"session/event","params":{
                            "sessionId":"s1","seq":2,"turnId":"t1","type":"turn.failed",
                            "payload":{"inputId":input,"turnPhase":"model","error":{
                                "type":"model_request_failed","code":"model_request_failed",
                                "message":"Model request failed.","stack":"PRIVATE_TEST_KEY",
                                "attribution":{"source":"runtime","reason":"unknown"},"retryable":false}}
                        }})).await.unwrap();
                        json!({"status":"accepted","result":{"inputId":input}})
                    }
                    "session/read" => json!({"projection":{"status":"error","backgroundJobs":[],
                        "activeToolCalls":[],"pendingPermissions":[]},"runtime":{"pendingRequestIds":[]}}),
                    "workspace/readState" | "session/setMode" => json!({}),
                    method => panic!("unexpected native method {method}"),
                };
                write_frame(&writer, &json!({"id":request["id"],"result":result}))
                    .await
                    .unwrap();
            }
        });
        let stream = start(
            adapter_write,
            adapter_read,
            config,
            PathBuf::from("/fixture"),
            "build".into(),
        );
        let (read, write) = tokio::io::split(stream);
        let mut reader = BufReader::new(read);
        let writer: Mutex<Writer> = Mutex::new(Box::new(write));
        let mut frame = Vec::new();
        for (id, method, params) in [
            (1, "session/new", json!({"cwd":"/fixture"})),
            (
                2,
                "session/prompt",
                json!({"sessionId":"s1","prompt":[{"type":"text","text":"fixture"}]}),
            ),
            (3, "initialize", json!({})),
        ] {
            write_frame(&writer, &json!({"id":id,"method":method,"params":params}))
                .await
                .unwrap();
            let response = tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    let message = read_frame(&mut reader, &mut frame)
                        .await
                        .unwrap()
                        .expect("provider failure must reach Core before any transport close");
                    assert!(!message.to_string().contains("PRIVATE_TEST_KEY"));
                    if message["id"] == id {
                        break message;
                    }
                }
            })
            .await
            .unwrap();
            if id == 2 {
                assert!(
                    response["error"]["message"]
                        .as_str()
                        .unwrap()
                        .contains("authentication failed")
                );
                assert!(
                    response["error"]["message"]
                        .as_str()
                        .unwrap()
                        .contains("captcha")
                );
            } else {
                assert!(response.get("error").is_none(), "{response}");
            }
        }
        peer.abort();
    }

    // Owns the artifact filesystem boundary, which existing ACP output tests
    // cannot cover because they never read native ZCode artifact paths.
    #[tokio::test]
    async fn artifact_output_is_bounded_and_bound_to_the_native_session_and_tool() {
        let root =
            std::env::temp_dir().join(format!("rovai-zcode-output-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(root.join("session"))
            .await
            .unwrap();
        let path = root.join("session/tool-stdout.log");
        let output = "x".repeat(300_000);
        tokio::fs::write(&path, &output).await.unwrap();
        let event = json!({"params":{"sessionId":"session","update":{"sessionUpdate":"tool_call_update",
            "toolName":"Bash","toolCallId":"tool","rawOutput":{"budgetStrategy":"artifact","artifactPath":path,"outputBytes":300_000},
            "content":[{"type":"content","content":{"type":"text","text":"preview"}}]}}});
        let mut recovered = event.clone();
        recover_command_output(&mut recovered, &root).await;
        let text = recovered
            .pointer("/params/update/content/0/content/text")
            .unwrap()
            .as_str()
            .unwrap();
        assert!(text.starts_with(&"x".repeat(256 * 1024)));
        assert!(text.len() < 263_000);
        assert_eq!(
            recovered.pointer("/params/update/rawOutput/truncated"),
            Some(&json!(true))
        );
        let mut foreign = event.clone();
        foreign["params"]["sessionId"] = json!("other");
        recover_command_output(&mut foreign, &root).await;
        assert!(
            foreign
                .pointer("/params/update/content/0/content/text")
                .unwrap()
                .as_str()
                .unwrap()
                .starts_with("preview")
        );
        #[cfg(unix)]
        {
            tokio::fs::remove_file(&path).await.unwrap();
            let secret = root.join("private.txt");
            tokio::fs::write(&secret, "MUST_NOT_READ").await.unwrap();
            std::os::unix::fs::symlink(secret, &path).unwrap();
            let mut linked = event;
            recover_command_output(&mut linked, &root).await;
            assert!(!linked.to_string().contains("MUST_NOT_READ"));
        }
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}
