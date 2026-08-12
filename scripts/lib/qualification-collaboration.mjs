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
  if (isCurrentPublicA2aSnapshot(snapshot)) {
    return deriveCurrentPublicA2aEvidence(snapshot, dispatchBoundary)
  }
  return deriveLegacyCollaborationEvidence(snapshot, dispatchBoundary)
}

function deriveCurrentPublicA2aEvidence(snapshot, dispatchBoundary) {
  const runs = Array.isArray(snapshot.agentRuns)
    ? snapshot.agentRuns.filter((run) => run.campTurnId === dispatchBoundary.campTurnId)
    : []
  const runIds = new Set(runs.map((run) => run.id))
  const runById = new Map(runs.map((run) => [run.id, run]))
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : []
  const messageById = new Map(messages.map((message) => [message.id, message]))
  const manifests = new Map((Array.isArray(snapshot.contextManifests)
    ? snapshot.contextManifests
    : []).filter((manifest) => runIds.has(manifest.agentRunId)).map((manifest) => [manifest.id, manifest]))
  const deliveriesAvailable = Array.isArray(snapshot.messageDeliveries)
  const deliveries = deliveriesAvailable
    ? snapshot.messageDeliveries.filter((delivery) => delivery.campTurnId === dispatchBoundary.campTurnId)
    : []
  const receiptEvents = (Array.isArray(snapshot.timeline) ? snapshot.timeline : []).filter((event) => (
    event.eventType === 'message_delivery.accepted'
      && event.payload?.campTurnId === dispatchBoundary.campTurnId
  ))
  const receiptByDeliveryId = new Map(receiptEvents.flatMap((event) => (
    event.payload?.deliveryId ? [[event.payload.deliveryId, event]] : []
  )))
  const taskFacts = (Array.isArray(snapshot.tasks) ? snapshot.tasks : []).map((task) => ({
    id: task.id,
    status: task.status,
    assigneeAgentId: task.assigneeAgentId,
    sourceAgentRunId: task.sourceAgentRunId
  }))
  const calls = deliveries.map((delivery, index) => {
    const message = messageById.get(delivery.messageId) ?? null
    const receipt = receiptByDeliveryId.get(delivery.id) ?? null
    const recipientRunId = delivery.targetAgentRunId ?? null
    const recipientRun = recipientRunId ? runById.get(recipientRunId) ?? null : null
    const manifest = delivery.contextManifestId ? manifests.get(delivery.contextManifestId) ?? null : null
    const runtimeInputDelivery = manifest?.delivery ?? null
    const depth = receipt?.payload?.a2aDepth ?? recipientRun?.a2aDepth ?? null
    return {
      callId: delivery.id,
      deliveryId: delivery.id,
      deliveryStatus: delivery.status ?? null,
      messageId: delivery.messageId ?? null,
      acceptanceReceiptId: receipt?.eventId ?? null,
      acceptanceEventId: receipt?.eventId ?? null,
      acceptanceReceiptCoverage: message && receipt ? 'complete' : 'unavailable',
      acceptedAt: receipt?.createdAt ?? delivery.createdAt ?? null,
      inboxMessageId: null,
      slot: Number.isSafeInteger(receipt?.payload?.recipientCanonicalPosition)
        ? receipt.payload.recipientCanonicalPosition + 1
        : Number.isSafeInteger(delivery.recipientCanonicalPosition)
          ? delivery.recipientCanonicalPosition + 1
          : null,
      observedOrder: index + 1,
      senderAgentId: message?.authorId ?? message?.senderAgentId ?? null,
      recipientAgentId: delivery.recipientAgentId ?? null,
      contentDigest: typeof message?.body === 'string' ? sha256(message.body) : null,
      sourceAgentRunId: message?.sourceAgentRunId ?? delivery.sourceAgentRunId ?? null,
      recipientRunId,
      taskId: delivery.taskId ?? recipientRun?.taskId ?? null,
      depth,
      conversationInputId: manifest?.id ?? null,
      recipientInputEvidenceId: manifest?.id ?? null,
      inputSequence: message?.sequence ?? null,
      inputStatus: runtimeInputDelivery?.status ?? null,
      recipientInputStatus: runtimeInputDelivery?.status ?? null,
      inputPersistedAt: delivery.createdAt ?? null,
      inputMaterializedAt: manifest?.createdAt ?? recipientRun?.createdAt ?? null,
      inputTerminalAt: runtimeInputDelivery?.resolvedAt ?? delivery.endedAt ?? null,
      inputTerminalReason: runtimeInputDelivery?.lastError ?? delivery.failureCode ?? null,
      recipientRunStatus: recipientRun?.status ?? 'not_materialized',
      recipientRunMaterializedAt: recipientRun?.createdAt ?? null,
      recipientRunStartedAt: recipientRun?.startedAt ?? null,
      recipientRunTerminalAt: recipientRun?.endedAt ?? null,
      recipientRunReason: recipientRun?.waitReason ?? null,
      delivered: ['running', 'settled', 'failed', 'cancelled'].includes(delivery.status),
      failed: ['failed', 'cancelled', 'interrupted_before_dispatch'].includes(delivery.status),
      messageVisibility: 'public_to_camp',
      mechanicalSettlement: deriveCurrentMechanicalSettlement(delivery, recipientRun)
    }
  })
  const turn = (Array.isArray(snapshot.turns) ? snapshot.turns : [])
    .find((candidate) => candidate.id === dispatchBoundary.campTurnId)
  const authoritativeAcceptedA2a = turn?.executionBudget?.acceptedA2a
  const acceptanceCoverageComplete = deliveriesAvailable
    && Number.isInteger(authoritativeAcceptedA2a)
    && authoritativeAcceptedA2a === deliveries.length
    && receiptEvents.length === deliveries.length
    && calls.every((call) => (
      call.acceptanceReceiptId !== null
      && call.messageId !== null
      && call.senderAgentId !== null
      && call.recipientAgentId !== null
      && Number.isSafeInteger(call.slot)
      && call.slot >= 1
      && Number.isSafeInteger(call.depth)
      && call.depth >= 1
    ))
  const observedSettledMemberCalls = calls.filter(
    (call) => call.mechanicalSettlement.state === 'settled'
  ).length
  const pollingViolations = derivePollingViolations(
    (Array.isArray(snapshot.executionEvidence) ? snapshot.executionEvidence : [])
      .filter((evidence) => runIds.has(evidence.agentRunId))
  )
  return {
    status: 'observed',
    sourceSurface: 'public_message_delivery_v1',
    members: [...new Set(runs.map((run) => run.agentId).filter(Boolean))],
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
    repeatedRouting: findRepeatedRoutingCalls(calls),
    taskFacts,
    metrics: {
      acceptedMemberCalls: Number.isInteger(authoritativeAcceptedA2a)
        ? authoritativeAcceptedA2a
        : null,
      observedDurableMemberCalls: deliveries.length,
      settledMemberCalls: acceptanceCoverageComplete ? observedSettledMemberCalls : null,
      observedSettledMemberCalls,
      maximumDepth: Math.max(0, ...runs.map((run) => run.a2aDepth ?? 0)),
      completedTasks: taskFacts.filter((task) => task.status === 'completed').length,
      coverage: acceptanceCoverageComplete
        ? 'complete_with_message_delivery_receipts'
        : 'partial_message_delivery_receipt_coverage'
    },
    pollingViolations,
    semanticAttribution: {
      status: 'indeterminate',
      reason: 'Semantic necessity, feedback absorption, and integration quality require the independent Judge layer.'
    }
  }
}

function deriveLegacyCollaborationEvidence(snapshot, dispatchBoundary) {
  const runs = snapshot.agentRuns.filter((run) => run.campTurnId === dispatchBoundary.campTurnId)
  const runIds = new Set(runs.map((run) => run.id))
  const inbox = (Array.isArray(snapshot.inboxMessages) ? snapshot.inboxMessages : []).filter((message) => (
    runs.some((run) => run.id === message.sourceAgentRunId || run.id === message.targetAgentRunId)
  ))
  const inputs = (Array.isArray(snapshot.conversationInputs) ? snapshot.conversationInputs : []).filter((input) => (
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
    sourceSurface: 'legacy_inbox_conversation_input',
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

function isCurrentPublicA2aSnapshot(snapshot) {
  return Number.isInteger(snapshot?.schemaVersion) && snapshot.schemaVersion >= 28
}

function deriveCurrentMechanicalSettlement(delivery, recipientRun) {
  if (!delivery || typeof delivery.status !== 'string') {
    return { state: 'indeterminate', reason: 'message_delivery_status_unavailable' }
  }
  if (['pending', 'running'].includes(delivery.status)) {
    return { state: 'unsettled', reason: `message_delivery_${delivery.status}` }
  }
  if (['settled', 'failed', 'cancelled', 'interrupted_before_dispatch'].includes(delivery.status)) {
    if (delivery.status === 'settled') {
      if (!recipientRun) {
        return { state: 'indeterminate', reason: 'settled_delivery_target_run_unavailable' }
      }
      if (!['succeeded', 'failed', 'cancelled'].includes(recipientRun.status)) {
        return { state: 'indeterminate', reason: 'settled_delivery_target_run_nonterminal' }
      }
    }
    return { state: 'settled', reason: `message_delivery_${delivery.status}` }
  }
  return { state: 'indeterminate', reason: `message_delivery_${delivery.status}` }
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

function findRepeatedRoutingCalls(calls) {
  const seen = new Set()
  const repeated = []
  for (const call of calls) {
    const key = `${call.senderAgentId}:${call.recipientAgentId}`
    if (seen.has(key)) {
      repeated.push({
        senderAgentId: call.senderAgentId,
        recipientAgentId: call.recipientAgentId
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
