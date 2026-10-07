use crate::{
    agent_profile::AdapterKind,
    runtime_failure::{RuntimeFailureOrigin, RuntimeFailurePhase, RuntimeFailureView},
};
use serde_json::Value;
use std::fmt;

/// Never retain native messages/details: they may contain keys, prompts or tool output.
/// Closed codes plus fixed explanations retain the useful fact without publishing raw errors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum HubFailure {
    Native {
        code: &'static str,
        category: &'static str,
    },
    Transport {
        code: &'static str,
    },
}

impl HubFailure {
    pub(super) fn native(error: &Value) -> Self {
        let code = match error["code"].as_str() {
            Some("command_failed") => "command_failed",
            Some("session_not_found") => "session_not_found",
            Some("invalid_request") => "invalid_request",
            Some("invalid_config") => "invalid_config",
            Some("unauthorized") => "unauthorized",
            Some("forbidden") => "forbidden",
            Some("context_length_exceeded") => "context_length_exceeded",
            Some("rate_limit_exceeded") => "rate_limit_exceeded",
            Some("unsupported_command") => "unsupported_command",
            _ => "unrecognized_native_error",
        };
        // Bound classification work independently of the socket's message budget.
        let message = error["message"]
            .as_str()
            .unwrap_or_default()
            .chars()
            .take(2048)
            .collect::<String>()
            .to_ascii_lowercase();
        let category = if code == "session_not_found" || message.contains("session not found") {
            "session_not_found"
        } else if code == "unauthorized"
            || message.contains("authentication")
            || message.contains("invalid api key")
            || message.contains("unauthorized")
        {
            "authentication_failed"
        } else if code == "context_length_exceeded"
            || message.contains("context length")
            || message.contains("context window")
            || message.contains("too many tokens")
        {
            "context_limit_exceeded"
        } else if code == "invalid_config" || message.contains("invalid config") {
            "configuration_rejected"
        } else if code == "forbidden" || message.contains("permission denied") {
            "permission_denied"
        } else if code == "rate_limit_exceeded" || message.contains("rate limit") {
            "rate_limited"
        } else if code == "unsupported_command" {
            "command_unsupported"
        } else {
            "command_rejected"
        };
        Self::Native { code, category }
    }

    pub(super) fn disconnected() -> Self {
        Self::Transport {
            code: "cline_hub_disconnected_outcome_unknown",
        }
    }

    pub(super) fn is_native(&self) -> bool {
        matches!(self, Self::Native { .. })
    }

    pub(super) fn public_view(&self) -> RuntimeFailureView {
        let (code, summary, detail) = match self {
            Self::Native { code, category } => {
                let summary = match *category {
                    "session_not_found" => "Cline 未找到原生会话",
                    "authentication_failed" => "Cline 原生认证失败",
                    "context_limit_exceeded" => "Cline 上下文超过原生限制",
                    "configuration_rejected" => "Cline 拒绝了会话配置",
                    "permission_denied" => "Cline 拒绝了操作权限",
                    "rate_limited" => "Cline 请求受到限流",
                    "command_unsupported" => "Cline 不支持此原生命令",
                    _ => "Cline 已明确拒绝请求",
                };
                (
                    format!("cline_hub_native_{category}"),
                    summary,
                    format!(
                        "Native Hub failure: {code}; category: {category}. Prior tool effects are not ruled out; input is not replayed."
                    ),
                )
            }
            Self::Transport { code } => (
                (*code).into(),
                "Cline Hub 未返回可确认的执行结果",
                format!(
                    "Hub transport failure: {code}. Execution outcome is unknown; input is not replayed."
                ),
            ),
        };
        RuntimeFailureView::new(
            AdapterKind::ClineCli,
            RuntimeFailureOrigin::Runtime,
            RuntimeFailurePhase::Execution,
            code,
            summary,
            Some(detail),
            false,
        )
    }
}

impl fmt::Display for HubFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let view = self.public_view();
        write!(
            f,
            "{}: {}",
            view.code,
            view.detail.as_deref().unwrap_or_default()
        )
    }
}
impl std::error::Error for HubFailure {}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn native_rejection_keeps_known_failure_separate_from_unknown_without_echoing_secrets() {
        for (code, message, category) in [
            (
                "command_failed",
                "session not found: secret-session",
                "session_not_found",
            ),
            (
                "unauthorized",
                "Authorization: Bearer secret-key",
                "authentication_failed",
            ),
            (
                "command_failed",
                "context length exceeded: secret-prompt",
                "context_limit_exceeded",
            ),
            ("invalid_config", "secret-config", "configuration_rejected"),
            ("secret-code", "secret-message", "command_rejected"),
        ] {
            let failure = HubFailure::native(
                &json!({"code":code,"message":message,"details":{"apiKey":"secret-details"}}),
            );
            let view = failure.public_view();
            view.validate().unwrap();
            assert!(failure.is_native());
            assert_eq!(view.code, format!("cline_hub_native_{category}"));
            assert!(!view.retryable);
            assert!(!format!("{failure:?} {failure} {view:?}").contains("secret"));
        }
        let unknown = HubFailure::disconnected();
        assert!(!unknown.is_native());
        assert!(unknown.public_view().code.ends_with("outcome_unknown"));
        assert!(!unknown.public_view().retryable);
    }
}
