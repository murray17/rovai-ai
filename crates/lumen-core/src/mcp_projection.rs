use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    agent_profile::AdapterKind,
    agent_runtime_adapter::{AgentRuntimeAdapterRegistry, McpProjectionIsolation},
    command::canonical_json_digest,
    db::Database,
    mcp::{McpConfigStore, McpServerDefinition},
};

const MCP_PROJECTION_SCHEMA_VERSION: u32 = 1;
const MAX_PROJECTION_BYTES: u64 = 2 * 1024 * 1024;
pub const LEGACY_EMPTY_MCP_EXPOSURE_DIGEST: &str = "sha256:legacy-empty-mcp-exposure";
pub const LEGACY_EMPTY_MCP_PROJECTION_DIGEST: &str = "sha256:legacy-empty-mcp-projection";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpExposureStatus {
    Ready,
    Disabled,
    Unassigned,
    AdapterUnsupported,
    MissingEnvironment,
    Invalid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpExposureEntry {
    pub name: String,
    pub transport: String,
    pub config_digest: String,
    pub status: McpExposureStatus,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpExposureSnapshot {
    pub schema_version: u32,
    pub config_digest: String,
    pub config_status: String,
    pub warnings: Vec<String>,
    pub servers: Vec<McpExposureEntry>,
}

impl Default for McpExposureSnapshot {
    fn default() -> Self {
        Self {
            schema_version: MCP_PROJECTION_SCHEMA_VERSION,
            config_digest: "sha256:empty-mcp-config".to_string(),
            config_status: "ready".to_string(),
            warnings: Vec::new(),
            servers: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct McpProjectionRequest<'a> {
    pub agent_run_id: &'a str,
    pub execution_epoch: i64,
    pub agent_profile_id: &'a str,
    pub adapter_kind: AdapterKind,
    pub execution_root: &'a Path,
}

#[derive(Debug, Clone)]
pub struct PreparedMcpProjection {
    pub snapshot: McpExposureSnapshot,
    pub exposure_digest: String,
    pub projection_digest: String,
    pub canonical_path: PathBuf,
    pub servers: BTreeMap<String, McpServerDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectionFile {
    schema_version: u32,
    agent_run_id: String,
    adapter_kind: AdapterKind,
    exposure: McpExposureSnapshot,
    servers: BTreeMap<String, McpServerDefinition>,
}

#[derive(Debug, Clone)]
struct FrozenProjection {
    exposure: McpExposureSnapshot,
    exposure_digest: String,
    projection_digest: String,
}

#[derive(Debug, Clone)]
pub struct McpProjectionService {
    root: PathBuf,
}

impl McpProjectionService {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            root: data_dir.join("runtime/mcp"),
        }
    }

    pub fn prepare(
        &self,
        database: &Database,
        config_store: &McpConfigStore,
        request: &McpProjectionRequest<'_>,
    ) -> Result<PreparedMcpProjection> {
        validate_request(request)?;
        let frozen = load_frozen_projection(database, request.agent_run_id)?;
        let target = self.target_path(request.agent_run_id, request.execution_epoch);
        if target.exists() {
            return self.load_and_validate(&target, request, frozen.as_ref());
        }
        if let Some(previous) = self.find_previous(request, frozen.as_ref())? {
            self.publish_bytes(request.agent_run_id, request.execution_epoch, &previous.0)?;
            return self.load_and_validate(&target, request, frozen.as_ref());
        }
        if let Some(frozen) = frozen.as_ref() {
            if frozen.projection_digest == LEGACY_EMPTY_MCP_PROJECTION_DIGEST {
                let projection = empty_legacy_projection(request);
                self.publish_projection(request, &projection)?;
                return self.load_and_validate(&target, request, Some(frozen));
            }
            anyhow::bail!(
                "MCP projection is unavailable for frozen AgentRun {}",
                request.agent_run_id
            );
        }

        let projection = materialize_projection(config_store, request)?;
        self.publish_projection(request, &projection)?;
        self.load_and_validate(&target, request, None)
    }

    pub fn cleanup_terminal_and_orphaned(&self, database: &Database) -> Result<usize> {
        if !self.root.exists() {
            return Ok(0);
        }
        ensure_private_directory(&self.root)?;
        let mut removed = 0;
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let path = entry.path();
            let file_type = entry.file_type()?;
            if !file_type.is_dir() {
                continue;
            }
            let run_id = entry.file_name().to_string_lossy().to_string();
            let status = database
                .connection()
                .query_row(
                    "SELECT status FROM agent_run WHERE id = ?1",
                    [&run_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if status
                .as_deref()
                .is_none_or(|status| matches!(status, "succeeded" | "failed" | "cancelled"))
            {
                fs::remove_dir_all(&path)?;
                removed += 1;
                continue;
            }
            for child in fs::read_dir(&path)? {
                let child = child?;
                if child.file_name().to_string_lossy().starts_with('.')
                    && child.file_type()?.is_dir()
                {
                    fs::remove_dir_all(child.path())?;
                }
            }
        }
        Ok(removed)
    }

    fn find_previous(
        &self,
        request: &McpProjectionRequest<'_>,
        frozen: Option<&FrozenProjection>,
    ) -> Result<Option<(Vec<u8>, String)>> {
        let run_root = self.run_root(request.agent_run_id);
        if !run_root.exists() {
            return Ok(None);
        }
        ensure_private_directory(&run_root)?;
        let mut found: Option<(Vec<u8>, String)> = None;
        for entry in fs::read_dir(&run_root)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(epoch) = name.parse::<i64>() else {
                continue;
            };
            if epoch == request.execution_epoch {
                continue;
            }
            let path = entry.path().join("canonical.json");
            if !path.exists() {
                continue;
            }
            let (bytes, digest) = read_private_projection_bytes(&path)?;
            let projection = parse_projection(&bytes, request)?;
            validate_projection_digest(&projection, &digest, frozen)?;
            if let Some((_, previous_digest)) = found.as_ref()
                && previous_digest != &digest
            {
                anyhow::bail!(
                    "AgentRun {} has conflicting immutable MCP projections",
                    request.agent_run_id
                );
            }
            found = Some((bytes, digest));
        }
        Ok(found)
    }

    fn publish_projection(
        &self,
        request: &McpProjectionRequest<'_>,
        projection: &ProjectionFile,
    ) -> Result<()> {
        let mut bytes = serde_json::to_vec_pretty(projection)?;
        bytes.push(b'\n');
        self.publish_bytes(request.agent_run_id, request.execution_epoch, &bytes)
    }

    fn publish_bytes(&self, agent_run_id: &str, execution_epoch: i64, bytes: &[u8]) -> Result<()> {
        ensure_or_create_private_directory(&self.root)?;
        let run_root = self.run_root(agent_run_id);
        ensure_or_create_private_directory(&run_root)?;
        let target = self.target_path(agent_run_id, execution_epoch);
        if target.exists() {
            return Ok(());
        }
        let temporary = run_root.join(format!(".{execution_epoch}-{}.tmp", Uuid::new_v4()));
        fs::create_dir(&temporary)?;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o700))?;
        let file_path = temporary.join("canonical.json");
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&file_path)?;
        let result = (|| -> Result<()> {
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            File::open(&temporary)?.sync_all()?;
            fs::rename(&temporary, &target)?;
            File::open(&run_root)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&temporary);
        }
        result
    }

    fn load_and_validate(
        &self,
        target: &Path,
        request: &McpProjectionRequest<'_>,
        frozen: Option<&FrozenProjection>,
    ) -> Result<PreparedMcpProjection> {
        ensure_private_directory(target)?;
        let canonical_path = target.join("canonical.json");
        let (bytes, projection_digest) = read_private_projection_bytes(&canonical_path)?;
        let projection = parse_projection(&bytes, request)?;
        let mut exposure_digest =
            canonical_json_digest(&serde_json::to_value(&projection.exposure)?)?;
        validate_projection_digest(&projection, &projection_digest, frozen)?;
        if let Some(frozen) = frozen {
            if frozen.exposure != projection.exposure
                || (frozen.exposure_digest != LEGACY_EMPTY_MCP_EXPOSURE_DIGEST
                    && frozen.exposure_digest != exposure_digest)
            {
                anyhow::bail!("Frozen MCP exposure does not match its private projection");
            }
            if frozen.exposure_digest == LEGACY_EMPTY_MCP_EXPOSURE_DIGEST {
                exposure_digest = frozen.exposure_digest.clone();
            }
        }
        Ok(PreparedMcpProjection {
            snapshot: projection.exposure,
            exposure_digest,
            projection_digest,
            canonical_path,
            servers: projection.servers,
        })
    }

    fn run_root(&self, agent_run_id: &str) -> PathBuf {
        self.root.join(agent_run_id)
    }

    fn target_path(&self, agent_run_id: &str, execution_epoch: i64) -> PathBuf {
        self.run_root(agent_run_id)
            .join(execution_epoch.to_string())
    }
}

fn materialize_projection(
    config_store: &McpConfigStore,
    request: &McpProjectionRequest<'_>,
) -> Result<ProjectionFile> {
    let known = [request.agent_profile_id.to_string()].into_iter().collect();
    let (view, config) = config_store.get_with_raw(&known)?;
    let mut exposure = McpExposureSnapshot {
        schema_version: MCP_PROJECTION_SCHEMA_VERSION,
        config_digest: view.config_digest.clone(),
        config_status: if view.file_issue.is_some() {
            "invalid"
        } else {
            "ready"
        }
        .to_string(),
        warnings: Vec::new(),
        servers: Vec::new(),
    };
    if let Some(issue) = view.file_issue {
        exposure.warnings.push(issue.code);
        return Ok(ProjectionFile {
            schema_version: MCP_PROJECTION_SCHEMA_VERSION,
            agent_run_id: request.agent_run_id.to_string(),
            adapter_kind: request.adapter_kind,
            exposure,
            servers: BTreeMap::new(),
        });
    }
    if view.permission_issue {
        exposure
            .warnings
            .push("mcp_config_permissions_too_broad".to_string());
    }
    let mut servers = BTreeMap::new();
    let capability = AgentRuntimeAdapterRegistry::default().mcp_projection(request.adapter_kind);
    for (name, definition) in config.unwrap_or_default().mcp_servers {
        let transport = transport_name(&definition);
        let mut entry = McpExposureEntry {
            name: name.clone(),
            transport: transport.to_string(),
            config_digest: view.config_digest.clone(),
            status: McpExposureStatus::Ready,
            reason: None,
        };
        if !definition.enabled() {
            entry.status = McpExposureStatus::Disabled;
        } else if !definition
            .agent_profile_ids()
            .iter()
            .any(|id| id == request.agent_profile_id)
        {
            entry.status = McpExposureStatus::Unassigned;
        } else if capability.isolation == McpProjectionIsolation::Unsupported
            || (transport == "stdio" && !capability.supports_stdio)
            || (transport == "streamable_http" && !capability.supports_streamable_http)
        {
            entry.status = McpExposureStatus::AdapterUnsupported;
            entry.reason = Some(
                if capability.isolation == McpProjectionIsolation::Unsupported {
                    "adapter_does_not_support_per_run_mcp"
                } else {
                    "adapter_does_not_support_transport"
                }
                .to_string(),
            );
        } else if !definition.missing_values().is_empty() {
            entry.status = McpExposureStatus::Invalid;
            entry.reason = Some("imported_values_required".to_string());
        } else {
            match resolve_definition(&definition, request.execution_root) {
                Ok(resolved) => {
                    servers.insert(name.clone(), resolved);
                }
                Err(ResolveError::MissingEnvironment) => {
                    entry.status = McpExposureStatus::MissingEnvironment;
                    entry.reason = Some("environment_reference_missing".to_string());
                }
                Err(ResolveError::Invalid(reason)) => {
                    entry.status = McpExposureStatus::Invalid;
                    entry.reason = Some(reason);
                }
            }
        }
        exposure.servers.push(entry);
    }
    Ok(ProjectionFile {
        schema_version: MCP_PROJECTION_SCHEMA_VERSION,
        agent_run_id: request.agent_run_id.to_string(),
        adapter_kind: request.adapter_kind,
        exposure,
        servers,
    })
}

fn empty_legacy_projection(request: &McpProjectionRequest<'_>) -> ProjectionFile {
    ProjectionFile {
        schema_version: MCP_PROJECTION_SCHEMA_VERSION,
        agent_run_id: request.agent_run_id.to_string(),
        adapter_kind: request.adapter_kind,
        exposure: McpExposureSnapshot {
            schema_version: MCP_PROJECTION_SCHEMA_VERSION,
            config_digest: "sha256:legacy-empty-mcp-config".to_string(),
            config_status: "ready".to_string(),
            warnings: Vec::new(),
            servers: Vec::new(),
        },
        servers: BTreeMap::new(),
    }
}

enum ResolveError {
    MissingEnvironment,
    Invalid(String),
}

fn resolve_definition(
    definition: &McpServerDefinition,
    execution_root: &Path,
) -> std::result::Result<McpServerDefinition, ResolveError> {
    match definition {
        McpServerDefinition::Stdio {
            enabled,
            agent_profile_ids,
            command,
            args,
            cwd,
            env,
            ..
        } => {
            let cwd = cwd
                .as_deref()
                .map(PathBuf::from)
                .map(|path| {
                    if path.is_absolute() {
                        path
                    } else {
                        execution_root.join(path)
                    }
                })
                .unwrap_or_else(|| execution_root.to_path_buf());
            if !cwd.is_dir() {
                return Err(ResolveError::Invalid("cwd_unavailable".to_string()));
            }
            let env = resolve_values(env)?;
            Ok(McpServerDefinition::Stdio {
                enabled: *enabled,
                agent_profile_ids: agent_profile_ids.clone(),
                command: command.clone(),
                args: args.clone(),
                cwd: Some(cwd.to_string_lossy().to_string()),
                env,
                missing_values: Vec::new(),
            })
        }
        McpServerDefinition::StreamableHttp {
            enabled,
            agent_profile_ids,
            url,
            headers,
            ..
        } => Ok(McpServerDefinition::StreamableHttp {
            enabled: *enabled,
            agent_profile_ids: agent_profile_ids.clone(),
            url: url.clone(),
            headers: resolve_values(headers)?,
            missing_values: Vec::new(),
        }),
    }
}

fn resolve_values(
    values: &BTreeMap<String, String>,
) -> std::result::Result<BTreeMap<String, String>, ResolveError> {
    values
        .iter()
        .map(|(key, value)| {
            let resolved = match environment_reference(value) {
                Some(variable) => {
                    std::env::var(variable).map_err(|_| ResolveError::MissingEnvironment)?
                }
                None => value.clone(),
            };
            Ok((key.clone(), resolved))
        })
        .collect()
}

fn environment_reference(value: &str) -> Option<&str> {
    let value = value.trim();
    let variable = value
        .strip_prefix("${")
        .and_then(|value| value.strip_suffix('}'))?;
    (!variable.is_empty()
        && variable.bytes().enumerate().all(|(index, byte)| {
            byte == b'_' || byte.is_ascii_alphabetic() || (index > 0 && byte.is_ascii_digit())
        }))
    .then_some(variable)
}

fn transport_name(definition: &McpServerDefinition) -> &'static str {
    match definition {
        McpServerDefinition::Stdio { .. } => "stdio",
        McpServerDefinition::StreamableHttp { .. } => "streamable_http",
    }
}

fn validate_request(request: &McpProjectionRequest<'_>) -> Result<()> {
    Uuid::parse_str(request.agent_run_id).context("AgentRun ID is not a UUID")?;
    if request.execution_epoch < 1 {
        anyhow::bail!("MCP projection requires a positive execution epoch");
    }
    if request.agent_profile_id.trim().is_empty() {
        anyhow::bail!("MCP projection requires an AgentProfile");
    }
    if !request.execution_root.is_dir() {
        anyhow::bail!("AgentRun execution root is unavailable");
    }
    Ok(())
}

fn load_frozen_projection(
    database: &Database,
    agent_run_id: &str,
) -> Result<Option<FrozenProjection>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT mcp_exposure_json, mcp_exposure_digest, mcp_projection_digest
            FROM context_manifest WHERE agent_run_id = ?1
            "#,
            [agent_run_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?
        .map(|(json, exposure_digest, projection_digest)| {
            let exposure = serde_json::from_str::<McpExposureSnapshot>(&json)
                .context("stored MCP exposure is invalid")?;
            if exposure_digest != LEGACY_EMPTY_MCP_EXPOSURE_DIGEST
                && canonical_json_digest(&serde_json::to_value(&exposure)?)? != exposure_digest
            {
                anyhow::bail!("stored MCP exposure digest is invalid");
            }
            Ok(FrozenProjection {
                exposure,
                exposure_digest,
                projection_digest,
            })
        })
        .transpose()
}

fn parse_projection(bytes: &[u8], request: &McpProjectionRequest<'_>) -> Result<ProjectionFile> {
    let projection: ProjectionFile =
        serde_json::from_slice(bytes).context("private MCP projection is invalid")?;
    if projection.schema_version != MCP_PROJECTION_SCHEMA_VERSION
        || projection.agent_run_id != request.agent_run_id
        || projection.adapter_kind != request.adapter_kind
    {
        anyhow::bail!("private MCP projection identity is invalid");
    }
    Ok(projection)
}

fn validate_projection_digest(
    projection: &ProjectionFile,
    projection_digest: &str,
    frozen: Option<&FrozenProjection>,
) -> Result<()> {
    if let Some(frozen) = frozen
        && frozen.projection_digest != LEGACY_EMPTY_MCP_PROJECTION_DIGEST
        && frozen.projection_digest != projection_digest
    {
        anyhow::bail!("private MCP projection digest does not match the frozen manifest");
    }
    if projection.exposure.schema_version != MCP_PROJECTION_SCHEMA_VERSION {
        anyhow::bail!("private MCP exposure schema is unsupported");
    }
    Ok(())
}

fn read_private_projection_bytes(path: &Path) -> Result<(Vec<u8>, String)> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() {
        anyhow::bail!("private MCP projection must be a regular file");
    }
    if metadata.permissions().mode() & 0o077 != 0 {
        anyhow::bail!("private MCP projection permissions are too broad");
    }
    if metadata.len() > MAX_PROJECTION_BYTES {
        anyhow::bail!("private MCP projection exceeds the size limit");
    }
    let bytes = fs::read(path)?;
    let digest = format!("sha256:{:x}", Sha256::digest(&bytes));
    Ok((bytes, digest))
}

fn ensure_or_create_private_directory(path: &Path) -> Result<()> {
    if path.exists() {
        return ensure_private_directory(path);
    }
    fs::create_dir_all(path)
        .with_context(|| format!("failed to create private MCP directory {}", path.display()))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn ensure_private_directory(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() {
        anyhow::bail!("private MCP path is not a directory: {}", path.display());
    }
    if metadata.permissions().mode() & 0o077 != 0 {
        anyhow::bail!(
            "private MCP directory permissions are too broad: {}",
            path.display()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::{CreateMcpServerParams, McpEditableValue, McpMutationResult, McpServerInput};

    fn fixture() -> (PathBuf, Database, McpConfigStore, McpProjectionService) {
        let root = std::env::temp_dir().join(format!("lumen-mcp-projection-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let database = Database::open(&root.join("data")).unwrap();
        let store = McpConfigStore::new(root.join("home/.lumen/mcp.json"));
        let service = McpProjectionService::new(&root.join("data"));
        (root, database, store, service)
    }

    fn request<'a>(
        run_id: &'a str,
        epoch: i64,
        execution_root: &'a Path,
        adapter_kind: AdapterKind,
    ) -> McpProjectionRequest<'a> {
        McpProjectionRequest {
            agent_run_id: run_id,
            execution_epoch: epoch,
            agent_profile_id: "agent-muwa",
            adapter_kind,
            execution_root,
        }
    }

    fn agents() -> std::collections::BTreeSet<String> {
        ["agent-muwa".to_string()].into_iter().collect()
    }

    #[test]
    fn projection_filters_assignment_and_keeps_secrets_out_of_exposure() {
        let (root, database, store, service) = fixture();
        let config = store.get(&agents()).unwrap();
        let result = store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: config.config_digest,
                    name: "docs".to_string(),
                    definition: McpServerInput::Stdio {
                        enabled: true,
                        agent_profile_ids: vec!["agent-muwa".to_string()],
                        command: "node".to_string(),
                        args: vec!["server.js".to_string()],
                        cwd: None,
                        env: BTreeMap::from([(
                            "API_TOKEN".to_string(),
                            McpEditableValue {
                                value: Some("top-secret".to_string()),
                                preserve_stored: false,
                            },
                        )]),
                        missing_values: Vec::new(),
                    },
                },
                &agents(),
            )
            .unwrap();
        assert!(matches!(result, McpMutationResult::Ok { .. }));
        let run_id = Uuid::new_v4().to_string();
        let prepared = service
            .prepare(
                &database,
                &store,
                &request(&run_id, 1, &root, AdapterKind::CodexCli),
            )
            .unwrap();
        assert_eq!(
            prepared.snapshot.servers[0].status,
            McpExposureStatus::Ready
        );
        assert!(
            !serde_json::to_string(&prepared.snapshot)
                .unwrap()
                .contains("top-secret")
        );
        assert!(
            fs::read_to_string(&prepared.canonical_path)
                .unwrap()
                .contains("top-secret")
        );
        assert_eq!(
            fs::metadata(&prepared.canonical_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn later_epoch_reuses_the_first_projection_after_config_changes() {
        let (root, database, store, service) = fixture();
        let config = store.get(&agents()).unwrap();
        let created = store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: config.config_digest,
                    name: "docs".to_string(),
                    definition: McpServerInput::Stdio {
                        enabled: true,
                        agent_profile_ids: vec!["agent-muwa".to_string()],
                        command: "old-command".to_string(),
                        args: Vec::new(),
                        cwd: None,
                        env: BTreeMap::new(),
                        missing_values: Vec::new(),
                    },
                },
                &agents(),
            )
            .unwrap();
        let McpMutationResult::Ok { config_digest, .. } = created else {
            panic!("create should succeed");
        };
        let run_id = Uuid::new_v4().to_string();
        let first = service
            .prepare(
                &database,
                &store,
                &request(&run_id, 1, &root, AdapterKind::CodexCli),
            )
            .unwrap();
        store
            .update(
                crate::mcp::UpdateMcpServerParams {
                    expected_config_digest: config_digest,
                    name: "docs".to_string(),
                    new_name: "docs".to_string(),
                    definition: McpServerInput::Stdio {
                        enabled: true,
                        agent_profile_ids: vec!["agent-muwa".to_string()],
                        command: "new-command".to_string(),
                        args: Vec::new(),
                        cwd: None,
                        env: BTreeMap::new(),
                        missing_values: Vec::new(),
                    },
                },
                &agents(),
            )
            .unwrap();
        let recovered = service
            .prepare(
                &database,
                &store,
                &request(&run_id, 2, &root, AdapterKind::CodexCli),
            )
            .unwrap();
        assert_eq!(first.projection_digest, recovered.projection_digest);
        let McpServerDefinition::Stdio { command, .. } = &recovered.servers["docs"] else {
            panic!("expected stdio");
        };
        assert_eq!(command, "old-command");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn tampered_projection_is_rejected_and_antigravity_is_explicitly_unsupported() {
        let (root, database, store, service) = fixture();
        let config = store.get(&agents()).unwrap();
        store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: config.config_digest,
                    name: "docs".to_string(),
                    definition: McpServerInput::Stdio {
                        enabled: true,
                        agent_profile_ids: vec!["agent-muwa".to_string()],
                        command: "node".to_string(),
                        args: Vec::new(),
                        cwd: None,
                        env: BTreeMap::new(),
                        missing_values: Vec::new(),
                    },
                },
                &agents(),
            )
            .unwrap();
        let run_id = Uuid::new_v4().to_string();
        let antigravity = service
            .prepare(
                &database,
                &store,
                &request(&run_id, 1, &root, AdapterKind::AntigravityApp),
            )
            .unwrap();
        assert_eq!(
            antigravity.snapshot.servers[0].status,
            McpExposureStatus::AdapterUnsupported
        );
        let metadata = fs::metadata(&antigravity.canonical_path).unwrap();
        fs::set_permissions(
            &antigravity.canonical_path,
            fs::Permissions::from_mode(metadata.permissions().mode() | 0o044),
        )
        .unwrap();
        assert!(
            service
                .prepare(
                    &database,
                    &store,
                    &request(&run_id, 1, &root, AdapterKind::AntigravityApp),
                )
                .is_err()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_environment_fails_closed_and_orphan_cleanup_removes_private_projection() {
        let (root, database, store, service) = fixture();
        let config = store.get(&agents()).unwrap();
        store
            .create(
                CreateMcpServerParams {
                    expected_config_digest: config.config_digest,
                    name: "remote".to_string(),
                    definition: McpServerInput::StreamableHttp {
                        enabled: true,
                        agent_profile_ids: vec!["agent-muwa".to_string()],
                        url: "https://example.com/mcp".to_string(),
                        headers: BTreeMap::from([(
                            "Authorization".to_string(),
                            McpEditableValue {
                                value: Some(
                                    "${LUMEN_TEST_ENVIRONMENT_THAT_MUST_NOT_EXIST}".to_string(),
                                ),
                                preserve_stored: false,
                            },
                        )]),
                        missing_values: Vec::new(),
                    },
                },
                &agents(),
            )
            .unwrap();
        let run_id = Uuid::new_v4().to_string();
        let prepared = service
            .prepare(
                &database,
                &store,
                &request(&run_id, 1, &root, AdapterKind::CodexCli),
            )
            .unwrap();
        assert!(prepared.servers.is_empty());
        assert_eq!(
            prepared.snapshot.servers[0].status,
            McpExposureStatus::MissingEnvironment
        );
        assert!(prepared.canonical_path.exists());
        assert_eq!(service.cleanup_terminal_and_orphaned(&database).unwrap(), 1);
        assert!(!prepared.canonical_path.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn invalid_library_file_creates_an_empty_explainable_projection() {
        let (root, database, store, service) = fixture();
        fs::create_dir_all(store.path().parent().unwrap()).unwrap();
        fs::write(store.path(), "{broken").unwrap();
        let run_id = Uuid::new_v4().to_string();
        let prepared = service
            .prepare(
                &database,
                &store,
                &request(&run_id, 1, &root, AdapterKind::CodexCli),
            )
            .unwrap();
        assert_eq!(prepared.snapshot.config_status, "invalid");
        assert!(prepared.servers.is_empty());
        assert_eq!(
            prepared.snapshot.warnings,
            ["mcp.config_parse_failed".to_string()]
        );
        assert!(
            !fs::read_to_string(&prepared.canonical_path)
                .unwrap()
                .contains("{broken")
        );
        let _ = fs::remove_dir_all(root);
    }
}
