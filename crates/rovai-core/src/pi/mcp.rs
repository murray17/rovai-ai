use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

use anyhow::{Context, Result, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use reqwest::{
    Client as HttpClient, Method, StatusCode,
    header::{ACCEPT, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue},
    redirect::Policy as RedirectPolicy,
};
use rovai_core::{
    command::canonical_json_digest,
    managed_process::{
        ManagedChildStdin, ManagedChildStdout, ManagedProcess, ManagedProcessLaunchSpec,
        ManagedProcessPurpose, ManagedStdinPolicy, ManagedWindowsArgvDialect,
    },
    mcp::McpServerDefinition,
    mcp_projection::{McpExposureStatus, PreparedMcpProjection},
    runtime_discovery::configure_active_runtime_command,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{Mutex, oneshot},
    time::timeout,
};

use super::{PI_MAX_JSONL_RECORD_BYTES, read_jsonl_record};

const MCP_PROTOCOL_VERSION: &str = "2025-06-18";
const MCP_COMMAND_TIMEOUT: Duration = Duration::from_secs(45);
const MCP_DESCRIPTION_MAX_BYTES: usize = 16 * 1024;
const MCP_MAX_LIST_PAGES: usize = 128;
const NATIVE_TOOL_NAMES: [&str; 7] = ["read", "bash", "edit", "write", "grep", "find", "ls"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PiMcpToolDefinition {
    pub server_id: String,
    pub server_name: String,
    pub tool_name: String,
    pub runtime_name: String,
    pub description: String,
    pub input_schema: Value,
    pub description_digest: String,
    pub input_schema_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PiMcpActivationFailure {
    pub server_id: String,
    pub server_name: String,
    pub diagnostic_code: String,
    pub reason: String,
}

#[derive(Debug)]
struct PendingMcpCommand {
    sender: oneshot::Sender<std::result::Result<Value, String>>,
}

struct PiMcpStdioClient {
    server_id: String,
    child: Mutex<ManagedProcess>,
    stdin: Mutex<ManagedChildStdin>,
    pending: Mutex<HashMap<String, PendingMcpCommand>>,
    next_id: AtomicU64,
    alive: AtomicBool,
}

impl PiMcpStdioClient {
    async fn spawn(
        server_id: &str,
        command: &str,
        args: &[String],
        cwd: Option<&str>,
        env: &BTreeMap<String, String>,
    ) -> Result<Arc<Self>> {
        let cwd = cwd
            .map(PathBuf::from)
            .context("resolved Pi MCP stdio Server has no cwd")?;
        if !cwd.is_dir() {
            bail!("Pi MCP stdio Server cwd is unavailable");
        }
        let mut process = Command::new(command);
        configure_active_runtime_command(&mut process);
        process.args(args).envs(env).current_dir(&cwd);
        let spec = ManagedProcessLaunchSpec::capture(
            &process,
            ManagedProcessPurpose::RuntimeOneShot,
            ManagedStdinPolicy::Piped,
            ManagedWindowsArgvDialect::MicrosoftCrt,
            format!("runtime-mcp:pi:{server_id}"),
        )?;
        let mut child = ManagedProcess::spawn(spec).context("failed to start Pi MCP Server")?;
        let stdin = child
            .take_stdin()
            .context("Pi MCP Server stdin was unavailable")?;
        let stdout = child
            .take_stdout()
            .context("Pi MCP Server stdout was unavailable")?;
        let stderr = child
            .take_stderr()
            .context("Pi MCP Server stderr was unavailable")?;
        let client = Arc::new(Self {
            server_id: server_id.to_string(),
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
        });
        Self::spawn_stdout_reader(client.clone(), stdout);
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(_)) = lines.next_line().await {}
        });
        Ok(client)
    }

    fn spawn_stdout_reader(client: Arc<Self>, stdout: ManagedChildStdout) {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            loop {
                let record = match read_jsonl_record(&mut reader, PI_MAX_JSONL_RECORD_BYTES).await {
                    Ok(Some(record)) => record,
                    _ => break,
                };
                let Ok(message) = serde_json::from_slice::<Value>(&record) else {
                    break;
                };
                let Some(id) = message.get("id").and_then(super::value_id) else {
                    continue;
                };
                let Some(pending) = client.pending.lock().await.remove(&id) else {
                    continue;
                };
                let result = if let Some(error) = message.get("error") {
                    Err(format!("MCP JSON-RPC error: {}", bounded_error(error)))
                } else {
                    message
                        .get("result")
                        .cloned()
                        .ok_or_else(|| "MCP JSON-RPC response omitted result".to_string())
                };
                let _ = pending.sender.send(result);
            }
            client.alive.store(false, Ordering::Release);
            for (_, pending) in client.pending.lock().await.drain() {
                let _ = pending.sender.send(Err("MCP Server exited".to_string()));
            }
        });
    }

    async fn command(&self, method: &str, params: Value) -> Result<Value> {
        if !self.alive.load(Ordering::Acquire) {
            bail!("Pi MCP Server is not alive");
        }
        let id = format!(
            "rovai-mcp-{}-{}",
            self.server_id,
            self.next_id.fetch_add(1, Ordering::Relaxed)
        );
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .await
            .insert(id.clone(), PendingMcpCommand { sender });
        if let Err(error) = self
            .send(json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params}))
            .await
        {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        match timeout(MCP_COMMAND_TIMEOUT, receiver).await {
            Ok(Ok(Ok(result))) => Ok(result),
            Ok(Ok(Err(message))) => bail!("{method}: {message}"),
            Ok(Err(_)) => bail!("Pi MCP response channel closed: {method}"),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                bail!("Pi MCP command timed out: {method}")
            }
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<()> {
        self.send(json!({"jsonrpc":"2.0", "method":method, "params":params}))
            .await
    }

    async fn send(&self, message: Value) -> Result<()> {
        let encoded = serde_json::to_vec(&message)?;
        if encoded.len() > PI_MAX_JSONL_RECORD_BYTES {
            bail!("Pi MCP outbound record exceeds the bridge limit");
        }
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(&encoded).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    async fn shutdown(&self) {
        self.alive.store(false, Ordering::Release);
        let mut child = self.child.lock().await;
        let _ = child.request_graceful_termination();
        if timeout(Duration::from_secs(2), child.wait()).await.is_err() {
            let _ = child.force_terminate_tree();
            let _ = timeout(Duration::from_secs(1), child.wait()).await;
        }
        let _ = child.force_terminate_tree();
    }
}

struct PiMcpHttpClient {
    server_id: String,
    url: String,
    client: HttpClient,
    headers: HeaderMap,
    session_id: Mutex<Option<HeaderValue>>,
    next_id: AtomicU64,
    alive: AtomicBool,
}

impl PiMcpHttpClient {
    fn new(server_id: &str, url: &str, headers: &BTreeMap<String, String>) -> Result<Arc<Self>> {
        let parsed = reqwest::Url::parse(url).context("Pi MCP HTTP URL is invalid")?;
        if !matches!(parsed.scheme(), "http" | "https") {
            bail!("Pi MCP HTTP URL has an unsupported scheme");
        }
        let mut request_headers = HeaderMap::new();
        for (name, value) in headers {
            let name = HeaderName::from_bytes(name.as_bytes())
                .context("Pi MCP HTTP header name is invalid")?;
            if name == ACCEPT
                || name == CONTENT_TYPE
                || name.as_str().eq_ignore_ascii_case("mcp-session-id")
                || name.as_str().eq_ignore_ascii_case("mcp-protocol-version")
            {
                bail!("Pi MCP HTTP projection cannot override protocol headers");
            }
            request_headers.insert(
                name,
                HeaderValue::from_str(value).context("Pi MCP HTTP header value is invalid")?,
            );
        }
        let client = HttpClient::builder()
            .redirect(RedirectPolicy::none())
            .timeout(MCP_COMMAND_TIMEOUT)
            .build()
            .context("failed to initialize Pi MCP HTTP transport")?;
        Ok(Arc::new(Self {
            server_id: server_id.to_string(),
            url: parsed.to_string(),
            client,
            headers: request_headers,
            session_id: Mutex::new(None),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
        }))
    }

    async fn command(&self, method: &str, params: Value) -> Result<Value> {
        if !self.alive.load(Ordering::Acquire) {
            bail!("Pi MCP HTTP Server is not alive");
        }
        let id = format!(
            "rovai-mcp-{}-{}",
            self.server_id,
            self.next_id.fetch_add(1, Ordering::Relaxed)
        );
        let response = self
            .request(
                Method::POST,
                Some(json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params})),
                method != "initialize",
            )
            .await?;
        decode_http_json_rpc_response(&response, Some(&id))
            .with_context(|| format!("Pi MCP HTTP command failed: {method}"))?
            .context("Pi MCP HTTP response omitted the requested result")
    }

    async fn notify(&self, method: &str, params: Value) -> Result<()> {
        let response = self
            .request(
                Method::POST,
                Some(json!({"jsonrpc":"2.0", "method":method, "params":params})),
                true,
            )
            .await?;
        if !response.body.is_empty() {
            let _ = decode_http_json_rpc_response(&response, None)?;
        }
        Ok(())
    }

    async fn request(
        &self,
        method: Method,
        body: Option<Value>,
        protocol_initialized: bool,
    ) -> Result<McpHttpResponse> {
        let mut request = self
            .client
            .request(method, &self.url)
            .headers(self.headers.clone())
            .header(ACCEPT, "application/json, text/event-stream");
        if protocol_initialized {
            request = request.header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION);
        }
        if let Some(session_id) = self.session_id.lock().await.clone() {
            request = request.header("Mcp-Session-Id", session_id);
        }
        if let Some(body) = body {
            let encoded = serde_json::to_vec(&body)?;
            if encoded.len() > PI_MAX_JSONL_RECORD_BYTES {
                bail!("Pi MCP HTTP outbound record exceeds the bridge limit");
            }
            request = request
                .header(CONTENT_TYPE, "application/json")
                .body(encoded);
        }
        let mut response = request.send().await.context("Pi MCP HTTP request failed")?;
        let status = response.status();
        if status.is_redirection() {
            bail!("Pi MCP HTTP redirect was rejected");
        }
        if !(status.is_success() || status == StatusCode::ACCEPTED) {
            bail!("Pi MCP HTTP Server returned status {status}");
        }
        if let Some(value) = response.headers().get("mcp-session-id").cloned() {
            let mut session_id = self.session_id.lock().await;
            if session_id.as_ref().is_some_and(|current| current != value) {
                bail!("Pi MCP HTTP Server changed its Session identity");
            }
            *session_id = Some(value);
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .context("Pi MCP HTTP response body failed")?
        {
            if bytes.len().saturating_add(chunk.len()) > PI_MAX_JSONL_RECORD_BYTES {
                bail!("Pi MCP HTTP response exceeds the bridge limit");
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(McpHttpResponse {
            content_type,
            body: bytes,
        })
    }

    async fn shutdown(&self) {
        self.alive.store(false, Ordering::Release);
        if self.session_id.lock().await.is_some() {
            let _ = self.request(Method::DELETE, None, true).await;
        }
    }
}

struct McpHttpResponse {
    content_type: String,
    body: Vec<u8>,
}

enum PiMcpClient {
    Stdio(Arc<PiMcpStdioClient>),
    StreamableHttp(Arc<PiMcpHttpClient>),
}

impl PiMcpClient {
    async fn spawn(server_id: &str, definition: &McpServerDefinition) -> Result<Arc<Self>> {
        let client = Arc::new(match definition {
            McpServerDefinition::Stdio {
                command,
                args,
                cwd,
                env,
            } => Self::Stdio(
                PiMcpStdioClient::spawn(server_id, command, args, cwd.as_deref(), env).await?,
            ),
            McpServerDefinition::StreamableHttp { url, headers } => {
                Self::StreamableHttp(PiMcpHttpClient::new(server_id, url, headers)?)
            }
        });
        let initialization = async {
            let initialize = client
                .command(
                    "initialize",
                    json!({
                        "protocolVersion": MCP_PROTOCOL_VERSION,
                        "capabilities": {},
                        "clientInfo": {"name": "rovai-pi-core", "version": "1"},
                    }),
                )
                .await
                .context("Pi MCP initialize failed")?;
            let negotiated = initialize
                .get("protocolVersion")
                .and_then(Value::as_str)
                .context("Pi MCP initialize omitted protocolVersion")?;
            if negotiated.trim().is_empty() {
                bail!("Pi MCP initialize returned an invalid protocolVersion");
            }
            client
                .notify("notifications/initialized", json!({}))
                .await?;
            Ok::<(), anyhow::Error>(())
        }
        .await;
        if let Err(error) = initialization {
            client.shutdown().await;
            return Err(error);
        }
        Ok(client)
    }

    async fn command(&self, method: &str, params: Value) -> Result<Value> {
        match self {
            Self::Stdio(client) => client.command(method, params).await,
            Self::StreamableHttp(client) => client.command(method, params).await,
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<()> {
        match self {
            Self::Stdio(client) => client.notify(method, params).await,
            Self::StreamableHttp(client) => client.notify(method, params).await,
        }
    }

    async fn list_tools(&self) -> Result<Vec<Value>> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MCP_MAX_LIST_PAGES {
            let result = self
                .command(
                    "tools/list",
                    cursor
                        .as_ref()
                        .map_or_else(|| json!({}), |cursor| json!({"cursor": cursor})),
                )
                .await?;
            let page = result
                .get("tools")
                .and_then(Value::as_array)
                .context("Pi MCP tools/list omitted tools")?;
            tools.extend(page.iter().cloned());
            cursor = result
                .get("nextCursor")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            if cursor.is_none() {
                return Ok(tools);
            }
        }
        bail!("Pi MCP tools/list exceeded the pagination limit")
    }

    async fn call_tool(&self, name: &str, arguments: Value) -> Result<Value> {
        self.command("tools/call", json!({"name": name, "arguments": arguments}))
            .await
    }

    async fn shutdown(&self) {
        match self {
            Self::Stdio(client) => client.shutdown().await,
            Self::StreamableHttp(client) => client.shutdown().await,
        }
    }

    fn mark_dead(&self) {
        match self {
            Self::Stdio(client) => client.alive.store(false, Ordering::Release),
            Self::StreamableHttp(client) => client.alive.store(false, Ordering::Release),
        }
    }
}

fn decode_http_json_rpc_response(
    response: &McpHttpResponse,
    expected_id: Option<&str>,
) -> Result<Option<Value>> {
    if response.body.is_empty() {
        return Ok(None);
    }
    let messages = if response.content_type.contains("text/event-stream") {
        decode_sse_json_messages(&response.body)?
    } else if response.content_type.contains("application/json") {
        vec![
            serde_json::from_slice::<Value>(&response.body)
                .context("Pi MCP HTTP response is invalid JSON")?,
        ]
    } else {
        bail!("Pi MCP HTTP response has an unsupported content type");
    };
    for message in messages {
        let response_id = message.get("id").and_then(super::value_id);
        if let Some(expected_id) = expected_id {
            if response_id.as_deref() != Some(expected_id) {
                continue;
            }
        } else if response_id.is_some() {
            bail!("Pi MCP notification returned an unexpected JSON-RPC response");
        } else {
            continue;
        }
        if let Some(error) = message.get("error") {
            bail!("MCP JSON-RPC error: {}", bounded_error(error));
        }
        return message
            .get("result")
            .cloned()
            .context("MCP JSON-RPC response omitted result")
            .map(Some);
    }
    Ok(None)
}

fn decode_sse_json_messages(bytes: &[u8]) -> Result<Vec<Value>> {
    let text = std::str::from_utf8(bytes).context("Pi MCP SSE response is not UTF-8")?;
    let mut messages = Vec::new();
    let mut data = Vec::new();
    for line in text.lines().chain(std::iter::once("")) {
        if line.is_empty() {
            if !data.is_empty() {
                messages.push(
                    serde_json::from_str::<Value>(&data.join("\n"))
                        .context("Pi MCP SSE data is invalid JSON")?,
                );
                data.clear();
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("data:") {
            data.push(value.strip_prefix(' ').unwrap_or(value));
        }
    }
    Ok(messages)
}

pub(crate) struct PiMcpBridge {
    tools: Vec<PiMcpToolDefinition>,
    tools_by_runtime_name: BTreeMap<String, PiMcpToolDefinition>,
    clients: BTreeMap<String, Arc<PiMcpClient>>,
    activation_failures: Vec<PiMcpActivationFailure>,
    projection_digest: String,
}

impl PiMcpBridge {
    pub(crate) async fn start(projection: &PreparedMcpProjection) -> Result<Arc<Self>> {
        let mut tools = Vec::new();
        let mut clients: BTreeMap<String, Arc<PiMcpClient>> = BTreeMap::new();
        let mut activation_failures = Vec::new();
        let mut seen_server_ids = BTreeSet::new();
        let mut source_identities = BTreeSet::new();
        let mut runtime_names = NATIVE_TOOL_NAMES
            .into_iter()
            .map(str::to_string)
            .collect::<BTreeSet<_>>();
        let preparation = async {
            for exposure in projection
                .snapshot
                .servers
                .iter()
                .filter(|entry| entry.status == McpExposureStatus::Ready)
            {
                let projection_name = if exposure.runtime_name.is_empty() {
                    &exposure.name
                } else {
                    &exposure.runtime_name
                };
                let definition = projection.servers.get(projection_name).with_context(|| {
                    format!("ready MCP Server {} has no definition", exposure.name)
                })?;
                if !seen_server_ids.insert(exposure.server_id.clone()) {
                    bail!("Pi MCP projection contains a duplicate Server identity");
                }
                let client = match PiMcpClient::spawn(&exposure.server_id, definition).await {
                    Ok(client) => client,
                    Err(error) => {
                        record_optional_activation_failure(
                            &mut activation_failures,
                            exposure,
                            definition,
                            PiMcpActivationStage::Start,
                            &error,
                        );
                        continue;
                    }
                };
                let listed = match client.list_tools().await {
                    Ok(listed) => listed,
                    Err(error) => {
                        client.shutdown().await;
                        record_optional_activation_failure(
                            &mut activation_failures,
                            exposure,
                            definition,
                            PiMcpActivationStage::ToolCatalog,
                            &error,
                        );
                        continue;
                    }
                };
                let mut staged_source_identities = source_identities.clone();
                let mut staged_runtime_names = runtime_names.clone();
                let prepared_tools = listed
                    .into_iter()
                    .map(|value| {
                        let tool_name = value
                            .get("name")
                            .and_then(Value::as_str)
                            .filter(|value| !value.trim().is_empty())
                            .context("Pi MCP tools/list returned a Tool without a name")?;
                        if !staged_source_identities
                            .insert((exposure.name.clone(), tool_name.to_string()))
                        {
                            bail!("Pi MCP tools/list returned a duplicate source identity");
                        }
                        let runtime_name = mcp_runtime_name(&exposure.name, tool_name);
                        if !staged_runtime_names.insert(runtime_name.clone()) {
                            bail!("Pi MCP proxy Tool name collision");
                        }
                        let description = value
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        if description.len() > MCP_DESCRIPTION_MAX_BYTES {
                            bail!("Pi MCP Tool description exceeds the model-input limit");
                        }
                        let input_schema = value
                            .get("inputSchema")
                            .filter(|value| value.is_object())
                            .cloned()
                            .context("Pi MCP Tool has no object inputSchema")?;
                        if input_schema.get("type").and_then(Value::as_str) != Some("object") {
                            bail!("Pi MCP Tool inputSchema must describe an object");
                        }
                        Ok(PiMcpToolDefinition {
                            server_id: exposure.server_id.clone(),
                            server_name: exposure.name.clone(),
                            tool_name: tool_name.to_string(),
                            runtime_name,
                            description_digest: canonical_json_digest(&json!(description))?,
                            input_schema_digest: canonical_json_digest(&input_schema)?,
                            description,
                            input_schema,
                        })
                    })
                    .collect::<Result<Vec<_>>>();
                let prepared_tools = match prepared_tools {
                    Ok(prepared_tools) => prepared_tools,
                    Err(error) => {
                        client.shutdown().await;
                        record_optional_activation_failure(
                            &mut activation_failures,
                            exposure,
                            definition,
                            PiMcpActivationStage::ToolCatalog,
                            &error,
                        );
                        continue;
                    }
                };
                source_identities = staged_source_identities;
                runtime_names = staged_runtime_names;
                clients.insert(exposure.server_id.clone(), client);
                tools.extend(prepared_tools);
            }
            Ok::<(), anyhow::Error>(())
        }
        .await;
        if let Err(error) = preparation {
            for client in clients.values() {
                client.shutdown().await;
            }
            return Err(error);
        }
        tools.sort_by(|left, right| left.runtime_name.cmp(&right.runtime_name));
        let tools_by_runtime_name = tools
            .iter()
            .map(|tool| (tool.runtime_name.clone(), tool.clone()))
            .collect();
        Ok(Arc::new(Self {
            tools,
            tools_by_runtime_name,
            clients,
            activation_failures,
            projection_digest: projection.projection_digest.clone(),
        }))
    }

    pub(crate) fn tools(&self) -> &[PiMcpToolDefinition] {
        &self.tools
    }

    pub(crate) fn projection_digest(&self) -> &str {
        &self.projection_digest
    }

    pub(crate) fn activation_failures(&self) -> &[PiMcpActivationFailure] {
        &self.activation_failures
    }

    pub(crate) fn tool(&self, runtime_name: &str) -> Option<&PiMcpToolDefinition> {
        self.tools_by_runtime_name.get(runtime_name)
    }

    pub(crate) async fn execute(&self, runtime_name: &str, arguments: Value) -> Result<Value> {
        let tool = self
            .tool(runtime_name)
            .context("Pi MCP bridge names an unknown proxy Tool")?;
        let client = self
            .clients
            .get(&tool.server_id)
            .context("Pi MCP bridge Server is unavailable")?;
        let result = client.call_tool(&tool.tool_name, arguments).await?;
        normalize_mcp_result(&result)
    }

    pub(crate) async fn shutdown(&self) {
        for client in self.clients.values() {
            client.shutdown().await;
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum PiMcpActivationStage {
    Start,
    ToolCatalog,
}

fn record_optional_activation_failure(
    failures: &mut Vec<PiMcpActivationFailure>,
    exposure: &rovai_core::mcp_projection::McpExposureEntry,
    definition: &McpServerDefinition,
    stage: PiMcpActivationStage,
    error: &anyhow::Error,
) {
    let error_chain = format!("{error:#}");
    let process_not_found = matches!(stage, PiMcpActivationStage::Start)
        && error.chain().any(|cause| {
            cause
                .downcast_ref::<std::io::Error>()
                .is_some_and(|error| error.kind() == std::io::ErrorKind::NotFound)
        });
    let relative_stdio_command = matches!(
        definition,
        McpServerDefinition::Stdio { command, .. }
            if {
                let path = Path::new(command);
                path.is_relative() && path.components().count() > 1
            }
    );
    let (diagnostic_code, reason) = if error_chain
        .contains("command is not available on Runtime PATH")
        || (process_not_found && !relative_stdio_command)
    {
        (
            "mcp.runtime_launch_failed",
            "executable_not_found_in_runtime_path",
        )
    } else if error_chain.contains("relative application is unavailable")
        || (process_not_found && relative_stdio_command)
    {
        (
            "mcp.runtime_launch_failed",
            "relative_executable_not_found_in_runtime_cwd",
        )
    } else {
        match stage {
            PiMcpActivationStage::Start => {
                ("mcp.activation_failed", "server_start_or_initialize_failed")
            }
            PiMcpActivationStage::ToolCatalog => {
                ("mcp.tool_catalog_unavailable", "server_tool_catalog_failed")
            }
        }
    };
    failures.push(PiMcpActivationFailure {
        server_id: exposure.server_id.clone(),
        server_name: exposure.name.clone(),
        diagnostic_code: diagnostic_code.to_string(),
        reason: reason.to_string(),
    });
}

impl Drop for PiMcpBridge {
    fn drop(&mut self) {
        for client in self.clients.values() {
            client.mark_dead();
        }
    }
}

fn mcp_runtime_name(server: &str, tool: &str) -> String {
    let direct = format!("mcp_{server}_{tool}");
    if server
        .bytes()
        .chain(tool.bytes())
        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        && direct.len() <= 64
    {
        return direct;
    }
    let server_slug = slug(server);
    let tool_slug = slug(tool);
    let digest = format!(
        "{:x}",
        Sha256::digest([server.as_bytes(), b"\0", tool.as_bytes()].concat())
    );
    format!(
        "mcp_{}_{}_{}",
        ascii_prefix(&server_slug, 16),
        ascii_prefix(&tool_slug, 23),
        &digest[..12]
    )
}

fn slug(value: &str) -> String {
    let mut output = String::new();
    let mut pending_separator = false;
    for character in value.chars() {
        let character = character.to_ascii_lowercase();
        if character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_' {
            if pending_separator && !output.is_empty() && !output.ends_with('_') {
                output.push('_');
            }
            pending_separator = false;
            output.push(character);
        } else {
            pending_separator = true;
        }
    }
    let output = output.trim_matches('_').to_string();
    if output.is_empty() {
        "x".to_string()
    } else {
        output
    }
}

fn ascii_prefix(value: &str, length: usize) -> &str {
    &value[..value.len().min(length)]
}

fn normalize_mcp_result(result: &Value) -> Result<Value> {
    let content = result
        .get("content")
        .and_then(Value::as_array)
        .context("MCP tools/call result omitted content")?;
    let mut normalized = Vec::with_capacity(content.len());
    for part in content {
        match part.get("type").and_then(Value::as_str) {
            Some("text") => {
                let text = part
                    .get("text")
                    .and_then(Value::as_str)
                    .context("MCP Text content omitted text")?;
                normalized.push(json!({"type":"text", "text":text}));
            }
            Some("image") => {
                let data = part
                    .get("data")
                    .and_then(Value::as_str)
                    .context("MCP Image content omitted data")?;
                let mime_type = part
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .filter(|value| value.starts_with("image/"))
                    .context("MCP Image content has an invalid MIME type")?;
                BASE64
                    .decode(data)
                    .context("MCP Image content is not valid base64")?;
                normalized.push(json!({"type":"image", "data":data, "mimeType":mime_type}));
            }
            Some("resource" | "resource_link") => {
                normalized.push(json!({
                    "type":"text",
                    "text": serde_json::to_string(part).unwrap_or_else(|_| "MCP resource metadata was unavailable".to_string()),
                }));
            }
            _ => bail!("MCP Tool returned an unsupported content kind"),
        }
    }
    let value = json!({
        "content": normalized,
        "isError": result.get("isError").and_then(Value::as_bool).unwrap_or(false),
    });
    if serde_json::to_vec(&value)?.len() > PI_MAX_JSONL_RECORD_BYTES {
        bail!("MCP Tool result exceeds the Pi bridge limit");
    }
    Ok(value)
}

fn bounded_error(error: &Value) -> String {
    let encoded = error.to_string();
    encoded.chars().take(2_000).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rovai_core::{
        agent_runtime_adapter::{ExternalMcpProjection, McpSameNamePolicy},
        mcp_projection::{McpExposureEntry, McpExposureSnapshot},
    };
    use tokio::io::AsyncReadExt;

    #[test]
    fn runtime_names_follow_direct_and_fallback_contract() {
        assert_eq!(
            mcp_runtime_name("github", "search_code"),
            "mcp_github_search_code"
        );
        let fallback = mcp_runtime_name("Git Hub", "搜索/Code");
        assert!(fallback.starts_with("mcp_git_hub_code_"));
        assert!(fallback.len() <= 64);
        assert!(
            fallback
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        );
    }

    #[tokio::test]
    async fn stdio_bridge_initializes_lists_and_calls_a_real_server() {
        let fixture =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/mcp-smoke-server.mjs");
        let cwd = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let node_name = if cfg!(windows) { "node.exe" } else { "node" };
        let node = std::env::var_os("PATH")
            .into_iter()
            .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
            .map(|path| path.join(node_name))
            .find(|path| path.is_file())
            .and_then(|path| path.canonicalize().ok())
            .expect("Node.js is required for the MCP process fixture");
        let runtime_path = std::env::join_paths([node.parent().unwrap()])
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut servers = BTreeMap::new();
        servers.insert(
            "github".to_string(),
            McpServerDefinition::Stdio {
                command: "node".to_string(),
                args: vec![fixture.to_string_lossy().to_string()],
                cwd: Some(cwd.to_string_lossy().to_string()),
                env: BTreeMap::from([
                    ("PATH".to_string(), runtime_path),
                    (
                        "ROVAI_MCP_SMOKE_SOURCE".to_string(),
                        "pi-core-bridge".to_string(),
                    ),
                ]),
            },
        );
        let projection = PreparedMcpProjection {
            snapshot: McpExposureSnapshot {
                schema_version: 2,
                config_digest: "sha256:pi-mcp-fixture-config".to_string(),
                config_status: "ready".to_string(),
                projection_mode: ExternalMcpProjection::AdditivePerRun,
                same_name_policy: Some(McpSameNamePolicy::RovaiWins),
                warnings: Vec::new(),
                servers: vec![McpExposureEntry {
                    server_id: "pi-mcp-fixture-server".to_string(),
                    name: "github".to_string(),
                    runtime_name: "github".to_string(),
                    transport: "stdio".to_string(),
                    config_digest: "sha256:pi-mcp-fixture-server-config".to_string(),
                    status: McpExposureStatus::Ready,
                    reason: None,
                }],
            },
            exposure_digest: "sha256:pi-mcp-fixture-exposure".to_string(),
            projection_digest: "sha256:pi-mcp-fixture-projection".to_string(),
            canonical_path: cwd.join("target/pi-mcp-fixture.json"),
            servers,
        };

        let bridge = PiMcpBridge::start(&projection).await.unwrap();
        assert!(matches!(
            &projection.servers["github"],
            McpServerDefinition::Stdio { command, .. } if command == "node"
        ));
        assert_eq!(bridge.tools().len(), 1);
        assert_eq!(bridge.tools()[0].runtime_name, "mcp_github_echo");
        assert!(bridge.activation_failures().is_empty());
        assert_eq!(
            bridge
                .execute("mcp_github_echo", json!({"text":"ok"}))
                .await
                .unwrap(),
            json!({
                "content": [{"type":"text", "text":"pi-core-bridge:ok"}],
                "isError": false,
            })
        );
        bridge.shutdown().await;
    }

    #[tokio::test]
    async fn unavailable_optional_server_does_not_block_a_ready_pi_mcp_server() {
        let fixture =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/mcp-smoke-server.mjs");
        let cwd = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let node_name = if cfg!(windows) { "node.exe" } else { "node" };
        let node = std::env::var_os("PATH")
            .into_iter()
            .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
            .map(|path| path.join(node_name))
            .find(|path| path.is_file())
            .and_then(|path| path.canonicalize().ok())
            .expect("Node.js is required for the MCP process fixture");
        let runtime_path = std::env::join_paths([node.parent().unwrap()])
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let missing_command = format!("rovai-missing-mcp-{}", uuid::Uuid::new_v4());
        let mut servers = BTreeMap::new();
        servers.insert(
            "broken".to_string(),
            McpServerDefinition::Stdio {
                command: missing_command,
                args: Vec::new(),
                cwd: Some(cwd.to_string_lossy().to_string()),
                env: BTreeMap::from([("PATH".to_string(), runtime_path.clone())]),
            },
        );
        servers.insert(
            "github".to_string(),
            McpServerDefinition::Stdio {
                command: "node".to_string(),
                args: vec![fixture.to_string_lossy().to_string()],
                cwd: Some(cwd.to_string_lossy().to_string()),
                env: BTreeMap::from([
                    ("PATH".to_string(), runtime_path),
                    (
                        "ROVAI_MCP_SMOKE_SOURCE".to_string(),
                        "pi-core-bridge".to_string(),
                    ),
                ]),
            },
        );
        let projection = PreparedMcpProjection {
            snapshot: McpExposureSnapshot {
                schema_version: 2,
                config_digest: "sha256:pi-mcp-optional-config".to_string(),
                config_status: "ready".to_string(),
                projection_mode: ExternalMcpProjection::AdditivePerRun,
                same_name_policy: Some(McpSameNamePolicy::RovaiWins),
                warnings: Vec::new(),
                servers: vec![
                    McpExposureEntry {
                        server_id: "pi-mcp-broken-server".to_string(),
                        name: "broken".to_string(),
                        runtime_name: "broken".to_string(),
                        transport: "stdio".to_string(),
                        config_digest: "sha256:pi-mcp-broken-config".to_string(),
                        status: McpExposureStatus::Ready,
                        reason: None,
                    },
                    McpExposureEntry {
                        server_id: "pi-mcp-ready-server".to_string(),
                        name: "github".to_string(),
                        runtime_name: "github".to_string(),
                        transport: "stdio".to_string(),
                        config_digest: "sha256:pi-mcp-ready-config".to_string(),
                        status: McpExposureStatus::Ready,
                        reason: None,
                    },
                ],
            },
            exposure_digest: "sha256:pi-mcp-optional-exposure".to_string(),
            projection_digest: "sha256:pi-mcp-optional-projection".to_string(),
            canonical_path: cwd.join("target/pi-mcp-optional-fixture.json"),
            servers,
        };

        let bridge = PiMcpBridge::start(&projection)
            .await
            .expect("an unavailable optional Server must not block the Pi MCP bridge");
        assert!(matches!(
            &projection.servers["github"],
            McpServerDefinition::Stdio { command, .. } if command == "node"
        ));
        assert_eq!(bridge.tools().len(), 1);
        assert_eq!(bridge.tools()[0].runtime_name, "mcp_github_echo");
        assert_eq!(
            bridge.activation_failures(),
            [PiMcpActivationFailure {
                server_id: "pi-mcp-broken-server".to_string(),
                server_name: "broken".to_string(),
                diagnostic_code: "mcp.runtime_launch_failed".to_string(),
                reason: "executable_not_found_in_runtime_path".to_string(),
            }]
        );
        assert_eq!(
            bridge
                .execute("mcp_github_echo", json!({"text":"still-running"}))
                .await
                .unwrap(),
            json!({
                "content": [{"type":"text", "text":"pi-core-bridge:still-running"}],
                "isError": false,
            })
        );
        bridge.shutdown().await;
    }

    #[tokio::test]
    async fn streamable_http_bridge_preserves_session_and_handles_sse() {
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for index in 0..5 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let request = read_http_fixture_request(&mut stream).await;
                let request_text = String::from_utf8(request.clone()).unwrap();
                let body = request
                    .windows(4)
                    .position(|window| window == b"\r\n\r\n")
                    .map(|offset| &request[offset + 4..])
                    .unwrap_or_default();
                let value =
                    (!body.is_empty()).then(|| serde_json::from_slice::<Value>(body).unwrap());
                let (status, content_type, session_header, response_body) = match index {
                    0 => (
                        "200 OK",
                        "application/json",
                        "Mcp-Session-Id: pi-http-session\r\n",
                        json!({
                            "jsonrpc":"2.0",
                            "id": value.as_ref().unwrap()["id"],
                            "result": {"protocolVersion":MCP_PROTOCOL_VERSION,"capabilities":{},"serverInfo":{"name":"fixture","version":"1"}}
                        })
                        .to_string(),
                    ),
                    1 => ("202 Accepted", "application/json", "", String::new()),
                    2 => (
                        "200 OK",
                        "text/event-stream",
                        "",
                        format!(
                            "data: {}\n\n",
                            json!({
                                "jsonrpc":"2.0",
                                "id": value.as_ref().unwrap()["id"],
                                "result":{"tools":[{"name":"echo","description":"Echo","inputSchema":{"type":"object"}}]}
                            })
                        ),
                    ),
                    3 => (
                        "200 OK",
                        "application/json",
                        "",
                        json!({
                            "jsonrpc":"2.0",
                            "id": value.as_ref().unwrap()["id"],
                            "result":{"content":[{"type":"text","text":"http-ok"}],"isError":false}
                        })
                        .to_string(),
                    ),
                    _ => ("204 No Content", "application/json", "", String::new()),
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\n{session_header}Content-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
                    response_body.len()
                );
                stream.write_all(response.as_bytes()).await.unwrap();
                requests.push(request_text);
            }
            requests
        });

        let cwd = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let mut servers = BTreeMap::new();
        servers.insert(
            "remote".to_string(),
            McpServerDefinition::StreamableHttp {
                url: format!("http://{address}/mcp"),
                headers: BTreeMap::from([(
                    "Authorization".to_string(),
                    "Bearer private-fixture".to_string(),
                )]),
            },
        );
        let projection = PreparedMcpProjection {
            snapshot: McpExposureSnapshot {
                schema_version: 2,
                config_digest: "sha256:pi-http-config".to_string(),
                config_status: "ready".to_string(),
                projection_mode: ExternalMcpProjection::AdditivePerRun,
                same_name_policy: Some(McpSameNamePolicy::RovaiWins),
                warnings: Vec::new(),
                servers: vec![McpExposureEntry {
                    server_id: "pi-http-server".to_string(),
                    name: "remote".to_string(),
                    runtime_name: "remote".to_string(),
                    transport: "streamable_http".to_string(),
                    config_digest: "sha256:pi-http-server-config".to_string(),
                    status: McpExposureStatus::Ready,
                    reason: None,
                }],
            },
            exposure_digest: "sha256:pi-http-exposure".to_string(),
            projection_digest: "sha256:pi-http-projection".to_string(),
            canonical_path: cwd.join("target/pi-http-mcp-fixture.json"),
            servers,
        };
        let bridge = PiMcpBridge::start(&projection).await.unwrap();
        assert_eq!(bridge.tools()[0].runtime_name, "mcp_remote_echo");
        assert_eq!(
            bridge
                .execute("mcp_remote_echo", json!({"text":"ok"}))
                .await
                .unwrap(),
            json!({"content":[{"type":"text","text":"http-ok"}],"isError":false})
        );
        bridge.shutdown().await;
        let requests = server.await.unwrap();
        assert!(requests.iter().all(|request| {
            request
                .to_ascii_lowercase()
                .contains("authorization: bearer private-fixture")
        }));
        assert!(requests.iter().skip(1).all(|request| {
            request
                .to_ascii_lowercase()
                .contains("mcp-session-id: pi-http-session")
        }));
        assert!(requests.iter().skip(1).all(|request| {
            request
                .to_ascii_lowercase()
                .contains("mcp-protocol-version: 2025-06-18")
        }));
        assert!(requests[4].starts_with("DELETE /mcp "));
    }

    async fn read_http_fixture_request(stream: &mut tokio::net::TcpStream) -> Vec<u8> {
        let mut request = Vec::new();
        let mut buffer = [0_u8; 2048];
        let mut expected_length = None;
        loop {
            let read = stream.read(&mut buffer).await.unwrap();
            assert!(read > 0);
            request.extend_from_slice(&buffer[..read]);
            if expected_length.is_none()
                && let Some(header_end) = request.windows(4).position(|value| value == b"\r\n\r\n")
            {
                let headers = String::from_utf8_lossy(&request[..header_end]).to_ascii_lowercase();
                let content_length = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length:"))
                    .map(str::trim)
                    .map(|value| value.parse::<usize>().unwrap())
                    .unwrap_or(0);
                expected_length = Some(header_end + 4 + content_length);
            }
            if expected_length.is_some_and(|length| request.len() >= length) {
                return request;
            }
        }
    }
}
