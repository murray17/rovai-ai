import { sha256 } from './qualification-common.mjs'

export function extractEvidenceIdentity(payload) {
  if (!payload || typeof payload !== 'object') return null
  const identity = {}
  for (const key of [
    'tool',
    'toolName',
    'toolCallId',
    'canonicalTool',
    'title',
    'kind',
    'status',
    'sourceAuthority',
    'authorizationDecision',
    'errorCode',
    'receiptId'
  ]) {
    if (typeof payload[key] === 'string' && payload[key].length <= 160) identity[key] = payload[key]
  }
  if (typeof payload.idempotentReplay === 'boolean') {
    identity.idempotentReplay = payload.idempotentReplay
  }
  for (const [sourceKey, targetKey] of [
    ['type', 'nativeItemType'],
    ['status', 'nativeItemStatus'],
    ['tool', 'nativeItemTool'],
    ['server', 'nativeItemServer']
  ]) {
    const value = payload.item?.[sourceKey]
    if (typeof value === 'string' && value.length <= 160) identity[targetKey] = value
  }
  const command = typeof payload.command === 'string'
    ? payload.command
    : typeof payload.item?.command === 'string'
      ? payload.item.command
      : null
  if (command && /(?:^|[\s;"'])sleep\s+(?:\d|\$)/.test(command)) {
    identity.pollingPrimitive = 'sleep'
  }
  return Object.keys(identity).length > 0 ? identity : null
}

export function deriveCollaborationEvidence(snapshot, dispatchBoundary) {
  if (!snapshot || !dispatchBoundary) {
    return { status: 'indeterminate', reason: 'authoritative snapshot unavailable' }
  }
  const runs = snapshot.agentRuns.filter((run) => run.campTurnId === dispatchBoundary.campTurnId)
  const runIds = new Set(runs.map((run) => run.id))
  const inbox = snapshot.inboxMessages.filter((message) => (
    runs.some((run) => run.id === message.sourceAgentRunId || run.id === message.targetAgentRunId)
  ))
  const inputs = snapshot.conversationInputs.filter((input) => (
    input.campTurnId === dispatchBoundary.campTurnId
  ))
  const inputByInboxId = new Map(inputs.flatMap((input) => (
    input.sourceInboxMessageId ? [[input.sourceInboxMessageId, input]] : []
  )))
  const turn = snapshot.turns?.find((candidate) => candidate.id === dispatchBoundary.campTurnId)
  const authoritativeAcceptedA2a = turn?.executionBudget?.acceptedA2a
  const receiptEvents = (snapshot.timeline ?? []).filter((event) => (
    event.eventType === 'member_call.accepted'
    && event.payload?.campTurnId === dispatchBoundary.campTurnId
  ))
  const receiptByInboxId = new Map(receiptEvents.flatMap((event) => (
    event.payload?.inboxMessageId ? [[event.payload.inboxMessageId, event]] : []
  )))
  inbox.sort((left, right) => (
    compareNullableNumber(left.timelineGlobalSequence, right.timelineGlobalSequence)
    || String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
    || left.id.localeCompare(right.id)
  ))
  const runById = new Map(runs.map((run) => [run.id, run]))
  const pollingViolations = derivePollingViolations(
    snapshot.executionEvidence.filter((evidence) => runIds.has(evidence.agentRunId))
  )
  const taskFacts = snapshot.tasks.map((task) => ({
    id: task.id,
    status: task.status,
    assigneeAgentId: task.assigneeAgentId,
    sourceAgentRunId: task.sourceAgentRunId
  }))
  const calls = inbox.map((message, index) => {
    const receipt = receiptByInboxId.get(message.id) ?? null
    const input = inputByInboxId.get(message.id) ?? null
    const recipientRunId = input?.consumingAgentRunId ?? message.targetAgentRunId ?? null
    const recipientRun = recipientRunId ? runById.get(recipientRunId) ?? null : null
    const mechanicalSettlement = deriveMechanicalSettlement(input, recipientRun)
    return {
      callId: message.id,
      acceptanceReceiptId: receipt?.payload?.acceptanceReceiptId ?? null,
      acceptanceEventId: receipt?.eventId ?? null,
      acceptanceReceiptCoverage: receipt ? 'complete' : 'unavailable',
      acceptedAt: receipt?.createdAt ?? null,
      inboxMessageId: message.id,
      slot: receipt?.payload?.slot ?? null,
      observedOrder: index + 1,
      senderAgentId: message.senderAgentId,
      recipientAgentId: message.recipientAgentId,
      contentDigest: typeof message.body === 'string' ? sha256(message.body) : null,
      sourceAgentRunId: message.sourceAgentRunId,
      recipientRunId,
      taskId: recipientRun?.taskId ?? null,
      depth: receipt?.payload?.depth ?? recipientRun?.a2aDepth ?? null,
      conversationInputId: input?.id ?? null,
      inputSequence: input?.sequence ?? null,
      inputStatus: input?.status ?? null,
      inputPersistedAt: input?.createdAt ?? null,
      inputMaterializedAt: input?.materializedAt ?? null,
      inputTerminalAt: input?.terminalAt ?? null,
      inputTerminalReason: input?.terminalReason ?? null,
      recipientRunStatus: recipientRun?.status ?? 'not_materialized',
      recipientRunMaterializedAt: recipientRun?.createdAt ?? null,
      recipientRunStartedAt: recipientRun?.startedAt ?? null,
      recipientRunTerminalAt: recipientRun?.endedAt ?? null,
      recipientRunReason: recipientRun?.waitReason ?? null,
      delivered: message.deliveredAt !== null,
      failed: message.failedAt !== null,
      mechanicalSettlement
    }
  })
  const acceptanceCoverageComplete = Number.isInteger(authoritativeAcceptedA2a)
    && authoritativeAcceptedA2a === receiptEvents.length
    && receiptEvents.length === calls.length
    && calls.every((call) => call.acceptanceReceiptId !== null)
  const observedSettledMemberCalls = calls.filter(
    (call) => call.mechanicalSettlement.state === 'settled'
  ).length
  return {
    status: 'observed',
    members: [...new Set(runs.map((run) => run.agentId))],
    runGraph: runs.map((run) => ({
      id: run.id,
      agentProfileId: run.agentId,
      status: run.status,
      invocationKind: run.invocationKind,
      parentRunId: run.a2aParentAgentRunId,
      depth: run.a2aDepth,
      startedAt: run.startedAt,
      endedAt: run.endedAt
    })),
    a2a: calls,
    repeatedRouting: findRepeatedRouting(inbox),
    taskFacts,
    metrics: {
      acceptedMemberCalls: Number.isInteger(authoritativeAcceptedA2a)
        ? authoritativeAcceptedA2a
        : null,
      observedDurableMemberCalls: inbox.length,
      settledMemberCalls: acceptanceCoverageComplete ? observedSettledMemberCalls : null,
      observedSettledMemberCalls,
      maximumDepth: Math.max(0, ...runs.map((run) => run.a2aDepth ?? 0)),
      completedTasks: taskFacts.filter((task) => task.status === 'completed').length,
      coverage: acceptanceCoverageComplete
        ? 'complete_with_canonical_acceptance_receipts'
        : 'partial_canonical_acceptance_receipt_coverage'
    },
    pollingViolations,
    semanticAttribution: {
      status: 'indeterminate',
      reason: 'Semantic necessity, feedback absorption, and integration quality require the independent Judge layer.'
    }
  }
}

export function evaluateCollaborationContract(contract, evidence) {
  if (!contract) return { applicable: false, status: 'not_applicable', passed: true, checks: {} }
  const members = new Set(evidence?.members ?? [])
  const metrics = evidence?.metrics ?? {}
  const checks = {
    requiredMembersRan: contract.requiredMemberIds.every((member) => members.has(member)),
    acceptedMemberCalls: Number.isInteger(metrics.acceptedMemberCalls)
      ? metrics.acceptedMemberCalls >= contract.minAcceptedMemberCalls
      : 'indeterminate',
    completedTasks: (metrics.completedTasks ?? 0) >= contract.minCompletedTasks,
    allMemberCallsSettled: !contract.requireAllMemberCallsSettled
      ? true
      : evidence?.a2a?.some((call) => call.mechanicalSettlement?.state === 'unsettled')
        ? false
        : Number.isInteger(metrics.acceptedMemberCalls)
          ? metrics.acceptedMemberCalls === (metrics.settledMemberCalls ?? -1)
          : 'indeterminate',
    allTasksCompleted: !contract.requireAllTasksCompleted
      || ((evidence?.taskFacts?.length ?? 0) >= contract.minCompletedTasks
        && evidence.taskFacts.every((task) => task.status === 'completed')),
    noPolling: !contract.forbidPolling || (evidence?.pollingViolations?.length ?? 1) === 0
  }
  const values = Object.values(checks)
  const passed = values.some((value) => value === false)
    ? false
    : values.some((value) => value === 'indeterminate')
      ? null
      : true
  return {
    applicable: true,
    status: passed === null ? 'indeterminate' : passed ? 'passed' : 'failed',
    passed,
    checks
  }
}

function deriveMechanicalSettlement(input, recipientRun) {
  if (!input) return { state: 'indeterminate', reason: 'durable_input_unavailable' }
  if (['failed', 'cancelled'].includes(input.status)) {
    return { state: 'settled', reason: `input_${input.status}` }
  }
  if (input.status === 'pending') return { state: 'unsettled', reason: 'input_pending' }
  if (input.status !== 'materialized') return { state: 'indeterminate', reason: 'input_state_unknown' }
  if (!recipientRun) return { state: 'indeterminate', reason: 'recipient_run_unavailable' }
  if (['succeeded', 'failed', 'cancelled'].includes(recipientRun.status)) {
    return { state: 'settled', reason: `recipient_run_${recipientRun.status}` }
  }
  return { state: 'unsettled', reason: `recipient_run_${recipientRun.status}` }
}

function derivePollingViolations(evidence) {
  const byRun = new Map()
  for (const item of evidence) {
    if (!item.safeIdentity) continue
    const values = Object.values(item.safeIdentity).filter((value) => typeof value === 'string')
    const record = byRun.get(item.agentRunId) ?? { listTasks: 0, sleep: false }
    if (['completed', 'failed'].includes(item.phase)
        && values.some((value) => value.includes('team.list_tasks') || value.includes('team_list_tasks'))) {
      record.listTasks += 1
    }
    if (values.includes('sleep')) record.sleep = true
    byRun.set(item.agentRunId, record)
  }
  return [...byRun.entries()].flatMap(([agentRunId, record]) => {
    const reasons = []
    if (record.sleep) reasons.push('sleep')
    if (record.listTasks > 1) reasons.push('repeated_list_tasks_in_one_run')
    return reasons.map((reason) => ({ agentRunId, reason }))
  })
}

function findRepeatedRouting(messages) {
  const seen = new Set()
  const repeated = []
  for (const message of messages) {
    const key = `${message.senderAgentId}:${message.recipientAgentId}`
    if (seen.has(key)) {
      repeated.push({
        senderAgentId: message.senderAgentId,
        recipientAgentId: message.recipientAgentId
      })
    }
    seen.add(key)
  }
  return repeated
}

function compareNullableNumber(left, right) {
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right
  if (Number.isFinite(left)) return -1
  if (Number.isFinite(right)) return 1
  return 0
}
