//! Machine-local launch preferences. Values never enter public Runtime evidence.
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::{Result, ensure};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{
    agent_profile::AdapterKind,
    db::Database,
    runtime_custom_api::{CustomApiSnapshot, native},
};

#[derive(Clone, Default, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeStartupConfiguration {
    pub program_path: Option<String>,
    #[serde(default)]
    pub environment: Vec<RuntimeEnvironmentVariable>,
    /// Resolved by the Host from its private stored references, never accepted from clients.
    #[serde(skip)]
    pub custom_api_snapshot: Option<CustomApiSnapshot>,
}

impl PartialEq for RuntimeStartupConfiguration {
    fn eq(&self, other: &Self) -> bool {
        self.program_path == other.program_path && self.environment == other.environment
    }
}

impl std::fmt::Debug for RuntimeStartupConfiguration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RuntimeStartupConfiguration")
            .field("program_path", &self.program_path)
            .field("environment_count", &self.environment.len())
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
    pub reconnect_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldEdit {
    pub path: Vec<String>,
    pub before: serde_json::Value,
    pub after: serde_json::Value,
    pub label: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldConflict {
    #[serde(flatten)]
    pub edit: FieldEdit,
    pub current: serde_json::Value,
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
) -> Result<(u64, RuntimeStartupConfiguration)> {
    let row: Option<(i64, String)> = connection.query_row(
        "SELECT revision, configuration_json FROM runtime_startup_setting WHERE runtime_kind = ?1",
        [runtime_kind.as_str()], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional()?;
    let Some((revision, json)) = row else {
        let mut configuration = RuntimeStartupConfiguration::default();
        if native::supported(runtime_kind) {
            // Share the actual legacy custom entrypoint with reads, saves and
            // execution snapshots, not only the settings page's display fallback.
            configuration.program_path = connection.query_row(
                "SELECT COALESCE(locator.canonical_shim_path, installation.executable_path)
                 FROM adapter_installation AS installation
                 LEFT JOIN adapter_capability_snapshot AS snapshot ON snapshot.installation_id=installation.id
                 LEFT JOIN runtime_entrypoint_locator_identity AS locator ON locator.installation_id=installation.id
                    AND locator.resolved_target_path=installation.executable_path
                    AND locator.resolved_target_fingerprint=snapshot.executable_fingerprint
                 WHERE installation.adapter_kind=?1 AND installation.auth_scope='default'
                    AND installation.installation_class='managed_default' AND installation.source IN ('custom','manual')",
                [runtime_kind.as_str()], |row| row.get(0),
            ).optional()?;
        }
        return Ok((0, configuration));
    };
    let mut value: serde_json::Value = serde_json::from_str(&json)?;
    // Ignore legacy UI selection; native configuration alone chooses the connection.
    if let Some(object) = value.as_object_mut() {
        object.remove("_connectionMode");
        object.remove("customApi");
    }
    Ok((u64::try_from(revision)?, serde_json::from_value(value)?))
}

pub fn load(database: &Database, kind: AdapterKind) -> Result<RuntimeStartupSettings> {
    let (revision, mut configuration) = load_record(database.connection(), kind)?;
    // Read-only compatibility and redaction evidence. No native settings or keys
    // are exposed by the editor, and a native parse error cannot block local prefs.
    configuration.custom_api_snapshot = native_snapshot(kind, &configuration, database.path());
    Ok(RuntimeStartupSettings {
        runtime_kind: kind,
        revision,
        configuration,
        reconnect_required: false,
    })
}

fn native_snapshot(
    kind: AdapterKind,
    configuration: &RuntimeStartupConfiguration,
    database: &Path,
) -> Option<CustomApiSnapshot> {
    if !native::supported(kind) {
        return None;
    }
    native::NativeContext::resolve(kind, configuration, database)
        .and_then(|context| native::read(&context, None).map(|read| read.snapshot(&context, false)))
        .ok()
}

pub fn saved_response(settings: RuntimeStartupSettings) -> RuntimeStartupSettings {
    public(settings)
}

/// Never return native credential values or legacy secret environment rows.
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
        !sensitive_environment(settings.runtime_kind, &entry.name)
            && referenced.as_deref() != Some(entry.name.as_str())
    });
    settings
}
pub fn sensitive_environment(kind: AdapterKind, name: &str) -> bool {
    match kind {
        AdapterKind::ClaudeCodeCli => matches!(
            name.to_ascii_uppercase().as_str(),
            "ANTHROPIC_API_KEY" | "ANTHROPIC_AUTH_TOKEN" | "CLAUDE_CODE_OAUTH_TOKEN"
        ),
        AdapterKind::CodexCli => matches!(
            name.to_ascii_uppercase().as_str(),
            "OPENAI_API_KEY" | "CODEX_API_KEY" | "CODEX_ACCESS_TOKEN"
        ),
        _ => false,
    }
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

pub fn editable(
    kind: AdapterKind,
    configuration: &RuntimeStartupConfiguration,
) -> serde_json::Value {
    use serde_json::json;
    let value = json!({"programPath":configuration.program_path, "environment":configuration.environment.iter().filter(|e| !sensitive_environment(kind, &e.name)).map(|entry| (entry.name.clone(), json!(entry.value))).collect::<serde_json::Map<_,_>>()});
    value
}
/// Field edits merge independent changes without overwriting an external update.
pub fn ordinary_edits(
    kind: AdapterKind,
    before: &RuntimeStartupConfiguration,
    after: &RuntimeStartupConfiguration,
) -> Vec<FieldEdit> {
    let before = editable(kind, before);
    let after = editable(kind, after);
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
            let old = value_at(&before, &path);
            let next = value_at(&after, &path);
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
            !sensitive_environment(kind, name) && !name.to_ascii_uppercase().starts_with("ROVAI_")
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
) -> Result<PreparedSave> {
    ensure!(edits.len() <= 512, "修改字段过多。");
    let current = load(database, kind)?;
    let visible = public(current.clone());
    let mut value = editable(kind, &visible.configuration);
    let mut conflicts = Vec::new();
    let mut seen = BTreeSet::new();
    for edit in &edits {
        ensure!(
            allowed_edit(edit, kind) && seen.insert(edit.path.clone()),
            "修改字段无效或重复。"
        );
        let now = value_at(&value, &edit.path).clone();
        if now != edit.before && now != edit.after {
            conflicts.push(FieldConflict {
                edit: edit.clone(),
                current: now,
            });
        }
        set_at(&mut value, &edit.path, edit.after.clone())?;
    }
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
    let (revision, previous) = load_record(database.connection(), kind)?;
    if revision > 0 && previous == configuration {
        return load(database, kind);
    }
    persist(
        database,
        kind,
        expected_revision,
        configuration,
        search_generation,
        true,
    )?;
    load(database, kind)
}
pub fn commit_save(
    database: &mut Database,
    kind: AdapterKind,
    prepared: PreparedSave,
    search_generation: u64,
) -> Result<RuntimeStartupSettings> {
    ensure!(prepared.conflicts.is_empty(), "请先处理字段冲突。");
    let reconnect_required = prepared.configuration != prepared.current.configuration;
    persist(
        database,
        kind,
        prepared.current.revision,
        prepared.configuration,
        search_generation,
        reconnect_required,
    )?;
    let mut saved = load(database, kind)?;
    saved.reconnect_required = reconnect_required;
    Ok(saved)
}

fn value_at<'a>(value: &'a serde_json::Value, path: &[String]) -> &'a serde_json::Value {
    path.iter().fold(value, |value, key| &value[key])
}
fn set_at(value: &mut serde_json::Value, path: &[String], next: serde_json::Value) -> Result<()> {
    let mut target = value;
    for key in path {
        target = target
            .as_object_mut()
            .ok_or_else(|| anyhow::anyhow!("修改字段无效。"))?
            .entry(key.clone())
            .or_insert(serde_json::Value::Null);
    }
    *target = next;
    Ok(())
}

fn persist(
    database: &mut Database,
    kind: AdapterKind,
    expected_revision: u64,
    mut configuration: RuntimeStartupConfiguration,
    search_generation: u64,
    invalidate: bool,
) -> Result<()> {
    configuration = configuration.validated(cfg!(windows))?;
    let (current, _) = load_record(database.connection(), kind)?;
    configuration.custom_api_snapshot = None;
    ensure!(
        current == expected_revision,
        "启动设置已被更新，请保留草稿并再次保存。"
    );
    let revision = current
        .checked_add(1)
        .ok_or_else(|| anyhow::anyhow!("启动设置版本超出范围。"))?;
    let stored = serde_json::to_value(&configuration)?;
    let transaction = database.connection_mut().transaction()?;
    transaction.execute("INSERT INTO runtime_startup_setting(runtime_kind, revision, configuration_json, updated_at) VALUES (?1, ?2, ?3, datetime('now')) ON CONFLICT(runtime_kind) DO UPDATE SET revision=excluded.revision, configuration_json=excluded.configuration_json, updated_at=excluded.updated_at", params![kind.as_str(), i64::try_from(revision)?, serde_json::to_string(&stored)?])?;
    if invalidate {
        transaction.execute("UPDATE adapter_capability_snapshot SET stale_at=COALESCE(stale_at, datetime('now')), authentication_status='unknown', probe_status='installed_unverified', last_error='runtime_startup_configuration_changed' WHERE installation_id IN (SELECT id FROM adapter_installation WHERE adapter_kind=?1 AND installation_class='managed_default')", [kind.as_str()])?;
        transaction.execute("UPDATE adapter_installation SET generation=generation+1, version=version+1, updated_at=datetime('now') WHERE adapter_kind=?1 AND installation_class='managed_default'", [kind.as_str()])?;
        transaction.execute("INSERT INTO runtime_search_environment_state(singleton, generation, captured_at) VALUES(1, ?1, datetime('now')) ON CONFLICT(singleton) DO UPDATE SET generation=excluded.generation, captured_at=excluded.captured_at", [i64::try_from(search_generation)?])?;
    }
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
    let (_, configuration) = load_record(connection, kind)?;
    let Some(database_path) = connection.path() else {
        return Ok(None);
    };
    Ok(
        native::NativeContext::resolve(kind, &configuration, Path::new(database_path))
            .and_then(|context| {
                native::read(&context, None).map(|read| read.snapshot(&context, false))
            })
            .ok(),
    )
}
/// Explicit checks use the saved native connection; startup drafts never edit it.
pub fn resolve_draft(
    database: &Database,
    kind: AdapterKind,
    mut configuration: RuntimeStartupConfiguration,
) -> Result<RuntimeStartupConfiguration> {
    configuration = configuration.validated(cfg!(windows))?;
    configuration.custom_api_snapshot = native_snapshot(kind, &configuration, database.path());
    Ok(configuration)
}

#[cfg(test)]
mod tests {
    use super::*;

    // New editor-input boundary; no database/process fixture is needed for this matrix.
    #[test]
    fn environment_validation_preserves_values_and_rejects_ambiguous_or_reserved_names() {
        let config = |names: &[&str]| RuntimeStartupConfiguration {
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
        for kind in AdapterKind::ALL {
            for name in ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] {
                let restricted = (kind == AdapterKind::ClaudeCodeCli
                    && name == "ANTHROPIC_API_KEY")
                    || (kind == AdapterKind::CodexCli && name == "OPENAI_API_KEY");
                let configuration = config(&[name]);
                let edits = ordinary_edits(
                    kind,
                    &RuntimeStartupConfiguration::default(),
                    &configuration,
                );
                assert_eq!(edits.is_empty(), restricted, "{kind:?}/{name}");
                let edit = FieldEdit {
                    path: vec!["environment".into(), name.into()],
                    before: serde_json::Value::Null,
                    after: serde_json::json!("fixture-key"),
                    label: String::new(),
                };
                assert_eq!(allowed_edit(&edit, kind), !restricted);
                let public = public(RuntimeStartupSettings {
                    runtime_kind: kind,
                    revision: 0,
                    configuration,
                    reconnect_required: false,
                });
                assert_eq!(public.configuration.environment.is_empty(), restricted);
            }
        }
        for retired in ["customApi", "customApiSnapshot", "apiKey"] {
            let input = serde_json::json!({"programPath":null,"environment":[],retired:{"value":"fake-key"}});
            assert!(serde_json::from_value::<RuntimeStartupConfiguration>(input).is_err());
        }
        for path in [
            vec!["mode"],
            vec!["baseUrl"],
            vec!["credentialVersion"],
            vec!["nativeRevision"],
            vec!["codexModels", "row"],
            vec!["claudeModels", "model"],
        ] {
            let edit = FieldEdit {
                path: path.into_iter().map(str::to_owned).collect(),
                before: serde_json::Value::Null,
                after: serde_json::Value::Null,
                label: String::new(),
            };
            for kind in [AdapterKind::ClaudeCodeCli, AdapterKind::CodexCli] {
                assert!(!allowed_edit(&edit, kind));
            }
        }
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
