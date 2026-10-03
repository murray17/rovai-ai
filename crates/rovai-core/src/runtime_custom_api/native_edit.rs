//! Narrow native edits. A catalog is staged first; the one authoritative config is replaced last.
use super::{
    ApiKeyChange, CustomApiConfiguration, FieldEdit,
    native::{self, CredentialSource, NativeContext, NativeRead},
};
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::path::Path;

pub fn write(
    context: &NativeContext,
    current: &NativeRead,
    desired: &CustomApiConfiguration,
    edits: &[FieldEdit],
    key: &ApiKeyChange,
    executable: Option<&Path>,
) -> Result<bool> {
    key.validate()?;
    let changed = |name: &str| {
        edits
            .iter()
            .any(|e| e.path.first().is_some_and(|p| p == name))
    };
    if !changed("baseUrl")
        && !changed("claudeModels")
        && !changed("codexModels")
        && !changed("defaultRowId")
        && key.is_keep()
    {
        return Ok(false);
    }
    let path = context.path();
    let before = native::read_bytes(&path)?;
    // Re-read after conflict resolution and immediately before constructing the native patch.
    ensure!(
        native::read(context, current.configuration.mode())?.revision == current.revision,
        "原生配置在保存期间又发生变化；草稿已保留，请再次保存以合并最新字段。"
    );
    ensure!(
        !path
            .symlink_metadata()
            .is_ok_and(|m| m.file_type().is_symlink()),
        "原生配置是符号链接，请在实际来源编辑，避免替换链接。"
    );
    let mut credential_patch: Option<(std::path::PathBuf, Option<Vec<u8>>, Vec<u8>)> = None;
    let bytes = match desired {
        CustomApiConfiguration::ClaudeCode {
            base_url, models, ..
        } => {
            let mut doc = native::read_json(&path)?;
            if doc.get("env").is_none() {
                doc["env"] = json!({});
            }
            ensure!(doc["env"].is_object(), "Claude Code 的 env 必须是对象。");
            if changed("baseUrl") {
                doc["env"]["ANTHROPIC_BASE_URL"] = json!(base_url);
            }
            let names = [
                "model",
                "reasoningModel",
                "haikuModel",
                "sonnetModel",
                "opusModel",
            ];
            for ((env, value), name) in native::claude_models(models).into_iter().zip(names) {
                if edits.iter().any(|e| e.path == ["claudeModels", name]) {
                    doc["env"][env] = json!(value);
                }
            }
            match key {
                ApiKeyChange::Keep => {}
                ApiKeyChange::Replace { value } => {
                    doc["env"]["ANTHROPIC_AUTH_TOKEN"] = json!(value);
                    doc["env"]["ANTHROPIC_API_KEY"] = json!("");
                    doc["apiKeyHelper"] = json!("");
                }
                ApiKeyChange::Clear => {
                    ensure!(
                        current.credential.can_clear,
                        "{} 无法在此清除；请在该来源处理，或输入新 Key 替换连接。",
                        current.credential.source_label
                    );
                    doc["env"]["ANTHROPIC_AUTH_TOKEN"] = json!("");
                    doc["env"]["ANTHROPIC_API_KEY"] = json!("");
                    doc["apiKeyHelper"] = json!("");
                }
            }
            let mut bytes = serde_json::to_vec_pretty(&doc)?;
            bytes.push(b'\n');
            bytes
        }
        CustomApiConfiguration::Codex {
            base_url,
            default_model,
            ..
        } => {
            let mut doc = native::read_toml(&path)?;
            let profile = doc
                .get("profile")
                .and_then(toml_edit::Item::as_str)
                .map(str::to_owned);
            let provider_id = if current.provider_id == "openai" {
                "rovai_custom"
            } else {
                current.provider_id.as_str()
            };
            let provider_path = ["model_providers", provider_id];
            let provider = table(&mut doc, &provider_path)?;
            if current.provider_id == "openai" {
                set(provider, "name", toml_edit::value("Rovai custom API"));
            }
            if changed("baseUrl") || current.provider_id == "openai" {
                set(provider, "base_url", toml_edit::value(base_url));
            }
            set(provider, "wire_api", toml_edit::value("responses"));
            match key {
                ApiKeyChange::Keep => {
                    // An existing auth.json/keyring source stays runtime-owned. Never copy its value.
                    if current.provider_id == "openai" {
                        match &current.source {
                            CredentialSource::Environment { name } => {
                                set(provider, "env_key", toml_edit::value(name));
                                set(provider, "requires_openai_auth", toml_edit::value(false));
                            }
                            CredentialSource::Missing => {
                                set(
                                    provider,
                                    "env_key",
                                    toml_edit::value("ROVAI_UNCONFIGURED_API_KEY"),
                                );
                                set(provider, "requires_openai_auth", toml_edit::value(false));
                            }
                            CredentialSource::NativeManaged { .. } => {
                                ensure!(
                                    !changed("baseUrl")
                                        || desired.base_url() == current.configuration.base_url(),
                                    "当前凭据由 Codex 原生系统管理，尚无法确认其为 API Key；更换接口地址时请填写新 Key，或先在原生配置中绑定该接口。已有连接仍可直接复用。"
                                );
                                set(provider, "requires_openai_auth", toml_edit::value(true));
                            }
                            _ => {
                                set(provider, "requires_openai_auth", toml_edit::value(true));
                            }
                        }
                    }
                }
                ApiKeyChange::Replace { value } => {
                    // Native inline bearer is a supported provider source; no shell or auth.json mutation.
                    provider.remove("env_key");
                    set(
                        provider,
                        "experimental_bearer_token",
                        toml_edit::value(value),
                    );
                    set(provider, "requires_openai_auth", toml_edit::value(false));
                }
                ApiKeyChange::Clear => {
                    ensure!(
                        current.credential.can_clear,
                        "此凭据由原生认证管理；请在原生来源清除，或输入新 Key 替换当前连接。"
                    );
                    if let CredentialSource::Json {
                        path: auth_path,
                        pointer,
                        ..
                    } = &current.source
                    {
                        ensure!(pointer == "/OPENAI_API_KEY", "此原生凭据字段无法安全清除。");
                        let original = native::read_bytes(auth_path)?;
                        let mut auth = native::read_json(auth_path)?;
                        auth.as_object_mut()
                            .ok_or_else(|| anyhow::anyhow!("原生认证文件格式无效。"))?
                            .remove("OPENAI_API_KEY");
                        let mut updated = serde_json::to_vec_pretty(&auth)?;
                        updated.push(b'\n');
                        credential_patch = Some((auth_path.clone(), original, updated));
                    }
                    provider.remove("experimental_bearer_token");
                    // A required, unset reference prevents falling back to a saved official account.
                    set(
                        provider,
                        "env_key",
                        toml_edit::value("ROVAI_UNCONFIGURED_API_KEY"),
                    );
                    set(provider, "requires_openai_auth", toml_edit::value(false));
                }
            }
            // Select within the active profile where native precedence requires it.
            let target = if let Some(profile) = &profile {
                table(&mut doc, &["profiles", profile])?
            } else {
                doc.as_table_mut()
            };
            set(target, "model_provider", toml_edit::value(provider_id));
            if changed("codexModels") || changed("defaultRowId") {
                let executable = executable.ok_or_else(|| {
                    anyhow::anyhow!("生成模型目录需要当前 Codex 程序，请先选择可执行文件。")
                })?;
                let catalog = super::codex_catalog::generate(executable, desired)?;
                let hash = crate::command::canonical_json_digest(&catalog)?;
                // Native config references a key-free catalog in the native config directory.
                let catalog_path = context
                    .directory
                    .join("rovai-model-catalogs")
                    .join(format!("{}.json", hash.trim_start_matches("sha256:")));
                let contents = serde_json::to_vec(&catalog)?;
                if catalog_path.exists() {
                    ensure!(
                        std::fs::read(&catalog_path)? == contents,
                        "模型目录修订内容已变化，拒绝覆盖。"
                    );
                } else {
                    crate::platform::private_storage::atomic_write_private_bytes(
                        &catalog_path,
                        &contents,
                    )?;
                }
                set(
                    target,
                    "model_catalog_json",
                    toml_edit::value(catalog_path.to_string_lossy().as_ref()),
                );
                set(target, "model", toml_edit::value(default_model));
            }
            doc.to_string().into_bytes()
        }
    };
    ensure!(
        native::read_bytes(&path)? == before,
        "原生文件在写入前发生变化；草稿已保留，请再次保存。"
    );
    if let Some((auth_path, before, after)) = &credential_patch {
        ensure!(
            native::read_bytes(auth_path)? == *before
                && !auth_path
                    .symlink_metadata()
                    .is_ok_and(|m| m.file_type().is_symlink()),
            "原生凭据来源在保存期间变化，草稿已保留。"
        );
        crate::platform::private_storage::atomic_write_private_bytes(auth_path, after)
            .map_err(|_| anyhow::anyhow!("无法更新原生 API 凭据字段；请检查文件权限。"))?;
    }
    let write = crate::platform::private_storage::atomic_write_private_bytes(&path, &bytes);
    if write.is_err() {
        if let Some((auth_path, before, after)) = credential_patch {
            ensure!(
                native::read_bytes(&auth_path)? == Some(after),
                "保存失败，原生凭据又被外部修改；未覆盖外部变化，请检查原生来源。"
            );
            if let Some(original) = before {
                crate::platform::private_storage::atomic_write_private_bytes(&auth_path, &original)
                    .map_err(|_| anyhow::anyhow!("保存失败且凭据回退失败，请检查原生文件权限。"))?;
            }
        }
        anyhow::bail!(
            "保存原生配置失败；请检查文件权限。草稿已保留：{}",
            path.display()
        );
    }
    Ok(true)
}
fn table<'a>(
    document: &'a mut toml_edit::DocumentMut,
    keys: &[&str],
) -> Result<&'a mut toml_edit::Table> {
    let mut current = document.as_table_mut();
    for key in keys {
        if !current.contains_key(key) {
            current.insert(key, toml_edit::Item::Table(toml_edit::Table::new()));
        }
        current = current
            .get_mut(key)
            .and_then(toml_edit::Item::as_table_mut)
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Codex 原生字段 {} 不是可编辑配置表；请保留当前草稿并修复原生结构。",
                    key
                )
            })?;
    }
    Ok(current)
}
pub fn value_at<'a>(value: &'a Value, path: &[String]) -> &'a Value {
    path.iter()
        .fold(value, |value, name| value.get(name).unwrap_or(&Value::Null))
}
pub fn set_at(value: &mut Value, path: &[String], next: Value) -> Result<()> {
    let (first, rest) = path
        .split_first()
        .ok_or_else(|| anyhow::anyhow!("修改字段不能为空。"))?;
    ensure!(value.is_object(), "字段所在项目已被删除，请处理字段冲突。");
    if rest.is_empty() {
        value[first] = next;
    } else {
        if value.get(first).is_none_or(Value::is_null) {
            value[first] = json!({});
        }
        set_at(&mut value[first], rest, next)?;
    }
    Ok(())
}

fn set(table: &mut toml_edit::Table, name: &str, mut item: toml_edit::Item) {
    if let Some(old) = table.get(name).and_then(toml_edit::Item::as_value) {
        if old.to_string() == item.to_string() {
            return;
        }
        if let Some(value) = item.as_value_mut() {
            *value.decor_mut() = old.decor().clone();
        }
    }
    if let Some(existing) = table.get_mut(name) {
        *existing = item;
    } else {
        table.insert(name, item);
    }
}
