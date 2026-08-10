import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRetryPlan } from '../src/retry-plan.mjs'

test('buildRetryPlan remains a callable public export', () => {
  assert.equal(typeof buildRetryPlan, 'function')
  assert.deepEqual(buildRetryPlan([], 3), [])
})
