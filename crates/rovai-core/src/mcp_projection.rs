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
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
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
    db::Database,
    mcp::{McpConfigIssue, McpConfigStore, McpServerDefinition},
};

#[cfg(windows)]
use crate::platform::private_storage::{
    admit_data_directory, commit_private_directory_temporary, create_private_bytes,
    create_private_directory, open_private_read_file_in_data_directory, prepare_data_directory,
};

const MCP_PROJECTION_SCHEMA_VERSION: u32 = 2;
pub(crate) const RUN_MCP_SNAPSHOT_LAYOUT: &str = "run_v1";
#[cfg(any(unix, windows))]
const MAX_PROJECTION_BYTES: u64 = 2 * 1024 * 1024;
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
    pub projection_digest: String,
    pub canonical_path: PathBuf,
    pub servers: BTreeMap<String, McpServerDefinition>,
}

impl PreparedMcpProjection {
    pub fn finalize_native_name_conflicts(&mut self, native_mcp_server_names: &BTreeSet<String>) {
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
pub struct McpProjectionService {
    root: PathBuf,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SnapshotLayout {
    Epoch,
    Run,
}

fn load_snapshot_layout(database: &Database, agent_run_id: &str) -> Result<SnapshotLayout> {
    let config: Option<String> = database
        .connection()
        .query_row(
            "SELECT effective_config_json FROM agent_run WHERE id = ?1",
            [agent_run_id],
            |row| row.get(0),
        )
        .optional()?;
    let config: serde_json::Value = config
        .map(|json| serde_json::from_str(&json))
        .transpose()
        .context("AgentRun effective config is invalid")?
        .unwrap_or_default();
    match config.get("mcpSnapshotLayout") {
        None => Ok(SnapshotLayout::Epoch),
        Some(value) if value.as_str() == Some(RUN_MCP_SNAPSHOT_LAYOUT) => Ok(SnapshotLayout::Run),
        Some(_) => anyhow::bail!("AgentRun {agent_run_id} has an unsupported MCP snapshot layout"),
    }
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
        config_store: Result<&McpConfigStore>,
        request: &McpProjectionRequest<'_>,
    ) -> Result<PreparedMcpProjection> {
        validate_request(request)?;
        let layout = load_snapshot_layout(database, request.agent_run_id)?;
        let frozen = load_frozen_projection(database, request.agent_run_id)?;
        let target = self.target_path(request.agent_run_id, request.execution_epoch, layout);
        // Directory presence alone is not publication: load must validate its
        // canonical file, including a winner committed during this check.
        if target.exists() {
            return self.load_and_validate(&target, request, frozen.as_ref());
        }
        if layout == SnapshotLayout::Epoch
            && let Some(previous) = self.find_previous(request, frozen.as_ref())?
        {
            self.publish_bytes(
                request.agent_run_id,
                request.execution_epoch,
                layout,
                &previous.0,
            )?;
            return self.load_and_validate(&target, request, frozen.as_ref());
        }
        if let Some(frozen) = frozen.as_ref() {
            let projection = empty_legacy_projection(request);
            if frozen == &projection.exposure {
                self.publish_projection(request, layout, &projection)?;
                return self.load_and_validate(&target, request, Some(frozen));
            }
            anyhow::bail!(
                "MCP projection is unavailable for frozen AgentRun {}",
                request.agent_run_id
            );
        }

        let projection = materialize_projection(config_store, request)?;
        self.publish_projection(request, layout, &projection)?;
        self.load_and_validate(&target, request, None)
    }

    pub fn cleanup_terminal(
        &self,
        database: &tokio::sync::Mutex<Database>,
        budget: &mut crate::maintenance_budget::MaintenanceBudget,
    ) -> usize {
        if let Err(error) =
            crate::camp_attachment_view::reject_existing_symlink_components(&self.root)
        {
            budget.report("MCP cleanup target", error);
            return 0;
        }
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return 0,
            Err(error) => {
                budget.report("MCP enumeration", error);
                return 0;
            }
        };
        let mut removed = 0;
        for entry in entries {
            if !budget.take() {
                break;
            }
            let result = (|| -> Result<bool> {
                let entry = entry?;
                if !entry.file_type()?.is_dir() {
                    return Ok(false);
                }
                let run_id = entry.file_name().to_string_lossy().into_owned();
                if Uuid::parse_str(&run_id).is_err() {
                    return Ok(false);
                }
                let discarded = {
                    let Ok(database) = database.try_lock() else {
                        return Ok(false);
                    };
                    let stopped: bool = database.connection().query_row(
                        "SELECT EXISTS(SELECT 1 FROM agent_run WHERE id=?1 AND status IN ('succeeded','failed','cancelled') AND cancel_acknowledged_at IS NOT NULL)",
                        [&run_id], |row| row.get(0),
                    )?;
                    // Neither directory age, a missing Run nor an unacknowledged
                    // terminal is evidence that a process no longer uses its files.
                    if !stopped {
                        return Ok(false);
                    }
                    ensure_snapshot_directory(&self.root)?;
                    ensure_snapshot_directory(&entry.path())?;
                    let discarded = self.root.join(format!("discard-{}", Uuid::new_v4()));
                    fs::rename(entry.path(), &discarded)?;
                    discarded
                };
                crate::maintenance_budget::remove_owned_tree(&discarded, budget)
            })();
            match result {
                Ok(true) => removed += 1,
                Ok(false) => {}
                Err(error) => budget.report("MCP cleanup", error),
            }
        }
        removed
    }

    fn find_previous(
        &self,
        request: &McpProjectionRequest<'_>,
        frozen: Option<&McpExposureSnapshot>,
    ) -> Result<Option<(Vec<u8>, String)>> {
        let run_root = self.run_root(request.agent_run_id);
        if !run_root.exists() {
            return Ok(None);
        }
        ensure_snapshot_directory(&run_root)?;
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
            validate_projection(&projection, frozen)?;
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
        layout: SnapshotLayout,
        projection: &ProjectionFile,
    ) -> Result<()> {
        let mut bytes = serde_json::to_vec_pretty(projection)?;
        bytes.push(b'\n');
        self.publish_bytes(
            request.agent_run_id,
            request.execution_epoch,
            layout,
            &bytes,
        )
    }

    #[cfg(unix)]
    fn publish_bytes(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        layout: SnapshotLayout,
        bytes: &[u8],
    ) -> Result<()> {
        prepare_snapshot_directory(&self.root)?;
        let run_root = self.run_root(agent_run_id);
        prepare_snapshot_directory(&run_root)?;
        let target = self.target_path(agent_run_id, execution_epoch, layout);
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
            if let Err(error) = fs::rename(&temporary, &target) {
                if layout == SnapshotLayout::Run && target.join("canonical.json").exists() {
                    // prepare still reads and validates the concurrent winner.
                    let _ = fs::remove_dir_all(&temporary);
                    return Ok(());
                }
                return Err(error.into());
            }
            File::open(&run_root)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&temporary);
        }
        result
    }

    #[cfg(windows)]
    fn publish_bytes(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        layout: SnapshotLayout,
        bytes: &[u8],
    ) -> Result<()> {
        prepare_snapshot_directory(&self.root)?;
        let run_root = self.run_root(agent_run_id);
        prepare_snapshot_directory(&run_root)?;
        let target = self.target_path(agent_run_id, execution_epoch, layout);
        if target.exists() {
            ensure_snapshot_directory(&target)?;
            return Ok(());
        }
        let temporary = run_root.join(format!(".{execution_epoch}-{}.tmp", Uuid::new_v4()));
        create_private_directory(&temporary)?;
        let result = (|| -> Result<()> {
            create_private_bytes(&temporary.join("canonical.json"), bytes)?;
            let committed = commit_private_directory_temporary(&temporary, &target);
            if committed.is_err()
                && layout == SnapshotLayout::Run
                && target.join("canonical.json").exists()
            {
                ensure_snapshot_directory(&target)?;
                let _ = fs::remove_dir_all(&temporary);
                return Ok(());
            }
            committed
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&temporary);
            if layout == SnapshotLayout::Epoch && target.exists() {
                ensure_snapshot_directory(&target)?;
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
        _layout: SnapshotLayout,
        _bytes: &[u8],
    ) -> Result<()> {
        anyhow::bail!("private MCP projection storage is unsupported on this platform")
    }

    fn load_and_validate(
        &self,
        target: &Path,
        request: &McpProjectionRequest<'_>,
        frozen: Option<&McpExposureSnapshot>,
    ) -> Result<PreparedMcpProjection> {
        ensure_snapshot_directory(target)?;
        let canonical_path = target.join("canonical.json");
        let (bytes, projection_digest) = read_private_projection_bytes(&canonical_path)?;
        let projection = parse_projection(&bytes, request)?;
        validate_projection(&projection, frozen)?;
        let snapshot = frozen.unwrap_or(&projection.exposure).clone();
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
            projection_digest,
            canonical_path,
            servers,
        })
    }

    fn run_root(&self, agent_run_id: &str) -> PathBuf {
        self.root.join(agent_run_id)
    }

    fn target_path(
        &self,
        agent_run_id: &str,
        execution_epoch: i64,
        layout: SnapshotLayout,
    ) -> PathBuf {
        self.run_root(agent_run_id).join(match layout {
            SnapshotLayout::Epoch => execution_epoch.to_string(),
            SnapshotLayout::Run => "snapshot".to_string(),
        })
    }
}

fn materialize_projection(
    config_store: Result<&McpConfigStore>,
    request: &McpProjectionRequest<'_>,
) -> Result<ProjectionFile> {
    let known = [request.agent_id.to_string()].into_iter().collect();
    let (view, config) = match config_store.and_then(|store| store.get_with_raw(&known)) {
        Ok(value) => value,
        Err(_) => {
            let capability =
                AgentRuntimeAdapterRegistry::default().mcp_projection(request.adapter_kind);
            let mut projection = empty_legacy_projection(request);
            projection.exposure.config_digest = "sha256:unavailable-mcp-config".into();
            projection.exposure.config_status = "invalid".into();
            projection.exposure.projection_mode = capability.external_mcp_projection;
            projection.exposure.same_name_policy = capability.same_name_policy;
            projection
                .exposure
                .warnings
                .push("mcp.config_unavailable".into());
            return Ok(projection);
        }
    };
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
    interpolate_environment_with(value, |variable| std::env::var(variable).ok())
}

fn interpolate_environment_with(
    value: &str,
    mut lookup: impl FnMut(&str) -> Option<String>,
) -> std::result::Result<String, ResolveError> {
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
            output.push_str(&lookup(variable).ok_or(ResolveError::MissingEnvironment)?);
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

/// Uses the same interpolation and host environment as projection, without starting a server.
pub(crate) fn environment_issues(definition: &McpServerDefinition) -> Vec<McpConfigIssue> {
    environment_issues_with(definition, |variable| std::env::var(variable).ok())
}

fn environment_issues_with(
    definition: &McpServerDefinition,
    mut lookup: impl FnMut(&str) -> Option<String>,
) -> Vec<McpConfigIssue> {
    let (field, values) = match definition {
        McpServerDefinition::Stdio { env, .. } => ("env", env),
        McpServerDefinition::StreamableHttp { headers, .. } => ("headers", headers),
    };
    let mut issues = Vec::new();
    for (key, value) in values {
        let mut missing = BTreeSet::new();
        let parsed = interpolate_environment_with(value, |variable| {
            Some(lookup(variable).unwrap_or_else(|| {
                missing.insert(variable.to_string());
                String::new()
            }))
        });
        if parsed.is_err() {
            issues.push(McpConfigIssue::new(
                "mcp.environment_reference_invalid",
                "待配置：此字段使用了不支持或不完整的环境变量引用。",
                Some(format!("{field}.{key}")),
            ));
        } else {
            for variable in missing {
                issues.push(McpConfigIssue::new(
                    "mcp.environment_reference_missing",
                    format!("待配置：环境变量 {variable} 在 MCP 启动环境中不可用。"),
                    Some(format!("{field}.{key}")),
                ));
            }
        }
    }
    issues
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
) -> Result<Option<McpExposureSnapshot>> {
    database
        .connection()
        .query_row(
            r#"
            SELECT mcp_exposure_json
            FROM context_manifest WHERE agent_run_id = ?1 AND source_delivery_id IS NULL
            "#,
            [agent_run_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|json| serde_json::from_str(&json).context("stored MCP exposure is invalid"))
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

fn validate_projection(
    projection: &ProjectionFile,
    frozen: Option<&McpExposureSnapshot>,
) -> Result<()> {
    if projection.exposure.schema_version != MCP_PROJECTION_SCHEMA_VERSION {
        anyhow::bail!("private MCP exposure schema is unsupported");
    }
    if let Some(frozen) = frozen {
        validate_frozen_exposure(&projection.exposure, frozen)?;
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
    let mut file = open_private_read_file_in_data_directory(path)?;
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
fn prepare_snapshot_directory(path: &Path) -> Result<()> {
    if path.exists() {
        return ensure_snapshot_directory(path);
    }
    // Protect new directories at creation; preserve existing permissions.
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .with_context(|| format!("failed to create private MCP directory {}", path.display()))?;
    ensure_snapshot_directory(path)
}

#[cfg(windows)]
fn prepare_snapshot_directory(path: &Path) -> Result<()> {
    prepare_data_directory(path)?;
    Ok(())
}

#[cfg(unix)]
fn ensure_snapshot_directory(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() {
        anyhow::bail!("private MCP path is not a directory: {}", path.display());
    }
    Ok(())
}

#[cfg(windows)]
fn ensure_snapshot_directory(path: &Path) -> Result<()> {
    admit_data_directory(path)?;
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn ensure_snapshot_directory(_path: &Path) -> Result<()> {
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

    fn broaden_directory_permissions(path: &Path) -> Vec<u8> {
        fs::create_dir_all(path).unwrap();
        #[cfg(unix)]
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        #[cfg(windows)]
        {
            let output = std::process::Command::new("icacls")
                .arg(path)
                .arg("/inheritance:e")
                .output()
                .unwrap();
            assert!(output.status.success(), "icacls failed: {output:?}");
            assert!(crate::platform::private_storage::admit_private_directory(path).is_err());
        }
        directory_permissions(path)
    }

    fn directory_permissions(path: &Path) -> Vec<u8> {
        #[cfg(unix)]
        {
            fs::metadata(path)
                .unwrap()
                .permissions()
                .mode()
                .to_ne_bytes()
                .to_vec()
        }
        #[cfg(windows)]
        {
            let output = std::process::Command::new("icacls")
                .arg(path)
                .output()
                .unwrap();
            assert!(output.status.success(), "icacls failed: {output:?}");
            output.stdout
        }
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
        // A restored, usable directory must not prevent even an empty MCP
        // projection. Keep directory permissions unchanged for both adapters.
        let root_permissions = broaden_directory_permissions(&service.root);
        for adapter in [AdapterKind::CodexCli, AdapterKind::ClaudeCodeCli] {
            let run_id = Uuid::new_v4().to_string();
            let run_root = service.run_root(&run_id);
            let permissions = broaden_directory_permissions(&run_root);
            let prepared = service
                .prepare(&database, Ok(&store), &request(&run_id, 1, &root, adapter))
                .unwrap();
            assert!(prepared.servers.is_empty());
            assert_eq!(prepared.snapshot.config_status, "ready");
            assert_eq!(directory_permissions(&run_root), permissions);
        }
        create_effective(
            &store,
            "docs",
            r#"{"command":"node","args":["server.js"],"env":{"API_TOKEN":"top-secret"}}"#,
        );
        let run_id = Uuid::new_v4().to_string();
        let prepared = service
            .prepare(
                &database,
                Ok(&store),
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
        assert!(open_private_read_file_in_data_directory(&prepared.canonical_path).is_ok());
        assert_eq!(directory_permissions(&service.root), root_permissions);
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
                Ok(&store),
                &request(&run_id, 1, &root, AdapterKind::CodexCli),
            )
            .unwrap();
        let directories = [
            service.root.clone(),
            service.run_root(&run_id),
            first.canonical_path.parent().unwrap().to_path_buf(),
        ];
        let permissions = directories
            .each_ref()
            .map(|path| broaden_directory_permissions(path));
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
                Ok(&store),
                &request(&run_id, 2, &root, AdapterKind::CodexCli),
            )
            .unwrap();
        assert_eq!(first.projection_digest, recovered.projection_digest);
        assert_ne!(first.canonical_path, recovered.canonical_path);
        assert!(first.canonical_path.exists());
        assert!(!service.run_root(&run_id).join("snapshot").exists());
        let McpServerDefinition::Stdio { command, .. } = &recovered.servers["docs"] else {
            panic!("expected stdio");
        };
        assert_eq!(command, "old-command");
        for (path, permissions) in directories.iter().zip(permissions) {
            assert_eq!(directory_permissions(path), permissions);
        }
        drop(database);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(feature = "extended-tests")]
    #[test]
    fn concurrent_run_snapshot_publishers_reuse_one_complete_winner() {
        // This filesystem race owns publication, independently of SQLite and
        // Context recovery. Either configuration may win, but both must read it.
        let root = std::env::temp_dir().join(format!("rovai-mcp-race-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let service = McpProjectionService::new(&root);
        broaden_directory_permissions(&service.root);
        let run_id = Uuid::new_v4().to_string();
        let request = request(&run_id, 1, &root, AdapterKind::CodexCli);
        let target = service.target_path(&run_id, 1, SnapshotLayout::Run);
        let barrier = std::sync::Barrier::new(2);
        let winners = std::thread::scope(|scope| {
            let publishers: Vec<_> = ["first", "second"]
                .into_iter()
                .map(|identity| {
                    let service = &service;
                    let request = &request;
                    let target = &target;
                    let barrier = &barrier;
                    scope.spawn(move || {
                        let mut projection = empty_legacy_projection(request);
                        projection.exposure.config_digest = identity.to_string();
                        barrier.wait();
                        service
                            .publish_projection(request, SnapshotLayout::Run, &projection)
                            .unwrap();
                        service.load_and_validate(target, request, None).unwrap()
                    })
                })
                .collect();
            publishers
                .into_iter()
                .map(|thread| thread.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert_eq!(winners[0].projection_digest, winners[1].projection_digest);
        assert_eq!(winners[0].canonical_path, winners[1].canonical_path);
        assert_eq!(fs::read_dir(service.run_root(&run_id)).unwrap().count(), 1);
        let permissions = broaden_directory_permissions(&target);
        assert_eq!(
            service
                .load_and_validate(&target, &request, None)
                .unwrap()
                .projection_digest,
            winners[0].projection_digest
        );
        assert_eq!(directory_permissions(&target), permissions);

        // An existing invalid winner is never overwritten or silently accepted.
        let bytes = fs::read(&winners[0].canonical_path).unwrap();
        let other_id = Uuid::new_v4().to_string();
        let other = McpProjectionRequest {
            agent_run_id: &other_id,
            ..request.clone()
        };
        assert!(service.load_and_validate(&target, &other, None).is_err());
        service
            .publish_bytes(&run_id, 2, SnapshotLayout::Run, b"replacement")
            .unwrap();
        assert_eq!(fs::read(&winners[0].canonical_path).unwrap(), bytes);
        fs::write(&winners[0].canonical_path, b"invalid winner").unwrap();
        service
            .publish_bytes(&run_id, 2, SnapshotLayout::Run, &bytes)
            .unwrap();
        assert!(service.load_and_validate(&target, &request, None).is_err());
        assert_eq!(
            fs::read(&winners[0].canonical_path).unwrap(),
            b"invalid winner"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn tampered_projection_is_rejected_and_unsupported_adapter_skips_external_mcp() {
        let (root, database, store, service) = fixture();
        create_effective(&store, "docs", r#"{"command":"node"}"#);
        let run_id = Uuid::new_v4().to_string();
        let unsupported = service
            .prepare(
                &database,
                Ok(&store),
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
                Ok(&store),
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
                    Ok(&store),
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
                Ok(&store),
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
        let database = tokio::sync::Mutex::new(database);
        let mut budget = crate::maintenance_budget::MaintenanceBudget::new(
            32,
            std::time::Duration::from_secs(1),
        );
        assert_eq!(service.cleanup_terminal(&database, &mut budget), 0);
        assert!(
            prepared.canonical_path.exists(),
            "unknown ownership preserves the snapshot"
        );
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
                Ok(&store),
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
        let lookup = |name: &str| match name {
            "DOCS_TOKEN" => Some("test-credential".to_string()),
            "EMPTY" => Some(String::new()),
            _ => None,
        };
        assert!(
            interpolate_environment_with("Bearer ${DOCS_TOKEN}", lookup).unwrap()
                == "Bearer test-credential"
        );
        assert_eq!(
            interpolate_environment_with("$${DOCS_TOKEN}", lookup).unwrap(),
            "${DOCS_TOKEN}"
        );
        for value in [
            "",
            "  info  ",
            "${EMPTY}",
            "Bearer ${DOCS_TOKEN}",
            "$${NOT_A_REFERENCE}",
        ] {
            let definition = McpServerDefinition::StreamableHttp {
                url: "https://example.com/mcp".into(),
                headers: BTreeMap::from([("Authorization".into(), value.into())]),
            };
            assert!(environment_issues_with(&definition, lookup).is_empty());
        }
        let definition = McpServerDefinition::StreamableHttp {
            url: "https://example.com/mcp".into(),
            headers: BTreeMap::from([(
                "Authorization".into(),
                "Bearer ${MISSING_A}-${MISSING_B}".into(),
            )]),
        };
        let issues = environment_issues_with(&definition, lookup);
        assert_eq!(issues.len(), 2);
        assert!(
            issues
                .iter()
                .all(|issue| issue.field.as_deref() == Some("headers.Authorization"))
        );
        assert!(issues[0].message.contains("MISSING_A") && issues[1].message.contains("MISSING_B"));
        let definition = McpServerDefinition::StreamableHttp {
            url: "https://example.com/mcp".into(),
            headers: BTreeMap::from([(
                "Authorization".into(),
                "private-prefix-${INVALID:-private-fallback}".into(),
            )]),
        };
        let issues = environment_issues_with(&definition, lookup);
        assert_eq!(issues[0].code, "mcp.environment_reference_invalid");
        assert!(!serde_json::to_string(&issues).unwrap().contains("private-"));
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
        let mut prepared = service
            .prepare(&database, Ok(&store), &codex_request)
            .unwrap();
        prepared.finalize_native_name_conflicts(&BTreeSet::from(["Docs".to_string()]));
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
            .prepare(&database, Ok(&store), &recovered_request)
            .unwrap();
        recovered.finalize_native_name_conflicts(&BTreeSet::from(["docs".to_string()]));
        assert_eq!(recovered.snapshot, prepared.snapshot);
        assert_eq!(recovered.servers, prepared.servers);
        drop(database);
        let _ = fs::remove_dir_all(root);
    }
}
