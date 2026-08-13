import assert from 'node:assert/strict'
import test from 'node:test'
import { validateQualificationContractArtifactSchema } from '../../../lib/qualification-schema-validation.mjs'
import { digestJson } from '../../protocol/canonical.mjs'
import { defaultResourceMeasurementProfile, measureTrialResources } from '../resources/index.mjs'
import {
  assertPreDispatchPairedDefinition,
  comparePairedTrial,
  createPairedTrialDefinition,
  deriveObservedPairedExecution,
  derivePreDispatchPairedContext,
  planPairedTrials,
  validatePairedComparison,
  validatePairedTrialDefinition,
  validatePairedTrialPlan
} from './index.mjs'

const commonFactors = Object.freeze({
  requestDigest: '8'.repeat(64),
  workspaceFixtureDigest: '9'.repeat(64),
  budgetContractDigest: 'c'.repeat(64),
  leadRuntimeModelPermissionsDigest: 'b'.repeat(64),
  ordinaryToolAvailabilityDigest: 'a'.repeat(64),
  isolationProfileDigest: 'f'.repeat(64)
})

const reference = Object.freeze({
  artifactRole: 'paired-evidence',
  schemaId: 'test.paired-evidence',
  schemaVersion: '1.0.0',
  payloadDigest: 'd'.repeat(64),
  disclosure: 'private'
})

test('pair planning is deterministic, seeded, and counterbalanced', () => {
  const definition = definitionFixture()
  validatePairedTrialDefinition(definition)
  const first = planPairedTrials(definition, { replicateCount: 8 })
  const second = planPairedTrials(definition, { replicateCount: 8 })
  validatePairedTrialPlan(first)
  assert.deepEqual(first, second)
  assert.equal(first.randomization.teamFirstCount, 4)
  assert.equal(first.randomization.soloFirstCount, 4)
  assert.equal(first.pairs.every(({ armOrder }) => new Set(armOrder).size === 2), true)

  const oddDefinition = createPairedTrialDefinition({
    ...definitionInput(),
    id: 'paired-case-fixture-odd',
    replicateCount: 7
  })
  const odd = planPairedTrials(oddDefinition)
  assert.equal(Math.abs(odd.randomization.teamFirstCount - odd.randomization.soloFirstCount), 1)
  assert.equal(first.pairs.every(({ arms }) => arms.every((arm) => (
    arm.armPlanId && arm.trialId && arm.peerTreatment
  ))), true)
  assert.throws(
    () => planPairedTrials(definition, { replicateCount: 9 }),
    /must match the frozen paired definition/u
  )
})

test('paired factors are derived from admitted and normalized authorities instead of copied claims', () => {
  const caseRecord = {
    seal: '1'.repeat(64),
    contract: {
      manifest: {
        id: 'case-1',
        version: '1.0.0',
        budget: { elapsedSeconds: 60, maxAgentRuns: 4, maxAcceptedA2a: 3 }
      },
      components: { promptDigest: '8'.repeat(64), verifierDigest: '3'.repeat(64) },
      fixture: { digest: '9'.repeat(64) }
    }
  }
  const toolPack = {
    spec: { specificationId: 'tool-spec-1', schemaVersion: '1.0.0' },
    admission: { admissionDigest: `sha256:${'2'.repeat(64)}` }
  }
  const observed = derivePreDispatchPairedContext({ caseRecord, toolPack })
  const input = definitionInput()
  input.caseBinding = observed.bindings.case
  input.toolMeasurementBinding = observed.bindings.toolMeasurement
  input.verifierBinding = observed.bindings.verifier
  input.commonFactors = { ...input.commonFactors, ...observed.staticFactors }
  const definition = createPairedTrialDefinition(input)
  assert.equal(assertPreDispatchPairedDefinition(definition, observed), true)

  const changed = structuredClone(observed)
  changed.staticFactors.requestDigest = '0'.repeat(64)
  assert.throws(
    () => assertPreDispatchPairedDefinition(definition, changed),
    /requestDigest differs before dispatch/u
  )

  const normalized = deriveObservedPairedExecution({
    qualificationCase: {
      payload: {
        caseId: 'case-1',
        caseVersion: '1.0.0',
        caseSeal: `sha256:${'1'.repeat(64)}`,
        requestDigest: `sha256:${'8'.repeat(64)}`,
        fixtureDigest: `sha256:${'9'.repeat(64)}`,
        executionBudget: { elapsedSeconds: 60, maxAgentRunResponsibilities: 4, maxAcceptedA2A: 3 },
        isolationProfile: { digest: `sha256:${'d'.repeat(64)}` }
      }
    },
    verifierObservation: { payload: { verifierDigest: `sha256:${'3'.repeat(64)}` } },
    environmentManifest: {
      payload: {
        core: {
          builtinToolContractVersion: 1,
          builtinToolIpcProtocolVersion: 1,
          builtinToolCatalogDigest: `sha256:${'e'.repeat(64)}`
        },
        runtimes: [{
          memberId: 'agent_1',
          adapter: 'codex-cli',
          configurationDigest: `sha256:${'f'.repeat(64)}`,
          capabilityDigest: `sha256:${'a'.repeat(64)}`
        }]
      }
    },
    toolMeasurementBinding: observed.bindings.toolMeasurement
  })
  assert.deepEqual(normalized.bindings, observed.bindings)
  assert.equal(normalized.commonFactors.requestDigest, '8'.repeat(64))
  assert.equal(normalized.commonFactors.isolationProfileDigest, 'd'.repeat(64))
  assert.notEqual(normalized.commonFactors.leadRuntimeModelPermissionsDigest, input.commonFactors.leadRuntimeModelPermissionsDigest)
})

test('both-pass noninferior quality publishes compatible resource deltas without an aggregate score', () => {
  const definition = definitionFixture()
  const comparison = comparePairedTrial({
    definition,
    team: armFixture('team', { duration: 80 }),
    solo: armFixture('solo', { duration: 100 }),
    qualityComparison: quality('team_noninferior')
  })

  assert.equal(comparison.validity.status, 'valid')
  assert.equal(comparison.outcomeStratum, 'both_pass')
  assert.equal(comparison.resourceComparison.status, 'eligible')
  assert.deepEqual(comparison.resourceComparison.metrics.makespan_ms, {
    status: 'published',
    unit: 'milliseconds',
    direction: 'lower_is_better',
    team: 80,
    solo: 100,
    delta: -20,
    ratio: 0.8,
    ratioStatus: 'available',
    evidenceReferences: { team: [reference], solo: [reference] }
  })
  assert.equal(comparison.classification, 'efficiency_gain')
  validatePairedComparison(comparison)
  validateQualificationContractArtifactSchema(
    'paired-collaboration-experiment-v1.schema.json',
    comparison
  )
  assert.equal('aggregateScore' in comparison, false)
  assert.equal('score' in comparison, false)
  assert.equal('winner' in comparison, false)
  assert.equal('speedup' in comparison.resourceComparison.metrics.makespan_ms, false)
})

test('team-only outcome is classified as an outcome win and resource deltas are suppressed', () => {
  const comparison = comparePairedTrial({
    definition: definitionFixture(),
    team: armFixture('team', { duration: 150, outcome: 'pass' }),
    solo: armFixture('solo', { duration: 100, outcome: 'fail' }),
    qualityComparison: { status: 'unavailable' }
  })

  assert.equal(comparison.outcomeStratum, 'team_only_pass')
  assert.equal(comparison.classification, 'dominant')
  assert.equal(comparison.resourceComparison.metrics, null)
  assert.deepEqual(comparison.resourceComparison.reasonCodes, [
    'paired.resource_blinded_quality_unavailable',
    'paired.resource_requires_both_pass'
  ])
})

test('unexpected treatment drift and reused state invalidate causal interpretation', () => {
  const team = armFixture('team')
  const solo = armFixture('solo')
  team.treatmentFactors.model = 'different-model'
  solo.treatmentFactors.model = 'baseline-model'
  solo.freshState.identities.memory = team.freshState.identities.memory
  const comparison = comparePairedTrial({
    definition: definitionFixture(),
    team,
    solo,
    qualityComparison: quality('equivalent')
  })

  assert.equal(comparison.validity.status, 'invalid')
  assert.equal(comparison.observedOutcomeStratum, 'both_pass')
  assert.equal(comparison.outcomeStratum, 'indeterminate')
  assert.equal(comparison.classification, 'inconclusive')
  assert.deepEqual(comparison.validity.reasonCodes, [
    'paired.fresh_state_reused:memory',
    'paired.solo_arm_artifact_invalid',
    'paired.solo_treatment_declaration_mismatch',
    'paired.team_arm_artifact_invalid',
    'paired.team_treatment_declaration_mismatch',
    'paired.unexpected_treatment_difference:model'
  ])
  assert.equal(comparison.resourceComparison.metrics, null)
})

test('swapped, unplanned, and colliding arm plan bindings invalidate a pair', () => {
  const definition = definitionFixture()
  const team = armFixture('team')
  const solo = armFixture('solo')
  const teamOrdinal = team.planBinding.dispatchOrdinal
  team.planBinding.dispatchOrdinal = solo.planBinding.dispatchOrdinal
  solo.planBinding.dispatchOrdinal = teamOrdinal
  let comparison = comparePairedTrial({
    definition, team, solo, qualityComparison: quality('equivalent')
  })
  assert.equal(comparison.validity.reasonCodes.includes('paired.team_arm_plan_mismatch'), true)
  assert.equal(comparison.validity.reasonCodes.includes('paired.solo_arm_plan_mismatch'), true)

  const unplanned = armFixture('team')
  unplanned.planBinding.pairSlotId = 'unplanned-slot'
  comparison = comparePairedTrial({
    definition,
    team: unplanned,
    solo: armFixture('solo'),
    qualityComparison: quality('equivalent')
  })
  assert.equal(comparison.validity.reasonCodes.includes('paired.team_pair_slot_unplanned'), true)
  assert.equal(comparison.validity.reasonCodes.includes('paired.arms_not_from_same_pair_slot'), true)

  const collisionTeam = armFixture('team')
  const collisionSolo = armFixture('solo')
  collisionSolo.planBinding.dispatchOrdinal = collisionTeam.planBinding.dispatchOrdinal
  comparison = comparePairedTrial({
    definition,
    team: collisionTeam,
    solo: collisionSolo,
    qualityComparison: quality('equivalent')
  })
  assert.equal(comparison.validity.reasonCodes.includes('paired.arm_dispatch_ordinal_collision'), true)
  assert.equal(comparison.validity.reasonCodes.includes('paired.solo_arm_plan_mismatch'), true)
})

test('resource publication requires treatment-blind quality noninferiority', () => {
  const comparison = comparePairedTrial({
    definition: definitionFixture(),
    team: armFixture('team', { duration: 50 }),
    solo: armFixture('solo', { duration: 100 }),
    qualityComparison: quality('solo_superior')
  })
  assert.equal(comparison.outcomeStratum, 'both_pass')
  assert.equal(comparison.resourceComparison.status, 'ineligible')
  assert.deepEqual(comparison.resourceComparison.reasonCodes, [
    'paired.resource_quality_noninferiority_not_met'
  ])
  assert.equal(comparison.classification, 'inconclusive')
})

test('profile drift and missing evidence suppress false resource comparisons', () => {
  const team = armFixture('team')
  const solo = armFixture('solo')
  solo.resources.integrity.payloadDigest = 'invalid-after-tamper'
  const invalidArtifact = comparePairedTrial({
    definition: definitionFixture(), team, solo, qualityComparison: quality('equivalent')
  })
  assert.deepEqual(invalidArtifact.resourceComparison.reasonCodes, ['paired.resource_artifact_invalid'])

  const profileDrift = armFixture('solo')
  profileDrift.resources.profile.payloadDigest = 'e'.repeat(64)
  resign(profileDrift.resources)
  const changedProfile = comparePairedTrial({
    definition: definitionFixture(),
    team: armFixture('team'),
    solo: profileDrift,
    qualityComparison: quality('equivalent')
  })
  assert.equal(changedProfile.validity.status, 'invalid')
  assert.equal(
    changedProfile.validity.reasonCodes.includes('paired.solo_resource_artifact_profile_changed'),
    true
  )

  const withoutEvidence = armFixture('team')
  for (const metric of withoutEvidence.resources.measurements) metric.evidenceReferences = []
  resign(withoutEvidence.resources)
  const missingEvidence = comparePairedTrial({
    definition: definitionFixture(),
    team: withoutEvidence,
    solo: armFixture('solo'),
    qualityComparison: quality('equivalent')
  })
  assert.deepEqual(missingEvidence.resourceComparison.reasonCodes, ['paired.resource_artifact_invalid'])
})

test('superior Team quality with proven higher resource use is a quality-cost tradeoff', () => {
  const comparison = comparePairedTrial({
    definition: definitionFixture(),
    team: armFixture('team', { duration: 120 }),
    solo: armFixture('solo', { duration: 100 }),
    qualityComparison: quality('team_superior')
  })
  assert.equal(comparison.classification, 'quality_gain_with_cost')
  assert.equal(comparison.resourceComparison.metrics.makespan_ms.delta, 20)
})

test('paired artifact validators reject aggregate scores and winners even with a valid digest', () => {
  const comparison = comparePairedTrial({
    definition: definitionFixture(),
    team: armFixture('team'),
    solo: armFixture('solo'),
    qualityComparison: quality('equivalent')
  })
  comparison.aggregateScore = 100
  resign(comparison)
  assert.throws(() => validatePairedComparison(comparison), /forbidden aggregate claim/u)

  const plan = planPairedTrials(definitionFixture())
  plan.winner = 'team'
  resign(plan)
  assert.throws(() => validatePairedTrialPlan(plan), /forbidden aggregate claim/u)
})

test('paired artifact validators reject undeclared fields even when content digests are recomputed', () => {
  const definition = structuredClone(definitionFixture())
  definition.experimental = true
  definition.definitionDigest = digestJson(stripDefinitionDigest(definition))
  assert.throws(() => validatePairedTrialDefinition(definition), /keys are not closed/u)

  const plan = planPairedTrials(definitionFixture())
  plan.pairs[0].arms[0].debug = 'leak'
  resign(plan)
  assert.throws(() => validatePairedTrialPlan(plan), /keys are not closed/u)

  const comparison = comparePairedTrial({
    definition: definitionFixture(),
    team: armFixture('team'),
    solo: armFixture('solo'),
    qualityComparison: quality('equivalent')
  })
  comparison.resourceComparison.debug = true
  resign(comparison)
  assert.throws(() => validatePairedComparison(comparison), /keys are not closed/u)
})

function definitionFixture() {
  return createPairedTrialDefinition(definitionInput())
}

function stripDefinitionDigest(definition) {
  const { definitionDigest, ...payload } = definition
  return payload
}

function definitionInput() {
  return {
    id: 'paired-case-fixture',
    version: '1.0.0',
    seed: 'fixture-seed',
    estimand: 'team_policy_effect_on_hard_outcome_and_resources',
    partition: 'development',
    replicateCount: 8,
    caseBinding: { id: 'case-1', version: '1.0.0', digest: '1'.repeat(64) },
    toolMeasurementBinding: { id: 'tool-spec-1', version: '1.0.0', digest: '2'.repeat(64) },
    verifierBinding: { id: 'verifier-1', version: '1.0.0', digest: '3'.repeat(64) },
    resourceProfileDigest: defaultResourceMeasurementProfile().profileDigest,
    judgeConfigurationDigests: { outcome: '5'.repeat(64), toolUse: '6'.repeat(64) },
    blindingCanaryDigests: { treatment: '7'.repeat(64) },
    treatmentDeclaration: {
      team: { coordinationMode: 'multi_agent' },
      solo: { coordinationMode: 'single_agent' }
    },
    nonInferiorityRule: { construct: 'blinded_outcome_quality', maximumOrdinalLoss: 0 },
    commonFactors,
    allowedTreatmentDifferenceKeys: ['coordinationMode']
  }
}

function armFixture(treatment, { duration = 100, outcome = 'pass' } = {}) {
  const treatmentSuffix = treatment === 'team' ? 'team' : 'solo'
  const definition = definitionFixture()
  const plan = planPairedTrials(definition)
  const pair = plan.pairs[0]
  const plannedArm = pair.arms.find((arm) => arm.treatment === treatment)
  const planReference = { ...reference, payloadDigest: plan.integrity.payloadDigest }
  return {
    treatment,
    runId: plannedArm.trialId,
    planBinding: {
      planDigest: plan.integrity.payloadDigest,
      pairSlotId: pair.pairSlotId,
      armPlanId: plannedArm.armPlanId,
      trialId: plannedArm.trialId,
      dispatchOrdinal: plannedArm.dispatchOrdinal,
      evidenceReferences: [planReference]
    },
    commonFactors: structuredClone(commonFactors),
    definitionBindings: structuredClone(definition.bindings),
    resourceProfileDigest: definition.resourceProfileDigest,
    treatmentFactors: {
      coordinationMode: treatment === 'team' ? 'multi_agent' : 'single_agent'
    },
    freshState: {
      status: 'attested',
      identities: {
        workspace: `workspace-${treatmentSuffix}`,
        coreData: `core-${treatmentSuffix}`,
        camp: `camp-${treatmentSuffix}`,
        memory: `memory-${treatmentSuffix}`,
        conversation: `conversation-${treatmentSuffix}`,
        nativeSession: `native-session-${treatmentSuffix}`
      },
      evidenceReferences: [reference]
    },
    outcome: {
      status: outcome,
      artifactDigest: reference.payloadDigest,
      evidenceReferences: [reference]
    },
    resources: resourceArtifact(duration)
  }
}

function resourceArtifact(duration) {
  return measureTrialResources({
    observation: {
      trialInterval: {
        startMs: 0,
        endMs: duration,
        coverage: { status: 'complete' },
        clockDomain: 'runner_monotonic',
        authority: 'runner',
        evidenceReferences: [reference]
      },
      agentRuns: {
        coverage: { status: 'complete' },
        clockDomain: 'core_persisted_wall_clock',
        authority: 'core',
        intervals: [{ startMs: 0, endMs: duration, evidenceReferences: [reference] }],
        evidenceReferences: [reference]
      },
      coordinationWaits: {
        coverage: { status: 'complete' },
        clockDomain: 'core_persisted_wall_clock',
        authority: 'core',
        intervals: [],
        evidenceReferences: [reference]
      },
      criticalPath: {
        coverage: { status: 'complete' },
        clockDomain: 'core_persisted_wall_clock',
        authority: 'core',
        nodes: [{ id: 'run', durationMs: duration, evidenceReferences: [reference] }],
        edges: [],
        evidenceReferences: [reference]
      },
      usage: {
        coverage: { status: 'unavailable', reasonCode: 'fixture.no_provider_receipts' },
        evidenceReferences: []
      }
    }
  })
}

function quality(verdict) {
  return {
    status: 'available',
    verdict,
    treatmentBlind: true,
    configurationDigest: '5'.repeat(64),
    blindingCanaryDigest: '7'.repeat(64),
    evidenceReferences: [reference]
  }
}

function resign(artifact) {
  const { integrity: _integrity, ...payload } = artifact
  artifact.integrity = { payloadDigest: digestJson(payload) }
}
