import { defineBenchmarkProfile } from '../execution/suite.mjs'
import { digestJson } from '../protocol/canonical.mjs'

const criteria = [
  criterion('CCC-001', 'Public A2A Current Input preserves the trusted sender Agent identity', [
    test('crates/rovai-core/src/team_tool.rs', 'public_delivery_runtime_consumes_the_pre_run_frozen_context_bytes')
  ]),
  criterion('CCC-002', 'Ordinary user Current Input remains type:user', [
    test('crates/rovai-core/src/context.rs', 'current_input_is_complete_even_when_it_exceeds_the_history_body_limit')
  ]),
  criterion('CCC-003', 'Run Notice is rendered once', [
    test('crates/rovai-core/src/team_tool.rs', 'task_linked_public_delivery_reuses_exact_run_notice_bytes')
  ]),
  criterion('CCC-004', 'Frozen Delivery, model section, and Manifest reuse exact Run Notice bytes and digest', [
    test('crates/rovai-core/src/team_tool.rs', 'task_linked_public_delivery_reuses_exact_run_notice_bytes')
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
    test('crates/rovai-core/src/context.rs', 'public_history_budget_is_shared_and_profile_v3_bounded')
  ]),
  criterion('CCC-009', 'Large-history omission JSON remains bounded rather than growing with all message IDs', [
    test('crates/rovai-core/src/context.rs', 'whole_history_omission_evidence_stays_bounded_for_large_intervals')
  ]),
  criterion('CCC-010', 'ContextManifest version is 10', [
    test('crates/rovai-core/src/context_contract.rs', 'binding_contract_freezes_each_context_axis_version')
  ]),
  criterion('CCC-011', 'Data Contract is v0.54 with projection schema 29', [
    test('crates/rovai-core/src/db.rs', 'current_data_contract_accepts_only_current_or_exact_v052_schema_28_source'),
    test('crates/rovai-core/src/db.rs', 'v70_upgrades_the_exact_v052_source_without_compatibility_rows')
  ]),
  criterion('CCC-012', 'CampSnapshot schema is 27', [
    test('crates/rovai-core/src/read_model.rs', 'snapshot_projects_current_names_from_structured_mentions')
  ]),
  criterion('CCC-013', 'Migration 70 admits only the exact defined upgrade source', [
    test('crates/rovai-core/src/db.rs', 'current_data_contract_accepts_only_current_or_exact_v052_schema_28_source')
  ]),
  criterion('CCC-014', 'Migration preserves completed Camp, Message, Task, and terminal Run/Turn history', [
    test('crates/rovai-core/src/context.rs', 'v68_through_v70_clean_break_preserves_business_history_and_removes_old_context_state')
  ]),
  criterion('CCC-015', 'Migration fails old non-terminal Run/Turn and unfinished Delivery closed', [
    test('crates/rovai-core/src/context.rs', 'v68_through_v70_clean_break_preserves_business_history_and_removes_old_context_state')
  ])
]

export const CURRENT_CONTRACT_PREREQUISITES = Object.freeze([
  {
    id: 'durable-task-v3',
    evidence: test('crates/rovai-core/src/collaboration.rs', 'agent_task_updates_respect_lead_and_assignee_authority')
  },
  {
    id: 'built-in-transport-v5',
    evidence: test('crates/rovai-core/src/builtin_tool_transport.rs', 'list_and_describe_share_one_digest')
  },
  {
    id: 'accepted-input-ack',
    evidence: test('crates/rovai-core/src/context.rs', 'accepted_input_advances_only_the_current_native_binding_marker')
  }
])

export const CURRENT_CONTRACT_CRITERIA = Object.freeze(criteria)

export const CURRENT_CONTRACT_PROFILE = defineBenchmarkProfile({
  id: 'current-contract-conformance',
  version: '1.1.0',
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
    id: 'rovai-v0.54-current-contract',
    version: '1.1.0',
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
