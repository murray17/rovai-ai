//! Machine-local launch preferences. Values never enter public Runtime evidence.
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::{Result, ensure};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{
    agent_profile::AdapterKind,
    db::Database,
    runtime_custom_api::{
        ApiKeyChange, ConnectionMode, ConnectionObservation, CustomApiConfiguration,
        CustomApiSnapshot, FieldConflict, FieldEdit, NativeCredential, native, native_edit,
    },
};

#[derive(Clone, Default, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeStartupConfiguration {
    pub program_path: Option<String>,
    #[serde(default)]
    pub environment: Vec<RuntimeEnvironmentVariable>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_api: Option<CustomApiConfiguration>,
    /// Resolved by the Host from its private stored references, never accepted from clients.
    #[serde(skip)]
    pub custom_api_snapshot: Option<CustomApiSnapshot>,
}

impl PartialEq for RuntimeStartupConfiguration {
    fn eq(&self, other: &Self) -> bool {
        self.program_path == other.program_path
            && self.environment == other.environment
            && self.custom_api == other.custom_api
    }
}

impl std::fmt::Debug for RuntimeStartupConfiguration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RuntimeStartupConfiguration")
            .field("program_path", &self.program_path)
            .field("environment_count", &self.environment.len())
            .field(
                "custom_api_enabled",
                &self
                    .custom_api
                    .as_ref()
                    .is_some_and(CustomApiConfiguration::enabled),
            )
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeEnvironmentVariable {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStartupSettings {
    pub runtime_kind: AdapterKind,
    pub revision: u64,
    pub configuration: RuntimeStartupConfiguration,
    pub credential: Option<NativeCredential>,
    pub connection_observation: Option<ConnectionObservation>,
    pub native_revision: Option<String>,
    pub connection_read_error: Option<String>,
    pub reconnect_required: bool,
    pub native_written: bool,
}

impl RuntimeStartupConfiguration {
    pub fn validated(mut self, windows: bool) -> Result<Self> {
        if let Some(path) = &mut self.program_path {
            *path = path.trim().to_owned();
            ensure!(
                !path.is_empty() && path.len() <= 4096 && !path.contains(['\0', '\r', '\n']),
                "请选择有效的程序路径。"
            );
            ensure!(
                Path::new(path).is_absolute(),
                "程序路径必须是本机绝对路径。"
            );
        }
        ensure!(self.environment.len() <= 128, "环境变量不能超过 128 项。");
        let mut names = BTreeSet::new();
        let mut bytes = 0;
        for variable in &mut self.environment {
            variable.name = variable.name.trim().to_owned();
            let mut chars = variable.name.chars();
            ensure!(
                matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
                    && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
                    && variable.name.len() <= 256,
                "变量名需以字母或下划线开头，只含字母、数字、下划线。"
            );
            ensure!(
                !variable.name.to_ascii_uppercase().starts_with("ROVAI_"),
                "ROVAI_ 开头的变量由应用管理，请使用其他变量名。"
            );
            let name = if windows {
                variable.name.to_ascii_uppercase()
            } else {
                variable.name.clone()
            };
            ensure!(names.insert(name), "变量名重复，请合并为一项。");
            ensure!(
                !variable.value.contains('\0') && variable.value.len() <= 65536,
                "变量值包含空字符或超过长度限制。"
            );
            bytes += variable.name.len() + variable.value.len();
        }
        ensure!(bytes <= 128 * 1024, "环境变量总长度超过限制。");
        Ok(self)
    }
}

fn load_record(
    connection: &rusqlite::Connection,
    runtime_kind: AdapterKind,
) -> Result<(u64, RuntimeStartupConfiguration, Option<ConnectionMode>)> {
    let row: Option<(i64, String)> = connection.query_row(
        "SELECT revision, configuration_json FROM runtime_startup_setting WHERE runtime_kind = ?1",
        [runtime_kind.as_str()], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional()?;
    let Some((revision, json)) = row else {
        return Ok((0, RuntimeStartupConfiguration::default(), None));
    };
    let mut value: serde_json::Value = serde_json::from_str(&json)?;
    let mode = value
        .as_object_mut()
        .and_then(|value| value.remove("_connectionMode"))
        .map(serde_json::from_value)
        .transpose()?
        .flatten();
    Ok((
        u64::try_from(revision)?,
        serde_json::from_value(value)?,
        mode,
    ))
}

fn read_settings(database: &Database, kind: AdapterKind) -> Result<RuntimeStartupSettings> {
    let (revision, mut configuration, mode) = load_record(database.connection(), kind)?;
    let mut settings = RuntimeStartupSettings {
        runtime_kind: kind,
        revision,
        configuration: configuration.clone(),
        credential: None,
        connection_observation: None,
        native_revision: None,
        connection_read_error: None,
        reconnect_required: false,
        native_written: false,
    };
    if native::supported(kind) {
        let read = native::NativeContext::resolve(kind, &configuration, database.path())
            .and_then(|context| native::read(&context, mode).map(|read| (context, read)));
        match read {
            Ok((context, read)) => {
                if mode.is_some() || read.configuration.enabled() {
                    configuration.custom_api_snapshot =
                        Some(read.snapshot(&context, mode.is_some()));
                }
                configuration.custom_api = Some(read.configuration);
                settings.configuration = configuration;
                settings.credential = Some(read.credential);
                settings.connection_observation = Some(read.observation);
                settings.native_revision = Some(read.revision);
            }
            Err(error) => settings.connection_read_error = Some(error.to_string()),
        }
    }
    Ok(settings)
}

pub fn load(database: &Database, kind: AdapterKind) -> Result<RuntimeStartupSettings> {
    read_settings(database, kind)
}
/// Internal settings retain legacy environment references; owner-facing reads never return key values.
pub fn public(mut settings: RuntimeStartupSettings) -> RuntimeStartupSettings {
    let referenced = settings
        .configuration
        .custom_api_snapshot
        .as_ref()
        .and_then(|s| match &s.credential_source {
            native::CredentialSource::Environment { name } => Some(name.clone()),
            _ => None,
        });
    settings.configuration.environment.retain(|entry| {
        !sensitive_environment(&entry.name) && referenced.as_deref() != Some(entry.name.as_str())
    });
    settings
}
pub fn sensitive_environment(name: &str) -> bool {
    matches!(
        name.to_ascii_uppercase().as_str(),
        "ANTHROPIC_API_KEY"
            | "ANTHROPIC_AUTH_TOKEN"
            | "CLAUDE_CODE_OAUTH_TOKEN"
            | "OPENAI_API_KEY"
            | "CODEX_API_KEY"
            | "CODEX_ACCESS_TOKEN"
    )
}
pub fn load_all(database: &Database) -> Result<BTreeMap<AdapterKind, RuntimeStartupConfiguration>> {
    let mut configurations = BTreeMap::new();
    for kind in AdapterKind::ALL {
        let settings = load(database, kind)?;
        if settings.revision != 0 || settings.configuration.custom_api_snapshot.is_some() {
            configurations.insert(kind, settings.configuration.validated(cfg!(windows))?);
        }
    }
    Ok(configurations)
}

pub fn editable(configuration: &RuntimeStartupConfiguration) -> serde_json::Value {
    use serde_json::json;
    let mut value = json!({"programPath":configuration.program_path, "environment":configuration.environment.iter().filter(|e| !sensitive_environment(&e.name)).map(|entry| (entry.name.clone(), json!(entry.value))).collect::<serde_json::Map<_,_>>()});
    if let Some(api) = &configuration.custom_api {
        value["mode"] = json!(api.mode());
        value["baseUrl"] = json!(api.base_url());
        match api {
            CustomApiConfiguration::ClaudeCode { models, .. } => {
                value["claudeModels"] = json!(models)
            }
            CustomApiConfiguration::Codex {
                models,
                default_row_id,
                ..
            } => {
                value["codexModels"] = json!(
                    models
                        .iter()
                        .map(|row| (
                            row.row_id.clone(),
                            json!({"id": row.id, "displayName":row.display_name})
                        ))
                        .collect::<serde_json::Map<_, _>>()
                );
                value["defaultRowId"] = json!(default_row_id);
            }
        }
    }
    value
}
/// Compatibility for callers of the ordinary startup editor. Native connection writes require patches.
pub fn ordinary_edits(
    before: &RuntimeStartupConfiguration,
    after: &RuntimeStartupConfiguration,
) -> Vec<FieldEdit> {
    let before = editable(before);
    let after = editable(after);
    let mut paths = vec![vec!["programPath".to_owned()]];
    let names = before["environment"]
        .as_object()
        .into_iter()
        .flat_map(|o| o.keys())
        .chain(
            after["environment"]
                .as_object()
                .into_iter()
                .flat_map(|o| o.keys()),
        )
        .cloned()
        .collect::<BTreeSet<_>>();
    paths.extend(
        names
            .into_iter()
            .map(|name| vec!["environment".into(), name]),
    );
    paths
        .into_iter()
        .filter_map(|path| {
            let old = native_edit::value_at(&before, &path);
            let next = native_edit::value_at(&after, &path);
            (old != next).then(|| FieldEdit {
                path,
                before: old.clone(),
                after: next.clone(),
                label: String::new(),
            })
        })
        .collect()
}
fn allowed_edit(edit: &FieldEdit, kind: AdapterKind) -> bool {
    let p: Vec<_> = edit.path.iter().map(String::as_str).collect();
    match p.as_slice() {
        ["programPath"] => true,
        ["environment", name] => {
            !sensitive_environment(name) && !name.to_ascii_uppercase().starts_with("ROVAI_")
        }
        ["mode" | "baseUrl" | "credentialVersion"] => native::supported(kind),
        [
            "claudeModels",
            "model" | "reasoningModel" | "haikuModel" | "sonnetModel" | "opusModel",
        ] => kind == AdapterKind::ClaudeCodeCli,
        ["defaultRowId"] => kind == AdapterKind::CodexCli,
        ["codexModels", row] | ["codexModels", row, "id" | "displayName"] => {
            kind == AdapterKind::CodexCli && !row.is_empty() && row.len() <= 128
        }
        _ => false,
    }
}
pub struct PreparedSave {
    pub current: RuntimeStartupSettings,
    pub configuration: RuntimeStartupConfiguration,
    pub edits: Vec<FieldEdit>,
    pub conflicts: Vec<FieldConflict>,
}
pub fn prepare_save(
    database: &Database,
    kind: AdapterKind,
    edits: Vec<FieldEdit>,
    key: &ApiKeyChange,
) -> Result<PreparedSave> {
    ensure!(edits.len() <= 512, "修改字段过多。");
    key.validate()?;
    let current = load(database, kind)?;
    let visible = public(current.clone());
    let mut value = editable(&visible.configuration);
    value["credentialVersion"] = serde_json::json!(current.credential.as_ref().map(|c| &c.version));
    let mut conflicts = Vec::new();
    let mut seen = BTreeSet::new();
    for edit in &edits {
        ensure!(
            allowed_edit(edit, kind) && seen.insert(edit.path.clone()),
            "修改字段无效或重复。"
        );
        let now = native_edit::value_at(&value, &edit.path).clone();
        let credential = edit.path == ["credentialVersion"];
        if now != edit.before && (credential || now != edit.after) {
            conflicts.push(FieldConflict {
                edit: edit.clone(),
                current: now,
            });
        }
        native_edit::set_at(&mut value, &edit.path, edit.after.clone())?;
    }
    ensure!(
        key.is_keep() == !seen.contains(&vec!["credentialVersion".into()]),
        "API Key 操作缺少凭据版本。"
    );
    let mut configuration = current.configuration.clone();
    configuration.program_path = serde_json::from_value(value["programPath"].clone())?;
    let hidden_names = current
        .configuration
        .environment
        .iter()
        .filter(|e| {
            !visible
                .configuration
                .environment
                .iter()
                .any(|v| v.name == e.name)
        })
        .map(|e| e.name.clone())
        .collect::<BTreeSet<_>>();
    ensure!(
        !edits
            .iter()
            .any(|e| e.path.first().is_some_and(|v| v == "environment")
                && e.path
                    .get(1)
                    .is_some_and(|name| hidden_names.contains(name))),
        "请在原生凭据来源中配置此密钥。"
    );
    configuration
        .environment
        .retain(|e| hidden_names.contains(&e.name));
    for (name, value) in value["environment"]
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("环境变量无效。"))?
    {
        if !value.is_null() {
            configuration.environment.push(RuntimeEnvironmentVariable {
                name: name.clone(),
                value: value
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("环境变量值必须为文本。"))?
                    .into(),
            });
        }
    }
    let native_changed = edits
        .iter()
        .any(|e| !matches!(e.path[0].as_str(), "programPath" | "environment"));
    if native_changed {
        ensure!(
            current.connection_read_error.is_none(),
            "连接读取失败，请重试；其他启动字段仍可单独保存。"
        );
    }
    if let Some(api) = &mut configuration.custom_api {
        api.set_mode(serde_json::from_value(value["mode"].clone())?);
        match api {
            CustomApiConfiguration::ClaudeCode {
                base_url, models, ..
            } => {
                *base_url = serde_json::from_value(value["baseUrl"].clone())?;
                *models = serde_json::from_value(value["claudeModels"].clone())?;
            }
            CustomApiConfiguration::Codex {
                base_url,
                models,
                default_row_id,
                default_model,
                ..
            } => {
                *base_url = serde_json::from_value(value["baseUrl"].clone())?;
                *default_row_id = serde_json::from_value(value["defaultRowId"].clone())?;
                let rows = value["codexModels"]
                    .as_object()
                    .ok_or_else(|| anyhow::anyhow!("模型列表无效。"))?;
                // Preserve native ordering, append only genuinely new rows.
                let order = models
                    .iter()
                    .map(|m| m.row_id.clone())
                    .chain(
                        rows.keys()
                            .filter(|k| !models.iter().any(|m| &m.row_id == *k))
                            .cloned(),
                    )
                    .collect::<Vec<_>>();
                *models = order.into_iter().filter_map(|id| rows.get(&id).filter(|v| !v.is_null()).map(|v| (id,v))).map(|(id,v)| serde_json::from_value(serde_json::json!({"rowId":id,"id":v["id"],"displayName":v["displayName"]}))).collect::<std::result::Result<_,_>>()?;
                *default_model = models
                    .iter()
                    .find(|m| Some(&m.row_id) == default_row_id.as_ref())
                    .map(|m| m.id.clone())
                    .unwrap_or_default();
            }
        }
        if native_changed
            && conflicts.is_empty()
            && (api.enabled()
                || edits.iter().any(|e| {
                    !matches!(
                        e.path[0].as_str(),
                        "mode" | "credentialVersion" | "programPath" | "environment"
                    )
                }))
        {
            api.validate(kind)?;
        }
    }
    Ok(PreparedSave {
        current,
        configuration: configuration.validated(cfg!(windows))?,
        edits,
        conflicts,
    })
}

/// Internal ordinary-setting owner. No API values or keys are persisted here.
pub fn save(
    database: &mut Database,
    kind: AdapterKind,
    expected_revision: u64,
    configuration: RuntimeStartupConfiguration,
    search_generation: u64,
) -> Result<RuntimeStartupSettings> {
    let (revision, previous, mode) = load_record(database.connection(), kind)?;
    if revision > 0 && previous == configuration {
        return load(database, kind);
    }
    persist(
        database,
        kind,
        expected_revision,
        configuration,
        search_generation,
        mode,
    )?;
    load(database, kind)
}
pub fn commit_save(
    database: &mut Database,
    kind: AdapterKind,
    prepared: PreparedSave,
    search_generation: u64,
    key: ApiKeyChange,
    executable: Option<&Path>,
) -> Result<RuntimeStartupSettings> {
    ensure!(prepared.conflicts.is_empty(), "请先处理字段冲突。");
    let current = load_record(database.connection(), kind)?;
    ensure!(
        current.0 == prepared.current.revision,
        "启动设置在保存期间发生变化，草稿已保留，请再次保存。"
    );
    let mut native_written = false;
    let mut native_rollback = Vec::new();
    if prepared
        .edits
        .iter()
        .any(|e| !matches!(e.path[0].as_str(), "programPath" | "environment"))
    {
        let context =
            native::NativeContext::resolve(kind, &prepared.configuration, database.path())?;
        let read = native::read(
            &context,
            prepared
                .current
                .configuration
                .custom_api
                .as_ref()
                .and_then(CustomApiConfiguration::mode),
        )?;
        ensure!(
            Some(&read.revision) == prepared.current.native_revision.as_ref(),
            "原生连接在保存期间变化，草稿已保留，请再次保存。"
        );
        let desired = prepared
            .configuration
            .custom_api
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("缺少连接配置。"))?;
        let before = native::read_bytes(&context.path())?;
        let credential_before = if matches!(key, ApiKeyChange::Clear) {
            match &read.source {
                native::CredentialSource::Json { path, .. } if path != &context.path() => {
                    Some((path.clone(), native::read_bytes(path)?))
                }
                _ => None,
            }
        } else {
            None
        };
        native_written =
            native_edit::write(&context, &read, desired, &prepared.edits, &key, executable)?;
        if native_written {
            native_rollback.push((context.path(), before, native::read_bytes(&context.path())?));
            if let Some((path, before)) = credential_before {
                let after = native::read_bytes(&path)?;
                native_rollback.push((path, before, after));
            }
        }
    }
    let mode = if prepared.edits.iter().any(|e| e.path == ["mode"]) {
        prepared
            .configuration
            .custom_api
            .as_ref()
            .and_then(CustomApiConfiguration::mode)
    } else {
        current.2
    };
    if let Err(error) = persist(
        database,
        kind,
        prepared.current.revision,
        prepared.configuration,
        search_generation,
        mode,
    ) {
        for (path, before, after) in native_rollback {
            if native::read_bytes(&path).ok() == Some(after) {
                let restored = match before {
                    Some(bytes) => {
                        crate::platform::private_storage::atomic_write_private_bytes(&path, &bytes)
                    }
                    None => std::fs::remove_file(&path).map_err(Into::into),
                };
                ensure!(
                    restored.is_ok(),
                    "启动状态保存失败，原生配置回退也失败；草稿已保留，请检查原生文件权限。"
                );
            } else {
                anyhow::bail!(
                    "启动状态保存失败，原生配置随后又被外部修改；未覆盖外部变化。草稿已保留，请检查连接设置。"
                );
            }
        }
        return Err(error);
    }
    let mut saved = load(database, kind)?;
    saved.native_written = native_written;
    saved.reconnect_required = !prepared.edits.is_empty();
    Ok(saved)
}
fn persist(
    database: &mut Database,
    kind: AdapterKind,
    expected_revision: u64,
    mut configuration: RuntimeStartupConfiguration,
    search_generation: u64,
    mode: Option<ConnectionMode>,
) -> Result<()> {
    configuration = configuration.validated(cfg!(windows))?;
    let (current, previous, previous_mode) = load_record(database.connection(), kind)?;
    configuration.custom_api = None;
    configuration.custom_api_snapshot = None;
    if current > 0 && previous == configuration && previous_mode == mode { /* native-only saves still invalidate qualifications */
    }
    ensure!(
        current == expected_revision,
        "启动设置已被更新，请保留草稿并再次保存。"
    );
    let revision = current
        .checked_add(1)
        .ok_or_else(|| anyhow::anyhow!("启动设置版本超出范围。"))?;
    let mut stored = serde_json::to_value(&configuration)?;
    stored["_connectionMode"] = serde_json::json!(mode);
    let transaction = database.connection_mut().transaction()?;
    transaction.execute("INSERT INTO runtime_startup_setting(runtime_kind, revision, configuration_json, updated_at) VALUES (?1, ?2, ?3, datetime('now')) ON CONFLICT(runtime_kind) DO UPDATE SET revision=excluded.revision, configuration_json=excluded.configuration_json, updated_at=excluded.updated_at", params![kind.as_str(), i64::try_from(revision)?, serde_json::to_string(&stored)?])?;
    transaction.execute("UPDATE adapter_capability_snapshot SET stale_at=COALESCE(stale_at, datetime('now')), authentication_status='unknown', probe_status='installed_unverified', last_error='runtime_startup_configuration_changed' WHERE installation_id IN (SELECT id FROM adapter_installation WHERE adapter_kind=?1 AND installation_class='managed_default')", [kind.as_str()])?;
    transaction.execute("UPDATE adapter_installation SET generation=generation+1, version=version+1, updated_at=datetime('now') WHERE adapter_kind=?1 AND installation_class='managed_default'", [kind.as_str()])?;
    transaction.execute("INSERT INTO runtime_search_environment_state(singleton, generation, captured_at) VALUES(1, ?1, datetime('now')) ON CONFLICT(singleton) DO UPDATE SET generation=excluded.generation, captured_at=excluded.captured_at", [i64::try_from(search_generation)?])?;
    transaction.commit()?;
    Ok(())
}
pub(crate) fn snapshot_from_connection(
    connection: &rusqlite::Connection,
    kind: AdapterKind,
) -> Result<Option<CustomApiSnapshot>> {
    if !native::supported(kind) {
        return Ok(None);
    }
    let (_, configuration, mode) = load_record(connection, kind)?;
    let context = native::NativeContext::resolve(
        kind,
        &configuration,
        Path::new(
            connection
                .path()
                .ok_or_else(|| anyhow::anyhow!("本机数据目录不可用。"))?,
        ),
    )?;
    let read = native::read(&context, mode)?;
    Ok((mode.is_some() || read.configuration.enabled())
        .then(|| read.snapshot(&context, mode.is_some())))
}
/// No credential file or retained secret store is created for a preview.
pub struct DraftCredential;
pub fn resolve_draft(
    database: &Database,
    kind: AdapterKind,
    mut configuration: RuntimeStartupConfiguration,
    change: ApiKeyChange,
) -> Result<(RuntimeStartupConfiguration, Option<DraftCredential>)> {
    configuration = configuration.validated(cfg!(windows))?;
    change.validate()?;
    if !native::supported(kind) {
        ensure!(change.is_keep(), "此智能体没有连接编辑入口。");
        return Ok((configuration, None));
    }
    let context = native::NativeContext::resolve(kind, &configuration, database.path())?;
    let mode = configuration
        .custom_api
        .as_ref()
        .and_then(CustomApiConfiguration::mode);
    let read = native::read(&context, mode)?;
    let mut snapshot = read.snapshot(&context, mode.is_some());
    snapshot.preview = true;
    if let Some(mut api) = configuration.custom_api.clone() {
        api.validate(kind)?;
        snapshot.configuration = api;
    }
    if let ApiKeyChange::Replace { value } = change {
        snapshot.draft_key = Some(value);
        if kind == AdapterKind::ClaudeCodeCli {
            snapshot.credential_source = native::CredentialSource::Environment {
                name: "ANTHROPIC_AUTH_TOKEN".into(),
            };
        }
    } else if matches!(change, ApiKeyChange::Clear) {
        snapshot.credential_source = native::CredentialSource::Missing;
        snapshot.credential_version =
            native::credential_value(&snapshot.credential_source, &context)?.1;
    }
    configuration.custom_api_snapshot = Some(snapshot);
    Ok((configuration, None))
}

#[cfg(test)]
mod tests {
    use super::*;

    // New editor-input boundary; no database/process fixture is needed for this matrix.
    #[test]
    fn environment_validation_preserves_values_and_rejects_ambiguous_or_reserved_names() {
        let config = |names: &[&str]| RuntimeStartupConfiguration {
            custom_api: None,
            custom_api_snapshot: None,
            program_path: None,
            environment: names
                .iter()
                .map(|name| RuntimeEnvironmentVariable {
                    name: (*name).into(),
                    value: "  private-value  ".into(),
                })
                .collect(),
        };
        let valid = config(&[" HTTP_PROXY ", "_EMPTY"])
            .validated(false)
            .unwrap();
        assert_eq!(valid.environment[0].name, "HTTP_PROXY");
        assert_eq!(valid.environment[0].value, "  private-value  ");
        assert!(!format!("{valid:?}").contains("private-value"));
        for names in [
            &[""][..],
            &["1KEY"],
            &["BAD-NAME"],
            &["ROVAI_CONTEXT"],
            &["rovai_context"],
            &["KEY", " KEY "],
        ] {
            assert!(config(names).validated(false).is_err(), "{names:?}");
        }
        assert!(config(&["KEY", "key"]).validated(false).is_ok());
        assert!(config(&["KEY", "key"]).validated(true).is_err());
        let mut invalid = config(&["KEY"]);
        invalid.environment[0].value = "value\0tail".into();
        assert!(invalid.validated(false).is_err());
        assert!(
            serde_json::from_value::<RuntimeStartupConfiguration>(
                serde_json::json!({"environment": [], "system": true})
            )
            .is_err()
        );
    }

    // Runtime-local scope and cancellation restoration are new launch semantics. Two
    // concurrent scopes prove isolation without mutating the test runner's environment.
    #[tokio::test]
    async fn runtime_overlays_are_scoped_and_do_not_modify_the_parent_or_other_runtimes() {
        use crate::runtime_discovery::{
            RuntimeSearchEnvironment, configure_runtime_command, runtime_environment_variable,
            with_runtime_configuration,
        };
        let key = "STARTUP_ISOLATION_TEST_SENTINEL";
        let inherited = std::env::var_os(key);
        let scope = |value: &str| {
            RuntimeSearchEnvironment::for_test_paths(1, Vec::new()).with_startup_configuration(
                AdapterKind::CodexCli,
                RuntimeStartupConfiguration {
                    custom_api: None,
                    custom_api_snapshot: None,
                    program_path: None,
                    environment: vec![RuntimeEnvironmentVariable {
                        name: key.into(),
                        value: value.into(),
                    }],
                },
            )
        };
        let first = scope("first-private-value");
        let second = scope("second-private-value");
        let check = |search: RuntimeSearchEnvironment, expected: &'static str| async move {
            with_runtime_configuration(AdapterKind::CodexCli, &search, async {
                tokio::task::yield_now().await;
                let mut command = tokio::process::Command::new("fixture-only-never-spawned");
                configure_runtime_command(AdapterKind::CodexCli, &mut command);
                assert_eq!(
                    command
                        .as_std()
                        .get_envs()
                        .find(|(name, _)| *name == key)
                        .unwrap()
                        .1,
                    Some(std::ffi::OsStr::new(expected))
                );
                assert_eq!(
                    runtime_environment_variable(AdapterKind::CodexCli, key).as_deref(),
                    Some(std::ffi::OsStr::new(expected))
                );
                let mut other = tokio::process::Command::new("fixture-only-never-spawned");
                configure_runtime_command(AdapterKind::Pi, &mut other);
                assert!(!other.as_std().get_envs().any(|(name, _)| name == key));
            })
            .await;
        };
        tokio::join!(
            check(first, "first-private-value"),
            check(second, "second-private-value")
        );
        assert_eq!(std::env::var_os(key), inherited);
        assert_eq!(
            runtime_environment_variable(AdapterKind::CodexCli, key),
            inherited
        );
    }
}
