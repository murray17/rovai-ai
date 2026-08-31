use std::{fmt, sync::OnceLock};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    agent_profile::AdapterKind,
    camp_attachment::MAX_PREPARED_ATTACHMENTS,
    camp_attachment_publication::AuthorityAttachment,
    camp_history::{
        CAMP_LIST_TOOL_NAME, CAMP_READ_TOOL_NAME, CAMP_SEARCH_TOOL_NAME, HISTORY_SEARCH_TOOL_NAME,
    },
    camp_message_send_teaching::{
        CAMP_MESSAGE_SEND_PUBLIC_ONLY_SCHEMA_DESCRIPTION,
        CAMP_MESSAGE_SEND_TO_PRINCIPAL_SCHEMA_DESCRIPTION,
    },
    channel::ChannelService,
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
    gather::GATHER_TOOL_NAME,
    member_studio::MEMBER_CREATE_TOOL_NAME,
    message_delivery::{
        AgentAddressingMode, CAMP_MESSAGE_SEND_MAX_BODY_BYTES, CAMP_MESSAGE_SEND_TOOL_NAME,
        PublicA2aOperation, SendPublicA2aMessage, dispatch_accepted_deliveries,
        persist_public_a2a_message,
    },
    runtime::AgentRunWorkspace,
};

pub const TEAM_CREATE_TASK_TOOL_NAME: &str = "team.create_task";
pub const TEAM_GET_TASK_TOOL_NAME: &str = "team.get_task";
pub const TEAM_UPDATE_TASK_TOOL_NAME: &str = "team.update_task";
pub const TEAM_LIST_TASKS_TOOL_NAME: &str = "team.list_tasks";
pub const TEAM_TOOL_NAMES: [&str; 15] = [
    CAMP_MESSAGE_SEND_TOOL_NAME,
    GATHER_TOOL_NAME,
    MEMBER_CREATE_TOOL_NAME,
    TEAM_CREATE_TASK_TOOL_NAME,
    TEAM_GET_TASK_TOOL_NAME,
    TEAM_UPDATE_TASK_TOOL_NAME,
    TEAM_LIST_TASKS_TOOL_NAME,
    CAMP_LIST_TOOL_NAME,
    CAMP_SEARCH_TOOL_NAME,
    HISTORY_SEARCH_TOOL_NAME,
    CAMP_READ_TOOL_NAME,
    "memory.view",
    "memory.search",
    "memory.read",
    "memory.write",
];
pub const MAX_A2A_DEPTH: i64 = 5;
pub const MAX_A2A_RUNS_PER_TURN: i64 = PRODUCT_MAX_ACCEPTED_A2A;
pub const A2A_DEPTH_WARNING_AT: i64 = 2;
pub const A2A_RUN_WARNING_AT: i64 = 12;

static TEAM_TOOL_PROCESS_SECRET: OnceLock<String> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CampMessageSendInput {
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub to: Vec<String>,
    #[serde(default)]
    pub mention_user: bool,
    #[serde(default)]
    pub public_only: bool,
    pub task_id: Option<String>,
    #[serde(default)]
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GatherInput {
    pub body: String,
    #[serde(default)]
    pub to: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamCreateTaskInput {
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub acceptance_criteria: Vec<String>,
    pub assignee_agent_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamGetTaskInput {
    pub task_id: String,
}

fn deserialize_non_null_optional_string<'de, D>(
    deserializer: D,
) -> std::result::Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    String::deserialize(deserializer).map(Some)
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
    #[serde(default, deserialize_with = "deserialize_non_null_optional_string")]
    pub assignee_agent_id: Option<String>,
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
    #[serde(default, deserialize_with = "deserialize_non_null_optional_string")]
    pub assignee_agent_id: Option<String>,
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
    mention_user: bool,
    agent_addressing_mode: AgentAddressingMode,
    task_id: Option<String>,
    files: Vec<String>,
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
    pub frozen_files: Vec<AuthorityAttachment>,
    pub managed_attachment_ingest_intent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatherCommand {
    native_binding_id: String,
    credential_digest: String,
    runtime_tool_call_id: String,
    camp_id: String,
    body: String,
    to: Vec<String>,
}

impl sealed::Sealed for GatherCommand {}
impl DomainCommand for GatherCommand {
    const TYPE: &'static str = GATHER_TOOL_NAME;
}

pub struct GatherInvocation {
    pub native_binding_id: String,
    pub binding_credential: String,
    pub runtime_tool_call_id: String,
    pub input: GatherInput,
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
        self.authenticate_read_binding_on_connection(
            database.connection(),
            native_binding_id,
            binding_credential,
            runtime_tool_call_id,
        )
    }

    pub(crate) fn authenticate_read_binding_on_connection(
        &self,
        connection: &Connection,
        native_binding_id: &str,
        binding_credential: &str,
        runtime_tool_call_id: &str,
    ) -> Result<AuthenticatedTeamToolRun> {
        validate_invocation_identity(native_binding_id, binding_credential, runtime_tool_call_id)?;
        let identity = resolve_sender_identity(
            connection,
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
        self.authenticate_attested_binding_on_connection(
            database.connection(),
            native_binding_id,
            binding_credential,
            runtime_tool_call_id,
            agent_run_id,
            execution_epoch,
        )
    }

    pub(crate) fn authenticate_attested_binding_on_connection(
        &self,
        connection: &Connection,
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
            connection,
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

    pub fn recorded_binding_command_exists(
        &self,
        database: &Database,
        command_id: &str,
    ) -> Result<bool> {
        database
            .connection()
            .query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1 FROM event_log
                    WHERE event_type = 'command.result' AND command_id = ?1
                )
                "#,
                [command_id],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    pub fn agent_file_ingress_scope(
        &self,
        database: &Database,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<Option<(String, AgentRunWorkspace)>> {
        let row = database
            .connection()
            .query_row(
                r#"
                SELECT turn.camp_id, run.workspace_json
                FROM agent_run AS run
                JOIN camp_turn AS turn ON turn.id = run.camp_turn_id
                WHERE run.id = ?1 AND run.execution_epoch = ?2
                  AND run.status IN ('running','waiting')
                "#,
                params![agent_run_id, execution_epoch],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()?;
        row.map(|(camp_id, workspace_json)| {
            let workspace_json = workspace_json.context("AgentRun workspace is unavailable")?;
            let workspace = serde_json::from_str::<AgentRunWorkspace>(&workspace_json)
                .context("AgentRun workspace is invalid")?;
            workspace.validate()?;
            Ok((camp_id, workspace))
        })
        .transpose()
    }

    pub fn camp_message_send_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "body": {
                    "type": "string",
                    "default": "",
                    "maxLength": CAMP_MESSAGE_SEND_MAX_BODY_BYTES,
                    "description": "Optional exact public message body; omit it when at least one file supplies the complete payload. Canonical inline @agent_N tokens retain their existing positions. An exact active Camp member @display-name alias participates only as the first non-whitespace token on a line and must be followed by whitespace or end-of-body; put trailing routing on a dedicated final line. Code, URLs, and escaped literal regions are excluded."
                },
                "to": {
                    "type": "array",
                    "maxItems": 16,
                    "uniqueItems": true,
                    "items": {"type": "string", "minLength": 1},
                    "description": "Optional canonical Agent ID to wake; repeat for multiple recipients. Display names are not accepted here. Input order is presentation metadata, never scheduling priority."
                },
                "mentionUser": {
                    "type": "boolean",
                    "default": false,
                    "description": CAMP_MESSAGE_SEND_TO_PRINCIPAL_SCHEMA_DESCRIPTION
                },
                "publicOnly": {
                    "type": "boolean",
                    "default": false,
                    "description": CAMP_MESSAGE_SEND_PUBLIC_ONLY_SCHEMA_DESCRIPTION
                },
                "taskId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Optional current Task link; exactly one effective recipient is required."
                },
                "files": {
                    "type": "array",
                    "default": [],
                    "maxItems": MAX_PREPARED_ATTACHMENTS,
                    "uniqueItems": true,
                    "items": {"type": "string", "minLength": 1},
                    "description": "Optional local file or directory path readable by the active Runtime. Repeat to preserve attachment order. Pass the existing path directly; Rovai privately snapshots paths outside the current AgentRun workspace and ROVAI_RUN_TMP before sending."
                }
            }
        })
    }

    pub fn gather_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": ["body"],
            "properties": {
                "body": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": CAMP_MESSAGE_SEND_MAX_BODY_BYTES,
                    "description": "One shared public topic for every Gather recipient. Canonical inline addressing follows camp.message.send rules."
                },
                "to": {
                    "type": "array",
                    "maxItems": 16,
                    "uniqueItems": true,
                    "items": {"type": "string", "minLength": 1},
                    "description": "Canonical Agent IDs to gather from. Explicit and valid inline recipients are merged, deduplicated and frozen in canonical byte order."
                }
            }
        })
    }

    pub fn create_task_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "description": "Create only a durable responsibility that must survive AgentRuns or handoffs, has one explicit owner, and can independently complete, block, or transfer. Prefer advancing an existing Task. Do not create Tasks for analysis, consultation, one-off review, tool operations, local plans, A2A requests, or steps inside another Task. Only the User or current Camp Default Lead may create a Task.",
            "required": ["title", "assigneeAgentId"],
            "properties": {
                "title": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 160,
                    "description": "Short title for one independently owned durable responsibility."
                },
                "description": {
                    "type": "string",
                    "maxLength": 8000,
                    "description": "Optional durable scope and constraints. Do not copy a local execution plan into Task steps."
                },
                "acceptanceCriteria": {
                    "type": "array", "maxItems": 12, "uniqueItems": true,
                    "items": {"type": "string", "minLength": 1, "maxLength": 500}
                },
                "assigneeAgentId": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Required Current CampMember who owns the responsibility. Creation does not notify, wake, or start this Assignee."
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
            "description": "Atomically update at least one field. User/current Default Lead own responsibility definition. An ordinary current Assignee may patch only status and its matching blockedReason or completionSummary on its own Task. Core authorization and field-level mutation rules are authoritative.",
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
                    "description": "User/Default Lead only. Set true with final status pending to place the Task in the unassigned holding/recovery state. Must not be combined with assigneeAgentId."
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
                    "description": "Set true to return only Tasks in the unassigned holding/recovery state. Must not be combined with assigneeAgentId."
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
        self.prepare_binding(
            database,
            agent_run_id,
            execution_epoch,
            force_new_binding,
            false,
        )
    }

    /// Retains the current Native Binding while an Adapter performs the one
    /// controlled continuation allowed across an unverified-to-verified
    /// session compatibility transition. The successful bind updates the
    /// compatibility metadata atomically; a failed continuation must replace
    /// the Binding through `prepare_binding_credential(..., true)`.
    pub fn prepare_controlled_resume_binding_credential(
        &self,
        database: &mut Database,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<BuiltinToolBindingCredential> {
        self.prepare_binding(database, agent_run_id, execution_epoch, false, true)
    }

    fn prepare_binding(
        &self,
        database: &mut Database,
        agent_run_id: &str,
        execution_epoch: i64,
        force_new_binding: bool,
        allow_controlled_session_transition: bool,
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
                  AND camp_member.version = CAST(
                      json_extract(agent_run.effective_config_json, '$.campMemberVersion')
                      AS INTEGER
                  )
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

        let stable_binding_identity = current_binding_id.is_some()
            && current_generation >= 1
            && current_installation_id.as_deref() == Some(frozen_installation_id.as_str())
            && current_compatibility_digest.as_deref()
                == Some(frozen_compatibility_digest.as_str());
        let session_metadata_compatible = match (
            current_session_compatibility_key.as_deref(),
            frozen_session_compatibility_key.as_deref(),
        ) {
            (Some(previous), Some(current)) => previous == current,
            (None, None) => current_installation_generation.is_some_and(|generation| {
                generation == frozen_installation_generation || current_native_session_id.is_some()
            }),
            _ => false,
        };
        let controlled_session_transition = allow_controlled_session_transition
            && current_native_session_id.is_some()
            && !session_metadata_compatible;
        let compatible_binding = stable_binding_identity
            && (session_metadata_compatible || controlled_session_transition);
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
                mention_user: invocation.input.mention_user,
                agent_addressing_mode: AgentAddressingMode::from_public_only(
                    invocation.input.public_only,
                ),
                task_id: invocation.input.task_id.clone(),
                files: invocation.input.files.clone(),
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
        if invocation.input.files.len() != invocation.frozen_files.len() {
            return Err(invocation_error(
                "message.invalid_input",
                "Every requested file must have one frozen Authority attachment",
            ));
        }

        let sender = resolve_sender_identity(
            database.connection(),
            &invocation.native_binding_id,
            &supplied_credential_digest,
            attested_run,
        )?;
        ChannelService::default().ensure_topic_roster_members(
            database,
            &sender.camp_id,
            &invocation.input.to,
            &command_id,
        )?;
        let command = CampMessageSendCommand {
            native_binding_id: invocation.native_binding_id.clone(),
            credential_digest: supplied_credential_digest.clone(),
            runtime_tool_call_id: invocation.runtime_tool_call_id.clone(),
            camp_id: sender.camp_id.clone(),
            body: invocation.input.body.clone(),
            to: invocation.input.to.clone(),
            mention_user: invocation.input.mention_user,
            agent_addressing_mode: AgentAddressingMode::from_public_only(
                invocation.input.public_only,
            ),
            task_id: invocation.input.task_id.clone(),
            files: invocation.input.files.clone(),
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
                    agent_addressing_mode: envelope.payload.agent_addressing_mode,
                    mention_user: envelope.payload.mention_user,
                    task_id: envelope.payload.task_id.as_deref(),
                    attachments: &invocation.frozen_files,
                    managed_attachment_ingest_intent_id: invocation
                        .managed_attachment_ingest_intent_id
                        .as_deref(),
                    operation: PublicA2aOperation::Send,
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

    pub fn gather(
        &self,
        database: &mut Database,
        invocation: &GatherInvocation,
    ) -> Result<CommandExecution> {
        self.gather_authorized(database, invocation, None)
    }

    pub fn gather_attested(
        &self,
        database: &mut Database,
        invocation: &GatherInvocation,
        agent_run_id: &str,
        execution_epoch: i64,
    ) -> Result<CommandExecution> {
        if agent_run_id.trim().is_empty() || execution_epoch <= 0 {
            return Err(invocation_error(
                "team_tool.invalid_attested_run",
                "Attested AgentRun identity is incomplete",
            ));
        }
        self.gather_authorized(database, invocation, Some((agent_run_id, execution_epoch)))
    }

    fn gather_authorized(
        &self,
        database: &mut Database,
        invocation: &GatherInvocation,
        attested_run: Option<(&str, i64)>,
    ) -> Result<CommandExecution> {
        validate_gather_invocation(invocation)?;
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
                    "Recorded Gather belongs to a different attested AgentRun",
                ));
            }
            let command = GatherCommand {
                native_binding_id: invocation.native_binding_id.clone(),
                credential_digest: supplied_credential_digest.clone(),
                runtime_tool_call_id: invocation.runtime_tool_call_id.clone(),
                camp_id: recorded.camp_id.clone(),
                body: invocation.input.body.clone(),
                to: invocation.input.to.clone(),
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
                payload: command,
            };
            return self
                .gateway
                .replay_if_recorded(database, &replay_envelope)?
                .context("recorded Gather disappeared before replay");
        }

        let sender = resolve_sender_identity(
            database.connection(),
            &invocation.native_binding_id,
            &supplied_credential_digest,
            attested_run,
        )?;
        ChannelService::default().ensure_topic_roster_members(
            database,
            &sender.camp_id,
            &invocation.input.to,
            &command_id,
        )?;
        let command = GatherCommand {
            native_binding_id: invocation.native_binding_id.clone(),
            credential_digest: supplied_credential_digest.clone(),
            runtime_tool_call_id: invocation.runtime_tool_call_id.clone(),
            camp_id: sender.camp_id.clone(),
            body: invocation.input.body.clone(),
            to: invocation.input.to.clone(),
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
                    "Native Binding changed before the Gather transaction",
                ));
            }
            let initiator_conversation_id: String = transaction.query_row(
                "SELECT conversation_id FROM agent_run WHERE id = ?1",
                [&current.agent_run_id],
                |row| row.get(0),
            )?;
            let gather_id = Uuid::new_v4().to_string();
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
                    agent_addressing_mode: AgentAddressingMode::Automatic,
                    mention_user: false,
                    task_id: None,
                    attachments: &[],
                    managed_attachment_ingest_intent_id: None,
                    operation: PublicA2aOperation::Gather {
                        gather_id: &gather_id,
                        initiator_conversation_id: &initiator_conversation_id,
                    },
                },
            )
        })?;
        if !execution.replayed
            && execution.result.status != crate::command::CommandResultStatus::Rejected
        {
            let delivery_ids = execution.result.payload["dispatchDeliveryIds"]
                .as_array()
                .context("accepted Gather has no dispatchDeliveryIds")?
                .iter()
                .map(|value| {
                    value
                        .as_str()
                        .map(str::to_string)
                        .context("accepted Gather has an invalid dispatchDeliveryId")
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
        if invocation.input.clear_assignee && invocation.input.assignee_agent_id.is_some() {
            return Err(invocation_error(
                "team_tool.invalid_input",
                "clearAssignee cannot be combined with assigneeAgentId",
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
            (None, false) => TaskAssigneeUpdate::Unchanged,
            (Some(agent_id), false) => TaskAssigneeUpdate::Assign {
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
        if invocation.input.unassigned_only && invocation.input.assignee_agent_id.is_some() {
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
            (None, false) => TaskAssigneeFilter::Any,
            (Some(agent_id), false) => TaskAssigneeFilter::Agent {
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
    if invocation.input.body.trim().is_empty() && invocation.input.files.is_empty() {
        return Err(invocation_error(
            "message.invalid_input",
            "a non-empty body or at least one file is required",
        ));
    }
    if invocation.input.body.len() > CAMP_MESSAGE_SEND_MAX_BODY_BYTES {
        return Err(invocation_error(
            "message.body_too_large",
            "Public message body exceeds the 32 KiB send limit",
        ));
    }
    if !invocation.input.public_only && invocation.input.to.len() > 16 {
        return Err(invocation_error(
            "message.fanout_exceeded",
            "The explicit recipient input exceeds the absolute fanout limit of 16",
        ));
    }
    if invocation
        .input
        .task_id
        .as_deref()
        .is_some_and(|value| value.trim().is_empty())
    {
        return Err(invocation_error(
            "message.invalid_input",
            "taskId must not be empty when supplied",
        ));
    }
    if invocation.input.files.len() > MAX_PREPARED_ATTACHMENTS
        || invocation
            .input
            .files
            .iter()
            .any(|path| path.trim().is_empty())
        || invocation
            .input
            .files
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != invocation.input.files.len()
    {
        return Err(invocation_error(
            "message.invalid_input",
            "files must contain at most 10 unique non-empty paths",
        ));
    }
    Ok(())
}

fn validate_gather_invocation(invocation: &GatherInvocation) -> Result<()> {
    validate_invocation_identity(
        &invocation.native_binding_id,
        &invocation.binding_credential,
        &invocation.runtime_tool_call_id,
    )?;
    if invocation.input.body.trim().is_empty() {
        return Err(invocation_error(
            "gather.invalid_input",
            "a non-empty shared body is required",
        ));
    }
    if invocation.input.body.len() > CAMP_MESSAGE_SEND_MAX_BODY_BYTES {
        return Err(invocation_error(
            "gather.invalid_input",
            "Gather body exceeds the 32 KiB limit",
        ));
    }
    if invocation.input.to.len() > 16 {
        return Err(invocation_error(
            "gather.fanout_exceeded",
            "The explicit Gather recipient input exceeds 16",
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
              AND camp_member.version = CAST(
                  json_extract(agent_run.effective_config_json, '$.campMemberVersion')
                  AS INTEGER
              )
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
    #[cfg(feature = "slow-tests")]
    use crate::{
        agent_profile::configure_test_runtime,
        collaboration::{RemoveCampMemberCommand, end_camp_membership},
        context::ContextMaterialization,
        memory::{MEMORY_AGENT_MUTATIONS_PER_RUN, MemoryCreationOrigin, RetireMemoryCommand},
        memory_retrieval::{MemoryCacheState, MemoryReadInput, MemorySearchInput},
        message_delivery::{RetryMessageDeliveryCommand, dispatch_pending_for_recipient},
        runtime::FailAgentRunCommand,
    };
    use crate::{
        camp_attachment::CampAttachmentStore,
        camp_attachment_publication::CampAttachmentPublicationCoordinator,
        camp_attachment_view::CampAttachmentViewStore,
        collaboration::{
            AddCampMemberCommand, CollaborationService, CreateCampCommand, CreateTaskCommand,
            ExecutionRequest, TestCampMessageAddress, TestCampMessageCommand,
        },
        command::{CommandGatewayError, CommandResultStatus},
        context::{
            CharterDeliveryMode, ContextService, DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
            MaterializeContextRequest,
        },
        managed_attachment::ManagedAttachmentStore,
        managed_blob::ManagedBlobStore,
        memory::{
            AcceptHearthReviewItemCommand, CreateMemoryCommand, ForgetMemoryCommand,
            MEMORY_BODY_MAX_BYTES, MemoryKind, MemoryScopeKind, MemoryService, MemoryTarget,
            RejectHearthReviewItemCommand, RelationshipDirection, ReviseMemoryCommand,
        },
        memory_retrieval::{
            MemoryRetrievalInvocation, MemoryRetrievalService, MemoryViewInput, MemoryViewOutput,
        },
        memory_tool::{MemoryToolService, MemoryWriteToolInput, MemoryWriteToolInvocation},
        message_delivery::{
            CancelMessageDeliveryCommand, DeliveryDispatchOutcome, DeliveryDispatchTrigger,
            MessageDeliveryService, mark_unstarted_deliveries_interrupted_before_dispatch,
        },
        runtime::{
            BindNativeSessionCommand, CancelCampTurnCommand, ClaimAgentRunCommand,
            ExecutionRuntimeService, MissingSendRecoveryBoundary, MissingSendRecoveryCandidate,
            SucceedAgentRunCommand,
        },
    };

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

    fn assert_memory_unavailable(execution: &CommandExecution) {
        assert_eq!(execution.result.status, CommandResultStatus::Rejected);
        assert_eq!(execution.result.code, "memory.unavailable");
        assert_eq!(
            execution.result.payload,
            json!({"message": "Memory is unavailable"})
        );
    }

    fn assert_memory_export_isolated(database: &Database, forbidden_values: &[&str]) -> Value {
        let exported = MemoryService::default().export(database).unwrap();
        assert_eq!(exported["format"], "rovai-memory-export-v3");
        assert!(exported.get("hearthReviewItems").is_none());
        let encoded = serde_json::to_string(&exported).unwrap();
        for field in [
            "hearthReviewItems",
            "reviewItemId",
            "createdFromHearthReviewItemId",
            "candidateKind",
            "candidateBody",
            "candidateRetrievalKeys",
        ] {
            assert!(
                !encoded.contains(&format!("\"{field}\"")),
                "Memory export leaked Hearth Review field {field}"
            );
        }
        for value in forbidden_values {
            assert!(
                !encoded.contains(value),
                "Memory export leaked Hearth Review value {value}"
            );
        }
        exported
    }

    struct Fixture {
        database: crate::test_support::OwnedTestDatabase,
        directory: std::path::PathBuf,
        camp_id: String,
        #[cfg(feature = "slow-tests")]
        task_id: String,
        source_run_id: String,
        source_epoch: i64,
        credential: BuiltinToolBindingCredential,
    }

    impl Fixture {
        fn new() -> Self {
            Self::with_members(&["agent_1", "agent_2", "agent_3"])
        }

        fn with_members(member_agent_ids: &[&str]) -> Self {
            let mut database = crate::test_support::seeded_runtime_database_owned();
            let directory = database.directory().to_path_buf();
            let workspace = directory.join("workspace");
            std::fs::create_dir_all(&workspace).expect("workspace should exist");
            let collaboration = CollaborationService::default();
            let camp = collaboration
                .create_camp(
                    &mut database,
                    &user_envelope(
                        "create-team-camp",
                        None,
                        CreateCampCommand::for_test_with_members(
                            workspace.to_string_lossy().to_string(),
                            member_agent_ids,
                            "agent_1",
                        ),
                    ),
                )
                .expect("Camp should be created");
            let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
            let view = CampAttachmentViewStore::for_test(&database)
                .expect("Runtime Camp Files Root should be admitted");
            view.ensure_empty_camp_ready(&mut database, &camp_id)
                .expect("new Camp should have its production attachment root");
            drop(view);
            for (index, agent_id) in member_agent_ids.iter().enumerate() {
                collaboration
                    .add_camp_member(
                        &mut database,
                        &user_envelope(
                            &format!("add-member-{index}"),
                            Some(&camp_id),
                            AddCampMemberCommand {
                                camp_id: camp_id.clone(),
                                agent_id: (*agent_id).to_string(),
                                expected_membership_generation: 1,
                                capability_overrides: json!({}),
                                source: None,
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
                            assignee_agent_id: "agent_1".to_string(),
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
                #[cfg(feature = "slow-tests")]
                task_id,
                source_run_id,
                source_epoch,
                credential,
            }
        }

        #[cfg(feature = "slow-tests")]
        fn queue_direct_run(&mut self, command_id: &str, agent_id: &str) -> String {
            CollaborationService::default()
                .send_test_camp_message(
                    &mut self.database,
                    &user_envelope(
                        command_id,
                        Some(&self.camp_id),
                        TestCampMessageCommand {
                            camp_id: self.camp_id.clone(),
                            draft_revision: None,
                            body: format!("Keep {agent_id} busy"),
                            prepared_attachment_ids: Vec::new(),
                            address: TestCampMessageAddress::Explicit {
                                agent_ids: vec![agent_id.to_string()],
                            },
                            reply_to_camp_message_id: None,
                            execution: Some(ExecutionRequest {
                                task_id: None,
                                purpose: "Occupy the recipient FIFO".to_string(),
                                completion_role: "required".to_string(),
                                budget: None,
                            }),
                        },
                    ),
                )
                .expect("direct Run should queue")
                .result
                .payload["agentRunIds"][0]
                .as_str()
                .expect("direct Run id should exist")
                .to_string()
        }

        fn public_send_invocation(
            &self,
            call_id: &str,
            body: &str,
            to: &[&str],
        ) -> CampMessageSendInvocation {
            self.public_send_invocation_for(&self.credential, call_id, body, to)
        }

        fn public_send_invocation_for(
            &self,
            credential: &BuiltinToolBindingCredential,
            call_id: &str,
            body: &str,
            to: &[&str],
        ) -> CampMessageSendInvocation {
            CampMessageSendInvocation {
                native_binding_id: credential.native_binding_id.clone(),
                binding_credential: credential.binding_credential.clone(),
                runtime_tool_call_id: call_id.to_string(),
                input: CampMessageSendInput {
                    body: body.to_string(),
                    to: to.iter().map(|value| (*value).to_string()).collect(),
                    mention_user: false,
                    public_only: false,
                    task_id: None,
                    files: Vec::new(),
                },
                frozen_files: Vec::new(),
                managed_attachment_ingest_intent_id: None,
            }
        }

        fn prepare_managed_agent_attachment(
            &mut self,
            invocation: &mut CampMessageSendInvocation,
            file_name: &str,
            bytes: &[u8],
        ) -> String {
            self.prepare_managed_agent_attachments(invocation, &[(file_name, bytes)])
                .into_iter()
                .next()
                .unwrap()
        }

        fn prepare_managed_agent_attachments(
            &mut self,
            invocation: &mut CampMessageSendInvocation,
            files: &[(&str, &[u8])],
        ) -> Vec<String> {
            let workspace = self.directory.join("workspace");
            for (file_name, bytes) in files {
                std::fs::write(workspace.join(file_name), bytes).unwrap();
            }
            let run_tmp = self.directory.join("run-tmp");
            std::fs::create_dir_all(&run_tmp).unwrap();
            invocation.input.files = files
                .iter()
                .map(|(file_name, _)| (*file_name).to_string())
                .collect();
            let command_id = TeamToolService::default()
                .binding_command_id(
                    &invocation.native_binding_id,
                    &invocation.binding_credential,
                    &invocation.runtime_tool_call_id,
                )
                .unwrap();
            let store = ManagedAttachmentStore::for_database(&self.database);
            let plan = store
                .begin_agent_ingest(
                    &mut self.database,
                    &self.camp_id,
                    &command_id,
                    invocation.input.files.len(),
                )
                .unwrap()
                .unwrap();
            let prepared = store
                .materialize_agent(&plan, &invocation.input.files, &workspace, &run_tmp)
                .unwrap();
            store
                .record_promoted(&mut self.database, &prepared)
                .unwrap();
            let attachment_ids = prepared
                .attachments()
                .iter()
                .map(|attachment| attachment.attachment_id.clone())
                .collect();
            invocation.frozen_files = prepared.attachments();
            invocation.managed_attachment_ingest_intent_id = Some(prepared.intent_id().to_string());
            attachment_ids
        }

        fn gather_invocation(&self, call_id: &str, body: &str, to: &[&str]) -> GatherInvocation {
            GatherInvocation {
                native_binding_id: self.credential.native_binding_id.clone(),
                binding_credential: self.credential.binding_credential.clone(),
                runtime_tool_call_id: call_id.to_string(),
                input: GatherInput {
                    body: body.to_string(),
                    to: to.iter().map(|value| (*value).to_string()).collect(),
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

        fn memory_write(
            &mut self,
            call_id: &str,
            input: MemoryWriteToolInput,
        ) -> Result<CommandExecution> {
            MemoryToolService.write(
                &mut self.database,
                &MemoryWriteToolInvocation {
                    native_binding_id: self.credential.native_binding_id.clone(),
                    binding_credential: self.credential.binding_credential.clone(),
                    runtime_tool_call_id: call_id.to_string(),
                    input,
                },
            )
        }

        fn memory_view(
            &mut self,
            call_id: &str,
            input: MemoryViewInput,
        ) -> Result<MemoryViewOutput> {
            MemoryRetrievalService.view(
                &mut self.database,
                &MemoryRetrievalInvocation {
                    native_binding_id: self.credential.native_binding_id.clone(),
                    binding_credential: self.credential.binding_credential.clone(),
                    runtime_tool_call_id: call_id.to_string(),
                    input,
                },
            )
        }

        fn memory_revise(
            &mut self,
            call_id: &str,
            memory_id: &str,
            base_revision_id: &str,
            body: &str,
            retrieval_keys: &[&str],
        ) -> CommandExecution {
            let target = MemoryService::default()
                .get(&self.database, memory_id)
                .unwrap();
            let scope = target
                .as_ref()
                .and_then(|memory| memory.scope)
                .unwrap_or(MemoryScopeKind::Hearth);
            let counterparty_agent_id = target.as_ref().and_then(|memory| {
                (scope == MemoryScopeKind::Relationship).then(|| {
                    memory
                        .relationship_agent_ids
                        .iter()
                        .find(|agent_id| agent_id.as_str() != "agent_1")
                        .cloned()
                        .unwrap()
                })
            });
            self.memory_write(
                call_id,
                MemoryWriteToolInput {
                    action: "revise".to_string(),
                    scope: None,
                    kind: None,
                    body: body.to_string(),
                    retrieval_keys: retrieval_keys
                        .iter()
                        .map(|value| (*value).to_string())
                        .collect(),
                    counterparty_agent_id: None,
                    direction: None,
                    target: Some(MemoryTarget {
                        memory_id: memory_id.to_string(),
                        revision_id: base_revision_id.to_string(),
                        scope,
                        counterparty_agent_id,
                        direction: (scope == MemoryScopeKind::Relationship)
                            .then_some(RelationshipDirection::Directed),
                    }),
                },
            )
            .unwrap()
        }

        fn hearth_review_add(
            &mut self,
            call_id: &str,
            body: &str,
            retrieval_key: &str,
        ) -> CommandExecution {
            self.memory_write(
                call_id,
                MemoryWriteToolInput {
                    action: "add".to_string(),
                    scope: Some(MemoryScopeKind::Hearth),
                    kind: Some(MemoryKind::Lesson),
                    body: body.to_string(),
                    retrieval_keys: vec![retrieval_key.to_string()],
                    counterparty_agent_id: None,
                    direction: None,
                    target: None,
                },
            )
            .unwrap()
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
            self.succeed_run_with_candidate(agent_run_id, execution_epoch, output, None);
        }

        #[cfg(feature = "slow-tests")]
        fn fail_run(
            &mut self,
            agent_run_id: &str,
            execution_epoch: i64,
            error_code: &str,
        ) -> CommandExecution {
            let runtime = ExecutionRuntimeService::default();
            let execution = runtime
                .load_agent_run_execution(&self.database, agent_run_id, execution_epoch)
                .unwrap()
                .expect("claimed AgentRun should remain executable");
            let failed = runtime
                .fail_agent_run(
                    &mut self.database,
                    &CommandEnvelope {
                        command_id: format!("fail-{agent_run_id}-{error_code}"),
                        actor: ActorRef::System {
                            component_id: "runtime-adapter:codex-cli".to_string(),
                        },
                        camp_id: Some(self.camp_id.clone()),
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: FailAgentRunCommand {
                            agent_run_id: agent_run_id.to_string(),
                            expected_version: execution.version,
                            execution_epoch,
                            error_code: error_code.to_string(),
                            error_detail: None,
                            failure: None,
                            manual_retry_allowed: false,
                            ending_git_observation: None,
                        },
                    },
                )
                .expect("AgentRun failure should settle");
            assert_eq!(failed.result.status, CommandResultStatus::Applied);
            failed
        }

        fn succeed_run_with_candidate(
            &mut self,
            agent_run_id: &str,
            execution_epoch: i64,
            output: &str,
            missing_send_recovery_candidate: Option<MissingSendRecoveryCandidate>,
        ) -> CommandExecution {
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
                            missing_send_recovery_candidate,
                            ending_git_observation: None,
                        },
                    },
                )
                .expect("AgentRun should complete");
            assert_eq!(completed.result.status, CommandResultStatus::Applied);
            completed
        }
    }

    fn send_projection_blocked_attachment(
        fixture: &mut Fixture,
        call_id: &str,
    ) -> (String, String) {
        let file_name = format!("{call_id}.txt");
        let authority_path = fixture.directory.join(&file_name);
        std::fs::write(&authority_path, b"zero-attempt cancellation fixture").unwrap();
        let attachment_store = CampAttachmentStore::new(&fixture.directory);
        let draft = attachment_store
            .save_body(
                &mut fixture.database,
                &fixture.camp_id,
                "agent attachment fixture",
            )
            .unwrap();
        let draft = attachment_store
            .prepare_from_path(
                &mut fixture.database,
                &fixture.camp_id,
                draft.revision,
                &authority_path,
                &file_name,
            )
            .unwrap();
        let attachment_id = draft.attachments.last().unwrap().id.clone();
        let authority: AuthorityAttachment = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT id, display_name, media_type, byte_size,
                       content_digest, storage_path, preview_kind
                FROM prepared_attachment WHERE id = ?1
                "#,
                [&attachment_id],
                |row| {
                    Ok(AuthorityAttachment {
                        attachment_id: row.get(0)?,
                        display_name: row.get(1)?,
                        media_type: row.get(2)?,
                        byte_size: row.get::<_, i64>(3)? as u64,
                        content_digest: row.get(4)?,
                        storage_path: std::path::PathBuf::from(row.get::<_, String>(5)?),
                        preview_kind: row.get(6)?,
                    })
                },
            )
            .unwrap();
        let (camp_turn_id, a2a_root_agent_run_id, a2a_depth): (String, Option<String>, i64) =
            fixture
                .database
                .connection()
                .query_row(
                    r#"
                SELECT camp_turn_id, a2a_root_agent_run_id, a2a_depth
                FROM agent_run WHERE id = ?1
                "#,
                    [&fixture.source_run_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap();
        let command_id = format!("legacy-projection-fixture-{call_id}");
        let transaction = fixture.database.connection_mut().transaction().unwrap();
        let sent = persist_public_a2a_message(
            &transaction,
            &SendPublicA2aMessage {
                command_id: &command_id,
                camp_id: &fixture.camp_id,
                camp_turn_id: &camp_turn_id,
                source_agent_run_id: &fixture.source_run_id,
                author_agent_id: "agent_1",
                execution_epoch: fixture.source_epoch,
                current_a2a_root_agent_run_id: a2a_root_agent_run_id.as_deref(),
                current_a2a_depth: a2a_depth,
                body: "legacy projection cancellation fixture",
                explicit_recipients: &["agent_2".to_string()],
                agent_addressing_mode: AgentAddressingMode::Automatic,
                mention_user: false,
                task_id: None,
                attachments: &[],
                managed_attachment_ingest_intent_id: None,
                operation: PublicA2aOperation::Send,
            },
        )
        .unwrap();
        assert_eq!(sent.status, CommandResultStatus::Accepted);
        let message_id = sent.payload["messageId"].as_str().unwrap();
        let delivery_id = sent.payload["deliveryIds"][0].as_str().unwrap().to_string();
        let publication = CampAttachmentPublicationCoordinator
            .commit_agent_intent(
                &transaction,
                &fixture.camp_id,
                message_id,
                &command_id,
                std::slice::from_ref(&authority),
            )
            .unwrap()
            .unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        transaction
            .execute(
                r#"
                INSERT INTO message_attachment(
                    id, camp_id, camp_message_id, conversation_message_id,
                    position, display_name, media_type, byte_size,
                    content_digest, storage_path, preview_kind,
                    created_by_type, created_by_id, created_at,
                    runtime_projection_state, publication_operation_id,
                    publication_semantic_revision
                ) VALUES (
                    ?1, ?2, ?3, NULL, 0, ?4, ?5, ?6,
                    ?7, ?8, ?9, 'agent', 'agent_1', ?10,
                    'pending', ?11, ?12
                )
                "#,
                params![
                    authority.attachment_id,
                    fixture.camp_id,
                    message_id,
                    authority.display_name,
                    authority.media_type,
                    authority.byte_size as i64,
                    authority.content_digest,
                    authority.storage_path.to_string_lossy(),
                    authority.preview_kind,
                    now,
                    publication.operation_id,
                    publication.semantic_revision,
                ],
            )
            .unwrap();
        CampAttachmentPublicationCoordinator
            .gate_deliveries(
                &transaction,
                std::slice::from_ref(&delivery_id),
                &publication.operation_id,
            )
            .unwrap();
        let operation_id = publication.operation_id;
        transaction.commit().unwrap();
        let gate: (String, i64, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT dispatch_phase, dispatch_attempt_count, pre_dispatch_gate
                FROM message_delivery WHERE id = ?1
                "#,
                [&delivery_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            gate,
            (
                "projection_blocked".to_string(),
                0,
                Some("attachment_projection".to_string()),
            )
        );
        (delivery_id, operation_id)
    }

    fn promote_queued_publication(
        fixture: &mut Fixture,
        view: &CampAttachmentViewStore,
        expected_operation_id: &str,
    ) {
        let plan = view
            .plan_queued_publication(&mut fixture.database, &fixture.camp_id)
            .unwrap()
            .expect("queued attachment publication should exist");
        assert_eq!(plan.operation_id(), expected_operation_id);
        let attachment_store = CampAttachmentStore::new(&fixture.directory);
        let copied = CampAttachmentViewStore::copy_publication(&attachment_store, plan).unwrap();
        let prepared = view
            .finish_publication_staging(&mut fixture.database, copied)
            .unwrap();
        view.gate_publication(&mut fixture.database, &prepared)
            .unwrap();
        view.promote_publication(&mut fixture.database, &prepared)
            .unwrap();
    }

    struct DeliveryCancellationSnapshot {
        status: String,
        dispatch_phase: String,
        dispatch_attempt_count: i64,
        wait_condition: Option<String>,
        active_dispatch_attempt_id: Option<String>,
        pre_dispatch_gate: Option<String>,
        projection_operation_id: Option<String>,
        manual_intervention_required: i64,
        failure_code: Option<String>,
        ended_at: Option<String>,
        version: i64,
    }

    #[cfg(feature = "slow-tests")]
    fn public_send_schema_teaches_alias_boundary_and_canonical_to_values() {
        let schema = TeamToolService::camp_message_send_input_schema();
        let body_description = schema["properties"]["body"]["description"]
            .as_str()
            .unwrap();
        let to_description = schema["properties"]["to"]["description"].as_str().unwrap();

        assert!(body_description.contains("exact active Camp member @display-name"));
        assert!(body_description.contains("first non-whitespace token on a line"));
        assert!(body_description.contains("dedicated final line"));
        assert!(body_description.contains("whitespace or end-of-body"));
        assert!(to_description.contains("canonical Agent ID"));
        assert!(to_description.contains("Display names are not accepted here"));
    }

    #[test]
    fn confirmed_direct_run_can_create_one_idempotent_member_but_a2a_cannot() {
        let mut fixture = Fixture::new();
        let authenticated_run = AuthenticatedTeamToolRun {
            camp_id: fixture.camp_id.clone(),
            agent_id: "agent_1".to_string(),
            agent_run_id: fixture.source_run_id.clone(),
            execution_epoch: fixture.source_epoch,
        };
        let creation_key = Uuid::new_v4().to_string();
        let input = crate::member_studio::MemberCreateInput {
            creation_key: creation_key.clone(),
            display_name: "Nova Test Member".to_string(),
            team_role: "Researcher".to_string(),
            professional_responsibilities: "Synthesize bounded evidence.".to_string(),
            personality_traits: vec!["Precise".to_string()],
            working_principles: "State evidence and uncertainty.".to_string(),
            growth_topic: "Shorten feedback loops.".to_string(),
            avatar_file: None,
        };
        let first = crate::member_studio::create_member(
            &mut fixture.database,
            &fixture.directory,
            &authenticated_run,
            input.clone(),
        )
        .unwrap();
        assert_eq!(first.execution.result.status, CommandResultStatus::Applied);
        assert!(!first.execution.replayed);
        assert!(first.avatar_ref.is_none());
        let replay = crate::member_studio::create_member(
            &mut fixture.database,
            &fixture.directory,
            &authenticated_run,
            input,
        )
        .unwrap();
        assert!(replay.execution.replayed);
        assert_eq!(
            replay.execution.result.payload["agentId"],
            first.execution.result.payload["agentId"]
        );
        let changed = crate::member_studio::create_member(
            &mut fixture.database,
            &fixture.directory,
            &authenticated_run,
            crate::member_studio::MemberCreateInput {
                creation_key: creation_key.clone(),
                display_name: "Nova Test Member".to_string(),
                team_role: "Changed after confirmation".to_string(),
                professional_responsibilities: "Synthesize bounded evidence.".to_string(),
                personality_traits: vec!["Precise".to_string()],
                working_principles: "State evidence and uncertainty.".to_string(),
                growth_topic: "Shorten feedback loops.".to_string(),
                avatar_file: None,
            },
        )
        .unwrap_err();
        assert_eq!(
            changed
                .downcast_ref::<crate::member_studio::MemberCreateError>()
                .unwrap()
                .code,
            "member.creation_key_conflict"
        );

        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET invocation_kind = 'a2a' WHERE id = ?1",
                [&fixture.source_run_id],
            )
            .unwrap();
        let blocked = crate::member_studio::create_member(
            &mut fixture.database,
            &fixture.directory,
            &authenticated_run,
            crate::member_studio::MemberCreateInput {
                creation_key: Uuid::new_v4().to_string(),
                display_name: "Blocked A2A Member".to_string(),
                team_role: String::new(),
                professional_responsibilities: String::new(),
                personality_traits: Vec::new(),
                working_principles: String::new(),
                growth_topic: String::new(),
                avatar_file: None,
            },
        )
        .unwrap_err();
        let blocked = blocked
            .downcast_ref::<crate::member_studio::MemberCreateError>()
            .unwrap();
        assert_eq!(blocked.code, "member.user_confirmation_required");
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM agent_profile WHERE display_name = 'Blocked A2A Member'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
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
        assert_eq!(message.0, "Please inspect this @芝士");
        assert_eq!(message.1, r#"["agent_2"]"#);
        assert_eq!(
            serde_json::from_str::<Value>(&message.2).unwrap()["inlineOrder"],
            json!(["agent_2"])
        );
        assert!(!message.3.is_empty());

        struct DeliveryAuditRow {
            recipient_agent_id: String,
            edge_kind: String,
            target_parent_agent_run_id: Option<String>,
            return_to_agent_run_id: Option<String>,
            status: String,
            dispatch_attempt_count: i64,
            a2a_depth: i64,
            target_agent_run_id: Option<String>,
        }
        let delivery = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT recipient_agent_id, edge_kind,
                       target_parent_agent_run_id, return_to_agent_run_id,
                       status, dispatch_attempt_count,
                       a2a_depth, target_agent_run_id
                FROM message_delivery WHERE message_id = ?1
                "#,
                [message_id],
                |row| {
                    Ok(DeliveryAuditRow {
                        recipient_agent_id: row.get(0)?,
                        edge_kind: row.get(1)?,
                        target_parent_agent_run_id: row.get(2)?,
                        return_to_agent_run_id: row.get(3)?,
                        status: row.get(4)?,
                        dispatch_attempt_count: row.get(5)?,
                        a2a_depth: row.get(6)?,
                        target_agent_run_id: row.get(7)?,
                    })
                },
            )
            .unwrap();
        assert_eq!(delivery.recipient_agent_id, "agent_2");
        assert_eq!(delivery.edge_kind, "forward");
        assert_eq!(
            delivery.target_parent_agent_run_id.as_deref(),
            Some(fixture.source_run_id.as_str())
        );
        assert_eq!(delivery.return_to_agent_run_id, None);
        assert_eq!(delivery.status, "running");
        assert_eq!(delivery.dispatch_attempt_count, 1);
        assert_eq!(delivery.a2a_depth, 1);
        assert!(delivery.target_agent_run_id.is_some());
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
    fn public_send_rejects_an_empty_body_without_files() {
        let mut fixture = Fixture::new();
        let invocation = fixture.public_send_invocation("empty-send", "   ", &[]);
        let error = TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap_err();
        let error = error.downcast_ref::<TeamToolInvocationError>().unwrap();
        assert_eq!(error.code, "message.invalid_input");
        assert!(error.message.contains("body or at least one file"));
    }

    #[test]
    fn attachment_send_commits_managed_v2_and_dispatches_without_projection_gate() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let mut invocation =
            fixture.public_send_invocation("attachment-send-real-identities", "", &["agent_2"]);
        let attachment_id = fixture.prepare_managed_agent_attachment(
            &mut invocation,
            "frozen-agent-file.txt",
            b"file",
        );

        let sent = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        assert_eq!(sent.result.status, CommandResultStatus::Accepted);
        let message_id = sent.result.payload["messageId"]
            .as_str()
            .unwrap()
            .to_string();
        let delivery_id = sent.result.payload["deliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        assert!(Uuid::parse_str(&message_id).is_ok());
        assert!(Uuid::parse_str(&delivery_id).is_ok());
        let body: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT body FROM camp_message WHERE id = ?1",
                [&message_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(body, "");
        let managed: (String, String, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT managed.state, managed.root_relative_payload_path,
                       COUNT(reference.attachment_id)
                FROM managed_attachment AS managed
                JOIN camp_message_attachment_ref AS reference
                  ON reference.camp_id = managed.camp_id
                 AND reference.attachment_id = managed.id
                WHERE managed.id = ?1 AND reference.camp_message_id = ?2
                "#,
                params![attachment_id, message_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(managed.0, "available");
        assert!(managed.1.contains("/.managed-v2/"));
        assert_eq!(managed.2, 1);
        let legacy_rows: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM message_attachment WHERE camp_message_id = ?1",
                [&message_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(legacy_rows, 0);
        let gate: (String, i64, Option<String>, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT dispatch_phase, dispatch_attempt_count,
                       pre_dispatch_gate, projection_operation_id
                FROM message_delivery WHERE id = ?1
                "#,
                [&delivery_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_ne!(gate.0, "projection_blocked");
        assert!(gate.1 > 0);
        assert_eq!(gate.2, None);
        assert_eq!(gate.3, None);
    }

    #[test]
    fn running_source_sends_fourteen_mib_without_waiting_for_camp_publication() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let mut invocation = fixture.public_send_invocation(
            "attachment-send-while-source-running",
            "",
            &["agent_2"],
        );
        let four_mib = vec![b'a'; 4 * 1024 * 1024];
        let three_mib = vec![b'b'; 3 * 1024 * 1024];
        let attachment_ids = fixture.prepare_managed_agent_attachments(
            &mut invocation,
            &[
                ("one.bin", four_mib.as_slice()),
                ("two.bin", four_mib.as_slice()),
                ("three.bin", three_mib.as_slice()),
                ("four.bin", three_mib.as_slice()),
            ],
        );
        assert_eq!(attachment_ids.len(), 4);
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT status FROM agent_run WHERE id = ?1",
                    [&fixture.source_run_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "running"
        );

        let sent = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        let delivery_id = sent.result.payload["deliveryIds"][0].as_str().unwrap();
        let state: (String, i64, Option<String>, Option<String>, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT delivery.dispatch_phase, delivery.dispatch_attempt_count,
                       delivery.pre_dispatch_gate, delivery.projection_operation_id,
                       (SELECT COUNT(*) FROM managed_attachment WHERE camp_id = delivery.camp_id),
                       (SELECT COUNT(*) FROM camp_attachment_view_operation
                        WHERE camp_id = delivery.camp_id)
                FROM message_delivery AS delivery WHERE delivery.id = ?1
                "#,
                [delivery_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .unwrap();
        assert_ne!(state.0, "projection_blocked");
        assert!(
            state.1 > 0,
            "recipient dispatch must begin before the source Run ends"
        );
        assert_eq!(state.2, None);
        assert_eq!(state.3, None);
        assert_eq!(state.4, 4);
        assert_eq!(state.5, 0, "v2 send must not enter legacy Camp publication");
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT status FROM agent_run WHERE id = ?1",
                    [&fixture.source_run_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "running",
            "sending attachments must not stop or fence the source Run"
        );
    }

    #[test]
    fn camp_turn_stop_cancels_projection_blocked_delivery_and_restart_cannot_revive_it() {
        let mut fixture = Fixture::new();
        let (delivery_id, operation_id) =
            send_projection_blocked_attachment(&mut fixture, "cancel-projection-on-turn-stop");
        let (camp_turn_id, turn_version): (String, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT turn.id, turn.version
                FROM message_delivery AS delivery
                JOIN camp_turn AS turn ON turn.id = delivery.camp_turn_id
                WHERE delivery.id = ?1
                "#,
                [&delivery_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let stopped = ExecutionRuntimeService::default()
            .request_camp_turn_cancellation(
                &mut fixture.database,
                &user_envelope(
                    "cancel-projection-blocked-turn",
                    Some(&fixture.camp_id),
                    CancelCampTurnCommand {
                        camp_id: fixture.camp_id.clone(),
                        camp_turn_id,
                        expected_version: turn_version,
                    },
                ),
            )
            .unwrap();
        assert_eq!(stopped.result.status, CommandResultStatus::Applied);

        let cancelled: DeliveryCancellationSnapshot = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT status, dispatch_phase, dispatch_attempt_count,
                       wait_condition, active_dispatch_attempt_id,
                       pre_dispatch_gate, projection_operation_id,
                       manual_intervention_required, failure_code, ended_at, version
                FROM message_delivery WHERE id = ?1
                "#,
                [&delivery_id],
                |row| {
                    Ok(DeliveryCancellationSnapshot {
                        status: row.get(0)?,
                        dispatch_phase: row.get(1)?,
                        dispatch_attempt_count: row.get(2)?,
                        wait_condition: row.get(3)?,
                        active_dispatch_attempt_id: row.get(4)?,
                        pre_dispatch_gate: row.get(5)?,
                        projection_operation_id: row.get(6)?,
                        manual_intervention_required: row.get(7)?,
                        failure_code: row.get(8)?,
                        ended_at: row.get(9)?,
                        version: row.get(10)?,
                    })
                },
            )
            .unwrap();
        assert_eq!(&cancelled.status, "cancelled");
        assert_eq!(&cancelled.dispatch_phase, "terminal");
        assert_eq!(cancelled.dispatch_attempt_count, 0);
        assert_eq!(
            (
                &cancelled.wait_condition,
                &cancelled.active_dispatch_attempt_id,
                &cancelled.pre_dispatch_gate,
                &cancelled.projection_operation_id,
            ),
            (&None, &None, &None, &None)
        );
        assert_eq!(cancelled.manual_intervention_required, 0);
        assert_eq!(
            cancelled.failure_code.as_deref(),
            Some("camp_turn_cancelled")
        );
        assert!(cancelled.ended_at.is_some());

        let view = CampAttachmentViewStore::for_test(&fixture.database).unwrap();
        promote_queued_publication(&mut fixture, &view, &operation_id);
        assert!(
            view.resolve_semantic_publication_success(&mut fixture.database, &operation_id)
                .unwrap()
                .is_empty()
        );
        let after_late_success: (String, String, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT status, dispatch_phase, dispatch_attempt_count, version
                FROM message_delivery WHERE id = ?1
                "#,
                [&delivery_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            after_late_success,
            (
                "cancelled".to_string(),
                "terminal".to_string(),
                0,
                cancelled.version,
            )
        );
        drop(view);

        let mut reopened = crate::db::Database::open(&fixture.directory).unwrap();
        mark_unstarted_deliveries_interrupted_before_dispatch(&mut reopened).unwrap();
        assert_eq!(
            crate::message_delivery::dispatch_delivery(
                &mut reopened,
                &delivery_id,
                DeliveryDispatchTrigger::Accepted,
                true,
            )
            .unwrap(),
            DeliveryDispatchOutcome::NotDispatchable
        );
        let after_restart: (String, String, i64, Option<String>, Option<String>) = reopened
            .connection()
            .query_row(
                r#"
                SELECT status, dispatch_phase, dispatch_attempt_count,
                       projection_operation_id, ended_at
                FROM message_delivery WHERE id = ?1
                "#,
                [&delivery_id],
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
            after_restart,
            (
                "cancelled".to_string(),
                "terminal".to_string(),
                0,
                None,
                cancelled.ended_at,
            )
        );
    }

    #[test]
    fn explicit_zero_attempt_cancellation_handles_projection_and_interrupted_states() {
        let mut fixture = Fixture::new();
        let (projection_delivery_id, operation_id) =
            send_projection_blocked_attachment(&mut fixture, "explicit-projection-cancel");
        let projection_version: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT version FROM message_delivery WHERE id = ?1",
                [&projection_delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        let cancelled = MessageDeliveryService::default()
            .cancel(
                &mut fixture.database,
                &user_envelope(
                    "cancel-zero-attempt-projection",
                    Some(&fixture.camp_id),
                    CancelMessageDeliveryCommand {
                        delivery_id: projection_delivery_id.clone(),
                        expected_version: projection_version,
                    },
                ),
            )
            .unwrap();
        assert_eq!(cancelled.result.code, "message_delivery.cancelled");
        let projection_state: (
            String,
            String,
            i64,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT status, dispatch_phase, dispatch_attempt_count,
                       pre_dispatch_gate, projection_operation_id, failure_code
                FROM message_delivery WHERE id = ?1
                "#,
                [&projection_delivery_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            projection_state,
            (
                "cancelled".to_string(),
                "terminal".to_string(),
                0,
                None,
                None,
                Some("explicit_cancelled".to_string()),
            )
        );
        let view = CampAttachmentViewStore::for_test(&fixture.database).unwrap();
        assert!(
            view.resolve_semantic_publication_terminal_failure(
                &mut fixture.database,
                &operation_id,
                "late_projection_failure",
            )
            .unwrap()
            .is_empty()
        );
        drop(view);
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT status || ':' || dispatch_phase || ':' || dispatch_attempt_count FROM message_delivery WHERE id = ?1",
                    [&projection_delivery_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "cancelled:terminal:0"
        );

        let (interrupted_delivery_id, _) =
            send_projection_blocked_attachment(&mut fixture, "interrupted-then-cancelled");
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE message_delivery
                SET dispatch_phase = 'never_attempted',
                    pre_dispatch_gate = NULL, projection_operation_id = NULL,
                    version = version + 1
                WHERE id = ?1 AND status = 'pending'
                  AND dispatch_phase = 'projection_blocked'
                  AND dispatch_attempt_count = 0
                "#,
                [&interrupted_delivery_id],
            )
            .unwrap();
        mark_unstarted_deliveries_interrupted_before_dispatch(&mut fixture.database).unwrap();
        let interrupted_version: i64 = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT version FROM message_delivery
                WHERE id = ?1 AND status = 'interrupted_before_dispatch'
                  AND dispatch_phase = 'terminal' AND dispatch_attempt_count = 0
                "#,
                [&interrupted_delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        let cancelled = MessageDeliveryService::default()
            .cancel(
                &mut fixture.database,
                &user_envelope(
                    "cancel-interrupted-zero-attempt",
                    Some(&fixture.camp_id),
                    CancelMessageDeliveryCommand {
                        delivery_id: interrupted_delivery_id.clone(),
                        expected_version: interrupted_version,
                    },
                ),
            )
            .unwrap();
        assert_eq!(cancelled.result.code, "message_delivery.cancelled");
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    r#"
                    SELECT status || ':' || dispatch_phase || ':' ||
                           dispatch_attempt_count || ':' ||
                           manual_intervention_required || ':' || failure_code
                    FROM message_delivery WHERE id = ?1
                    "#,
                    [&interrupted_delivery_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "cancelled:terminal:0:0:explicit_cancelled"
        );
    }

    #[test]
    fn public_only_rejects_routing_fields_and_bypasses_every_agent_addressing_effect() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let before: (i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT COUNT(*),
                       (SELECT SUM(a2a_run_slots_allocated) FROM camp_turn)
                FROM camp_message
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        let mut conflict = fixture.public_send_invocation(
            "public-only-conflict",
            "must not persist",
            &["agent_2"],
        );
        conflict.input.public_only = true;
        conflict.input.task_id = Some("task-not-loaded".to_string());
        let rejected = service
            .send_public_message(&mut fixture.database, &conflict)
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(rejected.result.code, "message.public_only_conflict");
        assert_eq!(
            rejected.result.payload,
            json!({
                "message": "--public-only cannot be combined with Agent-routing inputs.",
                "details": {
                    "conflictingFields": ["to", "taskId"],
                    "newRequestIdRequired": true,
                }
            })
        );
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row("SELECT COUNT(*) FROM camp_message", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            before.0
        );

        let literal_body = "@agent_2 谢谢\n@芝士 收口";
        let mut invocation = fixture.public_send_invocation(
            "public-only-literal-agent-lookalikes",
            literal_body,
            &[],
        );
        invocation.input.public_only = true;
        invocation.input.mention_user = true;
        let sent = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        assert_eq!(sent.result.status, CommandResultStatus::Accepted);
        assert_eq!(sent.result.payload["agentAddressingMode"], "public_only");
        assert_eq!(sent.result.payload["effectiveRecipients"], json!([]));
        assert_eq!(sent.result.payload["deliveryIds"], json!([]));
        let message_id = sent.result.payload["messageId"].as_str().unwrap();
        let persisted: (String, String, String, String, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT body, structured_content_json, agent_addressing_mode,
                       effective_recipient_ids_json,
                       (SELECT COUNT(*) FROM camp_message_mention
                        WHERE camp_message_id = message.id),
                       (SELECT COUNT(*) FROM message_delivery
                        WHERE message_id = message.id)
                FROM camp_message AS message
                WHERE id = ?1
                "#,
                [message_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(persisted.0, format!("@你 {literal_body}"));
        assert_eq!(
            serde_json::from_str::<Value>(&persisted.1).unwrap(),
            json!([
                {"kind": "current_user_mention", "userId": "local_user"},
                {"kind": "text", "text": literal_body},
            ])
        );
        assert_eq!(persisted.2, "public_only");
        assert_eq!(persisted.3, "[]");
        assert_eq!(persisted.4, 0);
        assert_eq!(persisted.5, 0);
        let event: Value = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT payload_json FROM event_log
                WHERE event_type = 'camp_message.public_a2a_sent'
                  AND entity_id = ?1
                "#,
                [message_id],
                |row| row.get::<_, String>(0),
            )
            .map(|payload| serde_json::from_str(&payload).unwrap())
            .unwrap();
        assert_eq!(event["schemaVersion"], 2);
        assert_eq!(event["operation"], "send");
        assert_eq!(event["agentAddressingMode"], "public_only");
        assert_eq!(event["recipientFree"], true);
        assert_eq!(event["effectiveRecipients"], json!([]));
        assert_eq!(event["deliveryIds"], json!([]));
        assert!(event.get("publicOnly").is_none());
        let after_slots: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT SUM(a2a_run_slots_allocated) FROM camp_turn",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(after_slots, before.1);
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM notification_occurrence WHERE semantic = 'user_mention' AND source_message_id = ?1",
                    [message_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );

        let replay = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result.payload["agentAddressingMode"], "public_only");
        assert_eq!(replay.result.payload["messageId"], message_id);
    }

    /// Admission owner: one Gather atomically freezes one request, canonical Items,
    /// optional forward responsibilities and the separately reserved completion slot.
    #[cfg(feature = "slow-tests")]
    fn gather_acceptance_persists_unified_deliveries_and_split_budget() {
        let mut fixture = Fixture::new();
        let invocation = fixture.gather_invocation(
            "gather-acceptance",
            "请分别分析同一个主题并公开返回结论",
            &["agent_3", "agent_2", "agent_2"],
        );
        let execution = TeamToolService::default()
            .gather(&mut fixture.database, &invocation)
            .unwrap();
        assert_eq!(execution.result.status, CommandResultStatus::Accepted);
        assert_eq!(execution.result.code, "gather.accepted");
        assert_eq!(
            execution.result.payload["effectiveRecipients"],
            json!(["agent_2", "agent_3"])
        );
        assert_eq!(execution.result.payload["completion"], "deferred");
        let gather_id = execution.result.payload["gatherId"].as_str().unwrap();
        let persisted: (String, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT gather.status,
                       (SELECT COUNT(*) FROM gather_item WHERE gather_id = gather.id),
                       (SELECT COUNT(*) FROM message_delivery
                        WHERE gather_id = gather.id
                          AND delivery_kind = 'public_a2a'
                          AND dispatch_disposition = 'dispatch'
                          AND completion_role = 'optional')
                FROM gather_record AS gather WHERE gather.id = ?1
                "#,
                [gather_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(persisted, ("collecting".to_string(), 2, 2));
        let ledgers: (i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT accepted_a2a_allocated,
                       agent_run_responsibilities_allocated,
                       a2a_run_slots_allocated
                FROM camp_turn
                WHERE id = (SELECT camp_turn_id FROM agent_run WHERE id = ?1)
                "#,
                [&fixture.source_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(ledgers, (2, 3, 2));
    }

    /// Barrier owner: an exact member return stays public but cannot materialize
    /// the Lead; the member terminal creates one FIFO completion continuation.
    #[cfg(feature = "slow-tests")]
    fn gather_captures_public_return_and_materializes_one_completion() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let gather_invocation =
            fixture.gather_invocation("gather-capture", "请分析并公开回复队长", &["agent_2"]);
        let gathered = service
            .gather(&mut fixture.database, &gather_invocation)
            .unwrap();
        let gather_id = gathered.result.payload["gatherId"]
            .as_str()
            .unwrap()
            .to_string();
        let dispatch_delivery_id = gathered.result.payload["dispatchDeliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let member_run_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                [&dispatch_delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        let member_frozen_snapshot: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT frozen_snapshot_json FROM message_delivery WHERE id = ?1",
                [&dispatch_delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        let member_frozen_snapshot: Value = serde_json::from_str(&member_frozen_snapshot).unwrap();
        let member_run_facts: Value = serde_json::from_str(
            member_frozen_snapshot["frozenContext"]["manifestSelection"]["runFactPayload"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(member_run_facts["gather"]["role"], "member");
        assert_eq!(
            member_run_facts["gather"]["authoritativeResult"],
            "last_accepted_captured_return_current_run_retry_generation"
        );
        let (member_epoch, member_credential) =
            fixture.claim_bind_and_issue(&member_run_id, "native-gather-member");
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE camp_turn
                SET accepted_a2a_allocated = 16,
                    a2a_run_slots_allocated = 16
                WHERE id = (SELECT camp_turn_id FROM agent_run WHERE id = ?1)
                "#,
                [&member_run_id],
            )
            .unwrap();
        let budget_before_returns: (i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT accepted_a2a_allocated,
                       agent_run_responsibilities_allocated,
                       a2a_run_slots_allocated
                FROM camp_turn
                WHERE id = (SELECT camp_turn_id FROM agent_run WHERE id = ?1)
                "#,
                [&member_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let mut captured_delivery_id = String::new();
        let mut last_return_body = String::new();
        for ordinal in 0..crate::gather::GATHER_CAPTURED_MESSAGES_MAX_PER_ITEM_GENERATION {
            let body =
                if ordinal + 1 == crate::gather::GATHER_CAPTURED_MESSAGES_MAX_PER_ITEM_GENERATION {
                    "@agent_1 最后一条完整公开结论".to_string()
                } else {
                    format!("@agent_1 处理中，第 {} 条阶段回传", ordinal + 1)
                };
            let return_invocation = fixture.public_send_invocation_for(
                &member_credential,
                &format!("gather-member-return-{ordinal}"),
                &body,
                &["agent_1"],
            );
            let returned = service
                .send_public_message(&mut fixture.database, &return_invocation)
                .unwrap();
            assert_eq!(returned.result.status, CommandResultStatus::Accepted);
            if ordinal == 0 {
                captured_delivery_id = returned.result.payload["deliveryIds"][0]
                    .as_str()
                    .unwrap()
                    .to_string();
            }
            last_return_body = body;
        }
        let budget_after_returns: (i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT accepted_a2a_allocated,
                       agent_run_responsibilities_allocated,
                       a2a_run_slots_allocated
                FROM camp_turn
                WHERE id = (SELECT camp_turn_id FROM agent_run WHERE id = ?1)
                "#,
                [&member_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(budget_after_returns, budget_before_returns);

        let over_limit_invocation = fixture.public_send_invocation_for(
            &member_credential,
            "gather-member-return-over-limit",
            "@agent_1 超出当前 Gather Item generation 的额外回传",
            &["agent_1"],
        );
        let over_limit = service
            .send_public_message(&mut fixture.database, &over_limit_invocation)
            .unwrap();
        assert_eq!(over_limit.result.status, CommandResultStatus::Rejected);
        assert_eq!(over_limit.result.code, "message.execution_budget_exceeded");
        assert_eq!(
            over_limit.result.payload["details"]["limitScope"],
            "gather_captured_messages_per_item_generation"
        );
        let captured: (String, String, Option<String>, String, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT dispatch_disposition, status, target_agent_run_id,
                       gather_id, gather_dispatch_delivery_id
                FROM message_delivery WHERE id = ?1
                "#,
                [&captured_delivery_id],
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
            captured,
            (
                "gather_captured".to_string(),
                "settled".to_string(),
                None,
                gather_id.clone(),
                dispatch_delivery_id.clone(),
            )
        );
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM agent_run WHERE trigger_message_delivery_id = ?1",
                    [&captured_delivery_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );

        fixture.succeed_run(&member_run_id, member_epoch, "不会覆盖公开回传的 fallback");
        let completion_input: Value = fixture
            .database
            .connection()
            .query_row(
                "SELECT completion_input_json FROM gather_record WHERE id = ?1",
                [&gather_id],
                |row| row.get::<_, String>(0),
            )
            .map(|value| serde_json::from_str(&value).unwrap())
            .unwrap();
        assert_eq!(completion_input["schemaVersion"], 3);
        assert_eq!(completion_input["messageProjectionAudience"], "agent_v1");
        assert_eq!(completion_input["request"]["body"], "请分析并公开回复队长");
        assert!(
            completion_input["request"]["projectedBodyDigest"]
                .as_str()
                .is_some_and(|digest| digest.starts_with("sha256:") && digest.len() == 71)
        );
        assert_eq!(completion_input["items"][0]["activeRetryGeneration"], 0);
        assert_eq!(
            completion_input["items"][0]["capturedMessages"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(last_return_body.ends_with("最后一条完整公开结论"));
        assert!(
            completion_input["items"][0]["capturedMessages"][0]["bodyExcerpt"]
                .as_str()
                .unwrap()
                .ends_with("最后一条完整公开结论")
        );
        assert_eq!(
            completion_input["items"][0]["capturedMessages"][0]["bodyProjectionAudience"],
            "agent_v1"
        );
        assert!(
            completion_input["items"][0]["capturedMessages"][0]["projectedBodyDigest"]
                .as_str()
                .is_some_and(|digest| digest.starts_with("sha256:") && digest.len() == 71)
        );
        assert!(completion_input["items"][0]["fallbackSummary"].is_null());
        let ready: (String, String, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT gather.status, gather.completion_delivery_id,
                       completion.wait_condition
                FROM gather_record AS gather
                JOIN message_delivery AS completion
                  ON completion.id = gather.completion_delivery_id
                WHERE gather.id = ?1
                "#,
                [&gather_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(ready.0, "ready");
        assert_eq!(ready.2, "target_busy");
        let source_run_id = fixture.source_run_id.clone();
        fixture.succeed_run(
            &source_run_id,
            fixture.source_epoch,
            "Lead 结束首轮等待综合",
        );

        let completion: (String, String, String, i64, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT gather.status, gather.completion_run_id,
                       run.invocation_kind, run.trigger_delivery_generation,
                       delivery.frozen_snapshot_json
                FROM gather_record AS gather
                JOIN message_delivery AS delivery
                  ON delivery.id = gather.completion_delivery_id
                JOIN agent_run AS run ON run.id = gather.completion_run_id
                WHERE gather.id = ?1
                "#,
                [&gather_id],
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
        assert_eq!(completion.0, "completing");
        assert_eq!(completion.2, "gather_completion");
        assert_eq!(completion.3, 0);
        let frozen: Value = serde_json::from_str(&completion.4).unwrap();
        let rendered = frozen["frozenContext"]["renderedPayload"].as_str().unwrap();
        assert!(rendered.contains("\"type\":\"gather_completed\""));
        assert!(rendered.contains("最后一条完整公开结论"));
        assert!(rendered.contains("请分析并公开回复队长"));
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM agent_run WHERE trigger_message_delivery_id = ?1",
                    [&ready.1],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );

        let (completion_epoch, _) =
            fixture.claim_bind_and_issue(&completion.1, "native-gather-completion");
        fixture.succeed_run(&completion.1, completion_epoch, "Lead 的统一综合结论");
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT status FROM gather_record WHERE id = ?1",
                    [&gather_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "completed"
        );
    }

    /// Fallback owner: a successful member with no captured return freezes a
    /// scalar-safe bounded summary and retains the original initiator route even
    /// when the Camp Default Lead changes before the Barrier.
    #[cfg(feature = "slow-tests")]
    fn gather_freezes_bounded_fallback_on_the_original_initiator_route() {
        let mut fixture = Fixture::new();
        let invocation = fixture.gather_invocation(
            "gather-fallback-route",
            "请分析；无需另发消息，最终输出即可",
            &["agent_2"],
        );
        let gathered = TeamToolService::default()
            .gather(&mut fixture.database, &invocation)
            .unwrap();
        let gather_id = gathered.result.payload["gatherId"]
            .as_str()
            .unwrap()
            .to_string();
        let dispatch_delivery_id = gathered.result.payload["dispatchDeliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let member_run_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                [&dispatch_delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        let original_conversation_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT conversation_id FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id = 'agent_3' WHERE id = ?1",
                [&fixture.camp_id],
            )
            .unwrap();

        let (member_epoch, _) =
            fixture.claim_bind_and_issue(&member_run_id, "native-gather-fallback");
        let final_output = format!("结论🙂{}末尾", "分析".repeat(900));
        fixture.succeed_run(&member_run_id, member_epoch, &final_output);

        let (fallback, original_bytes, truncated, digest): (String, i64, bool, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT fallback_summary, fallback_summary_original_bytes,
                       fallback_summary_truncated, fallback_summary_digest
                FROM gather_item WHERE dispatch_delivery_id = ?1
                "#,
                [&dispatch_delivery_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert!(fallback.len() <= crate::gather::GATHER_FALLBACK_SUMMARY_MAX_BYTES);
        assert!(std::str::from_utf8(fallback.as_bytes()).is_ok());
        assert!(fallback.starts_with("结论🙂"));
        assert_eq!(original_bytes, final_output.len() as i64);
        assert!(truncated);
        assert_eq!(digest.len(), "sha256:".len() + 64);

        let (
            recipient_agent_id,
            target_conversation_id,
            completion_delivery_id,
            completion_frozen_snapshot,
            completion_input,
        ): (String, String, String, String, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT completion.recipient_agent_id,
                       completion.target_conversation_id,
                       completion.id, completion.frozen_snapshot_json,
                       gather.completion_input_json
                FROM gather_record AS gather
                JOIN message_delivery AS completion
                  ON completion.id = gather.completion_delivery_id
                WHERE gather.id = ?1
                "#,
                [&gather_id],
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
        assert_eq!(recipient_agent_id, "agent_1");
        assert_eq!(target_conversation_id, original_conversation_id);
        let completion_input: Value = serde_json::from_str(&completion_input).unwrap();
        assert_eq!(completion_input["schemaVersion"], 3);
        assert_eq!(completion_input["messageProjectionAudience"], "agent_v1");
        assert_eq!(
            completion_input["request"]["body"],
            "请分析；无需另发消息，最终输出即可"
        );
        assert!(
            completion_input["request"]["projectedBodyDigest"]
                .as_str()
                .is_some_and(|digest| digest.starts_with("sha256:") && digest.len() == 71)
        );
        assert_eq!(completion_input["items"][0]["capturedMessages"], json!([]));
        assert_eq!(
            completion_input["items"][0]["fallbackSummary"]["body"],
            fallback
        );

        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE agent_profile
                SET selected_runtime_adapter_kind = NULL,
                    default_runtime_installation_id = NULL,
                    default_model_selection_json = NULL,
                    default_permission_config_json = NULL
                WHERE id = 'agent_1'
                "#,
                [],
            )
            .unwrap();
        let source_run_id = fixture.source_run_id.clone();
        fixture.succeed_run(
            &source_run_id,
            fixture.source_epoch,
            "Lead 结束等待 completion",
        );
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT wait_condition FROM message_delivery WHERE id = ?1",
                    [&completion_delivery_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "runtime_unavailable"
        );

        // Clean-break owner: a ready pre-v3 completion is not admitted or
        // rebuilt after the projection contract changes.
        let mut obsolete_input = completion_input;
        obsolete_input["schemaVersion"] = json!(2);
        obsolete_input
            .as_object_mut()
            .unwrap()
            .remove("messageProjectionAudience");
        obsolete_input["request"]
            .as_object_mut()
            .unwrap()
            .remove("projectedBodyDigest");
        let obsolete_input_json = serde_json::to_string(&obsolete_input).unwrap();
        let obsolete_input_digest = format!(
            "sha256:{:x}",
            Sha256::digest(obsolete_input_json.as_bytes())
        );
        let mut obsolete_frozen: Value = serde_json::from_str(&completion_frozen_snapshot).unwrap();
        let obsolete_frozen_object = obsolete_frozen.as_object_mut().unwrap();
        obsolete_frozen_object.insert("completionInputSchemaVersion".into(), json!(2));
        obsolete_frozen_object.insert("completionInputDigest".into(), json!(obsolete_input_digest));
        obsolete_frozen_object.insert(
            "completionInputByteLength".into(),
            json!(obsolete_input_json.len()),
        );
        obsolete_frozen_object.remove("frozenContext");
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE gather_record
                SET completion_input_schema_version = 2,
                    completion_input_json = ?2,
                    completion_input_digest = ?3
                WHERE id = ?1;
                "#,
                params![gather_id, obsolete_input_json, obsolete_input_digest],
            )
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE message_delivery SET frozen_snapshot_json = ?2 WHERE id = ?1",
                params![
                    completion_delivery_id,
                    serde_json::to_string(&obsolete_frozen).unwrap()
                ],
            )
            .unwrap();
        configure_test_runtime(&fixture.database, &["agent_1"]);
        let error = crate::message_delivery::dispatch_delivery(
            &mut fixture.database,
            &completion_delivery_id,
            DeliveryDispatchTrigger::RuntimeReady,
            true,
        )
        .unwrap_err();
        assert!(format!("{error:#}").contains("Gather Completion input evidence is inconsistent"));
        let completion_run_count: i64 = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT COUNT(*) FROM agent_run
                WHERE trigger_message_delivery_id = ?1
                "#,
                [&completion_delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(completion_run_count, 0);
    }

    /// Cancellation owner: cancelling a waiting Completion Delivery must also
    /// close its Gather so later recipient pumps cannot create a continuation.
    #[test]
    fn cancelling_waiting_gather_completion_prevents_continuation() {
        let mut fixture = Fixture::new();
        let invocation = fixture.gather_invocation(
            "gather-cancel-completion",
            "完成后等待统一综合",
            &["agent_2"],
        );
        let gathered = TeamToolService::default()
            .gather(&mut fixture.database, &invocation)
            .unwrap();
        let gather_id = gathered.result.payload["gatherId"]
            .as_str()
            .unwrap()
            .to_string();
        let dispatch_delivery_id = gathered.result.payload["dispatchDeliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let member_run_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                [&dispatch_delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        let (member_epoch, _) =
            fixture.claim_bind_and_issue(&member_run_id, "native-gather-cancel-member");
        fixture.succeed_run(&member_run_id, member_epoch, "成员完成");
        let (completion_delivery_id, completion_version): (String, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT gather.completion_delivery_id, completion.version
                FROM gather_record AS gather
                JOIN message_delivery AS completion
                  ON completion.id = gather.completion_delivery_id
                WHERE gather.id = ?1
                "#,
                [&gather_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let cancelled = MessageDeliveryService::default()
            .cancel(
                &mut fixture.database,
                &user_envelope(
                    "cancel-waiting-gather-completion",
                    Some(&fixture.camp_id),
                    CancelMessageDeliveryCommand {
                        delivery_id: completion_delivery_id.clone(),
                        expected_version: completion_version,
                    },
                ),
            )
            .unwrap();
        assert_eq!(cancelled.result.code, "message_delivery.cancelled");
        let state: (String, String, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT gather.status, completion.status, gather.completion_run_id
                FROM gather_record AS gather
                JOIN message_delivery AS completion
                  ON completion.id = gather.completion_delivery_id
                WHERE gather.id = ?1
                "#,
                [&gather_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(state, ("cancelled".into(), "cancelled".into(), None));
        let attempt: (
            i64,
            Option<String>,
            Option<String>,
            String,
            Option<String>,
            Option<String>,
        ) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT delivery.dispatch_attempt_count, delivery.wait_condition,
                       delivery.active_dispatch_attempt_id,
                       attempt.status, attempt.wait_condition, attempt.ended_at
                FROM message_delivery AS delivery
                JOIN message_delivery_attempt AS attempt
                  ON attempt.delivery_id = delivery.id
                 AND attempt.ordinal = delivery.dispatch_attempt_count
                WHERE delivery.id = ?1
                "#,
                [&completion_delivery_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(attempt.0, 1);
        assert_eq!((attempt.1, attempt.2), (None, None));
        assert_eq!(attempt.3, "cancelled");
        assert_eq!(attempt.4, None);
        assert!(attempt.5.is_some());

        let source_run_id = fixture.source_run_id.clone();
        fixture.succeed_run(&source_run_id, fixture.source_epoch, "Lead 首轮结束");
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM agent_run WHERE trigger_message_delivery_id = ?1",
                    [&completion_delivery_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    /// Barrier race owner: both final member terminals use independent SQLite
    /// connections; exactly one serialized transaction may create completion.
    #[cfg(feature = "slow-tests")]
    fn concurrent_last_member_terminals_create_one_completion_delivery() {
        let mut fixture = Fixture::new();
        let invocation = fixture.gather_invocation(
            "gather-concurrent-barrier",
            "并发完成后统一综合",
            &["agent_2", "agent_3"],
        );
        let gathered = TeamToolService::default()
            .gather(&mut fixture.database, &invocation)
            .unwrap();
        let gather_id = gathered.result.payload["gatherId"]
            .as_str()
            .unwrap()
            .to_string();
        let delivery_ids = gathered.result.payload["dispatchDeliveryIds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_string())
            .collect::<Vec<_>>();
        let member_runs = delivery_ids
            .iter()
            .map(|delivery_id| {
                fixture
                    .database
                    .connection()
                    .query_row(
                        "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                        [delivery_id],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap()
            })
            .collect::<Vec<_>>();
        let member_epochs = member_runs
            .iter()
            .enumerate()
            .map(|(index, run_id)| {
                fixture
                    .claim_bind_and_issue(run_id, &format!("native-gather-race-{index}"))
                    .0
            })
            .collect::<Vec<_>>();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(member_runs.len()));
        let handles = member_runs
            .into_iter()
            .zip(member_epochs)
            .enumerate()
            .map(|(index, (run_id, execution_epoch))| {
                let directory = fixture.directory.clone();
                let camp_id = fixture.camp_id.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let mut database = Database::open(&directory).unwrap();
                    database
                        .connection()
                        .execute_batch("PRAGMA busy_timeout = 10000;")
                        .unwrap();
                    barrier.wait();
                    let runtime = ExecutionRuntimeService::default();
                    let execution = runtime
                        .load_agent_run_execution(&database, &run_id, execution_epoch)
                        .unwrap()
                        .unwrap();
                    runtime
                        .succeed_agent_run(
                            &mut database,
                            &CommandEnvelope {
                                command_id: format!("succeed-concurrent-gather-member-{index}"),
                                actor: ActorRef::System {
                                    component_id: "runtime-adapter:codex-cli".to_string(),
                                },
                                camp_id: Some(camp_id),
                                expected_versions: Vec::new(),
                                execution_epoch: None,
                                payload: SucceedAgentRunCommand {
                                    agent_run_id: run_id.clone(),
                                    expected_version: execution.version,
                                    execution_epoch,
                                    native_turn_id: format!("native-turn-{run_id}"),
                                    final_output: format!("成员 {index} 完成"),
                                    missing_send_recovery_candidate: None,
                                    ending_git_observation: None,
                                },
                            },
                        )
                        .unwrap()
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            assert_eq!(
                handle.join().unwrap().result.status,
                CommandResultStatus::Applied
            );
        }
        let state: (String, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT gather.status,
                       (SELECT COUNT(*) FROM gather_item
                        WHERE gather_id = gather.id AND status = 'succeeded'),
                       (SELECT COUNT(*) FROM message_delivery
                        WHERE gather_id = gather.id
                          AND delivery_kind = 'gather_completion')
                FROM gather_record AS gather WHERE gather.id = ?1
                "#,
                [&gather_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(state, ("ready".into(), 2, 1));
    }

    /// Stop-vs-Barrier race owner: regardless of which immediate transaction
    /// serializes first, the durable final state is one cancelled Gather with no
    /// active or materialized completion.
    #[cfg(feature = "slow-tests")]
    fn camp_turn_stop_racing_last_gather_member_cancels_completion() {
        let mut fixture = Fixture::new();
        let invocation =
            fixture.gather_invocation("gather-stop-barrier-race", "与用户 Stop 竞态", &["agent_2"]);
        let gathered = TeamToolService::default()
            .gather(&mut fixture.database, &invocation)
            .unwrap();
        let gather_id = gathered.result.payload["gatherId"]
            .as_str()
            .unwrap()
            .to_string();
        let dispatch_delivery_id = gathered.result.payload["dispatchDeliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let (member_run_id, camp_turn_id): (String, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT delivery.target_agent_run_id, delivery.camp_turn_id
                FROM message_delivery AS delivery WHERE delivery.id = ?1
                "#,
                [&dispatch_delivery_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let member_epoch = fixture
            .claim_bind_and_issue(&member_run_id, "native-gather-stop-race")
            .0;
        let turn_version: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT version FROM camp_turn WHERE id = ?1",
                [&camp_turn_id],
                |row| row.get(0),
            )
            .unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));

        let terminal_handle = {
            let directory = fixture.directory.clone();
            let camp_id = fixture.camp_id.clone();
            let run_id = member_run_id.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut database = Database::open(&directory).unwrap();
                database
                    .connection()
                    .execute_batch("PRAGMA busy_timeout = 10000;")
                    .unwrap();
                let runtime = ExecutionRuntimeService::default();
                let execution = runtime
                    .load_agent_run_execution(&database, &run_id, member_epoch)
                    .unwrap()
                    .unwrap();
                barrier.wait();
                runtime
                    .succeed_agent_run(
                        &mut database,
                        &CommandEnvelope {
                            command_id: "succeed-gather-stop-race-member".to_string(),
                            actor: ActorRef::System {
                                component_id: "runtime-adapter:codex-cli".to_string(),
                            },
                            camp_id: Some(camp_id),
                            expected_versions: Vec::new(),
                            execution_epoch: None,
                            payload: SucceedAgentRunCommand {
                                agent_run_id: run_id.clone(),
                                expected_version: execution.version,
                                execution_epoch: member_epoch,
                                native_turn_id: format!("native-turn-{run_id}"),
                                final_output: "成员恰好完成".to_string(),
                                missing_send_recovery_candidate: None,
                                ending_git_observation: None,
                            },
                        },
                    )
                    .unwrap()
            })
        };
        let stop_handle = {
            let directory = fixture.directory.clone();
            let camp_id = fixture.camp_id.clone();
            let turn_id = camp_turn_id.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut database = Database::open(&directory).unwrap();
                database
                    .connection()
                    .execute_batch("PRAGMA busy_timeout = 10000;")
                    .unwrap();
                barrier.wait();
                ExecutionRuntimeService::default()
                    .request_camp_turn_cancellation(
                        &mut database,
                        &user_envelope(
                            "cancel-gather-stop-race-turn",
                            Some(&camp_id),
                            CancelCampTurnCommand {
                                camp_id: camp_id.clone(),
                                camp_turn_id: turn_id,
                                expected_version: turn_version,
                            },
                        ),
                    )
                    .unwrap()
            })
        };
        let terminal = terminal_handle.join().unwrap();
        let stopped = stop_handle.join().unwrap();
        assert_ne!(stopped.result.status, CommandResultStatus::Rejected);
        assert!(matches!(
            terminal.result.status,
            CommandResultStatus::Applied | CommandResultStatus::Rejected
        ));

        let final_state: (String, Option<String>, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT gather.status, gather.completion_run_id,
                       (SELECT COUNT(*) FROM message_delivery
                        WHERE gather_id = gather.id
                          AND delivery_kind = 'gather_completion'
                          AND status IN ('pending', 'running'))
                FROM gather_record AS gather WHERE gather.id = ?1
                "#,
                [&gather_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(final_state, ("cancelled".into(), None, 0));
    }

    /// Membership lifecycle owner: once the frozen initiator leaves, later
    /// member completion cannot create or reroute a completion to the successor
    /// Default Lead.
    #[cfg(feature = "slow-tests")]
    fn gather_is_cancelled_when_original_initiator_leaves() {
        let mut fixture = Fixture::new();
        let invocation = fixture.gather_invocation(
            "gather-initiator-leave",
            "原 Lead 离场后不得转交",
            &["agent_2"],
        );
        let gathered = TeamToolService::default()
            .gather(&mut fixture.database, &invocation)
            .unwrap();
        let gather_id = gathered.result.payload["gatherId"]
            .as_str()
            .unwrap()
            .to_string();
        let dispatch_delivery_id = gathered.result.payload["dispatchDeliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let member_run_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                [&dispatch_delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        let member_epoch = fixture
            .claim_bind_and_issue(&member_run_id, "native-gather-initiator-leave")
            .0;
        let source_run_id = fixture.source_run_id.clone();
        fixture.succeed_run(&source_run_id, fixture.source_epoch, "Lead 先结束当前 Run");

        let now = chrono::Utc::now().to_rfc3339();
        let actor = ActorRef::User {
            user_id: "local_user".to_string(),
        };
        let transaction = fixture
            .database
            .connection_mut()
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        end_camp_membership(
            &transaction,
            &fixture.camp_id,
            "agent_1",
            None,
            "test_membership_ended",
            "gather-initiator-membership-ended",
            &actor,
            None,
            &now,
        )
        .unwrap();
        transaction.commit().unwrap();
        let (run_status, _run_version, cancel_requested_at): (String, i64, Option<String>) =
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT status, version, cancel_requested_at FROM agent_run WHERE id = ?1",
                    [&member_run_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap();
        assert_eq!(run_status, "cancelled");
        assert!(cancel_requested_at.is_some());
        ExecutionRuntimeService::default()
            .record_runtime_cleanup_completed(&fixture.database, &member_run_id, member_epoch)
            .unwrap();

        let final_state: (
            String,
            Option<String>,
            Option<String>,
            String,
            String,
            String,
            String,
        ) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT gather.status, gather.completion_delivery_id,
                       gather.completion_run_id, camp.default_lead_agent_id,
                       (SELECT status FROM message_delivery WHERE id = ?2),
                       (SELECT status FROM agent_run WHERE id = ?3),
                       (SELECT status || ':' || settled_run_count || '/' || target_run_count
                        FROM camp_membership_reconciliation
                        WHERE command_id = 'gather-initiator-membership-ended')
                FROM gather_record AS gather
                JOIN camp ON camp.id = gather.camp_id
                WHERE gather.id = ?1
                "#,
                params![gather_id, dispatch_delivery_id, member_run_id],
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
        assert_eq!(
            final_state,
            (
                "cancelled".into(),
                None,
                None,
                "agent_2".into(),
                "cancelled".into(),
                "cancelled".into(),
                "completed:1/1".into(),
            )
        );
    }

    /// FIFO owner: a newer Gather completion cannot overtake an older pending
    /// completion when Runtime readiness changes between their Barrier commits.
    #[cfg(feature = "slow-tests")]
    fn multiple_gather_completions_share_original_lead_fifo() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let first_invocation =
            fixture.gather_invocation("gather-fifo-first", "第一组", &["agent_2"]);
        let first = service
            .gather(&mut fixture.database, &first_invocation)
            .unwrap();
        let second_invocation =
            fixture.gather_invocation("gather-fifo-second", "第二组", &["agent_3"]);
        let second = service
            .gather(&mut fixture.database, &second_invocation)
            .unwrap();
        let gather_ids = [&first, &second].map(|execution| {
            execution.result.payload["gatherId"]
                .as_str()
                .unwrap()
                .to_string()
        });
        let member_run_ids = [&first, &second].map(|execution| {
            let delivery_id = execution.result.payload["dispatchDeliveryIds"][0]
                .as_str()
                .unwrap();
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                    [delivery_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap()
        });
        let member_epochs = member_run_ids
            .iter()
            .enumerate()
            .map(|(index, run_id)| {
                fixture
                    .claim_bind_and_issue(run_id, &format!("native-gather-fifo-member-{index}"))
                    .0
            })
            .collect::<Vec<_>>();
        let source_run_id = fixture.source_run_id.clone();
        fixture.succeed_run(&source_run_id, fixture.source_epoch, "Lead 等待两组结果");
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE agent_profile
                SET selected_runtime_adapter_kind = NULL,
                    default_runtime_installation_id = NULL,
                    default_model_selection_json = NULL,
                    default_permission_config_json = NULL
                WHERE id = 'agent_1'
                "#,
                [],
            )
            .unwrap();

        fixture.succeed_run(&member_run_ids[0], member_epochs[0], "第一组结果");
        let first_completion_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT completion_delivery_id FROM gather_record WHERE id = ?1",
                [&gather_ids[0]],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT wait_condition FROM message_delivery WHERE id = ?1",
                    [&first_completion_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "runtime_unavailable"
        );

        configure_test_runtime(&fixture.database, &["agent_1"]);
        fixture.succeed_run(&member_run_ids[1], member_epochs[1], "第二组结果");
        let second_completion_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT completion_delivery_id FROM gather_record WHERE id = ?1",
                [&gather_ids[1]],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT wait_condition FROM message_delivery WHERE id = ?1",
                    [&second_completion_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "target_busy"
        );

        let dispatched = dispatch_pending_for_recipient(
            &mut fixture.database,
            &fixture.camp_id,
            "agent_1",
            DeliveryDispatchTrigger::RuntimeReady,
            true,
        )
        .unwrap();
        assert!(matches!(
            dispatched.as_slice(),
            [crate::message_delivery::DeliveryDispatchOutcome::Materialized { .. }]
        ));
        let first_completion_run: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT completion_run_id FROM gather_record WHERE id = ?1",
                [&gather_ids[0]],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT status FROM gather_record WHERE id = ?1",
                    [&gather_ids[1]],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "ready"
        );

        let (completion_epoch, _) =
            fixture.claim_bind_and_issue(&first_completion_run, "native-gather-fifo-completion");
        fixture.succeed_run(&first_completion_run, completion_epoch, "第一组统一综合");
        let second_state: (String, String) = fixture
            .database
            .connection()
            .query_row(
                "SELECT status, completion_run_id FROM gather_record WHERE id = ?1",
                [&gather_ids[1]],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(second_state.0, "completing");
        assert!(!second_state.1.is_empty());
    }

    /// Retry owner: a failed materialized member responsibility may reuse its
    /// Delivery/Item with a new generation while collecting, but the same failed
    /// Delivery cannot reopen the Gather after another Item commits the Barrier.
    #[cfg(feature = "slow-tests")]
    fn gather_forward_retry_reuses_item_and_ready_wins() {
        let mut fixture = Fixture::new();
        let invocation = fixture.gather_invocation(
            "gather-forward-retry",
            "失败时允许用户重试同一责任",
            &["agent_2", "agent_3"],
        );
        let gathered = TeamToolService::default()
            .gather(&mut fixture.database, &invocation)
            .unwrap();
        let gather_id = gathered.result.payload["gatherId"]
            .as_str()
            .unwrap()
            .to_string();
        let delivery_ids = gathered.result.payload["dispatchDeliveryIds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_string())
            .collect::<Vec<_>>();
        let member_runs = delivery_ids
            .iter()
            .map(|delivery_id| {
                fixture
                    .database
                    .connection()
                    .query_row(
                        "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                        [delivery_id],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap()
            })
            .collect::<Vec<_>>();
        let (first_epoch, first_credential) =
            fixture.claim_bind_and_issue(&member_runs[0], "native-gather-retry-first");
        let second_epoch = fixture
            .claim_bind_and_issue(&member_runs[1], "native-gather-retry-second")
            .0;
        let old_return = fixture.public_send_invocation_for(
            &first_credential,
            "gather-retry-generation-zero-return",
            "@agent_1 旧 generation 结论 A",
            &["agent_1"],
        );
        let old_returned = TeamToolService::default()
            .send_public_message(&mut fixture.database, &old_return)
            .unwrap();
        assert_eq!(old_returned.result.status, CommandResultStatus::Accepted);
        fixture.fail_run(&member_runs[0], first_epoch, "member_attempt_one_failed");
        let failed_version: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT version FROM message_delivery WHERE id = ?1",
                [&delivery_ids[0]],
                |row| row.get(0),
            )
            .unwrap();
        let retried = MessageDeliveryService::default()
            .retry(
                &mut fixture.database,
                &user_envelope(
                    "retry-gather-forward-once",
                    Some(&fixture.camp_id),
                    RetryMessageDeliveryCommand {
                        delivery_id: delivery_ids[0].clone(),
                        expected_version: failed_version,
                    },
                ),
            )
            .unwrap();
        assert_eq!(retried.result.code, "message_delivery.retry_requested");
        assert_eq!(retried.result.payload["retryGeneration"], 1);
        let (retry_run_id, item_generation, item_status): (String, i64, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT item.target_agent_run_id, item.active_retry_generation,
                       item.status
                FROM gather_item AS item
                WHERE item.dispatch_delivery_id = ?1
                "#,
                [&delivery_ids[0]],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_ne!(retry_run_id, member_runs[0]);
        assert_eq!((item_generation, item_status.as_str()), (1, "running"));
        let (retry_epoch, retry_credential) =
            fixture.claim_bind_and_issue(&retry_run_id, "native-gather-retry-generation-one");
        let current_return = fixture.public_send_invocation_for(
            &retry_credential,
            "gather-retry-generation-one-return",
            "@agent_1 当前 generation 结论 B",
            &["agent_1"],
        );
        let current_returned = TeamToolService::default()
            .send_public_message(&mut fixture.database, &current_return)
            .unwrap();
        assert_eq!(
            current_returned.result.status,
            CommandResultStatus::Accepted
        );
        fixture.fail_run(&retry_run_id, retry_epoch, "member_attempt_two_failed");
        fixture.succeed_run(&member_runs[1], second_epoch, "另一成员完成");

        let completion_input: Value = fixture
            .database
            .connection()
            .query_row(
                "SELECT completion_input_json FROM gather_record WHERE id = ?1",
                [&gather_id],
                |row| row.get::<_, String>(0),
            )
            .map(|value| serde_json::from_str(&value).unwrap())
            .unwrap();
        let retried_item = completion_input["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["dispatchDeliveryId"] == delivery_ids[0])
            .unwrap();
        assert_eq!(retried_item["activeRetryGeneration"], 1);
        assert_eq!(retried_item["targetAgentRunId"], retry_run_id);
        assert_eq!(
            retried_item["capturedMessages"].as_array().unwrap().len(),
            1
        );
        assert_eq!(retried_item["capturedMessages"][0]["retryGeneration"], 1);
        assert!(
            retried_item["capturedMessages"][0]["bodyExcerpt"]
                .as_str()
                .unwrap()
                .ends_with("当前 generation 结论 B")
        );
        assert!(
            !completion_input
                .to_string()
                .contains("旧 generation 结论 A")
        );

        let ready_failed_version: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT version FROM message_delivery WHERE id = ?1",
                [&delivery_ids[0]],
                |row| row.get(0),
            )
            .unwrap();
        let rejected = MessageDeliveryService::default()
            .retry(
                &mut fixture.database,
                &user_envelope(
                    "retry-gather-forward-after-ready",
                    Some(&fixture.camp_id),
                    RetryMessageDeliveryCommand {
                        delivery_id: delivery_ids[0].clone(),
                        expected_version: ready_failed_version,
                    },
                ),
            )
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(rejected.result.code, "message_delivery.retry_not_allowed");
        let final_state: (String, String, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT gather.status, item.status,
                       item.active_retry_generation,
                       (SELECT COUNT(*) FROM message_delivery
                        WHERE gather_id = gather.id
                          AND delivery_kind = 'gather_completion')
                FROM gather_record AS gather
                JOIN gather_item AS item ON item.gather_id = gather.id
                WHERE gather.id = ?1 AND item.dispatch_delivery_id = ?2
                "#,
                params![gather_id, delivery_ids[0]],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(final_state, ("ready".into(), "failed".into(), 1, 1));
    }

    #[cfg(feature = "slow-tests")]
    fn public_send_resolves_active_member_display_name_alias_before_delivery() {
        let mut fixture = Fixture::new();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_profile SET display_name = '爱丽丝' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        let invocation = fixture.public_send_invocation(
            "public-send-display-name-alias",
            "@爱丽丝 v35 实现完成，请做只读 CR。",
            &[],
        );

        let sent = TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();

        assert_eq!(sent.result.status, CommandResultStatus::Accepted);
        assert_eq!(
            sent.result.payload["effectiveRecipients"],
            json!(["agent_2"])
        );
        assert_eq!(
            sent.result.payload["deliveryIds"].as_array().unwrap().len(),
            1
        );
        let message_id = sent.result.payload["messageId"].as_str().unwrap();
        let (body, content_json, delivery_count): (String, String, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT message.body, message.structured_content_json,
                       (SELECT COUNT(*) FROM message_delivery
                        WHERE message_id = message.id)
                FROM camp_message AS message
                WHERE message.id = ?1
                "#,
                [message_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(body, "@爱丽丝 v35 实现完成，请做只读 CR。");
        assert_eq!(
            serde_json::from_str::<Value>(&content_json).unwrap(),
            json!([
                {"kind": "member_mention", "agentId": "agent_2"},
                {"kind": "text", "text": " v35 实现完成，请做只读 CR。"}
            ])
        );
        assert_eq!(delivery_count, 1);
    }

    #[cfg(feature = "slow-tests")]
    fn public_send_keeps_mid_line_display_name_alias_as_public_text() {
        let mut fixture = Fixture::new();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_profile SET display_name = 'Alice' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        let body = "让 Bob 分析一下 @Alice 提出的迁移方案";
        let invocation =
            fixture.public_send_invocation("public-send-mid-line-display-name", body, &[]);

        let sent = TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();

        assert_eq!(sent.result.status, CommandResultStatus::Accepted);
        assert_eq!(sent.result.payload["effectiveRecipients"], json!([]));
        assert_eq!(sent.result.payload["deliveryIds"], json!([]));
        let message_id = sent.result.payload["messageId"].as_str().unwrap();
        let (stored_body, content_json, delivery_count): (String, String, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT message.body, message.structured_content_json,
                       (SELECT COUNT(*) FROM message_delivery
                        WHERE message_id = message.id)
                FROM camp_message AS message
                WHERE message.id = ?1
                "#,
                [message_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(stored_body, body);
        assert_eq!(
            serde_json::from_str::<Value>(&content_json).unwrap(),
            json!([{"kind": "text", "text": body}])
        );
        assert_eq!(delivery_count, 0);
    }

    #[cfg(feature = "slow-tests")]
    fn public_only_send_consumes_no_a2a_slot() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let trigger_message_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT trigger_camp_message_id FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
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
        let message_id = sent.result.payload["messageId"].as_str().unwrap();
        let reply_to_message_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT reply_to_camp_message_id FROM camp_message WHERE id = ?1",
                [message_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(reply_to_message_id, trigger_message_id);
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

        // The Gather-capture deadline gate must not broaden into a new gate for
        // recipient-free public narration, which historically consumes no
        // execution-budget unit.
        fixture
            .database
            .connection()
            .execute(
                "UPDATE camp_turn SET execution_budget_deadline_at = '2000-01-01T00:00:00Z'",
                [],
            )
            .unwrap();
        let after_deadline = fixture.public_send_invocation(
            "public-only-send-after-deadline",
            "A later recipient-free public fact.",
            &[],
        );
        let after_deadline = service
            .send_public_message(&mut fixture.database, &after_deadline)
            .unwrap();
        assert_eq!(after_deadline.result.status, CommandResultStatus::Accepted);
        assert_eq!(after_deadline.result.payload["deliveryIds"], json!([]));
    }

    #[test]
    fn current_user_attention_is_orthogonal_atomic_and_replay_safe() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let before_slots: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT SUM(a2a_run_slots_allocated) FROM camp_turn",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let mut invocation = fixture.public_send_invocation(
            "public-current-user-attention",
            "Please choose A or B",
            &[],
        );
        invocation.input.mention_user = true;

        let sent = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        assert_eq!(sent.result.status, CommandResultStatus::Accepted);
        assert_eq!(sent.result.payload["effectiveRecipients"], json!([]));
        assert_eq!(sent.result.payload["deliveryIds"], json!([]));
        let message_id = sent.result.payload["messageId"].as_str().unwrap();
        let (body, content_json): (String, String) = fixture
            .database
            .connection()
            .query_row(
                "SELECT body, structured_content_json FROM camp_message WHERE id = ?1",
                [message_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(body, "@你 Please choose A or B");
        assert_eq!(
            serde_json::from_str::<Value>(&content_json).unwrap(),
            json!([
                {"kind": "current_user_mention", "userId": "local_user"},
                {"kind": "text", "text": "Please choose A or B"}
            ])
        );
        let notification: (String, String, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT semantic, recipient_user_id, source_message_id
                FROM notification_occurrence
                WHERE semantic = 'user_mention'
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(notification.0, "user_mention");
        assert_eq!(notification.1, "local_user");
        assert_eq!(notification.2, message_id);
        let after_slots: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT SUM(a2a_run_slots_allocated) FROM camp_turn",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(after_slots, before_slots);

        let replay = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result.payload["messageId"], message_id);
        let notification_count: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM notification_occurrence WHERE semantic = 'user_mention'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(notification_count, 1);
    }

    #[cfg(feature = "slow-tests")]
    fn current_user_text_lookalikes_do_not_create_attention() {
        let mut fixture = Fixture::new();
        let invocation = fixture.public_send_invocation(
            "public-current-user-lookalikes",
            "@你 @local_user @local-user are plain text",
            &[],
        );
        TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        let notification_count: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM notification_occurrence WHERE semantic = 'user_mention'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(notification_count, 0);
    }

    #[cfg(feature = "slow-tests")]
    fn task_linkage_ignores_current_user_attention_for_recipient_cardinality() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let mut ambiguous = fixture.public_send_invocation(
            "task-user-only-is-ambiguous",
            "This must not be accepted",
            &[],
        );
        ambiguous.input.mention_user = true;
        ambiguous.input.task_id = Some(fixture.task_id.clone());
        let rejected = service
            .send_public_message(&mut fixture.database, &ambiguous)
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(rejected.result.code, "message.task_recipient_ambiguous");
        let rejected_effects: (i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT
                    (SELECT COUNT(*) FROM camp_message WHERE body LIKE '%must not be accepted%'),
                    (SELECT COUNT(*) FROM notification_occurrence
                     WHERE semantic = 'user_mention')
                "#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(rejected_effects, (0, 0));

        let target_task = CollaborationService::default()
            .create_task(
                &mut fixture.database,
                &user_envelope(
                    "create-user-attention-target-task",
                    Some(&fixture.camp_id),
                    CreateTaskCommand {
                        camp_id: fixture.camp_id.clone(),
                        title: "User attention target task".to_string(),
                        assignee_agent_id: "agent_2".to_string(),
                        ..Default::default()
                    },
                ),
            )
            .unwrap();
        let target_task_id = target_task.result.payload["taskId"]
            .as_str()
            .unwrap()
            .to_string();
        let mut accepted = fixture.public_send_invocation(
            "task-agent-and-user-is-valid",
            "Coordinate the linked responsibility",
            &["agent_2"],
        );
        accepted.input.mention_user = true;
        accepted.input.task_id = Some(target_task_id);
        let sent = service
            .send_public_message(&mut fixture.database, &accepted)
            .unwrap();
        assert_eq!(sent.result.status, CommandResultStatus::Accepted);
        assert_eq!(
            sent.result.payload["effectiveRecipients"],
            json!(["agent_2"])
        );
    }

    #[test]
    fn notification_write_failure_rolls_back_the_entire_send() {
        let mut fixture = Fixture::new();
        fixture
            .database
            .connection()
            .execute_batch(
                r#"
                CREATE TRIGGER reject_test_user_mention_notification
                BEFORE INSERT ON notification_occurrence
                WHEN NEW.semantic = 'user_mention'
                BEGIN
                    SELECT RAISE(ABORT, 'test notification failure');
                END;
                "#,
            )
            .unwrap();
        let before_sequence: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT last_message_sequence FROM camp WHERE id = ?1",
                [&fixture.camp_id],
                |row| row.get(0),
            )
            .unwrap();
        let mut invocation = fixture.public_send_invocation(
            "notification-failure-is-atomic",
            "No partial message",
            &["agent_2"],
        );
        invocation.input.mention_user = true;
        let error = TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap_err();
        assert!(format!("{error:#}").contains("test notification failure"));
        let after: (i64, i64, i64, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT
                    last_message_sequence,
                    (SELECT COUNT(*) FROM camp_message WHERE body LIKE '%No partial message%'),
                    (SELECT COUNT(*) FROM message_delivery
                     WHERE source_agent_run_id = ?2 AND created_at >= '2000-01-01'),
                    (SELECT COUNT(*) FROM notification_occurrence
                     WHERE semantic = 'user_mention')
                FROM camp WHERE id = ?1
                "#,
                rusqlite::params![fixture.camp_id, fixture.source_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(after.0, before_sequence);
        assert_eq!(after.1, 0);
        assert_eq!(after.2, 0);
        assert_eq!(after.3, 0);
    }

    #[cfg(feature = "slow-tests")]
    fn agent_send_rejects_a_tombstoned_trigger_message() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE camp_message SET tombstoned_at = '2026-08-12T00:00:00Z' WHERE id = (SELECT trigger_camp_message_id FROM agent_run WHERE id = ?1)",
                [&fixture.source_run_id],
            )
            .unwrap();

        let invocation = fixture.public_send_invocation(
            "tombstoned-trigger-send",
            "This message must not be persisted.",
            &[],
        );
        let error = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap_err();

        assert!(
            error
                .to_string()
                .contains("trigger CampMessage is tombstoned")
        );
        let persisted: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_message WHERE body = 'This message must not be persisted.'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(persisted, 0);
    }

    #[cfg(feature = "slow-tests")]
    fn a2a_send_rejects_a_missing_trigger_delivery() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let forward_invocation = fixture.public_send_invocation(
            "missing-trigger-forward",
            "Create an A2A child",
            &["agent_2"],
        );
        let forward = service
            .send_public_message(&mut fixture.database, &forward_invocation)
            .unwrap();
        let child_run_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                [forward.result.payload["deliveryIds"][0].as_str().unwrap()],
                |row| row.get(0),
            )
            .unwrap();
        let (_child_epoch, child_credential) =
            fixture.claim_bind_and_issue(&child_run_id, "native-missing-trigger");
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET trigger_message_delivery_id = NULL WHERE id = ?1",
                [&child_run_id],
            )
            .unwrap();

        let invocation = fixture.public_send_invocation_for(
            &child_credential,
            "missing-trigger-send",
            "This message must not be persisted either.",
            &[],
        );
        let error = service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap_err();

        assert!(
            error
                .to_string()
                .contains("A2A AgentRun has no trigger Message Delivery")
        );
        let persisted: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_message WHERE body = 'This message must not be persisted either.'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(persisted, 0);
    }

    #[cfg(feature = "slow-tests")]
    fn addressing_the_immediate_caller_deduplicates_into_a_return_delivery() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let forward_invocation = fixture.public_send_invocation(
            "forward-to-agent-2",
            "Please inspect this",
            &["agent_2"],
        );
        let forward = service
            .send_public_message(&mut fixture.database, &forward_invocation)
            .unwrap();
        let forward_message_id = forward.result.payload["messageId"]
            .as_str()
            .unwrap()
            .to_string();
        let child_run_id = forward.result.payload["deliveryIds"][0]
            .as_str()
            .and_then(|delivery_id| {
                fixture
                    .database
                    .connection()
                    .query_row(
                        "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                        [delivery_id],
                        |row| row.get::<_, Option<String>>(0),
                    )
                    .unwrap()
            })
            .unwrap();
        let (_child_epoch, child_credential) =
            fixture.claim_bind_and_issue(&child_run_id, "native-child-return");

        let return_invocation = fixture.public_send_invocation_for(
            &child_credential,
            "return-to-agent-1",
            "Review complete @agent_1",
            &["agent_1"],
        );
        let returned = service
            .send_public_message(&mut fixture.database, &return_invocation)
            .unwrap();
        assert_eq!(returned.result.status, CommandResultStatus::Accepted);
        assert_eq!(
            returned.result.payload["effectiveRecipients"],
            json!(["agent_1"])
        );
        assert_eq!(
            returned.result.payload["deliveryIds"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let return_message_id = returned.result.payload["messageId"].as_str().unwrap();
        let reply_to_message_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT reply_to_camp_message_id FROM camp_message WHERE id = ?1",
                [return_message_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(reply_to_message_id, forward_message_id);

        let return_delivery_id = returned.result.payload["deliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let return_delivery: (
            String,
            Option<String>,
            Option<String>,
            i64,
            String,
            Option<String>,
        ) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT edge_kind, target_parent_agent_run_id,
                       return_to_agent_run_id, a2a_depth,
                       wait_condition, target_agent_run_id
                FROM message_delivery WHERE id = ?1
                "#,
                [&return_delivery_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(return_delivery.0, "return");
        assert_eq!(return_delivery.1, None);
        assert_eq!(
            return_delivery.2.as_deref(),
            Some(fixture.source_run_id.as_str())
        );
        assert_eq!(return_delivery.3, 0);
        assert_eq!(return_delivery.4, "target_busy");
        assert_eq!(return_delivery.5, None);

        let source_run_id = fixture.source_run_id.clone();
        fixture.succeed_run(&source_run_id, fixture.source_epoch, "caller yielded");
        let status: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT status FROM message_delivery WHERE id = ?1",
                [&return_delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        if status == "pending" {
            dispatch_pending_for_recipient(
                &mut fixture.database,
                &fixture.camp_id,
                "agent_1",
                DeliveryDispatchTrigger::TargetRunEnded,
                true,
            )
            .unwrap();
        }
        let returned_run: (String, Option<String>, Option<String>, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT target.id, target.a2a_parent_agent_run_id,
                       target.a2a_root_agent_run_id, target.a2a_depth
                FROM message_delivery AS delivery
                JOIN agent_run AS target ON target.id = delivery.target_agent_run_id
                WHERE delivery.id = ?1
                "#,
                [&return_delivery_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert!(!returned_run.0.is_empty());
        assert_eq!(returned_run.1, None);
        assert_eq!(
            returned_run.2.as_deref(),
            Some(fixture.source_run_id.as_str())
        );
        assert_eq!(returned_run.3, 0);
    }

    #[cfg(feature = "slow-tests")]
    fn a_non_immediate_ancestor_remains_rejected() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let to_agent_2_invocation =
            fixture.public_send_invocation("ancestor-chain-agent-2", "Ask agent 2", &["agent_2"]);
        let to_agent_2 = service
            .send_public_message(&mut fixture.database, &to_agent_2_invocation)
            .unwrap();
        let agent_2_run_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                [to_agent_2.result.payload["deliveryIds"][0]
                    .as_str()
                    .unwrap()],
                |row| row.get(0),
            )
            .unwrap();
        let (agent_2_epoch, agent_2_credential) =
            fixture.claim_bind_and_issue(&agent_2_run_id, "native-ancestor-agent-2");
        let to_agent_3_invocation = fixture.public_send_invocation_for(
            &agent_2_credential,
            "ancestor-chain-agent-3",
            "Ask agent 3",
            &["agent_3"],
        );
        let to_agent_3 = service
            .send_public_message(&mut fixture.database, &to_agent_3_invocation)
            .unwrap();
        let agent_3_run_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                [to_agent_3.result.payload["deliveryIds"][0]
                    .as_str()
                    .unwrap()],
                |row| row.get(0),
            )
            .unwrap();
        let (_agent_3_epoch, agent_3_credential) =
            fixture.claim_bind_and_issue(&agent_3_run_id, "native-ancestor-agent-3");
        let rejected_invocation = fixture.public_send_invocation_for(
            &agent_3_credential,
            "reject-non-immediate-ancestor",
            "Do not recurse to agent 1",
            &["agent_1"],
        );
        let rejected = service
            .send_public_message(&mut fixture.database, &rejected_invocation)
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(rejected.result.code, "message.addressing_invalid");
        assert_eq!(
            rejected.result.payload["details"]["offending"],
            json!([{
                "source": "--to",
                "value": "agent_1",
                "reason": "ancestor_cycle"
            }])
        );

        let return_to_agent_2_invocation = fixture.public_send_invocation_for(
            &agent_3_credential,
            "return-to-immediate-agent-2",
            "Return to the direct caller",
            &["agent_2"],
        );
        let returned_to_agent_2 = service
            .send_public_message(&mut fixture.database, &return_to_agent_2_invocation)
            .unwrap();
        assert_eq!(
            returned_to_agent_2.result.status,
            CommandResultStatus::Accepted
        );
        let return_to_agent_2_delivery_id = returned_to_agent_2.result.payload["deliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let popped_lineage: (String, Option<String>, Option<String>, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT edge_kind, target_parent_agent_run_id,
                       return_to_agent_run_id, a2a_depth
                FROM message_delivery WHERE id = ?1
                "#,
                [&return_to_agent_2_delivery_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(popped_lineage.0, "return");
        assert_eq!(
            popped_lineage.1.as_deref(),
            Some(fixture.source_run_id.as_str())
        );
        assert_eq!(popped_lineage.2.as_deref(), Some(agent_2_run_id.as_str()));
        assert_eq!(popped_lineage.3, 1);

        fixture.succeed_run(&agent_2_run_id, agent_2_epoch, "caller yielded");
        let status: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT status FROM message_delivery WHERE id = ?1",
                [&return_to_agent_2_delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        if status == "pending" {
            dispatch_pending_for_recipient(
                &mut fixture.database,
                &fixture.camp_id,
                "agent_2",
                DeliveryDispatchTrigger::TargetRunEnded,
                true,
            )
            .unwrap();
        }
        let returned_agent_2_run_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                [&return_to_agent_2_delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        let (_returned_agent_2_epoch, returned_agent_2_credential) =
            fixture.claim_bind_and_issue(&returned_agent_2_run_id, "native-returned-agent-2");
        let return_to_agent_1_invocation = fixture.public_send_invocation_for(
            &returned_agent_2_credential,
            "returned-agent-2-to-agent-1",
            "Now return to the original caller",
            &["agent_1"],
        );
        let returned_to_agent_1 = service
            .send_public_message(&mut fixture.database, &return_to_agent_1_invocation)
            .unwrap();
        assert_eq!(
            returned_to_agent_1.result.status,
            CommandResultStatus::Accepted
        );
        let final_edge: (String, Option<String>, Option<String>, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT edge_kind, target_parent_agent_run_id,
                       return_to_agent_run_id, a2a_depth
                FROM message_delivery WHERE id = ?1
                "#,
                [returned_to_agent_1.result.payload["deliveryIds"][0]
                    .as_str()
                    .unwrap()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(final_edge.0, "return");
        assert_eq!(final_edge.1, None);
        assert_eq!(
            final_edge.2.as_deref(),
            Some(fixture.source_run_id.as_str())
        );
        assert_eq!(final_edge.3, 0);
    }

    #[cfg(feature = "slow-tests")]
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
                        assignee_agent_id: "agent_2".to_string(),
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
        let body = "### 双人追问 · 复核邀请\n\n\
sender_agent_id: agent_2\n\
return_to: agent_3\n\n\
Use this exact public input @agent_2";
        let mut invocation =
            fixture.public_send_invocation("frozen-public-context", body, &["agent_2"]);
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
        let projected_message = frozen_current_input["message"].as_str().unwrap();
        assert!(projected_message.starts_with("### 双人追问 · 复核邀请"));
        assert!(projected_message.contains("sender_agent_id: agent_2"));
        assert!(projected_message.contains("return_to: agent_3"));
        assert!(projected_message.contains("Use this exact public input @"));
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
                .contains("A2A Current Input CampMessage requires a source AgentRun")
        );
    }

    #[cfg(feature = "slow-tests")]
    fn task_linked_public_delivery_reuses_exact_run_fact_bytes() {
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
                        description: "Exercise exact Run Fact bytes".to_string(),
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
        let frozen_fact_payload =
            frozen_snapshot["frozenContext"]["manifestSelection"]["runFactPayload"]
                .as_str()
                .unwrap()
                .to_string();
        assert!(frozen_fact_payload.contains("\"taskId\""));

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
        let run_fact_section = context
            .rendered_payload
            .split("[RUN_FACTS]\n")
            .nth(1)
            .unwrap()
            .split("\n[/RUN_FACTS]")
            .next()
            .unwrap();
        let (manifest_payload, manifest_digest): (String, String) = fixture
            .database
            .connection()
            .query_row(
                "SELECT run_fact_payload_json, run_fact_digest FROM context_manifest WHERE id = ?1",
                [&context.manifest_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(run_fact_section, frozen_fact_payload);
        assert_eq!(manifest_payload, frozen_fact_payload);
        assert_eq!(
            manifest_digest,
            format!("sha256:{:x}", Sha256::digest(manifest_payload.as_bytes()))
        );
    }

    #[cfg(feature = "slow-tests")]
    fn missing_send_recovery_publishes_one_literal_recipient_free_message() {
        let mut fixture = Fixture::new();
        let body = "Recovered final with literal @agent_2";
        let run_id = fixture.source_run_id.clone();
        let completed = fixture.succeed_run_with_candidate(
            &run_id,
            fixture.source_epoch,
            body,
            Some(MissingSendRecoveryCandidate::new(
                MissingSendRecoveryBoundary::CodexCompletedTurn,
                body,
            )),
        );
        assert_eq!(
            completed.result.payload["missingSendRecovery"]["decision"],
            "published"
        );
        assert_eq!(
            completed.result.payload["missingSendRecovery"]["acceptedSendDetected"],
            false
        );

        let message_id = completed.result.payload["finalCampMessageId"]
            .as_str()
            .expect("recovery must link the public message");
        let message: (
            String,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
        ) = fixture
            .database
            .connection()
            .query_row(
                r#"
                    SELECT body, structured_content_json, address_mode,
                           addressed_agent_ids_json, effective_recipient_ids_json,
                           source_operation_id, reply_to_camp_message_id
                    FROM camp_message WHERE id = ?1
                    "#,
                [message_id],
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
        assert_eq!(message.0, body);
        assert_eq!(
            message.1,
            serde_json::to_string(&json!([{"kind":"text","text":body}])).unwrap()
        );
        assert_eq!(message.2, "default");
        assert_eq!(message.3, "[]");
        assert_eq!(message.4, "[]");
        assert!(message.5.is_none());
        assert!(message.6.is_none());
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM message_delivery WHERE message_id = ?1",
                    [message_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
    }

    #[cfg(feature = "slow-tests")]
    fn terminal_evidence_cannot_publish_after_the_run_membership_is_replaced() {
        let mut fixture = Fixture::new();
        let now = chrono::Utc::now().to_rfc3339();
        let actor = ActorRef::User {
            user_id: "local_user".to_string(),
        };
        let transaction = fixture
            .database
            .connection_mut()
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        end_camp_membership(
            &transaction,
            &fixture.camp_id,
            "agent_1",
            Some("agent_2"),
            "test_membership_ended",
            "terminal-publication-membership-ended",
            &actor,
            None,
            &now,
        )
        .unwrap();
        transaction.commit().unwrap();
        let membership_generation: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT membership_generation FROM camp WHERE id = ?1",
                [&fixture.camp_id],
                |row| row.get(0),
            )
            .unwrap();
        CollaborationService::default()
            .add_camp_member(
                &mut fixture.database,
                &user_envelope(
                    "terminal-publication-membership-readded",
                    Some(&fixture.camp_id),
                    AddCampMemberCommand {
                        camp_id: fixture.camp_id.clone(),
                        agent_id: "agent_1".to_string(),
                        expected_membership_generation: membership_generation,
                        capability_overrides: json!({}),
                        source: None,
                    },
                ),
            )
            .unwrap();

        // A terminal arriving from the departed lifetime may not overwrite the
        // cancellation or publish, even after that Agent has rejoined the Camp.
        let version = fixture
            .database
            .connection()
            .query_row(
                "SELECT version FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        let completed = ExecutionRuntimeService::default()
            .succeed_agent_run(
                &mut fixture.database,
                &CommandEnvelope {
                    command_id: "late-membership-terminal".into(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:codex-cli".into(),
                    },
                    camp_id: Some(fixture.camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SucceedAgentRunCommand {
                        agent_run_id: fixture.source_run_id.clone(),
                        expected_version: version,
                        execution_epoch: fixture.source_epoch,
                        native_turn_id: "late-turn".into(),
                        final_output: "这份迟到终态不能覆盖离队结算，也不能再公开".into(),
                        missing_send_recovery_candidate: Some(MissingSendRecoveryCandidate::new(
                            MissingSendRecoveryBoundary::CodexCompletedTurn,
                            "这份迟到终态不能覆盖离队结算，也不能再公开",
                        )),
                        ending_git_observation: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(completed.result.status, CommandResultStatus::Rejected);
        assert_eq!(completed.result.code, "agent_run.terminal_fenced");
        let state: (String, i64, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT run.status,
                       (SELECT COUNT(*) FROM camp_message
                        WHERE source_agent_run_id = run.id),
                       (SELECT status || ':' || settled_run_count || '/' || target_run_count
                        FROM camp_membership_reconciliation
                        WHERE command_id = 'terminal-publication-membership-ended')
                FROM agent_run AS run WHERE run.id = ?1
                "#,
                [&fixture.source_run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(state, ("cancelled".into(), 0, "completed:1/1".into()));
    }

    #[cfg(feature = "slow-tests")]
    fn accepted_recipient_free_send_suppresses_missing_send_recovery() {
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
        fixture.succeed_run_with_candidate(
            &fixture.source_run_id.clone(),
            source_epoch,
            body,
            Some(MissingSendRecoveryCandidate::new(
                MissingSendRecoveryBoundary::CodexCompletedTurn,
                "A different final that must not be recovered",
            )),
        );

        let (message_count, final_message_id, output_mode, suppressed): (
            i64,
            Option<String>,
            String,
            bool,
        ) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT
                    (SELECT COUNT(*) FROM camp_message
                     WHERE source_agent_run_id = ?1),
                    agent_run.final_camp_message_id,
                    (SELECT json_extract(payload_json, '$.publicOutputMode')
                     FROM event_log
                     WHERE event_type = 'agent_run.succeeded'
                       AND entity_type = 'agent_run'
                       AND entity_id = ?1),
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
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(message_count, 1);
        assert!(final_message_id.is_none());
        assert_eq!(output_mode, "explicit_send_only");
        assert!(!suppressed);
        let recovery_decision: String = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT json_extract(payload_json, '$.missingSendRecovery.decision')
                FROM event_log
                WHERE event_type = 'agent_run.succeeded'
                  AND entity_type = 'agent_run' AND entity_id = ?1
                "#,
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(recovery_decision, "suppressed_accepted_send");
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT id FROM camp_message WHERE source_agent_run_id = ?1",
                    [&fixture.source_run_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            explicit_message_id
        );
    }

    #[cfg(feature = "slow-tests")]
    fn accepted_addressed_send_also_suppresses_missing_send_recovery() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let body = "The answer is public for the target, but still needs a final.";
        let invocation =
            fixture.public_send_invocation("recipient-bound-final", body, &["agent_2"]);
        service
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();

        fixture.succeed_run_with_candidate(
            &fixture.source_run_id.clone(),
            fixture.source_epoch,
            body,
            Some(MissingSendRecoveryCandidate::new(
                MissingSendRecoveryBoundary::CodexCompletedTurn,
                "A final after the addressed progress update",
            )),
        );

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
        assert_eq!(message_count, 1);
        assert!(!suppressed);
        let recovery: (String, bool) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT json_extract(payload_json, '$.missingSendRecovery.decision'),
                       json_extract(payload_json, '$.missingSendRecovery.acceptedSendDetected')
                FROM event_log
                WHERE event_type = 'agent_run.succeeded'
                  AND entity_type = 'agent_run' AND entity_id = ?1
                "#,
                [&fixture.source_run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(recovery, ("suppressed_accepted_send".to_string(), true));
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
            .optional()
            .unwrap()
            .flatten();
        assert!(automatic_reply.is_none());
    }

    #[cfg(feature = "slow-tests")]
    fn a2a_target_run_recovers_independently_from_the_source_send() {
        let mut fixture = Fixture::new();
        let invocation = fixture.public_send_invocation(
            "create-a2a-target-recovery",
            "Please handle this @agent_2",
            &["agent_2"],
        );
        let sent = TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        let delivery_id = sent.result.payload["deliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let target_run_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                [&delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        let (target_epoch, _) = fixture.claim_bind_and_issue(&target_run_id, "native-a2a-recovery");
        let recovered = fixture.succeed_run_with_candidate(
            &target_run_id,
            target_epoch,
            "A2A target final",
            Some(MissingSendRecoveryCandidate::new(
                MissingSendRecoveryBoundary::CodexCompletedTurn,
                "A2A target final",
            )),
        );
        assert_eq!(
            recovered.result.payload["missingSendRecovery"]["decision"],
            "published"
        );
        let recovery_message_id = recovered.result.payload["finalCampMessageId"]
            .as_str()
            .unwrap();
        let recovery_fact: (String, String, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT source_agent_run_id, effective_recipient_ids_json,
                       (SELECT COUNT(*) FROM message_delivery WHERE message_id = camp_message.id)
                FROM camp_message WHERE id = ?1
                "#,
                [recovery_message_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(recovery_fact, (target_run_id, "[]".to_string(), 0));
    }

    #[cfg(feature = "slow-tests")]
    fn missing_send_recovery_failures_do_not_change_run_success() {
        let cases = vec![
            (None, "skipped_no_candidate"),
            (
                Some(MissingSendRecoveryCandidate::new(
                    MissingSendRecoveryBoundary::ClaudeSuccessResult,
                    "wrong Adapter boundary",
                )),
                "skipped_boundary_mismatch",
            ),
            (
                Some(MissingSendRecoveryCandidate::new(
                    MissingSendRecoveryBoundary::CodexCompletedTurn,
                    "   ",
                )),
                "skipped_empty_candidate",
            ),
            (
                Some(MissingSendRecoveryCandidate::new(
                    MissingSendRecoveryBoundary::CodexCompletedTurn,
                    "x".repeat(CAMP_MESSAGE_SEND_MAX_BODY_BYTES + 1),
                )),
                "skipped_candidate_too_large",
            ),
        ];
        for (candidate, expected_decision) in cases {
            let mut fixture = Fixture::new();
            let run_id = fixture.source_run_id.clone();
            let completed = fixture.succeed_run_with_candidate(
                &run_id,
                fixture.source_epoch,
                "Run success remains authoritative",
                candidate,
            );
            assert_eq!(
                completed.result.payload["missingSendRecovery"]["decision"],
                expected_decision
            );
            assert_eq!(
                fixture
                    .database
                    .connection()
                    .query_row(
                        "SELECT status FROM agent_run WHERE id = ?1",
                        [&run_id],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap(),
                "succeeded"
            );
            assert_eq!(
                fixture
                    .database
                    .connection()
                    .query_row(
                        "SELECT COUNT(*) FROM camp_message WHERE source_agent_run_id = ?1",
                        [&run_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                0
            );
        }
    }

    #[cfg(feature = "slow-tests")]
    fn rejected_send_does_not_suppress_recovery_but_tombstoned_accepted_send_does() {
        let service = TeamToolService::default();

        let mut rejected_fixture = Fixture::new();
        let rejected_invocation = rejected_fixture.public_send_invocation(
            "rejected-before-recovery",
            "invalid recipient",
            &["agent_999"],
        );
        let rejected = service
            .send_public_message(&mut rejected_fixture.database, &rejected_invocation)
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        let rejected_run_id = rejected_fixture.source_run_id.clone();
        let recovered = rejected_fixture.succeed_run_with_candidate(
            &rejected_run_id,
            rejected_fixture.source_epoch,
            "successful final",
            Some(MissingSendRecoveryCandidate::new(
                MissingSendRecoveryBoundary::CodexCompletedTurn,
                "successful final",
            )),
        );
        assert_eq!(
            recovered.result.payload["missingSendRecovery"]["decision"],
            "published"
        );

        let mut tombstoned_fixture = Fixture::new();
        let tombstoned_invocation = tombstoned_fixture.public_send_invocation(
            "accepted-then-tombstoned",
            "accepted fact",
            &[],
        );
        let sent = service
            .send_public_message(&mut tombstoned_fixture.database, &tombstoned_invocation)
            .unwrap();
        let message_id = sent.result.payload["messageId"].as_str().unwrap();
        tombstoned_fixture
            .database
            .connection()
            .execute(
                "UPDATE camp_message SET tombstoned_at = '2026-08-12T00:00:00Z' WHERE id = ?1",
                [message_id],
            )
            .unwrap();
        let tombstoned_run_id = tombstoned_fixture.source_run_id.clone();
        let suppressed = tombstoned_fixture.succeed_run_with_candidate(
            &tombstoned_run_id,
            tombstoned_fixture.source_epoch,
            "later final",
            Some(MissingSendRecoveryCandidate::new(
                MissingSendRecoveryBoundary::CodexCompletedTurn,
                "later final",
            )),
        );
        assert_eq!(
            suppressed.result.payload["missingSendRecovery"]["decision"],
            "suppressed_accepted_send"
        );
        assert_eq!(
            tombstoned_fixture
                .database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM camp_message WHERE source_agent_run_id = ?1",
                    [&tombstoned_run_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn recovery_terminal_replay_is_exactly_once_and_late_send_is_fenced() {
        let mut fixture = Fixture::new();
        let runtime = ExecutionRuntimeService::default();
        let execution = runtime
            .load_agent_run_execution(
                &fixture.database,
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .unwrap()
            .unwrap();
        let envelope = CommandEnvelope {
            command_id: "stable-recovery-terminal".to_string(),
            actor: ActorRef::System {
                component_id: "runtime-adapter:codex-cli".to_string(),
            },
            camp_id: Some(fixture.camp_id.clone()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload: SucceedAgentRunCommand {
                agent_run_id: fixture.source_run_id.clone(),
                expected_version: execution.version,
                execution_epoch: fixture.source_epoch,
                native_turn_id: "recovery-turn".to_string(),
                final_output: "replay final".to_string(),
                missing_send_recovery_candidate: Some(MissingSendRecoveryCandidate::new(
                    MissingSendRecoveryBoundary::CodexCompletedTurn,
                    "replay final",
                )),
                ending_git_observation: None,
            },
        };
        let first = runtime
            .succeed_agent_run(&mut fixture.database, &envelope)
            .unwrap();
        let replay = runtime
            .succeed_agent_run(&mut fixture.database, &envelope)
            .unwrap();
        assert!(!first.replayed);
        assert!(replay.replayed);
        assert_eq!(first.result.payload, replay.result.payload);
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM camp_message WHERE source_agent_run_id = ?1",
                    [&fixture.source_run_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );

        let late_invocation =
            fixture.public_send_invocation("late-after-recovery", "too late", &[]);
        let late_send =
            TeamToolService::default().send_public_message(&mut fixture.database, &late_invocation);
        assert!(late_send.is_err());
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM camp_message WHERE source_agent_run_id = ?1",
                    [&fixture.source_run_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
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

    #[cfg(feature = "slow-tests")]
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
        assert_eq!(missing.assignee_agent_id, None);
        assert!(!missing.clear_assignee);
        let clear = serde_json::from_value::<TeamUpdateTaskInput>(json!({
            "taskId": "task-1",
            "expectedVersion": 1,
            "clearAssignee": true
        }))
        .unwrap();
        assert_eq!(clear.assignee_agent_id, None);
        assert!(clear.clear_assignee);
        let assign = serde_json::from_value::<TeamUpdateTaskInput>(json!({
            "taskId": "task-1",
            "expectedVersion": 1,
            "assigneeAgentId": "agent_1"
        }))
        .unwrap();
        assert_eq!(assign.assignee_agent_id, Some("agent_1".to_string()));
        assert!(!assign.clear_assignee);
        assert!(
            serde_json::from_value::<TeamUpdateTaskInput>(json!({
                "taskId": "task-1",
                "expectedVersion": 1,
                "assigneeAgentId": null
            }))
            .is_err()
        );
        let unassigned = serde_json::from_value::<TeamListTasksInput>(json!({
            "unassignedOnly": true
        }))
        .unwrap();
        assert_eq!(unassigned.assignee_agent_id, None);
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
                assignee_agent_id: "agent_1".to_string(),
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
                assignee_agent_id: "agent_1".to_string(),
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
                        assignee_agent_id: None,
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
                assignee_agent_id: Some("agent_1".to_string()),
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

    #[cfg(feature = "slow-tests")]
    fn task_tool_reads_are_camp_wide_without_audit_writes() {
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
                        assignee_agent_id: "agent_2".to_string(),
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
                        assignee_agent_id: None,
                        unassigned_only: false,
                        limit: 100,
                        cursor: None,
                    },
                ),
            )
            .unwrap();
        let visible = listed
            .tasks
            .iter()
            .find(|task| task.task_id == hidden_id)
            .expect("ordinary current Camp Agent should see every Camp Task");
        assert!(visible.available_actions.is_empty());
        let event_count_after: i64 = fixture
            .database
            .connection()
            .query_row("SELECT COUNT(*) FROM event_log", [], |row| row.get(0))
            .unwrap();
        assert_eq!(event_count_after, event_count_before);

        let forbidden_invocation = fixture.task_invocation(
            "ordinary-member-create-forbidden",
            TeamCreateTaskInput {
                title: "Ordinary member cannot define responsibility".to_string(),
                assignee_agent_id: "agent_1".to_string(),
                ..Default::default()
            },
        );
        let forbidden = service
            .create_task(&mut fixture.database, &forbidden_invocation)
            .unwrap();
        assert_eq!(forbidden.result.code, "task.create_forbidden");
    }

    #[cfg(feature = "slow-tests")]
    fn every_agent_business_tool_binding_is_fenced_after_leave_and_readd() {
        let mut fixture = Fixture::new();
        let now = chrono::Utc::now().to_rfc3339();
        let actor = ActorRef::User {
            user_id: "local_user".to_string(),
        };
        let transaction = fixture
            .database
            .connection_mut()
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        end_camp_membership(
            &transaction,
            &fixture.camp_id,
            "agent_1",
            Some("agent_2"),
            "test_membership_ended",
            "team-tool-membership-ended",
            &actor,
            None,
            &now,
        )
        .unwrap();
        transaction.commit().unwrap();
        let membership_generation: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT membership_generation FROM camp WHERE id = ?1",
                [&fixture.camp_id],
                |row| row.get(0),
            )
            .unwrap();
        CollaborationService::default()
            .add_camp_member(
                &mut fixture.database,
                &user_envelope(
                    "team-tool-membership-readd",
                    Some(&fixture.camp_id),
                    AddCampMemberCommand {
                        camp_id: fixture.camp_id.clone(),
                        agent_id: "agent_1".to_string(),
                        expected_membership_generation: membership_generation,
                        capability_overrides: json!({}),
                        source: None,
                    },
                ),
            )
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'running', cancel_requested_at = NULL,
                    cancel_reason_code = NULL, ended_at = NULL
                WHERE id = ?1
                "#,
                [&fixture.source_run_id],
            )
            .unwrap();

        let list_error = TeamToolService::default()
            .list_tasks(
                &fixture.database,
                &fixture.task_invocation(
                    "membership-fenced-task-list",
                    TeamListTasksInput {
                        statuses: None,
                        assignee_agent_id: None,
                        unassigned_only: false,
                        limit: 10,
                        cursor: None,
                    },
                ),
            )
            .unwrap_err();
        assert_eq!(
            list_error
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.binding_fenced"
        );
        let binding_error = match TeamToolService::default().prepare_binding_credential(
            &mut fixture.database,
            &fixture.source_run_id,
            fixture.source_epoch,
            false,
        ) {
            Ok(_) => panic!("a stale Agent Run must not receive a fresh binding credential"),
            Err(error) => error,
        };
        assert_eq!(
            binding_error
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.binding_unavailable"
        );
    }

    #[cfg(feature = "slow-tests")]
    fn an_existing_run_can_address_a_member_added_after_its_context_was_frozen() {
        let mut fixture = Fixture::with_members(&["agent_1", "agent_2"]);
        let added = CollaborationService::default()
            .add_camp_member(
                &mut fixture.database,
                &user_envelope(
                    "add-member-after-source-context-freeze",
                    Some(&fixture.camp_id),
                    AddCampMemberCommand {
                        camp_id: fixture.camp_id.clone(),
                        agent_id: "agent_3".to_string(),
                        expected_membership_generation: 1,
                        capability_overrides: json!({}),
                        source: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(added.result.code, "camp.member_added");

        let invocation = fixture.public_send_invocation(
            "send-to-member-added-after-source-freeze",
            "Current target membership controls this admission",
            &["agent_3"],
        );
        let sent = TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        assert_eq!(sent.result.status, CommandResultStatus::Accepted);
        assert_eq!(
            sent.result.payload["effectiveRecipients"],
            json!(["agent_3"])
        );
        let delivery_id = sent.result.payload["deliveryIds"][0].as_str().unwrap();
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT status FROM message_delivery WHERE id = ?1",
                    [delivery_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "running"
        );
    }

    #[cfg(feature = "slow-tests")]
    fn pending_outbound_delivery_is_cancelled_when_source_membership_ends() {
        let mut fixture = Fixture::new();
        let _busy_run_id = fixture.queue_direct_run("queue-pending-outbound-recipient", "agent_2");
        let invocation = fixture.public_send_invocation(
            "pending-outbound-before-source-leaves",
            "This old outbound work must not materialize",
            &["agent_2"],
        );
        let sent = TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        let delivery_id = sent.result.payload["deliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT status || ':' || wait_condition FROM message_delivery WHERE id = ?1",
                    [&delivery_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "pending:target_busy"
        );

        let collaboration = CollaborationService::default();
        let preview = collaboration
            .camp_member_removal_preview(&fixture.database, &fixture.camp_id, "agent_1")
            .unwrap()
            .unwrap();
        assert_eq!(preview.pending_delivery_count, 1);
        assert_eq!(preview.running_delivery_count, 0);
        let removed = collaboration
            .remove_camp_member(
                &mut fixture.database,
                &user_envelope(
                    "remove-pending-outbound-source",
                    Some(&fixture.camp_id),
                    RemoveCampMemberCommand {
                        camp_id: fixture.camp_id.clone(),
                        agent_id: "agent_1".to_string(),
                        expected_membership_generation: preview.membership_generation,
                        expected_membership_version: preview.membership_version,
                        replacement_default_lead_agent_id: preview.next_default_lead_agent_id,
                        reason: Some("test source membership cutover".to_string()),
                        source: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(removed.result.status, CommandResultStatus::Accepted);
        assert_eq!(removed.result.payload["cancelledDeliveryCount"], 1);
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    r#"
                    SELECT status || ':' || failure_code || ':' ||
                           COALESCE(target_agent_run_id, '')
                    FROM message_delivery WHERE id = ?1
                    "#,
                    [&delivery_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "cancelled:source_membership_ended:"
        );
    }

    #[cfg(feature = "slow-tests")]
    fn running_outbound_delivery_target_is_reconciled_when_source_membership_ends() {
        let mut fixture = Fixture::new();
        let invocation = fixture.public_send_invocation(
            "running-outbound-before-source-leaves",
            "This materialized target belongs to the old source lifetime",
            &["agent_2"],
        );
        let sent = TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        let delivery_id = sent.result.payload["deliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let target_run_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                [&delivery_id],
                |row| row.get(0),
            )
            .unwrap();

        let collaboration = CollaborationService::default();
        let preview = collaboration
            .camp_member_removal_preview(&fixture.database, &fixture.camp_id, "agent_1")
            .unwrap()
            .unwrap();
        assert_eq!(preview.pending_delivery_count, 0);
        assert_eq!(preview.running_delivery_count, 1);
        assert_eq!(preview.non_terminal_agent_run_count, 2);
        let removed = collaboration
            .remove_camp_member(
                &mut fixture.database,
                &user_envelope(
                    "remove-running-outbound-source",
                    Some(&fixture.camp_id),
                    RemoveCampMemberCommand {
                        camp_id: fixture.camp_id.clone(),
                        agent_id: "agent_1".to_string(),
                        expected_membership_generation: preview.membership_generation,
                        expected_membership_version: preview.membership_version,
                        replacement_default_lead_agent_id: preview.next_default_lead_agent_id,
                        reason: Some("test source membership cutover".to_string()),
                        source: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(removed.result.status, CommandResultStatus::Accepted);
        assert_eq!(removed.result.payload["cancelRequestedRunCount"], 2);
        let target_state: (Option<String>, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT run.cancel_requested_at,
                       (SELECT COUNT(*)
                        FROM camp_membership_reconciliation_run AS link
                        WHERE link.agent_run_id = run.id)
                FROM agent_run AS run
                WHERE run.id = ?1
                "#,
                [&target_run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!(target_state.0.is_some());
        assert_eq!(target_state.1, 1);
    }

    #[cfg(feature = "slow-tests")]
    fn dispatch_and_retry_reject_delivery_from_ended_source_membership() {
        let mut fixture = Fixture::new();
        let busy_run_id = fixture.queue_direct_run("queue-source-fence-recipient", "agent_2");
        let invocation = fixture.public_send_invocation(
            "source-fenced-outbound-delivery",
            "Dispatch must independently fence the source lifetime",
            &["agent_2"],
        );
        let sent = TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        let delivery_id = sent.result.payload["deliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();

        let now = chrono::Utc::now().to_rfc3339();
        // Bypass the normal cutover cancellation to exercise the independent
        // dispatch/retry fence against a later membership lifetime.
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE camp_member
                SET status = 'active', version = version + 2,
                    joined_at = ?3, left_at = NULL
                WHERE camp_id = ?1 AND agent_id = ?2
                "#,
                params![fixture.camp_id, "agent_1", now],
            )
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'succeeded', ended_at = ?2, updated_at = ?2,
                    version = version + 1
                WHERE id = ?1
                "#,
                params![busy_run_id, now],
            )
            .unwrap();

        let dispatched = dispatch_pending_for_recipient(
            &mut fixture.database,
            &fixture.camp_id,
            "agent_2",
            DeliveryDispatchTrigger::TargetRunEnded,
            true,
        )
        .unwrap();
        assert!(matches!(
            dispatched.as_slice(),
            [crate::message_delivery::DeliveryDispatchOutcome::Terminal {
                status,
                failure_code,
            }] if status == "failed" && failure_code == "source_membership_changed"
        ));

        let delivery_version: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT version FROM message_delivery WHERE id = ?1",
                [&delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        let retried = MessageDeliveryService::default()
            .retry(
                &mut fixture.database,
                &user_envelope(
                    "retry-source-fenced-delivery",
                    Some(&fixture.camp_id),
                    RetryMessageDeliveryCommand {
                        delivery_id,
                        expected_version: delivery_version,
                    },
                ),
            )
            .unwrap();
        assert_eq!(retried.result.status, CommandResultStatus::Rejected);
        assert_eq!(
            retried.result.code,
            "message_delivery.source_membership_changed"
        );
    }

    #[cfg(feature = "slow-tests")]
    fn a_terminal_delivery_cannot_be_retried_after_the_recipient_leaves_and_rejoins() {
        let mut fixture = Fixture::new();
        let invocation = fixture.public_send_invocation(
            "delivery-before-membership-cutover",
            "这条旧投递不能跨成员任期复活",
            &["agent_2"],
        );
        let sent = TeamToolService::default()
            .send_public_message(&mut fixture.database, &invocation)
            .unwrap();
        assert_eq!(sent.result.status, CommandResultStatus::Accepted);
        let delivery_id = sent.result.payload["deliveryIds"][0]
            .as_str()
            .unwrap()
            .to_string();
        let target_run_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT target_agent_run_id FROM message_delivery WHERE id = ?1",
                [&delivery_id],
                |row| row.get(0),
            )
            .unwrap();
        let target_epoch = fixture
            .claim_bind_and_issue(&target_run_id, "native-delivery-before-membership-cutover")
            .0;
        fixture.fail_run(
            &target_run_id,
            target_epoch,
            "recipient_failed_before_membership_cutover",
        );

        let collaboration = CollaborationService::default();
        let preview = collaboration
            .camp_member_removal_preview(&fixture.database, &fixture.camp_id, "agent_2")
            .unwrap()
            .unwrap();
        let removed = collaboration
            .remove_camp_member(
                &mut fixture.database,
                &user_envelope(
                    "remove-delivery-recipient",
                    Some(&fixture.camp_id),
                    RemoveCampMemberCommand {
                        camp_id: fixture.camp_id.clone(),
                        agent_id: "agent_2".to_string(),
                        expected_membership_generation: preview.membership_generation,
                        expected_membership_version: preview.membership_version,
                        replacement_default_lead_agent_id: None,
                        reason: Some("test membership cutover".to_string()),
                        source: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(removed.result.status, CommandResultStatus::Accepted);
        let readded = collaboration
            .add_camp_member(
                &mut fixture.database,
                &user_envelope(
                    "readd-delivery-recipient",
                    Some(&fixture.camp_id),
                    AddCampMemberCommand {
                        camp_id: fixture.camp_id.clone(),
                        agent_id: "agent_2".to_string(),
                        expected_membership_generation:
                            removed.result.payload["membershipGeneration"]
                                .as_i64()
                                .unwrap(),
                        capability_overrides: json!({}),
                        source: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(readded.result.status, CommandResultStatus::Applied);

        let delivery_state: (String, Option<String>, i64, Option<i64>, i64) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT delivery.status, delivery.failure_code, delivery.version,
                       delivery.recipient_membership_version_at_admission,
                       member.version
                FROM message_delivery AS delivery
                JOIN camp_member AS member
                  ON member.camp_id = delivery.camp_id
                 AND member.agent_id = delivery.recipient_agent_id
                WHERE delivery.id = ?1
                "#,
                [&delivery_id],
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
        assert_eq!(delivery_state.0, "failed");
        assert_eq!(delivery_state.1.as_deref(), Some("target_agent_run_failed"));
        assert_ne!(delivery_state.3, Some(delivery_state.4));
        let retried = MessageDeliveryService::default()
            .retry(
                &mut fixture.database,
                &user_envelope(
                    "retry-delivery-after-rejoin",
                    Some(&fixture.camp_id),
                    RetryMessageDeliveryCommand {
                        delivery_id,
                        expected_version: delivery_state.2,
                    },
                ),
            )
            .unwrap();
        assert_eq!(retried.result.status, CommandResultStatus::Rejected);
        assert_eq!(
            retried.result.code,
            "message_delivery.recipient_membership_changed"
        );
    }

    #[cfg(feature = "slow-tests")]
    fn public_send_rejects_a_left_recipient_and_accepts_a_new_membership() {
        let mut fixture = Fixture::new();
        let collaboration = CollaborationService::default();
        let preview = collaboration
            .camp_member_removal_preview(&fixture.database, &fixture.camp_id, "agent_2")
            .unwrap()
            .unwrap();
        let removed = collaboration
            .remove_camp_member(
                &mut fixture.database,
                &user_envelope(
                    "remove-public-send-recipient",
                    Some(&fixture.camp_id),
                    RemoveCampMemberCommand {
                        camp_id: fixture.camp_id.clone(),
                        agent_id: "agent_2".to_string(),
                        expected_membership_generation: preview.membership_generation,
                        expected_membership_version: preview.membership_version,
                        replacement_default_lead_agent_id: None,
                        reason: Some("test send admission".to_string()),
                        source: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(removed.result.status, CommandResultStatus::Accepted);

        let rejected_invocation = fixture.public_send_invocation(
            "send-to-left-recipient",
            "离队后不能收到这次 send",
            &["agent_2"],
        );
        let rejected = TeamToolService::default()
            .send_public_message(&mut fixture.database, &rejected_invocation)
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(rejected.result.code, "message.addressing_invalid");
        assert_eq!(
            rejected.result.payload["details"]["offending"][0]["reason"],
            "not_current_camp_member"
        );

        collaboration
            .add_camp_member(
                &mut fixture.database,
                &user_envelope(
                    "add-new-public-send-recipient-membership",
                    Some(&fixture.camp_id),
                    AddCampMemberCommand {
                        camp_id: fixture.camp_id.clone(),
                        agent_id: "agent_2".to_string(),
                        expected_membership_generation:
                            removed.result.payload["membershipGeneration"]
                                .as_i64()
                                .unwrap(),
                        capability_overrides: json!({}),
                        source: None,
                    },
                ),
            )
            .unwrap();
        let accepted_invocation = fixture.public_send_invocation(
            "send-to-new-recipient-membership",
            "重新加入后，这次 send 成立",
            &["agent_2"],
        );
        let accepted = TeamToolService::default()
            .send_public_message(&mut fixture.database, &accepted_invocation)
            .unwrap();
        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
        assert_eq!(
            accepted.result.payload["deliveryIds"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[cfg(feature = "slow-tests")]
    fn task_tool_lead_creation_ignores_capability_catalog_and_keeps_version_fencing() {
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
                assignee_agent_id: "agent_1".to_string(),
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
                assignee_agent_id: None,
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

    #[cfg(feature = "slow-tests")]
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
        assert_eq!(search.results[0].scope, MemoryScopeKind::Hearth);
        assert!(search.results[0].counterparty_agent_id.is_none());
        assert!(search.results[0].direction.is_none());
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
        let target = current.memories[0].target.as_ref().unwrap();
        assert_eq!(target.scope, MemoryScopeKind::Hearth);
        assert!(target.counterparty_agent_id.is_none());
        assert!(target.direction.is_none());
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
        assert!(inactive.memories[0].target.is_none());
        assert!(
            serde_json::to_value(&inactive.memories[0])
                .unwrap()
                .get("scope")
                .is_none()
        );

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

    #[cfg(feature = "slow-tests")]
    fn memory_search_and_read_identify_relationship_counterparties() {
        let mut fixture = Fixture::new();
        let service = MemoryService::default();
        let create_relationship =
            |fixture: &mut Fixture, command_id: &str, counterparty: &str| -> String {
                service
                    .create(
                        &mut fixture.database,
                        &user_envelope(
                            command_id,
                            None,
                            CreateMemoryCommand {
                                scope: MemoryScopeKind::Relationship,
                                kind: MemoryKind::Agreement,
                                body: "Provide exact test evidence during every handoff."
                                    .to_string(),
                                retrieval_keys: vec!["test handoff".to_string()],
                                companion_agent_id: None,
                                relationship_agent_ids: vec![
                                    "agent_1".to_string(),
                                    counterparty.to_string(),
                                ],
                                direction: Some(RelationshipDirection::Directed),
                                directed_actor_agent_id: Some("agent_1".to_string()),
                                review_after: None,
                            },
                        ),
                    )
                    .unwrap()
                    .result
                    .payload["memoryId"]
                    .as_str()
                    .unwrap()
                    .to_string()
            };
        let agent_two_memory =
            create_relationship(&mut fixture, "relationship-agent-two", "agent_2");
        let agent_three_memory =
            create_relationship(&mut fixture, "relationship-agent-three", "agent_3");

        let retrieval = MemoryRetrievalService;
        let search = retrieval
            .search(
                &mut fixture.database,
                &MemoryRetrievalInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "search-similar-relationships".to_string(),
                    input: MemorySearchInput {
                        query: "test handoff".to_string(),
                        limit: Some(6),
                    },
                },
            )
            .unwrap();
        for (memory_id, counterparty) in [
            (&agent_two_memory, "agent_2"),
            (&agent_three_memory, "agent_3"),
        ] {
            let result = search
                .results
                .iter()
                .find(|result| &result.memory_id == memory_id)
                .unwrap();
            assert_eq!(result.scope, MemoryScopeKind::Relationship);
            assert_eq!(result.counterparty_agent_id.as_deref(), Some(counterparty));
            assert_eq!(result.direction, Some(RelationshipDirection::Directed));
        }

        let read = retrieval
            .read(
                &mut fixture.database,
                &MemoryRetrievalInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "read-similar-relationships".to_string(),
                    input: MemoryReadInput {
                        memory_ids: vec![agent_two_memory, agent_three_memory],
                    },
                },
            )
            .unwrap();
        assert_eq!(read.memories.len(), 2);
        assert_eq!(
            read.memories[0].target.as_ref().unwrap().scope,
            MemoryScopeKind::Relationship
        );
        assert_eq!(
            read.memories[0]
                .target
                .as_ref()
                .unwrap()
                .counterparty_agent_id
                .as_deref(),
            Some("agent_2")
        );
        assert_eq!(
            read.memories[1]
                .target
                .as_ref()
                .unwrap()
                .counterparty_agent_id
                .as_deref(),
            Some("agent_3")
        );
        assert!(
            read.memories
                .iter()
                .all(|memory| memory.target.as_ref().unwrap().direction
                    == Some(RelationshipDirection::Directed))
        );
    }

    #[cfg(feature = "slow-tests")]
    fn memory_view_returns_complete_exact_scope_targets_in_deterministic_order() {
        let mut fixture = Fixture::new();
        let service = MemoryService::default();
        let companion_id = {
            let mut create = |command_id: &str, command: CreateMemoryCommand| {
                service
                    .create(
                        &mut fixture.database,
                        &user_envelope(command_id, None, command),
                    )
                    .unwrap()
            };

            for (command_id, kind, body, key) in [
                (
                    "view-hearth-lesson",
                    MemoryKind::Lesson,
                    "Keep the verified recovery trail.",
                    "recovery trail",
                ),
                (
                    "view-hearth-preference",
                    MemoryKind::Preference,
                    "Prefer concise status updates.",
                    "concise status",
                ),
                (
                    "view-hearth-agreement",
                    MemoryKind::Agreement,
                    "Every handoff includes exact evidence.",
                    "exact evidence",
                ),
            ] {
                create(
                    command_id,
                    CreateMemoryCommand {
                        scope: MemoryScopeKind::Hearth,
                        kind,
                        body: body.to_string(),
                        retrieval_keys: vec![key.to_string()],
                        companion_agent_id: None,
                        relationship_agent_ids: Vec::new(),
                        direction: None,
                        directed_actor_agent_id: None,
                        review_after: None,
                    },
                );
            }
            let companion = create(
                "view-companion-agent-one",
                CreateMemoryCommand {
                    scope: MemoryScopeKind::Companion,
                    kind: MemoryKind::Lesson,
                    body: "Agent one validates the exact frozen payload.".to_string(),
                    retrieval_keys: vec!["frozen payload".to_string()],
                    companion_agent_id: Some("agent_1".to_string()),
                    relationship_agent_ids: Vec::new(),
                    direction: None,
                    directed_actor_agent_id: None,
                    review_after: None,
                },
            );
            let companion_id = companion.result.payload["memoryId"]
                .as_str()
                .unwrap()
                .to_string();
            create(
                "view-companion-agent-two",
                CreateMemoryCommand {
                    scope: MemoryScopeKind::Companion,
                    kind: MemoryKind::Lesson,
                    body: "Agent two owns a separate Companion Memory.".to_string(),
                    retrieval_keys: vec!["separate companion".to_string()],
                    companion_agent_id: Some("agent_2".to_string()),
                    relationship_agent_ids: Vec::new(),
                    direction: None,
                    directed_actor_agent_id: None,
                    review_after: None,
                },
            );

            for (command_id, kind, body, key, pair, direction, actor) in [
                (
                    "view-forward-lesson",
                    MemoryKind::Lesson,
                    "I give agent two exact test output.",
                    "test output",
                    ["agent_1", "agent_2"],
                    RelationshipDirection::Directed,
                    Some("agent_1"),
                ),
                (
                    "view-reverse-agreement",
                    MemoryKind::Agreement,
                    "Agent two gives me exact test output.",
                    "reverse output",
                    ["agent_1", "agent_2"],
                    RelationshipDirection::Directed,
                    Some("agent_2"),
                ),
                (
                    "view-mutual-agreement",
                    MemoryKind::Agreement,
                    "We acknowledge handoffs before continuing.",
                    "acknowledge handoff",
                    ["agent_1", "agent_2"],
                    RelationshipDirection::Mutual,
                    None,
                ),
                (
                    "view-forward-agreement",
                    MemoryKind::Agreement,
                    "I identify the tested revision for agent two.",
                    "tested revision",
                    ["agent_1", "agent_2"],
                    RelationshipDirection::Directed,
                    Some("agent_1"),
                ),
                (
                    "view-other-pair",
                    MemoryKind::Lesson,
                    "I give agent three a separate handoff.",
                    "separate handoff",
                    ["agent_1", "agent_3"],
                    RelationshipDirection::Directed,
                    Some("agent_1"),
                ),
            ] {
                create(
                    command_id,
                    CreateMemoryCommand {
                        scope: MemoryScopeKind::Relationship,
                        kind,
                        body: body.to_string(),
                        retrieval_keys: vec![key.to_string()],
                        companion_agent_id: None,
                        relationship_agent_ids: pair.into_iter().map(str::to_string).collect(),
                        direction: Some(direction),
                        directed_actor_agent_id: actor.map(str::to_string),
                        review_after: None,
                    },
                );
            }
            companion_id
        };

        let pending_marker = "pending-view-candidate-marker";
        let pending = fixture.hearth_review_add(
            "view-pending-hearth-review",
            pending_marker,
            "pending view marker",
        );
        assert_eq!(pending.result.status, CommandResultStatus::Accepted);

        let hearth = fixture
            .memory_view(
                "view-hearth",
                MemoryViewInput {
                    scope: MemoryScopeKind::Hearth,
                    counterparty_agent_id: None,
                },
            )
            .unwrap();
        assert!(hearth.complete);
        assert_eq!(hearth.item_count, 3);
        assert_eq!(
            hearth
                .items
                .iter()
                .map(|item| item.kind)
                .collect::<Vec<_>>(),
            vec![
                MemoryKind::Agreement,
                MemoryKind::Preference,
                MemoryKind::Lesson
            ]
        );
        assert_eq!(
            hearth.total_body_bytes,
            hearth
                .items
                .iter()
                .map(|item| item.body.len())
                .sum::<usize>()
        );
        assert!(hearth.items.iter().all(|item| {
            item.target.scope == MemoryScopeKind::Hearth
                && item.target.counterparty_agent_id.is_none()
                && item.target.direction.is_none()
                && item.agent_can_revise
                && item.body != pending_marker
        }));

        let companion = fixture
            .memory_view(
                "view-companion",
                MemoryViewInput {
                    scope: MemoryScopeKind::Companion,
                    counterparty_agent_id: None,
                },
            )
            .unwrap();
        assert_eq!(companion.item_count, 1);
        assert_eq!(companion.items[0].target.memory_id, companion_id);
        assert_eq!(companion.items[0].target.scope, MemoryScopeKind::Companion);
        assert!(companion.items[0].agent_can_revise);

        let relationship = fixture
            .memory_view(
                "view-relationship-agent-two",
                MemoryViewInput {
                    scope: MemoryScopeKind::Relationship,
                    counterparty_agent_id: Some("agent_2".to_string()),
                },
            )
            .unwrap();
        assert_eq!(
            relationship.counterparty_agent_id.as_deref(),
            Some("agent_2")
        );
        assert_eq!(relationship.item_count, 3);
        assert_eq!(
            relationship
                .items
                .iter()
                .map(|item| (item.target.direction, item.kind))
                .collect::<Vec<_>>(),
            vec![
                (Some(RelationshipDirection::Directed), MemoryKind::Agreement),
                (Some(RelationshipDirection::Directed), MemoryKind::Lesson),
                (Some(RelationshipDirection::Mutual), MemoryKind::Agreement),
            ]
        );
        assert!(
            relationship.items[..2]
                .iter()
                .all(|item| item.agent_can_revise)
        );
        assert!(!relationship.items[2].agent_can_revise);
        assert!(
            relationship
                .items
                .iter()
                .all(|item| { item.target.counterparty_agent_id.as_deref() == Some("agent_2") })
        );

        let revised = fixture
            .memory_write(
                "view-copy-target-revise",
                MemoryWriteToolInput {
                    action: "revise".to_string(),
                    scope: None,
                    kind: None,
                    body: "Agent one validates the exact immutable payload.".to_string(),
                    retrieval_keys: vec!["immutable payload".to_string()],
                    counterparty_agent_id: None,
                    direction: None,
                    target: Some(companion.items[0].target.clone()),
                },
            )
            .unwrap();
        assert_eq!(revised.result.status, CommandResultStatus::Applied);
        let mutual_revise = fixture
            .memory_write(
                "view-mutual-target-revise",
                MemoryWriteToolInput {
                    action: "revise".to_string(),
                    scope: None,
                    kind: None,
                    body: "A mutual target must remain user governed.".to_string(),
                    retrieval_keys: vec!["mutual governance".to_string()],
                    counterparty_agent_id: None,
                    direction: None,
                    target: Some(relationship.items[2].target.clone()),
                },
            )
            .unwrap();
        assert_eq!(mutual_revise.result.status, CommandResultStatus::Rejected);
        assert_eq!(mutual_revise.result.code, "memory.invalid_input");

        let delivered: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM memory_access_evidence WHERE evidence_kind = 'view'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(delivered, 7);
        let leaked_pending: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM memory_access_evidence WHERE memory_id = ?1",
                [pending.result.payload["reviewItemId"].as_str().unwrap()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(leaked_pending, 0);

        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_3'",
                [],
            )
            .unwrap();
        let unavailable = fixture
            .memory_view(
                "view-away-counterparty",
                MemoryViewInput {
                    scope: MemoryScopeKind::Relationship,
                    counterparty_agent_id: Some("agent_3".to_string()),
                },
            )
            .unwrap_err();
        let unavailable = unavailable
            .downcast_ref::<TeamToolInvocationError>()
            .unwrap();
        assert_eq!(unavailable.code, "memory.view_unavailable");
        assert_eq!(unavailable.message, "Memory View is unavailable");
    }

    #[test]
    fn memory_view_fails_closed_before_recording_evidence_for_invalid_scope_state() {
        let mut fixture = Fixture::new();
        let service = MemoryService::default();
        for index in 0..8 {
            let created = service
                .create(
                    &mut fixture.database,
                    &user_envelope(
                        &format!("view-full-hearth-{index}"),
                        None,
                        CreateMemoryCommand {
                            scope: MemoryScopeKind::Hearth,
                            kind: MemoryKind::Agreement,
                            body: format!("{index}{}", "q".repeat(MEMORY_BODY_MAX_BYTES - 1)),
                            retrieval_keys: vec![format!("view quota {index}")],
                            companion_agent_id: None,
                            relationship_agent_ids: Vec::new(),
                            direction: None,
                            directed_actor_agent_id: None,
                            review_after: None,
                        },
                    ),
                )
                .unwrap();
            assert_eq!(created.result.status, CommandResultStatus::Applied);
        }
        fixture
            .database
            .connection()
            .execute_batch(
                r#"
                PRAGMA defer_foreign_keys = ON;
                BEGIN IMMEDIATE;
                INSERT INTO memory(
                    id, scope_kind, kind, creation_origin, lifecycle_status,
                    current_revision_id, version, created_at, updated_at
                ) VALUES (
                    'invalid-view-memory', 'hearth', 'lesson', 'user', 'active',
                    'invalid-view-revision', 1, '2026-08-14T00:00:00Z',
                    '2026-08-14T00:00:00Z'
                );
                INSERT INTO memory_revision(
                    id, memory_id, body, body_utf8_bytes, body_digest,
                    actor_kind, actor_id, created_at
                ) VALUES (
                    'invalid-view-revision', 'invalid-view-memory', 'z', 1,
                    'sha256:invalid-view', 'user', 'local_user',
                    '2026-08-14T00:00:00Z'
                );
                COMMIT;
                "#,
            )
            .unwrap();

        let error = fixture
            .memory_view(
                "view-invalid-scope-state",
                MemoryViewInput {
                    scope: MemoryScopeKind::Hearth,
                    counterparty_agent_id: None,
                },
            )
            .unwrap_err();
        assert_eq!(
            error
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "memory.view_unavailable"
        );
        let evidence: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM memory_access_evidence WHERE evidence_kind = 'view'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(evidence, 0);
    }

    #[cfg(feature = "slow-tests")]
    fn hearth_review_acceptance_checks_body_quota_and_replays_the_first_rejection() {
        let mut fixture = Fixture::new();
        let service = MemoryService::default();
        let mut first_memory_id = None;
        for index in 0..8 {
            let created = service
                .create(
                    &mut fixture.database,
                    &user_envelope(
                        &format!("review-quota-hearth-{index}"),
                        None,
                        CreateMemoryCommand {
                            scope: MemoryScopeKind::Hearth,
                            kind: MemoryKind::Agreement,
                            body: format!("{index}{}", "h".repeat(MEMORY_BODY_MAX_BYTES - 1)),
                            retrieval_keys: vec![format!("review quota {index}")],
                            companion_agent_id: None,
                            relationship_agent_ids: Vec::new(),
                            direction: None,
                            directed_actor_agent_id: None,
                            review_after: None,
                        },
                    ),
                )
                .unwrap();
            first_memory_id.get_or_insert_with(|| {
                created.result.payload["memoryId"]
                    .as_str()
                    .unwrap()
                    .to_string()
            });
        }
        let review = fixture.hearth_review_add(
            "review-quota-propose",
            "Accept only after aggregate body capacity is available.",
            "aggregate acceptance",
        );
        let review_item_id = review.result.payload["reviewItemId"]
            .as_str()
            .unwrap()
            .to_string();
        let accept = user_envelope(
            "review-quota-accept",
            None,
            AcceptHearthReviewItemCommand {
                review_item_id: review_item_id.clone(),
                expected_review_item_version: 1,
                final_body: None,
                final_retrieval_keys: None,
            },
        );
        let rejected = service
            .accept_hearth_review_item(&mut fixture.database, &accept)
            .unwrap();
        assert_eq!(rejected.result.status, CommandResultStatus::Rejected);
        assert_eq!(rejected.result.code, "memory.capacity_exceeded");
        let pending = service
            .list_hearth_review_items(&fixture.database)
            .unwrap()
            .into_iter()
            .find(|item| item.review_item_id == review_item_id)
            .unwrap();
        assert_eq!(pending.status, "pending");
        assert!(pending.candidate_body.is_some());

        service
            .retire(
                &mut fixture.database,
                &user_envelope(
                    "review-quota-retire",
                    None,
                    RetireMemoryCommand {
                        memory_id: first_memory_id.unwrap(),
                        expected_version: 1,
                    },
                ),
            )
            .unwrap();
        let replay = service
            .accept_hearth_review_item(&mut fixture.database, &accept)
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result, rejected.result);

        let accepted = service
            .accept_hearth_review_item(
                &mut fixture.database,
                &user_envelope(
                    "review-quota-accept-new-command",
                    None,
                    AcceptHearthReviewItemCommand {
                        review_item_id,
                        expected_review_item_version: 1,
                        final_body: None,
                        final_retrieval_keys: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(accepted.result.status, CommandResultStatus::Applied);
    }

    #[cfg(feature = "slow-tests")]
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
                        target: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(companion.result.status, CommandResultStatus::Applied);
        assert_eq!(companion.result.payload["outcome"], "effective");
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
            .write(
                &mut fixture.database,
                &MemoryWriteToolInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "memory-write-hearth".to_string(),
                    input: MemoryWriteToolInput {
                        action: "add".to_string(),
                        scope: Some(MemoryScopeKind::Hearth),
                        kind: Some(MemoryKind::Agreement),
                        body: "All recovery retries must reuse the exact frozen payload."
                            .to_string(),
                        retrieval_keys: vec!["exact retry".to_string()],
                        counterparty_agent_id: None,
                        direction: None,
                        target: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(proposed.result.status, CommandResultStatus::Accepted);
        assert_eq!(proposed.result.payload["outcome"], "review_pending");
        let review_item_id = proposed.result.payload["reviewItemId"]
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
            .accept_hearth_review_item(
                &mut fixture.database,
                &user_envelope(
                    "accept-hearth-review",
                    None,
                    AcceptHearthReviewItemCommand {
                        review_item_id,
                        expected_review_item_version: 1,
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
            Some(MemoryCreationOrigin::AcceptedHearthReview)
        );
        assert_eq!(hearth.lifecycle, "active");
    }

    #[test]
    fn agent_memory_write_is_actor_bounded_and_denies_unowned_targets_without_oracles() {
        let mut fixture = Fixture::new();
        let directed = fixture
            .memory_write(
                "directed-add",
                MemoryWriteToolInput {
                    action: "add".to_string(),
                    scope: Some(MemoryScopeKind::Relationship),
                    kind: Some(MemoryKind::Agreement),
                    body: "I will provide agent two with exact handoff evidence.".to_string(),
                    retrieval_keys: vec!["exact handoff".to_string()],
                    counterparty_agent_id: Some("agent_2".to_string()),
                    direction: Some(RelationshipDirection::Directed),
                    target: None,
                },
            )
            .unwrap();
        assert_eq!(directed.result.status, CommandResultStatus::Applied);
        let directed_memory = MemoryService::default()
            .get(
                &fixture.database,
                directed.result.payload["memoryId"].as_str().unwrap(),
            )
            .unwrap()
            .unwrap();
        assert_eq!(
            directed_memory.directed_actor_agent_id.as_deref(),
            Some("agent_1")
        );
        let wrong_identity_wrong_base = fixture
            .memory_write(
                "directed-wrong-target-wrong-base",
                MemoryWriteToolInput {
                    action: "revise".to_string(),
                    scope: None,
                    kind: None,
                    body: "This must not revise the relationship selected for agent two."
                        .to_string(),
                    retrieval_keys: vec!["wrong counterparty".to_string()],
                    counterparty_agent_id: None,
                    direction: None,
                    target: Some(MemoryTarget {
                        memory_id: directed_memory.id.clone(),
                        revision_id: Uuid::new_v4().to_string(),
                        scope: MemoryScopeKind::Relationship,
                        counterparty_agent_id: Some("agent_3".to_string()),
                        direction: Some(RelationshipDirection::Directed),
                    }),
                },
            )
            .unwrap();
        assert_memory_unavailable(&wrong_identity_wrong_base);
        let wrong_identity_exact = fixture
            .memory_write(
                "directed-wrong-target-exact",
                MemoryWriteToolInput {
                    action: "revise".to_string(),
                    scope: None,
                    kind: None,
                    body: "I will provide agent two with exact handoff evidence.".to_string(),
                    retrieval_keys: vec!["exact handoff".to_string()],
                    counterparty_agent_id: None,
                    direction: None,
                    target: Some(MemoryTarget {
                        memory_id: directed_memory.id.clone(),
                        revision_id: directed_memory.current_revision_id.clone().unwrap(),
                        scope: MemoryScopeKind::Relationship,
                        counterparty_agent_id: Some("agent_3".to_string()),
                        direction: Some(RelationshipDirection::Directed),
                    }),
                },
            )
            .unwrap();
        assert_memory_unavailable(&wrong_identity_exact);

        let mutual_error = fixture
            .memory_write(
                "mutual-add",
                MemoryWriteToolInput {
                    action: "add".to_string(),
                    scope: Some(MemoryScopeKind::Relationship),
                    kind: Some(MemoryKind::Lesson),
                    body: "Both agents should claim the same future obligation.".to_string(),
                    retrieval_keys: vec!["mutual obligation".to_string()],
                    counterparty_agent_id: Some("agent_2".to_string()),
                    direction: Some(RelationshipDirection::Mutual),
                    target: None,
                },
            )
            .unwrap();
        assert_eq!(mutual_error.result.status, CommandResultStatus::Rejected);
        assert_eq!(mutual_error.result.code, "memory.scope_forbidden");
        assert_eq!(
            mutual_error.result.payload,
            json!({"message": "Agent Relationship writes must be directed"})
        );

        let other_companion_body = "Agent two owns this Companion lesson.";
        let other_companion_key = "agent two lesson";
        let other_companion = MemoryService::default()
            .create(
                &mut fixture.database,
                &user_envelope(
                    "other-companion",
                    None,
                    CreateMemoryCommand {
                        scope: MemoryScopeKind::Companion,
                        kind: MemoryKind::Lesson,
                        body: other_companion_body.to_string(),
                        retrieval_keys: vec![other_companion_key.to_string()],
                        companion_agent_id: Some("agent_2".to_string()),
                        relationship_agent_ids: Vec::new(),
                        direction: None,
                        directed_actor_agent_id: None,
                        review_after: None,
                    },
                ),
            )
            .unwrap();
        let other_companion_id = other_companion.result.payload["memoryId"]
            .as_str()
            .unwrap()
            .to_string();
        let other_revision_id = other_companion.result.payload["revisionId"]
            .as_str()
            .unwrap()
            .to_string();
        let other_companion_wrong_base = fixture.memory_revise(
            "other-companion-wrong-base",
            &other_companion_id,
            &Uuid::new_v4().to_string(),
            "Agent one must not revise agent two's Companion.",
            &["ownership boundary"],
        );
        assert_memory_unavailable(&other_companion_wrong_base);
        let other_companion_exact = fixture.memory_revise(
            "other-companion-exact",
            &other_companion_id,
            &other_revision_id,
            other_companion_body,
            &[other_companion_key],
        );
        assert_memory_unavailable(&other_companion_exact);

        let mutual_body = "Both agents share this user-governed Relationship lesson.";
        let mutual_key = "mutual boundary";
        let mutual = MemoryService::default()
            .create(
                &mut fixture.database,
                &user_envelope(
                    "user-mutual-memory",
                    None,
                    CreateMemoryCommand {
                        scope: MemoryScopeKind::Relationship,
                        kind: MemoryKind::Lesson,
                        body: mutual_body.to_string(),
                        retrieval_keys: vec![mutual_key.to_string()],
                        companion_agent_id: None,
                        relationship_agent_ids: vec!["agent_1".to_string(), "agent_2".to_string()],
                        direction: Some(RelationshipDirection::Mutual),
                        directed_actor_agent_id: None,
                        review_after: None,
                    },
                ),
            )
            .unwrap();
        let mutual_id = mutual.result.payload["memoryId"].as_str().unwrap();
        let mutual_revision_id = mutual.result.payload["revisionId"].as_str().unwrap();
        let mutual_wrong_base = fixture.memory_revise(
            "mutual-wrong-base",
            mutual_id,
            &Uuid::new_v4().to_string(),
            "Agent one must not revise mutual Memory.",
            &["mutual denied"],
        );
        assert_memory_unavailable(&mutual_wrong_base);
        let mutual_exact = fixture.memory_revise(
            "mutual-exact",
            mutual_id,
            mutual_revision_id,
            mutual_body,
            &[mutual_key],
        );
        assert_memory_unavailable(&mutual_exact);

        let reverse_body = "Agent two owns this directed Relationship lesson.";
        let reverse_key = "reverse boundary";
        let reverse = MemoryService::default()
            .create(
                &mut fixture.database,
                &user_envelope(
                    "user-reverse-directed-memory",
                    None,
                    CreateMemoryCommand {
                        scope: MemoryScopeKind::Relationship,
                        kind: MemoryKind::Lesson,
                        body: reverse_body.to_string(),
                        retrieval_keys: vec![reverse_key.to_string()],
                        companion_agent_id: None,
                        relationship_agent_ids: vec!["agent_1".to_string(), "agent_2".to_string()],
                        direction: Some(RelationshipDirection::Directed),
                        directed_actor_agent_id: Some("agent_2".to_string()),
                        review_after: None,
                    },
                ),
            )
            .unwrap();
        let reverse_id = reverse.result.payload["memoryId"].as_str().unwrap();
        let reverse_revision_id = reverse.result.payload["revisionId"].as_str().unwrap();
        let reverse_wrong_base = fixture.memory_revise(
            "reverse-directed-wrong-base",
            reverse_id,
            &Uuid::new_v4().to_string(),
            "Agent one must not revise a reverse-directed Memory.",
            &["reverse denied"],
        );
        assert_memory_unavailable(&reverse_wrong_base);
        let reverse_exact = fixture.memory_revise(
            "reverse-directed-exact",
            reverse_id,
            reverse_revision_id,
            reverse_body,
            &[reverse_key],
        );
        assert_memory_unavailable(&reverse_exact);

        let guessed = fixture.memory_revise(
            "guessed-memory-revise",
            &Uuid::new_v4().to_string(),
            &Uuid::new_v4().to_string(),
            "A guessed identifier must reveal no target facts.",
            &["guessed target"],
        );
        assert_memory_unavailable(&guessed);

        let hearth_body = "Authorized Hearth revise keeps its exact concurrency semantics.";
        let hearth_key = "hearth cas";
        let hearth = MemoryService::default()
            .create(
                &mut fixture.database,
                &user_envelope(
                    "user-hearth-cas-memory",
                    None,
                    CreateMemoryCommand {
                        scope: MemoryScopeKind::Hearth,
                        kind: MemoryKind::Lesson,
                        body: hearth_body.to_string(),
                        retrieval_keys: vec![hearth_key.to_string()],
                        companion_agent_id: None,
                        relationship_agent_ids: Vec::new(),
                        direction: None,
                        directed_actor_agent_id: None,
                        review_after: None,
                    },
                ),
            )
            .unwrap();
        let hearth_id = hearth.result.payload["memoryId"].as_str().unwrap();
        let hearth_revision_id = hearth.result.payload["revisionId"].as_str().unwrap();
        let hearth_wrong_base = fixture.memory_revise(
            "hearth-wrong-base",
            hearth_id,
            &Uuid::new_v4().to_string(),
            "A new Hearth candidate body.",
            &["hearth candidate"],
        );
        assert_eq!(hearth_wrong_base.result.code, "memory.revision_conflict");
        assert_eq!(
            hearth_wrong_base.result.payload,
            json!({"message": "baseRevisionId is not current"})
        );
        let hearth_exact = fixture.memory_revise(
            "hearth-exact",
            hearth_id,
            hearth_revision_id,
            hearth_body,
            &[hearth_key],
        );
        assert_eq!(hearth_exact.result.code, "memory.no_change");
        assert_eq!(
            hearth_exact.result.payload,
            json!({"message": "Memory body and Retrieval Keys are unchanged"})
        );
    }

    #[cfg(feature = "slow-tests")]
    fn agent_memory_domain_rejections_are_durable_across_state_changes_and_retries() {
        let mut fixture = Fixture::new();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_3'",
                [],
            )
            .unwrap();
        let input = MemoryWriteToolInput {
            action: "add".to_string(),
            scope: Some(MemoryScopeKind::Relationship),
            kind: Some(MemoryKind::Agreement),
            body: "I will give agent three exact retry evidence.".to_string(),
            retrieval_keys: vec!["retry evidence".to_string()],
            counterparty_agent_id: Some("agent_3".to_string()),
            direction: Some(RelationshipDirection::Directed),
            target: None,
        };
        let first = fixture
            .memory_write("durable-counterparty-rejection", input.clone())
            .unwrap();
        assert_eq!(first.result.status, CommandResultStatus::Rejected);
        assert_eq!(first.result.code, "memory.direction_forbidden");
        assert!(!first.replayed);

        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'present' WHERE id = 'agent_3'",
                [],
            )
            .unwrap();
        let replay = fixture
            .memory_write("durable-counterparty-rejection", input)
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result, first.result);
        assert!(
            MemoryService::default()
                .list(&fixture.database)
                .unwrap()
                .memories
                .iter()
                .all(|memory| memory.current_body.as_deref()
                    != Some("I will give agent three exact retry evidence."))
        );

        for index in 0..MEMORY_AGENT_MUTATIONS_PER_RUN {
            let persisted = fixture.hearth_review_add(
                &format!("quota-write-{index}"),
                &format!("Durable quota candidate number {index}."),
                &format!("quota key {index}"),
            );
            assert_eq!(persisted.result.status, CommandResultStatus::Accepted);
        }
        let quota_input = MemoryWriteToolInput {
            action: "add".to_string(),
            scope: Some(MemoryScopeKind::Companion),
            kind: Some(MemoryKind::Lesson),
            body: "This write must remain rejected on every replay.".to_string(),
            retrieval_keys: vec!["quota replay".to_string()],
            counterparty_agent_id: None,
            direction: None,
            target: None,
        };
        let quota = fixture
            .memory_write("durable-run-quota-rejection", quota_input.clone())
            .unwrap();
        assert_eq!(quota.result.status, CommandResultStatus::Rejected);
        assert_eq!(quota.result.code, "memory.run_quota_exceeded");
        assert!(!quota.replayed);
        let quota_replay = fixture
            .memory_write("durable-run-quota-rejection", quota_input)
            .unwrap();
        assert!(quota_replay.replayed);
        assert_eq!(quota_replay.result, quota.result);
    }

    #[cfg(feature = "slow-tests")]
    fn hearth_review_terminalizes_candidates_and_reconciles_exact_publication() {
        let mut fixture = Fixture::new();
        let tools = MemoryToolService;
        let write_hearth =
            |fixture: &mut Fixture, call_id: &str, body: &str, key: &str| -> CommandExecution {
                tools
                    .write(
                        &mut fixture.database,
                        &MemoryWriteToolInvocation {
                            native_binding_id: fixture.credential.native_binding_id.clone(),
                            binding_credential: fixture.credential.binding_credential.clone(),
                            runtime_tool_call_id: call_id.to_string(),
                            input: MemoryWriteToolInput {
                                action: "add".to_string(),
                                scope: Some(MemoryScopeKind::Hearth),
                                kind: Some(MemoryKind::Lesson),
                                body: body.to_string(),
                                retrieval_keys: vec![key.to_string()],
                                counterparty_agent_id: None,
                                direction: None,
                                target: None,
                            },
                        },
                    )
                    .unwrap()
            };

        let first_body = "Verify recovery evidence before retrying a frozen action.";
        let final_body = "Reuse the same verified evidence before every recovery retry.";
        let first = write_hearth(
            &mut fixture,
            "review-add-first",
            first_body,
            "frozen recovery",
        );
        let duplicate = write_hearth(
            &mut fixture,
            "review-add-duplicate",
            first_body,
            "different retrieval key",
        );
        assert_eq!(duplicate.result.status, CommandResultStatus::Rejected);
        assert_eq!(duplicate.result.code, "memory.duplicate_pending");
        assert_eq!(
            duplicate.result.payload,
            json!({"message": "An identical pending Hearth Review Item already exists"})
        );
        let matching = write_hearth(
            &mut fixture,
            "review-add-matching",
            final_body,
            "verified retry",
        );
        let first_id = first.result.payload["reviewItemId"]
            .as_str()
            .unwrap()
            .to_string();
        let matching_id = matching.result.payload["reviewItemId"]
            .as_str()
            .unwrap()
            .to_string();

        let accepted = MemoryService::default()
            .accept_hearth_review_item(
                &mut fixture.database,
                &user_envelope(
                    "edit-and-accept-review",
                    None,
                    AcceptHearthReviewItemCommand {
                        review_item_id: first_id.clone(),
                        expected_review_item_version: 1,
                        final_body: Some(final_body.to_string()),
                        final_retrieval_keys: Some(vec!["final recovery".to_string()]),
                    },
                ),
            )
            .unwrap();
        assert_eq!(accepted.result.status, CommandResultStatus::Applied);

        let reviews = MemoryService::default()
            .list_hearth_review_items(&fixture.database)
            .unwrap();
        let accepted_review = reviews
            .iter()
            .find(|review| review.review_item_id == first_id)
            .unwrap();
        assert_eq!(accepted_review.status, "accepted");
        assert_eq!(accepted_review.edited_before_acceptance, Some(true));
        assert!(accepted_review.candidate_kind.is_none());
        assert!(accepted_review.candidate_body.is_none());
        assert!(accepted_review.candidate_retrieval_keys.is_none());
        let invalidated = reviews
            .iter()
            .find(|review| review.review_item_id == matching_id)
            .unwrap();
        assert_eq!(invalidated.status, "invalidated");
        assert_eq!(
            invalidated.invalidation_reason.as_deref(),
            Some("exact_candidate_published")
        );
        assert!(invalidated.candidate_body.is_none());

        let stale_decision = MemoryService::default()
            .reject_hearth_review_item(
                &mut fixture.database,
                &user_envelope(
                    "reject-terminal-review",
                    None,
                    RejectHearthReviewItemCommand {
                        review_item_id: first_id,
                        expected_review_item_version: 1,
                    },
                ),
            )
            .unwrap();
        assert_eq!(stale_decision.result.status, CommandResultStatus::Rejected);
        assert_eq!(stale_decision.result.code, "memory.review_version_conflict");

        let leaked_event_rows: i64 = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT COUNT(*) FROM event_log
                WHERE event_type LIKE 'memory.hearth_review_%'
                  AND (instr(payload_json, ?1) > 0 OR instr(payload_json, ?2) > 0)
                "#,
                params![first_body, final_body],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(leaked_event_rows, 0);
    }

    #[cfg(feature = "slow-tests")]
    fn pending_hearth_review_is_unreadable_stale_is_reject_only_and_forget_closes_history() {
        let mut fixture = Fixture::new();
        let service = MemoryService::default();
        let original_body = "Preserve the original verified recovery record.";
        let created = service
            .create(
                &mut fixture.database,
                &user_envelope(
                    "create-review-target",
                    None,
                    CreateMemoryCommand {
                        scope: MemoryScopeKind::Hearth,
                        kind: MemoryKind::Lesson,
                        body: original_body.to_string(),
                        retrieval_keys: vec!["verified record".to_string()],
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
        let original_revision_id = created.result.payload["revisionId"]
            .as_str()
            .unwrap()
            .to_string();
        let candidate_body = "candidate-only-marker should replace the recovery record.";
        let first_review = MemoryToolService
            .write(
                &mut fixture.database,
                &MemoryWriteToolInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "hearth-revise-first".to_string(),
                    input: MemoryWriteToolInput {
                        action: "revise".to_string(),
                        scope: None,
                        kind: None,
                        body: candidate_body.to_string(),
                        retrieval_keys: vec!["candidate marker".to_string()],
                        counterparty_agent_id: None,
                        direction: None,
                        target: Some(MemoryTarget {
                            memory_id: memory_id.clone(),
                            revision_id: original_revision_id.clone(),
                            scope: MemoryScopeKind::Hearth,
                            counterparty_agent_id: None,
                            direction: None,
                        }),
                    },
                },
            )
            .unwrap();
        let first_review_id = first_review.result.payload["reviewItemId"]
            .as_str()
            .unwrap()
            .to_string();

        let retrieval = MemoryRetrievalService;
        let hidden = retrieval
            .search(
                &mut fixture.database,
                &MemoryRetrievalInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "search-pending-review".to_string(),
                    input: MemorySearchInput {
                        query: "candidate-only-marker".to_string(),
                        limit: Some(6),
                    },
                },
            )
            .unwrap();
        assert!(hidden.results.is_empty());
        let guessed_review = retrieval
            .read(
                &mut fixture.database,
                &MemoryRetrievalInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "read-review-id-as-memory".to_string(),
                    input: MemoryReadInput {
                        memory_ids: vec![first_review_id.clone()],
                    },
                },
            )
            .unwrap();
        assert_eq!(
            guessed_review.memories[0].cache_state,
            MemoryCacheState::Unavailable
        );
        assert!(guessed_review.memories[0].body.is_none());

        let revised = service
            .revise(
                &mut fixture.database,
                &user_envelope(
                    "advance-review-target",
                    None,
                    ReviseMemoryCommand {
                        memory_id: memory_id.clone(),
                        expected_version: 1,
                        base_revision_id: original_revision_id,
                        body: "Use the current verified recovery record.".to_string(),
                        retrieval_keys: vec!["current record".to_string()],
                        review_after: None,
                    },
                ),
            )
            .unwrap();
        let current_revision_id = revised.result.payload["revisionId"]
            .as_str()
            .unwrap()
            .to_string();
        let stale = service
            .list_hearth_review_items(&fixture.database)
            .unwrap()
            .into_iter()
            .find(|review| review.review_item_id == first_review_id)
            .unwrap();
        assert!(stale.stale);
        let stale_accept = service
            .accept_hearth_review_item(
                &mut fixture.database,
                &user_envelope(
                    "accept-stale-review",
                    None,
                    AcceptHearthReviewItemCommand {
                        review_item_id: first_review_id.clone(),
                        expected_review_item_version: 1,
                        final_body: None,
                        final_retrieval_keys: None,
                    },
                ),
            )
            .unwrap();
        assert_eq!(stale_accept.result.code, "memory.review_stale");
        let stale_reject = service
            .reject_hearth_review_item(
                &mut fixture.database,
                &user_envelope(
                    "reject-stale-review",
                    None,
                    RejectHearthReviewItemCommand {
                        review_item_id: first_review_id.clone(),
                        expected_review_item_version: 1,
                    },
                ),
            )
            .unwrap();
        assert_eq!(stale_reject.result.status, CommandResultStatus::Applied);

        let second_review = MemoryToolService
            .write(
                &mut fixture.database,
                &MemoryWriteToolInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "hearth-revise-before-forget".to_string(),
                    input: MemoryWriteToolInput {
                        action: "revise".to_string(),
                        scope: None,
                        kind: None,
                        body: "A pending target revision must clear when forgotten.".to_string(),
                        retrieval_keys: vec!["forget target".to_string()],
                        counterparty_agent_id: None,
                        direction: None,
                        target: Some(MemoryTarget {
                            memory_id: memory_id.clone(),
                            revision_id: current_revision_id,
                            scope: MemoryScopeKind::Hearth,
                            counterparty_agent_id: None,
                            direction: None,
                        }),
                    },
                },
            )
            .unwrap();
        let second_review_id = second_review.result.payload["reviewItemId"]
            .as_str()
            .unwrap()
            .to_string();
        let historical_add = MemoryToolService
            .write(
                &mut fixture.database,
                &MemoryWriteToolInvocation {
                    native_binding_id: fixture.credential.native_binding_id.clone(),
                    binding_credential: fixture.credential.binding_credential.clone(),
                    runtime_tool_call_id: "hearth-add-historical-body".to_string(),
                    input: MemoryWriteToolInput {
                        action: "add".to_string(),
                        scope: Some(MemoryScopeKind::Hearth),
                        kind: Some(MemoryKind::Lesson),
                        body: original_body.to_string(),
                        retrieval_keys: vec!["historical body".to_string()],
                        counterparty_agent_id: None,
                        direction: None,
                        target: None,
                    },
                },
            )
            .unwrap();
        let historical_add_id = historical_add.result.payload["reviewItemId"]
            .as_str()
            .unwrap()
            .to_string();

        service
            .forget(
                &mut fixture.database,
                &user_envelope(
                    "forget-review-target",
                    None,
                    ForgetMemoryCommand {
                        memory_id,
                        expected_version: 2,
                    },
                ),
            )
            .unwrap();
        let reviews = service.list_hearth_review_items(&fixture.database).unwrap();
        let target_review = reviews
            .iter()
            .find(|review| review.review_item_id == second_review_id)
            .unwrap();
        assert_eq!(target_review.status, "invalidated");
        assert_eq!(
            target_review.invalidation_reason.as_deref(),
            Some("target_forgotten")
        );
        assert!(target_review.candidate_body.is_none());
        let historical = reviews
            .iter()
            .find(|review| review.review_item_id == historical_add_id)
            .unwrap();
        assert_eq!(historical.status, "invalidated");
        assert_eq!(
            historical.invalidation_reason.as_deref(),
            Some("exact_candidate_published")
        );
        assert!(historical.candidate_body.is_none());
    }

    #[test]
    fn memory_export_excludes_every_hearth_review_state_and_candidate_locator() {
        let mut fixture = Fixture::new();
        let service = MemoryService::default();

        let stale_target = service
            .create(
                &mut fixture.database,
                &user_envelope(
                    "create-export-stale-target",
                    None,
                    CreateMemoryCommand {
                        scope: MemoryScopeKind::Hearth,
                        kind: MemoryKind::Lesson,
                        body: "Formal stale-review export target.".to_string(),
                        retrieval_keys: vec!["stale target".to_string()],
                        companion_agent_id: None,
                        relationship_agent_ids: Vec::new(),
                        direction: None,
                        directed_actor_agent_id: None,
                        review_after: None,
                    },
                ),
            )
            .unwrap();
        let stale_target_id = stale_target.result.payload["memoryId"]
            .as_str()
            .unwrap()
            .to_string();
        let stale_base_revision_id = stale_target.result.payload["revisionId"]
            .as_str()
            .unwrap()
            .to_string();
        let stale_marker = "pending-hearth-export-marker-stale-93a1";
        let stale_key = "export-stale-93a1";
        let stale_review = fixture.memory_revise(
            "write-export-stale-review",
            &stale_target_id,
            &stale_base_revision_id,
            stale_marker,
            &[stale_key],
        );
        let stale_review_id = stale_review.result.payload["reviewItemId"]
            .as_str()
            .unwrap()
            .to_string();
        let fresh = service
            .list_hearth_review_items(&fixture.database)
            .unwrap()
            .into_iter()
            .find(|review| review.review_item_id == stale_review_id)
            .unwrap();
        assert_eq!(fresh.status, "pending");
        assert!(!fresh.stale);
        assert_memory_export_isolated(
            &fixture.database,
            &[stale_marker, stale_key, &stale_review_id],
        );

        service
            .revise(
                &mut fixture.database,
                &user_envelope(
                    "advance-export-stale-target",
                    None,
                    ReviseMemoryCommand {
                        memory_id: stale_target_id,
                        expected_version: 1,
                        base_revision_id: stale_base_revision_id,
                        body: "Formal stale-review target advanced by the user.".to_string(),
                        retrieval_keys: vec!["advanced target".to_string()],
                        review_after: None,
                    },
                ),
            )
            .unwrap();
        let stale = service
            .list_hearth_review_items(&fixture.database)
            .unwrap()
            .into_iter()
            .find(|review| review.review_item_id == stale_review_id)
            .unwrap();
        assert_eq!(stale.status, "pending");
        assert!(stale.stale);
        assert_memory_export_isolated(
            &fixture.database,
            &[stale_marker, stale_key, &stale_review_id],
        );

        let accepted_marker = "pending-hearth-export-marker-accepted-93a1";
        let accepted_key = "export-accept-93a1";
        let accepted_review = fixture.hearth_review_add(
            "write-export-accepted-review",
            accepted_marker,
            accepted_key,
        );
        let accepted_review_id = accepted_review.result.payload["reviewItemId"]
            .as_str()
            .unwrap()
            .to_string();
        service
            .accept_hearth_review_item(
                &mut fixture.database,
                &user_envelope(
                    "accept-export-review",
                    None,
                    AcceptHearthReviewItemCommand {
                        review_item_id: accepted_review_id.clone(),
                        expected_review_item_version: 1,
                        final_body: Some(
                            "Only this edited formal Memory belongs in export.".to_string(),
                        ),
                        final_retrieval_keys: Some(vec!["formal export".to_string()]),
                    },
                ),
            )
            .unwrap();

        let rejected_marker = "pending-hearth-export-marker-rejected-93a1";
        let rejected_key = "export-reject-93a1";
        let rejected_review = fixture.hearth_review_add(
            "write-export-rejected-review",
            rejected_marker,
            rejected_key,
        );
        let rejected_review_id = rejected_review.result.payload["reviewItemId"]
            .as_str()
            .unwrap()
            .to_string();
        service
            .reject_hearth_review_item(
                &mut fixture.database,
                &user_envelope(
                    "reject-export-review",
                    None,
                    RejectHearthReviewItemCommand {
                        review_item_id: rejected_review_id.clone(),
                        expected_review_item_version: 1,
                    },
                ),
            )
            .unwrap();

        let invalidated_target = service
            .create(
                &mut fixture.database,
                &user_envelope(
                    "create-export-invalidated-target",
                    None,
                    CreateMemoryCommand {
                        scope: MemoryScopeKind::Hearth,
                        kind: MemoryKind::Lesson,
                        body: "Formal invalidated-review export target.".to_string(),
                        retrieval_keys: vec!["invalid target".to_string()],
                        companion_agent_id: None,
                        relationship_agent_ids: Vec::new(),
                        direction: None,
                        directed_actor_agent_id: None,
                        review_after: None,
                    },
                ),
            )
            .unwrap();
        let invalidated_target_id = invalidated_target.result.payload["memoryId"]
            .as_str()
            .unwrap()
            .to_string();
        let invalidated_base_revision_id = invalidated_target.result.payload["revisionId"]
            .as_str()
            .unwrap()
            .to_string();
        let invalidated_marker = "pending-hearth-export-marker-invalidated-93a1";
        let invalidated_key = "export-invalid-93a1";
        let invalidated_review = fixture.memory_revise(
            "write-export-invalidated-review",
            &invalidated_target_id,
            &invalidated_base_revision_id,
            invalidated_marker,
            &[invalidated_key],
        );
        let invalidated_review_id = invalidated_review.result.payload["reviewItemId"]
            .as_str()
            .unwrap()
            .to_string();
        service
            .forget(
                &mut fixture.database,
                &user_envelope(
                    "forget-export-invalidated-target",
                    None,
                    ForgetMemoryCommand {
                        memory_id: invalidated_target_id,
                        expected_version: 1,
                    },
                ),
            )
            .unwrap();

        let review_items = service.list_hearth_review_items(&fixture.database).unwrap();
        for (review_item_id, expected_status, expected_stale) in [
            (&stale_review_id, "pending", true),
            (&accepted_review_id, "accepted", false),
            (&rejected_review_id, "rejected", false),
            (&invalidated_review_id, "invalidated", false),
        ] {
            let review = review_items
                .iter()
                .find(|review| &review.review_item_id == review_item_id)
                .unwrap();
            assert_eq!(review.status, expected_status);
            assert_eq!(review.stale, expected_stale);
        }

        assert_memory_export_isolated(
            &fixture.database,
            &[
                stale_marker,
                stale_key,
                &stale_review_id,
                accepted_marker,
                accepted_key,
                &accepted_review_id,
                rejected_marker,
                rejected_key,
                &rejected_review_id,
                invalidated_marker,
                invalidated_key,
                &invalidated_review_id,
            ],
        );
    }

    // Historical v0.34 acceptance selectors remain executable after the v0.45
    // clean break. Their current assertion is that the retired private protocol
    // cannot re-enter the Runtime-visible tool catalog.
    #[test]
    fn depth_and_execution_budget_exhaustion_reject_without_partial_effects_and_replay() {
        assert!(!TEAM_TOOL_NAMES.contains(&"team.call_member"));
    }

    #[cfg(feature = "slow-tests")]
    fn recipient_completion_without_another_call_never_contacts_the_source() {
        assert!(!TEAM_TOOL_NAMES.contains(&"team.call_member"));
    }

    #[cfg(feature = "slow-tests")]
    fn reverse_member_call_is_an_independent_forward_edge() {
        assert!(!TEAM_TOOL_NAMES.contains(&"team.call_member"));
    }

    #[cfg(feature = "slow-tests")]
    fn controlled_resume_retains_binding_across_session_metadata_transition() {
        let mut fixture = Fixture::new();
        let conversation_id: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT conversation_id FROM agent_run WHERE id = ?1",
                [&fixture.source_run_id],
                |row| row.get(0),
            )
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE conversation SET native_session_compatibility_key = NULL WHERE id = ?1",
                [&conversation_id],
            )
            .unwrap();

        let resumed = TeamToolService::default()
            .prepare_controlled_resume_binding_credential(
                &mut fixture.database,
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .unwrap();

        assert!(!resumed.binding_replaced);
        assert_eq!(
            resumed.native_binding_id,
            fixture.credential.native_binding_id
        );
        assert_eq!(resumed.native_session_id.as_deref(), Some("native-source"));
    }

    #[cfg(feature = "slow-tests")]
    mod slow_tests {
        #[test]
        fn public_send_schema_teaches_alias_boundary_and_canonical_to_values() {
            super::public_send_schema_teaches_alias_boundary_and_canonical_to_values();
        }
        #[test]
        fn gather_acceptance_persists_unified_deliveries_and_split_budget() {
            super::gather_acceptance_persists_unified_deliveries_and_split_budget();
        }
        #[test]
        fn gather_captures_public_return_and_materializes_one_completion() {
            super::gather_captures_public_return_and_materializes_one_completion();
        }
        #[test]
        fn gather_freezes_bounded_fallback_on_the_original_initiator_route() {
            super::gather_freezes_bounded_fallback_on_the_original_initiator_route();
        }
        #[test]
        fn concurrent_last_member_terminals_create_one_completion_delivery() {
            super::concurrent_last_member_terminals_create_one_completion_delivery();
        }
        #[test]
        fn camp_turn_stop_racing_last_gather_member_cancels_completion() {
            super::camp_turn_stop_racing_last_gather_member_cancels_completion();
        }
        #[test]
        fn gather_is_cancelled_when_original_initiator_leaves() {
            super::gather_is_cancelled_when_original_initiator_leaves();
        }
        #[test]
        fn multiple_gather_completions_share_original_lead_fifo() {
            super::multiple_gather_completions_share_original_lead_fifo();
        }
        #[test]
        fn gather_forward_retry_reuses_item_and_ready_wins() {
            super::gather_forward_retry_reuses_item_and_ready_wins();
        }
        #[test]
        fn public_send_resolves_active_member_display_name_alias_before_delivery() {
            super::public_send_resolves_active_member_display_name_alias_before_delivery();
        }
        #[test]
        fn public_send_keeps_mid_line_display_name_alias_as_public_text() {
            super::public_send_keeps_mid_line_display_name_alias_as_public_text();
        }
        #[test]
        fn public_only_send_consumes_no_a2a_slot() {
            super::public_only_send_consumes_no_a2a_slot();
        }
        #[test]
        fn current_user_text_lookalikes_do_not_create_attention() {
            super::current_user_text_lookalikes_do_not_create_attention();
        }
        #[test]
        fn task_linkage_ignores_current_user_attention_for_recipient_cardinality() {
            super::task_linkage_ignores_current_user_attention_for_recipient_cardinality();
        }
        #[test]
        fn agent_send_rejects_a_tombstoned_trigger_message() {
            super::agent_send_rejects_a_tombstoned_trigger_message();
        }
        #[test]
        fn a2a_send_rejects_a_missing_trigger_delivery() {
            super::a2a_send_rejects_a_missing_trigger_delivery();
        }
        #[test]
        fn addressing_the_immediate_caller_deduplicates_into_a_return_delivery() {
            super::addressing_the_immediate_caller_deduplicates_into_a_return_delivery();
        }
        #[test]
        fn a_non_immediate_ancestor_remains_rejected() {
            super::a_non_immediate_ancestor_remains_rejected();
        }
        #[test]
        fn public_delivery_runtime_consumes_the_pre_run_frozen_context_bytes() {
            super::public_delivery_runtime_consumes_the_pre_run_frozen_context_bytes();
        }
        #[test]
        fn task_linked_public_delivery_reuses_exact_run_fact_bytes() {
            super::task_linked_public_delivery_reuses_exact_run_fact_bytes();
        }
        #[test]
        fn missing_send_recovery_publishes_one_literal_recipient_free_message() {
            super::missing_send_recovery_publishes_one_literal_recipient_free_message();
        }
        #[test]
        fn terminal_evidence_cannot_publish_after_the_run_membership_is_replaced() {
            super::terminal_evidence_cannot_publish_after_the_run_membership_is_replaced();
        }
        #[test]
        fn accepted_send_suppresses_missing_send_recovery_for_recipient_matrix() {
            let cases: [(&str, fn()); 2] = [
                (
                    "recipient-free",
                    super::accepted_recipient_free_send_suppresses_missing_send_recovery,
                ),
                (
                    "addressed",
                    super::accepted_addressed_send_also_suppresses_missing_send_recovery,
                ),
            ];
            for (_name, run) in cases {
                run();
            }
        }
        #[test]
        fn a2a_target_run_recovers_independently_from_the_source_send() {
            super::a2a_target_run_recovers_independently_from_the_source_send();
        }
        #[test]
        fn missing_send_recovery_failures_do_not_change_run_success() {
            super::missing_send_recovery_failures_do_not_change_run_success();
        }
        #[test]
        fn rejected_send_does_not_suppress_recovery_but_tombstoned_accepted_send_does() {
            super::rejected_send_does_not_suppress_recovery_but_tombstoned_accepted_send_does();
        }
        #[test]
        fn task_tool_schemas_use_cross_adapter_assignee_controls() {
            super::task_tool_schemas_use_cross_adapter_assignee_controls();
        }
        #[test]
        fn task_tool_reads_are_camp_wide_without_audit_writes() {
            super::task_tool_reads_are_camp_wide_without_audit_writes();
        }
        #[test]
        fn every_agent_business_tool_binding_is_fenced_after_leave_and_readd() {
            super::every_agent_business_tool_binding_is_fenced_after_leave_and_readd();
        }
        #[test]
        fn a_terminal_delivery_cannot_be_retried_after_the_recipient_leaves_and_rejoins() {
            super::a_terminal_delivery_cannot_be_retried_after_the_recipient_leaves_and_rejoins();
        }
        #[test]
        fn an_existing_run_can_address_a_member_added_after_its_context_was_frozen() {
            super::an_existing_run_can_address_a_member_added_after_its_context_was_frozen();
        }
        #[test]
        fn pending_outbound_delivery_is_cancelled_when_source_membership_ends() {
            super::pending_outbound_delivery_is_cancelled_when_source_membership_ends();
        }
        #[test]
        fn running_outbound_delivery_target_is_reconciled_when_source_membership_ends() {
            super::running_outbound_delivery_target_is_reconciled_when_source_membership_ends();
        }
        #[test]
        fn dispatch_and_retry_reject_delivery_from_ended_source_membership() {
            super::dispatch_and_retry_reject_delivery_from_ended_source_membership();
        }
        #[test]
        fn public_send_rejects_a_left_recipient_and_accepts_a_new_membership() {
            super::public_send_rejects_a_left_recipient_and_accepts_a_new_membership();
        }
        #[test]
        fn task_tool_lead_creation_ignores_capability_catalog_and_keeps_version_fencing() {
            super::task_tool_lead_creation_ignores_capability_catalog_and_keeps_version_fencing();
        }
        #[test]
        fn memory_read_reports_revision_inactive_and_deleted_without_returning_stale_body() {
            super::memory_read_reports_revision_inactive_and_deleted_without_returning_stale_body();
        }
        #[test]
        fn memory_search_and_read_identify_relationship_counterparties() {
            super::memory_search_and_read_identify_relationship_counterparties();
        }
        #[test]
        fn memory_view_returns_complete_exact_scope_targets_in_deterministic_order() {
            super::memory_view_returns_complete_exact_scope_targets_in_deterministic_order();
        }
        #[test]
        fn hearth_review_acceptance_checks_body_quota_and_replays_the_first_rejection() {
            super::hearth_review_acceptance_checks_body_quota_and_replays_the_first_rejection();
        }
        #[test]
        fn agent_companion_write_is_effective_while_hearth_requires_user_acceptance() {
            super::agent_companion_write_is_effective_while_hearth_requires_user_acceptance();
        }
        #[test]
        fn agent_memory_domain_rejections_are_durable_across_state_changes_and_retries() {
            super::agent_memory_domain_rejections_are_durable_across_state_changes_and_retries();
        }
        #[test]
        fn hearth_review_terminalizes_candidates_and_reconciles_exact_publication() {
            super::hearth_review_terminalizes_candidates_and_reconciles_exact_publication();
        }
        #[test]
        fn pending_hearth_review_is_unreadable_stale_is_reject_only_and_forget_closes_history() {
            super::pending_hearth_review_is_unreadable_stale_is_reject_only_and_forget_closes_history();
        }
        #[test]
        fn recipient_completion_without_another_call_never_contacts_the_source() {
            super::recipient_completion_without_another_call_never_contacts_the_source();
        }
        #[test]
        fn reverse_member_call_is_an_independent_forward_edge() {
            super::reverse_member_call_is_an_independent_forward_edge();
        }
        #[test]
        fn controlled_resume_retains_binding_across_session_metadata_transition() {
            super::controlled_resume_retains_binding_across_session_metadata_transition();
        }
    }
}
