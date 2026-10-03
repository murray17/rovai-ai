//! Native catalog adaptation, qualified against Codex 0.159.2.
//! Known metadata is read from the selected executable, never another installation/cache.
use super::{CustomApiConfiguration, CustomApiSnapshot};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::path::Path;
use tokio::process::Command;

const CATALOG_MARKER: &[u8] = b"{\n  \"models\": [";
// Exact embedded resource in upstream rust-v0.159.2, excluding its trailing newline.
const CATALOG_SHA256: &str = "719c75b77ed02c783263f8fe62532ecd0abc1d1ccf2c34b12e5d221d509995a1";
const BASE_INSTRUCTIONS: &str = include_str!("codex-0.159.2-prompt.txt");

fn embedded_catalog(executable: &Path) -> Result<Value> {
    super::native_resource::embedded_json(
        executable,
        CATALOG_MARKER,
        CATALOG_SHA256,
        "Codex 0.159.2",
    )
}

/// Mirrors models-manager/src/model_info.rs::model_info_from_slug at rust-v0.159.2.
/// These are native compatibility defaults, not claims about a relay's capabilities.
fn fallback_model(id: &str) -> Value {
    let mut model = json!({
        "slug": id, "display_name": id, "description": null,
        "default_reasoning_level": null, "supported_reasoning_levels": [],
        "shell_type": "unified_exec", "visibility": "none", "supported_in_api": true,
        "priority": 99, "additional_speed_tiers": [], "service_tiers": [],
        "default_service_tier": null, "available_access_programs": null,
        "availability_nux": null, "upgrade": null,
        "model_messages": {"instructions_template": BASE_INSTRUCTIONS},
        "include_skills_usage_instructions": false, "include_plugin_usage_instructions": false,
        "include_apps_usage_instructions": false, "supports_reasoning_summary_parameter": true,
        "default_reasoning_summary": "auto", "support_verbosity": false, "default_verbosity": null,
        "apply_patch_tool_type": null, "web_search_tool_type": "text",
        "truncation_policy": {"mode": "bytes", "limit": 10000}, "supports_image_detail_original": false
    });
    model.as_object_mut().expect("native fallback is an object").extend(json!({
        "context_window": 272000, "max_context_window": 272000,
        "auto_compact_token_limit": null, "comp_hash": null, "effective_context_window_percent": 95,
        "experimental_supported_tools": [], "input_modalities": ["text", "image"],
        "supports_search_tool": false, "supports_experimental_context": false,
        "use_responses_lite": false, "supports_reasoning_effort_updates": false,
        "guardian": null, "node_repl_auto_review_required": false, "node_repl_disabled": false,
        "auto_review_model_override": null, "model_specialty": null,
        "tool_mode": null, "multi_agent_version": null, "multi_agent_reasoning_effort": null
    }).as_object().expect("native fallback is an object").clone());
    model
}

fn adapt_catalog(mut catalog: Value, configuration: &CustomApiConfiguration) -> Result<Value> {
    let CustomApiConfiguration::Codex {
        models,
        default_model,
        ..
    } = configuration
    else {
        anyhow::bail!("Codex 自定义 API 类型不匹配。");
    };
    let native = catalog
        .get_mut("models")
        .and_then(Value::as_array_mut)
        .context("Codex 原生目录缺少模型数组。")?;
    let original = native.clone();
    // Keep all native internal entries, but expose only the user's configured models.
    for item in native.iter_mut() {
        item["visibility"] = json!("hide");
    }
    for (index, model) in models.iter().enumerate() {
        let mut item = original
            .iter()
            .find(|item| item["slug"].as_str() == Some(&model.id))
            .cloned()
            .unwrap_or_else(|| fallback_model(&model.id));
        item["visibility"] = json!("list");
        item["priority"] = json!(if &model.id == default_model {
            0
        } else {
            index + 1
        });
        item["display_name"] = json!(if model.display_name.is_empty() {
            &model.id
        } else {
            &model.display_name
        });
        // A configured model must not advertise an unconfigured upgrade target in the picker.
        item["upgrade"] = Value::Null;
        if let Some(existing) = native
            .iter_mut()
            .find(|entry| entry["slug"] == item["slug"])
        {
            *existing = item;
        } else {
            native.push(item);
        }
    }
    Ok(catalog)
}

pub fn generate(executable: &Path, configuration: &CustomApiConfiguration) -> Result<Value> {
    adapt_catalog(embedded_catalog(executable)?, configuration)
}

pub fn execution_provider(snapshot: &CustomApiSnapshot) -> Result<String> {
    if !snapshot.configuration.enabled() {
        return Ok("openai".into());
    }
    if matches!(
        snapshot.credential_source,
        super::native::CredentialSource::NativeManaged { .. }
    ) {
        return Ok(snapshot.provider_id.clone());
    }
    let identity = snapshot.identity()?;
    Ok(format!(
        "rovai_custom_{}",
        identity
            .trim_start_matches("sha256:")
            .chars()
            .take(16)
            .collect::<String>()
    ))
}
pub fn configure(snapshot: &CustomApiSnapshot, command: &mut Command) -> Result<()> {
    snapshot.assert_current()?;
    let CustomApiConfiguration::Codex {
        base_url,
        default_model,
        ..
    } = &snapshot.configuration
    else {
        anyhow::bail!("Codex 连接类型不匹配。");
    };
    let native_config = super::native::read_toml(&snapshot.context.path())?;
    let managed_store = matches!(
        native_config
            .get("cli_auth_credentials_store")
            .and_then(toml_edit::Item::as_str),
        Some("keyring" | "auto")
    );
    let auth = if managed_store {
        json!({})
    } else {
        super::native::read_json(&snapshot.context.directory.join("auth.json"))?
    };
    let forced = native_config
        .get("forced_login_method")
        .and_then(toml_edit::Item::as_str);
    ensure!(
        !(forced == Some("chatgpt")
            && auth["OPENAI_API_KEY"]
                .as_str()
                .is_some_and(|v| !v.is_empty()))
            && !(forced == Some("api") && auth["tokens"].is_object()),
        "Codex 登录方式约束与原生凭据冲突；已停止启动以避免原生 CLI 清除凭据，请在原生来源处理。"
    );
    let mut overrides = Vec::new();
    let provider = execution_provider(snapshot)?;
    overrides.push(("model_provider".to_string(), json!(provider)));
    if snapshot.configuration.enabled() {
        let opaque = matches!(
            snapshot.credential_source,
            super::native::CredentialSource::NativeManaged { .. }
        );
        if !opaque {
            ensure!(
                snapshot.key()?.is_some(),
                "当前 API 连接缺少可复用凭据，请填写 Key 或修复原生凭据引用。"
            );
            snapshot.configure_environment(command)?;
            let (headers, values) = native_headers(snapshot)?;
            command.envs(values);
            let mut provider_config = json!({"name":"Rovai custom API", "base_url":base_url, "env_key":"ROVAI_CUSTOM_API_KEY", "wire_api":"responses", "requires_openai_auth":false});
            if !headers.is_empty() {
                provider_config["env_http_headers"] = json!(headers);
            }
            overrides.push((format!("model_providers.{provider}"), provider_config));
        } else if provider == "openai" {
            // Built-in providers do not appear in model_providers; their endpoint
            // override is a root setting, while credentials remain native-owned.
            overrides.push(("openai_base_url".into(), json!(base_url)));
        }
        if !default_model.is_empty() {
            overrides.push(("model".into(), json!(default_model)));
        }
        // An unchanged native catalog remains authoritative. Generation occurs only for an edited draft.
        let current = super::native::read(&snapshot.context, snapshot.configuration.mode())?;
        if current.configuration != snapshot.configuration {
            let catalog = generate(
                Path::new(command.as_std().get_program()),
                &snapshot.configuration,
            )?;
            let path =
                snapshot.write_artifact("codex-catalog.json", &serde_json::to_vec(&catalog)?)?;
            overrides.push(("model_catalog_json".into(), json!(path)));
        }
    } else {
        // forced_login_method can delete incompatible auth.json. Never invoke it for switching.
        ensure!(
            auth["OPENAI_API_KEY"].as_str().is_none_or(str::is_empty),
            "Codex 原生认证文件仍使用 API Key，此版本无法在不改写该凭据的情况下切到官方登录。请先在原生配置中处理认证来源；Rovai 未删除登录信息。"
        );
        for name in [
            "OPENAI_API_KEY",
            "CODEX_API_KEY",
            "CODEX_ACCESS_TOKEN",
            "OPENAI_BASE_URL",
        ] {
            command.env_remove(name);
        }
        overrides.push((
            "openai_base_url".into(),
            json!("https://chatgpt.com/backend-api/codex"),
        ));
        let native = super::native::read(&snapshot.context, snapshot.configuration.mode())?;
        if native.observation.initial_mode == Some(super::ConnectionMode::CustomApi) {
            let catalog = embedded_catalog(Path::new(command.as_std().get_program()))?;
            let model = catalog["models"]
                .as_array()
                .and_then(|models| {
                    models
                        .iter()
                        .filter(|model| model["visibility"] == "list")
                        .min_by_key(|model| model["priority"].as_i64().unwrap_or(i64::MAX))
                })
                .and_then(|model| model["slug"].as_str())
                .context("原生目录没有可用默认模型。")?;
            let path = snapshot.write_artifact(
                "codex-official-catalog.json",
                &serde_json::to_vec(&catalog)?,
            )?;
            overrides.push(("model_catalog_json".into(), json!(path)));
            overrides.push(("model".into(), json!(model)));
        }
    }
    for (key, value) in overrides {
        command
            .arg("-c")
            .arg(format!("{key}={}", toml_value(&value)?));
    }
    Ok(())
}

/// config/read is local native state, not a request to the configured API.
pub fn validate_effective(snapshot: &CustomApiSnapshot, response: &Value) -> Result<()> {
    let config = response.get("config").context("Codex 未报告最终配置。")?;
    let provider_id = execution_provider(snapshot)?;
    ensure!(
        config["model_provider"].as_str() == Some(provider_id.as_str()),
        "Codex 的有效连接被原生设置或组织策略覆盖。"
    );
    if !snapshot.configuration.enabled() {
        ensure!(
            config["openai_base_url"] == "https://chatgpt.com/backend-api/codex",
            "Codex 官方登录端点仍被其他配置覆盖。"
        );
        return Ok(());
    }
    let provider = &config["model_providers"][&provider_id];
    if provider_id == "openai" {
        ensure!(
            config["openai_base_url"].as_str() == Some(snapshot.configuration.base_url()),
            "Codex 的有效接口地址与当前原生连接不一致。"
        );
        return Ok(());
    }
    ensure!(
        provider["base_url"].as_str() == Some(snapshot.configuration.base_url())
            && provider["wire_api"] == "responses",
        "Codex 的有效接口或 Responses 协议与本次配置不一致。"
    );
    if !matches!(
        snapshot.credential_source,
        super::native::CredentialSource::NativeManaged { .. }
    ) {
        ensure!(
            provider["env_key"] == "ROVAI_CUSTOM_API_KEY"
                && provider["requires_openai_auth"] == false,
            "Codex 的认证引用与本次配置不一致。"
        );
        let (headers, _) = native_headers(snapshot)?;
        ensure!(
            if headers.is_empty() {
                provider["env_http_headers"].is_null()
                    || provider["env_http_headers"]
                        .as_object()
                        .is_some_and(|v| v.is_empty())
            } else {
                provider["env_http_headers"] == json!(headers)
            },
            "Codex 原生请求头引用与当前连接不一致。"
        );
        for name in [
            "experimental_bearer_token",
            "http_headers",
            "api_key",
            "aws_auth",
            "gateway",
        ] {
            let value = &provider[name];
            ensure!(
                value.is_null()
                    || value.as_str() == Some("")
                    || value.as_object().is_some_and(|v| v.is_empty()),
                "Codex 原生连接仍包含优先认证字段 {}，请解决配置冲突。",
                name
            );
        }
    }
    Ok(())
}

/// Preserve current provider headers without putting literal header values into argv or derived files.
fn native_headers(
    snapshot: &CustomApiSnapshot,
) -> Result<(
    std::collections::BTreeMap<String, String>,
    std::collections::BTreeMap<String, String>,
)> {
    let mut headers = std::collections::BTreeMap::new();
    let mut environment = std::collections::BTreeMap::new();
    let doc = super::native::read_toml(&snapshot.context.path())?;
    let Some(provider) = doc
        .get("model_providers")
        .and_then(|p| p.get(&snapshot.provider_id))
        .and_then(toml_edit::Item::as_table_like)
    else {
        return Ok((headers, environment));
    };
    let mut values = std::collections::BTreeMap::new();
    for field in ["http_headers", "env_http_headers"] {
        if let Some(table) = provider.get(field).and_then(toml_edit::Item::as_table_like) {
            for (name, item) in table.iter() {
                if let Some(value) = item.as_str().and_then(|v| {
                    if field == "env_http_headers" {
                        snapshot.context.env(v)
                    } else {
                        Some(v.to_owned())
                    }
                }) {
                    values.insert(name.to_owned(), value);
                }
            }
        }
    }
    let key = snapshot.key()?;
    for (index, (name, value)) in values.into_iter().enumerate() {
        if matches!(
            name.to_ascii_lowercase().as_str(),
            "authorization" | "x-api-key" | "api-key" | "proxy-authorization"
        ) {
            ensure!(
                key.as_ref()
                    .is_some_and(|key| value == *key || value == format!("Bearer {key}")),
                "原生 provider 的认证请求头与当前 Key 不一致；请在该原生来源解决冲突，未尝试备用凭据。"
            );
        }
        let variable = format!("ROVAI_CUSTOM_HEADER_{index}");
        headers.insert(name, variable.clone());
        environment.insert(variable, value);
    }
    Ok((headers, environment))
}

pub fn requires_account_check(snapshot: &CustomApiSnapshot) -> bool {
    !snapshot.configuration.enabled()
        || matches!(
            snapshot.credential_source,
            super::native::CredentialSource::NativeManaged { .. }
        )
}
/// Local account metadata only; no token refresh, HTTP probe or credential extraction.
pub fn validate_account(snapshot: &CustomApiSnapshot, account: &Value) -> Result<()> {
    if snapshot.configuration.enabled() {
        ensure!(
            matches!(
                account.pointer("/account/type").and_then(Value::as_str),
                Some("apiKey" | "chatgpt")
            ),
            "当前原生凭据来源不可用；请修复该来源或为此连接输入新 Key，未尝试备用账号。"
        );
    } else {
        ensure!(
            account.pointer("/account/type").and_then(Value::as_str) == Some("chatgpt"),
            "尚未使用 ChatGPT 登录。请在本机终端运行 codex login，按提示完成登录；未使用其他 Key。"
        );
    }
    Ok(())
}

fn toml_value(value: &Value) -> Result<String> {
    match value {
        Value::String(value) => Ok(serde_json::to_string(value)?),
        Value::Bool(value) => Ok(value.to_string()),
        Value::Object(values) => Ok(format!(
            "{{{}}}",
            values
                .iter()
                .map(|(key, value)| Ok(format!(
                    "{} = {}",
                    serde_json::to_string(key)?,
                    toml_value(value)?
                )))
                .collect::<Result<Vec<_>>>()?
                .join(", ")
        )),
        _ => anyhow::bail!("Codex 连接配置包含不支持的值。"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_catalog_preserves_internal_entries_and_unknown_ids_use_only_native_defaults() {
        let config = CustomApiConfiguration::Codex {
            mode: Some(super::super::ConnectionMode::CustomApi),
            base_url: "https://relay.example/prefix".into(),
            models: vec![
                super::super::CustomApiModel {
                    row_id: "one".into(),
                    id: "known".into(),
                    display_name: "Developer".into(),
                },
                super::super::CustomApiModel {
                    row_id: "two".into(),
                    id: "known-but-unknown-suffix".into(),
                    display_name: String::new(),
                },
            ],
            default_row_id: Some("two".into()),
            default_model: "known-but-unknown-suffix".into(),
        };
        let mut known = fallback_model("known");
        known["context_window"] = json!(123456);
        known["supports_search_tool"] = json!(true);
        let native = json!({"models":[known, fallback_model("native-internal")]});
        let catalog = adapt_catalog(native, &config).unwrap();
        let models = catalog["models"].as_array().unwrap();
        assert_eq!(models.len(), 3);
        assert_eq!(models[0]["context_window"], 123456);
        assert_eq!(models[0]["display_name"], "Developer");
        assert_eq!(models[1]["slug"], "native-internal");
        assert_eq!(models[1]["visibility"], "hide");
        assert_eq!(models[2]["supports_search_tool"], false);
        assert_eq!(models[2]["context_window"], 272000);
        assert_eq!(models[2]["priority"], 0);
        assert_eq!(models[2]["display_name"], "known-but-unknown-suffix");
        assert!(
            adapt_catalog(json!({"data":[]}), &config).is_err(),
            "model/list is not a full native catalog"
        );
        let provider = json!({"name":"Rovai custom API", "base_url":"https://relay.example/a?b=quoted", "env_key":"ROVAI_CUSTOM_API_KEY", "wire_api":"responses", "requires_openai_auth":false});
        let encoded = toml_value(&provider).unwrap();
        let parsed: toml::Value = toml::from_str(&format!("provider={encoded}")).unwrap();
        assert_eq!(
            parsed["provider"]["base_url"].as_str(),
            Some("https://relay.example/a?b=quoted")
        );
        let snapshot = CustomApiSnapshot {
            configuration: config,
            native_revision: "fixture".into(),
            credential_version: "fixture".into(),
            provider_id: "native".into(),
            explicit_mode: true,
            draft_key: None,
            preview: false,
            credential_source: super::super::native::CredentialSource::Missing,
            context: super::super::native::NativeContext {
                kind: crate::agent_profile::AdapterKind::CodexCli,
                directory: "/not-read".into(),
                artifact_root: "/not-read".into(),
                environment: Default::default(),
            },
        };
        let id = execution_provider(&snapshot).unwrap();
        let mut effective =
            json!({"config":{"model_provider":id,"model_providers":{&id:provider}}});
        effective["config"]["model_providers"][&id]["base_url"] =
            json!("https://relay.example/prefix");
        validate_effective(&snapshot, &effective).unwrap();
        for field in ["experimental_bearer_token", "http_headers"] {
            let mut conflict = effective.clone();
            conflict["config"]["model_providers"][&id][field] = json!("old-secret");
            let error = validate_effective(&snapshot, &conflict)
                .unwrap_err()
                .to_string();
            assert!(!error.contains("old-secret"));
        }
        effective["config"]["model_provider"] = json!("old-provider");
        assert!(validate_effective(&snapshot, &effective).is_err());
    }
}
