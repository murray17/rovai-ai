use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

pub const MCP_SCHEMA_VERSION: u32 = 1;
pub const TEAM_MCP_RESERVED_NAME: &str = "lumen_team";
const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_SERVERS: usize = 128;
const MAX_ARGUMENTS: usize = 256;
const MAX_MAP_ENTRIES: usize = 128;
const MAX_STRING_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpConfigFile {
    pub schema_version: u32,
    #[serde(default)]
    pub mcp_servers: BTreeMap<String, McpServerDefinition>,
}

impl Default for McpConfigFile {
    fn default() -> Self {
        Self {
            schema_version: MCP_SCHEMA_VERSION,
            mcp_servers: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "transport", rename_all = "snake_case", deny_unknown_fields)]
pub enum McpServerDefinition {
    Stdio {
        enabled: bool,
        #[serde(default)]
        agent_profile_ids: Vec<String>,
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        cwd: Option<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        missing_values: Vec<String>,
    },
    StreamableHttp {
        enabled: bool,
        #[serde(default)]
        agent_profile_ids: Vec<String>,
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        missing_values: Vec<String>,
    },
}

impl McpServerDefinition {
    pub fn enabled(&self) -> bool {
        match self {
            Self::Stdio { enabled, .. } | Self::StreamableHttp { enabled, .. } => *enabled,
        }
    }

    pub fn set_enabled(&mut self, value: bool) {
        match self {
            Self::Stdio { enabled, .. } | Self::StreamableHttp { enabled, .. } => *enabled = value,
        }
    }

    pub fn agent_profile_ids(&self) -> &[String] {
        match self {
            Self::Stdio {
                agent_profile_ids, ..
            }
            | Self::StreamableHttp {
                agent_profile_ids, ..
            } => agent_profile_ids,
        }
    }

    pub fn missing_values(&self) -> &[String] {
        match self {
            Self::Stdio { missing_values, .. } | Self::StreamableHttp { missing_values, .. } => {
                missing_values
            }
        }
    }

    fn preserve_activation_from(&mut self, existing: &Self) {
        let enabled = existing.enabled();
        let assignments = existing.agent_profile_ids().to_vec();
        match self {
            Self::Stdio {
                enabled: target_enabled,
                agent_profile_ids,
                ..
            }
            | Self::StreamableHttp {
                enabled: target_enabled,
                agent_profile_ids,
                ..
            } => {
                *target_enabled = enabled;
                *agent_profile_ids = assignments;
            }
        }
    }

    fn normalize(&mut self) {
        let (ids, missing_values) = match self {
            Self::Stdio {
                agent_profile_ids,
                missing_values,
                ..
            }
            | Self::StreamableHttp {
                agent_profile_ids,
                missing_values,
                ..
            } => (agent_profile_ids, missing_values),
        };
        ids.sort();
        ids.dedup();
        missing_values.sort();
        missing_values.dedup();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpEditableValue {
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub preserve_stored: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "transport", rename_all = "snake_case", deny_unknown_fields)]
pub enum McpServerInput {
    Stdio {
        enabled: bool,
        #[serde(default)]
        agent_profile_ids: Vec<String>,
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        cwd: Option<String>,
        #[serde(default)]
        env: BTreeMap<String, McpEditableValue>,
        #[serde(default)]
        missing_values: Vec<String>,
    },
    StreamableHttp {
        enabled: bool,
        #[serde(default)]
        agent_profile_ids: Vec<String>,
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, McpEditableValue>,
        #[serde(default)]
        missing_values: Vec<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigValueView {
    pub value: Option<String>,
    pub has_stored_value: bool,
    pub sensitive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "transport", rename_all = "snake_case", deny_unknown_fields)]
pub enum McpServerView {
    Stdio {
        name: String,
        enabled: bool,
        agent_profile_ids: Vec<String>,
        command: String,
        args: Vec<String>,
        cwd: Option<String>,
        env: BTreeMap<String, McpConfigValueView>,
        missing_values: Vec<String>,
        issues: Vec<McpConfigIssue>,
    },
    StreamableHttp {
        name: String,
        enabled: bool,
        agent_profile_ids: Vec<String>,
        url: String,
        headers: BTreeMap<String, McpConfigValueView>,
        missing_values: Vec<String>,
        issues: Vec<McpConfigIssue>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigIssue {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<usize>,
}

impl McpConfigIssue {
    fn new(code: impl Into<String>, message: impl Into<String>, field: Option<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            field,
            line: None,
            column: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigView {
    pub path: String,
    pub exists: bool,
    pub config_digest: String,
    pub servers: Vec<McpServerView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_issue: Option<McpConfigIssue>,
    pub permission_issue: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum McpMutationResult {
    Ok {
        config_digest: String,
        config: McpConfigView,
    },
    Conflict {
        actual_config_digest: String,
    },
    Invalid {
        issues: Vec<McpConfigIssue>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateMcpServerParams {
    pub expected_config_digest: String,
    pub name: String,
    pub definition: McpServerInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateMcpServerParams {
    pub expected_config_digest: String,
    pub name: String,
    pub new_name: String,
    pub definition: McpServerInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetMcpServerEnabledParams {
    pub expected_config_digest: String,
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteMcpServerParams {
    pub expected_config_digest: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpImportAction {
    Create,
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpImportSelection {
    pub candidate_id: String,
    pub action: McpImportAction,
    pub name: String,
    pub definition: McpServerInput,
    #[serde(default)]
    pub accept_all_tools: bool,
    #[serde(default)]
    pub has_nonportable_tool_filter: bool,
    #[serde(default)]
    pub has_blocking_issues: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitMcpImportParams {
    pub expected_config_digest: String,
    pub selections: Vec<McpImportSelection>,
}

#[derive(Debug, Clone)]
pub struct McpConfigStore {
    path: PathBuf,
}

struct LoadedConfig {
    exists: bool,
    digest: String,
    config: Option<McpConfigFile>,
    file_issue: Option<McpConfigIssue>,
    permission_issue: bool,
}

impl McpConfigStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn default_path() -> Result<PathBuf> {
        Ok(dirs::home_dir()
            .context("could not determine the home directory for ~/.lumen/mcp.json")?
            .join(".lumen")
            .join("mcp.json"))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn get(&self, known_agent_profile_ids: &BTreeSet<String>) -> Result<McpConfigView> {
        let loaded = self.load()?;
        Ok(self.view(&loaded, known_agent_profile_ids))
    }

    pub fn create(
        &self,
        params: CreateMcpServerParams,
        known_agent_profile_ids: &BTreeSet<String>,
    ) -> Result<McpMutationResult> {
        self.mutate(
            &params.expected_config_digest,
            known_agent_profile_ids,
            |config| {
                let mut issues = validate_server_name(&params.name);
                let definition = materialize_input(params.definition, None, &mut issues);
                if let Some(definition) = definition.as_ref() {
                    issues.extend(validate_assignments(definition, known_agent_profile_ids));
                }
                if !issues.is_empty() {
                    return Err(issues);
                }
                let definition = definition.expect("validated definition");
                if let Some(existing) = config.mcp_servers.get(&params.name) {
                    if existing == &definition {
                        return Ok(false);
                    }
                    return Err(vec![McpConfigIssue::new(
                        "mcp.name_conflict",
                        "An MCP Server with this name already exists",
                        Some("name".to_string()),
                    )]);
                }
                config.mcp_servers.insert(params.name, definition);
                Ok(true)
            },
        )
    }

    pub fn update(
        &self,
        params: UpdateMcpServerParams,
        known_agent_profile_ids: &BTreeSet<String>,
    ) -> Result<McpMutationResult> {
        self.mutate(
            &params.expected_config_digest,
            known_agent_profile_ids,
            |config| {
                let Some(existing) = config.mcp_servers.get(&params.name).cloned() else {
                    return Err(vec![McpConfigIssue::new(
                        "mcp.not_found",
                        "The MCP Server no longer exists",
                        Some("name".to_string()),
                    )]);
                };
                let mut issues = validate_server_name(&params.new_name);
                if params.name != params.new_name
                    && config.mcp_servers.contains_key(&params.new_name)
                {
                    issues.push(McpConfigIssue::new(
                        "mcp.name_conflict",
                        "An MCP Server with the new name already exists",
                        Some("newName".to_string()),
                    ));
                }
                let definition = materialize_input(params.definition, Some(&existing), &mut issues);
                if let Some(definition) = definition.as_ref() {
                    issues.extend(validate_assignments(definition, known_agent_profile_ids));
                }
                if !issues.is_empty() {
                    return Err(issues);
                }
                let definition = definition.expect("validated definition");
                if params.name == params.new_name && existing == definition {
                    return Ok(false);
                }
                config.mcp_servers.remove(&params.name);
                config.mcp_servers.insert(params.new_name, definition);
                Ok(true)
            },
        )
    }

    pub fn set_enabled(
        &self,
        params: SetMcpServerEnabledParams,
        known_agent_profile_ids: &BTreeSet<String>,
    ) -> Result<McpMutationResult> {
        self.mutate(
            &params.expected_config_digest,
            known_agent_profile_ids,
            |config| {
                let Some(server) = config.mcp_servers.get_mut(&params.name) else {
                    return Err(vec![McpConfigIssue::new(
                        "mcp.not_found",
                        "The MCP Server no longer exists",
                        Some("name".to_string()),
                    )]);
                };
                if server.enabled() == params.enabled {
                    return Ok(false);
                }
                if params.enabled && !server.missing_values().is_empty() {
                    return Err(vec![McpConfigIssue::new(
                        "mcp.values_required",
                        "Missing imported values must be supplied before enabling this MCP Server",
                        Some("enabled".to_string()),
                    )]);
                }
                server.set_enabled(params.enabled);
                Ok(true)
            },
        )
    }

    pub fn delete(
        &self,
        params: DeleteMcpServerParams,
        known_agent_profile_ids: &BTreeSet<String>,
    ) -> Result<McpMutationResult> {
        self.mutate(
            &params.expected_config_digest,
            known_agent_profile_ids,
            |config| Ok(config.mcp_servers.remove(&params.name).is_some()),
        )
    }

    pub fn commit_import(
        &self,
        params: CommitMcpImportParams,
        known_agent_profile_ids: &BTreeSet<String>,
    ) -> Result<McpMutationResult> {
        self.mutate(
            &params.expected_config_digest,
            known_agent_profile_ids,
            |config| {
                if params.selections.is_empty() {
                    return Ok(false);
                }
                let mut issues = Vec::new();
                let mut materialized = Vec::new();
                let mut requested_names = BTreeSet::new();
                for selection in params.selections {
                    if !requested_names.insert(selection.name.clone()) {
                        issues.push(McpConfigIssue::new(
                            "mcp.import_duplicate_name",
                            "Import selections contain the same destination name",
                            Some("name".to_string()),
                        ));
                        continue;
                    }
                    issues.extend(validate_server_name(&selection.name));
                    if selection.has_nonportable_tool_filter && !selection.accept_all_tools {
                        issues.push(McpConfigIssue::new(
                            "mcp.import_tool_filter_confirmation_required",
                            "Confirm importing this Server without its source tool filter",
                            Some("acceptAllTools".to_string()),
                        ));
                    }
                    if selection.has_blocking_issues {
                        issues.push(McpConfigIssue::new(
                            "mcp.import_candidate_unsupported",
                            "Unsupported import candidates cannot be committed",
                            Some("candidateId".to_string()),
                        ));
                    }
                    let existing = config.mcp_servers.get(&selection.name);
                    match selection.action {
                        McpImportAction::Create if existing.is_some() => {
                            issues.push(McpConfigIssue::new(
                                "mcp.name_conflict",
                                "An MCP Server with this name already exists",
                                Some("name".to_string()),
                            ));
                            continue;
                        }
                        McpImportAction::Replace if existing.is_none() => {
                            issues.push(McpConfigIssue::new(
                                "mcp.replace_target_missing",
                                "The MCP Server selected for replacement no longer exists",
                                Some("name".to_string()),
                            ));
                            continue;
                        }
                        _ => {}
                    }
                    let mut definition =
                        materialize_input(selection.definition, existing, &mut issues);
                    if let (Some(definition), McpImportAction::Replace, Some(existing)) =
                        (definition.as_mut(), selection.action, existing)
                    {
                        definition.preserve_activation_from(existing);
                    }
                    if let Some(definition) = definition.as_ref() {
                        issues.extend(validate_assignments(definition, known_agent_profile_ids));
                    }
                    materialized.push((selection.action, selection.name, definition));
                }
                if !issues.is_empty() {
                    return Err(issues);
                }
                for (action, name, definition) in materialized {
                    let definition = definition.expect("validated import definition");
                    match action {
                        McpImportAction::Create | McpImportAction::Replace => {
                            config.mcp_servers.insert(name, definition);
                        }
                    }
                }
                Ok(true)
            },
        )
    }

    pub(crate) fn get_with_raw(
        &self,
        known_agent_profile_ids: &BTreeSet<String>,
    ) -> Result<(McpConfigView, Option<McpConfigFile>)> {
        let loaded = self.load()?;
        let view = self.view(&loaded, known_agent_profile_ids);
        Ok((view, loaded.config))
    }

    fn mutate(
        &self,
        expected_digest: &str,
        known_agent_profile_ids: &BTreeSet<String>,
        mutation: impl FnOnce(&mut McpConfigFile) -> std::result::Result<bool, Vec<McpConfigIssue>>,
    ) -> Result<McpMutationResult> {
        let loaded = self.load()?;
        if loaded.digest != expected_digest {
            return Ok(McpMutationResult::Conflict {
                actual_config_digest: loaded.digest,
            });
        }
        let Some(mut config) = loaded.config.clone() else {
            return Ok(McpMutationResult::Invalid {
                issues: loaded.file_issue.into_iter().collect(),
            });
        };
        let changed = match mutation(&mut config) {
            Ok(changed) => changed,
            Err(issues) => return Ok(McpMutationResult::Invalid { issues }),
        };
        normalize_config(&mut config);
        let issues = validate_config(&config);
        if !issues.is_empty() {
            return Ok(McpMutationResult::Invalid { issues });
        }
        if !changed {
            let config = self.view(&loaded, known_agent_profile_ids);
            return Ok(McpMutationResult::Ok {
                config_digest: loaded.digest,
                config,
            });
        }
        self.write(&config)?;
        let reloaded = self.load()?;
        let view = self.view(&reloaded, known_agent_profile_ids);
        Ok(McpMutationResult::Ok {
            config_digest: reloaded.digest,
            config: view,
        })
    }

    fn load(&self) -> Result<LoadedConfig> {
        let empty = McpConfigFile::default();
        let empty_bytes = canonical_bytes(&empty)?;
        if !self.path.exists() {
            return Ok(LoadedConfig {
                exists: false,
                digest: bytes_digest(&empty_bytes),
                config: Some(empty),
                file_issue: None,
                permission_issue: false,
            });
        }
        let metadata = fs::symlink_metadata(&self.path)
            .with_context(|| format!("failed to inspect MCP config {}", self.path.display()))?;
        if !metadata.file_type().is_file() {
            return Ok(LoadedConfig {
                exists: true,
                digest: "sha256:invalid-file-type".to_string(),
                config: None,
                file_issue: Some(McpConfigIssue::new(
                    "mcp.config_not_regular_file",
                    "MCP configuration must be a regular file",
                    None,
                )),
                permission_issue: true,
            });
        }
        if metadata.len() > MAX_CONFIG_BYTES {
            return Ok(LoadedConfig {
                exists: true,
                digest: format!("sha256:oversize-{}", metadata.len()),
                config: None,
                file_issue: Some(McpConfigIssue::new(
                    "mcp.config_too_large",
                    "MCP configuration exceeds the 1 MiB limit",
                    None,
                )),
                permission_issue: metadata.permissions().mode() & 0o077 != 0,
            });
        }
        let bytes = fs::read(&self.path)
            .with_context(|| format!("failed to read MCP config {}", self.path.display()))?;
        let digest = bytes_digest(&bytes);
        let permission_issue = metadata.permissions().mode() & 0o077 != 0;
        let mut config = match serde_json::from_slice::<McpConfigFile>(&bytes) {
            Ok(config) => config,
            Err(error) => {
                return Ok(LoadedConfig {
                    exists: true,
                    digest,
                    config: None,
                    file_issue: Some(McpConfigIssue {
                        code: "mcp.config_parse_failed".to_string(),
                        message: error.to_string(),
                        field: None,
                        line: Some(error.line()),
                        column: Some(error.column()),
                    }),
                    permission_issue,
                });
            }
        };
        normalize_config(&mut config);
        let issues = validate_config(&config);
        if let Some(issue) = issues.into_iter().next() {
            return Ok(LoadedConfig {
                exists: true,
                digest,
                config: None,
                file_issue: Some(issue),
                permission_issue,
            });
        }
        Ok(LoadedConfig {
            exists: true,
            digest,
            config: Some(config),
            file_issue: None,
            permission_issue,
        })
    }

    fn view(
        &self,
        loaded: &LoadedConfig,
        known_agent_profile_ids: &BTreeSet<String>,
    ) -> McpConfigView {
        let servers = loaded
            .config
            .as_ref()
            .map(|config| {
                config
                    .mcp_servers
                    .iter()
                    .map(|(name, definition)| {
                        server_view(name, definition, known_agent_profile_ids)
                    })
                    .collect()
            })
            .unwrap_or_default();
        McpConfigView {
            path: self.path.to_string_lossy().to_string(),
            exists: loaded.exists,
            config_digest: loaded.digest.clone(),
            servers,
            file_issue: loaded.file_issue.clone(),
            permission_issue: loaded.permission_issue,
        }
    }

    fn write(&self, config: &McpConfigFile) -> Result<()> {
        let parent = self
            .path
            .parent()
            .context("MCP configuration path has no parent directory")?;
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create MCP directory {}", parent.display()))?;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .with_context(|| format!("failed to restrict MCP directory {}", parent.display()))?;
        let bytes = canonical_bytes(config)?;
        let temporary = parent.join(format!(".mcp-{}.tmp", Uuid::new_v4()));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)
            .with_context(|| {
                format!(
                    "failed to create temporary MCP config {}",
                    temporary.display()
                )
            })?;
        let result = (|| -> Result<()> {
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, &self.path).with_context(|| {
                format!(
                    "failed to atomically replace MCP config {}",
                    self.path.display()
                )
            })?;
            fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600))?;
            File::open(parent)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
}

fn materialize_input(
    input: McpServerInput,
    existing: Option<&McpServerDefinition>,
    issues: &mut Vec<McpConfigIssue>,
) -> Option<McpServerDefinition> {
    let mut definition = match input {
        McpServerInput::Stdio {
            enabled,
            agent_profile_ids,
            command,
            args,
            cwd,
            env,
            missing_values,
        } => {
            let existing_env = match existing {
                Some(McpServerDefinition::Stdio { env, .. }) => Some(env),
                _ => None,
            };
            let env = materialize_values(env, existing_env, "env", issues);
            Some(McpServerDefinition::Stdio {
                enabled,
                agent_profile_ids,
                command,
                args,
                cwd,
                env,
                missing_values,
            })
        }
        McpServerInput::StreamableHttp {
            enabled,
            agent_profile_ids,
            url,
            headers,
            missing_values,
        } => {
            let existing_headers = match existing {
                Some(McpServerDefinition::StreamableHttp { headers, .. }) => Some(headers),
                _ => None,
            };
            let headers = materialize_values(headers, existing_headers, "headers", issues);
            Some(McpServerDefinition::StreamableHttp {
                enabled,
                agent_profile_ids,
                url,
                headers,
                missing_values,
            })
        }
    };
    if let Some(definition) = definition.as_mut() {
        definition.normalize();
        issues.extend(validate_definition(definition));
    }
    definition
}

fn materialize_values(
    values: BTreeMap<String, McpEditableValue>,
    existing: Option<&BTreeMap<String, String>>,
    field: &str,
    issues: &mut Vec<McpConfigIssue>,
) -> BTreeMap<String, String> {
    values
        .into_iter()
        .filter_map(|(key, input)| {
            let value = match (input.value, input.preserve_stored) {
                (Some(value), false) | (Some(value), true) => Some(value),
                (None, true) => existing.and_then(|values| values.get(&key)).cloned(),
                (None, false) => None,
            };
            if value.is_none() && input.preserve_stored {
                issues.push(McpConfigIssue::new(
                    "mcp.preserved_value_missing",
                    "The masked value no longer exists and must be entered again",
                    Some(format!("{field}.{key}")),
                ));
            }
            value.map(|value| (key, value))
        })
        .collect()
}

fn normalize_config(config: &mut McpConfigFile) {
    for definition in config.mcp_servers.values_mut() {
        definition.normalize();
    }
}

fn validate_config(config: &McpConfigFile) -> Vec<McpConfigIssue> {
    let mut issues = Vec::new();
    if config.schema_version != MCP_SCHEMA_VERSION {
        issues.push(McpConfigIssue::new(
            "mcp.unsupported_schema_version",
            format!(
                "Unsupported MCP schema version {}; expected {}",
                config.schema_version, MCP_SCHEMA_VERSION
            ),
            Some("schemaVersion".to_string()),
        ));
    }
    if config.mcp_servers.len() > MAX_SERVERS {
        issues.push(McpConfigIssue::new(
            "mcp.too_many_servers",
            format!("MCP configuration may contain at most {MAX_SERVERS} Servers"),
            Some("mcpServers".to_string()),
        ));
    }
    for (name, definition) in &config.mcp_servers {
        issues.extend(validate_server_name(name));
        issues.extend(
            validate_definition(definition)
                .into_iter()
                .map(|mut issue| {
                    issue.field = issue
                        .field
                        .map(|field| format!("mcpServers.{name}.{field}"));
                    issue
                }),
        );
    }
    issues
}

fn validate_server_name(name: &str) -> Vec<McpConfigIssue> {
    let valid = !name.is_empty()
        && name.len() <= 64
        && name.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index != 0 && matches!(byte, b'_' | b'-'))
        });
    let mut issues = Vec::new();
    if !valid {
        issues.push(McpConfigIssue::new(
            "mcp.invalid_name",
            "MCP Server name must be 1-64 ASCII letters, digits, underscores or hyphens and start with a letter or digit",
            Some("name".to_string()),
        ));
    }
    if name == TEAM_MCP_RESERVED_NAME {
        issues.push(McpConfigIssue::new(
            "mcp.reserved_name",
            "lumen_team is reserved for Lumen's internal Team MCP",
            Some("name".to_string()),
        ));
    }
    issues
}

fn validate_definition(definition: &McpServerDefinition) -> Vec<McpConfigIssue> {
    let mut issues = Vec::new();
    match definition {
        McpServerDefinition::Stdio {
            enabled,
            command,
            args,
            cwd,
            env,
            missing_values,
            ..
        } => {
            if command.trim().is_empty() || command.len() > MAX_STRING_BYTES {
                issues.push(McpConfigIssue::new(
                    "mcp.invalid_command",
                    "Stdio command must be non-empty and within the size limit",
                    Some("command".to_string()),
                ));
            }
            if args.len() > MAX_ARGUMENTS || args.iter().any(|value| value.len() > MAX_STRING_BYTES)
            {
                issues.push(McpConfigIssue::new(
                    "mcp.invalid_arguments",
                    "Stdio arguments exceed the count or size limit",
                    Some("args".to_string()),
                ));
            }
            if cwd
                .as_ref()
                .is_some_and(|value| value.is_empty() || value.len() > MAX_STRING_BYTES)
            {
                issues.push(McpConfigIssue::new(
                    "mcp.invalid_cwd",
                    "Stdio working directory is invalid",
                    Some("cwd".to_string()),
                ));
            }
            validate_map(env, "env", true, &mut issues);
            validate_missing_values(*enabled, missing_values, "env", &mut issues);
        }
        McpServerDefinition::StreamableHttp {
            enabled,
            url,
            headers,
            missing_values,
            ..
        } => {
            match Url::parse(url) {
                Ok(url) if matches!(url.scheme(), "http" | "https") => {}
                _ => issues.push(McpConfigIssue::new(
                    "mcp.invalid_url",
                    "Streamable HTTP URL must use http or https",
                    Some("url".to_string()),
                )),
            }
            validate_map(headers, "headers", false, &mut issues);
            validate_missing_values(*enabled, missing_values, "headers", &mut issues);
        }
    }
    issues
}

fn validate_missing_values(
    enabled: bool,
    missing_values: &[String],
    expected_prefix: &str,
    issues: &mut Vec<McpConfigIssue>,
) {
    for field in missing_values {
        let valid = field
            .strip_prefix(&format!("{expected_prefix}."))
            .is_some_and(|key| {
                if expected_prefix == "env" {
                    valid_environment_name(key)
                } else {
                    valid_header_name(key)
                }
            });
        if !valid {
            issues.push(McpConfigIssue::new(
                "mcp.invalid_missing_value",
                "Missing imported value has an invalid field reference",
                Some("missingValues".to_string()),
            ));
        }
    }
    if enabled && !missing_values.is_empty() {
        issues.push(McpConfigIssue::new(
            "mcp.values_required",
            "MCP Server must remain disabled until imported values are supplied",
            Some("enabled".to_string()),
        ));
    }
}

fn validate_assignments(
    definition: &McpServerDefinition,
    known_agent_profile_ids: &BTreeSet<String>,
) -> Vec<McpConfigIssue> {
    definition
        .agent_profile_ids()
        .iter()
        .filter(|id| !known_agent_profile_ids.contains(*id))
        .map(|id| {
            McpConfigIssue::new(
                "mcp.unknown_agent_profile",
                format!("Assigned AgentProfile {id} does not exist"),
                Some("agentProfileIds".to_string()),
            )
        })
        .collect()
}

fn validate_map(
    values: &BTreeMap<String, String>,
    field: &str,
    environment: bool,
    issues: &mut Vec<McpConfigIssue>,
) {
    if values.len() > MAX_MAP_ENTRIES {
        issues.push(McpConfigIssue::new(
            "mcp.too_many_values",
            format!("{field} contains too many entries"),
            Some(field.to_string()),
        ));
    }
    for (key, value) in values {
        let valid_key = if environment {
            valid_environment_name(key)
        } else {
            valid_header_name(key)
        };
        if !valid_key {
            issues.push(McpConfigIssue::new(
                "mcp.invalid_key",
                format!("{field} contains an invalid key"),
                Some(format!("{field}.{key}")),
            ));
        }
        if value.len() > MAX_STRING_BYTES
            || (!environment && (value.contains('\r') || value.contains('\n')))
        {
            issues.push(McpConfigIssue::new(
                "mcp.invalid_value",
                format!("{field} contains an invalid value"),
                Some(format!("{field}.{key}")),
            ));
        }
    }
}

fn valid_environment_name(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().enumerate().all(|(index, byte)| {
            byte == b'_' || byte.is_ascii_alphabetic() || (index > 0 && byte.is_ascii_digit())
        })
}

fn valid_header_name(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'!' | b'#'
                        | b'$'
                        | b'%'
                        | b'&'
                        | b'\''
                        | b'*'
                        | b'+'
                        | b'-'
                        | b'.'
                        | b'^'
                        | b'_'
                        | b'`'
                        | b'|'
                        | b'~'
                )
        })
}

fn server_view(
    name: &str,
    definition: &McpServerDefinition,
    known_agent_profile_ids: &BTreeSet<String>,
) -> McpServerView {
    let mut issues = definition
        .agent_profile_ids()
        .iter()
        .filter(|id| !known_agent_profile_ids.contains(*id))
        .map(|id| {
            McpConfigIssue::new(
                "mcp.unknown_agent_profile",
                format!("Assigned AgentProfile {id} does not exist"),
                Some("agentProfileIds".to_string()),
            )
        })
        .collect::<Vec<_>>();
    issues.extend(definition.missing_values().iter().map(|field| {
        McpConfigIssue::new(
            "mcp.value_required",
            "Imported value must be supplied before this Server can be enabled",
            Some(field.clone()),
        )
    }));
    match definition {
        McpServerDefinition::Stdio {
            enabled,
            agent_profile_ids,
            command,
            args,
            cwd,
            env,
            missing_values,
        } => McpServerView::Stdio {
            name: name.to_string(),
            enabled: *enabled,
            agent_profile_ids: agent_profile_ids.clone(),
            command: command.clone(),
            args: args.clone(),
            cwd: cwd.clone(),
            env: redact_values(env, false),
            missing_values: missing_values.clone(),
            issues,
        },
        McpServerDefinition::StreamableHttp {
            enabled,
            agent_profile_ids,
            url,
            headers,
            missing_values,
        } => McpServerView::StreamableHttp {
            name: name.to_string(),
            enabled: *enabled,
            agent_profile_ids: agent_profile_ids.clone(),
            url: url.clone(),
            headers: redact_values(headers, true),
            missing_values: missing_values.clone(),
            issues,
        },
    }
}

fn redact_values(
    values: &BTreeMap<String, String>,
    headers: bool,
) -> BTreeMap<String, McpConfigValueView> {
    values
        .iter()
        .map(|(key, value)| {
            let reference = is_environment_reference(value);
            let sensitive = !reference && (headers || sensitive_key(key));
            (
                key.clone(),
                McpConfigValueView {
                    value: (!sensitive).then(|| value.clone()),
                    has_stored_value: true,
                    sensitive,
                },
            )
        })
        .collect()
}

fn is_environment_reference(value: &str) -> bool {
    let value = value.trim();
    value.starts_with("${")
        && value.ends_with('}')
        && valid_environment_name(&value[2..value.len() - 1])
}

fn sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_uppercase();
    ["TOKEN", "SECRET", "PASSWORD", "API_KEY", "AUTH", "COOKIE"]
        .iter()
        .any(|part| normalized.contains(part))
}

fn canonical_bytes(config: &McpConfigFile) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(config)?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn bytes_digest(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_store(name: &str) -> (PathBuf, McpConfigStore) {
        let root = std::env::temp_dir().join(format!("lumen-mcp-{name}-{}", Uuid::new_v4()));
        let store = McpConfigStore::new(root.join(".lumen/mcp.json"));
        (root, store)
    }

    fn active_agents() -> BTreeSet<String> {
        ["agent-luoke".to_string(), "agent-muwa".to_string()]
            .into_iter()
            .collect()
    }

    fn stdio_input() -> McpServerInput {
        McpServerInput::Stdio {
            enabled: true,
            agent_profile_ids: vec!["agent-muwa".to_string()],
            command: "npx".to_string(),
            args: vec!["-y".to_string(), "@example/mcp".to_string()],
            cwd: None,
            env: BTreeMap::from([
                (
                    "LOG_LEVEL".to_string(),
                    McpEditableValue {
                        value: Some("info".to_string()),
                        preserve_stored: false,
                    },
                ),
                (
                    "API_TOKEN".to_string(),
                    McpEditableValue {
                        value: Some("secret".to_string()),
                        preserve_stored: false,
                    },
                ),
            ]),
            missing_values: Vec::new(),
        }
    }

    #[test]
    fn missing_config_is_empty_and_read_only() {
        let (root, store) = temporary_store("missing");
        let view = store.get(&active_agents()).unwrap();
        assert!(!view.exists);
        assert!(view.servers.is_empty());
        assert!(!store.path().exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creates_atomic_private_config_and_redacts_sensitive_values() {
        let (root, store) = temporary_store("create");
        let initial = store.get(&active_agents()).unwrap();
        let result = store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: initial.config_digest,
                    name: "docs".to_string(),
                    definition: stdio_input(),
                },
                &active_agents(),
            )
            .unwrap();
        let McpMutationResult::Ok { config, .. } = result else {
            panic!("create should succeed");
        };
        assert!(store.path().exists());
        assert_eq!(
            fs::metadata(store.path()).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let McpServerView::Stdio { env, .. } = &config.servers[0] else {
            panic!("expected stdio");
        };
        assert_eq!(env["LOG_LEVEL"].value.as_deref(), Some("info"));
        assert_eq!(env["API_TOKEN"].value, None);
        assert!(env["API_TOKEN"].sensitive);
        let raw = fs::read_to_string(store.path()).unwrap();
        assert!(raw.contains("\"API_TOKEN\": \"secret\""));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stale_digest_does_not_overwrite_external_edit() {
        let (root, store) = temporary_store("conflict");
        let initial = store.get(&active_agents()).unwrap();
        let first = store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: initial.config_digest.clone(),
                    name: "docs".to_string(),
                    definition: stdio_input(),
                },
                &active_agents(),
            )
            .unwrap();
        assert!(matches!(first, McpMutationResult::Ok { .. }));
        let conflict = store
            .delete(
                DeleteMcpServerParams {
                    expected_config_digest: initial.config_digest,
                    name: "docs".to_string(),
                },
                &active_agents(),
            )
            .unwrap();
        assert!(matches!(conflict, McpMutationResult::Conflict { .. }));
        assert!(store.get(&active_agents()).unwrap().servers.len() == 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn invalid_json_is_reported_and_never_replaced() {
        let (root, store) = temporary_store("invalid");
        fs::create_dir_all(store.path().parent().unwrap()).unwrap();
        fs::write(store.path(), b"{broken").unwrap();
        let view = store.get(&active_agents()).unwrap();
        assert_eq!(
            view.file_issue.as_ref().map(|issue| issue.code.as_str()),
            Some("mcp.config_parse_failed")
        );
        let before = fs::read(store.path()).unwrap();
        let result = store
            .delete(
                DeleteMcpServerParams {
                    expected_config_digest: view.config_digest,
                    name: "anything".to_string(),
                },
                &active_agents(),
            )
            .unwrap();
        assert!(matches!(result, McpMutationResult::Invalid { .. }));
        assert_eq!(fs::read(store.path()).unwrap(), before);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn update_preserves_masked_secret_by_key() {
        let (root, store) = temporary_store("preserve");
        let initial = store.get(&active_agents()).unwrap();
        let created = store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: initial.config_digest,
                    name: "docs".to_string(),
                    definition: stdio_input(),
                },
                &active_agents(),
            )
            .unwrap();
        let McpMutationResult::Ok { config_digest, .. } = created else {
            panic!("create should succeed");
        };
        let updated = store
            .update(
                UpdateMcpServerParams {
                    expected_config_digest: config_digest,
                    name: "docs".to_string(),
                    new_name: "docs".to_string(),
                    definition: McpServerInput::Stdio {
                        enabled: false,
                        agent_profile_ids: vec!["agent-luoke".to_string()],
                        command: "node".to_string(),
                        args: Vec::new(),
                        cwd: None,
                        env: BTreeMap::from([(
                            "API_TOKEN".to_string(),
                            McpEditableValue {
                                value: None,
                                preserve_stored: true,
                            },
                        )]),
                        missing_values: Vec::new(),
                    },
                },
                &active_agents(),
            )
            .unwrap();
        assert!(matches!(updated, McpMutationResult::Ok { .. }));
        let raw: McpConfigFile = serde_json::from_slice(&fs::read(store.path()).unwrap()).unwrap();
        let McpServerDefinition::Stdio { env, .. } = &raw.mcp_servers["docs"] else {
            panic!("expected stdio");
        };
        assert_eq!(env["API_TOKEN"], "secret");
        assert!(!env.contains_key("LOG_LEVEL"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_reserved_name_and_unknown_fields() {
        let (root, store) = temporary_store("reserved");
        let initial = store.get(&active_agents()).unwrap();
        let result = store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: initial.config_digest,
                    name: TEAM_MCP_RESERVED_NAME.to_string(),
                    definition: stdio_input(),
                },
                &active_agents(),
            )
            .unwrap();
        assert!(matches!(result, McpMutationResult::Invalid { .. }));
        fs::create_dir_all(store.path().parent().unwrap()).unwrap();
        fs::write(
            store.path(),
            br#"{"schemaVersion":1,"mcpServers":{},"extra":true}"#,
        )
        .unwrap();
        let view = store.get(&active_agents()).unwrap();
        assert_eq!(
            view.file_issue.as_ref().map(|issue| issue.code.as_str()),
            Some("mcp.config_parse_failed")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_unknown_agent_assignment_and_treats_missing_delete_as_idempotent() {
        let (root, store) = temporary_store("assignment");
        let initial = store.get(&active_agents()).unwrap();
        let input = McpServerInput::Stdio {
            enabled: true,
            agent_profile_ids: vec!["agent-does-not-exist".to_string()],
            command: "node".to_string(),
            args: Vec::new(),
            cwd: None,
            env: BTreeMap::new(),
            missing_values: Vec::new(),
        };
        let result = store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: initial.config_digest.clone(),
                    name: "invalid-assignment".to_string(),
                    definition: input,
                },
                &active_agents(),
            )
            .unwrap();
        assert!(matches!(result, McpMutationResult::Invalid { .. }));
        assert!(!store.path().exists());

        let result = store
            .delete(
                DeleteMcpServerParams {
                    expected_config_digest: initial.config_digest,
                    name: "missing".to_string(),
                },
                &active_agents(),
            )
            .unwrap();
        assert!(matches!(result, McpMutationResult::Ok { .. }));
        assert!(!store.path().exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn disabled_import_keeps_redacted_field_names_and_cannot_enable_early() {
        let (root, store) = temporary_store("incomplete-import");
        let initial = store.get(&active_agents()).unwrap();
        let imported = store
            .commit_import(
                CommitMcpImportParams {
                    expected_config_digest: initial.config_digest,
                    selections: vec![McpImportSelection {
                        candidate_id: "candidate-1".to_string(),
                        action: McpImportAction::Create,
                        name: "private-docs".to_string(),
                        definition: McpServerInput::Stdio {
                            enabled: false,
                            agent_profile_ids: vec!["agent-muwa".to_string()],
                            command: "node".to_string(),
                            args: vec!["server.js".to_string()],
                            cwd: None,
                            env: BTreeMap::new(),
                            missing_values: vec!["env.API_TOKEN".to_string()],
                        },
                        accept_all_tools: false,
                        has_nonportable_tool_filter: false,
                        has_blocking_issues: false,
                    }],
                },
                &active_agents(),
            )
            .unwrap();
        let McpMutationResult::Ok {
            config_digest,
            config,
        } = imported
        else {
            panic!("disabled incomplete import should be saved");
        };
        let McpServerView::Stdio {
            enabled,
            missing_values,
            ..
        } = &config.servers[0]
        else {
            panic!("expected stdio");
        };
        assert!(!enabled);
        assert_eq!(missing_values, &["env.API_TOKEN"]);
        let enable = store
            .set_enabled(
                SetMcpServerEnabledParams {
                    expected_config_digest: config_digest,
                    name: "private-docs".to_string(),
                    enabled: true,
                },
                &active_agents(),
            )
            .unwrap();
        assert!(matches!(enable, McpMutationResult::Invalid { .. }));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn import_replace_preserves_existing_enablement_and_assignments() {
        let (root, store) = temporary_store("replace-import");
        let initial = store.get(&active_agents()).unwrap();
        let created = store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: initial.config_digest,
                    name: "docs".to_string(),
                    definition: McpServerInput::Stdio {
                        enabled: false,
                        agent_profile_ids: vec!["agent-luoke".to_string()],
                        command: "old".to_string(),
                        args: Vec::new(),
                        cwd: None,
                        env: BTreeMap::new(),
                        missing_values: Vec::new(),
                    },
                },
                &active_agents(),
            )
            .unwrap();
        let McpMutationResult::Ok { config_digest, .. } = created else {
            panic!("create should succeed");
        };
        let replaced = store
            .commit_import(
                CommitMcpImportParams {
                    expected_config_digest: config_digest,
                    selections: vec![McpImportSelection {
                        candidate_id: "candidate-2".to_string(),
                        action: McpImportAction::Replace,
                        name: "docs".to_string(),
                        definition: McpServerInput::Stdio {
                            enabled: true,
                            agent_profile_ids: vec!["agent-muwa".to_string()],
                            command: "new".to_string(),
                            args: vec!["server.js".to_string()],
                            cwd: None,
                            env: BTreeMap::new(),
                            missing_values: Vec::new(),
                        },
                        accept_all_tools: false,
                        has_nonportable_tool_filter: false,
                        has_blocking_issues: false,
                    }],
                },
                &active_agents(),
            )
            .unwrap();
        let McpMutationResult::Ok { config, .. } = replaced else {
            panic!("replace should succeed");
        };
        let McpServerView::Stdio {
            enabled,
            agent_profile_ids,
            command,
            ..
        } = &config.servers[0]
        else {
            panic!("expected stdio");
        };
        assert!(!enabled);
        assert_eq!(agent_profile_ids, &["agent-luoke"]);
        assert_eq!(command, "new");
        let _ = fs::remove_dir_all(root);
    }
}
