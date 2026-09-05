use std::{fmt, path::Path};

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::agent_profile::AdapterKind;

pub const PUBLIC_RUNTIME_ERROR_MAX_CHARS: usize = 2048;
const PUBLIC_RUNTIME_ERROR_MAX_LINES: usize = 4;
const PUBLIC_RUNTIME_ERROR_SUMMARY_MAX_CHARS: usize = 240;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeFailureOrigin {
    Runtime,
    Compatibility,
    Environment,
    Rovai,
    Unknown,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeFailurePhase {
    Spawn,
    Authentication,
    ModelCatalog,
    Execution,
    Terminal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFailureView {
    pub runtime_kind: AdapterKind,
    pub origin: RuntimeFailureOrigin,
    pub phase: RuntimeFailurePhase,
    pub code: String,
    pub summary: String,
    pub detail: Option<String>,
    pub retryable: bool,
}

impl RuntimeFailureView {
    pub fn new(
        runtime_kind: AdapterKind,
        origin: RuntimeFailureOrigin,
        phase: RuntimeFailurePhase,
        code: impl Into<String>,
        summary: impl Into<String>,
        detail: Option<String>,
        retryable: bool,
    ) -> Self {
        Self {
            runtime_kind,
            origin,
            phase,
            code: code.into(),
            summary: summary.into(),
            detail,
            retryable,
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.code.trim().is_empty()
            || self.code.len() > 120
            || !self
                .code
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        {
            anyhow::bail!("public Runtime failure code is invalid");
        }
        let summary_chars = self.summary.chars().count();
        if self.summary.trim().is_empty()
            || summary_chars > PUBLIC_RUNTIME_ERROR_SUMMARY_MAX_CHARS
            || self.summary.chars().any(char::is_control)
        {
            anyhow::bail!("public Runtime failure summary is invalid");
        }
        if let Some(detail) = self.detail.as_deref()
            && (detail.trim().is_empty()
                || detail.chars().count() > PUBLIC_RUNTIME_ERROR_MAX_CHARS
                || detail
                    .chars()
                    .any(|character| character.is_control() && character != '\n'))
        {
            anyhow::bail!("public Runtime failure detail is invalid");
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeFailureError {
    pub failure: RuntimeFailureView,
}

impl RuntimeFailureError {
    pub fn new(failure: RuntimeFailureView) -> Self {
        Self { failure }
    }
}

impl fmt::Display for RuntimeFailureError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.failure.code)
    }
}

impl std::error::Error for RuntimeFailureError {}

#[expect(
    clippy::too_many_arguments,
    reason = "the closed public failure contract and sanitization inputs stay explicit at each boundary"
)]
pub fn public_runtime_failure_from_output(
    runtime_kind: AdapterKind,
    origin: RuntimeFailureOrigin,
    phase: RuntimeFailurePhase,
    default_code: &str,
    default_summary: &str,
    raw_detail: Option<&str>,
    sensitive_paths: &[(&Path, &str)],
    retryable: bool,
) -> RuntimeFailureView {
    let lower = raw_detail.unwrap_or_default().to_ascii_lowercase();
    let (origin, phase, code, summary, retryable) = if origin == RuntimeFailureOrigin::Runtime {
        classify_high_value_runtime_error(
            runtime_kind,
            phase,
            default_code,
            default_summary,
            &lower,
            retryable,
        )
    } else {
        (
            origin,
            phase,
            default_code.to_string(),
            default_summary.to_string(),
            retryable,
        )
    };
    RuntimeFailureView::new(
        runtime_kind,
        origin,
        phase,
        code,
        summary,
        raw_detail.and_then(|detail| sanitize_public_runtime_error(detail, sensitive_paths)),
        retryable,
    )
}

fn classify_high_value_runtime_error(
    runtime_kind: AdapterKind,
    default_phase: RuntimeFailurePhase,
    default_code: &str,
    default_summary: &str,
    lower: &str,
    default_retryable: bool,
) -> (
    RuntimeFailureOrigin,
    RuntimeFailurePhase,
    String,
    String,
    bool,
) {
    let runtime_name = runtime_display_name(runtime_kind);
    if contains_any(
        lower,
        &[
            "not logged in",
            "not authenticated",
            "login required",
            "log in required",
            "please log in",
            "authentication required",
            "authentication failed",
            "unauthorized",
            "credential expired",
            "credentials expired",
            "token expired",
        ],
    ) {
        return (
            RuntimeFailureOrigin::Runtime,
            RuntimeFailurePhase::Authentication,
            "runtime_authentication_required".to_string(),
            format!("需要登录 {runtime_name}"),
            true,
        );
    }
    if contains_any(
        lower,
        &[
            "rate limit",
            "rate-limit",
            "too many requests",
            "status 429",
            "http 429",
        ],
    ) {
        return (
            RuntimeFailureOrigin::Runtime,
            default_phase,
            "runtime_rate_limited".to_string(),
            "请求过于频繁".to_string(),
            true,
        );
    }
    if contains_any(
        lower,
        &["at capacity", "server overloaded", "serveroverloaded"],
    ) {
        return (
            RuntimeFailureOrigin::Runtime,
            default_phase,
            "runtime_server_overloaded".to_string(),
            "Runtime 服务暂时繁忙".to_string(),
            true,
        );
    }
    if contains_any(
        lower,
        &[
            "quota exceeded",
            "quota exhausted",
            "insufficient quota",
            "credit balance",
            "insufficient credits",
            "billing limit",
        ],
    ) {
        return (
            RuntimeFailureOrigin::Runtime,
            default_phase,
            "runtime_quota_exceeded".to_string(),
            "账户配额不足".to_string(),
            false,
        );
    }
    if lower.contains("model")
        && contains_any(
            lower,
            &[
                "not found",
                "does not exist",
                "not available",
                "unavailable",
                "no access",
                "access denied",
                "permission",
                "unsupported model",
            ],
        )
    {
        return (
            RuntimeFailureOrigin::Runtime,
            default_phase,
            "runtime_model_unavailable".to_string(),
            "所选模型不可用或无权访问".to_string(),
            false,
        );
    }
    if contains_any(
        lower,
        &[
            "permission denied",
            "access denied",
            "operation not permitted",
        ],
    ) {
        return (
            RuntimeFailureOrigin::Runtime,
            default_phase,
            "runtime_permission_denied".to_string(),
            format!("{runtime_name} 拒绝了访问请求"),
            false,
        );
    }
    (
        RuntimeFailureOrigin::Runtime,
        default_phase,
        default_code.to_string(),
        default_summary.to_string(),
        default_retryable,
    )
}

fn runtime_display_name(runtime_kind: AdapterKind) -> &'static str {
    match runtime_kind {
        AdapterKind::CodexCli => "Codex CLI",
        AdapterKind::Pi => "Pi Coding Agent",
        AdapterKind::OpencodeCli => "OpenCode",
        AdapterKind::CopilotCli => "GitHub Copilot CLI",
        AdapterKind::ClaudeCodeCli => "Claude Code",
        AdapterKind::KiroCli => "Kiro CLI",
        AdapterKind::QoderCli => "Qoder CLI",
        AdapterKind::CodebuddyCli => "CodeBuddy CLI",
        AdapterKind::QwenCode => "Qwen Code",
        AdapterKind::TraeCnCli => "TRAE CLI",
        AdapterKind::CursorAgent => "Cursor Agent",
        AdapterKind::KimiCodeCli => "Kimi Code",
        AdapterKind::GrokBuild => "Grok Build",
        AdapterKind::AntigravityApp => "Antigravity",
    }
}

fn contains_any(value: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|candidate| value.contains(candidate))
}

/// Produces a bounded, path-redacted and credential-redacted explanation for
/// user-visible Runtime surfaces. Callers must pass Runtime diagnostics only;
/// prompt, user-message and Tool payloads are not valid inputs to this boundary.
pub fn sanitize_public_runtime_error(
    raw: &str,
    sensitive_paths: &[(&Path, &str)],
) -> Option<String> {
    let without_ansi = strip_ansi_and_controls(raw);
    let mut paths = Vec::new();
    for (path, replacement) in sensitive_paths {
        push_sensitive_path_variants(&mut paths, path, replacement);
    }
    if let Some(home) = dirs::home_dir() {
        push_sensitive_path_variants(&mut paths, &home, "<home>");
    }
    push_sensitive_path_variants(&mut paths, &std::env::temp_dir(), "<temp>");
    paths.sort_by_key(|entry| std::cmp::Reverse(entry.0.len()));
    paths.dedup_by(|left, right| left.0 == right.0);

    let mut lines = Vec::new();
    for raw_line in without_ansi.lines() {
        let collapsed = raw_line.split_whitespace().collect::<Vec<_>>().join(" ");
        if collapsed.is_empty() || contains_private_payload_label(&collapsed) {
            continue;
        }
        let mut redacted = collapsed;
        for (path, replacement) in &paths {
            if !path.is_empty() {
                redacted = redacted.replace(path, replacement);
            }
        }
        redacted = redact_private_runtime_paths(redacted);
        redacted = redact_secret_values(redacted);
        if !redacted.trim().is_empty() {
            lines.push(redacted);
        }
        if lines.len() == PUBLIC_RUNTIME_ERROR_MAX_LINES {
            break;
        }
    }
    let joined = lines.join("\n");
    let bounded = truncate_chars(&joined, PUBLIC_RUNTIME_ERROR_MAX_CHARS);
    (!bounded.trim().is_empty()).then_some(bounded)
}

fn push_sensitive_path_variants(paths: &mut Vec<(String, String)>, path: &Path, replacement: &str) {
    let mut variants = vec![path.to_string_lossy().to_string()];
    if let Ok(canonical) = path.canonicalize() {
        variants.push(canonical.to_string_lossy().to_string());
    }
    for value in variants.clone() {
        if let Some(private_alias) = value.strip_prefix("/private/") {
            variants.push(format!("/{private_alias}"));
        } else if value.starts_with("/var/") || value.starts_with("/tmp/") {
            variants.push(format!("/private{value}"));
        }
    }
    paths.extend(
        variants
            .into_iter()
            .filter(|value| !value.is_empty())
            .map(|value| (value, replacement.to_string())),
    );
}

fn redact_private_runtime_paths(mut value: String) -> String {
    value = value.replace("<runtime-private>", "<private-runtime>");
    value = value.replace(".runtime-private", "<private-runtime>");
    value.replace("runtime-private", "<private-runtime>")
}

fn strip_ansi_and_controls(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == 0x1b {
            index += 1;
            if index >= bytes.len() {
                break;
            }
            match bytes[index] {
                b'[' => {
                    index += 1;
                    while index < bytes.len() {
                        let byte = bytes[index];
                        index += 1;
                        if (0x40..=0x7e).contains(&byte) {
                            break;
                        }
                    }
                }
                b']' => {
                    index += 1;
                    while index < bytes.len() {
                        if bytes[index] == 0x07 {
                            index += 1;
                            break;
                        }
                        if bytes[index] == 0x1b && bytes.get(index + 1).copied() == Some(b'\\') {
                            index += 2;
                            break;
                        }
                        index += 1;
                    }
                }
                _ => index += 1,
            }
            continue;
        }
        let byte = bytes[index];
        index += 1;
        match byte {
            b'\n' | b'\r' => output.push(b'\n'),
            b'\t' => output.push(b' '),
            0x00..=0x1f | 0x7f => {}
            _ => output.push(byte),
        }
    }
    String::from_utf8_lossy(&output)
        .chars()
        .filter(|character| !character.is_control() || *character == '\n')
        .collect()
}

fn contains_private_payload_label(line: &str) -> bool {
    let normalized = line
        .to_ascii_lowercase()
        .chars()
        .filter(|character| !character.is_whitespace() && !matches!(character, '"' | '\'' | '\\'))
        .collect::<String>();
    [
        "prompt:",
        "prompt=",
        "usermessage:",
        "usermessage=",
        "user_message:",
        "user_message=",
        "toolinput:",
        "toolinput=",
        "tool_input:",
        "tool_input=",
        "tooloutput:",
        "tooloutput=",
        "tool_output:",
        "tool_output=",
    ]
    .iter()
    .any(|label| normalized.contains(label))
}

fn redact_secret_values(mut value: String) -> String {
    let mut bearer_search_from = 0;
    loop {
        let lower = value.to_ascii_lowercase();
        let Some(relative) = lower[bearer_search_from..].find("bearer ") else {
            break;
        };
        let start = bearer_search_from + relative + "bearer ".len();
        let end = value[start..]
            .find(char::is_whitespace)
            .map(|offset| start + offset)
            .unwrap_or(value.len());
        if start < end {
            value.replace_range(start..end, "[redacted]");
        }
        bearer_search_from = start + "[redacted]".len();
    }
    const MARKERS: &[&str] = &[
        "authorization",
        "api_key",
        "api-key",
        "apikey",
        "cookie",
        "credential",
        "secret",
        "token",
    ];
    for marker in MARKERS {
        let mut search_from = 0;
        loop {
            let lower = value.to_ascii_lowercase();
            let Some(relative) = lower[search_from..].find(marker) else {
                break;
            };
            let marker_start = search_from + relative;
            let marker_end = marker_start + marker.len();
            let Some((value_start, value_end)) =
                secret_assignment_bounds(&value, marker, marker_end)
            else {
                search_from = marker_end;
                continue;
            };
            value.replace_range(value_start..value_end, "[redacted]");
            search_from = value_start + "[redacted]".len();
        }
    }
    value
}

fn secret_assignment_bounds(
    value: &str,
    marker: &str,
    marker_end: usize,
) -> Option<(usize, usize)> {
    let suffix = &value[marker_end..];
    let mut delimiter_end = marker_end;
    for (offset, character) in suffix.char_indices() {
        if character.is_whitespace() || matches!(character, '"' | '\'') {
            continue;
        }
        if !matches!(character, ':' | '=') {
            return None;
        }
        delimiter_end = marker_end + offset + character.len_utf8();
        break;
    }
    if delimiter_end == marker_end {
        return None;
    }
    let mut start = delimiter_end;
    for (offset, character) in value[delimiter_end..].char_indices() {
        if character.is_whitespace() || matches!(character, '"' | '\'') {
            start = delimiter_end + offset + character.len_utf8();
            continue;
        }
        start = delimiter_end + offset;
        break;
    }
    let end = if marker == "authorization" {
        value.len()
    } else {
        value[start..]
            .char_indices()
            .find(|(_, character)| {
                character.is_whitespace() || matches!(character, '"' | '\'' | ',' | ';' | '}' | ']')
            })
            .map(|(offset, _)| start + offset)
            .unwrap_or(value.len())
    };
    (start < end).then_some((start, end))
}

fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let keep = limit.saturating_sub(1);
    let mut truncated = value.chars().take(keep).collect::<String>();
    truncated.push('…');
    truncated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_runtime_errors_without_exposing_paths_secrets_or_payloads() {
        let project = Path::new("/Users/tester/project");
        let executable = Path::new("/Applications/Claude.app/Contents/MacOS/claude");
        let raw = concat!(
            "\u{1b}[31mAuthentication failed\u{1b}[0m\n",
            "authorization: Bearer top-secret-value\n",
            "api_key=another-secret\n",
            "Prompt: do not expose this user message\n",
            "Error: tool_output: do not expose this tool payload\n",
            r#"Error: {\"user_message\" : \"do not expose this JSON payload\"}"#,
            "\n",
            "/Users/tester/project/.runtime-private/log at ",
            "/Applications/Claude.app/Contents/MacOS/claude\n",
            "fifth line must be dropped"
        );
        let sanitized = sanitize_public_runtime_error(
            raw,
            &[(project, "<project>"), (executable, "<runtime-executable>")],
        )
        .unwrap();
        assert!(!sanitized.contains("\u{1b}"));
        assert!(!sanitized.contains("top-secret-value"));
        assert!(!sanitized.contains("another-secret"));
        assert!(!sanitized.contains("do not expose"));
        assert!(!sanitized.contains("tool payload"));
        assert!(!sanitized.contains("/Users/tester/project"));
        assert!(!sanitized.contains("/Applications/Claude.app"));
        assert!(!sanitized.contains("runtime-private"));
        assert!(sanitized.contains("authorization: [redacted]"));
        assert!(sanitized.contains("<project>/<private-runtime>/log"));
        assert!(sanitized.lines().count() <= PUBLIC_RUNTIME_ERROR_MAX_LINES);
    }

    #[test]
    fn sanitizes_unicode_controls_and_private_var_aliases() {
        let temporary = Path::new("/var/folders/example/runtime-private");
        let sanitized = sanitize_public_runtime_error(
            "failed\u{0085} at /private/var/folders/example/runtime-private/log",
            &[(temporary, "<temp-runtime>")],
        )
        .unwrap();
        assert_eq!(sanitized, "failed at <temp-runtime>/log");
        assert!(!sanitized.chars().any(char::is_control));
    }

    #[test]
    fn classifies_high_value_runtime_failures_without_changing_other_origins() {
        let failure = public_runtime_failure_from_output(
            AdapterKind::ClaudeCodeCli,
            RuntimeFailureOrigin::Runtime,
            RuntimeFailurePhase::Terminal,
            "runtime_terminal_failure",
            "Claude Code 返回了失败结果",
            Some("HTTP 429: rate limit exceeded"),
            &[],
            false,
        );
        assert_eq!(failure.code, "runtime_rate_limited");
        assert_eq!(failure.origin, RuntimeFailureOrigin::Runtime);
        assert!(failure.retryable);

        let capacity = public_runtime_failure_from_output(
            AdapterKind::CodexCli,
            RuntimeFailureOrigin::Runtime,
            RuntimeFailurePhase::Execution,
            "runtime_turn_failed",
            "Codex CLI 未能完成运行",
            Some("Selected model is at capacity. Please try a different model."),
            &[],
            false,
        );
        assert_eq!(capacity.code, "runtime_server_overloaded");
        assert_eq!(
            capacity.detail.as_deref(),
            Some("Selected model is at capacity. Please try a different model.")
        );
        assert!(capacity.retryable);

        let compatibility = public_runtime_failure_from_output(
            AdapterKind::ClaudeCodeCli,
            RuntimeFailureOrigin::Compatibility,
            RuntimeFailurePhase::Execution,
            "runtime_stream_incompatible",
            "当前 Claude Code 输出格式不受支持",
            Some("permission denied while parsing stream-json"),
            &[],
            false,
        );
        assert_eq!(compatibility.code, "runtime_stream_incompatible");
        assert_eq!(compatibility.origin, RuntimeFailureOrigin::Compatibility);

        let trae = public_runtime_failure_from_output(
            AdapterKind::TraeCnCli,
            RuntimeFailureOrigin::Runtime,
            RuntimeFailurePhase::Execution,
            "runtime_prompt_runtime_error",
            "TRAE CLI 未能完成运行",
            Some("ACP error -32603: Internal error"),
            &[],
            false,
        );
        trae.validate().unwrap();
        assert_eq!(trae.code, "runtime_prompt_runtime_error");
        assert_eq!(
            trae.detail.as_deref(),
            Some("ACP error -32603: Internal error")
        );
        assert!(!trae.retryable);
    }

    #[test]
    fn classifies_auth_quota_model_and_permission_failures_with_stable_codes() {
        let cases = [
            (
                "Authentication failed: token expired",
                "runtime_authentication_required",
                RuntimeFailurePhase::Authentication,
                true,
            ),
            (
                "Quota exceeded for this account",
                "runtime_quota_exceeded",
                RuntimeFailurePhase::Terminal,
                false,
            ),
            (
                "Model claude-test is not available for this account",
                "runtime_model_unavailable",
                RuntimeFailurePhase::Terminal,
                false,
            ),
            (
                "Permission denied while accessing the provider resource",
                "runtime_permission_denied",
                RuntimeFailurePhase::Terminal,
                false,
            ),
        ];
        for (detail, expected_code, expected_phase, expected_retryable) in cases {
            let failure = public_runtime_failure_from_output(
                AdapterKind::AntigravityApp,
                RuntimeFailureOrigin::Runtime,
                RuntimeFailurePhase::Terminal,
                "runtime_terminal_failure",
                "Antigravity 返回了失败结果",
                Some(detail),
                &[],
                true,
            );
            assert_eq!(failure.code, expected_code);
            assert_eq!(failure.phase, expected_phase);
            assert_eq!(failure.retryable, expected_retryable);
        }
    }
}
