#[path = "chat_lifecycle.rs"]
mod lifecycle;
pub(crate) use lifecycle::{
    DeleteChat, SetArchived, StopChat, complete_directory_cleanup, prepare_deletions,
    request_delete, set_archived, stop,
};
#[path = "chat_steer.rs"]
mod steer;
pub(crate) use steer::{accept_steer, ready_steers, return_steer_to_queue, settle_steers};
#[path = "chat_input.rs"]
mod input;
pub(crate) use input::{
    ChatSkill, EditPending, SendInput, bind_send_identity, edit_pending, public_input_result,
    publish_ready, send,
};

use std::collections::BTreeMap;

use anyhow::{Result, ensure};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

use crate::{
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    current_user::CURRENT_USER_ID,
    db::Database,
};
use serde_json::json;

/// Resolve a live private source independently of an explicitly named public destination.
pub(crate) fn run_conversation(
    c: &rusqlite::Connection,
    run: &str,
    epoch: i64,
) -> Result<Option<String>> {
    Ok(c.query_row("SELECT t.conversation_id FROM agent_run r JOIN chat_topic t ON t.conversation_id=r.conversation_id JOIN conversation v ON v.id=t.conversation_id JOIN agent_profile p ON p.id=v.agent_id
        WHERE r.id=?1 AND r.execution_epoch=?2 AND r.invocation_kind='chat' AND r.operation_policy='chat_v1' AND r.status IN ('running','waiting') AND r.execution_lease_owner IS NOT NULL AND r.cancel_requested_at IS NULL
          AND t.owner_user_id=?3 AND t.archived_at IS NULL AND t.deletion_operation_id IS NULL AND p.profile_status='present'",params![run,epoch,CURRENT_USER_ID],|r|r.get(0)).optional()?)
}

pub(crate) fn authorize_destination(
    c: &rusqlite::Connection,
    run: &str,
    epoch: i64,
    agent: &str,
    target: &str,
    write: bool,
) -> Result<bool> {
    Ok(c.query_row("SELECT EXISTS(SELECT 1 FROM chat_topic t JOIN agent_run r ON r.conversation_id=t.conversation_id JOIN conversation v ON v.id=t.conversation_id
        JOIN agent_profile a ON a.id=v.agent_id JOIN camp dest ON dest.id=?4
        WHERE r.id=?1 AND r.execution_epoch=?2 AND v.agent_id=?3 AND a.profile_status='present'
          AND r.invocation_kind='chat' AND r.operation_policy='chat_v1' AND r.status IN ('running','waiting') AND r.execution_lease_owner IS NOT NULL AND r.cancel_requested_at IS NULL
          AND t.owner_user_id=?5 AND t.archived_at IS NULL AND t.deletion_operation_id IS NULL AND dest.deletion_operation_id IS NULL AND dest.archived_at IS NULL
          AND (NOT ?6 OR EXISTS(SELECT 1 FROM camp_member m WHERE m.camp_id=dest.id AND m.agent_id=v.agent_id AND m.version>0 AND m.status='active' AND m.leave_requested_at IS NULL)))",params![run,epoch,agent,target,CURRENT_USER_ID,write],|r|r.get(0))?)
}

/// Keep the authenticated Run as the source; only these operation families expose a public destination.
pub(crate) fn directory_target(
    c: &rusqlite::Connection,
    run: &crate::team_tool::AuthenticatedTeamToolRun,
    target: Option<&str>,
    write: bool,
) -> Result<crate::team_tool::AuthenticatedTeamToolRun> {
    let mut scoped = run.clone();
    if let Some(target) = target {
        ensure!(
            (run.camp_id == target && !run.camp_id.is_empty())
                || (run.camp_id.is_empty()
                    && authorize_destination(
                        c,
                        &run.agent_run_id,
                        run.execution_epoch,
                        &run.agent_id,
                        target,
                        write
                    )?),
            "chat.thread_unavailable"
        );
        scoped.camp_id = target.to_owned();
    } else if write && run.camp_id.is_empty() {
        anyhow::bail!("chat.thread_id_required");
    }
    Ok(scoped)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateThread {
    pub title: String,
    pub member_agent_ids: Vec<String>,
    pub default_lead_agent_id: String,
}
impl sealed::Sealed for CreateThread {}
impl DomainCommand for CreateThread {
    const TYPE: &'static str = "chat.thread_create";
    fn matches_replay(&self, result: &serde_json::Value) -> Result<bool> {
        Ok(result["inputDigest"]
            == crate::command::canonical_json_digest(&serde_json::to_value(self)?)?)
    }
}

pub(crate) fn create_thread(
    db: &mut Database,
    run: &crate::team_tool::AuthenticatedTeamToolRun,
    request_id: String,
    input: CreateThread,
    root: &std::path::Path,
) -> Result<CommandExecution> {
    use crate::collaboration::{
        CreateThreadCommand, ProjectBindingKind, ThreadActivationState, ThreadCollaborationMode,
        create_camp_in_tx,
    };
    ensure!(
        run.camp_id.is_empty()
            && run_conversation(db.connection(), &run.agent_run_id, run.execution_epoch)?.is_some(),
        "chat.private_run_required"
    );
    let e = CommandEnvelope {
        command_id: format!("chat-thread:{}:{request_id}", run.agent_run_id),
        actor: ActorRef::Agent {
            agent_id: run.agent_id.clone(),
            source_agent_run_id: run.agent_run_id.clone(),
        },
        execution_epoch: Some(run.execution_epoch),
        camp_id: None,
        expected_versions: Vec::new(),
        payload: input,
    };
    DomainCommandGateway.execute(db, &e, |tx| {
        ensure!(
            run_conversation(tx, &run.agent_run_id, run.execution_epoch)?.is_some()
                && crate::member_studio::has_direct_user_input(tx, run)?,
            "chat.user_required"
        );
        let command = CreateThreadCommand {
            team: None,
            name: Some(e.payload.title.clone()),
            project_binding_kind: ProjectBindingKind::QuickChat,
            project_path: root.to_string_lossy().into_owned(),
            member_agent_ids: e.payload.member_agent_ids.clone(),
            default_lead_agent_id: e.payload.default_lead_agent_id.clone(),
            collaboration_mode: ThreadCollaborationMode::Peer,
            activation_state: ThreadActivationState::Active,
        };
        let mut result = create_camp_in_tx(
            tx,
            &ActorRef::User {
                user_id: CURRENT_USER_ID.into(),
            },
            None,
            &command,
            &crate::camp_id::ThreadId::new(),
            &[],
        )?;
        result.payload["inputDigest"] = json!(crate::command::canonical_json_digest(
            &serde_json::to_value(&e.payload)?
        )?);
        Ok(result)
    })
}

pub const HISTORY_TOOL: &str = "chat.history";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryInput {
    pub cursor: Option<String>,
    pub limit: Option<usize>,
}

pub(crate) fn history(
    database: &Database,
    run_id: &str,
    epoch: i64,
    input: HistoryInput,
) -> Result<serde_json::Value> {
    use anyhow::Context;
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    let (chat,boundary):(String,i64)=database.connection().query_row(
        "SELECT c.id,m.sequence FROM agent_run r JOIN conversation c ON c.id=r.conversation_id AND c.id=r.destination_conversation_id
         JOIN chat_topic t ON t.conversation_id=c.id JOIN conversation_message m ON m.id=r.trigger_conversation_message_id AND m.conversation_id=c.id AND m.author_type='user'
         WHERE r.id=?1 AND r.execution_epoch=?2 AND r.invocation_kind='chat' AND r.operation_policy='chat_v1' AND r.status='running' AND r.cancel_requested_at IS NULL AND t.archived_at IS NULL AND t.deletion_operation_id IS NULL AND c.kind='chat'",
        params![run_id,epoch],|r|Ok((r.get(0)?,r.get(1)?))).optional()?.context("chat.history_unavailable")?;
    let limit = input.limit.unwrap_or(20);
    ensure!((1..=100).contains(&limit), "chat.invalid_limit");
    let before = if let Some(cursor) = input.cursor {
        ensure!(cursor.len() < 256, "chat.invalid_cursor");
        let (owner, upper, before): (String, i64, i64) =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(cursor)?)?;
        ensure!(
            owner == chat && upper == boundary && (1..=boundary).contains(&before),
            "chat.invalid_cursor"
        );
        Some(before)
    } else {
        None
    };
    let page = crate::single_chat::SingleChatService::history_page(
        database, &chat, boundary, before, limit,
    )?;
    let next_cursor = page
        .next_before_sequence
        .map(|position| URL_SAFE_NO_PAD.encode(json!([chat, boundary, position]).to_string()));
    Ok(json!({"messages":page.messages,"nextCursor":next_cursor}))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListParams {
    pub limit: Option<usize>,
    pub after: Option<ListCursor>,
    pub agent_id: Option<String>,
    #[serde(default)]
    pub pinned_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListCursor {
    pub last_activity_global_sequence: i64,
    pub chat_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyPosition {
    pub chat_id: String,
    pub last_reply_sequence: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListItem {
    pub chat_id: String,
    pub title: String,
    pub agent_id: String,
    pub display_name: String,
    pub avatar_ref: Option<String>,
    pub version: i64,
    pub last_activity_global_sequence: i64,
    pub is_processing: bool,
    pub last_reply_sequence: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatList {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub pinned_items: Vec<ListItem>,
    pub items: Vec<ListItem>,
    pub next_cursor: Option<ListCursor>,
    pub reply_index: Vec<ReplyPosition>,
}

const VISIBLE: &str = "topic.owner_user_id=?1 AND topic.archived_at IS NULL
                       AND topic.deletion_operation_id IS NULL AND c.kind='chat'";

pub fn list(database: &mut Database, input: ListParams) -> Result<ChatList> {
    let tx = database.connection_mut().transaction()?;
    let page = list_in_snapshot(&tx, input)?;
    tx.commit()?;
    Ok(page)
}

fn list_in_snapshot(tx: &Transaction<'_>, input: ListParams) -> Result<ChatList> {
    let limit = input.limit.unwrap_or(50);
    ensure!(
        (1..=100).contains(&limit),
        "Chat page size must be between 1 and 100"
    );
    if let Some(cursor) = &input.after {
        ensure!(
            cursor.last_activity_global_sequence >= 0 && !cursor.chat_id.is_empty(),
            "Invalid chat cursor"
        );
    }

    // Only published final replies move the local unread boundary. The rail needs
    // this projection even when the unread chat is outside the selected page.
    let mut index_query = tx.prepare(&format!(
        "SELECT topic.conversation_id, COALESCE((
             SELECT m.sequence FROM conversation_message m
             JOIN agent_run r ON r.id=m.source_agent_run_id AND r.final_conversation_message_id=m.id
             WHERE m.conversation_id=c.id AND m.author_type='agent' AND r.conversation_id=c.id
             ORDER BY m.sequence DESC LIMIT 1
         ),0)
         FROM chat_topic topic JOIN conversation c ON c.id=topic.conversation_id WHERE {VISIBLE}"
    ))?;
    let positions: BTreeMap<String, i64> = index_query
        .query_map([CURRENT_USER_ID], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;

    ensure!(input.pinned_ids.len() <= 4096, "Too many pinned chats");
    let pinned_ids = serde_json::to_string(&input.pinned_ids)?;
    let mut page_query = tx.prepare(&format!(
        "SELECT c.id, topic.title, c.agent_id, p.display_name, p.avatar_ref, topic.version,
                topic.last_activity_global_sequence,
                EXISTS(SELECT 1 FROM agent_run r WHERE r.conversation_id=c.id
                       AND r.status IN ('queued','running','waiting'))
         FROM chat_topic topic JOIN conversation c ON c.id=topic.conversation_id
         JOIN agent_profile p ON p.id=c.agent_id WHERE {VISIBLE}
           AND (?2 IS NULL OR c.agent_id=?2)
           AND (c.id IN (SELECT value FROM json_each(?6))) = ?7
           AND (?3 IS NULL OR topic.last_activity_global_sequence<?3
                OR (topic.last_activity_global_sequence=?3 AND topic.conversation_id>?4))
         ORDER BY topic.last_activity_global_sequence DESC,topic.conversation_id LIMIT ?5"
    ))?;
    let project = |r: &rusqlite::Row<'_>| {
        let chat_id: String = r.get(0)?;
        Ok(ListItem {
            last_reply_sequence: positions[&chat_id],
            chat_id,
            title: r.get(1)?,
            agent_id: r.get(2)?,
            display_name: r.get(3)?,
            avatar_ref: r.get(4)?,
            version: r.get(5)?,
            last_activity_global_sequence: r.get(6)?,
            is_processing: r.get(7)?,
        })
    };
    let mut items = page_query
        .query_map(
            params![
                CURRENT_USER_ID,
                input.agent_id,
                input
                    .after
                    .as_ref()
                    .map(|c| c.last_activity_global_sequence),
                input.after.as_ref().map(|c| &c.chat_id),
                (limit + 1) as i64,
                pinned_ids,
                false
            ],
            project,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let pinned_items = if input.pinned_ids.is_empty() {
        Vec::new()
    } else {
        page_query
            .query_map(
                params![
                    CURRENT_USER_ID,
                    input.agent_id,
                    None::<i64>,
                    None::<String>,
                    input.pinned_ids.len() as i64,
                    pinned_ids,
                    true
                ],
                project,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let next_cursor = if items.len() > limit {
        items.truncate(limit);
        items.last().map(|row| ListCursor {
            last_activity_global_sequence: row.last_activity_global_sequence,
            chat_id: row.chat_id.clone(),
        })
    } else {
        None
    };
    let reply_index = positions
        .into_iter()
        .map(|(chat_id, last_reply_sequence)| ReplyPosition {
            chat_id,
            last_reply_sequence,
        })
        .collect();
    Ok(ChatList {
        pinned_items,
        items,
        next_cursor,
        reply_index,
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RenameChat {
    pub chat_id: String,
    pub title: String,
    pub expected_version: i64,
}

impl sealed::Sealed for RenameChat {}
impl DomainCommand for RenameChat {
    const TYPE: &'static str = "chat.rename";
}

pub(crate) fn rename(
    database: &mut Database,
    envelope: &CommandEnvelope<RenameChat>,
) -> Result<CommandExecution> {
    DomainCommandGateway.execute(database, envelope, |tx| {
        let ActorRef::User { user_id } = &envelope.actor else {
            return Ok(CommandHandlerResult::rejected(
                "chat.user_required",
                json!({}),
            ));
        };
        let request = &envelope.payload;
        let title = crate::collaboration::normalize_camp_name(&request.title);
        if title.is_empty() || title.chars().count() > crate::collaboration::CAMP_NAME_MAX_SCALARS {
            return Ok(CommandHandlerResult::rejected(
                "chat.invalid_title",
                json!({}),
            ));
        }
        let row = tx
            .query_row(
                "SELECT title, version FROM chat_topic
             WHERE conversation_id = ?1 AND owner_user_id = ?2 AND deletion_operation_id IS NULL",
                params![request.chat_id, user_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        let Some((old_title, mut version)) = row else {
            return Ok(CommandHandlerResult::rejected("chat.not_found", json!({})));
        };
        if version != request.expected_version {
            return Ok(CommandHandlerResult::rejected(
                "chat.version_conflict",
                json!({ "version": version }),
            ));
        }
        let changed = old_title != title;
        if changed {
            version += 1;
            tx.execute(
                "UPDATE chat_topic SET title = ?2, version = ?3 WHERE conversation_id = ?1",
                params![request.chat_id, title, version],
            )?;
        }
        Ok(CommandHandlerResult::applied(
            "chat.renamed",
            json!({ "chatId": request.chat_id, "version": version, "changed": changed }),
            Some(EntityReference {
                entity_type: "chat".into(),
                entity_id: request.chat_id.clone(),
            }),
        ))
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenParams {
    pub chat_id: String,
    pub before_sequence: Option<i64>,
    pub limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHeader {
    pub chat_id: String,
    pub agent_id: String,
    pub display_name: String,
    pub avatar_ref: Option<String>,
    pub title: String,
    pub archived_at: Option<String>,
    pub version: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub version: i64,
    pub created_at: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub cancel_requested_at: Option<String>,
    pub last_error_code: Option<String>,
    pub run_id: String,
    pub trigger_message_id: String,
    pub final_message_id: Option<String>,
    pub status: String,
    pub execution_epoch: i64,
    pub through_change_sequence: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInput {
    pub input_id: String,
    pub body: String,
    pub revision: i64,
    pub converted_from_steer: bool,
    pub state: String,
    pub attachment_names: Vec<String>,
    pub quote_preview: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Supplement {
    pub input_id: String,
    pub run_id: String,
    pub evidence_sequence: i64,
    pub message_id: Option<String>,
    pub body: String,
    pub quotes: Vec<crate::message_quote::MessageQuoteSnapshot>,
    pub attachments: Vec<crate::local_attachment_source::LocalAttachmentSourceView>,
    pub unconfirmed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenChat {
    pub approvals: Vec<crate::read_model::ApprovalView>,
    pub native_interactions: Vec<crate::native_interaction::NativeInteractionView>,
    pub pending_inputs: Vec<PendingInput>,
    pub supplements: Vec<Supplement>,
    pub active_input: Option<crate::steer::ActiveInputAvailability>,
    pub chat: ChatHeader,
    pub messages: Vec<crate::single_chat::SingleChatMessageView>,
    pub runs: Vec<RunSummary>,
    pub next_before_sequence: Option<i64>,
}

pub fn open(database: &mut Database, input: OpenParams) -> Result<Option<OpenChat>> {
    use crate::message_quote::{QuoteStorage, load_quotes};
    use crate::single_chat::{SingleChatMessageView, source_attachment_views};

    let limit = input.limit.unwrap_or(40);
    ensure!((1..=100).contains(&limit), "Invalid chat message page size");
    ensure!(
        input.before_sequence.is_none_or(|v| v > 0),
        "Invalid chat message cursor"
    );
    let tx = database.connection_mut().transaction()?;
    let Some(chat) = tx.query_row(
        "SELECT c.id, c.agent_id, p.display_name, p.avatar_ref, t.title, t.archived_at, t.version
         FROM chat_topic t JOIN conversation c ON c.id=t.conversation_id JOIN agent_profile p ON p.id=c.agent_id
         WHERE t.conversation_id=?1 AND t.owner_user_id=?2 AND c.kind='chat' AND t.deletion_operation_id IS NULL",
        params![input.chat_id,CURRENT_USER_ID],
        |r| Ok(ChatHeader {chat_id:r.get(0)?,agent_id:r.get(1)?,display_name:r.get(2)?,
            avatar_ref:r.get(3)?,title:r.get(4)?,archived_at:r.get(5)?,version:r.get(6)?}),
    ).optional()? else { return Ok(None) };
    let mut messages = Vec::with_capacity(limit);
    let has_more = {
        let mut stmt = tx.prepare(
            "SELECT id,sequence,author_type,author_id,body,source_attachments_json,agent_run_id,created_at
             FROM conversation_message WHERE conversation_id=?1 AND (?2 IS NULL OR sequence<?2)
             ORDER BY sequence DESC LIMIT ?3",
        )?;
        let mut rows = stmt.query(params![
            chat.chat_id,
            input.before_sequence,
            (limit + 1) as i64
        ])?;
        while messages.len() < limit {
            let Some(r) = rows.next()? else { break };
            let id: String = r.get(0)?;
            messages.push(SingleChatMessageView {
                quotes: load_quotes(&tx, QuoteStorage::PrivateMessage, &id)?,
                id,
                sequence: r.get(1)?,
                author_type: r.get(2)?,
                author_id: r.get(3)?,
                body: r.get(4)?,
                attachments: source_attachment_views(&r.get::<_, String>(5)?)?,
                agent_run_id: r.get(6)?,
                created_at: r.get(7)?,
            });
        }
        rows.next()?.is_some()
    };
    messages.reverse();
    let next_before_sequence = messages
        .first()
        .and_then(|m| has_more.then_some(m.sequence));
    let ids = serde_json::to_string(&messages.iter().map(|m| &m.id).collect::<Vec<_>>())?;
    let message_runs = serde_json::to_string(
        &messages
            .iter()
            .filter_map(|m| m.agent_run_id.as_ref())
            .collect::<Vec<_>>(),
    )?;
    let runs = {
        let mut stmt=tx.prepare(
            "SELECT id,trigger_conversation_message_id,final_conversation_message_id,status,
                    execution_epoch,execution_evidence_change_sequence,version,created_at,started_at,ended_at,cancel_requested_at,last_error_code FROM agent_run
             WHERE conversation_id=?1 AND (trigger_conversation_message_id IN (SELECT value FROM json_each(?2))
               OR final_conversation_message_id IN (SELECT value FROM json_each(?2))
               OR id IN (SELECT value FROM json_each(?3))
               OR status IN ('queued','running','waiting')) ORDER BY created_at,id",
        )?;
        stmt.query_map(params![chat.chat_id, ids, message_runs], |r| {
            Ok(RunSummary {
                run_id: r.get(0)?,
                trigger_message_id: r.get(1)?,
                final_message_id: r.get(2)?,
                status: r.get(3)?,
                execution_epoch: r.get(4)?,
                through_change_sequence: r.get(5)?,
                version: r.get(6)?,
                created_at: r.get(7)?,
                started_at: r.get(8)?,
                ended_at: r.get(9)?,
                cancel_requested_at: r.get(10)?,
                last_error_code: r.get(11)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let pending_inputs = {
        let mut stmt = tx.prepare("SELECT id,body,revision,target_run_id IS NOT NULL,(SELECT json_group_array(json_extract(value,'$.displayName')) FROM json_each(source_attachments_json)),json_extract(quotes_json,'$[0].text'),state FROM single_chat_pending_input
            WHERE conversation_id=?1 AND requested_mode='start' AND state IN ('queued','needs_repair') ORDER BY enqueue_sequence")?;
        stmt.query_map([&chat.chat_id], |row| {
            Ok(PendingInput {
                input_id: row.get(0)?,
                body: row.get(1)?,
                revision: row.get(2)?,
                converted_from_steer: row.get(3)?,
                attachment_names: serde_json::from_str(&row.get::<_, String>(4)?)
                    .unwrap_or_default(),
                quote_preview: row.get(5)?,
                state: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let page_run_ids = serde_json::to_string(
        &runs
            .iter()
            .map(|r: &RunSummary| &r.run_id)
            .collect::<Vec<_>>(),
    )?;
    let supplements = {
        let mut query=tx.prepare("SELECT p.id,p.target_run_id,e.sequence,p.published_conversation_message_id,p.body,p.quotes_json,p.source_attachments_json,COALESCE(i.status='delivery_unknown',0)
            FROM single_chat_pending_input p JOIN agent_run_execution_evidence e ON e.id='steer-input:'||p.id AND e.agent_run_id=p.target_run_id
            LEFT JOIN context_manifest m ON m.source_chat_input_id=p.id LEFT JOIN runtime_input_delivery i ON i.context_manifest_id=m.id AND i.execution_epoch=p.target_execution_epoch
            WHERE p.conversation_id=?1 AND p.target_run_id IN (SELECT value FROM json_each(?2)) AND p.requested_mode='steer' AND p.state IN ('queued','published') ORDER BY e.sequence")?;
        let mut rows = query.query(params![chat.chat_id, page_run_ids])?;
        let mut items = Vec::new();
        while let Some(r) = rows.next()? {
            items.push(Supplement {
                input_id: r.get(0)?,
                run_id: r.get(1)?,
                evidence_sequence: r.get(2)?,
                message_id: r.get(3)?,
                body: r.get(4)?,
                quotes: crate::message_quote::parse_quotes(&r.get::<_, String>(5)?)?,
                attachments: source_attachment_views(&r.get::<_, String>(6)?)?,
                unconfirmed: r.get(7)?,
            });
        }
        items
    };
    let active_input = runs
        .iter()
        .find(|r| matches!(r.status.as_str(), "queued" | "running" | "waiting"))
        .map(|r| crate::steer::active_input_availability(&tx, &r.run_id, r.execution_epoch))
        .transpose()?;
    let approvals =
        crate::read_model::load_conversation_approvals(&tx, None, Some(&chat.chat_id), true, None)?;
    tx.commit()?;
    Ok(Some(OpenChat {
        approvals,
        native_interactions: Vec::new(),
        supplements,
        active_input,
        pending_inputs,
        chat,
        messages,
        runs,
        next_before_sequence,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use serde_json::json;

    #[test]
    fn reply_index_covers_unfiltered_chats_outside_the_page() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("
            CREATE TABLE chat_topic(conversation_id TEXT PRIMARY KEY,owner_user_id,title,version,archived_at,deletion_operation_id,last_activity_global_sequence INTEGER);
            CREATE TABLE conversation(id TEXT PRIMARY KEY,agent_id,kind);
            CREATE TABLE agent_profile(id TEXT PRIMARY KEY,display_name,avatar_ref);
            CREATE TABLE conversation_message(id TEXT PRIMARY KEY,conversation_id,sequence INTEGER,author_type,source_agent_run_id);
            CREATE TABLE agent_run(id TEXT PRIMARY KEY,conversation_id,final_conversation_message_id,status);
            INSERT INTO agent_profile VALUES ('a','A',NULL),('b','B',NULL);
            INSERT INTO conversation VALUES ('new','a','chat'),('old','b','chat'),('archived','a','chat'),('deleting','b','chat'),('foreign','a','chat');
            INSERT INTO chat_topic VALUES
              ('new','local_user','New',1,NULL,NULL,8),('old','local_user','Old',1,NULL,NULL,5),
              ('archived','local_user','Archived',1,'now',NULL,10),('deleting','local_user','Deleting',1,NULL,'operation',12),
              ('foreign','other','Foreign',1,NULL,NULL,15);
            INSERT INTO conversation_message VALUES ('question','new',10,'user',NULL),('reply','old',3,'agent','run'),
              ('more','old',4,'user',NULL),('unpublished','old',5,'agent','running');
            INSERT INTO agent_run VALUES ('run','old','reply','succeeded'),('running','old',NULL,'running');
        ").unwrap();
        let tx = db.transaction().unwrap();
        let read = |params| {
            serde_json::to_value(
                list_in_snapshot(&tx, serde_json::from_value(params).unwrap()).unwrap(),
            )
            .unwrap()
        };
        let first = read(json!({"limit":1}));
        let expected =
            json!([{"chatId":"new","lastReplySequence":0},{"chatId":"old","lastReplySequence":3}]);
        assert_eq!(first["items"][0]["chatId"], "new");
        assert_eq!(first["items"][0]["isProcessing"], false);
        let pinned = read(json!({"limit":1,"pinnedIds":["old"]}));
        assert_eq!(pinned["pinnedItems"][0]["chatId"], "old");
        assert_eq!(pinned["items"][0]["chatId"], "new");
        assert_eq!(pinned["replyIndex"], expected);
        assert_eq!(first["replyIndex"], expected);
        let second = read(json!({"limit":1,"after":first["nextCursor"]}));
        assert_eq!(second["items"][0]["chatId"], "old");
        assert_eq!(second["items"][0]["isProcessing"], true);
        assert_eq!(second["items"][0]["lastReplySequence"], 3);
        assert!(second["nextCursor"].is_null());
        assert_eq!(second["replyIndex"], expected);
        let filtered = read(json!({"agentId":"a"}));
        assert_eq!(filtered["items"].as_array().unwrap().len(), 1);
        assert_eq!(filtered["replyIndex"], expected);
        tx.execute(
            "UPDATE chat_topic SET archived_at='now' WHERE conversation_id='old'",
            [],
        )
        .unwrap();
        assert_eq!(
            read(json!({}))["replyIndex"],
            json!([{"chatId":"new","lastReplySequence":0}])
        );
    }
}
