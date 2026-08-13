import assert from 'node:assert/strict'
import test from 'node:test'
import { validateQualificationContractArtifactSchema } from '../../../lib/qualification-schema-validation.mjs'
import { digestJson } from '../../protocol/canonical.mjs'
import {
  createResourceMeasurementProfile,
  defaultResourceMeasurementProfile,
  measureTrialResources,
  validateResourceMeasurement,
  validateResourceMeasurementProfile
} from './index.mjs'

const reference = Object.freeze({
  artifactRole: 'resource-evidence',
  schemaId: 'test.resource-evidence',
  schemaVersion: '1.0.0',
  payloadDigest: 'a'.repeat(64),
  disclosure: 'private'
})

test('default profile freezes typed metric semantics and content identity', () => {
  const first = defaultResourceMeasurementProfile()
  const second = defaultResourceMeasurementProfile()
  assert.equal(first.profileDigest, second.profileDigest)
  assert.equal(Object.isFrozen(first), true)
  assert.deepEqual(first.metrics.find(({ id }) => id === 'makespan_ms'), {
    id: 'makespan_ms',
    unit: 'milliseconds',
    direction: 'lower_is_better',
    interval: 'dispatch_to_terminal',
    aggregation: 'elapsed',
    clockDomain: 'runner_monotonic',
    authority: 'runner',
    coverage: 'complete_required'
  })
  validateResourceMeasurementProfile(first)
})

test('profile validation rejects duplicate metrics and digest drift', () => {
  const descriptor = {
    id: 'custom',
    unit: 'count',
    direction: 'descriptive',
    interval: 'trial_events',
    aggregation: 'sum',
    clockDomain: 'core_persisted_wall_clock',
    authority: 'core',
    coverage: 'complete_required'
  }
  assert.throws(() => createResourceMeasurementProfile({
    id: 'duplicate', version: '1.0.0', metrics: [descriptor, descriptor]
  }), /unique ids/u)

  const tampered = structuredClone(defaultResourceMeasurementProfile())
  tampered.version = '2.0.0'
  assert.throws(() => validateResourceMeasurementProfile(tampered), /digest mismatch/u)
})

test('measurement derives monotonic, concurrency, wait, critical-path, token, and cost metrics', () => {
  const artifact = measureTrialResources({ observation: completeObservation() })
  validateResourceMeasurement(artifact)
  validateQualificationContractArtifactSchema('resource-measurement-v1.schema.json', artifact)
  const values = Object.fromEntries(artifact.measurements.map((entry) => [entry.id, entry]))

  assert.equal(values.makespan_ms.value, 100)
  assert.equal(values.agent_active_union_ms.value, 80)
  assert.equal(values.agent_active_sum_ms.value, 100)
  assert.equal(values.max_agent_concurrency.value, 2)
  assert.equal(values.coordination_wait_ms.value, 15)
  assert.equal(values.critical_path_ms.value, 80)
  assert.equal(values.input_tokens.value, 12)
  assert.equal(values.output_tokens.value, 8)
  assert.equal(values.total_tokens.value, 20)
  assert.equal(values.cost_usd_micros.value, 310)
  assert.deepEqual(values.agent_active_union_ms.evidenceReferences, [reference])
  assert.equal(values.critical_path_ms.coverage.status, 'complete')
})

test('incomplete wait and critical-path coverage is unavailable instead of an underestimate', () => {
  const observation = completeObservation()
  observation.coordinationWaits = {
    coverage: { status: 'partial', reasonCode: 'fixture.wait_page_missing' },
    intervals: [{ startMs: 1, endMs: 2 }],
    evidenceReferences: [reference]
  }
  observation.criticalPath.coverage = { status: 'partial' }
  const artifact = measureTrialResources({ observation })
  const values = Object.fromEntries(artifact.measurements.map((entry) => [entry.id, entry]))

  assert.equal(values.coordination_wait_ms.status, 'unavailable')
  assert.equal(values.coordination_wait_ms.reason.code, 'fixture.wait_page_missing')
  assert.equal(values.critical_path_ms.status, 'unavailable')
  assert.equal(values.critical_path_ms.reason.code, 'resource.critical_path_coverage_incomplete')
})

test('tokens and cost remain unavailable without authoritative provider receipts', () => {
  const observation = completeObservation()
  observation.usage.receipts[0].authority.status = 'estimated'
  const artifact = measureTrialResources({ observation })
  const usage = artifact.measurements.filter(({ clockDomain }) => clockDomain === 'provider_receipt')
  assert.equal(usage.every(({ status }) => status === 'unavailable'), true)
  assert.equal(usage.every(({ reason }) => reason.code === 'resource.usage_receipt_not_authoritative'), true)
})

test('critical-path cycles fail closed without affecting independently measured resources', () => {
  const observation = completeObservation()
  observation.criticalPath.edges.push({ from: 'verify', to: 'lead', evidenceReferences: [reference] })
  const artifact = measureTrialResources({ observation })
  const criticalPath = artifact.measurements.find(({ id }) => id === 'critical_path_ms')
  const makespan = artifact.measurements.find(({ id }) => id === 'makespan_ms')
  assert.equal(criticalPath.status, 'unavailable')
  assert.equal(criticalPath.reason.code, 'resource.critical_path_cycle')
  assert.equal(makespan.value, 100)
})

test('source clock and authority cannot be relabeled by a measurement profile', () => {
  const observation = completeObservation()
  observation.trialInterval.clockDomain = 'core_persisted_wall_clock'
  observation.agentRuns.authority = 'runner'
  const artifact = measureTrialResources({ observation })
  const values = Object.fromEntries(artifact.measurements.map((entry) => [entry.id, entry]))
  assert.equal(values.makespan_ms.reason.code, 'resource.source_clock_domain_mismatch')
  assert.equal(values.agent_active_union_ms.reason.code, 'resource.source_authority_mismatch')
  assert.equal(values.agent_active_sum_ms.reason.code, 'resource.source_authority_mismatch')
})

test('unknown profile metrics are explicit unavailable records and artifact tampering is rejected', () => {
  const custom = createResourceMeasurementProfile({
    id: 'custom',
    version: '1.0.0',
    metrics: [{
      id: 'tool_calls',
      unit: 'count',
      direction: 'descriptive',
      interval: 'trial_events',
      aggregation: 'sum',
      clockDomain: 'core_persisted_wall_clock',
      authority: 'core',
      coverage: 'complete_required'
    }]
  })
  const artifact = measureTrialResources({ profile: custom, observation: completeObservation() })
  assert.equal(artifact.measurements[0].reason.code, 'resource.metric_implementation_unavailable')

  const tampered = structuredClone(artifact)
  tampered.measurements[0].status = 'available'
  assert.throws(() => validateResourceMeasurement(tampered), /digest mismatch/u)
})

test('resource validators reject undeclared fields even when content digests are recomputed', () => {
  const profile = structuredClone(defaultResourceMeasurementProfile())
  profile.metrics[0].debug = true
  assert.throws(() => validateResourceMeasurementProfile(profile), /keys are not closed/u)

  const artifact = measureTrialResources({ observation: completeObservation() })
  artifact.measurements[0].debug = true
  const { integrity: _integrity, ...payload } = artifact
  artifact.integrity.payloadDigest = digestJson(payload)
  assert.throws(() => validateResourceMeasurement(artifact), /keys are not closed/u)

  const forgedReference = measureTrialResources({ observation: completeObservation() })
  forgedReference.measurements[0].evidenceReferences[0].score = 100
  const { integrity: _forgedIntegrity, ...forgedPayload } = forgedReference
  forgedReference.integrity.payloadDigest = digestJson(forgedPayload)
  assert.throws(() => validateResourceMeasurement(forgedReference), /evidenceReferences\[0\] is invalid/u)
})

function completeObservation() {
  return {
    trialInterval: {
      startMs: 1_000,
      endMs: 1_100,
      coverage: { status: 'complete' },
      clockDomain: 'runner_monotonic',
      authority: 'runner',
      evidenceReferences: [reference]
    },
    agentRuns: {
      coverage: { status: 'complete' },
      clockDomain: 'core_persisted_wall_clock',
      authority: 'core',
      intervals: [
        { id: 'lead', startMs: 1_000, endMs: 1_060, evidenceReferences: [reference] },
        { id: 'member', startMs: 1_040, endMs: 1_080, evidenceReferences: [reference] }
      ],
      evidenceReferences: [reference]
    },
    coordinationWaits: {
      coverage: { status: 'complete' },
      clockDomain: 'core_persisted_wall_clock',
      authority: 'core',
      intervals: [
        { startMs: 1_020, endMs: 1_030, evidenceReferences: [reference] },
        { startMs: 1_025, endMs: 1_035, evidenceReferences: [reference] }
      ],
      evidenceReferences: [reference]
    },
    criticalPath: {
      coverage: { status: 'complete' },
      clockDomain: 'core_persisted_wall_clock',
      authority: 'core',
      nodes: [
        { id: 'lead', durationMs: 60, evidenceReferences: [reference] },
        { id: 'verify', durationMs: 20, evidenceReferences: [reference] },
        { id: 'member', durationMs: 40, evidenceReferences: [reference] }
      ],
      edges: [
        { from: 'lead', to: 'verify', evidenceReferences: [reference] },
        { from: 'member', to: 'verify', evidenceReferences: [reference] }
      ],
      evidenceReferences: [reference]
    },
    usage: {
      coverage: { status: 'complete' },
      clockDomain: 'provider_receipt',
      authority: 'provider',
      receipts: [
        {
          authority: { status: 'authoritative', kind: 'provider_receipt' },
          metrics: { input_tokens: 5, output_tokens: 3, total_tokens: 8, cost_usd_micros: 100 },
          evidenceReferences: [reference]
        },
        {
          authority: { status: 'authoritative', kind: 'provider_receipt' },
          metrics: { input_tokens: 7, output_tokens: 5, cost_usd_micros: 210 },
          evidenceReferences: [reference]
        }
      ],
      evidenceReferences: [reference]
    }
  }
}
