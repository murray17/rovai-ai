use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};

use anyhow::{Context, Result};
use rovai_core::{
    agent_profile::FrozenAgentRuntimeConfig,
    agent_runtime_adapter::CLAUDE_CODE_RUNTIME_DEFAULT_MODEL_ID,
    mcp::McpServerDefinition,
    runtime::{AgentRunWorkspace, PermissionSemantics},
    runtime_discovery::configure_active_runtime_command,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::{Mutex, oneshot},
    time::{Duration, Instant},
};

use rovai_core::team_tool::TEAM_TOOL_NAMES;

use crate::team_runtime::{
    TEAM_MCP_SERVER_NAME, TeamToolProcessConfig, remove_stale_team_tool_configs,
};

const MAX_CAPTURE_BYTES: usize = 2 * 1024 * 1024;

pub struct ClaudeCodeRunRequest {
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub workspace: AgentRunWorkspace,
    pub permission_semantics: PermissionSemantics,
    pub runtime: FrozenAgentRuntimeConfig,
    pub prompt: String,
    pub resumable_native_session_id: Option<String>,
    pub new_native_session_id: Option<String>,
    pub new_session_charter: Option<String>,
    pub team_tool: Option<TeamToolProcessConfig>,
    pub external_mcp_servers: BTreeMap<String, McpServerDefinition>,
    pub attachment_projection_root: Option<PathBuf>,
    pub persist_session: bool,
}

#[derive(Debug, Clone)]
pub struct ClaudeCodeRunResult {
    pub native_session_id: String,
    pub native_turn_id: String,
    pub final_output: String,
}

#[derive(Debug)]
struct ClaudeCodeProcessControl {
    interrupt: Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Debug)]
pub struct ClaudeCodeCliRuntimeAdapter {
    active: Mutex<HashMap<(String, i64), Arc<ClaudeCodeProcessControl>>>,
    private_runtime_dir: PathBuf,
}

impl ClaudeCodeCliRuntimeAdapter {
    pub fn new(data_dir: &Path) -> Result<Self> {
        let private_runtime_dir = data_dir.join("runtime-private");
        std::fs::create_dir_all(&private_runtime_dir).with_context(|| {
            format!(
                "failed to create private Runtime directory {}",
                private_runtime_dir.display()
            )
        })?;
        restrict_directory_permissions(&private_runtime_dir)?;
        remove_stale_team_tool_configs(&private_runtime_dir)?;
        Ok(Self {
            active: Mutex::new(HashMap::new()),
            private_runtime_dir,
        })
    }

    pub async fn run(&self, request: ClaudeCodeRunRequest) -> Result<ClaudeCodeRunResult> {
        let key = (request.agent_run_id.clone(), request.execution_epoch);
        let (interrupt, interrupted) = oneshot::channel();
        let control = Arc::new(ClaudeCodeProcessControl {
            interrupt: Mutex::new(Some(interrupt)),
        });
        {
            let mut active = self.active.lock().await;
            if active.contains_key(&key) {
                anyhow::bail!("Claude Code process already exists for this AgentRun epoch");
            }
            active.insert(key.clone(), control);
        }
        let result = self.run_process(&request, interrupted).await;
        self.active.lock().await.remove(&key);
        result
    }

    pub async fn interrupt(&self, agent_run_id: &str, execution_epoch: i64) -> bool {
        let control = self
            .active
            .lock()
            .await
            .get(&(agent_run_id.to_string(), execution_epoch))
            .cloned();
        let Some(control) = control else {
            return false;
        };
        control
            .interrupt
            .lock()
            .await
            .take()
            .is_some_and(|sender| sender.send(()).is_ok())
    }

    pub async fn shutdown_all(&self) {
        let controls = self
            .active
            .lock()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for control in controls {
            if let Some(sender) = control.interrupt.lock().await.take() {
                let _ = sender.send(());
            }
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while !self.active.lock().await.is_empty() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    async fn run_process(
        &self,
        request: &ClaudeCodeRunRequest,
        interrupted: oneshot::Receiver<()>,
    ) -> Result<ClaudeCodeRunResult> {
        let execution_root = Path::new(&request.workspace.execution_root);
        if !execution_root.is_dir() {
            anyhow::bail!(
                "Claude Code execution directory no longer exists: {}",
                execution_root.display()
            );
        }
        if let Some(root) = request.attachment_projection_root.as_deref()
            && !root.is_dir()
        {
            anyhow::bail!(
                "Claude Code Run Attachment Projection root is unavailable: {}",
                root.display()
            );
        }
        let executable = Path::new(&request.runtime.executable_path);
        if !executable.is_file() {
            anyhow::bail!(
                "Claude Code executable no longer exists: {}",
                executable.display()
            );
        }
        let values = request
            .runtime
            .permissions
            .values
            .as_object()
            .context("Claude Code permission configuration must be an object")?;
        let configured_mode = values
            .get("permission_mode")
            .and_then(serde_json::Value::as_str)
            .context("Claude Code requires permission_mode")?;
        if ![
            "acceptEdits",
            "auto",
            "bypassPermissions",
            "manual",
            "dontAsk",
            "plan",
        ]
        .contains(&configured_mode)
        {
            anyhow::bail!("Claude Code permission_mode has an unsupported value");
        }
        let legacy_read_only = request.permission_semantics == PermissionSemantics::CoreEnforcedV1
            && request.workspace.access == "read_only";
        let permission_mode = if legacy_read_only {
            // `plan` also suppresses Rovai-ai's explicitly pre-authorized Team
            // Tool. `dontAsk` fails closed for every action that would require
            // a prompt, while `--allowedTools` below can still admit the one
            // binding-authenticated collaboration tool.
            "dontAsk"
        } else {
            configured_mode
        };

        let native_session_id =
            if let Some(session_id) = request.resumable_native_session_id.as_deref() {
                validate_session_id(session_id)?;
                session_id.to_string()
            } else if let Some(session_id) = request.new_native_session_id.as_deref() {
                validate_session_id(session_id)?;
                session_id.to_string()
            } else {
                uuid::Uuid::new_v4().to_string()
            };
        let mut command = Command::new(executable);
        configure_active_runtime_command(&mut command);
        command
            .arg("--print")
            .args(["--output-format", "json"])
            .args(["--permission-mode", permission_mode]);
        if let Some(root) = request.attachment_projection_root.as_deref() {
            command.arg("--add-dir").arg(root);
        }
        if permission_mode == "bypassPermissions" {
            command.arg("--dangerously-skip-permissions");
        }
        if legacy_read_only {
            command.arg("--disallowedTools=Edit,Write,NotebookEdit,Bash");
        }
        if request.runtime.model.source == "explicit"
            && request.runtime.model.model_id != CLAUDE_CODE_RUNTIME_DEFAULT_MODEL_ID
        {
            command.args(["--model", request.runtime.model.model_id.as_str()]);
        }
        if let Some(effort) = request
            .runtime
            .model
            .options
            .get("effort")
            .and_then(serde_json::Value::as_str)
        {
            if !["low", "medium", "high", "xhigh", "max"].contains(&effort) {
                anyhow::bail!("Claude Code effort has an unsupported value");
            }
            command.args(["--effort", effort]);
        }
        if let Some(session_id) = request.resumable_native_session_id.as_deref() {
            command.args(["--resume", session_id]);
        } else {
            command.args(["--session-id", &native_session_id]);
            if let Some(charter) = request.new_session_charter.as_deref() {
                command.args(["--append-system-prompt", charter]);
            }
        }
        if !request.persist_session {
            command.arg("--no-session-persistence").arg("--tools=");
        }
        let _team_config = if let Some(team_tool) = request.team_tool.as_ref() {
            let config = team_tool.write_ephemeral_claude_config(
                &self.private_runtime_dir,
                &request.external_mcp_servers,
            )?;
            // Claude Code normalizes MCP tool punctuation in permission
            // identifiers even though the server advertises canonical
            // `team.*` names on the wire.
            let tool_names = TEAM_TOOL_NAMES
                .iter()
                .map(|tool_name| claude_mcp_tool_name(TEAM_MCP_SERVER_NAME, tool_name))
                .collect::<Vec<_>>()
                .join(",");
            command
                .arg("--mcp-config")
                .arg(config.path())
                .arg("--strict-mcp-config")
                .arg(format!("--allowedTools={tool_names}"));
            Some(config)
        } else {
            None
        };
        let mut child = command
            .current_dir(execution_root)
            // Frozen context can contain user messages and local paths. Send it
            // over stdin so it never appears in `ps` or process diagnostics.
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| {
                format!(
                    "failed to start {} in Claude Code print mode",
                    executable.display()
                )
            })?;
        let mut stdin = child
            .stdin
            .take()
            .context("Claude Code stdin was unavailable")?;
        stdin
            .write_all(request.prompt.as_bytes())
            .await
            .context("failed to deliver frozen input to Claude Code stdin")?;
        stdin
            .shutdown()
            .await
            .context("failed to close Claude Code stdin after frozen input")?;
        drop(stdin);
        let stdout = child
            .stdout
            .take()
            .context("Claude Code stdout was unavailable")?;
        let stderr = child
            .stderr
            .take()
            .context("Claude Code stderr was unavailable")?;
        let stdout_task = tokio::spawn(capture_bounded(stdout));
        let stderr_task = tokio::spawn(capture_bounded(stderr));
        tokio::pin!(interrupted);
        let mut was_interrupted = false;
        let status = tokio::select! {
            status = child.wait() => status.context("failed to wait for Claude Code process")?,
            _ = &mut interrupted => {
                was_interrupted = true;
                let _ = child.kill().await;
                child.wait().await.context("failed to reap interrupted Claude Code process")?
            }
        };
        let stdout = stdout_task
            .await
            .context("Claude Code stdout collector failed")??;
        let stderr = stderr_task
            .await
            .context("Claude Code stderr collector failed")??;
        if was_interrupted {
            anyhow::bail!("Claude Code process was interrupted");
        }
        if !status.success() {
            anyhow::bail!(
                "Claude Code process exited with {} (stderrBytes={}, stderrDigest={})",
                status,
                stderr.total_bytes,
                stderr.digest
            );
        }
        if stdout.truncated {
            anyhow::bail!(
                "Claude Code result exceeded the {} byte safety limit",
                MAX_CAPTURE_BYTES
            );
        }
        let output: ClaudeCodeJsonResult = serde_json::from_slice(&stdout.bytes)
            .context("Claude Code final output was not valid result JSON")?;
        if output.is_error || output.subtype.as_deref() != Some("success") {
            anyhow::bail!(
                "Claude Code returned a non-success result (subtype={})",
                output.subtype.as_deref().unwrap_or("unknown")
            );
        }
        let observed_session_id = output
            .session_id
            .context("Claude Code result omitted session_id")?;
        validate_session_id(&observed_session_id)?;
        if observed_session_id != native_session_id {
            anyhow::bail!(
                "Claude Code returned a different session than requested (expected {native_session_id}, observed {observed_session_id})"
            );
        }
        let final_output = output.result.trim().to_string();
        if final_output.is_empty() {
            anyhow::bail!("Claude Code completed without a final response");
        }
        Ok(ClaudeCodeRunResult {
            native_session_id,
            native_turn_id: format!(
                "claude-code:{}:{}",
                request.agent_run_id, request.execution_epoch
            ),
            final_output,
        })
    }
}

#[derive(Debug, Deserialize)]
struct ClaudeCodeJsonResult {
    #[serde(default)]
    subtype: Option<String>,
    #[serde(default)]
    is_error: bool,
    #[serde(default)]
    result: String,
    #[serde(default)]
    session_id: Option<String>,
}

#[derive(Debug)]
struct CapturedBytes {
    bytes: Vec<u8>,
    total_bytes: usize,
    truncated: bool,
    digest: String,
}

async fn capture_bounded<R>(mut reader: R) -> Result<CapturedBytes>
where
    R: AsyncRead + Unpin,
{
    let mut bytes = Vec::new();
    let mut total_bytes = 0_usize;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        total_bytes = total_bytes.saturating_add(read);
        digest.update(&buffer[..read]);
        if bytes.len() < MAX_CAPTURE_BYTES {
            let remaining = MAX_CAPTURE_BYTES - bytes.len();
            bytes.extend_from_slice(&buffer[..read.min(remaining)]);
        }
    }
    Ok(CapturedBytes {
        truncated: total_bytes > bytes.len(),
        bytes,
        total_bytes,
        digest: format!("sha256:{:x}", digest.finalize()),
    })
}

fn validate_session_id(value: &str) -> Result<()> {
    uuid::Uuid::parse_str(value).with_context(|| "Claude Code session identifier is not a UUID")?;
    Ok(())
}

fn claude_mcp_tool_name(server_name: &str, tool_name: &str) -> String {
    format!("mcp__{server_name}__{}", tool_name.replace('.', "_"))
}

#[cfg(unix)]
fn restrict_directory_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_directory_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_uuid_session_identifiers() {
        assert!(validate_session_id("0bdd2166-d420-40c6-94be-70b93eb290c5").is_ok());
        assert!(validate_session_id("latest").is_err());
    }

    #[test]
    fn normalizes_mcp_tool_names_for_claude_permission_flags() {
        assert_eq!(
            claude_mcp_tool_name("rovai_team", "team.post_message"),
            "mcp__rovai_team__team_post_message"
        );
    }
}
