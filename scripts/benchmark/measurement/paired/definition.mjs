import { canonicalJson, digestJson } from '../../protocol/canonical.mjs'

export const PAIRED_DEFINITION_SCHEMA_ID = 'rovai.benchmark.paired-trial-definition'
export const PAIRED_DEFINITION_SCHEMA_VERSION = '1.0.0'
export const PAIRED_PLAN_SCHEMA_ID = 'rovai.benchmark.paired-trial-plan'
export const PAIRED_PLAN_SCHEMA_VERSION = '1.0.0'

const DEFAULT_FRESH_STATE_KEYS = Object.freeze([
  'coreData',
  'camp',
  'workspace',
  'memory',
  'conversation',
  'nativeSession'
])

const REQUIRED_COMMON_FACTOR_DIGESTS = Object.freeze([
  'requestDigest',
  'workspaceFixtureDigest',
  'budgetContractDigest',
  'leadRuntimeModelPermissionsDigest',
  'ordinaryToolAvailabilityDigest',
  'isolationProfileDigest'
])

export function createPairedTrialDefinition({
  id,
  version,
  seed,
  estimand,
  partition,
  replicateCount,
  caseBinding,
  toolMeasurementBinding,
  verifierBinding,
  resourceProfileDigest,
  judgeConfigurationDigests,
  blindingCanaryDigests,
  treatmentDeclaration,
  nonInferiorityRule,
  commonFactors,
  allowedTreatmentDifferenceKeys,
  freshStateKeys = DEFAULT_FRESH_STATE_KEYS
}) {
  requireNonEmptyString(id, 'definition.id')
  requireNonEmptyString(version, 'definition.version')
  requireNonEmptyString(seed, 'definition.seed')
  requireNonEmptyString(estimand, 'definition.estimand')
  if (!['development', 'holdout'].includes(partition)) {
    throw new TypeError('definition.partition must be development or holdout')
  }
  if (!Number.isSafeInteger(replicateCount) || replicateCount <= 0) {
    throw new TypeError('definition.replicateCount must be a positive safe integer')
  }
  const bindings = {
    case: normalizeBinding(caseBinding, 'definition.caseBinding'),
    toolMeasurement: normalizeBinding(toolMeasurementBinding, 'definition.toolMeasurementBinding'),
    verifier: normalizeBinding(verifierBinding, 'definition.verifierBinding')
  }
  requireDigest(resourceProfileDigest, 'definition.resourceProfileDigest')
  const judgeDigests = normalizeDigestObject(judgeConfigurationDigests, 'definition.judgeConfigurationDigests')
  const canaryDigests = normalizeDigestObject(blindingCanaryDigests, 'definition.blindingCanaryDigests')
  exactKeys(judgeDigests, ['outcome', 'toolUse'], 'definition.judgeConfigurationDigests')
  exactKeys(canaryDigests, ['treatment'], 'definition.blindingCanaryDigests')
  for (const key of ['outcome', 'toolUse']) {
    requireDigest(judgeDigests[key], `definition.judgeConfigurationDigests.${key}`)
  }
  requireDigest(canaryDigests.treatment, 'definition.blindingCanaryDigests.treatment')
  requirePlainObject(treatmentDeclaration, 'definition.treatmentDeclaration')
  exactKeys(treatmentDeclaration, ['team', 'solo'], 'definition.treatmentDeclaration')
  requirePlainObject(treatmentDeclaration.team, 'definition.treatmentDeclaration.team')
  requirePlainObject(treatmentDeclaration.solo, 'definition.treatmentDeclaration.solo')
  exactKeys(treatmentDeclaration.team, ['coordinationMode'], 'definition.treatmentDeclaration.team')
  exactKeys(treatmentDeclaration.solo, ['coordinationMode'], 'definition.treatmentDeclaration.solo')
  if (treatmentDeclaration.team.coordinationMode !== 'multi_agent'
      || treatmentDeclaration.solo.coordinationMode !== 'single_agent') {
    throw new TypeError('definition treatment declaration is not Team/Solo v1')
  }
  requirePlainObject(nonInferiorityRule, 'definition.nonInferiorityRule')
  exactKeys(
    nonInferiorityRule,
    ['construct', 'maximumOrdinalLoss'],
    'definition.nonInferiorityRule'
  )
  if (nonInferiorityRule.construct !== 'blinded_outcome_quality'
      || nonInferiorityRule.maximumOrdinalLoss !== 0) {
    throw new TypeError('definition non-inferiority rule is unsupported')
  }
  requirePlainObject(commonFactors, 'definition.commonFactors')
  exactKeys(commonFactors, REQUIRED_COMMON_FACTOR_DIGESTS, 'definition.commonFactors')
  for (const key of REQUIRED_COMMON_FACTOR_DIGESTS) {
    requireDigest(commonFactors[key], `definition.commonFactors.${key}`)
  }
  const allowed = normalizeStringSet(
    allowedTreatmentDifferenceKeys,
    'definition.allowedTreatmentDifferenceKeys',
    false
  )
  if (canonicalJson(allowed) !== canonicalJson(['coordinationMode'])) {
    throw new TypeError('definition allowed treatment differences are not Team/Solo v1')
  }
  const declaredDifferenceKeys = new Set([
    ...Object.keys(treatmentDeclaration.team),
    ...Object.keys(treatmentDeclaration.solo)
  ].filter((key) => canonicalDifference(
    treatmentDeclaration.team[key],
    treatmentDeclaration.solo[key]
  )))
  if (declaredDifferenceKeys.size === 0) {
    throw new TypeError('definition.treatmentDeclaration must declare a Team/Solo difference')
  }
  for (const key of declaredDifferenceKeys) {
    if (!allowed.includes(key)) {
      throw new TypeError(`definition treatment difference ${key} is not allowed`)
    }
  }
  const fresh = normalizeStringSet(freshStateKeys, 'definition.freshStateKeys', true)
  for (const key of DEFAULT_FRESH_STATE_KEYS) {
    if (!fresh.includes(key)) throw new TypeError(`definition.freshStateKeys must include ${key}`)
  }
  const payload = {
    schemaId: PAIRED_DEFINITION_SCHEMA_ID,
    schemaVersion: PAIRED_DEFINITION_SCHEMA_VERSION,
    id,
    version,
    seed,
    estimand,
    partition,
    replicateCount,
    bindings,
    resourceProfileDigest,
    judgeConfigurationDigests: judgeDigests,
    blindingCanaryDigests: canaryDigests,
    treatmentDeclaration: structuredClone(treatmentDeclaration),
    nonInferiorityRule: structuredClone(nonInferiorityRule),
    commonFactors: structuredClone(commonFactors),
    allowedTreatmentDifferenceKeys: allowed,
    freshStateKeys: fresh
  }
  return deepFreeze({ ...payload, definitionDigest: digestJson(payload) })
}

export function validatePairedTrialDefinition(definition) {
  if (!definition || typeof definition !== 'object') throw new TypeError('paired definition must be an object')
  exactKeys(definition, [
    'schemaId',
    'schemaVersion',
    'id',
    'version',
    'seed',
    'estimand',
    'partition',
    'replicateCount',
    'bindings',
    'resourceProfileDigest',
    'judgeConfigurationDigests',
    'blindingCanaryDigests',
    'treatmentDeclaration',
    'nonInferiorityRule',
    'commonFactors',
    'allowedTreatmentDifferenceKeys',
    'freshStateKeys',
    'definitionDigest'
  ], 'paired definition')
  exactKeys(definition.bindings, ['case', 'toolMeasurement', 'verifier'], 'paired bindings')
  for (const [key, binding] of Object.entries(definition.bindings)) {
    exactKeys(binding, ['id', 'version', 'digest'], `paired binding ${key}`)
  }
  if (definition.schemaId !== PAIRED_DEFINITION_SCHEMA_ID
      || definition.schemaVersion !== PAIRED_DEFINITION_SCHEMA_VERSION) {
    throw new TypeError('unsupported paired definition schema')
  }
  const rebuilt = createPairedTrialDefinition({
    ...definition,
    caseBinding: definition.bindings?.case,
    toolMeasurementBinding: definition.bindings?.toolMeasurement,
    verifierBinding: definition.bindings?.verifier
  })
  if (definition.definitionDigest !== rebuilt.definitionDigest) {
    throw new TypeError('paired definition digest mismatch')
  }
  return definition
}

export function planPairedTrials(definition, { replicateCount = definition.replicateCount } = {}) {
  validatePairedTrialDefinition(definition)
  if (!Number.isSafeInteger(replicateCount) || replicateCount <= 0) {
    throw new TypeError('replicateCount must be a positive safe integer')
  }
  if (replicateCount !== definition.replicateCount) {
    throw new TypeError('replicateCount must match the frozen paired definition')
  }
  const random = seededRandom(`${definition.seed}:${definition.definitionDigest}:${replicateCount}`)
  const extra = random() < 0.5 ? 'team' : 'solo'
  const firstTreatments = Array.from({ length: replicateCount }, (_, index) => {
    if (index < Math.floor(replicateCount / 2)) return 'team'
    if (index < Math.floor(replicateCount / 2) * 2) return 'solo'
    return extra
  })
  shuffle(firstTreatments, random)
  const pairs = firstTreatments.map((firstTreatment, replicateIndex) => {
    const pairSlotId = `${definition.id}:pair:${replicateIndex + 1}`
    const armOrder = firstTreatment === 'team' ? ['team', 'solo'] : ['solo', 'team']
    return {
      replicateIndex,
      pairSlotId,
      armOrder,
      arms: armOrder.map((treatment, dispatchOrdinal) => ({
        treatment,
        dispatchOrdinal,
        armPlanId: `${pairSlotId}:${treatment}`,
        trialId: `trial-${digestJson({ definition: definition.definitionDigest, pairSlotId, treatment }).slice(0, 24)}`,
        peerTreatment: treatment === 'team' ? 'solo' : 'team'
      }))
    }
  })
  const payload = {
    schemaId: PAIRED_PLAN_SCHEMA_ID,
    schemaVersion: PAIRED_PLAN_SCHEMA_VERSION,
    definition: {
      id: definition.id,
      version: definition.version,
      payloadDigest: definition.definitionDigest
    },
    randomization: {
      method: 'sha256_seeded_counterbalanced_v1',
      seedDigest: digestJson({ seed: definition.seed }),
      replicateCount,
      teamFirstCount: pairs.filter((pair) => pair.armOrder[0] === 'team').length,
      soloFirstCount: pairs.filter((pair) => pair.armOrder[0] === 'solo').length
    },
    pairs
  }
  return { ...payload, integrity: { payloadDigest: digestJson(payload) } }
}

export function validatePairedTrialPlan(plan) {
  if (!plan || typeof plan !== 'object') throw new TypeError('paired plan must be an object')
  assertNoAggregateClaims(plan)
  exactKeys(plan, [
    'schemaId', 'schemaVersion', 'definition', 'randomization', 'pairs', 'integrity'
  ], 'paired plan')
  exactKeys(plan.definition, ['id', 'version', 'payloadDigest'], 'paired plan definition')
  exactKeys(plan.randomization, [
    'method', 'seedDigest', 'replicateCount', 'teamFirstCount', 'soloFirstCount'
  ], 'paired plan randomization')
  exactKeys(plan.integrity, ['payloadDigest'], 'paired plan integrity')
  if (plan.schemaId !== PAIRED_PLAN_SCHEMA_ID || plan.schemaVersion !== PAIRED_PLAN_SCHEMA_VERSION) {
    throw new TypeError('unsupported paired plan schema')
  }
  const { integrity, ...payload } = plan
  if (!integrity || integrity.payloadDigest !== digestJson(payload)) {
    throw new TypeError('paired plan digest mismatch')
  }
  if (!Array.isArray(plan.pairs) || plan.pairs.length !== plan.randomization?.replicateCount) {
    throw new TypeError('paired plan replicate count mismatch')
  }
  if (plan.randomization.teamFirstCount + plan.randomization.soloFirstCount !== plan.pairs.length
      || Math.abs(plan.randomization.teamFirstCount - plan.randomization.soloFirstCount) > 1) {
    throw new TypeError('paired plan is not counterbalanced')
  }
  const pairIds = new Set()
  const trialIds = new Set()
  for (const pair of plan.pairs) {
    exactKeys(pair, ['replicateIndex', 'pairSlotId', 'armOrder', 'arms'], 'paired plan pair')
    if (pairIds.has(pair.pairSlotId)) throw new TypeError('paired plan has duplicate pair slot ids')
    pairIds.add(pair.pairSlotId)
    if (!Array.isArray(pair.armOrder) || pair.armOrder.length !== 2
        || new Set(pair.armOrder).size !== 2
        || !pair.armOrder.includes('team') || !pair.armOrder.includes('solo')) {
      throw new TypeError('paired plan arm order is invalid')
    }
    if (!Array.isArray(pair.arms) || pair.arms.length !== 2
        || pair.arms.some((arm, index) => arm.treatment !== pair.armOrder[index])) {
      throw new TypeError('paired plan arm binding is invalid')
    }
    for (const arm of pair.arms) {
      exactKeys(arm, [
        'treatment', 'dispatchOrdinal', 'armPlanId', 'trialId', 'peerTreatment'
      ], 'paired plan arm')
      if (trialIds.has(arm.trialId)) throw new TypeError('paired plan has duplicate trial ids')
      trialIds.add(arm.trialId)
    }
  }
  return plan
}

function exactKeys(value, expected, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(keys)) {
    throw new TypeError(`${path} keys are not closed`)
  }
}

function seededRandom(value) {
  let state = Number.parseInt(digestJson({ value }).slice(0, 8), 16) || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

function shuffle(values, random) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[values[index], values[target]] = [values[target], values[index]]
  }
}

function normalizeStringSet(value, path, nonEmpty) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    throw new TypeError(`${path} must be ${nonEmpty ? 'a non-empty ' : 'an '}array`)
  }
  for (const [index, entry] of value.entries()) requireNonEmptyString(entry, `${path}[${index}]`)
  if (new Set(value).size !== value.length) throw new TypeError(`${path} must not contain duplicates`)
  return [...value].sort()
}

function requireNonEmptyString(value, path) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${path} must be a non-empty string`)
}

function requirePlainObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object`)
}

function normalizeBinding(value, path) {
  requirePlainObject(value, path)
  requireNonEmptyString(value.id, `${path}.id`)
  requireNonEmptyString(value.version, `${path}.version`)
  requireDigest(value.digest, `${path}.digest`)
  return { id: value.id, version: value.version, digest: value.digest }
}

function normalizeDigestObject(value, path) {
  requirePlainObject(value, path)
  const normalized = {}
  for (const key of Object.keys(value).sort()) {
    requireNonEmptyString(key, `${path}.key`)
    requireDigest(value[key], `${path}.${key}`)
    normalized[key] = value[key]
  }
  return normalized
}

function requireDigest(value, path) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${path} must be a SHA-256 digest`)
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function canonicalDifference(left, right) {
  if (left === undefined || right === undefined) return left !== right
  return digestJson(left) !== digestJson(right)
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
