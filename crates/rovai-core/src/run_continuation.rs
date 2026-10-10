//! Explicit User authorization for a new Run, queued through the ordinary Delivery lane.
use anyhow::Result;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, sealed,
    },
    db::Database,
    delivery_queue::enqueue_continuation_delivery,
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

pub(crate) struct ContinuationSource {
    pub conversation_id: String,
    pub agent_id: String,
}

/// Technical, current-fact admission only. No natural-language responsibility judgment.
pub(crate) fn eligible_source(
    connection: &Connection,
    camp_id: &str,
    run_id: &str,
) -> Result<Option<ContinuationSource>> {
    // Batch Runs have no single Task. Inspect the original business messages,
    // including when their Delivery belongs to a previous continuation request.
    Ok(connection.query_row(
        &format!("SELECT conversation.id, conversation.agent_id
         FROM agent_run AS run
         JOIN conversation ON conversation.id=run.conversation_id
         JOIN camp ON camp.id=run.camp_id
         JOIN camp_member AS member ON member.camp_id=run.camp_id AND member.agent_id=conversation.agent_id
         JOIN agent_profile AS profile ON profile.id=conversation.agent_id
         WHERE run.id=?1 AND run.camp_id=?2 AND conversation.camp_id=?2
           AND conversation.kind='camp_member' AND run.invocation_kind='batch'
           AND run.status IN ('failed','cancelled') AND camp.deletion_operation_id IS NULL
           AND member.status='active' AND member.leave_requested_at IS NULL AND profile.profile_status='present'
           AND NOT EXISTS(SELECT 1 FROM agent_run_input AS input
               JOIN event_log AS publication ON publication.entity_type='camp_message'
                 AND publication.entity_id=input.message_id AND publication.camp_id=?2
                 AND {}
               WHERE input.agent_run_id=run.id
                 AND json_extract(publication.payload_json,'$.taskId') IS NOT NULL
                 AND NOT EXISTS(SELECT 1 FROM task
                     WHERE task.id=json_extract(publication.payload_json,'$.taskId') AND task.camp_id=?2
                       AND task.status NOT IN ('cancelled','completed')
                       AND task.assignee_agent_id=conversation.agent_id))
           AND NOT EXISTS(SELECT 1 FROM mission WHERE mission.camp_id=run.camp_id AND mission.status='completed')
           AND EXISTS(SELECT 1 FROM agent_run_input WHERE agent_run_id=run.id)
           AND NOT EXISTS(SELECT 1 FROM agent_run_input AS input
               LEFT JOIN camp_message AS message ON message.id=input.message_id
               WHERE input.agent_run_id=run.id AND (message.id IS NULL OR message.camp_id<>?2
                   OR message.tombstoned_at IS NOT NULL OR message.recall_state='withdrawn'
                   OR message.content_digest<>input.message_content_digest))",
            crate::camp_message_publication::public_camp_message_event_predicate("publication.event_type")),
        params![run_id, camp_id],
        |row| Ok(ContinuationSource { conversation_id: row.get(0)?, agent_id: row.get(1)? }),
    ).optional()?)
}

/// Only an unresolved dispatched native turn requires preemptive rotation.
/// Compatibility and actual resume failures belong to the ordinary Runtime path.
pub(crate) fn has_unresolved_native_turn(
    connection: &Connection,
    conversation_id: &str,
) -> Result<bool> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM runtime_input_delivery AS delivery
         JOIN agent_run AS run ON run.id=delivery.agent_run_id
         JOIN conversation AS current ON current.id=run.conversation_id
         WHERE current.id=?1 AND run.status IN ('failed','cancelled')
           AND COALESCE(run.terminal_resolution_source,'')<>'runtime_terminal'
           AND (delivery.status IN ('accepted','delivery_unknown')
             OR (delivery.status='prepared' AND delivery.dispatch_started_at IS NOT NULL))
           AND (current.native_session_id IS NULL OR current.native_binding_id IS NULL
             OR delivery.native_binding_id=current.native_binding_id)
           AND NOT EXISTS (
             SELECT 1 FROM event_log AS terminal
             JOIN event_log AS completed ON completed.global_sequence>terminal.global_sequence
             JOIN agent_run AS recovered ON completed.entity_type='agent_run' AND completed.entity_id=recovered.id
             JOIN runtime_input_delivery AS accepted ON accepted.agent_run_id=recovered.id
               AND accepted.execution_epoch=completed.execution_epoch
             WHERE terminal.entity_type='agent_run' AND terminal.entity_id=run.id
               AND terminal.execution_epoch=delivery.execution_epoch
               AND terminal.event_type IN ('agent_run.failed','agent_run.cancelled')
               AND completed.event_type IN ('agent_run.succeeded','agent_run.failed')
               AND recovered.conversation_id=current.id AND recovered.status IN ('succeeded','failed')
               AND recovered.execution_epoch=completed.execution_epoch
               AND COALESCE(recovered.last_error_code,'') NOT IN (
                 'runtime_session_unavailable','runtime_session_incompatible','runtime_stream_incompatible',
                 'runtime_failed_after_input_accepted','runtime_missing_final_result','runtime_missing_final_output')
               AND recovered.terminal_resolution_source='runtime_terminal'
               AND accepted.status='accepted' AND accepted.native_binding_id=current.native_binding_id
               AND accepted.native_binding_generation=current.native_binding_generation
               AND accepted.native_input_id=json_extract(completed.payload_json,'$.nativeTurnId')
           ))",
        [conversation_id],
        |row| row.get(0),
    )?)
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
         JOIN agent_run_input AS input ON input.agent_run_id=run.id
         JOIN camp_run_continuation ON camp_run_continuation.delivery_id=input.delivery_id
         WHERE run.id=?1 AND run.execution_epoch=?2 AND run.status IN ('running','waiting')
           AND run.cancel_requested_at IS NULL
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
            return Ok(rejected("agent_run.continue_user_required", "Only a User can continue an execution"));
        }
        let command=&envelope.payload;
        if envelope.camp_id.as_deref()!=Some(command.camp_id.as_str()) {
            return Ok(rejected("agent_run.camp_mismatch", "AgentRun is outside this Thread"));
        }
        let Some(source)=eligible_source(tx, &command.camp_id, &command.agent_run_id)? else {
            return Ok(rejected("agent_run.continuation_unavailable", "This execution no longer has an available input and member scope"));
        };
        let now=chrono::Utc::now().to_rfc3339();
        tx.execute("UPDATE camp SET version=version+1,updated_at=?2 WHERE id=?1",params![command.camp_id,now])?;
        let delivery=enqueue_continuation_delivery(tx,&command.camp_id,source.agent_id,&now)?;
        tx.execute("INSERT INTO camp_run_continuation(delivery_id,source_agent_run_id,use_new_session) VALUES(?1,?2,?3)",
            params![delivery.delivery_id,command.agent_run_id,command.use_new_session])?;
        Ok(CommandHandlerResult::applied("agent_run.continuation_requested",
            json!({"threadId":command.camp_id,"deliveryId":delivery.delivery_id}),
            Some(EntityReference { entity_type:"camp_message_delivery".into(),entity_id:delivery.delivery_id })))
    })
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({"message":message}))
}

/// Called only after the normal lane and execution-root cleanup gates pass.
pub(crate) fn clear_native_session(
    tx: &Transaction<'_>,
    conversation_id: &str,
    now: &str,
) -> Result<()> {
    tx.execute("UPDATE conversation SET native_adapter_installation_id=NULL,native_session_id=NULL,
        native_binding_compatibility_digest=NULL,native_installation_generation=NULL,native_session_compatibility_key=NULL,
        native_binding_id=NULL,native_binding_secret_digest=NULL,native_charter_digest=NULL,native_collaboration_state_digest=NULL,
        version=version+1,updated_at=?2 WHERE id=?1",params![conversation_id,now])?;
    Ok(())
}
