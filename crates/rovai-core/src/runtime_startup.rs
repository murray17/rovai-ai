//! Machine-local launch preferences. Values never enter public Runtime evidence.
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::{Result, bail, ensure};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{agent_profile::AdapterKind, db::Database};

#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeStartupConfiguration {
    pub program_path: Option<String>,
    #[serde(default)]
    pub environment: Vec<RuntimeEnvironmentVariable>,
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

pub fn load(database: &Database, runtime_kind: AdapterKind) -> Result<RuntimeStartupSettings> {
    let row: Option<(i64, String)> = database.connection().query_row(
        "SELECT revision, configuration_json FROM runtime_startup_setting WHERE runtime_kind = ?1",
        [runtime_kind.as_str()], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional()?;
    let (revision, configuration) = match row {
        Some((revision, json)) => (u64::try_from(revision)?, serde_json::from_str(&json)?),
        None => (0, RuntimeStartupConfiguration::default()),
    };
    Ok(RuntimeStartupSettings {
        runtime_kind,
        revision,
        configuration,
    })
}

pub fn load_all(database: &Database) -> Result<BTreeMap<AdapterKind, RuntimeStartupConfiguration>> {
    let mut configurations = BTreeMap::new();
    for kind in AdapterKind::ALL {
        let settings = load(database, kind)?;
        if settings.revision != 0 {
            configurations.insert(kind, settings.configuration.validated(cfg!(windows))?);
        }
    }
    Ok(configurations)
}

/// The row and old readiness evidence change together; an active process keeps
/// its already-captured environment. CAS prevents a stale editor overwriting it.
pub fn save(
    database: &mut Database,
    kind: AdapterKind,
    expected_revision: u64,
    configuration: RuntimeStartupConfiguration,
    search_generation: u64,
) -> Result<RuntimeStartupSettings> {
    let configuration = configuration.validated(cfg!(windows))?;
    let current = load(database, kind)?;
    if current.revision > 0 && current.configuration == configuration {
        return Ok(current);
    }
    if current.revision != expected_revision {
        bail!("启动设置已被更新，请重新读取后再保存。");
    }
    let revision = current
        .revision
        .checked_add(1)
        .ok_or_else(|| anyhow::anyhow!("启动设置版本超出范围。"))?;
    let transaction = database.connection_mut().transaction()?;
    transaction.execute(
        "INSERT INTO runtime_startup_setting(runtime_kind, revision, configuration_json, updated_at)
         VALUES (?1, ?2, ?3, datetime('now')) ON CONFLICT(runtime_kind) DO UPDATE SET
         revision = excluded.revision, configuration_json = excluded.configuration_json, updated_at = excluded.updated_at",
        params![kind.as_str(), i64::try_from(revision)?, serde_json::to_string(&configuration)?],
    )?;
    transaction.execute("UPDATE adapter_capability_snapshot SET stale_at = COALESCE(stale_at, datetime('now')),
        authentication_status='unknown', probe_status='installed_unverified', last_error='runtime_startup_configuration_changed'
        WHERE installation_id IN (SELECT id FROM adapter_installation WHERE adapter_kind = ?1 AND installation_class = 'managed_default')", [kind.as_str()])?;
    transaction.execute("UPDATE adapter_installation SET generation = generation + 1, version = version + 1,
        updated_at = datetime('now') WHERE adapter_kind = ?1 AND installation_class = 'managed_default'", [kind.as_str()])?;
    transaction.execute("INSERT INTO runtime_search_environment_state(singleton, generation, captured_at) VALUES(1, ?1, datetime('now')) ON CONFLICT(singleton) DO UPDATE SET generation=excluded.generation, captured_at=excluded.captured_at", [i64::try_from(search_generation)?])?;
    transaction.commit()?;
    Ok(RuntimeStartupSettings {
        runtime_kind: kind,
        revision,
        configuration,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // New editor-input boundary; no database/process fixture is needed for this matrix.
    #[test]
    fn environment_validation_preserves_values_and_rejects_ambiguous_or_reserved_names() {
        let config = |names: &[&str]| RuntimeStartupConfiguration {
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
