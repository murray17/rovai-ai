import { readFile, readdir, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  QUALIFICATION_RUNNER_VERSION,
  atomicWriteJson,
  canonicalJson,
  digestJson,
  sha256,
  validateRelativeLocator,
  writePrivateJsonExclusive
} from './qualification-common.mjs'
import {
  buildPublicBenchmarkReport,
  retainPublicBenchmarkReportArtifact
} from './qualification-public-report.mjs'
import { buildAndRetainQualificationArtifacts } from './qualification-artifacts.mjs'
import { validateQualificationArtifactSchema } from './qualification-schema-validation.mjs'

export const EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID = 'rovai.qualification.evidence-bundle-manifest'
export const EVIDENCE_BUNDLE_MANIFEST_SCHEMA_VERSION = '1.0.0'

const ARTIFACT_ROLES = Object.freeze([
  'qualification_case',
  'verification_catalog',
  'qualification_trial',
  'delivered_workspace_snapshot',
  'verifier_observation',
  'evidence_index',
  'collaboration_ledger',
  'tool_call_ledger',
  'workspace_mutation_ledger',
  'semantic_engineering_review',
  'environment_manifest',
  'intervention_isolation_profile',
  'public_export'
])

export function buildEvidenceBundleManifest({
  result,
  resultDigest,
  caseRecord = null,
  producerDigest,
  publicReport,
  normalizedArtifacts = null,
  evaluationAttempts = [],
  completedAt = result?.resultRevision?.recordedAt ?? result?.completedAt
}) {
  if (!validTimestamp(completedAt)) throw new Error('Evidence Bundle completedAt is invalid')
  const identity = sha256(`${result.trialId}:${result.resultRevision?.revisionId ?? 'capture'}`).slice(0, 32)
  const caseDigest = result.case?.seal ?? caseRecord?.seal ?? null
  const catalogDigest = result.evaluationIdentity?.verificationCatalogDigest
    ?? caseRecord?.contract?.components?.verificationCatalogDigest
    ?? null
  const artifacts = [
    entry('qualification_case', normalizedArtifacts !== null
      ? normalizedArtifactState(normalizedArtifacts, 'qualification_case', 'evidence_bundle.qualification_case_unavailable')
      : caseRecord || result.case
      ? present({
          artifactId: `qualification-case:${stableIdentity(result.case?.id ?? caseRecord.contract.manifest.id)}`,
          schemaId: 'rovai.qualification.qualification-case',
          schemaVersion: '1.0.0',
          payloadDigest: withSha256Prefix(caseDigest)
        })
      : unavailable('evidence_bundle.qualification_case_unavailable')),
    entry('verification_catalog', normalizedArtifacts !== null
      ? normalizedArtifactState(normalizedArtifacts, 'verification_catalog', 'evidence_bundle.verification_catalog_unavailable')
      : catalogDigest
      ? present({
          artifactId: `verification-catalog:${identity}`,
          schemaId: 'rovai.qualification.verification-catalog',
          schemaVersion: '1.1.0',
          payloadDigest: withSha256Prefix(catalogDigest)
        })
      : unavailable('evidence_bundle.verification_catalog_unavailable')),
    entry('qualification_trial', normalizedArtifacts !== null
      ? normalizedArtifactState(normalizedArtifacts, 'qualification_trial', 'evidence_bundle.qualification_trial_unavailable')
      : present({
      artifactId: `qualification-trial:${stableIdentity(result.resultRevision?.revisionId ?? identity)}`,
      schemaId: 'rovai.qualification.qualification-trial',
      schemaVersion: `${Number.isInteger(result.schemaVersion) ? result.schemaVersion : 1}.0.0`,
      payloadDigest: withSha256Prefix(resultDigest)
    })),
    entry('delivered_workspace_snapshot', normalizedArtifacts !== null
      ? normalizedArtifactState(normalizedArtifacts, 'delivered_workspace_snapshot', 'evidence_bundle.delivered_workspace_snapshot_unavailable')
      : result.deliveredWorkspaceSnapshot
      ? present({
          artifactId: `delivered-workspace-snapshot:${result.deliveredWorkspaceSnapshot.digest.slice(0, 32)}`,
          schemaId: 'rovai.qualification.delivered-workspace-snapshot',
          schemaVersion: '1.0.0',
          payloadDigest: withSha256Prefix(result.deliveredWorkspaceSnapshot.digest)
        })
      : unavailable('evidence_bundle.delivered_workspace_snapshot_unavailable')),
    entry('verifier_observation', normalizedArtifacts !== null
      ? normalizedArtifactState(normalizedArtifacts, 'verifier_observation', 'evidence_bundle.verifier_observation_unavailable')
      : result.verifier
      ? present({
          artifactId: `verifier-observation:${identity}`,
          schemaId: 'rovai.qualification.verifier-observation',
          schemaVersion: '1.0.0',
          payloadDigest: digest(result.verifier)
        })
      : unavailable('evidence_bundle.verifier_observation_unavailable')),
    entry('evidence_index', artifactState(
      normalizedArtifacts !== null ? normalizedArtifacts.evidence_index : result.evidenceIndex,
      'evidence_bundle.evidence_index_unavailable'
    )),
    entry('collaboration_ledger', artifactState(
      normalizedArtifacts !== null ? normalizedArtifacts.collaboration_ledger : result.collaborationLedger,
      'evidence_bundle.collaboration_ledger_unavailable'
    )),
    entry('tool_call_ledger', artifactState(
      normalizedArtifacts !== null ? normalizedArtifacts.tool_call_ledger : result.toolCallLedger,
      'evidence_bundle.tool_call_ledger_unavailable'
    )),
    entry('workspace_mutation_ledger', artifactState(
      normalizedArtifacts !== null ? normalizedArtifacts.workspace_mutation_ledger : result.workspaceMutationLedger,
      'evidence_bundle.workspace_mutation_ledger_unavailable'
    )),
    entry('semantic_engineering_review', semanticReviewState(
      normalizedArtifacts !== null
        ? normalizedArtifacts.semantic_engineering_review
        : result.semanticEngineeringReview
    )),
    entry('environment_manifest', normalizedArtifacts !== null
      ? normalizedArtifactState(normalizedArtifacts, 'environment_manifest', 'evidence_bundle.environment_manifest_unavailable')
      : result.environmentManifestDigest
      ? present({
          artifactId: `qualification-environment:${identity}`,
          schemaId: 'rovai.qualification.qualification-environment-manifest',
          schemaVersion: '1.0.0',
          payloadDigest: withSha256Prefix(result.environmentManifestDigest)
        })
      : unavailable('evidence_bundle.environment_manifest_unavailable')),
    entry('intervention_isolation_profile', normalizedArtifacts !== null
      ? normalizedArtifactState(
          normalizedArtifacts,
          'intervention_isolation_profile',
          result.mode === 'formal'
            ? 'evidence_bundle.intervention_isolation_profile_unavailable'
            : 'evidence_bundle.intervention_isolation_profile_not_applicable',
          result.mode === 'formal' ? 'unavailable' : 'not_applicable'
        )
      : isolationProfileState(result.isolationProfile)),
    entry('public_export', present(normalizedArtifacts?.public_export ?? publicReport))
  ]
  const attemptReferences = evaluationAttempts
    .map(evaluationAttemptReference)
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
  const payload = {
    bundleId: `evidence-bundle:${identity}`,
    bundleKind: result.dispatchAccepted ? 'accepted_execution' : 'pre_dispatch_attempt',
    artifacts,
    evaluationAttempts: attemptReferences,
    completion: {
      state: 'complete',
      completedAt,
      integrityIssues: []
    }
  }
  const sourceProjection = {
    bundleKind: payload.bundleKind,
    artifacts: payload.artifacts.map(({ role, state, artifact, reason }) => ({
      role,
      state,
      artifact,
      reason
    })),
    evaluationAttempts: attemptReferences
  }
  const artifact = {
    artifactId: `evidence-bundle-manifest:${identity}`,
    schemaId: EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID,
    schemaVersion: EVIDENCE_BUNDLE_MANIFEST_SCHEMA_VERSION,
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
      sourceId: 'derived.evidence-bundle-assembly',
      digest: digest(sourceProjection),
      throughSequence: null,
      declaredTotal: artifacts.length,
      clockDomain: null,
      coverage: { state: 'complete', reason: null }
    }],
    payloadDigest: digest(payload),
    payload
  }
  validateEvidenceBundleManifest(artifact)
  return artifact
}

export async function retainEvidenceBundleManifestArtifact(evidenceDirectory, artifact) {
  validateEvidenceBundleManifest(artifact)
  const locator = join('evidence-bundle-manifests', `${artifact.artifactId}.json`)
  const immutablePath = join(evidenceDirectory, locator)
  await writeImmutableJsonOrVerify(immutablePath, artifact)
  await atomicWriteJson(join(evidenceDirectory, 'evidence-bundle-manifest.json'), artifact)
  const marker = {
    schemaVersion: 1,
    artifactId: artifact.artifactId,
    payloadDigest: artifact.payloadDigest,
    manifestDigest: withSha256Prefix(sha256(await readFile(immutablePath))),
    completedAt: artifact.payload.completion.completedAt
  }
  const markerLocator = join('bundle-completions', `${artifact.artifactId}.json`)
  await writeImmutableJsonOrVerify(join(evidenceDirectory, markerLocator), marker)
  await atomicWriteJson(join(evidenceDirectory, 'BUNDLE_COMPLETE'), marker)
  return {
    artifactId: artifact.artifactId,
    schemaId: artifact.schemaId,
    schemaVersion: artifact.schemaVersion,
    payloadDigest: artifact.payloadDigest,
    manifestDigest: marker.manifestDigest,
    locator,
    completionMarkerLocator: markerLocator,
    completion: artifact.payload.completion
  }
}

export async function publishQualificationEvidenceBundle({
  evidenceDirectory,
  result,
  resultDigest,
  caseRecord = null,
  producerDigest,
  evidenceIndex = undefined,
  collaborationLedger = undefined,
  toolCallLedger = undefined,
  workspaceMutationLedger = undefined,
  evaluationAttempts = undefined
}) {
  const retained = evidenceIndex === undefined
    || collaborationLedger === undefined
    || toolCallLedger === undefined
    || workspaceMutationLedger === undefined
    ? await loadRetainedQualificationArtifacts(evidenceDirectory, result)
    : null
  const resolvedEvidenceIndex = evidenceIndex ?? retained?.evidenceIndex ?? null
  const resolvedCollaborationLedger = collaborationLedger ?? retained?.collaborationLedger ?? null
  const resolvedToolCallLedger = toolCallLedger ?? retained?.toolCallLedger ?? null
  const resolvedWorkspaceMutationLedger = workspaceMutationLedger
    ?? retained?.workspaceMutationLedger
    ?? null
  const attempts = evaluationAttempts ?? await loadEvaluationAttempts(
    evidenceDirectory,
    result.trialId,
    result.resultRevision?.recordedAt ?? null
  )
  const caseTitle = caseRecord?.contract?.manifest?.title
    ?? (result.case?.id ? `Qualification ${result.case.id}` : 'Unavailable Qualification Case')
  const publicReportArtifact = buildPublicBenchmarkReport({
    result,
    caseTitle,
    producerDigest,
    evidenceIndex: resolvedEvidenceIndex,
    collaborationLedger: resolvedCollaborationLedger,
    toolCallLedger: resolvedToolCallLedger,
    workspaceMutationLedger: resolvedWorkspaceMutationLedger
  })
  const publicReport = await retainPublicBenchmarkReportArtifact(
    evidenceDirectory,
    publicReportArtifact,
    resolvedEvidenceIndex
  )
  const normalized = await buildAndRetainQualificationArtifacts({
    evidenceDirectory,
    result,
    caseRecord,
    producerDigest,
    evidenceIndex: resolvedEvidenceIndex,
    collaborationLedger: resolvedCollaborationLedger,
    toolCallLedger: resolvedToolCallLedger,
    workspaceMutationLedger: resolvedWorkspaceMutationLedger,
    publicReport: publicReportArtifact,
    semanticReview: result.semanticEngineeringReview?.artifactId
      ? result.semanticEngineeringReview
      : null,
    evaluationAttempts: attempts
  })
  const manifestArtifact = buildEvidenceBundleManifest({
    result,
    resultDigest,
    caseRecord,
    producerDigest,
    publicReport,
    normalizedArtifacts: normalized.artifacts,
    evaluationAttempts: attempts
  })
  const evidenceBundleManifest = await retainEvidenceBundleManifestArtifact(
    evidenceDirectory,
    manifestArtifact
  )
  return {
    publicReport,
    evidenceBundleManifest,
    normalizedArtifacts: normalized
  }
}

export function validateEvidenceBundleManifest(artifact) {
  if (artifact?.schemaId !== EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID
      || artifact.schemaVersion !== EVIDENCE_BUNDLE_MANIFEST_SCHEMA_VERSION
      || artifact.payloadDigest !== digest(artifact.payload)) {
    throw new Error('Evidence Bundle Manifest envelope identity is invalid')
  }
  const roles = artifact.payload.artifacts.map((entry_) => entry_.role)
  if (roles.length !== ARTIFACT_ROLES.length
      || new Set(roles).size !== ARTIFACT_ROLES.length
      || ARTIFACT_ROLES.some((role) => !roles.includes(role))) {
    throw new Error('Evidence Bundle Manifest artifact roles are not exact and unique')
  }
  for (const entry_ of artifact.payload.artifacts) {
    if (entry_.state === 'present') {
      if (entry_.mediaType !== 'application/json' || !validArtifactReference(entry_.artifact) || entry_.reason !== null) {
        throw new Error(`Evidence Bundle Manifest present role ${entry_.role} is invalid`)
      }
    } else if (entry_.mediaType !== null
        || entry_.artifact !== null
        || !stableReason(entry_.reason)) {
      throw new Error(`Evidence Bundle Manifest unavailable role ${entry_.role} is invalid`)
    }
  }
  const attemptIds = new Set()
  for (const attempt of artifact.payload.evaluationAttempts) {
    if (!validArtifactReference(attempt) || attemptIds.has(attempt.artifactId)) {
      throw new Error('Evidence Bundle Manifest Evaluation Attempt references are invalid')
    }
    attemptIds.add(attempt.artifactId)
  }
  const completion = artifact.payload.completion
  if (completion.state === 'complete') {
    if (!validTimestamp(completion.completedAt) || completion.integrityIssues.length !== 0) {
      throw new Error('Evidence Bundle Manifest complete state has integrity issues')
    }
  } else if (completion.completedAt !== null) {
    throw new Error('Evidence Bundle Manifest incomplete state has a completion timestamp')
  }
  assertNoLocator(artifact)
  validateQualificationArtifactSchema('evidence-bundle-manifest.schema.json', artifact)
  return artifact
}

export async function loadRetainedQualificationArtifacts(evidenceDirectory, result) {
  const root = await realpath(resolve(evidenceDirectory))
  const load = async (pointer) => {
    if (!pointer?.locator) return null
    const locator = validateRelativeLocator(pointer.locator, 'Qualification artifact locator')
    const path = await realpath(join(root, locator))
    if (path !== root && !path.startsWith(`${root}${sep}`)) {
      throw new Error('Qualification artifact locator escapes the Evidence Bundle')
    }
    const artifact = JSON.parse(await readFile(path, 'utf8'))
    if (artifact.artifactId !== pointer.artifactId
        || artifact.schemaId !== pointer.schemaId
        || artifact.schemaVersion !== pointer.schemaVersion
        || artifact.payloadDigest !== pointer.payloadDigest) {
      throw new Error('Retained Qualification artifact identity does not match its result reference')
    }
    return artifact
  }
  return {
    evidenceIndex: await load(result.evidenceIndex),
    collaborationLedger: await load(result.collaborationLedger),
    toolCallLedger: await load(result.toolCallLedger),
    workspaceMutationLedger: await load(result.workspaceMutationLedger)
  }
}

export function evaluationAttemptReference(attempt) {
  return {
    artifactId: `evaluation-attempt:${stableIdentity(attempt.attemptId)}`,
    schemaId: 'rovai.qualification.evaluation-attempt',
    schemaVersion: `${Number.isInteger(attempt.schemaVersion) ? attempt.schemaVersion : 1}.0.0`,
    payloadDigest: digest(attempt)
  }
}

async function loadEvaluationAttempts(evidenceDirectory, trialId, throughTimestamp) {
  const directory = join(evidenceDirectory, 'evaluation-attempts')
  let names
  try {
    names = await readdir(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const attempts = []
  for (const name of names.filter((value) => value.endsWith('.json')).sort()) {
    const attempt = JSON.parse(await readFile(join(directory, name), 'utf8'))
    if (attempt.trialId !== trialId) continue
    if (throughTimestamp && validTimestamp(attempt.attemptedAt)
        && Date.parse(attempt.attemptedAt) > Date.parse(throughTimestamp)) continue
    attempts.push(attempt)
  }
  return attempts
}

function entry(role, state) {
  return { role, ...state }
}

function present(artifact) {
  return {
    state: 'present',
    mediaType: 'application/json',
    artifact: artifactReference(artifact),
    reason: null
  }
}

function unavailable(code) {
  return {
    state: 'unavailable',
    mediaType: null,
    artifact: null,
    reason: { code }
  }
}

function notApplicable(code) {
  return {
    state: 'not_applicable',
    mediaType: null,
    artifact: null,
    reason: { code }
  }
}

function artifactState(pointer, reasonCode) {
  return pointer ? present(pointer) : unavailable(reasonCode)
}

function normalizedArtifactState(
  normalizedArtifacts,
  role,
  reasonCode,
  absentState = 'unavailable'
) {
  if (normalizedArtifacts[role]) return present(normalizedArtifacts[role])
  return absentState === 'not_applicable'
    ? notApplicable(reasonCode)
    : unavailable(reasonCode)
}

function semanticReviewState(review) {
  if (review?.artifactId) return present(review)
  return unavailable(review?.reason?.code ?? 'semantic_judge.unavailable')
}

function isolationProfileState(profile) {
  if (profile?.status === 'admitted' && profile.artifactId && profile.payloadDigest) {
    return present({
      artifactId: profile.artifactId,
      schemaId: 'rovai.qualification.intervention-isolation-profile',
      schemaVersion: profile.schemaVersion,
      payloadDigest: profile.payloadDigest
    })
  }
  if (profile?.status === 'not_applicable') {
    return notApplicable(profile.reason?.code ?? 'intervention_isolation.not_applicable')
  }
  return unavailable(profile?.reason?.code ?? 'intervention_isolation.profile_unavailable')
}

function artifactReference(pointer) {
  return {
    artifactId: pointer.artifactId,
    schemaId: pointer.schemaId,
    schemaVersion: pointer.schemaVersion,
    payloadDigest: withSha256Prefix(pointer.payloadDigest)
  }
}

function validArtifactReference(reference) {
  return typeof reference?.artifactId === 'string'
    && typeof reference.schemaId === 'string'
    && /^\d+\.\d+\.\d+$/.test(reference.schemaVersion ?? '')
    && /^sha256:[a-f0-9]{64}$/.test(reference.payloadDigest ?? '')
}

function stableReason(reason) {
  return typeof reason?.code === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(reason.code)
}

function stableIdentity(value) {
  const text = String(value)
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(text)
    ? text
    : sha256(text).slice(0, 32)
}

function assertNoLocator(value) {
  visit(value)
  function visit(item) {
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (!item || typeof item !== 'object') return
    for (const [key, child] of Object.entries(item)) {
      if (key === 'locator' || key === 'completionMarkerLocator') {
        throw new Error('Evidence Bundle Manifest contains a private locator')
      }
      visit(child)
    }
  }
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
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
      throw new Error('immutable Evidence Bundle artifact identity collision')
    }
  }
}
