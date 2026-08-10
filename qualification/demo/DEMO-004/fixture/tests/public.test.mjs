import assert from 'node:assert/strict'
import test from 'node:test'
import { migrateState } from '../src/migrate-state.mjs'

test('migrateState remains a callable public export', () => {
  assert.equal(typeof migrateState, 'function')
  const state = { version: 3, profile: { name: 'demo' }, records: [] }
  const result = migrateState(state)
  assert.equal(result.version, 3)
  assert.deepEqual(result.profile, state.profile)
  assert.deepEqual(result.records, state.records)
})
