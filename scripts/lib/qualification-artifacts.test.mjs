import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyStoredCaseSeal } from './qualification-common.mjs'
import {
  buildAndRetainQualificationArtifacts,
  buildDeliveredWorkspaceSnapshotArtifact,
  buildQualificationCaseArtifact,
  buildQualificationEnvironmentArtifact,
  buildQualificationTrialArtifact,
  buildVerificationCatalogArtifact,
  buildVerifierObservationArtifact
} from './qualification-artifacts.mjs'

test('accepted Trial normalization produces schema-valid Case, Catalog, Snapshot, Verifier, Environment, and Trial envelopes', async () => {
  const caseRecord = await verifyStoredCaseSeal('qualification/demo/DEMO-001')
  const fixture = acceptedFixture(caseRecord)
  const caseArtifact = buildQualificationCaseArtifact(fixture)
  const catalogArtifact = buildVerificationCatalogArtifact(fixture)
  const snapshotArtifact = buildDeliveredWorkspaceSnapshotArtifact({
    ...fixture,
    retainedManifest: fixture.retainedManifest
  })
  const verifierArtifact = buildVerifierObservationArtifact({
    ...fixture,
    catalogArtifact
  })
  const environmentArtifact = buildQualificationEnvironmentArtifact({
    ...fixture,
    rawEnvironment: fixture.rawEnvironment,
    isolationArtifact: null
  })
  const trialArtifact = buildQualificationTrialArtifact({
    ...fixture,
    collaborationLedger: fixture.collaborationLedger,
    toolCallLedger: fixture.toolCallLedger,
    workspaceMutationLedger: fixture.workspaceMutationLedger,
    semanticReview: null,
    evaluationAttempts: fixture.evaluationAttempts
  })

  assert.equal(caseArtifact.schemaId, 'rovai.qualification.case')
  assert.equal(catalogArtifact.schemaVersion, '1.1.0')
  assert.equal(snapshotArtifact.payload.coverage.state, 'complete')
  assert.equal(verifierArtifact.payload.process.state, 'succeeded')
  assert.equal(environmentArtifact.payload.core.readModelSchema, 18)
  assert.equal(environmentArtifact.payload.core.builtinToolContractVersion, 1)
  assert.equal(environmentArtifact.payload.core.builtinToolIpcProtocolVersion, 1)
  assert.equal(environmentArtifact.payload.isolationProfileArtifact, null)
  assert.equal(environmentArtifact.payload.gitRemoteMutationPolicy, 'indeterminate')
  assert.equal(trialArtifact.schemaVersion, '1.1.0')
  assert.equal(trialArtifact.payload.semanticReviewArtifact, null)
})

test('Trial v1.1 represents invalid preflight without fabricating unavailable artifacts', () => {
  const result = {
    schemaVersion: 2,
    trialId: 'invalid-trial',
    plannedSlotId: 'invalid-slot',
    dispatchAccepted: false,
    validity: 'invalid',
    evaluationState: 'pending',
    stage: 'preflight',
    hardOutcome: 'unavailable',
    hardLayer: {
      verifiedDelivery: 'unavailable',
      orchestrationConvergence: 'unavailable',
      postDispatchHumanIntervention: 'indeterminate',
      overall: 'unavailable',
      convergenceFacts: {
        runTree: 'indeterminate',
        conversationInputs: 'indeterminate',
        approvals: 'indeterminate',
        budget: 'indeterminate',
        runtimeExit: 'indeterminate',
        externalEffects: 'indeterminate'
      }
    },
    deliveryLayer: null,
    resultRevision: { revisionId: 'invalid-revision' }
  }
  const artifact = buildQualificationTrialArtifact({
    result,
    producerDigest: 'a'.repeat(64),
    collaborationLedger: null,
    toolCallLedger: null,
    workspaceMutationLedger: null,
    semanticReview: null,
    evidenceIndex: null,
    evaluationAttempts: []
  })

  assert.equal(artifact.payload.hardOutcome, 'unavailable')
  assert.equal(artifact.payload.deliveryLayer, null)
  assert.equal(artifact.payload.evidenceIndexArtifact, null)
})

test('normalized present-role artifacts are immutable and private', async () => {
  const caseRecord = await verifyStoredCaseSeal('qualification/demo/DEMO-001')
  const fixture = acceptedFixture(caseRecord)
  const root = await mkdtemp(join(tmpdir(), 'rovai-normalized-artifacts-'))
  try {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      join(root, 'delivered-workspace-manifest.json'),
      `${JSON.stringify(fixture.retainedManifest)}\n`,
      { mode: 0o600 }
    )
    await writeFile(
      join(root, 'environment-manifest.json'),
      `${JSON.stringify(fixture.rawEnvironment)}\n`,
      { mode: 0o600 }
    )
    const built = await buildAndRetainQualificationArtifacts({
      evidenceDirectory: root,
      result: fixture.result,
      caseRecord,
      producerDigest: fixture.producerDigest,
      evidenceIndex: fixture.evidenceIndex,
      collaborationLedger: fixture.collaborationLedger,
      toolCallLedger: fixture.toolCallLedger,
      workspaceMutationLedger: fixture.workspaceMutationLedger,
      publicReport: fixture.publicReport,
      evaluationAttempts: fixture.evaluationAttempts
    })
    assert.equal(Object.keys(built.artifacts).length, 11)
    for (const locator of Object.values(built.locators)) {
      assert.equal((await stat(join(root, locator))).mode & 0o777, 0o600)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function acceptedFixture(caseRecord) {
  const producerDigest = 'a'.repeat(64)
  const evidenceIndex = indexFixture()
  const result = resultFixture(caseRecord, evidenceIndex)
  const pointer = (name, schemaVersion = '1.0.0') => ({
    artifactId: `${name}:fixture`,
    schemaId: `rovai.qualification.${name}`,
    schemaVersion,
    payloadDigest: `sha256:${'b'.repeat(64)}`,
    payload: {}
  })
  return {
    result,
    caseRecord,
    producerDigest,
    evidenceIndex,
    retainedManifest: {
      schemaVersion: 2,
      digest: 'e'.repeat(64),
      entries: [{
        path: 'src/group-events.mjs',
        type: 'file',
        mode: 420,
        bytes: 12,
        digest: 'f'.repeat(64)
      }]
    },
    collaborationLedger: pointer('collaboration-ledger'),
    toolCallLedger: pointer('tool-call-ledger', '1.1.0'),
    workspaceMutationLedger: pointer('workspace-mutation-ledger'),
    publicReport: pointer('public-benchmark-report'),
    evaluationAttempts: [{
      schemaVersion: 2,
      attemptId: 'attempt-fixture',
      trialId: 'trial-fixture',
      attemptedAt: '2026-08-04T00:00:00.000Z'
    }],
    rawEnvironment: environmentFixture(result)
  }
}

function resultFixture(caseRecord, evidenceIndex) {
  const checks = caseRecord.contract.manifest.verificationCatalog
  const verifierChecks = checks.filter((check) => check.observationAuthority === 'verifier')
  return {
    schemaVersion: 2,
    runnerVersion: '0.34.0',
    trialId: 'trial-fixture',
    suiteId: 'suite-fixture',
    plannedSlotId: 'slot-fixture',
    mode: 'demo',
    startedAt: '2026-08-04T00:00:00.000Z',
    completedAt: '2026-08-04T00:01:00.000Z',
    dispatchAccepted: true,
    validity: 'valid',
    evaluationState: 'complete',
    stage: 'complete',
    hardOutcome: 'pass',
    hardLayer: {
      verifiedDelivery: 'pass',
      orchestrationConvergence: 'pass',
      postDispatchHumanIntervention: 'absent',
      overall: 'pass',
      convergenceFacts: {
        runTree: 'settled',
        conversationInputs: 'settled',
        approvals: 'settled',
        budget: 'compliant',
        runtimeExit: 'complete',
        externalEffects: 'settled'
      }
    },
    case: {
      id: caseRecord.contract.manifest.id,
      version: caseRecord.contract.manifest.version,
      seal: caseRecord.seal
    },
    isolationProfile: { status: 'not_applicable' },
    deliveredWorkspaceSnapshot: {
      digest: 'e'.repeat(64),
      directory: `delivered-workspace-${'e'.repeat(64)}`,
      capturedAt: '2026-08-04T00:00:50.000Z',
      evaluationAttemptId: 'attempt-fixture'
    },
    managedProjectionDiff: { digest: '1'.repeat(64), changed: [] },
    evaluationIdentity: {
      verifierDigest: caseRecord.contract.components.verifierDigest,
      verifierConfigurationDigest: '2'.repeat(64)
    },
    dispatchBoundary: {
      runnerObservedAcceptedAt: '2026-08-04T00:00:00.100Z',
      executionBudget: { deadlineAt: '2026-08-04T00:05:00.100Z' }
    },
    verifier: {
      validationState: 'valid',
      validationErrors: [],
      process: { code: 0, signal: null, timedOut: false },
      checkResults: verifierChecks.map((check) => ({ ...check, status: 'passed' }))
    },
    deliveryLayer: {
      requirements: caseRecord.contract.manifest.requirements.map((requirement) => ({
        ...requirement,
        status: 'passed',
        checkIds: checks.filter((check) => check.requirementIds.includes(requirement.requirementId))
          .map((check) => check.checkId)
      })),
      categories: [...new Set(checks.map((check) => check.categoryId))].map((categoryId) => ({
        categoryId,
        status: 'passed',
        checkIds: checks.filter((check) => check.categoryId === categoryId).map((check) => check.checkId)
      })),
      failedRequirementIds: [],
      primaryFailureStage: null,
      failureFacts: [],
      workspaceChangeSummary: {
        coverage: 'complete',
        created: 0,
        modified: 1,
        deleted: 0,
        renamed: 0
      },
      finalResponseEvidence: [{
        evidenceReference: {
          artifactId: evidenceIndex.artifactId,
          evidenceId: 'core.message:final'
        }
      }]
    },
    resultRevision: { revisionId: 'revision-fixture' }
  }
}

function indexFixture() {
  const artifactId = 'evidence-index:fixture'
  const evidenceIds = [
    'runner.delivered-workspace-boundary',
    'core.message:final',
    'verifier.check:CHK-GROUPING',
    'verifier.check:CHK-REGRESSION',
    'verifier.check:CHK-VERIFIER-DIAGNOSTIC'
  ]
  return {
    artifactId,
    schemaId: 'rovai.qualification.evidence-index',
    schemaVersion: '1.0.0',
    payloadDigest: `sha256:${'3'.repeat(64)}`,
    sourceBoundaries: [{
      authorityClass: 'runner',
      sourceId: 'runner.workspace',
      digest: `sha256:${'4'.repeat(64)}`,
      throughSequence: null,
      declaredTotal: null,
      clockDomain: null,
      coverage: { state: 'complete', reason: null }
    }],
    payload: { records: evidenceIds.map((evidenceId) => ({ evidenceId })) }
  }
}

function environmentFixture(result) {
  return {
    runnerVersion: '0.34.0',
    runnerDigest: '5'.repeat(64),
    mode: 'demo',
    collectedAt: '2026-08-04T00:00:00.000Z',
    productGit: {
      commit: '6'.repeat(40),
      dirty: true,
      statusDigest: '7'.repeat(64)
    },
    releaseCore: {
      digest: '8'.repeat(64),
      packaged: false,
      version: '0.1.0',
      readModelSchema: 18,
      builtinToolContractVersion: 1,
      builtinToolIpcProtocolVersion: 1,
      builtinToolCatalogDigest: '9'.repeat(64)
    },
    host: {
      type: 'Darwin',
      release: '25.3.0',
      architecture: 'arm64',
      timezone: 'Asia/Shanghai'
    },
    case: result.case,
    team: [{
      agentId: 'agent-lead',
      runtimeConfiguration: {
        adapterKind: 'codex-cli',
        model: { modelId: 'snapshot-model', options: {} },
        permissions: {}
      },
      readiness: { status: 'ready' }
    }],
    runtimeInstallations: [{
      adapterKind: 'codex-cli',
      reportedVersion: 'codex-cli 1.0.0',
      executableFingerprint: `sha256:${'9'.repeat(64)}`,
      capabilitiesDigest: 'a'.repeat(64)
    }],
    interventionIsolationProfile: {
      status: 'not_applicable',
      reason: { code: 'intervention_isolation.public_demo' }
    },
    toolchain: [{ name: 'node', version: 'v26.5.0', outputDigest: 'b'.repeat(64) }],
    teamRuntimeCompatibilityDigest: 'c'.repeat(64)
  }
}
