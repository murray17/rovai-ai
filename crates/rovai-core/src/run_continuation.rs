//! Explicit User authorization for a new Run, queued through the ordinary Delivery lane.
use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    db::Database,
    delivery_queue::enqueue_message_if_absent,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContinueAgentRunCommand {
    #[serde(
        rename = "threadId",
        alias = "campId",
        deserialize_with = "crate::camp_id::deserialize_camp_id_string"
    )]
    pub camp_id: String,
    pub agent_run_id: String,
    #[serde(default)]
    pub use_new_session: bool,
}
impl sealed::Sealed for ContinueAgentRunCommand {}
impl DomainCommand for ContinueAgentRunCommand {
    const TYPE: &'static str = "agent_run.continue";
}

/// Returns the original member when every frozen input still matches.
pub(crate) fn eligible_source(
    connection: &Connection,
    camp_id: &str,
    run_id: &str,
) -> Result<Option<String>> {
    let mut statement = connection.prepare_cached(
        "SELECT conversation.agent_id
         FROM agent_run AS run
         JOIN conversation ON conversation.id=run.conversation_id
         JOIN camp ON camp.id=run.camp_id
         JOIN camp_member AS member ON member.camp_id=run.camp_id AND member.agent_id=conversation.agent_id
         JOIN agent_profile AS profile ON profile.id=conversation.agent_id
         WHERE run.id=?1 AND run.camp_id=?2 AND conversation.camp_id=?2
           AND conversation.kind='camp_member' AND run.invocation_kind='batch'
           AND run.status IN ('failed','cancelled') AND camp.deletion_operation_id IS NULL AND camp.archived_at IS NULL
           AND member.status='active' AND member.leave_requested_at IS NULL AND profile.profile_status='present'
           AND NOT EXISTS(SELECT 1 FROM mission WHERE mission.camp_id=run.camp_id AND mission.status='completed')
           AND EXISTS(SELECT 1 FROM agent_run_input WHERE agent_run_id=run.id)
           AND NOT EXISTS(SELECT 1 FROM agent_run_input AS input
               LEFT JOIN camp_message AS message ON message.id=input.message_id
               WHERE input.agent_run_id=run.id AND (message.camp_id IS NOT ?2
                   OR message.tombstoned_at IS NOT NULL OR message.recall_state='withdrawn'
                   OR message.content_digest<>input.message_content_digest
                   OR message.content_revision<>input.message_content_revision))",
    )?;
    Ok(statement
        .query_row(params![run_id, camp_id], |row| row.get(0))
        .optional()?)
}

/// A session-start fallback is only part of a fresh authorized execution. It
/// must never turn a relaunch after possible input acceptance into a replay.
pub(crate) fn can_replace_session_before_dispatch(
    connection: &Connection,
    run_id: &str,
    execution_epoch: i64,
) -> Result<bool> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM agent_run AS run
         WHERE run.id=?1 AND run.execution_epoch=?2 AND run.status IN ('running','waiting')
           AND run.cancel_requested_at IS NULL
           AND run.runtime_recovery_required=0
           AND NOT EXISTS(SELECT 1 FROM runtime_input_delivery AS delivery
               WHERE delivery.agent_run_id=run.id
                 AND (delivery.status IN ('accepted','delivery_unknown')
                   OR delivery.dispatch_started_at IS NOT NULL)))",
        params![run_id, execution_epoch],
        |row| row.get(0),
    )?)
}

pub fn continue_agent_run(
    database: &mut Database,
    envelope: &CommandEnvelope<ContinueAgentRunCommand>,
) -> Result<CommandExecution> {
    DomainCommandGateway.execute(database, envelope, |tx| {
        if !matches!(envelope.actor, ActorRef::User { .. }) {
            return Ok(rejected(
                "agent_run.continue_user_required",
                "Only a User can continue an execution",
            ));
        }
        let command = &envelope.payload;
        if envelope.camp_id.as_deref() != Some(command.camp_id.as_str()) {
            return Ok(rejected("agent_run.camp_mismatch", "AgentRun is outside this Thread"));
        }
        let Some(recipient) = eligible_source(tx, &command.camp_id, &command.agent_run_id)? else {
            return Ok(rejected(
                "agent_run.continuation_unavailable",
                "This execution no longer has an available input and member scope",
            ));
        };
        let now = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE camp SET version=version+1, updated_at=?2 WHERE id=?1",
            params![command.camp_id, now],
        )?;
        let mut inputs = tx.prepare(
            "SELECT message_id FROM agent_run_input WHERE agent_run_id=?1 ORDER BY ordinal",
        )?;
        let mut delivery_ids = Vec::new();
        for input in inputs.query_map([&command.agent_run_id], |row| row.get::<_, String>(0))? {
            let id = enqueue_message_if_absent(tx, &command.camp_id, &input?, &recipient, &now)?
                .context("Eligible Thread could not enqueue its input")?;
            delivery_ids.push(id);
        }
        Ok(CommandHandlerResult::applied(
            "agent_run.continuation_requested",
            json!({"threadId": command.camp_id, "agentRunId": command.agent_run_id, "deliveryIds": delivery_ids}),
            Some(EntityReference {
                entity_type: "agent_run".into(),
                entity_id: command.agent_run_id.clone(),
            }),
        ))
    })
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({"message":message}))
}
