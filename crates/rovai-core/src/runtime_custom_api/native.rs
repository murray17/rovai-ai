//! The native files remain authoritative. Projection contains references and digests, never keys.
use super::{
    ClaudeApiModels, ConnectionMode, ConnectionObservation, CustomApiConfiguration, CustomApiModel,
    CustomApiSnapshot, NativeCredential,
};
use crate::{
    agent_profile::AdapterKind, command::canonical_json_digest,
    runtime_startup::RuntimeStartupConfiguration,
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeContext {
    pub kind: AdapterKind,
    pub directory: PathBuf,
    pub artifact_root: PathBuf,
    #[serde(skip)]
    pub environment: BTreeMap<String, String>,
}
impl std::fmt::Debug for NativeContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeContext")
            .field("kind", &self.kind)
            .finish_non_exhaustive()
    }
}
impl NativeContext {
    pub fn resolve(
        kind: AdapterKind,
        configuration: &RuntimeStartupConfiguration,
        database: &Path,
    ) -> Result<Self> {
        #[cfg(not(test))]
        let mut environment: BTreeMap<String, String> = std::env::vars().collect();
        // Library fixtures never inspect a developer's native credentials.
        #[cfg(test)]
        let mut environment: BTreeMap<String, String> = BTreeMap::from([(
            if cfg!(windows) { "USERPROFILE" } else { "HOME" }.into(),
            database
                .parent()
                .unwrap_or(Path::new("/tmp"))
                .join("isolated-native-home")
                .to_string_lossy()
                .into_owned(),
        )]);
        for entry in &configuration.environment {
            environment.insert(entry.name.clone(), entry.value.clone());
        }
        let name = if kind == AdapterKind::ClaudeCodeCli {
            "CLAUDE_CONFIG_DIR"
        } else {
            "CODEX_HOME"
        };
        let directory = if let Some(value) = environment.get(name).filter(|value| !value.is_empty())
        {
            PathBuf::from(value)
        } else {
            let home = environment
                .get(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                .map(PathBuf::from)
                .or_else(dirs::home_dir)
                .ok_or_else(|| anyhow::anyhow!("无法确定本机原生配置目录。"))?;
            home.join(if kind == AdapterKind::ClaudeCodeCli {
                ".claude"
            } else {
                ".codex"
            })
        };
        ensure!(
            directory.is_absolute(),
            "原生配置目录必须是绝对路径，请检查 {}。",
            name
        );
        Ok(Self {
            kind,
            directory,
            artifact_root: super::storage_root(database, kind)?,
            environment,
        })
    }
    pub fn path(&self) -> PathBuf {
        self.directory
            .join(if self.kind == AdapterKind::ClaudeCodeCli {
                "settings.json"
            } else {
                "config.toml"
            })
    }
    pub fn env(&self, name: &str) -> Option<String> {
        if self.environment.is_empty() {
            crate::runtime_discovery::runtime_environment_variable(self.kind, name)
                .map(|v| v.to_string_lossy().into_owned())
        } else {
            self.environment.get(name).cloned()
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum CredentialSource {
    Missing,
    Environment {
        name: String,
    },
    Json {
        path: PathBuf,
        pointer: String,
        variable: String,
    },
    Toml {
        path: PathBuf,
        keys: Vec<String>,
    },
    Helper {
        path: PathBuf,
    },
    NativeManaged {
        directory: PathBuf,
    },
}
impl CredentialSource {
    pub fn claude_variable(&self) -> &str {
        match self {
            Self::Environment { name } => name,
            Self::Json { variable, .. } => variable,
            _ => "ANTHROPIC_AUTH_TOKEN",
        }
    }
}
pub struct NativeRead {
    pub configuration: CustomApiConfiguration,
    pub credential: NativeCredential,
    pub observation: ConnectionObservation,
    pub revision: String,
    pub source: CredentialSource,
    pub provider_id: String,
    pub catalog_path: Option<PathBuf>,
}
impl NativeRead {
    pub fn snapshot(&self, context: &NativeContext, explicit_mode: bool) -> CustomApiSnapshot {
        CustomApiSnapshot {
            configuration: self.configuration.clone(),
            context: context.clone(),
            native_revision: self.revision.clone(),
            credential_version: self.credential.version.clone(),
            credential_source: self.source.clone(),
            provider_id: self.provider_id.clone(),
            explicit_mode,
            draft_key: None,
            preview: false,
        }
    }
}
pub fn supported(kind: AdapterKind) -> bool {
    matches!(kind, AdapterKind::ClaudeCodeCli | AdapterKind::CodexCli)
}
pub fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>> {
    match std::fs::metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => anyhow::bail!("无法读取原生配置，请检查文件权限：{}", path.display()),
        Ok(metadata) => {
            ensure!(
                metadata.is_file() && metadata.len() <= 16 * 1024 * 1024,
                "原生配置文件无效或过大：{}",
                path.display()
            );
            std::fs::read(path)
                .map(Some)
                .map_err(|_| anyhow::anyhow!("无法读取原生配置：{}", path.display()))
        }
    }
}
pub fn read_json(path: &Path) -> Result<Value> {
    read_bytes(path)?
        .map(|bytes| {
            serde_json::from_slice(&bytes)
                .map_err(|_| anyhow::anyhow!("原生 JSON 配置无法解析：{}", path.display()))
        })
        .unwrap_or_else(|| Ok(json!({})))
}
pub fn read_toml(path: &Path) -> Result<toml_edit::DocumentMut> {
    let bytes = read_bytes(path)?.unwrap_or_default();
    let text =
        std::str::from_utf8(&bytes).map_err(|_| anyhow::anyhow!("原生 TOML 配置不是 UTF-8。"))?;
    text.parse()
        .map_err(|_| anyhow::anyhow!("原生 TOML 配置无法解析：{}", path.display()))
}
fn toml_value(path: &Path, keys: &[String]) -> Result<Option<String>> {
    let doc = read_toml(path)?;
    let mut item = doc.as_item();
    for key in keys {
        let Some(next) = item.get(key) else {
            return Ok(None);
        };
        item = next;
    }
    Ok(item.as_str().filter(|v| !v.is_empty()).map(str::to_owned))
}
pub fn credential_value(
    source: &CredentialSource,
    context: &NativeContext,
) -> Result<(Option<String>, String)> {
    let (value, evidence) = match source {
        CredentialSource::Missing => (None, Value::Null),
        CredentialSource::Environment { name } => {
            (context.env(name).filter(|v| !v.is_empty()), json!(name))
        }
        CredentialSource::Json { path, pointer, .. } => (
            read_json(path)?
                .pointer(pointer)
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
                .map(str::to_owned),
            json!([path, pointer]),
        ),
        CredentialSource::Toml { path, keys } => (toml_value(path, keys)?, json!([path, keys])),
        CredentialSource::Helper { path } => (
            None,
            read_json(path)?
                .get("apiKeyHelper")
                .cloned()
                .unwrap_or_default(),
        ),
        // Native managed credentials are deliberately opaque; the native runtime performs authentication.
        CredentialSource::NativeManaged { directory } => (None, json!(directory)),
    };
    let version =
        canonical_json_digest(&json!({"source": source, "value": value, "evidence": evidence}))?;
    Ok((value, version))
}
pub fn claude_models(models: &ClaudeApiModels) -> [(&'static str, &str); 5] {
    [
        ("ANTHROPIC_MODEL", &models.model),
        ("ANTHROPIC_REASONING_MODEL", &models.reasoning_model),
        ("ANTHROPIC_DEFAULT_HAIKU_MODEL", &models.haiku_model),
        ("ANTHROPIC_DEFAULT_SONNET_MODEL", &models.sonnet_model),
        ("ANTHROPIC_DEFAULT_OPUS_MODEL", &models.opus_model),
    ]
}
fn credential(context: &NativeContext, source: &CredentialSource) -> Result<NativeCredential> {
    let (value, version) = credential_value(source, context)?;
    let available = value.is_some()
        || matches!(
            source,
            CredentialSource::Helper { .. } | CredentialSource::NativeManaged { .. }
        );
    let (kind, label, writable) = match source {
        CredentialSource::Missing => ("native_file", "未配置".into(), true),
        CredentialSource::Environment { name } => {
            ("environment_reference", format!("环境变量 {name}"), false)
        }
        CredentialSource::Json { path, .. } | CredentialSource::Toml { path, .. } => {
            ("native_file", path.display().to_string(), true)
        }
        CredentialSource::Helper { path } => (
            "native_managed",
            format!("{} 的 apiKeyHelper", path.display()),
            true,
        ),
        CredentialSource::NativeManaged { .. } => {
            ("native_managed", "Codex 原生凭据管理".into(), false)
        }
    };
    Ok(NativeCredential {
        status: if available {
            "available"
        } else if matches!(source, CredentialSource::Missing) {
            "missing"
        } else {
            "invalid_reference"
        }
        .into(),
        source: kind.into(),
        source_label: label,
        version,
        source_writable: writable,
        can_replace: true,
        can_clear: writable,
        restriction: None,
        remedy: (!writable)
            .then(|| "可输入新 Key 并保存到原生连接；清除原有引用请在该来源操作。".into()),
    })
}
pub fn read(context: &NativeContext, selected: Option<ConnectionMode>) -> Result<NativeRead> {
    ensure!(supported(context.kind), "此智能体没有原生连接编辑入口。");
    let path = context.path();
    let (
        mut configuration,
        source,
        initial_mode,
        login_status,
        provider_id,
        catalog_path,
        evidence,
    ) = if context.kind == AdapterKind::ClaudeCodeCli {
        let settings = read_json(&path)?;
        ensure!(
            settings.is_object(),
            "Claude Code 原生设置必须是 JSON 对象。"
        );
        let get = |name: &str| {
            settings
                .get("env")
                .and_then(|e| e.get(name))
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| context.env(name))
                .unwrap_or_default()
        };
        let mut source = CredentialSource::Missing;
        for name in ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"] {
            if !get(name).is_empty() {
                source = if settings.get("env").and_then(|e| e.get(name)).is_some() {
                    CredentialSource::Json {
                        path: path.clone(),
                        pointer: format!("/env/{name}"),
                        variable: name.into(),
                    }
                } else {
                    CredentialSource::Environment { name: name.into() }
                };
                break;
            }
        }
        if matches!(source, CredentialSource::Missing)
            && settings["apiKeyHelper"]
                .as_str()
                .is_some_and(|v| !v.is_empty())
        {
            source = CredentialSource::Helper { path: path.clone() };
        }
        let base_url = get("ANTHROPIC_BASE_URL");
        let native_api = !base_url.is_empty() || !matches!(source, CredentialSource::Missing);
        let login = read_json(&context.directory.join(".credentials.json"))?;
        let login_status = if login["claudeAiOauth"]["accessToken"]
            .as_str()
            .is_some_and(|v| !v.is_empty())
        {
            "signed_in"
        } else {
            "unknown"
        };
        let models = ClaudeApiModels {
            model: get("ANTHROPIC_MODEL"),
            reasoning_model: get("ANTHROPIC_REASONING_MODEL"),
            haiku_model: get("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
            sonnet_model: get("ANTHROPIC_DEFAULT_SONNET_MODEL"),
            opus_model: get("ANTHROPIC_DEFAULT_OPUS_MODEL"),
        };
        let initial = native_api
            .then_some(ConnectionMode::CustomApi)
            .or_else(|| (login_status == "signed_in").then_some(ConnectionMode::OfficialLogin));
        let config = CustomApiConfiguration::ClaudeCode {
            mode: selected.or(initial),
            base_url: if native_api && base_url.is_empty() {
                "https://api.anthropic.com".into()
            } else {
                base_url
            },
            models,
        };
        (
            config,
            source,
            initial,
            login_status,
            String::new(),
            None,
            settings,
        )
    } else {
        let text = read_bytes(&path)?.unwrap_or_default();
        let doc: toml::Value = toml::from_str(
            std::str::from_utf8(&text).map_err(|_| anyhow::anyhow!("Codex 配置不是 UTF-8。"))?,
        )
        .map_err(|_| anyhow::anyhow!("Codex 原生配置无法解析。"))?;
        let profile = doc
            .get("profile")
            .and_then(toml::Value::as_str)
            .and_then(|name| doc.get("profiles").and_then(|v| v.get(name)));
        let get = |name: &str| profile.and_then(|p| p.get(name)).or_else(|| doc.get(name));
        let provider_id = get("model_provider")
            .and_then(toml::Value::as_str)
            .unwrap_or("openai")
            .to_owned();
        let provider = doc.get("model_providers").and_then(|p| p.get(&provider_id));
        let ps = |name: &str| {
            provider
                .and_then(|p| p.get(name))
                .and_then(toml::Value::as_str)
                .unwrap_or("")
                .to_owned()
        };
        let mut base_url = ps("base_url");
        if provider_id == "openai" {
            base_url = get("openai_base_url")
                .and_then(toml::Value::as_str)
                .map(str::to_owned)
                .or_else(|| context.env("OPENAI_BASE_URL"))
                .unwrap_or_default();
        }
        let auth_path = context.directory.join("auth.json");
        let store = get("cli_auth_credentials_store")
            .and_then(toml::Value::as_str)
            .unwrap_or("file");
        let managed_store = matches!(store, "keyring" | "auto");
        // A file left by a former storage mode is not the active credential source.
        let auth = if managed_store {
            json!({})
        } else {
            read_json(&auth_path)?
        };
        let native_login = provider_id == "openai"
            || provider
                .and_then(|p| p.get("requires_openai_auth"))
                .and_then(toml::Value::as_bool)
                == Some(true);
        let mut source = CredentialSource::Missing;
        if !ps("env_key").is_empty() {
            source = if ps("env_key") == "ROVAI_UNCONFIGURED_API_KEY" {
                CredentialSource::Missing
            } else {
                CredentialSource::Environment {
                    name: ps("env_key"),
                }
            };
        } else if !ps("experimental_bearer_token").is_empty() {
            source = CredentialSource::Toml {
                path: path.clone(),
                keys: vec![
                    "model_providers".into(),
                    provider_id.clone(),
                    "experimental_bearer_token".into(),
                ],
            };
        } else if native_login && context.env("OPENAI_API_KEY").is_some_and(|v| !v.is_empty()) {
            source = CredentialSource::Environment {
                name: "OPENAI_API_KEY".into(),
            };
        } else if native_login
            && !managed_store
            && auth["auth_mode"] != "chatgpt"
            && auth["OPENAI_API_KEY"]
                .as_str()
                .is_some_and(|v| !v.is_empty())
        {
            source = CredentialSource::Json {
                path: auth_path,
                pointer: "/OPENAI_API_KEY".into(),
                variable: "OPENAI_API_KEY".into(),
            };
        } else if native_login
            && (managed_store
                || auth["tokens"]["access_token"]
                    .as_str()
                    .is_some_and(|v| !v.is_empty()))
        {
            source = CredentialSource::NativeManaged {
                directory: context.directory.clone(),
            };
        }
        let has_token = auth["tokens"]["access_token"]
            .as_str()
            .is_some_and(|v| !v.is_empty());
        let login_status = if has_token {
            "signed_in"
        } else if matches!(source, CredentialSource::NativeManaged { .. }) {
            "unknown"
        } else {
            "signed_out"
        };
        let native_api = provider_id != "openai"
            || !base_url.is_empty()
            || !matches!(
                source,
                CredentialSource::Missing | CredentialSource::NativeManaged { .. }
            );
        // An official OAuth login alone is not a reusable API credential. Keep
        // its login status, but never offer it as the key for a newly entered URL.
        if !native_api && has_token {
            source = CredentialSource::Missing;
        }
        let default_model = get("model")
            .and_then(toml::Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let catalog_path = get("model_catalog_json")
            .and_then(toml::Value::as_str)
            .map(PathBuf::from)
            .map(|p| {
                if p.is_absolute() {
                    p
                } else {
                    context.directory.join(p)
                }
            });
        let mut models = Vec::new();
        let catalog = catalog_path.as_ref().map(|p| read_json(p)).transpose()?;
        if let Some(catalog) = &catalog {
            let entries = catalog["models"]
                .as_array()
                .ok_or_else(|| anyhow::anyhow!("Codex model_catalog_json 不是完整原生目录。"))?;
            for entry in entries.iter().filter(|e| e["visibility"] == "list") {
                if let Some(id) = entry["slug"].as_str() {
                    models.push(CustomApiModel {
                        row_id: row_id(id)?,
                        id: id.into(),
                        display_name: entry["display_name"].as_str().unwrap_or_default().into(),
                    });
                }
            }
        }
        if !default_model.is_empty() && !models.iter().any(|m| m.id == default_model) {
            models.insert(
                0,
                CustomApiModel {
                    row_id: row_id(&default_model)?,
                    id: default_model.clone(),
                    display_name: String::new(),
                },
            );
        }
        let default_row_id = models
            .iter()
            .find(|m| m.id == default_model)
            .map(|m| m.row_id.clone());
        let initial = if native_api {
            Some(ConnectionMode::CustomApi)
        } else if has_token {
            Some(ConnectionMode::OfficialLogin)
        } else {
            None
        };
        let configuration = CustomApiConfiguration::Codex {
            mode: selected.or(initial),
            base_url: if native_api && base_url.is_empty() {
                "https://api.openai.com/v1".into()
            } else {
                base_url
            },
            models,
            default_model,
            default_row_id,
        };
        (
            configuration,
            source,
            initial,
            login_status,
            provider_id,
            catalog_path,
            json!({"config": doc, "catalog": catalog, "auth": auth}),
        )
    };
    // Mode is metadata, independent of credentials. No read writes files or imports a key.
    if let Some(mode) = selected {
        configuration.set_mode(Some(mode));
    }
    if let Ok(url) = url::Url::parse(configuration.base_url()) {
        ensure!(
            url.username().is_empty() && url.password().is_none(),
            "原生接口地址含账号或密码，无法安全回显；请在该原生来源改为独立凭据后重试。"
        );
    }
    let credential = credential(context, &source)?;
    let revision = canonical_json_digest(
        &json!({"configuration":configuration, "credential":credential.version, "native":evidence}),
    )?;
    Ok(NativeRead {
        configuration,
        credential,
        observation: ConnectionObservation {
            initial_mode,
            login_status: login_status.into(),
            conflict: None,
        },
        revision,
        source,
        provider_id,
        catalog_path,
    })
}
pub fn row_id(id: &str) -> Result<String> {
    canonical_json_digest(&json!(id))
}
