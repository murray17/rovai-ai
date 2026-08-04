import { randomUUID } from 'node:crypto'
import { appendFile, chmod, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import {
  acquireExclusiveFile,
  assertNoEscapingSymlinks,
  atomicWriteJson,
  canonicalJson,
  copyFixture,
  digestFile,
  digestJson,
  evaluateChangeBoundary,
  makeTemporaryDirectory,
  removeTemporaryDirectory,
  runCaseVerifier,
  sha256,
  treeDiff,
  treeManifest,
  validateRelativeLocator,
  verifyStoredCaseSeal,
  writePrivateJsonExclusive
} from './qualification-common.mjs'
import {
  QUALIFICATION_TRIAL_SCHEMA_VERSION,
  buildDeliveryLayer,
  buildRunnerCheckResults,
  deriveDeliveryEvidence,
  deriveHardOutcome,
  redactQualificationResult
} from './qualification-evaluation.mjs'
import {
  bindToolEvidenceReferences,
  buildEvidenceIndex,
  retainEvidenceIndexArtifact
} from './qualification-evidence-index.mjs'
import {
  buildCollaborationLedger,
  retainCollaborationLedgerArtifact
} from './qualification-collaboration-ledger.mjs'
import {
  buildToolCallLedger,
  retainToolCallLedgerArtifact
} from './qualification-tool-ledger.mjs'
import {
  buildWorkspaceMutationLedger,
  retainWorkspaceMutationLedgerArtifact
} from './qualification-workspace-mutation-ledger.mjs'
import { publishQualificationEvidenceBundle } from './qualification-bundle.mjs'

export const QUALIFICATION_EVALUATION_IDENTITY_VERSION = 1
const IRRECOVERABLE_RECOVERY_REASONS = new Set([
  'recovery.delivered_snapshot_unavailable',
  'recovery.delivered_snapshot_locator_escape',
  'recovery.delivered_snapshot_unreadable',
  'recovery.delivered_snapshot_digest_mismatch',
  'recovery.delivered_snapshot_manifest_mismatch',
  'recovery.delivered_snapshot_manifest_unavailable',
  'recovery.baseline_digest_mismatch',
  'recovery.workspace_diff_mismatch',
  'recovery.change_boundary_mismatch'
])
export const QUALIFICATION_VERIFIER_CONFIGURATION = Object.freeze({
  schemaVersion: 1,
  runtime: 'node',
  environmentProfile: 'sanitized-offline-v1',
  workspaceMutationPolicy: 'reject',
  timeoutMs: 180_000,
  maxOutputBytes: 2 * 1024 * 1024
})

export function buildEvaluationIdentity({
  trialId,
  caseSeal,
  deliveredWorkspaceDigest,
  verifierDigest,
  verifierRuntimeDigest,
  verificationCatalogDigest,
  environmentManifestDigest = null,
  resultSchemaVersion = QUALIFICATION_TRIAL_SCHEMA_VERSION
}) {
  for (const [label, value] of Object.entries({
    trialId,
    caseSeal,
    deliveredWorkspaceDigest,
    verifierDigest,
    verifierRuntimeDigest,
    verificationCatalogDigest
  })) {
    if (typeof value !== 'string' || value === '') throw new Error(`Evaluation identity ${label} is required`)
  }
  return {
    schemaVersion: QUALIFICATION_EVALUATION_IDENTITY_VERSION,
    trialId,
    caseSeal,
    deliveredWorkspaceDigest,
    verifierDigest,
    verifierRuntimeDigest,
    verifierConfigurationDigest: digestJson(QUALIFICATION_VERIFIER_CONFIGURATION),
    verificationCatalogDigest,
    environmentManifestDigest,
    resultSchemaVersion
  }
}

export async function computeQualificationEvaluatorDigest() {
  const repositoryRoot = resolve(import.meta.dirname, '../..')
  const files = [
    join(repositoryRoot, 'docs', 'versions', 'v0.34', 'schemas', 'schema-catalog.json'),
    join(repositoryRoot, 'scripts', 'qualification-runner.mjs'),
    join(repositoryRoot, 'scripts', 'qualification-evaluate.mjs'),
    join(repositoryRoot, 'scripts', 'qualification-semantic-review.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-common.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-evaluation.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-recovery.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-collaboration.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-collaboration-ledger.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-bundle.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-artifacts.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-core.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-evidence-index.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-isolation.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-public-report.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-schema-validation.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-semantic-judge.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-tool-evidence.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-tool-ledger.mjs'),
    join(repositoryRoot, 'scripts', 'lib', 'qualification-workspace-mutation-ledger.mjs')
  ]
  return digestJson(await Promise.all(files.map(async (path) => ({
    path: path.slice(repositoryRoot.length + 1),
    digest: await digestFile(path)
  }))))
}

export async function appendEvaluationAttempt(evidenceDirectory, {
  attemptId = randomUUID(),
  trialId,
  trigger,
  evaluationIdentity,
  identityValidation,
  observation = null,
  derivation
}) {
  const record = {
    schemaVersion: QUALIFICATION_TRIAL_SCHEMA_VERSION,
    attemptId,
    trialId,
    attemptedAt: new Date().toISOString(),
    trigger,
    evaluationIdentity,
    identityValidation,
    observation,
    derivation
  }
  await writePrivateJsonExclusive(
    join(evidenceDirectory, 'evaluation-attempts', `${attemptId}.json`),
    record
  )
  return record
}

export async function appendResultRevision(evidenceDirectory, result, {
  evaluationAttemptId = null
} = {}) {
  const history = await readRevisionRecords(evidenceDirectory, { allowEmpty: true })
  const previous = history.at(-1) ?? null
  if (previous && previous.trialId !== result.trialId) {
    throw new Error('Qualification result revision Trial identity changed')
  }
  const revision = {
    revisionId: randomUUID(),
    sequence: history.length + 1,
    previousRevisionId: previous?.revisionId ?? null,
    previousResultDigest: previous?.resultDigest ?? null,
    evaluationAttemptId,
    recordedAt: new Date().toISOString()
  }
  const resultBundle = { ...result, resultRevision: revision }
  const record = {
    schemaVersion: QUALIFICATION_TRIAL_SCHEMA_VERSION,
    ...revision,
    trialId: resultBundle.trialId,
    resultDigest: digestJson(resultBundle),
    result: resultBundle
  }
  const filename = `${String(revision.sequence).padStart(4, '0')}-${revision.revisionId}.json`
  await writePrivateJsonExclusive(join(evidenceDirectory, 'result-revisions', filename), record)

  // These two files are replaceable read projections. The revision record above is
  // the append-only authority and is written first so a projection can be repaired.
  const redactedSummary = redactQualificationResult(resultBundle)
  await atomicWriteJson(join(evidenceDirectory, 'result.json'), resultBundle)
  await atomicWriteJson(join(evidenceDirectory, 'redacted-summary.json'), redactedSummary)
  return { record, resultBundle, redactedSummary }
}

export async function loadQualificationResultHistory(evidenceDirectory, {
  repairProjections = false
} = {}) {
  const records = await readRevisionRecords(evidenceDirectory)
  await validateEvaluationAttemptReferences(evidenceDirectory, records)
  const first = records[0]
  const latest = records.at(-1)
  const captureDigest = (await readFile(join(evidenceDirectory, 'CAPTURE_COMPLETE'), 'utf8')).trim()
  if (captureDigest !== first.resultDigest) {
    throw new Error('Qualification capture marker does not bind the initial result revision')
  }

  const currentPath = join(evidenceDirectory, 'result.json')
  const redactedPath = join(evidenceDirectory, 'redacted-summary.json')
  const current = await readJson(currentPath).catch(() => null)
  const expectedRedacted = redactQualificationResult(latest.result)
  const currentRedacted = await readJson(redactedPath).catch(() => null)
  const currentMatches = current && digestJson(current) === latest.resultDigest
  const redactedMatches = currentRedacted
    && canonicalJson(currentRedacted) === canonicalJson(expectedRedacted)
  if ((!currentMatches || !redactedMatches) && !repairProjections) {
    throw new Error('Qualification current result projection does not match append-only history')
  }
  if (!currentMatches && repairProjections) await atomicWriteJson(currentPath, latest.result)
  if (!redactedMatches && repairProjections) await atomicWriteJson(redactedPath, expectedRedacted)
  return {
    records,
    initial: first.result,
    current: latest.result,
    currentDigest: latest.resultDigest,
    projectionRepaired: repairProjections && (!currentMatches || !redactedMatches)
  }
}

export async function recoverQualificationEvaluation({
  evidenceDirectory,
  caseDirectory,
  expectedSeal = null
}) {
  const retainedEvidenceDirectory = await realpath(resolve(evidenceDirectory))
  const lock = await acquireExclusiveFile(join(retainedEvidenceDirectory, '.active'))
  let temporaryRoot = null
  try {
    const history = await loadQualificationResultHistory(retainedEvidenceDirectory, {
      repairProjections: true
    })
    const prior = history.current
    assertEvaluationTrial(prior)
    if (expectedSeal && expectedSeal !== prior.case?.seal) {
      throw recoveryError('recovery.expected_seal_mismatch')
    }

    let caseRecord
    try {
      caseRecord = await verifyStoredCaseSeal(caseDirectory, prior.case.seal)
    } catch {
      await appendIdentityFailure(retainedEvidenceDirectory, prior, [
        { code: 'recovery.case_seal_unavailable_or_mismatched' }
      ])
      throw recoveryError('recovery.case_seal_unavailable_or_mismatched')
    }

    const validation = await validateRetainedEvaluationIdentity({
      evidenceDirectory: retainedEvidenceDirectory,
      prior,
      caseRecord
    })
    if (validation.reasons.length > 0) {
      await appendIdentityFailure(retainedEvidenceDirectory, prior, validation.reasons)
      throw recoveryError(validation.reasons[0].code)
    }

    if (prior.evaluationState === 'complete') {
      const markerCreated = await writeCompletionMarker(
        join(retainedEvidenceDirectory, 'COMPLETE'),
        history.currentDigest
      )
      if (markerCreated) {
        await appendLifecycle(retainedEvidenceDirectory, {
          state: 'evaluation_completion_reconciled',
          resultRevisionId: history.records.at(-1).revisionId
        })
      }
      const publication = await publishQualificationEvidenceBundle({
        evidenceDirectory: retainedEvidenceDirectory,
        result: prior,
        resultDigest: history.currentDigest,
        caseRecord,
        producerDigest: validation.environmentManifest.runnerDigest
      })
      return {
        record: history.records.at(-1),
        resultBundle: prior,
        redactedSummary: redactQualificationResult(prior),
        evaluationAttempt: null,
        evidenceDirectory: retainedEvidenceDirectory,
        ...publication
      }
    }

    temporaryRoot = await makeTemporaryDirectory('rovai-qualification-evaluation-recovery-')
    const verifierWorkspace = join(temporaryRoot, 'workspace')
    await copyFixture(validation.snapshotPath, verifierWorkspace)
    const verifierObservation = await runCaseVerifier(
      caseRecord.contract.verifierPath,
      verifierWorkspace,
      {
        verificationCatalog: caseRecord.contract.evaluationContract.verificationCatalog,
        timeoutMs: QUALIFICATION_VERIFIER_CONFIGURATION.timeoutMs,
        maxOutputBytes: QUALIFICATION_VERIFIER_CONFIGURATION.maxOutputBytes
      }
    )

    const attemptId = randomUUID()
    let nextResult
    try {
      nextResult = deriveRecoveredResult({
        prior,
        caseRecord,
        verifierObservation,
        workspaceDiff: validation.workspaceDiff,
        changeBoundary: validation.changeBoundary,
        evaluationIdentity: validation.evaluationIdentity,
        evaluationAttemptId: attemptId
      })
      nextResult = await attachRecoveredEvidenceIndex({
        evidenceDirectory: retainedEvidenceDirectory,
        prior,
        nextResult,
        caseRecord,
        verifierObservation,
        validation,
        evaluationAttemptId: attemptId
      })
    } catch (error) {
      await appendEvaluationAttempt(retainedEvidenceDirectory, {
        attemptId,
        trialId: prior.trialId,
        trigger: 'recovery',
        evaluationIdentity: validation.evaluationIdentity,
        identityValidation: { status: 'passed', reasons: [] },
        observation: verifierObservation,
        derivation: {
          status: 'failed',
          reason: { code: 'recovery.result_derivation_failed', detail: error?.name ?? 'Error' }
        }
      })
      throw recoveryError('recovery.result_derivation_failed')
    }

    const attempt = await appendEvaluationAttempt(retainedEvidenceDirectory, {
      attemptId,
      trialId: prior.trialId,
      trigger: 'recovery',
      evaluationIdentity: validation.evaluationIdentity,
      identityValidation: { status: 'passed', reasons: [] },
      observation: verifierObservation,
      derivation: {
        status: 'completed',
        evaluationState: nextResult.evaluationState,
        hardOutcome: nextResult.hardOutcome
      }
    })
    const revision = await appendResultRevision(retainedEvidenceDirectory, nextResult, {
      evaluationAttemptId: attempt.attemptId
    })
    await appendLifecycle(retainedEvidenceDirectory, {
      state: revision.resultBundle.evaluationState === 'complete'
        ? 'evaluation_recovered'
        : 'evaluation_still_pending',
      evaluationAttemptId: attempt.attemptId,
      resultRevisionId: revision.record.revisionId
    })
    if (revision.resultBundle.evaluationState === 'complete') {
      await writeCompletionMarker(
        join(retainedEvidenceDirectory, 'COMPLETE'),
        revision.record.resultDigest
      )
    }
    const publication = await publishQualificationEvidenceBundle({
      evidenceDirectory: retainedEvidenceDirectory,
      result: revision.resultBundle,
      resultDigest: revision.record.resultDigest,
      caseRecord,
      producerDigest: validation.environmentManifest.runnerDigest
    })
    return {
      ...revision,
      evaluationAttempt: attempt,
      evidenceDirectory: retainedEvidenceDirectory,
      ...publication
    }
  } finally {
    if (temporaryRoot) await removeTemporaryDirectory(temporaryRoot)
    await lock.release()
  }
}

export async function invalidateQualificationEvaluation({
  evidenceDirectory,
  reasonCode
}) {
  if (!IRRECOVERABLE_RECOVERY_REASONS.has(reasonCode)) {
    throw recoveryError('invalidation.reason_not_irrecoverable')
  }
  const retainedEvidenceDirectory = await realpath(resolve(evidenceDirectory))
  const lock = await acquireExclusiveFile(join(retainedEvidenceDirectory, '.active'))
  try {
    const history = await loadQualificationResultHistory(retainedEvidenceDirectory, {
      repairProjections: true
    })
    const prior = history.current
    if (prior?.schemaVersion !== QUALIFICATION_TRIAL_SCHEMA_VERSION
        || prior.dispatchAccepted !== true
        || prior.validity !== 'valid'
        || prior.evaluationState !== 'pending'
        || prior.hardOutcome !== 'unavailable') {
      throw recoveryError('invalidation.trial_not_valid_pending_execution')
    }
    const failedAttempts = await readEvaluationAttempts(retainedEvidenceDirectory)
    const supportingAttempt = failedAttempts
      .filter((attempt) => attempt.trialId === prior.trialId
        && attempt.identityValidation?.status === 'failed'
        && attempt.identityValidation.reasons?.some((reason) => reason.code === reasonCode))
      .sort((left, right) => left.attemptedAt.localeCompare(right.attemptedAt))
      .at(-1)
    if (!supportingAttempt) {
      throw recoveryError('invalidation.supporting_recovery_attempt_unavailable')
    }

    const attemptId = randomUUID()
    const invalidationReason = {
      code: reasonCode,
      supportingEvaluationAttemptId: supportingAttempt.attemptId,
      invalidatedAt: new Date().toISOString()
    }
    const evaluationIssues = uniqueReasons([
      ...(prior.evaluationIssues ?? []),
      { code: 'evaluation.integrity_irrecoverable', detail: reasonCode }
    ])
    const priorDelivery = prior.deliveryLayer
    const nextResult = {
      ...prior,
      lastEvaluatedAt: invalidationReason.invalidatedAt,
      validity: 'invalid',
      evaluationState: 'pending',
      verifiedDelivery: 'unavailable',
      orchestrationConvergence: 'unavailable',
      postDispatchHumanIntervention: 'indeterminate',
      hardOutcome: 'unavailable',
      overall: 'unavailable',
      stage: 'verification',
      hardLayer: {
        verifiedDelivery: 'unavailable',
        orchestrationConvergence: 'unavailable',
        postDispatchHumanIntervention: 'indeterminate',
        overall: 'unavailable',
        convergenceFacts: prior.hardLayer?.convergenceFacts ?? {
          runTree: 'indeterminate',
          conversationInputs: 'indeterminate',
          approvals: 'indeterminate',
          budget: 'indeterminate',
          runtimeExit: 'indeterminate',
          externalEffects: 'indeterminate'
        },
        failureRecoveryFacts: prior.hardLayer?.failureRecoveryFacts ?? []
      },
      deliveryLayer: priorDelivery ? {
        ...priorDelivery,
        verifiedDelivery: 'unavailable',
        primaryFailureStage: 'verification',
        // Invalidation is an evaluator-integrity fact, not a new delivery
        // failure. Keeping it out of Delivery Failure Facts also preserves the
        // authority domain of the retained Evidence Index.
        failureFacts: [...priorDelivery.failureFacts],
        evaluationIssues
      } : null,
      deliveredWorkspaceSnapshot: prior.deliveredWorkspaceSnapshot ? {
        ...prior.deliveredWorkspaceSnapshot,
        evaluationAttemptId: attemptId
      } : null,
      evaluationIssues,
      invalidationReason
    }
    const attempt = await appendEvaluationAttempt(retainedEvidenceDirectory, {
      attemptId,
      trialId: prior.trialId,
      trigger: 'invalidation',
      evaluationIdentity: prior.evaluationIdentity,
      identityValidation: {
        status: 'failed',
        reasons: [{ code: reasonCode }]
      },
      observation: null,
      derivation: {
        status: 'completed',
        validity: 'invalid',
        evaluationState: 'pending',
        hardOutcome: 'unavailable'
      }
    })
    const revision = await appendResultRevision(retainedEvidenceDirectory, nextResult, {
      evaluationAttemptId: attempt.attemptId
    })
    await appendLifecycle(retainedEvidenceDirectory, {
      state: 'evaluation_irrecoverable',
      reasonCode,
      supportingEvaluationAttemptId: supportingAttempt.attemptId,
      evaluationAttemptId: attempt.attemptId,
      resultRevisionId: revision.record.revisionId
    })
    await writeDigestMarker(
      join(retainedEvidenceDirectory, 'IRRECOVERABLE'),
      revision.record.resultDigest,
      'irrecoverable marker'
    )
    const publication = await publishQualificationEvidenceBundle({
      evidenceDirectory: retainedEvidenceDirectory,
      result: revision.resultBundle,
      resultDigest: revision.record.resultDigest,
      producerDigest: await computeQualificationEvaluatorDigest()
    })
    return {
      ...revision,
      evaluationAttempt: attempt,
      evidenceDirectory: retainedEvidenceDirectory,
      ...publication
    }
  } finally {
    await lock.release()
  }
}

function deriveRecoveredResult({
  prior,
  caseRecord,
  verifierObservation,
  workspaceDiff,
  changeBoundary,
  evaluationIdentity,
  evaluationAttemptId
}) {
  const runnerCheckResults = buildRunnerCheckResults(
    caseRecord.contract.evaluationContract.verificationCatalog,
    { changeBoundary }
  )
  const deliveryEvidence = deriveDeliveryEvidence(
    caseRecord.contract.evaluationContract,
    verifierObservation,
    runnerCheckResults
  )
  const convergence = {
    status: prior.orchestrationConvergence,
    facts: prior.hardLayer.convergenceFacts,
    failureRecoveryFacts: prior.hardLayer.failureRecoveryFacts
  }
  const humanIntervention = prior.humanInterventionEvidence
  if (humanIntervention?.status !== prior.postDispatchHumanIntervention) {
    throw new Error('retained Human Intervention evidence is inconsistent')
  }
  const evaluationIssues = [...deliveryEvidence.evaluationIssues]
  const hardOutcome = deriveHardOutcome({
    dispatchAccepted: prior.dispatchAccepted,
    validity: prior.validity,
    verifiedDelivery: deliveryEvidence.verifiedDelivery,
    orchestrationConvergence: convergence.status,
    postDispatchHumanIntervention: humanIntervention.status,
    evaluationIssues
  })
  const deliveryLayer = buildDeliveryLayer({
    deliveryEvidence,
    workspaceDiff,
    changeBoundary,
    verifierObservation,
    convergence,
    humanIntervention,
    budgetEvent: prior.budget?.event ?? null,
    postDispatchError: null,
    finalResponseReferences: prior.deliveryLayer?.finalResponseEvidence ?? []
  })
  return {
    ...prior,
    lastEvaluatedAt: new Date().toISOString(),
    ...hardOutcome,
    stage: hardOutcome.evaluationState === 'complete' ? 'complete' : 'verification',
    hardLayer: {
      verifiedDelivery: hardOutcome.verifiedDelivery,
      orchestrationConvergence: hardOutcome.orchestrationConvergence,
      postDispatchHumanIntervention: hardOutcome.postDispatchHumanIntervention,
      overall: hardOutcome.overall,
      convergenceFacts: convergence.facts,
      failureRecoveryFacts: convergence.failureRecoveryFacts
    },
    deliveryLayer,
    deliveredWorkspaceSnapshot: {
      ...prior.deliveredWorkspaceSnapshot,
      evaluationAttemptId
    },
    verifier: verifierObservation,
    changeBoundary,
    evaluationIdentity,
    evaluationIssues,
    postDispatchError: null
  }
}

async function attachRecoveredEvidenceIndex({
  evidenceDirectory,
  prior,
  nextResult,
  caseRecord,
  verifierObservation,
  validation,
  evaluationAttemptId
}) {
  const convergence = {
    status: nextResult.orchestrationConvergence,
    facts: nextResult.hardLayer.convergenceFacts,
    failureRecoveryFacts: nextResult.hardLayer.failureRecoveryFacts
  }
  const executionEvidenceCoverage = {
    coverage: prior.toolEvidence?.sourceBoundary?.coverage ?? {
      state: 'unavailable',
      reason: { code: 'tool_evidence.complete_pagination_unavailable' }
    },
    declaredTotal: prior.toolEvidence?.sourceBoundary?.declaredExecutionEvidence ?? null
  }
  const build = buildEvidenceIndex({
    trialId: prior.trialId,
    evaluationAttemptId,
    plannedSlotId: prior.plannedSlotId,
    suiteId: prior.suiteId ?? null,
    caseId: caseRecord.contract.manifest.id,
    caseSeal: caseRecord.seal,
    producerDigest: validation.environmentManifest.runnerDigest,
    snapshot: validation.evidenceSnapshot,
    dispatchBoundary: prior.dispatchBoundary,
    environmentManifest: validation.environmentManifest,
    observationDigest: prior.observationDigest,
    observationIntegrityIssues: (prior.evaluationIssues ?? []).filter((issue) => (
      typeof issue.code === 'string' && issue.code.startsWith('event_coverage.')
    )),
    executionEvidenceCoverage,
    verifierObservation,
    deliveredWorkspaceSnapshot: nextResult.deliveredWorkspaceSnapshot,
    workspaceDiff: validation.workspaceDiff,
    deliveryEvidence: nextResult.deliveryLayer,
    convergence,
    humanIntervention: nextResult.humanInterventionEvidence,
    termination: nextResult.termination,
    isolationProfile: nextResult.isolationProfile,
    isolationContinuity: nextResult.interventionIsolationContinuity,
    finalResponses: nextResult.deliveryLayer?.finalResponseEvidence ?? []
  })
  const evidenceIndex = await retainEvidenceIndexArtifact(evidenceDirectory, build.artifact)
  const collaborationLedgerArtifact = buildCollaborationLedger({
    trialId: prior.trialId,
    evaluationAttemptId,
    plannedSlotId: prior.plannedSlotId,
    suiteId: prior.suiteId ?? null,
    caseId: caseRecord.contract.manifest.id,
    caseSeal: caseRecord.seal,
    producerDigest: validation.environmentManifest.runnerDigest,
    collaborationEvidence: nextResult.collaborationEvidence,
    evidenceIndex: build.artifact,
    evidenceReferences: build.references
  })
  const collaborationLedger = await retainCollaborationLedgerArtifact(
    evidenceDirectory,
    collaborationLedgerArtifact,
    build.artifact
  )
  const toolEvidence = bindToolEvidenceReferences(
    nextResult.toolEvidence,
    build.references.executionEvidence
  )
  const toolCallLedgerArtifact = buildToolCallLedger({
    trialId: prior.trialId,
    evaluationAttemptId,
    plannedSlotId: prior.plannedSlotId,
    suiteId: prior.suiteId ?? null,
    caseId: caseRecord.contract.manifest.id,
    caseSeal: caseRecord.seal,
    producerDigest: validation.environmentManifest.runnerDigest,
    toolEvidence,
    evidenceIndex: build.artifact
  })
  const toolCallLedger = await retainToolCallLedgerArtifact(
    evidenceDirectory,
    toolCallLedgerArtifact,
    build.artifact
  )
  const workspaceMutationLedgerArtifact = buildWorkspaceMutationLedger({
    trialId: prior.trialId,
    evaluationAttemptId,
    plannedSlotId: prior.plannedSlotId,
    suiteId: prior.suiteId ?? null,
    caseId: caseRecord.contract.manifest.id,
    caseSeal: caseRecord.seal,
    producerDigest: validation.environmentManifest.runnerDigest,
    workspaceDiff: validation.workspaceDiff,
    observedAt: nextResult.lastEvaluatedAt,
    evidenceIndex: build.artifact,
    evidenceReferences: build.references,
    toolCallLedger: toolCallLedgerArtifact
  })
  const workspaceMutationLedger = await retainWorkspaceMutationLedgerArtifact(
    evidenceDirectory,
    workspaceMutationLedgerArtifact,
    build.artifact,
    toolCallLedgerArtifact
  )
  const finalResponseEvidence = (nextResult.deliveryLayer?.finalResponseEvidence ?? []).map((message) => ({
    ...message,
    evidenceReference: build.references.messages[message.messageId] ?? null
  }))
  return {
    ...nextResult,
    evidenceIndex,
    collaborationLedger,
    toolEvidence,
    toolCallLedger,
    workspaceMutationLedger,
    deliveryLayer: nextResult.deliveryLayer ? {
      ...nextResult.deliveryLayer,
      finalResponseEvidence
    } : null
  }
}

async function validateRetainedEvaluationIdentity({ evidenceDirectory, prior, caseRecord }) {
  const reasons = []
  let environmentManifest = null
  let evidenceSnapshot = null
  if (caseRecord.contract.manifest.id !== prior.case?.id
      || caseRecord.contract.manifest.version !== prior.case?.version
      || caseRecord.seal !== prior.case?.seal
      || caseRecord.admission.admissionDigest !== prior.case?.admissionDigest) {
    reasons.push({ code: 'recovery.case_identity_mismatch' })
  }
  if (!prior.deliveredWorkspaceSnapshot) {
    reasons.push({ code: 'recovery.delivered_snapshot_unavailable' })
    return { reasons }
  }

  let snapshotPath = null
  let snapshotManifest = null
  try {
    const locator = validateRelativeLocator(
      prior.deliveredWorkspaceSnapshot.directory,
      'Delivered Workspace Snapshot directory'
    )
    const candidate = await realpath(join(evidenceDirectory, locator))
    if (candidate !== evidenceDirectory && !candidate.startsWith(`${evidenceDirectory}${sep}`)) {
      reasons.push({ code: 'recovery.delivered_snapshot_locator_escape' })
    } else {
      snapshotPath = candidate
      snapshotManifest = await treeManifest(snapshotPath)
      await assertNoEscapingSymlinks(snapshotPath, snapshotManifest)
    }
  } catch {
    reasons.push({ code: 'recovery.delivered_snapshot_unreadable' })
  }
  if (!snapshotManifest) return { reasons }

  const digest = snapshotManifest.digest
  if (basename(snapshotPath) !== `delivered-workspace-${digest}`
      || prior.deliveredWorkspaceSnapshot.digest !== digest
      || prior.finalTreeDigest !== digest) {
    reasons.push({ code: 'recovery.delivered_snapshot_digest_mismatch' })
  }
  try {
    const retainedManifest = await readJson(join(evidenceDirectory, 'delivered-workspace-manifest.json'))
    if (retainedManifest.digest !== digest
        || canonicalJson(retainedManifest.entries) !== canonicalJson(snapshotManifest.entries)) {
      reasons.push({ code: 'recovery.delivered_snapshot_manifest_mismatch' })
    }
  } catch {
    reasons.push({ code: 'recovery.delivered_snapshot_manifest_unavailable' })
  }
  if (caseRecord.contract.fixture.digest !== prior.baselineTreeDigest) {
    reasons.push({ code: 'recovery.baseline_digest_mismatch' })
  }
  if (prior.environmentManifestDigest) {
    try {
      environmentManifest = await readJson(join(evidenceDirectory, 'environment-manifest.json'))
      if (digestJson(environmentManifest) !== prior.environmentManifestDigest) {
        reasons.push({ code: 'recovery.environment_manifest_digest_mismatch' })
      }
      if (environmentManifest.runnerDigest !== await computeQualificationEvaluatorDigest()) {
        reasons.push({ code: 'recovery.evaluator_digest_mismatch' })
      }
    } catch {
      reasons.push({ code: 'recovery.environment_manifest_unavailable' })
    }
  }
  try {
    const rawObservations = await readFile(join(evidenceDirectory, 'observations.ndjson'), 'utf8')
    const records = rawObservations.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    const finalObservation = records.at(-1)
    if (!finalObservation?.snapshot
        || finalObservation.digest !== digestJson(finalObservation.snapshot)) {
      reasons.push({ code: 'recovery.observation_evidence_unavailable' })
    } else if (sha256(rawObservations) !== prior.observationDigest) {
      reasons.push({ code: 'recovery.observation_digest_mismatch' })
    } else {
      evidenceSnapshot = finalObservation.snapshot
    }
  } catch {
    reasons.push({ code: 'recovery.observation_evidence_unavailable' })
  }
  const workspaceDiff = treeDiff(caseRecord.contract.fixture, snapshotManifest)
  if (canonicalJson(workspaceDiff) !== canonicalJson(prior.workspaceDiff)) {
    reasons.push({ code: 'recovery.workspace_diff_mismatch' })
  }
  const changeBoundary = evaluateChangeBoundary(caseRecord.contract.manifest, workspaceDiff)
  if (canonicalJson(changeBoundary) !== canonicalJson(prior.changeBoundary)) {
    reasons.push({ code: 'recovery.change_boundary_mismatch' })
  }
  const evaluationIdentity = buildEvaluationIdentity({
    trialId: prior.trialId,
    caseSeal: caseRecord.seal,
    deliveredWorkspaceDigest: digest,
    verifierDigest: caseRecord.contract.components.verifierDigest,
    verifierRuntimeDigest: await digestFile(process.execPath),
    verificationCatalogDigest: caseRecord.contract.components.verificationCatalogDigest,
    environmentManifestDigest: prior.environmentManifestDigest,
    resultSchemaVersion: prior.schemaVersion
  })
  if (canonicalJson(evaluationIdentity) !== canonicalJson(prior.evaluationIdentity)) {
    reasons.push({ code: 'recovery.evaluation_identity_mismatch' })
  }
  return {
    reasons,
    snapshotPath,
    snapshotManifest,
    workspaceDiff,
    changeBoundary,
    evaluationIdentity,
    environmentManifest,
    evidenceSnapshot
  }
}

async function appendIdentityFailure(evidenceDirectory, prior, reasons) {
  await appendEvaluationAttempt(evidenceDirectory, {
    trialId: prior.trialId,
    trigger: 'recovery',
    evaluationIdentity: prior.evaluationIdentity ?? null,
    identityValidation: { status: 'failed', reasons },
    observation: null,
    derivation: { status: 'not_started' }
  })
}

function assertEvaluationTrial(result) {
  if (result?.schemaVersion !== QUALIFICATION_TRIAL_SCHEMA_VERSION) {
    throw recoveryError('recovery.unsupported_trial_schema')
  }
  if (result.dispatchAccepted !== true || result.validity !== 'valid') {
    throw recoveryError('recovery.trial_not_valid_and_dispatched')
  }
  const pending = result.evaluationState === 'pending' && result.hardOutcome === 'unavailable'
  const complete = result.evaluationState === 'complete' && ['pass', 'fail'].includes(result.hardOutcome)
  if (!pending && !complete) {
    throw recoveryError('recovery.trial_evaluation_state_inconsistent')
  }
  if (!result.evaluationIdentity) throw recoveryError('recovery.evaluation_identity_unavailable')
}

async function readRevisionRecords(evidenceDirectory, { allowEmpty = false } = {}) {
  const directory = join(evidenceDirectory, 'result-revisions')
  const filenames = await readdir(directory).catch((error) => {
    if (allowEmpty && error.code === 'ENOENT') return []
    throw error
  })
  const records = []
  for (const filename of filenames.filter((name) => name.endsWith('.json')).sort()) {
    records.push(await readJson(join(directory, filename)))
  }
  if (!allowEmpty && records.length === 0) {
    throw new Error('Qualification result revision history is unavailable')
  }
  let previous = null
  for (const [index, record] of records.entries()) {
    const expectedSequence = index + 1
    if (record.schemaVersion !== QUALIFICATION_TRIAL_SCHEMA_VERSION
        || record.sequence !== expectedSequence
        || record.previousRevisionId !== (previous?.revisionId ?? null)
        || record.previousResultDigest !== (previous?.resultDigest ?? null)
        || record.result?.resultRevision?.revisionId !== record.revisionId
        || record.result.resultRevision.sequence !== record.sequence
        || record.result.resultRevision.previousRevisionId !== record.previousRevisionId
        || record.result.resultRevision.previousResultDigest !== record.previousResultDigest
        || record.result.resultRevision.evaluationAttemptId !== record.evaluationAttemptId
        || record.trialId !== record.result.trialId
        || record.resultDigest !== digestJson(record.result)) {
      throw new Error('Qualification append-only result revision chain is invalid')
    }
    previous = record
  }
  return records
}

async function readEvaluationAttempts(evidenceDirectory) {
  const directory = join(evidenceDirectory, 'evaluation-attempts')
  const filenames = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const attempts = []
  for (const filename of filenames.filter((name) => name.endsWith('.json')).sort()) {
    const attempt = await readJson(join(directory, filename))
    if (attempt.schemaVersion !== QUALIFICATION_TRIAL_SCHEMA_VERSION
        || attempt.attemptId !== filename.slice(0, -'.json'.length)) {
      throw new Error('Qualification evaluation attempt history is invalid')
    }
    attempts.push(attempt)
  }
  return attempts
}

async function validateEvaluationAttemptReferences(evidenceDirectory, records) {
  for (const record of records) {
    if (record.evaluationAttemptId === null) continue
    let attempt
    try {
      attempt = await readJson(join(
        evidenceDirectory,
        'evaluation-attempts',
        `${record.evaluationAttemptId}.json`
      ))
    } catch {
      throw new Error('Qualification result revision references an unavailable evaluation attempt')
    }
    const snapshotAttemptId = record.result.deliveredWorkspaceSnapshot?.evaluationAttemptId
    const snapshotBindingValid = snapshotAttemptId === record.evaluationAttemptId
      || (snapshotAttemptId === undefined
        && attempt.trigger === 'invalidation'
        && record.result.validity === 'invalid')
    if (attempt.schemaVersion !== QUALIFICATION_TRIAL_SCHEMA_VERSION
        || attempt.attemptId !== record.evaluationAttemptId
        || attempt.trialId !== record.trialId
        || canonicalJson(attempt.evaluationIdentity) !== canonicalJson(record.result.evaluationIdentity)
        || !snapshotBindingValid) {
      throw new Error('Qualification result revision evaluation-attempt binding is invalid')
    }
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function appendLifecycle(evidenceDirectory, detail) {
  const path = join(evidenceDirectory, 'lifecycle.ndjson')
  await appendFile(path, `${JSON.stringify({
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    ...detail
  })}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
}

async function writeCompletionMarker(path, digest) {
  return writeDigestMarker(path, digest, 'completion marker')
}

async function writeDigestMarker(path, digest, label) {
  try {
    await writeFile(path, `${digest}\n`, { flag: 'wx', mode: 0o600 })
    return true
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const existing = (await readFile(path, 'utf8')).trim()
    if (existing !== digest) throw new Error(`Qualification ${label} already binds a different result`)
    return false
  }
}

function uniqueReasons(reasons) {
  const seen = new Set()
  return reasons.filter((reason) => {
    const identity = `${reason.code}:${reason.detail ?? ''}`
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

function recoveryError(code) {
  const error = new Error(code)
  error.code = code
  return error
}
