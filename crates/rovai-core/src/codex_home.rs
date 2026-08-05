use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::{
        fd::AsRawFd,
        unix::fs::{OpenOptionsExt, PermissionsExt, symlink},
    },
    path::{Component, Path, PathBuf},
    time::{Duration, SystemTime},
};

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{command::canonical_json_digest, db::Database, mcp::McpServerDefinition};

const CODEX_HOME_SCHEMA_VERSION: u32 = 1;
const OWNER_MARKER_NAME: &str = ".rovai-home.json";
const HOME_LOCK_NAME: &str = ".rovai-home.lock";
const CONFIG_NAME: &str = "config.toml";
const MAX_CONFIG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MARKER_BYTES: u64 = 64 * 1024;
const DEFAULT_ORPHAN_RETENTION_HOURS: u64 = 72;
const MAX_CLEANUP_BATCH: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CodexHomeMarker {
    schema_version: u32,
    camp_id: String,
    agent_profile_id: String,
    created_at: String,
    updated_at: String,
    config_generation: u64,
    external_mcp_digest: String,
}

#[derive(Debug)]
pub struct PreparedCodexHome {
    pub path: PathBuf,
    pub config_generation: u64,
    pub external_mcp_digest: String,
    pub created_or_rebuilt: bool,
    _guard: CodexHomeGuard,
}

#[derive(Debug)]
struct CodexHomeGuard {
    _file: File,
}

#[derive(Debug, Clone)]
pub struct CodexHomeManager {
    root: PathBuf,
    user_codex_home: PathBuf,
    orphan_retention: Duration,
}

impl CodexHomeManager {
    pub fn new(data_dir: &Path) -> Result<Self> {
        let user_home = dirs::home_dir().context("failed to locate the user home directory")?;
        let retention_hours = std::env::var("ROVAI_CODEX_HOME_ORPHAN_RETENTION_HOURS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(DEFAULT_ORPHAN_RETENTION_HOURS)
            .max(DEFAULT_ORPHAN_RETENTION_HOURS);
        Ok(Self {
            root: data_dir.join("codex-homes"),
            user_codex_home: user_home.join(".codex"),
            orphan_retention: Duration::from_secs(retention_hours.saturating_mul(60 * 60)),
        })
    }

    #[cfg(test)]
    fn with_roots(data_dir: &Path, user_codex_home: &Path, orphan_retention: Duration) -> Self {
        Self {
            root: data_dir.join("codex-homes"),
            user_codex_home: user_codex_home.to_path_buf(),
            orphan_retention,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn prepare_agent_run_home(
        &self,
        camp_id: &str,
        agent_profile_id: &str,
        execution_root: &Path,
        external_servers: &BTreeMap<String, McpServerDefinition>,
    ) -> Result<PreparedCodexHome> {
        validate_path_segment(camp_id, "Camp ID")?;
        validate_path_segment(agent_profile_id, "AgentProfile ID")?;
        let execution_root = execution_root.canonicalize().with_context(|| {
            format!(
                "failed to resolve execution root {}",
                execution_root.display()
            )
        })?;
        if !execution_root.is_dir() {
            bail!("Codex execution root is not a directory");
        }

        ensure_private_directory(&self.root)?;
        let camp_root = self.root.join(camp_id);
        ensure_private_directory(&camp_root)?;
        let home = camp_root.join(agent_profile_id);
        let home_existed = home.exists();
        ensure_private_directory(&home)?;
        let guard = acquire_home_guard(&home)?;

        let marker_path = home.join(OWNER_MARKER_NAME);
        let config_path = home.join(CONFIG_NAME);
        let mut created_or_rebuilt = !home_existed;
        let mut marker = if marker_path.exists() {
            let marker: CodexHomeMarker = read_json_file(&marker_path, MAX_MARKER_BYTES)?;
            validate_marker(&marker, camp_id, agent_profile_id)?;
            marker
        } else {
            if home_existed && !directory_contains_only_lock(&home)? {
                reset_home_while_locked(&home)?;
                created_or_rebuilt = true;
            }
            new_marker(camp_id, agent_profile_id, external_servers)?
        };

        let mut config = if marker_path.exists() && config_path.exists() {
            match read_toml_table(&config_path) {
                Ok(config) => config,
                Err(_) => {
                    reset_home_while_locked(&home)?;
                    created_or_rebuilt = true;
                    marker = new_marker(camp_id, agent_profile_id, external_servers)?;
                    read_user_config_snapshot(&self.user_codex_home)?
                }
            }
        } else if marker_path.exists() {
            reset_home_while_locked(&home)?;
            created_or_rebuilt = true;
            marker = new_marker(camp_id, agent_profile_id, external_servers)?;
            read_user_config_snapshot(&self.user_codex_home)?
        } else {
            read_user_config_snapshot(&self.user_codex_home)?
        };

        sanitize_and_project_config(&mut config, &execution_root, external_servers)?;
        let config_bytes = toml::to_string_pretty(&config)
            .context("failed to serialize isolated Codex config")?
            .into_bytes();
        let existing_bytes = read_optional_limited(&config_path, MAX_CONFIG_BYTES)?;
        let config_changed = existing_bytes.as_deref() != Some(config_bytes.as_slice());
        if config_changed {
            atomic_write_private(&config_path, &config_bytes)?;
            if marker_path.exists() {
                marker.config_generation = marker.config_generation.saturating_add(1);
            }
        }

        ensure_shared_link(
            &self.user_codex_home.join("auth.json"),
            &home.join("auth.json"),
            SharedLinkKind::File,
        )?;
        ensure_shared_link(
            &self.user_codex_home.join("plugins"),
            &home.join("plugins"),
            SharedLinkKind::Directory,
        )?;

        let external_mcp_digest = external_mcp_digest(external_servers)?;
        let marker_changed = marker.external_mcp_digest != external_mcp_digest
            || config_changed
            || !marker_path.exists();
        if marker_changed {
            marker.external_mcp_digest = external_mcp_digest.clone();
            marker.updated_at = Utc::now().to_rfc3339();
            atomic_write_json_private(&marker_path, &marker)?;
        }

        Ok(PreparedCodexHome {
            path: home,
            config_generation: marker.config_generation,
            external_mcp_digest,
            created_or_rebuilt,
            _guard: guard,
        })
    }

    pub fn prepare_job_home(
        &self,
        job_root: &Path,
        execution_root: &Path,
    ) -> Result<PreparedCodexHome> {
        let execution_root = execution_root.canonicalize().with_context(|| {
            format!(
                "failed to resolve job execution root {}",
                execution_root.display()
            )
        })?;
        let home = job_root.join("codex-home");
        if home.exists() {
            bail!("job-scoped Codex Home already exists");
        }
        ensure_private_directory(&home)?;
        let guard = acquire_home_guard(&home)?;
        let mut config = toml::Table::new();
        sanitize_and_project_config(&mut config, &execution_root, &BTreeMap::new())?;
        atomic_write_private(
            &home.join(CONFIG_NAME),
            toml::to_string_pretty(&config)
                .context("failed to serialize job-scoped Codex config")?
                .as_bytes(),
        )?;
        ensure_shared_link(
            &self.user_codex_home.join("auth.json"),
            &home.join("auth.json"),
            SharedLinkKind::File,
        )?;
        Ok(PreparedCodexHome {
            path: home,
            config_generation: 1,
            external_mcp_digest: external_mcp_digest(&BTreeMap::new())?,
            created_or_rebuilt: true,
            _guard: guard,
        })
    }

    pub fn due_cleanup_camp_ids(
        &self,
        database: &Database,
        now: DateTime<Utc>,
    ) -> Result<Vec<String>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT camp_id
            FROM codex_home_cleanup
            WHERE next_retry_at IS NULL OR next_retry_at <= ?1
            ORDER BY requested_at ASC
            LIMIT ?2
            "#,
        )?;
        Ok(statement
            .query_map(params![now.to_rfc3339(), MAX_CLEANUP_BATCH as i64], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn cleanup_camp_now(&self, camp_id: &str) -> Result<()> {
        validate_path_segment(camp_id, "Camp ID")?;
        if !self.root.exists() {
            return Ok(());
        }
        ensure_private_directory(&self.root)?;
        let camp_root = self.root.join(camp_id);
        let metadata = match fs::symlink_metadata(&camp_root) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            bail!("refusing to clean a non-directory Codex Camp Home");
        }
        let _guards = validate_and_lock_camp_home(&camp_root, camp_id)?;
        remove_path_without_following_links(&camp_root)
            .with_context(|| format!("failed to remove Codex Camp Home for {camp_id}"))
    }

    pub fn record_cleanup_success(&self, database: &mut Database, camp_id: &str) -> Result<()> {
        database.connection_mut().execute(
            "DELETE FROM codex_home_cleanup WHERE camp_id = ?1",
            [camp_id],
        )?;
        Ok(())
    }

    pub fn record_cleanup_failure(
        &self,
        database: &mut Database,
        camp_id: &str,
        now: DateTime<Utc>,
        error: &anyhow::Error,
    ) -> Result<()> {
        let attempts = database
            .connection()
            .query_row(
                "SELECT attempt_count FROM codex_home_cleanup WHERE camp_id = ?1",
                [camp_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0)
            .saturating_add(1);
        let exponent = u32::try_from(attempts.clamp(0, 8)).unwrap_or(8);
        let retry_seconds = 5_i64.saturating_mul(2_i64.saturating_pow(exponent));
        let next_retry_at = now + chrono::Duration::seconds(retry_seconds.min(3600));
        let diagnostic = redact_cleanup_error(error);
        database.connection_mut().execute(
            r#"
            UPDATE codex_home_cleanup
            SET attempt_count = ?2, last_error = ?3,
                next_retry_at = ?4, updated_at = ?5
            WHERE camp_id = ?1
            "#,
            params![
                camp_id,
                attempts,
                diagnostic,
                next_retry_at.to_rfc3339(),
                now.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn collect_orphans(&self, database: &Database, now: SystemTime) -> Result<usize> {
        if !self.root.exists() {
            return Ok(0);
        }
        ensure_private_directory(&self.root)?;
        let camp_ids = database
            .connection()
            .prepare("SELECT id FROM camp")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<BTreeSet<_>>>()?;
        let cleanup_ids = database
            .connection()
            .prepare("SELECT camp_id FROM codex_home_cleanup")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<BTreeSet<_>>>()?;
        let mut removed = 0;
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let camp_id = match entry.file_name().into_string() {
                Ok(value) if validate_path_segment(&value, "Camp ID").is_ok() => value,
                _ => continue,
            };
            if camp_ids.contains(&camp_id) || cleanup_ids.contains(&camp_id) {
                continue;
            }
            let metadata = fs::symlink_metadata(entry.path())?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                continue;
            }
            let modified = metadata.modified()?;
            let age = match now.duration_since(modified) {
                Ok(age) => age,
                Err(_) => continue,
            };
            if age < self.orphan_retention {
                continue;
            }
            remove_path_without_following_links(&entry.path())
                .with_context(|| format!("failed to remove orphan Codex Camp Home {camp_id}"))?;
            removed += 1;
        }
        Ok(removed)
    }
}

pub fn enqueue_camp_home_cleanup(connection: &Connection, camp_id: &str) -> Result<()> {
    validate_path_segment(camp_id, "Camp ID")?;
    let now = Utc::now().to_rfc3339();
    connection.execute(
        r#"
        INSERT INTO codex_home_cleanup(
            camp_id, requested_at, attempt_count, last_error,
            next_retry_at, updated_at
        ) VALUES (?1, ?2, 0, NULL, NULL, ?2)
        ON CONFLICT(camp_id) DO UPDATE SET
            next_retry_at = NULL,
            updated_at = excluded.updated_at
        "#,
        params![camp_id, now],
    )?;
    Ok(())
}

fn new_marker(
    camp_id: &str,
    agent_profile_id: &str,
    external_servers: &BTreeMap<String, McpServerDefinition>,
) -> Result<CodexHomeMarker> {
    let now = Utc::now().to_rfc3339();
    Ok(CodexHomeMarker {
        schema_version: CODEX_HOME_SCHEMA_VERSION,
        camp_id: camp_id.to_string(),
        agent_profile_id: agent_profile_id.to_string(),
        created_at: now.clone(),
        updated_at: now,
        config_generation: 1,
        external_mcp_digest: external_mcp_digest(external_servers)?,
    })
}

fn validate_marker(marker: &CodexHomeMarker, camp_id: &str, agent_profile_id: &str) -> Result<()> {
    if marker.schema_version != CODEX_HOME_SCHEMA_VERSION {
        bail!("Codex Home schema requires an explicit migration");
    }
    if marker.camp_id != camp_id || marker.agent_profile_id != agent_profile_id {
        bail!("Codex Home owner marker does not match the requested Camp member");
    }
    if marker.config_generation == 0 {
        bail!("Codex Home owner marker has an invalid config generation");
    }
    Ok(())
}

fn validate_path_segment(value: &str, label: &str) -> Result<()> {
    if value.is_empty() || value == "." || value == ".." || value.len() > 255 {
        bail!("{label} is not a safe path segment");
    }
    let path = Path::new(value);
    let mut components = path.components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
        bail!("{label} is not a safe path segment");
    }
    Ok(())
}

fn ensure_private_directory(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                bail!("{} is not a safe Rovai-owned directory", path.display());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path)
                .with_context(|| format!("failed to create {}", path.display()))?;
            let metadata = fs::symlink_metadata(path)?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                bail!("{} is not a safe Rovai-owned directory", path.display());
            }
        }
        Err(error) => return Err(error.into()),
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn acquire_home_guard(home: &Path) -> Result<CodexHomeGuard> {
    let lock_path = home.join(HOME_LOCK_NAME);
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(&lock_path)
        .with_context(|| format!("failed to open Codex Home lock {}", lock_path.display()))?;
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result != 0 {
        bail!("Codex Home is already owned by another active process");
    }
    Ok(CodexHomeGuard { _file: file })
}

fn validate_and_lock_camp_home(camp_root: &Path, camp_id: &str) -> Result<Vec<CodexHomeGuard>> {
    let mut guards = Vec::new();
    for entry in fs::read_dir(camp_root)? {
        let entry = entry?;
        let agent_profile_id = entry
            .file_name()
            .into_string()
            .map_err(|_| anyhow::anyhow!("Codex Home member directory is not valid UTF-8"))?;
        validate_path_segment(&agent_profile_id, "AgentProfile ID")?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            bail!("Codex Camp Home contains an unsafe member path");
        }
        let guard = acquire_home_guard(&entry.path())?;
        let marker_path = entry.path().join(OWNER_MARKER_NAME);
        if marker_path.exists() {
            let marker: CodexHomeMarker = read_json_file(&marker_path, MAX_MARKER_BYTES)?;
            validate_marker(&marker, camp_id, &agent_profile_id)?;
        }
        guards.push(guard);
    }
    Ok(guards)
}

fn directory_contains_only_lock(home: &Path) -> Result<bool> {
    for entry in fs::read_dir(home)? {
        if entry?.file_name() != HOME_LOCK_NAME {
            return Ok(false);
        }
    }
    Ok(true)
}

fn reset_home_while_locked(home: &Path) -> Result<()> {
    for entry in fs::read_dir(home)? {
        let entry = entry?;
        if entry.file_name() == HOME_LOCK_NAME {
            continue;
        }
        remove_path_without_following_links(&entry.path())?;
    }
    Ok(())
}

fn read_user_config_snapshot(user_codex_home: &Path) -> Result<toml::Table> {
    let path = user_codex_home.join(CONFIG_NAME);
    match fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() => read_toml_table(&path).with_context(|| {
            format!(
                "failed to parse user Codex config {}; it was not modified",
                path.display()
            )
        }),
        Ok(_) => bail!("user Codex config path is not a regular file"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(toml::Table::new()),
        Err(error) => Err(error.into()),
    }
}

fn read_toml_table(path: &Path) -> Result<toml::Table> {
    let bytes = read_limited(path, MAX_CONFIG_BYTES)?;
    let text = std::str::from_utf8(&bytes).context("Codex config is not valid UTF-8")?;
    toml::from_str::<toml::Table>(text).context("Codex config is not valid TOML")
}

fn sanitize_and_project_config(
    config: &mut toml::Table,
    execution_root: &Path,
    external_servers: &BTreeMap<String, McpServerDefinition>,
) -> Result<()> {
    config.remove("mcp_servers");
    let projects = config
        .entry("projects".to_string())
        .or_insert_with(|| toml::Value::Table(toml::Table::new()));
    let projects = projects
        .as_table_mut()
        .context("user Codex projects setting must be a table")?;
    let mut project = projects
        .get(execution_root.to_string_lossy().as_ref())
        .and_then(toml::Value::as_table)
        .cloned()
        .unwrap_or_default();
    project.insert(
        "trust_level".to_string(),
        toml::Value::String("untrusted".to_string()),
    );
    projects.insert(
        execution_root.to_string_lossy().into_owned(),
        toml::Value::Table(project),
    );

    let mut mcp_servers = toml::Table::new();
    for (name, definition) in external_servers {
        validate_mcp_name(name)?;
        mcp_servers.insert(name.clone(), codex_mcp_toml(definition)?);
    }
    config.insert("mcp_servers".to_string(), toml::Value::Table(mcp_servers));
    Ok(())
}

fn validate_mcp_name(name: &str) -> Result<()> {
    if name.trim().is_empty() || name == "rovai_team" || name.contains('\0') {
        bail!("invalid or reserved Codex MCP server name");
    }
    Ok(())
}

fn codex_mcp_toml(definition: &McpServerDefinition) -> Result<toml::Value> {
    let mut server = toml::Table::new();
    match definition {
        McpServerDefinition::Stdio {
            command,
            args,
            cwd,
            env,
        } => {
            server.insert("command".to_string(), toml::Value::String(command.clone()));
            server.insert(
                "args".to_string(),
                toml::Value::Array(args.iter().cloned().map(toml::Value::String).collect()),
            );
            if let Some(cwd) = cwd {
                server.insert("cwd".to_string(), toml::Value::String(cwd.clone()));
            }
            server.insert("env".to_string(), string_map_to_toml(env));
        }
        McpServerDefinition::StreamableHttp { url, headers } => {
            server.insert("url".to_string(), toml::Value::String(url.clone()));
            server.insert("http_headers".to_string(), string_map_to_toml(headers));
        }
    }
    server.insert("enabled".to_string(), toml::Value::Boolean(true));
    Ok(toml::Value::Table(server))
}

fn string_map_to_toml(values: &BTreeMap<String, String>) -> toml::Value {
    toml::Value::Table(
        values
            .iter()
            .map(|(key, value)| (key.clone(), toml::Value::String(value.clone())))
            .collect(),
    )
}

fn external_mcp_digest(external_servers: &BTreeMap<String, McpServerDefinition>) -> Result<String> {
    canonical_json_digest(&json!({
        "domain": "rovai.codex-home.external-mcp.v1",
        "servers": external_servers,
    }))
}

#[derive(Debug, Clone, Copy)]
enum SharedLinkKind {
    File,
    Directory,
}

fn ensure_shared_link(source: &Path, destination: &Path, kind: SharedLinkKind) -> Result<()> {
    let source_metadata = match fs::metadata(source) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let valid_source = match kind {
        SharedLinkKind::File => source_metadata.is_file(),
        SharedLinkKind::Directory => source_metadata.is_dir(),
    };
    if !valid_source {
        bail!("shared Codex state source has an unexpected file type");
    }
    match fs::symlink_metadata(destination) {
        Ok(metadata) => {
            if !metadata.file_type().is_symlink() {
                bail!("isolated Codex shared-state path is not a symlink");
            }
            let target = fs::read_link(destination)?;
            if target != source {
                bail!("isolated Codex shared-state symlink has an unexpected target");
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => symlink(source, destination)
            .with_context(|| {
                format!(
                    "failed to link shared Codex state {} to {}",
                    source.display(),
                    destination.display()
                )
            }),
        Err(error) => Err(error.into()),
    }
}

fn atomic_write_json_private<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    atomic_write_private(path, &bytes)
}

fn atomic_write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("private file has no parent")?;
    ensure_private_directory(parent)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .context("private file name is not valid UTF-8")?;
    let temporary = parent.join(format!(".{file_name}.tmp-{}", uuid::Uuid::new_v4()));
    let result = (|| -> Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn read_optional_limited(path: &Path, limit: u64) -> Result<Option<Vec<u8>>> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => read_limited(path, limit).map(Some),
        Ok(_) => bail!("{} is not a regular file", path.display()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let metadata = fs::metadata(path)?;
    if !metadata.is_file() || metadata.len() > limit {
        bail!("{} is not a bounded regular file", path.display());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(path)?
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        bail!("{} exceeds the allowed size", path.display());
    }
    Ok(bytes)
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path, limit: u64) -> Result<T> {
    serde_json::from_slice(&read_limited(path, limit)?).context("invalid Codex Home marker")
}

fn remove_path_without_following_links(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        fs::remove_file(path)?;
        return Ok(());
    }
    for entry in fs::read_dir(path)? {
        remove_path_without_following_links(&entry?.path())?;
    }
    fs::remove_dir(path)?;
    Ok(())
}

fn redact_cleanup_error(error: &anyhow::Error) -> String {
    let summary = error
        .chain()
        .next()
        .map(ToString::to_string)
        .unwrap_or_else(|| "Codex Home cleanup failed".to_string());
    if summary.chars().count() > 512 {
        format!("{}…", summary.chars().take(511).collect::<String>())
    } else {
        summary
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn fixture() -> (PathBuf, PathBuf, CodexHomeManager) {
        let root =
            std::env::temp_dir().join(format!("rovai-codex-home-test-{}", uuid::Uuid::new_v4()));
        let user_home = root.join("user-codex");
        fs::create_dir_all(&user_home).unwrap();
        let manager =
            CodexHomeManager::with_roots(&root.join("data"), &user_home, Duration::from_millis(10));
        (root, user_home, manager)
    }

    #[test]
    fn user_config_is_copied_without_ambient_mcp_and_shared_state_is_linked() {
        let (root, user_home, manager) = fixture();
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        let original = br#"model = "user-model"

[plugins.sample]
enabled = true

[mcp_servers.context7]
command = "npx"
args = ["context7"]
"#;
        fs::write(user_home.join(CONFIG_NAME), original).unwrap();
        fs::write(user_home.join("auth.json"), b"secret-auth").unwrap();
        fs::create_dir_all(user_home.join("plugins")).unwrap();

        let servers = BTreeMap::from([(
            "context7".to_string(),
            McpServerDefinition::StreamableHttp {
                url: "https://example.test/mcp".to_string(),
                headers: BTreeMap::from([("Authorization".to_string(), "secret".to_string())]),
            },
        )]);
        let prepared = manager
            .prepare_agent_run_home("camp-1", "agent-1", &workspace, &servers)
            .unwrap();
        let config = read_toml_table(&prepared.path.join(CONFIG_NAME)).unwrap();
        assert_eq!(config["model"].as_str(), Some("user-model"));
        assert_eq!(
            config["projects"][workspace.canonicalize().unwrap().to_string_lossy().as_ref()]
                ["trust_level"]
                .as_str(),
            Some("untrusted")
        );
        let context7 = config["mcp_servers"]["context7"].as_table().unwrap();
        assert_eq!(
            context7.get("url").and_then(toml::Value::as_str),
            Some("https://example.test/mcp")
        );
        assert!(!context7.contains_key("command"));
        assert!(config["mcp_servers"].get("rovai_team").is_none());
        assert_eq!(fs::read(user_home.join(CONFIG_NAME)).unwrap(), original);
        assert_eq!(
            fs::read_link(prepared.path.join("auth.json")).unwrap(),
            user_home.join("auth.json")
        );
        assert_eq!(
            fs::read_link(prepared.path.join("plugins")).unwrap(),
            user_home.join("plugins")
        );
        assert!(
            !fs::read_to_string(prepared.path.join(OWNER_MARKER_NAME))
                .unwrap()
                .contains("secret")
        );
        drop(prepared);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn existing_home_does_not_rebase_user_config_and_replaces_mcp_transport() {
        let (root, user_home, manager) = fixture();
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(user_home.join(CONFIG_NAME), "model = \"first\"\n").unwrap();
        let first_servers = BTreeMap::from([(
            "context7".to_string(),
            McpServerDefinition::StreamableHttp {
                url: "https://example.test/mcp".to_string(),
                headers: BTreeMap::new(),
            },
        )]);
        let first = manager
            .prepare_agent_run_home("camp-1", "agent-1", &workspace, &first_servers)
            .unwrap();
        let first_path = first.path.clone();
        drop(first);

        fs::write(user_home.join(CONFIG_NAME), "model = \"second\"\n").unwrap();
        let second_servers = BTreeMap::from([(
            "context7".to_string(),
            McpServerDefinition::Stdio {
                command: "node".to_string(),
                args: vec!["server.mjs".to_string()],
                cwd: None,
                env: BTreeMap::new(),
            },
        )]);
        let second = manager
            .prepare_agent_run_home("camp-1", "agent-1", &workspace, &second_servers)
            .unwrap();
        assert_eq!(second.path, first_path);
        assert!(!second.created_or_rebuilt);
        let config = read_toml_table(&second.path.join(CONFIG_NAME)).unwrap();
        assert_eq!(config["model"].as_str(), Some("first"));
        let context7 = config["mcp_servers"]["context7"].as_table().unwrap();
        assert_eq!(
            context7.get("command").and_then(toml::Value::as_str),
            Some("node")
        );
        assert!(!context7.contains_key("url"));
        drop(second);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_user_config_fails_without_modifying_the_source() {
        let (root, user_home, manager) = fixture();
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        let malformed = b"[mcp_servers.context7\ncommand = 'npx'\n";
        fs::write(user_home.join(CONFIG_NAME), malformed).unwrap();
        assert!(
            manager
                .prepare_agent_run_home("camp-1", "agent-1", &workspace, &BTreeMap::new())
                .is_err()
        );
        assert_eq!(fs::read(user_home.join(CONFIG_NAME)).unwrap(), malformed);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn markerless_partial_home_is_rebuilt_after_acquiring_its_lock() {
        let (root, user_home, manager) = fixture();
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(user_home.join(CONFIG_NAME), "model = \"snapshot\"\n").unwrap();
        let partial_home = manager.root().join("camp-1/agent-1");
        ensure_private_directory(&partial_home).unwrap();
        fs::write(partial_home.join(CONFIG_NAME), "model = \"partial\"\n").unwrap();
        fs::write(partial_home.join("partial-state"), "discard").unwrap();

        let prepared = manager
            .prepare_agent_run_home("camp-1", "agent-1", &workspace, &BTreeMap::new())
            .unwrap();
        assert!(prepared.created_or_rebuilt);
        let config = read_toml_table(&prepared.path.join(CONFIG_NAME)).unwrap();
        assert_eq!(config["model"].as_str(), Some("snapshot"));
        assert!(!prepared.path.join("partial-state").exists());
        assert!(prepared.path.join(OWNER_MARKER_NAME).is_file());
        drop(prepared);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_unlinks_shared_state_without_following_it() {
        let (root, user_home, manager) = fixture();
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(user_home.join("auth.json"), b"keep-me").unwrap();
        fs::create_dir_all(user_home.join("plugins")).unwrap();
        fs::write(user_home.join("plugins/keep"), b"keep-me-too").unwrap();
        let prepared = manager
            .prepare_agent_run_home("camp-1", "agent-1", &workspace, &BTreeMap::new())
            .unwrap();
        drop(prepared);
        manager.cleanup_camp_now("camp-1").unwrap();
        assert_eq!(fs::read(user_home.join("auth.json")).unwrap(), b"keep-me");
        assert_eq!(
            fs::read(user_home.join("plugins/keep")).unwrap(),
            b"keep-me-too"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn active_home_lock_fails_closed() {
        let (root, _user_home, manager) = fixture();
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        let first = manager
            .prepare_agent_run_home("camp-1", "agent-1", &workspace, &BTreeMap::new())
            .unwrap();
        let result =
            manager.prepare_agent_run_home("camp-1", "agent-1", &workspace, &BTreeMap::new());
        assert!(result.is_err());
        assert!(manager.cleanup_camp_now("camp-1").is_err());
        drop(first);
        manager.cleanup_camp_now("camp-1").unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unsafe_paths_and_foreign_owner_markers_fail_closed() {
        let (root, _user_home, manager) = fixture();
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();

        assert!(
            manager
                .prepare_agent_run_home("../camp", "agent-1", &workspace, &BTreeMap::new())
                .is_err()
        );

        ensure_private_directory(manager.root()).unwrap();
        let outside = root.join("outside");
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, manager.root().join("linked-camp")).unwrap();
        assert!(
            manager
                .prepare_agent_run_home("linked-camp", "agent-1", &workspace, &BTreeMap::new(),)
                .is_err()
        );

        let foreign_home = manager.root().join("camp-1/agent-1");
        ensure_private_directory(&foreign_home).unwrap();
        fs::write(
            foreign_home.join(OWNER_MARKER_NAME),
            serde_json::to_vec(&CodexHomeMarker {
                schema_version: CODEX_HOME_SCHEMA_VERSION,
                camp_id: "another-camp".to_string(),
                agent_profile_id: "agent-1".to_string(),
                created_at: Utc::now().to_rfc3339(),
                updated_at: Utc::now().to_rfc3339(),
                config_generation: 1,
                external_mcp_digest: "digest".to_string(),
            })
            .unwrap(),
        )
        .unwrap();
        assert!(
            manager
                .prepare_agent_run_home("camp-1", "agent-1", &workspace, &BTreeMap::new())
                .is_err()
        );
        assert!(manager.cleanup_camp_now("camp-1").is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_same_agent_in_different_camps_never_shares_a_home() {
        let (root, _user_home, manager) = fixture();
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        let first = manager
            .prepare_agent_run_home("camp-1", "agent-1", &workspace, &BTreeMap::new())
            .unwrap();
        let first_path = first.path.clone();
        drop(first);
        let second = manager
            .prepare_agent_run_home("camp-2", "agent-1", &workspace, &BTreeMap::new())
            .unwrap();
        assert_ne!(first_path, second.path);
        assert_eq!(first_path, manager.root().join("camp-1/agent-1"));
        assert_eq!(second.path, manager.root().join("camp-2/agent-1"));
        drop(second);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn orphan_gc_waits_for_retention_and_keeps_live_camps() {
        let (root, _user_home, manager) = fixture();
        let mut database = Database::open(&root.join("db")).unwrap();
        ensure_private_directory(manager.root()).unwrap();
        let orphan = manager.root().join("orphan-camp");
        ensure_private_directory(&orphan).unwrap();
        assert_eq!(
            manager
                .collect_orphans(&database, SystemTime::now())
                .unwrap(),
            0
        );
        thread::sleep(Duration::from_millis(20));
        assert_eq!(
            manager
                .collect_orphans(&database, SystemTime::now())
                .unwrap(),
            1
        );
        assert!(!orphan.exists());

        database
            .connection_mut()
            .execute(
                r#"
                INSERT INTO camp(
                    id, title, project_binding_kind, project_path,
                    created_at, updated_at
                ) VALUES (
                    'live-camp', 'Live Camp', 'directory', '/tmp/live-camp',
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                )
                "#,
                [],
            )
            .unwrap();
        let live = manager.root().join("live-camp");
        ensure_private_directory(&live).unwrap();
        thread::sleep(Duration::from_millis(20));
        assert_eq!(
            manager
                .collect_orphans(&database, SystemTime::now())
                .unwrap(),
            0
        );
        assert!(live.exists());

        enqueue_camp_home_cleanup(database.connection(), "cleanup-camp").unwrap();
        let retained = manager.root().join("cleanup-camp");
        ensure_private_directory(&retained).unwrap();
        thread::sleep(Duration::from_millis(20));
        assert_eq!(
            manager
                .collect_orphans(&database, SystemTime::now())
                .unwrap(),
            0
        );
        assert!(retained.exists());
        database
            .connection_mut()
            .execute("DELETE FROM codex_home_cleanup", [])
            .unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_failure_records_a_bounded_retry_without_requiring_the_camp_row() {
        let (root, _user_home, manager) = fixture();
        let mut database = Database::open(&root.join("db")).unwrap();
        enqueue_camp_home_cleanup(database.connection(), "deleted-camp").unwrap();
        let now = Utc::now();
        let error = anyhow::anyhow!("清理失败".repeat(200));
        manager
            .record_cleanup_failure(&mut database, "deleted-camp", now, &error)
            .unwrap();
        let (attempt_count, diagnostic, next_retry_at): (i64, String, String) = database
            .connection()
            .query_row(
                r#"
                SELECT attempt_count, last_error, next_retry_at
                FROM codex_home_cleanup WHERE camp_id = 'deleted-camp'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(attempt_count, 1);
        assert!(diagnostic.chars().count() <= 512);
        assert!(DateTime::parse_from_rfc3339(&next_retry_at).unwrap() > now);

        manager
            .record_cleanup_success(&mut database, "deleted-camp")
            .unwrap();
        let remaining: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM codex_home_cleanup", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(remaining, 0);
        fs::remove_dir_all(root).unwrap();
    }
}
