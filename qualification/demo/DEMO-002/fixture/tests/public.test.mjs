import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeEvents } from '../src/normalize-events.mjs'

test('normalizeEvents remains a callable public export', () => {
  assert.equal(typeof normalizeEvents, 'function')
  assert.deepEqual(normalizeEvents([]), [])
})
