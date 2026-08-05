import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  QUALIFICATION_RUNNER_VERSION,
  captureDeliveredWorkspaceSnapshot,
  copyFixture,
  digestFile,
  digestJson,
  evaluateChangeBoundary,
  sha256,
  treeDiff,
  treeManifest,
  verifyStoredCaseSeal
} from './qualification-common.mjs'
import {
  QUALIFICATION_TRIAL_SCHEMA_VERSION,
  buildDeliveryLayer,
  buildRunnerCheckResults,
  buildSuiteProgress,
  deriveDeliveryEvidence,
  deriveHardOutcome
} from './qualification-evaluation.mjs'
import {
  appendEvaluationAttempt,
  appendResultRevision,
  buildEvaluationIdentity,
  computeQualificationEvaluatorDigest,
  invalidateQualificationEvaluation,
  loadQualificationResultHistory,
  recoverQualificationEvaluation
} from './qualification-recovery.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const demoCaseDirectory = join(repositoryRoot, 'qualification', 'demo', 'DEMO-001')

test('Evaluation recovery reuses one immutable Snapshot and appends attempts and result revisions', async () => {
  const fixture = await createPendingDemoTrial()
  try {
    const initialAttemptPath = join(
      fixture.evidenceDirectory,
      'evaluation-attempts',
      `${fixture.initialAttempt.attemptId}.json`
    )
    const initialRevisionFiles = await jsonFiles(join(fixture.evidenceDirectory, 'result-revisions'))
    const initialAttemptBytes = await readFile(initialAttemptPath, 'utf8')
    const initialRevisionBytes = await readFile(
      join(fixture.evidenceDirectory, 'result-revisions', initialRevisionFiles[0]),
      'utf8'
    )
    const snapshotBefore = await treeManifest(fixture.snapshot.path)

    const recovered = await recoverQualificationEvaluation({
      evidenceDirectory: fixture.evidenceDirectory,
      caseDirectory: demoCaseDirectory,
      expectedSeal: fixture.caseRecord.seal
    })

    assert.equal(recovered.resultBundle.validity, 'valid')
    assert.equal(recovered.resultBundle.evaluationState, 'complete')
    assert.equal(recovered.resultBundle.verifiedDelivery, 'pass')
    assert.equal(recovered.resultBundle.hardOutcome, 'pass')
    assert.equal(recovered.resultBundle.resultRevision.sequence, 2)
    assert.equal(recovered.evaluationAttempt.trigger, 'recovery')
    assert.equal(recovered.evaluationAttempt.identityValidation.status, 'passed')
    assert.deepEqual(Object.keys(recovered.redactedSummary.layers), [
      'hardOutcome',
      'deliveryEvidence',
      'collaborationEvidence',
      'toolEvidence',
      'semanticEngineeringReview'
    ])
    assert.equal(recovered.redactedSummary.layers.hardOutcome.overall, 'pass')
    assert.equal(recovered.redactedSummary.layers.toolEvidence.status, 'unavailable')
    assert.equal('verifier' in recovered.redactedSummary, false)
    assert.equal(recovered.resultBundle.dispatchBoundary.commandId, 'command-original')
    assert.equal(recovered.resultBundle.deliveredWorkspaceSnapshot.digest, snapshotBefore.digest)
    assert.equal(recovered.resultBundle.evidenceIndex.schemaId, 'rovai.qualification.evidence-index')
    assert.equal(recovered.resultBundle.evidenceIndex.recordCount > 0, true)
    assert.equal(recovered.redactedSummary.evidenceIndex.recordCount, recovered.resultBundle.evidenceIndex.recordCount)
    assert.equal(JSON.stringify(recovered.redactedSummary).includes(recovered.resultBundle.evidenceIndex.locator), false)
    assert.equal(recovered.resultBundle.toolCallLedger.schemaId, 'rovai.qualification.tool-call-ledger')
    assert.equal(recovered.redactedSummary.toolCallLedger.recordCount, recovered.resultBundle.toolCallLedger.recordCount)
    assert.equal(JSON.stringify(recovered.redactedSummary).includes(recovered.resultBundle.toolCallLedger.locator), false)
    assert.equal(recovered.resultBundle.workspaceMutationLedger.schemaId, 'rovai.qualification.workspace-mutation-ledger')
    assert.equal(recovered.redactedSummary.workspaceMutationLedger.recordCount, recovered.resultBundle.workspaceMutationLedger.recordCount)
    assert.equal(JSON.stringify(recovered.redactedSummary).includes(recovered.resultBundle.workspaceMutationLedger.locator), false)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'evidence-indexes'))).length, 1)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'tool-call-ledgers'))).length, 1)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'workspace-mutation-ledgers'))).length, 1)
    assert.equal(recovered.publicReport.schemaId, 'rovai.qualification.public-benchmark-report')
    assert.equal(recovered.evidenceBundleManifest.schemaId, 'rovai.qualification.evidence-bundle-manifest')
    const publicReport = JSON.parse(await readFile(
      join(fixture.evidenceDirectory, recovered.publicReport.locator),
      'utf8'
    ))
    assert.equal(publicReport.payload.layer1HardOutcome.overall, 'pass')
    assert.equal(JSON.stringify(publicReport).includes(recovered.resultBundle.evidenceIndex.locator), false)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'public-reports'))).length, 1)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'evidence-bundle-manifests'))).length, 1)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'bundle-completions'))).length, 1)

    const snapshotAfter = await treeManifest(fixture.snapshot.path)
    assert.equal(snapshotAfter.digest, snapshotBefore.digest)
    assert.equal(await readFile(initialAttemptPath, 'utf8'), initialAttemptBytes)
    assert.equal(
      await readFile(join(fixture.evidenceDirectory, 'result-revisions', initialRevisionFiles[0]), 'utf8'),
      initialRevisionBytes
    )
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'evaluation-attempts'))).length, 2)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'result-revisions'))).length, 2)
    assert.equal(
      (await readFile(join(fixture.evidenceDirectory, 'COMPLETE'), 'utf8')).trim(),
      recovered.record.resultDigest
    )

    const history = await loadQualificationResultHistory(fixture.evidenceDirectory)
    assert.equal(history.records.length, 2)
    assert.equal(history.initial.evaluationState, 'pending')
    assert.equal(history.current.evaluationState, 'complete')

    const reconciled = await recoverQualificationEvaluation({
      evidenceDirectory: fixture.evidenceDirectory,
      caseDirectory: demoCaseDirectory,
      expectedSeal: fixture.caseRecord.seal
    })
    assert.equal(reconciled.evaluationAttempt, null)
    assert.equal(reconciled.record.resultDigest, recovered.record.resultDigest)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'evaluation-attempts'))).length, 2)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'result-revisions'))).length, 2)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'evidence-indexes'))).length, 1)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'tool-call-ledgers'))).length, 1)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'workspace-mutation-ledgers'))).length, 1)
    assert.equal(reconciled.publicReport.artifactId, recovered.publicReport.artifactId)
    assert.equal(reconciled.evidenceBundleManifest.artifactId, recovered.evidenceBundleManifest.artifactId)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'public-reports'))).length, 1)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'evidence-bundle-manifests'))).length, 1)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'bundle-completions'))).length, 1)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Irrecoverable Snapshot corruption invalidates the retained Trial without replacing its execution', async () => {
  const fixture = await createPendingDemoTrial()
  try {
    const initialAttemptPath = join(
      fixture.evidenceDirectory,
      'evaluation-attempts',
      `${fixture.initialAttempt.attemptId}.json`
    )
    const initialRevisionFiles = await jsonFiles(join(fixture.evidenceDirectory, 'result-revisions'))
    const initialAttemptBytes = await readFile(initialAttemptPath, 'utf8')
    const initialRevisionPath = join(
      fixture.evidenceDirectory,
      'result-revisions',
      initialRevisionFiles[0]
    )
    const initialRevisionBytes = await readFile(initialRevisionPath, 'utf8')

    await writeFile(join(fixture.snapshot.path, 'tampered-after-freeze.txt'), 'not authoritative\n')
    await assert.rejects(
      recoverQualificationEvaluation({
        evidenceDirectory: fixture.evidenceDirectory,
        caseDirectory: demoCaseDirectory,
        expectedSeal: fixture.caseRecord.seal
      }),
      /recovery\.delivered_snapshot_digest_mismatch/
    )
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'evaluation-attempts'))).length, 2)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'result-revisions'))).length, 1)
    const history = await loadQualificationResultHistory(fixture.evidenceDirectory)
    assert.equal(history.current.evaluationState, 'pending')
    assert.equal(history.current.hardOutcome, 'unavailable')

    const invalidated = await invalidateQualificationEvaluation({
      evidenceDirectory: fixture.evidenceDirectory,
      reasonCode: 'recovery.delivered_snapshot_digest_mismatch'
    })
    assert.equal(invalidated.resultBundle.validity, 'invalid')
    assert.equal(invalidated.resultBundle.evaluationState, 'pending')
    assert.equal(invalidated.resultBundle.verifiedDelivery, 'unavailable')
    assert.equal(invalidated.resultBundle.hardOutcome, 'unavailable')
    assert.equal(invalidated.resultBundle.resultRevision.sequence, 2)
    assert.equal(invalidated.evaluationAttempt.trigger, 'invalidation')
    assert.equal(
      invalidated.redactedSummary.invalidReason.code,
      'recovery.delivered_snapshot_digest_mismatch'
    )
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'evaluation-attempts'))).length, 3)
    assert.equal((await jsonFiles(join(fixture.evidenceDirectory, 'result-revisions'))).length, 2)
    assert.equal(await readFile(initialAttemptPath, 'utf8'), initialAttemptBytes)
    assert.equal(await readFile(initialRevisionPath, 'utf8'), initialRevisionBytes)
    assert.equal(
      (await readFile(join(fixture.evidenceDirectory, 'CAPTURE_COMPLETE'), 'utf8')).trim(),
      fixture.revision.record.resultDigest
    )
    assert.equal(
      (await readFile(join(fixture.evidenceDirectory, 'EVALUATION_PENDING'), 'utf8')).trim(),
      fixture.revision.record.resultDigest
    )
    assert.equal(
      (await readFile(join(fixture.evidenceDirectory, 'IRRECOVERABLE'), 'utf8')).trim(),
      invalidated.record.resultDigest
    )
    const invalidPublicReport = JSON.parse(await readFile(
      join(fixture.evidenceDirectory, invalidated.publicReport.locator),
      'utf8'
    ))
    assert.equal(invalidPublicReport.payload.layer1HardOutcome.validity, 'invalid')
    assert.equal(invalidPublicReport.payload.layer1HardOutcome.overall, 'unavailable')
    const invalidBundle = JSON.parse(await readFile(
      join(fixture.evidenceDirectory, invalidated.evidenceBundleManifest.locator),
      'utf8'
    ))
    assert.equal(invalidBundle.payload.evaluationAttempts.length, 3)
    assert.equal(invalidBundle.payload.artifacts.find(
      (entry) => entry.role === 'qualification_trial'
    ).state, 'present')

    const invalidHistory = await loadQualificationResultHistory(fixture.evidenceDirectory)
    assert.equal(invalidHistory.initial.validity, 'valid')
    assert.equal(invalidHistory.current.validity, 'invalid')
    const suite = buildSuiteProgress([fixture.revision.resultBundle.plannedSlotId], [{
      plannedSlotId: fixture.revision.resultBundle.plannedSlotId,
      dispatchAccepted: invalidated.redactedSummary.dispatchAccepted,
      validity: invalidated.redactedSummary.validity,
      evaluationState: invalidated.redactedSummary.evaluationState,
      hardOutcome: invalidated.redactedSummary.hardOutcome
    }])
    assert.equal(suite.publicationState, 'unpublishable')
    assert.equal(suite.finalPassRate, null)

    await assert.rejects(
      recoverQualificationEvaluation({
        evidenceDirectory: fixture.evidenceDirectory,
        caseDirectory: demoCaseDirectory,
        expectedSeal: fixture.caseRecord.seal
      }),
      /recovery\.trial_not_valid_and_dispatched/
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

async function createPendingDemoTrial() {
  const root = await mkdtemp(join(tmpdir(), 'rovai-qualification-recovery-test-'))
  const evidenceDirectory = join(root, 'evidence')
  const workspace = join(root, 'workspace')
  await mkdir(evidenceDirectory, { mode: 0o700 })
  const caseRecord = await verifyStoredCaseSeal(demoCaseDirectory)
  await copyFixture(caseRecord.contract.fixturePath, workspace)
  await copyFile(
    join(demoCaseDirectory, 'reference', 'src', 'group-events.mjs'),
    join(workspace, 'src', 'group-events.mjs')
  )
  const snapshot = await captureDeliveredWorkspaceSnapshot(workspace, evidenceDirectory)
  const workspaceDiff = treeDiff(caseRecord.contract.fixture, snapshot.manifest)
  const changeBoundary = evaluateChangeBoundary(caseRecord.contract.manifest, workspaceDiff)
  const invalidVerifierObservation = {
    validationState: 'invalid',
    validationErrors: [{ code: 'verifier.process_nonzero', detail: '7' }],
    process: { code: 7, signal: null, timedOut: false },
    checkResults: [],
    output: null,
    rawOutputDigest: null
  }
  const runnerChecks = buildRunnerCheckResults(
    caseRecord.contract.evaluationContract.verificationCatalog,
    { changeBoundary }
  )
  const deliveryEvidence = deriveDeliveryEvidence(
    caseRecord.contract.evaluationContract,
    invalidVerifierObservation,
    runnerChecks
  )
  const convergence = {
    status: 'pass',
    facts: {
      runTree: 'settled',
      conversationInputs: 'settled',
      approvals: 'settled',
      budget: 'compliant',
      runtimeExit: 'complete',
      externalEffects: 'settled'
    },
    failureRecoveryFacts: []
  }
  const humanIntervention = {
    status: 'absent',
    evidence: [],
    coverage: 'public_demo',
    reason: null
  }
  const hardOutcome = deriveHardOutcome({
    dispatchAccepted: true,
    validity: 'valid',
    verifiedDelivery: deliveryEvidence.verifiedDelivery,
    orchestrationConvergence: convergence.status,
    postDispatchHumanIntervention: humanIntervention.status,
    evaluationIssues: deliveryEvidence.evaluationIssues
  })
  assert.equal(hardOutcome.evaluationState, 'pending')
  const deliveryLayer = buildDeliveryLayer({
    deliveryEvidence,
    workspaceDiff,
    changeBoundary,
    verifierObservation: invalidVerifierObservation,
    convergence,
    humanIntervention,
    budgetEvent: null,
    postDispatchError: null,
    finalResponseReferences: []
  })
  const trialId = 'trial-recovery-test'
  const environmentManifest = {
    schemaVersion: 1,
    runnerDigest: await computeQualificationEvaluatorDigest()
  }
  const environmentManifestDigest = digestJson(environmentManifest)
  await writeFile(
    join(evidenceDirectory, 'environment-manifest.json'),
    `${JSON.stringify(environmentManifest, null, 2)}\n`
  )
  const evidenceSnapshot = {
    schemaVersion: 19,
    throughGlobalSequence: 3,
    turns: [{ id: 'turn-original', status: 'completed' }],
    agentRuns: [{
      id: 'run-original',
      campTurnId: 'turn-original',
      status: 'succeeded',
      executionEvidenceCount: 0
    }],
    tasks: [],
    messages: [],
    inboxMessages: [],
    conversationInputs: [],
    approvals: [],
    actions: [],
    executionEvidence: [],
    timeline: []
  }
  const observationRecord = {
    schemaVersion: 1,
    observedAt: '2026-08-03T00:00:59.000Z',
    digest: digestJson(evidenceSnapshot),
    snapshot: evidenceSnapshot
  }
  const observationBytes = `${JSON.stringify(observationRecord)}\n`
  await writeFile(join(evidenceDirectory, 'observations.ndjson'), observationBytes)
  const evaluationIdentity = buildEvaluationIdentity({
    trialId,
    caseSeal: caseRecord.seal,
    deliveredWorkspaceDigest: snapshot.manifest.digest,
    verifierDigest: caseRecord.contract.components.verifierDigest,
    verifierRuntimeDigest: await digestFile(process.execPath),
    verificationCatalogDigest: caseRecord.contract.components.verificationCatalogDigest,
    environmentManifestDigest
  })
  const initialAttempt = await appendEvaluationAttempt(evidenceDirectory, {
    trialId,
    trigger: 'initial',
    evaluationIdentity,
    identityValidation: { status: 'passed', reasons: [] },
    observation: invalidVerifierObservation,
    derivation: { status: 'pending_result_revision' }
  })
  const result = {
    schemaVersion: QUALIFICATION_TRIAL_SCHEMA_VERSION,
    runnerVersion: QUALIFICATION_RUNNER_VERSION,
    trialId,
    plannedSlotId: 'slot-recovery-test',
    mode: 'demo',
    case: {
      id: caseRecord.contract.manifest.id,
      version: caseRecord.contract.manifest.version,
      seal: caseRecord.seal,
      admissionDigest: caseRecord.admission.admissionDigest
    },
    startedAt: '2026-08-03T00:00:00.000Z',
    completedAt: '2026-08-03T00:01:00.000Z',
    dispatchAccepted: true,
    ...hardOutcome,
    stage: 'verification',
    hardLayer: {
      verifiedDelivery: hardOutcome.verifiedDelivery,
      orchestrationConvergence: hardOutcome.orchestrationConvergence,
      postDispatchHumanIntervention: hardOutcome.postDispatchHumanIntervention,
      overall: hardOutcome.overall,
      convergenceFacts: convergence.facts,
      failureRecoveryFacts: convergence.failureRecoveryFacts
    },
    deliveryLayer,
    dispatchBoundary: {
      schemaVersion: 1,
      commandId: 'command-original',
      campTurnId: 'turn-original',
      rootAgentRunId: 'run-original'
    },
    budget: {
      contract: caseRecord.contract.manifest.budget,
      event: null,
      observedAgentRuns: 1,
      observedAcceptedA2a: null,
      observedDurableA2aEffects: 0,
      acceptedA2aAuthority: 'unavailable_until_core_receipt_budget'
    },
    environmentManifestDigest,
    observationDigest: sha256(observationBytes),
    termination: { converged: true },
    baselineTreeDigest: caseRecord.contract.fixture.digest,
    dispatchBaselineTreeDigest: caseRecord.contract.fixture.digest,
    managedProjectionDiff: { schemaVersion: 1, digest: 'managed', changed: [] },
    finalTreeDigest: snapshot.manifest.digest,
    deliveredWorkspaceSnapshot: {
      digest: snapshot.manifest.digest,
      directory: `delivered-workspace-${snapshot.manifest.digest}`,
      evaluationAttemptId: initialAttempt.attemptId
    },
    evaluationIdentity,
    workspaceDiff,
    verifier: invalidVerifierObservation,
    changeBoundary,
    collaborationEvidence: null,
    collaborationAudit: null,
    toolEvidence: {
      status: 'unavailable',
      reason: { code: 'tool_ledger.not_implemented_in_checkpoint_2' }
    },
    semanticEngineeringReview: {
      status: 'unavailable',
      reason: { code: 'semantic_judge.not_invoked' }
    },
    humanInterventionEvidence: humanIntervention,
    evaluationIssues: deliveryEvidence.evaluationIssues,
    postDispatchError: null
  }
  const revision = await appendResultRevision(evidenceDirectory, result, {
    evaluationAttemptId: initialAttempt.attemptId
  })
  await writeFile(join(evidenceDirectory, 'delivered-workspace-manifest.json'), `${JSON.stringify({
    schemaVersion: QUALIFICATION_TRIAL_SCHEMA_VERSION,
    digest: snapshot.manifest.digest,
    entries: snapshot.manifest.entries
  }, null, 2)}\n`)
  await writeFile(join(evidenceDirectory, 'CAPTURE_COMPLETE'), `${revision.record.resultDigest}\n`)
  await writeFile(join(evidenceDirectory, 'EVALUATION_PENDING'), `${revision.record.resultDigest}\n`)
  return { root, evidenceDirectory, workspace, caseRecord, snapshot, initialAttempt, revision }
}

async function jsonFiles(directory) {
  return (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()
}
