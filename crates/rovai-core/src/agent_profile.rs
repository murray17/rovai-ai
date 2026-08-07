use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    str::FromStr,
};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Row, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    agent_identity::allocate_agent_id,
    agent_runtime_adapter::{
        AdapterRuntimeResolutionInput, AgentRuntimeAdapterRegistry, ExecutableFileIdentity,
        observe_executable_file_identity,
    },
    command::{
        CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    db::Database,
    member_avatar::validate_member_avatar_update,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AdapterKind {
    CodexCli,
    OpencodeCli,
    CopilotCli,
    ClaudeCodeCli,
    KiroCli,
    QoderCli,
    CodebuddyCli,
    QwenCode,
    AntigravityApp,
}

/// The only two ways a Runtime may publish assistant output into the Camp.
///
/// This is deliberately owned by the adapter catalog rather than inferred from
/// stdout or Renderer state.  A Runtime that does not expose a trustworthy
/// final boundary must use `ExplicitSendOnly`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicOutputMode {
    ExplicitSendOnly,
    AssistantFinalVisible,
}

impl PublicOutputMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ExplicitSendOnly => "explicit_send_only",
            Self::AssistantFinalVisible => "assistant_final_visible",
        }
    }
}

impl AdapterKind {
    pub const ALL: [Self; 9] = [
        Self::CodexCli,
        Self::OpencodeCli,
        Self::CopilotCli,
        Self::ClaudeCodeCli,
        Self::AntigravityApp,
        Self::KiroCli,
        Self::QoderCli,
        Self::CodebuddyCli,
        Self::QwenCode,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::CodexCli => "codex-cli",
            Self::OpencodeCli => "opencode-cli",
            Self::CopilotCli => "copilot-cli",
            Self::ClaudeCodeCli => "claude-code-cli",
            Self::KiroCli => "kiro-cli",
            Self::QoderCli => "qoder-cli",
            Self::CodebuddyCli => "codebuddy-cli",
            Self::QwenCode => "qwen-code",
            Self::AntigravityApp => "antigravity-app",
        }
    }

    pub fn command_name(self) -> &'static str {
        match self {
            Self::CodexCli => "codex",
            Self::OpencodeCli => "opencode",
            Self::CopilotCli => "copilot",
            Self::ClaudeCodeCli => "claude",
            Self::KiroCli => "kiro-cli",
            Self::QoderCli => "qodercli",
            Self::CodebuddyCli => "codebuddy",
            Self::QwenCode => "qwen",
            Self::AntigravityApp => "agy",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::CodexCli => "Codex CLI",
            Self::OpencodeCli => "OpenCode",
            Self::CopilotCli => "GitHub Copilot",
            Self::ClaudeCodeCli => "Claude Code",
            Self::KiroCli => "Kiro",
            Self::QoderCli => "Qoder",
            Self::CodebuddyCli => "CodeBuddy",
            Self::QwenCode => "Qwen Code",
            Self::AntigravityApp => "Antigravity",
        }
    }

    pub fn uses_acp(self) -> bool {
        matches!(
            self,
            Self::OpencodeCli
                | Self::CopilotCli
                | Self::KiroCli
                | Self::QoderCli
                | Self::CodebuddyCli
                | Self::QwenCode
        )
    }

    pub fn override_environment_key(self) -> &'static str {
        match self {
            Self::CodexCli => "ROVAI_CODEX_BIN",
            Self::OpencodeCli => "ROVAI_OPENCODE_BIN",
            Self::CopilotCli => "ROVAI_COPILOT_BIN",
            Self::ClaudeCodeCli => "ROVAI_CLAUDE_CODE_BIN",
            Self::KiroCli => "ROVAI_KIRO_BIN",
            Self::QoderCli => "ROVAI_QODER_BIN",
            Self::CodebuddyCli => "ROVAI_CODEBUDDY_BIN",
            Self::QwenCode => "ROVAI_QWEN_BIN",
            Self::AntigravityApp => "ROVAI_ANTIGRAVITY_BIN",
        }
    }

    /// Freeze the public output boundary for each shipped adapter.
    ///
    /// Codex, Claude Code and Antigravity expose a Core-owned terminal event
    /// with the final assistant message.  The ACP-backed adapters currently
    /// remain explicit-send-only until their provider final-boundary evidence
    /// is promoted to the same contract.
    pub const fn public_output_mode(self) -> PublicOutputMode {
        match self {
            Self::CodexCli | Self::ClaudeCodeCli | Self::AntigravityApp => {
                PublicOutputMode::AssistantFinalVisible
            }
            Self::OpencodeCli
            | Self::CopilotCli
            | Self::KiroCli
            | Self::QoderCli
            | Self::CodebuddyCli
            | Self::QwenCode => PublicOutputMode::ExplicitSendOnly,
        }
    }
}

impl FromStr for AdapterKind {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "codex-cli" => Ok(Self::CodexCli),
            "opencode-cli" => Ok(Self::OpencodeCli),
            "copilot-cli" => Ok(Self::CopilotCli),
            "claude-code-cli" => Ok(Self::ClaudeCodeCli),
            "kiro-cli" => Ok(Self::KiroCli),
            "qoder-cli" => Ok(Self::QoderCli),
            "codebuddy-cli" => Ok(Self::CodebuddyCli),
            "qwen-code" => Ok(Self::QwenCode),
            "antigravity-app" => Ok(Self::AntigravityApp),
            _ => anyhow::bail!("unsupported Adapter kind: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallationSource {
    Manual,
    Env,
    InheritedPath,
    LoginShell,
    KnownLocation,
    Custom,
}

impl InstallationSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Env => "env",
            Self::InheritedPath => "inherited_path",
            Self::LoginShell => "login_shell",
            Self::KnownLocation => "known_location",
            Self::Custom => "custom",
        }
    }
}

impl FromStr for InstallationSource {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "manual" => Ok(Self::Manual),
            "env" => Ok(Self::Env),
            "inherited_path" => Ok(Self::InheritedPath),
            "login_shell" => Ok(Self::LoginShell),
            "known_location" => Ok(Self::KnownLocation),
            "custom" => Ok(Self::Custom),
            _ => anyhow::bail!("unsupported installation source: {value}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallationClass {
    ManagedDefault,
    Custom,
}

impl FromStr for InstallationClass {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "managed_default" => Ok(Self::ManagedDefault),
            "custom" => Ok(Self::Custom),
            _ => anyhow::bail!("unsupported installation class: {value}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum ModelSelection {
    RuntimeDefault,
    Explicit {
        #[serde(rename = "modelId")]
        model_id: String,
        #[serde(default)]
        options: Value,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterPermissionConfig {
    pub adapter_kind: AdapterKind,
    pub schema_version: i64,
    pub values: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolvedRuntimeBinding {
    pub adapter_kind: AdapterKind,
    pub installation_id: String,
    pub model: ModelSelection,
    pub permissions: AdapterPermissionConfig,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberRuntimeConfiguration {
    pub adapter_kind: AdapterKind,
    pub model: ModelSelection,
    pub permissions: AdapterPermissionConfig,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedModelSelection {
    pub source: String,
    pub model_id: String,
    pub options: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenAgentRuntimeConfig {
    pub adapter_kind: AdapterKind,
    pub installation_id: String,
    pub installation_generation: i64,
    pub search_environment_generation: i64,
    pub executable_path: String,
    pub auth_scope: String,
    pub reported_version: String,
    pub executable_fingerprint: String,
    pub capabilities: Vec<String>,
    pub protocol_version: String,
    pub model: ResolvedModelSelection,
    pub permissions: AdapterPermissionConfig,
    pub native_session_compatibility_key: Option<String>,
    pub binding_compatibility_digest: String,
    pub host_config_digest: String,
    pub config_digest: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RuntimeConfigurationBlocker {
    pub code: String,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOptionDescriptor {
    pub key: String,
    pub label: String,
    pub value_type: String,
    pub values: Vec<ValueChoice>,
    pub default_value: Option<String>,
    pub scope: RuntimeOptionScope,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueChoice {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeOptionScope {
    Run,
    Session,
    Host,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDescriptor {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
    pub hidden: bool,
    pub deprecated: bool,
    pub options: Vec<ModelOptionDescriptor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOptionDescriptor {
    pub key: String,
    pub label: String,
    pub description: String,
    pub value_type: String,
    pub choices: Vec<ValueChoice>,
    pub recommended_value: Value,
    pub scope: RuntimeOptionScope,
    pub risk: String,
    pub supported: bool,
    pub required: bool,
    pub unsupported_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterCapabilitySnapshot {
    pub reported_version: Option<String>,
    pub executable_fingerprint: Option<String>,
    pub authentication_status: String,
    pub probe_status: String,
    pub permission_schema_version: i64,
    pub permission_schema_digest: String,
    pub capabilities: Vec<String>,
    pub protocols: Vec<String>,
    pub models: Vec<ModelDescriptor>,
    pub permission_options: Vec<PermissionOptionDescriptor>,
    pub observed_at: Option<String>,
    pub last_attempted_at: String,
    pub last_successful_probe_at: Option<String>,
    pub stale_at: Option<String>,
    pub last_error: Option<String>,
    pub native_session_compatibility_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterInstallationView {
    pub id: String,
    pub adapter_kind: AdapterKind,
    pub executable_path: String,
    pub command_name: String,
    pub installation_class: InstallationClass,
    pub source: InstallationSource,
    pub auth_scope: String,
    pub enabled: bool,
    pub generation: i64,
    pub path_state: String,
    pub version: i64,
    pub referenced_profile_count: i64,
    pub snapshot: Option<AdapterCapabilitySnapshot>,
    pub member_runtime_defaults: Option<MemberRuntimeConfiguration>,
    pub last_probe_attempt: Option<AdapterProbeAttempt>,
    pub relocation_history: Vec<AdapterRelocationAudit>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterProbeAttempt {
    pub id: String,
    pub installation_id: String,
    pub status: String,
    pub failure_class: String,
    pub diagnostic_code: Option<String>,
    pub candidate_path: String,
    pub executable_fingerprint: Option<String>,
    pub attempted_at: String,
    pub retry_after: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterRelocationAudit {
    pub id: String,
    pub installation_id: String,
    pub previous_path: String,
    pub next_path: Option<String>,
    pub previous_fingerprint: Option<String>,
    pub next_fingerprint: Option<String>,
    pub source: Option<InstallationSource>,
    pub result: String,
    pub diagnostic_code: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberCampMembershipView {
    pub camp_id: String,
    pub project_path: String,
    pub membership_status: String,
    pub is_default_lead: bool,
    pub joined_at: String,
    pub left_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeReadinessStatus {
    RuntimeNotConfigured,
    NeedsAttention,
    Ready,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadinessBlocker {
    pub code: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReadiness {
    pub status: RuntimeReadinessStatus,
    pub blockers: Vec<RuntimeReadinessBlocker>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileView {
    pub agent_id: String,
    pub display_name: String,
    pub avatar_ref: Option<String>,
    pub accent: Option<String>,
    pub team_role: String,
    pub professional_responsibilities: String,
    pub personality_traits: Vec<String>,
    pub working_principles: String,
    pub growth_topic: String,
    pub default_capabilities: Vec<String>,
    pub presence: String,
    pub runtime_configuration: Option<MemberRuntimeConfiguration>,
    pub runtime_readiness: RuntimeReadiness,
    pub member_order: i64,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub removed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct CreateAgentProfileCommand {
    pub display_name: String,
    pub team_role: String,
    pub professional_responsibilities: String,
    pub personality_traits: Vec<String>,
    pub working_principles: String,
    pub growth_topic: String,
}

impl sealed::Sealed for CreateAgentProfileCommand {}
impl DomainCommand for CreateAgentProfileCommand {
    const TYPE: &'static str = "agent_profile.create";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct UpdateAgentProfileCommand {
    pub agent_id: String,
    pub expected_version: i64,
    pub display_name: String,
    pub team_role: String,
    pub professional_responsibilities: String,
    pub personality_traits: Vec<String>,
    pub working_principles: String,
    pub growth_topic: String,
}

impl sealed::Sealed for UpdateAgentProfileCommand {}
impl DomainCommand for UpdateAgentProfileCommand {
    const TYPE: &'static str = "agent_profile.update";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct SetAgentProfileAvatarCommand {
    pub agent_id: String,
    pub expected_version: i64,
    pub avatar_ref: Option<String>,
}

impl sealed::Sealed for SetAgentProfileAvatarCommand {}
impl DomainCommand for SetAgentProfileAvatarCommand {
    const TYPE: &'static str = "agent_profile.avatar.set";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMemberRuntimeConfigurationCommand {
    pub agent_id: String,
    pub expected_version: i64,
    pub adapter_kind: AdapterKind,
    pub model: ModelSelection,
    pub permissions: AdapterPermissionConfig,
}

impl sealed::Sealed for SetMemberRuntimeConfigurationCommand {}
impl DomainCommand for SetMemberRuntimeConfigurationCommand {
    const TYPE: &'static str = "agent_profile.runtime.set";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearMemberRuntimeConfigurationCommand {
    pub agent_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for ClearMemberRuntimeConfigurationCommand {}
impl DomainCommand for ClearMemberRuntimeConfigurationCommand {
    const TYPE: &'static str = "agent_profile.runtime.clear";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMemberPresenceCommand {
    pub agent_id: String,
    pub expected_version: i64,
    pub presence: String,
}

impl sealed::Sealed for SetMemberPresenceCommand {}
impl DomainCommand for SetMemberPresenceCommand {
    const TYPE: &'static str = "agent_profile.presence.set";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveMemberCommand {
    pub agent_id: String,
    pub expected_version: i64,
    pub confirmation_name: String,
}

impl sealed::Sealed for RemoveMemberCommand {}
impl DomainCommand for RemoveMemberCommand {
    const TYPE: &'static str = "agent_profile.remove";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberRemovalPreview {
    pub agent_id: String,
    pub display_name: String,
    pub version: i64,
    pub non_terminal_agent_run_count: i64,
    pub removable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderAgentProfilesCommand {
    pub ordered_agent_ids: Vec<String>,
}

impl sealed::Sealed for ReorderAgentProfilesCommand {}
impl DomainCommand for ReorderAgentProfilesCommand {
    const TYPE: &'static str = "agent_profile.reorder";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAdapterInstallationCommand {
    pub adapter_kind: AdapterKind,
    pub executable_path: String,
    pub command_name: String,
    pub source: InstallationSource,
    pub auth_scope: String,
}

impl sealed::Sealed for CreateAdapterInstallationCommand {}
impl DomainCommand for CreateAdapterInstallationCommand {
    const TYPE: &'static str = "adapter_installation.create";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAdapterInstallationCommand {
    pub installation_id: String,
    pub expected_version: i64,
    pub executable_path: String,
    pub command_name: String,
    pub source: InstallationSource,
    pub auth_scope: String,
    pub enabled: bool,
}

impl sealed::Sealed for UpdateAdapterInstallationCommand {}
impl DomainCommand for UpdateAdapterInstallationCommand {
    const TYPE: &'static str = "adapter_installation.update";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordAdapterCapabilitySnapshotCommand {
    pub installation_id: String,
    pub expected_installation_version: i64,
    pub snapshot: AdapterCapabilitySnapshot,
}

#[derive(Debug, Clone)]
pub struct VerifiedManagedInstallation {
    pub adapter_kind: AdapterKind,
    pub executable_path: String,
    pub command_name: String,
    pub source: InstallationSource,
    pub auth_scope: String,
    pub snapshot: AdapterCapabilitySnapshot,
}

#[derive(Debug, Clone, Copy)]
pub struct ManagedProbeFailure<'a> {
    pub adapter_kind: AdapterKind,
    pub auth_scope: &'a str,
    pub candidate_path: &'a str,
    pub fingerprint: Option<&'a str>,
    pub source: Option<InstallationSource>,
    pub failure_class: &'a str,
    pub diagnostic_code: &'a str,
}

impl sealed::Sealed for RecordAdapterCapabilitySnapshotCommand {}
impl DomainCommand for RecordAdapterCapabilitySnapshotCommand {
    const TYPE: &'static str = "adapter_installation.snapshot.record";
}

#[derive(Debug, Default)]
pub struct AgentProfileService {
    gateway: DomainCommandGateway,
}

impl AgentProfileService {
    pub fn all_profile_ids(&self, database: &Database) -> Result<BTreeSet<String>> {
        let mut statement = database
            .connection()
            .prepare("SELECT id FROM agent_profile ORDER BY id")?;
        Ok(statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<BTreeSet<_>>>()?)
    }

    pub fn list_profiles(&self, database: &Database) -> Result<Vec<AgentProfileView>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT id, display_name, avatar_ref,
                   NULLIF(accent, ''), team_role, professional_responsibilities,
                   personality_traits_json, working_principles, growth_topic,
                   default_capabilities_json, profile_status,
                   selected_runtime_adapter_kind,
                   default_runtime_installation_id, default_model_selection_json,
                   default_permission_config_json, version, created_at, updated_at,
                   removed_at, member_order
            FROM agent_profile
            WHERE profile_status <> 'removed'
            ORDER BY member_order, id
            "#,
        )?;
        let rows = statement.query_map([], raw_agent_profile_from_row)?;
        let mut profiles = Vec::new();
        for row in rows {
            profiles.push(self.materialize_profile(database, row?)?);
        }
        Ok(profiles)
    }

    pub fn get_profile(
        &self,
        database: &Database,
        agent_id: &str,
    ) -> Result<Option<AgentProfileView>> {
        let raw = database
            .connection()
            .query_row(
                r#"
                SELECT id, display_name, avatar_ref,
                       NULLIF(accent, ''), team_role, professional_responsibilities,
                       personality_traits_json, working_principles, growth_topic,
                       default_capabilities_json, profile_status,
                       selected_runtime_adapter_kind,
                       default_runtime_installation_id, default_model_selection_json,
                       default_permission_config_json, version, created_at, updated_at,
                       removed_at, member_order
                FROM agent_profile
                WHERE id = ?1 AND profile_status <> 'removed'
                "#,
                [agent_id],
                raw_agent_profile_from_row,
            )
            .optional()?;
        raw.map(|profile| self.materialize_profile(database, profile))
            .transpose()
    }

    pub fn reorder_profiles(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ReorderAgentProfilesCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, crate::command::ActorRef::User { .. }) {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.reorder_user_required",
                    json!({}),
                ));
            }
            let existing = {
                let mut statement = transaction
                    .prepare("SELECT id FROM agent_profile WHERE profile_status <> 'removed'")?;
                statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<std::collections::BTreeSet<_>>>()?
            };
            let requested = envelope
                .payload
                .ordered_agent_ids
                .iter()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>();
            if requested.len() != envelope.payload.ordered_agent_ids.len() || requested != existing
            {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.invalid_order",
                    json!({
                        "expectedAgentIds": existing,
                        "receivedAgentIds": envelope.payload.ordered_agent_ids,
                    }),
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            for (member_order, agent_id) in envelope.payload.ordered_agent_ids.iter().enumerate() {
                transaction.execute(
                    r#"
                    UPDATE agent_profile
                    SET member_order = ?2, version = version + 1, updated_at = ?3
                    WHERE id = ?1
                    "#,
                    params![agent_id, member_order as i64, now],
                )?;
            }
            Ok(CommandHandlerResult::applied(
                "agent_profile.reordered",
                json!({
                    "orderedAgentIds": envelope.payload.ordered_agent_ids,
                }),
                None,
            ))
        })
    }

    pub fn list_camp_memberships(
        &self,
        database: &Database,
        agent_id: &str,
    ) -> Result<Vec<MemberCampMembershipView>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT camp.id, camp.project_path, camp_member.status,
                   COALESCE(camp.default_lead_agent_id = camp_member.agent_id, 0),
                   camp_member.joined_at, camp_member.left_at
            FROM camp_member
            JOIN camp ON camp.id = camp_member.camp_id
            WHERE camp_member.agent_id = ?1
            ORDER BY camp_member.status = 'active' DESC, camp.updated_at DESC, camp.id
            "#,
        )?;
        statement
            .query_map([agent_id], |row| {
                Ok(MemberCampMembershipView {
                    camp_id: row.get(0)?,
                    project_path: row.get(1)?,
                    membership_status: row.get(2)?,
                    is_default_lead: row.get(3)?,
                    joined_at: row.get(4)?,
                    left_at: row.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to list AgentProfile Camp memberships")
    }

    pub fn list_installations(&self, database: &Database) -> Result<Vec<AdapterInstallationView>> {
        let mut installations = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT installation.id, installation.adapter_kind,
                       installation.executable_path, installation.command_name,
                       installation.installation_class, installation.source,
                       installation.auth_scope, installation.enabled,
                       installation.generation, installation.path_state,
                       installation.version, installation.created_at,
                       installation.updated_at,
                       snapshot.reported_version, snapshot.executable_fingerprint,
                       snapshot.authentication_status, snapshot.probe_status,
                       snapshot.permission_schema_version,
                       snapshot.permission_schema_digest,
                       snapshot.capabilities_json, snapshot.protocols_json,
                       snapshot.model_catalog_json, snapshot.permission_options_json,
                       snapshot.observed_at, snapshot.last_attempted_at,
                       snapshot.last_successful_probe_at, snapshot.stale_at,
                       snapshot.last_error, snapshot.native_session_compatibility_key,
                       (SELECT COUNT(*) FROM agent_profile
                        WHERE agent_profile.default_runtime_installation_id = installation.id
                          AND agent_profile.profile_status <> 'removed'),
                       attempt.id, attempt.status, attempt.failure_class,
                       attempt.diagnostic_code, attempt.candidate_path,
                       attempt.executable_fingerprint, attempt.attempted_at,
                       attempt.retry_after
                FROM adapter_installation AS installation
                LEFT JOIN adapter_capability_snapshot AS snapshot
                  ON snapshot.installation_id = installation.id
                LEFT JOIN adapter_probe_attempt AS attempt
                  ON attempt.id = (
                      SELECT candidate.id
                      FROM adapter_probe_attempt AS candidate
                      WHERE candidate.installation_id = installation.id
                      ORDER BY candidate.attempted_at DESC, candidate.id DESC
                      LIMIT 1
                  )
                ORDER BY installation.adapter_kind,
                         installation.installation_class,
                         installation.created_at, installation.id
                "#,
            )?;
            statement
                .query_map([], installation_from_row)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .context("failed to list Adapter installations")?
        };
        for installation in &mut installations {
            installation.member_runtime_defaults = if installation.enabled
                && installation.path_state == "valid"
            {
                installation
                    .snapshot
                    .as_ref()
                    .map(|snapshot| {
                        member_runtime_defaults_for_snapshot(installation.adapter_kind, snapshot)
                    })
                    .transpose()?
                    .flatten()
            } else {
                None
            };
            installation.relocation_history = relocation_history(database, &installation.id, 20)?;
        }
        Ok(installations)
    }

    pub fn managed_installation(
        &self,
        database: &Database,
        adapter_kind: AdapterKind,
        auth_scope: &str,
    ) -> Result<Option<AdapterInstallationView>> {
        Ok(self
            .list_installations(database)?
            .into_iter()
            .find(|installation| {
                installation.adapter_kind == adapter_kind
                    && installation.auth_scope == auth_scope
                    && installation.installation_class == InstallationClass::ManagedDefault
            }))
    }

    pub fn verified_executable_identity(
        &self,
        database: &Database,
        installation_id: &str,
        executable_path: &str,
        executable_fingerprint: &str,
    ) -> Result<Option<ExecutableFileIdentity>> {
        database
            .connection()
            .query_row(
                r#"
                SELECT identity.byte_size, identity.modified_at_unix_nanos,
                       identity.file_id
                FROM runtime_executable_identity AS identity
                JOIN adapter_installation AS installation
                  ON installation.id = identity.installation_id
                JOIN adapter_capability_snapshot AS snapshot
                  ON snapshot.installation_id = installation.id
                WHERE identity.installation_id = ?1
                  AND identity.executable_path = ?2
                  AND identity.executable_fingerprint = ?3
                  AND installation.executable_path = ?2
                  AND snapshot.executable_fingerprint = ?3
                "#,
                params![installation_id, executable_path, executable_fingerprint],
                |row| {
                    let byte_size = row.get::<_, i64>(0)?;
                    Ok(ExecutableFileIdentity {
                        byte_size: u64::try_from(byte_size).map_err(|error| {
                            rusqlite::Error::FromSqlConversionFailure(
                                0,
                                rusqlite::types::Type::Integer,
                                Box::new(error),
                            )
                        })?,
                        modified_at_unix_nanos: row.get(1)?,
                        file_id: row.get(2)?,
                    })
                },
            )
            .optional()
            .context("failed to load verified Runtime executable identity")
    }

    pub fn runtime_dispatch_blocker(
        &self,
        database: &Database,
        runtime: &FrozenAgentRuntimeConfig,
    ) -> Result<Option<RuntimeConfigurationBlocker>> {
        let current = database
            .connection()
            .query_row(
                r#"
                SELECT installation.adapter_kind, installation.executable_path,
                       installation.generation, installation.enabled,
                       installation.path_state,
                       snapshot.executable_fingerprint,
                       snapshot.authentication_status, snapshot.probe_status,
                       snapshot.stale_at
                FROM adapter_installation AS installation
                LEFT JOIN adapter_capability_snapshot AS snapshot
                  ON snapshot.installation_id = installation.id
                WHERE installation.id = ?1
                "#,
                [&runtime.installation_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, bool>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, Option<String>>(8)?,
                    ))
                },
            )
            .optional()?;
        let Some((
            adapter_kind,
            executable_path,
            generation,
            enabled,
            path_state,
            executable_fingerprint,
            authentication_status,
            probe_status,
            stale_at,
        )) = current
        else {
            return Ok(Some(runtime_blocker(
                "adapter_installation_missing",
                json!({ "installationId": runtime.installation_id }),
            )));
        };
        if !enabled {
            return Ok(Some(runtime_blocker(
                "adapter_installation_disabled",
                json!({ "installationId": runtime.installation_id }),
            )));
        }
        if adapter_kind != runtime.adapter_kind.as_str()
            || executable_path != runtime.executable_path
            || generation != runtime.installation_generation
            || executable_fingerprint.as_deref() != Some(runtime.executable_fingerprint.as_str())
        {
            return Ok(Some(runtime_blocker(
                "runtime_snapshot_changed",
                json!({ "installationId": runtime.installation_id }),
            )));
        }
        if path_state != "valid" {
            return Ok(Some(runtime_blocker(
                "runtime_path_invalid",
                json!({
                    "installationId": runtime.installation_id,
                    "pathState": path_state,
                }),
            )));
        }
        if let Some(stale_at) = stale_at {
            return Ok(Some(runtime_blocker(
                "runtime_snapshot_stale",
                json!({
                    "installationId": runtime.installation_id,
                    "staleAt": stale_at,
                }),
            )));
        }
        if authentication_status.as_deref() == Some("authentication_required") {
            return Ok(Some(runtime_blocker(
                "runtime_authentication_required",
                json!({ "installationId": runtime.installation_id }),
            )));
        }
        if probe_status.as_deref() != Some("ready") {
            return Ok(Some(runtime_blocker(
                "runtime_probe_required",
                json!({
                    "installationId": runtime.installation_id,
                    "probeStatus": probe_status,
                }),
            )));
        }
        Ok(None)
    }

    pub fn record_verified_executable_identity(
        &self,
        database: &mut Database,
        installation_id: &str,
        executable_path: &str,
        executable_fingerprint: &str,
        identity: &ExecutableFileIdentity,
    ) -> Result<bool> {
        let transaction = database.connection_mut().transaction()?;
        let current = transaction.query_row(
            r#"
                SELECT COUNT(*)
                FROM adapter_installation AS installation
                JOIN adapter_capability_snapshot AS snapshot
                  ON snapshot.installation_id = installation.id
                WHERE installation.id = ?1
                  AND installation.executable_path = ?2
                  AND snapshot.executable_fingerprint = ?3
                "#,
            params![installation_id, executable_path, executable_fingerprint],
            |row| row.get::<_, i64>(0),
        )? != 0;
        if current {
            upsert_runtime_executable_identity(
                &transaction,
                installation_id,
                executable_path,
                executable_fingerprint,
                identity,
                &chrono::Utc::now().to_rfc3339(),
            )?;
        }
        transaction.commit()?;
        Ok(current)
    }

    pub fn mark_runtime_integrity_changed(
        &self,
        database: &mut Database,
        installation_id: &str,
        executable_path: &str,
        executable_fingerprint: &str,
    ) -> Result<bool> {
        let transaction = database.connection_mut().transaction()?;
        let now = chrono::Utc::now().to_rfc3339();
        let changed = transaction.execute(
            r#"
            UPDATE adapter_capability_snapshot
            SET stale_at = COALESCE(stale_at, ?4),
                last_error = 'runtime_executable_identity_changed'
            WHERE installation_id = ?1
              AND executable_fingerprint = ?3
              AND EXISTS (
                  SELECT 1
                  FROM adapter_installation
                  WHERE adapter_installation.id = ?1
                    AND adapter_installation.executable_path = ?2
              )
            "#,
            params![
                installation_id,
                executable_path,
                executable_fingerprint,
                now
            ],
        )? != 0;
        if changed {
            transaction.execute(
                "DELETE FROM runtime_executable_identity WHERE installation_id = ?1",
                [installation_id],
            )?;
        }
        transaction.commit()?;
        Ok(changed)
    }

    pub fn commit_verified_managed_installation(
        &self,
        database: &mut Database,
        verified: VerifiedManagedInstallation,
    ) -> Result<String> {
        validate_installation(&verified.executable_path, &verified.auth_scope)?;
        validate_command_name(&verified.command_name)?;
        validate_snapshot(&verified.snapshot)?;
        if verified.snapshot.probe_status != "ready"
            || verified.snapshot.executable_fingerprint.is_none()
        {
            anyhow::bail!("managed Installation requires a successful deep probe");
        }
        if verified.source == InstallationSource::Custom {
            anyhow::bail!("managed Installation cannot use a custom source");
        }
        let executable_identity =
            observe_executable_file_identity(Path::new(&verified.executable_path)).ok();

        let transaction = database.connection_mut().transaction()?;
        let existing = transaction
            .query_row(
                r#"
                SELECT installation.id, installation.executable_path,
                       installation.generation, installation.version,
                       snapshot.executable_fingerprint
                FROM adapter_installation AS installation
                LEFT JOIN adapter_capability_snapshot AS snapshot
                  ON snapshot.installation_id = installation.id
                WHERE installation.adapter_kind = ?1
                  AND installation.auth_scope = ?2
                  AND installation.installation_class = 'managed_default'
                "#,
                params![verified.adapter_kind.as_str(), verified.auth_scope],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()?;
        let now = chrono::Utc::now().to_rfc3339();
        let (installation_id, previous_path, previous_fingerprint, identity_changed) =
            if let Some((id, path, _generation, _version, fingerprint)) = existing {
                let identity_changed = path != verified.executable_path
                    || fingerprint != verified.snapshot.executable_fingerprint;
                if identity_changed {
                    transaction.execute(
                        r#"
                        UPDATE adapter_installation
                        SET executable_path = ?2, command_name = ?3, source = ?4,
                            enabled = 1, path_state = 'valid',
                            generation = generation + 1,
                            version = version + 1, updated_at = ?5
                        WHERE id = ?1
                        "#,
                        params![
                            id,
                            verified.executable_path,
                            verified.command_name,
                            verified.source.as_str(),
                            now,
                        ],
                    )?;
                } else {
                    transaction.execute(
                        r#"
                        UPDATE adapter_installation
                        SET enabled = 1, path_state = 'valid', updated_at = ?2
                        WHERE id = ?1
                        "#,
                        params![id, now],
                    )?;
                }
                (id, path, fingerprint, identity_changed)
            } else {
                let id = format!("adapter-installation-{}", Uuid::new_v4());
                transaction.execute(
                    r#"
                    INSERT INTO adapter_installation(
                        id, adapter_kind, executable_path, command_name,
                        installation_class, source, auth_scope, enabled,
                        generation, path_state, version, created_at, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, ?4, 'managed_default', ?5, ?6, 1,
                        1, 'valid', 1, ?7, ?7
                    )
                    "#,
                    params![
                        id,
                        verified.adapter_kind.as_str(),
                        verified.executable_path,
                        verified.command_name,
                        verified.source.as_str(),
                        verified.auth_scope,
                        now,
                    ],
                )?;
                (id, String::new(), None, false)
            };

        upsert_successful_capability_snapshot(&transaction, &installation_id, &verified.snapshot)?;
        if let (Some(identity), Some(fingerprint)) = (
            executable_identity.as_ref(),
            verified.snapshot.executable_fingerprint.as_deref(),
        ) {
            upsert_runtime_executable_identity(
                &transaction,
                &installation_id,
                &verified.executable_path,
                fingerprint,
                identity,
                &verified.snapshot.last_attempted_at,
            )?;
        }
        insert_probe_attempt(
            &transaction,
            &installation_id,
            "ready",
            "none",
            None,
            &verified.executable_path,
            verified.snapshot.executable_fingerprint.as_deref(),
            &verified.snapshot.last_attempted_at,
            None,
        )?;
        if identity_changed {
            transaction.execute(
                r#"
                INSERT INTO adapter_relocation_audit(
                    id, installation_id, previous_path, next_path,
                    previous_fingerprint, next_fingerprint, source,
                    result, diagnostic_code, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'succeeded', NULL, ?8)
                "#,
                params![
                    format!("adapter-relocation-{}", Uuid::new_v4()),
                    installation_id,
                    previous_path,
                    verified.executable_path,
                    previous_fingerprint,
                    verified.snapshot.executable_fingerprint,
                    verified.source.as_str(),
                    now,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(installation_id)
    }

    pub fn record_managed_probe_failure(
        &self,
        database: &mut Database,
        failure: ManagedProbeFailure<'_>,
    ) -> Result<()> {
        let ManagedProbeFailure {
            adapter_kind,
            auth_scope,
            candidate_path,
            fingerprint,
            source,
            failure_class,
            diagnostic_code,
        } = failure;
        let transaction = database.connection_mut().transaction()?;
        let existing = transaction
            .query_row(
                r#"
                SELECT id, executable_path
                FROM adapter_installation
                WHERE adapter_kind = ?1 AND auth_scope = ?2
                  AND installation_class = 'managed_default'
                "#,
                params![adapter_kind.as_str(), auth_scope],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((installation_id, previous_path)) = existing else {
            transaction.commit()?;
            return Ok(());
        };
        let attempted_at = chrono::Utc::now().to_rfc3339();
        let retry_after = next_probe_retry_after(&transaction, &installation_id, failure_class)?;
        insert_probe_attempt(
            &transaction,
            &installation_id,
            "failed",
            failure_class,
            Some(diagnostic_code),
            candidate_path,
            fingerprint,
            &attempted_at,
            retry_after.as_deref(),
        )?;
        if failure_class != "transient" {
            transaction.execute(
                r#"
                UPDATE adapter_capability_snapshot
                SET stale_at = COALESCE(stale_at, ?2), last_error = ?3
                WHERE installation_id = ?1
                "#,
                params![installation_id, attempted_at, diagnostic_code],
            )?;
        }
        if failure_class == "path_missing" {
            transaction.execute(
                r#"
                UPDATE adapter_installation
                SET path_state = 'path_missing', updated_at = ?2
                WHERE id = ?1
                "#,
                params![installation_id, attempted_at],
            )?;
        }
        if candidate_path != previous_path {
            let previous_fingerprint = transaction
                .query_row(
                    r#"
                    SELECT executable_fingerprint
                    FROM adapter_capability_snapshot
                    WHERE installation_id = ?1
                    "#,
                    [&installation_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten();
            transaction.execute(
                r#"
                INSERT INTO adapter_relocation_audit(
                    id, installation_id, previous_path, next_path,
                    previous_fingerprint, next_fingerprint, source,
                    result, diagnostic_code, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'failed', ?8, ?9)
                "#,
                params![
                    format!("adapter-relocation-{}", Uuid::new_v4()),
                    installation_id,
                    previous_path,
                    candidate_path,
                    previous_fingerprint,
                    fingerprint,
                    source.map(InstallationSource::as_str),
                    diagnostic_code,
                    attempted_at,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn create_profile(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateAgentProfileCommand>,
    ) -> Result<CommandExecution> {
        let identity = normalize_member_identity(
            &envelope.payload.display_name,
            &envelope.payload.team_role,
            &envelope.payload.professional_responsibilities,
            &envelope.payload.personality_traits,
            &envelope.payload.working_principles,
            &envelope.payload.growth_topic,
        )?;
        self.gateway.execute(database, envelope, |transaction| {
            if profile_display_name_exists(transaction, &identity.display_name, None)? {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.display_name_conflict",
                    json!({ "displayName": identity.display_name }),
                ));
            }
            let id = allocate_agent_id(transaction)?;
            let profile_uuid = Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO agent_profile(
                    uuid, id, slug, handle, display_name, avatar_ref,
                    team_role, professional_responsibilities, personality_traits_json,
                    working_principles, growth_topic,
                    default_capabilities_json, accent,
                    runtime_enabled, visual_state_json, profile_status, member_order, version,
                    created_at, updated_at, archived_at
                ) VALUES (
                    ?9, ?1, ?1, NULL, ?2, NULL,
                    ?3, ?4, ?5,
                    ?6, ?7,
                    '[]', '',
                    0, '{}', 'present',
                    (SELECT COALESCE(MAX(member_order), -1) + 1 FROM agent_profile), 1,
                    ?8, ?8, NULL
                )
                "#,
                params![
                    id,
                    identity.display_name,
                    identity.team_role,
                    identity.professional_responsibilities,
                    serde_json::to_string(&identity.personality_traits)?,
                    identity.working_principles,
                    identity.growth_topic,
                    now,
                    profile_uuid,
                ],
            )?;
            Ok(CommandHandlerResult::applied(
                "agent_profile.created",
                json!({ "agentId": id, "version": 1 }),
                Some(EntityReference {
                    entity_type: "agent_profile".to_string(),
                    entity_id: id,
                }),
            ))
        })
    }

    pub fn update_profile(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UpdateAgentProfileCommand>,
    ) -> Result<CommandExecution> {
        let identity = normalize_member_identity(
            &envelope.payload.display_name,
            &envelope.payload.team_role,
            &envelope.payload.professional_responsibilities,
            &envelope.payload.personality_traits,
            &envelope.payload.working_principles,
            &envelope.payload.growth_topic,
        )?;
        self.gateway.execute(database, envelope, |transaction| {
            let Some((version, presence)) =
                profile_version_and_presence(transaction, &envelope.payload.agent_id)?
            else {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.not_found",
                    json!({ "agentId": envelope.payload.agent_id }),
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            if presence == "removed" {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.removed",
                    json!({ "agentId": envelope.payload.agent_id }),
                ));
            }
            if profile_display_name_exists(
                transaction,
                &identity.display_name,
                Some(&envelope.payload.agent_id),
            )? {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.display_name_conflict",
                    json!({ "displayName": identity.display_name }),
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE agent_profile
                SET display_name = ?2,
                    team_role = ?3,
                    professional_responsibilities = ?4,
                    personality_traits_json = ?5,
                    working_principles = ?6,
                    growth_topic = ?7,
                    version = version + 1, updated_at = ?8
                WHERE id = ?1 AND version = ?9
                "#,
                params![
                    envelope.payload.agent_id,
                    identity.display_name,
                    identity.team_role,
                    identity.professional_responsibilities,
                    serde_json::to_string(&identity.personality_traits)?,
                    identity.working_principles,
                    identity.growth_topic,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            Ok(profile_updated_result(
                &envelope.payload.agent_id,
                version + 1,
                "agent_profile.updated",
            ))
        })
    }

    pub fn set_avatar(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SetAgentProfileAvatarCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            let Some((version, current_avatar_ref, presence)) =
                profile_version_and_avatar_ref(transaction, &envelope.payload.agent_id)?
            else {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.not_found",
                    json!({ "agentId": envelope.payload.agent_id }),
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            if presence == "removed" {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.removed",
                    json!({ "agentId": envelope.payload.agent_id }),
                ));
            }
            validate_member_avatar_update(
                current_avatar_ref.as_deref(),
                envelope.payload.avatar_ref.as_deref(),
            )?;
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE agent_profile
                SET avatar_ref = ?2, version = version + 1, updated_at = ?3
                WHERE id = ?1 AND version = ?4
                "#,
                params![
                    envelope.payload.agent_id,
                    envelope.payload.avatar_ref,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            Ok(profile_updated_result(
                &envelope.payload.agent_id,
                version + 1,
                "agent_profile.avatar_updated",
            ))
        })
    }

    pub fn set_runtime(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SetMemberRuntimeConfigurationCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            let Some((version, presence)) =
                profile_version_and_presence(transaction, &envelope.payload.agent_id)?
            else {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.not_found",
                    json!({ "agentId": envelope.payload.agent_id }),
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            if presence == "removed" {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.removed",
                    json!({ "agentId": envelope.payload.agent_id }),
                ));
            }
            let Some(ready) =
                ready_managed_runtime_snapshot(transaction, envelope.payload.adapter_kind)?
            else {
                return Ok(CommandHandlerResult::rejected(
                    "runtime_configuration_unavailable",
                    json!({ "adapterKind": envelope.payload.adapter_kind }),
                ));
            };
            if envelope.payload.permissions.adapter_kind != envelope.payload.adapter_kind {
                return Ok(CommandHandlerResult::rejected(
                    "runtime_permission_adapter_mismatch",
                    json!({
                        "adapterKind": envelope.payload.adapter_kind,
                        "permissionAdapterKind": envelope.payload.permissions.adapter_kind,
                    }),
                ));
            }
            let binding = ResolvedRuntimeBinding {
                adapter_kind: envelope.payload.adapter_kind,
                installation_id: ready.installation_id.clone(),
                model: envelope.payload.model.clone(),
                permissions: envelope.payload.permissions.clone(),
            };
            if let Some(issue) = runtime_configuration_issue(
                &ready.models_json,
                ready.permission_schema_version,
                &ready.permissions_json,
                &binding,
            )? {
                return Ok(CommandHandlerResult::rejected(issue.code, issue.payload));
            }
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE agent_profile
                SET selected_runtime_adapter_kind = ?2,
                    default_runtime_installation_id = ?3,
                    default_model_selection_json = ?4,
                    default_permission_config_json = ?5,
                    version = version + 1, updated_at = ?6
                WHERE id = ?1 AND version = ?7
                "#,
                params![
                    envelope.payload.agent_id,
                    envelope.payload.adapter_kind.as_str(),
                    ready.installation_id,
                    serde_json::to_string(&binding.model)?,
                    serde_json::to_string(&binding.permissions)?,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            Ok(profile_updated_result(
                &envelope.payload.agent_id,
                version + 1,
                "agent_profile.runtime_configured",
            ))
        })
    }

    pub fn clear_runtime(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ClearMemberRuntimeConfigurationCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            let Some((version, presence)) =
                profile_version_and_presence(transaction, &envelope.payload.agent_id)?
            else {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.not_found",
                    json!({ "agentId": envelope.payload.agent_id }),
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            if presence == "removed" {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.removed",
                    json!({ "agentId": envelope.payload.agent_id }),
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE agent_profile
                SET selected_runtime_adapter_kind = NULL,
                    default_runtime_installation_id = NULL,
                    default_model_selection_json = NULL,
                    default_permission_config_json = NULL,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1 AND version = ?3
                "#,
                params![
                    envelope.payload.agent_id,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            Ok(profile_updated_result(
                &envelope.payload.agent_id,
                version + 1,
                "agent_profile.runtime_cleared",
            ))
        })
    }

    pub fn set_presence(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SetMemberPresenceCommand>,
    ) -> Result<CommandExecution> {
        if !matches!(envelope.payload.presence.as_str(), "present" | "away") {
            anyhow::bail!("Member Presence must be present or away");
        }
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, crate::command::ActorRef::User { .. }) {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.presence_user_required",
                    json!({}),
                ));
            }
            let Some((version, current_presence)) =
                profile_version_and_presence(transaction, &envelope.payload.agent_id)?
            else {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.not_found",
                    json!({ "agentId": envelope.payload.agent_id }),
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            if current_presence == "removed" {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.removed",
                    json!({ "agentId": envelope.payload.agent_id }),
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE agent_profile
                SET profile_status = ?2,
                    version = version + 1, updated_at = ?3
                WHERE id = ?1 AND version = ?4
                "#,
                params![
                    envelope.payload.agent_id,
                    envelope.payload.presence,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            Ok(profile_updated_result(
                &envelope.payload.agent_id,
                version + 1,
                "agent_profile.presence_changed",
            ))
        })
    }

    pub fn removal_preview(
        &self,
        database: &Database,
        agent_id: &str,
    ) -> Result<Option<MemberRemovalPreview>> {
        database
            .connection()
            .query_row(
                r#"
                SELECT profile.id, profile.display_name, profile.version,
                       (SELECT COUNT(*)
                        FROM agent_run
                        JOIN conversation
                          ON conversation.id = agent_run.conversation_id
                        WHERE conversation.agent_id = profile.id
                          AND agent_run.status IN ('queued', 'running', 'waiting'))
                FROM agent_profile AS profile
                WHERE profile.id = ?1 AND profile.profile_status <> 'removed'
                "#,
                [agent_id],
                |row| {
                    let non_terminal_agent_run_count = row.get::<_, i64>(3)?;
                    Ok(MemberRemovalPreview {
                        agent_id: row.get(0)?,
                        display_name: row.get(1)?,
                        version: row.get(2)?,
                        non_terminal_agent_run_count,
                        removable: non_terminal_agent_run_count == 0,
                    })
                },
            )
            .optional()
            .context("failed to load member removal preview")
    }

    pub fn remove_member(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RemoveMemberCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, crate::command::ActorRef::User { .. }) {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.remove_user_required",
                    json!({}),
                ));
            }
            let current = transaction
                .query_row(
                    r#"
                    SELECT version, display_name, profile_status
                    FROM agent_profile WHERE id = ?1
                    "#,
                    [&envelope.payload.agent_id],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()?;
            let Some((version, display_name, presence)) = current else {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.not_found",
                    json!({ "agentId": envelope.payload.agent_id }),
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            if presence == "removed" {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.removed",
                    json!({ "agentId": envelope.payload.agent_id }),
                ));
            }
            if envelope.payload.confirmation_name != display_name {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.confirmation_name_mismatch",
                    json!({ "displayName": display_name }),
                ));
            }
            let non_terminal_agent_run_count = transaction.query_row(
                r#"
                SELECT COUNT(*)
                FROM agent_run
                JOIN conversation
                  ON conversation.id = agent_run.conversation_id
                WHERE conversation.agent_id = ?1
                  AND status IN ('queued', 'running', 'waiting')
                "#,
                [&envelope.payload.agent_id],
                |row| row.get::<_, i64>(0),
            )?;
            if non_terminal_agent_run_count > 0 {
                return Ok(CommandHandlerResult::rejected(
                    "agent_profile.non_terminal_runs",
                    json!({ "count": non_terminal_agent_run_count }),
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE agent_profile
                SET profile_status = 'removed', removed_at = ?2,
                    version = version + 1, updated_at = ?2
                WHERE id = ?1 AND version = ?3
                "#,
                params![
                    envelope.payload.agent_id,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            Ok(profile_updated_result(
                &envelope.payload.agent_id,
                version + 1,
                "agent_profile.removed",
            ))
        })
    }

    pub fn create_installation(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateAdapterInstallationCommand>,
    ) -> Result<CommandExecution> {
        validate_installation(
            &envelope.payload.executable_path,
            &envelope.payload.auth_scope,
        )?;
        validate_command_name(&envelope.payload.command_name)?;
        self.gateway.execute(database, envelope, |transaction| {
            let existing = transaction
                .query_row(
                    r#"
                    SELECT id FROM adapter_installation
                    WHERE adapter_kind = ?1 AND executable_path = ?2 AND auth_scope = ?3
                      AND installation_class = 'custom'
                    "#,
                    params![
                        envelope.payload.adapter_kind.as_str(),
                        envelope.payload.executable_path,
                        envelope.payload.auth_scope,
                    ],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if let Some(id) = existing {
                return Ok(CommandHandlerResult::rejected(
                    "adapter_installation.already_exists",
                    json!({ "installationId": id }),
                ));
            }
            let id = format!("adapter-installation-{}", Uuid::new_v4());
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO adapter_installation(
                    id, adapter_kind, executable_path, command_name,
                    installation_class, source, auth_scope,
                    enabled, generation, path_state, version, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, 'custom', ?5, ?6,
                          1, 1, 'valid', 1, ?7, ?7)
                "#,
                params![
                    id,
                    envelope.payload.adapter_kind.as_str(),
                    envelope.payload.executable_path,
                    envelope.payload.command_name,
                    envelope.payload.source.as_str(),
                    envelope.payload.auth_scope,
                    now,
                ],
            )?;
            Ok(CommandHandlerResult::applied(
                "adapter_installation.created",
                json!({ "installationId": id, "version": 1 }),
                Some(EntityReference {
                    entity_type: "adapter_installation".to_string(),
                    entity_id: id,
                }),
            ))
        })
    }

    pub fn update_installation(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UpdateAdapterInstallationCommand>,
    ) -> Result<CommandExecution> {
        validate_installation(
            &envelope.payload.executable_path,
            &envelope.payload.auth_scope,
        )?;
        validate_command_name(&envelope.payload.command_name)?;
        self.gateway.execute(database, envelope, |transaction| {
            let current = transaction
                .query_row(
                    "SELECT adapter_kind, version FROM adapter_installation WHERE id = ?1",
                    [&envelope.payload.installation_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .optional()?;
            let Some((adapter_kind, version)) = current else {
                return Ok(CommandHandlerResult::rejected(
                    "adapter_installation.not_found",
                    json!({ "installationId": envelope.payload.installation_id }),
                ));
            };
            if version != envelope.payload.expected_version {
                return Ok(version_conflict(version));
            }
            let conflict = transaction
                .query_row(
                    r#"
                    SELECT id FROM adapter_installation
                    WHERE adapter_kind = ?1 AND executable_path = ?2 AND auth_scope = ?3
                      AND id <> ?4
                      AND installation_class = 'custom'
                    "#,
                    params![
                        adapter_kind,
                        envelope.payload.executable_path,
                        envelope.payload.auth_scope,
                        envelope.payload.installation_id,
                    ],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if let Some(id) = conflict {
                return Ok(CommandHandlerResult::rejected(
                    "adapter_installation.already_exists",
                    json!({ "installationId": id }),
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE adapter_installation
                SET executable_path = ?2, command_name = ?3, source = ?4,
                    auth_scope = ?5, enabled = ?6,
                    path_state = 'valid', generation = generation + 1,
                    version = version + 1, updated_at = ?7
                WHERE id = ?1 AND version = ?8
                "#,
                params![
                    envelope.payload.installation_id,
                    envelope.payload.executable_path,
                    envelope.payload.command_name,
                    envelope.payload.source.as_str(),
                    envelope.payload.auth_scope,
                    envelope.payload.enabled,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            transaction.execute(
                r#"
                UPDATE adapter_capability_snapshot
                SET stale_at = COALESCE(stale_at, ?2),
                    last_error = 'installation_configuration_changed'
                WHERE installation_id = ?1
                "#,
                params![envelope.payload.installation_id, now],
            )?;
            Ok(CommandHandlerResult::applied(
                "adapter_installation.updated",
                json!({
                    "installationId": envelope.payload.installation_id,
                    "version": version + 1,
                }),
                Some(EntityReference {
                    entity_type: "adapter_installation".to_string(),
                    entity_id: envelope.payload.installation_id.clone(),
                }),
            ))
        })
    }

    pub fn record_snapshot(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RecordAdapterCapabilitySnapshotCommand>,
    ) -> Result<CommandExecution> {
        validate_snapshot(&envelope.payload.snapshot)?;
        let executable_identity = if envelope.payload.snapshot.probe_status == "ready" {
            database
                .connection()
                .query_row(
                    "SELECT executable_path FROM adapter_installation WHERE id = ?1",
                    [&envelope.payload.installation_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .and_then(|path| {
                    observe_executable_file_identity(Path::new(&path))
                        .ok()
                        .map(|identity| (path, identity))
                })
        } else {
            None
        };
        self.gateway.execute(database, envelope, |transaction| {
            let version = transaction
                .query_row(
                    "SELECT version FROM adapter_installation WHERE id = ?1",
                    [&envelope.payload.installation_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let Some(version) = version else {
                return Ok(CommandHandlerResult::rejected(
                    "adapter_installation.not_found",
                    json!({ "installationId": envelope.payload.installation_id }),
                ));
            };
            if version != envelope.payload.expected_installation_version {
                return Ok(version_conflict(version));
            }
            let snapshot = &envelope.payload.snapshot;
            let successful = snapshot.probe_status == "ready";
            let previous_fingerprint = transaction
                .query_row(
                    r#"
                    SELECT executable_fingerprint
                    FROM adapter_capability_snapshot
                    WHERE installation_id = ?1
                    "#,
                    [&envelope.payload.installation_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten();
            let failure_class = if successful {
                "none"
            } else if snapshot.probe_status == "not_installed" {
                "path_missing"
            } else if snapshot.probe_status == "authentication_required" {
                "authentication_required"
            } else if snapshot.probe_status == "missing_capabilities" {
                "incompatible"
            } else if previous_fingerprint.is_some()
                && snapshot.executable_fingerprint.is_some()
                && previous_fingerprint != snapshot.executable_fingerprint
            {
                "identity_changed"
            } else {
                "transient"
            };
            let diagnostic_code = probe_diagnostic_code(&snapshot.probe_status, failure_class);
            let candidate_path = transaction.query_row(
                "SELECT executable_path FROM adapter_installation WHERE id = ?1",
                [&envelope.payload.installation_id],
                |row| row.get::<_, String>(0),
            )?;
            let retry_after = if successful {
                None
            } else {
                next_probe_retry_after(
                    transaction,
                    &envelope.payload.installation_id,
                    failure_class,
                )?
            };
            transaction.execute(
                r#"
                INSERT INTO adapter_probe_attempt(
                    id, installation_id, status, failure_class,
                    diagnostic_code, candidate_path, executable_fingerprint,
                    attempted_at, retry_after
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                "#,
                params![
                    format!("adapter-probe-{}", Uuid::new_v4()),
                    envelope.payload.installation_id,
                    if successful { "ready" } else { "failed" },
                    failure_class,
                    diagnostic_code,
                    candidate_path,
                    snapshot.executable_fingerprint,
                    snapshot.last_attempted_at,
                    retry_after,
                ],
            )?;
            if successful {
                transaction.execute(
                    r#"
                    INSERT INTO adapter_capability_snapshot(
                        installation_id, reported_version, executable_fingerprint,
                        authentication_status, probe_status, permission_schema_version,
                        permission_schema_digest,
                        capabilities_json, protocols_json, model_catalog_json,
                        permission_options_json, observed_at, last_attempted_at,
                        last_successful_probe_at, stale_at, last_error,
                        native_session_compatibility_key
                    ) VALUES (
                        ?1, ?2, ?3, ?4, 'ready', ?5, ?6, ?7, ?8, ?9,
                        ?10, ?11, ?12, ?12, NULL, NULL, ?13
                    )
                    ON CONFLICT(installation_id) DO UPDATE SET
                        reported_version = excluded.reported_version,
                        executable_fingerprint = excluded.executable_fingerprint,
                        authentication_status = excluded.authentication_status,
                        probe_status = 'ready',
                        permission_schema_version = excluded.permission_schema_version,
                        permission_schema_digest = excluded.permission_schema_digest,
                        capabilities_json = excluded.capabilities_json,
                        protocols_json = excluded.protocols_json,
                        model_catalog_json = excluded.model_catalog_json,
                        permission_options_json = excluded.permission_options_json,
                        observed_at = excluded.observed_at,
                        last_attempted_at = excluded.last_attempted_at,
                        last_successful_probe_at = excluded.last_successful_probe_at,
                        stale_at = NULL,
                        last_error = NULL,
                        native_session_compatibility_key =
                            excluded.native_session_compatibility_key
                    "#,
                    params![
                        envelope.payload.installation_id,
                        snapshot.reported_version,
                        snapshot.executable_fingerprint,
                        snapshot.authentication_status,
                        snapshot.permission_schema_version,
                        snapshot.permission_schema_digest,
                        serde_json::to_string(&snapshot.capabilities)?,
                        serde_json::to_string(&snapshot.protocols)?,
                        serde_json::to_string(&snapshot.models)?,
                        serde_json::to_string(&snapshot.permission_options)?,
                        snapshot.observed_at,
                        snapshot.last_attempted_at,
                        snapshot.native_session_compatibility_key,
                    ],
                )?;
                if let (Some((executable_path, identity)), Some(executable_fingerprint)) = (
                    executable_identity.as_ref(),
                    snapshot.executable_fingerprint.as_deref(),
                ) {
                    upsert_runtime_executable_identity(
                        transaction,
                        &envelope.payload.installation_id,
                        executable_path,
                        executable_fingerprint,
                        identity,
                        &snapshot.last_attempted_at,
                    )?;
                }
                transaction.execute(
                    r#"
                    UPDATE adapter_installation
                    SET path_state = 'valid', updated_at = ?2
                    WHERE id = ?1
                    "#,
                    params![envelope.payload.installation_id, snapshot.last_attempted_at],
                )?;
            } else if failure_class != "transient" {
                transaction.execute(
                    r#"
                    UPDATE adapter_capability_snapshot
                    SET stale_at = COALESCE(stale_at, ?2),
                        last_error = ?3
                    WHERE installation_id = ?1
                    "#,
                    params![
                        envelope.payload.installation_id,
                        snapshot.last_attempted_at,
                        diagnostic_code,
                    ],
                )?;
                if failure_class == "path_missing" {
                    transaction.execute(
                        r#"
                        UPDATE adapter_installation
                        SET path_state = 'path_missing', updated_at = ?2
                        WHERE id = ?1
                        "#,
                        params![envelope.payload.installation_id, snapshot.last_attempted_at],
                    )?;
                }
            }
            Ok(CommandHandlerResult::applied(
                if successful {
                    "adapter_installation.snapshot_recorded"
                } else {
                    "adapter_installation.probe_attempt_recorded"
                },
                json!({
                    "installationId": envelope.payload.installation_id,
                    "probeStatus": snapshot.probe_status,
                    "failureClass": failure_class,
                }),
                Some(EntityReference {
                    entity_type: "adapter_installation".to_string(),
                    entity_id: envelope.payload.installation_id.clone(),
                }),
            ))
        })
    }

    fn materialize_profile(
        &self,
        database: &Database,
        raw: RawAgentProfile,
    ) -> Result<AgentProfileView> {
        let default_capabilities = serde_json::from_str(&raw.default_capabilities_json)
            .context("invalid AgentProfile default capabilities")?;
        let personality_traits = serde_json::from_str(&raw.personality_traits_json)
            .context("invalid AgentProfile personality traits")?;
        let resolved_runtime_binding = match (
            raw.selected_runtime_adapter_kind,
            raw.installation_id,
            raw.model_selection_json,
            raw.permission_config_json,
        ) {
            (None, None, None, None) => None,
            (Some(adapter_kind), Some(installation_id), Some(model), Some(permissions)) => {
                Some(ResolvedRuntimeBinding {
                    adapter_kind: AdapterKind::from_str(&adapter_kind)?,
                    installation_id,
                    model: serde_json::from_str(&model)
                        .context("invalid AgentProfile model selection")?,
                    permissions: serde_json::from_str(&permissions)
                        .context("invalid AgentProfile permission configuration")?,
                })
            }
            _ => anyhow::bail!("AgentProfile Runtime configuration must be complete or absent"),
        };
        let runtime_readiness = runtime_readiness(database, resolved_runtime_binding.as_ref())?;
        let runtime_configuration =
            resolved_runtime_binding
                .as_ref()
                .map(|binding| MemberRuntimeConfiguration {
                    adapter_kind: binding.adapter_kind,
                    model: binding.model.clone(),
                    permissions: binding.permissions.clone(),
                });
        Ok(AgentProfileView {
            agent_id: raw.id,
            display_name: raw.display_name,
            avatar_ref: raw.avatar_ref,
            accent: raw.accent,
            team_role: raw.team_role,
            professional_responsibilities: raw.professional_responsibilities,
            personality_traits,
            working_principles: raw.working_principles,
            growth_topic: raw.growth_topic,
            default_capabilities,
            presence: raw.presence,
            runtime_configuration,
            runtime_readiness,
            member_order: raw.member_order,
            version: raw.version,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            removed_at: raw.removed_at,
        })
    }
}

#[derive(Debug)]
struct RawAgentProfile {
    id: String,
    display_name: String,
    avatar_ref: Option<String>,
    accent: Option<String>,
    team_role: String,
    professional_responsibilities: String,
    personality_traits_json: String,
    working_principles: String,
    growth_topic: String,
    default_capabilities_json: String,
    presence: String,
    selected_runtime_adapter_kind: Option<String>,
    installation_id: Option<String>,
    model_selection_json: Option<String>,
    permission_config_json: Option<String>,
    member_order: i64,
    version: i64,
    created_at: String,
    updated_at: String,
    removed_at: Option<String>,
}

fn raw_agent_profile_from_row(row: &Row<'_>) -> rusqlite::Result<RawAgentProfile> {
    let selected_runtime_adapter_kind = row.get::<_, Option<String>>(11)?;
    let installation_id = row.get::<_, Option<String>>(12)?;
    let model_selection_json = row.get::<_, Option<String>>(13)?;
    let permission_config_json = row.get::<_, Option<String>>(14)?;
    Ok(RawAgentProfile {
        id: row.get(0)?,
        display_name: row.get(1)?,
        avatar_ref: row.get(2)?,
        accent: row.get(3)?,
        team_role: row.get(4)?,
        professional_responsibilities: row.get(5)?,
        personality_traits_json: row.get(6)?,
        working_principles: row.get(7)?,
        growth_topic: row.get(8)?,
        default_capabilities_json: row.get(9)?,
        presence: row.get(10)?,
        selected_runtime_adapter_kind,
        installation_id,
        model_selection_json,
        permission_config_json,
        member_order: row.get(19)?,
        version: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        removed_at: row.get(18)?,
    })
}

fn installation_from_row(row: &Row<'_>) -> rusqlite::Result<AdapterInstallationView> {
    let adapter_kind = AdapterKind::from_str(&row.get::<_, String>(1)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, error.into())
    })?;
    let installation_class =
        InstallationClass::from_str(&row.get::<_, String>(4)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, error.into())
        })?;
    let source = InstallationSource::from_str(&row.get::<_, String>(5)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, error.into())
    })?;
    let probe_status = row.get::<_, Option<String>>(16)?;
    let snapshot = if let Some(probe_status) = probe_status {
        let capabilities = decode_json_column::<Vec<String>>(row, 19)?;
        let protocols = decode_json_column::<Vec<String>>(row, 20)?;
        let models = decode_json_column::<Vec<ModelDescriptor>>(row, 21)?;
        let permission_options = decode_json_column::<Vec<PermissionOptionDescriptor>>(row, 22)?;
        Some(AdapterCapabilitySnapshot {
            reported_version: row.get(13)?,
            executable_fingerprint: row.get(14)?,
            authentication_status: row.get(15)?,
            probe_status,
            permission_schema_version: row.get(17)?,
            permission_schema_digest: row.get(18)?,
            capabilities,
            protocols,
            models,
            permission_options,
            observed_at: row.get(23)?,
            last_attempted_at: row.get(24)?,
            last_successful_probe_at: row.get(25)?,
            stale_at: row.get(26)?,
            last_error: row.get(27)?,
            native_session_compatibility_key: row.get(28)?,
        })
    } else {
        None
    };
    let last_probe_attempt = if let Some(id) = row.get::<_, Option<String>>(30)? {
        Some(AdapterProbeAttempt {
            id,
            installation_id: row.get(0)?,
            status: row.get(31)?,
            failure_class: row.get(32)?,
            diagnostic_code: row.get(33)?,
            candidate_path: row.get(34)?,
            executable_fingerprint: row.get(35)?,
            attempted_at: row.get(36)?,
            retry_after: row.get(37)?,
        })
    } else {
        None
    };
    Ok(AdapterInstallationView {
        id: row.get(0)?,
        adapter_kind,
        executable_path: row.get(2)?,
        command_name: row.get(3)?,
        installation_class,
        source,
        auth_scope: row.get(6)?,
        enabled: row.get(7)?,
        generation: row.get(8)?,
        path_state: row.get(9)?,
        version: row.get(10)?,
        referenced_profile_count: row.get(29)?,
        snapshot,
        member_runtime_defaults: None,
        last_probe_attempt,
        relocation_history: Vec::new(),
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn relocation_history(
    database: &Database,
    installation_id: &str,
    limit: i64,
) -> Result<Vec<AdapterRelocationAudit>> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT id, installation_id, previous_path, next_path,
               previous_fingerprint, next_fingerprint, source,
               result, diagnostic_code, created_at
        FROM adapter_relocation_audit
        WHERE installation_id = ?1
        ORDER BY created_at DESC, id DESC
        LIMIT ?2
        "#,
    )?;
    let rows = statement.query_map(params![installation_id, limit], |row| {
        let source = row
            .get::<_, Option<String>>(6)?
            .map(|value| {
                InstallationSource::from_str(&value).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        6,
                        rusqlite::types::Type::Text,
                        error.into(),
                    )
                })
            })
            .transpose()?;
        Ok(AdapterRelocationAudit {
            id: row.get(0)?,
            installation_id: row.get(1)?,
            previous_path: row.get(2)?,
            next_path: row.get(3)?,
            previous_fingerprint: row.get(4)?,
            next_fingerprint: row.get(5)?,
            source,
            result: row.get(7)?,
            diagnostic_code: row.get(8)?,
            created_at: row.get(9)?,
        })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to list Adapter relocation audit")
}

fn upsert_successful_capability_snapshot(
    transaction: &Transaction<'_>,
    installation_id: &str,
    snapshot: &AdapterCapabilitySnapshot,
) -> Result<()> {
    if snapshot.probe_status != "ready" {
        anyhow::bail!("only a successful probe can replace the capability snapshot");
    }
    transaction.execute(
        r#"
        INSERT INTO adapter_capability_snapshot(
            installation_id, reported_version, executable_fingerprint,
            authentication_status, probe_status, permission_schema_version,
            permission_schema_digest,
            capabilities_json, protocols_json, model_catalog_json,
            permission_options_json, observed_at, last_attempted_at,
            last_successful_probe_at, stale_at, last_error,
            native_session_compatibility_key
        ) VALUES (
            ?1, ?2, ?3, ?4, 'ready', ?5, ?6, ?7, ?8, ?9,
            ?10, ?11, ?12, ?12, NULL, NULL, ?13
        )
        ON CONFLICT(installation_id) DO UPDATE SET
            reported_version = excluded.reported_version,
            executable_fingerprint = excluded.executable_fingerprint,
            authentication_status = excluded.authentication_status,
            probe_status = 'ready',
            permission_schema_version = excluded.permission_schema_version,
            permission_schema_digest = excluded.permission_schema_digest,
            capabilities_json = excluded.capabilities_json,
            protocols_json = excluded.protocols_json,
            model_catalog_json = excluded.model_catalog_json,
            permission_options_json = excluded.permission_options_json,
            observed_at = excluded.observed_at,
            last_attempted_at = excluded.last_attempted_at,
            last_successful_probe_at = excluded.last_successful_probe_at,
            stale_at = NULL,
            last_error = NULL,
            native_session_compatibility_key =
                excluded.native_session_compatibility_key
        "#,
        params![
            installation_id,
            snapshot.reported_version,
            snapshot.executable_fingerprint,
            snapshot.authentication_status,
            snapshot.permission_schema_version,
            snapshot.permission_schema_digest,
            serde_json::to_string(&snapshot.capabilities)?,
            serde_json::to_string(&snapshot.protocols)?,
            serde_json::to_string(&snapshot.models)?,
            serde_json::to_string(&snapshot.permission_options)?,
            snapshot.observed_at,
            snapshot.last_attempted_at,
            snapshot.native_session_compatibility_key,
        ],
    )?;
    Ok(())
}

fn upsert_runtime_executable_identity(
    transaction: &Transaction<'_>,
    installation_id: &str,
    executable_path: &str,
    executable_fingerprint: &str,
    identity: &ExecutableFileIdentity,
    verified_at: &str,
) -> Result<()> {
    let byte_size = i64::try_from(identity.byte_size)
        .context("Runtime executable size exceeds SQLite range")?;
    transaction.execute(
        r#"
        INSERT INTO runtime_executable_identity(
            installation_id, executable_path, executable_fingerprint,
            byte_size, modified_at_unix_nanos, file_id, verified_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(installation_id) DO UPDATE SET
            executable_path = excluded.executable_path,
            executable_fingerprint = excluded.executable_fingerprint,
            byte_size = excluded.byte_size,
            modified_at_unix_nanos = excluded.modified_at_unix_nanos,
            file_id = excluded.file_id,
            verified_at = excluded.verified_at
        "#,
        params![
            installation_id,
            executable_path,
            executable_fingerprint,
            byte_size,
            identity.modified_at_unix_nanos,
            identity.file_id,
            verified_at,
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_probe_attempt(
    transaction: &Transaction<'_>,
    installation_id: &str,
    status: &str,
    failure_class: &str,
    diagnostic_code: Option<&str>,
    candidate_path: &str,
    executable_fingerprint: Option<&str>,
    attempted_at: &str,
    retry_after: Option<&str>,
) -> Result<()> {
    transaction.execute(
        r#"
        INSERT INTO adapter_probe_attempt(
            id, installation_id, status, failure_class,
            diagnostic_code, candidate_path, executable_fingerprint,
            attempted_at, retry_after
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            format!("adapter-probe-{}", Uuid::new_v4()),
            installation_id,
            status,
            failure_class,
            diagnostic_code,
            candidate_path,
            executable_fingerprint,
            attempted_at,
            retry_after,
        ],
    )?;
    Ok(())
}

fn next_probe_retry_after(
    transaction: &Transaction<'_>,
    installation_id: &str,
    failure_class: &str,
) -> Result<Option<String>> {
    if failure_class == "none" {
        return Ok(None);
    }
    let consecutive_failures: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*)
        FROM adapter_probe_attempt AS failed
        WHERE failed.installation_id = ?1
          AND failed.status = 'failed'
          AND failed.attempted_at > COALESCE((
              SELECT MAX(succeeded.attempted_at)
              FROM adapter_probe_attempt AS succeeded
              WHERE succeeded.installation_id = ?1
                AND succeeded.status = 'ready'
          ), '')
        "#,
        [installation_id],
        |row| row.get(0),
    )?;
    let exponent =
        u32::try_from(consecutive_failures.clamp(0, 8)).context("probe retry exponent overflow")?;
    let delay_seconds = (60_i64.saturating_mul(1_i64 << exponent)).min(6 * 60 * 60);
    Ok(Some(
        (chrono::Utc::now() + chrono::Duration::seconds(delay_seconds)).to_rfc3339(),
    ))
}

fn decode_json_column<T>(row: &Row<'_>, index: usize) -> rusqlite::Result<T>
where
    T: serde::de::DeserializeOwned,
{
    let json = row.get::<_, String>(index)?;
    serde_json::from_str(&json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, error.into())
    })
}

pub fn resolve_frozen_runtime(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    agent_id: &str,
) -> Result<std::result::Result<FrozenAgentRuntimeConfig, RuntimeConfigurationBlocker>> {
    let profile = transaction
        .query_row(
            r#"
            SELECT agent_profile.profile_status,
                   agent_profile.selected_runtime_adapter_kind,
                   agent_profile.default_runtime_installation_id,
                   agent_profile.default_model_selection_json,
                   agent_profile.default_permission_config_json,
                   conversation.provider_override, conversation.model_override
            FROM conversation
            JOIN agent_profile ON agent_profile.id = conversation.agent_id
            WHERE conversation.id = ?1 AND conversation.agent_id = ?2
            "#,
            params![conversation_id, agent_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((
        status,
        selected_runtime_adapter_kind,
        installation_id,
        model_json,
        permissions_json,
        provider_override,
        model_override,
    )) = profile
    else {
        return Ok(Err(runtime_blocker(
            "agent_unavailable",
            json!({ "agentId": agent_id }),
        )));
    };
    if status != "present" {
        return Ok(Err(runtime_blocker(
            if status == "away" {
                "member_away"
            } else {
                "member_removed"
            },
            json!({ "agentId": agent_id, "presence": status }),
        )));
    }
    if provider_override
        .as_deref()
        .is_some_and(|value| !value.is_empty())
        || model_override
            .as_deref()
            .is_some_and(|value| !value.is_empty())
    {
        return Ok(Err(runtime_blocker(
            "conversation_runtime_override_unsupported",
            json!({ "conversationId": conversation_id }),
        )));
    }
    let (selected_runtime_adapter_kind, installation_id, model_json, permissions_json) = match (
        selected_runtime_adapter_kind,
        installation_id,
        model_json,
        permissions_json,
    ) {
        (None, None, None, None) => {
            return Ok(Err(runtime_blocker(
                "runtime_not_configured",
                json!({ "agentId": agent_id }),
            )));
        }
        (Some(adapter_kind), Some(installation_id), Some(model), Some(permissions)) => {
            (adapter_kind, installation_id, model, permissions)
        }
        _ => {
            return Ok(Err(runtime_blocker(
                "runtime_configuration_invalid",
                json!({ "agentId": agent_id }),
            )));
        }
    };
    let binding = ResolvedRuntimeBinding {
        adapter_kind: AdapterKind::from_str(&selected_runtime_adapter_kind)?,
        installation_id: installation_id.clone(),
        model: serde_json::from_str(&model_json).context("invalid saved model selection")?,
        permissions: serde_json::from_str(&permissions_json)
            .context("invalid saved permission configuration")?,
    };
    if binding.permissions.adapter_kind != binding.adapter_kind {
        return Ok(Err(runtime_blocker(
            "runtime_configuration_adapter_mismatch",
            json!({
                "agentId": agent_id,
                "adapterKind": selected_runtime_adapter_kind,
            }),
        )));
    }
    resolve_frozen_runtime_binding(transaction, &binding)
}

pub(crate) fn resolve_frozen_runtime_binding(
    transaction: &Transaction<'_>,
    binding: &ResolvedRuntimeBinding,
) -> Result<std::result::Result<FrozenAgentRuntimeConfig, RuntimeConfigurationBlocker>> {
    let installation_id = binding.installation_id.clone();
    let installation = transaction
        .query_row(
            r#"
            SELECT installation.adapter_kind, installation.executable_path,
                   installation.auth_scope, installation.generation,
                   installation.enabled,
                   snapshot.reported_version, snapshot.executable_fingerprint,
                   snapshot.authentication_status, snapshot.probe_status,
                   snapshot.permission_schema_version,
                   snapshot.capabilities_json, snapshot.protocols_json,
                   snapshot.model_catalog_json, snapshot.permission_options_json,
                   snapshot.stale_at, snapshot.native_session_compatibility_key,
                   COALESCE((
                       SELECT generation
                       FROM runtime_search_environment_state
                       WHERE singleton = 1
                   ), 0)
            FROM adapter_installation AS installation
            LEFT JOIN adapter_capability_snapshot AS snapshot
              ON snapshot.installation_id = installation.id
            WHERE installation.id = ?1
            "#,
            [&installation_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, bool>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<i64>>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, Option<String>>(13)?,
                    row.get::<_, Option<String>>(14)?,
                    row.get::<_, Option<String>>(15)?,
                    row.get::<_, i64>(16)?,
                ))
            },
        )
        .optional()?;
    let Some((
        adapter_kind,
        executable_path,
        auth_scope,
        installation_generation,
        enabled,
        reported_version,
        executable_fingerprint,
        authentication_status,
        probe_status,
        permission_schema_version,
        capabilities_json,
        protocols_json,
        models_json,
        permission_options_json,
        _stale_at,
        native_session_compatibility_key,
        search_environment_generation,
    )) = installation
    else {
        return Ok(Err(runtime_blocker(
            "adapter_installation_missing",
            json!({ "installationId": installation_id }),
        )));
    };
    if !enabled {
        return Ok(Err(runtime_blocker(
            "adapter_installation_disabled",
            json!({ "installationId": installation_id }),
        )));
    }
    if authentication_status.as_deref() == Some("authentication_required") {
        return Ok(Err(runtime_blocker(
            "runtime_authentication_required",
            json!({ "installationId": installation_id }),
        )));
    }
    if probe_status.as_deref() != Some("ready") {
        return Ok(Err(runtime_blocker(
            "runtime_probe_required",
            json!({
                "installationId": installation_id,
                "probeStatus": probe_status,
            }),
        )));
    }
    let (
        Some(reported_version),
        Some(executable_fingerprint),
        Some(permission_schema_version),
        Some(capabilities_json),
        Some(protocols_json),
        Some(models_json),
        Some(permission_options_json),
    ) = (
        reported_version,
        executable_fingerprint,
        permission_schema_version,
        capabilities_json,
        protocols_json,
        models_json,
        permission_options_json,
    )
    else {
        return Ok(Err(runtime_blocker(
            "runtime_probe_required",
            json!({ "installationId": installation_id }),
        )));
    };
    if let Some(issue) = runtime_configuration_issue(
        &models_json,
        permission_schema_version,
        &permission_options_json,
        binding,
    )? {
        return Ok(Err(runtime_blocker(issue.code, issue.payload)));
    }

    let adapter_kind = AdapterKind::from_str(&adapter_kind)?;
    if adapter_kind != binding.adapter_kind || adapter_kind != binding.permissions.adapter_kind {
        return Ok(Err(runtime_blocker(
            "runtime_permission_adapter_mismatch",
            json!({ "installationId": installation_id }),
        )));
    }
    let models: Vec<ModelDescriptor> =
        serde_json::from_str(&models_json).context("invalid Adapter model catalog")?;
    let model = match resolve_model_selection(&models, &binding.model)? {
        Ok(model) => model,
        Err(blocker) => return Ok(Err(blocker)),
    };
    let mut capabilities: Vec<String> =
        serde_json::from_str(&capabilities_json).context("invalid Adapter capabilities")?;
    capabilities.sort();
    capabilities.dedup();
    let protocols: Vec<String> =
        serde_json::from_str(&protocols_json).context("invalid Adapter protocols")?;
    let permission_descriptors: Vec<PermissionOptionDescriptor> =
        serde_json::from_str(&permission_options_json)
            .context("invalid Adapter permission descriptors")?;
    let projection = match AgentRuntimeAdapterRegistry::default().resolve_runtime(
        adapter_kind,
        AdapterRuntimeResolutionInput {
            installation_id: &installation_id,
            executable_path: &executable_path,
            auth_scope: &auth_scope,
            executable_fingerprint: &executable_fingerprint,
            protocols: &protocols,
            native_session_compatibility_key: native_session_compatibility_key.as_deref(),
            permissions: &binding.permissions,
            permission_descriptors: &permission_descriptors,
        },
    ) {
        Ok(projection) => projection,
        Err(error) => {
            return Ok(Err(runtime_blocker(
                "runtime_adapter_not_implemented",
                json!({
                    "adapterKind": adapter_kind,
                    "detail": error.to_string(),
                }),
            )));
        }
    };
    let mut frozen = FrozenAgentRuntimeConfig {
        adapter_kind,
        installation_id,
        installation_generation,
        search_environment_generation,
        executable_path,
        auth_scope,
        reported_version,
        executable_fingerprint,
        capabilities,
        protocol_version: projection.protocol_version,
        model,
        permissions: binding.permissions.clone(),
        native_session_compatibility_key,
        binding_compatibility_digest: projection.binding_compatibility_digest,
        host_config_digest: projection.host_config_digest,
        config_digest: String::new(),
    };
    frozen.config_digest = canonical_json_digest(&serde_json::to_value(&frozen)?)?;
    Ok(Ok(frozen))
}

fn resolve_model_selection(
    models: &[ModelDescriptor],
    selection: &ModelSelection,
) -> Result<std::result::Result<ResolvedModelSelection, RuntimeConfigurationBlocker>> {
    let (source, model, configured_options) = match selection {
        ModelSelection::RuntimeDefault => {
            let Some(model) = models
                .iter()
                .find(|model| model.is_default && !model.hidden && !model.deprecated)
            else {
                return Ok(Err(runtime_blocker(
                    "runtime_default_model_unavailable",
                    json!({}),
                )));
            };
            ("runtime_default", model, None)
        }
        ModelSelection::Explicit { model_id, options } => {
            let Some(model) = models
                .iter()
                .find(|model| model.id == *model_id && !model.hidden && !model.deprecated)
            else {
                return Ok(Err(runtime_blocker(
                    "runtime_model_unavailable",
                    json!({ "modelId": model_id }),
                )));
            };
            ("explicit", model, Some(options))
        }
    };
    let mut options = serde_json::Map::new();
    let configured_options = configured_options.and_then(Value::as_object);
    for descriptor in &model.options {
        if let Some(value) = configured_options.and_then(|values| values.get(&descriptor.key)) {
            options.insert(descriptor.key.clone(), value.clone());
        } else if let Some(default_value) = &descriptor.default_value {
            options.insert(descriptor.key.clone(), Value::String(default_value.clone()));
        }
    }
    Ok(Ok(ResolvedModelSelection {
        source: source.to_string(),
        model_id: model.id.clone(),
        options: Value::Object(options),
    }))
}

fn runtime_blocker(code: &str, payload: Value) -> RuntimeConfigurationBlocker {
    RuntimeConfigurationBlocker {
        code: code.to_string(),
        payload,
    }
}

#[cfg(test)]
pub(crate) fn configure_test_runtime(database: &Database, agent_ids: &[&str]) {
    let now = chrono::Utc::now().to_rfc3339();
    let installation_id = "adapter-test-codex";
    let executable_path = std::env::current_exe()
        .expect("test executable path should be available")
        .to_string_lossy()
        .to_string();
    let executable_fingerprint =
        crate::agent_runtime_adapter::executable_fingerprint(Path::new(&executable_path))
            .expect("test executable should be fingerprinted");
    database
        .connection()
        .execute(
            r#"
            INSERT OR IGNORE INTO adapter_installation(
                id, adapter_kind, executable_path, command_name,
                installation_class, source, auth_scope,
                enabled, version, created_at, updated_at
            ) VALUES (?1, 'codex-cli', ?2, 'codex', 'managed_default', 'custom',
                      'test-user', 1, 1, ?3, ?3)
            "#,
            params![installation_id, executable_path, now],
        )
        .expect("test Adapter installation should be inserted");
    let models = vec![ModelDescriptor {
        id: "gpt-test".to_string(),
        display_name: "GPT Test".to_string(),
        is_default: true,
        hidden: false,
        deprecated: false,
        options: vec![ModelOptionDescriptor {
            key: "reasoning_effort".to_string(),
            label: "Reasoning effort".to_string(),
            value_type: "enum".to_string(),
            values: vec![ValueChoice {
                value: "high".to_string(),
                label: "High".to_string(),
            }],
            default_value: Some("high".to_string()),
            scope: RuntimeOptionScope::Run,
        }],
    }];
    let permissions = vec![
        PermissionOptionDescriptor {
            key: "sandbox_mode".to_string(),
            label: "sandbox_mode".to_string(),
            description: String::new(),
            value_type: "enum".to_string(),
            choices: vec![ValueChoice {
                value: "workspace-write".to_string(),
                label: "workspace-write".to_string(),
            }],
            recommended_value: json!("workspace-write"),
            scope: RuntimeOptionScope::Session,
            risk: "normal".to_string(),
            supported: true,
            required: true,
            unsupported_reason: None,
        },
        PermissionOptionDescriptor {
            key: "approval_policy".to_string(),
            label: "approval_policy".to_string(),
            description: String::new(),
            value_type: "enum".to_string(),
            choices: vec![ValueChoice {
                value: "on-request".to_string(),
                label: "on-request".to_string(),
            }],
            recommended_value: json!("on-request"),
            scope: RuntimeOptionScope::Session,
            risk: "normal".to_string(),
            supported: true,
            required: true,
            unsupported_reason: None,
        },
    ];
    database
        .connection()
        .execute(
            r#"
            INSERT OR REPLACE INTO adapter_capability_snapshot(
                installation_id, reported_version, executable_fingerprint,
                authentication_status, probe_status, permission_schema_version,
                capabilities_json, protocols_json, model_catalog_json,
                permission_options_json, observed_at, last_attempted_at,
                stale_at, last_error
            ) VALUES (?1, 'codex-cli test', ?2, 'authenticated',
                      'ready', 1, ?3, ?4, ?5, ?6, ?7, ?7, NULL, NULL)
            "#,
            params![
                installation_id,
                executable_fingerprint,
                serde_json::to_string(&vec![
                    "app_server.initialize",
                    "model.list",
                    "structured_permission_request"
                ])
                .unwrap(),
                serde_json::to_string(&vec!["codex-app-server-v2"]).unwrap(),
                serde_json::to_string(&models).unwrap(),
                serde_json::to_string(&permissions).unwrap(),
                now,
            ],
        )
        .expect("test Adapter snapshot should be inserted");
    let model = serde_json::to_string(&ModelSelection::RuntimeDefault).unwrap();
    let permissions = serde_json::to_string(&AdapterPermissionConfig {
        adapter_kind: AdapterKind::CodexCli,
        schema_version: 1,
        values: json!({
            "sandbox_mode": "workspace-write",
            "approval_policy": "on-request",
        }),
    })
    .unwrap();
    for agent_id in agent_ids {
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_profile
                SET selected_runtime_adapter_kind = 'codex-cli',
                    default_runtime_installation_id = ?2,
                    default_model_selection_json = ?3,
                    default_permission_config_json = ?4
                WHERE id = ?1
                "#,
                params![agent_id, installation_id, model, permissions],
            )
            .expect("test AgentProfile Runtime should be configured");
    }
}

fn runtime_readiness(
    database: &Database,
    binding: Option<&ResolvedRuntimeBinding>,
) -> Result<RuntimeReadiness> {
    let Some(binding) = binding else {
        return Ok(RuntimeReadiness {
            status: RuntimeReadinessStatus::RuntimeNotConfigured,
            blockers: vec![RuntimeReadinessBlocker {
                code: "runtime_not_configured".to_string(),
                detail: None,
            }],
        });
    };
    let installation = database
        .connection()
        .query_row(
            r#"
            SELECT installation.adapter_kind, installation.enabled,
                   snapshot.authentication_status, snapshot.probe_status,
                   snapshot.stale_at, snapshot.permission_schema_version,
                   snapshot.model_catalog_json, snapshot.permission_options_json,
                   snapshot.executable_fingerprint
            FROM adapter_installation AS installation
            LEFT JOIN adapter_capability_snapshot AS snapshot
              ON snapshot.installation_id = installation.id
            WHERE installation.id = ?1
            "#,
            [&binding.installation_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, bool>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                ))
            },
        )
        .optional()?;
    let Some((
        adapter_kind,
        enabled,
        authentication_status,
        probe_status,
        stale_at,
        permission_schema_version,
        model_catalog_json,
        permission_options_json,
        executable_fingerprint,
    )) = installation
    else {
        return Ok(needs_attention("adapter_installation_missing", None));
    };
    if !enabled {
        return Ok(needs_attention("adapter_installation_disabled", None));
    }
    let adapter_kind = AdapterKind::from_str(&adapter_kind)?;
    if binding.adapter_kind != adapter_kind {
        return Ok(needs_attention(
            "runtime_configuration_adapter_mismatch",
            None,
        ));
    }
    if binding.permissions.adapter_kind != adapter_kind {
        return Ok(needs_attention("runtime_permission_adapter_mismatch", None));
    }
    if stale_at.is_some() {
        return Ok(needs_attention("runtime_snapshot_stale", stale_at));
    }
    if authentication_status.as_deref() == Some("authentication_required") {
        return Ok(needs_attention("runtime_authentication_required", None));
    }
    let Some(probe_status) = probe_status else {
        return Ok(needs_attention("runtime_probe_required", None));
    };
    if probe_status != "ready" {
        return Ok(needs_attention(&format!("runtime_{probe_status}"), None));
    }
    if executable_fingerprint.is_none() {
        return Ok(needs_attention("runtime_probe_required", None));
    }
    // Profile reads and message admission stay free of executable I/O. The scheduler
    // validates the current installation state and lightweight executable identity
    // before it claims and starts the queued AgentRun.
    let Some(permission_schema_version) = permission_schema_version else {
        return Ok(needs_attention("runtime_probe_required", None));
    };
    let Some(model_catalog_json) = model_catalog_json else {
        return Ok(needs_attention("runtime_probe_required", None));
    };
    let Some(permission_options_json) = permission_options_json else {
        return Ok(needs_attention("runtime_probe_required", None));
    };
    if let Some(issue) = runtime_configuration_issue(
        &model_catalog_json,
        permission_schema_version,
        &permission_options_json,
        binding,
    )? {
        return Ok(needs_attention(issue.code, Some(issue.payload.to_string())));
    }
    Ok(RuntimeReadiness {
        status: RuntimeReadinessStatus::Ready,
        blockers: Vec::new(),
    })
}

fn needs_attention(code: &str, detail: Option<String>) -> RuntimeReadiness {
    RuntimeReadiness {
        status: RuntimeReadinessStatus::NeedsAttention,
        blockers: vec![RuntimeReadinessBlocker {
            code: code.to_string(),
            detail,
        }],
    }
}

struct ReadyManagedRuntimeSnapshot {
    installation_id: String,
    permission_schema_version: i64,
    models_json: String,
    permissions_json: String,
}

fn ready_managed_runtime_snapshot(
    transaction: &Transaction<'_>,
    adapter_kind: AdapterKind,
) -> Result<Option<ReadyManagedRuntimeSnapshot>> {
    transaction
        .query_row(
            r#"
            SELECT installation.id, snapshot.permission_schema_version,
                   snapshot.model_catalog_json, snapshot.permission_options_json
            FROM adapter_installation AS installation
            JOIN adapter_capability_snapshot AS snapshot
              ON snapshot.installation_id = installation.id
            WHERE installation.adapter_kind = ?1
              AND installation.auth_scope = 'default'
              AND installation.installation_class = 'managed_default'
              AND installation.enabled = 1
              AND installation.path_state = 'valid'
              AND snapshot.probe_status = 'ready'
              AND snapshot.stale_at IS NULL
              AND snapshot.authentication_status = 'authenticated'
            "#,
            [adapter_kind.as_str()],
            |row| {
                Ok(ReadyManagedRuntimeSnapshot {
                    installation_id: row.get(0)?,
                    permission_schema_version: row.get(1)?,
                    models_json: row.get(2)?,
                    permissions_json: row.get(3)?,
                })
            },
        )
        .optional()
        .context("failed to load ready managed Runtime snapshot")
}

fn probe_diagnostic_code(probe_status: &str, failure_class: &str) -> Option<&'static str> {
    match (probe_status, failure_class) {
        ("ready", _) => None,
        (_, "path_missing") => Some("runtime_path_missing"),
        (_, "identity_changed") => Some("runtime_identity_changed"),
        (_, "authentication_required") => Some("runtime_authentication_required"),
        (_, "incompatible") => Some("runtime_capability_incompatible"),
        _ => Some("runtime_probe_transient_failure"),
    }
}

#[derive(Debug)]
struct NormalizedMemberIdentity {
    display_name: String,
    team_role: String,
    professional_responsibilities: String,
    personality_traits: Vec<String>,
    working_principles: String,
    growth_topic: String,
}

pub(crate) fn validate_stored_member_identity(
    display_name: &str,
    team_role: &str,
    professional_responsibilities: &str,
    personality_traits: &[String],
    working_principles: &str,
    growth_topic: &str,
) -> Result<()> {
    let normalized = normalize_member_identity(
        display_name,
        team_role,
        professional_responsibilities,
        personality_traits,
        working_principles,
        growth_topic,
    )?;
    if normalized.display_name != display_name
        || normalized.team_role != team_role
        || normalized.professional_responsibilities != professional_responsibilities
        || normalized.personality_traits != personality_traits
        || normalized.working_principles != working_principles
        || normalized.growth_topic != growth_topic
    {
        anyhow::bail!("stored AgentProfile Member Identity is not normalized");
    }
    Ok(())
}

fn normalize_member_identity(
    display_name: &str,
    team_role: &str,
    professional_responsibilities: &str,
    personality_traits: &[String],
    working_principles: &str,
    growth_topic: &str,
) -> Result<NormalizedMemberIdentity> {
    let display_name = display_name.trim().to_string();
    if display_name.is_empty() || display_name.chars().count() > 80 {
        anyhow::bail!("AgentProfile displayName must be 1-80 characters");
    }
    if team_role
        .chars()
        .any(|character| character == '\n' || character == '\r' || character.is_control())
    {
        anyhow::bail!("AgentProfile teamRole must be a single line without control characters");
    }
    let team_role = collapse_whitespace(team_role);
    if team_role.chars().count() > 120 {
        anyhow::bail!("AgentProfile teamRole must not exceed 120 characters");
    }
    let professional_responsibilities = professional_responsibilities.trim().to_string();
    let working_principles = working_principles.trim().to_string();
    let growth_topic = growth_topic.trim().to_string();
    for (field, value) in [
        (
            "professionalResponsibilities",
            &professional_responsibilities,
        ),
        ("workingPrinciples", &working_principles),
        ("growthTopic", &growth_topic),
    ] {
        if value.chars().count() > 300 {
            anyhow::bail!("AgentProfile {field} must not exceed 300 characters");
        }
    }
    let mut normalized_traits = Vec::with_capacity(personality_traits.len());
    let mut seen = BTreeSet::new();
    for trait_value in personality_traits {
        if trait_value
            .chars()
            .any(|character| character == '\n' || character == '\r' || character.is_control())
        {
            anyhow::bail!(
                "AgentProfile personalityTraits must not contain newlines or control characters"
            );
        }
        let normalized = collapse_whitespace(trait_value);
        let length = normalized.chars().count();
        if !(1..=16).contains(&length) {
            anyhow::bail!("AgentProfile personality trait must be 1-16 characters");
        }
        if !seen.insert(normalized.to_lowercase()) {
            continue;
        }
        normalized_traits.push(normalized);
        if normalized_traits.len() > 6 {
            anyhow::bail!("AgentProfile personalityTraits must contain at most 6 tags");
        }
    }
    Ok(NormalizedMemberIdentity {
        display_name,
        team_role,
        professional_responsibilities,
        personality_traits: normalized_traits,
        working_principles,
        growth_topic,
    })
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn validate_command_name(command_name: &str) -> Result<()> {
    if command_name.trim().is_empty()
        || command_name.len() > 128
        || command_name.contains(['/', '\\', '\0'])
    {
        anyhow::bail!("Runtime commandName must be a plain command name");
    }
    Ok(())
}

struct RuntimeConfigurationIssue {
    code: &'static str,
    payload: Value,
}

fn runtime_configuration_issue(
    models_json: &str,
    permission_schema_version: i64,
    permissions_json: &str,
    configuration: &ResolvedRuntimeBinding,
) -> Result<Option<RuntimeConfigurationIssue>> {
    let issue = |code, payload| Some(RuntimeConfigurationIssue { code, payload });
    let models: Vec<ModelDescriptor> =
        serde_json::from_str(models_json).context("invalid Adapter model catalog")?;
    if matches!(configuration.model, ModelSelection::RuntimeDefault)
        && !models
            .iter()
            .any(|model| model.is_default && !model.hidden && !model.deprecated)
    {
        return Ok(issue("runtime_default_model_unavailable", json!({})));
    }
    if let ModelSelection::Explicit { model_id, options } = &configuration.model {
        if model_id.trim().is_empty() {
            return Ok(issue(
                "runtime_model_unavailable",
                json!({ "modelId": model_id }),
            ));
        }
        let Some(model) = models
            .iter()
            .find(|model| &model.id == model_id && !model.hidden && !model.deprecated)
        else {
            return Ok(issue(
                "runtime_model_unavailable",
                json!({ "modelId": model_id }),
            ));
        };
        let option_descriptors = model
            .options
            .iter()
            .map(|descriptor| (descriptor.key.as_str(), descriptor))
            .collect::<BTreeMap<_, _>>();
        let Some(options) = options.as_object() else {
            return Ok(issue(
                "runtime_model_options_invalid",
                json!({ "modelId": model_id }),
            ));
        };
        for (key, value) in options {
            let Some(descriptor) = option_descriptors.get(key.as_str()) else {
                return Ok(issue(
                    "runtime_model_option_unknown",
                    json!({ "modelId": model_id, "option": key }),
                ));
            };
            let valid = value.as_str().is_some_and(|value| {
                descriptor
                    .values
                    .iter()
                    .any(|candidate| candidate.value == value)
            });
            if !valid {
                return Ok(issue(
                    "runtime_model_option_invalid",
                    json!({ "modelId": model_id, "option": key, "value": value }),
                ));
            }
        }
    }

    if configuration.permissions.schema_version != permission_schema_version {
        return Ok(issue(
            "runtime_permission_schema_mismatch",
            json!({
                "configuredSchemaVersion": configuration.permissions.schema_version,
                "currentSchemaVersion": permission_schema_version,
            }),
        ));
    }
    let descriptors: Vec<PermissionOptionDescriptor> =
        serde_json::from_str(permissions_json).context("invalid Adapter permission descriptors")?;
    let descriptor_by_key = descriptors
        .iter()
        .map(|descriptor| (descriptor.key.as_str(), descriptor))
        .collect::<BTreeMap<_, _>>();
    let Some(values) = configuration.permissions.values.as_object() else {
        return Ok(issue("runtime_permission_values_invalid", json!({})));
    };
    for (key, value) in values {
        let Some(descriptor) = descriptor_by_key.get(key.as_str()) else {
            return Ok(issue(
                "runtime_permission_option_unknown",
                json!({ "option": key }),
            ));
        };
        if !descriptor.supported {
            return Ok(issue(
                "runtime_permission_option_unsupported",
                json!({
                    "option": key,
                    "reason": descriptor.unsupported_reason,
                }),
            ));
        }
        if !permission_value_matches_descriptor(value, descriptor) {
            return Ok(issue(
                "runtime_permission_value_invalid",
                json!({ "option": key, "value": value }),
            ));
        }
    }
    if let Some(missing) = descriptors.iter().find(|descriptor| {
        descriptor.supported && descriptor.required && !values.contains_key(&descriptor.key)
    }) {
        return Ok(issue(
            "runtime_permission_value_required",
            json!({ "option": missing.key }),
        ));
    }
    Ok(None)
}

fn member_runtime_defaults_for_snapshot(
    adapter_kind: AdapterKind,
    snapshot: &AdapterCapabilitySnapshot,
) -> Result<Option<MemberRuntimeConfiguration>> {
    if snapshot.probe_status != "ready"
        || snapshot.authentication_status != "authenticated"
        || snapshot.stale_at.is_some()
    {
        return Ok(None);
    }
    let model = ModelSelection::RuntimeDefault;
    let permissions = AdapterPermissionConfig {
        adapter_kind,
        schema_version: snapshot.permission_schema_version,
        values: AgentRuntimeAdapterRegistry::default().member_permission_defaults(adapter_kind),
    };
    let configuration = ResolvedRuntimeBinding {
        adapter_kind,
        installation_id: String::new(),
        model: model.clone(),
        permissions: permissions.clone(),
    };
    let models_json = serde_json::to_string(&snapshot.models)?;
    let permissions_json = serde_json::to_string(&snapshot.permission_options)?;
    if runtime_configuration_issue(
        &models_json,
        snapshot.permission_schema_version,
        &permissions_json,
        &configuration,
    )?
    .is_some()
    {
        return Ok(None);
    }
    Ok(Some(MemberRuntimeConfiguration {
        adapter_kind,
        model,
        permissions,
    }))
}

fn permission_value_matches_descriptor(
    value: &Value,
    descriptor: &PermissionOptionDescriptor,
) -> bool {
    match descriptor.value_type.as_str() {
        "boolean" => value.is_boolean(),
        "enum" => value.as_str().is_some_and(|value| {
            descriptor
                .choices
                .iter()
                .any(|candidate| candidate.value == value)
        }),
        "string_list" => value
            .as_array()
            .is_some_and(|values| values.iter().all(|value| value.as_str().is_some())),
        "rule_list" => value.is_array(),
        _ => false,
    }
}

fn validate_installation(executable_path: &str, auth_scope: &str) -> Result<()> {
    if !Path::new(executable_path).is_absolute() {
        anyhow::bail!("Adapter executablePath must be absolute");
    }
    if auth_scope.trim().is_empty() || auth_scope.len() > 256 {
        anyhow::bail!("Adapter authScope must be 1-256 characters");
    }
    Ok(())
}

fn validate_snapshot(snapshot: &AdapterCapabilitySnapshot) -> Result<()> {
    if snapshot.last_attempted_at.trim().is_empty() {
        anyhow::bail!("Adapter snapshot lastAttemptedAt must not be empty");
    }
    if !matches!(
        snapshot.probe_status.as_str(),
        "ready"
            | "not_installed"
            | "authentication_required"
            | "missing_capabilities"
            | "probe_failed"
    ) {
        anyhow::bail!("Adapter snapshot has an unsupported probeStatus");
    }
    if snapshot.authentication_status.trim().is_empty() {
        anyhow::bail!("Adapter snapshot authenticationStatus must not be empty");
    }
    if snapshot.permission_schema_version < 1 {
        anyhow::bail!("Adapter permission schema version must be positive");
    }
    if snapshot.probe_status == "ready" {
        if snapshot.observed_at.is_none() {
            anyhow::bail!("Ready Adapter snapshot requires observedAt");
        }
        if snapshot
            .reported_version
            .as_deref()
            .is_none_or(str::is_empty)
        {
            anyhow::bail!("Ready Adapter snapshot requires reportedVersion");
        }
        if snapshot
            .executable_fingerprint
            .as_deref()
            .is_none_or(str::is_empty)
        {
            anyhow::bail!("Ready Adapter snapshot requires executableFingerprint");
        }
        if snapshot.stale_at.is_some() || snapshot.last_error.is_some() {
            anyhow::bail!("Ready Adapter snapshot cannot be stale or contain lastError");
        }
        if snapshot.models.is_empty()
            || !snapshot
                .models
                .iter()
                .any(|model| model.is_default && !model.hidden && !model.deprecated)
        {
            anyhow::bail!("Ready Adapter snapshot requires an available default model");
        }
    }
    if snapshot.probe_status != "ready" && snapshot.last_error.is_none() {
        anyhow::bail!("Failed Adapter snapshot requires lastError");
    }
    validate_model_descriptors(&snapshot.models)?;
    validate_permission_descriptors(&snapshot.permission_options)?;
    Ok(())
}

fn validate_model_descriptors(models: &[ModelDescriptor]) -> Result<()> {
    let mut model_ids = BTreeSet::new();
    for model in models {
        if model.id.trim().is_empty() || !model_ids.insert(model.id.as_str()) {
            anyhow::bail!("Adapter model IDs must be non-empty and unique");
        }
        if model.display_name.trim().is_empty() {
            anyhow::bail!("Adapter model displayName must not be empty");
        }
        let mut option_keys = BTreeSet::new();
        for option in &model.options {
            if option.key.trim().is_empty() || !option_keys.insert(option.key.as_str()) {
                anyhow::bail!("Adapter model option keys must be non-empty and unique");
            }
            if option.value_type != "enum" {
                anyhow::bail!("Adapter model option valueType must be enum in v0.03");
            }
            let mut values = BTreeSet::new();
            for choice in &option.values {
                if choice.value.trim().is_empty() || !values.insert(choice.value.as_str()) {
                    anyhow::bail!("Adapter model option values must be non-empty and unique");
                }
            }
            if option
                .default_value
                .as_ref()
                .is_some_and(|value| !values.contains(value.as_str()))
            {
                anyhow::bail!("Adapter model option defaultValue must be one of its values");
            }
        }
    }
    Ok(())
}

fn validate_permission_descriptors(descriptors: &[PermissionOptionDescriptor]) -> Result<()> {
    let mut keys = BTreeSet::new();
    for descriptor in descriptors {
        if descriptor.key.trim().is_empty() || !keys.insert(descriptor.key.as_str()) {
            anyhow::bail!("Adapter permission keys must be non-empty and unique");
        }
        if !matches!(
            descriptor.value_type.as_str(),
            "boolean" | "enum" | "string_list" | "rule_list"
        ) {
            anyhow::bail!("Adapter permission valueType is unsupported");
        }
        if !matches!(
            descriptor.risk.as_str(),
            "normal" | "elevated" | "dangerous"
        ) {
            anyhow::bail!("Adapter permission risk is unsupported");
        }
        if !descriptor.supported {
            if descriptor.required {
                anyhow::bail!("An unsupported Adapter permission cannot be required");
            }
            if descriptor
                .unsupported_reason
                .as_deref()
                .is_none_or(str::is_empty)
            {
                anyhow::bail!("Unsupported Adapter permissions require a reason");
            }
            continue;
        }
        if !permission_value_matches_descriptor(&descriptor.recommended_value, descriptor) {
            anyhow::bail!("Adapter permission recommendedValue is invalid");
        }
    }
    Ok(())
}

fn profile_display_name_exists(
    transaction: &Transaction<'_>,
    display_name: &str,
    except_id: Option<&str>,
) -> Result<bool> {
    let expected = normalized_profile_display_name(display_name);
    let mut statement = transaction
        .prepare("SELECT id, display_name FROM agent_profile WHERE (?1 IS NULL OR id <> ?1)")?;
    let rows = statement.query_map([except_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (_, candidate) = row?;
        if normalized_profile_display_name(&candidate) == expected {
            return Ok(true);
        }
    }
    Ok(false)
}

fn normalized_profile_display_name(display_name: &str) -> String {
    display_name.trim().to_lowercase()
}

fn profile_version_and_presence(
    transaction: &Transaction<'_>,
    profile_id: &str,
) -> Result<Option<(i64, String)>> {
    Ok(transaction
        .query_row(
            "SELECT version, profile_status FROM agent_profile WHERE id = ?1",
            [profile_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?)
}

fn profile_version_and_avatar_ref(
    transaction: &Transaction<'_>,
    profile_id: &str,
) -> Result<Option<(i64, Option<String>, String)>> {
    Ok(transaction
        .query_row(
            "SELECT version, avatar_ref, profile_status FROM agent_profile WHERE id = ?1",
            [profile_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?)
}

fn version_conflict(current_version: i64) -> CommandHandlerResult {
    CommandHandlerResult::rejected(
        "version_conflict",
        json!({ "currentVersion": current_version }),
    )
}

fn profile_updated_result(profile_id: &str, version: i64, code: &str) -> CommandHandlerResult {
    CommandHandlerResult::applied(
        code,
        json!({ "agentId": profile_id, "version": version }),
        Some(EntityReference {
            entity_type: "agent_profile".to_string(),
            entity_id: profile_id.to_string(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        collaboration::{AddCampMemberCommand, CollaborationService, CreateCampCommand},
        command::{ActorRef, CommandEnvelope},
    };

    #[test]
    fn acp_runtime_classification_covers_every_acp_backed_adapter() {
        let acp_adapters = AdapterKind::ALL
            .into_iter()
            .filter(|kind| kind.uses_acp())
            .collect::<Vec<_>>();
        assert_eq!(
            acp_adapters,
            vec![
                AdapterKind::OpencodeCli,
                AdapterKind::CopilotCli,
                AdapterKind::KiroCli,
                AdapterKind::QoderCli,
                AdapterKind::CodebuddyCli,
                AdapterKind::QwenCode,
            ]
        );
    }

    #[test]
    fn public_output_mode_is_explicit_for_each_adapter_and_conservative_for_acp() {
        let final_visible = AdapterKind::ALL
            .into_iter()
            .filter(|kind| kind.public_output_mode() == PublicOutputMode::AssistantFinalVisible)
            .collect::<Vec<_>>();
        assert_eq!(
            final_visible,
            vec![
                AdapterKind::CodexCli,
                AdapterKind::ClaudeCodeCli,
                AdapterKind::AntigravityApp
            ]
        );
        for kind in AdapterKind::ALL {
            assert!(
                matches!(
                    kind.public_output_mode(),
                    PublicOutputMode::ExplicitSendOnly | PublicOutputMode::AssistantFinalVisible
                ),
                "{} must have a frozen public output mode",
                kind.as_str()
            );
        }
    }

    fn database() -> (Database, std::path::PathBuf) {
        let directory =
            std::env::temp_dir().join(format!("rovai-agent-profile-test-{}", Uuid::new_v4()));
        let database = Database::open(&directory).expect("database should open");
        (database, directory)
    }

    fn user_command<P>(command_id: &str, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: "local-user".to_string(),
            },
            camp_id: None,
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn create_identity(display_name: &str, responsibilities: &str) -> CreateAgentProfileCommand {
        CreateAgentProfileCommand {
            display_name: display_name.to_string(),
            team_role: String::new(),
            professional_responsibilities: responsibilities.to_string(),
            personality_traits: Vec::new(),
            working_principles: String::new(),
            growth_topic: String::new(),
        }
    }

    fn update_identity(
        profile: &AgentProfileView,
        display_name: &str,
    ) -> UpdateAgentProfileCommand {
        UpdateAgentProfileCommand {
            agent_id: profile.agent_id.clone(),
            expected_version: profile.version,
            display_name: display_name.to_string(),
            team_role: profile.team_role.clone(),
            professional_responsibilities: profile.professional_responsibilities.clone(),
            personality_traits: profile.personality_traits.clone(),
            working_principles: profile.working_principles.clone(),
            growth_topic: profile.growth_topic.clone(),
        }
    }

    #[test]
    fn six_field_identity_commands_reject_legacy_or_incomplete_payloads() {
        let current = json!({
            "displayName": "伙伴",
            "teamRole": "游学者",
            "professionalResponsibilities": "调查并实现明确方案。",
            "personalityTraits": ["好奇"],
            "workingPrinciples": "",
            "growthTopic": ""
        });
        serde_json::from_value::<CreateAgentProfileCommand>(current)
            .expect("the complete six-field identity payload should deserialize");

        let legacy = json!({
            "displayName": "伙伴",
            "roleTitle": "开发者",
            "identityTags": ["好奇"],
            "roleDescription": "实现方案",
            "instructions": "先测试"
        });
        assert!(serde_json::from_value::<CreateAgentProfileCommand>(legacy).is_err());

        let incomplete = json!({
            "displayName": "伙伴",
            "teamRole": "游学者",
            "professionalResponsibilities": "调查并实现明确方案。",
            "personalityTraits": ["好奇"]
        });
        assert!(serde_json::from_value::<CreateAgentProfileCommand>(incomplete).is_err());
    }

    #[test]
    fn personality_traits_are_normalized_and_deduplicated_before_the_limit() {
        let traits = vec![
            "  好奇  ".to_string(),
            "好奇".to_string(),
            "STEADY".to_string(),
            "steady".to_string(),
        ];
        let normalized = normalize_member_identity("伙伴", "  质量   保障  ", "", &traits, "", "")
            .expect("valid duplicate traits should normalize");
        assert_eq!(normalized.team_role, "质量 保障");
        assert_eq!(normalized.personality_traits, vec!["好奇", "STEADY"]);

        let too_many = (1..=7)
            .map(|index| format!("标签{index}"))
            .collect::<Vec<_>>();
        assert!(normalize_member_identity("伙伴", "", "", &too_many, "", "").is_err());
    }

    fn ready_codex_snapshot() -> AdapterCapabilitySnapshot {
        let now = chrono::Utc::now().to_rfc3339();
        AdapterCapabilitySnapshot {
            reported_version: Some("0.144.6".to_string()),
            executable_fingerprint: Some("sha256:test".to_string()),
            authentication_status: "authenticated".to_string(),
            probe_status: "ready".to_string(),
            permission_schema_version: 1,
            permission_schema_digest: "sha256:test-permissions".to_string(),
            capabilities: vec!["structured_permission_request".to_string()],
            protocols: vec!["codex-app-server".to_string()],
            models: vec![ModelDescriptor {
                id: "gpt-test".to_string(),
                display_name: "GPT Test".to_string(),
                is_default: true,
                hidden: false,
                deprecated: false,
                options: Vec::new(),
            }],
            permission_options: vec![
                PermissionOptionDescriptor {
                    key: "sandbox_mode".to_string(),
                    label: "Sandbox mode".to_string(),
                    description: "Codex filesystem sandbox mode".to_string(),
                    value_type: "enum".to_string(),
                    choices: vec![
                        ValueChoice {
                            value: "workspace-write".to_string(),
                            label: "workspace-write".to_string(),
                        },
                        ValueChoice {
                            value: "danger-full-access".to_string(),
                            label: "danger-full-access".to_string(),
                        },
                    ],
                    recommended_value: json!("workspace-write"),
                    scope: RuntimeOptionScope::Session,
                    risk: "normal".to_string(),
                    supported: true,
                    required: true,
                    unsupported_reason: None,
                },
                PermissionOptionDescriptor {
                    key: "approval_policy".to_string(),
                    label: "Approval policy".to_string(),
                    description: "Codex approval policy".to_string(),
                    value_type: "enum".to_string(),
                    choices: vec![
                        ValueChoice {
                            value: "on-request".to_string(),
                            label: "on-request".to_string(),
                        },
                        ValueChoice {
                            value: "never".to_string(),
                            label: "never".to_string(),
                        },
                    ],
                    recommended_value: json!("on-request"),
                    scope: RuntimeOptionScope::Session,
                    risk: "normal".to_string(),
                    supported: true,
                    required: true,
                    unsupported_reason: None,
                },
            ],
            observed_at: Some(now.clone()),
            last_attempted_at: now.clone(),
            last_successful_probe_at: Some(now),
            stale_at: None,
            last_error: None,
            native_session_compatibility_key: Some("codex-cli:app-server-v2".to_string()),
        }
    }

    #[test]
    fn starter_profiles_are_generic_and_runtime_is_not_configured() {
        let (database, directory) = database();
        let profiles = AgentProfileService::default()
            .list_profiles(&database)
            .expect("profiles should load");
        assert_eq!(profiles.len(), 4);
        let public_profile = serde_json::to_value(&profiles[0]).unwrap();
        assert!(public_profile.get("uuid").is_none());
        assert!(public_profile.get("handle").is_none());
        assert_eq!(public_profile["agentId"], "agent_1");
        assert!(
            profiles
                .iter()
                .all(|profile| profile.runtime_configuration.is_none())
        );
        assert!(profiles.iter().all(|profile| {
            profile.runtime_readiness.status == RuntimeReadinessStatus::RuntimeNotConfigured
        }));
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn profile_creation_allocates_monotonic_agent_ids_without_reusing_removed_values() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        let first = service
            .create_profile(
                &mut database,
                &user_command(
                    "create-agent-five",
                    create_identity("第五位", "验证首个自定义 Agent ID。"),
                ),
            )
            .unwrap();
        assert_eq!(first.result.payload["agentId"], "agent_5");
        let first_profile = service.get_profile(&database, "agent_5").unwrap().unwrap();
        service
            .remove_member(
                &mut database,
                &user_command(
                    "remove-agent-five",
                    RemoveMemberCommand {
                        agent_id: first_profile.agent_id,
                        expected_version: first_profile.version,
                        confirmation_name: first_profile.display_name,
                    },
                ),
            )
            .unwrap();

        let second = service
            .create_profile(
                &mut database,
                &user_command(
                    "create-agent-six",
                    create_identity("第六位", "验证删除后不复用 Agent ID。"),
                ),
            )
            .unwrap();
        assert_eq!(second.result.payload["agentId"], "agent_6");
        let (uuid, next_value): (String, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT agent_profile.uuid, agent_id_sequence.next_value
                FROM agent_profile, agent_id_sequence
                WHERE agent_profile.id = 'agent_6'
                  AND agent_id_sequence.singleton = 1
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!(Uuid::parse_str(&uuid).is_ok());
        assert_eq!(next_value, 7);
        let public_profile =
            serde_json::to_value(service.get_profile(&database, "agent_6").unwrap()).unwrap();
        assert!(!public_profile.to_string().contains(&uuid));

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn profile_order_is_user_controlled_atomic_and_stable() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        let original = service.list_profiles(&database).unwrap();
        assert_eq!(original[0].agent_id, "agent_1");
        let reversed = original
            .iter()
            .rev()
            .map(|profile| profile.agent_id.clone())
            .collect::<Vec<_>>();
        let envelope = user_command(
            "reorder-agent-profiles",
            ReorderAgentProfilesCommand {
                ordered_agent_ids: reversed.clone(),
            },
        );
        let first = service
            .reorder_profiles(&mut database, &envelope)
            .expect("profile order should change");
        let replay = service
            .reorder_profiles(&mut database, &envelope)
            .expect("same reorder should replay");
        assert_eq!(first.result.code, "agent_profile.reordered");
        assert!(replay.replayed);
        assert_eq!(
            service
                .list_profiles(&database)
                .unwrap()
                .into_iter()
                .map(|profile| profile.agent_id)
                .collect::<Vec<_>>(),
            reversed
        );

        let invalid = service
            .reorder_profiles(
                &mut database,
                &user_command(
                    "invalid-agent-order",
                    ReorderAgentProfilesCommand {
                        ordered_agent_ids: vec!["agent_1".to_string()],
                    },
                ),
            )
            .expect("invalid order should be a durable rejection");
        assert_eq!(invalid.result.code, "agent_profile.invalid_order");

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn profile_and_installation_commands_are_idempotent_and_explicit() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        let executable_path = directory.join("fake-codex");
        std::fs::write(&executable_path, b"codex-v1").expect("fake executable should be written");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            std::fs::set_permissions(&executable_path, std::fs::Permissions::from_mode(0o700))
                .expect("fake executable should be executable");
        }
        let executable_fingerprint =
            crate::agent_runtime_adapter::executable_fingerprint(&executable_path)
                .expect("test executable should be fingerprinted");
        let create_profile = user_command(
            "create-agent",
            CreateAgentProfileCommand {
                team_role: "Developer".to_string(),
                working_principles: "Use repository conventions.".to_string(),
                ..create_identity("Builder", "Implements scoped changes.")
            },
        );
        let first = service
            .create_profile(&mut database, &create_profile)
            .expect("profile should be created");
        let replay = service
            .create_profile(&mut database, &create_profile)
            .expect("profile command should replay");
        assert!(!first.replayed);
        assert!(replay.replayed);
        let profile_id = first.result.payload["agentId"]
            .as_str()
            .expect("profile id")
            .to_string();

        let installation = service
            .create_installation(
                &mut database,
                &user_command(
                    "create-installation",
                    CreateAdapterInstallationCommand {
                        adapter_kind: AdapterKind::CodexCli,
                        executable_path: executable_path.to_string_lossy().into_owned(),
                        command_name: "codex".to_string(),
                        source: InstallationSource::Custom,
                        auth_scope: "default".to_string(),
                    },
                ),
            )
            .expect("installation should be created");
        let installation_id = installation.result.payload["installationId"]
            .as_str()
            .expect("installation id")
            .to_string();
        let profile = service
            .get_profile(&database, &profile_id)
            .expect("profile should load")
            .expect("profile should exist");
        assert_eq!(profile.agent_id, "agent_5");
        assert!(
            serde_json::to_value(&profile)
                .unwrap()
                .get("handle")
                .is_none()
        );
        let mut ready_snapshot = ready_codex_snapshot();
        ready_snapshot.executable_fingerprint = Some(executable_fingerprint.clone());
        service
            .record_snapshot(
                &mut database,
                &user_command(
                    "record-snapshot",
                    RecordAdapterCapabilitySnapshotCommand {
                        installation_id: installation_id.clone(),
                        expected_installation_version: 1,
                        snapshot: ready_snapshot.clone(),
                    },
                ),
            )
            .expect("snapshot should be recorded");
        let managed_installation_id = service
            .commit_verified_managed_installation(
                &mut database,
                VerifiedManagedInstallation {
                    adapter_kind: AdapterKind::CodexCli,
                    executable_path: executable_path.to_string_lossy().into_owned(),
                    command_name: "codex".to_string(),
                    source: InstallationSource::InheritedPath,
                    auth_scope: "default".to_string(),
                    snapshot: ready_snapshot,
                },
            )
            .expect("verified managed Installation should be created");
        service
            .set_runtime(
                &mut database,
                &user_command(
                    "set-runtime",
                    SetMemberRuntimeConfigurationCommand {
                        agent_id: profile_id.clone(),
                        expected_version: profile.version,
                        adapter_kind: AdapterKind::CodexCli,
                        model: ModelSelection::RuntimeDefault,
                        permissions: AdapterPermissionConfig {
                            adapter_kind: AdapterKind::CodexCli,
                            schema_version: 1,
                            values: json!({
                                "sandbox_mode": "danger-full-access",
                                "approval_policy": "never",
                            }),
                        },
                    },
                ),
            )
            .expect("runtime should be configured");
        let configured = service
            .get_profile(&database, &profile_id)
            .expect("profile should load")
            .expect("profile should exist");
        assert!(configured.runtime_configuration.is_some());
        assert_eq!(
            configured.runtime_readiness.status,
            RuntimeReadinessStatus::Ready
        );
        assert_eq!(
            configured
                .runtime_configuration
                .as_ref()
                .expect("configured Runtime")
                .permissions
                .values,
            json!({
                "sandbox_mode": "danger-full-access",
                "approval_policy": "never",
            })
        );
        let installations = service
            .list_installations(&database)
            .expect("installations should load");
        assert_eq!(
            installations
                .iter()
                .find(|installation| installation.id == managed_installation_id)
                .expect("managed Installation should remain")
                .referenced_profile_count,
            1
        );

        std::fs::write(&executable_path, b"codex-v2").expect("fake executable should be upgraded");
        let advisory = service
            .get_profile(&database, &profile_id)
            .expect("profile should load")
            .expect("profile should exist");
        assert_eq!(
            advisory.runtime_readiness.status,
            RuntimeReadinessStatus::Ready,
            "profile reads must not synchronously hash executable contents"
        );
        let runtime_configuration = advisory
            .runtime_configuration
            .as_ref()
            .expect("configured profile should retain its Runtime")
            .clone();
        let runtime_binding = ResolvedRuntimeBinding {
            adapter_kind: runtime_configuration.adapter_kind,
            installation_id: managed_installation_id.clone(),
            model: runtime_configuration.model.clone(),
            permissions: runtime_configuration.permissions.clone(),
        };
        let transaction = database
            .connection_mut()
            .transaction()
            .expect("execution admission transaction");
        let frozen = resolve_frozen_runtime_binding(&transaction, &runtime_binding)
            .expect("runtime resolution should be deterministic")
            .expect("message admission should use the last verified Runtime snapshot");
        assert_eq!(frozen.executable_fingerprint, executable_fingerprint);
        drop(transaction);
        let verified_identity = service
            .verified_executable_identity(
                &database,
                &managed_installation_id,
                &executable_path.to_string_lossy(),
                &executable_fingerprint,
            )
            .expect("verified identity should load")
            .expect("successful probe should persist a lightweight identity");
        let changed_identity = observe_executable_file_identity(&executable_path)
            .expect("changed executable identity should be observable");
        assert_ne!(changed_identity, verified_identity);
        assert!(
            service
                .mark_runtime_integrity_changed(
                    &mut database,
                    &managed_installation_id,
                    &executable_path.to_string_lossy(),
                    &executable_fingerprint,
                )
                .expect("integrity change should be recorded")
        );
        let needs_repair = service
            .get_profile(&database, &profile_id)
            .expect("profile should load")
            .expect("profile should exist");
        assert_eq!(
            needs_repair.runtime_readiness.status,
            RuntimeReadinessStatus::NeedsAttention
        );
        let transaction = database
            .connection_mut()
            .transaction()
            .expect("stale Runtime admission transaction");
        let stale_frozen = resolve_frozen_runtime_binding(&transaction, &runtime_binding)
            .expect("stale Runtime resolution should remain deterministic")
            .expect("message admission should retain the last verified Runtime snapshot");
        drop(transaction);
        let dispatch_blocker = service
            .runtime_dispatch_blocker(&database, &stale_frozen)
            .expect("dispatch readiness should be readable")
            .expect("stale Runtime should block dispatch");
        assert_eq!(dispatch_blocker.code, "runtime_snapshot_stale");
        std::fs::write(&executable_path, b"codex-v1").expect("fake executable should be restored");

        let mut changed_schema = ready_codex_snapshot();
        changed_schema.executable_fingerprint = Some(executable_fingerprint);
        changed_schema.permission_schema_version = 2;
        service
            .record_snapshot(
                &mut database,
                &user_command(
                    "record-changed-schema",
                    RecordAdapterCapabilitySnapshotCommand {
                        installation_id: managed_installation_id.clone(),
                        expected_installation_version: 1,
                        snapshot: changed_schema,
                    },
                ),
            )
            .expect("changed capability snapshot should be recorded");
        let refreshed = service
            .get_profile(&database, &profile_id)
            .expect("profile should load")
            .expect("profile should exist");
        assert_eq!(
            refreshed.runtime_readiness.status,
            RuntimeReadinessStatus::NeedsAttention,
            "a capability refresh must not silently rewrite saved member parameters"
        );
        assert_eq!(
            refreshed
                .runtime_configuration
                .expect("refreshed Runtime configuration")
                .permissions
                .schema_version,
            1
        );
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn profile_avatar_writes_accept_only_controlled_or_unchanged_legacy_refs() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        let original = service
            .get_profile(&database, "agent_1")
            .unwrap()
            .expect("Luoke should exist");
        let invalid_avatar = service.set_avatar(
            &mut database,
            &user_command(
                "set-invalid-avatar",
                SetAgentProfileAvatarCommand {
                    agent_id: original.agent_id.clone(),
                    expected_version: original.version,
                    avatar_ref: Some("https://example.com/avatar.png".to_string()),
                },
            ),
        );
        assert!(
            invalid_avatar
                .expect_err("remote avatar should be rejected")
                .to_string()
                .contains("avatarRef")
        );

        database
            .connection()
            .execute(
                "UPDATE agent_profile SET avatar_ref = 'legacy://user-avatar' WHERE id = 'agent_1'",
                [],
            )
            .expect("test should install one legacy avatar ref");
        let legacy = service
            .get_profile(&database, "agent_1")
            .unwrap()
            .expect("Luoke should exist");
        let preserved = service
            .update_profile(
                &mut database,
                &user_command(
                    "preserve-legacy-avatar",
                    update_identity(&legacy, "Legacy Avatar Preserved"),
                ),
            )
            .expect("an unchanged legacy ref should not block unrelated edits");
        assert_eq!(preserved.result.code, "agent_profile.updated");

        let updated = service
            .get_profile(&database, "agent_1")
            .unwrap()
            .expect("updated Luoke should exist");
        let changed_legacy = service.set_avatar(
            &mut database,
            &user_command(
                "change-to-another-legacy-avatar",
                SetAgentProfileAvatarCommand {
                    agent_id: updated.agent_id.clone(),
                    expected_version: updated.version,
                    avatar_ref: Some("legacy://different-avatar".to_string()),
                },
            ),
        );
        assert!(
            changed_legacy
                .expect_err("a different legacy value is a new unsupported write")
                .to_string()
                .contains("avatarRef")
        );

        let controlled = service
            .set_avatar(
                &mut database,
                &user_command(
                    "replace-legacy-avatar",
                    SetAgentProfileAvatarCommand {
                        agent_id: updated.agent_id,
                        expected_version: updated.version,
                        avatar_ref: Some(
                            "rovai://member-avatar/managed/2b945f3f-4b45-4ae5-92b2-739fce600338"
                                .to_string(),
                        ),
                    },
                ),
            )
            .expect("a controlled managed ref should replace a legacy ref");
        assert_eq!(controlled.result.code, "agent_profile.avatar_updated");

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn camp_membership_read_model_handles_an_unassigned_default_lead() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        let collaboration = CollaborationService::default();
        let created = collaboration
            .create_camp(
                &mut database,
                &user_command(
                    "create-membership-test-camp",
                    CreateCampCommand::for_test_with_members(
                        directory.join("workspace").to_string_lossy().to_string(),
                        &["agent_2"],
                        "agent_2",
                    ),
                ),
            )
            .expect("Camp should be created");
        let camp_id = created.result.payload["campId"]
            .as_str()
            .expect("Camp ID should be returned")
            .to_string();
        let mut add_member = user_command(
            "add-membership-test-member",
            AddCampMemberCommand {
                camp_id: camp_id.clone(),
                agent_id: "agent_2".to_string(),
                capability_overrides: json!({}),
            },
        );
        add_member.camp_id = Some(camp_id);
        collaboration
            .add_camp_member(&mut database, &add_member)
            .expect("Camp member should be added");
        let profile = service
            .get_profile(&database, "agent_2")
            .expect("profile should load")
            .expect("profile should exist");

        let memberships = service
            .list_camp_memberships(&database, &profile.agent_id)
            .expect("Camp memberships should load");
        assert_eq!(memberships.len(), 1);
        assert!(memberships[0].is_default_lead);
        assert_eq!(memberships[0].membership_status, "active");

        database
            .connection()
            .execute("UPDATE camp SET default_lead_agent_id = NULL", [])
            .expect("test Camp should allow an unassigned Default Lead");
        let memberships = service
            .list_camp_memberships(&database, &profile.agent_id)
            .expect("membership read model should tolerate an empty Default Lead");
        assert!(!memberships[0].is_default_lead);

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn runtime_configuration_never_falls_back_to_a_custom_installation() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        let installation = service
            .create_installation(
                &mut database,
                &user_command(
                    "create-installation",
                    CreateAdapterInstallationCommand {
                        adapter_kind: AdapterKind::CodexCli,
                        executable_path: "/opt/homebrew/bin/codex".to_string(),
                        command_name: "codex".to_string(),
                        source: InstallationSource::Custom,
                        auth_scope: "default".to_string(),
                    },
                ),
            )
            .expect("installation should be created");
        assert_eq!(installation.result.code, "adapter_installation.created");
        let profile = service
            .get_profile(&database, "agent_2")
            .expect("profile should load")
            .expect("profile should exist");
        let result = service
            .set_runtime(
                &mut database,
                &user_command(
                    "set-mismatched-runtime",
                    SetMemberRuntimeConfigurationCommand {
                        agent_id: profile.agent_id,
                        expected_version: profile.version,
                        adapter_kind: AdapterKind::CopilotCli,
                        model: ModelSelection::RuntimeDefault,
                        permissions: AdapterPermissionConfig {
                            adapter_kind: AdapterKind::CopilotCli,
                            schema_version: 1,
                            values: json!({}),
                        },
                    },
                ),
            )
            .expect("unavailable Runtime configuration should be rejected");
        assert_eq!(result.result.code, "runtime_configuration_unavailable");
        let selected = service
            .get_profile(&database, "agent_2")
            .expect("profile should load")
            .expect("profile should exist");
        assert!(selected.runtime_configuration.is_none());
        assert_eq!(
            selected.runtime_readiness.status,
            RuntimeReadinessStatus::RuntimeNotConfigured
        );
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn ready_runtime_configuration_is_atomic_and_uses_explicit_native_values() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        service
            .commit_verified_managed_installation(
                &mut database,
                VerifiedManagedInstallation {
                    adapter_kind: AdapterKind::CodexCli,
                    executable_path: "/opt/homebrew/bin/codex".to_string(),
                    command_name: "codex".to_string(),
                    source: InstallationSource::InheritedPath,
                    auth_scope: "default".to_string(),
                    snapshot: ready_codex_snapshot(),
                },
            )
            .unwrap();
        let profile = service.get_profile(&database, "agent_2").unwrap().unwrap();
        let applied = service
            .set_runtime(
                &mut database,
                &user_command(
                    "explicit-runtime-config",
                    SetMemberRuntimeConfigurationCommand {
                        agent_id: profile.agent_id.clone(),
                        expected_version: profile.version,
                        adapter_kind: AdapterKind::CodexCli,
                        model: ModelSelection::Explicit {
                            model_id: "gpt-test".to_string(),
                            options: json!({}),
                        },
                        permissions: AdapterPermissionConfig {
                            adapter_kind: AdapterKind::CodexCli,
                            schema_version: 1,
                            values: json!({
                                "sandbox_mode": "workspace-write",
                                "approval_policy": "on-request",
                            }),
                        },
                    },
                ),
            )
            .unwrap();
        assert_eq!(applied.result.code, "agent_profile.runtime_configured");
        let configured = service
            .get_profile(&database, &profile.agent_id)
            .unwrap()
            .unwrap();
        let configuration = configured.runtime_configuration.as_ref().unwrap();
        assert_eq!(
            configuration.model,
            ModelSelection::Explicit {
                model_id: "gpt-test".to_string(),
                options: json!({}),
            }
        );
        assert_eq!(
            configuration.permissions.values,
            json!({
                "sandbox_mode": "workspace-write",
                "approval_policy": "on-request",
            })
        );

        let rejected = service
            .set_runtime(
                &mut database,
                &user_command(
                    "invalid-runtime-config",
                    SetMemberRuntimeConfigurationCommand {
                        agent_id: profile.agent_id.clone(),
                        expected_version: configured.version,
                        adapter_kind: AdapterKind::CodexCli,
                        model: ModelSelection::RuntimeDefault,
                        permissions: AdapterPermissionConfig {
                            adapter_kind: AdapterKind::CodexCli,
                            schema_version: 1,
                            values: json!({
                                "sandbox_mode": "not-a-native-value",
                                "approval_policy": "never",
                            }),
                        },
                    },
                ),
            )
            .unwrap();
        assert_eq!(rejected.result.code, "runtime_permission_value_invalid");
        let unchanged = service
            .get_profile(&database, &profile.agent_id)
            .unwrap()
            .unwrap();
        assert_eq!(unchanged.version, configured.version);
        assert_eq!(
            unchanged.runtime_configuration,
            configured.runtime_configuration
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn background_runtime_discovery_never_materializes_member_configuration() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        let profile = service.get_profile(&database, "agent_2").unwrap().unwrap();
        let selected = service
            .set_runtime(
                &mut database,
                &user_command(
                    "select-unresolved-codex",
                    SetMemberRuntimeConfigurationCommand {
                        agent_id: profile.agent_id.clone(),
                        expected_version: profile.version,
                        adapter_kind: AdapterKind::CodexCli,
                        model: ModelSelection::RuntimeDefault,
                        permissions: AdapterPermissionConfig {
                            adapter_kind: AdapterKind::CodexCli,
                            schema_version: 1,
                            values: json!({}),
                        },
                    },
                ),
            )
            .unwrap();
        assert_eq!(selected.result.code, "runtime_configuration_unavailable");

        service
            .commit_verified_managed_installation(
                &mut database,
                VerifiedManagedInstallation {
                    adapter_kind: AdapterKind::CodexCli,
                    executable_path: "/opt/homebrew/bin/codex".to_string(),
                    command_name: "codex".to_string(),
                    source: InstallationSource::InheritedPath,
                    auth_scope: "default".to_string(),
                    snapshot: ready_codex_snapshot(),
                },
            )
            .unwrap();
        let still_unresolved = service
            .get_profile(&database, &profile.agent_id)
            .unwrap()
            .unwrap();
        assert!(still_unresolved.runtime_configuration.is_none());
        assert_eq!(
            still_unresolved.runtime_readiness.status,
            RuntimeReadinessStatus::RuntimeNotConfigured
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_probe_keeps_the_last_successful_catalog_and_marks_it_stale() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        let installation = service
            .create_installation(
                &mut database,
                &user_command(
                    "create-installation",
                    CreateAdapterInstallationCommand {
                        adapter_kind: AdapterKind::CodexCli,
                        executable_path: "/opt/homebrew/bin/codex".to_string(),
                        command_name: "codex".to_string(),
                        source: InstallationSource::Custom,
                        auth_scope: "default".to_string(),
                    },
                ),
            )
            .expect("installation should be created");
        let installation_id = installation.result.payload["installationId"]
            .as_str()
            .expect("installation id")
            .to_string();
        service
            .record_snapshot(
                &mut database,
                &user_command(
                    "record-ready-snapshot",
                    RecordAdapterCapabilitySnapshotCommand {
                        installation_id: installation_id.clone(),
                        expected_installation_version: 1,
                        snapshot: ready_codex_snapshot(),
                    },
                ),
            )
            .expect("ready snapshot should be recorded");
        let failed_at = chrono::Utc::now().to_rfc3339();
        service
            .record_snapshot(
                &mut database,
                &user_command(
                    "record-failed-snapshot",
                    RecordAdapterCapabilitySnapshotCommand {
                        installation_id: installation_id.clone(),
                        expected_installation_version: 1,
                        snapshot: AdapterCapabilitySnapshot {
                            reported_version: Some("must-not-replace".to_string()),
                            executable_fingerprint: Some("sha256:test".to_string()),
                            authentication_status: "unknown".to_string(),
                            probe_status: "probe_failed".to_string(),
                            permission_schema_version: 99,
                            permission_schema_digest: "sha256:failed".to_string(),
                            capabilities: vec!["must-not-replace".to_string()],
                            protocols: vec!["must-not-replace".to_string()],
                            models: Vec::new(),
                            permission_options: Vec::new(),
                            observed_at: None,
                            last_attempted_at: failed_at.clone(),
                            last_successful_probe_at: None,
                            stale_at: None,
                            last_error: Some("probe failed".to_string()),
                            native_session_compatibility_key: None,
                        },
                    },
                ),
            )
            .expect("failed attempt should be recorded");
        let installation = service
            .list_installations(&database)
            .expect("installations should load")
            .into_iter()
            .find(|candidate| candidate.id == installation_id)
            .expect("installation should remain");
        let snapshot = installation.snapshot.expect("snapshot should remain");
        assert_eq!(snapshot.reported_version.as_deref(), Some("0.144.6"));
        assert_eq!(snapshot.models[0].id, "gpt-test");
        assert_eq!(snapshot.permission_schema_version, 1);
        assert_eq!(snapshot.probe_status, "ready");
        assert_eq!(snapshot.stale_at, None);
        assert_eq!(
            installation
                .last_probe_attempt
                .as_ref()
                .map(|attempt| attempt.failure_class.as_str()),
            Some("transient")
        );
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn verified_relocation_preserves_installation_identity_and_never_commits_a_failed_candidate() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        let mut original_snapshot = ready_codex_snapshot();
        original_snapshot.executable_fingerprint = Some("sha256:original".to_string());
        let installation_id = service
            .commit_verified_managed_installation(
                &mut database,
                VerifiedManagedInstallation {
                    adapter_kind: AdapterKind::CodexCli,
                    executable_path: "/opt/homebrew/bin/codex".to_string(),
                    command_name: "codex".to_string(),
                    source: InstallationSource::InheritedPath,
                    auth_scope: "default".to_string(),
                    snapshot: original_snapshot,
                },
            )
            .unwrap();
        let profile = service.get_profile(&database, "agent_2").unwrap().unwrap();
        service
            .set_runtime(
                &mut database,
                &user_command(
                    "select-managed-codex",
                    SetMemberRuntimeConfigurationCommand {
                        agent_id: profile.agent_id,
                        expected_version: profile.version,
                        adapter_kind: AdapterKind::CodexCli,
                        model: ModelSelection::RuntimeDefault,
                        permissions: AdapterPermissionConfig {
                            adapter_kind: AdapterKind::CodexCli,
                            schema_version: 1,
                            values: json!({
                                "sandbox_mode": "danger-full-access",
                                "approval_policy": "never",
                            }),
                        },
                    },
                ),
            )
            .unwrap();

        service
            .record_managed_probe_failure(
                &mut database,
                ManagedProbeFailure {
                    adapter_kind: AdapterKind::CodexCli,
                    auth_scope: "default",
                    candidate_path: "/Users/test/.local/bin/codex",
                    fingerprint: Some("sha256:wrong-program"),
                    source: Some(InstallationSource::LoginShell),
                    failure_class: "identity_changed",
                    diagnostic_code: "runtime_identity_changed",
                },
            )
            .unwrap();
        let rejected_candidate = service
            .managed_installation(&database, AdapterKind::CodexCli, "default")
            .unwrap()
            .unwrap();
        assert_eq!(rejected_candidate.id, installation_id);
        assert_eq!(
            rejected_candidate.executable_path,
            "/opt/homebrew/bin/codex"
        );
        assert_eq!(
            rejected_candidate
                .snapshot
                .as_ref()
                .and_then(|snapshot| snapshot.executable_fingerprint.as_deref()),
            Some("sha256:original")
        );
        assert_eq!(
            rejected_candidate.relocation_history[0].source,
            Some(InstallationSource::LoginShell)
        );
        assert_eq!(rejected_candidate.relocation_history[0].result, "failed");

        let mut replacement_snapshot = ready_codex_snapshot();
        replacement_snapshot.reported_version = Some("0.145.0".to_string());
        replacement_snapshot.executable_fingerprint = Some("sha256:replacement".to_string());
        let relocated_id = service
            .commit_verified_managed_installation(
                &mut database,
                VerifiedManagedInstallation {
                    adapter_kind: AdapterKind::CodexCli,
                    executable_path: "/Users/test/.volta/bin/codex".to_string(),
                    command_name: "codex".to_string(),
                    source: InstallationSource::KnownLocation,
                    auth_scope: "default".to_string(),
                    snapshot: replacement_snapshot,
                },
            )
            .unwrap();
        assert_eq!(relocated_id, installation_id);
        let relocated = service
            .managed_installation(&database, AdapterKind::CodexCli, "default")
            .unwrap()
            .unwrap();
        assert_eq!(relocated.executable_path, "/Users/test/.volta/bin/codex");
        assert_eq!(relocated.generation, 2);
        assert_eq!(relocated.version, 2);
        assert_eq!(relocated.path_state, "valid");
        assert_eq!(relocated.relocation_history[0].result, "succeeded");
        assert_eq!(
            relocated
                .snapshot
                .as_ref()
                .and_then(|snapshot| snapshot.executable_fingerprint.as_deref()),
            Some("sha256:replacement")
        );
        let resolved_profile = service.get_profile(&database, "agent_2").unwrap().unwrap();
        assert_eq!(
            resolved_profile
                .runtime_configuration
                .as_ref()
                .map(|configuration| configuration.adapter_kind),
            Some(AdapterKind::CodexCli)
        );
        assert_eq!(relocated.id, installation_id);
        assert_eq!(
            resolved_profile.runtime_readiness.status,
            RuntimeReadinessStatus::Ready
        );
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn setting_a_starter_profile_away_survives_database_reopen() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        let profile = service
            .get_profile(&database, "agent_4")
            .expect("profile should load")
            .expect("profile should exist");
        service
            .set_presence(
                &mut database,
                &user_command(
                    "away-qilu",
                    SetMemberPresenceCommand {
                        agent_id: profile.agent_id,
                        expected_version: profile.version,
                        presence: "away".to_string(),
                    },
                ),
            )
            .expect("profile should be away");
        drop(database);

        let reopened = Database::open(&directory).expect("database should reopen");
        let profile = service
            .get_profile(&reopened, "agent_4")
            .expect("profile should load")
            .expect("profile should exist");
        assert_eq!(profile.presence, "away");
        assert_eq!(
            profile.runtime_readiness.status,
            RuntimeReadinessStatus::RuntimeNotConfigured
        );
        drop(reopened);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn removing_a_member_hides_management_and_preserves_its_internal_identity() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        let profile = service
            .get_profile(&database, "agent_4")
            .expect("profile should load")
            .expect("profile should exist");
        let original_handle = database
            .connection()
            .query_row(
                "SELECT COALESCE(handle, '') FROM agent_profile WHERE id = ?1",
                [&profile.agent_id],
                |row| row.get::<_, String>(0),
            )
            .expect("legacy handle should remain internally readable");
        let preview = service
            .removal_preview(&database, &profile.agent_id)
            .expect("preview should load")
            .expect("member should be removable");
        assert!(preview.removable);
        assert_eq!(preview.non_terminal_agent_run_count, 0);

        let mismatch = service
            .remove_member(
                &mut database,
                &user_command(
                    "remove-qilu-mismatch",
                    RemoveMemberCommand {
                        agent_id: profile.agent_id.clone(),
                        expected_version: profile.version,
                        confirmation_name: "QILU".to_string(),
                    },
                ),
            )
            .expect("mismatch should be a durable rejection");
        assert_eq!(
            mismatch.result.code,
            "agent_profile.confirmation_name_mismatch"
        );

        let removed = service
            .remove_member(
                &mut database,
                &user_command(
                    "remove-qilu",
                    RemoveMemberCommand {
                        agent_id: profile.agent_id.clone(),
                        expected_version: profile.version,
                        confirmation_name: profile.display_name.clone(),
                    },
                ),
            )
            .expect("member should be removed");
        assert_eq!(removed.result.code, "agent_profile.removed");
        assert!(
            service
                .get_profile(&database, &profile.agent_id)
                .expect("management read should succeed")
                .is_none()
        );

        let retained: (String, String, Option<String>, String, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT COALESCE(handle, ''), display_name, avatar_ref,
                       profile_status, version
                FROM agent_profile WHERE id = ?1
                "#,
                [&profile.agent_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("removed identity should remain");
        assert_eq!(retained.0, original_handle);
        assert_eq!(retained.1, profile.display_name);
        assert_eq!(retained.2, profile.avatar_ref);
        assert_eq!(retained.3, "removed");
        assert_eq!(retained.4, profile.version + 1);

        let reserved_name = service
            .create_profile(
                &mut database,
                &user_command(
                    "reuse-qilu-name",
                    create_identity(&profile.display_name, "用于验证名称全局保留。"),
                ),
            )
            .expect("reserved name should be a durable rejection");
        assert_eq!(
            reserved_name.result.code,
            "agent_profile.display_name_conflict"
        );

        let replacement = service
            .create_profile(
                &mut database,
                &user_command(
                    "create-qilu-replacement",
                    create_identity("新绮露", "用于验证后台生成新的内部 ID。"),
                ),
            )
            .expect("replacement profile should be created");
        assert_eq!(replacement.result.code, "agent_profile.created");
        let replacement = service
            .list_profiles(&database)
            .expect("profiles should load")
            .into_iter()
            .find(|candidate| candidate.display_name == "新绮露")
            .expect("replacement should be visible");
        assert_eq!(replacement.agent_id, "agent_5");
        assert!(
            serde_json::to_value(&replacement)
                .unwrap()
                .get("handle")
                .is_none()
        );

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn profile_display_names_are_globally_unique_and_updates_preserve_legacy_aliases() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        let created = service
            .create_profile(
                &mut database,
                &user_command(
                    "create-builder",
                    create_identity("Builder", "Builds scoped changes."),
                ),
            )
            .expect("profile should be created");
        let profile_id = created.result.payload["agentId"]
            .as_str()
            .expect("profile id");
        let profile = service
            .get_profile(&database, profile_id)
            .expect("profile should load")
            .expect("profile should exist");
        let original_handle = database
            .connection()
            .query_row(
                "SELECT COALESCE(handle, '') FROM agent_profile WHERE id = ?1",
                [&profile.agent_id],
                |row| row.get::<_, String>(0),
            )
            .expect("legacy handle should remain internally readable");

        let duplicate = service
            .create_profile(
                &mut database,
                &user_command(
                    "create-duplicate-builder",
                    create_identity(" builder ", "Duplicate name."),
                ),
            )
            .expect("duplicate should be a durable rejection");
        assert_eq!(duplicate.result.code, "agent_profile.display_name_conflict");

        let updated = service
            .update_profile(
                &mut database,
                &user_command("rename-builder", update_identity(&profile, "Builder Prime")),
            )
            .expect("profile should update");
        assert_eq!(updated.result.code, "agent_profile.updated");
        let updated_profile = service
            .get_profile(&database, &profile.agent_id)
            .expect("profile should load")
            .expect("profile should exist");
        let updated_handle = database
            .connection()
            .query_row(
                "SELECT COALESCE(handle, '') FROM agent_profile WHERE id = ?1",
                [&profile.agent_id],
                |row| row.get::<_, String>(0),
            )
            .expect("legacy handle should remain internally readable");
        assert_eq!(updated_handle, original_handle);
        assert_eq!(updated_profile.display_name, "Builder Prime");

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn starter_profile_user_edits_survive_database_reopen() {
        let (mut database, directory) = database();
        let service = AgentProfileService::default();
        let profile = service
            .get_profile(&database, "agent_4")
            .expect("profile should load")
            .expect("profile should exist");
        service
            .update_profile(
                &mut database,
                &user_command(
                    "edit-qilu",
                    UpdateAgentProfileCommand {
                        working_principles: "只在未来 Run 生效。".to_string(),
                        ..update_identity(&profile, &profile.display_name)
                    },
                ),
            )
            .expect("profile should be updated");
        drop(database);

        let reopened = Database::open(&directory).expect("database should reopen");
        let profile = service
            .get_profile(&reopened, "agent_4")
            .expect("profile should load")
            .expect("profile should exist");
        assert_eq!(profile.working_principles, "只在未来 Run 生效。");
        drop(reopened);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn setting_a_default_lead_away_does_not_mutate_the_camp() {
        let (mut database, directory) = database();
        let collaboration = CollaborationService::default();
        let camp = collaboration
            .create_camp(
                &mut database,
                &user_command(
                    "create-default-lead-camp",
                    CreateCampCommand::for_test(
                        directory.join("quick-chat").to_string_lossy().to_string(),
                    ),
                ),
            )
            .expect("Camp should be created");
        let camp_id = camp.result.payload["campId"]
            .as_str()
            .expect("Camp ID should be returned")
            .to_string();
        collaboration
            .add_camp_member(
                &mut database,
                &CommandEnvelope {
                    command_id: "add-default-lead".to_string(),
                    actor: ActorRef::User {
                        user_id: "local-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_id: "agent_1".to_string(),
                        capability_overrides: json!({}),
                    },
                },
            )
            .expect("Default Lead should join the Camp");
        collaboration
            .add_camp_member(
                &mut database,
                &CommandEnvelope {
                    command_id: "add-default-lead-successor".to_string(),
                    actor: ActorRef::User {
                        user_id: "local-user".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_id: "agent_2".to_string(),
                        capability_overrides: json!({}),
                    },
                },
            )
            .expect("A successor candidate should join the Camp");
        let service = AgentProfileService::default();
        let profile = service
            .get_profile(&database, "agent_1")
            .expect("profile should load")
            .expect("profile should exist");
        let result = service
            .set_presence(
                &mut database,
                &user_command(
                    "away-luoke",
                    SetMemberPresenceCommand {
                        agent_id: profile.agent_id.clone(),
                        expected_version: profile.version,
                        presence: "away".to_string(),
                    },
                ),
            )
            .expect("presence should change independently");
        assert_eq!(result.result.code, "agent_profile.presence_changed");
        let (lead, status): (Option<String>, String) = database
            .connection()
            .query_row(
                r#"
                SELECT camp.default_lead_agent_id, agent_profile.profile_status
                FROM camp, agent_profile
                WHERE camp.id = ?1 AND agent_profile.id = ?2
                "#,
                params![camp_id, profile.agent_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("lead and profile should remain queryable");
        assert_eq!(lead.as_deref(), Some("agent_1"));
        assert_eq!(status, "away");
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }
}
