//! Cline official ACP profile: native System Rule, bounded observations and tool interpretation.
//! Process ownership, transport, replay isolation and lifecycle belong to shared ACP.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{command::canonical_json_digest, mcp::McpServerDefinition};
use tokio::process::Command;

pub const OBSERVER_REVISION: &str = "cline-plugin-observer-v4";
const OBSERVER: &str = include_str!("cline/observer.js");
pub const BOOTSTRAP_REVISION: &str = "cline-immutable-host-rule-v2";
const MAX_OBSERVATION_BYTES: u64 = 32 * 1024;
const MAX_OBSERVATIONS: usize = 1024;

/// Private Plugin records have already passed Session/lease/sequence checks.
/// Only native numeric facts enter the shared local compaction display.
pub fn compaction_display(
    record: &Value,
) -> Option<crate::runtime_compaction_display::RuntimeCompactionDisplayEvent> {
    use crate::runtime_compaction_display::{
        RuntimeCompactionCompletionEvidence, RuntimeCompactionDisplayEvent,
        RuntimeCompactionDisplayPhase, RuntimeCompactionMessageSnapshot,
        RuntimeCompactionTokenSnapshot,
    };
    if record["kind"] != "compaction" {
        return None;
    }
    let phase = match record["phase"].as_str()? {
        "started" => RuntimeCompactionDisplayPhase::Started,
        "completed" => RuntimeCompactionDisplayPhase::Completed,
        _ => return None,
    };
    let mut event =
        RuntimeCompactionDisplayEvent::new(record["compactionId"].as_str()?, "cline-cli", phase)?;
    let count = |field: &str| {
        record[field]
            .as_u64()
            .filter(|value| *value <= 9_007_199_254_740_991)
    };
    let before = count("tokensBefore");
    let after = (phase == RuntimeCompactionDisplayPhase::Completed)
        .then(|| count("tokensAfter"))
        .flatten();
    if before.is_some() || after.is_some() {
        event.tokens = Some(RuntimeCompactionTokenSnapshot {
            before,
            after,
            ..Default::default()
        });
    }
    if phase == RuntimeCompactionDisplayPhase::Completed {
        event.completion_evidence = Some(RuntimeCompactionCompletionEvidence::NativeTerminal);
        if let Some(compacted) = count("messagesBefore")
            .zip(count("messagesAfter"))
            .and_then(|(before, after)| before.checked_sub(after))
        {
            event.messages = Some(RuntimeCompactionMessageSnapshot {
                compacted: Some(compacted),
            });
        }
    }
    Some(event)
}

pub fn runtime_native_paths() -> Result<NativePaths> {
    let adapter = crate::agent_profile::AdapterKind::ClineCli;
    let home = crate::runtime_discovery::runtime_home_directory(adapter)
        .context("Cline native Home is unavailable")?;
    Ok(NativePaths::resolve(&home, |name| {
        crate::runtime_discovery::runtime_environment_variable(adapter, name)
            .and_then(|value| value.into_string().ok())
    }))
}

pub fn runtime_configuration_digest() -> Result<String> {
    let adapter = crate::agent_profile::AdapterKind::ClineCli;
    let environment: BTreeMap<_, _> = [
        "CLINE_API_KEY",
        "CLINE_PROVIDER",
        "CLINE_MODEL",
        "CLINE_SESSION_DATA_DIR",
    ]
    .into_iter()
    .map(|name| {
        (
            name,
            crate::runtime_discovery::runtime_environment_variable(adapter, name)
                .map(|value| format!("{:x}", Sha256::digest(value.as_encoded_bytes()))),
        )
    })
    .collect();
    canonical_json_digest(
        &json!({"files":native_configuration_digest(&runtime_native_paths()?)?,"environment":environment,
            "bootstrapRevision":BOOTSTRAP_REVISION,"observerRevision":OBSERVER_REVISION}),
    )
}

pub fn configure_native_environment(command: &mut Command) -> Result<()> {
    let adapter = crate::agent_profile::AdapterKind::ClineCli;
    let environment = |name| {
        crate::runtime_discovery::runtime_environment_variable(adapter, name)
            .and_then(|value| value.into_string().ok())
            .filter(|s| !s.trim().is_empty())
    };
    let paths = runtime_native_paths()?;
    let saved = read_optional_json(&paths.providers)
        .ok()
        .flatten()
        .unwrap_or(Value::Null);
    let provider = environment("CLINE_PROVIDER")
        .or_else(|| saved["lastUsedProvider"].as_str().map(str::to_string));
    if let Some(provider) = provider {
        command.env("CLINE_PROVIDER", &provider);
        // The native ACP entry accepts BYOK through CLINE_API_KEY. Forward
        // only a static key from the selected Provider when not overridden;
        // native account tokens remain entirely in Cline's credential store.
        if environment("CLINE_API_KEY").is_none()
            && let Some(key) = saved["providers"][&provider]["settings"]["apiKey"]
                .as_str()
                .filter(|value| !value.is_empty())
        {
            command.env("CLINE_API_KEY", key);
        }
        let settings = &saved["providers"][&provider]["settings"];
        if environment("CLINE_MODEL").is_none()
            && let Some(model) = settings["model"].as_str().filter(|s| !s.is_empty())
        {
            command.env("CLINE_MODEL", model);
        }
    }
    command.env("CLINE_SESSION_BACKEND_MODE", "local");
    Ok(())
}

/// ACP can silently choose a catalog fallback when the saved BYOK model is
/// absent. Before the first prompt, compare the real Session's selection with
/// Cline's own configured default; an absent native preference stays native.
pub fn configured_native_model() -> Result<Option<String>> {
    let adapter = crate::agent_profile::AdapterKind::ClineCli;
    let environment = |name| {
        crate::runtime_discovery::runtime_environment_variable(adapter, name)
            .and_then(|value| value.into_string().ok())
            .filter(|value| !value.trim().is_empty())
    };
    if let Some(model) = environment("CLINE_MODEL") {
        return Ok(Some(model));
    }
    let saved = read_optional_json(&runtime_native_paths()?.providers)
        .ok()
        .flatten()
        .unwrap_or(Value::Null);
    let provider = environment("CLINE_PROVIDER")
        .or_else(|| saved["lastUsedProvider"].as_str().map(str::to_string));
    Ok(provider.and_then(|provider| {
        saved["providers"][&provider]["settings"]["model"]
            .as_str()
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }))
}

#[derive(Debug, Clone)]
pub struct NativePaths {
    pub config: PathBuf,
    pub data: PathBuf,
    pub providers: PathBuf,
    pub settings: PathBuf,
    pub mcp: PathBuf,
}

impl NativePaths {
    /// Resolve the selected native sources before Host-specific CLINE_DIR and
    /// CLINE_DATA_DIR isolate Rules, tools and session history.
    pub fn resolve(home: &Path, env: impl Fn(&str) -> Option<String>) -> Self {
        let path = |key: &str, fallback: PathBuf| {
            env(key)
                .filter(|v| !v.trim().is_empty())
                .map(PathBuf::from)
                .unwrap_or(fallback)
        };
        let config = path("CLINE_DIR", home.join(".cline"));
        let data = path("CLINE_DATA_DIR", config.join("data"));
        Self {
            providers: path(
                "CLINE_PROVIDER_SETTINGS_PATH",
                data.join("settings/providers.json"),
            ),
            settings: path(
                "CLINE_GLOBAL_SETTINGS_PATH",
                data.join("settings/global-settings.json"),
            ),
            mcp: path(
                "CLINE_MCP_SETTINGS_PATH",
                data.join("settings/cline_mcp_settings.json"),
            ),
            config,
            data,
        }
    }
}

/// Observe only the effective Provider. Native credentials remain native;
/// rotation is not a new Binding, even when optional account metadata is absent.
fn provider_configuration_identity(value: &Value, provider: Option<&str>) -> Value {
    let mut selected = provider
        .map(|id| value["providers"][id].clone())
        .unwrap_or(Value::Null);
    if let Some(record) = selected.as_object_mut() {
        record.remove("updatedAt");
    }
    if let Some(auth) = selected
        .pointer_mut("/settings/auth")
        .and_then(Value::as_object_mut)
    {
        for name in ["accessToken", "refreshToken", "expiresAt", "idToken"] {
            auth.remove(name);
        }
    }
    let mut metadata = value.clone();
    if let Some(root) = metadata.as_object_mut() {
        for name in ["providers", "lastUsedProvider", "updatedAt"] {
            root.remove(name);
        }
    }
    json!({"provider":provider,"configuration":selected,"metadata":metadata})
}

/// The digest contains hashes, never credential values.
pub fn native_configuration_digest(paths: &NativePaths) -> Result<String> {
    let explicit_provider = crate::runtime_discovery::runtime_environment_variable(
        crate::agent_profile::AdapterKind::ClineCli,
        "CLINE_PROVIDER",
    )
    .and_then(|value| value.into_string().ok())
    .filter(|value| !value.trim().is_empty());
    // Unknown/unreadable Provider formats belong to Cline, not an auth gate.
    let saved = fs::read(&paths.providers)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let provider = explicit_provider.as_deref().or_else(|| {
        saved
            .as_ref()
            .and_then(|value| value["lastUsedProvider"].as_str())
    });
    let catalog = paths
        .providers
        .parent()
        .context("Cline provider parent unavailable")?
        .join("models.json");
    let mut entries = Vec::new();
    for path in [&paths.providers, &paths.settings, &paths.mcp, &catalog] {
        let digest = match fs::read(path) {
            Ok(bytes) => Some(if path == &paths.providers && saved.is_some() {
                canonical_json_digest(&provider_configuration_identity(
                    saved.as_ref().unwrap(),
                    provider,
                ))?
            } else if path == &catalog && provider.is_some() {
                match serde_json::from_slice::<Value>(&bytes) {
                    Ok(value) => canonical_json_digest(&value["providers"][provider.unwrap()])?,
                    Err(_) => format!("{:x}", Sha256::digest(bytes)),
                }
            } else {
                format!("{:x}", Sha256::digest(bytes))
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) if path == &paths.providers => Some("unreadable".into()),
            Err(_) => bail!("cline_native_configuration_unreadable"),
        };
        entries.push((path.clone(), digest));
    }
    for path in native_plugin_paths(&paths.config.join("plugins"))? {
        entries.push((
            path.clone(),
            Some(format!("{:x}", Sha256::digest(fs::read(path)?))),
        ));
    }
    for (relative, bytes) in native_rules(&paths.config.join("rules"))? {
        entries.push((
            paths.config.join("rules").join(relative),
            Some(format!("{:x}", Sha256::digest(bytes))),
        ));
    }
    canonical_json_digest(
        &json!({"revision": "cline-native-acp-config-v4", "config": paths.config, "data": paths.data, "files": entries}),
    )
}

// Freeze native global Rules in the member Host; project Rules remain native.
// Never mutate or symlink the user's Rule directory when adding our immutable B.
fn native_rules(root: &Path) -> Result<BTreeMap<PathBuf, Vec<u8>>> {
    let mut rules = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        if !directory.exists() {
            continue;
        }
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                pending.push(entry.path());
            } else if entry.path().is_file() {
                rules.insert(
                    entry.path().strip_prefix(root)?.to_path_buf(),
                    fs::read(entry.path())?,
                );
            }
            ensure!(
                rules.len() + pending.len() <= 1024,
                "cline_native_rules_limit_exceeded"
            );
        }
    }
    Ok(rules)
}

pub fn configure_host(
    command: &mut Command,
    root: &Path,
    paths: &NativePaths,
    auto_approve: bool,
    servers: &BTreeMap<String, McpServerDefinition>,
) -> Result<()> {
    for directory in [
        root.to_path_buf(),
        root.join("bindings"),
        root.join("bootstrap"),
        root.join("observations"),
        root.join("config/plugins/rovai"),
    ] {
        fs::create_dir_all(&directory)?;
        private_mode(&directory, 0o700)?;
    }
    let private_config = root.join("config");
    if paths.config.exists() {
        for entry in fs::read_dir(&paths.config)? {
            let entry = entry?;
            if entry.file_name() == "plugins" || entry.file_name() == "rules" {
                continue;
            }
            native_link(&entry.path(), &private_config.join(entry.file_name()))?;
        }
    }
    let rules = native_rules(&paths.config.join("rules"))?;
    fs::create_dir_all(private_config.join("rules"))?;
    private_mode(&private_config.join("rules"), 0o700)?;
    for (relative, bytes) in rules {
        let target = private_config.join("rules").join(relative);
        fs::create_dir_all(target.parent().context("Cline Rule parent missing")?)?;
        write_private(&target, &bytes)?;
    }
    let observer = root.join("observer.js");
    write_private(&observer, OBSERVER.as_bytes())?;
    // Freeze only explicit native capacities with this Host's configuration.
    // Provider credentials and model instructions never enter the observer.
    let catalog_path = paths.data.join("settings/models.json");
    let windows = fs::metadata(&catalog_path)
        .ok()
        .filter(|meta| meta.len() <= 1024 * 1024)
        .and_then(|_| fs::read(&catalog_path).ok())
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .map(|catalog| native_model_windows(&catalog))
        .unwrap_or_default();
    write_private(
        &root.join("model-windows.json"),
        &serde_json::to_vec(&windows)?,
    )?;
    let mut plugins = native_plugin_paths(&paths.config.join("plugins"))?;
    plugins.push(observer);
    write_private(
        &private_config.join("plugins/rovai/package.json"),
        &serde_json::to_vec(&json!({
            "name": "rovai-cline-host", "private": true,
            "cline": {"plugins": [{"paths": plugins}]}
        }))?,
    )?;

    let mut mcp = read_optional_json(&paths.mcp)?.unwrap_or_else(|| json!({"mcpServers": {}}));
    let native = mcp
        .get_mut("mcpServers")
        .and_then(Value::as_object_mut)
        .context("cline_native_mcp_config_invalid")?;
    for (name, definition) in servers {
        // Whole-definition precedence; never retain native credentials/options
        // under a same-name Rovai assignment.
        let mut value = serde_json::to_value(definition)?;
        if value.get("url").is_some() {
            value["type"] = json!("streamableHttp");
        }
        native.insert(name.clone(), value);
    }
    let private_mcp = root.join("mcp.json");
    write_private(&private_mcp, &serde_json::to_vec(&mcp)?)?;
    command
        .args([
            "--acp",
            "--auto-approve",
            if auto_approve { "true" } else { "false" },
        ])
        .env("CLINE_SESSION_BACKEND_MODE", "local")
        .env("CLINE_DIR", &private_config)
        .env("CLINE_DATA_DIR", &paths.data)
        .env("CLINE_PROVIDER_SETTINGS_PATH", &paths.providers)
        .env("CLINE_GLOBAL_SETTINGS_PATH", &paths.settings)
        .env("CLINE_MCP_SETTINGS_PATH", private_mcp)
        .env("ROVAI_CLINE_OBSERVER_ROOT", root);
    Ok(())
}

fn native_model_windows(catalog: &Value) -> BTreeMap<String, BTreeMap<String, i64>> {
    let mut windows = BTreeMap::new();
    if catalog["version"] != 1 {
        return windows;
    }
    let Some(providers) = catalog["providers"].as_object() else {
        return windows;
    };
    for (provider, config) in providers {
        let Some(models) = config["models"].as_object() else {
            continue;
        };
        for (model, info) in models {
            if !provider.is_empty()
                && !model.is_empty()
                && let Some(window) = info["contextWindow"]
                    .as_i64()
                    .filter(|n| *n > 0 && *n <= 9_007_199_254_740_991)
            {
                windows
                    .entry(provider.clone())
                    .or_insert_with(BTreeMap::new)
                    .insert(model.clone(), window);
            }
        }
    }
    windows
}

fn read_optional_json(path: &Path) -> Result<Option<Value>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(
            serde_json::from_slice(&bytes).context("cline_native_config_invalid")?,
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => bail!("cline_native_config_unreadable"),
    }
}

fn native_link(source: &Path, destination: &Path) -> Result<()> {
    #[cfg(unix)]
    std::os::unix::fs::symlink(source, destination)?;
    #[cfg(windows)]
    if source.is_dir() {
        std::os::windows::fs::symlink_dir(source, destination)?;
    } else {
        std::os::windows::fs::symlink_file(source, destination)?;
    }
    Ok(())
}

/// Match CLI 3.0.65's public plugin discovery rules. Package manifests retain
/// their declared paths, Agent Plugins and node_modules are separate lanes,
/// and symlink entries are not recursively imported by native discovery.

fn native_plugin_paths(root: &Path) -> Result<Vec<PathBuf>> {
    let mut result = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(directory) = stack.pop() {
        if !directory.exists() || directory.join("plugin.json").is_file() {
            continue;
        }
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            let path = entry.path();
            if entry.file_type()?.is_dir() {
                if path.join("plugin.json").is_file() {
                    continue;
                }
                let manifest = read_optional_json(&path.join("package.json"))?;
                let mut declared = Vec::new();
                if let Some(plugins) = manifest
                    .as_ref()
                    .and_then(|v| v.pointer("/cline/plugins"))
                    .and_then(Value::as_array)
                {
                    for plugin in plugins {
                        if let Some(paths) = plugin.get("paths").and_then(Value::as_array) {
                            for item in paths.iter().filter_map(Value::as_str) {
                                let file = path.join(item);
                                if file.is_file() && is_plugin_file(&file) {
                                    declared.push(file);
                                }
                            }
                        }
                    }
                }
                if declared.is_empty() {
                    stack.push(path);
                } else {
                    result.extend(declared);
                }
            } else if entry.file_type()?.is_file() && is_plugin_file(&path) {
                result.push(path);
            }
            ensure!(
                result.len() + stack.len() <= 1024,
                "cline_native_plugin_budget_exceeded"
            );
        }
    }
    result.sort();
    result.dedup();
    Ok(result)
}

fn is_plugin_file(path: &Path) -> bool {
    matches!(path.extension().and_then(|v| v.to_str()), Some("js" | "ts"))
}

fn private_mode(path: &Path, mode: u32) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    let _ = (path, mode);
    Ok(())
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
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

pub fn bind_prompt(root: &Path, session_id: &str, lease_id: &str) -> Result<()> {
    ensure!(
        !session_id.is_empty() && !lease_id.is_empty(),
        "cline_empty_observer_binding"
    );
    let path = binding_path(root, session_id);
    // Shared ACP holds the Session exclusively. Replacing an existing lease is
    // forbidden: detach must first finish the old prompt and clear its lease.
    write_private(
        &path,
        &serde_json::to_vec(&json!({"schemaVersion":1,"sessionId":session_id,"leaseId":lease_id}))?,
    )
}

/// Frozen Session Bootstrap has a longer lifetime than the per-Prompt lease.
pub fn bind_bootstrap(root: &Path, session_id: &str, bootstrap: &str) -> Result<()> {
    ensure!(
        !session_id.is_empty()
            && session_id.len() <= 256
            && !bootstrap.trim().is_empty()
            && bootstrap.len() <= 32 * 1024,
        "cline_bootstrap_binding_invalid"
    );
    let rule_path = root.join("config/rules/rovai-managed-bootstrap.md");
    let rule = format!(
        "<!-- Rovai frozen native Rule -->\n{bootstrap}\n<!-- End Rovai frozen native Rule -->\n"
    );
    if rule_path.exists() {
        ensure!(
            fs::read(&rule_path)? == rule.as_bytes(),
            "cline_bootstrap_host_incompatible"
        );
    } else {
        write_private(&rule_path, rule.as_bytes())?;
    }
    let path = root
        .join("bootstrap")
        .join(format!("{:x}.json", Sha256::digest(session_id.as_bytes())));
    let payload = serde_json::to_vec(&json!({"schemaVersion":1,"sessionId":session_id,
        "bootstrap":bootstrap,"sha256":format!("{:x}", Sha256::digest(bootstrap.as_bytes()))}))?;
    if path.exists() {
        ensure!(
            fs::read(path)? == payload,
            "cline_bootstrap_binding_changed"
        );
        return Ok(());
    }
    let temporary = root
        .join("bootstrap")
        .join(format!("{}.tmp", uuid::Uuid::new_v4()));
    write_private(&temporary, &payload)?;
    fs::rename(temporary, path)?;
    Ok(())
}

pub fn unbind_prompt(root: &Path, session_id: &str) -> Result<()> {
    match fs::remove_file(binding_path(root, session_id)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn binding_path(root: &Path, session_id: &str) -> PathBuf {
    root.join("bindings")
        .join(format!("{:x}.json", Sha256::digest(session_id.as_bytes())))
}

/// Consume only complete, bounded records owned by this exact prompt lease.
/// Loading replay has no lease and cannot import usage from native history.
pub fn drain_observations(root: &Path, session_id: &str, lease_id: &str) -> Result<Vec<Value>> {
    read_observations(root, session_id, lease_id, true)
}

pub fn read_observations(
    root: &Path,
    session_id: &str,
    lease_id: &str,
    consume: bool,
) -> Result<Vec<Value>> {
    let prefix = format!(
        "{:x}-",
        Sha256::digest(serde_json::to_vec(&json!([session_id, lease_id]))?)
    );
    let mut observations = Vec::new();
    let mut files = Vec::new();
    for entry in fs::read_dir(root.join("observations"))? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(&prefix) || !name.ends_with(".json") {
            continue;
        }
        ensure!(
            entry.file_type()?.is_file() && entry.metadata()?.len() <= MAX_OBSERVATION_BYTES,
            "cline_observation_file_invalid"
        );
        ensure!(
            observations.len() < MAX_OBSERVATIONS,
            "cline_observation_budget_exceeded"
        );
        let value: Value = serde_json::from_slice(&fs::read(entry.path())?)?;
        ensure!(
            value["schemaVersion"] == 1
                && value["sessionId"] == session_id
                && value["leaseId"] == lease_id
                && value["runId"].as_str().is_some_and(|s| !s.is_empty())
                && value["seq"].as_u64().is_some_and(|n| n > 0)
                && matches!(
                    value["kind"].as_str(),
                    Some("run_started" | "model_completed" | "compaction" | "run_finished")
                ),
            "cline_observation_identity_mismatch"
        );
        observations.push(value);
        files.push(entry.path());
    }
    observations.sort_by_key(|value| value["seq"].as_u64());
    if let Some(first) = observations.first() {
        ensure!(
            observations
                .iter()
                .all(|value| value["runId"] == first["runId"]),
            "cline_observer_crossed_native_run"
        );
        ensure!(
            observations
                .windows(2)
                .all(|pair| pair[0]["seq"].as_u64() < pair[1]["seq"].as_u64()),
            "cline_observer_sequence_invalid"
        );
    }
    if consume {
        for file in files {
            fs::remove_file(file)?;
        }
    }
    Ok(observations)
}

/// Cline has a typed result array. In 3.0.65 a failed run_commands entry is
/// nevertheless followed by ACP `completed`. Trust `success`, not prose or the
/// coarse terminal status, and expose result text only for command tools.

pub fn enrich_tool_update(update: &mut Value, initial: Option<&Value>) {
    // This field is owned by the profile, never by an unvalidated wire payload.
    if let Some(meta) = update.get_mut("_meta").and_then(Value::as_object_mut) {
        meta.remove("rovaiClineMutation");
    }
    if let Some(initial) = initial {
        if update["title"].is_null() && initial["title"].is_string() {
            update["title"] = initial["title"].clone();
        }
        if update["rawInput"].is_null() && initial["rawInput"].is_object() {
            update["rawInput"] = initial["rawInput"].clone();
        }
    }
    let name = update["title"]
        .as_str()
        .unwrap_or_default()
        .split(':')
        .next()
        .unwrap_or_default()
        .trim()
        .to_owned();
    if matches!(name.as_str(), "apply_patch" | "editor") {
        update["kind"] = json!("edit");
    }
    if name == "read_files" {
        update["kind"] = json!("read");
    }
    // Cline can report tool completion even when its typed result failed.
    // Do not publish a successful file operation for that result.
    if matches!(name.as_str(), "read_files" | "apply_patch" | "editor")
        && matches!(update["status"].as_str(), Some("completed" | "failed"))
    {
        let output = &update["rawOutput"];
        let success = if name == "read_files" {
            output
                .as_array()
                .filter(|values| !values.is_empty())
                .and_then(|values| {
                    if values.iter().any(|value| value["success"] == false) {
                        Some(false)
                    } else if values.iter().all(|value| value["success"] == true) {
                        Some(true)
                    } else {
                        None
                    }
                })
        } else {
            output["success"].as_bool()
        };
        if success == Some(false) {
            update["status"] = json!("failed");
        } else if success == Some(true) && update["status"] == "completed" {
            let path = if name == "read_files" {
                update["rawInput"]["files"].as_array().and_then(|files| {
                    let [file] = files.as_slice() else {
                        return None;
                    };
                    file["path"].as_str().filter(|path| !path.trim().is_empty())
                })
            } else if name == "editor" {
                update["rawInput"]["path"]
                    .as_str()
                    .filter(|path| !path.trim().is_empty())
            } else {
                update["rawInput"]["input"]
                    .as_str()
                    .and_then(single_patch_path)
            };
            if let Some(path) = path {
                update["locations"] = json!([{"path": path}]);
            }
            let entries = match name.as_str() {
                "apply_patch" => update["rawInput"]["input"]
                    .as_str()
                    .and_then(applied_patch_entries),
                "editor" => editor_mutation_entries(&update["rawInput"]),
                _ => None,
            };
            if let Some(entries) = entries {
                if !update["_meta"].is_object() {
                    update["_meta"] = json!({});
                }
                update["_meta"]["rovaiClineMutation"] = json!({"tool":name,"entries":entries});
            }
        }
    }
    if name != "run_commands" {
        return;
    }
    update["kind"] = json!("execute");
    if let Some(commands) = update["rawInput"]["commands"].as_array()
        && !commands.is_empty()
        && commands.len() <= 64
        && commands.iter().all(Value::is_string)
    {
        let joined = commands
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join("\n");
        if joined.len() <= 16 * 1024 {
            update["rawInput"]["command"] = json!(joined);
        }
    }
    if !matches!(update["status"].as_str(), Some("completed" | "failed")) {
        return;
    }
    let Some(results) = update["rawOutput"].as_array() else {
        return;
    };
    if results.is_empty()
        || results
            .iter()
            .any(|v| !v["success"].is_boolean() || !v["result"].is_string())
    {
        return;
    }
    let failed = results.iter().any(|v| v["success"] == false);
    let text = results
        .iter()
        .filter_map(|v| v["result"].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    update["content"] = json!([{"type":"content","content":{"type":"text","text":text}}]);
    if failed {
        update["status"] = json!("failed");
    }
}

/// A successful single-file native patch can name the file without exposing
/// source text or inventing complete before/after states. Multi-file and move
/// patches stay unlabelled by the single-file operation contract.
fn single_patch_path(patch: &str) -> Option<&str> {
    if patch.len() > 2 * 1024 * 1024 {
        return None;
    }
    let mut lines = patch.trim().lines().map(|line| line.trim_end_matches('\r'));
    if lines.next()? != "*** Begin Patch" || lines.next_back()? != "*** End Patch" {
        return None;
    }
    let mut path = None;
    for line in lines {
        if line.starts_with("*** Move to:") || line.starts_with("*** Delete File:") {
            return None;
        }
        for prefix in ["*** Update File: ", "*** Add File: "] {
            if let Some(next) = line.strip_prefix(prefix) {
                if path.is_some() || next.trim().is_empty() {
                    return None;
                }
                path = Some(next.trim());
            }
        }
    }
    path
}

/// Retain the native, successfully applied UPDATE patch as reported fragments.
/// Cline can normalize punctuation or fuzzy-match old text; these are not exact
/// mutations or complete file states. No filesystem observation is involved.
fn applied_patch_entries(patch: &str) -> Option<Value> {
    if patch.len() > 2 * 1024 * 1024 || patch.contains('\0') {
        return None;
    }
    let mut lines = patch.trim().lines();
    if lines.next()? != "*** Begin Patch" || lines.next_back()? != "*** End Patch" {
        return None;
    }
    let mut entries = Vec::new();
    let mut paths = std::collections::BTreeSet::new();
    let mut path = None;
    let mut fragments = Vec::new();
    let mut old_text = String::new();
    let mut new_text = String::new();
    let mut in_hunk = false;
    let mut ended = false;
    let flush = |fragments: &mut Vec<Value>, old: &mut String, new: &mut String| {
        if old != new {
            fragments.push(json!({"oldText":old,"newText":new}));
        }
        old.clear();
        new.clear();
    };
    for line in lines {
        if let Some(next) = line.strip_prefix("*** Update File: ") {
            flush(&mut fragments, &mut old_text, &mut new_text);
            if let Some(previous) = path.take() {
                if fragments.is_empty() {
                    return None;
                }
                entries.push(
                    json!({"semantics":"reported_mutation","path":previous,"fragments":fragments}),
                );
                fragments = Vec::new();
            }
            let next = next.trim();
            if next.is_empty() || !paths.insert(next) || paths.len() > 256 {
                return None;
            }
            path = Some(next);
            in_hunk = false;
            ended = false;
        } else if path.is_none() || ended {
            return None;
        } else if line == "@@" || line.starts_with("@@ ") {
            flush(&mut fragments, &mut old_text, &mut new_text);
            in_hunk = true;
        } else if line == "*** End of File" {
            flush(&mut fragments, &mut old_text, &mut new_text);
            ended = true;
        } else if !in_hunk {
            return None;
        } else if let Some(text) = line.strip_prefix('-') {
            old_text.push_str(text);
            old_text.push('\n');
        } else if let Some(text) = line.strip_prefix('+') {
            new_text.push_str(text);
            new_text.push('\n');
        } else if line.starts_with(' ') || line.is_empty() {
            flush(&mut fragments, &mut old_text, &mut new_text);
        } else {
            // Add/delete/move and unknown grammar do not prove this semantic.
            return None;
        }
        if fragments.len() > 1024 {
            return None;
        }
    }
    flush(&mut fragments, &mut old_text, &mut new_text);
    if fragments.is_empty() || fragments.len() > 1024 {
        return None;
    }
    entries.push(json!({"semantics":"reported_mutation","path":path?,"fragments":fragments}));
    Some(json!(entries))
}

fn editor_mutation_entries(input: &Value) -> Option<Value> {
    if !input["insert_line"].is_null() {
        return None;
    }
    let path = input["path"].as_str().filter(|v| !v.trim().is_empty())?;
    let old = input["old_text"].as_str().filter(|v| !v.is_empty())?;
    let new = input["new_text"].as_str()?;
    if old == new || old.len().checked_add(new.len())? > 2 * 1024 * 1024 {
        return None;
    }
    Some(
        json!([{"semantics":"reported_mutation","path":path,"fragments":[{"oldText":old,"newText":new}]}]),
    )
}

pub fn parse_usage(record: &Value) -> Option<crate::monitoring::ParsedRuntimeUsage> {
    use crate::monitoring::{
        ParsedRuntimeUsage, RuntimeInputSemantics, RuntimeUsageCounterMode, RuntimeUsageFields,
    };
    if record["schemaVersion"] != 1 || record["kind"] != "model_completed" {
        return None;
    }
    let session = record["sessionId"].as_str().filter(|v| !v.is_empty())?;
    let run = record["runId"].as_str().filter(|v| !v.is_empty())?;
    let message = record["messageId"].as_str().filter(|v| !v.is_empty())?;
    let metrics = &record["metrics"];
    let count = |key: &str| metrics[key].as_i64().filter(|v| *v >= 0);
    let fields = RuntimeUsageFields {
        input_tokens: count("inputTokens"),
        output_tokens: count("outputTokens"),
        cache_read_input_tokens: count("cacheReadTokens"),
        cache_write_input_tokens: count("cacheWriteTokens"),
        reasoning_output_tokens: count("reasoningTokenCount"),
        ..Default::default()
    };
    if fields.input_tokens.is_none()
        && fields.output_tokens.is_none()
        && fields.cache_read_input_tokens.is_none()
        && fields.cache_write_input_tokens.is_none()
        && fields.reasoning_output_tokens.is_none()
    {
        return None;
    }
    Some(ParsedRuntimeUsage {
        identity_suffix: format!("{run}:{message}"),
        dialect_id: "cline-plugin-model-usage-v1".into(),
        source: "runtime_private_extension".into(),
        scope: "model_call".into(),
        counter_mode: RuntimeUsageCounterMode::Delta,
        // Cline's provider stream defines inputTokens as the provider's total
        // input. The shared canonicalizer subtracts the reported cache buckets.
        input_semantics: RuntimeInputSemantics::CacheInclusiveTotal,
        native_session_id: Some(session.into()),
        native_turn_id: Some(run.into()),
        fields,
        cost: None,
        context_model_id: None,
        occurred_at: record["observedAt"]
            .as_str()
            .filter(|time| chrono::DateTime::parse_from_rfc3339(time).is_ok())
            .map(str::to_owned),
    })
}

/// The latest root model request's inclusive input is context occupancy, not
/// the sum of this Run's requests. The observer does not guess a model window.
pub fn parse_observations(record: &Value) -> Vec<crate::monitoring::ParsedRuntimeUsage> {
    use crate::monitoring::{RuntimeInputSemantics, RuntimeUsageCounterMode, RuntimeUsageFields};
    if record["schemaVersion"] != 1 || record["kind"] != "model_completed" {
        return Vec::new();
    }
    let mut result: Vec<_> = parse_usage(record).into_iter().collect();
    let used = record["metrics"]["inputTokens"]
        .as_i64()
        .filter(|n| *n >= 0);
    let window = (record["contextWindowSource"] == "native_models_config"
        && record["providerId"].as_str().is_some_and(|s| !s.is_empty())
        && record["modelId"].as_str().is_some_and(|s| !s.is_empty()))
    .then(|| record["contextWindow"].as_i64())
    .flatten()
    .filter(|n| *n > 0 && *n <= 9_007_199_254_740_991);
    if (used.is_some() || window.is_some())
        && let Some(session) = record["sessionId"].as_str().filter(|s| !s.is_empty())
        && let Some(run) = record["runId"].as_str().filter(|s| !s.is_empty())
        && let Some(message) = record["messageId"].as_str().filter(|s| !s.is_empty())
    {
        result.push(crate::monitoring::ParsedRuntimeUsage {
            identity_suffix: format!("{run}:{message}:context"),
            dialect_id: "cline-plugin-model-context-v1".into(),
            source: "runtime_private_extension".into(),
            scope: "session".into(),
            counter_mode: RuntimeUsageCounterMode::Gauge,
            input_semantics: RuntimeInputSemantics::Unknown,
            native_session_id: Some(session.into()),
            native_turn_id: None,
            fields: RuntimeUsageFields {
                context_used_tokens: used,
                context_size_tokens: window,
                ..Default::default()
            },
            context_model_id: record["modelId"]
                .as_str()
                .filter(|id| !id.is_empty())
                .map(str::to_owned),
            cost: None,
            occurred_at: record["observedAt"]
                .as_str()
                .filter(|time| chrono::DateTime::parse_from_rfc3339(time).is_ok())
                .map(str::to_owned),
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_refresh_keeps_binding_identity_but_account_and_byok_changes_fence_it() {
        let initial = json!({"lastUsedProvider":"selected","providers":{"selected":{"updatedAt":"before",
            "settings":{"provider":"unknown-native-provider","model":"native-model","baseUrl":"https://native.invalid","apiKey":"static",
            "auth":{"accessToken":"old","refreshToken":"old-refresh","expiresAt":1}}},
            "unrelated":{"settings":{"apiKey":"other"}}}});
        // No tokenSource or accountId prerequisite; mixed/unknown auth belongs to Cline.
        let identity = provider_configuration_identity(&initial, Some("selected"));
        for pointer in ["/providers/selected", "/providers/selected/settings"] {
            let mut changed = initial.clone();
            changed.pointer_mut(pointer).unwrap()["nativeMetadata"] = json!("changed");
            assert_ne!(
                provider_configuration_identity(&changed, Some("selected")),
                identity
            );
        }
        let mut changed = initial.clone();
        changed["providers"]["selected"]["tokenSource"] = json!("changed");
        assert_ne!(
            provider_configuration_identity(&changed, Some("selected")),
            identity
        );
        let mut refreshed = initial.clone();
        refreshed["providers"]["selected"]["updatedAt"] = json!("after");
        for field in ["accessToken", "refreshToken", "expiresAt", "idToken"] {
            refreshed["providers"]["selected"]["settings"]["auth"][field] = json!("rotated");
        }
        refreshed["providers"]["unrelated"]["settings"]["apiKey"] = json!("unrelated update");
        refreshed["lastUsedProvider"] = json!("unrelated");
        assert_eq!(
            provider_configuration_identity(&refreshed, Some("selected")),
            identity
        );
        for pointer in [
            "/providers/selected/settings/provider",
            "/providers/selected/settings/model",
            "/providers/selected/settings/apiKey",
            "/providers/selected/settings/baseUrl",
        ] {
            let mut switched = refreshed.clone();
            *switched.pointer_mut(pointer).unwrap() = json!("different");
            assert_ne!(
                provider_configuration_identity(&switched, Some("selected")),
                identity,
                "{pointer}"
            );
        }
        refreshed["providers"]["selected"]["settings"]["auth"]["accountId"] = json!("account-a");
        let account = provider_configuration_identity(&refreshed, Some("selected"));
        refreshed["providers"]["selected"]["settings"]["auth"]["accountId"] = json!("account-b");
        assert_ne!(
            provider_configuration_identity(&refreshed, Some("selected")),
            account
        );
        assert_ne!(
            provider_configuration_identity(&initial, Some("unrelated")),
            identity
        );
    }
    #[test]
    fn native_metrics_keep_sparse_usage_and_verified_context_windows() {
        let observation = json!({"schemaVersion":1,"sessionId":"session-a","leaseId":"run:1","runId":"native-run","seq":1,"kind":"model_completed","messageId":"native-message","metrics":{"inputTokens":110,"cacheReadTokens":100,"outputTokens":2}});
        let usage = parse_usage(&observation).unwrap();
        assert_eq!(usage.fields.input_tokens, Some(110));
        assert_eq!(usage.fields.cache_read_input_tokens, Some(100));
        assert!(usage.fields.cache_write_input_tokens.is_none());
        assert!(usage.fields.reasoning_output_tokens.is_none());
        assert!(usage.cost.is_none());
        let mut with_window = observation.clone();
        with_window["modelId"] = json!("actual-model");
        with_window["providerId"] = json!("actual-provider");
        with_window["contextWindowSource"] = json!("native_models_config");
        with_window["contextWindow"] = json!(272000);
        let parsed = parse_observations(&with_window);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[1].fields.context_used_tokens, Some(110));
        assert_eq!(parsed[1].fields.context_size_tokens, Some(272000));
        assert_eq!(parsed[1].context_model_id.as_deref(), Some("actual-model"));
        assert_eq!(parsed[0].fields.context_size_tokens, None);
        for invalid in [
            json!(0),
            json!(-1),
            json!("272000"),
            json!(272000.5),
            json!(null),
        ] {
            with_window["contextWindow"] = invalid;
            assert_eq!(
                parse_observations(&with_window)[1]
                    .fields
                    .context_size_tokens,
                None
            );
        }
        with_window["contextWindow"] = json!(272000);
        with_window["metrics"] = json!({});
        let window_only = parse_observations(&with_window);
        assert_eq!(window_only.len(), 1);
        assert_eq!(window_only[0].fields.context_used_tokens, None);
        assert_eq!(window_only[0].fields.context_size_tokens, Some(272000));
        with_window["providerId"] = Value::Null;
        assert!(parse_observations(&with_window).is_empty());
        with_window["providerId"] = json!("actual-provider");
        with_window["contextWindowSource"] = json!("inferred");
        assert!(parse_observations(&with_window).is_empty());
    }
    // Real native path projection requires filesystem semantics, but no model,
    // process or database fixture. This owns preservation and credential fence.
    #[cfg(all(unix, feature = "extended-tests"))]
    #[test]
    fn host_overlay_preserves_native_paths_and_fences_config_changes() {
        let temp =
            std::env::temp_dir().join(format!("rovai-cline-config-{}", uuid::Uuid::new_v4()));
        let paths = NativePaths::resolve(&temp, |_| None);
        for directory in [
            paths.data.join("settings"),
            paths.config.join("plugins/pkg"),
            paths.config.join("rules"),
        ] {
            fs::create_dir_all(directory).unwrap();
        }
        fs::write(
            &paths.providers,
            r#"{"lastUsedProvider":"native","providers":{"native":{"settings":{"apiKey":"secret-a"}}}}"#,
        )
        .unwrap();
        fs::write(&paths.mcp, r#"{"mcpServers":{"native":{"command":"echo","args":["native"]},"assigned":{"command":"old","env":{"OLD":"must-not-survive"}}}}"#).unwrap();
        let catalog = json!({"version":1,"providers":{"native":{"models":{
            "actual":{"contextWindow":272000,"max_context_window":872000,"private":"secret-catalog"},
            "default":{"maxInputTokens":128000},"invalid":{"contextWindow":-1},
            "text":{"contextWindow":"272000"},"unsafe":{"contextWindow":9007199254740992_i64}
        }}}});
        let catalog_path = paths.data.join("settings/models.json");
        fs::write(&catalog_path, serde_json::to_vec(&catalog).unwrap()).unwrap();
        let native_plugin = paths.config.join("plugins/pkg/index.js");
        fs::write(&native_plugin, "export default {name:'native'};").unwrap();
        fs::write(
            paths.config.join("plugins/pkg/package.json"),
            r#"{"cline":{"plugins":[{"paths":["index.js"]}]}}"#,
        )
        .unwrap();
        let before = native_configuration_digest(&paths).unwrap();
        let root = temp.join("host");
        let mut command = Command::new("cline");
        let servers = BTreeMap::from([(
            "assigned".to_string(),
            serde_json::from_value(json!({"command":"new","args":["safe"]})).unwrap(),
        )]);
        configure_host(&mut command, &root, &paths, false, &servers).unwrap();
        let frozen_windows = fs::read(root.join("model-windows.json")).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&frozen_windows).unwrap(),
            json!({"native":{"actual":272000}})
        );
        assert_eq!(native_configuration_digest(&paths).unwrap(), before);
        let mut updated_catalog = catalog.clone();
        updated_catalog["providers"]["native"]["models"]["actual"]["contextWindow"] = json!(300000);
        fs::write(&catalog_path, serde_json::to_vec(&updated_catalog).unwrap()).unwrap();
        assert_ne!(native_configuration_digest(&paths).unwrap(), before);
        assert_eq!(
            fs::read(root.join("model-windows.json")).unwrap(),
            frozen_windows
        );
        fs::write(&catalog_path, serde_json::to_vec(&catalog).unwrap()).unwrap();
        assert!(
            !fs::symlink_metadata(root.join("config/rules"))
                .unwrap()
                .is_symlink()
        );
        let manifest: Value = serde_json::from_slice(
            &fs::read(root.join("config/plugins/rovai/package.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            manifest["cline"]["plugins"][0]["paths"][0],
            native_plugin.to_str().unwrap()
        );
        assert_eq!(
            manifest["cline"]["plugins"][0]["paths"][1],
            root.join("observer.js").to_str().unwrap()
        );
        bind_bootstrap(&root, "session-A", "Identity A").unwrap();
        bind_bootstrap(&root, "session-A", "Identity A").unwrap();
        assert!(bind_bootstrap(&root, "session-B", "Identity B").is_err());
        let second = temp.join("second-host");
        configure_host(&mut Command::new("cline"), &second, &paths, false, &servers).unwrap();
        bind_bootstrap(&second, "session-B", "Identity B").unwrap();
        assert!(
            fs::read_to_string(root.join("config/rules/rovai-managed-bootstrap.md"))
                .unwrap()
                .contains("Identity A")
        );
        assert!(
            !fs::read_to_string(root.join("config/rules/rovai-managed-bootstrap.md"))
                .unwrap()
                .contains("Identity B")
        );
        assert!(
            !paths
                .config
                .join("rules/rovai-managed-bootstrap.md")
                .exists()
        );
        assert!(!root.join("providers.json").exists());
        let mcp: Value = serde_json::from_slice(&fs::read(root.join("mcp.json")).unwrap()).unwrap();
        assert_eq!(mcp["mcpServers"]["native"]["command"], "echo");
        assert_eq!(mcp["mcpServers"]["assigned"]["command"], "new");
        assert!(mcp["mcpServers"]["assigned"].get("env").is_none());
        let env: BTreeMap<_, _> = command
            .as_std()
            .get_envs()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().into_owned(),
                    v.unwrap().to_string_lossy().into_owned(),
                )
            })
            .collect();
        assert!(!env.contains_key("HOME"));
        assert_eq!(env["CLINE_DATA_DIR"], paths.data.to_string_lossy());
        assert_eq!(env["CLINE_SESSION_BACKEND_MODE"], "local");
        fs::write(
            &paths.providers,
            r#"{"lastUsedProvider":"native","providers":{"native":{"settings":{"apiKey":"secret-b"}}}}"#,
        )
        .unwrap();
        assert_ne!(native_configuration_digest(&paths).unwrap(), before);
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(root.join("mcp.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        fs::remove_dir_all(temp).unwrap();
    }
}
