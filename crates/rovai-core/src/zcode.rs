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
pub const BRIDGE_REVISION: &str = "zcode-native-node-transport-v6";

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
    app_config: bool,
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
                        | "ZCODE_DATA_BASE_DIR"
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
        // An explicit terminal configuration keeps its existing authority. App-only
        // login publishes usable provider credentials in the official v2 config;
        // do not decrypt credentials.json or copy either file into a new Home.
        let terminal_path = home.join(".zcode/cli/config.json");
        let use_app_config = match fs::metadata(&terminal_path) {
            Ok(_) => false,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
            Err(_) => bail!("ZCode official configuration is unreadable"),
        };
        let app_base = native_environment
            .get("ZCODE_DATA_BASE_DIR")
            .map(|path| path.trim())
            .filter(|path| !path.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.to_path_buf());
        let user_path = if use_app_config {
            app_base.join(".zcode/v2/config.json")
        } else {
            terminal_path
        };
        let paths = std::iter::once(user_path.clone()).chain(
            directories
                .iter()
                .flat_map(|p| [p.join("zcode.json"), p.join(".zcode/config.json")]),
        );
        let mut user_servers = json!({});
        let mut app_config_loaded = false;
        for path in paths {
            let Some(mut layer) = read_native_configuration(&path)? else {
                continue;
            };
            identities.push(crate::command::canonical_json_digest(&layer)?);
            if path == user_path {
                if use_app_config {
                    let settings =
                        read_native_configuration(&user_path.with_file_name("setting.json"))?
                            .unwrap_or_else(|| json!({}));
                    let selection = json!({"modelProviderFamilyModes":settings["modelProviderFamilyModes"],"modelProviderFamilySelectedKeys":settings["modelProviderFamilySelectedKeys"]});
                    identities.push(crate::command::canonical_json_digest(&selection)?);
                    layer = app_provider_configuration(layer, &selection)?;
                    app_config_loaded = true;
                }
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
            app_config: app_config_loaded,
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
            .context("Sign in to official ZCode App or terminal /login, or configure a provider and model in ~/.zcode/cli/config.json")?;
        let provider = &self.value["provider"][provider_id];
        if provider.get("enabled") == Some(&Value::Bool(false))
            || provider
                .get("systemDisabledReason")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty())
        {
            bail!("ZCode selected provider is disabled in native configuration");
        }
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
        if model.is_none() && (main.is_null() || (self.app_config && main.is_string())) {
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
        if let Some(supports_images) = model.and_then(|model| model.get("supportsImages")) {
            entry["supportsImages"] = supports_images.clone();
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
            if matches!(
                provider_id,
                "builtin:zai-start-plan" | "builtin:bigmodel-start-plan"
            ) {
                // Official App buildStartPlanRuntimeAuthorizationHeaders: these
                // account endpoints require Bearer authorization as well as apiKey.
                let key = key.trim();
                let bearer = key
                    .split_whitespace()
                    .next()
                    .is_some_and(|part| part.eq_ignore_ascii_case("bearer"));
                native["headers"]["Authorization"] = json!(if bearer {
                    key.to_string()
                } else {
                    format!("Bearer {key}")
                });
            }
            native["apiKey"] = json!({"source":"inline","value":key});
            native["apiKeyRequired"] = json!(true);
        } else {
            bail!(
                "ZCode native provider credentials are missing; sign in to official ZCode App or terminal /login, or configure the provider API key"
            );
        }
        Ok(
            json!({"revision":self.digest,"generatedAt":chrono::Utc::now().timestamp_millis(),"model":{"providerId":provider_id,"modelId":model_id},"provider":native}),
        )
    }

    /// App-only providers are absent from the CLI's disk configuration. Register
    /// their complete catalog through the official memory-only registry RPC.
    pub fn app_provider_registry(&self) -> Result<Option<Value>> {
        if !self.app_config {
            return Ok(None);
        }
        let mut providers = Vec::new();
        for (id, provider) in self.value["provider"].as_object().into_iter().flatten() {
            let mut native = None;
            let mut models = Vec::new();
            for (alias, model) in provider["models"].as_object().into_iter().flatten() {
                let id = format!(
                    "{id}/{}",
                    model.get("id").and_then(Value::as_str).unwrap_or(alias)
                );
                let Ok(runtime) = self.runtime_model(Some(&id)) else {
                    continue;
                };
                models.push(runtime["provider"]["models"][0].clone());
                native.get_or_insert_with(|| runtime["provider"].clone());
            }
            if let Some(mut native) = native {
                native["models"] = json!(models);
                providers.push(native);
            }
        }
        Ok(Some(
            json!({"revision":self.digest,"generatedAt":chrono::Utc::now().timestamp_millis(),"providers":providers}),
        ))
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

fn read_native_configuration(path: &Path) -> Result<Option<Value>> {
    if fs::metadata(path).is_ok_and(|metadata| metadata.len() > 4 * 1024 * 1024) {
        bail!("ZCode official configuration exceeds limit");
    }
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => bail!("ZCode official configuration is unreadable"),
    };
    if bytes.len() > 4 * 1024 * 1024 {
        bail!("ZCode official configuration exceeds limit");
    }
    let text = std::str::from_utf8(&bytes).context("ZCode configuration must be UTF-8")?;
    let layer: Value = serde_json::from_str(text)
        .map_err(|_| anyhow::anyhow!("ZCode official configuration is invalid"))?;
    if !layer.is_object() {
        bail!("ZCode configuration must be an object");
    }
    Ok(Some(layer))
}

/// Project the App's published provider config, without loading App sessions or
/// its encrypted credential store. The App owns login, entitlement and refresh.
fn app_provider_configuration(mut app: Value, selection: &Value) -> Result<Value> {
    let providers = app.get_mut("provider").and_then(Value::as_object_mut)
        .context("ZCode App provider configuration is missing; sign in to the official App or terminal /login")?;
    // Match the App's resolved family choice. A cached API key must not silently
    // replace its OAuth plan (or a dynamically resolved Team Plan identity).
    for family in ["zai", "bigmodel"] {
        let api = format!("builtin:{family}");
        let coding = format!("{api}-coding-plan");
        let start = format!("{api}-start-plan");
        let available = |id: &str| {
            providers.get(id).is_some_and(|provider| {
                provider.get("enabled") != Some(&Value::Bool(false))
                    && provider
                        .get("systemDisabledReason")
                        .and_then(Value::as_str)
                        .is_none_or(str::is_empty)
            })
        };
        let selected_key = selection["modelProviderFamilySelectedKeys"][family]
            .as_str()
            .unwrap_or("")
            .trim();
        if selection["modelProviderFamilyModes"][family] != "apiKey"
            && selected_key.starts_with("team-plan:")
            && [&api, &coding, &start].iter().any(|id| available(id))
        {
            bail!(
                "ZCode App Team Plan requires native dynamic credential projection; cached personal credentials cannot be substituted"
            );
        }
        let selected = if selection["modelProviderFamilyModes"][family] == "apiKey" {
            available(&api).then(|| api.clone())
        } else {
            [&start, &coding]
                .into_iter()
                .find(|id| selected_key == format!("coding-plan:{id}") && available(id))
                .cloned()
                .or_else(|| {
                    (available(&coding)
                        && providers[&coding]
                            .pointer("/options/apiKey")
                            .and_then(Value::as_str)
                            .is_some_and(|key| !key.trim().is_empty()))
                    .then(|| coding.clone())
                })
                .or_else(|| {
                    [&start, &coding, &api]
                        .into_iter()
                        .find(|id| available(id))
                        .cloned()
                })
        };
        for id in [&api, &coding, &start] {
            if selected.as_ref() != Some(id) {
                providers.remove(id);
            }
        }
    }
    let mut default = None;
    for (provider_id, provider) in providers.iter_mut() {
        if provider.get("enabled") == Some(&Value::Bool(false))
            || provider
                .get("systemDisabledReason")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty())
            || provider
                .pointer("/options/apiKey")
                .and_then(Value::as_str)
                .is_none_or(|key| key.trim().is_empty())
        {
            continue;
        }
        let Some(models) = provider.get_mut("models").and_then(Value::as_object_mut) else {
            continue;
        };
        models.retain(|_, model| {
            model.pointer("/zcode/deleted") != Some(&Value::Bool(true))
                && model.get("enabled") != Some(&Value::Bool(false))
                && model
                    .get("disabledReason")
                    .and_then(Value::as_str)
                    .is_none_or(str::is_empty)
        });
        for model in models.values_mut() {
            if let Some(input) = model.pointer("/modalities/input").and_then(Value::as_array) {
                model["supportsImages"] = json!(input.iter().any(|value| value == "image"));
            }
        }
        // Official App sorts provider IDs and model priorities ascending. For
        // equal priorities the canonical model ID gives a stable default; users
        // may select any native catalog model explicitly in Rovai.
        if default.is_none() {
            default = models
                .iter()
                .min_by_key(|(id, model)| {
                    (
                        model
                            .pointer("/zcode/priority")
                            .and_then(Value::as_i64)
                            .unwrap_or(i64::MAX),
                        id.to_string(),
                    )
                })
                .map(|(id, model)| {
                    format!(
                        "{provider_id}/{}",
                        model.get("id").and_then(Value::as_str).unwrap_or(id)
                    )
                });
        }
    }
    Ok(json!({"provider":providers,"model":{"main":default}}))
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
        let config = json!({"model":{"main":"byok/alias"},"provider":{"byok":{"kind":"anthropic","options":{"apiKey":"PRIVATE_CANARY","baseURL":"https://example.invalid"},"models":{"friendly":{"id":"alias","supportsImages":true,"limit":{"context":32000}}}}},
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
        assert_eq!(model["provider"]["models"][0]["supportsImages"], true);
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
        // Official terminal /login writes these Coding Plan provider shapes.
        // Account login and manual BYOK share the native config carrier; no
        // caller-supplied key or separate Rovai provider record is required.
        for (provider, endpoint) in [
            ("zai", "https://api.z.ai/api/anthropic"),
            ("bigmodel", "https://open.bigmodel.cn/api/anthropic"),
        ] {
            let key = format!("PRIVATE_ACCOUNT_{provider}");
            let account = json!({"provider":{provider:{"kind":"anthropic","name":"Coding Plan",
                "options":{"apiKeyRequired":true,"baseURL":endpoint,"apiKey":key},
                "models":{"glm-5.1":{"name":"GLM-5.1"},"glm-4.7":{"name":"GLM-4.7"}}}},
                "model":{"main":format!("{provider}/glm-5.1"),"lite":format!("{provider}/glm-4.7")}});
            fs::write(home.join(".zcode/cli/config.json"), account.to_string()).unwrap();
            let signed_in = NativeConfig::load_layers(&cwd, &home, &Default::default()).unwrap();
            let selected = signed_in.runtime_model(None).unwrap();
            assert_eq!(selected["model"]["providerId"], provider);
            assert_eq!(selected["provider"]["apiKey"]["value"], key);
            assert_eq!(selected["provider"]["baseURL"], endpoint);
            let snapshot = json!({"settings":{"model":{"current":selected["model"],"available":[
                {"ref":{"providerId":provider,"modelId":"glm-5.1"}},
                {"ref":{"providerId":provider,"modelId":"glm-4.7"}}]}}});
            let catalog = signed_in
                .session_catalog("account-session", &snapshot)
                .unwrap();
            assert_eq!(
                catalog["models"]["availableModels"]
                    .as_array()
                    .unwrap()
                    .len(),
                2
            );
            assert!(!catalog.to_string().contains(&key));
            assert!(!signed_in.digest.contains(&key));
            let mut missing = account;
            missing["provider"][provider]["options"]
                .as_object_mut()
                .unwrap()
                .remove("apiKey");
            fs::write(home.join(".zcode/cli/config.json"), missing.to_string()).unwrap();
            let unsigned = NativeConfig::load_layers(&cwd, &home, &Default::default()).unwrap();
            assert_ne!(signed_in.digest, unsigned.digest);
            assert!(
                unsigned
                    .runtime_model(None)
                    .unwrap_err()
                    .to_string()
                    .contains("/login")
            );
        }
        fs::remove_file(home.join(".zcode/cli/config.json")).unwrap();
        fs::create_dir_all(home.join(".zcode/v2")).unwrap();
        let app_path = home.join(".zcode/v2/config.json");
        let mut app = json!({"provider":{
            "builtin:zai-start-plan":{"kind":"anthropic","enabled":true,
                "options":{"apiKey":"PRIVATE_APP_TOKEN","baseURL":"https://zcode.z.ai/api/v1/zcode-plan/anthropic"},
                "models":{"vision":{"modalities":{"input":["text","image"]},"zcode":{"priority":1}},
                    "text":{"modalities":{"input":["text"]},"zcode":{"priority":2}},
                    "deleted":{"zcode":{"deleted":true,"priority":0}}}},
            "builtin:zai-coding-plan":{"kind":"anthropic","enabled":false,"systemDisabledReason":"coding_plan_not_entitled",
                "options":{"apiKey":"PRIVATE_DISABLED_TOKEN"},"models":{"blocked":{}}}
        }});
        let bytes = app.to_string();
        fs::write(&app_path, &bytes).unwrap();
        let signed_in = NativeConfig::load_layers(&cwd, &home, &Default::default()).unwrap();
        let carrier = signed_in.runtime_model(None).unwrap();
        assert_eq!(carrier["model"]["modelId"], "vision");
        assert_eq!(
            carrier["provider"]["headers"]["Authorization"],
            "Bearer PRIVATE_APP_TOKEN"
        );
        assert_eq!(carrier["provider"]["models"][0]["supportsImages"], true);
        assert_eq!(
            signed_in
                .runtime_model(Some("builtin:zai-start-plan/text"))
                .unwrap()["provider"]["models"][0]["supportsImages"],
            false
        );
        assert!(
            signed_in
                .runtime_model(Some("builtin:zai-coding-plan/blocked"))
                .is_err()
        );
        assert!(
            signed_in
                .runtime_model(Some("builtin:zai-start-plan/deleted"))
                .is_err()
        );
        let registry = signed_in.app_provider_registry().unwrap().unwrap();
        assert_eq!(registry["providers"].as_array().unwrap().len(), 1);
        assert_eq!(
            registry["providers"][0]["models"].as_array().unwrap().len(),
            2
        );
        assert!(!registry.to_string().contains("PRIVATE_DISABLED_TOKEN"));
        assert_eq!(fs::read_to_string(&app_path).unwrap(), bytes);
        assert!(!home.join(".zcode/cli/config.json").exists());
        app["provider"]["builtin:zai-start-plan"]["options"]["apiKey"] =
            json!("PRIVATE_ROTATED_APP_TOKEN");
        fs::write(&app_path, app.to_string()).unwrap();
        let rotated = NativeConfig::load_layers(&cwd, &home, &Default::default()).unwrap();
        assert_ne!(signed_in.digest, rotated.digest);
        assert!(!rotated.digest.contains("PRIVATE_ROTATED_APP_TOKEN"));
        let custom = root.join("custom-app-data");
        fs::create_dir_all(custom.join(".zcode/v2")).unwrap();
        fs::write(custom.join(".zcode/v2/config.json"), &bytes).unwrap();
        let custom_env = std::collections::BTreeMap::from([(
            "ZCODE_DATA_BASE_DIR".to_string(),
            custom.to_str().unwrap().to_string(),
        )]);
        let custom_config = NativeConfig::load_layers(&cwd, &home, &custom_env).unwrap();
        assert_eq!(
            custom_config.runtime_model(None).unwrap()["provider"]["apiKey"]["value"],
            "PRIVATE_APP_TOKEN"
        );
        let mut dual = app.clone();
        dual["provider"]["builtin:zai"] = json!({"kind":"anthropic","options":{"apiKey":"PRIVATE_APP_BYOK"},"models":{"api-model":{}}});
        fs::write(&app_path, dual.to_string()).unwrap();
        let setting_path = app_path.with_file_name("setting.json");
        fs::write(
            &setting_path,
            json!({"modelProviderFamilyModes":{"zai":"apiKey"},
                "modelProviderFamilySelectedKeys":{"zai":"team-plan:builtin:zai-coding-plan:fixture"}}).to_string(),
        )
        .unwrap();
        let api_mode = NativeConfig::load_layers(&cwd, &home, &Default::default()).unwrap();
        assert_eq!(
            api_mode.runtime_model(None).unwrap()["model"]["providerId"],
            "builtin:zai"
        );
        fs::write(
            &setting_path,
            json!({"modelProviderFamilyModes":{"zai":"oauth"}}).to_string(),
        )
        .unwrap();
        let oauth_mode = NativeConfig::load_layers(&cwd, &home, &Default::default()).unwrap();
        assert_eq!(
            oauth_mode.runtime_model(None).unwrap()["model"]["providerId"],
            "builtin:zai-start-plan"
        );
        assert_ne!(api_mode.digest, oauth_mode.digest);
        fs::write(&setting_path, json!({"modelProviderFamilySelectedKeys":{"zai":"team-plan:builtin:zai-coding-plan:fixture"}}).to_string()).unwrap();
        assert!(
            NativeConfig::load_layers(&cwd, &home, &Default::default())
                .err()
                .unwrap()
                .to_string()
                .contains("Team Plan")
        );
        fs::write(home.join(".zcode/cli/config.json"), config.to_string()).unwrap();
        let terminal = NativeConfig::load_layers(&cwd, &home, &custom_env).unwrap();
        assert_eq!(
            terminal.runtime_model(None).unwrap()["model"]["providerId"],
            "byok"
        );
        assert!(terminal.app_provider_registry().unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
