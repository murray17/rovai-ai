//! Official Kilo ACP launch settings. Session, process and approval ownership
//! stay in the shared ACP/Fleet implementation.
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::process::Command;

use crate::{agent_profile::AdapterKind, runtime_discovery::runtime_environment_variable};

pub(crate) const BOOTSTRAP_FILE: &str = "bootstrap.md";

/// Applied result patches from Kilo's native write/edit and apply_patch tools.
/// Header/path validation and rendering remain in the shared Diff projection.
pub(crate) fn file_diff_entries(update: &Value) -> Option<Value> {
    let metadata = update.pointer("/rawOutput/metadata")?;
    if metadata["truncated"] == true {
        return None;
    }
    if let Some(files) = metadata["files"].as_array() {
        let entries: Option<Vec<_>> = files.iter().map(|file| {
            let change = file["type"].as_str()?;
            matches!(change, "add" | "update" | "delete").then_some(())?;
            Some(json!({"path":file["filePath"].as_str()?,"changeKind":change,"diff":file["patch"].as_str()?}))
        }).collect();
        return Some(json!(entries?));
    }
    let file = metadata.get("filediff")?;
    let path = file["file"].as_str()?;
    Some(
        json!([{"path":path,"changeKind":if metadata["exists"] == false {"add"} else {"update"},"diff":file["patch"].as_str()?}]),
    )
}

// Keep native rule order local to Kilo; do not change workspace JSON semantics.
#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum ConfigValue {
    Object(IndexMap<String, ConfigValue>),
    Array(Vec<ConfigValue>),
    Scalar(Value),
}

impl ConfigValue {
    fn append_instruction(&mut self, path: &Path) -> Result<()> {
        let Self::Object(config) = self else {
            anyhow::bail!("Kilo config must be an object")
        };
        let Self::Array(paths) = config
            .entry("instructions".into())
            .or_insert_with(|| Self::Array(Vec::new()))
        else {
            anyhow::bail!("Kilo instructions must be an array")
        };
        let path = path
            .to_str()
            .context("Kilo config path is not UTF-8")?
            .to_owned();
        if !paths
            .iter()
            .any(|item| matches!(item, Self::Scalar(Value::String(value)) if value == &path))
        {
            paths.push(Self::Scalar(Value::String(path)));
        }
        Ok(())
    }
}

pub(crate) fn database_path(
    spec: &crate::managed_process::ManagedProcessLaunchSpec,
) -> Option<PathBuf> {
    let root = spec
        .environment_value("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            spec.environment_value(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                .map(|home| PathBuf::from(home).join(".local/share"))
        })
        .or_else(|| dirs::home_dir().map(|home| home.join(".local/share")))?;
    let data = if root.is_absolute() {
        root
    } else {
        spec.working_directory().join(root)
    }
    .join("kilo");
    match spec
        .environment_value("KILO_DB")
        .filter(|value| !value.is_empty())
    {
        Some(value) if value == ":memory:" => None,
        Some(value) => {
            let path = PathBuf::from(value);
            Some(if path.is_absolute() {
                path
            } else {
                data.join(path)
            })
        }
        None => Some(data.join("kilo.db")),
    }
}

pub(crate) fn configure_command(command: &mut Command) {
    command
        .arg("acp")
        .env("KILO_CLIENT", "acp")
        .env("KILO_DISABLE_AUTOUPDATE", "1")
        .env("KILO_EXPERIMENTAL_BACKGROUND_SUBAGENTS", "false")
        .env("KILO_ENABLE_QUESTION_TOOL", "false");
}

pub(crate) fn configure_execution(command: &mut Command, bootstrap_file: &Path) -> Result<()> {
    let inherited = command
        .as_std()
        .get_envs()
        .find(|(key, _)| *key == "KILO_CONFIG_CONTENT")
        .map(|(_, value)| value.map(ToOwned::to_owned))
        .unwrap_or_else(|| {
            runtime_environment_variable(AdapterKind::KiloCli, "KILO_CONFIG_CONTENT")
        });
    let mut config = match inherited {
        Some(value) => {
            json5::from_str::<ConfigValue>(value.to_str().context("Kilo config is not UTF-8")?)
                .context("Kilo KILO_CONFIG_CONTENT is invalid")?
        }
        None => ConfigValue::Object(IndexMap::new()),
    };
    config.append_instruction(bootstrap_file)?;
    command.env("KILO_CONFIG_CONTENT", serde_json::to_string(&config)?);
    Ok(())
}
