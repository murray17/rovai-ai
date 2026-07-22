use std::{collections::HashSet, fmt};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    agent_profile::{AdapterKind, FrozenAgentRuntimeConfig, resolve_frozen_runtime},
    collaboration::{append_domain_event, build_effective_config, entity_belongs_to_camp},
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    db::Database,
};

pub const TEAM_POST_MESSAGE_TOOL_NAME: &str = "team.post_message";
pub const TEAM_POST_MESSAGE_CAPABILITY: &str = "team_tool.post_message";
pub const TEAM_POST_MESSAGE_MAX_BODY_BYTES: usize = 32 * 1024;
pub const TEAM_POST_MESSAGE_MAX_REFERENCES: usize = 32;
pub const MAX_A2A_DEPTH: i64 = 5;
pub const MAX_A2A_RUNS_PER_TURN: i64 = 16;
pub const A2A_DEPTH_WARNING_AT: i64 = 2;
pub const A2A_RUN_WARNING_AT: i64 = 12;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamPostMessageInput {
    pub recipient_agent_id: String,
    pub body: String,
    #[serde(default)]
    pub references: Vec<EntityReference>,
    pub in_reply_to_message_id: Option<String>,
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

#[derive(Clone)]
pub struct TeamToolBindingCredential {
    pub native_binding_id: String,
    pub native_binding_generation: i64,
    pub binding_credential: String,
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
    task_id: Option<String>,
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

    /// Rotates the credential whenever a Run is about to receive the Team Tool.
    /// Rotation fences MCP processes left behind by an earlier Run on the same
    /// reusable Native Session.
    pub fn issue_binding_credential(
        &self,
        database: &mut Database,
        agent_run_id: &str,
        execution_epoch: i64,
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
                       agent_run.runtime_adapter_kind,
                       agent_run.runtime_capabilities_json,
                       agent_run.effective_config_json
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
                  AND conversation.native_binding_id IS NOT NULL
                  AND conversation.native_binding_generation >= 1
                "#,
                params![agent_run_id, execution_epoch],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                        row.get::<_, String>(6)?,
                    ))
                },
            )
            .optional()?;
        let Some((
            camp_id,
            conversation_id,
            binding_id,
            generation,
            adapter_kind,
            capabilities,
            effective_config,
        )) = binding
        else {
            return Err(invocation_error(
                "team_tool.binding_unavailable",
                "AgentRun has no current active Native Binding",
            ));
        };
        ensure_runtime_supports_team_tool(adapter_kind.as_deref(), capabilities.as_deref())?;
        ensure_agent_can_send_inbox(&effective_config)?;

        let credential = format!("{}.{}", Uuid::new_v4(), Uuid::new_v4());
        let digest = credential_digest(&credential);
        let now = chrono::Utc::now().to_rfc3339();
        let updated = transaction.execute(
            r#"
            UPDATE conversation
            SET native_binding_secret_digest = ?2,
                version = version + 1,
                updated_at = ?3
            WHERE id = ?1
              AND native_binding_id = ?4
              AND native_binding_generation = ?5
              AND EXISTS (
                  SELECT 1 FROM agent_run
                  WHERE agent_run.id = ?6
                    AND agent_run.conversation_id = conversation.id
                    AND agent_run.execution_epoch = ?7
                    AND agent_run.status = 'running'
                    AND agent_run.cancel_requested_at IS NULL
              )
            "#,
            params![
                conversation_id,
                digest,
                now,
                binding_id,
                generation,
                agent_run_id,
                execution_epoch,
            ],
        )?;
        if updated != 1 {
            return Err(invocation_error(
                "team_tool.binding_fenced",
                "Native Binding changed while its Team Tool credential was issued",
            ));
        }
        append_domain_event(
            &transaction,
            "team_tool.binding_credential_rotated",
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
                "credentialDigest": digest,
            }),
        )?;
        transaction.commit()?;
        Ok(TeamToolBindingCredential {
            native_binding_id: binding_id,
            native_binding_generation: generation,
            binding_credential: credential,
        })
    }

    pub fn post_message(
        &self,
        database: &mut Database,
        invocation: &TeamToolInvocation,
    ) -> Result<CommandExecution> {
        validate_invocation(invocation)?;
        let supplied_credential_digest = credential_digest(&invocation.binding_credential);
        // Authenticate before looking up a command record. This prevents an old
        // Bridge from replaying even a harmless historical result after rotation.
        let sender = resolve_sender_identity(
            database.connection(),
            &invocation.native_binding_id,
            &supplied_credential_digest,
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
            if let Some(task_id) = current.task_id.as_deref()
                && !task_accepts_collaboration(transaction, task_id, &current.camp_id)?
            {
                return Ok(rejected(
                    "team_tool.task_unavailable",
                    "The source Task no longer accepts collaboration Runs",
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
                    current.task_id,
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
                    "taskId": current.task_id,
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
}

fn validate_invocation(invocation: &TeamToolInvocation) -> Result<()> {
    if invocation.native_binding_id.trim().is_empty()
        || invocation.binding_credential.trim().is_empty()
        || invocation.runtime_tool_call_id.trim().is_empty()
    {
        return Err(invocation_error(
            "team_tool.invalid_invocation",
            "Binding identity, credential, and Runtime Tool Call ID are required",
        ));
    }
    Uuid::parse_str(&invocation.native_binding_id).map_err(|_| {
        invocation_error(
            "team_tool.invalid_binding",
            "Native Binding ID must be a UUID",
        )
    })?;
    if invocation.runtime_tool_call_id.len() > 512 {
        return Err(invocation_error(
            "team_tool.invalid_tool_call_id",
            "Runtime Tool Call ID exceeds 512 bytes",
        ));
    }
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

fn resolve_sender_identity(
    connection: &Connection,
    native_binding_id: &str,
    credential_digest: &str,
) -> Result<SenderIdentity> {
    resolve_sender_identity_by_digest(connection, native_binding_id, credential_digest)
}

fn resolve_sender_identity_by_digest(
    connection: &Connection,
    native_binding_id: &str,
    credential_digest: &str,
) -> Result<SenderIdentity> {
    let identity = connection
        .query_row(
            r#"
            SELECT conversation.camp_id, conversation.id,
                   conversation.agent_profile_id,
                   agent_run.id, agent_run.execution_epoch,
                   agent_run.camp_turn_id, agent_run.task_id,
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
                        task_id: row.get(6)?,
                        a2a_root_agent_run_id: row.get(7)?,
                        a2a_depth: row.get(8)?,
                        workspace_json: row.get(9)?,
                        credential_digest: row.get(12)?,
                    },
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, String>(13)?,
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
    ensure_agent_can_send_inbox(&effective_config)?;
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
    if runtime.adapter_kind == AdapterKind::AgyCli
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

fn task_accepts_collaboration(
    transaction: &Transaction<'_>,
    task_id: &str,
    camp_id: &str,
) -> Result<bool> {
    let count: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*) FROM task
        WHERE id = ?1 AND camp_id = ?2
          AND status IN ('pending', 'in_progress')
          AND cancel_requested_at IS NULL
        "#,
        params![task_id, camp_id],
        |row| row.get(0),
    )?;
    Ok(count == 1)
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
    if adapter_kind == AdapterKind::AgyCli {
        return Err(invocation_error(
            "team_tool.adapter_unsupported",
            "AGY CLI does not support the v0.05 Team Tool",
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

fn ensure_agent_can_send_inbox(effective_config_json: &str) -> Result<()> {
    let effective_config: Value = serde_json::from_str(effective_config_json)
        .context("AgentRun effective configuration is invalid")?;
    if !effective_config["capabilities"]
        .as_array()
        .is_some_and(|capabilities| {
            capabilities
                .iter()
                .any(|capability| capability.as_str() == Some("inbox.send"))
        })
    {
        return Err(invocation_error(
            "team_tool.capability_denied",
            "AgentRun does not have the inbox.send capability",
        ));
    }
    Ok(())
}

fn credential_digest(credential: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(credential.as_bytes());
    format!("sha256:{:x}", digest.finalize())
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
    Ok(format!("team-post-{digest}"))
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
                            objective: "Exercise A2A execution".to_string(),
                            acceptance_criteria: Vec::new(),
                            assignee_agent_id: "agent-luoke".to_string(),
                            source_message_id: None,
                            origin_task_id: None,
                            dedup_key: Some("team-tool-fixture-task".to_string()),
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
        assert_eq!(state.task_id.as_deref(), Some(fixture.task_id.as_str()));
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
    fn explicit_reply_reverses_direction_and_inherits_correlation_turn_and_task() {
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
        assert_eq!(state.4.as_deref(), Some(fixture.task_id.as_str()));
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
    fn credential_rotation_fences_the_old_bridge() {
        let mut fixture = Fixture::new();
        let service = TeamToolService::default();
        let old_invocation = fixture.invocation("old-call", "agent-muwa");
        let replacement = service
            .issue_binding_credential(
                &mut fixture.database,
                &fixture.source_run_id,
                fixture.source_epoch,
            )
            .unwrap();
        let error = service
            .post_message(&mut fixture.database, &old_invocation)
            .expect_err("rotated credential must be fenced");
        assert_eq!(
            error
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.binding_fenced"
        );
        fixture.credential = replacement;
        let new_invocation = fixture.invocation("new-call", "agent-muwa");
        let accepted = service
            .post_message(&mut fixture.database, &new_invocation)
            .unwrap();
        assert_eq!(accepted.result.status, CommandResultStatus::Accepted);
    }

    #[test]
    fn claiming_a_new_execution_epoch_fences_the_previous_bridge_before_dispatch() {
        let mut fixture = Fixture::new();
        let stale_invocation = fixture.invocation("stale-epoch", "agent-muwa");
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
        let error = TeamToolService::default()
            .post_message(&mut fixture.database, &stale_invocation)
            .expect_err("old Bridge must be fenced before the recovered Run dispatches");
        assert_eq!(
            error
                .downcast_ref::<TeamToolInvocationError>()
                .unwrap()
                .code,
            "team_tool.binding_fenced"
        );
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
