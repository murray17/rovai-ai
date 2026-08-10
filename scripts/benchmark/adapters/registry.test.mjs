import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolveBenchmarkAdapter, normalizeBenchmarkArtifact } from './registry.mjs'
import { legacyV034Profile } from '../profiles/legacy-v034.mjs'
import { aggregateBenchmarkSuite, defineBenchmarkProfile, generatePlannedSlots } from '../execution/suite.mjs'

test('legacy v0.34 adapter keeps strict 3-round/4-case admission with arbitrary IDs', () => {
  const suite = {
    schemaVersion: 2,
    version: 'v0.34',
    id: 'legacy-suite',
    seed: 'fixed-seed',
    rounds: 3,
    calibration: { id: 'CAL', directory: 'cal', version: '1.0.0', seal: 'a'.repeat(64) },
    cases: ['alpha', 'beta', 'gamma', 'delta'].map((id, index) => ({
      id, directory: id, version: '1.0.0', seal: ['a', 'b', 'c', 'd'][index].repeat(64)
    }))
  }
  const profile = legacyV034Profile(suite)
  assert.equal(generatePlannedSlots(profile).length, 12)
  assert.throws(() => legacyV034Profile({ ...suite, rounds: 2 }), /3 rounds/)
  assert.throws(() => legacyV034Profile({ ...suite, cases: suite.cases.slice(0, 3) }), /4 cases/)
})

test('generic Suite aggregates a non-3x4 profile without fixed Case IDs', () => {
  const profile = defineBenchmarkProfile({
    id: 'small-fixture', version: '1.0.0', lane: 'fixture',
    hardOutcomeDefinition: { passWhen: ['fixture_pass'] },
    publicationPolicy: { publishOutcomeRate: true },
    suite: {
      id: 'small-suite', version: '1.0.0', seed: 'none', shuffle: false,
      rounds: [{ id: 'warmup', ordinal: 1 }, { id: 'repeat', ordinal: 2 }],
      cases: ['case-a', 'case-b', 'case-c'].map((id) => ({ id, version: '1.0.0', seal: id[0].repeat(64) }))
    }
  })
  const slots = generatePlannedSlots(profile)
  assert.deepEqual(slots.map((slot) => slot.plannedSlotId), [
    'warmup-case-a', 'warmup-case-b', 'warmup-case-c', 'repeat-case-a', 'repeat-case-b', 'repeat-case-c'
  ])
  const summary = aggregateBenchmarkSuite(profile, slots.map((slot, index) => ({
    plannedSlotId: slot.plannedSlotId,
    validity: 'valid', evaluationState: 'complete', hardOutcome: index === 0 ? 'fail' : 'pass'
  })))
  assert.equal(summary.counts.planned, 6)
  assert.equal(summary.counts.passes, 5)
  assert.equal(summary.publication.outcomeRate, 5 / 6)
})

test('v0.36 public portfolio adapter preserves the immutable source identity', async () => {
  const source = JSON.parse(await readFile('qualification/diagnostic/v0.36/results/DCP-001-1.0.1.json', 'utf8'))
  assert.equal(resolveBenchmarkAdapter(source).id, 'diagnostic-portfolio-v036')
  assert.equal(normalizeBenchmarkArtifact(source).suite.plannedSlotCount, 8)
  assert.equal(source.payloadDigest, 'sha256:c2e90de2f0ab572bbd4d8d9b5ab0207bc8596403e5ed7fc98b55a2712d1b73aa')
})

test('unknown schema major fails closed', () => {
  assert.throws(() => resolveBenchmarkAdapter({ schemaVersion: 99 }), /unsupported or unknown Benchmark artifact schema major/)
})
