use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

use anyhow::{Context, Result, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
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

#[derive(Debug)]
struct PendingMcpCommand {
    sender: oneshot::Sender<std::result::Result<Value, String>>,
}

struct PiMcpClient {
    server_id: String,
    child: Mutex<ManagedProcess>,
    stdin: Mutex<ManagedChildStdin>,
    pending: Mutex<HashMap<String, PendingMcpCommand>>,
    next_id: AtomicU64,
    alive: AtomicBool,
}

impl PiMcpClient {
    async fn spawn(server_id: &str, definition: &McpServerDefinition) -> Result<Arc<Self>> {
        let McpServerDefinition::Stdio {
            command,
            args,
            cwd,
            env,
        } = definition
        else {
            bail!("Pi only supports stdio MCP Servers");
        };
        let cwd = cwd
            .as_deref()
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

pub(crate) struct PiMcpBridge {
    tools: Vec<PiMcpToolDefinition>,
    tools_by_runtime_name: BTreeMap<String, PiMcpToolDefinition>,
    clients: BTreeMap<String, Arc<PiMcpClient>>,
    projection_digest: String,
}

impl PiMcpBridge {
    pub(crate) async fn start(projection: &PreparedMcpProjection) -> Result<Arc<Self>> {
        let mut tools = Vec::new();
        let mut clients: BTreeMap<String, Arc<PiMcpClient>> = BTreeMap::new();
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
                let client = PiMcpClient::spawn(&exposure.server_id, definition).await?;
                if clients.contains_key(&exposure.server_id) {
                    client.shutdown().await;
                    bail!("Pi MCP projection contains a duplicate Server identity");
                }
                clients.insert(exposure.server_id.clone(), client.clone());
                let listed = client.list_tools().await?;
                for value in listed {
                    let tool_name = value
                        .get("name")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .context("Pi MCP tools/list returned a Tool without a name")?;
                    if !source_identities.insert((exposure.name.clone(), tool_name.to_string())) {
                        bail!("Pi MCP tools/list returned a duplicate source identity");
                    }
                    let runtime_name = mcp_runtime_name(&exposure.name, tool_name);
                    if !runtime_names.insert(runtime_name.clone()) {
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
                    tools.push(PiMcpToolDefinition {
                        server_id: exposure.server_id.clone(),
                        server_name: exposure.name.clone(),
                        tool_name: tool_name.to_string(),
                        runtime_name,
                        description_digest: canonical_json_digest(&json!(description))?,
                        input_schema_digest: canonical_json_digest(&input_schema)?,
                        description,
                        input_schema,
                    });
                }
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
            projection_digest: projection.projection_digest.clone(),
        }))
    }

    pub(crate) fn tools(&self) -> &[PiMcpToolDefinition] {
        &self.tools
    }

    pub(crate) fn projection_digest(&self) -> &str {
        &self.projection_digest
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

impl Drop for PiMcpBridge {
    fn drop(&mut self) {
        for client in self.clients.values() {
            client.alive.store(false, Ordering::Release);
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
        let mut servers = BTreeMap::new();
        servers.insert(
            "github".to_string(),
            McpServerDefinition::Stdio {
                command: node.to_string_lossy().to_string(),
                args: vec![fixture.to_string_lossy().to_string()],
                cwd: Some(cwd.to_string_lossy().to_string()),
                env: BTreeMap::from([(
                    "ROVAI_MCP_SMOKE_SOURCE".to_string(),
                    "pi-core-bridge".to_string(),
                )]),
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
        assert_eq!(bridge.tools().len(), 1);
        assert_eq!(bridge.tools()[0].runtime_name, "mcp_github_echo");
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
}
