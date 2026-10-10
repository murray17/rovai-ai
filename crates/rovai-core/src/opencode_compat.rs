//! Differences in the selected OpenCode executable's launch contract. This is
//! deliberately not an installation selector or a version qualification list.
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use tokio::process::Command;

use crate::{
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig},
    agent_runtime_adapter::{AdapterRuntimeResolutionInput, AgentRuntimeAdapterRegistry},
    command::canonical_json_digest,
    runtime::AgentRunWorkspace,
    runtime_discovery::{runtime_environment_variable, runtime_home_directory},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Generation {
    V1,
    V2,
}

impl Generation {
    pub(crate) fn from_version(version: Option<&str>) -> Option<Self> {
        match version_major(version?)? {
            1 => Some(Self::V1),
            2 => Some(Self::V2),
            _ => None,
        }
    }

    pub(crate) fn conflicts_with(self, advertised: &str) -> bool {
        version_major(advertised).is_some() && Self::from_version(Some(advertised)) != Some(self)
    }

    pub(crate) fn require(version: Option<&str>) -> Result<Self> {
        Self::from_version(version).with_context(|| {
            format!(
                "OpenCode initialization cannot determine the required V1/V2 launch contract from version {:?}",
                version
            )
        })
    }

    pub(crate) fn configure_command(self, command: &mut Command) {
        match self {
            Self::V1 => {
                command.args(["acp", "--pure", "--log-level", "ERROR"]);
            }
            Self::V2 => {
                command.args(["acp", "--log-level", "error"]);
                // The macOS 2.0.26 package resolves its optional msgpackr addon
                // through a build-machine /home path, which can block autofs.
                // The package's supported JS implementation avoids that lookup.
                configure_optional_native_acceleration(command);
            }
        }
    }

    pub(crate) fn configuration(self, permission: &str) -> Result<Value> {
        if !matches!(permission, "allow" | "ask" | "deny") {
            bail!("OpenCode permission must be allow, ask or deny");
        }
        // Preserve the existing Shell and Skill exceptions. These modes are
        // not a read-only sandbox or a promise about every custom/subagent.
        Ok(match self {
            Self::V1 => {
                let rules = json!({"*": permission, "skill": "allow", "bash": "allow"});
                json!({"autoupdate": false, "permission": rules,
                    "agent": {"build": {"permission": rules}, "plan": {"permission": rules}}})
            }
            Self::V2 => {
                // Native V2 rules are ordered, last match wins; agent rules
                // follow global rules. Only the two existing built-ins change.
                let rules = json!([
                    {"action": "*", "resource": "*", "effect": permission},
                    {"action": "shell", "resource": "*", "effect": "allow"},
                    {"action": "skill", "resource": "*", "effect": "allow"}
                ]);
                json!({"update": "disable", "permissions": rules,
                    "agents": {"build": {"permissions": rules}, "plan": {"permissions": rules}}})
            }
        })
    }
}

/// Both generations expose this catalog-only entry point. No permission
/// overlay or business input is sent, so opening the picker needs no version
/// subprocess and cannot freeze a guessed execution dialect.
pub(crate) fn configure_catalog_command(command: &mut Command) {
    command.arg("acp");
    configure_optional_native_acceleration(command);
}

fn configure_optional_native_acceleration(command: &mut Command) {
    #[cfg(target_os = "macos")]
    if runtime_environment_variable(
        AdapterKind::OpencodeCli,
        "MSGPACKR_NATIVE_ACCELERATION_DISABLED",
    )
    .is_none()
    {
        command.env("MSGPACKR_NATIVE_ACCELERATION_DISABLED", "true");
    }
    #[cfg(not(target_os = "macos"))]
    let _ = command;
}

fn version_major(version: &str) -> Option<u64> {
    let version = version.trim();
    let version = version.strip_prefix("opencode ").unwrap_or(version);
    let version = version.strip_prefix('v').unwrap_or(version);
    let (major, rest) = version.split_once('.')?;
    let (minor, patch) = rest.split_once('.')?;
    minor.parse::<u64>().ok()?;
    patch.split(['-', '+']).next()?.parse::<u64>().ok()?;
    major.parse().ok()
}

pub(crate) fn configure_permissions(
    generation: Generation,
    command: &mut Command,
    permission: &str,
) -> Result<()> {
    let inherited = command
        .as_std()
        .get_envs()
        .find(|(key, _)| *key == "OPENCODE_CONFIG_CONTENT")
        .map(|(_, value)| value.map(ToOwned::to_owned))
        .unwrap_or_else(|| {
            runtime_environment_variable(AdapterKind::OpencodeCli, "OPENCODE_CONFIG_CONTENT")
        });
    let mut config = match inherited {
        Some(content) => json5::from_str::<Value>(
            content
                .to_str()
                .context("OpenCode OPENCODE_CONFIG_CONTENT is not UTF-8")?,
        )
        .context("OpenCode OPENCODE_CONFIG_CONTENT is invalid")?,
        None => json!({}),
    };
    let object = config
        .as_object_mut()
        .context("OpenCode configuration must be an object")?;
    let mut overlay = generation.configuration(permission)?;
    let agent_key = if generation == Generation::V1 {
        "agent"
    } else {
        "agents"
    };
    let permission_key = if generation == Generation::V1 {
        "permission"
    } else {
        "permissions"
    };
    let agent_rules = overlay[agent_key].take();
    overlay.as_object_mut().unwrap().remove(agent_key);
    object.extend(overlay.as_object().unwrap().clone());
    let agents = object
        .entry(agent_key)
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .context("OpenCode agent configuration must be an object")?;
    for name in ["build", "plan"] {
        agents
            .entry(name)
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .with_context(|| format!("OpenCode {name} agent configuration must be an object"))?
            .insert(
                permission_key.to_string(),
                agent_rules[name][permission_key].clone(),
            );
    }
    command.env("OPENCODE_CONFIG_CONTENT", serde_json::to_string(&config)?);
    Ok(())
}

/// A healthy Host is the existing owner of this information. Match the selected
/// executable and environment before borrowing its confirmed version.
pub(crate) fn program_identity(runtime: &FrozenAgentRuntimeConfig) -> Result<String> {
    canonical_json_digest(&json!({
        "installation": runtime.installation_id,
        "generation": runtime.installation_generation,
        "environment": runtime.search_environment_generation,
        "path": runtime.executable_path,
        "fingerprint": runtime.executable_fingerprint,
    }))
}

pub(crate) fn freeze(
    mut runtime: FrozenAgentRuntimeConfig,
    workspace: &AgentRunWorkspace,
) -> Result<FrozenAgentRuntimeConfig> {
    let generation = Generation::require(runtime.reported_version.as_deref())?;
    let registry = AgentRuntimeAdapterRegistry::default();
    let projection = registry.resolve_runtime(
        AdapterKind::OpencodeCli,
        AdapterRuntimeResolutionInput {
            installation_id: &runtime.installation_id,
            executable_path: &runtime.executable_path,
            auth_scope: &runtime.auth_scope,
            reported_version: runtime.reported_version.as_deref(),
            executable_fingerprint: &runtime.executable_fingerprint,
            protocols: std::slice::from_ref(&runtime.protocol_version),
            native_session_compatibility_key: None,
            permissions: &runtime.permissions,
            permission_descriptors: &registry.permission_options(AdapterKind::OpencodeCli),
        },
    )?;
    runtime.host_config_digest = projection.host_config_digest;
    runtime.binding_compatibility_digest = projection.binding_compatibility_digest;
    // Session storage/protocol identity, not process identity. A patch release
    // can replace the Host while recovering the same native Session.
    let storage = canonical_json_digest(&json!({
        "protocol": runtime.protocol_version,
        "generation": format!("{generation:?}"),
        "home": runtime_home_directory(AdapterKind::OpencodeCli),
        "data": runtime_environment_variable(AdapterKind::OpencodeCli, "XDG_DATA_HOME"),
        "database": if generation == Generation::V2 {
            runtime_environment_variable(AdapterKind::OpencodeCli, "OPENCODE_DB")
        } else { None },
        "workspace": std::fs::canonicalize(&workspace.execution_root)
            .context("OpenCode Native Session workspace is unavailable")?,
    }))?;
    runtime.native_session_compatibility_key = Some(format!("opencode-cli:acp-v1:{storage}"));
    runtime.refresh_config_digest()?;
    Ok(runtime)
}

/// OpenCode emits this native ACP marker without the optional summary/patch
/// capability. Replay quarantine and the Session observer own admission/dedup.
pub(crate) fn completed_compaction(message: &Value) -> Option<&str> {
    let params = message.get("params")?;
    let update = params.get("update")?;
    if message.get("id").is_some()
        || message["method"] != "session/update"
        || update["sessionUpdate"] != "session_info_update"
        || !crate::runtime::is_root_output(params)
        || !crate::runtime::is_root_output(update)
    {
        return None;
    }
    let marker = update.pointer("/_meta/opencode~1compaction")?;
    (marker["status"] == "completed")
        .then(|| marker["messageId"].as_str())
        .flatten()
        .filter(|id| !id.trim().is_empty())
}
