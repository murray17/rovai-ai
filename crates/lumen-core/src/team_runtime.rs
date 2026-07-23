use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use lumen_core::team_tool::{TEAM_TOOL_NAMES, TeamToolBindingCredential};
use serde_json::{Value, json};

pub const TEAM_MCP_SERVER_NAME: &str = "lumen_team";
pub const TEAM_MCP_BRIDGE_SUBCOMMAND: &str = "team-mcp-bridge";

const CORE_SOCKET_ENV: &str = "LUMEN_TEAM_CORE_SOCKET";
const NATIVE_BINDING_ID_ENV: &str = "LUMEN_TEAM_NATIVE_BINDING_ID";
const BINDING_CREDENTIAL_ENV: &str = "LUMEN_TEAM_BINDING_CREDENTIAL";
const COPILOT_CONFIG_PREFIX: &str = "copilot-mcp-";
const CLAUDE_CONFIG_PREFIX: &str = "claude-mcp-";
const COPILOT_CONFIG_SUFFIX: &str = ".json";

/// Per-launch process configuration for Lumen's additive Team MCP connector.
///
/// The connector can remain attached to a resumable Native Session. Its
/// credential therefore identifies the Native Binding, not one AgentRun.
///
/// This type deliberately implements neither `Debug` nor `Serialize`: it owns
/// the raw process-lifetime Binding credential and must never be included in
/// Runtime diagnostics, event payloads or command records.
pub struct TeamToolProcessConfig {
    bridge_executable: PathBuf,
    core_socket: PathBuf,
    native_binding_id: String,
    binding_credential: String,
}

impl TeamToolProcessConfig {
    pub fn new(
        bridge_executable: PathBuf,
        core_socket: PathBuf,
        credential: &TeamToolBindingCredential,
    ) -> Result<Self> {
        if !bridge_executable.is_absolute() {
            anyhow::bail!("Team MCP Bridge executable must be absolute");
        }
        if !core_socket.is_absolute() {
            anyhow::bail!("Team MCP Core socket must be absolute");
        }
        if credential.native_binding_id.trim().is_empty()
            || credential.binding_credential.trim().is_empty()
        {
            anyhow::bail!("Team MCP Native Binding credential is incomplete");
        }
        Ok(Self {
            bridge_executable,
            core_socket,
            native_binding_id: credential.native_binding_id.clone(),
            binding_credential: credential.binding_credential.clone(),
        })
    }

    pub fn native_binding_id(&self) -> &str {
        &self.native_binding_id
    }

    /// Codex app-server request overrides use dotted keys. Supplying one
    /// reserved server key augments the user's existing `mcp_servers` table
    /// rather than replacing it.
    pub fn codex_config_override(&self) -> Value {
        json!({
            format!("mcp_servers.{TEAM_MCP_SERVER_NAME}"): {
                "command": self.bridge_executable,
                "args": [TEAM_MCP_BRIDGE_SUBCOMMAND],
                "env": self.environment_map(),
                "enabled": true,
                "required": true,
                // Lumen's capability check and Binding credential are the
                // authorization boundary for this one internal command. Do
                // not add a second provider-owned approval prompt.
                "default_tools_approval_mode": "approve",
                "enabled_tools": TEAM_TOOL_NAMES,
                "supports_parallel_tool_calls": false,
                "startup_timeout_sec": 10.0,
                "tool_timeout_sec": 30.0
            }
        })
    }

    /// ACP represents stdio environment variables as name/value pairs. This
    /// path is used by OpenCode; Copilot currently accepts but ignores ACP
    /// stdio servers, so it receives the equivalent CLI config below.
    pub fn acp_server(&self) -> Value {
        let environment = self
            .environment_map()
            .into_iter()
            .map(|(name, value)| json!({"name": name, "value": value}))
            .collect::<Vec<_>>();
        json!({
            "name": TEAM_MCP_SERVER_NAME,
            "command": self.bridge_executable,
            "args": [TEAM_MCP_BRIDGE_SUBCOMMAND],
            "env": environment
        })
    }

    pub fn write_ephemeral_copilot_config(
        &self,
        private_runtime_dir: &Path,
    ) -> Result<EphemeralTeamToolConfigFile> {
        self.write_ephemeral_mcp_config(private_runtime_dir, COPILOT_CONFIG_PREFIX)
    }

    pub fn write_ephemeral_claude_config(
        &self,
        private_runtime_dir: &Path,
    ) -> Result<EphemeralTeamToolConfigFile> {
        self.write_ephemeral_mcp_config(private_runtime_dir, CLAUDE_CONFIG_PREFIX)
    }

    fn write_ephemeral_mcp_config(
        &self,
        private_runtime_dir: &Path,
        prefix: &str,
    ) -> Result<EphemeralTeamToolConfigFile> {
        let directory = private_runtime_dir.join("team-tool");
        fs::create_dir_all(&directory).with_context(|| {
            format!(
                "failed to create private Team Tool directory {}",
                directory.display()
            )
        })?;
        set_private_directory_permissions(&directory)?;
        let path = directory.join(format!(
            "{prefix}{}{COPILOT_CONFIG_SUFFIX}",
            uuid::Uuid::new_v4()
        ));
        let document = json!({
            "mcpServers": {
                TEAM_MCP_SERVER_NAME: {
                    "command": self.bridge_executable,
                    "args": [TEAM_MCP_BRIDGE_SUBCOMMAND],
                    "env": self.environment_map()
                }
            }
        });
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&path)
            .with_context(|| format!("failed to create {}", path.display()))?;
        serde_json::to_writer(&mut file, &document)
            .with_context(|| format!("failed to write {}", path.display()))?;
        file.write_all(b"\n")?;
        file.flush()?;
        Ok(EphemeralTeamToolConfigFile { path })
    }

    fn environment_map(&self) -> BTreeMap<&'static str, String> {
        BTreeMap::from([
            (
                CORE_SOCKET_ENV,
                self.core_socket.to_string_lossy().to_string(),
            ),
            (NATIVE_BINDING_ID_ENV, self.native_binding_id.clone()),
            (BINDING_CREDENTIAL_ENV, self.binding_credential.clone()),
        ])
    }
}

/// Remove credential-bearing Team Tool config files left by a previous crashed
/// Lumen process. Call this once before AgentRun processes can be started; it
/// must not race active config consumers.
pub fn remove_stale_team_tool_configs(private_runtime_dir: &Path) -> Result<()> {
    let directory = private_runtime_dir.join("team-tool");
    if !directory.exists() {
        return Ok(());
    }
    set_private_directory_permissions(&directory)?;
    for entry in fs::read_dir(&directory)
        .with_context(|| format!("failed to inspect {}", directory.display()))?
    {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if entry.file_type()?.is_file()
            && (name.starts_with(COPILOT_CONFIG_PREFIX) || name.starts_with(CLAUDE_CONFIG_PREFIX))
            && name.ends_with(COPILOT_CONFIG_SUFFIX)
        {
            fs::remove_file(entry.path())
                .with_context(|| format!("failed to remove stale Team Tool config {}", name))?;
        }
    }
    Ok(())
}

pub struct EphemeralTeamToolConfigFile {
    path: PathBuf,
}

impl EphemeralTeamToolConfigFile {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for EphemeralTeamToolConfigFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn set_private_directory_permissions(directory: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700)).with_context(|| {
            format!(
                "failed to restrict Team Tool directory {}",
                directory.display()
            )
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> TeamToolProcessConfig {
        TeamToolProcessConfig::new(
            PathBuf::from("/opt/lumen/lumen-core"),
            PathBuf::from("/tmp/lumen-team/core.sock"),
            &TeamToolBindingCredential {
                native_binding_id: "binding-1".to_string(),
                native_binding_generation: 2,
                binding_credential: "private.credential".to_string(),
                conversation_version: 4,
                adapter_installation_id: "adapter-1".to_string(),
                native_session_id: None,
                binding_compatibility_digest: "sha256:binding".to_string(),
                binding_replaced: true,
            },
        )
        .unwrap()
    }

    #[test]
    fn codex_override_is_additive_and_restricts_the_lumen_server() {
        let value = config().codex_config_override();
        let key = format!("mcp_servers.{TEAM_MCP_SERVER_NAME}");
        assert_eq!(value.as_object().unwrap().len(), 1);
        assert_eq!(value[&key]["enabled_tools"], json!(TEAM_TOOL_NAMES));
        assert_eq!(value[&key]["default_tools_approval_mode"], "approve");
        assert!(value.get("mcp_servers").is_none());
    }

    #[test]
    fn acp_server_exposes_only_the_reserved_bridge_process() {
        let value = config().acp_server();
        assert_eq!(value["name"], TEAM_MCP_SERVER_NAME);
        assert_eq!(value["args"], json!([TEAM_MCP_BRIDGE_SUBCOMMAND]));
        assert_eq!(value["env"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn provider_secret_configs_are_private_and_removed_on_drop() {
        let directory =
            std::env::temp_dir().join(format!("lumen-team-runtime-test-{}", uuid::Uuid::new_v4()));
        for file in [
            config().write_ephemeral_copilot_config(&directory).unwrap(),
            config().write_ephemeral_claude_config(&directory).unwrap(),
        ] {
            let path = file.path().to_path_buf();
            let body = std::fs::read_to_string(&path).unwrap();
            assert!(body.contains("private.credential"));
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(
                    std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                    0o600
                );
            }
            drop(file);
            assert!(!path.exists());
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn stale_provider_credentials_are_removed_without_touching_other_files() {
        let directory =
            std::env::temp_dir().join(format!("lumen-team-cleanup-test-{}", uuid::Uuid::new_v4()));
        let team_directory = directory.join("team-tool");
        std::fs::create_dir_all(&team_directory).unwrap();
        let stale_copilot = team_directory.join("copilot-mcp-stale.json");
        let stale_claude = team_directory.join("claude-mcp-stale.json");
        let unrelated = team_directory.join("keep.txt");
        std::fs::write(&stale_copilot, "credential").unwrap();
        std::fs::write(&stale_claude, "credential").unwrap();
        std::fs::write(&unrelated, "keep").unwrap();

        remove_stale_team_tool_configs(&directory).unwrap();

        assert!(!stale_copilot.exists());
        assert!(!stale_claude.exists());
        assert!(unrelated.exists());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
