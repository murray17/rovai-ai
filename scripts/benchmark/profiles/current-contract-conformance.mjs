import { defineBenchmarkProfile } from '../execution/suite.mjs'
import { digestJson } from '../protocol/canonical.mjs'

export const CURRENT_CONTRACT_DATA_STORE = Object.freeze({
  version: 'v1.15',
  projectionSchemaVersion: 55
})

const criteria = [
  criterion('CCC-001', 'Public A2A Current Input preserves the trusted sender Agent identity', [
    test('crates/rovai-core/src/team_tool.rs', 'public_delivery_runtime_consumes_the_pre_run_frozen_context_bytes')
  ]),
  criterion('CCC-002', 'Ordinary user Current Input remains type:user', [
    test('crates/rovai-core/src/context.rs', 'current_input_is_complete_even_when_it_exceeds_the_history_body_limit')
  ]),
  criterion('CCC-003', 'Run Fact is rendered once', [
    test('crates/rovai-core/src/team_tool.rs', 'task_linked_public_delivery_reuses_exact_run_fact_bytes')
  ]),
  criterion('CCC-004', 'Frozen Delivery, model section, and Manifest reuse exact Run Fact bytes and digest', [
    test('crates/rovai-core/src/team_tool.rs', 'task_linked_public_delivery_reuses_exact_run_fact_bytes')
  ]),
  criterion('CCC-005', 'Structured CampMessage prefix and camp.read continuation reconstruct the persisted body', [
    test('crates/rovai-core/src/context.rs', 'structured_history_continuation_uses_the_persisted_body_text_space')
  ]),
  criterion('CCC-006', 'A later member rename does not alter frozen structured-message semantics', [
    test('crates/rovai-core/src/camp_content.rs', 'rendering_projects_current_names_without_changing_semantic_digest'),
    test('crates/rovai-core/src/read_model.rs', 'snapshot_projects_current_names_from_structured_mentions')
  ]),
  criterion('CCC-007', 'max_public_messages omission stores only a bounded count and sequence envelope', [
    test('crates/rovai-core/src/context.rs', 'public_context_uses_latest_raw_window_prefixes_and_explicit_omission')
  ]),
  criterion('CCC-008', 'History budget, runtime budget, and reference closure retain bounded exact IDs', [
    test('crates/rovai-core/src/context.rs', 'public_history_budget_is_shared_and_profile_v4_bounded')
  ]),
  criterion('CCC-009', 'Large-history omission JSON remains bounded rather than growing with all message IDs', [
    test('crates/rovai-core/src/context.rs', 'whole_history_omission_evidence_stays_bounded_for_large_intervals')
  ]),
  criterion('CCC-010', 'ContextManifest version is 21 and Context Formatter version is 21', [
    test('crates/rovai-core/src/context_contract.rs', 'binding_contract_freezes_each_context_axis_version')
  ]),
  criterion(
    'CCC-011',
    `Data Contract is ${CURRENT_CONTRACT_DATA_STORE.version} with projection schema ${CURRENT_CONTRACT_DATA_STORE.projectionSchemaVersion}`,
    [
      test('crates/rovai-core/src/db.rs', 'current_migration_state_admission_matrix'),
      test('crates/rovai-core/src/db.rs', 'current_schema_contains_required_contract_objects')
    ]
  ),
  criterion('CCC-012', 'CampSnapshot schema is 32', [
    test('crates/rovai-core/src/read_model.rs', 'snapshot_projects_current_names_from_structured_mentions')
  ]),
  criterion('CCC-013', 'Production admission accepts only the exact current contract and quarantines incompatible managed state', [
    test('crates/rovai-core/src/db.rs', 'current_migration_state_admission_matrix'),
    test('crates/rovai-core/src/db.rs', 'v107_quarantine_moves_owned_directories_without_following_links')
  ]),
  criterion('CCC-014', 'The v99 schema transition preserves completed evidence, closes unfinished execution, and backfills only published attachments', [
    test('crates/rovai-core/src/db.rs', 'v99_preserves_legacy_evidence_classifies_unfinished_work_and_backfills_only_published_attachments')
  ]),
  criterion('CCC-015', 'Self-authored recent messages are excluded before the top-15 and omission aggregate', [
    test('crates/rovai-core/src/context.rs', 'recent_public_messages_filter_self_before_limit_and_omission_aggregation')
  ]),
  criterion('CCC-016', 'Attachment Context freezes stable semantics while rebuild identity and publication copy remain independently fenced', [
    test('crates/rovai-core/src/camp_attachment_view.rs', 'rollback_append_only_validation_and_controlled_rebuild_preserve_committed_entries'),
    test('crates/rovai-core/src/camp_attachment_view.rs', 'publication_copy_phase_releases_the_shared_database_mutex'),
    test('crates/rovai-core/src/db.rs', 'v100_backfills_stable_catalog_and_terminalizes_old_nonterminal_runs')
  ])
]

export const CURRENT_CONTRACT_PREREQUISITES = Object.freeze([
  {
    id: 'durable-task-v3',
    evidence: test('crates/rovai-core/src/collaboration.rs', 'agent_task_updates_respect_lead_and_assignee_authority')
  },
  {
    id: 'built-in-transport-v17',
    evidence: test('crates/rovai-core/src/builtin_tool_transport.rs', 'list_and_describe_share_one_digest')
  },
  {
    id: 'accepted-input-ack',
    evidence: test('crates/rovai-core/src/context.rs', 'accepted_input_advances_only_current_binding_and_restart_blocks_redelivery')
  }
])

export const CURRENT_CONTRACT_CRITERIA = Object.freeze(criteria)

export const CURRENT_CONTRACT_PROFILE = defineBenchmarkProfile({
  id: 'current-contract-conformance',
  version: '1.15.0',
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
    id: 'rovai-v1.15-current-contract',
    version: '1.15.0',
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
