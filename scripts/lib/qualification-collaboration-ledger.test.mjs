import assert from 'node:assert/strict'
import test from 'node:test'
import { digestJson } from './qualification-common.mjs'
import {
  buildCollaborationLedger,
  validateCollaborationLedger
} from './qualification-collaboration-ledger.mjs'

test('Collaboration Ledger models independent forward Calls without return or response obligations', () => {
  const evidenceIndex = indexFixture()
  const evidenceReferences = referenceFixture(evidenceIndex.artifactId)
  const artifact = buildCollaborationLedger({
    trialId: 'trial-1',
    evaluationAttemptId: 'attempt-1',
    plannedSlotId: 'slot-1',
    suiteId: 'suite-1',
    caseId: 'CASE-1',
    caseSeal: 'b'.repeat(64),
    producerDigest: 'a'.repeat(64),
    collaborationEvidence: collaborationFixture(),
    evidenceIndex,
    evidenceReferences
  })

  assert.equal(artifact.payloadDigest, `sha256:${digestJson(artifact.payload)}`)
  assert.equal(artifact.payload.calls.length, 3)
  assert.deepEqual(artifact.payload.calls.map((call) => call.mechanicalSettlement.state), [
    'settled',
    'settled',
    'settled'
  ])
  assert.equal(artifact.payload.calls[0].recipientRun.state, 'succeeded')
  assert.equal(artifact.payload.calls[1].recipientRun.state, 'failed')
  assert.deepEqual(artifact.payload.metrics, {
    coverage: { state: 'complete', reason: null },
    acceptedCalls: 3,
    settledCalls: 3,
    maximumDepth: 3
  })
  assert.deepEqual(artifact.payload.routeFacts.map((fact) => fact.kind).sort(), [
    'exact_duplicate_acceptance',
    'forward_cycle',
    'repeated_route'
  ])
  const serialized = JSON.stringify(artifact)
  for (const forbidden of [
    'returnPolicy',
    'returnObligation',
    'callOutcome',
    'responseProduced',
    'sourceReceived',
    'responseClosure',
    'sourceResume',
    'conversationInputKind'
  ]) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

test('Collaboration Ledger stays partial when canonical acceptance or durable Input evidence is missing', () => {
  const evidenceIndex = indexFixture()
  const collaborationEvidence = collaborationFixture()
  collaborationEvidence.a2a[0].acceptanceReceiptId = null
  const artifact = buildCollaborationLedger({
    trialId: 'trial-1',
    plannedSlotId: 'slot-1',
    caseId: 'CASE-1',
    caseSeal: 'b'.repeat(64),
    producerDigest: 'a'.repeat(64),
    collaborationEvidence,
    evidenceIndex,
    evidenceReferences: referenceFixture(evidenceIndex.artifactId)
  })
  assert.equal(artifact.payload.calls.length, 2)
  assert.deepEqual(artifact.payload.metrics.coverage, {
    state: 'partial',
    reason: { code: 'collaboration_ledger.canonical_call_coverage_incomplete' }
  })
  assert.equal(artifact.payload.metrics.acceptedCalls, 3)
  assert.equal(artifact.payload.metrics.settledCalls, null)
})

test('Collaboration Ledger rejects unresolved Evidence References and metric inflation', () => {
  const evidenceIndex = indexFixture()
  const artifact = buildCollaborationLedger({
    trialId: 'trial-1',
    plannedSlotId: 'slot-1',
    caseId: 'CASE-1',
    caseSeal: 'b'.repeat(64),
    producerDigest: 'a'.repeat(64),
    collaborationEvidence: collaborationFixture(),
    evidenceIndex,
    evidenceReferences: referenceFixture(evidenceIndex.artifactId)
  })
  const unresolved = structuredClone(artifact)
  unresolved.payload.calls[0].evidenceReferences[0].evidenceId = 'missing'
  unresolved.payloadDigest = `sha256:${digestJson(unresolved.payload)}`
  assert.throws(
    () => validateCollaborationLedger(unresolved, evidenceIndex),
    /unresolved Evidence Reference/
  )

  const inflated = structuredClone(artifact)
  inflated.payload.metrics.acceptedCalls = 4
  inflated.payloadDigest = `sha256:${digestJson(inflated.payload)}`
  assert.throws(
    () => validateCollaborationLedger(inflated, evidenceIndex),
    /complete metrics disagree/
  )
})

test('Collaboration Ledger adapts current Public Message Delivery evidence without inventing response semantics', () => {
  const evidenceIndex = indexFixture()
  evidenceIndex.payload.records.push(
    record('core.message-content:message-1', 'core.camp-snapshot'),
    record('core.message-delivery:delivery-1', 'core.camp-snapshot'),
    record('core.context-manifest:manifest-1', 'core.camp-snapshot'),
    record('core.run:run-current', 'core.camp-snapshot'),
    record('core.event:delivery-event-1', 'core.event-stream')
  )
  const evidenceReferences = referenceFixture(evidenceIndex.artifactId)
  evidenceReferences.messageContents = {
    'message-1': ref(evidenceIndex.artifactId, 'core.message-content:message-1')
  }
  evidenceReferences.messageDeliveries = {
    'delivery-1': ref(evidenceIndex.artifactId, 'core.message-delivery:delivery-1')
  }
  evidenceReferences.contextManifests = {
    'manifest-1': ref(evidenceIndex.artifactId, 'core.context-manifest:manifest-1')
  }
  evidenceReferences.agentRuns['run-current'] = ref(
    evidenceIndex.artifactId,
    'core.run:run-current'
  )
  evidenceReferences.events['delivery-event-1'] = ref(
    evidenceIndex.artifactId,
    'core.event:delivery-event-1'
  )
  const collaborationEvidence = {
    a2a: [{
      callId: 'delivery-1',
      deliveryId: 'delivery-1',
      deliveryStatus: 'settled',
      messageId: 'message-1',
      acceptanceReceiptId: 'delivery-event-1',
      acceptanceEventId: 'delivery-event-1',
      acceptedAt: '2026-08-04T00:00:01.000Z',
      inboxMessageId: null,
      slot: 1,
      depth: 1,
      senderAgentId: 'agent-lead',
      recipientAgentId: 'agent-reviewer',
      contentDigest: 'message-content-digest',
      sourceAgentRunId: 'run-lead',
      recipientRunId: 'run-current',
      taskId: null,
      conversationInputId: 'manifest-1',
      recipientInputEvidenceId: 'manifest-1',
      recipientInputStatus: 'accepted',
      inputPersistedAt: '2026-08-04T00:00:01.100Z',
      inputTerminalAt: '2026-08-04T00:00:02.000Z',
      inputTerminalReason: null,
      recipientRunStatus: 'succeeded',
      recipientRunMaterializedAt: '2026-08-04T00:00:01.200Z',
      recipientRunStartedAt: '2026-08-04T00:00:01.300Z',
      recipientRunTerminalAt: '2026-08-04T00:00:02.000Z',
      recipientRunReason: null,
      mechanicalSettlement: { state: 'settled', reason: 'delivery_settled' }
    }],
    metrics: {
      acceptedMemberCalls: 1,
      maximumDepth: 1,
      coverage: 'complete_with_message_delivery_receipts'
    }
  }

  const artifact = buildCollaborationLedger({
    trialId: 'trial-current',
    plannedSlotId: 'slot-current',
    caseId: 'CASE-CURRENT',
    caseSeal: 'b'.repeat(64),
    producerDigest: 'a'.repeat(64),
    collaborationEvidence,
    evidenceIndex,
    evidenceReferences
  })

  assert.equal(artifact.payload.calls.length, 1)
  assert.equal(artifact.payload.calls[0].contentEvidenceReference.evidenceId, 'core.message-content:message-1')
  assert.equal(artifact.payload.calls[0].input.inputId, 'manifest-1')
  assert.equal(artifact.payload.calls[0].input.state, 'materialized')
  assert.equal(artifact.payload.metrics.coverage.state, 'complete')
  assert.equal(JSON.stringify(artifact).includes('responseProduced'), false)
})

function collaborationFixture() {
  return {
    a2a: [
      call('call-1', 'receipt-1', 'event-1', 'input-1', 'run-1', 'agent-a', 'agent-b', 1, 1, 'succeeded'),
      call('call-2', 'receipt-2', 'event-2', 'input-2', 'run-2', 'agent-b', 'agent-a', 2, 2, 'failed'),
      call('call-3', 'receipt-3', 'event-3', 'input-3', 'run-3', 'agent-a', 'agent-b', 3, 3, 'succeeded')
    ],
    metrics: {
      acceptedMemberCalls: 3,
      settledMemberCalls: 3,
      maximumDepth: 3,
      coverage: 'complete_with_canonical_acceptance_receipts'
    }
  }
}

function call(
  callId,
  acceptanceReceiptId,
  acceptanceEventId,
  conversationInputId,
  recipientRunId,
  senderAgentId,
  recipientAgentId,
  slot,
  depth,
  recipientRunStatus
) {
  const second = String(slot).padStart(2, '0')
  return {
    callId,
    acceptanceReceiptId,
    acceptanceEventId,
    acceptanceReceiptCoverage: 'complete',
    acceptedAt: `2026-08-04T00:00:${second}.000Z`,
    inboxMessageId: callId,
    slot,
    senderAgentId,
    recipientAgentId,
    contentDigest: senderAgentId === 'agent-a' ? 'same-content' : 'reverse-content',
    sourceAgentRunId: `source-${callId}`,
    recipientRunId,
    taskId: null,
    depth,
    conversationInputId,
    inputSequence: slot,
    inputStatus: 'materialized',
    inputPersistedAt: `2026-08-04T00:00:${second}.100Z`,
    inputMaterializedAt: `2026-08-04T00:00:${second}.200Z`,
    inputTerminalAt: `2026-08-04T00:00:${second}.900Z`,
    inputTerminalReason: null,
    recipientRunStatus,
    recipientRunMaterializedAt: `2026-08-04T00:00:${second}.200Z`,
    recipientRunStartedAt: `2026-08-04T00:00:${second}.300Z`,
    recipientRunTerminalAt: `2026-08-04T00:00:${second}.800Z`,
    recipientRunReason: null,
    mechanicalSettlement: {
      state: 'settled',
      reason: `recipient_run_${recipientRunStatus}`
    }
  }
}

function indexFixture() {
  const sourceBoundaries = [
    boundary('core', 'core.camp-snapshot'),
    boundary('core', 'core.event-stream'),
    boundary('derived', 'derived.qualification-evaluator')
  ]
  const records = []
  for (const index of [1, 2, 3]) {
    records.push(
      record(`core.inbox:call-${index}`, 'core.camp-snapshot'),
      record(`core.input:input-${index}`, 'core.camp-snapshot'),
      record(`core.run:run-${index}`, 'core.camp-snapshot'),
      record(`core.event:event-${index}`, 'core.event-stream')
    )
  }
  return {
    artifactId: 'evidence-index:index-1',
    sourceBoundaries,
    payload: { records }
  }
}

function referenceFixture(artifactId) {
  const values = {
    inboxMessages: {},
    conversationInputs: {},
    agentRuns: {},
    events: {}
  }
  for (const index of [1, 2, 3]) {
    values.inboxMessages[`call-${index}`] = ref(artifactId, `core.inbox:call-${index}`)
    values.conversationInputs[`input-${index}`] = ref(artifactId, `core.input:input-${index}`)
    values.agentRuns[`run-${index}`] = ref(artifactId, `core.run:run-${index}`)
    values.events[`event-${index}`] = ref(artifactId, `core.event:event-${index}`)
  }
  return values
}

function boundary(authorityClass, sourceId) {
  return {
    authorityClass,
    sourceId,
    digest: `sha256:${'d'.repeat(64)}`,
    throughSequence: null,
    declaredTotal: null,
    clockDomain: null,
    coverage: { state: 'complete', reason: null }
  }
}

function record(evidenceId, sourceId) {
  return { evidenceId, sourceId }
}

function ref(artifactId, evidenceId) {
  return { artifactId, evidenceId }
}
