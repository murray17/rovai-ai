import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import { benchmarkRunFixture } from '../test-fixtures.mjs'
import {
  createBenchmarkRunV3,
  deriveBenchmarkRunV3,
  readBenchmarkRunV3,
  validateBenchmarkRunV3,
  writeBenchmarkRunV3
} from './v3.mjs'
import { sha256 } from './canonical.mjs'

test('v3 round-trip and content identity are deterministic', async () => {
  const first = benchmarkRunFixture({ runId: 'run-one', recordedAt: '2026-08-10T00:00:00.000Z' })
  const second = benchmarkRunFixture({ runId: 'run-two', recordedAt: '2026-08-10T00:00:01.000Z' })
  assert.equal(first.integrity.contentIdentityDigest, second.integrity.contentIdentityDigest)
  assert.notEqual(first.integrity.payloadDigest, second.integrity.payloadDigest)
  const directory = await mkdtemp(join(tmpdir(), 'benchmark-v3-'))
  try {
    const path = join(directory, 'run.json')
    await writeBenchmarkRunV3(path, first)
    assert.deepEqual(await readBenchmarkRunV3(path), first)
    const firstBytes = await readFile(path, 'utf8')
    await writeBenchmarkRunV3(path, first)
    assert.equal(await readFile(path, 'utf8'), firstBytes)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('v3 fixture validates against the published JSON Schema', async () => {
  const schema = JSON.parse(await readFile('docs/versions/v0.53/schemas/benchmark-run-v3.schema.json', 'utf8'))
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(schema)
  const run = benchmarkRunFixture()
  assert.equal(validate(run), true, JSON.stringify(validate.errors))
})

test('v3 rejects unknown majors, inconsistent integrity, and public path leaks', () => {
  const valid = benchmarkRunFixture()
  assert.throws(() => validateBenchmarkRunV3({ ...valid, schemaVersion: 4 }), /unsupported/)
  assert.throws(() => validateBenchmarkRunV3({
    ...valid,
    integrity: { ...valid.integrity, contentIdentityDigest: sha256('tampered') }
  }), /integrity digest mismatch/)
  const input = structuredClone(valid)
  delete input.integrity
  input.productContract.releaseBuildIdentity.value = '/Users/example/private/build'
  assert.throws(() => createBenchmarkRunV3(input), /leaks an absolute or private path/)
})

test('derived v3 projection records the exact source digest without changing source', () => {
  const source = { schemaVersion: 2, suiteVersion: 'v0.34', stable: true }
  const raw = `${JSON.stringify(source, null, 2)}\n`
  const normalized = benchmarkRunFixture()
  delete normalized.integrity
  delete normalized.schemaId
  delete normalized.schemaVersion
  delete normalized.benchmarkProtocolVersion
  const before = structuredClone(source)
  const derived = deriveBenchmarkRunV3(raw, normalized, 'qualification-suite-v034')
  assert.deepEqual(source, before)
  assert.equal(derived.derivedFrom.sourceArtifactDigest, sha256(raw))
  assert.equal(derived.derivedFrom.adapterId, 'qualification-suite-v034')
})
