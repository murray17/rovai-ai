//! Copy published public history into an ordinary Thread. Execution state is never copied.
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use anyhow::Result;
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{
    camp_content::{StructuredThreadMessageContent, member_mention_ids},
    camp_id::ThreadId,
    collaboration::append_domain_event,
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    db::Database,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkThreadCommand {
    #[serde(deserialize_with = "crate::camp_id::deserialize_camp_id_string")]
    pub source_thread_id: String,
    pub source_message_id: Option<String>,
}

impl sealed::Sealed for ForkThreadCommand {}
impl DomainCommand for ForkThreadCommand {
    const TYPE: &'static str = "camp.fork";
}

pub fn fork_thread(
    database: &mut Database,
    envelope: &CommandEnvelope<ForkThreadCommand>,
    data_dir: &Path,
) -> Result<CommandExecution> {
    // The receipt must survive deletion of either Thread. Gateway checks replay
    // identity before any source, workspace or attachment lookup in the handler.
    anyhow::ensure!(
        envelope.camp_id.is_none(),
        "Thread fork requires application scope"
    );
    let runtime_root = database.runtime_camp_files_root().to_path_buf();
    DomainCommandGateway.execute(database, envelope, |tx| {
        fork_in_tx(tx, envelope, data_dir, &runtime_root)
    })
}

fn reject(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({"message": message}))
}

struct Message {
    id: String,
    sequence: i64,
    author_type: String,
    author_id: String,
    body: String,
    content: String,
    digest: String,
    address_mode: String,
    recipients: String,
    reply: Option<String>,
    presentation: Option<String>,
    recipient_presentation: String,
    quotes: String,
    recall: String,
    created_at: String,
    updated_at: String,
    sources: Vec<crate::local_attachment_source::LocalAttachmentSourceRef>,
}

fn fork_in_tx(
    tx: &Transaction<'_>,
    envelope: &CommandEnvelope<ForkThreadCommand>,
    data_dir: &Path,
    runtime_root: &Path,
) -> Result<CommandHandlerResult> {
    if !matches!(&envelope.actor, ActorRef::User { user_id } if user_id == crate::current_user::CURRENT_USER_ID)
    {
        return Ok(reject(
            "camp.fork_user_required",
            "Only the Owner can fork a Thread",
        ));
    }
    let source_id = &envelope.payload.source_thread_id;
    let source = tx
        .query_row(
            "SELECT title, project_binding_kind, project_path, default_lead_agent_id,
            activation_state, deletion_operation_id,
            EXISTS(SELECT 1 FROM mission WHERE camp_id=camp.id)
         FROM camp WHERE id=?1",
            [source_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, bool>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((title, binding, path, lead, activation, deleting, mission)) = source else {
        return Ok(reject(
            "camp.fork_source_unavailable",
            "Source Thread is unavailable",
        ));
    };
    if deleting.is_some() || activation != "active" || mission {
        return Ok(reject(
            "camp.fork_source_unavailable",
            "Only an active public Thread can be forked",
        ));
    }
    // Reuse workspace admission, but only after receipt lookup and inside the
    // snapshot transaction. A fork neither creates directories nor changes binding.
    match crate::git::select_workspace(Path::new(&path), data_dir, binding == "quick_chat") {
        Ok(selection) if selection.project_path == path => {}
        _ => {
            return Ok(reject(
                "camp.fork_workspace_unavailable",
                "Source workspace is unavailable",
            ));
        }
    }
    let cutoff = if let Some(anchor) = &envelope.payload.source_message_id {
        let sequence = tx.query_row(
            "SELECT sequence FROM camp_message m WHERE id=?1 AND camp_id=?2
             AND author_type='agent' AND tombstoned_at IS NULL AND recall_state<>'withdrawn'
             AND EXISTS(SELECT 1 FROM event_log e WHERE e.entity_type='camp_message'
                AND e.entity_id=m.id AND e.event_type IN ('camp_message.sent','camp_message.public_a2a_sent')
                AND e.global_sequence IS NOT NULL)",
            params![anchor, source_id], |r| r.get::<_,i64>(0),
        ).optional()?;
        let Some(sequence) = sequence else {
            return Ok(reject(
                "camp.fork_anchor_unavailable",
                "这条消息已不可用，无法从这里分叉",
            ));
        };
        Some(sequence)
    } else {
        None
    };

    // EXISTS deduplicates the two publication facts without frontend pagination.
    let mut messages = tx.prepare(
        "SELECT id, sequence, author_type, author_id, body, structured_content_json,
            content_digest, address_mode, addressed_agent_ids_json, reply_to_camp_message_id,
            presentation_json, recipient_presentation_json, quotes_json, recall_state, created_at, updated_at
         FROM camp_message m WHERE camp_id=?1 AND tombstoned_at IS NULL
            AND author_type IN ('user','agent','external_principal') AND (?2 IS NULL OR sequence<=?2)
            AND EXISTS(SELECT 1 FROM event_log e WHERE e.entity_type='camp_message'
                AND e.entity_id=m.id AND e.event_type IN ('camp_message.sent','camp_message.public_a2a_sent')
                AND e.global_sequence IS NOT NULL)
         ORDER BY sequence, id",
    )?.query_map(params![source_id, cutoff], |r| Ok(Message {
        id:r.get(0)?, sequence:r.get(1)?, author_type:r.get(2)?, author_id:r.get(3)?,
        body:r.get(4)?, content:r.get(5)?, digest:r.get(6)?, address_mode:r.get(7)?,
        recipients:r.get(8)?, reply:r.get(9)?, presentation:r.get(10)?,
        recipient_presentation:r.get(11)?, quotes:r.get(12)?, recall:r.get(13)?,
        created_at:r.get(14)?, updated_at:r.get(15)?, sources:Vec::new(),
    }))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let members = tx
        .prepare(
            "SELECT m.agent_id, m.capability_overrides_json FROM camp_member m
         JOIN agent_profile p ON p.id=m.agent_id WHERE m.camp_id=?1
         AND m.status='active' AND m.leave_requested_at IS NULL
         AND p.profile_status IN ('present','away') ORDER BY m.joined_at, m.agent_id",
        )?
        .query_map([source_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<BTreeMap<_, _>>>()?;
    if lead.as_ref().is_some_and(|id| !members.contains_key(id)) {
        return Ok(reject(
            "camp.invalid_default_lead",
            "Default Lead must belong to the current member set",
        ));
    }
    let mut historical_members = BTreeSet::new();
    for message in &messages {
        if message.author_type == "agent" {
            historical_members.insert(message.author_id.clone());
        }
        historical_members.extend(serde_json::from_str::<Vec<String>>(&message.recipients)?);
        historical_members.extend(member_mention_ids(&serde_json::from_str::<
            StructuredThreadMessageContent,
        >(&message.content)?));
        for quote in serde_json::from_str::<Vec<crate::message_quote::MessageQuoteSnapshot>>(
            &message.quotes,
        )? {
            if let Some(crate::message_quote::MessageQuoteAuthor::Agent { agent_id, .. }) =
                quote.author_at_capture
            {
                historical_members.insert(agent_id);
            }
        }
    }
    for message in &mut messages {
        message.sources = crate::local_attachment_source::message_sources_for_fork(
            tx,
            source_id,
            &message.id,
            runtime_root,
        )?;
    }
    let target_id = ThreadId::new();
    let now = chrono::Utc::now().to_rfc3339();
    let suffix = " 副本";
    let title = format!(
        "{}{suffix}",
        title
            .chars()
            .take(80 - suffix.chars().count())
            .collect::<String>()
    );
    tx.execute(
        "INSERT INTO camp(id,title,name_origin,collaboration_mode,project_binding_kind,project_path,
            default_lead_agent_id,activation_state,last_message_sequence,version,created_at,updated_at)
         VALUES(?1,?2,'user','peer',?3,?4,?5,'active',?6,1,?7,?7)",
        params![target_id,title,binding,path,lead,messages.last().map_or(0,|m| m.sequence),now],
    )?;
    for (id, capabilities) in &members {
        tx.execute("INSERT INTO camp_member(camp_id,agent_id,status,capability_overrides_json,version,joined_at)
            VALUES(?1,?2,'active',?3,1,?4)", params![target_id,id,capabilities,now])?;
    }
    for id in historical_members
        .iter()
        .filter(|id| !members.contains_key(*id))
    {
        tx.execute("INSERT INTO camp_member(camp_id,agent_id,status,capability_overrides_json,version,joined_at,left_at)
            SELECT ?1,id,'left','{}',1,?3,?3 FROM agent_profile WHERE id=?2", params![target_id,id,now])?;
    }
    append_domain_event(
        tx,
        "camp.created",
        Some(target_id.as_str()),
        Some(("camp", target_id.as_str())),
        &envelope.actor,
        None,
        &json!({"title":title,"activationState":"active"}),
    )?;
    let ids: BTreeMap<_, _> = messages
        .iter()
        .map(|m| (m.id.clone(), Uuid::new_v4().to_string()))
        .collect();
    // INSERT triggers can create notifications. Insert inert display content for
    // every message first, then restore the whitelist and internal reply edges.
    for message in &messages {
        tx.execute(
            "INSERT INTO camp_message(id,camp_id,sequence,author_type,author_id,body,
                structured_content_json,content_digest,address_mode,addressed_agent_ids_json,
                origin_kind,recall_state,version,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,'[]',?7,?8,?9,'system',?10,1,?11,?12)",
            params![
                ids[&message.id],
                target_id,
                message.sequence,
                message.author_type,
                message.author_id,
                message.body,
                message.digest,
                message.address_mode,
                message.recipients,
                if message.recall == "withdrawn" {
                    "withdrawn"
                } else {
                    "ineligible"
                },
                message.created_at,
                message.updated_at
            ],
        )?;
    }
    for message in &messages {
        let id = &ids[&message.id];
        tx.execute(
            "UPDATE camp_message SET structured_content_json=?2,reply_to_camp_message_id=?3,
                presentation_json=?4,recipient_presentation_json=?5,quotes_json=?6,source_attachments_json=?7
             WHERE id=?1",
            params![id,message.content,message.reply.as_ref().and_then(|old| ids.get(old)),message.presentation,
                message.recipient_presentation,message.quotes,crate::local_attachment_source::serialize_source_attachments(&message.sources)?],
        )?;
        crate::context_index::index_camp_message(
            tx,
            id,
            target_id.as_str(),
            &message.body,
            &message.recipients,
        )?;
        // Preserve saved explicit references, including references into other Threads.
        tx.execute(
            "INSERT OR IGNORE INTO camp_message_reference(camp_message_id,kind,value)
            SELECT ?1,kind,value FROM camp_message_reference WHERE camp_message_id=?2",
            params![id, message.id],
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO camp_message_mention(camp_message_id,agent_id)
            SELECT ?1,agent_id FROM camp_message_mention WHERE camp_message_id=?2",
            params![id, message.id],
        )?;
        append_domain_event(
            tx,
            "camp_message.sent",
            Some(target_id.as_str()),
            Some(("camp_message", id)),
            &envelope.actor,
            None,
            &json!({"sequence":message.sequence}),
        )?;
    }
    // The imported history has already been seen by its Owner. Do not manufacture
    // unread replies from the new publication sequences or copy a source watermark.
    tx.execute(
        "INSERT INTO camp_view_state(camp_id,last_seen_global_sequence,updated_at)
        SELECT ?1,last_sequence,?2 FROM event_sequence WHERE singleton=1",
        params![target_id, now],
    )?;
    crate::message_changes::record(tx, target_id.as_str(), false, &[]);
    Ok(CommandHandlerResult::applied(
        "camp.forked",
        json!({"threadId":target_id}),
        Some(EntityReference {
            entity_type: "camp".into(),
            entity_id: target_id.to_string(),
        }),
    ))
}

#[cfg(all(test, feature = "extended-tests"))]
#[path = "camp_fork_tests.rs"]
mod tests;
