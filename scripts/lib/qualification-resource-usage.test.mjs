import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveIsolatedRuntimeUsage } from './qualification-resource-usage.mjs'

function snapshot(n) {
  return { state: 'captured', snapshot: { schemaVersion: 2, collection: { epoch: 'isolated' }, summary: { promptInputTotalTokens: n ? 100 : null, outputTokens: n ? 20 : null, cacheReadTokens: n ? 0 : null, reasoningOutputTokens: n ? 5 : null, cost: null },
    coverage: Object.fromEntries(['promptInputTotalTokens', 'outputTokens', 'cacheReadTokens', 'reasoningOutputTokens', 'cost'].map(key => [key, { eligibleRuns: n, observedRuns: key === 'cost' ? 0 : n }])) } }
}
test('fresh isolated usage preserves authoritative zero and absent cost separately', () => {
  const r = deriveIsolatedRuntimeUsage(snapshot(0), snapshot(2), 2)
  assert.equal(r.state, 'complete'); assert.equal(r.tokens.totalTokens, 120)
  assert.equal(r.tokens.cacheReadTokens, 0); assert.equal(r.cost.state, 'unavailable')
})
test('preexisting population and a changed epoch cannot be attributed to the trial', () => {
  assert.equal(deriveIsolatedRuntimeUsage(snapshot(1), snapshot(2), 1).state, 'unavailable')
  const after = snapshot(1); after.snapshot.collection.epoch = 'other'
  assert.equal(deriveIsolatedRuntimeUsage(snapshot(0), after, 1).state, 'unavailable')
})
test('partial, missing and mismatched coverage cannot silently become full token totals', () => {
  const after = snapshot(2); after.snapshot.coverage.outputTokens.observedRuns = 1
  const r = deriveIsolatedRuntimeUsage(snapshot(0), after, 2)
  assert.equal(r.tokens.outputTokens, null); assert.equal(r.tokens.totalTokens, null)
  assert.equal(r.tokens.inputTokens, 100); assert.equal(r.state, 'partial')
  assert.equal(deriveIsolatedRuntimeUsage(snapshot(0), snapshot(3), 2).tokens.totalTokens, null)
  assert.equal(deriveIsolatedRuntimeUsage(null, after, 2).state, 'unavailable')
})
