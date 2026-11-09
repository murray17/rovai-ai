//! Official Kilo ACP launch settings. Session, process and approval ownership
//! stay in the shared ACP/Fleet implementation.
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use tokio::process::Command;

use crate::{agent_profile::AdapterKind, runtime_discovery::runtime_environment_variable};

pub(crate) const BOOTSTRAP_FILE: &str = "bootstrap.md";

pub(crate) fn data_dir(spec: &crate::managed_process::ManagedProcessLaunchSpec) -> Option<PathBuf> {
    let root = spec
        .environment_value("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            spec.environment_value(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                .map(|home| PathBuf::from(home).join(".local/share"))
        })
        .or_else(|| dirs::home_dir().map(|home| home.join(".local/share")))?;
    Some(
        if root.is_absolute() {
            root
        } else {
            spec.working_directory().join(root)
        }
        .join("kilo"),
    )
}

pub(crate) fn configure_command(command: &mut Command) {
    command
        .arg("acp")
        .env("KILO_CLIENT", "acp")
        .env("KILO_DISABLE_AUTOUPDATE", "1")
        .env("KILO_ENABLE_QUESTION_TOOL", "false");
}

pub(crate) fn configure_execution(
    command: &mut Command,
    permission: &str,
    bootstrap_file: &Path,
) -> Result<()> {
    ensure!(
        matches!(permission, "allow" | "ask" | "deny"),
        "Kilo permission must be allow, ask or deny"
    );
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
            json5::from_str::<Value>(value.to_str().context("Kilo config is not UTF-8")?)
                .context("Kilo KILO_CONFIG_CONTENT is invalid")?
        }
        None => json!({}),
    };
    let object = config
        .as_object_mut()
        .context("Kilo config must be an object")?;
    let permissions = object.entry("permission").or_insert_with(|| json!({}));
    // A native string is the shorthand for its wildcard permission.
    if permissions.is_string() {
        *permissions = json!({"*": permissions.as_str().unwrap()});
    }
    let permissions = permissions
        .as_object_mut()
        .context("Kilo permission must be a string or object")?;
    permissions.insert("*".into(), json!(permission));
    // ACP has no questionnaire UI; execution permissions keep their native rules.
    permissions.insert("question".into(), json!("deny"));
    let instructions = object
        .entry("instructions")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .context("Kilo instructions must be an array")?;
    let file = json!(
        bootstrap_file
            .to_str()
            .context("Kilo instructions path is not UTF-8")?
    );
    if !instructions.contains(&file) {
        instructions.push(file);
    }
    command.env("KILO_CONFIG_CONTENT", serde_json::to_string(&config)?);
    Ok(())
}
