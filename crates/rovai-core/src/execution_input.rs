//! Core-owned ordering markers for Steer. Bodies and receipts remain owned by
//! CampMessage/Delivery; bounded reads hydrate them without copying input content.
use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::json;

use crate::{
    camp_content, execution_evidence::allocate_change_sequence,
    read_model::AgentRunExecutionEvidenceView,
};

pub(crate) const EVENT: &str = "agent_run.input";

pub(crate) fn record(tx: &Transaction<'_>, delivery: &str) -> Result<()> {
    let (run, epoch, message, created): (String, i64, String, String) = tx.query_row(
        "SELECT claimed_agent_run_id,target_execution_epoch,message_id,updated_at FROM camp_message_delivery WHERE id=?1 AND requested_mode='steer' AND status='claimed'",
        [delivery], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
    let key = format!("steer-input:{delivery}");
    let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM agent_run_execution_evidence WHERE agent_run_id=?1 AND source_event_key=?2)", params![run,key], |r|r.get(0))?;
    if exists {
        return Ok(());
    }
    let sequence: i64 = tx.query_row("SELECT COALESCE(MAX(sequence),0)+1 FROM agent_run_execution_evidence WHERE agent_run_id=?1", [&run], |r|r.get(0))?;
    let change = allocate_change_sequence(tx, &run)?;
    let payload = json!({"deliveryId":delivery,"messageId":message}).to_string();
    tx.execute("INSERT INTO agent_run_execution_evidence(id,agent_run_id,execution_epoch,sequence,event_type,kind,phase,source_event_key,payload_preview_json,content_byte_count,is_truncated,occurred_at,revision,change_sequence,updated_at) VALUES(?1,?2,?3,?4,?5,'step','updated',?6,?7,?8,0,?9,1,?10,?9)",
        params![key,run,epoch,sequence,EVENT,key,payload,payload.len() as i64,created,change])?;
    Ok(())
}

/// Advance the normal execution change cursor without moving the input marker.
/// A missing marker is a pre-feature input, whose historical position is not guessed.
pub(crate) fn changed(tx: &Transaction<'_>, delivery: &str) -> Result<()> {
    let rows = {
        let mut q = tx.prepare("SELECT id,agent_run_id FROM agent_run_execution_evidence WHERE id=?1 AND event_type=?2")?;
        q.query_map(params![format!("steer-input:{delivery}"), EVENT], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (id, run) in rows {
        let change = allocate_change_sequence(tx, &run)?;
        tx.execute("UPDATE agent_run_execution_evidence SET revision=revision+1,change_sequence=?2,updated_at=?3 WHERE id=?1",params![id,change,chrono::Utc::now().to_rfc3339()])?;
    }
    Ok(())
}

pub(crate) fn hydrate(c: &Connection, item: &mut AgentRunExecutionEvidenceView) -> Result<()> {
    if item.event_type != EVENT {
        return Ok(());
    }
    let Some(delivery) = item.payload["deliveryId"].as_str() else {
        return Ok(());
    };
    // Match all owners before revealing public content. A rejected input may have
    // returned to the ordinary queue, so the marker's original Run remains the fence.
    let source = c.query_row(r#"SELECT m.id,
        CASE WHEN m.tombstoned_at IS NULL THEN m.structured_content_json END,m.created_at,
        CASE WHEN i.status='accepted' THEN 'accepted'
          WHEN i.status='delivery_unknown' OR d.failure_code='input_delivery_unknown' THEN 'delivery_unknown'
          WHEN d.requested_mode<>'steer' OR d.claimed_agent_run_id IS NOT r.id OR d.target_execution_epoch IS NOT ?3 THEN 'queued'
          WHEN i.status='not_accepted' OR d.status IN ('failed','cancelled') OR r.status IN ('failed','cancelled') THEN 'not_accepted'
          WHEN i.dispatch_started_at IS NOT NULL THEN 'sending' ELSE 'pending' END
        FROM camp_message_delivery d JOIN camp_message m ON m.id=d.message_id
        JOIN agent_run r ON r.id=?2 AND r.camp_id=m.camp_id
        LEFT JOIN context_manifest cm ON cm.source_delivery_id=d.id AND cm.agent_run_id=r.id
        LEFT JOIN runtime_input_delivery i ON i.context_manifest_id=cm.id AND i.execution_epoch=?3 AND i.input_kind='steer'
        WHERE d.id=?1 AND m.id=?4 AND m.author_type='user' AND m.recall_state<>'withdrawn'"#,
        params![delivery,item.agent_run_id,item.execution_epoch,item.payload["messageId"].as_str()],
        |r| Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?))).optional()?;
    let Some((message, Some(content), created, status)) = &source else {
        item.payload = json!({"deliveryId":delivery,"messageId":item.payload["messageId"],"status":"unavailable",
            "preview":"","sourceAvailable":false,"sourceDeleted":source.is_some()});
        return Ok(());
    };
    let content = camp_content::normalize_content(serde_json::from_str(content)?);
    camp_content::validate_content(&content)?;
    let body = camp_content::render_current_plain_text(c, &content)?;
    let preview: String = body.chars().take(240).collect();
    item.payload = json!({"deliveryId":delivery,"messageId":message,"status":status,"preview":preview,"createdAt":created,"sourceAvailable":true});
    item.content_blob_id = None;
    item.is_truncated = false;
    // This input is not a Runtime tool or an operation result.
    item.canonical = None;
    Ok(())
}
