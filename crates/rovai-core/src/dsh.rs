//! DeepSeek Harness's official ACP profile plus a scoped system-prompt section.
//! Transport, process ownership, approvals and LRU remain in the shared ACP host.
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use tokio::process::Command;

use crate::{agent_profile::AdapterKind, command::canonical_json_digest};

pub const MINIMUM_VERSION: &str = "0.1.5-rc.2";
pub const BOOTSTRAP_REVISION: &str = "dsh-windows-job-launch-v5";
const BOOTSTRAP_PLUGIN: &str = include_str!("dsh/bootstrap.mjs");
const MAX_OBSERVED_FILE_CONTENT_BYTES: usize = 2 * 1024 * 1024;

pub fn supported_version(version: Option<&str>) -> bool {
    let Some(version) = version.map(str::trim) else {
        return false;
    };
    let version = version.strip_prefix('v').unwrap_or(version);
    let version = version.split_once('+').map_or(version, |(core, _)| core);
    let (core, suffix) = version.split_once('-').unwrap_or((version, ""));
    let numbers = core
        .split('.')
        .map(str::parse::<u64>)
        .collect::<std::result::Result<Vec<_>, _>>();
    let Ok(numbers) = numbers else {
        return false;
    };
    if numbers.len() != 3 {
        return false;
    }
    let numbers = [numbers[0], numbers[1], numbers[2]];
    numbers > [0, 1, 5]
        || (numbers == [0, 1, 5]
            && (suffix.is_empty()
                || suffix
                    .strip_prefix("rc.")
                    .and_then(|v| v.parse::<u64>().ok())
                    .is_some_and(|v| v >= 2)))
}

/// Observe only this Runtime's native configuration. Values never enter argv,
/// prompts or diagnostics; changes invalidate process and Native Binding reuse.
pub fn native_configuration_digest(cwd: &Path) -> Result<String> {
    configuration_digest(&native_home()?, cwd)
}

fn native_home() -> Result<std::path::PathBuf> {
    crate::runtime_discovery::runtime_environment_variable(AdapterKind::DeepseekHarness, "DSH_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            crate::runtime_discovery::runtime_home_directory(AdapterKind::DeepseekHarness)
                .map(|p| p.join(".dsh"))
        })
        .context("DeepSeek Harness native Home is unavailable")
}

fn configuration_digest(home: &Path, cwd: &Path) -> Result<String> {
    let mut entries = Vec::new();
    for path in [
        home.join("settings.yaml"),
        home.join(".credentials.yaml"),
        home.join(".env"),
        home.join("cordis.patch.yml"),
        home.join("profiles/acp/package.json"),
        home.join("profiles/acp/cordis.yml"),
        home.join("profiles/acp/cordis.patch.yml"),
        cwd.join(".env"),
    ] {
        let digest = match fs::read(&path) {
            Ok(bytes) => Some(format!("{:x}", Sha256::digest(bytes))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => bail!("dsh_native_configuration_unreadable"),
        };
        entries.push((path, digest));
    }
    canonical_json_digest(&json!({"revision": BOOTSTRAP_REVISION, "home": home, "files": entries}))
}

pub fn configure_host(
    command: &mut Command,
    root: &Path,
    cwd: &Path,
    permissions: &Value,
    mcp_server_names: &[String],
) -> Result<()> {
    let tool_compat = responses_tool_compat(&native_home()?.join("settings.yaml"))?;
    configure_host_with_tool_compat(
        command,
        root,
        cwd,
        permissions,
        mcp_server_names,
        tool_compat,
    )
}

/// Only project non-secret defaults into the composition layer. Native user
/// settings (including model-level overrides) still have the final say. DSH's
/// pi-ai adapter otherwise omits `strict`, allowing Responses endpoints to
/// require optional shell arguments such as `justification`.
fn responses_tool_compat(settings_path: &Path) -> Result<Option<Value>> {
    let bytes = match fs::read(settings_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => bail!("dsh_native_configuration_unreadable"),
    };
    // Parser errors can contain scalar values from this credential-bearing file.
    let settings: Value = serde_yaml::from_slice(&bytes)
        .map_err(|_| anyhow::anyhow!("dsh_native_settings_invalid"))?;
    let Some(providers) = settings
        .pointer("/llm-pi-ai/providers")
        .and_then(Value::as_object)
    else {
        return Ok(None);
    };
    let defaults: serde_json::Map<String, Value> = providers
        .iter()
        .filter(|(_, provider)| {
            provider["api"] == "openai-responses"
                && provider.pointer("/compat/supportsStrictMode").is_none()
        })
        .map(|(route, _)| (route.clone(), json!({"compat":{"supportsStrictMode":true}})))
        .collect();
    Ok((!defaults.is_empty()).then(|| json!({"id":"llm-pi-ai","config":{"providers":defaults}})))
}

fn configure_host_with_tool_compat(
    command: &mut Command,
    root: &Path,
    cwd: &Path,
    permissions: &Value,
    mcp_server_names: &[String],
    tool_compat: Option<Value>,
) -> Result<()> {
    let sandbox = permissions
        .get("sandbox_mode")
        .and_then(Value::as_str)
        .context("DSH sandbox_mode missing")?;
    let approval = permissions
        .get("approval_policy")
        .and_then(Value::as_str)
        .context("DSH approval_policy missing")?;
    if !matches!(
        sandbox,
        "read-only" | "workspace-write" | "danger-full-access"
    ) || !matches!(approval, "ask" | "never")
    {
        bail!("DSH permission configuration invalid");
    }
    let binding_root = root.join("bindings");
    fs::create_dir_all(&binding_root)?;
    private_directory(&binding_root)?;
    let observation_root = root.join("observations");
    fs::create_dir_all(&observation_root)?;
    private_directory(&observation_root)?;
    let plugin_path = root.join("bootstrap.mjs");
    fs::write(&plugin_path, BOOTSTRAP_PLUGIN)?;
    private_file(&plugin_path)?;
    let mut patch = json!([
        {"id":"sandbox-policy","config":{"mode":sandbox,"workspaceRoot":cwd}},
        {"id":"approval","config":{"policy":approval}},
        // The interactive preset service seeds native settings over the two
        // independent knobs, and rejects valid pairs absent from its preset
        // table. ACP has no permission-mode control; this Host's frozen knobs
        // own the policy. Preserve the native settings file untouched.
        {"id":"permission","disabled":true},
        // DSH's ACP app may accept stdio before sibling Loader entries finish.
        // The bootstrap publishes this service only after configured native MCP
        // clients complete their official entry lifecycle.
        {"id":"acp","inject":["acpAppStartup","rovaiDshReady"]},
        {"insert":[{"id":"rovai-bootstrap","name":plugin_path,"config":{"bindingRoot":binding_root,"observationRoot":observation_root,"mcpServerNames":mcp_server_names}}]}
    ]);
    if let Some(tool_compat) = tool_compat {
        patch.as_array_mut().unwrap().push(tool_compat);
    }
    let patch_path = root.join("rovai.patch.json");
    fs::write(&patch_path, serde_json::to_vec(&patch)?)?;
    private_file(&patch_path)?;
    command
        .args(["--profile", "acp", "--patch"])
        .arg(patch_path);
    Ok(())
}

/// Supplement ACP only with an exact, one-shot observation from the official
/// tools/result seam. Missing or mismatched evidence fails the Host rather than
/// reporting an unobserved successful shell exit. No result-text parsing.
pub fn enrich_message(root: &Path, message: &mut Value) -> Result<()> {
    if message["method"] != "session/update" {
        return Ok(());
    }
    let Some(params) = message.get_mut("params") else {
        return Ok(());
    };
    let session_id = params["sessionId"]
        .as_str()
        .context("dsh_session_id_missing")?
        .to_string();
    let update = &mut params["update"];
    if update["sessionUpdate"] == "usage_update" {
        let prefix = format!("{:x}.usage-", Sha256::digest(session_id.as_bytes()));
        let mut observations = Vec::new();
        let mut files = Vec::new();
        for entry in fs::read_dir(root.join("observations"))? {
            let entry = entry?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with(&prefix) || !name.ends_with(".json") {
                continue;
            }
            if observations.len() >= 1024 {
                bail!("dsh_usage_observation_budget_exceeded");
            }
            let observation: Value = serde_json::from_slice(&fs::read(entry.path())?)?;
            if observation["schemaVersion"] != 1
                || observation["sessionId"] != session_id
                || !observation["seq"].is_u64()
                || !observation["turn"].is_u64()
            {
                bail!("dsh_usage_observation_mismatch");
            }
            observations.push(observation);
            files.push(entry.path());
        }
        observations.sort_by_key(|value| value["seq"].as_u64());
        update["_meta"]["dshUsage"] = json!(observations);
        for file in files {
            fs::remove_file(file)?;
        }
        return Ok(());
    }
    if update["sessionUpdate"] == "tool_call" {
        if let Some(kind) = tool_kind(update["title"].as_str().unwrap_or_default()) {
            update["kind"] = json!(kind);
        }
        return Ok(());
    }
    if update["sessionUpdate"] != "tool_call_update"
        || !matches!(update["status"].as_str(), Some("completed" | "failed"))
    {
        return Ok(());
    }
    let call_id = update["toolCallId"]
        .as_str()
        .context("dsh_tool_call_id_missing")?;
    let key = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&json!([session_id, call_id]))?)
    );
    let path = root.join("observations").join(format!("{key}.json"));
    let observation: Value =
        serde_json::from_slice(&fs::read(&path).context("dsh_tool_observation_missing")?)?;
    if observation["schemaVersion"] != 1
        || observation["sessionId"] != session_id
        || observation["callId"] != call_id
        || !observation["isError"].is_boolean()
    {
        bail!("dsh_tool_observation_mismatch");
    }
    let tool = observation["tool"]
        .as_str()
        .context("dsh_tool_name_missing")?;
    if let Some(kind) = tool_kind(tool) {
        update["kind"] = json!(kind);
    }
    if let Some(path) = observation["path"].as_str() {
        update["locations"] = json!([{"path":path}]);
    }
    append_observed_file_diff(update, &observation, tool);
    if matches!(tool, "bash" | "pwsh") {
        update["rawOutput"] = json!({
            "exitCode": observation["exitCode"], "signal": observation["signal"],
            "timedOut": observation["timedOut"], "aborted": observation["aborted"]
        });
        if observation["isError"] == true
            || observation["timedOut"] == true
            || observation["aborted"] == true
            || observation["signal"].is_string()
            || observation["exitCode"]
                .as_i64()
                .is_some_and(|code| code != 0)
        {
            update["status"] = json!("failed");
        }
    }
    fs::remove_file(path)?;
    Ok(())
}

pub fn tool_kind(name: &str) -> Option<&'static str> {
    match name {
        "bash" | "pwsh" => Some("execute"),
        "read" | "read_image" => Some("read"),
        "write" => Some("write"),
        "edit" => Some("edit"),
        "glob" | "grep" => Some("file_search"),
        "web_search" => Some("web_search"),
        "web_fetch" => Some("fetch"),
        "skill" => Some("tool"),
        _ => None,
    }
}

fn append_observed_file_diff(update: &mut Value, observation: &Value, tool: &str) {
    if !matches!(tool, "write" | "edit") {
        return;
    }
    let Some(path) = observation["path"].as_str() else {
        return;
    };
    // An explicit null is DSH's complete pre-state for a newly created file.
    // Absence and malformed values remain path-only; edit never accepts null.
    let before = match (tool, observation.get("before")) {
        ("write", Some(Value::Null)) => None,
        ("write" | "edit", Some(Value::String(before))) => Some(before.as_str()),
        _ => return,
    };
    let Some(after) = observation.get("after").and_then(Value::as_str) else {
        return;
    };
    if before.is_some_and(|before| before == after)
        || before.is_some_and(|before| before.len() > MAX_OBSERVED_FILE_CONTENT_BYTES)
        || after.len() > MAX_OBSERVED_FILE_CONTENT_BYTES
    {
        return;
    }
    let block = json!({"type":"diff","path":path,"oldText":before,"newText":after});
    match update.get_mut("content") {
        Some(Value::Array(blocks)) => {
            if !blocks.contains(&block) {
                blocks.push(block);
            }
        }
        Some(Value::Null) => update["content"] = json!([block]),
        None => {
            if let Some(update) = update.as_object_mut() {
                update.insert("content".to_string(), json!([block]));
            }
        }
        Some(_) => {}
    }
}

pub fn resolve_mcp_command(server: &mut Value, cwd: &Path) -> Result<()> {
    let Some(command) = server["command"].as_str() else {
        return Ok(());
    };
    let entry = Path::new(command);
    if entry.is_absolute() {
        return Ok(());
    }
    if entry.components().count() != 1 {
        server["command"] = json!(cwd.join(entry));
        return Ok(());
    }
    let mut runtime = Command::new("dsh");
    crate::runtime_discovery::configure_runtime_command(AdapterKind::DeepseekHarness, &mut runtime);
    let path = server["env"]
        .as_array()
        .and_then(|entries| entries.iter().find(|e| e["name"] == "PATH"))
        .and_then(|entry| entry["value"].as_str())
        .map(std::ffi::OsString::from)
        .or_else(|| {
            runtime
                .as_std()
                .get_envs()
                .find(|(key, _)| *key == "PATH")
                .and_then(|(_, value)| value.map(std::ffi::OsString::from))
        })
        .or_else(|| std::env::var_os("PATH"))
        .context("dsh_mcp_path_unavailable")?;
    for directory in std::env::split_paths(&path) {
        let candidate = if directory.is_absolute() {
            directory.join(entry)
        } else {
            cwd.join(directory).join(entry)
        };
        if candidate.is_file() && {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                candidate.metadata()?.permissions().mode() & 0o111 != 0
            }
            #[cfg(not(unix))]
            {
                true
            }
        } {
            server["command"] = json!(candidate);
            return Ok(());
        }
    }
    bail!("dsh_mcp_command_unresolved");
}

pub fn bind_bootstrap(root: &Path, session_id: &str, bootstrap: &str) -> Result<()> {
    if session_id.is_empty()
        || session_id.len() > 128
        || !session_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || bootstrap.trim().is_empty()
    {
        bail!("dsh_bootstrap_binding_invalid");
    }
    let directory = root.join("bindings");
    let path = directory.join(format!("{session_id}.json"));
    let payload = serde_json::to_vec(
        &json!({"schemaVersion":1,"sessionId":session_id,"bootstrap":bootstrap,"sha256":format!("{:x}",Sha256::digest(bootstrap.as_bytes()))}),
    )?;
    // An existing binding owns immutable bytes for its Native Session. A later
    // member identity edit must not hot-rewrite that Session's self identity.
    if path.exists() {
        return Ok(());
    }
    let temporary = directory.join(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temporary, payload)?;
    private_file(&temporary)?;
    fs::rename(&temporary, &path)?;
    Ok(())
}

fn private_directory(path: &Path) -> Result<()> {
    #[cfg(not(unix))]
    let _ = path;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
fn private_file(path: &Path) -> Result<()> {
    #[cfg(not(unix))]
    let _ = path;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dsh_native_configuration_fences_profile_and_credentials() {
        let root = std::env::temp_dir().join(format!("rovai-dsh-config-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("profiles/acp")).unwrap();
        let mut previous = configuration_digest(&root, &root).unwrap();
        // The old digest omitted the profile composition: changing its model
        // route could silently reuse a Host with the previous configuration.
        for (path, contents) in [
            ("profiles/acp/cordis.yml", "fixture-profile-route"),
            (".credentials.yaml", "fixture-private-key"),
            ("settings.yaml", "fixture-provider-settings"),
        ] {
            fs::write(root.join(path), contents).unwrap();
            let next = configuration_digest(&root, &root).unwrap();
            assert_ne!(previous, next, "{path} must fence native configuration");
            assert_eq!(next, configuration_digest(&root, &root).unwrap());
            assert!(!next.contains(contents));
            previous = next;
        }
        fs::remove_file(root.join("settings.yaml")).unwrap();
        fs::create_dir(root.join("settings.yaml")).unwrap();
        assert!(configuration_digest(&root, &root).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dsh_version_requires_the_first_acp_release() {
        for value in [
            None,
            Some("0.1.0-rc.5"),
            Some("0.1.5-rc.1"),
            Some("0.1.5-beta.8"),
            Some("0.0.1"),
            Some("invalid"),
        ] {
            assert!(!supported_version(value), "{value:?}");
        }
        for value in [
            "0.1.5-rc.2",
            "0.1.5-rc.10",
            "0.1.5-rc.2+build.1",
            "0.1.5",
            "0.1.6",
        ] {
            assert!(supported_version(Some(value)), "{value}");
        }
    }

    #[test]
    fn dsh_observation_is_exact_consumed_once_and_never_infers_exit_from_text() {
        let root =
            std::env::temp_dir().join(format!("rovai-dsh-observation-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("observations")).unwrap();
        let key = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&json!(["session-a", "call-a"])).unwrap())
        );
        let file = root.join("observations").join(format!("{key}.json"));
        let mut message = json!({"method":"session/update","params":{"sessionId":"session-a","update":{"sessionUpdate":"tool_call_update","toolCallId":"call-a","status":"completed","content":[{"type":"content","content":{"type":"text","text":"[exit code: 0]"}}]}}});
        fs::write(&file,serde_json::to_vec(&json!({"schemaVersion":1,"sessionId":"session-b","callId":"call-a","tool":"bash","isError":false,"exitCode":7})).unwrap()).unwrap();
        assert!(enrich_message(&root, &mut message).is_err());
        assert!(file.exists());
        fs::write(&file,serde_json::to_vec(&json!({"schemaVersion":1,"sessionId":"session-a","callId":"call-a","tool":"bash","isError":false,"exitCode":7})).unwrap()).unwrap();
        enrich_message(&root, &mut message).unwrap();
        assert_eq!(message["params"]["update"]["status"], "failed");
        assert_eq!(message["params"]["update"]["kind"], "execute");
        assert_eq!(message["params"]["update"]["rawOutput"]["exitCode"], 7);
        assert!(!file.exists());
        assert!(enrich_message(&root, &mut message).is_err());
        let mut unknown = json!({"method":"session/update","params":{"sessionId":"session-a","update":{"sessionUpdate":"tool_call","title":"unknown_tool","kind":"other"}}});
        enrich_message(&root, &mut unknown).unwrap();
        assert_eq!(unknown["params"]["update"]["kind"], "other");
        let prefix = format!("{:x}.usage-12.json", Sha256::digest(b"session-a"));
        fs::write(root.join("observations").join(prefix), serde_json::to_vec(&json!({"schemaVersion":1,"sessionId":"session-a","seq":12,"turn":1,"usage":{"inputTokens":20,"cacheReadTokens":80,"outputTokens":3}})).unwrap()).unwrap();
        let mut usage = json!({"method":"session/update","params":{"sessionId":"session-a","update":{"sessionUpdate":"usage_update","used":100,"size":1000}}});
        enrich_message(&root, &mut usage).unwrap();
        assert_eq!(
            usage.pointer("/params/update/_meta/dshUsage/0/usage/inputTokens"),
            Some(&json!(20))
        );
        enrich_message(&root, &mut usage).unwrap();
        assert_eq!(
            usage.pointer("/params/update/_meta/dshUsage"),
            Some(&json!([]))
        );

        let write_key = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&json!(["session-a", "call-write"])).unwrap())
        );
        let write_file = root.join("observations").join(format!("{write_key}.json"));
        fs::write(
            &write_file,
            serde_json::to_vec(&json!({
                "schemaVersion":1,"sessionId":"session-a","callId":"call-write",
                "tool":"edit","isError":false,"path":"/workspace/example.txt",
                "before":"old\n","after":"new\n"
            }))
            .unwrap(),
        )
        .unwrap();
        let mut write = json!({"method":"session/update","params":{"sessionId":"session-a","update":{"sessionUpdate":"tool_call_update","toolCallId":"call-write","status":"completed","content":[]}}});
        enrich_message(&root, &mut write).unwrap();
        assert_eq!(
            write.pointer("/params/update/content/0"),
            Some(
                &json!({"type":"diff","path":"/workspace/example.txt","oldText":"old\n","newText":"new\n"})
            )
        );
        assert_eq!(
            write.pointer("/params/update/locations/0/path"),
            Some(&json!("/workspace/example.txt"))
        );

        let create_key = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&json!(["session-a", "call-create"])).unwrap())
        );
        fs::write(
            root.join("observations").join(format!("{create_key}.json")),
            serde_json::to_vec(&json!({
                "schemaVersion":1,"sessionId":"session-a","callId":"call-create",
                "tool":"write","isError":false,"path":"/workspace/created.txt",
                "before":null,"after":"created\n"
            }))
            .unwrap(),
        )
        .unwrap();
        let mut create = json!({"method":"session/update","params":{"sessionId":"session-a","update":{"sessionUpdate":"tool_call_update","toolCallId":"call-create","status":"completed","content":[]}}});
        enrich_message(&root, &mut create).unwrap();
        assert_eq!(
            create.pointer("/params/update/content/0"),
            Some(
                &json!({"type":"diff","path":"/workspace/created.txt","oldText":null,"newText":"created\n"})
            )
        );
        assert_eq!(
            create.pointer("/params/update/locations/0/path"),
            Some(&json!("/workspace/created.txt"))
        );

        for (call_id, tool, observation) in [
            (
                "call-write-missing-before",
                "write",
                json!({"path":"/workspace/missing-before.txt","after":"created\n"}),
            ),
            (
                "call-write-missing-after",
                "write",
                json!({"path":"/workspace/missing-after.txt","before":null}),
            ),
            (
                "call-write-malformed-before",
                "write",
                json!({"path":"/workspace/malformed-before.txt","before":0,"after":"created\n"}),
            ),
            (
                "call-edit-null-before",
                "edit",
                json!({"path":"/workspace/invalid-edit.txt","before":null,"after":"changed\n"}),
            ),
            (
                "call-edit-malformed-after",
                "edit",
                json!({"path":"/workspace/malformed-edit.txt","before":"old\n","after":null}),
            ),
        ] {
            let key = format!(
                "{:x}",
                Sha256::digest(serde_json::to_vec(&json!(["session-a", call_id])).unwrap())
            );
            let mut status = json!({
                "schemaVersion":1,"sessionId":"session-a","callId":call_id,
                "tool":tool,"isError":false
            });
            status.as_object_mut().unwrap().extend(
                observation
                    .as_object()
                    .unwrap()
                    .iter()
                    .map(|(key, value)| (key.clone(), value.clone())),
            );
            fs::write(
                root.join("observations").join(format!("{key}.json")),
                serde_json::to_vec(&status).unwrap(),
            )
            .unwrap();
            let mut fallback = json!({"method":"session/update","params":{"sessionId":"session-a","update":{"sessionUpdate":"tool_call_update","toolCallId":call_id,"status":"completed","content":[]}}});
            enrich_message(&root, &mut fallback).unwrap();
            assert_eq!(fallback.pointer("/params/update/content"), Some(&json!([])));
            assert_eq!(
                fallback.pointer("/params/update/locations/0/path"),
                observation.get("path")
            );
        }

        let fallback_key = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&json!(["session-a", "call-fallback"])).unwrap())
        );
        fs::write(
            root.join("observations")
                .join(format!("{fallback_key}.json")),
            serde_json::to_vec(&json!({
                "schemaVersion":1,"sessionId":"session-a","callId":"call-fallback",
                "tool":"write","isError":false,"path":"/workspace/large.txt",
                "before":"","after":"x".repeat(MAX_OBSERVED_FILE_CONTENT_BYTES + 1)
            }))
            .unwrap(),
        )
        .unwrap();
        let mut fallback = json!({"method":"session/update","params":{"sessionId":"session-a","update":{"sessionUpdate":"tool_call_update","toolCallId":"call-fallback","status":"completed","content":[]}}});
        enrich_message(&root, &mut fallback).unwrap();
        assert_eq!(fallback.pointer("/params/update/content"), Some(&json!([])));
        assert_eq!(
            fallback.pointer("/params/update/locations/0/path"),
            Some(&json!("/workspace/large.txt"))
        );
        for (tool, kind) in [
            ("bash", Some("execute")),
            ("read_image", Some("read")),
            ("glob", Some("file_search")),
            ("grep", Some("file_search")),
            ("web_search", Some("web_search")),
            ("web_fetch", Some("fetch")),
            ("skill", Some("tool")),
            ("unknown", None),
        ] {
            assert_eq!(tool_kind(tool), kind, "{tool}");
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn responses_tool_defaults_preserve_native_overrides_and_private_settings() {
        let root =
            std::env::temp_dir().join(format!("rovai-dsh-responses-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("settings.yaml");
        assert_eq!(responses_tool_compat(&path).unwrap(), None);
        let settings = json!({
            "llm-pi-ai":{"providers":{
                "gateway":{"api":"openai-responses","baseURL":"https://private.invalid/v1",
                    "headers":{"Authorization":"private-test-credential"},
                    "models":[{"id":"model","compat":{"supportsStrictMode":false}}]},
                "explicit-off":{"api":"openai-responses","compat":{"supportsStrictMode":false}},
                "explicit-on":{"api":"openai-responses","compat":{"supportsStrictMode":true}},
                "invalid-null":{"api":"openai-responses","compat":{"supportsStrictMode":null}},
                "completions":{"api":"openai-completions"},
                "anthropic":{"api":"anthropic-messages"},
                "native-default":{}
            }},
            "unrelated":{"credential":"another-private-test-value"}
        });
        let original = serde_yaml::to_string(&settings).unwrap();
        fs::write(&path, &original).unwrap();
        let compat = responses_tool_compat(&path).unwrap();
        assert_eq!(
            compat,
            Some(json!({"id":"llm-pi-ai","config":{"providers":{
                "gateway":{"compat":{"supportsStrictMode":true}}
            }}}))
        );
        let mut command = Command::new("dsh");
        configure_host_with_tool_compat(
            &mut command,
            &root,
            &root,
            &json!({"sandbox_mode":"workspace-write","approval_policy":"ask"}),
            &[],
            compat,
        )
        .unwrap();
        let patch = fs::read_to_string(root.join("rovai.patch.json")).unwrap();
        assert!(!patch.contains("private-test"));
        assert!(!patch.contains("private.invalid"));
        assert!(!patch.contains("\"models\""));
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        assert_eq!(
            serde_json::from_str::<Value>(&patch).unwrap()[5]["id"],
            "llm-pi-ai"
        );
        for settings in [json!({}), json!({"llm-pi-ai":{"providers":{}}})] {
            fs::write(&path, serde_json::to_vec(&settings).unwrap()).unwrap();
            assert_eq!(responses_tool_compat(&path).unwrap(), None);
        }
        fs::write(&path, "credential: [private-test-credential").unwrap();
        assert_eq!(
            responses_tool_compat(&path).unwrap_err().to_string(),
            "dsh_native_settings_invalid"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn frozen_permissions_preserve_native_values_without_rewriting_native_home() {
        let root =
            std::env::temp_dir().join(format!("rovai-dsh-permissions-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        for sandbox in ["read-only", "workspace-write", "danger-full-access"] {
            for approval in ["ask", "never"] {
                let mut command = Command::new("dsh");
                configure_host_with_tool_compat(
                    &mut command,
                    &root,
                    &root,
                    &json!({"sandbox_mode":sandbox,"approval_policy":approval}),
                    &[],
                    None,
                )
                .unwrap();
                let patch: Value =
                    serde_json::from_slice(&fs::read(root.join("rovai.patch.json")).unwrap())
                        .unwrap();
                assert_eq!(patch[0]["config"]["mode"], sandbox);
                assert_eq!(patch[1]["config"]["policy"], approval);
                assert_eq!(patch[2], json!({"id":"permission","disabled":true}));
                assert_eq!(
                    patch[3],
                    json!({"id":"acp","inject":["acpAppStartup","rovaiDshReady"]})
                );
                assert!(patch[4]["insert"][0]["config"].get("readOnly").is_none());
                assert!(
                    patch[4]["insert"][0]["config"]
                        .get("approvalPolicy")
                        .is_none()
                );
                assert!(
                    command
                        .as_std()
                        .get_envs()
                        .all(|(key, _)| key != "DSH_HOME")
                );
            }
        }
        fs::remove_dir_all(root).unwrap();
    }
}
