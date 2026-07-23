use std::{collections::HashSet, fmt, sync::OnceLock};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig, resolve_frozen_runtime},
    collaboration::{
        CollaborationService, CreateTaskCommand, TaskAssigneeFilter, TaskAssigneeUpdate,
        TaskListPage, TaskListQuery, TaskStatus, UpdateTaskCommand, append_domain_event,
        build_effective_config, entity_belongs_to_camp,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    db::Database,
};

pub const TEAM_POST_MESSAGE_TOOL_NAME: &str = "team.post_message";
pub const TEAM_CREATE_TASK_TOOL_NAME: &str = "team.create_task";
pub const TEAM_UPDATE_TASK_TOOL_NAME: &str = "team.update_task";
pub const TEAM_LIST_TASKS_TOOL_NAME: &str = "team.list_tasks";
pub const TEAM_TOOL_NAMES: [&str; 4] = [
    TEAM_POST_MESSAGE_TOOL_NAME,
    TEAM_CREATE_TASK_TOOL_NAME,
    TEAM_UPDATE_TASK_TOOL_NAME,
    TEAM_LIST_TASKS_TOOL_NAME,
];
pub const TEAM_POST_MESSAGE_CAPABILITY: &str = "team_tool.post_message";
pub const TEAM_POST_MESSAGE_MAX_BODY_BYTES: usize = 32 * 1024;
pub const TEAM_POST_MESSAGE_MAX_REFERENCES: usize = 32;
pub const MAX_A2A_DEPTH: i64 = 5;
pub const MAX_A2A_RUNS_PER_TURN: i64 = 16;
pub const A2A_DEPTH_WARNING_AT: i64 = 2;
pub const A2A_RUN_WARNING_AT: i64 = 12;

static TEAM_TOOL_PROCESS_SECRET: OnceLock<String> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamPostMessageInput {
    pub recipient_agent_id: String,
    pub body: String,
    #[serde(default)]
    pub references: Vec<EntityReference>,
    pub in_reply_to_message_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamCreateTaskInput {
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub assignee_agent_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum NullableInput<T> {
    #[default]
    Missing,
    Null,
    Value(T),
}

fn deserialize_nullable_input<'de, D, T>(
    deserializer: D,
) -> std::result::Result<NullableInput<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(match Option::<T>::deserialize(deserializer)? {
        Some(value) => NullableInput::Value(value),
        None => NullableInput::Null,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamUpdateTaskInput {
    pub task_id: String,
    pub expected_version: i64,
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<TaskStatus>,
    #[serde(default, deserialize_with = "deserialize_nullable_input")]
    pub assignee_agent_id: NullableInput<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamListTasksInput {
    pub statuses: Option<Vec<TaskStatus>>,
    #[serde(default, deserialize_with = "deserialize_nullable_input")]
    pub assignee_agent_id: NullableInput<String>,
    #[serde(default)]
    pub limit: usize,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPostMessageCommand {
    native_binding_id: String,
    credential_digest: String,
    runtime_tool_call_id: String,
    recipient_agent_id: String,
    body: String,
    references: Vec<EntityReference>,
    in_reply_to_message_id: Option<String>,
}

impl sealed::Sealed for TeamPostMessageCommand {}
impl DomainCommand for TeamPostMessageCommand {
    const TYPE: &'static str = "team.post_message";
}

/// The raw credential is deliberately separate from the durable domain command.
/// Command records contain only its digest, so the credential never reaches SQLite.
pub struct TeamToolInvocation {
    pub native_binding_id: String,
    pub binding_credential: String,
    pub runtime_tool_call_id: String,
    pub input: TeamPostMessageInput,
}

pub struct TeamTaskToolInvocation<T> {
    pub native_binding_id: String,
    pub binding_credential: String,
    pub runtime_tool_call_id: String,
    pub input: T,
}

#[derive(Clone)]
pub struct TeamToolBindingCredential {
    pub native_binding_id: String,
    pub native_binding_generation: i64,
    pub binding_credential: String,
    pub conversation_version: i64,
    pub adapter_installation_id: String,
    pub native_session_id: Option<String>,
    pub binding_compatibility_digest: String,
    pub binding_replaced: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeamToolInvocationError {
    pub code: String,
    pub message: String,
}

impl fmt::Display for TeamToolInvocationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for TeamToolInvocationError {}

#[derive(Debug, Default)]
pub struct TeamToolService {
    gateway: DomainCommandGateway,
}

#[derive(Debug, Clone)]
struct SenderIdentity {
    camp_id: String,
    conversation_id: String,
    agent_profile_id: String,
    agent_run_id: String,
    execution_epoch: i64,
    camp_turn_id: String,
    a2a_root_agent_run_id: Option<String>,
    a2a_depth: i64,
    workspace_json: Option<String>,
    credential_digest: String,
}

#[derive(Debug, Clone)]
struct RecipientTarget {
    conversation_id: String,
    runtime: FrozenAgentRuntimeConfig,
}

impl TeamToolService {
    pub fn input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["recipientAgentId", "body"],
            "properties": {
                "recipientAgentId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Stable AgentProfile ID of another active member in this Camp."
                },
                "body": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": TEAM_POST_MESSAGE_MAX_BODY_BYTES,
                    "description": "A private execution request for the recipient Agent."
                },
                "inReplyToMessageId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "InboxMessage ID being answered. Replies must reverse direction."
                },
                "references": {
                    "type": "array",
                    "maxItems": TEAM_POST_MESSAGE_MAX_REFERENCES,
                    "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["entityType", "entityId"],
                        "properties": {
                            "entityType": {
                                "type": "string",
                                "enum": ["task", "camp_message", "agent_run", "conversation_message"]
                            },
                            "entityId": { "type": "string", "minLength": 1 }
                        }
                    }
                }
            }
        })
    }

    pub fn create_task_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["title"],
            "properties": {
                "title": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 160,
                    "description": "Short title for a responsibility that must persist across messages or AgentRuns."
                },
                "description": {
                    "type": "string",
                    "maxLength": 20000,
                    "description": "Optional durable scope, constraints, or completion notes."
                },
                "assigneeAgentId": {
                    "type": ["string", "null"],
                    "minLength": 1,
                    "description": "Active Camp member to own the Task, or null/omitted for the shared unassigned pool."
                }
            }
        })
    }

    pub fn update_task_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["taskId", "expectedVersion"],
            "properties": {
                "taskId": {"type": "string", "minLength": 1},
                "expectedVersion": {"type": "integer", "minimum": 1},
                "title": {"type": "string", "minLength": 1, "maxLength": 160},
                "description": {"type": "string", "maxLength": 20000},
                "status": {
                    "type": "string",
                    "enum": ["pending", "in_progress", "completed", "cancelled"]
                },
                "assigneeAgentId": {
                    "type": ["string", "null"],
                    "minLength": 1,
                    "description": "Set an active Camp member, null to release, or omit to leave unchanged."
                }
            },
            "anyOf": [
                {"required": ["title"]},
                {"required": ["description"]},
                {"required": ["status"]},
                {"required": ["assigneeAgentId"]}
            ]
        })
    }

    pub fn list_tasks_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "statuses": {
                    "type": "array",
                    "minItems": 1,
                    "uniqueItems": true,
                    "items": {
                        "type": "string",
                        "enum": ["pending", "in_progress", "completed", "cancelled"]
                    }
                },
                "assigneeAgentId": {
                    "type": ["string", "null"],
                    "minLength": 1,
                    "description": "Filter by one Agent, null for unassigned only, or omit for every visible assignee."
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
                "cursor": {"type": "string", "minLength": 1}
            }
        })
    }

    /// Reserves or reuses the Native Binding and derives its Team Tool
    /// credential for this Lumen process. The credential is stable for the
    /// lifetime of a compatible Native Binding so a provider may safely reuse
    /// its stdio MCP process across AgentRuns. It changes when the Binding is
    /// replaced or after Lumen restarts. A newly reserved Binding is
    /// deliberately unusable until the Adapter attaches a concrete Native
    /// Session through `BindNativeSessionCommand`.
    pub fn prepare_binding_credential(
        &self,
        database: &mut Database,
        agent_run_id: &str,
        execution_epoch: i64,
        force_new_binding: bool,
    ) -> Result<TeamToolBindingCredential> {
        if agent_run_id.trim().is_empty() || execution_epoch <= 0 {
            return Err(invocation_error(
                "team_tool.invalid_binding_request",
                "AgentRun ID and execution epoch are required",
            ));
        }
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let binding = transaction
            .query_row(
                r#"
                SELECT conversation.camp_id, conversation.id,
                       conversation.native_binding_id,
                       conversation.native_binding_generation,
                       conversation.native_adapter_installation_id,
                       conversation.native_session_id,
                       conversation.native_binding_compatibility_digest,
                       conversation.version,
                       agent_run.runtime_adapter_kind,
                       agent_run.runtime_capabilities_json,
                       agent_run.runtime_installation_id,
                       agent_run.runtime_binding_compatibility_digest
                FROM agent_run
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                JOIN camp ON camp.id = camp_turn.camp_id
                JOIN conversation ON conversation.id = agent_run.conversation_id
                JOIN camp_member
                  ON camp_member.camp_id = camp.id
                 AND camp_member.agent_profile_id = conversation.agent_profile_id
                JOIN agent_profile ON agent_profile.id = conversation.agent_profile_id
                WHERE agent_run.id = ?1
                  AND agent_run.execution_epoch = ?2
                  AND agent_run.status = 'running'
                  AND agent_run.cancel_requested_at IS NULL
                  AND camp_turn.status = 'running'
                  AND camp_turn.cancel_requested_at IS NULL
                  AND camp.status = 'active'
                  AND camp_member.status = 'active'
                  AND camp_member.leave_requested_at IS NULL
                  AND agent_profile.profile_status = 'active'
                "#,
                params![agent_run_id, execution_epoch],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, Option<String>>(8)?,
                        row.get::<_, Option<String>>(9)?,
                        row.get::<_, Option<String>>(10)?,
                        row.get::<_, Option<String>>(11)?,
                    ))
                },
            )
            .optional()?;
        let Some((
            camp_id,
            conversation_id,
            current_binding_id,
            current_generation,
            current_installation_id,
            current_native_session_id,
            current_compatibility_digest,
            conversation_version,
            adapter_kind,
            capabilities,
            frozen_installation_id,
            frozen_compatibility_digest,
        )) = binding
        else {
            return Err(invocation_error(
                "team_tool.binding_unavailable",
                "AgentRun is not current and active",
            ));
        };
        ensure_runtime_supports_team_tool(adapter_kind.as_deref(), capabilities.as_deref())?;
        let frozen_installation_id = frozen_installation_id
            .context("Team Tool AgentRun has no frozen Runtime installation")?;
        let frozen_compatibility_digest = frozen_compatibility_digest
            .context("Team Tool AgentRun has no frozen Native Binding compatibility digest")?;

        let compatible_binding = current_binding_id.is_some()
            && current_generation >= 1
            && current_installation_id.as_deref() == Some(frozen_installation_id.as_str())
            && current_compatibility_digest.as_deref()
                == Some(frozen_compatibility_digest.as_str());
        let binding_replaced = force_new_binding || !compatible_binding;
        let binding_id = if binding_replaced {
            Uuid::new_v4().to_string()
        } else {
            current_binding_id.context("compatible Native Binding has no identity")?
        };
        let generation = if binding_replaced {
            current_generation
                .checked_add(1)
                .context("Native Binding generation overflow")?
                .max(1)
        } else {
            current_generation
        };
        let native_session_id = (!binding_replaced)
            .then_some(current_native_session_id)
            .flatten();
        let credential = binding_credential(&binding_id, generation);
        let digest = credential_digest(&credential);
        let current_secret_digest = transaction.query_row(
            "SELECT native_binding_secret_digest FROM conversation WHERE id = ?1",
            [&conversation_id],
            |row| row.get::<_, Option<String>>(0),
        )?;
        let credential_changed = current_secret_digest.as_deref() != Some(digest.as_str());
        let now = chrono::Utc::now().to_rfc3339();
        let updated = if binding_replaced {
            transaction.execute(
                r#"
                UPDATE conversation
                SET native_adapter_installation_id = ?2,
                    native_session_id = NULL,
                    native_binding_compatibility_digest = ?3,
                    native_binding_id = ?4,
                    native_binding_generation = ?5,
                    native_binding_secret_digest = ?6,
                    native_delivered_camp_message_sequence = 0,
                    native_charter_digest = NULL,
                    native_member_state_digest = NULL,
                    version = version + 1,
                    updated_at = ?7
                WHERE id = ?1 AND version = ?8
                  AND EXISTS (
                      SELECT 1 FROM agent_run
                      WHERE agent_run.id = ?9
                        AND agent_run.conversation_id = conversation.id
                        AND agent_run.execution_epoch = ?10
                        AND agent_run.status = 'running'
                        AND agent_run.cancel_requested_at IS NULL
                  )
                "#,
                params![
                    conversation_id,
                    frozen_installation_id,
                    frozen_compatibility_digest,
                    binding_id,
                    generation,
                    digest,
                    now,
                    conversation_version,
                    agent_run_id,
                    execution_epoch,
                ],
            )?
        } else if credential_changed {
            transaction.execute(
                r#"
                UPDATE conversation
                SET native_binding_secret_digest = ?2,
                    version = version + 1,
                    updated_at = ?3
                WHERE id = ?1 AND version = ?4
                  AND native_binding_id = ?5
                  AND native_binding_generation = ?6
                  AND EXISTS (
                      SELECT 1 FROM agent_run
                      WHERE agent_run.id = ?7
                        AND agent_run.conversation_id = conversation.id
                        AND agent_run.execution_epoch = ?8
                        AND agent_run.status = 'running'
                        AND agent_run.cancel_requested_at IS NULL
                  )
                "#,
                params![
                    conversation_id,
                    digest,
                    now,
                    conversation_version,
                    binding_id,
                    generation,
                    agent_run_id,
                    execution_epoch,
                ],
            )?
        } else {
            1
        };
        if updated != 1 {
            return Err(invocation_error(
                "team_tool.binding_fenced",
                "Native Binding changed while its Team Tool credential was prepared",
            ));
        }
        if binding_replaced || credential_changed {
            append_domain_event(
                &transaction,
                if binding_replaced {
                    "team_tool.binding_credential_issued"
                } else {
                    "team_tool.binding_credential_refreshed"
                },
                Some(&camp_id),
                Some(("conversation", &conversation_id)),
                &ActorRef::System {
                    component_id: "team-tool-credential-issuer".to_string(),
                },
                None,
                &json!({
                    "agentRunId": agent_run_id,
                    "executionEpoch": execution_epoch,
                    "nativeBindingId": binding_id,
                    "nativeBindingGeneration": generation,
                    "bindingReplaced": binding_replaced,
                    "credentialDigest": digest,
                }),
            )?;
        }
        transaction.commit()?;
        Ok(TeamToolBindingCredential {
            native_binding_id: binding_id,
            native_binding_generation: generation,
            binding_credential: credential,
            conversation_version: if binding_replaced || credential_changed {
                conversation_version + 1
            } else {
                conversation_version
            },
            adapter_installation_id: frozen_installation_id,
            native_session_id,
            binding_compatibility_digest: frozen_compatibility_digest,
            binding_replaced,
        })
    }

    /// Returns the stable credential for the current Native Binding.
    /// Adapter launchers use `prepare_binding_credential` directly when a
    /// failed Resume must reserve a replacement Binding before starting
    /// another Native Session.
    pub fn issue_binding_credential(
        &self,
        database: &mut Database,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<TeamToolBindingCredential> {
        self.prepare_binding_credential(database, agent_run_id, execution_epoch, false)
    }

    pub fn post_message(
        &self,
        database: &mut Database,
        invocation: &TeamToolInvocation,
    ) -> Result<CommandExecution> {
        validate_invocation(invocation)?;
        let supplied_credential_digest = credential_digest(&invocation.binding_credential);
        // Authenticate before looking up a command record. A Bridge credential
        // identifies one current Native Binding; Core resolves the unique
        // active AgentRun and execution epoch at call time.
        let sender = resolve_sender_identity(
            database.connection(),
            &invocation.native_binding_id,
            &supplied_credential_digest,
            Some("inbox.send"),
        )?;
        let command = TeamPostMessageCommand {
            native_binding_id: invocation.native_binding_id.clone(),
            credential_digest: supplied_credential_digest.clone(),
            runtime_tool_call_id: invocation.runtime_tool_call_id.clone(),
            recipient_agent_id: invocation.input.recipient_agent_id.clone(),
            body: invocation.input.body.clone(),
            references: invocation.input.references.clone(),
            in_reply_to_message_id: invocation.input.in_reply_to_message_id.clone(),
        };
        let command_id = team_command_id(
            &invocation.native_binding_id,
            &supplied_credential_digest,
            &invocation.runtime_tool_call_id,
        )?;
        let envelope = CommandEnvelope {
            command_id,
            actor: ActorRef::Agent {
                agent_profile_id: sender.agent_profile_id.clone(),
                source_agent_run_id: sender.agent_run_id.clone(),
            },
            camp_id: Some(sender.camp_id.clone()),
            expected_versions: Vec::new(),
            execution_epoch: Some(sender.execution_epoch),
            payload: command,
        };

        self.gateway.execute(database, &envelope, |transaction| {
            let current = match resolve_sender_identity_by_digest(
                transaction,
                &envelope.payload.native_binding_id,
                &envelope.payload.credential_digest,
                Some("inbox.send"),
            ) {
                Ok(current) => current,
                Err(error) if error.downcast_ref::<TeamToolInvocationError>().is_some() => {
                    return Ok(rejected(
                        "team_tool.binding_fenced",
                        "Native Binding, AgentRun, or execution epoch is no longer current",
                    ));
                }
                Err(error) => return Err(error),
            };
            if current.agent_run_id != sender.agent_run_id
                || current.execution_epoch != sender.execution_epoch
                || current.agent_profile_id != sender.agent_profile_id
                || current.camp_id != sender.camp_id
                || current.credential_digest != sender.credential_digest
            {
                return Ok(rejected(
                    "team_tool.binding_fenced",
                    "Native Binding changed before the Team Tool transaction",
                ));
            }
            if envelope.camp_id.as_deref() != Some(current.camp_id.as_str()) {
                return Ok(rejected(
                    "team_tool.camp_mismatch",
                    "Team Tool invocation is outside its resolved Camp",
                ));
            }
            if current.agent_profile_id == envelope.payload.recipient_agent_id {
                return Ok(rejected(
                    "team_tool.self_send",
                    "team.post_message must target another Camp member",
                ));
            }
            if current.a2a_depth >= MAX_A2A_DEPTH {
                return Ok(rejected(
                    "team_tool.a2a_depth_exhausted",
                    "This A2A chain has reached the maximum of five hops",
                ));
            }
            let a2a_count: i64 = transaction.query_row(
                "SELECT COUNT(*) FROM agent_run WHERE camp_turn_id = ?1 AND invocation_kind = 'a2a'",
                [&current.camp_turn_id],
                |row| row.get(0),
            )?;
            if a2a_count >= MAX_A2A_RUNS_PER_TURN {
                return Ok(rejected(
                    "team_tool.a2a_turn_quota_exhausted",
                    "This CampTurn has reached the maximum of sixteen A2A AgentRuns",
                ));
            }
            let recipient = match resolve_recipient(
                transaction,
                &current.camp_id,
                &envelope.payload.recipient_agent_id,
            )? {
                Ok(recipient) => recipient,
                Err(rejection) => return Ok(rejection),
            };
            let (correlation_id, reply_id) = match resolve_reply(
                transaction,
                &current,
                &envelope.payload.recipient_agent_id,
                envelope.payload.in_reply_to_message_id.as_deref(),
            )? {
                Ok(reply) => reply,
                Err(rejection) => return Ok(rejection),
            };
            for reference in &envelope.payload.references {
                if !matches!(
                    reference.entity_type.as_str(),
                    "task" | "camp_message" | "agent_run" | "conversation_message"
                ) || !entity_belongs_to_camp(
                    transaction,
                    &reference.entity_type,
                    &reference.entity_id,
                    &current.camp_id,
                )? {
                    return Ok(rejected(
                        "team_tool.invalid_reference",
                        "Reference is unsupported or outside the current Camp",
                    ));
                }
            }

            let target_effective_config = build_effective_config(
                transaction,
                &recipient.conversation_id,
                &envelope.payload.recipient_agent_id,
                &recipient.runtime,
            )?;
            let now = chrono::Utc::now().to_rfc3339();
            let inbox_message_id = Uuid::new_v4().to_string();
            let recipient_message_id = Uuid::new_v4().to_string();
            let target_agent_run_id = Uuid::new_v4().to_string();
            let target_depth = current.a2a_depth + 1;
            let root_run_id = current
                .a2a_root_agent_run_id
                .clone()
                .unwrap_or_else(|| current.agent_run_id.clone());
            let inbox_idempotency_key = format!("team:{}", envelope.command_id);
            let responsibility_key = format!("a2a/{inbox_message_id}");
            let recipient_sequence: i64 = transaction.query_row(
                "SELECT last_message_sequence + 1 FROM conversation WHERE id = ?1",
                [&recipient.conversation_id],
                |row| row.get(0),
            )?;
            let camp_sequence: i64 = transaction.query_row(
                "SELECT last_message_sequence FROM camp WHERE id = ?1",
                [&current.camp_id],
                |row| row.get(0),
            )?;

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
                    ?7, ?8, ?9, ?10, NULL,
                    ?11, ?12, NULL, NULL, ?13,
                    NULL, NULL, 1, ?14,
                    NULL, NULL, NULL, NULL, NULL, ?14, ?14
                )
                "#,
                params![
                    inbox_message_id,
                    current.camp_id,
                    current.agent_profile_id,
                    envelope.payload.recipient_agent_id,
                    envelope.payload.body,
                    serde_json::to_string(&envelope.payload.references)?,
                    current.conversation_id,
                    current.camp_turn_id,
                    current.agent_run_id,
                    recipient.conversation_id,
                    reply_id,
                    correlation_id,
                    inbox_idempotency_key,
                    now,
                ],
            )?;
            transaction.execute(
                r#"
                INSERT INTO conversation_message(
                    id, conversation_id, sequence,
                    author_type, author_id, source_agent_run_id, body,
                    source_camp_message_id, source_inbox_message_id,
                    camp_turn_id, agent_run_id, created_at
                ) VALUES (?1, ?2, ?3, 'agent', ?4, ?5, ?6, NULL, ?7, ?8, NULL, ?9)
                "#,
                params![
                    recipient_message_id,
                    recipient.conversation_id,
                    recipient_sequence,
                    current.agent_profile_id,
                    current.agent_run_id,
                    envelope.payload.body,
                    inbox_message_id,
                    current.camp_turn_id,
                    now,
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
                params![recipient.conversation_id, recipient_sequence, now],
            )?;
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
                    created_at, started_at, ended_at, updated_at,
                    invocation_kind, a2a_parent_agent_run_id,
                    a2a_root_agent_run_id, a2a_depth
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                    ?9, 0, NULL, 'initial', ?10, ?11, 'required',
                    ?12, ?13,
                    ?14, ?15, ?16, ?17, ?18, ?19,
                    ?20, ?21, ?22, ?23, ?24, ?25,
                    'queued', NULL, NULL, ?26, 0,
                    NULL, NULL, 0, NULL,
                    0, NULL, NULL, NULL, NULL, NULL, 1,
                    ?6, NULL, NULL, ?6,
                    'a2a', ?27, ?28, ?29
                )
                "#,
                params![
                    target_agent_run_id,
                    current.camp_turn_id,
                    recipient.conversation_id,
                    Option::<String>::None,
                    recipient_message_id,
                    now,
                    camp_sequence,
                    recipient_sequence,
                    responsibility_key,
                    format!("Handle A2A request from {}", current.agent_profile_id),
                    "Complete the requested work; explicitly call team.post_message if another Agent must continue.",
                    serde_json::to_string(&target_effective_config)?,
                    current.workspace_json,
                    recipient.runtime.adapter_kind.as_str(),
                    recipient.runtime.installation_id,
                    recipient.runtime.executable_path,
                    recipient.runtime.auth_scope,
                    recipient.runtime.reported_version,
                    recipient.runtime.executable_fingerprint,
                    serde_json::to_string(&recipient.runtime.capabilities)?,
                    serde_json::to_string(&recipient.runtime.model)?,
                    serde_json::to_string(&recipient.runtime.permissions)?,
                    recipient.runtime.binding_compatibility_digest,
                    recipient.runtime.host_config_digest,
                    recipient.runtime.protocol_version,
                    format!("{}:{}", envelope.command_id, envelope.payload.recipient_agent_id),
                    current.agent_run_id,
                    root_run_id,
                    target_depth,
                ],
            )?;
            let linked_message = transaction.execute(
                "UPDATE conversation_message SET agent_run_id = ?2 WHERE id = ?1 AND agent_run_id IS NULL",
                params![recipient_message_id, target_agent_run_id],
            )?;
            if linked_message != 1 {
                anyhow::bail!("atomic Team Tool trigger message link was lost");
            }
            let touched_turn = transaction.execute(
                r#"
                UPDATE camp_turn
                SET version = version + 1,
                    updated_at = ?2
                WHERE id = ?1
                  AND status = 'running'
                  AND cancel_requested_at IS NULL
                "#,
                params![current.camp_turn_id, now],
            )?;
            if touched_turn != 1 {
                anyhow::bail!("CampTurn changed before the A2A responsibility was attached");
            }
            let acknowledged = transaction.execute(
                r#"
                UPDATE inbox_message
                SET target_agent_run_id = ?2,
                    recipient_message_id = ?3,
                    delivered_at = ?4,
                    updated_at = ?4
                WHERE id = ?1
                  AND target_agent_run_id IS NULL
                  AND recipient_message_id IS NULL
                  AND delivered_at IS NULL
                "#,
                params![
                    inbox_message_id,
                    target_agent_run_id,
                    recipient_message_id,
                    now,
                ],
            )?;
            if acknowledged != 1 {
                anyhow::bail!("atomic Team Tool delivery acknowledgement was lost");
            }

            let actor = ActorRef::Agent {
                agent_profile_id: current.agent_profile_id.clone(),
                source_agent_run_id: current.agent_run_id.clone(),
            };
            append_domain_event(
                transaction,
                "inbox_message.delivered",
                Some(&current.camp_id),
                Some(("inbox_message", &inbox_message_id)),
                &actor,
                Some(current.execution_epoch),
                &json!({
                    "recipientMessageId": recipient_message_id,
                    "targetAgentRunId": target_agent_run_id,
                    "deliveryMode": "atomic_local",
                }),
            )?;
            append_domain_event(
                transaction,
                "agent_run.queued",
                Some(&current.camp_id),
                Some(("agent_run", &target_agent_run_id)),
                &actor,
                Some(current.execution_epoch),
                &json!({
                    "campTurnId": current.camp_turn_id,
                    "taskId": null,
                    "invocationKind": "a2a",
                    "sourceInboxMessageId": inbox_message_id,
                    "a2aParentAgentRunId": current.agent_run_id,
                    "a2aRootAgentRunId": root_run_id,
                    "a2aDepth": target_depth,
                }),
            )?;

            Ok(CommandHandlerResult::accepted(
                "team_tool.message_queued",
                json!({
                    "inboxMessageId": inbox_message_id,
                    "targetAgentRunId": target_agent_run_id,
                    "correlationId": correlation_id,
                    "a2aDepth": target_depth,
                    "remainingA2aHops": MAX_A2A_DEPTH - target_depth,
                    "remainingTurnA2aRuns": MAX_A2A_RUNS_PER_TURN - (a2a_count + 1),
                    "depthWarning": (target_depth >= A2A_DEPTH_WARNING_AT).then_some(true),
                    "turnQuotaWarning": (a2a_count + 1 >= A2A_RUN_WARNING_AT).then_some(true),
                    "status": "queued",
                }),
                Some(EntityReference {
                    entity_type: "agent_run".to_string(),
                    entity_id: target_agent_run_id,
                }),
            ))
        })
    }

    pub fn create_task(
        &self,
        database: &mut Database,
        invocation: &TeamTaskToolInvocation<TeamCreateTaskInput>,
    ) -> Result<CommandExecution> {
        validate_task_invocation_identity(invocation)?;
        let supplied_credential_digest = credential_digest(&invocation.binding_credential);
        let sender = resolve_sender_identity(
            database.connection(),
            &invocation.native_binding_id,
            &supplied_credential_digest,
            None,
        )?;
        let envelope = CommandEnvelope {
            command_id: team_command_id(
                &invocation.native_binding_id,
                &supplied_credential_digest,
                &invocation.runtime_tool_call_id,
            )?,
            actor: ActorRef::Agent {
                agent_profile_id: sender.agent_profile_id,
                source_agent_run_id: sender.agent_run_id,
            },
            camp_id: Some(sender.camp_id.clone()),
            expected_versions: Vec::new(),
            execution_epoch: Some(sender.execution_epoch),
            payload: CreateTaskCommand {
                camp_id: sender.camp_id,
                title: invocation.input.title.clone(),
                description: invocation.input.description.clone(),
                assignee_agent_id: invocation.input.assignee_agent_id.clone(),
            },
        };
        CollaborationService::default().create_task(database, &envelope)
    }

    pub fn update_task(
        &self,
        database: &mut Database,
        invocation: &TeamTaskToolInvocation<TeamUpdateTaskInput>,
    ) -> Result<CommandExecution> {
        validate_task_invocation_identity(invocation)?;
        let supplied_credential_digest = credential_digest(&invocation.binding_credential);
        let sender = resolve_sender_identity(
            database.connection(),
            &invocation.native_binding_id,
            &supplied_credential_digest,
            None,
        )?;
        let assignee = match &invocation.input.assignee_agent_id {
            NullableInput::Missing => TaskAssigneeUpdate::Unchanged,
            NullableInput::Null => TaskAssigneeUpdate::Clear,
            NullableInput::Value(agent_profile_id) => TaskAssigneeUpdate::Assign {
                agent_profile_id: agent_profile_id.clone(),
            },
        };
        let envelope = CommandEnvelope {
            command_id: team_command_id(
                &invocation.native_binding_id,
                &supplied_credential_digest,
                &invocation.runtime_tool_call_id,
            )?,
            actor: ActorRef::Agent {
                agent_profile_id: sender.agent_profile_id,
                source_agent_run_id: sender.agent_run_id,
            },
            camp_id: Some(sender.camp_id),
            expected_versions: Vec::new(),
            execution_epoch: Some(sender.execution_epoch),
            payload: UpdateTaskCommand {
                task_id: invocation.input.task_id.clone(),
                expected_version: invocation.input.expected_version,
                title: invocation.input.title.clone(),
                description: invocation.input.description.clone(),
                status: invocation.input.status,
                assignee,
            },
        };
        CollaborationService::default().update_task(database, &envelope)
    }

    pub fn list_tasks(
        &self,
        database: &Database,
        invocation: &TeamTaskToolInvocation<TeamListTasksInput>,
    ) -> Result<TaskListPage> {
        validate_task_invocation_identity(invocation)?;
        let supplied_credential_digest = credential_digest(&invocation.binding_credential);
        let sender = resolve_sender_identity(
            database.connection(),
            &invocation.native_binding_id,
            &supplied_credential_digest,
            None,
        )?;
        let assignee = match &invocation.input.assignee_agent_id {
            NullableInput::Missing => TaskAssigneeFilter::Any,
            NullableInput::Null => TaskAssigneeFilter::Unassigned,
            NullableInput::Value(agent_profile_id) => TaskAssigneeFilter::Agent {
                agent_profile_id: agent_profile_id.clone(),
            },
        };
        CollaborationService::default().query_visible_tasks(
            database,
            &sender.camp_id,
            &ActorRef::Agent {
                agent_profile_id: sender.agent_profile_id,
                source_agent_run_id: sender.agent_run_id,
            },
            Some(sender.execution_epoch),
            &TaskListQuery {
                statuses: invocation.input.statuses.clone(),
                assignee,
                limit: invocation.input.limit,
                cursor: invocation.input.cursor.clone(),
            },
        )
    }
}

fn validate_invocation(invocation: &TeamToolInvocation) -> Result<()> {
    validate_invocation_identity(
        &invocation.native_binding_id,
        &invocation.binding_credential,
        &invocation.runtime_tool_call_id,
    )?;
    if invocation.input.recipient_agent_id.trim().is_empty()
        || invocation.input.body.trim().is_empty()
    {
        return Err(invocation_error(
            "team_tool.invalid_input",
            "Recipient Agent ID and body are required",
        ));
    }
    if invocation.input.body.len() > TEAM_POST_MESSAGE_MAX_BODY_BYTES {
        return Err(invocation_error(
            "team_tool.body_too_large",
            "Message body exceeds the 32 KiB Team Tool limit",
        ));
    }
    if invocation.input.references.len() > TEAM_POST_MESSAGE_MAX_REFERENCES {
        return Err(invocation_error(
            "team_tool.too_many_references",
            "Team Tool accepts at most 32 references",
        ));
    }
    if invocation
        .input
        .in_reply_to_message_id
        .as_deref()
        .is_some_and(|value| value.trim().is_empty())
    {
        return Err(invocation_error(
            "team_tool.invalid_reply",
            "inReplyToMessageId must not be empty",
        ));
    }
    let mut references = HashSet::new();
    for reference in &invocation.input.references {
        if reference.entity_type.trim().is_empty()
            || reference.entity_id.trim().is_empty()
            || !references.insert((&reference.entity_type, &reference.entity_id))
        {
            return Err(invocation_error(
                "team_tool.invalid_reference",
                "References require unique non-empty type and ID pairs",
            ));
        }
    }
    Ok(())
}

fn validate_task_invocation_identity<T>(invocation: &TeamTaskToolInvocation<T>) -> Result<()> {
    validate_invocation_identity(
        &invocation.native_binding_id,
        &invocation.binding_credential,
        &invocation.runtime_tool_call_id,
    )
}

fn validate_invocation_identity(
    native_binding_id: &str,
    binding_credential: &str,
    runtime_tool_call_id: &str,
) -> Result<()> {
    if native_binding_id.trim().is_empty()
        || binding_credential.trim().is_empty()
        || runtime_tool_call_id.trim().is_empty()
    {
        return Err(invocation_error(
            "team_tool.invalid_invocation",
            "Binding identity, credential, and Runtime Tool Call ID are required",
        ));
    }
    Uuid::parse_str(native_binding_id).map_err(|_| {
        invocation_error(
            "team_tool.invalid_binding",
            "Native Binding ID must be a UUID",
        )
    })?;
    if runtime_tool_call_id.len() > 512 {
        return Err(invocation_error(
            "team_tool.invalid_tool_call_id",
            "Runtime Tool Call ID exceeds 512 bytes",
        ));
    }
    Ok(())
}

fn resolve_sender_identity(
    connection: &Connection,
    native_binding_id: &str,
    credential_digest: &str,
    required_capability: Option<&str>,
) -> Result<SenderIdentity> {
    resolve_sender_identity_by_digest(
        connection,
        native_binding_id,
        credential_digest,
        required_capability,
    )
}

fn resolve_sender_identity_by_digest(
    connection: &Connection,
    native_binding_id: &str,
    credential_digest: &str,
    required_capability: Option<&str>,
) -> Result<SenderIdentity> {
    let identity = connection
        .query_row(
            r#"
            SELECT conversation.camp_id, conversation.id,
                   conversation.agent_profile_id,
                   agent_run.id, agent_run.execution_epoch,
                   agent_run.camp_turn_id,
                   agent_run.a2a_root_agent_run_id, agent_run.a2a_depth,
                   agent_run.workspace_json,
                   agent_run.runtime_adapter_kind,
                   agent_run.runtime_capabilities_json,
                   conversation.native_binding_secret_digest,
                   agent_run.effective_config_json
            FROM conversation
            JOIN camp ON camp.id = conversation.camp_id
            JOIN camp_member
              ON camp_member.camp_id = conversation.camp_id
             AND camp_member.agent_profile_id = conversation.agent_profile_id
            JOIN agent_profile ON agent_profile.id = conversation.agent_profile_id
            JOIN agent_run ON agent_run.conversation_id = conversation.id
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE conversation.native_binding_id = ?1
              AND conversation.native_binding_secret_digest = ?2
              AND conversation.native_session_id IS NOT NULL
              AND agent_run.status = 'running'
              AND agent_run.cancel_requested_at IS NULL
              AND camp_turn.status = 'running'
              AND camp_turn.cancel_requested_at IS NULL
              AND camp.status = 'active'
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'active'
            "#,
            params![native_binding_id, credential_digest],
            |row| {
                Ok((
                    SenderIdentity {
                        camp_id: row.get(0)?,
                        conversation_id: row.get(1)?,
                        agent_profile_id: row.get(2)?,
                        agent_run_id: row.get(3)?,
                        execution_epoch: row.get(4)?,
                        camp_turn_id: row.get(5)?,
                        a2a_root_agent_run_id: row.get(6)?,
                        a2a_depth: row.get(7)?,
                        workspace_json: row.get(8)?,
                        credential_digest: row.get(11)?,
                    },
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, String>(12)?,
                ))
            },
        )
        .optional()?;
    let Some((identity, adapter_kind, capabilities, effective_config)) = identity else {
        return Err(invocation_error(
            "team_tool.binding_fenced",
            "Native Binding credential does not resolve to one current active AgentRun",
        ));
    };
    ensure_runtime_supports_team_tool(adapter_kind.as_deref(), capabilities.as_deref())?;
    if let Some(required_capability) = required_capability {
        ensure_agent_has_capability(&effective_config, required_capability)?;
    }
    Ok(identity)
}

fn resolve_recipient(
    transaction: &Transaction<'_>,
    camp_id: &str,
    recipient_agent_id: &str,
) -> Result<std::result::Result<RecipientTarget, CommandHandlerResult>> {
    let conversation_id = transaction
        .query_row(
            r#"
            SELECT conversation.id
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
            params![camp_id, recipient_agent_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(conversation_id) = conversation_id else {
        return Ok(Err(rejected(
            "team_tool.recipient_unavailable",
            "Recipient is not an active member of the sender Camp",
        )));
    };
    let runtime = match resolve_frozen_runtime(transaction, &conversation_id, recipient_agent_id)? {
        Ok(runtime) => runtime,
        Err(blocker) => {
            return Ok(Err(CommandHandlerResult::rejected(
                "team_tool.recipient_runtime_not_ready",
                json!({
                    "message": "Recipient Runtime is not ready",
                    "recipientAgentId": recipient_agent_id,
                    "blockerCode": blocker.code,
                    "detail": blocker.payload,
                }),
            )));
        }
    };
    if runtime.adapter_kind == AdapterKind::AntigravityApp
        || !runtime
            .capabilities
            .iter()
            .any(|capability| capability == TEAM_POST_MESSAGE_CAPABILITY)
    {
        return Ok(Err(CommandHandlerResult::rejected(
            "team_tool.recipient_unsupported",
            json!({
                "message": "Recipient Adapter does not support A2A Team Tool execution",
                "recipientAgentId": recipient_agent_id,
                "adapterKind": runtime.adapter_kind,
            }),
        )));
    }
    Ok(Ok(RecipientTarget {
        conversation_id,
        runtime,
    }))
}

fn resolve_reply(
    transaction: &Transaction<'_>,
    sender: &SenderIdentity,
    recipient_agent_id: &str,
    in_reply_to_message_id: Option<&str>,
) -> Result<std::result::Result<(String, Option<String>), CommandHandlerResult>> {
    let Some(reply_id) = in_reply_to_message_id else {
        return Ok(Ok((Uuid::new_v4().to_string(), None)));
    };
    let reply = transaction
        .query_row(
            r#"
            SELECT camp_id, sender_agent_id, recipient_agent_id,
                   correlation_id, delivered_at
            FROM inbox_message WHERE id = ?1
            "#,
            [reply_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((camp_id, original_sender, original_recipient, correlation_id, delivered_at)) = reply
    else {
        return Ok(Err(rejected(
            "team_tool.reply_not_found",
            "Reply target InboxMessage does not exist",
        )));
    };
    if camp_id != sender.camp_id
        || original_sender != recipient_agent_id
        || original_recipient != sender.agent_profile_id
        || delivered_at.is_none()
    {
        return Ok(Err(rejected(
            "team_tool.invalid_reply",
            "Reply must reverse a delivered InboxMessage in the same Camp",
        )));
    }
    Ok(Ok((correlation_id, Some(reply_id.to_string()))))
}

fn ensure_runtime_supports_team_tool(
    adapter_kind: Option<&str>,
    capabilities_json: Option<&str>,
) -> Result<()> {
    let Some(adapter_kind) = adapter_kind else {
        return Err(invocation_error(
            "team_tool.runtime_not_frozen",
            "AgentRun has no frozen Runtime Adapter",
        ));
    };
    let adapter_kind = adapter_kind.parse::<AdapterKind>()?;
    if adapter_kind == AdapterKind::AntigravityApp {
        return Err(invocation_error(
            "team_tool.adapter_unsupported",
            "Antigravity App's companion CLI does not support the v0.05 Team Tool",
        ));
    }
    let capabilities = capabilities_json
        .map(serde_json::from_str::<Vec<String>>)
        .transpose()
        .context("AgentRun frozen Runtime capabilities are invalid")?
        .unwrap_or_default();
    if !capabilities
        .iter()
        .any(|capability| capability == TEAM_POST_MESSAGE_CAPABILITY)
    {
        return Err(invocation_error(
            "team_tool.adapter_unsupported",
            "AgentRun frozen Runtime does not advertise Team Tool support",
        ));
    }
    Ok(())
}

fn ensure_agent_has_capability(
    effective_config_json: &str,
    required_capability: &str,
) -> Result<()> {
    let effective_config: Value = serde_json::from_str(effective_config_json)
        .context("AgentRun effective configuration is invalid")?;
    if !effective_config["capabilities"]
        .as_array()
        .is_some_and(|capabilities| {
            capabilities
                .iter()
                .any(|capability| capability.as_str() == Some(required_capability))
        })
    {
        return Err(invocation_error(
            "team_tool.capability_denied",
            &format!("AgentRun does not have the {required_capability} capability"),
        ));
    }
    Ok(())
}

fn credential_digest(credential: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(credential.as_bytes());
    format!("sha256:{:x}", digest.finalize())
}

fn binding_credential(native_binding_id: &str, native_binding_generation: i64) -> String {
    let process_secret = TEAM_TOOL_PROCESS_SECRET.get_or_init(|| {
        format!(
            "{}.{}",
            Uuid::new_v4().as_hyphenated(),
            Uuid::new_v4().as_hyphenated()
        )
    });
    let mut digest = Sha256::new();
    digest.update(b"lumen-team-binding-v1\0");
    digest.update(process_secret.as_bytes());
    digest.update([0]);
    digest.update(native_binding_id.as_bytes());
    digest.update([0]);
    digest.update(native_binding_generation.to_be_bytes());
    format!("v1.{:x}", digest.finalize())
}

fn team_command_id(
    native_binding_id: &str,
    credential_digest: &str,
    runtime_tool_call_id: &str,
) -> Result<String> {
    let digest = canonical_json_digest(&json!({
        "nativeBindingId": native_binding_id,
        "credentialDigest": credential_digest,
        "runtimeToolCallId": runtime_tool_call_id,
    }))?;
    Ok(format!("team-tool-{digest}"))
}

fn invocation_error(code: &str, message: &str) -> anyhow::Error {
    TeamToolInvocationError {
        code: code.to_string(),
        message: message.to_string(),
    }
    .into()
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({ "message": message }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        agent_profile::configure_test_runtime,
        collaboration::{
            AddCampMemberCommand, CollaborationService, CreateCampCommand, CreateTaskCommand,
            ExecutionRequest, MessageAddressSpec, SendCampMessageCommand,
        },
        command::{CommandGatewayError, CommandResultStatus},
        runtime::{BindNativeSessionCommand, ClaimAgentRunCommand, ExecutionRuntimeService},
    };

    struct Fixture {
        database: Database,
        directory: std::path::PathBuf,
        camp_id: String,
        task_id: String,
        source_run_id: String,
        source_epoch: i64,
        credential: TeamToolBindingCredential,
    }

    struct DeliveredA2aState {
        recipient_message_id: Option<String>,
        delivered_at: Option<String>,
        target_agent_run_id: Option<String>,
        a2a_depth: i64,
        invocation_kind: String,
        status: String,
        task_id: Option<String>,
    }

    impl Fixture {
        fn new() -> Self {
            let directory =
                std::env::temp_dir().join(format!("lumen-team-tool-test-{}", Uuid::new_v4()));
            let workspace = directory.join("workspace");
            std::fs::create_dir_all(&workspace).expect("workspace should exist");
            let mut database = Database::open(&directory).expect("database should open");
            configure_test_runtime(&database, &["agent-luoke", "agent-muwa"]);
            add_team_tool_capability(&database);
            let collaboration = CollaborationService::default();
            let camp = collaboration
                .create_camp(
                    &mut database,
                    &user_envelope(
                        "create-team-camp",
                        None,
                        CreateCampCommand {
                            project_path: workspace.to_string_lossy().to_string(),
                            repository: None,
                        },
                    ),
                )
                .expect("Camp should be created");
            let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
            for (index, agent_id) in ["agent-luoke", "agent-muwa"].iter().enumerate() {
                collaboration
                    .add_camp_member(
                        &mut database,
                        &user_envelope(
                            &format!("add-member-{index}"),
                            Some(&camp_id),
                            AddCampMemberCommand {
                                camp_id: camp_id.clone(),
                                agent_profile_id: (*agent_id).to_string(),
                                capability_overrides: json!({}),
                            },
                        ),
                    )
                    .expect("member should be added");
            }
            let task = collaboration
                .create_task(
                    &mut database,
                    &user_envelope(
                        "create-team-task",
                        Some(&camp_id),
                        CreateTaskCommand {
                            camp_id: camp_id.clone(),
                            title: "Collaborative task".to_string(),
                            description: "Exercise A2A execution".to_string(),
                            assignee_agent_id: Some("agent-luoke".to_string()),
                        },
                    ),
                )
                .expect("Task should be created");
            let task_id = task.result.payload["taskId"].as_str().unwrap().to_string();
            let send = collaboration
                .send_camp_message(
                    &mut database,
                    &user_envelope(
                        "queue-source-run",
                        Some(&camp_id),
                        SendCampMessageCommand {
                            camp_id: camp_id.clone(),
                            body: "Start the collaboration".to_string(),
                            address: MessageAddressSpec::Explicit {
                                agent_profile_ids: vec!["agent-luoke".to_string()],
                            },
                            reply_to_camp_message_id: None,
                            execution: Some(ExecutionRequest {
                                task_id: Some(task_id.clone()),
                                purpose: "Coordinate work".to_string(),
                                expected_output: "A useful answer".to_string(),
                                completion_role: "required".to_string(),
                            }),
                        },
                    ),
                )
                .expect("source Run should queue");
            let source_run_id = send.result.payload["agentRunIds"][0]
                .as_str()
                .unwrap()
                .to_string();
            let runtime = ExecutionRuntimeService::default();
            let candidate = runtime
                .list_dispatchable_agent_runs(&database, 10)
                .expect("Run should be dispatchable")
                .into_iter()
                .find(|candidate| candidate.agent_run_id == source_run_id)
                .unwrap();
            let workspace = candidate.execution_workspace();
            let claimed = runtime
                .claim_agent_run(
                    &mut database,
                    &CommandEnvelope {
                        command_id: "claim-source-run".to_string(),
                        actor: ActorRef::System {
                            component_id: "agent-run-scheduler".to_string(),
                        },
                        camp_id: Some(camp_id.clone()),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: ClaimAgentRunCommand {
                            agent_run_id: source_run_id.clone(),
                            expected_version: candidate.version,
                            lease_owner: "test-scheduler".to_string(),
                            lease_seconds: 300,
                            workspace: Some(workspace),
                        },
                    },
                )
                .expect("source Run should be claimed");
            let source_epoch = claimed.result.payload["executionEpoch"].as_i64().unwrap();
            let execution = runtime
                .load_agent_run_execution(&database, &source_run_id, source_epoch)
                .unwrap()
                .unwrap();
            let bound = runtime
                .bind_native_session(
                    &mut database,
                    &CommandEnvelope {
                        command_id: "bind-source-session".to_string(),
                        actor: ActorRef::System {
                            component_id: "runtime-adapter:codex-cli".to_string(),
                        },
                        camp_id: Some(camp_id.clone()),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: BindNativeSessionCommand {
                            conversation_id: execution.conversation_id,
                            agent_run_id: source_run_id.clone(),
                            expected_conversation_version: execution.conversation_version,
                            expected_execution_epoch: source_epoch,
                            previous_adapter_installation_id: None,
                            previous_native_session_id: None,
                            previous_binding_compatibility_digest: None,
                            proposed_binding_id: None,
                            adapter_installation_id: execution.runtime.installation_id.clone(),
                            native_session_id: "native-source".to_string(),
                            binding_compatibility_digest: execution
                                .runtime
                                .binding_compatibility_digest,
                        },
                    },
                )
                .expect("source session should bind");
            assert_eq!(bound.result.status, CommandResultStatus::Applied);
            let credential = TeamToolService::default()
                .issue_binding_credential(&mut database, &source_run_id, source_epoch)
                .expect("credential should be issued");
            Self {
                database,
                directory,
                camp_id,
                task_id,
                source_run_id,
                source_epoch,
                credential,
            }
        }

        fn invocation(&self, call_id: &str, recipient: &str) -> TeamToolInvocation {
            TeamToolInvocation {
                native_binding_id: self.credential.native_binding_id.clone(),
                binding_credential: self.credential.binding_credential.clone(),
                runtime_tool_call_id: call_id.to_string(),
                input: TeamPostMessageInput {
                    recipient_agent_id: recipient.to_string(),
                    body: format!("Please handle {call_id}"),
                    references: Vec::new(),
                    in_reply_to_message_id: None,
                },
            }
        }

        fn task_invocation<T>(&self, call_id: &str, input: T) -> TeamTaskToolInvocation<T> {
            TeamTaskToolInvocation {
                native_binding_id: self.credential.native_binding_id.clone(),
                binding_credential: self.credential.binding_credential.clone(),
                runtime_tool_call_id: call_id.to_string(),
                input,
            }
        }

        fn claim_bind_and_issue(
            &mut self,
            agent_run_id: &str,
            native_session_id: &str,
        ) -> (i64, TeamToolBindingCredential) {
            let runtime = ExecutionRuntimeService::default();
            let candidate = runtime
                .list_dispatchable_agent_runs(&self.database, 100)
                .unwrap()
                .into_iter()
                .find(|candidate| candidate.agent_run_id == agent_run_id)
                .expect("target Run should be dispatchable");
            let claimed = runtime
                .claim_agent_run(
                    &mut self.database,
                    &CommandEnvelope {
                        command_id: format!("claim-{agent_run_id}"),
                        actor: ActorRef::System {
                            component_id: "agent-run-scheduler".to_string(),
                        },
                        camp_id: Some(self.camp_id.clone()),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: ClaimAgentRunCommand {
                            agent_run_id: agent_run_id.to_string(),
                            expected_version: candidate.version,
                            lease_owner: format!("scheduler-{agent_run_id}"),
                            lease_seconds: 300,
                            workspace: Some(candidate.execution_workspace()),
                        },
                    },
                )
                .expect("target Run should be claimed");
            let epoch = claimed.result.payload["executionEpoch"].as_i64().unwrap();
            let execution = runtime
                .load_agent_run_execution(&self.database, agent_run_id, epoch)
                .unwrap()
                .unwrap();
            let bound = runtime
                .bind_native_session(
                    &mut self.database,
                    &CommandEnvelope {
                        command_id: format!("bind-{agent_run_id}"),
                        actor: ActorRef::System {
                            component_id: "runtime-adapter:codex-cli".to_string(),
                        },
                        camp_id: Some(self.camp_id.clone()),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: BindNativeSessionCommand {
                            conversation_id: execution.conversation_id,
                            agent_run_id: agent_run_id.to_string(),
                            expected_conversation_version: execution.conversation_version,
                            expected_execution_epoch: epoch,
                            previous_adapter_installation_id: execution
                                .native_adapter_installation_id,
                            previous_native_session_id: execution.native_session_id,
                            previous_binding_compatibility_digest: execution
                                .native_binding_compatibility_digest,
                            proposed_binding_id: None,
                            adapter_installation_id: execution.runtime.installation_id,
                            native_session_id: native_session_id.to_string(),
                            binding_compatibility_digest: execution
                                .runtime
                                .binding_compatibility_digest,
                        },
                    },
                )
                .expect("target Native Session should bind");
            assert_eq!(bound.result.status, CommandResultStatus::Applied);
            let credential = TeamToolService::default()
                .issue_binding_credential(&mut self.database, agent_run_id, epoch)
                .expect("target credential should be issued");
            (epoch, credential)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let replacement = std::env::temp_dir().join(format!("lumen-drop-{}", Uuid::new_v4()));
            let database = Database::open(&replacement).expect("replacement database should open");
            let old = std::mem::replace(&mut self.database, database);
            drop(old);
            let _ = std::fs::remove_dir_all(&self.directory);
            let _ = std::fs::remove_dir_all(replacement);
        }
    }

    #[test]
    fn tool_schema_exposes_only_model_owned_fields() {
        let schema = TeamToolService::input_schema();
        let properties = schema["properties"].as_object().unwrap();
        assert_eq!(properties.len(), 4);
        assert!(properties.contains_key("recipientAgentId"));
        assert!(properties.contains_key("body"));
        assert!(properties.contains_key("inReplyToMessageId"));
        assert!(properties.contains_key("references"));
        for forbidden in [
            "senderAgentId",
            "campId",
            "sourceAgentRunId",
            "executionEpoch",
            "taskId",
            "correlationId",
            "idempotencyKey",
        ] {
            assert!(!properties.contains_key(forbidden));
        }
    }

    #[test]
    fn task_tool_schemas_preserve_nullable_assignee_semantics() {
        for schema in [
            TeamToolService::create_task_input_schema(),
            TeamToolService::update_task_input_schema(),
            TeamToolService::list_tasks_input_schema(),
        ] {
            let properties = schema["properties"].as_object().unwrap();
            for forbidden in [
                "campId",
                "agentProfileId",
                "sourceAgentRunId",
                "executionEpoch",
                "commandId",
            ] {
                assert!(!properties.contains_key(forbidden));
            }
        }
        let missing = serde_json::from_value::<TeamUpdateTaskInput>(json!({
            "taskId": "task-1",
            "expectedVersion": 1,
            "status": "in_progress"
        }))
        .unwrap();
        assert_eq!(missing.assignee_agent_id, NullableInput::Missing);
        let clear = serde_json::from_value::<TeamUpdateTaskInput>(json!({
            "taskId": "task-1",
            "expectedVersion": 1,
            "assigneeAgentId": null
        }))
        .unwrap();
        assert_eq!(clear.assignee_agent_id, NullableInput::Null);
        let assign = serde_json::from_value::<TeamUpdateTaskInput>(json!({
            "taskId": "task-1",
            "expectedVersion": 1,
            "assigneeAgentId": "agent-luoke"
        }))
        .unwrap();
        assert_eq!(
            assign.assignee_agent_id,
            NullableInput::Value("agent-luoke".to_string())
        );
    }

    #[test]
    fn task_tools_are_idempotent_authorized_and_never_wake_an_agent() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let execution_count_before: (i64, i64) = fixture
            .database
            .connection()
            .query_row(
                "SELECT (SELECT COUNT(*) FROM agent_run), (SELECT COUNT(*) FROM inbox_message)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let invocation = fixture.task_invocation(
            "create-durable-task",
            TeamCreateTaskInput {
                title: "Persistent follow-up".to_string(),
                description: "Track this across runs".to_string(),
                assignee_agent_id: None,
            },
        );
        let created = service
            .create_task(&mut fixture.database, &invocation)
            .unwrap();
        assert_eq!(created.result.status, CommandResultStatus::Applied);
        let task_id = created.result.payload["taskId"]
            .as_str()
            .unwrap()
            .to_string();
        let replayed = service
            .create_task(&mut fixture.database, &invocation)
            .unwrap();
        assert!(replayed.replayed);
        assert_eq!(replayed.result.payload["taskId"], task_id);

        let conflicting = fixture.task_invocation(
            "create-durable-task",
            TeamCreateTaskInput {
                title: "Different payload".to_string(),
                description: String::new(),
                assignee_agent_id: None,
            },
        );
        assert!(
            service
                .create_task(&mut fixture.database, &conflicting)
                .unwrap_err()
                .downcast_ref::<CommandGatewayError>()
                .is_some()
        );

        let listed = service
            .list_tasks(
                &fixture.database,
                &fixture.task_invocation(
                    "list-durable-tasks",
                    TeamListTasksInput {
                        statuses: None,
                        assignee_agent_id: NullableInput::Missing,
                        limit: 50,
                        cursor: None,
                    },
                ),
            )
            .unwrap();
        assert!(listed.tasks.iter().any(|task| task.task.id == task_id));
        let update_invocation = fixture.task_invocation(
            "claim-durable-task",
            TeamUpdateTaskInput {
                task_id: task_id.clone(),
                expected_version: 1,
                title: None,
                description: None,
                status: Some(TaskStatus::InProgress),
                assignee_agent_id: NullableInput::Value("agent-luoke".to_string()),
            },
        );
        let updated = service
            .update_task(&mut fixture.database, &update_invocation)
            .unwrap();
        assert_eq!(updated.result.status, CommandResultStatus::Applied);
        assert_eq!(updated.result.payload["version"], 2);
        let execution_count_after: (i64, i64) = fixture
            .database
            .connection()
            .query_row(
                "SELECT (SELECT COUNT(*) FROM agent_run), (SELECT COUNT(*) FROM inbox_message)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(execution_count_after, execution_count_before);
    }

    #[test]
    fn task_tool_reads_apply_current_lead_scope_without_audit_writes() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id = 'agent-muwa' WHERE id = ?1",
                [&fixture.camp_id],
            )
            .unwrap();
        let hidden = CollaborationService::default()
            .create_task(
                &mut fixture.database,
                &user_envelope(
                    "create-hidden-muwa-task",
                    Some(&fixture.camp_id),
                    CreateTaskCommand {
                        camp_id: fixture.camp_id.clone(),
                        title: "Muwa private assignment".to_string(),
                        description: String::new(),
                        assignee_agent_id: Some("agent-muwa".to_string()),
                    },
                ),
            )
            .unwrap();
        let hidden_id = hidden.result.payload["taskId"].as_str().unwrap();
        let event_count_before: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM event_log", [], |row| row.get(0))
            .unwrap();
        let listed = service
            .list_tasks(
                &fixture.database,
                &fixture.task_invocation(
                    "ordinary-member-list",
                    TeamListTasksInput {
                        statuses: None,
                        assignee_agent_id: NullableInput::Missing,
                        limit: 100,
                        cursor: None,
                    },
                ),
            )
            .unwrap();
        assert!(!listed.tasks.iter().any(|task| task.task.id == hidden_id));
        let event_count_after: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM event_log", [], |row| row.get(0))
            .unwrap();
        assert_eq!(event_count_after, event_count_before);
    }

    #[test]
    fn task_tool_write_obeys_frozen_capability_and_version_fencing() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let current_config: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT effective_config_json FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        let mut config: Value = serde_json::from_str(&current_config).unwrap();
        config["capabilities"]
            .as_array_mut()
            .unwrap()
            .retain(|capability| capability.as_str() != Some("task.create"));
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET effective_config_json = ?2 WHERE id = ?1",
                params![
                    fixture.source_run_id,
                    serde_json::to_string(&config).unwrap()
                ],
            )
            .unwrap();
        let denied_invocation = fixture.task_invocation(
            "capability-revoked",
            TeamCreateTaskInput {
                title: "Must not exist".to_string(),
                description: String::new(),
                assignee_agent_id: None,
            },
        );
        let denied = service
            .create_task(&mut fixture.database, &denied_invocation)
            .unwrap();
        assert_eq!(denied.result.code, "command.capability_denied");

        let stale_invocation = fixture.task_invocation(
            "stale-task-version",
            TeamUpdateTaskInput {
                task_id: fixture.task_id.clone(),
                expected_version: 99,
                title: Some("Must not overwrite".to_string()),
                description: None,
                status: None,
                assignee_agent_id: NullableInput::Missing,
            },
        );
        let stale = service
            .update_task(&mut fixture.database, &stale_invocation)
            .unwrap();
        assert_eq!(stale.result.code, "task.version_conflict");
    }

    #[test]
    fn post_message_atomically_delivers_and_queues_one_a2a_run() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let invocation = fixture.invocation("tool-call-1", "agent-muwa");
        let result = service
            .post_message(&mut fixture.database, &invocation)
            .expect("Team Tool should succeed");
        assert_eq!(result.result.status, CommandResultStatus::Accepted);
        assert_eq!(result.result.payload["a2aDepth"], 1);
        assert_eq!(result.result.payload["remainingA2aHops"], 4);
        assert_eq!(result.result.payload["status"], "queued");
        let inbox_id = result.result.payload["inboxMessageId"].as_str().unwrap();
        let target_run_id = result.result.payload["targetAgentRunId"].as_str().unwrap();
        let state = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT inbox_message.recipient_message_id,
                       inbox_message.delivered_at,
                       inbox_message.target_agent_run_id,
                       agent_run.a2a_depth, agent_run.invocation_kind,
                       agent_run.status, agent_run.task_id
                FROM inbox_message
                JOIN agent_run ON agent_run.id = inbox_message.target_agent_run_id
                WHERE inbox_message.id = ?1
                "#,
                [inbox_id],
                |row| {
                    Ok(DeliveredA2aState {
                        recipient_message_id: row.get(0)?,
                        delivered_at: row.get(1)?,
                        target_agent_run_id: row.get(2)?,
                        a2a_depth: row.get(3)?,
                        invocation_kind: row.get(4)?,
                        status: row.get(5)?,
                        task_id: row.get(6)?,
                    })
                },
            )
            .unwrap();
        assert!(state.recipient_message_id.is_some());
        assert!(state.delivered_at.is_some());
        assert_eq!(state.target_agent_run_id.as_deref(), Some(target_run_id));
        assert_eq!(state.a2a_depth, 1);
        assert_eq!(state.invocation_kind, "a2a");
        assert_eq!(state.status, "queued");
        assert_eq!(state.task_id, None);
        let assignee: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT assignee_agent_id FROM task WHERE id = ?1",
                [&fixture.task_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(assignee, "agent-luoke");
        let replay = service
            .post_message(&mut fixture.database, &invocation)
            .expect("same Tool Call should replay");
        assert!(replay.replayed);
        assert_eq!(replay.result.payload, result.result.payload);
    }

    #[test]
    fn queued_a2a_run_survives_restart_and_stale_tool_cannot_duplicate_it() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let invocation = fixture.invocation("restart-queued", "agent-muwa");
        let first = service
            .post_message(&mut fixture.database, &invocation)
            .expect("Team Tool should queue the target Run");
        let inbox_id = first.result.payload["inboxMessageId"]
            .as_str()
            .unwrap()
            .to_string();
        let target_run_id = first.result.payload["targetAgentRunId"]
            .as_str()
            .unwrap()
            .to_string();

        let placeholder_directory =
            std::env::temp_dir().join(format!("lumen-team-tool-placeholder-{}", Uuid::new_v4()));
        let placeholder =
            Database::open(&placeholder_directory).expect("placeholder database should open");
        let old = std::mem::replace(&mut fixture.database, placeholder);
        drop(old);
        let reopened = Database::open(&fixture.directory).expect("fixture database should reopen");
        let placeholder = std::mem::replace(&mut fixture.database, reopened);
        drop(placeholder);
        std::fs::remove_dir_all(&placeholder_directory)
            .expect("placeholder database should be removed");

        fixture
            .database
            .prepare_v2_recovery()
            .expect("startup recovery should converge");
        let dispatchable = ExecutionRuntimeService::default()
            .list_dispatchable_agent_runs(&fixture.database, 100)
            .expect("Scheduler scan should succeed");
        assert!(
            dispatchable
                .iter()
                .any(|candidate| candidate.agent_run_id == target_run_id)
        );

        let stale_error = service
            .post_message(&mut fixture.database, &invocation)
            .expect_err("the pre-restart Binding credential must be fenced");
        assert_eq!(
            stale_error
                .downcast_ref::<TeamToolInvocationError>()
                .map(|error| error.code.as_str()),
            Some("team_tool.binding_fenced")
        );
        let counts: (i64, i64) = fixture
            .database
            .connection()
            .query_row(
                "SELECT (SELECT COUNT(*) FROM inbox_message WHERE id = ?1), (SELECT COUNT(*) FROM agent_run WHERE id = ?2)",
                params![inbox_id, target_run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(counts, (1, 1));
    }

    #[test]
    fn same_tool_call_id_with_different_input_conflicts() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let first = fixture.invocation("stable-call", "agent-muwa");
        service
            .post_message(&mut fixture.database, &first)
            .expect("first invocation should succeed");
        let mut changed = fixture.invocation("stable-call", "agent-muwa");
        changed.input.body = "Different semantic request".to_string();
        let error = service
            .post_message(&mut fixture.database, &changed)
            .expect_err("changed input must conflict");
        assert!(error.downcast_ref::<CommandGatewayError>().is_some());
    }

    #[test]
    fn busy_recipient_keeps_each_request_as_an_ordered_queued_run() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let first_invocation = fixture.invocation("busy-first", "agent-muwa");
        let first = service
            .post_message(&mut fixture.database, &first_invocation)
            .unwrap();
        let first_run_id = first.result.payload["targetAgentRunId"]
            .as_str()
            .unwrap()
            .to_string();
        fixture.claim_bind_and_issue(&first_run_id, "native-busy-target");
        let second_invocation = fixture.invocation("busy-second", "agent-muwa");
        let second = service
            .post_message(&mut fixture.database, &second_invocation)
            .unwrap();
        let second_run_id = second.result.payload["targetAgentRunId"].as_str().unwrap();
        let second_status: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT status FROM agent_run WHERE id = ?1",
                [second_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(second_status, "queued");
        let dispatchable = ExecutionRuntimeService::default()
            .list_dispatchable_agent_runs(&fixture.database, 100)
            .unwrap();
        assert!(
            dispatchable
                .iter()
                .all(|candidate| candidate.agent_run_id != second_run_id)
        );
        let a2a_count: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM agent_run WHERE camp_turn_id = (SELECT camp_turn_id FROM agent_run WHERE id = ?1) AND invocation_kind = 'a2a'",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(a2a_count, 2);
    }

    #[test]
    fn explicit_reply_reverses_direction_and_inherits_correlation_turn_without_task() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let request = fixture.invocation("request-review", "agent-muwa");
        let first = service
            .post_message(&mut fixture.database, &request)
            .unwrap();
        let inbox_id = first.result.payload["inboxMessageId"]
            .as_str()
            .unwrap()
            .to_string();
        let target_run_id = first.result.payload["targetAgentRunId"]
            .as_str()
            .unwrap()
            .to_string();
        let correlation_id = first.result.payload["correlationId"]
            .as_str()
            .unwrap()
            .to_string();
        let (_, recipient_credential) =
            fixture.claim_bind_and_issue(&target_run_id, "native-replier");
        let reply = TeamToolInvocation {
            native_binding_id: recipient_credential.native_binding_id,
            binding_credential: recipient_credential.binding_credential,
            runtime_tool_call_id: "reply-review".to_string(),
            input: TeamPostMessageInput {
                recipient_agent_id: "agent-luoke".to_string(),
                body: "Review complete; please continue with the two findings.".to_string(),
                references: vec![EntityReference {
                    entity_type: "agent_run".to_string(),
                    entity_id: target_run_id.clone(),
                }],
                in_reply_to_message_id: Some(inbox_id.clone()),
            },
        };
        let result = service
            .post_message(&mut fixture.database, &reply)
            .expect("reply should queue the requestor again");
        assert_eq!(result.result.payload["correlationId"], correlation_id);
        assert_eq!(result.result.payload["a2aDepth"], 2);
        assert_eq!(result.result.payload["depthWarning"], true);
        let reply_inbox_id = result.result.payload["inboxMessageId"].as_str().unwrap();
        let state: (
            String,
            String,
            Option<String>,
            String,
            Option<String>,
            i64,
            String,
        ) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT inbox_message.sender_agent_id,
                       inbox_message.recipient_agent_id,
                       inbox_message.in_reply_to_message_id,
                       inbox_message.correlation_id,
                       agent_run.task_id, agent_run.a2a_depth,
                       agent_run.camp_turn_id
                FROM inbox_message
                JOIN agent_run ON agent_run.id = inbox_message.target_agent_run_id
                WHERE inbox_message.id = ?1
                "#,
                [reply_inbox_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .unwrap();
        let source_turn: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT camp_turn_id FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state.0, "agent-muwa");
        assert_eq!(state.1, "agent-luoke");
        assert_eq!(state.2.as_deref(), Some(inbox_id.as_str()));
        assert_eq!(state.3, correlation_id);
        assert_eq!(state.4, None);
        assert_eq!(state.5, 2);
        assert_eq!(state.6, source_turn);
    }

    #[test]
    fn recipient_unready_and_self_send_create_no_a2a_objects() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let self_invocation = fixture.invocation("self", "agent-luoke");
        let self_send = service
            .post_message(&mut fixture.database, &self_invocation)
            .unwrap();
        assert_eq!(self_send.result.code, "team_tool.self_send");
        fixture
            .database
            .connection()
            .execute(
                "UPDATE adapter_capability_snapshot SET capabilities_json = '[]' WHERE installation_id = 'adapter-test-codex'",
                [],
            )
            .unwrap();
        let unready_invocation = fixture.invocation("unready", "agent-muwa");
        let unready = service
            .post_message(&mut fixture.database, &unready_invocation)
            .unwrap();
        assert_eq!(unready.result.code, "team_tool.recipient_unsupported");
        let inbox_count: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM inbox_message", [], |row| row.get(0))
            .unwrap();
        let a2a_count: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM agent_run WHERE invocation_kind = 'a2a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(inbox_count, 0);
        assert_eq!(a2a_count, 0);
    }

    #[test]
    fn compatible_native_binding_reuses_the_bridge_credential() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let original_binding_id = fixture.credential.native_binding_id.clone();
        let original_generation = fixture.credential.native_binding_generation;
        let original_credential = fixture.credential.binding_credential.clone();
        let reused = service
            .issue_binding_credential(
                &mut fixture.database,
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .unwrap();
        assert!(!reused.binding_replaced);
        assert_eq!(reused.native_binding_id, original_binding_id);
        assert_eq!(reused.native_binding_generation, original_generation);
        assert_eq!(reused.binding_credential, original_credential);
        fixture.credential = reused;
        let new_invocation = fixture.invocation("resumed-run-call", "agent-muwa");
        let accepted = service
            .post_message(&mut fixture.database, &new_invocation)
            .unwrap();
        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
    }

    #[test]
    fn tool_injection_does_not_grant_the_inbox_send_capability() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let effective_config_json: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT effective_config_json FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        let mut effective_config: Value = serde_json::from_str(&effective_config_json).unwrap();
        effective_config["capabilities"] = json!([]);
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET effective_config_json = ?2 WHERE id = ?1",
                params![
                    fixture.source_run_id,
                    serde_json::to_string(&effective_config).unwrap()
                ],
            )
            .unwrap();
        let credential = service
            .issue_binding_credential(
                &mut fixture.database,
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .expect("supported Runtime should still receive the additive Team Tool");
        let denied = service
            .post_message(
                &mut fixture.database,
                &TeamToolInvocation {
                    native_binding_id: credential.native_binding_id,
                    binding_credential: credential.binding_credential,
                    runtime_tool_call_id: "capability-denied".to_string(),
                    input: TeamPostMessageInput {
                        recipient_agent_id: "agent-muwa".to_string(),
                        body: "This request has no authority".to_string(),
                        references: Vec::new(),
                        in_reply_to_message_id: None,
                    },
                },
            )
            .expect_err("tool presence must not grant inbox.send");
        assert_eq!(
            denied
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.capability_denied"
        );
    }

    #[test]
    fn prepared_replacement_is_fenced_until_its_native_session_is_attached() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let old_invocation = fixture.invocation("prepared-old", "agent-muwa");
        let previous_generation = fixture.credential.native_binding_generation;
        let prepared = service
            .prepare_binding_credential(
                &mut fixture.database,
                &fixture.source_run_id,
                fixture.source_epoch,
                true,
            )
            .expect("replacement Binding should be reserved before Adapter start");
        assert!(prepared.binding_replaced);
        assert_eq!(prepared.native_binding_generation, previous_generation + 1);
        assert!(prepared.native_session_id.is_none());
        let conversation_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT conversation_id FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();

        let old_error = service
            .post_message(&mut fixture.database, &old_invocation)
            .expect_err("replacement reservation must fence the previous Bridge");
        assert_eq!(
            old_error
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.binding_fenced"
        );
        let prepared_invocation = TeamToolInvocation {
            native_binding_id: prepared.native_binding_id.clone(),
            binding_credential: prepared.binding_credential.clone(),
            runtime_tool_call_id: "prepared-before-attach".to_string(),
            input: TeamPostMessageInput {
                recipient_agent_id: "agent-muwa".to_string(),
                body: "This must not dispatch before Native Session attachment".to_string(),
                references: Vec::new(),
                in_reply_to_message_id: None,
            },
        };
        let unattached_error = service
            .post_message(&mut fixture.database, &prepared_invocation)
            .expect_err("reserved credential must be unusable before Session attachment");
        assert_eq!(
            unattached_error
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.binding_fenced"
        );

        let secret_before: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT native_binding_secret_digest FROM conversation WHERE native_binding_id = ?1",
                [&prepared.native_binding_id],
                |row| row.get(0),
            )
            .unwrap();
        let bound = ExecutionRuntimeService::default()
            .bind_native_session(
                &mut fixture.database,
                &CommandEnvelope {
                    command_id: "attach-prepared-session".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:codex-cli".to_string(),
                    },
                    camp_id: Some(fixture.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: BindNativeSessionCommand {
                        conversation_id,
                        agent_run_id: fixture.source_run_id.clone(),
                        expected_conversation_version: prepared.conversation_version,
                        expected_execution_epoch: fixture.source_epoch,
                        previous_adapter_installation_id: Some(
                            prepared.adapter_installation_id.clone(),
                        ),
                        previous_native_session_id: None,
                        previous_binding_compatibility_digest: Some(
                            prepared.binding_compatibility_digest.clone(),
                        ),
                        proposed_binding_id: Some(prepared.native_binding_id.clone()),
                        adapter_installation_id: prepared.adapter_installation_id.clone(),
                        native_session_id: "native-prepared".to_string(),
                        binding_compatibility_digest: prepared.binding_compatibility_digest.clone(),
                    },
                },
            )
            .expect("prepared Native Session attachment should succeed");
        assert_eq!(bound.result.status, CommandResultStatus::Applied);
        assert_eq!(bound.result.payload["bindingPrepared"], true);
        let (secret_after, native_session): (String, String) = fixture
            .database
            .connection()
            .query_row(
                "SELECT native_binding_secret_digest, native_session_id FROM conversation WHERE native_binding_id = ?1",
                [&prepared.native_binding_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(secret_after, secret_before);
        assert_eq!(native_session, "native-prepared");

        let accepted = service
            .post_message(&mut fixture.database, &prepared_invocation)
            .expect("attached prepared credential should become usable");
        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
    }

    #[test]
    fn reclaimed_execution_epoch_reuses_the_binding_bridge_for_the_current_run() {
        let mut fixture = Fixture::new();
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'waiting',
                    wait_reason = 'runtime_recovery',
                    runtime_recovery_required = 1,
                    execution_lease_owner = NULL,
                    execution_lease_expires_at = NULL,
                    version = version + 1
                WHERE id = ?1
                "#,
                [&fixture.source_run_id],
            )
            .unwrap();
        let runtime = ExecutionRuntimeService::default();
        let candidate = runtime
            .list_dispatchable_agent_runs(&fixture.database, 10)
            .unwrap()
            .into_iter()
            .find(|candidate| candidate.agent_run_id == fixture.source_run_id)
            .unwrap();
        let workspace = candidate.execution_workspace();
        let reclaimed = runtime
            .claim_agent_run(
                &mut fixture.database,
                &CommandEnvelope {
                    command_id: "reclaim-new-epoch".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-recovery-coordinator".to_string(),
                    },
                    camp_id: Some(fixture.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: ClaimAgentRunCommand {
                        agent_run_id: fixture.source_run_id.clone(),
                        expected_version: candidate.version,
                        lease_owner: "recovery-scheduler".to_string(),
                        lease_seconds: 300,
                        workspace: Some(workspace),
                    },
                },
            )
            .unwrap();
        assert_eq!(
            reclaimed.result.payload["executionEpoch"],
            fixture.source_epoch + 1
        );
        fixture.source_epoch += 1;
        let reused = TeamToolService::default()
            .issue_binding_credential(
                &mut fixture.database,
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .expect("the active execution epoch should reuse its Native Binding Bridge");
        assert_eq!(
            reused.native_binding_id,
            fixture.credential.native_binding_id
        );
        assert_eq!(
            reused.binding_credential,
            fixture.credential.binding_credential
        );
        fixture.credential = reused;
        let invocation = fixture.invocation("recovered-epoch", "agent-muwa");
        let accepted = TeamToolService::default()
            .post_message(&mut fixture.database, &invocation)
            .expect("the stable Bridge should resolve the current execution epoch");
        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
    }

    #[test]
    fn depth_and_turn_quotas_reject_without_partial_messages() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET invocation_kind = 'a2a', a2a_root_agent_run_id = id, a2a_depth = 5 WHERE id = ?1",
                [&fixture.source_run_id],
            )
            .unwrap();
        let too_deep_invocation = fixture.invocation("too-deep", "agent-muwa");
        let depth = service
            .post_message(&mut fixture.database, &too_deep_invocation)
            .unwrap();
        assert_eq!(depth.result.code, "team_tool.a2a_depth_exhausted");
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET invocation_kind = 'direct', a2a_root_agent_run_id = NULL, a2a_depth = 0 WHERE id = ?1",
                [&fixture.source_run_id],
            )
            .unwrap();
        for index in 0..MAX_A2A_RUNS_PER_TURN {
            let invocation = fixture.invocation(&format!("quota-{index}"), "agent-muwa");
            let accepted = service
                .post_message(&mut fixture.database, &invocation)
                .unwrap();
            assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
        }
        let before: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM inbox_message", [], |row| row.get(0))
            .unwrap();
        let overflow_invocation = fixture.invocation("quota-overflow", "agent-muwa");
        let rejected = service
            .post_message(&mut fixture.database, &overflow_invocation)
            .unwrap();
        assert_eq!(rejected.result.code, "team_tool.a2a_turn_quota_exhausted");
        let after: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM inbox_message", [], |row| row.get(0))
            .unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn database_failure_rolls_back_inbox_message_and_recipient_message() {
        let mut fixture = Fixture::new();
        fixture
            .database
            .connection()
            .execute_batch(
                r#"
                CREATE TRIGGER fail_team_target_run
                BEFORE INSERT ON agent_run
                WHEN NEW.invocation_kind = 'a2a'
                BEGIN
                    SELECT RAISE(ABORT, 'injected A2A failure');
                END;
                "#,
            )
            .unwrap();
        let target_conversation_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT id FROM conversation WHERE camp_id = ?1 AND agent_profile_id = 'agent-muwa'",
                [&fixture.camp_id],
                |row| row.get(0),
            )
            .unwrap();
        let before_sequence: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT last_message_sequence FROM conversation WHERE id = ?1",
                [&target_conversation_id],
                |row| row.get(0),
            )
            .unwrap();
        let rollback_invocation = fixture.invocation("rollback", "agent-muwa");
        TeamToolService::default()
            .post_message(&mut fixture.database, &rollback_invocation)
            .expect_err("injected failure should abort the transaction");
        let inbox_count: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM inbox_message", [], |row| row.get(0))
            .unwrap();
        let after_sequence: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT last_message_sequence FROM conversation WHERE id = ?1",
                [&target_conversation_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(inbox_count, 0);
        assert_eq!(before_sequence, after_sequence);
    }

    fn add_team_tool_capability(database: &Database) {
        let capabilities_json: String = database
            .connection()
            .query_row(
                "SELECT capabilities_json FROM adapter_capability_snapshot WHERE installation_id = 'adapter-test-codex'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let mut capabilities: Vec<String> = serde_json::from_str(&capabilities_json).unwrap();
        capabilities.push(TEAM_POST_MESSAGE_CAPABILITY.to_string());
        capabilities.sort();
        capabilities.dedup();
        database
            .connection()
            .execute(
                "UPDATE adapter_capability_snapshot SET capabilities_json = ?1 WHERE installation_id = 'adapter-test-codex'",
                [serde_json::to_string(&capabilities).unwrap()],
            )
            .unwrap();
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
}
