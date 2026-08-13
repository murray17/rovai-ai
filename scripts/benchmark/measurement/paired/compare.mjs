import { canonicalJson, digestJson } from '../../protocol/canonical.mjs'
import { validateResourceMeasurement } from '../resources/index.mjs'
import { planPairedTrials, validatePairedTrialDefinition } from './definition.mjs'

export const PAIRED_COMPARISON_SCHEMA_ID = 'rovai.benchmark.paired-comparison'
export const PAIRED_COMPARISON_SCHEMA_VERSION = '1.0.0'

const OUTCOMES = new Set(['pass', 'fail', 'indeterminate'])
const QUALITY_VERDICTS = new Set([
  'team_superior',
  'team_noninferior',
  'equivalent',
  'solo_superior',
  'indeterminate'
])
const NONINFERIOR_QUALITY = new Set(['team_superior', 'team_noninferior', 'equivalent'])

export function comparePairedTrial({ definition, team, solo, qualityComparison }) {
  validatePairedTrialDefinition(definition)
  const plan = planPairedTrials(definition)
  const gateReasonCodes = uniqueStrings([
    ...validateArm(team, 'team', definition),
    ...validateArm(solo, 'solo', definition),
    ...validatePlanBindings(team, solo, plan),
    ...compareCommonFactors(team, solo, definition),
    ...compareTreatmentFactors(team, solo, definition),
    ...validateFreshState(team, solo, definition)
  ])
  const observedOutcomeStratum = outcomeStratum(team?.outcome?.status, solo?.outcome?.status)
  const validPair = gateReasonCodes.length === 0
  const publishedOutcomeStratum = validPair ? observedOutcomeStratum : 'indeterminate'
  const resourceComparison = compareResources({
    team: team?.resources,
    solo: solo?.resources,
    qualityComparison,
    expectedQualityConfigurationDigest: definition.judgeConfigurationDigests.outcome,
    expectedBlindingCanaryDigest: definition.blindingCanaryDigests.treatment,
    outcomeStratum: publishedOutcomeStratum,
    pairValid: validPair
  })
  const classification = classifyPair({
    validPair,
    outcomeStratum: publishedOutcomeStratum,
    qualityComparison,
    resourceComparison
  })
  const payload = {
    schemaId: PAIRED_COMPARISON_SCHEMA_ID,
    schemaVersion: PAIRED_COMPARISON_SCHEMA_VERSION,
    definition: {
      id: definition.id,
      version: definition.version,
      payloadDigest: definition.definitionDigest
    },
    arms: {
      team: armReference(team),
      solo: armReference(solo)
    },
    validity: {
      status: validPair ? 'valid' : 'invalid',
      reasonCodes: gateReasonCodes
    },
    observedOutcomeStratum,
    outcomeStratum: publishedOutcomeStratum,
    qualityComparison: normalizeQualityComparison(qualityComparison),
    resourceComparison,
    classification
  }
  return { ...payload, integrity: { payloadDigest: digestJson(payload) } }
}

function validatePlanBindings(team, solo, plan) {
  const reasons = []
  const planDigest = plan.integrity.payloadDigest
  const pairById = new Map(plan.pairs.map((pair) => [pair.pairSlotId, pair]))
  for (const [label, arm] of [['team', team], ['solo', solo]]) {
    const binding = arm?.planBinding
    if (!binding || typeof binding !== 'object') {
      reasons.push(`paired.${label}_plan_binding_missing`)
      continue
    }
    if (binding.planDigest !== planDigest) reasons.push(`paired.${label}_plan_digest_changed`)
    if (!Array.isArray(binding.evidenceReferences) || binding.evidenceReferences.length === 0) {
      reasons.push(`paired.${label}_plan_evidence_missing`)
    } else if (!binding.evidenceReferences.some((reference) => reference?.payloadDigest === planDigest)) {
      reasons.push(`paired.${label}_plan_evidence_unbound`)
    }
    const pair = pairById.get(binding.pairSlotId)
    if (!pair) {
      reasons.push(`paired.${label}_pair_slot_unplanned`)
      continue
    }
    const plannedArm = pair.arms.find((candidate) => candidate.treatment === label)
    if (!plannedArm || plannedArm.armPlanId !== binding.armPlanId
        || plannedArm.trialId !== binding.trialId
        || plannedArm.dispatchOrdinal !== binding.dispatchOrdinal) {
      reasons.push(`paired.${label}_arm_plan_mismatch`)
    }
    if (arm?.runId !== binding.trialId) reasons.push(`paired.${label}_trial_run_binding_mismatch`)
  }
  if (team?.planBinding?.pairSlotId !== solo?.planBinding?.pairSlotId) {
    reasons.push('paired.arms_not_from_same_pair_slot')
  }
  if (team?.planBinding?.dispatchOrdinal === solo?.planBinding?.dispatchOrdinal) {
    reasons.push('paired.arm_dispatch_ordinal_collision')
  }
  return reasons
}

export function validatePairedComparison(comparison) {
  if (!comparison || typeof comparison !== 'object') throw new TypeError('paired comparison must be an object')
  assertNoAggregateClaims(comparison)
  exactKeys(comparison, [
    'schemaId',
    'schemaVersion',
    'definition',
    'arms',
    'validity',
    'observedOutcomeStratum',
    'outcomeStratum',
    'qualityComparison',
    'resourceComparison',
    'classification',
    'integrity'
  ], 'paired comparison')
  exactKeys(comparison.definition, ['id', 'version', 'payloadDigest'], 'paired definition reference')
  exactKeys(comparison.arms, ['team', 'solo'], 'paired arm references')
  validateArmReference(comparison.arms.team, 'team')
  validateArmReference(comparison.arms.solo, 'solo')
  exactKeys(comparison.validity, ['status', 'reasonCodes'], 'paired validity')
  exactKeys(comparison.qualityComparison, [
    'status', 'verdict', 'treatmentBlind', 'configurationDigest',
    'blindingCanaryDigest', 'evidenceReferences'
  ], 'paired quality comparison')
  validateResourceComparisonShape(comparison.resourceComparison)
  exactKeys(comparison.integrity, ['payloadDigest'], 'paired comparison integrity')
  if (comparison.schemaId !== PAIRED_COMPARISON_SCHEMA_ID
      || comparison.schemaVersion !== PAIRED_COMPARISON_SCHEMA_VERSION) {
    throw new TypeError('unsupported paired comparison schema')
  }
  const { integrity, ...payload } = comparison
  if (!integrity || integrity.payloadDigest !== digestJson(payload)) {
    throw new TypeError('paired comparison digest mismatch')
  }
  const strata = new Set(['both_pass', 'team_only_pass', 'solo_only_pass', 'both_fail', 'indeterminate'])
  const classifications = new Set([
    'dominant',
    'quality_gain_with_cost',
    'efficiency_gain',
    'dominated',
    'tradeoff',
    'tie',
    'inconclusive'
  ])
  if (!strata.has(comparison.outcomeStratum) || !strata.has(comparison.observedOutcomeStratum)) {
    throw new TypeError('paired comparison outcome stratum is invalid')
  }
  if (!classifications.has(comparison.classification)) {
    throw new TypeError('paired comparison classification is invalid')
  }
  return comparison
}

function validateArmReference(reference, treatment) {
  exactKeys(reference, [
    'treatment', 'runId', 'planBinding', 'hardOutcome', 'resourceMeasurementDigest'
  ], `paired ${treatment} arm reference`)
  if (reference.planBinding !== null) {
    exactKeys(reference.planBinding, [
      'planDigest', 'pairSlotId', 'armPlanId', 'trialId', 'dispatchOrdinal'
    ], `paired ${treatment} plan reference`)
  }
}

function validateResourceComparisonShape(value) {
  exactKeys(value, ['status', 'reasonCodes', 'metrics', 'suppressedMetrics'], 'resource comparison')
  if (!['eligible', 'ineligible'].includes(value.status)
      || !Array.isArray(value.reasonCodes)
      || !isPlainObject(value.suppressedMetrics)) {
    throw new TypeError('resource comparison state is invalid')
  }
  for (const reasonCodes of Object.values(value.suppressedMetrics)) {
    if (!Array.isArray(reasonCodes)) throw new TypeError('suppressed metric reasons are invalid')
  }
  if (value.metrics === null) return
  if (!isPlainObject(value.metrics)) throw new TypeError('resource comparison metrics are invalid')
  for (const [id, metric] of Object.entries(value.metrics)) {
    exactKeys(metric, [
      'status', 'unit', 'direction', 'team', 'solo', 'delta', 'ratio', 'ratioStatus',
      'evidenceReferences'
    ], `resource comparison metric ${id}`)
    exactKeys(metric.evidenceReferences, ['team', 'solo'], `resource comparison metric ${id} evidence`)
  }
}

function validateArm(arm, expectedTreatment, definition) {
  const reasons = []
  if (!arm || typeof arm !== 'object') return [`paired.${expectedTreatment}_arm_missing`]
  try {
    validateArmInputShape(arm, expectedTreatment, definition)
  } catch {
    return [`paired.${expectedTreatment}_arm_artifact_invalid`]
  }
  if (arm.treatment !== expectedTreatment) reasons.push(`paired.${expectedTreatment}_treatment_label_invalid`)
  if (typeof arm.runId !== 'string' || arm.runId.length === 0) reasons.push(`paired.${expectedTreatment}_run_id_missing`)
  if (!OUTCOMES.has(arm.outcome?.status)) reasons.push(`paired.${expectedTreatment}_outcome_invalid`)
  if (typeof arm.outcome?.artifactDigest !== 'string'
      || !/^[a-f0-9]{64}$/u.test(arm.outcome.artifactDigest)) {
    reasons.push(`paired.${expectedTreatment}_hard_outcome_artifact_missing`)
  }
  if (!Array.isArray(arm.outcome?.evidenceReferences)
      || arm.outcome.evidenceReferences.length === 0) {
    reasons.push(`paired.${expectedTreatment}_hard_outcome_evidence_missing`)
  } else if (!arm.outcome.evidenceReferences.some((reference) => (
    reference?.payloadDigest === arm.outcome.artifactDigest
  ))) {
    reasons.push(`paired.${expectedTreatment}_hard_outcome_evidence_unbound`)
  }
  if (!sameCanonical(arm.definitionBindings, definition.bindings)) {
    reasons.push(`paired.${expectedTreatment}_definition_binding_changed`)
  }
  if (arm.resourceProfileDigest !== definition.resourceProfileDigest) {
    reasons.push(`paired.${expectedTreatment}_resource_profile_binding_changed`)
  }
  if (arm.resources?.profile?.payloadDigest !== definition.resourceProfileDigest) {
    reasons.push(`paired.${expectedTreatment}_resource_artifact_profile_changed`)
  }
  if (!sameCanonical(arm.commonFactors, definition.commonFactors)) {
    reasons.push(`paired.${expectedTreatment}_common_factors_changed`)
  }
  return reasons
}

function validateArmInputShape(arm, treatment, definition) {
  exactKeys(arm, [
    'treatment',
    'runId',
    'planBinding',
    'commonFactors',
    'definitionBindings',
    'resourceProfileDigest',
    'treatmentFactors',
    'freshState',
    'outcome',
    'resources'
  ], `paired ${treatment} arm`)
  exactKeys(arm.planBinding, [
    'planDigest', 'pairSlotId', 'armPlanId', 'trialId', 'dispatchOrdinal',
    'evidenceReferences'
  ], `paired ${treatment} arm plan binding`)
  exactKeys(arm.definitionBindings, ['case', 'toolMeasurement', 'verifier'], `paired ${treatment} bindings`)
  for (const [key, binding] of Object.entries(arm.definitionBindings)) {
    exactKeys(binding, ['id', 'version', 'digest'], `paired ${treatment} ${key} binding`)
  }
  exactKeys(arm.commonFactors, [
    'requestDigest',
    'workspaceFixtureDigest',
    'budgetContractDigest',
    'leadRuntimeModelPermissionsDigest',
    'ordinaryToolAvailabilityDigest',
    'isolationProfileDigest'
  ], `paired ${treatment} common factors`)
  exactKeys(arm.treatmentFactors, ['coordinationMode'], `paired ${treatment} treatment factors`)
  exactKeys(arm.freshState, ['status', 'identities', 'evidenceReferences'], `paired ${treatment} fresh state`)
  exactKeys(arm.freshState.identities, definition.freshStateKeys, `paired ${treatment} fresh identities`)
  exactKeys(arm.outcome, ['status', 'artifactDigest', 'evidenceReferences'], `paired ${treatment} outcome`)
  for (const [label, references] of [
    ['plan', arm.planBinding.evidenceReferences],
    ['fresh state', arm.freshState.evidenceReferences],
    ['outcome', arm.outcome.evidenceReferences]
  ]) {
    if (!Array.isArray(references)) throw new TypeError(`paired ${treatment} ${label} references are invalid`)
    for (const reference of references) validateEvidenceReference(reference, `paired ${treatment} ${label}`)
  }
}

function compareCommonFactors(team, solo, definition) {
  if (!team || !solo) return []
  if (!sameCanonical(team.commonFactors, solo.commonFactors)
      || !sameCanonical(team.commonFactors, definition.commonFactors)) {
    return ['paired.common_factors_mismatch']
  }
  return []
}

function compareTreatmentFactors(team, solo, definition) {
  if (!isPlainObject(team?.treatmentFactors) || !isPlainObject(solo?.treatmentFactors)) {
    return ['paired.treatment_factors_missing']
  }
  const keys = new Set([...Object.keys(team.treatmentFactors), ...Object.keys(solo.treatmentFactors)])
  const allowed = new Set(definition.allowedTreatmentDifferenceKeys)
  const reasons = [...keys]
    .filter((key) => !sameCanonical(team.treatmentFactors[key], solo.treatmentFactors[key]))
    .filter((key) => !allowed.has(key))
    .sort()
    .map((key) => `paired.unexpected_treatment_difference:${key}`)
  if (!sameCanonical(team.treatmentFactors, definition.treatmentDeclaration.team)) {
    reasons.push('paired.team_treatment_declaration_mismatch')
  }
  if (!sameCanonical(solo.treatmentFactors, definition.treatmentDeclaration.solo)) {
    reasons.push('paired.solo_treatment_declaration_mismatch')
  }
  return reasons
}

function validateFreshState(team, solo, definition) {
  const reasons = []
  for (const [label, arm] of [['team', team], ['solo', solo]]) {
    if (arm?.freshState?.status !== 'attested') reasons.push(`paired.${label}_fresh_state_unattested`)
    if (!Array.isArray(arm?.freshState?.evidenceReferences)
        || arm.freshState.evidenceReferences.length === 0) {
      reasons.push(`paired.${label}_fresh_state_evidence_missing`)
    }
    for (const key of definition.freshStateKeys) {
      if (typeof arm?.freshState?.identities?.[key] !== 'string'
          || arm.freshState.identities[key].length === 0) {
        reasons.push(`paired.${label}_fresh_state_identity_missing:${key}`)
      }
    }
  }
  for (const key of definition.freshStateKeys) {
    const teamIdentity = team?.freshState?.identities?.[key]
    const soloIdentity = solo?.freshState?.identities?.[key]
    if (teamIdentity && soloIdentity && teamIdentity === soloIdentity) {
      reasons.push(`paired.fresh_state_reused:${key}`)
    }
  }
  return reasons
}

function compareResources({
  team,
  solo,
  qualityComparison,
  expectedQualityConfigurationDigest,
  expectedBlindingCanaryDigest,
  outcomeStratum,
  pairValid
}) {
  const gateReasons = []
  if (!pairValid) gateReasons.push('paired.resource_pair_invalid')
  if (outcomeStratum !== 'both_pass') gateReasons.push('paired.resource_requires_both_pass')
  const quality = normalizeQualityComparison(qualityComparison)
  if (quality.status !== 'available' || quality.treatmentBlind !== true) {
    gateReasons.push('paired.resource_blinded_quality_unavailable')
  } else if (quality.evidenceReferences.length === 0) {
    gateReasons.push('paired.resource_blinded_quality_evidence_missing')
  } else if (quality.configurationDigest !== expectedQualityConfigurationDigest) {
    gateReasons.push('paired.resource_blinded_quality_configuration_changed')
  } else if (quality.blindingCanaryDigest !== expectedBlindingCanaryDigest) {
    gateReasons.push('paired.resource_blinding_canary_changed')
  } else if (!NONINFERIOR_QUALITY.has(quality.verdict)) {
    gateReasons.push('paired.resource_quality_noninferiority_not_met')
  }
  if (gateReasons.length > 0) return suppressedResources(gateReasons)

  try {
    validateResourceMeasurement(team)
    validateResourceMeasurement(solo)
  } catch {
    return suppressedResources(['paired.resource_artifact_invalid'])
  }
  if (team.profile.payloadDigest !== solo.profile.payloadDigest) {
    return suppressedResources(['paired.resource_profile_changed'])
  }

  const teamById = new Map(team.measurements.map((measurement) => [measurement.id, measurement]))
  const soloById = new Map(solo.measurements.map((measurement) => [measurement.id, measurement]))
  const ids = [...new Set([...teamById.keys(), ...soloById.keys()])].sort()
  const metrics = {}
  const suppressedMetrics = {}
  for (const id of ids) {
    const result = compareMetric(teamById.get(id), soloById.get(id))
    if (result.status === 'published') metrics[id] = result
    else suppressedMetrics[id] = result.reasonCodes
  }
  if (Object.keys(metrics).length === 0) {
    return {
      status: 'ineligible',
      reasonCodes: ['paired.resource_no_compatible_complete_metric'],
      metrics: null,
      suppressedMetrics
    }
  }
  return {
    status: 'eligible',
    reasonCodes: [],
    metrics,
    suppressedMetrics
  }
}

function compareMetric(team, solo) {
  if (!team || !solo) return { status: 'suppressed', reasonCodes: ['paired.resource_metric_missing'] }
  const descriptorFields = ['unit', 'direction', 'interval', 'aggregation', 'clockDomain', 'authority']
  if (descriptorFields.some((field) => canonicalJson(team[field]) !== canonicalJson(solo[field]))) {
    return { status: 'suppressed', reasonCodes: ['paired.resource_metric_definition_changed'] }
  }
  if (team.status !== 'available' || solo.status !== 'available') {
    return { status: 'suppressed', reasonCodes: ['paired.resource_metric_unavailable'] }
  }
  if (team.coverage?.status !== 'complete' || solo.coverage?.status !== 'complete') {
    return { status: 'suppressed', reasonCodes: ['paired.resource_metric_coverage_incomplete'] }
  }
  if (team.evidenceReferences.length === 0 || solo.evidenceReferences.length === 0) {
    return { status: 'suppressed', reasonCodes: ['paired.resource_metric_evidence_missing'] }
  }
  return {
    status: 'published',
    unit: team.unit,
    direction: team.direction,
    team: team.value,
    solo: solo.value,
    delta: team.value - solo.value,
    ratio: solo.value === 0 ? null : team.value / solo.value,
    ratioStatus: solo.value === 0 ? 'undefined_zero_denominator' : 'available',
    evidenceReferences: {
      team: structuredClone(team.evidenceReferences),
      solo: structuredClone(solo.evidenceReferences)
    }
  }
}

function suppressedResources(reasonCodes) {
  return {
    status: 'ineligible',
    reasonCodes: uniqueStrings(reasonCodes),
    metrics: null,
    suppressedMetrics: {}
  }
}

function classifyPair({ validPair, outcomeStratum, qualityComparison, resourceComparison }) {
  if (!validPair || outcomeStratum === 'indeterminate' || outcomeStratum === 'both_fail') return 'inconclusive'
  if (outcomeStratum === 'team_only_pass') return 'dominant'
  if (outcomeStratum === 'solo_only_pass') return 'dominated'

  const quality = normalizeQualityComparison(qualityComparison)
  if (quality.status !== 'available' || quality.treatmentBlind !== true || quality.verdict === 'indeterminate') {
    return 'inconclusive'
  }
  const resourceDirection = resourcePareto(resourceComparison)
  if (resourceDirection === 'unavailable') return 'inconclusive'
  if (quality.verdict === 'team_superior') {
    if (resourceDirection === 'worse' || resourceDirection === 'mixed') return 'quality_gain_with_cost'
    return 'dominant'
  }
  if (quality.verdict === 'solo_superior') {
    if (resourceDirection === 'better' || resourceDirection === 'mixed') return 'tradeoff'
    return 'dominated'
  }
  if (resourceDirection === 'better') return 'efficiency_gain'
  if (resourceDirection === 'worse') return 'dominated'
  if (resourceDirection === 'mixed') return 'tradeoff'
  return 'tie'
}

function resourcePareto(resourceComparison) {
  if (resourceComparison.status !== 'eligible') return 'unavailable'
  const comparisons = Object.values(resourceComparison.metrics)
    .filter((metric) => metric.direction !== 'descriptive')
    .map((metric) => {
      if (metric.delta === 0) return 'equal'
      const teamLower = metric.delta < 0
      const better = metric.direction === 'lower_is_better' ? teamLower : !teamLower
      return better ? 'better' : 'worse'
    })
  if (comparisons.length === 0) return 'unavailable'
  const hasBetter = comparisons.includes('better')
  const hasWorse = comparisons.includes('worse')
  if (hasBetter && hasWorse) return 'mixed'
  if (hasBetter) return 'better'
  if (hasWorse) return 'worse'
  return 'equal'
}

function outcomeStratum(team, solo) {
  if (!OUTCOMES.has(team) || !OUTCOMES.has(solo) || team === 'indeterminate' || solo === 'indeterminate') {
    return 'indeterminate'
  }
  if (team === 'pass' && solo === 'pass') return 'both_pass'
  if (team === 'pass') return 'team_only_pass'
  if (solo === 'pass') return 'solo_only_pass'
  return 'both_fail'
}

function normalizeQualityComparison(value) {
  const status = value?.status === 'available' ? 'available' : 'unavailable'
  const verdict = QUALITY_VERDICTS.has(value?.verdict) ? value.verdict : 'indeterminate'
  return {
    status,
    verdict,
    treatmentBlind: value?.treatmentBlind === true,
    configurationDigest: typeof value?.configurationDigest === 'string' ? value.configurationDigest : null,
    blindingCanaryDigest: typeof value?.blindingCanaryDigest === 'string'
      ? value.blindingCanaryDigest
      : null,
    evidenceReferences: uniqueReferences(value?.evidenceReferences)
  }
}

function validateEvidenceReference(reference, path) {
  exactKeys(reference, [
    'artifactRole', 'schemaId', 'schemaVersion', 'payloadDigest', 'disclosure'
  ], `${path} evidence reference`)
  if (typeof reference.artifactRole !== 'string'
      || typeof reference.schemaId !== 'string'
      || typeof reference.schemaVersion !== 'string'
      || !/^(?:sha256:)?[a-f0-9]{64}$/u.test(reference.payloadDigest)
      || !['private', 'public'].includes(reference.disclosure)) {
    throw new TypeError(`${path} evidence reference is invalid`)
  }
}

function armReference(arm) {
  return {
    treatment: arm?.treatment ?? null,
    runId: arm?.runId ?? null,
    planBinding: arm?.planBinding ? {
      planDigest: arm.planBinding.planDigest,
      pairSlotId: arm.planBinding.pairSlotId,
      armPlanId: arm.planBinding.armPlanId,
      trialId: arm.planBinding.trialId,
      dispatchOrdinal: arm.planBinding.dispatchOrdinal
    } : null,
    hardOutcome: OUTCOMES.has(arm?.outcome?.status) ? arm.outcome.status : 'indeterminate',
    resourceMeasurementDigest: arm?.resources?.integrity?.payloadDigest ?? null
  }
}

function uniqueReferences(references = []) {
  const entries = new Map()
  for (const reference of references ?? []) {
    if (reference && typeof reference === 'object' && !Array.isArray(reference)) {
      entries.set(canonicalJson(reference), structuredClone(reference))
    }
  }
  return [...entries.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value)
}

function uniqueStrings(values) {
  return [...new Set(values)].sort()
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function sameCanonical(left, right) {
  if (left === undefined || right === undefined) return left === right
  return canonicalJson(left) === canonicalJson(right)
}

function exactKeys(value, expected, path) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object`)
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(keys)) {
    throw new TypeError(`${path} keys are not closed`)
  }
}

function assertNoAggregateClaims(value, path = '$') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (['score', 'aggregateScore', 'winner'].includes(key)) {
      throw new TypeError(`forbidden aggregate claim field at ${path}.${key}`)
    }
    assertNoAggregateClaims(child, `${path}.${key}`)
  }
}
