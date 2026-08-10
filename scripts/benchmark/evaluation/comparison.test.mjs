import assert from 'node:assert/strict'
import test from 'node:test'
import { benchmarkRunFixture } from '../test-fixtures.mjs'
import { compareBenchmarkRuns } from './comparison.mjs'

test('comparison returns five independent eligible axes and only eligible deltas', () => {
  const baseline = benchmarkRunFixture({ runId: 'baseline' })
  const candidate = benchmarkRunFixture({ runId: 'candidate', recordedAt: '2026-08-10T01:00:00.000Z' })
  const comparison = compareBenchmarkRuns(baseline, candidate)
  assert.deepEqual(Object.keys(comparison.axes).sort(), [
    'collaboration', 'contractConformance', 'evidenceIntegrity', 'hardOutcome', 'performance'
  ])
  for (const axis of Object.values(comparison.axes)) assert.equal(axis.eligible, true)
  assert.equal(comparison.deltas.hardOutcome.changed, false)
})

test('case seal and team configuration drift suppress affected deltas with stable reason codes', () => {
  const baseline = benchmarkRunFixture({ runId: 'baseline' })
  const candidate = benchmarkRunFixture({
    runId: 'candidate',
    verification: { caseSealDigest: 'b'.repeat(64) },
    executionEnvironment: { teamConfigurationDigest: 'c'.repeat(64) }
  })
  const comparison = compareBenchmarkRuns(baseline, candidate)
  assert.deepEqual(comparison.axes.hardOutcome.reasonCodes, ['hard_outcome.case_seal_changed'])
  assert.deepEqual(comparison.axes.collaboration.reasonCodes, ['collaboration.team_configuration_changed'])
  assert.equal(comparison.deltas.hardOutcome, null)
  assert.equal(comparison.deltas.collaboration, null)
  assert.equal(comparison.axes.hardOutcome.displayOnlyMetrics.includes('hardOutcome'), true)
})
