use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    agent_profile::{FrozenAgentRuntimeConfig, resolve_frozen_runtime},
    camp_content::StructuredCampMessageContent,
    collaboration::build_effective_config,
    context::{
        project_batch_run_input_for_claim, public_history_hint, runtime_max_context_payload_bytes,
        serialized_batch_run_input_len,
    },
    context_contract::PUBLIC_CAMP_BATCH_CONTEXT_MANIFEST_VERSION,
    current_input_skill::{
        SkillSelectionSnapshot, freeze_skill_selection_with_messages,
        projected_skill_links_for_claim,
    },
    db::Database,
    runtime::{AgentRunWorkspace, runtime_cleanup_blocked_since_connection},
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
}

#[derive(Debug)]
struct BatchPrefixSelection {
    count: usize,
    first_too_large: bool,
    skill_selection: SkillSelectionSnapshot,
    has_additional_public_messages: bool,
}

pub(crate) fn enqueue_message_deliveries(
    transaction: &Transaction<'_>,
    camp_id: &str,
    message_id: &str,
    message_sequence: i64,
    recipient_agent_ids: &[String],
    now: &str,
) -> Result<Vec<EnqueuedDelivery>> {
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
                format!("Message Delivery target {recipient_agent_id} is not an active Camp member")
            })?;
        ensure_camp_member_conversation(transaction, camp_id, recipient_agent_id, now)?;
        let delivery_id = Uuid::new_v4().to_string();
        transaction.execute(
            r#"
            INSERT INTO camp_message_delivery(
                id, camp_id, message_id, recipient_agent_id,
                recipient_membership_version_at_admission, queue_sequence,
                status, claimed_agent_run_id, failure_code, version,
                created_at, claimed_at, ended_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'waiting', NULL, NULL, 1,
                      ?7, NULL, NULL, ?7)
            "#,
            params![
                delivery_id,
                camp_id,
                message_id,
                recipient_agent_id,
                membership_version,
                message_sequence,
                now,
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
            WHERE delivery.status = 'waiting'
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
/// Waiting rows carry only message responsibility. Runtime, model and permissions are
/// resolved here. Workspace is also frozen unless an unprepared Mission must first
/// establish its exact execution directory at the execution-preparing boundary.
pub fn claim_waiting_delivery_batches(database: &mut Database, limit: i64) -> Result<Vec<String>> {
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
            let runtime = match resolve_frozen_runtime(&transaction, &conversation_id, &agent_id)? {
                Ok(runtime) => runtime,
                Err(_) => continue,
            };
            let effective_config =
                build_effective_config(&transaction, &conversation_id, &agent_id, &runtime)?;
            let project_path: String = transaction.query_row(
                "SELECT project_path FROM camp WHERE id = ?1",
                [&camp_id],
                |row| row.get(0),
            )?;
            let workspace = batch_workspace_for_claim(&transaction, &camp_id, &project_path)?;
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
                "SELECT last_message_sequence FROM camp WHERE id = ?1",
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
            let max_payload_bytes = runtime_max_context_payload_bytes(&runtime);
            let selection = select_batch_prefix(
                &transaction,
                &camp_id,
                &agent_id,
                previous_public_boundary,
                camp_public_tail,
                &runtime,
                std::path::Path::new(cleanup_execution_root),
                &waiting,
                max_payload_bytes,
            )?;
            let selected = &waiting[..selection.count];
            let anchor_message_id = selected
                .last()
                .map(|delivery| delivery.message_id.as_str())
                .context("Delivery claim selected an empty input batch")?;
            let now = chrono::Utc::now().to_rfc3339();
            let agent_run_id = Uuid::new_v4().to_string();
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
                &runtime,
                &selection.skill_selection,
                selected,
                selection.first_too_large,
                &now,
            )?;
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

fn load_waiting_prefix(
    transaction: &Transaction<'_>,
    camp_id: &str,
    agent_id: &str,
) -> Result<Vec<WaitingDelivery>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT delivery.id, message.id, message.sequence,
               message.structured_content_json, message.content_digest,
               recipient.display_name
        FROM camp_message_delivery AS delivery
        JOIN camp_message AS message ON message.id = delivery.message_id
        LEFT JOIN agent_profile AS recipient
          ON message.address_mode = 'default'
         AND json_array_length(message.addressed_agent_ids_json) = 1
         AND recipient.id = json_extract(message.addressed_agent_ids_json, '$[0]')
        WHERE delivery.camp_id = ?1
          AND delivery.recipient_agent_id = ?2
          AND delivery.status = 'waiting'
          AND message.tombstoned_at IS NULL
          AND message.recall_state <> 'withdrawn'
        ORDER BY delivery.queue_sequence
        "#,
    )?;
    Ok(statement
        .query_map(params![camp_id, agent_id], |row| {
            Ok(WaitingDelivery {
                id: row.get(0)?,
                message_id: row.get(1)?,
                sequence: row.get(2)?,
                structured_content_json: row.get(3)?,
                content_digest: row.get(4)?,
                default_recipient_display_name: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
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
    max_payload_bytes: usize,
) -> Result<BatchPrefixSelection> {
    let mut batch_content = Vec::new();
    let mut batch_message_indices = Vec::new();
    let mut previous_selection = None;
    for count in 1..=waiting.len() {
        if let Some(content_json) = waiting[count - 1].structured_content_json.as_deref() {
            let mut content = serde_json::from_str::<StructuredCampMessageContent>(content_json)
                .context("CampMessage Structured Content is invalid during Delivery claim")?;
            batch_message_indices.extend(std::iter::repeat_n(count - 1, content.len()));
            batch_content.append(&mut content);
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
        )?;
        let has_additional_public_messages = has_additional_public_messages(
            transaction,
            camp_id,
            agent_id,
            previous_public_boundary,
            camp_public_tail,
            &message_ids,
        )?;
        let hint_bytes =
            public_history_hint(previous_public_boundary, has_additional_public_messages).len();
        if serialized_batch_run_input_len(&run_input)?.saturating_add(hint_bytes)
            > max_payload_bytes
        {
            return Ok(match previous_selection {
                Some((skill_selection, has_additional_public_messages)) => BatchPrefixSelection {
                    count: count - 1,
                    first_too_large: false,
                    skill_selection,
                    has_additional_public_messages,
                },
                None => BatchPrefixSelection {
                    count: 1,
                    first_too_large: true,
                    skill_selection,
                    has_additional_public_messages,
                },
            });
        }
        previous_selection = Some((skill_selection, has_additional_public_messages));
    }
    let (skill_selection, has_additional_public_messages) =
        previous_selection.context("Delivery claim selected an empty input batch")?;
    Ok(BatchPrefixSelection {
        count: waiting.len(),
        first_too_large: false,
        skill_selection,
        has_additional_public_messages,
    })
}

fn has_additional_public_messages(
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
    runtime: &FrozenAgentRuntimeConfig,
    skill_selection: &SkillSelectionSnapshot,
    selected: &[WaitingDelivery],
    first_too_large: bool,
    now: &str,
) -> Result<()> {
    let (skill_selection_json, skill_selection_digest) =
        skill_selection.canonical_json_and_digest()?;
    let first_delivery_id = &selected[0].id;
    let last_delivery_id = &selected[selected.len() - 1].id;
    let status = if first_too_large { "failed" } else { "queued" };
    let ended_at = first_too_large.then_some(now);
    let error_code = first_too_large.then_some("context_payload_too_large");
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
            claim_has_additional_public_messages
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
            ?31, ?32, ?4, ?33, ?34
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
            runtime.adapter_kind.as_str(),
            runtime.installation_id,
            runtime.reported_version,
            runtime.executable_fingerprint,
            serde_json::to_string(&runtime.capabilities)?,
            serde_json::to_string(&runtime.model)?,
            serde_json::to_string(&runtime.permissions)?,
            runtime.binding_compatibility_digest,
            runtime.executable_path,
            runtime.auth_scope,
            runtime.host_config_digest,
            runtime.protocol_version,
            runtime.installation_generation,
            runtime.search_environment_generation,
            runtime.native_session_compatibility_key,
            skill_selection_json,
            skill_selection_digest,
            camp_id,
            anchor_message_id,
            previous_public_boundary,
            has_additional_public_messages,
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
        let terminal_status = if first_too_large { "failed" } else { "claimed" };
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
        transaction.execute(
            r#"
            UPDATE camp_message
            SET recall_state = 'closed', version = version + 1, updated_at = ?2
            WHERE id = ?1 AND recall_state = 'recallable'
            "#,
            params![delivery.message_id, now],
        )?;
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
        camp_content::{StructuredCampMessageSegment, canonical_content_digest},
        collaboration::{CollaborationService, CreateCampCommand},
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
                        payload: CreateCampCommand::for_test_with_members(
                            workspace.to_string_lossy().into_owned(),
                            &["agent_1"],
                            "agent_1",
                        ),
                    },
                )
                .unwrap();
            let camp_id = created.result.payload["campId"]
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
                        payload: CreateCampCommand::for_test_with_members(
                            workspace.to_string_lossy().into_owned(),
                            &["agent_1"],
                            "agent_1",
                        ),
                    },
                )
                .unwrap();
            let camp_id = created.result.payload["campId"]
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
                sequence,
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
    fn light_ready_runtime_with_saved_explicit_model_claims_for_dispatch_preflight() {
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
                    probe_status = 'light_ready',
                    capabilities_json = '[]',
                    protocols_json = '[]',
                    model_catalog_json = '[]',
                    last_successful_probe_at = NULL,
                    model_catalog_succeeded_at = NULL
                WHERE installation_id = 'adapter-test-codex'
                "#,
                [],
            )
            .unwrap();
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

    #[test]
    fn claim_freezes_the_default_recipient_display_name_on_each_run_input() {
        let mut fixture = Fixture::new();
        fixture.enqueue("default-message", "正文");
        fixture
            .database
            .connection()
            .execute(
                "UPDATE camp_message SET address_mode = 'default' WHERE id = 'default-message'",
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
            "the legacy 500ms dispatch path must not pick up ordinary batch Runs"
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
        let ready_run = claim_waiting_delivery_batches(&mut ready.database, 100)
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
        let unprepared_run = claim_waiting_delivery_batches(&mut unprepared.database, 100)
            .unwrap()
            .pop()
            .unwrap();
        let unprepared_workspace_json: Option<String> = unprepared
            .database
            .connection()
            .query_row(
                "SELECT workspace_json FROM agent_run WHERE id = ?1",
                [&unprepared_run],
                |row| row.get(0),
            )
            .unwrap();
        assert!(unprepared_workspace_json.is_none());
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
        let content = vec![StructuredCampMessageSegment::SkillMention {
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
    fn runtime_payload_capacity_selects_the_real_fifo_prefix_and_defaults_to_96_kib() {
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

    #[test]
    fn oversized_first_input_keeps_context_payload_too_large_failure() {
        let mut fixture = Fixture::new();
        fixture.enqueue("oversized-first", &"large input ".repeat(10_000));
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
            StructuredCampMessageSegment::Text {
                text: "review this ".to_string(),
            },
            StructuredCampMessageSegment::SkillMention {
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
                    content_digest=?4
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
        assert!(serialized_batch_run_input_len(&projection).unwrap() > 0);
        transaction.rollback().unwrap();
    }
}
