use std::collections::{BTreeSet, HashSet};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    agent_identity::parse_agent_id,
    agent_profile::{AdapterKind, resolve_frozen_runtime},
    camp_attachment_publication::{AuthorityAttachment, CampAttachmentPublicationCoordinator},
    camp_content::{
        StructuredCampMessageSegment, canonical_content_digest, normalize_content,
        render_current_plain_text,
    },
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
    current_user::CURRENT_USER_ID,
    db::Database,
    execution_budget::{PRODUCT_MAX_ACCEPTED_A2A, camp_turn_execution_budget_now},
    gather::{
        GATHER_CAPTURED_MESSAGES_MAX_PER_ITEM_GENERATION, GATHER_COMPLETION_CONTEXT_MAX_BYTES,
        GatherAcceptance, GatherCapture, cancel_gather_for_delivery, cancel_gathers_for_turn,
        completion_delivery_for_item, mark_completion_materialized, mark_item_materialized,
        persist_gather_item, persist_gather_record, reopen_item_for_retry, resolve_gather_capture,
        settle_completion_for_agent_run, settle_item_from_agent_run_terminal,
        settle_item_from_delivery_terminal, validate_completion_retry,
    },
    runtime::AgentRunWorkspace,
    runtime_basis::capture_run_runtime_basis,
};

pub const CAMP_MESSAGE_SEND_TOOL_NAME: &str = "camp.message.send";
pub const CAMP_MESSAGE_SEND_MAX_BODY_BYTES: usize = 32 * 1024;
pub const CAMP_MESSAGE_SEND_MAX_FANOUT: usize = 16;
pub const MESSAGE_DELIVERY_MAX_A2A_DEPTH: i64 = 5;

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
                    SELECT camp_id, status, version, retry_generation,
                           delivery_kind, gather_id, failure_code
                    FROM message_delivery WHERE id = ?1
                    "#,
                    [&envelope.payload.delivery_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, Option<String>>(6)?,
                        ))
                    },
                )
                .optional()?;
            let Some((
                camp_id,
                status,
                version,
                retry_generation,
                delivery_kind,
                gather_id,
                failure_code,
            )) = target
            else {
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
            if failure_code.as_deref() == Some("attachment_projection_failed") {
                return Ok(rejected(
                    "message_delivery.retry_not_allowed",
                    "The message attachment projection failed permanently",
                ));
            }
            if delivery_kind == "gather_completion"
                && !validate_completion_retry(transaction, &envelope.payload.delivery_id)?
            {
                return Ok(rejected(
                    "message_delivery.retry_not_allowed",
                    "A Gather Completion Delivery cannot create a second continuation",
                ));
            }
            if delivery_kind == "public_a2a" && gather_id.is_some() {
                let gather_status: String = transaction.query_row(
                    r#"
                    SELECT gather.status
                    FROM gather_item AS item
                    JOIN gather_record AS gather ON gather.id = item.gather_id
                    WHERE item.dispatch_delivery_id = ?1
                    "#,
                    [&envelope.payload.delivery_id],
                    |row| row.get(0),
                )?;
                if gather_status != "collecting" {
                    return Ok(rejected(
                        "message_delivery.retry_not_allowed",
                        "A Gather forward Delivery cannot be retried after the Barrier is ready",
                    ));
                }
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
                    target_agent_run_id = NULL,
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
            if delivery_kind == "public_a2a" && gather_id.is_some() {
                reopen_item_for_retry(
                    transaction,
                    &envelope.payload.delivery_id,
                    next_generation,
                    &now,
                )?;
            }
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
        let delivery_id = envelope.payload.delivery_id.clone();
        let execution = self.gateway.execute(database, envelope, |transaction| {
            let target = transaction
                .query_row(
                    r#"
                    SELECT camp_id, camp_turn_id, status, dispatch_phase, version,
                           delivery_kind
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
                            row.get::<_, String>(5)?,
                        ))
                    },
                )
                .optional()?;
            let Some((camp_id, camp_turn_id, status, phase, version, delivery_kind)) = target
            else {
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
            if delivery_kind == "gather_completion" {
                cancel_gather_for_delivery(
                    transaction,
                    &envelope.payload.delivery_id,
                    "explicit_completion_delivery_cancelled",
                    &envelope.actor,
                    None,
                    &now,
                )?;
            }
            settle_item_from_delivery_terminal(
                transaction,
                &envelope.payload.delivery_id,
                "cancelled",
                Some("explicit_cancelled"),
                &envelope.actor,
                None,
                &now,
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
        })?;
        if !execution.replayed
            && execution.result.status != crate::command::CommandResultStatus::Rejected
            && let Some(completion_delivery_id) =
                completion_delivery_for_item(database.connection(), &delivery_id)?
        {
            let _ = dispatch_delivery(
                database,
                &completion_delivery_id,
                DeliveryDispatchTrigger::Accepted,
                true,
            )?;
        }
        Ok(execution)
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
    camp_message_boundary_sequence: i64,
    recipient_agent_id: String,
    task_id: Option<String>,
    task_version_at_admission: Option<i64>,
    assignee_agent_id_at_admission: Option<String>,
    source_agent_run_id: String,
    delivery_kind: String,
    completion_role: String,
    gather_id: Option<String>,
    target_conversation_id: Option<String>,
    edge_kind: Option<String>,
    target_parent_agent_run_id: Option<String>,
    return_to_agent_run_id: Option<String>,
    a2a_root_agent_run_id: Option<String>,
    a2a_depth: i64,
    retry_generation: i64,
}

#[derive(Debug, Clone)]
pub enum PublicA2aOperation<'a> {
    Send,
    Gather {
        gather_id: &'a str,
        initiator_conversation_id: &'a str,
    },
}

impl PublicA2aOperation<'_> {
    fn is_gather(&self) -> bool {
        matches!(self, Self::Gather { .. })
    }
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
    pub agent_addressing_mode: AgentAddressingMode,
    pub mention_user: bool,
    pub task_id: Option<&'a str>,
    pub attachments: &'a [AuthorityAttachment],
    pub operation: PublicA2aOperation<'a>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ImmediateCaller {
    agent_run_id: String,
    agent_id: String,
    parent_agent_run_id: Option<String>,
    root_agent_run_id: String,
    a2a_depth: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DeliveryLineage {
    edge_kind: &'static str,
    target_parent_agent_run_id: Option<String>,
    return_to_agent_run_id: Option<String>,
    root_agent_run_id: String,
    a2a_depth: i64,
    ancestor_agent_ids: Vec<String>,
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct ActiveCampAgent {
    agent_id: String,
    display_name: String,
}

pub fn persist_public_a2a_message(
    transaction: &Transaction<'_>,
    request: &SendPublicA2aMessage<'_>,
) -> Result<CommandHandlerResult> {
    let is_gather = request.operation.is_gather();
    if is_gather {
        let default_lead_agent_id = transaction
            .query_row(
                "SELECT default_lead_agent_id FROM camp WHERE id = ?1",
                [request.camp_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        if default_lead_agent_id.as_deref() != Some(request.author_agent_id) {
            return Ok(rejected(
                "gather.default_lead_required",
                "Only the current Camp Default Lead may start a Gather",
            ));
        }
        if request.mention_user || request.task_id.is_some() {
            return Ok(rejected(
                "gather.addressing_invalid",
                "Gather accepts only one shared body and recipient targets",
            ));
        }
    }
    if !is_gather && request.agent_addressing_mode == AgentAddressingMode::PublicOnly {
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
    let reply_to_camp_message_id =
        load_trigger_reply_reference(transaction, request.source_agent_run_id, request.camp_id)?;
    let automatic_addressing =
        is_gather || request.agent_addressing_mode == AgentAddressingMode::Automatic;
    let active_agents = if automatic_addressing {
        load_active_camp_agents(transaction, request.camp_id)?
    } else {
        Vec::new()
    };
    let active_agent_ids = active_agents
        .iter()
        .map(|agent| agent.agent_id.clone())
        .collect::<HashSet<_>>();
    let inline = if automatic_addressing {
        parse_inline_addressing(request.body, &active_agents)
    } else {
        InlineAddressing {
            occurrences: Vec::new(),
            malformed: Vec::new(),
        }
    };
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
        .into_iter()
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

    let ancestor_agent_ids = if automatic_addressing {
        load_lineage_agent_ids(transaction, request.source_agent_run_id)?
    } else {
        BTreeSet::new()
    };
    let immediate_caller = if automatic_addressing {
        load_immediate_caller(transaction, request.source_agent_run_id)?
    } else {
        None
    };
    for (source, value) in &candidate_sources {
        let is_immediate_caller = !is_gather
            && immediate_caller
                .as_ref()
                .is_some_and(|caller| caller.agent_id == *value);
        let reason = if value == request.author_agent_id {
            Some("self_target")
        } else if ancestor_agent_ids.contains(value) && !is_immediate_caller {
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
            if is_gather {
                "gather.addressing_invalid"
            } else {
                "message.addressing_invalid"
            },
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

    if is_gather && effective_recipients.is_empty() {
        return Ok(rejected(
            "gather.no_recipients",
            "Gather requires at least one effective recipient",
        ));
    }

    if effective_recipients.len() > CAMP_MESSAGE_SEND_MAX_FANOUT {
        return Ok(rejected_with_details(
            if is_gather {
                "gather.fanout_exceeded"
            } else {
                "message.fanout_exceeded"
            },
            if is_gather {
                "A Gather accepts at most 16 recipients"
            } else {
                "A public A2A send accepts at most 16 recipients"
            },
            json!({
                "recipientCount": effective_recipients.len(),
                "absoluteLimit": CAMP_MESSAGE_SEND_MAX_FANOUT,
                "newRequestIdRequired": true,
            }),
        ));
    }
    let has_forward_recipient = is_gather
        || effective_recipients.iter().any(|recipient| {
            !immediate_caller
                .as_ref()
                .is_some_and(|caller| caller.agent_id == *recipient)
        });
    if has_forward_recipient && request.current_a2a_depth >= MESSAGE_DELIVERY_MAX_A2A_DEPTH {
        return Ok(rejected_with_details(
            if is_gather {
                "gather.addressing_invalid"
            } else {
                "message.a2a_depth_exhausted"
            },
            "A forward recipient would exceed the maximum delivery depth of five",
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
    let task_admission = if let (Some(task_id), Some(recipient_agent_id)) =
        (request.task_id, effective_recipients.first())
    {
        crate::collaboration::task_link_admission(
            transaction,
            task_id,
            request.camp_id,
            recipient_agent_id,
        )?
    } else {
        None
    };
    if request.task_id.is_some() && task_admission.is_none() {
        return Ok(rejected_with_details(
            "message.invalid_task",
            "taskId must identify a non-terminal Task assigned to the sole recipient in this Camp",
            json!({"newRequestIdRequired": true}),
        ));
    }
    let linked_task_id = task_admission
        .as_ref()
        .map(|_| request.task_id.expect("admitted Task"));

    let captures = effective_recipients
        .iter()
        .map(|recipient| {
            if is_gather
                || !immediate_caller
                    .as_ref()
                    .is_some_and(|caller| caller.agent_id == *recipient)
            {
                Ok(None)
            } else {
                resolve_gather_capture(transaction, request.source_agent_run_id, recipient)
            }
        })
        .collect::<Result<Vec<Option<GatherCapture>>>>()?;
    let captured_return_count = captures.iter().filter(|capture| capture.is_some()).count() as i64;
    for capture in captures.iter().flatten() {
        let captured_count: i64 = transaction.query_row(
            r#"
            SELECT COUNT(*)
            FROM message_delivery AS captured
            JOIN agent_run AS source_run ON source_run.id = captured.source_agent_run_id
            WHERE captured.gather_dispatch_delivery_id = ?1
              AND captured.delivery_kind = 'public_a2a'
              AND captured.dispatch_disposition = 'gather_captured'
              AND captured.status = 'settled'
              AND captured.source_agent_run_id = ?2
              AND source_run.trigger_message_delivery_id = ?1
              AND source_run.trigger_delivery_generation = ?3
            "#,
            params![
                capture.dispatch_delivery_id,
                request.source_agent_run_id,
                capture.source_retry_generation,
            ],
            |row| row.get(0),
        )?;
        if captured_count >= GATHER_CAPTURED_MESSAGES_MAX_PER_ITEM_GENERATION {
            return Ok(rejected_with_details(
                "message.execution_budget_exceeded",
                "This Gather Item retry generation has reached its captured-return limit",
                json!({
                    "limitScope": "gather_captured_messages_per_item_generation",
                    "dispatchDeliveryId": capture.dispatch_delivery_id,
                    "retryGeneration": capture.source_retry_generation,
                    "maxCapturedMessages": GATHER_CAPTURED_MESSAGES_MAX_PER_ITEM_GENERATION,
                    "newRequestIdRequired": true,
                }),
            ));
        }
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
                   accepted_a2a_allocated,
                   agent_run_responsibilities_allocated
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
                    row.get::<_, i64>(8)?,
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
        allocated_accepted_a2a,
        allocated_run_responsibilities,
    )) = turn
    else {
        return Ok(rejected(
            if is_gather {
                "gather.turn_not_active"
            } else {
                "message.turn_not_active"
            },
            "The source CampTurn does not exist",
        ));
    };
    if !matches!(turn_status.as_str(), "running" | "waiting")
        || cancel_requested_at.is_some()
        || budget_exhausted_at.is_some()
    {
        return Ok(rejected(
            if is_gather {
                "gather.turn_not_active"
            } else {
                "message.turn_not_active"
            },
            "The current CampTurn is no longer accepting public sends",
        ));
    }

    // A durable Gather return settles without materializing a new AgentRun. It has
    // an independent per-Item/per-generation bound above and therefore consumes
    // neither the ordinary accepted-A2A allowance nor a Run responsibility.
    let requested_accepted_a2a = effective_recipients.len() as i64 - captured_return_count;
    let requested_run_responsibilities = requested_accepted_a2a + i64::from(is_gather);
    let next_accepted_a2a = allocated_accepted_a2a + requested_accepted_a2a;
    let next_allocated_run_responsibilities =
        allocated_run_responsibilities + requested_run_responsibilities;
    let next_responsibilities =
        root_agent_run_responsibilities + next_allocated_run_responsibilities;
    let deadline = chrono::DateTime::parse_from_rfc3339(&deadline_at)
        .context("CampTurn Execution Budget deadline is invalid")?
        .with_timezone(&chrono::Utc);
    // Preserve recipient-free public narration after the execution deadline,
    // while keeping both ordinary dispatch and the independently-budgeted
    // Gather capture inside the frozen CampTurn deadline.
    if now_instant >= deadline && (requested_accepted_a2a > 0 || captured_return_count > 0) {
        return Ok(rejected_with_details(
            if is_gather {
                "gather.execution_budget_exceeded"
            } else {
                "message.execution_budget_exceeded"
            },
            "The frozen CampTurn execution deadline has elapsed",
            json!({
                "requestedRecipients": effective_recipients.len(),
                "requestedAcceptedA2a": requested_accepted_a2a,
                "newRequestIdRequired": true,
            }),
        ));
    }
    if requested_accepted_a2a > 0
        && (next_accepted_a2a > max_accepted_a2a
            || next_accepted_a2a > PRODUCT_MAX_ACCEPTED_A2A
            || next_responsibilities > max_agent_run_responsibilities)
    {
        return Ok(rejected_with_details(
            if is_gather {
                "gather.execution_budget_exceeded"
            } else {
                "message.execution_budget_exceeded"
            },
            "The effective recipient set does not fit the remaining frozen CampTurn budget",
            json!({
                "requestedRecipients": effective_recipients.len(),
                "requestedAcceptedA2a": requested_accepted_a2a,
                "requestedAgentRunResponsibilities": requested_run_responsibilities,
                "remainingAcceptedA2a": (max_accepted_a2a - allocated_accepted_a2a).max(0),
                "remainingAgentRunResponsibilities":
                    (max_agent_run_responsibilities
                        - root_agent_run_responsibilities
                        - allocated_run_responsibilities).max(0),
                "newRequestIdRequired": true,
            }),
        ));
    }
    if requested_accepted_a2a > 0 {
        let updated = transaction.execute(
            r#"
            UPDATE camp_turn
            SET a2a_run_slots_allocated = a2a_run_slots_allocated + ?2,
                accepted_a2a_allocated = accepted_a2a_allocated + ?2,
                agent_run_responsibilities_allocated =
                    agent_run_responsibilities_allocated + ?3,
                version = version + 1, updated_at = ?4
            WHERE id = ?1
              AND status IN ('running', 'waiting')
              AND cancel_requested_at IS NULL
              AND execution_budget_exhausted_at IS NULL
              AND execution_budget_deadline_at > ?4
              AND accepted_a2a_allocated + ?2
                    <= execution_budget_max_accepted_a2a
              AND execution_budget_root_agent_run_responsibilities
                    + agent_run_responsibilities_allocated + ?3
                    <= execution_budget_max_agent_run_responsibilities
            "#,
            params![
                request.camp_turn_id,
                requested_accepted_a2a,
                requested_run_responsibilities,
                now
            ],
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
    let content = structured_content_from_inline_addressing(
        request.body,
        &inline.occurrences,
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
            recipient_presentation_json, source_operation_id,
            agent_addressing_mode
        ) VALUES (
            ?1, ?2, ?3, 'agent', ?4, ?5, ?6, ?7, ?8,
            ?9, ?10, ?11, ?12, ?5,
            NULL, 1, ?13, ?13, ?10, ?14, ?15, ?16, ?17
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
            address_mode,
            recipients_json,
            reply_to_camp_message_id,
            request.camp_turn_id,
            now,
            recipient_set_digest,
            recipient_presentation_json,
            request.command_id,
            if is_gather {
                None
            } else {
                Some(request.agent_addressing_mode.as_str())
            },
        ],
    )?;
    let attachment_publication = CampAttachmentPublicationCoordinator.commit_agent_intent(
        transaction,
        request.camp_id,
        &message_id,
        request.command_id,
        request.attachments,
    )?;
    for (position, attachment) in request.attachments.iter().enumerate() {
        let publication = attachment_publication
            .as_ref()
            .context("Agent attachment publication aggregate is missing")?;
        transaction.execute(
            r#"
            INSERT INTO message_attachment(
                id, camp_id, camp_message_id, conversation_message_id,
                position, display_name, media_type, byte_size,
                content_digest, storage_path, preview_kind,
                created_by_type, created_by_id, created_at,
                runtime_projection_state, publication_operation_id,
                publication_semantic_revision
            ) VALUES (
                ?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7,
                ?8, ?9, ?10, 'agent', ?11, ?12,
                'pending', ?13, ?14
            )
            "#,
            params![
                attachment.attachment_id,
                request.camp_id,
                message_id,
                position as i64,
                attachment.display_name,
                attachment.media_type,
                attachment.byte_size as i64,
                attachment.content_digest,
                attachment.storage_path.to_string_lossy(),
                attachment.preview_kind,
                request.author_agent_id,
                now,
                publication.operation_id,
                publication.semantic_revision,
            ],
        )?;
    }
    index_camp_message(
        transaction,
        &message_id,
        request.camp_id,
        &projected_body,
        &recipients_json,
    )?;

    let actor = ActorRef::Agent {
        agent_id: request.author_agent_id.to_string(),
        source_agent_run_id: request.source_agent_run_id.to_string(),
    };
    if let PublicA2aOperation::Gather {
        gather_id,
        initiator_conversation_id,
    } = &request.operation
    {
        persist_gather_record(
            transaction,
            &GatherAcceptance {
                gather_id,
                command_id: request.command_id,
                camp_id: request.camp_id,
                camp_turn_id: request.camp_turn_id,
                request_message_id: &message_id,
                initiator_agent_id: request.author_agent_id,
                initiator_agent_run_id: request.source_agent_run_id,
                initiator_conversation_id,
                now: &now,
            },
        )?;
    }
    let root_agent_run_id = request
        .current_a2a_root_agent_run_id
        .unwrap_or(request.source_agent_run_id);
    let forward_lineage_snapshot = stable_unique(ancestor_agent_ids.iter().cloned());
    let return_lineage_snapshot = match immediate_caller
        .as_ref()
        .and_then(|caller| caller.parent_agent_run_id.as_deref())
    {
        Some(parent_agent_run_id) => {
            stable_unique(load_lineage_agent_ids(transaction, parent_agent_run_id)?)
        }
        None => Vec::new(),
    };
    let mut delivery_ids = Vec::with_capacity(effective_recipients.len());
    for (position, recipient_agent_id) in effective_recipients.iter().enumerate() {
        let lineage = if !is_gather
            && let Some(caller) = immediate_caller
                .as_ref()
                .filter(|caller| caller.agent_id == *recipient_agent_id)
        {
            DeliveryLineage {
                edge_kind: "return",
                target_parent_agent_run_id: caller.parent_agent_run_id.clone(),
                return_to_agent_run_id: Some(caller.agent_run_id.clone()),
                root_agent_run_id: caller.root_agent_run_id.clone(),
                a2a_depth: caller.a2a_depth,
                ancestor_agent_ids: return_lineage_snapshot.clone(),
            }
        } else {
            DeliveryLineage {
                edge_kind: "forward",
                target_parent_agent_run_id: Some(request.source_agent_run_id.to_string()),
                return_to_agent_run_id: None,
                root_agent_run_id: root_agent_run_id.to_string(),
                a2a_depth: request.current_a2a_depth + 1,
                ancestor_agent_ids: forward_lineage_snapshot.clone(),
            }
        };
        let capture = captures[position].as_ref();
        let gather_id = match (&request.operation, capture) {
            (PublicA2aOperation::Gather { gather_id, .. }, _) => Some(*gather_id),
            (_, Some(capture)) => Some(capture.gather_id.as_str()),
            _ => None,
        };
        let dispatch_disposition = if capture.is_some() {
            "gather_captured"
        } else {
            "dispatch"
        };
        let completion_role = if capture.is_some() {
            None
        } else if is_gather {
            Some("optional")
        } else {
            Some("required")
        };
        let initial_status = if capture.is_some() {
            "settled"
        } else {
            "pending"
        };
        let initial_phase = if capture.is_some() {
            "terminal"
        } else {
            "never_attempted"
        };
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
        });
        let frozen_snapshot = json!({
            "schemaVersion": 3,
            "deliveryKind": "public_a2a",
            "dispatchDisposition": dispatch_disposition,
            "completionRole": completion_role,
            "gatherId": gather_id,
            "gatherDispatchDeliveryId": capture.map(|value| value.dispatch_delivery_id.as_str()),
            "gatherSourceRetryGeneration": capture.map(|value| value.source_retry_generation),
            "messageId": message_id,
            "campId": request.camp_id,
            "campTurnId": request.camp_turn_id,
            "recipientAgentId": recipient_agent_id,
            "recipientCanonicalPosition": position,
            "recipientDigest": recipient_digest,
            "messageBodyDigest": content_digest,
            "replyToCampMessageId": reply_to_camp_message_id,
            "taskId": linked_task_id,
            "taskVersionAtAdmission": task_admission.as_ref().map(|value| value.task_version),
            "assigneeAgentIdAtAdmission": task_admission.as_ref().map(|value| value.assignee_agent_id.as_str()),
            "sourceAgentRunId": request.source_agent_run_id,
            "edgeKind": lineage.edge_kind,
            "targetParentAgentRunId": lineage.target_parent_agent_run_id,
            "returnToAgentRunId": lineage.return_to_agent_run_id,
            "a2aRootAgentRunId": lineage.root_agent_run_id,
            "a2aDepth": lineage.a2a_depth,
            "ancestorAgentIds": lineage.ancestor_agent_ids,
            "recipientPresentation": presentation_snapshot,
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
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                ?9, ?10, ?23, ?24, ?11, ?12, ?13, ?14, ?15, ?16,
                ?17, ?18, ?19,
                'public_a2a', ?25, ?26, ?27, ?28, NULL, ?20, ?21,
                ?29, ?30, NULL,
                0, NULL, NULL, NULL, NULL, 0, 0, NULL, NULL,
                1, ?22, ?22, ?31
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
                reply_to_camp_message_id,
                linked_task_id,
                request.source_agent_run_id,
                lineage.edge_kind,
                lineage.target_parent_agent_run_id,
                lineage.return_to_agent_run_id,
                lineage.root_agent_run_id,
                lineage.a2a_depth,
                serde_json::to_string(&lineage.ancestor_agent_ids)?,
                serde_json::to_string(&presentation_snapshot)?,
                serde_json::to_string(&frozen_snapshot)?,
                camp_sequence,
                queue_sequence,
                now,
                task_admission.as_ref().map(|value| value.task_version),
                task_admission
                    .as_ref()
                    .map(|value| value.assignee_agent_id.as_str()),
                dispatch_disposition,
                completion_role,
                gather_id,
                capture.map(|value| value.dispatch_delivery_id.as_str()),
                initial_status,
                initial_phase,
                capture.map(|_| now.as_str()),
            ],
        )?;
        if is_gather {
            persist_gather_item(
                transaction,
                gather_id.context("Gather forward Delivery has no Gather identity")?,
                &delivery_id,
                recipient_agent_id,
                &now,
            )?;
        }
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
                "deliveryKind": "public_a2a",
                "dispatchDisposition": dispatch_disposition,
                "completionRole": completion_role,
                "gatherId": gather_id,
                "gatherDispatchDeliveryId": capture.map(|value| value.dispatch_delivery_id.as_str()),
                "edgeKind": lineage.edge_kind,
                "targetParentAgentRunId": lineage.target_parent_agent_run_id,
                "returnToAgentRunId": lineage.return_to_agent_run_id,
                "a2aDepth": lineage.a2a_depth,
            }),
        )?;
        delivery_ids.push(delivery_id);
    }
    if let Some(publication) = attachment_publication.as_ref() {
        CampAttachmentPublicationCoordinator.gate_deliveries(
            transaction,
            &delivery_ids,
            &publication.operation_id,
        )?;
    }
    crate::collaboration::append_domain_event(
        transaction,
        "camp_message.public_a2a_sent",
        Some(request.camp_id),
        Some(("camp_message", &message_id)),
        &actor,
        Some(request.execution_epoch),
        &json!({
            "schemaVersion": 2,
            "messageId": message_id,
            "campTurnId": request.camp_turn_id,
            "effectiveRecipients": effective_recipients,
            "recipientSetDigest": recipient_set_digest,
            "deliveryIds": delivery_ids,
            "recipientFree": delivery_ids.is_empty(),
            "agentAddressingMode": if is_gather {
                Value::Null
            } else {
                Value::String(request.agent_addressing_mode.as_str().to_string())
            },
            "operation": if is_gather { "gather" } else { "send" },
        }),
    )?;

    if let PublicA2aOperation::Gather { gather_id, .. } = &request.operation {
        append_domain_event(
            transaction,
            "gather.accepted",
            Some(request.camp_id),
            Some(("gather", gather_id)),
            &actor,
            Some(request.execution_epoch),
            &json!({
                "gatherId": gather_id,
                "requestMessageId": message_id,
                "campTurnId": request.camp_turn_id,
                "effectiveRecipients": effective_recipients,
                "dispatchDeliveryIds": delivery_ids,
                "completion": "deferred",
            }),
        )?;
        return Ok(CommandHandlerResult::accepted(
            "gather.accepted",
            json!({
                "status": "accepted",
                "gatherId": gather_id,
                "requestMessageId": message_id,
                "campTurnId": request.camp_turn_id,
                "effectiveRecipients": effective_recipients,
                "dispatchDeliveryIds": delivery_ids,
                "completion": "deferred",
                "allocatedAgentRunResponsibilities": next_responsibilities,
            }),
            Some(EntityReference {
                entity_type: "gather".to_string(),
                entity_id: (*gather_id).to_string(),
            }),
        ));
    }

    Ok(CommandHandlerResult::accepted(
        "camp_message.send_accepted",
        json!({
            "status": "accepted",
            "messageId": message_id,
            "visibility": "camp_public",
            "campTurnId": request.camp_turn_id,
            "agentAddressingMode": request.agent_addressing_mode,
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
        settle_item_from_delivery_terminal(
            &transaction,
            delivery_id,
            "interrupted_before_dispatch",
            Some("interrupted_before_dispatch"),
            &actor,
            None,
            &now,
        )?;
    }
    let barrier_completion_ids = {
        let mut statement = transaction.prepare(
            r#"
            SELECT id
            FROM message_delivery
            WHERE delivery_kind = 'gather_completion'
              AND status = 'pending'
              AND dispatch_phase = 'never_attempted'
              AND dispatch_attempt_count = 0
            ORDER BY created_at, id
            "#,
        )?;
        statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for delivery_id in &barrier_completion_ids {
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
                    "message": "该 Gather Completion 因上次运行中断而未开始",
                }))?,
                now,
            ],
        )?;
    }
    transaction.commit()?;
    Ok(delivery_ids.len() + barrier_completion_ids.len())
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
        settle_item_from_delivery_terminal(
            transaction,
            delivery_id,
            "failed",
            Some("attachment_projection_failed"),
            &actor,
            None,
            now,
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
    if matches!(outcome, DeliveryDispatchOutcome::Terminal { .. })
        && let Some(completion_delivery_id) =
            completion_delivery_for_item(database.connection(), delivery_id)?
    {
        let _ = dispatch_delivery(
            database,
            &completion_delivery_id,
            DeliveryDispatchTrigger::Accepted,
            true,
        )?;
    }
    Ok(outcome)
}

pub(crate) struct AgentRunDeliverySettlement<'a> {
    pub agent_run_id: &'a str,
    pub agent_run_status: &'a str,
    pub agent_run_error_code: Option<&'a str>,
    pub terminal_resolution_source: Option<&'a str>,
    pub terminal_reason_code: Option<&'a str>,
    pub final_output: Option<&'a str>,
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
        final_output,
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
    settle_item_from_agent_run_terminal(
        transaction,
        agent_run_id,
        agent_run_status,
        final_output,
        agent_run_error_code.or(failure_code),
        terminal_resolution_source,
        terminal_reason_code,
        actor,
        execution_epoch,
        now,
    )?;
    settle_completion_for_agent_run(
        transaction,
        agent_run_id,
        agent_run_status,
        agent_run_error_code.or(failure_code),
        actor,
        execution_epoch,
        now,
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

pub(crate) fn cancel_pending_turn_deliveries(
    transaction: &Transaction<'_>,
    camp_turn_id: &str,
    failure_code: &str,
    actor: &ActorRef,
    execution_epoch: Option<i64>,
    now: &str,
) -> Result<usize> {
    cancel_gathers_for_turn(
        transaction,
        camp_turn_id,
        failure_code,
        actor,
        execution_epoch,
        now,
    )?;
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
        if delivery.delivery_kind == "gather_completion" {
            cancel_gather_for_delivery(
                &transaction,
                &delivery.id,
                "camp_turn_no_longer_active",
                &actor,
                None,
                &now,
            )?;
        }
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
        if delivery.delivery_kind == "gather_completion" {
            cancel_gather_for_delivery(
                &transaction,
                &delivery.id,
                "initiator_no_longer_eligible",
                &actor,
                None,
                &now,
            )?;
        }
        transaction.commit()?;
        return Ok(outcome);
    }
    let conversation_id = if delivery.delivery_kind == "gather_completion" {
        let conversation_id = delivery
            .target_conversation_id
            .as_deref()
            .context("Gather Completion Delivery has no frozen Conversation")?;
        let route_valid: bool = transaction.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM conversation
                WHERE id = ?1 AND camp_id = ?2 AND agent_id = ?3
            )
            "#,
            params![
                conversation_id,
                delivery.camp_id,
                delivery.recipient_agent_id
            ],
            |row| row.get(0),
        )?;
        if !route_valid {
            let outcome = terminal_dispatch(
                &transaction,
                &delivery,
                attempt_id,
                "failed",
                "gather_initiator_conversation_invalid",
                &actor,
                &now,
            )?;
            cancel_gather_for_delivery(
                &transaction,
                &delivery.id,
                "gather_initiator_conversation_invalid",
                &actor,
                None,
                &now,
            )?;
            transaction.commit()?;
            return Ok(outcome);
        }
        conversation_id.to_string()
    } else {
        ensure_delivery_conversation(
            &transaction,
            &delivery.camp_id,
            &delivery.recipient_agent_id,
            &now,
        )?
    };
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
        | AdapterKind::QwenCode
        | AdapterKind::TraeCnCli => CharterDeliveryMode::FirstPayload,
        AdapterKind::CodexCli | AdapterKind::ClaudeCodeCli => CharterDeliveryMode::NativeAppend,
    };
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
        invocation_kind: if delivery.delivery_kind == "gather_completion" {
            "gather_completion"
        } else {
            "a2a"
        },
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
        max_payload_bytes: if delivery.delivery_kind == "gather_completion" {
            GATHER_COMPLETION_CONTEXT_MAX_BYTES
        } else {
            DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES
        },
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
            task_version_at_admission, assignee_agent_id_at_admission,
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
            ?1, ?2, ?3, ?4, ?33, ?34, ?5, ?6, ?35, ?7, ?8, ?9,
            ?10, ?35, NULL, 'initial', ?11, ?36,
            ?12, ?13, 'runtime_managed_v2',
            ?14, ?15, ?16, ?17, ?18, ?19, ?18, ?19,
            ?20, ?21, ?22, ?23, ?24, ?25,
            ?26, ?27, ?28,
            'queued', NULL, NULL, ?29, 0, 0,
            NULL, NULL, 0, NULL,
            0, NULL, NULL, NULL, NULL, NULL, 1,
            ?7, NULL, NULL, ?7,
            ?37, ?30, ?31, ?32
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
            if delivery.delivery_kind == "gather_completion" {
                format!(
                    "Synthesize completed Gather {}",
                    delivery.gather_id.as_deref().unwrap_or("unknown")
                )
            } else {
                format!(
                    "Handle public message from AgentRun {}",
                    delivery.source_agent_run_id
                )
            },
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
            delivery.task_version_at_admission,
            delivery.assignee_agent_id_at_admission,
            delivery.retry_generation,
            delivery.completion_role,
            if delivery.delivery_kind == "gather_completion" {
                "gather_completion"
            } else {
                "a2a"
            },
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
    if delivery.delivery_kind == "gather_completion" {
        mark_completion_materialized(&transaction, &delivery.id, &agent_run_id, &now)?;
    } else if delivery.gather_id.is_some() {
        mark_item_materialized(
            &transaction,
            &delivery.id,
            &agent_run_id,
            delivery.retry_generation,
            &actor,
            &now,
        )?;
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
            "gatherId": delivery.gather_id,
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
            "invocationKind": if delivery.delivery_kind == "gather_completion" {
                "gather_completion"
            } else {
                "a2a"
            },
            "messageDeliveryId": delivery.id,
            "triggerDeliveryGeneration": delivery.retry_generation,
            "gatherId": delivery.gather_id,
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
                   delivery.task_version_at_admission,
                   delivery.assignee_agent_id_at_admission,
                   delivery.source_agent_run_id,
                   delivery.delivery_kind, delivery.completion_role,
                   delivery.gather_id, delivery.target_conversation_id,
                   delivery.edge_kind,
                   delivery.target_parent_agent_run_id,
                   delivery.return_to_agent_run_id,
                   delivery.a2a_root_agent_run_id,
                   delivery.a2a_depth, delivery.retry_generation
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
                    task_version_at_admission: row.get(7)?,
                    assignee_agent_id_at_admission: row.get(8)?,
                    source_agent_run_id: row.get(9)?,
                    delivery_kind: row.get(10)?,
                    completion_role: row.get(11)?,
                    gather_id: row.get(12)?,
                    target_conversation_id: row.get(13)?,
                    edge_kind: row.get(14)?,
                    target_parent_agent_run_id: row.get(15)?,
                    return_to_agent_run_id: row.get(16)?,
                    a2a_root_agent_run_id: row.get(17)?,
                    a2a_depth: row.get(18)?,
                    retry_generation: row.get(19)?,
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
    settle_item_from_delivery_terminal(
        transaction,
        &delivery.id,
        status,
        Some(failure_code),
        actor,
        None,
        now,
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

fn load_trigger_reply_reference(
    transaction: &Transaction<'_>,
    source_agent_run_id: &str,
    camp_id: &str,
) -> Result<Option<String>> {
    let trigger = transaction
        .query_row(
            r#"
            SELECT source.trigger_camp_message_id,
                   source.trigger_message_delivery_id,
                   delivery.message_id,
                   message.camp_id,
                   message.tombstoned_at,
                   source.invocation_kind
            FROM agent_run AS source
            JOIN camp_turn ON camp_turn.id = source.camp_turn_id
            LEFT JOIN message_delivery AS delivery
              ON delivery.id = source.trigger_message_delivery_id
            LEFT JOIN camp_message AS message
              ON message.id = source.trigger_camp_message_id
            WHERE source.id = ?1 AND camp_turn.camp_id = ?2
            "#,
            params![source_agent_run_id, camp_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?
        .context("Agent-authored send source Run is outside the current Camp")?;
    let (
        trigger_message_id,
        trigger_delivery_id,
        delivered_message_id,
        trigger_camp_id,
        trigger_tombstoned_at,
        invocation_kind,
    ) = trigger;
    let trigger_message_id =
        trigger_message_id.context("Agent-authored send source Run has no trigger CampMessage")?;
    if trigger_camp_id.as_deref() != Some(camp_id) {
        anyhow::bail!("Agent-authored send trigger CampMessage is outside the current Camp");
    }
    if trigger_tombstoned_at.is_some() {
        anyhow::bail!("Agent-authored send trigger CampMessage is tombstoned");
    }
    if invocation_kind == "a2a" && trigger_delivery_id.is_none() {
        anyhow::bail!("A2A AgentRun has no trigger Message Delivery");
    }
    if trigger_delivery_id.is_some()
        && delivered_message_id.as_deref() != Some(trigger_message_id.as_str())
    {
        anyhow::bail!("AgentRun trigger Message Delivery does not match its trigger CampMessage");
    }
    Ok(Some(trigger_message_id))
}

fn load_immediate_caller(
    transaction: &Transaction<'_>,
    source_agent_run_id: &str,
) -> Result<Option<ImmediateCaller>> {
    let source = transaction
        .query_row(
            r#"
            SELECT a2a_parent_agent_run_id, a2a_root_agent_run_id, a2a_depth
            FROM agent_run WHERE id = ?1
            "#,
            [source_agent_run_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?
        .context("Agent-authored send source Run does not exist")?;
    let Some(caller_run_id) = source.0 else {
        if source.2 != 0 {
            anyhow::bail!("A2A source Run has depth without an immediate caller");
        }
        return Ok(None);
    };
    let caller = transaction
        .query_row(
            r#"
            SELECT caller.id, conversation.agent_id,
                   caller.a2a_parent_agent_run_id,
                   caller.a2a_root_agent_run_id,
                   caller.a2a_depth
            FROM agent_run AS source
            JOIN agent_run AS caller
              ON caller.id = source.a2a_parent_agent_run_id
             AND caller.camp_turn_id = source.camp_turn_id
            JOIN conversation ON conversation.id = caller.conversation_id
            WHERE source.id = ?1 AND caller.id = ?2
            "#,
            params![source_agent_run_id, caller_run_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .optional()?
        .context("A2A source Run immediate caller is missing or outside its CampTurn")?;
    if caller.4 + 1 != source.2 {
        anyhow::bail!("A2A source Run depth is inconsistent with its immediate caller");
    }
    let root_agent_run_id = caller.3.clone().unwrap_or_else(|| caller.0.clone());
    if source.1.as_deref() != Some(root_agent_run_id.as_str()) {
        anyhow::bail!("A2A source Run root is inconsistent with its immediate caller");
    }
    Ok(Some(ImmediateCaller {
        agent_run_id: caller.0,
        agent_id: caller.1,
        parent_agent_run_id: caller.2,
        root_agent_run_id,
        a2a_depth: caller.4,
    }))
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

fn parse_inline_addressing(body: &str, active_agents: &[ActiveCampAgent]) -> InlineAddressing {
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
            .rfind(char::is_whitespace)
            .map(|position| position + 1)
            .unwrap_or(0);
        if body[token_start..index].contains("://") {
            index += 1;
            continue;
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
            } else {
                malformed.push(format!("@{value}"));
            }
            index = end;
            continue;
        }

        if !is_line_leading_display_name_alias(body, index) {
            index += 1;
            continue;
        }

        if let Some((agent_id, end_byte)) = match_display_name_mention(body, index, active_agents) {
            occurrences.push(InlineAddressingOccurrence {
                agent_id: agent_id.to_string(),
                start_byte: index,
                end_byte,
                ordinal: occurrences.len(),
            });
            index = end_byte;
            continue;
        }

        index += 1;
    }
    InlineAddressing {
        occurrences,
        malformed,
    }
}

fn is_line_leading_display_name_alias(body: &str, at_byte: usize) -> bool {
    let line_start = body[..at_byte]
        .rfind('\n')
        .map(|position| position + 1)
        .unwrap_or(0);
    body[line_start..at_byte].chars().all(char::is_whitespace)
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
    mention_user: bool,
) -> Vec<StructuredCampMessageSegment> {
    let mut content = Vec::with_capacity(
        occurrences
            .len()
            .saturating_mul(2)
            .saturating_add(if mention_user { 2 } else { 1 }),
    );
    if mention_user {
        content.push(StructuredCampMessageSegment::CurrentUserMention {
            user_id: CURRENT_USER_ID.to_string(),
        });
    }
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
    fn display_name_alias_requires_the_first_non_whitespace_position_on_a_line() {
        let active_agents = vec![ActiveCampAgent {
            agent_id: "agent_6".to_string(),
            display_name: "爱丽丝".to_string(),
        }];

        let addressed = parse_inline_addressing(
            "迁移背景与约束……\n\n  @爱丽丝 请分析这个迁移方案",
            &active_agents,
        );
        assert_eq!(addressed.occurrences.len(), 1);
        assert_eq!(addressed.occurrences[0].agent_id, "agent_6");

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
