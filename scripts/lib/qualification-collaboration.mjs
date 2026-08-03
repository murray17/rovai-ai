export function extractEvidenceIdentity(payload) {
  if (!payload || typeof payload !== 'object') return null
  const identity = {}
  for (const key of ['tool', 'toolName', 'canonicalTool', 'title', 'kind', 'status']) {
    if (typeof payload[key] === 'string' && payload[key].length <= 160) identity[key] = payload[key]
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
  const pollingViolations = derivePollingViolations(
    snapshot.executionEvidence.filter((evidence) => runIds.has(evidence.agentRunId))
  )
  const taskFacts = snapshot.tasks.map((task) => ({
    id: task.id,
    status: task.status,
    assigneeAgentId: task.assigneeAgentId,
    sourceAgentRunId: task.sourceAgentRunId
  }))
  return {
    status: 'observed',
    members: [...new Set(runs.map((run) => run.agentProfileId))],
    runGraph: runs.map((run) => ({
      id: run.id,
      agentProfileId: run.agentProfileId,
      status: run.status,
      invocationKind: run.invocationKind,
      parentRunId: run.a2aParentAgentRunId,
      depth: run.a2aDepth,
      startedAt: run.startedAt,
      endedAt: run.endedAt
    })),
    a2a: inbox.map((message) => {
      const input = inputByInboxId.get(message.id) ?? null
      return {
        id: message.id,
        senderAgentId: message.senderAgentId,
        recipientAgentId: message.recipientAgentId,
        sourceAgentRunId: message.sourceAgentRunId,
        targetAgentRunId: message.targetAgentRunId,
        conversationInputId: input?.id ?? null,
        inputSequence: input?.sequence ?? null,
        inputStatus: input?.status ?? null,
        delivered: message.deliveredAt !== null,
        failed: message.failedAt !== null
      }
    }),
    repeatedRouting: findRepeatedRouting(inbox),
    unclosedHandoff: inputs.some((input) => input.status === 'pending')
      || inbox.some((message) => message.deliveredAt === null),
    taskFacts,
    metrics: {
      acceptedMemberCalls: inbox.length,
      completedTasks: taskFacts.filter((task) => task.status === 'completed').length
    },
    pollingViolations,
    semanticAttribution: {
      status: 'indeterminate',
      reason: 'v0.32 has no Judge model and does not infer semantic quality from message counts'
    }
  }
}

export function evaluateCollaborationContract(contract, evidence) {
  if (!contract) return { applicable: false, passed: true, checks: {} }
  const members = new Set(evidence?.members ?? [])
  const metrics = evidence?.metrics ?? {}
  const checks = {
    requiredMembersRan: contract.requiredMemberIds.every((member) => members.has(member)),
    acceptedMemberCalls: (metrics.acceptedMemberCalls ?? 0) >= contract.minAcceptedMemberCalls,
    completedTasks: (metrics.completedTasks ?? 0) >= contract.minCompletedTasks,
    noOpenHandoff: !contract.requireNoOpenHandoff || evidence?.unclosedHandoff === false,
    allTasksCompleted: !contract.requireAllTasksCompleted
      || ((evidence?.taskFacts?.length ?? 0) >= contract.minCompletedTasks
        && evidence.taskFacts.every((task) => task.status === 'completed')),
    noPolling: !contract.forbidPolling || (evidence?.pollingViolations?.length ?? 1) === 0
  }
  return { applicable: true, passed: Object.values(checks).every(Boolean), checks }
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
