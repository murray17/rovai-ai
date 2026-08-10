import { join } from 'node:path'
import {
  QUALIFICATION_RUNNER_VERSION,
  atomicWriteJson,
  digestJson,
  sha256,
  writePrivateJsonExclusive
} from './qualification-common.mjs'
import { validateQualificationArtifactSchema } from './qualification-schema-validation.mjs'

export const COLLABORATION_LEDGER_SCHEMA_ID = 'rovai.qualification.collaboration-ledger'
export const COLLABORATION_LEDGER_SCHEMA_VERSION = '1.0.0'

const FORBIDDEN_FIELDS = new Set([
  'returnPolicy',
  'returnObligation',
  'callOutcome',
  'responseProduced',
  'sourceReceived',
  'responseClosure',
  'sourceResume',
  'conversationInputKind'
])

export function buildCollaborationLedger({
  trialId,
  evaluationAttemptId = null,
  plannedSlotId,
  suiteId = null,
  caseId,
  caseSeal,
  producerDigest,
  collaborationEvidence,
  evidenceIndex,
  evidenceReferences
}) {
  const artifactId = `collaboration-ledger:${sha256(`${trialId}:${evaluationAttemptId ?? 'capture'}`).slice(0, 32)}`
  const evidenceRecordIds = new Set(evidenceIndex.payload.records.map((record) => record.evidenceId))
  const calls = []
  let incompleteCalls = 0
  for (const call of collaborationEvidence?.a2a ?? []) {
    const currentSurface = typeof call.messageId === 'string'
      && typeof call.deliveryId === 'string'
    const inputReference = currentSurface
      ? evidenceReferences.messageDeliveries?.[call.deliveryId]
      : evidenceReferences.conversationInputs?.[call.conversationInputId]
    const contextManifestReference = currentSurface && call.recipientInputEvidenceId
      ? evidenceReferences.contextManifests?.[call.recipientInputEvidenceId] ?? null
      : null
    const runReference = call.recipientRunId
      ? evidenceReferences.agentRuns[call.recipientRunId]
      : null
    const eventReference = call.acceptanceEventId
      ? evidenceReferences.events[call.acceptanceEventId]
      : null
    const contentReference = currentSurface
      ? evidenceReferences.messageContents?.[call.messageId]
      : evidenceReferences.inboxMessages?.[call.inboxMessageId]
    const adaptedCall = currentSurface
      ? {
          ...call,
          conversationInputId: call.recipientInputEvidenceId ?? call.deliveryId,
          inputStatus: currentInputState(call.recipientInputStatus ?? call.deliveryStatus)
        }
      : call
    if (!isCanonicalCall(adaptedCall) || !contentReference || !inputReference || !eventReference) {
      incompleteCalls += 1
      continue
    }
    const input = {
      inputId: adaptedCall.conversationInputId,
      state: adaptedCall.inputStatus,
      persistedAt: adaptedCall.inputPersistedAt,
      terminalAt: timestampOrNull(adaptedCall.inputTerminalAt),
      reason: typedReason(adaptedCall.inputTerminalReason, 'collaboration.input_terminal')
    }
    const recipientRun = {
      runId: call.recipientRunId,
      state: recipientRunState(call.recipientRunStatus),
      materializedAt: timestampOrNull(call.recipientRunMaterializedAt),
      startedAt: timestampOrNull(call.recipientRunStartedAt),
      terminalAt: timestampOrNull(call.recipientRunTerminalAt),
      reason: typedReason(call.recipientRunReason, 'collaboration.recipient_run')
    }
    const evidenceReferencesForCall = uniqueReferences([
      contentReference,
      inputReference,
      contextManifestReference,
      eventReference,
      runReference
    ].filter(Boolean))
    if (evidenceReferencesForCall.some((reference) => (
      reference.artifactId !== evidenceIndex.artifactId
      || !evidenceRecordIds.has(reference.evidenceId)
    ))) {
      throw new Error(`Collaboration Ledger call ${call.callId} has an unresolved Evidence Reference`)
    }
    // The v0.34 ledger schema is sealed with these historical property names.
    // Current Core input is Agent-ID based; this is an explicit version adapter only.
    calls.push({
      callId: adaptedCall.callId,
      acceptanceReceiptId: adaptedCall.acceptanceReceiptId,
      senderMemberId: adaptedCall.senderAgentId,
      recipientMemberId: adaptedCall.recipientAgentId,
      contentEvidenceReference: contentReference,
      taskId: adaptedCall.taskId ?? null,
      slot: adaptedCall.slot,
      depth: adaptedCall.depth,
      acceptedAt: adaptedCall.acceptedAt,
      input,
      recipientRun,
      mechanicalSettlement: {
        state: adaptedCall.mechanicalSettlement.state,
        reason: typedReason(adaptedCall.mechanicalSettlement.reason, 'collaboration.mechanical_settlement')
      },
      latencySegments: buildLatencySegments(adaptedCall),
      evidenceReferences: evidenceReferencesForCall,
      contentDigest: adaptedCall.contentDigest
    })
  }
  calls.sort((left, right) => (
    left.slot - right.slot
    || left.acceptedAt.localeCompare(right.acceptedAt)
    || left.callId.localeCompare(right.callId)
  ))
  const authoritativeAccepted = collaborationEvidence?.metrics?.acceptedMemberCalls
  const complete = [
    'complete_with_canonical_acceptance_receipts',
    'complete_with_message_delivery_receipts'
  ].includes(collaborationEvidence?.metrics?.coverage)
    && incompleteCalls === 0
    && Number.isInteger(authoritativeAccepted)
    && authoritativeAccepted === calls.length
  const payloadCalls = calls.map(({ contentDigest, ...call }) => call)
  const payload = {
    calls: payloadCalls,
    routeFacts: deriveRouteFacts(calls, evidenceIndex.artifactId),
    metrics: {
      coverage: complete
        ? { state: 'complete', reason: null }
        : {
            state: 'partial',
            reason: { code: 'collaboration_ledger.canonical_call_coverage_incomplete' }
          },
      acceptedCalls: Number.isInteger(authoritativeAccepted) ? authoritativeAccepted : null,
      settledCalls: complete
        ? calls.filter((call) => call.mechanicalSettlement.state === 'settled').length
        : null,
      maximumDepth: Number.isInteger(collaborationEvidence?.metrics?.maximumDepth)
        ? collaborationEvidence.metrics.maximumDepth
        : null
    }
  }
  const artifact = {
    artifactId,
    schemaId: COLLABORATION_LEDGER_SCHEMA_ID,
    schemaVersion: COLLABORATION_LEDGER_SCHEMA_VERSION,
    producer: {
      id: 'rovai-qualification-runner',
      version: QUALIFICATION_RUNNER_VERSION,
      digest: withSha256Prefix(producerDigest)
    },
    binding: compactObject({
      suiteId,
      plannedSlotId,
      trialId,
      caseId,
      caseSeal: withSha256Prefix(caseSeal)
    }),
    sourceBoundaries: evidenceIndex.sourceBoundaries
      .filter((boundary) => [
        'core.camp-snapshot',
        'core.event-stream',
        'derived.qualification-evaluator'
      ].includes(boundary.sourceId))
      .map((boundary) => structuredClone(boundary)),
    payloadDigest: digest(payload),
    payload
  }
  validateCollaborationLedger(artifact, evidenceIndex)
  return artifact
}

export async function retainCollaborationLedgerArtifact(evidenceDirectory, artifact, evidenceIndex) {
  validateCollaborationLedger(artifact, evidenceIndex)
  const locator = join('collaboration-ledgers', `${artifact.artifactId}.json`)
  await writePrivateJsonExclusive(join(evidenceDirectory, locator), artifact)
  await atomicWriteJson(join(evidenceDirectory, 'collaboration-ledger.json'), artifact)
  return {
    artifactId: artifact.artifactId,
    schemaId: artifact.schemaId,
    schemaVersion: artifact.schemaVersion,
    payloadDigest: artifact.payloadDigest,
    locator,
    callCount: artifact.payload.calls.length,
    routeFactCount: artifact.payload.routeFacts.length,
    metrics: artifact.payload.metrics
  }
}

export function validateCollaborationLedger(artifact, evidenceIndex) {
  if (artifact?.schemaId !== COLLABORATION_LEDGER_SCHEMA_ID
      || artifact.schemaVersion !== COLLABORATION_LEDGER_SCHEMA_VERSION
      || artifact.payloadDigest !== digest(artifact.payload)) {
    throw new Error('Collaboration Ledger envelope identity is invalid')
  }
  assertNoForbiddenFields(artifact.payload)
  const evidenceIds = new Set(evidenceIndex?.payload?.records?.map((record) => record.evidenceId) ?? [])
  const callIds = new Set()
  const receiptIds = new Set()
  const slots = new Set()
  for (const call of artifact.payload.calls) {
    if (callIds.has(call.callId) || receiptIds.has(call.acceptanceReceiptId) || slots.has(call.slot)) {
      throw new Error('Collaboration Ledger call identity is not unique')
    }
    callIds.add(call.callId)
    receiptIds.add(call.acceptanceReceiptId)
    slots.add(call.slot)
    for (const reference of [call.contentEvidenceReference, ...call.evidenceReferences]) {
      if (reference.artifactId !== evidenceIndex.artifactId || !evidenceIds.has(reference.evidenceId)) {
        throw new Error('Collaboration Ledger has an unresolved Evidence Reference')
      }
    }
  }
  for (const fact of artifact.payload.routeFacts) {
    if (fact.callIds.some((callId) => !callIds.has(callId))) {
      throw new Error('Collaboration Ledger route fact references an unknown Call')
    }
    for (const reference of fact.evidenceReferences) {
      if (reference.artifactId !== evidenceIndex.artifactId || !evidenceIds.has(reference.evidenceId)) {
        throw new Error('Collaboration Ledger route fact has an unresolved Evidence Reference')
      }
    }
  }
  const metrics = artifact.payload.metrics
  if (metrics.coverage.state === 'complete') {
    const settled = artifact.payload.calls.filter((call) => (
      call.mechanicalSettlement.state === 'settled'
    )).length
    if (metrics.acceptedCalls !== artifact.payload.calls.length || metrics.settledCalls !== settled) {
      throw new Error('Collaboration Ledger complete metrics disagree with Call records')
    }
  }
  validateQualificationArtifactSchema('collaboration-ledger.schema.json', artifact)
  return artifact
}

function deriveRouteFacts(calls, evidenceIndexArtifactId) {
  const facts = []
  const addFact = (kind, selected) => {
    const callIds = [...new Set(selected.map((call) => call.callId))].sort()
    const evidenceReferences = uniqueReferences(selected.flatMap((call) => call.evidenceReferences))
    facts.push({
      routeFactId: `route-fact:${kind}:${sha256(callIds.join(':')).slice(0, 24)}`,
      kind,
      callIds,
      evidenceReferences: evidenceReferences.filter((reference) => (
        reference.artifactId === evidenceIndexArtifactId
      ))
    })
  }
  for (const selected of groupedCalls(calls, (call) => (
    `${call.senderMemberId}\u0000${call.recipientMemberId}`
  )).values()) {
    if (selected.length > 1) addFact('repeated_route', selected)
  }
  for (const selected of groupedCalls(calls.filter((call) => call.contentDigest), (call) => (
    `${call.senderMemberId}\u0000${call.recipientMemberId}\u0000${call.contentDigest}`
  )).values()) {
    if (selected.length > 1) addFact('exact_duplicate_acceptance', selected)
  }
  for (const selected of groupedCalls(calls, (call) => (
    [call.senderMemberId, call.recipientMemberId].sort().join('\u0000')
  )).values()) {
    const directions = new Set(selected.map((call) => (
      `${call.senderMemberId}\u0000${call.recipientMemberId}`
    )))
    if (directions.size > 1) addFact('forward_cycle', selected)
  }
  return facts.sort((left, right) => left.routeFactId.localeCompare(right.routeFactId))
}

function groupedCalls(calls, keyOf) {
  const groups = new Map()
  for (const call of calls) {
    const key = keyOf(call)
    const values = groups.get(key) ?? []
    values.push(call)
    groups.set(key, values)
  }
  return groups
}

function buildLatencySegments(call) {
  const noRun = call.recipientRunStatus === 'not_materialized'
  return [
    latency('acceptance_to_input_persistence', call.acceptedAt, call.inputPersistedAt),
    latency('input_to_run_materialization', call.inputPersistedAt, call.recipientRunMaterializedAt, noRun),
    latency('materialization_to_recipient_start', call.recipientRunMaterializedAt, call.recipientRunStartedAt, noRun),
    latency('recipient_execution', call.recipientRunStartedAt, call.recipientRunTerminalAt, noRun),
    latency('acceptance_to_recipient_terminal', call.acceptedAt, call.recipientRunTerminalAt, noRun)
  ]
}

function latency(segment, start, end, notApplicable = false) {
  if (notApplicable) {
    return {
      segment,
      state: 'not_applicable',
      milliseconds: null,
      clockDomain: null,
      reason: { code: 'collaboration_ledger.recipient_run_not_materialized' }
    }
  }
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return {
      segment,
      state: 'indeterminate',
      milliseconds: null,
      clockDomain: null,
      reason: { code: 'collaboration_ledger.latency_boundary_unavailable' }
    }
  }
  return {
    segment,
    state: 'available',
    milliseconds: endMs - startMs,
    clockDomain: 'core_persisted_wall_clock',
    reason: null
  }
}

function isCanonicalCall(call) {
  const sourceIdentityComplete = (
    typeof call.inboxMessageId === 'string'
      && typeof call.conversationInputId === 'string'
  ) || (
    typeof call.messageId === 'string'
      && typeof call.deliveryId === 'string'
      && typeof call.conversationInputId === 'string'
  )
  return typeof call.callId === 'string'
    && typeof call.acceptanceReceiptId === 'string'
    && typeof call.acceptanceEventId === 'string'
    && sourceIdentityComplete
    && typeof call.senderAgentId === 'string'
    && typeof call.recipientAgentId === 'string'
    && Number.isSafeInteger(call.slot)
    && call.slot >= 1
    && Number.isSafeInteger(call.depth)
    && call.depth >= 1
    && Number.isFinite(Date.parse(call.acceptedAt))
    && Number.isFinite(Date.parse(call.inputPersistedAt))
    && ['pending', 'materialized', 'failed', 'cancelled'].includes(call.inputStatus)
    && ['settled', 'unsettled', 'indeterminate'].includes(call.mechanicalSettlement?.state)
}

function currentInputState(state) {
  if (['accepted', 'materialized', 'running', 'settled'].includes(state)) return 'materialized'
  if (['prepared', 'pending'].includes(state)) return 'pending'
  if (state === 'failed') return 'failed'
  if (['cancelled', 'interrupted_before_dispatch'].includes(state)) return 'cancelled'
  return null
}

function recipientRunState(state) {
  return [
    'not_materialized',
    'queued',
    'running',
    'waiting',
    'succeeded',
    'failed',
    'cancelled'
  ].includes(state) ? state : 'not_materialized'
}

function typedReason(value, fallback) {
  if (value === null || value === undefined || value === '') return null
  const normalized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100)
  return { code: normalized ? `${fallback}.${normalized}` : fallback }
}

function assertNoForbiddenFields(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenFields(item)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key)) throw new Error(`Collaboration Ledger contains forbidden field ${key}`)
    assertNoForbiddenFields(item)
  }
}

function uniqueReferences(references) {
  const seen = new Set()
  return references.filter((reference) => {
    const key = `${reference.artifactId}\u0000${reference.evidenceId}\u0000${reference.path ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function timestampOrNull(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined))
}

function withSha256Prefix(value) {
  if (typeof value !== 'string') throw new Error('sha256 identity is required')
  return value.startsWith('sha256:') ? value : `sha256:${value}`
}

function digest(value) {
  return `sha256:${digestJson(value)}`
}
