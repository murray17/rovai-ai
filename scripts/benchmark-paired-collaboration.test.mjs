import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runCaptured } from './lib/qualification-common.mjs'
import { defaultResourceMeasurementProfile } from './benchmark/measurement/resources/index.mjs'

test('paired CLI writes deterministic plan and refuses to compare arms without plan evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-paired-cli-'))
  try {
    const definitionPath = join(root, 'definition.json')
    const planPath = join(root, 'plan.json')
    await writeFile(definitionPath, `${JSON.stringify(definitionInput(), null, 2)}\n`)
    const planned = await runCaptured(process.execPath, [
      'scripts/benchmark-paired-collaboration.mjs',
      'plan',
      '--definition', definitionPath,
      '--output', planPath
    ], { cwd: process.cwd() })
    assert.equal(planned.code, 0, planned.stderr)
    const plan = JSON.parse(await readFile(planPath, 'utf8'))
    assert.equal(plan.pairs.length, 2)
    assert.deepEqual(plan.pairs[0].armOrder.slice().sort(), ['solo', 'team'])
    assert.equal(plan.pairs.every((pair) => pair.arms.every((arm) => arm.armPlanId)), true)

    const teamPath = join(root, 'team.json')
    const soloPath = join(root, 'solo.json')
    const qualityPath = join(root, 'quality.json')
    const outputPath = join(root, 'comparison.json')
    await writeFile(teamPath, JSON.stringify({ treatment: 'team' }))
    await writeFile(soloPath, JSON.stringify({ treatment: 'solo' }))
    await writeFile(qualityPath, JSON.stringify({ status: 'unavailable' }))
    const compared = await runCaptured(process.execPath, [
      'scripts/benchmark-paired-collaboration.mjs',
      'compare',
      '--definition', definitionPath,
      '--team-arm', teamPath,
      '--solo-arm', soloPath,
      '--quality-comparison', qualityPath,
      '--output', outputPath
    ], { cwd: process.cwd() })
    assert.equal(compared.code, 0, compared.stderr)
    const comparison = JSON.parse(await readFile(outputPath, 'utf8'))
    assert.equal(comparison.validity.status, 'invalid')
    assert.equal(comparison.outcomeStratum, 'indeterminate')
    assert.equal('aggregateScore' in comparison, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function definitionInput() {
  const digest = (character) => character.repeat(64)
  return {
    id: 'paired-cli-fixture',
    version: '1.0.0',
    seed: 'paired-cli-seed',
    estimand: 'team_policy_effect_on_hard_outcome_and_resources',
    partition: 'development',
    replicateCount: 2,
    caseBinding: { id: 'case-1', version: '1.0.0', digest: digest('1') },
    toolMeasurementBinding: { id: 'tool-1', version: '1.0.0', digest: digest('2') },
    verifierBinding: { id: 'verifier-1', version: '1.0.0', digest: digest('3') },
    resourceProfileDigest: defaultResourceMeasurementProfile().profileDigest,
    judgeConfigurationDigests: { outcome: digest('5'), toolUse: digest('6') },
    blindingCanaryDigests: { treatment: digest('7') },
    treatmentDeclaration: {
      team: { coordinationMode: 'multi_agent' },
      solo: { coordinationMode: 'single_agent' }
    },
    nonInferiorityRule: { construct: 'blinded_outcome_quality', maximumOrdinalLoss: 0 },
    commonFactors: {
      requestDigest: digest('8'),
      workspaceFixtureDigest: digest('9'),
      budgetContractDigest: digest('a'),
      leadRuntimeModelPermissionsDigest: digest('b'),
      ordinaryToolAvailabilityDigest: digest('c'),
      isolationProfileDigest: digest('d')
    },
    allowedTreatmentDifferenceKeys: ['coordinationMode']
  }
}
