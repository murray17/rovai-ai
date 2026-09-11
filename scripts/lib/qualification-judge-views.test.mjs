import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { digestJson } from './qualification-common.mjs'
import { redactQualificationResult } from './qualification-evaluation.mjs'
import {
  LEGACY_SEMANTIC_CHECKLIST,
  OUTCOME_JUDGE_CHECKLIST,
  OUTCOME_JUDGE_SYSTEM_PROMPT,
  PROCESS_JUDGE_CHECKLIST,
  PROCESS_JUDGE_SYSTEM_PROMPT,
  attachSemanticJudgeViewSuite,
  buildJudgeViewConfiguration,
  buildJudgeViewPack,
  buildSemanticJudgeViewSuite,
  executeJudgeView,
  retainSemanticJudgeViewArtifacts,
  semanticJudgeViewSuiteResultReference,
  validateJudgeViewPack,
  validateJudgeViewReview,
  validateSemanticJudgeViewSuite
} from './qualification-judge-views.mjs'
import { canonicalHardOutcome } from './qualification-semantic-judge.mjs'
import { invokeReplica as invokeFixtureReplica } from '../../qualification/demo/semantic-judge-fixture-adapter.mjs'

test('Process and blinded Outcome Packs expose disjoint evidence views', () => {
  const fixture = dualViewFixture()
  const processInput = fixture.process.pack.payload.modelInput
  const outcomeInput = fixture.outcome.pack.payload.modelInput

  assert.deepEqual(processInput.checklistCoverage.map((item) => item.checklistItem), [
    ...PROCESS_JUDGE_CHECKLIST
  ])
  assert.deepEqual(outcomeInput.checklistCoverage.map((item) => item.checklistItem), [
    ...OUTCOME_JUDGE_CHECKLIST
  ])
  assert.equal(processInput.members.length, 2)
  assert.equal(processInput.interactions.length, 1)
  assert.equal(processInput.evidenceSegments.some((segment) => (
    segment.kind === 'participant_message'
  )), true)
  assert.equal(processInput.checklistCoverage.find((item) => (
    item.checklistItem === 'SER.collaboration.contribution_value'
  )).coverage.state, 'partial')

  const outcomeSerialized = JSON.stringify(outcomeInput)
  for (const forbidden of [
    'members',
    'interactions',
    'participant_message',
    'declaredRole',
    'trial-fixture',
    'agent-lead',
    'call-1',
    'evidence-index:fixture'
  ]) {
    assert.equal(outcomeSerialized.includes(forbidden), false, forbidden)
  }
  assert.deepEqual([...new Set(outcomeInput.evidenceSegments.map((segment) => segment.kind))], [
    'code',
    'final_response'
  ])
  assert.equal(JSON.stringify(fixture.outcome.pack.payload.evidenceMap).includes(
    'evidence-index:fixture'
  ), true)
})

test('Process Pack preserves reply and Task linkage without claiming contribution causality', () => {
  const fixture = dualViewFixture({ buildPacks: false })
  const source = structuredClone(fixture.sourcePack)
  const reference = structuredClone(source.payload.collaborationFacts[0].evidenceReferences[0])
  source.payload.untrustedEvidence.push({
    segmentId: 'segment-reply',
    kind: 'participant_message',
    authorPseudonym: 'member-002',
    visibility: 'public_to_camp',
    content: 'The boundary check fails when the revision is stale; add an exact-version test.',
    evidenceReference: reference
  })
  const common = {
    callId: 'call-2',
    senderPseudonym: 'member-002',
    recipientPseudonym: 'member-001',
    visibility: 'public_to_camp',
    evidenceReferences: [reference]
  }
  source.payload.collaborationFacts.push(
    ...['accepted_call', 'recipient_input', 'recipient_run', 'public_camp_message'].map((factType) => ({
      factId: `collaboration-fact:call-2:${factType}`,
      factType,
      contentSegmentId: 'segment-reply',
      ...common
    })),
    {
      factId: 'collaboration-fact:call-2:reply',
      factType: 'later_independent_call',
      contentSegmentId: 'segment-call',
      ...common
    },
    {
      factId: 'collaboration-fact:call-2:task',
      factType: 'task_fact',
      contentSegmentId: 'segment-reply',
      ...common
    }
  )
  source.payloadDigest = `sha256:${digestJson(source.payload)}`

  const pack = buildJudgeViewPack({
    view: 'process',
    sourcePack: source,
    configuration: fixture.process.configuration,
    producerDigest: 'a'.repeat(64)
  })
  const reply = pack.payload.modelInput.interactions.find((interaction) => (
    interaction.observations.replyObserved
  ))
  assert.ok(reply)
  assert.equal(reply.replyToMessageSegmentId !== null, true)
  assert.equal(reply.observations.taskLinked, true)
  assert.equal(pack.payload.modelInput.checklistCoverage.find((item) => (
    item.checklistItem === 'SER.collaboration.contribution_value'
  )).coverage.state, 'partial')
})

test('Outcome model input identity is invariant to treatment, Trial, member, Call, and actual Evidence IDs', () => {
  const fixture = dualViewFixture({ buildPacks: false })
  const sourceB = structuredClone(fixture.sourcePack)
  sourceB.binding = {
    trialId: 'solo-trial-with-different-identity',
    suiteId: 'counterfactual-suite',
    plannedSlotId: 'solo-arm'
  }
  sourceB.artifactId = 'judge-evidence-pack:solo-arm'
  sourceB.payload.members = [{
    pseudonym: 'member-999',
    declaredRole: 'Solo'
  }]
  for (const fact of sourceB.payload.collaborationFacts) {
    fact.callId = 'different-call-id'
    fact.senderPseudonym = 'member-999'
    fact.recipientPseudonym = 'member-999'
  }
  replaceEvidenceIdentity(sourceB, 'evidence-index:solo-fixture')
  sourceB.payloadDigest = `sha256:${digestJson(sourceB.payload)}`

  const packA = buildJudgeViewPack({
    view: 'outcome',
    sourcePack: fixture.sourcePack,
    configuration: fixture.outcome.configuration,
    producerDigest: 'a'.repeat(64)
  })
  const packB = buildJudgeViewPack({
    view: 'outcome',
    sourcePack: sourceB,
    configuration: fixture.outcome.configuration,
    producerDigest: 'a'.repeat(64)
  })

  assert.equal(packA.payload.modelInputDigest, packB.payload.modelInputDigest)
  assert.deepEqual(packA.payload.modelInput, packB.payload.modelInput)
  assert.notDeepEqual(packA.payload.evidenceMap, packB.payload.evidenceMap)
  assert.notEqual(packA.artifactId, packB.artifactId)
})

test('Outcome Pack rejects pre-registered treatment contamination in exact delivery content', () => {
  const fixture = dualViewFixture({ buildPacks: false })
  const configuration = buildJudgeViewConfiguration({
    view: 'outcome',
    provider: 'fixture-provider',
    snapshotId: 'fixture-model-2026-08-11',
    snapshotDigest: 'b'.repeat(64),
    producerDigest: 'a'.repeat(64),
    outcomeTreatmentCanaries: ['ARM_TEAM_7F3A']
  })
  const sourcePack = structuredClone(fixture.sourcePack)
  sourcePack.payload.untrustedEvidence.find((segment) => (
    segment.kind === 'final_response'
  )).content += ' ARM_TEAM_7F3A'
  sourcePack.payloadDigest = `sha256:${digestJson(sourcePack.payload)}`

  assert.throws(() => buildJudgeViewPack({
    view: 'outcome',
    sourcePack,
    configuration,
    producerDigest: 'a'.repeat(64)
  }), /contaminated by a treatment canary/)
})

test('each Judge gets two counterbalanced replicas and the adapter receives model input only', async () => {
  const fixture = dualViewFixture()
  const requests = []
  const invokeReplica = async (request) => {
    requests.push(request)
    const pack = request.judgeView === 'process'
      ? fixture.process.pack
      : fixture.outcome.pack
    return { items: replicaItems(pack) }
  }
  const processExecution = await executeJudgeView({
    ...fixture.process,
    producerDigest: 'a'.repeat(64),
    invokeReplica
  })
  const outcomeExecution = await executeJudgeView({
    ...fixture.outcome,
    producerDigest: 'a'.repeat(64),
    invokeReplica
  })

  assert.equal(requests.length, 4)
  assert.deepEqual(requests.map((request) => request.judgeView), [
    'process', 'process', 'outcome', 'outcome'
  ])
  assert.deepEqual(requests[0].presentationOrder, PROCESS_JUDGE_CHECKLIST)
  assert.deepEqual(requests[1].presentationOrder, [...PROCESS_JUDGE_CHECKLIST].reverse())
  assert.deepEqual(requests[2].presentationOrder, OUTCOME_JUDGE_CHECKLIST)
  assert.deepEqual(requests[3].presentationOrder, [...OUTCOME_JUDGE_CHECKLIST].reverse())
  assert.equal(requests[0].systemPrompt, PROCESS_JUDGE_SYSTEM_PROMPT)
  assert.equal(requests[2].systemPrompt, OUTCOME_JUDGE_SYSTEM_PROMPT)
  assert.equal(requests.every((request) => (
    request.evidencePack.view === request.judgeView
      && !Object.hasOwn(request.evidencePack, 'binding')
      && !Object.hasOwn(request.evidencePack, 'evidenceMap')
      && !Object.hasOwn(request.evidencePack, 'configurationArtifact')
  )), true)
  assert.equal(JSON.stringify(requests[2].evidencePack).includes('participant_message'), false)
  assert.equal(processExecution.review.payload.state, 'complete')
  assert.equal(outcomeExecution.review.payload.state, 'complete')
})

test('repository protocol fixture adapter implements both Judge View request shapes', async () => {
  const fixture = dualViewFixture()
  const process = await executeJudgeView({
    ...fixture.process,
    producerDigest: 'a'.repeat(64),
    invokeReplica: invokeFixtureReplica
  })
  const outcome = await executeJudgeView({
    ...fixture.outcome,
    producerDigest: 'a'.repeat(64),
    invokeReplica: invokeFixtureReplica
  })

  assert.equal(process.review.payload.state, 'complete')
  assert.equal(process.review.payload.items.find((item) => (
    item.checklistItem === 'SER.collaboration.contribution_value'
  )).verdict, 'indeterminate')
  assert.equal(outcome.review.payload.state, 'complete')
  assert.equal(outcome.review.payload.items.every((item) => item.verdict === 'satisfied'), true)
})

test('dual-view Suite preserves the full views and a legacy-compatible no-score projection', async () => {
  const fixture = dualViewFixture()
  const processExecution = await successfulExecution(fixture.process)
  const outcomeExecution = await successfulExecution(fixture.outcome)
  const suite = buildSemanticJudgeViewSuite({
    process: { ...fixture.process, ...processExecution },
    outcome: { ...fixture.outcome, ...outcomeExecution },
    producerDigest: 'a'.repeat(64)
  })

  assert.equal(suite.payload.state, 'complete')
  assert.deepEqual(suite.payload.views.map((view) => view.view), ['process', 'outcome'])
  assert.equal(suite.payload.views.find((view) => view.view === 'process').items.some((item) => (
    item.checklistItem === 'SER.collaboration.contribution_value'
  )), true)
  assert.deepEqual(suite.payload.compatibilityItems.map((item) => item.checklistItem), [
    ...LEGACY_SEMANTIC_CHECKLIST
  ])
  assert.equal(suite.payload.compatibilityItems.some((item) => (
    item.checklistItem === 'SER.collaboration.contribution_value'
  )), false)
  assert.equal(JSON.stringify(suite).includes('aggregateScore'), false)

  const result = resultFixture()
  const hardBefore = canonicalHardOutcome(result)
  const attached = attachSemanticJudgeViewSuite(
    result,
    semanticJudgeViewSuiteResultReference(suite, 'private/semantic-suite.json')
  )
  assert.equal(canonicalHardOutcome(attached).digest, hardBefore.digest)
  assert.equal(attached.semanticEngineeringReview.items.length, 11)
  assert.equal(attached.semanticEngineeringReview.views[0].items.length, 5)
  assert.equal(attached.semanticEngineeringReview.views[1].items.length, 7)
  const redacted = redactQualificationResult(attached)
  assert.deepEqual(redacted.semanticEngineeringReview.views.map((view) => view.view), [
    'process',
    'outcome'
  ])
  assert.equal(redacted.semanticEngineeringReview.views[0].items.length, 5)
  assert.equal(JSON.stringify(redacted).includes('private/semantic-suite.json'), false)
  assert.equal(JSON.stringify(redacted).includes('reviewArtifact'), false)
})

test('Review and Suite reject redigested tampering of deterministic projections', async () => {
  const fixture = dualViewFixture()
  const processExecution = await successfulExecution(fixture.process)
  const outcomeExecution = await successfulExecution(fixture.outcome)
  const process = { ...fixture.process, ...processExecution }
  const outcome = { ...fixture.outcome, ...outcomeExecution }

  const tamperedReview = structuredClone(process.review)
  tamperedReview.payload.items[0].verdict = 'not_satisfied'
  tamperedReview.payloadDigest = `sha256:${digestJson(tamperedReview.payload)}`
  assert.throws(() => validateJudgeViewReview(tamperedReview, {
    configuration: process.configuration,
    pack: process.pack,
    replicas: process.replicas
  }), /not the deterministic reconciliation/)

  const suite = buildSemanticJudgeViewSuite({
    process,
    outcome,
    producerDigest: 'a'.repeat(64)
  })
  const tamperedSuite = structuredClone(suite)
  tamperedSuite.payload.compatibilityItems[0].verdict = 'not_satisfied'
  tamperedSuite.payloadDigest = `sha256:${digestJson(tamperedSuite.payload)}`
  assert.throws(
    () => validateSemanticJudgeViewSuite(tamperedSuite),
    /not derived from its Views/
  )

  const tamperedPack = structuredClone(fixture.outcome.pack)
  tamperedPack.payload.modelInput.finalResponse.segmentId = 'invented-final-response'
  tamperedPack.payload.modelInputDigest = `sha256:${digestJson(
    tamperedPack.payload.modelInput
  )}`
  tamperedPack.payloadDigest = `sha256:${digestJson(tamperedPack.payload)}`
  assert.throws(() => validateJudgeViewPack(tamperedPack, {
    configuration: fixture.outcome.configuration,
    sourcePack: fixture.sourcePack
  }), /not the deterministic projection/)
})

test('out-of-item evidence makes a view unavailable without retry or Hard Outcome mutation', async () => {
  const fixture = dualViewFixture({ maximumTransportAttempts: 1 })
  const implementation = fixture.outcome.pack.payload.modelInput.checklistCoverage.find((item) => (
    item.checklistItem === 'SER.implementation.quality'
  ))
  const response = fixture.outcome.pack.payload.modelInput.checklistCoverage.find((item) => (
    item.checklistItem === 'SER.response.limitations'
  ))
  assert.equal(implementation.evidenceIds.includes(response.evidenceIds[0]), false)

  const execution = await executeJudgeView({
    ...fixture.outcome,
    producerDigest: 'a'.repeat(64),
    invokeReplica: async ({ replica }) => {
      const items = replicaItems(fixture.outcome.pack)
      if (replica === 'A') {
        items.find((item) => (
          item.checklistItem === 'SER.implementation.quality'
        )).evidenceIds = [response.evidenceIds[0]]
      }
      return { items }
    }
  })

  assert.equal(execution.review.payload.state, 'unavailable')
  assert.equal(execution.replicas[0].payload.attempts.length, 1)
  assert.equal(
    execution.replicas[0].payload.attempts[0].reason.code,
    'semantic_judge_view.evidence_out_of_item'
  )
})

test('Replica output is closed and cannot smuggle an aggregate score or treatment field', async () => {
  const fixture = dualViewFixture({ maximumTransportAttempts: 1 })
  const execution = await executeJudgeView({
    ...fixture.outcome,
    producerDigest: 'a'.repeat(64),
    invokeReplica: async () => {
      const items = replicaItems(fixture.outcome.pack)
      items[0].aggregateScore = 100
      return { items }
    }
  })

  assert.equal(execution.review.payload.state, 'unavailable')
  assert.equal(execution.replicas.every((replica) => (
    replica.payload.attempts[0].reason.code === 'semantic_judge_view.invalid_item'
  )), true)
})

test('independent Judge executions have collision-free immutable Replica identities', async () => {
  const fixture = dualViewFixture()
  const invokeReplica = async () => ({ items: replicaItems(fixture.outcome.pack) })
  const first = await executeJudgeView({
    ...fixture.outcome,
    producerDigest: 'a'.repeat(64),
    judgeExecutionId: 'judge-execution:first',
    invokeReplica
  })
  const second = await executeJudgeView({
    ...fixture.outcome,
    producerDigest: 'a'.repeat(64),
    judgeExecutionId: 'judge-execution:second',
    invokeReplica
  })

  assert.notEqual(first.replicas[0].artifactId, second.replicas[0].artifactId)
  assert.notEqual(first.review.artifactId, second.review.artifactId)
})

test('Process Judge is not invoked for Solo or mechanically empty collaboration evidence', async () => {
  const fixture = dualViewFixture({ buildPacks: false })
  const sourcePack = structuredClone(fixture.sourcePack)
  sourcePack.payload.members = []
  sourcePack.payload.collaborationFacts = []
  sourcePack.payload.untrustedEvidence = sourcePack.payload.untrustedEvidence.filter((segment) => (
    segment.kind !== 'participant_message'
  ))
  sourcePack.payload.checklistCoverage = [
    'SER.collaboration.delegation',
    'SER.collaboration.handoff_clarity',
    'SER.collaboration.feedback_absorption',
    'SER.collaboration.lead_integration'
  ].map((checklistItem) => ({
    checklistItem,
    coverage: {
      state: 'not_applicable',
      reason: { code: 'judge_pack.no_member_calls_observed' }
    },
    evidenceReferences: []
  }))
  sourcePack.payloadDigest = `sha256:${digestJson(sourcePack.payload)}`

  const pack = buildJudgeViewPack({
    view: 'process',
    sourcePack,
    configuration: fixture.process.configuration,
    producerDigest: 'a'.repeat(64)
  })
  assert.equal(pack.payload.modelInput.checklistCoverage.every((item) => (
    item.coverage.state === 'not_applicable'
  )), true)
  let invocations = 0
  const execution = await executeJudgeView({
    configuration: fixture.process.configuration,
    pack,
    producerDigest: 'a'.repeat(64),
    invokeReplica: async () => {
      invocations += 1
      throw new Error('must not be called')
    }
  })
  assert.equal(invocations, 0)
  assert.equal(execution.review.payload.state, 'complete')
  assert.equal(execution.review.payload.items.every((item) => (
    item.verdict === 'not_applicable'
  )), true)
  assert.equal(execution.replicas.every((replica) => (
    replica.payload.invocationState === 'not_invoked_not_applicable'
  )), true)
})

test('missing interaction evidence is unavailable rather than not applicable and skips LLM invocation', async () => {
  const fixture = dualViewFixture({ buildPacks: false })
  const sourcePack = structuredClone(fixture.sourcePack)
  sourcePack.payload.collaborationFacts = []
  sourcePack.payload.untrustedEvidence = sourcePack.payload.untrustedEvidence.filter((segment) => (
    segment.kind !== 'participant_message'
  ))
  sourcePack.payload.checklistCoverage = [
    'SER.collaboration.delegation',
    'SER.collaboration.handoff_clarity',
    'SER.collaboration.feedback_absorption',
    'SER.collaboration.lead_integration'
  ].map((checklistItem) => ({
    checklistItem,
    coverage: {
      state: 'unavailable',
      reason: { code: 'judge_pack.item_evidence_unavailable' }
    },
    evidenceReferences: []
  }))
  sourcePack.payloadDigest = `sha256:${digestJson(sourcePack.payload)}`
  const pack = buildJudgeViewPack({
    view: 'process',
    sourcePack,
    configuration: fixture.process.configuration,
    producerDigest: 'a'.repeat(64)
  })
  assert.equal(pack.payload.modelInput.checklistCoverage.every((item) => (
    item.coverage.state === 'unavailable'
  )), true)
  let invocations = 0
  const execution = await executeJudgeView({
    configuration: fixture.process.configuration,
    pack,
    producerDigest: 'a'.repeat(64),
    invokeReplica: async () => {
      invocations += 1
      throw new Error('must not be called')
    }
  })
  assert.equal(invocations, 0)
  assert.equal(execution.review.payload.state, 'unavailable')
  assert.equal(execution.replicas.every((replica) => (
    replica.payload.invocationState === 'not_invoked_unavailable'
  )), true)
})

test('dual-view artifacts retain immutable private provenance and Suite pointer', async () => {
  const fixture = dualViewFixture()
  const processExecution = await successfulExecution(fixture.process)
  const outcomeExecution = await successfulExecution(fixture.outcome)
  const process = { ...fixture.process, ...processExecution }
  const outcome = { ...fixture.outcome, ...outcomeExecution }
  const suite = buildSemanticJudgeViewSuite({
    process,
    outcome,
    producerDigest: 'a'.repeat(64)
  })
  const root = await mkdtemp(join(tmpdir(), 'rovai-judge-views-'))
  try {
    const retained = await retainSemanticJudgeViewArtifacts(root, { process, outcome, suite })
    assert.equal(retained.resultReference.status, 'complete')
    assert.equal(retained.retainedViews.length, 2)
    if (globalThis.process.platform !== 'win32') {
      assert.equal((await stat(join(root, retained.retainedSuite.locator))).mode & 0o777, 0o600)
      assert.equal((await stat(join(root, 'semantic-outcome-judge-pack.json'))).mode & 0o777, 0o600)
      assert.equal((await stat(join(root, 'semantic-process-judge-pack.json'))).mode & 0o777, 0o600)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function dualViewFixture(options = {}) {
  const sourcePack = sourcePackFixture()
  const common = {
    provider: 'fixture-provider',
    snapshotId: 'fixture-model-2026-08-11',
    snapshotDigest: 'b'.repeat(64),
    producerDigest: 'a'.repeat(64),
    retrySchedule: {
      maximumTransportAttempts: options.maximumTransportAttempts ?? 2,
      backoffMilliseconds: [0],
      retryValidOutput: false
    }
  }
  const process = {
    configuration: buildJudgeViewConfiguration({ view: 'process', ...common })
  }
  const outcome = {
    configuration: buildJudgeViewConfiguration({ view: 'outcome', ...common })
  }
  if (options.buildPacks !== false) {
    process.pack = buildJudgeViewPack({
      view: 'process',
      sourcePack,
      configuration: process.configuration,
      producerDigest: 'a'.repeat(64)
    })
    outcome.pack = buildJudgeViewPack({
      view: 'outcome',
      sourcePack,
      configuration: outcome.configuration,
      producerDigest: 'a'.repeat(64)
    })
  }
  return { sourcePack, process, outcome }
}

async function successfulExecution(viewFixture) {
  return executeJudgeView({
    ...viewFixture,
    producerDigest: 'a'.repeat(64),
    judgeExecutionId: 'judge-execution:fixture',
    invokeReplica: async () => ({ items: replicaItems(viewFixture.pack) })
  })
}

function replicaItems(pack) {
  return pack.payload.modelInput.checklistCoverage.map((coverage) => ({
    checklistItem: coverage.checklistItem,
    dimension: dimension(coverage.checklistItem),
    verdict: 'satisfied',
    confidence: 'high',
    evidenceIds: coverage.evidenceIds.slice(0, 2),
    reason: 'The allowlisted evidence supports this item.',
    abstainReason: null
  }))
}

function dimension(checklistItem) {
  if (checklistItem.startsWith('SER.collaboration.')) return 'collaboration'
  return checklistItem.split('.')[1]
}

function sourcePackFixture() {
  const reference = (evidenceId) => ({
    artifactId: 'evidence-index:fixture',
    evidenceId
  })
  const payload = {
    packId: 'judge-pack:fixture',
    configurationArtifact: artifactReference('semantic-judge-configuration:fixture'),
    case: {
      caseId: 'CASE-FIXTURE',
      title: 'Group adjacent events',
      requirements: [{
        requirementId: 'REQ-FUNCTIONAL',
        criticality: 'critical',
        statement: 'Group adjacent events without mutating the input.'
      }, {
        requirementId: 'REQ-BOUNDARY',
        criticality: 'non_critical',
        statement: 'Keep changes inside the disclosed boundary.'
      }]
    },
    members: [{ pseudonym: 'member-001', declaredRole: 'Lead' }, {
      pseudonym: 'member-002', declaredRole: 'Reviewer'
    }],
    workspaceChanges: [{
      changeId: 'workspace-mutation:source',
      path: 'src/group-events.mjs',
      operation: 'modify',
      boundedContextSegmentId: 'segment-code',
      evidenceReferences: [reference('runner.workspace-change:source')]
    }],
    verificationFacts: [{
      checkId: 'CHK-FUNCTIONAL',
      kind: 'hard',
      categoryId: 'functional',
      requirementIds: ['REQ-FUNCTIONAL'],
      status: 'passed',
      evidenceReferences: [reference('derived.check:functional')]
    }, {
      checkId: 'CHK-BOUNDARY',
      kind: 'hard',
      categoryId: 'change_boundary',
      requirementIds: ['REQ-BOUNDARY'],
      status: 'passed',
      evidenceReferences: [reference('derived.check:boundary')]
    }],
    collaborationFacts: ['accepted_call', 'recipient_input', 'recipient_run'].map((factType) => ({
      factId: `collaboration-fact:call-1:${factType}`,
      factType,
      callId: 'call-1',
      senderPseudonym: 'member-001',
      recipientPseudonym: 'member-002',
      visibility: 'public_to_camp',
      contentSegmentId: 'segment-call',
      evidenceReferences: [reference(`core.${factType}:call-1`)]
    })),
    toolFacts: [],
    mutationFacts: [reference('runner.workspace-change:source')],
    finalResponse: {
      segmentId: 'segment-final',
      evidenceReference: reference('core.message:final')
    },
    untrustedEvidence: [{
      segmentId: 'segment-call',
      kind: 'participant_message',
      authorPseudonym: 'member-001',
      visibility: 'public_to_camp',
      content: 'Review the boundary cases and report concrete risks and suggested tests.',
      evidenceReference: reference('core.accepted_call:call-1')
    }, {
      segmentId: 'segment-code',
      kind: 'code',
      authorPseudonym: null,
      visibility: 'workspace',
      content: 'export function groupEvents(events) { return events.map((event) => ({ ...event })) }',
      evidenceReference: reference('runner.workspace-change:source')
    }, {
      segmentId: 'segment-final',
      kind: 'final_response',
      authorPseudonym: 'member-001',
      visibility: 'public_to_camp',
      content: 'Implemented grouping without input mutation; functional and boundary checks pass.',
      evidenceReference: reference('core.message:final')
    }],
    checklistCoverage: []
  }
  return {
    artifactId: 'judge-evidence-pack:fixture',
    schemaId: 'rovai.qualification.judge-evidence-pack',
    schemaVersion: '1.0.0',
    producer: {
      id: 'rovai-qualification-runner',
      version: 'fixture',
      digest: `sha256:${'a'.repeat(64)}`
    },
    binding: {
      trialId: 'trial-fixture',
      suiteId: 'suite-fixture',
      plannedSlotId: 'slot-fixture',
      caseId: 'CASE-FIXTURE'
    },
    sourceBoundaries: [],
    payloadDigest: `sha256:${digestJson(payload)}`,
    payload
  }
}

function resultFixture() {
  return {
    schemaVersion: 2,
    trialId: 'trial-fixture',
    suiteId: 'suite-fixture',
    plannedSlotId: 'slot-fixture',
    dispatchAccepted: true,
    validity: 'valid',
    evaluationState: 'complete',
    verifiedDelivery: 'pass',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent',
    overall: 'pass',
    hardOutcome: 'pass',
    hardLayer: {
      validity: 'valid',
      evaluationState: 'complete',
      verifiedDelivery: 'pass',
      orchestrationConvergence: 'pass',
      postDispatchHumanIntervention: 'absent',
      overall: 'pass'
    }
  }
}

function replaceEvidenceIdentity(value, artifactId) {
  visit(value)
  function visit(item) {
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (!item || typeof item !== 'object') return
    if (typeof item.evidenceId === 'string' && typeof item.artifactId === 'string') {
      item.artifactId = artifactId
      item.evidenceId = `alternate:${item.evidenceId}`
    }
    for (const child of Object.values(item)) visit(child)
  }
}

function artifactReference(artifactId) {
  return {
    artifactId,
    schemaId: 'fixture.schema',
    schemaVersion: '1.0.0',
    payloadDigest: `sha256:${'c'.repeat(64)}`
  }
}

test('generic task profile uses delivered report evidence, frozen applicability, and preserves blinding', async () => {
  const { taskJudgeProfile } = await import('./context-judge-profile.mjs')
  const { readFile } = await import('node:fs/promises')
  const scoring = JSON.parse(await readFile(new URL('../../qualification/context-regression/scoring-v2.json', import.meta.url)))
  for (const caseId of ['DEMO-105', 'DEMO-115']) {
    const acceptance = taskJudgeProfile(scoring.cases[caseId], 'outcome')
    assert.doesNotMatch(acceptance.items.find(item => item.checklistItem === 'SER.requirements.understanding').criterion, /队员|征集|分工|review-duo/)
  }
  const fixture = dualViewFixture({buildPacks:false})
  const configuration = buildJudgeViewConfiguration({view:'outcome',provider:'fixture',snapshotId:'fixture-2026-09-10',snapshotDigest:'b'.repeat(64),producerDigest:'a'.repeat(64),taskProfile:taskJudgeProfile(scoring.cases['DEMO-102'],'outcome')})
  const source = fixture.sourcePack
  source.payload.workspaceChanges[0].path='report.json'
  source.payload.untrustedEvidence.find(item=>item.kind==='code').content='{"failuresByService":{"api":3}}'
  source.payloadDigest=`sha256:${digestJson(source.payload)}`
  const pack=buildJudgeViewPack({view:'outcome',sourcePack:source,configuration,producerDigest:'a'.repeat(64)})
  assert.ok(pack.payload.modelInput.evidenceSegments.some(item=>item.kind==='artifact'))
  assert.equal(JSON.stringify(pack.payload.modelInput).includes('participant_message'),false)
  assert.ok(pack.payload.modelInput.checklistCoverage.every(item=>item.coverage.state==='complete'))
  const seen=[]
  const execution=await executeJudgeView({configuration,pack,producerDigest:'a'.repeat(64),invokeReplica:async request=>{seen.push(request);const items=replicaItems(pack);items[0].verdict='not_applicable';items[0].abstainReason={code:'fixture.exclude'};return{items}}})
  assert.equal(execution.review.payload.state,'unavailable')
  assert.match(seen[0].userPrompt,/Non-code work does not require code/)
  assert.doesNotMatch(seen[0].userPrompt,/maintainability from the bounded delivered code/)
})

test('frozen required collaboration cannot become N/A when no interaction was executed', async () => {
  const { taskJudgeProfile } = await import('./context-judge-profile.mjs')
  const {readFile}=await import('node:fs/promises')
  const scoring=JSON.parse(await readFile(new URL('../../qualification/context-regression/scoring-v2.json',import.meta.url)))
  const fixture=dualViewFixture({buildPacks:false}),source=fixture.sourcePack
  source.payload.collaborationFacts=[]
  source.payload.untrustedEvidence=source.payload.untrustedEvidence.filter(item=>item.kind!=='participant_message')
  source.payload.checklistCoverage=PROCESS_JUDGE_CHECKLIST.map(checklistItem=>({checklistItem,coverage:{state:'not_applicable'}}))
  source.payloadDigest=`sha256:${digestJson(source.payload)}`
  for(const caseId of ['DEMO-102','DEMO-103']){
    const configuration=buildJudgeViewConfiguration({view:'process',provider:'fixture',snapshotId:'fixture-2026-09-10',snapshotDigest:'b'.repeat(64),producerDigest:'a'.repeat(64),taskProfile:taskJudgeProfile(scoring.cases[caseId],'process')})
    const pack=buildJudgeViewPack({view:'process',sourcePack:source,configuration,producerDigest:'a'.repeat(64)})
    let calls=0;const result=await executeJudgeView({configuration,pack,producerDigest:'a'.repeat(64),invokeReplica:async()=>{calls++;throw Error('must not call')}})
    assert.equal(calls,0)
    assert.equal(result.review.payload.state,caseId==='DEMO-102'?'complete':'unavailable')
  }
})

test('v3 accepts relevant in-view boundary evidence and quarantines only a malformed item', async () => {
  const { taskJudgeProfile } = await import('./context-judge-profile.mjs')
  const { readFile } = await import('node:fs/promises')
  const scoring = JSON.parse(await readFile(new URL('../../qualification/context-regression/scoring-v2.json', import.meta.url)))
  const source = dualViewFixture({ buildPacks: false }).sourcePack
  const config = { ...scoring.cases['DEMO-102'], judgeProfile: 'generic-task-v3' }
  const configuration = buildJudgeViewConfiguration({ view: 'outcome', provider: 'fixture', snapshotId: 'fixture-v3', snapshotDigest: 'b'.repeat(64), producerDigest: 'a'.repeat(64), taskProfile: taskJudgeProfile(config, 'outcome') })
  const pack = buildJudgeViewPack({ view: 'outcome', sourcePack: source, configuration, producerDigest: 'a'.repeat(64) })
  const verificationId = pack.payload.modelInput.verificationFacts.flatMap(fact => fact.evidenceIds)[0]
  assert.ok(pack.payload.modelInput.checklistCoverage.find(item => item.checklistItem === 'SER.scope.discipline').evidenceIds.includes(verificationId))
  const execution = await executeJudgeView({ configuration, pack, producerDigest: 'a'.repeat(64), invokeReplica: async () => {
    const items = replicaItems(pack)
    items.find(item => item.checklistItem === 'SER.scope.discipline').evidenceIds = [verificationId]
    items.find(item => item.checklistItem === 'SER.response.claim_accuracy').evidenceIds = ['EV-9999']
    return { items }
  } })
  assert.equal(execution.review.payload.items.length, 7)
  assert.equal(execution.review.payload.items.find(item => item.checklistItem === 'SER.scope.discipline').verdict, 'satisfied')
  assert.equal(execution.review.payload.items.find(item => item.checklistItem === 'SER.response.claim_accuracy').verdict, 'indeterminate')
  assert.match(execution.review.payload.items.find(item => item.checklistItem === 'SER.response.claim_accuracy').reason, /evidence_out_of_pack/)
})


test('v3 nested task file IDs project their original path without crossing the Outcome boundary', async () => {
  const { taskJudgeProfile } = await import('./context-judge-profile.mjs')
  const { readFile } = await import('node:fs/promises')
  const scoring = JSON.parse(await readFile(new URL('../../qualification/context-regression/scoring-v2.1.json', import.meta.url)))
  const sourcePack = sourcePackFixture(), path = 'src/original.mjs'
  sourcePack.payload.untrustedEvidence.push({segmentId:`task-file-base64:${Buffer.from(path).toString('base64url')}`,kind:'code',authorPseudonym:null,visibility:'workspace',content:'export const unchanged = 0',evidenceReference:{artifactId:'evidence-index:fixture',evidenceId:'runner.workspace-content:original'}})
  sourcePack.payloadDigest = `sha256:${digestJson(sourcePack.payload)}`
  const configuration = buildJudgeViewConfiguration({ view:'outcome', provider:'fixture', snapshotId:'fixture', snapshotDigest:'a'.repeat(64), producerDigest:'a'.repeat(64), taskProfile:taskJudgeProfile(scoring.cases['DEMO-106'],'outcome') })
  const pack = buildJudgeViewPack({view:'outcome',sourcePack,configuration,producerDigest:'a'.repeat(64)})
  assert.match(JSON.stringify(pack.payload.modelInput), /src\/original\.mjs/)
  assert.doesNotMatch(JSON.stringify(pack.payload.modelInput), /Review the boundary cases and report concrete risks/)
})

test('v4 adds bounded receipts and public delivery, while Task descriptions stay Process-only and v3 stays unchanged', async () => {
  const { taskJudgeProfile } = await import('./context-judge-profile.mjs')
  const { readFile } = await import('node:fs/promises')
  const scoring=JSON.parse(await readFile(new URL('../../qualification/context-regression/scoring-v2.2.json',import.meta.url)))
  const sourcePack=sourcePackFixture()
  for(const [prefix,kind,content] of [['verification-receipt','test_output','OBSERVED_TEST_RECEIPT'],['task-description','comment','TASK_BODY_CANARY'],['delivery-message','comment','PUBLIC_DELIVERY_CANARY']]) {
    sourcePack.payload.untrustedEvidence.push({segmentId:prefix+':one',kind,authorPseudonym:null,visibility:'public_to_camp',content,evidenceReference:{artifactId:'evidence-index:fixture',evidenceId:prefix+':one'}})
  }
  sourcePack.payloadDigest=`sha256:${digestJson(sourcePack.payload)}`
  for(const version of ['generic-task-v3','generic-task-v4']) for(const view of ['process','outcome']) {
    const config={...scoring.cases['DEMO-106'],judgeProfile:version}
    const configuration=buildJudgeViewConfiguration({view,provider:'fixture',snapshotId:'fixture',snapshotDigest:'a'.repeat(64),producerDigest:'a'.repeat(64),taskProfile:taskJudgeProfile(config,view)})
    const pack=buildJudgeViewPack({view,sourcePack,configuration,producerDigest:'a'.repeat(64)})
    const serialized=JSON.stringify(pack.payload.modelInput)
    assert.equal(serialized.includes('OBSERVED_TEST_RECEIPT'),version==='generic-task-v4')
    assert.equal(serialized.includes('PUBLIC_DELIVERY_CANARY'),version==='generic-task-v4')
    assert.equal(serialized.includes('TASK_BODY_CANARY'),version==='generic-task-v4'&&view==='process')
  }
})

for (const scoringVersion of ['2.3', '2.4', '2.5', '2.6', '2.7']) test(`scoring ${scoringVersion} resolves only disputed items once, preserving both original verdicts and citations`, async () => {
  const { taskJudgeProfile } = await import('./context-judge-profile.mjs')
  const { readFile } = await import('node:fs/promises')
  const scoring = JSON.parse(await readFile(new URL(`../../qualification/context-regression/scoring-v${scoringVersion}.json`, import.meta.url)))
  const configuration = buildJudgeViewConfiguration({ view:'outcome', provider:'fixture', snapshotId:'fixture', snapshotDigest:'a'.repeat(64), producerDigest:'a'.repeat(64), taskProfile:taskJudgeProfile(scoring.cases['DEMO-102'],'outcome') })
  const pack = buildJudgeViewPack({ view:'outcome', sourcePack:sourcePackFixture(), configuration, producerDigest:'a'.repeat(64) })
  const calls = []
  const execution = await executeJudgeView({ configuration, pack, producerDigest:'a'.repeat(64), invokeReplica: async request => {
    calls.push(request)
    const items = replicaItems(pack)
    if (request.replica === 'B') items[0].verdict = 'partially_satisfied'
    if (request.userPrompt.includes('evidence_adjudication_once_v1')) {
      items[0].verdict = 'not_satisfied'
      items[1].verdict = 'not_satisfied' // Non-disputed item must not change.
    }
    return { items }
  } })
  assert.equal(calls.length, 3)
  assert.equal(execution.review.payload.items[0].state, 'adjudicated')
  assert.equal(execution.review.payload.items[0].verdict, 'not_satisfied')
  assert.equal(execution.review.payload.items[0].replicaA.verdict, 'satisfied')
  assert.equal(execution.review.payload.items[0].replicaB.verdict, 'partially_satisfied')
  assert.equal(execution.review.payload.items[1].verdict, 'satisfied')
  assert.ok(execution.review.payload.adjudication)
  validateJudgeViewReview(execution.review, { configuration, pack, replicas:execution.replicas })
  const original = structuredClone(execution.review)
  execution.review.payload.adjudication.payload.adjudicationContext.sourceDigests[0] = 'changed'
  execution.review.payloadDigest = `sha256:${digestJson(execution.review.payload)}`
  assert.throws(() => validateJudgeViewReview(execution.review, { configuration, pack, replicas:execution.replicas }), /identity|binding|bound/)
  execution.review = original
  const base = dualViewFixture()
  const processExecution = await executeJudgeView({ ...base.process, producerDigest:'a'.repeat(64), judgeExecutionId:execution.replicas[0].payload.judgeExecutionId, invokeReplica: async () => ({items:replicaItems(base.process.pack)}) })
  const suite = buildSemanticJudgeViewSuite({ process:{...base.process,...processExecution}, outcome:{configuration,pack,...execution}, producerDigest:'a'.repeat(64) })
  assert.equal(suite.payload.protocolId, 'semantic-dual-view-judge-2')
  validateSemanticJudgeViewSuite(suite)
})

test('v5 adjudication retains unknown, invalid citation and transport failure without a second try', async () => {
  const { taskJudgeProfile } = await import('./context-judge-profile.mjs')
  const { readFile } = await import('node:fs/promises')
  const scoring = JSON.parse(await readFile(new URL('../../qualification/context-regression/scoring-v2.3.json', import.meta.url)))
  const configuration = buildJudgeViewConfiguration({ view:'outcome', provider:'fixture', snapshotId:'fixture', snapshotDigest:'a'.repeat(64), producerDigest:'a'.repeat(64), taskProfile:taskJudgeProfile(scoring.cases['DEMO-102'],'outcome') })
  const pack = buildJudgeViewPack({ view:'outcome', sourcePack:sourcePackFixture(), configuration, producerDigest:'a'.repeat(64) })
  for (const mode of ['unknown', 'invalid_citation', 'transport_failure', 'agreed_unknown']) {
    let calls=0
    const result=await executeJudgeView({configuration,pack,producerDigest:'a'.repeat(64),invokeReplica:async request=>{
      calls++
      const items=replicaItems(pack)
      if (mode === 'agreed_unknown') Object.assign(items[0],{verdict:'indeterminate',abstainReason:{code:'fixture.missing'}})
      else if (request.replica === 'B') items[0].verdict='not_satisfied'
      if (request.userPrompt.includes('evidence_adjudication_once_v1')) {
        if(mode==='transport_failure') throw new Error('Fixture provider unavailable')
        if(mode==='unknown') Object.assign(items[0],{verdict:'indeterminate',abstainReason:{code:'fixture.missing'}})
        if(mode==='invalid_citation') items[0].evidenceIds=['EV-9999']
      }
      return {items}
    }})
    assert.equal(calls,mode==='agreed_unknown'?2:3)
    assert.ok([null,'indeterminate'].includes(result.review.payload.items[0].verdict))
    validateJudgeViewReview(result.review,{configuration,pack,replicas:result.replicas})
  }
})

test('v5 configuration artifact revisions change identity without changing model-visible evidence', async () => {
  const { taskJudgeProfile } = await import('./context-judge-profile.mjs')
  const {readFile}=await import('node:fs/promises')
  const scoring=JSON.parse(await readFile(new URL('../../qualification/context-regression/scoring-v2.3.json',import.meta.url)))
  const args={view:'outcome',provider:'fixture',snapshotId:'fixture',snapshotDigest:'a'.repeat(64),taskProfile:taskJudgeProfile(scoring.cases['DEMO-102'],'outcome')}
  const first=buildJudgeViewConfiguration({...args,producerDigest:'a'.repeat(64)})
  const second=buildJudgeViewConfiguration({...args,producerDigest:'b'.repeat(64)})
  assert.notEqual(first.artifactId,second.artifactId)
  assert.deepEqual(first.payload,second.payload)
  const pack=configuration=>buildJudgeViewPack({view:'outcome',sourcePack:sourcePackFixture(),configuration,producerDigest:'a'.repeat(64)})
  assert.deepEqual(pack(first).payload.modelInput,pack(second).payload.modelInput)
})

test('v8 quarantines known participant prose embedded in a tool receipt without hiding it from Process', async () => {
  const {containsParticipantProse}=await import('./qualification-judge-views.mjs')
  const prose='This participant explains the comparison, operational costs, risks, and the conditions under which their recommendation would change. '.repeat(3)
  const segments=[{kind:'participant_message',content:prose}]
  assert.equal(containsParticipantProse({kind:'test_output',content:JSON.stringify({command:`python -c ${JSON.stringify(prose)}`,output:'word count: 62'})},segments),true)
  assert.equal(containsParticipantProse({kind:'test_output',content:JSON.stringify({command:'node --test tests/public.test.mjs',output:'12 checks passed'})},segments),false)
})

test('v10 Outcome admits task sources with local references while old profiles and process isolation stay unchanged', async()=>{
 const {taskJudgeProfile}=await import('./context-judge-profile.mjs');const {readFile}=await import('node:fs/promises')
 const scoring=JSON.parse(await readFile(new URL('../../qualification/context-regression/scoring-v2.8.json',import.meta.url)))
 const fixture=dualViewFixture({buildPacks:false});const source=fixture.sourcePack
 source.payload.untrustedEvidence.push({segmentId:'task-source:source-user',kind:'comment',authorPseudonym:null,visibility:'public_to_camp',content:JSON.stringify({sourceKind:'user_message',text:'Source tail ORBIT-74',characterCount:20,textState:'complete'}),evidenceReference:{artifactId:'evidence-index:fixture',evidenceId:'core.task-source:source-user'}})
 for(const version of ['generic-task-v9','generic-task-v10']) {
  const config=buildJudgeViewConfiguration({view:'outcome',provider:'fixture',snapshotId:'fixture-2026-09-10',snapshotDigest:'b'.repeat(64),producerDigest:'a'.repeat(64),taskProfile:taskJudgeProfile({...scoring.cases['DEMO-110'],judgeProfile:version},'outcome')})
  const pack=buildJudgeViewPack({view:'outcome',sourcePack:source,configuration:config,producerDigest:'a'.repeat(64)})
  assert.equal(pack.payload.modelInput.evidenceSegments.some(s=>s.kind==='task_source'),version==='generic-task-v10')
  assert.doesNotMatch(JSON.stringify(pack.payload.modelInput),/participant_message|source-user|evidence-index:fixture/)
  assert.equal(validateJudgeViewPack(pack,{configuration:config,sourcePack:source}).artifactId,pack.artifactId)
 }
})

test('v11 keeps ordered prior Lead delivery for an acknowledgement without scoring history as current claims', async()=>{
 const {taskJudgeProfile}=await import('./context-judge-profile.mjs');const {readFile}=await import('node:fs/promises')
 const scoring=JSON.parse(await readFile(new URL('../../qualification/context-regression/scoring-v2.8.json',import.meta.url)))
 const source=dualViewFixture({buildPacks:false}).sourcePack
 const message=(id,sequence,content)=>({segmentId:id,kind:'comment',sequence,authorPseudonym:null,visibility:'public_to_camp',content,evidenceReference:{artifactId:'evidence-index:fixture',evidenceId:`core.message:${id}`}})
 source.payload.untrustedEvidence.push(message('delivery-message:historical:ordered-0001:z',4,'Initial delivery: the migration implementation and report are complete.'),message('delivery-message:historical:ordered-0002:a',5,'Correction: the final file supersedes the earlier draft.'),message('delivery-message:current:c',6,'The published report stands; no duplicate publication is needed.'))
 for(const version of ['generic-task-v10','generic-task-v11','generic-task-v12']){
  const config=buildJudgeViewConfiguration({view:'outcome',provider:'fixture',snapshotId:'fixture',snapshotDigest:'b'.repeat(64),producerDigest:'a'.repeat(64),taskProfile:taskJudgeProfile({...scoring.cases['DEMO-104'],judgeProfile:version},'outcome')})
  const pack=buildJudgeViewPack({view:'outcome',sourcePack:source,configuration:config,producerDigest:'a'.repeat(64)})
  const history=pack.payload.modelInput.evidenceSegments.filter(s=>s.kind==='prior_delivery').map(s=>JSON.parse(s.content))
  assert.equal(history.length,version!=='generic-task-v10'?2:0)
  if(history.length){assert.deepEqual(history.map(x=>x.order),[1,2]);assert.match(history[0].text,/Initial delivery/);assert.match(history[1].text,/Correction/)}
  assert.equal(pack.payload.modelInput.evidenceSegments.filter(s=>s.kind==='delivery_message').length,1)
  assert.ok(!pack.payload.modelInput.evidenceSegments.some(s=>s.kind==='participant_message'))
 }
})

test('transport timeout retries only the missing replica, retains attempts and never retries valid low scores', async()=>{
 const fixture=dualViewFixture();const calls={A:0,B:0}
 const result=await executeJudgeView({configuration:fixture.outcome.configuration,pack:fixture.outcome.pack,producerDigest:'a'.repeat(64),wait:async()=>{},invokeReplica:async request=>{
  calls[request.replica]++
  if(request.replica==='B'&&calls.B===1){const {parseCliResult}=await import('./qualification-cli-judge-adapter.mjs');parseCliResult({code:null,timedOut:true,stdout:''},1024)}
  const value=await invokeFixtureReplica(request)
  return {...value,items:value.items.map(item=>({...item,verdict:'not_satisfied'}))}
 }})
 assert.deepEqual(calls,{A:1,B:2})
 assert.equal(result.replicas[1].payload.attempts[0].state,'timed_out')
 assert.ok(result.review.payload.items.every(item=>item.verdict==='not_satisfied'))
})

test('exhausted replica transport attempts remain separate from the retained valid replica', async () => {
  const { readJudgeExecutionFailures } = await import('./qualification-judge-views.mjs')
  const fixture=dualViewFixture(), calls={A:0,B:0}
  const processExecution=await successfulExecution(fixture.process)
  const outcomeExecution=await executeJudgeView({...fixture.outcome,producerDigest:'a'.repeat(64),judgeExecutionId:'judge-execution:fixture',wait:async()=>{},invokeReplica:async ({replica})=>{
    calls[replica]++
    if(replica==='B')throw Object.assign(new Error('timeout'),{judgeFailureKind:'timed_out'})
    return replicaItems(fixture.outcome.pack)
  }})
  const process={...fixture.process,...processExecution},outcome={...fixture.outcome,...outcomeExecution}
  const suite=buildSemanticJudgeViewSuite({process,outcome,producerDigest:'a'.repeat(64)})
  const root=await mkdtemp(join(tmpdir(),'rovai-judge-exhausted-'))
  try {
    await retainSemanticJudgeViewArtifacts(root,{process,outcome,suite})
    const failures=await readJudgeExecutionFailures(root,suite)
    assert.deepEqual(calls,{A:1,B:2});assert.equal(failures.length,1)
    assert.equal(failures[0].view,'outcome');assert.equal(failures[0].replica,'B');assert.equal(failures[0].attempts,2)
    assert.equal(failures[0].code,'semantic_judge_view.timed_out')
    assert.equal(outcome.replicas[0].payload.items.length,7)
    assert.equal(outcome.review.payload.items.length,0)
  } finally {await rm(root,{recursive:true,force:true})}
})
