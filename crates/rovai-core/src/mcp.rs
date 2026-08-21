use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::{
    fs::{File, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
};

use anyhow::{Context, Result};
use serde::{
    Deserialize, Deserializer, Serialize,
    de::{DeserializeOwned, Error as DeError, MapAccess, SeqAccess, Visitor},
};
use serde_json::{Number, Value};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

#[cfg(windows)]
use crate::platform::private_storage::{
    atomic_write_private_bytes, create_private_bytes, open_private_read_file,
    repair_private_directory, repair_private_file,
};

pub const MCP_SCHEMA_VERSION: u32 = 2;
pub const PRESERVE_STORED_VALUE_MARKER: &str = "__ROVAI_PRESERVE_STORED_VALUE__";
const READ_ONLY_MASK: &str = "********";
const MAX_CONFIG_BYTES: u64 = 1024 * 1024;
const MAX_SERVERS: usize = 128;
const MAX_ARGUMENTS: usize = 256;
const MAX_MAP_ENTRIES: usize = 128;
const MAX_STRING_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpConfigFile {
    #[serde(default)]
    pub mcp_servers: BTreeMap<String, McpServerDefinition>,
    #[serde(rename = "_rovai")]
    pub rovai: McpRovaiMetadata,
}

impl McpConfigFile {
    fn empty() -> Self {
        Self {
            mcp_servers: BTreeMap::new(),
            rovai: McpRovaiMetadata {
                schema_version: MCP_SCHEMA_VERSION,
                servers: BTreeMap::new(),
                assignments: Vec::new(),
            },
        }
    }

    fn metadata_by_id(&self, server_id: &str) -> Option<(&String, &McpServerMetadata)> {
        self.rovai
            .servers
            .iter()
            .find(|(_, metadata)| metadata.server_id == server_id)
    }

    fn metadata_by_id_mut(&mut self, server_id: &str) -> Option<(String, &mut McpServerMetadata)> {
        let name =
            self.rovai.servers.iter().find_map(|(name, metadata)| {
                (metadata.server_id == server_id).then(|| name.clone())
            })?;
        let metadata = self.rovai.servers.get_mut(&name)?;
        Some((name, metadata))
    }

    fn assignment_ids(&self, server_id: &str) -> Vec<String> {
        self.rovai
            .assignments
            .iter()
            .filter(|assignment| assignment.server_id == server_id)
            .map(|assignment| assignment.agent_id.clone())
            .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpRovaiMetadata {
    pub schema_version: u32,
    pub servers: BTreeMap<String, McpServerMetadata>,
    #[serde(default)]
    pub assignments: Vec<McpAssignment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpServerMetadata {
    pub server_id: String,
    pub enabled: bool,
    pub source: McpServerSource,
    pub risk_level: McpRiskLevel,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub risk_acknowledged: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpServerSource {
    User,
    Import,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpRiskLevel {
    Standard,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpAssignment {
    pub server_id: String,
    pub agent_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged, rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum McpServerDefinition {
    Stdio {
        command: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        args: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        env: BTreeMap<String, String>,
    },
    StreamableHttp {
        url: String,
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        headers: BTreeMap<String, String>,
    },
}

impl McpServerDefinition {
    pub fn transport_name(&self) -> &'static str {
        match self {
            Self::Stdio { .. } => "stdio",
            Self::StreamableHttp { .. } => "streamable_http",
        }
    }

    pub fn endpoint_summary(&self) -> String {
        match self {
            Self::Stdio { command, args, .. } => std::iter::once(command.as_str())
                .chain(args.iter().map(String::as_str))
                .collect::<Vec<_>>()
                .join(" "),
            Self::StreamableHttp { url, .. } => url.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerView {
    pub server_id: String,
    pub name: String,
    pub transport: String,
    pub endpoint: String,
    pub enabled: bool,
    pub assigned_agent_ids: Vec<String>,
    pub source: McpServerSource,
    pub risk_level: McpRiskLevel,
    pub risk_acknowledged: bool,
    pub definition_json: String,
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
    pub public_config_json: String,
    pub servers: Vec<McpServerView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_issue: Option<McpConfigIssue>,
    pub permission_issue: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum McpMutationResult {
    Ok {
        config_digest: String,
        config: Box<McpConfigView>,
    },
    Conflict {
        actual_config_digest: String,
    },
    Invalid {
        issues: Vec<McpConfigIssue>,
    },
    RiskAcknowledgementRequired {
        server_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateMcpServerParams {
    pub expected_config_digest: String,
    pub definition_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateMcpServerParams {
    pub expected_config_digest: String,
    pub server_id: String,
    pub definition_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetMcpServerEnabledParams {
    pub expected_config_digest: String,
    pub server_id: String,
    pub enabled: bool,
    #[serde(default)]
    pub acknowledge_high_risk: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetMcpAssignmentParams {
    pub expected_config_digest: String,
    pub server_id: String,
    pub agent_id: String,
    pub assigned: bool,
    #[serde(default)]
    pub acknowledge_high_risk: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteMcpServerParams {
    pub expected_config_digest: String,
    pub server_id: String,
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
    #[serde(default)]
    pub replace_server_id: Option<String>,
    pub definition_json: String,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpConfigMigrationOutcome {
    Missing,
    Unchanged,
    Migrated,
    ResetInvalid,
}

struct LoadedConfig {
    exists: bool,
    digest: String,
    config: Option<McpConfigFile>,
    file_issue: Option<McpConfigIssue>,
    permission_issue: bool,
}

enum MutationError {
    Invalid(Vec<McpConfigIssue>),
    RiskAcknowledgementRequired(String),
}

impl McpConfigStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn default_path() -> Result<PathBuf> {
        let home = dirs::home_dir()
            .context("could not determine the home directory for ~/.rovai/mcp.json")?;
        Ok(home.join(".rovai").join("mcp.json"))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn migrate_pre_release_config(&self) -> Result<McpConfigMigrationOutcome> {
        let metadata = match fs::symlink_metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(McpConfigMigrationOutcome::Missing);
            }
            Err(error) => return Err(error).context("failed to inspect pre-release MCP config"),
        };
        if !metadata.file_type().is_file() || metadata.len() > MAX_CONFIG_BYTES {
            fs::remove_file(&self.path).with_context(|| {
                format!(
                    "failed to remove unsupported pre-release MCP config {}",
                    self.path.display()
                )
            })?;
            return Ok(McpConfigMigrationOutcome::ResetInvalid);
        }

        let bytes = fs::read(&self.path)
            .with_context(|| format!("failed to read MCP config {}", self.path.display()))?;
        let mut document = match parse_json_no_duplicates::<Value>(&bytes) {
            Ok(Value::Object(document)) => document,
            Ok(_) | Err(_) => return self.reset_invalid_pre_release_config(),
        };
        let Some(Value::Object(mut mcp_servers)) = document.remove("mcpServers") else {
            return self.reset_invalid_pre_release_config();
        };
        let Some(Value::Object(mut rovai)) = document.remove("_rovai") else {
            return self.reset_invalid_pre_release_config();
        };
        let Some(Value::Object(server_metadata)) = rovai.get_mut("servers") else {
            return self.reset_invalid_pre_release_config();
        };

        let mut changed = false;
        let mut builtin_names = BTreeSet::new();
        let mut builtin_server_ids = BTreeSet::new();
        for (name, metadata) in server_metadata.iter_mut() {
            let Value::Object(metadata) = metadata else {
                continue;
            };
            if metadata.remove("presetId").is_some() {
                changed = true;
            }
            if metadata.get("source").and_then(Value::as_str) == Some("builtin") {
                builtin_names.insert(name.clone());
                if let Some(server_id) = metadata.get("serverId").and_then(Value::as_str) {
                    builtin_server_ids.insert(server_id.to_string());
                }
            }
        }
        if !builtin_names.is_empty() {
            changed = true;
            for name in &builtin_names {
                mcp_servers.remove(name);
                server_metadata.remove(name);
            }
            let Some(Value::Array(assignments)) = rovai.get_mut("assignments") else {
                return self.reset_invalid_pre_release_config();
            };
            assignments.retain(|assignment| {
                let server_id = assignment.get("serverId").and_then(Value::as_str);
                server_id.is_none() || server_id.is_some_and(|id| !builtin_server_ids.contains(id))
            });
        }

        document.insert("mcpServers".to_string(), Value::Object(mcp_servers));
        document.insert("_rovai".to_string(), Value::Object(rovai));
        let mut config = match serde_json::from_value::<McpConfigFile>(Value::Object(document)) {
            Ok(config) => config,
            Err(_) => return self.reset_invalid_pre_release_config(),
        };
        normalize_config(&mut config);
        if !validate_config(&config).is_empty() {
            return self.reset_invalid_pre_release_config();
        }
        if !changed {
            return Ok(McpConfigMigrationOutcome::Unchanged);
        }
        self.write(&config)?;
        Ok(McpConfigMigrationOutcome::Migrated)
    }

    fn reset_invalid_pre_release_config(&self) -> Result<McpConfigMigrationOutcome> {
        fs::remove_file(&self.path).with_context(|| {
            format!(
                "failed to remove invalid pre-release MCP config {}",
                self.path.display()
            )
        })?;
        Ok(McpConfigMigrationOutcome::ResetInvalid)
    }

    pub fn migrate_agent_ids(&self, mappings: &BTreeMap<String, String>) -> Result<bool> {
        if mappings.is_empty() || !self.path.exists() {
            return Ok(false);
        }
        let loaded = self.load()?;
        let mut config = loaded.config.with_context(|| {
            loaded
                .file_issue
                .map(|issue| format!("cannot migrate MCP Assignments: {}", issue.message))
                .unwrap_or_else(|| {
                    "cannot migrate MCP Assignments from an invalid file".to_string()
                })
        })?;
        let mut changed = false;
        for assignment in &mut config.rovai.assignments {
            if let Some(current) = mappings.get(&assignment.agent_id) {
                assignment.agent_id = current.clone();
                changed = true;
            }
        }
        if !changed {
            return Ok(false);
        }
        normalize_config(&mut config);
        let issues = validate_config(&config);
        if let Some(issue) = issues.into_iter().next() {
            anyhow::bail!(
                "MCP Assignment migration produced invalid config: {}",
                issue.message
            );
        }
        self.write(&config)?;
        Ok(true)
    }

    pub fn get(&self, known_agent_ids: &BTreeSet<String>) -> Result<McpConfigView> {
        let loaded = self.load_or_initialize()?;
        self.view(&loaded, known_agent_ids)
    }

    /// Inspect the MCP configuration without creating defaults or changing bytes or modes.
    /// Diagnostics must use this path so a read-only self-check remains genuinely read-only.
    pub fn inspect(&self, known_agent_ids: &BTreeSet<String>) -> Result<McpConfigView> {
        let loaded = self.load()?;
        self.view(&loaded, known_agent_ids)
    }

    pub fn repair_permissions(&self) -> Result<()> {
        #[cfg(windows)]
        {
            if let Some(parent) = self.path.parent()
                && parent.exists()
            {
                repair_private_directory(parent).with_context(|| {
                    format!("failed to restrict MCP directory {}", parent.display())
                })?;
            }
            if self.path.exists() {
                repair_private_file(&self.path).with_context(|| {
                    format!("failed to restrict MCP config {}", self.path.display())
                })?;
            }
            Ok(())
        }
        #[cfg(unix)]
        {
            if let Some(parent) = self.path.parent()
                && parent.exists()
            {
                fs::set_permissions(parent, fs::Permissions::from_mode(0o700)).with_context(
                    || format!("failed to restrict MCP directory {}", parent.display()),
                )?;
            }
            if self.path.exists() {
                fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600)).with_context(
                    || format!("failed to restrict MCP config {}", self.path.display()),
                )?;
            }
            Ok(())
        }
        #[cfg(not(any(unix, windows)))]
        {
            anyhow::bail!("private MCP storage is unsupported on this platform")
        }
    }

    pub fn create(
        &self,
        params: CreateMcpServerParams,
        known_agent_ids: &BTreeSet<String>,
    ) -> Result<McpMutationResult> {
        self.mutate(&params.expected_config_digest, known_agent_ids, |config| {
            let (name, definition) = parse_single_public_entry(
                &params.definition_json,
                None,
                &params.expected_config_digest,
            )
            .map_err(MutationError::Invalid)?;
            if config
                .mcp_servers
                .keys()
                .any(|current| current.eq_ignore_ascii_case(&name))
            {
                return Err(MutationError::Invalid(vec![McpConfigIssue::new(
                    "mcp.name_conflict",
                    "An MCP Server with this name already exists",
                    Some("mcpServers".to_string()),
                )]));
            }
            config.mcp_servers.insert(name.clone(), definition);
            config.rovai.servers.insert(
                name,
                McpServerMetadata {
                    server_id: Uuid::new_v4().to_string(),
                    enabled: false,
                    source: McpServerSource::User,
                    risk_level: McpRiskLevel::Standard,
                    risk_acknowledged: false,
                },
            );
            Ok(true)
        })
    }

    pub fn update(
        &self,
        params: UpdateMcpServerParams,
        known_agent_ids: &BTreeSet<String>,
    ) -> Result<McpMutationResult> {
        self.mutate(&params.expected_config_digest, known_agent_ids, |config| {
            let Some((old_name, metadata)) = config
                .metadata_by_id(&params.server_id)
                .map(|(name, metadata)| (name.clone(), metadata.clone()))
            else {
                return Err(MutationError::Invalid(vec![McpConfigIssue::new(
                    "mcp.not_found",
                    "The MCP Server no longer exists",
                    Some("serverId".to_string()),
                )]));
            };
            let old_definition = config.mcp_servers.get(&old_name).ok_or_else(|| {
                MutationError::Invalid(vec![McpConfigIssue::new(
                    "mcp.metadata_parity_invalid",
                    "MCP Server metadata no longer matches its definition",
                    Some("_rovai.servers".to_string()),
                )])
            })?;
            let (new_name, definition) = parse_single_public_entry(
                &params.definition_json,
                Some(old_definition),
                &params.expected_config_digest,
            )
            .map_err(MutationError::Invalid)?;
            if config
                .mcp_servers
                .keys()
                .any(|current| current != &old_name && current.eq_ignore_ascii_case(&new_name))
            {
                return Err(MutationError::Invalid(vec![McpConfigIssue::new(
                    "mcp.name_conflict",
                    "An MCP Server with this name already exists",
                    Some("mcpServers".to_string()),
                )]));
            }
            if old_name == new_name && config.mcp_servers.get(&old_name) == Some(&definition) {
                return Ok(false);
            }
            config.mcp_servers.remove(&old_name);
            config.rovai.servers.remove(&old_name);
            config.mcp_servers.insert(new_name.clone(), definition);
            config.rovai.servers.insert(new_name, metadata);
            Ok(true)
        })
    }

    pub fn set_enabled(
        &self,
        params: SetMcpServerEnabledParams,
        known_agent_ids: &BTreeSet<String>,
    ) -> Result<McpMutationResult> {
        self.mutate(&params.expected_config_digest, known_agent_ids, |config| {
            let assignments_exist = config
                .rovai
                .assignments
                .iter()
                .any(|assignment| assignment.server_id == params.server_id);
            let Some((_, metadata)) = config.metadata_by_id_mut(&params.server_id) else {
                return Err(MutationError::Invalid(vec![McpConfigIssue::new(
                    "mcp.not_found",
                    "The MCP Server no longer exists",
                    Some("serverId".to_string()),
                )]));
            };
            if metadata.enabled == params.enabled {
                return Ok(false);
            }
            if params.enabled
                && assignments_exist
                && metadata.risk_level == McpRiskLevel::High
                && !metadata.risk_acknowledged
            {
                if !params.acknowledge_high_risk {
                    return Err(MutationError::RiskAcknowledgementRequired(
                        params.server_id.clone(),
                    ));
                }
                metadata.risk_acknowledged = true;
            }
            metadata.enabled = params.enabled;
            Ok(true)
        })
    }

    pub fn set_assignment(
        &self,
        params: SetMcpAssignmentParams,
        known_agent_ids: &BTreeSet<String>,
    ) -> Result<McpMutationResult> {
        self.mutate(&params.expected_config_digest, known_agent_ids, |config| {
            if !known_agent_ids.contains(&params.agent_id) {
                return Err(MutationError::Invalid(vec![McpConfigIssue::new(
                    "mcp.unknown_agent_profile",
                    "The AgentProfile no longer exists",
                    Some("agentId".to_string()),
                )]));
            }
            let Some((_, metadata)) = config
                .metadata_by_id(&params.server_id)
                .map(|(name, metadata)| (name.clone(), metadata.clone()))
            else {
                return Err(MutationError::Invalid(vec![McpConfigIssue::new(
                    "mcp.not_found",
                    "The MCP Server no longer exists",
                    Some("serverId".to_string()),
                )]));
            };
            let assignment = McpAssignment {
                server_id: params.server_id.clone(),
                agent_id: params.agent_id.clone(),
            };
            let exists = config.rovai.assignments.contains(&assignment);
            if exists == params.assigned {
                return Ok(false);
            }
            if params.assigned
                && metadata.enabled
                && metadata.risk_level == McpRiskLevel::High
                && !metadata.risk_acknowledged
            {
                if !params.acknowledge_high_risk {
                    return Err(MutationError::RiskAcknowledgementRequired(
                        params.server_id.clone(),
                    ));
                }
                config
                    .metadata_by_id_mut(&params.server_id)
                    .expect("metadata was resolved")
                    .1
                    .risk_acknowledged = true;
            }
            if params.assigned {
                config.rovai.assignments.push(assignment);
            } else {
                config
                    .rovai
                    .assignments
                    .retain(|current| current != &assignment);
            }
            Ok(true)
        })
    }

    pub fn delete(
        &self,
        params: DeleteMcpServerParams,
        known_agent_ids: &BTreeSet<String>,
    ) -> Result<McpMutationResult> {
        self.mutate(&params.expected_config_digest, known_agent_ids, |config| {
            let Some((name, _)) = config
                .metadata_by_id(&params.server_id)
                .map(|(name, metadata)| (name.clone(), metadata.clone()))
            else {
                return Ok(false);
            };
            config.mcp_servers.remove(&name);
            config.rovai.servers.remove(&name);
            config
                .rovai
                .assignments
                .retain(|assignment| assignment.server_id != params.server_id);
            Ok(true)
        })
    }

    pub fn commit_import(
        &self,
        params: CommitMcpImportParams,
        known_agent_ids: &BTreeSet<String>,
    ) -> Result<McpMutationResult> {
        self.mutate(&params.expected_config_digest, known_agent_ids, |config| {
            if params.selections.is_empty() {
                return Ok(false);
            }
            let mut parsed = Vec::new();
            let mut requested_names = BTreeSet::new();
            for selection in params.selections {
                if selection.has_blocking_issues {
                    return Err(MutationError::Invalid(vec![McpConfigIssue::new(
                        "mcp.import_candidate_unsupported",
                        "Unsupported import candidates cannot be committed",
                        Some("candidateId".to_string()),
                    )]));
                }
                let existing = selection
                    .replace_server_id
                    .as_deref()
                    .and_then(|id| config.metadata_by_id(id))
                    .and_then(|(name, _)| config.mcp_servers.get(name));
                let (name, definition) = parse_single_public_entry(
                    &selection.definition_json,
                    existing,
                    &params.expected_config_digest,
                )
                .map_err(MutationError::Invalid)?;
                if !requested_names.insert(name.to_ascii_lowercase()) {
                    return Err(MutationError::Invalid(vec![McpConfigIssue::new(
                        "mcp.import_duplicate_name",
                        "Import selections contain the same destination name",
                        Some("mcpServers".to_string()),
                    )]));
                }
                parsed.push((selection, name, definition));
            }
            for (selection, name, definition) in parsed {
                match selection.action {
                    McpImportAction::Create => {
                        if config
                            .mcp_servers
                            .keys()
                            .any(|current| current.eq_ignore_ascii_case(&name))
                        {
                            return Err(MutationError::Invalid(vec![McpConfigIssue::new(
                                "mcp.name_conflict",
                                "An MCP Server with this name already exists",
                                Some("mcpServers".to_string()),
                            )]));
                        }
                        config.mcp_servers.insert(name.clone(), definition);
                        config.rovai.servers.insert(
                            name,
                            McpServerMetadata {
                                server_id: Uuid::new_v4().to_string(),
                                enabled: false,
                                source: McpServerSource::Import,
                                risk_level: McpRiskLevel::Standard,
                                risk_acknowledged: false,
                            },
                        );
                    }
                    McpImportAction::Replace => {
                        let Some(server_id) = selection.replace_server_id else {
                            return Err(MutationError::Invalid(vec![McpConfigIssue::new(
                                "mcp.replace_target_missing",
                                "Replace requires a target Server",
                                Some("replaceServerId".to_string()),
                            )]));
                        };
                        let Some((old_name, metadata)) = config
                            .metadata_by_id(&server_id)
                            .map(|(name, metadata)| (name.clone(), metadata.clone()))
                        else {
                            return Err(MutationError::Invalid(vec![McpConfigIssue::new(
                                "mcp.replace_target_missing",
                                "The MCP Server selected for replacement no longer exists",
                                Some("replaceServerId".to_string()),
                            )]));
                        };
                        if config.mcp_servers.keys().any(|current| {
                            current != &old_name && current.eq_ignore_ascii_case(&name)
                        }) {
                            return Err(MutationError::Invalid(vec![McpConfigIssue::new(
                                "mcp.name_conflict",
                                "An MCP Server with this name already exists",
                                Some("mcpServers".to_string()),
                            )]));
                        }
                        config.mcp_servers.remove(&old_name);
                        config.rovai.servers.remove(&old_name);
                        config.mcp_servers.insert(name.clone(), definition);
                        config.rovai.servers.insert(name, metadata);
                    }
                }
            }
            Ok(true)
        })
    }

    pub(crate) fn get_with_raw(
        &self,
        known_agent_ids: &BTreeSet<String>,
    ) -> Result<(McpConfigView, Option<McpConfigFile>)> {
        let loaded = self.load_or_initialize()?;
        let view = self.view(&loaded, known_agent_ids)?;
        Ok((view, loaded.config))
    }

    fn mutate(
        &self,
        expected_digest: &str,
        known_agent_ids: &BTreeSet<String>,
        mutation: impl FnOnce(&mut McpConfigFile) -> std::result::Result<bool, MutationError>,
    ) -> Result<McpMutationResult> {
        let loaded = self.load_or_initialize()?;
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
        prune_unknown_assignments(&mut config, known_agent_ids);
        let changed = match mutation(&mut config) {
            Ok(changed) => changed,
            Err(MutationError::Invalid(issues)) => {
                return Ok(McpMutationResult::Invalid { issues });
            }
            Err(MutationError::RiskAcknowledgementRequired(server_id)) => {
                return Ok(McpMutationResult::RiskAcknowledgementRequired { server_id });
            }
        };
        normalize_config(&mut config);
        let issues = validate_config(&config);
        if !issues.is_empty() {
            return Ok(McpMutationResult::Invalid { issues });
        }
        if !changed && loaded.config.as_ref() == Some(&config) {
            let config = self.view(&loaded, known_agent_ids)?;
            return Ok(McpMutationResult::Ok {
                config_digest: loaded.digest,
                config: Box::new(config),
            });
        }
        self.write(&config)?;
        let reloaded = self.load()?;
        let view = self.view(&reloaded, known_agent_ids)?;
        Ok(McpMutationResult::Ok {
            config_digest: reloaded.digest,
            config: Box::new(view),
        })
    }

    fn load_or_initialize(&self) -> Result<LoadedConfig> {
        if !self.path.exists() {
            self.write_new(&McpConfigFile::empty())?;
        }
        self.load()
    }

    fn load(&self) -> Result<LoadedConfig> {
        if !self.path.exists() {
            return Ok(LoadedConfig {
                exists: false,
                digest: "sha256:missing-mcp-config".to_string(),
                config: None,
                file_issue: Some(McpConfigIssue::new(
                    "mcp.config_missing",
                    "MCP configuration does not exist",
                    None,
                )),
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
                permission_issue: private_permission_issue(&self.path, &metadata)?,
            });
        }
        let bytes = fs::read(&self.path)
            .with_context(|| format!("failed to read MCP config {}", self.path.display()))?;
        let digest = bytes_digest(&bytes);
        let permission_issue = private_permission_issue(&self.path, &metadata)?;
        let mut config = match parse_json_no_duplicates::<McpConfigFile>(&bytes) {
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
        known_agent_ids: &BTreeSet<String>,
    ) -> Result<McpConfigView> {
        let (servers, public_config_json) = if let Some(config) = loaded.config.as_ref() {
            let servers = config
                .mcp_servers
                .iter()
                .map(|(name, definition)| -> Result<McpServerView> {
                    let metadata = config
                        .rovai
                        .servers
                        .get(name)
                        .context("MCP metadata parity was lost")?;
                    let assigned_agent_ids = config
                        .assignment_ids(&metadata.server_id)
                        .into_iter()
                        .filter(|id| known_agent_ids.contains(id))
                        .collect();
                    Ok(McpServerView {
                        server_id: metadata.server_id.clone(),
                        name: name.clone(),
                        transport: definition.transport_name().to_string(),
                        endpoint: definition.endpoint_summary(),
                        enabled: metadata.enabled,
                        assigned_agent_ids,
                        source: metadata.source,
                        risk_level: metadata.risk_level,
                        risk_acknowledged: metadata.risk_acknowledged,
                        definition_json: single_public_json(name, definition, true)?,
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            (servers, public_json(config, true)?)
        } else {
            (Vec::new(), String::new())
        };
        Ok(McpConfigView {
            path: self.path.to_string_lossy().to_string(),
            exists: loaded.exists,
            config_digest: loaded.digest.clone(),
            public_config_json,
            servers,
            file_issue: loaded.file_issue.clone(),
            permission_issue: loaded.permission_issue,
        })
    }

    #[cfg(unix)]
    fn write_new(&self, config: &McpConfigFile) -> Result<()> {
        let parent = self
            .path
            .parent()
            .context("MCP configuration path has no parent directory")?;
        fs::create_dir_all(parent)?;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
        let bytes = canonical_bytes(config)?;
        let temporary = parent.join(format!(".mcp-init-{}.tmp", Uuid::new_v4()));
        write_private_file(&temporary, &bytes)?;
        match fs::hard_link(&temporary, &self.path) {
            Ok(()) => {
                fs::remove_file(&temporary)?;
                fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600))?;
                File::open(parent)?.sync_all()?;
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let _ = fs::remove_file(&temporary);
                Ok(())
            }
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                Err(error).with_context(|| {
                    format!("failed to initialize MCP config {}", self.path.display())
                })
            }
        }
    }

    #[cfg(windows)]
    fn write_new(&self, config: &McpConfigFile) -> Result<()> {
        let bytes = canonical_bytes(config)?;
        match create_private_bytes(&self.path, &bytes) {
            Ok(()) => Ok(()),
            Err(_error) if self.path.exists() => {
                drop(open_private_read_file(&self.path)?);
                Ok(())
            }
            Err(error) => Err(error).with_context(|| {
                format!("failed to initialize MCP config {}", self.path.display())
            }),
        }
    }

    #[cfg(unix)]
    fn write(&self, config: &McpConfigFile) -> Result<()> {
        let parent = self
            .path
            .parent()
            .context("MCP configuration path has no parent directory")?;
        fs::create_dir_all(parent)?;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
        let bytes = canonical_bytes(config)?;
        let temporary = parent.join(format!(".mcp-{}.tmp", Uuid::new_v4()));
        write_private_file(&temporary, &bytes)?;
        let result = (|| -> Result<()> {
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

    #[cfg(windows)]
    fn write(&self, config: &McpConfigFile) -> Result<()> {
        atomic_write_private_bytes(&self.path, &canonical_bytes(config)?).with_context(|| {
            format!(
                "failed to atomically replace MCP config {}",
                self.path.display()
            )
        })
    }

    #[cfg(not(any(unix, windows)))]
    fn write_new(&self, _config: &McpConfigFile) -> Result<()> {
        anyhow::bail!("private MCP storage is unsupported on this platform")
    }

    #[cfg(not(any(unix, windows)))]
    fn write(&self, _config: &McpConfigFile) -> Result<()> {
        anyhow::bail!("private MCP storage is unsupported on this platform")
    }
}

#[cfg(unix)]
fn write_private_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(unix)]
fn private_permission_issue(_path: &Path, metadata: &fs::Metadata) -> Result<bool> {
    Ok(metadata.permissions().mode() & 0o077 != 0)
}

#[cfg(windows)]
fn private_permission_issue(path: &Path, _metadata: &fs::Metadata) -> Result<bool> {
    Ok(open_private_read_file(path).is_err())
}

#[cfg(not(any(unix, windows)))]
fn private_permission_issue(_path: &Path, _metadata: &fs::Metadata) -> Result<bool> {
    anyhow::bail!("private MCP storage is unsupported on this platform")
}

fn parse_single_public_entry(
    text: &str,
    existing: Option<&McpServerDefinition>,
    expected_digest: &str,
) -> std::result::Result<(String, McpServerDefinition), Vec<McpConfigIssue>> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct PublicDocument {
        mcp_servers: BTreeMap<String, McpServerDefinition>,
    }
    let mut document =
        parse_json_no_duplicates::<PublicDocument>(text.as_bytes()).map_err(|error| {
            vec![McpConfigIssue {
                code: "mcp.definition_json_invalid".to_string(),
                message: error.to_string(),
                field: None,
                line: Some(error.line()),
                column: Some(error.column()),
            }]
        })?;
    if document.mcp_servers.len() != 1 {
        return Err(vec![McpConfigIssue::new(
            "mcp.single_entry_required",
            "The editor must contain exactly one mcpServers entry",
            Some("mcpServers".to_string()),
        )]);
    }
    let (name, mut definition) = document.mcp_servers.pop_first().expect("one entry exists");
    let mut issues = validate_server_name(&name);
    materialize_preserved_values(&mut definition, existing, expected_digest, &mut issues);
    issues.extend(validate_definition(&definition));
    if issues.is_empty() {
        Ok((name, definition))
    } else {
        Err(issues)
    }
}

fn materialize_preserved_values(
    definition: &mut McpServerDefinition,
    existing: Option<&McpServerDefinition>,
    expected_digest: &str,
    issues: &mut Vec<McpConfigIssue>,
) {
    let preserve_map = |values: &mut BTreeMap<String, String>,
                        stored: Option<&BTreeMap<String, String>>,
                        field: &str,
                        issues: &mut Vec<McpConfigIssue>| {
        for (key, value) in values.iter_mut() {
            if value != PRESERVE_STORED_VALUE_MARKER {
                continue;
            }
            let replacement = stored.and_then(|stored| stored.get(key)).cloned();
            if let Some(replacement) = replacement {
                *value = replacement;
            } else {
                issues.push(McpConfigIssue::new(
                    "mcp.preserved_value_missing",
                    "The masked value no longer exists at this field and must be entered again",
                    Some(format!("{field}.{key}")),
                ));
            }
        }
    };
    match definition {
        McpServerDefinition::Stdio { env, .. } => {
            let stored = match existing {
                Some(McpServerDefinition::Stdio { env, .. }) => Some(env),
                _ => None,
            };
            preserve_map(env, stored, "env", issues);
        }
        McpServerDefinition::StreamableHttp { headers, .. } => {
            let stored = match existing {
                Some(McpServerDefinition::StreamableHttp { headers, .. }) => Some(headers),
                _ => None,
            };
            preserve_map(headers, stored, "headers", issues);
        }
    }
    if expected_digest.trim().is_empty() {
        issues.push(McpConfigIssue::new(
            "mcp.config_digest_required",
            "Sensitive-value preservation requires the current configuration digest",
            None,
        ));
    }
}

fn normalize_config(config: &mut McpConfigFile) {
    config.rovai.assignments.sort();
    config.rovai.assignments.dedup();
}

fn prune_unknown_assignments(config: &mut McpConfigFile, known_agent_ids: &BTreeSet<String>) {
    config
        .rovai
        .assignments
        .retain(|assignment| known_agent_ids.contains(&assignment.agent_id));
}

fn validate_config(config: &McpConfigFile) -> Vec<McpConfigIssue> {
    let mut issues = Vec::new();
    if config.rovai.schema_version != MCP_SCHEMA_VERSION {
        issues.push(McpConfigIssue::new(
            "mcp.unsupported_schema_version",
            format!(
                "Unsupported MCP schema version {}; expected {}",
                config.rovai.schema_version, MCP_SCHEMA_VERSION
            ),
            Some("_rovai.schemaVersion".to_string()),
        ));
    }
    if config.mcp_servers.len() > MAX_SERVERS {
        issues.push(McpConfigIssue::new(
            "mcp.too_many_servers",
            format!("MCP configuration may contain at most {MAX_SERVERS} Servers"),
            Some("mcpServers".to_string()),
        ));
    }
    let definition_names = config.mcp_servers.keys().collect::<BTreeSet<_>>();
    let metadata_names = config.rovai.servers.keys().collect::<BTreeSet<_>>();
    if definition_names != metadata_names {
        issues.push(McpConfigIssue::new(
            "mcp.metadata_parity_invalid",
            "mcpServers and _rovai.servers must contain exactly the same names",
            Some("_rovai.servers".to_string()),
        ));
    }
    let mut folded_names = BTreeSet::new();
    let mut server_ids = BTreeSet::new();
    for (name, definition) in &config.mcp_servers {
        issues.extend(validate_server_name(name));
        if !folded_names.insert(name.to_ascii_lowercase()) {
            issues.push(McpConfigIssue::new(
                "mcp.case_insensitive_name_conflict",
                "MCP Server names must be unique ignoring ASCII case",
                Some(format!("mcpServers.{name}")),
            ));
        }
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
        if let Some(metadata) = config.rovai.servers.get(name) {
            if Uuid::parse_str(&metadata.server_id).is_err() {
                issues.push(McpConfigIssue::new(
                    "mcp.server_id_invalid",
                    "MCP Server ID must be an opaque UUID",
                    Some(format!("_rovai.servers.{name}.serverId")),
                ));
            }
            if !server_ids.insert(metadata.server_id.clone()) {
                issues.push(McpConfigIssue::new(
                    "mcp.server_id_duplicate",
                    "MCP Server IDs must be unique",
                    Some(format!("_rovai.servers.{name}.serverId")),
                ));
            }
        }
    }
    let mut assignments = BTreeSet::new();
    for assignment in &config.rovai.assignments {
        if !server_ids.contains(&assignment.server_id) {
            issues.push(McpConfigIssue::new(
                "mcp.assignment_server_missing",
                "MCP Assignment references an unknown Server ID",
                Some("_rovai.assignments".to_string()),
            ));
        }
        if assignment.agent_id.trim().is_empty() {
            issues.push(McpConfigIssue::new(
                "mcp.assignment_agent_invalid",
                "MCP Assignment requires an Agent ID",
                Some("_rovai.assignments".to_string()),
            ));
        }
        if !assignments.insert((assignment.server_id.clone(), assignment.agent_id.clone())) {
            issues.push(McpConfigIssue::new(
                "mcp.assignment_duplicate",
                "MCP Assignments must be unique",
                Some("_rovai.assignments".to_string()),
            ));
        }
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
            Some("mcpServers".to_string()),
        ));
    }
    issues
}

fn validate_definition(definition: &McpServerDefinition) -> Vec<McpConfigIssue> {
    let mut issues = Vec::new();
    match definition {
        McpServerDefinition::Stdio {
            command,
            args,
            cwd,
            env,
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
        }
        McpServerDefinition::StreamableHttp { url, headers } => {
            match Url::parse(url) {
                Ok(url) if matches!(url.scheme(), "http" | "https") => {}
                _ => issues.push(McpConfigIssue::new(
                    "mcp.invalid_url",
                    "Streamable HTTP URL must use http or https",
                    Some("url".to_string()),
                )),
            }
            validate_map(headers, "headers", false, &mut issues);
        }
    }
    issues
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
        if value == PRESERVE_STORED_VALUE_MARKER {
            issues.push(McpConfigIssue::new(
                "mcp.preservation_marker_not_materialized",
                "Sensitive-value preservation markers cannot be persisted",
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

pub fn valid_environment_name(value: &str) -> bool {
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

fn single_public_json(
    name: &str,
    definition: &McpServerDefinition,
    redact: bool,
) -> Result<String> {
    let definition = if redact {
        redact_definition(definition, PRESERVE_STORED_VALUE_MARKER)
    } else {
        definition.clone()
    };
    let document = serde_json::json!({"mcpServers": {name: definition}});
    Ok(format!("{}\n", serde_json::to_string_pretty(&document)?))
}

fn public_json(config: &McpConfigFile, redact: bool) -> Result<String> {
    let servers = config
        .mcp_servers
        .iter()
        .map(|(name, definition)| {
            (
                name.clone(),
                if redact {
                    redact_definition(definition, READ_ONLY_MASK)
                } else {
                    definition.clone()
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    let document = serde_json::json!({"mcpServers": servers});
    Ok(format!("{}\n", serde_json::to_string_pretty(&document)?))
}

fn redact_definition(definition: &McpServerDefinition, masked_value: &str) -> McpServerDefinition {
    match definition {
        McpServerDefinition::Stdio {
            command,
            args,
            cwd,
            env,
        } => McpServerDefinition::Stdio {
            command: command.clone(),
            args: args.clone(),
            cwd: cwd.clone(),
            env: redact_values(env, false, masked_value),
        },
        McpServerDefinition::StreamableHttp { url, headers } => {
            McpServerDefinition::StreamableHttp {
                url: url.clone(),
                headers: redact_values(headers, true, masked_value),
            }
        }
    }
}

fn redact_values(
    values: &BTreeMap<String, String>,
    headers: bool,
    masked_value: &str,
) -> BTreeMap<String, String> {
    values
        .iter()
        .map(|(key, value)| {
            let sensitive =
                !contains_environment_reference(value) && (headers || sensitive_key(key));
            (
                key.clone(),
                if sensitive {
                    masked_value.to_string()
                } else {
                    value.clone()
                },
            )
        })
        .collect()
}

fn contains_environment_reference(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index + 3 <= bytes.len() {
        if bytes[index] == b'$'
            && bytes.get(index + 1) == Some(&b'{')
            && let Some(end) = value[index + 2..].find('}')
        {
            return valid_environment_name(&value[index + 2..index + 2 + end]);
        }
        index += 1;
    }
    false
}

fn sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_uppercase();
    ["TOKEN", "SECRET", "PASSWORD", "API_KEY", "AUTH", "COOKIE"]
        .iter()
        .any(|part| normalized.contains(part))
}

#[cfg(any(unix, windows))]
fn canonical_bytes(config: &McpConfigFile) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(config)?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn bytes_digest(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn parse_json_no_duplicates<T: DeserializeOwned>(bytes: &[u8]) -> serde_json::Result<T> {
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = NoDuplicateValue::deserialize(&mut deserializer)?.0;
    deserializer.end()?;
    serde_json::from_value(value)
}

struct NoDuplicateValue(Value);

impl<'de> Deserialize<'de> for NoDuplicateValue {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct NoDuplicateVisitor;

        impl<'de> Visitor<'de> for NoDuplicateVisitor {
            type Value = NoDuplicateValue;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("valid JSON without duplicate object keys")
            }

            fn visit_unit<E>(self) -> std::result::Result<Self::Value, E> {
                Ok(NoDuplicateValue(Value::Null))
            }

            fn visit_none<E>(self) -> std::result::Result<Self::Value, E> {
                Ok(NoDuplicateValue(Value::Null))
            }

            fn visit_bool<E>(self, value: bool) -> std::result::Result<Self::Value, E> {
                Ok(NoDuplicateValue(Value::Bool(value)))
            }

            fn visit_i64<E>(self, value: i64) -> std::result::Result<Self::Value, E> {
                Ok(NoDuplicateValue(Value::Number(Number::from(value))))
            }

            fn visit_u64<E>(self, value: u64) -> std::result::Result<Self::Value, E> {
                Ok(NoDuplicateValue(Value::Number(Number::from(value))))
            }

            fn visit_f64<E>(self, value: f64) -> std::result::Result<Self::Value, E>
            where
                E: DeError,
            {
                let number =
                    Number::from_f64(value).ok_or_else(|| E::custom("non-finite JSON number"))?;
                Ok(NoDuplicateValue(Value::Number(number)))
            }

            fn visit_str<E>(self, value: &str) -> std::result::Result<Self::Value, E> {
                Ok(NoDuplicateValue(Value::String(value.to_string())))
            }

            fn visit_string<E>(self, value: String) -> std::result::Result<Self::Value, E> {
                Ok(NoDuplicateValue(Value::String(value)))
            }

            fn visit_seq<A>(self, mut sequence: A) -> std::result::Result<Self::Value, A::Error>
            where
                A: SeqAccess<'de>,
            {
                let mut values = Vec::new();
                while let Some(value) = sequence.next_element::<NoDuplicateValue>()? {
                    values.push(value.0);
                }
                Ok(NoDuplicateValue(Value::Array(values)))
            }

            fn visit_map<A>(self, mut map: A) -> std::result::Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut values = serde_json::Map::new();
                while let Some(key) = map.next_key::<String>()? {
                    if values.contains_key(&key) {
                        return Err(A::Error::custom(format!(
                            "duplicate JSON object key {key:?}"
                        )));
                    }
                    let value = map.next_value::<NoDuplicateValue>()?;
                    values.insert(key, value.0);
                }
                Ok(NoDuplicateValue(Value::Object(values)))
            }
        }

        deserializer.deserialize_any(NoDuplicateVisitor)
    }
}

#[cfg(all(test, feature = "slow-tests"))]
mod slow_tests {
    use super::*;

    fn temporary_store(name: &str) -> (PathBuf, McpConfigStore) {
        let root = std::env::temp_dir().join(format!("rovai-mcp-{name}-{}", Uuid::new_v4()));
        let store = McpConfigStore::new(root.join(".rovai/mcp.json"));
        (root, store)
    }

    fn agents() -> BTreeSet<String> {
        ["agent_1".to_string(), "agent_2".to_string()]
            .into_iter()
            .collect()
    }

    fn write_raw_config(store: &McpConfigStore, bytes: &[u8]) {
        #[cfg(unix)]
        {
            fs::create_dir_all(store.path().parent().unwrap()).unwrap();
            fs::write(store.path(), bytes).unwrap();
        }
        #[cfg(windows)]
        create_private_bytes(store.path(), bytes).unwrap();
    }

    fn stdio_json(name: &str, command: &str) -> String {
        format!(r#"{{"mcpServers":{{"{name}":{{"command":"{command}","args":["server.js"]}}}}}}"#)
    }

    fn config_with_server(
        name: &str,
        source: McpServerSource,
        risk_level: McpRiskLevel,
    ) -> McpConfigFile {
        let mut config = McpConfigFile::empty();
        config.mcp_servers.insert(
            name.to_string(),
            McpServerDefinition::Stdio {
                command: "node".to_string(),
                args: vec!["server.js".to_string()],
                cwd: None,
                env: BTreeMap::new(),
            },
        );
        config.rovai.servers.insert(
            name.to_string(),
            McpServerMetadata {
                server_id: Uuid::new_v4().to_string(),
                enabled: false,
                source,
                risk_level,
                risk_acknowledged: false,
            },
        );
        config
    }

    #[test]
    fn missing_file_atomically_materializes_an_exact_empty_library() {
        let (root, store) = temporary_store("empty-default");
        assert_eq!(
            store.migrate_pre_release_config().unwrap(),
            McpConfigMigrationOutcome::Missing
        );
        assert!(!store.path().exists());
        let view = store.get(&agents()).unwrap();
        assert!(view.exists);
        assert!(view.servers.is_empty());
        assert_eq!(view.public_config_json, "{\n  \"mcpServers\": {}\n}\n");
        assert!(!view.public_config_json.contains("_rovai"));
        let raw = fs::read_to_string(store.path()).unwrap();
        assert_eq!(
            raw,
            "{\n  \"mcpServers\": {},\n  \"_rovai\": {\n    \"schemaVersion\": 2,\n    \"servers\": {},\n    \"assignments\": []\n  }\n}\n"
        );
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(store.path()).unwrap().permissions().mode() & 0o777,
            0o600
        );
        #[cfg(windows)]
        assert!(open_private_read_file(store.path()).is_ok());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_assignment_agent_ids_are_replaced_atomically_without_server_changes() {
        let (root, store) = temporary_store("agent-id-migration");
        let mut config = config_with_server("docs", McpServerSource::User, McpRiskLevel::Standard);
        let server_id = config
            .rovai
            .servers
            .values()
            .next()
            .unwrap()
            .server_id
            .clone();
        config.rovai.assignments = vec![McpAssignment {
            server_id: server_id.clone(),
            agent_id: "agent-muwa".to_string(),
        }];
        store.write_new(&config).unwrap();

        assert!(
            store
                .migrate_agent_ids(&BTreeMap::from([(
                    "agent-muwa".to_string(),
                    "agent_2".to_string(),
                )]))
                .unwrap()
        );
        let migrated = store.load().unwrap().config.unwrap();
        assert_eq!(migrated.mcp_servers, config.mcp_servers);
        assert_eq!(migrated.rovai.servers, config.rovai.servers);
        assert_eq!(
            migrated.rovai.assignments,
            [McpAssignment {
                server_id,
                agent_id: "agent_2".to_string(),
            }]
        );
        assert!(
            !store
                .migrate_agent_ids(&BTreeMap::from([(
                    "agent-muwa".to_string(),
                    "agent_2".to_string(),
                )]))
                .unwrap()
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn pre_release_migration_removes_only_builtin_sources_and_their_assignments() {
        let (root, store) = temporary_store("builtin-clean-break");
        write_raw_config(
            &store,
            br#"{
              "mcpServers": {
                "builtin-renamed": {"command": "custom-browser"},
                "context7": {"url": "https://user.example/mcp"},
                "playwright": {"command": "imported-browser"}
              },
              "_rovai": {
                "schemaVersion": 2,
                "servers": {
                  "builtin-renamed": {
                    "serverId": "11111111-1111-4111-8111-111111111111",
                    "enabled": true,
                    "source": "builtin",
                    "presetId": "playwright",
                    "riskLevel": "high",
                    "riskAcknowledged": true
                  },
                  "context7": {
                    "serverId": "22222222-2222-4222-8222-222222222222",
                    "enabled": true,
                    "source": "user",
                    "riskLevel": "standard"
                  },
                  "playwright": {
                    "serverId": "33333333-3333-4333-8333-333333333333",
                    "enabled": false,
                    "source": "import",
                    "riskLevel": "standard"
                  }
                },
                "assignments": [
                  {"serverId": "11111111-1111-4111-8111-111111111111", "agentId": "agent_1"},
                  {"serverId": "22222222-2222-4222-8222-222222222222", "agentId": "agent_1"},
                  {"serverId": "33333333-3333-4333-8333-333333333333", "agentId": "agent_2"}
                ]
              }
            }"#,
        );

        assert_eq!(
            store.migrate_pre_release_config().unwrap(),
            McpConfigMigrationOutcome::Migrated
        );
        let first_bytes = fs::read(store.path()).unwrap();
        let migrated = store.load().unwrap().config.unwrap();
        assert_eq!(
            migrated.mcp_servers.keys().cloned().collect::<Vec<_>>(),
            ["context7".to_string(), "playwright".to_string()]
        );
        assert_eq!(
            migrated.rovai.assignments,
            [
                McpAssignment {
                    server_id: "22222222-2222-4222-8222-222222222222".to_string(),
                    agent_id: "agent_1".to_string(),
                },
                McpAssignment {
                    server_id: "33333333-3333-4333-8333-333333333333".to_string(),
                    agent_id: "agent_2".to_string(),
                },
            ]
        );
        let raw = String::from_utf8(first_bytes.clone()).unwrap();
        assert!(!raw.contains("builtin-renamed"));
        assert!(!raw.contains("presetId"));
        assert_eq!(
            store.migrate_pre_release_config().unwrap(),
            McpConfigMigrationOutcome::Unchanged
        );
        assert_eq!(fs::read(store.path()).unwrap(), first_bytes);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn invalid_pre_release_config_is_removed_before_empty_initialization() {
        let (root, store) = temporary_store("invalid-clean-break");
        write_raw_config(&store, b"{broken");

        assert_eq!(
            store.migrate_pre_release_config().unwrap(),
            McpConfigMigrationOutcome::ResetInvalid
        );
        assert!(!store.path().exists());
        assert!(store.get(&agents()).unwrap().servers.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_and_rename_preserve_server_id_and_assignments() {
        let (root, store) = temporary_store("identity");
        let initial = store.get(&agents()).unwrap();
        let created = store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: initial.config_digest,
                    definition_json: stdio_json("docs", "node"),
                },
                &agents(),
            )
            .unwrap();
        let McpMutationResult::Ok { config, .. } = created else {
            panic!("create should succeed");
        };
        let server = config
            .servers
            .iter()
            .find(|server| server.name == "docs")
            .unwrap();
        let server_id = server.server_id.clone();
        let assigned = store
            .set_assignment(
                SetMcpAssignmentParams {
                    expected_config_digest: config.config_digest,
                    server_id: server_id.clone(),
                    agent_id: "agent_2".to_string(),
                    assigned: true,
                    acknowledge_high_risk: false,
                },
                &agents(),
            )
            .unwrap();
        let McpMutationResult::Ok { config, .. } = assigned else {
            panic!("assignment should succeed");
        };
        let renamed = store
            .update(
                UpdateMcpServerParams {
                    expected_config_digest: config.config_digest,
                    server_id: server_id.clone(),
                    definition_json: stdio_json("docs-renamed", "node"),
                },
                &agents(),
            )
            .unwrap();
        let McpMutationResult::Ok { config, .. } = renamed else {
            panic!("rename should succeed");
        };
        let server = config
            .servers
            .iter()
            .find(|server| server.name == "docs-renamed")
            .unwrap();
        assert_eq!(server.server_id, server_id);
        assert_eq!(server.assigned_agent_ids, ["agent_2"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_and_recreate_same_name_do_not_restore_identity_or_assignment() {
        let (root, store) = temporary_store("recreate");
        let initial = store.get(&agents()).unwrap();
        let created = store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: initial.config_digest,
                    definition_json: stdio_json("docs", "node"),
                },
                &agents(),
            )
            .unwrap();
        let McpMutationResult::Ok { config, .. } = created else {
            panic!();
        };
        let first = config
            .servers
            .iter()
            .find(|server| server.name == "docs")
            .unwrap();
        let first_id = first.server_id.clone();
        let deleted = store
            .delete(
                DeleteMcpServerParams {
                    expected_config_digest: config.config_digest,
                    server_id: first_id.clone(),
                },
                &agents(),
            )
            .unwrap();
        let McpMutationResult::Ok { config, .. } = deleted else {
            panic!();
        };
        let recreated = store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: config.config_digest,
                    definition_json: stdio_json("docs", "node"),
                },
                &agents(),
            )
            .unwrap();
        let McpMutationResult::Ok { config, .. } = recreated else {
            panic!();
        };
        let second = config
            .servers
            .iter()
            .find(|server| server.name == "docs")
            .unwrap();
        assert_ne!(second.server_id, first_id);
        assert!(second.assigned_agent_ids.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_keys_case_conflicts_and_unknown_definition_fields_fail_closed() {
        let duplicate = br#"{"mcpServers":{"docs":{"command":"a"},"docs":{"command":"b"}},"_rovai":{"schemaVersion":2,"servers":{},"assignments":[]}}"#;
        assert!(parse_json_no_duplicates::<McpConfigFile>(duplicate).is_err());

        let (root, store) = temporary_store("invalid-public");
        let initial = store.get(&agents()).unwrap();
        for invalid in [
            r#"{"mcpServers":{"docs":{"command":"node","type":"stdio"}}}"#,
            r#"{"mcpServers":{"docs":{"command":"node"},"Docs":{"command":"node"}}}"#,
        ] {
            let result = store
                .create(
                    CreateMcpServerParams {
                        expected_config_digest: initial.config_digest.clone(),
                        definition_json: invalid.to_string(),
                    },
                    &agents(),
                )
                .unwrap();
            assert!(matches!(result, McpMutationResult::Invalid { .. }));
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn sensitive_literal_is_masked_and_preserved_only_at_same_path() {
        let (root, store) = temporary_store("secret");
        let initial = store.get(&agents()).unwrap();
        let created = store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: initial.config_digest,
                    definition_json: r#"{"mcpServers":{"remote":{"url":"https://example.com/mcp","headers":{"Authorization":"Bearer secret"}}}}"#.to_string(),
                },
                &agents(),
            )
            .unwrap();
        let McpMutationResult::Ok { config, .. } = created else {
            panic!();
        };
        let server = config
            .servers
            .iter()
            .find(|server| server.name == "remote")
            .unwrap();
        assert!(
            server
                .definition_json
                .contains(PRESERVE_STORED_VALUE_MARKER)
        );
        assert!(!server.definition_json.contains("Bearer secret"));
        let updated = store
            .update(
                UpdateMcpServerParams {
                    expected_config_digest: config.config_digest,
                    server_id: server.server_id.clone(),
                    definition_json: server.definition_json.clone(),
                },
                &agents(),
            )
            .unwrap();
        assert!(matches!(updated, McpMutationResult::Ok { .. }));
        assert!(
            fs::read_to_string(store.path())
                .unwrap()
                .contains("Bearer secret")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn high_risk_requires_acknowledgement_only_when_first_effective() {
        let (root, store) = temporary_store("risk");
        store
            .write_new(&config_with_server(
                "browser",
                McpServerSource::User,
                McpRiskLevel::High,
            ))
            .unwrap();
        let initial = store.get(&agents()).unwrap();
        let browser = initial
            .servers
            .iter()
            .find(|server| server.name == "browser")
            .unwrap();
        let assigned = store
            .set_assignment(
                SetMcpAssignmentParams {
                    expected_config_digest: initial.config_digest,
                    server_id: browser.server_id.clone(),
                    agent_id: "agent_2".to_string(),
                    assigned: true,
                    acknowledge_high_risk: false,
                },
                &agents(),
            )
            .unwrap();
        let McpMutationResult::Ok { config, .. } = assigned else {
            panic!("disabled high-risk assignment is allowed");
        };
        let required = store
            .set_enabled(
                SetMcpServerEnabledParams {
                    expected_config_digest: config.config_digest.clone(),
                    server_id: browser.server_id.clone(),
                    enabled: true,
                    acknowledge_high_risk: false,
                },
                &agents(),
            )
            .unwrap();
        assert!(matches!(
            required,
            McpMutationResult::RiskAcknowledgementRequired { .. }
        ));
        let acknowledged = store
            .set_enabled(
                SetMcpServerEnabledParams {
                    expected_config_digest: config.config_digest,
                    server_id: browser.server_id.clone(),
                    enabled: true,
                    acknowledge_high_risk: true,
                },
                &agents(),
            )
            .unwrap();
        assert!(matches!(acknowledged, McpMutationResult::Ok { .. }));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn invalid_existing_bytes_are_preserved() {
        let (root, store) = temporary_store("invalid");
        write_raw_config(&store, b"{broken");
        let view = store.get(&agents()).unwrap();
        assert_eq!(
            view.file_issue.as_ref().map(|issue| issue.code.as_str()),
            Some("mcp.config_parse_failed")
        );
        assert_eq!(fs::read(store.path()).unwrap(), b"{broken");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn inspect_missing_config_is_strictly_read_only() {
        let (root, store) = temporary_store("inspect-missing");
        assert!(!store.path().exists());
        let view = store.inspect(&agents()).unwrap();
        assert!(!view.exists);
        assert_eq!(
            view.file_issue.as_ref().map(|issue| issue.code.as_str()),
            Some("mcp.config_missing")
        );
        assert!(!store.path().exists());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn windows_permission_repair_restricts_an_owned_inherited_config() {
        let (root, store) = temporary_store("windows-permission-repair");
        fs::create_dir_all(store.path().parent().unwrap()).unwrap();
        fs::write(
            store.path(),
            canonical_bytes(&McpConfigFile::empty()).unwrap(),
        )
        .unwrap();
        assert!(store.inspect(&agents()).unwrap().permission_issue);

        store.repair_permissions().unwrap();

        assert!(!store.inspect(&agents()).unwrap().permission_issue);
        assert!(open_private_read_file(store.path()).is_ok());
        let _ = fs::remove_dir_all(root);
    }
}
