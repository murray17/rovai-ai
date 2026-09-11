import assert from 'node:assert/strict'
import test from 'node:test'
import { applyPatchPlan } from '../src/apply-patch-plan.mjs'

test('applyPatchPlan remains a callable public export', () => {
  assert.equal(typeof applyPatchPlan, 'function')
  assert.deepEqual(applyPatchPlan({}, []), { committed: true, tree: {}, error: null })
})
