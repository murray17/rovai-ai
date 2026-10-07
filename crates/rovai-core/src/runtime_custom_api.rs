//! Read-only native connection evidence for host compatibility and secret redaction.
//! The connection editor is retired; legacy frozen snapshots remain readable.
use crate::{agent_profile::AdapterKind, command::canonical_json_digest};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

pub mod codex_source;
pub mod native;
pub(crate) mod native_file;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionMode {
    OfficialLogin,
    CustomApi,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaudeApiModels {
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub reasoning_model: String,
    #[serde(default)]
    pub haiku_model: String,
    #[serde(default)]
    pub sonnet_model: String,
    #[serde(default)]
    pub opus_model: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomApiModel {
    /// Editor identity only; never written into a native model catalog.
    #[serde(default)]
    pub row_id: String,
    pub id: String,
    #[serde(default)]
    pub display_name: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum CustomApiConfiguration {
    #[serde(rename = "claude-code-cli")]
    ClaudeCode {
        mode: Option<ConnectionMode>,
        base_url: String,
        models: ClaudeApiModels,
    },
    #[serde(rename = "codex-cli")]
    Codex {
        mode: Option<ConnectionMode>,
        base_url: String,
        models: Vec<CustomApiModel>,
        default_model: String,
        default_row_id: Option<String>,
    },
}
impl CustomApiConfiguration {
    pub fn kind(&self) -> AdapterKind {
        match self {
            Self::ClaudeCode { .. } => AdapterKind::ClaudeCodeCli,
            Self::Codex { .. } => AdapterKind::CodexCli,
        }
    }
    pub fn mode(&self) -> Option<ConnectionMode> {
        match self {
            Self::ClaudeCode { mode, .. } | Self::Codex { mode, .. } => *mode,
        }
    }
    pub fn enabled(&self) -> bool {
        self.mode() == Some(ConnectionMode::CustomApi)
    }
    pub fn base_url(&self) -> &str {
        match self {
            Self::ClaudeCode { base_url, .. } | Self::Codex { base_url, .. } => base_url,
        }
    }
    pub fn default_model(&self) -> Option<&str> {
        if !self.enabled() {
            return None;
        }
        let value = match self {
            Self::ClaudeCode { models, .. } => &models.model,
            Self::Codex { default_model, .. } => default_model,
        };
        (!value.is_empty()).then_some(value.as_str())
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomApiSnapshot {
    pub configuration: CustomApiConfiguration,
    /// Legacy catalog identity participates in compatibility, never model admission.
    #[serde(default)]
    pub configured_model_ids: Option<Vec<String>>,
    pub context: native::NativeContext,
    pub native_revision: String,
    pub credential_version: String,
    pub credential_source: native::CredentialSource,
    pub provider_id: String,
    /// Compatibility for already-frozen records; never used to select a connection.
    #[serde(default, skip_serializing)]
    pub explicit_mode: bool,
}
impl std::fmt::Debug for CustomApiSnapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NativeConnectionSnapshot")
            .field("kind", &self.configuration.kind())
            .field("mode", &self.configuration.mode())
            .finish_non_exhaustive()
    }
}
impl CustomApiSnapshot {
    pub fn identity(&self) -> Result<String> {
        canonical_json_digest(&json!({
            "kind": self.configuration.kind(), "mode": self.configuration.mode(),
            "directory": self.context.directory, "connection": self.native_revision,
            "api": self.configuration.enabled().then(|| native::execution_configuration(&self.configuration)),
            "credential": self.configuration.enabled().then_some(&self.credential_version),
            "provider": self.configuration.enabled().then_some(&self.provider_id),
            "models": self.configured_model_ids,
        }))
    }
    pub fn key(&self) -> Result<Option<String>> {
        let (value, version) = native::credential_value(&self.credential_source, &self.context)?;
        ensure!(
            version == self.credential_version,
            "原生凭据已变化，此执行需要重新建立连接；未使用其他 Key。"
        );
        Ok(value)
    }
    pub fn redactor(&self) -> Result<CredentialRedactor> {
        let key = native::credential_value(&self.credential_source, &self.context)?.0;
        let mut secrets: Vec<_> = key.into_iter().collect();
        if self.context.kind == AdapterKind::ClaudeCodeCli {
            let settings = native::read_json(&self.context.path())?;
            if let Some(token) = settings
                .pointer("/env/CLAUDE_CODE_OAUTH_TOKEN")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| self.context.env("CLAUDE_CODE_OAUTH_TOKEN"))
            {
                secrets.push(token);
            }
        }
        Ok(CredentialRedactor(secrets))
    }
    pub fn assert_current(&self) -> Result<()> {
        let Ok(current) = native::read(&self.context, None) else {
            return Ok(());
        };
        ensure!(
            current.connection_revision == self.native_revision,
            "原生连接已变化，此执行需要重新建立连接；未恢复旧接口。"
        );
        Ok(())
    }
}
/// Exact scrubbing at private native output boundaries; secrets never enter Debug or serialized state.
#[derive(Clone)]
pub struct CredentialRedactor(Vec<String>);
impl CredentialRedactor {
    pub fn text(&self, text: &str) -> String {
        self.0
            .iter()
            .filter(|key| !key.is_empty())
            .fold(text.to_owned(), |text, key| text.replace(key, "[redacted]"))
    }
    pub fn value(&self, value: &mut Value) {
        match value {
            Value::String(text) => *text = self.text(text),
            Value::Array(items) => items.iter_mut().for_each(|item| self.value(item)),
            Value::Object(object) => {
                let old = std::mem::take(object);
                for (name, mut item) in old {
                    self.value(&mut item);
                    object.insert(self.text(&name), item);
                }
            }
            _ => {}
        }
    }
}

pub fn storage_root(database_path: &Path, kind: AdapterKind) -> Result<PathBuf> {
    Ok(database_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("本机数据目录不可用。"))?
        .join("runtime-api")
        .join(kind.as_str())
        .join("artifacts"))
}

#[cfg(test)]
mod tests;
