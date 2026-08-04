import { join } from 'node:path'
import {
  QUALIFICATION_RUNNER_VERSION,
  atomicWriteJson,
  digestJson,
  sha256,
  writePrivateJsonExclusive
} from './qualification-common.mjs'
import { validateQualificationArtifactSchema } from './qualification-schema-validation.mjs'

export const TOOL_CALL_LEDGER_SCHEMA_ID = 'rovai.qualification.tool-call-ledger'
export const TOOL_CALL_LEDGER_SCHEMA_VERSION = '1.1.0'

export function buildToolCallLedger({
  trialId,
  evaluationAttemptId = null,
  plannedSlotId,
  suiteId = null,
  caseId,
  caseSeal,
  producerDigest,
  toolEvidence,
  evidenceIndex
}) {
  const artifactId = `tool-call-ledger:${sha256(`${trialId}:${evaluationAttemptId ?? 'capture'}`).slice(0, 32)}`
  const evidenceIds = new Set(evidenceIndex.payload.records.map((record) => record.evidenceId))
  let incompleteRecords = 0
  const records = []
  for (const record of toolEvidence?.ledger ?? []) {
    const evidenceReferences = uniqueReferences(record.evidenceReferences ?? [])
    if (evidenceReferences.length === 0 || evidenceReferences.some((reference) => (
      reference.artifactId !== evidenceIndex.artifactId || !evidenceIds.has(reference.evidenceId)
    ))) {
      incompleteRecords += 1
      continue
    }
    const authorizationReference = record.authorization?.evidenceReference ?? null
    if (authorizationReference
        && (authorizationReference.artifactId !== evidenceIndex.artifactId
          || !evidenceIds.has(authorizationReference.evidenceId))) {
      incompleteRecords += 1
      continue
    }
    records.push({
      toolCallId: record.toolCallId,
      agentRunId: record.agentRunId ?? null,
      authorityClass: normalizeAuthorityClass(record.authorityClass),
      operationClass: normalizeOperationClass(record.operationClass),
      canonicalTool: record.canonicalTool ?? null,
      nativeTool: boundedStringOrNull(record.nativeTool) ?? 'runtimeToolCall',
      lifecycle: {
        state: normalizeLifecycle(record.lifecycle?.state),
        error: record.lifecycle?.error ? {
          class: normalizeErrorClass(record.lifecycle.error.class),
          code: stableCode(record.lifecycle.error.code, 'tool_ledger.unknown_error')
        } : null
      },
      authorization: {
        decision: normalizeAuthorizationDecision(record.authorization?.decision),
        authority: normalizeAuthorizationAuthority(record.authorization?.authority),
        evidenceReference: authorizationReference
      },
      timing: {
        requestedAt: timestampOrNull(record.timing?.requestedAt),
        startedAt: timestampOrNull(record.timing?.startedAt),
        endedAt: timestampOrNull(record.timing?.endedAt),
        clockDomain: typeof record.timing?.clockDomain === 'string'
          ? record.timing.clockDomain.slice(0, 160)
          : null,
        latencyMilliseconds: nonnegativeNumberOrNull(record.timing?.latencyMilliseconds)
      },
      retryRelation: normalizeRetryRelation(record.retryRelation),
      receiptId: boundedStringOrNull(record.receiptId),
      sideEffectIdentity: boundedStringOrNull(record.sideEffectIdentity),
      duplicateEffect: normalizeDuplicateEffect(record.duplicateEffect),
      mutationIntent: normalizeMutationIntent(record.mutationIntent),
      verificationReferences: validReferences(
        record.verificationReferences,
        evidenceIndex.artifactId,
        evidenceIds
      ),
      directFailureFactReference: validOptionalReference(
        record.directFailureFactReference,
        evidenceIndex.artifactId,
        evidenceIds
      ),
      fieldCoverage: normalizeFieldCoverage(record.fieldCoverage),
      evidenceReferences
    })
  }
  records.sort((left, right) => left.toolCallId.localeCompare(right.toolCallId))
  const declaredCoverage = normalizeCoverage(toolEvidence?.coverage, 'tool_ledger.source_coverage_unavailable')
  const coverage = incompleteRecords === 0
    ? declaredCoverage
    : {
        state: 'partial',
        reason: { code: 'tool_ledger.evidence_reference_coverage_incomplete' }
      }
  const authoritative = toolEvidence?.summary?.authoritativeTotals ?? {}
  const complete = coverage.state === 'complete'
  const payload = {
    records,
    summary: {
      coverage,
      total: complete ? nonnegativeIntegerOrNull(authoritative.logicalToolCalls) : null,
      succeeded: complete ? nonnegativeIntegerOrNull(authoritative.succeeded) : null,
      failed: complete ? nonnegativeIntegerOrNull(authoritative.failed) : null,
      denied: complete ? nonnegativeIntegerOrNull(authoritative.denied) : null,
      retries: complete ? nonnegativeIntegerOrNull(authoritative.retries) : null,
      idempotentReplays: complete ? nonnegativeIntegerOrNull(authoritative.idempotentReplays) : null,
      provenDuplicateEffects: complete
        ? nonnegativeIntegerOrNull(authoritative.provenDuplicateEffects)
        : null,
      mutationVerification: normalizeMutationVerification(
        toolEvidence?.summary?.mutationVerification
      )
    }
  }
  const artifact = {
    artifactId,
    schemaId: TOOL_CALL_LEDGER_SCHEMA_ID,
    schemaVersion: TOOL_CALL_LEDGER_SCHEMA_VERSION,
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
        'core.agent-run-execution-evidence',
        'core.camp-snapshot',
        'derived.qualification-evaluator'
      ].includes(boundary.sourceId))
      .map((boundary) => structuredClone(boundary)),
    payloadDigest: digest(payload),
    payload
  }
  validateToolCallLedger(artifact, evidenceIndex)
  validateQualificationArtifactSchema('tool-call-ledger.schema.json', artifact)
  return artifact
}

export async function retainToolCallLedgerArtifact(evidenceDirectory, artifact, evidenceIndex) {
  validateToolCallLedger(artifact, evidenceIndex)
  const locator = join('tool-call-ledgers', `${artifact.artifactId}.json`)
  await writePrivateJsonExclusive(join(evidenceDirectory, locator), artifact)
  await atomicWriteJson(join(evidenceDirectory, 'tool-call-ledger.json'), artifact)
  return {
    artifactId: artifact.artifactId,
    schemaId: artifact.schemaId,
    schemaVersion: artifact.schemaVersion,
    payloadDigest: artifact.payloadDigest,
    locator,
    recordCount: artifact.payload.records.length,
    summary: artifact.payload.summary
  }
}

export function validateToolCallLedger(artifact, evidenceIndex) {
  if (artifact?.schemaId !== TOOL_CALL_LEDGER_SCHEMA_ID
      || artifact.schemaVersion !== TOOL_CALL_LEDGER_SCHEMA_VERSION
      || artifact.payloadDigest !== digest(artifact.payload)) {
    throw new Error('Tool Call Ledger envelope identity is invalid')
  }
  const evidenceIds = new Set(evidenceIndex?.payload?.records?.map((record) => record.evidenceId) ?? [])
  const toolCallIds = new Set()
  for (const record of artifact.payload.records) {
    if (toolCallIds.has(record.toolCallId)) throw new Error('Tool Call Ledger Tool Call IDs are not unique')
    toolCallIds.add(record.toolCallId)
    for (const reference of [
      ...record.evidenceReferences,
      ...record.verificationReferences,
      record.authorization.evidenceReference,
      record.directFailureFactReference
    ].filter(Boolean)) {
      if (reference.artifactId !== evidenceIndex.artifactId || !evidenceIds.has(reference.evidenceId)) {
        throw new Error('Tool Call Ledger has an unresolved Evidence Reference')
      }
    }
    if (record.canonicalTool !== null && record.authorityClass !== 'core') {
      throw new Error('Tool Call Ledger elevated a non-Core canonical Tool identity')
    }
    if (record.retryRelation.kind === 'indeterminate'
        && (record.retryRelation.originalToolCallId !== null
          || record.retryRelation.idempotencyIdentity !== null)) {
      throw new Error('Tool Call Ledger indeterminate retry relation invented an identity')
    }
    if (record.retryRelation.kind === 'idempotent_replay'
        && record.retryRelation.originalToolCallId === null) {
      throw new Error('Tool Call Ledger idempotent replay has no original Tool Call')
    }
    if (record.duplicateEffect === 'proven_duplicate' && record.sideEffectIdentity === null) {
      throw new Error('Tool Call Ledger duplicate effect has no authoritative effect identity')
    }
  }
  const summary = artifact.payload.summary
  if (summary.coverage.state === 'complete') {
    const expected = {
      total: artifact.payload.records.length,
      succeeded: artifact.payload.records.filter((record) => record.lifecycle.state === 'succeeded').length,
      failed: artifact.payload.records.filter((record) => record.lifecycle.state === 'failed').length,
      denied: artifact.payload.records.filter((record) => record.lifecycle.state === 'denied').length,
      retries: artifact.payload.records.filter((record) => record.retryRelation.kind === 'retry').length,
      idempotentReplays: artifact.payload.records.filter(
        (record) => record.retryRelation.kind === 'idempotent_replay'
      ).length,
      provenDuplicateEffects: artifact.payload.records.filter(
        (record) => record.duplicateEffect === 'proven_duplicate'
      ).length
    }
    if (Object.entries(expected).some(([field, value]) => summary[field] !== value)) {
      throw new Error('Tool Call Ledger complete summary disagrees with records')
    }
  } else if ([
    summary.total,
    summary.succeeded,
    summary.failed,
    summary.denied,
    summary.retries,
    summary.idempotentReplays,
    summary.provenDuplicateEffects
  ].some((value) => value !== null)) {
    throw new Error('Tool Call Ledger partial summary cannot publish authoritative totals')
  }
  validateQualificationArtifactSchema('tool-call-ledger.schema.json', artifact)
  return artifact
}

function normalizeRetryRelation(relation) {
  if (relation?.kind === 'original') {
    return {
      kind: 'original',
      originalToolCallId: null,
      idempotencyIdentity: boundedStringOrNull(relation.idempotencyIdentity)
    }
  }
  if (relation?.kind === 'retry_observed' || relation?.kind === 'retry') {
    return {
      kind: 'retry',
      originalToolCallId: boundedStringOrNull(relation.originalToolCallId),
      idempotencyIdentity: boundedStringOrNull(relation.idempotencyIdentity)
    }
  }
  if (relation?.kind === 'idempotent_replay_observed' || relation?.kind === 'idempotent_replay') {
    return {
      kind: 'idempotent_replay',
      originalToolCallId: boundedStringOrNull(relation.originalToolCallId),
      idempotencyIdentity: boundedStringOrNull(relation.idempotencyIdentity)
    }
  }
  return { kind: 'indeterminate', originalToolCallId: null, idempotencyIdentity: null }
}

function normalizeFieldCoverage(value) {
  return Object.fromEntries([
    'identity',
    'lifecycle',
    'authorization',
    'timing',
    'retry',
    'receipt',
    'sideEffect',
    'mutation',
    'verification'
  ].map((field) => [
    field,
    normalizeCoverage(value?.[field], `tool_ledger.${field}_coverage_unavailable`)
  ]))
}

function normalizeCoverage(value, fallbackCode) {
  if (value?.state === 'complete') return { state: 'complete', reason: null }
  if (['partial', 'unavailable', 'not_applicable'].includes(value?.state)) {
    return {
      state: value.state,
      reason: { code: stableCode(value.reason?.code, fallbackCode) }
    }
  }
  return { state: 'unavailable', reason: { code: fallbackCode } }
}

function normalizeAuthorityClass(value) {
  return ['core', 'runtime', 'runner', 'derived'].includes(value) ? value : 'derived'
}

function normalizeOperationClass(value) {
  return [
    'core_tool',
    'shell',
    'file',
    'git',
    'test',
    'build',
    'external_mcp',
    'other_runtime'
  ].includes(value) ? value : 'other_runtime'
}

function normalizeLifecycle(value) {
  return [
    'requested',
    'denied',
    'accepted',
    'started',
    'succeeded',
    'failed',
    'cancelled',
    'indeterminate'
  ].includes(value) ? value : 'indeterminate'
}

function normalizeErrorClass(value) {
  return [
    'authorization',
    'validation',
    'transport',
    'timeout',
    'tool',
    'runtime',
    'external_effect',
    'unknown'
  ].includes(value) ? value : 'unknown'
}

function normalizeAuthorizationDecision(value) {
  return ['allowed', 'denied', 'indeterminate', 'not_applicable'].includes(value)
    ? value
    : 'indeterminate'
}

function normalizeAuthorizationAuthority(value) {
  return ['core', 'runtime', 'external_provider', 'unknown'].includes(value) ? value : 'unknown'
}

function normalizeDuplicateEffect(value) {
  return ['proven_duplicate', 'not_proven', 'indeterminate', 'not_applicable'].includes(value)
    ? value
    : 'indeterminate'
}

function normalizeMutationIntent(value) {
  return ['yes', 'no', 'indeterminate'].includes(value) ? value : 'indeterminate'
}

function normalizeMutationVerification(value) {
  return ['complete', 'partial', 'none_observed', 'indeterminate', 'not_applicable'].includes(value)
    ? value
    : 'indeterminate'
}

function validReferences(values, artifactId, evidenceIds) {
  return uniqueReferences(Array.isArray(values) ? values : []).filter((reference) => (
    reference.artifactId === artifactId && evidenceIds.has(reference.evidenceId)
  ))
}

function validOptionalReference(value, artifactId, evidenceIds) {
  return value?.artifactId === artifactId && evidenceIds.has(value.evidenceId) ? value : null
}

function uniqueReferences(references) {
  const seen = new Set()
  return references.filter((reference) => {
    if (!reference || typeof reference !== 'object') return false
    const key = `${reference.artifactId}\u0000${reference.evidenceId}\u0000${reference.path ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function stableCode(value, fallback) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
    ? value
    : fallback
}

function boundedStringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 240) : null
}

function timestampOrNull(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function nonnegativeNumberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function nonnegativeIntegerOrNull(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
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
