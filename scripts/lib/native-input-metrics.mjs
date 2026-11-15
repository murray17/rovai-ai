import assert from 'node:assert/strict'

const percentile = (values, p) => values.length
  ? values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] : null
export const inputStatistics = values => Object.fromEntries([['p50', .5], ['p95', .95], ['p99', .99]]
  .map(([key, p]) => [key, percentile(values, p)]))

export function nativeTimingCoverage(rows) {
  const environment = rows.find(row => row.type === 'environment')
  const collection = rows.findLast(row => row.type === 'collection')
  const captured = rows.filter(row => row.type === 'keydown')
  const delta = collection?.eventCountAtEnd - environment?.eventCountAtStart
  return { verified: Boolean(environment?.eventTimingSupported && environment.thresholdMs === 16
    && collection?.complete && collection.dropped === 0 && delta === captured.length
    && captured.every(key => key.trusted === true && typeof key.visibility === 'string')),
    captured: captured.length, counted: Number.isFinite(delta) ? delta : null,
    endedAt: collection?.at, visibility: rows.filter(row => row.type === 'visibility') }
}

// Absence alone is unknown. Threshold censoring is inferred only after the
// observer's lifecycle, eventCounts, visibility and dispatch timing are checked.
// Censored observations remain an interval, never a substituted 0ms sample.
export function summarizeNativeKeys(keys, timings, { coverage } = {}) {
  const used = new Set()
  const entries = keys.map(key => {
    const candidates = timings.filter(entry => (!entry.name || entry.name === 'keydown')
      && Math.abs(entry.start - key.start) < 2 && !used.has(entry))
    if (candidates.length !== 1 || !Number.isFinite(candidates[0].duration) || candidates[0].duration < 0) return null
    used.add(candidates[0]); return candidates[0]
  })
  const reported = entries.filter(Boolean)
  const censored = keys.filter((key, index) => !entries[index] && coverage?.verified
    && !timings.some(entry => (!entry.name || entry.name === 'keydown') && Math.abs(entry.start - key.start) < 2)
    && key.visibility === 'visible' && key.focused === true && coverage.endedAt - key.observedAt >= 100
    && key.observedAt >= key.start && key.observedAt - key.start < 16
    // A later completed event fences an earlier pending rendering observation.
    // Merely taking records 100ms later does not prove rendering has completed.
    && timings.some(entry => (!entry.name || entry.name === 'keydown') && entry.start > key.start
      && Number.isFinite(entry.duration) && entry.start + entry.duration + 8 <= coverage.endedAt)
    && !coverage.visibility.some(event => event.value !== 'visible' && event.at >= key.start && event.at < key.start + 100))
  const censoredKeys = new Set(censored)
  const unknownStarts = keys.filter((key, index) => !entries[index] && !censoredKeys.has(key)).map(key => key.start)
  const observed = inputStatistics(reported.map(entry => entry.duration))
  const low = censored.length + reported.filter(entry => entry.duration < 16).length
  const high = reported.filter(entry => entry.duration >= 16).map(entry => entry.duration).sort((a, b) => a - b)
  const full = censored.length ? Object.fromEntries([['p50', .5], ['p95', .95], ['p99', .99]].map(([name, p]) => {
    const rank = Math.min(keys.length - 1, Math.floor(keys.length * p))
    return [name, rank < low ? '<16ms (censored)' : high[rank - low]]
  })) : observed
  return {
    samples: keys.length, matched: reported.length, reportedBelowThreshold: reported.filter(entry => entry.duration < 16).length,
    censored: censored.length, unknown: unknownStarts.length, unknownStarts,
    validity: unknownStarts.length ? 'incomplete' : censored.length ? 'complete-with-threshold-censoring' : 'complete',
    eventTimingMs: unknownStarts.length ? null : full, observedEventTimingMs: observed,
    coverage: coverage ? { verified: coverage.verified, captured: coverage.captured, counted: coverage.counted } : undefined,
    inputDelayMs: inputStatistics(reported.map(entry => entry.processingStart - entry.start)),
    processingMs: inputStatistics(reported.map(entry => entry.processingEnd - entry.processingStart)),
    postProcessingApproxMs: inputStatistics(reported.map(entry => Math.max(0, entry.start + entry.duration - entry.processingEnd)))
  }
}

export function summarizeNativeImeRound(rows, round, { repetitions = 30 } = {}) {
  const keys = rows.filter(row => row.type === 'keydown' && row.round === round
    && !row.metaKey && !row.ctrlKey && !row.altKey && (/^Key/.test(row.code ?? '') || row.code === 'Space'))
  const timings = rows.filter(row => row.type === 'eventTiming')
  const commits = rows.filter(row => row.type === 'compositionend' && row.round === round && row.data === '测试').length
  const finalText = rows.filter(row => row.type === 'input' && row.round === round).at(-1)?.text?.replaceAll('\u200b', '')
  assert.equal(keys.length, repetitions * 6); assert.equal(commits, repetitions); assert.equal(finalText, '测试'.repeat(repetitions))
  return { round, durationMs: keys.at(-1).start - keys[0].start, commits, characters: finalText.length,
    ...summarizeNativeKeys(keys, timings, { coverage: nativeTimingCoverage(rows) }) }
}

export function summarizeNativePlainRound(rows, round, { samples = 180 } = {}) {
  const keys = rows.filter(row => row.type === 'keydown' && row.round === round
    && !row.metaKey && !row.ctrlKey && !row.altKey && (/^Key/.test(row.code ?? '') || row.code === 'Space'))
  assert.equal(keys.length, samples, 'all scheduled ordinary keys must arrive')
  assert.ok(keys.every(key => key.code === 'KeyA' && key.key === 'a'), 'ordinary rounds require lowercase a')
  assert.equal(rows.filter(row => row.type === 'compositionstart' && row.round === round).length, 0,
    'ordinary-input sampling requires a Latin input source')
  const finalText = rows.filter(row => row.type === 'input' && row.round === round).at(-1)?.text?.replaceAll('\u200b', '')
  assert.equal(finalText, 'a'.repeat(samples), 'all ordinary characters must survive')
  return { round, durationMs: keys.at(-1).start - keys[0].start, characters: finalText.length,
    ...summarizeNativeKeys(keys, rows.filter(row => row.type === 'eventTiming'), { coverage: nativeTimingCoverage(rows) }) }
}
