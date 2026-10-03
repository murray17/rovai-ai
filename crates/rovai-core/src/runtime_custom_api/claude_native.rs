//! Inspect the launched native process's resolved configuration, without a model request.
use super::{CustomApiConfiguration, CustomApiSnapshot};
use anyhow::{Context, Result, ensure};
use serde_json::Value;
use tokio::process::Command;

pub fn configure(snapshot: &CustomApiSnapshot, command: &mut Command) -> Result<()> {
    configure_environment(snapshot, command)?;
    let settings = snapshot.claude_settings()?;
    let path = snapshot.write_artifact("claude-settings.json", &serde_json::to_vec(&settings)?)?;
    command.arg("--settings").arg(path);
    Ok(())
}

/// The execution owner merges the same key-free settings with its existing permission/Fast settings.
pub fn configure_environment(snapshot: &CustomApiSnapshot, command: &mut Command) -> Result<()> {
    snapshot.assert_current()?;
    let settings = snapshot.claude_settings()?;
    command.envs(
        settings["env"]
            .as_object()
            .context("Claude 环境配置无效。")?
            .iter()
            .map(|(key, value)| (key, value.as_str().unwrap_or_default())),
    );
    snapshot.configure_environment(command)?;
    if snapshot.configuration.enabled() {
        command.env("ANTHROPIC_CUSTOM_HEADERS", native_headers(snapshot)?);
    }
    Ok(())
}

pub fn validate(
    snapshot: &CustomApiSnapshot,
    settings: &Value,
    status: &Value,
    explicit: Option<&str>,
) -> Result<()> {
    let CustomApiConfiguration::ClaudeCode {
        models, base_url, ..
    } = &snapshot.configuration
    else {
        anyhow::bail!("Claude 自定义 API 类型不匹配。");
    };
    let requested = snapshot.claude_settings()?;
    let effective = settings
        .pointer("/effective/env")
        .and_then(Value::as_object)
        .context("当前 Claude Code 无法报告最终环境配置，不能确认自定义 API 已生效。")?;
    for (name, expected) in requested["env"]
        .as_object()
        .context("Claude 环境配置无效。")?
    {
        ensure!(
            effective.get(name) == Some(expected),
            "Claude Code 原生设置或组织策略覆盖了 {}；自定义 API 未生效。",
            name
        );
    }
    let rows = status
        .get("sections")
        .and_then(Value::as_array)
        .context("Claude Code 未报告实际认证来源。")?
        .iter()
        .filter_map(|section| section.get("rows").and_then(Value::as_array))
        .flatten()
        .collect::<Vec<_>>();
    let row = |label: &str| {
        rows.iter()
            .find(|row| row["label"].as_str() == Some(label))
            .and_then(|row| row["value"].as_str())
    };
    if snapshot.configuration.enabled() {
        let headers = native_headers(snapshot)?;
        let actual_headers = effective
            .get("ANTHROPIC_CUSTOM_HEADERS")
            .and_then(Value::as_str);
        ensure!(
            actual_headers.is_none()
                || actual_headers == Some(headers.as_str())
                || actual_headers == Some(snapshot.redactor()?.text(&headers).as_str()),
            "Claude Code 原生请求头被其他设置覆盖；请在原生来源解决冲突。"
        );
        let source = snapshot.credential_source.claude_variable();
        if let Some(key) = snapshot.key()? {
            let actual = effective.get(source).and_then(Value::as_str);
            // Private control may already have scrubbed the exact current key. Another
            // source using the same variable name must not pass this check.
            ensure!(
                actual == Some(key.as_str())
                    || actual == Some("[redacted]")
                    // Shell-only values are absent from get_settings. The private
                    // status row below must still identify this injected variable.
                    || actual.is_none()
                        && matches!(
                            snapshot.credential_source,
                            super::native::CredentialSource::Environment { .. }
                        ),
                "Claude Code 原生设置覆盖了当前 Key；未继续使用其他凭据。"
            );
        }
        let selected = row("Auth token").or_else(|| row("API key"));
        ensure!(
            selected == Some(source)
                || matches!(
                    snapshot.credential_source,
                    super::native::CredentialSource::Helper { .. }
                ) && selected == Some("apiKeyHelper"),
            "Claude Code 未使用当前原生 API 凭据来源；请检查认证或组织策略冲突。"
        );
        ensure!(
            row("Anthropic base URL") == Some(base_url.as_str()),
            "Claude Code 的实际接口地址与本次配置不一致。"
        );
    } else {
        ensure!(
            row("Auth token").is_none()
                && row("API key").is_none()
                && row("Anthropic base URL").is_none(),
            "Claude Code 官方登录仍被自定义接口或凭据覆盖。"
        );
    }
    let model = explicit.or_else(|| snapshot.configuration.default_model());
    let expected = match model {
        Some("haiku") if snapshot.configuration.enabled() => {
            (!models.haiku_model.is_empty()).then_some(models.haiku_model.as_str())
        }
        Some("sonnet") if snapshot.configuration.enabled() => {
            (!models.sonnet_model.is_empty()).then_some(models.sonnet_model.as_str())
        }
        Some("opus") if snapshot.configuration.enabled() => {
            (!models.opus_model.is_empty()).then_some(models.opus_model.as_str())
        }
        // Native compound aliases remain runtime-owned.
        Some("haiku" | "sonnet" | "opus" | "default" | "opusplan" | "sonnet[1m]" | "opus[1m]") => {
            None
        }
        id => id,
    };
    if let Some(expected) = expected {
        ensure!(
            settings.pointer("/applied/model").and_then(Value::as_str) == Some(expected),
            "Claude Code 的实际模型与本次选择不一致，请检查原生模型映射。"
        );
    }
    Ok(())
}

// Reuse existing native headers without copying their values to a derived settings file.
fn native_headers(snapshot: &CustomApiSnapshot) -> Result<String> {
    let settings = super::native::read_json(&snapshot.context.path())?;
    let headers = settings
        .pointer("/env/ANTHROPIC_CUSTOM_HEADERS")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| snapshot.context.env("ANTHROPIC_CUSTOM_HEADERS"))
        .unwrap_or_default();
    let key = snapshot.key()?;
    for line in headers.lines().filter(|line| !line.trim().is_empty()) {
        let (name, value) = line
            .split_once(':')
            .context("Claude Code 原生请求头格式无效，请在原生来源处理。")?;
        if matches!(
            name.trim().to_ascii_lowercase().as_str(),
            "authorization" | "x-api-key" | "api-key" | "proxy-authorization"
        ) {
            ensure!(
                key.as_ref().is_some_and(
                    |key| value.trim() == key || value.trim() == format!("Bearer {key}")
                ),
                "Claude Code 原生认证请求头与当前 Key 不一致；请在该来源解决冲突，未尝试备用凭据。"
            );
        }
    }
    Ok(headers)
}
