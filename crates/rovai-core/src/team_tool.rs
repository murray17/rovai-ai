use std::{fmt, sync::OnceLock};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    agent_profile::{AdapterKind, resolve_frozen_runtime},
    camp_history::{
        CAMP_LIST_TOOL_NAME, CAMP_READ_TOOL_NAME, CAMP_SEARCH_TOOL_NAME, HISTORY_SEARCH_TOOL_NAME,
    },
    collaboration::{
        CollaborationService, CreateTaskCommand, TaskAssigneeFilter, TaskAssigneeUpdate,
        TaskListPage, TaskListQuery, TaskStatus, UpdateTaskCommand, append_domain_event,
        build_effective_config, exhaust_camp_turn_execution_budget,
    },
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    conversation_input::{
        FrozenConversationInputBasis, FrozenRuntimeBasis, allocate_conversation_input_sequence,
        capture_run_runtime_basis,
    },
    db::Database,
    execution_budget::{
        CampTurnExecutionBudgetExhaustionReason, PRODUCT_MAX_ACCEPTED_A2A,
        camp_turn_execution_budget_now,
    },
    runtime::AgentRunWorkspace,
};

pub const TEAM_CALL_MEMBER_TOOL_NAME: &str = "team.call_member";
pub const TEAM_CREATE_TASK_TOOL_NAME: &str = "team.create_task";
pub const TEAM_UPDATE_TASK_TOOL_NAME: &str = "team.update_task";
pub const TEAM_LIST_TASKS_TOOL_NAME: &str = "team.list_tasks";
pub const TEAM_TOOL_NAMES: [&str; 12] = [
    TEAM_CALL_MEMBER_TOOL_NAME,
    TEAM_CREATE_TASK_TOOL_NAME,
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
pub const TEAM_CALL_MEMBER_CAPABILITY: &str = "team_tool.call_member";
pub const TEAM_CALL_MEMBER_MAX_CONTENT_BYTES: usize = 32 * 1024;
pub const MAX_A2A_DEPTH: i64 = 5;
pub const MAX_A2A_RUNS_PER_TURN: i64 = PRODUCT_MAX_ACCEPTED_A2A;
pub const A2A_DEPTH_WARNING_AT: i64 = 2;
pub const A2A_RUN_WARNING_AT: i64 = 12;

static TEAM_TOOL_PROCESS_SECRET: OnceLock<String> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamCallMemberInput {
    pub recipient: String,
    pub content: String,
    pub task_id: Option<String>,
}

fn runtime_team_tool_reference(adapter_kind: AdapterKind, canonical_name: &str) -> String {
    match adapter_kind {
        AdapterKind::OpencodeCli => format!(
            "OpenCode tool `rovai_team_{}` (canonical `{canonical_name}`)",
            canonical_name.replace('.', "_")
        ),
        AdapterKind::AntigravityApp => format!(
            "`{}` on MCP Server `rovai_team` (canonical `{canonical_name}`)",
            canonical_name
                .strip_prefix("team.")
                .unwrap_or(canonical_name)
                .replace('.', "_")
        ),
        _ => format!("`{canonical_name}`"),
    }
}

fn member_call_expected_output(adapter_kind: AdapterKind) -> String {
    let call_member = runtime_team_tool_reference(adapter_kind, TEAM_CALL_MEMBER_TOOL_NAME);
    let list_tasks = runtime_team_tool_reference(adapter_kind, TEAM_LIST_TASKS_TOOL_NAME);
    format!(
        "Complete the requested work. {call_member} is not the default action for ending this task. Call it only when the target member needs the message to continue acting or make a decision. Never use it to acknowledge receipt, reply politely, send non-blocking progress, or repeat information already shared. Before calling, confirm the target will have a clear next step after receiving it or is waiting for this necessary result; otherwise do not call. Do not sleep or poll {list_tasks} while waiting for collaboration results."
    )
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
pub struct TeamCallMemberCommand {
    native_binding_id: String,
    credential_digest: String,
    runtime_tool_call_id: String,
    recipient: String,
    content: String,
    task_id: Option<String>,
}

impl sealed::Sealed for TeamCallMemberCommand {}
impl DomainCommand for TeamCallMemberCommand {
    const TYPE: &'static str = "team.call_member";
}

/// The raw credential is deliberately separate from the durable domain command.
/// Command records contain only its digest, so the credential never reaches SQLite.
pub struct TeamToolInvocation {
    pub native_binding_id: String,
    pub binding_credential: String,
    pub runtime_tool_call_id: String,
    pub input: TeamCallMemberInput,
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
    credential_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RecordedTeamCommandIdentity {
    camp_id: String,
    agent_profile_id: String,
    source_agent_run_id: String,
    execution_epoch: i64,
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
    display_name: String,
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
            None,
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
            None,
        )?;
        Ok(AuthenticatedTeamToolRun {
            camp_id: identity.camp_id,
            agent_profile_id: identity.agent_profile_id,
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
        self.authenticate_attested_binding_with_capability(
            database,
            native_binding_id,
            binding_credential,
            runtime_tool_call_id,
            (agent_run_id, execution_epoch),
            None,
        )
    }

    pub fn authenticate_attested_binding_with_capability(
        &self,
        database: &Database,
        native_binding_id: &str,
        binding_credential: &str,
        runtime_tool_call_id: &str,
        attested_run: (&str, i64),
        required_capability: Option<&str>,
    ) -> Result<AuthenticatedTeamToolRun> {
        let (agent_run_id, execution_epoch) = attested_run;
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
            required_capability,
            Some((agent_run_id, execution_epoch)),
        )?;
        Ok(AuthenticatedTeamToolRun {
            camp_id: identity.camp_id,
            agent_profile_id: identity.agent_profile_id,
            agent_run_id: identity.agent_run_id,
            execution_epoch: identity.execution_epoch,
        })
    }

    pub fn authenticate_call_member_binding_or_recorded_scope(
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
                    SELECT camp_turn.camp_id, conversation.agent_profile_id,
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
                                agent_profile_id: row.get(1)?,
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
                            && recorded.agent_profile_id == candidate.agent_profile_id
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

    pub fn input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["recipient", "content"],
            "properties": {
                "recipient": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Stable AgentProfile ID of another active Camp member."
                },
                "content": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": TEAM_CALL_MEMBER_MAX_CONTENT_BYTES,
                    "description": "A complete private execution request that the recipient needs in order to continue acting or make a decision. Before calling, confirm the recipient will have a clear next step or is waiting for this necessary result. Do not send acknowledgements, courtesy replies, non-blocking progress, or repeated information."
                },
                "taskId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Optional current Task assigned to the recipient. It is validated when the call is accepted and retained only as historical execution context."
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
                 AND camp_member.agent_profile_id = conversation.agent_profile_id
                JOIN agent_profile ON agent_profile.id = conversation.agent_profile_id
                WHERE agent_run.id = ?1
                  AND agent_run.execution_epoch = ?2
                  AND agent_run.status = 'running'
                  AND agent_run.cancel_requested_at IS NULL
                  AND camp_turn.status IN ('running', 'waiting')
                  AND camp_turn.cancel_requested_at IS NULL
                  AND camp_turn.execution_budget_exhausted_at IS NULL
                  AND camp_turn.execution_budget_deadline_at > ?3
                  AND camp.status = 'active'
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

    pub fn call_member(
        &self,
        database: &mut Database,
        invocation: &TeamToolInvocation,
    ) -> Result<CommandExecution> {
        self.call_member_authorized(database, invocation, None)
    }

    pub fn call_member_attested(
        &self,
        database: &mut Database,
        invocation: &TeamToolInvocation,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<CommandExecution> {
        if agent_run_id.trim().is_empty() || execution_epoch <= 0 {
            return Err(invocation_error(
                "team_tool.invalid_attested_run",
                "Attested AgentRun identity is incomplete",
            ));
        }
        self.call_member_authorized(database, invocation, Some((agent_run_id, execution_epoch)))
    }

    fn call_member_authorized(
        &self,
        database: &mut Database,
        invocation: &TeamToolInvocation,
        attested_run: Option<(&str, i64)>,
    ) -> Result<CommandExecution> {
        validate_invocation(invocation)?;
        let supplied_credential_digest = credential_digest(&invocation.binding_credential);
        let command = TeamCallMemberCommand {
            native_binding_id: invocation.native_binding_id.clone(),
            credential_digest: supplied_credential_digest.clone(),
            runtime_tool_call_id: invocation.runtime_tool_call_id.clone(),
            recipient: invocation.input.recipient.clone(),
            content: invocation.input.content.clone(),
            task_id: invocation.input.task_id.clone(),
        };
        let command_id = team_command_id(
            &invocation.native_binding_id,
            &supplied_credential_digest,
            &invocation.runtime_tool_call_id,
        )?;
        // A canonical same-payload replay is resolved before the active fence.
        // The command identity includes the credential digest, while the
        // persisted actor/run metadata reconstructs the original envelope.
        // This lets an accepted or budget-exhausting result replay after the
        // Turn has fenced its original AgentRun without granting a novel call.
        if let Some(recorded) =
            load_recorded_team_command_identity(database.connection(), &command_id)?
        {
            if attested_run.is_some_and(|(agent_run_id, execution_epoch)| {
                recorded.source_agent_run_id != agent_run_id
                    || recorded.execution_epoch != execution_epoch
            }) {
                return Err(invocation_error(
                    "team_tool.binding_fenced",
                    "Recorded Team Tool command belongs to a different attested AgentRun",
                ));
            }
            let replay_envelope = CommandEnvelope {
                command_id: command_id.clone(),
                actor: ActorRef::Agent {
                    agent_profile_id: recorded.agent_profile_id,
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
                .context("recorded Team Tool command disappeared before replay");
        }

        // Novel calls still require one current active Native Binding and Run.
        let sender = resolve_sender_identity(
            database.connection(),
            &invocation.native_binding_id,
            &supplied_credential_digest,
            Some("member.call"),
            attested_run,
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
                Some("member.call"),
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
            let recipient_agent_id = envelope.payload.recipient.trim().to_string();
            if current.agent_profile_id == recipient_agent_id {
                return Ok(rejected(
                    "team_tool.self_send",
                    "team.call_member must target another Camp member",
                ));
            }
            if current.a2a_depth >= MAX_A2A_DEPTH {
                return Ok(rejected(
                    "team_tool.a2a_depth_exhausted",
                    "This forward Member Call would exceed the maximum depth of five",
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
            let linked_task_id = if let Some(task_id) = envelope.payload.task_id.as_deref() {
                let valid = transaction
                    .query_row(
                        r#"
                        SELECT id
                        FROM task
                        WHERE id = ?1
                          AND camp_id = ?2
                          AND assignee_agent_id = ?3
                          AND status IN ('pending', 'in_progress')
                        "#,
                        params![task_id, current.camp_id, recipient_agent_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?;
                let Some(valid) = valid else {
                    return Ok(rejected(
                        "team_tool.invalid_task",
                        "taskId must identify a non-terminal Task currently assigned to the recipient in this Camp",
                    ));
                };
                Some(valid)
            } else {
                None
            };

            let (turn_status, cancel_requested_at, budget_exhausted_at): (
                String,
                Option<String>,
                Option<String>,
            ) = transaction.query_row(
                r#"
                SELECT status, cancel_requested_at, execution_budget_exhausted_at
                FROM camp_turn
                WHERE id = ?1
                "#,
                [&current.camp_turn_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            if !matches!(turn_status.as_str(), "running" | "waiting")
                || cancel_requested_at.is_some()
                || budget_exhausted_at.is_some()
            {
                return Ok(rejected(
                    "team_tool.turn_not_active",
                    "The current CampTurn is no longer accepting Member Calls",
                ));
            }

            let now_instant = camp_turn_execution_budget_now();
            let now = now_instant.to_rfc3339();
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
            let target_effective_config = build_effective_config(
                transaction,
                &recipient_conversation_id,
                &recipient_agent_id,
                &recipient_runtime,
            )?;
            let caller_runtime_basis =
                capture_run_runtime_basis(transaction, &current.agent_run_id)?;
            let target_runtime_basis = FrozenRuntimeBasis {
                effective_config: target_effective_config,
                workspace: AgentRunWorkspace::runtime_managed_path(
                    caller_runtime_basis.workspace.execution_root.clone(),
                ),
            };
            target_runtime_basis.runtime()?;
            target_runtime_basis.workspace.validate()?;

            let (
                deadline_at,
                max_agent_run_responsibilities,
                max_accepted_a2a,
                root_agent_run_responsibilities,
                allocated_a2a,
            ): (String, i64, i64, i64, i64) = transaction.query_row(
                r#"
                SELECT execution_budget_deadline_at,
                       execution_budget_max_agent_run_responsibilities,
                       execution_budget_max_accepted_a2a,
                       execution_budget_root_agent_run_responsibilities,
                       a2a_run_slots_allocated
                FROM camp_turn
                WHERE id = ?1
                "#,
                [&current.camp_turn_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )?;
            let deadline = chrono::DateTime::parse_from_rfc3339(&deadline_at)
                .context("CampTurn Execution Budget deadline is invalid")?
                .with_timezone(&chrono::Utc);
            let next_accepted_a2a = allocated_a2a + 1;
            let next_agent_run_responsibilities =
                root_agent_run_responsibilities + next_accepted_a2a;
            let exhaustion_reason = if now_instant >= deadline {
                Some(CampTurnExecutionBudgetExhaustionReason::Elapsed)
            } else if next_accepted_a2a > max_accepted_a2a {
                Some(CampTurnExecutionBudgetExhaustionReason::AcceptedA2a)
            } else if next_agent_run_responsibilities > max_agent_run_responsibilities {
                Some(CampTurnExecutionBudgetExhaustionReason::AgentRunResponsibilities)
            } else {
                None
            };
            if let Some(reason) = exhaustion_reason {
                if created_recipient_conversation {
                    transaction.execute(
                        "DELETE FROM conversation WHERE id = ?1",
                        [&recipient_conversation_id],
                    )?;
                }
                let actor = ActorRef::Agent {
                    agent_profile_id: current.agent_profile_id.clone(),
                    source_agent_run_id: current.agent_run_id.clone(),
                };
                let exhaustion = exhaust_camp_turn_execution_budget(
                    transaction,
                    &current.camp_turn_id,
                    reason,
                    &envelope.command_id,
                    &now,
                    &actor,
                    Some(current.execution_epoch),
                )?;
                return Ok(CommandHandlerResult::rejected(
                    "team_tool.execution_budget_exhausted",
                    json!({
                        "message": "This otherwise valid Member Call would exceed the frozen CampTurn Execution Budget",
                        "reason": reason.as_str(),
                        "campTurnId": current.camp_turn_id,
                        "deadlineAt": deadline_at,
                        "maxAgentRunResponsibilities": max_agent_run_responsibilities,
                        "maxAcceptedA2a": max_accepted_a2a,
                        "allocatedAgentRunResponsibilities": exhaustion.allocated_agent_run_responsibilities,
                        "acceptedA2a": exhaustion.accepted_a2a,
                        "agentRunsFenced": exhaustion.agent_runs_fenced,
                        "conversationInputsCancelled": exhaustion.conversation_inputs_cancelled,
                    }),
                ));
            }

            let newly_allocated_slots = 1_i64;
            let touched_turn = transaction.execute(
                r#"
                UPDATE camp_turn
                SET a2a_run_slots_allocated = a2a_run_slots_allocated + ?2,
                    version = version + 1,
                    updated_at = ?3
                WHERE id = ?1
                  AND status IN ('running', 'waiting')
                  AND cancel_requested_at IS NULL
                  AND execution_budget_exhausted_at IS NULL
                  AND execution_budget_deadline_at > ?3
                  AND a2a_run_slots_allocated + ?2
                        <= execution_budget_max_accepted_a2a
                  AND execution_budget_root_agent_run_responsibilities
                        + a2a_run_slots_allocated + ?2
                        <= execution_budget_max_agent_run_responsibilities
                "#,
                params![current.camp_turn_id, newly_allocated_slots, now],
            )?;
            if touched_turn != 1 {
                anyhow::bail!(
                    "CampTurn changed before the Member Call responsibility was reserved"
                );
            }

            let inbox_message_id = Uuid::new_v4().to_string();
            let recipient_message_id = Uuid::new_v4().to_string();
            let conversation_input_id = Uuid::new_v4().to_string();
            let acceptance_receipt_id = format!("member-call:acceptance:{}", envelope.command_id);
            let target_depth = current.a2a_depth + 1;
            let root_run_id = current
                .a2a_root_agent_run_id
                .clone()
                .unwrap_or_else(|| current.agent_run_id.clone());
            let inbox_idempotency_key = format!("team:{}", envelope.command_id);
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
            let input_sequence = allocate_conversation_input_sequence(
                transaction,
                &recipient_conversation_id,
                &now,
            )?;
            let sender_name: String = transaction.query_row(
                "SELECT display_name FROM agent_profile WHERE id = ?1",
                [&current.agent_profile_id],
                |row| row.get(0),
            )?;
            let expected_output = member_call_expected_output(recipient_runtime.adapter_kind);
            let basis = FrozenConversationInputBasis {
                runtime: target_runtime_basis,
                task_id: linked_task_id.clone(),
                initial_camp_context_through_sequence: camp_sequence,
                initial_conversation_context_through_sequence: recipient_sequence,
                source_agent_run_id: current.agent_run_id.clone(),
                a2a_root_agent_run_id: root_run_id.clone(),
                a2a_depth: target_depth,
                purpose: format!("Handle member call from {}", current.agent_profile_id),
                expected_output,
            };
            let model_payload = json!({
                "source": {
                    "type": "member_call",
                    "senderMemberId": current.agent_profile_id,
                    "senderName": sender_name,
                },
                "message": envelope.payload.content,
            });
            let references = linked_task_id
                .as_ref()
                .map(|task_id| {
                    vec![EntityReference {
                        entity_type: "task".to_string(),
                        entity_id: task_id.clone(),
                    }]
                })
                .unwrap_or_default();

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
                    NULL, ?11, NULL, NULL, ?12,
                    NULL, NULL, 1, ?13,
                    NULL, NULL, NULL, NULL, NULL, ?13, ?13
                )
                "#,
                params![
                    inbox_message_id,
                    current.camp_id,
                    current.agent_profile_id,
                    recipient_agent_id,
                    envelope.payload.content,
                    serde_json::to_string(&references)?,
                    current.conversation_id,
                    current.camp_turn_id,
                    current.agent_run_id,
                    recipient_conversation_id,
                    conversation_input_id,
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
                    envelope.payload.content,
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
                INSERT INTO conversation_input(
                    id, conversation_id, camp_turn_id, sequence,
                    status, source_inbox_message_id, consuming_agent_run_id,
                    model_payload_json, frozen_execution_basis_json,
                    terminal_reason, created_at, materialized_at, terminal_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, 'pending', ?5,
                    NULL, ?6, ?7, NULL, ?8, NULL, NULL
                )
                "#,
                params![
                    conversation_input_id,
                    recipient_conversation_id,
                    current.camp_turn_id,
                    input_sequence,
                    inbox_message_id,
                    serde_json::to_string(&model_payload)?,
                    serde_json::to_string(&basis)?,
                    now,
                ],
            )?;

            let acknowledged = transaction.execute(
                r#"
                UPDATE inbox_message
                SET recipient_message_id = ?2,
                    delivered_at = ?3,
                    updated_at = ?3
                WHERE id = ?1
                  AND recipient_message_id IS NULL
                  AND delivered_at IS NULL
                "#,
                params![inbox_message_id, recipient_message_id, now],
            )?;
            if acknowledged != 1 {
                anyhow::bail!("Member Call delivery acknowledgement was lost");
            }

            let actor = ActorRef::Agent {
                agent_profile_id: current.agent_profile_id.clone(),
                source_agent_run_id: current.agent_run_id.clone(),
            };
            append_domain_event(
                transaction,
                "member_call.accepted",
                Some(&current.camp_id),
                Some(("member_call", &acceptance_receipt_id)),
                &actor,
                Some(current.execution_epoch),
                &json!({
                    "acceptanceReceiptId": acceptance_receipt_id,
                    "commandId": envelope.command_id,
                    "campTurnId": current.camp_turn_id,
                    "senderMemberId": current.agent_profile_id,
                    "recipientMemberId": recipient_agent_id,
                    "sourceAgentRunId": current.agent_run_id,
                    "conversationInputId": conversation_input_id,
                    "inboxMessageId": inbox_message_id,
                    "taskId": linked_task_id,
                    "slot": next_accepted_a2a,
                    "depth": target_depth,
                    "allocatedAgentRunResponsibilities": next_agent_run_responsibilities,
                }),
            )?;
            append_domain_event(
                transaction,
                "inbox_message.delivered",
                Some(&current.camp_id),
                Some(("inbox_message", &inbox_message_id)),
                &actor,
                Some(current.execution_epoch),
                &json!({
                    "recipientMessageId": recipient_message_id,
                    "conversationInputId": conversation_input_id,
                    "deliveryMode": "durable_conversation_input",
                }),
            )?;
            append_domain_event(
                transaction,
                "conversation_input.accepted",
                Some(&current.camp_id),
                Some(("conversation_input", &conversation_input_id)),
                &actor,
                Some(current.execution_epoch),
                &json!({
                    "campTurnId": current.camp_turn_id,
                    "taskId": linked_task_id,
                    "sequence": input_sequence,
                    "sourceInboxMessageId": inbox_message_id,
                    "a2aParentAgentRunId": current.agent_run_id,
                    "a2aRootAgentRunId": root_run_id,
                    "a2aDepth": target_depth,
                }),
            )?;

            Ok(CommandHandlerResult::accepted(
                "team_tool.member_call_accepted",
                json!({
                    "status": "accepted",
                    "acceptanceReceiptId": acceptance_receipt_id,
                    "campTurnId": current.camp_turn_id,
                    "recipient": recipient_agent_id,
                    "recipientName": recipient.display_name,
                    "taskLinked": linked_task_id.is_some(),
                    "slot": next_accepted_a2a,
                    "depth": target_depth,
                    "allocatedAgentRunResponsibilities": next_agent_run_responsibilities,
                }),
                None,
            ))
        })
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
            None,
            attested_run,
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
            None,
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
            None,
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
    if invocation.input.recipient.trim().is_empty() || invocation.input.content.trim().is_empty() {
        return Err(invocation_error(
            "team_tool.invalid_input",
            "Recipient Agent ID and content are required",
        ));
    }
    if invocation.input.content.len() > TEAM_CALL_MEMBER_MAX_CONTENT_BYTES {
        return Err(invocation_error(
            "team_tool.content_too_large",
            "Member Call content exceeds the 32 KiB Team Tool limit",
        ));
    }
    if invocation
        .input
        .task_id
        .as_deref()
        .is_some_and(|value| value.trim().is_empty())
    {
        return Err(invocation_error(
            "team_tool.invalid_task",
            "taskId must not be empty",
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
    required_capability: Option<&str>,
    attested_run: Option<(&str, i64)>,
) -> Result<SenderIdentity> {
    resolve_sender_identity_by_digest(
        connection,
        native_binding_id,
        credential_digest,
        required_capability,
        attested_run,
    )
}

fn resolve_sender_identity_by_digest(
    connection: &Connection,
    native_binding_id: &str,
    credential_digest: &str,
    required_capability: Option<&str>,
    attested_run: Option<(&str, i64)>,
) -> Result<SenderIdentity> {
    let identity = connection
        .query_row(
            r#"
            SELECT conversation.camp_id, conversation.id,
                   conversation.agent_profile_id,
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
             AND camp_member.agent_profile_id = conversation.agent_profile_id
            JOIN agent_profile ON agent_profile.id = conversation.agent_profile_id
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
              AND camp.status = 'active'
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
                        conversation_id: row.get(1)?,
                        agent_profile_id: row.get(2)?,
                        agent_run_id: row.get(3)?,
                        execution_epoch: row.get(4)?,
                        camp_turn_id: row.get(5)?,
                        a2a_root_agent_run_id: row.get(6)?,
                        a2a_depth: row.get(7)?,
                        credential_digest: row.get(10)?,
                    },
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, String>(11)?,
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
    let target = transaction
        .query_row(
            r#"
            SELECT conversation.id, agent_profile.display_name
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
            |row| {
                Ok(RecipientTarget {
                    conversation_id: row.get(0)?,
                    display_name: row.get(1)?,
                })
            },
        )
        .optional()?;
    let Some(target) = target else {
        return Ok(Err(rejected(
            "team_tool.recipient_unavailable",
            "Recipient is not an active member of the sender Camp",
        )));
    };
    Ok(Ok(target))
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
        .any(|capability| capability == TEAM_CALL_MEMBER_CAPABILITY)
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
    let Some((camp_id, actor_type, agent_profile_id, source_agent_run_id, execution_epoch)) =
        recorded
    else {
        return Ok(None);
    };
    if actor_type != "agent" {
        anyhow::bail!("recorded Team Tool command actor is not an Agent");
    }
    Ok(Some(RecordedTeamCommandIdentity {
        camp_id: camp_id.context("recorded Team Tool command has no Camp")?,
        agent_profile_id,
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
            AcknowledgeAgentRunCancellationCommand, BindNativeSessionCommand,
            CancelCampTurnCommand, ClaimAgentRunCommand, ExecutionRuntimeService,
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

    impl Fixture {
        fn new() -> Self {
            let directory =
                std::env::temp_dir().join(format!("rovai-team-tool-test-{}", Uuid::new_v4()));
            let workspace = directory.join("workspace");
            std::fs::create_dir_all(&workspace).expect("workspace should exist");
            let mut database = Database::open(&directory).expect("database should open");
            configure_test_runtime(&database, &["agent_1", "agent_2"]);
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
                            assignee_agent_id: Some("agent_1".to_string()),
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
                            draft_revision: None,
                            body: "Start the collaboration".to_string(),
                            prepared_attachment_ids: Vec::new(),
                            address: MessageAddressSpec::Explicit {
                                agent_profile_ids: vec!["agent_1".to_string()],
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

        fn invocation(&self, call_id: &str, recipient: &str) -> TeamToolInvocation {
            TeamToolInvocation {
                native_binding_id: self.credential.native_binding_id.clone(),
                binding_credential: self.credential.binding_credential.clone(),
                runtime_tool_call_id: call_id.to_string(),
                input: TeamCallMemberInput {
                    recipient: recipient.to_string(),
                    content: format!("Please handle {call_id}"),
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

        fn materialize_one_input(&mut self) -> String {
            assert_eq!(
                crate::conversation_input::materialize_pending_inputs(&mut self.database, 100)
                    .expect("Conversation Input should materialize"),
                1
            );
            self.database
                .connection()
                .query_row(
                    r#"
                    SELECT agent_run.id
                    FROM agent_run
                    JOIN conversation_input
                      ON conversation_input.id = agent_run.trigger_conversation_input_id
                    WHERE agent_run.camp_turn_id = (
                        SELECT camp_turn_id FROM agent_run WHERE id = ?1
                    )
                    ORDER BY conversation_input.created_at DESC,
                             conversation_input.sequence DESC
                    LIMIT 1
                    "#,
                    [&self.source_run_id],
                    |row| row.get(0),
                )
                .expect("materialized AgentRun should exist")
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
    fn tool_schema_exposes_only_model_owned_fields() {
        let schema = TeamToolService::input_schema();
        let properties = schema["properties"].as_object().unwrap();
        assert_eq!(properties.len(), 3);
        assert!(properties.contains_key("recipient"));
        assert!(properties.contains_key("content"));
        assert!(properties.contains_key("taskId"));
        assert!(
            serde_json::from_value::<TeamCallMemberInput>(json!({
                "recipient": "agent_2",
                "content": "Review this decision",
                "returnPolicy": "required"
            }))
            .is_err(),
            "the unreleased return field must not retain a compatibility parser"
        );
        for forbidden in [
            "senderAgentId",
            "senderMemberId",
            "campId",
            "sourceAgentRunId",
            "executionEpoch",
            "body",
            "source",
            "inReplyToMessageId",
            "references",
            "correlationId",
            "idempotencyKey",
        ] {
            assert!(!properties.contains_key(forbidden));
        }
    }

    #[test]
    fn member_call_expected_output_names_runtime_callable_without_weakening_canonical_identity() {
        let opencode = member_call_expected_output(AdapterKind::OpencodeCli);
        assert!(opencode.contains("OpenCode tool `rovai_team_team_call_member`"));
        assert!(opencode.contains("canonical `team.call_member`"));
        assert!(opencode.contains("not the default action"));
        assert!(opencode.contains("continue acting or make a decision"));
        assert!(opencode.contains("acknowledge receipt"));
        assert!(opencode.contains("`rovai_team_team_list_tasks`"));

        let antigravity = member_call_expected_output(AdapterKind::AntigravityApp);
        assert!(antigravity.contains("`call_member` on MCP Server `rovai_team`"));
        assert!(antigravity.contains("canonical `team.call_member`"));

        let codex = member_call_expected_output(AdapterKind::CodexCli);
        assert!(codex.contains("`team.call_member` is not the default action"));
        assert!(!codex.contains("rovai_team_team_call_member"));
    }

    #[test]
    fn sender_gate_uses_frozen_capability_instead_of_adapter_allowlist() {
        ensure_runtime_supports_team_tool(
            Some(AdapterKind::AntigravityApp.as_str()),
            Some(r#"["team_tool.call_member"]"#),
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
                assignee_agent_id: NullableInput::Value("agent_1".to_string()),
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
            input: TeamCallMemberInput {
                recipient: "agent_2".to_string(),
                content: "Continue collaboration after approval".to_string(),
                task_id: None,
            },
        };
        let result = service
            .call_member(&mut fixture.database, &invocation)
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
            .call_member(
                &mut fixture.database,
                &TeamToolInvocation {
                    native_binding_id: credential.native_binding_id,
                    binding_credential: credential.binding_credential,
                    runtime_tool_call_id: "sender-waiting".to_string(),
                    input: TeamCallMemberInput {
                        recipient: "agent_2".to_string(),
                        content: "This sender is not executing".to_string(),
                        task_id: None,
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
    fn call_member_persists_one_input_before_materializing_one_run() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let invocation = fixture.invocation("persist-first", "agent_2");

        let accepted = service
            .call_member(&mut fixture.database, &invocation)
            .expect("Member Call should be accepted");
        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
        assert_eq!(accepted.result.code, "team_tool.member_call_accepted");
        assert_eq!(accepted.result.payload["status"], "accepted");
        assert_eq!(accepted.result.payload["recipient"], "agent_2");
        assert!(accepted.result.payload.get("returnPolicy").is_none());
        assert_eq!(accepted.result.payload["taskLinked"], false);
        for forbidden in [
            "inboxMessageId",
            "conversationInputId",
            "returnObligationId",
            "targetAgentRunId",
            "correlationId",
        ] {
            assert!(accepted.result.payload.get(forbidden).is_none());
        }

        let (
            input_id,
            input_status,
            inbox_id,
            recipient_message_id,
            delivered_at,
            target_run_id,
            payload_json,
        ): (
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
        ) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT conversation_input.id, conversation_input.status,
                       inbox_message.id, inbox_message.recipient_message_id,
                       inbox_message.delivered_at, inbox_message.target_agent_run_id,
                       conversation_input.model_payload_json
                FROM conversation_input
                JOIN inbox_message
                  ON inbox_message.id = conversation_input.source_inbox_message_id
                "#,
                [],
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
        assert_eq!(input_status, "pending");
        assert!(recipient_message_id.is_some());
        assert!(delivered_at.is_some());
        assert_eq!(target_run_id, None);
        let payload: Value = serde_json::from_str(&payload_json).unwrap();
        assert_eq!(payload["source"]["type"], "member_call");
        assert_eq!(payload["source"]["senderMemberId"], "agent_1");
        assert_eq!(payload["source"]["senderName"], "小狐狸");
        assert!(payload["source"].get("returnPolicy").is_none());
        assert_eq!(payload["message"], "Please handle persist-first");
        let pre_materialization_runs: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM agent_run WHERE invocation_kind = 'a2a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pre_materialization_runs, 0);

        let run_id = fixture.materialize_one_input();
        let (run_status, depth, trigger_input_id, linked_inbox_run, workspace_json): (
            String,
            i64,
            String,
            Option<String>,
            String,
        ) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT agent_run.status, agent_run.a2a_depth,
                       agent_run.trigger_conversation_input_id,
                       inbox_message.target_agent_run_id,
                       agent_run.workspace_json
                FROM agent_run
                JOIN inbox_message ON inbox_message.id = ?2
                WHERE agent_run.id = ?1
                "#,
                params![run_id, inbox_id],
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
        assert_eq!(run_status, "queued");
        assert_eq!(depth, 1);
        assert_eq!(trigger_input_id, input_id);
        assert_eq!(linked_inbox_run.as_deref(), Some(run_id.as_str()));
        let workspace: Value = serde_json::from_str(&workspace_json).unwrap();
        assert_eq!(workspace["access"], "write");

        let snapshot = ReadModelService
            .camp_snapshot(&mut fixture.database, &fixture.camp_id)
            .unwrap();
        let directed = snapshot
            .inbox_messages
            .iter()
            .find(|message| message.id == inbox_id)
            .expect("Inbox projection should retain the Member Call");
        assert_eq!(directed.body, "Please handle persist-first");
        assert_eq!(
            directed.target_agent_run_id.as_deref(),
            Some(run_id.as_str())
        );
        let projected_input = snapshot
            .conversation_inputs
            .iter()
            .find(|input| input.id == input_id)
            .expect("ConversationInput projection should retain the durable scheduler state");
        assert_eq!(projected_input.status, "materialized");
        assert_eq!(
            projected_input.consuming_agent_run_id.as_deref(),
            Some(run_id.as_str())
        );
        let replay = service
            .call_member(&mut fixture.database, &invocation)
            .expect("same Tool Call should replay");
        assert!(replay.replayed);
        let input_count: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM conversation_input WHERE id = ?1",
                [&input_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(input_count, 1);
    }

    #[test]
    fn task_link_is_validated_at_acceptance_then_remains_historical() {
        let mut fixture = Fixture::new();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE task SET assignee_agent_id = 'agent_2' WHERE id = ?1",
                [&fixture.task_id],
            )
            .unwrap();
        let mut invocation = fixture.invocation("task-linked", "agent_2");
        invocation.input.task_id = Some(fixture.task_id.clone());

        let accepted = TeamToolService::default()
            .call_member(&mut fixture.database, &invocation)
            .unwrap();
        assert_eq!(accepted.result.payload["taskLinked"], true);
        let basis_json: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT frozen_execution_basis_json FROM conversation_input",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let basis: Value = serde_json::from_str(&basis_json).unwrap();
        assert_eq!(basis["taskId"], fixture.task_id);

        fixture
            .database
            .connection()
            .execute(
                "UPDATE task SET status = 'completed', closed_at = ?2 WHERE id = ?1",
                params![fixture.task_id, chrono::Utc::now().to_rfc3339()],
            )
            .unwrap();
        let run_id = fixture.materialize_one_input();
        let linked_task_id: Option<String> = fixture
            .database
            .connection()
            .query_row(
                "SELECT task_id FROM agent_run WHERE id = ?1",
                [&run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(linked_task_id.as_deref(), Some(fixture.task_id.as_str()));
        assert!(
            ExecutionRuntimeService::default()
                .list_dispatchable_agent_runs(&fixture.database, 100)
                .unwrap()
                .iter()
                .any(|candidate| candidate.agent_run_id == run_id),
            "a later Task transition must not cancel or block an accepted Member Call"
        );
    }

    #[test]
    fn recipient_completion_without_another_call_never_contacts_the_source() {
        let mut fixture = Fixture::new();
        let invocation = fixture.invocation("one-way-completion", "agent_2");
        TeamToolService::default()
            .call_member(&mut fixture.database, &invocation)
            .unwrap();
        let target_run_id = fixture.materialize_one_input();
        let (target_epoch, _) =
            fixture.claim_bind_and_issue(&target_run_id, "native-one-way-completion");
        fixture.succeed_run(
            &target_run_id,
            target_epoch,
            "TARGET_RESULT_REMAINS_USER_FACING",
        );

        let counts: (i64, i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT
                  (SELECT COUNT(*) FROM inbox_message),
                  (SELECT COUNT(*) FROM conversation_input),
                  (SELECT COUNT(*) FROM agent_run WHERE invocation_kind = 'a2a'),
                  (SELECT a2a_run_slots_allocated FROM camp_turn
                   WHERE id = (SELECT camp_turn_id FROM agent_run WHERE id = ?1))
                "#,
                [&fixture.source_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(counts, (1, 1, 1, 1));

        let snapshot = ReadModelService
            .camp_snapshot(&mut fixture.database, &fixture.camp_id)
            .unwrap();
        let final_output = snapshot
            .messages
            .iter()
            .find(|message| message.source_agent_run_id.as_deref() == Some(target_run_id.as_str()))
            .expect("recipient final output should remain visible to the user");
        assert_eq!(final_output.body, "TARGET_RESULT_REMAINS_USER_FACING");
        assert_eq!(snapshot.inbox_messages.len(), 1);
        assert_eq!(snapshot.conversation_inputs.len(), 1);
    }

    #[test]
    fn reverse_member_call_is_an_independent_forward_edge() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let request = fixture.invocation("forward-request", "agent_2");
        service
            .call_member(&mut fixture.database, &request)
            .unwrap();
        let muwa_run_id = fixture.materialize_one_input();
        let (muwa_epoch, muwa_credential) =
            fixture.claim_bind_and_issue(&muwa_run_id, "native-forward-muwa");

        let reverse_request = TeamToolInvocation {
            native_binding_id: muwa_credential.native_binding_id,
            binding_credential: muwa_credential.binding_credential,
            runtime_tool_call_id: "independent-reverse-request".to_string(),
            input: TeamCallMemberInput {
                recipient: "agent_1".to_string(),
                content: "Use this result for the next integration decision.".to_string(),
                task_id: None,
            },
        };
        service
            .call_member(&mut fixture.database, &reverse_request)
            .unwrap();

        let allocated_slots: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT a2a_run_slots_allocated FROM camp_turn WHERE id = (SELECT camp_turn_id FROM agent_run WHERE id = ?1)",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(allocated_slots, 2);

        fixture.succeed_run(&muwa_run_id, muwa_epoch, "local work complete");
        let input_count: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM conversation_input", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            input_count, 2,
            "finishing the recipient Run must not synthesize another input"
        );

        let source_run_id = fixture.source_run_id.clone();
        fixture.succeed_run(
            &source_run_id,
            fixture.source_epoch,
            "ready for the integration result",
        );
        let reverse_run_id = fixture.materialize_one_input();
        let (depth, parent_run_id, root_run_id): (i64, Option<String>, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                "SELECT a2a_depth, a2a_parent_agent_run_id, a2a_root_agent_run_id FROM agent_run WHERE id = ?1",
                [&reverse_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(depth, 2);
        assert_eq!(parent_run_id.as_deref(), Some(muwa_run_id.as_str()));
        assert_eq!(root_run_id.as_deref(), Some(source_run_id.as_str()));
    }

    #[test]
    fn turn_stop_cancels_pending_member_calls_without_creating_runs() {
        let mut fixture = Fixture::new();
        let request = fixture.invocation("turn-stop-member-call", "agent_2");
        TeamToolService::default()
            .call_member(&mut fixture.database, &request)
            .unwrap();

        let (camp_turn_id, turn_version): (String, i64) = fixture
            .database
            .connection()
            .query_row(
                "SELECT camp_turn_id, (SELECT version FROM camp_turn WHERE id = agent_run.camp_turn_id) FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let cancelled = ExecutionRuntimeService::default()
            .request_camp_turn_cancellation(
                &mut fixture.database,
                &user_envelope(
                    "turn-stop-member-call",
                    Some(&fixture.camp_id),
                    CancelCampTurnCommand {
                        camp_id: fixture.camp_id.clone(),
                        camp_turn_id,
                        expected_version: turn_version,
                    },
                ),
            )
            .unwrap();
        assert_eq!(cancelled.result.status, CommandResultStatus::Accepted);
        assert_eq!(cancelled.result.payload["conversationInputsCancelled"], 1);
        assert!(
            cancelled
                .result
                .payload
                .get("returnObligationsCancelled")
                .is_none()
        );

        let state: (String, Option<String>, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT conversation_input.status,
                       conversation_input.terminal_reason,
                       (SELECT COUNT(*) FROM agent_run WHERE invocation_kind = 'a2a')
                FROM conversation_input
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(state.0, "cancelled");
        assert_eq!(state.1.as_deref(), Some("cancelled_by_turn"));
        assert_eq!(state.2, 0);
    }

    #[test]
    fn busy_recipient_keeps_later_calls_pending_in_fifo_order() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let first_invocation = fixture.invocation("fifo-first", "agent_2");
        service
            .call_member(&mut fixture.database, &first_invocation)
            .unwrap();
        let first_run_id = fixture.materialize_one_input();
        let (first_epoch, _) = fixture.claim_bind_and_issue(&first_run_id, "native-fifo-first");

        let second_invocation = fixture.invocation("fifo-second", "agent_2");
        service
            .call_member(&mut fixture.database, &second_invocation)
            .unwrap();
        assert_eq!(
            crate::conversation_input::materialize_pending_inputs(&mut fixture.database, 100)
                .unwrap(),
            0
        );
        let statuses = {
            let mut statement = fixture
                .database
                .connection()
                .prepare("SELECT status FROM conversation_input ORDER BY sequence")
                .unwrap();
            statement
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        assert_eq!(statuses, vec!["materialized", "pending"]);
        let run_count: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM agent_run WHERE invocation_kind = 'a2a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(run_count, 1);

        fixture.succeed_run(&first_run_id, first_epoch, "first call complete");
        let second_run_id = fixture.materialize_one_input();
        assert_ne!(second_run_id, first_run_id);
        let sequences: Vec<i64> = {
            let mut statement = fixture
                .database
                .connection()
                .prepare("SELECT sequence FROM conversation_input ORDER BY sequence")
                .unwrap();
            statement
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        assert_eq!(sequences, vec![1, 2]);
    }

    #[test]
    fn member_call_context_uses_safe_payload_without_internal_ids() {
        let mut fixture = Fixture::new();
        fixture
            .database
            .connection()
            .execute(
                r#"
            UPDATE agent_profile
            SET personality_traits_json = '["PEER_PRIVATE_TRAIT"]',
                working_principles = 'PEER_PRIVATE_PRINCIPLE',
                growth_topic = 'PEER_PRIVATE_GROWTH'
            WHERE id = 'agent_1'
            "#,
                [],
            )
            .unwrap();
        let invocation = fixture.invocation("context-member-call", "agent_2");
        TeamToolService::default()
            .call_member(&mut fixture.database, &invocation)
            .unwrap();
        let (input_id, inbox_id): (String, String) = fixture
            .database
            .connection()
            .query_row(
                "SELECT id, source_inbox_message_id FROM conversation_input",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let target_run_id = fixture.materialize_one_input();
        let (target_epoch, _) =
            fixture.claim_bind_and_issue(&target_run_id, "native-context-member-call");
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
            panic!("Member Call context should materialize");
        };
        assert!(
            context
                .rendered_payload
                .contains("\"type\": \"member_call\"")
        );
        assert!(
            context
                .rendered_payload
                .contains("\"senderMemberId\": \"agent_1\"")
        );
        assert!(
            context
                .rendered_payload
                .contains("\"senderName\": \"小狐狸\"")
        );
        assert!(!context.rendered_payload.contains("returnPolicy"));
        assert!(
            context
                .rendered_payload
                .contains("\"message\": \"Please handle context-member-call\"")
        );
        assert!(!context.rendered_payload.contains("replyTarget"));
        assert!(!context.rendered_payload.contains("sourceInboxMessageId"));
        assert!(!context.rendered_payload.contains(&input_id));
        assert!(!context.rendered_payload.contains(&inbox_id));
        assert!(!context.rendered_payload.contains("PEER_PRIVATE_TRAIT"));
        assert!(!context.rendered_payload.contains("PEER_PRIVATE_PRINCIPLE"));
        assert!(!context.rendered_payload.contains("PEER_PRIVATE_GROWTH"));
    }

    #[test]
    fn pending_member_call_survives_restart_and_materializes_once() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let invocation = fixture.invocation("restart-pending-input", "agent_2");
        let accepted = service
            .call_member(&mut fixture.database, &invocation)
            .unwrap();
        let (input_id, inbox_id): (String, String) = fixture
            .database
            .connection()
            .query_row(
                "SELECT id, source_inbox_message_id FROM conversation_input",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        let placeholder_directory =
            std::env::temp_dir().join(format!("rovai-team-tool-placeholder-{}", Uuid::new_v4()));
        let placeholder = Database::open(&placeholder_directory).unwrap();
        let old = std::mem::replace(&mut fixture.database, placeholder);
        drop(old);
        let reopened = Database::open(&fixture.directory).unwrap();
        let placeholder = std::mem::replace(&mut fixture.database, reopened);
        drop(placeholder);
        std::fs::remove_dir_all(&placeholder_directory).unwrap();

        fixture.database.prepare_v2_recovery().unwrap();
        let target_run_id = fixture.materialize_one_input();
        assert!(
            ExecutionRuntimeService::default()
                .list_dispatchable_agent_runs(&fixture.database, 100)
                .unwrap()
                .iter()
                .any(|candidate| candidate.agent_run_id == target_run_id)
        );
        let replay = service
            .call_member(&mut fixture.database, &invocation)
            .expect("an exact accepted replay must survive the restart fence");
        assert!(replay.replayed);
        assert_eq!(replay.result.payload, accepted.result.payload);
        let novel_invocation = fixture.invocation("restart-novel-input", "agent_2");
        let stale = service
            .call_member(&mut fixture.database, &novel_invocation)
            .expect_err("restart must fence a novel call through the old running Binding");
        assert_eq!(
            stale
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.binding_fenced"
        );
        let counts: (i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
            SELECT
              (SELECT COUNT(*) FROM conversation_input WHERE id = ?1),
              (SELECT COUNT(*) FROM inbox_message WHERE id = ?2),
              (SELECT COUNT(*) FROM agent_run
               WHERE trigger_conversation_input_id = ?1)
            "#,
                params![input_id, inbox_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(counts, (1, 1, 1));
    }

    #[test]
    fn same_tool_call_id_with_different_input_conflicts() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let first = fixture.invocation("stable-call", "agent_2");
        service.call_member(&mut fixture.database, &first).unwrap();
        let mut changed = fixture.invocation("stable-call", "agent_2");
        changed.input.content = "Different semantic request".to_string();
        let error = service
            .call_member(&mut fixture.database, &changed)
            .expect_err("changed input must conflict");
        assert!(error.downcast_ref::<CommandGatewayError>().is_some());
    }

    #[test]
    fn source_alias_and_self_call_are_rejected_without_a2a_objects() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let source_invocation = fixture.invocation("no-source-alias", "source");
        let source = service
            .call_member(&mut fixture.database, &source_invocation)
            .unwrap();
        assert_eq!(source.result.code, "team_tool.recipient_unavailable");
        let self_invocation = fixture.invocation("no-self-call", "agent_1");
        let self_call = service
            .call_member(&mut fixture.database, &self_invocation)
            .unwrap();
        assert_eq!(self_call.result.code, "team_tool.self_send");
        let counts: (i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
            SELECT
              (SELECT COUNT(*) FROM inbox_message),
              (SELECT COUNT(*) FROM conversation_input)
            "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(counts, (0, 0));
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
        let new_invocation = fixture.invocation("resumed-run-call", "agent_2");
        let accepted = service
            .call_member(&mut fixture.database, &new_invocation)
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
            .call_member(
                &mut fixture.database,
                &TeamToolInvocation {
                    native_binding_id: credential.native_binding_id,
                    binding_credential: credential.binding_credential,
                    runtime_tool_call_id: "capability-denied".to_string(),
                    input: TeamCallMemberInput {
                        recipient: "agent_2".to_string(),
                        content: "This request has no authority".to_string(),
                        task_id: None,
                    },
                },
            )
            .expect_err("tool presence must not grant member.call");
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
        let old_invocation = fixture.invocation("prepared-old", "agent_2");
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
            .call_member(&mut fixture.database, &old_invocation)
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
            input: TeamCallMemberInput {
                recipient: "agent_2".to_string(),
                content: "This must not dispatch before Native Session attachment".to_string(),
                task_id: None,
            },
        };
        let unattached_error = service
            .call_member(&mut fixture.database, &prepared_invocation)
            .expect_err("reserved credential must be unusable before Session attachment");
        assert_eq!(
            unattached_error
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.binding_fenced"
        );

        let unattached_read_error = service
            .authenticate_read_binding(
                &fixture.database,
                &prepared.native_binding_id,
                &prepared.binding_credential,
                "prepared-read-before-attach",
            )
            .expect_err("bearer authentication must remain fenced before Session attachment");
        assert_eq!(
            unattached_read_error
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.binding_fenced"
        );
        let authenticated = service
            .authenticate_attested_binding(
                &fixture.database,
                &prepared.native_binding_id,
                &prepared.binding_credential,
                "prepared-attested-read-before-attach",
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .expect("the exact OS-attested Run may authenticate its prepared Binding");
        assert_eq!(authenticated.agent_run_id, fixture.source_run_id);

        let create_task = TeamTaskToolInvocation {
            native_binding_id: prepared.native_binding_id.clone(),
            binding_credential: prepared.binding_credential.clone(),
            runtime_tool_call_id: "prepared-create-task".to_string(),
            input: TeamCreateTaskInput {
                title: "Prepared Binding task".to_string(),
                description: "Created before Native Session discovery".to_string(),
                assignee_agent_id: None,
            },
        };
        let ordinary_task_error = service
            .create_task(&mut fixture.database, &create_task)
            .expect_err("ordinary task authentication must remain fenced before attachment");
        assert_eq!(
            ordinary_task_error
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.binding_fenced"
        );
        let created_task = service
            .create_task_attested(
                &mut fixture.database,
                &create_task,
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .expect("attested task creation should work before Session attachment");
        let created_task_id = created_task.result.payload["taskId"]
            .as_str()
            .unwrap()
            .to_string();
        let listed_tasks = service
            .list_tasks_attested(
                &fixture.database,
                &TeamTaskToolInvocation {
                    native_binding_id: prepared.native_binding_id.clone(),
                    binding_credential: prepared.binding_credential.clone(),
                    runtime_tool_call_id: "prepared-list-tasks".to_string(),
                    input: TeamListTasksInput {
                        statuses: None,
                        assignee_agent_id: NullableInput::Missing,
                        unassigned_only: false,
                        limit: 50,
                        cursor: None,
                    },
                },
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .expect("attested task listing should work before Session attachment");
        assert!(
            listed_tasks
                .tasks
                .iter()
                .any(|task| task.task.id == created_task_id)
        );
        let updated_task = service
            .update_task_attested(
                &mut fixture.database,
                &TeamTaskToolInvocation {
                    native_binding_id: prepared.native_binding_id.clone(),
                    binding_credential: prepared.binding_credential.clone(),
                    runtime_tool_call_id: "prepared-update-task".to_string(),
                    input: TeamUpdateTaskInput {
                        task_id: created_task_id,
                        expected_version: 1,
                        title: None,
                        description: None,
                        status: Some(TaskStatus::InProgress),
                        assignee_agent_id: NullableInput::Value("agent_1".to_string()),
                        clear_assignee: false,
                    },
                },
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .expect("attested task update should work before Session attachment");
        assert_eq!(updated_task.result.payload["version"], 2);

        let memory_write = MemoryWriteToolInvocation {
            native_binding_id: prepared.native_binding_id.clone(),
            binding_credential: prepared.binding_credential.clone(),
            runtime_tool_call_id: "prepared-memory-write".to_string(),
            input: MemoryWriteToolInput {
                action: "add".to_string(),
                scope: Some(MemoryScopeKind::Companion),
                kind: Some(MemoryKind::Lesson),
                body: "Prepared bindings use the attested AgentRun identity.".to_string(),
                retrieval_keys: vec!["prepared binding".to_string()],
                counterparty_agent_id: None,
                direction: None,
                memory_id: None,
                base_revision_id: None,
            },
        };
        let ordinary_memory_error = MemoryToolService
            .write(&mut fixture.database, &memory_write)
            .expect_err("ordinary memory authentication must remain fenced before attachment");
        assert_eq!(
            ordinary_memory_error
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.binding_fenced"
        );
        let written_memory = MemoryToolService
            .write_attested(
                &mut fixture.database,
                &memory_write,
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .expect("attested memory write should work before Session attachment");
        let memory_id = written_memory.result.payload["memoryId"]
            .as_str()
            .unwrap()
            .to_string();
        let memory_search = MemoryRetrievalInvocation {
            native_binding_id: prepared.native_binding_id.clone(),
            binding_credential: prepared.binding_credential.clone(),
            runtime_tool_call_id: "prepared-memory-search".to_string(),
            input: MemorySearchInput {
                query: "prepared binding".to_string(),
                limit: Some(6),
            },
        };
        let ordinary_search_error = MemoryRetrievalService
            .search(&mut fixture.database, &memory_search)
            .expect_err("ordinary memory search must remain fenced before attachment");
        assert_eq!(
            ordinary_search_error
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.binding_fenced"
        );
        let search_output = MemoryRetrievalService
            .search_attested(
                &mut fixture.database,
                &memory_search,
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .expect("attested memory search should work before Session attachment");
        assert!(
            search_output
                .results
                .iter()
                .any(|memory| memory.memory_id == memory_id)
        );
        let read_output = MemoryRetrievalService
            .read_attested(
                &mut fixture.database,
                &MemoryRetrievalInvocation {
                    native_binding_id: prepared.native_binding_id.clone(),
                    binding_credential: prepared.binding_credential.clone(),
                    runtime_tool_call_id: "prepared-memory-read".to_string(),
                    input: MemoryReadInput {
                        memory_ids: vec![memory_id],
                    },
                },
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .expect("attested memory read should work before Session attachment");
        assert_eq!(
            read_output.memories[0].cache_state,
            MemoryCacheState::Current
        );
        let proposed_hearth = MemoryToolService
            .propose_hearth_attested(
                &mut fixture.database,
                &HearthProposalToolInvocation {
                    native_binding_id: prepared.native_binding_id.clone(),
                    binding_credential: prepared.binding_credential.clone(),
                    runtime_tool_call_id: "prepared-memory-propose-hearth".to_string(),
                    input: HearthProposalToolInput {
                        action: "add".to_string(),
                        kind: Some(MemoryKind::Agreement),
                        body: "Prepared bindings require exact OS Run attestation.".to_string(),
                        retrieval_keys: vec!["run attestation".to_string()],
                        memory_id: None,
                        base_revision_id: None,
                    },
                },
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .expect("attested Hearth proposal should work before Session attachment");
        assert_eq!(proposed_hearth.result.status, CommandResultStatus::Accepted);

        let attested = service
            .call_member_attested(
                &mut fixture.database,
                &prepared_invocation,
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .expect(
                "an OS-attested active Run may use its prepared Binding before Session discovery",
            );
        assert_eq!(attested.result.status, CommandResultStatus::Accepted);
        let wrong_run = service
            .call_member_attested(
                &mut fixture.database,
                &TeamToolInvocation {
                    native_binding_id: prepared_invocation.native_binding_id.clone(),
                    binding_credential: prepared_invocation.binding_credential.clone(),
                    runtime_tool_call_id: "prepared-wrong-run".to_string(),
                    input: prepared_invocation.input.clone(),
                },
                "wrong-run",
                fixture.source_epoch,
            )
            .expect_err("attestation must match the exact active AgentRun");
        assert_eq!(
            wrong_run
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
            .call_member(&mut fixture.database, &prepared_invocation)
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
        let invocation = fixture.invocation("recovered-epoch", "agent_2");
        let accepted = TeamToolService::default()
            .call_member(&mut fixture.database, &invocation)
            .expect("the stable Bridge should resolve the current execution epoch");
        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
    }

    #[test]
    fn depth_and_execution_budget_exhaustion_reject_without_partial_effects_and_replay() {
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
        let too_deep_invocation = fixture.invocation("too-deep", "agent_2");
        let depth = service
            .call_member(&mut fixture.database, &too_deep_invocation)
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
        let camp_turn_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT camp_turn_id FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE camp_turn
                SET execution_budget_max_agent_run_responsibilities = 3,
                    execution_budget_max_accepted_a2a = 2
                WHERE id = ?1
                "#,
                [&camp_turn_id],
            )
            .unwrap();

        let first_invocation = fixture.invocation(
            &format!("agent-run:{}:budget-1", fixture.source_run_id),
            "agent_2",
        );
        let first = service
            .call_member(&mut fixture.database, &first_invocation)
            .unwrap();
        assert_eq!(first.result.status, CommandResultStatus::Accepted);
        assert_eq!(first.result.payload["slot"], 1);
        let first_receipt = first.result.payload["acceptanceReceiptId"]
            .as_str()
            .unwrap()
            .to_string();
        let second_invocation = fixture.invocation(
            &format!("agent-run:{}:budget-2", fixture.source_run_id),
            "agent_2",
        );
        let second = service
            .call_member(&mut fixture.database, &second_invocation)
            .unwrap();
        assert_eq!(second.result.status, CommandResultStatus::Accepted);
        assert_eq!(second.result.payload["slot"], 2);
        assert_ne!(
            second.result.payload["acceptanceReceiptId"],
            first.result.payload["acceptanceReceiptId"]
        );

        let before: (i64, i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT (SELECT COUNT(*) FROM inbox_message),
                       (SELECT COUNT(*) FROM conversation_input),
                       (SELECT COUNT(*) FROM conversation_message),
                       a2a_run_slots_allocated
                FROM camp_turn WHERE id = ?1
                "#,
                [&camp_turn_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        let overflow_invocation = fixture.invocation(
            &format!("agent-run:{}:quota-overflow", fixture.source_run_id),
            "agent_2",
        );
        let rejected = service
            .call_member(&mut fixture.database, &overflow_invocation)
            .unwrap();
        assert!(!rejected.replayed);
        assert_eq!(rejected.result.code, "team_tool.execution_budget_exhausted");
        assert_eq!(rejected.result.payload["reason"], "accepted_a2a");
        let after: (i64, i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT (SELECT COUNT(*) FROM inbox_message),
                       (SELECT COUNT(*) FROM conversation_input),
                       (SELECT COUNT(*) FROM conversation_message),
                       a2a_run_slots_allocated
                FROM camp_turn WHERE id = ?1
                "#,
                [&camp_turn_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(before, after);

        let budget_state: (String, String, String, i64, i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT execution_budget_exhausted_at,
                       execution_budget_exhaustion_reason,
                       execution_budget_exhaustion_command_id,
                       a2a_run_slots_allocated,
                       (SELECT COUNT(*) FROM conversation_input WHERE status = 'cancelled'),
                       (SELECT COUNT(*) FROM event_log WHERE event_type = 'member_call.accepted'),
                       (SELECT COUNT(*) FROM event_log WHERE event_type = 'camp_turn.execution_budget_exhausted')
                FROM camp_turn WHERE id = ?1
                "#,
                [&camp_turn_id],
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
        assert!(!budget_state.0.is_empty());
        assert_eq!(budget_state.1, "accepted_a2a");
        assert_eq!(budget_state.2, rejected.result.command_id);
        assert_eq!(budget_state.3, 2);
        assert_eq!(budget_state.4, 2);
        assert_eq!(budget_state.5, 2);
        assert_eq!(budget_state.6, 1);
        let snapshot = ReadModelService
            .camp_snapshot(&mut fixture.database, &fixture.camp_id)
            .unwrap();
        let budget_view = &snapshot
            .turns
            .iter()
            .find(|turn| turn.id == camp_turn_id)
            .unwrap()
            .execution_budget;
        assert_eq!(budget_view.schema_version, 1);
        assert_eq!(budget_view.max_agent_run_responsibilities, 3);
        assert_eq!(budget_view.max_accepted_a2a, 2);
        assert_eq!(budget_view.allocated_agent_run_responsibilities, 3);
        assert_eq!(budget_view.accepted_a2a, 2);
        assert!(budget_view.exhausted_at.is_some());
        assert_eq!(
            budget_view.exhaustion_reason.as_deref(),
            Some("accepted_a2a")
        );
        assert_eq!(
            budget_view.exhaustion_command_id.as_deref(),
            Some(rejected.result.command_id.as_str())
        );
        let run_fence: (i64, String) = fixture
            .database
            .connection()
            .query_row(
                "SELECT cancel_requested_at IS NOT NULL, cancel_reason_code FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(run_fence, (1, "execution_budget_exhausted".to_string()));

        let rejected_replay = service
            .call_member(&mut fixture.database, &overflow_invocation)
            .unwrap();
        assert!(rejected_replay.replayed);
        assert_eq!(rejected_replay.result, rejected.result);
        let recorded_scope = service
            .authenticate_call_member_binding_or_recorded_scope(
                &fixture.database,
                &fixture.credential.native_binding_id,
                &fixture.credential.binding_credential,
                "quota-overflow",
                None,
            )
            .unwrap();
        assert_eq!(recorded_scope.agent_run_id, fixture.source_run_id);
        assert_eq!(recorded_scope.execution_epoch, fixture.source_epoch);
        let accepted_scope = service
            .authenticate_call_member_binding_or_recorded_scope(
                &fixture.database,
                &fixture.credential.native_binding_id,
                &fixture.credential.binding_credential,
                "budget-1",
                Some((&fixture.source_run_id, fixture.source_epoch)),
            )
            .unwrap();
        assert_eq!(accepted_scope.agent_run_id, fixture.source_run_id);
        let accepted_replay = service
            .call_member(&mut fixture.database, &first_invocation)
            .unwrap();
        assert!(accepted_replay.replayed);
        assert_eq!(
            accepted_replay.result.payload["acceptanceReceiptId"],
            first_receipt
        );

        let mut changed_replay = fixture.invocation(
            &format!("agent-run:{}:quota-overflow", fixture.source_run_id),
            "agent_2",
        );
        changed_replay.input.content = "Different payload".to_string();
        let conflict = service
            .call_member(&mut fixture.database, &changed_replay)
            .expect_err("changed payload must conflict with the recorded command identity");
        assert!(matches!(
            conflict.downcast_ref::<CommandGatewayError>(),
            Some(CommandGatewayError::IdempotencyConflict { .. })
        ));
        let novel = fixture.invocation(
            &format!("agent-run:{}:after-budget-fence", fixture.source_run_id),
            "agent_2",
        );
        let fenced = service
            .call_member(&mut fixture.database, &novel)
            .expect_err("a novel call must not cross the exhausted Turn fence");
        assert_eq!(
            fenced
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.binding_fenced"
        );

        let runtime = ExecutionRuntimeService::default();
        let candidate = runtime
            .list_cancellation_candidates(&fixture.database, 10)
            .unwrap()
            .into_iter()
            .find(|candidate| candidate.agent_run_id == fixture.source_run_id)
            .unwrap();
        let acknowledged = runtime
            .acknowledge_agent_run_cancellation(
                &mut fixture.database,
                &CommandEnvelope {
                    command_id: "ack-budget-exhaustion".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-cancellation-coordinator".to_string(),
                    },
                    camp_id: Some(fixture.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: AcknowledgeAgentRunCancellationCommand {
                        agent_run_id: fixture.source_run_id.clone(),
                        expected_version: candidate.version,
                        execution_epoch: candidate.execution_epoch,
                        ending_git_observation: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(
            acknowledged.result.payload["reasonCode"],
            "execution_budget_exhausted"
        );
        assert_eq!(acknowledged.result.payload["campTurnStatus"], "failed");
    }

    #[test]
    fn agent_run_responsibility_exhaustion_removes_a_transient_recipient_conversation() {
        let mut fixture = Fixture::new();
        let camp_turn_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT camp_turn_id FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE camp_turn
                SET execution_budget_max_agent_run_responsibilities = 1,
                    execution_budget_max_accepted_a2a = 2
                WHERE id = ?1
                "#,
                [&camp_turn_id],
            )
            .unwrap();
        let before: (i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT (SELECT COUNT(*) FROM conversation
                        WHERE camp_id = ?1 AND agent_profile_id = 'agent_2'),
                       (SELECT COUNT(*) FROM inbox_message),
                       (SELECT COUNT(*) FROM conversation_input)
                "#,
                [&fixture.camp_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(before, (0, 0, 0));

        let invocation = fixture.invocation("responsibility-overflow", "agent_2");
        let rejected = TeamToolService::default()
            .call_member(&mut fixture.database, &invocation)
            .unwrap();
        assert_eq!(rejected.result.code, "team_tool.execution_budget_exhausted");
        assert_eq!(
            rejected.result.payload["reason"],
            "agent_run_responsibilities"
        );
        let after: (i64, i64, i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT (SELECT COUNT(*) FROM conversation
                        WHERE camp_id = ?1 AND agent_profile_id = 'agent_2'),
                       (SELECT COUNT(*) FROM inbox_message),
                       (SELECT COUNT(*) FROM conversation_input),
                       a2a_run_slots_allocated,
                       (SELECT COUNT(*) FROM event_log
                        WHERE event_type = 'member_call.accepted')
                FROM camp_turn WHERE id = ?2
                "#,
                params![fixture.camp_id, camp_turn_id],
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
        assert_eq!(after, (0, 0, 0, 0, 0));
    }

    #[test]
    fn concurrent_member_calls_cannot_overcommit_one_remaining_acceptance_slot() {
        let fixture = Fixture::new();
        let camp_turn_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT camp_turn_id FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE camp_turn
                SET execution_budget_max_agent_run_responsibilities = 2,
                    execution_budget_max_accepted_a2a = 1
                WHERE id = ?1
                "#,
                [&camp_turn_id],
            )
            .unwrap();

        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let handles = ["concurrent-a", "concurrent-b"].map(|call_id| {
            let directory = fixture.directory.clone();
            let barrier = barrier.clone();
            let native_binding_id = fixture.credential.native_binding_id.clone();
            let binding_credential = fixture.credential.binding_credential.clone();
            std::thread::spawn(move || {
                let mut database = Database::open(&directory).unwrap();
                barrier.wait();
                TeamToolService::default()
                    .call_member(
                        &mut database,
                        &TeamToolInvocation {
                            native_binding_id,
                            binding_credential,
                            runtime_tool_call_id: call_id.to_string(),
                            input: TeamCallMemberInput {
                                recipient: "agent_2".to_string(),
                                content: format!("Handle {call_id}"),
                                task_id: None,
                            },
                        },
                    )
                    .unwrap()
            })
        });
        barrier.wait();
        let results = handles.map(|handle| handle.join().unwrap());
        let mut statuses = results
            .iter()
            .map(|result| (result.result.status, result.result.code.as_str()))
            .collect::<Vec<_>>();
        statuses.sort_by_key(|(_, code)| *code);
        assert_eq!(
            statuses,
            vec![
                (
                    CommandResultStatus::Rejected,
                    "team_tool.execution_budget_exhausted"
                ),
                (
                    CommandResultStatus::Accepted,
                    "team_tool.member_call_accepted"
                ),
            ]
        );
        let state: (i64, i64, i64, i64, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT a2a_run_slots_allocated,
                       (SELECT COUNT(*) FROM event_log WHERE event_type = 'member_call.accepted'),
                       (SELECT COUNT(*) FROM inbox_message),
                       (SELECT COUNT(*) FROM conversation_input),
                       execution_budget_exhaustion_reason
                FROM camp_turn WHERE id = ?1
                "#,
                [&camp_turn_id],
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
        assert_eq!(state, (1, 1, 1, 1, "accepted_a2a".to_string()));
    }

    #[test]
    fn elapsed_budget_is_authoritative_during_an_otherwise_valid_member_call() {
        let mut fixture = Fixture::new();
        let camp_turn_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT camp_turn_id FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        let expired_deadline =
            (camp_turn_execution_budget_now() - chrono::Duration::seconds(1)).to_rfc3339();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE camp_turn SET execution_budget_deadline_at = ?2 WHERE id = ?1",
                params![camp_turn_id, expired_deadline],
            )
            .unwrap();
        let invocation = fixture.invocation("elapsed-overflow", "agent_2");
        let rejected = TeamToolService::default()
            .call_member(&mut fixture.database, &invocation)
            .unwrap();
        assert_eq!(rejected.result.code, "team_tool.execution_budget_exhausted");
        assert_eq!(rejected.result.payload["reason"], "elapsed");
        let state: (i64, i64, i64, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT (SELECT COUNT(*) FROM conversation
                        WHERE camp_id = ?1 AND agent_profile_id = 'agent_2'),
                       (SELECT COUNT(*) FROM inbox_message),
                       a2a_run_slots_allocated,
                       execution_budget_exhaustion_reason
                FROM camp_turn WHERE id = ?2
                "#,
                params![fixture.camp_id, camp_turn_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(state, (0, 0, 0, "elapsed".to_string()));
    }

    #[test]
    fn database_failure_rolls_back_inbox_message_and_recipient_message() {
        let mut fixture = Fixture::new();
        fixture
            .database
            .connection()
            .execute_batch(
                r#"
                CREATE TRIGGER fail_member_call_input
                BEFORE INSERT ON conversation_input
                BEGIN
                    SELECT RAISE(ABORT, 'injected Member Call failure');
                END;
                "#,
            )
            .unwrap();
        let before_conversations: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM conversation WHERE camp_id = ?1 AND agent_profile_id = 'agent_2'",
                [&fixture.camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(before_conversations, 0);
        let rollback_invocation = fixture.invocation("rollback", "agent_2");
        TeamToolService::default()
            .call_member(&mut fixture.database, &rollback_invocation)
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
                "SELECT COUNT(*) FROM conversation WHERE camp_id = ?1 AND agent_profile_id = 'agent_2'",
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
                    assert_eq!(
                        memory.directed_actor_agent_profile_id.as_deref(),
                        Some("agent_1")
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
                       candidate_directed_actor_agent_profile_id
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

    #[test]
    fn deterministic_pre_run_failures_fail_input_without_sending_back_to_source() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let invocation = fixture.invocation("pre-run-auth-revoked", "agent_2");
        service
            .call_member(&mut fixture.database, &invocation)
            .expect("Member Call should be accepted before authorization changes");

        let frozen_basis: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT frozen_execution_basis_json FROM conversation_input",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let frozen_basis: Value = serde_json::from_str(&frozen_basis).unwrap();
        let revoked_capability = frozen_basis["runtime"]["effectiveConfig"]["capabilities"]
            .as_array()
            .and_then(|capabilities| capabilities.first())
            .and_then(Value::as_str)
            .expect("fixture should freeze at least one capability");
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE camp_member
                SET capability_overrides_json = ?3
                WHERE camp_id = ?1 AND agent_profile_id = ?2
                "#,
                params![
                    fixture.camp_id,
                    "agent_2",
                    serde_json::to_string(&json!({ (revoked_capability): "deny" })).unwrap(),
                ],
            )
            .unwrap();

        assert_eq!(
            crate::conversation_input::materialize_pending_inputs(&mut fixture.database, 100)
                .unwrap(),
            0
        );
        let member_call: (String, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                "SELECT status, terminal_reason FROM conversation_input",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let counts: (i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT
                  (SELECT COUNT(*) FROM agent_run WHERE invocation_kind = 'a2a'),
                  (SELECT COUNT(*) FROM conversation_input),
                  (SELECT COUNT(*) FROM inbox_message)
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            member_call,
            (
                "failed".to_string(),
                Some("authorization_revoked".to_string())
            )
        );
        assert_eq!(counts, (0, 1, 1));
    }

    #[test]
    fn disabled_frozen_runtime_fails_call_without_sending_back_to_source() {
        let mut fixture = Fixture::new();
        let invocation = fixture.invocation("pre-run-runtime-disabled", "agent_2");
        TeamToolService::default()
            .call_member(&mut fixture.database, &invocation)
            .expect("Member Call should be accepted before Runtime changes");
        fixture
            .database
            .connection()
            .execute(
                "UPDATE adapter_installation SET enabled = 0 WHERE id = 'adapter-test-codex'",
                [],
            )
            .unwrap();

        assert_eq!(
            crate::conversation_input::materialize_pending_inputs(&mut fixture.database, 100)
                .unwrap(),
            0
        );
        let state: (String, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                "SELECT status, terminal_reason FROM conversation_input",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let counts: (i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT
                  (SELECT COUNT(*) FROM agent_run WHERE invocation_kind = 'a2a'),
                  (SELECT COUNT(*) FROM conversation_input),
                  (SELECT COUNT(*) FROM inbox_message)
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            state,
            (
                "failed".to_string(),
                Some("runtime_basis_no_longer_current".to_string())
            )
        );
        assert_eq!(counts, (0, 1, 1));
    }

    #[test]
    fn camp_aggregate_deletion_removes_member_call_references_without_foreign_key_leaks() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let invocation = fixture.invocation("delete-member-call-aggregate", "agent_2");
        service
            .call_member(&mut fixture.database, &invocation)
            .expect("Member Call should be persisted");

        let transaction = fixture.database.connection_mut().transaction().unwrap();
        crate::collaboration::delete_camp_aggregate(&transaction, &fixture.camp_id)
            .expect("Camp aggregate deletion should break durable A2A reference cycles");
        transaction.commit().unwrap();

        let camp_count: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp WHERE id = ?1",
                [&fixture.camp_id],
                |row| row.get(0),
            )
            .unwrap();
        let foreign_key_violations: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(camp_count, 0);
        assert_eq!(foreign_key_violations, 0);
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
        capabilities.push(TEAM_CALL_MEMBER_CAPABILITY.to_string());
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
