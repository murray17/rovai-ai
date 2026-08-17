use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    collaboration::append_domain_event,
    command::{ActorRef, canonical_json_digest},
};

pub const GATHER_TOOL_NAME: &str = "team.gather";
pub const GATHER_COMPLETION_INPUT_SCHEMA_VERSION: i64 = 2;
pub const GATHER_COMPLETION_INPUT_MAX_BYTES: usize = 512 * 1024;
pub const GATHER_COMPLETION_CONTEXT_MAX_BYTES: usize = 640 * 1024;
pub const GATHER_CAPTURED_MESSAGES_MAX_PER_ITEM_GENERATION: i64 = 16;
pub const GATHER_CAPTURED_BODY_EXCERPT_MAX_BYTES: usize = 1024;
pub const GATHER_FALLBACK_SUMMARY_MAX_BYTES: usize = 2 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GatherCapture {
    pub gather_id: String,
    pub dispatch_delivery_id: String,
    pub source_retry_generation: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GatherAcceptance<'a> {
    pub gather_id: &'a str,
    pub command_id: &'a str,
    pub camp_id: &'a str,
    pub camp_turn_id: &'a str,
    pub request_message_id: &'a str,
    pub initiator_agent_id: &'a str,
    pub initiator_agent_run_id: &'a str,
    pub initiator_conversation_id: &'a str,
    pub now: &'a str,
}

pub(crate) fn persist_gather_record(
    transaction: &Transaction<'_>,
    acceptance: &GatherAcceptance<'_>,
) -> Result<()> {
    let route_valid: bool = transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM conversation
            JOIN agent_run ON agent_run.conversation_id = conversation.id
            WHERE conversation.id = ?1
              AND conversation.camp_id = ?2
              AND conversation.agent_id = ?3
              AND agent_run.id = ?4
              AND agent_run.camp_turn_id = ?5
        )
        "#,
        params![
            acceptance.initiator_conversation_id,
            acceptance.camp_id,
            acceptance.initiator_agent_id,
            acceptance.initiator_agent_run_id,
            acceptance.camp_turn_id,
        ],
        |row| row.get(0),
    )?;
    if !route_valid {
        anyhow::bail!("Gather initiator Conversation route is invalid");
    }
    transaction.execute(
        r#"
        INSERT INTO gather_record(
            id, camp_id, camp_turn_id, request_message_id,
            initiator_agent_id, initiator_agent_run_id,
            initiator_conversation_id, command_id,
            status, completion_input_schema_version,
            completion_input_json, completion_input_digest,
            completion_delivery_id, completion_run_id,
            cancellation_reason_code, version,
            created_at, ready_at, completion_started_at,
            completed_at, cancelled_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
            'collecting', NULL, NULL, NULL, NULL, NULL,
            NULL, 1, ?9, NULL, NULL, NULL, NULL, ?9
        )
        "#,
        params![
            acceptance.gather_id,
            acceptance.camp_id,
            acceptance.camp_turn_id,
            acceptance.request_message_id,
            acceptance.initiator_agent_id,
            acceptance.initiator_agent_run_id,
            acceptance.initiator_conversation_id,
            acceptance.command_id,
            acceptance.now,
        ],
    )?;
    Ok(())
}

pub(crate) fn persist_gather_item(
    transaction: &Transaction<'_>,
    gather_id: &str,
    dispatch_delivery_id: &str,
    recipient_agent_id: &str,
    now: &str,
) -> Result<()> {
    transaction.execute(
        r#"
        INSERT INTO gather_item(
            dispatch_delivery_id, gather_id, recipient_agent_id,
            active_retry_generation, target_agent_run_id,
            status, terminal_source,
            fallback_summary, fallback_summary_digest,
            fallback_summary_original_bytes, fallback_summary_truncated,
            error_code, terminal_resolution_source, terminal_reason_code,
            version, created_at, started_at, ended_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, 0, NULL, 'pending', NULL,
            NULL, NULL, NULL, 0, NULL, NULL, NULL,
            1, ?4, NULL, NULL, ?4
        )
        "#,
        params![dispatch_delivery_id, gather_id, recipient_agent_id, now],
    )?;
    Ok(())
}

/// Resolves a capture only from durable run/delivery/item identity. Message body,
/// mentions, display names and the current Default Lead are deliberately absent.
pub(crate) fn resolve_gather_capture(
    transaction: &Transaction<'_>,
    source_agent_run_id: &str,
    recipient_agent_id: &str,
) -> Result<Option<GatherCapture>> {
    transaction
        .query_row(
            r#"
            SELECT gather.id, item.dispatch_delivery_id,
                   run.trigger_delivery_generation
            FROM gather_item AS item
            JOIN gather_record AS gather ON gather.id = item.gather_id
            JOIN message_delivery AS dispatch
              ON dispatch.id = item.dispatch_delivery_id
            JOIN agent_run AS run ON run.id = item.target_agent_run_id
            WHERE gather.status = 'collecting'
              AND gather.initiator_agent_id = ?2
              AND item.status = 'running'
              AND item.target_agent_run_id = ?1
              AND item.active_retry_generation = dispatch.retry_generation
              AND run.trigger_message_delivery_id = dispatch.id
              AND run.trigger_delivery_generation = dispatch.retry_generation
              AND dispatch.delivery_kind = 'public_a2a'
              AND dispatch.dispatch_disposition = 'dispatch'
              AND dispatch.edge_kind = 'forward'
            "#,
            params![source_agent_run_id, recipient_agent_id],
            |row| {
                Ok(GatherCapture {
                    gather_id: row.get(0)?,
                    dispatch_delivery_id: row.get(1)?,
                    source_retry_generation: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

pub(crate) fn mark_item_materialized(
    transaction: &Transaction<'_>,
    dispatch_delivery_id: &str,
    target_agent_run_id: &str,
    retry_generation: i64,
    actor: &ActorRef,
    now: &str,
) -> Result<()> {
    let item = transaction
        .query_row(
            r#"
            SELECT item.gather_id, gather.camp_id
            FROM gather_item AS item
            JOIN gather_record AS gather ON gather.id = item.gather_id
            WHERE item.dispatch_delivery_id = ?1
              AND gather.status = 'collecting'
            "#,
            [dispatch_delivery_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((gather_id, camp_id)) = item else {
        return Ok(());
    };
    let updated = transaction.execute(
        r#"
        UPDATE gather_item
        SET status = 'running', target_agent_run_id = ?2,
            active_retry_generation = ?3, started_at = COALESCE(started_at, ?4),
            terminal_source = NULL, ended_at = NULL,
            fallback_summary = NULL, fallback_summary_digest = NULL,
            fallback_summary_original_bytes = NULL,
            fallback_summary_truncated = 0,
            error_code = NULL, terminal_resolution_source = NULL,
            terminal_reason_code = NULL,
            version = version + 1, updated_at = ?4
        WHERE dispatch_delivery_id = ?1 AND status = 'pending'
          AND active_retry_generation = ?3
        "#,
        params![
            dispatch_delivery_id,
            target_agent_run_id,
            retry_generation,
            now
        ],
    )?;
    if updated != 1 {
        anyhow::bail!("GatherItem changed before member AgentRun materialization");
    }
    append_domain_event(
        transaction,
        "gather.item_materialized",
        Some(&camp_id),
        Some(("gather", &gather_id)),
        actor,
        None,
        &json!({
            "gatherId": gather_id,
            "dispatchDeliveryId": dispatch_delivery_id,
            "targetAgentRunId": target_agent_run_id,
            "retryGeneration": retry_generation,
        }),
    )?;
    Ok(())
}

pub(crate) fn settle_item_from_delivery_terminal(
    transaction: &Transaction<'_>,
    dispatch_delivery_id: &str,
    delivery_status: &str,
    failure_code: Option<&str>,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<Option<String>> {
    let item_status = match delivery_status {
        "failed" => "failed",
        "cancelled" => "cancelled",
        "interrupted_before_dispatch" => "interrupted_before_dispatch",
        _ => return Ok(None),
    };
    let item = transaction
        .query_row(
            r#"
            SELECT item.gather_id, gather.camp_id
            FROM gather_item AS item
            JOIN gather_record AS gather ON gather.id = item.gather_id
            WHERE item.dispatch_delivery_id = ?1
              AND item.status = 'pending'
              AND item.target_agent_run_id IS NULL
              AND gather.status = 'collecting'
            "#,
            [dispatch_delivery_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((gather_id, camp_id)) = item else {
        return Ok(None);
    };
    let updated = transaction.execute(
        r#"
        UPDATE gather_item
        SET status = ?2, terminal_source = 'delivery',
            error_code = ?3, terminal_resolution_source = 'message_delivery',
            terminal_reason_code = ?3, ended_at = ?4,
            version = version + 1, updated_at = ?4
        WHERE dispatch_delivery_id = ?1 AND status = 'pending'
          AND target_agent_run_id IS NULL
        "#,
        params![dispatch_delivery_id, item_status, failure_code, now],
    )?;
    if updated != 1 {
        anyhow::bail!("GatherItem changed before Delivery terminal settlement");
    }
    append_domain_event(
        transaction,
        "gather.item_terminal",
        Some(&camp_id),
        Some(("gather", &gather_id)),
        actor,
        execution_epoch,
        &json!({
            "gatherId": gather_id,
            "dispatchDeliveryId": dispatch_delivery_id,
            "status": item_status,
            "terminalSource": "delivery",
            "errorCode": failure_code,
        }),
    )?;
    run_barrier(transaction, &gather_id, actor, execution_epoch, now)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn settle_item_from_agent_run_terminal(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    agent_run_status: &str,
    final_output: Option<&str>,
    error_code: Option<&str>,
    terminal_resolution_source: Option<&str>,
    terminal_reason_code: Option<&str>,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<Option<String>> {
    let item_status = match agent_run_status {
        "succeeded" => "succeeded",
        "failed" => "failed",
        "cancelled" => "cancelled",
        _ => return Ok(None),
    };
    let item = transaction
        .query_row(
            r#"
            SELECT item.gather_id, item.dispatch_delivery_id,
                   item.active_retry_generation, gather.camp_id
            FROM gather_item AS item
            JOIN gather_record AS gather ON gather.id = item.gather_id
            JOIN agent_run AS run ON run.id = item.target_agent_run_id
            WHERE item.target_agent_run_id = ?1
              AND item.status = 'running'
              AND gather.status = 'collecting'
              AND run.trigger_message_delivery_id = item.dispatch_delivery_id
              AND run.trigger_delivery_generation = item.active_retry_generation
            "#,
            [agent_run_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?;
    let Some((gather_id, dispatch_delivery_id, retry_generation, camp_id)) = item else {
        return Ok(None);
    };
    let has_capture: bool = transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM message_delivery AS captured
            JOIN agent_run AS source_run ON source_run.id = captured.source_agent_run_id
            WHERE captured.gather_dispatch_delivery_id = ?1
              AND captured.dispatch_disposition = 'gather_captured'
              AND captured.status = 'settled'
              AND captured.source_agent_run_id = ?2
              AND source_run.trigger_message_delivery_id = ?1
              AND source_run.trigger_delivery_generation = ?3
        )
        "#,
        params![dispatch_delivery_id, agent_run_id, retry_generation],
        |row| row.get(0),
    )?;
    let fallback = if item_status == "succeeded" && !has_capture {
        final_output.map(bounded_snapshot::<GATHER_FALLBACK_SUMMARY_MAX_BYTES>)
    } else {
        None
    };
    let updated = transaction.execute(
        r#"
        UPDATE gather_item
        SET status = ?2, terminal_source = 'agent_run',
            fallback_summary = ?3, fallback_summary_digest = ?4,
            fallback_summary_original_bytes = ?5,
            fallback_summary_truncated = ?6,
            error_code = ?7, terminal_resolution_source = ?8,
            terminal_reason_code = ?9,
            ended_at = ?10, version = version + 1, updated_at = ?10
        WHERE dispatch_delivery_id = ?1 AND status = 'running'
          AND target_agent_run_id = ?11
          AND active_retry_generation = ?12
        "#,
        params![
            dispatch_delivery_id,
            item_status,
            fallback.as_ref().map(|value| value.body.as_str()),
            fallback.as_ref().map(|value| value.digest.as_str()),
            fallback.as_ref().map(|value| value.original_bytes as i64),
            fallback.as_ref().is_some_and(|value| value.truncated) as i64,
            error_code,
            terminal_resolution_source,
            terminal_reason_code,
            now,
            agent_run_id,
            retry_generation,
        ],
    )?;
    if updated != 1 {
        anyhow::bail!("GatherItem changed before member AgentRun terminal settlement");
    }
    append_domain_event(
        transaction,
        "gather.item_terminal",
        Some(&camp_id),
        Some(("gather", &gather_id)),
        actor,
        execution_epoch,
        &json!({
            "gatherId": gather_id,
            "dispatchDeliveryId": dispatch_delivery_id,
            "targetAgentRunId": agent_run_id,
            "retryGeneration": retry_generation,
            "status": item_status,
            "terminalSource": "agent_run",
            "hasCapturedReturn": has_capture,
            "fallbackStored": fallback.is_some(),
            "errorCode": error_code,
        }),
    )?;
    run_barrier(transaction, &gather_id, actor, execution_epoch, now)
}

pub(crate) fn reopen_item_for_retry(
    transaction: &Transaction<'_>,
    delivery_id: &str,
    next_generation: i64,
    now: &str,
) -> Result<()> {
    let gather = transaction
        .query_row(
            r#"
            SELECT gather.status
            FROM gather_item AS item
            JOIN gather_record AS gather ON gather.id = item.gather_id
            WHERE item.dispatch_delivery_id = ?1
            "#,
            [delivery_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(status) = gather else {
        return Ok(());
    };
    if status != "collecting" {
        anyhow::bail!("gather.retry_not_allowed");
    }
    let updated = transaction.execute(
        r#"
        UPDATE gather_item
        SET active_retry_generation = ?2,
            target_agent_run_id = NULL, status = 'pending',
            terminal_source = NULL, fallback_summary = NULL,
            fallback_summary_digest = NULL,
            fallback_summary_original_bytes = NULL,
            fallback_summary_truncated = 0,
            error_code = NULL, terminal_resolution_source = NULL,
            terminal_reason_code = NULL, started_at = NULL, ended_at = NULL,
            version = version + 1, updated_at = ?3
        WHERE dispatch_delivery_id = ?1
          AND status IN ('failed', 'interrupted_before_dispatch')
        "#,
        params![delivery_id, next_generation, now],
    )?;
    if updated != 1 {
        anyhow::bail!("GatherItem is not eligible for retry");
    }
    Ok(())
}

pub(crate) fn validate_completion_retry(
    transaction: &Transaction<'_>,
    delivery_id: &str,
) -> Result<bool> {
    transaction
        .query_row(
            r#"
            SELECT gather.status = 'ready' AND gather.completion_run_id IS NULL
            FROM message_delivery AS delivery
            JOIN gather_record AS gather ON gather.id = delivery.gather_id
            WHERE delivery.id = ?1
              AND delivery.delivery_kind = 'gather_completion'
            "#,
            [delivery_id],
            |row| row.get(0),
        )
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(Into::into)
}

pub(crate) fn mark_completion_materialized(
    transaction: &Transaction<'_>,
    delivery_id: &str,
    agent_run_id: &str,
    now: &str,
) -> Result<()> {
    let updated = transaction.execute(
        r#"
        UPDATE gather_record
        SET status = 'completing', completion_run_id = ?2,
            completion_started_at = ?3,
            version = version + 1, updated_at = ?3
        WHERE completion_delivery_id = ?1
          AND status = 'ready' AND completion_run_id IS NULL
        "#,
        params![delivery_id, agent_run_id, now],
    )?;
    if updated != 1 {
        anyhow::bail!("Gather completion identity changed before materialization");
    }
    Ok(())
}

pub(crate) fn settle_completion_for_agent_run(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    agent_run_status: &str,
    error_code: Option<&str>,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<()> {
    let status = match agent_run_status {
        "succeeded" => "completed",
        "failed" => "completion_failed",
        "cancelled" => "cancelled",
        _ => return Ok(()),
    };
    let gather = transaction
        .query_row(
            r#"
            SELECT id, camp_id, status
            FROM gather_record
            WHERE completion_run_id = ?1
            "#,
            [agent_run_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((gather_id, camp_id, current_status)) = gather else {
        return Ok(());
    };
    if current_status == "cancelled" {
        return Ok(());
    }
    let updated = transaction.execute(
        r#"
        UPDATE gather_record
        SET status = ?2,
            completed_at = CASE WHEN ?2 IN ('completed', 'completion_failed') THEN ?3 ELSE completed_at END,
            cancelled_at = CASE WHEN ?2 = 'cancelled' THEN ?3 ELSE cancelled_at END,
            cancellation_reason_code = CASE WHEN ?2 = 'cancelled'
                THEN COALESCE(?4, 'completion_run_cancelled') ELSE cancellation_reason_code END,
            version = version + 1, updated_at = ?3
        WHERE id = ?1 AND status = 'completing'
          AND completion_run_id = ?5
        "#,
        params![gather_id, status, now, error_code, agent_run_id],
    )?;
    if updated != 1 {
        anyhow::bail!("Gather changed before completion AgentRun settlement");
    }
    append_domain_event(
        transaction,
        &format!("gather.{status}"),
        Some(&camp_id),
        Some(("gather", &gather_id)),
        actor,
        execution_epoch,
        &json!({
            "gatherId": gather_id,
            "completionRunId": agent_run_id,
            "status": status,
            "errorCode": error_code,
        }),
    )?;
    Ok(())
}

pub(crate) fn cancel_gathers_for_turn(
    transaction: &Transaction<'_>,
    camp_turn_id: &str,
    reason_code: &str,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<usize> {
    cancel_matching_gathers(
        transaction,
        "camp_turn_id = ?1",
        camp_turn_id,
        reason_code,
        actor,
        execution_epoch,
        now,
    )
}

pub(crate) fn cancel_gathers_for_initiator(
    transaction: &Transaction<'_>,
    camp_id: &str,
    initiator_agent_id: &str,
    reason_code: &str,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<usize> {
    let gather_ids = {
        let mut statement = transaction.prepare(
            r#"
            SELECT id FROM gather_record
            WHERE camp_id = ?1 AND initiator_agent_id = ?2
              AND status IN ('collecting', 'ready', 'completing')
            ORDER BY created_at, id
            "#,
        )?;
        statement
            .query_map(params![camp_id, initiator_agent_id], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for gather_id in &gather_ids {
        cancel_one_gather(
            transaction,
            gather_id,
            reason_code,
            actor,
            execution_epoch,
            now,
        )?;
    }
    Ok(gather_ids.len())
}

pub(crate) fn cancel_gather_for_delivery(
    transaction: &Transaction<'_>,
    delivery_id: &str,
    reason_code: &str,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<()> {
    let gather_id = transaction
        .query_row(
            "SELECT gather_id FROM message_delivery WHERE id = ?1",
            [delivery_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    if let Some(gather_id) = gather_id {
        cancel_one_gather(
            transaction,
            &gather_id,
            reason_code,
            actor,
            execution_epoch,
            now,
        )?;
    }
    Ok(())
}

fn cancel_matching_gathers(
    transaction: &Transaction<'_>,
    predicate: &str,
    value: &str,
    reason_code: &str,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<usize> {
    let sql = format!(
        "SELECT id FROM gather_record WHERE {predicate} AND status IN ('collecting','ready','completing') ORDER BY created_at,id"
    );
    let gather_ids = {
        let mut statement = transaction.prepare(&sql)?;
        statement
            .query_map([value], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for gather_id in &gather_ids {
        cancel_one_gather(
            transaction,
            gather_id,
            reason_code,
            actor,
            execution_epoch,
            now,
        )?;
    }
    Ok(gather_ids.len())
}

fn cancel_one_gather(
    transaction: &Transaction<'_>,
    gather_id: &str,
    reason_code: &str,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<()> {
    let row = transaction
        .query_row(
            "SELECT camp_id, completion_delivery_id, status FROM gather_record WHERE id = ?1",
            [gather_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((camp_id, completion_delivery_id, status)) = row else {
        return Ok(());
    };
    if !matches!(status.as_str(), "collecting" | "ready" | "completing") {
        return Ok(());
    }
    if let Some(delivery_id) = completion_delivery_id.as_deref() {
        transaction.execute(
            r#"
            UPDATE message_delivery
            SET status = CASE
                    WHEN dispatch_attempt_count = 0
                    THEN 'interrupted_before_dispatch'
                    ELSE 'cancelled'
                END,
                dispatch_phase = 'terminal',
                wait_condition = NULL, active_dispatch_attempt_id = NULL,
                manual_intervention_required = CASE
                    WHEN dispatch_attempt_count = 0 THEN 1
                    ELSE 0
                END,
                failure_code = ?2,
                version = version + 1, updated_at = ?3, ended_at = ?3
            WHERE id = ?1 AND status = 'pending'
            "#,
            params![delivery_id, reason_code, now],
        )?;
    }
    transaction.execute(
        r#"
        UPDATE gather_record
        SET status = 'cancelled', cancellation_reason_code = ?2,
            cancelled_at = ?3, version = version + 1, updated_at = ?3
        WHERE id = ?1 AND status IN ('collecting', 'ready', 'completing')
        "#,
        params![gather_id, reason_code, now],
    )?;
    append_domain_event(
        transaction,
        "gather.cancelled",
        Some(&camp_id),
        Some(("gather", gather_id)),
        actor,
        execution_epoch,
        &json!({
            "gatherId": gather_id,
            "reasonCode": reason_code,
            "completionDeliveryId": completion_delivery_id,
        }),
    )?;
    Ok(())
}

pub(crate) fn completion_delivery_for_item(
    connection: &rusqlite::Connection,
    dispatch_delivery_id: &str,
) -> Result<Option<String>> {
    connection
        .query_row(
            r#"
            SELECT gather.completion_delivery_id
            FROM gather_item AS item
            JOIN gather_record AS gather ON gather.id = item.gather_id
            JOIN message_delivery AS completion
              ON completion.id = gather.completion_delivery_id
            WHERE item.dispatch_delivery_id = ?1
              AND gather.status = 'ready'
              AND completion.status = 'pending'
              AND completion.dispatch_phase = 'never_attempted'
              AND completion.dispatch_attempt_count = 0
            "#,
            [dispatch_delivery_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(Into::into)
}

pub(crate) fn completion_delivery_for_member_run(
    connection: &rusqlite::Connection,
    agent_run_id: &str,
) -> Result<Option<String>> {
    connection
        .query_row(
            r#"
            SELECT gather.completion_delivery_id
            FROM gather_item AS item
            JOIN gather_record AS gather ON gather.id = item.gather_id
            JOIN message_delivery AS completion
              ON completion.id = gather.completion_delivery_id
            WHERE item.target_agent_run_id = ?1
              AND gather.status = 'ready'
              AND completion.status = 'pending'
              AND completion.dispatch_phase = 'never_attempted'
              AND completion.dispatch_attempt_count = 0
            "#,
            [agent_run_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(Into::into)
}

fn run_barrier(
    transaction: &Transaction<'_>,
    gather_id: &str,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<Option<String>> {
    let gather = transaction
        .query_row(
            r#"
            SELECT gather.camp_id, gather.camp_turn_id, gather.request_message_id,
                   initiator_agent_id, initiator_agent_run_id,
                   initiator_conversation_id, command_id, gather.status,
                   request.body, request.content_digest
            FROM gather_record AS gather
            JOIN camp_message AS request
              ON request.id = gather.request_message_id
             AND request.camp_id = gather.camp_id
            WHERE gather.id = ?1
            "#,
            [gather_id],
            |row| {
                Ok(BarrierGather {
                    camp_id: row.get(0)?,
                    camp_turn_id: row.get(1)?,
                    request_message_id: row.get(2)?,
                    initiator_agent_id: row.get(3)?,
                    initiator_agent_run_id: row.get(4)?,
                    initiator_conversation_id: row.get(5)?,
                    command_id: row.get(6)?,
                    status: row.get(7)?,
                    request_body: row.get(8)?,
                    request_content_digest: row.get(9)?,
                })
            },
        )
        .optional()?;
    let Some(gather) = gather else {
        return Ok(None);
    };
    if gather.status != "collecting" {
        return Ok(None);
    }
    let nonterminal_items: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*) FROM gather_item
        WHERE gather_id = ?1 AND status IN ('pending', 'running')
        "#,
        [gather_id],
        |row| row.get(0),
    )?;
    if nonterminal_items != 0 {
        return Ok(None);
    }
    let lifecycle_valid: bool = transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM camp
            JOIN camp_turn ON camp_turn.camp_id = camp.id
            JOIN camp_member
              ON camp_member.camp_id = camp.id
             AND camp_member.agent_id = ?3
            JOIN agent_profile ON agent_profile.id = camp_member.agent_id
            JOIN conversation ON conversation.id = ?4
            WHERE camp.id = ?1 AND camp_turn.id = ?2
              AND camp_turn.status IN ('running', 'waiting')
              AND camp_turn.cancel_requested_at IS NULL
              AND camp_turn.execution_budget_exhausted_at IS NULL
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'present'
              AND conversation.camp_id = camp.id
              AND conversation.agent_id = ?3
        )
        "#,
        params![
            gather.camp_id,
            gather.camp_turn_id,
            gather.initiator_agent_id,
            gather.initiator_conversation_id,
        ],
        |row| row.get(0),
    )?;
    if !lifecycle_valid {
        cancel_one_gather(
            transaction,
            gather_id,
            "gather_lifecycle_no_longer_active",
            actor,
            execution_epoch,
            now,
        )?;
        return Ok(None);
    }
    let camp_boundary: i64 = transaction.query_row(
        "SELECT last_message_sequence FROM camp WHERE id = ?1",
        [&gather.camp_id],
        |row| row.get(0),
    )?;
    let payload = build_completion_input(transaction, gather_id, &gather, camp_boundary)?;
    let payload_bytes = serde_json::to_vec(&payload)?;
    if payload_bytes.len() > GATHER_COMPLETION_INPUT_MAX_BYTES {
        anyhow::bail!(
            "Gather completion mandatory input exceeds {} bytes",
            GATHER_COMPLETION_INPUT_MAX_BYTES
        );
    }
    let payload_json = String::from_utf8(payload_bytes).context("Gather input must be UTF-8")?;
    let payload_digest = format!("sha256:{}", canonical_json_digest(&payload)?);
    let completion_delivery_id = Uuid::new_v4().to_string();
    let queue_sequence: i64 = transaction.query_row(
        r#"
        SELECT COALESCE(MAX(queue_sequence), 0) + 1
        FROM message_delivery
        WHERE camp_id = ?1 AND recipient_agent_id = ?2
        "#,
        params![gather.camp_id, gather.initiator_agent_id],
        |row| row.get(0),
    )?;
    let frozen_snapshot = json!({
        "schemaVersion": 3,
        "deliveryKind": "gather_completion",
        "dispatchDisposition": "dispatch",
        "completionRole": "required",
        "gatherId": gather_id,
        "requestMessageId": gather.request_message_id,
        "sourceAgentRunId": gather.initiator_agent_run_id,
        "recipientAgentId": gather.initiator_agent_id,
        "targetConversationId": gather.initiator_conversation_id,
        "completionInputSchemaVersion": GATHER_COMPLETION_INPUT_SCHEMA_VERSION,
        "completionInputDigest": payload_digest,
        "completionInputByteLength": payload_json.len(),
        "campMessageBoundarySequence": camp_boundary,
    });
    transaction.execute(
        r#"
        INSERT INTO message_delivery(
            id, camp_id, camp_turn_id, message_id,
            recipient_agent_id, recipient_canonical_position,
            recipient_digest, message_body_digest,
            reply_to_camp_message_id, task_id,
            task_version_at_admission, assignee_agent_id_at_admission,
            source_agent_run_id, edge_kind,
            target_parent_agent_run_id, return_to_agent_run_id,
            a2a_root_agent_run_id, a2a_depth,
            ancestor_agent_ids_json, recipient_presentation_snapshot_json,
            frozen_snapshot_json, delivery_kind, dispatch_disposition,
            completion_role, gather_id, gather_dispatch_delivery_id,
            target_conversation_id, camp_message_boundary_sequence, queue_sequence,
            status, dispatch_phase, wait_condition,
            dispatch_attempt_count, active_dispatch_attempt_id,
            scheduler_correlation_id, context_manifest_id,
            target_agent_run_id, retry_generation,
            manual_intervention_required, failure_code, failure_detail_json,
            version, created_at, updated_at, ended_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, NULL, NULL, NULL,
            NULL, NULL, NULL, NULL, ?6, NULL, NULL, NULL,
            NULL, 0, NULL, NULL, ?7,
            'gather_completion', 'dispatch', 'required', ?8, NULL,
            ?9, ?10, ?11,
            'pending', 'never_attempted', NULL,
            0, NULL, NULL, NULL, NULL, 0, 0, NULL, NULL,
            1, ?12, ?12, NULL
        )
        "#,
        params![
            completion_delivery_id,
            gather.camp_id,
            gather.camp_turn_id,
            gather.request_message_id,
            gather.initiator_agent_id,
            gather.initiator_agent_run_id,
            serde_json::to_string(&frozen_snapshot)?,
            gather_id,
            gather.initiator_conversation_id,
            camp_boundary,
            queue_sequence,
            now,
        ],
    )?;
    let updated = transaction.execute(
        r#"
        UPDATE gather_record
        SET status = 'ready',
            completion_input_schema_version = ?2,
            completion_input_json = ?3,
            completion_input_digest = ?4,
            completion_delivery_id = ?5,
            ready_at = ?6, version = version + 1, updated_at = ?6
        WHERE id = ?1 AND status = 'collecting'
          AND completion_delivery_id IS NULL
        "#,
        params![
            gather_id,
            GATHER_COMPLETION_INPUT_SCHEMA_VERSION,
            payload_json,
            payload_digest,
            completion_delivery_id,
            now,
        ],
    )?;
    if updated != 1 {
        anyhow::bail!("Gather changed before Barrier commit");
    }
    append_domain_event(
        transaction,
        "gather.ready",
        Some(&gather.camp_id),
        Some(("gather", gather_id)),
        actor,
        execution_epoch,
        &json!({
            "gatherId": gather_id,
            "requestMessageId": gather.request_message_id,
            "completionDeliveryId": completion_delivery_id,
            "completionInputSchemaVersion": GATHER_COMPLETION_INPUT_SCHEMA_VERSION,
            "completionInputDigest": payload_digest,
            "completionInputByteLength": payload_json.len(),
            "campMessageBoundarySequence": camp_boundary,
            "queueSequence": queue_sequence,
        }),
    )?;
    Ok(Some(completion_delivery_id))
}

fn build_completion_input(
    transaction: &Transaction<'_>,
    gather_id: &str,
    gather: &BarrierGather,
    camp_boundary: i64,
) -> Result<Value> {
    let items = {
        let mut statement = transaction.prepare(
            r#"
            SELECT dispatch_delivery_id, recipient_agent_id,
                   active_retry_generation, target_agent_run_id,
                   status, terminal_source,
                   fallback_summary, fallback_summary_digest,
                   fallback_summary_original_bytes, fallback_summary_truncated,
                   error_code, terminal_resolution_source, terminal_reason_code
            FROM gather_item
            WHERE gather_id = ?1
            ORDER BY recipient_agent_id, dispatch_delivery_id
            "#,
        )?;
        statement
            .query_map([gather_id], |row| {
                Ok(BarrierItem {
                    dispatch_delivery_id: row.get(0)?,
                    recipient_agent_id: row.get(1)?,
                    active_retry_generation: row.get(2)?,
                    target_agent_run_id: row.get(3)?,
                    status: row.get(4)?,
                    terminal_source: row.get(5)?,
                    fallback_summary: row.get(6)?,
                    fallback_summary_digest: row.get(7)?,
                    fallback_summary_original_bytes: row.get(8)?,
                    fallback_summary_truncated: row.get::<_, i64>(9)? != 0,
                    error_code: row.get(10)?,
                    terminal_resolution_source: row.get(11)?,
                    terminal_reason_code: row.get(12)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    if items.is_empty() {
        anyhow::bail!("Gather Barrier cannot complete an empty Gather");
    }
    let mut projected_items = Vec::with_capacity(items.len());
    for item in items {
        let captured = load_current_captured_message(
            transaction,
            &item.dispatch_delivery_id,
            item.target_agent_run_id.as_deref(),
            item.active_retry_generation,
            &gather.camp_id,
            camp_boundary,
        )?;
        let fallback = match (
            item.fallback_summary,
            item.fallback_summary_digest,
            item.fallback_summary_original_bytes,
        ) {
            (Some(body), Some(content_digest), Some(original_bytes)) => Some(json!({
                "body": body,
                "contentDigest": content_digest,
                "originalBytes": original_bytes,
                "truncated": item.fallback_summary_truncated,
            })),
            (None, None, None) => None,
            _ => anyhow::bail!("GatherItem fallback snapshot is incomplete"),
        };
        let error = item.error_code.map(|code| {
            json!({
                "code": code,
                "terminalResolutionSource": item.terminal_resolution_source,
                "terminalReasonCode": item.terminal_reason_code,
                "manualRetryAllowed": false,
            })
        });
        projected_items.push(json!({
            "recipientAgentId": item.recipient_agent_id,
            "dispatchDeliveryId": item.dispatch_delivery_id,
            "activeRetryGeneration": item.active_retry_generation,
            "targetAgentRunId": item.target_agent_run_id,
            "status": item.status,
            "terminalSource": item.terminal_source,
            "capturedMessages": captured,
            "fallbackSummary": fallback,
            "error": error,
        }));
    }
    Ok(json!({
        "schemaVersion": GATHER_COMPLETION_INPUT_SCHEMA_VERSION,
        "source": { "type": "gather_completed" },
        "gatherId": gather_id,
        "commandId": gather.command_id,
        "requestMessageId": gather.request_message_id,
        "request": {
            "messageId": gather.request_message_id,
            "body": gather.request_body,
            "contentDigest": gather.request_content_digest,
        },
        "items": projected_items,
    }))
}

fn load_current_captured_message(
    transaction: &Transaction<'_>,
    dispatch_delivery_id: &str,
    target_agent_run_id: Option<&str>,
    active_retry_generation: i64,
    camp_id: &str,
    camp_boundary: i64,
) -> Result<Vec<Value>> {
    let Some(target_agent_run_id) = target_agent_run_id else {
        return Ok(Vec::new());
    };
    let messages = {
        let mut statement = transaction.prepare(
            r#"
            SELECT message.id, captured.source_agent_run_id,
                   source_run.trigger_delivery_generation,
                   message.sequence, message.content_digest, message.body
            FROM message_delivery AS captured
            JOIN camp_message AS message ON message.id = captured.message_id
            JOIN agent_run AS source_run ON source_run.id = captured.source_agent_run_id
            WHERE captured.gather_dispatch_delivery_id = ?1
              AND captured.dispatch_disposition = 'gather_captured'
              AND captured.status = 'settled'
              AND captured.camp_id = ?2
              AND captured.source_agent_run_id = ?3
              AND source_run.trigger_message_delivery_id = ?1
              AND source_run.trigger_delivery_generation = ?4
              AND message.sequence <= ?5
            ORDER BY message.sequence DESC, message.id DESC
            LIMIT 1
            "#,
        )?;
        statement
            .query_map(
                params![
                    dispatch_delivery_id,
                    camp_id,
                    target_agent_run_id,
                    active_retry_generation,
                    camp_boundary
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    Ok(messages
        .into_iter()
        .map(
            |(
                message_id,
                source_agent_run_id,
                retry_generation,
                sequence,
                content_digest,
                body,
            )| {
                let excerpt = bounded_snapshot::<GATHER_CAPTURED_BODY_EXCERPT_MAX_BYTES>(&body);
                json!({
                    "messageId": message_id,
                    "sourceAgentRunId": source_agent_run_id,
                    "retryGeneration": retry_generation,
                    "sequence": sequence,
                    "contentDigest": content_digest,
                    "bodyExcerpt": excerpt.body,
                    "bodyOriginalBytes": excerpt.original_bytes,
                    "bodyTruncated": excerpt.truncated,
                })
            },
        )
        .collect())
}

#[derive(Debug)]
struct BarrierGather {
    camp_id: String,
    camp_turn_id: String,
    request_message_id: String,
    initiator_agent_id: String,
    initiator_agent_run_id: String,
    initiator_conversation_id: String,
    command_id: String,
    status: String,
    request_body: String,
    request_content_digest: String,
}

#[derive(Debug)]
struct BarrierItem {
    dispatch_delivery_id: String,
    recipient_agent_id: String,
    active_retry_generation: i64,
    target_agent_run_id: Option<String>,
    status: String,
    terminal_source: Option<String>,
    fallback_summary: Option<String>,
    fallback_summary_digest: Option<String>,
    fallback_summary_original_bytes: Option<i64>,
    fallback_summary_truncated: bool,
    error_code: Option<String>,
    terminal_resolution_source: Option<String>,
    terminal_reason_code: Option<String>,
}

#[derive(Debug)]
struct BoundedSnapshot {
    body: String,
    digest: String,
    original_bytes: usize,
    truncated: bool,
}

fn bounded_snapshot<const MAX_BYTES: usize>(value: &str) -> BoundedSnapshot {
    let original_bytes = value.len();
    let body = if original_bytes <= MAX_BYTES {
        value.to_string()
    } else {
        let end = value
            .char_indices()
            .map(|(index, character)| index + character.len_utf8())
            .take_while(|end| *end <= MAX_BYTES)
            .last()
            .unwrap_or(0);
        value[..end].to_string()
    };
    BoundedSnapshot {
        body,
        digest: format!("sha256:{:x}", Sha256::digest(value.as_bytes())),
        original_bytes,
        truncated: original_bytes > MAX_BYTES,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_snapshots_never_split_a_unicode_scalar() {
        let snapshot = bounded_snapshot::<5>("甲乙ab");
        assert_eq!(snapshot.body, "甲");
        assert_eq!(snapshot.original_bytes, 8);
        assert!(snapshot.truncated);
    }
}
