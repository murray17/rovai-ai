use std::{
    collections::BTreeMap,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{
    agent_profile::{
        AdapterCapabilitySnapshot, AdapterKind, AdapterPermissionConfig, ModelDescriptor,
        ModelOptionDescriptor, PermissionOptionDescriptor, RuntimeOptionScope, ValueChoice,
    },
    command::canonical_json_digest,
    team_tool::TEAM_POST_MESSAGE_CAPABILITY,
};

/// The stable, built-in boundary between Rovai-ai runtime configuration and a
/// provider-specific protocol implementation. v0.03 intentionally keeps this
/// registry compile-time: it is not a plugin ABI.
pub trait AgentRuntimeAdapter {
    fn kind(&self) -> AdapterKind;

    fn skill_discovery(&self) -> SkillDiscoveryCapability;

    fn mcp_projection(&self) -> McpProjectionCapability;

    fn resolve_runtime(
        &self,
        input: AdapterRuntimeResolutionInput<'_>,
    ) -> Result<AdapterRuntimeProjection>;
}

pub fn executable_fingerprint(path: &Path) -> Result<String> {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut file = File::open(&canonical)
        .with_context(|| format!("failed to open {}", canonical.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("sha256:{:x}", digest.finalize()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutableFileIdentity {
    pub byte_size: u64,
    pub modified_at_unix_nanos: i64,
    pub file_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutableIntegrityStatus {
    Unchanged,
    Reverified(ExecutableFileIdentity),
    Changed,
}

pub fn observe_executable_file_identity(path: &Path) -> Result<ExecutableFileIdentity> {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let file = File::open(&canonical)
        .with_context(|| format!("failed to open {}", canonical.display()))?;
    let metadata = file
        .metadata()
        .with_context(|| format!("failed to inspect {}", canonical.display()))?;
    if !metadata.is_file() {
        anyhow::bail!("Runtime executable is not a file: {}", canonical.display());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        if metadata.permissions().mode() & 0o111 == 0 {
            anyhow::bail!(
                "Runtime executable does not have execute permission: {}",
                canonical.display()
            );
        }
    }
    let modified_at_unix_nanos = metadata
        .modified()
        .with_context(|| format!("failed to read mtime for {}", canonical.display()))?
        .duration_since(UNIX_EPOCH)
        .with_context(|| format!("invalid mtime for {}", canonical.display()))?
        .as_nanos();
    let modified_at_unix_nanos = i64::try_from(modified_at_unix_nanos)
        .context("Runtime executable mtime exceeds the supported range")?;
    #[cfg(unix)]
    let file_id = {
        use std::os::unix::fs::MetadataExt;

        Some(format!("unix:{}:{}", metadata.dev(), metadata.ino()))
    };
    #[cfg(not(unix))]
    let file_id = None;
    Ok(ExecutableFileIdentity {
        byte_size: metadata.len(),
        modified_at_unix_nanos,
        file_id,
    })
}

pub fn verify_executable_integrity(
    path: &Path,
    verified_identity: Option<&ExecutableFileIdentity>,
    expected_fingerprint: &str,
) -> Result<ExecutableIntegrityStatus> {
    let observed = observe_executable_file_identity(path)?;
    if verified_identity == Some(&observed) {
        return Ok(ExecutableIntegrityStatus::Unchanged);
    }
    let current_fingerprint = executable_fingerprint(path)?;
    let observed_after = observe_executable_file_identity(path)?;
    if observed_after != observed || current_fingerprint != expected_fingerprint {
        return Ok(ExecutableIntegrityStatus::Changed);
    }
    Ok(ExecutableIntegrityStatus::Reverified(observed_after))
}

#[derive(Debug, Clone, Copy)]
pub struct AdapterRuntimeResolutionInput<'a> {
    pub installation_id: &'a str,
    pub executable_path: &'a str,
    pub auth_scope: &'a str,
    pub executable_fingerprint: &'a str,
    pub protocols: &'a [String],
    pub native_session_compatibility_key: Option<&'a str>,
    pub permissions: &'a AdapterPermissionConfig,
    pub permission_descriptors: &'a [PermissionOptionDescriptor],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterRuntimeProjection {
    pub protocol_version: String,
    pub binding_compatibility_digest: String,
    pub host_config_digest: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeSkillRootKind {
    Agents,
    Claude,
    Antigravity,
}

impl NativeSkillRootKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Agents => "agents",
            Self::Claude => "claude",
            Self::Antigravity => "antigravity",
        }
    }

    pub fn relative_path(self) -> &'static Path {
        match self {
            Self::Agents => Path::new(".agents/skills"),
            Self::Claude => Path::new(".claude/skills"),
            Self::Antigravity => Path::new(".agent/skills"),
        }
    }
}

impl std::str::FromStr for NativeSkillRootKind {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "agents" => Ok(Self::Agents),
            "claude" => Ok(Self::Claude),
            "antigravity" => Ok(Self::Antigravity),
            _ => anyhow::bail!("unsupported native Skill root kind: {value}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDiscoveryCapability {
    pub supported: bool,
    pub native_roots: Vec<NativeSkillRootKind>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalMcpProjection {
    ExactPerRun,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeamGatewayAttachment {
    InjectedCredential,
    AttestedNativeBridge,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AmbientMcpIsolation {
    Exact,
    PreservedUncontrolled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpApprovalControl {
    RuntimeNative,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProjectionCapability {
    pub supports_stdio: bool,
    pub supports_streamable_http: bool,
    pub external_mcp_projection: ExternalMcpProjection,
    pub team_gateway_attachment: TeamGatewayAttachment,
    pub ambient_mcp_isolation: AmbientMcpIsolation,
    pub approval_control: McpApprovalControl,
}

fn exact_native_mcp_projection() -> McpProjectionCapability {
    McpProjectionCapability {
        supports_stdio: true,
        supports_streamable_http: true,
        external_mcp_projection: ExternalMcpProjection::ExactPerRun,
        team_gateway_attachment: TeamGatewayAttachment::InjectedCredential,
        ambient_mcp_isolation: AmbientMcpIsolation::Exact,
        approval_control: McpApprovalControl::RuntimeNative,
    }
}

fn attested_native_mcp_projection() -> McpProjectionCapability {
    McpProjectionCapability {
        supports_stdio: false,
        supports_streamable_http: false,
        external_mcp_projection: ExternalMcpProjection::Unsupported,
        team_gateway_attachment: TeamGatewayAttachment::AttestedNativeBridge,
        ambient_mcp_isolation: AmbientMcpIsolation::PreservedUncontrolled,
        approval_control: McpApprovalControl::RuntimeNative,
    }
}

fn native_skill_discovery(native_root: NativeSkillRootKind) -> SkillDiscoveryCapability {
    SkillDiscoveryCapability {
        supported: true,
        native_roots: vec![native_root],
    }
}

fn unsupported_skill_discovery() -> SkillDiscoveryCapability {
    SkillDiscoveryCapability {
        supported: false,
        native_roots: Vec::new(),
    }
}

#[derive(Debug, Clone)]
pub struct CodexProbeObservation {
    pub reported_version: Option<String>,
    pub executable_fingerprint: Option<String>,
    pub authentication_status: String,
    pub probe_status: String,
    pub capabilities: Vec<String>,
    pub raw_model_catalog: Option<Value>,
    pub attempted_at: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AcpProbeObservation {
    pub adapter_kind: AdapterKind,
    pub reported_version: Option<String>,
    pub executable_fingerprint: Option<String>,
    pub authentication_status: String,
    pub probe_status: String,
    pub capabilities: Vec<String>,
    pub initialize_result: Option<Value>,
    pub session_result: Option<Value>,
    pub attempted_at: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AntigravityProbeObservation {
    pub reported_version: Option<String>,
    pub executable_fingerprint: Option<String>,
    pub authentication_status: String,
    pub probe_status: String,
    pub capabilities: Vec<String>,
    pub models: Vec<String>,
    pub team_gateway_ready: bool,
    pub attempted_at: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ClaudeCodeProbeObservation {
    pub reported_version: Option<String>,
    pub executable_fingerprint: Option<String>,
    pub authentication_status: String,
    pub probe_status: String,
    pub capabilities: Vec<String>,
    pub model_aliases: Vec<String>,
    pub attempted_at: String,
    pub last_error: Option<String>,
}

/// Synthetic catalog entry used to represent Antigravity's own default
/// selection. It is never passed to `agy --model`; a runtime-default Run
/// omits that flag.
pub const ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID: &str = "antigravity://runtime-default";
pub const CLAUDE_CODE_RUNTIME_DEFAULT_MODEL_ID: &str = "claude-code://runtime-default";
pub const KIRO_EXACT_AGENT_NAME: &str = "rovai";

/// Writes the Kiro custom Agent used by Rovai-ai ACP Hosts. The Agent is
/// discovered from a private process working directory, while ACP Session
/// requests retain the real AgentRun working directory. `includeMcpJson:
/// false` prevents personal and repository `mcp.json` sources from being
/// merged with the exact per-Session ACP projection.
pub fn write_kiro_exact_agent_config(launch_root: &Path) -> Result<PathBuf> {
    let agent_directory = launch_root.join(".kiro/agents");
    std::fs::create_dir_all(&agent_directory).with_context(|| {
        format!(
            "failed to create private Kiro Agent directory {}",
            agent_directory.display()
        )
    })?;
    let path = agent_directory.join(format!("{KIRO_EXACT_AGENT_NAME}.json"));
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&json!({
            "name": KIRO_EXACT_AGENT_NAME,
            "description": "Rovai-ai exact per-AgentRun ACP host",
            "prompt": null,
            "mcpServers": {},
            "tools": ["*"],
            "toolAliases": {},
            "allowedTools": [],
            "resources": [],
            "toolsSettings": {},
            "includeMcpJson": false,
            "model": null
        }))?,
    )
    .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(path)
}

#[derive(Debug, Default)]
pub struct AgentRuntimeAdapterRegistry {
    codex_cli: CodexCliAdapterPolicy,
    opencode_cli: OpenCodeCliAdapterPolicy,
    copilot_cli: CopilotCliAdapterPolicy,
    claude_code_cli: ClaudeCodeCliAdapterPolicy,
    antigravity_app: AntigravityAppAdapterPolicy,
}

impl AgentRuntimeAdapterRegistry {
    pub fn member_permission_defaults(&self, kind: AdapterKind) -> Value {
        match kind {
            AdapterKind::CodexCli => json!({
                "sandbox_mode": "danger-full-access",
                "approval_policy": "never",
            }),
            AdapterKind::OpencodeCli => json!({
                "permission": "allow",
            }),
            AdapterKind::CopilotCli => json!({
                "allow_all": "on",
            }),
            AdapterKind::ClaudeCodeCli => json!({
                "permission_mode": "bypassPermissions",
            }),
            AdapterKind::KiroCli => json!({}),
            AdapterKind::QoderCli => json!({
                "permission_mode": "bypass_permissions",
            }),
            AdapterKind::CodebuddyCli => json!({
                "permission_mode": "bypassPermissions",
            }),
            AdapterKind::QwenCode => json!({
                "approval_mode": "yolo",
            }),
            AdapterKind::AntigravityApp => json!({
                "mode": "accept-edits",
                "sandbox": "off",
                "dangerously_skip_permissions": "on",
            }),
        }
    }

    pub fn resolve_runtime(
        &self,
        kind: AdapterKind,
        input: AdapterRuntimeResolutionInput<'_>,
    ) -> Result<AdapterRuntimeProjection> {
        match kind {
            AdapterKind::CodexCli => self.codex_cli.resolve_runtime(input),
            AdapterKind::OpencodeCli => self.opencode_cli.resolve_runtime(input),
            AdapterKind::CopilotCli => self.copilot_cli.resolve_runtime(input),
            AdapterKind::ClaudeCodeCli => self.claude_code_cli.resolve_runtime(input),
            AdapterKind::AntigravityApp => self.antigravity_app.resolve_runtime(input),
            AdapterKind::KiroCli
            | AdapterKind::QoderCli
            | AdapterKind::CodebuddyCli
            | AdapterKind::QwenCode => resolve_acp_runtime(kind, input),
        }
    }

    pub fn skill_discovery(&self, kind: AdapterKind) -> SkillDiscoveryCapability {
        match kind {
            AdapterKind::CodexCli => self.codex_cli.skill_discovery(),
            AdapterKind::OpencodeCli => self.opencode_cli.skill_discovery(),
            AdapterKind::CopilotCli => self.copilot_cli.skill_discovery(),
            AdapterKind::ClaudeCodeCli => self.claude_code_cli.skill_discovery(),
            AdapterKind::AntigravityApp => self.antigravity_app.skill_discovery(),
            AdapterKind::KiroCli
            | AdapterKind::QoderCli
            | AdapterKind::CodebuddyCli
            | AdapterKind::QwenCode => unsupported_skill_discovery(),
        }
    }

    pub fn mcp_projection(&self, kind: AdapterKind) -> McpProjectionCapability {
        match kind {
            AdapterKind::CodexCli => self.codex_cli.mcp_projection(),
            AdapterKind::OpencodeCli => self.opencode_cli.mcp_projection(),
            AdapterKind::CopilotCli => self.copilot_cli.mcp_projection(),
            AdapterKind::ClaudeCodeCli => self.claude_code_cli.mcp_projection(),
            AdapterKind::AntigravityApp => self.antigravity_app.mcp_projection(),
            AdapterKind::KiroCli
            | AdapterKind::QoderCli
            | AdapterKind::CodebuddyCli
            | AdapterKind::QwenCode => exact_native_mcp_projection(),
        }
    }

    pub fn codex_capability_snapshot(
        &self,
        observation: CodexProbeObservation,
    ) -> Result<AdapterCapabilitySnapshot> {
        self.codex_cli.capability_snapshot(observation)
    }

    pub fn acp_capability_snapshot(
        &self,
        observation: AcpProbeObservation,
    ) -> Result<AdapterCapabilitySnapshot> {
        match observation.adapter_kind {
            AdapterKind::OpencodeCli => self.opencode_cli.capability_snapshot(observation),
            AdapterKind::CopilotCli => self.copilot_cli.capability_snapshot(observation),
            AdapterKind::QoderCli => {
                acp_capability_snapshot(observation, qoder_permission_options())
            }
            AdapterKind::CodebuddyCli => {
                acp_capability_snapshot(observation, codebuddy_permission_options())
            }
            AdapterKind::QwenCode => {
                acp_capability_snapshot(observation, qwen_permission_options())
            }
            AdapterKind::KiroCli => acp_capability_snapshot(observation, Vec::new()),
            kind => anyhow::bail!("{} does not use the ACP snapshot mapper", kind.as_str()),
        }
    }

    pub fn claude_code_capability_snapshot(
        &self,
        observation: ClaudeCodeProbeObservation,
    ) -> Result<AdapterCapabilitySnapshot> {
        self.claude_code_cli.capability_snapshot(observation)
    }

    pub fn antigravity_capability_snapshot(
        &self,
        observation: AntigravityProbeObservation,
    ) -> Result<AdapterCapabilitySnapshot> {
        self.antigravity_app.capability_snapshot(observation)
    }
}

#[derive(Debug, Default)]
struct CodexCliAdapterPolicy;

#[derive(Debug, Default)]
struct OpenCodeCliAdapterPolicy;

#[derive(Debug, Default)]
struct CopilotCliAdapterPolicy;

#[derive(Debug, Default)]
struct ClaudeCodeCliAdapterPolicy;

#[derive(Debug, Default)]
struct AntigravityAppAdapterPolicy;

impl CodexCliAdapterPolicy {
    fn capability_snapshot(
        &self,
        observation: CodexProbeObservation,
    ) -> Result<AdapterCapabilitySnapshot> {
        let ready = observation.probe_status == "ready";
        let models = if ready {
            codex_models(
                observation
                    .raw_model_catalog
                    .as_ref()
                    .context("ready Codex probe did not return model/list")?,
            )?
        } else {
            Vec::new()
        };
        let mut capabilities = observation.capabilities;
        for capability in [
            "model.list",
            "structured_permission_request",
            "context.charter.native_append",
            TEAM_POST_MESSAGE_CAPABILITY,
        ] {
            if ready && !capabilities.iter().any(|value| value == capability) {
                capabilities.push(capability.to_string());
            }
        }
        if ready {
            append_exact_mcp_axes(&mut capabilities);
        }
        capabilities.sort();
        capabilities.dedup();
        let permission_options = ready.then(codex_permission_options).unwrap_or_default();
        let permission_schema_digest =
            canonical_json_digest(&serde_json::to_value(&permission_options)?)?;
        Ok(AdapterCapabilitySnapshot {
            reported_version: observation.reported_version,
            executable_fingerprint: observation.executable_fingerprint,
            authentication_status: observation.authentication_status,
            probe_status: observation.probe_status,
            permission_schema_version: 1,
            permission_schema_digest,
            capabilities,
            protocols: if ready {
                vec!["codex-app-server-v2".to_string()]
            } else {
                Vec::new()
            },
            models,
            permission_options,
            observed_at: ready.then(|| observation.attempted_at.clone()),
            last_attempted_at: observation.attempted_at.clone(),
            last_successful_probe_at: ready.then(|| observation.attempted_at.clone()),
            stale_at: (!ready).then_some(observation.attempted_at),
            last_error: observation.last_error,
            native_session_compatibility_key: ready.then(|| "codex-cli:app-server-v2".to_string()),
        })
    }
}

fn codex_models(catalog: &Value) -> Result<Vec<ModelDescriptor>> {
    let values = catalog
        .get("data")
        .and_then(Value::as_array)
        .context("Codex model/list catalog did not include data")?;
    values
        .iter()
        .map(|value| {
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .context("Codex model is missing id")?;
            let display_name = value
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or(id);
            let efforts = value
                .get("supportedReasoningEfforts")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let options = if efforts.is_empty() {
                Vec::new()
            } else {
                vec![ModelOptionDescriptor {
                    key: "reasoning_effort".to_string(),
                    label: "Reasoning effort".to_string(),
                    value_type: "enum".to_string(),
                    values: efforts
                        .iter()
                        .filter_map(|effort| {
                            let value = effort.get("reasoningEffort")?.as_str()?;
                            Some(ValueChoice {
                                value: value.to_string(),
                                label: humanize_identifier(value),
                            })
                        })
                        .collect(),
                    default_value: value
                        .get("defaultReasoningEffort")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    scope: RuntimeOptionScope::Run,
                }]
            };
            Ok(ModelDescriptor {
                id: id.to_string(),
                display_name: display_name.to_string(),
                is_default: value
                    .get("isDefault")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                hidden: value
                    .get("hidden")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                deprecated: value
                    .get("upgrade")
                    .is_some_and(|upgrade| !upgrade.is_null()),
                options,
            })
        })
        .collect()
}

fn humanize_identifier(value: &str) -> String {
    let mut characters = value.replace(['_', '-'], " ").chars().collect::<Vec<_>>();
    if let Some(first) = characters.first_mut() {
        first.make_ascii_uppercase();
    }
    characters.into_iter().collect()
}

fn codex_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![
        PermissionOptionDescriptor {
            key: "sandbox_mode".to_string(),
            label: "sandbox_mode".to_string(),
            description: "Codex filesystem sandbox mode for this member's Native Session."
                .to_string(),
            value_type: "enum".to_string(),
            choices: vec![
                choice("read-only", "read-only"),
                choice("workspace-write", "workspace-write"),
                choice("danger-full-access", "danger-full-access (no sandbox)"),
            ],
            recommended_value: json!("workspace-write"),
            scope: RuntimeOptionScope::Session,
            risk: "elevated".to_string(),
            supported: true,
            required: true,
            unsupported_reason: None,
        },
        PermissionOptionDescriptor {
            key: "approval_policy".to_string(),
            label: "approval_policy".to_string(),
            description:
                "Codex approval policy. on-request keeps structured requests in Rovai-ai Approval."
                    .to_string(),
            value_type: "enum".to_string(),
            choices: vec![
                choice("untrusted", "untrusted"),
                choice("on-request", "on-request"),
                choice("never", "never (no approval prompts)"),
            ],
            recommended_value: json!("on-request"),
            scope: RuntimeOptionScope::Session,
            risk: "elevated".to_string(),
            supported: true,
            required: true,
            unsupported_reason: None,
        },
    ]
}

fn choice(value: &str, label: &str) -> ValueChoice {
    ValueChoice {
        value: value.to_string(),
        label: label.to_string(),
    }
}

impl AgentRuntimeAdapter for CodexCliAdapterPolicy {
    fn kind(&self) -> AdapterKind {
        AdapterKind::CodexCli
    }

    fn skill_discovery(&self) -> SkillDiscoveryCapability {
        native_skill_discovery(NativeSkillRootKind::Agents)
    }

    fn mcp_projection(&self) -> McpProjectionCapability {
        exact_native_mcp_projection()
    }

    fn resolve_runtime(
        &self,
        input: AdapterRuntimeResolutionInput<'_>,
    ) -> Result<AdapterRuntimeProjection> {
        if input.permissions.adapter_kind != self.kind() {
            anyhow::bail!("Codex permission configuration belongs to another Adapter");
        }
        let protocol_version = input
            .protocols
            .iter()
            .find(|protocol| {
                matches!(
                    protocol.as_str(),
                    "codex-app-server-v2" | "codex-app-server"
                )
            })
            .context("Codex installation does not advertise App Server support")?
            .clone();
        let permission_values = input
            .permissions
            .values
            .as_object()
            .context("Codex permission configuration must be an object")?;
        let descriptors = input
            .permission_descriptors
            .iter()
            .map(|descriptor| (descriptor.key.as_str(), descriptor))
            .collect::<BTreeMap<_, _>>();

        let scoped_values = |scope: RuntimeOptionScope| -> Result<Value> {
            let mut values = serde_json::Map::new();
            for (key, value) in permission_values {
                let descriptor = descriptors
                    .get(key.as_str())
                    .with_context(|| format!("missing Codex permission descriptor for {key}"))?;
                if descriptor.scope == scope {
                    values.insert(key.clone(), value.clone());
                }
            }
            Ok(Value::Object(values))
        };

        // Codex model and reasoning effort are Turn-scoped. They deliberately
        // stay out of this digest so changing them does not replace a healthy
        // Native Session.
        let binding_compatibility_digest = canonical_json_digest(&json!({
            "adapterKind": self.kind(),
            "installationId": input.installation_id,
            "protocolVersion": protocol_version,
            "permissionSchemaVersion": input.permissions.schema_version,
            "sessionPermissions": scoped_values(RuntimeOptionScope::Session)?,
        }))?;
        let host_config_digest = canonical_json_digest(&json!({
            "adapterKind": self.kind(),
            "installationId": input.installation_id,
            "executablePath": input.executable_path,
            "executableFingerprint": input.executable_fingerprint,
            "authScope": input.auth_scope,
            "protocolVersion": protocol_version,
            "permissionSchemaVersion": input.permissions.schema_version,
            "hostPermissions": scoped_values(RuntimeOptionScope::Host)?,
        }))?;
        Ok(AdapterRuntimeProjection {
            protocol_version,
            binding_compatibility_digest,
            host_config_digest,
        })
    }
}

impl OpenCodeCliAdapterPolicy {
    fn capability_snapshot(
        &self,
        observation: AcpProbeObservation,
    ) -> Result<AdapterCapabilitySnapshot> {
        acp_capability_snapshot(observation, opencode_permission_options())
    }
}

impl CopilotCliAdapterPolicy {
    fn capability_snapshot(
        &self,
        observation: AcpProbeObservation,
    ) -> Result<AdapterCapabilitySnapshot> {
        acp_capability_snapshot(observation, copilot_permission_options())
    }
}

impl ClaudeCodeCliAdapterPolicy {
    fn capability_snapshot(
        &self,
        observation: ClaudeCodeProbeObservation,
    ) -> Result<AdapterCapabilitySnapshot> {
        let ready = observation.probe_status == "ready";
        let mut capabilities = observation.capabilities;
        if ready {
            for capability in [
                "cli.print",
                "conversation.resume",
                "process.interrupt",
                "context.charter.native_append",
                TEAM_POST_MESSAGE_CAPABILITY,
            ] {
                if !capabilities.iter().any(|value| value == capability) {
                    capabilities.push(capability.to_string());
                }
            }
            append_exact_mcp_axes(&mut capabilities);
        }
        capabilities.sort();
        capabilities.dedup();
        let models = if ready {
            let mut models = vec![ModelDescriptor {
                id: CLAUDE_CODE_RUNTIME_DEFAULT_MODEL_ID.to_string(),
                display_name: "Claude Code runtime default".to_string(),
                is_default: true,
                hidden: false,
                deprecated: false,
                options: vec![ModelOptionDescriptor {
                    key: "effort".to_string(),
                    label: "effort".to_string(),
                    value_type: "enum".to_string(),
                    values: ["low", "medium", "high", "xhigh", "max"]
                        .into_iter()
                        .map(|value| choice(value, value))
                        .collect(),
                    default_value: None,
                    scope: RuntimeOptionScope::Run,
                }],
            }];
            models.extend(
                observation
                    .model_aliases
                    .into_iter()
                    .filter(|model| !model.trim().is_empty())
                    .map(|model| ModelDescriptor {
                        id: model.clone(),
                        display_name: model,
                        is_default: false,
                        hidden: false,
                        deprecated: false,
                        options: vec![ModelOptionDescriptor {
                            key: "effort".to_string(),
                            label: "effort".to_string(),
                            value_type: "enum".to_string(),
                            values: ["low", "medium", "high", "xhigh", "max"]
                                .into_iter()
                                .map(|value| choice(value, value))
                                .collect(),
                            default_value: None,
                            scope: RuntimeOptionScope::Run,
                        }],
                    }),
            );
            models
        } else {
            Vec::new()
        };
        let permission_options = ready
            .then(claude_code_permission_options)
            .unwrap_or_default();
        let permission_schema_digest =
            canonical_json_digest(&serde_json::to_value(&permission_options)?)?;
        Ok(AdapterCapabilitySnapshot {
            reported_version: observation.reported_version,
            executable_fingerprint: observation.executable_fingerprint,
            authentication_status: observation.authentication_status,
            probe_status: observation.probe_status,
            permission_schema_version: 1,
            permission_schema_digest,
            capabilities,
            protocols: if ready {
                vec!["claude-code-print-v1".to_string()]
            } else {
                Vec::new()
            },
            models,
            permission_options,
            observed_at: ready.then(|| observation.attempted_at.clone()),
            last_attempted_at: observation.attempted_at.clone(),
            last_successful_probe_at: ready.then(|| observation.attempted_at.clone()),
            stale_at: (!ready).then_some(observation.attempted_at),
            last_error: observation.last_error,
            native_session_compatibility_key: ready.then(|| "claude-code-cli:print-v1".to_string()),
        })
    }
}

impl AntigravityAppAdapterPolicy {
    fn capability_snapshot(
        &self,
        observation: AntigravityProbeObservation,
    ) -> Result<AdapterCapabilitySnapshot> {
        let ready = observation.probe_status == "ready";
        let mut capabilities = observation.capabilities;
        if ready {
            for capability in [
                "cli.print",
                "model.list",
                "conversation.resume",
                "process.interrupt",
                "workspace.sandbox",
            ] {
                if !capabilities.iter().any(|value| value == capability) {
                    capabilities.push(capability.to_string());
                }
            }
            if observation.team_gateway_ready {
                capabilities.push(TEAM_POST_MESSAGE_CAPABILITY.to_string());
                capabilities.push("team_gateway.attachment.attested_native_bridge".to_string());
            } else {
                capabilities.push("team_gateway.attachment.unsupported".to_string());
            }
            capabilities.push("mcp.external_projection.unsupported".to_string());
            capabilities.push("mcp.ambient_isolation.preserved_uncontrolled".to_string());
        }
        capabilities.sort();
        capabilities.dedup();

        let mut models = Vec::new();
        if ready {
            models.push(ModelDescriptor {
                id: ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID.to_string(),
                display_name: "Antigravity App runtime default".to_string(),
                is_default: true,
                hidden: false,
                deprecated: false,
                options: Vec::new(),
            });
            for model_id in observation.models {
                if model_id.trim().is_empty() || model_id == ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID {
                    continue;
                }
                models.push(ModelDescriptor {
                    display_name: model_id.clone(),
                    id: model_id,
                    is_default: false,
                    hidden: false,
                    deprecated: false,
                    options: Vec::new(),
                });
            }
        }

        let permission_options = ready
            .then(antigravity_permission_options)
            .unwrap_or_default();
        let permission_schema_digest =
            canonical_json_digest(&serde_json::to_value(&permission_options)?)?;
        Ok(AdapterCapabilitySnapshot {
            reported_version: observation.reported_version,
            executable_fingerprint: observation.executable_fingerprint,
            authentication_status: observation.authentication_status,
            probe_status: observation.probe_status,
            permission_schema_version: 1,
            permission_schema_digest,
            capabilities,
            protocols: if ready {
                vec!["antigravity-app-cli-v1".to_string()]
            } else {
                Vec::new()
            },
            models,
            permission_options,
            observed_at: ready.then(|| observation.attempted_at.clone()),
            last_attempted_at: observation.attempted_at.clone(),
            last_successful_probe_at: ready.then(|| observation.attempted_at.clone()),
            stale_at: (!ready).then_some(observation.attempted_at),
            last_error: observation.last_error,
            native_session_compatibility_key: ready.then(|| {
                if observation.team_gateway_ready {
                    "antigravity-app:cli-v1:attested-team-v1:post-message-v1".to_string()
                } else {
                    "antigravity-app:cli-v1:no-team".to_string()
                }
            }),
        })
    }
}

fn acp_capability_snapshot(
    observation: AcpProbeObservation,
    permission_options: Vec<PermissionOptionDescriptor>,
) -> Result<AdapterCapabilitySnapshot> {
    let ready = observation.probe_status == "ready";
    let adapter_kind = observation.adapter_kind;
    let session_result = observation.session_result.as_ref();
    let mut models = if ready {
        let session = session_result.context("ready ACP probe did not create a session")?;
        match acp_models(session) {
            Ok(models) => models,
            Err(_)
                if matches!(
                    adapter_kind,
                    AdapterKind::QoderCli | AdapterKind::CodebuddyCli | AdapterKind::QwenCode
                ) =>
            {
                vec![ModelDescriptor {
                    id: format!("{}://runtime-default", adapter_kind.as_str()),
                    display_name: format!("{} runtime default", adapter_kind.as_str()),
                    is_default: true,
                    hidden: false,
                    deprecated: false,
                    options: Vec::new(),
                }]
            }
            Err(error) => return Err(error),
        }
    } else {
        Vec::new()
    };
    if adapter_kind == AdapterKind::KiroCli {
        for model in &mut models {
            model.options.clear();
        }
    }
    let mut capabilities = observation.capabilities;
    if ready {
        for capability in [
            "acp.initialize",
            "session.new",
            "session.prompt",
            "session.cancel",
            "session.update",
            "structured_permission_request",
            "context.charter.first_payload",
        ] {
            if !capabilities.iter().any(|value| value == capability) {
                capabilities.push(capability.to_string());
            }
        }
        let supports_load = observation
            .initialize_result
            .as_ref()
            .and_then(|value| value.pointer("/agentCapabilities/loadSession"))
            .and_then(Value::as_bool)
            == Some(true);
        if supports_load {
            capabilities.push("session.load".to_string());
            capabilities.push(TEAM_POST_MESSAGE_CAPABILITY.to_string());
        }
        append_exact_mcp_axes(&mut capabilities);
    }
    capabilities.sort();
    capabilities.dedup();
    let permission_options = if ready {
        permission_options
    } else {
        Vec::new()
    };
    let permission_schema_digest =
        canonical_json_digest(&serde_json::to_value(&permission_options)?)?;
    Ok(AdapterCapabilitySnapshot {
        reported_version: observation.reported_version,
        executable_fingerprint: observation.executable_fingerprint,
        authentication_status: observation.authentication_status,
        probe_status: observation.probe_status,
        permission_schema_version: 1,
        permission_schema_digest,
        capabilities,
        protocols: if ready {
            vec!["acp-v1".to_string()]
        } else {
            Vec::new()
        },
        models,
        permission_options,
        observed_at: ready.then(|| observation.attempted_at.clone()),
        last_attempted_at: observation.attempted_at.clone(),
        last_successful_probe_at: ready.then(|| observation.attempted_at.clone()),
        stale_at: (!ready).then_some(observation.attempted_at),
        last_error: observation.last_error,
        native_session_compatibility_key: ready
            .then(|| format!("{}:acp-v1", adapter_kind.as_str())),
    })
}

fn append_exact_mcp_axes(capabilities: &mut Vec<String>) {
    capabilities.extend([
        "mcp.external_projection.exact_per_run".to_string(),
        "team_gateway.attachment.injected_credential".to_string(),
        "mcp.ambient_isolation.exact".to_string(),
    ]);
}

fn acp_models(session_result: &Value) -> Result<Vec<ModelDescriptor>> {
    let config_options = session_result
        .get("configOptions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let model_config = config_options
        .iter()
        .find(|option| option.get("id").and_then(Value::as_str) == Some("model"));
    let current_model = session_result
        .pointer("/models/currentModelId")
        .and_then(Value::as_str)
        .or_else(|| {
            model_config
                .and_then(|option| option.get("currentValue"))
                .and_then(Value::as_str)
        });
    let mut values = session_result
        .pointer("/models/availableModels")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if values.is_empty() {
        values = model_config
            .and_then(|option| option.get("options"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
    }
    if values.is_empty() {
        anyhow::bail!("ACP session did not advertise any models");
    }
    let model_options = config_options
        .iter()
        .filter(|option| {
            matches!(
                option.get("id").and_then(Value::as_str),
                Some("reasoning_effort")
            )
        })
        .filter_map(acp_model_option)
        .collect::<Vec<_>>();
    let mut models = Vec::new();
    for value in values {
        let id = value
            .get("modelId")
            .or_else(|| value.get("value"))
            .or_else(|| value.get("id"))
            .and_then(Value::as_str)
            .context("ACP model is missing an identifier")?;
        let display_name = value
            .get("name")
            .or_else(|| value.get("displayName"))
            .or_else(|| value.get("label"))
            .and_then(Value::as_str)
            .unwrap_or(id);
        models.push(ModelDescriptor {
            id: id.to_string(),
            display_name: display_name.to_string(),
            is_default: current_model == Some(id),
            hidden: false,
            deprecated: false,
            options: model_options.clone(),
        });
    }
    models.sort_by(|left, right| {
        right
            .is_default
            .cmp(&left.is_default)
            .then_with(|| left.display_name.cmp(&right.display_name))
    });
    Ok(models)
}

fn acp_model_option(option: &Value) -> Option<ModelOptionDescriptor> {
    let key = option.get("id")?.as_str()?;
    let values = option
        .get("options")?
        .as_array()?
        .iter()
        .filter_map(|value| {
            let raw = value.get("value").or_else(|| value.get("id"))?.as_str()?;
            let label = value
                .get("name")
                .or_else(|| value.get("label"))
                .and_then(Value::as_str)
                .unwrap_or(raw);
            Some(ValueChoice {
                value: raw.to_string(),
                label: label.to_string(),
            })
        })
        .collect::<Vec<_>>();
    (!values.is_empty()).then(|| ModelOptionDescriptor {
        key: key.to_string(),
        label: option
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(key)
            .to_string(),
        value_type: "enum".to_string(),
        values,
        default_value: option
            .get("currentValue")
            .and_then(Value::as_str)
            .map(str::to_string),
        scope: RuntimeOptionScope::Run,
    })
}

fn opencode_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![PermissionOptionDescriptor {
        key: "permission".to_string(),
        label: "permission".to_string(),
        description: "OpenCode's native tool permission policy for this Agent Host.".to_string(),
        value_type: "enum".to_string(),
        choices: vec![
            choice("allow", "allow (no prompts)"),
            choice("ask", "ask"),
            choice("deny", "deny"),
        ],
        recommended_value: json!("ask"),
        scope: RuntimeOptionScope::Host,
        risk: "elevated".to_string(),
        supported: true,
        required: true,
        unsupported_reason: None,
    }]
}

fn copilot_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![PermissionOptionDescriptor {
        key: "allow_all".to_string(),
        label: "allow_all".to_string(),
        description: "Copilot CLI's native allow-all mode for this Agent Host.".to_string(),
        value_type: "enum".to_string(),
        choices: vec![choice("off", "off"), choice("on", "on (no prompts)")],
        recommended_value: json!("off"),
        scope: RuntimeOptionScope::Host,
        risk: "elevated".to_string(),
        supported: true,
        required: true,
        unsupported_reason: None,
    }]
}

fn qoder_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![PermissionOptionDescriptor {
        key: "permission_mode".to_string(),
        label: "permission-mode".to_string(),
        description: "Qoder CLI's native permission mode for this ACP Agent Host.".to_string(),
        value_type: "enum".to_string(),
        choices: [
            "default",
            "accept_edits",
            "bypass_permissions",
            "dont_ask",
            "auto",
        ]
        .into_iter()
        .map(|value| choice(value, value))
        .collect(),
        recommended_value: json!("default"),
        scope: RuntimeOptionScope::Host,
        risk: "elevated".to_string(),
        supported: true,
        required: true,
        unsupported_reason: None,
    }]
}

fn codebuddy_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![PermissionOptionDescriptor {
        key: "permission_mode".to_string(),
        label: "permission-mode".to_string(),
        description: "CodeBuddy's native permission mode for this ACP Agent Host.".to_string(),
        value_type: "enum".to_string(),
        choices: [
            "default",
            "acceptEdits",
            "bypassPermissions",
            "plan",
            "dontAsk",
            "auto",
        ]
        .into_iter()
        .map(|value| choice(value, value))
        .collect(),
        recommended_value: json!("default"),
        scope: RuntimeOptionScope::Host,
        risk: "elevated".to_string(),
        supported: true,
        required: true,
        unsupported_reason: None,
    }]
}

fn qwen_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![PermissionOptionDescriptor {
        key: "approval_mode".to_string(),
        label: "approval-mode".to_string(),
        description: "Qwen Code's native approval mode for this ACP Agent Host.".to_string(),
        value_type: "enum".to_string(),
        choices: ["default", "auto_edit", "yolo", "plan"]
            .into_iter()
            .map(|value| choice(value, value))
            .collect(),
        recommended_value: json!("default"),
        scope: RuntimeOptionScope::Host,
        risk: "elevated".to_string(),
        supported: true,
        required: true,
        unsupported_reason: None,
    }]
}

fn claude_code_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![PermissionOptionDescriptor {
        key: "permission_mode".to_string(),
        label: "permission-mode".to_string(),
        description: "Claude Code's native permission mode for writable non-interactive Runs. A read-only Workspace is narrowed to dontAsk, denies built-in write/Shell tools, and separately pre-authorizes only Rovai-ai's binding-authenticated Team Tool.".to_string(),
        value_type: "enum".to_string(),
        choices: vec![
            choice("manual", "manual"),
            choice("acceptEdits", "acceptEdits"),
            choice("plan", "plan"),
            choice("dontAsk", "dontAsk"),
            choice("auto", "auto"),
            choice("bypassPermissions", "bypassPermissions"),
        ],
        recommended_value: json!("acceptEdits"),
        scope: RuntimeOptionScope::Run,
        risk: "elevated".to_string(),
        supported: true,
        required: true,
        unsupported_reason: None,
    }]
}

fn antigravity_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![
        PermissionOptionDescriptor {
            key: "mode".to_string(),
            label: "mode".to_string(),
            description: "Antigravity App execution mode for this non-interactive companion CLI Run. plan prevents edits; accept-edits allows the Agent to apply edits subject to its remaining permission controls.".to_string(),
            value_type: "enum".to_string(),
            choices: vec![
                choice("accept-edits", "accept-edits"),
                choice("plan", "plan (read-only intent)"),
            ],
            recommended_value: json!("accept-edits"),
            scope: RuntimeOptionScope::Run,
            risk: "elevated".to_string(),
            supported: true,
            required: true,
            unsupported_reason: None,
        },
        PermissionOptionDescriptor {
            key: "sandbox".to_string(),
            label: "sandbox".to_string(),
            description: "Whether Rovai-ai passes the Antigravity companion CLI's native --sandbox flag for terminal restrictions. Rovai-ai does not modify Antigravity App's global settings.".to_string(),
            value_type: "enum".to_string(),
            choices: vec![choice("on", "on"), choice("off", "off")],
            recommended_value: json!("on"),
            scope: RuntimeOptionScope::Run,
            risk: "elevated".to_string(),
            supported: true,
            required: true,
            unsupported_reason: None,
        },
        PermissionOptionDescriptor {
            key: "dangerously_skip_permissions".to_string(),
            label: "dangerously-skip-permissions".to_string(),
            description: "The Antigravity companion CLI's native auto-approve flag. This process integration has no structured approval callback, so off is recommended; on permits side effects that Rovai-ai cannot pre-authorize individually.".to_string(),
            value_type: "enum".to_string(),
            choices: vec![
                choice("off", "off"),
                choice("on", "on (auto-approve all tool requests)"),
            ],
            recommended_value: json!("off"),
            scope: RuntimeOptionScope::Run,
            risk: "dangerous".to_string(),
            supported: true,
            required: true,
            unsupported_reason: None,
        },
    ]
}

fn resolve_acp_runtime(
    expected_kind: AdapterKind,
    input: AdapterRuntimeResolutionInput<'_>,
) -> Result<AdapterRuntimeProjection> {
    if input.permissions.adapter_kind != expected_kind {
        anyhow::bail!("ACP permission configuration belongs to another Adapter");
    }
    let protocol_version = input
        .protocols
        .iter()
        .find(|protocol| protocol.as_str() == "acp-v1")
        .context("ACP installation does not advertise ACP v1")?
        .clone();
    let permission_values = input
        .permissions
        .values
        .as_object()
        .context("ACP permission configuration must be an object")?;
    let descriptors = input
        .permission_descriptors
        .iter()
        .map(|descriptor| (descriptor.key.as_str(), descriptor))
        .collect::<BTreeMap<_, _>>();
    let scoped_values = |scope: RuntimeOptionScope| -> Result<Value> {
        let mut values = serde_json::Map::new();
        for (key, value) in permission_values {
            let descriptor = descriptors
                .get(key.as_str())
                .with_context(|| format!("missing ACP permission descriptor for {key}"))?;
            if descriptor.scope == scope {
                values.insert(key.clone(), value.clone());
            }
        }
        Ok(Value::Object(values))
    };
    let binding_compatibility_digest = canonical_json_digest(&json!({
        "adapterKind": expected_kind,
        "installationId": input.installation_id,
        "protocolVersion": protocol_version,
        "permissionSchemaVersion": input.permissions.schema_version,
        "sessionPermissions": scoped_values(RuntimeOptionScope::Session)?,
    }))?;
    let host_config_digest = canonical_json_digest(&json!({
        "adapterKind": expected_kind,
        "installationId": input.installation_id,
        "executablePath": input.executable_path,
        "executableFingerprint": input.executable_fingerprint,
        "authScope": input.auth_scope,
        "protocolVersion": protocol_version,
        "permissionSchemaVersion": input.permissions.schema_version,
        "hostPermissions": scoped_values(RuntimeOptionScope::Host)?,
    }))?;
    Ok(AdapterRuntimeProjection {
        protocol_version,
        binding_compatibility_digest,
        host_config_digest,
    })
}

impl AgentRuntimeAdapter for OpenCodeCliAdapterPolicy {
    fn kind(&self) -> AdapterKind {
        AdapterKind::OpencodeCli
    }

    fn skill_discovery(&self) -> SkillDiscoveryCapability {
        native_skill_discovery(NativeSkillRootKind::Agents)
    }

    fn mcp_projection(&self) -> McpProjectionCapability {
        exact_native_mcp_projection()
    }

    fn resolve_runtime(
        &self,
        input: AdapterRuntimeResolutionInput<'_>,
    ) -> Result<AdapterRuntimeProjection> {
        resolve_acp_runtime(self.kind(), input)
    }
}

impl AgentRuntimeAdapter for CopilotCliAdapterPolicy {
    fn kind(&self) -> AdapterKind {
        AdapterKind::CopilotCli
    }

    fn skill_discovery(&self) -> SkillDiscoveryCapability {
        native_skill_discovery(NativeSkillRootKind::Agents)
    }

    fn mcp_projection(&self) -> McpProjectionCapability {
        exact_native_mcp_projection()
    }

    fn resolve_runtime(
        &self,
        input: AdapterRuntimeResolutionInput<'_>,
    ) -> Result<AdapterRuntimeProjection> {
        resolve_acp_runtime(self.kind(), input)
    }
}

impl AgentRuntimeAdapter for ClaudeCodeCliAdapterPolicy {
    fn kind(&self) -> AdapterKind {
        AdapterKind::ClaudeCodeCli
    }

    fn skill_discovery(&self) -> SkillDiscoveryCapability {
        native_skill_discovery(NativeSkillRootKind::Claude)
    }

    fn mcp_projection(&self) -> McpProjectionCapability {
        exact_native_mcp_projection()
    }

    fn resolve_runtime(
        &self,
        input: AdapterRuntimeResolutionInput<'_>,
    ) -> Result<AdapterRuntimeProjection> {
        if input.permissions.adapter_kind != self.kind() {
            anyhow::bail!("Claude Code permission configuration belongs to another Adapter");
        }
        let protocol_version = input
            .protocols
            .iter()
            .find(|protocol| protocol.as_str() == "claude-code-print-v1")
            .context("Claude Code installation does not advertise print-mode integration")?
            .clone();
        let permission_values = input
            .permissions
            .values
            .as_object()
            .context("Claude Code permission configuration must be an object")?;
        let descriptors = input
            .permission_descriptors
            .iter()
            .map(|descriptor| (descriptor.key.as_str(), descriptor))
            .collect::<BTreeMap<_, _>>();
        for key in permission_values.keys() {
            descriptors
                .get(key.as_str())
                .with_context(|| format!("missing Claude Code permission descriptor for {key}"))?;
        }
        let binding_compatibility_digest = canonical_json_digest(&json!({
            "adapterKind": self.kind(),
            "installationId": input.installation_id,
            "protocolVersion": protocol_version,
        }))?;
        let host_config_digest = canonical_json_digest(&json!({
            "adapterKind": self.kind(),
            "installationId": input.installation_id,
            "executablePath": input.executable_path,
            "executableFingerprint": input.executable_fingerprint,
            "authScope": input.auth_scope,
            "protocolVersion": protocol_version,
            "permissionSchemaVersion": input.permissions.schema_version,
            "runPermissions": permission_values,
        }))?;
        Ok(AdapterRuntimeProjection {
            protocol_version,
            binding_compatibility_digest,
            host_config_digest,
        })
    }
}

impl AgentRuntimeAdapter for AntigravityAppAdapterPolicy {
    fn kind(&self) -> AdapterKind {
        AdapterKind::AntigravityApp
    }

    fn skill_discovery(&self) -> SkillDiscoveryCapability {
        native_skill_discovery(NativeSkillRootKind::Antigravity)
    }

    fn mcp_projection(&self) -> McpProjectionCapability {
        attested_native_mcp_projection()
    }

    fn resolve_runtime(
        &self,
        input: AdapterRuntimeResolutionInput<'_>,
    ) -> Result<AdapterRuntimeProjection> {
        if input.permissions.adapter_kind != self.kind() {
            anyhow::bail!("Antigravity App permission configuration belongs to another Adapter");
        }
        let protocol_version = input
            .protocols
            .iter()
            .find(|protocol| protocol.as_str() == "antigravity-app-cli-v1")
            .context("Antigravity App installation does not advertise its companion CLI protocol")?
            .clone();
        let permission_values = input
            .permissions
            .values
            .as_object()
            .context("Antigravity App permission configuration must be an object")?;
        let descriptors = input
            .permission_descriptors
            .iter()
            .map(|descriptor| (descriptor.key.as_str(), descriptor))
            .collect::<BTreeMap<_, _>>();
        for key in permission_values.keys() {
            descriptors.get(key.as_str()).with_context(|| {
                format!("missing Antigravity App permission descriptor for {key}")
            })?;
        }

        // All currently exposed Antigravity companion CLI flags are applied to
        // one invocation.
        // They do not change the identity or resume semantics of the underlying
        // conversation, so a permission edit need not discard useful context.
        let binding_compatibility_digest = canonical_json_digest(&json!({
            "adapterKind": self.kind(),
            "installationId": input.installation_id,
            "protocolVersion": protocol_version,
        }))?;
        let host_config_digest = canonical_json_digest(&json!({
            "adapterKind": self.kind(),
            "installationId": input.installation_id,
            "executablePath": input.executable_path,
            "executableFingerprint": input.executable_fingerprint,
            "authScope": input.auth_scope,
            "protocolVersion": protocol_version,
            "permissionSchemaVersion": input.permissions.schema_version,
            "runPermissions": permission_values,
        }))?;
        Ok(AdapterRuntimeProjection {
            protocol_version,
            binding_compatibility_digest,
            host_config_digest,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_profile::{PermissionOptionDescriptor, ValueChoice};

    #[test]
    fn member_permission_defaults_preserve_each_runtime_native_shape() {
        let registry = AgentRuntimeAdapterRegistry::default();
        let expected = [
            (
                AdapterKind::CodexCli,
                json!({
                    "sandbox_mode": "danger-full-access",
                    "approval_policy": "never",
                }),
            ),
            (AdapterKind::OpencodeCli, json!({"permission": "allow"})),
            (AdapterKind::CopilotCli, json!({"allow_all": "on"})),
            (
                AdapterKind::ClaudeCodeCli,
                json!({"permission_mode": "bypassPermissions"}),
            ),
            (AdapterKind::KiroCli, json!({})),
            (
                AdapterKind::QoderCli,
                json!({"permission_mode": "bypass_permissions"}),
            ),
            (
                AdapterKind::CodebuddyCli,
                json!({"permission_mode": "bypassPermissions"}),
            ),
            (AdapterKind::QwenCode, json!({"approval_mode": "yolo"})),
            (
                AdapterKind::AntigravityApp,
                json!({
                    "mode": "accept-edits",
                    "sandbox": "off",
                    "dangerously_skip_permissions": "on",
                }),
            ),
        ];
        for (kind, values) in expected {
            assert_eq!(registry.member_permission_defaults(kind), values);
        }
    }

    #[cfg(unix)]
    #[test]
    fn executable_file_identity_detects_same_path_replacement_without_hashing() {
        use std::os::unix::fs::PermissionsExt;

        let path =
            std::env::temp_dir().join(format!("rovai-runtime-identity-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"runtime-v1").expect("write runtime fixture");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .expect("make runtime fixture executable");
        let initial =
            observe_executable_file_identity(&path).expect("observe initial Runtime identity");
        let expected_fingerprint =
            executable_fingerprint(&path).expect("fingerprint initial Runtime");
        assert_eq!(
            verify_executable_integrity(&path, Some(&initial), &expected_fingerprint)
                .expect("verify unchanged Runtime"),
            ExecutableIntegrityStatus::Unchanged
        );

        std::fs::remove_file(&path).expect("remove initial Runtime fixture");
        std::fs::write(&path, b"runtime-v1").expect("write equivalent runtime fixture");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .expect("make equivalent Runtime fixture executable");
        assert!(matches!(
            verify_executable_integrity(&path, Some(&initial), &expected_fingerprint)
                .expect("reverify equivalent Runtime"),
            ExecutableIntegrityStatus::Reverified(_)
        ));

        std::fs::remove_file(&path).expect("remove equivalent Runtime fixture");
        std::fs::write(&path, b"runtime-v2").expect("write replacement runtime fixture");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .expect("make replacement Runtime fixture executable");
        let replacement =
            observe_executable_file_identity(&path).expect("observe replacement Runtime identity");

        assert_eq!(replacement.byte_size, initial.byte_size);
        assert_ne!(replacement.file_id, initial.file_id);
        assert_eq!(
            verify_executable_integrity(&path, Some(&initial), &expected_fingerprint)
                .expect("detect changed Runtime"),
            ExecutableIntegrityStatus::Changed
        );
        std::fs::remove_file(path).expect("remove Runtime fixture");
    }

    fn descriptor(key: &str, scope: RuntimeOptionScope) -> PermissionOptionDescriptor {
        PermissionOptionDescriptor {
            key: key.to_string(),
            label: key.to_string(),
            description: String::new(),
            value_type: "enum".to_string(),
            choices: vec![ValueChoice {
                value: "value".to_string(),
                label: "Value".to_string(),
            }],
            recommended_value: json!("value"),
            scope,
            risk: "medium".to_string(),
            supported: true,
            required: true,
            unsupported_reason: None,
        }
    }

    #[test]
    fn run_options_do_not_change_codex_binding_compatibility() {
        let adapter = CodexCliAdapterPolicy;
        let descriptors = vec![
            descriptor("sandbox_mode", RuntimeOptionScope::Session),
            descriptor("host_mode", RuntimeOptionScope::Host),
        ];
        let permissions = AdapterPermissionConfig {
            adapter_kind: AdapterKind::CodexCli,
            schema_version: 1,
            values: json!({"sandbox_mode": "value", "host_mode": "value"}),
        };
        let protocols = vec!["codex-app-server-v2".to_string()];
        let resolved = adapter
            .resolve_runtime(AdapterRuntimeResolutionInput {
                installation_id: "codex-local",
                executable_path: "/opt/bin/codex",
                auth_scope: "local-user",
                executable_fingerprint: "sha256:one",
                protocols: &protocols,
                native_session_compatibility_key: Some("codex-cli:app-server-v2"),
                permissions: &permissions,
                permission_descriptors: &descriptors,
            })
            .expect("runtime should resolve");
        let upgraded_host = adapter
            .resolve_runtime(AdapterRuntimeResolutionInput {
                executable_fingerprint: "sha256:two",
                installation_id: "codex-local",
                executable_path: "/opt/bin/codex",
                auth_scope: "local-user",
                protocols: &protocols,
                native_session_compatibility_key: Some("codex-cli:app-server-v2"),
                permissions: &permissions,
                permission_descriptors: &descriptors,
            })
            .expect("runtime should resolve");
        let changed_session_key = adapter
            .resolve_runtime(AdapterRuntimeResolutionInput {
                installation_id: "codex-local",
                executable_path: "/opt/bin/codex",
                auth_scope: "local-user",
                executable_fingerprint: "sha256:one",
                protocols: &protocols,
                native_session_compatibility_key: Some("codex-cli:app-server-v3"),
                permissions: &permissions,
                permission_descriptors: &descriptors,
            })
            .expect("runtime should resolve");
        assert_eq!(
            resolved.binding_compatibility_digest,
            upgraded_host.binding_compatibility_digest
        );
        assert_ne!(
            resolved.host_config_digest,
            upgraded_host.host_config_digest
        );
        assert_eq!(
            resolved.binding_compatibility_digest, changed_session_key.binding_compatibility_digest,
            "the Adapter session key is persisted and evaluated independently"
        );
    }

    #[test]
    fn codex_model_list_becomes_a_dynamic_model_and_permission_catalog() {
        let snapshot = AgentRuntimeAdapterRegistry::default()
            .codex_capability_snapshot(CodexProbeObservation {
                reported_version: Some("codex-cli test".to_string()),
                executable_fingerprint: Some("sha256:test".to_string()),
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                capabilities: vec!["app_server.initialize".to_string()],
                raw_model_catalog: Some(json!({
                    "data": [{
                        "id": "gpt-current",
                        "displayName": "GPT Current",
                        "isDefault": true,
                        "hidden": false,
                        "upgrade": null,
                        "defaultReasoningEffort": "high",
                        "supportedReasoningEfforts": [
                            {"reasoningEffort": "high", "description": "Deep reasoning"},
                            {"reasoningEffort": "xhigh", "description": "Deeper reasoning"}
                        ]
                    }]
                })),
                attempted_at: "2026-07-22T00:00:00Z".to_string(),
                last_error: None,
            })
            .expect("Codex catalog should map");

        assert_eq!(snapshot.models[0].id, "gpt-current");
        assert_eq!(
            snapshot.models[0].options[0].default_value.as_deref(),
            Some("high")
        );
        assert!(
            snapshot.permission_options[0]
                .choices
                .iter()
                .any(|choice| choice.value == "danger-full-access")
        );
        assert!(
            snapshot.permission_options[1]
                .choices
                .iter()
                .any(|choice| choice.value == "never")
        );
        assert!(
            snapshot
                .capabilities
                .contains(&TEAM_POST_MESSAGE_CAPABILITY.to_string())
        );
        assert!(
            snapshot
                .capabilities
                .contains(&"context.charter.native_append".to_string())
        );
    }

    #[test]
    fn opencode_models_are_read_from_acp_config_options() {
        let snapshot = AgentRuntimeAdapterRegistry::default()
            .acp_capability_snapshot(AcpProbeObservation {
                adapter_kind: AdapterKind::OpencodeCli,
                reported_version: Some("1.18.0".to_string()),
                executable_fingerprint: Some("sha256:opencode".to_string()),
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                capabilities: Vec::new(),
                initialize_result: Some(json!({
                    "protocolVersion": 1,
                    "agentCapabilities": {"loadSession": true}
                })),
                session_result: Some(json!({
                    "sessionId": "ses-test",
                    "configOptions": [{
                        "id": "model",
                        "name": "Model",
                        "currentValue": "opencode/current",
                        "options": [
                            {"value": "opencode/current", "name": "Current"},
                            {"value": "opencode/next", "name": "Next"}
                        ]
                    }]
                })),
                attempted_at: "2026-07-22T00:00:00Z".to_string(),
                last_error: None,
            })
            .expect("OpenCode ACP catalog should map");

        assert_eq!(snapshot.protocols, vec!["acp-v1"]);
        assert_eq!(snapshot.models.len(), 2);
        assert_eq!(snapshot.models[0].id, "opencode/current");
        assert!(snapshot.models[0].is_default);
        assert_eq!(snapshot.permission_options[0].key, "permission");
        assert!(snapshot.capabilities.contains(&"session.load".to_string()));
        assert!(
            snapshot
                .capabilities
                .contains(&TEAM_POST_MESSAGE_CAPABILITY.to_string())
        );
        assert!(
            snapshot
                .capabilities
                .contains(&"context.charter.first_payload".to_string())
        );
    }

    #[test]
    fn copilot_models_and_reasoning_are_read_from_acp_session() {
        let snapshot = AgentRuntimeAdapterRegistry::default()
            .acp_capability_snapshot(AcpProbeObservation {
                adapter_kind: AdapterKind::CopilotCli,
                reported_version: Some("1.0.73".to_string()),
                executable_fingerprint: Some("sha256:copilot".to_string()),
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                capabilities: Vec::new(),
                initialize_result: Some(json!({
                    "protocolVersion": 1,
                    "agentCapabilities": {"loadSession": true}
                })),
                session_result: Some(json!({
                    "sessionId": "copilot-test",
                    "configOptions": [
                        {
                            "id": "model",
                            "currentValue": "gpt-5.6-sol",
                            "options": [{"value": "gpt-5.6-sol", "name": "GPT-5.6 Sol"}]
                        },
                        {
                            "id": "reasoning_effort",
                            "name": "Reasoning effort",
                            "currentValue": "xhigh",
                            "options": [
                                {"value": "high", "name": "High"},
                                {"value": "xhigh", "name": "Extra high"}
                            ]
                        }
                    ]
                })),
                attempted_at: "2026-07-22T00:00:00Z".to_string(),
                last_error: None,
            })
            .expect("Copilot ACP catalog should map");

        assert_eq!(snapshot.models[0].id, "gpt-5.6-sol");
        assert_eq!(snapshot.models[0].options[0].key, "reasoning_effort");
        assert_eq!(
            snapshot.models[0].options[0].default_value.as_deref(),
            Some("xhigh")
        );
        assert_eq!(snapshot.permission_options[0].key, "allow_all");
        assert!(
            snapshot
                .capabilities
                .contains(&TEAM_POST_MESSAGE_CAPABILITY.to_string())
        );
        assert!(
            snapshot
                .capabilities
                .contains(&"context.charter.first_payload".to_string())
        );
    }

    #[test]
    fn kiro_models_do_not_expose_unsupported_generic_config_options() {
        let snapshot = AgentRuntimeAdapterRegistry::default()
            .acp_capability_snapshot(AcpProbeObservation {
                adapter_kind: AdapterKind::KiroCli,
                reported_version: Some("2.15.0".to_string()),
                executable_fingerprint: Some("sha256:kiro".to_string()),
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                capabilities: vec!["session.set_model".to_string()],
                initialize_result: Some(json!({
                    "protocolVersion": 1,
                    "agentCapabilities": {"loadSession": true}
                })),
                session_result: Some(json!({
                    "sessionId": "kiro-test",
                    "models": {
                        "currentModelId": "claude-sonnet",
                        "availableModels": [{
                            "modelId": "claude-sonnet",
                            "name": "Claude Sonnet"
                        }]
                    },
                    "configOptions": [{
                        "id": "reasoning_effort",
                        "currentValue": "high",
                        "options": [{"value": "high", "name": "High"}]
                    }]
                })),
                attempted_at: "2026-07-29T00:00:00Z".to_string(),
                last_error: None,
            })
            .expect("Kiro ACP catalog should map");

        assert_eq!(snapshot.models[0].id, "claude-sonnet");
        assert!(snapshot.models[0].options.is_empty());
        assert!(snapshot.permission_options.is_empty());
        assert!(
            snapshot
                .capabilities
                .contains(&"session.set_model".to_string())
        );
    }

    #[test]
    fn acp_host_permissions_replace_the_host_but_not_the_conversation_binding() {
        let registry = AgentRuntimeAdapterRegistry::default();
        let descriptors = copilot_permission_options();
        let protocols = vec!["acp-v1".to_string()];
        let off = AdapterPermissionConfig {
            adapter_kind: AdapterKind::CopilotCli,
            schema_version: 1,
            values: json!({"allow_all": "off"}),
        };
        let on = AdapterPermissionConfig {
            adapter_kind: AdapterKind::CopilotCli,
            schema_version: 1,
            values: json!({"allow_all": "on"}),
        };
        let resolve = |permissions: &AdapterPermissionConfig| {
            registry
                .resolve_runtime(
                    AdapterKind::CopilotCli,
                    AdapterRuntimeResolutionInput {
                        installation_id: "copilot-local",
                        executable_path: "/opt/bin/copilot",
                        auth_scope: "local-user",
                        executable_fingerprint: "sha256:test",
                        protocols: &protocols,
                        native_session_compatibility_key: Some("copilot-cli:acp-v1"),
                        permissions,
                        permission_descriptors: &descriptors,
                    },
                )
                .expect("ACP runtime should resolve")
        };
        let off = resolve(&off);
        let on = resolve(&on);
        assert_eq!(
            off.binding_compatibility_digest,
            on.binding_compatibility_digest
        );
        assert_ne!(off.host_config_digest, on.host_config_digest);
    }

    #[test]
    fn antigravity_models_and_permissions_are_capability_driven() {
        let snapshot = AgentRuntimeAdapterRegistry::default()
            .antigravity_capability_snapshot(AntigravityProbeObservation {
                reported_version: Some("1.1.5".to_string()),
                executable_fingerprint: Some("sha256:agy".to_string()),
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                capabilities: Vec::new(),
                models: vec![
                    "gemini-3.6-flash-high".to_string(),
                    "claude-sonnet-4-6".to_string(),
                ],
                team_gateway_ready: true,
                attempted_at: "2026-07-22T00:00:00Z".to_string(),
                last_error: None,
            })
            .expect("Antigravity catalog should map");

        assert_eq!(snapshot.models[0].id, ANTIGRAVITY_RUNTIME_DEFAULT_MODEL_ID);
        assert!(snapshot.models[0].is_default);
        assert_eq!(snapshot.models[1].id, "gemini-3.6-flash-high");
        assert!(
            snapshot
                .capabilities
                .iter()
                .any(|capability| capability == "conversation.resume")
        );
        assert_eq!(snapshot.permission_options[0].key, "mode");
        assert_eq!(
            snapshot.permission_options[2].recommended_value,
            json!("off")
        );
        assert!(
            snapshot
                .capabilities
                .contains(&TEAM_POST_MESSAGE_CAPABILITY.to_string())
        );
        assert!(
            snapshot
                .capabilities
                .contains(&"team_gateway.attachment.attested_native_bridge".to_string())
        );
        assert_eq!(
            snapshot.native_session_compatibility_key.as_deref(),
            Some("antigravity-app:cli-v1:attested-team-v1:post-message-v1")
        );
    }

    #[test]
    fn antigravity_run_permissions_do_not_discard_the_native_conversation() {
        let registry = AgentRuntimeAdapterRegistry::default();
        let descriptors = antigravity_permission_options();
        let protocols = vec!["antigravity-app-cli-v1".to_string()];
        let resolve = |mode: &str| {
            let permissions = AdapterPermissionConfig {
                adapter_kind: AdapterKind::AntigravityApp,
                schema_version: 1,
                values: json!({
                    "mode": mode,
                    "sandbox": "on",
                    "dangerously_skip_permissions": "off",
                }),
            };
            registry
                .resolve_runtime(
                    AdapterKind::AntigravityApp,
                    AdapterRuntimeResolutionInput {
                        installation_id: "agy-local",
                        executable_path: "/opt/bin/agy",
                        auth_scope: "local-user",
                        executable_fingerprint: "sha256:test",
                        protocols: &protocols,
                        native_session_compatibility_key: Some("antigravity-app:cli-v1"),
                        permissions: &permissions,
                        permission_descriptors: &descriptors,
                    },
                )
                .expect("Antigravity runtime should resolve")
        };
        let edits = resolve("accept-edits");
        let plan = resolve("plan");
        assert_eq!(
            edits.binding_compatibility_digest,
            plan.binding_compatibility_digest
        );
        assert_ne!(edits.host_config_digest, plan.host_config_digest);
    }

    #[test]
    fn claude_code_uses_installed_aliases_and_additive_team_tool_support() {
        let registry = AgentRuntimeAdapterRegistry::default();
        let snapshot = registry
            .claude_code_capability_snapshot(ClaudeCodeProbeObservation {
                reported_version: Some("2.1.206".to_string()),
                executable_fingerprint: Some("sha256:claude".to_string()),
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                capabilities: vec!["output.json".to_string()],
                model_aliases: vec!["sonnet".to_string(), "opus".to_string()],
                attempted_at: "2026-07-23T00:00:00Z".to_string(),
                last_error: None,
            })
            .expect("Claude Code catalog should map");

        assert_eq!(snapshot.models[0].id, CLAUDE_CODE_RUNTIME_DEFAULT_MODEL_ID);
        assert!(snapshot.models[0].is_default);
        assert_eq!(snapshot.models[1].id, "sonnet");
        assert!(
            snapshot
                .capabilities
                .contains(&TEAM_POST_MESSAGE_CAPABILITY.to_string())
        );
        assert_eq!(
            snapshot.permission_options[0].recommended_value,
            json!("acceptEdits")
        );
    }

    #[test]
    fn adapters_declare_only_the_minimum_native_project_skill_roots() {
        let registry = AgentRuntimeAdapterRegistry::default();
        for kind in [
            AdapterKind::CodexCli,
            AdapterKind::OpencodeCli,
            AdapterKind::CopilotCli,
        ] {
            assert_eq!(
                registry.skill_discovery(kind).native_roots,
                [NativeSkillRootKind::Agents]
            );
        }
        assert_eq!(
            registry
                .skill_discovery(AdapterKind::ClaudeCodeCli)
                .native_roots,
            [NativeSkillRootKind::Claude]
        );
        assert_eq!(
            registry
                .skill_discovery(AdapterKind::AntigravityApp)
                .native_roots,
            [NativeSkillRootKind::Antigravity]
        );
        for kind in [
            AdapterKind::KiroCli,
            AdapterKind::QoderCli,
            AdapterKind::CodebuddyCli,
            AdapterKind::QwenCode,
        ] {
            assert!(!registry.skill_discovery(kind).supported);
        }
    }

    #[test]
    fn mcp_projection_capability_matches_the_verified_v019_matrix() {
        let registry = AgentRuntimeAdapterRegistry::default();
        for kind in [
            AdapterKind::CodexCli,
            AdapterKind::ClaudeCodeCli,
            AdapterKind::OpencodeCli,
            AdapterKind::CopilotCli,
            AdapterKind::KiroCli,
            AdapterKind::QoderCli,
            AdapterKind::CodebuddyCli,
            AdapterKind::QwenCode,
        ] {
            let capability = registry.mcp_projection(kind);
            assert!(capability.supports_stdio);
            assert!(capability.supports_streamable_http);
            assert_eq!(
                capability.external_mcp_projection,
                ExternalMcpProjection::ExactPerRun
            );
            assert_eq!(
                capability.team_gateway_attachment,
                TeamGatewayAttachment::InjectedCredential
            );
            assert_eq!(capability.ambient_mcp_isolation, AmbientMcpIsolation::Exact);
            assert_eq!(
                capability.approval_control,
                McpApprovalControl::RuntimeNative
            );
        }
        let capability = registry.mcp_projection(AdapterKind::AntigravityApp);
        assert!(!capability.supports_stdio);
        assert!(!capability.supports_streamable_http);
        assert_eq!(
            capability.external_mcp_projection,
            ExternalMcpProjection::Unsupported
        );
        assert_eq!(
            capability.team_gateway_attachment,
            TeamGatewayAttachment::AttestedNativeBridge
        );
        assert_eq!(
            capability.ambient_mcp_isolation,
            AmbientMcpIsolation::PreservedUncontrolled
        );
        assert_eq!(
            capability.approval_control,
            McpApprovalControl::RuntimeNative
        );
    }
}
