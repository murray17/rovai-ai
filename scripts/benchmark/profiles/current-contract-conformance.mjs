import { defineBenchmarkProfile } from '../execution/suite.mjs'
import { digestJson } from '../protocol/canonical.mjs'

export const CURRENT_CONTRACT_DATA_STORE = Object.freeze({
  versionPattern: '^v1\\.[0-9]+$',
  minimumProjectionSchemaVersion: 120
})

const criteria = [
  criterion('CCC-001', 'Public batch RUN_INPUT preserves trusted sender identity and the redelivery overlay remains frozen', [
    test('crates/rovai-core/src/team_tool.rs', 'batch_public_delivery_preserves_trusted_sender_in_run_input'),
    test('crates/rovai-core/src/context.rs', 'redelivery_overlay_is_frozen_at_prepare_and_acknowledges_only_its_revision')
  ]),
  criterion('CCC-002', 'Ordinary user RUN_INPUT remains complete with its trusted sender type', [
    test('crates/rovai-core/src/context.rs', 'run_input_is_complete_even_when_it_exceeds_the_history_body_limit')
  ]),
  criterion('CCC-003', 'Task-linked batch Run Facts are rendered once', [
    test('crates/rovai-core/src/team_tool.rs', 'task_linked_batch_run_reuses_exact_run_fact_bytes')
  ]),
  criterion('CCC-004', 'The model section and Manifest reuse exact claimed Run Fact bytes and digest', [
    test('crates/rovai-core/src/team_tool.rs', 'task_linked_batch_run_reuses_exact_run_fact_bytes')
  ]),
  criterion('CCC-005', 'camp.read returns the selected message body completely without a continuation protocol', [
    test('crates/rovai-core/src/camp_history.rs', 'camp_read_returns_the_selected_page_and_item_body_without_size_clipping')
  ]),
  criterion('CCC-006', 'A later member rename does not alter frozen structured-message semantics', [
    test('crates/rovai-core/src/camp_content.rs', 'rendering_projects_current_names_without_changing_semantic_digest'),
    test('crates/rovai-core/src/read_model.rs', 'snapshot_projects_current_names_from_structured_mentions')
  ]),
  criterion('CCC-007', 'Public batch keeps its accepted watermark across replacement Sessions', [
    test('crates/rovai-core/src/context.rs', 'batch_public_window_keeps_the_camp_agent_watermark_across_new_sessions')
  ]),
  criterion('CCC-008', 'Required RUN_INPUT stays complete under the Runtime payload budget', [
    test('crates/rovai-core/src/context.rs', 'oversized_required_context_fails_before_manifest_or_boundary_ack'),
    test('crates/rovai-core/src/context.rs', 'run_input_is_complete_even_when_it_exceeds_the_history_body_limit')
  ]),
  criterion('CCC-009', 'Public history remains readable on demand after the accepted watermark', [
    test('crates/rovai-core/src/context.rs', 'replacement_binding_bootstrap_keeps_history_on_demand_after_the_accepted_watermark'),
    test('crates/rovai-core/src/context.rs', 'public_history_is_readable_without_target_camp_membership_or_live_recheck')
  ]),
  criterion('CCC-010', 'ContextManifest and Formatter versions match the current context contract', [
    test('crates/rovai-core/src/context_contract.rs', 'binding_contract_rotates_existing_sessions_for_new_charter')
  ]),
  criterion(
    'CCC-011',
    'The checkout admits its declared current Data Contract and required schema objects',
    [
      test('crates/rovai-core/src/db.rs', 'current_migration_state_admission_matrix'),
      test('crates/rovai-core/src/db.rs', 'current_schema_contains_required_contract_objects'),
      test('crates/rovai-core/src/db.rs', 'v172_preserves_historical_context_rows_and_gates_new_writes')
    ]
  ),
  criterion('CCC-012', 'CampSnapshot matches the current read model contract', [
    test('crates/rovai-core/src/read_model.rs', 'snapshot_projects_current_names_from_structured_mentions')
  ]),
  criterion('CCC-013', 'Production admission accepts only the exact current contract and quarantines incompatible managed state', [
    test('crates/rovai-core/src/db.rs', 'current_migration_state_admission_matrix'),
    test('crates/rovai-core/src/db.rs', 'v107_quarantine_moves_owned_directories_without_following_links')
  ]),
  criterion('CCC-014', 'The v172 transition preserves historical context rows and gates new writes', [
    test('crates/rovai-core/src/db.rs', 'v172_preserves_historical_context_rows_and_gates_new_writes')
  ]),
  criterion('CCC-015', 'Public batch windows keep their accepted Camp+Agent watermark across Native Session replacement and do not apply the legacy self filter', [
    test('crates/rovai-core/src/context.rs', 'batch_public_window_keeps_the_camp_agent_watermark_across_new_sessions')
  ]),
  criterion('CCC-016', 'Current source refs bypass managed publication while historical v2 data remains recoverable and cannot block dispatch', [
    test('crates/rovai-core/src/managed_attachment.rs', 'composer_ingest_promotes_once_and_commits_only_v2_rows'),
    test('crates/rovai-core/src/managed_attachment.rs', 'startup_reconcile_abandons_staging_and_promoted_precommit_intents'),
    test('crates/rovai-core/src/team_tool.rs', 'attachment_send_keeps_source_path_and_dispatches_without_projection_gate'),
    test('crates/rovai-core/src/team_tool.rs', 'running_source_sends_fourteen_mib_without_waiting_for_camp_publication'),
    test('crates/rovai-core/src/camp_attachment_view.rs', 'legacy_rebuild_target_preserves_managed_v2_resources'),
    test('crates/rovai-core/src/context.rs', 'unavailable_legacy_locator_is_omitted_without_filesystem_fallback'),
    test('crates/rovai-core/src/application.rs', 'source_ref_dispatch_admission_ignores_broken_legacy_view')
  ])
]

export const CURRENT_CONTRACT_PREREQUISITES = Object.freeze([
  {
    id: 'durable-task-v4',
    evidence: test('crates/rovai-core/src/collaboration.rs', 'agent_task_updates_respect_lead_and_assignee_authority')
  },
  {
    id: 'built-in-transport-v31',
    evidence: test('crates/rovai-core/src/builtin_tool_transport.rs', 'list_and_describe_share_one_digest')
  },
  {
    id: 'accepted-input-ack',
    evidence: test('crates/rovai-core/src/context.rs', 'redelivery_overlay_is_frozen_at_prepare_and_acknowledges_only_its_revision')
  }
])

export const CURRENT_CONTRACT_CRITERIA = Object.freeze(criteria)

export const CURRENT_CONTRACT_PROFILE = defineBenchmarkProfile({
  id: 'current-contract-conformance',
  version: '1.69.0',
  lane: 'contract-conformance',
  hardOutcomeDefinition: {
    validity: 'deterministic_source_and_harness_valid',
    evaluationState: 'all_required_test_evidence_complete',
    verifiedDelivery: 'all_profile_criteria_pass',
    orchestrationConvergence: 'offline_test_process_settled',
    postDispatchHumanIntervention: 'absent',
    semanticJudgeAuthority: 'none'
  },
  publicationPolicy: {
    requireAllSlots: true,
    publishOutcomeRate: false,
    passAtK: false,
    ranking: false,
    compositeScore: false
  },
  suite: {
    id: 'rovai-current-contract',
    version: '1.69.0',
    shuffle: false,
    rounds: [{ id: 'deterministic', ordinal: 1 }],
    cases: criteria.map((entry) => ({
      id: entry.id,
      version: '1.0.0',
      seal: digestJson({ id: entry.id, evidence: entry.evidence })
    }))
  }
})

function criterion(id, statement, evidence) {
  return Object.freeze({ id, statement, evidence: Object.freeze(evidence) })
}

function test(locator, testName) {
  return Object.freeze({ locator, testName })
}
