use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

#[cfg(windows)]
use std::io::Read;
#[cfg(unix)]
use std::{
    fs::{File, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
};

use anyhow::{Context, Result};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
#[cfg(any(unix, windows))]
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    agent_profile::AdapterKind,
    agent_runtime_adapter::{
        AgentRuntimeAdapterRegistry, ExternalMcpProjection, McpSameNamePolicy,
    },
    command::canonical_json_digest,
    db::Database,
    mcp::{McpConfigStore, McpServerDefinition},
};

#[cfg(windows)]
use crate::platform::private_storage::{
    admit_private_directory, commit_private_directory_temporary, create_private_bytes,
    create_private_directory, open_private_read_file, prepare_private_directory,
};

const MCP_PROJECTION_SCHEMA_VERSION: u32 = 2;
#[cfg(any(unix, windows))]
const MAX_PROJECTION_BYTES: u64 = 2 * 1024 * 1024;
pub const LEGACY_EMPTY_MCP_EXPOSURE_DIGEST: &str = "sha256:legacy-empty-mcp-exposure";
pub const LEGACY_EMPTY_MCP_PROJECTION_DIGEST: &str = "sha256:legacy-empty-mcp-projection";
pub const CLAUDE_CODE_MCP_MINIMUM_VERSION: &str = "1.0.44";
pub const COPILOT_MCP_MINIMUM_VERSION: &str = "0.0.370";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum McpExposureStatus {
    Ready,
    SkippedNativeNameConflict,
    Disabled,
    Unassigned,
    AdapterUnsupported,
    MissingEnvironment,
    Invalid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpExposureEntry {
    #[serde(default)]
    pub server_id: String,
    pub name: String,
    #[serde(default)]
    pub runtime_name: String,
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
    pub projection_mode: ExternalMcpProjection,
    pub same_name_policy: Option<McpSameNamePolicy>,
    pub warnings: Vec<String>,
    pub servers: Vec<McpExposureEntry>,
}

impl Default for McpExposureSnapshot {
    fn default() -> Self {
        Self {
            schema_version: MCP_PROJECTION_SCHEMA_VERSION,
            config_digest: "sha256:empty-mcp-config".to_string(),
            config_status: "ready".to_string(),
            projection_mode: ExternalMcpProjection::Unsupported,
            same_name_policy: None,
            warnings: Vec::new(),
            servers: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct McpProjectionRequest<'a> {
    pub agent_run_id: &'a str,
    pub execution_epoch: i64,
    pub agent_id: &'a str,
    pub adapter_kind: AdapterKind,
    pub reported_runtime_version: Option<&'a str>,
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

impl PreparedMcpProjection {
    pub fn finalize_native_name_conflicts(
        &mut self,
        native_mcp_server_names: &BTreeSet<String>,
    ) -> Result<()> {
        for entry in &mut self.snapshot.servers {
            if entry.status == McpExposureStatus::Ready
                && self.snapshot.same_name_policy == Some(McpSameNamePolicy::NativeWinsSkip)
                && native_mcp_server_names
                    .iter()
                    .any(|native| native.eq_ignore_ascii_case(&entry.runtime_name))
            {
                self.servers.remove(&entry.runtime_name);
                entry.status = McpExposureStatus::SkippedNativeNameConflict;
                entry.reason = Some("native_mcp_name_conflict".to_string());
            }
        }
        self.exposure_digest = canonical_json_digest(&serde_json::to_value(&self.snapshot)?)?;
        Ok(())
    }
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

    #[cfg(unix)]
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

    #[cfg(windows)]
    fn publish_bytes(&self, agent_run_id: &str, execution_epoch: i64, bytes: &[u8]) -> Result<()> {
        ensure_or_create_private_directory(&self.root)?;
        let run_root = self.run_root(agent_run_id);
        ensure_or_create_private_directory(&run_root)?;
        let target = self.target_path(agent_run_id, execution_epoch);
        if target.exists() {
            ensure_private_directory(&target)?;
            return Ok(());
        }
        let temporary = run_root.join(format!(".{execution_epoch}-{}.tmp", Uuid::new_v4()));
        create_private_directory(&temporary)?;
        let result = (|| -> Result<()> {
            create_private_bytes(&temporary.join("canonical.json"), bytes)?;
            commit_private_directory_temporary(&temporary, &target)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&temporary);
            if target.exists() {
                ensure_private_directory(&target)?;
                return Ok(());
            }
        }
        result
    }

    #[cfg(not(any(unix, windows)))]
    fn publish_bytes(
        &self,
        _agent_run_id: &str,
        _execution_epoch: i64,
        _bytes: &[u8],
    ) -> Result<()> {
        anyhow::bail!("private MCP projection storage is unsupported on this platform")
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
        let original_exposure_digest =
            canonical_json_digest(&serde_json::to_value(&projection.exposure)?)?;
        validate_projection_digest(&projection, &projection_digest, frozen)?;
        let (snapshot, exposure_digest) = if let Some(frozen) = frozen {
            validate_frozen_exposure(&projection.exposure, &frozen.exposure)?;
            (
                frozen.exposure.clone(),
                if frozen.exposure_digest == LEGACY_EMPTY_MCP_EXPOSURE_DIGEST {
                    frozen.exposure_digest.clone()
                } else {
                    let digest = canonical_json_digest(&serde_json::to_value(&frozen.exposure)?)?;
                    if digest != frozen.exposure_digest {
                        anyhow::bail!("Frozen MCP exposure digest is invalid");
                    }
                    digest
                },
            )
        } else {
            (projection.exposure.clone(), original_exposure_digest)
        };
        let ready_names = snapshot
            .servers
            .iter()
            .filter(|entry| entry.status == McpExposureStatus::Ready)
            .map(|entry| {
                if entry.runtime_name.is_empty() {
                    entry.name.as_str()
                } else {
                    entry.runtime_name.as_str()
                }
            })
            .collect::<std::collections::BTreeSet<_>>();
        let servers = projection
            .servers
            .into_iter()
            .filter(|(name, _)| ready_names.contains(name.as_str()))
            .collect();
        Ok(PreparedMcpProjection {
            snapshot,
            exposure_digest,
            projection_digest,
            canonical_path,
            servers,
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
    let known = [request.agent_id.to_string()].into_iter().collect();
    let (view, config) = config_store.get_with_raw(&known)?;
    let capability = AgentRuntimeAdapterRegistry::default().mcp_projection(request.adapter_kind);
    let mut exposure = McpExposureSnapshot {
        schema_version: MCP_PROJECTION_SCHEMA_VERSION,
        config_digest: view.config_digest.clone(),
        config_status: if view.file_issue.is_some() {
            "invalid"
        } else {
            "ready"
        }
        .to_string(),
        projection_mode: capability.external_mcp_projection,
        same_name_policy: capability.same_name_policy,
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
    let minimum_version_supported =
        runtime_version_supports_mcp(request.adapter_kind, request.reported_runtime_version);
    let Some(config) = config else {
        return Ok(ProjectionFile {
            schema_version: MCP_PROJECTION_SCHEMA_VERSION,
            agent_run_id: request.agent_run_id.to_string(),
            adapter_kind: request.adapter_kind,
            exposure,
            servers: BTreeMap::new(),
        });
    };
    for (name, definition) in config.mcp_servers {
        let Some(metadata) = config.rovai.servers.get(&name) else {
            exposure
                .warnings
                .push("mcp_metadata_parity_invalid".to_string());
            continue;
        };
        let transport = transport_name(&definition);
        let mut entry = McpExposureEntry {
            server_id: metadata.server_id.clone(),
            name: name.clone(),
            runtime_name: name.clone(),
            transport: transport.to_string(),
            config_digest: view.config_digest.clone(),
            status: McpExposureStatus::Ready,
            reason: None,
        };
        if !metadata.enabled {
            entry.status = McpExposureStatus::Disabled;
        } else if !config.rovai.assignments.iter().any(|assignment| {
            assignment.server_id == metadata.server_id && assignment.agent_id == request.agent_id
        }) {
            entry.status = McpExposureStatus::Unassigned;
        } else if !minimum_version_supported
            || capability.external_mcp_projection == ExternalMcpProjection::Unsupported
            || (transport == "stdio" && !capability.supports_stdio)
            || (transport == "streamable_http" && !capability.supports_streamable_http)
        {
            entry.status = McpExposureStatus::AdapterUnsupported;
            entry.reason = Some(
                if !minimum_version_supported {
                    "runtime_version_below_mcp_minimum"
                } else if capability.external_mcp_projection == ExternalMcpProjection::Unsupported {
                    "adapter_does_not_support_per_run_mcp"
                } else {
                    "adapter_does_not_support_transport"
                }
                .to_string(),
            );
        } else {
            match resolve_definition(&definition, request.execution_root) {
                Ok(resolved) => {
                    let runtime_name = name.clone();
                    entry.runtime_name = runtime_name.clone();
                    servers.insert(runtime_name, resolved);
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
            projection_mode: ExternalMcpProjection::Unsupported,
            same_name_policy: None,
            warnings: Vec::new(),
            servers: Vec::new(),
        },
        servers: BTreeMap::new(),
    }
}

#[derive(Debug)]
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
            command,
            args,
            cwd,
            env,
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
                command: command.clone(),
                args: args.clone(),
                cwd: Some(cwd.to_string_lossy().to_string()),
                env,
            })
        }
        McpServerDefinition::StreamableHttp { url, headers } => {
            Ok(McpServerDefinition::StreamableHttp {
                url: url.clone(),
                headers: resolve_values(headers)?,
            })
        }
    }
}

fn resolve_values(
    values: &BTreeMap<String, String>,
) -> std::result::Result<BTreeMap<String, String>, ResolveError> {
    values
        .iter()
        .map(|(key, value)| {
            let resolved = interpolate_environment(value)?;
            Ok((key.clone(), resolved))
        })
        .collect()
}

fn interpolate_environment(value: &str) -> std::result::Result<String, ResolveError> {
    let bytes = value.as_bytes();
    let mut output = String::with_capacity(value.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index..].starts_with(b"$${") {
            let Some(relative_end) = bytes[index + 3..].iter().position(|byte| *byte == b'}')
            else {
                output.push_str(&value[index..]);
                break;
            };
            let end = index + 3 + relative_end;
            output.push_str("${");
            output.push_str(&value[index + 3..end]);
            output.push('}');
            index = end + 1;
            continue;
        }
        if bytes[index..].starts_with(b"${") {
            let Some(relative_end) = bytes[index + 2..].iter().position(|byte| *byte == b'}')
            else {
                return Err(ResolveError::Invalid(
                    "environment_reference_invalid".to_string(),
                ));
            };
            let end = index + 2 + relative_end;
            let variable = &value[index + 2..end];
            if !valid_environment_reference(variable) {
                return Err(ResolveError::Invalid(
                    "environment_reference_invalid".to_string(),
                ));
            }
            output
                .push_str(&std::env::var(variable).map_err(|_| ResolveError::MissingEnvironment)?);
            index = end + 1;
            continue;
        }
        let character = value[index..]
            .chars()
            .next()
            .expect("index is inside the string");
        output.push(character);
        index += character.len_utf8();
    }
    Ok(output)
}

fn valid_environment_reference(variable: &str) -> bool {
    !variable.is_empty()
        && variable.bytes().enumerate().all(|(index, byte)| {
            byte == b'_' || byte.is_ascii_alphabetic() || (index > 0 && byte.is_ascii_digit())
        })
}

fn transport_name(definition: &McpServerDefinition) -> &'static str {
    match definition {
        McpServerDefinition::Stdio { .. } => "stdio",
        McpServerDefinition::StreamableHttp { .. } => "streamable_http",
    }
}

fn runtime_version_supports_mcp(kind: AdapterKind, reported_version: Option<&str>) -> bool {
    let minimum = match kind {
        AdapterKind::ClaudeCodeCli => [1, 0, 44],
        AdapterKind::CopilotCli => [0, 0, 370],
        _ => return true,
    };
    reported_version
        .and_then(parse_reported_version)
        .is_none_or(|version| version >= minimum)
}

fn parse_reported_version(value: &str) -> Option<[u64; 3]> {
    value
        .split(|character: char| !character.is_ascii_digit() && character != '.')
        .filter(|part| !part.is_empty())
        .find_map(|part| {
            let mut components = part.split('.');
            let major = components.next()?.parse().ok()?;
            let minor = components.next()?.parse().ok()?;
            let patch = components.next()?.parse().ok()?;
            Some([major, minor, patch])
        })
}

fn validate_request(request: &McpProjectionRequest<'_>) -> Result<()> {
    Uuid::parse_str(request.agent_run_id).context("AgentRun ID is not a UUID")?;
    if request.execution_epoch < 1 {
        anyhow::bail!("MCP projection requires a positive execution epoch");
    }
    if request.agent_id.trim().is_empty() {
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

fn validate_frozen_exposure(
    projected: &McpExposureSnapshot,
    frozen: &McpExposureSnapshot,
) -> Result<()> {
    if projected.schema_version != frozen.schema_version
        || projected.config_digest != frozen.config_digest
        || projected.config_status != frozen.config_status
        || projected.projection_mode != frozen.projection_mode
        || projected.same_name_policy != frozen.same_name_policy
        || projected.servers.len() != frozen.servers.len()
    {
        anyhow::bail!("Frozen MCP exposure identity does not match its input projection");
    }
    for (input, final_entry) in projected.servers.iter().zip(&frozen.servers) {
        if input.server_id != final_entry.server_id
            || input.name != final_entry.name
            || input.runtime_name != final_entry.runtime_name
            || input.transport != final_entry.transport
            || input.config_digest != final_entry.config_digest
        {
            anyhow::bail!("Frozen MCP exposure Server identity was changed");
        }
        let native_collision_finalized = input.status == McpExposureStatus::Ready
            && final_entry.status == McpExposureStatus::SkippedNativeNameConflict
            && final_entry.reason.as_deref() == Some("native_mcp_name_conflict");
        if input != final_entry && !native_collision_finalized {
            anyhow::bail!("Frozen MCP exposure contains an invalid final Runtime state");
        }
    }
    Ok(())
}

#[cfg(unix)]
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

#[cfg(windows)]
fn read_private_projection_bytes(path: &Path) -> Result<(Vec<u8>, String)> {
    let mut file = open_private_read_file(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > MAX_PROJECTION_BYTES {
        anyhow::bail!("private MCP projection exceeds its regular-file size contract");
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take(MAX_PROJECTION_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_PROJECTION_BYTES {
        anyhow::bail!("private MCP projection exceeds the size limit");
    }
    let digest = format!("sha256:{:x}", Sha256::digest(&bytes));
    Ok((bytes, digest))
}

#[cfg(not(any(unix, windows)))]
fn read_private_projection_bytes(_path: &Path) -> Result<(Vec<u8>, String)> {
    anyhow::bail!("private MCP projection storage is unsupported on this platform")
}

#[cfg(unix)]
fn ensure_or_create_private_directory(path: &Path) -> Result<()> {
    if path.exists() {
        return ensure_private_directory(path);
    }
    fs::create_dir_all(path)
        .with_context(|| format!("failed to create private MCP directory {}", path.display()))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(windows)]
fn ensure_or_create_private_directory(path: &Path) -> Result<()> {
    prepare_private_directory(path)?;
    Ok(())
}

#[cfg(unix)]
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

#[cfg(windows)]
fn ensure_private_directory(path: &Path) -> Result<()> {
    admit_private_directory(path)?;
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn ensure_private_directory(_path: &Path) -> Result<()> {
    anyhow::bail!("private MCP projection storage is unsupported on this platform")
}

#[cfg(all(test, any(unix, windows)))]
mod tests {
    use super::*;
    use crate::mcp::{
        CreateMcpServerParams, McpMutationResult, SetMcpAssignmentParams, SetMcpServerEnabledParams,
    };

    fn fixture() -> (PathBuf, Database, McpConfigStore, McpProjectionService) {
        let root = std::env::temp_dir().join(format!("rovai-mcp-projection-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let database = Database::open(&root.join("data")).unwrap();
        let store = McpConfigStore::new(root.join("home/.rovai/mcp.json"));
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
            agent_id: "agent_2",
            adapter_kind,
            reported_runtime_version: None,
            execution_root,
        }
    }

    fn agents() -> std::collections::BTreeSet<String> {
        ["agent_2".to_string()].into_iter().collect()
    }

    fn mutation_config(result: McpMutationResult) -> crate::mcp::McpConfigView {
        let McpMutationResult::Ok { config, .. } = result else {
            panic!("MCP mutation should succeed");
        };
        *config
    }

    fn create_effective(
        store: &McpConfigStore,
        name: &str,
        definition: &str,
    ) -> crate::mcp::McpConfigView {
        let config = store.get(&agents()).unwrap();
        let definition_json = format!(r#"{{"mcpServers":{{"{name}":{definition}}}}}"#);
        let config = mutation_config(
            store
                .create(
                    CreateMcpServerParams {
                        expected_config_digest: config.config_digest,
                        definition_json,
                    },
                    &agents(),
                )
                .unwrap(),
        );
        let server_id = config
            .servers
            .iter()
            .find(|server| server.name == name)
            .unwrap()
            .server_id
            .clone();
        let config = mutation_config(
            store
                .set_enabled(
                    SetMcpServerEnabledParams {
                        expected_config_digest: config.config_digest,
                        server_id: server_id.clone(),
                        enabled: true,
                        acknowledge_high_risk: false,
                    },
                    &agents(),
                )
                .unwrap(),
        );
        mutation_config(
            store
                .set_assignment(
                    SetMcpAssignmentParams {
                        expected_config_digest: config.config_digest,
                        server_id,
                        agent_id: "agent_2".to_string(),
                        assigned: true,
                        acknowledge_high_risk: false,
                    },
                    &agents(),
                )
                .unwrap(),
        )
    }

    #[test]
    fn projection_filters_assignment_and_keeps_secrets_out_of_exposure() {
        let (root, database, store, service) = fixture();
        create_effective(
            &store,
            "docs",
            r#"{"command":"node","args":["server.js"],"env":{"API_TOKEN":"top-secret"}}"#,
        );
        let run_id = Uuid::new_v4().to_string();
        let prepared = service
            .prepare(
                &database,
                &store,
                &request(&run_id, 1, &root, AdapterKind::CodexCli),
            )
            .unwrap();
        assert_eq!(
            prepared
                .snapshot
                .servers
                .iter()
                .find(|entry| entry.name == "docs")
                .unwrap()
                .status,
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
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&prepared.canonical_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        #[cfg(windows)]
        assert!(open_private_read_file(&prepared.canonical_path).is_ok());
        drop(database);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn later_epoch_reuses_the_first_projection_after_config_changes() {
        let (root, database, store, service) = fixture();
        let config = create_effective(&store, "docs", r#"{"command":"old-command"}"#);
        let server_id = config
            .servers
            .iter()
            .find(|server| server.name == "docs")
            .unwrap()
            .server_id
            .clone();
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
                    expected_config_digest: config.config_digest,
                    server_id,
                    definition_json: r#"{"mcpServers":{"docs":{"command":"new-command"}}}"#
                        .to_string(),
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
        drop(database);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn tampered_projection_is_rejected_and_unsupported_adapter_skips_external_mcp() {
        let (root, database, store, service) = fixture();
        create_effective(&store, "docs", r#"{"command":"node"}"#);
        let run_id = Uuid::new_v4().to_string();
        let unsupported = service
            .prepare(
                &database,
                &store,
                &request(&run_id, 1, &root, AdapterKind::AntigravityApp),
            )
            .unwrap();
        assert!(unsupported.servers.is_empty());
        assert_eq!(
            unsupported
                .snapshot
                .servers
                .iter()
                .find(|entry| entry.name == "docs")
                .unwrap()
                .status,
            McpExposureStatus::AdapterUnsupported
        );

        let codex_run_id = Uuid::new_v4().to_string();
        let codex = service
            .prepare(
                &database,
                &store,
                &request(&codex_run_id, 1, &root, AdapterKind::CodexCli),
            )
            .unwrap();
        #[cfg(unix)]
        {
            let metadata = fs::metadata(&codex.canonical_path).unwrap();
            fs::set_permissions(
                &codex.canonical_path,
                fs::Permissions::from_mode(metadata.permissions().mode() | 0o044),
            )
            .unwrap();
        }
        #[cfg(windows)]
        fs::write(&codex.canonical_path, b"{\"tampered\":true}").unwrap();
        assert!(
            service
                .prepare(
                    &database,
                    &store,
                    &request(&codex_run_id, 1, &root, AdapterKind::CodexCli),
                )
                .is_err()
        );
        drop(database);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_environment_fails_closed_and_orphan_cleanup_removes_private_projection() {
        let (root, database, store, service) = fixture();
        create_effective(
            &store,
            "remote",
            r#"{"url":"https://example.com/mcp","headers":{"Authorization":"Bearer ${ROVAI_TEST_ENVIRONMENT_THAT_MUST_NOT_EXIST}"}}"#,
        );
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
            prepared
                .snapshot
                .servers
                .iter()
                .find(|entry| entry.name == "remote")
                .unwrap()
                .status,
            McpExposureStatus::MissingEnvironment
        );
        assert!(prepared.canonical_path.exists());
        assert_eq!(service.cleanup_terminal_and_orphaned(&database).unwrap(), 1);
        assert!(!prepared.canonical_path.exists());
        drop(database);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn invalid_library_file_creates_an_empty_explainable_projection() {
        let (root, database, store, service) = fixture();
        #[cfg(unix)]
        {
            fs::create_dir_all(store.path().parent().unwrap()).unwrap();
            fs::write(store.path(), "{broken").unwrap();
        }
        #[cfg(windows)]
        create_private_bytes(store.path(), b"{broken").unwrap();
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
        drop(database);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn environment_interpolation_supports_embedded_references_and_escape_sequences() {
        unsafe { std::env::set_var("ROVAI_MCP_INTERPOLATION_TEST", "secret") };
        assert_eq!(
            interpolate_environment("Bearer ${ROVAI_MCP_INTERPOLATION_TEST}").unwrap(),
            "Bearer secret"
        );
        assert_eq!(
            interpolate_environment("$${ROVAI_MCP_INTERPOLATION_TEST}").unwrap(),
            "${ROVAI_MCP_INTERPOLATION_TEST}"
        );
        unsafe { std::env::remove_var("ROVAI_MCP_INTERPOLATION_TEST") };
    }

    #[test]
    fn mcp_runtime_minimums_have_no_upper_bound_and_unknown_new_versions_are_attempted() {
        assert!(!runtime_version_supports_mcp(
            AdapterKind::ClaudeCodeCli,
            Some("claude 1.0.43")
        ));
        assert!(runtime_version_supports_mcp(
            AdapterKind::ClaudeCodeCli,
            Some("1.0.44")
        ));
        assert!(runtime_version_supports_mcp(
            AdapterKind::ClaudeCodeCli,
            Some("99.0.0")
        ));
        assert!(!runtime_version_supports_mcp(
            AdapterKind::CopilotCli,
            Some("0.0.369")
        ));
        assert!(runtime_version_supports_mcp(
            AdapterKind::CopilotCli,
            Some("1.0.0")
        ));
        assert!(runtime_version_supports_mcp(AdapterKind::CopilotCli, None));
    }

    #[test]
    fn codex_native_name_conflict_is_skipped_without_aliasing_or_overwrite() {
        let (root, database, store, service) = fixture();
        create_effective(&store, "docs", r#"{"command":"node"}"#);
        let run_id = Uuid::new_v4().to_string();
        let codex_request = request(&run_id, 1, &root, AdapterKind::CodexCli);
        let mut prepared = service.prepare(&database, &store, &codex_request).unwrap();
        prepared
            .finalize_native_name_conflicts(&BTreeSet::from(["Docs".to_string()]))
            .unwrap();
        let entry = prepared
            .snapshot
            .servers
            .iter()
            .find(|entry| entry.name == "docs")
            .unwrap();
        assert_eq!(entry.runtime_name, entry.name);
        assert_eq!(entry.status, McpExposureStatus::SkippedNativeNameConflict);
        assert_eq!(entry.reason.as_deref(), Some("native_mcp_name_conflict"));
        assert!(prepared.servers.is_empty());
        assert_eq!(
            prepared.snapshot.same_name_policy,
            Some(McpSameNamePolicy::NativeWinsSkip)
        );

        let recovered_request = request(&run_id, 2, &root, AdapterKind::CodexCli);
        let mut recovered = service
            .prepare(&database, &store, &recovered_request)
            .unwrap();
        recovered
            .finalize_native_name_conflicts(&BTreeSet::from(["docs".to_string()]))
            .unwrap();
        assert_eq!(recovered.snapshot, prepared.snapshot);
        assert_eq!(recovered.servers, prepared.servers);
        drop(database);
        let _ = fs::remove_dir_all(root);
    }
}
