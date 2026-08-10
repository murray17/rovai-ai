import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  QUALIFICATION_RUNNER_VERSION,
  atomicWriteJson,
  canonicalJson,
  digestJson,
  sha256,
  writePrivateJsonExclusive
} from './qualification-common.mjs'
import { validateQualificationArtifactSchema } from './qualification-schema-validation.mjs'

export const PUBLIC_BENCHMARK_REPORT_SCHEMA_ID = 'rovai.qualification.public-benchmark-report'
export const PUBLIC_BENCHMARK_REPORT_SCHEMA_VERSION = '1.0.0'

const FORBIDDEN_PUBLIC_KEYS = new Set([
  'locator',
  'credentials',
  'credential',
  'environmentValues',
  'command',
  'body',
  'hiddenReasoning',
  'referenceImplementation',
  'sealedPackLocator',
  'compositeScore',
  'overallScore',
  'rank',
  'passAtK'
])

export function buildPublicBenchmarkReport({
  result,
  caseTitle = 'Unavailable Qualification Case',
  producerDigest,
  evidenceIndex = null,
  collaborationLedger = null,
  toolCallLedger = null,
  workspaceMutationLedger = null,
  generatedAt = result?.resultRevision?.recordedAt ?? result?.completedAt
}) {
  if (!validTimestamp(generatedAt)) throw new Error('Public Benchmark Report generatedAt is invalid')
  const identity = sha256(`${result.trialId}:${result.resultRevision?.revisionId ?? 'capture'}`).slice(0, 32)
  const hard = hardOutcomeLayer(result)
  const layer2Delivery = deliveryLayer(result, evidenceIndex)
  const layer3Collaboration = collaborationLayer(
    result,
    collaborationLedger,
    workspaceMutationLedger
  )
  const layer4ToolAndMutation = toolAndMutationLayer(
    result,
    toolCallLedger,
    workspaceMutationLedger
  )
  const layer5SemanticReview = semanticLayer(result.semanticEngineeringReview)
  const payload = {
    reportId: `public-report:${identity}`,
    reportClass: result.mode === 'formal' ? 'formal' : 'diagnostic',
    generatedAt,
    case: {
      caseId: result.case?.id ?? 'UNKNOWN',
      caseVersion: result.case?.version ?? 'unavailable',
      title: boundedText(caseTitle, 'Unavailable Qualification Case', 240)
    },
    layer1HardOutcome: hard,
    layer2Delivery,
    layer3Collaboration,
    layer4ToolAndMutation,
    layer5SemanticReview,
    limitations: [
      'Hard Outcome is the only qualification authority; Semantic Review cannot change it.',
      'Partial or unavailable evidence is not converted into zero, false, success, or failure.',
      'Private artifact locators, raw commands, message bodies, credentials, and withheld verifier details are not exported.'
    ]
  }
  const sourceProjection = {
    trialId: result.trialId,
    resultRevisionId: result.resultRevision?.revisionId ?? null,
    hard,
    evidenceIndex: artifactIdentity(result.evidenceIndex),
    collaborationLedger: artifactIdentity(result.collaborationLedger),
    toolCallLedger: artifactIdentity(result.toolCallLedger),
    workspaceMutationLedger: artifactIdentity(result.workspaceMutationLedger),
    semanticReviewState: layer5SemanticReview.state
  }
  const artifact = {
    artifactId: `public-benchmark-report:${identity}`,
    schemaId: PUBLIC_BENCHMARK_REPORT_SCHEMA_ID,
    schemaVersion: PUBLIC_BENCHMARK_REPORT_SCHEMA_VERSION,
    producer: {
      id: 'rovai-qualification-runner',
      version: QUALIFICATION_RUNNER_VERSION,
      digest: withSha256Prefix(producerDigest)
    },
    binding: compactObject({
      suiteId: result.suiteId ?? null,
      plannedSlotId: result.plannedSlotId,
      trialId: result.trialId,
      caseId: result.case?.id ?? null,
      caseSeal: result.case?.seal ? withSha256Prefix(result.case.seal) : null
    }),
    sourceBoundaries: [{
      authorityClass: 'derived',
      sourceId: 'derived.public-report-projection',
      digest: digest(sourceProjection),
      throughSequence: null,
      declaredTotal: null,
      clockDomain: null,
      coverage: { state: 'complete', reason: null }
    }],
    payloadDigest: digest(payload),
    payload
  }
  validatePublicBenchmarkReport(artifact, evidenceIndex)
  return artifact
}

export async function retainPublicBenchmarkReportArtifact(evidenceDirectory, artifact, evidenceIndex = null) {
  validatePublicBenchmarkReport(artifact, evidenceIndex)
  const locator = join('public-reports', `${artifact.artifactId}.json`)
  await writeImmutableJsonOrVerify(join(evidenceDirectory, locator), artifact)
  await atomicWriteJson(join(evidenceDirectory, 'public-report.json'), artifact)
  return {
    artifactId: artifact.artifactId,
    schemaId: artifact.schemaId,
    schemaVersion: artifact.schemaVersion,
    payloadDigest: artifact.payloadDigest,
    locator,
    reportId: artifact.payload.reportId,
    reportClass: artifact.payload.reportClass
  }
}

export function validatePublicBenchmarkReport(artifact, evidenceIndex = null) {
  if (artifact?.schemaId !== PUBLIC_BENCHMARK_REPORT_SCHEMA_ID
      || artifact.schemaVersion !== PUBLIC_BENCHMARK_REPORT_SCHEMA_VERSION
      || artifact.payloadDigest !== digest(artifact.payload)) {
    throw new Error('Public Benchmark Report envelope identity is invalid')
  }
  assertHardOutcome(artifact.payload.layer1HardOutcome)
  assertNoForbiddenKeys(artifact)
  const requirementIds = new Set()
  for (const requirement of artifact.payload.layer2Delivery.requirements) {
    if (requirementIds.has(requirement.requirementId)) {
      throw new Error('Public Benchmark Report Requirement IDs are not unique')
    }
    requirementIds.add(requirement.requirementId)
  }
  const references = collectEvidenceReferences(artifact.payload)
  if (references.length > 0 && !evidenceIndex) {
    throw new Error('Public Benchmark Report has Evidence References without an Evidence Index')
  }
  const evidenceIds = new Set(evidenceIndex?.payload?.records?.map((record) => record.evidenceId) ?? [])
  for (const reference of references) {
    if (reference.artifactId !== evidenceIndex.artifactId || !evidenceIds.has(reference.evidenceId)) {
      throw new Error('Public Benchmark Report has an unresolved Evidence Reference')
    }
  }
  if (artifact.payload.layer5SemanticReview.state === 'unavailable'
      && artifact.payload.layer5SemanticReview.items.length !== 0) {
    throw new Error('Public Benchmark Report unavailable Semantic Review contains items')
  }
  validateQualificationArtifactSchema('public-benchmark-report.schema.json', artifact)
  return artifact
}

function deliveryLayer(result, evidenceIndex) {
  const source = result.deliveryLayer
  if (!source) {
    return {
      coverage: unavailable('public_report.delivery_unavailable'),
      requirements: [],
      categories: [],
      earliestFailureStage: null,
      failureFacts: [],
      workspaceChangeSummary: { created: null, modified: null, deleted: null, renamed: null },
      finalResponseEvidence: []
    }
  }
  const indexIds = new Set(evidenceIndex?.payload?.records?.map((record) => record.evidenceId) ?? [])
  return {
    coverage: result.evaluationState === 'complete'
      ? { state: 'complete', reason: null }
      : partial('public_report.delivery_evaluation_pending'),
    requirements: (source.requirements ?? []).map((requirement) => ({
      requirementId: requirement.requirementId,
      criticality: requirement.criticality,
      status: requirement.status
    })),
    categories: (source.categories ?? []).map((category) => ({
      categoryId: category.categoryId,
      status: category.status
    })),
    earliestFailureStage: boundedNullableText(source.primaryFailureStage, 120),
    failureFacts: (source.failureFacts ?? []).map((failure) => {
      const evidenceId = `derived.failure:${failure.failureFactId}`
      const evidenceReferences = evidenceIndex && indexIds.has(evidenceId)
        ? [{ artifactId: evidenceIndex.artifactId, evidenceId }]
        : []
      return {
        failureFactId: failure.failureFactId,
        stage: stableId(failure.stage, 'unknown_stage'),
        classification: stableId(failure.classification, 'unknown_failure'),
        evidenceReferences
      }
    }),
    workspaceChangeSummary: {
      created: nonnegativeIntegerOrNull(source.workspaceChangeSummary?.created),
      modified: nonnegativeIntegerOrNull(source.workspaceChangeSummary?.modified),
      deleted: nonnegativeIntegerOrNull(source.workspaceChangeSummary?.deleted),
      renamed: nonnegativeIntegerOrNull(source.workspaceChangeSummary?.renamed)
    },
    finalResponseEvidence: (source.finalResponseEvidence ?? [])
      .map((message) => message.evidenceReference)
      .filter((reference) => resolvedReference(reference, evidenceIndex, indexIds))
  }
}

function collaborationLayer(result, ledger, mutationLedger) {
  if (!ledger) {
    return {
      coverage: unavailable('public_report.collaboration_ledger_unavailable'),
      runGraph: { nodes: null, edges: null, maximumDepth: null },
      memberCalls: nullMemberCalls(),
      roleActivations: [],
      feedbackCandidates: [],
      fileOverlapFacts: []
    }
  }
  const complete = ledger.payload.metrics.coverage.state === 'complete'
  const calls = ledger.payload.calls
  const routeFacts = ledger.payload.routeFacts
  const runGraph = result.collaborationEvidence?.runGraph ?? []
  const memberIds = [...new Set(runGraph.map((run) => run.agentProfileId))].sort()
  const roleActivations = memberIds.map((memberId, index) => ({
    memberPseudonym: `member-${String(index + 1).padStart(3, '0')}`,
    declaredRole: null,
    runCount: runGraph.filter((run) => run.agentProfileId === memberId).length
  }))
  const fileOverlapFacts = uniqueReferences((mutationLedger?.payload?.overlapFacts ?? [])
    .flatMap((fact) => fact.evidenceReferences ?? []))
  return {
    coverage: partial('public_report.collaboration_semantic_relations_not_evaluated'),
    runGraph: {
      nodes: runGraph.length,
      edges: complete ? calls.length : null,
      maximumDepth: nonnegativeIntegerOrNull(ledger.payload.metrics.maximumDepth)
    },
    memberCalls: {
      accepted: complete ? calls.length : null,
      settled: complete
        ? calls.filter((call) => call.mechanicalSettlement.state === 'settled').length
        : null,
      unsettled: complete
        ? calls.filter((call) => call.mechanicalSettlement.state === 'unsettled').length
        : null,
      indeterminate: complete
        ? calls.filter((call) => call.mechanicalSettlement.state === 'indeterminate').length
        : null,
      exactDuplicates: complete ? routeFacts.filter((fact) => fact.kind === 'exact_duplicate_acceptance').length : null,
      forwardCycles: complete ? routeFacts.filter((fact) => fact.kind === 'forward_cycle').length : null,
      repeatedRoutes: complete ? routeFacts.filter((fact) => fact.kind === 'repeated_route').length : null
    },
    roleActivations,
    feedbackCandidates: [],
    fileOverlapFacts
  }
}

function toolAndMutationLayer(result, toolLedger, mutationLedger) {
  if (!toolLedger && !mutationLedger) {
    return {
      coverage: unavailable('public_report.tool_and_mutation_unavailable'),
      toolCalls: null,
      succeeded: null,
      failed: null,
      denied: null,
      retries: null,
      idempotentReplays: null,
      provenDuplicateEffects: null,
      latencyCoverage: unavailable('public_report.tool_latency_unavailable'),
      mutationVerification: 'indeterminate',
      directToolFailureCausality: 'indeterminate'
    }
  }
  const summary = toolLedger?.payload?.summary ?? {}
  const mutationRecords = mutationLedger?.payload?.records ?? []
  const verifiedMutations = mutationRecords.filter((record) => (
    record.verificationRelations.some((relation) => relation.state === 'verified')
  )).length
  const mutationVerification = mutationRecords.length === 0
    ? 'indeterminate'
    : verifiedMutations === mutationRecords.length
      ? mutationLedger.payload.coverage.state === 'complete' ? 'complete' : 'partial'
      : verifiedMutations > 0 ? 'partial' : 'none_observed'
  return {
    coverage: summary.coverage?.state === 'complete'
      && mutationLedger?.payload?.coverage?.state === 'complete'
      ? { state: 'complete', reason: null }
      : partial('public_report.tool_and_mutation_coverage_partial'),
    toolCalls: nonnegativeIntegerOrNull(summary.total),
    succeeded: nonnegativeIntegerOrNull(summary.succeeded),
    failed: nonnegativeIntegerOrNull(summary.failed),
    denied: nonnegativeIntegerOrNull(summary.denied),
    retries: nonnegativeIntegerOrNull(summary.retries),
    idempotentReplays: nonnegativeIntegerOrNull(summary.idempotentReplays),
    provenDuplicateEffects: nonnegativeIntegerOrNull(summary.provenDuplicateEffects),
    latencyCoverage: normalizeCoverage(
      result.toolEvidence?.summary?.latencyCoverage,
      'public_report.tool_latency_unavailable'
    ),
    mutationVerification,
    directToolFailureCausality: normalizeCausality(
      result.toolEvidence?.summary?.directToolFailureCausality
    )
  }
}

function semanticLayer(review) {
  if (!review || review.status === 'unavailable') return { state: 'unavailable', items: [] }
  const state = review.status === 'disagreement' ? 'disagreement' : 'complete'
  return {
    state,
    items: (review.items ?? []).map((item) => ({
      checklistItem: item.checklistItem,
      state: item.state,
      verdict: item.verdict ?? null,
      replicaVerdicts: item.replicaVerdicts,
      evidenceReferences: item.evidenceReferences ?? [],
      reason: boundedText(item.reason, 'Semantic Review result.', 1200)
    }))
  }
}

function hardOutcomeLayer(result) {
  return {
    validity: result.validity,
    evaluationState: result.evaluationState,
    verifiedDelivery: result.verifiedDelivery,
    orchestrationConvergence: result.orchestrationConvergence,
    postDispatchHumanIntervention: result.postDispatchHumanIntervention,
    overall: result.overall
  }
}

function assertHardOutcome(hard) {
  if (hard.validity === 'invalid') {
    if (hard.verifiedDelivery !== 'unavailable'
        || hard.orchestrationConvergence !== 'unavailable'
        || hard.postDispatchHumanIntervention !== 'indeterminate'
        || hard.overall !== 'unavailable') {
      throw new Error('Public Benchmark Report invalid or pending Hard Outcome is inconsistent')
    }
    return
  }
  if (hard.evaluationState === 'pending') {
    if (!['pass', 'fail', 'unavailable'].includes(hard.verifiedDelivery)
        || !['pass', 'fail', 'unavailable'].includes(hard.orchestrationConvergence)
        || !['absent', 'present', 'indeterminate'].includes(hard.postDispatchHumanIntervention)
        || hard.overall !== 'unavailable') {
      throw new Error('Public Benchmark Report invalid or pending Hard Outcome is inconsistent')
    }
    return
  }
  if (hard.overall === 'pass') {
    if (hard.verifiedDelivery !== 'pass'
        || hard.orchestrationConvergence !== 'pass'
        || hard.postDispatchHumanIntervention !== 'absent') {
      throw new Error('Public Benchmark Report Hard Pass formula is inconsistent')
    }
    return
  }
  if (hard.overall === 'fail'
      && hard.verifiedDelivery !== 'fail'
      && hard.orchestrationConvergence !== 'fail'
      && hard.postDispatchHumanIntervention !== 'present') {
    throw new Error('Public Benchmark Report Hard Fail formula is inconsistent')
  }
}

function collectEvidenceReferences(value) {
  const references = []
  visit(value)
  return uniqueReferences(references)

  function visit(item) {
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (!item || typeof item !== 'object') return
    if (typeof item.artifactId === 'string' && typeof item.evidenceId === 'string') {
      references.push(item)
    }
    for (const child of Object.values(item)) visit(child)
  }
}

function assertNoForbiddenKeys(value) {
  visit(value)
  function visit(item) {
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (!item || typeof item !== 'object') return
    for (const [key, child] of Object.entries(item)) {
      if (FORBIDDEN_PUBLIC_KEYS.has(key)) {
        throw new Error(`Public Benchmark Report contains forbidden field ${key}`)
      }
      visit(child)
    }
  }
}

function nullMemberCalls() {
  return {
    accepted: null,
    settled: null,
    unsettled: null,
    indeterminate: null,
    exactDuplicates: null,
    forwardCycles: null,
    repeatedRoutes: null
  }
}

function artifactIdentity(value) {
  return value ? {
    artifactId: value.artifactId,
    schemaId: value.schemaId,
    schemaVersion: value.schemaVersion,
    payloadDigest: value.payloadDigest
  } : null
}

function resolvedReference(reference, evidenceIndex, evidenceIds) {
  return reference?.artifactId === evidenceIndex?.artifactId && evidenceIds.has(reference.evidenceId)
}

function normalizeCoverage(value, fallbackCode) {
  if (value?.state === 'complete') return { state: 'complete', reason: null }
  if (['partial', 'unavailable', 'not_applicable'].includes(value?.state)) {
    return { state: value.state, reason: { code: stableId(value.reason?.code, fallbackCode) } }
  }
  return unavailable(fallbackCode)
}

function normalizeCausality(value) {
  return ['proven', 'not_proven', 'indeterminate', 'not_applicable'].includes(value)
    ? value
    : 'indeterminate'
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

function nonnegativeIntegerOrNull(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function stableId(value, fallback) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
    ? value
    : fallback
}

function boundedNullableText(value, maximum) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, maximum) : null
}

function boundedText(value, fallback, maximum) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, maximum) : fallback
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function partial(code) {
  return { state: 'partial', reason: { code } }
}

function unavailable(code) {
  return { state: 'unavailable', reason: { code } }
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

async function writeImmutableJsonOrVerify(path, value) {
  try {
    await writePrivateJsonExclusive(path, value)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const retained = JSON.parse(await readFile(path, 'utf8'))
    if (canonicalJson(retained) !== canonicalJson(value)) {
      throw new Error('immutable Public Benchmark Report identity collision')
    }
  }
}
