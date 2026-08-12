import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveCollaborationEvidence,
  evaluateCollaborationContract,
  extractEvidenceIdentity
} from './qualification-collaboration.mjs'

const contract = {
  requiredMemberIds: ['agent_1', 'agent_2', 'agent_3'],
  minAcceptedMemberCalls: 4,
  minCompletedTasks: 2,
  requireAllMemberCallsSettled: true,
  requireAllTasksCompleted: true,
  forbidPolling: true
}

test('collaboration evidence binds canonical acceptance receipts to durable call lifecycles', () => {
  const evidence = deriveCollaborationEvidence(passingSnapshot(), { campTurnId: 'turn-1' })
  assert.deepEqual(evidence.members.sort(), ['agent_1', 'agent_2', 'agent_3'])
  assert.deepEqual(evidence.metrics, {
    acceptedMemberCalls: 4,
    observedDurableMemberCalls: 4,
    settledMemberCalls: 4,
    observedSettledMemberCalls: 4,
    maximumDepth: 2,
    completedTasks: 2,
    coverage: 'complete_with_canonical_acceptance_receipts'
  })
  assert.equal(evidence.a2a.every((call) => call.mechanicalSettlement.state === 'settled'), true)
  assert.equal(evidence.a2a.every((call) => call.acceptanceReceiptId !== null), true)
  assert.deepEqual(evidence.a2a.map((call) => call.slot), [1, 2, 3, 4])
  assert.equal(evidence.a2a.some((call) => Object.hasOwn(call, 'responseProduced')), false)
  assert.deepEqual(evidence.repeatedRouting, [])
  assert.deepEqual(evidence.pollingViolations, [])
  assert.equal(evaluateCollaborationContract(contract, evidence).status, 'passed')
  assert.equal(evaluateCollaborationContract(contract, evidence).passed, true)
})

test('polling fails the audit while repeated routes remain objective evidence', () => {
  const snapshot = passingSnapshot()
  snapshot.inboxMessages.push({
    id: 'message-5',
    senderAgentId: 'agent_1',
    recipientAgentId: 'agent_2',
    sourceAgentRunId: 'run-lead-resume-1',
    targetAgentRunId: 'run-muwa',
    deliveredAt: '2026-08-02T00:05:00Z',
    failedAt: null
  })
  snapshot.executionEvidence.push(
    executionEvidence('evidence-list-1', 'run-lead', 'completed', { canonicalTool: 'team.list_tasks' }),
    executionEvidence('evidence-list-2', 'run-lead', 'completed', { canonicalTool: 'team.list_tasks' }),
    executionEvidence('evidence-sleep', 'run-lead', 'started', { pollingPrimitive: 'sleep' })
  )
  const evidence = deriveCollaborationEvidence(snapshot, { campTurnId: 'turn-1' })
  const audit = evaluateCollaborationContract(contract, evidence)
  assert.equal(evidence.repeatedRouting.length, 1)
  assert.deepEqual(evidence.pollingViolations, [
    { agentRunId: 'run-lead', reason: 'sleep' },
    { agentRunId: 'run-lead', reason: 'repeated_list_tasks_in_one_run' }
  ])
  assert.equal(audit.checks.noPolling, false)
  assert.equal(audit.passed, false)

  const identity = extractEvidenceIdentity({ item: { command: '/bin/zsh -lc "sleep 5"' } })
  assert.deepEqual(identity, { pollingPrimitive: 'sleep' })
  assert.equal(Object.hasOwn(identity, 'command'), false)
})

test('cases without a collaboration contract remain explicitly not applicable', () => {
  assert.deepEqual(evaluateCollaborationContract(undefined, null), {
    applicable: false,
    status: 'not_applicable',
    passed: true,
    checks: {}
  })
})

test('pending Input remains an unsettled independent Member Call fact', () => {
  const snapshot = passingSnapshot()
  snapshot.inboxMessages[3].deliveredAt = null
  snapshot.conversationInputs[3].status = 'pending'
  const evidence = deriveCollaborationEvidence(snapshot, { campTurnId: 'turn-1' })
  const audit = evaluateCollaborationContract(contract, evidence)
  assert.equal(evidence.a2a[3].mechanicalSettlement.state, 'unsettled')
  assert.equal(audit.checks.allMemberCallsSettled, false)
  assert.equal(audit.passed, false)
})

test('current Public A2A evidence binds one Message Delivery to its message, accepted event, input ACK, and target Run', () => {
  const evidence = deriveCollaborationEvidence(currentPublicA2aSnapshot(), {
    campTurnId: 'turn-current'
  })

  assert.equal(evidence.status, 'observed')
  assert.deepEqual(evidence.members.sort(), ['agent-lead', 'agent-reviewer'])
  assert.deepEqual(evidence.metrics, {
    acceptedMemberCalls: 1,
    observedDurableMemberCalls: 1,
    settledMemberCalls: 1,
    observedSettledMemberCalls: 1,
    maximumDepth: 1,
    completedTasks: 1,
    coverage: 'complete_with_message_delivery_receipts'
  })
  assert.deepEqual(evidence.a2a.map((call) => ({
    callId: call.callId,
    messageId: call.messageId,
    deliveryId: call.deliveryId,
    senderAgentId: call.senderAgentId,
    recipientAgentId: call.recipientAgentId,
    recipientRunId: call.recipientRunId,
    recipientInputEvidenceId: call.recipientInputEvidenceId,
    recipientInputStatus: call.recipientInputStatus,
    settlement: call.mechanicalSettlement.state
  })), [{
    callId: 'delivery-1',
    messageId: 'message-a2a-1',
    deliveryId: 'delivery-1',
    senderAgentId: 'agent-lead',
    recipientAgentId: 'agent-reviewer',
    recipientRunId: 'run-reviewer',
    recipientInputEvidenceId: 'manifest-reviewer',
    recipientInputStatus: 'accepted',
    settlement: 'settled'
  }])
})

test('current Public A2A evidence fails closed when the accepted counter is not covered by Message Deliveries', () => {
  const snapshot = currentPublicA2aSnapshot()
  snapshot.messageDeliveries = []
  const evidence = deriveCollaborationEvidence(snapshot, { campTurnId: 'turn-current' })

  assert.equal(evidence.metrics.acceptedMemberCalls, 1)
  assert.equal(evidence.metrics.observedDurableMemberCalls, 0)
  assert.equal(evidence.metrics.settledMemberCalls, null)
  assert.equal(evidence.metrics.coverage, 'partial_message_delivery_receipt_coverage')
})

test('a settled Message Delivery without its target Run is not counted as mechanically settled', () => {
  const snapshot = currentPublicA2aSnapshot()
  snapshot.messageDeliveries[0].targetAgentRunId = null
  const evidence = deriveCollaborationEvidence(snapshot, {
    campTurnId: 'turn-current',
    rootAgentRunId: 'run-lead'
  })

  assert.equal(evidence.metrics.coverage, 'complete_with_message_delivery_receipts')
  assert.equal(evidence.a2a[0].mechanicalSettlement.state, 'indeterminate')
  assert.equal(
    evidence.a2a[0].mechanicalSettlement.reason,
    'settled_delivery_target_run_unavailable'
  )
  assert.equal(evidence.metrics.settledMemberCalls, 0)
})

function passingSnapshot() {
  return {
    agentRuns: [
      run('run-lead', 'agent_1', 'direct', 0),
      run('run-muwa', 'agent_2', 'a2a', 1),
      run('run-mianzhi', 'agent_3', 'a2a', 1),
      run('run-lead-next-1', 'agent_1', 'a2a', 2),
      run('run-lead-next-2', 'agent_1', 'a2a', 2)
    ],
    inboxMessages: [
      message('message-1', 'agent_1', 'agent_2', 'run-lead', 'run-muwa'),
      message('message-2', 'agent_1', 'agent_3', 'run-lead', 'run-mianzhi'),
      message('message-3', 'agent_2', 'agent_1', 'run-muwa', 'run-lead-next-1'),
      message('message-4', 'agent_3', 'agent_1', 'run-mianzhi', 'run-lead-next-2')
    ],
    conversationInputs: [
      input('input-1', 'message-1'),
      input('input-2', 'message-2'),
      input('input-3', 'message-3'),
      input('input-4', 'message-4')
    ],
    turns: [{ id: 'turn-1', executionBudget: { acceptedA2a: 4 } }],
    timeline: [
      receipt('receipt-1', 'message-1', 1, 1),
      receipt('receipt-2', 'message-2', 2, 1),
      receipt('receipt-3', 'message-3', 3, 2),
      receipt('receipt-4', 'message-4', 4, 2)
    ],
    tasks: [
      { id: 'task-1', status: 'completed', assigneeAgentId: 'agent_2', sourceAgentRunId: 'run-lead' },
      { id: 'task-2', status: 'completed', assigneeAgentId: 'agent_3', sourceAgentRunId: 'run-lead' }
    ],
    executionEvidence: []
  }
}

function currentPublicA2aSnapshot() {
  return {
    schemaVersion: 28,
    agentRuns: [{
      id: 'run-lead',
      campTurnId: 'turn-current',
      agentId: 'agent-lead',
      taskId: null,
      status: 'succeeded',
      invocationKind: 'direct',
      a2aParentAgentRunId: null,
      a2aDepth: 0,
      createdAt: '2026-08-10T00:00:00.000Z',
      startedAt: '2026-08-10T00:00:01.000Z',
      endedAt: '2026-08-10T00:00:10.000Z'
    }, {
      id: 'run-reviewer',
      campTurnId: 'turn-current',
      agentId: 'agent-reviewer',
      taskId: 'task-review',
      status: 'succeeded',
      invocationKind: 'a2a',
      a2aParentAgentRunId: 'run-lead',
      a2aDepth: 1,
      createdAt: '2026-08-10T00:00:03.000Z',
      startedAt: '2026-08-10T00:00:04.000Z',
      endedAt: '2026-08-10T00:00:08.000Z'
    }],
    messages: [{
      id: 'message-a2a-1',
      sequence: 2,
      timelineGlobalSequence: 12,
      authorType: 'agent',
      authorId: 'agent-lead',
      sourceAgentRunId: 'run-lead',
      body: 'Review the concurrency invariant and report concrete defects.',
      addressedAgentIds: ['agent-reviewer'],
      campTurnId: 'turn-current',
      createdAt: '2026-08-10T00:00:02.000Z'
    }],
    messageDeliveries: [{
      id: 'delivery-1',
      messageId: 'message-a2a-1',
      campTurnId: 'turn-current',
      taskId: 'task-review',
      recipientAgentId: 'agent-reviewer',
      recipientCanonicalPosition: 0,
      status: 'settled',
      dispatchPhase: 'terminal',
      waitCondition: null,
      dispatchAttemptCount: 1,
      retryGeneration: 0,
      contextManifestId: 'manifest-reviewer',
      targetAgentRunId: 'run-reviewer',
      failureCode: null,
      createdAt: '2026-08-10T00:00:02.000Z',
      updatedAt: '2026-08-10T00:00:08.000Z',
      endedAt: '2026-08-10T00:00:08.000Z'
    }],
    contextManifests: [{
      id: 'manifest-reviewer',
      agentRunId: 'run-reviewer',
      currentInputSource: {
        type: 'member_call',
        senderAgentId: 'agent-lead',
        senderName: 'Lead'
      },
      delivery: {
        id: 'runtime-input-reviewer',
        status: 'accepted',
        preparedAt: '2026-08-10T00:00:03.000Z',
        acceptedAt: '2026-08-10T00:00:04.000Z',
        resolvedAt: '2026-08-10T00:00:04.000Z'
      },
      createdAt: '2026-08-10T00:00:03.000Z'
    }],
    turns: [{
      id: 'turn-current',
      executionBudget: { acceptedA2a: 1 }
    }],
    timeline: [{
      eventId: 'event-delivery-accepted',
      eventType: 'message_delivery.accepted',
      sourceAgentRunId: 'run-lead',
      createdAt: '2026-08-10T00:00:02.000Z',
      payload: {
        deliveryId: 'delivery-1',
        messageId: 'message-a2a-1',
        campTurnId: 'turn-current',
        recipientAgentId: 'agent-reviewer',
        recipientCanonicalPosition: 0,
        a2aDepth: 1
      }
    }],
    tasks: [{
      id: 'task-review',
      status: 'completed',
      assigneeAgentId: 'agent-reviewer',
      sourceAgentRunId: 'run-lead'
    }],
    executionEvidence: []
  }
}

function run(id, agentId, invocationKind, a2aDepth) {
  return {
    id,
    campTurnId: 'turn-1',
    agentId,
    status: 'succeeded',
    invocationKind,
    a2aParentAgentRunId: null,
    a2aDepth,
    startedAt: '2026-08-02T00:00:00Z',
    endedAt: '2026-08-02T00:01:00Z'
  }
}

function message(id, senderAgentId, recipientAgentId, sourceAgentRunId, targetAgentRunId) {
  return {
    id,
    senderAgentId,
    recipientAgentId,
    sourceAgentRunId,
    targetAgentRunId,
    deliveredAt: '2026-08-02T00:02:00Z',
    failedAt: null
  }
}

function input(id, sourceInboxMessageId) {
  return {
    id,
    campTurnId: 'turn-1',
    status: 'materialized',
    sourceInboxMessageId,
    sequence: Number(id.at(-1))
  }
}

function executionEvidence(id, agentRunId, phase, safeIdentity) {
  return { id, agentRunId, phase, safeIdentity }
}

function receipt(id, inboxMessageId, slot, depth) {
  return {
    eventType: 'member_call.accepted',
    createdAt: `2026-08-02T00:00:0${slot}Z`,
    payload: {
      campTurnId: 'turn-1',
      acceptanceReceiptId: id,
      inboxMessageId,
      slot,
      depth
    }
  }
}
