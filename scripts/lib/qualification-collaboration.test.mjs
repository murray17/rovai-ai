import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveCollaborationEvidence,
  evaluateCollaborationContract,
  extractEvidenceIdentity
} from './qualification-collaboration.mjs'

const contract = {
  requiredMemberIds: ['agent-luoke', 'agent-muwa', 'agent-mianzhi'],
  requiredExplicitReturnMemberIds: ['agent-muwa', 'agent-mianzhi'],
  minAcceptedMemberCalls: 4,
  minExplicitReturns: 2,
  maxCoreOutcomes: 0,
  minCompletedTasks: 2,
  requireNoOpenHandoff: true,
  requireNoRepeatedRouting: true,
  requireAllTasksCompleted: true,
  forbidPolling: true
}

test('collaboration audit requires real calls, explicit returns, and completed tasks', () => {
  const evidence = deriveCollaborationEvidence(passingSnapshot(), { campTurnId: 'turn-1' })
  assert.deepEqual(evidence.members.sort(), ['agent-luoke', 'agent-mianzhi', 'agent-muwa'])
  assert.deepEqual(evidence.metrics, {
    acceptedMemberCalls: 4,
    explicitReturns: 2,
    coreOutcomes: 0,
    completedTasks: 2
  })
  assert.deepEqual(evidence.explicitReturnMemberIds.sort(), ['agent-mianzhi', 'agent-muwa'])
  assert.equal(evidence.unclosedHandoff, false)
  assert.deepEqual(evidence.repeatedRouting, [])
  assert.deepEqual(evidence.pollingViolations, [])
  assert.equal(evaluateCollaborationContract(contract, evidence).passed, true)
})

test('polling and repeated routes fail the collaboration audit without exposing commands', () => {
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
  assert.equal(audit.checks.noRepeatedRouting, false)
  assert.equal(audit.checks.noPolling, false)
  assert.equal(audit.passed, false)

  const identity = extractEvidenceIdentity({ item: { command: '/bin/zsh -lc "sleep 5"' } })
  assert.deepEqual(identity, { pollingPrimitive: 'sleep' })
  assert.equal(Object.hasOwn(identity, 'command'), false)
})

test('cases without a collaboration contract remain explicitly not applicable', () => {
  assert.deepEqual(evaluateCollaborationContract(undefined, null), {
    applicable: false,
    passed: true,
    checks: {}
  })
})

test('required explicit return members cannot be replaced by another member or a Core Outcome', () => {
  const snapshot = passingSnapshot()
  snapshot.returnObligations[1].status = 'satisfied_by_core_outcome'
  snapshot.returnObligations[1].satisfyingConversationInputId = 'outcome-input'
  snapshot.inboxMessages.splice(3, 1)
  snapshot.conversationInputs.splice(3, 1)
  const evidence = deriveCollaborationEvidence(snapshot, { campTurnId: 'turn-1' })
  const audit = evaluateCollaborationContract({
    ...contract,
    minAcceptedMemberCalls: 3,
    minExplicitReturns: 1,
    maxCoreOutcomes: 1
  }, evidence)
  assert.deepEqual(evidence.explicitReturnMemberIds, ['agent-muwa'])
  assert.equal(audit.checks.requiredMembersReturned, false)
  assert.equal(audit.passed, false)
})

function passingSnapshot() {
  return {
    agentRuns: [
      run('run-lead', 'agent-luoke', 'direct'),
      run('run-muwa', 'agent-muwa', 'a2a'),
      run('run-mianzhi', 'agent-mianzhi', 'a2a'),
      run('run-lead-resume-1', 'agent-luoke', 'a2a'),
      run('run-lead-resume-2', 'agent-luoke', 'a2a')
    ],
    inboxMessages: [
      message('message-1', 'agent-luoke', 'agent-muwa', 'run-lead', 'run-muwa'),
      message('message-2', 'agent-luoke', 'agent-mianzhi', 'run-lead', 'run-mianzhi'),
      message('message-3', 'agent-muwa', 'agent-luoke', 'run-muwa', 'run-lead-resume-1'),
      message('message-4', 'agent-mianzhi', 'agent-luoke', 'run-mianzhi', 'run-lead-resume-2')
    ],
    conversationInputs: [
      input('input-1', 'message-1', 'obligation-1'),
      input('input-2', 'message-2', 'obligation-2'),
      input('input-3', 'message-3', null),
      input('input-4', 'message-4', null)
    ],
    returnObligations: [
      obligation('obligation-1', 'input-3', 'agent-muwa'),
      obligation('obligation-2', 'input-4', 'agent-mianzhi')
    ],
    tasks: [
      { id: 'task-1', status: 'completed', assigneeAgentId: 'agent-muwa', sourceAgentRunId: 'run-lead' },
      { id: 'task-2', status: 'completed', assigneeAgentId: 'agent-mianzhi', sourceAgentRunId: 'run-lead' }
    ],
    executionEvidence: []
  }
}

function run(id, agentProfileId, invocationKind) {
  return {
    id,
    campTurnId: 'turn-1',
    agentProfileId,
    status: 'succeeded',
    invocationKind,
    a2aParentAgentRunId: null,
    a2aDepth: invocationKind === 'direct' ? 0 : 1,
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

function input(id, sourceInboxMessageId, returnObligationId) {
  return {
    id,
    campTurnId: 'turn-1',
    kind: 'member_call',
    status: 'materialized',
    sourceInboxMessageId,
    returnObligationId,
    sequence: Number(id.at(-1))
  }
}

function obligation(id, satisfyingConversationInputId, calleeAgentId) {
  return {
    id,
    campTurnId: 'turn-1',
    calleeAgentId,
    status: 'satisfied_by_member_call',
    satisfyingConversationInputId
  }
}

function executionEvidence(id, agentRunId, phase, safeIdentity) {
  return { id, agentRunId, phase, safeIdentity }
}
