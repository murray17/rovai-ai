use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::command::canonical_json_digest;

pub const ANTIGRAVITY_TEAM_SERVER_NAME: &str = "rovai_team";
pub const ANTIGRAVITY_TEAM_TOOL_NAME: &str = "post_message";
pub const ANTIGRAVITY_TEAM_PERMISSION: &str = "mcp(rovai_team/post_message)";
pub const ANTIGRAVITY_TEAM_BRIDGE_SUBCOMMAND: &str = "attested-team-mcp-bridge";

const PLUGIN_NAME: &str = "rovai-team";
const OWNERSHIP_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AntigravityManagedConfigState {
    Ready,
    NotInstalled,
    Conflict,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AntigravityPermissionState {
    Ready,
    ConsentRequired,
    BlockedByAskOrDeny,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityTeamConfigStatus {
    pub managed_config: AntigravityManagedConfigState,
    pub permission: AntigravityPermissionState,
    pub ambient_mcp_isolation: &'static str,
    pub diagnostic_code: Option<String>,
}

impl AntigravityTeamConfigStatus {
    pub fn attachment_ready(&self) -> bool {
        self.managed_config == AntigravityManagedConfigState::Ready
            && self.permission == AntigravityPermissionState::Ready
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OwnershipRecord {
    schema_version: u32,
    plugin_path: String,
    plugin_file_digest: String,
    mcp_file_digest: String,
    entry_digest: String,
    bridge_executable_fingerprint: String,
    permission_added_by_rovai: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PermissionJournal {
    schema_version: u32,
    target_path: String,
    before_digest: String,
    after_digest: String,
}

pub struct AntigravityTeamConfigManager {
    data_dir: PathBuf,
    gemini_root: PathBuf,
}

impl AntigravityTeamConfigManager {
    pub fn new(data_dir: &Path) -> Result<Self> {
        let home = dirs::home_dir().context("could not determine the current home directory")?;
        Ok(Self::with_gemini_root(data_dir, home.join(".gemini")))
    }

    pub fn with_gemini_root(data_dir: &Path, gemini_root: PathBuf) -> Self {
        Self {
            data_dir: data_dir.to_path_buf(),
            gemini_root,
        }
    }

    pub fn rendezvous_path(&self) -> PathBuf {
        #[cfg(unix)]
        let user_id = unsafe { libc::geteuid() };
        #[cfg(not(unix))]
        let user_id = 0_u32;
        std::env::temp_dir()
            .join(format!("rovai-attested-team-{user_id}"))
            .join("core.sock")
    }

    pub fn reconcile_plugin(
        &self,
        bridge_executable: &Path,
        bridge_executable_fingerprint: &str,
    ) -> Result<AntigravityTeamConfigStatus> {
        let _lock = self.lock()?;
        let plugin_dir = self.plugin_dir();
        let ownership = match self.load_ownership() {
            Ok(ownership) => ownership,
            Err(_) => {
                return self.status(
                    AntigravityManagedConfigState::Invalid,
                    Some("antigravity_team.ownership_invalid".to_string()),
                );
            }
        };
        let desired_entry = json!({
            "command": bridge_executable,
            "args": [
                ANTIGRAVITY_TEAM_BRIDGE_SUBCOMMAND,
                "--rendezvous",
                self.rendezvous_path()
            ]
        });
        let desired_entry_digest = canonical_json_digest(&desired_entry)?;

        let external_conflict = match self.find_external_conflict(&plugin_dir) {
            Ok(conflict) => conflict,
            Err(_) => {
                return self.status(
                    AntigravityManagedConfigState::Invalid,
                    Some("antigravity_team.ambient_config_invalid".to_string()),
                );
            }
        };
        if let Some(conflict) = external_conflict {
            return self.status(
                AntigravityManagedConfigState::Conflict,
                Some(format!("antigravity_team.config_conflict:{conflict}")),
            );
        }

        let plugin_dir_metadata = fs::symlink_metadata(&plugin_dir).ok();
        if let Some(metadata) = plugin_dir_metadata.as_ref() {
            if !metadata.file_type().is_dir() {
                return self.status(
                    AntigravityManagedConfigState::Conflict,
                    Some("antigravity_team.plugin_path_invalid".to_string()),
                );
            }
            let Some(record) = ownership.as_ref() else {
                return self.status(
                    AntigravityManagedConfigState::Conflict,
                    Some("antigravity_team.plugin_unowned".to_string()),
                );
            };
            if !self.installed_files_match(record)? {
                return self.status(
                    AntigravityManagedConfigState::Conflict,
                    Some("antigravity_team.plugin_ownership_diverged".to_string()),
                );
            }
        }

        let plugin_path = plugin_dir.join("plugin.json");
        let mcp_path = plugin_dir.join("mcp_config.json");
        let expected_plugin_bytes = plugin_path
            .exists()
            .then(|| fs::read(&plugin_path))
            .transpose()?;
        let expected_mcp_bytes = mcp_path.exists().then(|| fs::read(&mcp_path)).transpose()?;
        if let Some(record) = ownership.as_ref()
            && (expected_plugin_bytes
                .as_deref()
                .is_none_or(|bytes| bytes_digest(bytes) != record.plugin_file_digest)
                || expected_mcp_bytes
                    .as_deref()
                    .is_none_or(|bytes| bytes_digest(bytes) != record.mcp_file_digest))
        {
            return self.status(
                AntigravityManagedConfigState::Conflict,
                Some("antigravity_team.plugin_ownership_diverged".to_string()),
            );
        }

        fs::create_dir_all(&plugin_dir).with_context(|| {
            format!(
                "failed to create Antigravity Plugin {}",
                plugin_dir.display()
            )
        })?;
        restrict_directory(&plugin_dir)?;
        let plugin_document = json!({"name": PLUGIN_NAME});
        let mcp_document = json!({
            "mcpServers": {
                ANTIGRAVITY_TEAM_SERVER_NAME: desired_entry
            }
        });
        let plugin_bytes = pretty_json_bytes(&plugin_document)?;
        let mcp_bytes = pretty_json_bytes(&mcp_document)?;
        atomic_write_private_cas(
            &plugin_path,
            expected_plugin_bytes.as_deref(),
            &plugin_bytes,
        )?;
        atomic_write_private_cas(&mcp_path, expected_mcp_bytes.as_deref(), &mcp_bytes)?;

        let record = OwnershipRecord {
            schema_version: OWNERSHIP_SCHEMA_VERSION,
            plugin_path: plugin_dir.to_string_lossy().to_string(),
            plugin_file_digest: bytes_digest(&plugin_bytes),
            mcp_file_digest: bytes_digest(&mcp_bytes),
            entry_digest: desired_entry_digest,
            bridge_executable_fingerprint: bridge_executable_fingerprint.to_string(),
            permission_added_by_rovai: ownership
                .as_ref()
                .is_some_and(|record| record.permission_added_by_rovai),
        };
        self.write_ownership(&record)?;
        self.status(AntigravityManagedConfigState::Ready, None)
    }

    /// Startup may refresh only a Plugin that this same data directory already
    /// proves it owns. A missing ownership record never causes installation.
    pub fn reconcile_owned_plugin(
        &self,
        bridge_executable: &Path,
        bridge_executable_fingerprint: &str,
    ) -> Result<AntigravityTeamConfigStatus> {
        match self.load_ownership() {
            Ok(Some(_)) => self.reconcile_plugin(bridge_executable, bridge_executable_fingerprint),
            Ok(None) => self.inspect(None),
            Err(_) => self.status(
                AntigravityManagedConfigState::Invalid,
                Some("antigravity_team.ownership_invalid".to_string()),
            ),
        }
    }

    pub fn inspect(&self, workspace: Option<&Path>) -> Result<AntigravityTeamConfigStatus> {
        let plugin_dir = self.plugin_dir();
        let record = match self.load_ownership() {
            Ok(record) => record,
            Err(_) => {
                return self.status(
                    AntigravityManagedConfigState::Invalid,
                    Some("antigravity_team.ownership_invalid".to_string()),
                );
            }
        };
        let Some(record) = record else {
            return self.status(
                AntigravityManagedConfigState::NotInstalled,
                Some("antigravity_team.plugin_not_installed".to_string()),
            );
        };
        if !self.installed_files_match(&record).unwrap_or(false) {
            return self.status(
                AntigravityManagedConfigState::Conflict,
                Some("antigravity_team.plugin_ownership_diverged".to_string()),
            );
        }
        let external_conflict = match self.find_external_conflict(&plugin_dir) {
            Ok(conflict) => conflict,
            Err(_) => {
                return self.status(
                    AntigravityManagedConfigState::Invalid,
                    Some("antigravity_team.ambient_config_invalid".to_string()),
                );
            }
        };
        if let Some(conflict) = external_conflict {
            return self.status(
                AntigravityManagedConfigState::Conflict,
                Some(format!("antigravity_team.config_conflict:{conflict}")),
            );
        }
        if let Some(workspace) = workspace {
            let workspace_config = workspace.join(".agents").join("mcp_config.json");
            if config_contains_server(&workspace_config, ANTIGRAVITY_TEAM_SERVER_NAME)? {
                return self.status(
                    AntigravityManagedConfigState::Conflict,
                    Some("antigravity_team.workspace_conflict".to_string()),
                );
            }
        }
        self.status(AntigravityManagedConfigState::Ready, None)
    }

    /// This is deliberately a separate, user-triggered operation. Installing
    /// the credentialless Plugin never opts the user into native permission.
    pub fn grant_exact_permission(&self) -> Result<AntigravityTeamConfigStatus> {
        let _lock = self.lock()?;
        let settings_path = self.settings_path();
        self.recover_permission_journal()?;
        let before_bytes = settings_path
            .exists()
            .then(|| fs::read(&settings_path))
            .transpose()?;
        let mut document = match before_bytes.as_deref() {
            Some(bytes) if !bytes.is_empty() => serde_json::from_slice(bytes)?,
            _ => json!({}),
        };
        if !document.is_object() {
            anyhow::bail!("Antigravity settings root must be an object");
        }
        let permissions = ensure_object_field(&mut document, "permissions")?;
        if permission_array_blocks(permissions.get("deny"))
            || permission_array_blocks(permissions.get("ask"))
        {
            return self.status(
                AntigravityManagedConfigState::Ready,
                Some("antigravity_team.permission_precedence_conflict".to_string()),
            );
        }
        let allow = ensure_string_array_field(permissions, "allow")?;
        let already_present = allow
            .iter()
            .any(|value| value.as_str() == Some(ANTIGRAVITY_TEAM_PERMISSION));
        if !already_present {
            allow.push(Value::String(ANTIGRAVITY_TEAM_PERMISSION.to_string()));
            let bytes = pretty_json_bytes(&document)?;
            let journal = PermissionJournal {
                schema_version: OWNERSHIP_SCHEMA_VERSION,
                target_path: settings_path.to_string_lossy().to_string(),
                before_digest: optional_bytes_digest(before_bytes.as_deref()),
                after_digest: bytes_digest(&bytes),
            };
            atomic_write_private(
                &self.permission_journal_path(),
                &pretty_json_bytes(&journal)?,
            )?;
            atomic_write_preserving_mode_cas(&settings_path, before_bytes.as_deref(), &bytes)?;
            fs::remove_file(self.permission_journal_path())?;
            if let Some(mut ownership) = self.load_ownership()? {
                ownership.permission_added_by_rovai = true;
                self.write_ownership(&ownership)?;
            }
        }
        self.inspect(None)
    }

    fn status(
        &self,
        managed_config: AntigravityManagedConfigState,
        diagnostic_code: Option<String>,
    ) -> Result<AntigravityTeamConfigStatus> {
        let permission =
            permission_state(&self.settings_path()).unwrap_or(AntigravityPermissionState::Invalid);
        Ok(AntigravityTeamConfigStatus {
            managed_config,
            permission,
            ambient_mcp_isolation: "preserved_uncontrolled",
            diagnostic_code,
        })
    }

    fn plugin_dir(&self) -> PathBuf {
        self.gemini_root
            .join("config")
            .join("plugins")
            .join(PLUGIN_NAME)
    }

    fn settings_path(&self) -> PathBuf {
        self.gemini_root
            .join("antigravity-cli")
            .join("settings.json")
    }

    fn ownership_path(&self) -> PathBuf {
        self.data_dir
            .join("runtime-private")
            .join("antigravity-team")
            .join("ownership.json")
    }

    fn permission_journal_path(&self) -> PathBuf {
        self.data_dir
            .join("runtime-private")
            .join("antigravity-team")
            .join("permission-journal.json")
    }

    fn recover_permission_journal(&self) -> Result<()> {
        let path = self.permission_journal_path();
        if !path.exists() {
            return Ok(());
        }
        let journal: PermissionJournal = serde_json::from_slice(&fs::read(&path)?)?;
        if journal.schema_version != OWNERSHIP_SCHEMA_VERSION
            || Path::new(&journal.target_path) != self.settings_path()
        {
            anyhow::bail!("Antigravity permission journal identity is invalid");
        }
        let current = self
            .settings_path()
            .exists()
            .then(|| fs::read(self.settings_path()))
            .transpose()?;
        let digest = optional_bytes_digest(current.as_deref());
        if digest != journal.before_digest && digest != journal.after_digest {
            anyhow::bail!("Antigravity permission journal detected an external concurrent edit");
        }
        fs::remove_file(path)?;
        Ok(())
    }

    fn lock(&self) -> Result<FileLock> {
        let directory = self
            .data_dir
            .join("runtime-private")
            .join("antigravity-team");
        fs::create_dir_all(&directory)?;
        restrict_directory(&directory)?;
        FileLock::acquire(&directory.join("config.lock"))
    }

    fn load_ownership(&self) -> Result<Option<OwnershipRecord>> {
        let path = self.ownership_path();
        if !path.exists() {
            return Ok(None);
        }
        let record: OwnershipRecord = serde_json::from_slice(&fs::read(&path)?)
            .context("Antigravity Team Plugin ownership record is invalid")?;
        if record.schema_version != OWNERSHIP_SCHEMA_VERSION {
            anyhow::bail!("Antigravity Team Plugin ownership record version is unsupported");
        }
        Ok(Some(record))
    }

    fn write_ownership(&self, record: &OwnershipRecord) -> Result<()> {
        atomic_write_private(&self.ownership_path(), &pretty_json_bytes(record)?)
    }

    fn installed_files_match(&self, record: &OwnershipRecord) -> Result<bool> {
        let plugin_dir = self.plugin_dir();
        if Path::new(&record.plugin_path) != plugin_dir {
            return Ok(false);
        }
        if !fs::symlink_metadata(&plugin_dir).is_ok_and(|metadata| metadata.file_type().is_dir()) {
            return Ok(false);
        }
        let plugin = plugin_dir.join("plugin.json");
        let mcp = plugin_dir.join("mcp_config.json");
        if !is_regular_file_without_symlink(&plugin) || !is_regular_file_without_symlink(&mcp) {
            return Ok(false);
        }
        let plugin_bytes = fs::read(plugin)?;
        let mcp_bytes = fs::read(&mcp)?;
        if bytes_digest(&plugin_bytes) != record.plugin_file_digest
            || bytes_digest(&mcp_bytes) != record.mcp_file_digest
        {
            return Ok(false);
        }
        let document: Value = serde_json::from_slice(&mcp_bytes)?;
        let Some(entry) = document.pointer("/mcpServers/rovai_team") else {
            return Ok(false);
        };
        Ok(canonical_json_digest(entry)? == record.entry_digest)
    }

    fn find_external_conflict(&self, managed_plugin_dir: &Path) -> Result<Option<String>> {
        let global = self.gemini_root.join("config").join("mcp_config.json");
        if config_contains_server(&global, ANTIGRAVITY_TEAM_SERVER_NAME)? {
            return Ok(Some(global.to_string_lossy().to_string()));
        }
        let plugins = self.gemini_root.join("config").join("plugins");
        if !plugins.is_dir() {
            return Ok(None);
        }
        for entry in fs::read_dir(plugins)? {
            let entry = entry?;
            if !entry.path().is_dir() || entry.path() == managed_plugin_dir {
                continue;
            }
            let path = entry.path().join("mcp_config.json");
            if config_contains_server(&path, ANTIGRAVITY_TEAM_SERVER_NAME)? {
                return Ok(Some(path.to_string_lossy().to_string()));
            }
        }
        Ok(None)
    }
}

fn is_regular_file_without_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_file())
}

fn permission_state(path: &Path) -> Result<AntigravityPermissionState> {
    if !path.exists() {
        return Ok(AntigravityPermissionState::ConsentRequired);
    }
    let document: Value = serde_json::from_slice(&fs::read(path)?)
        .context("Antigravity CLI settings are invalid JSON")?;
    let permissions = document.get("permissions");
    if permission_array_blocks(permissions.and_then(|value| value.get("deny")))
        || permission_array_blocks(permissions.and_then(|value| value.get("ask")))
    {
        return Ok(AntigravityPermissionState::BlockedByAskOrDeny);
    }
    Ok(
        if string_array_contains(
            permissions.and_then(|value| value.get("allow")),
            ANTIGRAVITY_TEAM_PERMISSION,
        ) {
            AntigravityPermissionState::Ready
        } else {
            AntigravityPermissionState::ConsentRequired
        },
    )
}

fn permission_array_blocks(value: Option<&Value>) -> bool {
    value.and_then(Value::as_array).is_some_and(|values| {
        values.iter().filter_map(Value::as_str).any(|rule| {
            matches!(
                rule,
                ANTIGRAVITY_TEAM_PERMISSION
                    | "mcp(rovai_team/*)"
                    | "mcp(rovai_team)"
                    | "mcp(*)"
                    | "mcp"
            )
        })
    })
}

fn config_contains_server(path: &Path, server_name: &str) -> Result<bool> {
    if !path.exists() || fs::metadata(path)?.len() == 0 {
        return Ok(false);
    }
    let document: Value = serde_json::from_slice(&fs::read(path)?)
        .with_context(|| format!("Antigravity MCP config {} is invalid", path.display()))?;
    Ok(document
        .get("mcpServers")
        .and_then(Value::as_object)
        .is_some_and(|servers| servers.contains_key(server_name)))
}

fn ensure_object_field<'a>(
    value: &'a mut Value,
    key: &str,
) -> Result<&'a mut serde_json::Map<String, Value>> {
    let root = value
        .as_object_mut()
        .context("JSON root must be an object")?;
    let field = root.entry(key.to_string()).or_insert_with(|| json!({}));
    field
        .as_object_mut()
        .with_context(|| format!("{key} must be an object"))
}

fn ensure_string_array_field<'a>(
    object: &'a mut serde_json::Map<String, Value>,
    key: &str,
) -> Result<&'a mut Vec<Value>> {
    let value = object.entry(key.to_string()).or_insert_with(|| json!([]));
    let array = value
        .as_array_mut()
        .with_context(|| format!("permissions.{key} must be an array"))?;
    if array.iter().any(|entry| !entry.is_string()) {
        anyhow::bail!("permissions.{key} must contain only strings");
    }
    Ok(array)
}

fn string_array_contains(value: Option<&Value>, needle: &str) -> bool {
    value
        .and_then(Value::as_array)
        .is_some_and(|values| values.iter().any(|value| value.as_str() == Some(needle)))
}

fn pretty_json_bytes(value: &impl Serialize) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn bytes_digest(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn optional_bytes_digest(bytes: Option<&[u8]>) -> String {
    bytes
        .map(bytes_digest)
        .unwrap_or_else(|| "absent".to_string())
}

fn atomic_write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        restrict_directory(parent)?;
    }
    atomic_write(path, bytes, Some(0o600))
}

fn atomic_write_private_cas(path: &Path, expected: Option<&[u8]>, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        restrict_directory(parent)?;
    }
    atomic_write_cas(path, expected, bytes, Some(0o600), "managed Plugin")
}

fn atomic_write_preserving_mode_cas(
    path: &Path,
    expected: Option<&[u8]>,
    bytes: &[u8],
) -> Result<()> {
    #[cfg(unix)]
    let mode = if path.exists() {
        use std::os::unix::fs::PermissionsExt;
        Some(fs::metadata(path)?.permissions().mode() & 0o777)
    } else {
        Some(0o600)
    };
    #[cfg(not(unix))]
    let mode = None;
    atomic_write_cas(path, expected, bytes, mode, "Antigravity settings")
}

fn atomic_write_cas(
    path: &Path,
    expected: Option<&[u8]>,
    bytes: &[u8],
    mode: Option<u32>,
    description: &str,
) -> Result<()> {
    let parent = path.parent().context("managed config path has no parent")?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".rovai-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    if let Some(mode) = mode {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(mode);
    }
    let mut file = options.open(&temporary)?;
    let result = (|| -> Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        let current = path.exists().then(|| fs::read(path)).transpose()?;
        if current.as_deref() != expected {
            anyhow::bail!("{description} changed concurrently; update was not written");
        }
        fs::rename(&temporary, path)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn atomic_write(path: &Path, bytes: &[u8], mode: Option<u32>) -> Result<()> {
    let parent = path.parent().context("managed config path has no parent")?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".rovai-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    if let Some(mode) = mode {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(mode);
    }
    let mut file = options.open(&temporary)?;
    let result = (|| -> Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(unix)]
fn restrict_directory(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_directory(_path: &Path) -> Result<()> {
    Ok(())
}

struct FileLock(File);

impl FileLock {
    fn acquire(path: &Path) -> Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)?;
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
                anyhow::bail!("Antigravity Team config is being reconciled by another process");
            }
        }
        Ok(Self(file))
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let _ = unsafe { libc::flock(self.0.as_raw_fd(), libc::LOCK_UN) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (PathBuf, AntigravityTeamConfigManager) {
        let root = std::env::temp_dir().join(format!("rovai-agy-config-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let manager = AntigravityTeamConfigManager::with_gemini_root(
            &root.join("data"),
            root.join("home/.gemini"),
        );
        (root, manager)
    }

    #[test]
    fn plugin_ownership_divergence_fails_closed() {
        let (root, manager) = fixture();
        let executable = std::env::current_exe().unwrap();
        let ready = manager
            .reconcile_plugin(&executable, "sha256:test")
            .unwrap();
        assert_eq!(ready.managed_config, AntigravityManagedConfigState::Ready);
        fs::write(
            manager.plugin_dir().join("plugin.json"),
            b"{\"name\":\"user\"}\n",
        )
        .unwrap();
        let status = manager.inspect(None).unwrap();
        assert_eq!(
            status.managed_config,
            AntigravityManagedConfigState::Conflict
        );
        let second = manager
            .reconcile_plugin(&executable, "sha256:test")
            .unwrap();
        assert_eq!(
            second.managed_config,
            AntigravityManagedConfigState::Conflict
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn exact_permission_preserves_unknown_settings() {
        let (root, manager) = fixture();
        let executable = std::env::current_exe().unwrap();
        manager
            .reconcile_plugin(&executable, "sha256:test")
            .unwrap();
        let settings = manager.settings_path();
        fs::create_dir_all(settings.parent().unwrap()).unwrap();
        fs::write(
            &settings,
            b"{\"custom\":{\"keep\":true},\"permissions\":{\"allow\":[\"command(ls)\"]}}\n",
        )
        .unwrap();
        let status = manager.grant_exact_permission().unwrap();
        assert!(status.attachment_ready());
        let value: Value = serde_json::from_slice(&fs::read(settings).unwrap()).unwrap();
        assert_eq!(value.pointer("/custom/keep"), Some(&Value::Bool(true)));
        assert!(string_array_contains(
            value.pointer("/permissions/allow"),
            ANTIGRAVITY_TEAM_PERMISSION
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_same_name_is_never_overwritten() {
        let (root, manager) = fixture();
        let global = manager.gemini_root.join("config/mcp_config.json");
        fs::create_dir_all(global.parent().unwrap()).unwrap();
        fs::write(
            &global,
            b"{\"mcpServers\":{\"rovai_team\":{\"command\":\"user\"}}}\n",
        )
        .unwrap();
        let status = manager
            .reconcile_plugin(&std::env::current_exe().unwrap(), "sha256:test")
            .unwrap();
        assert_eq!(
            status.managed_config,
            AntigravityManagedConfigState::Conflict
        );
        assert!(!manager.plugin_dir().exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn managed_plugin_cas_rejects_a_concurrent_edit() {
        let (root, manager) = fixture();
        let path = manager.plugin_dir().join("plugin.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"external edit\n").unwrap();
        let error = atomic_write_private_cas(&path, Some(b"previous\n"), b"desired\n")
            .unwrap_err()
            .to_string();
        assert!(error.contains("changed concurrently"));
        assert_eq!(fs::read(&path).unwrap(), b"external edit\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn unowned_plugin_directory_symlink_is_a_conflict() {
        use std::os::unix::fs::symlink;

        let (root, manager) = fixture();
        let external = root.join("external-plugin");
        fs::create_dir_all(&external).unwrap();
        fs::create_dir_all(manager.plugin_dir().parent().unwrap()).unwrap();
        symlink(&external, manager.plugin_dir()).unwrap();
        let status = manager
            .reconcile_plugin(&std::env::current_exe().unwrap(), "sha256:test")
            .unwrap();
        assert_eq!(
            status.managed_config,
            AntigravityManagedConfigState::Conflict
        );
        assert!(!external.join("plugin.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
