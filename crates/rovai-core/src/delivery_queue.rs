use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde_json::Value;
use uuid::Uuid;

#[cfg(test)]
use crate::context::serialized_batch_run_input_len;

use crate::{
    agent_profile::{FrozenAgentRuntimeConfig, resolve_frozen_runtime},
    camp_content::StructuredThreadMessageContent,
    collaboration::build_effective_config,
    context::{
        ClaimedBatchContext, DeliveryContextPreview, charter_delivery_mode_for_adapter,
        project_batch_run_input_for_claim, runtime_max_context_payload_bytes,
    },
    context_contract::PUBLIC_CAMP_BATCH_CONTEXT_MANIFEST_VERSION,
    current_input_skill::{
        SkillSelectionSnapshot, freeze_skill_selection_with_messages,
        projected_skill_links_for_claim,
    },
    db::Database,
    runtime::{AgentRunWorkspace, runtime_cleanup_blocked_since_connection},
    runtime_failure::context_payload_too_large_failure,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EnqueuedDelivery {
    pub delivery_id: String,
    pub recipient_agent_id: String,
}

#[derive(Debug, Clone)]
struct WaitingDelivery {
    id: String,
    message_id: String,
    sequence: i64,
    structured_content_json: Option<String>,
    content_digest: String,
    default_recipient_display_name: Option<String>,
    continuation_source_run_id: Option<String>,
    use_new_session: bool,
}

#[derive(Debug)]
struct BatchPrefixSelection {
    context: Option<ClaimedBatchContext>,
    count: usize,
    failure_code: Option<&'static str>,
    skill_selection: SkillSelectionSnapshot,
    has_additional_public_messages: bool,
}

enum DeliverySource<'a> {
    Message(&'a str),
    Continuation,
}

pub(crate) fn enqueue_message_deliveries(
    transaction: &Transaction<'_>,
    camp_id: &str,
    message_id: &str,
    recipient_agent_ids: &[String],
    now: &str,
) -> Result<Vec<EnqueuedDelivery>> {
    enqueue_deliveries(
        transaction,
        camp_id,
        DeliverySource::Message(message_id),
        recipient_agent_ids,
        now,
    )
}

pub(crate) fn enqueue_continuation_delivery(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_id: String,
    now: &str,
) -> Result<EnqueuedDelivery> {
    enqueue_deliveries(
        transaction,
        camp_id,
        DeliverySource::Continuation,
        &[agent_id],
        now,
    )?
    .into_iter()
    .next()
    .context("Continuation did not enqueue its Delivery")
}

fn enqueue_deliveries(
    transaction: &Transaction<'_>,
    camp_id: &str,
    source: DeliverySource<'_>,
    recipient_agent_ids: &[String],
    now: &str,
) -> Result<Vec<EnqueuedDelivery>> {
    if recipient_agent_ids.is_empty() {
        return Ok(Vec::new());
    }
    let (source_kind, message_id) = match source {
        DeliverySource::Message(id) => ("message", Some(id)),
        DeliverySource::Continuation => ("continuation", None),
    };
    let queue_sequence: i64 = transaction.query_row(
        "UPDATE camp SET last_delivery_sequence=last_delivery_sequence+1 WHERE id=?1 RETURNING last_delivery_sequence",
        [camp_id], |row|row.get(0))?;
    let mut deliveries = Vec::with_capacity(recipient_agent_ids.len());
    for recipient_agent_id in recipient_agent_ids {
        let membership_version = transaction
            .query_row(
                r#"
                SELECT version
                FROM camp_member
                WHERE camp_id = ?1 AND agent_id = ?2
                  AND status = 'active' AND leave_requested_at IS NULL
                "#,
                params![camp_id, recipient_agent_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .with_context(|| {
                format!(
                    "Message Delivery target {recipient_agent_id} is not an active Thread member"
                )
            })?;
        ensure_camp_member_conversation(transaction, camp_id, recipient_agent_id, now)?;
        let delivery_id = Uuid::new_v4().to_string();
        transaction.execute(
            r#"
            INSERT INTO camp_message_delivery(
                id, camp_id, message_id, source_kind, recipient_agent_id,
                recipient_membership_version_at_admission, queue_sequence,
                status, claimed_agent_run_id, failure_code, version,
                created_at, claimed_at, ended_at, updated_at
            ) VALUES (?1, ?2, ?3, ?8, ?4, ?5, ?6, 'waiting', NULL, NULL, 1,
                      ?7, NULL, NULL, ?7)
            "#,
            params![
                delivery_id,
                camp_id,
                message_id,
                recipient_agent_id,
                membership_version,
                queue_sequence,
                now,
                source_kind,
            ],
        )?;
        deliveries.push(EnqueuedDelivery {
            delivery_id,
            recipient_agent_id: recipient_agent_id.clone(),
        });
    }
    Ok(deliveries)
}

fn ensure_camp_member_conversation(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_id: &str,
    now: &str,
) -> Result<()> {
    transaction.execute(
        r#"
        INSERT INTO conversation(
            id, camp_id, agent_id, kind,
            summary_through_message_sequence, last_message_sequence,
            version, created_at, updated_at
        )
        SELECT ?1, ?2, ?3, 'camp_member', 0, 0, 1, ?4, ?4
        WHERE NOT EXISTS (
            SELECT 1 FROM conversation
            WHERE camp_id = ?2 AND agent_id = ?3 AND kind = 'camp_member'
        )
        "#,
        params![Uuid::new_v4().to_string(), camp_id, agent_id, now],
    )?;
    Ok(())
}

fn reconcile_waiting_delivery_conversations(transaction: &Transaction<'_>) -> Result<()> {
    let targets = {
        let mut statement = transaction.prepare(
            r#"
            SELECT DISTINCT delivery.camp_id, delivery.recipient_agent_id
            FROM camp_message_delivery AS delivery
            JOIN camp ON camp.id = delivery.camp_id
            JOIN camp_member
              ON camp_member.camp_id = delivery.camp_id
             AND camp_member.agent_id = delivery.recipient_agent_id
            JOIN agent_profile ON agent_profile.id = delivery.recipient_agent_id
            LEFT JOIN conversation
              ON conversation.camp_id = delivery.camp_id
             AND conversation.agent_id = delivery.recipient_agent_id
             AND conversation.kind = 'camp_member'
            WHERE delivery.status = 'waiting'
              AND camp.deletion_operation_id IS NULL
              AND camp_member.status = 'active'
              AND camp_member.leave_requested_at IS NULL
              AND agent_profile.profile_status = 'present'
              AND conversation.id IS NULL
            ORDER BY delivery.camp_id, delivery.recipient_agent_id
            "#,
        )?;
        statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    if targets.is_empty() {
        return Ok(());
    }
    let now = chrono::Utc::now().to_rfc3339();
    for (camp_id, agent_id) in targets {
        ensure_camp_member_conversation(transaction, &camp_id, &agent_id, &now)?;
    }
    Ok(())
}

/// Cheap, read-only gate for the ordinary batch scheduler. A false result means
/// the fallback tick can return without opening the immediate transaction used
/// by `claim_waiting_delivery_batches`.
pub fn has_pending_delivery_batch_work(database: &Database) -> Result<bool> {
    Ok(database.connection().query_row(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM camp_message_delivery AS delivery
            JOIN camp ON camp.id = delivery.camp_id
            WHERE (delivery.status = 'waiting' OR (delivery.status='claimed' AND delivery.requested_mode='steer'))
              AND camp.deletion_operation_id IS NULL
        ) OR EXISTS(
            SELECT 1
            FROM agent_run
            JOIN camp ON camp.id = agent_run.camp_id
            WHERE agent_run.invocation_kind = 'batch'
              AND agent_run.status = 'queued'
              AND agent_run.input_ready_at IS NOT NULL
              AND agent_run.cancel_requested_at IS NULL
              AND camp.deletion_operation_id IS NULL
        )
        "#,
        [],
        |row| row.get(0),
    )?)
}

pub fn has_waiting_delivery_batch_work(database: &Database) -> Result<bool> {
    Ok(database.connection().query_row(
        "SELECT EXISTS(SELECT 1 FROM camp_message_delivery AS delivery JOIN camp ON camp.id=delivery.camp_id WHERE delivery.status='waiting' AND camp.deletion_operation_id IS NULL)",
        [],
        |row| row.get(0),
    )?)
}

/// Converts waiting Delivery lanes into immutable, ordered multi-input AgentRuns.
/// Waiting rows carry message responsibility or explicit continuation authorization. Runtime, model and permissions are
/// resolved here. Mission lanes wait for their exact workspace facts, prepared
/// asynchronously before selection; ordinary lanes need no preparation input.
pub fn claim_waiting_delivery_batches(database: &mut Database, limit: i64) -> Result<Vec<String>> {
    claim_waiting_delivery_batches_with_workspaces(database, limit, &Default::default())
}

/// Actual Mission execution facts observed outside the claim transaction.
#[derive(Debug, Clone)]
pub struct PreparedBatchWorkspace {
    pub workspace: AgentRunWorkspace,
    pub fact: Value,
    fence: Value,
}

pub type BatchWorkspaces =
    std::collections::BTreeMap<String, Result<PreparedBatchWorkspace, String>>;

fn batch_workspace_fence(connection: &rusqlite::Connection, camp_id: &str) -> Result<Value> {
    let row: Option<(String, i64, String, String, String)> = connection.query_row(
        "SELECT id,generation,preparation_token,working_directory,state FROM mission_workspace WHERE camp_id=?1 ORDER BY created_at,id LIMIT 1",
        [camp_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    ).optional()?;
    Ok(serde_json::to_value(row)?)
}

pub fn capture_prepared_batch_workspace(
    database: &Database,
    camp_id: &str,
    workspace: AgentRunWorkspace,
    fact: Value,
) -> Result<PreparedBatchWorkspace> {
    Ok(PreparedBatchWorkspace {
        workspace,
        fact,
        fence: batch_workspace_fence(database.connection(), camp_id)?,
    })
}

pub fn waiting_mission_batch_workspaces(database: &Database) -> Result<Vec<(String, String)>> {
    let lanes = database.connection().prepare(
        "SELECT DISTINCT camp.id,camp.project_path,c.id,m.agent_id FROM camp
         JOIN mission ON mission.camp_id=camp.id
         JOIN camp_message_delivery d ON d.camp_id=camp.id AND d.status='waiting'
         JOIN camp_member m ON m.camp_id=camp.id AND m.agent_id=d.recipient_agent_id
         JOIN agent_profile p ON p.id=m.agent_id
         JOIN conversation c ON c.camp_id=camp.id AND c.agent_id=m.agent_id AND c.kind='camp_member'
         WHERE camp.deletion_operation_id IS NULL AND m.status='active'
           AND m.leave_requested_at IS NULL AND p.profile_status='present'
           AND NOT EXISTS (SELECT 1 FROM conversation c JOIN agent_run r ON r.conversation_id=c.id
                WHERE c.camp_id=camp.id AND c.agent_id=m.agent_id AND r.status IN ('queued','running','waiting'))
           AND NOT EXISTS (SELECT 1 FROM agent_run r JOIN conversation c ON c.id=r.conversation_id
                WHERE c.camp_id=camp.id AND r.cancel_requested_at IS NOT NULL AND r.cancel_acknowledged_at IS NULL)"
    )?.query_map([], |row| Ok((row.get::<_,String>(0)?, row.get::<_,String>(1)?, row.get::<_,String>(2)?, row.get::<_,String>(3)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let tx = database.connection().unchecked_transaction()?;
    let mut camps = std::collections::BTreeMap::new();
    for (camp_id, path, conversation, member) in lanes {
        if resolve_frozen_runtime(&tx, &conversation, &member)?.is_ok() {
            camps.insert(camp_id, path);
        }
    }
    Ok(camps.into_iter().collect())
}

pub fn claim_waiting_delivery_batches_with_workspaces(
    database: &mut Database,
    limit: i64,
    prepared_workspaces: &BatchWorkspaces,
) -> Result<Vec<String>> {
    if !(1..=100).contains(&limit) {
        anyhow::bail!("Delivery claim limit must be between 1 and 100");
    }
    let transaction = database
        .connection_mut()
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    reconcile_waiting_delivery_conversations(&transaction)?;
    let mut claimed_run_ids = Vec::new();
    let mut cursor: Option<(String, i64, String, String, String)> = None;
    while claimed_run_ids.len() < limit as usize {
        let lanes = {
            let mut statement = transaction.prepare(
                r#"
                WITH eligible_lane AS (
                    SELECT delivery.camp_id AS camp_id,
                           delivery.recipient_agent_id AS recipient_agent_id,
                           conversation.id AS conversation_id,
                           MIN(delivery.created_at) AS first_created_at,
                           MIN(delivery.queue_sequence) AS first_queue_sequence
                    FROM camp_message_delivery AS delivery
                    JOIN camp ON camp.id = delivery.camp_id
                    JOIN conversation
                      ON conversation.camp_id = delivery.camp_id
                     AND conversation.agent_id = delivery.recipient_agent_id
                     AND conversation.kind = 'camp_member'
                    JOIN camp_member
                      ON camp_member.camp_id = delivery.camp_id
                     AND camp_member.agent_id = delivery.recipient_agent_id
                    JOIN agent_profile
                      ON agent_profile.id = delivery.recipient_agent_id
                    WHERE delivery.status = 'waiting'
                      AND camp.deletion_operation_id IS NULL
                      AND camp_member.status = 'active'
                      AND camp_member.leave_requested_at IS NULL
                      AND agent_profile.profile_status = 'present'
                      AND NOT EXISTS (
                          SELECT 1 FROM agent_run AS active
                          WHERE active.conversation_id = conversation.id
                            AND active.status IN ('queued', 'running', 'waiting')
                      )
                    GROUP BY delivery.camp_id,
                             delivery.recipient_agent_id,
                             conversation.id
                )
                SELECT camp_id, recipient_agent_id, conversation_id,
                       first_created_at, first_queue_sequence
                FROM eligible_lane
                WHERE ?2 IS NULL
                   OR first_created_at > ?2
                   OR (first_created_at = ?2 AND first_queue_sequence > ?3)
                   OR (first_created_at = ?2 AND first_queue_sequence = ?3
                       AND camp_id > ?4)
                   OR (first_created_at = ?2 AND first_queue_sequence = ?3
                       AND camp_id = ?4 AND recipient_agent_id > ?5)
                   OR (first_created_at = ?2 AND first_queue_sequence = ?3
                       AND camp_id = ?4 AND recipient_agent_id = ?5
                       AND conversation_id > ?6)
                ORDER BY first_created_at, first_queue_sequence,
                         camp_id, recipient_agent_id, conversation_id
                LIMIT ?1
                "#,
            )?;
            let (created_at, sequence, camp_id, agent_id, conversation_id) = cursor
                .as_ref()
                .map(
                    |(created_at, sequence, camp_id, agent_id, conversation_id)| {
                        (
                            Some(created_at.as_str()),
                            *sequence,
                            camp_id.as_str(),
                            agent_id.as_str(),
                            conversation_id.as_str(),
                        )
                    },
                )
                .unwrap_or((None, 0, "", "", ""));
            statement
                .query_map(
                    params![
                        limit,
                        created_at,
                        sequence,
                        camp_id,
                        agent_id,
                        conversation_id
                    ],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let Some(last_lane) = lanes.last() else {
            break;
        };
        cursor = Some((
            last_lane.3.clone(),
            last_lane.4,
            last_lane.0.clone(),
            last_lane.1.clone(),
            last_lane.2.clone(),
        ));

        for (camp_id, agent_id, conversation_id, _, _) in lanes {
            if runtime_cleanup_blocked_since_connection(&transaction, &conversation_id, None)?
                .is_some()
            {
                continue;
            }
            let project_path: String = transaction.query_row(
                "SELECT project_path FROM camp WHERE id = ?1",
                [&camp_id],
                |row| row.get(0),
            )?;
            let mission_exists: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM mission WHERE camp_id=?1)",
                [&camp_id],
                |row| row.get(0),
            )?;
            let prepared_workspace = prepared_workspaces.get(&camp_id);
            if let Some(Ok(prepared)) = prepared_workspace {
                if prepared.fence != batch_workspace_fence(&transaction, &camp_id)? {
                    continue;
                }
                let current =
                    crate::mission_workspace::execution_directory(&transaction, &camp_id)?;
                if current.as_deref().unwrap_or(&project_path) != prepared.workspace.execution_root
                {
                    continue;
                }
            }
            let workspace = match prepared_workspace {
                Some(Ok(prepared)) => Some(prepared.workspace.clone()),
                _ => batch_workspace_for_claim(&transaction, &camp_id, &project_path)?,
            };
            if let Some(workspace) = workspace.as_ref() {
                workspace.validate()?;
            }
            let cleanup_execution_root = workspace
                .as_ref()
                .map(|workspace| workspace.execution_root.as_str())
                .unwrap_or(project_path.as_str());
            let cleanup_pending_on_execution_root: bool = transaction.query_row(
                r#"
                SELECT EXISTS(
                    SELECT 1
                    FROM agent_run AS prior_run
                    LEFT JOIN camp_turn AS prior_turn
                      ON prior_turn.id = prior_run.camp_turn_id
                    JOIN camp AS prior_camp
                      ON prior_camp.id = COALESCE(prior_run.camp_id, prior_turn.camp_id)
                    WHERE prior_run.status IN ('succeeded', 'failed', 'cancelled')
                      AND prior_run.cancel_requested_at IS NOT NULL
                      AND prior_run.cancel_acknowledged_at IS NULL
                      AND COALESCE(
                          json_extract(prior_run.workspace_json, '$.executionRoot'),
                          prior_camp.project_path
                      ) = ?1
                )
                "#,
                [cleanup_execution_root],
                |row| row.get(0),
            )?;
            if cleanup_pending_on_execution_root {
                continue;
            }
            let camp_public_tail: i64 = transaction.query_row(
                "SELECT last_message_sequence FROM camp WHERE id=?1",
                [&camp_id],
                |row| row.get(0),
            )?;
            let conversation_tail: i64 = transaction.query_row(
                "SELECT last_message_sequence FROM conversation WHERE id = ?1",
                [&conversation_id],
                |row| row.get(0),
            )?;
            let waiting = load_waiting_prefix(&transaction, &camp_id, &agent_id)?;
            if waiting.is_empty() {
                continue;
            }
            let previous_public_boundary: i64 = transaction.query_row(
                "SELECT last_accepted_public_boundary_sequence FROM conversation WHERE id = ?1",
                [&conversation_id],
                |row| row.get(0),
            )?;
            anyhow::ensure!(
                previous_public_boundary <= camp_public_tail,
                "Accepted Public Context Boundary is ahead of the claim boundary"
            );
            let runtime = match resolve_frozen_runtime(&transaction, &conversation_id, &agent_id)? {
                Ok(runtime) => runtime,
                Err(blocker) => {
                    // A failed launch intent must settle visibly. Keeping this delivery
                    // waiting would retry forever without ever exposing the reason.
                    let agent_run_id = Uuid::new_v4().to_string();
                    let now = chrono::Utc::now().to_rfc3339();
                    insert_batch_run(
                        &transaction,
                        &agent_run_id,
                        &camp_id,
                        &conversation_id,
                        &agent_id,
                        &waiting[0].message_id,
                        camp_public_tail,
                        conversation_tail,
                        previous_public_boundary,
                        false,
                        &serde_json::json!({"runtimeConfigurationFailure": blocker.payload}),
                        workspace.as_ref(),
                        None,
                        &SkillSelectionSnapshot::default(),
                        if waiting[0].continuation_source_run_id.is_some() {
                            &waiting
                        } else {
                            &waiting[..1]
                        },
                        Some(&blocker.code),
                        &now,
                    )?;
                    claimed_run_ids.push(agent_run_id);
                    if claimed_run_ids.len() == limit as usize {
                        break;
                    }
                    continue;
                }
            };
            let effective_config =
                build_effective_config(&transaction, &conversation_id, &agent_id, &runtime)?;
            if mission_exists && prepared_workspace.is_none() {
                continue;
            }
            if let Some(source_id) = waiting[0].continuation_source_run_id.as_deref() {
                let source =
                    crate::run_continuation::eligible_source(&transaction, &camp_id, source_id)?
                        .context("Continuation scope changed inside the claim transaction")?;
                // The User authorized continuation, including a fresh session when
                // the current binding cannot safely resume. Choose only after the
                // cleanup gates, using the latest state rather than a preflight choice.
                if waiting[0].use_new_session
                    || crate::run_continuation::has_unresolved_native_turn(
                        &transaction,
                        &source.conversation_id,
                    )?
                {
                    crate::run_continuation::clear_native_session(
                        &transaction,
                        &conversation_id,
                        &chrono::Utc::now().to_rfc3339(),
                    )?;
                }
            }
            let max_payload_bytes = runtime_max_context_payload_bytes(&runtime);
            let agent_run_id = Uuid::new_v4().to_string();
            let preview = DeliveryContextPreview {
                agent_run_id: &agent_run_id,
                camp_id: &camp_id,
                camp_turn_id: "",
                conversation_id: &conversation_id,
                agent_id: &agent_id,
                task_id: None,
                execution_epoch: 0,
                invocation_kind: "batch",
                a2a_parent_agent_run_id: None,
                a2a_root_agent_run_id: None,
                a2a_depth: 0,
                camp_message_boundary_sequence: camp_public_tail,
                conversation_message_boundary_sequence: conversation_tail,
                trigger_camp_message_id: None,
                trigger_message_delivery_id: "",
                effective_config: effective_config.clone(),
                workspace: serde_json::to_value(workspace.as_ref().cloned().unwrap_or_else(
                    || AgentRunWorkspace::runtime_managed_path(cleanup_execution_root.to_string()),
                ))?,
                charter_delivery_mode: charter_delivery_mode_for_adapter(runtime.adapter_kind),
                max_payload_bytes,
            };
            let selection = match prepared_workspace {
                Some(Err(detail)) => {
                    eprintln!("Delivery workspace for {camp_id} is unavailable: {detail}");
                    BatchPrefixSelection {
                        context: None,
                        count: if waiting[0].continuation_source_run_id.is_some() {
                            waiting.len()
                        } else {
                            1
                        },
                        failure_code: Some("workspace_unavailable"),
                        skill_selection: SkillSelectionSnapshot::default(),
                        has_additional_public_messages: false,
                    }
                }
                _ => match select_batch_prefix(
                    &transaction,
                    &camp_id,
                    &agent_id,
                    previous_public_boundary,
                    camp_public_tail,
                    &runtime,
                    std::path::Path::new(cleanup_execution_root),
                    &waiting,
                    &preview,
                    prepared_workspace
                        .and_then(|prepared| prepared.as_ref().ok())
                        .map(|prepared| &prepared.fact),
                ) {
                    Ok(selection) => selection,
                    Err(error) if error.downcast_ref::<rusqlite::Error>().is_none() => {
                        // Bad member/input configuration settles this lane visibly;
                        // database failures still roll back the whole transaction.
                        eprintln!(
                            "Delivery claim context for {agent_id} is unavailable: {error:#}"
                        );
                        BatchPrefixSelection {
                            context: None,
                            count: if waiting[0].continuation_source_run_id.is_some() {
                                waiting.len()
                            } else {
                                1
                            },
                            failure_code: Some("runtime_configuration_invalid"),
                            skill_selection: SkillSelectionSnapshot::default(),
                            has_additional_public_messages: false,
                        }
                    }
                    Err(error) => return Err(error),
                },
            };
            let selected = &waiting[..selection.count];
            let anchor_message_id = selected
                .last()
                .map(|delivery| delivery.message_id.as_str())
                .context("Delivery claim selected an empty input batch")?;
            let now = chrono::Utc::now().to_rfc3339();
            insert_batch_run(
                &transaction,
                &agent_run_id,
                &camp_id,
                &conversation_id,
                &agent_id,
                anchor_message_id,
                camp_public_tail,
                conversation_tail,
                previous_public_boundary,
                selection.has_additional_public_messages,
                &effective_config,
                workspace.as_ref(),
                Some(&runtime),
                &selection.skill_selection,
                selected,
                selection.failure_code,
                &now,
            )?;
            if let Some(context) = selection.context {
                context.persist(&transaction, &agent_run_id)?;
            }
            claimed_run_ids.push(agent_run_id);
            if claimed_run_ids.len() == limit as usize {
                break;
            }
        }
    }
    transaction.commit()?;
    Ok(claimed_run_ids)
}

fn batch_workspace_for_claim(
    transaction: &Transaction<'_>,
    camp_id: &str,
    project_path: &str,
) -> Result<Option<AgentRunWorkspace>> {
    let mission_exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM mission WHERE camp_id = ?1)",
        [camp_id],
        |row| row.get(0),
    )?;
    if !mission_exists {
        return Ok(Some(AgentRunWorkspace::runtime_managed_path(
            project_path.to_string(),
        )));
    }
    let Some(execution_root) = crate::mission_workspace::execution_directory(transaction, camp_id)?
    else {
        return Ok(None);
    };
    Ok(Some(AgentRunWorkspace {
        execution_root,
        access: "write".to_string(),
        isolation: "git_worktree".to_string(),
    }))
}

enum QueuedSource {
    Message(WaitingDelivery),
    Continuation {
        delivery_id: String,
        source_run_id: String,
        use_new_session: bool,
    },
}

fn load_waiting_prefix(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_id: &str,
) -> Result<Vec<WaitingDelivery>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT delivery.id, message.id, message.sequence,
               message.structured_content_json, message.content_digest,
               recipient.display_name, continuation.source_agent_run_id,
               COALESCE(continuation.use_new_session, 0), delivery.source_kind
        FROM camp_message_delivery AS delivery
        LEFT JOIN camp_run_continuation AS continuation ON continuation.delivery_id=delivery.id
        LEFT JOIN camp_message AS message ON message.id = delivery.message_id
        LEFT JOIN agent_profile AS recipient
          ON message.address_mode = 'default'
         AND json_array_length(message.addressed_agent_ids_json) = 1
         AND recipient.id = json_extract(message.addressed_agent_ids_json, '$[0]')
        WHERE delivery.camp_id = ?1
          AND delivery.recipient_agent_id = ?2
          AND delivery.status = 'waiting'
          AND ((delivery.source_kind='message' AND message.tombstoned_at IS NULL
                AND message.recall_state <> 'withdrawn')
            OR (delivery.source_kind='continuation' AND continuation.delivery_id IS NOT NULL))
        ORDER BY delivery.queue_sequence
        "#,
    )?;
    let mut waiting = statement
        .query_map(params![camp_id, agent_id], |row| {
            if row.get::<_, String>(8)? == "continuation" {
                Ok(QueuedSource::Continuation {
                    delivery_id: row.get(0)?,
                    source_run_id: row.get(6)?,
                    use_new_session: row.get(7)?,
                })
            } else {
                Ok(QueuedSource::Message(WaitingDelivery {
                    id: row.get(0)?,
                    message_id: row.get(1)?,
                    sequence: row.get(2)?,
                    structured_content_json: row.get(3)?,
                    content_digest: row.get(4)?,
                    default_recipient_display_name: row.get(5)?,
                    continuation_source_run_id: None,
                    use_new_session: false,
                }))
            }
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut expired = 0;
    for first in &waiting {
        let QueuedSource::Continuation {
            delivery_id,
            source_run_id: source_id,
            ..
        } = first
        else {
            break;
        };
        if crate::run_continuation::eligible_source(transaction, camp_id, source_id)?.is_some() {
            break;
        }
        // Admission can expire while waiting; never turn its system operation into business input.
        transaction.execute("UPDATE camp_message_delivery SET status='cancelled',failure_code='agent_run.continuation_unavailable',
                ended_at=?2,updated_at=?2,version=version+1 WHERE id=?1 AND status='waiting'",
                params![delivery_id,chrono::Utc::now().to_rfc3339()])?;
        crate::collaboration::append_domain_event(
            transaction,
            "agent_run.continuation_cancelled",
            Some(camp_id),
            Some(("camp_message_delivery", delivery_id)),
            &crate::command::ActorRef::System {
                component_id: "delivery-batch".into(),
            },
            None,
            &serde_json::json!({"failureCode":"agent_run.continuation_unavailable"}),
        )?;
        expired += 1;
    }
    waiting.drain(..expired);
    let Some(first) = waiting.first() else {
        return Ok(Vec::new());
    };
    if let QueuedSource::Continuation {
        delivery_id,
        source_run_id: source_id,
        use_new_session,
    } = first
    {
        let mut statement=transaction.prepare("SELECT input.message_id,input.message_sequence,message.structured_content_json,
            input.message_content_digest,input.default_recipient_display_name
            FROM agent_run_input AS input JOIN camp_message AS message ON message.id=input.message_id
            WHERE input.agent_run_id=?1 ORDER BY input.ordinal")?;
        return Ok(statement
            .query_map([source_id], |row| {
                Ok(WaitingDelivery {
                    id: delivery_id.clone(),
                    message_id: row.get(0)?,
                    sequence: row.get(1)?,
                    structured_content_json: row.get(2)?,
                    content_digest: row.get(3)?,
                    default_recipient_display_name: row.get(4)?,
                    continuation_source_run_id: Some(source_id.clone()),
                    use_new_session: *use_new_session,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?);
    }
    Ok(waiting
        .into_iter()
        .take_while(|source| matches!(source, QueuedSource::Message(_)))
        .filter_map(|source| match source {
            QueuedSource::Message(message) => Some(message),
            _ => None,
        })
        .collect())
}

#[allow(clippy::too_many_arguments)]
fn select_batch_prefix(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_id: &str,
    previous_public_boundary: i64,
    camp_public_tail: i64,
    runtime: &FrozenAgentRuntimeConfig,
    execution_root: &std::path::Path,
    waiting: &[WaitingDelivery],
    preview: &DeliveryContextPreview<'_>,
    workspace_fact: Option<&Value>,
) -> Result<BatchPrefixSelection> {
    let base_context = ClaimedBatchContext::prepare(transaction, preview, workspace_fact)?;
    let mut sender_names = crate::message_sender::SenderNames::default();
    let mut batch_content = Vec::new();
    let mut batch_message_indices = Vec::new();
    let mut previous_selection = None;
    let atomic_input = waiting[0].continuation_source_run_id.is_some();
    for count in 1..=waiting.len() {
        if let Some(content_json) = waiting[count - 1].structured_content_json.as_deref() {
            let mut content = serde_json::from_str::<StructuredThreadMessageContent>(content_json)
                .context("ThreadMessage Structured Content is invalid during Delivery claim")?;
            batch_message_indices.extend(std::iter::repeat_n(count - 1, content.len()));
            batch_content.append(&mut content);
        }
        if atomic_input && count < waiting.len() {
            continue;
        }
        let skill_selection = freeze_skill_selection_with_messages(
            transaction,
            &batch_content,
            &batch_message_indices,
            runtime.adapter_kind,
        )?;
        let skill_links = projected_skill_links_for_claim(
            transaction,
            &skill_selection,
            runtime.adapter_kind,
            execution_root,
        )?;
        let message_ids = waiting[..count]
            .iter()
            .map(|delivery| delivery.message_id.clone())
            .collect::<Vec<_>>();
        let run_input = project_batch_run_input_for_claim(
            transaction,
            camp_id,
            agent_id,
            camp_public_tail,
            &message_ids,
            &skill_links,
            &mut sender_names,
        )?;
        let has_additional_public_messages = has_additional_public_messages(
            transaction,
            camp_id,
            agent_id,
            previous_public_boundary,
            camp_public_tail,
            &message_ids,
        )?;
        let context = base_context.with_input(
            transaction,
            preview,
            run_input,
            &skill_selection,
            previous_public_boundary,
            has_additional_public_messages,
        )?;
        if context.payload_len()? > preview.max_payload_bytes {
            return Ok(match previous_selection {
                Some((skill_selection, has_additional_public_messages, context)) => {
                    BatchPrefixSelection {
                        context: Some(context),
                        count: count - 1,
                        failure_code: None,
                        skill_selection,
                        has_additional_public_messages,
                    }
                }
                None => BatchPrefixSelection {
                    context: None,
                    count: if atomic_input { waiting.len() } else { 1 },
                    failure_code: Some("context_payload_too_large"),
                    skill_selection,
                    has_additional_public_messages,
                },
            });
        }
        previous_selection = Some((skill_selection, has_additional_public_messages, context));
    }
    let (skill_selection, has_additional_public_messages, context) =
        previous_selection.context("Delivery claim selected an empty input batch")?;
    Ok(BatchPrefixSelection {
        context: Some(context),
        count: waiting.len(),
        failure_code: None,
        skill_selection,
        has_additional_public_messages,
    })
}

pub(crate) fn has_additional_public_messages(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_id: &str,
    previous_public_boundary: i64,
    camp_public_tail: i64,
    selected_message_ids: &[String],
) -> Result<bool> {
    let selected_ids_json = serde_json::to_string(selected_message_ids)?;
    Ok(transaction.query_row(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM camp_message AS message
            WHERE message.camp_id = ?1
              AND message.sequence > ?2 AND message.sequence <= ?3
              AND message.tombstoned_at IS NULL
              AND NOT (message.author_type = 'agent' AND message.author_id = ?4)
              AND message.id NOT IN (SELECT value FROM json_each(?5))
        )
        "#,
        params![
            camp_id,
            previous_public_boundary,
            camp_public_tail,
            agent_id,
            selected_ids_json
        ],
        |row| row.get(0),
    )?)
}

#[allow(clippy::too_many_arguments)]
fn insert_batch_run(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    camp_id: &str,
    conversation_id: &str,
    agent_id: &str,
    anchor_message_id: &str,
    camp_public_tail: i64,
    conversation_tail: i64,
    previous_public_boundary: i64,
    has_additional_public_messages: bool,
    effective_config: &Value,
    workspace: Option<&AgentRunWorkspace>,
    runtime: Option<&FrozenAgentRuntimeConfig>,
    skill_selection: &SkillSelectionSnapshot,
    selected: &[WaitingDelivery],
    error_code: Option<&str>,
    now: &str,
) -> Result<()> {
    let (skill_selection_json, skill_selection_digest) =
        skill_selection.canonical_json_and_digest()?;
    let first_delivery_id = &selected[0].id;
    let last_delivery_id = &selected[selected.len() - 1].id;
    let status = if error_code.is_some() {
        "failed"
    } else {
        "queued"
    };
    let ended_at = error_code.map(|_| now);
    let public_failure = match (error_code, runtime) {
        (Some("context_payload_too_large"), Some(runtime)) => Some(serde_json::to_string(
            &context_payload_too_large_failure(runtime.adapter_kind),
        )?),
        _ => None,
    };
    transaction.execute(
        r#"
        INSERT INTO agent_run(
            id, camp_turn_id, conversation_id, task_id,
            trigger_conversation_message_id, input_ready_at,
            initial_camp_context_through_sequence,
            initial_conversation_context_through_sequence,
            responsibility_key, responsibility_generation,
            predecessor_agent_run_id, start_reason, purpose, completion_role,
            effective_config_json, workspace_json,
            status, idempotency_key, last_error_code,
            execution_epoch, version, created_at, ended_at, updated_at,
            runtime_adapter_kind, runtime_installation_id,
            runtime_reported_version, runtime_executable_fingerprint,
            runtime_capabilities_json, runtime_model_selection_json,
            runtime_permission_config_json, runtime_binding_compatibility_digest,
            runtime_executable_path, runtime_auth_scope,
            runtime_host_config_digest, runtime_protocol_version,
            runtime_installation_generation, runtime_search_environment_generation,
            runtime_native_session_compatibility_key,
            runtime_initial_reported_version, runtime_initial_executable_fingerprint,
            invocation_kind, permission_semantics,
            skill_selection_snapshot_json, skill_selection_snapshot_digest,
            camp_id, anchor_message_id, current_public_tail_sequence,
            claim_previous_public_boundary_sequence,
            claim_has_additional_public_messages, public_runtime_failure_json
        ) VALUES (
            ?1, NULL, ?2, NULL,
            NULL, ?3, ?4, ?5,
            ?6, 0, NULL, 'initial', ?7, 'required',
            ?8, ?9,
            ?10, ?11, ?12,
            0, 1, ?3, ?13, ?3,
            ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25,
            ?26, ?27, ?28, ?16, ?17,
            'batch', 'runtime_managed_v2', ?29, ?30,
            ?31, ?32, ?4, ?33, ?34, ?35
        )
        "#,
        params![
            agent_run_id,
            conversation_id,
            now,
            camp_public_tail,
            conversation_tail,
            format!("batch/{agent_id}/{first_delivery_id}/{last_delivery_id}"),
            "Handle the claimed Camp message batch",
            serde_json::to_string(effective_config)?,
            workspace.map(serde_json::to_string).transpose()?,
            status,
            format!("delivery-batch:{first_delivery_id}:{last_delivery_id}"),
            error_code,
            ended_at,
            runtime.map(|runtime| runtime.adapter_kind.as_str()),
            runtime.map(|runtime| runtime.installation_id.as_str()),
            runtime.and_then(|runtime| runtime.reported_version.as_deref()),
            runtime.map(|runtime| runtime.executable_fingerprint.as_str()),
            runtime
                .map(|runtime| serde_json::to_string(&runtime.capabilities))
                .transpose()?,
            runtime
                .map(|runtime| serde_json::to_string(&runtime.model))
                .transpose()?,
            runtime
                .map(|runtime| serde_json::to_string(&runtime.permissions))
                .transpose()?,
            runtime.map(|runtime| runtime.binding_compatibility_digest.as_str()),
            runtime.map(|runtime| runtime.executable_path.as_str()),
            runtime.map(|runtime| runtime.auth_scope.as_str()),
            runtime.map(|runtime| runtime.host_config_digest.as_str()),
            runtime.map(|runtime| runtime.protocol_version.as_str()),
            runtime.map(|runtime| runtime.installation_generation),
            runtime.map(|runtime| runtime.search_environment_generation),
            runtime.and_then(|runtime| runtime.native_session_compatibility_key.as_deref()),
            skill_selection_json,
            skill_selection_digest,
            camp_id,
            anchor_message_id,
            previous_public_boundary,
            has_additional_public_messages,
            public_failure,
        ],
    )?;
    for (ordinal, delivery) in selected.iter().enumerate() {
        transaction.execute(
            r#"
            INSERT INTO agent_run_input(
                agent_run_id, ordinal, delivery_id, message_id,
                message_sequence, message_content_digest,
                context_manifest_version, default_recipient_display_name
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                agent_run_id,
                i64::try_from(ordinal).context("AgentRun input ordinal overflow")?,
                delivery.id,
                delivery.message_id,
                delivery.sequence,
                delivery.content_digest,
                PUBLIC_CAMP_BATCH_CONTEXT_MANIFEST_VERSION,
                delivery.default_recipient_display_name,
            ],
        )?;
        let terminal_status = if error_code.is_some() {
            "failed"
        } else {
            "claimed"
        };
        transaction.execute(
            r#"
            UPDATE camp_message_delivery
            SET status = ?2, claimed_agent_run_id = ?3, claimed_at = ?4,
                failure_code = ?5, ended_at = ?6,
                version = version + 1, updated_at = ?4
            WHERE id = ?1 AND status = 'waiting'
            "#,
            params![
                delivery.id,
                terminal_status,
                agent_run_id,
                now,
                error_code,
                ended_at,
            ],
        )?;
        if delivery.continuation_source_run_id.is_none() {
            transaction.execute(
                r#"
            UPDATE camp_message
            SET recall_state = 'closed', version = version + 1, updated_at = ?2
            WHERE id = ?1 AND recall_state = 'recallable'
            "#,
                params![delivery.message_id, now],
            )?;
        }
    }
    Ok(())
}

pub(crate) fn settle_run_deliveries(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    run_status: &str,
    failure_code: Option<&str>,
    now: &str,
) -> Result<usize> {
    let delivery_status = match run_status {
        "succeeded" => "settled",
        "cancelled" => "cancelled",
        "failed" => "failed",
        _ => return Ok(0),
    };
    crate::steer::settle_execution(transaction, agent_run_id, run_status, now)?;
    Ok(transaction.execute(
        r#"
        UPDATE camp_message_delivery
        SET status = ?2, failure_code = ?3, ended_at = ?4,
            version = version + 1, updated_at = ?4
        WHERE claimed_agent_run_id = ?1 AND status = 'claimed'
        "#,
        params![agent_run_id, delivery_status, failure_code, now],
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        agent_profile::{ModelDescriptor, ModelOptionDescriptor, RuntimeOptionScope, ValueChoice},
        camp_content::{StructuredThreadMessageSegment, canonical_content_digest},
        collaboration::{CollaborationService, CreateThreadCommand},
        command::{ActorRef, CommandEnvelope},
        current_input_skill::{CurrentInputSkillLink, parse_skill_selection_snapshot},
        message_quote::{QuoteSelection, QuoteStorage, capture_quote, store_quotes},
    };
    use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
    use serde_json::json;

    struct Fixture {
        database: Database,
        _directory: std::path::PathBuf,
        camp_id: String,
    }

    impl Fixture {
        fn new() -> Self {
            Self::with_members(&["agent_1"])
        }

        fn with_members(members: &[&str]) -> Self {
            let (mut database, directory) = crate::test_support::seeded_runtime_database_fast();
            let workspace = directory.join("workspace");
            std::fs::create_dir_all(&workspace).unwrap();
            let created = CollaborationService::default()
                .create_camp(
                    &mut database,
                    &CommandEnvelope {
                        command_id: "create-delivery-queue-test-camp".to_string(),
                        actor: ActorRef::User {
                            user_id: "local_user".to_string(),
                        },
                        camp_id: None,
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: CreateThreadCommand::for_test_with_members(
                            workspace.to_string_lossy().into_owned(),
                            members,
                            "agent_1",
                        ),
                    },
                )
                .unwrap();
            let camp_id = created.result.payload["threadId"]
                .as_str()
                .unwrap()
                .to_string();
            database
                .connection()
                .execute(
                    r#"
                    INSERT INTO conversation(
                        id, camp_id, agent_id, last_message_sequence,
                        version, created_at, updated_at
                    ) VALUES (
                        'delivery-queue-agent-1', ?1, 'agent_1', 0,
                        1, datetime('now'), datetime('now')
                    )
                    "#,
                    [&camp_id],
                )
                .unwrap();
            Self {
                database,
                _directory: directory,
                camp_id,
            }
        }

        #[cfg(feature = "extended-tests")]
        fn user_command<T>(&self, payload: T) -> CommandEnvelope<T> {
            CommandEnvelope {
                command_id: Uuid::new_v4().to_string(),
                actor: ActorRef::User {
                    user_id: "local_user".into(),
                },
                camp_id: Some(self.camp_id.clone()),
                expected_versions: vec![],
                execution_epoch: None,
                payload,
            }
        }

        #[cfg(feature = "extended-tests")]
        fn send_user_input(&mut self, agent: &str, body: &str, task: Option<&str>) -> String {
            use crate::collaboration::{ExecutionRequest, SendUserThreadMessageCommand};
            let command = self.user_command(SendUserThreadMessageCommand {
                steer_targets: None,
                delivery_mode: Default::default(),
                camp_id: self.camp_id.clone(),
                content: crate::camp_content::composer_document_from_content(&[
                    StructuredThreadMessageSegment::MemberMention {
                        agent_id: agent.into(),
                    },
                    StructuredThreadMessageSegment::Text {
                        text: format!(" {body}"),
                    },
                ])
                .unwrap(),
                source_attachments: vec![],
                quotes: vec![],
                reply_to_camp_message_id: None,
                execution: Some(ExecutionRequest {
                    task_id: task.map(str::to_string),
                    purpose: "task scope regression".into(),
                    completion_role: "required".into(),
                    budget: None,
                }),
            });
            let sent = CollaborationService::default()
                .send_user_camp_message(&mut self.database, &command)
                .unwrap();
            assert_eq!(
                sent.result.status,
                crate::command::CommandResultStatus::Accepted
            );
            sent.result.payload["threadMessageId"]
                .as_str()
                .unwrap()
                .to_string()
        }

        #[cfg(feature = "extended-tests")]
        fn stop_run(&mut self, run: &str) {
            let version = self
                .database
                .connection()
                .query_row("SELECT version FROM agent_run WHERE id=?1", [run], |r| {
                    r.get(0)
                })
                .unwrap();
            let command = self.user_command(crate::runtime::CancelAgentRunCommand {
                camp_id: self.camp_id.clone(),
                agent_run_id: run.into(),
                expected_version: version,
            });
            let result = crate::runtime::ExecutionRuntimeService::default()
                .request_agent_run_cancellation(&mut self.database, &command)
                .unwrap();
            assert_eq!(result.result.code, "agent_run.cancelled");
        }

        #[cfg(feature = "extended-tests")]
        fn materialize_run(&mut self, run: &str) -> crate::context::PreparedContext {
            self.materialize_with_mode(
                run,
                crate::context::CharterDeliveryMode::NativeAppend,
                96 * 1024,
            )
        }

        #[cfg(feature = "extended-tests")]
        fn materialize_with_mode(
            &mut self,
            run: &str,
            mode: crate::context::CharterDeliveryMode,
            limit: usize,
        ) -> crate::context::PreparedContext {
            use crate::context::{
                ContextMaterialization, ContextService, MaterializeContextRequest,
            };
            self.database
                .connection()
                .execute(
                    "UPDATE agent_run SET status='running',execution_epoch=1 WHERE id=?1",
                    [run],
                )
                .unwrap();
            crate::team_tool::TeamToolService::default()
                .prepare_binding_credential(&mut self.database, run, 1, false)
                .unwrap();
            let ContextMaterialization::Ready(context) = ContextService
                .materialize(
                    &mut self.database,
                    &crate::managed_blob::ManagedBlobStore::new(&self._directory),
                    &MaterializeContextRequest {
                        agent_run_id: run,
                        execution_epoch: 1,
                        charter_delivery_mode: mode,
                        max_payload_bytes: limit,
                    },
                )
                .unwrap()
            else {
                panic!("Continuation context must materialize")
            };
            context
        }

        fn enqueue(&mut self, message_id: &str, body: &str) -> String {
            let camp_id = self.camp_id.clone();
            self.enqueue_for(&camp_id, message_id, body)
        }

        fn add_camp_lane(&mut self, label: &str) -> String {
            let workspace = self._directory.join(format!("workspace-{label}"));
            std::fs::create_dir_all(&workspace).unwrap();
            let created = CollaborationService::default()
                .create_camp(
                    &mut self.database,
                    &CommandEnvelope {
                        command_id: format!("create-delivery-queue-{label}"),
                        actor: ActorRef::User {
                            user_id: "local_user".to_string(),
                        },
                        camp_id: None,
                        expected_versions: Vec::new(),
                        execution_epoch: None,
                        payload: CreateThreadCommand::for_test_with_members(
                            workspace.to_string_lossy().into_owned(),
                            &["agent_1"],
                            "agent_1",
                        ),
                    },
                )
                .unwrap();
            let camp_id = created.result.payload["threadId"]
                .as_str()
                .unwrap()
                .to_string();
            self.database
                .connection()
                .execute(
                    r#"
                    INSERT INTO conversation(
                        id, camp_id, agent_id, last_message_sequence,
                        version, created_at, updated_at
                    ) VALUES (
                        ?1, ?2, 'agent_1', 0,
                        1, datetime('now'), datetime('now')
                    )
                    "#,
                    params![format!("delivery-queue-{label}"), camp_id],
                )
                .unwrap();
            camp_id
        }

        fn enqueue_for(&mut self, camp_id: &str, message_id: &str, body: &str) -> String {
            let transaction = self.database.connection_mut().transaction().unwrap();
            let now = chrono::Utc::now().to_rfc3339();
            transaction
                .execute(
                    r#"
                    UPDATE camp
                    SET last_message_sequence = last_message_sequence + 1,
                        version = version + 1, updated_at = ?2
                    WHERE id = ?1
                    "#,
                    params![camp_id, now],
                )
                .unwrap();
            let sequence: i64 = transaction
                .query_row(
                    "SELECT last_message_sequence FROM camp WHERE id = ?1",
                    [camp_id],
                    |row| row.get(0),
                )
                .unwrap();
            transaction
                .execute(
                    r#"
                    INSERT INTO camp_message(
                        id, camp_id, sequence, author_type, author_id, body,
                        structured_content_json, content_digest,
                        address_mode, addressed_agent_ids_json,
                        effective_recipient_ids_json, recipient_presentation_json,
                        origin_kind, recall_state, version, created_at, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, 'user', 'local_user', ?4,
                        ?5, ?6, 'explicit', '["agent_1"]',
                        '["agent_1"]', '{}', 'local_composer', 'recallable',
                        1, ?7, ?7
                    )
                    "#,
                    params![
                        message_id,
                        camp_id,
                        sequence,
                        body,
                        serde_json::to_string(&vec![serde_json::json!({
                            "kind": "text",
                            "text": body,
                        })])
                        .unwrap(),
                        format!("sha256:{message_id}"),
                        now,
                    ],
                )
                .unwrap();
            let delivery = enqueue_message_deliveries(
                &transaction,
                camp_id,
                message_id,
                &["agent_1".to_string()],
                &now,
            )
            .unwrap()
            .pop()
            .unwrap();
            transaction.commit().unwrap();
            delivery.delivery_id
        }

        fn publish_visible_without_delivery(
            &mut self,
            message_id: &str,
            author_type: &str,
            author_id: &str,
        ) {
            let transaction = self.database.connection_mut().transaction().unwrap();
            let now = chrono::Utc::now().to_rfc3339();
            transaction
                .execute(
                    "UPDATE camp SET last_message_sequence = last_message_sequence + 1, version = version + 1, updated_at = ?2 WHERE id = ?1",
                    params![self.camp_id, now],
                )
                .unwrap();
            let sequence: i64 = transaction
                .query_row(
                    "SELECT last_message_sequence FROM camp WHERE id = ?1",
                    [&self.camp_id],
                    |row| row.get(0),
                )
                .unwrap();
            transaction
                .execute(
                    r#"
                    INSERT INTO camp_message(
                        id, camp_id, sequence, author_type, author_id, body,
                        structured_content_json, content_digest,
                        address_mode, addressed_agent_ids_json,
                        effective_recipient_ids_json, recipient_presentation_json,
                        origin_kind, recall_state, version, created_at, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, 'visible history',
                        '[{"kind":"text","text":"visible history"}]', ?6,
                        'explicit', '[]', '[]', '{}', 'agent', 'closed',
                        1, ?7, ?7
                    )
                    "#,
                    params![
                        message_id,
                        self.camp_id,
                        sequence,
                        author_type,
                        author_id,
                        format!("sha256:{message_id}"),
                        now
                    ],
                )
                .unwrap();
            transaction.commit().unwrap();
        }

        fn frozen_history_result(&self, run_id: &str) -> (i64, bool) {
            self.database
                .connection()
                .query_row(
                    "SELECT claim_previous_public_boundary_sequence, claim_has_additional_public_messages FROM agent_run WHERE id = ?1",
                    [run_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap()
        }

        fn set_delivery_created_at(&self, message_id: &str, created_at: &str) {
            self.database
                .connection()
                .execute(
                    "UPDATE camp_message_delivery SET created_at = ?2, updated_at = ?2 WHERE message_id = ?1",
                    params![message_id, created_at],
                )
                .unwrap();
        }

        fn batch_run_count(&self) -> i64 {
            self.database
                .connection()
                .query_row(
                    "SELECT COUNT(*) FROM agent_run WHERE invocation_kind = 'batch'",
                    [],
                    |row| row.get(0),
                )
                .unwrap()
        }

        fn attach_completed_mission(&mut self, ready_working_directory: Option<&std::path::Path>) {
            let now = chrono::Utc::now().to_rfc3339();
            let source_directory: String = self
                .database
                .connection()
                .query_row(
                    "SELECT project_path FROM camp WHERE id = ?1",
                    [&self.camp_id],
                    |row| row.get(0),
                )
                .unwrap();
            self.database
                .connection()
                .execute(
                    r#"
                    INSERT INTO mission(
                        id, number, camp_id, title, description, status,
                        tags_json, source_attachments_json, details_version,
                        created_at, updated_at
                    ) VALUES (
                        'delivery-queue-mission', 1, ?1, 'Mission', '', 'completed',
                        '[]', '[]', 1, ?2, ?2
                    )
                    "#,
                    params![self.camp_id, now],
                )
                .unwrap();
            let Some(working_directory) = ready_working_directory else {
                return;
            };
            std::fs::create_dir_all(working_directory).unwrap();
            let execution_host_id: String = self
                .database
                .connection()
                .query_row(
                    "SELECT id FROM mission_execution_host WHERE singleton = 1",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            self.database
                .connection()
                .execute(
                    r#"
                    INSERT INTO mission_workspace(
                        id, mission_id, camp_id, execution_host_id,
                        source_directory, repository_root, git_common_dir,
                        worktree_path, working_directory, base_branch, branch,
                        base_sha, preparation_token, state, created_at, updated_at
                    ) VALUES (
                        'delivery-queue-mission-workspace', 'delivery-queue-mission', ?1, ?2,
                        ?3, ?3, ?4, ?5, ?5, 'main', 'rovai/mission/001',
                        'base-sha', 'owner-token', 'ready', ?6, ?6
                    )
                    "#,
                    params![
                        self.camp_id,
                        execution_host_id,
                        source_directory,
                        std::path::Path::new(&source_directory)
                            .join(".git")
                            .to_string_lossy()
                            .into_owned(),
                        working_directory.to_string_lossy().into_owned(),
                        now,
                    ],
                )
                .unwrap();
        }
    }

    // Owns the new authorization/queue transaction, not transport replay. SQLite
    // is necessary for rollback, receipt identity, cleanup and claim atomicity.
    #[test]
    #[cfg(feature = "extended-tests")]
    fn user_continuation_preserves_source_and_claims_independent_fifo_batches() {
        use crate::run_continuation::{ContinueAgentRunCommand, continue_agent_run};
        let mut fixture = Fixture::new();
        let old_delivery = fixture.enqueue("original-a", "原目标 A");
        fixture.enqueue("original-b", "原目标 B");
        let source = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .pop()
            .unwrap();
        let frozen_source = fixture.materialize_run(&source);
        let original_runtime_input = crate::context::ContextService
            .prepare_input_delivery(
                &mut fixture.database,
                &source,
                1,
                &frozen_source.manifest_id,
            )
            .unwrap();
        crate::context::ContextService
            .mark_input_delivery_unknown(
                &mut fixture.database,
                &original_runtime_input.id,
                "fixture unknown outcome",
            )
            .unwrap();
        fixture.database.connection().execute("UPDATE agent_run SET status='failed',wait_reason=NULL,runtime_recovery_required=0,ended_at='2026-10-07T00:00:00Z',cancel_requested_at='2026-10-07T00:00:00Z',cancel_reason_code='runtime_terminal_unconfirmed' WHERE id=?1",[&source]).unwrap();
        let envelope = |id: &str| CommandEnvelope {
            command_id: id.into(),
            actor: ActorRef::User {
                user_id: "local_user".into(),
            },
            camp_id: Some(fixture.camp_id.clone()),
            expected_versions: vec![],
            execution_epoch: None,
            payload: ContinueAgentRunCommand {
                camp_id: fixture.camp_id.clone(),
                agent_run_id: source.clone(),
                use_new_session: false,
            },
        };
        let first = envelope("continue-1");
        let mut second = envelope("continue-2");
        second.payload.use_new_session = true;
        fixture.enqueue("earlier-message", "排在续做前面的普通消息");
        let before_continuation: (i64, i64, i64) = fixture.database.connection().query_row(
            "SELECT (SELECT count(*) FROM camp_message WHERE camp_id=?1), last_message_sequence,
              (SELECT count(*) FROM event_log WHERE camp_id=?1 AND entity_type='camp_message')
             FROM camp WHERE id=?1", [&fixture.camp_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        // A failed transaction does not consume the authorization or publish an operation.
        fixture.database.connection().execute_batch("CREATE TRIGGER fail_continuation BEFORE INSERT ON camp_run_continuation BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        assert!(continue_agent_run(&mut fixture.database, &first).is_err());
        let unaccepted = crate::read_model::ReadModelService
            .camp_snapshot(&mut fixture.database, &fixture.camp_id)
            .unwrap();
        assert!(!unaccepted.agent_runs[0].has_accepted_continuation);
        let orphan: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT count(*) FROM camp_message WHERE author_id='run-continuation'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(orphan, 0);
        fixture
            .database
            .connection()
            .execute_batch("DROP TRIGGER fail_continuation")
            .unwrap();
        let accepted = continue_agent_run(&mut fixture.database, &first).unwrap();
        assert_eq!(
            accepted.result.status,
            crate::command::CommandResultStatus::Applied
        );
        let replay = continue_agent_run(&mut fixture.database, &first).unwrap();
        assert!(replay.replayed);
        assert_eq!(accepted.result.payload, replay.result.payload);
        let another = continue_agent_run(&mut fixture.database, &second).unwrap();
        assert_ne!(
            accepted.result.payload["deliveryId"],
            another.result.payload["deliveryId"]
        );
        assert!(accepted.result.payload.get("messageId").is_none());
        assert!(another.result.payload.get("messageId").is_none());
        let unchanged: (i64, i64, i64) = fixture.database.connection().query_row(
            "SELECT (SELECT count(*) FROM camp_message WHERE camp_id=?1), last_message_sequence,
              (SELECT count(*) FROM event_log WHERE camp_id=?1 AND entity_type='camp_message')
             FROM camp WHERE id=?1", [&fixture.camp_id], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(
            unchanged, before_continuation,
            "continuing does not create a message, sequence or publication"
        );
        let internal: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT count(*) FROM camp_message_delivery WHERE id IN (?1,?2)
             AND source_kind='continuation' AND message_id IS NULL",
                params![
                    accepted.result.payload["deliveryId"].as_str().unwrap(),
                    another.result.payload["deliveryId"].as_str().unwrap()
                ],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(internal, 2);
        fixture.enqueue("later-message", "排在续做后面的普通消息");
        assert_eq!(fixture.batch_run_count(), 1);
        assert!(
            claim_waiting_delivery_batches(&mut fixture.database, 10)
                .unwrap()
                .is_empty()
        );
        let projected = crate::read_model::ReadModelService
            .camp_snapshot(&mut fixture.database, &fixture.camp_id)
            .unwrap();
        assert_eq!(
            projected.agent_runs.len(),
            1,
            "the scheduler has not created a successor"
        );
        assert_eq!(projected.agent_runs[0].id, source);
        assert_eq!(projected.agent_runs[0].status, "failed");
        assert!(projected.agent_runs[0].has_accepted_continuation);
        assert_eq!(
            serde_json::to_value(&projected.agent_runs[0]).unwrap()["hasAcceptedContinuation"],
            true
        );
        assert_eq!(
            projected
                .message_deliveries
                .iter()
                .filter(|d| d.continuation_request == Some(true))
                .count(),
            2
        );
        for delivery in projected
            .message_deliveries
            .iter()
            .filter(|d| d.continuation_request == Some(true))
        {
            assert_eq!(delivery.message_id, "original-a");
            assert_eq!(delivery.input_message_ids, ["original-a", "original-b"]);
        }
        assert_eq!(projected.messages.len(), 4);
        let public_ids = [
            "original-a",
            "original-b",
            "earlier-message",
            "later-message",
        ]
        .map(str::to_string);
        {
            let tx = fixture.database.connection_mut().transaction().unwrap();
            assert!(
                !has_additional_public_messages(
                    &tx,
                    &fixture.camp_id,
                    "agent_1",
                    0,
                    6,
                    &public_ids
                )
                .unwrap()
            );
            assert!(
                has_additional_public_messages(
                    &tx,
                    &fixture.camp_id,
                    "agent_1",
                    0,
                    6,
                    &public_ids[..2]
                )
                .unwrap()
            );
        }
        fixture.publish_visible_without_delivery("other-system", "system", "ordinary-system");
        // Existing published continuation records stay unchanged. This feature
        // has not shipped, so the structural migration must not rewrite messages.
        fixture.publish_visible_without_delivery(
            "legacy-continuation",
            "system",
            "run-continuation",
        );
        fixture
            .database
            .connection()
            .execute_batch(
                "UPDATE camp_message
            SET body='你继续了爱丽丝的执行。',origin_kind='system',
                structured_content_json='[{\"kind\":\"text\",\"text\":\"你继续了爱丽丝的执行。\"}]'
            WHERE id='legacy-continuation';",
            )
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET cancel_acknowledged_at='2026-10-07T00:01:00Z' WHERE id=?1",
                [&source],
            )
            .unwrap();
        // The requests remain durable across a database reopen before the first claim.
        fixture.database = Database::open(&fixture._directory).unwrap();
        let reopened = crate::read_model::ReadModelService
            .camp_open_projection(&mut fixture.database, &fixture.camp_id)
            .unwrap();
        assert_eq!(reopened.agent_runs.len(), 1);
        assert!(reopened.agent_runs[0].has_accepted_continuation);
        assert_eq!(reopened.agent_runs[0].status, "failed");
        assert_eq!(
            reopened.agent_runs[0].version,
            projected.agent_runs[0].version
        );
        let legacy: (String, Option<String>, i64) = fixture.database.connection().query_row(
            "SELECT body,tombstoned_at,version FROM camp_message WHERE id='legacy-continuation'",
            [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(legacy, ("你继续了爱丽丝的执行。".into(), None, 1));
        let page = crate::read_model::ReadModelService
            .camp_messages_page(&mut fixture.database, &fixture.camp_id, 100, 0, 100)
            .unwrap();
        assert_eq!(page.messages.len(), 6);
        assert!(!page.has_more);
        for id in ["original-a", "original-b"] {
            let around = crate::read_model::ReadModelService
                .camp_messages_around(&mut fixture.database, &fixture.camp_id, id)
                .unwrap();
            assert!(around.source_available);
            assert!(around.messages.iter().any(|message| message.id == id));
        }
        let source_before:serde_json::Value=fixture.database.connection().query_row("SELECT json_object('status',status,'version',version,'endedAt',ended_at,'epoch',execution_epoch,'workspace',workspace_json) FROM agent_run WHERE id=?1",[&source],|r|r.get::<_,String>(0)).map(|s|serde_json::from_str(&s).unwrap()).unwrap();
        let old_delivery_before: (String, Option<String>, i64) = fixture
            .database
            .connection()
            .query_row(
                "SELECT status,claimed_agent_run_id,version FROM camp_message_delivery WHERE id=?1",
                [&old_delivery],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        let mut run_ids = vec![];
        // The original input was frozen while Tasks were off. New claims use
        // the current setting without changing that source evidence.
        crate::task_capability::set(fixture.database.connection(), true).unwrap();
        for expected in [
            vec!["earlier-message"],
            vec!["original-a", "original-b"],
            vec!["original-a", "original-b"],
            vec!["later-message"],
        ] {
            let task_title = format!("current-task-{}", run_ids.len());
            CollaborationService::default()
                .create_task(
                    &mut fixture.database,
                    &CommandEnvelope {
                        command_id: format!("task-for-{}", run_ids.len()),
                        actor: ActorRef::User {
                            user_id: "local_user".into(),
                        },
                        camp_id: Some(fixture.camp_id.clone()),
                        expected_versions: vec![],
                        execution_epoch: None,
                        payload: crate::collaboration::CreateTaskCommand {
                            camp_id: fixture.camp_id.clone(),
                            title: task_title.clone(),
                            description: String::new(),
                            assignee_agent_id: "agent_1".into(),
                        },
                    },
                )
                .unwrap();
            let claimed = claim_waiting_delivery_batches(&mut fixture.database, 10).unwrap();
            assert_eq!(claimed.len(), 1);
            let run = &claimed[0];
            let messages = fixture
                .database
                .connection()
                .prepare(
                    "SELECT message_id FROM agent_run_input WHERE agent_run_id=?1 ORDER BY ordinal",
                )
                .unwrap()
                .query_map([run], |r| r.get::<_, String>(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            assert_eq!(messages, expected);
            if expected.len() == 2 {
                let deliveries: i64=fixture.database.connection().query_row("SELECT count(DISTINCT delivery_id) FROM agent_run_input WHERE agent_run_id=?1",[run],|r|r.get(0)).unwrap();
                assert_eq!(deliveries, 1);
                let old_reused:bool=fixture.database.connection().query_row("SELECT EXISTS(SELECT 1 FROM agent_run_input WHERE agent_run_id=?1 AND delivery_id=?2)",params![run,old_delivery],|r|r.get(0)).unwrap();
                assert!(!old_reused);

                // A continuation gets current claim-time Tasks and the original complete input.
                let context = fixture.materialize_run(run);
                let input = context
                    .rendered_payload
                    .split("[RUN_INPUT]\n")
                    .nth(1)
                    .unwrap()
                    .split("\n[/RUN_INPUT]")
                    .next()
                    .unwrap();
                let input: serde_json::Value = serde_json::from_str(input).unwrap();
                assert_eq!(
                    input["messages"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|m| m["messageId"].as_str().unwrap())
                        .collect::<Vec<_>>(),
                    vec!["original-a", "original-b"]
                );
                assert!(context.rendered_payload.contains(&task_title));
                assert!(!context.rendered_payload.contains(&source));
                assert!(!context.rendered_payload.contains("continuation"));
                use crate::{
                    camp_history::{
                        HistorySearchInput, ThreadHistoryService, ThreadReadInput,
                        ThreadSearchInput,
                    },
                    team_tool::AuthenticatedTeamToolRun,
                };
                let reader = AuthenticatedTeamToolRun {
                    camp_id: fixture.camp_id.clone(),
                    agent_id: "agent_1".into(),
                    agent_run_id: run.clone(),
                    execution_epoch: 1,
                };
                let history = ThreadHistoryService
                    .read(
                        &mut fixture.database,
                        &reader,
                        &serde_json::from_value::<ThreadReadInput>(json!({"limit":100})).unwrap(),
                    )
                    .unwrap();
                assert_eq!(history["items"].as_array().unwrap().len(), 6);
                for (query, expected_count) in [("继续了", 1), ("原目标", 2)] {
                    let found = ThreadHistoryService
                        .search_camp(
                            &mut fixture.database,
                            &reader,
                            &serde_json::from_value::<ThreadSearchInput>(json!({"query":query}))
                                .unwrap(),
                        )
                        .unwrap();
                    assert_eq!(found["results"].as_array().unwrap().len(), expected_count);
                    let found = ThreadHistoryService
                        .search_history(
                            &mut fixture.database,
                            &reader,
                            &serde_json::from_value::<HistorySearchInput>(json!({"query":query}))
                                .unwrap(),
                        )
                        .unwrap();
                    // history.search deliberately excludes the current Thread.
                    assert!(found["results"].as_array().unwrap().is_empty());
                }
            }
            fixture
                .database
                .connection()
                .execute(
                    "UPDATE agent_run SET status='failed',ended_at=datetime('now') WHERE id=?1",
                    [run],
                )
                .unwrap();
            run_ids.push(run.clone());
        }
        assert_ne!(run_ids[1], run_ids[2]);
        let after_claims = crate::read_model::ReadModelService
            .camp_open_projection(&mut fixture.database, &fixture.camp_id)
            .unwrap();
        for run in &after_claims.agent_runs {
            assert_eq!(run.has_accepted_continuation, run.id == source);
        }
        let source_after:serde_json::Value=fixture.database.connection().query_row("SELECT json_object('status',status,'version',version,'endedAt',ended_at,'epoch',execution_epoch,'workspace',workspace_json) FROM agent_run WHERE id=?1",[&source],|r|r.get::<_,String>(0)).map(|s|serde_json::from_str(&s).unwrap()).unwrap();
        assert_eq!(source_before, source_after);
        let old_delivery_after: (String, Option<String>, i64) = fixture
            .database
            .connection()
            .query_row(
                "SELECT status,claimed_agent_run_id,version FROM camp_message_delivery WHERE id=?1",
                [&old_delivery],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(old_delivery_before, old_delivery_after);
        let old_runtime_status: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT status FROM runtime_input_delivery WHERE id=?1",
                [&original_runtime_input.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(old_runtime_status, "delivery_unknown");
        let old_digest: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT 'sha256:' || blob.sha256 FROM context_manifest JOIN managed_blob AS blob ON blob.id=rendered_payload_blob_id WHERE context_manifest.id=?1",
                [&frozen_source.manifest_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(old_digest, frozen_source.rendered_payload_digest);

        let system_messages:i64=fixture.database.connection().query_row("SELECT count(*) FROM camp_message WHERE author_type='system' AND author_id='run-continuation'",[],|r|r.get(0)).unwrap();
        assert_eq!(system_messages, 1);
        // Previously published operation rows and normal messages remain readable.
        {
            let tx = fixture.database.connection_mut().transaction().unwrap();
            for id in [
                "original-a",
                "original-b",
                "other-system",
                "legacy-continuation",
            ] {
                crate::collaboration::append_domain_event(
                    &tx,
                    "camp_message.sent",
                    Some(&fixture.camp_id),
                    Some(("camp_message", id)),
                    &ActorRef::User {
                        user_id: "local_user".into(),
                    },
                    None,
                    &json!({}),
                )
                .unwrap();
            }
            tx.commit().unwrap();
        }
        let observer_camp = fixture.add_camp_lane("history-reader");
        fixture.enqueue_for(&observer_camp, "history-request", "检查旧会话");
        let observer_run = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .pop()
            .unwrap();
        fixture.materialize_run(&observer_run);
        let reader = crate::team_tool::AuthenticatedTeamToolRun {
            camp_id: observer_camp,
            agent_id: "agent_1".into(),
            agent_run_id: observer_run,
            execution_epoch: 1,
        };
        for (query, count) in [("继续了", 1), ("原目标", 2), ("visible history", 1)] {
            let result = crate::camp_history::ThreadHistoryService
                .search_history(
                    &mut fixture.database,
                    &reader,
                    &serde_json::from_value(json!({"query":query})).unwrap(),
                )
                .unwrap();
            assert_eq!(
                result["results"].as_array().unwrap().len(),
                count,
                "{result}"
            );
        }
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT count(*) FROM camp_turn WHERE camp_id=?1",
                    [&fixture.camp_id],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        fixture.publish_visible_without_delivery("legacy-second", "system", "run-continuation");
        crate::db::assert_legacy_request_upgrade(
            &mut fixture.database,
            &[
                (
                    accepted.result.payload["deliveryId"].as_str().unwrap(),
                    "legacy-continuation",
                ),
                (
                    another.result.payload["deliveryId"].as_str().unwrap(),
                    "legacy-second",
                ),
            ],
        );
    }

    // Keep Task scope in the existing admission owner, but exercise production
    // send, batch claim, Stop and Task update instead of filling run.task_id.
    #[cfg(feature = "extended-tests")]
    fn assert_continuation_task_links() {
        use crate::{
            collaboration::{CreateTaskCommand, TaskAssigneeUpdate, TaskStatus, UpdateTaskCommand},
            command::CommandResultStatus,
            message_delivery::{
                AgentAddressingMode, SendQueuedAgentMessage, persist_queued_agent_message,
            },
            run_continuation::{ContinueAgentRunCommand, continue_agent_run},
        };
        for agent_send in [false, true] {
            for change in ["cancelled", "completed", "reassigned", "unassigned"] {
                for queued_before_change in [false, true] {
                    let mut fixture = Fixture::with_members(&["agent_1", "agent_2"]);
                    crate::task_capability::set(fixture.database.connection(), true).unwrap();
                    let service = CollaborationService::default();
                    let mut tasks = Vec::new();
                    for title in ["Task whose scope changes", "Other valid Task"] {
                        let command = fixture.user_command(CreateTaskCommand {
                            camp_id: fixture.camp_id.clone(),
                            title: title.into(),
                            description: String::new(),
                            assignee_agent_id: "agent_1".into(),
                        });
                        let created = service
                            .create_task(&mut fixture.database, &command)
                            .unwrap();
                        assert_eq!(created.result.status, CommandResultStatus::Applied);
                        tasks.push(
                            created.result.payload["taskId"]
                                .as_str()
                                .unwrap()
                                .to_string(),
                        );
                    }
                    let first_message = if agent_send {
                        fixture.send_user_input("agent_2", "Delegate the linked task", None);
                        let sender = claim_waiting_delivery_batches(&mut fixture.database, 1)
                            .unwrap()
                            .pop()
                            .unwrap();
                        let tx = fixture.database.connection_mut().transaction().unwrap();
                        let sent = persist_queued_agent_message(
                            &tx,
                            &SendQueuedAgentMessage {
                                command_id: "task-linked-agent-send",
                                camp_id: &fixture.camp_id,
                                source_agent_run_id: &sender,
                                author_agent_id: "agent_2",
                                execution_epoch: 0,
                                body: "Handle the explicitly linked Task",
                                explicit_recipients: &["agent_1".into()],
                                agent_addressing_mode: AgentAddressingMode::Automatic,
                                mention_user: false,
                                task_id: Some(&tasks[0]),
                                source_files: &[],
                            },
                        )
                        .unwrap();
                        assert_eq!(sent.code, "camp_message.send_accepted");
                        let message = sent.payload["messageId"].as_str().unwrap().to_string();
                        tx.commit().unwrap();
                        fixture.stop_run(&sender);
                        message
                    } else {
                        fixture.send_user_input(
                            "agent_1",
                            "Handle the explicitly linked Task",
                            Some(&tasks[0]),
                        )
                    };
                    // The invalid link is neither the last message nor the only Task.
                    fixture.send_user_input(
                        "agent_1",
                        "An ordinary instruction without a Task",
                        None,
                    );
                    fixture.send_user_input(
                        "agent_1",
                        "Handle another valid Task",
                        Some(&tasks[1]),
                    );
                    let source = claim_waiting_delivery_batches(&mut fixture.database, 1)
                        .unwrap()
                        .pop()
                        .unwrap();
                    let source_scope: (Option<String>, i64) = fixture.database.connection().query_row(
                        "SELECT task_id,(SELECT count(*) FROM agent_run_input WHERE agent_run_id=agent_run.id) FROM agent_run WHERE id=?1",
                        [&source], |r| Ok((r.get(0)?, r.get(1)?)),
                    ).unwrap();
                    assert_eq!(
                        source_scope,
                        (None, 3),
                        "batch Task links belong to its original messages"
                    );
                    fixture.stop_run(&source);
                    let original: (String, i64, String) = fixture
                        .database
                        .connection()
                        .query_row(
                            "SELECT status,version,ended_at FROM agent_run WHERE id=?1",
                            [&source],
                            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                        )
                        .unwrap();
                    let continuation_source = if agent_send && queued_before_change {
                        // A continued Run keeps the original business-message Task
                        // links, even though its Delivery is a system operation.
                        let first = fixture.user_command(ContinueAgentRunCommand {
                            camp_id: fixture.camp_id.clone(),
                            agent_run_id: source.clone(),
                            use_new_session: false,
                        });
                        let accepted = continue_agent_run(&mut fixture.database, &first).unwrap();
                        assert_eq!(accepted.result.code, "agent_run.continuation_requested");
                        let next = claim_waiting_delivery_batches(&mut fixture.database, 1)
                            .unwrap()
                            .pop()
                            .unwrap();
                        fixture.stop_run(&next);
                        next
                    } else {
                        source.clone()
                    };
                    let command = fixture.user_command(ContinueAgentRunCommand {
                        camp_id: fixture.camp_id.clone(),
                        agent_run_id: continuation_source,
                        use_new_session: false,
                    });
                    let pending = queued_before_change.then(|| {
                        let result = continue_agent_run(&mut fixture.database, &command).unwrap();
                        assert_eq!(result.result.code, "agent_run.continuation_requested");
                        result.result.payload["deliveryId"]
                            .as_str()
                            .unwrap()
                            .to_string()
                    });
                    let update = fixture.user_command(UpdateTaskCommand {
                        task_id: tasks[0].clone(),
                        status: match change {
                            "cancelled" => Some(TaskStatus::Cancelled),
                            "completed" => Some(TaskStatus::Completed),
                            _ => None,
                        },
                        assignee: match change {
                            "reassigned" => TaskAssigneeUpdate::Assign {
                                agent_id: "agent_2".into(),
                            },
                            "unassigned" => TaskAssigneeUpdate::Clear,
                            _ => TaskAssigneeUpdate::Unchanged,
                        },
                        cancel_reason: (change == "cancelled")
                            .then(|| "User cancelled the Task".into()),
                        completion_summary: (change == "completed")
                            .then(|| "Already completed".into()),
                        ..Default::default()
                    });
                    let updated = service.update_task(&mut fixture.database, &update).unwrap();
                    assert_eq!(updated.result.code, "task.updated");
                    if let Some(delivery) = pending {
                        let ordinary = fixture.send_user_input(
                            "agent_1",
                            "Unrelated work must still be claimed",
                            None,
                        );
                        let claimed =
                            claim_waiting_delivery_batches(&mut fixture.database, 1).unwrap();
                        assert_eq!(claimed.len(), 1);
                        let state: (String, Option<String>) = fixture.database.connection().query_row(
                            "SELECT status,claimed_agent_run_id FROM camp_message_delivery WHERE id=?1", [&delivery], |r| Ok((r.get(0)?,r.get(1)?)),
                        ).unwrap();
                        assert_eq!(
                            state,
                            ("claimed".into(), Some(claimed[0].clone())),
                            "Task {change} cannot invalidate accepted work"
                        );
                        fixture.stop_run(&claimed[0]);
                        let next =
                            claim_waiting_delivery_batches(&mut fixture.database, 1).unwrap();
                        assert_eq!(next.len(), 1);
                        let input: String = fixture
                            .database
                            .connection()
                            .query_row(
                                "SELECT message_id FROM agent_run_input WHERE agent_run_id=?1",
                                [&next[0]],
                                |r| r.get(0),
                            )
                            .unwrap();
                        assert_eq!(input, ordinary);
                    } else {
                        crate::task_capability::set(fixture.database.connection(), false).unwrap();
                        let result = continue_agent_run(&mut fixture.database, &command).unwrap();
                        assert_eq!(
                            result.result.code, "agent_run.continuation_requested",
                            "{change}, agent_send={agent_send}"
                        );
                        assert_eq!(
                            claim_waiting_delivery_batches(&mut fixture.database, 1)
                                .unwrap()
                                .len(),
                            1
                        );
                    }
                    let event_task: Option<String> = fixture.database.connection().query_row(
                        "SELECT json_extract(payload_json,'$.taskId') FROM event_log WHERE entity_type='camp_message' AND entity_id=?1 AND event_type='camp_message.sent'",
                        [&first_message], |r| r.get(0),
                    ).unwrap();
                    assert_eq!(event_task, None, "new Send never freezes a Task relation");
                    let unchanged = fixture
                        .database
                        .connection()
                        .query_row(
                            "SELECT status,version,ended_at FROM agent_run WHERE id=?1",
                            [&source],
                            |r| {
                                Ok((
                                    r.get::<_, String>(0)?,
                                    r.get::<_, i64>(1)?,
                                    r.get::<_, String>(2)?,
                                ))
                            },
                        )
                        .unwrap();
                    assert_eq!(unchanged, original);
                }
            }
        }
    }

    // Admission is a distinct authority and session-safety boundary. It needs
    // persisted bindings and the same claim fixture, never a real model.
    #[test]
    #[cfg(feature = "extended-tests")]
    fn continuation_rechecks_scope_and_selects_safe_session_at_claim() {
        use crate::run_continuation::{
            ContinueAgentRunCommand, continue_agent_run, has_unresolved_native_turn,
        };
        for terminal_failure in [false, true] {
            let mut fixture = Fixture::new();
            fixture.enqueue("scope-original", "继续原有范围");
            let source = claim_waiting_delivery_batches(&mut fixture.database, 1)
                .unwrap()
                .pop()
                .unwrap();
            let command = CommandEnvelope {
                command_id: "scope-1".into(),
                actor: ActorRef::User {
                    user_id: "local_user".into(),
                },
                camp_id: Some(fixture.camp_id.clone()),
                expected_versions: vec![],
                execution_epoch: None,
                payload: ContinueAgentRunCommand {
                    camp_id: fixture.camp_id.clone(),
                    agent_run_id: source.clone(),
                    use_new_session: false,
                },
            };
            let mut request = command.clone();
            assert_eq!(
                continue_agent_run(&mut fixture.database, &request)
                    .unwrap()
                    .result
                    .code,
                "agent_run.continuation_unavailable"
            );
            fixture
                .database
                .connection()
                .execute(
                    "UPDATE agent_run SET status='cancelled',ended_at=datetime('now') WHERE id=?1",
                    [&source],
                )
                .unwrap();
            request.command_id = "agent-cannot-authorize".into();
            request.execution_epoch = Some(1);
            request.actor = ActorRef::Agent {
                source_agent_run_id: source.clone(),
                agent_id: "agent_1".into(),
            };
            assert_eq!(
                continue_agent_run(&mut fixture.database, &request)
                    .unwrap()
                    .result
                    .code,
                "agent_run.continue_user_required"
            );
            request = command.clone();
            request.command_id = "wrong-thread".into();
            request.camp_id = Some("another-thread".into());
            assert_eq!(
                continue_agent_run(&mut fixture.database, &request)
                    .unwrap()
                    .result
                    .code,
                "agent_run.camp_mismatch"
            );
            request = command.clone();
            request.command_id = "session-changes-while-waiting".into();
            assert_eq!(
                continue_agent_run(&mut fixture.database, &request)
                    .unwrap()
                    .result
                    .status,
                crate::command::CommandResultStatus::Applied
            );
            fixture.database.connection().execute("UPDATE conversation SET native_session_id='changed-session',native_adapter_installation_id='adapter-test-codex',native_binding_compatibility_digest='incompatible' WHERE id='delivery-queue-agent-1'",[]).unwrap();
            let continued_run_id = claim_waiting_delivery_batches(&mut fixture.database, 1)
                .unwrap()
                .pop()
                .unwrap();
            let projected = crate::read_model::ReadModelService
                .camp_snapshot(&mut fixture.database, &fixture.camp_id)
                .unwrap();
            let continued_run = projected
                .agent_runs
                .iter()
                .find(|r| r.id == continued_run_id)
                .unwrap();
            assert_eq!(continued_run.status, "queued");
            assert!(continued_run.failure.is_none());
            assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT native_session_id FROM conversation WHERE id='delivery-queue-agent-1'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "changed-session",
            "compatibility is resolved by the ordinary Runtime path"
        );
            fixture.stop_run(&continued_run_id);
            assert_continuation_task_links();
            fixture.database.connection().execute("UPDATE camp_member SET leave_requested_at=datetime('now'),leave_request_command_id='leave-fixture' WHERE camp_id=?1 AND agent_id='agent_1'",[&fixture.camp_id]).unwrap();
            request = command.clone();
            request.command_id = "member-leaving".into();
            assert_eq!(
                continue_agent_run(&mut fixture.database, &request)
                    .unwrap()
                    .result
                    .code,
                "agent_run.continuation_unavailable"
            );
            fixture.database.connection().execute("UPDATE camp_member SET leave_requested_at=NULL,leave_request_command_id=NULL WHERE camp_id=?1 AND agent_id='agent_1'",[&fixture.camp_id]).unwrap();
            // Configuration drift does not prevent trying the same CLI Session.
            fixture.database.connection().execute("UPDATE conversation SET native_session_id='old-session',native_adapter_installation_id='adapter-test-codex',native_binding_compatibility_digest='incompatible' WHERE id='delivery-queue-agent-1'",[]).unwrap();
            request = command.clone();
            request.command_id = "automatic-new-session".into();
            assert_eq!(
                continue_agent_run(&mut fixture.database, &request)
                    .unwrap()
                    .result
                    .status,
                crate::command::CommandResultStatus::Applied
            );
            assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT native_session_id FROM conversation WHERE id='delivery-queue-agent-1'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
            "old-session"
        );
            let run = claim_waiting_delivery_batches(&mut fixture.database, 1)
                .unwrap()
                .pop()
                .unwrap();
            // Claim does not preempt the shared Runtime's Compatible/Controlled/New
            // decision, including upgrade metadata that still permits a resume attempt.
            fixture
                .database
                .connection()
                .execute(
                    "UPDATE agent_run SET status='running',execution_epoch=1 WHERE id=?1",
                    [&run],
                )
                .unwrap();
            let execution = crate::runtime::ExecutionRuntimeService::default()
                .load_agent_run_execution(&fixture.database, &run, 1)
                .unwrap()
                .unwrap();
            assert_eq!(
                execution.native_session_resume_disposition(),
                crate::runtime::NativeSessionResumeDisposition::Compatible
            );
            assert!(
                crate::run_continuation::can_replace_session_before_dispatch(
                    fixture.database.connection(),
                    &run,
                    1
                )
                .unwrap()
            );
            for (key, generation) in [
                (
                    Some("previous-key"),
                    execution.runtime.installation_generation,
                ),
                (None, execution.runtime.installation_generation - 1),
            ] {
                let tx = fixture.database.connection_mut().transaction().unwrap();
                tx.execute("UPDATE conversation SET native_binding_compatibility_digest=?1,
                native_installation_generation=?2,native_session_compatibility_key=?3 WHERE id='delivery-queue-agent-1'",
                params![execution.runtime.binding_compatibility_digest, generation, key]).unwrap();
                assert!(!has_unresolved_native_turn(&tx, "delivery-queue-agent-1").unwrap());
                tx.commit().unwrap();
                let current = crate::runtime::ExecutionRuntimeService::default()
                    .load_agent_run_execution(&fixture.database, &run, 1)
                    .unwrap()
                    .unwrap();
                assert_eq!(
                    current.native_session_resume_disposition(),
                    crate::runtime::NativeSessionResumeDisposition::Compatible
                );
            }
            let context = fixture.materialize_run(&run);
            fixture.database.connection().execute(
            "UPDATE conversation SET native_session_id='continuation-session' WHERE id='delivery-queue-agent-1'", [],
        ).unwrap();
            let stop_unknown = |fixture: &mut Fixture, run: &str, manifest: &str| {
                let delivery = crate::context::ContextService
                    .prepare_input_delivery(&mut fixture.database, run, 1, manifest)
                    .unwrap();
                crate::context::ContextService
                    .mark_input_delivery_unknown(
                        &mut fixture.database,
                        &delivery.id,
                        "stopped during dispatch",
                    )
                    .unwrap();
                assert!(
                    !crate::run_continuation::can_replace_session_before_dispatch(
                        fixture.database.connection(),
                        run,
                        1,
                    )
                    .unwrap(),
                    "a potentially accepted input cannot be resent by session fallback"
                );
                fixture.stop_run(run);
                fixture
                    .database
                    .connection()
                    .execute(
                        "UPDATE agent_run SET cancel_acknowledged_at=datetime('now') WHERE id=?1",
                        [run],
                    )
                    .unwrap();
            };
            stop_unknown(&mut fixture, &run, &context.manifest_id);
            // A later ordinary execution can prove this same binding usable. An
            // accepted input or a successful completion on another binding cannot.
            let needs_new_session = |fixture: &mut Fixture| {
                has_unresolved_native_turn(fixture.database.connection(), "delivery-queue-agent-1")
                    .unwrap()
            };
            assert!(needs_new_session(&mut fixture));
            fixture.enqueue("ordinary-recovery", "正常消息恢复现有会话");
            request = command.clone();
            request.command_id = "resume-failed".into();
            request.payload.agent_run_id = run.clone();
            assert_eq!(
                continue_agent_run(&mut fixture.database, &request)
                    .unwrap()
                    .result
                    .code,
                "agent_run.continuation_requested"
            );
            let recovered = claim_waiting_delivery_batches(&mut fixture.database, 1)
                .unwrap()
                .pop()
                .unwrap();
            let context = fixture.materialize_run(&recovered);
            let delivery = crate::context::ContextService
                .prepare_input_delivery(&mut fixture.database, &recovered, 1, &context.manifest_id)
                .unwrap();
            crate::context::ContextService
                .acknowledge_input_delivery(
                    &mut fixture.database,
                    &delivery.id,
                    "recovered-native-turn",
                )
                .unwrap();
            assert!(
                needs_new_session(&mut fixture),
                "an accepted input is not a completed native turn"
            );
            let recovered_execution = crate::runtime::ExecutionRuntimeService::default()
                .load_agent_run_execution(&fixture.database, &recovered, 1)
                .unwrap()
                .unwrap();
            if terminal_failure {
                let completed = crate::runtime::ExecutionRuntimeService::default()
                    .fail_agent_run(
                        &mut fixture.database,
                        &CommandEnvelope {
                            command_id: "ordinary-session-native-failed".into(),
                            actor: ActorRef::System {
                                component_id: "runtime-adapter:codex-cli".into(),
                            },
                            camp_id: Some(fixture.camp_id.clone()),
                            expected_versions: vec![],
                            execution_epoch: None,
                            payload: crate::runtime::FailAgentRunCommand {
                                agent_run_id: recovered.clone(),
                                expected_version: recovered_execution.version,
                                execution_epoch: 1,
                                error_code: "runtime_turn_failed".into(),
                                error_detail: Some(
                                    "trusted native tool failure after resume".into(),
                                ),
                                failure: None,
                                manual_retry_allowed: false,
                                ending_git_observation: None,
                            },
                        },
                    )
                    .unwrap();
                assert_eq!(completed.result.code, "agent_run.failed");
            } else {
                let completed = crate::runtime::ExecutionRuntimeService::default()
                    .succeed_agent_run(
                        &mut fixture.database,
                        &CommandEnvelope {
                            command_id: "ordinary-session-recovered".into(),
                            actor: ActorRef::System {
                                component_id: "runtime-adapter:codex-cli".into(),
                            },
                            camp_id: Some(fixture.camp_id.clone()),
                            expected_versions: vec![],
                            execution_epoch: None,
                            payload: crate::runtime::SucceedAgentRunCommand {
                                agent_run_id: recovered,
                                expected_version: recovered_execution.version,
                                execution_epoch: 1,
                                native_turn_id: "recovered-native-turn".into(),
                                final_output: "会话恢复成功".into(),
                                missing_send_recovery_candidate: None,
                                ending_git_observation: None,
                            },
                        },
                    )
                    .unwrap();
                assert_eq!(completed.result.code, "agent_run.succeeded");
            }
            assert!(
                !needs_new_session(&mut fixture),
                "later trusted completion must supersede the historical unknown turn"
            );
            {
                let tx = fixture.database.connection_mut().transaction().unwrap();
                tx.execute("UPDATE runtime_input_delivery SET native_binding_id='another-binding' WHERE agent_run_id=?1", [&recovered_execution.agent_run_id]).unwrap();
                assert!(
                    has_unresolved_native_turn(&tx, "delivery-queue-agent-1").unwrap(),
                    "completion in another binding must not clear this session's unknown turn"
                );
                tx.rollback().unwrap();
            }
            if terminal_failure {
                for mutation in [
                    "UPDATE agent_run SET terminal_resolution_source=NULL WHERE id=?1",
                    "UPDATE agent_run SET last_error_code='runtime_session_incompatible' WHERE id=?1",
                    "UPDATE runtime_input_delivery SET native_binding_generation=native_binding_generation+1 WHERE agent_run_id=?1",
                    "UPDATE runtime_input_delivery SET native_input_id='different-native-turn' WHERE agent_run_id=?1",
                    "UPDATE event_log SET execution_epoch=99 WHERE entity_type='agent_run' AND entity_id=?1 AND event_type='agent_run.failed'",
                ] {
                    let tx = fixture.database.connection_mut().transaction().unwrap();
                    tx.execute(mutation, [&recovered_execution.agent_run_id])
                        .unwrap();
                    assert!(
                        has_unresolved_native_turn(&tx, "delivery-queue-agent-1").unwrap(),
                        "untrusted or mismatched native failure must preserve the unknown turn: {mutation}"
                    );
                    tx.rollback().unwrap();
                }
            }
            // The queued request sees the ordinary Run's later native terminal at claim.
            let retried = claim_waiting_delivery_batches(&mut fixture.database, 1)
                .unwrap()
                .pop()
                .unwrap();
            let retried_context = fixture.materialize_run(&retried);
            let retried_execution = crate::runtime::ExecutionRuntimeService::default()
                .load_agent_run_execution(&fixture.database, &retried, 1)
                .unwrap()
                .unwrap();
            assert_eq!(
                retried_execution.native_session_id.as_deref(),
                Some("continuation-session")
            );
            stop_unknown(&mut fixture, &retried, &retried_context.manifest_id);
            assert!(
                needs_new_session(&mut fixture),
                "a new unknown native turn must supersede older successful completion"
            );
            request.command_id = "automatic-session-after-unknown-turn".into();
            assert_eq!(
                continue_agent_run(&mut fixture.database, &request)
                    .unwrap()
                    .result
                    .status,
                crate::command::CommandResultStatus::Applied
            );
            let replacement = claim_waiting_delivery_batches(&mut fixture.database, 1)
                .unwrap()
                .pop()
                .unwrap();
            assert!(fixture.database.connection().query_row(
            "SELECT native_session_id IS NULL FROM conversation WHERE id='delivery-queue-agent-1'",
            [], |row| row.get::<_, bool>(0),
        ).unwrap());
            fixture.stop_run(&replacement);
            request.command_id = "input-withdrawn-while-waiting".into();
            assert_eq!(
                continue_agent_run(&mut fixture.database, &request)
                    .unwrap()
                    .result
                    .status,
                crate::command::CommandResultStatus::Applied
            );
            // An input invalidated while waiting is cancelled, never revived or dispatched.
            fixture
            .database
            .connection()
            .execute(
                "UPDATE camp_message SET tombstoned_at=datetime('now') WHERE id='scope-original'",
                [],
            )
            .unwrap();
            assert!(
                claim_waiting_delivery_batches(&mut fixture.database, 1)
                    .unwrap()
                    .is_empty()
            );
            let cancelled:bool=fixture.database.connection().query_row("SELECT EXISTS(SELECT 1 FROM camp_message_delivery WHERE status='cancelled' AND failure_code='agent_run.continuation_unavailable')",[],|r|r.get(0)).unwrap();
            assert!(cancelled);
            let cancellation_events: i64 = fixture.database.connection().query_row(
            "SELECT count(*) FROM event_log WHERE event_type='agent_run.continuation_cancelled' AND camp_id=?1",
            [&fixture.camp_id], |row| row.get(0),
        ).unwrap();
            assert_eq!(
                cancellation_events, 1,
                "a cancelled request must invalidate the visible queue even without a new Run"
            );
            fixture
                .database
                .connection()
                .execute(
                    "UPDATE camp_message SET tombstoned_at=NULL WHERE id='scope-original'",
                    [],
                )
                .unwrap();
            request.command_id = "expires-before-following-message".into();
            assert_eq!(
                continue_agent_run(&mut fixture.database, &request)
                    .unwrap()
                    .result
                    .status,
                crate::command::CommandResultStatus::Applied
            );
            fixture
            .database
            .connection()
            .execute(
                "UPDATE camp_message SET tombstoned_at=datetime('now') WHERE id='scope-original'",
                [],
            )
            .unwrap();
            fixture.enqueue("after-expired-continuation", "处理后面的普通消息");
            let following = claim_waiting_delivery_batches(&mut fixture.database, 1).unwrap();
            assert_eq!(
                following.len(),
                1,
                "expired requests must not delay the following input until the next fallback tick"
            );
            let input: String = fixture
                .database
                .connection()
                .query_row(
                    "SELECT message_id FROM agent_run_input WHERE agent_run_id=?1",
                    [&following[0]],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(input, "after-expired-continuation");
        }
    }

    #[test]
    fn waiting_deliveries_create_no_run_until_fifo_batch_claim() {
        let mut fixture = Fixture::new();
        let first_delivery_id = fixture.enqueue("message-1", "第一条");
        let second_delivery_id = fixture.enqueue("message-2", "第二条");

        assert_eq!(fixture.batch_run_count(), 0);
        let waiting: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_message_delivery WHERE status = 'waiting'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(waiting, 2);

        let claimed = claim_waiting_delivery_batches(&mut fixture.database, 100).unwrap();
        assert_eq!(claimed.len(), 1);
        let run_id = &claimed[0];
        let run: (String, String, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                "SELECT status, anchor_message_id, camp_turn_id FROM agent_run WHERE id = ?1",
                [run_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(run, ("queued".to_string(), "message-2".to_string(), None));
        let inputs = {
            let mut statement = fixture
                .database
                .connection()
                .prepare(
                    "SELECT message_id, delivery_id FROM agent_run_input WHERE agent_run_id = ?1 ORDER BY ordinal",
                )
                .unwrap();
            statement
                .query_map([run_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        assert_eq!(
            inputs,
            vec![
                ("message-1".to_string(), first_delivery_id),
                ("message-2".to_string(), second_delivery_id),
            ]
        );
        let closed: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_message WHERE recall_state = 'closed'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(closed, 2);
        // One integration seam: all co-claimed inputs publish, then the Run and its
        // deliveries settle in the real schema, producing one typed round source.
        let tx = fixture.database.connection_mut().transaction().unwrap();
        for message in ["message-1", "message-2"] {
            tx.execute("INSERT INTO event_log(event_id,event_type,payload_json,camp_id,entity_type,entity_id,actor_type,actor_id,created_at) VALUES(?1,'camp_message.sent','{}',?2,'camp_message',?3,'user','local_user',datetime('now'))",params![Uuid::new_v4().to_string(),fixture.camp_id,message]).unwrap();
        }
        tx.execute(
            "UPDATE agent_run SET status='succeeded',ended_at=datetime('now') WHERE id=?1",
            [run_id],
        )
        .unwrap();
        assert_eq!(
            tx.query_row("SELECT count(*) FROM notification_round", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        settle_run_deliveries(
            &tx,
            run_id,
            "succeeded",
            None,
            &chrono::Utc::now().to_rfc3339(),
        )
        .unwrap();
        tx.commit().unwrap();
        let notifications = crate::notification::NotificationEpisodeService::default();
        let changes = notifications
            .changes_since(&mut fixture.database, "local_user", 0, 100)
            .unwrap();
        let signals = changes
            .changes
            .iter()
            .filter_map(|c| c.heads_up_signal.as_ref())
            .collect::<Vec<_>>();
        assert_eq!(signals.len(), 1);
        assert_eq!(
            signals[0].semantic,
            crate::notification::NotificationSemantic::RoundCompleted
        );
        assert_eq!(signals[0].action.agent_run_id.as_ref(), Some(run_id));
        assert_eq!(
            signals[0].action.subject.as_ref().unwrap().related_run_ids,
            vec![run_id.clone()]
        );
    }

    // Owns the new multi-input transaction, exact-source recovery and late ACK fence.
    // The existing single-input fixture cannot exercise two Manifests on one Run.
    #[test]
    #[cfg(feature = "extended-tests")]
    fn active_inputs_preserve_initial_context_and_unsubmitted_sources() {
        for adapter in crate::agent_profile::AdapterKind::ALL {
            assert_eq!(
                crate::steer::supports_active_input(adapter.as_str()),
                matches!(
                    adapter,
                    crate::agent_profile::AdapterKind::CodexCli
                        | crate::agent_profile::AdapterKind::ClaudeCodeCli
                        | crate::agent_profile::AdapterKind::Pi
                        | crate::agent_profile::AdapterKind::CodebuddyCli
                        | crate::agent_profile::AdapterKind::QwenCode
                        | crate::agent_profile::AdapterKind::MinimaxCodeCli
                        | crate::agent_profile::AdapterKind::HermesCli
                        | crate::agent_profile::AdapterKind::GrokBuild
                        | crate::agent_profile::AdapterKind::KiroCli
                        | crate::agent_profile::AdapterKind::ZcodeApp
                        | crate::agent_profile::AdapterKind::TraeCnCli
                )
            );
        }
        use crate::context::{
            CharterDeliveryMode, ContextMaterialization, ContextService, MaterializeContextRequest,
        };
        // A claimed Run may accept intent before its first input is ready.
        // No context or native input is made until the initial input is accepted.
        for (stage, terminal) in [
            ("queued", None),
            ("running", None),
            ("queued", Some("cancelled")),
            ("running", Some("failed")),
        ] {
            let mut f = Fixture::new();
            f.enqueue("startup-initial", "initial only");
            let run = claim_waiting_delivery_batches(&mut f.database, 1)
                .unwrap()
                .remove(0);
            f.database
                .connection()
                .execute(
                    "UPDATE agent_run SET runtime_reported_version='0.162.1' WHERE id=?1",
                    [&run],
                )
                .unwrap();
            let initial = (stage == "running").then(|| f.materialize_run(&run));
            let epoch = if stage == "queued" { 0 } else { 1 };
            let availability =
                crate::steer::active_input_availability(f.database.connection(), &run, epoch)
                    .unwrap();
            assert!(availability.can_steer);
            assert!(!availability.ready);
            let source = f.enqueue("startup-correction", "startup correction");
            let tx = f.database.connection_mut().transaction().unwrap();
            crate::steer::route_user_message(
                &tx,
                "startup-correction",
                Some(&[crate::steer::ActiveInputTarget {
                    agent_run_id: run.clone(),
                    execution_epoch: epoch,
                }]),
            )
            .unwrap();
            tx.commit().unwrap();
            assert!(
                crate::steer::pending_inputs(f.database.connection())
                    .unwrap()
                    .is_empty()
            );
            let binding: (String, String, i64) = f.database.connection().query_row(
                "SELECT status,claimed_agent_run_id,target_execution_epoch FROM camp_message_delivery WHERE id=?1", [&source],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
            assert_eq!(binding, ("claimed".into(), run.clone(), 1));
            assert_eq!(
                f.database
                    .connection()
                    .query_row(
                        "SELECT count(*) FROM context_manifest WHERE source_delivery_id=?1",
                        [&source],
                        |r| r.get::<_, i64>(0)
                    )
                    .unwrap(),
                0
            );
            if let Some(terminal) = terminal {
                let tx = f.database.connection_mut().transaction().unwrap();
                tx.execute(
                    "UPDATE agent_run SET status=?2,ended_at=datetime('now') WHERE id=?1",
                    params![run, terminal],
                )
                .unwrap();
                settle_run_deliveries(&tx, &run, terminal, None, &chrono::Utc::now().to_rfc3339())
                    .unwrap();
                tx.commit().unwrap();
                assert_eq!(
                    f.database
                        .connection()
                        .query_row(
                            "SELECT status FROM camp_message_delivery WHERE id=?1",
                            [&source],
                            |r| r.get::<_, String>(0)
                        )
                        .unwrap(),
                    terminal
                );
                assert!(
                    claim_waiting_delivery_batches(&mut f.database, 1)
                        .unwrap()
                        .is_empty(),
                    "stopped/failed startup must not start another task"
                );
                continue;
            }
            let initial = initial.unwrap_or_else(|| f.materialize_run(&run));
            assert!(!initial.runtime_payload.contains("startup correction"));
            f.database.connection().execute("UPDATE conversation SET native_session_id='startup-session' WHERE id='delivery-queue-agent-1'", []).unwrap();
            let input = ContextService
                .prepare_input_delivery_for_context(&mut f.database, &run, 1, &initial)
                .unwrap();
            assert!(
                crate::steer::pending_inputs(f.database.connection())
                    .unwrap()
                    .is_empty()
            );
            ContextService
                .acknowledge_input_delivery(&mut f.database, &input.id, "startup-turn")
                .unwrap();
            assert!(
                crate::steer::active_input_availability(f.database.connection(), &run, 1)
                    .unwrap()
                    .ready
            );
            let pending = crate::steer::pending_inputs(f.database.connection()).unwrap();
            assert_eq!(pending.len(), 1);
            assert_eq!(pending[0].delivery_id, source);
            assert_eq!(pending[0].execution_epoch, 1);
        }
        let mut fixture = Fixture::new();
        fixture.publish_visible_without_delivery("quoted-reference", "agent", "agent_2");
        fixture.enqueue("initial-steer", "initial work");
        // Already published weak references must survive claim even after their
        // targets have disappeared; initial input and Steer share one projector.
        let reference_id = crate::camp_id::ThreadId::new().to_string();
        let reference = StructuredThreadMessageSegment::ThreadReference {
            thread_id: reference_id.clone(),
            title_at_send: "登录 [发布标题]".into(),
        };
        let initial_content = vec![
            StructuredThreadMessageSegment::Text {
                text: "initial work".into(),
            },
            reference.clone(),
        ];
        fixture.database.connection().execute(
            "UPDATE camp_message SET structured_content_json=?1,content_digest=?2 WHERE id='initial-steer'",
            params![serde_json::to_string(&initial_content).unwrap(), canonical_content_digest(&initial_content).unwrap()],
        ).unwrap();
        let run = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .remove(0);
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET runtime_reported_version='0.162.1' WHERE id=?1",
                [&run],
            )
            .unwrap();
        let initial = fixture.materialize_run(&run);
        assert!(
            initial
                .runtime_payload
                .contains(&format!("rovai://thread/{reference_id}"))
        );
        fixture.database.connection().execute("UPDATE conversation SET native_session_id='steer-session' WHERE id='delivery-queue-agent-1'", []).unwrap();
        let first = ContextService
            .prepare_input_delivery_for_context(&mut fixture.database, &run, 1, &initial)
            .unwrap();
        ContextService
            .acknowledge_input_delivery(&mut fixture.database, &first.id, "same-native-turn")
            .unwrap();
        let view = crate::read_model::ReadModelService
            .camp_snapshot(&mut fixture.database, &fixture.camp_id)
            .unwrap();
        assert!(
            view.agent_runs
                .iter()
                .find(|r| r.id == run)
                .unwrap()
                .can_steer
        );
        // This existing Steer transaction owner also verifies its execution-window
        // boundary: receipt updates and late tool completion cannot move the input.
        let write_tool = |f: &mut Fixture, id: &str, terminal: bool| {
            crate::execution_evidence::ExecutionEvidenceService.record_runtime_event(
                &mut f.database, &crate::managed_blob::ManagedBlobStore::new(&f._directory),
                &run, 1, if terminal { "activity.completed" } else { "activity.started" },
                &serde_json::json!({"item":{"id":id,"type":"commandExecution","command":"pwd",
                    "status":if terminal {"completed"} else {"inProgress"},"aggregatedOutput":"workspace"}}),
            ).unwrap();
        };
        write_tool(&mut fixture, "before-input", false);
        let ordinary = fixture.enqueue("ordinary-before-steer", "leave this queued");
        // Exceed the Builder's 8 KiB budget floor, then succeed with the normal budget.
        let correction = "first correction ".repeat(1024);
        let one = fixture.enqueue("steer-one", &correction);
        let two = fixture.enqueue("steer-two", "second correction");
        let content = vec![
            StructuredThreadMessageSegment::Text { text: correction },
            StructuredThreadMessageSegment::SkillMention {
                skill_id: "unavailable-skill".into(),
                name_at_send: "not-authorized".into(),
            },
            reference,
        ];
        fixture
            .database
            .connection()
            .execute(
                "UPDATE camp_message SET structured_content_json=?2,content_digest=?3 WHERE id=?1",
                params![
                    "steer-one",
                    serde_json::to_string(&content).unwrap(),
                    canonical_content_digest(&content).unwrap()
                ],
            )
            .unwrap();
        {
            let tx = fixture.database.connection_mut().transaction().unwrap();
            let quote = capture_quote(
                &tx,
                &fixture.camp_id,
                None,
                &QuoteSelection {
                    message_id: "quoted-reference".into(),
                    body_at_selection: "visible history".into(),
                    start_scalar: 0,
                    end_scalar: 15,
                    text: "visible history".into(),
                    current_user_display_name: None,
                },
            )
            .unwrap();
            store_quotes(&tx, QuoteStorage::CampMessage, "steer-one", &[quote]).unwrap();
            tx.commit().unwrap();
        }
        {
            let tx = fixture.database.connection_mut().transaction().unwrap();
            for targets in [
                vec![],
                vec![crate::steer::ActiveInputTarget {
                    agent_run_id: "previous-run".into(),
                    execution_epoch: 1,
                }],
                vec![crate::steer::ActiveInputTarget {
                    agent_run_id: run.clone(),
                    execution_epoch: 2,
                }],
            ] {
                crate::steer::route_user_message(&tx, "steer-one", Some(&targets)).unwrap();
                let status: String = tx
                    .query_row(
                        "SELECT status FROM camp_message_delivery WHERE id=?1",
                        [&one],
                        |r| r.get(0),
                    )
                    .unwrap();
                assert_eq!(
                    status, "waiting",
                    "stale targets must remain ordinary queued input"
                );
            }
            crate::steer::route_user_message(
                &tx,
                "steer-one",
                Some(&[crate::steer::ActiveInputTarget {
                    agent_run_id: run.clone(),
                    execution_epoch: 1,
                }]),
            )
            .unwrap();
            crate::steer::route_user_message(&tx, "steer-two", None).unwrap();
            tx.commit().unwrap();
        }
        write_tool(&mut fixture, "after-input", true);
        let input_page = crate::execution_window::read_block_page(
            &mut fixture.database,
            &fixture.camp_id,
            &run,
            None,
            None,
            24,
        )
        .unwrap();
        assert_eq!(
            input_page
                .blocks
                .iter()
                .map(|b| (b.kind, b.tool_count))
                .collect::<Vec<_>>(),
            vec![("toolGroup", 1), ("item", 0), ("item", 0), ("toolGroup", 1)]
        );
        let marker = &input_page.blocks[1].evidence[0];
        assert_eq!(marker.event_type, crate::execution_input::EVENT);
        assert_eq!(marker.payload["status"], "pending");
        assert_eq!(
            marker.payload["preview"].as_str().unwrap().chars().count(),
            240
        );
        assert_eq!(marker.payload["messageId"], "steer-one");
        assert!(marker.canonical.is_none());
        let stored: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT payload_preview_json FROM agent_run_execution_evidence WHERE id=?1",
                [&marker.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&stored).unwrap(),
            serde_json::json!({"deliveryId":one,"messageId":"steer-one"})
        );
        let tail = crate::execution_window::read_block_page(
            &mut fixture.database,
            &fixture.camp_id,
            &run,
            None,
            None,
            1,
        )
        .unwrap();
        let previous = crate::execution_window::read_block_page(
            &mut fixture.database,
            &fixture.camp_id,
            &run,
            tail.next_before_sequence,
            None,
            1,
        )
        .unwrap();
        assert_eq!(
            previous.blocks[0].evidence[0].payload["messageId"],
            "steer-two"
        );
        write_tool(&mut fixture, "before-input", true);
        let pending = crate::steer::pending_inputs(fixture.database.connection()).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].delivery_id, one);
        let request = MaterializeContextRequest {
            agent_run_id: &run,
            execution_epoch: 1,
            charter_delivery_mode: CharterDeliveryMode::NativeAppend,
            max_payload_bytes: 96 * 1024,
        };
        let materialize = |fixture: &mut Fixture, delivery: &str| {
            let ContextMaterialization::Ready(context) = ContextService
                .materialize_message_delivery(
                    &mut fixture.database,
                    &crate::managed_blob::ManagedBlobStore::new(&fixture._directory),
                    delivery,
                    &[],
                    &request,
                )
                .unwrap()
            else {
                panic!("input must be ready")
            };
            // Both input routes retain one final payload, not copies of its sections.
            // Keep this in the existing multi-input persistence/recovery owner.
            let (compact, source, blob): (bool, String, String) = fixture.database.connection().query_row(
                "SELECT context_delivery_profile_json IS NULL AND context_delivery_profile_digest IS NULL
                    AND run_fact_payload_json IS NULL AND run_fact_digest IS NULL
                    AND self_active_task_evidence_json IS NULL AND self_active_task_evidence_digest IS NULL
                    AND a2a_guidance_evidence_json IS NULL AND a2a_guidance_evidence_digest IS NULL
                    AND shared_message_evidence_digest IS NULL AND rendered_payload_digest IS NULL
                    AND attachment_digest IS NULL AND skill_exposure_digest IS NULL
                    AND current_input_skill_resolution_digest IS NULL AND mcp_exposure_digest IS NULL
                    AND mcp_projection_digest IS NULL,
                    current_input_source_json,rendered_payload_blob_id
                 FROM context_manifest WHERE id=?1 AND source_delivery_id=?2",
                params![context.manifest_id, delivery], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
            ).unwrap();
            assert!(
                compact,
                "Steer must retain the shared input storage reductions"
            );
            assert!(!source.contains("first correction"));
            assert_eq!(
                crate::managed_blob::ManagedBlobStore::new(&fixture._directory)
                    .read_text(&fixture.database, &blob)
                    .unwrap(),
                context.rendered_payload,
            );
            assert_eq!(fixture.database.connection().query_row(
                "SELECT count(*) FROM event_log WHERE payload_json LIKE '%first correction%'",
                [], |r| r.get::<_, i64>(0),
            ).unwrap(), 0, "input body must not be copied into durable events");
            context
        };
        assert!(
            ContextService
                .materialize_message_delivery(
                    &mut fixture.database,
                    &crate::managed_blob::ManagedBlobStore::new(&fixture._directory),
                    &one,
                    &[],
                    &MaterializeContextRequest {
                        agent_run_id: &run,
                        execution_epoch: 1,
                        charter_delivery_mode: CharterDeliveryMode::NativeAppend,
                        max_payload_bytes: 64
                    }
                )
                .is_err()
        );
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT count(*) FROM context_manifest WHERE source_delivery_id=?1",
                    [&one],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0,
            "over-budget input cannot leave a partial Manifest"
        );
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET status='waiting',wait_reason='approval' WHERE id=?1",
                [&run],
            )
            .unwrap();
        assert!(
            crate::steer::active_input_availability(fixture.database.connection(), &run, 1)
                .unwrap()
                .can_steer
        );
        let one_context = materialize(&mut fixture, &one);
        assert!(one_context.rendered_payload.contains("visible history"));
        let projected: serde_json::Value = serde_json::from_str(
            one_context
                .rendered_payload
                .split("[RUN_INPUT]\n")
                .nth(1)
                .unwrap()
                .split("\n[/RUN_INPUT]")
                .next()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(projected["messages"].as_array().unwrap().len(), 1);
        let body = projected["messages"][0]["body"].as_str().unwrap();
        assert!(body.contains(&format!("rovai://thread/{reference_id}")));
        assert!(body.contains("登录 \\[发布标题\\]"));
        assert!(projected["messages"][0].get("references").is_none());
        assert_eq!(
            projected["messages"][0]["quotes"][0]["text"],
            "visible history"
        );
        assert!(
            projected["messages"][0].get("skills").is_none(),
            "unavailable Skill cannot expand authority"
        );
        assert!(one_context.rendered_payload.contains("first correction"));
        assert!(!one_context.rendered_payload.contains("initial work"));
        assert!(!one_context.rendered_payload.contains("leave this queued"));
        assert!(!one_context.rendered_payload.contains("second correction"));
        assert_eq!(
            materialize(&mut fixture, &one).rendered_payload,
            one_context.rendered_payload
        );
        let one_input = ContextService
            .prepare_input_delivery_for_context(&mut fixture.database, &run, 1, &one_context)
            .unwrap();
        assert!(
            ContextService
                .begin_runtime_input_dispatch(&mut fixture.database, &one_input.id, &run, 1)
                .unwrap()
        );
        let sending = crate::execution_window::read_changes(
            &mut fixture.database,
            &fixture.camp_id,
            &run,
            input_page.through_change_sequence,
            &[],
            24,
        )
        .unwrap();
        assert_eq!(
            sending
                .evidence
                .iter()
                .find(|e| e.id == marker.id)
                .unwrap()
                .payload["status"],
            "sending"
        );
        fixture.database.connection().execute("UPDATE agent_profile SET display_name='Changed after first preparation' WHERE id='agent_1'", []).unwrap();
        let two_context = materialize(&mut fixture, &two);
        assert!(
            two_context
                .rendered_payload
                .contains("Changed after first preparation")
        );
        assert_eq!(
            one_context.camp_message_boundary_sequence,
            two_context.camp_message_boundary_sequence
        );
        let two_input = ContextService
            .prepare_input_delivery_for_context(&mut fixture.database, &run, 1, &two_context)
            .unwrap();
        assert_ne!(one_input.id, first.id);
        assert_ne!(two_input.id, one_input.id);
        // Native input identity may be the same turn for all injections.
        ContextService
            .acknowledge_input_delivery(&mut fixture.database, &two_input.id, "same-native-turn")
            .unwrap();
        ContextService
            .acknowledge_input_delivery(&mut fixture.database, &one_input.id, "same-native-turn")
            .unwrap();
        assert_eq!(
            fixture
                .database
                .connection()
                .query_row(
                    "SELECT status,wait_reason FROM agent_run WHERE id=?1",
                    [&run],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                )
                .unwrap(),
            ("waiting".into(), "approval".into()),
            "Steer receipt must not resolve the original wait"
        );
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET status='running',wait_reason=NULL WHERE id=?1",
                [&run],
            )
            .unwrap();
        let changed = crate::execution_window::read_block_changes(
            &mut fixture.database,
            &fixture.camp_id,
            &run,
            input_page.through_change_sequence,
            &[],
            24,
        )
        .unwrap();
        let accepted = changed
            .blocks
            .iter()
            .flat_map(|b| &b.evidence)
            .find(|e| e.id == marker.id)
            .unwrap();
        assert_eq!(accepted.sequence, marker.sequence);
        assert_eq!(accepted.occurred_at, marker.occurred_at);
        assert_eq!(accepted.payload["status"], "accepted");
        assert!(accepted.change_sequence > marker.change_sequence);
        let restored = crate::execution_window::read_block_page(
            &mut fixture.database,
            &fixture.camp_id,
            &run,
            None,
            None,
            24,
        )
        .unwrap();
        assert_eq!(
            restored
                .blocks
                .iter()
                .map(|b| (&b.key, b.sequence, b.tool_count))
                .collect::<Vec<_>>(),
            input_page
                .blocks
                .iter()
                .map(|b| (&b.key, b.sequence, b.tool_count))
                .collect::<Vec<_>>()
        );
        let group = crate::execution_window::read_group_page(
            &mut fixture.database,
            &fixture.camp_id,
            &run,
            restored.blocks[0].sequence,
            None,
            None,
            24,
        )
        .unwrap();
        assert_eq!(group.evidence.len(), 1);
        assert_eq!(group.evidence[0].phase, "completed");
        let digest: String = fixture.database.connection().query_row("SELECT native_collaboration_state_digest FROM conversation WHERE id='delivery-queue-agent-1'", [], |r|r.get(0)).unwrap();
        assert_eq!(digest, two_context.collaboration_state_digest);
        assert_eq!(
            fixture.materialize_run(&run).rendered_payload,
            initial.rendered_payload
        );
        let unsent = fixture.enqueue("steer-unsent", "must survive completion");
        {
            let tx = fixture.database.connection_mut().transaction().unwrap();
            crate::steer::route_user_message(&tx, "steer-unsent", None).unwrap();
            tx.commit().unwrap();
        }
        let unsent_context = materialize(&mut fixture, &unsent);
        let unsent_input = ContextService
            .prepare_input_delivery_for_context(&mut fixture.database, &run, 1, &unsent_context)
            .unwrap();
        {
            let tx = fixture.database.connection_mut().transaction().unwrap();
            tx.execute(
                "UPDATE agent_run SET status='succeeded',ended_at=datetime('now') WHERE id=?1",
                [&run],
            )
            .unwrap();
            settle_run_deliveries(
                &tx,
                &run,
                "succeeded",
                None,
                &chrono::Utc::now().to_rfc3339(),
            )
            .unwrap();
            tx.commit().unwrap();
        }
        let settled = crate::execution_window::read_page(
            &mut fixture.database,
            &fixture.camp_id,
            &run,
            None,
            24,
        )
        .unwrap();
        assert_eq!(
            settled
                .evidence
                .iter()
                .find(|e| e.id == marker.id)
                .unwrap()
                .change_sequence,
            accepted.change_sequence,
            "Run settlement cannot rewrite an unchanged accepted receipt"
        );
        assert_eq!(
            settled
                .evidence
                .iter()
                .find(|e| e.id == marker.id)
                .unwrap()
                .payload["status"],
            "accepted"
        );
        assert_eq!(
            settled
                .evidence
                .iter()
                .find(|e| e.payload["messageId"] == "steer-unsent")
                .unwrap()
                .payload["status"],
            "queued"
        );
        for id in [&ordinary, &unsent] {
            let status: (String, Option<String>) = fixture
                .database
                .connection()
                .query_row(
                    "SELECT status,claimed_agent_run_id FROM camp_message_delivery WHERE id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(status, ("waiting".into(), None));
        }
        assert_eq!(
            ContextService
                .runtime_input_delivery_status(&fixture.database, &unsent_input.id)
                .unwrap()
                .as_deref(),
            Some("not_accepted")
        );
        assert!(
            !ContextService
                .begin_runtime_input_dispatch(&mut fixture.database, &unsent_input.id, &run, 1)
                .unwrap()
        );

        // Cancellation closes unsent work; ambiguous native submission never requeues.
        for (terminal, dispatch, unknown, expected) in [
            ("cancelled", false, false, "cancelled"),
            ("succeeded", true, false, "failed"),
            ("succeeded", true, true, "failed"),
        ] {
            let mut f = Fixture::new();
            f.enqueue("original", "original");
            let run = claim_waiting_delivery_batches(&mut f.database, 1)
                .unwrap()
                .remove(0);
            f.database
                .connection()
                .execute(
                    "UPDATE agent_run SET runtime_reported_version='0.162.1' WHERE id=?1",
                    [&run],
                )
                .unwrap();
            let context = f.materialize_run(&run);
            f.database.connection().execute("UPDATE conversation SET native_session_id='session' WHERE id='delivery-queue-agent-1'",[]).unwrap();
            let initial = ContextService
                .prepare_input_delivery_for_context(&mut f.database, &run, 1, &context)
                .unwrap();
            ContextService
                .acknowledge_input_delivery(&mut f.database, &initial.id, "turn")
                .unwrap();
            let source = f.enqueue("correction", "correction");
            let tx = f.database.connection_mut().transaction().unwrap();
            crate::steer::route_user_message(&tx, "correction", None).unwrap();
            tx.commit().unwrap();
            let request = MaterializeContextRequest {
                agent_run_id: &run,
                execution_epoch: 1,
                charter_delivery_mode: CharterDeliveryMode::NativeAppend,
                max_payload_bytes: 96 * 1024,
            };
            let ContextMaterialization::Ready(context) = ContextService
                .materialize_message_delivery(
                    &mut f.database,
                    &crate::managed_blob::ManagedBlobStore::new(&f._directory),
                    &source,
                    &[],
                    &request,
                )
                .unwrap()
            else {
                panic!("ready")
            };
            let input = ContextService
                .prepare_input_delivery_for_context(&mut f.database, &run, 1, &context)
                .unwrap();
            if dispatch {
                assert!(
                    ContextService
                        .begin_runtime_input_dispatch(&mut f.database, &input.id, &run, 1)
                        .unwrap()
                );
            }
            let snapshot = crate::read_model::ReadModelService
                .camp_snapshot(&mut f.database, &f.camp_id)
                .unwrap();
            let receipt = snapshot
                .message_deliveries
                .iter()
                .find(|d| d.id == source)
                .unwrap();
            assert_eq!(
                receipt.dispatch_phase,
                if dispatch {
                    "attempting"
                } else {
                    "materialized"
                }
            );
            if terminal == "succeeded" {
                {
                    if unknown {
                        ContextService
                            .mark_input_delivery_unknown(
                                &mut f.database,
                                &input.id,
                                "ACK unavailable",
                            )
                            .unwrap();
                    }
                    let version: i64 = f
                        .database
                        .connection()
                        .query_row("SELECT version FROM agent_run WHERE id=?1", [&run], |r| {
                            r.get(0)
                        })
                        .unwrap();
                    let completed = crate::runtime::ExecutionRuntimeService::default()
                        .succeed_agent_run(
                            &mut f.database,
                            &CommandEnvelope {
                                command_id: format!("receipt-independent-completion-{unknown}"),
                                actor: ActorRef::System {
                                    component_id: "runtime-adapter:codex-cli".into(),
                                },
                                camp_id: Some(f.camp_id.clone()),
                                expected_versions: vec![],
                                execution_epoch: None,
                                payload: crate::runtime::SucceedAgentRunCommand {
                                    agent_run_id: run.clone(),
                                    expected_version: version,
                                    execution_epoch: 1,
                                    native_turn_id: "turn".into(),
                                    final_output: "completed".into(),
                                    missing_send_recovery_candidate: None,
                                    ending_git_observation: None,
                                },
                            },
                        )
                        .unwrap();
                    assert_eq!(completed.result.code, "agent_run.succeeded");
                }
            } else {
                let tx = f.database.connection_mut().transaction().unwrap();
                tx.execute(
                    "UPDATE agent_run SET status=?2,ended_at=datetime('now') WHERE id=?1",
                    params![run, terminal],
                )
                .unwrap();
                settle_run_deliveries(&tx, &run, terminal, None, &chrono::Utc::now().to_rfc3339())
                    .unwrap();
                tx.commit().unwrap();
            }
            assert_eq!(
                f.database
                    .connection()
                    .query_row(
                        "SELECT status FROM camp_message_delivery WHERE id=?1",
                        [&source],
                        |r| r.get::<_, String>(0)
                    )
                    .unwrap(),
                expected
            );
            assert!(
                crate::steer::pending_inputs(f.database.connection())
                    .unwrap()
                    .is_empty()
            );
            if dispatch {
                assert_eq!(
                    ContextService
                        .runtime_input_delivery_status(&f.database, &input.id)
                        .unwrap()
                        .as_deref(),
                    Some("delivery_unknown")
                );
                ContextService
                    .acknowledge_input_delivery(&mut f.database, &input.id, "turn")
                    .unwrap();
                assert_eq!(
                    f.database
                        .connection()
                        .query_row("SELECT status FROM agent_run WHERE id=?1", [&run], |r| {
                            r.get::<_, String>(0)
                        })
                        .unwrap(),
                    "succeeded"
                );
                assert_eq!(
                    f.database
                        .connection()
                        .query_row(
                            "SELECT status FROM camp_message_delivery WHERE id=?1",
                            [&source],
                            |r| r.get::<_, String>(0)
                        )
                        .unwrap(),
                    "settled"
                );
            }
        }
    }

    // Owns Steer ABI admission; ordinary-run qualification is deliberately independent.
    #[test]
    #[cfg(feature = "extended-tests")]
    fn steer_admission_uses_the_frozen_run_and_rejects_stale_or_unknown_capability() {
        use crate::context::ContextService;
        use crate::steer::{SteerUnavailableReason as R, active_input_availability};
        let mut f = Fixture::new();
        f.enqueue("initial", "ordinary execution remains available");
        let run = claim_waiting_delivery_batches(&mut f.database, 1)
            .unwrap()
            .remove(0);
        let context = f.materialize_run(&run);
        f.database.connection().execute("UPDATE conversation SET native_session_id='gate-session' WHERE id='delivery-queue-agent-1'",[]).unwrap();
        let input = ContextService
            .prepare_input_delivery_for_context(&mut f.database, &run, 1, &context)
            .unwrap();
        ContextService
            .acknowledge_input_delivery(&mut f.database, &input.id, "original-turn")
            .unwrap();
        let cases = [
            (
                "pi",
                Some("0.87.0"),
                "pi-jsonl-rpc-v1",
                Some(R::VersionIncompatible),
            ),
            ("pi", Some("0.99.0"), "pi-jsonl-rpc-v1", None),
            (
                "pi",
                None,
                "pi-jsonl-rpc-v1",
                Some(R::RuntimeIdentityUnknown),
            ),
            (
                "pi",
                Some("1.1.0"),
                "old-protocol",
                Some(R::ProtocolIncompatible),
            ),
            (
                "kiro-cli",
                Some("2.7.0"),
                "acp-v1",
                Some(R::VersionIncompatible),
            ),
            ("kiro-cli", Some("2.21.1"), "acp-v1", None),
            (
                "qwen-code",
                Some("0.18.3"),
                "acp-v1",
                Some(R::VersionIncompatible),
            ),
            ("qwen-code", Some("0.18.4"), "acp-v1", None),
            ("minimax-code-cli", Some("0.6.12"), "acp-v1", None),
            ("hermes-cli", Some("0.22.4"), "acp-v1", None),
            ("hermes-cli", Some("0.23.0"), "acp-v1", None),
            ("hermes-cli", Some("1.0.0"), "acp-v1", None),
            (
                "hermes-cli",
                Some("0.22.3"),
                "acp-v1",
                Some(R::VersionIncompatible),
            ),
            (
                "hermes-cli",
                None,
                "acp-v1",
                Some(R::RuntimeIdentityUnknown),
            ),
            (
                "hermes-cli",
                Some("0.23.0"),
                "other",
                Some(R::ProtocolIncompatible),
            ),
            (
                "minimax-code-cli",
                Some("0.6.11"),
                "acp-v1",
                Some(R::VersionIncompatible),
            ),
            (
                "minimax-code-cli",
                Some("1.0.0"),
                "acp-v1",
                Some(R::VersionUnverified),
            ),
            (
                "grok-build",
                Some("1.0.13"),
                "acp-v1",
                Some(R::VersionIncompatible),
            ),
            ("grok-build", Some("1.0.14"), "acp-v1", None),
            (
                "claude-code-cli",
                Some("2.1.81"),
                "claude-code-print-v1",
                Some(R::VersionIncompatible),
            ),
            (
                "claude-code-cli",
                Some("2.1.83"),
                "claude-code-print-v1",
                None,
            ),
            (
                "codex-cli",
                Some("0.100.0"),
                "codex-app-server-v2",
                Some(R::VersionIncompatible),
            ),
            ("codex-cli", Some("0.162.1"), "codex-app-server-v2", None),
            (
                "zcode-app",
                Some("3.12.2"),
                "zcode-app-server-v1",
                Some(R::VersionUnverified),
            ),
            ("zcode-app", Some("0.16.5"), "zcode-app-server-v1", None),
            ("trae-cn-cli", Some("0.207.1"), "acp-v1", None),
            (
                "codebuddy-cli",
                Some("2.108.2"),
                "acp-v1",
                Some(R::VersionIncompatible),
            ),
            ("codebuddy-cli", Some("2.109.1"), "acp-v1", None),
            ("codebuddy-cli", Some("2.110.0"), "acp-v1", None),
            ("codebuddy-cli", Some("2.132.0"), "acp-v1", None),
            ("codebuddy-cli", Some("2.167.0"), "acp-v1", None),
            (
                "codebuddy-cli",
                Some("2.167.0-beta.1"),
                "acp-v1",
                Some(R::VersionUnverified),
            ),
            ("codebuddy-cli", Some("3.0.0"), "acp-v1", None),
            (
                "opencode-cli",
                Some("1.0.0"),
                "acp-v1",
                Some(R::RuntimeUnsupported),
            ),
        ];
        for (index, (adapter, version, protocol, reason)) in cases.iter().enumerate() {
            f.database.connection().execute("UPDATE agent_run SET runtime_adapter_kind=?2,runtime_reported_version=?3,runtime_protocol_version=?4 WHERE id=?1",params![run,adapter,version,protocol]).unwrap();
            let gate = active_input_availability(f.database.connection(), &run, 1).unwrap();
            assert_eq!(gate.unavailable_reason, *reason, "{adapter} {version:?}");
            let snapshot = crate::read_model::ReadModelService
                .camp_snapshot(&mut f.database, &f.camp_id)
                .unwrap();
            let view = snapshot.agent_runs.iter().find(|r| r.id == run).unwrap();
            assert_eq!(
                (view.can_steer, view.steer_unavailable_reason),
                (reason.is_none(), *reason)
            );
            let message = format!("direct-request-{index}");
            let source = f.enqueue(&message, "bypass the UI");
            let tx = f.database.connection_mut().transaction().unwrap();
            crate::steer::route_user_message(&tx, &message, None).unwrap();
            assert_eq!(
                tx.query_row(
                    "SELECT requested_mode FROM camp_message_delivery WHERE id=?1",
                    [&source],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
                if reason.is_none() { "steer" } else { "start" }
            );
            // Discard this probe's route, leaving no native write or queued correction.
            tx.rollback().unwrap();
            f.database.connection().execute("UPDATE camp_message_delivery SET status='cancelled',ended_at=datetime('now') WHERE id=?1",[source]).unwrap();
        }
        f.database.connection().execute("UPDATE agent_run SET runtime_adapter_kind='codex-cli',runtime_reported_version='0.162.1',runtime_protocol_version='codex-app-server-v2' WHERE id=?1",[&run]).unwrap();
        // Changes to member defaults and the installed executable must not change the live Host identity.
        f.database.connection().execute("UPDATE agent_profile SET selected_runtime_adapter_kind='pi',display_name='Edited during execution' WHERE id='agent_1'",[]).unwrap();
        f.database.connection().execute("UPDATE adapter_installation SET executable_path='/replacement/program',generation=generation+1 WHERE id=(SELECT runtime_installation_id FROM agent_run WHERE id=?1)",[&run]).unwrap();
        assert!(
            active_input_availability(f.database.connection(), &run, 1)
                .unwrap()
                .can_steer
        );
        assert_eq!(
            active_input_availability(f.database.connection(), &run, 2)
                .unwrap()
                .unavailable_reason,
            Some(R::ExecutionChanged)
        );
        f.database
            .connection()
            .execute(
                "UPDATE agent_run SET runtime_executable_fingerprint=NULL WHERE id=?1",
                [&run],
            )
            .unwrap();
        assert_eq!(
            active_input_availability(f.database.connection(), &run, 1)
                .unwrap()
                .unavailable_reason,
            Some(R::RuntimeIdentityUnknown)
        );
        assert_eq!(
            f.database
                .connection()
                .query_row("SELECT count(*) FROM runtime_input_delivery", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1,
            "no incompatible probe wrote a native input"
        );
        assert_eq!(
            f.database
                .connection()
                .query_row("SELECT status FROM agent_run WHERE id=?1", [run], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap(),
            "running"
        );

        // Direct API requests share the same gate, independently for each recipient.
        use crate::collaboration::{ExecutionRequest, SendUserThreadMessageCommand};
        let mut multi = Fixture::with_members(&["agent_1", "agent_2", "agent_3"]);
        multi.send_user_input("agent_1", "initial one", None);
        multi.send_user_input("agent_2", "initial two", None);
        let originals = claim_waiting_delivery_batches(&mut multi.database, 2).unwrap();
        assert_eq!(originals.len(), 2);
        for run in &originals {
            let context = multi.materialize_run(run);
            multi.database.connection().execute("UPDATE conversation SET native_session_id=id WHERE id=(SELECT conversation_id FROM agent_run WHERE id=?1)",[run]).unwrap();
            let initial = ContextService
                .prepare_input_delivery_for_context(&mut multi.database, run, 1, &context)
                .unwrap();
            ContextService
                .acknowledge_input_delivery(&mut multi.database, &initial.id, run)
                .unwrap();
        }
        multi.database.connection().execute_batch("UPDATE agent_run SET runtime_reported_version='0.162.1'; UPDATE agent_run SET runtime_adapter_kind='pi',runtime_reported_version='0.87.0',runtime_protocol_version='pi-jsonl-rpc-v1' WHERE conversation_id IN (SELECT id FROM conversation WHERE agent_id='agent_2');").unwrap();
        let command = multi.user_command(SendUserThreadMessageCommand {
            camp_id: multi.camp_id.clone(),
            delivery_mode: crate::steer::UserDeliveryMode::Steer,
            steer_targets: None,
            content: crate::camp_content::composer_document_from_content(&[
                StructuredThreadMessageSegment::MemberMention {
                    agent_id: "agent_1".into(),
                },
                StructuredThreadMessageSegment::MemberMention {
                    agent_id: "agent_2".into(),
                },
                StructuredThreadMessageSegment::MemberMention {
                    agent_id: "agent_3".into(),
                },
                StructuredThreadMessageSegment::Text {
                    text: "one public body".into(),
                },
            ])
            .unwrap(),
            source_attachments: vec![],
            quotes: vec![],
            reply_to_camp_message_id: None,
            execution: Some(ExecutionRequest {
                task_id: None,
                purpose: "mixed Steer capability regression".into(),
                completion_role: "required".into(),
                budget: None,
            }),
        });
        let sent = CollaborationService::default()
            .send_user_camp_message(&mut multi.database, &command)
            .unwrap();
        let message = sent.result.payload["threadMessageId"].as_str().unwrap();
        let rows=multi.database.connection().prepare("SELECT recipient_agent_id,requested_mode,status FROM camp_message_delivery WHERE message_id=?1 ORDER BY recipient_agent_id").unwrap().query_map([message],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
        assert_eq!(
            rows,
            vec![
                ("agent_1".into(), "steer".into(), "claimed".into()),
                ("agent_2".into(), "start".into(), "waiting".into()),
                ("agent_3".into(), "start".into(), "waiting".into())
            ]
        );
        assert_eq!(
            multi
                .database
                .connection()
                .query_row(
                    "SELECT recall_state FROM camp_message WHERE id=?1",
                    [message],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "closed",
            "Steer claim closes the same withdrawal window as ordinary claim"
        );
        // Preserve old records as-is while projecting the actual recognition
        // boundary. A mixed message is not withdrawable once any target claimed it.
        multi
            .database
            .connection()
            .execute(
                "UPDATE camp_message SET recall_state='recallable' WHERE id=?1",
                [message],
            )
            .unwrap();
        let snapshot = crate::read_model::ReadModelService
            .camp_snapshot(&mut multi.database, &multi.camp_id)
            .unwrap();
        let projected = snapshot.messages.iter().find(|m| m.id == message).unwrap();
        assert!(!projected.can_withdraw);
        let withdraw = multi.user_command(crate::collaboration::WithdrawThreadMessageCommand {
            camp_id: multi.camp_id.clone(),
            message_id: message.to_string(),
            expected_version: projected.version,
        });
        let denied = CollaborationService::default()
            .withdraw_camp_message(&mut multi.database, &withdraw)
            .unwrap();
        assert_eq!(denied.result.code, "message.withdraw_too_late");
        assert_eq!(
            multi
                .database
                .connection()
                .query_row(
                    "SELECT recall_state FROM camp_message WHERE id=?1",
                    [message],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
            "recallable",
            "projection does not rewrite historical message facts"
        );
        let starts = claim_waiting_delivery_batches(&mut multi.database, 3).unwrap();
        assert_eq!(
            starts.len(),
            1,
            "only the idle target starts; old Pi remains an ordinary busy lane"
        );
        assert_eq!(multi.database.connection().query_row("SELECT c.agent_id FROM agent_run r JOIN conversation c ON c.id=r.conversation_id WHERE r.id=?1",[&starts[0]],|r|r.get::<_,String>(0)).unwrap(),"agent_3");
    }

    // Owns crash windows at the durable send boundary, including late receipts after a successor starts.
    #[test]
    #[cfg(feature = "extended-tests")]
    fn steer_fault_recovery_never_replays_ambiguous_input_or_updates_a_successor() {
        use crate::context::{
            CharterDeliveryMode, ContextMaterialization, ContextService, MaterializeContextRequest,
        };
        for fault in [
            "exit-before-send",
            "lost-ack",
            "crash-before-saving-ack",
            "late-ack",
        ] {
            let mut f = Fixture::new();
            f.enqueue("initial", "initial");
            let run = claim_waiting_delivery_batches(&mut f.database, 1)
                .unwrap()
                .remove(0);
            f.database
                .connection()
                .execute(
                    "UPDATE agent_run SET runtime_reported_version='0.162.1' WHERE id=?1",
                    [&run],
                )
                .unwrap();
            let initial = f.materialize_run(&run);
            f.database.connection().execute("UPDATE conversation SET native_session_id='fault-session' WHERE id='delivery-queue-agent-1'",[]).unwrap();
            let first = ContextService
                .prepare_input_delivery_for_context(&mut f.database, &run, 1, &initial)
                .unwrap();
            ContextService
                .acknowledge_input_delivery(&mut f.database, &first.id, "original-turn")
                .unwrap();
            let source = f.enqueue("fault-input", "must not run twice");
            let tx = f.database.connection_mut().transaction().unwrap();
            crate::steer::route_user_message(&tx, "fault-input", None).unwrap();
            tx.commit().unwrap();
            let ContextMaterialization::Ready(context) = ContextService
                .materialize_message_delivery(
                    &mut f.database,
                    &crate::managed_blob::ManagedBlobStore::new(&f._directory),
                    &source,
                    &[],
                    &MaterializeContextRequest {
                        agent_run_id: &run,
                        execution_epoch: 1,
                        charter_delivery_mode: CharterDeliveryMode::NativeAppend,
                        max_payload_bytes: 96 * 1024,
                    },
                )
                .unwrap()
            else {
                panic!("ready")
            };
            let input = ContextService
                .prepare_input_delivery_for_context(&mut f.database, &run, 1, &context)
                .unwrap();
            let submitted = fault != "exit-before-send";
            if submitted {
                assert!(
                    ContextService
                        .begin_runtime_input_dispatch(&mut f.database, &input.id, &run, 1)
                        .unwrap()
                );
            }
            if fault == "crash-before-saving-ack" {
                f.database.connection().execute_batch("CREATE TEMP TRIGGER fail_ack BEFORE UPDATE OF status ON runtime_input_delivery WHEN NEW.input_kind='steer' AND NEW.status='accepted' BEGIN SELECT RAISE(ABORT,'injected crash before ACK commit'); END;").unwrap();
                assert!(
                    ContextService
                        .acknowledge_input_delivery(&mut f.database, &input.id, "original-turn")
                        .is_err()
                );
                f.database
                    .connection()
                    .execute_batch("DROP TRIGGER fail_ack")
                    .unwrap();
            }
            if fault == "lost-ack" {
                ContextService
                    .mark_input_delivery_unknown(
                        &mut f.database,
                        &input.id,
                        "native accepted, ACK dropped",
                    )
                    .unwrap();
                let later = f.enqueue("while-unknown", "new message while receipt is unknown");
                let tx = f.database.connection_mut().transaction().unwrap();
                crate::steer::route_user_message(&tx, "while-unknown", None).unwrap();
                tx.commit().unwrap();
                assert_eq!(
                    f.database
                        .connection()
                        .query_row(
                            "SELECT requested_mode FROM camp_message_delivery WHERE id=?1",
                            [later],
                            |r| r.get::<_, String>(0)
                        )
                        .unwrap(),
                    "start"
                );
            }
            if !submitted {
                ContextService
                    .mark_input_delivery_not_accepted(
                        &mut f.database,
                        &input.id,
                        "host exited before native send",
                    )
                    .unwrap();
                let tx = f.database.connection_mut().transaction().unwrap();
                crate::steer::return_to_queue(&tx, &source, &chrono::Utc::now().to_rfc3339())
                    .unwrap();
                tx.commit().unwrap();
            }
            // Core restart recovery is idempotent; dispatch-started is never rewritten to unsent.
            let before_recovery =
                crate::execution_window::read_page(&mut f.database, &f.camp_id, &run, None, 24)
                    .unwrap();
            f.database.prepare_v2_recovery().unwrap();
            let recovered_changes = crate::execution_window::read_changes(
                &mut f.database,
                &f.camp_id,
                &run,
                before_recovery.through_change_sequence,
                &[],
                24,
            )
            .unwrap();
            if submitted && fault != "lost-ack" {
                let marker = recovered_changes
                    .evidence
                    .iter()
                    .find(|e| e.event_type == crate::execution_input::EVENT)
                    .unwrap();
                assert_eq!(marker.payload["status"], "delivery_unknown");
                assert_eq!(marker.sequence, before_recovery.evidence[0].sequence);
            }
            f.database.prepare_v2_recovery().unwrap();
            if submitted {
                ContextService
                    .mark_input_delivery_unknown(&mut f.database, &input.id, "still unknown")
                    .unwrap();
            } else {
                let tx = f.database.connection_mut().transaction().unwrap();
                crate::steer::return_to_queue(&tx, &source, &chrono::Utc::now().to_rfc3339())
                    .unwrap();
                tx.commit().unwrap();
            }
            let repeated_recovery =
                crate::execution_window::read_page(&mut f.database, &f.camp_id, &run, None, 24)
                    .unwrap();
            assert_eq!(
                repeated_recovery.through_change_sequence,
                recovered_changes.through_change_sequence
            );
            assert_eq!(
                repeated_recovery.evidence[0].payload["status"],
                if submitted {
                    "delivery_unknown"
                } else {
                    "queued"
                }
            );
            let status = ContextService
                .runtime_input_delivery_status(&f.database, &input.id)
                .unwrap()
                .unwrap();
            if submitted {
                assert_eq!(status, "delivery_unknown", "{fault}");
            } else {
                assert_ne!(status, "accepted");
            }
            assert!(
                !ContextService
                    .begin_runtime_input_dispatch(&mut f.database, &input.id, &run, 1)
                    .unwrap()
            );
            assert!(
                crate::steer::pending_inputs(f.database.connection())
                    .unwrap()
                    .is_empty()
            );
            // Make the recovery decision terminal and create an unrelated ordinary successor.
            let tx = f.database.connection_mut().transaction().unwrap();
            tx.execute("UPDATE agent_run SET status='succeeded',wait_reason=NULL,runtime_recovery_required=0,cancel_acknowledged_at=cancel_requested_at,ended_at=datetime('now') WHERE id=?1",[&run]).unwrap();
            settle_run_deliveries(
                &tx,
                &run,
                "succeeded",
                None,
                &chrono::Utc::now().to_rfc3339(),
            )
            .unwrap();
            tx.commit().unwrap();
            f.enqueue("new-input", "new ordinary work");
            let next = claim_waiting_delivery_batches(&mut f.database, 1)
                .unwrap()
                .remove(0);
            assert_ne!(run, next);
            let next_context = f.materialize_run(&next);
            let next_input = ContextService
                .prepare_input_delivery_for_context(&mut f.database, &next, 1, &next_context)
                .unwrap();
            ContextService
                .acknowledge_input_delivery(&mut f.database, &next_input.id, "successor-turn")
                .unwrap();
            let before:String=f.database.connection().query_row("SELECT native_collaboration_state_digest||':'||last_accepted_public_boundary_sequence||':'||version FROM conversation WHERE id='delivery-queue-agent-1'",[],|r|r.get(0)).unwrap();
            if submitted {
                ContextService
                    .acknowledge_input_delivery(&mut f.database, &input.id, "original-turn")
                    .unwrap();
                ContextService
                    .acknowledge_input_delivery(&mut f.database, &input.id, "original-turn")
                    .unwrap();
                assert_eq!(f.database.connection().query_row("SELECT native_collaboration_state_digest||':'||last_accepted_public_boundary_sequence||':'||version FROM conversation WHERE id='delivery-queue-agent-1'",[],|r|r.get::<_,String>(0)).unwrap(),before);
                assert!(!next_context.rendered_payload.contains("must not run twice"));
            } else {
                assert!(
                    next_context.rendered_payload.contains("must not run twice"),
                    "proven unsent input survives exactly once"
                );
            }
            assert_eq!(
                f.database
                    .connection()
                    .query_row("SELECT count(*) FROM agent_run", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                2
            );
            assert_eq!(
                f.database
                    .connection()
                    .query_row(
                        "SELECT native_input_id FROM runtime_input_delivery WHERE id=?1",
                        [next_input.id],
                        |r| r.get::<_, String>(0)
                    )
                    .unwrap(),
                "successor-turn"
            );
        }
    }

    // Owns preservation of populated Mission 064 storage across the collided 199 migration.
    #[test]
    #[cfg(feature = "extended-tests")]
    fn legacy_steer_upgrade_keeps_accepted_unknown_and_unfinished_sources() {
        use crate::context::{
            CharterDeliveryMode, ContextMaterialization, ContextService, MaterializeContextRequest,
        };
        let mut f = Fixture::new();
        f.enqueue("initial", "original bytes");
        let run = claim_waiting_delivery_batches(&mut f.database, 1)
            .unwrap()
            .remove(0);
        f.database
            .connection()
            .execute(
                "UPDATE agent_run SET runtime_reported_version='0.162.1' WHERE id=?1",
                [&run],
            )
            .unwrap();
        let initial = f.materialize_run(&run);
        f.database.connection().execute("UPDATE conversation SET native_session_id='migration-session' WHERE id='delivery-queue-agent-1'",[]).unwrap();
        let input = ContextService
            .prepare_input_delivery_for_context(&mut f.database, &run, 1, &initial)
            .unwrap();
        ContextService
            .acknowledge_input_delivery(&mut f.database, &input.id, "original-turn")
            .unwrap();
        let mut sources = Vec::new();
        for message in [
            "accepted-steer",
            "unknown-steer",
            "prepared-steer",
            "unfinished-steer",
        ] {
            let delivery = f.enqueue(message, message);
            let tx = f.database.connection_mut().transaction().unwrap();
            crate::steer::route_user_message(&tx, message, None).unwrap();
            tx.commit().unwrap();
            sources.push(delivery);
        }
        for (index, source) in sources.iter().take(3).enumerate() {
            let ContextMaterialization::Ready(context) = ContextService
                .materialize_message_delivery(
                    &mut f.database,
                    &crate::managed_blob::ManagedBlobStore::new(&f._directory),
                    source,
                    &[],
                    &MaterializeContextRequest {
                        agent_run_id: &run,
                        execution_epoch: 1,
                        charter_delivery_mode: CharterDeliveryMode::NativeAppend,
                        max_payload_bytes: 96 * 1024,
                    },
                )
                .unwrap()
            else {
                panic!("prepared")
            };
            let input = ContextService
                .prepare_input_delivery_for_context(&mut f.database, &run, 1, &context)
                .unwrap();
            if index < 2 {
                ContextService
                    .begin_runtime_input_dispatch(&mut f.database, &input.id, &run, 1)
                    .unwrap();
            }
            match index {
                0 => {
                    ContextService
                        .acknowledge_input_delivery(&mut f.database, &input.id, "original-turn")
                        .unwrap();
                }
                1 => ContextService
                    .mark_input_delivery_unknown(&mut f.database, &input.id, "ACK lost")
                    .unwrap(),
                _ => {}
            }
        }
        crate::db::assert_legacy_steer_upgrade(&mut f.database);
        assert_eq!(
            f.database
                .connection()
                .query_row("SELECT count(*) FROM agent_run", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        let initial_again = f.materialize_run(&run);
        assert_eq!(initial.rendered_payload, initial_again.rendered_payload);
        f.database.prepare_v2_recovery().unwrap();
        assert_eq!(
            f.database
                .connection()
                .query_row(
                    "SELECT count(*) FROM runtime_input_delivery WHERE status='accepted'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            2
        );
        assert!(
            f.database
                .connection()
                .query_row(
                    "SELECT count(*) FROM runtime_input_delivery WHERE status='delivery_unknown'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap()
                >= 1
        );
        assert_eq!(
            f.database
                .connection()
                .query_row("SELECT count(*) FROM agent_run", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn history_claim_excludes_every_selected_input_and_own_messages() {
        let mut fixture = Fixture::new();
        fixture.enqueue("selected-one", "first input");
        fixture.publish_visible_without_delivery("own-one", "agent", "agent_1");
        fixture.enqueue("selected-two", "second input");
        let run_id = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(fixture.frozen_history_result(&run_id), (0, false));
        let input_count: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM agent_run_input WHERE agent_run_id = ?1",
                [&run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(input_count, 2);
    }

    #[test]
    fn history_claim_sees_unaddressed_visible_messages_and_withdrawn_placeholders() {
        for state in ["closed", "withdrawn"] {
            let mut fixture = Fixture::new();
            fixture.publish_visible_without_delivery("other-recipient", "agent", "agent_2");
            fixture
                .database
                .connection()
                .execute(
                    "UPDATE camp_message SET recall_state = ?1 WHERE id = 'other-recipient'",
                    [state],
                )
                .unwrap();
            fixture.enqueue("selected", "claim this");
            let run_id = claim_waiting_delivery_batches(&mut fixture.database, 1)
                .unwrap()
                .pop()
                .unwrap();
            assert_eq!(fixture.frozen_history_result(&run_id), (0, true));
        }
    }

    #[test]
    fn history_claim_skips_tombstones_and_uses_previous_accepted_boundary() {
        let mut fixture = Fixture::new();
        fixture.publish_visible_without_delivery("older", "agent", "agent_2");
        fixture
            .database
            .connection()
            .execute(
                "UPDATE conversation SET last_accepted_public_boundary_sequence = 1 WHERE id = 'delivery-queue-agent-1'",
                [],
            )
            .unwrap();
        fixture.publish_visible_without_delivery("tombstone", "agent", "agent_2");
        fixture
            .database
            .connection()
            .execute(
                "UPDATE camp_message SET tombstoned_at = datetime('now') WHERE id = 'tombstone'",
                [],
            )
            .unwrap();
        fixture.enqueue("selected", "claim this");
        let run_id = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(fixture.frozen_history_result(&run_id), (1, false));
        fixture.publish_visible_without_delivery("later", "agent", "agent_2");
        fixture
            .database
            .connection()
            .execute(
                "UPDATE conversation SET last_accepted_public_boundary_sequence = 4 WHERE id = 'delivery-queue-agent-1'",
                [],
            )
            .unwrap();
        assert_eq!(fixture.frozen_history_result(&run_id), (1, false));
    }

    #[test]
    fn history_claim_does_not_depend_on_waiting_deliveries_or_reuse_stale_boundary() {
        let mut fixture = Fixture::new();
        fixture.enqueue("selected", "claim this");
        let run_id = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(fixture.frozen_history_result(&run_id), (0, false));
        let now = chrono::Utc::now().to_rfc3339();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'succeeded', ended_at = ?1, updated_at = ?1 WHERE id = ?2",
                params![now, run_id],
            )
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE conversation SET last_accepted_public_boundary_sequence = 1 WHERE id = 'delivery-queue-agent-1'",
                [],
            )
            .unwrap();
        fixture.publish_visible_without_delivery("unclaimed", "agent", "agent_2");
        fixture.enqueue("next", "claim this");
        let successor = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(fixture.frozen_history_result(&successor), (1, true));
        assert_eq!(fixture.frozen_history_result(&run_id), (0, false));
    }

    #[test]
    fn history_query_failure_rolls_back_every_claim_in_the_transaction() {
        let mut fixture = Fixture::new();
        fixture.enqueue("selected", "claim this");
        fixture
            .database
            .connection()
            .authorizer(Some(|context: AuthContext<'_>| match context.action {
                AuthAction::Read {
                    table_name: "json_each",
                    ..
                } => Authorization::Deny,
                _ => Authorization::Allow,
            }))
            .unwrap();
        let result = claim_waiting_delivery_batches(&mut fixture.database, 1);
        fixture
            .database
            .connection()
            .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
            .unwrap();
        assert!(
            result.is_err(),
            "a failed history query must abort the claim: {result:?}"
        );
        assert_eq!(fixture.batch_run_count(), 0);
        let delivery: (String, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                "SELECT status, claimed_agent_run_id FROM camp_message_delivery WHERE message_id = 'selected'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(delivery, ("waiting".to_string(), None));
        let recall_state: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT recall_state FROM camp_message WHERE id = 'selected'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(recall_state, "recallable");
    }

    // Regression owner for lane isolation. The existing query-failure owner
    // above continues to require whole-transaction rollback for storage faults.
    #[cfg(feature = "extended-tests")]
    #[test]
    fn malformed_member_configuration_fails_its_lane_without_blocking_other_camps() {
        for corrupt_bootstrap in [false, true] {
            let mut fixture = Fixture::with_members(&["agent_1", "agent_2"]);
            let other = fixture.add_camp_lane("healthy");
            fixture.enqueue("bad-member", "must fail visibly");
            fixture.database.connection().execute("UPDATE camp_message_delivery SET recipient_agent_id='agent_2' WHERE message_id='bad-member'", []).unwrap();
            fixture
                .database
                .connection()
                .execute(
                    "UPDATE agent_profile SET selected_runtime_adapter_kind='codex-cli',
            default_runtime_installation_id='adapter-test-codex', default_model_selection_json='{}',
            default_permission_config_json='{}' WHERE id='agent_2'",
                    [],
                )
                .unwrap();
            if corrupt_bootstrap {
                crate::agent_profile::configure_test_runtime(&fixture.database, &["agent_2"]);
                fixture.database.connection().execute("UPDATE agent_profile SET personality_traits_json='not-json' WHERE id='agent_2'", []).unwrap();
            }
            fixture.enqueue_for(&other, "healthy-member", "must still run");
            // Upgrade-era native Sessions have no environment record. They should
            // continue through normal native recovery, without changing context here.
            fixture
                .database
                .connection()
                .execute(
                    "UPDATE conversation SET native_session_id='native-existing' WHERE camp_id=?1",
                    [&other],
                )
                .unwrap();
            let claimed = claim_waiting_delivery_batches(&mut fixture.database, 100).unwrap();
            assert_eq!(claimed.len(), 2);
            let row = |message: &str| {
                fixture.database.connection().query_row(
            "SELECT r.status,r.last_error_code FROM agent_run r JOIN camp_message_delivery d ON d.claimed_agent_run_id=r.id WHERE d.message_id=?1",
            [message], |r| Ok((r.get::<_, String>(0)?,r.get::<_, Option<String>>(1)?))).unwrap()
            };
            assert_eq!(
                row("bad-member"),
                (
                    "failed".into(),
                    Some("runtime_configuration_invalid".into())
                )
            );
            assert_eq!(row("healthy-member"), ("queued".into(), None));
            assert_eq!(
                fixture
                    .database
                    .connection()
                    .query_row(
                        "SELECT native_session_id FROM conversation WHERE camp_id=?1",
                        [&other],
                        |r| r.get::<_, String>(0)
                    )
                    .unwrap(),
                "native-existing"
            );
            let snapshots: i64 = fixture.database.connection().query_row("SELECT COUNT(*) FROM agent_run WHERE json_type(effective_config_json,'$.runtime.environment') IS NOT NULL", [], |r|r.get(0)).unwrap();
            assert_eq!(snapshots, 0);
        }
    }

    #[test]
    fn history_query_accepts_selected_ids_beyond_sqlite_parameter_limit() {
        let mut fixture = Fixture::new();
        fixture.publish_visible_without_delivery("visible", "agent", "agent_2");
        let mut selected_ids = (0..1_100)
            .map(|index| format!("selected-{index}"))
            .collect::<Vec<_>>();
        let transaction = fixture.database.connection_mut().transaction().unwrap();
        assert!(
            has_additional_public_messages(
                &transaction,
                &fixture.camp_id,
                "agent_1",
                0,
                1,
                &selected_ids,
            )
            .unwrap()
        );
        selected_ids.push("visible".to_string());
        assert!(
            !has_additional_public_messages(
                &transaction,
                &fixture.camp_id,
                "agent_1",
                0,
                1,
                &selected_ids,
            )
            .unwrap()
        );
    }

    #[test]
    fn history_claim_checks_beyond_camp_read_page() {
        let mut fixture = Fixture::new();
        fixture.publish_visible_without_delivery("earlier", "agent", "agent_2");
        for index in 0..105 {
            fixture.enqueue(&format!("input-{index}"), "small");
        }
        let run_id = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .pop()
            .unwrap();
        let input_count: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM agent_run_input WHERE agent_run_id = ?1",
                [&run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(input_count > 100);
        assert_eq!(fixture.frozen_history_result(&run_id), (0, true));
    }

    #[test]
    fn historical_probe_results_do_not_block_claiming_saved_explicit_intent() {
        for status in [
            "light_ready",
            "light_failed",
            "probe_failed",
            "missing_snapshot",
        ] {
            let mut fixture = Fixture::new();
            fixture
                .database
                .connection()
                .execute(
                    r#"
                UPDATE agent_profile
                SET default_model_selection_json = ?1
                WHERE id = 'agent_1'
                "#,
                    [json!({
                        "mode": "explicit",
                        "modelId": "gpt-test",
                        "options": {"reasoning_effort": "high"}
                    })
                    .to_string()],
                )
                .unwrap();
            fixture
                .database
                .connection()
                .execute(
                    r#"
                UPDATE adapter_capability_snapshot
                SET authentication_status = 'unknown',
                    probe_status = ?1,
                    capabilities_json = '[]',
                    protocols_json = '[]',
                    model_catalog_json = '[]',
                    last_successful_probe_at = NULL,
                    model_catalog_succeeded_at = NULL
                WHERE installation_id = 'adapter-test-codex'
                "#,
                    [if status == "missing_snapshot" {
                        "light_failed"
                    } else {
                        status
                    }],
                )
                .unwrap();
            if status == "missing_snapshot" {
                fixture
                    .database
                    .connection()
                    .execute("DELETE FROM adapter_capability_snapshot", [])
                    .unwrap();
            }
            fixture.enqueue("explicit-light-ready", "请处理");

            let run_id = claim_waiting_delivery_batches(&mut fixture.database, 100)
                .unwrap()
                .pop()
                .expect("saved explicit model should reach queued Dispatch Preflight");
            let (status, model_json): (String, String) = fixture
                .database
                .connection()
                .query_row(
                    "SELECT status, runtime_model_selection_json FROM agent_run WHERE id = ?1",
                    [&run_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();

            assert_eq!(status, "queued");
            assert_eq!(
                serde_json::from_str::<Value>(&model_json).unwrap(),
                json!({
                    "source": "explicit",
                    "modelId": "gpt-test",
                    "options": {"reasoning_effort": "high"}
                })
            );
            let delivery: (String, Option<String>) = fixture
                .database
                .connection()
                .query_row(
                    r#"
                SELECT status, claimed_agent_run_id
                FROM camp_message_delivery
                WHERE message_id = 'explicit-light-ready'
                "#,
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert_eq!(delivery, ("claimed".to_string(), Some(run_id)));
        }
        let mut fixture = Fixture::new();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE adapter_installation SET enabled = 0 WHERE id = 'adapter-test-codex'",
                [],
            )
            .unwrap();
        fixture.enqueue("broken-entry", "must fail visibly");
        let failed = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .pop()
            .unwrap();
        let snapshot = crate::read_model::ReadModelService
            .camp_snapshot(&mut fixture.database, &fixture.camp_id)
            .unwrap();
        let run = snapshot
            .agent_runs
            .iter()
            .find(|run| run.id == failed)
            .unwrap();
        assert_eq!(run.status, "failed");
        assert_eq!(
            run.terminal_reason_code.as_deref(),
            Some("adapter_installation_disabled")
        );
        // Configuration failures are a public fallback, never a replacement for
        // an existing terminal reason or a route to expose arbitrary errors.
        for (status, error, stored_reason, expected_reason) in [
            (
                "failed",
                "runtime_model_unavailable",
                Some("planned_shutdown_failed"),
                Some("planned_shutdown_failed"),
            ),
            ("failed", "private_diagnostic", None, None),
            ("queued", "adapter_installation_disabled", None, None),
            (
                "failed",
                "adapter_installation_disabled",
                None,
                Some("adapter_installation_disabled"),
            ),
        ] {
            fixture
                .database
                .connection()
                .execute(
                    "UPDATE agent_run SET status = ?2, last_error_code = ?3, terminal_reason_code = ?4,
                        ended_at = CASE WHEN ?2 = 'failed' THEN updated_at ELSE NULL END
                     WHERE id = ?1",
                    params![failed, status, error, stored_reason],
                )
                .unwrap();
            let snapshot = crate::read_model::ReadModelService
                .camp_snapshot(&mut fixture.database, &fixture.camp_id)
                .unwrap();
            let run = snapshot
                .agent_runs
                .iter()
                .find(|run| run.id == failed)
                .unwrap();
            assert_eq!(run.terminal_reason_code.as_deref(), expected_reason);
        }
        assert!(
            claim_waiting_delivery_batches(&mut fixture.database, 1)
                .unwrap()
                .is_empty()
        );
        fixture
            .database
            .connection()
            .execute(
                "UPDATE adapter_installation SET enabled = 1 WHERE id = 'adapter-test-codex'",
                [],
            )
            .unwrap();
        fixture.enqueue("repaired-entry", "new normal Run");
        let next = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .pop()
            .unwrap();
        assert_ne!(failed, next);
    }

    #[test]
    fn claim_freezes_the_default_recipient_display_name_on_each_run_input() {
        let mut fixture = Fixture::new();
        fixture.enqueue("default-message", "正文");
        fixture
            .database
            .connection()
            .execute(
                "UPDATE camp_message SET address_mode = 'default', author_type = 'agent', author_id = 'agent_2' WHERE id = 'default-message'",
                [],
            )
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_profile SET display_name = '领取时队长' WHERE id = 'agent_1'",
                [],
            )
            .unwrap();

        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_profile SET display_name='领取时作者' WHERE id='agent_2'",
                [],
            )
            .unwrap();
        let run_id = claim_waiting_delivery_batches(&mut fixture.database, 100)
            .unwrap()
            .pop()
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_profile SET display_name = '后来改名' WHERE id = 'agent_1'",
                [],
            )
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_profile SET display_name='改名作者' WHERE id='agent_2'",
                [],
            )
            .unwrap();
        let frozen_json: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT context_json FROM agent_run_claim_context WHERE agent_run_id=?1",
                [&run_id],
                |r| r.get(0),
            )
            .unwrap();
        let claimed: Value = serde_json::from_str(&frozen_json).unwrap();
        let input = &claimed["runInput"]["messages"][0];
        assert_eq!(input["senderType"], "agent");
        assert_eq!(input["senderId"], "agent_2");
        assert_eq!(input["senderName"], "领取时作者");
        assert_eq!(input["body"], "@领取时队长 正文");
        assert_eq!(
            input["mentions"],
            json!([{"id":"agent_1","name":"领取时队长"}])
        );
        let frozen: (i64, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                "SELECT context_manifest_version, default_recipient_display_name FROM agent_run_input WHERE agent_run_id = ?1",
                [&run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(frozen.0, PUBLIC_CAMP_BATCH_CONTEXT_MANIFEST_VERSION);
        assert_eq!(frozen.1.as_deref(), Some("领取时队长"));
    }

    #[test]
    fn claim_repairs_a_waiting_lane_without_a_camp_member_conversation() {
        let mut fixture = Fixture::new();
        fixture.enqueue("stranded-message", "修复旧 waiting Delivery");
        fixture
            .database
            .connection()
            .execute(
                "DELETE FROM conversation WHERE camp_id = ?1 AND agent_id = 'agent_1'",
                [&fixture.camp_id],
            )
            .unwrap();

        let claimed = claim_waiting_delivery_batches(&mut fixture.database, 100).unwrap();
        assert_eq!(claimed.len(), 1);
        let repaired: i64 = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT COUNT(*) FROM conversation
                WHERE camp_id = ?1 AND agent_id = 'agent_1'
                  AND kind = 'camp_member'
                "#,
                [&fixture.camp_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(repaired, 1);
    }

    #[test]
    fn pending_work_gate_tracks_waiting_delivery_and_queued_batch_run() {
        let mut fixture = Fixture::new();
        assert!(!has_pending_delivery_batch_work(&fixture.database).unwrap());
        assert!(!has_waiting_delivery_batch_work(&fixture.database).unwrap());

        fixture.enqueue("message-1", "待领取");
        assert!(has_pending_delivery_batch_work(&fixture.database).unwrap());
        assert!(has_waiting_delivery_batch_work(&fixture.database).unwrap());

        let run_id = claim_waiting_delivery_batches(&mut fixture.database, 100)
            .unwrap()
            .pop()
            .unwrap();
        assert!(has_pending_delivery_batch_work(&fixture.database).unwrap());
        assert!(!has_waiting_delivery_batch_work(&fixture.database).unwrap());
        let runtime = crate::runtime::ExecutionRuntimeService::default();
        assert_eq!(
            runtime
                .list_dispatchable_batch_agent_runs(&fixture.database, 1, 0)
                .unwrap()
                .first()
                .map(|candidate| candidate.agent_run_id.as_str()),
            Some(run_id.as_str())
        );
        assert_eq!(
            runtime
                .load_dispatchable_agent_run(&fixture.database, &run_id)
                .unwrap()
                .map(|candidate| candidate.agent_run_id),
            Some(run_id.clone())
        );
        assert!(
            runtime
                .list_dispatchable_non_batch_agent_runs(&fixture.database, 1)
                .unwrap()
                .is_empty(),
            "the non-batch dispatch path must not pick up ordinary batch Runs"
        );

        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET status = 'running' WHERE id = ?1",
                [&run_id],
            )
            .unwrap();
        assert!(!has_pending_delivery_batch_work(&fixture.database).unwrap());
    }

    #[test]
    fn batch_terminal_pump_leaves_successor_for_scheduler_claim() {
        let mut fixture = Fixture::new();
        fixture.enqueue("message-1", "先处理");
        let first_run = claim_waiting_delivery_batches(&mut fixture.database, 100)
            .unwrap()
            .pop()
            .unwrap();
        fixture.enqueue("message-2", "后处理");

        let now = chrono::Utc::now().to_rfc3339();
        let transaction = fixture.database.connection_mut().transaction().unwrap();
        transaction
            .execute(
                "UPDATE agent_run SET status = 'succeeded', ended_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![first_run, now],
            )
            .unwrap();
        settle_run_deliveries(&transaction, &first_run, "succeeded", None, &now).unwrap();
        transaction.commit().unwrap();

        crate::runtime::pump_targets_after_runs_terminal(
            &mut fixture.database,
            std::slice::from_ref(&first_run),
        )
        .unwrap();

        let successor: (String, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                "SELECT status, claimed_agent_run_id FROM camp_message_delivery WHERE message_id = 'message-2'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(successor, ("waiting".to_string(), None));
        assert_eq!(fixture.batch_run_count(), 1);
    }

    #[test]
    fn mission_batch_claim_uses_ready_worktree_and_defers_unprepared_workspace() {
        let mut ready = Fixture::new();
        let ready_worktree = ready._directory.join("mission-worktree");
        ready.attach_completed_mission(Some(&ready_worktree));
        ready.enqueue("ready-message", "继续使命");
        assert!(
            claim_waiting_delivery_batches(&mut ready.database, 100)
                .unwrap()
                .is_empty()
        );
        let workspace = AgentRunWorkspace {
            execution_root: ready_worktree.to_string_lossy().into_owned(),
            access: "write".into(),
            isolation: "git_worktree".into(),
        };
        let fact =
            json!({"workingDirectory": workspace.execution_root, "branch": "actual-user-branch"});
        let prepared = capture_prepared_batch_workspace(
            &ready.database,
            &ready.camp_id,
            workspace.clone(),
            fact.clone(),
        )
        .unwrap();
        let stale = BatchWorkspaces::from([(ready.camp_id.clone(), Ok(prepared))]);
        ready
            .database
            .connection()
            .execute(
                "UPDATE mission_workspace SET generation=generation+1 WHERE camp_id=?1",
                [&ready.camp_id],
            )
            .unwrap();
        assert!(
            claim_waiting_delivery_batches_with_workspaces(&mut ready.database, 100, &stale)
                .unwrap()
                .is_empty()
        );
        let prepared = capture_prepared_batch_workspace(
            &ready.database,
            &ready.camp_id,
            workspace,
            fact.clone(),
        )
        .unwrap();
        let prepared = BatchWorkspaces::from([(ready.camp_id.clone(), Ok(prepared))]);
        let ready_run =
            claim_waiting_delivery_batches_with_workspaces(&mut ready.database, 100, &prepared)
                .unwrap()
                .pop()
                .unwrap();
        let ready_workspace_json: Option<String> = ready
            .database
            .connection()
            .query_row(
                "SELECT workspace_json FROM agent_run WHERE id = ?1",
                [&ready_run],
                |row| row.get(0),
            )
            .unwrap();
        let ready_workspace: AgentRunWorkspace =
            serde_json::from_str(&ready_workspace_json.unwrap()).unwrap();
        assert_eq!(
            ready_workspace,
            AgentRunWorkspace {
                execution_root: ready_worktree.to_string_lossy().into_owned(),
                access: "write".to_string(),
                isolation: "git_worktree".to_string(),
            }
        );

        let mut unprepared = Fixture::new();
        unprepared.attach_completed_mission(None);
        unprepared.enqueue("unprepared-message", "首次执行使命");
        assert!(
            claim_waiting_delivery_batches(&mut unprepared.database, 100)
                .unwrap()
                .is_empty()
        );
        assert_eq!(unprepared.batch_run_count(), 0);
        let ordinary = unprepared.add_camp_lane("ordinary-during-mission-prepare");
        unprepared.enqueue_for(
            &ordinary,
            "ordinary-message",
            "continue without waiting for Mission Git",
        );
        assert_eq!(
            claim_waiting_delivery_batches(&mut unprepared.database, 100)
                .unwrap()
                .len(),
            1
        );
        #[cfg(feature = "extended-tests")]
        {
            let context = ready.materialize_run(&ready_run);
            assert!(context.rendered_payload.contains("actual-user-branch"));
            assert!(
                context
                    .rendered_payload
                    .contains(ready_worktree.to_str().unwrap())
            );
            assert!(!context.rendered_payload.contains("rovai/mission/001"));
        }
    }

    #[test]
    fn active_run_keeps_later_delivery_waiting_until_the_lane_is_free() {
        let mut fixture = Fixture::new();
        fixture.enqueue("message-1", "先处理");
        let first_run = claim_waiting_delivery_batches(&mut fixture.database, 100)
            .unwrap()
            .pop()
            .unwrap();
        fixture.enqueue("message-2", "后处理");

        assert!(
            claim_waiting_delivery_batches(&mut fixture.database, 100)
                .unwrap()
                .is_empty()
        );
        let waiting_run: Option<String> = fixture
            .database
            .connection()
            .query_row(
                "SELECT claimed_agent_run_id FROM camp_message_delivery WHERE message_id = 'message-2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(waiting_run.is_none());

        let now = chrono::Utc::now().to_rfc3339();
        let transaction = fixture.database.connection_mut().transaction().unwrap();
        transaction
            .execute(
                "UPDATE agent_run SET status = 'succeeded', ended_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![first_run, now],
            )
            .unwrap();
        assert_eq!(
            settle_run_deliveries(&transaction, &first_run, "succeeded", None, &now).unwrap(),
            1
        );
        transaction.commit().unwrap();

        let next = claim_waiting_delivery_batches(&mut fixture.database, 100).unwrap();
        assert_eq!(next.len(), 1);
        let next_anchor: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT anchor_message_id FROM agent_run WHERE id = ?1",
                [&next[0]],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(next_anchor, "message-2");
    }

    #[test]
    fn failed_run_without_cleanup_ack_keeps_successor_delivery_waiting() {
        let mut fixture = Fixture::new();
        fixture.enqueue("message-1", "先处理");
        let first_run = claim_waiting_delivery_batches(&mut fixture.database, 100)
            .unwrap()
            .pop()
            .unwrap();
        fixture.enqueue("message-2", "后处理");

        let now = chrono::Utc::now().to_rfc3339();
        let retired_root = fixture
            ._directory
            .join("retired-conversation-root")
            .to_string_lossy()
            .into_owned();
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'failed', ended_at = ?2, updated_at = ?2,
                    cancel_requested_at = ?2,
                    cancel_reason_code = 'runtime_terminal_unconfirmed',
                    workspace_json = json_object(
                        'executionRoot', ?3,
                        'access', 'write',
                        'isolation', 'runtime_managed'
                    )
                WHERE id = ?1
                "#,
                params![first_run, now, retired_root],
            )
            .unwrap();

        assert!(
            claim_waiting_delivery_batches(&mut fixture.database, 100)
                .unwrap()
                .is_empty()
        );
        let waiting_run: Option<String> = fixture
            .database
            .connection()
            .query_row(
                "SELECT claimed_agent_run_id FROM camp_message_delivery WHERE message_id = 'message-2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(waiting_run.is_none());

        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_run SET cancel_acknowledged_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![first_run, chrono::Utc::now().to_rfc3339()],
            )
            .unwrap();
        let next = claim_waiting_delivery_batches(&mut fixture.database, 100).unwrap();
        assert_eq!(next.len(), 1);
        let next_anchor: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT anchor_message_id FROM agent_run WHERE id = ?1",
                [&next[0]],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(next_anchor, "message-2");
    }

    #[test]
    fn pending_cleanup_on_a_shared_execution_root_blocks_another_lane() {
        let mut fixture = Fixture::new();
        fixture.enqueue("message-1", "先占用共享目录");
        let first_run = claim_waiting_delivery_batches(&mut fixture.database, 100)
            .unwrap()
            .pop()
            .unwrap();
        let shared_root: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT project_path FROM camp WHERE id = ?1",
                [&fixture.camp_id],
                |row| row.get(0),
            )
            .unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status='failed', ended_at=?2, updated_at=?2,
                    cancel_requested_at=?2,
                    cancel_reason_code='runtime_terminal_unconfirmed'
                WHERE id=?1
                "#,
                params![first_run, now],
            )
            .unwrap();

        let second_camp = fixture.add_camp_lane("shared-execution-root");
        fixture
            .database
            .connection()
            .execute(
                "UPDATE camp SET project_path=?2 WHERE id=?1",
                params![second_camp, shared_root],
            )
            .unwrap();
        fixture.enqueue_for(&second_camp, "message-2", "不得提前领取");
        assert!(
            claim_waiting_delivery_batches(&mut fixture.database, 100)
                .unwrap()
                .is_empty()
        );
        let state: (String, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                "SELECT status, claimed_agent_run_id FROM camp_message_delivery WHERE message_id='message-2'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(state, ("waiting".to_string(), None));
    }

    #[test]
    fn blocked_candidate_page_does_not_starve_a_later_runnable_lane() {
        let mut fixture = Fixture::new();
        for index in 0..16 {
            let camp_id = if index == 0 {
                fixture.camp_id.clone()
            } else {
                fixture.add_camp_lane(&format!("blocked-{index:02}"))
            };
            let initial_message_id = format!("blocked-{index:02}-initial");
            fixture.enqueue_for(&camp_id, &initial_message_id, "先处理");
            let initial_run = claim_waiting_delivery_batches(&mut fixture.database, 100)
                .unwrap()
                .into_iter()
                .next()
                .expect("new lane should be claimable before its cleanup fence is installed");
            let now = chrono::Utc::now().to_rfc3339();
            fixture
                .database
                .connection()
                .execute(
                    r#"
                    UPDATE agent_run
                    SET status = 'failed', ended_at = ?2, updated_at = ?2,
                        cancel_requested_at = ?2,
                        cancel_reason_code = 'runtime_terminal_unconfirmed'
                    WHERE id = ?1
                    "#,
                    params![initial_run, now],
                )
                .unwrap();
            let waiting_message_id = format!("blocked-{index:02}-waiting");
            fixture.enqueue_for(&camp_id, &waiting_message_id, "等待清理");
            fixture.set_delivery_created_at(
                &waiting_message_id,
                &format!("2026-01-01T00:00:{index:02}Z"),
            );
        }

        let runnable_camp = fixture.add_camp_lane("runnable-after-blocked-page");
        fixture.enqueue_for(
            &runnable_camp,
            "runnable-after-blocked-page",
            "应当立即领取",
        );
        fixture.set_delivery_created_at("runnable-after-blocked-page", "2026-01-01T00:01:00Z");

        let claimed = claim_waiting_delivery_batches(&mut fixture.database, 16).unwrap();
        assert_eq!(claimed.len(), 1);
        let anchor: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT anchor_message_id FROM agent_run WHERE id = ?1",
                [&claimed[0]],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(anchor, "runnable-after-blocked-page");
    }

    #[test]
    fn claim_freezes_deduplicated_skill_mentions_from_the_whole_batch() {
        let mut fixture = Fixture::new();
        fixture.enqueue("message-1", "$review-code first");
        fixture.enqueue("message-2", "$review-code second");
        let content = vec![StructuredThreadMessageSegment::SkillMention {
            skill_id: "missing-skill".to_string(),
            name_at_send: "review-code".to_string(),
        }];
        let content_json = serde_json::to_string(&content).unwrap();
        let digest = canonical_content_digest(&content).unwrap();
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE camp_message
                SET structured_content_json = ?1, content_digest = ?2
                WHERE id IN ('message-1', 'message-2')
                "#,
                params![content_json, digest],
            )
            .unwrap();

        let run_id = claim_waiting_delivery_batches(&mut fixture.database, 100)
            .unwrap()
            .pop()
            .unwrap();
        let (snapshot_json, snapshot_digest): (String, String) = fixture
            .database
            .connection()
            .query_row(
                r#"
                SELECT skill_selection_snapshot_json, skill_selection_snapshot_digest
                FROM agent_run WHERE id = ?1
                "#,
                [&run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let snapshot = parse_skill_selection_snapshot(&snapshot_json, &snapshot_digest).unwrap();
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].skill_id, "missing-skill");
        assert_eq!(snapshot.entries[0].name_at_send, "review-code");
    }

    #[test]
    fn runtime_payload_capacity_selects_the_full_context_fifo_prefix_and_defaults_to_256_kib() {
        let mut constrained = Fixture::new();
        let models_json: String = constrained
            .database
            .connection()
            .query_row(
                "SELECT model_catalog_json FROM adapter_capability_snapshot WHERE installation_id='adapter-test-codex'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let mut models: Vec<ModelDescriptor> = serde_json::from_str(&models_json).unwrap();
        models[0].options.push(ModelOptionDescriptor {
            key: "maxContextPayloadBytes".to_string(),
            label: "Maximum context payload bytes".to_string(),
            value_type: "enum".to_string(),
            values: vec![ValueChoice {
                value: (8 * 1024).to_string(),
                label: "8 KiB".to_string(),
            }],
            default_value: Some((8 * 1024).to_string()),
            scope: RuntimeOptionScope::Run,
        });
        constrained
            .database
            .connection()
            .execute(
                "UPDATE adapter_capability_snapshot SET model_catalog_json=?1 WHERE installation_id='adapter-test-codex'",
                [serde_json::to_string(&models).unwrap()],
            )
            .unwrap();
        constrained
            .database
            .connection()
            .execute(
                r#"
                UPDATE agent_profile
                SET default_model_selection_json = ?2
                WHERE id = ?1
                "#,
                params![
                    "agent_1",
                    json!({
                        "mode": "explicit",
                        "modelId": "gpt-test",
                        "options": {"maxContextPayloadBytes": (8 * 1024).to_string()}
                    })
                    .to_string(),
                ],
            )
            .unwrap();
        constrained.enqueue("capacity-1", &"a".repeat(5_000));
        constrained.enqueue("capacity-2", &"b".repeat(5_000));
        let run_id = claim_waiting_delivery_batches(&mut constrained.database, 100)
            .unwrap()
            .pop()
            .unwrap();
        let claimed_inputs: i64 = constrained
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM agent_run_input WHERE agent_run_id = ?1",
                [&run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(claimed_inputs, 1);
        let remaining: i64 = constrained
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM camp_message_delivery WHERE status = 'waiting'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 1);
        assert_eq!(constrained.frozen_history_result(&run_id), (0, true));

        let mut defaulted = Fixture::new();
        defaulted.enqueue("default-capacity-1", &"a".repeat(5_000));
        defaulted.enqueue("default-capacity-2", &"b".repeat(5_000));
        let run_id = claim_waiting_delivery_batches(&mut defaulted.database, 100)
            .unwrap()
            .pop()
            .unwrap();
        let claimed_inputs: i64 = defaulted
            .database
            .connection()
            .query_row(
                "SELECT COUNT(*) FROM agent_run_input WHERE agent_run_id = ?1",
                [&run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(claimed_inputs, 2);
        assert_eq!(defaulted.frozen_history_result(&run_id), (0, false));
    }

    // Owns the claim -> materialize boundary: an accepted native Session is not
    // evidence that this Run can omit the current Bootstrap from its budget.
    #[test]
    #[cfg(feature = "extended-tests")]
    fn changed_bootstrap_splits_before_claim_and_materializes_the_frozen_snapshot() {
        use crate::context::{
            CharterDeliveryMode, ContextService, DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
        };
        let mut fixture = Fixture::new();
        fixture.database.connection().execute_batch(r#"
            UPDATE adapter_installation SET adapter_kind='opencode-cli' WHERE id='adapter-test-codex';
            UPDATE agent_profile SET selected_runtime_adapter_kind='opencode-cli',
                default_permission_config_json='{"adapterKind":"opencode-cli","schemaVersion":1,"values":{"permission":"allow"}}'
                WHERE id='agent_1';
        "#).unwrap();
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_profile SET professional_responsibilities=?1 WHERE id='agent_1'",
                ["😀".repeat(9_000)],
            )
            .unwrap();
        let accept_and_finish =
            |fixture: &mut Fixture, run: &str, context: &crate::context::PreparedContext| {
                let input = ContextService
                    .prepare_input_delivery_for_context(&mut fixture.database, run, 1, context)
                    .unwrap();
                ContextService
                    .acknowledge_input_delivery(
                        &mut fixture.database,
                        &input.id,
                        &format!("accepted-{run}"),
                    )
                    .unwrap();
                let tx = fixture.database.connection_mut().transaction().unwrap();
                tx.execute(
                    "UPDATE agent_run SET status='succeeded',ended_at=datetime('now') WHERE id=?1",
                    [run],
                )
                .unwrap();
                settle_run_deliveries(
                    &tx,
                    run,
                    "succeeded",
                    None,
                    &chrono::Utc::now().to_rfc3339(),
                )
                .unwrap();
                tx.commit().unwrap();
            };
        let add_memory = |fixture: &mut Fixture, key: &str| {
            let command = fixture.user_command(crate::memory::CreateMemoryCommand {
                scope: crate::memory::MemoryScopeKind::Hearth,
                kind: crate::memory::MemoryKind::Preference,
                body: format!("private Memory body for {key}"),
                retrieval_keys: vec![key.into()],
                companion_agent_id: None,
                relationship_agent_ids: vec![],
                direction: None,
                directed_actor_agent_id: None,
                review_after: None,
            });
            crate::memory::MemoryService::default()
                .create(&mut fixture.database, &command)
                .unwrap();
        };
        fixture.enqueue("initial", "establish a Session");
        let initial_run = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .remove(0);
        let initial = fixture.materialize_with_mode(
            &initial_run,
            CharterDeliveryMode::FirstPayload,
            DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
        );
        fixture.database.connection().execute(
            "UPDATE conversation SET native_session_id='existing-opencode-session' WHERE id='delivery-queue-agent-1'", [],
        ).unwrap();
        accept_and_finish(&mut fixture, &initial_run, &initial);
        let old_digest: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT native_charter_digest FROM conversation WHERE id='delivery-queue-agent-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        add_memory(&mut fixture, "indexed-before-claim");
        let body = "中".repeat(40_000); // 120,000 UTF-8 bytes per complete message.
        fixture.enqueue("large-1", &body);
        fixture.enqueue("large-2", &body);
        let run = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .remove(0);
        let messages: Vec<String> = fixture
            .database
            .connection()
            .prepare(
                "SELECT message_id FROM agent_run_input WHERE agent_run_id=?1 ORDER BY ordinal",
            )
            .unwrap()
            .query_map([&run], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(messages, ["large-1"]);
        let waiting: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT status FROM camp_message_delivery WHERE message_id='large-2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(waiting, "waiting");
        assert!(
            fixture
                .database
                .connection()
                .execute(
                    "UPDATE agent_run_claim_context SET context_json='{}' WHERE agent_run_id=?1",
                    [&run],
                )
                .is_err()
        );
        add_memory(&mut fixture, "indexed-after-claim");
        fixture
            .database
            .connection()
            .execute(
                "UPDATE agent_profile SET team_role='role-after-claim' WHERE id='agent_1'",
                [],
            )
            .unwrap();
        let context = fixture.materialize_with_mode(
            &run,
            CharterDeliveryMode::FirstPayload,
            DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
        );
        assert!(context.bootstrap_in_runtime_payload);
        assert!(context.runtime_payload.contains("indexed-before-claim"));
        assert!(!context.runtime_payload.contains("indexed-after-claim"));
        assert!(!context.runtime_payload.contains("role-after-claim"));
        assert!(context.runtime_payload.contains(&body));
        assert!(context.runtime_payload.len() <= DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES);
        // Reproduce the old claim decision numerically: both dynamic inputs fit,
        // but appending the actual changed Bootstrap would overflow the same cap.
        assert!(
            context.rendered_payload.len() + body.len() + 512 < DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES
        );
        assert!(context.runtime_payload.len() + body.len() > DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES);
        let crate::context::ContextMaterialization::Ready(recovered) = ContextService
            .materialize(
                &mut fixture.database,
                &crate::managed_blob::ManagedBlobStore::new(&fixture._directory),
                &crate::context::MaterializeContextRequest {
                    agent_run_id: &run,
                    execution_epoch: 1,
                    charter_delivery_mode: CharterDeliveryMode::FirstPayload,
                    max_payload_bytes: DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
                },
            )
            .unwrap()
        else {
            panic!("claimed Manifest must recover");
        };
        assert_eq!(recovered.runtime_payload, context.runtime_payload);
        accept_and_finish(&mut fixture, &run, &context);
        let new_digest: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT native_charter_digest FROM conversation WHERE id='delivery-queue-agent-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(old_digest, new_digest);
        let next_run = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .remove(0);
        let next = fixture.materialize_with_mode(
            &next_run,
            CharterDeliveryMode::FirstPayload,
            DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
        );
        assert!(next.runtime_payload.contains("indexed-after-claim"));
        assert!(next.runtime_payload.contains("role-after-claim"));
        assert!(next.runtime_payload.contains("large-2"));
        assert!(!next.runtime_payload.contains("large-1"));
        assert!(next.runtime_payload.len() <= DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES);
        accept_and_finish(&mut fixture, &next_run, &next);
        fixture.enqueue("unchanged", "ordinary continuation");
        let unchanged_run = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .remove(0);
        let unchanged = fixture.materialize_with_mode(
            &unchanged_run,
            CharterDeliveryMode::FirstPayload,
            DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
        );
        assert!(
            !unchanged.bootstrap_in_runtime_payload,
            "reserving bytes must not force a resend"
        );
        let mut separate = Fixture::new();
        separate
            .database
            .connection()
            .execute(
                "UPDATE agent_profile SET professional_responsibilities=?1 WHERE id='agent_1'",
                ["😀".repeat(9_000)],
            )
            .unwrap();
        separate.enqueue("separate-system-layer", &"中".repeat(80_000));
        let independent_run = claim_waiting_delivery_batches(&mut separate.database, 1)
            .unwrap()
            .remove(0);
        let independent = separate.materialize_with_mode(
            &independent_run,
            CharterDeliveryMode::NativeAppend,
            DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
        );
        assert!(!independent.bootstrap_in_runtime_payload);
        assert!(independent.runtime_payload.len() > 240_000);
        assert!(independent.runtime_payload.len() <= DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES);
    }

    #[test]
    fn oversized_first_input_keeps_context_payload_too_large_failure() {
        let mut fixture = Fixture::new();
        let body = "large input 中文😀 ".repeat(30_000);
        fixture.enqueue("oversized-first", &body);
        let run_id = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .pop()
            .unwrap();
        let status: (String, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                "SELECT status, last_error_code FROM agent_run WHERE id = ?1",
                [&run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            status,
            (
                "failed".to_string(),
                Some("context_payload_too_large".to_string())
            )
        );
        assert_eq!(fixture.frozen_history_result(&run_id), (0, false));
        let delivery_status: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT status FROM camp_message_delivery WHERE message_id = 'oversized-first'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(delivery_status, "failed");
        let (stored_failure, started_at, retry_allowed): (String, Option<String>, bool) = fixture
            .database.connection().query_row(
                "SELECT public_runtime_failure_json, started_at, manual_retry_allowed FROM agent_run WHERE id=?1",
                [&run_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ).unwrap();
        let failure: crate::runtime_failure::RuntimeFailureView =
            serde_json::from_str(&stored_failure).unwrap();
        failure.validate().unwrap();
        assert_eq!(failure.code, "context_payload_too_large");
        assert_eq!(
            failure.origin,
            crate::runtime_failure::RuntimeFailureOrigin::Rovai
        );
        assert_eq!(
            failure.runtime_kind,
            crate::agent_profile::AdapterKind::CodexCli
        );
        assert!(!failure.retryable);
        assert!(failure.detail.is_some());
        assert!(started_at.is_none());
        assert!(!retry_allowed);
        let original: String = fixture
            .database
            .connection()
            .query_row(
                "SELECT body FROM camp_message WHERE id='oversized-first'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(original, body, "claim must not truncate the public input");
        let delivery_count: i64 = fixture
            .database
            .connection()
            .query_row(
                "SELECT count(*) FROM runtime_input_delivery WHERE agent_run_id=?1",
                [&run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(delivery_count, 0, "rejected input must never reach Runtime");
        assert!(
            claim_waiting_delivery_batches(&mut fixture.database, 1)
                .unwrap()
                .is_empty()
        );
        fixture.enqueue("ordinary-next", "继续处理普通消息");
        let next = claim_waiting_delivery_batches(&mut fixture.database, 1)
            .unwrap()
            .remove(0);
        let next_state: (String, Option<String>) = fixture
            .database
            .connection()
            .query_row(
                "SELECT status, public_runtime_failure_json FROM agent_run WHERE id=?1",
                [&next],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(next_state, ("queued".into(), None));

        // A fresh connection must project the durable error even after a later input.
        let Fixture {
            database,
            _directory: directory,
            camp_id,
        } = fixture;
        drop(database);
        let mut database = Database::open(&directory).unwrap();
        let snapshot = crate::read_model::ReadModelService
            .camp_snapshot(&mut database, &camp_id)
            .unwrap();
        let projected = snapshot
            .agent_runs
            .iter()
            .find(|run| run.id == run_id)
            .unwrap();
        assert_eq!(projected.failure.as_ref(), Some(&failure));
        assert_eq!(projected.execution_evidence_count, 0);
        assert_eq!(projected.input_message_ids, ["oversized-first"]);

        // Pre-upgrade failures have only the stable code; unknown codes stay absent.
        database
            .connection()
            .execute(
                "UPDATE agent_run SET public_runtime_failure_json=NULL WHERE id=?1",
                [&run_id],
            )
            .unwrap();
        let legacy = crate::read_model::ReadModelService
            .camp_snapshot(&mut database, &camp_id)
            .unwrap();
        assert_eq!(
            legacy
                .agent_runs
                .iter()
                .find(|run| run.id == run_id)
                .unwrap()
                .failure
                .as_ref(),
            Some(&failure)
        );
        database
            .connection()
            .execute(
                "UPDATE agent_run SET last_error_code='unrecognized_failure' WHERE id=?1",
                [&run_id],
            )
            .unwrap();
        let unknown = crate::read_model::ReadModelService
            .camp_snapshot(&mut database, &camp_id)
            .unwrap();
        assert!(
            unknown
                .agent_runs
                .iter()
                .find(|run| run.id == run_id)
                .unwrap()
                .failure
                .is_none()
        );
    }

    #[test]
    fn claim_projection_contains_each_user_attachment_quotes_and_message_skills() {
        let mut fixture = Fixture::new();
        fixture.enqueue("projected-1", "secret");
        fixture.enqueue("projected-2", "review this");
        let first_source = json!([{
            "id": "00000000-0000-4000-8000-000000000001",
            "sourcePath": crate::test_support::absolute_test_path("/tmp/source-one.txt"),
            "displayName": "source-one.txt",
            "kind": "file",
            "mediaType": "text/plain",
            "observedByteSize": 10
        }]);
        let second_source = json!([{
            "id": "00000000-0000-4000-8000-000000000002",
            "sourcePath": crate::test_support::absolute_test_path("/tmp/source-two.txt"),
            "displayName": "source-two.txt",
            "kind": "file",
            "mediaType": "text/plain",
            "observedByteSize": 11
        }]);
        let second_content = vec![
            StructuredThreadMessageSegment::CurrentUserMention {
                user_id: "local_user".to_string(),
            },
            StructuredThreadMessageSegment::Text {
                text: "review this ".to_string(),
            },
            StructuredThreadMessageSegment::SkillMention {
                skill_id: "skill-review".to_string(),
                name_at_send: "review-code".to_string(),
            },
        ];
        fixture
            .database
            .connection()
            .execute(
                "UPDATE camp_message SET source_attachments_json=?2 WHERE id=?1",
                params!["projected-1", first_source.to_string()],
            )
            .unwrap();
        fixture
            .database
            .connection()
            .execute(
                r#"
                UPDATE camp_message
                SET source_attachments_json=?2, structured_content_json=?3,
                    author_type='agent', author_id='agent_2', content_digest=?4,
                    effective_recipient_ids_json='["agent_2","agent_1","agent_2"]'
                WHERE id=?1
                "#,
                params![
                    "projected-2",
                    second_source.to_string(),
                    serde_json::to_string(&second_content).unwrap(),
                    canonical_content_digest(&second_content).unwrap(),
                ],
            )
            .unwrap();
        let transaction = fixture.database.connection_mut().transaction().unwrap();
        let quote = capture_quote(
            &transaction,
            &fixture.camp_id,
            None,
            &QuoteSelection {
                message_id: "projected-1".to_string(),
                body_at_selection: "secret".to_string(),
                start_scalar: 0,
                end_scalar: 6,
                text: "secret".to_string(),
                current_user_display_name: None,
            },
        )
        .unwrap();
        store_quotes(
            &transaction,
            QuoteStorage::CampMessage,
            "projected-2",
            &[quote],
        )
        .unwrap();
        let boundary: i64 = transaction
            .query_row(
                "SELECT last_message_sequence FROM camp WHERE id=?1",
                [&fixture.camp_id],
                |row| row.get(0),
            )
            .unwrap();
        let projection = project_batch_run_input_for_claim(
            &transaction,
            &fixture.camp_id,
            "agent_1",
            boundary,
            &["projected-1".to_string(), "projected-2".to_string()],
            &[CurrentInputSkillLink {
                name: "review-code".to_string(),
                path: "/tmp/.codex/skills/review-code/SKILL.md".to_string(),
                skill_id: None,
                message_index: None,
            }],
            &mut crate::message_sender::SenderNames::default(),
        )
        .unwrap();
        let messages = projection["messages"].as_array().unwrap();
        assert_eq!(
            messages[0]["attachments"][0]["path"],
            crate::test_support::absolute_test_path("/tmp/source-one.txt")
        );
        assert_eq!(
            messages[1]["attachments"][0]["path"],
            crate::test_support::absolute_test_path("/tmp/source-two.txt")
        );
        assert_eq!(messages[1]["quotes"][0]["text"], "secret");
        assert_eq!(messages[1]["skills"][0]["name"], "review-code");
        assert_eq!(
            messages[1]["skills"][0]["path"],
            "/tmp/.codex/skills/review-code/SKILL.md"
        );
        assert_eq!(messages[0]["mentions"][0]["id"], "agent_1");
        assert!(messages[0]["mentions"][0]["name"].as_str().is_some());
        assert_eq!(
            messages[1]["mentions"]
                .as_array()
                .unwrap()
                .iter()
                .map(|mention| mention["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["agent_2", "agent_1", "user"]
        );
        assert_eq!(messages[1]["mentions"][2], json!({"id":"user"}));
        assert!(
            messages
                .iter()
                .all(|message| message.get("mentionsCurrentUser").is_none())
        );
        assert_eq!(messages[0]["senderType"], "user");
        assert_eq!(messages[0]["senderId"], "user");
        assert!(messages[0].get("senderName").is_none());
        assert_eq!(messages[1]["senderType"], "agent");
        assert_eq!(messages[1]["senderId"], "agent_2");
        assert!(messages[1]["senderName"].as_str().is_some());
        assert_eq!(messages[1]["quotes"][0]["source"]["author"]["type"], "user");
        let mut without_sender_name = projection.clone();
        without_sender_name["messages"][1]
            .as_object_mut()
            .unwrap()
            .remove("senderName");
        assert!(
            serialized_batch_run_input_len(&projection).unwrap()
                > serialized_batch_run_input_len(&without_sender_name).unwrap()
        );
        let mut without_mentions = projection.clone();
        for message in without_mentions["messages"].as_array_mut().unwrap() {
            message.as_object_mut().unwrap().remove("mentions");
        }
        assert!(
            serialized_batch_run_input_len(&projection).unwrap()
                > serialized_batch_run_input_len(&without_mentions).unwrap()
        );
        transaction.rollback().unwrap();
    }
}
