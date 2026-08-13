import assert from 'node:assert/strict'
import test from 'node:test'
import { digestJson } from './qualification-common.mjs'
import {
  buildToolInteractionMeasurement,
  buildToolUseJudgePack
} from './tool-interaction-measurement/index.mjs'
import {
  attachToolUseReview,
  buildToolUseJudgeConfiguration,
  executeToolUseReview,
  validateToolUseReviewArtifacts
} from './qualification-tool-use-judge.mjs'

const PRODUCER_DIGEST = 'a'.repeat(64)

test('Tool-Use Judge executes counterbalanced replicas over modelInput only and preserves Hard Outcome', async () => {
  const { measurement, pack } = fixture()
  const downstreamCoverage = pack.payload.modelInput.opportunities[0].checklistCoverage.find(
    (item) => item.checklistItem === 'SER.tool_use.downstream_use'
  )
  assert.deepEqual(downstreamCoverage.coverage, {
    state: 'partial',
    reason: { code: 'downstream_candidate_has_no_causal_attribution' }
  })
  const observed = []
  const configuration = configurationFixture()
  const execution = await executeToolUseReview({
    configuration,
    measurement,
    pack,
    producerDigest: PRODUCER_DIGEST,
    judgeExecutionId: 'tool-use-execution-1',
    invokeReplica(input) {
      observed.push(input)
      assert.equal(Object.hasOwn(input, 'evidencePack'), false)
      assert.equal(Object.hasOwn(input.modelInput, 'evidenceMap'), false)
      assert.equal(JSON.stringify(input.modelInput).includes('oracle'), false)
      return { items: validItems(input.modelInput, input.presentationOrder) }
    },
    now: deterministicNow()
  })

  assert.equal(observed.length, 2)
  assert.deepEqual(observed[1].presentationOrder, [...observed[0].presentationOrder].reverse())
  assert.equal(execution.review.payload.state, 'complete')
  assert.ok(execution.review.payload.items.every((item) => item.state === 'agreed'))
  assert.equal(execution.review.payload.items.find((item) => (
    item.checklistItem === 'SER.tool_use.downstream_use'
  )).verdict, 'partially_satisfied')
  assert.equal(validateToolUseReviewArtifacts({
    configuration,
    measurement,
    pack,
    replicas: execution.replicas,
    review: execution.review
  }), true)

  const trial = {
    validity: 'valid',
    evaluationState: 'complete',
    dispatchAccepted: true,
    verifiedDelivery: 'pass',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent',
    overall: 'pass',
    hardOutcome: 'pass',
    hardLayer: { overall: 'pass' },
    toolMeasurement: { semanticReview: { status: 'unavailable' } }
  }
  const attached = attachToolUseReview(trial, {
    artifactId: execution.review.artifactId,
    payloadDigest: execution.review.payloadDigest,
    status: execution.review.payload.state
  })
  assert.equal(attached.overall, 'pass')
  assert.equal(attached.toolMeasurement.semanticReview.status, 'complete')
})

test('candidate delivery semantics cannot be promoted to proven downstream absorption', async () => {
  const { measurement, pack } = fixture()
  const execution = await executeToolUseReview({
    configuration: configurationFixture(),
    measurement,
    pack,
    producerDigest: PRODUCER_DIGEST,
    judgeExecutionId: 'tool-use-execution-candidate-causality',
    invokeReplica(input) {
      const items = validItems(input.modelInput, input.presentationOrder)
      const downstream = items.find((item) => item.checklistItem === 'SER.tool_use.downstream_use')
      downstream.verdict = 'satisfied'
      downstream.reason = 'This incorrectly claims causal absorption.'
      return { items }
    },
    now: deterministicNow()
  })
  assert.equal(execution.replicas.every((replica) => replica.payload.state === 'unavailable'), true)
  assert.equal(execution.review.payload.state, 'unavailable')
})

test('Tool-Use Judge preserves categorical disagreement and never votes or averages', async () => {
  const { measurement, pack } = fixture()
  const configuration = configurationFixture()
  const execution = await executeToolUseReview({
    configuration,
    measurement,
    pack,
    producerDigest: PRODUCER_DIGEST,
    judgeExecutionId: 'tool-use-execution-disagreement',
    invokeReplica(input) {
      const items = validItems(input.modelInput, input.presentationOrder)
      if (input.replica === 'B') {
        const target = items.find((item) => (
          item.checklistItem === 'SER.tool_use.selection_necessity'
        ))
        target.verdict = 'not_satisfied'
        target.reason = 'The second frozen replica found the retrieval unnecessary.'
      }
      return { items }
    },
    now: deterministicNow()
  })

  assert.equal(execution.review.payload.state, 'disagreement')
  const disagreement = execution.review.payload.items.find((item) => (
    item.checklistItem === 'SER.tool_use.selection_necessity'
  ))
  assert.equal(disagreement.state, 'disagreed')
  assert.equal(disagreement.verdict, null)
  assert.equal(JSON.stringify(execution.review).includes('aggregateScore'), false)
})

test('invalid structured output is not selectively retried and makes the review unavailable', async () => {
  const { measurement, pack } = fixture()
  const configuration = configurationFixture()
  let invocationCount = 0
  const execution = await executeToolUseReview({
    configuration,
    measurement,
    pack,
    producerDigest: PRODUCER_DIGEST,
    judgeExecutionId: 'tool-use-execution-invalid',
    invokeReplica(input) {
      invocationCount += 1
      const items = validItems(input.modelInput, input.presentationOrder)
      if (input.replica === 'A') items[0].score = 1
      return { items }
    },
    now: deterministicNow()
  })

  assert.equal(invocationCount, 2)
  assert.equal(execution.replicas[0].payload.state, 'unavailable')
  assert.equal(execution.replicas[0].payload.attempts.length, 1)
  assert.equal(execution.review.payload.state, 'unavailable')
  assert.deepEqual(execution.review.payload.items, [])
})

test('Tool-Use Judge rejects treatment canaries before invoking the model', async () => {
  const { measurement, pack } = fixture({ title: 'PAIR_ARM_CANARY' })
  let invoked = false
  await assert.rejects(executeToolUseReview({
    configuration: configurationFixture(),
    measurement,
    pack,
    producerDigest: PRODUCER_DIGEST,
    judgeExecutionId: 'tool-use-execution-canary',
    treatmentCanaries: ['PAIR_ARM_CANARY'],
    invokeReplica() {
      invoked = true
      return { items: [] }
    }
  }), /canary contamination/)
  assert.equal(invoked, false)
})

test('Tool-Use Review replay recomputes Replica reconciliation', async () => {
  const { measurement, pack } = fixture()
  const configuration = configurationFixture()
  const execution = await executeToolUseReview({
    configuration,
    measurement,
    pack,
    producerDigest: PRODUCER_DIGEST,
    judgeExecutionId: 'tool-use-execution-replay',
    invokeReplica(input) {
      return { items: validItems(input.modelInput, input.presentationOrder) }
    },
    now: deterministicNow()
  })
  const tampered = structuredClone(execution.review)
  tampered.payload.items[0].verdict = 'not_satisfied'
  tampered.payloadDigest = `sha256:${digestJson(tampered.payload)}`
  tampered.sourceBoundaries[0].digest = `sha256:${digestJson({
    binding: tampered.binding,
    sourceId: tampered.sourceBoundaries[0].sourceId,
    payload: tampered.payload
  })}`
  assert.throws(() => validateToolUseReviewArtifacts({
    configuration,
    measurement,
    pack,
    replicas: execution.replicas,
    review: tampered
  }), /exact deterministic Replica reconciliation/)
})

function fixture({ title = 'Use prior context when it is necessary' } = {}) {
  const inputDigest = `sha256:${'b'.repeat(64)}`
  const resultDigest = `sha256:${'c'.repeat(64)}`
  const projectionWithoutDigest = {
    schemaVersion: 1,
    operation: 'camp.read',
    canonicalInput: { mode: 'item', messageId: 'message-context' },
    canonicalResult: {
      items: [{ messageId: 'message-context', sequence: 4, bodyTruncated: false }],
      itemCount: 1,
      itemsTruncated: false,
      hasMore: false
    },
    digestBinding: {
      input: { evidenceField: 'rawInputDigest', digest: inputDigest },
      result: { evidenceField: 'rawOutputDigest', digest: resultDigest }
    },
    inputDigest,
    resultDigest
  }
  const measurement = buildToolInteractionMeasurement({
    caseId: 'case-tool-use-judge',
    trialId: 'trial-tool-use-judge',
    producerDigest: PRODUCER_DIGEST,
    measurementSpec: {
      specificationId: 'tool-use-judge-fixture',
      opportunities: [{
        opportunityId: 'OP-CONTEXT',
        adapter: 'camp_history',
        mode: 'natural_use',
        semanticItems: [
          'SER.tool_use.selection_necessity',
          'SER.tool_use.input_strategy',
          'SER.tool_use.result_interpretation',
          'SER.tool_use.downstream_use'
        ],
        oracle: { requiredMessageIds: ['message-context'] }
      }]
    },
    toolEvidence: {
      coverage: { state: 'complete', reason: null },
      interactions: [{
        sourceAuthority: 'core',
        toolCallId: 'tool-read-context',
        canonicalTool: 'camp.read',
        lifecycle: { state: 'succeeded' },
        authorization: { decision: 'allowed' },
        operationProjection: {
          ...projectionWithoutDigest,
          projectionDigest: `sha256:${digestJson(projectionWithoutDigest)}`
        },
        evidenceReference: { artifactId: 'evidence-index-fixture', evidenceId: 'tool-read' }
      }]
    },
    effectEvidence: [{
      effectId: 'retrieved-context',
      kind: 'retrieved_content',
      content: 'The accepted design requires optimistic concurrency.',
      relatedResultIdentities: ['message-context'],
      evidenceReference: { artifactId: 'evidence-index-fixture', evidenceId: 'message-context' }
    }, {
      effectId: 'delivered-context',
      kind: 'final_response',
      content: 'Implemented optimistic concurrency and covered stale revisions.',
      relatedToolCallIds: ['tool-read-context'],
      evidenceReference: { artifactId: 'evidence-index-fixture', evidenceId: 'final-response' }
    }]
  })
  const pack = buildToolUseJudgePack({
    measurement,
    disclosedTask: { title, requirements: ['Apply the prior design decision correctly.'] },
    producerDigest: PRODUCER_DIGEST
  })
  return { measurement, pack }
}

function configurationFixture() {
  return buildToolUseJudgeConfiguration({
    provider: 'fixture-provider',
    snapshotId: 'fixture-model-snapshot',
    snapshotDigest: 'd'.repeat(64),
    producerDigest: PRODUCER_DIGEST
  })
}

function validItems(modelInput, presentationOrder) {
  return modelInput.opportunities.flatMap((opportunity) => {
    const coverage = new Map(opportunity.checklistCoverage.map((item) => [
      item.checklistItem, item
    ]))
    return presentationOrder.map((checklistItem) => {
      const item = coverage.get(checklistItem)
      if (item.coverage.state === 'not_applicable') {
        return {
          opportunityId: opportunity.opportunityId,
          checklistItem,
          verdict: 'not_applicable',
          confidence: 'high',
          evidenceIds: [],
          reason: 'This item was not pre-registered for the opportunity.',
          abstainReason: { code: 'tool_use.not_applicable' }
        }
      }
      if (item.coverage.state === 'unavailable') {
        return {
          opportunityId: opportunity.opportunityId,
          checklistItem,
          verdict: 'indeterminate',
          confidence: 'low',
          evidenceIds: [...item.evidenceIds],
          reason: 'The required evidence is unavailable.',
          abstainReason: { code: 'tool_use.evidence_unavailable' }
        }
      }
      if (item.coverage.state === 'partial') {
        return {
          opportunityId: opportunity.opportunityId,
          checklistItem,
          verdict: 'partially_satisfied',
          confidence: 'low',
          evidenceIds: [...item.evidenceIds].sort(),
          reason: 'The delivery is semantically consistent, but causal absorption is not proven.',
          abstainReason: null
        }
      }
      return {
        opportunityId: opportunity.opportunityId,
        checklistItem,
        verdict: 'satisfied',
        confidence: 'medium',
        evidenceIds: [...item.evidenceIds].sort(),
        reason: 'The bounded evidence supports the semantic criterion.',
        abstainReason: null
      }
    })
  })
}

function deterministicNow() {
  let tick = 0
  return () => `2026-08-13T00:00:${String(tick++).padStart(2, '0')}.000Z`
}
