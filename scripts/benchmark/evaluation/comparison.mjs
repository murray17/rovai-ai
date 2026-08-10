import { BENCHMARK_COMPARISON_AXES, validateBenchmarkRunV3 } from '../protocol/v3.mjs'
import { digestJson } from '../protocol/canonical.mjs'

const AXIS_METRICS = Object.freeze({
  hardOutcome: ['hardOutcome', 'verifiedDelivery', 'orchestrationConvergence', 'postDispatchHumanIntervention'],
  collaboration: ['memberCalls', 'agentRuns', 'completedTasks', 'collaborationChecks'],
  performance: ['durationMs', 'memberCalls', 'agentRuns', 'toolCalls'],
  evidenceIntegrity: ['artifactCoverage', 'integrityFailures'],
  contractConformance: ['criteriaPassed', 'criteriaFailed', 'hardOutcome']
})

export function compareBenchmarkRuns(baseline, candidate) {
  validateBenchmarkRunV3(baseline)
  validateBenchmarkRunV3(candidate)
  const axes = {
    hardOutcome: compareHardOutcome(baseline, candidate),
    collaboration: compareCollaboration(baseline, candidate),
    performance: comparePerformance(baseline, candidate),
    evidenceIntegrity: compareEvidenceIntegrity(baseline, candidate),
    contractConformance: compareContractConformance(baseline, candidate)
  }
  return {
    schemaVersion: 1,
    baseline: runReference(baseline),
    candidate: runReference(candidate),
    axes,
    deltas: Object.fromEntries(BENCHMARK_COMPARISON_AXES.map((axis) => [
      axis,
      axes[axis].eligible ? deriveDelta(axis, baseline, candidate) : null
    ])),
    integrityDigest: digestJson({
      baseline: baseline.integrity.contentIdentityDigest,
      candidate: candidate.integrity.contentIdentityDigest,
      axes
    })
  }
}

export function comparisonNotRequested() {
  return Object.fromEntries(BENCHMARK_COMPARISON_AXES.map((axis) => [axis, {
    eligible: false,
    reasonCodes: ['comparison.baseline_not_supplied'],
    baselineFingerprint: null,
    candidateFingerprint: null,
    suppressedMetrics: AXIS_METRICS[axis],
    displayOnlyMetrics: AXIS_METRICS[axis]
  }]))
}

function compareHardOutcome(baseline, candidate) {
  return compareAxis('hardOutcome', baseline, candidate, [
    rule('hard_outcome.profile_definition_changed', (run) => run.profile.hardOutcomeDefinitionDigest),
    rule('hard_outcome.case_seal_changed', (run) => run.verification.caseSealDigest),
    rule('hard_outcome.verification_catalog_changed', (run) => run.verification.verificationCatalogDigest),
    rule('hard_outcome.change_boundary_changed', (run) => run.verification.changeBoundaryDigest),
    rule('hard_outcome.budget_contract_changed', (run) => run.verification.budgetContractDigest),
    rule('hard_outcome.normalizer_semantics_changed', normalizerFingerprint)
  ])
}

function compareCollaboration(baseline, candidate) {
  return compareAxis('collaboration', baseline, candidate, [
    rule('collaboration.team_configuration_changed', (run) => run.executionEnvironment.teamConfigurationDigest),
    rule('collaboration.member_call_transport_changed', (run) => availabilityValue(run.productContract.builtInTransportVersion)),
    rule('collaboration.runtime_model_permissions_changed', (run) => run.executionEnvironment.runtimeModelPermissionsDigest),
    rule('collaboration.protocol_changed', (run) => `${run.profile.definitionDigest}:${run.benchmarkProtocolVersion}`)
  ])
}

function comparePerformance(baseline, candidate) {
  return compareAxis('performance', baseline, candidate, [
    rule('performance.case_set_changed', (run) => run.suite.caseSetDigest),
    rule('performance.platform_class_changed', (run) => run.executionEnvironment.platformClass),
    rule('performance.runtime_model_permissions_changed', (run) => run.executionEnvironment.runtimeModelPermissionsDigest),
    rule('performance.budget_contract_changed', (run) => run.verification.budgetContractDigest)
  ])
}

function compareEvidenceIntegrity(baseline, candidate) {
  return compareAxis('evidenceIntegrity', baseline, candidate, [
    rule('evidence.protocol_schema_changed', (run) => `${run.schemaVersion}:${run.benchmarkProtocolVersion}`),
    rule('evidence.layer_semantics_changed', evidenceFingerprint),
    rule('evidence.normalizer_semantics_changed', normalizerFingerprint)
  ])
}

function compareContractConformance(baseline, candidate) {
  return compareAxis('contractConformance', baseline, candidate, [
    rule('contract.profile_changed', (run) => `${run.profile.id}@${run.profile.version}:${run.profile.definitionDigest}`),
    rule('contract.case_set_changed', (run) => run.suite.caseSetDigest),
    rule('contract.verification_catalog_changed', (run) => run.verification.verificationCatalogDigest),
    rule('contract.evidence_semantics_changed', evidenceFingerprint)
  ])
}

function compareAxis(axis, baseline, candidate, rules) {
  const reasonCodes = rules
    .filter(({ fingerprint }) => fingerprint(baseline) !== fingerprint(candidate))
    .map(({ reasonCode }) => reasonCode)
  const eligible = reasonCodes.length === 0
  return {
    eligible,
    reasonCodes,
    baselineFingerprint: digestJson(Object.fromEntries(rules.map(({ reasonCode, fingerprint }) => [
      reasonCode,
      fingerprint(baseline)
    ]))),
    candidateFingerprint: digestJson(Object.fromEntries(rules.map(({ reasonCode, fingerprint }) => [
      reasonCode,
      fingerprint(candidate)
    ]))),
    suppressedMetrics: eligible ? [] : AXIS_METRICS[axis],
    displayOnlyMetrics: eligible ? [] : AXIS_METRICS[axis]
  }
}

function deriveDelta(axis, baseline, candidate) {
  if (axis === 'hardOutcome' || axis === 'contractConformance') {
    return {
      baseline: baseline.outcome.hardOutcome,
      candidate: candidate.outcome.hardOutcome,
      changed: baseline.outcome.hardOutcome !== candidate.outcome.hardOutcome
    }
  }
  if (axis === 'evidenceIntegrity') {
    return {
      baselineArtifactCount: baseline.artifactIndex.length,
      candidateArtifactCount: candidate.artifactIndex.length,
      artifactCountDelta: candidate.artifactIndex.length - baseline.artifactIndex.length
    }
  }
  const baselineMetrics = baseline.outcome.metrics?.[axis] ?? null
  const candidateMetrics = candidate.outcome.metrics?.[axis] ?? null
  return { baseline: baselineMetrics, candidate: candidateMetrics, numericDelta: numericDelta(baselineMetrics, candidateMetrics) }
}

function numericDelta(baseline, candidate) {
  if (!baseline || !candidate || typeof baseline !== 'object' || typeof candidate !== 'object') return null
  return Object.fromEntries(Object.keys(candidate)
    .filter((key) => typeof candidate[key] === 'number' && typeof baseline[key] === 'number')
    .map((key) => [key, candidate[key] - baseline[key]]))
}

function normalizerFingerprint(run) {
  return run.derivedFrom?.adapterId ?? 'benchmark-protocol-v3'
}

function evidenceFingerprint(run) {
  return digestJson(Object.fromEntries(Object.entries(run.evidence).map(([layer, value]) => [
    layer,
    value.references.map((reference) => ({
      schemaId: reference.schemaId,
      schemaVersion: reference.schemaVersion,
      artifactRole: reference.artifactRole
    }))
  ])))
}

function availabilityValue(value) {
  return value.status === 'available' ? JSON.stringify(value.value) : `unavailable:${value.reason.code}`
}

function rule(reasonCode, fingerprint) {
  return { reasonCode, fingerprint }
}

function runReference(run) {
  return {
    runId: run.runId,
    contentIdentityDigest: run.integrity.contentIdentityDigest,
    profile: `${run.profile.id}@${run.profile.version}`,
    productContractFingerprint: run.productContract.fingerprintDigest
  }
}
