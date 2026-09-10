const count = value => Number.isSafeInteger(value) && value >= 0

export async function captureRuntimeUsage(request) {
  try { return { state: 'captured', capturedAt: new Date().toISOString(), snapshot: await request('monitoring.snapshot', { range: '24h' }) } }
  catch { return { state: 'unavailable', capturedAt: new Date().toISOString(), reason: { code: 'resource_measurement.monitoring_snapshot_unavailable' } } }
}

// Monitoring already deduplicates native usage and distinguishes reported cost
// from estimates. Reuse it only when its population equals this fresh Trial.
export function deriveIsolatedRuntimeUsage(before, after, runCount) {
  const unavailable = code => ({ state: 'unavailable', authority: 'core_monitoring_runtime_reported', reason: { code }, evidence: ['runtime-usage-before.json', 'runtime-usage-after.json'] })
  if (before?.state !== 'captured' || after?.state !== 'captured') return unavailable('resource_measurement.monitoring_snapshot_unavailable')
  const b = before.snapshot, a = after.snapshot
  if (a.schemaVersion !== 2 || b.schemaVersion !== 2 || a.collection?.epoch !== b.collection?.epoch || !count(runCount) || runCount < 1) return unavailable('resource_measurement.usage_scope_unproven')
  const fields = { inputTokens: 'promptInputTotalTokens', outputTokens: 'outputTokens', cacheReadTokens: 'cacheReadTokens', reasoningOutputTokens: 'reasoningOutputTokens' }
  if (Object.values(fields).some(key => b.coverage?.[key]?.eligibleRuns !== 0 || b.coverage?.[key]?.observedRuns !== 0)) return unavailable('resource_measurement.preexisting_usage_population')
  const tokens = {}, coverage = {}
  for (const [key, source] of Object.entries(fields)) {
    const c = a.coverage?.[source]
    const complete = c?.eligibleRuns === runCount && c?.observedRuns === runCount && count(a.summary?.[source])
    tokens[key] = complete ? a.summary[source] : null
    coverage[key] = { expectedRuns: runCount, eligibleRuns: c?.eligibleRuns ?? null, observedRuns: c?.observedRuns ?? null, state: complete ? 'complete' : 'incomplete' }
  }
  tokens.totalTokens = tokens.inputTokens !== null && tokens.outputTokens !== null ? tokens.inputTokens + tokens.outputTokens : null
  const complete = tokens.totalTokens !== null
  const costCoverage = a.coverage?.cost
  const costComplete = costCoverage?.eligibleRuns === runCount && costCoverage?.observedRuns === runCount
  return { state: complete ? 'complete' : 'partial', authority: 'core_monitoring_runtime_reported', reason: complete ? null : { code: 'resource_measurement.usage_coverage_incomplete' },
    evidence: ['runtime-usage-before.json', 'runtime-usage-after.json'], tokens, coverage,
    cost: { state: costComplete && a.summary?.cost?.run?.length ? 'observed' : 'unavailable', values: costComplete ? a.summary?.cost?.run ?? [] : [],
      eligibleRuns: costCoverage?.eligibleRuns ?? null, observedRuns: costCoverage?.observedRuns ?? null,
      limitation: 'Each value retains its reported/estimated kind; an estimate is not an actual bill. Missing cost is not zero.' } }
}
