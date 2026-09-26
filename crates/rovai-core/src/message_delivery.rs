use std::collections::HashSet;

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    agent_identity::parse_agent_id,
    agent_profile::resolve_frozen_runtime,
    camp_content::{
        AGENT_PRINCIPAL_DISPLAY_NAME, StructuredCampMessageSegment, canonical_content_digest,
        normalize_content, render_current_plain_text,
    },
    collaboration::{append_domain_event, build_effective_config},
    command::{ActorRef, CommandHandlerResult, EntityReference, canonical_json_digest},
    context::{
        ContextService, DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES, DeliveryContextPreview,
        FrozenDeliveryContext, charter_delivery_mode_for_adapter,
    },
    context_index::index_camp_message,
    current_user::CURRENT_USER_ID,
    db::Database,
    delivery_queue::enqueue_message_deliveries,
    local_attachment_source::{
        LocalAttachmentSourceRef, reuse_camp_source_attachment_ids, serialize_source_attachments,
    },
    runtime::AgentRunWorkspace,
    runtime_basis::capture_run_runtime_basis,
};

pub const CAMP_MESSAGE_SEND_TOOL_NAME: &str = "camp.message.send";
pub const CAMP_MESSAGE_SEND_MAX_BODY_BYTES: usize = 32 * 1024;
pub const CAMP_MESSAGE_SEND_MAX_FANOUT: usize = 16;
pub const MESSAGE_DELIVERY_MAX_A2A_DEPTH: i64 = 5;

// Message Delivery's persisted wait-condition vocabulary predates Channel
// roster synchronization. Keep the durable schema stable and distinguish this
// Host-owned readiness fence by its structured blocker code.
const TOPIC_ROSTER_WAIT_CONDITION: &str = "runtime_unavailable";
const TOPIC_ROSTER_SYNC_BLOCKER_CODE: &str = "channel_roster_sync_required";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentAddressingMode {
    #[default]
    Automatic,
    PublicOnly,
}

impl AgentAddressingMode {
    pub fn from_public_only(public_only: bool) -> Self {
        if public_only {
            Self::PublicOnly
        } else {
            Self::Automatic
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Automatic => "automatic",
            Self::PublicOnly => "public_only",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryDispatchTrigger {
    Accepted,
    TargetRunEnded,
    RuntimeReady,
    CapacityReleased,
}

impl DeliveryDispatchTrigger {
    fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::TargetRunEnded => "target_run_ended",
            Self::RuntimeReady => "runtime_ready",
            Self::CapacityReleased => "capacity_released",
        }
    }

    fn expected_wait_condition(self) -> Option<&'static str> {
        match self {
            Self::Accepted => None,
            Self::TargetRunEnded => Some("target_busy"),
            Self::RuntimeReady => Some("runtime_unavailable"),
            Self::CapacityReleased => Some("capacity_unavailable"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeliveryDispatchOutcome {
    Materialized {
        agent_run_id: String,
    },
    Waiting {
        condition: String,
    },
    Terminal {
        status: String,
        failure_code: String,
    },
    NotDispatchable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SettledDelivery {
    pub delivery_id: String,
    pub camp_id: String,
    pub recipient_agent_id: String,
    pub status: String,
}

#[derive(Debug)]
struct DispatchDelivery {
    id: String,
    camp_id: String,
    camp_turn_id: String,
    message_id: String,
    camp_message_boundary_sequence: i64,
    recipient_agent_id: String,
    recipient_membership_version_at_admission: i64,
    task_id: Option<String>,
    assignee_agent_id_at_admission: Option<String>,
    source_agent_run_id: String,
    delivery_kind: String,
    completion_role: String,
    gather_id: Option<String>,
    edge_kind: Option<String>,
    target_parent_agent_run_id: Option<String>,
    return_to_agent_run_id: Option<String>,
    a2a_root_agent_run_id: Option<String>,
    a2a_depth: i64,
    retry_generation: i64,
    failure_detail_json: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TopicRosterRefreshRequest {
    pub provider: String,
    pub tenant_key: String,
    pub chat_id: String,
    pub required_roster_generation: i64,
}

/// The v1.60 public Agent message contract. A send publishes exactly one Camp
/// message and, when it has Agent recipients, appends ordinary waiting
/// Deliveries. It deliberately carries no CampTurn, lineage, depth or budget
/// identity: those concepts no longer participate in admission or batching.
#[derive(Debug, Clone)]
pub struct SendQueuedAgentMessage<'a> {
    pub command_id: &'a str,
    pub camp_id: &'a str,
    pub source_agent_run_id: &'a str,
    pub author_agent_id: &'a str,
    pub execution_epoch: i64,
    pub body: &'a str,
    pub explicit_recipients: &'a [String],
    pub agent_addressing_mode: AgentAddressingMode,
    pub mention_user: bool,
    pub task_id: Option<&'a str>,
    pub source_files: &'a [LocalAttachmentSourceRef],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AddressingOffender {
    source: &'static str,
    value: String,
    reason: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct InlineAddressing {
    occurrences: Vec<InlineAddressingOccurrence>,
    principal_occurrences: Vec<std::ops::Range<usize>>,
    malformed: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct InlineAddressingOccurrence {
    agent_id: String,
    start_byte: usize,
    end_byte: usize,
    ordinal: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LineLeadingMentionClusterPosition {
    Outside,
    First,
    Continuation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ActiveCampAgent {
    agent_id: String,
    display_name: String,
}

pub fn persist_queued_agent_message(
    transaction: &Transaction<'_>,
    request: &SendQueuedAgentMessage<'_>,
) -> Result<CommandHandlerResult> {
    if request.agent_addressing_mode == AgentAddressingMode::PublicOnly {
        let mut conflicting_fields = Vec::new();
        if !request.explicit_recipients.is_empty() {
            conflicting_fields.push("to");
        }
        if request.task_id.is_some() {
            conflicting_fields.push("taskId");
        }
        if !conflicting_fields.is_empty() {
            return Ok(rejected_with_details(
                "message.public_only_conflict",
                "--public-only cannot be combined with Agent-routing inputs.",
                json!({
                    "conflictingFields": conflicting_fields,
                    "newRequestIdRequired": true,
                }),
            ));
        }
    }

    let automatic_addressing = request.agent_addressing_mode == AgentAddressingMode::Automatic;
    // PublicOnly still recognizes Principal in a mixed leading mention cluster;
    // member identities participate in parsing, never in routing in that mode.
    let active_agents = load_active_camp_agents(transaction, request.camp_id)?;
    let active_agent_ids = active_agents
        .iter()
        .map(|agent| agent.agent_id.clone())
        .collect::<HashSet<_>>();
    let mut inline = parse_inline_addressing(request.body, &active_agents);
    if !automatic_addressing {
        inline.occurrences.clear();
        inline.malformed.clear();
    }
    let explicit_order = if automatic_addressing {
        stable_unique(
            request
                .explicit_recipients
                .iter()
                .map(|recipient| recipient.trim().to_string()),
        )
    } else {
        Vec::new()
    };
    let inline_order = stable_unique(
        inline
            .occurrences
            .iter()
            .map(|occurrence| occurrence.agent_id.clone()),
    );
    let mut offenders = inline
        .malformed
        .iter()
        .cloned()
        .map(|value| AddressingOffender {
            source: "inline",
            value,
            reason: "invalid_format",
        })
        .collect::<Vec<_>>();
    for value in &explicit_order {
        if parse_agent_id(value).is_none() {
            offenders.push(AddressingOffender {
                source: "--to",
                value: value.clone(),
                reason: "invalid_format",
            });
        }
    }
    let mut candidate_sources = Vec::new();
    candidate_sources.extend(
        explicit_order
            .iter()
            .filter(|value| parse_agent_id(value).is_some())
            .cloned()
            .map(|value| ("--to", value)),
    );
    candidate_sources.extend(inline_order.iter().cloned().map(|value| ("inline", value)));
    for (source, value) in &candidate_sources {
        let reason = if value == request.author_agent_id {
            Some("self_target")
        } else if !active_agent_ids.contains(value) {
            Some("not_current_camp_member")
        } else {
            None
        };
        if let Some(reason) = reason {
            offenders.push(AddressingOffender {
                source,
                value: value.clone(),
                reason,
            });
        }
    }
    offenders.sort_by(|left, right| {
        (&left.source, left.value.as_bytes(), &left.reason).cmp(&(
            &right.source,
            right.value.as_bytes(),
            &right.reason,
        ))
    });
    offenders.dedup();
    if !offenders.is_empty() {
        return Ok(rejected_with_details(
            "message.addressing_invalid",
            "One or more recipients are invalid; fix every reported item and resend with a new requestId",
            json!({
                "offending": offenders,
                "newRequestIdRequired": true,
            }),
        ));
    }

    let mut effective_recipients = candidate_sources
        .iter()
        .map(|(_, value)| value.clone())
        .collect::<Vec<_>>();
    effective_recipients.sort_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
    effective_recipients.dedup();
    if request.task_id.is_some() && effective_recipients.len() != 1 {
        return Ok(rejected_with_details(
            "message.task_recipient_ambiguous",
            "taskId requires exactly one effective recipient",
            json!({
                "recipientCount": effective_recipients.len(),
                "newRequestIdRequired": true,
            }),
        ));
    }
    if let (Some(task_id), Some(recipient_agent_id)) =
        (request.task_id, effective_recipients.first())
        && !crate::collaboration::task_link_admission(
            transaction,
            task_id,
            request.camp_id,
            recipient_agent_id,
        )?
    {
        return Ok(rejected_with_details(
            "message.invalid_task",
            "taskId must identify a non-terminal Task assigned to the sole recipient in this Camp",
            json!({"newRequestIdRequired": true}),
        ));
    }

    let anchor_message_id =
        load_run_reply_anchor(transaction, request.source_agent_run_id, request.camp_id)?;
    let source_files =
        reuse_camp_source_attachment_ids(transaction, request.camp_id, request.source_files)?;
    let now = chrono::Utc::now().to_rfc3339();
    transaction.execute(
        r#"
        UPDATE camp
        SET last_message_sequence = last_message_sequence + 1,
            version = version + 1, updated_at = ?2
        WHERE id = ?1
        "#,
        params![request.camp_id, now],
    )?;
    let camp_sequence: i64 = transaction.query_row(
        "SELECT last_message_sequence FROM camp WHERE id = ?1",
        [request.camp_id],
        |row| row.get(0),
    )?;
    let message_id = Uuid::new_v4().to_string();
    let content = structured_content_from_inline_addressing(
        request.body,
        &inline.occurrences,
        &inline.principal_occurrences,
        request.mention_user,
    );
    let projected_body = render_current_plain_text(transaction, &content)?;
    let structured_content_json = serde_json::to_string(&content)?;
    let content_digest = canonical_content_digest(&content)?;
    let recipients_json = serde_json::to_string(&effective_recipients)?;
    let recipient_set_digest = format!(
        "sha256:{}",
        canonical_json_digest(&serde_json::to_value(&effective_recipients)?)?
    );
    let footer_recipients = explicit_order
        .iter()
        .filter(|recipient| !inline_order.contains(recipient))
        .cloned()
        .collect::<Vec<_>>();
    let recipient_presentation = json!({
        "inlineOrder": inline_order,
        "inlineOccurrences": inline.occurrences,
        "explicitOrder": explicit_order,
        "footerRecipients": footer_recipients,
    });
    let address_mode = if effective_recipients.is_empty() {
        "default"
    } else {
        "explicit"
    };
    transaction.execute(
        r#"
        INSERT INTO camp_message(
            id, camp_id, sequence,
            author_type, author_id, source_agent_run_id, body,
            structured_content_json, content_digest,
            source_attachments_json,
            address_mode, addressed_agent_ids_json,
            reply_to_camp_message_id, camp_turn_id, agent_run_id,
            tombstoned_at, version, created_at, updated_at,
            effective_recipient_ids_json, recipient_set_digest,
            recipient_presentation_json, source_operation_id,
            agent_addressing_mode, origin_kind, recall_state
        ) VALUES (
            ?1, ?2, ?3, 'agent', ?4, ?5, ?6, ?7, ?8, ?9,
            ?10, ?11, ?12, NULL, ?5,
            NULL, 1, ?13, ?13, ?11, ?14, ?15, ?16, ?17,
            'agent', 'ineligible'
        )
        "#,
        params![
            message_id,
            request.camp_id,
            camp_sequence,
            request.author_agent_id,
            request.source_agent_run_id,
            projected_body,
            structured_content_json,
            content_digest,
            serialize_source_attachments(&source_files)?,
            address_mode,
            recipients_json,
            anchor_message_id,
            now,
            recipient_set_digest,
            serde_json::to_string(&recipient_presentation)?,
            request.command_id,
            request.agent_addressing_mode.as_str(),
        ],
    )?;
    index_camp_message(
        transaction,
        &message_id,
        request.camp_id,
        &projected_body,
        &recipients_json,
    )?;
    crate::channel::enqueue_bound_camp_agent_message(
        transaction,
        request.camp_id,
        &message_id,
        request.author_agent_id,
        &projected_body,
        &content,
        &now,
    )?;
    let deliveries = enqueue_message_deliveries(
        transaction,
        request.camp_id,
        &message_id,
        camp_sequence,
        &effective_recipients,
        &now,
    )?;
    let delivery_ids = deliveries
        .iter()
        .map(|delivery| delivery.delivery_id.clone())
        .collect::<Vec<_>>();
    let actor = ActorRef::Agent {
        agent_id: request.author_agent_id.to_string(),
        source_agent_run_id: request.source_agent_run_id.to_string(),
    };
    append_domain_event(
        transaction,
        "camp_message.sent",
        Some(request.camp_id),
        Some(("camp_message", &message_id)),
        &actor,
        Some(request.execution_epoch),
        &json!({
            "sequence": camp_sequence,
            "addressSource": "agent_send",
            "addressedAgentIds": effective_recipients,
            "deliveryIds": delivery_ids,
            "sourceAgentRunId": request.source_agent_run_id,
            "anchorMessageId": anchor_message_id,
            "taskId": request.task_id,
        }),
    )?;
    for delivery in &deliveries {
        append_domain_event(
            transaction,
            "camp_message_delivery.waiting",
            Some(request.camp_id),
            Some(("camp_message_delivery", &delivery.delivery_id)),
            &actor,
            Some(request.execution_epoch),
            &json!({
                "messageId": message_id,
                "recipientAgentId": delivery.recipient_agent_id,
                "queueSequence": camp_sequence,
            }),
        )?;
    }

    Ok(CommandHandlerResult::accepted(
        "camp_message.send_accepted",
        json!({
            "status": "accepted",
            "messageId": message_id,
            "visibility": "camp_public",
            "anchorMessageId": anchor_message_id,
            "agentAddressingMode": request.agent_addressing_mode,
            "effectiveRecipients": effective_recipients,
            "recipientPresentation": recipient_presentation,
            "recipientSetDigest": recipient_set_digest,
            "deliveryIds": delivery_ids,
            "attachments": source_files.iter().map(|source| json!({
                "attachmentId": source.id, "path": source.source_path,
            })).collect::<Vec<_>>(),
        }),
        Some(EntityReference {
            entity_type: "camp_message".to_string(),
            entity_id: message_id,
        }),
    ))
}

pub fn dispatch_accepted_deliveries(
    database: &mut Database,
    delivery_ids: &[String],
) -> Result<Vec<DeliveryDispatchOutcome>> {
    delivery_ids
        .iter()
        .map(|delivery_id| {
            dispatch_delivery(
                database,
                delivery_id,
                DeliveryDispatchTrigger::Accepted,
                true,
            )
        })
        .collect()
}

/// A clean startup boundary only closes Delivery rows for which no durable attempt
/// fence exists. It deliberately does not enqueue or dispatch anything.
pub fn mark_unstarted_deliveries_interrupted_before_dispatch(
    database: &mut Database,
) -> Result<usize> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let now = chrono::Utc::now().to_rfc3339();
    let delivery_ids = {
        let mut statement = transaction.prepare(
            r#"
            SELECT id
            FROM message_delivery
            WHERE status = 'pending'
              AND dispatch_phase = 'never_attempted'
              AND dispatch_attempt_count = 0
            ORDER BY created_at, id
            "#,
        )?;
        statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for delivery_id in &delivery_ids {
        transaction.execute(
            r#"
            UPDATE message_delivery
            SET status = 'interrupted_before_dispatch', dispatch_phase = 'terminal',
                manual_intervention_required = 1,
                failure_code = 'interrupted_before_dispatch',
                failure_detail_json = ?2,
                version = version + 1, updated_at = ?3, ended_at = ?3
            WHERE id = ?1 AND status = 'pending'
              AND dispatch_phase = 'never_attempted'
              AND dispatch_attempt_count = 0
            "#,
            params![
                delivery_id,
                serde_json::to_string(&json!({
                    "manualInterventionRequired": true,
                    "message": "该协作因上次运行中断而未开始",
                }))?,
                now,
            ],
        )?;
        let actor = ActorRef::System {
            component_id: "message-delivery-startup-recovery".to_string(),
        };
        append_domain_event(
            &transaction,
            "message_delivery.interrupted_before_dispatch",
            None,
            Some(("message_delivery", delivery_id)),
            &actor,
            None,
            &json!({
                "deliveryId": delivery_id,
                "manualInterventionRequired": true,
            }),
        )?;
    }
    transaction.commit()?;
    Ok(delivery_ids.len())
}

pub(crate) fn settle_attachment_projection_failure(
    transaction: &Transaction<'_>,
    operation_id: &str,
    failure_code: &str,
    now: &str,
) -> Result<Vec<(String, String)>> {
    let deliveries = {
        let mut statement = transaction.prepare(
            r#"
            SELECT id, camp_id, recipient_agent_id
            FROM message_delivery
            WHERE projection_operation_id = ?1
              AND status = 'pending'
              AND dispatch_phase = 'projection_blocked'
              AND pre_dispatch_gate = 'attachment_projection'
              AND dispatch_attempt_count = 0
            ORDER BY recipient_agent_id, queue_sequence, id
            "#,
        )?;
        statement
            .query_map([operation_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let actor = ActorRef::System {
        component_id: "camp-attachment-publication".to_string(),
    };
    for (delivery_id, camp_id, _) in &deliveries {
        let changed = transaction.execute(
            r#"
            UPDATE message_delivery
            SET status = 'failed', dispatch_phase = 'terminal',
                pre_dispatch_gate = NULL,
                manual_intervention_required = 0,
                failure_code = 'attachment_projection_failed',
                failure_detail_json = ?2,
                version = version + 1, updated_at = ?3, ended_at = ?3
            WHERE id = ?1 AND status = 'pending'
              AND dispatch_phase = 'projection_blocked'
              AND pre_dispatch_gate = 'attachment_projection'
              AND dispatch_attempt_count = 0
            "#,
            params![
                delivery_id,
                serde_json::to_string(&json!({
                    "projectionOperationId": operation_id,
                    "failureCode": failure_code,
                }))?,
                now,
            ],
        )?;
        if changed != 1 {
            anyhow::bail!("message_delivery_projection_gate_conflict");
        }
        append_domain_event(
            transaction,
            "message_delivery.terminal",
            Some(camp_id),
            Some(("message_delivery", delivery_id)),
            &actor,
            None,
            &json!({
                "status": "failed",
                "failureCode": "attachment_projection_failed",
                "projectionFailureCode": failure_code,
                "projectionOperationId": operation_id,
            }),
        )?;
    }
    Ok(deliveries
        .into_iter()
        .map(|(_, camp_id, recipient_agent_id)| (camp_id, recipient_agent_id))
        .collect())
}

pub fn dispatch_pending_for_recipient(
    database: &mut Database,
    camp_id: &str,
    recipient_agent_id: &str,
    trigger: DeliveryDispatchTrigger,
    recipient_capacity_available: bool,
) -> Result<Vec<DeliveryDispatchOutcome>> {
    let Some(expected_wait_condition) = trigger.expected_wait_condition() else {
        anyhow::bail!("recipient-scoped pump requires a condition-specific trigger");
    };
    let delivery_ids = {
        let mut statement = database.connection().prepare(
            r#"
            SELECT id
            FROM message_delivery
            WHERE camp_id = ?1 AND recipient_agent_id = ?2
              AND status = 'pending'
              AND dispatch_phase = 'attempted_waiting'
              AND wait_condition = ?3
            ORDER BY queue_sequence, created_at, id
            "#,
        )?;
        statement
            .query_map(
                params![camp_id, recipient_agent_id, expected_wait_condition],
                |row| row.get::<_, String>(0),
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    delivery_ids
        .iter()
        .map(|delivery_id| {
            dispatch_delivery(database, delivery_id, trigger, recipient_capacity_available)
        })
        .collect()
}

pub fn runtime_waiting_recipients(
    database: &Database,
    runtime_adapter_kind: &str,
) -> Result<Vec<(String, String)>> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT DISTINCT delivery.camp_id, delivery.recipient_agent_id
        FROM message_delivery AS delivery
        JOIN agent_profile AS profile ON profile.id = delivery.recipient_agent_id
        WHERE profile.selected_runtime_adapter_kind = ?1
          AND delivery.status = 'pending'
          AND delivery.dispatch_phase = 'attempted_waiting'
          AND delivery.wait_condition = 'runtime_unavailable'
        ORDER BY delivery.camp_id, delivery.recipient_agent_id
        "#,
    )?;
    Ok(statement
        .query_map([runtime_adapter_kind], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn runtime_waiting_camps(database: &Database, recipient_agent_id: &str) -> Result<Vec<String>> {
    let mut statement = database.connection().prepare(
        r#"
        SELECT DISTINCT camp_id
        FROM message_delivery
        WHERE recipient_agent_id = ?1
          AND status = 'pending'
          AND dispatch_phase = 'attempted_waiting'
          AND wait_condition = 'runtime_unavailable'
        ORDER BY camp_id
        "#,
    )?;
    Ok(statement
        .query_map([recipient_agent_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn dispatch_delivery(
    database: &mut Database,
    delivery_id: &str,
    trigger: DeliveryDispatchTrigger,
    recipient_capacity_available: bool,
) -> Result<DeliveryDispatchOutcome> {
    let Some(attempt_id) = establish_dispatch_attempt(database, delivery_id, trigger)? else {
        return Ok(DeliveryDispatchOutcome::NotDispatchable);
    };
    let outcome = process_dispatch_attempt(
        database,
        delivery_id,
        &attempt_id,
        recipient_capacity_available,
    )?;
    Ok(outcome)
}

pub(crate) struct AgentRunDeliverySettlement<'a> {
    pub agent_run_id: &'a str,
    pub agent_run_status: &'a str,
    pub agent_run_error_code: Option<&'a str>,
    pub terminal_resolution_source: Option<&'a str>,
    pub terminal_reason_code: Option<&'a str>,
    pub actor: &'a ActorRef,
    pub execution_epoch: Option<i64>,
    pub now: &'a str,
}

pub(crate) fn settle_materialized_delivery_for_agent_run(
    transaction: &Transaction<'_>,
    settlement: AgentRunDeliverySettlement<'_>,
) -> Result<Option<SettledDelivery>> {
    let AgentRunDeliverySettlement {
        agent_run_id,
        agent_run_status,
        agent_run_error_code,
        terminal_resolution_source,
        terminal_reason_code,
        actor,
        execution_epoch,
        now,
    } = settlement;
    let delivery = transaction
        .query_row(
            r#"
            SELECT id, camp_id, recipient_agent_id
            FROM message_delivery
            WHERE target_agent_run_id = ?1 AND status = 'running'
              AND dispatch_phase = 'materialized'
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
    let Some((delivery_id, camp_id, recipient_agent_id)) = delivery else {
        return Ok(None);
    };
    let (delivery_status, failure_code, manual_intervention_required) =
        delivery_terminal_semantics(agent_run_status, terminal_reason_code)?;
    let failure_detail = (delivery_status != "settled"
        && (agent_run_error_code.is_some()
            || terminal_resolution_source.is_some()
            || terminal_reason_code.is_some()))
    .then(|| {
        serde_json::to_string(&json!({
            "agentRunErrorCode": agent_run_error_code,
            "terminalResolutionSource": terminal_resolution_source,
            "terminalReasonCode": terminal_reason_code,
        }))
    })
    .transpose()?;
    let updated = transaction.execute(
        r#"
        UPDATE message_delivery
        SET status = ?2, dispatch_phase = 'terminal', wait_condition = NULL,
            active_dispatch_attempt_id = NULL,
            manual_intervention_required = ?3,
            failure_code = ?4, failure_detail_json = ?5,
            version = version + 1, updated_at = ?6, ended_at = ?6
        WHERE id = ?1 AND status = 'running'
          AND dispatch_phase = 'materialized'
          AND target_agent_run_id = ?7
        "#,
        params![
            delivery_id,
            delivery_status,
            manual_intervention_required,
            failure_code,
            failure_detail,
            now,
            agent_run_id,
        ],
    )?;
    if updated != 1 {
        anyhow::bail!("Message Delivery changed before AgentRun terminal settlement");
    }
    append_domain_event(
        transaction,
        &format!("message_delivery.{delivery_status}"),
        Some(&camp_id),
        Some(("message_delivery", &delivery_id)),
        actor,
        execution_epoch,
        &json!({
            "deliveryId": delivery_id,
            "targetAgentRunId": agent_run_id,
            "recipientAgentId": recipient_agent_id,
            "status": delivery_status,
            "failureCode": failure_code,
            "agentRunErrorCode": agent_run_error_code,
            "terminalResolutionSource": terminal_resolution_source,
            "terminalReasonCode": terminal_reason_code,
        }),
    )?;
    Ok(Some(SettledDelivery {
        delivery_id,
        camp_id,
        recipient_agent_id,
        status: delivery_status.to_string(),
    }))
}

fn delivery_terminal_semantics(
    agent_run_status: &str,
    terminal_reason_code: Option<&str>,
) -> Result<(&'static str, Option<&'static str>, i64)> {
    Ok(match agent_run_status {
        "succeeded" => ("settled", None, 0_i64),
        "failed" => ("failed", Some("target_agent_run_failed"), 1_i64),
        "cancelled" if terminal_reason_code == Some("planned_shutdown_cancelled") => (
            "cancelled",
            Some("target_agent_run_planned_shutdown_cancelled"),
            0_i64,
        ),
        "cancelled" => ("cancelled", Some("target_agent_run_cancelled"), 0_i64),
        _ => anyhow::bail!("non-terminal AgentRun cannot settle a Message Delivery"),
    })
}

#[derive(Debug)]
struct DeliveryCancellationTarget {
    id: String,
    camp_id: String,
    camp_turn_id: String,
    status: String,
    dispatch_phase: String,
    dispatch_attempt_count: i64,
    active_dispatch_attempt_id: Option<String>,
    version: i64,
}

fn transition_message_delivery_to_cancelled(
    transaction: &Transaction<'_>,
    target: &DeliveryCancellationTarget,
    failure_code: &str,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<()> {
    if let Some(attempt_id) = target.active_dispatch_attempt_id.as_deref() {
        let changed = transaction.execute(
            r#"
            UPDATE message_delivery_attempt
            SET status = 'cancelled', wait_condition = NULL,
                failure_code = ?3, failure_detail_json = NULL, ended_at = ?4
            WHERE id = ?1 AND delivery_id = ?2 AND status = 'attempting'
            "#,
            params![attempt_id, target.id, failure_code, now],
        )?;
        if changed != 1 {
            anyhow::bail!("active Message Delivery attempt changed before cancellation");
        }
    } else if target.dispatch_phase == "attempted_waiting" {
        let changed = transaction.execute(
            r#"
            UPDATE message_delivery_attempt
            SET status = 'cancelled', wait_condition = NULL,
                failure_code = ?3, failure_detail_json = NULL, ended_at = ?4
            WHERE delivery_id = ?1 AND ordinal = ?2 AND status = 'waiting'
            "#,
            params![target.id, target.dispatch_attempt_count, failure_code, now],
        )?;
        if changed != 1 {
            anyhow::bail!("waiting Message Delivery attempt changed before cancellation");
        }
    }

    let changed = transaction.execute(
        r#"
        UPDATE message_delivery
        SET status = 'cancelled', dispatch_phase = 'terminal',
            wait_condition = NULL, active_dispatch_attempt_id = NULL,
            pre_dispatch_gate = NULL, projection_operation_id = NULL,
            manual_intervention_required = 0,
            failure_code = ?5, failure_detail_json = NULL,
            version = version + 1, updated_at = ?6, ended_at = ?6
        WHERE id = ?1 AND status = ?2 AND dispatch_phase = ?3 AND version = ?4
        "#,
        params![
            target.id,
            target.status,
            target.dispatch_phase,
            target.version,
            failure_code,
            now,
        ],
    )?;
    if changed != 1 {
        anyhow::bail!("Message Delivery changed before cancellation");
    }
    append_domain_event(
        transaction,
        "message_delivery.cancelled",
        Some(&target.camp_id),
        Some(("message_delivery", &target.id)),
        actor,
        execution_epoch,
        &json!({
            "deliveryId": target.id,
            "failureCode": failure_code,
            "campTurnId": target.camp_turn_id,
            "dispatchAttemptCount": target.dispatch_attempt_count,
        }),
    )?;
    Ok(())
}

pub(crate) fn cancel_pending_turn_deliveries(
    transaction: &Transaction<'_>,
    camp_turn_id: &str,
    failure_code: &str,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<usize> {
    let deliveries = {
        let mut statement = transaction.prepare(
            r#"
            SELECT id, camp_id, camp_turn_id, status, dispatch_phase,
                   dispatch_attempt_count, active_dispatch_attempt_id,
                   version
            FROM message_delivery
            WHERE camp_turn_id = ?1 AND status = 'pending'
            ORDER BY created_at, id
            "#,
        )?;
        statement
            .query_map([camp_turn_id], |row| {
                Ok(DeliveryCancellationTarget {
                    id: row.get(0)?,
                    camp_id: row.get(1)?,
                    camp_turn_id: row.get(2)?,
                    status: row.get(3)?,
                    dispatch_phase: row.get(4)?,
                    dispatch_attempt_count: row.get(5)?,
                    active_dispatch_attempt_id: row.get(6)?,
                    version: row.get(7)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for target in &deliveries {
        transition_message_delivery_to_cancelled(
            transaction,
            target,
            failure_code,
            actor,
            execution_epoch,
            now,
        )?;
    }
    Ok(deliveries.len())
}

fn establish_dispatch_attempt(
    database: &mut Database,
    delivery_id: &str,
    trigger: DeliveryDispatchTrigger,
) -> Result<Option<String>> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let current = transaction
        .query_row(
            r#"
            SELECT status, dispatch_phase, wait_condition,
                   dispatch_attempt_count, retry_generation
            FROM message_delivery WHERE id = ?1
            "#,
            [delivery_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((status, phase, wait_condition, attempt_count, retry_generation)) = current else {
        transaction.commit()?;
        return Ok(None);
    };
    let dispatchable = status == "pending"
        && match trigger {
            DeliveryDispatchTrigger::Accepted => phase == "never_attempted" && attempt_count == 0,
            _ => {
                phase == "attempted_waiting"
                    && wait_condition.as_deref() == trigger.expected_wait_condition()
            }
        };
    if !dispatchable {
        transaction.commit()?;
        return Ok(None);
    }
    let attempt_id = Uuid::new_v4().to_string();
    let scheduler_correlation_id = Uuid::new_v4().to_string();
    let ordinal = attempt_count + 1;
    let now = chrono::Utc::now().to_rfc3339();
    let updated = transaction.execute(
        r#"
        UPDATE message_delivery
        SET dispatch_phase = 'attempting', wait_condition = NULL,
            dispatch_attempt_count = ?2,
            active_dispatch_attempt_id = ?3,
            scheduler_correlation_id = ?4,
            version = version + 1, updated_at = ?5
        WHERE id = ?1 AND status = 'pending'
          AND dispatch_attempt_count = ?2 - 1
        "#,
        params![
            delivery_id,
            ordinal,
            attempt_id,
            scheduler_correlation_id,
            now
        ],
    )?;
    if updated != 1 {
        anyhow::bail!("Message Delivery changed before dispatch attempt fencing");
    }
    transaction.execute(
        r#"
        INSERT INTO message_delivery_attempt(
            id, delivery_id, ordinal, retry_generation,
            trigger_kind, scheduler_correlation_id,
            status, wait_condition, context_manifest_id,
            target_agent_run_id, failure_code, failure_detail_json,
            started_at, ended_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6,
            'attempting', NULL, NULL, NULL, NULL, NULL, ?7, NULL
        )
        "#,
        params![
            attempt_id,
            delivery_id,
            ordinal,
            retry_generation,
            trigger.as_str(),
            scheduler_correlation_id,
            now,
        ],
    )?;
    transaction.commit()?;
    Ok(Some(attempt_id))
}

fn process_dispatch_attempt(
    database: &mut Database,
    delivery_id: &str,
    attempt_id: &str,
    recipient_capacity_available: bool,
) -> Result<DeliveryDispatchOutcome> {
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let delivery = load_dispatch_delivery(&transaction, delivery_id, attempt_id)?;
    let Some(delivery) = delivery else {
        transaction.commit()?;
        return Ok(DeliveryDispatchOutcome::NotDispatchable);
    };
    let actor = ActorRef::System {
        component_id: "message-delivery-dispatch-pump".to_string(),
    };
    let now = chrono::Utc::now().to_rfc3339();

    // v1.60 keeps legacy Gather rows only as history. No retired Gather
    // Delivery may materialize a new Run after the Delivery-first cutover.
    if delivery.delivery_kind == "gather_completion" || delivery.gather_id.is_some() {
        let outcome = terminal_dispatch(
            &transaction,
            &delivery,
            attempt_id,
            "failed",
            "legacy_gather_retired",
            &actor,
            &now,
        )?;
        transaction.commit()?;
        return Ok(outcome);
    }

    let turn_state = transaction
        .query_row(
            r#"
            SELECT status, cancel_requested_at, execution_budget_exhausted_at,
                   CASE WHEN execution_budget_schema_version = 2 THEN execution_budget_deadline_at ELSE COALESCE(execution_budget_deadline_at, 'invalid') END
            FROM camp_turn WHERE id = ?1 AND camp_id = ?2
            "#,
            params![delivery.camp_turn_id, delivery.camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()?;
    let turn_active = match turn_state.as_ref() {
        Some(state) => {
            matches!(state.0.as_str(), "running" | "waiting")
                && state.1.is_none()
                && state.2.is_none()
                && !crate::execution_budget::execution_deadline_elapsed(
                    state.3.as_deref(),
                    chrono::DateTime::parse_from_rfc3339(&now)?.with_timezone(&chrono::Utc),
                )?
        }
        None => false,
    };
    if !turn_active {
        let outcome = terminal_dispatch(
            &transaction,
            &delivery,
            attempt_id,
            "cancelled",
            "camp_turn_no_longer_active",
            &actor,
            &now,
        )?;
        transaction.commit()?;
        return Ok(outcome);
    }

    if !recipient_membership_matches(
        &transaction,
        &delivery.camp_id,
        &delivery.recipient_agent_id,
        delivery.recipient_membership_version_at_admission,
    )? {
        let outcome = terminal_dispatch(
            &transaction,
            &delivery,
            attempt_id,
            "failed",
            "recipient_membership_changed",
            &actor,
            &now,
        )?;
        transaction.commit()?;
        return Ok(outcome);
    }
    if delivery_requires_source_membership_fence(&delivery.delivery_kind)
        && !source_run_membership_matches(
            &transaction,
            &delivery.camp_id,
            &delivery.source_agent_run_id,
        )?
    {
        let outcome = terminal_dispatch(
            &transaction,
            &delivery,
            attempt_id,
            "failed",
            "source_membership_changed",
            &actor,
            &now,
        )?;
        transaction.commit()?;
        return Ok(outcome);
    }
    let conversation_id = ensure_delivery_conversation(
        &transaction,
        &delivery.camp_id,
        &delivery.recipient_agent_id,
        &now,
    )?;
    let target_busy: bool = transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM agent_run
            WHERE conversation_id = ?1
              AND status IN ('queued', 'running', 'waiting')
        )
        "#,
        [&conversation_id],
        |row| row.get(0),
    )?;
    let fifo_predecessor_pending: bool = transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM message_delivery AS current
            JOIN message_delivery AS predecessor
              ON predecessor.camp_id = current.camp_id
             AND predecessor.recipient_agent_id = current.recipient_agent_id
             AND predecessor.queue_sequence < current.queue_sequence
            WHERE current.id = ?1
              AND predecessor.status = 'pending'
        )
        "#,
        [&delivery.id],
        |row| row.get(0),
    )?;
    if target_busy || fifo_predecessor_pending {
        wait_dispatch_attempt(
            &transaction,
            &delivery,
            attempt_id,
            "target_busy",
            &actor,
            &now,
        )?;
        transaction.commit()?;
        return Ok(DeliveryDispatchOutcome::Waiting {
            condition: "target_busy".to_string(),
        });
    }
    let runtime =
        match resolve_frozen_runtime(&transaction, &conversation_id, &delivery.recipient_agent_id)?
        {
            Ok(runtime) => runtime,
            Err(blocker) => {
                wait_dispatch_attempt_with_detail(
                    &transaction,
                    &delivery,
                    attempt_id,
                    "runtime_unavailable",
                    Some(json!({"blockerCode": blocker.code})),
                    &actor,
                    &now,
                )?;
                transaction.commit()?;
                return Ok(DeliveryDispatchOutcome::Waiting {
                    condition: "runtime_unavailable".to_string(),
                });
            }
        };
    if !recipient_capacity_available {
        wait_dispatch_attempt(
            &transaction,
            &delivery,
            attempt_id,
            "capacity_unavailable",
            &actor,
            &now,
        )?;
        transaction.commit()?;
        return Ok(DeliveryDispatchOutcome::Waiting {
            condition: "capacity_unavailable".to_string(),
        });
    }

    if !topic_roster_is_fresh_for_attempt(&transaction, &delivery, attempt_id, &actor, &now)? {
        transaction.commit()?;
        return Ok(DeliveryDispatchOutcome::Waiting {
            condition: TOPIC_ROSTER_WAIT_CONDITION.to_string(),
        });
    }
    if !topic_channel_recipient_is_present(
        &transaction,
        &delivery.camp_id,
        &delivery.recipient_agent_id,
    )? {
        let outcome = terminal_dispatch(
            &transaction,
            &delivery,
            attempt_id,
            "failed",
            if topic_parent_roster_identity(&transaction, &delivery.camp_id)?
                .is_some_and(|(provider, _, _)| provider == "lark")
            {
                "recipient_not_in_lark_roster"
            } else {
                "recipient_not_in_feishu_roster"
            },
            &actor,
            &now,
        )?;
        transaction.commit()?;
        return Ok(outcome);
    }

    let effective_config = build_effective_config(
        &transaction,
        &conversation_id,
        &delivery.recipient_agent_id,
        &runtime,
    )?;
    let caller_runtime_basis =
        capture_run_runtime_basis(&transaction, &delivery.source_agent_run_id)?;
    let mut workspace = AgentRunWorkspace::runtime_managed_path(
        caller_runtime_basis.workspace.execution_root.clone(),
    );
    // A2A executes in the same resolved environment. Replacing this metadata with
    // `shared` makes a persisted Mission worktree fail the preparing/recovery fence.
    workspace.isolation = caller_runtime_basis.workspace.isolation.clone();
    workspace.validate()?;
    let current_conversation_boundary: i64 = transaction.query_row(
        "SELECT last_message_sequence FROM conversation WHERE id = ?1",
        [&conversation_id],
        |row| row.get(0),
    )?;
    let agent_run_id = Uuid::new_v4().to_string();
    let charter_delivery_mode = charter_delivery_mode_for_adapter(runtime.adapter_kind);
    let frozen_snapshot: String = transaction.query_row(
        "SELECT frozen_snapshot_json FROM message_delivery WHERE id = ?1",
        [&delivery.id],
        |row| row.get(0),
    )?;
    let mut frozen_snapshot_value: Value = serde_json::from_str(&frozen_snapshot)
        .context("Message Delivery frozen snapshot is invalid")?;
    let delivery_context_preview = DeliveryContextPreview {
        agent_run_id: &agent_run_id,
        camp_id: &delivery.camp_id,
        camp_turn_id: &delivery.camp_turn_id,
        conversation_id: &conversation_id,
        agent_id: &delivery.recipient_agent_id,
        task_id: delivery.task_id.as_deref(),
        execution_epoch: 1,
        invocation_kind: "a2a",
        a2a_parent_agent_run_id: delivery.target_parent_agent_run_id.as_deref(),
        a2a_root_agent_run_id: delivery.a2a_root_agent_run_id.as_deref(),
        a2a_depth: delivery.a2a_depth,
        camp_message_boundary_sequence: delivery.camp_message_boundary_sequence,
        conversation_message_boundary_sequence: current_conversation_boundary,
        trigger_camp_message_id: Some(&delivery.message_id),
        trigger_message_delivery_id: &delivery.id,
        effective_config: effective_config.clone(),
        workspace: serde_json::to_value(&workspace)?,
        runtime_installation_id: Some(runtime.installation_id.as_str()),
        runtime_binding_compatibility_digest: Some(runtime.binding_compatibility_digest.as_str()),
        charter_delivery_mode,
        max_payload_bytes: DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
    };
    let frozen_context = if let Some(context) = frozen_snapshot_value.get("frozenContext") {
        serde_json::from_value::<FrozenDeliveryContext>(context.clone())
            .context("Message Delivery frozen Context is invalid")?
    } else {
        let frozen = match ContextService::preflight_delivery_context(
            &transaction,
            &delivery_context_preview,
        ) {
            Ok(context) => context,
            Err(error)
                if error
                    .downcast_ref::<crate::context::ContextPayloadTooLarge>()
                    .is_some() =>
            {
                let outcome = terminal_dispatch(
                    &transaction,
                    &delivery,
                    attempt_id,
                    "failed",
                    "context_payload_too_large",
                    &actor,
                    &now,
                )?;
                transaction.commit()?;
                return Ok(outcome);
            }
            Err(error) => return Err(error).context("Delivery Context preflight failed"),
        };
        frozen_snapshot_value["frozenContext"] = serde_json::to_value(&frozen)?;
        transaction.execute(
            "UPDATE message_delivery SET frozen_snapshot_json = ?2 WHERE id = ?1",
            params![delivery.id, serde_json::to_string(&frozen_snapshot_value)?],
        )?;
        frozen
    };
    ContextService::validate_frozen_delivery_context(
        &transaction,
        &delivery_context_preview,
        &frozen_context,
    )?;
    if frozen_context.charter_delivery_mode != charter_delivery_mode
        || frozen_context.camp_message_boundary_sequence != delivery.camp_message_boundary_sequence
        || frozen_context.conversation_message_boundary_sequence > current_conversation_boundary
    {
        anyhow::bail!("Message Delivery frozen Context no longer matches its dispatch target");
    }
    let conversation_boundary = frozen_context.conversation_message_boundary_sequence;
    transaction.execute(
        r#"
        INSERT INTO agent_run(
            id, camp_turn_id, conversation_id, task_id,
            assignee_agent_id_at_admission,
            trigger_camp_message_id, trigger_message_delivery_id,
            trigger_delivery_generation, input_ready_at,
            initial_camp_context_through_sequence,
            initial_conversation_context_through_sequence,
            responsibility_key, responsibility_generation,
            predecessor_agent_run_id, start_reason,
            purpose, completion_role,
            effective_config_json, workspace_json, permission_semantics,
            runtime_adapter_kind, runtime_installation_id,
            runtime_executable_path, runtime_auth_scope,
            runtime_reported_version, runtime_executable_fingerprint,
            runtime_initial_reported_version,
            runtime_initial_executable_fingerprint,
            runtime_capabilities_json, runtime_model_selection_json,
            runtime_permission_config_json,
            runtime_binding_compatibility_digest,
            runtime_host_config_digest, runtime_protocol_version,
            runtime_installation_generation,
            runtime_search_environment_generation,
            runtime_native_session_compatibility_key,
            status, wait_reason, wait_deadline_at,
            idempotency_key, automatic_retry_count, runtime_rebind_count,
            last_error_code, last_error_details_ref,
            manual_retry_allowed, retry_declined_at,
            execution_epoch, execution_lease_owner,
            execution_lease_expires_at,
            cancel_requested_at, cancel_reason_code,
            cancel_acknowledged_at, version,
            created_at, started_at, ended_at, updated_at,
            invocation_kind, a2a_parent_agent_run_id,
            a2a_root_agent_run_id, a2a_depth
        ) VALUES (
            ?1, ?2, ?3, ?4, ?33, ?5, ?6, ?34, ?7, ?8, ?9,
            ?10, ?34, NULL, 'initial', ?11, ?35,
            ?12, ?13, 'runtime_managed_v2',
            ?14, ?15, ?16, ?17, ?18, ?19, ?18, ?19,
            ?20, ?21, ?22, ?23, ?24, ?25,
            ?26, ?27, ?28,
            'queued', NULL, NULL, ?29, 0, 0,
            NULL, NULL, 0, NULL,
            0, NULL, NULL, NULL, NULL, NULL, 1,
            ?7, NULL, NULL, ?7,
            ?36, ?30, ?31, ?32
        )
        "#,
        params![
            agent_run_id,
            delivery.camp_turn_id,
            conversation_id,
            delivery.task_id,
            delivery.message_id,
            delivery.id,
            now,
            delivery.camp_message_boundary_sequence,
            conversation_boundary,
            format!("message-delivery/{}", delivery.id),
            format!(
                "Handle public message from AgentRun {}",
                delivery.source_agent_run_id
            ),
            serde_json::to_string(&effective_config)?,
            serde_json::to_string(&workspace)?,
            runtime.adapter_kind.as_str(),
            runtime.installation_id,
            runtime.executable_path,
            runtime.auth_scope,
            runtime.reported_version,
            runtime.executable_fingerprint,
            serde_json::to_string(&runtime.capabilities)?,
            serde_json::to_string(&runtime.model)?,
            serde_json::to_string(&runtime.permissions)?,
            runtime.binding_compatibility_digest,
            runtime.host_config_digest,
            runtime.protocol_version,
            runtime.installation_generation,
            runtime.search_environment_generation,
            runtime.native_session_compatibility_key,
            format!(
                "message-delivery:{}:retry:{}",
                delivery.id, delivery.retry_generation
            ),
            delivery.target_parent_agent_run_id,
            delivery.a2a_root_agent_run_id,
            delivery.a2a_depth,
            delivery.assignee_agent_id_at_admission,
            delivery.retry_generation,
            delivery.completion_role,
            "a2a",
        ],
    )?;
    let attempt_updated = transaction.execute(
        r#"
        UPDATE message_delivery_attempt
        SET status = 'materialized', context_manifest_id = NULL,
            target_agent_run_id = ?3, ended_at = ?4
        WHERE id = ?1 AND delivery_id = ?2 AND status = 'attempting'
        "#,
        params![attempt_id, delivery.id, agent_run_id, now],
    )?;
    let delivery_updated = transaction.execute(
        r#"
        UPDATE message_delivery
        SET status = 'running', dispatch_phase = 'materialized',
            context_manifest_id = NULL, target_agent_run_id = ?3,
            active_dispatch_attempt_id = NULL,
            version = version + 1, updated_at = ?4
        WHERE id = ?1 AND active_dispatch_attempt_id = ?2
          AND status = 'pending' AND dispatch_phase = 'attempting'
        "#,
        params![delivery.id, attempt_id, agent_run_id, now],
    )?;
    if attempt_updated != 1 || delivery_updated != 1 {
        anyhow::bail!("Message Delivery changed before AgentRun materialization");
    }
    append_domain_event(
        &transaction,
        "message_delivery.materialized",
        Some(&delivery.camp_id),
        Some(("message_delivery", &delivery.id)),
        &actor,
        None,
        &json!({
            "attemptId": attempt_id,
            "contextFrozen": true,
            "targetAgentRunId": agent_run_id,
            "recipientAgentId": delivery.recipient_agent_id,
            "deliveryKind": delivery.delivery_kind,
            "completionRole": delivery.completion_role,
            "retryGeneration": delivery.retry_generation,
            "edgeKind": delivery.edge_kind,
            "returnToAgentRunId": delivery.return_to_agent_run_id,
        }),
    )?;
    append_domain_event(
        &transaction,
        "agent_run.queued",
        Some(&delivery.camp_id),
        Some(("agent_run", &agent_run_id)),
        &actor,
        None,
        &json!({
            "campTurnId": delivery.camp_turn_id,
            "taskId": delivery.task_id,
            "invocationKind": "a2a",
            "messageDeliveryId": delivery.id,
            "triggerDeliveryGeneration": delivery.retry_generation,
            "triggerCampMessageId": delivery.message_id,
            "edgeKind": delivery.edge_kind,
            "a2aParentAgentRunId": delivery.target_parent_agent_run_id,
            "returnToAgentRunId": delivery.return_to_agent_run_id,
            "a2aRootAgentRunId": delivery.a2a_root_agent_run_id,
            "a2aDepth": delivery.a2a_depth,
        }),
    )?;
    transaction.commit()?;
    Ok(DeliveryDispatchOutcome::Materialized { agent_run_id })
}

fn load_dispatch_delivery(
    transaction: &Transaction<'_>,
    delivery_id: &str,
    attempt_id: &str,
) -> Result<Option<DispatchDelivery>> {
    transaction
        .query_row(
            r#"
            SELECT delivery.id, delivery.camp_id, delivery.camp_turn_id,
                   delivery.message_id, delivery.camp_message_boundary_sequence,
                   delivery.recipient_agent_id, delivery.task_id,
                   delivery.assignee_agent_id_at_admission,
                   delivery.source_agent_run_id,
                   delivery.delivery_kind, delivery.completion_role,
                   delivery.gather_id, delivery.edge_kind,
                   delivery.target_parent_agent_run_id,
                   delivery.return_to_agent_run_id,
                   delivery.a2a_root_agent_run_id,
                   delivery.a2a_depth, delivery.retry_generation,
                   delivery.recipient_membership_version_at_admission,
                   delivery.failure_detail_json
            FROM message_delivery AS delivery
            WHERE delivery.id = ?1 AND delivery.status = 'pending'
              AND delivery.dispatch_phase = 'attempting'
              AND delivery.active_dispatch_attempt_id = ?2
            "#,
            params![delivery_id, attempt_id],
            |row| {
                Ok(DispatchDelivery {
                    id: row.get(0)?,
                    camp_id: row.get(1)?,
                    camp_turn_id: row.get(2)?,
                    message_id: row.get(3)?,
                    camp_message_boundary_sequence: row.get(4)?,
                    recipient_agent_id: row.get(5)?,
                    task_id: row.get(6)?,
                    assignee_agent_id_at_admission: row.get(7)?,
                    source_agent_run_id: row.get(8)?,
                    delivery_kind: row.get(9)?,
                    completion_role: row.get(10)?,
                    gather_id: row.get(11)?,
                    edge_kind: row.get(12)?,
                    target_parent_agent_run_id: row.get(13)?,
                    return_to_agent_run_id: row.get(14)?,
                    a2a_root_agent_run_id: row.get(15)?,
                    a2a_depth: row.get(16)?,
                    retry_generation: row.get(17)?,
                    recipient_membership_version_at_admission: row.get(18)?,
                    failure_detail_json: row.get(19)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn wait_dispatch_attempt(
    transaction: &Transaction<'_>,
    delivery: &DispatchDelivery,
    attempt_id: &str,
    condition: &str,
    actor: &ActorRef,
    now: &str,
) -> Result<()> {
    wait_dispatch_attempt_with_detail(
        transaction,
        delivery,
        attempt_id,
        condition,
        None,
        actor,
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn wait_dispatch_attempt_with_detail(
    transaction: &Transaction<'_>,
    delivery: &DispatchDelivery,
    attempt_id: &str,
    condition: &str,
    detail: Option<Value>,
    actor: &ActorRef,
    now: &str,
) -> Result<()> {
    let attempt_updated = transaction.execute(
        r#"
        UPDATE message_delivery_attempt
        SET status = 'waiting', wait_condition = ?3,
            failure_detail_json = ?4, ended_at = ?5
        WHERE id = ?1 AND delivery_id = ?2 AND status = 'attempting'
        "#,
        params![
            attempt_id,
            delivery.id,
            condition,
            detail.as_ref().map(serde_json::to_string).transpose()?,
            now
        ],
    )?;
    let delivery_updated = transaction.execute(
        r#"
        UPDATE message_delivery
        SET dispatch_phase = 'attempted_waiting', wait_condition = ?3,
            active_dispatch_attempt_id = NULL,
            failure_detail_json = ?4,
            version = version + 1, updated_at = ?5
        WHERE id = ?1 AND active_dispatch_attempt_id = ?2
          AND status = 'pending' AND dispatch_phase = 'attempting'
        "#,
        params![
            delivery.id,
            attempt_id,
            condition,
            detail.as_ref().map(serde_json::to_string).transpose()?,
            now
        ],
    )?;
    if attempt_updated != 1 || delivery_updated != 1 {
        anyhow::bail!("Message Delivery changed before wait condition persistence");
    }
    append_domain_event(
        transaction,
        "message_delivery.waiting",
        Some(&delivery.camp_id),
        Some(("message_delivery", &delivery.id)),
        actor,
        None,
        &json!({
            "attemptId": attempt_id,
            "recipientAgentId": delivery.recipient_agent_id,
            "waitCondition": condition,
        }),
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn terminal_dispatch(
    transaction: &Transaction<'_>,
    delivery: &DispatchDelivery,
    attempt_id: &str,
    status: &str,
    failure_code: &str,
    actor: &ActorRef,
    now: &str,
) -> Result<DeliveryDispatchOutcome> {
    let attempt_status = if status == "cancelled" {
        "cancelled"
    } else {
        "failed"
    };
    let attempt_updated = transaction.execute(
        r#"
        UPDATE message_delivery_attempt
        SET status = ?3, failure_code = ?4, ended_at = ?5
        WHERE id = ?1 AND delivery_id = ?2 AND status = 'attempting'
        "#,
        params![attempt_id, delivery.id, attempt_status, failure_code, now],
    )?;
    let delivery_updated = transaction.execute(
        r#"
        UPDATE message_delivery
        SET status = ?3, dispatch_phase = 'terminal', wait_condition = NULL,
            active_dispatch_attempt_id = NULL,
            manual_intervention_required = 1,
            failure_code = ?4,
            version = version + 1, updated_at = ?5, ended_at = ?5
        WHERE id = ?1 AND active_dispatch_attempt_id = ?2
          AND status = 'pending' AND dispatch_phase = 'attempting'
        "#,
        params![delivery.id, attempt_id, status, failure_code, now],
    )?;
    if attempt_updated != 1 || delivery_updated != 1 {
        anyhow::bail!("Message Delivery changed before terminal persistence");
    }
    append_domain_event(
        transaction,
        "message_delivery.terminal",
        Some(&delivery.camp_id),
        Some(("message_delivery", &delivery.id)),
        actor,
        None,
        &json!({
            "attemptId": attempt_id,
            "status": status,
            "failureCode": failure_code,
        }),
    )?;
    Ok(DeliveryDispatchOutcome::Terminal {
        status: status.to_string(),
        failure_code: failure_code.to_string(),
    })
}

pub(crate) fn current_recipient_membership_version(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_id: &str,
) -> Result<Option<i64>> {
    transaction
        .query_row(
            r#"
            SELECT camp_member.version
            FROM camp_member
            JOIN agent_profile ON agent_profile.id = camp_member.agent_id
            WHERE camp_member.camp_id = ?1
              AND camp_member.agent_id = ?2
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'present'
            "#,
            params![camp_id, agent_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
}

fn recipient_membership_matches(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_id: &str,
    membership_version: i64,
) -> Result<bool> {
    Ok(
        current_recipient_membership_version(transaction, camp_id, agent_id)?
            == Some(membership_version),
    )
}

fn topic_roster_is_fresh_for_attempt(
    transaction: &Transaction<'_>,
    delivery: &DispatchDelivery,
    attempt_id: &str,
    actor: &ActorRef,
    now: &str,
) -> Result<bool> {
    let Some((provider, tenant_key, chat_id)) =
        topic_parent_roster_identity(transaction, &delivery.camp_id)?
    else {
        return Ok(true);
    };
    let current_generation = transaction
        .query_row(
            r#"
            SELECT generation
            FROM external_group_bot_roster_state
            WHERE provider = ?1 AND tenant_key = ?2 AND chat_id = ?3
            "#,
            params![provider, tenant_key, chat_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0);
    let previous_detail = delivery
        .failure_detail_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok());
    let previous_required_generation = previous_detail.as_ref().and_then(|detail| {
        let same_gate = detail.get("blockerCode").and_then(Value::as_str)
            == Some(TOPIC_ROSTER_SYNC_BLOCKER_CODE)
            && detail.get("provider").and_then(Value::as_str) == Some(provider.as_str())
            && detail.get("tenantKey").and_then(Value::as_str) == Some(tenant_key.as_str())
            && detail.get("chatId").and_then(Value::as_str) == Some(chat_id.as_str())
            && detail.get("retryGeneration").and_then(Value::as_i64)
                == Some(delivery.retry_generation);
        same_gate
            .then(|| {
                detail
                    .get("requiredRosterGeneration")
                    .and_then(Value::as_i64)
            })
            .flatten()
            .filter(|generation| *generation >= 1)
    });
    if previous_required_generation
        .is_some_and(|required_generation| current_generation >= required_generation)
    {
        let updated = transaction.execute(
            r#"
            UPDATE message_delivery
            SET failure_detail_json = NULL
            WHERE id = ?1 AND active_dispatch_attempt_id = ?2
              AND status = 'pending' AND dispatch_phase = 'attempting'
            "#,
            params![delivery.id, attempt_id],
        )?;
        if updated != 1 {
            anyhow::bail!("Message Delivery changed before Topic roster gate release");
        }
        return Ok(true);
    }

    let required_generation =
        previous_required_generation.unwrap_or_else(|| current_generation.saturating_add(1));
    wait_dispatch_attempt_with_detail(
        transaction,
        delivery,
        attempt_id,
        TOPIC_ROSTER_WAIT_CONDITION,
        Some(json!({
            "blockerCode": TOPIC_ROSTER_SYNC_BLOCKER_CODE,
            "provider": provider,
            "tenantKey": tenant_key,
            "chatId": chat_id,
            "requiredRosterGeneration": required_generation,
            "retryGeneration": delivery.retry_generation,
        })),
        actor,
        now,
    )?;
    Ok(false)
}

fn topic_parent_roster_identity(
    transaction: &Transaction<'_>,
    camp_id: &str,
) -> Result<Option<(String, String, String)>> {
    transaction
        .query_row(
            r#"
            SELECT conversation.provider, conversation.tenant_key, conversation.chat_id
            FROM channel_conversation_binding AS binding
            JOIN channel_conversation AS conversation
              ON conversation.id = binding.channel_conversation_id
            WHERE binding.camp_id = ?1 AND binding.status = 'active'
              AND conversation.provider IN ('feishu', 'lark')
              AND conversation.conversation_kind = 'topic'
            LIMIT 1
            "#,
            [camp_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(Into::into)
}

pub(crate) fn topic_channel_recipient_is_present(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_id: &str,
) -> Result<bool> {
    let Some((provider, tenant_key, chat_id)) = topic_parent_roster_identity(transaction, camp_id)?
    else {
        return Ok(true);
    };
    transaction
        .query_row(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM external_group_bot_roster AS roster
                JOIN channel_member_bot_directory AS bot
                  ON bot.provider = roster.provider
                 AND bot.app_id = roster.app_id AND bot.agent_id = roster.agent_id
                WHERE roster.provider = ?1
                  AND roster.tenant_key = ?2 AND roster.chat_id = ?3
                  AND roster.agent_id = ?4 AND roster.status = 'present'
                  AND bot.status = 'published'
            )
            "#,
            params![provider, tenant_key, chat_id, agent_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

pub(crate) fn pending_topic_roster_refreshes(
    transaction: &Transaction<'_>,
    provider: &str,
) -> Result<Vec<TopicRosterRefreshRequest>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT conversation.provider, conversation.tenant_key, conversation.chat_id,
               MAX(CAST(json_extract(
                   delivery.failure_detail_json,
                   '$.requiredRosterGeneration'
               ) AS INTEGER))
        FROM message_delivery AS delivery
        JOIN channel_conversation_binding AS binding
          ON binding.camp_id = delivery.camp_id AND binding.status = 'active'
        JOIN channel_conversation AS conversation
          ON conversation.id = binding.channel_conversation_id
        WHERE delivery.status = 'pending'
          AND delivery.dispatch_phase = 'attempted_waiting'
          AND delivery.wait_condition = ?1
          AND json_extract(delivery.failure_detail_json, '$.blockerCode') = ?2
          AND conversation.provider = ?3
          AND conversation.conversation_kind = 'topic'
        GROUP BY conversation.provider, conversation.tenant_key, conversation.chat_id
        ORDER BY conversation.provider, conversation.tenant_key, conversation.chat_id
        "#,
    )?;
    Ok(statement
        .query_map(
            params![
                TOPIC_ROSTER_WAIT_CONDITION,
                TOPIC_ROSTER_SYNC_BLOCKER_CODE,
                provider
            ],
            |row| {
                Ok(TopicRosterRefreshRequest {
                    provider: row.get(0)?,
                    tenant_key: row.get(1)?,
                    chat_id: row.get(2)?,
                    required_roster_generation: row.get(3)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

pub(crate) fn dispatch_topic_deliveries_waiting_for_roster(
    database: &mut Database,
    provider: &str,
    tenant_key: &str,
    chat_id: &str,
) -> Result<usize> {
    let delivery_ids = {
        let mut statement = database.connection().prepare(
            r#"
            SELECT delivery.id
            FROM message_delivery AS delivery
            JOIN channel_conversation_binding AS binding
              ON binding.camp_id = delivery.camp_id AND binding.status = 'active'
            JOIN channel_conversation AS conversation
              ON conversation.id = binding.channel_conversation_id
            JOIN external_group_bot_roster_state AS roster_state
              ON roster_state.provider = conversation.provider
             AND roster_state.tenant_key = conversation.tenant_key
             AND roster_state.chat_id = conversation.chat_id
            WHERE delivery.status = 'pending'
              AND delivery.dispatch_phase = 'attempted_waiting'
              AND delivery.wait_condition = ?1
              AND json_extract(delivery.failure_detail_json, '$.blockerCode') = ?2
              AND CAST(json_extract(
                    delivery.failure_detail_json,
                    '$.requiredRosterGeneration'
                  ) AS INTEGER) <= roster_state.generation
              AND conversation.provider = ?3
              AND conversation.tenant_key = ?4
              AND conversation.chat_id = ?5
              AND conversation.conversation_kind = 'topic'
            ORDER BY delivery.camp_id, delivery.queue_sequence, delivery.id
            "#,
        )?;
        statement
            .query_map(
                params![
                    TOPIC_ROSTER_WAIT_CONDITION,
                    TOPIC_ROSTER_SYNC_BLOCKER_CODE,
                    provider,
                    tenant_key,
                    chat_id,
                ],
                |row| row.get::<_, String>(0),
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut dispatched = 0;
    for delivery_id in delivery_ids {
        if !matches!(
            dispatch_delivery(
                database,
                &delivery_id,
                DeliveryDispatchTrigger::RuntimeReady,
                true,
            )?,
            DeliveryDispatchOutcome::NotDispatchable
        ) {
            dispatched += 1;
        }
    }
    Ok(dispatched)
}

fn delivery_requires_source_membership_fence(delivery_kind: &str) -> bool {
    delivery_kind == "public_a2a"
}

fn source_run_membership_matches(
    transaction: &Transaction<'_>,
    camp_id: &str,
    source_agent_run_id: &str,
) -> Result<bool> {
    transaction
        .query_row(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM agent_run AS source_run
                JOIN camp_turn AS source_turn
                  ON source_turn.id = source_run.camp_turn_id
                JOIN conversation AS source_conversation
                  ON source_conversation.id = source_run.conversation_id
                JOIN camp_member AS source_member
                  ON source_member.camp_id = source_turn.camp_id
                 AND source_member.agent_id = source_conversation.agent_id
                WHERE source_run.id = ?1
                  AND source_turn.camp_id = ?2
                  AND source_conversation.camp_id = ?2
                  AND source_member.status = 'active'
                  AND source_member.leave_requested_at IS NULL
                  AND source_member.version = CAST(
                      json_extract(
                          source_run.effective_config_json,
                          '$.campMemberVersion'
                      ) AS INTEGER
                  )
            )
            "#,
            params![source_agent_run_id, camp_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn ensure_delivery_conversation(
    transaction: &Transaction<'_>,
    camp_id: &str,
    recipient_agent_id: &str,
    now: &str,
) -> Result<String> {
    let existing = transaction
        .query_row(
            "SELECT id FROM conversation WHERE camp_id = ?1 AND agent_id = ?2",
            params![camp_id, recipient_agent_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(existing) = existing {
        return Ok(existing);
    }
    let conversation_id = Uuid::new_v4().to_string();
    transaction.execute(
        r#"
        INSERT INTO conversation(
            id, camp_id, agent_id,
            provider_override, model_override, action_permission_profile_ref,
            native_session_id, summary,
            summary_through_message_sequence, last_message_sequence,
            version, created_at, updated_at
        ) VALUES (?1, ?2, ?3, NULL, NULL, NULL, NULL, NULL, 0, 0, 1, ?4, ?4)
        "#,
        params![conversation_id, camp_id, recipient_agent_id, now],
    )?;
    Ok(conversation_id)
}

fn load_active_camp_agents(
    transaction: &Transaction<'_>,
    camp_id: &str,
) -> Result<Vec<ActiveCampAgent>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT camp_member.agent_id, agent_profile.display_name
        FROM camp_member
        JOIN agent_profile ON agent_profile.id = camp_member.agent_id
        WHERE camp_member.camp_id = ?1
          AND camp_member.status = 'active'
          AND camp_member.leave_requested_at IS NULL
          AND agent_profile.profile_status = 'present'
        ORDER BY camp_member.agent_id ASC
        "#,
    )?;
    Ok(statement
        .query_map([camp_id], |row| {
            Ok(ActiveCampAgent {
                agent_id: row.get(0)?,
                display_name: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn load_run_reply_anchor(
    transaction: &Transaction<'_>,
    source_agent_run_id: &str,
    camp_id: &str,
) -> Result<Option<String>> {
    let anchor = transaction
        .query_row(
            r#"
            SELECT COALESCE(
                       run.anchor_message_id,
                       run.trigger_camp_message_id,
                       delivery.message_id
                   ),
                   COALESCE(run.camp_id, turn.camp_id)
            FROM agent_run AS run
            LEFT JOIN camp_turn AS turn ON turn.id = run.camp_turn_id
            LEFT JOIN message_delivery AS delivery
              ON delivery.id = run.trigger_message_delivery_id
            WHERE run.id = ?1
            "#,
            [source_agent_run_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .optional()?
        .context("Agent-authored send source Run does not exist")?;
    if anchor.1.as_deref() != Some(camp_id) {
        anyhow::bail!("Agent-authored send source Run is outside the current Camp");
    }
    if let Some(message_id) = anchor.0.as_deref() {
        let readable: bool = transaction.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM camp_message
                WHERE id = ?1 AND camp_id = ?2
                  AND tombstoned_at IS NULL
                  AND recall_state <> 'withdrawn'
            )
            "#,
            params![message_id, camp_id],
            |row| row.get(0),
        )?;
        if !readable {
            anyhow::bail!("Agent-authored send reply anchor is unavailable");
        }
    }
    Ok(anchor.0)
}

fn stable_unique(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn parse_inline_addressing(body: &str, active_agents: &[ActiveCampAgent]) -> InlineAddressing {
    let bytes = body.as_bytes();
    let mut occurrences = Vec::new();
    let mut principal_occurrences = Vec::new();
    let mut malformed = Vec::new();
    let mut index = 0_usize;
    let mut fenced = false;
    let mut inline_code = false;
    let mut line_start = 0_usize;
    let mut line_cluster_end = None;
    let mut line_cluster_ended = false;
    while index < bytes.len() {
        if bytes[index] == b'\n' {
            line_start = index + 1;
            line_cluster_end = None;
            line_cluster_ended = false;
            index += 1;
            continue;
        }
        if bytes[index..].starts_with(b"```") {
            fenced = !fenced;
            inline_code = false;
            index += 3;
            continue;
        }
        if !fenced && bytes[index] == b'`' {
            inline_code = !inline_code;
            index += 1;
            continue;
        }
        if fenced || inline_code || bytes[index] != b'@' {
            index += 1;
            continue;
        }
        if index > 0
            && (bytes[index - 1] == b'\\'
                || bytes[index - 1].is_ascii_alphanumeric()
                || bytes[index - 1] == b'_')
        {
            index += 1;
            continue;
        }
        let token_start = body[..index]
            .char_indices()
            .rfind(|(_, character)| character.is_whitespace())
            .map(|(position, character)| position + character.len_utf8())
            .unwrap_or(0);
        if body[token_start..index].contains("://") {
            index += 1;
            continue;
        }

        let cluster_position = line_leading_mention_cluster_position(
            body,
            index,
            line_start,
            line_cluster_end,
            line_cluster_ended,
        );
        if cluster_position == LineLeadingMentionClusterPosition::Outside {
            line_cluster_ended = true;
        }

        if bytes[index..].starts_with(b"@agent_") {
            let mut end = index + "@agent_".len();
            while end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_') {
                end += 1;
            }
            let value = body[index + 1..end].to_string();
            if parse_agent_id(&value).is_some() {
                occurrences.push(InlineAddressingOccurrence {
                    agent_id: value,
                    start_byte: index,
                    end_byte: end,
                    ordinal: occurrences.len(),
                });
                if cluster_position != LineLeadingMentionClusterPosition::Outside {
                    line_cluster_end = Some(end);
                }
            } else {
                malformed.push(format!("@{value}"));
                line_cluster_ended = true;
            }
            index = end;
            continue;
        }

        if cluster_position == LineLeadingMentionClusterPosition::Outside {
            index += 1;
            continue;
        }

        // Principal is a reserved human identity, independent of member names.
        if let Some(remainder) = body[index + 1..].strip_prefix(AGENT_PRINCIPAL_DISPLAY_NAME)
            && (remainder.is_empty() || remainder.chars().next().is_some_and(char::is_whitespace))
        {
            let end_byte = index + 1 + AGENT_PRINCIPAL_DISPLAY_NAME.len();
            principal_occurrences.push(index..end_byte);
            line_cluster_end = Some(end_byte);
            index = end_byte;
            continue;
        }

        if let Some((agent_id, end_byte)) = match_display_name_mention(body, index, active_agents) {
            occurrences.push(InlineAddressingOccurrence {
                agent_id: agent_id.to_string(),
                start_byte: index,
                end_byte,
                ordinal: occurrences.len(),
            });
            line_cluster_end = Some(end_byte);
            index = end_byte;
            continue;
        }

        line_cluster_ended = true;
        index += 1;
    }
    InlineAddressing {
        occurrences,
        principal_occurrences,
        malformed,
    }
}

fn line_leading_mention_cluster_position(
    body: &str,
    at_byte: usize,
    line_start: usize,
    line_cluster_end: Option<usize>,
    line_cluster_ended: bool,
) -> LineLeadingMentionClusterPosition {
    if line_cluster_ended {
        return LineLeadingMentionClusterPosition::Outside;
    }

    let gap = &body[line_cluster_end.unwrap_or(line_start)..at_byte];
    if !gap.chars().all(char::is_whitespace) {
        return LineLeadingMentionClusterPosition::Outside;
    }
    if line_cluster_end.is_some() {
        if gap.is_empty() {
            LineLeadingMentionClusterPosition::Outside
        } else {
            LineLeadingMentionClusterPosition::Continuation
        }
    } else {
        LineLeadingMentionClusterPosition::First
    }
}

fn match_display_name_mention<'a>(
    body: &str,
    at_byte: usize,
    active_agents: &'a [ActiveCampAgent],
) -> Option<(&'a str, usize)> {
    let tail = &body[at_byte + 1..];
    let mut best_match: Option<(&str, usize, usize)> = None;
    let mut ambiguous = false;

    for agent in active_agents {
        let display_name = agent.display_name.trim();
        if display_name.is_empty() {
            continue;
        }
        let Some(remainder) = tail.strip_prefix(display_name) else {
            continue;
        };
        if !remainder.is_empty() && !remainder.chars().next().is_some_and(char::is_whitespace) {
            continue;
        }

        let display_name_length = display_name.len();
        let end_byte = at_byte + 1 + display_name_length;
        match best_match {
            Some((_, _, best_length)) if display_name_length < best_length => {}
            Some((_, _, best_length)) if display_name_length == best_length => {
                ambiguous = true;
            }
            _ => {
                best_match = Some((agent.agent_id.as_str(), end_byte, display_name_length));
                ambiguous = false;
            }
        }
    }

    if ambiguous {
        None
    } else {
        best_match.map(|(agent_id, end_byte, _)| (agent_id, end_byte))
    }
}

fn structured_content_from_inline_addressing(
    body: &str,
    occurrences: &[InlineAddressingOccurrence],
    principal_occurrences: &[std::ops::Range<usize>],
    mention_user: bool,
) -> Vec<StructuredCampMessageSegment> {
    let mut mentions = occurrences
        .iter()
        .map(|occurrence| {
            (
                occurrence.start_byte..occurrence.end_byte,
                StructuredCampMessageSegment::MemberMention {
                    agent_id: occurrence.agent_id.clone(),
                },
            )
        })
        .chain(principal_occurrences.iter().map(|range| {
            (
                range.clone(),
                StructuredCampMessageSegment::CurrentUserMention {
                    user_id: CURRENT_USER_ID.to_string(),
                },
            )
        }))
        .collect::<Vec<_>>();
    mentions.sort_by_key(|(range, _)| range.start);
    let mut content = Vec::with_capacity(mentions.len().saturating_mul(2).saturating_add(2));
    if mention_user && principal_occurrences.is_empty() {
        content.push(StructuredCampMessageSegment::CurrentUserMention {
            user_id: CURRENT_USER_ID.to_string(),
        });
    }
    let mut cursor = 0_usize;
    for (range, mention) in mentions {
        if cursor < range.start {
            content.push(StructuredCampMessageSegment::Text {
                text: body[cursor..range.start].to_string(),
            });
        }
        // The existing leading CurrentUser projection supplies one separator.
        // Consume that authored separator so explicit and inline sends share
        // the same stored shape, without rewriting historical projections.
        let leading_principal = range.start == 0
            && matches!(
                mention,
                StructuredCampMessageSegment::CurrentUserMention { .. }
            );
        content.push(mention);
        cursor = range.end + usize::from(leading_principal && body[range.end..].starts_with(' '));
    }
    if cursor < body.len() {
        content.push(StructuredCampMessageSegment::Text {
            text: body[cursor..].to_string(),
        });
    }
    normalize_content(content)
}

fn rejected_with_details(code: &str, message: &str, details: Value) -> CommandHandlerResult {
    CommandHandlerResult::rejected(
        code,
        json!({
            "message": message,
            "details": details,
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // Owns the persisted roster gate, not channel admission or Runtime setup.
    // A small SQLite fixture exercises the real gate and provider-scoped queries;
    // the existing channel membership test only covers Camp roster reconciliation.
    #[test]
    fn topic_dispatch_waits_for_its_provider_roster_and_checks_its_published_bot() {
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        connection.execute_batch(r#"
            CREATE TABLE channel_conversation(id, provider, tenant_key, chat_id, conversation_kind);
            CREATE TABLE channel_conversation_binding(camp_id, channel_conversation_id, status);
            CREATE TABLE external_group_bot_roster_state(provider, tenant_key, chat_id, generation);
            CREATE TABLE external_group_bot_roster(provider, tenant_key, chat_id, app_id, agent_id, status);
            CREATE TABLE channel_member_bot_directory(provider, app_id, agent_id, status);
            CREATE TABLE message_delivery(id, camp_id, status, dispatch_phase, active_dispatch_attempt_id,
                wait_condition, failure_detail_json, version, updated_at);
            CREATE TABLE message_delivery_attempt(id, delivery_id, status, wait_condition, failure_detail_json, ended_at);
            CREATE TABLE event_log(event_id, task_id, turn_id, sequence, event_type, native_method,
                payload_json, camp_id, entity_type, entity_id, actor_type, actor_id, source_agent_run_id,
                execution_epoch, created_at);
        "#).unwrap();
        let tx = connection.transaction().unwrap();
        let actor = ActorRef::System {
            component_id: "message-dispatcher".into(),
        };
        let now = "2026-09-27T00:00:00Z";
        let delivery = |provider: &str| DispatchDelivery {
            id: provider.into(),
            camp_id: provider.into(),
            camp_turn_id: "turn".into(),
            message_id: "message".into(),
            camp_message_boundary_sequence: 1,
            recipient_agent_id: "agent_1".into(),
            recipient_membership_version_at_admission: 1,
            task_id: None,
            assignee_agent_id_at_admission: None,
            source_agent_run_id: "source".into(),
            delivery_kind: "agent_message".into(),
            completion_role: "required".into(),
            gather_id: None,
            edge_kind: None,
            target_parent_agent_run_id: None,
            return_to_agent_run_id: None,
            a2a_root_agent_run_id: None,
            a2a_depth: 0,
            retry_generation: 0,
            failure_detail_json: None,
        };
        for provider in ["feishu", "lark"] {
            // Deliberately collide tenant, chat, App and Agent IDs across providers.
            tx.execute(
                "INSERT INTO channel_conversation VALUES(?1,?1,'tenant','chat','topic')",
                [provider],
            )
            .unwrap();
            tx.execute(
                "INSERT INTO channel_conversation_binding VALUES(?1,?1,'active')",
                [provider],
            )
            .unwrap();
            tx.execute(
                "INSERT INTO external_group_bot_roster_state VALUES(?1,'tenant','chat',4)",
                [provider],
            )
            .unwrap();
            tx.execute("INSERT INTO external_group_bot_roster VALUES(?1,'tenant','chat','app','agent_1','present')", [provider]).unwrap();
            tx.execute(
                "INSERT INTO channel_member_bot_directory VALUES(?1,'app','agent_1',?2)",
                params![
                    provider,
                    if provider == "feishu" {
                        "published"
                    } else {
                        "disabled"
                    }
                ],
            )
            .unwrap();
            tx.execute("INSERT INTO message_delivery VALUES(?1,?1,'pending','attempting',?1,NULL,NULL,1,?2)", params![provider, now]).unwrap();
            tx.execute(
                "INSERT INTO message_delivery_attempt VALUES(?1,?1,'attempting',NULL,NULL,NULL)",
                [provider],
            )
            .unwrap();
            assert!(
                !topic_roster_is_fresh_for_attempt(&tx, &delivery(provider), provider, &actor, now)
                    .unwrap(),
                "{provider}"
            );
        }
        for provider in ["feishu", "lark"] {
            assert_eq!(
                pending_topic_roster_refreshes(&tx, provider).unwrap(),
                vec![TopicRosterRefreshRequest {
                    provider: provider.into(),
                    tenant_key: "tenant".into(),
                    chat_id: "chat".into(),
                    required_roster_generation: 5,
                }]
            );
        }
        assert!(
            pending_topic_roster_refreshes(&tx, "dingtalk")
                .unwrap()
                .is_empty()
        );
        let resume = |provider: &str| {
            let mut value = delivery(provider);
            value.failure_detail_json = tx
                .query_row(
                    "SELECT failure_detail_json FROM message_delivery WHERE id=?1",
                    [provider],
                    |row| row.get(0),
                )
                .unwrap();
            tx.execute("UPDATE message_delivery SET dispatch_phase='attempting',active_dispatch_attempt_id=?1,wait_condition=NULL WHERE id=?1", [provider]).unwrap();
            tx.execute("UPDATE message_delivery_attempt SET status='attempting',wait_condition=NULL WHERE id=?1", [provider]).unwrap();
            value
        };
        tx.execute(
            "UPDATE external_group_bot_roster_state SET generation=8 WHERE provider='feishu'",
            [],
        )
        .unwrap();
        assert!(
            !topic_roster_is_fresh_for_attempt(&tx, &resume("lark"), "lark", &actor, now).unwrap(),
            "another provider cannot release this gate"
        );
        assert_eq!(
            pending_topic_roster_refreshes(&tx, "lark").unwrap()[0].required_roster_generation,
            5
        );
        tx.execute(
            "UPDATE external_group_bot_roster_state SET generation=5 WHERE provider='lark'",
            [],
        )
        .unwrap();
        assert!(
            topic_roster_is_fresh_for_attempt(&tx, &resume("lark"), "lark", &actor, now).unwrap()
        );
        assert!(
            pending_topic_roster_refreshes(&tx, "lark")
                .unwrap()
                .is_empty()
        );
        assert!(topic_channel_recipient_is_present(&tx, "feishu", "agent_1").unwrap());
        assert!(
            !topic_channel_recipient_is_present(&tx, "lark", "agent_1").unwrap(),
            "a published Feishu Bot cannot authorize a disabled Lark Bot"
        );
        tx.execute(
            "UPDATE channel_member_bot_directory SET status='published' WHERE provider='lark'",
            [],
        )
        .unwrap();
        assert!(topic_channel_recipient_is_present(&tx, "lark", "agent_1").unwrap());
        tx.execute(
            "UPDATE external_group_bot_roster SET status='absent' WHERE provider='lark'",
            [],
        )
        .unwrap();
        assert!(!topic_channel_recipient_is_present(&tx, "lark", "agent_1").unwrap());
        assert!(topic_channel_recipient_is_present(&tx, "feishu", "agent_1").unwrap());
    }

    // Parser/normalization owns the syntax matrix; the Send integration owner
    // separately verifies the atomic notification, routing and replay effects.
    #[test]
    fn principal_alias_uses_leading_clusters_and_merges_explicit_attention() {
        let agents = vec![
            ActiveCampAgent {
                agent_id: "agent_2".into(),
                display_name: "爱丽丝".into(),
            },
            ActiveCampAgent {
                agent_id: "agent_3".into(),
                display_name: "Principal".into(),
            },
        ];
        for (body, principal_count, member_count) in [
            ("@Principal 请确认", 1, 0),
            ("  @Principal 请确认", 1, 0),
            ("\u{3000}@Principal 请确认", 1, 0),
            ("@Principal\u{a0}@Principal 请确认", 2, 0),
            ("\t@Principal 请确认", 1, 0),
            ("    @Principal 请确认", 1, 0),
            ("开头\n@Principal 请确认\n末行", 1, 0),
            ("开头\n\t@Principal", 1, 0),
            ("@爱丽丝 @Principal 请确认", 1, 1),
            ("@Principal @爱丽丝 请确认", 1, 1),
            ("@agent_2 @Principal 请确认", 1, 1),
            ("@Principal @Principal 请确认", 2, 0),
            ("讨论 @Principal 的含义", 0, 0),
            ("@爱丽丝 请问 @Principal", 0, 1),
            ("@不存在 @Principal 请确认", 0, 0),
            ("@principal 请确认", 0, 0),
            ("@PrincipalExtra 请确认", 0, 0),
            ("@Principal，请确认", 0, 0),
            ("\\@Principal 请确认", 0, 0),
            ("> @Principal 请确认", 0, 0),
            ("- @Principal 请确认", 0, 0),
            ("https://example.test/@Principal", 0, 0),
            ("`@Principal 请确认`", 0, 0),
            ("```text\n@Principal 请确认\n```", 0, 0),
        ] {
            let parsed = parse_inline_addressing(body, &agents);
            assert_eq!(
                parsed.principal_occurrences.len(),
                principal_count,
                "{body}"
            );
            assert_eq!(parsed.occurrences.len(), member_count, "{body}");
            for range in &parsed.principal_occurrences {
                assert_eq!(&body[range.clone()], "@Principal");
            }
        }
        for explicit in [false, true] {
            let body = "@Principal 请确认";
            let parsed = parse_inline_addressing(body, &agents);
            let content = structured_content_from_inline_addressing(
                body,
                &parsed.occurrences,
                &parsed.principal_occurrences,
                explicit,
            );
            assert_eq!(
                content,
                vec![
                    StructuredCampMessageSegment::CurrentUserMention {
                        user_id: CURRENT_USER_ID.into()
                    },
                    StructuredCampMessageSegment::Text {
                        text: "请确认".into()
                    },
                ]
            );
            assert_eq!(
                crate::camp_content::render_plain_text_with_current_user(
                    &content,
                    |_| None,
                    "Murray✨"
                )
                .unwrap(),
                "@Murray✨ 请确认"
            );
        }
    }

    #[test]
    fn strict_inline_parser_ignores_literal_regions_and_preserves_source_order() {
        let parsed = parse_inline_addressing(
            r#"@agent_104 then @agent_27 and @agent_104 `@agent_9` \@agent_8
https://example.test/@agent_7
```
@agent_6
```"#,
            &[],
        );
        assert_eq!(
            parsed
                .occurrences
                .iter()
                .map(|occurrence| occurrence.agent_id.as_str())
                .collect::<Vec<_>>(),
            vec!["agent_104", "agent_27", "agent_104"]
        );
        assert!(parsed.malformed.is_empty());
    }

    #[test]
    fn strict_inline_parser_reports_reserved_but_malformed_tokens() {
        let parsed = parse_inline_addressing("@agent_0 @agent_01 @agent_x @agent_22", &[]);
        assert_eq!(
            parsed
                .occurrences
                .iter()
                .map(|occurrence| occurrence.agent_id.as_str())
                .collect::<Vec<_>>(),
            vec!["agent_22"]
        );
        assert_eq!(parsed.malformed, vec!["@agent_0", "@agent_01", "@agent_x"]);
    }

    #[test]
    fn exact_display_name_alias_routes_to_active_agent() {
        let active_agents = vec![ActiveCampAgent {
            agent_id: "agent_6".to_string(),
            display_name: "爱丽丝".to_string(),
        }];
        let body = "@爱丽丝 v35 实现完成，请做只读 CR。";
        let parsed = parse_inline_addressing(body, &active_agents);

        assert_eq!(parsed.occurrences.len(), 1);
        assert_eq!(parsed.occurrences[0].agent_id, "agent_6");
        assert_eq!(
            &body[parsed.occurrences[0].start_byte..parsed.occurrences[0].end_byte],
            "@爱丽丝"
        );
        assert!(parsed.malformed.is_empty());
    }

    #[test]
    fn display_name_alias_accepts_indented_line_end_and_requires_whitespace_boundary() {
        let active_agents = vec![ActiveCampAgent {
            agent_id: "agent_6".to_string(),
            display_name: "爱丽丝".to_string(),
        }];

        assert_eq!(
            parse_inline_addressing("背景\r\n\t@爱丽丝", &active_agents).occurrences[0].agent_id,
            "agent_6"
        );
        for body in ["@爱丽丝同学 请看一下", "@爱丽丝，请看一下"] {
            assert!(
                parse_inline_addressing(body, &active_agents)
                    .occurrences
                    .is_empty(),
                "unexpected display-name mention in {body}"
            );
        }
    }

    #[test]
    fn line_leading_display_name_alias_supports_whitespace_separated_clusters() {
        let active_agents = vec![
            ActiveCampAgent {
                agent_id: "agent_6".to_string(),
                display_name: "爱丽丝".to_string(),
            },
            ActiveCampAgent {
                agent_id: "agent_7".to_string(),
                display_name: "鲍勃".to_string(),
            },
        ];

        let addressed = parse_inline_addressing(
            "迁移背景与约束……\n\n  @爱丽丝 请分析这个迁移方案",
            &active_agents,
        );
        assert_eq!(addressed.occurrences.len(), 1);
        assert_eq!(addressed.occurrences[0].agent_id, "agent_6");

        for (body, expected) in [
            ("@爱丽丝 @鲍勃 请处理", vec!["agent_6", "agent_7"]),
            ("@agent_6 @鲍勃 请处理", vec!["agent_6", "agent_7"]),
            ("@爱丽丝 @爱丽丝 请处理", vec!["agent_6", "agent_6"]),
            ("@爱丽丝\n@鲍勃 请处理", vec!["agent_6", "agent_7"]),
            ("@爱丽丝 请与 @鲍勃", vec!["agent_6"]),
        ] {
            let parsed = parse_inline_addressing(body, &active_agents);
            assert_eq!(
                parsed
                    .occurrences
                    .iter()
                    .map(|occurrence| occurrence.agent_id.as_str())
                    .collect::<Vec<_>>(),
                expected,
                "unexpected cluster routing in {body}"
            );
            assert!(
                parsed.malformed.is_empty(),
                "unexpected rejection in {body}"
            );
        }

        for body in ["@爱丽丝 @不存在 请处理", "@爱丽丝 @不存在 @鲍勃 请处理"] {
            let parsed = parse_inline_addressing(body, &active_agents);
            assert_eq!(
                parsed
                    .occurrences
                    .iter()
                    .map(|occurrence| occurrence.agent_id.as_str())
                    .collect::<Vec<_>>(),
                vec!["agent_6"]
            );
            assert!(parsed.malformed.is_empty());
        }

        let principal_first = parse_inline_addressing("@Principal @爱丽丝 请处理", &active_agents);
        assert_eq!(principal_first.occurrences[0].agent_id, "agent_6");
        assert_eq!(principal_first.principal_occurrences, vec![0..10]);
        assert!(principal_first.malformed.is_empty());

        for body in [
            "让 Bob 分析一下 @爱丽丝 提出的迁移方案",
            "迁移背景\n最后请 @爱丽丝 分析",
            "- @爱丽丝 请分析",
            "> @爱丽丝 请分析",
        ] {
            assert!(
                parse_inline_addressing(body, &active_agents)
                    .occurrences
                    .is_empty(),
                "unexpected mid-line display-name mention in {body}"
            );
        }
    }

    #[test]
    fn canonical_inline_agent_id_keeps_its_existing_mid_line_position() {
        let parsed = parse_inline_addressing("请让 @agent_6 分析迁移方案", &[]);

        assert_eq!(parsed.occurrences.len(), 1);
        assert_eq!(parsed.occurrences[0].agent_id, "agent_6");
    }

    #[test]
    fn display_name_alias_uses_longest_match_and_canonical_tokens_take_precedence() {
        let active_agents = vec![
            ActiveCampAgent {
                agent_id: "agent_6".to_string(),
                display_name: "爱丽丝".to_string(),
            },
            ActiveCampAgent {
                agent_id: "agent_7".to_string(),
                display_name: "爱丽丝 助手".to_string(),
            },
            ActiveCampAgent {
                agent_id: "agent_8".to_string(),
                display_name: "agent_6".to_string(),
            },
        ];

        assert_eq!(
            parse_inline_addressing("@爱丽丝 助手 请处理", &active_agents).occurrences[0].agent_id,
            "agent_7"
        );
        assert_eq!(
            parse_inline_addressing("@agent_6 请处理", &active_agents).occurrences[0].agent_id,
            "agent_6"
        );
    }

    #[test]
    fn display_name_alias_ignores_literal_regions_urls_escapes_and_ambiguous_names() {
        let active_agents = vec![
            ActiveCampAgent {
                agent_id: "agent_6".to_string(),
                display_name: "爱丽丝".to_string(),
            },
            ActiveCampAgent {
                agent_id: "agent_7".to_string(),
                display_name: "重复".to_string(),
            },
            ActiveCampAgent {
                agent_id: "agent_8".to_string(),
                display_name: "重复".to_string(),
            },
        ];
        let parsed = parse_inline_addressing(
            r#"`@爱丽丝 ` \@爱丽丝 https://example.test/@爱丽丝
```
@爱丽丝
```
@重复 请处理"#,
            &active_agents,
        );

        assert!(parsed.occurrences.is_empty());
        assert!(parsed.malformed.is_empty());

        let clustered = parse_inline_addressing("@爱丽丝 @重复 请处理", &active_agents);
        assert_eq!(clustered.occurrences.len(), 1);
        assert_eq!(clustered.occurrences[0].agent_id, "agent_6");
        assert!(clustered.malformed.is_empty());
    }

    #[test]
    fn canonical_agent_ids_are_routed_as_opaque_identities() {
        let mut values = vec!["agent_9".to_string(), "agent_104".to_string()];
        values.sort_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
        assert_eq!(values, vec!["agent_104", "agent_9"]);
    }

    #[test]
    fn planned_shutdown_cancellation_has_a_distinct_run_local_delivery_reason() {
        assert_eq!(
            delivery_terminal_semantics("cancelled", Some("planned_shutdown_cancelled")).unwrap(),
            (
                "cancelled",
                Some("target_agent_run_planned_shutdown_cancelled"),
                0,
            )
        );
        assert_eq!(
            delivery_terminal_semantics("cancelled", None).unwrap(),
            ("cancelled", Some("target_agent_run_cancelled"), 0)
        );
        assert!(delivery_terminal_semantics("running", None).is_err());
    }
}
