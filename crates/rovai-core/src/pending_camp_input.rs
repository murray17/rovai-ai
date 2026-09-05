//! Private next-turn inputs. Publishing uses CollaborationService's existing message kernel.
//! Edit tokens only fence explicit saves/cancels; keystrokes never leave the Renderer.

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
    camp_attachment::{CampComposerReplyIntentView, project_reply_intent},
    camp_content::{
        ComposerDocument, StructuredCampMessageContent, composer_document_from_content,
        composer_document_to_content, normalize_composer_document, parse_composer_document_json,
        render_composer_plain_text, serialize_composer_document, validate_composer_document,
    },
    collaboration::ExecutionRequest,
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, sealed,
    },
    db::Database,
    local_attachment_source::{
        LocalAttachmentAvailability, LocalAttachmentSourceRef, LocalAttachmentSourceView,
        parse_source_attachments, serialize_source_attachments,
    },
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingCampInputView {
    pub id: String,
    pub camp_id: String,
    pub enqueue_sequence: i64,
    pub revision: i64,
    pub state: String,
    pub content: ComposerDocument,
    pub body: String,
    pub reply_intent: Option<CampComposerReplyIntentView>,
    pub recipient_selection_required: bool,
    pub last_attempt_error_code: Option<String>,
    pub attachments: Vec<LocalAttachmentSourceView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInputEditSession {
    pub pending_input_id: String,
    pub edit_token: String,
    pub base_pending_revision: i64,
    pub recovery_required: bool,
    pub working_attachments: Vec<LocalAttachmentSourceView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampPendingInputsView {
    pub camp_id: String,
    pub execution_active: bool,
    pub items: Vec<PendingCampInputView>,
    pub edit_session: Option<PendingInputEditSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditPendingCampInputCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub camp_id: String,
    pub pending_input_id: String,
    pub expected_revision: i64,
    pub edit_token: Option<String>,
    pub action: PendingInputEditAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum PendingInputEditAction {
    Begin,
    Takeover,
    Save {
        content: ComposerDocument,
        #[serde(rename = "replyToCampMessageId")]
        reply_to_camp_message_id: Option<String>,
        #[serde(rename = "recipientSelectionRequired")]
        recipient_selection_required: bool,
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

impl sealed::Sealed for EditPendingCampInputCommand {}
impl DomainCommand for EditPendingCampInputCommand {
    const TYPE: &'static str = "camp.pending_input.edit";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendPendingCampInputCommand {
    pub camp_id: String,
    pub pending_input_id: String,
    pub expected_revision: i64,
}

impl sealed::Sealed for SendPendingCampInputCommand {}
impl DomainCommand for SendPendingCampInputCommand {
    const TYPE: &'static str = "camp.pending_input.publish";
}

pub(crate) struct StoredPendingInput {
    pub document: ComposerDocument,
    pub content: StructuredCampMessageContent,
    pub reply_to_camp_message_id: Option<String>,
    pub recipient_selection_required: bool,
    pub execution: Option<ExecutionRequest>,
    pub user_id: String,
    pub source_attachments: Vec<LocalAttachmentSourceRef>,
}

pub(crate) fn load_input(
    connection: &Connection,
    id: &str,
    camp_id: &str,
) -> Result<StoredPendingInput> {
    let (content, reply, required, execution, user_id, source_attachments): (String, Option<String>, bool, String, String, String) = connection.query_row(
        "SELECT structured_content_json, reply_to_camp_message_id, recipient_selection_required, execution_json, user_id,
                source_attachments_json
         FROM pending_camp_input WHERE id = ?1 AND camp_id = ?2",
        params![id, camp_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
    )?;
    let document = parse_composer_document_json(&content)?;
    let structured_content = composer_document_to_content(&document)?;
    Ok(StoredPendingInput {
        document,
        content: structured_content,
        reply_to_camp_message_id: reply,
        recipient_selection_required: required,
        execution: serde_json::from_str(&execution)?,
        user_id,
        source_attachments: parse_source_attachments(&source_attachments)?,
    })
}

pub fn has_nonterminal_execution(connection: &Connection, camp_id: &str) -> Result<bool> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM camp_turn WHERE camp_id = ?1 AND status IN ('running', 'waiting'))
             OR EXISTS(SELECT 1 FROM agent_run JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                       WHERE camp_turn.camp_id = ?1 AND agent_run.status IN ('queued', 'running', 'waiting'))
             OR EXISTS(SELECT 1 FROM message_delivery WHERE camp_id = ?1 AND status IN ('pending', 'running'))",
        [camp_id], |row| row.get(0),
    )?)
}

pub fn requires_queue(database: &Database, camp_id: &str) -> Result<bool> {
    must_queue(database.connection(), camp_id)
}

pub(crate) fn must_queue(connection: &Connection, camp_id: &str) -> Result<bool> {
    Ok(has_nonterminal_execution(connection, camp_id)? || connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM pending_camp_input WHERE camp_id = ?1 AND state IN ('queued', 'needs_repair'))",
        [camp_id], |row| row.get::<_, bool>(0),
    )?)
}

pub fn recover_edit_sessions(database: &Database) -> Result<()> {
    database.connection().execute(
        "UPDATE pending_input_edit_session SET recovery_required = 1",
        [],
    )?;
    Ok(())
}

pub fn read_queue(database: &Database, camp_id: &str) -> Result<CampPendingInputsView> {
    let connection = database.connection();
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM camp WHERE id = ?1)",
        [camp_id],
        |row| row.get(0),
    )?;
    anyhow::ensure!(exists, "Camp does not exist");
    let mut statement = connection.prepare(
        "SELECT id, enqueue_sequence, revision, state, last_attempt_error_code FROM pending_camp_input
         WHERE camp_id = ?1 AND state IN ('queued', 'needs_repair') ORDER BY enqueue_sequence",
    )?;
    let rows = statement
        .query_map([camp_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut items = Vec::with_capacity(rows.len());
    for (id, enqueue_sequence, revision, state, last_attempt_error_code) in rows {
        let stored = load_input(connection, &id, camp_id)?;
        let body = render_input_body(connection, &stored.document)?;
        items.push(PendingCampInputView {
            id,
            camp_id: camp_id.to_string(),
            enqueue_sequence,
            revision,
            state,
            content: stored.document,
            body,
            reply_intent: project_reply_intent(
                database,
                camp_id,
                stored.reply_to_camp_message_id.as_deref(),
                stored.recipient_selection_required,
            )?,
            recipient_selection_required: stored.recipient_selection_required,
            last_attempt_error_code,
            attachments: stored
                .source_attachments
                .iter()
                .map(|source_ref| source_ref.view(LocalAttachmentAvailability::Unknown))
                .collect(),
        });
    }
    Ok(CampPendingInputsView {
        camp_id: camp_id.to_string(),
        execution_active: has_nonterminal_execution(connection, camp_id)?,
        items,
        edit_session: load_edit_session(connection, camp_id)?,
    })
}

fn render_input_body(connection: &Connection, content: &ComposerDocument) -> Result<String> {
    render_composer_plain_text(content, |agent_id| {
        connection
            .query_row(
                "SELECT display_name FROM agent_profile WHERE id = ?1",
                [agent_id],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
            .or_else(|| Some("已离队成员".to_string()))
    })
}

fn load_edit_session(
    connection: &Connection,
    camp_id: &str,
) -> Result<Option<PendingInputEditSession>> {
    let stored = connection
        .query_row(
            "SELECT pending_input_id, edit_token, base_pending_revision, recovery_required,
                    working_source_attachments_json
             FROM pending_input_edit_session WHERE camp_id = ?1",
            [camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?;
    stored
        .map(
            |(pending_input_id, edit_token, base_pending_revision, recovery_required, json)| {
                Ok(PendingInputEditSession {
                    pending_input_id,
                    edit_token,
                    base_pending_revision,
                    recovery_required,
                    working_attachments: parse_source_attachments(&json)?
                        .iter()
                        .map(|source_ref| source_ref.view(LocalAttachmentAvailability::Unknown))
                        .collect(),
                })
            },
        )
        .transpose()
}

fn load_working_source_refs(
    connection: &Connection,
    camp_id: &str,
    pending_input_id: &str,
    edit_token: &str,
) -> Result<Vec<LocalAttachmentSourceRef>> {
    let json = connection.query_row(
        "SELECT working_source_attachments_json FROM pending_input_edit_session
         WHERE camp_id = ?1 AND pending_input_id = ?2 AND edit_token = ?3",
        params![camp_id, pending_input_id, edit_token],
        |row| row.get::<_, String>(0),
    )?;
    parse_source_attachments(&json)
}

fn store_working_source_refs(
    connection: &Connection,
    camp_id: &str,
    pending_input_id: &str,
    edit_token: &str,
    refs: &[LocalAttachmentSourceRef],
) -> Result<()> {
    let updated = connection.execute(
        "UPDATE pending_input_edit_session
         SET working_source_attachments_json = ?4
         WHERE camp_id = ?1 AND pending_input_id = ?2 AND edit_token = ?3",
        params![
            camp_id,
            pending_input_id,
            edit_token,
            serialize_source_attachments(refs)?
        ],
    )?;
    anyhow::ensure!(updated == 1, "pending_input.edit_fenced");
    Ok(())
}

pub fn add_working_source_attachment(
    database: &mut Database,
    camp_id: &str,
    pending_input_id: &str,
    expected_revision: i64,
    edit_token: &str,
    source_ref: LocalAttachmentSourceRef,
) -> Result<CampPendingInputsView> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let pending_revision = transaction
        .query_row(
            "SELECT revision FROM pending_camp_input
             WHERE camp_id = ?1 AND id = ?2 AND state IN ('queued', 'needs_repair')",
            params![camp_id, pending_input_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    anyhow::ensure!(
        pending_revision == Some(expected_revision),
        "pending_input.changed"
    );
    let session = load_edit_session(&transaction, camp_id)?;
    let owns = session.as_ref().is_some_and(|session| {
        session.pending_input_id == pending_input_id
            && session.base_pending_revision == expected_revision
            && session.edit_token == edit_token
            && !session.recovery_required
    });
    anyhow::ensure!(owns, "pending_input.edit_fenced");
    let mut refs = load_working_source_refs(&transaction, camp_id, pending_input_id, edit_token)?;
    refs.push(source_ref);
    store_working_source_refs(&transaction, camp_id, pending_input_id, edit_token, &refs)?;
    transaction.commit()?;
    read_queue(database, camp_id)
}

fn reject(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({ "message": message }))
}

pub fn edit_input(
    database: &mut Database,
    envelope: &CommandEnvelope<EditPendingCampInputCommand>,
) -> Result<CommandExecution> {
    DomainCommandGateway.execute(database, envelope, |transaction| {
        if !matches!(envelope.actor, ActorRef::User { .. }) || envelope.camp_id.as_deref() != Some(&envelope.payload.camp_id) {
            return Ok(reject("pending_input.user_required", "Only the Camp user can edit pending inputs"));
        }
        let command = &envelope.payload;
        let current = transaction.query_row(
            "SELECT revision, state, source_attachments_json FROM pending_camp_input WHERE id = ?1 AND camp_id = ?2",
            params![command.pending_input_id, command.camp_id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
        ).optional()?;
        let Some((revision, state, source_attachments_json)) = current else { return Ok(reject("pending_input.not_found", "Pending input no longer exists")); };
        if revision != command.expected_revision || !matches!(state.as_str(), "queued" | "needs_repair") {
            return Ok(reject("pending_input.changed", "Pending input changed or was already sent"));
        }
        let session = load_edit_session(transaction, &command.camp_id)?;
        let owns_session = session.as_ref().is_some_and(|session|
            session.pending_input_id == command.pending_input_id
                && session.base_pending_revision == revision
                && Some(session.edit_token.as_str()) == command.edit_token.as_deref());
        match &command.action {
            PendingInputEditAction::Begin | PendingInputEditAction::Takeover => {
                if matches!(command.action, PendingInputEditAction::Begin) && session.is_some() {
                    return Ok(reject("pending_input.edit_open", "Finish the existing edit before editing another input"));
                }
                if matches!(command.action, PendingInputEditAction::Takeover) && !owns_session {
                    return Ok(reject("pending_input.edit_fenced", "The edit session changed; reload it first"));
                }
                let token = Uuid::new_v4().to_string();
                transaction.execute(
                    "INSERT INTO pending_input_edit_session(camp_id, pending_input_id, edit_token, base_pending_revision, recovery_required, working_source_attachments_json)
                     VALUES (?1, ?2, ?3, ?4, 0, ?5) ON CONFLICT(camp_id) DO UPDATE SET
                     pending_input_id = excluded.pending_input_id, edit_token = excluded.edit_token,
                     base_pending_revision = excluded.base_pending_revision, recovery_required = 0,
                     working_source_attachments_json = excluded.working_source_attachments_json",
                    params![command.camp_id, command.pending_input_id, token, revision, source_attachments_json],
                )?;
                return Ok(CommandHandlerResult::applied("pending_input.edit_started", json!({"editToken": token}), None));
            }
            PendingInputEditAction::Save { content, reply_to_camp_message_id, recipient_selection_required } => {
                if !owns_session || session.as_ref().is_some_and(|session| session.recovery_required) {
                    return Ok(reject("pending_input.edit_fenced", "The edit session changed; reopen it before saving"));
                }
                let content = normalize_composer_document(content.clone());
                validate_composer_document(&content)?;
                let body = render_input_body(transaction, &content)?;
                let working_source_attachments_json = transaction.query_row(
                    "SELECT working_source_attachments_json FROM pending_input_edit_session
                     WHERE camp_id = ?1 AND pending_input_id = ?2 AND edit_token = ?3",
                    params![command.camp_id, command.pending_input_id, command.edit_token],
                    |row| row.get::<_, String>(0),
                )?;
                let working_source_attachments = parse_source_attachments(&working_source_attachments_json)?;
                if body.trim().is_empty() && working_source_attachments.is_empty() { return Ok(reject("camp_message.empty_body", "Pending input must contain text or an attachment")); }
                // Reply identity can only be retained or explicitly removed by this editor.
                let stored = load_input(transaction, &command.pending_input_id, &command.camp_id)?;
                if reply_to_camp_message_id.is_some() && *reply_to_camp_message_id != stored.reply_to_camp_message_id {
                    return Ok(reject("camp_message.invalid_reply", "Pending input cannot change its Reply target"));
                }
                let mut execution = stored.execution;
                if let Some(execution) = execution.as_mut() {
                    execution.purpose = if body.trim().is_empty() {
                        "Camp attachment-only message".to_string()
                    } else {
                        body.chars().take(200).collect()
                    };
                }
                transaction.execute(
                    "UPDATE pending_camp_input SET structured_content_json = ?2, reply_to_camp_message_id = ?3,
                     recipient_selection_required = ?4, execution_json = ?5,
                     source_attachments_json = ?6, revision = revision + 1,
                     state = 'queued', last_attempt_error_code = NULL, updated_at = ?7 WHERE id = ?1",
                    params![command.pending_input_id, serialize_composer_document(&content)?, reply_to_camp_message_id,
                        recipient_selection_required, serde_json::to_string(&execution)?,
                        serialize_source_attachments(&working_source_attachments)?, chrono::Utc::now().to_rfc3339()],
                )?;
            }
            PendingInputEditAction::RemoveAttachment { attachment_ref_id } => {
                if !owns_session || session.as_ref().is_some_and(|session| session.recovery_required) {
                    return Ok(reject("pending_input.edit_fenced", "The edit session changed; reopen it before editing attachments"));
                }
                let mut refs = load_working_source_refs(transaction, &command.camp_id, &command.pending_input_id, command.edit_token.as_deref().unwrap_or_default())?;
                let previous_len = refs.len();
                refs.retain(|source_ref| source_ref.id != *attachment_ref_id);
                if refs.len() == previous_len {
                    return Ok(reject("attachment_not_found", "Source Attachment no longer exists in this edit"));
                }
                store_working_source_refs(transaction, &command.camp_id, &command.pending_input_id, command.edit_token.as_deref().unwrap_or_default(), &refs)?;
                return Ok(CommandHandlerResult::applied("pending_input.attachment_removed", json!({"pendingInputId": command.pending_input_id}), None));
            }
            PendingInputEditAction::ReorderAttachments { attachment_ref_ids } => {
                if !owns_session || session.as_ref().is_some_and(|session| session.recovery_required) {
                    return Ok(reject("pending_input.edit_fenced", "The edit session changed; reopen it before editing attachments"));
                }
                let refs = load_working_source_refs(transaction, &command.camp_id, &command.pending_input_id, command.edit_token.as_deref().unwrap_or_default())?;
                let by_id = refs.into_iter().map(|source_ref| (source_ref.id.clone(), source_ref)).collect::<std::collections::HashMap<_, _>>();
                if attachment_ref_ids.len() != by_id.len()
                    || attachment_ref_ids.iter().collect::<std::collections::HashSet<_>>().len() != by_id.len()
                    || attachment_ref_ids.iter().any(|id| !by_id.contains_key(id))
                {
                    return Ok(reject("attachment_order_changed", "Source Attachment order no longer matches this edit"));
                }
                let reordered = attachment_ref_ids.iter().map(|id| by_id.get(id).expect("validated Source Attachment ID").clone()).collect::<Vec<_>>();
                store_working_source_refs(transaction, &command.camp_id, &command.pending_input_id, command.edit_token.as_deref().unwrap_or_default(), &reordered)?;
                return Ok(CommandHandlerResult::applied("pending_input.attachments_reordered", json!({"pendingInputId": command.pending_input_id}), None));
            }
            PendingInputEditAction::Cancel => {
                if !owns_session { return Ok(reject("pending_input.edit_fenced", "The edit session changed; reload it first")); }
            }
            PendingInputEditAction::Delete => {
                if session.as_ref().is_some_and(|session| session.pending_input_id == command.pending_input_id) && !owns_session {
                    return Ok(reject("pending_input.edit_fenced", "The edit session changed; reload it first"));
                }
                transaction.execute(
                    "UPDATE pending_camp_input SET state = 'cancelled', revision = revision + 1, updated_at = ?2 WHERE id = ?1",
                    params![command.pending_input_id, chrono::Utc::now().to_rfc3339()],
                )?;
            }
        }
        transaction.execute("DELETE FROM pending_input_edit_session WHERE camp_id = ?1 AND pending_input_id = ?2",
            params![command.camp_id, command.pending_input_id])?;
        Ok(CommandHandlerResult::applied("pending_input.updated", json!({"pendingInputId": command.pending_input_id}), None))
    })
}

pub(crate) fn insert_input(
    transaction: &Transaction<'_>,
    camp_id: &str,
    content: &StructuredCampMessageContent,
    source_attachments: &[LocalAttachmentSourceRef],
    reply_to: Option<&str>,
    execution: &Option<ExecutionRequest>,
    user_id: &str,
) -> Result<CommandHandlerResult> {
    let document = composer_document_from_content(content)?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    transaction.execute(
        "INSERT INTO pending_camp_input(id, camp_id, enqueue_sequence, structured_content_json,
         source_attachments_json, reply_to_camp_message_id,
         execution_json, user_id, created_at, updated_at) VALUES (?1, ?2,
         (SELECT COALESCE(MAX(enqueue_sequence), 0) + 1 FROM pending_camp_input WHERE camp_id = ?2),
         ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            id,
            camp_id,
            serialize_composer_document(&document)?,
            serialize_source_attachments(source_attachments)?,
            reply_to,
            serde_json::to_string(execution)?,
            user_id,
            now
        ],
    )?;
    transaction.execute(
        "DELETE FROM camp_composer_draft WHERE camp_id = ?1",
        [camp_id],
    )?;
    Ok(CommandHandlerResult::accepted(
        "pending_input.queued",
        json!({"pendingInputId": id}),
        None,
    ))
}

/// Called inside the same immediate transaction as the official message publication.
pub(crate) fn publish_admission(
    transaction: &Transaction<'_>,
    command: &SendPendingCampInputCommand,
) -> Result<Option<CommandHandlerResult>> {
    let record = transaction.query_row(
        "SELECT revision, state, published_camp_message_id, published_camp_turn_id FROM pending_camp_input WHERE id = ?1 AND camp_id = ?2",
        params![command.pending_input_id, command.camp_id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?)),
    ).optional()?.context("Pending input no longer exists")?;
    if let Some(message_id) = record.2 {
        return Ok(Some(CommandHandlerResult::applied(
            "pending_input.already_published",
            json!({"campMessageId": message_id, "campTurnId": record.3}),
            None,
        )));
    }
    let head: Option<String> = transaction.query_row(
        "SELECT id FROM pending_camp_input WHERE camp_id = ?1 AND state IN ('queued', 'needs_repair') ORDER BY enqueue_sequence LIMIT 1",
        [&command.camp_id], |row| row.get(0),
    ).optional()?;
    let blocked: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM pending_input_edit_session WHERE pending_input_id = ?1)",
        [&command.pending_input_id],
        |row| row.get(0),
    )?;
    if record.0 != command.expected_revision
        || record.1 != "queued"
        || head.as_deref() != Some(&command.pending_input_id)
        || blocked
        || has_nonterminal_execution(transaction, &command.camp_id)?
    {
        return Ok(Some(reject(
            "pending_input.not_ready",
            "Queue head is not ready to send",
        )));
    }
    Ok(None)
}

pub(crate) fn record_published(
    transaction: &Transaction<'_>,
    id: &str,
    message_id: &str,
    turn_id: Option<&str>,
) -> Result<()> {
    transaction.execute(
        "UPDATE pending_camp_input SET state = 'published', published_camp_message_id = ?2, published_camp_turn_id = ?3,
         published_at = ?4, updated_at = ?4, last_attempt_error_code = NULL WHERE id = ?1",
        params![id, message_id, turn_id, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

pub(crate) fn record_publish_failure(
    connection: &Connection,
    command: &SendPendingCampInputCommand,
    code: &str,
) -> Result<()> {
    connection.execute(
        "UPDATE pending_camp_input SET state = 'needs_repair', last_attempt_error_code = ?3, updated_at = ?4
         WHERE id = ?1 AND revision = ?2 AND camp_id = ?5 AND state IN ('queued', 'needs_repair')",
        params![
            command.pending_input_id,
            command.expected_revision,
            code,
            chrono::Utc::now().to_rfc3339(),
            command.camp_id
        ],
    )?;
    Ok(())
}

/// Existing scheduler asks for one head per Camp. No leases, workers, or automatic retry timer.
pub fn ready_heads(database: &Database) -> Result<Vec<SendPendingCampInputCommand>> {
    let connection = database.connection();
    let mut statement = connection.prepare(
        "SELECT input.camp_id, input.id, input.revision FROM pending_camp_input AS input
         WHERE input.state = 'queued'
           AND NOT EXISTS(SELECT 1 FROM pending_camp_input AS older WHERE older.camp_id = input.camp_id
               AND older.state IN ('queued', 'needs_repair') AND older.enqueue_sequence < input.enqueue_sequence)
           AND NOT EXISTS(SELECT 1 FROM pending_input_edit_session WHERE pending_input_id = input.id)
         ORDER BY input.created_at, input.id",
    )?;
    let candidates = statement
        .query_map([], |row| {
            Ok(SendPendingCampInputCommand {
                camp_id: row.get(0)?,
                pending_input_id: row.get(1)?,
                expected_revision: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    candidates
        .into_iter()
        .filter_map(
            |command| match has_nonterminal_execution(connection, &command.camp_id) {
                Ok(false) => Some(Ok(command)),
                Ok(true) => None,
                Err(error) => Some(Err(error)),
            },
        )
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        camp_attachment::CampAttachmentStore,
        camp_content::{ComposerAtom, ComposerSegment, StructuredCampMessageSegment as Segment},
        collaboration::{CollaborationService, CreateCampCommand, SendUserCampDraftCommand},
        command::CommandResultStatus,
        current_user::CURRENT_USER_ID,
        local_attachment_source::observe_source_attachment,
        runtime::{CancelCampTurnCommand, ExecutionRuntimeService},
        test_support::{OwnedTestDatabase, seeded_runtime_database_owned},
    };

    fn envelope<P>(camp_id: &str, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: Uuid::new_v4().to_string(),
            actor: ActorRef::User {
                user_id: CURRENT_USER_ID.to_string(),
            },
            camp_id: Some(camp_id.to_string()),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    fn setup() -> (OwnedTestDatabase, String) {
        let mut database = seeded_runtime_database_owned();
        let workspace = database.directory().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut create = envelope(
            "",
            CreateCampCommand::for_test_with_members(
                workspace.to_string_lossy().to_string(),
                &["agent_1", "agent_2"],
                "agent_1",
            ),
        );
        create.camp_id = None;
        let result = CollaborationService::default()
            .create_camp(&mut database, &create)
            .unwrap();
        let camp_id = result.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        (database, camp_id)
    }

    fn text(value: &str) -> StructuredCampMessageContent {
        vec![Segment::Text {
            text: value.to_string(),
        }]
    }

    fn text_document(value: &str) -> ComposerDocument {
        composer_document_from_content(&text(value)).unwrap()
    }

    fn send(
        database: &mut Database,
        camp_id: &str,
        content: StructuredCampMessageContent,
    ) -> CommandExecution {
        let store = CampAttachmentStore::new(database.path().parent().unwrap());
        let draft = store.load_draft(database, camp_id).unwrap();
        let document = composer_document_from_content(&content).unwrap();
        let draft = store
            .save_content(database, camp_id, draft.revision, document)
            .unwrap();
        send_draft(database, camp_id, draft.revision)
    }

    fn send_draft(database: &mut Database, camp_id: &str, revision: i64) -> CommandExecution {
        CollaborationService::default()
            .send_user_camp_draft_with_managed_ingest(
                database,
                &envelope(
                    camp_id,
                    SendUserCampDraftCommand {
                        camp_id: camp_id.to_string(),
                        draft_revision: revision,
                        execution: Some(ExecutionRequest {
                            task_id: None,
                            purpose: "queue contract".to_string(),
                            completion_role: "required".to_string(),
                            budget: None,
                        }),
                    },
                ),
                None,
            )
            .unwrap()
    }

    fn complete_fixture_runs(database: &Database) {
        database.connection().execute_batch("UPDATE agent_run SET status = 'succeeded', ended_at = datetime('now'); UPDATE camp_turn SET status = 'completed', ended_at = datetime('now');").unwrap();
    }

    fn legacy_retry_wait(database: &Database, camp_turn_id: &str) {
        database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'failed', ended_at = '2026-08-31T00:00:00Z',
             manual_retry_allowed = 1, retry_declined_at = NULL,
             last_error_code = 'runtime_launch_failed'
             WHERE camp_turn_id = ?1",
                [camp_turn_id],
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE camp_turn SET status = 'waiting', ended_at = NULL WHERE id = ?1",
                [camp_turn_id],
            )
            .unwrap();
    }

    fn publish(
        database: &mut Database,
        camp_id: &str,
        id: &str,
        revision: i64,
    ) -> CommandExecution {
        CollaborationService::default()
            .send_pending_camp_input(
                database,
                &envelope(
                    camp_id,
                    SendPendingCampInputCommand {
                        camp_id: camp_id.to_string(),
                        pending_input_id: id.to_string(),
                        expected_revision: revision,
                    },
                ),
            )
            .unwrap()
    }

    fn edit(
        database: &mut Database,
        camp_id: &str,
        item: &PendingCampInputView,
        token: Option<&str>,
        action: PendingInputEditAction,
    ) -> CommandExecution {
        edit_input(
            database,
            &envelope(
                camp_id,
                EditPendingCampInputCommand {
                    camp_id: camp_id.to_string(),
                    pending_input_id: item.id.clone(),
                    expected_revision: item.revision,
                    edit_token: token.map(str::to_string),
                    action,
                },
            ),
        )
        .unwrap()
    }

    #[test]
    fn fifo_admission_publication_receipts_and_private_draft_are_atomic() {
        let (mut database, camp_id) = setup();
        let first = send(&mut database, &camp_id, text("A"));
        assert_eq!(first.result.code, "camp_turn.queued");
        let second = send(&mut database, &camp_id, text("B"));
        assert_eq!(second.result.code, "pending_input.queued");
        complete_fixture_runs(&database);
        let third = send(&mut database, &camp_id, text("C"));
        assert_eq!(
            third.result.code, "pending_input.queued",
            "idle Camp cannot bypass B"
        );
        let queue = read_queue(&database, &camp_id).unwrap();
        assert_eq!(
            queue
                .items
                .iter()
                .map(|item| item.body.as_str())
                .collect::<Vec<_>>(),
            ["B", "C"]
        );
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM camp_message", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        let b = &queue.items[0];
        let c = &queue.items[1];
        assert_eq!(
            publish(&mut database, &camp_id, &c.id, c.revision)
                .result
                .code,
            "pending_input.not_ready"
        );
        let store = CampAttachmentStore::new(database.directory());
        let draft = store
            .save_body(&mut database, &camp_id, "ordinary draft D")
            .unwrap();
        let published = publish(&mut database, &camp_id, &b.id, b.revision);
        assert_eq!(published.result.code, "camp_turn.queued");
        let duplicate = publish(&mut database, &camp_id, &b.id, b.revision);
        assert_eq!(duplicate.result.code, "pending_input.already_published");
        assert_eq!(
            duplicate.result.payload["campMessageId"],
            published.result.payload["campMessageId"]
        );
        assert_eq!(
            duplicate.result.payload["campTurnId"],
            published.result.payload["campTurnId"]
        );
        assert!(ready_heads(&database).unwrap().is_empty());
        assert_eq!(store.load_draft(&database, &camp_id).unwrap(), draft);
        complete_fixture_runs(&database);
        assert_eq!(
            publish(&mut database, &camp_id, &c.id, c.revision)
                .result
                .code,
            "camp_turn.queued"
        );
        assert!(read_queue(&database, &camp_id).unwrap().items.is_empty());
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM camp_message", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            3
        );
        assert_eq!(
            database
                .connection()
                .query_row("SELECT COUNT(*) FROM agent_run", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            3
        );
    }

    #[test]
    fn edit_recovery_blocks_head_and_fences_stale_save_and_cancel() {
        for legacy_failure in [false, true] {
            let (mut database, camp_id) = setup();
            let first = send(&mut database, &camp_id, text("A"));
            send(&mut database, &camp_id, text("B"));
            send(&mut database, &camp_id, text("C"));
            let items = read_queue(&database, &camp_id).unwrap().items;
            let b = &items[0];
            let c = &items[1];
            let started = edit(
                &mut database,
                &camp_id,
                b,
                None,
                PendingInputEditAction::Begin,
            );
            let old_token = started.result.payload["editToken"]
                .as_str()
                .unwrap()
                .to_string();
            if legacy_failure {
                legacy_retry_wait(
                    &database,
                    first.result.payload["campTurnId"].as_str().unwrap(),
                );
            } else {
                complete_fixture_runs(&database);
            }
            assert!(ready_heads(&database).unwrap().is_empty());
            assert_eq!(
                edit(
                    &mut database,
                    &camp_id,
                    c,
                    None,
                    PendingInputEditAction::Begin
                )
                .result
                .code,
                "pending_input.edit_open"
            );
            // Close/reopen a production-configured SQLite connection, then run Core's recovery hook.
            let directory = database.directory().to_path_buf();
            database.close();
            let mut reopened = Database::open(&directory).unwrap();
            recover_edit_sessions(&reopened).unwrap();
            reopened.prepare_v2_recovery().unwrap();
            crate::message_delivery::mark_unstarted_deliveries_interrupted_before_dispatch(
                &mut reopened,
            )
            .unwrap();
            crate::runtime::settle_legacy_retry_waits(&mut reopened).unwrap();
            assert!(
                !read_queue(&reopened, &camp_id).unwrap().execution_active,
                "settling a legacy failed turn must not release its pending edit"
            );
            assert!(
                read_queue(&reopened, &camp_id)
                    .unwrap()
                    .edit_session
                    .unwrap()
                    .recovery_required
            );
            assert!(ready_heads(&reopened).unwrap().is_empty());
            let saved = |content| PendingInputEditAction::Save {
                content,
                reply_to_camp_message_id: None,
                recipient_selection_required: false,
            };
            assert_eq!(
                edit(
                    &mut reopened,
                    &camp_id,
                    b,
                    Some(&old_token),
                    saved(text_document("lost edits"))
                )
                .result
                .code,
                "pending_input.edit_fenced"
            );
            let takeover = edit(
                &mut reopened,
                &camp_id,
                b,
                Some(&old_token),
                PendingInputEditAction::Takeover,
            );
            let token = takeover.result.payload["editToken"]
                .as_str()
                .unwrap()
                .to_string();
            assert_ne!(token, old_token);
            assert_eq!(
                edit(
                    &mut reopened,
                    &camp_id,
                    b,
                    Some(&old_token),
                    PendingInputEditAction::Cancel
                )
                .result
                .code,
                "pending_input.edit_fenced"
            );
            assert_eq!(
                edit(
                    &mut reopened,
                    &camp_id,
                    b,
                    Some(&token),
                    saved(text_document("  ")),
                )
                .result
                .code,
                "camp_message.empty_body"
            );
            assert!(ready_heads(&reopened).unwrap().is_empty());
            edit(
                &mut reopened,
                &camp_id,
                b,
                Some(&token),
                saved(text_document("edited B")),
            );
            assert_eq!(
                publish(&mut reopened, &camp_id, &b.id, b.revision)
                    .result
                    .code,
                "pending_input.not_ready"
            );
            let updated = read_queue(&reopened, &camp_id).unwrap();
            assert_eq!(updated.items[0].body, "edited B");
            assert_eq!(updated.items[0].enqueue_sequence, b.enqueue_sequence);
            assert_eq!(ready_heads(&reopened).unwrap()[0].pending_input_id, b.id);
            drop(reopened);
        }
    }

    #[test]
    fn startup_settles_legacy_retry_waits_once_and_preserves_pending_inputs() {
        // The same persisted failure must settle only after every Run is terminal.
        for blocking_status in [None, Some("queued"), Some("running"), Some("waiting")] {
            let (mut database, camp_id) = setup();
            let first = send(
                &mut database,
                &camp_id,
                vec![
                    Segment::MemberMention {
                        agent_id: "agent_1".to_string(),
                    },
                    Segment::MemberMention {
                        agent_id: "agent_2".to_string(),
                    },
                    Segment::Text {
                        text: " A".to_string(),
                    },
                ],
            );
            send(
                &mut database,
                &camp_id,
                vec![
                    Segment::MemberMention {
                        agent_id: "agent_2".to_string(),
                    },
                    Segment::Text {
                        text: " B".to_string(),
                    },
                ],
            );
            send(&mut database, &camp_id, text("C"));
            let turn_id = first.result.payload["campTurnId"].as_str().unwrap();
            legacy_retry_wait(&database, turn_id);
            if let Some(status) = blocking_status {
                database
                    .connection()
                    .execute(
                        "UPDATE agent_run SET status = ?2, ended_at = NULL,
                     wait_reason = CASE WHEN ?2 = 'waiting' THEN 'recovery_blocked' ELSE NULL END
                     WHERE id = ?1",
                        params![
                            first.result.payload["agentRunIds"][1].as_str().unwrap(),
                            status
                        ],
                    )
                    .unwrap();
            }
            let store = CampAttachmentStore::new(database.directory());
            let draft = store
                .save_body(&mut database, &camp_id, "private draft")
                .unwrap();
            let items = read_queue(&database, &camp_id).unwrap().items;
            let original_items = serde_json::to_value(&items).unwrap();
            let public_counts = |database: &Database| -> (i64, i64, i64) {
                database
                    .connection()
                    .query_row(
                        "SELECT (SELECT COUNT(*) FROM camp_message),
                     (SELECT COUNT(*) FROM camp_turn), (SELECT COUNT(*) FROM agent_run)",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .unwrap()
            };
            let counts = public_counts(&database);
            assert!(ready_heads(&database).unwrap().is_empty());
            let directory = database.directory().to_path_buf();
            database.close();
            let mut reopened = Database::open(&directory).unwrap();
            reopened.prepare_v2_recovery().unwrap();
            crate::message_delivery::mark_unstarted_deliveries_interrupted_before_dispatch(
                &mut reopened,
            )
            .unwrap();
            crate::runtime::settle_legacy_retry_waits(&mut reopened).unwrap();
            let turn_state = |database: &Database| -> (String, Option<String>, i64) {
                database
                    .connection()
                    .query_row(
                        "SELECT status, ended_at, version FROM camp_turn WHERE id = ?1",
                        [turn_id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .unwrap()
            };
            let settled = turn_state(&reopened);
            assert_eq!(
                public_counts(&reopened),
                counts,
                "startup never republishes A"
            );
            assert_eq!(
                serde_json::to_value(read_queue(&reopened, &camp_id).unwrap().items).unwrap(),
                original_items
            );
            assert_eq!(store.load_draft(&reopened, &camp_id).unwrap(), draft);
            if blocking_status.is_some() {
                assert_eq!(settled.0, "waiting");
                assert!(settled.1.is_none());
                assert!(ready_heads(&reopened).unwrap().is_empty());
                continue;
            }
            assert_eq!(settled.0, "failed");
            assert!(settled.1.is_some());
            let settlement_events = |database: &Database| -> i64 {
                database
                    .connection()
                    .query_row(
                        "SELECT COUNT(*) FROM event_log WHERE entity_id = ?1
                     AND event_type = 'camp_turn.status_changed'
                     AND json_extract(payload_json, '$.status') = 'failed'",
                        [turn_id],
                        |row| row.get(0),
                    )
                    .unwrap()
            };
            assert_eq!(settlement_events(&reopened), 1);
            // A second startup must not change the terminal timestamp/version or duplicate its event.
            reopened.prepare_v2_recovery().unwrap();
            crate::message_delivery::mark_unstarted_deliveries_interrupted_before_dispatch(
                &mut reopened,
            )
            .unwrap();
            crate::runtime::settle_legacy_retry_waits(&mut reopened).unwrap();
            assert_eq!(turn_state(&reopened), settled);
            assert_eq!(settlement_events(&reopened), 1);
            let preserved_failures: i64 = reopened
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM agent_run WHERE camp_turn_id = ?1
                 AND status = 'failed' AND manual_retry_allowed = 1
                 AND retry_declined_at IS NULL AND last_error_code = 'runtime_launch_failed'
                 AND ended_at = '2026-08-31T00:00:00Z' AND execution_epoch = 0",
                    [turn_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(preserved_failures, 2);
            let ready = ready_heads(&reopened).unwrap();
            assert_eq!(ready.len(), 1);
            assert_eq!(ready[0].pending_input_id, items[0].id);
            assert_eq!(
                publish(&mut reopened, &camp_id, &items[1].id, items[1].revision)
                    .result
                    .code,
                "pending_input.not_ready"
            );
            let published = publish(&mut reopened, &camp_id, &items[0].id, items[0].revision);
            assert_eq!(published.result.code, "camp_turn.queued");
            let recipient: String = reopened
                .connection()
                .query_row(
                    "SELECT conversation.agent_id FROM agent_run
                 JOIN conversation ON conversation.id = agent_run.conversation_id
                 WHERE agent_run.id = ?1",
                    [published.result.payload["agentRunIds"][0].as_str().unwrap()],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(recipient, "agent_2");
            assert_eq!(
                public_counts(&reopened),
                (counts.0 + 1, counts.1 + 1, counts.2 + 1)
            );
            assert_eq!(
                read_queue(&reopened, &camp_id).unwrap().items[0].id,
                items[1].id
            );
            assert!(ready_heads(&reopened).unwrap().is_empty());
            assert_eq!(store.load_draft(&reopened, &camp_id).unwrap(), draft);
        }
    }

    #[test]
    fn repair_uses_new_command_identity_and_never_rebinds_reply_author() {
        let (mut database, camp_id) = setup();
        let first = send(&mut database, &camp_id, text("parent"));
        let parent = first.result.payload["campMessageId"]
            .as_str()
            .unwrap()
            .to_string();
        let store = CampAttachmentStore::new(database.directory());
        let draft = store
            .save_content(
                &mut database,
                &camp_id,
                0,
                composer_document_from_content(&[
                    Segment::MemberMention {
                        agent_id: "agent_2".to_string(),
                    },
                    Segment::Text {
                        text: " original".to_string(),
                    },
                ])
                .unwrap(),
            )
            .unwrap();
        let draft = store
            .start_reply(&mut database, &camp_id, draft.revision, &parent)
            .unwrap();
        send_draft(&mut database, &camp_id, draft.revision);
        database
            .connection()
            .execute(
                "UPDATE agent_profile SET profile_status = 'away' WHERE id = 'agent_2'",
                [],
            )
            .unwrap();
        complete_fixture_runs(&database);
        let item = read_queue(&database, &camp_id).unwrap().items.remove(0);
        let failed_request = envelope(
            &camp_id,
            SendPendingCampInputCommand {
                camp_id: camp_id.clone(),
                pending_input_id: item.id.clone(),
                expected_revision: item.revision,
            },
        );
        let rejected = CollaborationService::default()
            .send_pending_camp_input(&mut database, &failed_request)
            .unwrap();
        assert_eq!(rejected.result.code, "mention_target_unavailable");
        assert_eq!(
            send(&mut database, &camp_id, text("after repaired head"))
                .result
                .code,
            "pending_input.queued"
        );
        let queue = read_queue(&database, &camp_id).unwrap();
        assert_eq!(queue.items[0].state, "needs_repair");
        assert!(ready_heads(&database).unwrap().is_empty());
        let started = edit(
            &mut database,
            &camp_id,
            &item,
            None,
            PendingInputEditAction::Begin,
        );
        let token = started.result.payload["editToken"].as_str().unwrap();
        edit(
            &mut database,
            &camp_id,
            &item,
            Some(token),
            PendingInputEditAction::Save {
                content: text_document("use current Lead"),
                reply_to_camp_message_id: Some(parent.clone()),
                recipient_selection_required: false,
            },
        );
        assert_eq!(ready_heads(&database).unwrap()[0].pending_input_id, item.id);
        let replay = CollaborationService::default()
            .send_pending_camp_input(&mut database, &failed_request)
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.result.code, "mention_target_unavailable");
        let sent = publish(&mut database, &camp_id, &item.id, item.revision + 1);
        assert_eq!(sent.result.code, "camp_turn.queued");
        let published: (String, String) = database.connection().query_row("SELECT addressed_agent_ids_json, reply_to_camp_message_id FROM camp_message WHERE id = ?1",
            [sent.result.payload["campMessageId"].as_str().unwrap()], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
        assert_eq!(published, ("[\"agent_1\"]".to_string(), parent));
    }

    #[test]
    fn continuation_is_materialized_but_default_lead_is_resolved_at_publication() {
        let (mut database, camp_id) = setup();
        let original = send(
            &mut database,
            &camp_id,
            vec![
                Segment::MemberMention {
                    agent_id: "agent_2".to_string(),
                },
                Segment::Text {
                    text: " first".to_string(),
                },
            ],
        );
        let store = CampAttachmentStore::new(database.directory());
        let draft = store.load_draft(&database, &camp_id).unwrap();
        let draft = store
            .save_content_with_continuation(
                &mut database,
                &camp_id,
                draft.revision,
                text_document("continue"),
                original.result.payload["campMessageId"].as_str(),
            )
            .unwrap();
        send_draft(&mut database, &camp_id, draft.revision);
        let continued = read_queue(&database, &camp_id).unwrap().items.remove(0);
        assert!(matches!(
            &continued.content.segments[0],
            ComposerSegment::Atom {
                atom: ComposerAtom::Member { agent_id, .. }
            } if agent_id == "agent_2"
        ));
        edit(
            &mut database,
            &camp_id,
            &continued,
            None,
            PendingInputEditAction::Delete,
        );
        send(&mut database, &camp_id, text("new default route"));
        database
            .connection()
            .execute(
                "UPDATE camp SET default_lead_agent_id = 'agent_2' WHERE id = ?1",
                [&camp_id],
            )
            .unwrap();
        complete_fixture_runs(&database);
        let item = read_queue(&database, &camp_id).unwrap().items.remove(0);
        let sent = publish(&mut database, &camp_id, &item.id, item.revision);
        let route: String = database
            .connection()
            .query_row(
                "SELECT addressed_agent_ids_json FROM camp_message WHERE id = ?1",
                [sent.result.payload["campMessageId"].as_str().unwrap()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(route, "[\"agent_2\"]");
    }

    #[test]
    fn source_attachments_queue_with_the_complete_intent_without_legacy_rows() {
        let (mut database, camp_id) = setup();
        send(&mut database, &camp_id, text("A"));
        let store = CampAttachmentStore::new(database.directory());
        let source = database.directory().join("attachment.txt");
        std::fs::write(&source, "keep this attachment").unwrap();
        let draft = store
            .save_body(&mut database, &camp_id, "with attachment")
            .unwrap();
        let draft = store
            .commit_source_attachment(
                &mut database,
                &camp_id,
                draft.revision,
                observe_source_attachment(&source, "attachment.txt", Some("text/plain")).unwrap(),
            )
            .unwrap();
        let attachment_id = draft.attachments[0].id.clone();
        let queued = send_draft(&mut database, &camp_id, draft.revision);
        assert_eq!(queued.result.code, "pending_input.queued");
        assert!(
            store
                .load_draft(&database, &camp_id)
                .unwrap()
                .attachments
                .is_empty()
        );
        let queue = read_queue(&database, &camp_id).unwrap();
        assert_eq!(queue.items[0].attachments[0].id, attachment_id);
        let source_json: String = database
            .connection()
            .query_row(
                "SELECT source_attachments_json FROM pending_camp_input WHERE id = ?1",
                [queue.items[0].id.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert!(source_json.contains(&source.to_string_lossy().to_string()));
        for table in [
            "prepared_attachment",
            "managed_attachment",
            "message_attachment",
            "camp_message_attachment_ref",
        ] {
            let count: i64 = database
                .connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "source attachment unexpectedly wrote {table}");
        }
        complete_fixture_runs(&database);
        let item = &queue.items[0];
        let published = publish(&mut database, &camp_id, &item.id, item.revision);
        let message_id = published.result.payload["campMessageId"].as_str().unwrap();
        let message_json: String = database
            .connection()
            .query_row(
                "SELECT source_attachments_json FROM camp_message WHERE id = ?1",
                [message_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(message_json, source_json);
        for table in [
            "prepared_attachment",
            "managed_attachment",
            "message_attachment",
            "camp_message_attachment_ref",
        ] {
            let count: i64 = database
                .connection()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "source publication unexpectedly wrote {table}");
        }
    }

    #[test]
    fn unavailable_source_preserves_immediate_draft_and_blocks_pending_fifo_for_repair() {
        let (mut database, camp_id) = setup();
        let store = CampAttachmentStore::new(database.directory());
        let immediate_source = database.directory().join("missing-immediate.txt");
        std::fs::write(&immediate_source, "immediate").unwrap();
        let draft = store
            .save_body(&mut database, &camp_id, "immediate")
            .unwrap();
        let draft = store
            .commit_source_attachment(
                &mut database,
                &camp_id,
                draft.revision,
                observe_source_attachment(&immediate_source, "immediate.txt", Some("text/plain"))
                    .unwrap(),
            )
            .unwrap();
        std::fs::remove_file(&immediate_source).unwrap();
        let rejected = send_draft(&mut database, &camp_id, draft.revision);
        assert_eq!(rejected.result.code, "attachment_missing");
        assert_eq!(store.load_draft(&database, &camp_id).unwrap(), draft);
        let message_count: i64 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM camp_message", [], |row| row.get(0))
            .unwrap();
        assert_eq!(message_count, 0);

        store
            .discard_draft_from_database(&mut database, &camp_id)
            .unwrap();
        send(&mut database, &camp_id, text("active"));
        let pending_source = database.directory().join("missing-pending.txt");
        std::fs::write(&pending_source, "pending").unwrap();
        let draft = store
            .save_body(&mut database, &camp_id, "pending head")
            .unwrap();
        let draft = store
            .commit_source_attachment(
                &mut database,
                &camp_id,
                draft.revision,
                observe_source_attachment(&pending_source, "pending.txt", Some("text/plain"))
                    .unwrap(),
            )
            .unwrap();
        send_draft(&mut database, &camp_id, draft.revision);
        send(&mut database, &camp_id, text("second pending"));
        complete_fixture_runs(&database);
        std::fs::remove_file(&pending_source).unwrap();

        let head = read_queue(&database, &camp_id).unwrap().items.remove(0);
        let rejected = publish(&mut database, &camp_id, &head.id, head.revision);
        assert_eq!(rejected.result.code, "attachment_missing");
        let queue = read_queue(&database, &camp_id).unwrap();
        assert_eq!(queue.items[0].id, head.id);
        assert_eq!(queue.items[0].state, "needs_repair");
        assert_eq!(
            queue.items[0].last_attempt_error_code.as_deref(),
            Some("attachment_missing")
        );
        assert_eq!(queue.items.len(), 2);
        assert!(ready_heads(&database).unwrap().is_empty());
    }

    #[test]
    fn pending_edit_working_refs_cancel_or_save_and_publish_an_attachment_only_intent() {
        let (mut database, camp_id) = setup();
        send(&mut database, &camp_id, text("active"));
        send(&mut database, &camp_id, text("edit me"));
        let item = read_queue(&database, &camp_id).unwrap().items.remove(0);
        let started = edit(
            &mut database,
            &camp_id,
            &item,
            None,
            PendingInputEditAction::Begin,
        );
        let token = started.result.payload["editToken"]
            .as_str()
            .unwrap()
            .to_string();
        let first_path = database.directory().join("first.txt");
        std::fs::write(&first_path, "first").unwrap();
        add_working_source_attachment(
            &mut database,
            &camp_id,
            &item.id,
            item.revision,
            &token,
            observe_source_attachment(&first_path, "first.txt", Some("text/plain")).unwrap(),
        )
        .unwrap();
        edit(
            &mut database,
            &camp_id,
            &item,
            Some(&token),
            PendingInputEditAction::Cancel,
        );
        assert!(
            read_queue(&database, &camp_id).unwrap().items[0]
                .attachments
                .is_empty()
        );

        let started = edit(
            &mut database,
            &camp_id,
            &item,
            None,
            PendingInputEditAction::Begin,
        );
        let token = started.result.payload["editToken"]
            .as_str()
            .unwrap()
            .to_string();
        let second_path = database.directory().join("second.txt");
        std::fs::write(&second_path, "second").unwrap();
        for (path, name) in [(&first_path, "first.txt"), (&second_path, "second.txt")] {
            add_working_source_attachment(
                &mut database,
                &camp_id,
                &item.id,
                item.revision,
                &token,
                observe_source_attachment(path, name, Some("text/plain")).unwrap(),
            )
            .unwrap();
        }
        let working = read_queue(&database, &camp_id)
            .unwrap()
            .edit_session
            .unwrap()
            .working_attachments;
        edit(
            &mut database,
            &camp_id,
            &item,
            Some(&token),
            PendingInputEditAction::ReorderAttachments {
                attachment_ref_ids: vec![working[1].id.clone(), working[0].id.clone()],
            },
        );
        edit(
            &mut database,
            &camp_id,
            &item,
            Some(&token),
            PendingInputEditAction::RemoveAttachment {
                attachment_ref_id: working[0].id.clone(),
            },
        );
        let saved = edit(
            &mut database,
            &camp_id,
            &item,
            Some(&token),
            PendingInputEditAction::Save {
                content: ComposerDocument::default(),
                reply_to_camp_message_id: None,
                recipient_selection_required: false,
            },
        );
        assert_eq!(saved.result.status, CommandResultStatus::Applied);
        let saved = read_queue(&database, &camp_id).unwrap().items.remove(0);
        assert!(saved.body.is_empty());
        assert_eq!(saved.attachments.len(), 1);
        assert_eq!(saved.attachments[0].id, working[1].id);
        assert_eq!(saved.revision, item.revision + 1);

        complete_fixture_runs(&database);
        assert_eq!(
            ready_heads(&database).unwrap()[0].pending_input_id,
            saved.id
        );
        let published = publish(&mut database, &camp_id, &saved.id, saved.revision);
        assert_eq!(published.result.code, "camp_turn.queued");
        assert!(read_queue(&database, &camp_id).unwrap().items.is_empty());
    }

    #[test]
    fn terminal_turns_advance_queue_while_recovery_waits_for_settlement() {
        let (mut database, camp_id) = setup();
        let fast_target = crate::camp_fast::target(&database, &camp_id, "agent_1")
            .unwrap()
            .unwrap();
        let runtime = crate::camp_fast::runtime_for_target(&database, &fast_target)
            .unwrap()
            .unwrap();
        assert!(
            crate::camp_fast::record_eligibility(
                &database,
                &fast_target,
                &runtime,
                &crate::camp_fast::NativeFastEligibility {
                    eligible: true,
                    runtime_default_fast: Some(false),
                },
            )
            .unwrap()
        );
        let set_fast = |database: &mut Database, enabled| {
            let result = crate::camp_fast::set_preference(
                database,
                &envelope(
                    &camp_id,
                    crate::camp_fast::SetCampMemberFastCommand {
                        camp_id: camp_id.clone(),
                        agent_id: "agent_1".to_string(),
                        expected_runtime_binding_revision: fast_target
                            .runtime_binding_revision
                            .clone(),
                        fast_override: Some(enabled),
                    },
                ),
            )
            .unwrap();
            assert_eq!(result.result.status, CommandResultStatus::Applied);
        };
        let frozen_config = |database: &Database, turn_id: &str| -> serde_json::Value {
            let serialized: String = database
                .connection()
                .query_row(
                    "SELECT agent_run.effective_config_json FROM agent_run
                 JOIN conversation ON conversation.id = agent_run.conversation_id
                 WHERE agent_run.camp_turn_id = ?1 AND conversation.agent_id = 'agent_1'",
                    [turn_id],
                    |row| row.get(0),
                )
                .unwrap();
            serde_json::from_str(&serialized).unwrap()
        };
        set_fast(&mut database, false);
        let first = send(&mut database, &camp_id, text("A"));
        send(&mut database, &camp_id, text("B"));
        send(&mut database, &camp_id, text("C"));
        let turn_id = first.result.payload["campTurnId"]
            .as_str()
            .unwrap()
            .to_string();
        let first_config = frozen_config(&database, &turn_id);
        assert_eq!(first_config["runtime"]["campFast"]["fastOverride"], false);
        set_fast(&mut database, true);
        assert_eq!(frozen_config(&database, &turn_id), first_config);
        let version = database
            .connection()
            .query_row(
                "SELECT version FROM camp_turn WHERE id = ?1",
                [&turn_id],
                |row| row.get(0),
            )
            .unwrap();
        let result = ExecutionRuntimeService::default()
            .request_camp_turn_cancellation(
                &mut database,
                &envelope(
                    &camp_id,
                    CancelCampTurnCommand {
                        camp_id: camp_id.clone(),
                        camp_turn_id: turn_id.clone(),
                        expected_version: version,
                    },
                ),
            )
            .unwrap();
        assert_eq!(result.result.status, CommandResultStatus::Applied);
        assert_eq!(result.result.payload["campTurnStatus"], "cancelled");
        // The Stop transaction releases A's business ownership before Runtime cleanup.
        let item = read_queue(&database, &camp_id).unwrap().items.remove(0);
        let ready = ready_heads(&database).unwrap();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0].pending_input_id, item.id);
        let published = publish(&mut database, &camp_id, &item.id, item.revision);
        assert_eq!(published.result.code, "camp_turn.queued");
        assert!(ready_heads(&database).unwrap().is_empty());
        assert_eq!(read_queue(&database, &camp_id).unwrap().items[0].body, "C");
        let turn = published.result.payload["campTurnId"].as_str().unwrap();
        assert_eq!(
            frozen_config(&database, turn)["runtime"]["campFast"]["fastOverride"],
            true,
            "Pending B freezes the current Fast choice when published, not when enqueued"
        );
        assert_eq!(frozen_config(&database, &turn_id), first_config);
        for manual_retry_allowed in [0, 1] {
            let transaction = database.connection_mut().transaction().unwrap();
            transaction
                .execute(
                    "UPDATE agent_run SET status = 'failed', ended_at = datetime('now'),
             manual_retry_allowed = ?2 WHERE camp_turn_id = ?1",
                    params![turn, manual_retry_allowed],
                )
                .unwrap();
            let settled = crate::runtime::recompute_camp_turn(
                &transaction,
                &camp_id,
                turn,
                &ActorRef::System {
                    component_id: "test".to_string(),
                },
                None,
                &chrono::Utc::now().to_rfc3339(),
            )
            .unwrap();
            assert_eq!(
                settled, "failed",
                "legacy retry metadata must not keep a failed turn waiting"
            );
            transaction.commit().unwrap();
        }
        let remaining = read_queue(&database, &camp_id).unwrap().items.remove(0);
        assert_eq!(
            ready_heads(&database).unwrap()[0].pending_input_id,
            remaining.id
        );
        assert_eq!(
            read_queue(&database, &camp_id).unwrap().items[0].body,
            "C",
            "published B is never requeued on Runtime failure"
        );
        database.connection().execute("UPDATE agent_run SET status = 'waiting', ended_at = NULL, wait_reason = 'recovery_blocked' WHERE camp_turn_id = ?1", [turn]).unwrap();
        assert!(ready_heads(&database).unwrap().is_empty());
        database.connection().execute("UPDATE agent_run SET status = 'failed', ended_at = datetime('now'), wait_reason = NULL WHERE camp_turn_id = ?1", [turn]).unwrap();
        assert_eq!(
            ready_heads(&database).unwrap()[0].pending_input_id,
            remaining.id
        );
    }

    #[test]
    fn publication_rollback_preserves_input_until_explicit_edit_save() {
        let (mut database, camp_id) = setup();
        send(&mut database, &camp_id, text("A"));
        send(&mut database, &camp_id, text("B"));
        complete_fixture_runs(&database);
        let item = read_queue(&database, &camp_id).unwrap().items.remove(0);
        let public_count: i64 = database.connection().query_row("SELECT (SELECT COUNT(*) FROM camp_message) + (SELECT COUNT(*) FROM camp_turn) + (SELECT COUNT(*) FROM agent_run)", [], |row| row.get(0)).unwrap();
        let resave = |database: &mut Database| {
            let current = read_queue(database, &camp_id).unwrap().items.remove(0);
            let started = edit(
                database,
                &camp_id,
                &current,
                None,
                PendingInputEditAction::Begin,
            );
            let token = started.result.payload["editToken"].as_str().unwrap();
            let saved = edit(
                database,
                &camp_id,
                &current,
                Some(token),
                PendingInputEditAction::Save {
                    content: current.content.clone(),
                    reply_to_camp_message_id: None,
                    recipient_selection_required: false,
                },
            );
            assert_eq!(saved.result.status, CommandResultStatus::Applied);
            let updated = read_queue(database, &camp_id).unwrap().items.remove(0);
            assert_eq!(
                ready_heads(database).unwrap()[0].pending_input_id,
                updated.id
            );
            updated
        };
        database.connection().execute_batch("CREATE TEMP TRIGGER interrupt_pending_publication BEFORE UPDATE OF state ON pending_camp_input
            WHEN NEW.state = 'published' BEGIN SELECT RAISE(ABORT, 'test commit failure'); END;").unwrap();
        let request = envelope(
            &camp_id,
            SendPendingCampInputCommand {
                camp_id: camp_id.clone(),
                pending_input_id: item.id.clone(),
                expected_revision: item.revision,
            },
        );
        assert!(
            CollaborationService::default()
                .send_pending_camp_input(&mut database, &request)
                .is_err()
        );
        assert_eq!(database.connection().query_row("SELECT (SELECT COUNT(*) FROM camp_message) + (SELECT COUNT(*) FROM camp_turn) + (SELECT COUNT(*) FROM agent_run)", [], |row| row.get::<_, i64>(0)).unwrap(), public_count);
        assert!(ready_heads(&database).unwrap().is_empty());
        assert_eq!(
            read_queue(&database, &camp_id).unwrap().items[0].state,
            "needs_repair"
        );
        database
            .connection()
            .execute_batch("DROP TRIGGER interrupt_pending_publication")
            .unwrap();
        assert!(ready_heads(&database).unwrap().is_empty());
        let item = resave(&mut database);
        // A failure before the publication transaction must also stop the scheduler.
        let execution_json: String = database
            .connection()
            .query_row(
                "SELECT execution_json FROM pending_camp_input WHERE id = ?1",
                [&item.id],
                |row| row.get(0),
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE pending_camp_input SET execution_json = 'invalid' WHERE id = ?1",
                [&item.id],
            )
            .unwrap();
        let request = envelope(
            &camp_id,
            SendPendingCampInputCommand {
                camp_id: camp_id.clone(),
                pending_input_id: item.id.clone(),
                expected_revision: item.revision,
            },
        );
        assert!(
            CollaborationService::default()
                .send_pending_camp_input(&mut database, &request)
                .is_err()
        );
        assert!(ready_heads(&database).unwrap().is_empty());
        database
            .connection()
            .execute(
                "UPDATE pending_camp_input SET execution_json = ?2 WHERE id = ?1",
                params![item.id, execution_json],
            )
            .unwrap();
        assert!(ready_heads(&database).unwrap().is_empty());
        let item = resave(&mut database);
        assert_eq!(
            publish(&mut database, &camp_id, &item.id, item.revision)
                .result
                .code,
            "camp_turn.queued"
        );
    }
}
