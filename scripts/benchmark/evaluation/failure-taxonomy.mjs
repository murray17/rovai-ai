export const BENCHMARK_FAILURE_CLASSES = Object.freeze([
  'benchmark_contract_invalid',
  'product_contract_mismatch',
  'invalid_environment',
  'runtime_configuration_drift',
  'evaluation_pending',
  'verified_delivery_failed',
  'orchestration_nonconvergence',
  'human_intervention',
  'change_boundary_failed',
  'evidence_integrity_failed',
  'verifier_or_fixture_failure',
  'infrastructure_failure'
])

export function classifyBenchmarkFailure(facts) {
  const classifications = []
  add(facts.benchmarkContractValid === false, 'benchmark_contract_invalid')
  add(facts.productContractMatched === false, 'product_contract_mismatch')
  add(facts.environmentValid === false, 'invalid_environment')
  add(facts.runtimeConfigurationDrift === true, 'runtime_configuration_drift')
  add(facts.evaluationState === 'pending', 'evaluation_pending')
  add(facts.verifiedDelivery === 'fail', 'verified_delivery_failed')
  add(facts.orchestrationConvergence === 'fail', 'orchestration_nonconvergence')
  add(facts.postDispatchHumanIntervention === 'present', 'human_intervention')
  add(facts.changeBoundaryPassed === false, 'change_boundary_failed')
  add(facts.evidenceIntegrityPassed === false, 'evidence_integrity_failed')
  add(facts.verifierOrFixturePassed === false, 'verifier_or_fixture_failure')
  add(facts.infrastructurePassed === false, 'infrastructure_failure')
  return classifications

  function add(condition, classification) {
    if (condition) classifications.push(classification)
  }
}
