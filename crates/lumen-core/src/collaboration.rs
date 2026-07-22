use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    path::Path,
};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    agent_profile::{FrozenAgentRuntimeConfig, resolve_frozen_runtime},
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    db::Database,
    runtime::AgentRunWorkspace,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryBindingInput {
    pub git_common_dir: String,
    pub object_format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCampCommand {
    pub project_path: String,
    pub repository: Option<RepositoryBindingInput>,
}

impl sealed::Sealed for CreateCampCommand {}
impl DomainCommand for CreateCampCommand {
    const TYPE: &'static str = "camp.create";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCampFromFirstMessageCommand {
    pub project_path: String,
    pub repository: Option<RepositoryBindingInput>,
    pub body: String,
    pub purpose: String,
    pub expected_output: String,
}

impl sealed::Sealed for CreateCampFromFirstMessageCommand {}
impl DomainCommand for CreateCampFromFirstMessageCommand {
    const TYPE: &'static str = "camp.create_from_first_message";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameCampCommand {
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
pub struct DeleteCampCommand {
    pub camp_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for DeleteCampCommand {}
impl DomainCommand for DeleteCampCommand {
    const TYPE: &'static str = "camp.delete";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddCampMemberCommand {
    pub camp_id: String,
    pub agent_profile_id: String,
    #[serde(default)]
    pub capability_overrides: Value,
}

impl sealed::Sealed for AddCampMemberCommand {}
impl DomainCommand for AddCampMemberCommand {
    const TYPE: &'static str = "camp.member.add";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum MessageAddressSpec {
    Default,
    Explicit {
        #[serde(rename = "agentProfileIds")]
        agent_profile_ids: Vec<String>,
    },
    Broadcast,
}

impl MessageAddressSpec {
    fn mode(&self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Explicit { .. } => "explicit",
            Self::Broadcast => "broadcast",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRequest {
    pub task_id: Option<String>,
    pub purpose: String,
    pub expected_output: String,
    #[serde(default = "required_completion_role")]
    pub completion_role: String,
}

fn required_completion_role() -> String {
    "required".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendCampMessageCommand {
    pub camp_id: String,
    pub body: String,
    pub address: MessageAddressSpec,
    pub reply_to_camp_message_id: Option<String>,
    pub execution: Option<ExecutionRequest>,
}

impl sealed::Sealed for SendCampMessageCommand {}
impl DomainCommand for SendCampMessageCommand {
    const TYPE: &'static str = "camp.message.send";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceCriterionInput {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskCommand {
    pub camp_id: String,
    pub title: String,
    pub objective: String,
    pub acceptance_criteria: Vec<AcceptanceCriterionInput>,
    pub assignee_agent_id: String,
    pub source_message_id: Option<String>,
    pub origin_task_id: Option<String>,
    pub dedup_key: Option<String>,
}

impl sealed::Sealed for CreateTaskCommand {}
impl DomainCommand for CreateTaskCommand {
    const TYPE: &'static str = "task.create";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskAndQueueExecutionCommand {
    pub camp_id: String,
    pub title: String,
    pub objective: String,
    pub acceptance_criteria: Vec<AcceptanceCriterionInput>,
    pub assignee_agent_id: String,
    pub dedup_key: Option<String>,
    pub purpose: String,
    pub expected_output: String,
    pub workspace: AgentRunWorkspace,
}

impl sealed::Sealed for CreateTaskAndQueueExecutionCommand {}
impl DomainCommand for CreateTaskAndQueueExecutionCommand {
    const TYPE: &'static str = "task.create_and_queue_execution";
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionTargetInspection {
    pub agent_profile_id: String,
    pub conversation_id: String,
    pub conversation_busy: bool,
    pub earlier_run_queued: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPreflightContext {
    pub camp_id: String,
    pub project_path: String,
    pub repository_git_common_dir: Option<String>,
    pub repository_scope_id: Option<String>,
    pub targets: Vec<ExecutionTargetInspection>,
    pub addressing_blocker: Option<ExecutionPreflightBlocker>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionPreflightBlocker {
    pub code: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTaskDependencyCommand {
    pub task_id: String,
    pub depends_on_task_id: String,
    pub expected_task_version: i64,
}

impl sealed::Sealed for AddTaskDependencyCommand {}
impl DomainCommand for AddTaskDependencyCommand {
    const TYPE: &'static str = "task.dependency.add";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendInboxMessageCommand {
    pub camp_id: String,
    pub recipient_agent_id: String,
    pub body: String,
    #[serde(default)]
    pub references: Vec<EntityReference>,
    pub source_conversation_id: String,
    pub source_camp_turn_id: Option<String>,
    pub target_agent_run_id: Option<String>,
    pub in_reply_to_message_id: Option<String>,
    pub correlation_id: String,
    pub batch_id: Option<String>,
    pub retry_of_message_id: Option<String>,
    pub idempotency_key: String,
    pub expires_at: Option<String>,
}

impl sealed::Sealed for SendInboxMessageCommand {}
impl DomainCommand for SendInboxMessageCommand {
    const TYPE: &'static str = "inbox.message.send";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliverInboxMessageCommand {
    pub inbox_message_id: String,
}

impl sealed::Sealed for DeliverInboxMessageCommand {}
impl DomainCommand for DeliverInboxMessageCommand {
    const TYPE: &'static str = "inbox.message.deliver";
}

#[derive(Debug, Default)]
pub struct CollaborationService {
    gateway: DomainCommandGateway,
}

impl CollaborationService {
    pub fn inspect_execution_targets(
        &self,
        database: &Database,
        camp_id: &str,
        address: &MessageAddressSpec,
    ) -> Result<ExecutionPreflightContext> {
        let connection = database.connection();
        let camp = connection
            .query_row(
                r#"
                SELECT project_path, repository_git_common_dir,
                       repository_scope_id, status
                FROM camp WHERE id = ?1
                "#,
                [camp_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?;
        let Some((project_path, repository_git_common_dir, repository_scope_id, status)) = camp
        else {
            anyhow::bail!("camp.not_found: Camp does not exist");
        };
        let actor = ActorRef::User {
            user_id: "preflight".into(),
        };
        let (targets_to_inspect, addressing_blocker) = if status != "active" {
            (
                Vec::new(),
                Some(ExecutionPreflightBlocker {
                    code: "agent_unavailable".to_string(),
                    detail: "Archived Camp cannot start execution".to_string(),
                }),
            )
        } else {
            match resolve_address(connection, camp_id, address, &actor)? {
                AddressingOutcome::Resolved(resolution) if !resolution.targets.is_empty() => {
                    (resolution.targets, None)
                }
                AddressingOutcome::Resolved(_) => (
                    Vec::new(),
                    Some(ExecutionPreflightBlocker {
                        code: "agent_unavailable".to_string(),
                        detail: "No active Agent can receive this execution".to_string(),
                    }),
                ),
                AddressingOutcome::Rejected(result) => (
                    Vec::new(),
                    Some(ExecutionPreflightBlocker {
                        code: "agent_unavailable".to_string(),
                        detail: format!(
                            "{}: {}",
                            result.code,
                            result.payload["message"]
                                .as_str()
                                .unwrap_or("execution target is unavailable")
                        ),
                    }),
                ),
            }
        };
        let mut targets = Vec::with_capacity(targets_to_inspect.len());
        for target in targets_to_inspect {
            let (active_count, queued_count): (i64, i64) = connection.query_row(
                r#"
                SELECT
                    COALESCE(SUM(CASE WHEN status IN ('running', 'waiting') THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0)
                FROM agent_run WHERE conversation_id = ?1
                "#,
                [&target.conversation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            targets.push(ExecutionTargetInspection {
                agent_profile_id: target.agent_profile_id,
                conversation_id: target.conversation_id,
                conversation_busy: active_count > 0,
                earlier_run_queued: queued_count > 0,
            });
        }
        Ok(ExecutionPreflightContext {
            camp_id: camp_id.to_string(),
            project_path,
            repository_git_common_dir,
            repository_scope_id,
            targets,
            addressing_blocker,
        })
    }

    pub fn create_camp(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateCampCommand>,
    ) -> Result<CommandExecution> {
        validate_project_path(&envelope.payload.project_path)?;
        if let Some(repository) = &envelope.payload.repository {
            validate_repository_binding(repository)?;
        }
        let camp_id = Uuid::new_v4().to_string();
        self.gateway.execute(database, envelope, |transaction| {
            if matches!(envelope.actor, ActorRef::Agent { .. }) {
                return Ok(rejected(
                    "camp.user_or_system_required",
                    "Agent Actors cannot create Camps",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let repository = envelope.payload.repository.as_ref();
            let repository_scope_id = resolve_repository_scope_id(transaction, repository)?;
            let internal_ref_namespace = repository.map(|_| format!("refs/lumen/camps/{camp_id}"));
            transaction.execute(
                r#"
                INSERT INTO camp(
                    id, title, project_path,
                    repository_scope_id, repository_git_common_dir,
                    repository_object_format, repository_internal_ref_namespace,
                    repository_bound_at, repository_relocated_at,
                    default_lead_agent_id, status, last_message_sequence,
                    version, created_at, updated_at, archived_at
                ) VALUES (
                    ?1, '新对话', ?2, ?3, ?4, ?5, ?6, ?7, NULL,
                    NULL, 'active', 0, 1, ?8, ?8, NULL
                )
                "#,
                params![
                    camp_id,
                    envelope.payload.project_path,
                    repository_scope_id,
                    repository.map(|value| value.git_common_dir.as_str()),
                    repository.map(|value| value.object_format.as_str()),
                    internal_ref_namespace,
                    repository.map(|_| now.as_str()),
                    now,
                ],
            )?;
            append_domain_event(
                transaction,
                "camp.created",
                Some(&camp_id),
                Some(("camp", camp_id.as_str())),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({ "projectPath": envelope.payload.project_path }),
            )?;
            Ok(CommandHandlerResult::applied(
                "camp.created",
                json!({ "campId": camp_id }),
                Some(EntityReference {
                    entity_type: "camp".to_string(),
                    entity_id: camp_id.clone(),
                }),
            ))
        })
    }

    pub fn create_camp_from_first_message(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateCampFromFirstMessageCommand>,
    ) -> Result<CommandExecution> {
        validate_project_path(&envelope.payload.project_path)?;
        if let Some(repository) = &envelope.payload.repository {
            validate_repository_binding(repository)?;
        }
        if envelope.payload.body.trim().is_empty()
            || envelope.payload.purpose.trim().is_empty()
            || envelope.payload.expected_output.trim().is_empty()
        {
            anyhow::bail!("First message, purpose, and expectedOutput must not be empty");
        }
        let title = normalized_camp_title(&envelope.payload.body);
        let camp_id = Uuid::new_v4().to_string();
        let camp_message_id = Uuid::new_v4().to_string();
        let camp_turn_id = Uuid::new_v4().to_string();

        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, ActorRef::User { .. }) {
                return Ok(rejected(
                    "camp.user_required",
                    "Only a User can create a Camp from the new-conversation intake",
                ));
            }

            let profile_ids = {
                let mut statement = transaction.prepare(
                    r#"
                    SELECT id
                    FROM agent_profile
                    WHERE profile_status = 'active'
                    ORDER BY member_order, id
                    "#,
                )?;
                statement
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?
            };
            if profile_ids.is_empty() {
                return Ok(rejected(
                    "camp.no_active_members",
                    "At least one active AgentProfile is required",
                ));
            }

            let now = chrono::Utc::now().to_rfc3339();
            let repository = envelope.payload.repository.as_ref();
            let repository_scope_id = resolve_repository_scope_id(transaction, repository)?;
            let internal_ref_namespace = repository.map(|_| format!("refs/lumen/camps/{camp_id}"));
            transaction.execute(
                r#"
                INSERT INTO camp(
                    id, title, project_path,
                    repository_scope_id, repository_git_common_dir,
                    repository_object_format, repository_internal_ref_namespace,
                    repository_bound_at, repository_relocated_at,
                    default_lead_agent_id, status, last_message_sequence,
                    version, created_at, updated_at, archived_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL,
                    NULL, 'active', 0, 1, ?9, ?9, NULL
                )
                "#,
                params![
                    camp_id,
                    title,
                    envelope.payload.project_path,
                    repository_scope_id,
                    repository.map(|value| value.git_common_dir.as_str()),
                    repository.map(|value| value.object_format.as_str()),
                    internal_ref_namespace,
                    repository.map(|_| now.as_str()),
                    now,
                ],
            )?;

            let mut targets = Vec::with_capacity(profile_ids.len());
            for profile_id in &profile_ids {
                let conversation_id = Uuid::new_v4().to_string();
                transaction.execute(
                    r#"
                    INSERT INTO camp_member(
                        camp_id, agent_profile_id, status, capability_overrides_json,
                        leave_requested_at, leave_request_command_id,
                        pending_default_lead_successor_agent_id,
                        version, joined_at, left_at
                    ) VALUES (?1, ?2, 'active', '{}', NULL, NULL, NULL, 1, ?3, NULL)
                    "#,
                    params![camp_id, profile_id, now],
                )?;
                transaction.execute(
                    r#"
                    INSERT INTO conversation(
                        id, camp_id, agent_profile_id,
                        provider_override, model_override, action_permission_profile_ref,
                        native_session_id, summary,
                        summary_through_message_sequence,
                        last_seen_camp_message_sequence, last_message_sequence,
                        version, created_at, updated_at
                    ) VALUES (?1, ?2, ?3, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 1, ?4, ?4)
                    "#,
                    params![conversation_id, camp_id, profile_id, now],
                )?;
                targets.push(AddressTarget {
                    agent_profile_id: profile_id.clone(),
                    conversation_id,
                });
            }

            let mut selected = None;
            for target in targets {
                let runtime = match resolve_frozen_runtime(
                    transaction,
                    &target.conversation_id,
                    &target.agent_profile_id,
                )? {
                    Ok(runtime) => runtime,
                    Err(_) => continue,
                };
                let effective_config = build_effective_config(
                    transaction,
                    &target.conversation_id,
                    &target.agent_profile_id,
                    &runtime,
                )?;
                selected = Some((target, runtime, effective_config));
                break;
            }

            let Some((target, runtime, effective_config)) = selected else {
                transaction.execute("DELETE FROM conversation WHERE camp_id = ?1", [&camp_id])?;
                transaction.execute("DELETE FROM camp_member WHERE camp_id = ?1", [&camp_id])?;
                transaction.execute("DELETE FROM camp WHERE id = ?1", [&camp_id])?;
                return Ok(rejected(
                    "camp.no_runtime_ready_members",
                    "At least one active member must have a ready Runtime",
                ));
            };

            transaction.execute(
                r#"
                UPDATE camp
                SET default_lead_agent_id = ?2, version = version + 1, updated_at = ?3
                WHERE id = ?1
                "#,
                params![camp_id, target.agent_profile_id, now],
            )?;
            append_domain_event(
                transaction,
                "camp.created",
                Some(&camp_id),
                Some(("camp", camp_id.as_str())),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({
                    "title": title,
                    "projectPath": envelope.payload.project_path,
                    "repositoryScopeId": repository_scope_id,
                    "defaultLeadAgentId": target.agent_profile_id,
                    "memberCount": profile_ids.len(),
                }),
            )?;

            let resolution = AddressResolution {
                source: "default_lead",
                targets: vec![target.clone()],
            };
            let mut effective_configs = BTreeMap::new();
            effective_configs.insert(
                target.agent_profile_id.clone(),
                PreparedAgentRunConfig {
                    runtime,
                    effective_config,
                },
            );
            let execution = ExecutionRequest {
                task_id: None,
                purpose: envelope.payload.purpose.clone(),
                expected_output: envelope.payload.expected_output.clone(),
                completion_role: required_completion_role(),
            };
            let queued = queue_camp_message_and_runs(
                transaction,
                QueueCampMessageInput {
                    camp_message_id: &camp_message_id,
                    camp_turn_id: Some(&camp_turn_id),
                    camp_id: &camp_id,
                    body: &envelope.payload.body,
                    address_mode: "default",
                    reply_to_camp_message_id: None,
                    resolution: &resolution,
                    execution: Some(&execution),
                    effective_configs: Some(&effective_configs),
                    workspace: None,
                    actor: &envelope.actor,
                    execution_epoch: envelope.execution_epoch,
                    command_id: &envelope.command_id,
                    now: &now,
                },
            )?;

            Ok(CommandHandlerResult::accepted(
                "camp.created_and_queued",
                json!({
                    "campId": camp_id,
                    "campMessageId": camp_message_id,
                    "campTurnId": camp_turn_id,
                    "agentRunIds": queued.agent_run_ids,
                    "defaultLeadAgentId": target.agent_profile_id,
                    "repositoryScopeId": repository_scope_id,
                }),
                Some(EntityReference {
                    entity_type: "camp".to_string(),
                    entity_id: camp_id.clone(),
                }),
            ))
        })
    }

    pub fn rename_camp(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RenameCampCommand>,
    ) -> Result<CommandExecution> {
        let title = normalized_camp_title(&envelope.payload.title);
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
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE camp
                SET title = ?2, version = version + 1, updated_at = ?3
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
            if !blockers.is_empty() {
                return Ok(CommandHandlerResult::rejected(
                    "camp.delete_blocked",
                    json!({ "campId": envelope.payload.camp_id, "blockers": blockers }),
                ));
            }

            delete_camp_aggregate(transaction, &envelope.payload.camp_id)?;
            Ok(CommandHandlerResult::applied(
                "camp.deleted",
                json!({ "campId": envelope.payload.camp_id }),
                None,
            ))
        })
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
                    "SELECT status, default_lead_agent_id FROM camp WHERE id = ?1",
                    [&envelope.payload.camp_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .optional()?;
            let Some((camp_status, default_lead)) = camp_state else {
                return Ok(rejected("camp.not_found", "Camp does not exist"));
            };
            if camp_status != "active" {
                return Ok(rejected(
                    "camp.archived",
                    "Archived Camp cannot accept members",
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
                    [&envelope.payload.agent_profile_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if profile_status.as_deref() != Some("active") {
                return Ok(rejected("agent.unavailable", "AgentProfile is not active"));
            }
            let active_member_count: i64 = transaction.query_row(
                r#"
                SELECT COUNT(*)
                FROM camp_member
                JOIN agent_profile ON agent_profile.id = camp_member.agent_profile_id
                WHERE camp_member.camp_id = ?1
                  AND camp_member.status = 'active'
                  AND camp_member.leave_requested_at IS NULL
                  AND agent_profile.profile_status = 'active'
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
                    camp_id, agent_profile_id, status, capability_overrides_json,
                    leave_requested_at, leave_request_command_id,
                    pending_default_lead_successor_agent_id,
                    version, joined_at, left_at
                ) VALUES (?1, ?2, 'active', ?3, NULL, NULL, NULL, 1, ?4, NULL)
                ON CONFLICT(camp_id, agent_profile_id) DO UPDATE SET
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
                    envelope.payload.agent_profile_id,
                    serde_json::to_string(&envelope.payload.capability_overrides)?,
                    now,
                ],
            )?;

            let proposed_conversation_id = Uuid::new_v4().to_string();
            transaction.execute(
                r#"
                INSERT OR IGNORE INTO conversation(
                    id, camp_id, agent_profile_id,
                    provider_override, model_override, action_permission_profile_ref,
                    native_session_id, summary,
                    summary_through_message_sequence,
                    last_seen_camp_message_sequence, last_message_sequence,
                    version, created_at, updated_at
                ) VALUES (?1, ?2, ?3, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 1, ?4, ?4)
                "#,
                params![
                    proposed_conversation_id,
                    envelope.payload.camp_id,
                    envelope.payload.agent_profile_id,
                    now,
                ],
            )?;
            let conversation_id: String = transaction.query_row(
                r#"
                SELECT id FROM conversation
                WHERE camp_id = ?1 AND agent_profile_id = ?2
                "#,
                params![envelope.payload.camp_id, envelope.payload.agent_profile_id],
                |row| row.get(0),
            )?;
            if default_lead.is_none() {
                transaction.execute(
                    r#"
                    UPDATE camp
                    SET default_lead_agent_id = ?2, version = version + 1, updated_at = ?3
                    WHERE id = ?1 AND default_lead_agent_id IS NULL
                    "#,
                    params![
                        envelope.payload.camp_id,
                        envelope.payload.agent_profile_id,
                        now,
                    ],
                )?;
            }
            append_domain_event(
                transaction,
                "camp.member_added",
                Some(&envelope.payload.camp_id),
                Some(("agent_profile", &envelope.payload.agent_profile_id)),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({ "conversationId": conversation_id }),
            )?;
            Ok(CommandHandlerResult::applied(
                "camp.member_added",
                json!({
                    "campId": envelope.payload.camp_id,
                    "agentProfileId": envelope.payload.agent_profile_id,
                    "conversationId": conversation_id,
                }),
                Some(EntityReference {
                    entity_type: "conversation".to_string(),
                    entity_id: conversation_id,
                }),
            ))
        })
    }

    pub fn create_task(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateTaskCommand>,
    ) -> Result<CommandExecution> {
        validate_task_input(&envelope.payload)?;
        let task_id = Uuid::new_v4().to_string();
        self.gateway.execute(database, envelope, |transaction| {
            let camp = transaction
                .query_row(
                    r#"
                    SELECT project_path, repository_git_common_dir, status
                    FROM camp WHERE id = ?1
                    "#,
                    [&envelope.payload.camp_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()?;
            let Some((project_path, git_common_dir, camp_status)) = camp else {
                return Ok(rejected("camp.not_found", "Camp does not exist"));
            };
            if camp_status != "active" {
                return Ok(rejected(
                    "camp.archived",
                    "Archived Camp cannot accept Tasks",
                ));
            }
            if !actor_has_capability(
                transaction,
                &envelope.actor,
                envelope.execution_epoch,
                &envelope.payload.camp_id,
                "task.create",
            )? {
                return Ok(rejected(
                    "command.capability_denied",
                    "Actor lacks task.create",
                ));
            }
            if let Some(dedup_key) = &envelope.payload.dedup_key
                && let Some(existing_task_id) = transaction
                    .query_row(
                        "SELECT id FROM task WHERE camp_id = ?1 AND dedup_key = ?2",
                        params![envelope.payload.camp_id, dedup_key],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
            {
                return Ok(CommandHandlerResult::applied(
                    "task.deduplicated",
                    json!({ "taskId": existing_task_id }),
                    Some(EntityReference {
                        entity_type: "task".to_string(),
                        entity_id: existing_task_id,
                    }),
                ));
            }
            if !is_active_member(
                transaction,
                &envelope.payload.camp_id,
                &envelope.payload.assignee_agent_id,
            )? {
                return Ok(rejected(
                    "task.assignee_unavailable",
                    "Task assignee is not an active Camp member",
                ));
            }
            if let Some(source_message_id) = &envelope.payload.source_message_id
                && !entity_belongs_to_camp(
                    transaction,
                    "camp_message",
                    source_message_id,
                    &envelope.payload.camp_id,
                )?
            {
                return Ok(rejected(
                    "task.invalid_source_message",
                    "Source message is outside the Camp",
                ));
            }
            if let Some(origin_task_id) = &envelope.payload.origin_task_id
                && !entity_belongs_to_camp(
                    transaction,
                    "task",
                    origin_task_id,
                    &envelope.payload.camp_id,
                )?
            {
                return Ok(rejected(
                    "task.invalid_origin",
                    "Origin Task is outside the Camp",
                ));
            }

            let now = chrono::Utc::now().to_rfc3339();
            let legacy_project_id = ensure_legacy_project_projection(
                transaction,
                &envelope.payload.camp_id,
                &project_path,
                git_common_dir.as_deref(),
                &now,
            )?;
            let (created_by_type, created_by_id, created_by_source_run) =
                actor_parts(&envelope.actor);
            transaction.execute(
                r#"
                INSERT INTO task(
                    id, project_id, owner_agent_id, title, goal, status,
                    execution_root, start_branch, base_revision,
                    created_at, updated_at, completed_at,
                    camp_id, objective, acceptance_criteria_json,
                    assignee_agent_id, source_message_id, origin_task_id,
                    created_by_type, created_by_id, created_by_source_agent_run_id,
                    dedup_key, cancel_requested_at, cancel_request_command_id,
                    version, closed_at, archived_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, 'pending',
                    ?6, '', '', ?7, ?7, NULL,
                    ?8, ?5, ?9, ?3, ?10, ?11,
                    ?12, ?13, ?14, ?15, NULL, NULL, 1, NULL, NULL
                )
                "#,
                params![
                    task_id,
                    legacy_project_id,
                    envelope.payload.assignee_agent_id,
                    envelope.payload.title,
                    envelope.payload.objective,
                    project_path,
                    now,
                    envelope.payload.camp_id,
                    serde_json::to_string(&envelope.payload.acceptance_criteria)?,
                    envelope.payload.source_message_id,
                    envelope.payload.origin_task_id,
                    created_by_type,
                    created_by_id,
                    created_by_source_run,
                    envelope.payload.dedup_key,
                ],
            )?;
            append_domain_event(
                transaction,
                "task.created",
                Some(&envelope.payload.camp_id),
                Some(("task", &task_id)),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({ "assigneeAgentId": envelope.payload.assignee_agent_id }),
            )?;
            Ok(CommandHandlerResult::applied(
                "task.created",
                json!({ "taskId": task_id }),
                Some(EntityReference {
                    entity_type: "task".to_string(),
                    entity_id: task_id.clone(),
                }),
            ))
        })
    }

    pub fn create_task_and_queue_execution(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CreateTaskAndQueueExecutionCommand>,
    ) -> Result<CommandExecution> {
        validate_task_input(&CreateTaskCommand {
            camp_id: envelope.payload.camp_id.clone(),
            title: envelope.payload.title.clone(),
            objective: envelope.payload.objective.clone(),
            acceptance_criteria: envelope.payload.acceptance_criteria.clone(),
            assignee_agent_id: envelope.payload.assignee_agent_id.clone(),
            source_message_id: None,
            origin_task_id: None,
            dedup_key: envelope.payload.dedup_key.clone(),
        })?;
        if envelope.payload.purpose.trim().is_empty()
            || envelope.payload.expected_output.trim().is_empty()
        {
            anyhow::bail!("AgentRun purpose and expectedOutput must not be empty");
        }
        envelope.payload.workspace.validate()?;

        let task_id = Uuid::new_v4().to_string();
        let camp_message_id = Uuid::new_v4().to_string();
        let camp_turn_id = Uuid::new_v4().to_string();
        self.gateway.execute(database, envelope, |transaction| {
            let camp = transaction
                .query_row(
                    r#"
                    SELECT project_path, repository_git_common_dir,
                           repository_scope_id, status
                    FROM camp WHERE id = ?1
                    "#,
                    [&envelope.payload.camp_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )
                .optional()?;
            let Some((project_path, git_common_dir, repository_scope_id, camp_status)) = camp
            else {
                return Ok(rejected("camp.not_found", "Camp does not exist"));
            };
            if camp_status != "active" {
                return Ok(rejected(
                    "camp.archived",
                    "Archived Camp cannot accept Tasks",
                ));
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
            for capability in ["task.create", "agent_run.create"] {
                if !actor_has_capability(
                    transaction,
                    &envelope.actor,
                    envelope.execution_epoch,
                    &envelope.payload.camp_id,
                    capability,
                )? {
                    return Ok(rejected(
                        "command.capability_denied",
                        &format!("Actor lacks {capability}"),
                    ));
                }
            }
            if let Some(dedup_key) = &envelope.payload.dedup_key
                && let Some(existing) = transaction
                    .query_row(
                        r#"
                        SELECT task.id, agent_run.camp_turn_id, agent_run.id,
                               camp_turn.trigger_id
                        FROM task
                        LEFT JOIN agent_run
                          ON agent_run.task_id = task.id
                         AND agent_run.start_reason = 'initial'
                        LEFT JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                        WHERE task.camp_id = ?1 AND task.dedup_key = ?2
                        ORDER BY agent_run.created_at
                        LIMIT 1
                        "#,
                        params![envelope.payload.camp_id, dedup_key],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, Option<String>>(1)?,
                                row.get::<_, Option<String>>(2)?,
                                row.get::<_, Option<String>>(3)?,
                            ))
                        },
                    )
                    .optional()?
            {
                let (Some(camp_turn_id), Some(agent_run_id), Some(camp_message_id)) =
                    (existing.1, existing.2, existing.3)
                else {
                    return Ok(rejected(
                        "task.dedup_conflict",
                        "The deduplication key belongs to a Task without an initial execution",
                    ));
                };
                return Ok(CommandHandlerResult::accepted(
                    "task.execution_deduplicated",
                    json!({
                        "taskId": existing.0,
                        "campMessageId": camp_message_id,
                        "campTurnId": camp_turn_id,
                        "agentRunId": agent_run_id,
                    }),
                    Some(EntityReference {
                        entity_type: "task".to_string(),
                        entity_id: existing.0,
                    }),
                ));
            }
            let resolution = match resolve_address(
                transaction,
                &envelope.payload.camp_id,
                &MessageAddressSpec::Explicit {
                    agent_profile_ids: vec![envelope.payload.assignee_agent_id.clone()],
                },
                &envelope.actor,
            )? {
                AddressingOutcome::Resolved(resolution) if resolution.targets.len() == 1 => {
                    resolution
                }
                AddressingOutcome::Resolved(_) => {
                    return Ok(rejected(
                        "task.assignee_unavailable",
                        "Task assignee is not an active Camp member",
                    ));
                }
                AddressingOutcome::Rejected(_) => {
                    return Ok(rejected(
                        "task.assignee_unavailable",
                        "Task assignee is not an active Camp member",
                    ));
                }
            };
            if envelope.payload.workspace.repository_scope_id != repository_scope_id {
                return Ok(rejected(
                    "agent_run.workspace_scope_mismatch",
                    "AgentRun workspace does not match the Camp repository scope",
                ));
            }
            if envelope.payload.workspace.isolation == "shared"
                && envelope.payload.workspace.execution_root != project_path
            {
                return Ok(rejected(
                    "agent_run.workspace_root_mismatch",
                    "Shared AgentRun workspace must use the Camp project path",
                ));
            }
            let effective_configs = match prepare_agent_run_configs(transaction, &resolution)? {
                Ok(configs) => configs,
                Err(rejection) => return Ok(rejection),
            };

            let now = chrono::Utc::now().to_rfc3339();
            let legacy_project_id = ensure_legacy_project_projection(
                transaction,
                &envelope.payload.camp_id,
                &project_path,
                git_common_dir.as_deref(),
                &now,
            )?;
            let (created_by_type, created_by_id, created_by_source_run) =
                actor_parts(&envelope.actor);
            transaction.execute(
                r#"
                INSERT INTO task(
                    id, project_id, owner_agent_id, title, goal, status,
                    execution_root, start_branch, base_revision,
                    created_at, updated_at, completed_at,
                    camp_id, objective, acceptance_criteria_json,
                    assignee_agent_id, source_message_id, origin_task_id,
                    created_by_type, created_by_id, created_by_source_agent_run_id,
                    dedup_key, cancel_requested_at, cancel_request_command_id,
                    version, closed_at, archived_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, 'pending',
                    ?6, '', ?7, ?8, ?8, NULL,
                    ?9, ?5, ?10, ?3, ?11, NULL,
                    ?12, ?13, ?14, ?15, NULL, NULL, 1, NULL, NULL
                )
                "#,
                params![
                    task_id,
                    legacy_project_id,
                    envelope.payload.assignee_agent_id,
                    envelope.payload.title,
                    envelope.payload.objective,
                    envelope.payload.workspace.execution_root,
                    envelope
                        .payload
                        .workspace
                        .base_git_commit
                        .as_deref()
                        .unwrap_or(""),
                    now,
                    envelope.payload.camp_id,
                    serde_json::to_string(&envelope.payload.acceptance_criteria)?,
                    camp_message_id,
                    created_by_type,
                    created_by_id,
                    created_by_source_run,
                    envelope.payload.dedup_key,
                ],
            )?;
            append_domain_event(
                transaction,
                "task.created",
                Some(&envelope.payload.camp_id),
                Some(("task", &task_id)),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({ "assigneeAgentId": envelope.payload.assignee_agent_id }),
            )?;
            let execution_request = ExecutionRequest {
                task_id: Some(task_id.clone()),
                purpose: envelope.payload.purpose.clone(),
                expected_output: envelope.payload.expected_output.clone(),
                completion_role: "required".to_string(),
            };
            let queued = queue_camp_message_and_runs(
                transaction,
                QueueCampMessageInput {
                    camp_message_id: &camp_message_id,
                    camp_turn_id: Some(&camp_turn_id),
                    camp_id: &envelope.payload.camp_id,
                    body: &envelope.payload.objective,
                    address_mode: "explicit",
                    reply_to_camp_message_id: None,
                    resolution: &resolution,
                    execution: Some(&execution_request),
                    effective_configs: Some(&effective_configs),
                    workspace: Some(&envelope.payload.workspace),
                    actor: &envelope.actor,
                    execution_epoch: envelope.execution_epoch,
                    command_id: &envelope.command_id,
                    now: &now,
                },
            )?;
            let agent_run_id = queued
                .agent_run_ids
                .first()
                .context("Task execution did not create its required AgentRun")?;

            Ok(CommandHandlerResult::accepted(
                "task.execution_queued",
                json!({
                    "taskId": task_id,
                    "campMessageId": camp_message_id,
                    "campTurnId": camp_turn_id,
                    "agentRunId": agent_run_id,
                }),
                Some(EntityReference {
                    entity_type: "task".to_string(),
                    entity_id: task_id.clone(),
                }),
            ))
        })
    }

    pub fn add_task_dependency(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<AddTaskDependencyCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if envelope.payload.task_id == envelope.payload.depends_on_task_id {
                return Ok(rejected(
                    "task_dependency.self_reference",
                    "Task cannot depend on itself",
                ));
            }
            let downstream = task_camp_and_status(transaction, &envelope.payload.task_id)?;
            let dependency =
                task_camp_and_status(transaction, &envelope.payload.depends_on_task_id)?;
            let (Some((camp_id, status, current_version)), Some((dependency_camp_id, _, _))) =
                (downstream, dependency)
            else {
                return Ok(rejected(
                    "task_dependency.task_not_found",
                    "Both Tasks must exist",
                ));
            };
            if camp_id != dependency_camp_id {
                return Ok(rejected(
                    "task_dependency.cross_camp",
                    "Task dependency cannot cross Camps",
                ));
            }
            if status != "pending" {
                return Ok(rejected(
                    "task_dependency.task_not_pending",
                    "Only pending Tasks can change dependencies",
                ));
            }
            if current_version != envelope.payload.expected_task_version {
                return Ok(rejected(
                    "command.version_conflict",
                    "Task version does not match expectedTaskVersion",
                ));
            }
            if !actor_has_capability(
                transaction,
                &envelope.actor,
                envelope.execution_epoch,
                &camp_id,
                "task.dependency.manage",
            )? {
                return Ok(rejected(
                    "command.capability_denied",
                    "Actor lacks task.dependency.manage",
                ));
            }
            if dependency_would_cycle(
                transaction,
                &envelope.payload.task_id,
                &envelope.payload.depends_on_task_id,
            )? {
                return Ok(rejected(
                    "task_dependency.cycle",
                    "Task dependency would create a cycle",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let inserted = transaction.execute(
                r#"
                INSERT OR IGNORE INTO task_dependency(task_id, depends_on_task_id, created_at)
                VALUES (?1, ?2, ?3)
                "#,
                params![
                    envelope.payload.task_id,
                    envelope.payload.depends_on_task_id,
                    now,
                ],
            )?;
            if inserted == 0 {
                return Ok(CommandHandlerResult::applied(
                    "task.dependency_exists",
                    json!({
                        "taskId": envelope.payload.task_id,
                        "dependsOnTaskId": envelope.payload.depends_on_task_id,
                    }),
                    Some(EntityReference {
                        entity_type: "task".to_string(),
                        entity_id: envelope.payload.task_id.clone(),
                    }),
                ));
            }
            let updated = transaction.execute(
                r#"
                UPDATE task
                SET version = version + 1, updated_at = ?2
                WHERE id = ?1 AND version = ?3
                "#,
                params![
                    envelope.payload.task_id,
                    now,
                    envelope.payload.expected_task_version,
                ],
            )?;
            if updated != 1 {
                anyhow::bail!("Task version changed inside the command transaction");
            }
            append_domain_event(
                transaction,
                "task.dependency_added",
                Some(&camp_id),
                Some(("task", &envelope.payload.task_id)),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({ "dependsOnTaskId": envelope.payload.depends_on_task_id }),
            )?;
            Ok(CommandHandlerResult::applied(
                "task.dependency_added",
                json!({
                    "taskId": envelope.payload.task_id,
                    "dependsOnTaskId": envelope.payload.depends_on_task_id,
                }),
                Some(EntityReference {
                    entity_type: "task".to_string(),
                    entity_id: envelope.payload.task_id.clone(),
                }),
            ))
        })
    }

    pub fn send_camp_message(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SendCampMessageCommand>,
    ) -> Result<CommandExecution> {
        validate_camp_message_input(&envelope.payload)?;
        let camp_message_id = Uuid::new_v4().to_string();
        let camp_turn_id = envelope
            .payload
            .execution
            .as_ref()
            .map(|_| Uuid::new_v4().to_string());
        self.gateway.execute(database, envelope, |transaction| {
            let camp_status = transaction
                .query_row(
                    "SELECT status FROM camp WHERE id = ?1",
                    [&envelope.payload.camp_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            match camp_status.as_deref() {
                None => return Ok(rejected("camp.not_found", "Camp does not exist")),
                Some("archived") => {
                    return Ok(rejected(
                        "camp.archived",
                        "Archived Camp cannot accept messages",
                    ));
                }
                Some("active") => {}
                Some(_) => return Ok(rejected("camp.invalid_status", "Camp status is invalid")),
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
            if let Some(reply_id) = &envelope.payload.reply_to_camp_message_id
                && !entity_belongs_to_camp(
                    transaction,
                    "camp_message",
                    reply_id,
                    &envelope.payload.camp_id,
                )?
            {
                return Ok(rejected(
                    "camp_message.invalid_reply",
                    "Reply target is outside the Camp",
                ));
            }
            let resolution = match resolve_address(
                transaction,
                &envelope.payload.camp_id,
                &envelope.payload.address,
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
            if let Some(execution) = &envelope.payload.execution
                && let Some(task_id) = &execution.task_id
                && !task_is_ready_for_new_run(transaction, task_id, &envelope.payload.camp_id)?
            {
                return Ok(rejected(
                    "agent_run.task_not_executable",
                    "Task is not ready for a new AgentRun",
                ));
            }
            let effective_configs = if envelope.payload.execution.is_some() {
                match prepare_agent_run_configs(transaction, &resolution)? {
                    Ok(configs) => Some(configs),
                    Err(rejection) => return Ok(rejection),
                }
            } else {
                None
            };

            let now = chrono::Utc::now().to_rfc3339();
            let queued = queue_camp_message_and_runs(
                transaction,
                QueueCampMessageInput {
                    camp_message_id: &camp_message_id,
                    camp_turn_id: camp_turn_id.as_deref(),
                    camp_id: &envelope.payload.camp_id,
                    body: &envelope.payload.body,
                    address_mode: envelope.payload.address.mode(),
                    reply_to_camp_message_id: envelope.payload.reply_to_camp_message_id.as_deref(),
                    resolution: &resolution,
                    execution: envelope.payload.execution.as_ref(),
                    effective_configs: effective_configs.as_ref(),
                    workspace: None,
                    actor: &envelope.actor,
                    execution_epoch: envelope.execution_epoch,
                    command_id: &envelope.command_id,
                    now: &now,
                },
            )?;
            let result_payload = json!({
                "campMessageId": camp_message_id,
                "sequence": queued.camp_sequence,
                "campTurnId": camp_turn_id,
                "agentRunIds": queued.agent_run_ids,
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

    pub fn send_inbox_message(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SendInboxMessageCommand>,
    ) -> Result<CommandExecution> {
        validate_inbox_input(&envelope.payload)?;
        let inbox_message_id = Uuid::new_v4().to_string();
        self.gateway.execute(database, envelope, |transaction| {
            let ActorRef::Agent {
                agent_profile_id: sender_agent_id,
                source_agent_run_id,
            } = &envelope.actor
            else {
                return Ok(rejected(
                    "inbox.agent_actor_required",
                    "Inbox messages must be sent by an Agent Actor",
                ));
            };
            if !actor_has_capability(
                transaction,
                &envelope.actor,
                envelope.execution_epoch,
                &envelope.payload.camp_id,
                "inbox.send",
            )? {
                return Ok(rejected(
                    "inbox.stale_sender",
                    "Sender Run is stale or no longer active in the Camp",
                ));
            }
            if let Some((existing_id, existing_sender, existing_recipient)) = transaction
                .query_row(
                    r#"
                    SELECT id, sender_agent_id, recipient_agent_id
                    FROM inbox_message
                    WHERE camp_id = ?1 AND idempotency_key = ?2
                    "#,
                    params![envelope.payload.camp_id, envelope.payload.idempotency_key,],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()?
            {
                if existing_sender != *sender_agent_id
                    || existing_recipient != envelope.payload.recipient_agent_id
                {
                    return Ok(rejected(
                        "inbox.idempotency_conflict",
                        "Inbox idempotencyKey is already used for another direction",
                    ));
                }
                return Ok(CommandHandlerResult::accepted(
                    "inbox_message.deduplicated",
                    json!({ "inboxMessageId": existing_id }),
                    Some(EntityReference {
                        entity_type: "inbox_message".to_string(),
                        entity_id: existing_id,
                    }),
                ));
            }
            let source_scope = transaction
                .query_row(
                    r#"
                    SELECT conversation.camp_id, conversation.agent_profile_id,
                           agent_run.camp_turn_id
                    FROM conversation
                    JOIN agent_run
                      ON agent_run.id = ?2
                     AND agent_run.conversation_id = conversation.id
                    WHERE conversation.id = ?1
                    "#,
                    params![envelope.payload.source_conversation_id, source_agent_run_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()?;
            let Some((source_camp_id, source_agent_id, source_camp_turn_id)) = source_scope else {
                return Ok(rejected(
                    "inbox.invalid_source",
                    "Source Conversation and AgentRun do not match",
                ));
            };
            if source_camp_id != envelope.payload.camp_id || source_agent_id != *sender_agent_id {
                return Ok(rejected(
                    "inbox.invalid_source",
                    "Source Conversation is outside the sender Camp identity",
                ));
            }
            if envelope
                .payload
                .source_camp_turn_id
                .as_deref()
                .is_some_and(|provided| provided != source_camp_turn_id)
            {
                return Ok(rejected(
                    "inbox.invalid_source_turn",
                    "sourceCampTurnId must match the sender AgentRun",
                ));
            }
            let Some(target) = active_address_target(
                transaction,
                &envelope.payload.camp_id,
                &envelope.payload.recipient_agent_id,
            )?
            else {
                return Ok(rejected(
                    "inbox.recipient_unavailable",
                    "Recipient is not an active Camp member",
                ));
            };
            if sender_agent_id == &envelope.payload.recipient_agent_id {
                return Ok(rejected(
                    "inbox.self_send",
                    "Inbox message cannot target the sender",
                ));
            }
            if let Some(reply_id) = &envelope.payload.in_reply_to_message_id {
                let reply = transaction
                    .query_row(
                        r#"
                        SELECT camp_id, sender_agent_id, recipient_agent_id, correlation_id
                        FROM inbox_message WHERE id = ?1
                        "#,
                        [reply_id],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, String>(3)?,
                            ))
                        },
                    )
                    .optional()?;
                let Some((reply_camp_id, reply_sender, reply_recipient, correlation_id)) = reply
                else {
                    return Ok(rejected(
                        "inbox.reply_not_found",
                        "Reply target does not exist",
                    ));
                };
                if reply_camp_id != envelope.payload.camp_id
                    || reply_sender != envelope.payload.recipient_agent_id
                    || reply_recipient != *sender_agent_id
                    || correlation_id != envelope.payload.correlation_id
                {
                    return Ok(rejected(
                        "inbox.invalid_reply",
                        "Reply must reverse the original direction and retain correlationId",
                    ));
                }
            }
            if let Some(retry_id) = &envelope.payload.retry_of_message_id {
                let retryable: i64 = transaction.query_row(
                    r#"
                    SELECT COUNT(*) FROM inbox_message
                    WHERE id = ?1 AND camp_id = ?2
                      AND sender_agent_id = ?3 AND recipient_agent_id = ?4
                      AND failed_at IS NOT NULL
                "#,
                    params![
                        retry_id,
                        envelope.payload.camp_id,
                        sender_agent_id,
                        envelope.payload.recipient_agent_id,
                    ],
                    |row| row.get(0),
                )?;
                if retryable != 1 {
                    return Ok(rejected(
                        "inbox.invalid_retry_source",
                        "Retry source must be a failed message in the same direction",
                    ));
                }
            }
            if let Some(target_agent_run_id) = &envelope.payload.target_agent_run_id {
                let valid_target_run: i64 = transaction.query_row(
                    r#"
                    SELECT COUNT(*)
                    FROM agent_run
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE agent_run.id = ?1
                      AND agent_run.conversation_id = ?2
                      AND camp_turn.camp_id = ?3
                      AND agent_run.status = 'queued'
                      AND agent_run.input_ready_at IS NULL
                      AND agent_run.trigger_conversation_message_id IS NULL
                    "#,
                    params![
                        target_agent_run_id,
                        target.conversation_id,
                        envelope.payload.camp_id,
                    ],
                    |row| row.get(0),
                )?;
                if valid_target_run != 1 {
                    return Ok(rejected(
                        "inbox.invalid_target_run",
                        "Execution Inbox must target an input-waiting queued AgentRun",
                    ));
                }
            }
            for reference in &envelope.payload.references {
                if !matches!(
                    reference.entity_type.as_str(),
                    "task" | "camp_message" | "agent_run" | "conversation_message"
                ) || !entity_belongs_to_camp(
                    transaction,
                    &reference.entity_type,
                    &reference.entity_id,
                    &envelope.payload.camp_id,
                )? {
                    return Ok(rejected(
                        "inbox.invalid_reference",
                        "Inbox reference is unsupported or outside the Camp",
                    ));
                }
            }

            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO inbox_message(
                    id, camp_id, sender_agent_id, recipient_agent_id,
                    body, references_json,
                    source_conversation_id, source_camp_turn_id, source_agent_run_id,
                    target_conversation_id, target_agent_run_id,
                    in_reply_to_message_id, correlation_id, batch_id,
                    retry_of_message_id, idempotency_key,
                    recipient_message_id, delivered_at,
                    attempt_count, available_at,
                    lease_owner, lease_expires_at, expires_at,
                    failed_at, last_error, created_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6,
                    ?7, ?8, ?9, ?10, ?11,
                    ?12, ?13, ?14, ?15, ?16,
                    NULL, NULL, 0, ?17, NULL, NULL, ?18,
                    NULL, NULL, ?17, ?17
                )
                "#,
                params![
                    inbox_message_id,
                    envelope.payload.camp_id,
                    sender_agent_id,
                    envelope.payload.recipient_agent_id,
                    envelope.payload.body,
                    serde_json::to_string(&envelope.payload.references)?,
                    envelope.payload.source_conversation_id,
                    source_camp_turn_id,
                    source_agent_run_id,
                    target.conversation_id,
                    envelope.payload.target_agent_run_id,
                    envelope.payload.in_reply_to_message_id,
                    envelope.payload.correlation_id,
                    envelope.payload.batch_id,
                    envelope.payload.retry_of_message_id,
                    envelope.payload.idempotency_key,
                    now,
                    envelope.payload.expires_at,
                ],
            )?;
            append_domain_event(
                transaction,
                "inbox_message.queued",
                Some(&envelope.payload.camp_id),
                Some(("inbox_message", &inbox_message_id)),
                &envelope.actor,
                envelope.execution_epoch,
                &json!({
                    "recipientAgentId": envelope.payload.recipient_agent_id,
                    "targetAgentRunId": envelope.payload.target_agent_run_id,
                }),
            )?;
            Ok(CommandHandlerResult::accepted(
                "inbox_message.queued",
                json!({ "inboxMessageId": inbox_message_id }),
                Some(EntityReference {
                    entity_type: "inbox_message".to_string(),
                    entity_id: inbox_message_id.clone(),
                }),
            ))
        })
    }

    pub fn deliver_inbox_message(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<DeliverInboxMessageCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            let ActorRef::System { component_id } = &envelope.actor else {
                return Ok(rejected(
                    "inbox_dispatch.system_actor_required",
                    "Inbox delivery requires a System Actor",
                ));
            };
            if component_id != "inbox-dispatcher" {
                return Ok(rejected(
                    "inbox_dispatch.invalid_component",
                    "Inbox delivery requires the inbox-dispatcher component",
                ));
            }
            let Some(message) =
                load_inbox_for_delivery(transaction, &envelope.payload.inbox_message_id)?
            else {
                return Ok(rejected(
                    "inbox_message.not_found",
                    "Inbox message does not exist",
                ));
            };
            if let Some(recipient_message_id) = message.recipient_message_id {
                return Ok(CommandHandlerResult::applied(
                    "inbox_message.already_delivered",
                    json!({
                        "inboxMessageId": message.id,
                        "recipientMessageId": recipient_message_id,
                    }),
                    Some(EntityReference {
                        entity_type: "conversation_message".to_string(),
                        entity_id: recipient_message_id,
                    }),
                ));
            }
            if message.failed_at.is_some() {
                return Ok(rejected(
                    "inbox_message.delivery_failed",
                    "Failed Inbox message requires an explicit resend",
                ));
            }
            let now = chrono::Utc::now();
            if message.lease_owner.as_deref() != Some(component_id)
                || message
                    .lease_expires_at
                    .as_deref()
                    .map(chrono::DateTime::parse_from_rfc3339)
                    .transpose()?
                    .is_none_or(|lease_expires_at| lease_expires_at <= now)
            {
                return Ok(rejected(
                    "inbox_message.delivery_lease_required",
                    "Inbox dispatcher must hold a live delivery lease",
                ));
            }
            if message
                .expires_at
                .as_deref()
                .map(chrono::DateTime::parse_from_rfc3339)
                .transpose()?
                .is_some_and(|expires_at| expires_at <= now)
            {
                transaction.execute(
                    "DELETE FROM inbox_message WHERE id = ?1 AND delivered_at IS NULL",
                    [&message.id],
                )?;
                append_domain_event(
                    transaction,
                    "inbox_message.expired",
                    Some(&message.camp_id),
                    Some(("inbox_message", &message.id)),
                    &envelope.actor,
                    None,
                    &json!({}),
                )?;
                return Ok(CommandHandlerResult::applied(
                    "inbox_message.expired",
                    json!({ "inboxMessageId": message.id }),
                    None,
                ));
            }
            if !is_active_member(transaction, &message.camp_id, &message.recipient_agent_id)? {
                fail_inbox_delivery(
                    transaction,
                    &message,
                    "recipient_unavailable",
                    &now.to_rfc3339(),
                )?;
                append_domain_event(
                    transaction,
                    "inbox_message.delivery_failed",
                    Some(&message.camp_id),
                    Some(("inbox_message", &message.id)),
                    &envelope.actor,
                    None,
                    &json!({ "error": "recipient_unavailable" }),
                )?;
                return Ok(CommandHandlerResult::applied(
                    "inbox_message.delivery_failed",
                    json!({
                        "inboxMessageId": message.id,
                        "error": "recipient_unavailable",
                    }),
                    Some(EntityReference {
                        entity_type: "inbox_message".to_string(),
                        entity_id: message.id,
                    }),
                ));
            }
            let target_turn_id = if let Some(target_agent_run_id) = &message.target_agent_run_id {
                let target_run = transaction
                    .query_row(
                        r#"
                        SELECT camp_turn_id FROM agent_run
                        WHERE id = ?1 AND conversation_id = ?2
                          AND status = 'queued'
                          AND input_ready_at IS NULL
                          AND trigger_conversation_message_id IS NULL
                        "#,
                        params![target_agent_run_id, message.target_conversation_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?;
                let Some(target_turn_id) = target_run else {
                    fail_inbox_delivery(
                        transaction,
                        &message,
                        "target_run_unavailable",
                        &now.to_rfc3339(),
                    )?;
                    append_domain_event(
                        transaction,
                        "inbox_message.delivery_failed",
                        Some(&message.camp_id),
                        Some(("inbox_message", &message.id)),
                        &envelope.actor,
                        None,
                        &json!({ "error": "target_run_unavailable" }),
                    )?;
                    return Ok(CommandHandlerResult::applied(
                        "inbox_message.delivery_failed",
                        json!({
                            "inboxMessageId": message.id,
                            "error": "target_run_unavailable",
                        }),
                        Some(EntityReference {
                            entity_type: "inbox_message".to_string(),
                            entity_id: message.id,
                        }),
                    ));
                };
                Some(target_turn_id)
            } else {
                message.source_camp_turn_id.clone()
            };

            let recipient_message_id = Uuid::new_v4().to_string();
            let recipient_sequence: i64 = transaction.query_row(
                "SELECT last_message_sequence + 1 FROM conversation WHERE id = ?1",
                [&message.target_conversation_id],
                |row| row.get(0),
            )?;
            let now_text = now.to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO conversation_message(
                    id, conversation_id, sequence,
                    author_type, author_id, source_agent_run_id, body,
                    source_camp_message_id, source_inbox_message_id,
                    camp_turn_id, agent_run_id, created_at
                ) VALUES (?1, ?2, ?3, 'agent', ?4, ?5, ?6, NULL, ?7, ?8, ?9, ?10)
                "#,
                params![
                    recipient_message_id,
                    message.target_conversation_id,
                    recipient_sequence,
                    message.sender_agent_id,
                    message.source_agent_run_id,
                    message.body,
                    message.id,
                    target_turn_id,
                    message.target_agent_run_id,
                    now_text,
                ],
            )?;
            transaction.execute(
                r#"
                UPDATE conversation
                SET last_message_sequence = ?2,
                    version = version + 1,
                    updated_at = ?3
                WHERE id = ?1
                "#,
                params![message.target_conversation_id, recipient_sequence, now_text],
            )?;
            if let Some(target_agent_run_id) = &message.target_agent_run_id {
                transaction.execute(
                    r#"
                    UPDATE agent_run
                    SET trigger_conversation_message_id = ?2,
                        input_ready_at = ?3,
                        version = version + 1,
                        updated_at = ?3
                    WHERE id = ?1
                      AND status = 'queued'
                      AND input_ready_at IS NULL
                      AND trigger_conversation_message_id IS NULL
                    "#,
                    params![target_agent_run_id, recipient_message_id, now_text],
                )?;
            }
            transaction.execute(
                r#"
                UPDATE inbox_message
                SET recipient_message_id = ?2,
                    delivered_at = ?3,
                    lease_owner = NULL,
                    lease_expires_at = NULL,
                    updated_at = ?3
                WHERE id = ?1 AND delivered_at IS NULL AND failed_at IS NULL
                "#,
                params![message.id, recipient_message_id, now_text],
            )?;
            append_domain_event(
                transaction,
                "inbox_message.delivered",
                Some(&message.camp_id),
                Some(("inbox_message", &message.id)),
                &envelope.actor,
                None,
                &json!({ "recipientMessageId": recipient_message_id }),
            )?;
            Ok(CommandHandlerResult::applied(
                "inbox_message.delivered",
                json!({
                    "inboxMessageId": message.id,
                    "recipientMessageId": recipient_message_id,
                }),
                Some(EntityReference {
                    entity_type: "conversation_message".to_string(),
                    entity_id: recipient_message_id,
                }),
            ))
        })
    }

    pub fn acquire_inbox_delivery_lease(
        &self,
        database: &mut Database,
        lease_owner: &str,
        lease_seconds: i64,
    ) -> Result<Option<String>> {
        if lease_owner.trim().is_empty() || lease_seconds <= 0 {
            anyhow::bail!("Inbox lease owner and duration must be valid");
        }
        let now = chrono::Utc::now();
        let now_text = now.to_rfc3339();
        let lease_expires_at = (now + chrono::Duration::seconds(lease_seconds)).to_rfc3339();
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let candidate = transaction
            .query_row(
                r#"
                SELECT id FROM inbox_message
                WHERE delivered_at IS NULL
                  AND failed_at IS NULL
                  AND available_at <= ?1
                  AND (expires_at IS NULL OR expires_at > ?1)
                  AND (lease_owner IS NULL OR lease_expires_at <= ?1)
                ORDER BY available_at, created_at, id
                LIMIT 1
                "#,
                [&now_text],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let Some(candidate) = candidate else {
            transaction.commit()?;
            return Ok(None);
        };
        let updated = transaction.execute(
            r#"
            UPDATE inbox_message
            SET lease_owner = ?2,
                lease_expires_at = ?3,
                updated_at = ?4
            WHERE id = ?1
              AND delivered_at IS NULL
              AND failed_at IS NULL
              AND available_at <= ?4
              AND (expires_at IS NULL OR expires_at > ?4)
              AND (lease_owner IS NULL OR lease_expires_at <= ?4)
            "#,
            params![candidate, lease_owner, lease_expires_at, now_text],
        )?;
        transaction.commit()?;
        Ok((updated == 1).then_some(candidate))
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

struct QueueCampMessageInput<'a> {
    camp_message_id: &'a str,
    camp_turn_id: Option<&'a str>,
    camp_id: &'a str,
    body: &'a str,
    address_mode: &'a str,
    reply_to_camp_message_id: Option<&'a str>,
    resolution: &'a AddressResolution,
    execution: Option<&'a ExecutionRequest>,
    effective_configs: Option<&'a BTreeMap<String, PreparedAgentRunConfig>>,
    workspace: Option<&'a AgentRunWorkspace>,
    actor: &'a ActorRef,
    execution_epoch: Option<i64>,
    command_id: &'a str,
    now: &'a str,
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
    transaction.execute(
        r#"
        UPDATE camp
        SET last_message_sequence = last_message_sequence + 1,
            version = version + 1,
            updated_at = ?2
        WHERE id = ?1
        "#,
        params![input.camp_id, input.now],
    )?;
    let camp_sequence: i64 = transaction.query_row(
        "SELECT last_message_sequence FROM camp WHERE id = ?1",
        [input.camp_id],
        |row| row.get(0),
    )?;

    if let Some(camp_turn_id) = input.camp_turn_id {
        transaction.execute(
            r#"
            INSERT INTO camp_turn(
                id, camp_id, trigger_type, trigger_id, status,
                cancel_requested_at, cancel_request_command_id,
                version, created_at, updated_at, ended_at
            ) VALUES (?1, ?2, 'camp_message', ?3, 'running', NULL, NULL, 1, ?4, ?4, NULL)
            "#,
            params![
                camp_turn_id,
                input.camp_id,
                input.camp_message_id,
                input.now
            ],
        )?;
    }

    let (author_type, author_id, source_agent_run_id) = actor_parts(input.actor);
    let addressed_agent_ids = input
        .resolution
        .targets
        .iter()
        .map(|target| target.agent_profile_id.clone())
        .collect::<Vec<_>>();
    transaction.execute(
        r#"
        INSERT INTO camp_message(
            id, camp_id, sequence,
            author_type, author_id, source_agent_run_id, body,
            address_mode, addressed_agent_profile_ids_json,
            reply_to_camp_message_id, camp_turn_id, agent_run_id,
            tombstoned_at, version, created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
            ?10, ?11, NULL, NULL, 1, ?12, ?12
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
            input.address_mode,
            serde_json::to_string(&addressed_agent_ids)?,
            input.reply_to_camp_message_id,
            input.camp_turn_id,
            input.now,
        ],
    )?;

    let mut agent_run_ids = Vec::new();
    if let (Some(execution), Some(camp_turn_id)) = (input.execution, input.camp_turn_id) {
        for target in &input.resolution.targets {
            let trigger_conversation_message_id = materialize_camp_prefix(
                transaction,
                &target.conversation_id,
                camp_sequence,
                input.camp_message_id,
                input.now,
            )?;
            let conversation_sequence: i64 = transaction.query_row(
                "SELECT last_message_sequence FROM conversation WHERE id = ?1",
                [&target.conversation_id],
                |row| row.get(0),
            )?;
            let prepared = input
                .effective_configs
                .and_then(|configs| configs.get(&target.agent_profile_id))
                .context("AgentRun target has no prepared Runtime configuration")?;
            let agent_run_id = Uuid::new_v4().to_string();
            let responsibility_key = execution.task_id.as_ref().map_or_else(
                || format!("respond/{}", target.agent_profile_id),
                |task_id| format!("execute/{task_id}/{}", target.agent_profile_id),
            );
            let workspace_json = input.workspace.map(serde_json::to_string).transpose()?;
            transaction.execute(
                r#"
                INSERT INTO agent_run(
                    id, camp_turn_id, conversation_id, task_id,
                    trigger_conversation_message_id, input_ready_at,
                    initial_camp_context_through_sequence,
                    initial_conversation_context_through_sequence,
                    responsibility_key, responsibility_generation,
                    predecessor_agent_run_id, start_reason,
                    purpose, expected_output, completion_role,
                    effective_config_json, workspace_json,
                    runtime_adapter_kind, runtime_installation_id,
                    runtime_executable_path, runtime_auth_scope,
                    runtime_reported_version, runtime_executable_fingerprint,
                    runtime_capabilities_json, runtime_model_selection_json,
                    runtime_permission_config_json,
                    runtime_binding_compatibility_digest,
                    runtime_host_config_digest, runtime_protocol_version,
                    status, wait_reason, wait_deadline_at,
                    idempotency_key, automatic_retry_count,
                    last_error_code, last_error_details_ref,
                    manual_retry_allowed, retry_declined_at,
                    execution_epoch, execution_lease_owner,
                    execution_lease_expires_at,
                    cancel_requested_at, cancel_reason_code,
                    cancel_acknowledged_at, version,
                    created_at, started_at, ended_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                    ?9, 0, NULL, 'initial', ?10, ?11, ?12,
                    ?13, ?14,
                    ?16, ?17, ?18, ?19, ?20, ?21,
                    ?22, ?23, ?24, ?25, ?26, ?27,
                    'queued', NULL, NULL,
                    ?15, 0, NULL, NULL, 0, NULL,
                    0, NULL, NULL, NULL, NULL, NULL, 1,
                    ?6, NULL, NULL, ?6
                )
                "#,
                params![
                    agent_run_id,
                    camp_turn_id,
                    target.conversation_id,
                    execution.task_id,
                    trigger_conversation_message_id,
                    input.now,
                    camp_sequence,
                    conversation_sequence,
                    responsibility_key,
                    execution.purpose,
                    execution.expected_output,
                    execution.completion_role,
                    serde_json::to_string(&prepared.effective_config)?,
                    workspace_json,
                    format!("{}:{}", input.command_id, target.agent_profile_id),
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
            "addressedAgentProfileIds": addressed_agent_ids,
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

#[derive(Debug, Clone)]
struct AddressTarget {
    agent_profile_id: String,
    conversation_id: String,
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
    address: &MessageAddressSpec,
    actor: &ActorRef,
) -> Result<AddressingOutcome> {
    match address {
        MessageAddressSpec::Default => {
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
        MessageAddressSpec::Explicit { agent_profile_ids } => {
            if agent_profile_ids.is_empty() {
                return Ok(AddressingOutcome::Rejected(rejected(
                    "camp_message.empty_explicit_address",
                    "Explicit address requires at least one Agent",
                )));
            }
            let mut seen = HashSet::new();
            let mut targets = Vec::new();
            for agent_profile_id in agent_profile_ids {
                if !seen.insert(agent_profile_id) {
                    continue;
                }
                let Some(target) = active_address_target(transaction, camp_id, agent_profile_id)?
                else {
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
        MessageAddressSpec::Broadcast => {
            let sender_agent_id = match actor {
                ActorRef::Agent {
                    agent_profile_id, ..
                } => Some(agent_profile_id.as_str()),
                _ => None,
            };
            let mut statement = transaction.prepare(
                r#"
                SELECT camp_member.agent_profile_id, conversation.id
                FROM camp_member
                JOIN camp ON camp.id = camp_member.camp_id
                JOIN agent_profile ON agent_profile.id = camp_member.agent_profile_id
                JOIN conversation
                  ON conversation.camp_id = camp_member.camp_id
                 AND conversation.agent_profile_id = camp_member.agent_profile_id
                WHERE camp_member.camp_id = ?1
                  AND camp.status = 'active'
                  AND camp_member.status = 'active'
                  AND camp_member.leave_requested_at IS NULL
                  AND agent_profile.profile_status = 'active'
                ORDER BY camp_member.joined_at, camp_member.agent_profile_id
                "#,
            )?;
            let rows = statement.query_map([camp_id], |row| {
                Ok(AddressTarget {
                    agent_profile_id: row.get(0)?,
                    conversation_id: row.get(1)?,
                })
            })?;
            let mut targets = Vec::new();
            for row in rows {
                let target = row?;
                if sender_agent_id == Some(target.agent_profile_id.as_str()) {
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
            JOIN agent_profile ON agent_profile.id = camp_member.agent_profile_id
            WHERE camp_member.camp_id = ?1
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'active'
            "#,
            [camp_id],
            |row| row.get(0),
        )
        .context("failed to count active Camp members")
}

fn active_address_target(
    transaction: &Connection,
    camp_id: &str,
    agent_profile_id: &str,
) -> Result<Option<AddressTarget>> {
    transaction
        .query_row(
            r#"
            SELECT camp_member.agent_profile_id, conversation.id
            FROM camp_member
            JOIN camp ON camp.id = camp_member.camp_id
            JOIN agent_profile ON agent_profile.id = camp_member.agent_profile_id
            JOIN conversation
              ON conversation.camp_id = camp_member.camp_id
             AND conversation.agent_profile_id = camp_member.agent_profile_id
            WHERE camp_member.camp_id = ?1
              AND camp_member.agent_profile_id = ?2
              AND camp.status = 'active'
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'active'
            "#,
            params![camp_id, agent_profile_id],
            |row| {
                Ok(AddressTarget {
                    agent_profile_id: row.get(0)?,
                    conversation_id: row.get(1)?,
                })
            },
        )
        .optional()
        .context("failed to resolve active Camp member Conversation")
}

fn actor_can_write_camp(
    transaction: &Transaction<'_>,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    camp_id: &str,
) -> Result<bool> {
    let ActorRef::Agent {
        agent_profile_id,
        source_agent_run_id,
    } = actor
    else {
        return Ok(true);
    };
    let Some(execution_epoch) = execution_epoch else {
        return Ok(false);
    };
    let count: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*)
        FROM agent_run
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        JOIN conversation ON conversation.id = agent_run.conversation_id
        JOIN camp_member
          ON camp_member.camp_id = camp_turn.camp_id
         AND camp_member.agent_profile_id = conversation.agent_profile_id
        JOIN agent_profile ON agent_profile.id = conversation.agent_profile_id
        WHERE agent_run.id = ?1
          AND camp_turn.camp_id = ?2
          AND conversation.agent_profile_id = ?3
          AND agent_run.execution_epoch = ?4
          AND agent_run.status IN ('running', 'waiting')
          AND camp_member.status = 'active'
          AND camp_member.leave_requested_at IS NULL
          AND agent_profile.profile_status = 'active'
        "#,
        params![
            source_agent_run_id,
            camp_id,
            agent_profile_id,
            execution_epoch,
        ],
        |row| row.get(0),
    )?;
    Ok(count == 1)
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

fn validate_camp_message_input(command: &SendCampMessageCommand) -> Result<()> {
    if command.body.trim().is_empty() {
        anyhow::bail!("Camp message body must not be empty");
    }
    if let Some(execution) = &command.execution {
        if execution.purpose.trim().is_empty() || execution.expected_output.trim().is_empty() {
            anyhow::bail!("Execution request requires purpose and expectedOutput");
        }
        if !matches!(execution.completion_role.as_str(), "required" | "optional") {
            anyhow::bail!("completionRole must be required or optional");
        }
    }
    Ok(())
}

fn task_is_ready_for_new_run(
    transaction: &Transaction<'_>,
    task_id: &str,
    camp_id: &str,
) -> Result<bool> {
    let task = transaction
        .query_row(
            r#"
            SELECT status, cancel_requested_at, assignee_agent_id
            FROM task WHERE id = ?1 AND camp_id = ?2
            "#,
            params![task_id, camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((status, cancel_requested_at, assignee_agent_id)) = task else {
        return Ok(false);
    };
    if !matches!(status.as_str(), "pending" | "in_progress") || cancel_requested_at.is_some() {
        return Ok(false);
    }
    let Some(assignee_agent_id) = assignee_agent_id else {
        return Ok(false);
    };
    if !is_active_member(transaction, camp_id, &assignee_agent_id)? {
        return Ok(false);
    }
    let incomplete_dependencies: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*)
        FROM task_dependency
        JOIN task dependency ON dependency.id = task_dependency.depends_on_task_id
        WHERE task_dependency.task_id = ?1
          AND dependency.status <> 'completed'
        "#,
        [task_id],
        |row| row.get(0),
    )?;
    Ok(incomplete_dependencies == 0)
}

pub(crate) fn materialize_camp_prefix(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    through_camp_sequence: i64,
    trigger_camp_message_id: &str,
    now: &str,
) -> Result<String> {
    let (camp_id, mut last_seen_sequence, mut conversation_sequence) = transaction.query_row(
        r#"
        SELECT camp_id, last_seen_camp_message_sequence, last_message_sequence
        FROM conversation WHERE id = ?1
        "#,
        [conversation_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    )?;
    if through_camp_sequence < last_seen_sequence {
        anyhow::bail!("cannot materialize a Camp prefix behind the Conversation cursor");
    }
    let mut statement = transaction.prepare(
        r#"
        SELECT id, sequence, author_type, author_id, source_agent_run_id,
               body, camp_turn_id, agent_run_id
        FROM camp_message
        WHERE camp_id = ?1 AND sequence > ?2 AND sequence <= ?3
        ORDER BY sequence
        "#,
    )?;
    let messages = statement
        .query_map(
            params![camp_id, last_seen_sequence, through_camp_sequence],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);

    let mut trigger_conversation_message_id = None;
    for (
        camp_message_id,
        camp_sequence,
        author_type,
        author_id,
        source_agent_run_id,
        body,
        camp_turn_id,
        agent_run_id,
    ) in messages
    {
        if camp_sequence != last_seen_sequence + 1 {
            anyhow::bail!("Camp message sequence contains a gap");
        }
        conversation_sequence += 1;
        let conversation_message_id = Uuid::new_v4().to_string();
        transaction.execute(
            r#"
            INSERT INTO conversation_message(
                id, conversation_id, sequence,
                author_type, author_id, source_agent_run_id, body,
                source_camp_message_id, source_inbox_message_id,
                camp_turn_id, agent_run_id, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?11)
            "#,
            params![
                conversation_message_id,
                conversation_id,
                conversation_sequence,
                author_type,
                author_id,
                source_agent_run_id,
                body,
                camp_message_id,
                camp_turn_id,
                agent_run_id,
                now,
            ],
        )?;
        if camp_message_id == trigger_camp_message_id {
            trigger_conversation_message_id = Some(conversation_message_id);
        }
        last_seen_sequence = camp_sequence;
    }
    if last_seen_sequence != through_camp_sequence {
        anyhow::bail!("Camp message prefix could not be fully materialized");
    }
    transaction.execute(
        r#"
        UPDATE conversation
        SET last_seen_camp_message_sequence = ?2,
            last_message_sequence = ?3,
            version = version + 1,
            updated_at = ?4
        WHERE id = ?1
        "#,
        params![
            conversation_id,
            last_seen_sequence,
            conversation_sequence,
            now,
        ],
    )?;
    trigger_conversation_message_id
        .context("trigger CampMessage was not materialized into the target Conversation")
}

fn prepare_agent_run_configs(
    transaction: &Transaction<'_>,
    resolution: &AddressResolution,
) -> Result<std::result::Result<BTreeMap<String, PreparedAgentRunConfig>, CommandHandlerResult>> {
    let mut configs = BTreeMap::new();
    for target in &resolution.targets {
        let runtime = match resolve_frozen_runtime(
            transaction,
            &target.conversation_id,
            &target.agent_profile_id,
        )? {
            Ok(runtime) => runtime,
            Err(blocker) => {
                return Ok(Err(CommandHandlerResult::rejected(
                    "agent_run.runtime_not_ready",
                    json!({
                        "agentProfileId": target.agent_profile_id,
                        "conversationId": target.conversation_id,
                        "blockerCode": blocker.code,
                        "detail": blocker.payload,
                    }),
                )));
            }
        };
        let effective_config = build_effective_config(
            transaction,
            &target.conversation_id,
            &target.agent_profile_id,
            &runtime,
        )?;
        configs.insert(
            target.agent_profile_id.clone(),
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
    agent_profile_id: &str,
    runtime: &FrozenAgentRuntimeConfig,
) -> Result<Value> {
    let (
        role_description,
        instructions,
        default_capabilities_json,
        agent_profile_version,
        capability_overrides_json,
        camp_member_version,
        conversation_version,
    ) = transaction.query_row(
        r#"
        SELECT COALESCE(agent_profile.role_description, agent_profile.role_contract),
               agent_profile.instructions,
               agent_profile.default_capabilities_json,
               agent_profile.version,
               camp_member.capability_overrides_json,
               camp_member.version,
               conversation.version
        FROM conversation
        JOIN agent_profile ON agent_profile.id = conversation.agent_profile_id
        JOIN camp_member
          ON camp_member.camp_id = conversation.camp_id
         AND camp_member.agent_profile_id = conversation.agent_profile_id
        WHERE conversation.id = ?1 AND conversation.agent_profile_id = ?2
        "#,
        params![conversation_id, agent_profile_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
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
    let action_permission_rules = if capabilities.contains("action.request") {
        [
            "shell_command",
            "file_write",
            "file_delete",
            "git_mutation",
            "network_write",
            "network_access",
            "mcp_tool",
            "sensitive_read",
            "runtime_permission_grant",
        ]
        .into_iter()
        .map(|action_kind| {
            json!({
                "id": format!("default-ask-{action_kind}"),
                "actionKind": action_kind,
                "effect": "ask",
            })
        })
        .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let mut action_permission_envelope = json!({
        "schemaVersion": 1,
        "rules": action_permission_rules,
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
        "schemaVersion": 1,
        "agentProfileId": agent_profile_id,
        "agentProfileVersion": agent_profile_version,
        "campMemberVersion": camp_member_version,
        "conversationVersion": conversation_version,
        "roleDescription": role_description,
        "instructions": instructions,
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

#[derive(Debug)]
struct InboxForDelivery {
    id: String,
    camp_id: String,
    sender_agent_id: String,
    recipient_agent_id: String,
    body: String,
    source_camp_turn_id: Option<String>,
    source_agent_run_id: Option<String>,
    target_conversation_id: String,
    target_agent_run_id: Option<String>,
    recipient_message_id: Option<String>,
    lease_owner: Option<String>,
    lease_expires_at: Option<String>,
    expires_at: Option<String>,
    failed_at: Option<String>,
}

fn validate_inbox_input(command: &SendInboxMessageCommand) -> Result<()> {
    if command.body.trim().is_empty()
        || command.correlation_id.trim().is_empty()
        || command.idempotency_key.trim().is_empty()
    {
        anyhow::bail!("Inbox body, correlationId and idempotencyKey must not be empty");
    }
    if command.references.len() > 32 {
        anyhow::bail!("Inbox messages support at most 32 references");
    }
    let mut references = BTreeSet::new();
    for reference in &command.references {
        if reference.entity_type.trim().is_empty()
            || reference.entity_id.trim().is_empty()
            || !references.insert((&reference.entity_type, &reference.entity_id))
        {
            anyhow::bail!("Inbox references must be non-empty and unique");
        }
    }
    if command.target_agent_run_id.is_some() && command.expires_at.is_some() {
        anyhow::bail!("Execution Inbox messages cannot expire");
    }
    if let Some(expires_at) = &command.expires_at {
        chrono::DateTime::parse_from_rfc3339(expires_at).context("expiresAt must be RFC 3339")?;
    }
    Ok(())
}

fn load_inbox_for_delivery(
    transaction: &Transaction<'_>,
    inbox_message_id: &str,
) -> Result<Option<InboxForDelivery>> {
    transaction
        .query_row(
            r#"
            SELECT id, camp_id, sender_agent_id, recipient_agent_id, body,
                   source_camp_turn_id, source_agent_run_id,
                   target_conversation_id, target_agent_run_id,
                   recipient_message_id, lease_owner, lease_expires_at,
                   expires_at, failed_at
            FROM inbox_message WHERE id = ?1
            "#,
            [inbox_message_id],
            |row| {
                Ok(InboxForDelivery {
                    id: row.get(0)?,
                    camp_id: row.get(1)?,
                    sender_agent_id: row.get(2)?,
                    recipient_agent_id: row.get(3)?,
                    body: row.get(4)?,
                    source_camp_turn_id: row.get(5)?,
                    source_agent_run_id: row.get(6)?,
                    target_conversation_id: row.get(7)?,
                    target_agent_run_id: row.get(8)?,
                    recipient_message_id: row.get(9)?,
                    lease_owner: row.get(10)?,
                    lease_expires_at: row.get(11)?,
                    expires_at: row.get(12)?,
                    failed_at: row.get(13)?,
                })
            },
        )
        .optional()
        .context("failed to load Inbox message for delivery")
}

fn fail_inbox_delivery(
    transaction: &Transaction<'_>,
    message: &InboxForDelivery,
    error: &str,
    now: &str,
) -> Result<()> {
    transaction.execute(
        r#"
        UPDATE inbox_message
        SET attempt_count = attempt_count + 1,
            failed_at = ?2,
            last_error = ?3,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = ?2
        WHERE id = ?1 AND delivered_at IS NULL AND failed_at IS NULL
        "#,
        params![message.id, now, error],
    )?;
    if let Some(target_agent_run_id) = &message.target_agent_run_id {
        let camp_turn_id = transaction
            .query_row(
                "SELECT camp_turn_id FROM agent_run WHERE id = ?1",
                [target_agent_run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        transaction.execute(
            r#"
            UPDATE agent_run
            SET status = 'failed',
                last_error_code = 'input_delivery_failed',
                manual_retry_allowed = 0,
                execution_lease_owner = NULL,
                execution_lease_expires_at = NULL,
                version = version + 1,
                ended_at = ?2,
                updated_at = ?2
            WHERE id = ?1 AND status = 'queued' AND input_ready_at IS NULL
            "#,
            params![target_agent_run_id, now],
        )?;
        if let Some(camp_turn_id) = camp_turn_id {
            aggregate_camp_turn(transaction, &camp_turn_id, now)?;
        }
    }
    Ok(())
}

fn aggregate_camp_turn(transaction: &Transaction<'_>, camp_turn_id: &str, now: &str) -> Result<()> {
    let (cancel_requested, status) = transaction.query_row(
        "SELECT cancel_requested_at IS NOT NULL, status FROM camp_turn WHERE id = ?1",
        [camp_turn_id],
        |row| Ok((row.get::<_, bool>(0)?, row.get::<_, String>(1)?)),
    )?;
    if matches!(status.as_str(), "completed" | "failed" | "cancelled") {
        return Ok(());
    }
    let nonterminal: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*) FROM agent_run
        WHERE camp_turn_id = ?1 AND status IN ('queued', 'running', 'waiting')
        "#,
        [camp_turn_id],
        |row| row.get(0),
    )?;
    if nonterminal > 0 {
        let waiting_only: i64 = transaction.query_row(
            r#"
            SELECT COUNT(*) FROM agent_run
            WHERE camp_turn_id = ?1 AND status IN ('queued', 'running')
            "#,
            [camp_turn_id],
            |row| row.get(0),
        )?;
        let next = if waiting_only == 0 {
            "waiting"
        } else {
            "running"
        };
        transaction.execute(
            "UPDATE camp_turn SET status = ?2, version = version + 1, updated_at = ?3 WHERE id = ?1",
            params![camp_turn_id, next, now],
        )?;
        return Ok(());
    }
    let required_failed: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*) FROM agent_run
        WHERE camp_turn_id = ?1
          AND completion_role = 'required'
          AND status IN ('failed', 'cancelled')
        "#,
        [camp_turn_id],
        |row| row.get(0),
    )?;
    let next = if cancel_requested {
        "cancelled"
    } else if required_failed > 0 {
        "failed"
    } else {
        "completed"
    };
    transaction.execute(
        r#"
        UPDATE camp_turn
        SET status = ?2, version = version + 1, updated_at = ?3, ended_at = ?3
        WHERE id = ?1
        "#,
        params![camp_turn_id, next, now],
    )?;
    Ok(())
}

fn validate_project_path(path: &str) -> Result<()> {
    if path.trim().is_empty() || !Path::new(path).is_absolute() {
        anyhow::bail!("projectPath must be a non-empty absolute path");
    }
    Ok(())
}

fn validate_repository_binding(binding: &RepositoryBindingInput) -> Result<()> {
    validate_project_path(&binding.git_common_dir)?;
    if !matches!(binding.object_format.as_str(), "sha1" | "sha256") {
        anyhow::bail!("repository objectFormat must be sha1 or sha256");
    }
    Ok(())
}

fn normalized_camp_title(body: &str) -> String {
    let normalized = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        "新对话".to_string()
    } else {
        normalized
    }
}

fn resolve_repository_scope_id(
    transaction: &Connection,
    repository: Option<&RepositoryBindingInput>,
) -> Result<Option<String>> {
    let Some(repository) = repository else {
        return Ok(None);
    };
    let existing = transaction
        .query_row(
            r#"
            SELECT repository_scope_id
            FROM camp
            WHERE repository_git_common_dir = ?1
              AND repository_object_format = ?2
              AND repository_scope_id IS NOT NULL
            ORDER BY created_at, id
            LIMIT 1
            "#,
            params![repository.git_common_dir, repository.object_format],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(Some(existing.unwrap_or_else(|| {
        format!("repository-scope-{}", Uuid::new_v4())
    })))
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
            "pending_inbox_delivery",
            r#"
            SELECT COUNT(*) FROM inbox_message
            WHERE camp_id = ?1 AND delivered_at IS NULL AND failed_at IS NULL
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
            "pending_context_compaction",
            r#"
            SELECT COUNT(*)
            FROM context_compaction_attempt
            JOIN agent_run ON agent_run.id = context_compaction_attempt.agent_run_id
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE camp_turn.camp_id = ?1
              AND context_compaction_attempt.status IN ('queued', 'running')
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
              + (SELECT COUNT(*) FROM inbox_message
                 WHERE camp_id = ?1 AND lease_owner IS NOT NULL)
            "#,
        ),
        (
            "unfinished_membership_change",
            r#"
            SELECT COUNT(*) FROM camp_member
            WHERE camp_id = ?1 AND leave_requested_at IS NOT NULL
            "#,
        ),
        (
            "unfinished_task_cancellation",
            r#"
            SELECT COUNT(*) FROM task
            WHERE camp_id = ?1
              AND cancel_requested_at IS NOT NULL
              AND status NOT IN ('completed', 'cancelled')
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

fn delete_camp_aggregate(transaction: &Connection, camp_id: &str) -> Result<()> {
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
    transaction.execute(
        "DELETE FROM task_evidence_binding WHERE task_id IN (SELECT id FROM task WHERE camp_id = ?1)",
        [camp_id],
    )?;
    transaction.execute(
        "DELETE FROM message_attachment WHERE camp_id = ?1",
        [camp_id],
    )?;
    transaction.execute(
        "DELETE FROM repository_commit_evidence WHERE camp_id = ?1",
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
        DELETE FROM context_compaction_attempt
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
        DELETE FROM context_summary
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
    transaction.execute("DELETE FROM inbox_message WHERE camp_id = ?1", [camp_id])?;
    transaction.execute(
        "DELETE FROM conversation_message WHERE conversation_id IN (SELECT id FROM conversation WHERE camp_id = ?1)",
        [camp_id],
    )?;
    transaction.execute("DELETE FROM camp_message WHERE camp_id = ?1", [camp_id])?;
    transaction.execute(
        r#"
        DELETE FROM agent_run
        WHERE camp_turn_id IN (SELECT id FROM camp_turn WHERE camp_id = ?1)
        "#,
        [camp_id],
    )?;
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
        DELETE FROM task_dependency
        WHERE task_id IN (SELECT id FROM task WHERE camp_id = ?1)
           OR depends_on_task_id IN (SELECT id FROM task WHERE camp_id = ?1)
        "#,
        [camp_id],
    )?;
    transaction.execute("DELETE FROM task WHERE camp_id = ?1", [camp_id])?;
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
        "task.complete",
        "task.cancel",
        "task.dependency.manage",
        "agent_run.create",
        "agent_run.retry",
        "agent_run.cancel",
        "inbox.send",
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
    if command.title.trim().is_empty() || command.objective.trim().is_empty() {
        anyhow::bail!("Task title and objective must not be empty");
    }
    let mut ids = BTreeSet::new();
    for criterion in &command.acceptance_criteria {
        if criterion.id.trim().is_empty()
            || criterion.text.trim().is_empty()
            || !ids.insert(criterion.id.as_str())
        {
            anyhow::bail!("Acceptance Criteria require unique non-empty IDs and text");
        }
    }
    Ok(())
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({ "message": message }))
}

fn actor_parts(actor: &ActorRef) -> (&'static str, &str, Option<&str>) {
    match actor {
        ActorRef::User { user_id } => ("user", user_id, None),
        ActorRef::Agent {
            agent_profile_id,
            source_agent_run_id,
        } => ("agent", agent_profile_id, Some(source_agent_run_id)),
        ActorRef::System { component_id } => ("system", component_id, None),
    }
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

fn is_active_member(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_profile_id: &str,
) -> Result<bool> {
    let count: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*)
        FROM camp_member
        JOIN camp ON camp.id = camp_member.camp_id
        JOIN agent_profile ON agent_profile.id = camp_member.agent_profile_id
        JOIN conversation
          ON conversation.camp_id = camp_member.camp_id
         AND conversation.agent_profile_id = camp_member.agent_profile_id
        WHERE camp_member.camp_id = ?1
          AND camp_member.agent_profile_id = ?2
          AND camp.status = 'active'
          AND camp_member.status = 'active'
          AND camp_member.leave_requested_at IS NULL
          AND agent_profile.profile_status = 'active'
        "#,
        params![camp_id, agent_profile_id],
        |row| row.get(0),
    )?;
    Ok(count == 1)
}

pub(crate) fn entity_belongs_to_camp(
    transaction: &Transaction<'_>,
    entity_type: &str,
    entity_id: &str,
    camp_id: &str,
) -> Result<bool> {
    let sql = match entity_type {
        "camp_message" => "SELECT COUNT(*) FROM camp_message WHERE id = ?1 AND camp_id = ?2",
        "task" => "SELECT COUNT(*) FROM task WHERE id = ?1 AND camp_id = ?2",
        "agent_run" => {
            "SELECT COUNT(*) FROM agent_run JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id WHERE agent_run.id = ?1 AND camp_turn.camp_id = ?2"
        }
        "conversation_message" => {
            "SELECT COUNT(*) FROM conversation_message JOIN conversation ON conversation.id = conversation_message.conversation_id WHERE conversation_message.id = ?1 AND conversation.camp_id = ?2"
        }
        _ => return Ok(false),
    };
    let count: i64 = transaction.query_row(sql, params![entity_id, camp_id], |row| row.get(0))?;
    Ok(count == 1)
}

fn ensure_legacy_project_projection(
    transaction: &Transaction<'_>,
    camp_id: &str,
    project_path: &str,
    git_common_dir: Option<&str>,
    now: &str,
) -> Result<String> {
    if let Some(project_id) = transaction
        .query_row(
            "SELECT id FROM project WHERE root_path = ?1",
            [project_path],
            |row| row.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(project_id);
    }

    // `task.project_id` is a v0.01 non-null compatibility column. This derived row
    // keeps the legacy renderer readable; v0.02 never treats it as domain truth.
    let project_id = format!("legacy-{camp_id}");
    let name = Path::new(project_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Camp")
        .to_string();
    transaction.execute(
        r#"
        INSERT INTO project(
            id, name, kind, root_path, git_common_dir, created_at, last_opened_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        "#,
        params![
            project_id,
            name,
            if git_common_dir.is_some() {
                "git"
            } else {
                "lobby"
            },
            project_path,
            git_common_dir.unwrap_or(project_path),
            now,
        ],
    )?;
    Ok(project_id)
}

fn task_camp_and_status(
    transaction: &Transaction<'_>,
    task_id: &str,
) -> Result<Option<(String, String, i64)>> {
    transaction
        .query_row(
            "SELECT camp_id, status, version FROM task WHERE id = ?1 AND camp_id IS NOT NULL",
            [task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .context("failed to read Task scope and status")
}

fn dependency_would_cycle(
    transaction: &Transaction<'_>,
    task_id: &str,
    depends_on_task_id: &str,
) -> Result<bool> {
    let found: i64 = transaction.query_row(
        r#"
        WITH RECURSIVE dependency_path(task_id) AS (
            SELECT ?1
            UNION
            SELECT task_dependency.depends_on_task_id
            FROM task_dependency
            JOIN dependency_path ON task_dependency.task_id = dependency_path.task_id
        )
        SELECT EXISTS(SELECT 1 FROM dependency_path WHERE task_id = ?2)
        "#,
        params![depends_on_task_id, task_id],
        |row| row.get(0),
    )?;
    Ok(found != 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        agent_profile::configure_test_runtime,
        command::{CommandGatewayError, CommandResultStatus},
    };

    fn test_database() -> (Database, std::path::PathBuf) {
        let directory =
            std::env::temp_dir().join(format!("lumen-collaboration-test-{}", Uuid::new_v4()));
        let database = Database::open(&directory).expect("database should open");
        (database, directory)
    }

    fn user_envelope<P>(command_id: &str, camp_id: Option<&str>, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: "local-user".to_string(),
            },
            camp_id: camp_id.map(str::to_string),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
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
            CreateCampCommand {
                project_path: directory.join("workspace").to_string_lossy().to_string(),
                repository: None,
            },
        );
        let created = service
            .create_camp(database, &create)
            .expect("Camp should be created");
        let camp_id = created.result.payload["campId"]
            .as_str()
            .expect("Camp result should include ID")
            .to_string();
        for (index, member) in members.iter().enumerate() {
            let add = user_envelope(
                &format!("add-member-{index}"),
                Some(&camp_id),
                AddCampMemberCommand {
                    camp_id: camp_id.clone(),
                    agent_profile_id: (*member).to_string(),
                    capability_overrides: json!({}),
                },
            );
            service
                .add_camp_member(database, &add)
                .expect("Camp member should be added");
        }
        configure_test_runtime(database, members);
        camp_id
    }

    fn row_count(database: &Database, table: &str) -> i64 {
        database
            .connection()
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap()
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
    fn first_message_creates_a_complete_camp_and_reuses_repository_scope() {
        let (mut database, directory) = test_database();
        configure_test_runtime(&database, &["agent-luoke", "agent-muwa"]);
        let service = CollaborationService::default();
        let project_path = directory.join("workspace");
        let git_common_dir = project_path.join(".git");
        let create = |command_id: &str, body: &str| {
            user_envelope(
                command_id,
                None,
                CreateCampFromFirstMessageCommand {
                    project_path: project_path.to_string_lossy().to_string(),
                    repository: Some(RepositoryBindingInput {
                        git_common_dir: git_common_dir.to_string_lossy().to_string(),
                        object_format: "sha1".to_string(),
                    }),
                    body: body.to_string(),
                    purpose: "回答用户问题".to_string(),
                    expected_output: "公开回复".to_string(),
                },
            )
        };
        let first_envelope = create("first-camp", "  第一行\n  第二行  ");
        let first = service
            .create_camp_from_first_message(&mut database, &first_envelope)
            .expect("first Camp should be created");
        let replay = service
            .create_camp_from_first_message(&mut database, &first_envelope)
            .expect("same command should replay");
        let second = service
            .create_camp_from_first_message(&mut database, &create("second-camp", "另一个问题"))
            .expect("second Camp should be created");

        assert_eq!(first.result.status, CommandResultStatus::Accepted);
        assert!(replay.replayed);
        assert_eq!(first.result, replay.result);
        let first_camp_id = first.result.payload["campId"].as_str().unwrap();
        let second_camp_id = second.result.payload["campId"].as_str().unwrap();
        let first_state: (String, String, String, String) = database
            .connection()
            .query_row(
                r#"
                SELECT title, repository_scope_id,
                       repository_internal_ref_namespace, default_lead_agent_id
                FROM camp WHERE id = ?1
                "#,
                [first_camp_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        let second_state: (String, String) = database
            .connection()
            .query_row(
                "SELECT repository_scope_id, repository_internal_ref_namespace FROM camp WHERE id = ?1",
                [second_camp_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(first_state.0, "第一行 第二行");
        assert_eq!(first_state.1, second_state.0);
        assert_ne!(first_state.2, second_state.1);
        assert_eq!(first_state.3, "agent-luoke");
        assert_eq!(row_count(&database, "camp"), 2);
        assert_eq!(row_count(&database, "camp_member"), 8);
        assert_eq!(row_count(&database, "conversation"), 8);
        assert_eq!(row_count(&database, "camp_message"), 2);
        assert_eq!(row_count(&database, "camp_turn"), 2);
        assert_eq!(row_count(&database, "agent_run"), 2);

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn first_message_rejection_leaves_no_partial_camp() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let result = service
            .create_camp_from_first_message(
                &mut database,
                &user_envelope(
                    "no-ready-runtime",
                    None,
                    CreateCampFromFirstMessageCommand {
                        project_path: directory.join("workspace").to_string_lossy().to_string(),
                        repository: None,
                        body: "请回答".to_string(),
                        purpose: "回答".to_string(),
                        expected_output: "回复".to_string(),
                    },
                ),
            )
            .expect("readiness failure should be a durable rejection");

        assert_eq!(result.result.status, CommandResultStatus::Rejected);
        assert_eq!(result.result.code, "camp.no_runtime_ready_members");
        assert_eq!(row_count(&database, "camp"), 0);
        assert_eq!(row_count(&database, "camp_member"), 0);
        assert_eq!(row_count(&database, "conversation"), 0);
        assert_eq!(row_count(&database, "camp_message"), 0);
        assert_eq!(row_count(&database, "camp_turn"), 0);
        assert_eq!(row_count(&database, "agent_run"), 0);
        assert_eq!(row_count(&database, "event_log"), 1);

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn camp_rename_lead_change_and_quiescent_delete_are_versioned() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id = create_camp_with_members(
            &service,
            &mut database,
            &directory,
            &["agent-luoke", "agent-muwa"],
        );
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
                        successor_agent_id: "agent-muwa".to_string(),
                        expected_version: lead_version,
                    },
                ),
            )
            .expect("Default Lead should change");
        assert_eq!(changed.result.code, "camp.default_lead_changed");
        service
            .send_camp_message(
                &mut database,
                &user_envelope(
                    "message-before-delete",
                    Some(&camp_id),
                    SendCampMessageCommand {
                        camp_id: camp_id.clone(),
                        body: "仅保存历史".to_string(),
                        address: MessageAddressSpec::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .expect("ordinary message should persist");
        service
            .create_task(
                &mut database,
                &user_envelope(
                    "task-before-delete",
                    Some(&camp_id),
                    CreateTaskCommand {
                        camp_id: camp_id.clone(),
                        title: "随 Camp 删除".to_string(),
                        objective: "验证从属 Task 不残留".to_string(),
                        acceptance_criteria: Vec::new(),
                        assignee_agent_id: "agent-muwa".to_string(),
                        source_message_id: None,
                        origin_task_id: None,
                        dedup_key: Some("delete-cascade-task".to_string()),
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
    fn camp_delete_reports_running_work_without_removing_any_rows() {
        let (mut database, directory) = test_database();
        configure_test_runtime(&database, &["agent-luoke"]);
        let service = CollaborationService::default();
        let created = service
            .create_camp_from_first_message(
                &mut database,
                &user_envelope(
                    "camp-with-running-work",
                    None,
                    CreateCampFromFirstMessageCommand {
                        project_path: directory.join("workspace").to_string_lossy().to_string(),
                        repository: None,
                        body: "开始执行".to_string(),
                        purpose: "执行".to_string(),
                        expected_output: "结果".to_string(),
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

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn ordinary_camp_message_does_not_create_execution_objects() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent-muwa"]);
        let send = user_envelope(
            "send-plain-message",
            Some(&camp_id),
            SendCampMessageCommand {
                camp_id: camp_id.clone(),
                body: "只记录这条公共消息。".to_string(),
                address: MessageAddressSpec::Default,
                reply_to_camp_message_id: None,
                execution: None,
            },
        );
        let result = service
            .send_camp_message(&mut database, &send)
            .expect("message should be stored");

        assert_eq!(result.result.status, CommandResultStatus::Applied);
        assert_eq!(row_count(&database, "camp_message"), 1);
        assert_eq!(row_count(&database, "camp_turn"), 0);
        assert_eq!(row_count(&database, "agent_run"), 0);
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn one_fanout_trigger_creates_one_turn_and_independent_frozen_runs() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id = create_camp_with_members(
            &service,
            &mut database,
            &directory,
            &["agent-muwa", "agent-luoke"],
        );
        let plain = user_envelope(
            "message-before-run",
            Some(&camp_id),
            SendCampMessageCommand {
                camp_id: camp_id.clone(),
                body: "公共前置信息".to_string(),
                address: MessageAddressSpec::Default,
                reply_to_camp_message_id: None,
                execution: None,
            },
        );
        service
            .send_camp_message(&mut database, &plain)
            .expect("prefix message should be stored");

        let fanout = user_envelope(
            "fanout-message",
            Some(&camp_id),
            SendCampMessageCommand {
                camp_id: camp_id.clone(),
                body: "请分别给出方案。".to_string(),
                address: MessageAddressSpec::Explicit {
                    agent_profile_ids: vec![
                        "agent-muwa".to_string(),
                        "agent-luoke".to_string(),
                        "agent-muwa".to_string(),
                    ],
                },
                reply_to_camp_message_id: None,
                execution: Some(ExecutionRequest {
                    task_id: None,
                    purpose: "独立分析".to_string(),
                    expected_output: "公开结论".to_string(),
                    completion_role: "required".to_string(),
                }),
            },
        );
        let first = service
            .send_camp_message(&mut database, &fanout)
            .expect("fanout should be created");
        let replay = service
            .send_camp_message(&mut database, &fanout)
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
                  AND initial_conversation_context_through_sequence = 2
                "#,
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(frozen_runs, 2);
        let materialized_messages: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM conversation_message WHERE source_camp_message_id IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(materialized_messages, 4);
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn task_execution_intake_is_atomic_frozen_and_idempotent() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent-muwa"]);
        let project_path = directory.join("workspace").to_string_lossy().to_string();
        let envelope = user_envelope(
            "create-and-queue-task",
            Some(&camp_id),
            CreateTaskAndQueueExecutionCommand {
                camp_id: camp_id.clone(),
                title: "Implement the intake flow".to_string(),
                objective: "Create the Task and its first execution atomically".to_string(),
                acceptance_criteria: vec![AcceptanceCriterionInput {
                    id: "criterion-1".to_string(),
                    text: "Exactly one queued AgentRun exists".to_string(),
                }],
                assignee_agent_id: "agent-muwa".to_string(),
                dedup_key: Some("atomic-task-intake".to_string()),
                purpose: "Implement and verify the requested change".to_string(),
                expected_output: "A tested implementation".to_string(),
                workspace: AgentRunWorkspace {
                    execution_root: project_path.clone(),
                    access: "write".to_string(),
                    isolation: "shared".to_string(),
                    repository_scope_id: None,
                    base_git_commit: None,
                },
            },
        );

        let first = service
            .create_task_and_queue_execution(&mut database, &envelope)
            .expect("combined intake should be accepted");
        let replay = service
            .create_task_and_queue_execution(&mut database, &envelope)
            .expect("same command should replay");

        assert_eq!(first.result.status, CommandResultStatus::Accepted);
        assert_eq!(first.result.code, "task.execution_queued");
        assert!(replay.replayed);
        assert_eq!(first.result, replay.result);
        let mut conflicting = envelope.clone();
        conflicting.payload.workspace.execution_root = directory
            .join("different-workspace")
            .to_string_lossy()
            .to_string();
        let conflict = service
            .create_task_and_queue_execution(&mut database, &conflicting)
            .expect_err("same command ID cannot hide a changed Workspace snapshot");
        assert!(matches!(
            conflict.downcast_ref::<CommandGatewayError>(),
            Some(CommandGatewayError::IdempotencyConflict { command_id })
                if command_id == "create-and-queue-task"
        ));
        assert_eq!(row_count(&database, "task"), 1);
        assert_eq!(row_count(&database, "camp_message"), 1);
        assert_eq!(row_count(&database, "camp_turn"), 1);
        assert_eq!(row_count(&database, "agent_run"), 1);
        let (task_status, run_status, workspace_json, effective_config_json): (
            String,
            String,
            String,
            String,
        ) = database
            .connection()
            .query_row(
                r#"
                SELECT task.status, agent_run.status,
                       agent_run.workspace_json, agent_run.effective_config_json
                FROM task
                JOIN agent_run ON agent_run.task_id = task.id
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(task_status, "pending");
        assert_eq!(run_status, "queued");
        let workspace: AgentRunWorkspace = serde_json::from_str(&workspace_json).unwrap();
        assert_eq!(workspace.execution_root, project_path);
        assert!(effective_config_json.contains("configDigest"));

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn rejected_task_execution_intake_writes_no_partial_domain_objects() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent-muwa"]);
        let envelope = user_envelope(
            "reject-unavailable-assignee",
            Some(&camp_id),
            CreateTaskAndQueueExecutionCommand {
                camp_id: camp_id.clone(),
                title: "Must not persist".to_string(),
                objective: "Reject this intake atomically".to_string(),
                acceptance_criteria: Vec::new(),
                assignee_agent_id: "agent-missing".to_string(),
                dedup_key: None,
                purpose: "Exercise rejection".to_string(),
                expected_output: "No domain objects".to_string(),
                workspace: AgentRunWorkspace {
                    execution_root: directory.join("workspace").to_string_lossy().to_string(),
                    access: "write".to_string(),
                    isolation: "shared".to_string(),
                    repository_scope_id: None,
                    base_git_commit: None,
                },
            },
        );

        let result = service
            .create_task_and_queue_execution(&mut database, &envelope)
            .expect("domain rejection should be durable");

        assert_eq!(result.result.status, CommandResultStatus::Rejected);
        assert_eq!(result.result.code, "task.assignee_unavailable");
        assert_eq!(row_count(&database, "task"), 0);
        assert_eq!(row_count(&database, "camp_message"), 0);
        assert_eq!(row_count(&database, "camp_turn"), 0);
        assert_eq!(row_count(&database, "agent_run"), 0);
        let command_results: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM event_log WHERE command_id = 'reject-unavailable-assignee'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(command_results, 1);

        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn task_dependencies_are_flat_and_cycles_are_rejected_durably() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id =
            create_camp_with_members(&service, &mut database, &directory, &["agent-muwa"]);
        let mut task_ids = Vec::new();
        for index in 0..2 {
            let create = user_envelope(
                &format!("create-task-{index}"),
                Some(&camp_id),
                CreateTaskCommand {
                    camp_id: camp_id.clone(),
                    title: format!("Task {index}"),
                    objective: format!("Complete unit {index}"),
                    acceptance_criteria: vec![AcceptanceCriterionInput {
                        id: "criterion-1".to_string(),
                        text: "Has evidence".to_string(),
                    }],
                    assignee_agent_id: "agent-muwa".to_string(),
                    source_message_id: None,
                    origin_task_id: None,
                    dedup_key: Some(format!("task-{index}")),
                },
            );
            let result = service
                .create_task(&mut database, &create)
                .expect("Task should be created");
            task_ids.push(
                result.result.payload["taskId"]
                    .as_str()
                    .unwrap()
                    .to_string(),
            );
        }
        let first_edge = user_envelope(
            "dependency-b-a",
            Some(&camp_id),
            AddTaskDependencyCommand {
                task_id: task_ids[1].clone(),
                depends_on_task_id: task_ids[0].clone(),
                expected_task_version: 1,
            },
        );
        service
            .add_task_dependency(&mut database, &first_edge)
            .expect("first dependency should apply");
        let cycle = user_envelope(
            "dependency-a-b",
            Some(&camp_id),
            AddTaskDependencyCommand {
                task_id: task_ids[0].clone(),
                depends_on_task_id: task_ids[1].clone(),
                expected_task_version: 1,
            },
        );
        let rejected = service
            .add_task_dependency(&mut database, &cycle)
            .expect("cycle should produce a durable rejection");

        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(rejected.result.code, "task_dependency.cycle");
        assert_eq!(row_count(&database, "task_dependency"), 1);
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }

    #[test]
    fn inbox_delivery_is_atomic_and_reuses_one_conversation_message() {
        let (mut database, directory) = test_database();
        let service = CollaborationService::default();
        let camp_id = create_camp_with_members(
            &service,
            &mut database,
            &directory,
            &["agent-muwa", "agent-luoke"],
        );
        let trigger = user_envelope(
            "start-sender-run",
            Some(&camp_id),
            SendCampMessageCommand {
                camp_id: camp_id.clone(),
                body: "沐瓦先处理。".to_string(),
                address: MessageAddressSpec::Explicit {
                    agent_profile_ids: vec!["agent-muwa".to_string()],
                },
                reply_to_camp_message_id: None,
                execution: Some(ExecutionRequest {
                    task_id: None,
                    purpose: "准备协作请求".to_string(),
                    expected_output: "发送定向消息".to_string(),
                    completion_role: "required".to_string(),
                }),
            },
        );
        let trigger_result = service
            .send_camp_message(&mut database, &trigger)
            .expect("sender Run should be queued");
        let sender_run_id = trigger_result.result.payload["agentRunIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let (source_conversation_id, source_camp_turn_id): (String, String) = database
            .connection()
            .query_row(
                "SELECT conversation_id, camp_turn_id FROM agent_run WHERE id = ?1",
                [&sender_run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
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
                params![sender_run_id, now],
            )
            .unwrap();

        let send = CommandEnvelope {
            command_id: "send-inbox".to_string(),
            actor: ActorRef::Agent {
                agent_profile_id: "agent-muwa".to_string(),
                source_agent_run_id: sender_run_id.clone(),
            },
            camp_id: Some(camp_id.clone()),
            expected_versions: Vec::new(),
            execution_epoch: Some(1),
            payload: SendInboxMessageCommand {
                camp_id: camp_id.clone(),
                recipient_agent_id: "agent-luoke".to_string(),
                body: "请检查这个思路。".to_string(),
                references: Vec::new(),
                source_conversation_id,
                source_camp_turn_id: Some(source_camp_turn_id),
                target_agent_run_id: None,
                in_reply_to_message_id: None,
                correlation_id: "review-chain-1".to_string(),
                batch_id: None,
                retry_of_message_id: None,
                idempotency_key: "sender-run-review-1".to_string(),
                expires_at: None,
            },
        };
        let queued = service
            .send_inbox_message(&mut database, &send)
            .expect("Inbox message should queue");
        let inbox_message_id = queued.result.payload["inboxMessageId"]
            .as_str()
            .unwrap()
            .to_string();
        let leased = service
            .acquire_inbox_delivery_lease(&mut database, "inbox-dispatcher", 30)
            .expect("Inbox lease should be acquired");
        assert_eq!(leased.as_deref(), Some(inbox_message_id.as_str()));
        let deliver = CommandEnvelope {
            command_id: format!("deliver-inbox-{inbox_message_id}"),
            actor: ActorRef::System {
                component_id: "inbox-dispatcher".to_string(),
            },
            camp_id: Some(camp_id),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload: DeliverInboxMessageCommand {
                inbox_message_id: inbox_message_id.clone(),
            },
        };
        let delivered = service
            .deliver_inbox_message(&mut database, &deliver)
            .expect("Inbox message should deliver");
        let replay = service
            .deliver_inbox_message(&mut database, &deliver)
            .expect("delivery retry should replay");

        assert_eq!(delivered.result.status, CommandResultStatus::Applied);
        assert!(replay.replayed);
        let delivered_count: i64 = database
            .connection()
            .query_row(
                r#"
                SELECT COUNT(*) FROM conversation_message
                WHERE source_inbox_message_id = ?1
                "#,
                [&inbox_message_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(delivered_count, 1);
        let delivery_ack: i64 = database
            .connection()
            .query_row(
                r#"
                SELECT COUNT(*) FROM inbox_message
                WHERE id = ?1 AND delivered_at IS NOT NULL AND recipient_message_id IS NOT NULL
                "#,
                [&inbox_message_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(delivery_ack, 1);
        drop(database);
        std::fs::remove_dir_all(directory).expect("temporary database should be removable");
    }
}
