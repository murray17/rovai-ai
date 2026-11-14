import assert from 'node:assert/strict'
import test from 'node:test'
import { nativeTimingCoverage, summarizeNativeKeys } from './native-input-metrics.mjs'

const timing = (start, duration) => ({ start, duration, processingStart: start + 1, processingEnd: start + 2 })
test('an unmatched slow key cannot lower the full-sample percentiles', () => {
  const summary = summarizeNativeKeys([{ start: 10 }, { start: 110 }], [timing(10, 56)])
  assert.equal(summary.validity, 'incomplete')
  assert.equal(summary.unknown, 1)
  assert.equal(summary.censored, 0)
  assert.equal(summary.eventTimingMs, null)
  assert.equal(summary.observedEventTimingMs.p95, 56)
})
test('reported short durations are distinct from missing or ambiguous timing', () => {
  const summary = summarizeNativeKeys([{ start: 10 }, { start: 110 }, { start: 210 }],
    [timing(10, 8), timing(210, 40), timing(211, 48)])
  assert.equal(summary.reportedBelowThreshold, 1)
  assert.equal(summary.matched, 1)
  assert.deepEqual(summary.unknownStarts, [110, 210])
})
test('one timing entry cannot account for two recorded keydowns', () => {
  const summary = summarizeNativeKeys([{ start: 10 }, { start: 11 }], [timing(10, 48)])
  assert.equal(summary.matched, 1)
  assert.equal(summary.unknown, 1)
})
test('complete observations preserve the actual duration, waiting and processing quantiles', () => {
  const summary = summarizeNativeKeys([{ start: 10 }, { start: 110 }], [timing(10, 48), timing(110, 56)])
  assert.equal(summary.validity, 'complete')
  assert.deepEqual(summary.eventTimingMs, { p50: 56, p95: 56, p99: 56 })
  assert.equal(summary.inputDelayMs.p95, 1)
  assert.equal(summary.processingMs.p95, 1)
  assert.equal(summary.postProcessingApproxMs.p95, 54)
})
test('verified threshold censoring uses intervals and never turns an unknown slow dispatch into zero', () => {
  const keys = [{ type: 'keydown', start: 10, observedAt: 15, trusted: true, visibility: 'visible', focused: true },
    { type: 'keydown', start: 110, observedAt: 135, trusted: true, visibility: 'visible', focused: true }]
  const rows = [{ type: 'environment', eventTimingSupported: true, thresholdMs: 16, eventCountAtStart: 0 }, ...keys,
    { ...keys[0], start: 210, observedAt: 215 },
    { type: 'collection', eventCountAtEnd: 3, at: 1000, complete: true, dropped: 0 }]
  const coverage = nativeTimingCoverage(rows)
  const completedLater = [timing(210, 48)]
  const incomplete = summarizeNativeKeys(keys, completedLater, { coverage })
  assert.equal(incomplete.censored, 1); assert.equal(incomplete.unknown, 1)
  assert.equal(incomplete.eventTimingMs, null)
  const complete = summarizeNativeKeys([keys[0]], completedLater, { coverage })
  assert.equal(complete.eventTimingMs.p95, '<16ms (censored)')
  assert.equal(summarizeNativeKeys([keys[0]], [], { coverage }).unknown, 1, 'pending rendering cannot certify threshold censoring')
  assert.equal(summarizeNativeKeys([{ ...keys[0], focused: false }], completedLater, { coverage }).unknown, 1)
})
test('a lost event, hidden input or observer overflow cannot certify censoring', () => {
  const key = { type: 'keydown', start: 10, observedAt: 15, trusted: true, visibility: 'visible' }
  const environment = { type: 'environment', eventTimingSupported: true, thresholdMs: 16, eventCountAtStart: 0 }
  for (const collection of [{ eventCountAtEnd: 2, dropped: 0 }, { eventCountAtEnd: 1, dropped: 1 }]) {
    const coverage = nativeTimingCoverage([environment, key, { type: 'collection', at: 1000, complete: true, ...collection }])
    assert.equal(summarizeNativeKeys([key], [], { coverage }).unknown, 1)
  }
  const coverage = { verified: true, endedAt: 1000, visibility: [{ value: 'hidden', at: 20 }] }
  assert.equal(summarizeNativeKeys([key], [], { coverage }).unknown, 1)
})
test('verified coverage cannot turn ambiguous or reused timing into a censored sample', () => {
  const key = { start: 10, observedAt: 15, trusted: true, visibility: 'visible' }
  const coverage = { verified: true, endedAt: 1000, visibility: [] }
  const ambiguous = summarizeNativeKeys([key], [timing(10, 40), timing(11, 48)], { coverage })
  assert.equal(ambiguous.unknown, 1); assert.equal(ambiguous.censored, 0)
  const reused = summarizeNativeKeys([key, { ...key, start: 11 }], [timing(10, 40)], { coverage })
  assert.equal(reused.unknown, 1); assert.equal(reused.censored, 0)
})
