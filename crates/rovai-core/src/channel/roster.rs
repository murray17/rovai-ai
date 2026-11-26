//! Group membership is checked only when a channel request or delivery can start.
//! Existing FIFO rows carry outstanding demand across process restarts.
use anyhow::Result;
use chrono::{DateTime, NaiveDateTime};
use rusqlite::{Connection, OptionalExtension, Transaction, params};

use crate::message_delivery::GroupRosterRefreshRequest;

pub(super) const WAIT: &str = "channel.roster_sync_required";

pub(crate) enum ClaimDecision {
    Ready,
    Wait,
    Cancelled,
}

pub(crate) struct RecipientRoster {
    observed_at: Option<String>,
    present: bool,
    previous_end: Option<String>,
    binding_id: String,
}

impl RecipientRoster {
    pub(crate) fn load(
        tx: &Transaction<'_>,
        camp: &str,
        agent: &str,
        conversation: &str,
    ) -> Result<Option<Self>> {
        Ok(tx.query_row(
            "SELECT state.observed_at, COALESCE(member.status='present' AND bot.status='published',0),
                 (SELECT MAX(ended_at) FROM agent_run WHERE conversation_id=?3), binding.id
             FROM channel_conversation_binding binding
             JOIN channel_conversation chat ON chat.id=binding.channel_conversation_id
             LEFT JOIN external_group_bot_roster_state state USING(provider,tenant_key,chat_id)
             LEFT JOIN external_group_bot_roster member ON member.provider=chat.provider
                  AND member.tenant_key=chat.tenant_key AND member.chat_id=chat.chat_id AND member.agent_id=?2
             LEFT JOIN channel_member_bot_directory bot ON bot.provider=chat.provider AND bot.app_id=member.app_id
             WHERE binding.camp_id=?1 AND binding.status='active' AND chat.conversation_kind IN ('group','topic')",
            params![camp, agent, conversation],
            |row| Ok(Self {
                observed_at: row.get(0)?, present: row.get(1)?,
                previous_end: row.get(2)?, binding_id: row.get(3)?,
            }),
        ).optional()?)
    }

    pub(crate) fn check(&self, tx: &Transaction<'_>, delivery: &str) -> Result<ClaimDecision> {
        // The inbound observation precedes its own Delivery. Only its original target
        // can reuse it. A later terminal Run or FIFO predecessor raises the boundary.
        let (queued, inbound, request_id): (String, Option<String>, Option<String>) = tx
            .query_row(
                "SELECT d.created_at, a.created_at, r.id FROM camp_message_delivery d
             LEFT JOIN channel_turn_request r ON r.camp_message_id=d.message_id AND r.binding_id=?2
                AND EXISTS (SELECT 1 FROM json_each(r.delivery_ids_json) WHERE value=d.id)
             LEFT JOIN channel_inbound_aggregate a ON a.id=r.aggregate_id WHERE d.id=?1",
                params![delivery, self.binding_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?;
        let predecessor = match request_id {
            Some(id) => predecessor_boundary(tx, &id)?,
            None => None,
        };
        let fresh = self.observed_at.as_deref().is_some_and(|at| {
            [
                Some(inbound.as_deref().unwrap_or(&queued)),
                self.previous_end.as_deref(),
                predecessor.as_deref(),
            ]
            .into_iter()
            .flatten()
            .all(|required| later(at, required))
        });
        if !fresh {
            tx.execute("UPDATE camp_message_delivery SET failure_code=?2 WHERE id=?1 AND failure_code IS NOT ?2",
                params![delivery,WAIT])?;
            return Ok(ClaimDecision::Wait);
        }
        if !self.present {
            let now = chrono::Utc::now().to_rfc3339();
            tx.execute("UPDATE camp_message_delivery SET status='cancelled', failure_code='channel.target_bot_not_in_roster',
                ended_at=?2, updated_at=?2, version=version+1 WHERE id=?1 AND status='waiting'",params![delivery,now])?;
            return Ok(ClaimDecision::Cancelled);
        }
        Ok(ClaimDecision::Ready)
    }
}

pub(super) fn timestamp(value: &str) -> Option<DateTime<chrono::Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|at| at.to_utc())
        .or_else(|| {
            NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S%.f")
                .ok()
                .map(|at| at.and_utc())
        })
}

fn later(at: &str, boundary: &str) -> bool {
    matches!((timestamp(at), timestamp(boundary)), (Some(at), Some(boundary)) if at > boundary)
}

fn predecessor_boundary(tx: &Transaction<'_>, id: &str) -> Result<Option<String>> {
    Ok(tx.query_row("SELECT MAX(previous.completed_at) FROM channel_turn_request r
        JOIN channel_turn_request previous ON previous.binding_id=r.binding_id AND previous.rowid<r.rowid
        WHERE r.id=?1 AND r.queue_position>1 AND previous.completed_at>=r.created_at",[id],|r|r.get(0))?)
}

pub(super) fn request_ready(
    tx: &Transaction<'_>,
    id: &str,
    provider: &str,
    tenant: &str,
    chat: &str,
) -> Result<bool> {
    let Some(boundary) = predecessor_boundary(tx, id)? else {
        return Ok(true);
    };
    let at: Option<String> = tx
        .query_row(
            "SELECT observed_at FROM external_group_bot_roster_state
        WHERE provider=?1 AND tenant_key=?2 AND chat_id=?3",
            params![provider, tenant, chat],
            |r| r.get(0),
        )
        .optional()?;
    if at.is_some_and(|at| later(&at, &boundary)) {
        tx.execute(
            "UPDATE channel_turn_request SET failure_code=NULL WHERE id=?1 AND failure_code=?2",
            params![id, WAIT],
        )?;
        return Ok(true);
    }
    tx.execute(
        "UPDATE channel_turn_request SET failure_code=?2 WHERE id=?1 AND failure_code IS NOT ?2",
        params![id, WAIT],
    )?;
    Ok(false)
}

pub fn pending(
    conn: &Connection,
    provider: Option<&str>,
) -> Result<Vec<GroupRosterRefreshRequest>> {
    let mut q=conn.prepare("WITH needed(binding_id) AS (
        SELECT b.id FROM camp_message_delivery d
        JOIN channel_conversation_binding b ON b.camp_id=d.camp_id AND b.status='active'
        JOIN conversation c ON c.camp_id=d.camp_id AND c.agent_id=d.recipient_agent_id AND c.kind='camp_member'
        WHERE d.status='waiting' AND d.failure_code=?1 AND NOT EXISTS
            (SELECT 1 FROM agent_run run WHERE run.conversation_id=c.id AND run.status IN ('running','waiting','queued'))
        UNION SELECT r.binding_id FROM channel_turn_request r
        WHERE r.status='queued' AND r.failure_code=?1
          AND EXISTS (
              SELECT 1 FROM json_each(r.addressed_agent_ids_json) target
              WHERE NOT EXISTS (
                  SELECT 1 FROM conversation c JOIN agent_run run ON run.conversation_id=c.id
                  WHERE c.camp_id=r.camp_id AND c.agent_id=target.value AND c.kind='camp_member'
                    AND run.status IN ('running','waiting','queued')
              )
          ))
        SELECT DISTINCT chat.provider, chat.tenant_key, chat.chat_id, COALESCE(s.generation,0)+1
        FROM needed JOIN channel_conversation_binding b ON b.id=needed.binding_id AND b.status='active'
        JOIN channel_conversation chat ON chat.id=b.channel_conversation_id
        LEFT JOIN external_group_bot_roster_state s USING(provider,tenant_key,chat_id)
        WHERE (?2 IS NULL OR chat.provider=?2) ORDER BY 1,2,3")?;
    let mut groups = q
        .query_map(params![WAIT, provider], |r| {
            Ok(GroupRosterRefreshRequest {
                provider: r.get(0)?,
                tenant_key: r.get(1)?,
                chat_id: r.get(2)?,
                required_roster_generation: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    // Older pending Message Deliveries retain their generation-based Topic fence.
    for legacy_provider in ["feishu", "lark"] {
        if provider.is_some_and(|p| p != legacy_provider) {
            continue;
        }
        groups.extend(crate::message_delivery::pending_topic_roster_refreshes(
            conn,
            legacy_provider,
        )?);
    }
    groups.sort_by(|a, b| {
        (&a.provider, &a.tenant_key, &a.chat_id)
            .cmp(&(&b.provider, &b.tenant_key, &b.chat_id))
            .then_with(|| {
                b.required_roster_generation
                    .cmp(&a.required_roster_generation)
            })
    });
    groups.dedup_by(|a, b| {
        a.provider == b.provider && a.tenant_key == b.tenant_key && a.chat_id == b.chat_id
    });
    Ok(groups)
}
