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
    builtin_tool_transport::{
        BUILTIN_TOOL_CONTRACT_VERSION, BUILTIN_TOOL_RUNTIME_CAPABILITY, builtin_tool_catalog_digest,
    },
    command::canonical_json_digest,
    context_contract::{CODEX_SESSION_GUIDANCE_REVISION, native_binding_context_contract},
    mcp::McpServerDefinition,
    platform::HostPlatformKey,
    runtime_platform_admission::{
        GROK_BUILD_MACOS_ARM64_EVIDENCE_REVISION, MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION,
        RuntimePlatformAdmission, RuntimePlatformAdmissionReasonCode,
        WINDOWS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION,
    },
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
    #[cfg(windows)]
    if !canonical
        .extension()
        .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("exe"))
    {
        anyhow::bail!(
            "Runtime executable is not a native Windows EXE: {}",
            canonical.display()
        );
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
    #[cfg(windows)]
    let file_id = Some(windows_executable_file_id(&file).with_context(|| {
        format!(
            "failed to read opened Runtime identity for {}",
            canonical.display()
        )
    })?);
    #[cfg(not(any(unix, windows)))]
    let file_id = None;
    Ok(ExecutableFileIdentity {
        byte_size: metadata.len(),
        modified_at_unix_nanos,
        file_id,
    })
}

#[cfg(windows)]
fn windows_executable_file_id(file: &File) -> Result<String> {
    use std::{mem::size_of, os::windows::io::AsRawHandle};

    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ID_INFO, FileIdInfo, GetFileInformationByHandleEx,
    };

    let mut identity = FILE_ID_INFO::default();
    // SAFETY: `file` owns a live, non-inheritable file handle. `identity` is a
    // correctly sized writable FILE_ID_INFO buffer for the FileIdInfo class.
    let succeeded = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            std::ptr::from_mut(&mut identity).cast(),
            u32::try_from(size_of::<FILE_ID_INFO>()).expect("FILE_ID_INFO size fits DWORD"),
        )
    };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error()).context("GetFileInformationByHandleEx failed");
    }

    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut file_id = String::with_capacity(identity.FileId.Identifier.len() * 2);
    for byte in identity.FileId.Identifier {
        file_id.push(char::from(HEX[usize::from(byte >> 4)]));
        file_id.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    Ok(format!(
        "windows:{:016x}:{file_id}",
        identity.VolumeSerialNumber
    ))
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
pub enum SkillDeliveryGroupKey {
    Codex,
    Opencode,
    Copilot,
    ClaudeCompatible,
    Antigravity,
    Kiro,
    Qoder,
    Codebuddy,
    Qwen,
    Trae,
    Cursor,
    Kimi,
    Grok,
}

impl SkillDeliveryGroupKey {
    pub const ALL: [Self; 13] = [
        Self::Codex,
        Self::Opencode,
        Self::Copilot,
        Self::ClaudeCompatible,
        Self::Antigravity,
        Self::Kiro,
        Self::Qoder,
        Self::Codebuddy,
        Self::Qwen,
        Self::Trae,
        Self::Cursor,
        Self::Kimi,
        Self::Grok,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Opencode => "opencode",
            Self::Copilot => "copilot",
            Self::ClaudeCompatible => "claude_compatible",
            Self::Antigravity => "antigravity",
            Self::Kiro => "kiro",
            Self::Qoder => "qoder",
            Self::Codebuddy => "codebuddy",
            Self::Qwen => "qwen",
            Self::Trae => "trae",
            Self::Cursor => "cursor",
            Self::Kimi => "kimi",
            Self::Grok => "grok",
        }
    }

    pub fn relative_path(self) -> &'static Path {
        match self {
            Self::Codex => Path::new(".codex/skills"),
            Self::Opencode => Path::new(".opencode/skills"),
            Self::Copilot => Path::new(".github/skills"),
            Self::ClaudeCompatible => Path::new(".claude/skills"),
            Self::Antigravity => Path::new(".agent/skills"),
            Self::Kiro => Path::new(".kiro/skills"),
            Self::Qoder => Path::new(".qoder/skills"),
            Self::Codebuddy => Path::new(".codebuddy/skills"),
            Self::Qwen => Path::new(".qwen/skills"),
            Self::Trae => Path::new(".trae/skills"),
            Self::Cursor => Path::new(".cursor/skills"),
            Self::Kimi => Path::new(".kimi-code/skills"),
            Self::Grok => Path::new(".grok/skills"),
        }
    }
}

impl std::str::FromStr for SkillDeliveryGroupKey {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "codex" => Ok(Self::Codex),
            "opencode" => Ok(Self::Opencode),
            "copilot" => Ok(Self::Copilot),
            "claude_compatible" => Ok(Self::ClaudeCompatible),
            "antigravity" => Ok(Self::Antigravity),
            "kiro" => Ok(Self::Kiro),
            "qoder" => Ok(Self::Qoder),
            "codebuddy" => Ok(Self::Codebuddy),
            "qwen" => Ok(Self::Qwen),
            "trae" => Ok(Self::Trae),
            "cursor" => Ok(Self::Cursor),
            "kimi" => Ok(Self::Kimi),
            "grok" => Ok(Self::Grok),
            _ => anyhow::bail!("unsupported Skill delivery group: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillDiscoveryVerification {
    Verified,
    DocumentationOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDiscoveryCapability {
    pub delivery_groups: Vec<SkillDeliveryGroupKey>,
    pub verification: SkillDiscoveryVerification,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalMcpProjection {
    AdditivePerRun,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpSameNamePolicy {
    NativeWinsSkip,
    RovaiWins,
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
    pub same_name_policy: Option<McpSameNamePolicy>,
    pub approval_control: McpApprovalControl,
}

fn additive_native_mcp_projection(same_name_policy: McpSameNamePolicy) -> McpProjectionCapability {
    McpProjectionCapability {
        supports_stdio: true,
        supports_streamable_http: true,
        external_mcp_projection: ExternalMcpProjection::AdditivePerRun,
        same_name_policy: Some(same_name_policy),
        approval_control: McpApprovalControl::RuntimeNative,
    }
}

fn unsupported_external_mcp_projection() -> McpProjectionCapability {
    McpProjectionCapability {
        supports_stdio: false,
        supports_streamable_http: false,
        external_mcp_projection: ExternalMcpProjection::Unsupported,
        same_name_policy: None,
        approval_control: McpApprovalControl::RuntimeNative,
    }
}

fn native_skill_discovery(
    delivery_groups: impl IntoIterator<Item = SkillDeliveryGroupKey>,
    verification: SkillDiscoveryVerification,
) -> SkillDiscoveryCapability {
    SkillDiscoveryCapability {
        delivery_groups: delivery_groups.into_iter().collect(),
        verification,
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
    pub builtin_cli_ready: bool,
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
/// Frozen model identity used only while TRAE is statically installed but has
/// not yet exposed its live model catalog. The first real ACP Session leaves
/// the Runtime's current model untouched.
pub const TRAE_RUNTIME_DEFAULT_MODEL_ID: &str = "trae-cn-cli://runtime-default";
pub const CURSOR_RUNTIME_DEFAULT_MODEL_ID: &str = "cursor-agent://runtime-default";
pub const KIRO_ADDITIVE_AGENT_NAME: &str = "rovai";

/// Writes the Kiro custom Agent used by Rovai-ai ACP Hosts. Native MCP sources
/// remain enabled; the Agent's `mcpServers` table contains only this Run's
/// additive Rovai definitions.
pub fn write_kiro_additive_agent_config(
    launch_root: &Path,
    mcp_servers: &BTreeMap<String, McpServerDefinition>,
) -> Result<PathBuf> {
    let agent_directory = launch_root.join(".kiro/agents");
    std::fs::create_dir_all(&agent_directory).with_context(|| {
        format!(
            "failed to create private Kiro Agent directory {}",
            agent_directory.display()
        )
    })?;
    let path = agent_directory.join(format!("{KIRO_ADDITIVE_AGENT_NAME}.json"));
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&json!({
            "name": KIRO_ADDITIVE_AGENT_NAME,
            "description": "Rovai-ai additive per-AgentRun ACP host",
            "prompt": null,
            "mcpServers": mcp_servers.iter().map(|(name, definition)| {
                let value = match definition {
                    McpServerDefinition::Stdio { command, args, cwd, env } => json!({
                        "type": "stdio", "command": command, "args": args,
                        "cwd": cwd, "env": env
                    }),
                    McpServerDefinition::StreamableHttp { url, headers } => json!({
                        "type": "http", "url": url, "headers": headers
                    }),
                };
                (name.clone(), value)
            }).collect::<serde_json::Map<_, _>>(),
            "tools": ["*"],
            "toolAliases": {},
            "allowedTools": [],
            "resources": [],
            "toolsSettings": {},
            "includeMcpJson": true,
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
    pub fn platform_admission(
        &self,
        kind: AdapterKind,
        platform: HostPlatformKey,
    ) -> RuntimePlatformAdmission {
        if kind == AdapterKind::CursorAgent {
            return RuntimePlatformAdmission::not_qualified(
                kind,
                platform,
                RuntimePlatformAdmissionReasonCode::QualificationEvidenceMissing,
            );
        }
        if kind == AdapterKind::GrokBuild {
            if platform == HostPlatformKey::MacosArm64 {
                return RuntimePlatformAdmission::qualified(
                    kind,
                    platform,
                    GROK_BUILD_MACOS_ARM64_EVIDENCE_REVISION,
                );
            }
            return RuntimePlatformAdmission::not_qualified(
                kind,
                platform,
                RuntimePlatformAdmissionReasonCode::QualificationEvidenceMissing,
            );
        }
        if platform == HostPlatformKey::WindowsX64 {
            return RuntimePlatformAdmission::qualified(
                kind,
                platform,
                WINDOWS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION,
            );
        }
        if kind == AdapterKind::KimiCodeCli {
            if platform == HostPlatformKey::MacosArm64 {
                return RuntimePlatformAdmission::qualified(
                    kind,
                    platform,
                    MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION,
                );
            }
            return RuntimePlatformAdmission::not_qualified(
                kind,
                platform,
                RuntimePlatformAdmissionReasonCode::QualificationEvidenceMissing,
            );
        }
        match platform {
            HostPlatformKey::MacosArm64 | HostPlatformKey::MacosX64 => {
                RuntimePlatformAdmission::qualified(
                    kind,
                    platform,
                    MACOS_RUNTIME_COMPATIBILITY_EVIDENCE_REVISION,
                )
            }
            HostPlatformKey::WindowsX64 => RuntimePlatformAdmission::not_qualified(
                kind,
                platform,
                RuntimePlatformAdmissionReasonCode::QualificationEvidenceMissing,
            ),
        }
    }

    pub fn platform_admission_matrix(&self) -> Vec<RuntimePlatformAdmission> {
        AdapterKind::ALL
            .into_iter()
            .flat_map(|kind| {
                HostPlatformKey::ALL
                    .into_iter()
                    .map(move |platform| self.platform_admission(kind, platform))
            })
            .collect()
    }

    pub fn current_platform_admission(
        &self,
        kind: AdapterKind,
    ) -> Option<RuntimePlatformAdmission> {
        HostPlatformKey::current().map(|platform| self.platform_admission(kind, platform))
    }

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
            AdapterKind::KiroCli => json!({
                "trust_all_tools": "on",
            }),
            AdapterKind::QoderCli => json!({
                "permission_mode": "bypass_permissions",
            }),
            AdapterKind::CodebuddyCli => json!({
                "permission_mode": "bypassPermissions",
            }),
            AdapterKind::QwenCode => json!({
                "approval_mode": "yolo",
            }),
            AdapterKind::TraeCnCli => json!({
                "permission_mode": "bypass_permissions",
            }),
            AdapterKind::CursorAgent => json!({
                "execution_mode": "agent",
                "approval_policy": "force",
            }),
            AdapterKind::KimiCodeCli => json!({
                "permission_mode": "yolo",
            }),
            AdapterKind::GrokBuild => json!({
                "permission_mode": "bypassPermissions",
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
            | AdapterKind::QwenCode
            | AdapterKind::TraeCnCli
            | AdapterKind::CursorAgent
            | AdapterKind::KimiCodeCli
            | AdapterKind::GrokBuild => resolve_acp_runtime(kind, input),
        }
    }

    pub fn skill_discovery(&self, kind: AdapterKind) -> SkillDiscoveryCapability {
        match kind {
            AdapterKind::CodexCli => self.codex_cli.skill_discovery(),
            AdapterKind::OpencodeCli => self.opencode_cli.skill_discovery(),
            AdapterKind::CopilotCli => self.copilot_cli.skill_discovery(),
            AdapterKind::ClaudeCodeCli => self.claude_code_cli.skill_discovery(),
            AdapterKind::AntigravityApp => self.antigravity_app.skill_discovery(),
            AdapterKind::KiroCli => native_skill_discovery(
                [SkillDeliveryGroupKey::Kiro],
                SkillDiscoveryVerification::Verified,
            ),
            AdapterKind::QoderCli => native_skill_discovery(
                [SkillDeliveryGroupKey::Qoder],
                SkillDiscoveryVerification::Verified,
            ),
            AdapterKind::CodebuddyCli => native_skill_discovery(
                [SkillDeliveryGroupKey::Codebuddy],
                SkillDiscoveryVerification::Verified,
            ),
            AdapterKind::QwenCode => native_skill_discovery(
                [SkillDeliveryGroupKey::Qwen],
                SkillDiscoveryVerification::Verified,
            ),
            AdapterKind::TraeCnCli => native_skill_discovery(
                [SkillDeliveryGroupKey::Trae],
                SkillDiscoveryVerification::Verified,
            ),
            AdapterKind::CursorAgent => native_skill_discovery(
                [SkillDeliveryGroupKey::Cursor],
                SkillDiscoveryVerification::DocumentationOnly,
            ),
            AdapterKind::KimiCodeCli => native_skill_discovery(
                [SkillDeliveryGroupKey::Kimi],
                SkillDiscoveryVerification::Verified,
            ),
            AdapterKind::GrokBuild => native_skill_discovery(
                [SkillDeliveryGroupKey::Grok],
                SkillDiscoveryVerification::Verified,
            ),
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
            | AdapterKind::QwenCode
            | AdapterKind::TraeCnCli
            | AdapterKind::KimiCodeCli => {
                additive_native_mcp_projection(McpSameNamePolicy::RovaiWins)
            }
            AdapterKind::GrokBuild => {
                additive_native_mcp_projection(McpSameNamePolicy::NativeWinsSkip)
            }
            AdapterKind::CursorAgent => unsupported_external_mcp_projection(),
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
            AdapterKind::TraeCnCli => {
                let permission_options = observation
                    .session_result
                    .as_ref()
                    .filter(|_| observation.probe_status == "ready")
                    .map(trae_permission_options)
                    .transpose()?
                    .unwrap_or_default();
                acp_capability_snapshot(observation, permission_options)
            }
            AdapterKind::KiroCli => acp_capability_snapshot(observation, kiro_permission_options()),
            AdapterKind::CursorAgent => {
                acp_capability_snapshot(observation, cursor_permission_options())
            }
            AdapterKind::KimiCodeCli => {
                acp_capability_snapshot(observation, kimi_permission_options())
            }
            AdapterKind::GrokBuild => {
                acp_capability_snapshot(observation, grok_permission_options())
            }
            kind => anyhow::bail!("{} does not use the ACP snapshot mapper", kind.as_str()),
        }
    }

    pub fn light_ready_snapshot(
        &self,
        kind: AdapterKind,
        reported_version: Option<String>,
        executable_fingerprint: String,
        observed_at: String,
    ) -> Result<AdapterCapabilitySnapshot> {
        let permission_options = match kind {
            AdapterKind::CodexCli => codex_permission_options(),
            AdapterKind::OpencodeCli => opencode_permission_options(),
            AdapterKind::CopilotCli => copilot_permission_options(),
            AdapterKind::ClaudeCodeCli => claude_code_permission_options(),
            AdapterKind::KiroCli => kiro_permission_options(),
            AdapterKind::QoderCli => qoder_permission_options(),
            AdapterKind::CodebuddyCli => codebuddy_permission_options(),
            AdapterKind::QwenCode => qwen_permission_options(),
            AdapterKind::AntigravityApp => antigravity_permission_options(),
            AdapterKind::TraeCnCli => trae_static_permission_options(),
            AdapterKind::CursorAgent => cursor_permission_options(),
            AdapterKind::KimiCodeCli => kimi_permission_options(),
            AdapterKind::GrokBuild => grok_permission_options(),
        };
        let permission_schema_digest = adapter_permission_schema_digest(kind, &permission_options)?;
        Ok(AdapterCapabilitySnapshot {
            reported_version,
            executable_fingerprint: Some(executable_fingerprint),
            authentication_status: "unknown".to_string(),
            probe_status: "light_ready".to_string(),
            permission_schema_version: 1,
            permission_schema_digest,
            capabilities: Vec::new(),
            protocols: Vec::new(),
            models: Vec::new(),
            permission_options,
            observed_at: Some(observed_at.clone()),
            last_attempted_at: observed_at,
            last_successful_probe_at: None,
            stale_at: None,
            last_error: None,
            native_session_compatibility_key: None,
        })
    }

    pub fn light_failed_snapshot(
        &self,
        kind: AdapterKind,
        reported_version: Option<String>,
        executable_fingerprint: String,
        observed_at: String,
        diagnostic_code: String,
    ) -> Result<AdapterCapabilitySnapshot> {
        let mut snapshot =
            self.light_ready_snapshot(kind, reported_version, executable_fingerprint, observed_at)?;
        snapshot.probe_status = "light_failed".to_string();
        snapshot.last_error = Some(diagnostic_code);
        Ok(snapshot)
    }

    pub fn trae_live_session_capability_snapshot(
        &self,
        reported_version: Option<String>,
        executable_fingerprint: String,
        initialize_result: Value,
        session_result: Value,
        observed_at: String,
    ) -> Result<AdapterCapabilitySnapshot> {
        let mut capabilities = trae_machine_ready_capabilities(
            reported_version.as_deref(),
            Some(&executable_fingerprint),
            &initialize_result,
            &session_result,
        );
        let missing = trae_machine_ready_requirements()
            .into_iter()
            .filter(|required| !capabilities.contains(required))
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            anyhow::bail!(
                "TRAE machine Ready evidence is incomplete: {}",
                missing.join(", ")
            );
        }
        if initialize_result
            .pointer("/agentCapabilities/loadSession")
            .and_then(Value::as_bool)
            == Some(true)
        {
            capabilities.push("session.load".to_string());
        }
        if initialize_result
            .pointer("/agentCapabilities/sessionCapabilities/resume")
            .is_some_and(Value::is_object)
        {
            capabilities.push("session.resume".to_string());
        }
        self.acp_capability_snapshot(AcpProbeObservation {
            adapter_kind: AdapterKind::TraeCnCli,
            reported_version,
            executable_fingerprint: Some(executable_fingerprint),
            authentication_status: "authenticated".to_string(),
            probe_status: "ready".to_string(),
            capabilities,
            initialize_result: Some(initialize_result),
            session_result: Some(session_result),
            attempted_at: observed_at,
            last_error: None,
        })
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
            BUILTIN_TOOL_RUNTIME_CAPABILITY,
        ] {
            if ready && !capabilities.iter().any(|value| value == capability) {
                capabilities.push(capability.to_string());
            }
        }
        if ready {
            append_additive_mcp_axes(&mut capabilities, McpSameNamePolicy::NativeWinsSkip);
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
        native_skill_discovery(
            [SkillDeliveryGroupKey::Codex],
            SkillDiscoveryVerification::Verified,
        )
    }

    fn mcp_projection(&self) -> McpProjectionCapability {
        additive_native_mcp_projection(McpSameNamePolicy::NativeWinsSkip)
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
            "contextContract": native_binding_context_contract(),
            "codexSessionGuidanceRevision": CODEX_SESSION_GUIDANCE_REVISION,
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
                BUILTIN_TOOL_RUNTIME_CAPABILITY,
            ] {
                if !capabilities.iter().any(|value| value == capability) {
                    capabilities.push(capability.to_string());
                }
            }
            append_additive_mcp_axes(&mut capabilities, McpSameNamePolicy::RovaiWins);
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
            if observation.builtin_cli_ready {
                capabilities.push(BUILTIN_TOOL_RUNTIME_CAPABILITY.to_string());
            } else {
                capabilities.push("builtin_cli.transport.unavailable".to_string());
            }
            capabilities.push("mcp.external_projection.unsupported".to_string());
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
                if observation.builtin_cli_ready {
                    "antigravity-app:cli-v1:builtin-cli-v1".to_string()
                } else {
                    "antigravity-app:cli-v1:no-builtin-cli".to_string()
                }
            }),
        })
    }
}

pub fn trae_machine_ready_requirements() -> Vec<String> {
    [
        "runtime.version",
        "executable.fingerprint",
        "acp.initialize",
        "session.new",
        "model.dynamic_catalog",
        "permission.mode_catalog",
        "session.config_shape",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

pub fn trae_machine_ready_capabilities(
    reported_version: Option<&str>,
    executable_fingerprint: Option<&str>,
    initialize_result: &Value,
    session_result: &Value,
) -> Vec<String> {
    let mut capabilities = Vec::new();
    if reported_version.is_some_and(|value| !value.trim().is_empty()) {
        capabilities.push("runtime.version".to_string());
    }
    if executable_fingerprint.is_some_and(|value| !value.trim().is_empty()) {
        capabilities.push("executable.fingerprint".to_string());
    }
    if initialize_result
        .get("protocolVersion")
        .and_then(Value::as_u64)
        == Some(1)
    {
        capabilities.push("acp.initialize".to_string());
    }
    if session_result
        .get("sessionId")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
    {
        capabilities.push("session.new".to_string());
    }

    let model_catalog = acp_model_catalog_from_session(session_result).ok();
    if model_catalog
        .as_ref()
        .is_some_and(|models| !models.is_empty())
    {
        capabilities.push("model.dynamic_catalog".to_string());
    }
    let permission_catalog = trae_permission_options(session_result).ok();
    if permission_catalog
        .as_ref()
        .is_some_and(|options| !options.is_empty())
    {
        capabilities.push("permission.mode_catalog".to_string());
    }

    let model_config = session_result
        .get("configOptions")
        .and_then(Value::as_array)
        .and_then(|options| {
            options
                .iter()
                .find(|option| option.get("id").and_then(Value::as_str) == Some("model"))
        });
    let current_model = model_config
        .and_then(|option| option.get("currentValue"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty());
    let model_config_is_coherent = current_model.is_some_and(|current_model| {
        model_config
            .and_then(|option| option.get("options"))
            .and_then(Value::as_array)
            .is_some_and(|options| {
                options.iter().any(|option| {
                    option
                        .get("value")
                        .or_else(|| option.get("modelId"))
                        .or_else(|| option.get("id"))
                        .and_then(Value::as_str)
                        == Some(current_model)
                })
            })
    });
    let current_mode = session_result
        .pointer("/modes/currentModeId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty());
    let mode_config_is_coherent = current_mode.is_some_and(|current_mode| {
        session_result
            .pointer("/modes/availableModes")
            .and_then(Value::as_array)
            .is_some_and(|modes| {
                modes
                    .iter()
                    .any(|mode| mode.get("id").and_then(Value::as_str) == Some(current_mode))
            })
    });
    if model_config_is_coherent && mode_config_is_coherent {
        capabilities.push("session.config_shape".to_string());
    }
    capabilities
}

pub fn validate_machine_ready_snapshot(
    adapter_kind: AdapterKind,
    snapshot: &AdapterCapabilitySnapshot,
) -> Result<()> {
    if adapter_kind == AdapterKind::CursorAgent && snapshot.probe_status == "ready" {
        let required = ["acp.initialize", "cursor.authenticate", "session.new"];
        let complete = snapshot.authentication_status == "authenticated"
            && snapshot
                .reported_version
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
            && snapshot
                .executable_fingerprint
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
            && required.into_iter().all(|capability| {
                snapshot
                    .capabilities
                    .iter()
                    .any(|value| value == capability)
            })
            && !snapshot.models.is_empty()
            && !snapshot.permission_options.is_empty();
        if !complete {
            anyhow::bail!(
                "Cursor Agent ready snapshot does not satisfy the machine Ready contract"
            );
        }
        return Ok(());
    }
    if adapter_kind != AdapterKind::TraeCnCli || snapshot.probe_status != "ready" {
        return Ok(());
    }
    validate_trae_machine_ready_evidence(
        snapshot.reported_version.as_deref(),
        snapshot.executable_fingerprint.as_deref(),
        &snapshot.capabilities,
    )?;
    if snapshot.authentication_status != "authenticated"
        || snapshot.models.is_empty()
        || snapshot.permission_options.is_empty()
    {
        anyhow::bail!("TRAE ready snapshot does not satisfy the machine Ready contract");
    }
    Ok(())
}

pub fn validate_trae_machine_ready_evidence(
    reported_version: Option<&str>,
    executable_fingerprint: Option<&str>,
    capabilities: &[String],
) -> Result<()> {
    let missing = trae_machine_ready_requirements()
        .into_iter()
        .filter(|required| !capabilities.contains(required))
        .collect::<Vec<_>>();
    if !missing.is_empty()
        || reported_version.is_none_or(|value| value.trim().is_empty())
        || executable_fingerprint.is_none_or(|value| value.trim().is_empty())
    {
        anyhow::bail!(
            "TRAE machine Ready evidence is incomplete{}",
            if missing.is_empty() {
                String::new()
            } else {
                format!(": {}", missing.join(", "))
            }
        );
    }
    Ok(())
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
        match acp_model_catalog_from_session(session) {
            Ok(models) => models,
            Err(_)
                if matches!(
                    adapter_kind,
                    AdapterKind::CopilotCli
                        | AdapterKind::QoderCli
                        | AdapterKind::CodebuddyCli
                        | AdapterKind::QwenCode
                        | AdapterKind::CursorAgent
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
        let standard_capabilities: &[&str] = if adapter_kind == AdapterKind::CursorAgent {
            &[
                "acp.initialize",
                "session.new",
                "context.charter.first_payload",
            ]
        } else if adapter_kind == AdapterKind::GrokBuild {
            &[
                "acp.initialize",
                "session.new",
                "session.prompt",
                "session.cancel",
                "session.update",
                "structured_permission_request",
                "context.charter.native_append",
            ]
        } else {
            &[
                "acp.initialize",
                "session.new",
                "session.prompt",
                "session.cancel",
                "session.update",
                "structured_permission_request",
                "context.charter.first_payload",
            ]
        };
        for capability in standard_capabilities {
            if !capabilities.iter().any(|value| value == capability) {
                capabilities.push((*capability).to_string());
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
        }
        let supports_resume = observation
            .initialize_result
            .as_ref()
            .and_then(|value| value.pointer("/agentCapabilities/sessionCapabilities/resume"))
            .is_some_and(Value::is_object);
        if supports_resume {
            capabilities.push("session.resume".to_string());
        }
        if adapter_kind != AdapterKind::CursorAgent {
            capabilities.push(BUILTIN_TOOL_RUNTIME_CAPABILITY.to_string());
        }
        let mcp_projection = AgentRuntimeAdapterRegistry::default().mcp_projection(adapter_kind);
        match mcp_projection.external_mcp_projection {
            ExternalMcpProjection::AdditivePerRun => append_additive_mcp_axes(
                &mut capabilities,
                mcp_projection
                    .same_name_policy
                    .context("additive MCP projection has no same-name policy")?,
            ),
            ExternalMcpProjection::Unsupported => {
                capabilities.push("mcp.external_projection.unsupported".to_string());
            }
        }
    }
    capabilities.sort();
    capabilities.dedup();
    let permission_options = if ready {
        permission_options
    } else {
        Vec::new()
    };
    let permission_schema_digest =
        adapter_permission_schema_digest(adapter_kind, &permission_options)?;
    let native_session_compatibility_key = if ready {
        Some(
            if matches!(
                adapter_kind,
                AdapterKind::TraeCnCli | AdapterKind::CursorAgent
            ) {
                let fingerprint = observation
                    .executable_fingerprint
                    .as_deref()
                    .context("ready TRAE snapshot has no executable fingerprint")?;
                format!("{}:acp-v1:{fingerprint}", adapter_kind.as_str())
            } else {
                format!("{}:acp-v1", adapter_kind.as_str())
            },
        )
    } else {
        None
    };
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
        native_session_compatibility_key,
    })
}

fn adapter_permission_schema_digest(
    adapter_kind: AdapterKind,
    permission_options: &[PermissionOptionDescriptor],
) -> Result<String> {
    // TRAE Session labels and advertised modes are dynamic evidence. Configuration drift is
    // fenced by the Adapter-owned schema that light discovery can reproduce across restarts.
    let schema = if adapter_kind == AdapterKind::TraeCnCli {
        serde_json::to_value(trae_static_permission_options())?
    } else {
        serde_json::to_value(permission_options)?
    };
    canonical_json_digest(&schema)
}

fn append_additive_mcp_axes(capabilities: &mut Vec<String>, same_name_policy: McpSameNamePolicy) {
    capabilities.push("mcp.external_projection.additive_per_run".to_string());
    capabilities.push(format!(
        "mcp.same_name_policy.{}",
        match same_name_policy {
            McpSameNamePolicy::NativeWinsSkip => "native_wins_skip",
            McpSameNamePolicy::RovaiWins => "rovai_wins",
        }
    ));
}

pub fn acp_runtime_model_id_from_session(session_result: &Value) -> Option<String> {
    session_result
        .pointer("/models/currentModelId")
        .and_then(Value::as_str)
        .or_else(|| {
            session_result
                .get("configOptions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .find(|option| option.get("id").and_then(Value::as_str) == Some("model"))
                .and_then(|option| option.get("currentValue"))
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty())
        .map(str::to_string)
}

pub fn acp_model_catalog_from_session(session_result: &Value) -> Result<Vec<ModelDescriptor>> {
    let config_options = session_result
        .get("configOptions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let model_config = config_options
        .iter()
        .find(|option| option.get("id").and_then(Value::as_str) == Some("model"));
    let current_model = acp_runtime_model_id_from_session(session_result);
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
            is_default: current_model.as_deref() == Some(id),
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

fn kiro_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![PermissionOptionDescriptor {
        key: "trust_all_tools".to_string(),
        label: "trust-all-tools".to_string(),
        description: "Kiro CLI's native ACP trust-all mode for this Agent Host. When enabled, Kiro auto-approves all tool permission requests.".to_string(),
        value_type: "enum".to_string(),
        choices: vec![choice("off", "off"), choice("on", "on (auto-approve all tools)")],
        recommended_value: json!("off"),
        scope: RuntimeOptionScope::Host,
        risk: "dangerous".to_string(),
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

fn cursor_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![
        PermissionOptionDescriptor {
            key: "execution_mode".to_string(),
            label: "mode".to_string(),
            description: "Cursor Agent's ACP execution mode for this Host.".to_string(),
            value_type: "enum".to_string(),
            choices: ["agent", "plan", "ask"]
                .into_iter()
                .map(|value| choice(value, value))
                .collect(),
            recommended_value: json!("agent"),
            scope: RuntimeOptionScope::Host,
            risk: "elevated".to_string(),
            supported: true,
            required: true,
            unsupported_reason: None,
        },
        PermissionOptionDescriptor {
            key: "approval_policy".to_string(),
            label: "approval-policy".to_string(),
            description: "Cursor Agent's native approval policy for this ACP Host.".to_string(),
            value_type: "enum".to_string(),
            choices: ["default", "auto_review", "force"]
                .into_iter()
                .map(|value| choice(value, value))
                .collect(),
            recommended_value: json!("default"),
            scope: RuntimeOptionScope::Host,
            risk: "dangerous".to_string(),
            supported: true,
            required: true,
            unsupported_reason: None,
        },
    ]
}

fn kimi_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![PermissionOptionDescriptor {
        key: "permission_mode".to_string(),
        label: "mode".to_string(),
        description: "Kimi Code's native ACP Session mode. Plan is read-only; auto and yolo progressively reduce interactive approval prompts.".to_string(),
        value_type: "enum".to_string(),
        choices: ["default", "plan", "auto", "yolo"]
            .into_iter()
            .map(|value| choice(value, value))
            .collect(),
        recommended_value: json!("default"),
        scope: RuntimeOptionScope::Session,
        risk: "dangerous".to_string(),
        supported: true,
        required: true,
        unsupported_reason: None,
    }]
}

fn grok_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![PermissionOptionDescriptor {
        key: "permission_mode".to_string(),
        label: "permission-mode".to_string(),
        description: "Grok Build's native host permission mode. Plan is read-only; bypassPermissions disables interactive permission prompts.".to_string(),
        value_type: "enum".to_string(),
        choices: [
            "default",
            "acceptEdits",
            "auto",
            "dontAsk",
            "bypassPermissions",
            "plan",
        ]
        .into_iter()
        .map(|value| choice(value, value))
        .collect(),
        recommended_value: json!("default"),
        scope: RuntimeOptionScope::Host,
        risk: "dangerous".to_string(),
        supported: true,
        required: true,
        unsupported_reason: None,
    }]
}

fn trae_permission_options(session_result: &Value) -> Result<Vec<PermissionOptionDescriptor>> {
    let modes = session_result
        .pointer("/modes/availableModes")
        .and_then(Value::as_array)
        .context("TRAE ACP Session did not report available permission modes")?;
    let mut choices = modes
        .iter()
        .filter_map(|mode| {
            mode.get("id").and_then(Value::as_str).map(|id| {
                choice(
                    id,
                    mode.get("name")
                        .and_then(Value::as_str)
                        .filter(|name| !name.trim().is_empty())
                        .unwrap_or(id),
                )
            })
        })
        .collect::<Vec<_>>();
    choices.sort_by(|left, right| left.value.cmp(&right.value));
    choices.dedup_by(|left, right| left.value == right.value);
    if !choices.iter().any(|entry| entry.value == "default") {
        anyhow::bail!("TRAE ACP Session did not advertise the safe default permission mode");
    }
    Ok(vec![PermissionOptionDescriptor {
        key: "permission_mode".to_string(),
        label: "permission-mode".to_string(),
        description: "TRAE CLI's native permission mode reported by the current ACP Session. Rovai does not enable --yolo by default.".to_string(),
        value_type: "enum".to_string(),
        choices,
        recommended_value: json!("default"),
        scope: RuntimeOptionScope::Host,
        risk: "elevated".to_string(),
        supported: true,
        required: true,
        unsupported_reason: None,
    }])
}

pub(crate) fn trae_static_permission_options() -> Vec<PermissionOptionDescriptor> {
    vec![PermissionOptionDescriptor {
        key: "permission_mode".to_string(),
        label: "permission-mode".to_string(),
        description:
            "TRAE CLI 的轻检启动权限模式；完整模式目录会在显式检查或首次真实任务建立 ACP Session 后刷新。"
                .to_string(),
        value_type: "enum".to_string(),
        choices: vec![
            choice("default", "default"),
            choice(
                "bypass_permissions",
                "bypass_permissions (accept all tools)",
            ),
        ],
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
        description: "Claude Code's native permission mode for writable non-interactive Runs. A read-only Workspace is narrowed to dontAsk and denies Runtime-native write/Shell tools; Rovai built-in operations remain available through the binding-authenticated bundled CLI.".to_string(),
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
        "contextContract": native_binding_context_contract(),
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
        native_skill_discovery(
            [
                SkillDeliveryGroupKey::Opencode,
                SkillDeliveryGroupKey::ClaudeCompatible,
            ],
            SkillDiscoveryVerification::Verified,
        )
    }

    fn mcp_projection(&self) -> McpProjectionCapability {
        additive_native_mcp_projection(McpSameNamePolicy::RovaiWins)
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
        native_skill_discovery(
            [
                SkillDeliveryGroupKey::Copilot,
                SkillDeliveryGroupKey::ClaudeCompatible,
            ],
            SkillDiscoveryVerification::Verified,
        )
    }

    fn mcp_projection(&self) -> McpProjectionCapability {
        additive_native_mcp_projection(McpSameNamePolicy::RovaiWins)
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
        native_skill_discovery(
            [SkillDeliveryGroupKey::ClaudeCompatible],
            SkillDiscoveryVerification::Verified,
        )
    }

    fn mcp_projection(&self) -> McpProjectionCapability {
        additive_native_mcp_projection(McpSameNamePolicy::RovaiWins)
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
            "contextContract": native_binding_context_contract(),
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
        native_skill_discovery(
            [SkillDeliveryGroupKey::Antigravity],
            SkillDiscoveryVerification::Verified,
        )
    }

    fn mcp_projection(&self) -> McpProjectionCapability {
        unsupported_external_mcp_projection()
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
        let binding_compatibility_digest = antigravity_binding_compatibility_digest(
            input.installation_id,
            &protocol_version,
            BUILTIN_TOOL_CONTRACT_VERSION,
            &builtin_tool_catalog_digest()?,
        )?;
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

fn antigravity_binding_compatibility_digest(
    installation_id: &str,
    protocol_version: &str,
    builtin_tool_contract_version: u32,
    builtin_tool_catalog_digest: &str,
) -> Result<String> {
    canonical_json_digest(&json!({
        "adapterKind": AdapterKind::AntigravityApp,
        "installationId": installation_id,
        "protocolVersion": protocol_version,
        "contextContract": native_binding_context_contract(),
        "builtinToolContractVersion": builtin_tool_contract_version,
        "builtinToolCatalogDigest": builtin_tool_catalog_digest,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_profile::{PermissionOptionDescriptor, ValueChoice};

    #[test]
    fn member_permission_defaults_use_each_runtime_native_maximum() {
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
            (AdapterKind::KiroCli, json!({"trust_all_tools": "on"})),
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
                AdapterKind::TraeCnCli,
                json!({"permission_mode": "bypass_permissions"}),
            ),
            (
                AdapterKind::CursorAgent,
                json!({"execution_mode": "agent", "approval_policy": "force"}),
            ),
            (AdapterKind::KimiCodeCli, json!({"permission_mode": "yolo"})),
            (
                AdapterKind::GrokBuild,
                json!({"permission_mode": "bypassPermissions"}),
            ),
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
    fn same_path_replacement_allows_equivalent_content_and_rejects_changed_content() {
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
                .expect("verify equivalent Runtime replacement"),
            ExecutableIntegrityStatus::Unchanged | ExecutableIntegrityStatus::Reverified(_)
        ));

        std::fs::remove_file(&path).expect("remove equivalent Runtime fixture");
        std::fs::write(&path, b"runtime-v2").expect("write replacement runtime fixture");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .expect("make replacement Runtime fixture executable");
        let replacement =
            observe_executable_file_identity(&path).expect("observe replacement Runtime identity");

        assert_eq!(replacement.byte_size, initial.byte_size);
        assert_eq!(
            verify_executable_integrity(&path, Some(&initial), &expected_fingerprint)
                .expect("detect changed Runtime"),
            ExecutableIntegrityStatus::Changed
        );
        std::fs::remove_file(path).expect("remove Runtime fixture");
    }

    #[cfg(windows)]
    #[test]
    fn windows_identity_combines_opened_volume_and_file_id() {
        let path = std::env::temp_dir().join(format!(
            "rovai-runtime-identity-{}.exe",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, b"runtime-fixture").expect("write Runtime fixture");

        let identity =
            observe_executable_file_identity(&path).expect("observe Windows Runtime identity");
        let file_id = identity
            .file_id
            .expect("Windows identity must be available");
        assert!(file_id.starts_with("windows:"));
        assert_eq!(file_id.split(':').count(), 3);
        assert_eq!(file_id.rsplit(':').next().map(str::len), Some(32));

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
                auth_scope: "local_user",
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
                auth_scope: "local_user",
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
                auth_scope: "local_user",
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
        let current_contract_digest = canonical_json_digest(&json!({
            "adapterKind": AdapterKind::CodexCli,
            "installationId": "codex-local",
            "protocolVersion": "codex-app-server-v2",
            "permissionSchemaVersion": 1,
            "sessionPermissions": {"sandbox_mode": "value"},
            "contextContract": native_binding_context_contract(),
            "codexSessionGuidanceRevision": CODEX_SESSION_GUIDANCE_REVISION,
        }))
        .unwrap();
        let legacy_contract_digest = canonical_json_digest(&json!({
            "adapterKind": AdapterKind::CodexCli,
            "installationId": "codex-local",
            "protocolVersion": "codex-app-server-v2",
            "permissionSchemaVersion": 1,
            "sessionPermissions": {"sandbox_mode": "value"},
            "contextContract": native_binding_context_contract(),
        }))
        .unwrap();
        assert_eq!(
            resolved.binding_compatibility_digest,
            current_contract_digest
        );
        assert_ne!(current_contract_digest, legacy_contract_digest);
        assert!(
            native_binding_context_contract()
                .get("codexSessionGuidanceRevision")
                .is_none(),
            "Codex guidance revision must not enter the shared Adapter context contract"
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
                .contains(&BUILTIN_TOOL_RUNTIME_CAPABILITY.to_string())
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
                    "agentCapabilities": {
                        "loadSession": true,
                        "sessionCapabilities": {"resume": {}}
                    }
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
        assert_eq!(
            acp_runtime_model_id_from_session(&json!({
                "models": {"currentModelId": "native/current"}
            })),
            Some("native/current".to_string())
        );
        assert_eq!(
            acp_runtime_model_id_from_session(&json!({
                "configOptions": [{
                    "id": "model",
                    "currentValue": "opencode/current"
                }]
            })),
            Some("opencode/current".to_string())
        );
        assert_eq!(acp_runtime_model_id_from_session(&json!({})), None);
        assert_eq!(snapshot.permission_options[0].key, "permission");
        assert!(snapshot.capabilities.contains(&"session.load".to_string()));
        assert!(
            snapshot
                .capabilities
                .contains(&"session.resume".to_string())
        );
        assert!(
            snapshot
                .capabilities
                .contains(&BUILTIN_TOOL_RUNTIME_CAPABILITY.to_string())
        );
        assert!(
            snapshot
                .capabilities
                .contains(&"context.charter.first_payload".to_string())
        );
    }

    #[test]
    fn kimi_snapshot_keeps_native_continuation_and_claims_verified_external_mcp() {
        let snapshot = AgentRuntimeAdapterRegistry::default()
            .acp_capability_snapshot(AcpProbeObservation {
                adapter_kind: AdapterKind::KimiCodeCli,
                reported_version: Some("0.32.0".to_string()),
                executable_fingerprint: Some("sha256:kimi".to_string()),
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                capabilities: vec!["session.load".to_string(), "session.resume".to_string()],
                initialize_result: Some(json!({
                    "protocolVersion": 1,
                    "agentCapabilities": {
                        "loadSession": true,
                        "sessionCapabilities": {"resume": {}}
                    }
                })),
                session_result: Some(json!({
                    "sessionId": "kimi-session",
                    "configOptions": [{
                        "id": "model",
                        "name": "Model",
                        "currentValue": "runtime_default",
                        "options": [{"value": "runtime_default", "name": "Runtime Default"}]
                    }]
                })),
                attempted_at: "2026-08-22T00:00:00Z".to_string(),
                last_error: None,
            })
            .expect("Kimi ACP catalog should map");

        assert!(snapshot.capabilities.contains(&"session.load".to_string()));
        assert!(
            snapshot
                .capabilities
                .contains(&"session.resume".to_string())
        );
        assert!(
            snapshot
                .capabilities
                .contains(&"mcp.external_projection.additive_per_run".to_string())
        );
        assert!(
            snapshot
                .capabilities
                .contains(&"mcp.same_name_policy.rovai_wins".to_string())
        );
        assert!(
            snapshot
                .capabilities
                .contains(&BUILTIN_TOOL_RUNTIME_CAPABILITY.to_string())
        );
    }

    #[test]
    fn grok_snapshot_claims_verified_additive_external_mcp_with_native_precedence() {
        let snapshot = AgentRuntimeAdapterRegistry::default()
            .acp_capability_snapshot(AcpProbeObservation {
                adapter_kind: AdapterKind::GrokBuild,
                reported_version: Some("grok 0.2.118".to_string()),
                executable_fingerprint: Some("sha256:grok".to_string()),
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                capabilities: vec!["grok.authenticate".to_string()],
                initialize_result: Some(json!({
                    "protocolVersion": 1,
                    "agentCapabilities": {"loadSession": true}
                })),
                session_result: Some(json!({
                    "sessionId": "grok-test",
                    "configOptions": [{
                        "id": "model",
                        "name": "Model",
                        "currentValue": "MiniMax-M3",
                        "options": [{"value": "MiniMax-M3", "name": "MiniMax-M3"}]
                    }]
                })),
                attempted_at: "2026-08-24T00:00:00Z".to_string(),
                last_error: None,
            })
            .expect("Grok ACP catalog should map");

        assert!(
            snapshot
                .capabilities
                .contains(&"mcp.external_projection.additive_per_run".to_string())
        );
        assert!(
            snapshot
                .capabilities
                .contains(&"mcp.same_name_policy.native_wins_skip".to_string())
        );
        assert!(
            !snapshot
                .capabilities
                .contains(&"mcp.same_name_policy.rovai_wins".to_string())
        );
        assert!(
            snapshot
                .capabilities
                .contains(&"context.charter.native_append".to_string())
        );
        assert!(
            !snapshot
                .capabilities
                .contains(&"context.charter.first_payload".to_string())
        );
    }

    #[test]
    fn trae_catalog_comes_from_the_negotiated_acp_session() {
        let snapshot = AgentRuntimeAdapterRegistry::default()
            .acp_capability_snapshot(AcpProbeObservation {
                adapter_kind: AdapterKind::TraeCnCli,
                reported_version: Some("trae-cli version 0.120.52".to_string()),
                executable_fingerprint: Some("sha256:trae".to_string()),
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                capabilities: vec![
                    "tool_call.stable_id".to_string(),
                    "context.charter.native_append".to_string(),
                ],
                initialize_result: Some(json!({
                    "protocolVersion": 1,
                    "agentCapabilities": {"loadSession": true}
                })),
                session_result: Some(json!({
                    "sessionId": "trae-test",
                    "configOptions": [{
                        "id": "model",
                        "name": "Model",
                        "currentValue": "GLM-5.2",
                        "options": [
                            {"value": "GLM-5.2", "name": "GLM-5.2"},
                            {"value": "DeepSeek-V3.2", "name": "DeepSeek-V3.2"}
                        ]
                    }],
                    "modes": {
                        "currentModeId": "default",
                        "availableModes": [
                            {"id": "default", "name": "Default"},
                            {"id": "plan", "name": "Plan"},
                            {"id": "bypass_permissions", "name": "Bypass permissions"}
                        ]
                    }
                })),
                attempted_at: "2026-08-15T00:00:00Z".to_string(),
                last_error: None,
            })
            .expect("TRAE ACP catalog should map");

        assert_eq!(snapshot.models.len(), 2);
        assert_eq!(snapshot.models[0].id, "GLM-5.2");
        assert!(snapshot.models[0].is_default);
        assert_eq!(snapshot.permission_options[0].key, "permission_mode");
        assert_eq!(
            snapshot.permission_options[0].recommended_value,
            json!("default")
        );
        assert_eq!(
            snapshot.native_session_compatibility_key.as_deref(),
            Some("trae-cn-cli:acp-v1:sha256:trae")
        );
        assert!(
            snapshot.permission_options[0]
                .choices
                .iter()
                .any(|choice| choice.value == "plan")
        );
        assert!(snapshot.capabilities.contains(&"session.load".to_string()));
        assert!(
            snapshot
                .capabilities
                .contains(&"context.charter.native_append".to_string())
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
                .contains(&BUILTIN_TOOL_RUNTIME_CAPABILITY.to_string())
        );
        assert!(
            snapshot
                .capabilities
                .contains(&"context.charter.first_payload".to_string())
        );

        let runtime_default = AgentRuntimeAdapterRegistry::default()
            .acp_capability_snapshot(AcpProbeObservation {
                adapter_kind: AdapterKind::CopilotCli,
                reported_version: Some("1.0.80".to_string()),
                executable_fingerprint: Some("sha256:copilot-default".to_string()),
                authentication_status: "authenticated".to_string(),
                probe_status: "ready".to_string(),
                capabilities: Vec::new(),
                initialize_result: Some(json!({
                    "protocolVersion": 1,
                    "agentCapabilities": {"loadSession": true}
                })),
                session_result: Some(json!({"sessionId": "copilot-runtime-default"})),
                attempted_at: "2026-08-21T00:00:00Z".to_string(),
                last_error: None,
            })
            .expect("Copilot ACP may delegate model choice to its runtime default");
        assert_eq!(runtime_default.models.len(), 1);
        assert_eq!(
            runtime_default.models[0].id,
            "copilot-cli://runtime-default"
        );
        assert!(runtime_default.models[0].is_default);
    }

    #[test]
    fn kiro_models_keep_only_the_verified_native_permission_option() {
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
        assert_eq!(snapshot.permission_options, kiro_permission_options());
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
                        auth_scope: "local_user",
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
    fn kiro_trust_all_replaces_the_host_but_not_the_conversation_binding() {
        let registry = AgentRuntimeAdapterRegistry::default();
        let descriptors = kiro_permission_options();
        let protocols = vec!["acp-v1".to_string()];
        let off = AdapterPermissionConfig {
            adapter_kind: AdapterKind::KiroCli,
            schema_version: 1,
            values: json!({"trust_all_tools": "off"}),
        };
        let on = AdapterPermissionConfig {
            adapter_kind: AdapterKind::KiroCli,
            schema_version: 1,
            values: json!({"trust_all_tools": "on"}),
        };
        let resolve = |permissions: &AdapterPermissionConfig| {
            registry
                .resolve_runtime(
                    AdapterKind::KiroCli,
                    AdapterRuntimeResolutionInput {
                        installation_id: "kiro-local",
                        executable_path: "/opt/bin/kiro-cli",
                        auth_scope: "local_user",
                        executable_fingerprint: "sha256:test",
                        protocols: &protocols,
                        native_session_compatibility_key: Some("kiro-cli:acp-v1"),
                        permissions,
                        permission_descriptors: &descriptors,
                    },
                )
                .expect("Kiro ACP runtime should resolve")
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
                builtin_cli_ready: true,
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
                .contains(&BUILTIN_TOOL_RUNTIME_CAPABILITY.to_string())
        );
        assert_eq!(
            snapshot.native_session_compatibility_key.as_deref(),
            Some("antigravity-app:cli-v1:builtin-cli-v1")
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
                        auth_scope: "local_user",
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
    fn antigravity_catalog_upgrade_replaces_the_native_conversation_binding() {
        let current_catalog = builtin_tool_catalog_digest().unwrap();
        let current = antigravity_binding_compatibility_digest(
            "agy-local",
            "antigravity-app-cli-v1",
            BUILTIN_TOOL_CONTRACT_VERSION,
            &current_catalog,
        )
        .unwrap();
        let legacy = antigravity_binding_compatibility_digest(
            "agy-local",
            "antigravity-app-cli-v1",
            7,
            &format!("sha256:{}", "0".repeat(64)),
        )
        .unwrap();
        assert_ne!(current, legacy);
    }

    #[test]
    fn claude_code_uses_installed_aliases_and_builtin_cli_support() {
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
                .contains(&BUILTIN_TOOL_RUNTIME_CAPABILITY.to_string())
        );
        assert_eq!(
            snapshot.permission_options[0].recommended_value,
            json!("acceptEdits")
        );
    }

    #[test]
    fn persisted_trae_ready_rejects_the_legacy_weak_contract() {
        let registry = AgentRuntimeAdapterRegistry::default();
        let mut snapshot = registry
            .trae_live_session_capability_snapshot(
                Some("traecli 0.120.52".to_string()),
                "sha256:trae-ready".to_string(),
                json!({"protocolVersion": 1, "agentCapabilities": {}}),
                json!({
                    "sessionId": "session-ready",
                    "configOptions": [{
                        "id": "model",
                        "currentValue": "GLM-5.2",
                        "options": [{"value": "GLM-5.2", "name": "GLM-5.2"}]
                    }],
                    "modes": {
                        "currentModeId": "default",
                        "availableModes": [{"id": "default", "name": "Default"}]
                    }
                }),
                "2026-08-20T00:00:00Z".to_string(),
            )
            .expect("complete TRAE Machine Ready evidence should build a snapshot");
        validate_machine_ready_snapshot(AdapterKind::TraeCnCli, &snapshot)
            .expect("complete TRAE Machine Ready snapshot should validate");

        snapshot
            .capabilities
            .retain(|capability| capability != "session.config_shape");
        assert!(
            validate_machine_ready_snapshot(AdapterKind::TraeCnCli, &snapshot).is_err(),
            "legacy weak TRAE ready must not suppress DispatchPreflight"
        );
    }

    #[test]
    fn adapters_declare_their_skill_delivery_groups() {
        let registry = AgentRuntimeAdapterRegistry::default();
        let cases: &[(
            AdapterKind,
            &[SkillDeliveryGroupKey],
            SkillDiscoveryVerification,
        )] = &[
            (
                AdapterKind::CodexCli,
                &[SkillDeliveryGroupKey::Codex],
                SkillDiscoveryVerification::Verified,
            ),
            (
                AdapterKind::OpencodeCli,
                &[
                    SkillDeliveryGroupKey::Opencode,
                    SkillDeliveryGroupKey::ClaudeCompatible,
                ],
                SkillDiscoveryVerification::Verified,
            ),
            (
                AdapterKind::CopilotCli,
                &[
                    SkillDeliveryGroupKey::Copilot,
                    SkillDeliveryGroupKey::ClaudeCompatible,
                ],
                SkillDiscoveryVerification::Verified,
            ),
            (
                AdapterKind::ClaudeCodeCli,
                &[SkillDeliveryGroupKey::ClaudeCompatible],
                SkillDiscoveryVerification::Verified,
            ),
            (
                AdapterKind::AntigravityApp,
                &[SkillDeliveryGroupKey::Antigravity],
                SkillDiscoveryVerification::Verified,
            ),
            (
                AdapterKind::KiroCli,
                &[SkillDeliveryGroupKey::Kiro],
                SkillDiscoveryVerification::Verified,
            ),
            (
                AdapterKind::QoderCli,
                &[SkillDeliveryGroupKey::Qoder],
                SkillDiscoveryVerification::Verified,
            ),
            (
                AdapterKind::CodebuddyCli,
                &[SkillDeliveryGroupKey::Codebuddy],
                SkillDiscoveryVerification::Verified,
            ),
            (
                AdapterKind::QwenCode,
                &[SkillDeliveryGroupKey::Qwen],
                SkillDiscoveryVerification::Verified,
            ),
            (
                AdapterKind::TraeCnCli,
                &[SkillDeliveryGroupKey::Trae],
                SkillDiscoveryVerification::Verified,
            ),
            (
                AdapterKind::CursorAgent,
                &[SkillDeliveryGroupKey::Cursor],
                SkillDiscoveryVerification::DocumentationOnly,
            ),
            (
                AdapterKind::KimiCodeCli,
                &[SkillDeliveryGroupKey::Kimi],
                SkillDiscoveryVerification::Verified,
            ),
            (
                AdapterKind::GrokBuild,
                &[SkillDeliveryGroupKey::Grok],
                SkillDiscoveryVerification::Verified,
            ),
        ];
        assert_eq!(cases.len(), AdapterKind::ALL.len());
        for (kind, delivery_groups, verification) in cases {
            let discovery = registry.skill_discovery(*kind);
            assert_eq!(
                discovery.delivery_groups,
                *delivery_groups,
                "{} Skill delivery groups changed",
                kind.as_str()
            );
            assert_eq!(
                discovery.verification,
                *verification,
                "{} Skill discovery verification changed",
                kind.as_str()
            );
        }
    }

    #[test]
    fn external_mcp_projection_capability_matches_the_verified_matrix() {
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
            AdapterKind::TraeCnCli,
            AdapterKind::KimiCodeCli,
            AdapterKind::GrokBuild,
        ] {
            let capability = registry.mcp_projection(kind);
            assert!(capability.supports_stdio);
            assert!(capability.supports_streamable_http);
            assert_eq!(
                capability.external_mcp_projection,
                ExternalMcpProjection::AdditivePerRun
            );
            assert_eq!(
                capability.same_name_policy,
                Some(
                    if matches!(kind, AdapterKind::CodexCli | AdapterKind::GrokBuild) {
                        McpSameNamePolicy::NativeWinsSkip
                    } else {
                        McpSameNamePolicy::RovaiWins
                    }
                )
            );
            assert_eq!(
                capability.approval_control,
                McpApprovalControl::RuntimeNative
            );
        }
        for kind in [AdapterKind::AntigravityApp, AdapterKind::CursorAgent] {
            let capability = registry.mcp_projection(kind);
            assert!(!capability.supports_stdio);
            assert!(!capability.supports_streamable_http);
            assert_eq!(
                capability.external_mcp_projection,
                ExternalMcpProjection::Unsupported
            );
            assert_eq!(capability.same_name_policy, None);
            assert_eq!(
                capability.approval_control,
                McpApprovalControl::RuntimeNative
            );
        }
    }
}
