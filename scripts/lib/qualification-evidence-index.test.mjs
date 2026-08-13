import assert from 'node:assert/strict'
import test from 'node:test'
import { digestJson, sha256 } from './qualification-common.mjs'
import {
  buildEvidenceIndex,
  validateEvidenceIndex
} from './qualification-evidence-index.mjs'

test('Evidence Index creates stable resolvable records across all deterministic evidence authorities', () => {
  const first = buildEvidenceIndex(fixture())
  const second = buildEvidenceIndex(fixture())
  assert.deepEqual(first, second)
  assert.equal(first.artifact.schemaId, 'rovai.qualification.evidence-index')
  assert.equal(first.artifact.schemaVersion, '1.0.0')
  assert.equal(first.artifact.payloadDigest, `sha256:${digestJson(first.artifact.payload)}`)
  assert.equal(first.artifact.producer.digest, `sha256:${'a'.repeat(64)}`)
  assert.deepEqual(first.artifact.binding, {
    suiteId: 'suite-1',
    plannedSlotId: 'slot-1',
    trialId: 'trial-1',
    caseId: 'CASE-1',
    caseSeal: `sha256:${'b'.repeat(64)}`
  })

  const byId = new Map(first.artifact.payload.records.map((record) => [record.evidenceId, record]))
  assert.equal(byId.get('runtime.evidence:evidence-1').authorityClass, 'runtime')
  assert.equal(byId.get('runtime.evidence:evidence-1').safeForJudge, true)
  assert.equal(byId.get('core.message:final-message').evidenceType, 'final_response')
  assert.equal(byId.get('core.message:final-message').safeForPublic, false)
  assert.equal(byId.get('verifier.check:CHK-FUNCTION').safeForPublic, true)
  assert.equal(byId.get('derived.requirement:REQ-FUNCTION').coverage.state, 'complete')
  assert.deepEqual(first.references.executionEvidence['evidence-1'], {
    artifactId: first.artifact.artifactId,
    evidenceId: 'runtime.evidence:evidence-1'
  })
  assert.deepEqual(first.references.humanIntervention, {
    artifactId: first.artifact.artifactId,
    evidenceId: 'derived.human-intervention'
  })
})

test('Evidence Index propagates incomplete source coverage and rejects unresolved derivations', () => {
  const input = fixture()
  input.snapshot.executionEvidence[0].isTruncated = true
  input.executionEvidenceCoverage = {
    coverage: { state: 'partial', reason: { code: 'tool_evidence.sequence_gap' } },
    declaredTotal: null
  }
  const { artifact } = buildEvidenceIndex(input)
  const runtime = artifact.payload.records.find((record) => (
    record.evidenceId === 'runtime.evidence:evidence-1'
  ))
  assert.deepEqual(runtime.coverage, {
    state: 'partial',
    reason: { code: 'evidence_index.runtime_activity_truncated' }
  })

  const tampered = structuredClone(artifact)
  const requirement = tampered.payload.records.find((record) => (
    record.evidenceId === 'derived.requirement:REQ-FUNCTION'
  ))
  requirement.derivedFrom[0].evidenceId = 'missing-evidence'
  tampered.payloadDigest = `sha256:${digestJson(tampered.payload)}`
  assert.throws(() => validateEvidenceIndex(tampered), /unresolved reference/)
})

test('Evidence Index validation prevents a derived record from elevating partial coverage', () => {
  const { artifact } = buildEvidenceIndex(fixture())
  const tampered = structuredClone(artifact)
  const verifier = tampered.payload.records.find((record) => (
    record.evidenceId === 'verifier.check:CHK-FUNCTION'
  ))
  verifier.coverage = {
    state: 'partial',
    reason: { code: 'test.partial_verifier_source' }
  }
  const derived = tampered.payload.records.find((record) => (
    record.evidenceId === 'derived.check:CHK-FUNCTION'
  ))
  assert.equal(derived.coverage.state, 'complete')
  tampered.payloadDigest = `sha256:${digestJson(tampered.payload)}`
  assert.throws(() => validateEvidenceIndex(tampered), /elevated source coverage/)
})

test('Evidence Index exposes only bounded Public A2A content and mechanical delivery facts to the Judge', () => {
  const input = fixture()
  delete input.snapshot.inboxMessages
  delete input.snapshot.conversationInputs
  input.snapshot.schemaVersion = 28
  input.snapshot.agentRuns.push({
    id: 'run-reviewer',
    campTurnId: 'turn-1',
    agentId: 'agent-reviewer',
    status: 'succeeded',
    endedAt: '2026-08-04T00:00:07.000Z'
  })
  input.snapshot.messages.push({
    id: 'a2a-message',
    authorType: 'agent',
    authorId: 'agent-lead',
    sourceAgentRunId: 'run-1',
    sequence: 3,
    createdAt: '2026-08-04T00:00:05.000Z',
    body: 'Review the state transition and report concrete defects.'
  }, {
    id: 'intermediate-lead-message',
    authorType: 'agent',
    authorId: 'agent-lead',
    sourceAgentRunId: 'run-1',
    sequence: 4,
    createdAt: '2026-08-04T00:00:06.000Z',
    body: 'Intermediate progress update that is not the final response.'
  })
  input.finalResponses.push({ messageId: 'intermediate-lead-message', isFinal: false })
  input.snapshot.messageDeliveries = [{
    id: 'delivery-reviewer',
    messageId: 'a2a-message',
    campTurnId: 'turn-1',
    recipientAgentId: 'agent-reviewer',
    status: 'settled',
    contextManifestId: 'manifest-reviewer',
    targetAgentRunId: 'run-reviewer',
    createdAt: '2026-08-04T00:00:05.000Z',
    endedAt: '2026-08-04T00:00:07.000Z'
  }]
  input.snapshot.contextManifests = [{
    id: 'manifest-reviewer',
    agentRunId: 'run-reviewer',
    currentInputSource: { type: 'member_call', senderAgentId: 'agent-lead' },
    delivery: { status: 'accepted' },
    createdAt: '2026-08-04T00:00:05.000Z'
  }]

  const { artifact, references } = buildEvidenceIndex(input)
  const byId = new Map(artifact.payload.records.map((record) => [record.evidenceId, record]))
  const content = byId.get('core.message-content:a2a-message')

  assert.equal(content.safeForJudge, true)
  assert.equal(content.contentDigest, `sha256:${sha256('Review the state transition and report concrete defects.')}`)
  assert.equal(byId.get('core.message-delivery:delivery-reviewer').safeForJudge, true)
  assert.equal(byId.get('core.context-manifest:manifest-reviewer').safeForJudge, false)
  assert.equal(byId.get('core.message-content:root-message').safeForJudge, false)
  assert.equal(byId.get('core.message-content:intermediate-lead-message').safeForJudge, false)
  assert.deepEqual(references.messageContents['a2a-message'], {
    artifactId: artifact.artifactId,
    evidenceId: 'core.message-content:a2a-message'
  })
  assert.deepEqual(references.messageDeliveries['delivery-reviewer'], {
    artifactId: artifact.artifactId,
    evidenceId: 'core.message-delivery:delivery-reviewer'
  })
})

test('Evidence Index separates Judge-safe workspace change facts from exact content identity', () => {
  const input = fixture()
  const body = 'export const value = 42\n'
  input.workspaceDiff = {
    changed: [{
      path: 'src/value.mjs',
      before: null,
      after: {
        path: 'src/value.mjs',
        type: 'file',
        mode: 0o644,
        bytes: Buffer.byteLength(body),
        digest: sha256(body)
      }
    }]
  }
  const { artifact, references } = buildEvidenceIndex(input)
  const byId = new Map(artifact.payload.records.map((record) => [record.evidenceId, record]))
  const changeReference = references.workspaceChanges['src/value.mjs']
  const contentReference = references.workspaceContents['src/value.mjs']

  assert.equal(byId.get(changeReference.evidenceId).safeForJudge, true)
  assert.equal(byId.get(contentReference.evidenceId).safeForJudge, true)
  assert.equal(byId.get(contentReference.evidenceId).contentDigest, `sha256:${sha256(body)}`)
  assert.notEqual(changeReference.evidenceId, contentReference.evidenceId)
})

test('Evidence Index exposes retrieved Camp content only for explicitly bound Tool results', () => {
  const input = fixture()
  input.snapshot.messages.push({
    id: 'retrieved-message',
    authorType: 'user',
    sequence: 3,
    createdAt: '2026-08-04T00:00:03.000Z',
    body: 'The prior decision requires optimistic concurrency.'
  }, {
    id: 'unretrieved-message',
    authorType: 'user',
    sequence: 4,
    createdAt: '2026-08-04T00:00:04.000Z',
    body: 'A private distractor that no Tool result returned.'
  })
  input.toolRetrievedMessageIds = ['retrieved-message']
  const { artifact, references } = buildEvidenceIndex(input)
  const records = new Map(artifact.payload.records.map((record) => [record.evidenceId, record]))

  assert.equal(records.get('core.message-content:retrieved-message').safeForJudge, true)
  assert.equal(records.get('core.message-content:unretrieved-message').safeForJudge, false)
  assert.deepEqual(references.messageContents['retrieved-message'], {
    artifactId: artifact.artifactId,
    evidenceId: 'core.message-content:retrieved-message'
  })
  assert.equal(references.messageContents['unretrieved-message'], undefined)
})

function fixture() {
  const snapshot = {
    schemaVersion: 19,
    throughGlobalSequence: 20,
    turns: [{ id: 'turn-1', status: 'completed', endedAt: '2026-08-04T00:00:10.000Z' }],
    agentRuns: [{
      id: 'run-1',
      campTurnId: 'turn-1',
      status: 'succeeded',
      endedAt: '2026-08-04T00:00:09.000Z'
    }],
    tasks: [{
      id: 'task-1',
      sourceAgentRunId: 'run-1',
      status: 'completed',
      completedAt: '2026-08-04T00:00:08.000Z'
    }],
    messages: [{
      id: 'root-message',
      authorType: 'user',
      sequence: 1,
      createdAt: '2026-08-04T00:00:01.000Z',
      body: 'task'
    }, {
      id: 'final-message',
      authorType: 'agent',
      sourceAgentRunId: 'run-1',
      sequence: 2,
      createdAt: '2026-08-04T00:00:08.000Z',
      body: 'done'
    }],
    inboxMessages: [],
    conversationInputs: [],
    approvals: [],
    actions: [],
    executionEvidence: [{
      id: 'evidence-1',
      agentRunId: 'run-1',
      sequence: 1,
      occurredAt: '2026-08-04T00:00:04.000Z',
      isTruncated: false,
      payload: { sourceAuthority: 'runtime', toolCallId: 'tool-1' }
    }],
    timeline: [{
      eventId: 'event-1',
      globalSequence: 20,
      createdAt: '2026-08-04T00:00:10.000Z',
      eventType: 'camp_turn.completed',
      payload: { campTurnId: 'turn-1' }
    }]
  }
  const deliveryCheck = {
    checkId: 'CHK-FUNCTION',
    kind: 'hard',
    observationAuthority: 'verifier',
    runnerCheck: null,
    categoryId: 'functional',
    requirementIds: ['REQ-FUNCTION'],
    disclosure: 'public',
    prerequisiteCheckIds: [],
    status: 'passed',
    evidence: [{ code: 'verifier.pass', summary: 'passed' }]
  }
  return {
    trialId: 'trial-1',
    evaluationAttemptId: 'attempt-1',
    plannedSlotId: 'slot-1',
    suiteId: 'suite-1',
    caseId: 'CASE-1',
    caseSeal: 'b'.repeat(64),
    producerDigest: 'a'.repeat(64),
    snapshot,
    dispatchBoundary: {
      campTurnId: 'turn-1',
      rootAgentRunId: 'run-1',
      rootCampMessageId: 'root-message',
      preDispatchThroughGlobalSequence: 10,
      runnerObservedAcceptedAt: '2026-08-04T00:00:01.000Z'
    },
    environmentManifest: {
      schemaVersion: 1,
      collectedAt: '2026-08-04T00:00:00.000Z'
    },
    observationDigest: 'c'.repeat(64),
    observationIntegrityIssues: [],
    executionEvidenceCoverage: {
      coverage: { state: 'complete', reason: null },
      declaredTotal: 1
    },
    verifierObservation: {
      validationState: 'valid',
      validationErrors: [],
      checkResults: [deliveryCheck]
    },
    deliveredWorkspaceSnapshot: { digest: 'd'.repeat(64) },
    workspaceDiff: { changed: [] },
    deliveryEvidence: {
      checkResults: [deliveryCheck],
      requirements: [{
        requirementId: 'REQ-FUNCTION',
        criticality: 'critical',
        categoryId: 'functional',
        statement: 'works',
        status: 'passed',
        checkIds: ['CHK-FUNCTION']
      }]
    },
    convergence: {
      status: 'pass',
      facts: { runTree: 'settled', externalEffects: 'settled' }
    },
    humanIntervention: {
      status: 'absent',
      evidence: [],
      coverage: 'formal_isolation_complete',
      reason: null
    },
    termination: { converged: true, lingeringChildPids: [] },
    isolationProfile: { status: 'admitted', formalAdmissible: true },
    isolationContinuity: { state: 'complete', reason: null },
    finalResponses: [{ messageId: 'final-message', isFinal: true }]
  }
}
