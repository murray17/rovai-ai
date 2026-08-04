import assert from 'node:assert/strict'
import test from 'node:test'
import { digestJson } from './qualification-common.mjs'
import {
  buildToolCallLedger,
  validateToolCallLedger
} from './qualification-tool-ledger.mjs'

test('Tool Call Ledger preserves unknown retry evidence as indeterminate', () => {
  const evidenceIndex = indexFixture()
  const toolEvidence = toolEvidenceFixture({ coverage: 'partial', retryKind: 'indeterminate' })
  const artifact = build(toolEvidence, evidenceIndex)

  assert.equal(artifact.schemaVersion, '1.1.0')
  assert.deepEqual(artifact.payload.records[0].retryRelation, {
    kind: 'indeterminate',
    originalToolCallId: null,
    idempotencyIdentity: null
  })
  assert.deepEqual(artifact.payload.summary, {
    coverage: {
      state: 'partial',
      reason: { code: 'tool_evidence.runtime_telemetry_completeness_unattested' }
    },
    total: null,
    succeeded: null,
    failed: null,
    denied: null,
    retries: null,
    idempotentReplays: null,
    provenDuplicateEffects: null,
    mutationVerification: 'none_observed'
  })
})

test('Tool Call Ledger retains Core authorization, receipt, and idempotent replay identity', () => {
  const evidenceIndex = indexFixture()
  const toolEvidence = toolEvidenceFixture({ coverage: 'complete', retryKind: 'idempotent_replay_observed' })
  const record = toolEvidence.ledger[0]
  record.authorityClass = 'core'
  record.operationClass = 'core_tool'
  record.canonicalTool = 'team.call_member'
  record.authorization = {
    decision: 'allowed',
    authority: 'core',
    evidenceReference: ref(evidenceIndex.artifactId, 'core.execution:ev-1')
  }
  record.receiptId = 'receipt-1'
  record.sideEffectIdentity = 'receipt-1'
  record.duplicateEffect = 'not_proven'
  record.retryRelation = {
    kind: 'idempotent_replay_observed',
    originalToolCallId: 'tool-call:one',
    idempotencyIdentity: `sha256:${'a'.repeat(64)}`
  }
  toolEvidence.summary.authoritativeTotals = {
    logicalToolCalls: 1,
    succeeded: 1,
    failed: 0,
    denied: 0,
    retries: 0,
    idempotentReplays: 1,
    provenDuplicateEffects: 0
  }

  const artifact = build(toolEvidence, evidenceIndex)
  assert.equal(artifact.payload.records[0].retryRelation.kind, 'idempotent_replay')
  assert.equal(artifact.payload.records[0].receiptId, 'receipt-1')
  assert.equal(artifact.payload.records[0].sideEffectIdentity, 'receipt-1')
  assert.deepEqual(artifact.payload.records[0].authorization.evidenceReference, {
    artifactId: evidenceIndex.artifactId,
    evidenceId: 'core.execution:ev-1'
  })
  assert.deepEqual(artifact.payload.summary, {
    coverage: { state: 'complete', reason: null },
    total: 1,
    succeeded: 1,
    failed: 0,
    denied: 0,
    retries: 0,
    idempotentReplays: 1,
    provenDuplicateEffects: 0,
    mutationVerification: 'none_observed'
  })
})

test('Tool Call Ledger omits unresolved records and makes aggregate coverage partial', () => {
  const evidenceIndex = indexFixture()
  const toolEvidence = toolEvidenceFixture({ coverage: 'complete', retryKind: 'original' })
  toolEvidence.ledger[0].evidenceReferences = [
    ref(evidenceIndex.artifactId, 'core.execution:missing')
  ]
  toolEvidence.summary.authoritativeTotals = {
    logicalToolCalls: 1,
    succeeded: 1,
    failed: 0,
    denied: 0,
    retries: 0,
    idempotentReplays: 0,
    provenDuplicateEffects: 0
  }

  const artifact = build(toolEvidence, evidenceIndex)
  assert.equal(artifact.payload.records.length, 0)
  assert.deepEqual(artifact.payload.summary.coverage, {
    state: 'partial',
    reason: { code: 'tool_ledger.evidence_reference_coverage_incomplete' }
  })
  assert.equal(artifact.payload.summary.total, null)
})

test('Tool Call Ledger rejects authority inflation, unsupported duplicate proof, and metric inflation', () => {
  const evidenceIndex = indexFixture()
  const toolEvidence = toolEvidenceFixture({ coverage: 'complete', retryKind: 'original' })
  toolEvidence.summary.authoritativeTotals = {
    logicalToolCalls: 1,
    succeeded: 1,
    failed: 0,
    denied: 0,
    retries: 0,
    idempotentReplays: 0,
    provenDuplicateEffects: 0
  }
  const artifact = build(toolEvidence, evidenceIndex)

  const elevated = structuredClone(artifact)
  elevated.payload.records[0].canonicalTool = 'team.call_member'
  redigest(elevated)
  assert.throws(() => validateToolCallLedger(elevated, evidenceIndex), /elevated a non-Core/)

  const duplicate = structuredClone(artifact)
  duplicate.payload.records[0].duplicateEffect = 'proven_duplicate'
  redigest(duplicate)
  assert.throws(() => validateToolCallLedger(duplicate, evidenceIndex), /no authoritative effect identity/)

  const inflated = structuredClone(artifact)
  inflated.payload.summary.total = 2
  redigest(inflated)
  assert.throws(() => validateToolCallLedger(inflated, evidenceIndex), /complete summary disagrees/)
})

function build(toolEvidence, evidenceIndex) {
  return buildToolCallLedger({
    trialId: 'trial-1',
    evaluationAttemptId: 'attempt-1',
    plannedSlotId: 'slot-1',
    suiteId: 'suite-1',
    caseId: 'CASE-1',
    caseSeal: 'b'.repeat(64),
    producerDigest: 'c'.repeat(64),
    toolEvidence,
    evidenceIndex
  })
}

function toolEvidenceFixture({ coverage, retryKind }) {
  const coverageValue = coverage === 'complete'
    ? { state: 'complete', reason: null }
    : {
        state: 'partial',
        reason: { code: 'tool_evidence.runtime_telemetry_completeness_unattested' }
      }
  return {
    coverage: coverageValue,
    ledger: [{
      toolCallId: 'tool-call:one',
      agentRunId: 'run-1',
      authorityClass: 'runtime',
      operationClass: 'test',
      canonicalTool: null,
      nativeTool: 'commandExecution',
      lifecycle: { state: 'succeeded', error: null },
      authorization: {
        decision: 'indeterminate',
        authority: 'runtime',
        evidenceReference: null
      },
      timing: {
        requestedAt: null,
        startedAt: '2026-08-04T00:00:01.000Z',
        endedAt: '2026-08-04T00:00:02.000Z',
        clockDomain: 'core_persisted_wall_clock',
        latencyMilliseconds: null
      },
      retryRelation: {
        kind: retryKind,
        originalToolCallId: retryKind === 'idempotent_replay_observed' ? 'tool-call:one' : null,
        idempotencyIdentity: retryKind === 'original' ? `sha256:${'a'.repeat(64)}` : null
      },
      receiptId: null,
      sideEffectIdentity: null,
      duplicateEffect: 'not_applicable',
      mutationIntent: 'indeterminate',
      verificationReferences: [],
      directFailureFactReference: null,
      fieldCoverage: Object.fromEntries([
        'identity',
        'lifecycle',
        'authorization',
        'timing',
        'retry',
        'receipt',
        'sideEffect',
        'mutation',
        'verification'
      ].map((field) => [field, coverageValue])),
      evidenceReferences: [ref('evidence-index:index-1', 'core.execution:ev-1')]
    }],
    summary: {
      authoritativeTotals: null,
      mutationVerification: 'none_observed'
    }
  }
}

function indexFixture() {
  return {
    artifactId: 'evidence-index:index-1',
    sourceBoundaries: [
      boundary('core', 'core.agent-run-execution-evidence'),
      boundary('core', 'core.camp-snapshot'),
      boundary('derived', 'derived.qualification-evaluator')
    ],
    payload: {
      records: [
        { evidenceId: 'core.execution:ev-1', sourceId: 'core.agent-run-execution-evidence' }
      ]
    }
  }
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

function ref(artifactId, evidenceId) {
  return { artifactId, evidenceId }
}

function redigest(artifact) {
  artifact.payloadDigest = `sha256:${digestJson(artifact.payload)}`
}
