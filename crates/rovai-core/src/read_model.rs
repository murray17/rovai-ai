use std::{cmp::Ordering, collections::BTreeMap, path::Path};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    agent_run_file_change::{AgentRunFileChangesView, list_completed_run_file_changes},
    agent_run_image::{AgentRunImagesView, list_camp_images},
    camp_attachment::{DIRECTORY_MEDIA_TYPE, managed_attachment_summary},
    camp_content::{StructuredCampMessageContent, normalize_content, render_current_plain_text},
    camp_message_publication::{
        public_camp_message_event_predicate, public_camp_message_publication_cte,
    },
    canonical_activity::CanonicalRuntimeActivity,
    command::canonical_json_digest,
    current_input_skill::CurrentInputSkillResolution,
    db::Database,
    git::{GitCapabilityState, GitObservation},
    mcp_projection::McpExposureSnapshot,
    runtime_failure::RuntimeFailureView,
    skill_projection::SkillExposureSnapshot,
};

pub const READ_MODEL_SCHEMA_VERSION: i64 = 34;
pub const EVENT_BATCH_SCHEMA_VERSION: i64 = 9;
pub const NAVIGATION_SCHEMA_VERSION: i64 = 3;
pub const EXECUTION_EVIDENCE_PAGE_SCHEMA_VERSION: i64 = 1;
pub const CAMP_MESSAGE_AROUND_SCHEMA_VERSION: i64 = 1;
pub const CAMP_MESSAGE_FIND_SCHEMA_VERSION: i64 = 1;
pub const CAMP_OPEN_SCHEMA_VERSION: i64 = 6;
pub const CAMP_MESSAGE_PAGE_SCHEMA_VERSION: i64 = 1;
pub const AGENT_RUN_DIAGNOSTIC_SCHEMA_VERSION: i64 = 1;
pub const NAVIGATION_RECENT_CAMP_LIMIT: usize = 5;
const EXECUTION_EVIDENCE_SNAPSHOT_LIMIT: i64 = 1_200;
const CAMP_MESSAGE_AROUND_RADIUS: i64 = 20;
const CAMP_MESSAGE_FIND_QUERY_MAX_SCALARS: usize = 512;
const CAMP_OPEN_TASK_LIMIT: i64 = 100;
const CAMP_OPEN_MESSAGE_LIMIT: i64 = 20;
const CAMP_OPEN_DELIVERY_LIMIT: i64 = 200;
const CAMP_OPEN_TURN_LIMIT: i64 = 64;
const CAMP_OPEN_AGENT_RUN_LIMIT: i64 = 96;
const CAMP_OPEN_APPROVAL_LIMIT: i64 = 32;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_source: Option<CampChannelSource>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_source: Option<CampChannelSource>,
    pub activation_state: String,
    pub project_binding_kind: String,
    pub project_path: String,
    pub default_lead_agent_id: Option<String>,
    pub membership_generation: i64,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampChannelSource {
    pub provider: String,
    pub conversation_kind: String,
}

pub(crate) fn camp_channel_source_from_row(
    row: &rusqlite::Row<'_>,
    column: usize,
) -> rusqlite::Result<Option<CampChannelSource>> {
    let provider = row.get::<_, Option<String>>(column)?;
    let conversation_kind = row.get::<_, Option<String>>(column + 1)?;
    Ok(provider
        .zip(conversation_kind)
        .and_then(|(provider, conversation_kind)| {
            matches!(
                (provider.as_str(), conversation_kind.as_str()),
                ("feishu", "p2p" | "group" | "topic") | ("dingtalk", "p2p" | "group")
            )
            .then_some(CampChannelSource {
                provider,
                conversation_kind,
            })
        }))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampMemberView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fast: Option<crate::camp_fast::CampMemberFastView>,
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
pub struct CampMembershipReconciliationView {
    pub id: String,
    pub agent_id: String,
    pub membership_version: i64,
    pub status: String,
    pub reason_code: String,
    pub target_run_count: i64,
    pub settled_run_count: i64,
    pub created_at: String,
    pub updated_at: String,
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
    pub author_display_name: Option<String>,
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
    pub runtime_projection_state: String,
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
pub struct AgentRunRuntimeModelView {
    pub model_id: Option<String>,
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
    pub cancel_requested_at: Option<String>,
    pub cancel_reason_code: Option<String>,
    pub cancel_acknowledged_at: Option<String>,
    pub terminal_resolution_source: Option<String>,
    pub terminal_reason_code: Option<String>,
    pub failure: Option<RuntimeFailureView>,
    pub runtime_model: Option<AgentRunRuntimeModelView>,
    pub execution_epoch: i64,
    pub permission_semantics: String,
    pub invocation_kind: String,
    pub trigger_delivery_generation: i64,
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
pub struct AgentRunDiagnosticRuntimeView {
    pub adapter_kind: String,
    pub runtime_installation_id: Option<String>,
    pub effective_config_digest: String,
    pub binding_compatibility_digest: Option<String>,
    pub permission_semantics: String,
    pub observed_model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunDiagnosticOutputView {
    pub final_output_digest: Option<String>,
    pub final_camp_message_id: Option<String>,
    pub public_output: Option<String>,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunDiagnosticGitView {
    pub starting: Option<AgentRunDiagnosticGitObservationView>,
    pub ending: Option<AgentRunDiagnosticGitObservationView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunDiagnosticGitObservationView {
    pub state: GitCapabilityState,
    pub object_format: Option<String>,
    pub head_commit: Option<String>,
    pub branch: Option<String>,
    pub dirty: Option<bool>,
    pub observed_at: String,
}

impl From<GitObservation> for AgentRunDiagnosticGitObservationView {
    fn from(observation: GitObservation) -> Self {
        Self {
            state: observation.state,
            object_format: observation.object_format,
            head_commit: observation.head_commit,
            branch: observation.branch,
            dirty: observation.dirty,
            observed_at: observation.observed_at,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunDiagnosticContextManifestView {
    pub manifest_id: Option<String>,
    pub rendered_payload_digest: Option<String>,
    pub charter_delivery_mode: Option<String>,
    pub camp_message_boundary_sequence: Option<i64>,
    pub skill_exposure_digest: Option<String>,
    pub mcp_exposure_digest: Option<String>,
    pub mcp_projection_digest: Option<String>,
    pub attachment_digest: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunDiagnosticEvidenceView {
    pub count: i64,
    pub first_evidence_sequence: Option<i64>,
    pub last_evidence_sequence: Option<i64>,
}

/// Closed, user-readable execution summary for local Runtime diagnostics.
///
/// This view deliberately excludes the raw effective Runtime configuration,
/// Runtime input, Bootstrap, Dynamic Context, environment and credentials.
/// Runtime final output is not a durable Core fact; only an explicitly
/// published Camp message may appear as `publicOutput`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunDiagnosticView {
    pub schema_version: i64,
    pub agent_run_id: String,
    pub execution_epoch: i64,
    pub camp_id: String,
    pub camp_turn_id: String,
    pub conversation_id: String,
    pub agent_id: String,
    pub status: String,
    pub wait_reason: Option<String>,
    pub failure: Option<RuntimeFailureView>,
    pub version: i64,
    pub created_at: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub runtime: AgentRunDiagnosticRuntimeView,
    pub output: AgentRunDiagnosticOutputView,
    pub git: AgentRunDiagnosticGitView,
    pub context_manifest: AgentRunDiagnosticContextManifestView,
    pub evidence: AgentRunDiagnosticEvidenceView,
    pub observed_through_global_sequence: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub run_fact_refs: Vec<RunFactRefView>,
    pub run_fact_payload: Value,
    pub run_fact_digest: String,
    pub current_input_source: Value,
    pub attachment_refs: Vec<CampAttachmentRefView>,
    pub attachment_digest: String,
    pub skill_exposure: SkillExposureSnapshot,
    pub skill_exposure_digest: String,
    pub current_input_skill_resolution: CurrentInputSkillResolution,
    pub current_input_skill_resolution_digest: String,
    pub message_projection_audience: String,
    pub a2a_guidance_evidence: Value,
    pub a2a_guidance_evidence_digest: String,
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
pub struct RunFactRefView {
    pub fact: String,
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
    pub membership_reconciliations: Vec<CampMembershipReconciliationView>,
    pub tasks: Vec<TaskView>,
    pub messages: Vec<CampMessageView>,
    pub message_deliveries: Vec<MessageDeliveryView>,
    pub turns: Vec<CampTurnView>,
    pub agent_runs: Vec<AgentRunView>,
    pub execution_evidence: Vec<AgentRunExecutionEvidenceView>,
    pub agent_run_file_changes: Vec<AgentRunFileChangesView>,
    pub agent_run_images: Vec<AgentRunImagesView>,
    pub context_manifests: Vec<ContextManifestView>,
    pub approvals: Vec<ApprovalView>,
    pub actions: Vec<ActionView>,
    pub timeline: Vec<DomainEventView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampOpenCollectionCoverage {
    pub loaded_count: i64,
    pub total_count: i64,
    pub omitted_count: i64,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampOpenMessageCoverage {
    pub loaded_count: i64,
    pub total_count: i64,
    pub omitted_count: i64,
    pub complete: bool,
    pub oldest_loaded_sequence: Option<i64>,
    pub newest_loaded_sequence: Option<i64>,
    pub has_earlier: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampOpenCoverage {
    pub tasks: CampOpenCollectionCoverage,
    pub messages: CampOpenMessageCoverage,
    pub message_deliveries: CampOpenCollectionCoverage,
    pub turns: CampOpenCollectionCoverage,
    pub agent_runs: CampOpenCollectionCoverage,
    pub execution_evidence: CampOpenCollectionCoverage,
    pub approvals: CampOpenCollectionCoverage,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampOpenProjection {
    pub schema_version: i64,
    pub through_global_sequence: i64,
    pub camp: CampView,
    pub members: Vec<CampMemberView>,
    pub membership_reconciliations: Vec<CampMembershipReconciliationView>,
    pub tasks: Vec<TaskView>,
    pub messages: Vec<CampMessageView>,
    pub message_deliveries: Vec<MessageDeliveryView>,
    pub turns: Vec<CampTurnView>,
    pub agent_runs: Vec<AgentRunView>,
    pub execution_evidence: Vec<AgentRunExecutionEvidenceView>,
    pub agent_run_file_changes: Vec<AgentRunFileChangesView>,
    pub agent_run_images: Vec<AgentRunImagesView>,
    pub approvals: Vec<ApprovalView>,
    pub coverage: CampOpenCoverage,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampMessagePage {
    pub schema_version: i64,
    pub camp_id: String,
    pub through_global_sequence: i64,
    pub requested_before_sequence: i64,
    pub next_before_sequence: Option<i64>,
    pub has_more: bool,
    pub messages: Vec<CampMessageView>,
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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CampMessageFindMatch {
    pub message_id: String,
    pub message_sequence: i64,
    pub occurrence_index: i64,
    pub start_offset: i64,
    pub end_offset: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampMessageFindSnapshot {
    pub schema_version: i64,
    pub through_global_sequence: i64,
    pub camp_id: String,
    pub query: String,
    pub total_match_count: i64,
    pub selected_match_index: Option<i64>,
    pub r#match: Option<CampMessageFindMatch>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDeliveryView {
    pub id: String,
    pub message_id: String,
    pub camp_turn_id: String,
    pub task_id: Option<String>,
    pub recipient_agent_id: String,
    pub recipient_membership_version_at_admission: Option<i64>,
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
    #[serde(flatten)]
    pub kind: MessageDeliveryKindView,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "deliveryKind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum MessageDeliveryKindView {
    PublicA2a {
        source_agent_run_id: String,
        dispatch_disposition: String,
        completion_role: Option<String>,
        gather_id: Option<String>,
        gather_dispatch_delivery_id: Option<String>,
        recipient_canonical_position: i64,
        edge_kind: String,
        target_parent_agent_run_id: Option<String>,
        return_to_agent_run_id: Option<String>,
    },
    GatherCompletion {
        dispatch_disposition: String,
        completion_role: String,
        gather_id: String,
        target_conversation_id: String,
    },
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
    pub fn camp_exists(&self, database: &Database, camp_id: &str) -> Result<bool> {
        database
            .connection()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM camp WHERE id = ?1)",
                [camp_id],
                |row| row.get(0),
            )
            .context("failed to check Camp existence")
    }

    pub fn camp_is_pending(&self, database: &Database, camp_id: &str) -> Result<bool> {
        database
            .connection()
            .query_row(
                "SELECT activation_state = 'pending' FROM camp WHERE id = ?1",
                [camp_id],
                |row| row.get(0),
            )
            .optional()
            .map(|pending| pending.unwrap_or(false))
            .context("failed to check Camp activation state")
    }

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
        let membership_reconciliations = load_membership_reconciliations(&transaction, camp_id)?;
        let tasks = load_tasks(&transaction, camp_id, None)?;
        let messages = load_messages(&transaction, camp_id, 1_000)?;
        let message_deliveries = load_message_deliveries(&transaction, camp_id, None)?;
        let turns = load_turns(&transaction, camp_id, None)?;
        let agent_runs = load_agent_runs(&transaction, camp_id, None)?;
        let execution_evidence = load_execution_evidence(
            &transaction,
            camp_id,
            Some(EXECUTION_EVIDENCE_SNAPSHOT_LIMIT),
            false,
        )?;
        let agent_run_file_changes = list_completed_run_file_changes(&transaction, camp_id)?;
        let agent_run_images = list_camp_images(&transaction, camp_id)?;
        let context_manifests = load_context_manifests(&transaction, camp_id)?;
        let approvals = load_approvals(&transaction, camp_id, false, None)?;
        let actions = load_actions(&transaction, camp_id)?;
        let timeline = load_events(
            &transaction,
            Some(camp_id),
            0,
            through_global_sequence,
            500,
            true,
            false,
        )?;
        transaction.commit()?;
        Ok(CampSnapshot {
            schema_version: READ_MODEL_SCHEMA_VERSION,
            through_global_sequence,
            camp,
            members,
            membership_reconciliations,
            tasks,
            messages,
            message_deliveries,
            turns,
            agent_runs,
            execution_evidence,
            agent_run_file_changes,
            agent_run_images,
            context_manifests,
            approvals,
            actions,
            timeline,
        })
    }

    pub fn camp_open_projection(
        &self,
        database: &mut Database,
        camp_id: &str,
    ) -> Result<CampOpenProjection> {
        let transaction = database.connection_mut().transaction()?;
        let through_global_sequence = current_global_sequence(&transaction)?;
        let camp = load_camp(&transaction, camp_id)?.context("Camp does not exist")?;
        let members = load_members(&transaction, camp_id, camp.default_lead_agent_id.as_deref())?;
        let membership_reconciliations = load_membership_reconciliations(&transaction, camp_id)?;
        let counts = load_camp_open_counts(&transaction, camp_id)?;
        let tasks = load_tasks(&transaction, camp_id, Some(CAMP_OPEN_TASK_LIMIT))?;
        let messages = load_open_messages(&transaction, camp_id, CAMP_OPEN_MESSAGE_LIMIT)?;
        let message_deliveries =
            load_message_deliveries(&transaction, camp_id, Some(CAMP_OPEN_DELIVERY_LIMIT))?;
        let turns = load_turns(&transaction, camp_id, Some(CAMP_OPEN_TURN_LIMIT))?;
        let agent_runs = load_agent_runs(&transaction, camp_id, Some(CAMP_OPEN_AGENT_RUN_LIMIT))?;
        let execution_evidence = load_execution_evidence(&transaction, camp_id, None, true)?;
        let agent_run_file_changes = list_completed_run_file_changes(&transaction, camp_id)?;
        let agent_run_images = list_camp_images(&transaction, camp_id)?;
        let approvals =
            load_approvals(&transaction, camp_id, true, Some(CAMP_OPEN_APPROVAL_LIMIT))?;
        let coverage = CampOpenCoverage {
            tasks: collection_coverage(tasks.len(), counts.tasks),
            messages: message_coverage(&messages, counts.messages),
            message_deliveries: collection_coverage(
                message_deliveries.len(),
                counts.message_deliveries,
            ),
            turns: collection_coverage(turns.len(), counts.turns),
            agent_runs: collection_coverage(agent_runs.len(), counts.agent_runs),
            execution_evidence: collection_coverage(
                execution_evidence.len(),
                counts.execution_evidence,
            ),
            approvals: collection_coverage(approvals.len(), counts.pending_approvals),
        };
        transaction.commit()?;
        Ok(CampOpenProjection {
            schema_version: CAMP_OPEN_SCHEMA_VERSION,
            through_global_sequence,
            camp,
            members,
            membership_reconciliations,
            tasks,
            messages,
            message_deliveries,
            turns,
            agent_runs,
            execution_evidence,
            agent_run_file_changes,
            agent_run_images,
            approvals,
            coverage,
        })
    }

    pub fn camp_messages_page(
        &self,
        database: &mut Database,
        camp_id: &str,
        before_sequence: i64,
        through_global_sequence: i64,
        limit: i64,
    ) -> Result<CampMessagePage> {
        if before_sequence <= 0 {
            anyhow::bail!("Camp Message cursor must be positive");
        }
        if through_global_sequence < 0 {
            anyhow::bail!("Camp Message high-water must not be negative");
        }
        let limit = limit.clamp(1, 100);
        let transaction = database.connection_mut().transaction()?;
        let current_sequence = current_global_sequence(&transaction)?;
        if through_global_sequence > current_sequence {
            anyhow::bail!("Camp Message high-water is ahead of the current event sequence");
        }
        load_camp(&transaction, camp_id)?.context("Camp does not exist")?;
        let mut messages = load_messages_before(&transaction, camp_id, before_sequence, limit + 1)?;
        let has_more = messages.len() > limit as usize;
        if has_more {
            messages.remove(0);
        }
        let next_before_sequence = has_more
            .then(|| messages.first().map(|message| message.sequence))
            .flatten();
        transaction.commit()?;
        Ok(CampMessagePage {
            schema_version: CAMP_MESSAGE_PAGE_SCHEMA_VERSION,
            camp_id: camp_id.to_string(),
            through_global_sequence,
            requested_before_sequence: before_sequence,
            next_before_sequence,
            has_more,
            messages,
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

    pub fn camp_messages_find(
        &self,
        database: &mut Database,
        camp_id: &str,
        query: &str,
        selected_match_index: Option<i64>,
        anchor_message_id: Option<&str>,
    ) -> Result<CampMessageFindSnapshot> {
        validate_camp_message_find_query(query)?;

        let transaction = database.connection_mut().transaction()?;
        let through_global_sequence = current_global_sequence(&transaction)?;
        load_camp(&transaction, camp_id)?.context("Camp does not exist")?;
        let anchor_sequence = match anchor_message_id {
            Some(message_id) => transaction
                .query_row(
                    r#"
                    SELECT sequence
                    FROM camp_message
                    WHERE camp_id = ?1
                      AND id = ?2
                      AND tombstoned_at IS NULL
                    "#,
                    params![camp_id, message_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?,
            None => None,
        };
        let mut statement = transaction.prepare(
            r#"
            SELECT id, sequence, structured_content_json
            FROM camp_message
            WHERE camp_id = ?1
              AND tombstoned_at IS NULL
              AND author_type IN ('user', 'agent', 'external_principal')
            ORDER BY sequence ASC, id ASC
            "#,
        )?;
        let rows = statement
            .query_map([camp_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(statement);

        let mut candidates = Vec::<CampMessageFindCandidate>::new();
        for (message_id, message_sequence, structured_content_json) in rows {
            let content =
                serde_json::from_str::<StructuredCampMessageContent>(&structured_content_json)
                    .map(normalize_content)
                    .context("CampMessage Structured Content is invalid")?;
            let body = render_structured_message_content(&transaction, &content)?;
            candidates.push(CampMessageFindCandidate {
                message_id,
                message_sequence,
                body,
            });
        }

        let matches = flatten_camp_message_find_matches(candidates, query);
        let total_match_count = matches.len() as i64;
        let (normalized_selected_index, selected_match) =
            select_camp_message_find_match(&matches, selected_match_index, anchor_sequence);
        transaction.commit()?;

        Ok(CampMessageFindSnapshot {
            schema_version: CAMP_MESSAGE_FIND_SCHEMA_VERSION,
            through_global_sequence,
            camp_id: camp_id.to_string(),
            query: query.to_string(),
            total_match_count,
            selected_match_index: normalized_selected_index,
            r#match: selected_match,
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

    pub fn agent_run_diagnostic(
        &self,
        database: &mut Database,
        agent_run_id: &str,
    ) -> Result<AgentRunDiagnosticView> {
        let transaction = database.connection_mut().transaction()?;
        let observed_through_global_sequence = current_global_sequence(&transaction)?;
        let row = transaction
            .query_row(
                r#"
                SELECT agent_run.id, agent_run.execution_epoch,
                       camp_turn.camp_id, agent_run.camp_turn_id,
                       agent_run.conversation_id, conversation.agent_id,
                       agent_run.status, agent_run.wait_reason,
                       agent_run.public_runtime_failure_json,
                       agent_run.version, agent_run.created_at,
                       agent_run.started_at, agent_run.ended_at,
                       agent_run.runtime_adapter_kind,
                       agent_run.runtime_installation_id,
                       agent_run.effective_config_json,
                       agent_run.runtime_binding_compatibility_digest,
                       agent_run.permission_semantics,
                       agent_run.runtime_observed_model_id,
                       agent_run.starting_git_observation_json,
                       agent_run.ending_git_observation_json,
                       agent_run.final_camp_message_id,
                       (SELECT body FROM camp_message
                        WHERE camp_message.id = agent_run.final_camp_message_id
                          AND camp_message.camp_id = camp_turn.camp_id
                          AND camp_message.tombstoned_at IS NULL),
                       (SELECT json_extract(event_log.payload_json, '$.finalOutputDigest')
                        FROM event_log
                        WHERE event_log.event_type = 'agent_run.succeeded'
                          AND event_log.entity_type = 'agent_run'
                          AND event_log.entity_id = agent_run.id
                        ORDER BY event_log.global_sequence DESC
                        LIMIT 1),
                       (SELECT COUNT(*) FROM agent_run_execution_evidence
                        WHERE agent_run_execution_evidence.agent_run_id = agent_run.id),
                       (SELECT MIN(sequence) FROM agent_run_execution_evidence
                        WHERE agent_run_execution_evidence.agent_run_id = agent_run.id),
                       (SELECT MAX(sequence) FROM agent_run_execution_evidence
                        WHERE agent_run_execution_evidence.agent_run_id = agent_run.id)
                FROM agent_run
                JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
                JOIN conversation ON conversation.id = agent_run.conversation_id
                WHERE agent_run.id = ?1
                "#,
                [agent_run_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, Option<String>>(8)?,
                        row.get::<_, i64>(9)?,
                        row.get::<_, String>(10)?,
                        row.get::<_, Option<String>>(11)?,
                        row.get::<_, Option<String>>(12)?,
                        row.get::<_, Option<String>>(13)?,
                        row.get::<_, Option<String>>(14)?,
                        row.get::<_, String>(15)?,
                        row.get::<_, Option<String>>(16)?,
                        row.get::<_, String>(17)?,
                        row.get::<_, Option<String>>(18)?,
                        row.get::<_, Option<String>>(19)?,
                        row.get::<_, Option<String>>(20)?,
                        row.get::<_, Option<String>>(21)?,
                        row.get::<_, Option<String>>(22)?,
                        row.get::<_, Option<String>>(23)?,
                        row.get::<_, i64>(24)?,
                        row.get::<_, Option<i64>>(25)?,
                        row.get::<_, Option<i64>>(26)?,
                    ))
                },
            )
            .optional()?
            .context("AgentRun does not exist")?;
        let effective_config: Value = serde_json::from_str(&row.15)
            .context("AgentRun effective Runtime configuration is invalid")?;
        let adapter_kind = row
            .13
            .clone()
            .or_else(|| {
                effective_config
                    .get("adapterKind")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .context("AgentRun has no frozen Runtime adapter")?;
        let failure = row
            .8
            .as_deref()
            .map(serde_json::from_str::<RuntimeFailureView>)
            .transpose()
            .context("AgentRun public Runtime failure is invalid")?;
        let starting = row
            .19
            .as_deref()
            .map(serde_json::from_str::<GitObservation>)
            .transpose()
            .context("AgentRun starting Git observation is invalid")?
            .map(AgentRunDiagnosticGitObservationView::from);
        let ending = row
            .20
            .as_deref()
            .map(serde_json::from_str::<GitObservation>)
            .transpose()
            .context("AgentRun ending Git observation is invalid")?
            .map(AgentRunDiagnosticGitObservationView::from);
        let context_manifest = transaction
            .query_row(
                r#"
                SELECT manifest.id, manifest.rendered_payload_digest,
                       bootstrap.delivery_mode,
                       manifest.camp_message_boundary_sequence,
                       manifest.skill_exposure_digest,
                       manifest.mcp_exposure_digest,
                       manifest.mcp_projection_digest,
                       manifest.attachment_digest
                FROM context_manifest AS manifest
                JOIN native_session_bootstrap_evidence AS bootstrap
                  ON bootstrap.id = manifest.bootstrap_evidence_id
                WHERE manifest.agent_run_id = ?1
                ORDER BY manifest.created_at DESC, manifest.id DESC
                LIMIT 1
                "#,
                [agent_run_id],
                |manifest| {
                    Ok(AgentRunDiagnosticContextManifestView {
                        manifest_id: Some(manifest.get(0)?),
                        rendered_payload_digest: Some(manifest.get(1)?),
                        charter_delivery_mode: Some(manifest.get(2)?),
                        camp_message_boundary_sequence: Some(manifest.get(3)?),
                        skill_exposure_digest: Some(manifest.get(4)?),
                        mcp_exposure_digest: Some(manifest.get(5)?),
                        mcp_projection_digest: Some(manifest.get(6)?),
                        attachment_digest: Some(manifest.get(7)?),
                    })
                },
            )
            .optional()?
            .unwrap_or(AgentRunDiagnosticContextManifestView {
                manifest_id: None,
                rendered_payload_digest: None,
                charter_delivery_mode: None,
                camp_message_boundary_sequence: None,
                skill_exposure_digest: None,
                mcp_exposure_digest: None,
                mcp_projection_digest: None,
                attachment_digest: None,
            });
        let unavailable_reason = if row.6 != "succeeded" {
            Some("run_not_succeeded".to_string())
        } else if row.21.is_none() {
            Some("not_published".to_string())
        } else if row.22.is_none() {
            Some("published_message_unavailable".to_string())
        } else {
            None
        };
        let view = AgentRunDiagnosticView {
            schema_version: AGENT_RUN_DIAGNOSTIC_SCHEMA_VERSION,
            agent_run_id: row.0,
            execution_epoch: row.1,
            camp_id: row.2,
            camp_turn_id: row.3,
            conversation_id: row.4,
            agent_id: row.5,
            status: row.6,
            wait_reason: row.7,
            failure,
            version: row.9,
            created_at: row.10,
            started_at: row.11,
            ended_at: row.12,
            runtime: AgentRunDiagnosticRuntimeView {
                adapter_kind,
                runtime_installation_id: row.14,
                effective_config_digest: canonical_json_digest(&effective_config)?,
                binding_compatibility_digest: row.16,
                permission_semantics: row.17,
                observed_model_id: row.18,
            },
            output: AgentRunDiagnosticOutputView {
                final_output_digest: row.23,
                final_camp_message_id: row.21,
                public_output: row.22,
                unavailable_reason,
            },
            git: AgentRunDiagnosticGitView { starting, ending },
            context_manifest,
            evidence: AgentRunDiagnosticEvidenceView {
                count: row.24,
                first_evidence_sequence: row.25,
                last_evidence_sequence: row.26,
            },
            observed_through_global_sequence,
        };
        transaction.commit()?;
        Ok(view)
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
    let publication_predicate = public_camp_message_event_predicate("event_log.event_type");
    let sql = format!(
        r#"
        WITH navigation_activity AS (
            SELECT
                event_log.camp_id,
                MAX(CASE
                    WHEN (
                        {publication_predicate}
                        AND camp_message.author_type IN ('user', 'agent', 'external_principal')
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
            camp.activation_state,
            channel_conversation.provider,
            channel_conversation.conversation_kind
        FROM camp
        LEFT JOIN channel_conversation_binding AS channel_binding ON channel_binding.camp_id = camp.id
        LEFT JOIN channel_conversation ON channel_conversation.id = channel_binding.channel_conversation_id
        LEFT JOIN agent_profile AS lead ON lead.id = camp.default_lead_agent_id
        LEFT JOIN navigation_activity ON navigation_activity.camp_id = camp.id
        LEFT JOIN event_log AS activity_event
          ON activity_event.global_sequence = navigation_activity.last_activity_sequence
        LEFT JOIN camp_view_state ON camp_view_state.camp_id = camp.id
        LEFT JOIN camp_composer_draft ON camp_composer_draft.camp_id = camp.id
        WHERE camp.activation_state = 'active'
           OR length(trim(COALESCE(camp_composer_draft.body, ''))) > 0
           OR EXISTS(SELECT 1 FROM prepared_attachment WHERE camp_id = camp.id)
        "#
    );
    let mut statement = transaction.prepare(&sql)?;
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
            channel_source: camp_channel_source_from_row(row, 13)?,
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

struct CampOpenCounts {
    tasks: i64,
    messages: i64,
    message_deliveries: i64,
    turns: i64,
    agent_runs: i64,
    execution_evidence: i64,
    pending_approvals: i64,
}

fn load_camp_open_counts(transaction: &Transaction<'_>, camp_id: &str) -> Result<CampOpenCounts> {
    transaction
        .query_row(
            r#"
            SELECT
              (SELECT COUNT(*) FROM task WHERE camp_id = ?1),
              (SELECT COUNT(*) FROM camp_message
               WHERE camp_id = ?1 AND tombstoned_at IS NULL),
              (SELECT COUNT(*) FROM message_delivery WHERE camp_id = ?1),
              (SELECT COUNT(*) FROM camp_turn WHERE camp_id = ?1 AND kind = 'camp'),
              (SELECT COUNT(*)
               FROM agent_run
               JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
               WHERE camp_turn.camp_id = ?1
                 AND agent_run.invocation_kind <> 'single_chat'),
              (SELECT COUNT(*)
               FROM agent_run_execution_evidence AS evidence
               JOIN agent_run ON agent_run.id = evidence.agent_run_id
               JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
               WHERE camp_turn.camp_id = ?1
                 AND agent_run.invocation_kind <> 'single_chat'),
              (SELECT COUNT(*)
               FROM approval
               JOIN action_execution ON action_execution.id = approval.action_id
               JOIN agent_run ON agent_run.id = action_execution.agent_run_id
               JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
               WHERE camp_turn.camp_id = ?1 AND approval.status = 'pending')
            "#,
            [camp_id],
            |row| {
                Ok(CampOpenCounts {
                    tasks: row.get(0)?,
                    messages: row.get(1)?,
                    message_deliveries: row.get(2)?,
                    turns: row.get(3)?,
                    agent_runs: row.get(4)?,
                    execution_evidence: row.get(5)?,
                    pending_approvals: row.get(6)?,
                })
            },
        )
        .context("failed to count Camp open projection coverage")
}

fn collection_coverage(loaded_count: usize, total_count: i64) -> CampOpenCollectionCoverage {
    let loaded_count = i64::try_from(loaded_count).unwrap_or(i64::MAX);
    let omitted_count = total_count.saturating_sub(loaded_count);
    CampOpenCollectionCoverage {
        loaded_count,
        total_count,
        omitted_count,
        complete: omitted_count == 0,
    }
}

fn message_coverage(messages: &[CampMessageView], total_count: i64) -> CampOpenMessageCoverage {
    let base = collection_coverage(messages.len(), total_count);
    CampOpenMessageCoverage {
        loaded_count: base.loaded_count,
        total_count: base.total_count,
        omitted_count: base.omitted_count,
        complete: base.complete,
        oldest_loaded_sequence: messages.first().map(|message| message.sequence),
        newest_loaded_sequence: messages.last().map(|message| message.sequence),
        has_earlier: base.omitted_count > 0,
    }
}

fn load_camp(transaction: &Transaction<'_>, camp_id: &str) -> Result<Option<CampView>> {
    transaction
        .query_row(
            r#"
            SELECT camp.id, camp.title, camp.activation_state, camp.project_binding_kind, camp.project_path,
                   camp.default_lead_agent_id, camp.membership_generation,
                   camp.version, camp.created_at, camp.updated_at,
                   channel_conversation.provider, channel_conversation.conversation_kind
            FROM camp
            LEFT JOIN channel_conversation_binding AS channel_binding ON channel_binding.camp_id = camp.id
            LEFT JOIN channel_conversation ON channel_conversation.id = channel_binding.channel_conversation_id
            WHERE camp.id = ?1
            "#,
            [camp_id],
            |row| {
                Ok(CampView {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    channel_source: camp_channel_source_from_row(row, 10)?,
                    activation_state: row.get(2)?,
                    project_binding_kind: row.get(3)?,
                    project_path: row.get(4)?,
                    default_lead_agent_id: row.get(5)?,
                    membership_generation: row.get(6)?,
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
    let mut members = statement
        .query_map([camp_id], |row| {
            let agent_id: String = row.get(0)?;
            Ok(CampMemberView {
                fast: None,
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
        .context("failed to load Camp members")?;
    for member in &mut members {
        member.fast = crate::camp_fast::view_on_connection(transaction, camp_id, &member.agent_id)?;
    }
    Ok(members)
}

fn load_membership_reconciliations(
    transaction: &Transaction<'_>,
    camp_id: &str,
) -> Result<Vec<CampMembershipReconciliationView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, agent_id, membership_version, status, reason_code,
               target_run_count, settled_run_count, created_at, updated_at
        FROM camp_membership_reconciliation
        WHERE camp_id = ?1 AND status = 'reconciling'
        ORDER BY created_at, id
        "#,
    )?;
    statement
        .query_map([camp_id], |row| {
            Ok(CampMembershipReconciliationView {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                membership_version: row.get(2)?,
                status: row.get(3)?,
                reason_code: row.get(4)?,
                target_run_count: row.get(5)?,
                settled_run_count: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .context("failed to load Camp membership reconciliations")
}

fn load_tasks(
    transaction: &Transaction<'_>,
    camp_id: &str,
    limit: Option<i64>,
) -> Result<Vec<TaskView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, camp_id, title, description, acceptance_criteria_json,
               status, assignee_agent_id, blocked_reason, completion_summary, cancel_reason,
               created_by_type, created_by_id, source_agent_run_id,
               closed_by_type, closed_by_id, closed_by_agent_run_id,
               version, created_at, updated_at, closed_at
        FROM task
        WHERE camp_id = ?1
        ORDER BY
          CASE
            WHEN ?2 IS NOT NULL AND status IN ('pending', 'in_progress', 'blocked') THEN 0
            WHEN ?2 IS NOT NULL THEN 1
            ELSE 0
          END,
          created_at DESC, id
        LIMIT COALESCE(?2, -1)
        "#,
    )?;
    let rows = statement.query_map(params![camp_id, limit], |row| {
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

// Camp open reads business projections without resolving publication events.
// Snapshot/history readers retain their event sequence through load_messages.
fn load_open_messages(
    transaction: &Transaction<'_>,
    camp_id: &str,
    limit: i64,
) -> Result<Vec<CampMessageView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, sequence, NULL AS timeline_global_sequence,
               author_type, author_id,
               source_agent_run_id, body, structured_content_json, address_mode,
               addressed_agent_ids_json, reply_to_camp_message_id, camp_turn_id,
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

fn load_messages(
    transaction: &Transaction<'_>,
    camp_id: &str,
    limit: i64,
) -> Result<Vec<CampMessageView>> {
    let publication_cte = public_camp_message_publication_cte();
    let sql = format!(
        r#"
        WITH {publication_cte}
        SELECT camp_message.id, camp_message.sequence,
               publication.global_sequence,
               author_type, author_id,
               source_agent_run_id, body, structured_content_json, address_mode,
               addressed_agent_ids_json,
               reply_to_camp_message_id, camp_turn_id,
               CASE WHEN author_type = 'agent'
                    THEN recipient_presentation_json
                    ELSE presentation_json
               END, created_at
        FROM camp_message
        LEFT JOIN public_camp_message_publication AS publication
          ON publication.message_id = camp_message.id
        WHERE camp_id = ?1 AND tombstoned_at IS NULL
        ORDER BY sequence DESC LIMIT ?2
        "#
    );
    let mut statement = transaction.prepare(&sql)?;
    let rows = statement
        .query_map(params![camp_id, limit], camp_message_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    let mut messages = hydrate_message_views(transaction, rows)?;
    messages.reverse();
    Ok(messages)
}

fn load_messages_before(
    transaction: &Transaction<'_>,
    camp_id: &str,
    before_sequence: i64,
    limit: i64,
) -> Result<Vec<CampMessageView>> {
    let publication_cte = public_camp_message_publication_cte();
    let sql = format!(
        r#"
        WITH {publication_cte}
        SELECT camp_message.id, camp_message.sequence,
               publication.global_sequence,
               author_type, author_id,
               source_agent_run_id, body, structured_content_json, address_mode,
               addressed_agent_ids_json,
               reply_to_camp_message_id, camp_turn_id,
               CASE WHEN author_type = 'agent'
                    THEN recipient_presentation_json
                    ELSE presentation_json
               END, created_at
        FROM camp_message
        LEFT JOIN public_camp_message_publication AS publication
          ON publication.message_id = camp_message.id
        WHERE camp_id = ?1
          AND tombstoned_at IS NULL
          AND sequence < ?2
        ORDER BY sequence DESC, id DESC
        LIMIT ?3
        "#
    );
    let mut statement = transaction.prepare(&sql)?;
    let rows = statement
        .query_map(params![camp_id, before_sequence, limit], camp_message_row)?
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
    let publication_cte = public_camp_message_publication_cte();
    let sql = format!(
        r#"
        WITH {publication_cte}, window_ids(id) AS (
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
               publication.global_sequence,
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
        LEFT JOIN public_camp_message_publication AS publication
          ON publication.message_id = camp_message.id
        ORDER BY camp_message.sequence ASC, camp_message.id ASC
        "#
    );
    let mut statement = transaction.prepare(&sql)?;
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
        SELECT attachment.camp_message_id, attachment.id, attachment.display_name,
               attachment.media_type, attachment.byte_size, attachment.preview_kind,
               attachment.storage_path, attachment.runtime_projection_state,
               attachment.kind, attachment.file_count, attachment.storage_model
        FROM (
            SELECT legacy.camp_message_id, legacy.id, legacy.display_name,
                   legacy.media_type, legacy.byte_size, legacy.preview_kind,
                   legacy.storage_path, legacy.runtime_projection_state,
                   NULL AS kind, NULL AS file_count,
                   'legacy_v1' AS storage_model, legacy.position AS ordinal
            FROM requested
            JOIN message_attachment AS legacy
              ON legacy.camp_message_id = requested.camp_message_id
            UNION ALL
            SELECT reference.camp_message_id, managed.id,
                   reference.display_name_snapshot, managed.media_type,
                   managed.byte_size, managed.preview_kind,
                   managed.root_relative_payload_path, managed.state,
                   managed.kind, managed.file_count,
                   'managed_v2', reference.ordinal
            FROM requested
            JOIN camp_message_attachment_ref AS reference
              ON reference.camp_message_id = requested.camp_message_id
            JOIN managed_attachment AS managed
              ON managed.camp_id = reference.camp_id
             AND managed.id = reference.attachment_id
        ) AS attachment
        ORDER BY attachment.camp_message_id, attachment.ordinal, attachment.id
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
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, String>(10)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut attachments_by_message_id = BTreeMap::<String, Vec<CampMessageAttachmentView>>::new();
    for (
        message_id,
        id,
        display_name,
        media_type,
        byte_size,
        preview_kind,
        storage_path,
        runtime_projection_state,
        persisted_kind,
        persisted_file_count,
        storage_model,
    ) in attachment_rows
    {
        let (kind, file_count) = if storage_model == "managed_v2" {
            (
                persisted_kind.context("Managed Attachment has no persisted kind")?,
                u64::try_from(
                    persisted_file_count
                        .context("Managed Attachment has no persisted file count")?,
                )?,
            )
        } else if runtime_projection_state == "available" {
            let summary = managed_attachment_summary(Path::new(&storage_path), &media_type)?;
            (summary.kind, summary.file_count)
        } else if media_type == DIRECTORY_MEDIA_TYPE {
            // Pending/recovery/failed cards are a semantic projection. Their Authority source
            // may be unavailable (and can be the reason for a terminal tombstone), so Camp
            // reads must not traverse it merely to render a status card.
            ("directory".to_string(), 0)
        } else {
            ("file".to_string(), 1)
        };
        let attachment = CampMessageAttachmentView {
            id,
            display_name,
            kind,
            file_count,
            media_type,
            byte_size,
            preview_kind,
            runtime_projection_state,
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
            let author_display_name = if row.author_type == "external_principal" {
                transaction
                    .query_row(
                        "SELECT display_name FROM external_principal WHERE id = ?1",
                        [&row.author_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
            } else {
                None
            };
            Ok(CampMessageView {
                id: row.id,
                sequence: row.sequence,
                timeline_global_sequence: row.timeline_global_sequence,
                author_type: row.author_type,
                author_id: row.author_id,
                author_display_name,
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

fn validate_camp_message_find_query(query: &str) -> Result<()> {
    if query.trim().is_empty() {
        anyhow::bail!("Camp Message find query must not be blank");
    }
    if query.chars().count() > CAMP_MESSAGE_FIND_QUERY_MAX_SCALARS {
        anyhow::bail!(
            "Camp Message find query must not exceed {CAMP_MESSAGE_FIND_QUERY_MAX_SCALARS} Unicode scalars"
        );
    }
    Ok(())
}

fn fold_with_source_offsets(value: &str) -> (Vec<char>, Vec<usize>) {
    let mut folded = Vec::new();
    let mut source_offsets = Vec::new();
    for (source_offset, character) in value.chars().enumerate() {
        for folded_character in character.to_lowercase() {
            folded.push(folded_character);
            source_offsets.push(source_offset);
        }
    }
    (folded, source_offsets)
}

fn case_insensitive_scalar_match_ranges(value: &str, query: &str) -> Vec<(usize, usize)> {
    let (folded_value, source_offsets) = fold_with_source_offsets(value);
    let (folded_query, _) = fold_with_source_offsets(query);
    if folded_query.is_empty() || folded_query.len() > folded_value.len() {
        return Vec::new();
    }

    let mut ranges = Vec::<(usize, usize)>::new();
    let mut folded_offset = 0;
    while folded_offset + folded_query.len() <= folded_value.len() {
        if folded_value[folded_offset..folded_offset + folded_query.len()] == folded_query {
            let start_offset = source_offsets[folded_offset];
            let end_offset = source_offsets[folded_offset + folded_query.len() - 1] + 1;
            let does_not_overlap = match ranges.last() {
                Some((_, previous_end)) => start_offset >= *previous_end,
                None => true,
            };
            if does_not_overlap {
                ranges.push((start_offset, end_offset));
            }
            folded_offset += folded_query.len();
        } else {
            folded_offset += 1;
        }
    }
    ranges
}

struct CampMessageFindCandidate {
    message_id: String,
    message_sequence: i64,
    body: String,
}

fn flatten_camp_message_find_matches(
    mut candidates: Vec<CampMessageFindCandidate>,
    query: &str,
) -> Vec<CampMessageFindMatch> {
    candidates.sort_by(|left, right| {
        left.message_sequence
            .cmp(&right.message_sequence)
            .then_with(|| left.message_id.cmp(&right.message_id))
    });
    candidates
        .into_iter()
        .flat_map(|candidate| {
            case_insensitive_scalar_match_ranges(&candidate.body, query)
                .into_iter()
                .enumerate()
                .map(
                    move |(occurrence_index, (start_offset, end_offset))| CampMessageFindMatch {
                        message_id: candidate.message_id.clone(),
                        message_sequence: candidate.message_sequence,
                        occurrence_index: occurrence_index as i64,
                        start_offset: start_offset as i64,
                        end_offset: end_offset as i64,
                    },
                )
        })
        .collect()
}

fn select_camp_message_find_match(
    matches: &[CampMessageFindMatch],
    requested_index: Option<i64>,
    anchor_sequence: Option<i64>,
) -> (Option<i64>, Option<CampMessageFindMatch>) {
    let total_match_count = matches.len() as i64;
    let selected_index = if total_match_count == 0 {
        None
    } else if let Some(index) = requested_index {
        Some(index.rem_euclid(total_match_count))
    } else {
        Some(
            anchor_sequence
                .and_then(|sequence| {
                    matches
                        .iter()
                        .position(|candidate| candidate.message_sequence >= sequence)
                })
                .unwrap_or(0) as i64,
        )
    };
    let selected_match = selected_index
        .and_then(|index| matches.get(index as usize))
        .cloned();
    (selected_index, selected_match)
}

fn load_turns(
    transaction: &Transaction<'_>,
    camp_id: &str,
    limit: Option<i64>,
) -> Result<Vec<CampTurnView>> {
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
               execution_budget_root_agent_run_responsibilities
                 + agent_run_responsibilities_allocated,
               accepted_a2a_allocated,
               execution_budget_exhausted_at,
               execution_budget_exhaustion_reason,
               execution_budget_exhaustion_command_id,
               version, created_at, updated_at, ended_at
        FROM camp_turn WHERE camp_id = ?1 AND kind = 'camp'
        ORDER BY
          CASE
            WHEN ?2 IS NOT NULL AND status IN ('running', 'waiting') THEN 0
            WHEN ?2 IS NOT NULL THEN 1
            ELSE 0
          END,
          created_at DESC, id
        LIMIT COALESCE(?2, -1)
        "#,
    )?;
    statement
        .query_map(params![camp_id, limit], |row| {
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
    limit: Option<i64>,
) -> Result<Vec<MessageDeliveryView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, message_id, camp_turn_id, task_id, recipient_agent_id,
               status, dispatch_phase,
               wait_condition, dispatch_attempt_count, retry_generation,
               context_manifest_id, target_agent_run_id,
               manual_intervention_required, failure_code,
               version, created_at, updated_at, ended_at,
               delivery_kind, dispatch_disposition, completion_role,
               gather_id, gather_dispatch_delivery_id,
               recipient_canonical_position, edge_kind,
               target_parent_agent_run_id, return_to_agent_run_id,
               target_conversation_id,
               recipient_membership_version_at_admission, source_agent_run_id
        FROM message_delivery
        WHERE camp_id = ?1
        ORDER BY
          CASE
            WHEN ?2 IS NOT NULL
             AND status IN ('pending', 'running') THEN 0
            WHEN ?2 IS NOT NULL THEN 1
            ELSE 0
          END,
          CASE WHEN ?2 IS NULL THEN created_at END ASC,
          CASE WHEN ?2 IS NOT NULL THEN created_at END DESC,
          queue_sequence, id
        LIMIT COALESCE(?2, -1)
        "#,
    )?;
    let mut deliveries = statement
        .query_map(params![camp_id, limit], |row| {
            let delivery_kind = row.get::<_, String>(18)?;
            let kind = match delivery_kind.as_str() {
                "public_a2a" => MessageDeliveryKindView::PublicA2a {
                    source_agent_run_id: row.get(29)?,
                    dispatch_disposition: row.get(19)?,
                    completion_role: row.get(20)?,
                    gather_id: row.get(21)?,
                    gather_dispatch_delivery_id: row.get(22)?,
                    recipient_canonical_position: row.get::<_, Option<i64>>(23)?.ok_or_else(
                        || {
                            rusqlite::Error::InvalidColumnType(
                                23,
                                "recipient_canonical_position".to_string(),
                                rusqlite::types::Type::Null,
                            )
                        },
                    )?,
                    edge_kind: row.get::<_, Option<String>>(24)?.ok_or_else(|| {
                        rusqlite::Error::InvalidColumnType(
                            24,
                            "edge_kind".to_string(),
                            rusqlite::types::Type::Null,
                        )
                    })?,
                    target_parent_agent_run_id: row.get(25)?,
                    return_to_agent_run_id: row.get(26)?,
                },
                "gather_completion" => MessageDeliveryKindView::GatherCompletion {
                    dispatch_disposition: row.get(19)?,
                    completion_role: row.get::<_, Option<String>>(20)?.ok_or_else(|| {
                        rusqlite::Error::InvalidColumnType(
                            20,
                            "completion_role".to_string(),
                            rusqlite::types::Type::Null,
                        )
                    })?,
                    gather_id: row.get::<_, Option<String>>(21)?.ok_or_else(|| {
                        rusqlite::Error::InvalidColumnType(
                            21,
                            "gather_id".to_string(),
                            rusqlite::types::Type::Null,
                        )
                    })?,
                    target_conversation_id: row.get::<_, Option<String>>(27)?.ok_or_else(|| {
                        rusqlite::Error::InvalidColumnType(
                            27,
                            "target_conversation_id".to_string(),
                            rusqlite::types::Type::Null,
                        )
                    })?,
                },
                _ => return Err(rusqlite::Error::InvalidQuery),
            };
            Ok(MessageDeliveryView {
                id: row.get(0)?,
                message_id: row.get(1)?,
                camp_turn_id: row.get(2)?,
                task_id: row.get(3)?,
                recipient_agent_id: row.get(4)?,
                recipient_membership_version_at_admission: row.get(28)?,
                status: row.get(5)?,
                dispatch_phase: row.get(6)?,
                wait_condition: row.get(7)?,
                dispatch_attempt_count: row.get(8)?,
                retry_generation: row.get(9)?,
                context_manifest_id: row.get(10)?,
                target_agent_run_id: row.get(11)?,
                manual_intervention_required: row.get::<_, i64>(12)? != 0,
                failure_code: row.get(13)?,
                version: row.get(14)?,
                created_at: row.get(15)?,
                updated_at: row.get(16)?,
                ended_at: row.get(17)?,
                kind,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if limit.is_some() {
        deliveries.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });
    }
    Ok(deliveries)
}

fn load_agent_runs(
    transaction: &Transaction<'_>,
    camp_id: &str,
    limit: Option<i64>,
) -> Result<Vec<AgentRunView>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT agent_run.id, agent_run.camp_turn_id,
               agent_run.conversation_id, conversation.agent_id,
               agent_run.task_id, agent_run.responsibility_key,
               agent_run.responsibility_generation, agent_run.purpose,
               agent_run.completion_role,
               CASE
                 WHEN agent_run.status = 'failed'
                  AND COALESCE(agent_run.last_error_code, '') = 'accepted_input_outcome_unknown'
                  AND agent_run.cancel_requested_at IS NOT NULL
                  AND agent_run.terminal_resolution_source IS NULL
                 THEN 'cancelled'
                 ELSE agent_run.status
               END,
               agent_run.wait_reason,
               agent_run.cancel_requested_at,
               agent_run.cancel_reason_code,
               agent_run.cancel_acknowledged_at,
               agent_run.terminal_resolution_source,
               agent_run.terminal_reason_code,
               agent_run.execution_epoch, agent_run.permission_semantics,
               agent_run.invocation_kind,
               agent_run.trigger_delivery_generation,
               agent_run.a2a_parent_agent_run_id,
               agent_run.a2a_root_agent_run_id, agent_run.a2a_depth,
               (SELECT COUNT(*)
                FROM agent_run_execution_evidence
                WHERE agent_run_execution_evidence.agent_run_id = agent_run.id),
               CASE
                 WHEN agent_run.cancel_requested_at IS NOT NULL
                  AND agent_run.terminal_resolution_source IS NULL
                  AND (
                    agent_run.status = 'cancelled'
                    OR (
                      agent_run.status = 'failed'
                      AND COALESCE(agent_run.last_error_code, '') = 'accepted_input_outcome_unknown'
                    )
                  )
                 THEN 0
                 ELSE (
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
                 OR COALESCE(agent_run.last_error_code, '') = 'accepted_input_outcome_unknown'
                 OR (
                   agent_run.status IN ('failed', 'cancelled')
                   AND COALESCE(agent_run.last_error_code, '')
                       IN ('planned_shutdown_outcome_unknown', 'accepted_input_outcome_unknown')
                   AND EXISTS(
                     SELECT 1 FROM runtime_input_delivery
                     WHERE runtime_input_delivery.agent_run_id = agent_run.id
                       AND runtime_input_delivery.status = 'accepted'
                   )
                 )
               ) END,
               agent_run.workspace_json,
               agent_run.starting_git_observation_json,
               agent_run.ending_git_observation_json,
               camp.project_path, agent_run.version,
               agent_run.created_at, agent_run.started_at,
               agent_run.ended_at, agent_run.updated_at,
               agent_run.public_runtime_failure_json,
               json_extract(agent_run.runtime_model_selection_json, '$.source'),
               agent_run.runtime_observed_model_id
        FROM agent_run
        JOIN camp_turn ON camp_turn.id = agent_run.camp_turn_id
        JOIN camp ON camp.id = camp_turn.camp_id
        JOIN conversation ON conversation.id = agent_run.conversation_id
        WHERE camp_turn.camp_id = ?1
          AND agent_run.invocation_kind <> 'single_chat'
        ORDER BY
          CASE
            WHEN ?2 IS NOT NULL
             AND (agent_run.status IN ('queued', 'running', 'waiting') OR (
               agent_run.status IN ('failed', 'cancelled')
               AND COALESCE(agent_run.last_error_code, '') IN ('planned_shutdown_outcome_unknown', 'accepted_input_outcome_unknown')
               AND NOT (
                 agent_run.cancel_requested_at IS NOT NULL
                 AND agent_run.terminal_resolution_source IS NULL
               )
             )) THEN 0
            WHEN ?2 IS NOT NULL THEN 1
            ELSE 0
          END,
          agent_run.created_at DESC, agent_run.id
        LIMIT COALESCE(?2, -1)
        "#,
    )?;
    let rows = statement
        .query_map(params![camp_id, limit], |row| {
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
                row.get::<_, Option<String>>(13)?,
                row.get::<_, Option<String>>(14)?,
                row.get::<_, Option<String>>(15)?,
                row.get::<_, i64>(16)?,
                row.get::<_, String>(17)?,
                row.get::<_, String>(18)?,
                row.get::<_, i64>(19)?,
                row.get::<_, Option<String>>(20)?,
                row.get::<_, Option<String>>(21)?,
                row.get::<_, i64>(22)?,
                row.get::<_, i64>(23)?,
                row.get::<_, i64>(24)? != 0,
                row.get::<_, Option<String>>(25)?,
                row.get::<_, Option<String>>(26)?,
                row.get::<_, Option<String>>(27)?,
                row.get::<_, String>(28)?,
                row.get::<_, i64>(29)?,
                row.get::<_, String>(30)?,
                row.get::<_, Option<String>>(31)?,
                row.get::<_, Option<String>>(32)?,
                row.get::<_, String>(33)?,
                row.get::<_, Option<String>>(34)?,
                row.get::<_, Option<String>>(35)?,
                row.get::<_, Option<String>>(36)?,
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
                cancel_requested_at,
                cancel_reason_code,
                cancel_acknowledged_at,
                terminal_resolution_source,
                terminal_reason_code,
                execution_epoch,
                permission_semantics,
                invocation_kind,
                trigger_delivery_generation,
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
                public_runtime_failure_json,
                runtime_model_source,
                runtime_observed_model_id,
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
                    cancel_requested_at,
                    cancel_reason_code,
                    cancel_acknowledged_at,
                    terminal_resolution_source,
                    terminal_reason_code,
                    failure: public_runtime_failure_json
                        .map(|value| serde_json::from_str(&value))
                        .transpose()
                        .context("AgentRun public Runtime failure is invalid")?,
                    runtime_model: (runtime_model_source.as_deref() == Some("runtime_default"))
                        .then_some(AgentRunRuntimeModelView {
                            model_id: runtime_observed_model_id,
                        }),
                    execution_epoch,
                    permission_semantics,
                    invocation_kind,
                    trigger_delivery_generation,
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
    limit: Option<i64>,
    active_only: bool,
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
            AND agent_run.invocation_kind <> 'single_chat'
            AND (?3 = 0 OR agent_run.status IN ('queued', 'running', 'waiting'))
          ORDER BY evidence.occurred_at DESC,
                   evidence.agent_run_id DESC, evidence.sequence DESC
          LIMIT ?2
        )
        ORDER BY occurred_at, agent_run_id, sequence
        "#,
    )?;
    let mut evidence = statement
        .query_map(
            params![camp_id, limit.unwrap_or(-1), active_only],
            execution_evidence_row,
        )?
        .map(|row| execution_evidence_view(row?))
        .collect::<Result<Vec<_>>>()?;
    attach_canonical_activity(transaction, &mut evidence)?;
    Ok(evidence)
}

pub(crate) fn public_execution_evidence_for_agent_run(
    connection: &Connection,
    agent_run_id: &str,
) -> Result<Vec<AgentRunExecutionEvidenceView>> {
    let mut statement = connection.prepare(
        r#"
        SELECT evidence.id, evidence.agent_run_id, evidence.execution_epoch,
               evidence.sequence, evidence.event_type, evidence.kind,
               evidence.phase, evidence.payload_preview_json,
               evidence.content_blob_id, evidence.content_byte_count,
               evidence.is_truncated, evidence.occurred_at
        FROM agent_run_execution_evidence AS evidence
        WHERE evidence.agent_run_id = ?1
          AND evidence.event_type NOT IN (
              'agent.reasoning.summary.delta', 'agent.thought.delta',
              'runtime.compaction.display'
          )
        ORDER BY evidence.sequence
        "#,
    )?;
    let mut evidence = statement
        .query_map([agent_run_id], execution_evidence_row)?
        .map(|row| execution_evidence_view(row?))
        .collect::<Result<Vec<_>>>()?;
    drop(statement);
    attach_canonical_activity(connection, &mut evidence)?;
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
    connection: &Connection,
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
    let mut statement = connection.prepare(
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
               activity.presentation_hint, activity.diff_projection_json,
               activity.phase, activity.outcome,
               activity.credibility, activity.coverage_level,
               activity.source_authority, activity.source_evidence_ids_json,
               activity.first_evidence_sequence,
               activity.last_evidence_sequence, activity.revision
        FROM requested
        JOIN canonical_runtime_activity AS activity
          ON activity.agent_run_id = requested.agent_run_id
         AND activity.execution_epoch = requested.execution_epoch
         AND activity.classifier_version IN (?2, ?3)
        WHERE EXISTS (
            SELECT 1
            FROM json_each(activity.source_evidence_ids_json) AS source_evidence
            WHERE source_evidence.value = requested.evidence_id
        )
        ORDER BY requested.evidence_id,
                 CASE activity.classifier_version WHEN ?2 THEN 0 ELSE 1 END
        "#,
    )?;
    let rows = statement.query_map(
        params![
            requested_json,
            crate::canonical_activity::CLASSIFIER_VERSION,
            crate::canonical_activity::LEGACY_CLASSIFIER_VERSION,
        ],
        |row| {
            let diff_projection: Option<String> = row.get(7)?;
            let evidence_ids: String = row.get(13)?;
            let canonical = CanonicalRuntimeActivity {
                operation_id: row.get(1)?,
                classifier_version: row.get(2)?,
                activity_domain: row.get(3)?,
                semantic_kind: row.get(4)?,
                tool_name: row.get(5)?,
                presentation_hint: row.get(6)?,
                diff_projection: diff_projection
                    .map(|value| serde_json::from_str(&value))
                    .transpose()
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            7,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })?,
                phase: row.get(8)?,
                outcome: row.get(9)?,
                credibility: row.get(10)?,
                coverage_level: row.get(11)?,
                source_authority: row.get(12)?,
                source_evidence_ids: serde_json::from_str(&evidence_ids).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        13,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                first_evidence_sequence: row.get(14)?,
                last_evidence_sequence: row.get(15)?,
                revision: row.get(16)?,
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
               manifest.run_fact_refs_json,
               manifest.run_fact_digest,
               manifest.current_input_source_json,
               manifest.attachment_refs_json,
               manifest.attachment_digest,
               manifest.skill_exposure_json,
               manifest.skill_exposure_digest,
               manifest.current_input_skill_resolution_json,
               manifest.current_input_skill_resolution_digest,
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
               manifest.run_fact_payload_json,
               delivery.bootstrap_redelivery_present,
               delivery.bootstrap_redelivery_revision,
               delivery.bootstrap_redelivery_evidence_id,
               delivery.bootstrap_redelivery_envelope_version,
               delivery.bootstrap_redelivery_formatter_version,
               manifest.omission_entries_json,
               manifest.self_active_task_evidence_json,
               manifest.self_active_task_evidence_digest,
               manifest.message_projection_audience,
               manifest.a2a_guidance_evidence_json,
               manifest.a2a_guidance_evidence_digest
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
                row.get::<_, String>(17)?,
                row.get::<_, String>(18)?,
                row.get::<_, i64>(19)?,
                row.get::<_, String>(20)?,
                row.get::<_, String>(21)?,
                row.get::<_, i64>(22)?,
                row.get::<_, i64>(23)?,
                row.get::<_, i64>(24)?,
                row.get::<_, i64>(25)?,
                row.get::<_, String>(26)?,
                row.get::<_, String>(27)?,
                row.get::<_, Option<String>>(28)?,
                row.get::<_, String>(29)?,
                row.get::<_, Option<i64>>(30)?,
                row.get::<_, Option<i64>>(31)?,
                row.get::<_, Option<i64>>(32)?,
                row.get::<_, String>(33)?,
                row.get::<_, Option<String>>(34)?,
                row.get::<_, Option<i64>>(35)?,
                row.get::<_, Option<String>>(36)?,
                row.get::<_, Option<String>>(37)?,
                row.get::<_, Option<i64>>(38)?,
                row.get::<_, Option<String>>(39)?,
                row.get::<_, Option<String>>(40)?,
                row.get::<_, Option<String>>(41)?,
                row.get::<_, Option<String>>(42)?,
                row.get::<_, Option<String>>(43)?,
                row.get::<_, bool>(44)?,
                row.get::<_, String>(45)?,
                row.get::<_, String>(46)?,
                row.get::<_, String>(47)?,
                row.get::<_, Option<bool>>(48)?,
                row.get::<_, Option<i64>>(49)?,
                row.get::<_, Option<String>>(50)?,
                row.get::<_, Option<i64>>(51)?,
                row.get::<_, Option<i64>>(52)?,
                row.get::<_, String>(53)?,
                row.get::<_, String>(54)?,
                row.get::<_, String>(55)?,
                row.get::<_, String>(56)?,
                row.get::<_, String>(57)?,
                row.get::<_, String>(58)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|row| {
            let raw_message_refs = serde_json::from_str::<Vec<Value>>(&row.5)
                .context("ContextManifest raw message references are invalid")?;
            let run_fact_refs = serde_json::from_str::<Vec<RunFactRefView>>(&row.7)
                .context("ContextManifest Run Fact references are invalid")?;
            let shared_message_evidence = serde_json::from_str::<Vec<Value>>(&row.45)
                .context("ContextManifest Shared Message evidence is invalid")?;
            let run_fact_payload = serde_json::from_str::<Value>(&row.47)
                .context("ContextManifest Run Fact payload is invalid")?;
            let omission_entries = serde_json::from_str::<Vec<Value>>(&row.53)
                .context("ContextManifest omission evidence is invalid")?;
            let self_active_task_evidence = serde_json::from_str::<Value>(&row.54)
                .context("ContextManifest Self Active Task evidence is invalid")?;
            let a2a_guidance_evidence = serde_json::from_str::<Value>(&row.57)
                .context("ContextManifest A2A Guidance evidence is invalid")?;
            let current_input_source = serde_json::from_str::<Value>(&row.9)
                .context("ContextManifest Current Input source is invalid")?;
            let attachment_refs = serde_json::from_str::<Vec<CampAttachmentRefView>>(&row.10)
                .context("ContextManifest attachment references are invalid")?;
            let skill_exposure = serde_json::from_str::<SkillExposureSnapshot>(&row.12)
                .context("ContextManifest Skill exposure is invalid")?;
            let current_input_skill_resolution =
                serde_json::from_str::<CurrentInputSkillResolution>(&row.14)
                    .context("ContextManifest Current Input Skill resolution is invalid")?;
            let mcp_exposure = serde_json::from_str::<McpExposureSnapshot>(&row.16)
                .context("ContextManifest MCP exposure is invalid")?;
            let context_delivery_profile = serde_json::from_str(&row.26)
                .context("ContextManifest delivery profile is invalid")?;
            let originating_public_user_message_ref = row
                .28
                .as_deref()
                .map(serde_json::from_str)
                .transpose()
                .context("ContextManifest originating message reference is invalid")?;
            let recent_message_count = serde_json::from_str::<Vec<Value>>(&row.29)
                .context("ContextManifest recent message references are invalid")?
                .len();
            let bootstrap = serde_json::from_str::<NativeSessionBootstrapEvidenceView>(&row.33)
                .context("ContextManifest Native Session Bootstrap is invalid")?;
            let delivery = row
                .34
                .clone()
                .map(|id| {
                    Ok::<RuntimeInputDeliveryView, anyhow::Error>(RuntimeInputDeliveryView {
                        id,
                        execution_epoch: row
                            .35
                            .context("Context delivery has no execution epoch")?,
                        status: row.36.clone().context("Context delivery has no status")?,
                        native_input_id: row.37.clone(),
                        boundary_camp_message_sequence: row
                            .38
                            .context("Context delivery has no message boundary")?,
                        prepared_at: row
                            .39
                            .clone()
                            .context("Context delivery has no prepared time")?,
                        accepted_at: row.40.clone(),
                        resolved_at: row.41.clone(),
                        last_error: row.42.clone(),
                        updated_at: row
                            .43
                            .clone()
                            .context("Context delivery has no updated time")?,
                        bootstrap_redelivery_present: row.48.unwrap_or(false),
                        bootstrap_redelivery_revision: row.49,
                        bootstrap_redelivery_evidence_id: row.50.clone(),
                        bootstrap_redelivery_envelope_version: row.51,
                        bootstrap_redelivery_formatter_version: row.52,
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
                history_fence_version: row.22,
                global_public_message_boundary: row.23,
                history_camps: load_context_manifest_history_camps(transaction, &row.0)?,
                raw_message_count: raw_message_refs.len(),
                previous_accepted_public_boundary_sequence: row.24,
                context_delivery_profile_version: row.25,
                context_delivery_profile,
                context_delivery_profile_digest: row.27,
                originating_public_user_message_ref,
                recent_message_count,
                omitted_message_count: row.30,
                omitted_message_sequence_start: row.31,
                omitted_message_sequence_end: row.32,
                omission_entries,
                collaboration_state_digest: row.6,
                collaboration_state_included: row.44,
                shared_message_evidence,
                shared_message_evidence_digest: row.46,
                run_fact_refs,
                run_fact_payload,
                run_fact_digest: row.8,
                current_input_source,
                attachment_refs,
                attachment_digest: row.11,
                skill_exposure,
                skill_exposure_digest: row.13,
                current_input_skill_resolution,
                current_input_skill_resolution_digest: row.15,
                message_projection_audience: row.56,
                a2a_guidance_evidence,
                a2a_guidance_evidence_digest: row.58,
                mcp_exposure,
                mcp_exposure_digest: row.17,
                mcp_projection_digest: row.18,
                self_active_task_evidence,
                self_active_task_evidence_digest: row.55,
                formatter_version: row.19,
                rendered_payload_digest: row.20,
                delivery,
                created_at: row.21,
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

fn load_approvals(
    transaction: &Transaction<'_>,
    camp_id: &str,
    pending_only: bool,
    limit: Option<i64>,
) -> Result<Vec<ApprovalView>> {
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
          AND (?2 = 0 OR approval.status = 'pending')
        ORDER BY approval.requested_at DESC, approval.id
        LIMIT COALESCE(?3, -1)
        "#,
    )?;
    statement
        .query_map(params![camp_id, pending_only, limit], |row| {
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
    presentation_only: bool,
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
          AND (?5 = 0
               OR event_log.entity_type = 'task'
               OR event_log.event_type = 'camp_turn.cancel_requested')
        ORDER BY event_log.global_sequence {order}
        LIMIT ?4
        "#,
    );
    let mut statement = transaction.prepare(&sql)?;
    let rows = statement
        .query_map(
            params![after, through, camp_id, limit, presentation_only],
            |row| {
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
            },
        )?
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
    use super::{
        CAMP_MESSAGE_FIND_QUERY_MAX_SCALARS, CampMessageFindCandidate,
        case_insensitive_scalar_match_ranges, flatten_camp_message_find_matches,
        select_camp_message_find_match, validate_camp_message_find_query,
    };

    #[test]
    fn conversation_find_ranges_are_case_insensitive_non_overlapping_unicode_scalars() {
        assert_eq!(
            case_insensitive_scalar_match_ranges("A中a İ", "a"),
            vec![(0, 1), (2, 3)]
        );
        assert_eq!(
            case_insensitive_scalar_match_ranges("İstanbul", "i\u{307}"),
            vec![(0, 1)]
        );
        assert_eq!(
            case_insensitive_scalar_match_ranges("aaaa", "aa"),
            vec![(0, 2), (2, 4)]
        );
    }

    #[test]
    fn conversation_find_flattens_orders_selects_and_wraps_without_a_database() {
        let matches = flatten_camp_message_find_matches(
            vec![
                CampMessageFindCandidate {
                    message_id: "later".to_string(),
                    message_sequence: 2,
                    body: "NEEDLE late".to_string(),
                },
                CampMessageFindCandidate {
                    message_id: "first".to_string(),
                    message_sequence: 1,
                    body: "Needle 中 needle".to_string(),
                },
            ],
            "needle",
        );
        assert_eq!(
            matches
                .iter()
                .map(|item| (
                    item.message_id.as_str(),
                    item.occurrence_index,
                    item.start_offset,
                    item.end_offset,
                ))
                .collect::<Vec<_>>(),
            vec![("first", 0, 0, 6), ("first", 1, 9, 15), ("later", 0, 0, 6),]
        );

        for (requested, anchor, expected_index, expected_message) in [
            (Some(0), None, Some(0), Some("first")),
            (Some(-1), None, Some(2), Some("later")),
            (Some(4), None, Some(1), Some("first")),
            (None, Some(2), Some(2), Some("later")),
            (None, Some(3), Some(0), Some("first")),
        ] {
            let (selected_index, selected) =
                select_camp_message_find_match(&matches, requested, anchor);
            assert_eq!(selected_index, expected_index);
            assert_eq!(
                selected.as_ref().map(|item| item.message_id.as_str()),
                expected_message
            );
        }
        assert_eq!(
            select_camp_message_find_match(&[], None, None),
            (None, None)
        );

        assert!(validate_camp_message_find_query("  ").is_err());
        assert!(
            validate_camp_message_find_query(&"中".repeat(CAMP_MESSAGE_FIND_QUERY_MAX_SCALARS + 1))
                .is_err()
        );
        assert!(validate_camp_message_find_query("中").is_ok());
    }

    #[test]
    fn public_delivery_projection_preserves_causal_source_not_target_lineage() {
        // Own the SQL -> public DTO seam with a minimal table, not another full Camp fixture.
        // Existing read-model tests cover messages/evidence, not delivery source attribution.
        let mut connection = rusqlite::Connection::open_in_memory().unwrap();
        connection.execute_batch(r#"
            CREATE TABLE message_delivery (
                id TEXT, camp_id TEXT, message_id TEXT DEFAULT 'message',
                camp_turn_id TEXT DEFAULT 'turn', task_id TEXT,
                recipient_agent_id TEXT DEFAULT 'recipient', status TEXT,
                dispatch_phase TEXT DEFAULT 'terminal', wait_condition TEXT,
                dispatch_attempt_count INTEGER DEFAULT 1, retry_generation INTEGER DEFAULT 0,
                context_manifest_id TEXT, target_agent_run_id TEXT,
                manual_intervention_required INTEGER DEFAULT 0, failure_code TEXT,
                version INTEGER DEFAULT 1, created_at TEXT DEFAULT '2026-08-31T00:00:00Z',
                updated_at TEXT DEFAULT '2026-08-31T00:00:00Z', ended_at TEXT,
                delivery_kind TEXT, dispatch_disposition TEXT DEFAULT 'dispatch',
                completion_role TEXT DEFAULT 'required', gather_id TEXT,
                gather_dispatch_delivery_id TEXT, recipient_canonical_position INTEGER,
                edge_kind TEXT, target_parent_agent_run_id TEXT, return_to_agent_run_id TEXT,
                target_conversation_id TEXT, recipient_membership_version_at_admission INTEGER DEFAULT 1,
                source_agent_run_id TEXT, queue_sequence INTEGER DEFAULT 1
            );
            INSERT INTO message_delivery (
                id, camp_id, status, delivery_kind, recipient_canonical_position, edge_kind,
                source_agent_run_id, target_parent_agent_run_id, target_agent_run_id, return_to_agent_run_id
            ) VALUES
                ('pending', 'camp', 'pending', 'public_a2a', 0, 'forward', 'sender', 'sender', NULL, NULL),
                ('running', 'camp', 'running', 'public_a2a', 1, 'forward', 'sender', 'sender', 'receiver', NULL),
                ('return', 'camp', 'settled', 'public_a2a', 0, 'return', 'child', 'ancestor', 'continuation', 'caller'),
                ('captured', 'camp', 'settled', 'public_a2a', 0, 'return', 'child', NULL, NULL, 'caller');
            UPDATE message_delivery SET dispatch_disposition = 'gather_captured', gather_id = 'gather'
                WHERE id = 'captured';
            INSERT INTO message_delivery (
                id, camp_id, status, delivery_kind, gather_id, target_conversation_id
            ) VALUES ('completion', 'camp', 'pending', 'gather_completion', 'gather', 'conversation');
        "#).unwrap();
        let transaction = connection.transaction().unwrap();
        // Full Snapshot and bounded Camp-open use the same projection with different ordering.
        for limit in [None, Some(10)] {
            let deliveries = super::load_message_deliveries(&transaction, "camp", limit).unwrap();
            assert_eq!(deliveries.len(), 5);
            for delivery in deliveries {
                let value = serde_json::to_value(&delivery).unwrap();
                match delivery.id.as_str() {
                    "pending" | "running" => assert_eq!(value["sourceAgentRunId"], "sender"),
                    "return" | "captured" => assert_eq!(value["sourceAgentRunId"], "child"),
                    "completion" => assert!(value.get("sourceAgentRunId").is_none()),
                    _ => unreachable!(),
                }
            }
        }
    }
}

#[cfg(all(test, feature = "slow-tests"))]
#[path = "read_model/camp_open_tests.rs"]
mod camp_open_slow_tests;

#[cfg(all(test, feature = "slow-tests"))]
mod slow_tests {
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
        let mut database = crate::test_support::fresh_schema_database_at(&directory);
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
        assert!(ReadModelService.camp_exists(&database, &camp_id).unwrap());
        assert!(
            !ReadModelService
                .camp_exists(&database, "missing-camp")
                .unwrap()
        );
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
        let mut database = crate::test_support::fresh_schema_database_at(&directory);
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
                    status, native_input_id, prepared_at, accepted_at, updated_at,
                    runtime_attachment_auth_receipt_version,
                    runtime_attachment_auth_receipt_json,
                    runtime_attachment_auth_receipt_digest,
                    runtime_request_digest
                ) VALUES (
                    'null-unsettled-effect-input', ?1, 1,
                    'null-unsettled-effect-manifest', 'null-unsettled-effect-binding',
                    1, 1, 'sha256:null-unsettled-effect', 'accepted',
                    'null-unsettled-effect-native-input', ?2, ?2, ?2,
                    1, '{"schemaVersion":1}', 'sha256:test-auth', 'sha256:test-request'
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
        let mut database = crate::test_support::fresh_schema_database_at(&directory);
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

        let open = read_model
            .camp_open_projection(&mut database, &camp_id)
            .unwrap();
        assert_eq!(open.schema_version, CAMP_OPEN_SCHEMA_VERSION);
        assert_eq!(open.messages.len(), CAMP_OPEN_MESSAGE_LIMIT as usize);
        assert_eq!(open.messages.first().unwrap().sequence, 1_031);
        assert_eq!(open.messages.last().unwrap().sequence, 1_050);
        assert_eq!(open.coverage.messages.loaded_count, 20);
        assert_eq!(open.coverage.messages.total_count, 1_050);
        assert_eq!(open.coverage.messages.omitted_count, 1_030);
        assert!(open.coverage.messages.has_earlier);
        assert!(!open.coverage.messages.complete);
        let serialized_open = serde_json::to_value(&open).unwrap();
        assert!(serialized_open.get("contextManifests").is_none());
        assert!(serialized_open.get("actions").is_none());

        let earlier = read_model
            .camp_messages_page(
                &mut database,
                &camp_id,
                1_031,
                open.through_global_sequence,
                50,
            )
            .unwrap();
        assert_eq!(earlier.schema_version, CAMP_MESSAGE_PAGE_SCHEMA_VERSION);
        assert_eq!(earlier.messages.len(), 50);
        assert_eq!(earlier.messages.first().unwrap().sequence, 981);
        assert_eq!(earlier.messages.last().unwrap().sequence, 1_030);
        assert!(earlier.has_more);
        assert_eq!(earlier.next_before_sequence, Some(981));
        let oldest = read_model
            .camp_messages_page(
                &mut database,
                &camp_id,
                51,
                open.through_global_sequence,
                100,
            )
            .unwrap();
        assert_eq!(oldest.messages.len(), 50);
        assert_eq!(oldest.messages.first().unwrap().sequence, 1);
        assert_eq!(oldest.messages.last().unwrap().sequence, 50);
        assert!(!oldest.has_more);
        assert_eq!(oldest.next_before_sequence, None);
        assert!(
            read_model
                .camp_messages_page(
                    &mut database,
                    &camp_id,
                    1_031,
                    open.through_global_sequence + 1,
                    50,
                )
                .is_err()
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

        database
            .connection()
            .execute(
                r#"
                UPDATE message_attachment
                SET media_type = 'inode/directory',
                    storage_path = '/missing/terminal-attachment',
                    runtime_projection_state = 'failed'
                WHERE id = 'around-attachment'
                "#,
                [],
            )
            .unwrap();
        let failed_projection = read_model
            .camp_messages_around(&mut database, &camp_id, "around-message-25")
            .expect("a failed attachment source must not make Camp history unreadable");
        let failed_attachment = &failed_projection
            .messages
            .iter()
            .find(|message| message.id == failed_projection.anchor_message_id)
            .unwrap()
            .attachments[0];
        assert_eq!(failed_attachment.kind, "directory");
        assert_eq!(failed_attachment.file_count, 0);
        assert_eq!(failed_attachment.runtime_projection_state, "failed");

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

    #[test]
    fn conversation_find_projects_only_current_camp_public_human_bodies() {
        let (mut database, directory) = crate::test_support::fresh_schema_database_fast();
        let collaboration = CollaborationService::default();
        let created = collaboration
            .create_camp(
                &mut database,
                &user_envelope(
                    "create-conversation-find-camp",
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
                    "create-other-conversation-find-camp",
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
        let other_camp_id = other.result.payload["campId"].as_str().unwrap();
        let transaction = database.connection_mut().transaction().unwrap();
        {
            let mut statement = transaction
                .prepare(
                    r#"
                    INSERT INTO camp_message(
                        id, camp_id, sequence, author_type, author_id, body,
                        structured_content_json, content_digest, address_mode,
                        addressed_agent_ids_json, tombstoned_at,
                        version, created_at, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6,
                        ?7, ?8, 'default', '[]', ?9,
                        1, '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'
                    )
                    "#,
                )
                .unwrap();
            for (id, message_camp_id, sequence, author_type, author_id, body, tombstoned_at) in [
                (
                    "find-message-1",
                    camp_id.as_str(),
                    1,
                    "user",
                    "local_user",
                    "Needle one NEEDLE",
                    None,
                ),
                (
                    "find-message-2",
                    camp_id.as_str(),
                    2,
                    "system",
                    "system",
                    "needle hidden system",
                    None,
                ),
                (
                    "find-message-3",
                    camp_id.as_str(),
                    3,
                    "agent",
                    "agent-test",
                    "prefix needle suffix",
                    None,
                ),
                (
                    "find-message-4",
                    camp_id.as_str(),
                    4,
                    "user",
                    "local_user",
                    "attachment only",
                    None,
                ),
                (
                    "find-message-5",
                    camp_id.as_str(),
                    5,
                    "user",
                    "local_user",
                    "needle late",
                    None,
                ),
                (
                    "find-message-6",
                    camp_id.as_str(),
                    6,
                    "user",
                    "local_user",
                    "needle tombstoned",
                    Some("2026-08-18T01:00:00Z"),
                ),
                (
                    "find-other-camp-message",
                    other_camp_id,
                    1,
                    "user",
                    "local_user",
                    "needle hidden other camp",
                    None,
                ),
            ] {
                let content = serde_json::to_string(&vec![Segment::Text {
                    text: body.to_string(),
                }])
                .unwrap();
                statement
                    .execute(params![
                        id,
                        message_camp_id,
                        sequence,
                        author_type,
                        author_id,
                        body,
                        content,
                        format!("sha256:{id}"),
                        tombstoned_at,
                    ])
                    .unwrap();
            }
        }
        transaction
            .execute(
                r#"
                INSERT INTO message_attachment(
                    id, camp_id, camp_message_id, conversation_message_id,
                    position, display_name, media_type, byte_size,
                    content_digest, storage_path, preview_kind,
                    created_by_type, created_by_id, created_at
                ) VALUES (
                    'find-attachment', ?1, 'find-message-4', NULL,
                    0, 'needle.txt', 'text/plain', 1,
                    'sha256:find-attachment', '/tmp/find-attachment', 'none',
                    'user', 'local_user', '2026-08-18T00:00:00Z'
                )
                "#,
                [camp_id.as_str()],
            )
            .unwrap();
        transaction.commit().unwrap();

        let read_model = ReadModelService;
        let anchored = read_model
            .camp_messages_find(
                &mut database,
                &camp_id,
                "needle",
                None,
                Some("find-message-3"),
            )
            .unwrap();
        assert_eq!(anchored.schema_version, CAMP_MESSAGE_FIND_SCHEMA_VERSION);
        assert_eq!(anchored.total_match_count, 4);
        assert_eq!(anchored.selected_match_index, Some(2));
        assert_eq!(
            anchored.r#match,
            Some(CampMessageFindMatch {
                message_id: "find-message-3".to_string(),
                message_sequence: 3,
                occurrence_index: 0,
                start_offset: 7,
                end_offset: 13,
            })
        );

        let selected = (0..anchored.total_match_count)
            .map(|index| {
                read_model
                    .camp_messages_find(&mut database, &camp_id, "needle", Some(index), None)
                    .unwrap()
                    .r#match
                    .unwrap()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            selected
                .iter()
                .map(|item| (item.message_id.as_str(), item.occurrence_index))
                .collect::<Vec<_>>(),
            vec![
                ("find-message-1", 0),
                ("find-message-1", 1),
                ("find-message-3", 0),
                ("find-message-5", 0),
            ]
        );

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn conversation_find_returns_one_selected_match_from_the_transactional_high_water() {
        let (mut database, directory) = crate::test_support::fresh_schema_database_fast();
        let created = CollaborationService::default()
            .create_camp(
                &mut database,
                &user_envelope(
                    "create-find-snapshot-camp",
                    None,
                    CreateCampCommand::for_test(
                        directory.join("workspace").to_string_lossy().to_string(),
                    ),
                ),
            )
            .unwrap();
        let camp_id = created.result.payload["campId"].as_str().unwrap();
        let expected_high_water: i64 = database
            .connection()
            .query_row(
                "SELECT COALESCE(MAX(global_sequence), 0) FROM event_log",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let transaction = database.connection_mut().transaction().unwrap();
        for (id, sequence, body) in [
            ("find-snapshot-1", 1, "needle first needle"),
            ("find-snapshot-2", 2, "final needle"),
        ] {
            let content = serde_json::to_string(&vec![Segment::Text {
                text: body.to_string(),
            }])
            .unwrap();
            transaction
                .execute(
                    r#"
                    INSERT INTO camp_message(
                        id, camp_id, sequence, author_type, author_id, body,
                        structured_content_json, content_digest, address_mode,
                        addressed_agent_ids_json, version, created_at, updated_at
                    ) VALUES (
                        ?1, ?2, ?3, 'user', 'local_user', ?4,
                        ?5, ?6, 'default', '[]', 1,
                        '2026-08-18T00:00:00Z', '2026-08-18T00:00:00Z'
                    )
                    "#,
                    params![id, camp_id, sequence, body, content, format!("sha256:{id}")],
                )
                .unwrap();
        }
        transaction.commit().unwrap();

        let snapshot = ReadModelService
            .camp_messages_find(
                &mut database,
                camp_id,
                "needle",
                None,
                Some("find-snapshot-2"),
            )
            .unwrap();
        assert_eq!(snapshot.through_global_sequence, expected_high_water);
        assert_eq!(snapshot.total_match_count, 3);
        assert_eq!(snapshot.selected_match_index, Some(2));
        assert_eq!(
            snapshot.r#match,
            Some(CampMessageFindMatch {
                message_id: "find-snapshot-2".to_string(),
                message_sequence: 2,
                occurrence_index: 0,
                start_offset: 6,
                end_offset: 12,
            })
        );

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
                        expected_membership_generation: 1,
                        capability_overrides: json!({}),
                        source: None,
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
        let mut database = crate::test_support::fresh_schema_database_at(&directory);
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
        assert!(
            snapshot
                .quick_chat
                .recent_camps
                .iter()
                .chain(
                    snapshot
                        .projects
                        .iter()
                        .flat_map(|project| &project.recent_camps)
                )
                .all(|camp| camp.channel_source.is_none())
        );
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
        let mut database = crate::test_support::fresh_schema_database_at(&directory);
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
        let mut database = crate::test_support::fresh_schema_database_at(&directory);
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
                        expected_membership_generation: 1,
                        capability_overrides: json!({}),
                        source: None,
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
        let mut database = crate::test_support::fresh_schema_database_at(&directory);
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
                        ?1, ?2, 0, ?3, 'agent.text.delta', 'narration',
                        'updated', NULL, ?4, NULL, 32, 0, ?5
                    )
                    "#,
                )
                .unwrap();
            for sequence in 5..=85 {
                statement
                    .execute(params![
                        format!("evidence-{sequence}"),
                        agent_run_id,
                        sequence,
                        json!({ "itemId": null, "delta": format!("片段{sequence}") }).to_string(),
                        now,
                    ])
                    .unwrap();
            }
        }
        transaction.commit().unwrap();

        let open = read_model
            .camp_open_projection(&mut database, camp_id)
            .unwrap();
        assert_eq!(open.execution_evidence.len(), 85);
        assert_eq!(open.execution_evidence.first().unwrap().sequence, 1);
        assert_eq!(open.execution_evidence.last().unwrap().sequence, 85);
        assert_eq!(open.coverage.execution_evidence.loaded_count, 85);
        assert_eq!(open.coverage.execution_evidence.total_count, 85);
        assert!(open.coverage.execution_evidence.complete);

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
                    'evidence-compaction', ?1, 0, 86,
                    'runtime.compaction.display', 'step', 'completed',
                    'runtime.compaction.display:compact-1:completed',
                    ?2, NULL, 96, 0, ?3
                )
                "#,
                params![
                    agent_run_id,
                    json!({
                        "schemaVersion": 1,
                        "compactionId": "compact-1",
                        "adapterKind": "codex-cli",
                        "phase": "completed"
                    })
                    .to_string(),
                    now,
                ],
            )
            .unwrap();
        let local = read_model
            .agent_run_execution_evidence_page(&mut database, camp_id, agent_run_id, 85, 2)
            .unwrap();
        assert_eq!(local.evidence[0].event_type, "runtime.compaction.display");
        let transaction = database.connection_mut().transaction().unwrap();
        let public = public_execution_evidence_for_agent_run(&transaction, agent_run_id).unwrap();
        assert!(
            public
                .iter()
                .all(|evidence| evidence.event_type != "runtime.compaction.display")
        );
        transaction.commit().unwrap();

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn agent_run_diagnostic_projects_only_safe_frozen_and_public_facts() {
        let directory = std::env::temp_dir().join(format!(
            "rovai-agent-run-diagnostic-test-{}",
            Uuid::new_v4()
        ));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = crate::test_support::fresh_schema_database_at(&directory);
        configure_test_runtime(&database, &["agent_1"]);
        let created = CollaborationService::default()
            .create_test_camp_conversation(
                &mut database,
                &user_envelope(
                    "diagnostic-create",
                    None,
                    TestCampConversationCommand {
                        project_path: workspace.to_string_lossy().to_string(),
                        project_binding_kind: ProjectBindingKind::Directory,
                        body: "诊断任务".to_string(),
                        address: TestCampMessageAddress::Default,
                        purpose: "验证安全诊断投影".to_string(),
                    },
                ),
            )
            .unwrap();
        let agent_run_id = created.result.payload["agentRunIds"][0].as_str().unwrap();
        let diagnostic = ReadModelService
            .agent_run_diagnostic(&mut database, agent_run_id)
            .unwrap();
        let serialized = serde_json::to_value(&diagnostic).unwrap();

        assert_eq!(
            diagnostic.schema_version,
            AGENT_RUN_DIAGNOSTIC_SCHEMA_VERSION
        );
        assert_eq!(diagnostic.agent_run_id, agent_run_id);
        assert!(!diagnostic.runtime.effective_config_digest.is_empty());
        assert_eq!(diagnostic.output.public_output, None);
        assert_eq!(
            diagnostic.output.unavailable_reason.as_deref(),
            Some("run_not_succeeded")
        );
        let text = serialized.to_string();
        assert!(!text.contains("effectiveConfigJson"));
        assert!(!text.contains("runtimePayloadDigest"));
        assert!(!text.contains(&workspace.to_string_lossy().to_string()));
        assert!(!text.contains("repositoryRoot"));
        assert!(!text.contains("gitCommonDir"));
        assert!(!text.contains("executablePath"));
        assert!(!text.contains("credential"));

        drop(database);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn snapshot_batches_canonical_activity_for_the_full_evidence_window() {
        let directory =
            std::env::temp_dir().join(format!("rovai-evidence-batch-test-{}", Uuid::new_v4()));
        let workspace = directory.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let mut database = crate::test_support::fresh_schema_database_at(&directory);
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
        let mut database = crate::test_support::fresh_schema_database_at(&directory);
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
