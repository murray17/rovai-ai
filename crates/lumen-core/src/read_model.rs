use std::collections::BTreeSet;

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::Serialize;
use serde_json::Value;

use crate::db::Database;

pub const READ_MODEL_SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampListItem {
    pub id: String,
    pub title: String,
    pub project_path: String,
    pub status: String,
    pub default_lead_agent_id: Option<String>,
    pub active_member_count: i64,
    pub open_task_count: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampView {
    pub id: String,
    pub title: String,
    pub project_path: String,
    pub repository_scope_id: Option<String>,
    pub repository_object_format: Option<String>,
    pub default_lead_agent_id: Option<String>,
    pub status: String,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampMemberView {
    pub agent_profile_id: String,
    pub handle: String,
    pub display_name: String,
    pub role_title: String,
    pub accent: String,
    pub membership_status: String,
    pub profile_status: String,
    pub member_order: i64,
    pub is_default_lead: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    pub id: String,
    pub title: String,
    pub objective: String,
    pub acceptance_criteria: Value,
    pub status: String,
    pub readiness: Option<String>,
    pub blockers: Vec<String>,
    pub assignee_agent_id: Option<String>,
    pub generation: i64,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampMessageView {
    pub id: String,
    pub sequence: i64,
    pub author_type: String,
    pub author_id: String,
    pub source_agent_run_id: Option<String>,
    pub body: String,
    pub address_mode: String,
    pub addressed_agent_profile_ids: Value,
    pub reply_to_camp_message_id: Option<String>,
    pub camp_turn_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampTurnView {
    pub id: String,
    pub trigger_type: String,
    pub trigger_id: String,
    pub status: String,
    pub cancel_requested_at: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunView {
    pub id: String,
    pub camp_turn_id: String,
    pub conversation_id: String,
    pub agent_profile_id: String,
    pub task_id: Option<String>,
    pub responsibility_key: String,
    pub responsibility_generation: i64,
    pub purpose: String,
    pub expected_output: String,
    pub completion_role: String,
    pub status: String,
    pub wait_reason: Option<String>,
    pub execution_epoch: i64,
    pub workspace: Option<Value>,
    pub version: i64,
    pub created_at: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionView {
    pub id: String,
    pub agent_run_id: String,
    pub action_kind: String,
    pub action_summary: String,
    pub control_mode: String,
    pub policy_decision: String,
    pub status: String,
    pub action_digest: String,
    pub effect_disposition: Option<String>,
    pub not_executed_reason: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalView {
    pub id: String,
    pub action_id: String,
    pub action_kind: String,
    pub action_summary: String,
    pub canonical_input: Value,
    pub status: String,
    pub requested_for_user_id: String,
    pub version: i64,
    pub requested_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainEventView {
    pub global_sequence: i64,
    pub event_id: Option<String>,
    pub event_type: String,
    pub camp_id: Option<String>,
    pub entity_type: Option<String>,
    pub entity_id: Option<String>,
    pub actor_type: Option<String>,
    pub actor_id: Option<String>,
    pub source_agent_run_id: Option<String>,
    pub execution_epoch: Option<i64>,
    pub payload: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampSnapshot {
    pub schema_version: i64,
    pub through_global_sequence: i64,
    pub camp: CampView,
    pub members: Vec<CampMemberView>,
    pub tasks: Vec<TaskView>,
    pub messages: Vec<CampMessageView>,
    pub turns: Vec<CampTurnView>,
    pub agent_runs: Vec<AgentRunView>,
    pub approvals: Vec<ApprovalView>,
    pub actions: Vec<ActionView>,
    pub timeline: Vec<DomainEventView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventBatch {
    pub schema_version: i64,
    pub requested_after_global_sequence: i64,
    pub next_global_sequence: i64,
    pub through_global_sequence: i64,
    pub reset_required: bool,
    pub has_more: bool,
    pub events: Vec<DomainEventView>,
}

#[derive(Debug, Default)]
pub struct ReadModelService;

impl ReadModelService {
    pub fn list_camps(&self, database: &Database) -> Result<Vec<CampListItem>> {
        let mut statement = database.connection().prepare(
            r#"
            SELECT camp.id, camp.title, camp.project_path, camp.status,
                   camp.default_lead_agent_id,
                   (SELECT COUNT(*) FROM camp_member
                    JOIN agent_profile ON agent_profile.id = camp_member.agent_profile_id
                    WHERE camp_member.camp_id = camp.id
                      AND camp_member.status = 'active'
                      AND camp_member.leave_requested_at IS NULL
                      AND agent_profile.profile_status = 'active'),
                   (SELECT COUNT(*) FROM task
                    WHERE task.camp_id = camp.id
                      AND task.status NOT IN ('completed', 'cancelled')),
                   camp.updated_at
            FROM camp
            ORDER BY camp.updated_at DESC, camp.id
            "#,
        )?;
        statement
            .query_map([], |row| {
                Ok(CampListItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    project_path: row.get(2)?,
                    status: row.get(3)?,
                    default_lead_agent_id: row.get(4)?,
                    active_member_count: row.get(5)?,
                    open_task_count: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to list Camp read models")
    }

    pub fn camp_snapshot(&self, database: &mut Database, camp_id: &str) -> Result<CampSnapshot> {
        let transaction = database.connection_mut().transaction()?;
        let through_global_sequence = current_global_sequence(&transaction)?;
        let camp = load_camp(&transaction, camp_id)?.context("Camp does not exist")?;
        let members = load_members(&transaction, camp_id, camp.default_lead_agent_id.as_deref())?;
        let tasks = load_tasks(&transaction, camp_id)?;
        let messages = load_messages(&transaction, camp_id, 1_000)?;
        let turns = load_turns(&transaction, camp_id)?;
        let agent_runs = load_agent_runs(&transaction, camp_id)?;
        let approvals = load_approvals(&transaction, camp_id)?;
        let actions = load_actions(&transaction, camp_id)?;
        let timeline = load_events(
            &transaction,
            Some(camp_id),
            0,
            through_global_sequence,
            500,
            true,
        )?;
        transaction.commit()?;
        Ok(CampSnapshot {
            schema_version: READ_MODEL_SCHEMA_VERSION,
            through_global_sequence,
            camp,
            members,
            tasks,
            messages,
            turns,
            agent_runs,
            approvals,
            actions,
            timeline,
        })
    }

    pub fn events_since(
        &self,
        database: &mut Database,
        camp_id: Option<&str>,
        after_global_sequence: i64,
        limit: i64,
    ) -> Result<EventBatch> {
        if after_global_sequence < 0 {
            anyhow::bail!("Event cursor must not be negative");
        }
        let limit = limit.clamp(1, 2_000);
        let transaction = database.connection_mut().transaction()?;
        let through_global_sequence = current_global_sequence(&transaction)?;
        let oldest = transaction
            .query_row(
                "SELECT MIN(global_sequence) FROM event_log WHERE global_sequence IS NOT NULL",
                [],
                |row| row.get::<_, Option<i64>>(0),
            )?
            .unwrap_or(through_global_sequence + 1);
        let reset_required = after_global_sequence > through_global_sequence
            || (after_global_sequence > 0 && after_global_sequence < oldest - 1);
        let events = if reset_required {
            Vec::new()
        } else {
            load_events(
                &transaction,
                camp_id,
                after_global_sequence,
                through_global_sequence,
                limit + 1,
                false,
            )?
        };
        let has_more = events.len() > limit as usize;
        let mut events = events;
        if has_more {
            events.truncate(limit as usize);
        }
        let next_global_sequence = if has_more {
            events
                .last()
                .map_or(after_global_sequence, |event| event.global_sequence)
        } else {
            through_global_sequence
        };
        transaction.commit()?;
        Ok(EventBatch {
            schema_version: READ_MODEL_SCHEMA_VERSION,
            requested_after_global_sequence: after_global_sequence,
            next_global_sequence,
            through_global_sequence,
            reset_required,
            has_more,
            events,
        })
    }
}

fn current_global_sequence(transaction: &Transaction<'_>) -> Result<i64> {
    transaction
        .query_row(
            "SELECT last_sequence FROM event_sequence WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .context("failed to capture global event sequence")
}

fn load_camp(transaction: &Transaction<'_>, camp_id: &str) -> Result<Option<CampView>> {
    transaction
        .query_row(
            r#"
            SELECT id, title, project_path, repository_scope_id,
                   repository_object_format, default_lead_agent_id,
                   status, version, created_at, updated_at
            FROM camp WHERE id = ?1
            "#,
            [camp_id],
            |row| {
                Ok(CampView {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    project_path: row.get(2)?,
                    repository_scope_id: row.get(3)?,
                    repository_object_format: row.get(4)?,
                    default_lead_agent_id: row.get(5)?,
                    status: row.get(6)?,
                    version: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .optional()
        .context("failed to load Camp read model")
}

fn load_members(
    transaction: &Transaction<'_>,
    camp_id: &str,
    default_lead: Option<&str>,
) -> Result<Vec<CampMemberView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT camp_member.agent_profile_id, agent_profile.slug,
               agent_profile.display_name, agent_profile.role_title,
               agent_profile.accent, camp_member.status,
               agent_profile.profile_status, agent_profile.member_order
        FROM camp_member
        JOIN agent_profile ON agent_profile.id = camp_member.agent_profile_id
        WHERE camp_member.camp_id = ?1
        ORDER BY agent_profile.member_order, camp_member.agent_profile_id
        "#,
    )?;
    statement
        .query_map([camp_id], |row| {
            let agent_profile_id: String = row.get(0)?;
            Ok(CampMemberView {
                is_default_lead: default_lead == Some(agent_profile_id.as_str()),
                agent_profile_id,
                handle: row.get(1)?,
                display_name: row.get(2)?,
                role_title: row.get(3)?,
                accent: row.get(4)?,
                membership_status: row.get(5)?,
                profile_status: row.get(6)?,
                member_order: row.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to load Camp members")
}

fn load_tasks(transaction: &Transaction<'_>, camp_id: &str) -> Result<Vec<TaskView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, title, objective, acceptance_criteria_json,
               status, assignee_agent_id, generation, version,
               created_at, updated_at, closed_at
        FROM task
        WHERE camp_id = ?1
        ORDER BY created_at DESC, id
        "#,
    )?;
    let rows = statement.query_map([camp_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, String>(8)?,
            row.get::<_, String>(9)?,
            row.get::<_, Option<String>>(10)?,
        ))
    })?;
    let mut result = Vec::new();
    for row in rows {
        let (
            id,
            title,
            objective,
            criteria,
            status,
            assignee,
            generation,
            version,
            created_at,
            updated_at,
            closed_at,
        ) = row?;
        let status = normalize_task_status(&status).to_string();
        let blockers = task_blockers(transaction, &id, &status, assignee.as_deref())?;
        let readiness = if matches!(status.as_str(), "completed" | "cancelled") {
            None
        } else if blockers.is_empty() {
            Some("ready".to_string())
        } else {
            Some("blocked".to_string())
        };
        result.push(TaskView {
            id,
            title,
            objective,
            acceptance_criteria: serde_json::from_str(&criteria)
                .context("Task Acceptance Criteria are invalid")?,
            status,
            readiness,
            blockers,
            assignee_agent_id: assignee,
            generation,
            version,
            created_at,
            updated_at,
            closed_at,
        });
    }
    Ok(result)
}

fn normalize_task_status(status: &str) -> &str {
    match status {
        "draft" | "preparing" => "pending",
        "running" | "waiting_approval" | "recovering" | "interrupted" | "failed" => "in_progress",
        value => value,
    }
}

fn task_blockers(
    transaction: &Transaction<'_>,
    task_id: &str,
    status: &str,
    assignee: Option<&str>,
) -> Result<Vec<String>> {
    if matches!(status, "completed" | "cancelled") {
        return Ok(Vec::new());
    }
    let mut blockers = BTreeSet::new();
    if assignee.is_none() {
        blockers.insert("unassigned".to_string());
    }
    let dependency_states = {
        let mut statement = transaction.prepare(
            r#"
            SELECT dependency.status
            FROM task_dependency
            JOIN task AS dependency ON dependency.id = task_dependency.depends_on_task_id
            WHERE task_dependency.task_id = ?1
            "#,
        )?;
        statement
            .query_map([task_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for dependency_status in dependency_states {
        blockers.insert(
            if dependency_status == "cancelled" {
                "dependency_cancelled"
            } else if dependency_status != "completed" {
                "dependency_not_completed"
            } else {
                continue;
            }
            .to_string(),
        );
    }
    let approval_pending: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*) FROM approval
        JOIN action_execution ON action_execution.id = approval.action_id
        JOIN agent_run ON agent_run.id = action_execution.agent_run_id
        WHERE agent_run.task_id = ?1 AND approval.status = 'pending'
        "#,
        [task_id],
        |row| row.get(0),
    )?;
    if approval_pending != 0 {
        blockers.insert("approval_pending".to_string());
    }
    let unknown_effect: i64 = transaction.query_row(
        r#"
        SELECT COUNT(*) FROM action_execution
        JOIN agent_run ON agent_run.id = action_execution.agent_run_id
        WHERE agent_run.task_id = ?1 AND action_execution.status = 'unknown'
          AND action_execution.unknown_disposition = 'active'
        "#,
        [task_id],
        |row| row.get(0),
    )?;
    if unknown_effect != 0 {
        blockers.insert("unknown_action_outcome".to_string());
    }
    Ok(blockers.into_iter().collect())
}

fn load_messages(
    transaction: &Transaction<'_>,
    camp_id: &str,
    limit: i64,
) -> Result<Vec<CampMessageView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, sequence, author_type, author_id,
               source_agent_run_id, body, address_mode,
               addressed_agent_profile_ids_json,
               reply_to_camp_message_id, camp_turn_id, created_at
        FROM camp_message
        WHERE camp_id = ?1 AND tombstoned_at IS NULL
        ORDER BY sequence DESC LIMIT ?2
        "#,
    )?;
    let mut messages = statement
        .query_map(params![camp_id, limit], |row| {
            let addressed: String = row.get(7)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                addressed,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, String>(10)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .map(
            |(
                id,
                sequence,
                author_type,
                author_id,
                source_agent_run_id,
                body,
                address_mode,
                addressed,
                reply_to_camp_message_id,
                camp_turn_id,
                created_at,
            )| {
                Ok(CampMessageView {
                    id,
                    sequence,
                    author_type,
                    author_id,
                    source_agent_run_id,
                    body,
                    address_mode,
                    addressed_agent_profile_ids: serde_json::from_str(&addressed)?,
                    reply_to_camp_message_id,
                    camp_turn_id,
                    created_at,
                })
            },
        )
        .collect::<Result<Vec<_>>>()?;
    messages.reverse();
    Ok(messages)
}

fn load_turns(transaction: &Transaction<'_>, camp_id: &str) -> Result<Vec<CampTurnView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, trigger_type, trigger_id, status,
               cancel_requested_at, version, created_at, updated_at, ended_at
        FROM camp_turn WHERE camp_id = ?1
        ORDER BY created_at DESC, id
        "#,
    )?;
    statement
        .query_map([camp_id], |row| {
            Ok(CampTurnView {
                id: row.get(0)?,
                trigger_type: row.get(1)?,
                trigger_id: row.get(2)?,
                status: row.get(3)?,
                cancel_requested_at: row.get(4)?,
                version: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                ended_at: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to load CampTurns")
}

fn load_agent_runs(transaction: &Transaction<'_>, camp_id: &str) -> Result<Vec<AgentRunView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT agent_run.id, agent_run.camp_turn_id,
               agent_run.conversation_id, conversation.agent_profile_id,
               agent_run.task_id, agent_run.responsibility_key,
               agent_run.responsibility_generation, agent_run.purpose,
               agent_run.expected_output, agent_run.completion_role,
               agent_run.status, agent_run.wait_reason,
               agent_run.execution_epoch, agent_run.workspace_json,
               agent_run.version, agent_run.created_at,
               agent_run.started_at, agent_run.ended_at, agent_run.updated_at
        FROM agent_run
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        JOIN conversation ON conversation.id = agent_run.conversation_id
        WHERE camp_turn.camp_id = ?1
        ORDER BY agent_run.created_at DESC, agent_run.id
        "#,
    )?;
    let rows = statement
        .query_map([camp_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, i64>(12)?,
                row.get::<_, Option<String>>(13)?,
                row.get::<_, i64>(14)?,
                row.get::<_, String>(15)?,
                row.get::<_, Option<String>>(16)?,
                row.get::<_, Option<String>>(17)?,
                row.get::<_, String>(18)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(
            |(
                id,
                camp_turn_id,
                conversation_id,
                agent_profile_id,
                task_id,
                responsibility_key,
                responsibility_generation,
                purpose,
                expected_output,
                completion_role,
                status,
                wait_reason,
                execution_epoch,
                workspace,
                version,
                created_at,
                started_at,
                ended_at,
                updated_at,
            )| {
                Ok(AgentRunView {
                    id,
                    camp_turn_id,
                    conversation_id,
                    agent_profile_id,
                    task_id,
                    responsibility_key,
                    responsibility_generation,
                    purpose,
                    expected_output,
                    completion_role,
                    status,
                    wait_reason,
                    execution_epoch,
                    workspace: workspace
                        .map(|value| serde_json::from_str(&value))
                        .transpose()?,
                    version,
                    created_at,
                    started_at,
                    ended_at,
                    updated_at,
                })
            },
        )
        .collect()
}

fn load_approvals(transaction: &Transaction<'_>, camp_id: &str) -> Result<Vec<ApprovalView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT approval.id, approval.action_id, approval.action_kind,
               approval.action_summary, approval.status,
               approval.requested_for_user_id, approval.version,
               approval.requested_at, approval.resolved_at,
               approval.request_json
        FROM approval
        JOIN action_execution ON action_execution.id = approval.action_id
        JOIN agent_run ON agent_run.id = action_execution.agent_run_id
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        WHERE camp_turn.camp_id = ?1
        ORDER BY approval.requested_at DESC, approval.id
        "#,
    )?;
    statement
        .query_map([camp_id], |row| {
            let canonical_input_json = row.get::<_, String>(9)?;
            let canonical_input = serde_json::from_str(&canonical_input_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    9,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(ApprovalView {
                id: row.get(0)?,
                action_id: row.get(1)?,
                action_kind: row.get(2)?,
                action_summary: row.get(3)?,
                canonical_input,
                status: row.get(4)?,
                requested_for_user_id: row.get(5)?,
                version: row.get(6)?,
                requested_at: row.get(7)?,
                resolved_at: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to load Action Approvals")
}

fn load_actions(transaction: &Transaction<'_>, camp_id: &str) -> Result<Vec<ActionView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT action_execution.id, action_execution.agent_run_id,
               action_execution.action_kind, action_execution.action_summary,
               action_execution.control_mode, action_execution.policy_decision,
               action_execution.status, action_execution.action_digest,
               action_execution.effect_disposition,
               action_execution.not_executed_reason,
               action_execution.version, action_execution.created_at,
               action_execution.updated_at
        FROM action_execution
        JOIN agent_run ON agent_run.id = action_execution.agent_run_id
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        WHERE camp_turn.camp_id = ?1
        ORDER BY action_execution.created_at DESC, action_execution.id
        "#,
    )?;
    statement
        .query_map([camp_id], |row| {
            Ok(ActionView {
                id: row.get(0)?,
                agent_run_id: row.get(1)?,
                action_kind: row.get(2)?,
                action_summary: row.get(3)?,
                control_mode: row.get(4)?,
                policy_decision: row.get(5)?,
                status: row.get(6)?,
                action_digest: row.get(7)?,
                effect_disposition: row.get(8)?,
                not_executed_reason: row.get(9)?,
                version: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to load Actions")
}

fn load_events(
    transaction: &Transaction<'_>,
    camp_id: Option<&str>,
    after: i64,
    through: i64,
    limit: i64,
    newest_first_window: bool,
) -> Result<Vec<DomainEventView>> {
    let order = if newest_first_window { "DESC" } else { "ASC" };
    let sql = format!(
        r#"
        SELECT event_log.global_sequence, event_log.event_id,
               event_log.event_type, event_log.camp_id,
               event_log.entity_type, event_log.entity_id,
               event_log.actor_type, event_log.actor_id,
               event_log.source_agent_run_id, event_log.execution_epoch,
               event_log.payload_json, event_log.created_at
        FROM event_log
        LEFT JOIN task ON task.id = event_log.task_id
        WHERE event_log.global_sequence > ?1
          AND event_log.global_sequence <= ?2
          AND (?3 IS NULL
               OR event_log.camp_id = ?3
               OR (event_log.camp_id IS NULL AND task.camp_id = ?3))
        ORDER BY event_log.global_sequence {order}
        LIMIT ?4
        "#,
    );
    let mut statement = transaction.prepare(&sql)?;
    let rows = statement
        .query_map(params![after, through, camp_id, limit], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut events = rows
        .into_iter()
        .map(
            |(
                global_sequence,
                event_id,
                event_type,
                camp_id,
                entity_type,
                entity_id,
                actor_type,
                actor_id,
                source_agent_run_id,
                execution_epoch,
                payload,
                created_at,
            )| {
                Ok(DomainEventView {
                    global_sequence,
                    event_id,
                    event_type,
                    camp_id,
                    entity_type,
                    entity_id,
                    actor_type,
                    actor_id,
                    source_agent_run_id,
                    execution_epoch,
                    payload: serde_json::from_str(&payload)?,
                    created_at,
                })
            },
        )
        .collect::<Result<Vec<_>>>()?;
    if newest_first_window {
        events.reverse();
    }
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        collaboration::{
            AddCampMemberCommand, CollaborationService, CreateCampCommand, MessageAddressSpec,
            SendCampMessageCommand,
        },
        command::{ActorRef, CommandEnvelope},
    };
    use serde_json::json;
    use uuid::Uuid;

    fn user_envelope<P>(command_id: &str, camp_id: Option<&str>, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: "local-user".to_string(),
            },
            camp_id: camp_id.map(str::to_string),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    #[test]
    fn legacy_project_writes_are_immediately_visible_as_a_camp_snapshot() {
        let directory =
            std::env::temp_dir().join(format!("lumen-read-compat-test-{}", Uuid::new_v4()));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(workspace.join(".git")).unwrap();
        let mut database = Database::open(&directory).unwrap();
        let project = database
            .upsert_project(&workspace, &workspace.join(".git"))
            .unwrap();
        database
            .insert_task(
                "legacy-task",
                &project.id,
                "兼容任务",
                "新建后立即进入 Camp",
                &workspace,
                "main",
                "abc123",
            )
            .unwrap();

        let read_model = ReadModelService;
        let camps = read_model.list_camps(&database).unwrap();
        let camp = camps
            .iter()
            .find(|camp| camp.project_path == workspace.to_string_lossy())
            .expect("legacy Project should materialize a Camp in the same transaction");
        let snapshot = read_model.camp_snapshot(&mut database, &camp.id).unwrap();
        assert_eq!(snapshot.members.len(), 4);
        assert_eq!(
            snapshot.camp.default_lead_agent_id.as_deref(),
            Some("agent-luoke")
        );
        assert_eq!(snapshot.tasks.len(), 1);
        assert_eq!(snapshot.tasks[0].objective, "新建后立即进入 Camp");
        assert_eq!(snapshot.tasks[0].status, "pending");
        assert_eq!(snapshot.tasks[0].readiness.as_deref(), Some("ready"));

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn snapshot_cursor_and_incremental_events_have_no_lost_window() {
        let directory =
            std::env::temp_dir().join(format!("lumen-read-model-test-{}", Uuid::new_v4()));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        let camp = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "read-create-camp",
                    None,
                    CreateCampCommand {
                        project_path: workspace.to_string_lossy().to_string(),
                        repository: None,
                    },
                ),
            )
            .unwrap();
        let camp_id = camp.result.payload["campId"].as_str().unwrap().to_string();
        collaboration
            .add_camp_member(
                &mut database,
                &user_envelope(
                    "read-add-member",
                    Some(&camp_id),
                    AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_profile_id: "agent-muwa".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        collaboration
            .send_camp_message(
                &mut database,
                &user_envelope(
                    "read-first-message",
                    Some(&camp_id),
                    SendCampMessageCommand {
                        camp_id: camp_id.clone(),
                        body: "快照内消息".to_string(),
                        address: MessageAddressSpec::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        let read_model = ReadModelService;
        let snapshot = read_model.camp_snapshot(&mut database, &camp_id).unwrap();
        assert_eq!(snapshot.schema_version, READ_MODEL_SCHEMA_VERSION);
        assert_eq!(snapshot.messages.len(), 1);
        assert!(
            snapshot
                .timeline
                .iter()
                .all(|event| event.global_sequence <= snapshot.through_global_sequence)
        );

        collaboration
            .send_camp_message(
                &mut database,
                &user_envelope(
                    "read-after-snapshot",
                    Some(&camp_id),
                    SendCampMessageCommand {
                        camp_id: camp_id.clone(),
                        body: "快照后消息".to_string(),
                        address: MessageAddressSpec::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        let first_batch = read_model
            .events_since(
                &mut database,
                Some(&camp_id),
                snapshot.through_global_sequence,
                100,
            )
            .unwrap();
        assert!(!first_batch.reset_required);
        assert!(!first_batch.events.is_empty());
        assert!(first_batch.events.iter().all(|event| {
            event.global_sequence > snapshot.through_global_sequence
                && event.global_sequence <= first_batch.through_global_sequence
        }));
        let replay = read_model
            .events_since(
                &mut database,
                Some(&camp_id),
                snapshot.through_global_sequence,
                100,
            )
            .unwrap();
        assert_eq!(
            first_batch
                .events
                .iter()
                .map(|event| event.global_sequence)
                .collect::<Vec<_>>(),
            replay
                .events
                .iter()
                .map(|event| event.global_sequence)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            first_batch.next_global_sequence,
            first_batch.through_global_sequence
        );
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn event_reader_requests_snapshot_after_retention_gap() {
        let directory =
            std::env::temp_dir().join(format!("lumen-read-gap-test-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        for sequence in 0..6 {
            database
                .connection()
                .execute(
                    r#"
                    INSERT INTO event_log(
                        event_id, event_type, payload_json, actor_type,
                        actor_id, created_at
                    ) VALUES (?1, 'test.event', '{}', 'system', 'test', ?2)
                    "#,
                    params![
                        format!("gap-event-{sequence}"),
                        chrono::Utc::now().to_rfc3339(),
                    ],
                )
                .unwrap();
        }
        database
            .connection()
            .execute("DELETE FROM event_log WHERE global_sequence <= 4", [])
            .unwrap();
        let batch = ReadModelService
            .events_since(&mut database, None, 1, 100)
            .unwrap();
        assert!(batch.reset_required);
        assert!(batch.events.is_empty());
        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
