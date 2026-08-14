use std::{cmp::Ordering, collections::BTreeMap, path::Path};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    camp_attachment::managed_attachment_summary,
    camp_content::{StructuredCampMessageContent, normalize_content, render_current_plain_text},
    canonical_activity::CanonicalRuntimeActivity,
    db::Database,
    git::GitObservation,
    mcp_projection::McpExposureSnapshot,
    skill_projection::SkillExposureSnapshot,
};

pub const READ_MODEL_SCHEMA_VERSION: i64 = 29;
pub const EVENT_BATCH_SCHEMA_VERSION: i64 = 9;
pub const NAVIGATION_SCHEMA_VERSION: i64 = 3;
pub const EXECUTION_EVIDENCE_PAGE_SCHEMA_VERSION: i64 = 1;
pub const CAMP_MESSAGE_AROUND_SCHEMA_VERSION: i64 = 1;
pub const NAVIGATION_RECENT_CAMP_LIMIT: usize = 5;
const EXECUTION_EVIDENCE_SNAPSHOT_LIMIT: i64 = 1_200;
const CAMP_MESSAGE_AROUND_RADIUS: i64 = 20;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationLeadSummary {
    pub agent_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationCampItem {
    pub id: String,
    pub title: String,
    pub activation_state: String,
    pub project_binding_kind: String,
    pub project_path: String,
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
    pub project_key: String,
    pub name: String,
    pub project_path: String,
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
    pub quick_chat: NavigationCampGroup,
    pub projects: Vec<ProjectNavigationGroup>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationCampPage {
    pub schema_version: i64,
    pub through_global_sequence: i64,
    pub project_path: Option<String>,
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
    pub activation_state: String,
    pub project_binding_kind: String,
    pub project_path: String,
    pub default_lead_agent_id: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampMemberView {
    pub agent_id: String,
    pub display_name: String,
    pub avatar_ref: Option<String>,
    pub team_role: String,
    pub accent: String,
    pub membership_status: String,
    pub leave_requested_at: Option<String>,
    pub profile_presence: String,
    pub member_order: i64,
    pub is_default_lead: bool,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    pub task_id: String,
    pub camp_id: String,
    pub title: String,
    pub description: String,
    pub acceptance_criteria: Vec<String>,
    pub status: String,
    pub assignee_agent_id: Option<String>,
    pub blocked_reason: Option<String>,
    pub completion_summary: Option<String>,
    pub cancel_reason: Option<String>,
    pub created_by_type: String,
    pub created_by_id: String,
    pub source_agent_run_id: Option<String>,
    pub closed_by_type: Option<String>,
    pub closed_by_id: Option<String>,
    pub closed_by_agent_run_id: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
    pub available_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampMessageView {
    pub id: String,
    pub sequence: i64,
    pub timeline_global_sequence: Option<i64>,
    pub author_type: String,
    pub author_id: String,
    pub source_agent_run_id: Option<String>,
    pub body: String,
    pub content: StructuredCampMessageContent,
    pub attachments: Vec<CampMessageAttachmentView>,
    pub address_mode: String,
    pub addressed_agent_ids: Value,
    pub reply_to_camp_message_id: Option<String>,
    pub camp_turn_id: Option<String>,
    pub presentation: Option<Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampMessageAttachmentView {
    pub id: String,
    pub display_name: String,
    pub kind: String,
    pub file_count: u64,
    pub media_type: String,
    pub byte_size: i64,
    pub preview_kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampTurnView {
    pub id: String,
    pub trigger_type: String,
    pub trigger_id: String,
    pub status: String,
    pub cancel_requested_at: Option<String>,
    pub aggregate_reason_code: Option<String>,
    pub execution_budget: CampTurnExecutionBudgetView,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampTurnExecutionBudgetView {
    pub schema_version: i64,
    pub accepted_at: String,
    pub deadline_at: String,
    pub elapsed_seconds: i64,
    pub max_agent_run_responsibilities: i64,
    pub max_accepted_a2a: i64,
    pub allocated_agent_run_responsibilities: i64,
    pub accepted_a2a: i64,
    pub exhausted_at: Option<String>,
    pub exhaustion_reason: Option<String>,
    pub exhaustion_command_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunWorkspaceView {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunView {
    pub id: String,
    pub camp_turn_id: String,
    pub conversation_id: String,
    pub agent_id: String,
    pub task_id: Option<String>,
    pub responsibility_key: String,
    pub responsibility_generation: i64,
    pub purpose: String,
    pub completion_role: String,
    pub status: String,
    pub wait_reason: Option<String>,
    pub terminal_resolution_source: Option<String>,
    pub terminal_reason_code: Option<String>,
    pub execution_epoch: i64,
    pub permission_semantics: String,
    pub invocation_kind: String,
    pub a2a_parent_agent_run_id: Option<String>,
    pub a2a_root_agent_run_id: Option<String>,
    pub a2a_depth: i64,
    pub execution_evidence_count: i64,
    pub has_unsettled_external_effects: bool,
    pub workspace: Option<RunWorkspaceView>,
    pub starting_git_observation: Option<GitObservation>,
    pub ending_git_observation: Option<GitObservation>,
    pub version: i64,
    pub created_at: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunExecutionEvidenceView {
    pub id: String,
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub sequence: i64,
    pub event_type: String,
    pub kind: String,
    pub phase: String,
    pub payload: Value,
    pub content_blob_id: Option<String>,
    pub content_byte_count: i64,
    pub is_truncated: bool,
    pub occurred_at: String,
    pub canonical: Option<CanonicalRuntimeActivity>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunExecutionEvidencePage {
    pub schema_version: i64,
    pub agent_run_id: String,
    pub requested_after_sequence: i64,
    pub next_after_sequence: i64,
    pub through_sequence: i64,
    pub has_more: bool,
    pub evidence: Vec<AgentRunExecutionEvidenceView>,
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
    pub bootstrap_redelivery_present: bool,
    pub bootstrap_redelivery_revision: Option<i64>,
    pub bootstrap_redelivery_evidence_id: Option<String>,
    pub bootstrap_redelivery_envelope_version: Option<i64>,
    pub bootstrap_redelivery_formatter_version: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextManifestView {
    pub id: String,
    pub agent_run_id: String,
    pub bootstrap: NativeSessionBootstrapEvidenceView,
    pub native_binding_generation: i64,
    pub camp_message_boundary_sequence: i64,
    pub conversation_message_boundary_sequence: i64,
    pub history_fence_version: i64,
    pub global_public_message_boundary: i64,
    pub history_camps: Vec<ContextManifestHistoryCampView>,
    pub raw_message_count: usize,
    pub previous_accepted_public_boundary_sequence: i64,
    pub context_delivery_profile_version: i64,
    pub context_delivery_profile: Value,
    pub context_delivery_profile_digest: String,
    pub originating_public_user_message_ref: Option<Value>,
    pub recent_message_count: usize,
    pub omitted_message_count: Option<i64>,
    pub omitted_message_sequence_start: Option<i64>,
    pub omitted_message_sequence_end: Option<i64>,
    pub omission_entries: Vec<Value>,
    pub collaboration_state_digest: String,
    pub collaboration_state_included: bool,
    pub shared_message_evidence: Vec<Value>,
    pub shared_message_evidence_digest: String,
    pub run_notice_refs: Vec<RunNoticeRefView>,
    pub run_notice_payload: Value,
    pub run_notice_digest: String,
    pub current_input_source: Value,
    pub attachment_refs: Vec<CampAttachmentRefView>,
    pub attachment_digest: String,
    pub skill_exposure: SkillExposureSnapshot,
    pub skill_exposure_digest: String,
    pub mcp_exposure: McpExposureSnapshot,
    pub mcp_exposure_digest: String,
    pub mcp_projection_digest: String,
    pub self_active_task_evidence: Value,
    pub self_active_task_evidence_digest: String,
    pub formatter_version: i64,
    pub rendered_payload_digest: String,
    pub delivery: Option<RuntimeInputDeliveryView>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunNoticeRefView {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextManifestHistoryCampView {
    pub camp_id: String,
    pub camp_title: String,
    pub last_visible_activity_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionBootstrapEvidenceView {
    pub id: String,
    pub conversation_id: String,
    pub native_binding_id: String,
    pub native_binding_generation: i64,
    pub contract_version: String,
    pub bootstrap_formatter_version: i64,
    pub session_charter_digest: String,
    pub memory_entrypoint_digest: String,
    pub observed_memory_revisions: Vec<Value>,
    pub authorization_basis_digest: String,
    pub delivery_mode: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampAttachmentRefView {
    pub attachment_id: String,
    pub path: String,
    pub content_digest: String,
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
    pub reason: Option<String>,
    pub agent_run_id: String,
    pub agent_id: String,
    pub adapter_kind: String,
    pub native_method: Option<String>,
    pub request_digest: Option<String>,
    pub permission_semantics: String,
    pub options: Vec<RuntimePermissionOptionView>,
    pub status: String,
    pub requested_for_user_id: String,
    pub resolved_by_type: Option<String>,
    pub resolved_by_id: Option<String>,
    pub resolution_code: Option<String>,
    pub version: i64,
    pub requested_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePermissionOptionView {
    pub option_id: String,
    pub kind: String,
    pub label: String,
    pub consequence: String,
    pub native_response_digest: String,
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
    pub message_deliveries: Vec<MessageDeliveryView>,
    pub turns: Vec<CampTurnView>,
    pub agent_runs: Vec<AgentRunView>,
    pub execution_evidence: Vec<AgentRunExecutionEvidenceView>,
    pub context_manifests: Vec<ContextManifestView>,
    pub approvals: Vec<ApprovalView>,
    pub actions: Vec<ActionView>,
    pub timeline: Vec<DomainEventView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampMessageAroundSnapshot {
    pub schema_version: i64,
    pub through_global_sequence: i64,
    pub camp_id: String,
    pub anchor_message_id: String,
    pub source_available: bool,
    pub messages: Vec<CampMessageView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDeliveryView {
    pub id: String,
    pub message_id: String,
    pub camp_turn_id: String,
    pub task_id: Option<String>,
    pub recipient_agent_id: String,
    pub recipient_canonical_position: i64,
    pub edge_kind: String,
    pub target_parent_agent_run_id: Option<String>,
    pub return_to_agent_run_id: Option<String>,
    pub status: String,
    pub dispatch_phase: String,
    pub wait_condition: Option<String>,
    pub dispatch_attempt_count: i64,
    pub retry_generation: i64,
    pub context_manifest_id: Option<String>,
    pub target_agent_run_id: Option<String>,
    pub manual_intervention_required: bool,
    pub failure_code: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub ended_at: Option<String>,
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
            SELECT camp.id, camp.title, camp.project_path,
                   camp.default_lead_agent_id,
                   (SELECT COUNT(*) FROM camp_member
                    JOIN agent_profile ON agent_profile.id = camp_member.agent_id
                    WHERE camp_member.camp_id = camp.id
                      AND camp_member.status = 'active'
                      AND camp_member.leave_requested_at IS NULL
                      AND agent_profile.profile_status = 'present'),
                   (SELECT COUNT(*) FROM task
                    WHERE task.camp_id = camp.id
                      AND task.status NOT IN ('completed', 'cancelled')),
                   camp.updated_at
            FROM camp
            WHERE camp.activation_state = 'active'
            ORDER BY camp.updated_at DESC, camp.id
            "#,
        )?;
        statement
            .query_map([], |row| {
                Ok(CampListItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    project_path: row.get(2)?,
                    default_lead_agent_id: row.get(3)?,
                    active_member_count: row.get(4)?,
                    open_task_count: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
            .context("failed to list Camp read models")
    }

    pub fn navigation_snapshot(&self, database: &mut Database) -> Result<NavigationSnapshot> {
        let transaction = database.connection_mut().transaction()?;
        let through_global_sequence = current_global_sequence(&transaction)?;
        let camps = load_navigation_camps(&transaction)?;
        let (quick_chat, projects) = group_navigation_camps(camps);
        transaction.commit()?;
        Ok(NavigationSnapshot {
            schema_version: NAVIGATION_SCHEMA_VERSION,
            through_global_sequence,
            quick_chat,
            projects,
        })
    }

    pub fn navigation_group_camps(
        &self,
        database: &mut Database,
        project_path: Option<&str>,
        offset: usize,
        limit: usize,
    ) -> Result<NavigationCampPage> {
        let limit = limit.clamp(1, 200);
        let transaction = database.connection_mut().transaction()?;
        let through_global_sequence = current_global_sequence(&transaction)?;
        let camps = load_navigation_camps(&transaction)?
            .into_iter()
            .filter(|camp| match project_path {
                Some(path) => camp.project_binding_kind == "directory" && camp.project_path == path,
                None => camp.project_binding_kind == "quick_chat",
            })
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
            project_path: project_path.map(str::to_string),
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
            "SELECT EXISTS(SELECT 1 FROM camp WHERE id = ?1)",
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
        let message_deliveries = load_message_deliveries(&transaction, camp_id)?;
        let turns = load_turns(&transaction, camp_id)?;
        let agent_runs = load_agent_runs(&transaction, camp_id)?;
        let execution_evidence = load_execution_evidence(&transaction, camp_id)?;
        let context_manifests = load_context_manifests(&transaction, camp_id)?;
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
            message_deliveries,
            turns,
            agent_runs,
            execution_evidence,
            context_manifests,
            approvals,
            actions,
            timeline,
        })
    }

    pub fn camp_messages_around(
        &self,
        database: &mut Database,
        camp_id: &str,
        message_id: &str,
    ) -> Result<CampMessageAroundSnapshot> {
        let transaction = database.connection_mut().transaction()?;
        let through_global_sequence = current_global_sequence(&transaction)?;
        let anchor_sequence = transaction
            .query_row(
                r#"
                SELECT sequence
                FROM camp_message
                WHERE id = ?2
                  AND camp_id = ?1
                  AND tombstoned_at IS NULL
                "#,
                params![camp_id, message_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let messages = match anchor_sequence {
            Some(sequence) => load_messages_around(
                &transaction,
                camp_id,
                message_id,
                sequence,
                CAMP_MESSAGE_AROUND_RADIUS,
            )?,
            None => Vec::new(),
        };
        transaction.commit()?;
        Ok(CampMessageAroundSnapshot {
            schema_version: CAMP_MESSAGE_AROUND_SCHEMA_VERSION,
            through_global_sequence,
            camp_id: camp_id.to_string(),
            anchor_message_id: message_id.to_string(),
            source_available: anchor_sequence.is_some(),
            messages,
        })
    }

    pub fn agent_run_execution_evidence_page(
        &self,
        database: &mut Database,
        camp_id: &str,
        agent_run_id: &str,
        after_sequence: i64,
        limit: i64,
    ) -> Result<AgentRunExecutionEvidencePage> {
        if after_sequence < 0 {
            anyhow::bail!("Execution Evidence sequence must not be negative");
        }
        let limit = limit.clamp(1, 1_000);
        let transaction = database.connection_mut().transaction()?;
        let belongs_to_camp: bool = transaction.query_row(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM agent_run
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                WHERE agent_run.id = ?1 AND camp_turn.camp_id = ?2
            )
            "#,
            params![agent_run_id, camp_id],
            |row| row.get(0),
        )?;
        if !belongs_to_camp {
            anyhow::bail!("AgentRun does not exist in this Camp");
        }
        let through_sequence: i64 = transaction.query_row(
            r#"
            SELECT COALESCE(MAX(sequence), 0)
            FROM agent_run_execution_evidence
            WHERE agent_run_id = ?1
            "#,
            [agent_run_id],
            |row| row.get(0),
        )?;
        if after_sequence > through_sequence {
            anyhow::bail!("Execution Evidence sequence is ahead of this AgentRun");
        }
        let mut evidence = {
            let mut statement = transaction.prepare(
                r#"
                SELECT id, agent_run_id, execution_epoch, sequence,
                       event_type, kind, phase, payload_preview_json,
                       content_blob_id, content_byte_count,
                       is_truncated, occurred_at
                FROM agent_run_execution_evidence
                WHERE agent_run_id = ?1 AND sequence > ?2
                ORDER BY sequence
                LIMIT ?3
                "#,
            )?;
            statement
                .query_map(
                    params![agent_run_id, after_sequence, limit + 1],
                    execution_evidence_row,
                )?
                .map(|row| execution_evidence_view(row?))
                .collect::<Result<Vec<_>>>()?
        };
        attach_canonical_activity(&transaction, &mut evidence)?;
        let has_more = evidence.len() > limit as usize;
        if has_more {
            evidence.truncate(limit as usize);
        }
        let next_after_sequence = evidence
            .last()
            .map_or(through_sequence, |item| item.sequence);
        transaction.commit()?;
        Ok(AgentRunExecutionEvidencePage {
            schema_version: EXECUTION_EVIDENCE_PAGE_SCHEMA_VERSION,
            agent_run_id: agent_run_id.to_string(),
            requested_after_sequence: after_sequence,
            next_after_sequence,
            through_sequence,
            has_more,
            evidence,
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
            anyhow::bail!("Event sequence marker must not be negative");
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
            schema_version: EVENT_BATCH_SCHEMA_VERSION,
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
            camp.project_binding_kind,
            camp.project_path,
            lead.id,
            lead.display_name,
            COALESCE(navigation_activity.last_activity_sequence, 0),
            CASE
                WHEN camp.activation_state = 'pending'
                THEN COALESCE(camp_composer_draft.updated_at, camp.updated_at)
                ELSE COALESCE(activity_event.created_at, camp.created_at)
            END,
            COALESCE(navigation_activity.latest_completion_sequence, 0),
            COALESCE(camp_view_state.last_seen_global_sequence, 0),
            EXISTS(
                SELECT 1
                FROM agent_run
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                WHERE camp_turn.camp_id = camp.id
                  AND agent_run.status IN ('queued', 'running', 'waiting')
            ),
            camp.version,
            camp.activation_state
        FROM camp
        LEFT JOIN agent_profile AS lead ON lead.id = camp.default_lead_agent_id
        LEFT JOIN navigation_activity ON navigation_activity.camp_id = camp.id
        LEFT JOIN event_log AS activity_event
          ON activity_event.global_sequence = navigation_activity.last_activity_sequence
        LEFT JOIN camp_view_state ON camp_view_state.camp_id = camp.id
        LEFT JOIN camp_composer_draft ON camp_composer_draft.camp_id = camp.id
        WHERE camp.activation_state = 'active'
           OR length(trim(COALESCE(camp_composer_draft.body, ''))) > 0
           OR EXISTS(SELECT 1 FROM prepared_attachment WHERE camp_id = camp.id)
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        let default_lead_agent_id = row.get::<_, Option<String>>(4)?;
        let default_lead_display_name = row.get::<_, Option<String>>(5)?;
        let latest_completion_global_sequence = row.get::<_, i64>(8)?;
        let last_seen_global_sequence = row.get::<_, i64>(9)?;
        let loading = row.get::<_, bool>(10)?;
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
            activation_state: row.get(12)?,
            project_binding_kind: row.get(2)?,
            project_path: row.get(3)?,
            default_lead: default_lead_agent_id.map(|agent_id| NavigationLeadSummary {
                agent_id,
                display_name: default_lead_display_name.unwrap_or_default(),
            }),
            marker: marker.to_string(),
            last_activity_at: row.get(7)?,
            last_activity_global_sequence: row.get(6)?,
            latest_completion_global_sequence,
            version: row.get(11)?,
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
    let mut quick_chat_camps = Vec::new();
    let mut project_camps = BTreeMap::<String, Vec<NavigationCampItem>>::new();
    for camp in camps {
        if camp.project_binding_kind == "directory" {
            project_camps
                .entry(camp.project_path.clone())
                .or_default()
                .push(camp);
        } else {
            quick_chat_camps.push(camp);
        }
    }
    quick_chat_camps.sort_by(compare_navigation_camps);
    let quick_chat = NavigationCampGroup {
        total_count: quick_chat_camps.len(),
        recent_camps: quick_chat_camps
            .into_iter()
            .take(NAVIGATION_RECENT_CAMP_LIMIT)
            .collect(),
    };

    let mut projects = project_camps
        .into_iter()
        .filter_map(|(project_path, mut camps)| {
            camps.sort_by(compare_navigation_camps);
            let representative = camps.first()?.clone();
            Some(ProjectNavigationGroup {
                project_key: format!("directory:{project_path}"),
                name: project_display_name(&project_path),
                project_path,
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
            .then_with(|| left.project_key.cmp(&right.project_key))
    });
    (quick_chat, projects)
}

fn project_display_name(project_path: &str) -> String {
    Path::new(project_path)
        .file_name()
        .and_then(|value| value.to_str())
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
            SELECT id, title, activation_state, project_binding_kind, project_path,
                   default_lead_agent_id,
                   version, created_at, updated_at
            FROM camp WHERE id = ?1
            "#,
            [camp_id],
            |row| {
                Ok(CampView {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    activation_state: row.get(2)?,
                    project_binding_kind: row.get(3)?,
                    project_path: row.get(4)?,
                    default_lead_agent_id: row.get(5)?,
                    version: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
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
        SELECT camp_member.agent_id, agent_profile.display_name,
               agent_profile.avatar_ref, agent_profile.team_role,
               agent_profile.accent, camp_member.status,
               camp_member.leave_requested_at, agent_profile.profile_status,
               agent_profile.member_order, camp_member.version
        FROM camp_member
        JOIN agent_profile ON agent_profile.id = camp_member.agent_id
        WHERE camp_member.camp_id = ?1
        ORDER BY agent_profile.member_order, camp_member.agent_id
        "#,
    )?;
    statement
        .query_map([camp_id], |row| {
            let agent_id: String = row.get(0)?;
            Ok(CampMemberView {
                is_default_lead: default_lead == Some(agent_id.as_str()),
                agent_id,
                display_name: row.get(1)?,
                avatar_ref: row.get(2)?,
                team_role: row.get(3)?,
                accent: row.get(4)?,
                membership_status: row.get(5)?,
                leave_requested_at: row.get(6)?,
                profile_presence: row.get(7)?,
                member_order: row.get(8)?,
                version: row.get(9)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to load Camp members")
}

fn load_tasks(transaction: &Transaction<'_>, camp_id: &str) -> Result<Vec<TaskView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, camp_id, title, description, acceptance_criteria_json,
               status, assignee_agent_id, blocked_reason, completion_summary, cancel_reason,
               created_by_type, created_by_id, source_agent_run_id,
               closed_by_type, closed_by_id, closed_by_agent_run_id,
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
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
            row.get::<_, String>(10)?,
            row.get::<_, String>(11)?,
            row.get::<_, Option<String>>(12)?,
            row.get::<_, Option<String>>(13)?,
            row.get::<_, Option<String>>(14)?,
            row.get::<_, Option<String>>(15)?,
            row.get::<_, i64>(16)?,
            row.get::<_, String>(17)?,
            row.get::<_, String>(18)?,
            row.get::<_, Option<String>>(19)?,
        ))
    })?;
    let mut result = Vec::new();
    for row in rows {
        let (
            id,
            task_camp_id,
            title,
            description,
            acceptance_criteria_json,
            status,
            assignee,
            blocked_reason,
            completion_summary,
            cancel_reason,
            created_by_type,
            created_by_id,
            source_agent_run_id,
            closed_by_type,
            closed_by_id,
            closed_by_agent_run_id,
            version,
            created_at,
            updated_at,
            closed_at,
        ) = row?;
        let available_actions = if matches!(status.as_str(), "completed" | "cancelled") {
            Vec::new()
        } else {
            vec!["update".to_string()]
        };
        result.push(TaskView {
            task_id: id,
            camp_id: task_camp_id,
            title,
            description,
            acceptance_criteria: serde_json::from_str(&acceptance_criteria_json)
                .context("Task acceptance criteria are invalid")?,
            status,
            assignee_agent_id: assignee,
            blocked_reason,
            completion_summary,
            cancel_reason,
            created_by_type,
            created_by_id,
            source_agent_run_id,
            closed_by_type,
            closed_by_id,
            closed_by_agent_run_id,
            version,
            created_at,
            updated_at,
            closed_at,
            available_actions,
        });
    }
    Ok(result)
}

struct CampMessageRow {
    id: String,
    sequence: i64,
    timeline_global_sequence: Option<i64>,
    author_type: String,
    author_id: String,
    source_agent_run_id: Option<String>,
    _stored_body: String,
    structured_content_json: String,
    address_mode: String,
    addressed_agent_ids_json: String,
    reply_to_camp_message_id: Option<String>,
    camp_turn_id: Option<String>,
    presentation_json: Option<String>,
    created_at: String,
}

fn camp_message_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CampMessageRow> {
    Ok(CampMessageRow {
        id: row.get(0)?,
        sequence: row.get(1)?,
        timeline_global_sequence: row.get(2)?,
        author_type: row.get(3)?,
        author_id: row.get(4)?,
        source_agent_run_id: row.get(5)?,
        _stored_body: row.get(6)?,
        structured_content_json: row.get(7)?,
        address_mode: row.get(8)?,
        addressed_agent_ids_json: row.get(9)?,
        reply_to_camp_message_id: row.get(10)?,
        camp_turn_id: row.get(11)?,
        presentation_json: row.get(12)?,
        created_at: row.get(13)?,
    })
}

fn load_messages(
    transaction: &Transaction<'_>,
    camp_id: &str,
    limit: i64,
) -> Result<Vec<CampMessageView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, sequence,
               (
                   SELECT MAX(event_log.global_sequence)
                   FROM event_log
                   WHERE event_log.entity_type = 'camp_message'
                     AND event_log.entity_id = camp_message.id
                     AND event_log.event_type = 'camp_message.sent'
               ),
               author_type, author_id,
               source_agent_run_id, body, structured_content_json, address_mode,
               addressed_agent_ids_json,
               reply_to_camp_message_id, camp_turn_id,
               CASE WHEN author_type = 'agent'
                    THEN recipient_presentation_json
                    ELSE presentation_json
               END, created_at
        FROM camp_message
        WHERE camp_id = ?1 AND tombstoned_at IS NULL
        ORDER BY sequence DESC LIMIT ?2
        "#,
    )?;
    let rows = statement
        .query_map(params![camp_id, limit], camp_message_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    let mut messages = hydrate_message_views(transaction, rows)?;
    messages.reverse();
    Ok(messages)
}

fn load_messages_around(
    transaction: &Transaction<'_>,
    camp_id: &str,
    message_id: &str,
    anchor_sequence: i64,
    radius: i64,
) -> Result<Vec<CampMessageView>> {
    let mut statement = transaction.prepare(
        r#"
        WITH window_ids(id) AS (
            SELECT id FROM (
                SELECT id
                FROM camp_message
                WHERE camp_id = ?1
                  AND tombstoned_at IS NULL
                  AND sequence < ?3
                ORDER BY sequence DESC
                LIMIT ?4
            )
            UNION ALL
            SELECT id
            FROM camp_message
            WHERE camp_id = ?1
              AND id = ?2
              AND tombstoned_at IS NULL
            UNION ALL
            SELECT id FROM (
                SELECT id
                FROM camp_message
                WHERE camp_id = ?1
                  AND tombstoned_at IS NULL
                  AND sequence > ?3
                ORDER BY sequence ASC
                LIMIT ?4
            )
        )
        SELECT camp_message.id, camp_message.sequence,
               (
                   SELECT MAX(event_log.global_sequence)
                   FROM event_log
                   WHERE event_log.entity_type = 'camp_message'
                     AND event_log.entity_id = camp_message.id
                     AND event_log.event_type = 'camp_message.sent'
               ),
               camp_message.author_type, camp_message.author_id,
               camp_message.source_agent_run_id, camp_message.body,
               camp_message.structured_content_json, camp_message.address_mode,
               camp_message.addressed_agent_ids_json,
               camp_message.reply_to_camp_message_id, camp_message.camp_turn_id,
               CASE WHEN camp_message.author_type = 'agent'
                    THEN camp_message.recipient_presentation_json
                    ELSE camp_message.presentation_json
               END,
               camp_message.created_at
        FROM camp_message
        JOIN window_ids ON window_ids.id = camp_message.id
        ORDER BY camp_message.sequence ASC, camp_message.id ASC
        "#,
    )?;
    let rows = statement
        .query_map(
            params![camp_id, message_id, anchor_sequence, radius],
            camp_message_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    hydrate_message_views(transaction, rows)
}

fn hydrate_message_views(
    transaction: &Transaction<'_>,
    rows: Vec<CampMessageRow>,
) -> Result<Vec<CampMessageView>> {
    let requested_message_ids = rows.iter().map(|row| &row.id).collect::<Vec<_>>();
    let requested_message_ids_json = serde_json::to_string(&requested_message_ids)?;
    let mut attachment_statement = transaction.prepare(
        r#"
        WITH requested AS (
            SELECT CAST(value AS TEXT) AS camp_message_id
            FROM json_each(?1)
        )
        SELECT attachment.camp_message_id,
               attachment.id, attachment.display_name, attachment.media_type,
               attachment.byte_size, attachment.preview_kind, attachment.storage_path
        FROM requested
        JOIN message_attachment AS attachment
          ON attachment.camp_message_id = requested.camp_message_id
        ORDER BY attachment.camp_message_id, attachment.position, attachment.id
        "#,
    )?;
    let attachment_rows = attachment_statement
        .query_map([requested_message_ids_json], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut attachments_by_message_id = BTreeMap::<String, Vec<CampMessageAttachmentView>>::new();
    for (message_id, id, display_name, media_type, byte_size, preview_kind, storage_path) in
        attachment_rows
    {
        let summary = managed_attachment_summary(Path::new(&storage_path), &media_type)?;
        let attachment = CampMessageAttachmentView {
            id,
            display_name,
            kind: summary.kind,
            file_count: summary.file_count,
            media_type,
            byte_size,
            preview_kind,
        };
        attachments_by_message_id
            .entry(message_id)
            .or_default()
            .push(attachment);
    }
    drop(attachment_statement);
    rows.into_iter()
        .map(|row| {
            let content =
                serde_json::from_str::<StructuredCampMessageContent>(&row.structured_content_json)
                    .map(normalize_content)
                    .context("CampMessage Structured Content is invalid")?;
            let body = render_structured_message_content(transaction, &content)?;
            let attachments = attachments_by_message_id
                .remove(&row.id)
                .unwrap_or_default();
            Ok(CampMessageView {
                id: row.id,
                sequence: row.sequence,
                timeline_global_sequence: row.timeline_global_sequence,
                author_type: row.author_type,
                author_id: row.author_id,
                source_agent_run_id: row.source_agent_run_id,
                body,
                content,
                attachments,
                address_mode: row.address_mode,
                addressed_agent_ids: serde_json::from_str(&row.addressed_agent_ids_json)?,
                reply_to_camp_message_id: row.reply_to_camp_message_id,
                camp_turn_id: row.camp_turn_id,
                presentation: row
                    .presentation_json
                    .map(|value| serde_json::from_str(&value))
                    .transpose()
                    .context("CampMessage presentation is invalid")?,
                created_at: row.created_at,
            })
        })
        .collect::<Result<Vec<_>>>()
}

fn render_structured_message_content(
    transaction: &Transaction<'_>,
    content: &[crate::camp_content::StructuredCampMessageSegment],
) -> Result<String> {
    render_current_plain_text(transaction, content)
}

fn load_turns(transaction: &Transaction<'_>, camp_id: &str) -> Result<Vec<CampTurnView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, trigger_type, trigger_id, status,
               cancel_requested_at, aggregate_reason_code,
               execution_budget_schema_version,
               execution_budget_accepted_at,
               execution_budget_deadline_at,
               execution_budget_elapsed_seconds,
               execution_budget_max_agent_run_responsibilities,
               execution_budget_max_accepted_a2a,
               execution_budget_root_agent_run_responsibilities + a2a_run_slots_allocated,
               a2a_run_slots_allocated,
               execution_budget_exhausted_at,
               execution_budget_exhaustion_reason,
               execution_budget_exhaustion_command_id,
               version, created_at, updated_at, ended_at
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
                aggregate_reason_code: row.get(5)?,
                execution_budget: CampTurnExecutionBudgetView {
                    schema_version: row.get(6)?,
                    accepted_at: row.get(7)?,
                    deadline_at: row.get(8)?,
                    elapsed_seconds: row.get(9)?,
                    max_agent_run_responsibilities: row.get(10)?,
                    max_accepted_a2a: row.get(11)?,
                    allocated_agent_run_responsibilities: row.get(12)?,
                    accepted_a2a: row.get(13)?,
                    exhausted_at: row.get(14)?,
                    exhaustion_reason: row.get(15)?,
                    exhaustion_command_id: row.get(16)?,
                },
                version: row.get(17)?,
                created_at: row.get(18)?,
                updated_at: row.get(19)?,
                ended_at: row.get(20)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to load CampTurns")
}

fn load_message_deliveries(
    transaction: &Transaction<'_>,
    camp_id: &str,
) -> Result<Vec<MessageDeliveryView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, message_id, camp_turn_id, task_id, recipient_agent_id,
               recipient_canonical_position, edge_kind,
               target_parent_agent_run_id, return_to_agent_run_id,
               status, dispatch_phase,
               wait_condition, dispatch_attempt_count, retry_generation,
               context_manifest_id, target_agent_run_id,
               manual_intervention_required, failure_code,
               version, created_at, updated_at, ended_at
        FROM message_delivery
        WHERE camp_id = ?1
        ORDER BY created_at, queue_sequence, id
        "#,
    )?;
    Ok(statement
        .query_map([camp_id], |row| {
            Ok(MessageDeliveryView {
                id: row.get(0)?,
                message_id: row.get(1)?,
                camp_turn_id: row.get(2)?,
                task_id: row.get(3)?,
                recipient_agent_id: row.get(4)?,
                recipient_canonical_position: row.get(5)?,
                edge_kind: row.get(6)?,
                target_parent_agent_run_id: row.get(7)?,
                return_to_agent_run_id: row.get(8)?,
                status: row.get(9)?,
                dispatch_phase: row.get(10)?,
                wait_condition: row.get(11)?,
                dispatch_attempt_count: row.get(12)?,
                retry_generation: row.get(13)?,
                context_manifest_id: row.get(14)?,
                target_agent_run_id: row.get(15)?,
                manual_intervention_required: row.get::<_, i64>(16)? != 0,
                failure_code: row.get(17)?,
                version: row.get(18)?,
                created_at: row.get(19)?,
                updated_at: row.get(20)?,
                ended_at: row.get(21)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn load_agent_runs(transaction: &Transaction<'_>, camp_id: &str) -> Result<Vec<AgentRunView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT agent_run.id, agent_run.camp_turn_id,
               agent_run.conversation_id, conversation.agent_id,
               agent_run.task_id, agent_run.responsibility_key,
               agent_run.responsibility_generation, agent_run.purpose,
               agent_run.completion_role,
               agent_run.status, agent_run.wait_reason,
               agent_run.terminal_resolution_source,
               agent_run.terminal_reason_code,
               agent_run.execution_epoch, agent_run.permission_semantics,
               agent_run.invocation_kind,
               agent_run.a2a_parent_agent_run_id,
               agent_run.a2a_root_agent_run_id, agent_run.a2a_depth,
               (SELECT COUNT(*)
                FROM agent_run_execution_evidence
                WHERE agent_run_execution_evidence.agent_run_id = agent_run.id),
               (
                 EXISTS(
                   SELECT 1 FROM approval
                   JOIN action_execution
                     ON action_execution.id = approval.action_id
                   WHERE action_execution.agent_run_id = agent_run.id
                     AND approval.status = 'pending'
                 )
                 OR EXISTS(
                   SELECT 1 FROM action_execution
                   WHERE action_execution.agent_run_id = agent_run.id
                     AND (
                       action_execution.status IN ('prepared', 'executing')
                       OR (
                         action_execution.status = 'unknown'
                         AND action_execution.unknown_disposition = 'active'
                       )
                     )
                 )
                 OR EXISTS(
                   SELECT 1 FROM runtime_delivery_checkpoint
                   WHERE runtime_delivery_checkpoint.agent_run_id = agent_run.id
                     AND runtime_delivery_checkpoint.status IN (
                       'pending', 'delivering', 'failed'
                     )
                 )
                 OR EXISTS(
                   SELECT 1 FROM runtime_input_delivery
                   WHERE runtime_input_delivery.agent_run_id = agent_run.id
                     AND runtime_input_delivery.status IN ('prepared', 'delivery_unknown')
                 )
                 OR (
                   agent_run.status IN ('failed', 'cancelled')
                   AND COALESCE(agent_run.last_error_code, '')
                       = 'planned_shutdown_outcome_unknown'
                   AND EXISTS(
                     SELECT 1 FROM runtime_input_delivery
                     WHERE runtime_input_delivery.agent_run_id = agent_run.id
                       AND runtime_input_delivery.status = 'accepted'
                   )
                 )
               ),
               agent_run.workspace_json,
               agent_run.starting_git_observation_json,
               agent_run.ending_git_observation_json,
               camp.project_path, agent_run.version,
               agent_run.created_at, agent_run.started_at,
               agent_run.ended_at, agent_run.updated_at
        FROM agent_run
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        JOIN camp ON camp.id = camp_turn.camp_id
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
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, Option<String>>(12)?,
                row.get::<_, i64>(13)?,
                row.get::<_, String>(14)?,
                row.get::<_, String>(15)?,
                row.get::<_, Option<String>>(16)?,
                row.get::<_, Option<String>>(17)?,
                row.get::<_, i64>(18)?,
                row.get::<_, i64>(19)?,
                row.get::<_, i64>(20)? != 0,
                row.get::<_, Option<String>>(21)?,
                row.get::<_, Option<String>>(22)?,
                row.get::<_, Option<String>>(23)?,
                row.get::<_, String>(24)?,
                row.get::<_, i64>(25)?,
                row.get::<_, String>(26)?,
                row.get::<_, Option<String>>(27)?,
                row.get::<_, Option<String>>(28)?,
                row.get::<_, String>(29)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(
            |(
                id,
                camp_turn_id,
                conversation_id,
                agent_id,
                task_id,
                responsibility_key,
                responsibility_generation,
                purpose,
                completion_role,
                status,
                wait_reason,
                terminal_resolution_source,
                terminal_reason_code,
                execution_epoch,
                permission_semantics,
                invocation_kind,
                a2a_parent_agent_run_id,
                a2a_root_agent_run_id,
                a2a_depth,
                execution_evidence_count,
                has_unsettled_external_effects,
                workspace,
                starting_git_observation,
                ending_git_observation,
                project_path,
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
                    agent_id,
                    task_id,
                    responsibility_key,
                    responsibility_generation,
                    purpose,
                    completion_role,
                    status,
                    wait_reason,
                    terminal_resolution_source,
                    terminal_reason_code,
                    execution_epoch,
                    permission_semantics,
                    invocation_kind,
                    a2a_parent_agent_run_id,
                    a2a_root_agent_run_id,
                    a2a_depth,
                    execution_evidence_count,
                    has_unsettled_external_effects,
                    workspace: Some(match workspace {
                        Some(value) => {
                            let workspace: Value = serde_json::from_str(&value)?;
                            let path = workspace
                                .get("path")
                                .or_else(|| workspace.get("executionRoot"))
                                .and_then(Value::as_str)
                                .context("AgentRun Workspace has no path")?;
                            Ok::<_, anyhow::Error>(RunWorkspaceView {
                                path: path.to_string(),
                            })?
                        }
                        None => RunWorkspaceView { path: project_path },
                    }),
                    starting_git_observation: starting_git_observation
                        .map(|value| serde_json::from_str(&value))
                        .transpose()
                        .context("AgentRun starting Git observation is invalid")?,
                    ending_git_observation: ending_git_observation
                        .map(|value| serde_json::from_str(&value))
                        .transpose()
                        .context("AgentRun ending Git observation is invalid")?,
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

fn load_execution_evidence(
    transaction: &Transaction<'_>,
    camp_id: &str,
) -> Result<Vec<AgentRunExecutionEvidenceView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT *
        FROM (
          SELECT evidence.id, evidence.agent_run_id, evidence.execution_epoch,
                 evidence.sequence, evidence.event_type, evidence.kind,
                 evidence.phase, evidence.payload_preview_json,
                 evidence.content_blob_id, evidence.content_byte_count,
                 evidence.is_truncated, evidence.occurred_at
          FROM agent_run_execution_evidence AS evidence
          JOIN agent_run ON agent_run.id = evidence.agent_run_id
          JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
          WHERE camp_turn.camp_id = ?1
          ORDER BY evidence.occurred_at DESC,
                   evidence.agent_run_id DESC, evidence.sequence DESC
          LIMIT ?2
        )
        ORDER BY occurred_at, agent_run_id, sequence
        "#,
    )?;
    let mut evidence = statement
        .query_map(
            params![camp_id, EXECUTION_EVIDENCE_SNAPSHOT_LIMIT],
            execution_evidence_row,
        )?
        .map(|row| execution_evidence_view(row?))
        .collect::<Result<Vec<_>>>()?;
    attach_canonical_activity(transaction, &mut evidence)?;
    Ok(evidence)
}

type ExecutionEvidenceRow = (
    String,
    String,
    i64,
    i64,
    String,
    String,
    String,
    String,
    Option<String>,
    i64,
    bool,
    String,
);

fn execution_evidence_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExecutionEvidenceRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get::<_, i64>(10)? != 0,
        row.get(11)?,
    ))
}

fn execution_evidence_view(row: ExecutionEvidenceRow) -> Result<AgentRunExecutionEvidenceView> {
    let (
        id,
        agent_run_id,
        execution_epoch,
        sequence,
        event_type,
        kind,
        phase,
        payload,
        content_blob_id,
        content_byte_count,
        is_truncated,
        occurred_at,
    ) = row;
    Ok(AgentRunExecutionEvidenceView {
        id,
        agent_run_id,
        execution_epoch,
        sequence,
        event_type,
        kind,
        phase,
        payload: serde_json::from_str(&payload)
            .context("Execution Evidence payload preview is invalid")?,
        content_blob_id,
        content_byte_count,
        is_truncated,
        occurred_at,
        canonical: None,
    })
}

fn attach_canonical_activity(
    transaction: &Transaction<'_>,
    evidence: &mut [AgentRunExecutionEvidenceView],
) -> Result<()> {
    if evidence.is_empty() {
        return Ok(());
    }
    let requested = evidence
        .iter()
        .map(|item| (&item.id, &item.agent_run_id, item.execution_epoch))
        .collect::<Vec<_>>();
    let requested_json = serde_json::to_string(&requested)?;
    let mut statement = transaction.prepare(
        r#"
        WITH requested AS (
            SELECT
                CAST(json_extract(value, '$[0]') AS TEXT) AS evidence_id,
                CAST(json_extract(value, '$[1]') AS TEXT) AS agent_run_id,
                CAST(json_extract(value, '$[2]') AS INTEGER) AS execution_epoch
            FROM json_each(?1)
        )
        SELECT requested.evidence_id,
               activity.operation_id, activity.classifier_version,
               activity.activity_domain,
               activity.semantic_kind, activity.tool_name,
               activity.presentation_hint, activity.phase, activity.outcome,
               activity.credibility, activity.coverage_level,
               activity.source_authority, activity.source_evidence_ids_json,
               activity.first_evidence_sequence,
               activity.last_evidence_sequence, activity.revision
        FROM requested
        JOIN canonical_runtime_activity AS activity
          ON activity.agent_run_id = requested.agent_run_id
         AND activity.execution_epoch = requested.execution_epoch
         AND activity.classifier_version = ?2
        WHERE EXISTS (
            SELECT 1
            FROM json_each(activity.source_evidence_ids_json) AS source_evidence
            WHERE source_evidence.value = requested.evidence_id
        )
        "#,
    )?;
    let rows = statement.query_map(
        params![
            requested_json,
            crate::canonical_activity::CLASSIFIER_VERSION,
        ],
        |row| {
            let evidence_ids: String = row.get(12)?;
            let canonical = CanonicalRuntimeActivity {
                operation_id: row.get(1)?,
                classifier_version: row.get(2)?,
                activity_domain: row.get(3)?,
                semantic_kind: row.get(4)?,
                tool_name: row.get(5)?,
                presentation_hint: row.get(6)?,
                phase: row.get(7)?,
                outcome: row.get(8)?,
                credibility: row.get(9)?,
                coverage_level: row.get(10)?,
                source_authority: row.get(11)?,
                source_evidence_ids: serde_json::from_str(&evidence_ids).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        12,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                first_evidence_sequence: row.get(13)?,
                last_evidence_sequence: row.get(14)?,
                revision: row.get(15)?,
            };
            Ok((row.get::<_, String>(0)?, canonical))
        },
    )?;
    let mut canonical_by_evidence_id = BTreeMap::new();
    for row in rows {
        let (evidence_id, canonical) = row?;
        canonical_by_evidence_id
            .entry(evidence_id)
            .or_insert(canonical);
    }
    drop(statement);
    for item in evidence {
        item.canonical = canonical_by_evidence_id.remove(&item.id);
    }
    Ok(())
}

fn load_context_manifests(
    transaction: &Transaction<'_>,
    camp_id: &str,
) -> Result<Vec<ContextManifestView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT manifest.id, manifest.agent_run_id,
               manifest.native_binding_generation,
               manifest.camp_message_boundary_sequence,
               manifest.conversation_message_boundary_sequence,
               manifest.raw_message_refs_json,
               manifest.collaboration_state_digest,
               manifest.run_notice_refs_json,
               manifest.run_notice_digest,
               manifest.current_input_source_json,
               manifest.attachment_refs_json,
               manifest.attachment_digest,
               manifest.skill_exposure_json,
               manifest.skill_exposure_digest,
               manifest.mcp_exposure_json,
               manifest.mcp_exposure_digest,
               manifest.mcp_projection_digest,
               manifest.formatter_version,
               manifest.rendered_payload_digest,
               manifest.created_at,
               manifest.history_fence_version,
               manifest.global_public_message_boundary,
               manifest.previous_accepted_public_boundary_sequence,
               manifest.context_delivery_profile_version,
               manifest.context_delivery_profile_json,
               manifest.context_delivery_profile_digest,
               manifest.originating_public_user_message_ref_json,
               manifest.recent_message_refs_json,
               manifest.omitted_message_count,
               manifest.omitted_message_sequence_start,
               manifest.omitted_message_sequence_end,
               json_object(
                   'id', bootstrap.id,
                   'conversationId', bootstrap.conversation_id,
                   'nativeBindingId', bootstrap.native_binding_id,
                   'nativeBindingGeneration', bootstrap.native_binding_generation,
                   'contractVersion', bootstrap.contract_version,
                   'bootstrapFormatterVersion', bootstrap.bootstrap_formatter_version,
                   'sessionCharterDigest', bootstrap.session_charter_digest,
                   'memoryEntrypointDigest', bootstrap.memory_entrypoint_digest,
                   'observedMemoryRevisions', json(bootstrap.observed_memory_revisions_json),
                   'authorizationBasisDigest', bootstrap.authorization_basis_digest,
                   'deliveryMode', bootstrap.delivery_mode,
                   'createdAt', bootstrap.created_at
               ),
               delivery.id, delivery.execution_epoch, delivery.status,
               delivery.native_input_id, delivery.boundary_camp_message_sequence,
               delivery.prepared_at, delivery.accepted_at, delivery.resolved_at,
               delivery.last_error, delivery.updated_at,
               manifest.collaboration_state_included,
               manifest.shared_message_evidence_json,
               manifest.shared_message_evidence_digest,
               manifest.run_notice_payload_json,
               delivery.bootstrap_redelivery_present,
               delivery.bootstrap_redelivery_revision,
               delivery.bootstrap_redelivery_evidence_id,
               delivery.bootstrap_redelivery_envelope_version,
               delivery.bootstrap_redelivery_formatter_version,
               manifest.omission_entries_json,
               manifest.self_active_task_evidence_json,
               manifest.self_active_task_evidence_digest
        FROM context_manifest AS manifest
        JOIN native_session_bootstrap_evidence AS bootstrap
          ON bootstrap.id = manifest.bootstrap_evidence_id
        JOIN agent_run ON agent_run.id = manifest.agent_run_id
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        LEFT JOIN runtime_input_delivery AS delivery
          ON delivery.id = (
              SELECT candidate.id
              FROM runtime_input_delivery AS candidate
              WHERE candidate.context_manifest_id = manifest.id
              ORDER BY candidate.execution_epoch DESC,
                       candidate.prepared_at DESC, candidate.id DESC
              LIMIT 1
          )
        WHERE camp_turn.camp_id = ?1
        ORDER BY manifest.created_at DESC, manifest.id
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
                row.get::<_, String>(12)?,
                row.get::<_, String>(13)?,
                row.get::<_, String>(14)?,
                row.get::<_, String>(15)?,
                row.get::<_, String>(16)?,
                row.get::<_, i64>(17)?,
                row.get::<_, String>(18)?,
                row.get::<_, String>(19)?,
                row.get::<_, i64>(20)?,
                row.get::<_, i64>(21)?,
                row.get::<_, i64>(22)?,
                row.get::<_, i64>(23)?,
                row.get::<_, String>(24)?,
                row.get::<_, String>(25)?,
                row.get::<_, Option<String>>(26)?,
                row.get::<_, String>(27)?,
                row.get::<_, Option<i64>>(28)?,
                row.get::<_, Option<i64>>(29)?,
                row.get::<_, Option<i64>>(30)?,
                row.get::<_, String>(31)?,
                row.get::<_, Option<String>>(32)?,
                row.get::<_, Option<i64>>(33)?,
                row.get::<_, Option<String>>(34)?,
                row.get::<_, Option<String>>(35)?,
                row.get::<_, Option<i64>>(36)?,
                row.get::<_, Option<String>>(37)?,
                row.get::<_, Option<String>>(38)?,
                row.get::<_, Option<String>>(39)?,
                row.get::<_, Option<String>>(40)?,
                row.get::<_, Option<String>>(41)?,
                row.get::<_, bool>(42)?,
                row.get::<_, String>(43)?,
                row.get::<_, String>(44)?,
                row.get::<_, String>(45)?,
                row.get::<_, Option<bool>>(46)?,
                row.get::<_, Option<i64>>(47)?,
                row.get::<_, Option<String>>(48)?,
                row.get::<_, Option<i64>>(49)?,
                row.get::<_, Option<i64>>(50)?,
                row.get::<_, String>(51)?,
                row.get::<_, String>(52)?,
                row.get::<_, String>(53)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|row| {
            let raw_message_refs = serde_json::from_str::<Vec<Value>>(&row.5)
                .context("ContextManifest raw message references are invalid")?;
            let run_notice_refs = serde_json::from_str::<Vec<RunNoticeRefView>>(&row.7)
                .context("ContextManifest Run Notice references are invalid")?;
            let shared_message_evidence = serde_json::from_str::<Vec<Value>>(&row.43)
                .context("ContextManifest Shared Message evidence is invalid")?;
            let run_notice_payload = serde_json::from_str::<Value>(&row.45)
                .context("ContextManifest Run Notice payload is invalid")?;
            let omission_entries = serde_json::from_str::<Vec<Value>>(&row.51)
                .context("ContextManifest omission evidence is invalid")?;
            let self_active_task_evidence = serde_json::from_str::<Value>(&row.52)
                .context("ContextManifest Self Active Task evidence is invalid")?;
            let current_input_source = serde_json::from_str::<Value>(&row.9)
                .context("ContextManifest Current Input source is invalid")?;
            let attachment_refs = serde_json::from_str::<Vec<CampAttachmentRefView>>(&row.10)
                .context("ContextManifest attachment references are invalid")?;
            let skill_exposure = serde_json::from_str::<SkillExposureSnapshot>(&row.12)
                .context("ContextManifest Skill exposure is invalid")?;
            let mcp_exposure = serde_json::from_str::<McpExposureSnapshot>(&row.14)
                .context("ContextManifest MCP exposure is invalid")?;
            let context_delivery_profile = serde_json::from_str(&row.24)
                .context("ContextManifest delivery profile is invalid")?;
            let originating_public_user_message_ref = row
                .26
                .as_deref()
                .map(serde_json::from_str)
                .transpose()
                .context("ContextManifest originating message reference is invalid")?;
            let recent_message_count = serde_json::from_str::<Vec<Value>>(&row.27)
                .context("ContextManifest recent message references are invalid")?
                .len();
            let bootstrap = serde_json::from_str::<NativeSessionBootstrapEvidenceView>(&row.31)
                .context("ContextManifest Native Session Bootstrap is invalid")?;
            let delivery = row
                .32
                .clone()
                .map(|id| {
                    Ok::<RuntimeInputDeliveryView, anyhow::Error>(RuntimeInputDeliveryView {
                        id,
                        execution_epoch: row
                            .33
                            .context("Context delivery has no execution epoch")?,
                        status: row.34.clone().context("Context delivery has no status")?,
                        native_input_id: row.35.clone(),
                        boundary_camp_message_sequence: row
                            .36
                            .context("Context delivery has no message boundary")?,
                        prepared_at: row
                            .37
                            .clone()
                            .context("Context delivery has no prepared time")?,
                        accepted_at: row.38.clone(),
                        resolved_at: row.39.clone(),
                        last_error: row.40.clone(),
                        updated_at: row
                            .41
                            .clone()
                            .context("Context delivery has no updated time")?,
                        bootstrap_redelivery_present: row.46.unwrap_or(false),
                        bootstrap_redelivery_revision: row.47,
                        bootstrap_redelivery_evidence_id: row.48.clone(),
                        bootstrap_redelivery_envelope_version: row.49,
                        bootstrap_redelivery_formatter_version: row.50,
                    })
                })
                .transpose()?;
            Ok(ContextManifestView {
                id: row.0.clone(),
                agent_run_id: row.1,
                bootstrap,
                native_binding_generation: row.2,
                camp_message_boundary_sequence: row.3,
                conversation_message_boundary_sequence: row.4,
                history_fence_version: row.20,
                global_public_message_boundary: row.21,
                history_camps: load_context_manifest_history_camps(transaction, &row.0)?,
                raw_message_count: raw_message_refs.len(),
                previous_accepted_public_boundary_sequence: row.22,
                context_delivery_profile_version: row.23,
                context_delivery_profile,
                context_delivery_profile_digest: row.25,
                originating_public_user_message_ref,
                recent_message_count,
                omitted_message_count: row.28,
                omitted_message_sequence_start: row.29,
                omitted_message_sequence_end: row.30,
                omission_entries,
                collaboration_state_digest: row.6,
                collaboration_state_included: row.42,
                shared_message_evidence,
                shared_message_evidence_digest: row.44,
                run_notice_refs,
                run_notice_payload,
                run_notice_digest: row.8,
                current_input_source,
                attachment_refs,
                attachment_digest: row.11,
                skill_exposure,
                skill_exposure_digest: row.13,
                mcp_exposure,
                mcp_exposure_digest: row.15,
                mcp_projection_digest: row.16,
                self_active_task_evidence,
                self_active_task_evidence_digest: row.53,
                formatter_version: row.17,
                rendered_payload_digest: row.18,
                delivery,
                created_at: row.19,
            })
        })
        .collect()
}

fn load_context_manifest_history_camps(
    transaction: &Transaction<'_>,
    context_manifest_id: &str,
) -> Result<Vec<ContextManifestHistoryCampView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT camp_id, camp_title, last_visible_activity_at
        FROM context_manifest_history_camp
        WHERE context_manifest_id = ?1
        ORDER BY camp_id
        "#,
    )?;
    statement
        .query_map([context_manifest_id], |row| {
            Ok(ContextManifestHistoryCampView {
                camp_id: row.get(0)?,
                camp_title: row.get(1)?,
                last_visible_activity_at: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn load_approvals(transaction: &Transaction<'_>, camp_id: &str) -> Result<Vec<ApprovalView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT approval.id, approval.action_id, approval.action_kind,
               approval.action_summary, approval.status,
               approval.requested_for_user_id, approval.version,
               approval.requested_at, approval.resolved_at,
               approval.resolved_by_type, approval.resolved_by_id,
               approval.resolution_code, approval.request_json, approval.reason,
               agent_run.id, conversation.agent_id,
               COALESCE(agent_run.runtime_adapter_kind, 'unknown'),
               action_execution.native_request_method,
               action_execution.native_request_digest,
               agent_run.permission_semantics,
               approval.native_options_json
        FROM approval
        JOIN action_execution ON action_execution.id = approval.action_id
        JOIN agent_run ON agent_run.id = action_execution.agent_run_id
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        JOIN conversation ON conversation.id = agent_run.conversation_id
        WHERE camp_turn.camp_id = ?1
        ORDER BY approval.requested_at DESC, approval.id
        "#,
    )?;
    statement
        .query_map([camp_id], |row| {
            let canonical_input_json = row.get::<_, String>(12)?;
            let canonical_input = serde_json::from_str(&canonical_input_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    12,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            let native_options_json = row.get::<_, String>(20)?;
            let options =
                serde_json::from_str::<Vec<RuntimePermissionOptionView>>(&native_options_json)
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            20,
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
                reason: row.get(13)?,
                agent_run_id: row.get(14)?,
                agent_id: row.get(15)?,
                adapter_kind: row.get(16)?,
                native_method: row.get(17)?,
                request_digest: row.get(18)?,
                permission_semantics: row.get(19)?,
                options,
                status: row.get(4)?,
                requested_for_user_id: row.get(5)?,
                resolved_by_type: row.get(9)?,
                resolved_by_id: row.get(10)?,
                resolution_code: row.get(11)?,
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
        camp_attachment::CampAttachmentStore,
        camp_content::StructuredCampMessageSegment as Segment,
        collaboration::{
            AddCampMemberCommand, CollaborationService, CreateCampCommand, ProjectBindingKind,
            RenameCampCommand, TestCampConversationCommand, TestCampMessageAddress,
            TestCampMessageCommand,
        },
        command::{ActorRef, CommandEnvelope},
    };
    use serde_json::json;
    use uuid::Uuid;

    fn user_envelope<P>(command_id: &str, camp_id: Option<&str>, payload: P) -> CommandEnvelope<P> {
        CommandEnvelope {
            command_id: command_id.to_string(),
            actor: ActorRef::User {
                user_id: "local_user".to_string(),
            },
            camp_id: camp_id.map(str::to_string),
            expected_versions: Vec::new(),
            execution_epoch: None,
            payload,
        }
    }

    #[test]
    fn snapshot_projects_current_names_from_structured_mentions() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-read-model-structured-message-{}",
            Uuid::new_v4()
        ));
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        let created = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "create-structured-read-camp",
                    None,
                    CreateCampCommand::for_test_with_members(
                        directory.join("workspace").to_string_lossy().to_string(),
                        &["agent_2"],
                        "agent_2",
                    ),
                ),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        let content = vec![
            Segment::Text {
                text: "请 ".to_string(),
            },
            Segment::MemberMention {
                agent_id: "agent_2".to_string(),
            },
            Segment::Text {
                text: " 处理".to_string(),
            },
        ];
        let draft = CampAttachmentStore::new(&directory)
            .save_content(&mut database, &camp_id, 0, content.clone())
            .unwrap();
        collaboration
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "send-structured-read-message",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: Some(draft.revision),
                        body: String::new(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        collaboration
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "send-legacy-read-message",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "旧消息仍是 @muwa".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
                        reply_to_camp_message_id: None,
                        execution: None,
                    },
                ),
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_profile
                SET display_name = '木瓦（新名）', version = version + 1,
                    updated_at = '2026-08-03T00:01:00Z'
                WHERE id = 'agent_2'
                "#,
                [],
            )
            .unwrap();

        let snapshot = ReadModelService
            .camp_snapshot(&mut database, &camp_id)
            .unwrap();
        assert_eq!(snapshot.schema_version, READ_MODEL_SCHEMA_VERSION);
        let serialized_snapshot = serde_json::to_value(&snapshot).unwrap();
        for retired_field in ["inboxMessages", "conversationInputs"] {
            assert!(
                serialized_snapshot.get(retired_field).is_none(),
                "public CampSnapshot must not expose retired {retired_field}"
            );
        }
        assert!(serialized_snapshot.get("messageDeliveries").is_some());
        assert!(snapshot.agent_runs.iter().all(|run| {
            serde_json::to_value(run)
                .unwrap()
                .get("sourceInboxMessageId")
                .is_none()
        }));
        assert!(
            serde_json::to_value(&snapshot.members[0])
                .unwrap()
                .get("handle")
                .is_none()
        );
        assert_eq!(snapshot.messages[0].body, "请 @木瓦（新名） 处理");
        assert_eq!(snapshot.messages[0].content, content);
        assert_eq!(snapshot.messages[1].body, "旧消息仍是 @muwa");
        assert_eq!(
            snapshot.messages[1].content,
            vec![Segment::Text {
                text: "旧消息仍是 @muwa".to_string(),
            }]
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn snapshot_treats_accepted_input_without_shutdown_error_as_settled() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-read-model-null-unsettled-effect-{}",
            Uuid::new_v4()
        ));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = Database::open(&directory).unwrap();
        configure_test_runtime(&database, &["agent_1"]);
        let created = CollaborationService::default()
            .create_test_camp_conversation(
                &mut database,
                &user_envelope(
                    "null-unsettled-effect-create",
                    None,
                    TestCampConversationCommand {
                        project_path: workspace.to_string_lossy().to_string(),
                        project_binding_kind: ProjectBindingKind::Directory,
                        body: "验证空错误码投影".to_string(),
                        address: TestCampMessageAddress::Default,
                        purpose: "验证外部效果布尔值非空".to_string(),
                    },
                ),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"].as_str().unwrap();
        let agent_run_id = created.result.payload["agentRunIds"][0].as_str().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        database
            .connection()
            .execute_batch("PRAGMA foreign_keys = OFF;")
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO runtime_input_delivery(
                    id, agent_run_id, execution_epoch, context_manifest_id,
                    native_binding_id, native_binding_generation,
                    boundary_camp_message_sequence, dynamic_payload_digest,
                    status, native_input_id, prepared_at, accepted_at, updated_at
                ) VALUES (
                    'null-unsettled-effect-input', ?1, 1,
                    'null-unsettled-effect-manifest', 'null-unsettled-effect-binding',
                    1, 1, 'sha256:null-unsettled-effect', 'accepted',
                    'null-unsettled-effect-native-input', ?2, ?2, ?2
                )
                "#,
                params![agent_run_id, now],
            )
            .unwrap();
        database
            .connection()
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                UPDATE agent_run
                SET status = 'failed', last_error_code = NULL,
                    ended_at = ?2, updated_at = ?2
                WHERE id = ?1
                "#,
                params![agent_run_id, now],
            )
            .unwrap();

        let snapshot = ReadModelService
            .camp_snapshot(&mut database, camp_id)
            .unwrap();
        let run = snapshot
            .agent_runs
            .iter()
            .find(|run| run.id == agent_run_id)
            .unwrap();
        assert!(!run.has_unsettled_external_effects);

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn message_around_reads_a_bounded_old_window_without_leaking_unavailable_sources() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-read-model-message-around-{}",
            Uuid::new_v4()
        ));
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        let created = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "create-message-around-camp",
                    None,
                    CreateCampCommand::for_test(
                        directory.join("workspace").to_string_lossy().to_string(),
                    ),
                ),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"]
            .as_str()
            .unwrap()
            .to_string();
        let other = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "create-other-message-around-camp",
                    None,
                    CreateCampCommand::for_test(
                        directory
                            .join("other-workspace")
                            .to_string_lossy()
                            .to_string(),
                    ),
                ),
            )
            .unwrap();
        let other_camp_id = other.result.payload["campId"].as_str().unwrap().to_string();
        let transaction = database.connection_mut().transaction().unwrap();
        {
            let mut statement = transaction
                .prepare(
                    r#"
                    INSERT INTO camp_message(
                        id, camp_id, sequence, author_type, author_id, body,
                        structured_content_json, content_digest, address_mode,
                        addressed_agent_ids_json, version, created_at, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, 'user', 'local_user', ?4,
                        ?5, ?6, 'default', '[]', 1, ?7, ?7
                    )
                    "#,
                )
                .unwrap();
            for sequence in 1..=1_050_i64 {
                let message_id = format!("around-message-{sequence}");
                let body = format!("消息 {sequence}");
                let content =
                    serde_json::to_string(&vec![Segment::Text { text: body.clone() }]).unwrap();
                statement
                    .execute(params![
                        message_id,
                        camp_id,
                        sequence,
                        body,
                        content,
                        format!("sha256:around-{sequence}"),
                        format!("2026-08-01T00:00:{:02}Z", sequence % 60),
                    ])
                    .unwrap();
            }
        }
        let attachment_path = directory.join("anchor-attachment.txt");
        transaction
            .execute(
                r#"
                INSERT INTO message_attachment(
                    id, camp_id, camp_message_id, conversation_message_id,
                    position, display_name, media_type, byte_size,
                    content_digest, storage_path, preview_kind,
                    created_by_type, created_by_id, created_at
                ) VALUES (
                    'around-attachment', ?1, 'around-message-25', NULL,
                    0, 'anchor.txt', 'text/plain', 12,
                    'sha256:anchor-attachment', ?2, 'none',
                    'user', 'local_user', '2026-08-01T00:00:00Z'
                )
                "#,
                params![camp_id, attachment_path.to_string_lossy()],
            )
            .unwrap();
        transaction.commit().unwrap();

        let read_model = ReadModelService;
        let recent = read_model.camp_snapshot(&mut database, &camp_id).unwrap();
        assert_eq!(recent.messages.len(), 1_000);
        assert!(
            recent
                .messages
                .iter()
                .all(|message| message.id != "around-message-25")
        );

        let around = read_model
            .camp_messages_around(&mut database, &camp_id, "around-message-25")
            .unwrap();
        assert_eq!(around.schema_version, CAMP_MESSAGE_AROUND_SCHEMA_VERSION);
        assert_eq!(around.camp_id, camp_id);
        assert_eq!(around.anchor_message_id, "around-message-25");
        assert!(around.source_available);
        assert_eq!(around.messages.len(), 41);
        assert_eq!(around.messages.first().unwrap().sequence, 5);
        assert_eq!(around.messages.last().unwrap().sequence, 45);
        assert!(
            around
                .messages
                .windows(2)
                .all(|pair| pair[0].sequence < pair[1].sequence)
        );
        let anchor = around
            .messages
            .iter()
            .find(|message| message.id == around.anchor_message_id)
            .unwrap();
        assert_eq!(anchor.attachments.len(), 1);
        assert_eq!(anchor.attachments[0].display_name, "anchor.txt");
        assert_eq!(anchor.attachments[0].kind, "file");
        assert_eq!(anchor.attachments[0].file_count, 1);

        for (requested_camp, requested_message) in [
            (other_camp_id.as_str(), "around-message-25"),
            (camp_id.as_str(), "missing-message"),
        ] {
            let unavailable = read_model
                .camp_messages_around(&mut database, requested_camp, requested_message)
                .unwrap();
            assert!(!unavailable.source_available);
            assert!(unavailable.messages.is_empty());
            assert_eq!(unavailable.camp_id, requested_camp);
            assert_eq!(unavailable.anchor_message_id, requested_message);
        }

        database
            .connection()
            .execute(
                "UPDATE camp_message SET tombstoned_at = '2026-08-01T01:00:00Z' WHERE id = 'around-message-25'",
                [],
            )
            .unwrap();
        let tombstoned = read_model
            .camp_messages_around(&mut database, &camp_id, "around-message-25")
            .unwrap();
        assert!(!tombstoned.source_available);
        assert!(tombstoned.messages.is_empty());

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    fn create_navigation_camp(
        database: &mut Database,
        collaboration: &CollaborationService,
        command_suffix: &str,
        project_path: &Path,
        project_binding_kind: ProjectBindingKind,
        title: &str,
    ) -> String {
        let mut command = CreateCampCommand::for_test(project_path.to_string_lossy().to_string());
        command.project_binding_kind = project_binding_kind;
        let created = collaboration
            .create_camp(
                database,
                &user_envelope(
                    &format!("navigation-create-{command_suffix}"),
                    None,
                    command,
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
                        agent_id: "agent_1".to_string(),
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
            .send_test_camp_message(
                database,
                &user_envelope(
                    &format!("navigation-message-{command_suffix}"),
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: format!("用户消息 {command_suffix}"),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
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
            std::env::temp_dir().join(format!("rovai-navigation-groups-test-{}", Uuid::new_v4()));
        let quick_chat_root = directory.join("quick-chat");
        let project_root = directory.join("rovai-ai");
        let mut database = Database::open(&directory).unwrap();
        let collaboration = CollaborationService::default();
        for index in 0..6 {
            create_navigation_camp(
                &mut database,
                &collaboration,
                &format!("quick-chat-{index}"),
                &quick_chat_root,
                ProjectBindingKind::QuickChat,
                &format!("快速对话 {index}"),
            );
        }
        for index in 0..2 {
            create_navigation_camp(
                &mut database,
                &collaboration,
                &format!("project-{index}"),
                &project_root,
                ProjectBindingKind::Directory,
                &format!("项目对话 {index}"),
            );
        }

        let read_model = ReadModelService;
        let snapshot = read_model.navigation_snapshot(&mut database).unwrap();
        assert_eq!(snapshot.schema_version, NAVIGATION_SCHEMA_VERSION);
        assert_eq!(snapshot.quick_chat.total_count, 6);
        assert_eq!(snapshot.quick_chat.recent_camps.len(), 5);
        assert_eq!(snapshot.projects.len(), 1);
        assert_eq!(snapshot.projects[0].name, "rovai-ai");
        assert_eq!(snapshot.projects[0].total_count, 2);
        assert_eq!(snapshot.projects[0].recent_camps.len(), 2);
        assert_eq!(
            snapshot.projects[0].project_path,
            project_root.to_string_lossy()
        );
        assert_eq!(
            snapshot.projects[0].project_key,
            format!("directory:{}", project_root.to_string_lossy())
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
            std::env::temp_dir().join(format!("rovai-navigation-marker-test-{}", Uuid::new_v4()));
        let mut database = Database::open(&directory).unwrap();
        configure_test_runtime(&database, &["agent_1"]);
        let collaboration = CollaborationService::default();
        let created = collaboration
            .create_test_camp_conversation(
                &mut database,
                &user_envelope(
                    "navigation-running-camp",
                    None,
                    TestCampConversationCommand {
                        project_path: directory.join("workspace").to_string_lossy().to_string(),
                        project_binding_kind: crate::collaboration::ProjectBindingKind::Directory,
                        body: "请开始工作".to_string(),
                        address: TestCampMessageAddress::Default,
                        purpose: "执行测试".to_string(),
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
        assert_eq!(running.projects[0].recent_camps[0].marker, "loading");

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
        let item = &completed.projects[0].recent_camps[0];
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
        assert_eq!(viewed.projects[0].recent_camps[0].marker, "none");

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
        assert_eq!(
            renamed.projects[0].recent_camps[0].last_activity_at,
            activity_at
        );
        assert_eq!(
            renamed.projects[0].recent_camps[0].title,
            "重命名不改变活动"
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn snapshot_marker_and_incremental_events_have_no_lost_window() {
        let directory =
            std::env::temp_dir().join(format!("rovai-read-model-test-{}", Uuid::new_v4()));
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
                    CreateCampCommand::for_test(workspace.to_string_lossy().to_string()),
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
                        agent_id: "agent_2".to_string(),
                        capability_overrides: json!({}),
                    },
                ),
            )
            .unwrap();
        collaboration
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "read-first-message",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "快照内消息".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
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
        assert!(snapshot.messages[0].timeline_global_sequence.is_some());
        assert!(
            snapshot
                .timeline
                .iter()
                .all(|event| event.global_sequence <= snapshot.through_global_sequence)
        );

        collaboration
            .send_test_camp_message(
                &mut database,
                &user_envelope(
                    "read-after-snapshot",
                    Some(&camp_id),
                    TestCampMessageCommand {
                        camp_id: camp_id.clone(),
                        draft_revision: None,
                        body: "快照后消息".to_string(),
                        prepared_attachment_ids: Vec::new(),
                        address: TestCampMessageAddress::Default,
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
        assert_eq!(first_batch.schema_version, EVENT_BATCH_SCHEMA_VERSION);
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
    fn execution_evidence_is_counted_in_snapshot_and_paged_by_agent_run() {
        let directory =
            std::env::temp_dir().join(format!("rovai-evidence-page-test-{}", Uuid::new_v4()));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = Database::open(&directory).unwrap();
        configure_test_runtime(&database, &["agent_1"]);
        let created = CollaborationService::default()
            .create_test_camp_conversation(
                &mut database,
                &user_envelope(
                    "evidence-page-create",
                    None,
                    TestCampConversationCommand {
                        project_path: workspace.to_string_lossy().to_string(),
                        project_binding_kind: ProjectBindingKind::Directory,
                        body: "记录执行过程".to_string(),
                        address: TestCampMessageAddress::Default,
                        purpose: "验证执行过程分页".to_string(),
                    },
                ),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"].as_str().unwrap();
        let agent_run_id = created.result.payload["agentRunIds"][0].as_str().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        for sequence in 1..=3 {
            database
                .connection()
                .execute(
                    r#"
                    INSERT INTO agent_run_execution_evidence(
                        id, agent_run_id, execution_epoch, sequence,
                        event_type, kind, phase, source_event_key,
                        payload_preview_json, content_blob_id,
                        content_byte_count, is_truncated, occurred_at
                    ) VALUES (
                        ?1, ?2, 0, ?3, 'agent.text.delta', 'narration',
                        'updated', NULL, ?4, NULL, 32, 0, ?5
                    )
                    "#,
                    params![
                        format!("evidence-{sequence}"),
                        agent_run_id,
                        sequence,
                        json!({ "itemId": null, "delta": format!("片段{sequence}") }).to_string(),
                        now,
                    ],
                )
                .unwrap();
        }
        database
            .connection()
            .execute(
                r#"
                INSERT INTO agent_run_execution_evidence(
                    id, agent_run_id, execution_epoch, sequence,
                    event_type, kind, phase, source_event_key,
                    payload_preview_json, content_blob_id,
                    content_byte_count, is_truncated, occurred_at
                ) VALUES (
                    'evidence-4', ?1, 0, 4, 'activity.completed', 'command',
                    'completed', 'activity.completed:command-1:completed',
                    ?2, NULL, 96, 0, ?3
                )
                "#,
                params![
                    agent_run_id,
                    json!({
                        "item": {
                            "id": "command-1",
                            "type": "commandExecution",
                            "status": "completed"
                        }
                    })
                    .to_string(),
                    now,
                ],
            )
            .unwrap();
        database
            .connection()
            .execute(
                r#"
                INSERT INTO canonical_runtime_activity(
                    agent_run_id, execution_epoch, operation_id, classifier_version,
                    activity_domain, semantic_kind, tool_name, presentation_hint,
                    phase, outcome, credibility, coverage_level, source_authority,
                    source_evidence_ids_json, first_evidence_sequence,
                    last_evidence_sequence, revision, created_at, updated_at
                ) VALUES (
                    ?1, 0, 'operation-command-1', 'activity-v1',
                    'shell', 'shell.execute', NULL, '执行 Shell 命令',
                    'terminal', 'succeeded', 'runtime_structured', 'fine_grained',
                    'runtime', '["evidence-3","evidence-4"]', 3, 4, 1, ?2, ?2
                )
                "#,
                params![agent_run_id, now],
            )
            .unwrap();

        let read_model = ReadModelService;
        let snapshot = read_model.camp_snapshot(&mut database, camp_id).unwrap();
        assert_eq!(snapshot.agent_runs[0].execution_evidence_count, 4);
        assert_eq!(
            snapshot
                .execution_evidence
                .iter()
                .find(|evidence| evidence.id == "evidence-4")
                .and_then(|evidence| evidence.canonical.as_ref())
                .map(|canonical| canonical.activity_domain.as_str()),
            Some("shell")
        );
        assert_eq!(
            snapshot
                .execution_evidence
                .iter()
                .find(|evidence| evidence.id == "evidence-3")
                .and_then(|evidence| evidence.canonical.as_ref())
                .map(|canonical| canonical.operation_id.as_str()),
            Some("operation-command-1")
        );

        let first = read_model
            .agent_run_execution_evidence_page(&mut database, camp_id, agent_run_id, 0, 2)
            .unwrap();
        assert_eq!(first.schema_version, EXECUTION_EVIDENCE_PAGE_SCHEMA_VERSION);
        assert_eq!(first.requested_after_sequence, 0);
        assert_eq!(first.next_after_sequence, 2);
        assert_eq!(first.through_sequence, 4);
        assert!(first.has_more);
        assert_eq!(
            first
                .evidence
                .iter()
                .map(|evidence| evidence.sequence)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );

        let second = read_model
            .agent_run_execution_evidence_page(
                &mut database,
                camp_id,
                agent_run_id,
                first.next_after_sequence,
                2,
            )
            .unwrap();
        assert!(!second.has_more);
        assert_eq!(second.next_after_sequence, 4);
        assert_eq!(second.evidence.len(), 2);
        assert_eq!(second.evidence[0].payload["delta"], "片段3");
        assert_eq!(
            second.evidence[0]
                .canonical
                .as_ref()
                .map(|canonical| canonical.operation_id.as_str()),
            Some("operation-command-1")
        );
        assert_eq!(
            second.evidence[1]
                .canonical
                .as_ref()
                .map(|canonical| canonical.semantic_kind.as_deref()),
            Some(Some("shell.execute"))
        );
        assert!(
            read_model
                .agent_run_execution_evidence_page(
                    &mut database,
                    "another-camp",
                    agent_run_id,
                    0,
                    2,
                )
                .is_err()
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn snapshot_batches_canonical_activity_for_the_full_evidence_window() {
        let directory =
            std::env::temp_dir().join(format!("rovai-evidence-batch-test-{}", Uuid::new_v4()));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = Database::open(&directory).unwrap();
        configure_test_runtime(&database, &["agent_1"]);
        let created = CollaborationService::default()
            .create_test_camp_conversation(
                &mut database,
                &user_envelope(
                    "evidence-batch-create",
                    None,
                    TestCampConversationCommand {
                        project_path: workspace.to_string_lossy().to_string(),
                        project_binding_kind: ProjectBindingKind::Directory,
                        body: "验证完整 Evidence 窗口批量投影".to_string(),
                        address: TestCampMessageAddress::Default,
                        purpose: "验证 Snapshot 批量 Canonical Activity".to_string(),
                    },
                ),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"].as_str().unwrap();
        let agent_run_id = created.result.payload["agentRunIds"][0].as_str().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let transaction = database.connection_mut().transaction().unwrap();
        {
            let mut statement = transaction
                .prepare(
                    r#"
                    INSERT INTO agent_run_execution_evidence(
                        id, agent_run_id, execution_epoch, sequence,
                        event_type, kind, phase, source_event_key,
                        payload_preview_json, content_blob_id,
                        content_byte_count, is_truncated, occurred_at
                    ) VALUES (
                        ?1, ?2, 0, ?3, 'activity.completed', 'command',
                        'completed', NULL, ?4, NULL, 32, 0, ?5
                    )
                    "#,
                )
                .unwrap();
            for sequence in 1..=EXECUTION_EVIDENCE_SNAPSHOT_LIMIT {
                statement
                    .execute(params![
                        format!("batch-evidence-{sequence}"),
                        agent_run_id,
                        sequence,
                        json!({ "sequence": sequence }).to_string(),
                        now,
                    ])
                    .unwrap();
            }
        }
        let group_count = (EXECUTION_EVIDENCE_SNAPSHOT_LIMIT + 99) / 100;
        for group in 0..group_count {
            let first_sequence = group * 100 + 1;
            let last_sequence = (first_sequence + 99).min(EXECUTION_EVIDENCE_SNAPSHOT_LIMIT);
            let evidence_ids = (first_sequence..=last_sequence)
                .map(|sequence| format!("batch-evidence-{sequence}"))
                .collect::<Vec<_>>();
            transaction
                .execute(
                    r#"
                    INSERT INTO canonical_runtime_activity(
                        agent_run_id, execution_epoch, operation_id, classifier_version,
                        activity_domain, semantic_kind, tool_name, presentation_hint,
                        phase, outcome, credibility, coverage_level, source_authority,
                        source_evidence_ids_json, first_evidence_sequence,
                        last_evidence_sequence, revision, created_at, updated_at
                    ) VALUES (
                        ?1, 0, ?2, 'activity-v1', 'shell', 'shell.execute', NULL,
                        '执行 Shell 命令', 'terminal', 'succeeded',
                        'runtime_structured', 'fine_grained', 'runtime',
                        ?3, ?4, ?5, 1, ?6, ?6
                    )
                    "#,
                    params![
                        agent_run_id,
                        format!("batch-operation-{group}"),
                        serde_json::to_string(&evidence_ids).unwrap(),
                        first_sequence,
                        last_sequence,
                        now,
                    ],
                )
                .unwrap();
        }
        transaction.commit().unwrap();

        let snapshot = ReadModelService
            .camp_snapshot(&mut database, camp_id)
            .unwrap();
        assert_eq!(
            snapshot.execution_evidence.len(),
            EXECUTION_EVIDENCE_SNAPSHOT_LIMIT as usize
        );
        assert!(
            snapshot
                .execution_evidence
                .iter()
                .all(|evidence| evidence.canonical.is_some())
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn event_reader_requests_snapshot_after_retention_gap() {
        let directory =
            std::env::temp_dir().join(format!("rovai-read-gap-test-{}", Uuid::new_v4()));
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
