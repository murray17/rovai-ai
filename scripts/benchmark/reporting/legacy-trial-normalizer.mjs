import { normalizeLegacyQualificationTrial } from '../adapters/registry.mjs'
import { sha256 } from '../protocol/canonical.mjs'

export function normalizeLegacyProjectTrial({ entry, source, adapterId }) {
  const result = source.result.value
  const normalized = normalizeLegacyQualificationTrial(result, adapterId)
  if (result.trialId !== entry.trialId || result.case?.id !== entry.caseId
      || normalized.validity !== 'valid' || normalized.evaluationState !== 'complete'
      || !['pass', 'fail'].includes(normalized.hardOutcome)) {
    throw new Error(`selected Trial is not one valid scored outcome: ${entry.trialId}`)
  }
  return {
    round: entry.round,
    caseId: entry.caseId,
    trialId: entry.trialId,
    runnerVersion: result.runnerVersion,
    result: normalized.hardOutcome,
    verifiedDelivery: normalized.verifiedDelivery,
    functionalVerificationPassed: result.schemaVersion === 1
      ? result.verifier?.verifiedDelivery === true
      : (result.deliveryLayer?.checkResults ?? [])
        .filter((check) => check.kind === 'hard' && check.observationAuthority === 'verifier')
        .every((check) => check.status === 'passed'),
    orchestrationConvergence: normalized.orchestrationConvergence,
    postDispatchHumanIntervention: normalized.postDispatchHumanIntervention,
    changeBoundaryPassed: result.changeBoundary?.passed === true,
    budgetTriggered: result.budget?.event ?? null,
    observedAgentRuns: result.budget?.observedAgentRuns ?? null,
    observedMemberCalls: result.budget?.observedAcceptedA2a
      ?? result.budget?.observedDurableA2aEffects
      ?? null,
    memberCallCountAuthority: result.budget?.observedAcceptedA2a !== null
      && result.budget?.observedAcceptedA2a !== undefined
      ? 'canonical_acceptance_receipt'
      : result.budget?.observedDurableA2aEffects !== undefined
        ? 'durable_effect_observation'
        : 'unavailable',
    members: result.collaborationEvidence?.members ?? [],
    collaborationAuditStatus: result.collaborationAudit?.status
      ?? (result.collaborationAudit?.passed === true
        ? 'passed'
        : result.collaborationAudit?.passed === false ? 'failed' : 'indeterminate'),
    collaborationAuditPassed: result.collaborationAudit?.passed === true,
    collaborationChecks: result.collaborationAudit?.checks ?? {},
    collaborationMetrics: result.collaborationEvidence?.metrics ?? {},
    pollingViolations: result.collaborationEvidence?.pollingViolations?.length ?? 0,
    sameMemberRunOverlaps: findRunOverlaps(result.collaborationEvidence?.runGraph ?? []),
    memberRunDurations: sumRunDurations(result.collaborationEvidence?.runGraph ?? []),
    schedulingEvidence: deriveSchedulingEvidence(source.observations),
    verifierCategories: (result.schemaVersion === 2
      ? result.deliveryLayer?.categories ?? []
      : result.verifier?.categories ?? []).map((category) => ({
      name: category.categoryId ?? category.name,
      status: category.status
    })),
    publicHardChecks: result.schemaVersion === 2
      ? (result.deliveryLayer?.checkResults ?? [])
        .filter((check) => check.kind === 'hard' && check.disclosure === 'public')
        .map((check) => ({ checkId: check.checkId, status: check.status }))
      : [],
    changeBoundaryViolations: result.changeBoundary?.violations ?? [],
    modeOnlyChangedPaths: (result.workspaceDiff?.changed ?? [])
      .filter((change) => change.before?.digest && change.before.digest === change.after?.digest
        && change.before.mode !== change.after?.mode)
      .map((change) => change.path),
    changedPaths: (result.workspaceDiff?.changed ?? [])
      .map((change) => change.path)
      .filter((path) => !isManagedProjectionPath(path)),
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationSeconds: durationSeconds(result.startedAt, result.completedAt),
    evidenceDigest: sha256(source.result.raw)
  }
}

function deriveSchedulingEvidence(observations) {
  let pendingWhileBusy = false
  let maxPendingWhileBusyInputs = 0
  for (const observation of observations) {
    const snapshot = observation.snapshot
    const pending = (snapshot?.conversationInputs ?? []).filter((input) => input.status === 'pending')
    const busyConversations = new Set((snapshot?.agentRuns ?? [])
      .filter((run) => ['queued', 'running', 'waiting'].includes(run.status))
      .map((run) => run.conversationId))
    const busyPending = pending.filter((input) => busyConversations.has(input.conversationId))
    maxPendingWhileBusyInputs = Math.max(maxPendingWhileBusyInputs, busyPending.length)
    if (busyPending.length > 0) pendingWhileBusy = true
  }
  return { pendingWhileBusy, maxPendingWhileBusyInputs }
}

function findRunOverlaps(runGraph) {
  const overlaps = []
  for (let index = 0; index < runGraph.length; index += 1) {
    const left = runGraph[index]
    if (!left.startedAt || !left.endedAt) continue
    for (let other = index + 1; other < runGraph.length; other += 1) {
      const right = runGraph[other]
      if (left.agentId !== right.agentId || !right.startedAt || !right.endedAt) continue
      if (Date.parse(left.startedAt) < Date.parse(right.endedAt)
          && Date.parse(right.startedAt) < Date.parse(left.endedAt)
          && !overlaps.includes(left.agentId)) overlaps.push(left.agentId)
    }
  }
  return overlaps
}

function sumRunDurations(runGraph) {
  const values = {}
  for (const run of runGraph) {
    if (!run.startedAt || !run.endedAt) continue
    const seconds = (Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000
    if (!Number.isFinite(seconds) || seconds < 0) continue
    values[run.agentId] = Math.round(((values[run.agentId] ?? 0) + seconds) * 10) / 10
  }
  return values
}

function durationSeconds(startedAt, completedAt) {
  const value = (Date.parse(completedAt) - Date.parse(startedAt)) / 1000
  if (!Number.isFinite(value) || value < 0) throw new Error('Trial duration is invalid')
  return Math.round(value * 10) / 10
}

function isManagedProjectionPath(path) {
  return ['.agent', '.agents', '.claude', '.gemini']
    .some((root) => path === root || path.startsWith(`${root}/`))
}
