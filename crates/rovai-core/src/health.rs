use std::{
    collections::BTreeSet,
    env,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use rovai_core::{
    agent_profile::AdapterKind,
    agent_runtime_adapter::{
        KIRO_ADDITIVE_AGENT_NAME, executable_fingerprint, write_kiro_additive_agent_config,
    },
    runtime_discovery::{
        RuntimeLaunchPurpose, configure_active_runtime_command, discover_static_runtime_version,
        runtime_launch_allowed,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    time::timeout,
};

const CODEX_RUNTIME_KIND: &str = "codex-cli";

fn runtime_command(executable: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(executable);
    configure_active_runtime_command(&mut command);
    command
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
    pub probed_at: String,
}

#[derive(Debug, Clone)]
pub struct AcpCapabilityProbe {
    pub result: AgentRuntimeProbeResult,
    pub initialize_result: Option<Value>,
    pub session_result: Option<Value>,
}

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

pub async fn git_health() -> CommandHealth {
    command_health("git", &["--version"], None).await
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

pub async fn acp_capability_probe_at(path: &Path, kind: AdapterKind) -> AcpCapabilityProbe {
    acp_probe_at(path, kind, acp_deep_session_probe_enabled(kind)).await
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
        return ClaudeCodeCapabilityProbe {
            result: agent_probe_result(
                AdapterKind::ClaudeCodeCli.as_str(),
                Some(path_text),
                None,
                None,
                AgentRuntimeProbeStatus::NotInstalled,
                Vec::new(),
                claude_code_required_capabilities(),
                Some("Configured Claude Code executable does not exist.".to_string()),
                probed_at,
            ),
            model_aliases: Vec::new(),
        };
    }
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let fingerprint = executable_fingerprint_async(canonical.clone()).await;
    let version = timeout(
        Duration::from_secs(15),
        runtime_command(&canonical)
            .arg("--version")
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await;
    let reported_version = match version {
        Ok(Ok(output)) if output.status.success() => {
            first_nonempty_line(&output.stdout, &output.stderr)
        }
        Ok(Ok(output)) => {
            return claude_code_probe_failure(
                path_text,
                fingerprint,
                None,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!(
                    "Claude Code version check failed with {} (outputDigest={})",
                    output.status,
                    probe_output_digest(&output.stdout, &output.stderr)
                ),
                probed_at,
            );
        }
        Ok(Err(error)) => {
            return claude_code_probe_failure(
                path_text,
                fingerprint,
                None,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!("failed to inspect Claude Code: {error}"),
                probed_at,
            );
        }
        Err(_) => {
            return claude_code_probe_failure(
                path_text,
                fingerprint,
                None,
                AgentRuntimeProbeStatus::ProbeFailed,
                "Claude Code version check timed out".to_string(),
                probed_at,
            );
        }
    };

    let help = timeout(
        Duration::from_secs(15),
        runtime_command(&canonical)
            .arg("--help")
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await;
    let help = match help {
        Ok(Ok(output)) => format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ),
        Ok(Err(error)) => {
            return claude_code_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!("failed to inspect Claude Code capabilities: {error}"),
                probed_at,
            );
        }
        Err(_) => {
            return claude_code_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                AgentRuntimeProbeStatus::ProbeFailed,
                "Claude Code capability check timed out".to_string(),
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
        return ClaudeCodeCapabilityProbe {
            result: agent_probe_result(
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
            ),
            model_aliases: Vec::new(),
        };
    }

    let auth = timeout(
        Duration::from_secs(15),
        runtime_command(&canonical)
            .args(["auth", "status"])
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await;
    let authenticated = match auth {
        Ok(Ok(output)) if output.status.success() => {
            serde_json::from_slice::<Value>(&output.stdout)
                .ok()
                .and_then(|value| value.get("loggedIn").and_then(Value::as_bool))
                // Older/newer Claude Code releases may render a successful
                // human-readable status instead of JSON. A zero exit code is
                // still the installed CLI's authoritative auth result.
                .unwrap_or(true)
        }
        Ok(Ok(_)) => false,
        Ok(Err(error)) => {
            return claude_code_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!("failed to inspect Claude Code authentication: {error}"),
                probed_at,
            );
        }
        Err(_) => {
            return claude_code_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                AgentRuntimeProbeStatus::ProbeFailed,
                "Claude Code authentication check timed out".to_string(),
                probed_at,
            );
        }
    };
    if !authenticated {
        return claude_code_probe_failure(
            path_text,
            fingerprint,
            reported_version,
            AgentRuntimeProbeStatus::AuthenticationRequired,
            "Claude Code is not logged in.".to_string(),
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
        return AntigravityCapabilityProbe {
            result: agent_probe_result(
                AdapterKind::AntigravityApp.as_str(),
                Some(path_text),
                None,
                None,
                AgentRuntimeProbeStatus::NotInstalled,
                Vec::new(),
                antigravity_required_capabilities(),
                Some("Configured Antigravity companion executable does not exist.".to_string()),
                probed_at,
            ),
            models: Vec::new(),
        };
    }
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let fingerprint = executable_fingerprint_async(canonical.clone()).await;
    let version = timeout(
        Duration::from_secs(15),
        runtime_command(&canonical)
            .arg("--version")
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await;
    let reported_version = match version {
        Ok(Ok(output)) if output.status.success() => {
            first_nonempty_line(&output.stdout, &output.stderr)
        }
        Ok(Ok(output)) => {
            return antigravity_probe_failure(
                path_text,
                fingerprint,
                None,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!(
                    "Antigravity companion version check failed with {} (outputDigest={})",
                    output.status,
                    probe_output_digest(&output.stdout, &output.stderr)
                ),
                probed_at,
            );
        }
        Ok(Err(error)) => {
            return antigravity_probe_failure(
                path_text,
                fingerprint,
                None,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!("failed to inspect Antigravity companion CLI: {error}"),
                probed_at,
            );
        }
        Err(_) => {
            return antigravity_probe_failure(
                path_text,
                fingerprint,
                None,
                AgentRuntimeProbeStatus::ProbeFailed,
                "Antigravity companion version check timed out".to_string(),
                probed_at,
            );
        }
    };

    let help = timeout(
        Duration::from_secs(15),
        runtime_command(&canonical)
            .arg("--help")
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await;
    let help = match help {
        Ok(Ok(output)) => format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ),
        Ok(Err(error)) => {
            return antigravity_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                AgentRuntimeProbeStatus::ProbeFailed,
                format!("failed to inspect Antigravity companion capabilities: {error}"),
                probed_at,
            );
        }
        Err(_) => {
            return antigravity_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                AgentRuntimeProbeStatus::ProbeFailed,
                "Antigravity companion capability check timed out".to_string(),
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
        return AntigravityCapabilityProbe {
            result: agent_probe_result(
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
            ),
            models: Vec::new(),
        };
    }

    let model_output = timeout(
        Duration::from_secs(60),
        runtime_command(&canonical)
            .arg("models")
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await;
    match model_output {
        Ok(Ok(output)) if output.status.success() => {
            let models = String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(antigravity_model_identifier_from_line)
                .collect::<Vec<_>>();
            if models.is_empty() {
                return antigravity_probe_failure(
                    path_text,
                    fingerprint,
                    reported_version,
                    AgentRuntimeProbeStatus::ProbeFailed,
                    "Antigravity model discovery returned no model identifiers".to_string(),
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
        Ok(Ok(output)) => {
            let raw_detail = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            let lower = raw_detail.to_ascii_lowercase();
            let status = if lower.contains("auth")
                || lower.contains("login")
                || lower.contains("credential")
            {
                AgentRuntimeProbeStatus::AuthenticationRequired
            } else {
                AgentRuntimeProbeStatus::ProbeFailed
            };
            let detail = format!(
                "Antigravity model discovery failed with {} (outputDigest={})",
                output.status,
                probe_output_digest(&output.stdout, &output.stderr)
            );
            antigravity_probe_failure(
                path_text,
                fingerprint,
                reported_version,
                status,
                detail,
                probed_at,
            )
        }
        Ok(Err(error)) => antigravity_probe_failure(
            path_text,
            fingerprint,
            reported_version,
            AgentRuntimeProbeStatus::ProbeFailed,
            format!("failed to discover Antigravity models: {error}"),
            probed_at,
        ),
        Err(_) => antigravity_probe_failure(
            path_text,
            fingerprint,
            reported_version,
            AgentRuntimeProbeStatus::ProbeFailed,
            "Antigravity model discovery timed out".to_string(),
            probed_at,
        ),
    }
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

fn antigravity_probe_failure(
    path: String,
    fingerprint: Option<String>,
    reported_version: Option<String>,
    status: AgentRuntimeProbeStatus,
    detail: String,
    probed_at: String,
) -> AntigravityCapabilityProbe {
    AntigravityCapabilityProbe {
        result: agent_probe_result(
            AdapterKind::AntigravityApp.as_str(),
            Some(path),
            reported_version,
            fingerprint,
            status,
            Vec::new(),
            antigravity_required_capabilities(),
            Some(detail),
            probed_at,
        ),
        models: Vec::new(),
    }
}

fn claude_code_probe_failure(
    path: String,
    fingerprint: Option<String>,
    reported_version: Option<String>,
    status: AgentRuntimeProbeStatus,
    detail: String,
    probed_at: String,
) -> ClaudeCodeCapabilityProbe {
    ClaudeCodeCapabilityProbe {
        result: agent_probe_result(
            AdapterKind::ClaudeCodeCli.as_str(),
            Some(path),
            reported_version,
            fingerprint,
            status,
            Vec::new(),
            claude_code_required_capabilities(),
            Some(detail),
            probed_at,
        ),
        model_aliases: Vec::new(),
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

async fn acp_probe_at(path: &Path, kind: AdapterKind, include_session: bool) -> AcpCapabilityProbe {
    let probed_at = chrono::Utc::now().to_rfc3339();
    let path_text = path.to_string_lossy().to_string();
    if !matches!(
        kind,
        AdapterKind::OpencodeCli
            | AdapterKind::CopilotCli
            | AdapterKind::KiroCli
            | AdapterKind::QoderCli
            | AdapterKind::CodebuddyCli
            | AdapterKind::QwenCode
            | AdapterKind::TraeCnCli
    ) {
        return AcpCapabilityProbe {
            result: agent_probe_result(
                kind.as_str(),
                Some(path_text),
                None,
                None,
                AgentRuntimeProbeStatus::MissingCapabilities,
                Vec::new(),
                acp_required_capabilities(kind),
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
                acp_required_capabilities(kind),
                Some("Configured Runtime executable does not exist.".to_string()),
                probed_at,
            ),
            initialize_result: None,
            session_result: None,
        };
    }
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let fingerprint = executable_fingerprint_async(canonical.clone()).await;
    if !runtime_launch_allowed(kind, RuntimeLaunchPurpose::HealthProbe) {
        return AcpCapabilityProbe {
            result: agent_probe_result(
                kind.as_str(),
                Some(path_text),
                discover_static_runtime_version(kind, &canonical),
                fingerprint,
                AgentRuntimeProbeStatus::ProbeFailed,
                Vec::new(),
                acp_required_capabilities(kind),
                Some("runtime_launch_disallowed_for_health_probe".to_string()),
                probed_at,
            ),
            initialize_result: None,
            session_result: None,
        };
    }
    let version_output = match timeout(
        Duration::from_secs(15),
        runtime_command(&canonical)
            .arg("--version")
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    {
        Ok(Ok(output)) if output.status.success() => output,
        Ok(Ok(output)) => {
            return AcpCapabilityProbe {
                result: agent_probe_result(
                    kind.as_str(),
                    Some(path_text),
                    None,
                    fingerprint,
                    AgentRuntimeProbeStatus::ProbeFailed,
                    Vec::new(),
                    acp_required_capabilities(kind),
                    Some(command_detail(
                        &output.stdout,
                        &output.stderr,
                        "Runtime version check failed",
                    )),
                    probed_at,
                ),
                initialize_result: None,
                session_result: None,
            };
        }
        Ok(Err(error)) => {
            return AcpCapabilityProbe {
                result: agent_probe_result(
                    kind.as_str(),
                    Some(path_text),
                    None,
                    fingerprint,
                    AgentRuntimeProbeStatus::ProbeFailed,
                    Vec::new(),
                    acp_required_capabilities(kind),
                    Some(format!("failed to inspect Runtime CLI: {error}")),
                    probed_at,
                ),
                initialize_result: None,
                session_result: None,
            };
        }
        Err(_) => {
            return AcpCapabilityProbe {
                result: agent_probe_result(
                    kind.as_str(),
                    Some(path_text),
                    None,
                    fingerprint,
                    AgentRuntimeProbeStatus::ProbeFailed,
                    Vec::new(),
                    acp_required_capabilities(kind),
                    Some("Runtime version check timed out".to_string()),
                    probed_at,
                ),
                initialize_result: None,
                session_result: None,
            };
        }
    };
    let reported_version = first_nonempty_line(&version_output.stdout, &version_output.stderr);
    let probe = run_acp_probe(&canonical, kind, include_session).await;
    match probe {
        Ok((initialize_result, session_result, behavioral_evidence)) => {
            let mut capabilities = acp_observed_capabilities(
                kind,
                &initialize_result,
                session_result.as_ref(),
                behavioral_evidence.as_ref(),
            );
            let additive_mcp = additive_acp_mcp_verified(kind);
            if additive_mcp {
                capabilities.push("mcp.additive_per_run".to_string());
            }
            capabilities.sort();
            capabilities.dedup();
            let required = acp_required_capabilities(kind);
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
                    acp_required_capabilities(kind),
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
) -> Result<(Value, Option<Value>, Option<TraeBehavioralProbeEvidence>)> {
    if !runtime_launch_allowed(kind, RuntimeLaunchPurpose::HealthProbe) {
        bail!("runtime_launch_disallowed_for_health_probe");
    }
    let probe_root = env::temp_dir().join(format!("rovai-acp-probe-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&probe_root)?;
    if kind == AdapterKind::KiroCli {
        write_kiro_additive_agent_config(&probe_root, &Default::default())?;
    }
    let trae_native_append_marker = (kind == AdapterKind::TraeCnCli)
        .then(|| format!("ROVAI_TRAE_NATIVE_APPEND_{}", uuid::Uuid::new_v4().simple()));
    let mut command = runtime_command(path);
    configure_acp_command(&mut command, kind, false);
    if kind == AdapterKind::TraeCnCli {
        command.args(["--permission-mode", "default"]);
        let marker = trae_native_append_marker
            .as_deref()
            .expect("TRAE marker must exist");
        let override_value = format!(
            "append_system_prompt=The opaque Rovai Runtime marker is \"{marker}\", and it is process-scoped. When asked for the opaque Rovai Runtime marker, reply with that marker exactly."
        );
        command
            .arg("--config")
            .arg(encode_string_slice_item(&override_value));
    }
    if kind == AdapterKind::KiroCli {
        // Authentication remains in the user's native secure store, while
        // disposable probe Sessions stay out of the persistent Kiro home.
        command.env("KIRO_HOME", probe_root.join("kiro-home"));
    }
    let mut child = command
        .current_dir(&probe_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("failed to start {} as an ACP server", path.display()))?;
    let mut stdin = child.stdin.take().context("ACP stdin was unavailable")?;
    let stdout = child.stdout.take().context("ACP stdout was unavailable")?;
    let mut stderr = child.stderr.take().context("ACP stderr was unavailable")?;
    let stderr_task = tokio::spawn(async move {
        let mut output = Vec::new();
        stderr.read_to_end(&mut output).await?;
        Ok::<_, std::io::Error>(output)
    });
    let mut lines = BufReader::new(stdout).lines();
    let exchange = async {
        write_json_line(
            &mut stdin,
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
        let initialize = read_rpc_result(&mut lines, 1).await?;
        if initialize.get("protocolVersion").and_then(Value::as_u64) != Some(1) {
            bail!("Runtime did not negotiate ACP v1");
        }
        if !include_session {
            return Ok::<_, anyhow::Error>((initialize, None, None));
        }
        write_json_line(
            &mut stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "session/new",
                "params": {"cwd": probe_root, "mcpServers": []}
            }),
        )
        .await?;
        let session = read_rpc_result(&mut lines, 2).await?;
        let session_id = session
            .get("sessionId")
            .and_then(Value::as_str)
            .context("ACP session/new did not return sessionId")?;
        if kind == AdapterKind::KiroCli {
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
                .context("Kiro ACP Session did not report its current model")?;
            write_json_line(
                &mut stdin,
                &json!({
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "session/set_model",
                    "params": {
                        "sessionId": session_id,
                        "modelId": current_model
                    }
                }),
            )
            .await?;
            read_rpc_result(&mut lines, 3).await?;
        }
        let behavioral_evidence = if kind == AdapterKind::TraeCnCli {
            Some(
                run_trae_behavioral_probe(
                    &mut stdin,
                    &mut lines,
                    session_id,
                    &session,
                    &probe_root,
                    trae_native_append_marker
                        .as_deref()
                        .expect("TRAE marker must exist"),
                )
                .await?,
            )
        } else {
            None
        };
        Ok((initialize, Some(session), behavioral_evidence))
    };
    let deadline = if kind == AdapterKind::TraeCnCli {
        Duration::from_secs(180)
    } else {
        Duration::from_secs(30)
    };
    let result = match timeout(deadline, exchange).await {
        Ok(result) => result,
        Err(_) => Err(anyhow::anyhow!("ACP probe timed out")),
    };
    let _ = child.kill().await;
    let _ = child.wait().await;
    let stderr = stderr_task
        .await
        .context("ACP stderr reader failed")?
        .context("ACP stderr could not be read")?;
    let _ = std::fs::remove_dir_all(&probe_root);
    match result {
        Ok(result) => Ok(result),
        Err(error) if stderr.iter().any(|byte| !byte.is_ascii_whitespace()) => {
            let detail = String::from_utf8_lossy(&stderr);
            let bounded = detail.chars().take(4096).collect::<String>();
            Err(error.context(format!("ACP stderr: {bounded}")))
        }
        Err(error) => Err(error),
    }
}

fn encode_string_slice_item(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
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

async fn run_trae_behavioral_probe(
    stdin: &mut tokio::process::ChildStdin,
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
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
    stdin: &mut tokio::process::ChildStdin,
    lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
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
        AdapterKind::CodexCli | AdapterKind::ClaudeCodeCli | AdapterKind::AntigravityApp => {}
    }
}

fn acp_observed_capabilities(
    kind: AdapterKind,
    initialize: &Value,
    session: Option<&Value>,
    trae_behavioral: Option<&TraeBehavioralProbeEvidence>,
) -> Vec<String> {
    let mut capabilities = vec!["acp.initialize".to_string()];
    if initialize
        .pointer("/agentCapabilities/loadSession")
        .and_then(Value::as_bool)
        == Some(true)
    {
        capabilities.push("session.load".to_string());
    }
    if let Some(session) = session {
        capabilities.push("session.new".to_string());
        if kind == AdapterKind::TraeCnCli {
            if let Some(evidence) = trae_behavioral {
                capabilities.extend(evidence.capabilities.iter().cloned());
            }
            if session
                .get("configOptions")
                .and_then(Value::as_array)
                .is_some_and(|options| {
                    options.iter().any(|option| {
                        option.get("id").and_then(Value::as_str) == Some("model")
                            && option
                                .get("options")
                                .and_then(Value::as_array)
                                .is_some_and(|values| !values.is_empty())
                    })
                })
            {
                capabilities.push("model.dynamic_catalog".to_string());
            }
            if session
                .pointer("/modes/availableModes")
                .and_then(Value::as_array)
                .is_some_and(|modes| {
                    modes
                        .iter()
                        .any(|mode| mode.get("id").and_then(Value::as_str) == Some("default"))
                })
            {
                capabilities.push("permission.mode_catalog".to_string());
            }
        } else {
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
                if kind == AdapterKind::KiroCli {
                    "session.set_model"
                } else {
                    "session.set_config_option"
                }
                .to_string(),
            );
        }
    }
    capabilities
}

fn acp_required_capabilities(kind: AdapterKind) -> Vec<String> {
    if kind == AdapterKind::TraeCnCli {
        return [
            "acp.initialize",
            "session.new",
            "session.prompt",
            "session.cancel",
            "session.update",
            "structured_permission_request",
            "mcp.additive_per_run",
            "session.set_config_option",
            "session.load",
            "model.dynamic_catalog",
            "permission.mode_catalog",
            "tool_call.stable_id",
            "stdout.json_rpc_only",
            "context.charter.native_append",
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
        if kind == AdapterKind::KiroCli {
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
    let mut child = runtime_command(path)
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
                        "name": "rovai_probe",
                        "title": "Rovai-ai Runtime Probe",
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
    let version_output = match runtime_command(&path).arg("--version").output().await {
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

    match runtime_command(&path)
        .args(["login", "status"])
        .output()
        .await
    {
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
    let mut child = runtime_command(path)
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
        env::temp_dir().join(format!("rovai-codex-schema-probe-{}", uuid::Uuid::new_v4()));
    let output = timeout(
        Duration::from_secs(20),
        runtime_command(path)
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
    match runtime_command(&executable).args(args).output().await {
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

#[cfg(test)]
mod tests {
    use super::*;
    use rovai_core::agent_runtime_adapter::{AcpProbeObservation, AgentRuntimeAdapterRegistry};
    use std::os::unix::fs::PermissionsExt;

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
        assert_eq!(
            arguments(AdapterKind::KiroCli),
            ["acp", "--agent", KIRO_ADDITIVE_AGENT_NAME]
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

    #[tokio::test]
    #[ignore = "manual local Runtime smoke"]
    async fn kiro_private_agent_session_real_runtime_smoke() {
        let path = find_adapter(AdapterKind::KiroCli).expect("Kiro CLI must be installed");
        let probe = acp_probe_at(&path, AdapterKind::KiroCli, true).await;
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
    async fn trae_health_probe_is_guarded_before_any_child_process_launch() {
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

        let probe = acp_capability_probe_at(&runtime, AdapterKind::TraeCnCli).await;
        assert_eq!(probe.result.status, AgentRuntimeProbeStatus::ProbeFailed);
        assert_eq!(
            probe.result.detail.as_deref(),
            Some("runtime_launch_disallowed_for_health_probe")
        );
        assert!(!marker.exists(), "health probe must not execute TRAE");
        std::fs::remove_dir_all(directory).unwrap();
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
