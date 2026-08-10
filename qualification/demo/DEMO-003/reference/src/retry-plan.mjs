export function buildRetryPlan(attempts, maxAttempts) {
  const limit = Number.isFinite(maxAttempts) ? Math.max(1, Math.trunc(maxAttempts)) : 1
  const state = new Map()
  for (const record of attempts) {
    const operationId = typeof record?.operationId === 'string' ? record.operationId.trim() : ''
    if (!operationId) continue
    const current = state.get(operationId) ?? { count: 0, succeeded: false }
    current.count += 1
    if (record.status === 'succeeded') current.succeeded = true
    state.set(operationId, current)
  }
  return [...state].flatMap(([operationId, current]) => (
    !current.succeeded && current.count < limit
      ? [{ operationId, nextAttempt: current.count + 1 }]
      : []
  ))
}
