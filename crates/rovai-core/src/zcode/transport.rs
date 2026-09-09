//! In-process translation of the official NDJSON protocol into Core's existing
//! session transport. The child is the official App kernel, never an ACP package.

use super::{NativeConfig, events::SessionEvents};
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

/// Read-only capability exchange with an isolated native Home and socket root.
/// Credentials stay in memory in the official runtimeModel carrier. No prompt
/// is submitted and no probe Session is stored in the user's native Home.
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
    config.value["mcp"] = json!({"enabled":false,"servers":{}});
    config.value["memory"] = json!({"use":false});
    let mut command = super::command(executable)?;
    command
        .arg("app-server")
        .current_dir(&root.0)
        .env("HOME", &root.0)
        .env("USERPROFILE", &root.0)
        .env("TMPDIR", &root.0);
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
            bail!("ZCode BYOK capability probe failed");
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
    drain.abort();
    result
}

struct Session {
    events: SessionEvents,
    terminal: Option<Reply>,
    cancelled: bool,
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
        workers.spawn(async move {
            while let Some((session_id,terminal)) = finished_rx.recv().await {
                let jobs = finish_bridge.settle_background(&session_id,false).await?;
                let (messages,reply) = {
                    let mut sessions = finish_bridge.sessions.lock().await;
                    let session = sessions.get_mut(&session_id).context("ZCode finishing Session missing")?;
                    (session.events.finish(&session_id,&jobs)?,session.terminal.take())
                };
                for mut message in messages {
                    recover_command_output(&mut message,&finish_bridge.config.output_root()?).await;
                    write_frame(&finish_bridge.core,&message).await?;
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
        let failed = result.is_err();
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
            "session/cancel" => {
                self.stop(
                    params["sessionId"]
                        .as_str()
                        .context("ZCode Session ID missing")?,
                )
                .await?;
                Ok(json!({}))
            }
            _ => bail!("Unsupported internal ZCode operation"),
        }
    }

    async fn stop(&self, session_id: &str) -> Result<()> {
        if let Some(session) = self.sessions.lock().await.get_mut(session_id) {
            session.cancelled = true;
        }
        self.command(
            Some(session_id),
            "stop",
            &format!("rovai-stop-{}", uuid::Uuid::new_v4()),
            json!({}),
        )
        .await?;
        self.settle_background(session_id, true).await?;
        Ok(())
    }

    async fn settle_background(&self, session_id: &str, cancel: bool) -> Result<Vec<Value>> {
        let deadline =
            tokio::time::Instant::now() + Duration::from_secs(if cancel { 3 } else { 300 });
        loop {
            let snapshot = self
                .call("session/read", json!({"sessionId":session_id}))
                .await?;
            let jobs = snapshot
                .pointer("/projection/backgroundJobs")
                .and_then(Value::as_array)
                .context("ZCode background state unavailable")?;
            let active = jobs
                .iter()
                .filter(|job| {
                    !matches!(
                        job.get("status").and_then(Value::as_str),
                        Some("completed" | "failed" | "cancelled")
                    )
                })
                .collect::<Vec<_>>();
            let quiescent = snapshot
                .pointer("/projection/status")
                .and_then(Value::as_str)
                == Some("idle")
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
                });
            if active.is_empty() && quiescent {
                return Ok(jobs.clone());
            }
            if cancel
                || self
                    .sessions
                    .lock()
                    .await
                    .get(session_id)
                    .is_some_and(|session| session.cancelled)
            {
                for job in active {
                    let task_id = job
                        .get("taskId")
                        .and_then(Value::as_str)
                        .context("ZCode background identity missing")?;
                    self.call(
                        "session/cancelBackgroundTask",
                        json!({"sessionId":session_id,"taskId":task_id}),
                    )
                    .await?;
                }
            }
            if tokio::time::Instant::now() >= deadline {
                bail!("ZCode background execution did not settle");
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
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
        for mut event in translated.messages {
            recover_command_output(&mut event, &self.config.output_root()?).await;
            write_frame(&self.core, &event).await?;
            if event["method"] == "_zcode/compaction"
                && let Some(session) = self.sessions.lock().await.get_mut(session_id)
                && let Some(reply) = session.acceptance_compaction.take()
            {
                let _ = reply.send(());
            }
        }
        if let Some(terminal) = translated.terminal {
            // A foreground terminal does not prove that background children are
            // idle. Keep the old owner until the native execution set settles.
            self.finished
                .send((session_id.to_string(), terminal))
                .await
                .context("ZCode terminal collector closed")?;
        }
        Ok(())
    }
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
