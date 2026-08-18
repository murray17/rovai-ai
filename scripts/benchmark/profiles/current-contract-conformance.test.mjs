import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  CURRENT_CONTRACT_CRITERIA,
  CURRENT_CONTRACT_DATA_STORE,
  CURRENT_CONTRACT_PREREQUISITES,
  CURRENT_CONTRACT_PROFILE
} from './current-contract-conformance.mjs'

test('current contract profile is deterministic, offline, and covers every requested criterion', async () => {
  assert.equal(CURRENT_CONTRACT_PROFILE.id, 'current-contract-conformance')
  assert.equal(CURRENT_CONTRACT_PROFILE.version, '1.11.0')
  assert.equal(CURRENT_CONTRACT_PROFILE.suite.version, '1.11.0')
  assert.deepEqual(CURRENT_CONTRACT_DATA_STORE, { version: 'v1.11', projectionSchemaVersion: 51 })
  assert.equal(CURRENT_CONTRACT_CRITERIA.length, 15)
  assert.equal(CURRENT_CONTRACT_PROFILE.suite.cases.length, CURRENT_CONTRACT_CRITERIA.length)
  assert.equal(CURRENT_CONTRACT_PROFILE.publicationPolicy.publishOutcomeRate, false)
  assert.equal(CURRENT_CONTRACT_PROFILE.publicationPolicy.passAtK, false)
  assert.equal(CURRENT_CONTRACT_PREREQUISITES.length, 3)
  for (const reference of [...CURRENT_CONTRACT_CRITERIA.flatMap((entry) => entry.evidence),
    ...CURRENT_CONTRACT_PREREQUISITES.map((entry) => entry.evidence)]) {
    const source = await readFile(reference.locator, 'utf8')
    assert.match(source, new RegExp(`fn\\s+${reference.testName}\\s*\\(`))
  }
})
