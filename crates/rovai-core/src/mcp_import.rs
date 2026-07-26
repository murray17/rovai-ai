use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::mcp::{
    McpConfigFile, McpConfigStore, McpEditableValue, McpServerDefinition, McpServerInput,
    TEAM_MCP_RESERVED_NAME,
};

const MAX_SOURCE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum McpImportSourceKind {
    Codex,
    ClaudeCode,
    Opencode,
    Copilot,
    Antigravity,
    Cursor,
}

impl McpImportSourceKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::ClaudeCode => "claude_code",
            Self::Opencode => "opencode",
            Self::Copilot => "copilot",
            Self::Antigravity => "antigravity",
            Self::Cursor => "cursor",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpImportSourceStatus {
    Missing,
    Loaded,
    Invalid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpImportCompatibility {
    Portable,
    NeedsInput,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpImportConflict {
    None,
    Same,
    NameConflict,
    DuplicateDefinition,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpImportIssue {
    pub code: String,
    pub message: String,
    pub field: Option<String>,
    pub blocking: bool,
    pub requires_confirmation: bool,
}

impl McpImportIssue {
    fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        field: Option<String>,
        blocking: bool,
        requires_confirmation: bool,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            field,
            blocking,
            requires_confirmation,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpImportCandidate {
    pub candidate_id: String,
    pub source_kind: McpImportSourceKind,
    pub source_path: String,
    pub source_name: String,
    pub proposed_name: String,
    pub normalized_definition: Option<McpServerInput>,
    pub source_enabled: Option<bool>,
    pub compatibility: McpImportCompatibility,
    pub issues: Vec<McpImportIssue>,
    pub conflict: McpImportConflict,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpImportSourceView {
    pub source_kind: McpImportSourceKind,
    pub source_path: String,
    pub status: McpImportSourceStatus,
    pub candidate_count: usize,
    pub issue: Option<McpImportIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpImportInspection {
    pub config_digest: String,
    pub sources: Vec<McpImportSourceView>,
    pub candidates: Vec<McpImportCandidate>,
}

#[derive(Debug, Clone)]
struct SourceSpec {
    kind: McpImportSourceKind,
    path: PathBuf,
    format: SourceFormat,
    root_key: &'static str,
}

#[derive(Debug, Clone, Copy)]
enum SourceFormat {
    Jsonc,
    Toml,
}

struct NormalizedCandidate {
    public: McpImportCandidate,
    raw_definition: Option<McpServerDefinition>,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct McpImportScanner;

impl McpImportScanner {
    pub fn scan(
        &self,
        store: &McpConfigStore,
        known_agent_profile_ids: &BTreeSet<String>,
        active_agent_profile_ids: &[String],
    ) -> Result<McpImportInspection> {
        self.scan_specs(
            store,
            known_agent_profile_ids,
            active_agent_profile_ids,
            source_specs()?,
        )
    }

    fn scan_specs(
        &self,
        store: &McpConfigStore,
        known_agent_profile_ids: &BTreeSet<String>,
        active_agent_profile_ids: &[String],
        specs: Vec<SourceSpec>,
    ) -> Result<McpImportInspection> {
        let (config_view, current_config) = store.get_with_raw(known_agent_profile_ids)?;
        let mut sources = Vec::with_capacity(specs.len());
        let mut normalized_candidates = Vec::new();
        for spec in specs {
            match scan_source(&spec, active_agent_profile_ids) {
                Ok(Some(mut normalized)) => {
                    for candidate in &mut normalized {
                        candidate.public.conflict =
                            conflict_for(candidate, current_config.as_ref());
                    }
                    sources.push(McpImportSourceView {
                        source_kind: spec.kind,
                        source_path: display_path(&spec.path),
                        status: McpImportSourceStatus::Loaded,
                        candidate_count: normalized.len(),
                        issue: None,
                    });
                    normalized_candidates.extend(normalized);
                }
                Ok(None) => sources.push(McpImportSourceView {
                    source_kind: spec.kind,
                    source_path: display_path(&spec.path),
                    status: McpImportSourceStatus::Missing,
                    candidate_count: 0,
                    issue: None,
                }),
                Err(error) => sources.push(McpImportSourceView {
                    source_kind: spec.kind,
                    source_path: display_path(&spec.path),
                    status: McpImportSourceStatus::Invalid,
                    candidate_count: 0,
                    issue: Some(McpImportIssue::new(
                        "mcp.import_source_invalid",
                        error.to_string(),
                        None,
                        true,
                        false,
                    )),
                }),
            }
        }
        for index in 0..normalized_candidates.len() {
            if normalized_candidates[index].public.conflict != McpImportConflict::None {
                continue;
            }
            let duplicate = (0..index).any(|other| {
                match (
                    normalized_candidates[index].raw_definition.as_ref(),
                    normalized_candidates[other].raw_definition.as_ref(),
                ) {
                    (Some(candidate), Some(existing)) => same_connection(candidate, existing),
                    _ => false,
                }
            });
            if duplicate {
                normalized_candidates[index].public.conflict =
                    McpImportConflict::DuplicateDefinition;
            }
        }
        let mut candidates = normalized_candidates
            .into_iter()
            .map(|candidate| candidate.public)
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| {
            left.source_kind
                .cmp(&right.source_kind)
                .then_with(|| left.source_name.cmp(&right.source_name))
        });
        Ok(McpImportInspection {
            config_digest: config_view.config_digest,
            sources,
            candidates,
        })
    }
}

fn source_specs() -> Result<Vec<SourceSpec>> {
    let home = dirs::home_dir().context("could not determine the user home directory")?;
    let xdg = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));
    let codex_home = env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".codex"));
    let copilot_home = env::var_os("COPILOT_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".copilot"));
    let opencode_path = env::var_os("OPENCODE_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let json = xdg.join("opencode/opencode.json");
            let jsonc = xdg.join("opencode/opencode.jsonc");
            if json.exists() { json } else { jsonc }
        });
    let mut specs = vec![
        SourceSpec {
            kind: McpImportSourceKind::Codex,
            path: codex_home.join("config.toml"),
            format: SourceFormat::Toml,
            root_key: "mcp_servers",
        },
        SourceSpec {
            kind: McpImportSourceKind::ClaudeCode,
            path: home.join(".claude.json"),
            format: SourceFormat::Jsonc,
            root_key: "mcpServers",
        },
        SourceSpec {
            kind: McpImportSourceKind::Opencode,
            path: opencode_path,
            format: SourceFormat::Jsonc,
            root_key: "mcp",
        },
        SourceSpec {
            kind: McpImportSourceKind::Copilot,
            path: copilot_home.join("mcp-config.json"),
            format: SourceFormat::Jsonc,
            root_key: "mcpServers",
        },
        SourceSpec {
            kind: McpImportSourceKind::Antigravity,
            path: home.join(".gemini/config/mcp_config.json"),
            format: SourceFormat::Jsonc,
            root_key: "mcpServers",
        },
        SourceSpec {
            kind: McpImportSourceKind::Cursor,
            path: home.join(".cursor/mcp.json"),
            format: SourceFormat::Jsonc,
            root_key: "mcpServers",
        },
    ];
    let claude_mcp_file = home.join(".claude/mcp.json");
    if claude_mcp_file.exists() {
        specs.insert(
            2,
            SourceSpec {
                kind: McpImportSourceKind::ClaudeCode,
                path: claude_mcp_file,
                format: SourceFormat::Jsonc,
                root_key: "mcpServers",
            },
        );
    }
    Ok(specs)
}

fn scan_source(
    spec: &SourceSpec,
    active_agent_profile_ids: &[String],
) -> Result<Option<Vec<NormalizedCandidate>>> {
    if !spec.path.exists() {
        return Ok(None);
    }
    let metadata = fs::metadata(&spec.path)
        .with_context(|| format!("Cannot inspect {}", display_path(&spec.path)))?;
    if !metadata.is_file() {
        anyhow::bail!("{} is not a regular file", display_path(&spec.path));
    }
    if metadata.len() > MAX_SOURCE_BYTES {
        anyhow::bail!(
            "{} exceeds the 4 MiB import limit",
            display_path(&spec.path)
        );
    }
    let bytes = fs::read(&spec.path)
        .with_context(|| format!("Cannot read {}", display_path(&spec.path)))?;
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(Some(Vec::new()));
    }
    let root = parse_source(&bytes, spec.format)
        .with_context(|| format!("Cannot parse {}", display_path(&spec.path)))?;
    let Some(servers_value) = root.get(spec.root_key) else {
        return Ok(Some(Vec::new()));
    };
    let Some(servers) = servers_value.as_object() else {
        anyhow::bail!("{} must contain an object", spec.root_key);
    };
    let mut candidates = Vec::with_capacity(servers.len());
    for (name, value) in servers {
        let mut normalized =
            normalize_server(spec.kind, &spec.path, name, value, active_agent_profile_ids);
        normalized.public.candidate_id = candidate_id(&normalized.public)?;
        candidates.push(normalized);
    }
    Ok(Some(candidates))
}

fn parse_source(bytes: &[u8], format: SourceFormat) -> Result<Value> {
    let text = std::str::from_utf8(bytes).context("configuration is not UTF-8")?;
    match format {
        SourceFormat::Jsonc => json5::from_str(text).context("invalid JSON/JSONC"),
        SourceFormat::Toml => {
            let value = toml::from_str::<toml::Value>(text).context("invalid TOML")?;
            serde_json::to_value(value).context("could not normalize TOML")
        }
    }
}

fn normalize_server(
    source_kind: McpImportSourceKind,
    source_path: &Path,
    source_name: &str,
    value: &Value,
    active_agent_profile_ids: &[String],
) -> NormalizedCandidate {
    let proposed_name = normalized_name(source_name);
    let source_enabled = source_enabled(value);
    let mut issues = Vec::new();
    let Some(object) = value.as_object() else {
        issues.push(McpImportIssue::new(
            "mcp.import_invalid_definition",
            "MCP Server definition must be an object",
            None,
            true,
            false,
        ));
        return candidate_without_definition(
            source_kind,
            source_path,
            source_name,
            proposed_name,
            source_enabled,
            issues,
        );
    };
    detect_nonportable_fields(object, &mut issues);
    let transport = object
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| object.get("transport").and_then(Value::as_str))
        .map(|value| value.to_ascii_lowercase());
    if transport.as_deref() == Some("sse") {
        issues.push(McpImportIssue::new(
            "mcp.unsupported_transport",
            "Legacy SSE transport is not supported",
            Some("transport".to_string()),
            true,
            false,
        ));
        return candidate_without_definition(
            source_kind,
            source_path,
            source_name,
            proposed_name,
            source_enabled,
            issues,
        );
    }

    let normalized = if object.contains_key("command")
        || matches!(transport.as_deref(), Some("stdio" | "local"))
    {
        normalize_stdio(
            object,
            source_enabled.unwrap_or(true),
            active_agent_profile_ids,
            &mut issues,
        )
    } else if object.contains_key("url")
        || matches!(
            transport.as_deref(),
            Some("http" | "streamable_http" | "streamable-http" | "remote")
        )
    {
        normalize_http(
            object,
            source_enabled.unwrap_or(true),
            active_agent_profile_ids,
            &mut issues,
        )
    } else {
        issues.push(McpImportIssue::new(
            "mcp.import_transport_unknown",
            "Could not determine whether this Server uses Stdio or Streamable HTTP",
            Some("transport".to_string()),
            true,
            false,
        ));
        None
    };

    let (public_definition, raw_definition) = normalized
        .map(|(public, raw)| (Some(public), Some(raw)))
        .unwrap_or((None, None));
    let compatibility = compatibility(&issues);
    NormalizedCandidate {
        public: McpImportCandidate {
            candidate_id: String::new(),
            source_kind,
            source_path: display_path(source_path),
            source_name: source_name.to_string(),
            proposed_name,
            normalized_definition: public_definition,
            source_enabled,
            compatibility,
            issues,
            conflict: McpImportConflict::None,
        },
        raw_definition,
    }
}

fn normalize_stdio(
    object: &Map<String, Value>,
    source_enabled: bool,
    active_agent_profile_ids: &[String],
    issues: &mut Vec<McpImportIssue>,
) -> Option<(McpServerInput, McpServerDefinition)> {
    let (command, args) = match object.get("command") {
        Some(Value::String(command)) if !command.is_empty() => {
            let args = string_array(object.get("args"), "args", issues)?;
            (command.clone(), args)
        }
        Some(Value::Array(command)) if !command.is_empty() => {
            let command = command
                .iter()
                .map(Value::as_str)
                .collect::<Option<Vec<_>>>();
            let Some(command) = command else {
                issues.push(invalid_field(
                    "command",
                    "Command array must contain only strings",
                ));
                return None;
            };
            (
                command[0].to_string(),
                command[1..]
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect(),
            )
        }
        _ => {
            issues.push(invalid_field("command", "Stdio command is required"));
            return None;
        }
    };
    let cwd = object
        .get("cwd")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    if object.get("cwd").is_some() && cwd.is_none() {
        issues.push(invalid_field("cwd", "Working directory must be a string"));
    }
    let values = object.get("env").or_else(|| object.get("environment"));
    let (public_env, raw_env, missing_values) = redact_imported_map(values, "env", issues);
    let enabled = source_enabled && missing_values.is_empty();
    Some((
        McpServerInput::Stdio {
            enabled,
            agent_profile_ids: active_agent_profile_ids.to_vec(),
            command: command.clone(),
            args: args.clone(),
            cwd: cwd.clone(),
            env: public_env,
            missing_values: missing_values.clone(),
        },
        McpServerDefinition::Stdio {
            enabled: source_enabled,
            agent_profile_ids: active_agent_profile_ids.to_vec(),
            command,
            args,
            cwd,
            env: raw_env,
            missing_values: Vec::new(),
        },
    ))
}

fn normalize_http(
    object: &Map<String, Value>,
    source_enabled: bool,
    active_agent_profile_ids: &[String],
    issues: &mut Vec<McpImportIssue>,
) -> Option<(McpServerInput, McpServerDefinition)> {
    let Some(url) = object.get("url").and_then(Value::as_str) else {
        issues.push(invalid_field("url", "Streamable HTTP URL is required"));
        return None;
    };
    let headers_value = object.get("headers").or_else(|| object.get("http_headers"));
    let (mut public_headers, mut raw_headers, mut missing_values) =
        redact_imported_map(headers_value, "headers", issues);
    if let Some(env_headers) = object.get("env_http_headers") {
        if let Some(env_headers) = env_headers.as_object() {
            for (header, variable) in env_headers {
                let Some(variable) = variable.as_str() else {
                    issues.push(invalid_field(
                        &format!("env_http_headers.{header}"),
                        "Environment-backed header must name an environment variable",
                    ));
                    continue;
                };
                let reference = format!("${{{variable}}}");
                public_headers.insert(
                    header.clone(),
                    McpEditableValue {
                        value: Some(reference.clone()),
                        preserve_stored: false,
                    },
                );
                raw_headers.insert(header.clone(), reference);
            }
        } else {
            issues.push(invalid_field(
                "env_http_headers",
                "Environment-backed headers must be an object",
            ));
        }
    }
    if object.contains_key("bearer_token_env_var") {
        missing_values.push("headers.Authorization".to_string());
        issues.push(McpImportIssue::new(
            "mcp.import_bearer_header_required",
            "Bearer token configuration must be re-entered as an Authorization header",
            Some("headers.Authorization".to_string()),
            false,
            false,
        ));
    }
    missing_values.sort();
    missing_values.dedup();
    let enabled = source_enabled && missing_values.is_empty();
    Some((
        McpServerInput::StreamableHttp {
            enabled,
            agent_profile_ids: active_agent_profile_ids.to_vec(),
            url: url.to_string(),
            headers: public_headers,
            missing_values: missing_values.clone(),
        },
        McpServerDefinition::StreamableHttp {
            enabled: source_enabled,
            agent_profile_ids: active_agent_profile_ids.to_vec(),
            url: url.to_string(),
            headers: raw_headers,
            missing_values: Vec::new(),
        },
    ))
}

fn redact_imported_map(
    value: Option<&Value>,
    field: &str,
    issues: &mut Vec<McpImportIssue>,
) -> (
    BTreeMap<String, McpEditableValue>,
    BTreeMap<String, String>,
    Vec<String>,
) {
    let mut public = BTreeMap::new();
    let mut raw = BTreeMap::new();
    let mut missing = Vec::new();
    let Some(value) = value else {
        return (public, raw, missing);
    };
    let Some(values) = value.as_object() else {
        issues.push(invalid_field(field, "Expected an object of string values"));
        return (public, raw, missing);
    };
    for (key, value) in values {
        let Some(value) = value.as_str() else {
            issues.push(invalid_field(
                &format!("{field}.{key}"),
                "Imported value must be a string",
            ));
            continue;
        };
        raw.insert(key.clone(), value.to_string());
        if is_environment_reference(value) {
            public.insert(
                key.clone(),
                McpEditableValue {
                    value: Some(value.to_string()),
                    preserve_stored: false,
                },
            );
        } else {
            missing.push(format!("{field}.{key}"));
            issues.push(McpImportIssue::new(
                "mcp.redacted_value",
                "Source value was redacted and must be entered again",
                Some(format!("{field}.{key}")),
                false,
                false,
            ));
        }
    }
    (public, raw, missing)
}

fn detect_nonportable_fields(object: &Map<String, Value>, issues: &mut Vec<McpImportIssue>) {
    let filter_fields = [
        "enabled_tools",
        "disabled_tools",
        "enabledTools",
        "disabledTools",
        "includeTools",
        "excludeTools",
        "tools",
        "autoApprove",
        "alwaysAllow",
    ];
    if filter_fields
        .iter()
        .any(|field| object.contains_key(*field))
    {
        issues.push(McpImportIssue::new(
            "mcp.nonportable_tool_filter",
            "Source-specific tool filtering cannot be preserved; explicit all-tools confirmation is required",
            Some("tools".to_string()),
            false,
            true,
        ));
    }
    if object
        .get("oauth")
        .is_some_and(|value| !matches!(value, Value::Bool(false) | Value::Null))
        || object.contains_key("oauthClientInformation")
        || object.contains_key("oauthTokens")
    {
        issues.push(McpImportIssue::new(
            "mcp.unsupported_oauth",
            "OAuth state and credential caches are not imported",
            Some("oauth".to_string()),
            true,
            false,
        ));
    }
    let runtime_options = [
        "startup_timeout_sec",
        "tool_timeout_sec",
        "timeout",
        "required",
        "trust",
    ];
    for field in runtime_options {
        if object.contains_key(field) {
            issues.push(McpImportIssue::new(
                "mcp.runtime_option_ignored",
                format!("Source-specific option {field} is not portable"),
                Some(field.to_string()),
                false,
                false,
            ));
        }
    }
}

fn source_enabled(value: &Value) -> Option<bool> {
    let object = value.as_object()?;
    object.get("enabled").and_then(Value::as_bool).or_else(|| {
        object
            .get("disabled")
            .and_then(Value::as_bool)
            .map(|value| !value)
    })
}

fn string_array(
    value: Option<&Value>,
    field: &str,
    issues: &mut Vec<McpImportIssue>,
) -> Option<Vec<String>> {
    let Some(value) = value else {
        return Some(Vec::new());
    };
    let Some(values) = value.as_array() else {
        issues.push(invalid_field(field, "Expected an array of strings"));
        return None;
    };
    let values = values.iter().map(Value::as_str).collect::<Option<Vec<_>>>();
    let Some(values) = values else {
        issues.push(invalid_field(field, "Expected an array of strings"));
        return None;
    };
    Some(values.into_iter().map(ToOwned::to_owned).collect())
}

fn invalid_field(field: &str, message: &str) -> McpImportIssue {
    McpImportIssue::new(
        "mcp.import_invalid_field",
        message,
        Some(field.to_string()),
        true,
        false,
    )
}

fn compatibility(issues: &[McpImportIssue]) -> McpImportCompatibility {
    if issues.iter().any(|issue| issue.blocking) {
        McpImportCompatibility::Unsupported
    } else if issues.is_empty() {
        McpImportCompatibility::Portable
    } else {
        McpImportCompatibility::NeedsInput
    }
}

fn candidate_without_definition(
    source_kind: McpImportSourceKind,
    source_path: &Path,
    source_name: &str,
    proposed_name: String,
    source_enabled: Option<bool>,
    issues: Vec<McpImportIssue>,
) -> NormalizedCandidate {
    let mut public = McpImportCandidate {
        candidate_id: String::new(),
        source_kind,
        source_path: display_path(source_path),
        source_name: source_name.to_string(),
        proposed_name,
        normalized_definition: None,
        source_enabled,
        compatibility: compatibility(&issues),
        issues,
        conflict: McpImportConflict::None,
    };
    public.candidate_id = candidate_id(&public).unwrap_or_else(|_| {
        format!(
            "sha256:{:x}",
            Sha256::digest(format!("{}:{source_name}", source_kind.as_str()))
        )
    });
    NormalizedCandidate {
        public,
        raw_definition: None,
    }
}

fn candidate_id(candidate: &McpImportCandidate) -> Result<String> {
    let bytes = serde_json::to_vec(&(
        candidate.source_kind,
        &candidate.source_path,
        &candidate.source_name,
        &candidate.normalized_definition,
    ))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn conflict_for(
    candidate: &NormalizedCandidate,
    current: Option<&McpConfigFile>,
) -> McpImportConflict {
    let Some(current) = current else {
        return McpImportConflict::None;
    };
    let Some(imported) = candidate.raw_definition.as_ref() else {
        return McpImportConflict::None;
    };
    if let Some(existing) = current.mcp_servers.get(&candidate.public.proposed_name) {
        return if same_connection(existing, imported) {
            McpImportConflict::Same
        } else {
            McpImportConflict::NameConflict
        };
    }
    if current
        .mcp_servers
        .values()
        .any(|existing| same_connection(existing, imported))
    {
        McpImportConflict::DuplicateDefinition
    } else {
        McpImportConflict::None
    }
}

fn same_connection(left: &McpServerDefinition, right: &McpServerDefinition) -> bool {
    match (left, right) {
        (
            McpServerDefinition::Stdio {
                command: left_command,
                args: left_args,
                cwd: left_cwd,
                env: left_env,
                ..
            },
            McpServerDefinition::Stdio {
                command: right_command,
                args: right_args,
                cwd: right_cwd,
                env: right_env,
                ..
            },
        ) => {
            left_command == right_command
                && left_args == right_args
                && left_cwd == right_cwd
                && left_env == right_env
        }
        (
            McpServerDefinition::StreamableHttp {
                url: left_url,
                headers: left_headers,
                ..
            },
            McpServerDefinition::StreamableHttp {
                url: right_url,
                headers: right_headers,
                ..
            },
        ) => left_url == right_url && left_headers == right_headers,
        _ => false,
    }
}

fn normalized_name(name: &str) -> String {
    let mut normalized = String::with_capacity(name.len());
    for byte in name.bytes() {
        let valid =
            byte.is_ascii_alphanumeric() || (!normalized.is_empty() && matches!(byte, b'_' | b'-'));
        normalized.push(if valid { char::from(byte) } else { '-' });
    }
    let normalized = normalized.trim_matches('-');
    let mut normalized = if normalized.is_empty() {
        "imported-mcp".to_string()
    } else {
        normalized.to_string()
    };
    normalized.truncate(64);
    if normalized == TEAM_MCP_RESERVED_NAME {
        normalized = "rovai-team-imported".to_string();
    }
    normalized
}

fn is_environment_reference(value: &str) -> bool {
    let value = value.trim();
    let Some(variable) = value
        .strip_prefix("${")
        .and_then(|value| value.strip_suffix('}'))
    else {
        return false;
    };
    !variable.is_empty()
        && variable.bytes().enumerate().all(|(index, byte)| {
            byte == b'_' || byte.is_ascii_alphabetic() || (index > 0 && byte.is_ascii_digit())
        })
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn fixture_root() -> PathBuf {
        env::temp_dir().join(format!("rovai-mcp-import-{}", Uuid::new_v4()))
    }

    fn agents() -> (BTreeSet<String>, Vec<String>) {
        (
            ["agent-luoke".to_string(), "agent-muwa".to_string()]
                .into_iter()
                .collect(),
            vec!["agent-luoke".to_string(), "agent-muwa".to_string()],
        )
    }

    fn spec(kind: McpImportSourceKind, path: PathBuf, root_key: &'static str) -> SourceSpec {
        SourceSpec {
            kind,
            path,
            format: SourceFormat::Jsonc,
            root_key,
        }
    }

    #[test]
    fn scans_jsonc_and_redacts_every_literal_source_value() {
        let root = fixture_root();
        fs::create_dir_all(&root).unwrap();
        let source = root.join("opencode.jsonc");
        fs::write(
            &source,
            r#"{
              // OpenCode local transport
              mcp: {
                docs: {
                  type: "local",
                  command: ["npx", "-y", "@example/mcp"],
                  environment: {
                    TOKEN: "do-not-leak",
                    SAFE_REF: "${SAFE_REF}",
                  },
                },
              },
            }"#,
        )
        .unwrap();
        let store = McpConfigStore::new(root.join(".rovai/mcp.json"));
        let (known, active) = agents();
        let inspection = McpImportScanner
            .scan_specs(
                &store,
                &known,
                &active,
                vec![spec(McpImportSourceKind::Opencode, source, "mcp")],
            )
            .unwrap();
        assert_eq!(inspection.candidates.len(), 1);
        let candidate = &inspection.candidates[0];
        assert_eq!(candidate.compatibility, McpImportCompatibility::NeedsInput);
        let serialized = serde_json::to_string(candidate).unwrap();
        assert!(!serialized.contains("do-not-leak"));
        assert!(serialized.contains("${SAFE_REF}"));
        assert!(serialized.contains("env.TOKEN"));
        let Some(McpServerInput::Stdio {
            enabled,
            missing_values,
            ..
        }) = candidate.normalized_definition.as_ref()
        else {
            panic!("expected stdio candidate");
        };
        assert!(!enabled);
        assert_eq!(missing_values, &["env.TOKEN"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn one_invalid_source_does_not_hide_valid_or_missing_sources() {
        let root = fixture_root();
        fs::create_dir_all(&root).unwrap();
        let invalid = root.join("bad.json");
        let valid = root.join("cursor.json");
        fs::write(&invalid, "{broken").unwrap();
        fs::write(
            &valid,
            r#"{"mcpServers":{"remote":{"type":"http","url":"https://example.com/mcp"}}}"#,
        )
        .unwrap();
        let store = McpConfigStore::new(root.join(".rovai/mcp.json"));
        let (known, active) = agents();
        let inspection = McpImportScanner
            .scan_specs(
                &store,
                &known,
                &active,
                vec![
                    spec(McpImportSourceKind::ClaudeCode, invalid, "mcpServers"),
                    spec(McpImportSourceKind::Cursor, valid, "mcpServers"),
                    spec(
                        McpImportSourceKind::Copilot,
                        root.join("missing.json"),
                        "mcpServers",
                    ),
                ],
            )
            .unwrap();
        assert_eq!(inspection.candidates.len(), 1);
        assert_eq!(inspection.sources[0].status, McpImportSourceStatus::Invalid);
        assert_eq!(inspection.sources[1].status, McpImportSourceStatus::Loaded);
        assert_eq!(inspection.sources[2].status, McpImportSourceStatus::Missing);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn flags_sse_oauth_and_tool_filters_without_silent_downgrade() {
        let root = fixture_root();
        fs::create_dir_all(&root).unwrap();
        let source = root.join("cursor.json");
        fs::write(
            &source,
            r#"{"mcpServers":{
              "legacy":{"type":"sse","url":"https://example.com/sse"},
              "oauth":{"type":"http","url":"https://example.com/mcp","oauth":true},
              "filtered":{"command":"node","args":["server.js"],"disabledTools":["write"]}
            }}"#,
        )
        .unwrap();
        let store = McpConfigStore::new(root.join(".rovai/mcp.json"));
        let (known, active) = agents();
        let inspection = McpImportScanner
            .scan_specs(
                &store,
                &known,
                &active,
                vec![spec(McpImportSourceKind::Cursor, source, "mcpServers")],
            )
            .unwrap();
        assert_eq!(inspection.candidates.len(), 3);
        assert_eq!(
            inspection
                .candidates
                .iter()
                .find(|candidate| candidate.source_name == "legacy")
                .unwrap()
                .compatibility,
            McpImportCompatibility::Unsupported
        );
        assert_eq!(
            inspection
                .candidates
                .iter()
                .find(|candidate| candidate.source_name == "oauth")
                .unwrap()
                .compatibility,
            McpImportCompatibility::Unsupported
        );
        let filtered = inspection
            .candidates
            .iter()
            .find(|candidate| candidate.source_name == "filtered")
            .unwrap();
        assert!(filtered.issues.iter().any(|issue| {
            issue.code == "mcp.nonportable_tool_filter" && issue.requires_confirmation
        }));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn parses_codex_toml_and_detects_same_connection_without_exposing_secret() {
        let root = fixture_root();
        fs::create_dir_all(&root).unwrap();
        let source = root.join("config.toml");
        fs::write(
            &source,
            r#"
              [mcp_servers.docs]
              command = "npx"
              args = ["-y", "@example/mcp"]
              env = { TOKEN = "secret" }
            "#,
        )
        .unwrap();
        let store = McpConfigStore::new(root.join(".rovai/mcp.json"));
        let (known, active) = agents();
        let initial = store.get(&known).unwrap();
        let created = store
            .create(
                crate::mcp::CreateMcpServerParams {
                    expected_config_digest: initial.config_digest,
                    name: "docs".to_string(),
                    definition: McpServerInput::Stdio {
                        enabled: true,
                        agent_profile_ids: active.clone(),
                        command: "npx".to_string(),
                        args: vec!["-y".to_string(), "@example/mcp".to_string()],
                        cwd: None,
                        env: BTreeMap::from([(
                            "TOKEN".to_string(),
                            McpEditableValue {
                                value: Some("secret".to_string()),
                                preserve_stored: false,
                            },
                        )]),
                        missing_values: Vec::new(),
                    },
                },
                &known,
            )
            .unwrap();
        assert!(matches!(created, crate::mcp::McpMutationResult::Ok { .. }));
        let inspection = McpImportScanner
            .scan_specs(
                &store,
                &known,
                &active,
                vec![SourceSpec {
                    kind: McpImportSourceKind::Codex,
                    path: source,
                    format: SourceFormat::Toml,
                    root_key: "mcp_servers",
                }],
            )
            .unwrap();
        assert_eq!(inspection.candidates[0].conflict, McpImportConflict::Same);
        assert!(
            !serde_json::to_string(&inspection)
                .unwrap()
                .contains("secret")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scans_claude_copilot_and_antigravity_user_shapes() {
        let root = fixture_root();
        fs::create_dir_all(&root).unwrap();
        let claude = root.join("claude.json");
        let copilot = root.join("copilot.json");
        let antigravity = root.join("antigravity.json");
        for (source, command) in [
            (&claude, "claude-server"),
            (&copilot, "copilot-server"),
            (&antigravity, "antigravity-server"),
        ] {
            fs::write(
                source,
                format!(r#"{{"mcpServers":{{"docs":{{"command":"{command}","args":[]}}}}}}"#),
            )
            .unwrap();
        }
        let store = McpConfigStore::new(root.join(".rovai/mcp.json"));
        let (known, active) = agents();
        let inspection = McpImportScanner
            .scan_specs(
                &store,
                &known,
                &active,
                vec![
                    spec(McpImportSourceKind::ClaudeCode, claude, "mcpServers"),
                    spec(McpImportSourceKind::Copilot, copilot, "mcpServers"),
                    spec(McpImportSourceKind::Antigravity, antigravity, "mcpServers"),
                ],
            )
            .unwrap();
        assert_eq!(inspection.candidates.len(), 3);
        assert!(
            inspection
                .candidates
                .iter()
                .all(|candidate| { candidate.compatibility == McpImportCompatibility::Portable })
        );
        assert!(
            inspection
                .candidates
                .iter()
                .all(|candidate| { candidate.conflict == McpImportConflict::None })
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn empty_source_is_loaded_without_a_parse_error() {
        let root = fixture_root();
        fs::create_dir_all(&root).unwrap();
        let source = root.join("empty.json");
        fs::write(&source, " \n").unwrap();
        let store = McpConfigStore::new(root.join(".rovai/mcp.json"));
        let (known, active) = agents();
        let inspection = McpImportScanner
            .scan_specs(
                &store,
                &known,
                &active,
                vec![spec(McpImportSourceKind::Antigravity, source, "mcpServers")],
            )
            .unwrap();
        assert_eq!(inspection.sources[0].status, McpImportSourceStatus::Loaded);
        assert!(inspection.candidates.is_empty());
        let _ = fs::remove_dir_all(root);
    }
}
