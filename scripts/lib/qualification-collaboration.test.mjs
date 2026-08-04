import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveCollaborationEvidence,
  evaluateCollaborationContract,
  extractEvidenceIdentity
} from './qualification-collaboration.mjs'

const contract = {
  requiredMemberIds: ['agent-luoke', 'agent-muwa', 'agent-mianzhi'],
  minAcceptedMemberCalls: 4,
  minCompletedTasks: 2,
  requireAllMemberCallsSettled: true,
  requireAllTasksCompleted: true,
  forbidPolling: true
}

test('collaboration evidence binds canonical acceptance receipts to durable call lifecycles', () => {
  const evidence = deriveCollaborationEvidence(passingSnapshot(), { campTurnId: 'turn-1' })
  assert.deepEqual(evidence.members.sort(), ['agent-luoke', 'agent-mianzhi', 'agent-muwa'])
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
    senderAgentId: 'agent-luoke',
    recipientAgentId: 'agent-muwa',
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

function passingSnapshot() {
  return {
    agentRuns: [
      run('run-lead', 'agent-luoke', 'direct', 0),
      run('run-muwa', 'agent-muwa', 'a2a', 1),
      run('run-mianzhi', 'agent-mianzhi', 'a2a', 1),
      run('run-lead-next-1', 'agent-luoke', 'a2a', 2),
      run('run-lead-next-2', 'agent-luoke', 'a2a', 2)
    ],
    inboxMessages: [
      message('message-1', 'agent-luoke', 'agent-muwa', 'run-lead', 'run-muwa'),
      message('message-2', 'agent-luoke', 'agent-mianzhi', 'run-lead', 'run-mianzhi'),
      message('message-3', 'agent-muwa', 'agent-luoke', 'run-muwa', 'run-lead-next-1'),
      message('message-4', 'agent-mianzhi', 'agent-luoke', 'run-mianzhi', 'run-lead-next-2')
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
      { id: 'task-1', status: 'completed', assigneeAgentId: 'agent-muwa', sourceAgentRunId: 'run-lead' },
      { id: 'task-2', status: 'completed', assigneeAgentId: 'agent-mianzhi', sourceAgentRunId: 'run-lead' }
    ],
    executionEvidence: []
  }
}

function run(id, agentProfileId, invocationKind, a2aDepth) {
  return {
    id,
    campTurnId: 'turn-1',
    agentProfileId,
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
