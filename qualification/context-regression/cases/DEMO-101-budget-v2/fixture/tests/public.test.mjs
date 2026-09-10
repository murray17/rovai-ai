import assert from 'node:assert/strict'
import test from 'node:test'
import { groupEvents } from '../src/group-events.mjs'

test('groupEvents remains a callable public export', () => {
  assert.equal(typeof groupEvents, 'function')
  assert.deepEqual(groupEvents([]), [])
})
