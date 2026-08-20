use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    path::Path,
};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

pub const DURABLE_TASK_CONTRACT_VERSION: u32 = 3;

use crate::{
    agent_profile::{FrozenAgentRuntimeConfig, resolve_frozen_runtime},
    camp_attachment::consume_prepared_attachments,
    camp_attachment_publication::CampAttachmentPublicationCoordinator,
    camp_attachment_view::commit_publication_in_message_transaction,
    camp_content::{
        StructuredCampMessageContent, StructuredCampMessageSegment, canonical_content_digest,
        has_all_members_mention, member_mention_ids, normalize_content, render_plain_text,
        validate_user_authored_content,
    },
    camp_id::CampId,
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    context_index::index_camp_message,
    current_input_skill::{SkillSelectionSnapshot, freeze_skill_selection},
    db::Database,
    execution_budget::{
        CampTurnExecutionBudgetExhaustionReason, CampTurnExecutionBudgetRequest,
        FrozenCampTurnExecutionBudget, camp_turn_execution_budget_now,
        freeze_camp_turn_execution_budget,
    },
    gather::cancel_gathers_for_initiator,
    message_delivery::cancel_pending_turn_deliveries,
    runtime::AgentRunWorkspace,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCampCommand {
    pub name: Option<String>,
    pub project_binding_kind: ProjectBindingKind,
    pub project_path: String,
    pub member_agent_ids: Vec<String>,
    pub default_lead_agent_id: String,
    pub collaboration_mode: CampCollaborationMode,
    #[serde(default)]
    pub activation_state: CampActivationState,
}

#[cfg(test)]
impl CreateCampCommand {
    pub fn for_test(project_path: String) -> Self {
        Self::for_test_with_members(project_path, &["agent_1"], "agent_1")
    }

    pub fn for_test_with_members(
        project_path: String,
        members: &[&str],
        default_lead: &str,
    ) -> Self {
        Self {
            name: None,
            project_binding_kind: ProjectBindingKind::Directory,
            project_path,
            member_agent_ids: members.iter().map(|member| (*member).to_string()).collect(),
            default_lead_agent_id: default_lead.to_string(),
            collaboration_mode: CampCollaborationMode::Peer,
            activation_state: CampActivationState::Active,
        }
    }
}

impl sealed::Sealed for CreateCampCommand {}
impl DomainCommand for CreateCampCommand {
    const TYPE: &'static str = "camp.create";
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectBindingKind {
    QuickChat,
    Directory,
}

impl ProjectBindingKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::QuickChat => "quick_chat",
            Self::Directory => "directory",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CampCollaborationMode {
    Peer,
    LeadCoordinated,
}

impl CampCollaborationMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Peer => "peer",
            Self::LeadCoordinated => "lead_coordinated",
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CampActivationState {
    Pending,
    #[default]
    Active,
}

impl CampActivationState {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Active => "active",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CampNameOrigin {
    Default,
    Generated,
    User,
}

impl CampNameOrigin {
    fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Generated => "generated",
            Self::User => "user",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameCampCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
    pub title: String,
    pub expected_version: i64,
}

impl sealed::Sealed for RenameCampCommand {}
impl DomainCommand for RenameCampCommand {
    const TYPE: &'static str = "camp.rename";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeDefaultLeadCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
    pub successor_agent_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for ChangeDefaultLeadCommand {}
impl DomainCommand for ChangeDefaultLeadCommand {
    const TYPE: &'static str = "camp.default_lead.change";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileDefaultLeadCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
}

impl sealed::Sealed for ReconcileDefaultLeadCommand {}
impl DomainCommand for ReconcileDefaultLeadCommand {
    const TYPE: &'static str = "camp.default_lead.reconcile";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCampCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
    pub expected_version: i64,
    #[serde(default)]
    pub force: bool,
}

impl sealed::Sealed for DeleteCampCommand {}
impl DomainCommand for DeleteCampCommand {
    const TYPE: &'static str = "camp.delete";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardPendingCampCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
}

impl sealed::Sealed for DiscardPendingCampCommand {}
impl DomainCommand for DiscardPendingCampCommand {
    const TYPE: &'static str = "camp.pending.discard";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddCampMemberCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
    pub agent_id: String,
    #[serde(default)]
    pub capability_overrides: Value,
}

impl sealed::Sealed for AddCampMemberCommand {}
impl DomainCommand for AddCampMemberCommand {
    const TYPE: &'static str = "camp.member.add";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRequest {
    pub task_id: Option<String>,
    pub purpose: String,
    #[serde(default = "required_completion_role")]
    pub completion_role: String,
    #[serde(default)]
    pub budget: Option<CampTurnExecutionBudgetRequest>,
}

fn required_completion_role() -> String {
    "required".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendUserCampDraftCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
    pub draft_revision: i64,
    pub execution: Option<ExecutionRequest>,
}

impl sealed::Sealed for SendUserCampDraftCommand {}
impl DomainCommand for SendUserCampDraftCommand {
    const TYPE: &'static str = "camp.message.send_user_draft";
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize)]
pub(crate) enum TestCampMessageAddress {
    Default,
    Explicit {
        agent_ids: Vec<String>,
    },
    #[cfg(feature = "slow-tests")]
    Broadcast,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize)]
pub(crate) struct TestCampMessageCommand {
    pub camp_id: String,
    pub draft_revision: Option<i64>,
    pub body: String,
    pub prepared_attachment_ids: Vec<String>,
    pub address: TestCampMessageAddress,
    pub reply_to_camp_message_id: Option<String>,
    pub execution: Option<ExecutionRequest>,
}

#[cfg(all(test, feature = "slow-tests"))]
#[derive(Debug, Clone)]
pub(crate) struct TestCampConversationCommand {
    pub project_binding_kind: ProjectBindingKind,
    pub project_path: String,
    pub body: String,
    pub address: TestCampMessageAddress,
    pub purpose: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub acceptance_criteria: Vec<String>,
    pub assignee_agent_id: String,
}

impl sealed::Sealed for CreateTaskCommand {}
impl DomainCommand for CreateTaskCommand {
    const TYPE: &'static str = "task.create";
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    InProgress,
    Blocked,
    Completed,
    Cancelled,
}

impl TaskStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::InProgress => "in_progress",
            Self::Blocked => "blocked",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum TaskAssigneeUpdate {
    #[default]
    Unchanged,
    Assign {
        #[serde(rename = "agentId")]
        agent_id: String,
    },
    Clear,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum TaskAcceptanceCriteriaUpdate {
    #[default]
    Unchanged,
    Replace {
        items: Vec<String>,
    },
    Clear,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskCommand {
    pub task_id: String,
    pub expected_version: i64,
    pub title: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub acceptance_criteria: TaskAcceptanceCriteriaUpdate,
    pub status: Option<TaskStatus>,
    #[serde(default)]
    pub assignee: TaskAssigneeUpdate,
    pub blocked_reason: Option<String>,
    pub completion_summary: Option<String>,
    pub cancel_reason: Option<String>,
}

impl sealed::Sealed for UpdateTaskCommand {}
impl DomainCommand for UpdateTaskCommand {
    const TYPE: &'static str = "task.update";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    #[serde(rename = "taskId")]
    pub id: String,
    pub camp_id: String,
    pub title: String,
    pub description: String,
    pub acceptance_criteria: Vec<String>,
    pub status: TaskStatus,
    pub assignee_agent_id: Option<String>,
    pub blocked_reason: Option<String>,
    pub completion_summary: Option<String>,
    pub cancel_reason: Option<String>,
    pub created_by_type: String,
    pub created_by_id: String,
    pub source_agent_run_id: Option<String>,
    pub closed_by_type: Option<String>,
    pub closed_by_id: Option<String>,
    pub closed_by_agent_run_id: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum TaskAssigneeFilter {
    #[default]
    Any,
    Unassigned,
    Agent {
        #[serde(rename = "agentId")]
        agent_id: String,
    },
}

#[derive(Debug, Clone, Default)]
pub struct TaskListQuery {
    pub statuses: Option<Vec<TaskStatus>>,
    pub assignee: TaskAssigneeFilter,
    pub limit: usize,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    #[serde(flatten)]
    pub task: TaskRecord,
    pub available_actions: Vec<String>,
}

pub type TaskQueryItem = TaskDetail;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListItem {
    pub task_id: String,
    pub title: String,
    pub status: TaskStatus,
    pub assignee_agent_id: Option<String>,
    pub available_actions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListPage {
    pub tasks: Vec<TaskListItem>,
    pub next_cursor: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TaskListRow {
    task_id: String,
    title: String,
    status: TaskStatus,
    assignee_agent_id: Option<String>,
    created_at: String,
}

#[derive(Debug, Default)]
pub struct CollaborationService {
    gateway: DomainCommandGateway,
}

impl CollaborationService {
    pub fn validate_send_message_input(command: &SendUserCampDraftCommand) -> Result<()> {
        validate_camp_message_input(command)
    }

    #[cfg(test)]
    pub(crate) fn send_test_camp_message(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<TestCampMessageCommand>,
    ) -> Result<CommandExecution> {
        let draft_revision = if let Some(revision) = envelope.payload.draft_revision {
            revision
        } else {
            let mut content = match &envelope.payload.address {
                TestCampMessageAddress::Default => Vec::new(),
                TestCampMessageAddress::Explicit { agent_ids } => agent_ids
                    .iter()
                    .cloned()
                    .map(|agent_id| StructuredCampMessageSegment::MemberMention { agent_id })
                    .collect(),
                #[cfg(feature = "slow-tests")]
                TestCampMessageAddress::Broadcast => {
                    vec![StructuredCampMessageSegment::AllMembersMention]
                }
            };
            content.push(StructuredCampMessageSegment::Text {
                text: envelope.payload.body.clone(),
            });
            let content = normalize_content(content);
            validate_user_authored_content(&content)?;
            let now = chrono::Utc::now();
            let expires_at = (now + chrono::Duration::hours(24)).to_rfc3339();
            database.connection().execute(
                r#"
                INSERT INTO camp_composer_draft(
                    camp_id, body, structured_content_json, revision,
                    reply_to_camp_message_id, recipient_selection_required,
                    created_at, updated_at, expires_at
                ) VALUES (?1, ?2, ?3, 1, ?4, 0, ?5, ?5, ?6)
                ON CONFLICT(camp_id) DO UPDATE SET
                    body = excluded.body,
                    structured_content_json = excluded.structured_content_json,
                    reply_to_camp_message_id = excluded.reply_to_camp_message_id,
                    recipient_selection_required = 0,
                    revision = camp_composer_draft.revision + 1,
                    updated_at = excluded.updated_at,
                    expires_at = excluded.expires_at
                "#,
                params![
                    envelope.payload.camp_id,
                    envelope.payload.body,
                    serde_json::to_string(&content)?,
                    envelope.payload.reply_to_camp_message_id,
                    now.to_rfc3339(),
                    expires_at,
                ],
            )?;
            database.connection().query_row(
                "SELECT revision FROM camp_composer_draft WHERE camp_id = ?1",
                [&envelope.payload.camp_id],
                |row| row.get(0),
            )?
        };
        let command = CommandEnvelope {
            command_id: envelope.command_id.clone(),
            actor: envelope.actor.clone(),
            camp_id: envelope.camp_id.clone(),
            expected_versions: envelope.expected_versions.clone(),
            execution_epoch: envelope.execution_epoch,
            payload: SendUserCampDraftCommand {
                camp_id: envelope.payload.camp_id.clone(),
                draft_revision,
                execution: envelope.payload.execution.clone(),
            },
        };
        self.send_user_camp_draft(database, &command)
    }

    #[cfg(all(test, feature = "slow-tests"))]
    pub(crate) fn create_test_camp_conversation(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<TestCampConversationCommand>,
    ) -> Result<CommandExecution> {
        let profiles = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT id,
                       default_runtime_installation_id IS NOT NULL
                       AND default_model_selection_json IS NOT NULL
                       AND default_permission_config_json IS NOT NULL
                FROM agent_profile
                WHERE profile_status = 'present'
                ORDER BY member_order, id
                "#,
            )?;
            statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let default_lead_agent_id = profiles
            .iter()
            .find_map(|(agent_id, configured)| configured.then_some(agent_id.clone()))
            .or_else(|| profiles.first().map(|(agent_id, _)| agent_id.clone()))
            .context("test Camp requires at least one present member")?;
        let member_agent_ids = profiles
            .iter()
            .map(|(agent_id, _)| agent_id.clone())
            .collect::<Vec<_>>();
        let created = self.create_camp(
            database,
            &CommandEnvelope {
                command_id: format!("{}:camp", envelope.command_id),
                actor: envelope.actor.clone(),
                camp_id: None,
                expected_versions: envelope.expected_versions.clone(),
                execution_epoch: envelope.execution_epoch,
                payload: CreateCampCommand {
                    name: None,
                    project_binding_kind: envelope.payload.project_binding_kind,
                    project_path: envelope.payload.project_path.clone(),
                    member_agent_ids,
                    default_lead_agent_id,
                    collaboration_mode: CampCollaborationMode::Peer,
                    activation_state: CampActivationState::Active,
                },
            },
        )?;
        if created.result.status == crate::command::CommandResultStatus::Rejected {
            return Ok(created);
        }
        let camp_id = created.result.payload["campId"]
            .as_str()
            .context("test Camp creation returned no Camp ID")?
            .to_string();
        let mut sent = self.send_test_camp_message(
            database,
            &CommandEnvelope {
                command_id: format!("{}:message", envelope.command_id),
                actor: envelope.actor.clone(),
                camp_id: Some(camp_id.clone()),
                expected_versions: envelope.expected_versions.clone(),
                execution_epoch: envelope.execution_epoch,
                payload: TestCampMessageCommand {
                    camp_id: camp_id.clone(),
                    draft_revision: None,
                    body: envelope.payload.body.clone(),
                    prepared_attachment_ids: Vec::new(),
                    address: envelope.payload.address.clone(),
                    reply_to_camp_message_id: None,
                    execution: Some(ExecutionRequest {
                        task_id: None,
                        purpose: envelope.payload.purpose.clone(),
                        completion_role: required_completion_role(),
                        budget: None,
                    }),
                },
            },
        )?;
        if let Some(payload) = sent.result.payload.as_object_mut() {
            payload.insert("campId".to_string(), Value::String(camp_id));
        }
        Ok(sent)
    }

    pub fn create_camp(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateCampCommand>,
    ) -> Result<CommandExecution> {
        validate_project_path(&envelope.payload.project_path)?;
        let normalized_name = normalize_camp_name(envelope.payload.name.as_deref().unwrap_or(""));
        let camp_id = CampId::new();
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, ActorRef::User { .. }) {
                return Ok(rejected(
                    "camp.user_required",
                    "Only a User can create a Camp",
                ));
            }
            if normalized_name.chars().count() > CAMP_NAME_MAX_SCALARS {
                return Ok(rejected(
                    "camp.name_too_long",
                    "Camp name must not exceed 80 Unicode scalar values",
                ));
            }
            if envelope.payload.collaboration_mode != CampCollaborationMode::Peer {
                return Ok(rejected(
                    "camp.unsupported_collaboration_mode",
                    "This collaboration mode is not available",
                ));
            }
            if envelope.payload.member_agent_ids.is_empty() {
                return Ok(rejected(
                    "camp.no_present_members",
                    "At least one present member is required",
                ));
            }
            let mut unique_member_ids = HashSet::new();
            for member_id in &envelope.payload.member_agent_ids {
                if !unique_member_ids.insert(member_id.as_str()) {
                    return Ok(rejected(
                        "camp.invalid_initial_member",
                        "Initial Camp members must be distinct",
                    ));
                }
                let presence = transaction
                    .query_row(
                        "SELECT profile_status FROM agent_profile WHERE id = ?1",
                        [member_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?;
                if presence.as_deref() != Some("present") {
                    return Ok(CommandHandlerResult::rejected(
                        "camp.invalid_initial_member",
                        json!({
                            "agentId": member_id,
                            "message": "Every initial member must still be present",
                        }),
                    ));
                }
            }
            if !unique_member_ids.contains(envelope.payload.default_lead_agent_id.as_str()) {
                return Ok(rejected(
                    "camp.invalid_default_lead",
                    "Default Lead must belong to the selected member set",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let (title, name_origin) = if normalized_name.is_empty() {
                ("未命名对话".to_string(), CampNameOrigin::Default)
            } else {
                (normalized_name.clone(), CampNameOrigin::User)
            };
            transaction.execute(
                r#"
                INSERT INTO camp(
                    id, title, name_origin, collaboration_mode,
                    project_binding_kind, project_path,
                    default_lead_agent_id, activation_state, last_message_sequence,
                    version, created_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6,
                    ?7, ?8, 0, 1, ?9, ?9
                )
                "#,
                params![
                    camp_id,
                    title,
                    name_origin.as_str(),
                    envelope.payload.collaboration_mode.as_str(),
                    envelope.payload.project_binding_kind.as_str(),
                    envelope.payload.project_path,
                    envelope.payload.default_lead_agent_id,
                    envelope.payload.activation_state.as_str(),
                    now,
                ],
            )?;
            for member_id in &envelope.payload.member_agent_ids {
                transaction.execute(
                    r#"
                    INSERT INTO camp_member(
                        camp_id, agent_id, status, capability_overrides_json,
                        leave_requested_at, leave_request_command_id,
                        pending_default_lead_successor_agent_id,
                        version, joined_at, left_at
                    ) VALUES (?1, ?2, 'active', '{}', NULL, NULL, NULL, 1, ?3, NULL)
                    "#,
                    params![camp_id, member_id, now],
                )?;
            }
            if envelope.payload.activation_state == CampActivationState::Active {
                append_domain_event(
                    transaction,
                    "camp.created",
                    Some(camp_id.as_str()),
                    Some(("camp", camp_id.as_str())),
                    &envelope.actor,
                    envelope.execution_epoch,
                    &json!({
                        "title": title,
                        "nameOrigin": name_origin,
                        "projectBindingKind": envelope.payload.project_binding_kind,
                        "projectPath": envelope.payload.project_path,
                        "collaborationMode": envelope.payload.collaboration_mode,
                        "defaultLeadAgentId": envelope.payload.default_lead_agent_id,
                        "memberCount": envelope.payload.member_agent_ids.len(),
                    }),
                )?;
            }
            let result_code = if envelope.payload.activation_state == CampActivationState::Pending {
                "camp.pending_created"
            } else {
                "camp.created"
            };
            Ok(CommandHandlerResult::applied(
                result_code,
                json!({
                    "campId": camp_id,
                    "title": title,
                    "activationState": envelope.payload.activation_state,
                    "defaultLeadAgentId": envelope.payload.default_lead_agent_id,
                    "collaborationMode": envelope.payload.collaboration_mode,
                    "memberCount": envelope.payload.member_agent_ids.len(),
                    "projectBindingKind": envelope.payload.project_binding_kind,
                    "projectPath": envelope.payload.project_path,
                }),
                Some(EntityReference {
                    entity_type: "camp".to_string(),
                    entity_id: camp_id.to_string(),
                }),
            ))
        })
    }

    pub fn rename_camp(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RenameCampCommand>,
    ) -> Result<CommandExecution> {
        let title = normalize_camp_name(&envelope.payload.title);
        if envelope.payload.title.trim().is_empty() {
            anyhow::bail!("Camp title must not be empty");
        }
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, ActorRef::User { .. }) {
                return Ok(rejected(
                    "camp.rename_user_required",
                    "Only a User can rename a Camp",
                ));
            }
            if title.chars().count() > CAMP_NAME_MAX_SCALARS {
                return Ok(rejected(
                    "camp.name_too_long",
                    "Camp name must not exceed 80 Unicode scalar values",
                ));
            }
            let version = transaction
                .query_row(
                    "SELECT version FROM camp WHERE id = ?1",
                    [&envelope.payload.camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let Some(version) = version else {
                return Ok(rejected("camp.not_found", "Camp does not exist"));
            };
            if camp_is_pending(transaction, &envelope.payload.camp_id)? {
                return Ok(rejected(
                    "camp.pending_activation_required",
                    "A pending Camp must be activated by its first message",
                ));
            }
            if version != envelope.payload.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "command.version_conflict",
                    json!({ "currentVersion": version }),
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE camp
                SET title = ?2, name_origin = 'user',
                    version = version + 1, updated_at = ?3
                WHERE id = ?1 AND version = ?4
                "#,
                params![
                    envelope.payload.camp_id,
                    title,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            append_domain_event(
                transaction,
                "camp.renamed",
                Some(&envelope.payload.camp_id),
                Some(("camp", &envelope.payload.camp_id)),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({ "title": title, "version": version + 1 }),
            )?;
            Ok(CommandHandlerResult::applied(
                "camp.renamed",
                json!({
                    "campId": envelope.payload.camp_id,
                    "title": title,
                    "version": version + 1,
                }),
                Some(EntityReference {
                    entity_type: "camp".to_string(),
                    entity_id: envelope.payload.camp_id.clone(),
                }),
            ))
        })
    }

    pub fn change_default_lead(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ChangeDefaultLeadCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            let version = transaction
                .query_row(
                    "SELECT version FROM camp WHERE id = ?1",
                    [&envelope.payload.camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let Some(version) = version else {
                return Ok(rejected("camp.not_found", "Camp does not exist"));
            };
            if camp_is_pending(transaction, &envelope.payload.camp_id)? {
                return Ok(rejected(
                    "camp.pending_activation_required",
                    "A pending Camp must be activated by its first message",
                ));
            }
            if version != envelope.payload.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "command.version_conflict",
                    json!({ "currentVersion": version }),
                ));
            }
            if !actor_has_capability(
                transaction,
                &envelope.actor,
                envelope.execution_epoch,
                &envelope.payload.camp_id,
                "camp.default_lead.change",
            )? {
                return Ok(rejected(
                    "command.capability_denied",
                    "Actor lacks camp.default_lead.change",
                ));
            }
            if !is_active_member(
                transaction,
                &envelope.payload.camp_id,
                &envelope.payload.successor_agent_id,
            )? {
                return Ok(rejected(
                    "camp.default_lead_unavailable",
                    "Default Lead must be an active Camp member",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE camp
                SET default_lead_agent_id = ?2, version = version + 1, updated_at = ?3
                WHERE id = ?1 AND version = ?4
                "#,
                params![
                    envelope.payload.camp_id,
                    envelope.payload.successor_agent_id,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            append_domain_event(
                transaction,
                "camp.default_lead_changed",
                Some(&envelope.payload.camp_id),
                Some(("agent_profile", &envelope.payload.successor_agent_id)),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({
                    "successorAgentId": envelope.payload.successor_agent_id,
                    "version": version + 1,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "camp.default_lead_changed",
                json!({
                    "campId": envelope.payload.camp_id,
                    "defaultLeadAgentId": envelope.payload.successor_agent_id,
                    "version": version + 1,
                }),
                Some(EntityReference {
                    entity_type: "camp".to_string(),
                    entity_id: envelope.payload.camp_id.clone(),
                }),
            ))
        })
    }

    pub fn reconcile_default_lead(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<ReconcileDefaultLeadCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, ActorRef::User { .. }) {
                return Ok(rejected(
                    "camp.default_lead_reconcile_user_required",
                    "Only a User can reconcile a Camp default Lead",
                ));
            }
            let camp = transaction
                .query_row(
                    "SELECT default_lead_agent_id, version FROM camp WHERE id = ?1",
                    [&envelope.payload.camp_id],
                    |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i64>(1)?)),
                )
                .optional()?;
            let Some((current_lead, version)) = camp else {
                return Ok(rejected("camp.not_found", "Camp does not exist"));
            };
            if camp_is_pending(transaction, &envelope.payload.camp_id)? {
                return Ok(rejected(
                    "camp.pending_activation_required",
                    "A pending Camp must be activated by its first message",
                ));
            }

            if let Some(current_lead_id) = current_lead.as_deref()
                && is_active_member(transaction, &envelope.payload.camp_id, current_lead_id)?
            {
                return Ok(CommandHandlerResult::applied(
                    "camp.default_lead_unchanged",
                    json!({
                        "campId": envelope.payload.camp_id,
                        "defaultLeadAgentId": current_lead_id,
                        "version": version,
                    }),
                    Some(EntityReference {
                        entity_type: "camp".to_string(),
                        entity_id: envelope.payload.camp_id.clone(),
                    }),
                ));
            }

            let successor = transaction
                .query_row(
                    r#"
                    SELECT camp_member.agent_id
                    FROM camp_member
                    JOIN agent_profile
                      ON agent_profile.id = camp_member.agent_id
                    WHERE camp_member.camp_id = ?1
                      AND camp_member.status = 'active'
                      AND camp_member.leave_requested_at IS NULL
                      AND agent_profile.profile_status = 'present'
                    ORDER BY agent_profile.member_order ASC, agent_profile.id ASC
                    LIMIT 1
                    "#,
                    [&envelope.payload.camp_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if successor == current_lead {
                return Ok(CommandHandlerResult::applied(
                    "camp.default_lead_unchanged",
                    json!({
                        "campId": envelope.payload.camp_id,
                        "defaultLeadAgentId": successor,
                        "version": version,
                    }),
                    Some(EntityReference {
                        entity_type: "camp".to_string(),
                        entity_id: envelope.payload.camp_id.clone(),
                    }),
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE camp
                SET default_lead_agent_id = ?2, version = version + 1, updated_at = ?3
                WHERE id = ?1 AND version = ?4
                "#,
                params![envelope.payload.camp_id, successor, now, version,],
            )?;
            append_domain_event(
                transaction,
                "camp.default_lead_reconciled",
                Some(&envelope.payload.camp_id),
                Some(("camp", &envelope.payload.camp_id)),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({
                    "previousDefaultLeadAgentId": current_lead,
                    "defaultLeadAgentId": successor,
                    "version": version + 1,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "camp.default_lead_reconciled",
                json!({
                    "campId": envelope.payload.camp_id,
                    "defaultLeadAgentId": successor,
                    "version": version + 1,
                }),
                Some(EntityReference {
                    entity_type: "camp".to_string(),
                    entity_id: envelope.payload.camp_id.clone(),
                }),
            ))
        })
    }

    pub fn delete_camp(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<DeleteCampCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, ActorRef::User { .. }) {
                return Ok(rejected(
                    "camp.delete_user_required",
                    "Only a User can permanently delete a Camp",
                ));
            }
            let version = transaction
                .query_row(
                    "SELECT version FROM camp WHERE id = ?1",
                    [&envelope.payload.camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            let Some(version) = version else {
                return Ok(rejected("camp.not_found", "Camp does not exist"));
            };
            if version != envelope.payload.expected_version {
                return Ok(CommandHandlerResult::rejected(
                    "command.version_conflict",
                    json!({ "currentVersion": version }),
                ));
            }

            let blockers = camp_delete_blockers(transaction, &envelope.payload.camp_id)?;
            if !blockers.is_empty() && !envelope.payload.force {
                return Ok(CommandHandlerResult::rejected(
                    "camp.delete_blocked",
                    json!({ "campId": envelope.payload.camp_id, "blockers": blockers }),
                ));
            }

            let forced = !blockers.is_empty();
            delete_camp_aggregate(transaction, &envelope.payload.camp_id)?;
            Ok(CommandHandlerResult::applied(
                "camp.deleted",
                json!({
                    "campId": envelope.payload.camp_id,
                    "forced": forced,
                    "bypassedBlockers": if forced { blockers } else { Vec::new() },
                }),
                None,
            ))
        })
    }

    pub fn discard_pending_camp(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<DiscardPendingCampCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, ActorRef::User { .. }) {
                return Ok(rejected(
                    "camp.pending_discard_user_required",
                    "Only a User can discard a pending Camp",
                ));
            }
            let state = transaction
                .query_row(
                    r#"
                    SELECT activation_state, version, last_message_sequence
                    FROM camp WHERE id = ?1
                    "#,
                    [&envelope.payload.camp_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )
                .optional()?;
            let Some((activation_state, version, last_message_sequence)) = state else {
                return Ok(CommandHandlerResult::applied(
                    "camp.pending_absent",
                    json!({
                        "campId": envelope.payload.camp_id,
                        "discarded": false,
                    }),
                    None,
                ));
            };
            if activation_state != "pending" {
                return Ok(rejected(
                    "camp.pending_discard_active",
                    "An active Camp cannot be discarded as a draft",
                ));
            }
            let meaningful_draft: bool = transaction.query_row(
                r#"
                SELECT
                    EXISTS(
                        SELECT 1 FROM camp_composer_draft
                        WHERE camp_id = ?1
                          AND (
                            length(trim(body)) > 0
                            OR reply_to_camp_message_id IS NOT NULL
                          )
                    )
                    OR EXISTS(
                        SELECT 1 FROM prepared_attachment WHERE camp_id = ?1
                    )
                "#,
                [&envelope.payload.camp_id],
                |row| row.get(0),
            )?;
            let has_domain_facts: bool = transaction.query_row(
                r#"
                SELECT
                    ?2 <> 1 OR ?3 <> 0
                    OR EXISTS(
                        SELECT 1 FROM event_log
                        WHERE camp_id = ?1 AND event_type <> 'command.result'
                    )
                    OR EXISTS(SELECT 1 FROM camp_message WHERE camp_id = ?1)
                    OR EXISTS(SELECT 1 FROM camp_turn WHERE camp_id = ?1)
                    OR EXISTS(SELECT 1 FROM task WHERE camp_id = ?1)
                    OR EXISTS(SELECT 1 FROM conversation WHERE camp_id = ?1)
                "#,
                params![envelope.payload.camp_id, version, last_message_sequence],
                |row| row.get(0),
            )?;
            if meaningful_draft || has_domain_facts {
                return Ok(CommandHandlerResult::rejected(
                    "camp.pending_not_empty",
                    json!({ "campId": envelope.payload.camp_id }),
                ));
            }
            delete_camp_aggregate(transaction, &envelope.payload.camp_id)?;
            Ok(CommandHandlerResult::applied(
                "camp.pending_discarded",
                json!({
                    "campId": envelope.payload.camp_id,
                    "discarded": true,
                }),
                None,
            ))
        })
    }

    pub fn discard_empty_pending_camps_on_startup(
        &self,
        database: &mut Database,
    ) -> Result<Vec<String>> {
        let transaction = database.connection_mut().transaction()?;
        let camp_ids = {
            let mut statement = transaction.prepare(
                r#"
                SELECT camp.id
                FROM camp
                WHERE camp.activation_state = 'pending'
                  AND camp.version = 1
                  AND camp.last_message_sequence = 0
                  AND NOT EXISTS(
                      SELECT 1 FROM event_log
                      WHERE camp_id = camp.id AND event_type <> 'command.result'
                  )
                  AND NOT EXISTS(
                      SELECT 1 FROM camp_composer_draft
                      WHERE camp_id = camp.id
                        AND (
                          length(trim(body)) > 0
                          OR reply_to_camp_message_id IS NOT NULL
                        )
                  )
                  AND NOT EXISTS(
                      SELECT 1 FROM prepared_attachment WHERE camp_id = camp.id
                  )
                "#,
            )?;
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        for camp_id in &camp_ids {
            delete_camp_aggregate(&transaction, camp_id)?;
        }
        transaction.commit()?;
        Ok(camp_ids)
    }

    pub fn add_camp_member(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<AddCampMemberCommand>,
    ) -> Result<CommandExecution> {
        validate_capability_overrides(&envelope.payload.capability_overrides)?;
        self.gateway.execute(database, envelope, |transaction| {
            let camp_state = transaction
                .query_row(
                    "SELECT default_lead_agent_id FROM camp WHERE id = ?1",
                    [&envelope.payload.camp_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?;
            let Some(default_lead) = camp_state else {
                return Ok(rejected("camp.not_found", "Camp does not exist"));
            };
            if camp_is_pending(transaction, &envelope.payload.camp_id)? {
                return Ok(rejected(
                    "camp.pending_activation_required",
                    "A pending Camp must be activated by its first message",
                ));
            }
            if !actor_has_capability(
                transaction,
                &envelope.actor,
                envelope.execution_epoch,
                &envelope.payload.camp_id,
                "camp.member.manage",
            )? {
                return Ok(rejected(
                    "command.capability_denied",
                    "Actor lacks camp.member.manage",
                ));
            }
            let profile_status = transaction
                .query_row(
                    "SELECT profile_status FROM agent_profile WHERE id = ?1",
                    [&envelope.payload.agent_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if profile_status.as_deref() != Some("present") {
                return Ok(rejected("agent.unavailable", "AgentProfile is not active"));
            }
            let active_member_count: i64 = transaction.query_row(
                r#"
                SELECT COUNT(*)
                FROM camp_member
                JOIN agent_profile ON agent_profile.id = camp_member.agent_id
                WHERE camp_member.camp_id = ?1
                  AND camp_member.status = 'active'
                  AND camp_member.leave_requested_at IS NULL
                  AND agent_profile.profile_status = 'present'
                "#,
                [&envelope.payload.camp_id],
                |row| row.get(0),
            )?;
            if active_member_count > 0 && default_lead.is_none() {
                return Ok(rejected(
                    "camp.default_lead_invariant",
                    "Camp has active members but no Default Lead",
                ));
            }

            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO camp_member(
                    camp_id, agent_id, status, capability_overrides_json,
                    leave_requested_at, leave_request_command_id,
                    pending_default_lead_successor_agent_id,
                    version, joined_at, left_at
                ) VALUES (?1, ?2, 'active', ?3, NULL, NULL, NULL, 1, ?4, NULL)
                ON CONFLICT(camp_id, agent_id) DO UPDATE SET
                    status = 'active',
                    capability_overrides_json = excluded.capability_overrides_json,
                    leave_requested_at = NULL,
                    leave_request_command_id = NULL,
                    pending_default_lead_successor_agent_id = NULL,
                    left_at = NULL,
                    version = camp_member.version + 1
                "#,
                params![
                    envelope.payload.camp_id,
                    envelope.payload.agent_id,
                    serde_json::to_string(&envelope.payload.capability_overrides)?,
                    now,
                ],
            )?;

            if default_lead.is_none() {
                transaction.execute(
                    r#"
                    UPDATE camp
                    SET default_lead_agent_id = ?2, version = version + 1, updated_at = ?3
                    WHERE id = ?1 AND default_lead_agent_id IS NULL
                    "#,
                    params![envelope.payload.camp_id, envelope.payload.agent_id, now,],
                )?;
            }
            append_domain_event(
                transaction,
                "camp.member_added",
                Some(&envelope.payload.camp_id),
                Some(("agent_profile", &envelope.payload.agent_id)),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({}),
            )?;
            Ok(CommandHandlerResult::applied(
                "camp.member_added",
                json!({
                    "campId": envelope.payload.camp_id,
                    "agentId": envelope.payload.agent_id,
                }),
                Some(EntityReference {
                    entity_type: "camp_member".to_string(),
                    entity_id: format!(
                        "{}:{}",
                        envelope.payload.camp_id, envelope.payload.agent_id
                    ),
                }),
            ))
        })
    }

    pub fn create_task(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateTaskCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if matches!(envelope.actor, ActorRef::System { .. }) {
                return Ok(rejected(
                    "task.actor_not_allowed",
                    "System components cannot create business Tasks",
                ));
            }
            if matches!(envelope.actor, ActorRef::Agent { .. })
                && (!actor_can_write_camp(
                    transaction,
                    &envelope.actor,
                    envelope.execution_epoch,
                    &envelope.payload.camp_id,
                )? || !actor_is_default_lead(
                    transaction,
                    &envelope.payload.camp_id,
                    &envelope.actor,
                )?)
            {
                return Ok(rejected(
                    "task.create_forbidden",
                    "Only the current Camp Default Lead can create a Task",
                ));
            }
            validate_task_input(&envelope.payload)?;
            let title = envelope.payload.title.trim().to_string();
            let description = envelope.payload.description.trim().to_string();
            let acceptance_criteria =
                normalize_acceptance_criteria(&envelope.payload.acceptance_criteria, true)?;
            let task_id = Uuid::new_v4().to_string();
            if envelope.camp_id.as_deref() != Some(envelope.payload.camp_id.as_str()) {
                return Ok(rejected(
                    "task.camp_mismatch",
                    "Task is outside the command Camp",
                ));
            }
            let camp_exists = transaction
                .query_row(
                    "SELECT 1 FROM camp WHERE id = ?1",
                    [&envelope.payload.camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            if camp_exists.is_none() {
                return Ok(rejected("camp.not_found", "Camp does not exist"));
            }
            if camp_is_pending(transaction, &envelope.payload.camp_id)? {
                return Ok(rejected(
                    "camp.pending_activation_required",
                    "A pending Camp must be activated by its first message",
                ));
            }
            if !is_current_camp_member(
                transaction,
                &envelope.payload.camp_id,
                &envelope.payload.assignee_agent_id,
            )? {
                return Ok(rejected(
                    "task.assignee_unavailable",
                    "Task assignee is not a current Camp member",
                ));
            }

            let open_task_count: i64 = transaction.query_row(
                "SELECT COUNT(*) FROM task WHERE camp_id = ?1 AND status IN ('pending', 'in_progress', 'blocked')",
                [&envelope.payload.camp_id],
                |row| row.get(0),
            )?;
            if open_task_count >= 512 {
                return Ok(rejected(
                    "task.camp_capacity_exceeded",
                    "Camp already has 512 non-terminal Tasks",
                ));
            }

            let now = chrono::Utc::now().to_rfc3339();
            let (created_by_type, created_by_id, source_agent_run_id) =
                task_creator_parts(&envelope.actor)?;
            if let Some(source_agent_run_id) = source_agent_run_id {
                let source_task_count: i64 = transaction.query_row(
                    "SELECT COUNT(*) FROM task WHERE source_agent_run_id = ?1",
                    [source_agent_run_id],
                    |row| row.get(0),
                )?;
                if source_task_count >= 32 {
                    return Ok(rejected(
                        "task.source_run_capacity_exceeded",
                        "Source AgentRun already created 32 Tasks",
                    ));
                }
            }
            transaction.execute(
                r#"
                INSERT INTO task(
                    id, camp_id, title, description, acceptance_criteria_json, status,
                    assignee_agent_id, created_by_type, created_by_id,
                    source_agent_run_id,
                    blocked_reason, completion_summary, cancel_reason,
                    closed_by_type, closed_by_id, closed_by_agent_run_id,
                    version, created_at, updated_at, closed_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, 'pending',
                    ?6, ?7, ?8, ?9,
                    NULL, NULL, NULL, NULL, NULL, NULL,
                    1, ?10, ?10, NULL
                )
                "#,
                params![
                    task_id,
                    envelope.payload.camp_id,
                    title,
                    description,
                    serde_json::to_string(&acceptance_criteria)?,
                    envelope.payload.assignee_agent_id,
                    created_by_type,
                    created_by_id,
                    source_agent_run_id,
                    now,
                ],
            )?;
            append_domain_event(
                transaction,
                "task.created",
                Some(&envelope.payload.camp_id),
                Some(("task", &task_id)),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({
                    "status": "pending",
                    "assigneeAgentId": envelope.payload.assignee_agent_id,
                }),
            )?;
            let detail = load_task_detail(
                transaction,
                &task_id,
                &envelope.actor,
                matches!(envelope.actor, ActorRef::User { .. })
                    || actor_is_default_lead(
                        transaction,
                        &envelope.payload.camp_id,
                        &envelope.actor,
                    )?,
            )?
            .context("new Task is missing")?;
            Ok(CommandHandlerResult::applied(
                "task.created",
                serde_json::to_value(detail)?,
                Some(EntityReference {
                    entity_type: "task".to_string(),
                    entity_id: task_id.clone(),
                }),
            ))
        })
    }

    pub fn update_task(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<UpdateTaskCommand>,
    ) -> Result<CommandExecution> {
        validate_task_update_input(&envelope.payload)?;
        self.gateway.execute(database, envelope, |transaction| {
            let task = load_task_record(transaction, &envelope.payload.task_id)?;
            let Some(mut projected) = task else {
                return Ok(rejected("task.not_found", "Task does not exist"));
            };
            if envelope.camp_id.as_deref() != Some(projected.camp_id.as_str()) {
                return Ok(rejected("task.not_found", "Task does not exist"));
            }
            if camp_is_pending(transaction, &projected.camp_id)? {
                return Ok(rejected(
                    "camp.pending_activation_required",
                    "A pending Camp must be activated by its first message",
                ));
            }
            let scope = match task_read_scope(
                transaction,
                &projected.camp_id,
                &envelope.actor,
                envelope.execution_epoch,
            ) {
                Ok(scope) => scope,
                Err(_) => return Ok(rejected("task.not_found", "Task does not exist")),
            };
            if !scope.can_read(&projected) {
                return Ok(rejected("task.not_found", "Task does not exist"));
            }
            if matches!(projected.status, TaskStatus::Completed | TaskStatus::Cancelled) {
                return Ok(rejected(
                    "task.terminal",
                    "Completed or cancelled Tasks are immutable",
                ));
            }
            if matches!(envelope.actor, ActorRef::System { .. }) {
                return Ok(rejected(
                    "task.actor_not_allowed",
                    "System components cannot update business Tasks",
                ));
            }
            let is_default_lead = actor_is_default_lead(
                transaction,
                &projected.camp_id,
                &envelope.actor,
            )?;
            let can_update_any = matches!(envelope.actor, ActorRef::User { .. }) || is_default_lead;
            if !can_update_any
                && (!agent_can_update_task(
                    &envelope.actor,
                    projected.assignee_agent_id.as_deref(),
                ) || !assignee_update_fields_allowed(&envelope.payload))
            {
                return Ok(rejected(
                    "task.update_forbidden",
                    "An Assignee can update only its own execution-state fields; the User or current Default Lead owns Task responsibility definition",
                ));
            }
            if projected.version != envelope.payload.expected_version {
                return Ok(task_version_conflict(
                    &envelope.payload.task_id,
                    projected.version,
                    "Task version does not match expectedVersion",
                ));
            }

            let next_assignee = match &envelope.payload.assignee {
                TaskAssigneeUpdate::Unchanged => projected.assignee_agent_id.clone(),
                TaskAssigneeUpdate::Assign { agent_id } => {
                    if !is_current_camp_member(transaction, &projected.camp_id, agent_id)? {
                        return Ok(rejected(
                            "task.assignee_unavailable",
                            "Task assignee is not a current Camp member",
                        ));
                    }
                    Some(agent_id.clone())
                }
                TaskAssigneeUpdate::Clear => None,
            };
            let original = projected.clone();
            projected.assignee_agent_id = next_assignee;
            if let Some(title) = &envelope.payload.title {
                projected.title = title.trim().to_string();
            }
            if let Some(description) = &envelope.payload.description {
                projected.description = description.trim().to_string();
            }
            match &envelope.payload.acceptance_criteria {
                TaskAcceptanceCriteriaUpdate::Unchanged => {}
                TaskAcceptanceCriteriaUpdate::Replace { items } => {
                    projected.acceptance_criteria = normalize_acceptance_criteria(items, false)?;
                }
                TaskAcceptanceCriteriaUpdate::Clear => projected.acceptance_criteria.clear(),
            }
            if let Some(status) = envelope.payload.status {
                projected.status = status;
            }
            if !can_update_any
                && !assignee_transition_allowed(original.status, projected.status)
            {
                return Ok(rejected(
                    "task.update_forbidden",
                    "Assignee status transition is outside execution-state authority",
                ));
            }
            projected.blocked_reason = if projected.status == TaskStatus::Blocked {
                envelope
                    .payload
                    .blocked_reason
                    .as_deref()
                    .map(str::trim)
                    .map(str::to_string)
                    .or(original.blocked_reason.clone())
            } else {
                None
            };
            projected.completion_summary = if projected.status == TaskStatus::Completed {
                envelope
                    .payload
                    .completion_summary
                    .as_deref()
                    .map(str::trim)
                    .map(str::to_string)
            } else {
                None
            };
            projected.cancel_reason = if projected.status == TaskStatus::Cancelled {
                envelope
                    .payload
                    .cancel_reason
                    .as_deref()
                    .map(str::trim)
                    .map(str::to_string)
            } else {
                None
            };
            if projected.status != TaskStatus::Blocked && envelope.payload.blocked_reason.is_some()
                || projected.status != TaskStatus::Completed
                    && envelope.payload.completion_summary.is_some()
                || projected.status != TaskStatus::Cancelled && envelope.payload.cancel_reason.is_some()
            {
                return Ok(rejected(
                    "task.invalid_projected_state",
                    "Status notes are only valid for their matching final status",
                ));
            }
            if matches!(envelope.payload.assignee, TaskAssigneeUpdate::Clear)
                && projected.status != TaskStatus::Pending
            {
                return Ok(rejected(
                    "task.invalid_projected_state",
                    "Clearing the assignee requires final status pending",
                ));
            }
            if let Err(message) = validate_projected_task(&projected) {
                return Ok(rejected("task.invalid_projected_state", &message));
            }

            let changed = task_business_fields_changed(&original, &projected);
            if !changed {
                let detail = TaskDetail {
                    available_actions: task_available_actions(
                        &envelope.actor,
                        &original,
                        can_update_any,
                    ),
                    task: original,
                };
                let mut value = serde_json::to_value(detail)?;
                value["changed"] = json!(false);
                return Ok(CommandHandlerResult::applied(
                    "task.unchanged",
                    value,
                    Some(EntityReference {
                        entity_type: "task".to_string(),
                        entity_id: envelope.payload.task_id.clone(),
                    }),
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            if matches!(projected.status, TaskStatus::Completed | TaskStatus::Cancelled) {
                let (closed_by_type, closed_by_id, closed_by_agent_run_id) =
                    task_creator_parts(&envelope.actor)?;
                projected.closed_by_type = Some(closed_by_type.to_string());
                projected.closed_by_id = Some(closed_by_id.to_string());
                projected.closed_by_agent_run_id = closed_by_agent_run_id.map(str::to_string);
                projected.closed_at = Some(now.clone());
            } else {
                projected.closed_by_type = None;
                projected.closed_by_id = None;
                projected.closed_by_agent_run_id = None;
                projected.closed_at = None;
            }
            let updated = transaction.execute(
                r#"
                UPDATE task
                SET title = ?2, description = ?3, acceptance_criteria_json = ?4,
                    status = ?5, assignee_agent_id = ?6,
                    blocked_reason = ?7, completion_summary = ?8, cancel_reason = ?9,
                    closed_by_type = ?10, closed_by_id = ?11,
                    closed_by_agent_run_id = ?12, closed_at = ?13,
                    version = version + 1, updated_at = ?14
                WHERE id = ?1 AND version = ?15
                "#,
                params![
                    envelope.payload.task_id,
                    projected.title,
                    projected.description,
                    serde_json::to_string(&projected.acceptance_criteria)?,
                    projected.status.as_str(),
                    projected.assignee_agent_id,
                    projected.blocked_reason,
                    projected.completion_summary,
                    projected.cancel_reason,
                    projected.closed_by_type,
                    projected.closed_by_id,
                    projected.closed_by_agent_run_id,
                    projected.closed_at,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            if updated != 1 {
                return Ok(task_version_conflict(
                    &envelope.payload.task_id,
                    original.version,
                    "Task version changed while applying the update",
                ));
            }
            append_domain_event(
                transaction,
                "task.updated",
                Some(&projected.camp_id),
                Some(("task", &envelope.payload.task_id)),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({
                    "previousStatus": original.status,
                    "status": projected.status,
                    "assigneeAgentId": projected.assignee_agent_id,
                    "version": original.version + 1,
                }),
            )?;
            let mut detail = load_task_detail(
                transaction,
                &envelope.payload.task_id,
                &envelope.actor,
                can_update_any,
            )?
            .context("updated Task is missing")?;
            detail.task.version = original.version + 1;
            let mut value = serde_json::to_value(detail)?;
            value["changed"] = json!(true);
            Ok(CommandHandlerResult::applied(
                "task.updated",
                value,
                Some(EntityReference {
                    entity_type: "task".to_string(),
                    entity_id: envelope.payload.task_id.clone(),
                }),
            ))
        })
    }

    pub fn list_visible_tasks(
        &self,
        database: &Database,
        camp_id: &str,
        actor: &ActorRef,
        execution_epoch: Option<i64>,
    ) -> Result<Vec<TaskRecord>> {
        let scope = task_read_scope(database.connection(), camp_id, actor, execution_epoch)?;
        let mut statement = database.connection().prepare(
            r#"
            SELECT id, camp_id, title, description, acceptance_criteria_json, status,
                   assignee_agent_id, blocked_reason, completion_summary, cancel_reason,
                   created_by_type, created_by_id, source_agent_run_id,
                   closed_by_type, closed_by_id, closed_by_agent_run_id,
                   version, created_at, updated_at, closed_at
            FROM task
            WHERE camp_id = ?1
            ORDER BY created_at DESC, id DESC
            "#,
        )?;
        let rows = statement.query_map([camp_id], task_record_from_row)?;
        let mut tasks = Vec::new();
        for row in rows {
            let task = row?;
            if scope.can_read(&task) {
                tasks.push(task);
            }
        }
        Ok(tasks)
    }

    pub fn query_visible_tasks(
        &self,
        database: &Database,
        camp_id: &str,
        actor: &ActorRef,
        execution_epoch: Option<i64>,
        query: &TaskListQuery,
    ) -> Result<TaskListPage> {
        let can_update_any = matches!(actor, ActorRef::User { .. })
            || actor_is_default_lead(database.connection(), camp_id, actor)?;
        task_read_scope(database.connection(), camp_id, actor, execution_epoch)?;
        let mut statuses = query.statuses.clone().unwrap_or_else(|| {
            vec![
                TaskStatus::Pending,
                TaskStatus::InProgress,
                TaskStatus::Blocked,
            ]
        });
        let mut seen_statuses = BTreeSet::new();
        statuses.retain(|status| seen_statuses.insert(*status));
        if statuses.is_empty() {
            anyhow::bail!("task.invalid_status_filter: statuses must not be empty");
        }
        let limit = if query.limit == 0 {
            50
        } else {
            query.limit.clamp(1, 100)
        };
        let cursor = query
            .cursor
            .as_deref()
            .map(decode_task_cursor)
            .transpose()?;
        let status_values = statuses
            .iter()
            .map(|status| status.as_str())
            .collect::<Vec<_>>();
        let status_placeholders = (0..status_values.len())
            .map(|index| format!("?{}", index + 2))
            .collect::<Vec<_>>()
            .join(", ");
        let mut sql = format!(
            "SELECT id, title, status, assignee_agent_id, created_at FROM task WHERE camp_id = ?1 AND status IN ({status_placeholders})"
        );
        let mut values: Vec<rusqlite::types::Value> = vec![camp_id.to_string().into()];
        values.extend(
            status_values
                .into_iter()
                .map(|value| value.to_string().into()),
        );
        match &query.assignee {
            TaskAssigneeFilter::Any => {}
            TaskAssigneeFilter::Unassigned => sql.push_str(" AND assignee_agent_id IS NULL"),
            TaskAssigneeFilter::Agent { agent_id } => {
                sql.push_str(" AND assignee_agent_id = ?");
                values.push(agent_id.clone().into());
            }
        }
        if let Some((created_at, id)) = &cursor {
            sql.push_str(" AND (created_at < ? OR (created_at = ? AND id < ?))");
            values.push(created_at.clone().into());
            values.push(created_at.clone().into());
            values.push(id.clone().into());
        }
        sql.push_str(" ORDER BY created_at DESC, id DESC LIMIT ?");
        values.push(((limit + 1) as i64).into());
        let mut statement = database.connection().prepare(&sql)?;
        let mut matching = statement
            .query_map(rusqlite::params_from_iter(values), task_list_row_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let truncated = matching.len() > limit;
        matching.truncate(limit);
        let next_cursor = truncated
            .then(|| {
                matching
                    .last()
                    .map(|task| encode_task_cursor(&task.created_at, &task.task_id))
            })
            .flatten();
        let tasks = matching
            .into_iter()
            .map(|task| task_list_item(actor, task, can_update_any))
            .collect();
        Ok(TaskListPage {
            tasks,
            next_cursor,
            truncated,
        })
    }

    pub fn get_visible_task(
        &self,
        database: &Database,
        camp_id: &str,
        task_id: &str,
        actor: &ActorRef,
        execution_epoch: Option<i64>,
    ) -> Result<Option<TaskQueryItem>> {
        let can_update_any = matches!(actor, ActorRef::User { .. })
            || actor_is_default_lead(database.connection(), camp_id, actor)?;
        let scope = task_read_scope(database.connection(), camp_id, actor, execution_epoch)?;
        let task = database
            .connection()
            .query_row(
                r#"
                SELECT id, camp_id, title, description, acceptance_criteria_json, status,
                       assignee_agent_id, blocked_reason, completion_summary, cancel_reason,
                       created_by_type, created_by_id, source_agent_run_id,
                       closed_by_type, closed_by_id, closed_by_agent_run_id,
                       version, created_at, updated_at, closed_at
                FROM task
                WHERE id = ?1 AND camp_id = ?2
                "#,
                params![task_id, camp_id],
                task_record_from_row,
            )
            .optional()?;
        Ok(task
            .filter(|candidate| scope.can_read(candidate))
            .map(|task| TaskQueryItem {
                available_actions: task_available_actions(actor, &task, can_update_any),
                task,
            }))
    }

    pub fn send_user_camp_draft(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SendUserCampDraftCommand>,
    ) -> Result<CommandExecution> {
        self.send_user_camp_draft_with_publication(database, envelope, None)
    }

    pub fn send_user_camp_draft_with_publication(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SendUserCampDraftCommand>,
        attachment_publication_operation_id: Option<&str>,
    ) -> Result<CommandExecution> {
        Self::validate_send_message_input(&envelope.payload)?;
        let camp_message_id = Uuid::new_v4().to_string();
        let camp_turn_id = envelope
            .payload
            .execution
            .as_ref()
            .map(|_| Uuid::new_v4().to_string());
        self.gateway.execute(database, envelope, |transaction| {
            let camp_exists = transaction
                .query_row(
                    "SELECT 1 FROM camp WHERE id = ?1",
                    [&envelope.payload.camp_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;
            if camp_exists.is_none() {
                return Ok(rejected("camp.not_found", "Camp does not exist"));
            }
            if !actor_can_write_camp(
                transaction,
                &envelope.actor,
                envelope.execution_epoch,
                &envelope.payload.camp_id,
            )? {
                return Ok(rejected(
                    "camp.actor_unavailable",
                    "Agent Actor is not active in this Camp or its Run epoch is stale",
                ));
            }
            if envelope.payload.execution.is_some()
                && !actor_has_capability(
                    transaction,
                    &envelope.actor,
                    envelope.execution_epoch,
                    &envelope.payload.camp_id,
                    "agent_run.create",
                )?
            {
                return Ok(rejected(
                    "command.capability_denied",
                    "Actor lacks agent_run.create",
                ));
            }
            let submission = match load_structured_draft_submission(
                transaction,
                &envelope.payload.camp_id,
                envelope.payload.draft_revision,
            )? {
                Ok(submission) => submission,
                Err(rejection) => return Ok(rejection),
            };
            let mut resolution = match resolve_address(
                transaction,
                &envelope.payload.camp_id,
                &submission.address,
                &envelope.actor,
            )? {
                AddressingOutcome::Resolved(resolution) => resolution,
                AddressingOutcome::Rejected(result) => return Ok(result),
            };
            if envelope.payload.execution.is_some() && resolution.targets.is_empty() {
                return Ok(rejected(
                    "camp_message.no_addressable_member",
                    "Execution request requires at least one addressable Agent",
                ));
            }
            let task_admission = if let Some(task_id) = envelope
                .payload
                .execution
                .as_ref()
                .and_then(|execution| execution.task_id.as_deref())
            {
                if resolution.targets.len() != 1 {
                    return Ok(rejected(
                        "agent_run.task_recipient_mismatch",
                        "Task-linked execution requires exactly one recipient",
                    ));
                }
                match task_link_admission(
                    transaction,
                    task_id,
                    &envelope.payload.camp_id,
                    &resolution.targets[0].agent_id,
                )? {
                    Some(admission) => Some(admission),
                    None => {
                        return Ok(rejected(
                            "agent_run.task_not_executable",
                            "Task is not ready for this executable assignee",
                        ));
                    }
                }
            } else {
                None
            };
            let now = camp_turn_execution_budget_now().to_rfc3339();
            let created_conversation_ids = if envelope.payload.execution.is_some() {
                ensure_resolution_conversations(
                    transaction,
                    &envelope.payload.camp_id,
                    &mut resolution,
                    &now,
                )?
            } else {
                Vec::new()
            };
            let effective_configs = if envelope.payload.execution.is_some() {
                match prepare_agent_run_configs(transaction, &resolution)? {
                    Ok(configs) => Some(configs),
                    Err(rejection) => {
                        delete_new_conversations(transaction, &created_conversation_ids)?;
                        return Ok(rejection);
                    }
                }
            } else {
                None
            };
            let frozen_execution_budget = if let Some(execution) = &envelope.payload.execution {
                match freeze_camp_turn_execution_budget(
                    execution.budget.as_ref(),
                    chrono::DateTime::parse_from_rfc3339(&now)?.with_timezone(&chrono::Utc),
                    i64::try_from(resolution.targets.len())
                        .context("root AgentRun responsibility count overflow")?,
                ) {
                    Ok(budget) => Some(budget),
                    Err(error) => {
                        delete_new_conversations(transaction, &created_conversation_ids)?;
                        return Ok(rejected(
                            "camp_turn.execution_budget_invalid",
                            &error.to_string(),
                        ));
                    }
                }
            } else {
                None
            };

            let queued = queue_camp_message_and_runs(
                transaction,
                QueueCampMessageInput {
                    camp_message_id: &camp_message_id,
                    camp_turn_id: camp_turn_id.as_deref(),
                    camp_id: &envelope.payload.camp_id,
                    body: &submission.body,
                    structured_content: &submission.structured_content,
                    prepared_attachment_ids: &submission.prepared_attachment_ids,
                    legacy_attachment_publication_operation_id: attachment_publication_operation_id,
                    draft_revision: envelope.payload.draft_revision,
                    address_mode: submission.address.mode(),
                    reply_to_camp_message_id: submission.reply_to_camp_message_id.as_deref(),
                    resolution: &resolution,
                    execution: envelope.payload.execution.as_ref(),
                    task_admission: task_admission.as_ref(),
                    frozen_execution_budget: frozen_execution_budget.as_ref(),
                    effective_configs: effective_configs.as_ref(),
                    workspace: None,
                    actor: &envelope.actor,
                    execution_epoch: envelope.execution_epoch,
                    command_id: &envelope.command_id,
                    now: &now,
                    generated_camp_name: matches!(envelope.actor, ActorRef::User { .. })
                        .then(|| submission.generated_camp_name.clone()),
                },
            )?;
            let result_payload = json!({
                "campMessageId": camp_message_id,
                "sequence": queued.camp_sequence,
                "campTurnId": camp_turn_id,
                "agentRunIds": queued.agent_run_ids,
                "executionBudget": frozen_execution_budget,
            });
            let entity = camp_turn_id
                .as_ref()
                .map(|id| EntityReference {
                    entity_type: "camp_turn".to_string(),
                    entity_id: id.clone(),
                })
                .or_else(|| {
                    Some(EntityReference {
                        entity_type: "camp_message".to_string(),
                        entity_id: camp_message_id.clone(),
                    })
                });
            if camp_turn_id.is_some() {
                Ok(CommandHandlerResult::accepted(
                    "camp_turn.queued",
                    result_payload,
                    entity,
                ))
            } else {
                Ok(CommandHandlerResult::applied(
                    "camp_message.sent",
                    result_payload,
                    entity,
                ))
            }
        })
    }
}

struct QueuedCampMessage {
    camp_sequence: i64,
    agent_run_ids: Vec<String>,
}

struct PreparedAgentRunConfig {
    effective_config: Value,
    runtime: FrozenAgentRuntimeConfig,
}

struct CampMessageSubmission {
    body: String,
    structured_content: StructuredCampMessageContent,
    prepared_attachment_ids: Vec<String>,
    address: CampMessageAddress,
    reply_to_camp_message_id: Option<String>,
    generated_camp_name: String,
}

#[derive(Debug, Clone)]
enum CampMessageAddress {
    Default,
    Explicit { agent_ids: Vec<String> },
    Broadcast,
}

impl CampMessageAddress {
    fn mode(&self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Explicit { .. } => "explicit",
            Self::Broadcast => "broadcast",
        }
    }
}

fn materialize_leading_member_mention(
    content: &mut StructuredCampMessageContent,
    agent_id: String,
) {
    content.insert(0, StructuredCampMessageSegment::MemberMention { agent_id });
    let has_leading_whitespace = matches!(
        content.get(1),
        Some(StructuredCampMessageSegment::Text { text })
            if text.chars().next().is_some_and(char::is_whitespace)
    );
    if !has_leading_whitespace {
        content.insert(
            1,
            StructuredCampMessageSegment::Text {
                text: " ".to_string(),
            },
        );
    }
    *content = normalize_content(std::mem::take(content));
}

fn load_structured_draft_submission(
    transaction: &Transaction<'_>,
    camp_id: &str,
    expected_revision: i64,
) -> Result<std::result::Result<CampMessageSubmission, CommandHandlerResult>> {
    let stored = transaction
        .query_row(
            r#"
            SELECT structured_content_json, revision,
                   reply_to_camp_message_id, recipient_selection_required,
                   continuation_source_message_id,
                   continuation_suppressed_source_message_id,
                   recipient_selection_touched
            FROM camp_composer_draft
            WHERE camp_id = ?1
            "#,
            [camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, bool>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((
        content_json,
        revision,
        reply_to_camp_message_id,
        recipient_required,
        continuation_source_message_id,
        continuation_suppressed_source_message_id,
        recipient_selection_touched,
    )) = stored
    else {
        return Ok(Err(rejected(
            "draft_changed",
            "Camp Composer Draft no longer matches the requested Revision",
        )));
    };
    if revision != expected_revision {
        return Ok(Err(rejected(
            "draft_changed",
            "Camp Composer Draft no longer matches the requested Revision",
        )));
    }
    if recipient_required {
        return Ok(Err(rejected(
            "reply_recipient_required",
            "Reply author is unavailable; choose an explicit replacement recipient",
        )));
    }
    if let Some(reply_id) = &reply_to_camp_message_id {
        let reply_is_available: bool = transaction.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM camp_message
                WHERE id = ?1 AND camp_id = ?2 AND tombstoned_at IS NULL
            )
            "#,
            params![reply_id, camp_id],
            |row| row.get(0),
        )?;
        if !reply_is_available {
            return Ok(Err(rejected(
                "camp_message.invalid_reply",
                "Reply target is outside the Camp or no longer available",
            )));
        }
    }

    let mut content = normalize_content(
        serde_json::from_str::<StructuredCampMessageContent>(&content_json)
            .context("Camp Composer Draft contains invalid Structured Content")?,
    );
    validate_user_authored_content(&content)?;
    if reply_to_camp_message_id.is_none()
        && !recipient_selection_touched
        && !has_all_members_mention(&content)
        && member_mention_ids(&content).is_empty()
        && let Some(source_message_id) = continuation_source_message_id.as_deref()
        && continuation_suppressed_source_message_id.as_deref() != Some(source_message_id)
    {
        let source_recipient = transaction
            .query_row(
                r#"
                SELECT address_mode, addressed_agent_ids_json
                FROM camp_message
                WHERE id = ?1 AND camp_id = ?2
                  AND author_type = 'user'
                  AND tombstoned_at IS NULL
                "#,
                params![source_message_id, camp_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let continuation_agent_id = source_recipient.and_then(|(mode, agent_ids_json)| {
            if mode != "explicit" {
                return None;
            }
            serde_json::from_str::<Vec<String>>(&agent_ids_json)
                .ok()
                .filter(|agent_ids| agent_ids.len() == 1)
                .and_then(|mut agent_ids| agent_ids.pop())
        });
        let Some(continuation_agent_id) = continuation_agent_id else {
            return Ok(Err(rejected(
                "continuation_recipient_required",
                "Continuation recipient is no longer valid; choose an explicit replacement recipient",
            )));
        };
        if active_address_target(transaction, camp_id, &continuation_agent_id)?.is_none() {
            return Ok(Err(rejected(
                "continuation_recipient_required",
                "Continuation recipient is unavailable; choose an explicit replacement recipient",
            )));
        }
        materialize_leading_member_mention(&mut content, continuation_agent_id);
    }
    let mentioned_agent_ids = member_mention_ids(&content);
    let mut member_names = BTreeMap::new();
    for agent_id in &mentioned_agent_ids {
        let display_name = transaction
            .query_row(
                "SELECT display_name FROM agent_profile WHERE id = ?1",
                [agent_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if display_name.is_none()
            || active_address_target(transaction, camp_id, agent_id)?.is_none()
        {
            return Ok(Err(rejected(
                "mention_target_unavailable",
                "Every Member Mention must identify a present current Camp member",
            )));
        }
        member_names.insert(
            agent_id.clone(),
            display_name.expect("checked Member Mention identity"),
        );
    }
    let body = render_plain_text(&content, |agent_id| member_names.get(agent_id).cloned())?;
    let prepared_attachment_ids = {
        let mut statement = transaction.prepare(
            r#"
            SELECT id
            FROM prepared_attachment
            WHERE camp_id = ?1 AND state = 'ready'
            ORDER BY ordinal, id
            "#,
        )?;
        statement
            .query_map([camp_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    if body.trim().is_empty() && prepared_attachment_ids.is_empty() {
        return Ok(Err(rejected(
            "camp_message.empty_body",
            "Camp message must contain text or at least one ready attachment",
        )));
    }
    let generated_camp_name =
        generated_camp_name(&content, |agent_id| member_names.get(agent_id).cloned())?;

    let address = if has_all_members_mention(&content) {
        CampMessageAddress::Broadcast
    } else if mentioned_agent_ids.is_empty() {
        CampMessageAddress::Default
    } else {
        CampMessageAddress::Explicit {
            agent_ids: mentioned_agent_ids,
        }
    };
    Ok(Ok(CampMessageSubmission {
        body,
        structured_content: content,
        prepared_attachment_ids,
        address,
        reply_to_camp_message_id,
        generated_camp_name,
    }))
}

struct QueueCampMessageInput<'a> {
    camp_message_id: &'a str,
    camp_turn_id: Option<&'a str>,
    camp_id: &'a str,
    body: &'a str,
    structured_content: &'a [StructuredCampMessageSegment],
    prepared_attachment_ids: &'a [String],
    legacy_attachment_publication_operation_id: Option<&'a str>,
    draft_revision: i64,
    address_mode: &'a str,
    reply_to_camp_message_id: Option<&'a str>,
    resolution: &'a AddressResolution,
    execution: Option<&'a ExecutionRequest>,
    task_admission: Option<&'a TaskLinkAdmission>,
    frozen_execution_budget: Option<&'a FrozenCampTurnExecutionBudget>,
    effective_configs: Option<&'a BTreeMap<String, PreparedAgentRunConfig>>,
    workspace: Option<&'a AgentRunWorkspace>,
    actor: &'a ActorRef,
    execution_epoch: Option<i64>,
    command_id: &'a str,
    now: &'a str,
    generated_camp_name: Option<String>,
}

fn queue_camp_message_and_runs(
    transaction: &Transaction<'_>,
    input: QueueCampMessageInput<'_>,
) -> Result<QueuedCampMessage> {
    if input.execution.is_some() != input.camp_turn_id.is_some() {
        anyhow::bail!("CampTurn identity must match the execution request");
    }
    if input.execution.is_some() != input.effective_configs.is_some() {
        anyhow::bail!("AgentRun effective configurations must be prepared before queueing");
    }
    if input.execution.is_some() != input.frozen_execution_budget.is_some() {
        anyhow::bail!("CampTurn execution has no frozen Execution Budget");
    }
    let activation_state: String = transaction.query_row(
        "SELECT activation_state FROM camp WHERE id = ?1",
        [input.camp_id],
        |row| row.get(0),
    )?;
    transaction.execute(
        r#"
        UPDATE camp
        SET last_message_sequence = last_message_sequence + 1,
            activation_state = 'active',
            title = CASE
                WHEN name_origin = 'default' AND ?3 IS NOT NULL THEN ?3
                ELSE title
            END,
            name_origin = CASE
                WHEN name_origin = 'default' AND ?3 IS NOT NULL THEN 'generated'
                ELSE name_origin
            END,
            version = version + 1,
            updated_at = ?2
        WHERE id = ?1
        "#,
        params![
            input.camp_id,
            input.now,
            input.generated_camp_name.as_deref()
        ],
    )?;
    if activation_state == "pending" {
        append_domain_event(
            transaction,
            "camp.activated",
            Some(input.camp_id),
            Some(("camp", input.camp_id)),
            input.actor,
            input.execution_epoch,
            &json!({ "activationState": "active" }),
        )?;
    }
    let camp_sequence: i64 = transaction.query_row(
        "SELECT last_message_sequence FROM camp WHERE id = ?1",
        [input.camp_id],
        |row| row.get(0),
    )?;

    if let Some(camp_turn_id) = input.camp_turn_id {
        let budget = input
            .frozen_execution_budget
            .context("CampTurn execution has no frozen budget")?;
        transaction.execute(
            r#"
                INSERT INTO camp_turn(
                    id, camp_id, trigger_type, trigger_id, status,
                    cancel_requested_at, cancel_request_command_id,
                    execution_budget_schema_version,
                    execution_budget_accepted_at, execution_budget_deadline_at,
                    execution_budget_elapsed_seconds,
                    execution_budget_max_agent_run_responsibilities,
                    execution_budget_max_accepted_a2a,
                    execution_budget_root_agent_run_responsibilities,
                    execution_budget_exhausted_at,
                    execution_budget_exhaustion_reason,
                    execution_budget_exhaustion_command_id,
                    version, created_at, updated_at, ended_at
                ) VALUES (
                    ?1, ?2, 'camp_message', ?3, 'running', NULL, NULL,
                    ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                    NULL, NULL, NULL, 1, ?5, ?5, NULL
                )
            "#,
            params![
                camp_turn_id,
                input.camp_id,
                input.camp_message_id,
                budget.schema_version,
                budget.accepted_at,
                budget.deadline_at,
                budget.elapsed_seconds,
                budget.max_agent_run_responsibilities,
                budget.max_accepted_a2a,
                budget.root_agent_run_responsibilities,
            ],
        )?;
    }

    let (author_type, author_id, source_agent_run_id) = actor_parts(input.actor);
    let addressed_agent_ids = input
        .resolution
        .targets
        .iter()
        .map(|target| target.agent_id.clone())
        .collect::<Vec<_>>();
    let addressed_agent_ids_json = serde_json::to_string(&addressed_agent_ids)?;
    let structured_content_json = serde_json::to_string(input.structured_content)?;
    let content_digest = canonical_content_digest(input.structured_content)?;
    transaction.execute(
        r#"
        INSERT INTO camp_message(
            id, camp_id, sequence,
            author_type, author_id, source_agent_run_id, body,
            structured_content_json, content_digest,
            address_mode, addressed_agent_ids_json,
            reply_to_camp_message_id, camp_turn_id, agent_run_id,
            tombstoned_at, version, created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
            ?11, ?12, ?13, NULL, NULL, 1, ?14, ?14
        )
        "#,
        params![
            input.camp_message_id,
            input.camp_id,
            camp_sequence,
            author_type,
            author_id,
            source_agent_run_id,
            input.body,
            structured_content_json,
            content_digest,
            input.address_mode,
            addressed_agent_ids_json,
            input.reply_to_camp_message_id,
            input.camp_turn_id,
            input.now,
        ],
    )?;
    let attachment_publication = if input.legacy_attachment_publication_operation_id.is_none() {
        CampAttachmentPublicationCoordinator.commit_composer_intent(
            transaction,
            input.camp_id,
            input.camp_message_id,
            input.command_id,
            input.draft_revision,
            input.prepared_attachment_ids,
        )?
    } else {
        None
    };
    consume_prepared_attachments(
        transaction,
        input.camp_id,
        input.camp_message_id,
        input.prepared_attachment_ids,
        input.now,
    )?;
    if let Some(operation_id) = input.legacy_attachment_publication_operation_id {
        commit_publication_in_message_transaction(
            transaction,
            Some(operation_id),
            input.camp_id,
            input.prepared_attachment_ids,
        )?;
    } else if let Some(publication) = attachment_publication.as_ref() {
        CampAttachmentPublicationCoordinator.bind_message_attachments(
            transaction,
            input.camp_message_id,
            publication,
        )?;
    }
    index_camp_message(
        transaction,
        input.camp_message_id,
        input.camp_id,
        input.body,
        &addressed_agent_ids_json,
    )?;
    let mut agent_run_ids = Vec::new();
    if let (Some(execution), Some(camp_turn_id)) = (input.execution, input.camp_turn_id) {
        for target in &input.resolution.targets {
            let conversation_id = target
                .conversation_id
                .as_deref()
                .context("Execution target has no admitted Conversation")?;
            let conversation_sequence: i64 = transaction.query_row(
                "SELECT last_message_sequence FROM conversation WHERE id = ?1",
                [conversation_id],
                |row| row.get(0),
            )?;
            let prepared = input
                .effective_configs
                .and_then(|configs| configs.get(&target.agent_id))
                .context("AgentRun target has no prepared Runtime configuration")?;
            let agent_run_id = Uuid::new_v4().to_string();
            let responsibility_key = execution.task_id.as_ref().map_or_else(
                || format!("respond/{}", target.agent_id),
                |task_id| format!("execute/{task_id}/{}", target.agent_id),
            );
            let workspace_json = input
                .workspace
                .map(|workspace| {
                    serde_json::to_string(&AgentRunWorkspace::runtime_managed_path(
                        workspace.execution_root.clone(),
                    ))
                })
                .transpose()?;
            let skill_selection = if matches!(input.actor, ActorRef::User { .. }) {
                freeze_skill_selection(
                    transaction,
                    input.structured_content,
                    prepared.runtime.adapter_kind,
                )?
            } else {
                SkillSelectionSnapshot::default()
            };
            let (skill_selection_json, skill_selection_digest) =
                skill_selection.canonical_json_and_digest()?;
            transaction.execute(
                r#"
                INSERT INTO agent_run(
                    id, camp_turn_id, conversation_id, task_id,
                    task_version_at_admission, assignee_agent_id_at_admission,
                    trigger_conversation_message_id, trigger_camp_message_id, input_ready_at,
                    initial_camp_context_through_sequence,
                    initial_conversation_context_through_sequence,
                    responsibility_key, responsibility_generation,
                    predecessor_agent_run_id, start_reason,
                    purpose, completion_role,
                    effective_config_json, workspace_json, permission_semantics,
                    runtime_adapter_kind, runtime_installation_id,
                    runtime_executable_path, runtime_auth_scope,
                    runtime_reported_version, runtime_executable_fingerprint,
                    runtime_initial_reported_version,
                    runtime_initial_executable_fingerprint,
                    runtime_capabilities_json, runtime_model_selection_json,
                    runtime_permission_config_json,
                    runtime_binding_compatibility_digest,
                    runtime_host_config_digest, runtime_protocol_version,
                    runtime_installation_generation,
                    runtime_search_environment_generation,
                    runtime_native_session_compatibility_key,
                    skill_selection_snapshot_json,
                    skill_selection_snapshot_digest,
                    status, wait_reason, wait_deadline_at,
                    idempotency_key, automatic_retry_count, runtime_rebind_count,
                    last_error_code, last_error_details_ref,
                    manual_retry_allowed, retry_declined_at,
                    execution_epoch, execution_lease_owner,
                    execution_lease_expires_at,
                    cancel_requested_at, cancel_reason_code,
                    cancel_acknowledged_at, version,
                    created_at, started_at, ended_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?30, ?31, NULL, ?5, ?6, ?7, ?8,
                    ?9, 0, NULL, 'initial', ?10, ?11,
                    ?12, ?13, 'runtime_managed_v2',
                    ?15, ?16, ?17, ?18, ?19, ?20, ?19, ?20,
                    ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29,
                    ?32, ?33,
                    'queued', NULL, NULL,
                    ?14, 0, 0, NULL, NULL, 0, NULL,
                    0, NULL, NULL, NULL, NULL, NULL, 1,
                    ?6, NULL, NULL, ?6
                )
                "#,
                params![
                    agent_run_id,
                    camp_turn_id,
                    conversation_id,
                    execution.task_id,
                    input.camp_message_id,
                    input.now,
                    camp_sequence,
                    conversation_sequence,
                    responsibility_key,
                    execution.purpose,
                    execution.completion_role,
                    serde_json::to_string(&prepared.effective_config)?,
                    workspace_json,
                    format!("{}:{}", input.command_id, target.agent_id),
                    prepared.runtime.adapter_kind.as_str(),
                    prepared.runtime.installation_id,
                    prepared.runtime.executable_path,
                    prepared.runtime.auth_scope,
                    prepared.runtime.reported_version,
                    prepared.runtime.executable_fingerprint,
                    serde_json::to_string(&prepared.runtime.capabilities)?,
                    serde_json::to_string(&prepared.runtime.model)?,
                    serde_json::to_string(&prepared.runtime.permissions)?,
                    prepared.runtime.binding_compatibility_digest,
                    prepared.runtime.host_config_digest,
                    prepared.runtime.protocol_version,
                    prepared.runtime.installation_generation,
                    prepared.runtime.search_environment_generation,
                    prepared.runtime.native_session_compatibility_key,
                    input.task_admission.map(|admission| admission.task_version),
                    input
                        .task_admission
                        .map(|admission| admission.assignee_agent_id.as_str()),
                    skill_selection_json,
                    skill_selection_digest,
                ],
            )?;
            agent_run_ids.push(agent_run_id);
        }
    }

    append_domain_event(
        transaction,
        "camp_message.sent",
        Some(input.camp_id),
        Some(("camp_message", input.camp_message_id)),
        input.actor,
        input.execution_epoch,
        &json!({
            "sequence": camp_sequence,
            "addressSource": input.resolution.source,
            "addressedAgentIds": addressed_agent_ids,
            "campTurnId": input.camp_turn_id,
            "agentRunIds": agent_run_ids,
        }),
    )?;
    if let (Some(execution), Some(camp_turn_id)) = (input.execution, input.camp_turn_id) {
        for agent_run_id in &agent_run_ids {
            append_domain_event(
                transaction,
                "agent_run.queued",
                Some(input.camp_id),
                Some(("agent_run", agent_run_id)),
                input.actor,
                input.execution_epoch,
                &json!({
                    "taskId": execution.task_id,
                    "campTurnId": camp_turn_id,
                }),
            )?;
        }
    }
    Ok(QueuedCampMessage {
        camp_sequence,
        agent_run_ids,
    })
}

pub(crate) fn append_system_camp_message(
    transaction: &Transaction<'_>,
    camp_id: &str,
    component_id: &str,
    body: &str,
) -> Result<String> {
    let message_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let updated = transaction.execute(
        r#"
        UPDATE camp
        SET last_message_sequence = last_message_sequence + 1,
            version = version + 1,
            updated_at = ?2
        WHERE id = ?1
        "#,
        params![camp_id, now],
    )?;
    if updated != 1 {
        anyhow::bail!("Camp does not exist while appending a system message");
    }
    let sequence: i64 = transaction.query_row(
        "SELECT last_message_sequence FROM camp WHERE id = ?1",
        [camp_id],
        |row| row.get(0),
    )?;
    let addressed_agent_ids_json = "[]";
    let structured_content = vec![StructuredCampMessageSegment::Text {
        text: body.to_string(),
    }];
    let structured_content_json = serde_json::to_string(&structured_content)?;
    transaction.execute(
        r#"
        INSERT INTO camp_message(
            id, camp_id, sequence,
            author_type, author_id, source_agent_run_id, body,
            structured_content_json, content_digest,
            address_mode, addressed_agent_ids_json,
            reply_to_camp_message_id, camp_turn_id, agent_run_id,
            tombstoned_at, presentation_json, version, created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, 'system', ?4, NULL, ?5, ?6, ?7,
            'broadcast', ?8, NULL, NULL, NULL,
            NULL, NULL, 1, ?9, ?9
        )
        "#,
        params![
            message_id,
            camp_id,
            sequence,
            component_id,
            body,
            structured_content_json,
            canonical_content_digest(&structured_content)?,
            addressed_agent_ids_json,
            now,
        ],
    )?;
    index_camp_message(
        transaction,
        &message_id,
        camp_id,
        body,
        addressed_agent_ids_json,
    )?;
    Ok(message_id)
}

#[derive(Debug, Clone)]
struct AddressTarget {
    agent_id: String,
    conversation_id: Option<String>,
}

fn ensure_resolution_conversations(
    transaction: &Transaction<'_>,
    camp_id: &str,
    resolution: &mut AddressResolution,
    now: &str,
) -> Result<Vec<String>> {
    let mut created = Vec::new();
    for target in &mut resolution.targets {
        if target.conversation_id.is_some() {
            continue;
        }
        let conversation_id = Uuid::new_v4().to_string();
        transaction.execute(
            r#"
            INSERT INTO conversation(
                id, camp_id, agent_id,
                provider_override, model_override, action_permission_profile_ref,
                native_session_id, summary,
                summary_through_message_sequence,
                last_message_sequence,
                version, created_at, updated_at
            ) VALUES (?1, ?2, ?3, NULL, NULL, NULL, NULL, NULL, 0, 0, 1, ?4, ?4)
            "#,
            params![conversation_id, camp_id, target.agent_id, now],
        )?;
        target.conversation_id = Some(conversation_id.clone());
        created.push(conversation_id);
    }
    Ok(created)
}

fn delete_new_conversations(transaction: &Connection, conversation_ids: &[String]) -> Result<()> {
    for conversation_id in conversation_ids {
        transaction.execute("DELETE FROM conversation WHERE id = ?1", [conversation_id])?;
    }
    Ok(())
}

#[derive(Debug)]
struct AddressResolution {
    source: &'static str,
    targets: Vec<AddressTarget>,
}

enum AddressingOutcome {
    Resolved(AddressResolution),
    Rejected(CommandHandlerResult),
}

fn resolve_address(
    transaction: &Connection,
    camp_id: &str,
    address: &CampMessageAddress,
    actor: &ActorRef,
) -> Result<AddressingOutcome> {
    match address {
        CampMessageAddress::Default => {
            let default_lead = transaction.query_row(
                "SELECT default_lead_agent_id FROM camp WHERE id = ?1",
                [camp_id],
                |row| row.get::<_, Option<String>>(0),
            )?;
            let active_count = active_member_count(transaction, camp_id)?;
            let Some(default_lead) = default_lead else {
                if active_count == 0 {
                    return Ok(AddressingOutcome::Resolved(AddressResolution {
                        source: "default_lead",
                        targets: Vec::new(),
                    }));
                }
                return Ok(AddressingOutcome::Rejected(rejected(
                    "camp.default_lead_invariant",
                    "Camp has active members but no valid Default Lead",
                )));
            };
            let Some(target) = active_address_target(transaction, camp_id, &default_lead)? else {
                return Ok(AddressingOutcome::Rejected(rejected(
                    "camp.default_lead_invariant",
                    "Default Lead is not an active addressable member",
                )));
            };
            Ok(AddressingOutcome::Resolved(AddressResolution {
                source: "default_lead",
                targets: vec![target],
            }))
        }
        CampMessageAddress::Explicit { agent_ids } => {
            if agent_ids.is_empty() {
                return Ok(AddressingOutcome::Rejected(rejected(
                    "camp_message.empty_explicit_address",
                    "Explicit address requires at least one Agent",
                )));
            }
            let mut seen = HashSet::new();
            let mut targets = Vec::new();
            for agent_id in agent_ids {
                if !seen.insert(agent_id) {
                    continue;
                }
                let Some(target) = active_address_target(transaction, camp_id, agent_id)? else {
                    return Ok(AddressingOutcome::Rejected(rejected(
                        "camp_message.invalid_explicit_target",
                        "Every explicit target must be an active Camp member",
                    )));
                };
                targets.push(target);
            }
            Ok(AddressingOutcome::Resolved(AddressResolution {
                source: "explicit",
                targets,
            }))
        }
        CampMessageAddress::Broadcast => {
            let sender_agent_id = match actor {
                ActorRef::Agent { agent_id, .. } => Some(agent_id.as_str()),
                _ => None,
            };
            let mut statement = transaction.prepare(
                r#"
                SELECT camp_member.agent_id, conversation.id
                FROM camp_member
                JOIN camp ON camp.id = camp_member.camp_id
                JOIN agent_profile ON agent_profile.id = camp_member.agent_id
                LEFT JOIN conversation
                  ON conversation.camp_id = camp_member.camp_id
                 AND conversation.agent_id = camp_member.agent_id
                WHERE camp_member.camp_id = ?1
                  AND camp_member.status = 'active'
                  AND camp_member.leave_requested_at IS NULL
                  AND agent_profile.profile_status = 'present'
                ORDER BY camp_member.joined_at, camp_member.agent_id
                "#,
            )?;
            let rows = statement.query_map([camp_id], |row| {
                Ok(AddressTarget {
                    agent_id: row.get(0)?,
                    conversation_id: row.get(1)?,
                })
            })?;
            let mut targets = Vec::new();
            for row in rows {
                let target = row?;
                if sender_agent_id == Some(target.agent_id.as_str()) {
                    continue;
                }
                targets.push(target);
            }
            Ok(AddressingOutcome::Resolved(AddressResolution {
                source: "broadcast",
                targets,
            }))
        }
    }
}

fn active_member_count(transaction: &Connection, camp_id: &str) -> Result<i64> {
    transaction
        .query_row(
            r#"
            SELECT COUNT(*)
            FROM camp_member
            JOIN agent_profile ON agent_profile.id = camp_member.agent_id
            WHERE camp_member.camp_id = ?1
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'present'
            "#,
            [camp_id],
            |row| row.get(0),
        )
        .context("failed to count active Camp members")
}

fn active_address_target(
    transaction: &Connection,
    camp_id: &str,
    agent_id: &str,
) -> Result<Option<AddressTarget>> {
    transaction
        .query_row(
            r#"
            SELECT camp_member.agent_id, conversation.id
            FROM camp_member
            JOIN camp ON camp.id = camp_member.camp_id
            JOIN agent_profile ON agent_profile.id = camp_member.agent_id
            LEFT JOIN conversation
              ON conversation.camp_id = camp_member.camp_id
             AND conversation.agent_id = camp_member.agent_id
            WHERE camp_member.camp_id = ?1
              AND camp_member.agent_id = ?2
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'present'
            "#,
            params![camp_id, agent_id],
            |row| {
                Ok(AddressTarget {
                    agent_id: row.get(0)?,
                    conversation_id: row.get(1)?,
                })
            },
        )
        .optional()
        .context("failed to resolve active Camp member Conversation")
}

fn actor_can_write_camp(
    connection: &Connection,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    camp_id: &str,
) -> Result<bool> {
    let ActorRef::Agent {
        agent_id,
        source_agent_run_id,
    } = actor
    else {
        return Ok(true);
    };
    let Some(execution_epoch) = execution_epoch else {
        return Ok(false);
    };
    let count: i64 = connection.query_row(
        r#"
        SELECT COUNT(*)
        FROM agent_run
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        JOIN conversation ON conversation.id = agent_run.conversation_id
        JOIN camp_member
          ON camp_member.camp_id = camp_turn.camp_id
         AND camp_member.agent_id = conversation.agent_id
        JOIN agent_profile ON agent_profile.id = conversation.agent_id
        WHERE agent_run.id = ?1
          AND camp_turn.camp_id = ?2
          AND conversation.agent_id = ?3
          AND agent_run.execution_epoch = ?4
          AND agent_run.status IN ('running', 'waiting')
          AND agent_run.cancel_requested_at IS NULL
          AND camp_member.status = 'active'
          AND camp_member.leave_requested_at IS NULL
        "#,
        params![source_agent_run_id, camp_id, agent_id, execution_epoch,],
        |row| row.get(0),
    )?;
    Ok(count == 1)
}

enum TaskReadScope {
    All,
}

impl TaskReadScope {
    fn can_read(&self, _task: &TaskRecord) -> bool {
        true
    }
}

fn task_read_scope(
    connection: &Connection,
    camp_id: &str,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
) -> Result<TaskReadScope> {
    match actor {
        ActorRef::User { .. } => Ok(TaskReadScope::All),
        ActorRef::Agent { .. } => {
            if !actor_can_write_camp(connection, actor, execution_epoch, camp_id)? {
                anyhow::bail!("task.query_forbidden: AgentRun is stale or outside the active Camp");
            }
            Ok(TaskReadScope::All)
        }
        ActorRef::System { .. } => {
            anyhow::bail!("task.query_forbidden: System Actors cannot read business Tasks")
        }
    }
}

fn task_record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRecord> {
    let status = match row.get::<_, String>(5)?.as_str() {
        "pending" => TaskStatus::Pending,
        "in_progress" => TaskStatus::InProgress,
        "blocked" => TaskStatus::Blocked,
        "completed" => TaskStatus::Completed,
        "cancelled" => TaskStatus::Cancelled,
        value => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                5,
                rusqlite::types::Type::Text,
                format!("invalid Task status: {value}").into(),
            ));
        }
    };
    let acceptance_criteria_json = row.get::<_, String>(4)?;
    let acceptance_criteria = serde_json::from_str(&acceptance_criteria_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(TaskRecord {
        id: row.get(0)?,
        camp_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        acceptance_criteria,
        status,
        assignee_agent_id: row.get(6)?,
        blocked_reason: row.get(7)?,
        completion_summary: row.get(8)?,
        cancel_reason: row.get(9)?,
        created_by_type: row.get(10)?,
        created_by_id: row.get(11)?,
        source_agent_run_id: row.get(12)?,
        closed_by_type: row.get(13)?,
        closed_by_id: row.get(14)?,
        closed_by_agent_run_id: row.get(15)?,
        version: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
        closed_at: row.get(19)?,
    })
}

fn load_task_record(transaction: &Connection, task_id: &str) -> Result<Option<TaskRecord>> {
    transaction
        .query_row(
            r#"
            SELECT id, camp_id, title, description, acceptance_criteria_json, status,
                   assignee_agent_id, blocked_reason, completion_summary, cancel_reason,
                   created_by_type, created_by_id, source_agent_run_id,
                   closed_by_type, closed_by_id, closed_by_agent_run_id,
                   version, created_at, updated_at, closed_at
            FROM task WHERE id = ?1
            "#,
            [task_id],
            task_record_from_row,
        )
        .optional()
        .map_err(Into::into)
}

fn load_task_detail(
    transaction: &Connection,
    task_id: &str,
    actor: &ActorRef,
    can_update_any: bool,
) -> Result<Option<TaskDetail>> {
    Ok(
        load_task_record(transaction, task_id)?.map(|task| TaskDetail {
            available_actions: task_available_actions(actor, &task, can_update_any),
            task,
        }),
    )
}

fn task_list_row_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskListRow> {
    let status = match row.get::<_, String>(2)?.as_str() {
        "pending" => TaskStatus::Pending,
        "in_progress" => TaskStatus::InProgress,
        "blocked" => TaskStatus::Blocked,
        "completed" => TaskStatus::Completed,
        "cancelled" => TaskStatus::Cancelled,
        value => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                format!("unknown Task status {value}").into(),
            ));
        }
    };
    Ok(TaskListRow {
        task_id: row.get(0)?,
        title: row.get(1)?,
        status,
        assignee_agent_id: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn task_list_item(actor: &ActorRef, task: TaskListRow, can_update_any: bool) -> TaskListItem {
    TaskListItem {
        task_id: task.task_id,
        title: task.title,
        status: task.status,
        assignee_agent_id: task.assignee_agent_id.clone(),
        available_actions: task_available_actions_for(
            actor,
            task.status,
            task.assignee_agent_id.as_deref(),
            can_update_any,
        ),
    }
}

fn task_available_actions(
    actor: &ActorRef,
    task: &TaskRecord,
    can_update_any: bool,
) -> Vec<String> {
    task_available_actions_for(
        actor,
        task.status,
        task.assignee_agent_id.as_deref(),
        can_update_any,
    )
}

fn task_available_actions_for(
    actor: &ActorRef,
    status: TaskStatus,
    assignee_agent_id: Option<&str>,
    can_update_any: bool,
) -> Vec<String> {
    if matches!(status, TaskStatus::Completed | TaskStatus::Cancelled) {
        return Vec::new();
    }
    if can_update_any {
        return vec!["update".to_string()];
    }
    match actor {
        ActorRef::User { .. } => vec!["update".to_string()],
        ActorRef::Agent { agent_id, .. } if assignee_agent_id == Some(agent_id) => {
            vec!["update".to_string()]
        }
        _ => Vec::new(),
    }
}

fn actor_is_default_lead(connection: &Connection, camp_id: &str, actor: &ActorRef) -> Result<bool> {
    let ActorRef::Agent { agent_id, .. } = actor else {
        return Ok(false);
    };
    connection
        .query_row(
            "SELECT default_lead_agent_id = ?2 FROM camp WHERE id = ?1",
            params![camp_id, agent_id],
            |row| row.get(0),
        )
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(Into::into)
}

fn encode_task_cursor(created_at: &str, task_id: &str) -> String {
    let value = format!("{created_at}\0{task_id}");
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn decode_task_cursor(cursor: &str) -> Result<(String, String)> {
    if cursor.is_empty() || !cursor.len().is_multiple_of(2) {
        anyhow::bail!("task.invalid_cursor: cursor is malformed");
    }
    let bytes = (0..cursor.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&cursor[index..index + 2], 16))
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("task.invalid_cursor: cursor is malformed")?;
    let decoded =
        String::from_utf8(bytes).context("task.invalid_cursor: cursor is not valid UTF-8")?;
    let Some((created_at, id)) = decoded.split_once('\0') else {
        anyhow::bail!("task.invalid_cursor: cursor boundary is missing");
    };
    if created_at.is_empty() || id.is_empty() {
        anyhow::bail!("task.invalid_cursor: cursor boundary is empty");
    }
    Ok((created_at.to_string(), id.to_string()))
}

fn actor_has_capability(
    transaction: &Transaction<'_>,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    camp_id: &str,
    capability: &str,
) -> Result<bool> {
    let ActorRef::Agent {
        source_agent_run_id,
        ..
    } = actor
    else {
        return Ok(true);
    };
    if !actor_can_write_camp(transaction, actor, execution_epoch, camp_id)? {
        return Ok(false);
    }
    let effective_config_json: String = transaction.query_row(
        "SELECT effective_config_json FROM agent_run WHERE id = ?1",
        [source_agent_run_id],
        |row| row.get(0),
    )?;
    let effective_config: Value = serde_json::from_str(&effective_config_json)
        .context("AgentRun effective config is invalid")?;
    Ok(effective_config["capabilities"]
        .as_array()
        .is_some_and(|capabilities| {
            capabilities
                .iter()
                .any(|candidate| candidate.as_str() == Some(capability))
        }))
}

fn validate_camp_message_input(command: &SendUserCampDraftCommand) -> Result<()> {
    if command.draft_revision < 1 {
        anyhow::bail!("draftRevision must be a positive Core Revision");
    }
    if let Some(execution) = &command.execution {
        if execution.purpose.trim().is_empty() {
            anyhow::bail!("Execution request requires purpose");
        }
        if !matches!(execution.completion_role.as_str(), "required" | "optional") {
            anyhow::bail!("completionRole must be required or optional");
        }
        if let Some(budget) = &execution.budget {
            budget.validate()?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub(crate) struct TaskLinkAdmission {
    pub task_version: i64,
    pub assignee_agent_id: String,
}

pub(crate) fn task_link_admission(
    transaction: &Transaction<'_>,
    task_id: &str,
    camp_id: &str,
    recipient_agent_id: &str,
) -> Result<Option<TaskLinkAdmission>> {
    let task = transaction
        .query_row(
            r#"
            SELECT status, assignee_agent_id, version
            FROM task WHERE id = ?1 AND camp_id = ?2
            "#,
            params![task_id, camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((status, assignee_agent_id, version)) = task else {
        return Ok(None);
    };
    if !matches!(status.as_str(), "pending" | "in_progress") {
        return Ok(None);
    }
    let Some(assignee_agent_id) = assignee_agent_id else {
        return Ok(None);
    };
    if assignee_agent_id != recipient_agent_id
        || !is_active_member(transaction, camp_id, recipient_agent_id)?
    {
        return Ok(None);
    }
    Ok(Some(TaskLinkAdmission {
        task_version: version,
        assignee_agent_id,
    }))
}

fn prepare_agent_run_configs(
    transaction: &Transaction<'_>,
    resolution: &AddressResolution,
) -> Result<std::result::Result<BTreeMap<String, PreparedAgentRunConfig>, CommandHandlerResult>> {
    let mut configs = BTreeMap::new();
    for target in &resolution.targets {
        let conversation_id = target
            .conversation_id
            .as_deref()
            .context("Execution target has no admitted Conversation")?;
        let runtime = match resolve_frozen_runtime(transaction, conversation_id, &target.agent_id)?
        {
            Ok(runtime) => runtime,
            Err(blocker) => {
                return Ok(Err(CommandHandlerResult::rejected(
                    "agent_run.runtime_not_ready",
                    json!({
                        "agentId": target.agent_id,
                        "conversationId": conversation_id,
                        "blockerCode": blocker.code,
                        "detail": blocker.payload,
                    }),
                )));
            }
        };
        let effective_config =
            build_effective_config(transaction, conversation_id, &target.agent_id, &runtime)?;
        configs.insert(
            target.agent_id.clone(),
            PreparedAgentRunConfig {
                effective_config,
                runtime,
            },
        );
    }
    Ok(Ok(configs))
}

pub(crate) fn build_effective_config(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    agent_id: &str,
    runtime: &FrozenAgentRuntimeConfig,
) -> Result<Value> {
    let (
        default_capabilities_json,
        agent_profile_version,
        capability_overrides_json,
        camp_member_version,
        conversation_version,
    ) = transaction.query_row(
        r#"
        SELECT agent_profile.default_capabilities_json,
               agent_profile.version,
               camp_member.capability_overrides_json,
               camp_member.version,
               conversation.version
        FROM conversation
        JOIN agent_profile ON agent_profile.id = conversation.agent_id
        JOIN camp_member
          ON camp_member.camp_id = conversation.camp_id
         AND camp_member.agent_id = conversation.agent_id
        WHERE conversation.id = ?1 AND conversation.agent_id = ?2
        "#,
        params![conversation_id, agent_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
            ))
        },
    )?;
    let default_capabilities: Vec<String> =
        serde_json::from_str(&default_capabilities_json).context("invalid Agent capabilities")?;
    let overrides: Value =
        serde_json::from_str(&capability_overrides_json).context("invalid capability overrides")?;
    let mut capabilities = default_capabilities.into_iter().collect::<BTreeSet<_>>();
    if let Some(overrides) = overrides.as_object() {
        for (capability, effect) in overrides {
            match effect.as_str() {
                Some("allow") => {
                    capabilities.insert(capability.clone());
                }
                Some("deny") => {
                    capabilities.remove(capability);
                }
                _ => anyhow::bail!("invalid capability override"),
            }
        }
    }
    let mut action_permission_envelope = json!({
        "schemaVersion": 2,
        "rules": [],
    });
    let action_permission_digest = canonical_json_digest(&action_permission_envelope)?;
    action_permission_envelope
        .as_object_mut()
        .expect("Action Permission Envelope is an object")
        .insert(
            "digest".to_string(),
            Value::String(action_permission_digest),
        );
    let mut snapshot = json!({
        "schemaVersion": 3,
        "agentId": agent_id,
        "agentProfileVersion": agent_profile_version,
        "campMemberVersion": camp_member_version,
        "conversationVersion": conversation_version,
        "runtimeAdapter": runtime.adapter_kind,
        "provider": runtime.adapter_kind,
        "model": runtime.model.model_id,
        "runtime": runtime,
        "capabilities": capabilities,
        "tools": [],
        "actionPermissionEnvelope": action_permission_envelope,
    });
    let config_digest = canonical_json_digest(&snapshot)?;
    snapshot
        .as_object_mut()
        .expect("effective config snapshot is an object")
        .insert("configDigest".to_string(), Value::String(config_digest));
    Ok(snapshot)
}

fn validate_project_path(path: &str) -> Result<()> {
    if path.trim().is_empty() || !Path::new(path).is_absolute() {
        anyhow::bail!("projectPath must be a non-empty absolute path");
    }
    Ok(())
}

const CAMP_NAME_MAX_SCALARS: usize = 80;

fn normalize_camp_name(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn generated_camp_name(
    content: &[StructuredCampMessageSegment],
    member_name: impl FnMut(&str) -> Option<String>,
) -> Result<String> {
    let title_content = content_after_leading_mentions(content);
    let title = normalize_camp_name(&render_plain_text(title_content, member_name)?)
        .chars()
        .take(CAMP_NAME_MAX_SCALARS)
        .collect::<String>();
    Ok(if title.is_empty() {
        "未命名对话".to_string()
    } else {
        title
    })
}

fn content_after_leading_mentions(
    content: &[StructuredCampMessageSegment],
) -> &[StructuredCampMessageSegment] {
    let mut cursor = 0;
    while matches!(
        content.get(cursor),
        Some(StructuredCampMessageSegment::Text { text }) if text.trim().is_empty()
    ) {
        cursor += 1;
    }

    let mut removed_mention = false;
    loop {
        match content.get(cursor) {
            Some(
                StructuredCampMessageSegment::MemberMention { .. }
                | StructuredCampMessageSegment::AllMembersMention,
            ) => {
                removed_mention = true;
                cursor += 1;
            }
            Some(StructuredCampMessageSegment::Text { text })
                if removed_mention && text.trim().is_empty() =>
            {
                cursor += 1;
            }
            _ => break,
        }
    }

    if !removed_mention {
        return content;
    }
    &content[cursor..]
}

fn camp_delete_blockers(transaction: &Connection, camp_id: &str) -> Result<Vec<Value>> {
    let checks = [
        (
            "nonterminal_agent_run",
            r#"
            SELECT COUNT(*)
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE camp_turn.camp_id = ?1
              AND agent_run.status IN ('queued', 'running', 'waiting')
            "#,
        ),
        (
            "nonterminal_camp_turn",
            r#"
            SELECT COUNT(*) FROM camp_turn
            WHERE camp_id = ?1 AND status IN ('running', 'waiting')
            "#,
        ),
        (
            "pending_approval",
            r#"
            SELECT COUNT(*)
            FROM approval
            LEFT JOIN task ON task.id = approval.task_id
            LEFT JOIN action_execution ON action_execution.id = approval.action_id
            LEFT JOIN agent_run ON agent_run.id = action_execution.agent_run_id
            LEFT JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE approval.status = 'pending'
              AND (task.camp_id = ?1 OR camp_turn.camp_id = ?1)
            "#,
        ),
        (
            "unsettled_action",
            r#"
            SELECT COUNT(*)
            FROM action_execution
            JOIN agent_run ON agent_run.id = action_execution.agent_run_id
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE camp_turn.camp_id = ?1
              AND (
                action_execution.status IN ('prepared', 'executing')
                OR (action_execution.status = 'unknown'
                    AND action_execution.unknown_disposition = 'active')
              )
            "#,
        ),
        (
            "pending_message_delivery",
            r#"
            SELECT COUNT(*) FROM message_delivery
            WHERE camp_id = ?1 AND status IN ('pending', 'running')
            "#,
        ),
        (
            "pending_runtime_delivery",
            r#"
            SELECT COUNT(*)
            FROM runtime_delivery_checkpoint
            JOIN agent_run ON agent_run.id = runtime_delivery_checkpoint.agent_run_id
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE camp_turn.camp_id = ?1
              AND runtime_delivery_checkpoint.status NOT IN ('acked', 'safely_closed')
            "#,
        ),
        (
            "pending_context_delivery",
            r#"
            SELECT COUNT(*)
            FROM runtime_input_delivery
            JOIN agent_run ON agent_run.id = runtime_input_delivery.agent_run_id
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE camp_turn.camp_id = ?1
              AND runtime_input_delivery.status IN ('prepared', 'delivery_unknown')
            "#,
        ),
        (
            "active_worker_lease",
            r#"
            SELECT
                (SELECT COUNT(*)
                 FROM agent_run
                 JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                 WHERE camp_turn.camp_id = ?1
                   AND agent_run.execution_lease_owner IS NOT NULL)
              + (SELECT COUNT(*)
                 FROM action_execution
                 JOIN agent_run ON agent_run.id = action_execution.agent_run_id
                 JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                 WHERE camp_turn.camp_id = ?1
                   AND action_execution.execution_lease_owner IS NOT NULL)
              + (SELECT COUNT(*) FROM message_delivery_attempt
                 JOIN message_delivery ON message_delivery.id = message_delivery_attempt.delivery_id
                 WHERE message_delivery.camp_id = ?1 AND message_delivery_attempt.status = 'attempting')
            "#,
        ),
        (
            "unfinished_membership_change",
            r#"
            SELECT COUNT(*) FROM camp_member
            WHERE camp_id = ?1 AND leave_requested_at IS NOT NULL
            "#,
        ),
    ];
    let mut blockers = Vec::new();
    for (code, sql) in checks {
        let count: i64 = transaction.query_row(sql, [camp_id], |row| row.get(0))?;
        if count > 0 {
            blockers.push(json!({ "code": code, "count": count }));
        }
    }
    Ok(blockers)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CampTurnExecutionBudgetExhaustion {
    pub newly_exhausted: bool,
    pub camp_id: String,
    pub agent_runs_fenced: i64,
    pub allocated_agent_run_responsibilities: i64,
    pub accepted_a2a: i64,
}

pub(crate) fn exhaust_camp_turn_execution_budget(
    transaction: &Transaction<'_>,
    camp_turn_id: &str,
    reason: CampTurnExecutionBudgetExhaustionReason,
    command_id: &str,
    now: &str,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
) -> Result<CampTurnExecutionBudgetExhaustion> {
    let state = transaction
        .query_row(
            r#"
            SELECT camp_id, status, execution_budget_exhausted_at,
                   execution_budget_root_agent_run_responsibilities
                     + agent_run_responsibilities_allocated,
                   accepted_a2a_allocated,
                   execution_budget_elapsed_seconds,
                   execution_budget_max_agent_run_responsibilities,
                   execution_budget_max_accepted_a2a,
                   execution_budget_deadline_at
            FROM camp_turn WHERE id = ?1
            "#,
            [camp_turn_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, String>(8)?,
                ))
            },
        )
        .optional()?
        .context("CampTurn Execution Budget target does not exist")?;
    let (
        camp_id,
        status,
        exhausted_at,
        allocated_agent_run_responsibilities,
        accepted_a2a,
        elapsed_seconds,
        max_agent_run_responsibilities,
        max_accepted_a2a,
        deadline_at,
    ) = state;
    if exhausted_at.is_some() {
        return Ok(CampTurnExecutionBudgetExhaustion {
            newly_exhausted: false,
            camp_id,
            agent_runs_fenced: 0,
            allocated_agent_run_responsibilities,
            accepted_a2a,
        });
    }
    if !matches!(status.as_str(), "running" | "waiting") {
        anyhow::bail!("terminal CampTurn cannot newly exhaust its Execution Budget");
    }

    let updated = transaction.execute(
        r#"
        UPDATE camp_turn
        SET execution_budget_exhausted_at = ?2,
            execution_budget_exhaustion_reason = ?3,
            execution_budget_exhaustion_command_id = ?4,
            version = version + 1,
            updated_at = ?2
        WHERE id = ?1
          AND status IN ('running', 'waiting')
          AND execution_budget_exhausted_at IS NULL
        "#,
        params![camp_turn_id, now, reason.as_str(), command_id],
    )?;
    if updated != 1 {
        anyhow::bail!("CampTurn changed before its Execution Budget was exhausted");
    }
    let message_deliveries_cancelled = cancel_pending_turn_deliveries(
        transaction,
        camp_turn_id,
        "execution_budget_exhausted",
        actor,
        execution_epoch,
        now,
    )?;
    let agent_runs_fenced = transaction.execute(
        r#"
        UPDATE agent_run
        SET cancel_requested_at = ?2,
            cancel_reason_code = 'execution_budget_exhausted',
            version = version + 1,
            updated_at = ?2
        WHERE camp_turn_id = ?1
          AND status IN ('queued', 'running', 'waiting')
          AND cancel_requested_at IS NULL
        "#,
        params![camp_turn_id, now],
    )? as i64;
    append_domain_event(
        transaction,
        "camp_turn.execution_budget_exhausted",
        Some(&camp_id),
        Some(("camp_turn", camp_turn_id)),
        actor,
        execution_epoch,
        &json!({
            "reason": reason.as_str(),
            "commandId": command_id,
            "deadlineAt": deadline_at,
            "elapsedSeconds": elapsed_seconds,
            "maxAgentRunResponsibilities": max_agent_run_responsibilities,
            "maxAcceptedA2a": max_accepted_a2a,
            "allocatedAgentRunResponsibilities": allocated_agent_run_responsibilities,
            "acceptedA2a": accepted_a2a,
            "agentRunsFenced": agent_runs_fenced,
            "messageDeliveriesCancelled": message_deliveries_cancelled,
        }),
    )?;
    Ok(CampTurnExecutionBudgetExhaustion {
        newly_exhausted: true,
        camp_id,
        agent_runs_fenced,
        allocated_agent_run_responsibilities,
        accepted_a2a,
    })
}

pub(crate) fn delete_camp_aggregate(transaction: &Connection, camp_id: &str) -> Result<()> {
    transaction.execute(
        r#"
        DELETE FROM legacy_import_map
        WHERE (target_entity_type = 'camp' AND target_entity_id = ?1)
           OR (source_type = 'legacy_task' AND source_id IN (
                SELECT id FROM task WHERE camp_id = ?1
           ))
        "#,
        [camp_id],
    )?;
    // Draft reply/continuation sources reference Camp messages. Remove the Draft
    // before deleting those messages; prepared rows cascade with the Draft.
    transaction.execute(
        "DELETE FROM camp_composer_draft WHERE camp_id = ?1",
        [camp_id],
    )?;
    transaction.execute(
        "DELETE FROM message_attachment WHERE camp_id = ?1",
        [camp_id],
    )?;
    transaction.execute(
        r#"
        DELETE FROM approval
        WHERE task_id IN (SELECT id FROM task WHERE camp_id = ?1)
           OR action_id IN (
                SELECT action_execution.id
                FROM action_execution
                JOIN agent_run ON agent_run.id = action_execution.agent_run_id
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                WHERE camp_turn.camp_id = ?1
           )
        "#,
        [camp_id],
    )?;
    transaction.execute(
        r#"
        DELETE FROM runtime_delivery_checkpoint
        WHERE agent_run_id IN (
            SELECT agent_run.id
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE camp_turn.camp_id = ?1
        )
        "#,
        [camp_id],
    )?;
    transaction.execute(
        r#"
        DELETE FROM runtime_input_delivery
        WHERE agent_run_id IN (
            SELECT agent_run.id
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE camp_turn.camp_id = ?1
        )
        "#,
        [camp_id],
    )?;
    transaction.execute(
        r#"
        DELETE FROM context_manifest
        WHERE agent_run_id IN (
            SELECT agent_run.id
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE camp_turn.camp_id = ?1
        )
        "#,
        [camp_id],
    )?;
    transaction.execute(
        r#"
        DELETE FROM native_session_bootstrap_evidence
        WHERE conversation_id IN (
            SELECT id FROM conversation WHERE camp_id = ?1
        )
        "#,
        [camp_id],
    )?;
    transaction.execute(
        r#"
        DELETE FROM action_attempt
        WHERE action_id IN (
            SELECT action_execution.id
            FROM action_execution
            JOIN agent_run ON agent_run.id = action_execution.agent_run_id
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE camp_turn.camp_id = ?1
        )
        "#,
        [camp_id],
    )?;
    transaction.execute(
        r#"
        DELETE FROM action_execution
        WHERE agent_run_id IN (
            SELECT agent_run.id
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE camp_turn.camp_id = ?1
        )
        "#,
        [camp_id],
    )?;
    transaction.execute(
        r#"
        DELETE FROM agent_run_execution_evidence
        WHERE agent_run_id IN (
            SELECT agent_run.id
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE camp_turn.camp_id = ?1
        )
        "#,
        [camp_id],
    )?;
    transaction.execute("DELETE FROM message_delivery WHERE camp_id = ?1", [camp_id])?;
    transaction.execute(
        r#"
        UPDATE agent_run
        SET trigger_conversation_message_id = NULL,
            trigger_camp_message_id = NULL,
            input_ready_at = NULL,
            final_conversation_message_id = NULL,
            final_camp_message_id = NULL
        WHERE camp_turn_id IN (SELECT id FROM camp_turn WHERE camp_id = ?1)
        "#,
        [camp_id],
    )?;
    transaction.execute(
        "DELETE FROM conversation_message WHERE conversation_id IN (SELECT id FROM conversation WHERE camp_id = ?1)",
        [camp_id],
    )?;
    transaction.execute(
        r#"
        DELETE FROM camp_message_reference
        WHERE camp_message_id IN (
            SELECT id FROM camp_message WHERE camp_id = ?1
        )
        "#,
        [camp_id],
    )?;
    transaction.execute(
        r#"
        DELETE FROM camp_message_mention
        WHERE camp_message_id IN (
            SELECT id FROM camp_message WHERE camp_id = ?1
        )
        "#,
        [camp_id],
    )?;
    transaction.execute("DELETE FROM camp_message WHERE camp_id = ?1", [camp_id])?;
    transaction.execute(
        "DELETE FROM event_log WHERE camp_id = ?1 OR task_id IN (SELECT id FROM task WHERE camp_id = ?1)",
        [camp_id],
    )?;
    transaction.execute(
        "DELETE FROM turn WHERE runtime_session_id IN (SELECT runtime_session.id FROM runtime_session JOIN task ON task.id = runtime_session.task_id WHERE task.camp_id = ?1)",
        [camp_id],
    )?;
    transaction.execute(
        "DELETE FROM runtime_session WHERE task_id IN (SELECT id FROM task WHERE camp_id = ?1)",
        [camp_id],
    )?;
    transaction.execute(
        "DELETE FROM artifact WHERE task_id IN (SELECT id FROM task WHERE camp_id = ?1)",
        [camp_id],
    )?;
    transaction.execute(
        r#"
        UPDATE agent_run
        SET task_id = NULL
        WHERE camp_turn_id IN (SELECT id FROM camp_turn WHERE camp_id = ?1)
        "#,
        [camp_id],
    )?;
    transaction.execute("DELETE FROM task WHERE camp_id = ?1", [camp_id])?;
    transaction.execute(
        r#"
        DELETE FROM agent_run
        WHERE camp_turn_id IN (SELECT id FROM camp_turn WHERE camp_id = ?1)
        "#,
        [camp_id],
    )?;
    transaction.execute("DELETE FROM camp_turn WHERE camp_id = ?1", [camp_id])?;
    transaction.execute("DELETE FROM conversation WHERE camp_id = ?1", [camp_id])?;
    transaction.execute("DELETE FROM camp_member WHERE camp_id = ?1", [camp_id])?;
    transaction.execute("DELETE FROM camp_view_state WHERE camp_id = ?1", [camp_id])?;
    transaction.execute("DELETE FROM camp WHERE id = ?1", [camp_id])?;
    Ok(())
}
fn require_json_object(value: &Value, field: &str) -> Result<()> {
    if !value.is_object() {
        anyhow::bail!("{field} must be a JSON object");
    }
    Ok(())
}

fn validate_capability_overrides(value: &Value) -> Result<()> {
    require_json_object(value, "capabilityOverrides")?;
    const CAPABILITIES: &[&str] = &[
        "camp.member.manage",
        "camp.default_lead.change",
        "task.create",
        "task.update",
        "agent_run.create",
        "agent_run.retry",
        "agent_run.cancel",
        "member.call",
        "workspace.bind",
        "action.request",
    ];
    for (capability, effect) in value.as_object().expect("validated JSON object") {
        if !CAPABILITIES.contains(&capability.as_str())
            || !matches!(effect.as_str(), Some("allow" | "deny"))
        {
            anyhow::bail!("capabilityOverrides contains an unknown capability or effect");
        }
    }
    Ok(())
}

fn validate_task_input(command: &CreateTaskCommand) -> Result<()> {
    if command.camp_id.trim().is_empty()
        || command.title.trim().is_empty()
        || command.assignee_agent_id.trim().is_empty()
    {
        anyhow::bail!("Task Camp, title, and assignee must not be empty");
    }
    if command.title.trim().chars().count() > 160 {
        anyhow::bail!("Task title must not exceed 160 characters");
    }
    if command.description.trim().chars().count() > 8_000 {
        anyhow::bail!("Task description must not exceed 8000 characters");
    }
    normalize_acceptance_criteria(&command.acceptance_criteria, true)?;
    Ok(())
}

fn validate_task_update_input(command: &UpdateTaskCommand) -> Result<()> {
    if command.task_id.trim().is_empty() || command.expected_version < 1 {
        anyhow::bail!("Task update requires an ID and positive expectedVersion");
    }
    if command.title.is_none()
        && command.description.is_none()
        && matches!(
            command.acceptance_criteria,
            TaskAcceptanceCriteriaUpdate::Unchanged
        )
        && command.status.is_none()
        && matches!(command.assignee, TaskAssigneeUpdate::Unchanged)
        && command.blocked_reason.is_none()
        && command.completion_summary.is_none()
        && command.cancel_reason.is_none()
    {
        anyhow::bail!("Task update patch must contain at least one field");
    }
    if let Some(title) = &command.title
        && (title.trim().is_empty() || title.trim().chars().count() > 160)
    {
        anyhow::bail!("Task title must contain 1 to 160 characters");
    }
    if command
        .description
        .as_ref()
        .is_some_and(|description| description.trim().chars().count() > 8_000)
    {
        anyhow::bail!("Task description must not exceed 8000 characters");
    }
    if let TaskAcceptanceCriteriaUpdate::Replace { items } = &command.acceptance_criteria {
        normalize_acceptance_criteria(items, false)?;
    }
    if let TaskAssigneeUpdate::Assign { agent_id } = &command.assignee
        && agent_id.trim().is_empty()
    {
        anyhow::bail!("Task assignee must not be empty");
    }
    for (name, value) in [
        ("blockedReason", command.blocked_reason.as_deref()),
        ("completionSummary", command.completion_summary.as_deref()),
        ("cancelReason", command.cancel_reason.as_deref()),
    ] {
        if let Some(value) = value
            && (value.trim().is_empty() || value.trim().chars().count() > 4_000)
        {
            anyhow::bail!("{name} must contain 1 to 4000 characters");
        }
    }
    Ok(())
}

fn normalize_acceptance_criteria(items: &[String], allow_empty: bool) -> Result<Vec<String>> {
    if (!allow_empty && items.is_empty()) || items.len() > 12 {
        anyhow::bail!("acceptanceCriteria must contain 1 to 12 items");
    }
    let normalized = items
        .iter()
        .map(|item| item.trim().to_string())
        .collect::<Vec<_>>();
    if normalized
        .iter()
        .any(|item| item.is_empty() || item.chars().count() > 500)
    {
        anyhow::bail!("Each acceptance criterion must contain 1 to 500 characters");
    }
    if normalized
        .iter()
        .map(|item| item.chars().count())
        .sum::<usize>()
        > 6_000
    {
        anyhow::bail!("acceptanceCriteria must not exceed 6000 characters in total");
    }
    let mut unique = BTreeSet::new();
    if normalized.iter().any(|item| !unique.insert(item.clone())) {
        anyhow::bail!("acceptanceCriteria must not contain duplicates");
    }
    Ok(normalized)
}

fn validate_projected_task(task: &TaskRecord) -> std::result::Result<(), String> {
    match task.status {
        TaskStatus::Pending => Ok(()),
        TaskStatus::InProgress if task.assignee_agent_id.is_some() => Ok(()),
        TaskStatus::Blocked
            if task.assignee_agent_id.is_some()
                && task
                    .blocked_reason
                    .as_deref()
                    .is_some_and(|value| !value.is_empty()) =>
        {
            Ok(())
        }
        TaskStatus::Completed
            if task.assignee_agent_id.is_some()
                && task
                    .completion_summary
                    .as_deref()
                    .is_some_and(|value| !value.is_empty()) =>
        {
            Ok(())
        }
        TaskStatus::Cancelled
            if task
                .cancel_reason
                .as_deref()
                .is_some_and(|value| !value.is_empty()) =>
        {
            Ok(())
        }
        TaskStatus::InProgress => Err("in_progress requires an assignee".to_string()),
        TaskStatus::Blocked => Err("blocked requires an assignee and blockedReason".to_string()),
        TaskStatus::Completed => {
            Err("completed requires an assignee and completionSummary".to_string())
        }
        TaskStatus::Cancelled => Err("cancelled requires cancelReason".to_string()),
    }
}

fn task_business_fields_changed(left: &TaskRecord, right: &TaskRecord) -> bool {
    left.title != right.title
        || left.description != right.description
        || left.acceptance_criteria != right.acceptance_criteria
        || left.status != right.status
        || left.assignee_agent_id != right.assignee_agent_id
        || left.blocked_reason != right.blocked_reason
        || left.completion_summary != right.completion_summary
        || left.cancel_reason != right.cancel_reason
}

fn task_creator_parts(actor: &ActorRef) -> Result<(&'static str, &str, Option<&str>)> {
    match actor {
        ActorRef::User { user_id } => Ok(("user", user_id, None)),
        ActorRef::Agent {
            agent_id,
            source_agent_run_id,
        } => Ok(("agent", agent_id, Some(source_agent_run_id))),
        ActorRef::System { .. } => anyhow::bail!("System components cannot create business Tasks"),
    }
}

fn agent_can_update_task(actor: &ActorRef, current_assignee: Option<&str>) -> bool {
    let ActorRef::Agent { agent_id, .. } = actor else {
        return matches!(actor, ActorRef::User { .. });
    };
    current_assignee == Some(agent_id)
}

fn assignee_update_fields_allowed(command: &UpdateTaskCommand) -> bool {
    command.title.is_none()
        && command.description.is_none()
        && matches!(
            command.acceptance_criteria,
            TaskAcceptanceCriteriaUpdate::Unchanged
        )
        && matches!(command.assignee, TaskAssigneeUpdate::Unchanged)
        && command.cancel_reason.is_none()
}

fn assignee_transition_allowed(current: TaskStatus, projected: TaskStatus) -> bool {
    current == projected
        || matches!(
            (current, projected),
            (
                TaskStatus::Pending,
                TaskStatus::InProgress | TaskStatus::Blocked | TaskStatus::Completed
            ) | (
                TaskStatus::InProgress,
                TaskStatus::Blocked | TaskStatus::Completed
            ) | (
                TaskStatus::Blocked,
                TaskStatus::InProgress | TaskStatus::Completed
            )
        )
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({ "message": message }))
}

fn task_version_conflict(
    task_id: &str,
    current_version: i64,
    message: &str,
) -> CommandHandlerResult {
    CommandHandlerResult::rejected(
        "task.version_conflict",
        json!({
            "message": message,
            "taskId": task_id,
            "currentVersion": current_version,
        }),
    )
}

fn actor_parts(actor: &ActorRef) -> (&'static str, &str, Option<&str>) {
    match actor {
        ActorRef::User { user_id } => ("user", user_id, None),
        ActorRef::Agent {
            agent_id,
            source_agent_run_id,
        } => ("agent", agent_id, Some(source_agent_run_id)),
        ActorRef::System { component_id } => ("system", component_id, None),
    }
}

pub(crate) fn end_camp_membership(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_id: &str,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<()> {
    let changed = transaction.execute(
        r#"
        UPDATE camp_member
        SET status = 'left', leave_requested_at = NULL,
            leave_request_command_id = NULL,
            pending_default_lead_successor_agent_id = NULL,
            version = version + 1, left_at = ?3
        WHERE camp_id = ?1 AND agent_id = ?2 AND status = 'active'
        "#,
        params![camp_id, agent_id, now],
    )?;
    if changed == 0 {
        return Ok(());
    }

    cancel_gathers_for_initiator(
        transaction,
        camp_id,
        agent_id,
        "gather_initiator_left_camp",
        actor,
        execution_epoch,
        now,
    )?;

    let released = {
        let mut statement = transaction.prepare(
            r#"
            SELECT id, status, version
            FROM task
            WHERE camp_id = ?1 AND assignee_agent_id = ?2
              AND status IN ('pending', 'in_progress', 'blocked')
            ORDER BY id
            "#,
        )?;
        statement
            .query_map(params![camp_id, agent_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (task_id, previous_status, version) in released {
        transaction.execute(
            r#"
            UPDATE task
            SET status = 'pending', assignee_agent_id = NULL,
                blocked_reason = NULL, completion_summary = NULL, cancel_reason = NULL,
                closed_by_type = NULL, closed_by_id = NULL,
                closed_by_agent_run_id = NULL, closed_at = NULL,
                version = version + 1, updated_at = ?2
            WHERE id = ?1
            "#,
            params![task_id, now],
        )?;
        append_domain_event(
            transaction,
            "task.assignee_membership_ended",
            Some(camp_id),
            Some(("task", &task_id)),
            actor,
            execution_epoch,
            &json!({
                "cause": "assignee_membership_ended",
                "previousStatus": previous_status,
                "status": "pending",
                "previousAssigneeAgentId": agent_id,
                "assigneeAgentId": null,
                "version": version + 1,
            }),
        )?;
    }

    append_domain_event(
        transaction,
        "camp.membership_ended",
        Some(camp_id),
        Some(("camp_member", &format!("{camp_id}:{agent_id}"))),
        actor,
        execution_epoch,
        &json!({"agentId": agent_id}),
    )?;

    let current_lead = transaction
        .query_row(
            "SELECT default_lead_agent_id FROM camp WHERE id = ?1",
            [camp_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    if current_lead.as_deref() == Some(agent_id) {
        let successor = transaction
            .query_row(
                r#"
                SELECT camp_member.agent_id
                FROM camp_member
                JOIN agent_profile ON agent_profile.id = camp_member.agent_id
                WHERE camp_member.camp_id = ?1
                  AND camp_member.status = 'active'
                  AND camp_member.leave_requested_at IS NULL
                  AND agent_profile.profile_status = 'present'
                ORDER BY agent_profile.member_order, agent_profile.id
                LIMIT 1
                "#,
                [camp_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        transaction.execute(
            "UPDATE camp SET default_lead_agent_id = ?2, version = version + 1, updated_at = ?3 WHERE id = ?1",
            params![camp_id, successor, now],
        )?;
        append_domain_event(
            transaction,
            "camp.default_lead_reconciled",
            Some(camp_id),
            Some(("camp", camp_id)),
            actor,
            execution_epoch,
            &json!({
                "previousDefaultLeadAgentId": agent_id,
                "defaultLeadAgentId": successor,
                "cause": "membership_ended",
            }),
        )?;
    }
    Ok(())
}

pub(crate) fn append_domain_event(
    transaction: &Transaction<'_>,
    event_type: &str,
    camp_id: Option<&str>,
    entity: Option<(&str, &str)>,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    payload: &Value,
) -> Result<()> {
    let (actor_type, actor_id, source_agent_run_id) = actor_parts(actor);
    transaction.execute(
        r#"
        INSERT INTO event_log(
            event_id, task_id, turn_id, sequence, event_type, native_method,
            payload_json, camp_id, entity_type, entity_id,
            actor_type, actor_id, source_agent_run_id, execution_epoch, created_at
        ) VALUES (?1, NULL, NULL, NULL, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
        params![
            Uuid::new_v4().to_string(),
            event_type,
            serde_json::to_string(payload)?,
            camp_id,
            entity.map(|value| value.0),
            entity.map(|value| value.1),
            actor_type,
            actor_id,
            source_agent_run_id,
            execution_epoch,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn is_active_member(transaction: &Transaction<'_>, camp_id: &str, agent_id: &str) -> Result<bool> {
    let count: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*)
        FROM camp_member
        JOIN camp ON camp.id = camp_member.camp_id
        JOIN agent_profile ON agent_profile.id = camp_member.agent_id
        WHERE camp_member.camp_id = ?1
          AND camp_member.agent_id = ?2
          AND camp_member.status = 'active'
          AND camp_member.leave_requested_at IS NULL
          AND agent_profile.profile_status = 'present'
        "#,
        params![camp_id, agent_id],
        |row| row.get(0),
    )?;
    Ok(count == 1)
}

pub(crate) fn is_current_camp_member(
    transaction: &Connection,
    camp_id: &str,
    agent_id: &str,
) -> Result<bool> {
    let count: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*)
        FROM camp_member
        WHERE camp_id = ?1
          AND agent_id = ?2
          AND status = 'active'
          AND leave_requested_at IS NULL
        "#,
        params![camp_id, agent_id],
        |row| row.get(0),
    )?;
    Ok(count == 1)
}

fn camp_is_pending(transaction: &Connection, camp_id: &str) -> Result<bool> {
    Ok(transaction
        .query_row(
            "SELECT activation_state = 'pending' FROM camp WHERE id = ?1",
            [camp_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(false))
}

#[cfg(all(test, feature = "slow-tests"))]
mod slow_tests {
    use super::*;
    use crate::{
        agent_profile::{
            AdapterKind, AgentProfileService, RemoveMemberCommand, configure_test_runtime,
        },
        camp_attachment::CampAttachmentStore,
        camp_attachment_view::CampAttachmentViewStore,
        camp_content::StructuredCampMessageSegment as Segment,
        command::CommandResultStatus,
        current_input_skill::parse_skill_selection_snapshot,
        current_user::CURRENT_USER_ID,
        read_model::ReadModelService,
        runtime::ExecutionRuntimeService,
        runtime_resolution::RuntimeResolutionService,
    };

    fn test_database() -> (Database, std::path::PathBuf) {
        crate::test_support::fresh_schema_database()
    }

    fn user_envelope<P>(command_id: &str, camp_id: Option<&str>, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: "local_user".to_string(),
            },
            camp_id: camp_id.map(str::to_string),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn agent_envelope<P>(
        command_id: &str,
        camp_id: &str,
        agent_id: &str,
        source_agent_run_id: &str,
        execution_epoch: i64,
        payload: P,
    ) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::Agent {
                agent_id: agent_id.to_string(),
                source_agent_run_id: source_agent_run_id.to_string(),
            },
            camp_id: Some(camp_id.to_string()),
            expected_versions: Vec::new(),
            execution_epoch: Some(execution_epoch),
            payload,
        }
    }

    #[test]
    fn camp_entry_reconciles_default_lead_by_member_order_without_runtime_fallback() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent_1", "agent_2"]);

        let unchanged = service
            .reconcile_default_lead(
                &mut database,
                &user_envelope(
                    "reconcile-current-lead",
                    Some(&camp_id),
                    ReconcileDefaultLeadCommand {
                        camp_id: camp_id.clone(),
                    },
                ),
            )
            .expect("valid current Lead should remain");
        assert_eq!(unchanged.result.code, "camp.default_lead_unchanged");

        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_1'",
                [],
            )
            .expect("Lead should become away");
        let inherited = service
            .reconcile_default_lead(
                &mut database,
                &user_envelope(
                    "reconcile-successor",
                    Some(&camp_id),
                    ReconcileDefaultLeadCommand {
                        camp_id: camp_id.clone(),
                    },
                ),
            )
            .expect("next present member should inherit");
        assert_eq!(inherited.result.payload["defaultLeadAgentId"], "agent_2");

        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_2'",
                [],
            )
            .expect("successor should become away");
        let empty = service
            .reconcile_default_lead(
                &mut database,
                &user_envelope(
                    "reconcile-no-successor",
                    Some(&camp_id),
                    ReconcileDefaultLeadCommand {
                        camp_id: camp_id.clone(),
                    },
                ),
            )
            .expect("Camp should retain a null Lead when no member can inherit");
        assert!(empty.result.payload["defaultLeadAgentId"].is_null());
        let empty_version = empty.result.payload["version"].as_i64().unwrap();
        let repeated = service
            .reconcile_default_lead(
                &mut database,
                &user_envelope(
                    "reconcile-no-successor-again",
                    Some(&camp_id),
                    ReconcileDefaultLeadCommand {
                        camp_id: camp_id.clone(),
                    },
                ),
            )
            .expect("repeated null reconciliation should be a no-op");
        assert_eq!(repeated.result.code, "camp.default_lead_unchanged");
        assert_eq!(repeated.result.payload["version"], empty_version);

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    fn create_camp_with_members(
        service: &CollaborationService,
        database: &mut Database,
        directory: &Path,
        members: &[&str],
    ) -> String {
        let create = user_envelope(
            "create-camp",
            None,
            CreateCampCommand::for_test_with_members(
                directory.join("workspace").to_string_lossy().to_string(),
                members,
                members.first().copied().expect("test Camp needs a member"),
            ),
        );
        let created = service
            .create_camp(database, &create)
            .expect("Camp should be created");
        let camp_id = created.result.payload["campId"]
            .as_str()
            .expect("Camp result should include ID")
            .to_string();
        configure_test_runtime(database, members);
        camp_id
    }

    fn create_pending_camp(
        service: &CollaborationService,
        database: &mut Database,
        directory: &Path,
        command_id: &str,
    ) -> String {
        let mut command =
            CreateCampCommand::for_test(directory.join("workspace").to_string_lossy().to_string());
        command.activation_state = CampActivationState::Pending;
        service
            .create_camp(database, &user_envelope(command_id, None, command))
            .expect("pending Camp should be created")
            .result
            .payload["campId"]
            .as_str()
            .expect("pending Camp should return its ID")
            .to_string()
    }

    #[test]
    fn pending_camp_is_hidden_until_its_draft_is_meaningful_and_first_send_activates_it() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_pending_camp(&service, &mut database, &directory, "pending-camp-create");
        let state: String = database
            .connection()
            .query_row(
                "SELECT activation_state FROM camp WHERE id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, "pending");
        let created_events: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM event_log WHERE camp_id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(created_events, 0);
        let rename = service
            .rename_camp(
                &mut database,
                &user_envelope(
                    "pending-camp-rename",
                    Some(&camp_id),
                    RenameCampCommand {
                        camp_id: camp_id.clone(),
                        title: "不应提前生效".to_string(),
                        expected_version: 1,
                    },
                ),
            )
            .unwrap();
        assert_eq!(rename.result.code, "camp.pending_activation_required");
        assert_eq!(
            ReadModelService
                .navigation_snapshot(&mut database)
                .unwrap()
                .projects
                .len(),
            0
        );

        let draft = CampAttachmentStore::new(&directory)
            .save_body(&mut database, &camp_id, "先保留为草稿")
            .unwrap();
        let draft_navigation = ReadModelService.navigation_snapshot(&mut database).unwrap();
        assert_eq!(draft_navigation.projects.len(), 1);
        assert_eq!(
            draft_navigation.projects[0].recent_camps[0].activation_state,
            "pending"
        );

        let rejected = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "pending-camp-rejected-send",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: Some(draft.revision + 1),
                        body: String::new(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        let state_after_rejection: String = database
            .connection()
            .query_row(
                "SELECT activation_state FROM camp WHERE id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state_after_rejection, "pending");

        let sent = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "pending-camp-first-send",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: Some(draft.revision),
                        body: String::new(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(sent.result.status, CommandResultStatus::Applied);
        let state: String = database
            .connection()
            .query_row(
                "SELECT activation_state FROM camp WHERE id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state, "active");
        let event_types = database
            .connection()
            .prepare(
                "SELECT event_type FROM event_log WHERE camp_id = ?1 AND event_type <> 'command.result' ORDER BY global_sequence",
            )
            .unwrap()
            .query_map([&camp_id], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(event_types, vec!["camp.activated", "camp_message.sent"]);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn pending_discard_and_startup_cleanup_only_remove_empty_private_drafts() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let empty_id =
            create_pending_camp(&service, &mut database, &directory, "pending-empty-create");
        let discarded = service
            .discard_pending_camp(
                &mut database,
                &user_envelope(
                    "pending-empty-discard",
                    Some(&empty_id),
                    DiscardPendingCampCommand {
                        camp_id: empty_id.clone(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(discarded.result.code, "camp.pending_discarded");
        assert_eq!(row_count(&database, "camp"), 0);

        let retained_id = create_pending_camp(
            &service,
            &mut database,
            &directory,
            "pending-retained-create",
        );
        CampAttachmentStore::new(&directory)
            .save_body(&mut database, &retained_id, "需要跨重启保留")
            .unwrap();
        let rejected = service
            .discard_pending_camp(
                &mut database,
                &user_envelope(
                    "pending-retained-discard",
                    Some(&retained_id),
                    DiscardPendingCampCommand {
                        camp_id: retained_id.clone(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(rejected.result.code, "camp.pending_not_empty");
        let abandoned_id = create_pending_camp(
            &service,
            &mut database,
            &directory,
            "pending-abandoned-create",
        );
        let cleaned = service
            .discard_empty_pending_camps_on_startup(&mut database)
            .unwrap();
        assert_eq!(cleaned, vec![abandoned_id]);
        let remaining: Vec<String> = database
            .connection()
            .prepare("SELECT id FROM camp ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(remaining, vec![retained_id]);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn configured_camp_creation_persists_only_the_selected_structure() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let command = CreateCampCommand {
            name: Some("  重构\n\tMCP   设置页  ".to_string()),
            project_path: directory.join("workspace").to_string_lossy().to_string(),
            project_binding_kind: ProjectBindingKind::Directory,
            member_agent_ids: vec!["agent_2".to_string(), "agent_1".to_string()],
            default_lead_agent_id: "agent_1".to_string(),
            collaboration_mode: CampCollaborationMode::Peer,
            activation_state: CampActivationState::Active,
        };
        let created = service
            .create_camp(
                &mut database,
                &user_envelope("configured-camp-create", None, command),
            )
            .expect("configured Camp should be created");
        assert_eq!(created.result.status, CommandResultStatus::Applied);
        let camp_id = created.result.payload["campId"].as_str().unwrap();
        let persisted: (String, String, String, String, i64) = database
            .connection()
            .query_row(
                r#"
                SELECT title, name_origin, collaboration_mode,
                       default_lead_agent_id,
                       (SELECT COUNT(*) FROM camp_member WHERE camp_id = camp.id)
                FROM camp WHERE id = ?1
                "#,
                [camp_id],
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
            .unwrap();
        assert_eq!(
            persisted,
            (
                "重构 MCP 设置页".to_string(),
                "user".to_string(),
                "peer".to_string(),
                "agent_1".to_string(),
                2,
            )
        );
        assert_eq!(row_count(&database, "conversation"), 0);
        assert_eq!(row_count(&database, "camp_message"), 0);
        assert_eq!(row_count(&database, "camp_turn"), 0);
        assert_eq!(row_count(&database, "agent_run"), 0);
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn configured_camp_creation_rejects_stale_structure_without_partial_rows() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        let create = |command_id: &str,
                      members: Vec<&str>,
                      lead: &str,
                      mode: CampCollaborationMode,
                      name: Option<String>| {
            user_envelope(
                command_id,
                None,
                CreateCampCommand {
                    name,
                    project_path: directory.join("workspace").to_string_lossy().to_string(),
                    project_binding_kind: ProjectBindingKind::Directory,
                    member_agent_ids: members.into_iter().map(str::to_string).collect(),
                    default_lead_agent_id: lead.to_string(),
                    collaboration_mode: mode,
                    activation_state: CampActivationState::Active,
                },
            )
        };
        let stale = service
            .create_camp(
                &mut database,
                &create(
                    "configured-camp-stale-member",
                    vec!["agent_2"],
                    "agent_2",
                    CampCollaborationMode::Peer,
                    None,
                ),
            )
            .unwrap();
        assert_eq!(stale.result.code, "camp.invalid_initial_member");
        let invalid_lead = service
            .create_camp(
                &mut database,
                &create(
                    "configured-camp-invalid-lead",
                    vec!["agent_1"],
                    "agent_2",
                    CampCollaborationMode::Peer,
                    None,
                ),
            )
            .unwrap();
        assert_eq!(invalid_lead.result.code, "camp.invalid_default_lead");
        let unsupported_mode = service
            .create_camp(
                &mut database,
                &create(
                    "configured-camp-unsupported-mode",
                    vec!["agent_1"],
                    "agent_1",
                    CampCollaborationMode::LeadCoordinated,
                    None,
                ),
            )
            .unwrap();
        assert_eq!(
            unsupported_mode.result.code,
            "camp.unsupported_collaboration_mode"
        );
        let long_name = service
            .create_camp(
                &mut database,
                &create(
                    "configured-camp-long-name",
                    vec!["agent_1"],
                    "agent_1",
                    CampCollaborationMode::Peer,
                    Some("😀".repeat(81)),
                ),
            )
            .unwrap();
        assert_eq!(long_name.result.code, "camp.name_too_long");
        assert_eq!(row_count(&database, "camp"), 0);
        assert_eq!(row_count(&database, "camp_member"), 0);
        assert_eq!(row_count(&database, "conversation"), 0);
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn camp_name_normalization_and_scalar_boundaries_are_deterministic() {
        assert_eq!(
            normalize_camp_name("  中文\n\t😀  e\u{301}  "),
            "中文 😀 e\u{301}"
        );
        assert_eq!(normalize_camp_name(&"界".repeat(79)).chars().count(), 79);
        assert_eq!(normalize_camp_name(&"😀".repeat(80)).chars().count(), 80);
        assert_eq!(normalize_camp_name(&"😀".repeat(81)).chars().count(), 81);
        let long_content = vec![Segment::Text {
            text: "😀".repeat(81),
        }];
        assert_eq!(
            generated_camp_name(&long_content, |_| None)
                .unwrap()
                .chars()
                .count(),
            80
        );
    }

    #[test]
    fn generated_camp_name_removes_only_the_leading_structured_mention_block() {
        let content = vec![
            Segment::Text {
                text: " \n ".to_string(),
            },
            Segment::MemberMention {
                agent_id: "agent_1".to_string(),
            },
            Segment::Text {
                text: "  ".to_string(),
            },
            Segment::AllMembersMention,
            Segment::Text {
                text: "  讨论 ".to_string(),
            },
            Segment::MemberMention {
                agent_id: "agent_2".to_string(),
            },
            Segment::Text {
                text: " 的方案  ".to_string(),
            },
        ];
        let title = generated_camp_name(&content, |agent_id| match agent_id {
            "agent_1" => Some("开头队员".to_string()),
            "agent_2" => Some("中间队员".to_string()),
            _ => None,
        })
        .unwrap();
        assert_eq!(title, "讨论 @中间队员 的方案");

        let literal = vec![Segment::Text {
            text: "  @手写名字 仍是标题文字  ".to_string(),
        }];
        assert_eq!(
            generated_camp_name(&literal, |_| None).unwrap(),
            "@手写名字 仍是标题文字"
        );

        let mention_only = vec![Segment::MemberMention {
            agent_id: "agent_1".to_string(),
        }];
        assert_eq!(
            generated_camp_name(&mention_only, |_| Some("开头队员".to_string())).unwrap(),
            "未命名对话"
        );
    }

    #[test]
    fn first_execution_creates_only_admitted_targets_and_generates_the_default_name() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent_1", "agent_2"]);
        let accepted = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "configured-camp-first-message",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "  第一条\n\t目标  ".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "第一条目标".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
            )
            .unwrap();
        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
        assert_eq!(row_count(&database, "conversation"), 1);
        let target: String = database
            .connection()
            .query_row(
                "SELECT agent_id FROM conversation WHERE camp_id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(target, "agent_1");
        let name: (String, String) = database
            .connection()
            .query_row(
                "SELECT title, name_origin FROM camp WHERE id = ?1",
                [&camp_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(name, ("第一条 目标".to_string(), "generated".to_string()));
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn initial_execution_atomically_freezes_the_requested_camp_turn_budget() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id = create_camp_with_members(&service, &mut database, &directory, &["agent_1"]);
        let accepted = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "budgeted-initial-execution",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "在冻结预算内完成任务".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "验证原子预算".to_string(),
                            completion_role: "required".to_string(),
                            budget: Some(CampTurnExecutionBudgetRequest {
                                elapsed_seconds: 300,
                                max_agent_run_responsibilities: 3,
                                max_accepted_a2a: 2,
                            }),
                        }),
                    },
                ),
            )
            .unwrap();
        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
        let camp_turn_id = accepted.result.payload["campTurnId"].as_str().unwrap();
        assert_eq!(
            accepted.result.payload["executionBudget"]["schemaVersion"],
            1
        );
        assert_eq!(
            accepted.result.payload["executionBudget"]["elapsedSeconds"],
            300
        );
        assert_eq!(
            accepted.result.payload["executionBudget"]["maxAgentRunResponsibilities"],
            3
        );
        assert_eq!(
            accepted.result.payload["executionBudget"]["maxAcceptedA2a"],
            2
        );
        let snapshot = ReadModelService
            .camp_snapshot(&mut database, &camp_id)
            .unwrap();
        let turn = snapshot
            .turns
            .iter()
            .find(|turn| turn.id == camp_turn_id)
            .unwrap();
        assert_eq!(turn.execution_budget.schema_version, 1);
        assert_eq!(turn.execution_budget.elapsed_seconds, 300);
        assert_eq!(turn.execution_budget.max_agent_run_responsibilities, 3);
        assert_eq!(turn.execution_budget.max_accepted_a2a, 2);
        assert_eq!(
            turn.execution_budget.allocated_agent_run_responsibilities,
            1
        );
        assert_eq!(turn.execution_budget.accepted_a2a, 0);
        assert_eq!(turn.execution_budget.exhausted_at, None);
        let accepted_at =
            chrono::DateTime::parse_from_rfc3339(&turn.execution_budget.accepted_at).unwrap();
        let deadline_at =
            chrono::DateTime::parse_from_rfc3339(&turn.execution_budget.deadline_at).unwrap();
        assert_eq!((deadline_at - accepted_at).num_seconds(), 300);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn initial_execution_rejects_a_root_fanout_that_cannot_fit_without_partial_send_state() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent_1", "agent_2"]);
        let rejected = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "budget-too-small-for-root-fanout",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "两位队员一起处理".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Broadcast,
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "验证 root admission".to_string(),
                            completion_role: "required".to_string(),
                            budget: Some(CampTurnExecutionBudgetRequest {
                                elapsed_seconds: 300,
                                max_agent_run_responsibilities: 1,
                                max_accepted_a2a: 0,
                            }),
                        }),
                    },
                ),
            )
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(rejected.result.code, "camp_turn.execution_budget_invalid");
        assert_eq!(row_count(&database, "camp_message"), 0);
        assert_eq!(row_count(&database, "camp_turn"), 0);
        assert_eq!(row_count(&database, "agent_run"), 0);
        assert_eq!(row_count(&database, "conversation"), 0);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_multi_target_admission_removes_every_new_conversation() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let created = service
            .create_camp(
                &mut database,
                &user_envelope(
                    "configured-camp-unready",
                    None,
                    CreateCampCommand::for_test_with_members(
                        directory.join("workspace").to_string_lossy().to_string(),
                        &["agent_1", "agent_2"],
                        "agent_1",
                    ),
                ),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        let rejected = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "configured-camp-unready-send",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "请一起处理".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Explicit {
                            agent_ids: vec!["agent_1".to_string(), "agent_2".to_string()],
                        },
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "协作".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
            )
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(row_count(&database, "conversation"), 0);
        assert_eq!(row_count(&database, "camp_message"), 0);
        assert_eq!(row_count(&database, "camp_turn"), 0);
        assert_eq!(row_count(&database, "agent_run"), 0);
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn adding_or_reactivating_a_member_does_not_allocate_a_conversation() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id = create_camp_with_members(&service, &mut database, &directory, &["agent_1"]);
        let added = service
            .add_camp_member(
                &mut database,
                &user_envelope(
                    "configured-camp-add-member",
                    Some(&camp_id),
                    AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_id: "agent_2".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        assert_eq!(added.result.status, CommandResultStatus::Applied);
        assert_eq!(row_count(&database, "conversation"), 0);

        database
            .connection()
            .execute(
                r#"
                INSERT INTO conversation(
                    id, camp_id, agent_id, last_message_sequence,
                    version, created_at, updated_at
                ) VALUES (
                    'conversation-muwa-existing', ?1, 'agent_2', 0,
                    1, datetime('now'), datetime('now')
                )
                "#,
                [&camp_id],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                UPDATE camp_member
                SET status = 'left', left_at = datetime('now')
                WHERE camp_id = ?1 AND agent_id = 'agent_2'
                "#,
                [&camp_id],
            )
            .unwrap();
        let reactivated = service
            .add_camp_member(
                &mut database,
                &user_envelope(
                    "configured-camp-reactivate-member",
                    Some(&camp_id),
                    AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_id: "agent_2".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        assert_eq!(reactivated.result.status, CommandResultStatus::Applied);
        assert_eq!(row_count(&database, "conversation"), 1);
        let conversation_id: String = database
            .connection()
            .query_row(
                r#"
                SELECT id FROM conversation
                WHERE camp_id = ?1 AND agent_id = 'agent_2'
                "#,
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(conversation_id, "conversation-muwa-existing");
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    fn row_count(database: &Database, table: &str) -> i64 {
        database
            .connection()
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    #[test]
    fn legacy_pending_execution_intents_do_not_gate_message_or_run_admission() {
        let (mut database, directory) = test_database();
        let collaboration = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&collaboration, &mut database, &directory, &["agent_1"]);
        let command = |command_id: &str, body: &str| {
            user_envelope(
                command_id,
                Some(&camp_id),
                TestCampMessageCommand {
                    camp_id: camp_id.clone(),
                    draft_revision: None,
                    body: body.to_string(),
                    prepared_attachment_ids: Vec::new(),
                    address: TestCampMessageAddress::Default,
                    reply_to_camp_message_id: None,
                    execution: Some(ExecutionRequest {
                        task_id: None,
                        purpose: body.to_string(),
                        completion_role: "required".to_string(),
                        budget: None,
                    }),
                },
            )
        };
        let cancelled_command = command("pending-cancelled", "消息先保存，执行由调度器处理");
        let cancelled_digest =
            canonical_json_digest(&serde_json::to_value(&cancelled_command).unwrap()).unwrap();
        let cancelled_intent =
            RuntimeResolutionService::intent_id_for_command(&cancelled_command.command_id);
        RuntimeResolutionService
            .begin(
                &mut database,
                &cancelled_intent,
                "camp.messages.send",
                Some(&camp_id),
                &serde_json::to_string(&cancelled_command).unwrap(),
                &cancelled_digest,
            )
            .unwrap();
        RuntimeResolutionService
            .claim(&mut database, &cancelled_intent)
            .unwrap();
        RuntimeResolutionService
            .complete_resolution(&mut database, &cancelled_intent)
            .unwrap();
        RuntimeResolutionService
            .cancel(&mut database, &cancelled_intent)
            .unwrap();
        let cancelled = collaboration
            .send_test_camp_message(&mut database, &cancelled_command)
            .unwrap();
        assert_eq!(cancelled.result.status, CommandResultStatus::Accepted);
        assert_eq!(row_count(&database, "camp_message"), 1);
        assert_eq!(row_count(&database, "camp_turn"), 1);
        assert_eq!(row_count(&database, "agent_run"), 1);

        let mismatched_command = command("pending-mismatch", "原始请求");
        let mismatched_digest =
            canonical_json_digest(&serde_json::to_value(&mismatched_command).unwrap()).unwrap();
        let mismatched_intent =
            RuntimeResolutionService::intent_id_for_command(&mismatched_command.command_id);
        RuntimeResolutionService
            .begin(
                &mut database,
                &mismatched_intent,
                "camp.messages.send",
                Some(&camp_id),
                &serde_json::to_string(&mismatched_command).unwrap(),
                &mismatched_digest,
            )
            .unwrap();
        RuntimeResolutionService
            .claim(&mut database, &mismatched_intent)
            .unwrap();
        RuntimeResolutionService
            .complete_resolution(&mut database, &mismatched_intent)
            .unwrap();
        let changed_command = command("pending-mismatch", "被替换的请求");
        let accepted = collaboration
            .send_test_camp_message(&mut database, &changed_command)
            .unwrap();
        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
        assert_eq!(row_count(&database, "camp_message"), 2);
        assert_eq!(row_count(&database, "camp_turn"), 2);
        assert_eq!(row_count(&database, "agent_run"), 2);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    fn camp_version(database: &Database, camp_id: &str) -> i64 {
        database
            .connection()
            .query_row("SELECT version FROM camp WHERE id = ?1", [camp_id], |row| {
                row.get(0)
            })
            .unwrap()
    }

    #[test]
    fn structured_mentions_can_wake_multiple_ready_members() {
        let (mut database, directory) = test_database();
        configure_test_runtime(&database, &["agent_1", "agent_2"]);
        let result = CollaborationService::default()
            .create_test_camp_conversation(
                &mut database,
                &user_envelope(
                    "mentioned-first-message",
                    None,
                    TestCampConversationCommand {
                        project_path: directory.join("workspace").to_string_lossy().to_string(),
                        project_binding_kind: ProjectBindingKind::Directory,
                        body: "请分别回答".to_string(),
                        address: TestCampMessageAddress::Explicit {
                            agent_ids: vec!["agent_2".to_string(), "agent_1".to_string()],
                        },
                        purpose: "并行回答".to_string(),
                    },
                ),
            )
            .expect("explicit first-message routing should succeed");

        assert_eq!(result.result.status, CommandResultStatus::Accepted);
        assert_eq!(
            result.result.payload["agentRunIds"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        let camp_id = result.result.payload["campId"].as_str().unwrap();
        let (title, address_mode, addressed): (String, String, String) = database
            .connection()
            .query_row(
                r#"
                SELECT camp.title, camp_message.address_mode,
                       camp_message.addressed_agent_ids_json
                FROM camp_message
                JOIN camp ON camp.id = camp_message.camp_id
                WHERE camp_message.camp_id = ?1
                "#,
                [camp_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(title, "请分别回答");
        assert_eq!(address_mode, "explicit");
        assert_eq!(
            serde_json::from_str::<Value>(&addressed).unwrap(),
            json!(["agent_2", "agent_1"])
        );

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }
    #[test]
    fn camp_rename_lead_change_and_quiescent_delete_are_versioned() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent_1", "agent_2"]);
        let rename_version = camp_version(&database, &camp_id);
        let renamed = service
            .rename_camp(
                &mut database,
                &user_envelope(
                    "rename-camp",
                    Some(&camp_id),
                    RenameCampCommand {
                        camp_id: camp_id.clone(),
                        title: "  新的\n标题 ".to_string(),
                        expected_version: rename_version,
                    },
                ),
            )
            .expect("Camp should be renamed");
        assert_eq!(renamed.result.code, "camp.renamed");
        let lead_version = camp_version(&database, &camp_id);
        let changed = service
            .change_default_lead(
                &mut database,
                &user_envelope(
                    "change-lead",
                    Some(&camp_id),
                    ChangeDefaultLeadCommand {
                        camp_id: camp_id.clone(),
                        successor_agent_id: "agent_2".to_string(),
                        expected_version: lead_version,
                    },
                ),
            )
            .expect("Default Lead should change");
        assert_eq!(changed.result.code, "camp.default_lead_changed");
        service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "message-before-delete",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "仅保存历史".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .expect("ordinary message should persist");
        let completed_execution = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "completed-execution-before-delete",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "执行后再删除".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "验证终态执行可随 Camp 删除".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
            )
            .expect("execution should be admitted before deletion");
        let agent_run_id = completed_execution.result.payload["agentRunIds"][0]
            .as_str()
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'succeeded', ended_at = datetime('now'),
                    updated_at = datetime('now')
                WHERE id = ?1
                "#,
                [agent_run_id],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                UPDATE camp_turn
                SET status = 'completed', ended_at = datetime('now'),
                    updated_at = datetime('now')
                WHERE id = (SELECT camp_turn_id FROM agent_run WHERE id = ?1)
                "#,
                [agent_run_id],
            )
            .unwrap();
        service
            .create_task(
                &mut database,
                &user_envelope(
                    "task-before-delete",
                    Some(&camp_id),
                    CreateTaskCommand {
                        camp_id: camp_id.clone(),
                        title: "随 Camp 删除".to_string(),
                        description: "验证从属 Task 不残留".to_string(),
                        assignee_agent_id: "agent_2".to_string(),
                        ..Default::default()
                    },
                ),
            )
            .expect("Task should be created before deletion");
        let delete_version = camp_version(&database, &camp_id);
        let delete_envelope = user_envelope(
            "delete-camp",
            Some(&camp_id),
            DeleteCampCommand {
                camp_id: camp_id.clone(),
                expected_version: delete_version,
                force: false,
            },
        );
        let delete = service
            .delete_camp(&mut database, &delete_envelope)
            .expect("quiescent Camp should be deleted");
        let replay = service
            .delete_camp(&mut database, &delete_envelope)
            .expect("delete should replay");
        assert_eq!(delete.result.code, "camp.deleted");
        assert!(replay.replayed);
        assert_eq!(row_count(&database, "camp"), 0);
        assert_eq!(row_count(&database, "camp_member"), 0);
        assert_eq!(row_count(&database, "conversation"), 0);
        assert_eq!(row_count(&database, "camp_message"), 0);
        assert_eq!(row_count(&database, "task"), 0);
        let foreign_key_violations: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(foreign_key_violations, 0);

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn camp_delete_blocks_by_default_and_force_removes_running_work() {
        let (mut database, directory) = test_database();
        configure_test_runtime(&database, &["agent_1"]);
        let service = CollaborationService::default();
        let created = service
            .create_test_camp_conversation(
                &mut database,
                &user_envelope(
                    "camp-with-running-work",
                    None,
                    TestCampConversationCommand {
                        project_path: directory.join("workspace").to_string_lossy().to_string(),
                        project_binding_kind: ProjectBindingKind::Directory,
                        body: "开始执行".to_string(),
                        address: TestCampMessageAddress::Default,
                        purpose: "执行".to_string(),
                    },
                ),
            )
            .expect("Camp should be created");
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        let delete_version = camp_version(&database, &camp_id);
        let result = service
            .delete_camp(
                &mut database,
                &user_envelope(
                    "delete-running-camp",
                    Some(&camp_id),
                    DeleteCampCommand {
                        camp_id: camp_id.clone(),
                        expected_version: delete_version,
                        force: false,
                    },
                ),
            )
            .expect("delete blocker should be a durable result");

        assert_eq!(result.result.status, CommandResultStatus::Rejected);
        assert_eq!(result.result.code, "camp.delete_blocked");
        assert!(
            result.result.payload["blockers"]
                .as_array()
                .unwrap()
                .iter()
                .any(|blocker| blocker["code"] == "nonterminal_agent_run")
        );
        assert_eq!(row_count(&database, "camp"), 1);
        assert_eq!(row_count(&database, "camp_turn"), 1);
        assert_eq!(row_count(&database, "agent_run"), 1);
        let cleanup_targets = ExecutionRuntimeService::default()
            .list_camp_runtime_cleanup_targets(&database, &camp_id)
            .expect("force deletion should capture the active Runtime identity");
        assert_eq!(cleanup_targets.len(), 1);
        assert_eq!(cleanup_targets[0].adapter_kind, AdapterKind::CodexCli);
        let forced = service
            .delete_camp(
                &mut database,
                &user_envelope(
                    "force-delete-running-camp",
                    Some(&camp_id),
                    DeleteCampCommand {
                        camp_id: camp_id.clone(),
                        expected_version: delete_version,
                        force: true,
                    },
                ),
            )
            .expect("forced delete should commit");

        assert_eq!(forced.result.status, CommandResultStatus::Applied);
        assert_eq!(forced.result.code, "camp.deleted");
        assert_eq!(forced.result.payload["forced"], true);
        assert!(
            forced.result.payload["bypassedBlockers"]
                .as_array()
                .unwrap()
                .iter()
                .any(|blocker| blocker["code"] == "nonterminal_agent_run")
        );
        assert_eq!(row_count(&database, "camp"), 0);
        assert_eq!(row_count(&database, "camp_turn"), 0);
        assert_eq!(row_count(&database, "agent_run"), 0);
        assert_eq!(row_count(&database, "conversation"), 0);
        assert_eq!(row_count(&database, "camp_message"), 0);
        let foreign_key_violations: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(foreign_key_violations, 0);

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn ordinary_camp_message_does_not_create_execution_objects() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id = create_camp_with_members(&service, &mut database, &directory, &["agent_2"]);
        let send = user_envelope(
            "send-plain-message",
            Some(&camp_id),
            TestCampMessageCommand {
                camp_id: camp_id.clone(),
                draft_revision: None,
                body: "只记录这条公共消息。".to_string(),
                prepared_attachment_ids: Vec::new(),
                address: TestCampMessageAddress::Default,
                reply_to_camp_message_id: None,
                execution: None,
            },
        );
        let result = service
            .send_test_camp_message(&mut database, &send)
            .expect("message should be stored");

        assert_eq!(result.result.status, CommandResultStatus::Applied);
        assert_eq!(row_count(&database, "camp_message"), 1);
        assert_eq!(row_count(&database, "camp_turn"), 0);
        assert_eq!(row_count(&database, "agent_run"), 0);
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn structured_draft_mentions_are_the_only_addressing_authority() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent_2", "agent_1"]);
        let store = CampAttachmentStore::new(&directory);
        let plain_content = vec![Segment::Text {
            text: "普通文字 @luoke；邮箱 dev@muwa.example 不属于 mention。".to_string(),
        }];
        let plain_draft = store
            .save_content(&mut database, &camp_id, 0, plain_content)
            .unwrap();
        let plain = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "plain-at-control-send",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: Some(plain_draft.revision),
                        body: "ignored".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(plain.result.status, CommandResultStatus::Applied);
        assert_eq!(row_count(&database, "message_delivery"), 0);
        assert_eq!(row_count(&database, "agent_run"), 0);

        let content = vec![
            Segment::Text {
                text: "普通文字 @luoke；请 ".to_string(),
            },
            Segment::MemberMention {
                agent_id: "agent_2".to_string(),
            },
            Segment::Text {
                text: " 和 ".to_string(),
            },
            Segment::MemberMention {
                agent_id: "agent_1".to_string(),
            },
            Segment::MemberMention {
                agent_id: "agent_2".to_string(),
            },
        ];
        let draft = store
            .save_content(&mut database, &camp_id, 0, content.clone())
            .unwrap();
        let send = user_envelope(
            "structured-mention-send",
            Some(&camp_id),
            TestCampMessageCommand {
                camp_id: camp_id.clone(),
                draft_revision: Some(draft.revision),
                body: "caller supplied body must be ignored".to_string(),
                prepared_attachment_ids: vec!["caller-supplied-attachment".to_string()],
                address: TestCampMessageAddress::Broadcast,
                reply_to_camp_message_id: None,
                execution: Some(ExecutionRequest {
                    task_id: None,
                    purpose: "验证结构化 Mention".to_string(),
                    completion_role: "required".to_string(),
                    budget: None,
                }),
            },
        );

        let sent = service
            .send_test_camp_message(&mut database, &send)
            .unwrap();
        let replay = service
            .send_test_camp_message(&mut database, &send)
            .unwrap();
        assert_eq!(sent.result.status, CommandResultStatus::Accepted);
        assert!(replay.replayed);
        assert_eq!(row_count(&database, "camp_message"), 2);
        assert_eq!(row_count(&database, "agent_run"), 2);
        assert_eq!(row_count(&database, "camp_composer_draft"), 0);

        let (body, stored_content, mode, addressed, digest): (
            String,
            Option<String>,
            String,
            String,
            String,
        ) = database
            .connection()
            .query_row(
                r#"
                SELECT body, structured_content_json, address_mode,
                       addressed_agent_ids_json, content_digest
                FROM camp_message
                WHERE id = ?1
                "#,
                [sent.result.payload["campMessageId"].as_str().unwrap()],
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
            .unwrap();
        assert!(body.starts_with("普通文字 @luoke；请 @"));
        assert_ne!(body, send.payload.body);
        assert_eq!(
            serde_json::from_str::<StructuredCampMessageContent>(
                stored_content
                    .as_deref()
                    .expect("new user message is structured")
            )
            .unwrap(),
            content
        );
        assert_eq!(mode, "explicit");
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&addressed).unwrap(),
            vec!["agent_2", "agent_1"]
        );
        assert_eq!(digest, canonical_content_digest(&content).unwrap());

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn direct_user_run_atomically_freezes_structured_skill_identity() {
        let (mut database, directory) = test_database();
        configure_test_runtime(&database, &["agent_1"]);
        let service = CollaborationService::default();
        let camp_id = create_camp_with_members(&service, &mut database, &directory, &["agent_1"]);
        database
            .connection()
            .execute_batch(
                r#"
                INSERT INTO skill(
                    id, name, origin, enabled, lifecycle_status,
                    current_revision_id, version, created_at, updated_at
                ) VALUES (
                    'skill-review', 'review-pr', 'imported', 1, 'active',
                    NULL, 1, datetime('now'), datetime('now')
                );
                INSERT INTO skill_revision(
                    id, skill_id, revision, name, description, source_type,
                    source_metadata_json, content_digest, risk_summary_json,
                    file_count, total_bytes, installed_at
                ) VALUES (
                    'skill-review-r1', 'skill-review', 1, 'review-pr', 'Review a PR',
                    'local_folder', '{}', 'sha256:review-pr',
                    '{"executableFileCount":0,"scriptFileCount":0,"binaryCandidateCount":0,"declaredTools":[]}',
                    1, 1, datetime('now')
                );
                UPDATE skill SET current_revision_id = 'skill-review-r1'
                WHERE id = 'skill-review';
                INSERT INTO skill_group_assignment(
                    group_key, skill_id, revision_id, created_at, updated_at
                ) VALUES (
                    'codex', 'skill-review', 'skill-review-r1',
                    datetime('now'), datetime('now')
                );
                "#,
            )
            .unwrap();
        let store = CampAttachmentStore::new(&directory);
        let content = vec![
            Segment::MemberMention {
                agent_id: "agent_1".to_string(),
            },
            Segment::Text {
                text: " 请用 ".to_string(),
            },
            Segment::SkillMention {
                skill_id: "skill-review".to_string(),
                name_at_send: "review-pr".to_string(),
            },
            Segment::Text {
                text: " 检查".to_string(),
            },
        ];
        let draft = store
            .save_content(&mut database, &camp_id, 0, content.clone())
            .unwrap();
        let sent = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "structured-skill-send",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: Some(draft.revision),
                        body: "ignored".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "验证结构化 Skill".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
            )
            .unwrap();
        assert_eq!(sent.result.status, CommandResultStatus::Accepted);
        let (body, stored_content, snapshot_json, snapshot_digest): (
            String,
            String,
            String,
            String,
        ) = database
            .connection()
            .query_row(
                r#"
                SELECT message.body, message.structured_content_json,
                       run.skill_selection_snapshot_json,
                       run.skill_selection_snapshot_digest
                FROM camp_message AS message
                JOIN agent_run AS run ON run.trigger_camp_message_id = message.id
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert!(body.contains("/review-pr"));
        assert_eq!(
            serde_json::from_str::<StructuredCampMessageContent>(&stored_content).unwrap(),
            content
        );
        let snapshot = parse_skill_selection_snapshot(&snapshot_json, &snapshot_digest).unwrap();
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].skill_id, "skill-review");
        assert_eq!(snapshot.entries[0].name_at_send, "review-pr");
        assert_eq!(snapshot.entries[0].first_segment_index, 2);
        assert!(snapshot.entries[0].eligible_at_send);
        assert!(snapshot.entries[0].omission_reason.is_none());

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn send_rejects_a_tampered_draft_with_core_owned_current_user_attention() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id = create_camp_with_members(&service, &mut database, &directory, &["agent_1"]);
        let draft = CampAttachmentStore::new(&directory)
            .save_content(
                &mut database,
                &camp_id,
                0,
                vec![Segment::Text {
                    text: "普通消息".to_string(),
                }],
            )
            .unwrap();
        let tampered_content = vec![
            Segment::CurrentUserMention {
                user_id: CURRENT_USER_ID.to_string(),
            },
            Segment::Text {
                text: "伪造提醒".to_string(),
            },
        ];
        database
            .connection()
            .execute(
                r#"
                UPDATE camp_composer_draft
                SET body = '@你 伪造提醒', structured_content_json = ?2
                WHERE camp_id = ?1
                "#,
                params![camp_id, serde_json::to_string(&tampered_content).unwrap()],
            )
            .unwrap();
        let send = user_envelope(
            "reject-tampered-current-user-mention",
            Some(&camp_id),
            TestCampMessageCommand {
                camp_id: camp_id.clone(),
                draft_revision: Some(draft.revision),
                body: "caller body ignored".to_string(),
                prepared_attachment_ids: Vec::new(),
                address: TestCampMessageAddress::Default,
                reply_to_camp_message_id: None,
                execution: None,
            },
        );

        let error = service
            .send_test_camp_message(&mut database, &send)
            .unwrap_err();
        assert!(error.to_string().contains("only be generated by Core"));
        assert_eq!(row_count(&database, "camp_message"), 0);
        assert_eq!(row_count(&database, "notification_occurrence"), 0);
        assert_eq!(row_count(&database, "camp_composer_draft"), 1);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn one_all_members_token_freezes_one_run_for_each_current_member() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let members = ["agent_2", "agent_1", "agent_3"];
        let camp_id = create_camp_with_members(&service, &mut database, &directory, &members);
        let draft = CampAttachmentStore::new(&directory)
            .save_content(
                &mut database,
                &camp_id,
                0,
                vec![
                    Segment::AllMembersMention,
                    Segment::Text {
                        text: " 请同步处理；".to_string(),
                    },
                    Segment::MemberMention {
                        agent_id: "agent_2".to_string(),
                    },
                    Segment::MemberMention {
                        agent_id: "agent_2".to_string(),
                    },
                ],
            )
            .unwrap();
        let result = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "structured-all-members-send",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: Some(draft.revision),
                        body: String::new(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "广播验证".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
            )
            .unwrap();
        assert_eq!(result.result.status, CommandResultStatus::Accepted);
        assert_eq!(row_count(&database, "agent_run"), 3);
        let run_creation_boundaries: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(DISTINCT created_at) FROM agent_run",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(run_creation_boundaries, 1);
        let (mode, addressed): (String, String) = database
            .connection()
            .query_row(
                "SELECT address_mode, addressed_agent_ids_json FROM camp_message",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(mode, "broadcast");
        let addressed = serde_json::from_str::<Vec<String>>(&addressed).unwrap();
        assert_eq!(addressed.len(), 3);
        assert_eq!(addressed.iter().collect::<HashSet<_>>().len(), 3);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn stale_or_unavailable_structured_draft_fails_before_any_send_state() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id = create_camp_with_members(&service, &mut database, &directory, &["agent_2"]);
        let store = CampAttachmentStore::new(&directory);
        let unavailable = store
            .save_content(
                &mut database,
                &camp_id,
                0,
                vec![Segment::MemberMention {
                    agent_id: "agent_1".to_string(),
                }],
            )
            .unwrap();
        let invalid_send = user_envelope(
            "unavailable-structured-mention",
            Some(&camp_id),
            TestCampMessageCommand {
                camp_id: camp_id.clone(),
                draft_revision: Some(unavailable.revision),
                body: String::new(),
                prepared_attachment_ids: Vec::new(),
                address: TestCampMessageAddress::Default,
                reply_to_camp_message_id: None,
                execution: None,
            },
        );
        let invalid = service
            .send_test_camp_message(&mut database, &invalid_send)
            .unwrap();
        assert_eq!(invalid.result.code, "mention_target_unavailable");
        assert_eq!(row_count(&database, "camp_message"), 0);
        assert_eq!(row_count(&database, "camp_turn"), 0);
        assert_eq!(row_count(&database, "agent_run"), 0);
        assert_eq!(row_count(&database, "camp_composer_draft"), 1);

        let changed = store
            .save_content(
                &mut database,
                &camp_id,
                unavailable.revision,
                vec![Segment::Text {
                    text: "新的耐久内容".to_string(),
                }],
            )
            .unwrap();
        let stale_send = user_envelope(
            "stale-structured-draft",
            Some(&camp_id),
            invalid_send.payload.clone(),
        );
        let stale = service
            .send_test_camp_message(&mut database, &stale_send)
            .unwrap();
        assert_eq!(stale.result.code, "draft_changed");
        assert_eq!(row_count(&database, "camp_message"), 0);
        assert_eq!(
            store.load_draft(&database, &camp_id).unwrap().revision,
            changed.revision
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn empty_camp_message_requires_at_least_one_ready_attachment() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id = create_camp_with_members(&service, &mut database, &directory, &["agent_2"]);
        let store = CampAttachmentStore::new(&directory);

        let rejected_empty = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "empty-draft-without-attachment",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: String::new(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(rejected_empty.result.status, CommandResultStatus::Rejected);
        assert_eq!(rejected_empty.result.code, "camp_message.empty_body");
        assert_eq!(
            rejected_empty.result.payload["message"],
            "Camp message must contain text or at least one ready attachment"
        );
        let empty = store.load_draft(&database, &camp_id).unwrap();

        let source = directory.join("not-ready.txt");
        std::fs::write(&source, b"not ready").unwrap();
        let not_ready = store
            .prepare_from_path(
                &mut database,
                &camp_id,
                empty.revision,
                &source,
                "not-ready.txt",
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE prepared_attachment SET state = 'error', last_error_code = 'injected_not_ready' WHERE id = ?1",
                [&not_ready.attachments[0].id],
            )
            .unwrap();
        let rejected_not_ready = service
            .send_user_camp_draft(
                &mut database,
                &user_envelope(
                    "empty-draft-with-non-ready-attachment",
                    Some(&camp_id),
                    SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: not_ready.revision,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            rejected_not_ready.result.status,
            CommandResultStatus::Rejected
        );
        assert_eq!(rejected_not_ready.result.code, "camp_message.empty_body");
        assert_eq!(row_count(&database, "camp_message"), 0);
        assert_eq!(row_count(&database, "message_attachment"), 0);
        assert_eq!(row_count(&database, "agent_run"), 0);
        assert_eq!(row_count(&database, "camp_composer_draft"), 1);
        assert_eq!(row_count(&database, "prepared_attachment"), 1);

        store.remove_camp(&camp_id).unwrap();
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn attachment_only_camp_message_atomically_consumes_the_complete_draft() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id = create_camp_with_members(&service, &mut database, &directory, &["agent_2"]);
        let source = directory.join("用户原始文件.txt");
        std::fs::write(&source, b"public camp attachment").unwrap();
        let store = CampAttachmentStore::new(&directory);
        let draft = store
            .prepare_from_path(&mut database, &camp_id, 0, &source, "说明.txt")
            .unwrap();
        let attachment_ids = draft
            .attachments
            .iter()
            .map(|attachment| attachment.id.clone())
            .collect::<Vec<_>>();
        store
            .verify_send(&database, &camp_id, &attachment_ids)
            .unwrap();

        let view_store = CampAttachmentViewStore::for_test(&database).unwrap();
        let command_id = Uuid::new_v4().to_string();
        let publication = view_store
            .stage_publication(&mut database, &store, &camp_id, &command_id, draft.revision)
            .unwrap()
            .expect("attachment publication should stage a View entry");
        view_store
            .gate_publication(&mut database, &publication)
            .unwrap();
        view_store
            .promote_publication(&mut database, &publication)
            .unwrap();

        let result = service
            .send_user_camp_draft_with_publication(
                &mut database,
                &user_envelope(
                    &command_id,
                    Some(&camp_id),
                    SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: draft.revision,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "Camp attachment-only message".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
                Some(&publication.operation_id),
            )
            .unwrap();
        view_store
            .complete_publication(&mut database, &publication.operation_id)
            .unwrap();
        assert_eq!(result.result.status, CommandResultStatus::Accepted);
        assert_eq!(row_count(&database, "camp_composer_draft"), 0);
        assert_eq!(row_count(&database, "prepared_attachment"), 0);
        assert_eq!(row_count(&database, "camp_message"), 1);
        assert_eq!(row_count(&database, "message_attachment"), 1);
        assert_eq!(row_count(&database, "agent_run"), 1);
        let (body, content_json): (String, String) = database
            .connection()
            .query_row(
                "SELECT body, structured_content_json FROM camp_message",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(body, "");
        assert_eq!(content_json, "[]");
        let purpose: String = database
            .connection()
            .query_row("SELECT purpose FROM agent_run", [], |row| row.get(0))
            .unwrap();
        assert_eq!(purpose, "Camp attachment-only message");
        let (stored_id, stored_path, stored_digest): (String, String, String) = database
            .connection()
            .query_row(
                "SELECT id, storage_path, content_digest FROM message_attachment",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(stored_id, attachment_ids[0]);
        assert_eq!(
            std::fs::read(&stored_path).unwrap(),
            b"public camp attachment"
        );
        assert!(stored_digest.starts_with("sha256:"));

        view_store
            .remove_camp_view(&mut database, &camp_id)
            .unwrap();
        store.remove_camp(&camp_id).unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(
            view_store.root().join("camps"),
            std::os::unix::fs::PermissionsExt::from_mode(0o700),
        )
        .unwrap();
        drop(view_store);
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn attachment_consumption_failure_rolls_back_message_turn_and_agent_run() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id = create_camp_with_members(&service, &mut database, &directory, &["agent_2"]);
        let source = directory.join("rollback.txt");
        std::fs::write(&source, b"must remain private").unwrap();
        let store = CampAttachmentStore::new(&directory);
        let draft = store
            .prepare_from_path(&mut database, &camp_id, 0, &source, "rollback.txt")
            .unwrap();
        let view_store = CampAttachmentViewStore::for_test(&database).unwrap();
        let command_id = Uuid::new_v4().to_string();
        let publication = view_store
            .stage_publication(&mut database, &store, &camp_id, &command_id, draft.revision)
            .unwrap()
            .expect("attachment publication should stage a View entry");
        view_store
            .gate_publication(&mut database, &publication)
            .unwrap();
        view_store
            .promote_publication(&mut database, &publication)
            .unwrap();
        database
            .connection()
            .execute_batch(
                r#"
                CREATE TRIGGER reject_test_message_attachment
                BEFORE INSERT ON message_attachment
                BEGIN
                    SELECT RAISE(ABORT, 'injected attachment consumption failure');
                END;
                "#,
            )
            .unwrap();

        let error = service
            .send_user_camp_draft_with_publication(
                &mut database,
                &user_envelope(
                    &command_id,
                    Some(&camp_id),
                    SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: draft.revision,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "Camp attachment-only message".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
                Some(&publication.operation_id),
            )
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("injected attachment consumption failure")
        );
        assert_eq!(row_count(&database, "camp_message"), 0);
        assert_eq!(row_count(&database, "message_attachment"), 0);
        assert_eq!(row_count(&database, "camp_turn"), 0);
        assert_eq!(row_count(&database, "agent_run"), 0);
        assert_eq!(row_count(&database, "camp_composer_draft"), 1);
        assert_eq!(row_count(&database, "prepared_attachment"), 1);

        database
            .connection()
            .execute_batch("DROP TRIGGER reject_test_message_attachment;")
            .unwrap();
        view_store
            .rollback_publication(
                &mut database,
                &publication.operation_id,
                "injected_test_failure",
            )
            .unwrap();
        view_store
            .remove_camp_view(&mut database, &camp_id)
            .unwrap();
        store.remove_camp(&camp_id).unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(
            view_store.root().join("camps"),
            std::os::unix::fs::PermissionsExt::from_mode(0o700),
        )
        .unwrap();
        drop(view_store);
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn user_send_consumes_reply_only_from_the_exact_core_draft() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent_2", "agent_1"]);
        let parent = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "reply-parent-send",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "原消息".into(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        let parent_id = parent.result.payload["campMessageId"]
            .as_str()
            .unwrap()
            .to_string();
        let store = CampAttachmentStore::new(&directory);
        let draft = store
            .save_body(&mut database, &camp_id, "引用用户消息")
            .unwrap();
        let draft = store
            .start_reply(&mut database, &camp_id, draft.revision, &parent_id)
            .unwrap();
        let sent = service
            .send_user_camp_draft(
                &mut database,
                &user_envelope(
                    "reply-draft-only-send",
                    Some(&camp_id),
                    SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: draft.revision,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(sent.result.status, CommandResultStatus::Applied);
        let reply_id = sent.result.payload["campMessageId"].as_str().unwrap();
        let stored_reply: Option<String> = database
            .connection()
            .query_row(
                "SELECT reply_to_camp_message_id FROM camp_message WHERE id = ?1",
                [reply_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored_reply.as_deref(), Some(parent_id.as_str()));
        assert_eq!(row_count(&database, "camp_composer_draft"), 0);

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn continuation_send_materializes_one_mention_and_never_falls_back_when_unavailable() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent_1", "agent_2"]);
        let source = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "continuation-source-send",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "先交给第二位成员".into(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Explicit {
                            agent_ids: vec!["agent_2".into()],
                        },
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(source.result.status, CommandResultStatus::Applied);
        let source_message_id = source.result.payload["campMessageId"]
            .as_str()
            .unwrap()
            .to_string();
        let store = CampAttachmentStore::new(&directory);
        let empty = store.load_draft(&database, &camp_id).unwrap();
        assert_eq!(
            empty
                .continuation_intent
                .as_ref()
                .unwrap()
                .recipient
                .agent_id,
            "agent_2"
        );
        let draft = store
            .save_content_with_continuation(
                &mut database,
                &camp_id,
                empty.revision,
                vec![Segment::Text {
                    text: "继续处理下一步".into(),
                }],
                Some(&source_message_id),
            )
            .unwrap();
        let continued = service
            .send_user_camp_draft(
                &mut database,
                &user_envelope(
                    "continuation-materialized-send",
                    Some(&camp_id),
                    SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: draft.revision,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(continued.result.status, CommandResultStatus::Applied);
        let (continued_mode, continued_addressed, continued_reply, continued_content): (
            String,
            String,
            Option<String>,
            Option<String>,
        ) = database
            .connection()
            .query_row(
                r#"
                SELECT address_mode, addressed_agent_ids_json,
                       reply_to_camp_message_id, structured_content_json
                FROM camp_message ORDER BY sequence DESC LIMIT 1
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(continued_mode, "explicit");
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&continued_addressed).unwrap(),
            vec!["agent_2"]
        );
        assert!(continued_reply.is_none());
        assert!(matches!(
            serde_json::from_str::<StructuredCampMessageContent>(
                continued_content.as_deref().unwrap()
            )
            .unwrap()
            .first(),
            Some(Segment::MemberMention { agent_id }) if agent_id == "agent_2"
        ));

        let next_empty = store.load_draft(&database, &camp_id).unwrap();
        let blocked_draft = store
            .save_content_with_continuation(
                &mut database,
                &camp_id,
                next_empty.revision,
                vec![Segment::Text {
                    text: "对象失效时保留".into(),
                }],
                Some(
                    &next_empty
                        .continuation_intent
                        .as_ref()
                        .unwrap()
                        .source_camp_message_id,
                ),
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();

        let rejected = service
            .send_user_camp_draft(
                &mut database,
                &user_envelope(
                    "continuation-unavailable-send",
                    Some(&camp_id),
                    SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: blocked_draft.revision,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(rejected.result.code, "continuation_recipient_required");
        assert_eq!(row_count(&database, "camp_message"), 2);
        assert_eq!(row_count(&database, "camp_composer_draft"), 1);

        let repaired = store
            .resolve_continuation_recipient(
                &mut database,
                &camp_id,
                blocked_draft.revision,
                "agent_1",
            )
            .unwrap();
        let sent = service
            .send_user_camp_draft(
                &mut database,
                &user_envelope(
                    "continuation-repaired-send",
                    Some(&camp_id),
                    SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: repaired.revision,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(sent.result.status, CommandResultStatus::Applied);
        let (mode, addressed, reply_to, content): (String, String, Option<String>, Option<String>) =
            database
                .connection()
                .query_row(
                    r#"
                SELECT address_mode, addressed_agent_ids_json,
                       reply_to_camp_message_id, structured_content_json
                FROM camp_message
                ORDER BY sequence DESC
                LIMIT 1
                "#,
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .unwrap();
        assert_eq!(mode, "explicit");
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&addressed).unwrap(),
            vec!["agent_1"]
        );
        assert!(reply_to.is_none());
        assert!(matches!(
            serde_json::from_str::<StructuredCampMessageContent>(content.as_deref().unwrap())
                .unwrap()
                .first(),
            Some(Segment::MemberMention { agent_id }) if agent_id == "agent_1"
        ));

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn unavailable_reply_recipient_and_snapshot_races_reject_without_fallback_state() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent_2", "agent_1"]);
        let parent = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "unavailable-reply-parent",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "Agent 原消息".into(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        let parent_id = parent.result.payload["campMessageId"]
            .as_str()
            .unwrap()
            .to_string();
        database
            .connection()
            .execute(
                "UPDATE camp_message SET author_type = 'agent', author_id = 'agent_2' WHERE id = ?1",
                [&parent_id],
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        let store = CampAttachmentStore::new(&directory);
        let draft = store
            .save_body(&mut database, &camp_id, "不得回退给负责人")
            .unwrap();
        let draft = store
            .start_reply(&mut database, &camp_id, draft.revision, &parent_id)
            .unwrap();
        assert!(
            draft
                .reply_intent
                .as_ref()
                .unwrap()
                .recipient_selection_required
        );
        let before = (
            row_count(&database, "camp_message"),
            row_count(&database, "camp_turn"),
            row_count(&database, "agent_run"),
        );
        let rejected = service
            .send_user_camp_draft(
                &mut database,
                &user_envelope(
                    "unresolved-reply-send",
                    Some(&camp_id),
                    SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: draft.revision,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(rejected.result.code, "reply_recipient_required");
        assert_eq!(
            before,
            (
                row_count(&database, "camp_message"),
                row_count(&database, "camp_turn"),
                row_count(&database, "agent_run"),
            )
        );
        assert_eq!(row_count(&database, "camp_composer_draft"), 1);

        let resolved = store
            .resolve_reply_recipient(
                &mut database,
                &camp_id,
                draft.revision,
                crate::camp_attachment::CampComposerReplyRecipient::Member {
                    agent_id: "agent_1".into(),
                },
            )
            .unwrap();
        let accepted = service
            .send_user_camp_draft(
                &mut database,
                &user_envelope(
                    "resolved-reply-send",
                    Some(&camp_id),
                    SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: resolved.revision,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(accepted.result.status, CommandResultStatus::Applied);
        let addressed: String = database
            .connection()
            .query_row(
                "SELECT addressed_agent_ids_json FROM camp_message WHERE id = ?1",
                [accepted.result.payload["campMessageId"].as_str().unwrap()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(addressed, "[\"agent_1\"]");

        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'present' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        let race_draft = store
            .save_body(&mut database, &camp_id, "点击后作者才失效")
            .unwrap();
        let race_draft = store
            .start_reply(&mut database, &camp_id, race_draft.revision, &parent_id)
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        let race_before = row_count(&database, "camp_message");
        let race = service
            .send_user_camp_draft(
                &mut database,
                &user_envelope(
                    "reply-author-race-send",
                    Some(&camp_id),
                    SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: race_draft.revision,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(race.result.code, "mention_target_unavailable");
        assert_eq!(row_count(&database, "camp_message"), race_before);
        assert_eq!(row_count(&database, "camp_composer_draft"), 1);

        database
            .connection()
            .execute(
                "UPDATE camp_message SET tombstoned_at = '2026-08-14T12:00:00Z' WHERE id = ?1",
                [&parent_id],
            )
            .unwrap();
        let missing_parent = service
            .send_user_camp_draft(
                &mut database,
                &user_envelope(
                    "reply-parent-tombstoned-send",
                    Some(&camp_id),
                    SendUserCampDraftCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: race_draft.revision,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(missing_parent.result.code, "camp_message.invalid_reply");
        assert_eq!(row_count(&database, "camp_message"), race_before);

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn one_fanout_trigger_creates_one_turn_and_independent_frozen_runs() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent_2", "agent_1"]);
        let plain = user_envelope(
            "message-before-run",
            Some(&camp_id),
            TestCampMessageCommand {
                camp_id: camp_id.clone(),
                draft_revision: None,
                body: "公共前置信息".to_string(),
                prepared_attachment_ids: Vec::new(),
                address: TestCampMessageAddress::Default,
                reply_to_camp_message_id: None,
                execution: None,
            },
        );
        service
            .send_test_camp_message(&mut database, &plain)
            .expect("prefix message should be stored");

        let fanout = user_envelope(
            "fanout-message",
            Some(&camp_id),
            TestCampMessageCommand {
                camp_id: camp_id.clone(),
                draft_revision: None,
                body: "请分别给出方案。".to_string(),
                prepared_attachment_ids: Vec::new(),
                address: TestCampMessageAddress::Explicit {
                    agent_ids: vec![
                        "agent_2".to_string(),
                        "agent_1".to_string(),
                        "agent_2".to_string(),
                    ],
                },
                reply_to_camp_message_id: None,
                execution: Some(ExecutionRequest {
                    task_id: None,
                    purpose: "独立分析".to_string(),
                    completion_role: "required".to_string(),
                    budget: None,
                }),
            },
        );
        let first = service
            .send_test_camp_message(&mut database, &fanout)
            .expect("fanout should be created");
        let replay = service
            .send_test_camp_message(&mut database, &fanout)
            .expect("fanout retry should replay");

        assert_eq!(first.result.status, CommandResultStatus::Accepted);
        assert!(replay.replayed);
        assert_eq!(row_count(&database, "camp_message"), 2);
        assert_eq!(row_count(&database, "camp_turn"), 1);
        assert_eq!(row_count(&database, "agent_run"), 2);
        let frozen_runs: i64 = database
            .connection()
            .query_row(
                r#"
                SELECT COUNT(*) FROM agent_run
                WHERE status = 'queued'
                  AND input_ready_at IS NOT NULL
                  AND initial_camp_context_through_sequence = 2
                  AND initial_conversation_context_through_sequence = 0
                  AND trigger_camp_message_id IS NOT NULL
                  AND trigger_conversation_message_id IS NULL
                "#,
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(frozen_runs, 2);
        let frozen_configs = database
            .connection()
            .prepare("SELECT effective_config_json FROM agent_run ORDER BY conversation_id")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(frozen_configs.iter().all(|config| {
            let config = serde_json::from_str::<Value>(config).unwrap();
            config["schemaVersion"] == 3 && config.get("memberIdentity").is_none()
        }));
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_profile
                SET display_name = '稍后生效的名称', team_role = '稍后生效的角色',
                    professional_responsibilities = '稍后生效的职责',
                    personality_traits_json = '["稍后生效"]',
                    working_principles = '稍后生效的准则', growth_topic = '稍后生效的课题'
                WHERE id = 'agent_1'
                "#,
                [],
            )
            .unwrap();
        let frozen_after_profile_edit = database
            .connection()
            .prepare("SELECT effective_config_json FROM agent_run ORDER BY conversation_id")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(frozen_after_profile_edit, frozen_configs);
        let materialized_messages: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM conversation_message WHERE source_camp_message_id IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(materialized_messages, 0);
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn lightweight_task_is_explicit_versioned_and_terminal() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent_2", "agent_1"]);
        let baseline_messages = row_count(&database, "camp_message");
        let baseline_turns = row_count(&database, "camp_turn");
        let baseline_runs = row_count(&database, "agent_run");

        let created = service
            .create_task(
                &mut database,
                &user_envelope(
                    "create-lightweight-task",
                    Some(&camp_id),
                    CreateTaskCommand {
                        camp_id: camp_id.clone(),
                        title: "  实现轻量 Task  ".to_string(),
                        description: "  不自动唤醒任何队员  ".to_string(),
                        assignee_agent_id: "agent_2".to_string(),
                        ..Default::default()
                    },
                ),
            )
            .expect("Task creation should succeed");
        let task_id = created.result.payload["taskId"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(created.result.status, CommandResultStatus::Applied);
        assert_eq!(row_count(&database, "camp_message"), baseline_messages);
        assert_eq!(row_count(&database, "camp_turn"), baseline_turns);
        assert_eq!(row_count(&database, "agent_run"), baseline_runs);

        let updated = service
            .update_task(
                &mut database,
                &user_envelope(
                    "start-lightweight-task",
                    Some(&camp_id),
                    UpdateTaskCommand {
                        task_id: task_id.clone(),
                        expected_version: 1,
                        title: None,
                        description: None,
                        status: Some(TaskStatus::InProgress),
                        assignee: TaskAssigneeUpdate::Assign {
                            agent_id: "agent_2".to_string(),
                        },
                        ..Default::default()
                    },
                ),
            )
            .expect("Task update should succeed");
        assert_eq!(updated.result.status, CommandResultStatus::Applied);
        assert_eq!(updated.result.payload["version"], 2);
        assert_eq!(row_count(&database, "camp_message"), baseline_messages);
        assert_eq!(row_count(&database, "camp_turn"), baseline_turns);
        assert_eq!(row_count(&database, "agent_run"), baseline_runs);

        let unchanged = service
            .update_task(
                &mut database,
                &user_envelope(
                    "unchanged-lightweight-task",
                    Some(&camp_id),
                    UpdateTaskCommand {
                        task_id: task_id.clone(),
                        expected_version: 2,
                        status: Some(TaskStatus::InProgress),
                        ..Default::default()
                    },
                ),
            )
            .expect("An identical projected state should be a durable no-op");
        assert_eq!(unchanged.result.code, "task.unchanged");
        assert_eq!(unchanged.result.payload["changed"], false);
        assert_eq!(unchanged.result.payload["version"], 2);
        let update_events_after_noop: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM event_log WHERE entity_type = 'task' AND entity_id = ?1 AND event_type = 'task.updated'",
                [&task_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(update_events_after_noop, 1);

        let stale = service
            .update_task(
                &mut database,
                &user_envelope(
                    "stale-lightweight-task",
                    Some(&camp_id),
                    UpdateTaskCommand {
                        task_id: task_id.clone(),
                        expected_version: 1,
                        title: Some("stale".to_string()),
                        description: None,
                        status: None,
                        assignee: TaskAssigneeUpdate::Unchanged,
                        ..Default::default()
                    },
                ),
            )
            .expect("Version conflict should be durable");
        assert_eq!(stale.result.code, "task.version_conflict");

        let completed = service
            .update_task(
                &mut database,
                &user_envelope(
                    "complete-lightweight-task",
                    Some(&camp_id),
                    UpdateTaskCommand {
                        task_id: task_id.clone(),
                        expected_version: 2,
                        title: None,
                        description: None,
                        status: Some(TaskStatus::Completed),
                        assignee: TaskAssigneeUpdate::Unchanged,
                        completion_summary: Some("任务完成".to_string()),
                        ..Default::default()
                    },
                ),
            )
            .expect("Authorized declaration should complete the Task");
        assert_eq!(completed.result.payload["version"], 3);
        let (status, version, closed_at): (String, i64, Option<String>) = database
            .connection()
            .query_row(
                "SELECT status, version, closed_at FROM task WHERE id = ?1",
                [&task_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(status, "completed");
        assert_eq!(version, 3);
        assert!(closed_at.is_some());
        assert_eq!(row_count(&database, "camp_message"), baseline_messages);
        let task_update_events: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM event_log WHERE entity_type = 'task' AND entity_id = ?1 AND event_type = 'task.updated'",
                [&task_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(task_update_events, 2);
        let indexed_system_events: i64 = database
            .connection()
            .query_row(
                r#"
                SELECT COUNT(*)
                FROM camp_message_fts AS indexed
                JOIN camp_message ON camp_message.rowid = indexed.rowid
                WHERE camp_message.camp_id = ?1
                  AND camp_message.author_type = 'system'
                "#,
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexed_system_events, 0);

        let terminal = service
            .update_task(
                &mut database,
                &user_envelope(
                    "mutate-terminal-task",
                    Some(&camp_id),
                    UpdateTaskCommand {
                        task_id: task_id.clone(),
                        expected_version: 3,
                        title: Some("不得修改".to_string()),
                        description: None,
                        status: None,
                        assignee: TaskAssigneeUpdate::Unchanged,
                        ..Default::default()
                    },
                ),
            )
            .expect("Terminal rejection should be durable");
        assert_eq!(terminal.result.code, "task.terminal");
        for removed_table in ["task_dependency", "task_evidence_binding"] {
            let exists: i64 = database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [removed_table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(exists, 0);
        }
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn task_query_filters_before_stable_cursor_pagination_without_writes() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent_2", "agent_1"]);
        let create = |command_id: &str, assignee_agent_id: &str| {
            user_envelope(
                command_id,
                Some(&camp_id),
                CreateTaskCommand {
                    camp_id: camp_id.clone(),
                    title: command_id.to_string(),
                    description: format!("description:{command_id}"),
                    assignee_agent_id: assignee_agent_id.to_string(),
                    ..Default::default()
                },
            )
        };
        let first = service
            .create_task(&mut database, &create("query-unassigned", "agent_2"))
            .unwrap();
        let second = service
            .create_task(&mut database, &create("query-muwa", "agent_2"))
            .unwrap();
        let third = service
            .create_task(&mut database, &create("query-luoke", "agent_1"))
            .unwrap();
        let first_id = first.result.payload["taskId"].as_str().unwrap().to_string();
        service
            .update_task(
                &mut database,
                &user_envelope(
                    "release-query-task",
                    Some(&camp_id),
                    UpdateTaskCommand {
                        task_id: first_id.clone(),
                        expected_version: 1,
                        assignee: TaskAssigneeUpdate::Clear,
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        let second_id = second.result.payload["taskId"].as_str().unwrap();
        let unassigned_completed = service
            .update_task(
                &mut database,
                &user_envelope(
                    "cannot-complete-unassigned-task",
                    Some(&camp_id),
                    UpdateTaskCommand {
                        task_id: first_id.clone(),
                        expected_version: 2,
                        status: Some(TaskStatus::Completed),
                        completion_summary: Some("无人负责不可直接完成".to_string()),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            unassigned_completed.result.code,
            "task.invalid_projected_state"
        );
        let unassigned_state: (String, Option<String>, i64) = database
            .connection()
            .query_row(
                "SELECT status, assignee_agent_id, version FROM task WHERE id = ?1",
                [&first_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(unassigned_state, ("pending".to_string(), None, 2));
        service
            .update_task(
                &mut database,
                &user_envelope(
                    "complete-query-muwa",
                    Some(&camp_id),
                    UpdateTaskCommand {
                        task_id: second_id.to_string(),
                        expected_version: 1,
                        title: None,
                        description: None,
                        status: Some(TaskStatus::Completed),
                        assignee: TaskAssigneeUpdate::Unchanged,
                        completion_summary: Some("查询测试完成".to_string()),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        let user = ActorRef::User {
            user_id: "local_user".to_string(),
        };
        let event_count_before = row_count(&database, "event_log");
        let active = service
            .query_visible_tasks(&database, &camp_id, &user, None, &TaskListQuery::default())
            .unwrap();
        assert_eq!(active.tasks.len(), 2);
        assert!(
            active
                .tasks
                .iter()
                .all(|task| task.status != TaskStatus::Completed)
        );

        let all_statuses = vec![
            TaskStatus::Pending,
            TaskStatus::InProgress,
            TaskStatus::Completed,
            TaskStatus::Cancelled,
        ];
        let first_page = service
            .query_visible_tasks(
                &database,
                &camp_id,
                &user,
                None,
                &TaskListQuery {
                    statuses: Some(all_statuses.clone()),
                    limit: 1,
                    ..TaskListQuery::default()
                },
            )
            .unwrap();
        assert_eq!(first_page.tasks.len(), 1);
        assert!(first_page.truncated);
        let second_page = service
            .query_visible_tasks(
                &database,
                &camp_id,
                &user,
                None,
                &TaskListQuery {
                    statuses: Some(all_statuses),
                    limit: 2,
                    cursor: first_page.next_cursor.clone(),
                    ..TaskListQuery::default()
                },
            )
            .unwrap();
        assert_eq!(second_page.tasks.len(), 2);
        assert!(!second_page.truncated);
        assert_ne!(first_page.tasks[0].task_id, second_page.tasks[0].task_id);

        let unassigned = service
            .query_visible_tasks(
                &database,
                &camp_id,
                &user,
                None,
                &TaskListQuery {
                    assignee: TaskAssigneeFilter::Unassigned,
                    ..TaskListQuery::default()
                },
            )
            .unwrap();
        assert_eq!(unassigned.tasks.len(), 1);
        assert_eq!(
            unassigned.tasks[0].task_id,
            first.result.payload["taskId"].as_str().unwrap()
        );
        assert_eq!(unassigned.tasks[0].available_actions, ["update"]);

        let completed = service
            .get_visible_task(&database, &camp_id, second_id, &user, None)
            .unwrap()
            .unwrap();
        assert!(completed.available_actions.is_empty());

        let luoke_task = service
            .get_visible_task(
                &database,
                &camp_id,
                third.result.payload["taskId"].as_str().unwrap(),
                &user,
                None,
            )
            .unwrap()
            .unwrap();
        assert_eq!(luoke_task.available_actions, ["update"]);
        assert!(
            service
                .query_visible_tasks(
                    &database,
                    &camp_id,
                    &user,
                    None,
                    &TaskListQuery {
                        cursor: Some("not-a-cursor".to_string()),
                        ..TaskListQuery::default()
                    },
                )
                .is_err()
        );
        assert_eq!(row_count(&database, "event_log"), event_count_before);

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn agent_task_updates_respect_lead_and_assignee_authority() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent_2", "agent_1"]);
        let create_user_task = |command_id: &str, assignee_agent_id: &str| {
            user_envelope(
                command_id,
                Some(&camp_id),
                CreateTaskCommand {
                    camp_id: camp_id.clone(),
                    title: command_id.to_string(),
                    description: String::new(),
                    assignee_agent_id: assignee_agent_id.to_string(),
                    ..Default::default()
                },
            )
        };
        let assigned = service
            .create_task(
                &mut database,
                &create_user_task("assigned-to-muwa", "agent_2"),
            )
            .unwrap();
        let assigned_id = assigned.result.payload["taskId"]
            .as_str()
            .unwrap()
            .to_string();
        let owned = service
            .create_task(
                &mut database,
                &create_user_task("assigned-to-luoke", "agent_1"),
            )
            .unwrap();
        let owned_id = owned.result.payload["taskId"].as_str().unwrap().to_string();

        let trigger = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "start-luoke-task-run",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "请处理 Task".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Explicit {
                            agent_ids: vec!["agent_1".to_string()],
                        },
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "验证 Task 权限".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
            )
            .unwrap();
        let source_agent_run_id = trigger.result.payload["agentRunIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let now = chrono::Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'running', execution_epoch = 1,
                    execution_lease_owner = 'test-runtime',
                    execution_lease_expires_at = '2999-01-01T00:00:00Z',
                    started_at = ?2, updated_at = ?2
                WHERE id = ?1
                "#,
                params![source_agent_run_id, now],
            )
            .unwrap();
        let task_operation_messages = row_count(&database, "camp_message");
        let task_operation_runs = row_count(&database, "agent_run");
        let user_tasks = service
            .list_visible_tasks(
                &database,
                &camp_id,
                &ActorRef::User {
                    user_id: "local_user".to_string(),
                },
                None,
            )
            .unwrap();
        assert_eq!(user_tasks.len(), 2);
        let luoke_actor = ActorRef::Agent {
            agent_id: "agent_1".to_string(),
            source_agent_run_id: source_agent_run_id.clone(),
        };
        let ordinary_tasks = service
            .list_visible_tasks(&database, &camp_id, &luoke_actor, Some(1))
            .unwrap();
        assert_eq!(ordinary_tasks.len(), 2);
        assert!(
            service
                .get_visible_task(&database, &camp_id, &assigned_id, &luoke_actor, Some(1),)
                .unwrap()
                .is_some()
        );
        let ordinary_forbidden = service
            .update_task(
                &mut database,
                &agent_envelope(
                    "luoke-cannot-edit-muwa-before-lead",
                    &camp_id,
                    "agent_1",
                    &source_agent_run_id,
                    1,
                    UpdateTaskCommand {
                        task_id: assigned_id.clone(),
                        expected_version: 1,
                        title: Some("越权".to_string()),
                        description: None,
                        status: None,
                        assignee: TaskAssigneeUpdate::Unchanged,
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        assert_eq!(ordinary_forbidden.result.code, "task.update_forbidden");
        let blocked = service
            .update_task(
                &mut database,
                &agent_envelope(
                    "luoke-blocks-owned-task",
                    &camp_id,
                    "agent_1",
                    &source_agent_run_id,
                    1,
                    UpdateTaskCommand {
                        task_id: owned_id.clone(),
                        expected_version: 1,
                        status: Some(TaskStatus::Blocked),
                        blocked_reason: Some("等待输入".to_string()),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        assert_eq!(blocked.result.status, CommandResultStatus::Applied);

        let agent_created = service
            .create_task(
                &mut database,
                &agent_envelope(
                    "luoke-cannot-create-before-lead",
                    &camp_id,
                    "agent_1",
                    &source_agent_run_id,
                    1,
                    CreateTaskCommand {
                        camp_id: camp_id.clone(),
                        title: "普通 Agent 不得创建".to_string(),
                        description: String::new(),
                        assignee_agent_id: "agent_1".to_string(),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        assert_eq!(agent_created.result.code, "task.create_forbidden");
        let agent_created_with_invalid_input = service
            .create_task(
                &mut database,
                &agent_envelope(
                    "luoke-cannot-probe-create-state",
                    &camp_id,
                    "agent_1",
                    &source_agent_run_id,
                    1,
                    CreateTaskCommand {
                        camp_id: "camp-does-not-exist".to_string(),
                        title: String::new(),
                        assignee_agent_id: String::new(),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            agent_created_with_invalid_input.result.code,
            "task.create_forbidden"
        );

        database
            .connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id = 'agent_1' WHERE id = ?1",
                [&camp_id],
            )
            .unwrap();
        assert_eq!(
            service
                .list_visible_tasks(&database, &camp_id, &luoke_actor, Some(1))
                .unwrap()
                .len(),
            2
        );
        let lead_update = service
            .update_task(
                &mut database,
                &agent_envelope(
                    "luoke-lead-closes-muwa",
                    &camp_id,
                    "agent_1",
                    &source_agent_run_id,
                    1,
                    UpdateTaskCommand {
                        task_id: assigned_id,
                        expected_version: 1,
                        title: Some("Lead 已收口".to_string()),
                        description: None,
                        status: None,
                        assignee: TaskAssigneeUpdate::Unchanged,
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        assert_eq!(lead_update.result.status, CommandResultStatus::Applied);

        let lead_created = service
            .create_task(
                &mut database,
                &agent_envelope(
                    "luoke-lead-creates-task",
                    &camp_id,
                    "agent_1",
                    &source_agent_run_id,
                    1,
                    CreateTaskCommand {
                        camp_id: camp_id.clone(),
                        title: "Lead 定义责任".to_string(),
                        description: String::new(),
                        assignee_agent_id: "agent_1".to_string(),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        assert_eq!(lead_created.result.status, CommandResultStatus::Applied);
        let lead_created_id = lead_created.result.payload["taskId"]
            .as_str()
            .unwrap()
            .to_string();

        database
            .connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id = 'agent_2' WHERE id = ?1",
                [&camp_id],
            )
            .unwrap();
        let ordinary_cancel = service
            .update_task(
                &mut database,
                &agent_envelope(
                    "luoke-cannot-cancel-owned-task",
                    &camp_id,
                    "agent_1",
                    &source_agent_run_id,
                    1,
                    UpdateTaskCommand {
                        task_id: owned_id,
                        expected_version: 2,
                        status: Some(TaskStatus::Cancelled),
                        cancel_reason: Some("普通 Agent 不具有取消权限".to_string()),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        assert_eq!(ordinary_cancel.result.code, "task.update_forbidden");
        database
            .connection()
            .execute(
                r#"
                UPDATE camp SET default_lead_agent_id = 'agent_1' WHERE id = ?1;
                "#,
                [&camp_id],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET cancel_requested_at = ?2,
                    cancel_reason_code = 'user_requested_agent_run_stop'
                WHERE id = ?1
                "#,
                params![source_agent_run_id, chrono::Utc::now().to_rfc3339()],
            )
            .unwrap();
        let fenced_update = service
            .update_task(
                &mut database,
                &agent_envelope(
                    "cancel-request-fences-lead-task-write",
                    &camp_id,
                    "agent_1",
                    &source_agent_run_id,
                    1,
                    UpdateTaskCommand {
                        task_id: lead_created_id,
                        expected_version: 1,
                        title: Some("取消后不得继续写入".to_string()),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        assert_eq!(
            fenced_update.result.code, "task.not_found",
            "a cancellation request immediately removes the Run's task read/write scope"
        );
        assert_eq!(
            row_count(&database, "camp_message"),
            task_operation_messages,
            "Task creation and updates do not create CampMessages"
        );
        assert_eq!(row_count(&database, "agent_run"), task_operation_runs);

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn accepted_task_linked_run_keeps_frozen_admission_after_task_changes() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent_2", "agent_1"]);
        let created = service
            .create_task(
                &mut database,
                &user_envelope(
                    "create-linked-task",
                    Some(&camp_id),
                    CreateTaskCommand {
                        camp_id: camp_id.clone(),
                        title: "一次性准入".to_string(),
                        description: "Task 后续变化不得撤销已经接受的执行".to_string(),
                        assignee_agent_id: "agent_2".to_string(),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        let task_id = created.result.payload["taskId"]
            .as_str()
            .unwrap()
            .to_string();
        let queued = service
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "queue-linked-task-run",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "请按执行合同完成工作。".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Explicit {
                            agent_ids: vec!["agent_2".to_string()],
                        },
                        reply_to_camp_message_id: None,
                        execution: Some(ExecutionRequest {
                            task_id: Some(task_id.clone()),
                            purpose: "验证 Task grandfathering".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
            )
            .unwrap();
        let agent_run_id = queued.result.payload["agentRunIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let admission: (Option<i64>, Option<String>) = database
            .connection()
            .query_row(
                "SELECT task_version_at_admission, assignee_agent_id_at_admission FROM agent_run WHERE id = ?1",
                [&agent_run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(admission, (Some(1), Some("agent_2".to_string())));

        let reassigned = service
            .update_task(
                &mut database,
                &user_envelope(
                    "reassign-linked-task",
                    Some(&camp_id),
                    UpdateTaskCommand {
                        task_id: task_id.clone(),
                        expected_version: 1,
                        title: Some("一次性准入（已改派）".to_string()),
                        assignee: TaskAssigneeUpdate::Assign {
                            agent_id: "agent_1".to_string(),
                        },
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        assert_eq!(reassigned.result.payload["version"], 2);
        let completed = service
            .update_task(
                &mut database,
                &user_envelope(
                    "complete-linked-task",
                    Some(&camp_id),
                    UpdateTaskCommand {
                        task_id: task_id.clone(),
                        expected_version: 2,
                        status: Some(TaskStatus::Completed),
                        completion_summary: Some("责任记录已经收口".to_string()),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        assert_eq!(completed.result.payload["status"], "completed");

        let candidates = ExecutionRuntimeService::default()
            .list_dispatchable_agent_runs(&database, 10)
            .unwrap();
        assert!(candidates.iter().any(|candidate| {
            candidate.agent_run_id == agent_run_id
                && candidate.agent_id == "agent_2"
                && candidate.task_id.as_deref() == Some(task_id.as_str())
        }));

        let frozen_after: (Option<i64>, Option<String>, String) = database
            .connection()
            .query_row(
                "SELECT task_version_at_admission, assignee_agent_id_at_admission, status FROM agent_run WHERE id = ?1",
                [&agent_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            frozen_after,
            (Some(1), Some("agent_2".to_string()), "queued".to_string())
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn remove_member_atomically_ends_membership_releases_tasks_and_reconciles_lead() {
        let (mut database, directory) = test_database();
        let collaboration = CollaborationService::default();
        let camp_id = create_camp_with_members(
            &collaboration,
            &mut database,
            &directory,
            &["agent_4", "agent_2"],
        );
        let created = collaboration
            .create_task(
                &mut database,
                &user_envelope(
                    "create-removal-task",
                    Some(&camp_id),
                    CreateTaskCommand {
                        camp_id: camp_id.clone(),
                        title: "成员删除时释放".to_string(),
                        description: String::new(),
                        assignee_agent_id: "agent_4".to_string(),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        let task_id = created.result.payload["taskId"]
            .as_str()
            .unwrap()
            .to_string();
        let profiles = AgentProfileService::default();
        let profile = profiles.get_profile(&database, "agent_4").unwrap().unwrap();
        let preview = profiles
            .removal_preview(&database, "agent_4")
            .unwrap()
            .unwrap();
        assert_eq!(preview.current_camp_membership_count, 1);
        assert_eq!(preview.open_assigned_task_count, 1);
        assert_eq!(preview.default_lead_camp_count, 1);
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_4'",
                [],
            )
            .unwrap();
        let retained_while_away: (String, Option<String>, i64) = database
            .connection()
            .query_row(
                "SELECT status, assignee_agent_id, version FROM task WHERE id = ?1",
                [&task_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            retained_while_away,
            ("pending".to_string(), Some("agent_4".to_string()), 1)
        );

        let removed = profiles
            .remove_member(
                &mut database,
                &user_envelope(
                    "remove-member-with-membership",
                    None,
                    RemoveMemberCommand {
                        agent_id: "agent_4".to_string(),
                        expected_version: profile.version,
                        confirmation_name: profile.display_name,
                    },
                ),
            )
            .unwrap();
        assert_eq!(removed.result.code, "agent_profile.removed");
        let membership_status: String = database
            .connection()
            .query_row(
                "SELECT status FROM camp_member WHERE camp_id = ?1 AND agent_id = 'agent_4'",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(membership_status, "left");
        let released: (String, Option<String>, Option<String>, i64) = database
            .connection()
            .query_row(
                "SELECT status, assignee_agent_id, blocked_reason, version FROM task WHERE id = ?1",
                [&task_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(released, ("pending".to_string(), None, None, 2));
        let lead: Option<String> = database
            .connection()
            .query_row(
                "SELECT default_lead_agent_id FROM camp WHERE id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(lead.as_deref(), Some("agent_2"));
        let cause: String = database
            .connection()
            .query_row(
                "SELECT json_extract(payload_json, '$.cause') FROM event_log WHERE entity_type = 'task' AND entity_id = ?1 AND event_type = 'task.assignee_membership_ended'",
                [&task_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cause, "assignee_membership_ended");

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
