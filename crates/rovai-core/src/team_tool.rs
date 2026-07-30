use std::{collections::HashSet, fmt, sync::OnceLock};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    agent_profile::{AdapterKind, resolve_frozen_runtime},
    collaboration::{
        CollaborationService, CreateTaskCommand, TaskAssigneeFilter, TaskAssigneeUpdate,
        TaskListPage, TaskListQuery, TaskStatus, UpdateTaskCommand, append_domain_event,
        build_effective_config, entity_belongs_to_camp,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    context_retrieval::{
        CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME, CONTEXT_GET_MESSAGE_TOOL_NAME,
        CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME, CONTEXT_GET_SUMMARY_TOOL_NAME,
        CONTEXT_SEARCH_TOOL_NAME,
    },
    db::Database,
    runtime::AgentRunWorkspace,
};

pub const TEAM_POST_MESSAGE_TOOL_NAME: &str = "team.post_message";
pub const TEAM_CREATE_TASK_TOOL_NAME: &str = "team.create_task";
pub const TEAM_UPDATE_TASK_TOOL_NAME: &str = "team.update_task";
pub const TEAM_LIST_TASKS_TOOL_NAME: &str = "team.list_tasks";
pub const TEAM_TOOL_NAMES: [&str; 13] = [
    TEAM_POST_MESSAGE_TOOL_NAME,
    TEAM_CREATE_TASK_TOOL_NAME,
    TEAM_UPDATE_TASK_TOOL_NAME,
    TEAM_LIST_TASKS_TOOL_NAME,
    CONTEXT_SEARCH_TOOL_NAME,
    CONTEXT_GET_MESSAGE_TOOL_NAME,
    CONTEXT_GET_MESSAGE_WINDOW_TOOL_NAME,
    CONTEXT_GET_MESSAGE_THREAD_TOOL_NAME,
    CONTEXT_GET_SUMMARY_TOOL_NAME,
    "memory.search",
    "memory.read",
    "memory.write",
    "memory.propose_hearth",
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
    pub recipient: String,
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
    #[serde(default)]
    pub clear_assignee: bool,
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
pub struct TeamPostMessageCommand {
    native_binding_id: String,
    credential_digest: String,
    runtime_tool_call_id: String,
    recipient: String,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedTeamToolRun {
    pub camp_id: String,
    pub agent_profile_id: String,
    pub agent_run_id: String,
    pub execution_epoch: i64,
}

#[derive(Debug, Clone)]
struct RecipientTarget {
    conversation_id: Option<String>,
}

impl TeamToolService {
    pub fn authenticate_binding(
        &self,
        database: &Database,
        native_binding_id: &str,
        binding_credential: &str,
        runtime_tool_call_id: &str,
        required_capability: &str,
    ) -> Result<AuthenticatedTeamToolRun> {
        validate_invocation_identity(native_binding_id, binding_credential, runtime_tool_call_id)?;
        let identity = resolve_sender_identity(
            database.connection(),
            native_binding_id,
            &credential_digest(binding_credential),
            Some(required_capability),
        )?;
        Ok(AuthenticatedTeamToolRun {
            camp_id: identity.camp_id,
            agent_profile_id: identity.agent_profile_id,
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
            agent_profile_id: identity.agent_profile_id,
            agent_run_id: identity.agent_run_id,
            execution_epoch: identity.execution_epoch,
        })
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

    pub fn input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["recipient", "body"],
            "properties": {
                "recipient": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Stable AgentProfile ID of another active member, or \"source\" in an A2A-triggered Run."
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
                    "type": "string",
                    "minLength": 1,
                    "description": "Active Camp member to own the Task. Omit for the shared unassigned pool."
                }
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
                "description": {"type": "string", "maxLength": 20000},
                "status": {
                    "type": "string",
                    "enum": ["pending", "in_progress", "completed", "cancelled"]
                },
                "assigneeAgentId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Set an active Camp member, or omit to leave unchanged."
                },
                "clearAssignee": {
                    "type": "boolean",
                    "description": "Set true to release the Task into the unassigned pool. Must not be combined with assigneeAgentId."
                }
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
                    "uniqueItems": true,
                    "items": {
                        "type": "string",
                        "enum": ["pending", "in_progress", "completed", "cancelled"]
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

    /// Reserves or reuses the Native Binding and derives its Team Tool
    /// credential for this Rovai-ai process. The credential is stable for the
    /// lifetime of a compatible Native Binding so a provider may safely reuse
    /// its stdio MCP process across AgentRuns. It changes when the Binding is
    /// replaced or after Rovai-ai restarts. A newly reserved Binding is
    /// deliberately unusable until the Adapter attaches a concrete Native
    /// Session through `BindNativeSessionCommand`.
    pub fn prepare_binding_credential(
        &self,
        database: &mut Database,
        agent_run_id: &str,
        execution_epoch: i64,
        force_new_binding: bool,
    ) -> Result<TeamToolBindingCredential> {
        self.prepare_binding(
            database,
            agent_run_id,
            execution_epoch,
            force_new_binding,
            true,
        )
    }

    /// Reserves or reuses a Native Binding for an Adapter that does not expose
    /// Rovai-ai Team Tools. The returned secret remains private to Core and is
    /// used only to bind Context/Memory evidence to the Native Session.
    pub fn prepare_native_binding_credential(
        &self,
        database: &mut Database,
        agent_run_id: &str,
        execution_epoch: i64,
        force_new_binding: bool,
    ) -> Result<TeamToolBindingCredential> {
        self.prepare_binding(
            database,
            agent_run_id,
            execution_epoch,
            force_new_binding,
            false,
        )
    }

    fn prepare_binding(
        &self,
        database: &mut Database,
        agent_run_id: &str,
        execution_epoch: i64,
        force_new_binding: bool,
        require_team_tool: bool,
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
                 AND camp_member.agent_profile_id = conversation.agent_profile_id
                JOIN agent_profile ON agent_profile.id = conversation.agent_profile_id
                WHERE agent_run.id = ?1
                  AND agent_run.execution_epoch = ?2
                  AND agent_run.status = 'running'
                  AND agent_run.cancel_requested_at IS NULL
                  AND camp_turn.status IN ('running', 'waiting')
                  AND camp_turn.cancel_requested_at IS NULL
                  AND camp.status = 'active'
                  AND camp_member.status = 'active'
                  AND camp_member.leave_requested_at IS NULL
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
            capabilities,
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
        if require_team_tool {
            ensure_runtime_supports_team_tool(adapter_kind.as_deref(), capabilities.as_deref())?;
        } else {
            adapter_kind
                .context("AgentRun has no frozen Runtime Adapter")?
                .parse::<AdapterKind>()?;
        }
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
                    native_read_through_camp_message_sequence = 0,
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
            recipient: invocation.input.recipient.clone(),
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
            let (recipient_agent_id, source_reply_id) = match resolve_recipient_selector(
                transaction,
                &current,
                &envelope.payload.recipient,
                envelope.payload.in_reply_to_message_id.as_deref(),
            )? {
                Ok(resolved) => resolved,
                Err(rejection) => return Ok(rejection),
            };
            if current.agent_profile_id == recipient_agent_id {
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
                &recipient_agent_id,
            )? {
                Ok(recipient) => recipient,
                Err(rejection) => return Ok(rejection),
            };
            let (correlation_id, reply_id) = match resolve_reply(
                transaction,
                &current,
                &recipient_agent_id,
                source_reply_id
                    .as_deref()
                    .or(envelope.payload.in_reply_to_message_id.as_deref()),
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

            let now = chrono::Utc::now().to_rfc3339();
            let (recipient_conversation_id, created_recipient_conversation) =
                ensure_recipient_conversation(
                    transaction,
                    &current.camp_id,
                    &recipient_agent_id,
                    recipient.conversation_id.as_deref(),
                    &now,
                )?;
            let recipient_runtime = match resolve_frozen_runtime(
                transaction,
                &recipient_conversation_id,
                &recipient_agent_id,
            )? {
                Ok(runtime) => runtime,
                Err(blocker) => {
                    if created_recipient_conversation {
                        transaction.execute(
                            "DELETE FROM conversation WHERE id = ?1",
                            [&recipient_conversation_id],
                        )?;
                    }
                    return Ok(CommandHandlerResult::rejected(
                        "team_tool.recipient_runtime_not_ready",
                        json!({
                            "message": "Recipient Runtime is not ready",
                            "recipientAgentId": recipient_agent_id,
                            "blockerCode": blocker.code,
                            "detail": blocker.payload,
                        }),
                    ));
                }
            };
            let target_runtime_supports_a2a = recipient_runtime
                .capabilities
                .iter()
                .any(|capability| capability == TEAM_POST_MESSAGE_CAPABILITY);
            let target_effective_config = build_effective_config(
                transaction,
                &recipient_conversation_id,
                &recipient_agent_id,
                &recipient_runtime,
            )?;
            let target_agent_can_send = target_effective_config["capabilities"]
                .as_array()
                .is_some_and(|capabilities| {
                    capabilities
                        .iter()
                        .any(|capability| capability.as_str() == Some("inbox.send"))
                });
            let target_can_continue_a2a =
                target_runtime_supports_a2a && target_agent_can_send;
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
            let source_workspace: AgentRunWorkspace = serde_json::from_str(
                current
                    .workspace_json
                    .as_deref()
                    .context("A2A source AgentRun has no frozen working directory")?,
            )
            .context("A2A source AgentRun working directory is invalid")?;
            let target_workspace_json = serde_json::to_string(
                &AgentRunWorkspace::runtime_managed_path(source_workspace.execution_root),
            )?;
            let recipient_sequence: i64 = transaction.query_row(
                "SELECT last_message_sequence + 1 FROM conversation WHERE id = ?1",
                [&recipient_conversation_id],
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
                    recipient_agent_id,
                    envelope.payload.body,
                    serde_json::to_string(&envelope.payload.references)?,
                    current.conversation_id,
                    current.camp_turn_id,
                    current.agent_run_id,
                    recipient_conversation_id,
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
                    recipient_conversation_id,
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
                params![recipient_conversation_id, recipient_sequence, now],
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
                    effective_config_json, workspace_json, permission_semantics,
                    runtime_adapter_kind, runtime_installation_id,
                    runtime_executable_path, runtime_auth_scope,
                    runtime_reported_version, runtime_executable_fingerprint,
                    runtime_capabilities_json, runtime_model_selection_json,
                    runtime_permission_config_json,
                    runtime_binding_compatibility_digest,
                    runtime_host_config_digest, runtime_protocol_version,
                    runtime_installation_generation,
                    runtime_search_environment_generation,
                    runtime_native_session_compatibility_key,
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
                    ?12, ?13, 'runtime_managed_v2',
                    ?14, ?15, ?16, ?17, ?18, ?19,
                    ?20, ?21, ?22, ?23, ?24, ?25,
                    ?26, ?27, ?28,
                    'queued', NULL, NULL, ?29, 0,
                    NULL, NULL, 0, NULL,
                    0, NULL, NULL, NULL, NULL, NULL, 1,
                    ?6, NULL, NULL, ?6,
                    'a2a', ?30, ?31, ?32
                )
                "#,
                params![
                    target_agent_run_id,
                    current.camp_turn_id,
                    recipient_conversation_id,
                    Option::<String>::None,
                    recipient_message_id,
                    now,
                    camp_sequence,
                    recipient_sequence,
                    responsibility_key,
                    format!("Handle A2A request from {}", current.agent_profile_id),
                    if target_can_continue_a2a {
                        "Complete the requested work; explicitly call team.post_message if another Agent must continue."
                    } else {
                        "Complete the requested work and return the result in your final response. This Runtime can receive this A2A request but cannot continue the chain with team.post_message."
                    },
                    serde_json::to_string(&target_effective_config)?,
                    target_workspace_json,
                    recipient_runtime.adapter_kind.as_str(),
                    recipient_runtime.installation_id,
                    recipient_runtime.executable_path,
                    recipient_runtime.auth_scope,
                    recipient_runtime.reported_version,
                    recipient_runtime.executable_fingerprint,
                    serde_json::to_string(&recipient_runtime.capabilities)?,
                    serde_json::to_string(&recipient_runtime.model)?,
                    serde_json::to_string(&recipient_runtime.permissions)?,
                    recipient_runtime.binding_compatibility_digest,
                    recipient_runtime.host_config_digest,
                    recipient_runtime.protocol_version,
                    recipient_runtime.installation_generation,
                    recipient_runtime.search_environment_generation,
                    recipient_runtime.native_session_compatibility_key,
                    format!("{}:{recipient_agent_id}", envelope.command_id),
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
                  AND status IN ('running', 'waiting')
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
        if invocation.input.clear_assignee
            && matches!(invocation.input.assignee_agent_id, NullableInput::Value(_))
        {
            return Err(invocation_error(
                "team_tool.invalid_input",
                "clearAssignee cannot be combined with assigneeAgentId",
            ));
        }
        let assignee = match (
            &invocation.input.assignee_agent_id,
            invocation.input.clear_assignee,
        ) {
            (_, true) => TaskAssigneeUpdate::Clear,
            (NullableInput::Missing, false) => TaskAssigneeUpdate::Unchanged,
            (NullableInput::Null, false) => TaskAssigneeUpdate::Clear,
            (NullableInput::Value(agent_profile_id), false) => TaskAssigneeUpdate::Assign {
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
            (NullableInput::Value(agent_profile_id), false) => TaskAssigneeFilter::Agent {
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
    if invocation.input.recipient.trim().is_empty() || invocation.input.body.trim().is_empty() {
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
              AND camp_turn.status IN ('running', 'waiting')
              AND camp_turn.cancel_requested_at IS NULL
              AND camp.status = 'active'
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
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

fn resolve_recipient_selector(
    transaction: &Transaction<'_>,
    sender: &SenderIdentity,
    recipient: &str,
    explicit_reply_id: Option<&str>,
) -> Result<std::result::Result<(String, Option<String>), CommandHandlerResult>> {
    if recipient != "source" {
        return Ok(Ok((recipient.to_string(), None)));
    }
    let source = transaction
        .query_row(
            r#"
            SELECT camp_id, sender_agent_id, recipient_agent_id, id, delivered_at
            FROM inbox_message
            WHERE target_agent_run_id = ?1
            "#,
            [&sender.agent_run_id],
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
    let Some((camp_id, source_agent_id, recipient_agent_id, source_message_id, delivered_at)) =
        source
    else {
        return Ok(Err(rejected(
            "team_tool.source_unavailable",
            "recipient \"source\" is only available in an A2A-triggered Run",
        )));
    };
    if camp_id != sender.camp_id
        || recipient_agent_id != sender.agent_profile_id
        || delivered_at.is_none()
    {
        return Ok(Err(rejected(
            "team_tool.source_unavailable",
            "The current A2A source is no longer a valid reply target",
        )));
    }
    if explicit_reply_id.is_some_and(|reply_id| reply_id != source_message_id) {
        return Ok(Err(rejected(
            "team_tool.invalid_reply",
            "recipient \"source\" must reply to the trusted source message",
        )));
    }
    Ok(Ok((source_agent_id, Some(source_message_id))))
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
            LEFT JOIN conversation
              ON conversation.camp_id = camp_member.camp_id
             AND conversation.agent_profile_id = camp_member.agent_profile_id
            WHERE camp_member.camp_id = ?1
              AND camp_member.agent_profile_id = ?2
              AND camp.status = 'active'
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'present'
            "#,
            params![camp_id, recipient_agent_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?;
    let Some(conversation_id) = conversation_id else {
        return Ok(Err(rejected(
            "team_tool.recipient_unavailable",
            "Recipient is not an active member of the sender Camp",
        )));
    };
    Ok(Ok(RecipientTarget { conversation_id }))
}

fn ensure_recipient_conversation(
    transaction: &Transaction<'_>,
    camp_id: &str,
    recipient_agent_id: &str,
    existing_conversation_id: Option<&str>,
    now: &str,
) -> Result<(String, bool)> {
    if let Some(conversation_id) = existing_conversation_id {
        return Ok((conversation_id.to_string(), false));
    }
    let conversation_id = Uuid::new_v4().to_string();
    transaction.execute(
        r#"
        INSERT INTO conversation(
            id, camp_id, agent_profile_id,
            provider_override, model_override, action_permission_profile_ref,
            native_session_id, summary,
            summary_through_message_sequence,
            last_message_sequence,
            version, created_at, updated_at
        ) VALUES (?1, ?2, ?3, NULL, NULL, NULL, NULL, NULL, 0, 0, 1, ?4, ?4)
        "#,
        params![conversation_id, camp_id, recipient_agent_id, now],
    )?;
    Ok((conversation_id, true))
}

fn resolve_reply(
    transaction: &Transaction<'_>,
    sender: &SenderIdentity,
    recipient_agent_id: &str,
    in_reply_to_message_id: Option<&str>,
) -> Result<std::result::Result<(String, Option<String>), CommandHandlerResult>> {
    let Some(reply_id) = in_reply_to_message_id else {
        let source = transaction
            .query_row(
                r#"
                SELECT sender_agent_id, recipient_agent_id,
                       correlation_id, delivered_at, id
                FROM inbox_message
                WHERE target_agent_run_id = ?1
                "#,
                [&sender.agent_run_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()?;
        if let Some((
            original_sender,
            original_recipient,
            correlation_id,
            delivered_at,
            source_message_id,
        )) = source
            && original_sender == recipient_agent_id
            && original_recipient == sender.agent_profile_id
            && delivered_at.is_some()
        {
            return Ok(Ok((correlation_id, Some(source_message_id))));
        }
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
    let _adapter_kind = adapter_kind.parse::<AdapterKind>()?;
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
        read_model::ReadModelService,
        runtime::{
            BindNativeSessionCommand, ClaimAgentRunCommand, ExecutionRuntimeService,
            SucceedAgentRunCommand,
        },
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
                std::env::temp_dir().join(format!("rovai-team-tool-test-{}", Uuid::new_v4()));
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
                        CreateCampCommand::for_test_with_members(
                            workspace.to_string_lossy().to_string(),
                            &["agent-luoke", "agent-muwa"],
                            "agent-luoke",
                        ),
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

        fn invocation(&self, call_id: &str, recipient: &str) -> TeamToolInvocation {
            TeamToolInvocation {
                native_binding_id: self.credential.native_binding_id.clone(),
                binding_credential: self.credential.binding_credential.clone(),
                runtime_tool_call_id: call_id.to_string(),
                input: TeamPostMessageInput {
                    recipient: recipient.to_string(),
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
    fn tool_schema_exposes_only_model_owned_fields() {
        let schema = TeamToolService::input_schema();
        let properties = schema["properties"].as_object().unwrap();
        assert_eq!(properties.len(), 4);
        assert!(properties.contains_key("recipient"));
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
    fn sender_gate_uses_frozen_capability_instead_of_adapter_allowlist() {
        ensure_runtime_supports_team_tool(
            Some(AdapterKind::AntigravityApp.as_str()),
            Some(r#"["team_tool.post_message"]"#),
        )
        .expect("a future Antigravity App Host can advertise verified Team MCP support");

        let error = ensure_runtime_supports_team_tool(
            Some(AdapterKind::AntigravityApp.as_str()),
            Some("[]"),
        )
        .expect_err("the current companion remains blocked without the frozen capability");
        assert!(
            error
                .to_string()
                .contains("does not advertise Team Tool support")
        );
    }

    #[test]
    fn task_tool_schemas_use_cross_adapter_assignee_controls() {
        assert!(
            TeamToolService::update_task_input_schema()
                .get("anyOf")
                .is_none(),
            "Claude Code drops an MCP tool whose root input schema uses anyOf"
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
                "agentProfileId",
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
            "assigneeAgentId": "agent-luoke"
        }))
        .unwrap();
        assert_eq!(
            assign.assignee_agent_id,
            NullableInput::Value("agent-luoke".to_string())
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
                        unassigned_only: false,
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
                clear_assignee: false,
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
                        unassigned_only: false,
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
                clear_assignee: false,
            },
        );
        let stale = service
            .update_task(&mut fixture.database, &stale_invocation)
            .unwrap();
        assert_eq!(stale.result.code, "task.version_conflict");
    }

    #[test]
    fn aggregate_waiting_allows_running_sender_but_waiting_sender_remains_fenced() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE camp_turn
                SET status = 'waiting'
                WHERE id = (
                    SELECT camp_turn_id
                    FROM agent_run
                    WHERE id = ?1
                )
                "#,
                [&fixture.source_run_id],
            )
            .unwrap();

        let credential = service
            .issue_binding_credential(
                &mut fixture.database,
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .expect("an active sender should retain Team Tool access while its Turn is waiting");
        let invocation = TeamToolInvocation {
            native_binding_id: credential.native_binding_id.clone(),
            binding_credential: credential.binding_credential.clone(),
            runtime_tool_call_id: "aggregate-waiting".to_string(),
            input: TeamPostMessageInput {
                recipient: "agent-muwa".to_string(),
                body: "Continue collaboration after approval".to_string(),
                references: Vec::new(),
                in_reply_to_message_id: None,
            },
        };
        let result = service
            .post_message(&mut fixture.database, &invocation)
            .expect("aggregate waiting must not fence a running sender");
        assert_eq!(result.result.status, CommandResultStatus::Accepted);

        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'waiting',
                    wait_reason = 'approval_required'
                WHERE id = ?1
                "#,
                [&fixture.source_run_id],
            )
            .unwrap();
        let fenced = service
            .post_message(
                &mut fixture.database,
                &TeamToolInvocation {
                    native_binding_id: credential.native_binding_id,
                    binding_credential: credential.binding_credential,
                    runtime_tool_call_id: "sender-waiting".to_string(),
                    input: TeamPostMessageInput {
                        recipient: "agent-muwa".to_string(),
                        body: "This sender is not executing".to_string(),
                        references: Vec::new(),
                        in_reply_to_message_id: None,
                    },
                },
            )
            .expect_err("the sender Run itself must still be running");
        assert_eq!(
            fenced
                .downcast_ref::<TeamToolInvocationError>()
                .map(|error| error.code.as_str()),
            Some("team_tool.binding_fenced")
        );
    }

    #[test]
    fn post_message_atomically_delivers_and_queues_one_a2a_run() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let source_workspace_json: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT workspace_json FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        let mut source_workspace: Value = serde_json::from_str(&source_workspace_json).unwrap();
        source_workspace["access"] = json!("read_only");
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET workspace_json = ?2,
                    runtime_permission_config_json = '{"senderOnly":true}'
                WHERE id = ?1
                "#,
                params![
                    fixture.source_run_id,
                    serde_json::to_string(&source_workspace).unwrap()
                ],
            )
            .unwrap();
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
        let a2a_system_message_count: i64 = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT COUNT(*) FROM camp_message
                WHERE camp_id = ?1
                  AND author_type = 'system'
                  AND author_id = 'a2a-state'
                  AND tombstoned_at IS NULL
                "#,
                [&fixture.camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(a2a_system_message_count, 0);
        let snapshot = ReadModelService
            .camp_snapshot(&mut fixture.database, &fixture.camp_id)
            .unwrap();
        let directed_message = snapshot
            .inbox_messages
            .iter()
            .find(|message| message.id == inbox_id)
            .expect("delivered A2A body should be projected from InboxMessage");
        assert!(directed_message.timeline_global_sequence.is_some());
        assert_eq!(directed_message.body, "Please handle tool-call-1");
        let (permission_semantics, target_workspace_json, target_permissions): (
            String,
            String,
            String,
        ) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT permission_semantics, workspace_json,
                       runtime_permission_config_json
                FROM agent_run
                WHERE id = ?1
                "#,
                [target_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let target_workspace: Value = serde_json::from_str(&target_workspace_json).unwrap();
        assert_eq!(permission_semantics, "runtime_managed_v2");
        assert_eq!(
            target_workspace["executionRoot"],
            source_workspace["executionRoot"]
        );
        assert_eq!(target_workspace["access"], "write");
        assert_ne!(target_permissions, r#"{"senderOnly":true}"#);
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
    fn completed_a2a_run_returns_its_authored_output_without_a_system_receipt() {
        let mut fixture = Fixture::new();
        let invocation = fixture.invocation("complete-without-receipt", "agent-muwa");
        let posted = TeamToolService::default()
            .post_message(&mut fixture.database, &invocation)
            .expect("Team Tool should queue the target Run");
        let target_run_id = posted.result.payload["targetAgentRunId"]
            .as_str()
            .unwrap()
            .to_string();
        let (execution_epoch, _) =
            fixture.claim_bind_and_issue(&target_run_id, "native-target-complete");
        let runtime = ExecutionRuntimeService::default();
        let execution = runtime
            .load_agent_run_execution(&fixture.database, &target_run_id, execution_epoch)
            .unwrap()
            .expect("claimed target Run should remain executable");
        let completed = runtime
            .succeed_agent_run(
                &mut fixture.database,
                &CommandEnvelope {
                    command_id: "complete-a2a-target".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:codex-cli".to_string(),
                    },
                    camp_id: Some(fixture.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SucceedAgentRunCommand {
                        agent_run_id: target_run_id.clone(),
                        expected_version: execution.version,
                        execution_epoch,
                        native_turn_id: "native-turn-a2a".to_string(),
                        final_output: "沐瓦完成了页面检查。".to_string(),
                        ending_git_observation: None,
                    },
                },
            )
            .expect("target Run should complete");
        assert_eq!(completed.result.status, CommandResultStatus::Applied);

        let snapshot = ReadModelService
            .camp_snapshot(&mut fixture.database, &fixture.camp_id)
            .unwrap();
        assert!(snapshot.messages.iter().any(|message| {
            message.author_type == "agent"
                && message.author_id == "agent-muwa"
                && message.body == "沐瓦完成了页面检查。"
        }));
        assert!(
            !snapshot
                .messages
                .iter()
                .any(|message| message.author_id == "a2a-state")
        );
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
            std::env::temp_dir().join(format!("rovai-team-tool-placeholder-{}", Uuid::new_v4()));
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
                recipient: "agent-luoke".to_string(),
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
    fn source_recipient_resolves_trusted_a2a_sender_and_reply_correlation() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let invocation = fixture.invocation("implicit-request", "agent-muwa");
        let first = service
            .post_message(&mut fixture.database, &invocation)
            .unwrap();
        let source_inbox_id = first.result.payload["inboxMessageId"]
            .as_str()
            .unwrap()
            .to_string();
        let source_correlation_id = first.result.payload["correlationId"]
            .as_str()
            .unwrap()
            .to_string();
        let target_run_id = first.result.payload["targetAgentRunId"]
            .as_str()
            .unwrap()
            .to_string();
        let (target_epoch, recipient_credential) =
            fixture.claim_bind_and_issue(&target_run_id, "native-implicit-replier");
        let materialized = ContextService
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
            .unwrap();
        let ContextMaterialization::Ready(context) = materialized else {
            panic!("A2A target context should materialize");
        };
        assert!(context.rendered_payload.contains("[CURRENT_INPUT]"));
        assert!(
            context
                .rendered_payload
                .contains("\"senderName\": \"洛可\"")
        );
        assert!(
            context
                .rendered_payload
                .contains("\"replyTarget\": \"source\"")
        );
        assert!(!context.rendered_payload.contains("[TURN_ENVELOPE]"));
        assert!(!context.rendered_payload.contains(&source_inbox_id));
        assert!(!context.rendered_payload.contains("sourceInboxMessageId"));
        let returned = service
            .post_message(
                &mut fixture.database,
                &TeamToolInvocation {
                    native_binding_id: recipient_credential.native_binding_id,
                    binding_credential: recipient_credential.binding_credential,
                    runtime_tool_call_id: "implicit-reply".to_string(),
                    input: TeamPostMessageInput {
                        recipient: "source".to_string(),
                        body: "Implicitly correlated result".to_string(),
                        references: Vec::new(),
                        in_reply_to_message_id: None,
                    },
                },
            )
            .unwrap();
        let returned_inbox_id = returned.result.payload["inboxMessageId"].as_str().unwrap();
        let linkage: (Option<String>, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT in_reply_to_message_id, correlation_id
                FROM inbox_message WHERE id = ?1
                "#,
                [returned_inbox_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(linkage.0.as_deref(), Some(source_inbox_id.as_str()));
        assert_eq!(linkage.1, source_correlation_id);
    }

    #[test]
    fn recipient_without_team_tool_can_receive_but_self_send_creates_no_a2a_objects() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let source_invocation = fixture.invocation("source-from-direct-run", "source");
        let source_send = service
            .post_message(&mut fixture.database, &source_invocation)
            .unwrap();
        assert_eq!(source_send.result.code, "team_tool.source_unavailable");
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
        assert_eq!(unready.result.code, "team_tool.message_queued");
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
        assert_eq!(inbox_count, 1);
        assert_eq!(a2a_count, 1);
        let expected_output: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT expected_output FROM agent_run WHERE invocation_kind = 'a2a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(expected_output.contains("can receive this A2A request"));
        assert!(!expected_output.contains("explicitly call team.post_message"));
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
                        recipient: "agent-muwa".to_string(),
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
                recipient: "agent-muwa".to_string(),
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
                        starting_git_observation: None,
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
        let before_conversations: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM conversation WHERE camp_id = ?1 AND agent_profile_id = 'agent-muwa'",
                [&fixture.camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(before_conversations, 0);
        let rollback_invocation = fixture.invocation("rollback", "agent-muwa");
        TeamToolService::default()
            .post_message(&mut fixture.database, &rollback_invocation)
            .expect_err("injected failure should abort the transaction");
        let inbox_count: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM inbox_message", [], |row| row.get(0))
            .unwrap();
        let after_conversations: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM conversation WHERE camp_id = ?1 AND agent_profile_id = 'agent-muwa'",
                [&fixture.camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(inbox_count, 0);
        assert_eq!(after_conversations, 0);
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
                        companion_agent_profile_id: None,
                        relationship_agent_profile_ids: Vec::new(),
                        direction: None,
                        directed_actor_agent_profile_id: None,
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
            assert_eq!(
                first.result.payload["rovaiTeamTool"],
                MEMORY_PROPOSE_CHANGE_TOOL_NAME
            );
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
                                    .then(|| "agent-muwa".to_string()),
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
                    assert_eq!(
                        memory.directed_actor_agent_profile_id.as_deref(),
                        Some("agent-luoke")
                    );
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
                            counterparty_agent_id: Some("agent-muwa".to_string()),
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
                       candidate_directed_actor_agent_profile_id
                FROM memory_proposal
                WHERE id = ?1
                "#,
                    [execution.result.payload["proposalId"].as_str().unwrap()],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap();
            assert_eq!((low.as_str(), high.as_str()), ("agent-luoke", "agent-muwa"));
            assert_eq!(actor, "agent-luoke");
        }
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
