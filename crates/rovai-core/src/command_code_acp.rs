//! Command Code's official stdio ACP profile. Fleet, routing, permissions,
//! replay and cancellation remain owned by the shared ACP Host.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{agent_profile::AdapterKind, command::canonical_json_digest, mcp::McpServerDefinition};

pub const MINIMUM_VERSION: &str = "1.74.1";
pub const BOOTSTRAP_REVISION: &str = "command-code-system-bootstrap-v1";
const BOOTSTRAP: &str = include_str!("command_code/bootstrap.mjs");

/// 1.74.1 returns its complete native catalog in one page. Do not infer a
/// successful restore from resume/load: both silently accept missing history.
pub(crate) fn verify_restore_target(catalog: &Value, session_id: &str, cwd: &str) -> Result<()> {
    let sessions = catalog["sessions"]
        .as_array()
        .context("command_code_restore_catalog_invalid")?;
    if sessions.iter().any(|session| {
        session["sessionId"].as_str() == Some(session_id) && session["cwd"].as_str() == Some(cwd)
    }) {
        return Ok(());
    }
    // A future paginated catalog requires fresh qualification; absence from
    // an incomplete response cannot prove an exact restore of the old Session.
    bail!("command_code_restore_target_missing: session not found in exact native catalog");
}

/// Native ACP sends the proposed edit only on tool_call. Its old/new strings
/// are matched fragments, not complete file states. Promote them only after a
/// matching successful terminal and never mislabel the proposal as a full diff.
pub fn enrich_tool_update(update: &mut Value, initial: Option<&Value>) {
    if let Some(meta) = update.get_mut("_meta").and_then(Value::as_object_mut) {
        meta.remove("rovaiCommandMutation");
    }
    if let Some(initial) = initial {
        for field in ["title", "kind", "rawInput", "locations"] {
            if update[field].is_null() && !initial[field].is_null() {
                update[field] = initial[field].clone();
            }
        }
    }
    // The official translator emits edit_file fragments as ACP diff content.
    // Remove them from the generic complete-before/after admission path.
    if let Some(content) = update.get_mut("content").and_then(Value::as_array_mut) {
        content.retain(|block| block["type"] != "diff");
    }
    if update["status"] != "completed" || initial.is_none_or(|value| value["kind"] != "edit") {
        return;
    }
    let input = &initial.expect("checked initial")["rawInput"];
    let path = input["file_path"]
        .as_str()
        .or_else(|| input["path"].as_str());
    let Some((path, old, new)) = path
        .zip(input["old_string"].as_str())
        .zip(input["new_string"].as_str())
        .map(|((p, o), n)| (p, o, n))
    else {
        return;
    };
    if path.trim().is_empty()
        || old.is_empty()
        || old == new
        || input["replace_all"] == true
        || input["replacement_count"].as_u64().is_some_and(|v| v != 1)
    {
        return;
    }
    let mutation = json!({"entries":[{"semantics":"reported_mutation", "path":path, "fragments":[{"oldText":old,"newText":new}]}]});
    if !update["_meta"].is_object() {
        update["_meta"] = json!({});
    }
    update["_meta"]["rovaiCommandMutation"] = mutation;
}

/// Settings and MCP are private native overlays. Original auth, providers,
/// Skills, Mods and Session storage remain native; shared files are not edited.
pub fn configure_host(
    command: &mut tokio::process::Command,
    root: &Path,
    servers: &BTreeMap<String, McpServerDefinition>,
) -> Result<()> {
    let home = crate::runtime_discovery::runtime_home_directory(AdapterKind::CommandCodeCli)
        .context("Command Code native Home unavailable")?;
    configure_host_from_home(command, root, &home, servers)
}

fn configure_host_from_home(
    command: &mut tokio::process::Command,
    root: &Path,
    home: &Path,
    servers: &BTreeMap<String, McpServerDefinition>,
) -> Result<()> {
    let native = home.join(".commandcode");
    let private_home = root.join("home");
    let private_native = private_home.join(".commandcode");
    for directory in [&private_home, &private_native, &root.join("bindings")] {
        fs::create_dir_all(directory)?;
        private_mode(directory, 0o700)?;
    }
    // Native cold resume must survive deletion of an ephemeral Host overlay.
    for name in ["projects", "sessions"] {
        fs::create_dir_all(native.join(name))?;
    }
    for entry in fs::read_dir(&home)? {
        let entry = entry?;
        if entry.file_name() != ".commandcode" {
            native_link(&entry.path(), &private_home.join(entry.file_name()))?;
        }
    }
    for entry in fs::read_dir(&native)? {
        let entry = entry?;
        if entry.file_name() != "settings.json" && entry.file_name() != "mcp.json" {
            native_link(&entry.path(), &private_native.join(entry.file_name()))?;
        }
    }
    let mut settings = match fs::read(native.join("settings.json")) {
        Ok(bytes) => serde_json::from_slice::<Value>(&bytes)
            .context("command_code_native_settings_invalid")?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(_) => bail!("command_code_native_settings_unreadable"),
    };
    anyhow::ensure!(settings.is_object(), "command_code_native_settings_invalid");
    if settings["mods"].is_null() {
        settings["mods"] = json!({});
    }
    anyhow::ensure!(
        settings["mods"].is_object(),
        "command_code_native_mod_settings_invalid"
    );
    let mut paths = match settings["mods"]["paths"].as_array() {
        Some(paths) => paths.clone(),
        None if settings["mods"]["paths"].is_null() => Vec::new(),
        _ => bail!("command_code_native_mod_paths_invalid"),
    };
    let plugin = root.join("rovai-bootstrap.mjs");
    write_private(&plugin, BOOTSTRAP.as_bytes())?;
    paths.insert(0, json!(plugin));
    settings["mods"]["paths"] = json!(paths);
    write_private(
        &private_native.join("settings.json"),
        &serde_json::to_vec(&settings)?,
    )?;
    let mut mcp = match fs::read(native.join("mcp.json")) {
        Ok(bytes) => {
            serde_json::from_slice::<Value>(&bytes).context("command_code_native_mcp_invalid")?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({"mcpServers": {}}),
        Err(error) => return Err(error.into()),
    };
    let entries = mcp
        .get_mut("mcpServers")
        .and_then(Value::as_object_mut)
        .context("command_code_native_mcp_invalid")?;
    // PreparedMcpProjection already excludes all effective native-name
    // conflicts. Keep whole-definition precedence here for user-scope entries.
    for (name, definition) in servers {
        if !entries.contains_key(name) {
            let mut value = serde_json::to_value(definition)?;
            value["transport"] = json!(if value.get("url").is_some() {
                "http"
            } else {
                "stdio"
            });
            // Native config does not accept cwd. Preserve the already-resolved
            // directory with an argv-only launcher, without shell interpolation.
            if let McpServerDefinition::Stdio {
                command,
                args,
                cwd: Some(cwd),
                ..
            } = definition
            {
                value["command"] = json!("node");
                value["args"] = json!(
                    [
                        vec![
                            "--eval".to_owned(),
                            include_str!("command_code/mcp-cwd.cjs").to_owned(),
                            "--".to_owned(),
                            cwd.clone(),
                            command.clone()
                        ],
                        args.clone()
                    ]
                    .concat()
                );
                value.as_object_mut().unwrap().remove("cwd");
            }
            // Core has resolved these values already. Native interpolation
            // must not reinterpret literal ${...} from the resolved secret.
            for field in ["env", "headers"] {
                if let Some(values) = value.get_mut(field).and_then(Value::as_object_mut) {
                    for value in values.values_mut() {
                        if let Some(text) = value.as_str() {
                            *value = json!(text.replace("${", "$${"));
                        }
                    }
                }
            }
            entries.insert(name.clone(), value);
        }
    }
    write_private(&private_native.join("mcp.json"), &serde_json::to_vec(&mcp)?)?;
    let nonce = uuid::Uuid::new_v4().to_string();
    write_private(&root.join("nonce"), nonce.as_bytes())?;
    command
        .arg("acp")
        .env("COMMANDCODE_SKIP_UPDATES", "1")
        .env("HOME", private_home)
        .env("ROVAI_COMMAND_CODE_BOOTSTRAP_ROOT", root)
        .env("ROVAI_COMMAND_CODE_BOOTSTRAP_NONCE", nonce);
    Ok(())
}

pub fn verify_ready(root: &Path, expected_pid: Option<u32>) -> Result<()> {
    let ready: Value = serde_json::from_slice(
        &fs::read(root.join("ready.json"))
            .context("Command Code Bootstrap extension did not load; no prompt sent")?,
    )?;
    let nonce = fs::read_to_string(root.join("nonce"))?;
    anyhow::ensure!(
        ready["revision"] == BOOTSTRAP_REVISION
            && ready["nonce"] == nonce
            && ready["pid"].as_u64().is_some_and(
                |pid| pid > 0 && expected_pid.is_none_or(|expected| u64::from(expected) == pid)
            ),
        "command_code_bootstrap_readiness_invalid"
    );
    Ok(())
}

pub fn bind_bootstrap(root: &Path, session_id: &str, bootstrap: &str) -> Result<()> {
    verify_ready(root, None)?;
    anyhow::ensure!(
        !session_id.is_empty()
            && session_id.len() <= 128
            && session_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            && !bootstrap.trim().is_empty()
            && bootstrap.len() <= 32 * 1024,
        "command_code_bootstrap_binding_invalid"
    );
    let path = root.join("bindings").join(format!("{session_id}.json"));
    let payload = serde_json::to_vec(
        &json!({"schemaVersion":1, "sessionId":session_id, "bootstrap":bootstrap,
        "sha256":format!("{:x}",Sha256::digest(bootstrap.as_bytes()))}),
    )?;
    if path.exists() {
        anyhow::ensure!(
            fs::read(path)? == payload,
            "command_code_bootstrap_binding_changed"
        );
        return Ok(());
    }
    let temporary = root
        .join("bindings")
        .join(format!("{}.tmp", uuid::Uuid::new_v4()));
    write_private(&temporary, &payload)?;
    fs::rename(temporary, path)?;
    Ok(())
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    fs::write(path, bytes)?;
    private_mode(path, 0o600)
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

pub fn supported_version(version: Option<&str>) -> bool {
    let Some(version) = version.and_then(|v| {
        v.split_whitespace()
            .find(|s| s.as_bytes().first().is_some_and(u8::is_ascii_digit))
    }) else {
        return false;
    };
    if version.contains('-') {
        return false;
    }
    version
        .split('+')
        .next()
        .unwrap_or(version)
        .split('.')
        .map(str::parse::<u64>)
        .collect::<std::result::Result<Vec<_>, _>>()
        .is_ok_and(|v| v.len() == 3 && v.as_slice() >= [1, 74, 1].as_slice())
}

/// Hash native configuration before Host reuse and exact cold continuation.
/// Credentials never leave this boundary as plaintext. Session transcripts
/// are deliberately excluded: ordinary generation must not invalidate itself.
pub fn native_configuration_digest(workspace: &Path) -> Result<String> {
    let kind = AdapterKind::CommandCodeCli;
    let home = crate::runtime_discovery::runtime_home_directory(kind)
        .context("Command Code native Home unavailable")?;
    let files = native_configuration_files(&home, workspace)?;
    let environment: BTreeMap<_, _> = ["COMMAND_API_KEY", "CMD_LOCAL_ONLY", "CMD_ZDR"]
        .into_iter()
        .map(|name| {
            (
                name,
                crate::runtime_discovery::runtime_environment_variable(kind, name)
                    .map(|value| format!("{:x}", Sha256::digest(value.as_encoded_bytes()))),
            )
        })
        .collect();
    canonical_json_digest(
        &json!({"profile":"command-code-acp-v2-native-mcp", "bootstrap": BOOTSTRAP_REVISION, "home":home, "files":files, "environment":environment}),
    )
}

fn native_configuration_files(
    home: &Path,
    workspace: &Path,
) -> Result<BTreeMap<String, Option<String>>> {
    let root = home.join(".commandcode");
    // Native settings resolve at the enclosing Git root, then the enclosing
    // .commandcode directory for non-Git workspaces. Do not hash only cwd.
    let project = workspace
        .ancestors()
        .find(|path| path.join(".git").exists())
        .or_else(|| {
            workspace
                .ancestors()
                .find(|path| path.join(".commandcode").is_dir())
        })
        .unwrap_or(workspace);
    let mut files = BTreeMap::new();
    for path in [
        root.join("auth.json"),
        root.join("config.json"),
        root.join("providers.json"),
        root.join("settings.json"),
        root.join("mcp.json"),
        root.join(".mcp.json"),
        project.join(".mcp.json"),
        project.join(".commandcode/settings.json"),
        project.join(".commandcode/settings.local.json"),
        project.join(".commandcode/mcp.json"),
    ] {
        hash_file(&path, &mut files)?;
    }
    hash_directory(&root.join("mods"), &mut files, 0)?;
    hash_directory(&project.join(".commandcode/mods"), &mut files, 0)?;
    // Native per-project MCP keys use upstream slugification. Hash only the
    // named config file in every project, never transcripts; conservative
    // invalidation avoids guessing that Unicode/path mapping.
    if root.join("projects").is_dir() {
        for project in fs::read_dir(root.join("projects"))? {
            let project = project?;
            if project.file_type()?.is_dir() {
                anyhow::ensure!(
                    files.len() < 2048,
                    "command_code_native_configuration_too_large"
                );
                let path = project.path().join("mcp.json");
                if path.exists() {
                    hash_file(&path, &mut files)?;
                }
            }
        }
    }
    for (settings, base) in [
        (root.join("settings.json"), root.as_path()),
        (project.join(".commandcode/settings.json"), project),
        (project.join(".commandcode/settings.local.json"), project),
    ] {
        hash_configured_mod_paths(&settings, base, home, &mut files)?;
    }
    Ok(files)
}

fn hash_configured_mod_paths(
    settings_path: &Path,
    scope_base: &Path,
    home: &Path,
    files: &mut BTreeMap<String, Option<String>>,
) -> Result<()> {
    let bytes = match fs::read(settings_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => bail!("command_code_native_settings_unreadable"),
    };
    let settings: Value =
        serde_json::from_slice(&bytes).context("command_code_native_settings_invalid")?;
    let mut paths = Vec::new();
    if let Some(entries) = settings.pointer("/mods/paths").and_then(Value::as_array) {
        for entry in entries {
            paths.push(
                entry
                    .as_str()
                    .context("command_code_native_mod_paths_invalid")?,
            );
        }
    }
    // Installed npm/git sources are under native mods/.registry. Local sources
    // are referenced in place, so their bytes must also fence a retained Host.
    if let Some(entries) = settings.pointer("/mods/sources").and_then(Value::as_array) {
        for entry in entries {
            if let Some(source) = entry.as_str().or_else(|| entry["source"].as_str()) {
                if source.starts_with('.') || source.starts_with('/') || source.starts_with('~') {
                    paths.push(source);
                }
            }
        }
    }
    for path in paths {
        let path = if let Some(relative) = path.strip_prefix("~/") {
            home.join(relative)
        } else if path == "~" {
            home.to_path_buf()
        } else {
            scope_base.join(path)
        };
        if path.is_dir() {
            hash_directory(&path, files, 0)?;
        } else {
            hash_file(&path, files)?;
        }
    }
    Ok(())
}

/// `mcp list` is the official effective-config reader (including native
/// project precedence). Its 1.74.1 table exposes names, never config values.
/// Reject format drift rather than silently misreporting an Assignment.
pub(crate) fn native_mcp_names(output: &str) -> Result<BTreeSet<String>> {
    anyhow::ensure!(
        !output.contains('\u{1b}'),
        "command_code_mcp_list_format_invalid"
    );
    let lines: Vec<_> = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.first() == Some(&"No MCP servers configured") {
        return Ok(BTreeSet::new());
    }
    let header = lines
        .iter()
        .position(|line| {
            line.split_whitespace().collect::<Vec<_>>()
                == ["NAME", "TYPE", "SCOPE", "AUTH", "STATUS"]
        })
        .context("command_code_mcp_list_format_invalid")?;
    let mut names = BTreeSet::new();
    for line in &lines[header + 1..] {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.first() == Some(&"Total:") {
            anyhow::ensure!(
                fields.get(1).and_then(|value| value.parse::<usize>().ok()) == Some(names.len()),
                "command_code_mcp_list_count_mismatch"
            );
            return Ok(names);
        }
        anyhow::ensure!(
            fields.len() == 5
                && matches!(fields[1], "stdio" | "http" | "sse")
                && matches!(fields[4], "enabled" | "disabled")
                && names.insert(fields[0].to_owned()),
            "command_code_mcp_list_format_invalid"
        );
    }
    bail!("command_code_mcp_list_total_missing")
}

fn hash_file(path: &Path, files: &mut BTreeMap<String, Option<String>>) -> Result<()> {
    let value = match fs::read(path) {
        Ok(bytes) => Some(format!("{:x}", Sha256::digest(bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => bail!("command_code_native_configuration_unreadable"),
    };
    files.insert(path.to_string_lossy().into_owned(), value);
    Ok(())
}

fn hash_directory(
    path: &Path,
    files: &mut BTreeMap<String, Option<String>>,
    depth: usize,
) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    anyhow::ensure!(
        depth < 8 && files.len() < 2048,
        "command_code_mod_configuration_too_large"
    );
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_name() == "node_modules" || entry.file_name() == ".git" {
            continue;
        }
        if entry.file_type()?.is_dir() {
            hash_directory(&entry.path(), files, depth + 1)?;
        } else {
            hash_file(&entry.path(), files)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_configuration_tracks_scoped_mod_sources_without_hashing_history() {
        let root =
            std::env::temp_dir().join(format!("command-code-profile-{}", uuid::Uuid::new_v4()));
        let home = root.join("home");
        let project = root.join("project");
        let workspace = project.join("nested/work");
        for path in [
            home.join(".commandcode"),
            workspace.clone(),
            project.join(".git"),
            project.join(".commandcode/mods"),
        ] {
            fs::create_dir_all(path).unwrap();
        }
        fs::write(
            home.join(".commandcode/settings.json"),
            r#"{"mods":{"paths":["user-hook.mjs"]}}"#,
        )
        .unwrap();
        fs::write(
            project.join(".commandcode/settings.local.json"),
            r#"{"mods":{"paths":["project-hook.mjs"],"sources":[{"source":"./local-mod.mjs"}]}}"#,
        )
        .unwrap();
        let user_mod = home.join(".commandcode/user-hook.mjs");
        let project_mod = project.join("project-hook.mjs");
        let discovered_mod = project.join(".commandcode/mods/discovered.mjs");
        let local_mod = project.join("local-mod.mjs");
        for path in [&user_mod, &project_mod, &discovered_mod, &local_mod] {
            fs::write(path, "revision1").unwrap();
        }
        let before = native_configuration_files(&home, &workspace).unwrap();
        fs::create_dir_all(home.join(".commandcode/projects/workspace")).unwrap();
        fs::write(
            home.join(".commandcode/projects/workspace/session.jsonl"),
            "private-history",
        )
        .unwrap();
        assert_eq!(
            before,
            native_configuration_files(&home, &workspace).unwrap()
        );
        for path in [&user_mod, &project_mod, &discovered_mod, &local_mod] {
            fs::write(path, "revision2").unwrap();
            assert_ne!(
                before,
                native_configuration_files(&home, &workspace).unwrap()
            );
            fs::write(path, "revision1").unwrap();
        }
        let native_mcp = home.join(".commandcode/mcp.json");
        let original =
            json!({"mcpServers":{"native":{"command":"original","env":{"KEY":"${NATIVE_KEY}"}}}});
        fs::write(&native_mcp, serde_json::to_vec(&original).unwrap()).unwrap();
        let servers = BTreeMap::from([
            ("native".to_owned(), serde_json::from_value(json!({"command":"must-not-replace"})).unwrap()),
            ("assigned".to_owned(), serde_json::from_value(json!({"command":"echo","args":["literal $(never-execute)"],"cwd":workspace,"env":{"VALUE":"${literal}"}})).unwrap()),
            ("http".to_owned(), serde_json::from_value(json!({"url":"http://127.0.0.1:9000/mcp","headers":{"X-Probe":"$${literal}"}})).unwrap()),
        ]);
        let host = root.join("host");
        configure_host_from_home(
            &mut tokio::process::Command::new("command-code"),
            &host,
            &home,
            &servers,
        )
        .unwrap();
        let overlay: Value =
            serde_json::from_slice(&fs::read(host.join("home/.commandcode/mcp.json")).unwrap())
                .unwrap();
        assert_eq!(
            overlay["mcpServers"]["native"],
            original["mcpServers"]["native"]
        );
        assert_eq!(overlay["mcpServers"]["assigned"]["command"], "node");
        assert_eq!(
            overlay["mcpServers"]["assigned"]["args"][3],
            workspace.to_str().unwrap()
        );
        assert_eq!(
            overlay["mcpServers"]["assigned"]["env"]["VALUE"],
            "$${literal}"
        );
        assert_eq!(overlay["mcpServers"]["http"]["transport"], "http");
        assert_eq!(
            overlay["mcpServers"]["http"]["headers"]["X-Probe"],
            "$$${literal}"
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&native_mcp).unwrap()).unwrap(),
            original
        );
        let revoked = root.join("revoked");
        configure_host_from_home(
            &mut tokio::process::Command::new("command-code"),
            &revoked,
            &home,
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(
                &fs::read(revoked.join("home/.commandcode/mcp.json")).unwrap()
            )
            .unwrap(),
            original
        );
        fs::write(&native_mcp, b"[]").unwrap();
        let invalid = configure_host_from_home(
            &mut tokio::process::Command::new("command-code"),
            &root.join("invalid"),
            &home,
            &servers,
        )
        .unwrap_err();
        assert!(
            invalid
                .to_string()
                .contains("command_code_native_mcp_invalid")
        );
        fs::write(&native_mcp, serde_json::to_vec(&original).unwrap()).unwrap();
        fs::write(
            project.join(".commandcode/settings.local.json"),
            "invalid json",
        )
        .unwrap();
        assert!(native_configuration_files(&home, &workspace).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
