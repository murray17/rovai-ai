use std::collections::{BTreeSet, HashSet};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::Serialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    agent_profile::{AdapterKind, resolve_frozen_runtime},
    camp_content::{StructuredCampMessageSegment, canonical_content_digest, normalize_content},
    collaboration::{append_domain_event, build_effective_config},
    command::{
        ActorRef, CommandEnvelope, CommandExecution, CommandHandlerResult, DomainCommand,
        DomainCommandGateway, EntityReference, canonical_json_digest, sealed,
    },
    context::{
        CharterDeliveryMode, ContextService, DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
        DeliveryContextPreview, FrozenDeliveryContext,
    },
    context_index::index_camp_message,
    db::Database,
    execution_budget::{PRODUCT_MAX_ACCEPTED_A2A, camp_turn_execution_budget_now},
    runtime::AgentRunWorkspace,
    runtime_basis::capture_run_runtime_basis,
};

pub const CAMP_MESSAGE_SEND_TOOL_NAME: &str = "camp.message.send";
pub const CAMP_MESSAGE_SEND_MAX_BODY_BYTES: usize = 32 * 1024;
pub const CAMP_MESSAGE_SEND_MAX_FANOUT: usize = 16;
pub const MESSAGE_DELIVERY_MAX_A2A_DEPTH: i64 = 5;

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryMessageDeliveryCommand {
    pub delivery_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for RetryMessageDeliveryCommand {}
impl DomainCommand for RetryMessageDeliveryCommand {
    const TYPE: &'static str = "message_delivery.retry";
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelMessageDeliveryCommand {
    pub delivery_id: String,
    pub expected_version: i64,
}

impl sealed::Sealed for CancelMessageDeliveryCommand {}
impl DomainCommand for CancelMessageDeliveryCommand {
    const TYPE: &'static str = "message_delivery.cancel";
}

#[derive(Debug, Default)]
pub struct MessageDeliveryService {
    gateway: DomainCommandGateway,
}

impl MessageDeliveryService {
    pub fn retry(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<RetryMessageDeliveryCommand>,
    ) -> Result<CommandExecution> {
        if !matches!(envelope.actor, ActorRef::User { .. }) {
            anyhow::bail!("Only a User may explicitly retry a Message Delivery");
        }
        let delivery_id = envelope.payload.delivery_id.clone();
        let execution = self.gateway.execute(database, envelope, |transaction| {
            let target = transaction
                .query_row(
                    r#"
                    SELECT camp_id, status, version, retry_generation
                    FROM message_delivery WHERE id = ?1
                    "#,
                    [&envelope.payload.delivery_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                        ))
                    },
                )
                .optional()?;
            let Some((camp_id, status, version, retry_generation)) = target else {
                return Ok(rejected(
                    "message_delivery.not_found",
                    "Message Delivery does not exist",
                ));
            };
            if envelope.camp_id.as_deref().is_some_and(|id| id != camp_id) {
                return Ok(rejected(
                    "message_delivery.camp_mismatch",
                    "Message Delivery is outside the Camp",
                ));
            }
            if version != envelope.payload.expected_version {
                return Ok(rejected(
                    "message_delivery.version_conflict",
                    "Message Delivery version is stale",
                ));
            }
            if !matches!(status.as_str(), "failed" | "interrupted_before_dispatch") {
                return Ok(rejected(
                    "message_delivery.retry_not_allowed",
                    "Only failed or interrupted-before-dispatch Deliveries may be retried",
                ));
            }
            let next_generation = retry_generation + 1;
            let retry_id = Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let (actor_type, actor_id) = match &envelope.actor {
                ActorRef::User { user_id } => ("user", user_id.as_str()),
                _ => unreachable!(),
            };
            transaction.execute(
                r#"
                INSERT INTO message_delivery_retry(
                    id, delivery_id, retry_generation, command_id,
                    actor_type, actor_id, reason, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                "#,
                params![
                    retry_id,
                    envelope.payload.delivery_id,
                    next_generation,
                    envelope.command_id,
                    actor_type,
                    actor_id,
                    "explicit_user_retry",
                    now,
                ],
            )?;
            transaction.execute(
                r#"
                UPDATE message_delivery
                SET status = 'pending', dispatch_phase = 'never_attempted',
                    wait_condition = NULL, active_dispatch_attempt_id = NULL,
                    retry_generation = ?2, manual_intervention_required = 0,
                    failure_code = NULL, failure_detail_json = NULL,
                    ended_at = NULL, version = version + 1, updated_at = ?3
                WHERE id = ?1 AND version = ?4
                "#,
                params![
                    envelope.payload.delivery_id,
                    next_generation,
                    now,
                    envelope.payload.expected_version,
                ],
            )?;
            append_domain_event(
                transaction,
                "message_delivery.retry_requested",
                Some(&camp_id),
                Some(("message_delivery", &envelope.payload.delivery_id)),
                &envelope.actor,
                None,
                &json!({
                    "deliveryId": envelope.payload.delivery_id,
                    "retryIdentity": retry_id,
                    "retryGeneration": next_generation,
                }),
            )?;
            Ok(CommandHandlerResult::applied(
                "message_delivery.retry_requested",
                json!({
                    "deliveryId": envelope.payload.delivery_id,
                    "retryIdentity": retry_id,
                    "retryGeneration": next_generation,
                    "status": "pending",
                }),
                Some(EntityReference {
                    entity_type: "message_delivery".to_string(),
                    entity_id: envelope.payload.delivery_id.clone(),
                }),
            ))
        })?;
        if !execution.replayed
            && execution.result.status != crate::command::CommandResultStatus::Rejected
        {
            let _ = dispatch_delivery(
                database,
                &delivery_id,
                DeliveryDispatchTrigger::ExplicitRetry,
                true,
            )?;
        }
        Ok(execution)
    }

    pub fn cancel(
        &self,
        database: &mut Database,
        envelope: &CommandEnvelope<CancelMessageDeliveryCommand>,
    ) -> Result<CommandExecution> {
        if !matches!(envelope.actor, ActorRef::User { .. }) {
            anyhow::bail!("Only a User may explicitly cancel a Message Delivery");
        }
        self.gateway.execute(database, envelope, |transaction| {
            let target = transaction
                .query_row(
                    r#"
                    SELECT camp_id, camp_turn_id, status, dispatch_phase, version
                    FROM message_delivery WHERE id = ?1
                    "#,
                    [&envelope.payload.delivery_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )
                .optional()?;
            let Some((camp_id, camp_turn_id, status, phase, version)) = target else {
                return Ok(rejected(
                    "message_delivery.not_found",
                    "Message Delivery does not exist",
                ));
            };
            if envelope.camp_id.as_deref().is_some_and(|id| id != camp_id) {
                return Ok(rejected(
                    "message_delivery.camp_mismatch",
                    "Message Delivery is outside the Camp",
                ));
            }
            if version != envelope.payload.expected_version {
                return Ok(rejected(
                    "message_delivery.version_conflict",
                    "Message Delivery version is stale",
                ));
            }
            if status != "interrupted_before_dispatch"
                && !(status == "pending" && phase == "attempted_waiting")
            {
                return Ok(rejected(
                    "message_delivery.cancel_not_allowed",
                    "Only waiting or interrupted-before-dispatch Deliveries may be cancelled",
                ));
            }
            let now = chrono::Utc::now().to_rfc3339();
            transaction.execute(
                r#"
                UPDATE message_delivery
                SET status = 'cancelled', dispatch_phase = 'terminal',
                    wait_condition = NULL, manual_intervention_required = 0,
                    failure_code = 'explicit_cancelled',
                    version = version + 1, updated_at = ?2, ended_at = ?2
                WHERE id = ?1 AND version = ?3
                "#,
                params![
                    envelope.payload.delivery_id,
                    now,
                    envelope.payload.expected_version
                ],
            )?;
            append_domain_event(
                transaction,
                "message_delivery.cancelled",
                Some(&camp_id),
                Some(("message_delivery", &envelope.payload.delivery_id)),
                &envelope.actor,
                None,
                &json!({
                    "deliveryId": envelope.payload.delivery_id,
                    "failureCode": "explicit_cancelled",
                }),
            )?;
            crate::runtime::recompute_camp_turn(
                transaction,
                &camp_id,
                &camp_turn_id,
                &envelope.actor,
                None,
                &now,
            )?;
            Ok(CommandHandlerResult::applied(
                "message_delivery.cancelled",
                json!({
                    "deliveryId": envelope.payload.delivery_id,
                    "status": "cancelled",
                }),
                Some(EntityReference {
                    entity_type: "message_delivery".to_string(),
                    entity_id: envelope.payload.delivery_id.clone(),
                }),
            ))
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryDispatchTrigger {
    Accepted,
    TargetRunEnded,
    RuntimeReady,
    CapacityReleased,
    ExplicitRetry,
}

impl DeliveryDispatchTrigger {
    fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::TargetRunEnded => "target_run_ended",
            Self::RuntimeReady => "runtime_ready",
            Self::CapacityReleased => "capacity_released",
            Self::ExplicitRetry => "explicit_retry",
        }
    }

    fn expected_wait_condition(self) -> Option<&'static str> {
        match self {
            Self::Accepted | Self::ExplicitRetry => None,
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
    message_sequence: i64,
    recipient_agent_id: String,
    task_id: Option<String>,
    source_agent_run_id: String,
    a2a_root_agent_run_id: String,
    a2a_depth: i64,
    retry_generation: i64,
}

#[derive(Debug, Clone)]
pub struct SendPublicA2aMessage<'a> {
    pub command_id: &'a str,
    pub camp_id: &'a str,
    pub camp_turn_id: &'a str,
    pub source_agent_run_id: &'a str,
    pub author_agent_id: &'a str,
    pub execution_epoch: i64,
    pub current_a2a_root_agent_run_id: Option<&'a str>,
    pub current_a2a_depth: i64,
    pub body: &'a str,
    pub explicit_recipients: &'a [String],
    pub reply_to_camp_message_id: Option<&'a str>,
    pub task_id: Option<&'a str>,
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

pub fn persist_public_a2a_message(
    transaction: &Transaction<'_>,
    request: &SendPublicA2aMessage<'_>,
) -> Result<CommandHandlerResult> {
    let inline = parse_inline_addressing(request.body);
    let explicit_order = stable_unique(
        request
            .explicit_recipients
            .iter()
            .map(|recipient| recipient.trim().to_string()),
    );
    let inline_order = stable_unique(
        inline
            .occurrences
            .iter()
            .map(|occurrence| occurrence.agent_id.clone()),
    );
    let mut offenders = inline
        .malformed
        .into_iter()
        .map(|value| AddressingOffender {
            source: "inline",
            value,
            reason: "invalid_format",
        })
        .collect::<Vec<_>>();

    for value in &explicit_order {
        if !is_canonical_agent_id(value) {
            offenders.push(AddressingOffender {
                source: "--to",
                value: value.clone(),
                reason: "invalid_format",
            });
        }
    }

    let reply_default = match request.reply_to_camp_message_id {
        Some(message_id) => {
            let reply = transaction
                .query_row(
                    r#"
                    SELECT author_type, author_id
                    FROM camp_message
                    WHERE id = ?1 AND camp_id = ?2 AND tombstoned_at IS NULL
                    "#,
                    params![message_id, request.camp_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;
            let Some((author_type, author_id)) = reply else {
                return Ok(rejected_with_details(
                    "message.reply_invalid",
                    "replyToCampMessageId must identify a visible message in the current Camp",
                    json!({
                        "replyToCampMessageId": message_id,
                        "newRequestIdRequired": true,
                    }),
                ));
            };
            (author_type == "agent").then_some(author_id)
        }
        None => None,
    };

    let mut candidate_sources = Vec::new();
    candidate_sources.extend(
        explicit_order
            .iter()
            .filter(|value| is_canonical_agent_id(value))
            .cloned()
            .map(|value| ("--to", value)),
    );
    candidate_sources.extend(inline_order.iter().cloned().map(|value| ("inline", value)));
    if let Some(recipient) = reply_default.as_ref() {
        candidate_sources.push(("reply", recipient.clone()));
    }

    let ancestor_agent_ids = load_lineage_agent_ids(transaction, request.source_agent_run_id)?;
    let active_agent_ids = load_active_camp_agent_ids(transaction, request.camp_id)?;
    for (source, value) in &candidate_sources {
        let reason = if value == request.author_agent_id {
            Some("self_target")
        } else if ancestor_agent_ids.contains(value) {
            Some("ancestor_cycle")
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

    if effective_recipients.len() > CAMP_MESSAGE_SEND_MAX_FANOUT {
        return Ok(rejected_with_details(
            "message.fanout_exceeded",
            "A public A2A send accepts at most 16 recipients",
            json!({
                "recipientCount": effective_recipients.len(),
                "absoluteLimit": CAMP_MESSAGE_SEND_MAX_FANOUT,
                "newRequestIdRequired": true,
            }),
        ));
    }
    if !effective_recipients.is_empty()
        && request.current_a2a_depth >= MESSAGE_DELIVERY_MAX_A2A_DEPTH
    {
        return Ok(rejected_with_details(
            "message.a2a_depth_exhausted",
            "This public A2A send would exceed the maximum delivery depth of five",
            json!({
                "currentDepth": request.current_a2a_depth,
                "maximumDepth": MESSAGE_DELIVERY_MAX_A2A_DEPTH,
                "newRequestIdRequired": true,
            }),
        ));
    }
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
    let linked_task_id = validate_task_link(
        transaction,
        request.camp_id,
        effective_recipients.first().map(String::as_str),
        request.task_id,
    )?;
    if request.task_id.is_some() && linked_task_id.is_none() {
        return Ok(rejected_with_details(
            "message.invalid_task",
            "taskId must identify a non-terminal Task assigned to the sole recipient in this Camp",
            json!({"newRequestIdRequired": true}),
        ));
    }

    let now_instant = camp_turn_execution_budget_now();
    let now = now_instant.to_rfc3339();
    let turn = transaction
        .query_row(
            r#"
            SELECT status, cancel_requested_at, execution_budget_exhausted_at,
                   execution_budget_deadline_at,
                   execution_budget_max_agent_run_responsibilities,
                   execution_budget_max_accepted_a2a,
                   execution_budget_root_agent_run_responsibilities,
                   a2a_run_slots_allocated
            FROM camp_turn
            WHERE id = ?1 AND camp_id = ?2
            "#,
            params![request.camp_turn_id, request.camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            },
        )
        .optional()?;
    let Some((
        turn_status,
        cancel_requested_at,
        budget_exhausted_at,
        deadline_at,
        max_agent_run_responsibilities,
        max_accepted_a2a,
        root_agent_run_responsibilities,
        allocated_a2a,
    )) = turn
    else {
        return Ok(rejected(
            "message.turn_not_active",
            "The source CampTurn does not exist",
        ));
    };
    if !matches!(turn_status.as_str(), "running" | "waiting")
        || cancel_requested_at.is_some()
        || budget_exhausted_at.is_some()
    {
        return Ok(rejected(
            "message.turn_not_active",
            "The current CampTurn is no longer accepting public sends",
        ));
    }

    let requested_slots = effective_recipients.len() as i64;
    let next_accepted_a2a = allocated_a2a + requested_slots;
    let next_responsibilities = root_agent_run_responsibilities + next_accepted_a2a;
    let deadline = chrono::DateTime::parse_from_rfc3339(&deadline_at)
        .context("CampTurn Execution Budget deadline is invalid")?
        .with_timezone(&chrono::Utc);
    if requested_slots > 0
        && (now_instant >= deadline
            || next_accepted_a2a > max_accepted_a2a
            || next_accepted_a2a > PRODUCT_MAX_ACCEPTED_A2A
            || next_responsibilities > max_agent_run_responsibilities)
    {
        return Ok(rejected_with_details(
            "message.execution_budget_exceeded",
            "The effective recipient set does not fit the remaining frozen CampTurn budget",
            json!({
                "requestedRecipients": requested_slots,
                "remainingAcceptedA2a": (max_accepted_a2a - allocated_a2a).max(0),
                "remainingAgentRunResponsibilities":
                    (max_agent_run_responsibilities
                        - root_agent_run_responsibilities
                        - allocated_a2a).max(0),
                "newRequestIdRequired": true,
            }),
        ));
    }
    if requested_slots > 0 {
        let updated = transaction.execute(
            r#"
            UPDATE camp_turn
            SET a2a_run_slots_allocated = a2a_run_slots_allocated + ?2,
                version = version + 1, updated_at = ?3
            WHERE id = ?1
              AND status IN ('running', 'waiting')
              AND cancel_requested_at IS NULL
              AND execution_budget_exhausted_at IS NULL
              AND execution_budget_deadline_at > ?3
              AND a2a_run_slots_allocated + ?2
                    <= execution_budget_max_accepted_a2a
              AND execution_budget_root_agent_run_responsibilities
                    + a2a_run_slots_allocated + ?2
                    <= execution_budget_max_agent_run_responsibilities
            "#,
            params![request.camp_turn_id, requested_slots, now],
        )?;
        if updated != 1 {
            anyhow::bail!("CampTurn changed before Message Delivery slots were reserved");
        }
    }

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
    let content = structured_content_from_inline_addressing(request.body, &inline.occurrences);
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
        "replyDefaultRecipient": reply_default,
    });
    let recipient_presentation_json = serde_json::to_string(&recipient_presentation)?;
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
            address_mode, addressed_agent_ids_json,
            reply_to_camp_message_id, camp_turn_id, agent_run_id,
            tombstoned_at, version, created_at, updated_at,
            effective_recipient_ids_json, recipient_set_digest,
            recipient_presentation_json, source_operation_id
        ) VALUES (
            ?1, ?2, ?3, 'agent', ?4, ?5, ?6, ?7, ?8,
            ?9, ?10, ?11, ?12, ?5,
            NULL, 1, ?13, ?13, ?10, ?14, ?15, ?16
        )
        "#,
        params![
            message_id,
            request.camp_id,
            camp_sequence,
            request.author_agent_id,
            request.source_agent_run_id,
            request.body,
            structured_content_json,
            content_digest,
            address_mode,
            recipients_json,
            request.reply_to_camp_message_id,
            request.camp_turn_id,
            now,
            recipient_set_digest,
            recipient_presentation_json,
            request.command_id,
        ],
    )?;
    index_camp_message(
        transaction,
        &message_id,
        request.camp_id,
        request.body,
        &recipients_json,
    )?;

    let actor = ActorRef::Agent {
        agent_id: request.author_agent_id.to_string(),
        source_agent_run_id: request.source_agent_run_id.to_string(),
    };
    let root_agent_run_id = request
        .current_a2a_root_agent_run_id
        .unwrap_or(request.source_agent_run_id);
    let target_depth = request.current_a2a_depth + 1;
    let lineage_snapshot = stable_unique(ancestor_agent_ids.iter().cloned());
    let mut delivery_ids = Vec::with_capacity(effective_recipients.len());
    for (position, recipient_agent_id) in effective_recipients.iter().enumerate() {
        let delivery_id = Uuid::new_v4().to_string();
        let queue_sequence: i64 = transaction.query_row(
            r#"
            SELECT COALESCE(MAX(queue_sequence), 0) + 1
            FROM message_delivery
            WHERE camp_id = ?1 AND recipient_agent_id = ?2
            "#,
            params![request.camp_id, recipient_agent_id],
            |row| row.get(0),
        )?;
        let recipient_digest = format!(
            "sha256:{}",
            canonical_json_digest(&Value::String(recipient_agent_id.clone()))?
        );
        let presentation_snapshot = json!({
            "inline": inline_order.contains(recipient_agent_id),
            "explicit": explicit_order.contains(recipient_agent_id),
            "replyDefault": reply_default.as_ref() == Some(recipient_agent_id),
        });
        let frozen_snapshot = json!({
            "schemaVersion": 1,
            "messageId": message_id,
            "campId": request.camp_id,
            "campTurnId": request.camp_turn_id,
            "recipientAgentId": recipient_agent_id,
            "recipientCanonicalPosition": position,
            "recipientDigest": recipient_digest,
            "messageBodyDigest": content_digest,
            "replyToCampMessageId": request.reply_to_camp_message_id,
            "taskId": linked_task_id,
            "sourceAgentRunId": request.source_agent_run_id,
            "a2aRootAgentRunId": root_agent_run_id,
            "a2aDepth": target_depth,
            "ancestorAgentIds": lineage_snapshot,
            "recipientPresentation": presentation_snapshot,
        });
        transaction.execute(
            r#"
            INSERT INTO message_delivery(
                id, camp_id, camp_turn_id, message_id,
                recipient_agent_id, recipient_canonical_position,
                recipient_digest, message_body_digest,
                reply_to_camp_message_id, task_id,
                source_agent_run_id, a2a_root_agent_run_id, a2a_depth,
                ancestor_agent_ids_json, recipient_presentation_snapshot_json,
                frozen_snapshot_json, queue_sequence,
                status, dispatch_phase, wait_condition,
                dispatch_attempt_count, active_dispatch_attempt_id,
                scheduler_correlation_id, context_manifest_id,
                target_agent_run_id, retry_generation,
                manual_intervention_required, failure_code, failure_detail_json,
                version, created_at, updated_at, ended_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                'pending', 'never_attempted', NULL,
                0, NULL, NULL, NULL, NULL, 0, 0, NULL, NULL,
                1, ?18, ?18, NULL
            )
            "#,
            params![
                delivery_id,
                request.camp_id,
                request.camp_turn_id,
                message_id,
                recipient_agent_id,
                position as i64,
                recipient_digest,
                content_digest,
                request.reply_to_camp_message_id,
                linked_task_id,
                request.source_agent_run_id,
                root_agent_run_id,
                target_depth,
                serde_json::to_string(&lineage_snapshot)?,
                serde_json::to_string(&presentation_snapshot)?,
                serde_json::to_string(&frozen_snapshot)?,
                queue_sequence,
                now,
            ],
        )?;
        crate::collaboration::append_domain_event(
            transaction,
            "message_delivery.accepted",
            Some(request.camp_id),
            Some(("message_delivery", &delivery_id)),
            &actor,
            Some(request.execution_epoch),
            &json!({
                "deliveryId": delivery_id,
                "messageId": message_id,
                "campTurnId": request.camp_turn_id,
                "recipientAgentId": recipient_agent_id,
                "recipientCanonicalPosition": position,
                "queueSequence": queue_sequence,
                "a2aDepth": target_depth,
            }),
        )?;
        delivery_ids.push(delivery_id);
    }
    crate::collaboration::append_domain_event(
        transaction,
        "camp_message.public_a2a_sent",
        Some(request.camp_id),
        Some(("camp_message", &message_id)),
        &actor,
        Some(request.execution_epoch),
        &json!({
            "messageId": message_id,
            "campTurnId": request.camp_turn_id,
            "effectiveRecipients": effective_recipients,
            "recipientSetDigest": recipient_set_digest,
            "deliveryIds": delivery_ids,
            "publicOnly": delivery_ids.is_empty(),
        }),
    )?;

    Ok(CommandHandlerResult::accepted(
        "camp_message.send_accepted",
        json!({
            "status": "accepted",
            "messageId": message_id,
            "visibility": "camp_public",
            "campTurnId": request.camp_turn_id,
            "effectiveRecipients": effective_recipients,
            "recipientPresentation": recipient_presentation,
            "recipientSetDigest": recipient_set_digest,
            "deliveryIds": delivery_ids,
            "allocatedAgentRunResponsibilities": next_responsibilities,
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
    process_dispatch_attempt(
        database,
        delivery_id,
        &attempt_id,
        recipient_capacity_available,
    )
}

pub(crate) fn settle_materialized_delivery_for_agent_run(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    agent_run_status: &str,
    agent_run_error_code: Option<&str>,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<Option<SettledDelivery>> {
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
    let (delivery_status, failure_code, manual_intervention_required) = match agent_run_status {
        "succeeded" => ("settled", None, 0_i64),
        "failed" => ("failed", Some("target_agent_run_failed"), 1_i64),
        "cancelled" => ("cancelled", Some("target_agent_run_cancelled"), 0_i64),
        _ => anyhow::bail!("non-terminal AgentRun cannot settle a Message Delivery"),
    };
    let failure_detail = agent_run_error_code
        .map(|code| serde_json::to_string(&json!({ "agentRunErrorCode": code })))
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
        }),
    )?;
    Ok(Some(SettledDelivery {
        delivery_id,
        camp_id,
        recipient_agent_id,
        status: delivery_status.to_string(),
    }))
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
            SELECT id, camp_id, active_dispatch_attempt_id
            FROM message_delivery
            WHERE camp_turn_id = ?1 AND status = 'pending'
            ORDER BY created_at, id
            "#,
        )?;
        statement
            .query_map([camp_turn_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (delivery_id, camp_id, active_attempt_id) in &deliveries {
        if let Some(attempt_id) = active_attempt_id {
            transaction.execute(
                r#"
                UPDATE message_delivery_attempt
                SET status = 'cancelled', failure_code = ?3, ended_at = ?4
                WHERE id = ?1 AND delivery_id = ?2 AND status = 'attempting'
                "#,
                params![attempt_id, delivery_id, failure_code, now],
            )?;
        }
        transaction.execute(
            r#"
            UPDATE message_delivery
            SET status = 'cancelled', dispatch_phase = 'terminal',
                wait_condition = NULL, active_dispatch_attempt_id = NULL,
                manual_intervention_required = 0, failure_code = ?2,
                version = version + 1, updated_at = ?3, ended_at = ?3
            WHERE id = ?1 AND status = 'pending'
            "#,
            params![delivery_id, failure_code, now],
        )?;
        append_domain_event(
            transaction,
            "message_delivery.cancelled",
            Some(camp_id),
            Some(("message_delivery", delivery_id)),
            actor,
            execution_epoch,
            &json!({
                "deliveryId": delivery_id,
                "failureCode": failure_code,
                "campTurnId": camp_turn_id,
            }),
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
            DeliveryDispatchTrigger::ExplicitRetry => phase == "never_attempted",
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

    let turn_state = transaction
        .query_row(
            r#"
            SELECT status, cancel_requested_at, execution_budget_exhausted_at,
                   execution_budget_deadline_at
            FROM camp_turn WHERE id = ?1 AND camp_id = ?2
            "#,
            params![delivery.camp_turn_id, delivery.camp_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?;
    let turn_active = turn_state.as_ref().is_some_and(|state| {
        matches!(state.0.as_str(), "running" | "waiting")
            && state.1.is_none()
            && state.2.is_none()
            && state.3 > now
    });
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

    if !recipient_is_eligible(
        &transaction,
        &delivery.camp_id,
        &delivery.recipient_agent_id,
    )? {
        let outcome = terminal_dispatch(
            &transaction,
            &delivery,
            attempt_id,
            "failed",
            "recipient_no_longer_eligible",
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
    if target_busy {
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

    let effective_config = build_effective_config(
        &transaction,
        &conversation_id,
        &delivery.recipient_agent_id,
        &runtime,
    )?;
    let caller_runtime_basis =
        capture_run_runtime_basis(&transaction, &delivery.source_agent_run_id)?;
    let workspace = AgentRunWorkspace::runtime_managed_path(
        caller_runtime_basis.workspace.execution_root.clone(),
    );
    workspace.validate()?;
    let current_conversation_boundary: i64 = transaction.query_row(
        "SELECT last_message_sequence FROM conversation WHERE id = ?1",
        [&conversation_id],
        |row| row.get(0),
    )?;
    let agent_run_id = Uuid::new_v4().to_string();
    let charter_delivery_mode = match runtime.adapter_kind {
        AdapterKind::AntigravityApp
        | AdapterKind::OpencodeCli
        | AdapterKind::CopilotCli
        | AdapterKind::KiroCli
        | AdapterKind::QoderCli
        | AdapterKind::CodebuddyCli
        | AdapterKind::QwenCode => CharterDeliveryMode::FirstPayload,
        AdapterKind::CodexCli | AdapterKind::ClaudeCodeCli => CharterDeliveryMode::NativeAppend,
    };
    let frozen_snapshot: String = transaction.query_row(
        "SELECT frozen_snapshot_json FROM message_delivery WHERE id = ?1",
        [&delivery.id],
        |row| row.get(0),
    )?;
    let mut frozen_snapshot_value: Value = serde_json::from_str(&frozen_snapshot)
        .context("Message Delivery frozen snapshot is invalid")?;
    let frozen_context = if let Some(context) = frozen_snapshot_value.get("frozenContext") {
        serde_json::from_value::<FrozenDeliveryContext>(context.clone())
            .context("Message Delivery frozen Context is invalid")?
    } else {
        let frozen = match ContextService::preflight_delivery_context(
            &transaction,
            &DeliveryContextPreview {
                agent_run_id: &agent_run_id,
                camp_id: &delivery.camp_id,
                camp_turn_id: &delivery.camp_turn_id,
                conversation_id: &conversation_id,
                agent_id: &delivery.recipient_agent_id,
                task_id: delivery.task_id.as_deref(),
                execution_epoch: 1,
                a2a_parent_agent_run_id: Some(&delivery.source_agent_run_id),
                a2a_root_agent_run_id: Some(&delivery.a2a_root_agent_run_id),
                a2a_depth: delivery.a2a_depth,
                camp_message_boundary_sequence: delivery.message_sequence,
                conversation_message_boundary_sequence: current_conversation_boundary,
                trigger_camp_message_id: Some(&delivery.message_id),
                effective_config: effective_config.clone(),
                workspace: serde_json::to_value(&workspace)?,
                runtime_installation_id: Some(runtime.installation_id.as_str()),
                runtime_binding_compatibility_digest: Some(
                    runtime.binding_compatibility_digest.as_str(),
                ),
                charter_delivery_mode,
                max_payload_bytes: DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
            },
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
    if frozen_context.charter_delivery_mode != charter_delivery_mode
        || frozen_context.camp_message_boundary_sequence != delivery.message_sequence
        || frozen_context.conversation_message_boundary_sequence > current_conversation_boundary
    {
        anyhow::bail!("Message Delivery frozen Context no longer matches its dispatch target");
    }
    let conversation_boundary = frozen_context.conversation_message_boundary_sequence;
    let expected_output = "Complete the requested work. Use `rovai send` only when publishing a public fact or when a recipient needs the message to continue acting or decide. Acceptance of a Delivery does not imply another Run completed; do not sleep or poll while waiting.";
    transaction.execute(
        r#"
        INSERT INTO agent_run(
            id, camp_turn_id, conversation_id, task_id,
            trigger_camp_message_id, trigger_message_delivery_id, input_ready_at,
            initial_camp_context_through_sequence,
            initial_conversation_context_through_sequence,
            responsibility_key, responsibility_generation,
            predecessor_agent_run_id, start_reason,
            purpose, expected_output, completion_role,
            effective_config_json, workspace_json, permission_semantics,
            runtime_adapter_kind, runtime_installation_id,
            runtime_executable_path, runtime_auth_scope,
            runtime_reported_version, runtime_executable_fingerprint,
            runtime_capabilities_json, runtime_model_selection_json,
            runtime_permission_config_json,
            runtime_binding_compatibility_digest,
            runtime_host_config_digest, runtime_protocol_version,
            runtime_installation_generation,
            runtime_search_environment_generation,
            runtime_native_session_compatibility_key,
            status, wait_reason, wait_deadline_at,
            idempotency_key, automatic_retry_count,
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
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
            ?10, 0, NULL, 'initial', ?11, ?12, 'required',
            ?13, ?14, 'runtime_managed_v2',
            ?15, ?16, ?17, ?18, ?19, ?20,
            ?21, ?22, ?23, ?24, ?25, ?26,
            ?27, ?28, ?29,
            'queued', NULL, NULL, ?30, 0,
            NULL, NULL, 0, NULL,
            0, NULL, NULL, NULL, NULL, NULL, 1,
            ?7, NULL, NULL, ?7,
            'a2a', ?31, ?32, ?33
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
            delivery.message_sequence,
            conversation_boundary,
            format!("message-delivery/{}", delivery.id),
            format!(
                "Handle public message from AgentRun {}",
                delivery.source_agent_run_id
            ),
            expected_output,
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
            delivery.source_agent_run_id,
            delivery.a2a_root_agent_run_id,
            delivery.a2a_depth,
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
            "triggerCampMessageId": delivery.message_id,
            "a2aParentAgentRunId": delivery.source_agent_run_id,
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
                   delivery.message_id, message.sequence,
                   delivery.recipient_agent_id, delivery.task_id,
                   delivery.source_agent_run_id, delivery.a2a_root_agent_run_id,
                   delivery.a2a_depth, delivery.retry_generation
            FROM message_delivery AS delivery
            JOIN camp_message AS message ON message.id = delivery.message_id
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
                    message_sequence: row.get(4)?,
                    recipient_agent_id: row.get(5)?,
                    task_id: row.get(6)?,
                    source_agent_run_id: row.get(7)?,
                    a2a_root_agent_run_id: row.get(8)?,
                    a2a_depth: row.get(9)?,
                    retry_generation: row.get(10)?,
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

fn recipient_is_eligible(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_id: &str,
) -> Result<bool> {
    transaction
        .query_row(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM camp_member
                JOIN agent_profile ON agent_profile.id = camp_member.agent_id
                WHERE camp_member.camp_id = ?1
                  AND camp_member.agent_id = ?2
                  AND camp_member.status = 'active'
                  AND camp_member.leave_requested_at IS NULL
                  AND agent_profile.profile_status = 'present'
            )
            "#,
            params![camp_id, agent_id],
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

fn validate_task_link(
    transaction: &Transaction<'_>,
    camp_id: &str,
    recipient_agent_id: Option<&str>,
    task_id: Option<&str>,
) -> Result<Option<String>> {
    let Some(task_id) = task_id else {
        return Ok(None);
    };
    let valid = transaction
        .query_row(
            r#"
            SELECT id
            FROM task
            WHERE id = ?1 AND camp_id = ?2 AND assignee_agent_id = ?3
              AND status IN ('pending', 'in_progress')
            "#,
            params![task_id, camp_id, recipient_agent_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(valid)
}

fn load_active_camp_agent_ids(
    transaction: &Transaction<'_>,
    camp_id: &str,
) -> Result<HashSet<String>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT camp_member.agent_id
        FROM camp_member
        JOIN agent_profile ON agent_profile.id = camp_member.agent_id
        WHERE camp_member.camp_id = ?1
          AND camp_member.status = 'active'
          AND camp_member.leave_requested_at IS NULL
          AND agent_profile.profile_status = 'present'
        "#,
    )?;
    Ok(statement
        .query_map([camp_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<HashSet<_>>>()?)
}

fn load_lineage_agent_ids(
    transaction: &Transaction<'_>,
    source_agent_run_id: &str,
) -> Result<BTreeSet<String>> {
    let mut statement = transaction.prepare(
        r#"
        WITH RECURSIVE lineage(id, parent_id) AS (
            SELECT id, a2a_parent_agent_run_id
            FROM agent_run
            WHERE id = ?1
            UNION ALL
            SELECT parent.id, parent.a2a_parent_agent_run_id
            FROM agent_run AS parent
            JOIN lineage ON parent.id = lineage.parent_id
        )
        SELECT DISTINCT conversation.agent_id
        FROM lineage
        JOIN agent_run ON agent_run.id = lineage.id
        JOIN conversation ON conversation.id = agent_run.conversation_id
        "#,
    )?;
    Ok(statement
        .query_map([source_agent_run_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<BTreeSet<_>>>()?)
}

fn stable_unique(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn is_canonical_agent_id(value: &str) -> bool {
    let Some(ordinal) = value.strip_prefix("agent_") else {
        return false;
    };
    !ordinal.is_empty()
        && !ordinal.starts_with('0')
        && ordinal.bytes().all(|byte| byte.is_ascii_digit())
}

fn parse_inline_addressing(body: &str) -> InlineAddressing {
    let bytes = body.as_bytes();
    let mut occurrences = Vec::new();
    let mut malformed = Vec::new();
    let mut index = 0_usize;
    let mut fenced = false;
    let mut inline_code = false;
    while index < bytes.len() {
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
        if fenced || inline_code || !bytes[index..].starts_with(b"@agent_") {
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
            .rfind(char::is_whitespace)
            .map(|position| position + 1)
            .unwrap_or(0);
        if body[token_start..index].contains("://") {
            index += 1;
            continue;
        }
        let mut end = index + "@agent_".len();
        while end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_') {
            end += 1;
        }
        let value = body[index + 1..end].to_string();
        if is_canonical_agent_id(&value) {
            occurrences.push(InlineAddressingOccurrence {
                agent_id: value,
                start_byte: index,
                end_byte: end,
                ordinal: occurrences.len(),
            });
        } else {
            malformed.push(format!("@{value}"));
        }
        index = end;
    }
    InlineAddressing {
        occurrences,
        malformed,
    }
}

fn structured_content_from_inline_addressing(
    body: &str,
    occurrences: &[InlineAddressingOccurrence],
) -> Vec<StructuredCampMessageSegment> {
    let mut content = Vec::with_capacity(occurrences.len().saturating_mul(2).saturating_add(1));
    let mut cursor = 0_usize;
    for occurrence in occurrences {
        if cursor < occurrence.start_byte {
            content.push(StructuredCampMessageSegment::Text {
                text: body[cursor..occurrence.start_byte].to_string(),
            });
        }
        content.push(StructuredCampMessageSegment::MemberMention {
            agent_id: occurrence.agent_id.clone(),
        });
        cursor = occurrence.end_byte;
    }
    if cursor < body.len() {
        content.push(StructuredCampMessageSegment::Text {
            text: body[cursor..].to_string(),
        });
    }
    normalize_content(content)
}

fn rejected(code: &str, message: &str) -> CommandHandlerResult {
    CommandHandlerResult::rejected(code, json!({ "message": message }))
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

    #[test]
    fn strict_inline_parser_ignores_literal_regions_and_preserves_source_order() {
        let parsed = parse_inline_addressing(
            r#"@agent_104 then @agent_27 and @agent_104 `@agent_9` \@agent_8
https://example.test/@agent_7
```
@agent_6
```"#,
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
        let parsed = parse_inline_addressing("@agent_0 @agent_01 @agent_x @agent_22");
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
    fn canonical_agent_ids_are_opaque_positive_decimal_identities() {
        assert!(is_canonical_agent_id("agent_2"));
        assert!(is_canonical_agent_id("agent_104"));
        assert!(!is_canonical_agent_id("agent_02"));
        assert!(!is_canonical_agent_id("agent_two"));

        let mut values = vec!["agent_9".to_string(), "agent_104".to_string()];
        values.sort_by(|left, right| left.as_bytes().cmp(right.as_bytes()));
        assert_eq!(values, vec!["agent_104", "agent_9"]);
    }
}
