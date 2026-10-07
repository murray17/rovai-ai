use crate::{
    agent_profile::AdapterKind,
    managed_process::{
        ManagedProcess, ManagedProcessLaunchSpec, ManagedProcessPurpose, ManagedStdinPolicy,
        ManagedWindowsArgvDialect,
    },
    mcp::McpServerDefinition,
};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::{io::AsyncReadExt, process::Command};

pub(super) fn private_dir(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub(super) fn private_file(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    private_dir(path.parent().context("Cline private file has no parent")?)?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)?.write_all(bytes)?;
    Ok(())
}

pub(super) fn read_json(path: &Path) -> Result<Option<Value>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(
            serde_json::from_slice(&bytes).context("cline_native_config_invalid")?,
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => bail!("cline_native_config_unreadable"),
    }
}

fn environment(name: &str) -> Option<String> {
    crate::runtime_discovery::runtime_environment_variable(AdapterKind::ClineCli, name)
        .and_then(|v| v.into_string().ok())
        .filter(|v| !v.trim().is_empty())
}

/// Invalid or ambiguous native preferences must never silently enable compaction.
pub(super) fn compaction_setting(settings: &Value, help: &str) -> Result<Value> {
    let enabled = match settings.get("compactionEnabled") {
        None => None,
        Some(Value::Bool(value)) => Some(*value),
        Some(_) => bail!("cline_compaction_preference_invalid"),
    };
    let strategy = match settings.get("compactionStrategy") {
        None => None,
        Some(Value::String(value)) if matches!(value.as_str(), "basic" | "agentic") => {
            Some(value.as_str())
        }
        Some(_) => bail!("cline_compaction_preference_invalid"),
    };
    if enabled == Some(false) {
        return Ok(json!({"enabled":false}));
    }
    let mut option = String::new();
    for line in help
        .lines()
        .skip_while(|line| !line.contains("--compaction "))
    {
        if !option.is_empty() && line.trim_start().starts_with('-') {
            break;
        }
        option.push(' ');
        option.push_str(line.trim());
    }
    let default = option
        .split_once("default:")
        .and_then(|(_, value)| value.split(')').next())
        .map(|value| value.trim().trim_matches(['"', '\'']));
    let mode = strategy
        .or(default)
        .context("cline_compaction_default_unverified")?;
    match mode {
        "off" if enabled != Some(true) => Ok(json!({"enabled":false})),
        "basic" | "agentic" => Ok(json!({"enabled":true,"strategy":mode})),
        _ => bail!("cline_compaction_default_unverified"),
    }
}

pub(super) async fn native_help(executable: &Path) -> Result<String> {
    native_cli_output(executable, "--help").await
}

pub(super) async fn native_cli_output(executable: &Path, argument: &str) -> Result<String> {
    let mut command = Command::new(executable);
    crate::runtime_discovery::configure_runtime_command(AdapterKind::ClineCli, &mut command);
    command.arg(argument);
    let spec = ManagedProcessLaunchSpec::capture(
        &command,
        ManagedProcessPurpose::RuntimeProbe,
        ManagedStdinPolicy::Null,
        ManagedWindowsArgvDialect::MicrosoftCrt,
        "cline-hub-help",
    )?;
    let mut child = ManagedProcess::spawn(spec)?;
    let stdout = child
        .take_stdout()
        .context("Cline help stdout unavailable")?;
    let stderr = child
        .take_stderr()
        .context("Cline help stderr unavailable")?;
    let result = tokio::time::timeout(Duration::from_secs(10), async {
        let mut bytes = Vec::new();
        let mut errors = Vec::new();
        let mut stdout = stdout.take(512 * 1024);
        let mut stderr = stderr.take(512 * 1024);
        tokio::try_join!(
            stdout.read_to_end(&mut bytes),
            stderr.read_to_end(&mut errors)
        )?;
        if !child.wait().await?.success() {
            bail!("cline_help_failed");
        }
        Ok::<_, anyhow::Error>(String::from_utf8_lossy(&bytes).into_owned())
    })
    .await;
    let _ = child.force_terminate_tree();
    let _ = tokio::time::timeout(Duration::from_secs(1), child.wait()).await;
    result.context("cline_help_timeout")?
}

pub(super) fn rules_digest() -> Result<String> {
    fn collect(root: &Path, path: &Path, entries: &mut BTreeMap<PathBuf, String>) -> Result<()> {
        if !path.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                collect(root, &entry.path(), entries)?;
            } else if entry.path().is_file() {
                entries.insert(
                    entry.path().strip_prefix(root)?.to_owned(),
                    crate::command::canonical_json_digest(&json!(fs::read(entry.path())?))?,
                );
            }
        }
        Ok(())
    }
    let root = crate::cline::runtime_native_paths()?.config.join("rules");
    let mut entries = BTreeMap::new();
    collect(&root, &root, &mut entries)?;
    crate::command::canonical_json_digest(&json!(entries))
}

// A snapshot is necessary: editing a process-global Rule while another native
// Session exists would change that Session's frozen identity. The snapshot hash
// is part of Fleet compatibility; project Rules continue to be discovered natively.
fn snapshot_rules(source: &Path, destination: &Path) -> Result<()> {
    if !source.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            private_dir(&target)?;
            snapshot_rules(&entry.path(), &target)?;
        } else if entry.path().is_file() {
            private_file(&target, &fs::read(entry.path())?)?;
        }
    }
    Ok(())
}

pub(super) struct NativeConfiguration {
    pub session: Value,
    pub discovery: PathBuf,
}

pub(super) const OWNED_HOST_MARKER: &str = ".rovai-cline-hub-host";

#[cfg(target_os = "macos")]
pub(super) fn recover_hosts(root: &Path) -> Result<()> {
    ManagedProcess::recover_runtime_descendants(root)?;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let marker = entry.path().join(OWNED_HOST_MARKER);
        if !fs::symlink_metadata(&marker).is_ok_and(|meta| meta.file_type().is_file())
            || fs::read(&marker).ok().as_deref() != Some(super::PROTOCOL.as_bytes())
        {
            continue;
        }
        // Recovery removes a ledger only after every recorded kernel identity
        // has exited. A surviving/live-owner ledger must retain its private files.
        let ledgers_remain = match fs::read_dir(entry.path().join("owned-processes")) {
            Ok(entries) => entries
                .collect::<std::io::Result<Vec<_>>>()?
                .iter()
                .any(|entry| entry.path().extension().is_some_and(|ext| ext == "json")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(error.into()),
        };
        if !ledgers_remain {
            fs::remove_dir_all(entry.path())?;
        }
    }
    Ok(())
}

/// Bind the bundled CLI at the native Bash command boundary. Bun's socket
/// stdin can make Bash source ~/.bashrc even for a non-interactive command,
/// which changes PATH and skips BASH_ENV. An exported function retains the
/// selected executable without modifying the user's shell files or tool input.
pub(super) fn configure_tool_shell(command: &mut Command) {
    command.env(
        "BASH_FUNC_rovai%%",
        "() { command \"$ROVAI_AGENT_CLI\" \"$@\"; }",
    );
}

pub(super) async fn configure(
    command: &mut Command,
    root: &Path,
    history: &Path,
    cwd: &Path,
    executable: &Path,
    selected_model: Option<&str>,
    bootstrap: &str,
    servers: &BTreeMap<String, McpServerDefinition>,
) -> Result<NativeConfiguration> {
    let paths = crate::cline::runtime_native_paths()?;
    let saved = read_json(&paths.providers)?.unwrap_or(Value::Null);
    let provider = environment("CLINE_PROVIDER")
        .or_else(|| saved["lastUsedProvider"].as_str().map(str::to_owned))
        .context("cline_native_provider_unconfigured")?;
    let settings = &saved["providers"][&provider]["settings"];
    let model = if selected_model.is_none() {
        environment("CLINE_MODEL")
            .or_else(|| settings["model"].as_str().map(str::to_owned))
            .context("cline_native_model_unconfigured")?
    } else {
        selected_model.unwrap().to_owned()
    };
    let key =
        environment("CLINE_API_KEY").or_else(|| settings["apiKey"].as_str().map(str::to_owned));
    // Authentication is Cline's own saved provider state. No other Runtime or
    // experimental SDK is consulted; unavailable native credentials fail closed.
    let key = key
        .filter(|v| !v.is_empty())
        .context("cline_hub_native_provider_credentials_unavailable")?;
    let catalog = read_json(&paths.data.join("settings/models.json"))?.unwrap_or(Value::Null);
    let preferences = read_json(&paths.settings)?.unwrap_or_else(|| json!({}));
    if !preferences.is_object() {
        bail!("cline_native_settings_invalid");
    }
    let compaction = compaction_setting(&preferences, &native_help(executable).await?)?;
    private_dir(root)?;
    private_dir(history)?;
    // The native runtime may persist provider metadata while starting a
    // Session. Give it copies so even those writes cannot touch source settings.
    let providers_path = root.join("providers.json");
    let preferences_path = root.join("global-settings.json");
    private_file(&providers_path, &serde_json::to_vec(&saved)?)?;
    private_file(&preferences_path, &serde_json::to_vec(&preferences)?)?;
    let config = root.join("config");
    private_dir(&config.join("rules"))?;
    snapshot_rules(&paths.config.join("rules"), &config.join("rules"))?;
    private_file(&config.join("rules").join(format!("rovai-managed-{}.md", crate::command::canonical_json_digest(&json!(bootstrap))?)), format!("<!-- Rovai frozen native Rule -->\n{bootstrap}\n<!-- End Rovai frozen native Rule -->\n").as_bytes())?;
    #[cfg(unix)]
    for name in ["skills", "workflows", "hooks", "plugins"] {
        let source = paths.config.join(name);
        if source.exists() {
            std::os::unix::fs::symlink(source, config.join(name))?;
        }
    }
    let mut mcp = read_json(&paths.mcp)?.unwrap_or_else(|| json!({"mcpServers":{}}));
    let definitions = mcp["mcpServers"]
        .as_object_mut()
        .context("cline_native_mcp_config_invalid")?;
    for (name, definition) in servers {
        let mut definition = serde_json::to_value(definition)?;
        if definition.get("url").is_some() {
            definition["type"] = json!("streamableHttp");
        }
        definitions.insert(name.clone(), definition);
    }
    let mcp_path = root.join("mcp.json");
    private_file(&mcp_path, &serde_json::to_vec(&mcp)?)?;
    let discovery = root.join("discovery.json");
    for name in [
        "CLINE_HUB_URL",
        "CLINE_HUB_TOKEN",
        "CLINE_HUB_BUILD_ID",
        "CLINE_HUB_PORT",
        "CLINE_SESSION_DATA_DIR",
    ] {
        command.env_remove(name);
    }
    command
        .args([
            "hub",
            "--host",
            "127.0.0.1",
            "--port",
            "0",
            "--pathname",
            "/hub",
            "--cwd",
        ])
        .arg(cwd)
        .arg("start")
        .current_dir(cwd)
        .env("CLINE_DIR", config)
        .env("CLINE_DATA_DIR", history)
        .env("CLINE_PROVIDER_SETTINGS_PATH", providers_path)
        .env("CLINE_GLOBAL_SETTINGS_PATH", preferences_path)
        .env("CLINE_MCP_SETTINGS_PATH", mcp_path)
        .env("CLINE_HUB_DISCOVERY_PATH", &discovery)
        .env("CLINE_SESSION_BACKEND_MODE", "local");
    let mut session = json!({"providerId":provider,"modelId":model,"apiKey":key,
        "cwd":cwd,"workspaceRoot":cwd,"compaction":compaction});
    for field in ["baseUrl", "reasoningEffort"] {
        if let Some(value) = settings.get(field) {
            session[field] = value.clone();
        }
    }
    if let Some(models) = catalog["providers"][&provider].get("models") {
        session["knownModels"] = models.clone();
    }
    Ok(NativeConfiguration { session, discovery })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_compaction_preferences_preserve_off_and_reject_unknown_defaults() {
        let help = "  --compaction <mode> Context compaction mode: agentic|basic|off\n                                (default: basic)\n  -i, --tui Next option";
        for (settings, expected) in [
            (json!({}), json!({"enabled":true,"strategy":"basic"})),
            (json!({"compactionEnabled":false}), json!({"enabled":false})),
            (
                json!({"compactionStrategy":"agentic"}),
                json!({"enabled":true,"strategy":"agentic"}),
            ),
        ] {
            assert_eq!(compaction_setting(&settings, help).unwrap(), expected);
        }
        for settings in [
            json!({"compactionEnabled":"false"}),
            json!({"compactionStrategy":"unknown"}),
            json!({"compactionStrategy":null}),
        ] {
            assert!(compaction_setting(&settings, help).is_err());
        }
        assert!(compaction_setting(&json!({}), "unknown installed help").is_err());
        assert_eq!(
            compaction_setting(&json!({"compactionEnabled":false}), "").unwrap(),
            json!({"enabled":false})
        );
    }
}
