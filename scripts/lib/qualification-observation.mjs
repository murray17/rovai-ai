const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])
const ACTIVE_DELIVERY_STATUSES = new Set(['pending', 'running'])
const ACTIVE_ACTION_STATUSES = new Set(['prepared', 'executing'])

export const QUALIFICATION_UNATTENDED_RETRY_GRACE_MS = 2_000

export function deriveUnattendedRetryBoundary(snapshot, campTurnId) {
  if (!snapshot || typeof campTurnId !== 'string') return null
  const turn = array(snapshot.turns).find((candidate) => candidate.id === campTurnId)
  if (turn?.status !== 'waiting' || turn.executionBudget?.exhaustedAt) return null
  const runs = array(snapshot.agentRuns).filter((run) => run.campTurnId === campTurnId)
  if (runs.length === 0 || !runs.every((run) => TERMINAL_RUN_STATUSES.has(run.status))) return null
  const failedRequiredRuns = runs.filter((run) => (
    run.completionRole === 'required' && run.status === 'failed'
  ))
  if (failedRequiredRuns.length === 0) return null
  const runIds = new Set(runs.map((run) => run.id))
  const automaticSettlementPending = runs.some((run) => run.hasUnsettledExternalEffects === true)
    || array(snapshot.messageDeliveries).some((delivery) => (
      delivery.campTurnId === campTurnId && ACTIVE_DELIVERY_STATUSES.has(delivery.status)
    ))
    || array(snapshot.actions).some((action) => (
      runIds.has(action.agentRunId)
      && (ACTIVE_ACTION_STATUSES.has(action.status)
        || (action.status === 'unknown' && action.effectDisposition === 'unknown'))
    ))
  if (automaticSettlementPending) return null
  return {
    authority: 'runner_unattended_policy',
    reason: 'unattended_manual_retry',
    agentRuns: runs.length,
    failedRequiredAgentRunIds: failedRequiredRuns.map((run) => run.id).sort()
  }
}

function array(value) {
  return Array.isArray(value) ? value : []
}
