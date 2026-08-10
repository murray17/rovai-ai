import assert from 'node:assert/strict'
import test from 'node:test'
import { digestJson } from './qualification-common.mjs'
import {
  buildPublicBenchmarkReport,
  validatePublicBenchmarkReport
} from './qualification-public-report.mjs'

test('Public Benchmark Report builds five allowlisted layers without private locators or member identities', () => {
  const evidenceIndex = indexFixture()
  const artifact = buildPublicBenchmarkReport({
    result: passingResult(evidenceIndex),
    caseTitle: 'Public fixture',
    producerDigest: 'a'.repeat(64),
    evidenceIndex,
    collaborationLedger: collaborationLedgerFixture(evidenceIndex),
    toolCallLedger: toolLedgerFixture(evidenceIndex),
    workspaceMutationLedger: mutationLedgerFixture(evidenceIndex)
  })

  assert.equal(artifact.payloadDigest, `sha256:${digestJson(artifact.payload)}`)
  assert.deepEqual(artifact.payload.layer1HardOutcome, {
    validity: 'valid',
    evaluationState: 'complete',
    verifiedDelivery: 'pass',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent',
    overall: 'pass'
  })
  assert.deepEqual(artifact.payload.layer3Collaboration.runGraph, {
    nodes: 2,
    edges: 1,
    maximumDepth: 1
  })
  assert.deepEqual(artifact.payload.layer3Collaboration.roleActivations, [
    { memberPseudonym: 'member-001', declaredRole: null, runCount: 1 },
    { memberPseudonym: 'member-002', declaredRole: null, runCount: 1 }
  ])
  assert.equal(artifact.payload.layer4ToolAndMutation.toolCalls, null)
  assert.equal(artifact.payload.layer4ToolAndMutation.mutationVerification, 'partial')
  assert.deepEqual(artifact.payload.layer5SemanticReview, { state: 'unavailable', items: [] })

  const publicBytes = JSON.stringify(artifact)
  for (const privateValue of [
    'private/index.json',
    'private/collaboration.json',
    'private/tool.json',
    'private/mutation.json',
    'agent-a',
    'agent-b',
    'SECRET-CANARY'
  ]) {
    assert.equal(publicBytes.includes(privateValue), false)
  }
})

test('Public Benchmark Report rejects Hard Outcome drift, unresolved references, and forbidden export fields', () => {
  const evidenceIndex = indexFixture()
  const artifact = buildPublicBenchmarkReport({
    result: passingResult(evidenceIndex),
    caseTitle: 'Public fixture',
    producerDigest: 'a'.repeat(64),
    evidenceIndex,
    collaborationLedger: collaborationLedgerFixture(evidenceIndex),
    toolCallLedger: toolLedgerFixture(evidenceIndex),
    workspaceMutationLedger: mutationLedgerFixture(evidenceIndex)
  })

  const hardDrift = structuredClone(artifact)
  hardDrift.payload.layer1HardOutcome.verifiedDelivery = 'fail'
  redigest(hardDrift)
  assert.throws(() => validatePublicBenchmarkReport(hardDrift, evidenceIndex), /Hard Pass formula/)

  const unresolved = structuredClone(artifact)
  unresolved.payload.layer2Delivery.finalResponseEvidence[0].evidenceId = 'missing'
  redigest(unresolved)
  assert.throws(() => validatePublicBenchmarkReport(unresolved, evidenceIndex), /unresolved Evidence Reference/)

  const forbidden = structuredClone(artifact)
  forbidden.payload.command = 'SECRET-CANARY'
  redigest(forbidden)
  assert.throws(() => validatePublicBenchmarkReport(forbidden, evidenceIndex), /forbidden field command/)
})

test('Public Benchmark Report preserves a valid pending outcome with one failed and one unavailable axis', () => {
  const evidenceIndex = indexFixture()
  const result = passingResult(evidenceIndex)
  result.evaluationState = 'pending'
  result.verifiedDelivery = 'fail'
  result.orchestrationConvergence = 'unavailable'
  result.postDispatchHumanIntervention = 'indeterminate'
  result.overall = 'unavailable'
  const artifact = buildPublicBenchmarkReport({
    result,
    producerDigest: 'a'.repeat(64),
    evidenceIndex,
    collaborationLedger: collaborationLedgerFixture(evidenceIndex),
    toolCallLedger: toolLedgerFixture(evidenceIndex),
    workspaceMutationLedger: mutationLedgerFixture(evidenceIndex)
  })
  assert.equal(artifact.payload.layer1HardOutcome.evaluationState, 'pending')
  assert.equal(artifact.payload.layer1HardOutcome.verifiedDelivery, 'fail')
  assert.equal(artifact.payload.layer1HardOutcome.overall, 'unavailable')
})

test('Invalid preflight produces diagnostic unavailable layers without fabricating evidence', () => {
  const result = {
    schemaVersion: 2,
    runnerVersion: '0.34.0',
    trialId: 'trial-invalid',
    plannedSlotId: 'slot-invalid',
    mode: 'formal',
    completedAt: '2026-08-04T00:00:00.000Z',
    case: null,
    validity: 'invalid',
    evaluationState: 'pending',
    verifiedDelivery: 'unavailable',
    orchestrationConvergence: 'unavailable',
    postDispatchHumanIntervention: 'indeterminate',
    overall: 'unavailable',
    resultRevision: {
      revisionId: 'revision-invalid',
      recordedAt: '2026-08-04T00:00:00.000Z'
    },
    semanticEngineeringReview: { status: 'unavailable' }
  }
  const artifact = buildPublicBenchmarkReport({
    result,
    producerDigest: 'a'.repeat(64)
  })

  assert.equal(artifact.payload.reportClass, 'formal')
  assert.equal(artifact.payload.layer2Delivery.coverage.state, 'unavailable')
  assert.equal(artifact.payload.layer3Collaboration.coverage.state, 'unavailable')
  assert.equal(artifact.payload.layer4ToolAndMutation.coverage.state, 'unavailable')
  assert.deepEqual(artifact.payload.layer2Delivery.finalResponseEvidence, [])
})

function passingResult(evidenceIndex) {
  const artifactPointer = (name, version = '1.0.0') => ({
    artifactId: `${name}:public-id`,
    schemaId: `rovai.qualification.${name}`,
    schemaVersion: version,
    payloadDigest: `sha256:${'b'.repeat(64)}`,
    locator: `private/${name}.json`
  })
  return {
    schemaVersion: 2,
    runnerVersion: '0.34.0',
    trialId: 'trial-1',
    suiteId: 'suite-1',
    plannedSlotId: 'slot-1',
    mode: 'demo',
    case: { id: 'CASE-1', version: '1.0.0', seal: 'c'.repeat(64) },
    completedAt: '2026-08-04T00:00:00.000Z',
    validity: 'valid',
    evaluationState: 'complete',
    verifiedDelivery: 'pass',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent',
    overall: 'pass',
    deliveryLayer: {
      requirements: [{ requirementId: 'REQ-1', criticality: 'critical', status: 'passed' }],
      categories: [{ categoryId: 'functional', status: 'passed' }],
      primaryFailureStage: null,
      failureFacts: [],
      workspaceChangeSummary: { created: 0, modified: 1, deleted: 0, renamed: 0 },
      finalResponseEvidence: [{
        body: 'SECRET-CANARY',
        evidenceReference: ref(evidenceIndex.artifactId, 'core.message:final')
      }]
    },
    collaborationEvidence: {
      runGraph: [
        { id: 'run-1', agentProfileId: 'agent-a' },
        { id: 'run-2', agentProfileId: 'agent-b' }
      ]
    },
    toolEvidence: {
      summary: {
        latencyCoverage: {
          state: 'partial',
          reason: { code: 'tool_evidence.non_monotonic_timing_only' }
        },
        directToolFailureCausality: 'not_applicable'
      }
    },
    semanticEngineeringReview: { status: 'unavailable' },
    resultRevision: {
      revisionId: 'revision-1',
      recordedAt: '2026-08-04T00:00:00.000Z'
    },
    evidenceIndex: { ...artifactPointer('evidence-index'), artifactId: evidenceIndex.artifactId },
    collaborationLedger: artifactPointer('collaboration-ledger'),
    toolCallLedger: artifactPointer('tool-call-ledger', '1.1.0'),
    workspaceMutationLedger: artifactPointer('workspace-mutation-ledger')
  }
}

function collaborationLedgerFixture(evidenceIndex) {
  return {
    payload: {
      metrics: {
        coverage: { state: 'complete', reason: null },
        acceptedCalls: 1,
        settledCalls: 1,
        maximumDepth: 1
      },
      calls: [{ mechanicalSettlement: { state: 'settled' } }],
      routeFacts: []
    },
    evidenceIndex
  }
}

function toolLedgerFixture() {
  return {
    payload: {
      summary: {
        coverage: { state: 'partial', reason: { code: 'tool_evidence.partial' } },
        total: null,
        succeeded: null,
        failed: null,
        denied: null,
        retries: null,
        idempotentReplays: null,
        provenDuplicateEffects: null
      }
    }
  }
}

function mutationLedgerFixture(evidenceIndex) {
  return {
    payload: {
      coverage: { state: 'partial', reason: { code: 'workspace_mutation_ledger.net_diff_only' } },
      records: [{
        verificationRelations: [{
          state: 'verified',
          evidenceReference: ref(evidenceIndex.artifactId, 'runner.workspace-change:one')
        }]
      }],
      overlapFacts: []
    }
  }
}

function indexFixture() {
  return {
    artifactId: 'evidence-index:index-1',
    payload: {
      records: [
        { evidenceId: 'core.message:final' },
        { evidenceId: 'runner.workspace-change:one' }
      ]
    }
  }
}

function ref(artifactId, evidenceId) {
  return { artifactId, evidenceId }
}

function redigest(artifact) {
  artifact.payloadDigest = `sha256:${digestJson(artifact.payload)}`
}
