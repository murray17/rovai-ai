use super::*;
use crate::{
    delivery_queue,
    project_file_reference::Preflight,
    runtime::{recompute_camp_turn, settle_abortive_agent_run_in_tx},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditThreadMessageCommand {
    #[serde(
        rename = "threadId",
        alias = "campId",
        deserialize_with = "crate::camp_id::deserialize_camp_id_string"
    )]
    pub camp_id: String,
    pub message_id: String,
    pub expected_content_revision: i64,
    pub content: ComposerDocument,
    pub retain_attachment_ids: Vec<String>,
    #[serde(default)]
    pub source_attachments: Vec<LocalAttachmentSourceRef>,
}

impl sealed::Sealed for EditThreadMessageCommand {}
impl DomainCommand for EditThreadMessageCommand {
    const TYPE: &'static str = "camp_message.edit";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteThreadMessageCommand {
    #[serde(
        rename = "threadId",
        alias = "campId",
        deserialize_with = "crate::camp_id::deserialize_camp_id_string"
    )]
    pub camp_id: String,
    pub message_id: String,
}

impl sealed::Sealed for DeleteThreadMessageCommand {}
impl DomainCommand for DeleteThreadMessageCommand {
    const TYPE: &'static str = "camp_message.delete";
}

pub(crate) struct MessageCapabilities {
    pub can_withdraw: bool,
    pub can_edit: bool,
    pub can_delete: bool,
    pub revision: i64,
    pub bound: bool,
    pub reply_parent_deleted: bool,
    deleted: bool,
}

/// The earliest ordinary claim or steer binding permanently closes recall.
pub(crate) fn capabilities(tx: &Connection, message_id: &str) -> Result<MessageCapabilities> {
    let (own, agent, recall, bound, revision, deleted, recognized, in_flight, parent_deleted, thread_deleted) = tx.query_row(
        "SELECT m.author_type='user' AND m.author_id=?2 AND m.origin_kind='local_composer',
            m.author_type='agent', m.recall_state, m.ever_bound_as_steer, m.content_revision, m.tombstoned_at IS NOT NULL,
            EXISTS(SELECT 1 FROM agent_run_input i WHERE i.message_id=m.id)
                OR EXISTS(SELECT 1 FROM camp_message_delivery d WHERE d.message_id=m.id AND (d.claimed_at IS NOT NULL OR d.claimed_agent_run_id IS NOT NULL)),
            EXISTS(SELECT 1 FROM camp_message_delivery d
                WHERE d.message_id=m.id AND d.requested_mode='steer' AND d.status='claimed'
                  AND NOT EXISTS(SELECT 1 FROM context_manifest cm JOIN runtime_input_delivery i ON i.context_manifest_id=cm.id
                    WHERE cm.source_delivery_id=d.id AND i.agent_run_id=d.claimed_agent_run_id
                      AND i.execution_epoch=d.target_execution_epoch AND i.status IN ('accepted','not_accepted','delivery_unknown'))),
            EXISTS(SELECT 1 FROM camp_message p WHERE p.id=m.reply_to_camp_message_id AND p.camp_id=m.camp_id AND p.tombstoned_at IS NOT NULL),
            EXISTS(SELECT 1 FROM camp c WHERE c.id=m.camp_id AND c.deletion_operation_id IS NOT NULL)
        FROM camp_message m WHERE m.id=?1",
        params![message_id, crate::current_user::CURRENT_USER_ID],
        |r| Ok((r.get::<_,bool>(0)?,r.get::<_,bool>(1)?,r.get::<_,String>(2)?,r.get::<_,bool>(3)?,
            r.get::<_,i64>(4)?,r.get::<_,bool>(5)?,r.get::<_,bool>(6)?,r.get::<_,bool>(7)?,r.get::<_,bool>(8)?,r.get::<_,bool>(9)?))
    )?;
    let live = !deleted && !thread_deleted && recall != "withdrawn";
    Ok(MessageCapabilities {
        can_withdraw: live && own && recall == "recallable" && !bound && !recognized,
        can_edit: live && own && !bound,
        can_delete: live && (own || agent) && !in_flight,
        revision,
        bound,
        reply_parent_deleted: parent_deleted,
        deleted,
    })
}

fn authorization<C>(envelope: &CommandEnvelope<C>, thread: &str) -> bool {
    matches!(&envelope.actor, ActorRef::User {user_id} if user_id == crate::current_user::CURRENT_USER_ID)
        && envelope.camp_id.as_deref() == Some(thread)
}

impl CollaborationService {
    pub fn edit_camp_message(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<EditThreadMessageCommand>,
        files: Option<&Preflight>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |tx| {
            let command = &envelope.payload;
            let thread = &command.camp_id;
            let id = &command.message_id;
            if !authorization(envelope, thread) {
                return Ok(rejected("message.edit_forbidden", "The message cannot be edited"));
            }
            let Some((stored_content, stored_sources, quotes)) = tx.query_row(
                "SELECT structured_content_json,source_attachments_json,quotes_json FROM camp_message WHERE id=?1 AND camp_id=?2",
                params![id,thread], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)),
            ).optional()? else { return Ok(rejected("message.not_found", "Thread message does not exist")); };
            let facts = capabilities(tx, id)?;
            if !facts.can_edit {
                return Ok(rejected("message.edit_forbidden", "The message cannot be edited"));
            }
            if command.expected_content_revision != facts.revision {
                return Ok(CommandHandlerResult::rejected("message.edit_conflict", json!({"currentContentRevision":facts.revision})));
            }
            let content = match files {
                Some(files) => match files.publish(tx, thread, &command.content)? {
                    Ok(content) => content,
                    Err(rejection) => return Ok(rejection),
                },
                None => composer_document_to_content(&command.content)?,
            };
            validate_user_authored_content(&content)?;
            let current_sources = parse_source_attachments(&stored_sources)?;
            let stored_ids = attachment_ids(tx, id)?;
            let known_ids: HashSet<&str> = current_sources.iter().map(|source| source.id.as_str())
                .chain(stored_ids.iter().map(String::as_str)).collect();
            let mut attachment_ids = HashSet::new();
            if !command.retain_attachment_ids.iter().all(|id| known_ids.contains(id.as_str()) && attachment_ids.insert(id.as_str()))
                || !command.source_attachments.iter().all(|source| !known_ids.contains(source.id.as_str()) && attachment_ids.insert(source.id.as_str()))
            {
                return Ok(rejected("message.attachment_selection_invalid","The attachment selection has changed. Open the editor again."));
            }
            let retained = &command.retain_attachment_ids;
            let sources = retained.iter().filter_map(|id| current_sources.iter().find(|source| &source.id == id).cloned())
                .chain(command.source_attachments.iter().cloned()).collect::<Vec<_>>();
            let retained_stored = retained.iter().filter(|id| stored_ids.contains(id)).cloned().collect::<Vec<_>>();
            let same_content = crate::camp_content::composer_document_from_content(&content)?
                == crate::camp_content::composer_document_from_content(&serde_json::from_str::<StructuredThreadMessageContent>(&stored_content)?)?;
            if same_content && sources == current_sources && retained_stored.len() == stored_ids.len() {
                return message_result(tx, id, "unchanged");
            }
            if let Err(error) = validate_source_attachments(&command.source_attachments) {
                return Ok(rejected(error.code().as_str(), "An added attachment is unavailable"));
            }
            let submission = match load_structured_content_submission(
                tx, thread, content, sources, None, false, retained_stored.clone(),
            )? {
                Ok(submission) => submission,
                Err(rejection) => return Ok(rejection),
            };
            if quotes != "[]" && submission.body.trim().is_empty() {
                return Ok(rejected("quote.question_required","Add a question to the message with a quote"));
            }
            let resolution = match resolve_address(tx, thread, &submission.address, &envelope.actor)? {
                AddressingOutcome::Resolved(resolution) => resolution,
                AddressingOutcome::Rejected(rejection) => return Ok(rejection),
            };
            let targets = resolution.targets.into_iter().map(|target| target.agent_id).collect::<Vec<_>>();
            let now = chrono::Utc::now().to_rfc3339();
            let addressed = serde_json::to_string(&targets)?;
            freeze_claimed_inputs(tx,id)?;
            tx.execute("UPDATE camp_message
                SET body=?2,structured_content_json=?3,content_digest=?4,source_attachments_json=?5,
                    address_mode=?6,addressed_agent_ids_json=?7,recipient_presentation_json='{}',
                    content_revision=content_revision+1,version=version+1,updated_at=?8
                WHERE id=?1", params![id,submission.body,serde_json::to_string(&submission.structured_content)?,
                    canonical_content_digest(&submission.structured_content)?,serialize_source_attachments(&submission.source_attachments)?,
                    submission.address.mode(),addressed,now])?;
            replace_attachment_links(tx, id, &retained_stored)?;
            clear_reference_index(tx, id)?;
            index_camp_message(tx, id, thread, &submission.body, &addressed)?;
            reschedule(tx, thread, id, Some(&targets), &envelope.actor, &now)?;
            finish_mutation(tx, thread, id, "edited", &envelope.actor, &now)?;
            message_result(tx, id, "updated")
        })
    }

    pub fn delete_camp_message(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<DeleteThreadMessageCommand>,
    ) -> Result<CommandExecution> {
        self.gateway.execute(database, envelope, |tx| {
            let command = &envelope.payload;
            let id = &command.message_id;
            let thread = &command.camp_id;
            if !authorization(envelope, thread) {
                return Ok(rejected("message.delete_forbidden", "The message cannot be deleted"));
            }
            let Some(publication) = tx.query_row(
                "SELECT source_operation_id FROM camp_message WHERE id=?1 AND camp_id=?2",
                params![id,thread], |r| r.get::<_,Option<String>>(0),
            ).optional()? else { return Ok(rejected("message.not_found", "Thread message does not exist")); };
            let facts = capabilities(tx,id)?;
            if facts.deleted {
                return message_result(tx,id,"deleted");
            }
            if !facts.can_delete {
                return Ok(rejected("message.delete_unavailable","The message cannot currently be deleted"));
            }
            let now = chrono::Utc::now().to_rfc3339();
            freeze_claimed_inputs(tx,id)?;
            tx.execute("UPDATE camp_message SET body='',structured_content_json='[]',quotes_json='[]',
                source_attachments_json='[]',recipient_presentation_json='{}',content_digest='erased',
                tombstoned_at=?2,updated_at=?2,version=version+1 WHERE id=?1", params![id,now])?;
            replace_attachment_links(tx,id,&[])?;
            clear_reference_index(tx,id)?;
            if let Some(publication) = publication {
                crate::command::erase_deleted_message_receipt(tx,&publication,thread,id)?;
            }
            let deliveries = tx.prepare("SELECT id FROM camp_message_delivery WHERE message_id=?1")?
                .query_map([id], |row| row.get::<_,String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for delivery in deliveries {
                crate::execution_input::changed(tx, &delivery)?;
            }
            reschedule(tx,thread,id,None,&envelope.actor,&now)?;
            finish_mutation(tx,thread,id,"deleted",&envelope.actor,&now)?;
            message_result(tx,id,"deleted")
        })
    }
}

/// Capture the outgoing version once, before its message or attachment links change.
fn freeze_claimed_inputs(tx: &Transaction<'_>, id: &str) -> Result<()> {
    tx.execute(
        "UPDATE agent_run_input SET input_snapshot_json = (
          SELECT json_object('body',m.body,'content',json(m.structured_content_json),
            'sourceAttachments',json(m.source_attachments_json),'quotes',json(m.quotes_json),
            'addressedAgentIds',json(m.addressed_agent_ids_json),'replyToThreadMessageId',m.reply_to_camp_message_id,
            'attachments',json((SELECT json_group_array(json_object('id',id,'displayName',name)) FROM (
                SELECT id,display_name AS name FROM message_attachment WHERE camp_message_id=m.id ORDER BY position
            ))),'managedAttachments',json((SELECT json_group_array(json_object('id',id,'displayName',name)) FROM (
                SELECT attachment_id AS id,display_name_snapshot AS name FROM camp_message_attachment_ref
                WHERE camp_message_id=m.id ORDER BY ordinal
            )))) FROM camp_message m WHERE m.id=?1)
         WHERE message_id=?1 AND input_snapshot_json IS NULL
           AND (message_content_revision,message_content_digest) = (
             SELECT content_revision,content_digest FROM camp_message WHERE id=?1 AND recall_state<>'withdrawn'
           )",
        [id],
    )?;
    Ok(())
}

fn message_result(tx: &Connection, id: &str, outcome: &str) -> Result<CommandHandlerResult> {
    let (revision, version): (i64, i64) = tx.query_row(
        "SELECT content_revision,version FROM camp_message WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(CommandHandlerResult::applied(
        format!("message.{outcome}"),
        json!({
            "messageId":id,"version":version,"contentRevision":revision,"outcome":outcome,
        }),
        Some(EntityReference {
            entity_type: "camp_message".into(),
            entity_id: id.into(),
        }),
    ))
}

fn attachment_ids(tx: &Connection, id: &str) -> Result<Vec<String>> {
    let mut statement = tx.prepare(
        "SELECT id FROM message_attachment WHERE camp_message_id=?1
        UNION ALL SELECT attachment_id FROM camp_message_attachment_ref WHERE camp_message_id=?1",
    )?;
    Ok(statement
        .query_map([id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?)
}

fn replace_attachment_links(tx: &Connection, id: &str, retained: &[String]) -> Result<()> {
    let ids = serde_json::to_string(retained)?;
    tx.execute("DELETE FROM camp_message_attachment_ref WHERE camp_message_id=?1 AND attachment_id NOT IN (SELECT value FROM json_each(?2))",params![id,ids])?;
    tx.execute("DELETE FROM message_attachment WHERE camp_message_id=?1 AND id NOT IN (SELECT value FROM json_each(?2))",params![id,ids])?;
    Ok(())
}

fn clear_reference_index(tx: &Connection, id: &str) -> Result<()> {
    tx.execute(
        "DELETE FROM camp_message_reference WHERE camp_message_id=?1",
        [id],
    )?;
    tx.execute(
        "DELETE FROM camp_message_mention WHERE camp_message_id=?1",
        [id],
    )?;
    Ok(())
}

fn finish_mutation(
    tx: &Transaction<'_>,
    thread: &str,
    id: &str,
    event: &str,
    actor: &ActorRef,
    now: &str,
) -> Result<()> {
    tx.execute(
        "UPDATE camp SET version=version+1,updated_at=?2 WHERE id=?1",
        params![thread, now],
    )?;
    append_domain_event(
        tx,
        &format!("camp_message.{event}"),
        Some(thread),
        Some(("camp_message", id)),
        actor,
        None,
        &json!({"messageId":id}),
    )?;
    let unavailable = if event == "deleted" {
        vec![id.to_owned()]
    } else {
        Vec::new()
    };
    crate::message_changes::record(tx, thread, true, &unavailable);
    Ok(())
}

fn reschedule(
    tx: &Transaction<'_>,
    thread: &str,
    message: &str,
    targets: Option<&[String]>,
    actor: &ActorRef,
    now: &str,
) -> Result<()> {
    let reason = if targets.is_some() {
        "message_input_edited"
    } else {
        "message_input_deleted"
    };
    let targets = targets.unwrap_or_default();
    let targets_json = serde_json::to_string(targets)?;
    tx.execute("UPDATE camp_message_delivery SET status='cancelled',failure_code=?3,ended_at=?4,updated_at=?4,version=version+1
        WHERE message_id=?1 AND status='waiting' AND recipient_agent_id NOT IN (SELECT value FROM json_each(?2))",
        params![message,targets_json,reason,now])?;
    tx.execute("UPDATE camp_message_delivery SET message_content_revision=(SELECT content_revision FROM camp_message WHERE id=?1),
        updated_at=?2,version=version+1 WHERE message_id=?1 AND status='waiting'",params![message,now])?;

    let mut statement = tx.prepare("SELECT r.id,c.agent_id
        FROM agent_run_input i JOIN agent_run r ON r.id=i.agent_run_id JOIN conversation c ON c.id=r.conversation_id
        WHERE i.message_id=?1 AND r.camp_id=?2 AND r.status IN ('queued','running','waiting')
        ORDER BY r.created_at,r.id")?;
    let runs = statement
        .query_map(params![message, thread], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    for (run_id, recipient) in runs {
        let settlement = settle_abortive_agent_run_in_tx(tx, &run_id, reason, actor, now)?;
        if !settlement.camp_turn_id.is_empty() {
            recompute_camp_turn(
                tx,
                thread,
                &settlement.camp_turn_id,
                actor,
                Some(settlement.execution_epoch),
                now,
            )?;
        }
        if active_address_target(tx, thread, &recipient)?.is_none() {
            continue;
        }
        let inputs = {
            let mut statement = tx.prepare(
                "SELECT m.id FROM agent_run_input i JOIN camp_message m ON m.id=i.message_id
                WHERE i.agent_run_id=?1 AND m.tombstoned_at IS NULL AND m.recall_state<>'withdrawn'
                AND (m.id<>?2 OR ?3) ORDER BY i.ordinal",
            )?;
            statement
                .query_map(
                    params![run_id, message, targets.contains(&recipient)],
                    |r| r.get::<_, String>(0),
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        for input in inputs {
            delivery_queue::enqueue_message_if_absent(tx, thread, &input, &recipient, now)?;
        }
    }
    for target in targets {
        delivery_queue::enqueue_message_if_absent(tx, thread, message, target, now)?;
    }
    Ok(())
}
