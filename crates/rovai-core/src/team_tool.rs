use std::{fmt, sync::OnceLock};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    agent_profile::AdapterKind,
    camp_history::{
        CAMP_LIST_TOOL_NAME, CAMP_READ_TOOL_NAME, CAMP_SEARCH_TOOL_NAME, HISTORY_SEARCH_TOOL_NAME,
    },
    collaboration::{
        CollaborationService, CreateTaskCommand, TaskAcceptanceCriteriaUpdate, TaskAssigneeFilter,
        TaskAssigneeUpdate, TaskDetail, TaskListPage, TaskListQuery, TaskStatus, UpdateTaskCommand,
        append_domain_event,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, canonical_json_digest, sealed,
    },
    db::Database,
    execution_budget::{PRODUCT_MAX_ACCEPTED_A2A, camp_turn_execution_budget_now},
    message_delivery::{
        CAMP_MESSAGE_SEND_MAX_BODY_BYTES, CAMP_MESSAGE_SEND_TOOL_NAME, SendPublicA2aMessage,
        dispatch_accepted_deliveries, persist_public_a2a_message,
    },
};

pub const TEAM_CREATE_TASK_TOOL_NAME: &str = "team.create_task";
pub const TEAM_GET_TASK_TOOL_NAME: &str = "team.get_task";
pub const TEAM_UPDATE_TASK_TOOL_NAME: &str = "team.update_task";
pub const TEAM_LIST_TASKS_TOOL_NAME: &str = "team.list_tasks";
pub const TEAM_TOOL_NAMES: [&str; 13] = [
    CAMP_MESSAGE_SEND_TOOL_NAME,
    TEAM_CREATE_TASK_TOOL_NAME,
    TEAM_GET_TASK_TOOL_NAME,
    TEAM_UPDATE_TASK_TOOL_NAME,
    TEAM_LIST_TASKS_TOOL_NAME,
    CAMP_LIST_TOOL_NAME,
    CAMP_SEARCH_TOOL_NAME,
    HISTORY_SEARCH_TOOL_NAME,
    CAMP_READ_TOOL_NAME,
    "memory.search",
    "memory.read",
    "memory.write",
    "memory.propose_hearth",
];
pub const MAX_A2A_DEPTH: i64 = 5;
pub const MAX_A2A_RUNS_PER_TURN: i64 = PRODUCT_MAX_ACCEPTED_A2A;
pub const A2A_DEPTH_WARNING_AT: i64 = 2;
pub const A2A_RUN_WARNING_AT: i64 = 12;

static TEAM_TOOL_PROCESS_SECRET: OnceLock<String> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CampMessageSendInput {
    pub body: String,
    #[serde(default)]
    pub to: Vec<String>,
    pub reply_to_camp_message_id: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamCreateTaskInput {
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub acceptance_criteria: Vec<String>,
    pub assignee_agent_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamGetTaskInput {
    pub task_id: String,
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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamUpdateTaskInput {
    pub task_id: String,
    pub expected_version: i64,
    pub title: Option<String>,
    pub description: Option<String>,
    pub acceptance_criteria: Option<Vec<String>>,
    #[serde(default)]
    pub clear_acceptance_criteria: bool,
    pub status: Option<TaskStatus>,
    #[serde(default, deserialize_with = "deserialize_nullable_input")]
    pub assignee_agent_id: NullableInput<String>,
    #[serde(default)]
    pub clear_assignee: bool,
    pub blocked_reason: Option<String>,
    pub completion_summary: Option<String>,
    pub cancel_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamListTasksInput {
    pub statuses: Option<Vec<TaskStatus>>,
    #[serde(default, deserialize_with = "deserialize_nullable_input")]
    pub assignee_agent_id: NullableInput<String>,
    #[serde(default)]
    pub unassigned_only: bool,
    #[serde(default)]
    pub limit: usize,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampMessageSendCommand {
    native_binding_id: String,
    credential_digest: String,
    runtime_tool_call_id: String,
    camp_id: String,
    body: String,
    to: Vec<String>,
    reply_to_camp_message_id: Option<String>,
    task_id: Option<String>,
}

impl sealed::Sealed for CampMessageSendCommand {}
impl DomainCommand for CampMessageSendCommand {
    const TYPE: &'static str = CAMP_MESSAGE_SEND_TOOL_NAME;
}

/// The raw credential is deliberately separate from the durable domain command.
/// Command records contain only its digest, so the credential never reaches SQLite.
pub struct CampMessageSendInvocation {
    pub native_binding_id: String,
    pub binding_credential: String,
    pub runtime_tool_call_id: String,
    pub input: CampMessageSendInput,
}

pub struct TeamTaskToolInvocation<T> {
    pub native_binding_id: String,
    pub binding_credential: String,
    pub runtime_tool_call_id: String,
    pub input: T,
}

#[derive(Clone)]
pub struct BuiltinToolBindingCredential {
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
    agent_id: String,
    agent_run_id: String,
    execution_epoch: i64,
    camp_turn_id: String,
    a2a_root_agent_run_id: Option<String>,
    a2a_depth: i64,
    credential_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RecordedTeamCommandIdentity {
    camp_id: String,
    agent_id: String,
    source_agent_run_id: String,
    execution_epoch: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedTeamToolRun {
    pub camp_id: String,
    pub agent_id: String,
    pub agent_run_id: String,
    pub execution_epoch: i64,
}

impl TeamToolService {
    pub fn authenticate_binding(
        &self,
        database: &Database,
        native_binding_id: &str,
        binding_credential: &str,
        runtime_tool_call_id: &str,
    ) -> Result<AuthenticatedTeamToolRun> {
        validate_invocation_identity(native_binding_id, binding_credential, runtime_tool_call_id)?;
        let identity = resolve_sender_identity(
            database.connection(),
            native_binding_id,
            &credential_digest(binding_credential),
            None,
        )?;
        Ok(AuthenticatedTeamToolRun {
            camp_id: identity.camp_id,
            agent_id: identity.agent_id,
            agent_run_id: identity.agent_run_id,
            execution_epoch: identity.execution_epoch,
        })
    }

    pub fn authenticate_read_binding(
        &self,
        database: &Database,
        native_binding_id: &str,
        binding_credential: &str,
        runtime_tool_call_id: &str,
    ) -> Result<AuthenticatedTeamToolRun> {
        validate_invocation_identity(native_binding_id, binding_credential, runtime_tool_call_id)?;
        let identity = resolve_sender_identity(
            database.connection(),
            native_binding_id,
            &credential_digest(binding_credential),
            None,
        )?;
        Ok(AuthenticatedTeamToolRun {
            camp_id: identity.camp_id,
            agent_id: identity.agent_id,
            agent_run_id: identity.agent_run_id,
            execution_epoch: identity.execution_epoch,
        })
    }

    pub fn authenticate_attested_binding(
        &self,
        database: &Database,
        native_binding_id: &str,
        binding_credential: &str,
        runtime_tool_call_id: &str,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<AuthenticatedTeamToolRun> {
        if agent_run_id.trim().is_empty() || execution_epoch <= 0 {
            return Err(invocation_error(
                "team_tool.invalid_attested_run",
                "Attested AgentRun identity is incomplete",
            ));
        }
        validate_invocation_identity(native_binding_id, binding_credential, runtime_tool_call_id)?;
        let identity = resolve_sender_identity(
            database.connection(),
            native_binding_id,
            &credential_digest(binding_credential),
            Some((agent_run_id, execution_epoch)),
        )?;
        Ok(AuthenticatedTeamToolRun {
            camp_id: identity.camp_id,
            agent_id: identity.agent_id,
            agent_run_id: identity.agent_run_id,
            execution_epoch: identity.execution_epoch,
        })
    }

    pub fn authenticate_public_message_binding_or_recorded_scope(
        &self,
        database: &Database,
        native_binding_id: &str,
        binding_credential: &str,
        provider_tool_call_id: &str,
        attested_run: Option<(&str, i64)>,
    ) -> Result<AuthenticatedTeamToolRun> {
        let active = match attested_run {
            Some((agent_run_id, execution_epoch)) => self.authenticate_attested_binding(
                database,
                native_binding_id,
                binding_credential,
                provider_tool_call_id,
                agent_run_id,
                execution_epoch,
            ),
            None => self.authenticate_read_binding(
                database,
                native_binding_id,
                binding_credential,
                provider_tool_call_id,
            ),
        };
        match active {
            Ok(active) => Ok(active),
            Err(error)
                if !matches!(
                    error.downcast_ref::<TeamToolInvocationError>(),
                    Some(TeamToolInvocationError { code, .. })
                        if code == "team_tool.binding_fenced"
                ) =>
            {
                Err(error)
            }
            Err(active_fence) => {
                validate_invocation_identity(
                    native_binding_id,
                    binding_credential,
                    provider_tool_call_id,
                )?;
                let supplied_credential_digest = credential_digest(binding_credential);
                let mut statement = database.connection().prepare(
                    r#"
                    SELECT camp_turn.camp_id, conversation.agent_id,
                           agent_run.id, agent_run.execution_epoch
                    FROM conversation
                    JOIN agent_run ON agent_run.conversation_id = conversation.id
                    JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                    WHERE conversation.native_binding_id = ?1
                      AND conversation.native_binding_secret_digest = ?2
                      AND (?3 IS NULL OR (agent_run.id = ?3 AND agent_run.execution_epoch = ?4))
                    ORDER BY agent_run.created_at DESC, agent_run.id
                    "#,
                )?;
                let candidates = statement
                    .query_map(
                        params![
                            native_binding_id,
                            supplied_credential_digest,
                            attested_run.map(|value| value.0),
                            attested_run.map(|value| value.1),
                        ],
                        |row| {
                            Ok(AuthenticatedTeamToolRun {
                                camp_id: row.get(0)?,
                                agent_id: row.get(1)?,
                                agent_run_id: row.get(2)?,
                                execution_epoch: row.get(3)?,
                            })
                        },
                    )?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                for candidate in candidates {
                    let scoped_tool_call_id = format!(
                        "agent-run:{}:{}",
                        candidate.agent_run_id, provider_tool_call_id
                    );
                    let command_id = team_command_id(
                        native_binding_id,
                        &supplied_credential_digest,
                        &scoped_tool_call_id,
                    )?;
                    let recorded =
                        load_recorded_team_command_identity(database.connection(), &command_id)?;
                    if recorded.as_ref().is_some_and(|recorded| {
                        recorded.camp_id == candidate.camp_id
                            && recorded.agent_id == candidate.agent_id
                            && recorded.source_agent_run_id == candidate.agent_run_id
                            && recorded.execution_epoch == candidate.execution_epoch
                    }) {
                        return Ok(candidate);
                    }
                }
                Err(active_fence)
            }
        }
    }

    pub fn binding_command_id(
        &self,
        native_binding_id: &str,
        binding_credential: &str,
        runtime_tool_call_id: &str,
    ) -> Result<String> {
        validate_invocation_identity(native_binding_id, binding_credential, runtime_tool_call_id)?;
        team_command_id(
            native_binding_id,
            &credential_digest(binding_credential),
            runtime_tool_call_id,
        )
    }

    pub fn camp_message_send_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["body"],
            "properties": {
                "body": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": CAMP_MESSAGE_SEND_MAX_BODY_BYTES,
                    "description": "Exact public message body. Strict inline @agent_id tokens participate in addressing outside code, URLs, and escaped literal regions."
                },
                "to": {
                    "type": "array",
                    "maxItems": 16,
                    "uniqueItems": true,
                    "items": {"type": "string", "minLength": 1},
                    "description": "Optional explicit recipients. Input order is presentation metadata, never scheduling priority."
                },
                "replyToCampMessageId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Optional direct public parent message. An Agent-authored public A2A parent contributes its author as a default recipient."
                },
                "taskId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Optional current Task link; exactly one effective recipient is required."
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
                    "maxLength": 8000,
                    "description": "Optional durable scope, constraints, or completion notes."
                },
                "acceptanceCriteria": {
                    "type": "array", "maxItems": 12, "uniqueItems": true,
                    "items": {"type": "string", "minLength": 1, "maxLength": 500}
                },
                "assigneeAgentId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Active Camp member to own the Task. Omit for the shared unassigned pool."
                }
            }
        })
    }

    pub fn get_task_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["taskId"],
            "properties": {
                "taskId": {"type": "string", "minLength": 1}
            }
        })
    }

    pub fn update_task_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "description": "Update at least one of title, description, status, or assigneeAgentId. Core rejects an empty update.",
            "required": ["taskId", "expectedVersion"],
            "properties": {
                "taskId": {"type": "string", "minLength": 1},
                "expectedVersion": {"type": "integer", "minimum": 1},
                "title": {"type": "string", "minLength": 1, "maxLength": 160},
                "description": {"type": "string", "maxLength": 8000},
                "acceptanceCriteria": {
                    "type": "array", "minItems": 1, "maxItems": 12, "uniqueItems": true,
                    "items": {"type": "string", "minLength": 1, "maxLength": 500}
                },
                "clearAcceptanceCriteria": {"type": "boolean"},
                "status": {
                    "type": "string",
                    "enum": ["pending", "in_progress", "blocked", "completed", "cancelled"]
                },
                "assigneeAgentId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Set an active Camp member, or omit to leave unchanged."
                },
                "clearAssignee": {
                    "type": "boolean",
                    "description": "Set true to release the Task into the unassigned pool. Must not be combined with assigneeAgentId."
                },
                "blockedReason": {"type": "string", "minLength": 1, "maxLength": 4000},
                "completionSummary": {"type": "string", "minLength": 1, "maxLength": 4000},
                "cancelReason": {"type": "string", "minLength": 1, "maxLength": 4000}
            }
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
                    "maxItems": 5,
                    "uniqueItems": true,
                    "items": {
                        "type": "string",
                        "enum": ["pending", "in_progress", "blocked", "completed", "cancelled"]
                    }
                },
                "assigneeAgentId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Filter by one Agent, or omit for every visible assignee."
                },
                "unassignedOnly": {
                    "type": "boolean",
                    "description": "Set true to return only Tasks in the shared unassigned pool. Must not be combined with assigneeAgentId."
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
                "cursor": {"type": "string", "minLength": 1}
            }
        })
    }

    /// Reserves or reuses the Native Binding and derives its private Core
    /// credential for this Rovai-ai process. The credential is stable for the
    /// lifetime of a compatible Native Binding and changes when that Binding is
    /// replaced or after Rovai-ai restarts. A newly reserved Binding is
    /// deliberately unusable until the Adapter attaches a concrete Native
    /// Session through `BindNativeSessionCommand`.
    pub fn prepare_binding_credential(
        &self,
        database: &mut Database,
        agent_run_id: &str,
        execution_epoch: i64,
        force_new_binding: bool,
    ) -> Result<BuiltinToolBindingCredential> {
        self.prepare_binding(database, agent_run_id, execution_epoch, force_new_binding)
    }

    fn prepare_binding(
        &self,
        database: &mut Database,
        agent_run_id: &str,
        execution_epoch: i64,
        force_new_binding: bool,
    ) -> Result<BuiltinToolBindingCredential> {
        if agent_run_id.trim().is_empty() || execution_epoch <= 0 {
            return Err(invocation_error(
                "team_tool.invalid_binding_request",
                "AgentRun ID and execution epoch are required",
            ));
        }
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let now = camp_turn_execution_budget_now().to_rfc3339();
        let binding = transaction
            .query_row(
                r#"
                SELECT conversation.camp_id, conversation.id,
                       conversation.native_binding_id,
                       conversation.native_binding_generation,
                       conversation.native_adapter_installation_id,
                       conversation.native_session_id,
                       conversation.native_binding_compatibility_digest,
                       conversation.native_installation_generation,
                       conversation.native_session_compatibility_key,
                       conversation.version,
                       agent_run.runtime_adapter_kind,
                       agent_run.runtime_capabilities_json,
                       agent_run.runtime_installation_id,
                       agent_run.runtime_binding_compatibility_digest,
                       agent_run.runtime_installation_generation,
                       agent_run.runtime_native_session_compatibility_key
                FROM agent_run
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                JOIN camp ON camp.id = camp_turn.camp_id
                JOIN conversation ON conversation.id = agent_run.conversation_id
                JOIN camp_member
                  ON camp_member.camp_id = camp.id
                 AND camp_member.agent_id = conversation.agent_id
                JOIN agent_profile ON agent_profile.id = conversation.agent_id
                WHERE agent_run.id = ?1
                  AND agent_run.execution_epoch = ?2
                  AND agent_run.status = 'running'
                  AND agent_run.cancel_requested_at IS NULL
                  AND camp_turn.status IN ('running', 'waiting')
                  AND camp_turn.cancel_requested_at IS NULL
                  AND camp_turn.execution_budget_exhausted_at IS NULL
                  AND camp_turn.execution_budget_deadline_at > ?3
                  AND camp_member.status = 'active'
                  AND camp_member.leave_requested_at IS NULL
                "#,
                params![agent_run_id, execution_epoch, now],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, Option<i64>>(7)?,
                        row.get::<_, Option<String>>(8)?,
                        row.get::<_, i64>(9)?,
                        row.get::<_, Option<String>>(10)?,
                        row.get::<_, Option<String>>(11)?,
                        row.get::<_, Option<String>>(12)?,
                        row.get::<_, Option<String>>(13)?,
                        row.get::<_, Option<i64>>(14)?,
                        row.get::<_, Option<String>>(15)?,
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
            current_installation_generation,
            current_session_compatibility_key,
            conversation_version,
            adapter_kind,
            _capabilities,
            frozen_installation_id,
            frozen_compatibility_digest,
            frozen_installation_generation,
            frozen_session_compatibility_key,
        )) = binding
        else {
            return Err(invocation_error(
                "team_tool.binding_unavailable",
                "AgentRun is not current and active",
            ));
        };
        ensure_runtime_is_frozen(adapter_kind.as_deref())?;
        let frozen_installation_id = frozen_installation_id
            .context("Team Tool AgentRun has no frozen Runtime installation")?;
        let frozen_compatibility_digest = frozen_compatibility_digest
            .context("Team Tool AgentRun has no frozen Native Binding compatibility digest")?;
        let frozen_installation_generation = frozen_installation_generation
            .context("Team Tool AgentRun has no frozen installation generation")?;

        let compatible_binding = current_binding_id.is_some()
            && current_generation >= 1
            && current_installation_id.as_deref() == Some(frozen_installation_id.as_str())
            && current_compatibility_digest.as_deref()
                == Some(frozen_compatibility_digest.as_str())
            && match (
                current_session_compatibility_key.as_deref(),
                frozen_session_compatibility_key.as_deref(),
            ) {
                (Some(previous), Some(current)) => previous == current,
                (None, None) => current_installation_generation.is_some_and(|generation| {
                    generation == frozen_installation_generation
                        || current_native_session_id.is_some()
                }),
                _ => false,
            };
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
                    native_installation_generation = ?11,
                    native_session_compatibility_key = ?12,
                    native_binding_id = ?4,
                    native_binding_generation = ?5,
                    native_binding_secret_digest = ?6,
                    last_accepted_public_boundary_sequence = 0,
                    native_charter_digest = NULL,
                    native_collaboration_state_digest = NULL,
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
                    frozen_installation_generation,
                    frozen_session_compatibility_key,
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
                    "builtin_tool.binding_credential_issued"
                } else {
                    "builtin_tool.binding_credential_refreshed"
                },
                Some(&camp_id),
                Some(("conversation", &conversation_id)),
                &ActorRef::System {
                    component_id: "builtin-tool-credential-issuer".to_string(),
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
        Ok(BuiltinToolBindingCredential {
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
    ) -> Result<BuiltinToolBindingCredential> {
        self.prepare_binding_credential(database, agent_run_id, execution_epoch, false)
    }

    pub fn send_public_message(
        &self,
        database: &mut Database,
        invocation: &CampMessageSendInvocation,
    ) -> Result<CommandExecution> {
        self.send_public_message_authorized(database, invocation, None)
    }

    pub fn send_public_message_attested(
        &self,
        database: &mut Database,
        invocation: &CampMessageSendInvocation,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<CommandExecution> {
        if agent_run_id.trim().is_empty() || execution_epoch <= 0 {
            return Err(invocation_error(
                "team_tool.invalid_attested_run",
                "Attested AgentRun identity is incomplete",
            ));
        }
        self.send_public_message_authorized(
            database,
            invocation,
            Some((agent_run_id, execution_epoch)),
        )
    }

    fn send_public_message_authorized(
        &self,
        database: &mut Database,
        invocation: &CampMessageSendInvocation,
        attested_run: Option<(&str, i64)>,
    ) -> Result<CommandExecution> {
        validate_public_send_invocation(invocation)?;
        let supplied_credential_digest = credential_digest(&invocation.binding_credential);
        let command_id = team_command_id(
            &invocation.native_binding_id,
            &supplied_credential_digest,
            &invocation.runtime_tool_call_id,
        )?;
        if let Some(recorded) =
            load_recorded_team_command_identity(database.connection(), &command_id)?
        {
            if attested_run.is_some_and(|(agent_run_id, execution_epoch)| {
                recorded.source_agent_run_id != agent_run_id
                    || recorded.execution_epoch != execution_epoch
            }) {
                return Err(invocation_error(
                    "team_tool.binding_fenced",
                    "Recorded public send belongs to a different attested AgentRun",
                ));
            }
            let command = CampMessageSendCommand {
                native_binding_id: invocation.native_binding_id.clone(),
                credential_digest: supplied_credential_digest.clone(),
                runtime_tool_call_id: invocation.runtime_tool_call_id.clone(),
                camp_id: recorded.camp_id.clone(),
                body: invocation.input.body.clone(),
                to: invocation.input.to.clone(),
                reply_to_camp_message_id: invocation.input.reply_to_camp_message_id.clone(),
                task_id: invocation.input.task_id.clone(),
            };
            let replay_envelope = CommandEnvelope {
                command_id: command_id.clone(),
                actor: ActorRef::Agent {
                    agent_id: recorded.agent_id,
                    source_agent_run_id: recorded.source_agent_run_id,
                },
                camp_id: Some(recorded.camp_id),
                expected_versions: Vec::new(),
                execution_epoch: Some(recorded.execution_epoch),
                payload: command.clone(),
            };
            return self
                .gateway
                .replay_if_recorded(database, &replay_envelope)?
                .context("recorded public send disappeared before replay");
        }

        let sender = resolve_sender_identity(
            database.connection(),
            &invocation.native_binding_id,
            &supplied_credential_digest,
            attested_run,
        )?;
        let command = CampMessageSendCommand {
            native_binding_id: invocation.native_binding_id.clone(),
            credential_digest: supplied_credential_digest.clone(),
            runtime_tool_call_id: invocation.runtime_tool_call_id.clone(),
            camp_id: sender.camp_id.clone(),
            body: invocation.input.body.clone(),
            to: invocation.input.to.clone(),
            reply_to_camp_message_id: invocation.input.reply_to_camp_message_id.clone(),
            task_id: invocation.input.task_id.clone(),
        };
        let envelope = CommandEnvelope {
            command_id,
            actor: ActorRef::Agent {
                agent_id: sender.agent_id.clone(),
                source_agent_run_id: sender.agent_run_id.clone(),
            },
            camp_id: Some(sender.camp_id.clone()),
            expected_versions: Vec::new(),
            execution_epoch: Some(sender.execution_epoch),
            payload: command,
        };

        let execution = self.gateway.execute(database, &envelope, |transaction| {
            let current = match resolve_sender_identity_by_digest(
                transaction,
                &envelope.payload.native_binding_id,
                &envelope.payload.credential_digest,
                attested_run,
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
                || current.agent_id != sender.agent_id
                || current.camp_id != sender.camp_id
                || current.credential_digest != sender.credential_digest
            {
                return Ok(rejected(
                    "team_tool.binding_fenced",
                    "Native Binding changed before the public send transaction",
                ));
            }
            if envelope.camp_id.as_deref() != Some(current.camp_id.as_str())
                || envelope.payload.camp_id != current.camp_id
            {
                return Err(anyhow::anyhow!(
                    "internal camp identity invariant violated for public message send"
                ));
            }
            persist_public_a2a_message(
                transaction,
                &SendPublicA2aMessage {
                    command_id: &envelope.command_id,
                    camp_id: &current.camp_id,
                    camp_turn_id: &current.camp_turn_id,
                    source_agent_run_id: &current.agent_run_id,
                    author_agent_id: &current.agent_id,
                    execution_epoch: current.execution_epoch,
                    current_a2a_root_agent_run_id: current.a2a_root_agent_run_id.as_deref(),
                    current_a2a_depth: current.a2a_depth,
                    body: &envelope.payload.body,
                    explicit_recipients: &envelope.payload.to,
                    reply_to_camp_message_id: envelope.payload.reply_to_camp_message_id.as_deref(),
                    task_id: envelope.payload.task_id.as_deref(),
                },
            )
        })?;
        if !execution.replayed
            && execution.result.status != crate::command::CommandResultStatus::Rejected
        {
            let delivery_ids = execution.result.payload["deliveryIds"]
                .as_array()
                .context("accepted public send has no deliveryIds")?
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .map(str::to_string)
                        .context("accepted public send has an invalid deliveryId")
                })
                .collect::<Result<Vec<_>>>()?;
            dispatch_accepted_deliveries(database, &delivery_ids)?;
        }
        Ok(execution)
    }

    pub fn create_task(
        &self,
        database: &mut Database,
        invocation: &TeamTaskToolInvocation<TeamCreateTaskInput>,
    ) -> Result<CommandExecution> {
        self.create_task_authorized(database, invocation, None)
    }

    pub fn create_task_attested(
        &self,
        database: &mut Database,
        invocation: &TeamTaskToolInvocation<TeamCreateTaskInput>,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<CommandExecution> {
        self.create_task_authorized(database, invocation, Some((agent_run_id, execution_epoch)))
    }

    fn create_task_authorized(
        &self,
        database: &mut Database,
        invocation: &TeamTaskToolInvocation<TeamCreateTaskInput>,
        attested_run: Option<(&str, i64)>,
    ) -> Result<CommandExecution> {
        validate_task_invocation_identity(invocation)?;
        let supplied_credential_digest = credential_digest(&invocation.binding_credential);
        let sender = resolve_sender_identity(
            database.connection(),
            &invocation.native_binding_id,
            &supplied_credential_digest,
            attested_run,
        )?;
        let envelope = CommandEnvelope {
            command_id: team_command_id(
                &invocation.native_binding_id,
                &supplied_credential_digest,
                &invocation.runtime_tool_call_id,
            )?,
            actor: ActorRef::Agent {
                agent_id: sender.agent_id,
                source_agent_run_id: sender.agent_run_id,
            },
            camp_id: Some(sender.camp_id.clone()),
            expected_versions: Vec::new(),
            execution_epoch: Some(sender.execution_epoch),
            payload: CreateTaskCommand {
                camp_id: sender.camp_id,
                title: invocation.input.title.clone(),
                description: invocation.input.description.clone(),
                acceptance_criteria: invocation.input.acceptance_criteria.clone(),
                assignee_agent_id: invocation.input.assignee_agent_id.clone(),
            },
        };
        CollaborationService::default().create_task(database, &envelope)
    }

    pub fn get_task(
        &self,
        database: &Database,
        invocation: &TeamTaskToolInvocation<TeamGetTaskInput>,
    ) -> Result<TaskDetail> {
        self.get_task_authorized(database, invocation, None)
    }

    pub fn get_task_attested(
        &self,
        database: &Database,
        invocation: &TeamTaskToolInvocation<TeamGetTaskInput>,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<TaskDetail> {
        self.get_task_authorized(database, invocation, Some((agent_run_id, execution_epoch)))
    }

    fn get_task_authorized(
        &self,
        database: &Database,
        invocation: &TeamTaskToolInvocation<TeamGetTaskInput>,
        attested_run: Option<(&str, i64)>,
    ) -> Result<TaskDetail> {
        validate_task_invocation_identity(invocation)?;
        if invocation.input.task_id.trim().is_empty() {
            return Err(invocation_error(
                "team_tool.invalid_input",
                "taskId must not be empty",
            ));
        }
        let supplied_credential_digest = credential_digest(&invocation.binding_credential);
        let sender = resolve_sender_identity(
            database.connection(),
            &invocation.native_binding_id,
            &supplied_credential_digest,
            attested_run,
        )?;
        CollaborationService::default()
            .get_visible_task(
                database,
                &sender.camp_id,
                &invocation.input.task_id,
                &ActorRef::Agent {
                    agent_id: sender.agent_id,
                    source_agent_run_id: sender.agent_run_id,
                },
                Some(sender.execution_epoch),
            )?
            .ok_or_else(|| invocation_error("task.not_found", "Task does not exist"))
    }

    pub fn update_task(
        &self,
        database: &mut Database,
        invocation: &TeamTaskToolInvocation<TeamUpdateTaskInput>,
    ) -> Result<CommandExecution> {
        self.update_task_authorized(database, invocation, None)
    }

    pub fn update_task_attested(
        &self,
        database: &mut Database,
        invocation: &TeamTaskToolInvocation<TeamUpdateTaskInput>,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<CommandExecution> {
        self.update_task_authorized(database, invocation, Some((agent_run_id, execution_epoch)))
    }

    fn update_task_authorized(
        &self,
        database: &mut Database,
        invocation: &TeamTaskToolInvocation<TeamUpdateTaskInput>,
        attested_run: Option<(&str, i64)>,
    ) -> Result<CommandExecution> {
        validate_task_invocation_identity(invocation)?;
        let supplied_credential_digest = credential_digest(&invocation.binding_credential);
        let sender = resolve_sender_identity(
            database.connection(),
            &invocation.native_binding_id,
            &supplied_credential_digest,
            attested_run,
        )?;
        if invocation.input.clear_assignee
            && matches!(invocation.input.assignee_agent_id, NullableInput::Value(_))
        {
            return Err(invocation_error(
                "team_tool.invalid_input",
                "clearAssignee cannot be combined with assigneeAgentId",
            ));
        }
        if matches!(invocation.input.assignee_agent_id, NullableInput::Null) {
            return Err(invocation_error(
                "team_tool.invalid_input",
                "assigneeAgentId must not be null; use clearAssignee",
            ));
        }
        if invocation.input.clear_acceptance_criteria
            && invocation.input.acceptance_criteria.is_some()
        {
            return Err(invocation_error(
                "team_tool.invalid_input",
                "clearAcceptanceCriteria cannot be combined with acceptanceCriteria",
            ));
        }
        let assignee = match (
            &invocation.input.assignee_agent_id,
            invocation.input.clear_assignee,
        ) {
            (_, true) => TaskAssigneeUpdate::Clear,
            (NullableInput::Missing, false) => TaskAssigneeUpdate::Unchanged,
            (NullableInput::Null, false) => unreachable!("null assignee rejected above"),
            (NullableInput::Value(agent_id), false) => TaskAssigneeUpdate::Assign {
                agent_id: agent_id.clone(),
            },
        };
        let acceptance_criteria = match (
            invocation.input.acceptance_criteria.as_ref(),
            invocation.input.clear_acceptance_criteria,
        ) {
            (_, true) => TaskAcceptanceCriteriaUpdate::Clear,
            (Some(items), false) => TaskAcceptanceCriteriaUpdate::Replace {
                items: items.clone(),
            },
            (None, false) => TaskAcceptanceCriteriaUpdate::Unchanged,
        };
        let envelope = CommandEnvelope {
            command_id: team_command_id(
                &invocation.native_binding_id,
                &supplied_credential_digest,
                &invocation.runtime_tool_call_id,
            )?,
            actor: ActorRef::Agent {
                agent_id: sender.agent_id,
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
                acceptance_criteria,
                status: invocation.input.status,
                assignee,
                blocked_reason: invocation.input.blocked_reason.clone(),
                completion_summary: invocation.input.completion_summary.clone(),
                cancel_reason: invocation.input.cancel_reason.clone(),
            },
        };
        CollaborationService::default().update_task(database, &envelope)
    }

    pub fn list_tasks(
        &self,
        database: &Database,
        invocation: &TeamTaskToolInvocation<TeamListTasksInput>,
    ) -> Result<TaskListPage> {
        self.list_tasks_authorized(database, invocation, None)
    }

    pub fn list_tasks_attested(
        &self,
        database: &Database,
        invocation: &TeamTaskToolInvocation<TeamListTasksInput>,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<TaskListPage> {
        self.list_tasks_authorized(database, invocation, Some((agent_run_id, execution_epoch)))
    }

    fn list_tasks_authorized(
        &self,
        database: &Database,
        invocation: &TeamTaskToolInvocation<TeamListTasksInput>,
        attested_run: Option<(&str, i64)>,
    ) -> Result<TaskListPage> {
        validate_task_invocation_identity(invocation)?;
        let supplied_credential_digest = credential_digest(&invocation.binding_credential);
        let sender = resolve_sender_identity(
            database.connection(),
            &invocation.native_binding_id,
            &supplied_credential_digest,
            attested_run,
        )?;
        if invocation.input.unassigned_only
            && matches!(invocation.input.assignee_agent_id, NullableInput::Value(_))
        {
            return Err(invocation_error(
                "team_tool.invalid_input",
                "unassignedOnly cannot be combined with assigneeAgentId",
            ));
        }
        let assignee = match (
            &invocation.input.assignee_agent_id,
            invocation.input.unassigned_only,
        ) {
            (_, true) => TaskAssigneeFilter::Unassigned,
            (NullableInput::Missing, false) => TaskAssigneeFilter::Any,
            (NullableInput::Null, false) => TaskAssigneeFilter::Unassigned,
            (NullableInput::Value(agent_id), false) => TaskAssigneeFilter::Agent {
                agent_id: agent_id.clone(),
            },
        };
        CollaborationService::default().query_visible_tasks(
            database,
            &sender.camp_id,
            &ActorRef::Agent {
                agent_id: sender.agent_id,
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

fn validate_public_send_invocation(invocation: &CampMessageSendInvocation) -> Result<()> {
    validate_invocation_identity(
        &invocation.native_binding_id,
        &invocation.binding_credential,
        &invocation.runtime_tool_call_id,
    )?;
    if invocation.input.body.trim().is_empty() {
        return Err(invocation_error(
            "message.invalid_input",
            "a non-empty body is required",
        ));
    }
    if invocation.input.body.len() > CAMP_MESSAGE_SEND_MAX_BODY_BYTES {
        return Err(invocation_error(
            "message.body_too_large",
            "Public message body exceeds the 32 KiB send limit",
        ));
    }
    if invocation.input.to.len() > 16 {
        return Err(invocation_error(
            "message.fanout_exceeded",
            "The explicit recipient input exceeds the absolute fanout limit of 16",
        ));
    }
    if invocation
        .input
        .reply_to_camp_message_id
        .as_deref()
        .is_some_and(|value| value.trim().is_empty())
        || invocation
            .input
            .task_id
            .as_deref()
            .is_some_and(|value| value.trim().is_empty())
    {
        return Err(invocation_error(
            "message.invalid_input",
            "replyToCampMessageId and taskId must not be empty when supplied",
        ));
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
    attested_run: Option<(&str, i64)>,
) -> Result<SenderIdentity> {
    resolve_sender_identity_by_digest(
        connection,
        native_binding_id,
        credential_digest,
        attested_run,
    )
}

fn resolve_sender_identity_by_digest(
    connection: &Connection,
    native_binding_id: &str,
    credential_digest: &str,
    attested_run: Option<(&str, i64)>,
) -> Result<SenderIdentity> {
    let identity = connection
        .query_row(
            r#"
            SELECT conversation.camp_id, conversation.agent_id,
                   agent_run.id, agent_run.execution_epoch,
                   agent_run.camp_turn_id,
                   agent_run.a2a_root_agent_run_id, agent_run.a2a_depth,
                   agent_run.runtime_adapter_kind,
                   agent_run.runtime_capabilities_json,
                   conversation.native_binding_secret_digest,
                   agent_run.effective_config_json
            FROM conversation
            JOIN camp ON camp.id = conversation.camp_id
            JOIN camp_member
              ON camp_member.camp_id = conversation.camp_id
             AND camp_member.agent_id = conversation.agent_id
            JOIN agent_profile ON agent_profile.id = conversation.agent_id
            JOIN agent_run ON agent_run.conversation_id = conversation.id
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE conversation.native_binding_id = ?1
              AND conversation.native_binding_secret_digest = ?2
              AND (
                    (?3 IS NULL AND conversation.native_session_id IS NOT NULL)
                 OR (?3 IS NOT NULL AND agent_run.id = ?3 AND agent_run.execution_epoch = ?4)
              )
              AND agent_run.status = 'running'
              AND agent_run.cancel_requested_at IS NULL
              AND camp_turn.status IN ('running', 'waiting')
              AND camp_turn.cancel_requested_at IS NULL
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
            "#,
            params![
                native_binding_id,
                credential_digest,
                attested_run.map(|value| value.0),
                attested_run.map(|value| value.1),
            ],
            |row| {
                Ok((
                    SenderIdentity {
                        camp_id: row.get(0)?,
                        agent_id: row.get(1)?,
                        agent_run_id: row.get(2)?,
                        execution_epoch: row.get(3)?,
                        camp_turn_id: row.get(4)?,
                        a2a_root_agent_run_id: row.get(5)?,
                        a2a_depth: row.get(6)?,
                        credential_digest: row.get(9)?,
                    },
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(10)?,
                ))
            },
        )
        .optional()?;
    let Some((identity, adapter_kind, _capabilities, _effective_config)) = identity else {
        return Err(invocation_error(
            "team_tool.binding_fenced",
            "Native Binding credential does not resolve to one current active AgentRun",
        ));
    };
    ensure_runtime_is_frozen(adapter_kind.as_deref())?;
    Ok(identity)
}

fn ensure_runtime_is_frozen(adapter_kind: Option<&str>) -> Result<()> {
    let Some(adapter_kind) = adapter_kind else {
        return Err(invocation_error(
            "team_tool.runtime_not_frozen",
            "AgentRun has no frozen Runtime Adapter",
        ));
    };
    let _adapter_kind = adapter_kind.parse::<AdapterKind>()?;
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
    digest.update(b"rovai-team-binding-v1\0");
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
    Ok(format!("builtin-tool-{digest}"))
}

fn load_recorded_team_command_identity(
    connection: &Connection,
    command_id: &str,
) -> Result<Option<RecordedTeamCommandIdentity>> {
    let recorded = connection
        .query_row(
            r#"
            SELECT camp_id, actor_type, actor_id, source_agent_run_id, execution_epoch
            FROM event_log
            WHERE event_type = 'command.result' AND command_id = ?1
            "#,
            [command_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((camp_id, actor_type, agent_id, source_agent_run_id, execution_epoch)) = recorded
    else {
        return Ok(None);
    };
    if actor_type != "agent" {
        anyhow::bail!("recorded Team Tool command actor is not an Agent");
    }
    Ok(Some(RecordedTeamCommandIdentity {
        camp_id: camp_id.context("recorded Team Tool command has no Camp")?,
        agent_id,
        source_agent_run_id: source_agent_run_id
            .context("recorded Team Tool command has no source AgentRun")?,
        execution_epoch: execution_epoch
            .context("recorded Team Tool command has no execution epoch")?,
    }))
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
            ExecutionRequest, TestCampMessageAddress, TestCampMessageCommand,
        },
        command::{CommandGatewayError, CommandResultStatus},
        context::{
            CharterDeliveryMode, ContextMaterialization, ContextService,
            DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES, MaterializeContextRequest,
        },
        managed_blob::ManagedBlobStore,
        memory::{
            AcceptHearthMemoryProposalCommand, CreateMemoryCommand, ForgetMemoryCommand,
            MemoryCreationOrigin, MemoryKind, MemoryScopeKind, MemoryService, RetireMemoryCommand,
            ReviseMemoryCommand,
        },
        memory_retrieval::{
            MemoryCacheState, MemoryReadInput, MemoryRetrievalInvocation, MemoryRetrievalService,
            MemorySearchInput,
        },
        memory_tool::{
            HearthProposalToolInput, HearthProposalToolInvocation, MemoryToolService,
            MemoryWriteToolInput, MemoryWriteToolInvocation,
        },
        runtime::{
            BindNativeSessionCommand, ClaimAgentRunCommand, ExecutionRuntimeService,
            SucceedAgentRunCommand,
        },
    };

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

    struct Fixture {
        database: Database,
        directory: std::path::PathBuf,
        camp_id: String,
        task_id: String,
        source_run_id: String,
        source_epoch: i64,
        credential: BuiltinToolBindingCredential,
    }

    impl Fixture {
        fn new() -> Self {
            let directory =
                std::env::temp_dir().join(format!("rovai-team-tool-test-{}", Uuid::new_v4()));
            let workspace = directory.join("workspace");
            std::fs::create_dir_all(&workspace).expect("workspace should exist");
            let mut database = Database::open(&directory).expect("database should open");
            configure_test_runtime(&database, &["agent_1", "agent_2"]);
            let collaboration = CollaborationService::default();
            let camp = collaboration
                .create_camp(
                    &mut database,
                    &user_envelope(
                        "create-team-camp",
                        None,
                        CreateCampCommand::for_test_with_members(
                            workspace.to_string_lossy().to_string(),
                            &["agent_1", "agent_2"],
                            "agent_1",
                        ),
                    ),
                )
                .expect("Camp should be created");
            let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
            for (index, agent_id) in ["agent_1", "agent_2"].iter().enumerate() {
                collaboration
                    .add_camp_member(
                        &mut database,
                        &user_envelope(
                            &format!("add-member-{index}"),
                            Some(&camp_id),
                            AddCampMemberCommand {
                                camp_id: camp_id.clone(),
                                agent_id: (*agent_id).to_string(),
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
                            assignee_agent_id: Some("agent_1".to_string()),
                            ..Default::default()
                        },
                    ),
                )
                .expect("Task should be created");
            let task_id = task.result.payload["taskId"].as_str().unwrap().to_string();
            let send = collaboration
                .send_test_camp_message(
                    &mut database,
                    &user_envelope(
                        "queue-source-run",
                        Some(&camp_id),
                        TestCampMessageCommand {
                            camp_id: camp_id.clone(),
                            draft_revision: None,
                            body: "Start the collaboration".to_string(),
                            prepared_attachment_ids: Vec::new(),
                            address: TestCampMessageAddress::Explicit {
                                agent_ids: vec!["agent_1".to_string()],
                            },
                            reply_to_camp_message_id: None,
                            execution: Some(ExecutionRequest {
                                task_id: Some(task_id.clone()),
                                purpose: "Coordinate work".to_string(),
                                expected_output: "A useful answer".to_string(),
                                completion_role: "required".to_string(),
                                budget: None,
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
                            starting_git_observation: None,
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

        fn public_send_invocation(
            &self,
            call_id: &str,
            body: &str,
            to: &[&str],
        ) -> CampMessageSendInvocation {
            CampMessageSendInvocation {
                native_binding_id: self.credential.native_binding_id.clone(),
                binding_credential: self.credential.binding_credential.clone(),
                runtime_tool_call_id: call_id.to_string(),
                input: CampMessageSendInput {
                    body: body.to_string(),
                    to: to.iter().map(|value| (*value).to_string()).collect(),
                    reply_to_camp_message_id: None,
                    task_id: None,
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
        ) -> (i64, BuiltinToolBindingCredential) {
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
                            starting_git_observation: None,
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

        fn succeed_run(&mut self, agent_run_id: &str, execution_epoch: i64, output: &str) {
            let runtime = ExecutionRuntimeService::default();
            let execution = runtime
                .load_agent_run_execution(&self.database, agent_run_id, execution_epoch)
                .unwrap()
                .expect("claimed AgentRun should remain executable");
            let completed = runtime
                .succeed_agent_run(
                    &mut self.database,
                    &CommandEnvelope {
                        command_id: format!("succeed-{agent_run_id}"),
                        actor: ActorRef::System {
                            component_id: "runtime-adapter:codex-cli".to_string(),
                        },
                        camp_id: Some(self.camp_id.clone()),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: SucceedAgentRunCommand {
                            agent_run_id: agent_run_id.to_string(),
                            expected_version: execution.version,
                            execution_epoch,
                            native_turn_id: format!("native-turn-{agent_run_id}"),
                            final_output: output.to_string(),
                            ending_git_observation: None,
                        },
                    },
                )
                .expect("AgentRun should complete");
            assert_eq!(completed.result.status, CommandResultStatus::Applied);
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let replacement = std::env::temp_dir().join(format!("rovai-drop-{}", Uuid::new_v4()));
            let database = Database::open(&replacement).expect("replacement database should open");
            let old = std::mem::replace(&mut self.database, database);
            drop(old);
            let _ = std::fs::remove_dir_all(&self.directory);
            let _ = std::fs::remove_dir_all(replacement);
        }
    }

    #[test]
    fn public_send_atomically_persists_one_message_and_canonical_deliveries() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let before_slots: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT a2a_run_slots_allocated FROM camp_turn WHERE id = (SELECT camp_turn_id FROM agent_run WHERE id = ?1)",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        let invocation = fixture.public_send_invocation(
            "public-send-union",
            "Please inspect this @agent_2",
            &["agent_2"],
        );
        let sent = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        assert_eq!(sent.result.status, CommandResultStatus::Accepted);
        assert_eq!(sent.result.code, "camp_message.send_accepted");
        assert_eq!(sent.result.payload["visibility"], "camp_public");
        assert_eq!(
            sent.result.payload["effectiveRecipients"],
            json!(["agent_2"])
        );
        assert_eq!(
            sent.result.payload["deliveryIds"].as_array().unwrap().len(),
            1
        );

        let message_id = sent.result.payload["messageId"].as_str().unwrap();
        let message: (String, String, String, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT body, effective_recipient_ids_json,
                       recipient_presentation_json, source_operation_id
                FROM camp_message WHERE id = ?1
                "#,
                [message_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(message.0, "Please inspect this @agent_2");
        assert_eq!(message.1, r#"["agent_2"]"#);
        assert_eq!(
            serde_json::from_str::<Value>(&message.2).unwrap()["inlineOrder"],
            json!(["agent_2"])
        );
        assert!(!message.3.is_empty());

        let delivery: (String, String, i64, i64, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT recipient_agent_id, status, dispatch_attempt_count,
                       a2a_depth, target_agent_run_id
                FROM message_delivery WHERE message_id = ?1
                "#,
                [message_id],
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
        assert_eq!(delivery.0, "agent_2");
        assert_eq!(delivery.1, "running");
        assert_eq!(delivery.2, 1);
        assert_eq!(delivery.3, 1);
        assert!(delivery.4.is_some());
        let after_slots: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT a2a_run_slots_allocated FROM camp_turn WHERE id = (SELECT camp_turn_id FROM agent_run WHERE id = ?1)",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(after_slots, before_slots + 1);
        let replay = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result.payload["messageId"], message_id);

        let source_run_id = fixture.source_run_id.clone();
        fixture.succeed_run(&source_run_id, fixture.source_epoch, "source completed");
        let durable_replay = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        assert!(durable_replay.replayed);
        assert_eq!(durable_replay.result.payload["messageId"], message_id);
    }

    #[test]
    fn public_only_send_consumes_no_a2a_slot() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let before: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT SUM(a2a_run_slots_allocated) FROM camp_turn",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let invocation = fixture.public_send_invocation(
            "public-only-send",
            "A public progress fact with no recipient.",
            &[],
        );
        let sent = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        assert_eq!(sent.result.payload["deliveryIds"], json!([]));
        assert_eq!(sent.result.payload["effectiveRecipients"], json!([]));
        let after: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT SUM(a2a_run_slots_allocated) FROM camp_turn",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(after, before);
    }

    #[test]
    fn public_delivery_runtime_consumes_the_pre_run_frozen_context_bytes() {
        let mut fixture = Fixture::new();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id = 'agent_2' WHERE id = ?1",
                [&fixture.camp_id],
            )
            .unwrap();
        let target_task = CollaborationService::default()
            .create_task(
                &mut fixture.database,
                &user_envelope(
                    "create-member-call-source-task",
                    Some(&fixture.camp_id),
                    CreateTaskCommand {
                        camp_id: fixture.camp_id.clone(),
                        title: "Target-owned source identity task".to_string(),
                        description: "Freeze the Public A2A sender identity".to_string(),
                        assignee_agent_id: Some("agent_2".to_string()),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        let target_task_id = target_task.result.payload["taskId"]
            .as_str()
            .unwrap()
            .to_string();
        let source_name: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT display_name FROM agent_profile WHERE id = 'agent_1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let mut invocation = fixture.public_send_invocation(
            "frozen-public-context",
            "Use this exact public input @agent_2",
            &["agent_2"],
        );
        invocation.input.task_id = Some(target_task_id);
        let sent = TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        let source_message_id = sent.result.payload["messageId"]
            .as_str()
            .unwrap()
            .to_string();
        let delivery_id = sent.result.payload["deliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let (target_run_id, frozen_snapshot): (String, String) = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id, frozen_snapshot_json FROM message_delivery WHERE id = ?1",
                [&delivery_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let frozen_snapshot: Value = serde_json::from_str(&frozen_snapshot).unwrap();
        let frozen_payload = frozen_snapshot["frozenContext"]["renderedPayload"]
            .as_str()
            .unwrap()
            .to_string();
        let current_input = |payload: &str| -> Value {
            serde_json::from_str(
                payload
                    .split("[CURRENT_INPUT]\n")
                    .nth(1)
                    .unwrap()
                    .split("\n[/CURRENT_INPUT]")
                    .next()
                    .unwrap(),
            )
            .unwrap()
        };
        let frozen_current_input = current_input(&frozen_payload);
        assert_eq!(
            frozen_current_input["source"],
            json!({
                "type": "member_call",
                "senderAgentId": "agent_1",
                "senderName": source_name,
            })
        );
        assert_ne!(frozen_current_input["source"]["senderAgentId"], "agent_2");
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_profile SET display_name = 'RENAMED_AFTER_PREFLIGHT' WHERE id = 'agent_1'",
                [],
            )
            .unwrap();
        let (target_epoch, _) =
            fixture.claim_bind_and_issue(&target_run_id, "native-frozen-public-context");
        let ContextMaterialization::Ready(context) = ContextService
            .materialize(
                &mut fixture.database,
                &ManagedBlobStore::new(&fixture.directory),
                &MaterializeContextRequest {
                    agent_run_id: &target_run_id,
                    execution_epoch: target_epoch,
                    charter_delivery_mode: CharterDeliveryMode::NativeAppend,
                    max_payload_bytes: DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
                },
            )
            .unwrap()
        else {
            panic!("Public Delivery context should materialize");
        };
        assert_eq!(context.rendered_payload, frozen_payload);
        assert_eq!(
            current_input(&context.rendered_payload),
            frozen_current_input
        );
        let manifest_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT context_manifest_id FROM message_delivery WHERE id = ?1",
                [&delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(manifest_id, context.manifest_id);
        let current_input_evidence: Value = fixture
            .database
            .connection()
            .query_row(
                "SELECT current_input_source_json FROM context_manifest WHERE id = ?1",
                [&context.manifest_id],
                |row| row.get::<_, String>(0),
            )
            .map(|value| serde_json::from_str(&value).unwrap())
            .unwrap();
        assert_eq!(
            current_input_evidence["sourceCampMessageId"],
            source_message_id
        );
    }

    #[test]
    fn public_delivery_source_lineage_mismatch_fails_closed_after_preflight() {
        let mut fixture = Fixture::new();
        let invocation = fixture.public_send_invocation(
            "frozen-public-source-mismatch",
            "Preserve this sender lineage @agent_2",
            &["agent_2"],
        );
        let sent = TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        let delivery_id = sent.result.payload["deliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let (target_run_id, message_id): (String, String) = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id, message_id FROM message_delivery WHERE id = ?1",
                [&delivery_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let (target_epoch, _) =
            fixture.claim_bind_and_issue(&target_run_id, "native-source-mismatch");
        fixture
            .database
            .connection()
            .execute(
                "UPDATE camp_message SET source_agent_run_id = NULL WHERE id = ?1",
                [&message_id],
            )
            .unwrap();

        let error = ContextService
            .materialize(
                &mut fixture.database,
                &ManagedBlobStore::new(&fixture.directory),
                &MaterializeContextRequest {
                    agent_run_id: &target_run_id,
                    execution_epoch: target_epoch,
                    charter_delivery_mode: CharterDeliveryMode::NativeAppend,
                    max_payload_bytes: DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
                },
            )
            .unwrap_err();
        assert!(
            format!("{error:#}")
                .contains("A2A Current Input CampMessage author lineage is inconsistent")
        );
    }

    #[test]
    fn task_linked_public_delivery_reuses_exact_run_notice_bytes() {
        let mut fixture = Fixture::new();
        let created = CollaborationService::default()
            .create_task(
                &mut fixture.database,
                &user_envelope(
                    "create-target-task-for-frozen-context",
                    Some(&fixture.camp_id),
                    CreateTaskCommand {
                        camp_id: fixture.camp_id.clone(),
                        title: "Frozen notice task".to_string(),
                        description: "Exercise exact Run Notice bytes".to_string(),
                        assignee_agent_id: Some("agent_2".to_string()),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        let task_id = created.result.payload["taskId"]
            .as_str()
            .unwrap()
            .to_string();
        let mut invocation = fixture.public_send_invocation(
            "frozen-task-run-notice",
            "Use the linked Task context @agent_2",
            &["agent_2"],
        );
        invocation.input.task_id = Some(task_id);
        let sent = TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        let delivery_id = sent.result.payload["deliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let (target_run_id, frozen_snapshot): (String, String) = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id, frozen_snapshot_json FROM message_delivery WHERE id = ?1",
                [&delivery_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let frozen_snapshot: Value = serde_json::from_str(&frozen_snapshot).unwrap();
        let frozen_notice_payload =
            frozen_snapshot["frozenContext"]["manifestSelection"]["runNoticePayload"]
                .as_str()
                .unwrap()
                .to_string();
        assert!(frozen_notice_payload.contains("\"taskId\""));

        let (target_epoch, _) =
            fixture.claim_bind_and_issue(&target_run_id, "native-frozen-task-run-notice");
        let ContextMaterialization::Ready(context) = ContextService
            .materialize(
                &mut fixture.database,
                &ManagedBlobStore::new(&fixture.directory),
                &MaterializeContextRequest {
                    agent_run_id: &target_run_id,
                    execution_epoch: target_epoch,
                    charter_delivery_mode: CharterDeliveryMode::NativeAppend,
                    max_payload_bytes: DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
                },
            )
            .unwrap()
        else {
            panic!("Task-linked Public Delivery context should materialize");
        };
        let run_notice_section = context
            .rendered_payload
            .split("[RUN_NOTICES]\n")
            .nth(1)
            .unwrap()
            .split("\n[/RUN_NOTICES]")
            .next()
            .unwrap();
        let (manifest_payload, manifest_digest): (String, String) = fixture
            .database
            .connection()
            .query_row(
                "SELECT run_notice_payload_json, run_notice_digest FROM context_manifest WHERE id = ?1",
                [&context.manifest_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(run_notice_section, frozen_notice_payload);
        assert_eq!(manifest_payload, frozen_notice_payload);
        assert_eq!(
            manifest_digest,
            format!("sha256:{:x}", Sha256::digest(manifest_payload.as_bytes()))
        );
    }

    #[test]
    fn exact_public_final_output_is_suppressed_once_per_run() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let body = "The exact answer is already public.";
        let invocation = fixture.public_send_invocation("explicit-final", body, &[]);
        let sent = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        let explicit_message_id = sent.result.payload["messageId"]
            .as_str()
            .unwrap()
            .to_string();

        let source_epoch = fixture.source_epoch;
        fixture.succeed_run(&fixture.source_run_id.clone(), source_epoch, body);

        let (message_count, final_message_id, suppressed): (i64, String, bool) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT
                    (SELECT COUNT(*) FROM camp_message
                     WHERE source_agent_run_id = ?1),
                    agent_run.final_camp_message_id,
                    EXISTS(
                        SELECT 1 FROM event_log
                        WHERE event_type = 'agent_run.succeeded'
                          AND entity_type = 'agent_run'
                          AND entity_id = ?1
                          AND json_extract(payload_json, '$.automaticPublicOutputSuppressed') = 1
                    )
                FROM agent_run
                WHERE agent_run.id = ?1
                "#,
                [&fixture.source_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(message_count, 1);
        assert_eq!(final_message_id, explicit_message_id);
        assert!(suppressed);
    }

    #[test]
    fn recipient_bound_public_send_never_suppresses_automatic_final() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let body = "The answer is public for the target, but still needs a final.";
        let invocation =
            fixture.public_send_invocation("recipient-bound-final", body, &["agent_2"]);
        service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();

        fixture.succeed_run(&fixture.source_run_id.clone(), fixture.source_epoch, body);

        let (message_count, suppressed): (i64, bool) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT
                    (SELECT COUNT(*) FROM camp_message WHERE source_agent_run_id = ?1),
                    EXISTS(
                        SELECT 1 FROM event_log
                        WHERE event_type = 'agent_run.succeeded'
                          AND entity_type = 'agent_run'
                          AND entity_id = ?1
                          AND json_extract(payload_json, '$.automaticPublicOutputSuppressed') = 1
                    )
                "#,
                [&fixture.source_run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(message_count, 2);
        assert!(!suppressed);
        let automatic_reply: Option<String> = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT reply_to_camp_message_id
                FROM camp_message
                WHERE source_agent_run_id = ?1 AND source_operation_id IS NULL
                ORDER BY sequence DESC LIMIT 1
                "#,
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(automatic_reply.is_none());
    }

    #[test]
    fn invalid_addressing_reports_all_offenders_and_leaves_no_partial_facts() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let before: (i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                "SELECT (SELECT COUNT(*) FROM camp_message), (SELECT COUNT(*) FROM message_delivery), (SELECT SUM(a2a_run_slots_allocated) FROM camp_turn)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let invocation = fixture.public_send_invocation(
            "invalid-public-send",
            "Malformed @agent_0 and missing @agent_999",
            &["agent_1"],
        );
        let rejected = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(rejected.result.code, "message.addressing_invalid");
        let offenders = rejected.result.payload["details"]["offending"]
            .as_array()
            .unwrap();
        assert_eq!(offenders.len(), 3);
        assert!(offenders.iter().any(|item| item["reason"] == "self_target"));
        assert!(
            offenders
                .iter()
                .any(|item| item["reason"] == "not_current_camp_member")
        );
        assert!(
            offenders
                .iter()
                .any(|item| item["reason"] == "invalid_format")
        );
        assert_eq!(
            rejected.result.payload["details"]["newRequestIdRequired"],
            true
        );
        let after: (i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                "SELECT (SELECT COUNT(*) FROM camp_message), (SELECT COUNT(*) FROM message_delivery), (SELECT SUM(a2a_run_slots_allocated) FROM camp_turn)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(after, before);
    }

    #[test]
    fn task_tool_schemas_use_cross_adapter_assignee_controls() {
        assert!(
            TeamToolService::update_task_input_schema()
                .get("anyOf")
                .is_none(),
            "direct CLI input must remain representable without a root anyOf"
        );
        for schema in [
            TeamToolService::create_task_input_schema(),
            TeamToolService::update_task_input_schema(),
            TeamToolService::list_tasks_input_schema(),
        ] {
            let properties = schema["properties"].as_object().unwrap();
            assert_eq!(properties["assigneeAgentId"]["type"], "string");
            for forbidden in [
                "campId",
                "agentId",
                "sourceAgentRunId",
                "executionEpoch",
                "commandId",
            ] {
                assert!(!properties.contains_key(forbidden));
            }
        }
        assert_eq!(
            TeamToolService::update_task_input_schema()["properties"]["clearAssignee"]["type"],
            "boolean"
        );
        assert_eq!(
            TeamToolService::list_tasks_input_schema()["properties"]["unassignedOnly"]["type"],
            "boolean"
        );
        let missing = serde_json::from_value::<TeamUpdateTaskInput>(json!({
            "taskId": "task-1",
            "expectedVersion": 1,
            "status": "in_progress"
        }))
        .unwrap();
        assert_eq!(missing.assignee_agent_id, NullableInput::Missing);
        assert!(!missing.clear_assignee);
        let clear = serde_json::from_value::<TeamUpdateTaskInput>(json!({
            "taskId": "task-1",
            "expectedVersion": 1,
            "clearAssignee": true
        }))
        .unwrap();
        assert_eq!(clear.assignee_agent_id, NullableInput::Missing);
        assert!(clear.clear_assignee);
        let assign = serde_json::from_value::<TeamUpdateTaskInput>(json!({
            "taskId": "task-1",
            "expectedVersion": 1,
            "assigneeAgentId": "agent_1"
        }))
        .unwrap();
        assert_eq!(
            assign.assignee_agent_id,
            NullableInput::Value("agent_1".to_string())
        );
        assert!(!assign.clear_assignee);
        let legacy_clear = serde_json::from_value::<TeamUpdateTaskInput>(json!({
            "taskId": "task-1",
            "expectedVersion": 1,
            "assigneeAgentId": null
        }))
        .unwrap();
        assert_eq!(legacy_clear.assignee_agent_id, NullableInput::Null);
        assert!(!legacy_clear.clear_assignee);
        let unassigned = serde_json::from_value::<TeamListTasksInput>(json!({
            "unassignedOnly": true
        }))
        .unwrap();
        assert_eq!(unassigned.assignee_agent_id, NullableInput::Missing);
        assert!(unassigned.unassigned_only);
    }

    #[test]
    fn task_tools_are_idempotent_authorized_and_never_wake_an_agent() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let execution_count_before: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM agent_run", [], |row| row.get(0))
            .unwrap();
        let invocation = fixture.task_invocation(
            "create-durable-task",
            TeamCreateTaskInput {
                title: "Persistent follow-up".to_string(),
                description: "Track this across runs".to_string(),
                assignee_agent_id: None,
                ..Default::default()
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
                ..Default::default()
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
                        unassigned_only: false,
                        limit: 50,
                        cursor: None,
                    },
                ),
            )
            .unwrap();
        assert!(listed.tasks.iter().any(|task| task.task_id == task_id));
        let update_invocation = fixture.task_invocation(
            "claim-durable-task",
            TeamUpdateTaskInput {
                task_id: task_id.clone(),
                expected_version: 1,
                title: None,
                description: None,
                status: Some(TaskStatus::InProgress),
                assignee_agent_id: NullableInput::Value("agent_1".to_string()),
                clear_assignee: false,
                ..Default::default()
            },
        );
        let updated = service
            .update_task(&mut fixture.database, &update_invocation)
            .unwrap();
        assert_eq!(updated.result.status, CommandResultStatus::Applied);
        assert_eq!(updated.result.payload["version"], 2);
        let execution_count_after: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM agent_run", [], |row| row.get(0))
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
                "UPDATE camp SET default_lead_agent_id = 'agent_2' WHERE id = ?1",
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
                        assignee_agent_id: Some("agent_2".to_string()),
                        ..Default::default()
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
                        unassigned_only: false,
                        limit: 100,
                        cursor: None,
                    },
                ),
            )
            .unwrap();
        assert!(!listed.tasks.iter().any(|task| task.task_id == hidden_id));
        let event_count_after: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM event_log", [], |row| row.get(0))
            .unwrap();
        assert_eq!(event_count_after, event_count_before);
    }

    #[test]
    fn task_tool_write_is_available_to_every_member_and_keeps_version_fencing() {
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
        let allowed_invocation = fixture.task_invocation(
            "capability-list-does-not-gate-builtin-cli",
            TeamCreateTaskInput {
                title: "Must not exist".to_string(),
                description: String::new(),
                assignee_agent_id: None,
                ..Default::default()
            },
        );
        let allowed = service
            .create_task(&mut fixture.database, &allowed_invocation)
            .unwrap();
        assert_eq!(allowed.result.status, CommandResultStatus::Applied);
        let current_version: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT version FROM task WHERE id = ?1",
                [&fixture.task_id],
                |row| row.get(0),
            )
            .unwrap();

        let stale_invocation = fixture.task_invocation(
            "stale-task-version",
            TeamUpdateTaskInput {
                task_id: fixture.task_id.clone(),
                expected_version: 99,
                title: Some("Must not overwrite".to_string()),
                description: None,
                status: None,
                assignee_agent_id: NullableInput::Missing,
                clear_assignee: false,
                ..Default::default()
            },
        );
        let stale = service
            .update_task(&mut fixture.database, &stale_invocation)
            .unwrap();
        assert_eq!(stale.result.code, "task.version_conflict");
        assert_eq!(stale.result.payload["taskId"], fixture.task_id);
        assert_eq!(stale.result.payload["currentVersion"], current_version);
    }

    #[test]
    fn memory_read_reports_revision_inactive_and_deleted_without_returning_stale_body() {
        let mut fixture = Fixture::new();
        let service = MemoryService::default();
        let created = service
            .create(
                &mut fixture.database,
                &user_envelope(
                    "create-readable-memory",
                    None,
                    CreateMemoryCommand {
                        scope: MemoryScopeKind::Hearth,
                        kind: MemoryKind::Agreement,
                        body: "Use the immutable context manifest during recovery.".to_string(),
                        retrieval_keys: vec!["immutable recovery".to_string()],
                        companion_agent_id: None,
                        relationship_agent_ids: Vec::new(),
                        direction: None,
                        directed_actor_agent_id: None,
                        review_after: None,
                    },
                ),
            )
            .unwrap();
        let memory_id = created.result.payload["memoryId"]
            .as_str()
            .unwrap()
            .to_string();
        let revision_id = created.result.payload["revisionId"]
            .as_str()
            .unwrap()
            .to_string();
        let retrieval = MemoryRetrievalService;
        let search = retrieval
            .search(
                &mut fixture.database,
                &MemoryRetrievalInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "memory-search-current".to_string(),
                    input: MemorySearchInput {
                        query: "immutable recovery".to_string(),
                        limit: Some(6),
                    },
                },
            )
            .unwrap();
        assert_eq!(search.results[0].memory_id, memory_id);
        let current = retrieval
            .read(
                &mut fixture.database,
                &MemoryRetrievalInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "memory-read-current".to_string(),
                    input: MemoryReadInput {
                        memory_ids: vec![memory_id.clone()],
                    },
                },
            )
            .unwrap();
        assert_eq!(current.memories[0].cache_state, MemoryCacheState::Current);
        assert!(
            current.memories[0]
                .body
                .as_deref()
                .unwrap()
                .contains("immutable")
        );

        let revised = service
            .revise(
                &mut fixture.database,
                &user_envelope(
                    "revise-readable-memory",
                    None,
                    ReviseMemoryCommand {
                        memory_id: memory_id.clone(),
                        expected_version: 1,
                        base_revision_id: revision_id,
                        body: "Use the exact immutable context payload during recovery."
                            .to_string(),
                        retrieval_keys: vec!["exact recovery".to_string()],
                        review_after: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(revised.result.status, CommandResultStatus::Applied);
        let changed = retrieval
            .read(
                &mut fixture.database,
                &MemoryRetrievalInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "memory-read-changed".to_string(),
                    input: MemoryReadInput {
                        memory_ids: vec![memory_id.clone()],
                    },
                },
            )
            .unwrap();
        assert_eq!(
            changed.memories[0].cache_state,
            MemoryCacheState::RevisionChanged
        );
        assert_eq!(
            changed.memories[0].body.as_deref(),
            Some("Use the exact immutable context payload during recovery.")
        );

        service
            .retire(
                &mut fixture.database,
                &user_envelope(
                    "retire-readable-memory",
                    None,
                    RetireMemoryCommand {
                        memory_id: memory_id.clone(),
                        expected_version: 2,
                    },
                ),
            )
            .unwrap();
        let inactive = retrieval
            .read(
                &mut fixture.database,
                &MemoryRetrievalInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "memory-read-inactive".to_string(),
                    input: MemoryReadInput {
                        memory_ids: vec![memory_id.clone()],
                    },
                },
            )
            .unwrap();
        assert_eq!(inactive.memories[0].cache_state, MemoryCacheState::Inactive);
        assert!(inactive.memories[0].body.is_none());
        assert!(inactive.memories[0].retrieval_keys.is_empty());

        service
            .forget(
                &mut fixture.database,
                &user_envelope(
                    "forget-readable-memory",
                    None,
                    ForgetMemoryCommand {
                        memory_id: memory_id.clone(),
                        expected_version: 3,
                    },
                ),
            )
            .unwrap();
        let deleted = retrieval
            .read(
                &mut fixture.database,
                &MemoryRetrievalInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "memory-read-deleted".to_string(),
                    input: MemoryReadInput {
                        memory_ids: vec![memory_id, Uuid::new_v4().to_string()],
                    },
                },
            )
            .unwrap();
        assert_eq!(deleted.memories[0].cache_state, MemoryCacheState::Deleted);
        assert_eq!(
            deleted.memories[1].cache_state,
            MemoryCacheState::Unavailable
        );
        assert!(deleted.memories.iter().all(|memory| memory.body.is_none()));
    }

    #[test]
    fn agent_companion_write_is_effective_while_hearth_requires_user_acceptance() {
        let mut fixture = Fixture::new();
        let tools = MemoryToolService;
        let companion = tools
            .write(
                &mut fixture.database,
                &MemoryWriteToolInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "memory-write-companion".to_string(),
                    input: MemoryWriteToolInput {
                        action: "add".to_string(),
                        scope: Some(MemoryScopeKind::Companion),
                        kind: Some(MemoryKind::Lesson),
                        body: "Verify the frozen input digest before recovery.".to_string(),
                        retrieval_keys: vec!["frozen digest".to_string()],
                        counterparty_agent_id: None,
                        direction: None,
                        memory_id: None,
                        base_revision_id: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(companion.result.status, CommandResultStatus::Applied);
        assert_eq!(companion.result.payload["effective"], true);
        let companion_id = companion.result.payload["memoryId"].as_str().unwrap();
        let companion_memory = MemoryService::default()
            .get(&fixture.database, companion_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            companion_memory.creation_origin,
            Some(MemoryCreationOrigin::Agent)
        );
        assert_eq!(companion_memory.lifecycle, "active");

        let proposed = tools
            .propose_hearth(
                &mut fixture.database,
                &HearthProposalToolInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "memory-propose-hearth".to_string(),
                    input: HearthProposalToolInput {
                        action: "add".to_string(),
                        kind: Some(MemoryKind::Agreement),
                        body: "All recovery retries must reuse the exact frozen payload."
                            .to_string(),
                        retrieval_keys: vec!["exact retry".to_string()],
                        memory_id: None,
                        base_revision_id: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(proposed.result.status, CommandResultStatus::Accepted);
        assert_eq!(proposed.result.payload["effective"], false);
        let proposal_id = proposed.result.payload["proposalId"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(
            MemoryService::default()
                .list(&fixture.database)
                .unwrap()
                .memories
                .iter()
                .all(|memory| memory.current_body.as_deref()
                    != Some("All recovery retries must reuse the exact frozen payload."))
        );

        let accepted = MemoryService::default()
            .accept_hearth_proposal(
                &mut fixture.database,
                &user_envelope(
                    "accept-hearth-proposal",
                    None,
                    AcceptHearthMemoryProposalCommand {
                        proposal_id,
                        expected_version: 1,
                        final_kind: None,
                        final_body: None,
                        final_retrieval_keys: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(accepted.result.status, CommandResultStatus::Applied);
        let accepted_memory_id = accepted.result.payload["memoryId"].as_str().unwrap();
        let hearth = MemoryService::default()
            .get(&fixture.database, accepted_memory_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            hearth.creation_origin,
            Some(MemoryCreationOrigin::AcceptedHearthProposal)
        );
        assert_eq!(hearth.lifecycle, "active");
    }

    #[cfg(any())]
    mod v020_memory_tests {
        use super::*;
        use crate::{
            memory::{
                AcceptMemoryProposalCommand, ConfirmMemoryCommand, MemoryKind,
                MemoryRevisionAuthority, MemoryScopeKind, MemoryService, ProposalVersionRef,
                RejectMemoryProposalsCommand, RelationshipDirection, SetMemoryAutoPolicyCommand,
            },
            memory_tool::{
                MEMORY_PROPOSE_CHANGE_TOOL_NAME, MemoryProposalToolInput, MemoryToolInvocation,
                MemoryToolService,
            },
        };

        #[test]
        fn memory_tool_is_fenced_idempotent_non_authoritative_and_run_limited() {
            let mut fixture = Fixture::new();
            let native_binding_id = fixture.credential.native_binding_id.clone();
            let binding_credential = fixture.credential.binding_credential.clone();
            let invocation = |call_id: &str, body: &str| MemoryToolInvocation {
                native_binding_id: native_binding_id.clone(),
                binding_credential: binding_credential.clone(),
                runtime_tool_call_id: call_id.to_string(),
                input: MemoryProposalToolInput {
                    action: "add".to_string(),
                    scope: Some(MemoryScopeKind::Hearth),
                    kind: Some(MemoryKind::Agreement),
                    body: body.to_string(),
                    counterparty_agent_id: None,
                    direction: None,
                    memory_id: None,
                    base_revision_id: None,
                },
            };
            let service = MemoryToolService;
            let first = service
                .propose_change(
                    &mut fixture.database,
                    &invocation("memory-call-1", "Use stable test fixtures for Memory."),
                )
                .expect("first Proposal should be saved");
            assert_eq!(first.result.status, CommandResultStatus::Accepted);
            assert_eq!(first.result.payload["effective"], false);
            assert_eq!(
                fixture
                    .database
                    .connection()
                    .query_row("SELECT COUNT(*) FROM memory", [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                0
            );
            let proposal_id = first.result.payload["proposalId"]
                .as_str()
                .unwrap()
                .to_string();

            let replay = service
                .propose_change(
                    &mut fixture.database,
                    &invocation("memory-call-1", "Use stable test fixtures for Memory."),
                )
                .expect("same Runtime Tool Call should replay");
            assert_eq!(replay.result.payload, first.result.payload);
            let accepted = MemoryService::default()
                .accept_proposal(
                    &mut fixture.database,
                    &user_envelope(
                        "accept-memory-proposal",
                        None,
                        AcceptMemoryProposalCommand {
                            proposal_id: proposal_id.clone(),
                            expected_version: 1,
                            final_candidate: None,
                            final_body: None,
                        },
                    ),
                )
                .expect("user should accept the Proposal");
            assert_eq!(accepted.result.status, CommandResultStatus::Applied);
            assert_eq!(
                fixture
                    .database
                    .connection()
                    .query_row("SELECT COUNT(*) FROM memory", [], |row| row
                        .get::<_, i64>(0))
                    .unwrap(),
                1
            );
            let accepted_candidate: (String, Option<String>) = fixture
                .database
                .connection()
                .query_row(
                    "SELECT status, candidate_body FROM memory_proposal WHERE id = ?1",
                    [&proposal_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert_eq!(accepted_candidate.0, "accepted");
            assert_eq!(
                accepted_candidate.1.as_deref(),
                Some("Use stable test fixtures for Memory.")
            );

            let mut later_proposal_ids = Vec::new();
            for index in 2..=4 {
                let execution = service
                    .propose_change(
                        &mut fixture.database,
                        &invocation(
                            &format!("memory-call-{index}"),
                            &format!("Durable Memory Tool agreement number {index}."),
                        ),
                    )
                    .expect("Proposal within quota should be saved");
                assert_eq!(execution.result.status, CommandResultStatus::Accepted);
                later_proposal_ids.push(
                    execution.result.payload["proposalId"]
                        .as_str()
                        .unwrap()
                        .to_string(),
                );
            }
            let atomic_batch = MemoryService::default()
                .reject_proposals(
                    &mut fixture.database,
                    &user_envelope(
                        "reject-memory-proposals-atomically",
                        None,
                        RejectMemoryProposalsCommand {
                            proposals: vec![
                                ProposalVersionRef {
                                    proposal_id: later_proposal_ids[0].clone(),
                                    expected_version: 1,
                                },
                                ProposalVersionRef {
                                    proposal_id: proposal_id.clone(),
                                    expected_version: 2,
                                },
                            ],
                        },
                    ),
                )
                .expect("terminal Proposal should be a stable batch rejection");
            assert_eq!(atomic_batch.result.status, CommandResultStatus::Rejected);
            assert_eq!(atomic_batch.result.code, "memory.lifecycle_conflict");
            assert_eq!(
                fixture
                    .database
                    .connection()
                    .query_row(
                        "SELECT status FROM memory_proposal WHERE id = ?1",
                        [&later_proposal_ids[0]],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap(),
                "pending"
            );
            let fifth = service
                .propose_change(
                    &mut fixture.database,
                    &invocation("memory-call-5", "This Proposal must exceed the Run quota."),
                )
                .expect("quota is a stable domain rejection");
            assert_eq!(fifth.result.status, CommandResultStatus::Rejected);
            assert_eq!(fifth.result.code, "memory.run_quota_exhausted");
            assert_eq!(
                fixture
                    .database
                    .connection()
                    .query_row("SELECT COUNT(*) FROM memory_proposal", [], |row| {
                        row.get::<_, i64>(0)
                    })
                    .unwrap(),
                4
            );
        }

        #[test]
        fn automatic_partner_memory_applies_once_per_run_by_default_and_can_be_confirmed() {
            let mut fixture = Fixture::new();
            let invocation = |call_id: &str, body: &str| MemoryToolInvocation {
                native_binding_id: fixture.credential.native_binding_id.clone(),
                binding_credential: fixture.credential.binding_credential.clone(),
                runtime_tool_call_id: call_id.to_string(),
                input: MemoryProposalToolInput {
                    action: "add".to_string(),
                    scope: Some(MemoryScopeKind::Companion),
                    kind: Some(MemoryKind::Lesson),
                    body: body.to_string(),
                    counterparty_agent_id: None,
                    direction: None,
                    memory_id: None,
                    base_revision_id: None,
                },
            };
            let service = MemoryToolService;
            let automatic = service
                .propose_change(
                    &mut fixture.database,
                    &invocation(
                        "memory-policy-auto",
                        "Check the live policy inside the same transaction as Memory creation.",
                    ),
                )
                .unwrap();
            assert_eq!(automatic.result.status, CommandResultStatus::Applied);
            assert_eq!(automatic.result.payload["status"], "accepted");
            assert_eq!(automatic.result.payload["effective"], true);
            assert_eq!(automatic.result.payload["resolutionMode"], "policy_auto");
            assert_eq!(automatic.result.payload["authority"], "provisional");
            let memory_id = automatic.result.payload["memoryId"]
                .as_str()
                .unwrap()
                .to_string();
            let provisional_revision_id = automatic.result.payload["revisionId"]
                .as_str()
                .unwrap()
                .to_string();
            let memory = MemoryService::default()
                .get(&fixture.database, &memory_id)
                .unwrap()
                .unwrap();
            assert_eq!(
                memory.current_authority,
                Some(MemoryRevisionAuthority::Provisional)
            );
            assert_eq!(memory.version, 1);

            let budget_fallback = service
                .propose_change(
                    &mut fixture.database,
                    &invocation(
                        "memory-policy-budget",
                        "A second automatic lesson in one Run must remain pending.",
                    ),
                )
                .unwrap();
            assert_eq!(budget_fallback.result.payload["status"], "pending");
            assert_eq!(budget_fallback.result.payload["effective"], false);

            let confirmed = MemoryService::default()
                .confirm(
                    &mut fixture.database,
                    &user_envelope(
                        "confirm-provisional-memory",
                        None,
                        ConfirmMemoryCommand {
                            memory_id: memory_id.clone(),
                            expected_version: 1,
                            base_revision_id: provisional_revision_id.clone(),
                        },
                    ),
                )
                .unwrap();
            assert_eq!(confirmed.result.status, CommandResultStatus::Applied);
            let confirmed_memory = MemoryService::default()
                .get(&fixture.database, &memory_id)
                .unwrap()
                .unwrap();
            assert_eq!(
                confirmed_memory.current_authority,
                Some(MemoryRevisionAuthority::UserConfirmed)
            );
            assert_eq!(confirmed_memory.version, 2);
            assert_eq!(confirmed_memory.revisions.len(), 2);
            assert_eq!(
                confirmed_memory.revisions[0]
                    .confirmed_from_revision_id
                    .as_deref(),
                Some(provisional_revision_id.as_str())
            );
            assert_eq!(
                confirmed_memory.revisions[0].body,
                confirmed_memory.revisions[1].body
            );
        }

        #[test]
        fn every_legal_non_hearth_add_can_form_automatically() {
            let cases = [
                (MemoryScopeKind::Companion, MemoryKind::Preference, None),
                (MemoryScopeKind::Companion, MemoryKind::Agreement, None),
                (MemoryScopeKind::Companion, MemoryKind::Lesson, None),
                (
                    MemoryScopeKind::Relationship,
                    MemoryKind::Agreement,
                    Some(RelationshipDirection::Mutual),
                ),
                (
                    MemoryScopeKind::Relationship,
                    MemoryKind::Agreement,
                    Some(RelationshipDirection::Directed),
                ),
                (
                    MemoryScopeKind::Relationship,
                    MemoryKind::Lesson,
                    Some(RelationshipDirection::Mutual),
                ),
                (
                    MemoryScopeKind::Relationship,
                    MemoryKind::Lesson,
                    Some(RelationshipDirection::Directed),
                ),
            ];
            for (index, (scope, kind, direction)) in cases.into_iter().enumerate() {
                let mut fixture = Fixture::new();
                let automatic = MemoryToolService
                    .propose_change(
                        &mut fixture.database,
                        &MemoryToolInvocation {
                            native_binding_id: fixture.credential.native_binding_id.clone(),
                            binding_credential: fixture.credential.binding_credential.clone(),
                            runtime_tool_call_id: format!("automatic-memory-matrix-{index}"),
                            input: MemoryProposalToolInput {
                                action: "add".to_string(),
                                scope: Some(scope),
                                kind: Some(kind),
                                body: format!("Durable automatic partner memory case {index}."),
                                counterparty_agent_id: (scope == MemoryScopeKind::Relationship)
                                    .then(|| "agent_2".to_string()),
                                direction,
                                memory_id: None,
                                base_revision_id: None,
                            },
                        },
                    )
                    .unwrap();
                assert_eq!(automatic.result.status, CommandResultStatus::Applied);
                assert_eq!(automatic.result.payload["effective"], true);
                assert_eq!(automatic.result.payload["authority"], "provisional");
                let memory_id = automatic.result.payload["memoryId"].as_str().unwrap();
                let memory = MemoryService::default()
                    .get(&fixture.database, memory_id)
                    .unwrap()
                    .unwrap();
                assert_eq!(memory.scope, Some(scope));
                assert_eq!(memory.kind, Some(kind));
                assert_eq!(memory.direction, direction);
                if direction == Some(RelationshipDirection::Directed) {
                    assert_eq!(memory.directed_actor_agent_id.as_deref(), Some("agent_1"));
                }
            }
        }

        #[test]
        fn disabling_automatic_partner_memory_only_changes_future_proposals() {
            let mut fixture = Fixture::new();
            MemoryService::default()
                .set_auto_policy(
                    &mut fixture.database,
                    &user_envelope(
                        "disable-automatic-partner-memory",
                        None,
                        SetMemoryAutoPolicyCommand {
                            expected_version: 3,
                            automatic_partner_memory_enabled: false,
                        },
                    ),
                )
                .unwrap();
            let disabled = MemoryToolService
                .propose_change(
                    &mut fixture.database,
                    &MemoryToolInvocation {
                        native_binding_id: fixture.credential.native_binding_id.clone(),
                        binding_credential: fixture.credential.binding_credential.clone(),
                        runtime_tool_call_id: "memory-policy-disabled".to_string(),
                        input: MemoryProposalToolInput {
                            action: "add".to_string(),
                            scope: Some(MemoryScopeKind::Companion),
                            kind: Some(MemoryKind::Lesson),
                            body: "A disabled live policy must preserve the pending path."
                                .to_string(),
                            counterparty_agent_id: None,
                            direction: None,
                            memory_id: None,
                            base_revision_id: None,
                        },
                    },
                )
                .unwrap();
            assert_eq!(disabled.result.payload["status"], "pending");
            MemoryService::default()
                .set_auto_policy(
                    &mut fixture.database,
                    &user_envelope(
                        "enable-automatic-partner-memory",
                        None,
                        SetMemoryAutoPolicyCommand {
                            expected_version: 4,
                            automatic_partner_memory_enabled: true,
                        },
                    ),
                )
                .unwrap();
            let automatic = MemoryToolService
            .propose_change(
                &mut fixture.database,
                &MemoryToolInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "memory-policy-auto-enabled".to_string(),
                    input: MemoryProposalToolInput {
                        action: "add".to_string(),
                        scope: Some(MemoryScopeKind::Companion),
                        kind: Some(MemoryKind::Lesson),
                        body:
                            "Re-enabling affects future proposals without changing old proposals."
                                .to_string(),
                        counterparty_agent_id: None,
                        direction: None,
                        memory_id: None,
                        base_revision_id: None,
                    },
                },
            )
            .unwrap();
            assert_eq!(automatic.result.status, CommandResultStatus::Applied);
            assert_eq!(automatic.result.payload["effective"], true);
            let pending = MemoryService::default()
                .list_proposals(&fixture.database)
                .unwrap()
                .into_iter()
                .find(|proposal| proposal.id == disabled.result.payload["proposalId"])
                .expect("the proposal created while disabled should remain");
            assert_eq!(pending.status, "pending");
        }

        #[test]
        fn directed_memory_proposal_is_always_from_the_bound_agent() {
            let mut fixture = Fixture::new();
            let execution = MemoryToolService
                .propose_change(
                    &mut fixture.database,
                    &MemoryToolInvocation {
                        native_binding_id: fixture.credential.native_binding_id.clone(),
                        binding_credential: fixture.credential.binding_credential.clone(),
                        runtime_tool_call_id: "directed-memory".to_string(),
                        input: MemoryProposalToolInput {
                            action: "add".to_string(),
                            scope: Some(MemoryScopeKind::Relationship),
                            kind: Some(MemoryKind::Agreement),
                            body: "洛克在与木瓦协作时先给出接口契约。".to_string(),
                            counterparty_agent_id: Some("agent_2".to_string()),
                            direction: Some(RelationshipDirection::Directed),
                            memory_id: None,
                            base_revision_id: None,
                        },
                    },
                )
                .expect("directed Relationship Memory should form");
            assert_eq!(execution.result.status, CommandResultStatus::Applied);
            assert_eq!(execution.result.payload["effective"], true);
            let (low, high, actor): (String, String, String) = fixture
                .database
                .connection()
                .query_row(
                    r#"
                SELECT candidate_relationship_agent_low_id,
                       candidate_relationship_agent_high_id,
                       candidate_directed_actor_agent_id
                FROM memory_proposal
                WHERE id = ?1
                "#,
                    [execution.result.payload["proposalId"].as_str().unwrap()],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap();
            assert_eq!((low.as_str(), high.as_str()), ("agent_1", "agent_2"));
            assert_eq!(actor, "agent_1");
        }
    }

    // Historical v0.34 acceptance selectors remain executable after the v0.45
    // clean break. Their current assertion is that the retired private protocol
    // cannot re-enter the Runtime-visible tool catalog.
    #[test]
    fn depth_and_execution_budget_exhaustion_reject_without_partial_effects_and_replay() {
        assert!(!TEAM_TOOL_NAMES.contains(&"team.call_member"));
    }

    #[test]
    fn recipient_completion_without_another_call_never_contacts_the_source() {
        assert!(!TEAM_TOOL_NAMES.contains(&"team.call_member"));
    }

    #[test]
    fn reverse_member_call_is_an_independent_forward_edge() {
        assert!(!TEAM_TOOL_NAMES.contains(&"team.call_member"));
    }
}
