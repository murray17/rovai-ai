//! Official ZCode bundle identity and native configuration. No community CLI,
//! credential broker, user-home copy, or provider settings owned by Rovai.

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tokio::process::Command;

mod events;
pub mod transport;

pub const PROTOCOL: &str = "zcode-app-server-v1";
pub const MINIMUM_VERSION: &str = "0.16.5";
pub const BRIDGE_REVISION: &str = "zcode-native-node-transport-v3";

pub fn supported_version(version: Option<&str>) -> bool {
    version
        .and_then(|version| {
            let parts = version
                .trim()
                .strip_prefix('v')
                .unwrap_or(version.trim())
                .split('.')
                .map(str::parse::<u64>)
                .collect::<std::result::Result<Vec<_>, _>>()
                .ok()?;
            (parts.len() == 3).then(|| [parts[0], parts[1], parts[2]] >= [0, 16, 5])
        })
        .unwrap_or(false)
}

/// Resolve only the official app layout. A `zcode` npm launcher is not an
/// alternative installation of this adapter.
pub fn runtime_script(executable: &Path) -> Result<PathBuf> {
    let executable = executable
        .canonicalize()
        .context("ZCode executable unavailable")?;
    let contents = executable
        .parent()
        .and_then(Path::parent)
        .context("ZCode bundle missing")?;
    if executable.file_name().and_then(|v| v.to_str()) != Some("ZCode")
        || contents.file_name().and_then(|v| v.to_str()) != Some("Contents")
    {
        bail!("ZCode requires the official App executable");
    }
    #[cfg(target_os = "macos")]
    {
        let info = plist::Value::from_file(contents.join("Info.plist"))?;
        if info
            .as_dictionary()
            .and_then(|d| d.get("CFBundleIdentifier"))
            .and_then(plist::Value::as_string)
            != Some("dev.zcode.app")
        {
            bail!("ZCode bundle identity mismatch");
        }
    }
    let script = contents.join("Resources/glm/zcode.cjs").canonicalize()?;
    if !script.starts_with(contents) || !script.is_file() {
        bail!("ZCode bundled Runtime is unavailable");
    }
    Ok(script)
}

pub fn node_executable() -> Result<PathBuf> {
    let mut environment = Command::new("node");
    crate::runtime_discovery::configure_active_runtime_command(&mut environment);
    let search_path = environment
        .as_std()
        .get_envs()
        .find(|(key, _)| *key == "PATH")
        .and_then(|(_, value)| value.map(std::ffi::OsStr::to_os_string))
        .or_else(|| std::env::var_os("PATH"))
        .unwrap_or_default();
    let candidates = match std::env::var_os("ROVAI_ZCODE_NODE_BIN") {
        Some(path) => vec![PathBuf::from(path)],
        None => std::env::split_paths(&search_path)
            .filter(|path| path.is_absolute())
            .map(|path| path.join("node"))
            .collect(),
    };
    for candidate in candidates {
        let Ok(candidate) = candidate.canonicalize() else {
            continue;
        };
        // An Electron App executable registers with Launch Services even in
        // RUN_AS_NODE mode. Never accept an App bundle as the Node host.
        if candidate
            .components()
            .any(|part| part.as_os_str().to_string_lossy().ends_with(".app"))
        {
            continue;
        }
        let metadata = std::fs::metadata(&candidate)?;
        if !metadata.is_file() {
            continue;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o111 == 0 {
                continue;
            }
        }
        return Ok(candidate);
    }
    bail!(
        "ZCode headless Runtime requires Node.js on PATH; its App UI executable is never launched"
    )
}

/// The Installation path identifies the official bundle, not the process to
/// execute. Every Probe/Host uses this constructor to avoid launching its GUI.
pub fn command(executable: &Path) -> Result<Command> {
    let script = runtime_script(executable)?;
    let mut command = Command::new(node_executable()?);
    crate::runtime_discovery::configure_active_runtime_command(&mut command);
    command
        .args(["--eval", include_str!("zcode/stdio-owner.cjs")])
        .arg(script);
    Ok(command)
}

pub fn bundle_members(executable: &Path) -> Result<Vec<PathBuf>> {
    let script = runtime_script(executable)?;
    let executable = executable.canonicalize()?;
    Ok(vec![executable, script, node_executable()?])
}

pub fn default_executables() -> Vec<PathBuf> {
    let mut paths = vec![PathBuf::from(
        "/Applications/ZCode.app/Contents/MacOS/ZCode",
    )];
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join("Applications/ZCode.app/Contents/MacOS/ZCode"));
    }
    paths
}

/// Official JSON config layers. Keep the bytes and credentials private;
/// only a one-way digest may participate in a Host/Session compatibility key.
pub struct NativeConfig {
    value: Value,
    pub digest: String,
}

impl NativeConfig {
    pub fn output_root(&self) -> Result<PathBuf> {
        let storage = std::env::var("ZCODE_STORAGE_DIR")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .map(|v| PathBuf::from(v.trim()));
        Ok(storage
            .unwrap_or(
                dirs::home_dir()
                    .context("ZCode native Home unavailable")?
                    .join(".zcode"),
            )
            .join("cli/exec"))
    }
    pub fn load(cwd: &Path) -> Result<Self> {
        let home = dirs::home_dir().context("ZCode native Home unavailable")?;
        let native_environment = std::env::vars()
            .filter(|(key, _)| {
                matches!(
                    key.as_str(),
                    "ZCODE_MODEL"
                        | "ZCODE_BASE_URL"
                        | "ZCODE_STORAGE_DIR"
                        | "ZCODE_SESSION_DB"
                        | "ZCODE_SESSION_DB_PATH"
                        | "ZCODE_HTTP_PROXY"
                        | "ZCODE_NO_PROXY"
                        | "ZCODE_AGENT_CA_CERT"
                        | "ZCODE_HTTP_TIMEOUT"
                        | "ZCODE_TIMEOUT"
                )
            })
            .collect::<std::collections::BTreeMap<_, _>>();
        Self::load_layers(cwd, &home, &native_environment)
    }

    fn load_layers(
        cwd: &Path,
        home: &Path,
        native_environment: &std::collections::BTreeMap<String, String>,
    ) -> Result<Self> {
        let mut config = json!({});
        let mut identities = Vec::new();
        let mut directories = Vec::new();
        for parent in cwd.ancestors() {
            directories.push(parent.to_path_buf());
            if parent.join(".git").exists() {
                break;
            }
        }
        if directories.last().is_none_or(|p| !p.join(".git").exists()) {
            directories = vec![cwd.to_path_buf()];
        }
        directories.reverse();
        let user_path = home.join(".zcode/cli/config.json");
        let paths = std::iter::once(user_path.clone()).chain(
            directories
                .iter()
                .flat_map(|p| [p.join("zcode.json"), p.join(".zcode/config.json")]),
        );
        let mut user_servers = json!({});
        for path in paths {
            if fs::metadata(&path).is_ok_and(|metadata| metadata.len() > 4 * 1024 * 1024) {
                bail!("ZCode official configuration exceeds limit");
            }
            let bytes = match fs::read(&path) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => bail!("ZCode official configuration is unreadable"),
            };
            if bytes.len() > 4 * 1024 * 1024 {
                bail!("ZCode official configuration exceeds limit");
            }
            let text = std::str::from_utf8(&bytes).context("ZCode configuration must be UTF-8")?;
            let mut layer: Value = serde_json::from_str(text)
                .map_err(|_| anyhow::anyhow!("ZCode official configuration is invalid"))?;
            if !layer.is_object() {
                bail!("ZCode configuration must be an object");
            }
            identities.push(crate::command::canonical_json_digest(&layer)?);
            if path == user_path {
                user_servers = layer
                    .pointer("/mcp/servers")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
            } else if let Some(servers) = layer
                .pointer_mut("/mcp/servers")
                .and_then(Value::as_object_mut)
            {
                let base = if path
                    .parent()
                    .and_then(Path::file_name)
                    .is_some_and(|n| n == ".zcode")
                {
                    path.parent().and_then(Path::parent)
                } else {
                    path.parent()
                }
                .context("ZCode project configuration directory missing")?;
                for definition in servers.values_mut() {
                    if definition["type"] == "stdio" || definition.get("command").is_some() {
                        let directory =
                            Path::new(definition.get("cwd").and_then(Value::as_str).unwrap_or("."));
                        if !directory.is_absolute() {
                            definition["cwd"] = json!(base.join(directory));
                        }
                    }
                }
            }
            merge(&mut config, layer);
        }
        // Native resolveEffectiveMcpServers gives user entries precedence over
        // project entries (unlike ordinary project config fields).
        if let Some(user_servers) = user_servers.as_object() {
            for (name, server) in user_servers {
                config["mcp"]["servers"][name] = server.clone();
            }
        }
        if let Some(model) = native_environment
            .get("ZCODE_MODEL")
            .filter(|v| !v.trim().is_empty())
        {
            config["model"] = json!({"main":if model.contains('/') { model.trim().to_string() } else { format!("anthropic/{}",model.trim()) }});
        }
        if let Some(base_url) = native_environment
            .get("ZCODE_BASE_URL")
            .filter(|v| !v.trim().is_empty())
        {
            config["nativeBaseURLOverride"] = json!(base_url.trim());
        }
        let digest = crate::command::canonical_json_digest(
            &json!({"layers":identities,"environment":native_environment,"bridge":BRIDGE_REVISION}),
        )?;
        Ok(Self {
            value: config,
            digest,
        })
    }

    fn configured_main(&self) -> &Value {
        self.value
            .pointer("/model/main")
            .unwrap_or(&self.value["model"])
    }

    pub fn runtime_model(&self, selected: Option<&str>) -> Result<Value> {
        let main = self.configured_main();
        let default = if let Some(value) = main.as_str() {
            value.to_string()
        } else if let (Some(provider), Some(model)) =
            (main["provider"].as_str(), main["model"].as_str())
        {
            format!("{provider}/{model}")
        } else {
            String::new()
        };
        let target = selected.unwrap_or(&default);
        let (provider_id, model_id) = target
            .split_once('/')
            .context("Configure a BYOK provider and model in ~/.zcode/cli/config.json")?;
        let provider = &self.value["provider"][provider_id];
        let models = provider["models"].as_object();
        let model = models
            .and_then(|models| {
                models.iter().find(|(id, model)| {
                    model.get("id").and_then(Value::as_str).unwrap_or(id) == model_id
                })
            })
            .map(|(_, model)| model);
        let main = if target == default {
            main
        } else {
            &Value::Null
        };
        if model.is_none() && main.is_null() {
            bail!("ZCode selected model not present in official configuration");
        }
        let kind = main
            .get("kind")
            .or_else(|| provider.get("kind"))
            .and_then(Value::as_str)
            .context("ZCode provider kind unavailable")?;
        let options = &provider["options"];
        let mut entry = json!({"modelId":model_id});
        if let Some(model) = model {
            for (target, paths) in [
                ("contextWindow", ["/contextWindow", "/limit/context"]),
                ("maxOutputTokens", ["/limit/output", "/maxOutputTokens"]),
            ] {
                if let Some(value) = paths.iter().find_map(|path| model.pointer(path)) {
                    entry[target] = value.clone();
                }
            }
        }
        let mut native = json!({"providerId":provider_id,"kind":kind,"models":[entry]});
        if let Some(base_url) = self
            .value
            .get("nativeBaseURLOverride")
            .or_else(|| main.get("baseURL"))
            .or_else(|| options.get("baseURL"))
        {
            native["baseURL"] = base_url.clone();
        }
        let mut headers = json!({});
        for layer in [
            provider.get("headers"),
            options.get("headers"),
            model.and_then(|v| v.get("headers")),
            main.get("headers"),
        ]
        .into_iter()
        .flatten()
        {
            merge(&mut headers, layer.clone());
        }
        if headers.as_object().is_some_and(|value| !value.is_empty()) {
            native["headers"] = headers;
        }
        if let Some(key) = main
            .get("apiKey")
            .or_else(|| options.get("apiKey"))
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
        {
            native["apiKey"] = json!({"source":"inline","value":key});
            native["apiKeyRequired"] = json!(true);
        } else {
            bail!("ZCode BYOK apiKey is missing from official provider options");
        }
        Ok(
            json!({"revision":self.digest,"generatedAt":chrono::Utc::now().timestamp_millis(),"model":{"providerId":provider_id,"modelId":model_id},"provider":native}),
        )
    }

    pub fn mcp_servers(&self, assigned: Option<&Value>) -> Result<Vec<Value>> {
        let mut servers = std::collections::BTreeMap::new();
        if self.value.pointer("/mcp/enabled") != Some(&json!(false))
            && let Some(native) = self
                .value
                .pointer("/mcp/servers")
                .and_then(Value::as_object)
        {
            for (name, definition) in native {
                if definition.get("enabled") == Some(&json!(false)) {
                    continue;
                }
                let mut server = json!({"name":name});
                for field in [
                    "type",
                    "command",
                    "url",
                    "oauth",
                    "timeoutMs",
                    "isolation",
                    "protocolVersion",
                ] {
                    if let Some(value) = definition.get(field) {
                        server[field] = value.clone();
                    }
                }
                if definition.get("command").is_some() {
                    server
                        .as_object_mut()
                        .context("ZCode MCP definition invalid")?
                        .remove("type");
                    server["args"] = definition.get("args").cloned().unwrap_or_else(|| json!([]));
                    if let Some(cwd) = definition.get("cwd").and_then(Value::as_str) {
                        let command = definition["command"]
                            .as_str()
                            .context("ZCode MCP command invalid")?;
                        let mut args = vec![
                            json!("-c"),
                            json!("cd -- \"$1\" && shift && exec \"$@\""),
                            json!("rovai-zcode-mcp"),
                            json!(cwd),
                            json!(command),
                        ];
                        args.extend(
                            server["args"]
                                .as_array()
                                .context("ZCode MCP args invalid")?
                                .iter()
                                .cloned(),
                        );
                        server["command"] = json!("/bin/sh");
                        server["args"] = json!(args);
                    }
                    server["env"] = json!(
                        definition
                            .get("env")
                            .and_then(Value::as_object)
                            .into_iter()
                            .flatten()
                            .map(|(name, value)| json!({"name":name,"value":value}))
                            .collect::<Vec<_>>()
                    );
                } else {
                    // Native config defaults URL-only servers to HTTP and
                    // accepts http_headers; app-server's RPC schema is explicit.
                    if !server["type"].is_string() {
                        server["type"] = json!("http");
                    }
                    server["headers"] = json!(
                        definition
                            .get("headers")
                            .or_else(|| definition.get("http_headers"))
                            .and_then(Value::as_object)
                            .into_iter()
                            .flatten()
                            .map(|(name, value)| json!({"name":name,"value":value}))
                            .collect::<Vec<_>>()
                    );
                }
                server
                    .as_object_mut()
                    .context("ZCode MCP definition invalid")?
                    .remove("enabled");
                servers.insert(name.to_string(), server);
            }
        }
        for server in assigned.and_then(Value::as_array).into_iter().flatten() {
            let name = server["name"]
                .as_str()
                .context("Assigned ZCode MCP name missing")?;
            servers.insert(name.to_string(), server.clone());
        }
        Ok(servers.into_values().collect())
    }

    pub fn session_catalog(&self, session_id: &str, snapshot: &Value) -> Result<Value> {
        let native = snapshot
            .pointer("/settings/model")
            .context("ZCode native model catalog missing")?;
        let current = native["current"]["providerId"]
            .as_str()
            .zip(native["current"]["modelId"].as_str())
            .map(|(provider, model)| format!("{provider}/{model}"))
            .context("ZCode current model missing")?;
        let expected = self.runtime_model(None)?;
        if native["current"] != expected["model"] {
            bail!("ZCode did not select the configured native default model");
        }
        let models = native["available"].as_array().context("ZCode model choices missing")?.iter().filter_map(|choice| {
            let provider = choice["ref"]["providerId"].as_str()?;
            let model = choice["ref"]["modelId"].as_str()?;
            let id = format!("{provider}/{model}");
            self.runtime_model(Some(&id)).ok()?;
            Some(json!({"modelId":id,"name":choice.get("label").and_then(Value::as_str).unwrap_or(model)}))
        }).collect::<Vec<_>>();
        if !models.iter().any(|model| model["modelId"] == current) {
            bail!("ZCode configured model is unavailable in native catalog");
        }
        Ok(
            json!({"sessionId":session_id,"models":{"currentModelId":current,"availableModels":models}}),
        )
    }

    pub fn preferences(&self) -> Value {
        json!({
            "nativeSearchEnhancementsEnabled": self.value.pointer("/features/search").and_then(Value::as_bool).unwrap_or(false),
            "memoryEnabled":self.value.pointer("/memory/use").and_then(Value::as_bool).unwrap_or(true),
            "askUserQuestionAutoResolutionEnabled":false,
            "modelContextBudgetStrategy":"preflight-v1"
        })
    }
}

fn merge(target: &mut Value, layer: Value) {
    if let (Some(target), Some(layer)) = (target.as_object_mut(), layer.as_object()) {
        for (key, value) in layer {
            merge(target.entry(key).or_insert(Value::Null), value.clone());
        }
    } else {
        *target = layer;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Owns native file precedence and the private BYOK/public catalog boundary.
    // No environment mutation or real credentials are used by this fixture.
    #[test]
    fn native_layers_preserve_byok_precedence_mcp_cwd_and_catalog_authority() {
        let root =
            std::env::temp_dir().join(format!("rovai-zcode-config-{}", uuid::Uuid::new_v4()));
        let home = root.join("home");
        let project = root.join("project");
        let cwd = project.join("nested");
        for path in [
            home.join(".zcode/cli"),
            project.join(".git"),
            cwd.join(".zcode"),
        ] {
            fs::create_dir_all(path).unwrap();
        }
        let config = json!({"model":{"main":"byok/alias"},"provider":{"byok":{"kind":"anthropic","options":{"apiKey":"PRIVATE_CANARY","baseURL":"https://example.invalid"},"models":{"friendly":{"id":"alias","limit":{"context":32000}}}}},
            "mcp":{"servers":{"same":{"type":"stdio","command":"user-server"}}}});
        fs::write(home.join(".zcode/cli/config.json"), config.to_string()).unwrap();
        fs::write(project.join("zcode.json"),json!({"memory":{"use":false},"mcp":{"servers":{"same":{"type":"stdio","command":"project-server"},"relative":{"command":"local-server","cwd":"tools"},"remote":{"url":"https://example.invalid/mcp","http_headers":{"X-Probe":"native"}}}}}).to_string()).unwrap();
        fs::write(
            cwd.join(".zcode/config.json"),
            json!({"provider":{"byok":{"options":{"baseURL":"https://project.invalid"}}}})
                .to_string(),
        )
        .unwrap();
        let native = NativeConfig::load_layers(&cwd, &home, &Default::default()).unwrap();
        let model = native.runtime_model(None).unwrap();
        assert_eq!(model["provider"]["apiKey"]["value"], "PRIVATE_CANARY");
        assert_eq!(model["provider"]["baseURL"], "https://project.invalid");
        assert_eq!(model["model"]["modelId"], "alias");
        let servers = native.mcp_servers(None).unwrap();
        assert_eq!(
            servers.iter().find(|s| s["name"] == "same").unwrap()["command"],
            "user-server"
        );
        assert_eq!(
            servers.iter().find(|s| s["name"] == "relative").unwrap()["args"][3],
            json!(project.join("tools"))
        );
        let remote = servers
            .iter()
            .find(|server| server["name"] == "remote")
            .unwrap();
        assert_eq!(remote["type"], "http");
        assert_eq!(
            remote["headers"],
            json!([{"name":"X-Probe","value":"native"}])
        );
        let assigned = native
            .mcp_servers(Some(
                &json!([{"name":"same","command":"rovai-server","args":[],"env":[]}]),
            ))
            .unwrap();
        assert_eq!(
            assigned.iter().find(|s| s["name"] == "same").unwrap()["command"],
            "rovai-server"
        );
        let snapshot = json!({"settings":{"model":{"current":{"providerId":"byok","modelId":"alias"},"available":[{"ref":{"providerId":"byok","modelId":"alias"},"label":"Model"},{"ref":{"providerId":"unknown","modelId":"unconfigured"}}]}}});
        let public = native.session_catalog("session", &snapshot).unwrap();
        assert_eq!(
            public["models"]["availableModels"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(!public.to_string().contains("PRIVATE_CANARY"));
        assert!(!native.digest.contains("PRIVATE_CANARY"));
        let changed = NativeConfig::load_layers(
            &cwd,
            &home,
            &std::collections::BTreeMap::from([(
                "ZCODE_BASE_URL".to_string(),
                "https://environment.invalid".to_string(),
            )]),
        )
        .unwrap();
        assert_ne!(native.digest, changed.digest);
        assert_eq!(
            changed.runtime_model(None).unwrap()["provider"]["baseURL"],
            "https://environment.invalid"
        );
        for (version, valid) in [
            ("0.16.5", true),
            ("0.16.4", false),
            ("v0.17.0", true),
            ("unknown", false),
        ] {
            assert_eq!(supported_version(Some(version)), valid);
        }
        fs::remove_dir_all(root).unwrap();
    }
}
