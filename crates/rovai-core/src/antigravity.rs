use std::{
    collections::HashMap,
    error::Error as StdError,
    ffi::OsString,
    fmt,
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};

use crate::builtin_tool_runtime::BuiltinToolProcessConfig;
use anyhow::{Context, Result};
use rovai_core::{
    agent_profile::FrozenAgentRuntimeConfig,
    agent_runtime_adapter::ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID,
    runtime::{AgentRunWorkspace, PermissionSemantics},
    runtime_discovery::configure_active_runtime_command,
};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::{Mutex, mpsc, oneshot},
    time::{Duration, Instant, MissedTickBehavior},
};

const MAX_CAPTURE_BYTES: usize = 2 * 1024 * 1024;
const MAX_LOG_INSPECTION_BYTES: u64 = 2 * 1024 * 1024;

pub struct AntigravityRunRequest {
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub workspace: AgentRunWorkspace,
    pub permission_semantics: PermissionSemantics,
    pub runtime: FrozenAgentRuntimeConfig,
    pub prompt: String,
    pub resumable_native_session_id: Option<String>,
    pub attachment_access_root: Option<PathBuf>,
    pub builtin_tools: Option<BuiltinToolProcessConfig>,
    pub input_accepted: Option<mpsc::UnboundedSender<AntigravityInputAccepted>>,
    pub launch_handoff: Option<oneshot::Sender<()>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AntigravityInputAccepted {
    pub native_session_id: String,
    pub native_turn_id: String,
}

#[derive(Debug, Clone)]
pub struct AntigravityRunResult {
    pub native_session_id: String,
    pub native_turn_id: String,
    pub final_output: String,
}

#[derive(Debug, Clone)]
pub struct AntigravityDeliveredFailure {
    pub native_session_id: String,
    pub native_turn_id: String,
    pub error_code: &'static str,
}

impl fmt::Display for AntigravityDeliveredFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "Antigravity accepted the input but ended with {}",
            self.error_code
        )
    }
}

impl StdError for AntigravityDeliveredFailure {}

#[derive(Debug)]
struct AntigravityProcessControl {
    interrupt: Mutex<Option<oneshot::Sender<()>>>,
}

pub struct AntigravityAppRuntimeAdapter {
    active: Mutex<HashMap<(String, i64), Arc<AntigravityProcessControl>>>,
    log_dir: PathBuf,
}

impl AntigravityAppRuntimeAdapter {
    pub fn new(data_dir: &Path) -> Result<Self> {
        let legacy_log_dir = data_dir.join("runtime-private").join("agy");
        if legacy_log_dir.exists() {
            std::fs::remove_dir_all(&legacy_log_dir).with_context(|| {
                format!(
                    "failed to remove legacy Antigravity companion logs {}",
                    legacy_log_dir.display()
                )
            })?;
        }
        let log_dir = data_dir.join("runtime-private").join("antigravity");
        std::fs::create_dir_all(&log_dir).with_context(|| {
            format!(
                "failed to create private Antigravity companion directory {}",
                log_dir.display()
            )
        })?;
        restrict_directory_permissions(&log_dir)?;
        // A hard crash can leave a sensitive upstream log behind. It is never
        // a recovery source, so remove leftovers before accepting new work.
        for entry in std::fs::read_dir(&log_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        Ok(Self {
            active: Mutex::new(HashMap::new()),
            log_dir,
        })
    }

    pub async fn run(&self, mut request: AntigravityRunRequest) -> Result<AntigravityRunResult> {
        let key = (request.agent_run_id.clone(), request.execution_epoch);
        let (interrupt, interrupted) = oneshot::channel();
        let control = Arc::new(AntigravityProcessControl {
            interrupt: Mutex::new(Some(interrupt)),
        });
        {
            let mut active = self.active.lock().await;
            if active.contains_key(&key) {
                anyhow::bail!(
                    "Antigravity companion process already exists for this AgentRun epoch"
                );
            }
            active.insert(key.clone(), control);
        }
        let launch_handoff = request.launch_handoff.take();
        let result = self
            .run_process(&request, interrupted, launch_handoff)
            .await;
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
        self.active.lock().await.clear();
    }

    async fn run_process(
        &self,
        request: &AntigravityRunRequest,
        interrupted: oneshot::Receiver<()>,
        launch_handoff: Option<oneshot::Sender<()>>,
    ) -> Result<AntigravityRunResult> {
        let workspace_roots = canonical_antigravity_workspace_roots(
            Path::new(&request.workspace.execution_root),
            request.attachment_access_root.as_deref(),
        )?;
        let execution_root = workspace_roots
            .first()
            .context("Antigravity companion has no execution root")?;
        let executable = Path::new(&request.runtime.executable_path);
        if !executable.is_file() {
            anyhow::bail!(
                "Antigravity companion executable no longer exists: {}",
                executable.display()
            );
        }
        let log_path = self.log_dir.join(format!(
            "{}-{}-{}.log",
            request.agent_run_id,
            request.execution_epoch,
            uuid::Uuid::new_v4()
        ));
        create_private_file(&log_path)?;
        let _log_guard = SensitiveLogGuard(log_path.clone());

        let permission_values = request
            .runtime
            .permissions
            .values
            .as_object()
            .context("Antigravity companion permission configuration must be an object")?;
        let configured_mode = required_enum(permission_values, "mode", &["accept-edits", "plan"])?;
        let configured_sandbox = required_enum(permission_values, "sandbox", &["on", "off"])?;
        let configured_skip_permissions = required_enum(
            permission_values,
            "dangerously_skip_permissions",
            &["on", "off"],
        )?;
        let legacy_read_only = request.permission_semantics == PermissionSemantics::CoreEnforcedV1
            && request.workspace.access == "read_only";
        let (mode, sandbox, skip_permissions) = if legacy_read_only {
            ("plan", "on", "off")
        } else {
            (
                configured_mode,
                configured_sandbox,
                configured_skip_permissions,
            )
        };

        let mut runtime_args = vec![
            OsString::from("--print"),
            OsString::from(&request.prompt),
            OsString::from("--print-timeout"),
            OsString::from("5m"),
            OsString::from("--mode"),
            OsString::from(mode),
            OsString::from("--log-file"),
            log_path.as_os_str().to_os_string(),
        ];
        // Antigravity 1.1.9 uses explicit --add-dir values as the model-visible
        // workspace list. Include the execution root as well as the attachment
        // projection, and canonicalize both so macOS sandbox rules do not mix
        // /var paths with their /private/var kernel identity.
        for root in &workspace_roots {
            runtime_args.push(OsString::from("--add-dir"));
            runtime_args.push(root.as_os_str().to_os_string());
        }
        if sandbox == "on" {
            runtime_args.push(OsString::from("--sandbox"));
        }
        if skip_permissions == "on" {
            runtime_args.push(OsString::from("--dangerously-skip-permissions"));
        }
        if request.runtime.model.source == "explicit"
            && request.runtime.model.model_id != ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID
        {
            runtime_args.push(OsString::from("--model"));
            runtime_args.push(OsString::from(&request.runtime.model.model_id));
        }
        if let Some(session_id) = request.resumable_native_session_id.as_deref() {
            validate_session_id(session_id)?;
            runtime_args.push(OsString::from("--conversation"));
            runtime_args.push(OsString::from(session_id));
        }
        let mut command = Command::new(executable);
        command.args(&runtime_args);
        configure_active_runtime_command(&mut command);
        if let Some(config) = &request.builtin_tools {
            config.configure_command(&mut command)?;
        }
        // The native sandbox must not need access to the user's global Git
        // configuration merely to inspect the isolated execution workspace.
        #[cfg(unix)]
        command.env("GIT_CONFIG_GLOBAL", "/dev/null");
        #[cfg(windows)]
        command.env("GIT_CONFIG_GLOBAL", "NUL");
        let mut child = command
            .current_dir(execution_root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("failed to start {} in print mode", executable.display()))?;
        if let Some(handoff) = launch_handoff {
            let _ = handoff.send(());
        }
        let stdout = child
            .stdout
            .take()
            .context("Antigravity companion stdout was unavailable")?;
        let stderr = child
            .stderr
            .take()
            .context("Antigravity companion stderr was unavailable")?;
        let stdout_task = tokio::spawn(capture_bounded(stdout));
        let stderr_task = tokio::spawn(capture_bounded(stderr));
        tokio::pin!(interrupted);
        let mut was_interrupted = false;
        let mut acceptance_emitted = false;
        let mut acceptance_poll = tokio::time::interval(Duration::from_millis(50));
        acceptance_poll.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let status = loop {
            tokio::select! {
                status = child.wait() => {
                    break status.context("failed to wait for Antigravity companion process")?;
                }
                _ = &mut interrupted => {
                    was_interrupted = true;
                    let _ = child.kill().await;
                    break child.wait().await.context("failed to reap interrupted Antigravity companion process")?;
                }
                _ = acceptance_poll.tick(), if !acceptance_emitted && request.input_accepted.is_some() => {
                    acceptance_emitted = emit_input_accepted_if_observed(request, &log_path);
                }
            }
        };
        if !acceptance_emitted {
            // A short-lived process can exit between polling ticks. Inspect the
            // now-closed log once more before classifying any terminal result.
            emit_input_accepted_if_observed(request, &log_path);
        }
        let stdout = stdout_task
            .await
            .context("Antigravity companion stdout collector failed")??;
        let stderr = stderr_task
            .await
            .context("Antigravity companion stderr collector failed")??;
        if was_interrupted {
            anyhow::bail!("Antigravity companion process was interrupted");
        }
        if !status.success() {
            anyhow::bail!(
                "Antigravity companion process exited with {} (stderrBytes={}, stderrDigest={})",
                status,
                stderr.total_bytes,
                stderr.digest
            );
        }
        let native_session_id = read_native_session_id(&log_path)?.context(
            "Antigravity companion completed without a verifiable conversation identifier",
        )?;
        if let Some(expected) = request.resumable_native_session_id.as_deref()
            && native_session_id != expected
        {
            anyhow::bail!(
                "Antigravity companion resumed a different conversation than requested (expected {expected}, observed {native_session_id})"
            );
        }
        let native_turn_id = format!("agy:{}:{}", request.agent_run_id, request.execution_epoch);
        if stdout.truncated {
            return Err(AntigravityDeliveredFailure {
                native_session_id,
                native_turn_id,
                error_code: "runtime_output_too_large",
            }
            .into());
        }
        let final_output = match String::from_utf8(stdout.bytes) {
            Ok(output) => output.trim().to_string(),
            Err(_) => {
                return Err(AntigravityDeliveredFailure {
                    native_session_id,
                    native_turn_id,
                    error_code: "runtime_invalid_final_output",
                }
                .into());
            }
        };
        if final_output.is_empty() {
            return Err(AntigravityDeliveredFailure {
                native_session_id,
                native_turn_id,
                error_code: "runtime_missing_final_output",
            }
            .into());
        }
        Ok(AntigravityRunResult {
            native_session_id,
            native_turn_id,
            final_output,
        })
    }
}

fn canonical_antigravity_workspace_roots(
    execution_root: &Path,
    attachment_access_root: Option<&Path>,
) -> Result<Vec<PathBuf>> {
    if !execution_root.is_dir() {
        anyhow::bail!(
            "Antigravity companion execution directory no longer exists: {}",
            execution_root.display()
        );
    }
    let execution_root = execution_root.canonicalize().with_context(|| {
        format!(
            "failed to canonicalize Antigravity execution root {}",
            execution_root.display()
        )
    })?;
    let mut roots = vec![execution_root];
    if let Some(attachment_access_root) = attachment_access_root {
        if !attachment_access_root.is_dir() {
            anyhow::bail!(
                "Antigravity Camp Attachment access root is unavailable: {}",
                attachment_access_root.display()
            );
        }
        let attachment_access_root = attachment_access_root.canonicalize().with_context(|| {
            format!(
                "failed to canonicalize Antigravity Camp Attachment access root {}",
                attachment_access_root.display()
            )
        })?;
        if !roots.contains(&attachment_access_root) {
            roots.push(attachment_access_root);
        }
    }
    Ok(roots)
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

fn required_enum<'a>(
    values: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
    allowed: &[&str],
) -> Result<&'a str> {
    let value = values
        .get(key)
        .and_then(serde_json::Value::as_str)
        .with_context(|| format!("Antigravity companion requires {key}"))?;
    if !allowed.contains(&value) {
        anyhow::bail!("Antigravity companion {key} has an unsupported value");
    }
    Ok(value)
}

fn read_native_session_id(path: &Path) -> Result<Option<String>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_LOG_INSPECTION_BYTES)
        .read_to_end(&mut bytes)?;
    let body = String::from_utf8_lossy(&bytes);
    Ok(native_session_id_from_log(&body))
}

fn native_session_id_from_log(body: &str) -> Option<String> {
    // Print mode identifies the conversation that owns this one-shot input;
    // prefer it over any unrelated conversation creation emitted at startup.
    for marker in ["Print mode: conversation=", "Created conversation "] {
        for suffix in body
            .match_indices(marker)
            .map(|(index, _)| &body[index + marker.len()..])
        {
            let candidate = suffix
                .split(|character: char| {
                    character.is_whitespace() || character == ',' || character == ']'
                })
                .next()
                .unwrap_or("")
                .trim_matches(|character: char| character == '"' || character == '\'');
            if validate_session_id(candidate).is_ok() {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

fn read_accepted_native_session_id(path: &Path) -> Result<Option<String>> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_LOG_INSPECTION_BYTES)
        .read_to_end(&mut bytes)?;
    Ok(accepted_native_session_id_from_log(
        &String::from_utf8_lossy(&bytes),
    ))
}

fn accepted_native_session_id_from_log(body: &str) -> Option<String> {
    let native_session_id = native_session_id_from_log(body)?;
    let forwarding_markers = [
        format!("Forwarding user message to conversation {native_session_id}"),
        format!("Sending user message to conversation {native_session_id}"),
    ];
    let forwarding_offset = forwarding_markers
        .iter()
        .filter_map(|marker| body.find(marker).map(|offset| offset + marker.len()))
        .min()?;
    let response_observed = body[forwarding_offset..]
        .lines()
        .any(|line| line.contains("streamGenerateContent") && line.contains("ResponseID:"));
    response_observed.then_some(native_session_id)
}

fn emit_input_accepted_if_observed(request: &AntigravityRunRequest, log_path: &Path) -> bool {
    let Some(sender) = request.input_accepted.as_ref() else {
        return false;
    };
    let Ok(Some(native_session_id)) = read_accepted_native_session_id(log_path) else {
        return false;
    };
    if request
        .resumable_native_session_id
        .as_deref()
        .is_some_and(|expected| native_session_id != expected)
    {
        return false;
    }
    let _ = sender.send(AntigravityInputAccepted {
        native_session_id,
        native_turn_id: format!("agy:{}:{}", request.agent_run_id, request.execution_epoch),
    });
    true
}

fn validate_session_id(value: &str) -> Result<()> {
    uuid::Uuid::parse_str(value)
        .with_context(|| "Antigravity companion conversation identifier is not a UUID")?;
    Ok(())
}

#[cfg(test)]
fn bytes_digest(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    format!("sha256:{:x}", digest.finalize())
}

fn create_private_file(path: &Path) -> Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).with_context(|| {
        format!(
            "failed to create private Antigravity companion log {}",
            path.display()
        )
    })?;
    file.flush()?;
    restrict_file_permissions(path)
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

#[cfg(unix)]
fn restrict_file_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_file_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

struct SensitiveLogGuard(PathBuf);

impl Drop for SensitiveLogGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_roots_include_canonical_execution_and_attachment_directories() {
        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-workspace-roots-test-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        let attachments = root.join("attachments");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        std::fs::create_dir_all(&attachments).expect("attachments should be created");

        let roots = canonical_antigravity_workspace_roots(&workspace, Some(&attachments))
            .expect("both visible roots should resolve");
        assert_eq!(
            roots,
            vec![
                workspace.canonicalize().unwrap(),
                attachments.canonicalize().unwrap()
            ]
        );
        let deduplicated = canonical_antigravity_workspace_roots(&workspace, Some(&workspace))
            .expect("identical roots should resolve");
        assert_eq!(deduplicated, vec![workspace.canonicalize().unwrap()]);

        std::fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[tokio::test]
    #[ignore = "manual local Runtime smoke"]
    async fn isolated_completion_real_runtime_smoke() {
        use rovai_core::agent_profile::{
            AdapterKind, AdapterPermissionConfig, ResolvedModelSelection,
        };
        use serde_json::json;

        let executable = crate::health::find_adapter(AdapterKind::AntigravityApp)
            .expect("Antigravity companion must be installed");
        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-compaction-smoke-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let adapter = AntigravityAppRuntimeAdapter::new(&root).expect("Adapter should initialize");
        let result = adapter
            .run(AntigravityRunRequest {
                agent_run_id: format!("context-compaction:{}", uuid::Uuid::new_v4()),
                execution_epoch: 1,
                workspace: AgentRunWorkspace {
                    execution_root: workspace.to_string_lossy().to_string(),
                    access: "read_only".to_string(),
                    isolation: "shared".to_string(),
                },
                permission_semantics: PermissionSemantics::CoreEnforcedV1,
                runtime: FrozenAgentRuntimeConfig {
                    adapter_kind: AdapterKind::AntigravityApp,
                    installation_id: "smoke".to_string(),
                    installation_generation: 1,
                    search_environment_generation: 1,
                    executable_path: executable.to_string_lossy().to_string(),
                    auth_scope: "local-user".to_string(),
                    reported_version: "smoke".to_string(),
                    executable_fingerprint:
                        rovai_core::agent_runtime_adapter::executable_fingerprint(&executable)
                            .expect("Antigravity companion executable should be readable"),
                    capabilities: vec!["cli.print".to_string()],
                    protocol_version: "antigravity-app-cli-v1".to_string(),
                    model: ResolvedModelSelection {
                        source: "runtime_default".to_string(),
                        model_id: ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID.to_string(),
                        options: json!({}),
                    },
                    permissions: AdapterPermissionConfig {
                        adapter_kind: AdapterKind::AntigravityApp,
                        schema_version: 1,
                        values: json!({
                            "mode": "plan",
                            "sandbox": "on",
                            "dangerously_skip_permissions": "off",
                        }),
                    },
                    native_session_compatibility_key: Some("antigravity-app:cli-v1".to_string()),
                    binding_compatibility_digest: "smoke-binding".to_string(),
                    host_config_digest: "smoke-host".to_string(),
                    config_digest: "smoke-config".to_string(),
                },
                prompt: "只输出这六个字：压缩路径可用".to_string(),
                resumable_native_session_id: None,
                attachment_access_root: None,
                builtin_tools: None,
                input_accepted: None,
                launch_handoff: None,
            })
            .await
            .unwrap();
        assert!(result.final_output.contains("压缩路径可用"));
        std::fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn extracts_created_and_resumed_conversation_ids_without_retaining_log_content() {
        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-log-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("test directory should be created");
        let created = "0bdd2166-d420-40c6-94be-70b93eb290c5";
        let created_log = root.join("created.log");
        std::fs::write(
            &created_log,
            format!("private payload\nCreated conversation {created}\n"),
        )
        .expect("log should be written");
        assert_eq!(
            read_native_session_id(&created_log)
                .expect("log should parse")
                .as_deref(),
            Some(created)
        );

        let resumed_log = root.join("resumed.log");
        std::fs::write(
            &resumed_log,
            format!("Print mode: conversation={created}, timeout=5m0s\n"),
        )
        .expect("log should be written");
        assert_eq!(
            read_native_session_id(&resumed_log)
                .expect("log should parse")
                .as_deref(),
            Some(created)
        );

        let unrelated = "2b3f7448-3b73-49db-bcb7-cfa6b347f693";
        let mixed_log = root.join("mixed.log");
        std::fs::write(
            &mixed_log,
            format!(
                "Created conversation {unrelated}\nPrint mode: conversation={created}, sending message\n"
            ),
        )
        .expect("mixed log should be written");
        assert_eq!(
            read_native_session_id(&mixed_log)
                .expect("mixed log should parse")
                .as_deref(),
            Some(created),
            "the print-mode conversation owns the one-shot input"
        );
        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn accepts_only_a_session_bound_response_after_the_current_input_was_forwarded() {
        let session_id = "0bdd2166-d420-40c6-94be-70b93eb290c5";
        let response =
            "I0811 streamGenerateContent?alt=sse request completed ResponseID: response-1";
        assert_eq!(
            accepted_native_session_id_from_log(&format!(
                "Created conversation {session_id}\n{response}\nForwarding user message to conversation {session_id}\n"
            )),
            None,
            "an unrelated response before forwarding cannot acknowledge this input"
        );
        assert_eq!(
            accepted_native_session_id_from_log(&format!(
                "Created conversation {session_id}\nForwarding user message to conversation {session_id}\n"
            )),
            None,
            "local forwarding alone is not accepted evidence"
        );
        assert_eq!(
            accepted_native_session_id_from_log(&format!(
                "Created conversation {session_id}\nForwarding user message to conversation {session_id}\n{response}\n"
            )),
            Some(session_id.to_string())
        );
        assert_eq!(
            accepted_native_session_id_from_log(&format!(
                "Print mode: conversation={session_id}, timeout=5m0s\nSending user message to conversation {session_id}\n{response}\n"
            )),
            Some(session_id.to_string())
        );
    }

    #[test]
    fn bounded_capture_digest_never_needs_the_sensitive_text() {
        assert_eq!(
            bytes_digest(b"diagnostic"),
            "sha256:5a695eea5b00a31f8aef7dbb89c8f798fab371246ac1549afe84b16420707b99"
        );
    }

    #[cfg(unix)]
    fn fake_antigravity_request(
        workspace: &Path,
        executable: &Path,
        agent_run_id: String,
    ) -> AntigravityRunRequest {
        use rovai_core::agent_profile::{
            AdapterKind, AdapterPermissionConfig, ResolvedModelSelection,
        };
        use serde_json::json;

        AntigravityRunRequest {
            agent_run_id,
            execution_epoch: 1,
            workspace: AgentRunWorkspace {
                execution_root: workspace.to_string_lossy().to_string(),
                access: "read_write".to_string(),
                isolation: "shared".to_string(),
            },
            permission_semantics: PermissionSemantics::RuntimeManagedV2,
            runtime: FrozenAgentRuntimeConfig {
                adapter_kind: AdapterKind::AntigravityApp,
                installation_id: "agy-test".to_string(),
                installation_generation: 1,
                search_environment_generation: 1,
                executable_path: executable.to_string_lossy().to_string(),
                auth_scope: "test".to_string(),
                reported_version: "test".to_string(),
                executable_fingerprint: "sha256:test".to_string(),
                capabilities: vec!["cli.print".to_string()],
                protocol_version: "antigravity-app-cli-v1".to_string(),
                model: ResolvedModelSelection {
                    source: "runtime_default".to_string(),
                    model_id: ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID.to_string(),
                    options: json!({}),
                },
                permissions: AdapterPermissionConfig {
                    adapter_kind: AdapterKind::AntigravityApp,
                    schema_version: 1,
                    values: json!({
                        "mode": "accept-edits",
                        "sandbox": "on",
                        "dangerously_skip_permissions": "off",
                    }),
                },
                native_session_compatibility_key: Some("antigravity-app:cli-v1".to_string()),
                binding_compatibility_digest: "binding".to_string(),
                host_config_digest: "host".to_string(),
                config_digest: "config".to_string(),
            },
            prompt: "test input".to_string(),
            resumable_native_session_id: None,
            attachment_access_root: None,
            builtin_tools: None,
            input_accepted: None,
            launch_handoff: None,
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn response_evidence_emits_acceptance_before_process_completion() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-early-acceptance-test-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let executable = root.join("fake-agy");
        std::fs::write(
            &executable,
            r#"#!/bin/sh
log_file=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--log-file" ]; then
    shift
    log_file="$1"
  fi
  shift
done
session_id="0bdd2166-d420-40c6-94be-70b93eb290c5"
echo "Created conversation $session_id" >> "$log_file"
echo "Forwarding user message to conversation $session_id" >> "$log_file"
echo "I0811 streamGenerateContent?alt=sse request completed ResponseID: response-1" >> "$log_file"
while [ ! -f .release ]; do
  sleep 0.05
done
echo "finished"
"#,
        )
        .expect("fake Antigravity companion should be written");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
            .expect("fake Antigravity companion should be executable");
        let adapter =
            Arc::new(AntigravityAppRuntimeAdapter::new(&root).expect("Adapter should initialize"));
        let run_id = uuid::Uuid::new_v4().to_string();
        let mut request = fake_antigravity_request(&workspace, &executable, run_id.clone());
        let (accepted_sender, mut accepted_receiver) = mpsc::unbounded_channel();
        let (handoff_sender, handoff_receiver) = oneshot::channel();
        request.input_accepted = Some(accepted_sender);
        request.launch_handoff = Some(handoff_sender);
        let running_adapter = Arc::clone(&adapter);
        let task = tokio::spawn(async move { running_adapter.run(request).await });

        tokio::time::timeout(Duration::from_secs(5), handoff_receiver)
            .await
            .expect("prompt handoff should follow successful process spawn")
            .expect("prompt handoff channel should stay open");
        let accepted = tokio::time::timeout(Duration::from_secs(5), accepted_receiver.recv())
            .await
            .expect("accepted evidence should arrive before the process exits")
            .expect("accepted evidence channel should stay open");
        assert_eq!(
            accepted.native_session_id,
            "0bdd2166-d420-40c6-94be-70b93eb290c5"
        );
        assert_eq!(accepted.native_turn_id, format!("agy:{run_id}:1"));
        assert!(!task.is_finished(), "acceptance must precede final output");
        std::fs::write(workspace.join(".release"), b"")
            .expect("fake process should be released after acceptance");

        let result = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .expect("fake process should finish")
            .expect("run task should join")
            .expect("final output should remain successful");
        assert_eq!(result.final_output, "finished");
        std::fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn terminal_process_failure_still_emits_observed_acceptance() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-accepted-terminal-failure-test-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let executable = root.join("fake-agy");
        std::fs::write(
            &executable,
            r#"#!/bin/sh
log_file=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--log-file" ]; then
    shift
    log_file="$1"
  fi
  shift
done
session_id="0bdd2166-d420-40c6-94be-70b93eb290c5"
echo "Created conversation $session_id" >> "$log_file"
echo "Forwarding user message to conversation $session_id" >> "$log_file"
echo "I0811 streamGenerateContent?alt=sse request completed ResponseID: response-1" >> "$log_file"
exit 7
"#,
        )
        .expect("fake Antigravity companion should be written");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
            .expect("fake Antigravity companion should be executable");
        let adapter = AntigravityAppRuntimeAdapter::new(&root).expect("Adapter should initialize");
        let mut request =
            fake_antigravity_request(&workspace, &executable, uuid::Uuid::new_v4().to_string());
        let (accepted_sender, mut accepted_receiver) = mpsc::unbounded_channel();
        request.input_accepted = Some(accepted_sender);

        let error = adapter
            .run(request)
            .await
            .expect_err("non-zero process exit should remain a failure");
        assert!(format!("{error:#}").contains("process exited with"));
        assert_eq!(
            accepted_receiver
                .try_recv()
                .expect("the final log scan should preserve accepted evidence")
                .native_session_id,
            "0bdd2166-d420-40c6-94be-70b93eb290c5"
        );
        std::fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn verified_session_without_final_text_is_a_delivered_failure() {
        use std::os::unix::fs::PermissionsExt;

        use rovai_core::agent_profile::{
            AdapterKind, AdapterPermissionConfig, ResolvedModelSelection,
        };
        use serde_json::json;

        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-delivered-failure-test-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let executable = root.join("fake-agy");
        std::fs::write(
            &executable,
            r#"#!/bin/sh
log_file=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--log-file" ]; then
    shift
    log_file="$1"
  fi
  shift
done
echo "Created conversation 0bdd2166-d420-40c6-94be-70b93eb290c5" > "$log_file"
"#,
        )
        .expect("fake Antigravity companion should be written");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
            .expect("fake Antigravity companion should be executable");
        let adapter = AntigravityAppRuntimeAdapter::new(&root).expect("Adapter should initialize");
        let error = adapter
            .run(AntigravityRunRequest {
                agent_run_id: uuid::Uuid::new_v4().to_string(),
                execution_epoch: 1,
                workspace: AgentRunWorkspace {
                    execution_root: workspace.to_string_lossy().to_string(),
                    access: "read_write".to_string(),
                    isolation: "shared".to_string(),
                },
                permission_semantics: PermissionSemantics::RuntimeManagedV2,
                runtime: FrozenAgentRuntimeConfig {
                    adapter_kind: AdapterKind::AntigravityApp,
                    installation_id: "delivered-failure-test".to_string(),
                    installation_generation: 1,
                    search_environment_generation: 1,
                    executable_path: executable.to_string_lossy().to_string(),
                    auth_scope: "local-user".to_string(),
                    reported_version: "test".to_string(),
                    executable_fingerprint: "test-fingerprint".to_string(),
                    capabilities: vec!["cli.print".to_string()],
                    protocol_version: "antigravity-app-cli-v1".to_string(),
                    model: ResolvedModelSelection {
                        source: "runtime_default".to_string(),
                        model_id: ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID.to_string(),
                        options: json!({}),
                    },
                    permissions: AdapterPermissionConfig {
                        adapter_kind: AdapterKind::AntigravityApp,
                        schema_version: 1,
                        values: json!({
                            "mode": "accept-edits",
                            "sandbox": "on",
                            "dangerously_skip_permissions": "off",
                        }),
                    },
                    native_session_compatibility_key: Some("antigravity-app:cli-v1".to_string()),
                    binding_compatibility_digest: "test-binding".to_string(),
                    host_config_digest: "test-host".to_string(),
                    config_digest: "test-config".to_string(),
                },
                prompt: "produce no final output".to_string(),
                resumable_native_session_id: None,
                attachment_access_root: None,
                builtin_tools: None,
                input_accepted: None,
                launch_handoff: None,
            })
            .await
            .expect_err("a verified Session without final text must not look successful");
        let delivered = error
            .downcast_ref::<AntigravityDeliveredFailure>()
            .expect("the failure should preserve delivered-input identity");
        assert_eq!(delivered.error_code, "runtime_missing_final_output");
        assert_eq!(
            delivered.native_session_id,
            "0bdd2166-d420-40c6-94be-70b93eb290c5"
        );
        std::fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn interrupt_after_acceptance_terminates_process_and_removes_private_logs() {
        use std::os::unix::fs::PermissionsExt;

        use rovai_core::agent_profile::{
            AdapterKind, AdapterPermissionConfig, ResolvedModelSelection,
        };
        use serde_json::json;

        let root = std::env::temp_dir().join(format!(
            "rovai-antigravity-interrupt-test-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace should be created");
        let executable = root.join("fake-agy");
        std::fs::write(
            &executable,
            r#"#!/bin/sh
log_file=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--log-file" ]; then
    shift
    log_file="$1"
  fi
  shift
done
session_id="0bdd2166-d420-40c6-94be-70b93eb290c5"
echo "Created conversation $session_id" > "$log_file"
echo "Forwarding user message to conversation $session_id" >> "$log_file"
echo "I0811 streamGenerateContent?alt=sse request completed ResponseID: response-1" >> "$log_file"
exec sleep 30
"#,
        )
        .expect("fake Antigravity companion should be written");
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
            .expect("fake Antigravity companion should be executable");
        let adapter =
            Arc::new(AntigravityAppRuntimeAdapter::new(&root).expect("Adapter should initialize"));
        let run_id = uuid::Uuid::new_v4().to_string();
        let (accepted_sender, mut accepted_receiver) = mpsc::unbounded_channel();
        let request = AntigravityRunRequest {
            agent_run_id: run_id.clone(),
            execution_epoch: 1,
            workspace: AgentRunWorkspace {
                execution_root: workspace.to_string_lossy().to_string(),
                access: "read_only".to_string(),
                isolation: "shared".to_string(),
            },
            permission_semantics: PermissionSemantics::CoreEnforcedV1,
            runtime: FrozenAgentRuntimeConfig {
                adapter_kind: AdapterKind::AntigravityApp,
                installation_id: "agy-test".to_string(),
                installation_generation: 1,
                search_environment_generation: 1,
                executable_path: executable.to_string_lossy().to_string(),
                auth_scope: "test".to_string(),
                reported_version: "test".to_string(),
                executable_fingerprint: "sha256:test".to_string(),
                capabilities: vec!["cli.print".to_string()],
                protocol_version: "antigravity-app-cli-v1".to_string(),
                model: ResolvedModelSelection {
                    source: "runtime_default".to_string(),
                    model_id: ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID.to_string(),
                    options: json!({}),
                },
                permissions: AdapterPermissionConfig {
                    adapter_kind: AdapterKind::AntigravityApp,
                    schema_version: 1,
                    values: json!({
                        "mode": "plan",
                        "sandbox": "on",
                        "dangerously_skip_permissions": "off",
                    }),
                },
                native_session_compatibility_key: Some("antigravity-app:cli-v1".to_string()),
                binding_compatibility_digest: "binding".to_string(),
                host_config_digest: "host".to_string(),
                config_digest: "config".to_string(),
            },
            prompt: "wait".to_string(),
            resumable_native_session_id: None,
            attachment_access_root: None,
            builtin_tools: None,
            input_accepted: Some(accepted_sender),
            launch_handoff: None,
        };
        let running_adapter = adapter.clone();
        let task = tokio::spawn(async move { running_adapter.run(request).await });
        let deadline = Instant::now() + Duration::from_secs(2);
        while adapter.active.lock().await.is_empty() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let accepted = tokio::time::timeout(Duration::from_secs(5), accepted_receiver.recv())
            .await
            .expect("accepted evidence should be observed before interruption")
            .expect("accepted evidence channel should stay open");
        assert_eq!(
            accepted.native_session_id,
            "0bdd2166-d420-40c6-94be-70b93eb290c5"
        );
        assert!(adapter.interrupt(&run_id, 1).await);
        let error = task
            .await
            .expect("run task should join")
            .expect_err("interrupted Run should fail safely");
        assert!(format!("{error:#}").contains("interrupted"));
        assert!(
            std::fs::read_dir(root.join("runtime-private/antigravity"))
                .expect("private log directory should exist")
                .next()
                .is_none()
        );
        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }
}
