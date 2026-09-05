use std::collections::{BTreeSet, HashMap, HashSet};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    agent_profile::resolve_frozen_runtime,
    camp_attachment::MAX_PREPARED_ATTACHMENTS,
    collaboration::{append_domain_event, build_effective_config},
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    db::Database,
    execution_budget::freeze_camp_turn_execution_budget,
    local_attachment_source::{
        LocalAttachmentAvailability, LocalAttachmentHistoryView, LocalAttachmentSourceRef,
        LocalAttachmentSourceView, parse_source_attachments, serialize_source_attachments,
        validate_source_attachments,
    },
    read_model::{AgentRunExecutionEvidenceView, public_execution_evidence_for_agent_run},
    runtime::{recompute_camp_turn, settle_abortive_agent_run_in_tx},
    skill::bundled_skill_source_identity,
    skill_projection::PreparedSkillExposure,
};

pub const SINGLE_CHAT_OPERATION_POLICY: &str = "single_chat_v1";
pub const SINGLE_CHAT_OPERATION_POLICY_VERSION: i64 = 1;
pub const SINGLE_CHAT_RESPONSE_DELIVERY: &str = "conversation_message";
pub const SINGLE_CHAT_HISTORY_TOOL_NAME: &str = "single_chat.history";

const SINGLE_CHAT_HISTORY_DEFAULT_LIMIT: usize = 20;
const SINGLE_CHAT_HISTORY_MAX_LIMIT: usize = 50;
const SINGLE_CHAT_FILTERED_BUNDLED_SKILL_SOURCE_IDENTITIES: [&str; 2] = [
    "rovai://bundled/cli-operations",
    "rovai://bundled/memory-stewardship",
];

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
    pub expected_conversation_version: i64,
    pub draft_revision: i64,
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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SingleChatHistoryInput {
    pub before_sequence: Option<i64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleChatHistoryMessage {
    pub sequence: i64,
    pub role: String,
    pub body: String,
    pub attachments: Vec<LocalAttachmentHistoryView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleChatHistoryOutput {
    pub schema_version: i64,
    pub messages: Vec<SingleChatHistoryMessage>,
    pub has_more: bool,
    pub next_before_sequence: Option<i64>,
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
    pub attachments: Vec<LocalAttachmentSourceView>,
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
    pub draft: SingleChatComposerDraftView,
    pub pending_inputs: SingleChatPendingInputsView,
    pub agent_runs: Vec<SingleChatRunView>,
    pub execution_evidence: Vec<AgentRunExecutionEvidenceView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleChatComposerDraftView {
    pub revision: i64,
    pub attachments: Vec<LocalAttachmentSourceView>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleChatPendingInputView {
    pub id: String,
    pub conversation_id: String,
    pub enqueue_sequence: i64,
    pub revision: i64,
    pub state: String,
    pub body: String,
    pub last_attempt_error_code: Option<String>,
    pub attachments: Vec<LocalAttachmentSourceView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleChatPendingInputEditSessionView {
    pub pending_input_id: String,
    pub edit_token: String,
    pub base_pending_revision: i64,
    pub recovery_required: bool,
    pub working_body: String,
    pub working_attachments: Vec<LocalAttachmentSourceView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleChatPendingInputsView {
    pub execution_active: bool,
    pub items: Vec<SingleChatPendingInputView>,
    pub edit_session: Option<SingleChatPendingInputEditSessionView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditSingleChatPendingInputCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
    pub conversation_id: String,
    pub pending_input_id: String,
    pub expected_revision: i64,
    pub edit_token: Option<String>,
    pub action: SingleChatPendingInputEditAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum SingleChatPendingInputEditAction {
    Begin,
    Takeover,
    Save {
        body: String,
    },
    RemoveAttachment {
        #[serde(rename = "attachmentRefId")]
        attachment_ref_id: String,
    },
    ReorderAttachments {
        #[serde(rename = "attachmentRefIds")]
        attachment_ref_ids: Vec<String>,
    },
    Cancel,
    Delete,
}

impl sealed::Sealed for EditSingleChatPendingInputCommand {}
impl DomainCommand for EditSingleChatPendingInputCommand {
    const TYPE: &'static str = "single_chat.pending_input.edit";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishSingleChatPendingInput {
    pub camp_id: String,
    pub conversation_id: String,
    pub pending_input_id: String,
    pub expected_revision: i64,
    pub user_id: String,
}

impl sealed::Sealed for PublishSingleChatPendingInput {}
impl DomainCommand for PublishSingleChatPendingInput {
    const TYPE: &'static str = "single_chat.pending_input.publish";
}

#[derive(Debug, Default)]
pub struct SingleChatService {
    gateway: DomainCommandGateway,
}

impl SingleChatService {
    pub fn history_input_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "beforeSequence": {"type": "integer", "minimum": 1},
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": SINGLE_CHAT_HISTORY_MAX_LIMIT
                }
            }
        })
    }

    pub fn history_output_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": [
                "schemaVersion", "messages", "hasMore", "nextBeforeSequence"
            ],
            "properties": {
                "schemaVersion": {"const": 1},
                "messages": {
                    "type": "array",
                    "maxItems": SINGLE_CHAT_HISTORY_MAX_LIMIT,
                    "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["sequence", "role", "body", "attachments"],
                        "properties": {
                            "sequence": {"type": "integer", "minimum": 1},
                            "role": {"type": "string", "enum": ["user", "assistant"]},
                            "body": {"type": "string"},
                            "attachments": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "required": [
                                        "attachmentId", "name", "kind", "fileCount",
                                        "mediaType", "byteSize"
                                    ],
                                    "properties": {
                                        "attachmentId": {"type": "string", "minLength": 1},
                                        "name": {"type": "string"},
                                        "kind": {
                                            "type": "string",
                                            "enum": ["file", "directory"]
                                        },
                                        "fileCount": {"type": "integer", "minimum": 0},
                                        "mediaType": {"type": "string"},
                                        "byteSize": {"type": "integer", "minimum": 0}
                                    }
                                }
                            }
                        }
                    }
                },
                "hasMore": {"type": "boolean"},
                "nextBeforeSequence": {"type": ["integer", "null"], "minimum": 1}
            }
        })
    }

    pub fn history(
        &self,
        database: &Database,
        agent_run_id: &str,
        execution_epoch: i64,
        input: &SingleChatHistoryInput,
    ) -> Result<SingleChatHistoryOutput> {
        let limit = input.limit.unwrap_or(SINGLE_CHAT_HISTORY_DEFAULT_LIMIT);
        if limit == 0 || limit > SINGLE_CHAT_HISTORY_MAX_LIMIT {
            anyhow::bail!("Single Chat history limit is invalid");
        }
        if input.before_sequence.is_some_and(|sequence| sequence < 1) {
            anyhow::bail!("Single Chat history beforeSequence is invalid");
        }
        let (conversation_id, current_input_sequence) =
            load_single_chat_history_target(database, agent_run_id, execution_epoch)?
                .ok_or_else(|| anyhow::anyhow!("Single Chat history target is unavailable"))?;
        let before_sequence = input
            .before_sequence
            .unwrap_or(current_input_sequence)
            .min(current_input_sequence);
        let mut statement = database.connection().prepare(
            r#"
            SELECT sequence, author_type, body, source_attachments_json
            FROM conversation_message
            WHERE conversation_id = ?1
              AND sequence < ?2
              AND author_type IN ('user', 'agent')
            ORDER BY sequence DESC, id DESC
            LIMIT ?3
            "#,
        )?;
        let mut rows = statement
            .query_map(
                params![conversation_id, before_sequence, (limit + 1) as i64],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let has_more = rows.len() > limit;
        rows.truncate(limit);
        let mut messages = rows
            .into_iter()
            .map(|(sequence, author_type, body, attachments_json)| {
                Ok(SingleChatHistoryMessage {
                    sequence,
                    role: if author_type == "user" {
                        "user".to_string()
                    } else {
                        "assistant".to_string()
                    },
                    body,
                    attachments: history_attachment_views(&attachments_json)?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        messages.reverse();
        let next_before_sequence = has_more.then(|| {
            messages
                .first()
                .expect("a paginated Single Chat history page is non-empty")
                .sequence
        });
        Ok(SingleChatHistoryOutput {
            schema_version: 1,
            messages,
            has_more,
            next_before_sequence,
        })
    }

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
                transaction.execute(
                    "INSERT OR IGNORE INTO single_chat_composer_draft(
                        conversation_id, revision, source_attachments_json, updated_at
                     ) VALUES (?1, 0, '[]', ?2)",
                    params![conversation_id, chrono::Utc::now().to_rfc3339()],
                )?;
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
            transaction.execute(
                "INSERT INTO single_chat_composer_draft(
                    conversation_id, revision, source_attachments_json, updated_at
                 ) VALUES (?1, 0, '[]', ?2)",
                params![conversation_id, now],
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
        if envelope.payload.body.chars().count() > 100_000 {
            anyhow::bail!("Single Chat body exceeds the 100000-character limit");
        }
        if envelope.payload.draft_revision < 0 {
            anyhow::bail!("Single Chat Draft revision is invalid");
        }
        self.gateway.execute(database, envelope, |transaction| {
            let ActorRef::User { user_id } = &envelope.actor else {
                return Ok(rejected(
                    "single_chat.local_user_required",
                    "Single Chat v1 is available only to the local user",
                ));
            };
            let Some(target) = load_active_target(transaction, &envelope.payload.conversation_id)?
            else {
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
            let (draft_revision, source_attachments) =
                load_single_chat_draft_refs(transaction, &target.conversation_id)?;
            if draft_revision != envelope.payload.draft_revision {
                return Ok(CommandHandlerResult::rejected(
                    "single_chat.draft_changed",
                    json!({ "currentDraftRevision": draft_revision }),
                ));
            }
            let body = envelope.payload.body.trim();
            if body.is_empty() && source_attachments.is_empty() {
                return Ok(rejected(
                    "single_chat.empty_message",
                    "Single Chat input must contain text or an attachment",
                ));
            }
            if source_attachments.len() > MAX_PREPARED_ATTACHMENTS {
                anyhow::bail!("Single Chat Source Attachment count exceeds the shared limit");
            }
            if let Err(error) = validate_source_attachments(&source_attachments) {
                return Ok(CommandHandlerResult::rejected(
                    error.code().as_str(),
                    json!({ "message": error.to_string() }),
                ));
            }

            if single_chat_has_active_run(transaction, &target.conversation_id)?
                || single_chat_has_pending_queue(transaction, &target.conversation_id)?
            {
                let pending_input_id = enqueue_single_chat_input(
                    transaction,
                    &target.conversation_id,
                    body,
                    &source_attachments,
                    user_id,
                )?;
                consume_single_chat_draft(transaction, &target.conversation_id, draft_revision)?;
                append_domain_event(
                    transaction,
                    "single_chat.pending_input_queued",
                    Some(&target.camp_id),
                    Some(("single_chat_pending_input", &pending_input_id)),
                    &envelope.actor,
                    None,
                    &json!({
                        "conversationId": target.conversation_id,
                        "attachmentCount": source_attachments.len(),
                    }),
                )?;
                return Ok(CommandHandlerResult::accepted(
                    "single_chat.pending_input_queued",
                    json!({
                        "conversationId": target.conversation_id,
                        "conversationVersion": target.version,
                        "draftRevision": draft_revision + 1,
                        "pendingInputId": pending_input_id,
                    }),
                    Some(entity_ref("single_chat_pending_input", &pending_input_id)),
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
            let admitted = admit_single_chat_message(
                transaction,
                &target,
                user_id,
                body,
                &source_attachments,
                &runtime,
                &envelope.command_id,
                Some(draft_revision),
                &envelope.actor,
            )?;
            Ok(CommandHandlerResult::accepted(
                "single_chat.reply_queued",
                json!({
                    "conversationId": target.conversation_id,
                    "conversationVersion": admitted.conversation_version,
                    "draftRevision": draft_revision + 1,
                    "conversationMessageId": admitted.conversation_message_id,
                    "campTurnId": admitted.camp_turn_id,
                    "agentRunId": admitted.agent_run_id,
                }),
                Some(entity_ref("agent_run", &admitted.agent_run_id)),
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
                "DELETE FROM single_chat_composer_draft WHERE conversation_id = ?1",
                [&target.conversation_id],
            )?;
            transaction.execute(
                "DELETE FROM single_chat_pending_input_edit_session
                 WHERE conversation_id = ?1",
                [&target.conversation_id],
            )?;
            transaction.execute(
                "UPDATE single_chat_pending_input
                 SET state = 'cancelled', revision = revision + 1, updated_at = ?2
                 WHERE conversation_id = ?1 AND state IN ('queued', 'needs_repair')",
                params![target.conversation_id, now],
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

    pub fn add_source_attachment(
        &self,
        database: &mut Database,
        conversation_id: &str,
        expected_draft_revision: i64,
        source_ref: LocalAttachmentSourceRef,
    ) -> Result<SingleChatSnapshot> {
        validate_source_attachments(std::slice::from_ref(&source_ref))
            .map_err(anyhow::Error::new)?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        anyhow::ensure!(
            load_active_target(&transaction, conversation_id)?.is_some(),
            "single_chat.not_active"
        );
        let (revision, mut refs) = load_single_chat_draft_refs(&transaction, conversation_id)?;
        anyhow::ensure!(
            revision == expected_draft_revision,
            "single_chat.draft_changed"
        );
        anyhow::ensure!(
            refs.len() < MAX_PREPARED_ATTACHMENTS,
            "attachment_count_exceeded"
        );
        refs.push(source_ref);
        store_single_chat_draft_refs(
            &transaction,
            conversation_id,
            expected_draft_revision,
            &refs,
        )?;
        transaction.commit()?;
        self.snapshot(database, conversation_id)?
            .context("Single Chat disappeared after its Draft attachment was added")
    }

    pub fn remove_source_attachment(
        &self,
        database: &mut Database,
        conversation_id: &str,
        expected_draft_revision: i64,
        attachment_ref_id: &str,
    ) -> Result<SingleChatSnapshot> {
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        anyhow::ensure!(
            load_active_target(&transaction, conversation_id)?.is_some(),
            "single_chat.not_active"
        );
        let (revision, mut refs) = load_single_chat_draft_refs(&transaction, conversation_id)?;
        anyhow::ensure!(
            revision == expected_draft_revision,
            "single_chat.draft_changed"
        );
        let previous_len = refs.len();
        refs.retain(|source_ref| source_ref.id != attachment_ref_id);
        anyhow::ensure!(refs.len() != previous_len, "attachment_not_found");
        store_single_chat_draft_refs(
            &transaction,
            conversation_id,
            expected_draft_revision,
            &refs,
        )?;
        transaction.commit()?;
        self.snapshot(database, conversation_id)?
            .context("Single Chat disappeared after its Draft attachment was removed")
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_pending_source_attachment(
        &self,
        database: &mut Database,
        camp_id: &str,
        conversation_id: &str,
        pending_input_id: &str,
        expected_revision: i64,
        edit_token: &str,
        source_ref: LocalAttachmentSourceRef,
    ) -> Result<SingleChatSnapshot> {
        validate_source_attachments(std::slice::from_ref(&source_ref))
            .map_err(anyhow::Error::new)?;
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let target =
            load_active_target(&transaction, conversation_id)?.context("single_chat.not_active")?;
        anyhow::ensure!(target.camp_id == camp_id, "single_chat.camp_mismatch");
        let pending_revision = transaction
            .query_row(
                "SELECT revision FROM single_chat_pending_input
                 WHERE conversation_id = ?1 AND id = ?2
                   AND state IN ('queued', 'needs_repair')",
                params![conversation_id, pending_input_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        anyhow::ensure!(
            pending_revision == Some(expected_revision),
            "single_chat.pending_input_changed"
        );
        let working_json = transaction
            .query_row(
                "SELECT working_source_attachments_json
                 FROM single_chat_pending_input_edit_session
                 WHERE conversation_id = ?1 AND pending_input_id = ?2
                   AND edit_token = ?3 AND base_pending_revision = ?4
                   AND recovery_required = 0",
                params![
                    conversation_id,
                    pending_input_id,
                    edit_token,
                    expected_revision
                ],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .context("single_chat.pending_input_edit_fenced")?;
        let mut refs = parse_source_attachments(&working_json)?;
        anyhow::ensure!(
            refs.len() < MAX_PREPARED_ATTACHMENTS,
            "attachment_count_exceeded"
        );
        refs.push(source_ref);
        transaction.execute(
            "UPDATE single_chat_pending_input_edit_session
             SET working_source_attachments_json = ?4
             WHERE conversation_id = ?1 AND pending_input_id = ?2 AND edit_token = ?3",
            params![
                conversation_id,
                pending_input_id,
                edit_token,
                serialize_source_attachments(&refs)?,
            ],
        )?;
        transaction.commit()?;
        self.snapshot(database, conversation_id)?
            .context("Single Chat disappeared after its pending attachment was added")
    }

    pub fn edit_pending_input(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<EditSingleChatPendingInputCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            if !matches!(envelope.actor, ActorRef::User { .. }) {
                return Ok(rejected(
                    "single_chat.local_user_required",
                    "Only the local user can edit Single Chat pending inputs",
                ));
            }
            let command = &envelope.payload;
            let Some(target) = load_active_target(transaction, &command.conversation_id)? else {
                return Ok(rejected(
                    "single_chat.not_active",
                    "Single Chat does not exist or has ended",
                ));
            };
            if envelope.camp_id.as_deref() != Some(target.camp_id.as_str())
                || command.camp_id != target.camp_id
            {
                return Ok(rejected(
                    "single_chat.camp_mismatch",
                    "Single Chat command is outside the Camp",
                ));
            }
            let current = transaction
                .query_row(
                    "SELECT revision, state, body, source_attachments_json
                     FROM single_chat_pending_input
                     WHERE conversation_id = ?1 AND id = ?2",
                    params![command.conversation_id, command.pending_input_id],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )
                .optional()?;
            let Some((revision, state, body, source_attachments_json)) = current else {
                return Ok(rejected(
                    "single_chat.pending_input_not_found",
                    "Pending input no longer exists",
                ));
            };
            if revision != command.expected_revision
                || !matches!(state.as_str(), "queued" | "needs_repair")
            {
                return Ok(rejected(
                    "single_chat.pending_input_changed",
                    "Pending input changed or was already sent",
                ));
            }
            let session = load_pending_edit_session(transaction, &command.conversation_id)?;
            let owns_session = session.as_ref().is_some_and(|session| {
                session.pending_input_id == command.pending_input_id
                    && session.base_pending_revision == revision
                    && Some(session.edit_token.as_str()) == command.edit_token.as_deref()
            });

            match &command.action {
                SingleChatPendingInputEditAction::Begin
                | SingleChatPendingInputEditAction::Takeover => {
                    if matches!(command.action, SingleChatPendingInputEditAction::Begin)
                        && session.is_some()
                    {
                        return Ok(rejected(
                            "single_chat.pending_input_edit_open",
                            "Finish the existing pending input edit first",
                        ));
                    }
                    if matches!(command.action, SingleChatPendingInputEditAction::Takeover)
                        && !owns_session
                    {
                        return Ok(rejected(
                            "single_chat.pending_input_edit_fenced",
                            "The pending input edit session changed",
                        ));
                    }
                    let edit_token = Uuid::new_v4().to_string();
                    transaction.execute(
                        r#"
                        INSERT INTO single_chat_pending_input_edit_session(
                            conversation_id, pending_input_id, edit_token,
                            base_pending_revision, recovery_required, working_body,
                            working_source_attachments_json
                        ) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)
                        ON CONFLICT(conversation_id) DO UPDATE SET
                            pending_input_id = excluded.pending_input_id,
                            edit_token = excluded.edit_token,
                            base_pending_revision = excluded.base_pending_revision,
                            recovery_required = 0,
                            working_body = excluded.working_body,
                            working_source_attachments_json =
                                excluded.working_source_attachments_json
                        "#,
                        params![
                            command.conversation_id,
                            command.pending_input_id,
                            edit_token,
                            revision,
                            body,
                            source_attachments_json,
                        ],
                    )?;
                    return Ok(CommandHandlerResult::applied(
                        "single_chat.pending_input_edit_started",
                        json!({ "editToken": edit_token }),
                        None,
                    ));
                }
                SingleChatPendingInputEditAction::Save { body } => {
                    if !owns_session
                        || session
                            .as_ref()
                            .is_some_and(|session| session.recovery_required)
                    {
                        return Ok(rejected(
                            "single_chat.pending_input_edit_fenced",
                            "Reopen the pending input before saving",
                        ));
                    }
                    if body.chars().count() > 100_000 {
                        anyhow::bail!("Single Chat body exceeds the 100000-character limit");
                    }
                    let working_json = session
                        .as_ref()
                        .expect("owned pending edit session")
                        .working_source_attachments_json
                        .clone();
                    let refs = parse_source_attachments(&working_json)?;
                    if body.trim().is_empty() && refs.is_empty() {
                        return Ok(rejected(
                            "single_chat.empty_message",
                            "Pending input must contain text or an attachment",
                        ));
                    }
                    transaction.execute(
                        "UPDATE single_chat_pending_input
                         SET body = ?3, source_attachments_json = ?4,
                             revision = revision + 1, state = 'queued',
                             last_attempt_error_code = NULL, updated_at = ?5
                         WHERE conversation_id = ?1 AND id = ?2",
                        params![
                            command.conversation_id,
                            command.pending_input_id,
                            body.trim(),
                            working_json,
                            chrono::Utc::now().to_rfc3339(),
                        ],
                    )?;
                }
                SingleChatPendingInputEditAction::RemoveAttachment { attachment_ref_id } => {
                    let Some(session) = session
                        .as_ref()
                        .filter(|session| owns_session && !session.recovery_required)
                    else {
                        return Ok(rejected(
                            "single_chat.pending_input_edit_fenced",
                            "Reopen the pending input before editing attachments",
                        ));
                    };
                    let mut refs =
                        parse_source_attachments(&session.working_source_attachments_json)?;
                    let previous_len = refs.len();
                    refs.retain(|source_ref| source_ref.id != *attachment_ref_id);
                    if refs.len() == previous_len {
                        return Ok(rejected(
                            "attachment_not_found",
                            "Source Attachment no longer exists in this edit",
                        ));
                    }
                    store_pending_edit_refs(
                        transaction,
                        &command.conversation_id,
                        &command.pending_input_id,
                        command.edit_token.as_deref().unwrap_or_default(),
                        &refs,
                    )?;
                    return Ok(CommandHandlerResult::applied(
                        "single_chat.pending_input_attachment_removed",
                        json!({ "pendingInputId": command.pending_input_id }),
                        None,
                    ));
                }
                SingleChatPendingInputEditAction::ReorderAttachments { attachment_ref_ids } => {
                    let Some(session) = session
                        .as_ref()
                        .filter(|session| owns_session && !session.recovery_required)
                    else {
                        return Ok(rejected(
                            "single_chat.pending_input_edit_fenced",
                            "Reopen the pending input before editing attachments",
                        ));
                    };
                    let refs = parse_source_attachments(&session.working_source_attachments_json)?;
                    let by_id = refs
                        .into_iter()
                        .map(|source_ref| (source_ref.id.clone(), source_ref))
                        .collect::<HashMap<_, _>>();
                    if attachment_ref_ids.len() != by_id.len()
                        || attachment_ref_ids.iter().collect::<HashSet<_>>().len() != by_id.len()
                        || attachment_ref_ids.iter().any(|id| !by_id.contains_key(id))
                    {
                        return Ok(rejected(
                            "attachment_order_changed",
                            "Source Attachment order no longer matches this edit",
                        ));
                    }
                    let reordered = attachment_ref_ids
                        .iter()
                        .map(|id| {
                            by_id
                                .get(id)
                                .expect("validated Source Attachment identity")
                                .clone()
                        })
                        .collect::<Vec<_>>();
                    store_pending_edit_refs(
                        transaction,
                        &command.conversation_id,
                        &command.pending_input_id,
                        command.edit_token.as_deref().unwrap_or_default(),
                        &reordered,
                    )?;
                    return Ok(CommandHandlerResult::applied(
                        "single_chat.pending_input_attachments_reordered",
                        json!({ "pendingInputId": command.pending_input_id }),
                        None,
                    ));
                }
                SingleChatPendingInputEditAction::Cancel => {
                    if !owns_session {
                        return Ok(rejected(
                            "single_chat.pending_input_edit_fenced",
                            "The pending input edit session changed",
                        ));
                    }
                }
                SingleChatPendingInputEditAction::Delete => {
                    if session
                        .as_ref()
                        .is_some_and(|session| session.pending_input_id == command.pending_input_id)
                        && !owns_session
                    {
                        return Ok(rejected(
                            "single_chat.pending_input_edit_fenced",
                            "The pending input edit session changed",
                        ));
                    }
                    transaction.execute(
                        "UPDATE single_chat_pending_input
                         SET state = 'cancelled', revision = revision + 1, updated_at = ?3
                         WHERE conversation_id = ?1 AND id = ?2",
                        params![
                            command.conversation_id,
                            command.pending_input_id,
                            chrono::Utc::now().to_rfc3339(),
                        ],
                    )?;
                }
            }
            transaction.execute(
                "DELETE FROM single_chat_pending_input_edit_session
                 WHERE conversation_id = ?1 AND pending_input_id = ?2",
                params![command.conversation_id, command.pending_input_id],
            )?;
            append_domain_event(
                transaction,
                "single_chat.pending_input_updated",
                Some(&target.camp_id),
                Some(("single_chat_pending_input", &command.pending_input_id)),
                &envelope.actor,
                None,
                &json!({ "conversationId": command.conversation_id }),
            )?;
            Ok(CommandHandlerResult::applied(
                "single_chat.pending_input_updated",
                json!({ "pendingInputId": command.pending_input_id }),
                None,
            ))
        })
    }

    pub fn publish_pending_input(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<PublishSingleChatPendingInput>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |transaction| {
            let ActorRef::User { user_id } = &envelope.actor else {
                anyhow::bail!("Single Chat pending input must publish as its original user");
            };
            let command = &envelope.payload;
            anyhow::ensure!(
                command.user_id == *user_id,
                "single_chat.pending_user_changed"
            );
            let target = load_active_target(transaction, &command.conversation_id)?
                .context("Single Chat pending input target is no longer active")?;
            anyhow::ensure!(
                target.camp_id == command.camp_id,
                "single_chat.camp_mismatch"
            );
            let pending = load_pending_input(
                transaction,
                &command.conversation_id,
                &command.pending_input_id,
            )?
            .context("Single Chat pending input no longer exists")?;
            anyhow::ensure!(
                pending.user_id == *user_id,
                "single_chat.pending_user_changed"
            );
            let head = transaction
                .query_row(
                    "SELECT id FROM single_chat_pending_input
                     WHERE conversation_id = ?1 AND state IN ('queued', 'needs_repair')
                     ORDER BY enqueue_sequence, id LIMIT 1",
                    [&command.conversation_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let edit_open: bool = transaction.query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM single_chat_pending_input_edit_session
                    WHERE pending_input_id = ?1
                )",
                [&command.pending_input_id],
                |row| row.get(0),
            )?;
            if pending.revision != command.expected_revision
                || pending.state != "queued"
                || head.as_deref() != Some(command.pending_input_id.as_str())
                || edit_open
                || single_chat_has_active_run(transaction, &command.conversation_id)?
            {
                return Ok(rejected(
                    "single_chat.pending_input_not_ready",
                    "Single Chat queue head is not ready to send",
                ));
            }
            validate_source_attachments(&pending.source_attachments).map_err(anyhow::Error::new)?;
            let runtime =
                resolve_frozen_runtime(transaction, &target.conversation_id, &target.agent_id)?
                    .map_err(|blocker| {
                        anyhow::anyhow!(
                            "single_chat.runtime_not_ready: {}: {}",
                            blocker.code,
                            blocker.payload
                        )
                    })?;
            let admitted = admit_single_chat_message(
                transaction,
                &target,
                user_id,
                &pending.body,
                &pending.source_attachments,
                &runtime,
                &envelope.command_id,
                None,
                &envelope.actor,
            )?;
            transaction.execute(
                r#"
                UPDATE single_chat_pending_input
                SET state = 'published', published_conversation_message_id = ?3,
                    published_camp_turn_id = ?4, published_agent_run_id = ?5,
                    published_at = ?6, updated_at = ?6,
                    last_attempt_error_code = NULL
                WHERE conversation_id = ?1 AND id = ?2
                "#,
                params![
                    command.conversation_id,
                    command.pending_input_id,
                    admitted.conversation_message_id,
                    admitted.camp_turn_id,
                    admitted.agent_run_id,
                    chrono::Utc::now().to_rfc3339(),
                ],
            )?;
            Ok(CommandHandlerResult::accepted(
                "single_chat.pending_input_published",
                json!({
                    "conversationId": command.conversation_id,
                    "conversationVersion": admitted.conversation_version,
                    "pendingInputId": command.pending_input_id,
                    "conversationMessageId": admitted.conversation_message_id,
                    "campTurnId": admitted.camp_turn_id,
                    "agentRunId": admitted.agent_run_id,
                }),
                Some(entity_ref("agent_run", &admitted.agent_run_id)),
            ))
        })
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
        let messages = {
            let mut statement = database.connection().prepare(
                r#"
                SELECT id, sequence, author_type, author_id, body,
                       source_attachments_json, agent_run_id, created_at
                FROM conversation_message
                WHERE conversation_id = ?1
                ORDER BY sequence, id
                "#,
            )?;
            let rows = statement
                .query_map([conversation_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, String>(7)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows.into_iter()
                .map(
                    |(
                        id,
                        sequence,
                        author_type,
                        author_id,
                        body,
                        source_attachments_json,
                        agent_run_id,
                        created_at,
                    )| {
                        Ok(SingleChatMessageView {
                            id,
                            sequence,
                            author_type,
                            author_id,
                            body,
                            attachments: source_attachment_views(&source_attachments_json)?,
                            agent_run_id,
                            created_at,
                        })
                    },
                )
                .collect::<Result<Vec<_>>>()?
        };
        let draft = load_single_chat_draft(database, conversation_id)?;
        let pending_inputs = read_single_chat_pending_inputs(database, conversation_id)?;
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
            draft,
            pending_inputs,
            agent_runs,
            execution_evidence,
        }))
    }
}

pub fn filter_single_chat_skill_exposure(
    database: &Database,
    mut exposure: PreparedSkillExposure,
) -> Result<PreparedSkillExposure> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT skill.id, revision.name
        FROM skill
        JOIN skill_revision AS revision ON revision.id = skill.current_revision_id
        WHERE skill.origin = 'official'
          AND revision.source_type = 'bundled'
          AND json_extract(revision.source_metadata_json, '$.bundled') = 1
        "#,
    )?;
    let filtered_skill_ids = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .filter_map(|row| match row {
            Ok((skill_id, canonical_name))
                if bundled_skill_source_identity(&canonical_name).is_some_and(|identity| {
                    SINGLE_CHAT_FILTERED_BUNDLED_SKILL_SOURCE_IDENTITIES
                        .contains(&identity.as_str())
                }) =>
            {
                Some(Ok(skill_id))
            }
            Ok(_) => None,
            Err(error) => Some(Err(error)),
        })
        .collect::<rusqlite::Result<BTreeSet<_>>>()?;
    exposure
        .snapshot
        .skills
        .retain(|entry| !filtered_skill_ids.contains(&entry.skill_id));
    exposure.digest = canonical_json_digest(&serde_json::to_value(&exposure.snapshot)?)?;
    Ok(exposure)
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

fn source_attachment_views(value: &str) -> Result<Vec<LocalAttachmentSourceView>> {
    Ok(parse_source_attachments(value)?
        .iter()
        .map(|source_ref| source_ref.view(LocalAttachmentAvailability::Unknown))
        .collect())
}

fn history_attachment_views(value: &str) -> Result<Vec<LocalAttachmentHistoryView>> {
    Ok(parse_source_attachments(value)?
        .iter()
        .map(LocalAttachmentSourceRef::history_view)
        .collect())
}

fn load_single_chat_draft_refs(
    connection: &rusqlite::Connection,
    conversation_id: &str,
) -> Result<(i64, Vec<LocalAttachmentSourceRef>)> {
    let stored = connection
        .query_row(
            "SELECT revision, source_attachments_json
             FROM single_chat_composer_draft WHERE conversation_id = ?1",
            [conversation_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    match stored {
        Some((revision, value)) => Ok((revision, parse_source_attachments(&value)?)),
        None => Ok((0, Vec::new())),
    }
}

fn load_single_chat_draft(
    database: &Database,
    conversation_id: &str,
) -> Result<SingleChatComposerDraftView> {
    let stored = database
        .connection()
        .query_row(
            "SELECT revision, source_attachments_json, updated_at
             FROM single_chat_composer_draft WHERE conversation_id = ?1",
            [conversation_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    match stored {
        Some((revision, value, updated_at)) => Ok(SingleChatComposerDraftView {
            revision,
            attachments: source_attachment_views(&value)?,
            updated_at: Some(updated_at),
        }),
        None => Ok(SingleChatComposerDraftView {
            revision: 0,
            attachments: Vec::new(),
            updated_at: None,
        }),
    }
}

fn store_single_chat_draft_refs(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    expected_revision: i64,
    refs: &[LocalAttachmentSourceRef],
) -> Result<()> {
    let serialized = serialize_source_attachments(refs)?;
    let now = chrono::Utc::now().to_rfc3339();
    if expected_revision == 0 {
        let updated = transaction.execute(
            "UPDATE single_chat_composer_draft
             SET source_attachments_json = ?2, revision = 1, updated_at = ?3
             WHERE conversation_id = ?1 AND revision = 0",
            params![conversation_id, serialized, now],
        )?;
        if updated == 0 {
            transaction.execute(
                "INSERT INTO single_chat_composer_draft(
                    conversation_id, revision, source_attachments_json, updated_at
                 ) VALUES (?1, 1, ?2, ?3)",
                params![conversation_id, serialized, now],
            )?;
        }
        return Ok(());
    }
    let updated = transaction.execute(
        "UPDATE single_chat_composer_draft
         SET source_attachments_json = ?3, revision = revision + 1, updated_at = ?4
         WHERE conversation_id = ?1 AND revision = ?2",
        params![conversation_id, expected_revision, serialized, now],
    )?;
    anyhow::ensure!(updated == 1, "single_chat.draft_changed");
    Ok(())
}

#[derive(Debug)]
struct StoredSingleChatPendingInput {
    revision: i64,
    state: String,
    body: String,
    user_id: String,
    source_attachments: Vec<LocalAttachmentSourceRef>,
}

fn load_pending_input(
    connection: &rusqlite::Connection,
    conversation_id: &str,
    pending_input_id: &str,
) -> Result<Option<StoredSingleChatPendingInput>> {
    let stored = connection
        .query_row(
            "SELECT revision, state, body, user_id, source_attachments_json
             FROM single_chat_pending_input
             WHERE conversation_id = ?1 AND id = ?2",
            params![conversation_id, pending_input_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?;
    stored
        .map(
            |(revision, state, body, user_id, source_attachments_json)| {
                Ok(StoredSingleChatPendingInput {
                    revision,
                    state,
                    body,
                    user_id,
                    source_attachments: parse_source_attachments(&source_attachments_json)?,
                })
            },
        )
        .transpose()
}

#[derive(Debug)]
struct StoredSingleChatPendingEditSession {
    pending_input_id: String,
    edit_token: String,
    base_pending_revision: i64,
    recovery_required: bool,
    working_source_attachments_json: String,
}

fn load_pending_edit_session(
    connection: &rusqlite::Connection,
    conversation_id: &str,
) -> Result<Option<StoredSingleChatPendingEditSession>> {
    Ok(connection
        .query_row(
            "SELECT pending_input_id, edit_token, base_pending_revision,
                    recovery_required, working_source_attachments_json
             FROM single_chat_pending_input_edit_session
             WHERE conversation_id = ?1",
            [conversation_id],
            |row| {
                Ok(StoredSingleChatPendingEditSession {
                    pending_input_id: row.get(0)?,
                    edit_token: row.get(1)?,
                    base_pending_revision: row.get(2)?,
                    recovery_required: row.get(3)?,
                    working_source_attachments_json: row.get(4)?,
                })
            },
        )
        .optional()?)
}

fn store_pending_edit_refs(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    pending_input_id: &str,
    edit_token: &str,
    refs: &[LocalAttachmentSourceRef],
) -> Result<()> {
    let updated = transaction.execute(
        "UPDATE single_chat_pending_input_edit_session
         SET working_source_attachments_json = ?4
         WHERE conversation_id = ?1 AND pending_input_id = ?2 AND edit_token = ?3",
        params![
            conversation_id,
            pending_input_id,
            edit_token,
            serialize_source_attachments(refs)?,
        ],
    )?;
    anyhow::ensure!(updated == 1, "single_chat.pending_input_edit_fenced");
    Ok(())
}

pub fn recover_pending_edit_sessions(database: &Database) -> Result<()> {
    database.connection().execute(
        "UPDATE single_chat_pending_input_edit_session SET recovery_required = 1",
        [],
    )?;
    Ok(())
}

pub fn ready_pending_inputs(database: &Database) -> Result<Vec<PublishSingleChatPendingInput>> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT input.conversation_id, conversation.camp_id,
               input.id, input.revision, input.user_id
        FROM single_chat_pending_input AS input
        JOIN conversation ON conversation.id = input.conversation_id
        WHERE input.state = 'queued'
          AND conversation.kind = 'single_chat'
          AND conversation.ended_at IS NULL
          AND NOT EXISTS(
              SELECT 1 FROM single_chat_pending_input AS older
              WHERE older.conversation_id = input.conversation_id
                AND older.state IN ('queued', 'needs_repair')
                AND older.enqueue_sequence < input.enqueue_sequence
          )
          AND NOT EXISTS(
              SELECT 1 FROM single_chat_pending_input_edit_session
              WHERE pending_input_id = input.id
          )
        ORDER BY input.created_at, input.id
        "#,
    )?;
    let candidates = statement
        .query_map([], |row| {
            Ok(PublishSingleChatPendingInput {
                conversation_id: row.get(0)?,
                camp_id: row.get(1)?,
                pending_input_id: row.get(2)?,
                expected_revision: row.get(3)?,
                user_id: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    candidates
        .into_iter()
        .filter_map(|candidate| {
            match single_chat_has_active_run(database.connection(), &candidate.conversation_id) {
                Ok(false) => Some(Ok(candidate)),
                Ok(true) => None,
                Err(error) => Some(Err(error)),
            }
        })
        .collect()
}

pub fn record_pending_publish_failure(
    database: &Database,
    command: &PublishSingleChatPendingInput,
    code: &str,
) -> Result<()> {
    database.connection().execute(
        "UPDATE single_chat_pending_input
         SET state = 'needs_repair', last_attempt_error_code = ?4, updated_at = ?5
         WHERE conversation_id = ?1 AND id = ?2 AND revision = ?3 AND state = 'queued'",
        params![
            command.conversation_id,
            command.pending_input_id,
            command.expected_revision,
            code,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

fn read_single_chat_pending_inputs(
    database: &Database,
    conversation_id: &str,
) -> Result<SingleChatPendingInputsView> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT id, enqueue_sequence, revision, state, body,
               source_attachments_json, last_attempt_error_code
        FROM single_chat_pending_input
        WHERE conversation_id = ?1 AND state IN ('queued', 'needs_repair')
        ORDER BY enqueue_sequence, id
        "#,
    )?;
    let rows = statement
        .query_map([conversation_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let items = rows
        .into_iter()
        .map(
            |(
                id,
                enqueue_sequence,
                revision,
                state,
                body,
                source_attachments_json,
                last_attempt_error_code,
            )| {
                Ok(SingleChatPendingInputView {
                    id,
                    conversation_id: conversation_id.to_string(),
                    enqueue_sequence,
                    revision,
                    state,
                    body,
                    last_attempt_error_code,
                    attachments: source_attachment_views(&source_attachments_json)?,
                })
            },
        )
        .collect::<Result<Vec<_>>>()?;
    let edit_session = database
        .connection()
        .query_row(
            r#"
            SELECT pending_input_id, edit_token, base_pending_revision,
                   recovery_required, working_body,
                   working_source_attachments_json
            FROM single_chat_pending_input_edit_session
            WHERE conversation_id = ?1
            "#,
            [conversation_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?
        .map(
            |(
                pending_input_id,
                edit_token,
                base_pending_revision,
                recovery_required,
                working_body,
                working_source_attachments_json,
            )| {
                Ok::<SingleChatPendingInputEditSessionView, anyhow::Error>(
                    SingleChatPendingInputEditSessionView {
                        pending_input_id,
                        edit_token,
                        base_pending_revision,
                        recovery_required,
                        working_body,
                        working_attachments: source_attachment_views(
                            &working_source_attachments_json,
                        )?,
                    },
                )
            },
        )
        .transpose()?;
    Ok(SingleChatPendingInputsView {
        execution_active: single_chat_has_active_run(database.connection(), conversation_id)?,
        items,
        edit_session,
    })
}

fn consume_single_chat_draft(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    expected_revision: i64,
) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    if expected_revision == 0 {
        let updated = transaction.execute(
            "UPDATE single_chat_composer_draft
             SET source_attachments_json = '[]', revision = 1, updated_at = ?2
             WHERE conversation_id = ?1 AND revision = 0",
            params![conversation_id, now],
        )?;
        if updated == 0 {
            transaction.execute(
                "INSERT INTO single_chat_composer_draft(
                    conversation_id, revision, source_attachments_json, updated_at
                 ) VALUES (?1, 1, '[]', ?2)",
                params![conversation_id, now],
            )?;
        }
        return Ok(());
    }
    let updated = transaction.execute(
        "UPDATE single_chat_composer_draft
         SET source_attachments_json = '[]', revision = revision + 1, updated_at = ?3
         WHERE conversation_id = ?1 AND revision = ?2",
        params![conversation_id, expected_revision, now],
    )?;
    anyhow::ensure!(updated == 1, "single_chat.draft_changed");
    Ok(())
}

fn single_chat_has_active_run(
    connection: &rusqlite::Connection,
    conversation_id: &str,
) -> Result<bool> {
    Ok(connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM agent_run
            WHERE conversation_id = ?1
              AND invocation_kind = 'single_chat'
              AND status IN ('queued', 'running', 'waiting')
        )",
        [conversation_id],
        |row| row.get(0),
    )?)
}

fn single_chat_has_pending_queue(
    connection: &rusqlite::Connection,
    conversation_id: &str,
) -> Result<bool> {
    Ok(connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM single_chat_pending_input
            WHERE conversation_id = ?1 AND state IN ('queued', 'needs_repair')
        )",
        [conversation_id],
        |row| row.get(0),
    )?)
}

fn enqueue_single_chat_input(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    body: &str,
    source_attachments: &[LocalAttachmentSourceRef],
    user_id: &str,
) -> Result<String> {
    let pending_input_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        INSERT INTO single_chat_pending_input(
            id, conversation_id, enqueue_sequence, revision, state, body,
            source_attachments_json, user_id, created_at, updated_at
        ) VALUES (
            ?1, ?2,
            (SELECT COALESCE(MAX(enqueue_sequence), 0) + 1
             FROM single_chat_pending_input WHERE conversation_id = ?2),
            1, 'queued', ?3, ?4, ?5, ?6, ?6
        )
        "#,
        params![
            pending_input_id,
            conversation_id,
            body,
            serialize_source_attachments(source_attachments)?,
            user_id,
            now,
        ],
    )?;
    Ok(pending_input_id)
}

#[derive(Debug)]
struct AdmittedSingleChatMessage {
    conversation_version: i64,
    conversation_message_id: String,
    camp_turn_id: String,
    agent_run_id: String,
}

#[allow(clippy::too_many_arguments)]
fn admit_single_chat_message(
    transaction: &Transaction<'_>,
    target: &ActiveTarget,
    user_id: &str,
    body: &str,
    source_attachments: &[LocalAttachmentSourceRef],
    runtime: &crate::agent_profile::FrozenAgentRuntimeConfig,
    command_id: &str,
    draft_revision: Option<i64>,
    actor: &ActorRef,
) -> Result<AdmittedSingleChatMessage> {
    let accepted_at = chrono::Utc::now();
    let now = accepted_at.to_rfc3339();
    let budget = freeze_camp_turn_execution_budget(None, accepted_at, 1)?;
    let conversation_message_id = Uuid::new_v4().to_string();
    let camp_turn_id = Uuid::new_v4().to_string();
    let agent_run_id = Uuid::new_v4().to_string();
    let source_attachments_json = serialize_source_attachments(source_attachments)?;

    if let Some(draft_revision) = draft_revision {
        consume_single_chat_draft(transaction, &target.conversation_id, draft_revision)?;
    }
    let updated = transaction.execute(
        r#"
        UPDATE conversation
        SET last_message_sequence = last_message_sequence + 1,
            version = version + 1,
            updated_at = ?3
        WHERE id = ?1 AND version = ?2
          AND kind = 'single_chat' AND ended_at IS NULL
        "#,
        params![target.conversation_id, target.version, now],
    )?;
    anyhow::ensure!(updated == 1, "single_chat.version_conflict");
    let conversation_sequence = target.last_message_sequence + 1;
    let effective_config = build_effective_config(
        transaction,
        &target.conversation_id,
        &target.agent_id,
        runtime,
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
            command_id,
        ],
    )?;
    transaction.execute(
        r#"
        INSERT INTO conversation_message(
            id, conversation_id, sequence,
            author_type, author_id, source_agent_run_id, body,
            source_camp_message_id, source_inbox_message_id,
            camp_turn_id, agent_run_id, source_attachments_json, created_at
        ) VALUES (
            ?1, ?2, ?3, 'user', ?4, NULL, ?5,
            NULL, NULL, ?6, ?7, ?8, ?9
        )
        "#,
        params![
            conversation_message_id,
            target.conversation_id,
            conversation_sequence,
            user_id,
            body,
            camp_turn_id,
            agent_run_id,
            source_attachments_json,
            now,
        ],
    )?;
    append_domain_event(
        transaction,
        "single_chat.message_sent",
        Some(&target.camp_id),
        Some(("conversation_message", &conversation_message_id)),
        actor,
        None,
        &json!({
            "conversationId": target.conversation_id,
            "conversationVersion": target.version + 1,
            "campTurnId": camp_turn_id,
            "agentRunId": agent_run_id,
            "publicBoundary": target.current_public_boundary_sequence,
            "attachmentCount": source_attachments.len(),
        }),
    )?;
    append_domain_event(
        transaction,
        "agent_run.queued",
        Some(&target.camp_id),
        Some(("agent_run", &agent_run_id)),
        actor,
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
    Ok(AdmittedSingleChatMessage {
        conversation_version: target.version + 1,
        conversation_message_id,
        camp_turn_id,
        agent_run_id,
    })
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
        if operation == SINGLE_CHAT_HISTORY_TOOL_NAME {
            return Ok(Some(CommandHandlerResult::rejected(
                "single_chat.history_unavailable",
                json!({
                    "message": "Current Single Chat history is unavailable.",
                    "operation": operation,
                }),
            )));
        }
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
        "camp.search" | "camp.read" | SINGLE_CHAT_HISTORY_TOOL_NAME
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
    if operation == SINGLE_CHAT_HISTORY_TOOL_NAME
        && load_single_chat_history_target(database, agent_run_id, execution_epoch)?.is_none()
    {
        return Ok(Some(CommandHandlerResult::rejected(
            "single_chat.history_unavailable",
            json!({
                "message": "Current Single Chat history is unavailable.",
                "operation": operation,
            }),
        )));
    }
    Ok(None)
}

fn load_single_chat_history_target(
    database: &Database,
    agent_run_id: &str,
    execution_epoch: i64,
) -> Result<Option<(String, i64)>> {
    Ok(database
        .connection()
        .query_row(
            r#"
            SELECT conversation.id, current_input.sequence
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            JOIN conversation
              ON conversation.id = agent_run.destination_conversation_id
             AND conversation.id = agent_run.conversation_id
             AND conversation.camp_id = camp_turn.camp_id
            JOIN conversation_message AS current_input
              ON current_input.id = agent_run.trigger_conversation_message_id
             AND current_input.conversation_id = conversation.id
            WHERE agent_run.id = ?1
              AND agent_run.execution_epoch = ?2
              AND agent_run.invocation_kind = 'single_chat'
              AND agent_run.response_delivery = 'conversation_message'
              AND agent_run.operation_policy = 'single_chat_v1'
              AND agent_run.operation_policy_version = 1
              AND agent_run.status = 'running'
              AND agent_run.cancel_requested_at IS NULL
              AND camp_turn.kind = 'single_chat'
              AND camp_turn.status IN ('running', 'waiting')
              AND camp_turn.cancel_requested_at IS NULL
              AND conversation.kind = 'single_chat'
              AND conversation.ended_at IS NULL
              AND current_input.author_type = 'user'
              AND current_input.sequence = agent_run.initial_conversation_context_through_sequence
            "#,
            params![agent_run_id, execution_epoch],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        collaboration::{CollaborationService, CreateCampCommand},
        command::{CommandResultStatus, canonical_json_digest},
        local_attachment_source::{
            LocalAttachmentFailure, LocalAttachmentOwnerLocator, load_agent_run_source_attachments,
            load_source_attachment, observe_source_attachment, resolve_source_attachments_for_run,
        },
        runtime::{ExecutionRuntimeService, SucceedAgentRunCommand},
        skill_projection::{SkillExposureEntry, SkillExposureSnapshot},
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
        let draft_revision = database
            .connection()
            .query_row(
                "SELECT revision FROM single_chat_composer_draft WHERE conversation_id = ?1",
                [conversation_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
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
                        expected_conversation_version: version,
                        draft_revision,
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
        assert_eq!(busy.result.status, CommandResultStatus::Accepted);
        assert_eq!(busy.result.code, "single_chat.pending_input_queued");
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
            "a queued send must not append user input before publication"
        );
        let queued_inputs: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM single_chat_pending_input
                 WHERE conversation_id = ?1 AND state = 'queued'",
                [&conversation_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(queued_inputs, 1);

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
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'running', execution_epoch = 1, started_at = updated_at WHERE id = ?1",
                [&run_id],
            )
            .unwrap();
        assert!(
            authorize_builtin_operation(
                &database,
                &run_id,
                1,
                "camp.read",
                &json!({"campId": camp_id}),
            )
            .unwrap()
            .is_none()
        );
        assert!(
            authorize_builtin_operation(
                &database,
                &run_id,
                1,
                SINGLE_CHAT_HISTORY_TOOL_NAME,
                &json!({}),
            )
            .unwrap()
            .is_none()
        );
        for denied_operation in [
            "camp.message.send",
            "team.gather",
            "team.get_task",
            "team.list_tasks",
            "memory.view",
            "memory.search",
            "memory.read",
            "memory.write",
        ] {
            let denial =
                authorize_builtin_operation(&database, &run_id, 1, denied_operation, &json!({}))
                    .unwrap()
                    .unwrap();
            assert_eq!(denial.code, "single_chat.operation_denied");
        }
        let cross_camp = authorize_builtin_operation(
            &database,
            &run_id,
            1,
            "camp.search",
            &json!({"campId": "rvcamp_01h47kvsy5fk1shh6w1g60eecf"}),
        )
        .unwrap()
        .unwrap();
        assert_eq!(cross_camp.code, "single_chat.cross_camp_denied");

        let cancelled = ExecutionRuntimeService::default()
            .cancel_interrupted_single_chat_runs(&mut database)
            .unwrap();
        assert_eq!(cancelled, vec![run_id.clone()]);
        let unavailable = authorize_builtin_operation(
            &database,
            &run_id,
            1,
            SINGLE_CHAT_HISTORY_TOOL_NAME,
            &json!({}),
        )
        .unwrap()
        .unwrap();
        assert_eq!(unavailable.code, "single_chat.history_unavailable");
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
    fn source_attachments_are_consumed_by_one_message_and_resolved_for_its_run() {
        let (mut database, camp_id) = fixture();
        let service = SingleChatService::default();
        let (conversation_id, version) = open(
            &service,
            &mut database,
            &camp_id,
            "single-chat-open-attachment",
        );
        let source = database.directory().join("private-input.md");
        std::fs::write(&source, b"private single chat attachment").unwrap();
        let source_ref =
            observe_source_attachment(&source, "private-input.md", Some("text/markdown")).unwrap();
        service
            .add_source_attachment(&mut database, &conversation_id, 0, source_ref)
            .unwrap();
        let staged = service
            .snapshot(&database, &conversation_id)
            .unwrap()
            .unwrap();
        assert_eq!(staged.draft.attachments.len(), 1);
        let attachment_id = staged.draft.attachments[0].id.clone();

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
                        expected_conversation_version: version,
                        draft_revision: 1,
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
        assert!(snapshot.draft.attachments.is_empty());
        assert_eq!(snapshot.messages.len(), 1);
        assert_eq!(snapshot.messages[0].body, "");
        assert_eq!(snapshot.messages[0].attachments.len(), 1);
        assert_eq!(snapshot.messages[0].attachments[0].id, attachment_id);
        assert!(
            database
                .connection()
                .execute(
                    "UPDATE conversation_message SET source_attachments_json = '[]' WHERE id = ?1",
                    [&snapshot.messages[0].id],
                )
                .is_err(),
            "a sent message must retain its frozen Source Refs"
        );

        let run_tmp = database.directory().join("run-tmp-attachment-test");
        std::fs::create_dir_all(&run_tmp).unwrap();
        let refs = load_agent_run_source_attachments(&database, run_id, 0).unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].source_path, source.to_string_lossy());
        let execution_root = database.directory().join("workspace");
        let resolved =
            resolve_source_attachments_for_run(&refs, &execution_root, &run_tmp).unwrap();
        assert_eq!(resolved.len(), 1);
        assert_eq!(
            std::fs::read(&resolved[0]).unwrap(),
            b"private single chat attachment"
        );

        let message_id = snapshot.messages[0].id.clone();
        let exact = load_source_attachment(
            &database,
            &LocalAttachmentOwnerLocator::SingleChatMessage {
                camp_id: camp_id.clone(),
                conversation_id: conversation_id.clone(),
                conversation_message_id: message_id.clone(),
                attachment_ref_id: attachment_id.clone(),
            },
        )
        .unwrap();
        assert_eq!(
            exact.as_ref().map(|source_ref| &source_ref.id),
            Some(&attachment_id)
        );
        assert!(
            load_source_attachment(
                &database,
                &LocalAttachmentOwnerLocator::SingleChatMessage {
                    camp_id,
                    conversation_id: Uuid::new_v4().to_string(),
                    conversation_message_id: message_id,
                    attachment_ref_id: attachment_id,
                },
            )
            .unwrap()
            .is_none(),
            "a message attachment cannot be guessed through another Conversation identity"
        );
    }

    #[test]
    fn pending_input_preserves_source_refs_and_publishes_after_the_active_run() {
        let (mut database, camp_id) = fixture();
        let service = SingleChatService::default();
        let runtime = ExecutionRuntimeService::default();
        let (conversation_id, version) = open(
            &service,
            &mut database,
            &camp_id,
            "single-chat-open-pending-attachment",
        );
        let first = send(
            &service,
            &mut database,
            &camp_id,
            &conversation_id,
            version,
            "single-chat-send-pending-first",
        );
        let first_run_id = first.result.payload["agentRunId"]
            .as_str()
            .unwrap()
            .to_string();
        let source = database.directory().join("queued-input.md");
        std::fs::write(&source, b"queued source ref").unwrap();
        let source_ref =
            observe_source_attachment(&source, "queued-input.md", Some("text/markdown")).unwrap();
        let attachment_id = source_ref.id.clone();
        service
            .add_source_attachment(&mut database, &conversation_id, 1, source_ref)
            .unwrap();
        let queued = service
            .send(
                &mut database,
                &user_envelope(
                    "single-chat-send-pending-attachment",
                    Some(&camp_id),
                    SendSingleChatMessageCommand {
                        camp_id: camp_id.clone(),
                        conversation_id: conversation_id.clone(),
                        body: "读取排队附件".to_string(),
                        expected_conversation_version: version + 1,
                        draft_revision: 2,
                    },
                ),
            )
            .unwrap();
        assert_eq!(queued.result.code, "single_chat.pending_input_queued");
        let pending_input_id = queued.result.payload["pendingInputId"]
            .as_str()
            .unwrap()
            .to_string();
        let queued_locator = LocalAttachmentOwnerLocator::SingleChatPending {
            camp_id: camp_id.clone(),
            conversation_id: conversation_id.clone(),
            pending_input_id: pending_input_id.clone(),
            attachment_ref_id: attachment_id.clone(),
        };
        assert!(
            load_source_attachment(&database, &queued_locator)
                .unwrap()
                .is_some()
        );

        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'running', execution_epoch = 1,
                 started_at = updated_at WHERE id = ?1",
                [&first_run_id],
            )
            .unwrap();
        runtime
            .succeed_agent_run(
                &mut database,
                &CommandEnvelope {
                    command_id: "single-chat-pending-first-final".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:test".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SucceedAgentRunCommand {
                        agent_run_id: first_run_id,
                        expected_version: 1,
                        execution_epoch: 1,
                        native_turn_id: "single-chat-pending-first-turn".to_string(),
                        final_output: "第一轮完成".to_string(),
                        missing_send_recovery_candidate: None,
                        ending_git_observation: None,
                    },
                },
            )
            .unwrap();

        let ready = ready_pending_inputs(&database).unwrap();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].pending_input_id, pending_input_id);
        let published = service
            .publish_pending_input(
                &mut database,
                &user_envelope(
                    "single-chat-publish-pending-attachment",
                    Some(&camp_id),
                    ready[0].clone(),
                ),
            )
            .unwrap();
        assert_eq!(published.result.status, CommandResultStatus::Accepted);
        let queued_run_id = published.result.payload["agentRunId"].as_str().unwrap();
        let queued_refs = load_agent_run_source_attachments(&database, queued_run_id, 0).unwrap();
        assert_eq!(queued_refs.len(), 1);
        assert_eq!(queued_refs[0].id, attachment_id);
        let snapshot = service
            .snapshot(&database, &conversation_id)
            .unwrap()
            .unwrap();
        assert_eq!(snapshot.messages.len(), 3);
        assert_eq!(snapshot.messages[2].body, "读取排队附件");
        assert_eq!(snapshot.messages[2].attachments.len(), 1);
        assert!(snapshot.pending_inputs.items.is_empty());
        let public_messages: i64 = database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_message WHERE source_agent_run_id = ?1",
                [queued_run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(public_messages, 0);
    }

    #[test]
    fn unavailable_queue_head_needs_repair_and_blocks_later_single_chat_inputs() {
        let (mut database, camp_id) = fixture();
        let service = SingleChatService::default();
        let runtime = ExecutionRuntimeService::default();
        let (conversation_id, version) = open(
            &service,
            &mut database,
            &camp_id,
            "single-chat-open-pending-repair",
        );
        let first = send(
            &service,
            &mut database,
            &camp_id,
            &conversation_id,
            version,
            "single-chat-send-repair-first",
        );
        let first_run_id = first.result.payload["agentRunId"]
            .as_str()
            .unwrap()
            .to_string();
        let source = database.directory().join("queued-missing.md");
        std::fs::write(&source, b"remove before publish").unwrap();
        let source_ref =
            observe_source_attachment(&source, "queued-missing.md", Some("text/markdown")).unwrap();
        let attachment_id = source_ref.id.clone();
        service
            .add_source_attachment(&mut database, &conversation_id, 1, source_ref)
            .unwrap();
        let head = service
            .send(
                &mut database,
                &user_envelope(
                    "single-chat-send-repair-head",
                    Some(&camp_id),
                    SendSingleChatMessageCommand {
                        camp_id: camp_id.clone(),
                        conversation_id: conversation_id.clone(),
                        body: "附件坏了仍可修复".to_string(),
                        expected_conversation_version: version + 1,
                        draft_revision: 2,
                    },
                ),
            )
            .unwrap();
        let head_id = head.result.payload["pendingInputId"]
            .as_str()
            .unwrap()
            .to_string();
        let later = service
            .send(
                &mut database,
                &user_envelope(
                    "single-chat-send-repair-later",
                    Some(&camp_id),
                    SendSingleChatMessageCommand {
                        camp_id: camp_id.clone(),
                        conversation_id: conversation_id.clone(),
                        body: "后续排队消息".to_string(),
                        expected_conversation_version: version + 1,
                        draft_revision: 3,
                    },
                ),
            )
            .unwrap();
        let later_id = later.result.payload["pendingInputId"]
            .as_str()
            .unwrap()
            .to_string();
        std::fs::remove_file(&source).unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'running', execution_epoch = 1,
                 started_at = updated_at WHERE id = ?1",
                [&first_run_id],
            )
            .unwrap();
        runtime
            .succeed_agent_run(
                &mut database,
                &CommandEnvelope {
                    command_id: "single-chat-repair-first-final".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:test".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SucceedAgentRunCommand {
                        agent_run_id: first_run_id,
                        expected_version: 1,
                        execution_epoch: 1,
                        native_turn_id: "single-chat-repair-first-turn".to_string(),
                        final_output: "第一轮完成".to_string(),
                        missing_send_recovery_candidate: None,
                        ending_git_observation: None,
                    },
                },
            )
            .unwrap();

        let candidate = ready_pending_inputs(&database).unwrap().remove(0);
        assert_eq!(candidate.pending_input_id, head_id);
        let failure = service
            .publish_pending_input(
                &mut database,
                &user_envelope(
                    "single-chat-publish-missing-head",
                    Some(&camp_id),
                    candidate.clone(),
                ),
            )
            .unwrap_err();
        let failure_code = failure
            .downcast_ref::<LocalAttachmentFailure>()
            .expect("missing Source Attachment failure")
            .code()
            .as_str();
        assert_eq!(failure_code, "attachment_missing");
        record_pending_publish_failure(&database, &candidate, failure_code).unwrap();
        assert!(ready_pending_inputs(&database).unwrap().is_empty());
        let snapshot = service
            .snapshot(&database, &conversation_id)
            .unwrap()
            .unwrap();
        assert_eq!(snapshot.pending_inputs.items[0].id, head_id);
        assert_eq!(snapshot.pending_inputs.items[0].state, "needs_repair");
        assert_eq!(snapshot.pending_inputs.items[1].id, later_id);
        assert_eq!(snapshot.pending_inputs.items[1].state, "queued");

        let begin = service
            .edit_pending_input(
                &mut database,
                &user_envelope(
                    "single-chat-begin-repair",
                    Some(&camp_id),
                    EditSingleChatPendingInputCommand {
                        camp_id: camp_id.clone(),
                        conversation_id: conversation_id.clone(),
                        pending_input_id: head_id.clone(),
                        expected_revision: 1,
                        edit_token: None,
                        action: SingleChatPendingInputEditAction::Begin,
                    },
                ),
            )
            .unwrap();
        let edit_token = begin.result.payload["editToken"]
            .as_str()
            .unwrap()
            .to_string();
        service
            .edit_pending_input(
                &mut database,
                &user_envelope(
                    "single-chat-remove-repair-attachment",
                    Some(&camp_id),
                    EditSingleChatPendingInputCommand {
                        camp_id: camp_id.clone(),
                        conversation_id: conversation_id.clone(),
                        pending_input_id: head_id.clone(),
                        expected_revision: 1,
                        edit_token: Some(edit_token.clone()),
                        action: SingleChatPendingInputEditAction::RemoveAttachment {
                            attachment_ref_id: attachment_id,
                        },
                    },
                ),
            )
            .unwrap();
        service
            .edit_pending_input(
                &mut database,
                &user_envelope(
                    "single-chat-save-repair",
                    Some(&camp_id),
                    EditSingleChatPendingInputCommand {
                        camp_id: camp_id.clone(),
                        conversation_id: conversation_id.clone(),
                        pending_input_id: head_id.clone(),
                        expected_revision: 1,
                        edit_token: Some(edit_token),
                        action: SingleChatPendingInputEditAction::Save {
                            body: "附件已移除，继续发送".to_string(),
                        },
                    },
                ),
            )
            .unwrap();
        let ready = ready_pending_inputs(&database).unwrap();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].pending_input_id, head_id);
        assert_eq!(ready[0].expected_revision, 2);
    }

    #[test]
    fn history_reads_only_messages_before_current_input_with_exclusive_pagination() {
        let (mut database, camp_id) = fixture();
        let service = SingleChatService::default();
        let runtime = ExecutionRuntimeService::default();
        let (conversation_id, version) = open(
            &service,
            &mut database,
            &camp_id,
            "single-chat-open-history",
        );
        let source = database.directory().join("history-input.md");
        std::fs::write(&source, b"history attachment").unwrap();
        let source_ref =
            observe_source_attachment(&source, "history-input.md", Some("text/markdown")).unwrap();
        let attachment_id = source_ref.id.clone();
        service
            .add_source_attachment(&mut database, &conversation_id, 0, source_ref)
            .unwrap();
        let first = send(
            &service,
            &mut database,
            &camp_id,
            &conversation_id,
            version,
            "single-chat-send-history-first",
        );
        let first_run_id = first.result.payload["agentRunId"].as_str().unwrap();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'running', execution_epoch = 1, started_at = updated_at WHERE id = ?1",
                [first_run_id],
            )
            .unwrap();
        let completed = runtime
            .succeed_agent_run(
                &mut database,
                &CommandEnvelope {
                    command_id: "single-chat-history-first-final".to_string(),
                    actor: ActorRef::System {
                        component_id: "runtime-adapter:test".to_string(),
                    },
                    camp_id: Some(camp_id.clone()),
                    expected_versions: Vec::new(),
                    execution_epoch: None,
                    payload: SucceedAgentRunCommand {
                        agent_run_id: first_run_id.to_string(),
                        expected_version: 1,
                        execution_epoch: 1,
                        native_turn_id: "single-chat-history-first-turn".to_string(),
                        final_output: "第一轮回答".to_string(),
                        missing_send_recovery_candidate: None,
                        ending_git_observation: None,
                    },
                },
            )
            .unwrap();
        assert_eq!(completed.result.status, CommandResultStatus::Applied);
        let second = send(
            &service,
            &mut database,
            &camp_id,
            &conversation_id,
            version + 2,
            "single-chat-send-history-current",
        );
        let current_run_id = second.result.payload["agentRunId"]
            .as_str()
            .unwrap()
            .to_string();
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'running', execution_epoch = 1, started_at = updated_at WHERE id = ?1",
                [&current_run_id],
            )
            .unwrap();

        let state_before: (i64, i64, i64) = database
            .connection()
            .query_row(
                "SELECT version, last_accepted_public_boundary_sequence, last_message_sequence FROM conversation WHERE id = ?1",
                [&conversation_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let newest = service
            .history(
                &database,
                &current_run_id,
                1,
                &SingleChatHistoryInput {
                    before_sequence: Some(999),
                    limit: Some(1),
                },
            )
            .unwrap();
        assert_eq!(
            newest,
            SingleChatHistoryOutput {
                schema_version: 1,
                messages: vec![SingleChatHistoryMessage {
                    sequence: 2,
                    role: "assistant".to_string(),
                    body: "第一轮回答".to_string(),
                    attachments: Vec::new(),
                }],
                has_more: true,
                next_before_sequence: Some(2),
            }
        );
        let older = service
            .history(
                &database,
                &current_run_id,
                1,
                &SingleChatHistoryInput {
                    before_sequence: newest.next_before_sequence,
                    limit: Some(1),
                },
            )
            .unwrap();
        assert_eq!(older.messages.len(), 1);
        assert_eq!(older.messages[0].sequence, 1);
        assert_eq!(older.messages[0].role, "user");
        assert_eq!(
            older.messages[0].attachments,
            vec![LocalAttachmentHistoryView {
                attachment_id,
                name: "history-input.md".to_string(),
                kind: "file".to_string(),
                file_count: 1,
                media_type: "text/markdown".to_string(),
                byte_size: 18,
            }]
        );
        assert!(!older.has_more);
        assert_eq!(older.next_before_sequence, None);
        assert_eq!(
            database
                .connection()
                .query_row(
                    "SELECT version, last_accepted_public_boundary_sequence, last_message_sequence FROM conversation WHERE id = ?1",
                    [&conversation_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap(),
            state_before,
            "history must not mutate the Conversation or its public watermark"
        );
    }

    #[test]
    fn single_chat_skill_filter_uses_official_bundled_source_identity() {
        let (database, _) = fixture();
        let insert_skill = |database: &Database,
                            skill_id: &str,
                            revision_id: &str,
                            skill_name: &str,
                            revision_name: &str,
                            origin: &str,
                            source_type: &str,
                            bundled: bool| {
            database
                .connection()
                .execute(
                    "INSERT INTO skill(id, name, origin, enabled, lifecycle_status, current_revision_id, version, created_at, updated_at) VALUES (?1, ?2, ?3, 1, 'active', NULL, 1, '2026-09-04', '2026-09-04')",
                    params![skill_id, skill_name, origin],
                )
                .unwrap();
            database
                .connection()
                .execute(
                    "INSERT INTO skill_revision(id, skill_id, revision, name, description, source_type, source_metadata_json, content_digest, risk_summary_json, file_count, total_bytes, installed_at) VALUES (?1, ?2, 1, ?3, 'test', ?4, ?5, ?6, '{\"executableFileCount\":0,\"scriptFileCount\":0,\"binaryCandidateCount\":0,\"declaredTools\":[]}', 1, 1, '2026-09-04')",
                    params![
                        revision_id,
                        skill_id,
                        revision_name,
                        source_type,
                        serde_json::to_string(&json!({"bundled": bundled})).unwrap(),
                        format!("sha256:{skill_id}"),
                    ],
                )
                .unwrap();
            database
                .connection()
                .execute(
                    "UPDATE skill SET current_revision_id = ?2 WHERE id = ?1",
                    params![skill_id, revision_id],
                )
                .unwrap();
        };
        insert_skill(
            &database,
            "skill-cli",
            "revision-cli",
            "cli-operations",
            "cli-operations",
            "official",
            "bundled",
            true,
        );
        insert_skill(
            &database,
            "skill-memory",
            "revision-memory",
            "memory-stewardship",
            "memory-stewardship",
            "official",
            "bundled",
            true,
        );
        insert_skill(
            &database,
            "skill-retained",
            "revision-retained",
            "analyze-agent-codebase",
            "analyze-agent-codebase",
            "official",
            "bundled",
            true,
        );
        insert_skill(
            &database,
            "skill-lookalike",
            "revision-lookalike",
            "imported-cli-lookalike",
            "cli-operations",
            "imported",
            "local_folder",
            false,
        );
        let entry = |skill_id: &str, name: &str, revision_id: &str| SkillExposureEntry {
            skill_id: skill_id.to_string(),
            name: name.to_string(),
            revision_id: revision_id.to_string(),
            content_digest: format!("sha256:{skill_id}"),
            group_key: "codex".to_string(),
            delivered_via_group_key: Some("codex".to_string()),
            status: "ready".to_string(),
            entry_path: Some(format!("/workspace/.codex/skills/{name}")),
            reason_code: None,
            conflict_statuses: Vec::new(),
        };
        let snapshot = SkillExposureSnapshot {
            schema_version: 2,
            skills: vec![
                entry("skill-cli", "exposure-label-cli", "revision-cli"),
                entry("skill-memory", "exposure-label-memory", "revision-memory"),
                entry(
                    "skill-retained",
                    "analyze-agent-codebase",
                    "revision-retained",
                ),
                entry("skill-lookalike", "cli-operations", "revision-lookalike"),
            ],
        };
        let exposure = PreparedSkillExposure {
            digest: canonical_json_digest(&serde_json::to_value(&snapshot).unwrap()).unwrap(),
            snapshot,
        };
        let filtered = filter_single_chat_skill_exposure(&database, exposure).unwrap();
        assert_eq!(
            filtered
                .snapshot
                .skills
                .iter()
                .map(|skill| skill.name.as_str())
                .collect::<Vec<_>>(),
            ["analyze-agent-codebase", "cli-operations"]
        );
        assert_eq!(
            filtered.digest,
            canonical_json_digest(&serde_json::to_value(&filtered.snapshot).unwrap()).unwrap()
        );
    }
}
