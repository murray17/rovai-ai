//! Native Cline configuration identity and shared tool/metric interpretation.
//! Transport, process ownership and session lifecycle belong to cline_hub.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::command::canonical_json_digest;

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
        &json!({"files":native_configuration_digest(&runtime_native_paths()?)?,"environment":environment}),
    )
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
    /// CLINE_DATA_DIR is the data directory itself, unlike --data-dir. ACP
    /// branches before the CLI flag handler, so use the official environment.
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

/// The digest contains hashes, never credential values. Native model catalogs
/// and provider settings must fence an idle Host as well as cold continuation.
pub fn native_configuration_digest(paths: &NativePaths) -> Result<String> {
    let mut entries = Vec::new();
    for path in [
        &paths.providers,
        &paths.settings,
        &paths.mcp,
        &paths.data.join("settings/models.json"),
    ] {
        let digest = match fs::read(path) {
            Ok(bytes) => Some(format!("{:x}", Sha256::digest(bytes))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
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
    canonical_json_digest(
        &json!({"revision": "cline-native-hub-config-v1", "config": paths.config, "data": paths.data, "files": entries}),
    )
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
}
