import { join } from 'node:path'
import {
  QUALIFICATION_RUNNER_VERSION,
  atomicWriteJson,
  digestJson,
  sha256,
  writePrivateJsonExclusive
} from './qualification-common.mjs'
import { validateQualificationArtifactSchema } from './qualification-schema-validation.mjs'

export const EVIDENCE_INDEX_SCHEMA_ID = 'rovai.qualification.evidence-index'
export const EVIDENCE_INDEX_SCHEMA_VERSION = '1.0.0'

const COMPLETE = Object.freeze({ state: 'complete', reason: null })

export function buildEvidenceIndex({
  trialId,
  evaluationAttemptId = null,
  plannedSlotId,
  suiteId = null,
  caseId,
  caseSeal,
  producerDigest,
  snapshot,
  dispatchBoundary,
  environmentManifest,
  observationDigest,
  observationIntegrityIssues = [],
  executionEvidenceCoverage,
  verifierObservation,
  deliveredWorkspaceSnapshot,
  workspaceDiff,
  deliveryEvidence,
  convergence,
  humanIntervention,
  termination,
  isolationProfile,
  isolationContinuity,
  finalResponses = []
}) {
  const artifactId = `evidence-index:${sha256(`${trialId}:${evaluationAttemptId ?? 'capture'}`).slice(0, 32)}`
  const binding = compactObject({
    suiteId,
    plannedSlotId,
    trialId,
    caseId,
    caseSeal: withSha256Prefix(caseSeal)
  })
  const sourceBoundaries = buildSourceBoundaries({
    snapshot,
    dispatchBoundary,
    environmentManifest,
    observationDigest,
    observationIntegrityIssues,
    executionEvidenceCoverage,
    verifierObservation,
    deliveredWorkspaceSnapshot,
    workspaceDiff,
    deliveryEvidence,
    convergence,
    humanIntervention,
    termination,
    isolationProfile,
    isolationContinuity
  })
  const sourceCoverage = new Map(sourceBoundaries.map((boundary) => [
    boundary.sourceId,
    boundary.coverage
  ]))
  const records = new Map()
  const references = {
    executionEvidence: {},
    messages: {},
    inboxMessages: {},
    conversationInputs: {},
    agentRuns: {},
    events: {},
    workspaceChanges: {},
    verifierChecks: {},
    deliveryChecks: {},
    requirements: {},
    convergenceFacts: {},
    failureFacts: {},
    humanIntervention: null
  }
  const finalResponseIds = new Set(finalResponses.map((message) => message.messageId))

  const addSourceRecord = ({
    evidenceId,
    evidenceType,
    authorityClass,
    sourceId,
    sourceSequence = null,
    observedAt = null,
    clockDomain = null,
    content,
    coverage = sourceCoverage.get(sourceId),
    safeForJudge = false,
    safeForPublic = false
  }) => addRecord(records, {
    evidenceId,
    evidenceType,
    authorityClass,
    sourceId,
    sourceSequence: nonnegativeIntegerOrNull(sourceSequence),
    observedAt: timestampOrNull(observedAt),
    clockDomain,
    coverage: normalizeCoverage(coverage, 'evidence_index.source_coverage_unavailable'),
    contentDigest: digest(content),
    derivedFrom: [],
    derivationRule: null,
    safeForJudge,
    safeForPublic
  })

  addSourceRecord({
    evidenceId: 'core.snapshot-boundary',
    evidenceType: 'core_domain',
    authorityClass: 'core',
    sourceId: 'core.camp-snapshot',
    sourceSequence: snapshot?.throughGlobalSequence,
    content: snapshot ? {
      schemaVersion: snapshot.schemaVersion,
      throughGlobalSequence: snapshot.throughGlobalSequence,
      counts: snapshotCounts(snapshot)
    } : null
  })
  addSourceRecord({
    evidenceId: 'core.event-boundary',
    evidenceType: 'core_domain',
    authorityClass: 'core',
    sourceId: 'core.event-stream',
    sourceSequence: snapshot?.throughGlobalSequence,
    content: snapshot?.timeline ?? null
  })

  if (snapshot) {
    for (const turn of snapshot.turns ?? []) {
      if (turn.id !== dispatchBoundary?.campTurnId) continue
      addSourceRecord({
        evidenceId: stableEvidenceId('core.turn', turn.id),
        evidenceType: 'core_domain',
        authorityClass: 'core',
        sourceId: 'core.camp-snapshot',
        observedAt: turn.endedAt ?? turn.createdAt,
        content: turn
      })
    }
    const trialRunIds = new Set((snapshot.agentRuns ?? [])
      .filter((run) => run.campTurnId === dispatchBoundary?.campTurnId)
      .map((run) => run.id))
    for (const run of snapshot.agentRuns ?? []) {
      if (!trialRunIds.has(run.id)) continue
      addSourceRecord({
        evidenceId: stableEvidenceId('core.run', run.id),
        evidenceType: 'core_domain',
        authorityClass: 'core',
        sourceId: 'core.camp-snapshot',
        observedAt: run.endedAt ?? run.startedAt ?? run.createdAt,
        content: run
      })
      references.agentRuns[run.id] = evidenceReference(
        artifactId,
        stableEvidenceId('core.run', run.id)
      )
    }
    for (const input of snapshot.conversationInputs ?? []) {
      if (input.campTurnId !== dispatchBoundary?.campTurnId) continue
      addSourceRecord({
        evidenceId: stableEvidenceId('core.input', input.id),
        evidenceType: 'core_domain',
        authorityClass: 'core',
        sourceId: 'core.camp-snapshot',
        sourceSequence: input.sequence,
        observedAt: input.terminalAt ?? input.materializedAt ?? input.createdAt,
        content: input
      })
      references.conversationInputs[input.id] = evidenceReference(
        artifactId,
        stableEvidenceId('core.input', input.id)
      )
    }
    for (const approval of snapshot.approvals ?? []) {
      addSourceRecord({
        evidenceId: stableEvidenceId('core.approval', approval.id),
        evidenceType: 'core_domain',
        authorityClass: 'core',
        sourceId: 'core.camp-snapshot',
        observedAt: approval.resolvedAt ?? approval.createdAt,
        content: approval
      })
    }
    for (const message of snapshot.messages ?? []) {
      const evidenceId = stableEvidenceId('core.message', message.id)
      const isFinalResponse = finalResponseIds.has(message.id)
      addSourceRecord({
        evidenceId,
        evidenceType: isFinalResponse ? 'final_response' : 'core_domain',
        authorityClass: 'core',
        sourceId: 'core.camp-snapshot',
        sourceSequence: message.sequence,
        observedAt: message.createdAt,
        content: message,
        safeForJudge: isFinalResponse,
        safeForPublic: false
      })
      references.messages[message.id] = evidenceReference(artifactId, evidenceId)
    }
    for (const message of snapshot.inboxMessages ?? []) {
      if (!trialRunIds.has(message.sourceAgentRunId)
          && !trialRunIds.has(message.targetAgentRunId)) continue
      addSourceRecord({
        evidenceId: stableEvidenceId('core.inbox', message.id),
        evidenceType: 'core_domain',
        authorityClass: 'core',
        sourceId: 'core.camp-snapshot',
        sourceSequence: message.timelineGlobalSequence,
        observedAt: message.deliveredAt ?? message.failedAt ?? message.createdAt,
        content: message
      })
      references.inboxMessages[message.id] = evidenceReference(
        artifactId,
        stableEvidenceId('core.inbox', message.id)
      )
    }
    for (const task of snapshot.tasks ?? []) {
      if (!trialRunIds.has(task.sourceAgentRunId)) continue
      addSourceRecord({
        evidenceId: stableEvidenceId('core.task', task.id),
        evidenceType: 'core_domain',
        authorityClass: 'core',
        sourceId: 'core.camp-snapshot',
        observedAt: task.completedAt ?? task.updatedAt ?? task.createdAt,
        content: task
      })
    }
    for (const action of snapshot.actions ?? []) {
      if (!trialRunIds.has(action.agentRunId)) continue
      addSourceRecord({
        evidenceId: stableEvidenceId('core.action', action.id),
        evidenceType: 'core_domain',
        authorityClass: 'core',
        sourceId: 'core.camp-snapshot',
        observedAt: action.endedAt ?? action.startedAt ?? action.createdAt,
        content: action
      })
    }
    for (const event of snapshot.timeline ?? []) {
      const nativeId = event.eventId ?? `sequence-${event.globalSequence}`
      addSourceRecord({
        evidenceId: stableEvidenceId('core.event', nativeId),
        evidenceType: 'core_domain',
        authorityClass: 'core',
        sourceId: 'core.event-stream',
        sourceSequence: event.globalSequence,
        observedAt: event.createdAt,
        content: event
      })
      references.events[nativeId] = evidenceReference(
        artifactId,
        stableEvidenceId('core.event', nativeId)
      )
    }
    for (const evidence of snapshot.executionEvidence ?? []) {
      if (!trialRunIds.has(evidence.agentRunId)) continue
      const evidenceId = stableEvidenceId('runtime.evidence', evidence.id)
      const persistedCoverage = sourceCoverage.get('core.agent-run-execution-evidence')
      const coverage = evidence.isTruncated
        ? { state: 'partial', reason: { code: 'evidence_index.runtime_activity_truncated' } }
        : persistedCoverage
      addSourceRecord({
        evidenceId,
        evidenceType: 'runtime_activity',
        authorityClass: (evidence.safeIdentity?.sourceAuthority ?? evidence.payload?.sourceAuthority) === 'core'
          ? 'core'
          : 'runtime',
        sourceId: 'core.agent-run-execution-evidence',
        sourceSequence: evidence.sequence,
        observedAt: evidence.occurredAt,
        clockDomain: 'core_persisted_wall_clock',
        content: evidence,
        coverage,
        safeForJudge: true,
        safeForPublic: false
      })
      references.executionEvidence[evidence.id] = evidenceReference(artifactId, evidenceId)
    }
  }

  addSourceRecord({
    evidenceId: 'runner.environment-manifest',
    evidenceType: 'runner_environment',
    authorityClass: 'runner',
    sourceId: 'runner.environment',
    observedAt: environmentManifest?.collectedAt,
    clockDomain: 'runner_wall_clock',
    content: environmentManifest ?? null
  })
  addSourceRecord({
    evidenceId: 'runner.dispatch-boundary',
    evidenceType: 'runner_environment',
    authorityClass: 'runner',
    sourceId: 'runner.lifecycle',
    observedAt: dispatchBoundary?.runnerObservedAcceptedAt,
    clockDomain: 'runner_wall_clock',
    content: dispatchBoundary ?? null
  })
  addSourceRecord({
    evidenceId: 'runner.runtime-termination',
    evidenceType: 'runner_environment',
    authorityClass: 'runner',
    sourceId: 'runner.lifecycle',
    content: termination ?? null
  })
  addSourceRecord({
    evidenceId: 'runner.intervention-isolation',
    evidenceType: 'runner_environment',
    authorityClass: 'runner',
    sourceId: 'runner.environment',
    content: { isolationProfile: isolationProfile ?? null, isolationContinuity: isolationContinuity ?? null }
  })
  addSourceRecord({
    evidenceId: 'runner.delivered-workspace-boundary',
    evidenceType: 'workspace_fact',
    authorityClass: 'runner',
    sourceId: 'runner.workspace',
    content: { deliveredWorkspaceSnapshot: deliveredWorkspaceSnapshot ?? null, workspaceDiff: workspaceDiff ?? null }
  })
  if (deliveredWorkspaceSnapshot || workspaceDiff) {
    for (const change of workspaceDiff?.changed ?? []) {
      const evidenceId = `runner.workspace-change:${sha256(change.path).slice(0, 32)}`
      addSourceRecord({
        evidenceId,
        evidenceType: 'workspace_fact',
        authorityClass: 'runner',
        sourceId: 'runner.workspace',
        content: change
      })
      references.workspaceChanges[change.path] = evidenceReference(artifactId, evidenceId)
    }
  }

  addSourceRecord({
    evidenceId: 'verifier.observation-boundary',
    evidenceType: 'verifier_check',
    authorityClass: 'verifier',
    sourceId: 'verifier.observation',
    content: verifierObservation ?? null,
    safeForJudge: false,
    safeForPublic: false
  })

  for (const check of verifierObservation?.checkResults ?? []) {
    const evidenceId = stableEvidenceId('verifier.check', check.checkId)
    addSourceRecord({
      evidenceId,
      evidenceType: 'verifier_check',
      authorityClass: 'verifier',
      sourceId: 'verifier.observation',
      content: check,
      safeForJudge: check.disclosure === 'public',
      safeForPublic: check.disclosure === 'public'
    })
    references.verifierChecks[check.checkId] = evidenceReference(artifactId, evidenceId)
  }

  const addDerivedRecord = ({ evidenceId, content, derivedFrom, safeForJudge = true, safeForPublic = true }) => {
    const normalizedReferences = uniqueReferences(derivedFrom)
    const coverage = combineCoverage(normalizedReferences.map((reference) => (
      records.get(reference.evidenceId)?.coverage
    )))
    addRecord(records, {
      evidenceId,
      evidenceType: 'derived_fact',
      authorityClass: 'derived',
      sourceId: 'derived.qualification-evaluator',
      sourceSequence: null,
      observedAt: null,
      clockDomain: null,
      coverage,
      contentDigest: digest(content),
      derivedFrom: normalizedReferences,
      derivationRule: null,
      safeForJudge,
      safeForPublic
    })
    return evidenceReference(artifactId, evidenceId)
  }

  for (const check of deliveryEvidence?.checkResults ?? []) {
    const inputs = check.observationAuthority === 'verifier'
      ? [references.verifierChecks[check.checkId]
          ?? evidenceReference(artifactId, 'verifier.observation-boundary')]
      : [evidenceReference(artifactId, 'runner.delivered-workspace-boundary')]
    const evidenceId = stableEvidenceId('derived.check', check.checkId)
    references.deliveryChecks[check.checkId] = addDerivedRecord({
      evidenceId,
      content: check,
      derivedFrom: inputs,
      safeForJudge: check.disclosure === 'public',
      safeForPublic: check.disclosure === 'public'
    })
  }
  for (const requirement of deliveryEvidence?.requirements ?? []) {
    const inputs = requirement.checkIds
      .map((checkId) => references.deliveryChecks[checkId])
      .filter(Boolean)
    const evidenceId = stableEvidenceId('derived.requirement', requirement.requirementId)
    references.requirements[requirement.requirementId] = addDerivedRecord({
      evidenceId,
      content: requirement,
      derivedFrom: inputs
    })
  }

  const convergenceInputs = [
    'core.snapshot-boundary',
    'core.event-boundary',
    'runner.runtime-termination',
    'runner.intervention-isolation'
  ].filter((evidenceId) => records.has(evidenceId)).map((evidenceId) => (
    evidenceReference(artifactId, evidenceId)
  ))
  for (const [fact, state] of Object.entries(convergence?.facts ?? {})) {
    const evidenceId = stableEvidenceId('derived.convergence', fact)
    references.convergenceFacts[fact] = addDerivedRecord({
      evidenceId,
      content: { fact, state },
      derivedFrom: convergenceInputs
    })
  }
  if (humanIntervention) {
    const humanInputs = ['core.snapshot-boundary', 'core.event-boundary', 'runner.intervention-isolation']
      .filter((evidenceId) => records.has(evidenceId))
      .map((evidenceId) => evidenceReference(artifactId, evidenceId))
    references.humanIntervention = addDerivedRecord({
      evidenceId: 'derived.human-intervention',
      content: humanIntervention,
      derivedFrom: humanInputs
    })
  }
  for (const failure of deliveryEvidence?.failureFacts ?? []) {
    const derivedFrom = uniqueReferences([
      ...Object.values(references.requirements),
      ...Object.values(references.convergenceFacts),
      references.humanIntervention
    ].filter(Boolean))
    const evidenceId = stableEvidenceId('derived.failure', failure.failureFactId)
    references.failureFacts[failure.failureFactId] = addDerivedRecord({
      evidenceId,
      content: failure,
      derivedFrom: derivedFrom.length > 0
        ? derivedFrom
        : [evidenceReference(artifactId, 'runner.delivered-workspace-boundary')]
    })
  }

  const payload = {
    records: [...records.values()].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId))
  }
  const artifact = {
    artifactId,
    schemaId: EVIDENCE_INDEX_SCHEMA_ID,
    schemaVersion: EVIDENCE_INDEX_SCHEMA_VERSION,
    producer: {
      id: 'rovai-qualification-runner',
      version: QUALIFICATION_RUNNER_VERSION,
      digest: withSha256Prefix(producerDigest)
    },
    binding,
    sourceBoundaries,
    payloadDigest: digest(payload),
    payload
  }
  validateEvidenceIndex(artifact)
  return { artifact, references }
}

export async function retainEvidenceIndexArtifact(evidenceDirectory, artifact) {
  validateEvidenceIndex(artifact)
  const locator = join('evidence-indexes', `${artifact.artifactId}.json`)
  await writePrivateJsonExclusive(join(evidenceDirectory, locator), artifact)
  await atomicWriteJson(join(evidenceDirectory, 'evidence-index.json'), artifact)
  return {
    artifactId: artifact.artifactId,
    schemaId: artifact.schemaId,
    schemaVersion: artifact.schemaVersion,
    payloadDigest: artifact.payloadDigest,
    locator,
    recordCount: artifact.payload.records.length,
    sourceBoundaries: artifact.sourceBoundaries.map((boundary) => ({
      authorityClass: boundary.authorityClass,
      sourceId: boundary.sourceId,
      coverage: boundary.coverage
    }))
  }
}

export function bindToolEvidenceReferences(toolEvidence, executionEvidenceReferences) {
  return {
    ...toolEvidence,
    ledger: (toolEvidence?.ledger ?? []).map((record) => ({
      ...record,
      authorization: {
        ...record.authorization,
        evidenceReference: record.authorization.evidenceId
          ? executionEvidenceReferences[record.authorization.evidenceId] ?? null
          : null
      },
      evidenceReferences: (record.sourceEvidenceIds ?? [])
        .map((evidenceId) => executionEvidenceReferences[evidenceId])
        .filter(Boolean)
    }))
  }
}

export function validateEvidenceIndex(artifact) {
  if (artifact?.schemaId !== EVIDENCE_INDEX_SCHEMA_ID
      || artifact.schemaVersion !== EVIDENCE_INDEX_SCHEMA_VERSION
      || artifact.payloadDigest !== digest(artifact.payload)) {
    throw new Error('Evidence Index envelope identity is invalid')
  }
  const boundaries = new Map()
  for (const boundary of artifact.sourceBoundaries ?? []) {
    if (boundaries.has(boundary.sourceId)) throw new Error('Evidence Index source boundary IDs are not unique')
    boundaries.set(boundary.sourceId, boundary)
  }
  if (boundaries.size === 0) throw new Error('Evidence Index has no source boundary')
  const records = new Map()
  for (const record of artifact.payload?.records ?? []) {
    if (records.has(record.evidenceId)) throw new Error('Evidence Index evidence IDs are not unique')
    if (!boundaries.has(record.sourceId)) throw new Error(`Evidence Index record has unknown source ${record.sourceId}`)
    records.set(record.evidenceId, record)
  }
  for (const record of records.values()) {
    for (const reference of record.derivedFrom ?? []) {
      if (reference.artifactId !== artifact.artifactId || !records.has(reference.evidenceId)) {
        throw new Error(`Evidence Index has unresolved reference ${reference.evidenceId}`)
      }
    }
    if (record.authorityClass === 'derived') {
      if (!Array.isArray(record.derivedFrom) || record.derivedFrom.length === 0) {
        throw new Error(`Derived Evidence Index record ${record.evidenceId} has no source reference`)
      }
      const expected = combineCoverage(record.derivedFrom.map((reference) => (
        records.get(reference.evidenceId).coverage
      )))
      if (digestJson(expected) !== digestJson(record.coverage)) {
        throw new Error(`Derived Evidence Index record ${record.evidenceId} elevated source coverage`)
      }
    }
  }
  validateQualificationArtifactSchema('evidence-index.schema.json', artifact)
  return artifact
}

function buildSourceBoundaries(input) {
  const eventIssue = input.observationIntegrityIssues.find((issue) => (
    typeof issue.code === 'string' && issue.code.startsWith('event_coverage.')
  ))
  const eventCoverage = input.snapshot && !eventIssue
    ? COMPLETE
    : { state: 'partial', reason: { code: eventIssue?.code ?? 'evidence_index.event_stream_unavailable' } }
  const verifierCoverage = input.verifierObservation?.validationState === 'valid'
    ? COMPLETE
    : {
        state: 'unavailable',
        reason: {
          code: input.verifierObservation?.validationErrors?.[0]?.code
            ?? 'evidence_index.verifier_observation_unavailable'
        }
      }
  const boundaries = [
    sourceBoundary('core', 'core.camp-snapshot', input.snapshot, {
      throughSequence: input.snapshot?.throughGlobalSequence,
      clockDomain: 'core_persisted_wall_clock',
      coverage: input.snapshot ? COMPLETE : unavailable('evidence_index.snapshot_unavailable')
    }),
    sourceBoundary('core', 'core.event-stream', input.snapshot?.timeline, {
      throughSequence: input.snapshot?.throughGlobalSequence,
      declaredTotal: input.snapshot?.timeline?.length,
      clockDomain: 'core_persisted_wall_clock',
      coverage: eventCoverage
    }),
    sourceBoundary('core', 'core.agent-run-execution-evidence', input.snapshot?.executionEvidence, {
      declaredTotal: input.executionEvidenceCoverage?.declaredTotal,
      clockDomain: 'core_persisted_wall_clock',
      coverage: input.executionEvidenceCoverage?.coverage
        ?? unavailable('evidence_index.execution_evidence_unavailable')
    }),
    sourceBoundary('runner', 'runner.environment', {
      environmentManifest: input.environmentManifest,
      isolationProfile: input.isolationProfile,
      isolationContinuity: input.isolationContinuity
    }, {
      clockDomain: 'runner_wall_clock',
      coverage: input.environmentManifest ? COMPLETE : unavailable('evidence_index.environment_unavailable')
    }),
    sourceBoundary('runner', 'runner.lifecycle', {
      dispatchBoundary: input.dispatchBoundary,
      observationDigest: input.observationDigest,
      termination: input.termination
    }, {
      clockDomain: 'runner_wall_clock',
      coverage: input.dispatchBoundary && input.termination
        ? COMPLETE
        : unavailable('evidence_index.lifecycle_unavailable')
    }),
    sourceBoundary('runner', 'runner.workspace', {
      deliveredWorkspaceSnapshot: input.deliveredWorkspaceSnapshot,
      workspaceDiff: input.workspaceDiff
    }, {
      coverage: input.deliveredWorkspaceSnapshot && input.workspaceDiff
        ? COMPLETE
        : unavailable('evidence_index.workspace_unavailable')
    }),
    sourceBoundary('verifier', 'verifier.observation', input.verifierObservation, {
      coverage: verifierCoverage
    }),
    sourceBoundary('derived', 'derived.qualification-evaluator', {
      deliveryEvidence: input.deliveryEvidence,
      convergence: input.convergence,
      humanIntervention: input.humanIntervention
    }, {
      coverage: input.deliveryEvidence && input.convergence && input.humanIntervention
        ? COMPLETE
        : unavailable('evidence_index.derived_facts_unavailable')
    })
  ]
  return boundaries.sort((left, right) => left.sourceId.localeCompare(right.sourceId))
}

function sourceBoundary(authorityClass, sourceId, content, options) {
  return {
    authorityClass,
    sourceId,
    digest: digest(content ?? null),
    throughSequence: nonnegativeIntegerOrNull(options.throughSequence),
    declaredTotal: nonnegativeIntegerOrNull(options.declaredTotal),
    clockDomain: options.clockDomain ?? null,
    coverage: normalizeCoverage(options.coverage, 'evidence_index.source_coverage_unavailable')
  }
}

function addRecord(records, record) {
  if (records.has(record.evidenceId)) throw new Error(`duplicate Evidence Index ID ${record.evidenceId}`)
  records.set(record.evidenceId, record)
  return record
}

function evidenceReference(artifactId, evidenceId) {
  return { artifactId, evidenceId }
}

function uniqueReferences(references) {
  const seen = new Set()
  return references.filter((reference) => {
    if (!reference) return false
    const key = `${reference.artifactId}\u0000${reference.evidenceId}\u0000${reference.path ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function combineCoverage(coverages) {
  if (!Array.isArray(coverages) || coverages.length === 0 || coverages.some((item) => !item)) {
    return unavailable('evidence_index.derivation_source_unavailable')
  }
  if (coverages.some((item) => item.state === 'unavailable')) {
    return unavailable('evidence_index.derivation_source_unavailable')
  }
  if (coverages.some((item) => item.state === 'partial')) {
    return { state: 'partial', reason: { code: 'evidence_index.derivation_source_partial' } }
  }
  if (coverages.every((item) => item.state === 'not_applicable')) {
    return { state: 'not_applicable', reason: { code: 'evidence_index.derivation_not_applicable' } }
  }
  if (coverages.some((item) => item.state === 'not_applicable')) {
    return { state: 'partial', reason: { code: 'evidence_index.derivation_source_not_applicable' } }
  }
  return { state: 'complete', reason: null }
}

function normalizeCoverage(coverage, fallbackCode) {
  if (coverage?.state === 'complete') return { state: 'complete', reason: null }
  if (['partial', 'unavailable', 'not_applicable'].includes(coverage?.state)) {
    return {
      state: coverage.state,
      reason: { code: coverage.reason?.code ?? fallbackCode }
    }
  }
  return unavailable(fallbackCode)
}

function unavailable(code) {
  return { state: 'unavailable', reason: { code } }
}

function snapshotCounts(snapshot) {
  return Object.fromEntries([
    'turns',
    'agentRuns',
    'tasks',
    'messages',
    'inboxMessages',
    'conversationInputs',
    'approvals',
    'actions',
    'executionEvidence',
    'timeline'
  ].map((field) => [field, Array.isArray(snapshot[field]) ? snapshot[field].length : 0]))
}

function stableEvidenceId(prefix, nativeId) {
  const candidate = `${prefix}:${nativeId}`
  return candidate.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(candidate)
    ? candidate
    : `${prefix}:${sha256(String(nativeId)).slice(0, 40)}`
}

function withSha256Prefix(value) {
  if (typeof value !== 'string') throw new Error('sha256 identity is required')
  return value.startsWith('sha256:') ? value : `sha256:${value}`
}

function digest(value) {
  return `sha256:${digestJson(value)}`
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined))
}

function nonnegativeIntegerOrNull(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function timestampOrNull(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}
