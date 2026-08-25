use std::{
    collections::BTreeSet,
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use rovai_core::{
    agent_profile::AdapterKind,
    agent_runtime_adapter::{
        GROK_BUILD_MINIMUM_VERSION_LABEL, KIRO_ADDITIVE_AGENT_NAME, executable_fingerprint,
        grok_build_minimum_version_satisfied, trae_machine_ready_capabilities,
        trae_machine_ready_requirements, write_kiro_additive_agent_config,
    },
    managed_process::{ManagedChildStdin, ManagedChildStdout},
    runtime_discovery::{
        RuntimeLaunchPurpose, configure_active_runtime_command, discover_static_runtime_version,
        is_cursor_agent_version, is_executable_file, runtime_launch_allowed,
    },
    runtime_failure::{
        RuntimeFailureOrigin, RuntimeFailurePhase, RuntimeFailureView,
        public_runtime_failure_from_output,
    },
    runtime_probe_process::{
        BoundedCommandOutput, BoundedLineReader, DEFAULT_CAPTURE_LIMIT, DEFAULT_CLEANUP_TIMEOUT,
        DEFAULT_LINE_LIMIT, ProbeCommandLimits, RuntimeProbeProcess, run_bounded_command,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};

const CODEX_RUNTIME_KIND: &str = "codex-cli";
const ACP_STDOUT_LIMIT: usize = 4 * 1024 * 1024;

struct ProbeRootCleanup(PathBuf);

impl Drop for ProbeRootCleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn runtime_command(executable: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(executable);
    configure_active_runtime_command(&mut command);
    command
}

async fn bounded_output(command: &mut Command, deadline: Duration) -> Result<BoundedCommandOutput> {
    run_bounded_command(
        command,
        ProbeCommandLimits {
            deadline,
            stdout_bytes: DEFAULT_CAPTURE_LIMIT,
            stderr_bytes: DEFAULT_CAPTURE_LIMIT,
            cleanup_timeout: DEFAULT_CLEANUP_TIMEOUT,
        },
    )
    .await
}

const REQUIRED_CODEX_CAPABILITIES: &[(&str, &str, &str)] = &[
    ("model.list", "ClientRequest.json", "\"model/list\""),
    ("thread.start", "ClientRequest.json", "\"thread/start\""),
    ("thread.resume", "ClientRequest.json", "\"thread/resume\""),
    (
        "workspace.additional_roots",
        "ClientRequest.json",
        "\"runtimeWorkspaceRoots\"",
    ),
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
    pub failure: Option<RuntimeFailureView>,
    pub probed_at: String,
}

#[derive(Debug, Clone)]
pub struct AcpCapabilityProbe {
    pub result: AgentRuntimeProbeResult,
    pub initialize_result: Option<Value>,
    pub session_result: Option<Value>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
struct TraeBehavioralProbeEvidence {
    capabilities: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ClaudeCodeCapabilityProbe {
    pub result: AgentRuntimeProbeResult,
    pub model_aliases: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct AntigravityCapabilityProbe {
    pub result: AgentRuntimeProbeResult,
    pub models: Vec<String>,
}

pub async fn git_health(path: Option<PathBuf>) -> CommandHealth {
    let Some(path) = path else {
        return CommandHealth {
            installed: false,
            version: None,
            authenticated: None,
            detail: Some("git executable was not found in the Runtime search environment".into()),
            path: None,
        };
    };
    command_health("git", &["--version"], Some(path)).await
}

pub async fn codex_runtime_probe_at(path: &Path) -> AgentRuntimeProbeResult {
    let probed_at = chrono::Utc::now().to_rfc3339();
    let path_text = path.to_string_lossy().to_string();
    if !path.is_file() {
        return probe_result(
            Some(path_text),
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
    let fingerprint = executable_fingerprint_async(path.clone()).await;
    codex_runtime_probe_uncached(path, path_text, fingerprint, probed_at).await
}

pub async fn acp_capability_probe_at_for_purpose(
    path: &Path,
    kind: AdapterKind,
    purpose: RuntimeLaunchPurpose,
) -> AcpCapabilityProbe {
    acp_probe_at(path, kind, acp_deep_session_probe_enabled(kind), purpose).await
}

fn runtime_launch_disallowed_detail(purpose: RuntimeLaunchPurpose) -> String {
    let purpose = match purpose {
        RuntimeLaunchPurpose::DiscoveryVersion => "discovery_version",
        RuntimeLaunchPurpose::AvailabilityCheck => "availability_check",
        RuntimeLaunchPurpose::InstallationRefresh => "installation_refresh",
        RuntimeLaunchPurpose::HealthProbe => "health_probe",
        RuntimeLaunchPurpose::DispatchPreflight => "dispatch_preflight",
        RuntimeLaunchPurpose::AgentExecution => "agent_execution",
    };
    format!("runtime_launch_disallowed_for_{purpose}")
}

pub async fn claude_code_capability_probe_at(path: &Path) -> ClaudeCodeCapabilityProbe {
    claude_code_probe_at(path).await
}

pub async fn antigravity_capability_probe_at(path: &Path) -> AntigravityCapabilityProbe {
    antigravity_probe_at(path).await
}

async fn claude_code_probe_at(path: &Path) -> ClaudeCodeCapabilityProbe {
    let probed_at = chrono::Utc::now().to_rfc3339();
    let path_text = path.to_string_lossy().to_string();
    if !path.is_file() {
        let failure = public_probe_failure(
            AdapterKind::ClaudeCodeCli,
            RuntimeFailureOrigin::Environment,
            RuntimeFailurePhase::Spawn,
            "runtime_executable_unavailable",
            "Claude Code 可执行文件不可用",
            "Configured Claude Code executable does not exist.",
            path,
            false,
        );
        return claude_code_probe_failure(
            path_text,
            None,
            None,
            AgentRuntimeProbeStatus::NotInstalled,
            "Configured Claude Code executable does not exist.".to_string(),
            failure,
            probed_at,
        );
    }
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let fingerprint = executable_fingerprint_async(canonical.clone()).await;
    let mut version_command = runtime_command(&canonical);
    version_command.arg("--version");
    let version = bounded_output(&mut version_command, Duration::from_secs(15)).await;
    let reported_version = match version {
        Ok(output) if output.status.success() => {
            first_nonempty_line(&output.stdout.bytes, &output.stderr.bytes)
        }
        Ok(output) => {
            let raw_detail = bounded_probe_text(&output.stdout.bytes, &output.stderr.bytes);
            let failure = public_probe_failure(
                AdapterKind::ClaudeCodeCli,
                RuntimeFailureOrigin::Runtime,
                RuntimeFailurePhase::Execution,
                "runtime_process_failed",
                "Claude Code 版本检查失败",
                &raw_detail,
                &canonical,
                true,
            );
            return claude_code_probe_failure(
                path_text,
                fingerprint,
                None,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!(
                    "Claude Code version check failed with {} (outputDigest={})",
                    output.status,
                    probe_output_digest(&output.stdout.bytes, &output.stderr.bytes)
                ),
                failure,
                probed_at,
            );
        }
        Err(error) => {
            let raw_detail = error.to_string();
            let failure = public_probe_failure(
                AdapterKind::ClaudeCodeCli,
                RuntimeFailureOrigin::Environment,
                RuntimeFailurePhase::Spawn,
                "runtime_spawn_failed",
                "无法启动 Claude Code 检查",
                &raw_detail,
                &canonical,
                true,
            );
            return claude_code_probe_failure(
                path_text,
                fingerprint,
                None,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!("failed to inspect Claude Code: {error}"),
                failure,
                probed_at,
            );
        }
    };

    let mut help_command = runtime_command(&canonical);
    help_command.arg("--help");
    let help = bounded_output(&mut help_command, Duration::from_secs(15)).await;
    let help = match help {
        Ok(output) if output.status.success() => {
            bounded_probe_text(&output.stdout.bytes, &output.stderr.bytes)
        }
        Ok(output) => {
            let raw_detail = bounded_probe_text(&output.stdout.bytes, &output.stderr.bytes);
            let failure = public_probe_failure(
                AdapterKind::ClaudeCodeCli,
                RuntimeFailureOrigin::Runtime,
                RuntimeFailurePhase::Execution,
                "runtime_process_failed",
                "Claude Code 能力检查失败",
                &raw_detail,
                &canonical,
                true,
            );
            return claude_code_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!(
                    "Claude Code help check failed with {} (outputDigest={})",
                    output.status,
                    probe_output_digest(&output.stdout.bytes, &output.stderr.bytes)
                ),
                failure,
                probed_at,
            );
        }
        Err(error) => {
            let raw_detail = error.to_string();
            let failure = public_probe_failure(
                AdapterKind::ClaudeCodeCli,
                RuntimeFailureOrigin::Environment,
                RuntimeFailurePhase::Spawn,
                "runtime_spawn_failed",
                "无法启动 Claude Code 能力检查",
                &raw_detail,
                &canonical,
                true,
            );
            return claude_code_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!("failed to inspect Claude Code capabilities: {error}"),
                failure,
                probed_at,
            );
        }
    };
    let required = [
        ("cli.print", "--print"),
        ("output.json", "--output-format"),
        ("conversation.resume", "--resume"),
        ("conversation.create", "--session-id"),
        ("context.charter.native_append", "--append-system-prompt"),
        ("team_tool.mcp_config", "--mcp-config"),
        ("team_tool.allow", "--allowedTools"),
        ("workspace.additional_roots", "--add-dir"),
        ("permission.mode", "--permission-mode"),
        ("model.select", "--model"),
    ];
    let mut capabilities = Vec::new();
    let mut missing = Vec::new();
    for (capability, flag) in required {
        if help.contains(flag) {
            capabilities.push(capability.to_string());
        } else {
            missing.push(capability.to_string());
        }
    }
    if !missing.is_empty() {
        let raw_detail = format!("Missing required options: {}", missing.join(", "));
        let failure = public_probe_failure(
            AdapterKind::ClaudeCodeCli,
            RuntimeFailureOrigin::Compatibility,
            RuntimeFailurePhase::Execution,
            "runtime_capability_incompatible",
            "当前 Claude Code 版本缺少 Rovai 所需能力",
            &raw_detail,
            &canonical,
            false,
        );
        let mut result = agent_probe_result(
            AdapterKind::ClaudeCodeCli.as_str(),
            Some(path_text),
            reported_version,
            fingerprint,
            AgentRuntimeProbeStatus::MissingCapabilities,
            capabilities,
            missing,
            Some(
                "Claude Code is missing flags required by Rovai-ai's print-mode integration."
                    .to_string(),
            ),
            probed_at,
        );
        result.failure = Some(failure);
        return ClaudeCodeCapabilityProbe {
            result,
            model_aliases: Vec::new(),
        };
    }

    let mut auth_command = runtime_command(&canonical);
    auth_command.args(["auth", "status"]);
    let auth = bounded_output(&mut auth_command, Duration::from_secs(15)).await;
    let authenticated = match auth {
        Ok(output) if output.status.success() => {
            serde_json::from_slice::<Value>(&output.stdout.bytes)
                .ok()
                .and_then(|value| value.get("loggedIn").and_then(Value::as_bool))
                // Older/newer Claude Code releases may render a successful
                // human-readable status instead of JSON. A zero exit code is
                // still the installed CLI's authoritative auth result.
                .unwrap_or(true)
        }
        Ok(output) => {
            let raw_detail = bounded_probe_text(&output.stdout.bytes, &output.stderr.bytes);
            let failure = public_probe_failure(
                AdapterKind::ClaudeCodeCli,
                RuntimeFailureOrigin::Runtime,
                RuntimeFailurePhase::Authentication,
                "runtime_authentication_required",
                "需要登录 Claude Code",
                &raw_detail,
                &canonical,
                true,
            );
            return claude_code_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                AgentRuntimeProbeStatus::AuthenticationRequired,
                format!(
                    "Claude Code authentication check failed with {} (outputDigest={})",
                    output.status,
                    probe_output_digest(&output.stdout.bytes, &output.stderr.bytes)
                ),
                failure,
                probed_at,
            );
        }
        Err(error) => {
            let raw_detail = error.to_string();
            let failure = public_probe_failure(
                AdapterKind::ClaudeCodeCli,
                RuntimeFailureOrigin::Environment,
                RuntimeFailurePhase::Spawn,
                "runtime_spawn_failed",
                "无法启动 Claude Code 认证检查",
                &raw_detail,
                &canonical,
                true,
            );
            return claude_code_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!("failed to inspect Claude Code authentication: {error}"),
                failure,
                probed_at,
            );
        }
    };
    if !authenticated {
        let failure = public_probe_failure(
            AdapterKind::ClaudeCodeCli,
            RuntimeFailureOrigin::Runtime,
            RuntimeFailurePhase::Authentication,
            "runtime_authentication_required",
            "需要登录 Claude Code",
            "Claude Code is not logged in.",
            &canonical,
            true,
        );
        return claude_code_probe_failure(
            path_text,
            fingerprint,
            reported_version,
            AgentRuntimeProbeStatus::AuthenticationRequired,
            "Claude Code is not logged in.".to_string(),
            failure,
            probed_at,
        );
    }
    capabilities.push("process.interrupt".to_string());
    let model_aliases = claude_code_model_aliases(&help);
    if !model_aliases.is_empty() {
        capabilities.push("model.aliases".to_string());
    }
    ClaudeCodeCapabilityProbe {
        result: agent_probe_result(
            AdapterKind::ClaudeCodeCli.as_str(),
            Some(path_text),
            reported_version,
            fingerprint,
            AgentRuntimeProbeStatus::Ready,
            capabilities,
            Vec::new(),
            None,
            probed_at,
        ),
        model_aliases,
    }
}

async fn antigravity_probe_at(path: &Path) -> AntigravityCapabilityProbe {
    let probed_at = chrono::Utc::now().to_rfc3339();
    let path_text = path.to_string_lossy().to_string();
    if !path.is_file() {
        let failure = public_probe_failure(
            AdapterKind::AntigravityApp,
            RuntimeFailureOrigin::Environment,
            RuntimeFailurePhase::Spawn,
            "runtime_executable_unavailable",
            "Antigravity 可执行文件不可用",
            "Configured Antigravity companion executable does not exist.",
            path,
            false,
        );
        return antigravity_probe_failure(
            path_text,
            None,
            None,
            AgentRuntimeProbeStatus::NotInstalled,
            "Configured Antigravity companion executable does not exist.".to_string(),
            failure,
            probed_at,
        );
    }
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let fingerprint = executable_fingerprint_async(canonical.clone()).await;
    let mut version_command = runtime_command(&canonical);
    version_command.arg("--version");
    let version = bounded_output(&mut version_command, Duration::from_secs(15)).await;
    let reported_version = match version {
        Ok(output) if output.status.success() => {
            first_nonempty_line(&output.stdout.bytes, &output.stderr.bytes)
        }
        Ok(output) => {
            let raw_detail = bounded_probe_text(&output.stdout.bytes, &output.stderr.bytes);
            let failure = public_probe_failure(
                AdapterKind::AntigravityApp,
                RuntimeFailureOrigin::Runtime,
                RuntimeFailurePhase::Execution,
                "runtime_process_failed",
                "Antigravity 版本检查失败",
                &raw_detail,
                &canonical,
                true,
            );
            return antigravity_probe_failure(
                path_text,
                fingerprint,
                None,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!(
                    "Antigravity companion version check failed with {} (outputDigest={})",
                    output.status,
                    probe_output_digest(&output.stdout.bytes, &output.stderr.bytes)
                ),
                failure,
                probed_at,
            );
        }
        Err(error) => {
            let raw_detail = error.to_string();
            let failure = public_probe_failure(
                AdapterKind::AntigravityApp,
                RuntimeFailureOrigin::Environment,
                RuntimeFailurePhase::Spawn,
                "runtime_spawn_failed",
                "无法启动 Antigravity 检查",
                &raw_detail,
                &canonical,
                true,
            );
            return antigravity_probe_failure(
                path_text,
                fingerprint,
                None,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!("failed to inspect Antigravity companion CLI: {error}"),
                failure,
                probed_at,
            );
        }
    };

    let mut help_command = runtime_command(&canonical);
    help_command.arg("--help");
    let help = bounded_output(&mut help_command, Duration::from_secs(15)).await;
    let help = match help {
        Ok(output) if output.status.success() => {
            bounded_probe_text(&output.stdout.bytes, &output.stderr.bytes)
        }
        Ok(output) => {
            let raw_detail = bounded_probe_text(&output.stdout.bytes, &output.stderr.bytes);
            let failure = public_probe_failure(
                AdapterKind::AntigravityApp,
                RuntimeFailureOrigin::Runtime,
                RuntimeFailurePhase::Execution,
                "runtime_process_failed",
                "Antigravity 能力检查失败",
                &raw_detail,
                &canonical,
                true,
            );
            return antigravity_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!(
                    "Antigravity help check failed with {} (outputDigest={})",
                    output.status,
                    probe_output_digest(&output.stdout.bytes, &output.stderr.bytes)
                ),
                failure,
                probed_at,
            );
        }
        Err(error) => {
            let raw_detail = error.to_string();
            let failure = public_probe_failure(
                AdapterKind::AntigravityApp,
                RuntimeFailureOrigin::Environment,
                RuntimeFailurePhase::Spawn,
                "runtime_spawn_failed",
                "无法启动 Antigravity 能力检查",
                &raw_detail,
                &canonical,
                true,
            );
            return antigravity_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!("failed to inspect Antigravity companion capabilities: {error}"),
                failure,
                probed_at,
            );
        }
    };
    let mut capabilities = Vec::new();
    let required = [
        ("cli.print", "--print"),
        ("conversation.resume", "--conversation"),
        ("model.select", "--model"),
        ("execution.mode", "--mode"),
        ("workspace.sandbox", "--sandbox"),
        ("workspace.additional_roots", "--add-dir"),
        ("session.log_file", "--log-file"),
        ("print.timeout", "--print-timeout"),
    ];
    let mut missing = Vec::new();
    for (capability, flag) in required {
        if help.contains(flag) {
            capabilities.push(capability.to_string());
        } else {
            missing.push(capability.to_string());
        }
    }
    if !missing.is_empty() {
        let raw_detail = format!("Missing required options: {}", missing.join(", "));
        let failure = public_probe_failure(
            AdapterKind::AntigravityApp,
            RuntimeFailureOrigin::Compatibility,
            RuntimeFailurePhase::Execution,
            "runtime_capability_incompatible",
            "当前 Antigravity 版本缺少 Rovai 所需能力",
            &raw_detail,
            &canonical,
            false,
        );
        let mut result = agent_probe_result(
            AdapterKind::AntigravityApp.as_str(),
            Some(path_text),
            reported_version,
            fingerprint,
            AgentRuntimeProbeStatus::MissingCapabilities,
            capabilities,
            missing,
            Some(
                "Antigravity App's companion CLI is missing flags required by Rovai-ai."
                    .to_string(),
            ),
            probed_at,
        );
        result.failure = Some(failure);
        return AntigravityCapabilityProbe {
            result,
            models: Vec::new(),
        };
    }
    if antigravity_stream_json_supported(&help) {
        capabilities.push("output.stream_json".to_string());
    }

    let mut model_command = runtime_command(&canonical);
    model_command.arg("models");
    let model_output = bounded_output(&mut model_command, Duration::from_secs(60)).await;
    match model_output {
        Ok(output) if output.status.success() => {
            let models = String::from_utf8_lossy(&output.stdout.bytes)
                .lines()
                .filter_map(antigravity_model_identifier_from_line)
                .collect::<Vec<_>>();
            if models.is_empty() {
                let failure = public_probe_failure(
                    AdapterKind::AntigravityApp,
                    RuntimeFailureOrigin::Compatibility,
                    RuntimeFailurePhase::ModelCatalog,
                    "runtime_model_catalog_incompatible",
                    "Antigravity 未返回可识别的模型列表",
                    "Antigravity model discovery returned no model identifiers.",
                    &canonical,
                    false,
                );
                return antigravity_probe_failure(
                    path_text,
                    fingerprint,
                    reported_version,
                    AgentRuntimeProbeStatus::ProbeFailed,
                    "Antigravity model discovery returned no model identifiers".to_string(),
                    failure,
                    probed_at,
                );
            }
            capabilities.push("model.list".to_string());
            capabilities.push("process.interrupt".to_string());
            AntigravityCapabilityProbe {
                result: agent_probe_result(
                    AdapterKind::AntigravityApp.as_str(),
                    Some(path_text),
                    reported_version,
                    fingerprint,
                    AgentRuntimeProbeStatus::Ready,
                    capabilities,
                    Vec::new(),
                    None,
                    probed_at,
                ),
                models,
            }
        }
        Ok(output) => {
            let raw_detail = bounded_probe_text(&output.stdout.bytes, &output.stderr.bytes);
            let lower = raw_detail.to_ascii_lowercase();
            let authentication_required =
                lower.contains("auth") || lower.contains("login") || lower.contains("credential");
            let status = if authentication_required {
                AgentRuntimeProbeStatus::AuthenticationRequired
            } else {
                AgentRuntimeProbeStatus::ProbeFailed
            };
            let detail = format!(
                "Antigravity model discovery failed with {} (outputDigest={})",
                output.status,
                probe_output_digest(&output.stdout.bytes, &output.stderr.bytes)
            );
            let failure = public_probe_failure(
                AdapterKind::AntigravityApp,
                RuntimeFailureOrigin::Runtime,
                if authentication_required {
                    RuntimeFailurePhase::Authentication
                } else {
                    RuntimeFailurePhase::ModelCatalog
                },
                if authentication_required {
                    "runtime_authentication_required"
                } else {
                    "runtime_process_failed"
                },
                if authentication_required {
                    "需要登录 Antigravity"
                } else {
                    "Antigravity 模型检查失败"
                },
                &raw_detail,
                &canonical,
                true,
            );
            antigravity_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                status,
                detail,
                failure,
                probed_at,
            )
        }
        Err(error) => {
            let raw_detail = error.to_string();
            let failure = public_probe_failure(
                AdapterKind::AntigravityApp,
                RuntimeFailureOrigin::Environment,
                RuntimeFailurePhase::Spawn,
                "runtime_spawn_failed",
                "无法启动 Antigravity 模型检查",
                &raw_detail,
                &canonical,
                true,
            );
            antigravity_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!("failed to discover Antigravity models: {error}"),
                failure,
                probed_at,
            )
        }
    }
}

fn antigravity_stream_json_supported(help: &str) -> bool {
    help.contains("--output-format") && help.contains("stream-json")
}

fn is_antigravity_model_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/' | b':' | b'+')
        })
}

fn antigravity_model_identifier_from_line(line: &str) -> Option<String> {
    let line = line.trim();
    let candidate = match line.split_once('\t') {
        Some((identifier, _display_name)) => identifier.trim(),
        None if !line.chars().any(char::is_whitespace) => line,
        None => return None,
    };
    is_antigravity_model_identifier(candidate).then(|| candidate.to_string())
}

fn probe_output_digest(stdout: &[u8], stderr: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(stdout);
    digest.update([0]);
    digest.update(stderr);
    format!("sha256:{:x}", digest.finalize())
}

#[expect(
    clippy::too_many_arguments,
    reason = "the probed Runtime and closed public failure fields stay explicit at this boundary"
)]
fn public_probe_failure(
    runtime_kind: AdapterKind,
    default_origin: RuntimeFailureOrigin,
    phase: RuntimeFailurePhase,
    default_code: &str,
    default_summary: &str,
    raw_detail: &str,
    executable_path: &Path,
    retryable: bool,
) -> RuntimeFailureView {
    let lower = raw_detail.to_ascii_lowercase();
    let option_incompatible = [
        "unknown option",
        "unrecognized option",
        "unsupported option",
        "unknown command",
        "unrecognized command",
        "unsupported command",
        "unknown argument",
        "unrecognized argument",
        "unsupported argument",
    ]
    .iter()
    .any(|marker| lower.contains(marker));
    let (origin, code, summary) = if option_incompatible {
        (
            RuntimeFailureOrigin::Compatibility,
            "runtime_capability_incompatible",
            match runtime_kind {
                AdapterKind::ClaudeCodeCli => "当前 Claude Code 版本不支持所需命令",
                AdapterKind::AntigravityApp => "当前 Antigravity 版本不支持所需命令",
                _ => default_summary,
            },
        )
    } else {
        (default_origin, default_code, default_summary)
    };
    public_runtime_failure_from_output(
        runtime_kind,
        origin,
        phase,
        code,
        summary,
        Some(raw_detail),
        &[(executable_path, "<runtime-executable>")],
        retryable,
    )
}

fn bounded_probe_text(stdout: &[u8], stderr: &[u8]) -> String {
    format!(
        "{}\n{}",
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr)
    )
}

fn antigravity_probe_failure(
    path: String,
    fingerprint: Option<String>,
    reported_version: Option<String>,
    status: AgentRuntimeProbeStatus,
    detail: String,
    failure: RuntimeFailureView,
    probed_at: String,
) -> AntigravityCapabilityProbe {
    let status = public_probe_status(status, &failure);
    let mut result = agent_probe_result(
        AdapterKind::AntigravityApp.as_str(),
        Some(path),
        reported_version,
        fingerprint,
        status,
        Vec::new(),
        antigravity_required_capabilities(),
        Some(detail),
        probed_at,
    );
    result.failure = Some(failure);
    AntigravityCapabilityProbe {
        result,
        models: Vec::new(),
    }
}

fn claude_code_probe_failure(
    path: String,
    fingerprint: Option<String>,
    reported_version: Option<String>,
    status: AgentRuntimeProbeStatus,
    detail: String,
    failure: RuntimeFailureView,
    probed_at: String,
) -> ClaudeCodeCapabilityProbe {
    let status = public_probe_status(status, &failure);
    let mut result = agent_probe_result(
        AdapterKind::ClaudeCodeCli.as_str(),
        Some(path),
        reported_version,
        fingerprint,
        status,
        Vec::new(),
        claude_code_required_capabilities(),
        Some(detail),
        probed_at,
    );
    result.failure = Some(failure);
    ClaudeCodeCapabilityProbe {
        result,
        model_aliases: Vec::new(),
    }
}

fn public_probe_status(
    default_status: AgentRuntimeProbeStatus,
    failure: &RuntimeFailureView,
) -> AgentRuntimeProbeStatus {
    if failure.origin == RuntimeFailureOrigin::Compatibility {
        AgentRuntimeProbeStatus::MissingCapabilities
    } else if failure.phase == RuntimeFailurePhase::Authentication
        && failure.code == "runtime_authentication_required"
    {
        AgentRuntimeProbeStatus::AuthenticationRequired
    } else {
        default_status
    }
}

fn claude_code_model_aliases(help: &str) -> Vec<String> {
    // Claude Code currently exposes model selection but not a machine-readable
    // model catalog. Only advertise aliases explicitly named by the installed
    // binary instead of freezing a version-specific model list in Rovai-ai.
    ["sonnet", "opus", "haiku", "fable"]
        .into_iter()
        .filter(|alias| {
            help.contains(&format!("'{alias}'")) || help.contains(&format!("\"{alias}\""))
        })
        .map(str::to_string)
        .collect()
}

fn claude_code_required_capabilities() -> Vec<String> {
    [
        "cli.print",
        "output.json",
        "conversation.resume",
        "conversation.create",
        "context.charter.native_append",
        "team_tool.mcp_config",
        "team_tool.allow",
        "workspace.additional_roots",
        "permission.mode",
        "model.select",
        "process.interrupt",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

fn first_nonempty_line(stdout: &[u8], stderr: &[u8]) -> Option<String> {
    String::from_utf8_lossy(stdout)
        .lines()
        .chain(String::from_utf8_lossy(stderr).lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn antigravity_required_capabilities() -> Vec<String> {
    [
        "cli.print",
        "conversation.resume",
        "model.select",
        "execution.mode",
        "workspace.sandbox",
        "workspace.additional_roots",
        "session.log_file",
        "print.timeout",
        "model.list",
        "process.interrupt",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

async fn acp_probe_at(
    path: &Path,
    kind: AdapterKind,
    include_session: bool,
    purpose: RuntimeLaunchPurpose,
) -> AcpCapabilityProbe {
    let probed_at = chrono::Utc::now().to_rfc3339();
    let path_text = path.to_string_lossy().to_string();
    let required_capabilities = acp_required_capabilities(kind);
    if !matches!(
        kind,
        AdapterKind::OpencodeCli
            | AdapterKind::CopilotCli
            | AdapterKind::KiroCli
            | AdapterKind::QoderCli
            | AdapterKind::CodebuddyCli
            | AdapterKind::QwenCode
            | AdapterKind::TraeCnCli
            | AdapterKind::GrokBuild
            | AdapterKind::CursorAgent
            | AdapterKind::KimiCodeCli
    ) {
        return AcpCapabilityProbe {
            result: agent_probe_result(
                kind.as_str(),
                Some(path_text),
                None,
                None,
                AgentRuntimeProbeStatus::MissingCapabilities,
                Vec::new(),
                required_capabilities.clone(),
                Some("This Adapter has no ACP integration in this release.".to_string()),
                probed_at,
            ),
            initialize_result: None,
            session_result: None,
        };
    }
    if !path.is_file() {
        return AcpCapabilityProbe {
            result: agent_probe_result(
                kind.as_str(),
                Some(path_text),
                None,
                None,
                AgentRuntimeProbeStatus::NotInstalled,
                Vec::new(),
                required_capabilities.clone(),
                Some("Configured Runtime executable does not exist.".to_string()),
                probed_at,
            ),
            initialize_result: None,
            session_result: None,
        };
    }
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let fingerprint = executable_fingerprint_async(canonical.clone()).await;
    if !runtime_launch_allowed(kind, purpose) {
        return AcpCapabilityProbe {
            result: agent_probe_result(
                kind.as_str(),
                Some(path_text),
                discover_static_runtime_version(kind, &canonical),
                fingerprint,
                AgentRuntimeProbeStatus::ProbeFailed,
                Vec::new(),
                required_capabilities.clone(),
                Some(runtime_launch_disallowed_detail(purpose)),
                probed_at,
            ),
            initialize_result: None,
            session_result: None,
        };
    }
    let mut version_command = runtime_command(&canonical);
    version_command.arg("--version");
    let version_output = match bounded_output(&mut version_command, Duration::from_secs(15)).await {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            return AcpCapabilityProbe {
                result: agent_probe_result(
                    kind.as_str(),
                    Some(path_text),
                    None,
                    fingerprint,
                    AgentRuntimeProbeStatus::ProbeFailed,
                    Vec::new(),
                    required_capabilities.clone(),
                    Some(command_detail(
                        &output.stdout.bytes,
                        &output.stderr.bytes,
                        "Runtime version check failed",
                    )),
                    probed_at,
                ),
                initialize_result: None,
                session_result: None,
            };
        }
        Err(error) => {
            return AcpCapabilityProbe {
                result: agent_probe_result(
                    kind.as_str(),
                    Some(path_text),
                    None,
                    fingerprint,
                    AgentRuntimeProbeStatus::ProbeFailed,
                    Vec::new(),
                    required_capabilities.clone(),
                    Some(format!("failed to inspect Runtime CLI: {error}")),
                    probed_at,
                ),
                initialize_result: None,
                session_result: None,
            };
        }
    };
    let reported_version =
        first_nonempty_line(&version_output.stdout.bytes, &version_output.stderr.bytes);
    if kind == AdapterKind::CursorAgent
        && reported_version
            .as_deref()
            .is_none_or(|version| !is_cursor_agent_version(version))
    {
        return AcpCapabilityProbe {
            result: agent_probe_result(
                kind.as_str(),
                Some(path_text),
                reported_version,
                fingerprint,
                AgentRuntimeProbeStatus::MissingCapabilities,
                Vec::new(),
                required_capabilities.clone(),
                Some("The executable did not report a Cursor Agent build identity.".to_string()),
                probed_at,
            ),
            initialize_result: None,
            session_result: None,
        };
    }
    if kind == AdapterKind::GrokBuild
        && !grok_build_minimum_version_satisfied(reported_version.as_deref())
    {
        return AcpCapabilityProbe {
            result: agent_probe_result(
                kind.as_str(),
                Some(path_text),
                reported_version,
                fingerprint,
                AgentRuntimeProbeStatus::MissingCapabilities,
                Vec::new(),
                vec![format!(
                    "runtime.version>={GROK_BUILD_MINIMUM_VERSION_LABEL}"
                )],
                Some(format!(
                    "Grok Build >= {GROK_BUILD_MINIMUM_VERSION_LABEL} is required."
                )),
                probed_at,
            ),
            initialize_result: None,
            session_result: None,
        };
    }
    let probe = run_acp_probe(&canonical, kind, include_session, purpose).await;
    match probe {
        Ok((initialize_result, session_result, grok_resume_verified)) => {
            let mut capabilities = acp_observed_capabilities(
                kind,
                reported_version.as_deref(),
                fingerprint.as_deref(),
                &initialize_result,
                session_result.as_ref(),
                grok_resume_verified,
            );
            let additive_mcp = additive_acp_mcp_verified(kind);
            if additive_mcp {
                capabilities.push("mcp.additive_per_run".to_string());
            }
            capabilities.sort();
            capabilities.dedup();
            let required = required_capabilities;
            let missing = required
                .iter()
                .filter(|required| !capabilities.contains(required))
                .cloned()
                .collect::<Vec<_>>();
            let status = if missing.is_empty() {
                AgentRuntimeProbeStatus::Ready
            } else {
                AgentRuntimeProbeStatus::MissingCapabilities
            };
            let detail = (!missing.is_empty()).then(|| {
                format!(
                    "ACP handshake succeeded, but required capabilities are missing: {}",
                    missing.join(", ")
                )
            });
            AcpCapabilityProbe {
                result: agent_probe_result(
                    kind.as_str(),
                    Some(path_text),
                    reported_version,
                    fingerprint,
                    status,
                    capabilities,
                    missing,
                    detail,
                    probed_at,
                ),
                initialize_result: Some(initialize_result),
                session_result,
            }
        }
        Err(error) => {
            let detail = format!("ACP probe failed: {error:#}");
            let status = classify_acp_probe_failure(&detail);
            AcpCapabilityProbe {
                result: agent_probe_result(
                    kind.as_str(),
                    Some(path_text),
                    reported_version,
                    fingerprint,
                    status,
                    Vec::new(),
                    required_capabilities,
                    Some(detail),
                    probed_at,
                ),
                initialize_result: None,
                session_result: None,
            }
        }
    }
}

async fn run_acp_probe(
    path: &Path,
    kind: AdapterKind,
    include_session: bool,
    purpose: RuntimeLaunchPurpose,
) -> Result<(Value, Option<Value>, bool)> {
    if !runtime_launch_allowed(kind, purpose) {
        bail!(runtime_launch_disallowed_detail(purpose));
    }
    let probe_root = env::temp_dir().join(format!("rovai-acp-probe-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&probe_root)?;
    let _probe_root_cleanup = ProbeRootCleanup(probe_root.clone());
    if kind == AdapterKind::KiroCli {
        write_kiro_additive_agent_config(&probe_root, &Default::default())?;
    }
    let mut command = runtime_command(path);
    configure_acp_command(&mut command, kind, false);
    if kind == AdapterKind::CodebuddyCli
        && let Ok(model) = env::var("ROVAI_CODEBUDDY_MODEL")
    {
        let model = model.trim();
        if !model.is_empty() {
            command.arg("--model").arg(model);
        }
    }
    if kind == AdapterKind::KimiCodeCli {
        command.env("KIMI_CODE_HOME", probe_root.join("kimi-code-home"));
        crate::acp::configure_kimi_model_environment(&mut command)?;
    }
    let grok_byok_configured =
        kind == AdapterKind::GrokBuild && crate::acp::grok_native_byok_configured()?;
    if kind == AdapterKind::GrokBuild {
        // A BYOK Probe copies the official Grok configuration layers into a
        // disposable Home so the native parser and model catalog remain exact
        // without writing Probe Sessions into the user's Home. Account auth
        // retains the native Home so an existing cached token remains reachable.
        if grok_byok_configured {
            let grok_probe_home = probe_root.join("grok-home");
            crate::acp::prepare_grok_probe_home(&grok_probe_home)?;
            command.env("GROK_HOME", grok_probe_home);
        }
        crate::acp::configure_grok_native_environment(&mut command)?;
    }
    if kind == AdapterKind::TraeCnCli {
        command.args(["--permission-mode", "default"]);
    }
    if kind == AdapterKind::KiroCli {
        // Authentication remains in the user's native secure store, while
        // disposable probe Sessions stay out of the persistent Kiro home.
        command.env("KIRO_HOME", probe_root.join("kiro-home"));
    }
    command.current_dir(&probe_root).stdin(Stdio::piped());
    let mut process = RuntimeProbeProcess::spawn(
        &mut command,
        ACP_STDOUT_LIMIT,
        DEFAULT_CAPTURE_LIMIT,
        DEFAULT_LINE_LIMIT,
        DEFAULT_CLEANUP_TIMEOUT,
    )
    .with_context(|| format!("failed to start {} as an ACP server", path.display()))?;
    let deadline = Duration::from_secs(30);
    let result = {
        let (stdin, lines) = process.split_io()?;
        let exchange = async {
            write_json_line(
                stdin,
                &json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": 1,
                        "clientCapabilities": {
                            "fs": {"readTextFile": true, "writeTextFile": true},
                            "terminal": false
                        },
                        "clientInfo": {
                            "name": "rovai_probe",
                            "title": "Rovai-ai Runtime Probe",
                            "version": env!("CARGO_PKG_VERSION")
                        }
                    }
                }),
            )
            .await?;
            let initialize = read_rpc_result(lines, 1).await?;
            if initialize.get("protocolVersion").and_then(Value::as_u64) != Some(1) {
                bail!("Runtime did not negotiate ACP v1");
            }
            if !include_session {
                return Ok::<_, anyhow::Error>((initialize, None, false));
            }
            let auth_method = match kind {
                AdapterKind::CursorAgent => Some(("cursor_login", "Cursor")),
                AdapterKind::GrokBuild => Some((
                    select_grok_noninteractive_auth_method(&initialize, grok_byok_configured)?,
                    "Grok Build",
                )),
                _ => None,
            };
            let session_request_id = if let Some((method_id, runtime_name)) = auth_method {
                let advertised = initialize
                    .get("authMethods")
                    .and_then(Value::as_array)
                    .is_some_and(|methods| {
                        methods.iter().any(|method| {
                            method.get("id").and_then(Value::as_str) == Some(method_id)
                        })
                    });
                if !advertised {
                    bail!(
                        "{runtime_name} ACP did not advertise required authentication method {method_id}"
                    );
                }
                write_json_line(
                    stdin,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "authenticate",
                        "params": {"methodId": method_id, "_meta": {"headless": true}}
                    }),
                )
                .await?;
                timeout(Duration::from_secs(15), read_rpc_result(lines, 2))
                    .await
                    .with_context(|| {
                        format!("{runtime_name} authentication required or did not complete")
                    })??;
                3
            } else {
                2
            };
            let session_params = if kind == AdapterKind::GrokBuild {
                let attachment_root = probe_root.join("attachments");
                let run_tmp = probe_root.join("run-tmp");
                std::fs::create_dir_all(&attachment_root)?;
                std::fs::create_dir_all(&run_tmp)?;
                crate::acp::build_acp_new_session_params(
                    kind,
                    &probe_root.to_string_lossy(),
                    &[],
                    &[
                        attachment_root.to_string_lossy().into_owned(),
                        run_tmp.to_string_lossy().into_owned(),
                    ],
                    Some("Rovai Grok Deep Probe native rules marker"),
                )
            } else {
                json!({"cwd": probe_root, "mcpServers": []})
            };
            write_json_line(
                stdin,
                &json!({
                    "jsonrpc": "2.0",
                    "id": session_request_id,
                    "method": "session/new",
                    "params": session_params
                }),
            )
            .await?;
            let session = read_rpc_result(lines, session_request_id).await?;
            let session_id = session
                .get("sessionId")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .context("ACP session/new did not return sessionId")?;
            let mut next_request_id = session_request_id + 1;
            let mut grok_resume_verified = false;
            if kind == AdapterKind::GrokBuild
                && initialize
                    .pointer("/agentCapabilities/sessionCapabilities/resume")
                    .is_some_and(Value::is_object)
            {
                let resume_params = crate::acp::build_acp_resume_session_params(
                    kind,
                    session_id,
                    &probe_root.to_string_lossy(),
                    &[],
                    &[],
                );
                write_json_line(
                    stdin,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": next_request_id,
                        "method": "session/resume",
                        "params": resume_params
                    }),
                )
                .await?;
                let resume = read_rpc_result(lines, next_request_id)
                    .await
                    .context("Grok ACP session/resume capability check failed")?;
                if let Some(returned_session_id) = resume.get("sessionId").and_then(Value::as_str)
                    && returned_session_id != session_id
                {
                    bail!(
                        "Grok ACP session/resume capability check returned a different Session ID"
                    );
                }
                grok_resume_verified = true;
                next_request_id += 1;
            }
            if matches!(kind, AdapterKind::KiroCli | AdapterKind::GrokBuild) {
                let current_model = session
                    .pointer("/models/currentModelId")
                    .and_then(Value::as_str)
                    .or_else(|| {
                        session
                            .get("configOptions")
                            .and_then(Value::as_array)
                            .and_then(|options| {
                                options.iter().find(|option| {
                                    option.get("id").and_then(Value::as_str) == Some("model")
                                })
                            })
                            .and_then(|option| option.get("currentValue"))
                            .and_then(Value::as_str)
                    })
                    .context("ACP Session did not report its current model")?;
                write_json_line(
                    stdin,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": next_request_id,
                        "method": "session/set_model",
                        "params": {
                            "sessionId": session_id,
                            "modelId": current_model
                        }
                    }),
                )
                .await?;
                read_rpc_result(lines, next_request_id).await?;
            }
            Ok((initialize, Some(session), grok_resume_verified))
        };
        match timeout(deadline, exchange).await {
            Ok(result) => result,
            Err(_) => Err(anyhow::anyhow!("ACP probe timed out")),
        }
    };
    let stderr = match process.finish().await {
        Ok(stderr) => stderr,
        Err(cleanup_error) => {
            return match result {
                Ok(_) => Err(cleanup_error.context("ACP probe cleanup failed")),
                Err(error) => {
                    Err(error.context(format!("ACP probe cleanup failed: {cleanup_error:#}")))
                }
            };
        }
    };
    match result {
        Ok(result) => Ok(result),
        Err(error) if stderr.bytes.iter().any(|byte| !byte.is_ascii_whitespace()) => {
            let detail = String::from_utf8_lossy(&stderr.bytes);
            let bounded = detail.chars().take(4096).collect::<String>();
            let truncation = if stderr.truncated { " [truncated]" } else { "" };
            Err(error.context(format!("ACP stderr{truncation}: {bounded}")))
        }
        Err(error) => Err(error),
    }
}

pub(crate) fn select_grok_noninteractive_auth_method(
    initialize: &Value,
    prefer_api_key: bool,
) -> Result<&'static str> {
    const SUPPORTED: [&str; 2] = ["cached_token", "xai.api_key"];
    let advertised = initialize
        .get("authMethods")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|method| method.get("id").and_then(Value::as_str))
        .collect::<Vec<_>>();
    let default_method = initialize
        .pointer("/_meta/defaultAuthMethodId")
        .and_then(Value::as_str);
    if prefer_api_key && advertised.contains(&"xai.api_key") {
        return Ok("xai.api_key");
    }
    if let Some(default_method) = default_method
        && advertised.contains(&default_method)
        && let Some(method) = SUPPORTED.iter().find(|method| **method == default_method)
    {
        return Ok(*method);
    }
    for method in SUPPORTED {
        if advertised.contains(&method) {
            return Ok(method);
        }
    }
    let advertised = if advertised.is_empty() {
        "none".to_string()
    } else {
        advertised.join(", ")
    };
    bail!(
        "Grok Build ACP did not advertise a non-interactive authentication method \
         (expected cached_token or xai.api_key; advertised: {advertised}). \
         Run `grok login` or `grok login --device-auth` before retrying account authentication"
    )
}

pub(crate) async fn inspect_grok_native_mcp_server_names(
    executable: &Path,
    cwd: &Path,
) -> Result<BTreeSet<String>> {
    if !runtime_launch_allowed(
        AdapterKind::GrokBuild,
        RuntimeLaunchPurpose::DispatchPreflight,
    ) {
        bail!("runtime_launch_disallowed:dispatch_preflight");
    }
    let mut command = runtime_command(executable);
    command
        .args(["--no-auto-update", "inspect", "--json"])
        .current_dir(cwd);
    let output = bounded_output(&mut command, Duration::from_secs(15))
        .await
        .context("Grok native MCP inspection failed")?;
    if !output.status.success() {
        bail!(
            "Grok native MCP inspection exited unsuccessfully (status={})",
            output.status
        );
    }
    let document = serde_json::from_slice::<Value>(&output.stdout.bytes)
        .context("Grok native MCP inspection returned invalid JSON")?;
    grok_native_mcp_server_names_from_inspect(&document)
}

fn grok_native_mcp_server_names_from_inspect(document: &Value) -> Result<BTreeSet<String>> {
    // Reserve every discovered native name, including disabled or untrusted
    // project definitions. Grok resolves same-name precedence before applying
    // those gates, so such a definition can still shadow a process plugin and
    // must not leave a Rovai exposure falsely marked Ready.
    let servers = document
        .get("mcpServers")
        .context("Grok inspect JSON omitted mcpServers")?;
    let mut names = BTreeSet::new();
    match servers {
        Value::Array(servers) => {
            for server in servers {
                let name = server
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|name| !name.trim().is_empty())
                    .context("Grok inspect JSON contains an MCP server without a name")?;
                names.insert(name.to_string());
            }
        }
        Value::Object(servers) => {
            names.extend(
                servers
                    .keys()
                    .filter(|name| !name.trim().is_empty())
                    .cloned(),
            );
        }
        _ => bail!("Grok inspect JSON mcpServers has an unsupported shape"),
    }
    Ok(names)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TraePromptProbeMode {
    NoPermission,
    RejectPermission,
    AllowThenCancel,
}

#[derive(Debug, Default)]
struct TraePromptProbeObservation {
    assistant_text: String,
    saw_session_update: bool,
    tool_call_ids: BTreeSet<String>,
    terminal_tool_call_ids: BTreeSet<String>,
    permission_request_count: usize,
    cancel_sent: bool,
    stop_reason: String,
}

#[allow(dead_code)]
async fn run_trae_behavioral_probe(
    stdin: &mut ManagedChildStdin,
    lines: &mut BoundedLineReader<ManagedChildStdout>,
    session_id: &str,
    session: &Value,
    probe_root: &Path,
    native_append_marker: &str,
) -> Result<TraeBehavioralProbeEvidence> {
    let current_model = session
        .get("configOptions")
        .and_then(Value::as_array)
        .and_then(|options| {
            options
                .iter()
                .find(|option| option.get("id").and_then(Value::as_str) == Some("model"))
        })
        .and_then(|option| option.get("currentValue"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .context("TRAE behavioral capability missing: model config has no current value")?;
    write_json_line(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "session/set_config_option",
            "params": {
                "sessionId": session_id,
                "configId": "model",
                "type": "select",
                "value": current_model
            }
        }),
    )
    .await?;
    read_rpc_result(lines, 3).await?;

    let basic = run_trae_prompt_probe(
        stdin,
        lines,
        session_id,
        4,
        "Do not call tools or inspect files. What is the opaque Rovai Runtime marker defined in your system instructions? Reply with the marker only.",
        TraePromptProbeMode::NoPermission,
    )
    .await?;
    if basic.stop_reason != "end_turn" {
        bail!(
            "TRAE behavioral capability missing: ordinary prompt ended with {:?}",
            basic.stop_reason
        );
    }
    if !basic.assistant_text.contains(native_append_marker) {
        bail!(
            "TRAE behavioral capability missing: native appended system prompt was not observable"
        );
    }
    if !basic.saw_session_update {
        bail!("TRAE behavioral capability missing: ordinary prompt emitted no session/update");
    }

    let denied_path = probe_root.join("permission-denied.txt");
    let denied = run_trae_prompt_probe(
        stdin,
        lines,
        session_id,
        5,
        &format!(
            "Use the file editing tool exactly once to create {} with exactly DENIED_PROBE and a trailing newline. Do not use shell, read, list, or verification tools. After the tool result, reply exactly DENIED_PROBE_DONE.",
            denied_path.display()
        ),
        TraePromptProbeMode::RejectPermission,
    )
    .await?;
    if denied.stop_reason != "end_turn" {
        bail!(
            "TRAE behavioral capability missing: denied prompt ended with {:?}",
            denied.stop_reason
        );
    }
    if denied.permission_request_count == 0 {
        bail!("TRAE behavioral capability missing: risky tool emitted no permission request");
    }
    if denied.tool_call_ids.len() != 1 || denied.terminal_tool_call_ids != denied.tool_call_ids {
        bail!("TRAE behavioral capability missing: tool lifecycle did not retain one stable ID");
    }
    if denied_path.exists() {
        bail!("TRAE behavioral capability missing: rejected write produced a file");
    }

    let cancel_marker = probe_root.join("cancel-marker.txt");
    let cancelled = run_trae_prompt_probe(
        stdin,
        lines,
        session_id,
        6,
        &format!(
            "Use the Bash tool exactly once to run this command and do not use any other tool: sleep 20; printf CANCEL_PROBE > '{}'. Wait for the command before replying.",
            cancel_marker.display()
        ),
        TraePromptProbeMode::AllowThenCancel,
    )
    .await?;
    if !cancelled.cancel_sent || cancelled.stop_reason != "cancelled" {
        bail!(
            "TRAE behavioral capability missing: cancel did not produce a cancelled prompt terminal"
        );
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    if cancel_marker.exists() {
        bail!("TRAE behavioral capability missing: cancelled tool produced its delayed marker");
    }

    Ok(TraeBehavioralProbeEvidence {
        capabilities: [
            "session.prompt",
            "session.cancel",
            "session.update",
            "structured_permission_request",
            "session.set_config_option",
            "tool_call.stable_id",
            "stdout.json_rpc_only",
            "context.charter.native_append",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
    })
}

async fn run_trae_prompt_probe(
    stdin: &mut ManagedChildStdin,
    lines: &mut BoundedLineReader<ManagedChildStdout>,
    session_id: &str,
    request_id: u64,
    prompt: &str,
    mode: TraePromptProbeMode,
) -> Result<TraePromptProbeObservation> {
    write_json_line(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "session/prompt",
            "params": {
                "sessionId": session_id,
                "prompt": [{"type": "text", "text": prompt}]
            }
        }),
    )
    .await?;
    let mut observation = TraePromptProbeObservation::default();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let message: Value =
            serde_json::from_str(&line).with_context(|| format!("invalid RPC response: {line}"))?;
        let method = message.get("method").and_then(Value::as_str);
        if method.is_none() && message.get("id").and_then(Value::as_u64) == Some(request_id) {
            if let Some(error) = message.get("error") {
                bail!("TRAE behavioral prompt was rejected: {error}");
            }
            observation.stop_reason = message
                .pointer("/result/stopReason")
                .and_then(Value::as_str)
                .context("TRAE behavioral capability missing: prompt result has no stopReason")?
                .to_string();
            return Ok(observation);
        }
        match method {
            Some("session/update") => {
                observation.saw_session_update = true;
                let update = message
                    .pointer("/params/update")
                    .context("TRAE behavioral capability missing: session/update has no update")?;
                if update.get("sessionUpdate").and_then(Value::as_str)
                    == Some("agent_message_chunk")
                    && let Some(text) = update.pointer("/content/text").and_then(Value::as_str)
                {
                    observation.assistant_text.push_str(text);
                }
                if matches!(
                    update.get("sessionUpdate").and_then(Value::as_str),
                    Some("tool_call" | "tool_call_update")
                ) {
                    let tool_call_id = update
                        .get("toolCallId")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .context(
                            "TRAE behavioral capability missing: tool update has no stable toolCallId",
                        )?
                        .to_string();
                    observation.tool_call_ids.insert(tool_call_id.clone());
                    if matches!(
                        update.get("status").and_then(Value::as_str),
                        Some("completed" | "failed")
                    ) {
                        observation.terminal_tool_call_ids.insert(tool_call_id);
                    }
                }
            }
            Some("session/request_permission") => {
                if mode == TraePromptProbeMode::NoPermission {
                    bail!(
                        "TRAE behavioral capability missing: no-tool prompt requested permission"
                    );
                }
                let server_request_id = message
                    .get("id")
                    .cloned()
                    .context("TRAE behavioral capability missing: permission request has no id")?;
                let params = message.get("params").context(
                    "TRAE behavioral capability missing: permission request has no params",
                )?;
                validate_trae_permission_request(params, session_id, &mut observation)?;
                let result =
                    if mode == TraePromptProbeMode::AllowThenCancel && !observation.cancel_sent {
                        crate::acp::legacy_approval_result(params, true)?
                    } else {
                        crate::acp::rejection_result(params)?
                    };
                write_json_line(
                    stdin,
                    &json!({"jsonrpc": "2.0", "id": server_request_id, "result": result}),
                )
                .await?;
                observation.permission_request_count += 1;
                if mode == TraePromptProbeMode::AllowThenCancel && !observation.cancel_sent {
                    write_json_line(
                        stdin,
                        &json!({
                            "jsonrpc": "2.0",
                            "method": "session/cancel",
                            "params": {"sessionId": session_id}
                        }),
                    )
                    .await?;
                    observation.cancel_sent = true;
                }
            }
            Some(_) if message.get("id").is_some() => {
                let server_request_id = message.get("id").cloned().unwrap_or(Value::Null);
                write_json_line(
                    stdin,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": server_request_id,
                        "error": {"code": -32601, "message": "Unsupported during Rovai TRAE probe"}
                    }),
                )
                .await?;
            }
            _ => {}
        }
    }
    bail!("TRAE ACP server exited before behavioral prompt completed")
}

fn validate_trae_permission_request(
    params: &Value,
    expected_session_id: &str,
    observation: &mut TraePromptProbeObservation,
) -> Result<()> {
    if params.get("sessionId").and_then(Value::as_str) != Some(expected_session_id) {
        bail!("TRAE behavioral capability missing: permission request crossed Session identity");
    }
    let tool_call_id = params
        .pointer("/toolCall/toolCallId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .context("TRAE behavioral capability missing: permission request has no stable toolCallId")?
        .to_string();
    observation.tool_call_ids.insert(tool_call_id);
    let options = params
        .get("options")
        .and_then(Value::as_array)
        .filter(|options| !options.is_empty())
        .context("TRAE behavioral capability missing: permission request has no options")?;
    let mut option_ids = BTreeSet::new();
    for option in options {
        let option_id = option
            .get("optionId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .context(
                "TRAE behavioral capability missing: permission option has no stable optionId",
            )?;
        if !option_ids.insert(option_id) {
            bail!("TRAE behavioral capability missing: permission option IDs are not unique");
        }
    }
    Ok(())
}

pub fn configure_acp_command(command: &mut Command, kind: AdapterKind, allow_all: bool) {
    match kind {
        AdapterKind::OpencodeCli => {
            command.args(["acp", "--pure", "--log-level", "ERROR"]);
        }
        AdapterKind::CopilotCli => {
            command.args([
                "--acp",
                "--stdio",
                "--no-auto-update",
                "--no-remote",
                "--no-remote-export",
                "--no-color",
                "--log-level",
                "error",
            ]);
            if allow_all {
                command.arg("--allow-all");
            }
        }
        AdapterKind::KiroCli => {
            command.args(["acp", "--agent", KIRO_ADDITIVE_AGENT_NAME]);
            if allow_all {
                command.arg("--trust-all-tools");
            }
        }
        AdapterKind::QoderCli | AdapterKind::CodebuddyCli => {
            command.arg("--acp");
        }
        AdapterKind::QwenCode => {
            command.arg("--acp");
        }
        AdapterKind::TraeCnCli => {
            command.args(["acp", "serve"]);
        }
        AdapterKind::CursorAgent => {
            command.arg("acp");
        }
        AdapterKind::KimiCodeCli => {
            command.arg("acp");
        }
        AdapterKind::GrokBuild => {
            configure_grok_acp_command(command, None);
        }
        AdapterKind::CodexCli | AdapterKind::ClaudeCodeCli | AdapterKind::AntigravityApp => {}
    }
}

pub(crate) fn configure_grok_acp_command(command: &mut Command, plugin_dir: Option<&Path>) {
    command.args(["--no-auto-update", "agent", "--no-leader"]);
    if let Some(plugin_dir) = plugin_dir {
        command.arg("--plugin-dir").arg(plugin_dir);
    }
    command.arg("stdio");
}

fn acp_observed_capabilities(
    kind: AdapterKind,
    reported_version: Option<&str>,
    executable_fingerprint: Option<&str>,
    initialize: &Value,
    session: Option<&Value>,
    grok_resume_verified: bool,
) -> Vec<String> {
    let mut capabilities = if kind == AdapterKind::TraeCnCli {
        session.map_or_else(Vec::new, |session| {
            trae_machine_ready_capabilities(
                reported_version,
                executable_fingerprint,
                initialize,
                session,
            )
        })
    } else {
        vec!["acp.initialize".to_string()]
    };
    if kind == AdapterKind::CursorAgent && session.is_some() {
        capabilities.push("cursor.authenticate".to_string());
        capabilities.push("session.new".to_string());
    }
    if kind == AdapterKind::GrokBuild && session.is_some() {
        capabilities.push("grok.authenticate".to_string());
    }
    if !matches!(kind, AdapterKind::KimiCodeCli | AdapterKind::GrokBuild)
        && initialize
            .pointer("/agentCapabilities/loadSession")
            .and_then(Value::as_bool)
            == Some(true)
    {
        capabilities.push("session.load".to_string());
    }
    if kind != AdapterKind::KimiCodeCli
        && initialize
            .pointer("/agentCapabilities/sessionCapabilities/resume")
            .is_some_and(Value::is_object)
        && (kind != AdapterKind::GrokBuild || grok_resume_verified)
    {
        capabilities.push("session.resume".to_string());
    }
    if session.is_some() && !matches!(kind, AdapterKind::TraeCnCli | AdapterKind::CursorAgent) {
        capabilities.push("session.new".to_string());
        capabilities.extend(
            [
                "session.prompt",
                "session.cancel",
                "session.update",
                "structured_permission_request",
                "workspace.additional_roots",
            ]
            .into_iter()
            .map(str::to_string),
        );
        capabilities.push(
            if matches!(kind, AdapterKind::KiroCli | AdapterKind::GrokBuild) {
                "session.set_model"
            } else {
                "session.set_config_option"
            }
            .to_string(),
        );
    }
    capabilities
}

fn acp_required_capabilities(kind: AdapterKind) -> Vec<String> {
    if kind == AdapterKind::TraeCnCli {
        return trae_machine_ready_requirements();
    }
    if kind == AdapterKind::CursorAgent {
        return ["acp.initialize", "cursor.authenticate", "session.new"]
            .into_iter()
            .map(str::to_string)
            .collect();
    }
    if kind == AdapterKind::KimiCodeCli {
        return [
            "acp.initialize",
            "session.new",
            "session.prompt",
            "session.cancel",
            "session.update",
            "structured_permission_request",
            "workspace.additional_roots",
            "session.set_config_option",
        ]
        .into_iter()
        .map(str::to_string)
        .collect();
    }
    if kind == AdapterKind::GrokBuild {
        return [
            "acp.initialize",
            "grok.authenticate",
            "session.new",
            "session.prompt",
            "session.cancel",
            "session.update",
            "structured_permission_request",
            "workspace.additional_roots",
            "session.set_model",
            "session.resume",
            "mcp.additive_per_run",
        ]
        .into_iter()
        .map(str::to_string)
        .collect();
    }
    let mut capabilities = [
        "acp.initialize",
        "session.new",
        "session.prompt",
        "session.cancel",
        "session.update",
        "structured_permission_request",
        "workspace.additional_roots",
        "mcp.additive_per_run",
    ]
    .into_iter()
    .map(str::to_string)
    .collect::<Vec<_>>();
    capabilities.push(
        if matches!(kind, AdapterKind::KiroCli | AdapterKind::GrokBuild) {
            "session.set_model"
        } else {
            "session.set_config_option"
        }
        .to_string(),
    );
    capabilities
}

fn acp_deep_session_probe_enabled(kind: AdapterKind) -> bool {
    kind.uses_acp()
}

fn additive_acp_mcp_verified(kind: AdapterKind) -> bool {
    matches!(
        kind,
        AdapterKind::OpencodeCli
            | AdapterKind::CopilotCli
            | AdapterKind::KiroCli
            | AdapterKind::QoderCli
            | AdapterKind::CodebuddyCli
            | AdapterKind::QwenCode
            | AdapterKind::TraeCnCli
            | AdapterKind::GrokBuild
    )
}

fn classify_acp_probe_failure(detail: &str) -> AgentRuntimeProbeStatus {
    let lower = detail.to_ascii_lowercase();
    if [
        "login",
        "log in",
        "auth",
        "credential",
        "unauthorized",
        "not signed in",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return AgentRuntimeProbeStatus::AuthenticationRequired;
    }
    if [
        "trae behavioral capability missing",
        "did not negotiate acp v1",
        "session/new did not return sessionid",
        "grok acp session/resume capability check",
        "invalid rpc response",
        "rpc result was missing",
        "method not found",
        "unsupported protocol",
        "enterprise policy denied",
        "policy restriction",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return AgentRuntimeProbeStatus::MissingCapabilities;
    }
    AgentRuntimeProbeStatus::ProbeFailed
}

pub async fn codex_model_catalog(path: &Path) -> Result<Value> {
    let mut command = runtime_command(path);
    command.args(["app-server", "--listen", "stdio://"]);
    let mut process = RuntimeProbeProcess::spawn(
        &mut command,
        ACP_STDOUT_LIMIT,
        DEFAULT_CAPTURE_LIMIT,
        DEFAULT_LINE_LIMIT,
        DEFAULT_CLEANUP_TIMEOUT,
    )
    .with_context(|| format!("failed to start {} app-server", path.display()))?;
    let result = {
        let (stdin, lines) = process.split_io()?;
        let query = async {
            write_json_line(
                stdin,
                &json!({
                    "method": "initialize",
                    "id": 1,
                    "params": {
                        "clientInfo": {
                            "name": "rovai_probe",
                            "title": "Rovai-ai Runtime Probe",
                            "version": env!("CARGO_PKG_VERSION")
                        }
                    }
                }),
            )
            .await?;
            read_rpc_result(lines, 1).await?;
            write_json_line(stdin, &json!({"method": "initialized", "params": {}})).await?;

            let mut models = Vec::new();
            let mut cursor: Option<String> = None;
            let mut request_id = 2_u64;
            loop {
                write_json_line(
                    stdin,
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
                let result = read_rpc_result(lines, request_id).await?;
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
        timeout(Duration::from_secs(30), query)
            .await
            .context("model/list timed out")?
    };
    let stderr = process.finish().await?;
    match result {
        Ok(value) => Ok(value),
        Err(error) if stderr.bytes.iter().any(|byte| !byte.is_ascii_whitespace()) => {
            Err(error.context(format!("app-server stderr: {}", stderr.lossy_text())))
        }
        Err(error) => Err(error),
    }
}

async fn write_json_line(stdin: &mut ManagedChildStdin, value: &Value) -> Result<()> {
    stdin
        .write_all(serde_json::to_string(value)?.as_bytes())
        .await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}

async fn read_rpc_result(
    lines: &mut BoundedLineReader<ManagedChildStdout>,
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

async fn executable_fingerprint_async(path: PathBuf) -> Option<String> {
    tokio::task::spawn_blocking(move || executable_fingerprint(&path))
        .await
        .ok()
        .and_then(Result::ok)
}

async fn codex_runtime_probe_uncached(
    path: PathBuf,
    path_text: String,
    fingerprint: Option<String>,
    probed_at: String,
) -> AgentRuntimeProbeResult {
    let mut version_command = runtime_command(&path);
    version_command.arg("--version");
    let version_output = match bounded_output(&mut version_command, Duration::from_secs(15)).await {
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
                    &output.stdout.bytes,
                    &output.stderr.bytes,
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
        String::from_utf8_lossy(&version_output.stdout.bytes)
            .trim()
            .to_string(),
    );

    let mut auth_command = runtime_command(&path);
    auth_command.args(["login", "status"]);
    match bounded_output(&mut auth_command, Duration::from_secs(15)).await {
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
                    &output.stdout.bytes,
                    &output.stderr.bytes,
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
    let mut command = runtime_command(path);
    command.args(["app-server", "--listen", "stdio://"]);
    let mut process = RuntimeProbeProcess::spawn(
        &mut command,
        ACP_STDOUT_LIMIT,
        DEFAULT_CAPTURE_LIMIT,
        DEFAULT_LINE_LIMIT,
        DEFAULT_CLEANUP_TIMEOUT,
    )
    .with_context(|| format!("failed to start {} app-server", path.display()))?;
    let result = {
        let (stdin, lines) = process.split_io()?;
        let handshake = async {
            let initialize = json!({
                "method": "initialize",
                "id": 1,
                "params": {
                    "clientInfo": {
                        "name": "rovai_probe",
                        "title": "Rovai-ai Runtime Probe",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "capabilities": {
                        "experimentalApi": true
                    }
                }
            });
            stdin
                .write_all(serde_json::to_string(&initialize)?.as_bytes())
                .await?;
            stdin.write_all(b"\n").await?;
            stdin.flush().await?;

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
        timeout(Duration::from_secs(15), handshake)
            .await
            .context("initialize timed out")?
    };
    let stderr = process.finish().await?;
    match result {
        Ok(()) => Ok(()),
        Err(error) if stderr.bytes.iter().any(|byte| !byte.is_ascii_whitespace()) => {
            Err(error.context(format!("app-server stderr: {}", stderr.lossy_text())))
        }
        Err(error) => Err(error),
    }
}

async fn probe_schema_capabilities(path: &Path) -> Result<(Vec<String>, Vec<String>)> {
    let schema_dir =
        env::temp_dir().join(format!("rovai-codex-schema-probe-{}", uuid::Uuid::new_v4()));
    let mut command = runtime_command(path);
    command
        .args(["app-server", "generate-json-schema", "--out"])
        .arg(&schema_dir);
    let output = bounded_output(&mut command, Duration::from_secs(20)).await?;
    if !output.status.success() {
        let detail = command_detail(
            &output.stdout.bytes,
            &output.stderr.bytes,
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
        failure: None,
        probed_at,
    }
}

#[allow(clippy::too_many_arguments)]
fn agent_probe_result(
    runtime_kind: &str,
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
        runtime_kind: runtime_kind.to_string(),
        executable_path,
        reported_version,
        executable_fingerprint,
        status,
        capabilities,
        missing_capabilities,
        detail,
        failure: None,
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
    let Some(executable) = path.or_else(|| resolve_command_path(command)) else {
        return CommandHealth {
            installed: false,
            version: None,
            authenticated: None,
            detail: Some(format!("command is unavailable: {command}")),
            path: None,
        };
    };
    let mut command = runtime_command(&executable);
    command.args(args);
    match bounded_output(&mut command, Duration::from_secs(15)).await {
        Ok(output) if output.status.success() => CommandHealth {
            installed: true,
            version: Some(
                String::from_utf8_lossy(&output.stdout.bytes)
                    .trim()
                    .to_string(),
            ),
            authenticated: None,
            detail: None,
            path: Some(executable.to_string_lossy().to_string()),
        },
        Ok(output) => CommandHealth {
            installed: false,
            version: None,
            authenticated: None,
            detail: Some(command_detail(
                &output.stdout.bytes,
                &output.stderr.bytes,
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

fn resolve_command_path(command: &str) -> Option<PathBuf> {
    let command_path = PathBuf::from(command);
    if command_path.is_absolute() {
        return is_executable_file(&command_path)
            .then(|| command_path.canonicalize().unwrap_or(command_path));
    }
    let path = env::var_os("PATH")?;
    for directory in env::split_paths(&path) {
        for name in command_candidate_names(command) {
            let candidate = directory.join(name);
            if is_executable_file(&candidate) {
                return Some(candidate.canonicalize().unwrap_or(candidate));
            }
        }
    }
    None
}

#[cfg(windows)]
fn command_candidate_names(command: &str) -> Vec<OsString> {
    let command = OsString::from(command);
    if Path::new(&command).extension().is_some() {
        vec![command]
    } else {
        let mut executable = command;
        executable.push(".exe");
        vec![executable]
    }
}

#[cfg(not(windows))]
fn command_candidate_names(command: &str) -> Vec<OsString> {
    vec![OsString::from(command)]
}

#[cfg(test)]
pub fn find_codex() -> Option<PathBuf> {
    for environment_key in [
        "ROVAI_CODEX_BIN",
        "HORIZONWARD_CODEX_BIN",
        "LUMEN_CODEX_BIN",
    ] {
        if let Some(path) = env::var_os(environment_key).map(PathBuf::from)
            && path.is_file()
        {
            return Some(path);
        }
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
pub fn find_adapter(kind: AdapterKind) -> Option<PathBuf> {
    if kind == AdapterKind::CodexCli {
        return find_codex();
    }
    let (environment_keys, executable_name) = match kind {
        AdapterKind::OpencodeCli => (
            &[
                "ROVAI_OPENCODE_BIN",
                "HORIZONWARD_OPENCODE_BIN",
                "LUMEN_OPENCODE_BIN",
            ][..],
            "opencode",
        ),
        AdapterKind::CopilotCli => (
            &[
                "ROVAI_COPILOT_BIN",
                "HORIZONWARD_COPILOT_BIN",
                "LUMEN_COPILOT_BIN",
            ][..],
            "copilot",
        ),
        AdapterKind::ClaudeCodeCli => (
            &[
                "ROVAI_CLAUDE_CODE_BIN",
                "HORIZONWARD_CLAUDE_CODE_BIN",
                "LUMEN_CLAUDE_CODE_BIN",
            ][..],
            "claude",
        ),
        AdapterKind::KiroCli => (
            &["ROVAI_KIRO_BIN", "HORIZONWARD_KIRO_BIN", "LUMEN_KIRO_BIN"][..],
            "kiro-cli",
        ),
        AdapterKind::QoderCli => (
            &[
                "ROVAI_QODER_BIN",
                "HORIZONWARD_QODER_BIN",
                "LUMEN_QODER_BIN",
            ][..],
            "qodercli",
        ),
        AdapterKind::CodebuddyCli => (
            &[
                "ROVAI_CODEBUDDY_BIN",
                "HORIZONWARD_CODEBUDDY_BIN",
                "LUMEN_CODEBUDDY_BIN",
            ][..],
            "codebuddy",
        ),
        AdapterKind::QwenCode => (
            &["ROVAI_QWEN_BIN", "HORIZONWARD_QWEN_BIN", "LUMEN_QWEN_BIN"][..],
            "qwen",
        ),
        AdapterKind::TraeCnCli => (
            &[
                "ROVAI_TRAE_CN_BIN",
                "ROVAI_TRAE_BIN",
                "HORIZONWARD_TRAE_BIN",
                "LUMEN_TRAE_BIN",
            ][..],
            "traecli",
        ),
        AdapterKind::CursorAgent => (&["ROVAI_CURSOR_BIN"][..], "cursor-agent"),
        AdapterKind::KimiCodeCli => (&["ROVAI_KIMI_BIN"][..], "kimi"),
        AdapterKind::GrokBuild => (&["ROVAI_GROK_BIN"][..], "grok"),
        AdapterKind::AntigravityApp => (
            &[
                "ROVAI_ANTIGRAVITY_BIN",
                "ROVAI_AGY_BIN",
                "HORIZONWARD_ANTIGRAVITY_BIN",
                "HORIZONWARD_AGY_BIN",
                "LUMEN_ANTIGRAVITY_BIN",
                "LUMEN_AGY_BIN",
            ][..],
            "agy",
        ),
        AdapterKind::CodexCli => unreachable!(),
    };
    for environment_key in environment_keys {
        if let Some(path) = env::var_os(environment_key).map(PathBuf::from)
            && path.is_file()
        {
            return Some(path);
        }
    }
    if let Some(paths) = env::var_os("PATH") {
        for directory in env::split_paths(&paths) {
            let candidate = directory.join(executable_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin").join(executable_name),
        PathBuf::from("/usr/local/bin").join(executable_name),
    ];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin").join(executable_name));
        candidates.push(home.join(".npm-global/bin").join(executable_name));
    }
    candidates.into_iter().find(|path| path.is_file())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use rovai_core::agent_runtime_adapter::{AcpProbeObservation, AgentRuntimeAdapterRegistry};
    use std::{fs, os::unix::fs::PermissionsExt, time::Instant};

    #[tokio::test]
    async fn git_health_uses_only_a_resolved_absolute_executable() {
        let directory = env::temp_dir().join(format!("rovai-git-health-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let executable = directory.join("git");
        fs::write(&executable, "#!/bin/sh\nprintf 'git version fixture\\n'\n").unwrap();
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&executable, permissions).unwrap();

        let available = git_health(Some(executable.canonicalize().unwrap())).await;
        assert!(available.installed);
        assert_eq!(available.version.as_deref(), Some("git version fixture"));
        assert!(
            available
                .path
                .as_deref()
                .is_some_and(|path| path.starts_with('/'))
        );

        let missing = git_health(None).await;
        assert!(!missing.installed);
        assert_eq!(
            missing.detail.as_deref(),
            Some("git executable was not found in the Runtime search environment")
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn antigravity_stream_json_is_optional_and_help_gated() {
        assert!(antigravity_stream_json_supported(
            "--output-format Output format (text, json, stream-json)"
        ));
        assert!(!antigravity_stream_json_supported(
            "--output-format Output format (text, json)"
        ));
        assert!(!antigravity_stream_json_supported(
            "legacy print mode without structured output"
        ));
        assert!(
            !antigravity_required_capabilities()
                .iter()
                .any(|capability| capability == "output.stream_json")
        );
    }

    #[test]
    fn additive_acp_launch_shapes_match_the_verified_cli_contracts() {
        let arguments = |kind| {
            let mut command = Command::new("/usr/bin/true");
            configure_acp_command(&mut command, kind, false);
            command
                .as_std()
                .get_args()
                .map(|value| value.to_string_lossy().to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(arguments(AdapterKind::QoderCli), ["--acp"]);
        assert_eq!(arguments(AdapterKind::CodebuddyCli), ["--acp"]);
        assert_eq!(arguments(AdapterKind::QwenCode), ["--acp"]);
        assert_eq!(arguments(AdapterKind::TraeCnCli), ["acp", "serve"]);
        assert_eq!(arguments(AdapterKind::CursorAgent), ["acp"]);
        assert_eq!(arguments(AdapterKind::KimiCodeCli), ["acp"]);
        assert_eq!(
            arguments(AdapterKind::GrokBuild),
            ["--no-auto-update", "agent", "--no-leader", "stdio"]
        );
        assert_eq!(
            arguments(AdapterKind::KiroCli),
            ["acp", "--agent", KIRO_ADDITIVE_AGENT_NAME]
        );
        let mut trusted_kiro = Command::new("/usr/bin/true");
        configure_acp_command(&mut trusted_kiro, AdapterKind::KiroCli, true);
        assert_eq!(
            trusted_kiro
                .as_std()
                .get_args()
                .map(|value| value.to_string_lossy().to_string())
                .collect::<Vec<_>>(),
            [
                "acp",
                "--agent",
                KIRO_ADDITIVE_AGENT_NAME,
                "--trust-all-tools"
            ]
        );
    }

    #[test]
    fn locally_verified_acp_adapters_claim_additive_mcp() {
        for kind in [
            AdapterKind::OpencodeCli,
            AdapterKind::CopilotCli,
            AdapterKind::KiroCli,
            AdapterKind::QoderCli,
            AdapterKind::CodebuddyCli,
            AdapterKind::QwenCode,
            AdapterKind::TraeCnCli,
            AdapterKind::GrokBuild,
        ] {
            assert!(additive_acp_mcp_verified(kind));
        }
    }

    #[test]
    fn acp_probe_failure_classification_separates_auth_protocol_and_transient_errors() {
        for detail in [
            "ACP probe failed: authentication required",
            "ACP probe failed: not signed in",
            "ACP probe failed: invalid credential",
        ] {
            assert_eq!(
                classify_acp_probe_failure(detail),
                AgentRuntimeProbeStatus::AuthenticationRequired
            );
        }
        for detail in [
            "Runtime did not negotiate ACP v1",
            "ACP session/new did not return sessionId",
            "invalid RPC response: diagnostic text",
        ] {
            assert_eq!(
                classify_acp_probe_failure(detail),
                AgentRuntimeProbeStatus::MissingCapabilities
            );
        }
        assert_eq!(
            classify_acp_probe_failure("ACP probe timed out"),
            AgentRuntimeProbeStatus::ProbeFailed
        );
    }

    #[test]
    fn antigravity_model_discovery_accepts_identifier_and_display_name_rows() {
        assert_eq!(
            antigravity_model_identifier_from_line(
                "gemini-3.6-flash-high\tGemini 3.6 Flash (High)"
            )
            .as_deref(),
            Some("gemini-3.6-flash-high")
        );
        assert_eq!(
            antigravity_model_identifier_from_line("claude-sonnet-4-6").as_deref(),
            Some("claude-sonnet-4-6")
        );
        assert!(antigravity_model_identifier_from_line("Fetching available models...").is_none());
    }

    #[test]
    fn public_probe_failures_classify_auth_and_cli_incompatibility_without_paths() {
        let executable = Path::new("/Users/example/private/bin/agy");
        let incompatible = public_probe_failure(
            AdapterKind::AntigravityApp,
            RuntimeFailureOrigin::Runtime,
            RuntimeFailurePhase::ModelCatalog,
            "runtime_process_failed",
            "Antigravity 模型检查失败",
            "unknown command models at /Users/example/private/bin/agy",
            executable,
            true,
        );
        assert_eq!(incompatible.origin, RuntimeFailureOrigin::Compatibility);
        assert_eq!(incompatible.code, "runtime_capability_incompatible");
        assert_eq!(
            public_probe_status(AgentRuntimeProbeStatus::ProbeFailed, &incompatible),
            AgentRuntimeProbeStatus::MissingCapabilities
        );
        assert_eq!(
            incompatible.detail.as_deref(),
            Some("unknown command models at <runtime-executable>")
        );

        let authentication = public_probe_failure(
            AdapterKind::ClaudeCodeCli,
            RuntimeFailureOrigin::Runtime,
            RuntimeFailurePhase::Authentication,
            "runtime_process_failed",
            "Claude Code 认证检查失败",
            "authentication required: token expired",
            Path::new("/usr/local/bin/claude"),
            true,
        );
        assert_eq!(authentication.code, "runtime_authentication_required");
        assert_eq!(authentication.phase, RuntimeFailurePhase::Authentication);
        assert_eq!(
            public_probe_status(AgentRuntimeProbeStatus::ProbeFailed, &authentication),
            AgentRuntimeProbeStatus::AuthenticationRequired
        );
    }

    #[tokio::test]
    #[ignore = "manual local Runtime smoke"]
    async fn kiro_private_agent_session_real_runtime_smoke() {
        let path = find_adapter(AdapterKind::KiroCli).expect("Kiro CLI must be installed");
        let probe = acp_probe_at(
            &path,
            AdapterKind::KiroCli,
            true,
            RuntimeLaunchPurpose::HealthProbe,
        )
        .await;
        assert_eq!(
            probe.result.status,
            AgentRuntimeProbeStatus::Ready,
            "{:?}",
            probe.result.detail
        );
        assert!(
            probe
                .result
                .capabilities
                .contains(&"mcp.additive_per_run".to_string())
        );
        assert!(
            probe
                .session_result
                .as_ref()
                .and_then(|session| session.get("sessionId"))
                .and_then(Value::as_str)
                .is_some()
        );
        let snapshot = AgentRuntimeAdapterRegistry::default()
            .acp_capability_snapshot(AcpProbeObservation {
                adapter_kind: AdapterKind::KiroCli,
                reported_version: probe.result.reported_version.clone(),
                executable_fingerprint: probe.result.executable_fingerprint.clone(),
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                capabilities: probe.result.capabilities.clone(),
                initialize_result: probe.initialize_result.clone(),
                session_result: probe.session_result.clone(),
                attempted_at: chrono::Utc::now().to_rfc3339(),
                last_error: None,
            })
            .expect("Kiro Session should produce a freezeable capability snapshot");
        assert!(!snapshot.models.is_empty());
    }

    #[tokio::test]
    #[ignore = "manual local Runtime smoke"]
    async fn trae_user_authorized_availability_check_real_runtime_smoke() {
        let path = find_adapter(AdapterKind::TraeCnCli).expect("TRAE CLI must be installed");
        let probe = acp_capability_probe_at_for_purpose(
            &path,
            AdapterKind::TraeCnCli,
            RuntimeLaunchPurpose::AvailabilityCheck,
        )
        .await;
        assert_eq!(
            probe.result.status,
            AgentRuntimeProbeStatus::Ready,
            "{:?}",
            probe.result.detail
        );
        assert!(probe.initialize_result.is_some());
        assert!(probe.session_result.is_some());
        let snapshot = AgentRuntimeAdapterRegistry::default()
            .acp_capability_snapshot(AcpProbeObservation {
                adapter_kind: AdapterKind::TraeCnCli,
                reported_version: probe.result.reported_version,
                executable_fingerprint: probe.result.executable_fingerprint,
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                capabilities: probe.result.capabilities,
                initialize_result: probe.initialize_result,
                session_result: probe.session_result,
                attempted_at: chrono::Utc::now().to_rfc3339(),
                last_error: None,
            })
            .expect("TRAE availability evidence should map to a Ready snapshot");
        assert_eq!(snapshot.probe_status, "ready");
        assert!(!snapshot.models.is_empty());
        assert!(!snapshot.permission_options.is_empty());
    }

    #[tokio::test]
    async fn trae_health_probe_uses_the_uniform_runtime_launch_lifecycle() {
        let directory =
            env::temp_dir().join(format!("rovai-trae-health-guard-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let marker = directory.join("executed");
        let runtime = directory.join("traecli");
        std::fs::write(
            &runtime,
            format!("#!/bin/sh\nprintf ran > '{}'\n", marker.display()),
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&runtime).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&runtime, permissions).unwrap();

        let probe = acp_capability_probe_at_for_purpose(
            &runtime,
            AdapterKind::TraeCnCli,
            RuntimeLaunchPurpose::HealthProbe,
        )
        .await;
        assert_eq!(probe.result.status, AgentRuntimeProbeStatus::ProbeFailed);
        assert!(
            probe
                .result
                .detail
                .as_deref()
                .is_some_and(|detail| !detail.contains("runtime_launch_disallowed"))
        );
        assert!(
            marker.exists(),
            "health probe must execute TRAE like every Runtime"
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn trae_availability_and_dispatch_share_one_machine_ready_contract() {
        let directory = env::temp_dir().join(format!(
            "rovai-trae-ready-contract-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let protocol_log = directory.join("protocol.jsonl");
        let runtime = directory.join("traecli");
        std::fs::write(
            &runtime,
            format!(
                r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\n' 'trae-cli version 0.120.52'
  exit 0
fi
IFS= read -r initialize || exit 1
printf '%s\n' "$initialize" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{"loadSession":true}}}}}}'
IFS= read -r session || exit 1
printf '%s\n' "$session" >> '{}'
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{"sessionId":"session-ready-contract","configOptions":[{{"id":"model","currentValue":"GLM-5.2","options":[{{"value":"GLM-5.2","name":"GLM-5.2"}}]}}],"modes":{{"currentModeId":"default","availableModes":[{{"id":"default","name":"Default"}},{{"id":"bypass_permissions","name":"Bypass permissions"}}]}}}}}}'
if IFS= read -r unexpected; then
  printf '%s\n' "$unexpected" >> '{}'
  printf '%s\n' '{{"jsonrpc":"2.0","id":3,"error":{{"code":-32601,"message":"machine Ready probe sent a behavioral request"}}}}'
fi
while IFS= read -r ignored; do :; done
"#,
                protocol_log.display(),
                protocol_log.display(),
                protocol_log.display()
            ),
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&runtime).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&runtime, permissions).unwrap();

        let availability = acp_capability_probe_at_for_purpose(
            &runtime,
            AdapterKind::TraeCnCli,
            RuntimeLaunchPurpose::AvailabilityCheck,
        )
        .await;
        let dispatch = acp_capability_probe_at_for_purpose(
            &runtime,
            AdapterKind::TraeCnCli,
            RuntimeLaunchPurpose::DispatchPreflight,
        )
        .await;

        assert_eq!(availability.result.status, AgentRuntimeProbeStatus::Ready);
        assert_eq!(dispatch.result.status, AgentRuntimeProbeStatus::Ready);
        assert_eq!(
            availability.result.capabilities,
            dispatch.result.capabilities
        );
        let protocol = std::fs::read_to_string(&protocol_log).unwrap();
        assert_eq!(protocol.matches("\"method\":\"initialize\"").count(), 2);
        assert_eq!(protocol.matches("\"method\":\"session/new\"").count(), 2);
        assert!(!protocol.contains("\"method\":\"session/prompt\""));
        assert!(!protocol.contains("\"method\":\"session/cancel\""));
        assert!(!protocol.contains("\"method\":\"session/set_config_option\""));

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn acp_probe_terminates_descendants_that_keep_stdio_open() {
        let directory =
            env::temp_dir().join(format!("rovai-acp-process-group-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let descendant_pid_path = directory.join("descendant.pid");
        let runtime = directory.join("qwen");
        std::fs::write(
            &runtime,
            format!(
                r#"#!/bin/sh
sleep 10 &
printf '%s' "$!" > '{}'
IFS= read -r _request
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1}}}}'
exit 0
"#,
                descendant_pid_path.display()
            ),
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&runtime).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&runtime, permissions).unwrap();

        let started = Instant::now();
        let (initialize, session, grok_resume_verified) = timeout(
            Duration::from_secs(3),
            run_acp_probe(
                &runtime,
                AdapterKind::QwenCode,
                false,
                RuntimeLaunchPurpose::HealthProbe,
            ),
        )
        .await
        .expect("probe cleanup must remain bounded")
        .expect("the fixture must complete the ACP initialize handshake");
        assert_eq!(initialize["protocolVersion"], 1);
        assert!(session.is_none());
        assert!(!grok_resume_verified);
        assert!(started.elapsed() < Duration::from_secs(3));

        let descendant_pid = std::fs::read_to_string(&descendant_pid_path)
            .unwrap()
            .parse::<i32>()
            .unwrap();
        let descendant_gone = timeout(Duration::from_secs(2), async {
            loop {
                // SAFETY: signal 0 only checks the exact PID written by this test fixture.
                if unsafe { libc::kill(descendant_pid, 0) } == -1
                    && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
                {
                    break true;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap_or(false);
        if !descendant_gone {
            // SAFETY: cleanup is limited to the exact PID created by the fixture.
            unsafe {
                libc::kill(descendant_pid, libc::SIGKILL);
            }
        }
        assert!(
            descendant_gone,
            "the inherited ACP descendant must be reaped"
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn grok_deep_probe_rejects_pre_1_0_without_starting_acp() {
        let directory = env::temp_dir().join(format!(
            "rovai-grok-minimum-version-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let marker = directory.join("acp-started");
        let runtime = directory.join("grok");
        std::fs::write(
            &runtime,
            format!(
                r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\n' 'grok 0.2.118'
  exit 0
fi
touch '{}'
exit 1
"#,
                marker.display()
            ),
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&runtime).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&runtime, permissions).unwrap();

        let probe = acp_capability_probe_at_for_purpose(
            &runtime,
            AdapterKind::GrokBuild,
            RuntimeLaunchPurpose::HealthProbe,
        )
        .await;
        assert_eq!(
            probe.result.status,
            AgentRuntimeProbeStatus::MissingCapabilities
        );
        assert_eq!(
            probe.result.missing_capabilities,
            vec!["runtime.version>=1.0.0".to_string()]
        );
        assert!(!marker.exists());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn grok_deep_probe_requires_advertised_acp_resume() {
        let directory = env::temp_dir().join(format!(
            "rovai-grok-resume-capability-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let runtime = directory.join("grok");
        std::fs::write(
            &runtime,
            r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\n' 'grok 1.0.0'
  exit 0
fi
IFS= read -r initialize || exit 1
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true},"authMethods":[{"id":"cached_token"},{"id":"xai.api_key"}],"_meta":{"defaultAuthMethodId":"cached_token"}}}'
IFS= read -r authenticate || exit 1
printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{}}'
IFS= read -r session || exit 1
printf '%s\n' '{"jsonrpc":"2.0","id":3,"result":{"sessionId":"grok-session","models":{"currentModelId":"minimax-m3","availableModels":[{"modelId":"minimax-m3","name":"MiniMax M3"}]}}}'
IFS= read -r set_model || exit 1
printf '%s\n' '{"jsonrpc":"2.0","id":4,"result":null}'
while IFS= read -r ignored; do :; done
"#,
        )
        .unwrap();
        let mut permissions = std::fs::metadata(&runtime).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&runtime, permissions).unwrap();

        let probe = acp_capability_probe_at_for_purpose(
            &runtime,
            AdapterKind::GrokBuild,
            RuntimeLaunchPurpose::HealthProbe,
        )
        .await;
        assert_eq!(
            probe.result.status,
            AgentRuntimeProbeStatus::MissingCapabilities
        );
        assert_eq!(
            probe.result.missing_capabilities,
            vec!["session.resume".to_string()]
        );
        assert!(
            !probe
                .result
                .capabilities
                .contains(&"session.load".to_string())
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn grok_deep_probe_requires_a_successful_resume_call_with_production_wire_shape() {
        for resume_accepted in [true, false] {
            let directory = env::temp_dir().join(format!(
                "rovai-grok-resume-behavior-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&directory).unwrap();
            let runtime = directory.join("grok");
            let request_log = directory.join("requests.jsonl");
            let resume_response = if resume_accepted {
                r#"printf '%s\n' '{"jsonrpc":"2.0","id":4,"result":{"sessionId":"grok-session"}}'
IFS= read -r set_model || exit 1
printf '%s\n' "$set_model" >> "$request_log"
printf '%s\n' '{"jsonrpc":"2.0","id":5,"result":null}'"#
            } else {
                r#"printf '%s\n' '{"jsonrpc":"2.0","id":4,"error":{"code":-32602,"message":"session/resume rejected"}}'"#
            };
            std::fs::write(
                &runtime,
                format!(
                    r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\n' 'grok 1.0.0'
  exit 0
fi
request_log='{}'
IFS= read -r initialize || exit 1
printf '%s\n' "$initialize" >> "$request_log"
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{{"protocolVersion":1,"agentCapabilities":{{"sessionCapabilities":{{"resume":{{}}}}}},"authMethods":[{{"id":"cached_token"}},{{"id":"xai.api_key"}}],"_meta":{{"defaultAuthMethodId":"cached_token"}}}}}}'
IFS= read -r authenticate || exit 1
printf '%s\n' "$authenticate" >> "$request_log"
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{{}}}}'
IFS= read -r session || exit 1
printf '%s\n' "$session" >> "$request_log"
printf '%s\n' '{{"jsonrpc":"2.0","id":3,"result":{{"sessionId":"grok-session","models":{{"currentModelId":"minimax-m3","availableModels":[{{"modelId":"minimax-m3","name":"MiniMax M3"}}]}}}}}}'
IFS= read -r resume || exit 1
printf '%s\n' "$resume" >> "$request_log"
{}
"#,
                    request_log.display(),
                    resume_response
                ),
            )
            .unwrap();
            let mut permissions = std::fs::metadata(&runtime).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&runtime, permissions).unwrap();

            let probe = acp_capability_probe_at_for_purpose(
                &runtime,
                AdapterKind::GrokBuild,
                RuntimeLaunchPurpose::HealthProbe,
            )
            .await;
            if resume_accepted {
                assert_eq!(probe.result.status, AgentRuntimeProbeStatus::Ready);
                assert!(
                    probe
                        .result
                        .capabilities
                        .contains(&"session.resume".to_string())
                );
            } else {
                assert_eq!(
                    probe.result.status,
                    AgentRuntimeProbeStatus::MissingCapabilities
                );
                assert!(
                    probe
                        .result
                        .detail
                        .as_deref()
                        .unwrap()
                        .contains("Grok ACP session/resume capability check failed")
                );
            }

            let requests = std::fs::read_to_string(&request_log)
                .unwrap()
                .lines()
                .map(|line| serde_json::from_str::<Value>(line).unwrap())
                .collect::<Vec<_>>();
            assert_eq!(requests[2]["method"], "session/new");
            let new_params = &requests[2]["params"];
            assert_eq!(
                new_params["additionalDirectories"]
                    .as_array()
                    .unwrap()
                    .len(),
                2
            );
            assert!(
                new_params
                    .pointer("/_meta/rules")
                    .and_then(Value::as_str)
                    .is_some_and(|rules| !rules.trim().is_empty())
            );
            assert!(new_params.pointer("/_meta/systemPromptOverride").is_none());
            assert!(new_params.get("systemPromptOverride").is_none());

            assert_eq!(requests[3]["method"], "session/resume");
            let resume_params = &requests[3]["params"];
            assert_eq!(resume_params["sessionId"], "grok-session");
            assert_eq!(resume_params["cwd"], new_params["cwd"]);
            assert_eq!(resume_params["mcpServers"], json!([]));
            assert_eq!(resume_params["additionalDirectories"], json!([]));
            assert!(resume_params.get("_meta").is_none());
            if resume_accepted {
                assert_eq!(requests[4]["method"], "session/set_model");
            }

            std::fs::remove_dir_all(directory).unwrap();
        }
    }

    #[test]
    fn grok_auth_prefers_the_advertised_noninteractive_default() {
        let initialize = json!({
            "authMethods": [
                {"id": "xai.api_key"},
                {"id": "cached_token"},
                {"id": "grok.com"}
            ],
            "_meta": {"defaultAuthMethodId": "cached_token"}
        });
        assert_eq!(
            select_grok_noninteractive_auth_method(&initialize, false).unwrap(),
            "cached_token"
        );
        assert_eq!(
            select_grok_noninteractive_auth_method(&initialize, true).unwrap(),
            "xai.api_key"
        );

        let byok = json!({
            "authMethods": [{"id": "xai.api_key"}, {"id": "grok.com"}],
            "_meta": {"defaultAuthMethodId": "xai.api_key"}
        });
        assert_eq!(
            select_grok_noninteractive_auth_method(&byok, true).unwrap(),
            "xai.api_key"
        );
    }

    #[test]
    fn grok_auth_falls_back_without_starting_an_interactive_login() {
        let fallback = json!({
            "authMethods": [{"id": "grok.com"}, {"id": "xai.api_key"}],
            "_meta": {"defaultAuthMethodId": "grok.com"}
        });
        assert_eq!(
            select_grok_noninteractive_auth_method(&fallback, false).unwrap(),
            "xai.api_key"
        );

        let interactive_only = json!({
            "authMethods": [{"id": "grok.com"}],
            "_meta": {"defaultAuthMethodId": "grok.com"}
        });
        let error = select_grok_noninteractive_auth_method(&interactive_only, false).unwrap_err();
        assert!(error.to_string().contains("grok login --device-auth"));
    }

    #[test]
    fn grok_capabilities_require_the_verified_standard_model_method() {
        let initialize = json!({
            "agentCapabilities": {
                "loadSession": true,
                "sessionCapabilities": {"resume": {}}
            }
        });
        let session = json!({
            "sessionId": "grok-session",
            "models": {
                "currentModelId": "MiniMax-M3",
                "availableModels": [{"modelId": "MiniMax-M3", "name": "MiniMax-M3"}]
            }
        });
        let observed = acp_observed_capabilities(
            AdapterKind::GrokBuild,
            Some("1.0.0"),
            Some("sha256:grok"),
            &initialize,
            Some(&session),
            true,
        );
        let required = acp_required_capabilities(AdapterKind::GrokBuild);
        assert!(observed.contains(&"session.set_model".to_string()));
        assert!(observed.contains(&"session.resume".to_string()));
        assert!(!observed.contains(&"session.load".to_string()));
        assert!(!observed.contains(&"session.set_config_option".to_string()));
        assert!(required.contains(&"session.set_model".to_string()));
        assert!(required.contains(&"session.resume".to_string()));
        assert!(!required.contains(&"session.set_config_option".to_string()));

        let unverified = acp_observed_capabilities(
            AdapterKind::GrokBuild,
            Some("1.0.0"),
            Some("sha256:grok"),
            &initialize,
            Some(&session),
            false,
        );
        assert!(!unverified.contains(&"session.resume".to_string()));
    }

    #[test]
    fn grok_inspect_names_reserve_current_and_legacy_native_definitions() {
        let current = json!({
            "projectTrusted": true,
            "projectRoot": "/workspace",
            "mcpServers": [
                {"name": "native-one", "source": {"type": "configToml"}},
                {"name": "Native-Two", "source": {"type": "mcpJson"}},
                {"name": "disabled", "disabled": true},
                {"name": "blocked", "disabledReason": "managed policy"}
            ]
        });
        assert_eq!(
            grok_native_mcp_server_names_from_inspect(&current).unwrap(),
            BTreeSet::from([
                "Native-Two".to_string(),
                "blocked".to_string(),
                "disabled".to_string(),
                "native-one".to_string(),
            ])
        );

        let untrusted = json!({
            "projectTrusted": false,
            "projectRoot": "/workspace",
            "mcpServers": [
                {"name": "project", "source": {"type": "mcpJson", "path": "/workspace/.mcp.json"}},
                {"name": "user", "source": {"type": "mcpJson", "path": "/home/user/.cursor/mcp.json"}}
            ]
        });
        assert_eq!(
            grok_native_mcp_server_names_from_inspect(&untrusted).unwrap(),
            BTreeSet::from(["project".to_string(), "user".to_string()])
        );

        let legacy = json!({"mcpServers": {"docs": {}, "search": {}}});
        assert_eq!(
            grok_native_mcp_server_names_from_inspect(&legacy).unwrap(),
            BTreeSet::from(["docs".to_string(), "search".to_string()])
        );
    }

    #[test]
    fn generated_schema_is_used_as_a_capability_contract() {
        let directory = env::temp_dir().join(format!(
            "rovai-health-capability-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).expect("temporary schema directory should exist");
        std::fs::write(
            directory.join("ClientRequest.json"),
            r#"["thread/start","thread/resume","turn/start","turn/interrupt","runtimeWorkspaceRoots"]"#,
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
        assert!(capabilities.contains(&"workspace.additional_roots".to_string()));
        assert!(missing.contains(&"approval.file_request".to_string()));
        assert!(!missing.contains(&"approval.command_request".to_string()));
        std::fs::remove_dir_all(directory).expect("temporary schema directory should be removed");
    }
}
