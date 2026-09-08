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
    CommitMcpImportParams, McpConfigFile, McpConfigIssue, McpConfigStore, McpMutationResult,
    McpServerDefinition, READ_ONLY_MASK, parse_single_public_entry, single_public_json,
    valid_environment_name,
};

const MAX_SOURCE_BYTES: u64 = 4 * 1024 * 1024;
const HIDDEN_SOURCE_VALUE: &str = READ_ONLY_MASK;

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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpImportIssueKind {
    Normalized,
    Dropped,
    NeedsConfiguration,
    Blocker,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpImportIssue {
    pub code: String,
    pub message: String,
    pub field: Option<String>,
    pub kind: McpImportIssueKind,
    pub blocking: bool,
}

impl McpImportIssue {
    fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        field: Option<String>,
        kind: McpImportIssueKind,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            field,
            blocking: kind == McpImportIssueKind::Blocker,
            kind,
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
    pub source_definition_json: String,
    pub normalized_definition_json: Option<String>,
    pub source_enabled: Option<bool>,
    pub compatibility: McpImportCompatibility,
    pub issues: Vec<McpImportIssue>,
    pub conflict: McpImportConflict,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duplicate_of_candidate_id: Option<String>,
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
    definition: Option<McpServerDefinition>,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct McpImportScanner;

impl McpImportScanner {
    pub fn scan(
        &self,
        store: &McpConfigStore,
        known_agent_ids: &BTreeSet<String>,
    ) -> Result<McpImportInspection> {
        self.scan_specs(store, known_agent_ids, source_specs()?)
    }

    /// Re-read only recognized local sources. Credentials never need to round-trip through IPC.
    pub fn commit(
        &self,
        store: &McpConfigStore,
        params: CommitMcpImportParams,
        known_agent_ids: &BTreeSet<String>,
    ) -> Result<McpMutationResult> {
        self.commit_specs(store, params, known_agent_ids, source_specs()?)
    }

    fn commit_specs(
        &self,
        store: &McpConfigStore,
        mut params: CommitMcpImportParams,
        known_agent_ids: &BTreeSet<String>,
        specs: Vec<SourceSpec>,
    ) -> Result<McpMutationResult> {
        let candidates = specs
            .iter()
            .filter_map(|spec| scan_source(spec).ok().flatten())
            .flatten()
            .collect::<Vec<_>>();
        for selection in &mut params.selections {
            let Some(candidate) = candidates
                .iter()
                .find(|candidate| candidate.public.candidate_id == selection.candidate_id)
            else {
                return Ok(McpMutationResult::Invalid {
                    issues: vec![McpConfigIssue::new(
                        "mcp.import_source_changed",
                        "来源配置已变化或不可读取，请重新扫描后导入。",
                        Some("candidateId".to_string()),
                    )],
                });
            };
            if candidate.public.issues.iter().any(|issue| issue.blocking) {
                return Ok(McpMutationResult::Invalid {
                    issues: vec![McpConfigIssue::new(
                        "mcp.import_candidate_unsupported",
                        "来源配置包含无法兼容的字段，请先处理具体缺项。",
                        Some("candidateId".to_string()),
                    )],
                });
            }
            let (name, definition) = match parse_single_public_entry(
                &selection.definition_json,
                candidate.definition.as_ref(),
                &params.expected_config_digest,
            ) {
                Ok(parsed) => parsed,
                Err(issues) => return Ok(McpMutationResult::Invalid { issues }),
            };
            selection.definition_json = single_public_json(&name, &definition, false)?;
            selection.has_blocking_issues = false;
        }
        store.commit_import(params, known_agent_ids)
    }

    fn scan_specs(
        &self,
        store: &McpConfigStore,
        known_agent_ids: &BTreeSet<String>,
        specs: Vec<SourceSpec>,
    ) -> Result<McpImportInspection> {
        let (config_view, current_config) = store.get_with_raw(known_agent_ids)?;
        let mut sources = Vec::with_capacity(specs.len());
        let mut normalized_candidates = Vec::new();
        for spec in specs {
            match scan_source(&spec) {
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
                        McpImportIssueKind::Blocker,
                    )),
                }),
            }
        }
        for index in 0..normalized_candidates.len() {
            // Link identical named entries using private definitions, never masked previews.
            let same_named = (0..index).find(|&other| {
                normalized_candidates[index].public.proposed_name
                    == normalized_candidates[other].public.proposed_name
                    && normalized_candidates[index].definition.is_some()
                    && normalized_candidates[index].definition
                        == normalized_candidates[other].definition
            });
            if let Some(other) = same_named {
                normalized_candidates[index]
                    .public
                    .duplicate_of_candidate_id =
                    Some(normalized_candidates[other].public.candidate_id.clone());
            }
            if normalized_candidates[index].public.conflict != McpImportConflict::None {
                continue;
            }
            let duplicate = (0..index).any(|other| {
                match (
                    normalized_candidates[index].definition.as_ref(),
                    normalized_candidates[other].definition.as_ref(),
                ) {
                    (Some(candidate), Some(existing)) => candidate == existing,
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

fn scan_source(spec: &SourceSpec) -> Result<Option<Vec<NormalizedCandidate>>> {
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
        let mut normalized = normalize_server(spec.kind, &spec.path, name, value);
        normalized.public.candidate_id = candidate_id(&normalized.public, value)?;
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
) -> NormalizedCandidate {
    let proposed_name = normalized_name(source_name);
    let source_enabled = source_enabled(value);
    let source_definition_json = masked_source_json(source_name, value);
    let mut issues = Vec::new();
    let Some(object) = value.as_object() else {
        issues.push(blocker(
            "mcp.import_invalid_definition",
            "MCP Server definition must be an object",
            None,
        ));
        return candidate_without_definition(
            source_kind,
            source_path,
            source_name,
            proposed_name,
            source_definition_json,
            source_enabled,
            issues,
        );
    };

    detect_fields(object, &mut issues);
    if object.contains_key("enabled") || object.contains_key("disabled") {
        issues.push(McpImportIssue::new(
            "mcp.import_enabled_reset",
            "Source enablement is not inherited; the imported Server will be disabled",
            Some("enabled".to_string()),
            McpImportIssueKind::Dropped,
        ));
    }
    let transport = object
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| object.get("transport").and_then(Value::as_str))
        .map(|value| value.to_ascii_lowercase());
    if object.contains_key("type") || object.contains_key("transport") {
        issues.push(McpImportIssue::new(
            "mcp.import_transport_normalized",
            "Source transport marker is normalized to command-or-url standard JSON",
            Some("type".to_string()),
            McpImportIssueKind::Normalized,
        ));
    }
    if transport.as_deref() == Some("sse") {
        issues.push(blocker(
            "mcp.unsupported_transport",
            "Legacy SSE transport is not supported",
            Some("transport".to_string()),
        ));
    }

    let definition = if issues.iter().any(|issue| issue.blocking) {
        None
    } else if object.contains_key("command")
        || matches!(transport.as_deref(), Some("stdio" | "local"))
    {
        normalize_stdio(source_kind, object, &mut issues)
    } else if object.contains_key("url")
        || matches!(
            transport.as_deref(),
            Some("http" | "streamable_http" | "streamable-http" | "remote")
        )
    {
        normalize_http(source_kind, object, &mut issues)
    } else {
        issues.push(blocker(
            "mcp.import_transport_unknown",
            "Could not determine whether this Server uses Stdio or Streamable HTTP",
            Some("transport".to_string()),
        ));
        None
    };

    if let Some(definition) = &definition {
        issues.extend(
            crate::mcp_projection::environment_issues(definition)
                .into_iter()
                .map(|issue| {
                    McpImportIssue::new(
                        issue.code,
                        issue.message,
                        issue.field,
                        McpImportIssueKind::NeedsConfiguration,
                    )
                }),
        );
    }

    let normalized_definition_json = definition
        .as_ref()
        .and_then(|definition| public_entry_json(&proposed_name, definition).ok());
    let compatibility = compatibility(&issues);
    NormalizedCandidate {
        public: McpImportCandidate {
            candidate_id: String::new(),
            source_kind,
            source_path: display_path(source_path),
            source_name: source_name.to_string(),
            proposed_name,
            source_definition_json,
            normalized_definition_json,
            source_enabled,
            compatibility,
            issues,
            conflict: McpImportConflict::None,
            duplicate_of_candidate_id: None,
        },
        definition,
    }
}

fn normalize_stdio(
    source_kind: McpImportSourceKind,
    object: &Map<String, Value>,
    issues: &mut Vec<McpImportIssue>,
) -> Option<McpServerDefinition> {
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
            issues.push(McpImportIssue::new(
                "mcp.import_command_array_normalized",
                "Command array was split into command and args",
                Some("command".to_string()),
                McpImportIssueKind::Normalized,
            ));
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
    if object.contains_key("environment") {
        issues.push(McpImportIssue::new(
            "mcp.import_environment_normalized",
            "Source environment was normalized to env",
            Some("environment".to_string()),
            McpImportIssueKind::Normalized,
        ));
    }
    let env = normalize_value_map(source_kind, values, "env", issues);
    Some(McpServerDefinition::Stdio {
        command,
        args,
        cwd,
        env,
    })
}

fn normalize_http(
    source_kind: McpImportSourceKind,
    object: &Map<String, Value>,
    issues: &mut Vec<McpImportIssue>,
) -> Option<McpServerDefinition> {
    let Some(url) = object.get("url").and_then(Value::as_str) else {
        issues.push(invalid_field("url", "Streamable HTTP URL is required"));
        return None;
    };
    let headers_value = object.get("headers").or_else(|| object.get("http_headers"));
    if object.contains_key("http_headers") {
        issues.push(McpImportIssue::new(
            "mcp.import_headers_normalized",
            "Source http_headers was normalized to headers",
            Some("http_headers".to_string()),
            McpImportIssueKind::Normalized,
        ));
    }
    let mut headers = normalize_value_map(source_kind, headers_value, "headers", issues);
    if let Some(env_headers) = object.get("env_http_headers") {
        let Some(env_headers) = env_headers.as_object() else {
            issues.push(invalid_field(
                "env_http_headers",
                "Environment-backed headers must be an object",
            ));
            return None;
        };
        for (header, variable) in env_headers {
            let Some(variable) = variable
                .as_str()
                .filter(|name| valid_environment_name(name))
            else {
                issues.push(invalid_field(
                    &format!("env_http_headers.{header}"),
                    "Environment-backed header must name an environment variable",
                ));
                continue;
            };
            headers.insert(header.clone(), format!("${{{variable}}}"));
        }
        issues.push(McpImportIssue::new(
            "mcp.import_env_headers_normalized",
            "Environment-backed headers were normalized to strict references",
            Some("env_http_headers".to_string()),
            McpImportIssueKind::Normalized,
        ));
    }
    Some(McpServerDefinition::StreamableHttp {
        url: url.to_string(),
        headers,
    })
}

fn normalize_value_map(
    source_kind: McpImportSourceKind,
    value: Option<&Value>,
    field: &str,
    issues: &mut Vec<McpImportIssue>,
) -> BTreeMap<String, String> {
    let Some(value) = value else {
        return BTreeMap::new();
    };
    let Some(values) = value.as_object() else {
        issues.push(invalid_field(field, "Expected an object of string values"));
        return BTreeMap::new();
    };
    let mut normalized = BTreeMap::new();
    for (key, value) in values {
        let field = format!("{field}.{key}");
        let Some(value) = value.as_str() else {
            issues.push(invalid_field(&field, "Imported value must be a string"));
            continue;
        };
        match normalize_reference_syntax(source_kind, value) {
            Some(value) => {
                normalized.insert(key.clone(), value);
            }
            None => issues.push(blocker(
                "mcp.import_reference_unsupported",
                "待配置：此字段使用了无法无损迁移的来源引用语法。",
                Some(field),
            )),
        }
    }
    normalized
}

/// Translate only syntax defined by the source; preserve literal whitespace and dollar signs.
fn normalize_reference_syntax(source: McpImportSourceKind, value: &str) -> Option<String> {
    use McpImportSourceKind::*;
    let mut result = String::with_capacity(value.len());
    let mut rest = value;
    while !rest.is_empty() {
        let prefix = match source {
            Opencode if rest.starts_with("{env:") => Some("{env:"),
            Cursor if rest.starts_with("${env:") => Some("${env:"),
            ClaudeCode | Copilot if rest.starts_with("${") => Some("${"),
            _ => None,
        };
        if let Some(prefix) = prefix {
            let tail = &rest[prefix.len()..];
            let end = tail.find('}')?;
            let name = &tail[..end];
            if !valid_environment_name(name) {
                return None;
            }
            result.push_str(&format!("${{{name}}}"));
            rest = &tail[end + 1..];
            continue;
        }
        if source == Opencode && rest.starts_with("{file:") {
            return None;
        }
        if rest.starts_with("${") {
            match source {
                // These maps contain literal strings, not Rovai references.
                Codex | Opencode => {
                    let end = rest.find('}')?;
                    result.push('$');
                    result.push_str(&rest[..=end]);
                    rest = &rest[end + 1..];
                    continue;
                }
                // Other source placeholders are not silently passed to Rovai's resolver.
                _ => return None,
            }
        }
        // A source dollar before a reference must not become Rovai's escape operator.
        if rest.starts_with("$${") && matches!(source, ClaudeCode | Copilot | Cursor) {
            return None;
        }
        let character = rest.chars().next()?;
        result.push(character);
        rest = &rest[character.len_utf8()..];
    }
    Some(result)
}

fn detect_fields(object: &Map<String, Value>, issues: &mut Vec<McpImportIssue>) {
    const STRUCTURAL: &[&str] = &[
        "type",
        "transport",
        "command",
        "args",
        "cwd",
        "env",
        "environment",
        "url",
        "headers",
        "http_headers",
        "env_http_headers",
        "enabled",
        "disabled",
    ];
    const DROPPABLE: &[&str] = &[
        "startup_timeout_sec",
        "startupTimeout",
        "tool_timeout_sec",
        "toolTimeout",
        "timeout",
        "timeout_ms",
        "timeoutMs",
        "required",
    ];
    const TOOL_POLICY: &[&str] = &[
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
    const AUTHORITY: &[&str] = &[
        "trust",
        "sandbox",
        "sandboxMode",
        "approval",
        "approvalMode",
        "permissionMode",
        "requireApproval",
        "oauth",
        "oauthClientInformation",
        "oauthTokens",
        "credentialCache",
        "credentials",
    ];
    for field in object.keys() {
        if STRUCTURAL.contains(&field.as_str()) {
            continue;
        }
        if DROPPABLE.contains(&field.as_str()) {
            issues.push(McpImportIssue::new(
                "mcp.import_runtime_option_dropped",
                format!("Known source runtime option {field} will be dropped"),
                Some(field.clone()),
                McpImportIssueKind::Dropped,
            ));
        } else if TOOL_POLICY.contains(&field.as_str()) {
            issues.push(blocker(
                "mcp.import_tool_policy_unsupported",
                format!("Tool policy field {field} cannot be migrated equivalently"),
                Some(field.clone()),
            ));
        } else if AUTHORITY.contains(&field.as_str()) {
            issues.push(blocker(
                "mcp.import_authority_semantics_unsupported",
                format!("Authority or credential field {field} cannot be migrated equivalently"),
                Some(field.clone()),
            ));
        } else {
            issues.push(blocker(
                "mcp.import_unknown_field",
                format!("Unrecognized field {field} blocks automatic import"),
                Some(field.clone()),
            ));
        }
    }
}

fn masked_source_json(source_name: &str, value: &Value) -> String {
    let masked = match value.as_object() {
        Some(object) => {
            let mut masked = object.clone();
            for field in ["env", "environment", "headers", "http_headers"] {
                if let Some(values) = masked.get_mut(field).and_then(Value::as_object_mut) {
                    for value in values.values_mut() {
                        *value = Value::String(HIDDEN_SOURCE_VALUE.to_string());
                    }
                }
            }
            for field in [
                "oauth",
                "oauthClientInformation",
                "oauthTokens",
                "credentialCache",
                "credentials",
            ] {
                if masked.contains_key(field) {
                    masked.insert(
                        field.to_string(),
                        Value::String(HIDDEN_SOURCE_VALUE.to_string()),
                    );
                }
            }
            Value::Object(masked)
        }
        None => Value::String("<无效定义>".to_string()),
    };
    serde_json::to_string_pretty(&serde_json::json!({
        "mcpServers": {source_name: masked}
    }))
    .unwrap_or_default()
}

fn public_entry_json(name: &str, definition: &McpServerDefinition) -> Result<String> {
    single_public_json(name, definition, true)
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
    blocker("mcp.import_invalid_field", message, Some(field.to_string()))
}

fn blocker(code: &str, message: impl Into<String>, field: Option<String>) -> McpImportIssue {
    McpImportIssue::new(code, message, field, McpImportIssueKind::Blocker)
}

fn compatibility(issues: &[McpImportIssue]) -> McpImportCompatibility {
    if issues.iter().any(|issue| issue.blocking) {
        McpImportCompatibility::Unsupported
    } else if issues
        .iter()
        .any(|issue| issue.kind == McpImportIssueKind::NeedsConfiguration)
    {
        McpImportCompatibility::NeedsInput
    } else {
        McpImportCompatibility::Portable
    }
}

#[allow(clippy::too_many_arguments)]
fn candidate_without_definition(
    source_kind: McpImportSourceKind,
    source_path: &Path,
    source_name: &str,
    proposed_name: String,
    source_definition_json: String,
    source_enabled: Option<bool>,
    issues: Vec<McpImportIssue>,
) -> NormalizedCandidate {
    let public = McpImportCandidate {
        candidate_id: String::new(),
        source_kind,
        source_path: display_path(source_path),
        source_name: source_name.to_string(),
        proposed_name,
        source_definition_json,
        normalized_definition_json: None,
        source_enabled,
        compatibility: compatibility(&issues),
        issues,
        conflict: McpImportConflict::None,
        duplicate_of_candidate_id: None,
    };
    NormalizedCandidate {
        public,
        definition: None,
    }
}

fn candidate_id(candidate: &McpImportCandidate, source: &Value) -> Result<String> {
    let bytes = serde_json::to_vec(&(
        candidate.source_kind,
        &candidate.source_path,
        &candidate.source_name,
        source,
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
    let Some(imported) = candidate.definition.as_ref() else {
        return McpImportConflict::None;
    };
    if let Some((_, existing)) = current
        .mcp_servers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(&candidate.public.proposed_name))
    {
        return if existing == imported {
            McpImportConflict::Same
        } else {
            McpImportConflict::NameConflict
        };
    }
    if current
        .mcp_servers
        .values()
        .any(|existing| existing == imported)
    {
        McpImportConflict::DuplicateDefinition
    } else {
        McpImportConflict::None
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
    normalized
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

    fn agents() -> BTreeSet<String> {
        ["agent_1".to_string(), "agent_2".to_string()]
            .into_iter()
            .collect()
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
    fn preserves_import_values_without_disclosing_credentials_or_inheriting_enablement() {
        let root = fixture_root();
        fs::create_dir_all(&root).unwrap();
        let source = root.join("opencode.jsonc");
        fs::write(
            &source,
            r#"{
              mcp: {
                docs: {
                  type: "local",
                  command: ["npx", "-y", "@example/mcp"],
                  environment: { TOKEN: "do-not-leak", SAFE_REF: "{env:ROVAI_MCP_IMPORT_TEST_MISSING}", REGION: "cn", EMPTY: "", PADDED: "  info  " },
                  enabled: true
                }
              }
            }"#,
        )
        .unwrap();
        let store = McpConfigStore::new(root.join(".rovai/mcp.json"));
        let inspection = McpImportScanner
            .scan_specs(
                &store,
                &agents(),
                vec![spec(McpImportSourceKind::Opencode, source, "mcp")],
            )
            .unwrap();
        let candidate = &inspection.candidates[0];
        assert_eq!(candidate.compatibility, McpImportCompatibility::NeedsInput);
        let serialized = serde_json::to_string(candidate).unwrap();
        assert!(!serialized.contains("do-not-leak"));
        let public: Value =
            serde_json::from_str(candidate.normalized_definition_json.as_ref().unwrap()).unwrap();
        assert_eq!(public["mcpServers"]["docs"]["env"]["REGION"], "cn");
        assert_eq!(public["mcpServers"]["docs"]["env"]["EMPTY"], "");
        assert_eq!(public["mcpServers"]["docs"]["env"]["PADDED"], "  info  ");
        assert!(!serialized.contains("MCP_DOCS_TOKEN"));
        assert!(serialized.contains("${ROVAI_MCP_IMPORT_TEST_MISSING}"));
        assert!(
            candidate
                .issues
                .iter()
                .any(|issue| issue.code == "mcp.import_enabled_reset")
        );
        let original = root.join("opencode.jsonc");
        let identical = root.join("second.jsonc");
        fs::copy(&original, &identical).unwrap();
        let different = root.join("different.jsonc");
        fs::write(
            &different,
            fs::read_to_string(&original)
                .unwrap()
                .replace("do-not-leak", "different-secret"),
        )
        .unwrap();
        let grouped = McpImportScanner
            .scan_specs(
                &store,
                &agents(),
                vec![
                    spec(McpImportSourceKind::Opencode, original, "mcp"),
                    spec(McpImportSourceKind::Opencode, identical, "mcp"),
                    spec(McpImportSourceKind::Opencode, different, "mcp"),
                ],
            )
            .unwrap();
        assert_eq!(
            grouped
                .candidates
                .iter()
                .filter(|c| c.duplicate_of_candidate_id.is_some())
                .count(),
            1
        );
        let public = serde_json::to_string(&grouped).unwrap();
        assert!(!public.contains("do-not-leak") && !public.contains("different-secret"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn source_reference_syntax_is_preserved_or_explicitly_rejected() {
        use McpImportSourceKind::*;
        for source in [ClaudeCode, Copilot] {
            assert_eq!(
                normalize_reference_syntax(source, "Bearer ${DOCS_TOKEN}"),
                Some("Bearer ${DOCS_TOKEN}".into())
            );
            assert!(normalize_reference_syntax(source, "${DOCS_TOKEN:-fallback}").is_none());
        }
        for (source, original) in [
            (Cursor, "Bearer ${env:DOCS_TOKEN}"),
            (Opencode, "Bearer {env:DOCS_TOKEN}"),
        ] {
            assert_eq!(
                normalize_reference_syntax(source, original),
                Some("Bearer ${DOCS_TOKEN}".into())
            );
        }
        assert_eq!(
            normalize_reference_syntax(Codex, "  ${LITERAL}  "),
            Some("  $${LITERAL}  ".into())
        );
        assert_eq!(
            normalize_reference_syntax(Opencode, "${LITERAL}"),
            Some("$${LITERAL}".into())
        );
        assert!(normalize_reference_syntax(Cursor, "${workspaceFolder}/config").is_none());
        assert!(normalize_reference_syntax(Opencode, "{file:token.txt}").is_none());
        assert!(normalize_reference_syntax(ClaudeCode, "${BROKEN").is_none());
        assert!(normalize_reference_syntax(ClaudeCode, "$${ESCAPE}").is_none());
    }

    // Security owner: source re-read -> masked edit -> atomic replacement -> runtime projection.
    // Unlike normalization tests, this crosses the private value/IPC boundary and executes inert receivers.
    #[cfg(unix)]
    #[tokio::test]
    async fn import_commit_rehydrates_credentials_and_fences_replacement_before_startup() {
        use crate::{
            agent_profile::AdapterKind,
            db::Database,
            mcp::{
                McpImportAction, McpImportSelection, SetMcpAssignmentParams,
                SetMcpServerEnabledParams, UpdateMcpServerParams,
            },
            mcp_projection::{McpProjectionRequest, McpProjectionService},
        };
        use std::{
            io::{Read, Write},
            net::TcpListener,
            os::unix::fs::PermissionsExt,
            process::Command,
            time::Duration,
        };
        let root = fixture_root();
        fs::create_dir_all(&root).unwrap();
        let source = root.join("claude.json");
        let store = McpConfigStore::new(root.join("private/mcp.json"));
        let token = format!("test-token-{}", Uuid::new_v4());
        let auth = format!("Bearer test-header-{}", Uuid::new_v4());
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let source_json = serde_json::json!({"mcpServers": {
            "docs": {"command": "/bin/sh", "args": ["-c", "test \"$API_TOKEN\" = \"$EXPECTED_TOKEN\" && test \"$PADDED\" = '  info  ' && test \"${EMPTY+x}\" = x && test -z \"$EMPTY\""],
                "env": {"API_TOKEN": token, "EMPTY": "", "PADDED": "  info  ", "REGION": "cn"}},
            "remote": {"url": url, "headers": {"Authorization": auth, "X-Empty": ""}},
            "missing": {"command": "/bin/sh", "env": {"API_TOKEN": "${ROVAI_MCP_IMPORT_TEST_MISSING}"}},
            "incompatible": {"command": "/bin/sh", "env": {"API_TOKEN": "${TOKEN:-fallback}"}}
        }});
        fs::write(&source, serde_json::to_vec(&source_json).unwrap()).unwrap();
        let specs = || {
            vec![spec(
                McpImportSourceKind::ClaudeCode,
                source.clone(),
                "mcpServers",
            )]
        };
        let scan = || {
            McpImportScanner
                .scan_specs(&store, &agents(), specs())
                .unwrap()
        };
        let inspection = scan();
        let selections = inspection
            .candidates
            .iter()
            .filter(|candidate| candidate.compatibility != McpImportCompatibility::Unsupported)
            .map(|candidate| McpImportSelection {
                candidate_id: candidate.candidate_id.clone(),
                action: McpImportAction::Create,
                replace_server_id: None,
                definition_json: candidate.normalized_definition_json.clone().unwrap(),
                has_blocking_issues: false,
            })
            .collect();
        let result = McpImportScanner
            .commit_specs(
                &store,
                CommitMcpImportParams {
                    expected_config_digest: inspection.config_digest,
                    selections,
                },
                &agents(),
                specs(),
            )
            .unwrap();
        let public = serde_json::to_string(&result).unwrap();
        assert!(
            !public.contains(&token) && !public.contains(&auth),
            "public import result must not contain credentials"
        );
        let McpMutationResult::Ok { config, .. } = result else {
            panic!("valid candidates should import together");
        };
        assert!(
            config
                .servers
                .iter()
                .all(|server| !server.enabled && server.assigned_agent_ids.is_empty())
        );
        let missing = config
            .servers
            .iter()
            .find(|server| server.name == "missing")
            .unwrap();
        assert_eq!(
            missing.configuration_issues[0].field.as_deref(),
            Some("env.API_TOKEN")
        );
        assert!(
            missing.configuration_issues[0]
                .message
                .contains("ROVAI_MCP_IMPORT_TEST_MISSING")
        );
        assert!(
            config
                .servers
                .iter()
                .filter(|server| server.name != "missing")
                .all(|server| server.configuration_issues.is_empty())
        );
        assert_eq!(
            fs::metadata(store.path()).unwrap().permissions().mode() & 0o777,
            0o600
        );

        let mut config = *config;
        for name in ["docs", "remote"] {
            let server_id = config
                .servers
                .iter()
                .find(|server| server.name == name)
                .unwrap()
                .server_id
                .clone();
            for result in [store
                .set_assignment(
                    SetMcpAssignmentParams {
                        expected_config_digest: config.config_digest.clone(),
                        server_id: server_id.clone(),
                        agent_id: "agent_1".into(),
                        assigned: true,
                        acknowledge_high_risk: false,
                    },
                    &agents(),
                )
                .unwrap()]
            {
                let McpMutationResult::Ok {
                    config: updated, ..
                } = result
                else {
                    panic!("assignment failed");
                };
                config = *updated;
            }
            let result = store
                .set_enabled(
                    SetMcpServerEnabledParams {
                        expected_config_digest: config.config_digest.clone(),
                        server_id,
                        enabled: true,
                        acknowledge_high_risk: false,
                    },
                    &agents(),
                )
                .unwrap();
            let McpMutationResult::Ok {
                config: updated, ..
            } = result
            else {
                panic!("enablement failed");
            };
            config = *updated;
        }
        let server_id = config
            .servers
            .iter()
            .find(|server| server.name == "docs")
            .unwrap()
            .server_id
            .clone();
        let legacy = serde_json::json!({"mcpServers": {"docs": {"command": "/bin/sh", "env": {"API_TOKEN": "${MCP_DOCS_API_TOKEN}"}}}});
        assert!(matches!(
            store
                .update(
                    UpdateMcpServerParams {
                        expected_config_digest: config.config_digest,
                        server_id: server_id.clone(),
                        definition_json: legacy.to_string()
                    },
                    &agents()
                )
                .unwrap(),
            McpMutationResult::Ok { .. }
        ));
        let inspection = scan();
        let candidate = inspection
            .candidates
            .iter()
            .find(|candidate| candidate.source_name == "docs")
            .unwrap();
        let params = CommitMcpImportParams {
            expected_config_digest: inspection.config_digest,
            selections: vec![McpImportSelection {
                candidate_id: candidate.candidate_id.clone(),
                action: McpImportAction::Replace,
                replace_server_id: Some(server_id.clone()),
                definition_json: candidate.normalized_definition_json.clone().unwrap(),
                has_blocking_issues: false,
            }],
        };
        let old_bytes = fs::read(store.path()).unwrap();
        let mut changed = source_json.clone();
        changed["mcpServers"]["docs"]["env"]["API_TOKEN"] =
            Value::String("changed-after-scan".into());
        fs::write(&source, changed.to_string()).unwrap();
        let result = McpImportScanner
            .commit_specs(&store, params.clone(), &agents(), specs())
            .unwrap();
        assert!(
            matches!(result, McpMutationResult::Invalid { .. }),
            "hidden source changes must invalidate the candidate"
        );
        assert!(
            fs::read(store.path()).unwrap() == old_bytes,
            "failed replacement must preserve the old bytes"
        );
        fs::write(&source, source_json.to_string()).unwrap();
        let mut invalid = params.clone();
        invalid.selections[0].definition_json = r#"{"mcpServers":{"docs":{"command":""}}}"#.into();
        assert!(matches!(
            McpImportScanner
                .commit_specs(&store, invalid, &agents(), specs())
                .unwrap(),
            McpMutationResult::Invalid { .. }
        ));
        assert!(fs::read(store.path()).unwrap() == old_bytes);
        let result = McpImportScanner
            .commit_specs(&store, params, &agents(), specs())
            .unwrap();
        let McpMutationResult::Ok { config, .. } = result else {
            panic!("explicit re-import should replace legacy references");
        };
        let replaced = config
            .servers
            .iter()
            .find(|server| server.server_id == server_id)
            .unwrap();
        assert!(replaced.enabled);
        assert_eq!(replaced.assigned_agent_ids, vec!["agent_1"]);
        let (_, raw) = store.get_with_raw(&agents()).unwrap();
        let raw = raw.unwrap();
        let McpServerDefinition::Stdio { env, .. } = &raw.mcp_servers["docs"] else {
            panic!();
        };
        assert!(
            env["API_TOKEN"] == token && env["EMPTY"].is_empty() && env["PADDED"] == "  info  "
        );

        let database = Database::open(&root.join("data")).unwrap();
        let run_id = Uuid::new_v4().to_string();
        let prepared = McpProjectionService::new(&root.join("data"))
            .prepare(
                &database,
                &store,
                &McpProjectionRequest {
                    agent_run_id: &run_id,
                    execution_epoch: 1,
                    agent_id: "agent_1",
                    adapter_kind: AdapterKind::CodexCli,
                    reported_runtime_version: None,
                    execution_root: &root,
                },
            )
            .unwrap();
        let exposure = serde_json::to_string(&prepared.snapshot).unwrap();
        assert!(!exposure.contains(&token) && !exposure.contains(&auth));
        let McpServerDefinition::Stdio {
            command, args, env, ..
        } = &prepared.servers["docs"]
        else {
            panic!();
        };
        let child = Command::new(command)
            .args(args)
            .env_clear()
            .envs(env)
            .env("EXPECTED_TOKEN", &token)
            .current_dir(&root)
            .output()
            .unwrap();
        assert!(
            child.status.success() && child.stdout.is_empty() && child.stderr.is_empty(),
            "isolated stdio receiver must receive original values without logging them"
        );
        let expected_auth = auth.clone();
        listener.set_nonblocking(true).unwrap();
        let receiver = std::thread::spawn(move || {
            let start = std::time::Instant::now();
            let (mut stream, _) = loop {
                match listener.accept() {
                    Ok(connection) => break connection,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && start.elapsed() < Duration::from_secs(5) =>
                    {
                        std::thread::sleep(Duration::from_millis(10))
                    }
                    _ => return false,
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 1024];
            while !bytes.windows(4).any(|part| part == b"\r\n\r\n") && bytes.len() < 16384 {
                match stream.read(&mut buffer) {
                    Ok(0) | Err(_) => return false,
                    Ok(n) => bytes.extend_from_slice(&buffer[..n]),
                }
            }
            let request = String::from_utf8(bytes).unwrap();
            let matches = request.lines().any(|line| {
                line.strip_prefix("authorization: ")
                    .is_some_and(|value| value == expected_auth)
            });
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .unwrap();
            matches
        });
        let McpServerDefinition::StreamableHttp { url, headers } = &prepared.servers["remote"]
        else {
            panic!();
        };
        let mut request = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap()
            .post(url);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        assert!(request.send().await.unwrap().status().is_success());
        assert!(
            receiver.join().unwrap(),
            "isolated HTTP receiver must receive the complete Authorization value"
        );
        drop(database);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn blocks_tool_policy_trust_oauth_and_unknown_fields() {
        let root = fixture_root();
        fs::create_dir_all(&root).unwrap();
        let source = root.join("cursor.json");
        fs::write(
            &source,
            r#"{"mcpServers":{
              "filtered":{"command":"node","includeTools":["read"],"autoApprove":["read"]},
              "trusted":{"url":"https://example.com/mcp","trust":true},
              "oauth":{"url":"https://example.com/mcp","oauth":{"cached":true}},
              "unknown":{"command":"node","vendorPolicy":"admin"}
            }}"#,
        )
        .unwrap();
        let store = McpConfigStore::new(root.join(".rovai/mcp.json"));
        let inspection = McpImportScanner
            .scan_specs(
                &store,
                &agents(),
                vec![spec(McpImportSourceKind::Cursor, source, "mcpServers")],
            )
            .unwrap();
        assert!(
            inspection
                .candidates
                .iter()
                .all(|candidate| candidate.compatibility == McpImportCompatibility::Unsupported)
        );
        assert!(
            inspection
                .candidates
                .iter()
                .all(|candidate| candidate.normalized_definition_json.is_none())
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn known_non_authority_options_are_listed_and_dropped() {
        let root = fixture_root();
        fs::create_dir_all(&root).unwrap();
        let source = root.join("copilot.json");
        fs::write(
            &source,
            r#"{"mcpServers":{"docs":{"command":"node","timeout":30,"required":true}}}"#,
        )
        .unwrap();
        let store = McpConfigStore::new(root.join(".rovai/mcp.json"));
        let inspection = McpImportScanner
            .scan_specs(
                &store,
                &agents(),
                vec![spec(McpImportSourceKind::Copilot, source, "mcpServers")],
            )
            .unwrap();
        let candidate = &inspection.candidates[0];
        assert_eq!(candidate.compatibility, McpImportCompatibility::Portable);
        assert_eq!(
            candidate
                .issues
                .iter()
                .filter(|issue| issue.kind == McpImportIssueKind::Dropped)
                .count(),
            2
        );
        assert!(
            !candidate
                .normalized_definition_json
                .as_ref()
                .unwrap()
                .contains("timeout")
        );
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
        let inspection = McpImportScanner
            .scan_specs(
                &store,
                &agents(),
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
}
