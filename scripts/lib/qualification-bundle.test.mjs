import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { digestJson } from './qualification-common.mjs'
import {
  buildEvidenceBundleManifest,
  retainEvidenceBundleManifestArtifact,
  validateEvidenceBundleManifest
} from './qualification-bundle.mjs'

test('Evidence Bundle Manifest publishes one explicit state for every frozen artifact role', () => {
  const result = acceptedResult()
  const artifact = buildEvidenceBundleManifest({
    result,
    resultDigest: 'a'.repeat(64),
    caseRecord: caseRecordFixture(),
    producerDigest: 'b'.repeat(64),
    publicReport: publicReportReference(),
    evaluationAttempts: [evaluationAttemptFixture()]
  })

  assert.equal(artifact.payloadDigest, `sha256:${digestJson(artifact.payload)}`)
  assert.equal(artifact.payload.bundleKind, 'accepted_execution')
  assert.equal(artifact.payload.artifacts.length, 13)
  assert.equal(new Set(artifact.payload.artifacts.map((entry) => entry.role)).size, 13)
  assert.equal(role(artifact, 'semantic_engineering_review').state, 'unavailable')
  assert.equal(role(artifact, 'intervention_isolation_profile').state, 'not_applicable')
  assert.equal(role(artifact, 'tool_call_ledger').artifact.schemaVersion, '1.1.0')
  assert.equal(artifact.payload.evaluationAttempts.length, 1)
  assert.equal(JSON.stringify(artifact).includes('private/tool.json'), false)
  assert.equal(JSON.stringify(artifact).includes('runtime-private-log.ndjson'), false)
})

test('Evidence Bundle completion marker binds immutable manifest bytes with private permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-evidence-bundle-'))
  const artifact = buildEvidenceBundleManifest({
    result: acceptedResult(),
    resultDigest: 'a'.repeat(64),
    caseRecord: caseRecordFixture(),
    producerDigest: 'b'.repeat(64),
    publicReport: publicReportReference(),
    evaluationAttempts: [evaluationAttemptFixture()]
  })
  try {
    const retained = await retainEvidenceBundleManifestArtifact(root, artifact)
    const marker = JSON.parse(await readFile(join(root, 'BUNDLE_COMPLETE'), 'utf8'))
    const manifestBytes = await readFile(join(root, retained.locator))
    assert.equal(marker.artifactId, artifact.artifactId)
    assert.equal(marker.payloadDigest, artifact.payloadDigest)
    assert.equal(
      marker.manifestDigest,
      `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`
    )
    assert.equal(retained.manifestDigest, marker.manifestDigest)
    if (process.platform !== 'win32') {
      assert.equal((await stat(join(root, retained.locator))).mode & 0o777, 0o600)
      assert.equal((await stat(join(root, retained.completionMarkerLocator))).mode & 0o777, 0o600)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Evidence Bundle Manifest rejects duplicate roles, locator smuggling, and false completion', () => {
  const artifact = buildEvidenceBundleManifest({
    result: acceptedResult(),
    resultDigest: 'a'.repeat(64),
    caseRecord: caseRecordFixture(),
    producerDigest: 'b'.repeat(64),
    publicReport: publicReportReference(),
    evaluationAttempts: [evaluationAttemptFixture()]
  })

  const duplicate = structuredClone(artifact)
  duplicate.payload.artifacts[1].role = duplicate.payload.artifacts[0].role
  redigest(duplicate)
  assert.throws(() => validateEvidenceBundleManifest(duplicate), /roles are not exact and unique/)

  const locator = structuredClone(artifact)
  role(locator, 'tool_call_ledger').artifact.locator = 'private/tool.json'
  redigest(locator)
  assert.throws(() => validateEvidenceBundleManifest(locator), /private locator/)

  const falseCompletion = structuredClone(artifact)
  falseCompletion.payload.completion.integrityIssues.push({ code: 'bundle.incomplete' })
  redigest(falseCompletion)
  assert.throws(() => validateEvidenceBundleManifest(falseCompletion), /complete state has integrity issues/)
})

test('Pre-dispatch invalid attempt records unavailable roles instead of fabricating artifacts', () => {
  const result = {
    schemaVersion: 2,
    trialId: 'trial-invalid',
    plannedSlotId: 'slot-invalid',
    mode: 'formal',
    dispatchAccepted: false,
    completedAt: '2026-08-04T00:00:00.000Z',
    resultRevision: {
      revisionId: 'revision-invalid',
      recordedAt: '2026-08-04T00:00:00.000Z'
    },
    semanticEngineeringReview: {
      status: 'unavailable',
      reason: { code: 'semantic_judge.not_invoked' }
    }
  }
  const artifact = buildEvidenceBundleManifest({
    result,
    resultDigest: 'a'.repeat(64),
    producerDigest: 'b'.repeat(64),
    publicReport: publicReportReference()
  })

  assert.equal(artifact.payload.bundleKind, 'pre_dispatch_attempt')
  for (const requiredUnavailable of [
    'qualification_case',
    'verification_catalog',
    'delivered_workspace_snapshot',
    'verifier_observation',
    'evidence_index',
    'collaboration_ledger',
    'tool_call_ledger',
    'workspace_mutation_ledger',
    'environment_manifest',
    'intervention_isolation_profile'
  ]) {
    assert.equal(role(artifact, requiredUnavailable).state, 'unavailable')
  }
  assert.equal(role(artifact, 'qualification_trial').state, 'present')
  assert.equal(role(artifact, 'public_export').state, 'present')
})

function acceptedResult() {
  const pointer = (name, version = '1.0.0') => ({
    artifactId: `${name}:one`,
    schemaId: `rovai.qualification.${name}`,
    schemaVersion: version,
    payloadDigest: `sha256:${'c'.repeat(64)}`,
    locator: `private/${name}.json`
  })
  return {
    schemaVersion: 2,
    trialId: 'trial-1',
    suiteId: 'suite-1',
    plannedSlotId: 'slot-1',
    mode: 'demo',
    dispatchAccepted: true,
    completedAt: '2026-08-04T00:00:00.000Z',
    case: { id: 'CASE-1', version: '1.0.0', seal: 'd'.repeat(64) },
    evaluationIdentity: { verificationCatalogDigest: 'e'.repeat(64) },
    deliveredWorkspaceSnapshot: { digest: 'f'.repeat(64), directory: 'private-workspace' },
    verifier: { schemaVersion: '1.0.0', validationState: 'valid' },
    evidenceIndex: pointer('evidence-index'),
    collaborationLedger: pointer('collaboration-ledger'),
    toolCallLedger: pointer('tool-call-ledger', '1.1.0'),
    workspaceMutationLedger: pointer('workspace-mutation-ledger'),
    semanticEngineeringReview: {
      status: 'unavailable',
      reason: { code: 'semantic_judge.not_invoked' }
    },
    environmentManifestDigest: '1'.repeat(64),
    isolationProfile: {
      status: 'not_applicable',
      reason: { code: 'intervention_isolation.public_demo' }
    },
    resultRevision: {
      revisionId: 'revision-1',
      recordedAt: '2026-08-04T00:00:00.000Z'
    }
  }
}

function caseRecordFixture() {
  return {
    seal: 'd'.repeat(64),
    contract: {
      manifest: { id: 'CASE-1' },
      components: { verificationCatalogDigest: 'e'.repeat(64) }
    }
  }
}

function publicReportReference() {
  return {
    artifactId: 'public-benchmark-report:one',
    schemaId: 'rovai.qualification.public-benchmark-report',
    schemaVersion: '1.0.0',
    payloadDigest: `sha256:${'2'.repeat(64)}`,
    locator: 'private/public-report.json'
  }
}

function evaluationAttemptFixture() {
  return {
    schemaVersion: 2,
    attemptId: 'attempt-1',
    trialId: 'trial-1',
    attemptedAt: '2026-08-04T00:00:00.000Z'
  }
}

function role(artifact, name) {
  return artifact.payload.artifacts.find((entry) => entry.role === name)
}

function redigest(artifact) {
  artifact.payloadDigest = `sha256:${digestJson(artifact.payload)}`
}
