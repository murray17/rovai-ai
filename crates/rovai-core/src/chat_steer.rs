use super::*;
use crate::{
    message_quote::{QuoteStorage, parse_quotes, store_quotes},
    steer::PendingInput as RuntimeInput,
};
use anyhow::Context;
use rusqlite::Connection;

pub(crate) fn ready_steers(c: &Connection) -> Result<Vec<RuntimeInput>> {
    let mut q=c.prepare_cached("SELECT p.id,r.id,r.execution_epoch FROM single_chat_pending_input p
        JOIN agent_run r ON r.id=p.target_run_id AND r.execution_epoch=p.target_execution_epoch
        JOIN chat_topic t ON t.conversation_id=p.conversation_id JOIN conversation c ON c.id=t.conversation_id
        WHERE p.requested_mode='steer' AND p.state='queued' AND r.status IN ('running','waiting')
          AND r.cancel_requested_at IS NULL AND t.archived_at IS NULL AND t.deletion_operation_id IS NULL
          AND EXISTS(SELECT 1 FROM runtime_input_delivery i WHERE i.agent_run_id=r.id AND i.execution_epoch=r.execution_epoch AND i.input_kind='start' AND i.status='accepted' AND i.native_binding_id=c.native_binding_id AND i.native_binding_generation=c.native_binding_generation)
          AND NOT EXISTS(SELECT 1 FROM context_manifest m JOIN runtime_input_delivery i ON i.context_manifest_id=m.id WHERE m.source_chat_input_id=p.id AND (i.status<>'prepared' OR i.dispatch_started_at IS NOT NULL))
          AND NOT EXISTS(SELECT 1 FROM single_chat_pending_input e WHERE e.target_run_id=r.id AND e.target_execution_epoch=r.execution_epoch AND e.requested_mode='steer' AND e.state='queued' AND e.enqueue_sequence<p.enqueue_sequence AND NOT EXISTS(SELECT 1 FROM context_manifest m JOIN runtime_input_delivery i ON i.context_manifest_id=m.id WHERE m.source_chat_input_id=e.id AND i.status='delivery_unknown'))
        ORDER BY p.enqueue_sequence,p.id")?;
    Ok(q.query_map([], |r| {
        Ok(RuntimeInput {
            delivery_id: r.get(0)?,
            agent_run_id: r.get(1)?,
            execution_epoch: r.get(2)?,
        })
    })?
    .collect::<rusqlite::Result<_>>()?)
}

pub(crate) fn return_steer_to_queue(tx: &Transaction<'_>, id: &str, now: &str) -> Result<()> {
    let changed=tx.execute("UPDATE single_chat_pending_input SET requested_mode='start',revision=revision+1,updated_at=?2
        WHERE id=?1 AND requested_mode='steer' AND state='queued'
        AND EXISTS(SELECT 1 FROM agent_run r WHERE r.id=target_run_id AND r.status IN ('running','waiting','succeeded') AND r.cancel_requested_at IS NULL)
        AND NOT EXISTS(SELECT 1 FROM context_manifest m JOIN runtime_input_delivery i ON i.context_manifest_id=m.id WHERE m.source_chat_input_id=?1 AND (i.status IN ('accepted','delivery_unknown') OR (i.status='prepared' AND i.dispatch_started_at IS NOT NULL)))",params![id,now])?;
    if changed > 0 {
        crate::execution_input::changed(tx, id)?;
    }
    Ok(())
}

pub(crate) fn settle_steers(
    tx: &Transaction<'_>,
    run: &str,
    status: &str,
    now: &str,
) -> Result<()> {
    let inputs = tx.prepare_cached("SELECT id FROM single_chat_pending_input WHERE target_run_id=?1 AND requested_mode='steer' AND state='queued'")?
        .query_map([run],|r|r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
    for input in inputs {
        if status == "succeeded" {
            return_steer_to_queue(tx, &input, now)?;
        } else {
            tx.execute("UPDATE single_chat_pending_input SET state='cancelled',revision=revision+1,updated_at=?2
                WHERE id=?1 AND NOT EXISTS(SELECT 1 FROM context_manifest m JOIN runtime_input_delivery i ON i.context_manifest_id=m.id WHERE m.source_chat_input_id=?1 AND (i.status IN ('accepted','delivery_unknown') OR i.dispatch_started_at IS NOT NULL))",params![input,now])?;
            crate::execution_input::changed(tx, &input)?;
        }
    }
    Ok(())
}

/// The same transaction records a first ACK, including one reconciled after the Run ended.
pub(crate) fn accept_steer(
    tx: &Transaction<'_>,
    id: &str,
    run: &str,
    epoch: i64,
    now: &str,
) -> Result<()> {
    let (chat,user,body,files,quotes,skills,published):(String,String,String,String,String,String,Option<String>)=tx.query_row(
        "SELECT p.conversation_id,p.user_id,p.body,p.source_attachments_json,p.quotes_json,p.chat_skills_json,p.published_conversation_message_id
         FROM single_chat_pending_input p JOIN chat_topic t ON t.conversation_id=p.conversation_id
         WHERE p.id=?1 AND p.requested_mode='steer' AND p.target_run_id=?2 AND p.target_execution_epoch=?3 AND t.deletion_operation_id IS NULL",
        params![id,run,epoch],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional()?.context("Chat supplement no longer belongs to its execution")?;
    if published.is_some() {
        return Ok(());
    }
    let sequence:i64=tx.query_row("UPDATE conversation SET last_message_sequence=last_message_sequence+1,version=version+1,updated_at=?2 WHERE id=?1 AND kind='chat' RETURNING last_message_sequence",params![chat,now],|r|r.get(0))?;
    let msg = uuid::Uuid::new_v4().to_string();
    tx.execute("INSERT INTO conversation_message(id,conversation_id,sequence,author_type,author_id,body,agent_run_id,source_attachments_json,chat_skills_json,created_at) VALUES(?1,?2,?3,'user',?4,?5,?6,?7,?8,?9)",params![msg,chat,sequence,user,body,run,files,skills,now])?;
    store_quotes(
        tx,
        QuoteStorage::PrivateMessage,
        &msg,
        &parse_quotes(&quotes)?,
    )?;
    tx.execute("UPDATE single_chat_pending_input SET state='published',published_conversation_message_id=?2,published_agent_run_id=?3,published_at=?4,updated_at=?4,revision=revision+1 WHERE id=?1",params![id,msg,run,now])?;
    Ok(())
}
