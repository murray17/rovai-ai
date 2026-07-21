use std::{
    env,
    path::{Path, PathBuf},
    process::Stdio,
    sync::OnceLock,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use lumen_core::agent_runtime_adapter::executable_fingerprint;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::Mutex,
    time::timeout,
};

const CODEX_RUNTIME_KIND: &str = "codex-cli";
const CODEX_PROBE_CACHE_TTL: Duration = Duration::from_secs(60);

static CODEX_PROBE_CACHE: OnceLock<Mutex<Option<CachedProbe>>> = OnceLock::new();

const REQUIRED_CODEX_CAPABILITIES: &[(&str, &str, &str)] = &[
    ("model.list", "ClientRequest.json", "\"model/list\""),
    ("thread.start", "ClientRequest.json", "\"thread/start\""),
    ("thread.resume", "ClientRequest.json", "\"thread/resume\""),
    ("turn.start", "ClientRequest.json", "\"turn/start\""),
    ("turn.interrupt", "ClientRequest.json", "\"turn/interrupt\""),
    (
        "event.agent_message",
        "ServerNotification.json",
        "\"item/agentMessage/delta\"",
    ),
    (
        "event.turn_terminal",
        "ServerNotification.json",
        "\"turn/completed\"",
    ),
    (
        "approval.command_request",
        "ServerRequest.json",
        "\"item/commandExecution/requestApproval\"",
    ),
    (
        "approval.file_request",
        "ServerRequest.json",
        "\"item/fileChange/requestApproval\"",
    ),
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandHealth {
    installed: bool,
    version: Option<String>,
    authenticated: Option<bool>,
    detail: Option<String>,
    path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRuntimeProbeStatus {
    Ready,
    NotInstalled,
    AuthenticationRequired,
    MissingCapabilities,
    ProbeFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeProbeResult {
    pub runtime_kind: String,
    pub executable_path: Option<String>,
    pub reported_version: Option<String>,
    pub executable_fingerprint: Option<String>,
    pub status: AgentRuntimeProbeStatus,
    pub capabilities: Vec<String>,
    pub missing_capabilities: Vec<String>,
    pub detail: Option<String>,
    pub probed_at: String,
}

impl AgentRuntimeProbeResult {
    pub fn is_ready(&self) -> bool {
        self.status == AgentRuntimeProbeStatus::Ready
    }
}

#[derive(Debug, Clone)]
struct CachedProbe {
    cached_at: std::time::Instant,
    executable_path: String,
    executable_fingerprint: Option<String>,
    result: AgentRuntimeProbeResult,
}

pub async fn git_health() -> CommandHealth {
    command_health("git", &["--version"], None).await
}

pub async fn codex_runtime_probe() -> AgentRuntimeProbeResult {
    codex_runtime_probe_with_refresh(false).await
}

pub async fn refresh_codex_runtime_probe() -> AgentRuntimeProbeResult {
    codex_runtime_probe_with_refresh(true).await
}

pub async fn codex_runtime_probe_at(path: &Path) -> AgentRuntimeProbeResult {
    let probed_at = chrono::Utc::now().to_rfc3339();
    if !path.is_file() {
        return probe_result(
            Some(path.to_string_lossy().to_string()),
            None,
            None,
            AgentRuntimeProbeStatus::NotInstalled,
            Vec::new(),
            required_capability_names(),
            Some("Configured Codex executable does not exist.".into()),
            probed_at,
        );
    }
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let path_text = path.to_string_lossy().to_string();
    let fingerprint = executable_fingerprint(&path).ok();
    codex_runtime_probe_uncached(path, path_text, fingerprint, probed_at).await
}

pub async fn codex_model_catalog(path: &Path) -> Result<Value> {
    let mut child = Command::new(path)
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("failed to start {} app-server", path.display()))?;
    let mut stdin = child
        .stdin
        .take()
        .context("app-server stdin was unavailable")?;
    let stdout = child
        .stdout
        .take()
        .context("app-server stdout was unavailable")?;

    let query = async {
        write_json_line(
            &mut stdin,
            &json!({
                "method": "initialize",
                "id": 1,
                "params": {
                    "clientInfo": {
                        "name": "lumen_ai_probe",
                        "title": "Lumen AI Runtime Probe",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }
            }),
        )
        .await?;
        let mut lines = BufReader::new(stdout).lines();
        read_rpc_result(&mut lines, 1).await?;
        write_json_line(&mut stdin, &json!({"method": "initialized", "params": {}})).await?;

        let mut models = Vec::new();
        let mut cursor: Option<String> = None;
        let mut request_id = 2_u64;
        loop {
            write_json_line(
                &mut stdin,
                &json!({
                    "method": "model/list",
                    "id": request_id,
                    "params": {
                        "cursor": cursor,
                        "includeHidden": true,
                        "limit": 100
                    }
                }),
            )
            .await?;
            let result = read_rpc_result(&mut lines, request_id).await?;
            let page = result
                .get("data")
                .and_then(Value::as_array)
                .context("model/list result did not include data")?;
            models.extend(page.iter().cloned());
            cursor = result
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(str::to_string);
            if cursor.is_none() {
                break;
            }
            request_id += 1;
            if request_id > 101 {
                bail!("model/list exceeded the pagination safety limit");
            }
        }
        Ok::<_, anyhow::Error>(json!({"data": models}))
    };

    let result = timeout(Duration::from_secs(30), query)
        .await
        .context("model/list timed out")?;
    let _ = child.kill().await;
    let _ = child.wait().await;
    result
}

async fn write_json_line(stdin: &mut tokio::process::ChildStdin, value: &Value) -> Result<()> {
    stdin
        .write_all(serde_json::to_string(value)?.as_bytes())
        .await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}

async fn read_rpc_result(
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    request_id: u64,
) -> Result<Value> {
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let message: Value =
            serde_json::from_str(&line).with_context(|| format!("invalid RPC response: {line}"))?;
        if message.get("id").and_then(Value::as_u64) != Some(request_id) {
            continue;
        }
        if let Some(error) = message.get("error") {
            bail!("RPC request {request_id} was rejected: {error}");
        }
        return message
            .get("result")
            .cloned()
            .context("RPC result was missing");
    }
    bail!("app-server exited before RPC request {request_id} completed")
}

async fn codex_runtime_probe_with_refresh(force_refresh: bool) -> AgentRuntimeProbeResult {
    let probed_at = chrono::Utc::now().to_rfc3339();
    let Some(path) = find_codex() else {
        return probe_result(
            None,
            None,
            None,
            AgentRuntimeProbeStatus::NotInstalled,
            Vec::new(),
            required_capability_names(),
            Some("Codex CLI was not found in PATH or a common install location.".into()),
            probed_at,
        );
    };
    let path_text = path.to_string_lossy().to_string();
    let fingerprint = executable_fingerprint(&path).ok();

    let cache = CODEX_PROBE_CACHE.get_or_init(|| Mutex::new(None));
    let mut cached = cache.lock().await;
    if !force_refresh
        && let Some(entry) = cached.as_ref()
        && entry.cached_at.elapsed() < CODEX_PROBE_CACHE_TTL
        && entry.executable_path == path_text
        && entry.executable_fingerprint == fingerprint
    {
        return entry.result.clone();
    }

    let result =
        codex_runtime_probe_uncached(path, path_text.clone(), fingerprint.clone(), probed_at).await;
    *cached = Some(CachedProbe {
        cached_at: std::time::Instant::now(),
        executable_path: path_text,
        executable_fingerprint: fingerprint,
        result: result.clone(),
    });
    result
}

async fn codex_runtime_probe_uncached(
    path: PathBuf,
    path_text: String,
    fingerprint: Option<String>,
    probed_at: String,
) -> AgentRuntimeProbeResult {
    let version_output = match Command::new(&path).arg("--version").output().await {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            return probe_result(
                Some(path_text),
                None,
                fingerprint,
                AgentRuntimeProbeStatus::ProbeFailed,
                Vec::new(),
                required_capability_names(),
                Some(command_detail(
                    &output.stdout,
                    &output.stderr,
                    "Codex version check failed",
                )),
                probed_at,
            );
        }
        Err(error) => {
            return probe_result(
                Some(path_text),
                None,
                fingerprint,
                AgentRuntimeProbeStatus::ProbeFailed,
                Vec::new(),
                required_capability_names(),
                Some(format!("failed to inspect Codex CLI: {error}")),
                probed_at,
            );
        }
    };
    let reported_version = Some(
        String::from_utf8_lossy(&version_output.stdout)
            .trim()
            .to_string(),
    );

    match Command::new(&path).args(["login", "status"]).output().await {
        Ok(output) if output.status.success() => {}
        Ok(output) => {
            return probe_result(
                Some(path_text),
                reported_version,
                fingerprint,
                AgentRuntimeProbeStatus::AuthenticationRequired,
                Vec::new(),
                required_capability_names(),
                Some(command_detail(
                    &output.stdout,
                    &output.stderr,
                    "Codex authentication is required",
                )),
                probed_at,
            );
        }
        Err(error) => {
            return probe_result(
                Some(path_text),
                reported_version,
                fingerprint,
                AgentRuntimeProbeStatus::ProbeFailed,
                Vec::new(),
                required_capability_names(),
                Some(format!("failed to inspect Codex authentication: {error}")),
                probed_at,
            );
        }
    }

    if let Err(error) = probe_initialize_handshake(&path).await {
        return probe_result(
            Some(path_text),
            reported_version,
            fingerprint,
            AgentRuntimeProbeStatus::ProbeFailed,
            Vec::new(),
            required_capability_names(),
            Some(format!("Codex app-server handshake failed: {error:#}")),
            probed_at,
        );
    }

    let (mut capabilities, missing_capabilities) = match probe_schema_capabilities(&path).await {
        Ok(result) => result,
        Err(error) => {
            return probe_result(
                Some(path_text),
                reported_version,
                fingerprint,
                AgentRuntimeProbeStatus::ProbeFailed,
                vec!["app_server.initialize".into()],
                required_capability_names(),
                Some(format!("Codex capability schema probe failed: {error:#}")),
                probed_at,
            );
        }
    };
    capabilities.insert(0, "app_server.initialize".into());

    let status = if missing_capabilities.is_empty() {
        AgentRuntimeProbeStatus::Ready
    } else {
        AgentRuntimeProbeStatus::MissingCapabilities
    };
    let detail = (!missing_capabilities.is_empty()).then(|| {
        format!(
            "Codex app-server is missing required capabilities: {}",
            missing_capabilities.join(", ")
        )
    });
    probe_result(
        Some(path_text),
        reported_version,
        fingerprint,
        status,
        capabilities,
        missing_capabilities,
        detail,
        probed_at,
    )
}

async fn probe_initialize_handshake(path: &Path) -> Result<()> {
    let mut child = Command::new(path)
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("failed to start {} app-server", path.display()))?;
    let mut stdin = child
        .stdin
        .take()
        .context("app-server stdin was unavailable")?;
    let stdout = child
        .stdout
        .take()
        .context("app-server stdout was unavailable")?;

    let handshake = async {
        let initialize = json!({
            "method": "initialize",
            "id": 1,
            "params": {
                "clientInfo": {
                    "name": "lumen_ai_probe",
                    "title": "Lumen AI Runtime Probe",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        });
        stdin
            .write_all(serde_json::to_string(&initialize)?.as_bytes())
            .await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;

        let mut lines = BufReader::new(stdout).lines();
        while let Some(line) = lines.next_line().await? {
            if line.trim().is_empty() {
                continue;
            }
            let message: Value = serde_json::from_str(&line)
                .with_context(|| format!("invalid initialize response: {line}"))?;
            if message.get("id").and_then(Value::as_u64) != Some(1) {
                continue;
            }
            if let Some(error) = message.get("error") {
                bail!("initialize was rejected: {error}");
            }
            let result = message
                .get("result")
                .context("initialize result was missing")?;
            if result.get("userAgent").and_then(Value::as_str).is_none() {
                bail!("initialize result did not include userAgent");
            }
            stdin
                .write_all(
                    serde_json::to_string(&json!({"method": "initialized", "params": {}}))?
                        .as_bytes(),
                )
                .await?;
            stdin.write_all(b"\n").await?;
            stdin.flush().await?;
            return Ok(());
        }
        bail!("app-server exited before initialize completed")
    };

    let result = timeout(Duration::from_secs(15), handshake)
        .await
        .context("initialize timed out")?;
    let _ = child.kill().await;
    let _ = child.wait().await;
    result
}

async fn probe_schema_capabilities(path: &Path) -> Result<(Vec<String>, Vec<String>)> {
    let schema_dir =
        env::temp_dir().join(format!("lumen-codex-schema-probe-{}", uuid::Uuid::new_v4()));
    let output = timeout(
        Duration::from_secs(20),
        Command::new(path)
            .args(["app-server", "generate-json-schema", "--out"])
            .arg(&schema_dir)
            .output(),
    )
    .await
    .context("schema generation timed out")??;
    if !output.status.success() {
        let detail = command_detail(
            &output.stdout,
            &output.stderr,
            "generate-json-schema failed",
        );
        let _ = std::fs::remove_dir_all(&schema_dir);
        bail!(detail);
    }
    let result = detect_schema_capabilities(&schema_dir).map(|(mut capabilities, mut missing)| {
        let correlation_present = [
            "v2/ThreadStartResponse.json",
            "v2/TurnStartResponse.json",
            "v2/ItemStartedNotification.json",
        ]
        .iter()
        .all(|relative| schema_dir.join(relative).is_file());
        if correlation_present {
            capabilities.push("correlation.thread_turn_item".into());
        } else {
            missing.push("correlation.thread_turn_item".into());
        }
        (capabilities, missing)
    });
    let _ = std::fs::remove_dir_all(&schema_dir);
    result
}

fn detect_schema_capabilities(schema_dir: &Path) -> Result<(Vec<String>, Vec<String>)> {
    let mut documents = std::collections::HashMap::new();
    for (_, file_name, _) in REQUIRED_CODEX_CAPABILITIES {
        if documents.contains_key(*file_name) {
            continue;
        }
        let body = std::fs::read_to_string(schema_dir.join(file_name))
            .with_context(|| format!("missing generated schema {file_name}"))?;
        documents.insert(*file_name, body);
    }
    let mut capabilities = Vec::new();
    let mut missing = Vec::new();
    for (capability, file_name, token) in REQUIRED_CODEX_CAPABILITIES {
        if documents
            .get(file_name)
            .is_some_and(|document| document.contains(token))
        {
            capabilities.push((*capability).to_string());
        } else {
            missing.push((*capability).to_string());
        }
    }
    Ok((capabilities, missing))
}

fn command_detail(stdout: &[u8], stderr: &[u8], fallback: &str) -> String {
    let stdout = String::from_utf8_lossy(stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    if !stdout.is_empty() {
        stdout
    } else if !stderr.is_empty() {
        stderr
    } else {
        fallback.to_string()
    }
}

#[allow(clippy::too_many_arguments)]
fn probe_result(
    executable_path: Option<String>,
    reported_version: Option<String>,
    executable_fingerprint: Option<String>,
    status: AgentRuntimeProbeStatus,
    capabilities: Vec<String>,
    missing_capabilities: Vec<String>,
    detail: Option<String>,
    probed_at: String,
) -> AgentRuntimeProbeResult {
    AgentRuntimeProbeResult {
        runtime_kind: CODEX_RUNTIME_KIND.into(),
        executable_path,
        reported_version,
        executable_fingerprint,
        status,
        capabilities,
        missing_capabilities,
        detail,
        probed_at,
    }
}

fn required_capability_names() -> Vec<String> {
    let mut result = vec!["app_server.initialize".into()];
    result.extend(
        REQUIRED_CODEX_CAPABILITIES
            .iter()
            .map(|(capability, _, _)| (*capability).to_string()),
    );
    result.push("correlation.thread_turn_item".into());
    result
}

async fn command_health(command: &str, args: &[&str], path: Option<PathBuf>) -> CommandHealth {
    let executable = path.unwrap_or_else(|| PathBuf::from(command));
    match Command::new(&executable).args(args).output().await {
        Ok(output) if output.status.success() => CommandHealth {
            installed: true,
            version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            authenticated: None,
            detail: None,
            path: Some(executable.to_string_lossy().to_string()),
        },
        Ok(output) => CommandHealth {
            installed: false,
            version: None,
            authenticated: None,
            detail: Some(command_detail(
                &output.stdout,
                &output.stderr,
                "command failed",
            )),
            path: None,
        },
        Err(error) => CommandHealth {
            installed: false,
            version: None,
            authenticated: None,
            detail: Some(error.to_string()),
            path: None,
        },
    }
}

pub fn find_codex() -> Option<PathBuf> {
    if let Some(path) = env::var_os("LUMEN_CODEX_BIN").map(PathBuf::from)
        && path.is_file()
    {
        return Some(path);
    }

    if let Some(paths) = env::var_os("PATH") {
        for directory in env::split_paths(&paths) {
            let candidate = directory.join("codex");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
    ];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin/codex"));
        candidates.push(home.join(".npm-global/bin/codex"));
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_schema_is_used_as_a_capability_contract() {
        let directory = env::temp_dir().join(format!(
            "lumen-health-capability-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).expect("temporary schema directory should exist");
        std::fs::write(
            directory.join("ClientRequest.json"),
            r#"["thread/start","thread/resume","turn/start","turn/interrupt"]"#,
        )
        .expect("request schema should be written");
        std::fs::write(
            directory.join("ServerNotification.json"),
            r#"["item/agentMessage/delta","turn/completed"]"#,
        )
        .expect("notification schema should be written");
        std::fs::write(
            directory.join("ServerRequest.json"),
            r#"["item/commandExecution/requestApproval"]"#,
        )
        .expect("server request schema should be written");

        let (capabilities, missing) =
            detect_schema_capabilities(&directory).expect("schema should be inspected");
        assert!(capabilities.contains(&"thread.start".to_string()));
        assert!(missing.contains(&"approval.file_request".to_string()));
        assert!(!missing.contains(&"approval.command_request".to_string()));
        std::fs::remove_dir_all(directory).expect("temporary schema directory should be removed");
    }
}
