use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    agent_profile::FrozenAgentRuntimeConfig, collaboration::append_domain_event, command::ActorRef,
    db::Database, runtime::AgentRunWorkspace,
};

pub const CONVERSATION_INPUT_KIND_MEMBER_CALL: &str = "member_call";
pub const CONVERSATION_INPUT_KIND_CALL_OUTCOME: &str = "call_outcome";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenRuntimeBasis {
    pub effective_config: Value,
    pub workspace: AgentRunWorkspace,
}

impl FrozenRuntimeBasis {
    pub fn runtime(&self) -> Result<FrozenAgentRuntimeConfig> {
        serde_json::from_value(
            self.effective_config
                .get("runtime")
                .cloned()
                .context("frozen execution basis has no Runtime configuration")?,
        )
        .context("frozen execution basis Runtime configuration is invalid")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenConversationInputBasis {
    pub runtime: FrozenRuntimeBasis,
    pub task_id: Option<String>,
    pub initial_camp_context_through_sequence: i64,
    pub initial_conversation_context_through_sequence: i64,
    pub source_agent_run_id: String,
    pub a2a_root_agent_run_id: String,
    pub a2a_depth: i64,
    pub purpose: String,
    pub expected_output: String,
}

#[derive(Debug, Clone)]
pub struct OpenReturnObligation {
    pub id: String,
    pub caller_agent_id: String,
    pub caller_conversation_id: String,
    pub caller_a2a_depth: i64,
    pub a2a_root_agent_run_id: String,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct TurnCancellationInputSummary {
    pub inputs_cancelled: usize,
    pub obligations_cancelled: usize,
}

#[derive(Debug)]
struct PendingInput {
    id: String,
    camp_id: String,
    camp_turn_id: String,
    conversation_id: String,
    kind: String,
    source_inbox_message_id: Option<String>,
    frozen_execution_basis_json: String,
}

pub fn capture_run_runtime_basis(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
) -> Result<FrozenRuntimeBasis> {
    let (effective_config, workspace): (String, String) = transaction.query_row(
        r#"
        SELECT effective_config_json, workspace_json
        FROM agent_run
        WHERE id = ?1
        "#,
        [agent_run_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let basis = FrozenRuntimeBasis {
        effective_config: serde_json::from_str(&effective_config)
            .context("caller AgentRun effective configuration is invalid")?,
        workspace: serde_json::from_str(&workspace)
            .context("caller AgentRun workspace is invalid")?,
    };
    basis.workspace.validate()?;
    basis.runtime()?;
    Ok(basis)
}

pub fn load_open_return_obligation(
    transaction: &Transaction<'_>,
    consuming_agent_run_id: &str,
) -> Result<Option<OpenReturnObligation>> {
    transaction
        .query_row(
            r#"
            SELECT id, caller_agent_id, caller_conversation_id,
                   caller_a2a_depth, a2a_root_agent_run_id
            FROM return_obligation
            WHERE consuming_agent_run_id = ?1 AND status = 'open'
            "#,
            [consuming_agent_run_id],
            |row| {
                Ok(OpenReturnObligation {
                    id: row.get(0)?,
                    caller_agent_id: row.get(1)?,
                    caller_conversation_id: row.get(2)?,
                    caller_a2a_depth: row.get(3)?,
                    a2a_root_agent_run_id: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

pub fn materialize_pending_inputs(database: &mut Database, limit: usize) -> Result<usize> {
    if !(1..=100).contains(&limit) {
        anyhow::bail!("Conversation Input materialization limit must be between 1 and 100");
    }
    let mut materialized = 0;
    for _ in 0..limit {
        let transaction = database
            .connection_mut()
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let candidate = load_next_pending_input(&transaction)?;
        let Some(candidate) = candidate else {
            transaction.commit()?;
            break;
        };
        let basis = (|| -> Result<FrozenConversationInputBasis> {
            let basis = serde_json::from_str::<FrozenConversationInputBasis>(
                &candidate.frozen_execution_basis_json,
            )
            .context("Conversation Input frozen execution basis is invalid")?;
            basis.runtime.runtime()?;
            basis.runtime.workspace.validate()?;
            Ok(basis)
        })();
        let basis = match basis {
            Ok(basis) => basis,
            Err(_) => {
                fail_pending_input(&transaction, &candidate, "frozen_execution_basis_invalid")?;
                transaction.commit()?;
                continue;
            }
        };
        if !recipient_is_still_eligible(
            &transaction,
            &candidate.camp_id,
            &candidate.conversation_id,
        )? {
            fail_pending_input(&transaction, &candidate, "recipient_no_longer_eligible")?;
            transaction.commit()?;
            continue;
        }
        if !current_authorization_covers_basis(&transaction, &candidate.conversation_id, &basis)? {
            fail_pending_input(&transaction, &candidate, "authorization_revoked")?;
            transaction.commit()?;
            continue;
        }
        if !frozen_runtime_basis_is_current(&transaction, &basis)? {
            fail_pending_input(&transaction, &candidate, "runtime_basis_no_longer_current")?;
            transaction.commit()?;
            continue;
        }
        materialize_input(&transaction, &candidate, &basis)?;
        transaction.commit()?;
        materialized += 1;
    }
    Ok(materialized)
}

fn load_next_pending_input(transaction: &Transaction<'_>) -> Result<Option<PendingInput>> {
    transaction
        .query_row(
            r#"
            SELECT conversation_input.id, camp_turn.camp_id,
                   conversation_input.camp_turn_id,
                   conversation_input.conversation_id,
                   conversation_input.kind,
                   conversation_input.source_inbox_message_id,
                   conversation_input.frozen_execution_basis_json
            FROM conversation_input
            JOIN camp_turn ON camp_turn.id = conversation_input.camp_turn_id
            JOIN camp ON camp.id = camp_turn.camp_id
            WHERE conversation_input.status = 'pending'
              AND camp_turn.status IN ('running', 'waiting')
              AND camp_turn.cancel_requested_at IS NULL
              AND camp.status = 'active'
              AND NOT EXISTS (
                  SELECT 1
                  FROM agent_run
                  WHERE agent_run.conversation_id = conversation_input.conversation_id
                    AND agent_run.status IN ('queued', 'running', 'waiting')
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM conversation_input AS earlier
                  WHERE earlier.conversation_id = conversation_input.conversation_id
                    AND earlier.status = 'pending'
                    AND earlier.sequence < conversation_input.sequence
              )
            ORDER BY conversation_input.created_at,
                     conversation_input.conversation_id,
                     conversation_input.sequence
            LIMIT 1
            "#,
            [],
            |row| {
                Ok(PendingInput {
                    id: row.get(0)?,
                    camp_id: row.get(1)?,
                    camp_turn_id: row.get(2)?,
                    conversation_id: row.get(3)?,
                    kind: row.get(4)?,
                    source_inbox_message_id: row.get(5)?,
                    frozen_execution_basis_json: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn recipient_is_still_eligible(
    transaction: &Transaction<'_>,
    camp_id: &str,
    conversation_id: &str,
) -> Result<bool> {
    let eligible: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*)
        FROM conversation
        JOIN camp_member
          ON camp_member.camp_id = conversation.camp_id
         AND camp_member.agent_profile_id = conversation.agent_profile_id
        JOIN agent_profile ON agent_profile.id = conversation.agent_profile_id
        WHERE conversation.id = ?1
          AND conversation.camp_id = ?2
          AND camp_member.status = 'active'
          AND camp_member.leave_requested_at IS NULL
          AND agent_profile.profile_status = 'present'
        "#,
        params![conversation_id, camp_id],
        |row| row.get(0),
    )?;
    Ok(eligible == 1)
}

fn current_authorization_covers_basis(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    basis: &FrozenConversationInputBasis,
) -> Result<bool> {
    let current = transaction
        .query_row(
            r#"
            SELECT agent_profile.default_capabilities_json,
                   camp_member.capability_overrides_json
            FROM conversation
            JOIN agent_profile
              ON agent_profile.id = conversation.agent_profile_id
            JOIN camp_member
              ON camp_member.camp_id = conversation.camp_id
             AND camp_member.agent_profile_id = conversation.agent_profile_id
            WHERE conversation.id = ?1
            "#,
            [conversation_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((defaults, overrides)) = current else {
        return Ok(false);
    };
    let defaults = serde_json::from_str(&defaults)
        .context("AgentProfile capabilities are invalid during input materialization")?;
    let overrides = serde_json::from_str(&overrides)
        .context("CampMember capability overrides are invalid during input materialization")?;
    crate::runtime::current_authorization_covers_snapshot(
        &basis.runtime.effective_config,
        &defaults,
        &overrides,
    )
}

fn frozen_runtime_basis_is_current(
    transaction: &Transaction<'_>,
    basis: &FrozenConversationInputBasis,
) -> Result<bool> {
    let runtime = basis.runtime.runtime()?;
    transaction
        .query_row(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM adapter_installation AS installation
                JOIN adapter_capability_snapshot AS snapshot
                  ON snapshot.installation_id = installation.id
                WHERE installation.id = ?1
                  AND installation.enabled = 1
                  AND installation.path_state = 'valid'
                  AND installation.adapter_kind = ?2
                  AND installation.executable_path = ?3
                  AND installation.generation = ?4
                  AND snapshot.executable_fingerprint = ?5
            )
            "#,
            params![
                runtime.installation_id,
                runtime.adapter_kind.as_str(),
                runtime.executable_path,
                runtime.installation_generation,
                runtime.executable_fingerprint,
            ],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn materialize_input(
    transaction: &Transaction<'_>,
    input: &PendingInput,
    basis: &FrozenConversationInputBasis,
) -> Result<()> {
    let runtime = basis.runtime.runtime()?;
    basis.runtime.workspace.validate()?;
    let now = chrono::Utc::now().to_rfc3339();
    let agent_run_id = Uuid::new_v4().to_string();
    transaction.execute(
        r#"
        INSERT INTO agent_run(
            id, camp_turn_id, conversation_id, task_id,
            trigger_conversation_input_id, input_ready_at,
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
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
            ?9, 0, NULL, 'initial', ?10, ?11, 'required',
            ?12, ?13, 'runtime_managed_v2',
            ?14, ?15, ?16, ?17, ?18, ?19,
            ?20, ?21, ?22, ?23, ?24, ?25,
            ?26, ?27, ?28,
            'queued', NULL, NULL, ?29, 0,
            NULL, NULL, 0, NULL,
            0, NULL, NULL, NULL, NULL, NULL, 1,
            ?6, NULL, NULL, ?6,
            'a2a', ?30, ?31, ?32
        )
        "#,
        params![
            agent_run_id,
            input.camp_turn_id,
            input.conversation_id,
            basis.task_id,
            input.id,
            now,
            basis.initial_camp_context_through_sequence,
            basis.initial_conversation_context_through_sequence,
            format!("a2a/{}", input.id),
            basis.purpose,
            basis.expected_output,
            serde_json::to_string(&basis.runtime.effective_config)?,
            serde_json::to_string(&basis.runtime.workspace)?,
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
            format!("conversation-input:{}", input.id),
            basis.source_agent_run_id,
            basis.a2a_root_agent_run_id,
            basis.a2a_depth,
        ],
    )?;
    let updated = transaction.execute(
        r#"
        UPDATE conversation_input
        SET status = 'materialized', consuming_agent_run_id = ?2,
            materialized_at = ?3
        WHERE id = ?1 AND status = 'pending'
          AND consuming_agent_run_id IS NULL
        "#,
        params![input.id, agent_run_id, now],
    )?;
    if updated != 1 {
        anyhow::bail!("Conversation Input changed before materialization committed");
    }
    transaction.execute(
        r#"
        UPDATE return_obligation
        SET consuming_agent_run_id = ?2
        WHERE member_call_input_id = ?1
          AND consuming_agent_run_id IS NULL
          AND status = 'open'
        "#,
        params![input.id, agent_run_id],
    )?;
    if let Some(inbox_message_id) = input.source_inbox_message_id.as_deref() {
        transaction.execute(
            r#"
            UPDATE inbox_message
            SET target_agent_run_id = ?2, updated_at = ?3
            WHERE id = ?1 AND target_agent_run_id IS NULL
            "#,
            params![inbox_message_id, agent_run_id, now],
        )?;
        transaction.execute(
            r#"
            UPDATE conversation_message
            SET agent_run_id = ?2
            WHERE source_inbox_message_id = ?1 AND agent_run_id IS NULL
            "#,
            params![inbox_message_id, agent_run_id],
        )?;
    }
    let actor = ActorRef::System {
        component_id: "conversation-input-reconciler".to_string(),
    };
    append_domain_event(
        transaction,
        "conversation_input.materialized",
        Some(&input.camp_id),
        Some(("conversation_input", &input.id)),
        &actor,
        None,
        &json!({
            "agentRunId": agent_run_id,
            "kind": input.kind,
        }),
    )?;
    append_domain_event(
        transaction,
        "agent_run.queued",
        Some(&input.camp_id),
        Some(("agent_run", &agent_run_id)),
        &actor,
        None,
        &json!({
            "campTurnId": input.camp_turn_id,
            "taskId": basis.task_id,
            "invocationKind": "a2a",
            "conversationInputId": input.id,
            "a2aParentAgentRunId": basis.source_agent_run_id,
            "a2aRootAgentRunId": basis.a2a_root_agent_run_id,
            "a2aDepth": basis.a2a_depth,
        }),
    )?;
    Ok(())
}

fn fail_pending_input(
    transaction: &Transaction<'_>,
    input: &PendingInput,
    terminal_reason: &str,
) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let updated = transaction.execute(
        r#"
        UPDATE conversation_input
        SET status = 'failed', terminal_reason = ?2, terminal_at = ?3
        WHERE id = ?1 AND status = 'pending'
        "#,
        params![input.id, terminal_reason, now],
    )?;
    if updated != 1 {
        anyhow::bail!("Conversation Input changed before failure committed");
    }
    let actor = ActorRef::System {
        component_id: "conversation-input-reconciler".to_string(),
    };
    append_domain_event(
        transaction,
        "conversation_input.failed",
        Some(&input.camp_id),
        Some(("conversation_input", &input.id)),
        &actor,
        None,
        &json!({ "reason": terminal_reason, "kind": input.kind }),
    )?;
    if input.kind == CONVERSATION_INPUT_KIND_MEMBER_CALL {
        create_outcome_for_obligation(
            transaction,
            &input.camp_id,
            &input.camp_turn_id,
            &input.id,
            None,
            "materialization",
            "failed",
            "execution_not_started",
            &now,
        )?;
    }
    crate::runtime::recompute_camp_turn(
        transaction,
        &input.camp_id,
        &input.camp_turn_id,
        &actor,
        None,
        &now,
    )?;
    Ok(())
}

pub fn settle_return_obligation_for_terminal(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    terminal_status: &str,
    now: &str,
) -> Result<Option<String>> {
    if !matches!(terminal_status, "succeeded" | "failed" | "cancelled") {
        anyhow::bail!("Return Obligation terminal status is invalid");
    }
    let target = transaction
        .query_row(
            r#"
            SELECT camp_turn.camp_id, agent_run.camp_turn_id,
                   camp_turn.cancel_requested_at
            FROM agent_run
            JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
            WHERE agent_run.id = ?1
            "#,
            [agent_run_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((camp_id, camp_turn_id, cancel_requested_at)) = target else {
        return Ok(None);
    };
    if cancel_requested_at.is_some() {
        return Ok(None);
    }
    create_outcome_for_obligation(
        transaction,
        &camp_id,
        &camp_turn_id,
        "",
        Some(agent_run_id),
        "run",
        terminal_status,
        "no_explicit_return",
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn create_outcome_for_obligation(
    transaction: &Transaction<'_>,
    camp_id: &str,
    camp_turn_id: &str,
    member_call_input_id: &str,
    consuming_agent_run_id: Option<&str>,
    stage: &str,
    status: &str,
    reason: &str,
    now: &str,
) -> Result<Option<String>> {
    let obligation = transaction
        .query_row(
            r#"
            SELECT return_obligation.id,
                   return_obligation.caller_agent_id,
                   return_obligation.callee_agent_id,
                   return_obligation.caller_conversation_id,
                   return_obligation.caller_resume_basis_json,
                   return_obligation.caller_a2a_depth,
                   return_obligation.a2a_root_agent_run_id,
                   agent_profile.display_name
            FROM return_obligation
            JOIN agent_profile
              ON agent_profile.id = return_obligation.callee_agent_id
            WHERE return_obligation.status = 'open'
              AND (
                    (?1 <> '' AND return_obligation.member_call_input_id = ?1)
                 OR (?2 IS NOT NULL
                     AND return_obligation.consuming_agent_run_id = ?2)
              )
            "#,
            params![member_call_input_id, consuming_agent_run_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .optional()?;
    let Some((
        obligation_id,
        _caller_agent_id,
        callee_agent_id,
        caller_conversation_id,
        caller_resume_basis_json,
        caller_a2a_depth,
        root_run_id,
        callee_name,
    )) = obligation
    else {
        return Ok(None);
    };
    let caller_runtime: FrozenRuntimeBasis = serde_json::from_str(&caller_resume_basis_json)
        .context("Return Obligation caller resume basis is invalid")?;
    caller_runtime.runtime()?;
    caller_runtime.workspace.validate()?;
    let (camp_sequence, conversation_sequence): (i64, i64) = transaction.query_row(
        r#"
        SELECT camp.last_message_sequence, conversation.last_message_sequence
        FROM conversation
        JOIN camp ON camp.id = conversation.camp_id
        WHERE conversation.id = ?1 AND conversation.camp_id = ?2
        "#,
        params![caller_conversation_id, camp_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let source_run_id = if let Some(consuming_agent_run_id) = consuming_agent_run_id {
        consuming_agent_run_id.to_string()
    } else {
        transaction
            .query_row(
                "SELECT frozen_execution_basis_json FROM conversation_input WHERE id = ?1",
                [member_call_input_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .and_then(|value| serde_json::from_str::<FrozenConversationInputBasis>(&value).ok())
            .map(|basis| basis.source_agent_run_id)
            .unwrap_or_else(|| root_run_id.clone())
    };
    let basis = FrozenConversationInputBasis {
        runtime: caller_runtime,
        task_id: None,
        initial_camp_context_through_sequence: camp_sequence,
        initial_conversation_context_through_sequence: conversation_sequence,
        source_agent_run_id: source_run_id,
        a2a_root_agent_run_id: root_run_id,
        a2a_depth: caller_a2a_depth,
        purpose: format!("Handle call outcome from {callee_agent_id}"),
        expected_output: "Handle the lifecycle outcome without assuming a business result. Continue useful work or explain the verified limitation; do not poll for state changes.".to_string(),
    };
    let message = if stage == "materialization" {
        "The requested member execution was accepted, but no AgentRun could be created. No business result was provided or verified."
    } else {
        "The member execution ended without an explicit return. No business result was provided or verified."
    };
    let model_payload = json!({
        "source": {
            "type": "call_outcome",
            "calleeAgentId": callee_agent_id,
            "calleeName": callee_name,
            "stage": stage,
            "status": status,
            "reason": reason,
        },
        "message": message,
    });
    let input_id = Uuid::new_v4().to_string();
    let sequence = allocate_conversation_input_sequence(transaction, &caller_conversation_id, now)?;
    transaction.execute(
        r#"
        INSERT INTO conversation_input(
            id, conversation_id, camp_turn_id, sequence,
            kind, status, source_inbox_message_id,
            return_obligation_id, consuming_agent_run_id,
            model_payload_json, frozen_execution_basis_json,
            terminal_reason, created_at, materialized_at, terminal_at
        ) VALUES (
            ?1, ?2, ?3, ?4, 'call_outcome', 'pending', NULL,
            ?5, NULL, ?6, ?7, NULL, ?8, NULL, NULL
        )
        "#,
        params![
            input_id,
            caller_conversation_id,
            camp_turn_id,
            sequence,
            obligation_id,
            serde_json::to_string(&model_payload)?,
            serde_json::to_string(&basis)?,
            now,
        ],
    )?;
    let updated = transaction.execute(
        r#"
        UPDATE return_obligation
        SET status = 'satisfied_by_core_outcome',
            satisfying_conversation_input_id = ?2,
            satisfied_at = ?3
        WHERE id = ?1 AND status = 'open'
        "#,
        params![obligation_id, input_id, now],
    )?;
    if updated != 1 {
        anyhow::bail!("Return Obligation changed before Core Outcome committed");
    }
    let actor = ActorRef::System {
        component_id: "return-obligation-coordinator".to_string(),
    };
    append_domain_event(
        transaction,
        "return_obligation.satisfied_by_core_outcome",
        Some(camp_id),
        Some(("return_obligation", &obligation_id)),
        &actor,
        None,
        &json!({
            "conversationInputId": input_id,
            "stage": stage,
            "status": status,
            "reason": reason,
        }),
    )?;
    append_domain_event(
        transaction,
        "conversation_input.accepted",
        Some(camp_id),
        Some(("conversation_input", &input_id)),
        &actor,
        None,
        &json!({ "kind": "call_outcome", "sequence": sequence }),
    )?;
    Ok(Some(input_id))
}

pub fn allocate_conversation_input_sequence(
    transaction: &Transaction<'_>,
    conversation_id: &str,
    now: &str,
) -> Result<i64> {
    let sequence: i64 = transaction.query_row(
        "SELECT last_input_sequence + 1 FROM conversation WHERE id = ?1",
        [conversation_id],
        |row| row.get(0),
    )?;
    let updated = transaction.execute(
        r#"
        UPDATE conversation
        SET last_input_sequence = ?2, version = version + 1, updated_at = ?3
        WHERE id = ?1 AND last_input_sequence = ?2 - 1
        "#,
        params![conversation_id, sequence, now],
    )?;
    if updated != 1 {
        anyhow::bail!("Conversation Input sequence changed before allocation");
    }
    Ok(sequence)
}

pub fn cancel_turn_inputs_and_obligations(
    transaction: &Transaction<'_>,
    camp_turn_id: &str,
    now: &str,
) -> Result<TurnCancellationInputSummary> {
    let inputs_cancelled = transaction.execute(
        r#"
        UPDATE conversation_input
        SET status = 'cancelled', terminal_reason = 'cancelled_by_turn',
            terminal_at = ?2
        WHERE camp_turn_id = ?1 AND status = 'pending'
        "#,
        params![camp_turn_id, now],
    )?;
    let obligations_cancelled = transaction.execute(
        r#"
        UPDATE return_obligation
        SET status = 'cancelled_by_turn', cancelled_at = ?2
        WHERE camp_turn_id = ?1 AND status = 'open'
        "#,
        params![camp_turn_id, now],
    )?;
    Ok(TurnCancellationInputSummary {
        inputs_cancelled,
        obligations_cancelled,
    })
}

pub fn turn_has_pending_input_or_obligation(
    transaction: &Transaction<'_>,
    camp_turn_id: &str,
) -> Result<bool> {
    let count: i64 = transaction.query_row(
        r#"
        SELECT
            (SELECT COUNT(*) FROM conversation_input
             WHERE camp_turn_id = ?1 AND status = 'pending')
          + (SELECT COUNT(*) FROM return_obligation
             WHERE camp_turn_id = ?1 AND status = 'open')
        "#,
        [camp_turn_id],
        |row| row.get(0),
    )?;
    Ok(count != 0)
}

pub fn turn_has_failed_or_cancelled_input(
    transaction: &Transaction<'_>,
    camp_turn_id: &str,
) -> Result<(bool, bool)> {
    transaction
        .query_row(
            r#"
            SELECT
                EXISTS(
                    SELECT 1 FROM conversation_input
                    WHERE camp_turn_id = ?1 AND status = 'failed'
                ),
                EXISTS(
                    SELECT 1 FROM conversation_input
                    WHERE camp_turn_id = ?1 AND status = 'cancelled'
                      AND terminal_reason <> 'cancelled_by_turn'
                )
            "#,
            [camp_turn_id],
            |row| Ok((row.get::<_, bool>(0)?, row.get::<_, bool>(1)?)),
        )
        .map_err(Into::into)
}
