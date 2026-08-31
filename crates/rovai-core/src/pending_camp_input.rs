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
        StructuredCampMessageContent, normalize_content, render_plain_text,
        validate_user_authored_content,
    },
    collaboration::ExecutionRequest,
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, sealed,
    },
    db::Database,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingCampInputView {
    pub id: String,
    pub camp_id: String,
    pub enqueue_sequence: i64,
    pub revision: i64,
    pub state: String,
    pub content: StructuredCampMessageContent,
    pub body: String,
    pub reply_intent: Option<CampComposerReplyIntentView>,
    pub recipient_selection_required: bool,
    pub last_attempt_error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInputEditSession {
    pub pending_input_id: String,
    pub edit_token: String,
    pub base_pending_revision: i64,
    pub recovery_required: bool,
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
        content: StructuredCampMessageContent,
        #[serde(rename = "replyToCampMessageId")]
        reply_to_camp_message_id: Option<String>,
        #[serde(rename = "recipientSelectionRequired")]
        recipient_selection_required: bool,
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
    pub content: StructuredCampMessageContent,
    pub reply_to_camp_message_id: Option<String>,
    pub recipient_selection_required: bool,
    pub execution: Option<ExecutionRequest>,
    pub user_id: String,
}

pub(crate) fn load_input(
    connection: &Connection,
    id: &str,
    camp_id: &str,
) -> Result<StoredPendingInput> {
    let (content, reply, required, execution, user_id): (String, Option<String>, bool, String, String) = connection.query_row(
        "SELECT structured_content_json, reply_to_camp_message_id, recipient_selection_required, execution_json, user_id
         FROM pending_camp_input WHERE id = ?1 AND camp_id = ?2",
        params![id, camp_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    )?;
    Ok(StoredPendingInput {
        content: serde_json::from_str(&content)?,
        reply_to_camp_message_id: reply,
        recipient_selection_required: required,
        execution: serde_json::from_str(&execution)?,
        user_id,
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
        let body = render_input_body(connection, &stored.content)?;
        items.push(PendingCampInputView {
            id,
            camp_id: camp_id.to_string(),
            enqueue_sequence,
            revision,
            state,
            content: stored.content,
            body,
            reply_intent: project_reply_intent(
                database,
                camp_id,
                stored.reply_to_camp_message_id.as_deref(),
                stored.recipient_selection_required,
            )?,
            recipient_selection_required: stored.recipient_selection_required,
            last_attempt_error_code,
        });
    }
    Ok(CampPendingInputsView {
        camp_id: camp_id.to_string(),
        execution_active: has_nonterminal_execution(connection, camp_id)?,
        items,
        edit_session: load_edit_session(connection, camp_id)?,
    })
}

fn render_input_body(
    connection: &Connection,
    content: &StructuredCampMessageContent,
) -> Result<String> {
    render_plain_text(content, |agent_id| {
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
    Ok(connection.query_row(
        "SELECT pending_input_id, edit_token, base_pending_revision, recovery_required FROM pending_input_edit_session WHERE camp_id = ?1",
        [camp_id], |row| Ok(PendingInputEditSession {
            pending_input_id: row.get(0)?, edit_token: row.get(1)?, base_pending_revision: row.get(2)?, recovery_required: row.get(3)?,
        }),
    ).optional()?)
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
            "SELECT revision, state FROM pending_camp_input WHERE id = ?1 AND camp_id = ?2",
            params![command.pending_input_id, command.camp_id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        ).optional()?;
        let Some((revision, state)) = current else { return Ok(reject("pending_input.not_found", "Pending input no longer exists")); };
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
                    "INSERT INTO pending_input_edit_session(camp_id, pending_input_id, edit_token, base_pending_revision, recovery_required)
                     VALUES (?1, ?2, ?3, ?4, 0) ON CONFLICT(camp_id) DO UPDATE SET
                     pending_input_id = excluded.pending_input_id, edit_token = excluded.edit_token,
                     base_pending_revision = excluded.base_pending_revision, recovery_required = 0",
                    params![command.camp_id, command.pending_input_id, token, revision],
                )?;
                return Ok(CommandHandlerResult::applied("pending_input.edit_started", json!({"editToken": token}), None));
            }
            PendingInputEditAction::Save { content, reply_to_camp_message_id, recipient_selection_required } => {
                if !owns_session || session.as_ref().is_some_and(|session| session.recovery_required) {
                    return Ok(reject("pending_input.edit_fenced", "The edit session changed; reopen it before saving"));
                }
                let content = normalize_content(content.clone());
                validate_user_authored_content(&content)?;
                let body = render_input_body(transaction, &content)?;
                if body.trim().is_empty() { return Ok(reject("camp_message.empty_body", "Pending input must not be empty")); }
                // Reply identity can only be retained or explicitly removed by this editor.
                let stored = load_input(transaction, &command.pending_input_id, &command.camp_id)?;
                if reply_to_camp_message_id.is_some() && *reply_to_camp_message_id != stored.reply_to_camp_message_id {
                    return Ok(reject("camp_message.invalid_reply", "Pending input cannot change its Reply target"));
                }
                let mut execution = stored.execution;
                if let Some(execution) = execution.as_mut() { execution.purpose = body.chars().take(200).collect(); }
                transaction.execute(
                    "UPDATE pending_camp_input SET structured_content_json = ?2, reply_to_camp_message_id = ?3,
                     recipient_selection_required = ?4, execution_json = ?5, revision = revision + 1,
                     state = 'queued', last_attempt_error_code = NULL, updated_at = ?6 WHERE id = ?1",
                    params![command.pending_input_id, serde_json::to_string(&content)?, reply_to_camp_message_id,
                        recipient_selection_required, serde_json::to_string(&execution)?, chrono::Utc::now().to_rfc3339()],
                )?;
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
    reply_to: Option<&str>,
    execution: &Option<ExecutionRequest>,
    user_id: &str,
) -> Result<CommandHandlerResult> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    transaction.execute(
        "INSERT INTO pending_camp_input(id, camp_id, enqueue_sequence, structured_content_json, reply_to_camp_message_id,
         execution_json, user_id, created_at, updated_at) VALUES (?1, ?2,
         (SELECT COALESCE(MAX(enqueue_sequence), 0) + 1 FROM pending_camp_input WHERE camp_id = ?2), ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, camp_id, serde_json::to_string(content)?, reply_to, serde_json::to_string(execution)?, user_id, now],
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
        camp_content::StructuredCampMessageSegment as Segment,
        collaboration::{CollaborationService, CreateCampCommand, SendUserCampDraftCommand},
        command::CommandResultStatus,
        current_user::CURRENT_USER_ID,
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

    fn send(
        database: &mut Database,
        camp_id: &str,
        content: StructuredCampMessageContent,
    ) -> CommandExecution {
        let store = CampAttachmentStore::new(database.path().parent().unwrap());
        let draft = store.load_draft(database, camp_id).unwrap();
        let draft = store
            .save_content(database, camp_id, draft.revision, content)
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
                    saved(text("lost edits"))
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
                edit(&mut reopened, &camp_id, b, Some(&token), saved(text("  ")))
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
                saved(text("edited B")),
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
                vec![
                    Segment::MemberMention {
                        agent_id: "agent_2".to_string(),
                    },
                    Segment::Text {
                        text: " original".to_string(),
                    },
                ],
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
                content: text("use current Lead"),
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
                text("continue"),
                original.result.payload["campMessageId"].as_str(),
            )
            .unwrap();
        send_draft(&mut database, &camp_id, draft.revision);
        let continued = read_queue(&database, &camp_id).unwrap().items.remove(0);
        assert!(
            matches!(&continued.content[0], Segment::MemberMention { agent_id } if agent_id == "agent_2")
        );
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
    fn attachments_cannot_be_queued_and_rejection_keeps_exact_draft() {
        let (mut database, camp_id) = setup();
        send(&mut database, &camp_id, text("A"));
        let store = CampAttachmentStore::new(database.directory());
        let source = database.directory().join("attachment.txt");
        std::fs::write(&source, "keep this attachment").unwrap();
        let draft = store
            .save_body(&mut database, &camp_id, "with attachment")
            .unwrap();
        let draft = store
            .prepare_from_path(
                &mut database,
                &camp_id,
                draft.revision,
                &source,
                "attachment.txt",
            )
            .unwrap();
        let rejected = send_draft(&mut database, &camp_id, draft.revision);
        assert_eq!(
            rejected.result.code,
            "pending_input.attachments_unsupported"
        );
        assert_eq!(store.load_draft(&database, &camp_id).unwrap(), draft);
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
