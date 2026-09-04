use std::collections::HashMap;

use anyhow::Result;
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    agent_profile::resolve_frozen_runtime,
    camp_attachment::PreparedAttachmentView,
    collaboration::{append_domain_event, build_effective_config},
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    db::Database,
    execution_budget::freeze_camp_turn_execution_budget,
    read_model::{
        AgentRunExecutionEvidenceView, CampMessageAttachmentView,
        public_execution_evidence_for_agent_run,
    },
    runtime::{recompute_camp_turn, settle_abortive_agent_run_in_tx},
};

pub const SINGLE_CHAT_OPERATION_POLICY: &str = "single_chat_v1";
pub const SINGLE_CHAT_OPERATION_POLICY_VERSION: i64 = 1;
pub const SINGLE_CHAT_RESPONSE_DELIVERY: &str = "conversation_message";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSingleChatCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
    pub agent_id: String,
}

impl sealed::Sealed for OpenSingleChatCommand {}
impl DomainCommand for OpenSingleChatCommand {
    const TYPE: &'static str = "single_chat.open";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendSingleChatMessageCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
    pub conversation_id: String,
    pub body: String,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
    pub expected_conversation_version: i64,
}

impl sealed::Sealed for SendSingleChatMessageCommand {}
impl DomainCommand for SendSingleChatMessageCommand {
    const TYPE: &'static str = "single_chat.send";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndSingleChatCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
    pub conversation_id: String,
    pub expected_conversation_version: i64,
}

impl sealed::Sealed for EndSingleChatCommand {}
impl DomainCommand for EndSingleChatCommand {
    const TYPE: &'static str = "single_chat.end";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleChatConversationView {
    pub id: String,
    pub camp_id: String,
    pub agent_id: String,
    pub version: i64,
    pub status: String,
    pub last_message_sequence: i64,
    pub last_accepted_public_boundary_sequence: i64,
    pub active_agent_run_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleChatMessageView {
    pub id: String,
    pub sequence: i64,
    pub author_type: String,
    pub author_id: String,
    pub body: String,
    pub attachments: Vec<CampMessageAttachmentView>,
    pub agent_run_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleChatRunView {
    pub id: String,
    pub trigger_conversation_message_id: String,
    pub status: String,
    pub version: i64,
    pub execution_epoch: i64,
    pub cancel_requested_at: Option<String>,
    pub last_error_code: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub final_conversation_message_id: Option<String>,
    pub execution_evidence_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleChatSnapshot {
    pub conversation: SingleChatConversationView,
    pub messages: Vec<SingleChatMessageView>,
    pub prepared_attachments: Vec<PreparedAttachmentView>,
    pub agent_runs: Vec<SingleChatRunView>,
    pub execution_evidence: Vec<AgentRunExecutionEvidenceView>,
}

#[derive(Debug, Default)]
pub struct SingleChatService {
    gateway: DomainCommandGateway,
}

impl SingleChatService {
    pub fn open(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<OpenSingleChatCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            let ActorRef::User { .. } = &envelope.actor else {
                return Ok(rejected(
                    "single_chat.local_user_required",
                    "Single Chat v1 is available only to the local user",
                ));
            };
            if envelope.camp_id.as_deref() != Some(envelope.payload.camp_id.as_str()) {
                return Ok(rejected(
                    "single_chat.camp_mismatch",
                    "Single Chat command is outside the Camp",
                ));
            }
            if !active_member(
                transaction,
                &envelope.payload.camp_id,
                &envelope.payload.agent_id,
            )? {
                return Ok(rejected(
                    "single_chat.member_unavailable",
                    "Single Chat target is not an active Camp member",
                ));
            }
            let active = transaction
                .query_row(
                    r#"
                    SELECT id, version
                    FROM conversation
                    WHERE camp_id = ?1 AND agent_id = ?2
                      AND kind = 'single_chat' AND ended_at IS NULL
                    "#,
                    params![envelope.payload.camp_id, envelope.payload.agent_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .optional()?;
            if let Some((conversation_id, version)) = active {
                return Ok(CommandHandlerResult::applied(
                    "single_chat.opened",
                    json!({
                        "conversationId": conversation_id,
                        "conversationVersion": version,
                        "created": false,
                    }),
                    Some(entity_ref("conversation", &conversation_id)),
                ));
            }

            let conversation_id = Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                INSERT INTO conversation(
                    id, camp_id, agent_id, kind,
                    summary_through_message_sequence, last_message_sequence,
                    last_accepted_public_boundary_sequence, last_input_sequence,
                    native_binding_generation, version, created_at, updated_at
                ) VALUES (?1, ?2, ?3, 'single_chat', 0, 0, 0, 0, 0, 1, ?4, ?4)
                "#,
                params![
                    conversation_id,
                    envelope.payload.camp_id,
                    envelope.payload.agent_id,
                    now
                ],
            )?;
            append_domain_event(
                transaction,
                "single_chat.opened",
                Some(&envelope.payload.camp_id),
                Some(("conversation", &conversation_id)),
                &envelope.actor,
                None,
                &json!({
                    "agentId": envelope.payload.agent_id,
                    "conversationVersion": 1,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "single_chat.opened",
                json!({
                    "conversationId": conversation_id,
                    "conversationVersion": 1,
                    "created": true,
                }),
                Some(entity_ref("conversation", &conversation_id)),
            ))
        })
    }

    pub fn send(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<SendSingleChatMessageCommand>,
    ) -> Result<CommandExecution> {
        if envelope.payload.body.trim().is_empty() && envelope.payload.attachment_ids.is_empty() {
            anyhow::bail!("Single Chat body and attachments must not both be empty");
        }
        if envelope.payload.attachment_ids.len() > 10 {
            anyhow::bail!("Single Chat accepts at most 10 attachments per message");
        }
        if envelope.payload.body.chars().count() > 100_000 {
            anyhow::bail!("Single Chat body exceeds the 100000-character limit");
        }
        self.gateway.execute(database, envelope, |transaction| {
            let ActorRef::User { user_id } = &envelope.actor else {
                return Ok(rejected(
                    "single_chat.local_user_required",
                    "Single Chat v1 is available only to the local user",
                ));
            };
            let target = load_active_target(transaction, &envelope.payload.conversation_id)?;
            let Some(target) = target else {
                return Ok(rejected(
                    "single_chat.not_active",
                    "Single Chat does not exist or has ended",
                ));
            };
            if envelope.camp_id.as_deref() != Some(target.camp_id.as_str())
                || envelope.payload.camp_id != target.camp_id
            {
                return Ok(rejected(
                    "single_chat.camp_mismatch",
                    "Single Chat command is outside the Camp",
                ));
            }
            if target.version != envelope.payload.expected_conversation_version {
                return Ok(CommandHandlerResult::rejected(
                    "single_chat.version_conflict",
                    json!({ "currentVersion": target.version }),
                ));
            }
            if !active_member(transaction, &target.camp_id, &target.agent_id)? {
                return Ok(rejected(
                    "single_chat.member_unavailable",
                    "Single Chat target is not an active Camp member",
                ));
            }
            let prepared_attachments = load_prepared_attachment_rows(
                transaction,
                &target.conversation_id,
                &envelope.payload.attachment_ids,
            )?;
            let busy_run = transaction
                .query_row(
                    "SELECT id, status FROM agent_run WHERE conversation_id = ?1 AND invocation_kind = 'single_chat' AND status IN ('queued', 'running', 'waiting') ORDER BY created_at, id LIMIT 1",
                    [&target.conversation_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;
            if let Some((agent_run_id, status)) = busy_run {
                return Ok(CommandHandlerResult::rejected(
                    "single_chat.reply_in_progress",
                    json!({ "agentRunId": agent_run_id, "status": status }),
                ));
            }

            let runtime = match resolve_frozen_runtime(
                transaction,
                &target.conversation_id,
                &target.agent_id,
            )? {
                Ok(runtime) => runtime,
                Err(blocker) => {
                    return Ok(CommandHandlerResult::rejected(
                        "single_chat.runtime_not_ready",
                        json!({
                            "agentId": target.agent_id,
                            "conversationId": target.conversation_id,
                            "blockerCode": blocker.code,
                            "detail": blocker.payload,
                        }),
                    ));
                }
            };
            let accepted_at = chrono::Utc::now();
            let now = accepted_at.to_rfc3339();
            let budget = freeze_camp_turn_execution_budget(None, accepted_at, 1)?;
            let conversation_message_id = Uuid::new_v4().to_string();
            let camp_turn_id = Uuid::new_v4().to_string();
            let agent_run_id = Uuid::new_v4().to_string();
            let updated = transaction.execute(
                r#"
                UPDATE conversation
                SET last_message_sequence = last_message_sequence + 1,
                    version = version + 1,
                    updated_at = ?3
                WHERE id = ?1 AND version = ?2
                  AND kind = 'single_chat' AND ended_at IS NULL
                "#,
                params![
                    target.conversation_id,
                    envelope.payload.expected_conversation_version,
                    now
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "single_chat.version_conflict",
                    "Single Chat changed before this message was admitted",
                ));
            }
            let conversation_sequence = target.last_message_sequence + 1;
            let effective_config = build_effective_config(
                transaction,
                &target.conversation_id,
                &target.agent_id,
                &runtime,
            )?;
            transaction.execute(
                r#"
                INSERT INTO camp_turn(
                    id, camp_id, trigger_type, trigger_id, kind, status,
                    execution_budget_schema_version,
                    execution_budget_accepted_at, execution_budget_deadline_at,
                    execution_budget_elapsed_seconds,
                    execution_budget_max_agent_run_responsibilities,
                    execution_budget_max_accepted_a2a,
                    execution_budget_root_agent_run_responsibilities,
                    version, created_at, updated_at
                ) VALUES (
                    ?1, ?2, 'conversation_message', ?3, 'single_chat', 'running',
                    ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?5, ?5
                )
                "#,
                params![
                    camp_turn_id,
                    target.camp_id,
                    conversation_message_id,
                    budget.schema_version,
                    now,
                    budget.deadline_at,
                    budget.elapsed_seconds,
                    budget.max_agent_run_responsibilities,
                    budget.max_accepted_a2a,
                    budget.root_agent_run_responsibilities,
                ],
            )?;
            transaction.execute(
                r#"
                INSERT INTO agent_run(
                    id, camp_turn_id, conversation_id,
                    trigger_conversation_message_id, input_ready_at,
                    initial_camp_context_through_sequence,
                    initial_conversation_context_through_sequence,
                    responsibility_key, responsibility_generation,
                    start_reason, purpose, completion_role,
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
                    invocation_kind, response_delivery, operation_policy,
                    operation_policy_version, destination_conversation_id,
                    status, idempotency_key, version,
                    created_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                    ?8, 0, 'initial', ?9, 'required',
                    ?10, NULL, 'runtime_managed_v2',
                    ?11, ?12, ?13, ?14, ?15, ?16, ?15, ?16,
                    ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25,
                    'single_chat', 'conversation_message', 'single_chat_v1', 1, ?3,
                    'queued', ?26, 1, ?5, ?5
                )
                "#,
                params![
                    agent_run_id,
                    camp_turn_id,
                    target.conversation_id,
                    conversation_message_id,
                    now,
                    target.current_public_boundary_sequence,
                    conversation_sequence,
                    format!("single_chat/{}", target.agent_id),
                    "Respond to the user's Single Chat message",
                    serde_json::to_string(&effective_config)?,
                    runtime.adapter_kind.as_str(),
                    runtime.installation_id,
                    runtime.executable_path,
                    runtime.auth_scope,
                    runtime.reported_version,
                    runtime.executable_fingerprint,
                    serde_json::to_string(&runtime.capabilities)?,
                    serde_json::to_string(&runtime.model)?,
                    serde_json::to_string(&runtime.permissions)?,
                    runtime.binding_compatibility_digest,
                    runtime.host_config_digest,
                    runtime.protocol_version,
                    runtime.installation_generation,
                    runtime.search_environment_generation,
                    runtime.native_session_compatibility_key,
                    envelope.command_id,
                ],
            )?;
            transaction.execute(
                r#"
                INSERT INTO conversation_message(
                    id, conversation_id, sequence,
                    author_type, author_id, source_agent_run_id, body,
                    source_camp_message_id, source_inbox_message_id,
                    camp_turn_id, agent_run_id, created_at
                ) VALUES (?1, ?2, ?3, 'user', ?4, NULL, ?5, NULL, NULL, ?6, ?7, ?8)
                "#,
                params![
                    conversation_message_id,
                    target.conversation_id,
                    conversation_sequence,
                    user_id,
                    envelope.payload.body.trim(),
                    camp_turn_id,
                    agent_run_id,
                    now,
                ],
            )?;
            consume_prepared_attachments(
                transaction,
                &target,
                &conversation_message_id,
                prepared_attachments,
                &now,
            )?;
            append_domain_event(
                transaction,
                "single_chat.message_sent",
                Some(&target.camp_id),
                Some(("conversation_message", &conversation_message_id)),
                &envelope.actor,
                None,
                &json!({
                    "conversationId": target.conversation_id,
                    "conversationVersion": target.version + 1,
                    "campTurnId": camp_turn_id,
                    "agentRunId": agent_run_id,
                    "publicBoundary": target.current_public_boundary_sequence,
                    "attachmentIds": envelope.payload.attachment_ids,
                }),
            )?;
            append_domain_event(
                transaction,
                "agent_run.queued",
                Some(&target.camp_id),
                Some(("agent_run", &agent_run_id)),
                &envelope.actor,
                None,
                &json!({
                    "campTurnId": camp_turn_id,
                    "conversationId": target.conversation_id,
                    "invocationKind": "single_chat",
                    "responseDelivery": SINGLE_CHAT_RESPONSE_DELIVERY,
                    "operationPolicy": SINGLE_CHAT_OPERATION_POLICY,
                    "operationPolicyVersion": SINGLE_CHAT_OPERATION_POLICY_VERSION,
                }),
            )?;
            Ok(CommandHandlerResult::accepted(
                "single_chat.reply_queued",
                json!({
                    "conversationId": target.conversation_id,
                    "conversationVersion": target.version + 1,
                    "conversationMessageId": conversation_message_id,
                    "campTurnId": camp_turn_id,
                    "agentRunId": agent_run_id,
                }),
                Some(entity_ref("agent_run", &agent_run_id)),
            ))
        })
    }

    pub fn end(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<EndSingleChatCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            let ActorRef::User { .. } = &envelope.actor else {
                return Ok(rejected(
                    "single_chat.local_user_required",
                    "Single Chat v1 is available only to the local user",
                ));
            };
            let target = load_active_target(transaction, &envelope.payload.conversation_id)?;
            let Some(target) = target else {
                return Ok(rejected(
                    "single_chat.not_active",
                    "Single Chat does not exist or has ended",
                ));
            };
            if envelope.camp_id.as_deref() != Some(target.camp_id.as_str())
                || envelope.payload.camp_id != target.camp_id
            {
                return Ok(rejected(
                    "single_chat.camp_mismatch",
                    "Single Chat command is outside the Camp",
                ));
            }
            if target.version != envelope.payload.expected_conversation_version {
                return Ok(CommandHandlerResult::rejected(
                    "single_chat.version_conflict",
                    json!({ "currentVersion": target.version }),
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            let updated = transaction.execute(
                r#"
                UPDATE conversation
                SET ended_at = ?3, ended_reason = 'user_ended',
                    ended_binding_generation = native_binding_generation,
                    version = version + 1, updated_at = ?3
                WHERE id = ?1 AND version = ?2
                  AND kind = 'single_chat' AND ended_at IS NULL
                "#,
                params![
                    target.conversation_id,
                    envelope.payload.expected_conversation_version,
                    now
                ],
            )?;
            if updated != 1 {
                return Ok(rejected(
                    "single_chat.version_conflict",
                    "Single Chat changed before it could be ended",
                ));
            }
            let active_run = transaction
                .query_row(
                    "SELECT id, camp_turn_id, execution_epoch FROM agent_run WHERE conversation_id = ?1 AND invocation_kind = 'single_chat' AND status IN ('queued', 'running', 'waiting') ORDER BY created_at, id LIMIT 1",
                    [&target.conversation_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?)),
                )
                .optional()?;
            let mut cancelled_agent_run_id = None;
            if let Some((agent_run_id, camp_turn_id, execution_epoch)) = active_run {
                settle_abortive_agent_run_in_tx(
                    transaction,
                    &agent_run_id,
                    "single_chat_ended",
                    &envelope.actor,
                    &now,
                )?;
                recompute_camp_turn(
                    transaction,
                    &target.camp_id,
                    &camp_turn_id,
                    &envelope.actor,
                    Some(execution_epoch),
                    &now,
                )?;
                cancelled_agent_run_id = Some(agent_run_id);
            }
            transaction.execute(
                "DELETE FROM single_chat_prepared_attachment WHERE conversation_id = ?1",
                [&target.conversation_id],
            )?;
            append_domain_event(
                transaction,
                "single_chat.ended",
                Some(&target.camp_id),
                Some(("conversation", &target.conversation_id)),
                &envelope.actor,
                None,
                &json!({
                    "agentId": target.agent_id,
                    "conversationVersion": target.version + 1,
                    "cancelledAgentRunId": cancelled_agent_run_id,
                    "bindingGeneration": target.native_binding_generation,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "single_chat.ended",
                json!({
                    "conversationId": target.conversation_id,
                    "conversationVersion": target.version + 1,
                    "cancelledAgentRunId": cancelled_agent_run_id,
                }),
                Some(entity_ref("conversation", &target.conversation_id)),
            ))
        })
    }

    pub fn list_active(
        &self,
        database: &Database,
        camp_id: &str,
    ) -> Result<Vec<SingleChatConversationView>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT conversation.id, conversation.camp_id, conversation.agent_id,
                   conversation.version, conversation.last_message_sequence,
                   conversation.last_accepted_public_boundary_sequence,
                   conversation.created_at, conversation.updated_at, conversation.ended_at,
                   (SELECT id FROM agent_run
                    WHERE agent_run.conversation_id = conversation.id
                      AND agent_run.invocation_kind = 'single_chat'
                      AND agent_run.status IN ('queued', 'running', 'waiting')
                    ORDER BY agent_run.created_at, agent_run.id LIMIT 1)
            FROM conversation
            WHERE conversation.camp_id = ?1
              AND conversation.kind = 'single_chat'
              AND conversation.ended_at IS NULL
            ORDER BY conversation.updated_at DESC, conversation.id DESC
            "#,
        )?;
        Ok(statement
            .query_map([camp_id], conversation_view_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn snapshot(
        &self,
        database: &Database,
        conversation_id: &str,
    ) -> Result<Option<SingleChatSnapshot>> {
        let conversation = database
            .connection()
            .query_row(
                r#"
                SELECT conversation.id, conversation.camp_id, conversation.agent_id,
                       conversation.version, conversation.last_message_sequence,
                       conversation.last_accepted_public_boundary_sequence,
                       conversation.created_at, conversation.updated_at, conversation.ended_at,
                       (SELECT id FROM agent_run
                        WHERE agent_run.conversation_id = conversation.id
                          AND agent_run.invocation_kind = 'single_chat'
                          AND agent_run.status IN ('queued', 'running', 'waiting')
                        ORDER BY agent_run.created_at, agent_run.id LIMIT 1)
                FROM conversation
                WHERE conversation.id = ?1 AND conversation.kind = 'single_chat'
                "#,
                [conversation_id],
                conversation_view_from_row,
            )
            .optional()?;
        let Some(conversation) = conversation else {
            return Ok(None);
        };
        let mut attachments_by_message = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT conversation_message_id, id, display_name, kind, file_count,
                       media_type, byte_size, preview_kind
                FROM single_chat_message_attachment
                WHERE conversation_id = ?1
                ORDER BY conversation_message_id, position, id
                "#,
            )?;
            let mut grouped: HashMap<String, Vec<CampMessageAttachmentView>> = HashMap::new();
            for row in statement.query_map([conversation_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    CampMessageAttachmentView {
                        id: row.get(1)?,
                        display_name: row.get(2)?,
                        kind: row.get(3)?,
                        file_count: row.get::<_, i64>(4)?.max(0) as u64,
                        media_type: row.get(5)?,
                        byte_size: row.get(6)?,
                        preview_kind: row.get(7)?,
                        runtime_projection_state: "available".to_string(),
                    },
                ))
            })? {
                let (message_id, attachment) = row?;
                grouped.entry(message_id).or_default().push(attachment);
            }
            grouped
        };
        let messages = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT id, sequence, author_type, author_id, body, agent_run_id, created_at
                FROM conversation_message
                WHERE conversation_id = ?1
                ORDER BY sequence, id
                "#,
            )?;
            statement
                .query_map([conversation_id], |row| {
                    Ok(SingleChatMessageView {
                        id: row.get(0)?,
                        sequence: row.get(1)?,
                        author_type: row.get(2)?,
                        author_id: row.get(3)?,
                        body: row.get(4)?,
                        attachments: attachments_by_message
                            .remove(&row.get::<_, String>(0)?)
                            .unwrap_or_default(),
                        agent_run_id: row.get(5)?,
                        created_at: row.get(6)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let prepared_attachments = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT id, display_name, kind, file_count, media_type,
                       byte_size, preview_kind, created_at
                FROM single_chat_prepared_attachment
                WHERE conversation_id = ?1
                ORDER BY ordinal, id
                "#,
            )?;
            statement
                .query_map([conversation_id], |row| {
                    Ok(PreparedAttachmentView {
                        id: row.get(0)?,
                        display_name: row.get(1)?,
                        kind: row.get(2)?,
                        file_count: row.get::<_, i64>(3)?.max(0) as u64,
                        media_type: row.get(4)?,
                        byte_size: row.get::<_, i64>(5)?.max(0) as u64,
                        preview_kind: row.get(6)?,
                        state: "ready".to_string(),
                        error_message: None,
                        created_at: row.get(7)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let agent_runs = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT agent_run.id, agent_run.trigger_conversation_message_id,
                       agent_run.status, agent_run.version, agent_run.execution_epoch,
                       agent_run.cancel_requested_at, agent_run.last_error_code,
                       agent_run.created_at, agent_run.started_at, agent_run.ended_at,
                       agent_run.final_conversation_message_id,
                       (SELECT COUNT(*) FROM agent_run_execution_evidence AS evidence
                        WHERE evidence.agent_run_id = agent_run.id)
                FROM agent_run
                WHERE agent_run.conversation_id = ?1
                  AND agent_run.invocation_kind = 'single_chat'
                ORDER BY agent_run.created_at, agent_run.id
                "#,
            )?;
            statement
                .query_map([conversation_id], |row| {
                    Ok(SingleChatRunView {
                        id: row.get(0)?,
                        trigger_conversation_message_id: row.get(1)?,
                        status: row.get(2)?,
                        version: row.get(3)?,
                        execution_epoch: row.get(4)?,
                        cancel_requested_at: row.get(5)?,
                        last_error_code: row.get(6)?,
                        created_at: row.get(7)?,
                        started_at: row.get(8)?,
                        ended_at: row.get(9)?,
                        final_conversation_message_id: row.get(10)?,
                        execution_evidence_count: row.get(11)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut execution_evidence = Vec::new();
        for run in &agent_runs {
            execution_evidence.extend(public_execution_evidence_for_agent_run(
                database.connection(),
                &run.id,
            )?);
        }
        Ok(Some(SingleChatSnapshot {
            conversation,
            messages,
            prepared_attachments,
            agent_runs,
            execution_evidence,
        }))
    }
}

#[derive(Debug)]
struct ActiveTarget {
    conversation_id: String,
    camp_id: String,
    agent_id: String,
    version: i64,
    last_message_sequence: i64,
    current_public_boundary_sequence: i64,
    native_binding_generation: i64,
}

#[derive(Debug)]
struct PreparedAttachmentRow {
    id: String,
    display_name: String,
    kind: String,
    file_count: i64,
    media_type: String,
    byte_size: i64,
    content_digest: String,
    storage_path: String,
    preview_kind: String,
}

fn load_prepared_attachment_rows(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    requested_attachment_ids: &[String],
) -> Result<Vec<PreparedAttachmentRow>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, display_name, kind, file_count, media_type, byte_size,
               content_digest, storage_path, preview_kind
        FROM single_chat_prepared_attachment
        WHERE conversation_id = ?1
        ORDER BY ordinal, id
        "#,
    )?;
    let rows = statement
        .query_map([conversation_id], |row| {
            Ok(PreparedAttachmentRow {
                id: row.get(0)?,
                display_name: row.get(1)?,
                kind: row.get(2)?,
                file_count: row.get(3)?,
                media_type: row.get(4)?,
                byte_size: row.get(5)?,
                content_digest: row.get(6)?,
                storage_path: row.get(7)?,
                preview_kind: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let stored = rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>();
    let requested = requested_attachment_ids
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    if stored != requested {
        anyhow::bail!("Single Chat attachments changed before send");
    }
    Ok(rows)
}

fn consume_prepared_attachments(
    transaction: &Transaction<'_>,
    target: &ActiveTarget,
    conversation_message_id: &str,
    rows: Vec<PreparedAttachmentRow>,
    now: &str,
) -> Result<()> {
    for (position, row) in rows.into_iter().enumerate() {
        transaction.execute(
            r#"
            INSERT INTO single_chat_message_attachment(
                id, camp_id, conversation_id, conversation_message_id, position,
                display_name, kind, file_count, media_type, byte_size,
                content_digest, storage_path, preview_kind, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            "#,
            params![
                row.id,
                target.camp_id,
                target.conversation_id,
                conversation_message_id,
                position as i64,
                row.display_name,
                row.kind,
                row.file_count,
                row.media_type,
                row.byte_size,
                row.content_digest,
                row.storage_path,
                row.preview_kind,
                now,
            ],
        )?;
    }
    transaction.execute(
        "DELETE FROM single_chat_prepared_attachment WHERE conversation_id = ?1",
        [&target.conversation_id],
    )?;
    Ok(())
}

fn load_active_target(
    transaction: &Transaction<'_>,
    conversation_id: &str,
) -> Result<Option<ActiveTarget>> {
    Ok(transaction
        .query_row(
            r#"
            SELECT conversation.id, conversation.camp_id, conversation.agent_id,
                   conversation.version, conversation.last_message_sequence,
                   camp.last_message_sequence, conversation.native_binding_generation
            FROM conversation
            JOIN camp ON camp.id = conversation.camp_id
            WHERE conversation.id = ?1
              AND conversation.kind = 'single_chat'
              AND conversation.ended_at IS NULL
              AND camp.activation_state = 'active'
            "#,
            [conversation_id],
            |row| {
                Ok(ActiveTarget {
                    conversation_id: row.get(0)?,
                    camp_id: row.get(1)?,
                    agent_id: row.get(2)?,
                    version: row.get(3)?,
                    last_message_sequence: row.get(4)?,
                    current_public_boundary_sequence: row.get(5)?,
                    native_binding_generation: row.get(6)?,
                })
            },
        )
        .optional()?)
}

fn active_member(transaction: &Transaction<'_>, camp_id: &str, agent_id: &str) -> Result<bool> {
    Ok(transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM camp_member
            JOIN camp ON camp.id = camp_member.camp_id
            JOIN agent_profile ON agent_profile.id = camp_member.agent_id
            WHERE camp_member.camp_id = ?1
              AND camp_member.agent_id = ?2
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'present'
              AND camp.activation_state = 'active'
        )
        "#,
        params![camp_id, agent_id],
        |row| row.get(0),
    )?)
}

fn conversation_view_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<SingleChatConversationView> {
    let ended_at = row.get::<_, Option<String>>(8)?;
    Ok(SingleChatConversationView {
        id: row.get(0)?,
        camp_id: row.get(1)?,
        agent_id: row.get(2)?,
        version: row.get(3)?,
        status: if ended_at.is_some() {
            "ended".to_string()
        } else {
            "active".to_string()
        },
        last_message_sequence: row.get(4)?,
        last_accepted_public_boundary_sequence: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        ended_at,
        active_agent_run_id: row.get(9)?,
    })
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({ "message": message }))
}

fn entity_ref(entity_type: &str, entity_id: &str) -> EntityReference {
    EntityReference {
        entity_type: entity_type.to_string(),
        entity_id: entity_id.to_string(),
    }
}

pub fn single_chat_run_policy(
    database: &Database,
    agent_run_id: &str,
    execution_epoch: i64,
) -> Result<Option<(String, String, String, i64)>> {
    Ok(database
        .connection()
        .query_row(
            r#"
            SELECT camp_turn.camp_id, agent_run.response_delivery,
                   agent_run.operation_policy, agent_run.operation_policy_version
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE agent_run.id = ?1 AND agent_run.execution_epoch = ?2
              AND agent_run.invocation_kind = 'single_chat'
            "#,
            params![agent_run_id, execution_epoch],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?)
}

pub fn authorize_builtin_operation(
    database: &Database,
    agent_run_id: &str,
    execution_epoch: i64,
    operation: &str,
    input: &Value,
) -> Result<Option<CommandHandlerResult>> {
    let Some((camp_id, response_delivery, operation_policy, policy_version)) =
        single_chat_run_policy(database, agent_run_id, execution_epoch)?
    else {
        return Ok(None);
    };
    if response_delivery != SINGLE_CHAT_RESPONSE_DELIVERY
        || operation_policy != SINGLE_CHAT_OPERATION_POLICY
        || policy_version != SINGLE_CHAT_OPERATION_POLICY_VERSION
    {
        anyhow::bail!("Single Chat AgentRun has an invalid frozen operation policy");
    }
    let allowed = matches!(
        operation,
        "camp.search"
            | "camp.read"
            | "team.get_task"
            | "team.list_tasks"
            | "memory.view"
            | "memory.search"
            | "memory.read"
    );
    if !allowed {
        return Ok(Some(CommandHandlerResult::rejected(
            "single_chat.operation_denied",
            json!({
                "message": "This Rovai operation is unavailable in Single Chat.",
                "operation": operation,
                "operationPolicy": SINGLE_CHAT_OPERATION_POLICY,
            }),
        )));
    }
    if matches!(operation, "camp.search" | "camp.read") {
        let requested_camp_id = input
            .get("campId")
            .or_else(|| input.get("camp_id"))
            .and_then(Value::as_str);
        if requested_camp_id.is_some_and(|requested| requested != camp_id) {
            return Ok(Some(CommandHandlerResult::rejected(
                "single_chat.cross_camp_denied",
                json!({
                    "message": "Single Chat can only read the current Camp.",
                    "operation": operation,
                    "campId": requested_camp_id,
                }),
            )));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        collaboration::{CollaborationService, CreateCampCommand},
        command::CommandResultStatus,
        runtime::{ExecutionRuntimeService, SucceedAgentRunCommand},
        single_chat_attachment::SingleChatAttachmentStore,
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

    fn fixture() -> (crate::test_support::OwnedTestDatabase, String) {
        let mut database = crate::test_support::seeded_runtime_database_owned();
        let workspace = database.directory().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let created = CollaborationService::default()
            .create_camp(
                &mut database,
                &user_envelope(
                    "single-chat-create-camp",
                    None,
                    CreateCampCommand::for_test(workspace.to_string_lossy().to_string()),
                ),
            )
            .unwrap();
        assert_eq!(created.result.status, CommandResultStatus::Applied);
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        (database, camp_id)
    }

    fn open(
        service: &SingleChatService,
        database: &mut Database,
        camp_id: &str,
        command_id: &str,
    ) -> (String, i64) {
        let opened = service
            .open(
                database,
                &user_envelope(
                    command_id,
                    Some(camp_id),
                    OpenSingleChatCommand {
                        camp_id: camp_id.to_string(),
                        agent_id: "agent_1".to_string(),
                    },
                ),
            )
            .unwrap();
        assert_eq!(opened.result.status, CommandResultStatus::Applied);
        (
            opened.result.payload["conversationId"]
                .as_str()
                .unwrap()
                .to_string(),
            opened.result.payload["conversationVersion"]
                .as_i64()
                .unwrap(),
        )
    }

    fn send(
        service: &SingleChatService,
        database: &mut Database,
        camp_id: &str,
        conversation_id: &str,
        version: i64,
        command_id: &str,
    ) -> CommandExecution {
        service
            .send(
                database,
                &user_envelope(
                    command_id,
                    Some(camp_id),
                    SendSingleChatMessageCommand {
                        camp_id: camp_id.to_string(),
                        conversation_id: conversation_id.to_string(),
                        body: "请检查这一处设计".to_string(),
                        attachment_ids: Vec::new(),
                        expected_conversation_version: version,
                    },
                ),
            )
            .unwrap()
    }

    #[test]
    fn send_is_atomic_per_conversation_and_end_does_not_fence_a_successor() {
        let (mut database, camp_id) = fixture();
        let service = SingleChatService::default();
        let (conversation_id, version) =
            open(&service, &mut database, &camp_id, "single-chat-open-first");
        let first = send(
            &service,
            &mut database,
            &camp_id,
            &conversation_id,
            version,
            "single-chat-send-first",
        );
        assert_eq!(first.result.status, CommandResultStatus::Accepted);
        let first_run_id = first.result.payload["agentRunId"]
            .as_str()
            .unwrap()
            .to_string();
        let route_rewrite = database.connection().execute(
            r#"
            UPDATE agent_run
            SET invocation_kind = 'a2a',
                response_delivery = 'camp_message',
                operation_policy = 'camp_member_v1',
                destination_conversation_id = NULL
            WHERE id = ?1
            "#,
            [&first_run_id],
        );
        assert!(
            route_rewrite
                .unwrap_err()
                .to_string()
                .contains("agent_run output route is immutable"),
            "a Single Chat Run cannot be rewritten into an ordinary public route"
        );
        let busy = send(
            &service,
            &mut database,
            &camp_id,
            &conversation_id,
            version + 1,
            "single-chat-send-busy",
        );
        assert_eq!(busy.result.status, CommandResultStatus::Rejected);
        assert_eq!(busy.result.code, "single_chat.reply_in_progress");
        let user_messages: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM conversation_message WHERE conversation_id = ?1 AND author_type = 'user'",
                [&conversation_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            user_messages, 1,
            "a rejected send must not append user input"
        );

        let ended = service
            .end(
                &mut database,
                &user_envelope(
                    "single-chat-end-first",
                    Some(&camp_id),
                    EndSingleChatCommand {
                        camp_id: camp_id.clone(),
                        conversation_id: conversation_id.clone(),
                        expected_conversation_version: version + 1,
                    },
                ),
            )
            .unwrap();
        assert_eq!(ended.result.status, CommandResultStatus::Applied);
        let old_status: String = database
            .connection()
            .query_row(
                "SELECT status FROM agent_run WHERE id = ?1",
                [&first_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_status, "cancelled");

        let (successor_id, successor_version) = open(
            &service,
            &mut database,
            &camp_id,
            "single-chat-open-successor",
        );
        assert_ne!(successor_id, conversation_id);
        let successor = send(
            &service,
            &mut database,
            &camp_id,
            &successor_id,
            successor_version,
            "single-chat-send-successor",
        );
        assert_eq!(successor.result.status, CommandResultStatus::Accepted);
    }

    #[test]
    fn successful_final_is_private_and_a_cancelled_run_cannot_append_late_output() {
        let (mut database, camp_id) = fixture();
        let service = SingleChatService::default();
        let runtime = ExecutionRuntimeService::default();
        let (conversation_id, version) = open(
            &service,
            &mut database,
            &camp_id,
            "single-chat-open-terminal",
        );
        let sent = send(
            &service,
            &mut database,
            &camp_id,
            &conversation_id,
            version,
            "single-chat-send-terminal",
        );
        let run_id = sent.result.payload["agentRunId"]
            .as_str()
            .unwrap()
            .to_string();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'running', execution_epoch = 1, started_at = updated_at WHERE id = ?1",
                [&run_id],
            )
            .unwrap();
        let completed = runtime
            .succeed_agent_run(
                &mut database,
                &CommandEnvelope {
                    command_id: "single-chat-terminal-success".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:test".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SucceedAgentRunCommand {
                        agent_run_id: run_id.clone(),
                        expected_version: 1,
                        execution_epoch: 1,
                        native_turn_id: "native-turn-private".to_string(),
                        final_output: "这是只写入单聊的最终回答。".to_string(),
                        missing_send_recovery_candidate: None,
                        ending_git_observation: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(completed.result.status, CommandResultStatus::Applied);
        assert!(completed.result.payload["finalCampMessageId"].is_null());
        let public_messages: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_message WHERE source_agent_run_id = ?1",
                [&run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(public_messages, 0);
        let private_messages: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM conversation_message WHERE conversation_id = ?1 AND author_type = 'agent' AND source_agent_run_id = ?2",
                params![conversation_id, run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(private_messages, 1);

        let (cancel_conversation_id, cancel_version) = {
            service
                .end(
                    &mut database,
                    &user_envelope(
                        "single-chat-end-completed",
                        Some(&camp_id),
                        EndSingleChatCommand {
                            camp_id: camp_id.clone(),
                            conversation_id: conversation_id.clone(),
                            expected_conversation_version: version + 2,
                        },
                    ),
                )
                .unwrap();
            open(&service, &mut database, &camp_id, "single-chat-open-cancel")
        };
        let cancelled_send = send(
            &service,
            &mut database,
            &camp_id,
            &cancel_conversation_id,
            cancel_version,
            "single-chat-send-cancel",
        );
        let cancelled_run_id = cancelled_send.result.payload["agentRunId"]
            .as_str()
            .unwrap()
            .to_string();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'running', execution_epoch = 1, started_at = updated_at WHERE id = ?1",
                [&cancelled_run_id],
            )
            .unwrap();
        service
            .end(
                &mut database,
                &user_envelope(
                    "single-chat-end-cancel",
                    Some(&camp_id),
                    EndSingleChatCommand {
                        camp_id: camp_id.clone(),
                        conversation_id: cancel_conversation_id.clone(),
                        expected_conversation_version: cancel_version + 1,
                    },
                ),
            )
            .unwrap();
        let late = runtime
            .succeed_agent_run(
                &mut database,
                &CommandEnvelope {
                    command_id: "single-chat-terminal-late".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:test".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SucceedAgentRunCommand {
                        agent_run_id: cancelled_run_id,
                        expected_version: 2,
                        execution_epoch: 1,
                        native_turn_id: "native-turn-late".to_string(),
                        final_output: "这条迟到回答不得出现。".to_string(),
                        missing_send_recovery_candidate: None,
                        ending_git_observation: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(late.result.status, CommandResultStatus::Rejected);
        assert_eq!(late.result.code, "agent_run.terminal_fenced");
        let leaked: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM conversation_message WHERE body = '这条迟到回答不得出现。'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(leaked, 0);
    }

    #[test]
    fn built_in_policy_is_a_closed_allowlist_and_restart_cancels_only_the_reply() {
        let (mut database, camp_id) = fixture();
        let service = SingleChatService::default();
        let (conversation_id, version) =
            open(&service, &mut database, &camp_id, "single-chat-open-policy");
        let sent = send(
            &service,
            &mut database,
            &camp_id,
            &conversation_id,
            version,
            "single-chat-send-policy",
        );
        let run_id = sent.result.payload["agentRunId"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(
            authorize_builtin_operation(
                &database,
                &run_id,
                0,
                "camp.read",
                &json!({"campId": camp_id}),
            )
            .unwrap()
            .is_none()
        );
        let send_denial = authorize_builtin_operation(
            &database,
            &run_id,
            0,
            "camp.message.send",
            &json!({"body": "leak"}),
        )
        .unwrap()
        .unwrap();
        assert_eq!(send_denial.code, "single_chat.operation_denied");
        let cross_camp = authorize_builtin_operation(
            &database,
            &run_id,
            0,
            "camp.search",
            &json!({"campId": "rvcamp_01h47kvsy5fk1shh6w1g60eecf"}),
        )
        .unwrap()
        .unwrap();
        assert_eq!(cross_camp.code, "single_chat.cross_camp_denied");

        let cancelled = ExecutionRuntimeService::default()
            .cancel_interrupted_single_chat_runs(&mut database)
            .unwrap();
        assert_eq!(cancelled, vec![run_id]);
        let snapshot = service
            .snapshot(&database, &conversation_id)
            .unwrap()
            .unwrap();
        assert_eq!(snapshot.conversation.status, "active");
        assert_eq!(snapshot.agent_runs[0].status, "cancelled");
        let next = send(
            &service,
            &mut database,
            &camp_id,
            &conversation_id,
            version + 1,
            "single-chat-send-after-restart",
        );
        assert_eq!(next.result.status, CommandResultStatus::Accepted);
    }

    #[test]
    fn private_attachments_are_consumed_by_one_message_and_projected_only_for_its_run() {
        let (mut database, camp_id) = fixture();
        let service = SingleChatService::default();
        let (conversation_id, version) = open(
            &service,
            &mut database,
            &camp_id,
            "single-chat-open-attachment",
        );
        let store = SingleChatAttachmentStore::new(database.directory());
        let source = database.directory().join("private-input.md");
        std::fs::write(&source, b"private single chat attachment").unwrap();
        let plan = store
            .plan_prepare_from_path(
                &database,
                &conversation_id,
                version,
                &source,
                "private-input.md",
            )
            .unwrap();
        let prepared = store.prepare_from_path_filesystem(plan).unwrap();
        store
            .commit_prepared_attachment(&mut database, &prepared)
            .unwrap();
        let staged = service
            .snapshot(&database, &conversation_id)
            .unwrap()
            .unwrap();
        assert_eq!(staged.prepared_attachments.len(), 1);
        let attachment_id = staged.prepared_attachments[0].id.clone();

        let sent = service
            .send(
                &mut database,
                &user_envelope(
                    "single-chat-send-attachment",
                    Some(&camp_id),
                    SendSingleChatMessageCommand {
                        camp_id: camp_id.clone(),
                        conversation_id: conversation_id.clone(),
                        body: String::new(),
                        attachment_ids: vec![attachment_id.clone()],
                        expected_conversation_version: version,
                    },
                ),
            )
            .unwrap();
        assert_eq!(sent.result.status, CommandResultStatus::Accepted);
        let run_id = sent.result.payload["agentRunId"].as_str().unwrap();
        let snapshot = service
            .snapshot(&database, &conversation_id)
            .unwrap()
            .unwrap();
        assert!(snapshot.prepared_attachments.is_empty());
        assert_eq!(snapshot.messages.len(), 1);
        assert_eq!(snapshot.messages[0].body, "");
        assert_eq!(snapshot.messages[0].attachments.len(), 1);
        assert_eq!(snapshot.messages[0].attachments[0].id, attachment_id);

        let run_tmp = database.directory().join("run-tmp-attachment-test");
        std::fs::create_dir_all(&run_tmp).unwrap();
        let projection = store
            .plan_runtime_projection(&database, run_id, 0)
            .and_then(|plan| store.project_runtime_attachments_filesystem(plan, &run_tmp))
            .unwrap()
            .expect("the current Single Chat input should have a private projection");
        let projected = projection.join(&attachment_id).join("private-input.md");
        assert_eq!(
            std::fs::read(projected).unwrap(),
            b"private single chat attachment"
        );
    }
}
