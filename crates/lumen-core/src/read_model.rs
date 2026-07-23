use std::{cmp::Ordering, collections::BTreeMap, path::Path};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::Database;

pub const READ_MODEL_SCHEMA_VERSION: i64 = 2;
pub const NAVIGATION_SCHEMA_VERSION: i64 = 1;
pub const NAVIGATION_RECENT_CAMP_LIMIT: usize = 5;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationLeadSummary {
    pub agent_profile_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationCampItem {
    pub id: String,
    pub title: String,
    pub project_path: String,
    pub repository_scope_id: Option<String>,
    pub repository_git_common_dir: Option<String>,
    pub repository_object_format: Option<String>,
    pub default_lead: Option<NavigationLeadSummary>,
    pub marker: String,
    pub last_activity_at: String,
    pub last_activity_global_sequence: i64,
    pub latest_completion_global_sequence: i64,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationCampGroup {
    pub total_count: usize,
    pub recent_camps: Vec<NavigationCampItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNavigationGroup {
    pub repository_scope_id: String,
    pub name: String,
    pub project_path: String,
    pub git_common_dir: String,
    pub object_format: String,
    pub last_activity_at: String,
    pub last_activity_global_sequence: i64,
    pub total_count: usize,
    pub recent_camps: Vec<NavigationCampItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationSnapshot {
    pub schema_version: i64,
    pub through_global_sequence: i64,
    pub lobby: NavigationCampGroup,
    pub projects: Vec<ProjectNavigationGroup>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationCampPage {
    pub schema_version: i64,
    pub through_global_sequence: i64,
    pub repository_scope_id: Option<String>,
    pub total_count: usize,
    pub next_offset: Option<usize>,
    pub camps: Vec<NavigationCampItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampViewedAcknowledgement {
    pub camp_id: String,
    pub last_seen_global_sequence: i64,
}

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
    pub description: String,
    pub status: String,
    pub assignee_agent_id: Option<String>,
    pub created_by_type: String,
    pub created_by_id: String,
    pub source_agent_run_id: Option<String>,
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
    pub invocation_kind: String,
    pub a2a_parent_agent_run_id: Option<String>,
    pub a2a_root_agent_run_id: Option<String>,
    pub a2a_depth: i64,
    pub source_inbox_message_id: Option<String>,
    pub workspace: Option<Value>,
    pub version: i64,
    pub created_at: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxMessageView {
    pub id: String,
    pub sender_agent_id: String,
    pub recipient_agent_id: String,
    pub body: String,
    pub source_agent_run_id: Option<String>,
    pub target_agent_run_id: Option<String>,
    pub in_reply_to_message_id: Option<String>,
    pub correlation_id: String,
    pub recipient_message_id: Option<String>,
    pub delivered_at: Option<String>,
    pub failed_at: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSummaryView {
    pub id: String,
    pub summary_kind: String,
    pub from_camp_message_sequence: i64,
    pub through_camp_message_sequence: i64,
    pub generator_adapter_kind: String,
    pub generator_model: Value,
    pub generator_version: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextAttachmentMetadataView {
    pub attachment_id: String,
    pub name: String,
    pub media_type: String,
    pub byte_size: i64,
    pub location_ref: String,
    pub content_digest: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInputDeliveryView {
    pub id: String,
    pub execution_epoch: i64,
    pub status: String,
    pub native_input_id: Option<String>,
    pub boundary_camp_message_sequence: i64,
    pub prepared_at: String,
    pub accepted_at: Option<String>,
    pub resolved_at: Option<String>,
    pub last_error: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextManifestView {
    pub id: String,
    pub agent_run_id: String,
    pub native_binding_generation: i64,
    pub camp_message_boundary_sequence: i64,
    pub conversation_message_boundary_sequence: i64,
    pub context_mode: Option<String>,
    pub raw_message_count: usize,
    pub summaries: Vec<ContextSummaryView>,
    pub attachments: Vec<ContextAttachmentMetadataView>,
    pub work_brief_digest: String,
    pub charter_digest: String,
    pub member_state_digest: String,
    pub formatter_version: i64,
    pub rendered_payload_digest: String,
    pub delivery: Option<RuntimeInputDeliveryView>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextCompactionView {
    pub id: String,
    pub agent_run_id: String,
    pub summary_kind: String,
    pub from_camp_message_sequence: i64,
    pub through_camp_message_sequence: i64,
    pub adapter_kind: String,
    pub model: Value,
    pub status: String,
    pub generated_summary_id: Option<String>,
    pub error_code: Option<String>,
    pub created_at: String,
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
    pub inbox_messages: Vec<InboxMessageView>,
    pub context_manifests: Vec<ContextManifestView>,
    pub context_compactions: Vec<ContextCompactionView>,
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

    pub fn navigation_snapshot(&self, database: &mut Database) -> Result<NavigationSnapshot> {
        let transaction = database.connection_mut().transaction()?;
        let through_global_sequence = current_global_sequence(&transaction)?;
        let camps = load_navigation_camps(&transaction)?;
        let (lobby, projects) = group_navigation_camps(camps);
        transaction.commit()?;
        Ok(NavigationSnapshot {
            schema_version: NAVIGATION_SCHEMA_VERSION,
            through_global_sequence,
            lobby,
            projects,
        })
    }

    pub fn navigation_group_camps(
        &self,
        database: &mut Database,
        repository_scope_id: Option<&str>,
        offset: usize,
        limit: usize,
    ) -> Result<NavigationCampPage> {
        let limit = limit.clamp(1, 200);
        let transaction = database.connection_mut().transaction()?;
        let through_global_sequence = current_global_sequence(&transaction)?;
        let camps = load_navigation_camps(&transaction)?
            .into_iter()
            .filter(|camp| camp.repository_scope_id.as_deref() == repository_scope_id)
            .collect::<Vec<_>>();
        let total_count = camps.len();
        let start = offset.min(total_count);
        let end = start.saturating_add(limit).min(total_count);
        let next_offset = (end < total_count).then_some(end);
        let camps = camps[start..end].to_vec();
        transaction.commit()?;
        Ok(NavigationCampPage {
            schema_version: NAVIGATION_SCHEMA_VERSION,
            through_global_sequence,
            repository_scope_id: repository_scope_id.map(str::to_string),
            total_count,
            next_offset,
            camps,
        })
    }

    pub fn acknowledge_camp_viewed(
        &self,
        database: &mut Database,
        camp_id: &str,
        through_global_sequence: i64,
    ) -> Result<CampViewedAcknowledgement> {
        if through_global_sequence < 0 {
            anyhow::bail!("Viewed sequence must not be negative");
        }
        let transaction = database.connection_mut().transaction()?;
        let current = current_global_sequence(&transaction)?;
        if through_global_sequence > current {
            anyhow::bail!("Viewed sequence is ahead of the current event sequence");
        }
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM camp WHERE id = ?1 AND status = 'active')",
            [camp_id],
            |row| row.get(0),
        )?;
        if !exists {
            anyhow::bail!("Camp does not exist");
        }
        let now = chrono::Utc::now().to_rfc3339();
        transaction.execute(
            r#"
            INSERT INTO camp_view_state(camp_id, last_seen_global_sequence, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(camp_id) DO UPDATE SET
                last_seen_global_sequence = MAX(
                    camp_view_state.last_seen_global_sequence,
                    excluded.last_seen_global_sequence
                ),
                updated_at = CASE
                    WHEN excluded.last_seen_global_sequence
                       > camp_view_state.last_seen_global_sequence
                    THEN excluded.updated_at
                    ELSE camp_view_state.updated_at
                END
            "#,
            params![camp_id, through_global_sequence, now],
        )?;
        let last_seen_global_sequence = transaction.query_row(
            "SELECT last_seen_global_sequence FROM camp_view_state WHERE camp_id = ?1",
            [camp_id],
            |row| row.get(0),
        )?;
        transaction.commit()?;
        Ok(CampViewedAcknowledgement {
            camp_id: camp_id.to_string(),
            last_seen_global_sequence,
        })
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
        let inbox_messages = load_inbox_messages(&transaction, camp_id)?;
        let context_manifests = load_context_manifests(&transaction, camp_id)?;
        let context_compactions = load_context_compactions(&transaction, camp_id)?;
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
            inbox_messages,
            context_manifests,
            context_compactions,
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

fn load_navigation_camps(transaction: &Transaction<'_>) -> Result<Vec<NavigationCampItem>> {
    let mut statement = transaction.prepare(
        r#"
        WITH navigation_activity AS (
            SELECT
                event_log.camp_id,
                MAX(CASE
                    WHEN (
                        event_log.event_type = 'camp_message.sent'
                        AND camp_message.author_type IN ('user', 'agent')
                    ) OR event_log.event_type IN (
                        'agent_run.succeeded',
                        'agent_run.failed',
                        'agent_run.cancelled'
                    ) OR (
                        event_log.event_type = 'camp_turn.status_changed'
                        AND json_extract(event_log.payload_json, '$.status') = 'cancelled'
                    )
                    THEN event_log.global_sequence
                END) AS last_activity_sequence,
                MAX(CASE
                    WHEN event_log.event_type IN (
                        'agent_run.succeeded',
                        'agent_run.failed',
                        'agent_run.cancelled'
                    ) OR (
                        event_log.event_type = 'camp_turn.status_changed'
                        AND json_extract(event_log.payload_json, '$.status') = 'cancelled'
                    )
                    THEN event_log.global_sequence
                END) AS latest_completion_sequence
            FROM event_log
            LEFT JOIN camp_message
              ON event_log.entity_type = 'camp_message'
             AND camp_message.id = event_log.entity_id
            WHERE event_log.camp_id IS NOT NULL
              AND event_log.global_sequence IS NOT NULL
            GROUP BY event_log.camp_id
        )
        SELECT
            camp.id,
            camp.title,
            camp.project_path,
            camp.repository_scope_id,
            camp.repository_git_common_dir,
            camp.repository_object_format,
            lead.id,
            lead.display_name,
            COALESCE(navigation_activity.last_activity_sequence, 0),
            COALESCE(activity_event.created_at, camp.created_at),
            COALESCE(navigation_activity.latest_completion_sequence, 0),
            COALESCE(camp_view_state.last_seen_global_sequence, 0),
            EXISTS(
                SELECT 1
                FROM agent_run
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                WHERE camp_turn.camp_id = camp.id
                  AND agent_run.status IN ('queued', 'running', 'waiting')
            ),
            camp.version
        FROM camp
        LEFT JOIN agent_profile AS lead ON lead.id = camp.default_lead_agent_id
        LEFT JOIN navigation_activity ON navigation_activity.camp_id = camp.id
        LEFT JOIN event_log AS activity_event
          ON activity_event.global_sequence = navigation_activity.last_activity_sequence
        LEFT JOIN camp_view_state ON camp_view_state.camp_id = camp.id
        WHERE camp.status = 'active'
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        let default_lead_agent_id = row.get::<_, Option<String>>(6)?;
        let default_lead_display_name = row.get::<_, Option<String>>(7)?;
        let latest_completion_global_sequence = row.get::<_, i64>(10)?;
        let last_seen_global_sequence = row.get::<_, i64>(11)?;
        let loading = row.get::<_, bool>(12)?;
        let marker = if loading {
            "loading"
        } else if latest_completion_global_sequence > last_seen_global_sequence {
            "unread_completed"
        } else {
            "none"
        };
        Ok(NavigationCampItem {
            id: row.get(0)?,
            title: row.get(1)?,
            project_path: row.get(2)?,
            repository_scope_id: row.get(3)?,
            repository_git_common_dir: row.get(4)?,
            repository_object_format: row.get(5)?,
            default_lead: default_lead_agent_id.map(|agent_profile_id| NavigationLeadSummary {
                agent_profile_id,
                display_name: default_lead_display_name.unwrap_or_default(),
            }),
            marker: marker.to_string(),
            last_activity_at: row.get(9)?,
            last_activity_global_sequence: row.get(8)?,
            latest_completion_global_sequence,
            version: row.get(13)?,
        })
    })?;
    let mut camps = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    camps.sort_by(compare_navigation_camps);
    Ok(camps)
}

fn compare_navigation_camps(left: &NavigationCampItem, right: &NavigationCampItem) -> Ordering {
    right
        .last_activity_at
        .cmp(&left.last_activity_at)
        .then_with(|| {
            right
                .last_activity_global_sequence
                .cmp(&left.last_activity_global_sequence)
        })
        .then_with(|| left.id.cmp(&right.id))
}

fn group_navigation_camps(
    camps: Vec<NavigationCampItem>,
) -> (NavigationCampGroup, Vec<ProjectNavigationGroup>) {
    let mut lobby_camps = Vec::new();
    let mut project_camps = BTreeMap::<String, Vec<NavigationCampItem>>::new();
    for camp in camps {
        if let Some(repository_scope_id) = &camp.repository_scope_id {
            project_camps
                .entry(repository_scope_id.clone())
                .or_default()
                .push(camp);
        } else {
            lobby_camps.push(camp);
        }
    }
    lobby_camps.sort_by(compare_navigation_camps);
    let lobby = NavigationCampGroup {
        total_count: lobby_camps.len(),
        recent_camps: lobby_camps
            .into_iter()
            .take(NAVIGATION_RECENT_CAMP_LIMIT)
            .collect(),
    };

    let mut projects = project_camps
        .into_iter()
        .filter_map(|(repository_scope_id, mut camps)| {
            camps.sort_by(compare_navigation_camps);
            let representative = camps.first()?.clone();
            let git_common_dir = representative.repository_git_common_dir.clone()?;
            let object_format = representative.repository_object_format.clone()?;
            Some(ProjectNavigationGroup {
                repository_scope_id,
                name: project_display_name(&representative.project_path, &git_common_dir),
                project_path: representative.project_path.clone(),
                git_common_dir,
                object_format,
                last_activity_at: representative.last_activity_at.clone(),
                last_activity_global_sequence: representative.last_activity_global_sequence,
                total_count: camps.len(),
                recent_camps: camps
                    .into_iter()
                    .take(NAVIGATION_RECENT_CAMP_LIMIT)
                    .collect(),
            })
        })
        .collect::<Vec<_>>();
    projects.sort_by(|left, right| {
        right
            .last_activity_at
            .cmp(&left.last_activity_at)
            .then_with(|| {
                right
                    .last_activity_global_sequence
                    .cmp(&left.last_activity_global_sequence)
            })
            .then_with(|| left.repository_scope_id.cmp(&right.repository_scope_id))
    });
    (lobby, projects)
}

fn project_display_name(project_path: &str, git_common_dir: &str) -> String {
    let git_common = Path::new(git_common_dir);
    let repository_root = if git_common.file_name().and_then(|value| value.to_str()) == Some(".git")
    {
        git_common.parent()
    } else {
        None
    };
    repository_root
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .or_else(|| {
            Path::new(project_path)
                .file_name()
                .and_then(|value| value.to_str())
        })
        .unwrap_or("Untitled Project")
        .to_string()
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
        SELECT id, title, description, status, assignee_agent_id,
               created_by_type, created_by_id, source_agent_run_id,
               version, created_at, updated_at, closed_at
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
            row.get::<_, Option<String>>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, i64>(8)?,
            row.get::<_, String>(9)?,
            row.get::<_, String>(10)?,
            row.get::<_, Option<String>>(11)?,
        ))
    })?;
    let mut result = Vec::new();
    for row in rows {
        let (
            id,
            title,
            description,
            status,
            assignee,
            created_by_type,
            created_by_id,
            source_agent_run_id,
            version,
            created_at,
            updated_at,
            closed_at,
        ) = row?;
        result.push(TaskView {
            id,
            title,
            description,
            status,
            assignee_agent_id: assignee,
            created_by_type,
            created_by_id,
            source_agent_run_id,
            version,
            created_at,
            updated_at,
            closed_at,
        });
    }
    Ok(result)
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
               agent_run.execution_epoch, agent_run.invocation_kind,
               agent_run.a2a_parent_agent_run_id,
               agent_run.a2a_root_agent_run_id, agent_run.a2a_depth,
               (SELECT inbox_message.id
                FROM inbox_message
                WHERE inbox_message.target_agent_run_id = agent_run.id),
               agent_run.workspace_json, agent_run.version,
               agent_run.created_at, agent_run.started_at,
               agent_run.ended_at, agent_run.updated_at
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
                row.get::<_, String>(13)?,
                row.get::<_, Option<String>>(14)?,
                row.get::<_, Option<String>>(15)?,
                row.get::<_, i64>(16)?,
                row.get::<_, Option<String>>(17)?,
                row.get::<_, Option<String>>(18)?,
                row.get::<_, i64>(19)?,
                row.get::<_, String>(20)?,
                row.get::<_, Option<String>>(21)?,
                row.get::<_, Option<String>>(22)?,
                row.get::<_, String>(23)?,
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
                invocation_kind,
                a2a_parent_agent_run_id,
                a2a_root_agent_run_id,
                a2a_depth,
                source_inbox_message_id,
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
                    invocation_kind,
                    a2a_parent_agent_run_id,
                    a2a_root_agent_run_id,
                    a2a_depth,
                    source_inbox_message_id,
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

fn load_inbox_messages(
    transaction: &Transaction<'_>,
    camp_id: &str,
) -> Result<Vec<InboxMessageView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, sender_agent_id, recipient_agent_id, body,
               source_agent_run_id, target_agent_run_id,
               in_reply_to_message_id, correlation_id,
               recipient_message_id, delivered_at, failed_at,
               last_error, created_at, updated_at
        FROM inbox_message
        WHERE camp_id = ?1
        ORDER BY created_at DESC, id
        "#,
    )?;
    statement
        .query_map([camp_id], |row| {
            Ok(InboxMessageView {
                id: row.get(0)?,
                sender_agent_id: row.get(1)?,
                recipient_agent_id: row.get(2)?,
                body: row.get(3)?,
                source_agent_run_id: row.get(4)?,
                target_agent_run_id: row.get(5)?,
                in_reply_to_message_id: row.get(6)?,
                correlation_id: row.get(7)?,
                recipient_message_id: row.get(8)?,
                delivered_at: row.get(9)?,
                failed_at: row.get(10)?,
                last_error: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to load InboxMessage read models")
}

fn load_context_manifests(
    transaction: &Transaction<'_>,
    camp_id: &str,
) -> Result<Vec<ContextManifestView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT context_manifest.id, context_manifest.agent_run_id,
               context_manifest.native_binding_generation,
               context_manifest.camp_message_boundary_sequence,
               context_manifest.conversation_message_boundary_sequence,
               context_manifest.raw_message_refs_json,
               context_manifest.context_summary_ids_json,
               context_manifest.attachment_metadata_json,
               context_manifest.control_signals_json,
               context_manifest.work_brief_digest,
               context_manifest.charter_digest,
               context_manifest.member_state_digest,
               context_manifest.formatter_version,
               context_manifest.rendered_payload_digest,
               context_manifest.created_at,
               runtime_input_delivery.id,
               runtime_input_delivery.execution_epoch,
               runtime_input_delivery.status,
               runtime_input_delivery.native_input_id,
               runtime_input_delivery.boundary_camp_message_sequence,
               runtime_input_delivery.prepared_at,
               runtime_input_delivery.accepted_at,
               runtime_input_delivery.resolved_at,
               runtime_input_delivery.last_error,
               runtime_input_delivery.updated_at
        FROM context_manifest
        JOIN agent_run ON agent_run.id = context_manifest.agent_run_id
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        LEFT JOIN runtime_input_delivery
          ON runtime_input_delivery.id = (
              SELECT delivery.id
              FROM runtime_input_delivery AS delivery
              WHERE delivery.context_manifest_id = context_manifest.id
              ORDER BY delivery.execution_epoch DESC,
                       delivery.prepared_at DESC, delivery.id DESC
              LIMIT 1
          )
        WHERE camp_turn.camp_id = ?1
        ORDER BY context_manifest.created_at DESC, context_manifest.id
        "#,
    )?;
    let rows = statement
        .query_map([camp_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, i64>(12)?,
                row.get::<_, String>(13)?,
                row.get::<_, String>(14)?,
                row.get::<_, Option<String>>(15)?,
                row.get::<_, Option<i64>>(16)?,
                row.get::<_, Option<String>>(17)?,
                row.get::<_, Option<String>>(18)?,
                row.get::<_, Option<i64>>(19)?,
                row.get::<_, Option<String>>(20)?,
                row.get::<_, Option<String>>(21)?,
                row.get::<_, Option<String>>(22)?,
                row.get::<_, Option<String>>(23)?,
                row.get::<_, Option<String>>(24)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(
            |(
                id,
                agent_run_id,
                native_binding_generation,
                camp_message_boundary_sequence,
                conversation_message_boundary_sequence,
                raw_message_refs,
                context_summary_ids,
                attachment_metadata,
                control_signals,
                work_brief_digest,
                charter_digest,
                member_state_digest,
                formatter_version,
                rendered_payload_digest,
                created_at,
                delivery_id,
                delivery_execution_epoch,
                delivery_status,
                native_input_id,
                delivery_boundary_sequence,
                prepared_at,
                accepted_at,
                resolved_at,
                last_error,
                delivery_updated_at,
            )| {
                let raw_message_refs = serde_json::from_str::<Vec<Value>>(&raw_message_refs)
                    .context("ContextManifest raw message references are invalid")?;
                let summary_ids = serde_json::from_str::<Vec<String>>(&context_summary_ids)
                    .context("ContextManifest Summary references are invalid")?;
                let attachments = serde_json::from_str::<Vec<ContextAttachmentMetadataView>>(
                    &attachment_metadata,
                )
                .context("ContextManifest attachment metadata is invalid")?;
                let control_signals = serde_json::from_str::<Value>(&control_signals)
                    .context("ContextManifest control signals are invalid")?;
                let delivery = delivery_id
                    .map(|delivery_id| {
                        Ok::<RuntimeInputDeliveryView, anyhow::Error>(RuntimeInputDeliveryView {
                            id: delivery_id,
                            execution_epoch: delivery_execution_epoch
                                .context("Context delivery has no execution epoch")?,
                            status: delivery_status.context("Context delivery has no status")?,
                            native_input_id,
                            boundary_camp_message_sequence: delivery_boundary_sequence
                                .context("Context delivery has no message boundary")?,
                            prepared_at: prepared_at
                                .context("Context delivery has no prepared time")?,
                            accepted_at,
                            resolved_at,
                            last_error,
                            updated_at: delivery_updated_at
                                .context("Context delivery has no updated time")?,
                        })
                    })
                    .transpose()?;
                Ok(ContextManifestView {
                    id,
                    agent_run_id: agent_run_id.clone(),
                    native_binding_generation,
                    camp_message_boundary_sequence,
                    conversation_message_boundary_sequence,
                    context_mode: control_signals
                        .get("contextMode")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    raw_message_count: raw_message_refs.len(),
                    summaries: load_context_summaries(transaction, &agent_run_id, &summary_ids)?,
                    attachments,
                    work_brief_digest,
                    charter_digest,
                    member_state_digest,
                    formatter_version,
                    rendered_payload_digest,
                    delivery,
                    created_at,
                })
            },
        )
        .collect()
}

fn load_context_summaries(
    transaction: &Transaction<'_>,
    agent_run_id: &str,
    summary_ids: &[String],
) -> Result<Vec<ContextSummaryView>> {
    summary_ids
        .iter()
        .map(|summary_id| {
            transaction
                .query_row(
                    r#"
                    SELECT context_summary.id, context_summary.summary_kind,
                           context_summary.from_camp_message_sequence,
                           context_summary.through_camp_message_sequence,
                           context_summary.generator_adapter_kind,
                           context_summary.generator_model_json,
                           context_summary.generator_version,
                           context_summary.created_at
                    FROM context_summary
                    WHERE context_summary.id = ?1
                      AND context_summary.conversation_id = (
                          SELECT conversation_id FROM agent_run WHERE id = ?2
                      )
                    "#,
                    params![summary_id, agent_run_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, String>(6)?,
                            row.get::<_, String>(7)?,
                        ))
                    },
                )
                .with_context(|| format!("Context Summary {summary_id} is unavailable"))
                .and_then(|row| {
                    Ok(ContextSummaryView {
                        id: row.0,
                        summary_kind: row.1,
                        from_camp_message_sequence: row.2,
                        through_camp_message_sequence: row.3,
                        generator_adapter_kind: row.4,
                        generator_model: serde_json::from_str(&row.5)
                            .context("Context Summary generator model is invalid")?,
                        generator_version: row.6,
                        created_at: row.7,
                    })
                })
        })
        .collect()
}

fn load_context_compactions(
    transaction: &Transaction<'_>,
    camp_id: &str,
) -> Result<Vec<ContextCompactionView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT context_compaction_attempt.id,
               context_compaction_attempt.agent_run_id,
               context_compaction_attempt.summary_kind,
               context_compaction_attempt.from_camp_message_sequence,
               context_compaction_attempt.through_camp_message_sequence,
               context_compaction_attempt.adapter_kind,
               context_compaction_attempt.model_json,
               context_compaction_attempt.status,
               context_compaction_attempt.generated_summary_id,
               context_compaction_attempt.error_code,
               context_compaction_attempt.created_at,
               context_compaction_attempt.updated_at
        FROM context_compaction_attempt
        JOIN agent_run ON agent_run.id = context_compaction_attempt.agent_run_id
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        WHERE camp_turn.camp_id = ?1
        ORDER BY context_compaction_attempt.created_at DESC,
                 context_compaction_attempt.id
        "#,
    )?;
    let rows = statement
        .query_map([camp_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|row| {
            Ok(ContextCompactionView {
                id: row.0,
                agent_run_id: row.1,
                summary_kind: row.2,
                from_camp_message_sequence: row.3,
                through_camp_message_sequence: row.4,
                adapter_kind: row.5,
                model: serde_json::from_str(&row.6)
                    .context("Context Compaction model is invalid")?,
                status: row.7,
                generated_summary_id: row.8,
                error_code: row.9,
                created_at: row.10,
                updated_at: row.11,
            })
        })
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
        agent_profile::configure_test_runtime,
        collaboration::{
            AddCampMemberCommand, CollaborationService, CreateCampCommand,
            CreateCampFromFirstMessageCommand, MessageAddressSpec, RenameCampCommand,
            RepositoryBindingInput, SendCampMessageCommand,
        },
        command::{ActorRef, CommandEnvelope},
        managed_blob::ManagedBlobStore,
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

    fn create_navigation_camp(
        database: &mut Database,
        collaboration: &CollaborationService,
        command_suffix: &str,
        project_path: &Path,
        repository: Option<RepositoryBindingInput>,
        title: &str,
    ) -> String {
        let created = collaboration
            .create_camp(
                database,
                &user_envelope(
                    &format!("navigation-create-{command_suffix}"),
                    None,
                    CreateCampCommand {
                        project_path: project_path.to_string_lossy().to_string(),
                        repository,
                    },
                ),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        collaboration
            .add_camp_member(
                database,
                &user_envelope(
                    &format!("navigation-member-{command_suffix}"),
                    Some(&camp_id),
                    AddCampMemberCommand {
                        camp_id: camp_id.clone(),
                        agent_profile_id: "agent-luoke".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        let version = database
            .connection()
            .query_row(
                "SELECT version FROM camp WHERE id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        collaboration
            .rename_camp(
                database,
                &user_envelope(
                    &format!("navigation-title-{command_suffix}"),
                    Some(&camp_id),
                    RenameCampCommand {
                        camp_id: camp_id.clone(),
                        title: title.to_string(),
                        expected_version: version,
                    },
                ),
            )
            .unwrap();
        collaboration
            .send_camp_message(
                database,
                &user_envelope(
                    &format!("navigation-message-{command_suffix}"),
                    Some(&camp_id),
                    SendCampMessageCommand {
                        camp_id: camp_id.clone(),
                        body: format!("用户消息 {command_suffix}"),
                        address: MessageAddressSpec::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        camp_id
    }

    #[test]
    fn navigation_groups_camps_and_limits_each_recent_section_to_five() {
        let directory =
            std::env::temp_dir().join(format!("lumen-navigation-groups-test-{}", Uuid::new_v4()));
        let lobby_root = directory.join("lobby");
        let project_root = directory.join("lumen-ai");
        let git_common_dir = project_root.join(".git");
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        for index in 0..6 {
            create_navigation_camp(
                &mut database,
                &collaboration,
                &format!("lobby-{index}"),
                &lobby_root,
                None,
                &format!("大厅对话 {index}"),
            );
        }
        for index in 0..2 {
            create_navigation_camp(
                &mut database,
                &collaboration,
                &format!("project-{index}"),
                &project_root,
                Some(RepositoryBindingInput {
                    git_common_dir: git_common_dir.to_string_lossy().to_string(),
                    object_format: "sha1".to_string(),
                }),
                &format!("项目对话 {index}"),
            );
        }

        let read_model = ReadModelService;
        let snapshot = read_model.navigation_snapshot(&mut database).unwrap();
        assert_eq!(snapshot.schema_version, NAVIGATION_SCHEMA_VERSION);
        assert_eq!(snapshot.lobby.total_count, 6);
        assert_eq!(snapshot.lobby.recent_camps.len(), 5);
        assert_eq!(snapshot.projects.len(), 1);
        assert_eq!(snapshot.projects[0].name, "lumen-ai");
        assert_eq!(snapshot.projects[0].total_count, 2);
        assert_eq!(snapshot.projects[0].recent_camps.len(), 2);
        assert_eq!(
            snapshot.projects[0].recent_camps[0].repository_scope_id,
            snapshot.projects[0].recent_camps[1].repository_scope_id
        );

        let page = read_model
            .navigation_group_camps(&mut database, None, 2, 3)
            .unwrap();
        assert_eq!(page.total_count, 6);
        assert_eq!(page.camps.len(), 3);
        assert_eq!(page.next_offset, Some(5));
        let final_page = read_model
            .navigation_group_camps(&mut database, None, 5, 3)
            .unwrap();
        assert_eq!(final_page.camps.len(), 1);
        assert_eq!(final_page.next_offset, None);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn navigation_completion_marker_is_persistent_and_view_ack_is_monotonic() {
        let directory =
            std::env::temp_dir().join(format!("lumen-navigation-marker-test-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        configure_test_runtime(&database, &["agent-luoke"]);
        let collaboration = CollaborationService::default();
        let created = collaboration
            .create_camp_from_first_message(
                &mut database,
                &user_envelope(
                    "navigation-running-camp",
                    None,
                    CreateCampFromFirstMessageCommand {
                        project_path: directory.join("workspace").to_string_lossy().to_string(),
                        repository: None,
                        body: "请开始工作".to_string(),
                        address: MessageAddressSpec::Default,
                        purpose: "执行测试".to_string(),
                        expected_output: "测试结果".to_string(),
                    },
                ),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        let read_model = ReadModelService;
        let running = read_model.navigation_snapshot(&mut database).unwrap();
        assert_eq!(running.lobby.recent_camps[0].marker, "loading");

        let now = chrono::Utc::now().to_rfc3339();
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'failed', ended_at = ?2, updated_at = ?2,
                    last_error_code = 'test_failure'
                WHERE id = ?1
                "#,
                params![
                    created.result.payload["agentRunIds"][0].as_str().unwrap(),
                    now
                ],
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE camp_turn SET status = 'failed', ended_at = ?2, updated_at = ?2 WHERE camp_id = ?1",
                params![camp_id, now],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO event_log(
                    event_id, event_type, payload_json, camp_id,
                    entity_type, entity_id, actor_type, actor_id, created_at
                ) VALUES (?1, 'agent_run.failed', '{}', ?2, 'agent_run', ?3,
                          'system', 'test-runtime', ?4)
                "#,
                params![
                    Uuid::new_v4().to_string(),
                    camp_id,
                    created.result.payload["agentRunIds"][0].as_str().unwrap(),
                    now,
                ],
            )
            .unwrap();

        let completed = read_model.navigation_snapshot(&mut database).unwrap();
        let item = &completed.lobby.recent_camps[0];
        assert_eq!(item.marker, "unread_completed");
        assert!(item.latest_completion_global_sequence > 0);
        let activity_at = item.last_activity_at.clone();
        let acknowledged = read_model
            .acknowledge_camp_viewed(&mut database, &camp_id, completed.through_global_sequence)
            .unwrap();
        assert_eq!(
            acknowledged.last_seen_global_sequence,
            completed.through_global_sequence
        );
        let older_ack = read_model
            .acknowledge_camp_viewed(&mut database, &camp_id, 1)
            .unwrap();
        assert_eq!(
            older_ack.last_seen_global_sequence,
            completed.through_global_sequence
        );
        let viewed = read_model.navigation_snapshot(&mut database).unwrap();
        assert_eq!(viewed.lobby.recent_camps[0].marker, "none");

        let version: i64 = database
            .connection()
            .query_row(
                "SELECT version FROM camp WHERE id = ?1",
                [&camp_id],
                |row| row.get(0),
            )
            .unwrap();
        collaboration
            .rename_camp(
                &mut database,
                &user_envelope(
                    "navigation-rename-after-completion",
                    Some(&camp_id),
                    RenameCampCommand {
                        camp_id: camp_id.clone(),
                        title: "重命名不改变活动".to_string(),
                        expected_version: version,
                    },
                ),
            )
            .unwrap();
        let renamed = read_model.navigation_snapshot(&mut database).unwrap();
        assert_eq!(renamed.lobby.recent_camps[0].last_activity_at, activity_at);
        assert_eq!(renamed.lobby.recent_camps[0].title, "重命名不改变活动");

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(any())]
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
    fn camp_snapshot_projects_a2a_and_context_metadata_without_sensitive_bodies() {
        let directory =
            std::env::temp_dir().join(format!("lumen-context-read-model-test-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        configure_test_runtime(&database, &["agent-luoke", "agent-muwa"]);
        let created = CollaborationService::default()
            .create_camp_from_first_message(
                &mut database,
                &user_envelope(
                    "context-read-create",
                    None,
                    CreateCampFromFirstMessageCommand {
                        project_path: directory.join("workspace").to_string_lossy().to_string(),
                        repository: None,
                        body: "请协作检查上下文".to_string(),
                        address: MessageAddressSpec::Default,
                        purpose: "检查上下文".to_string(),
                        expected_output: "可读结果".to_string(),
                    },
                ),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"].as_str().unwrap();
        let agent_run_id = created.result.payload["agentRunIds"][0].as_str().unwrap();
        let (camp_turn_id, target_conversation_id): (String, String) = database
            .connection()
            .query_row(
                "SELECT camp_turn_id, conversation_id FROM agent_run WHERE id = ?1",
                [agent_run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let target_agent_id: String = database
            .connection()
            .query_row(
                "SELECT agent_profile_id FROM conversation WHERE id = ?1",
                [&target_conversation_id],
                |row| row.get(0),
            )
            .unwrap();
        let (sender_agent_id, source_conversation_id): (String, String) = database
            .connection()
            .query_row(
                r#"
                SELECT agent_profile_id, id FROM conversation
                WHERE camp_id = ?1 AND agent_profile_id <> ?2
                ORDER BY agent_profile_id LIMIT 1
                "#,
                params![camp_id, target_agent_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let blob = ManagedBlobStore::new(&directory)
            .put_bytes(
                &mut database,
                b"SENSITIVE FROZEN PROMPT BODY",
                "text/plain; charset=utf-8",
                "sensitive",
            )
            .unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let summary_id = Uuid::new_v4().to_string();
        let manifest_id = Uuid::new_v4().to_string();
        let delivery_id = Uuid::new_v4().to_string();
        let inbox_id = Uuid::new_v4().to_string();
        let recipient_message_id = Uuid::new_v4().to_string();
        let next_sequence: i64 = database
            .connection()
            .query_row(
                "SELECT last_message_sequence + 1 FROM conversation WHERE id = ?1",
                [&target_conversation_id],
                |row| row.get(0),
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO conversation_message(
                    id, conversation_id, sequence, author_type, author_id,
                    body, source_inbox_message_id, camp_turn_id, created_at
                ) VALUES (?1, ?2, ?3, 'agent', ?4, ?5, ?6, ?7, ?8)
                "#,
                params![
                    recipient_message_id,
                    target_conversation_id,
                    next_sequence,
                    sender_agent_id,
                    "请检查输入物化",
                    inbox_id,
                    camp_turn_id,
                    now,
                ],
            )
            .unwrap();
        database
            .connection()
            .execute(
                "UPDATE conversation SET last_message_sequence = ?2 WHERE id = ?1",
                params![target_conversation_id, next_sequence],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO inbox_message(
                    id, camp_id, sender_agent_id, recipient_agent_id, body,
                    source_conversation_id, source_camp_turn_id,
                    target_conversation_id, target_agent_run_id,
                    correlation_id, idempotency_key, recipient_message_id,
                    delivered_at, available_at, created_at, updated_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                    ?10, ?11, ?12, ?13, ?13, ?13, ?13
                )
                "#,
                params![
                    inbox_id,
                    camp_id,
                    sender_agent_id,
                    target_agent_id,
                    "请检查输入物化",
                    source_conversation_id,
                    camp_turn_id,
                    target_conversation_id,
                    agent_run_id,
                    "correlation-read-test",
                    "idempotency-read-test",
                    recipient_message_id,
                    now,
                ],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO context_summary(
                    id, conversation_id, summary_kind,
                    from_camp_message_sequence, through_camp_message_sequence,
                    source_digest, visibility_scope_digest, body,
                    generator_adapter_kind, generator_model_json,
                    generator_version, created_at
                ) VALUES (?1, ?2, 'bootstrap', 1, 1, ?3, ?4, ?5,
                          'codex-cli', ?6, 'summary-v1', ?7)
                "#,
                params![
                    summary_id,
                    target_conversation_id,
                    "sha256:source",
                    "sha256:visibility",
                    "SENSITIVE SUMMARY BODY",
                    r#"{"modelId":"gpt-test"}"#,
                    now,
                ],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO context_manifest(
                    id, agent_run_id, native_binding_generation,
                    camp_message_boundary_sequence,
                    conversation_message_boundary_sequence,
                    raw_message_refs_json, context_summary_ids_json,
                    attachment_metadata_json, work_brief_json,
                    work_brief_digest, control_signals_json,
                    charter_digest, member_state_digest, formatter_version,
                    rendered_payload_blob_id, rendered_payload_digest, created_at
                ) VALUES (?1, ?2, 1, 1, ?3, ?4, ?5, ?6, '{}', ?7,
                          ?8, ?9, ?10, 1, ?11, ?12, ?13)
                "#,
                params![
                    manifest_id,
                    agent_run_id,
                    next_sequence,
                    r#"[{"entityType":"camp_message","entityId":"message-1"}]"#,
                    serde_json::to_string(&vec![summary_id.clone()]).unwrap(),
                    r#"[{"attachmentId":"attachment-1","name":"review.txt","mediaType":"text/plain","byteSize":4096,"locationRef":"managed-blob://attachment-1","contentDigest":"sha256:attachment"}]"#,
                    "sha256:brief",
                    r#"{"contextMode":"bootstrap"}"#,
                    "sha256:charter",
                    "sha256:members",
                    blob.id,
                    format!("sha256:{}", blob.sha256),
                    now,
                ],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO runtime_input_delivery(
                    id, agent_run_id, execution_epoch, context_manifest_id,
                    native_binding_id, native_binding_generation,
                    boundary_camp_message_sequence, request_digest,
                    status, native_input_id, prepared_at, accepted_at,
                    resolved_at, updated_at
                ) VALUES (?1, ?2, 1, ?3, ?4, 1, 1, ?5, 'accepted',
                          'native-input-1', ?6, ?6, ?6, ?6)
                "#,
                params![
                    delivery_id,
                    agent_run_id,
                    manifest_id,
                    Uuid::new_v4().to_string(),
                    format!("sha256:{}", blob.sha256),
                    now,
                ],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO context_compaction_attempt(
                    id, agent_run_id, conversation_id, summary_kind,
                    from_camp_message_sequence, through_camp_message_sequence,
                    source_digest, visibility_scope_digest, adapter_kind,
                    model_json, status, generated_summary_id,
                    created_at, ended_at, updated_at
                ) VALUES (?1, ?2, ?3, 'bootstrap', 1, 1, ?4, ?5,
                          'codex-cli', ?6, 'succeeded', ?7, ?8, ?8, ?8)
                "#,
                params![
                    Uuid::new_v4().to_string(),
                    agent_run_id,
                    target_conversation_id,
                    "sha256:source",
                    "sha256:visibility",
                    r#"{"modelId":"gpt-test"}"#,
                    summary_id,
                    now,
                ],
            )
            .unwrap();

        let snapshot = ReadModelService
            .camp_snapshot(&mut database, camp_id)
            .unwrap();
        assert_eq!(snapshot.schema_version, 2);
        assert_eq!(snapshot.inbox_messages.len(), 1);
        assert_eq!(snapshot.inbox_messages[0].body, "请检查输入物化");
        assert_eq!(snapshot.context_manifests.len(), 1);
        assert_eq!(
            snapshot.context_manifests[0].context_mode.as_deref(),
            Some("bootstrap")
        );
        assert_eq!(snapshot.context_manifests[0].summaries.len(), 1);
        assert_eq!(
            snapshot.context_manifests[0].attachments[0].name,
            "review.txt"
        );
        assert_eq!(snapshot.context_compactions.len(), 1);
        let serialized = serde_json::to_string(&snapshot).unwrap();
        assert!(!serialized.contains("SENSITIVE FROZEN PROMPT BODY"));
        assert!(!serialized.contains("SENSITIVE SUMMARY BODY"));

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
