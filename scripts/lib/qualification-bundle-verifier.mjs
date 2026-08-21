import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { artifactFileName, canonicalJson, digestJson, sha256 } from './qualification-common.mjs'
import { validateEvidenceBundleManifest } from './qualification-bundle.mjs'
import { validateCatalogedQualificationArtifact } from './qualification-schema-validation.mjs'
import {
  JUDGE_VIEW_SUITE_SCHEMA_ID,
  validateJudgeViewConfiguration,
  validateJudgeViewPack,
  validateJudgeViewReplicaResult,
  validateJudgeViewReview,
  validateSemanticJudgeViewSuite
} from './qualification-judge-views.mjs'
import {
  validateJudgeEvidencePack,
  validateSemanticJudgeConfiguration
} from './qualification-semantic-judge.mjs'
import {
  validateCollaborationMessageEvidence
} from './qualification-semantic-evidence.mjs'
import {
  validateToolInteractionArtifacts,
  validateToolInteractionSourceArtifact
} from './tool-interaction-measurement/index.mjs'
import {
  validateToolUseJudgeConfiguration,
  validateToolUseJudgeReplicaResult,
  validateToolUseReviewArtifacts
} from './qualification-tool-use-judge.mjs'

const ROLE_LOCATORS = Object.freeze({
  qualification_case: (id) => join('normalized-artifacts', 'qualification_case', artifactFileName(id)),
  verification_catalog: (id) => join('normalized-artifacts', 'verification_catalog', artifactFileName(id)),
  qualification_trial: (id) => join('normalized-artifacts', 'qualification_trial', artifactFileName(id)),
  delivered_workspace_snapshot: (id) => join('normalized-artifacts', 'delivered_workspace_snapshot', artifactFileName(id)),
  verifier_observation: (id) => join('normalized-artifacts', 'verifier_observation', artifactFileName(id)),
  evidence_index: (id) => join('evidence-indexes', artifactFileName(id)),
  collaboration_ledger: (id) => join('collaboration-ledgers', artifactFileName(id)),
  tool_call_ledger: (id) => join('tool-call-ledgers', artifactFileName(id)),
  workspace_mutation_ledger: (id) => join('workspace-mutation-ledgers', artifactFileName(id)),
  semantic_engineering_review: (id) => join('semantic-engineering-reviews', artifactFileName(id)),
  environment_manifest: (id) => join('normalized-artifacts', 'environment_manifest', artifactFileName(id)),
  intervention_isolation_profile: () => 'intervention-isolation-profile.json',
  public_export: (id) => join('public-reports', artifactFileName(id))
})

export async function verifyQualificationEvidenceBundle(evidenceDirectory, {
  forbiddenCanaries = [],
  deferSafeProjectionChecks = false
} = {}) {
  const root = await realpath(resolve(evidenceDirectory))
  const manifest = await readJson(join(root, 'evidence-bundle-manifest.json'))
  validateEvidenceBundleManifest(manifest)
  const marker = await readJson(join(root, 'BUNDLE_COMPLETE'))
  const immutableManifestPath = await containedPath(
    root,
    join('evidence-bundle-manifests', artifactFileName(manifest.artifactId))
  )
  const immutableManifestBytes = await readFile(immutableManifestPath)
  const immutableManifest = JSON.parse(immutableManifestBytes)
  if (canonicalJson(immutableManifest) !== canonicalJson(manifest)) {
    throw new Error('Evidence Bundle current Manifest differs from its immutable artifact')
  }
  if (marker.artifactId !== manifest.artifactId
      || marker.payloadDigest !== manifest.payloadDigest
      || marker.manifestDigest !== `sha256:${sha256(immutableManifestBytes)}`) {
    throw new Error('Evidence Bundle completion marker does not bind immutable Manifest bytes')
  }

  const artifacts = new Map()
  for (const entry of manifest.payload.artifacts) {
    if (entry.state !== 'present') continue
    const locator = ROLE_LOCATORS[entry.role]
    if (!locator) throw new Error(`Evidence Bundle role has no closed locator rule: ${entry.role}`)
    const path = await containedPath(root, locator(entry.artifact.artifactId))
    const artifact = await readJson(path)
    validateCatalogedQualificationArtifact(artifact)
    assertArtifactReference(entry.artifact, artifact, entry.role)
    if (artifact.payloadDigest !== `sha256:${digestJson(artifact.payload)}`) {
      throw new Error(`Evidence Bundle role has an invalid payload digest: ${entry.role}`)
    }
    if (process.platform !== 'win32' && ((await stat(path)).mode & 0o077) !== 0) {
      throw new Error(`Evidence Bundle role is not current-user-only: ${entry.role}`)
    }
    artifacts.set(entry.role, artifact)
  }

  const evidenceIndex = artifacts.get('evidence_index')
  if (manifest.payload.bundleKind === 'accepted_execution' && !evidenceIndex) {
    throw new Error('Accepted Evidence Bundle is missing its Evidence Index')
  }
  const indexRecords = new Map(
    (evidenceIndex?.payload?.records ?? []).map((record) => [record.evidenceId, record])
  )
  const collaborationLedger = artifacts.get('collaboration_ledger')
  for (const [role, artifact] of artifacts) {
    for (const reference of collectEvidenceReferences(artifact.payload)) {
      const record = assertEvidenceReference(reference, evidenceIndex, indexRecords, role)
      if (role === 'semantic_engineering_review' && record.safeForJudge !== true) {
        throw new Error(`Semantic Review cites evidence not marked safeForJudge: ${reference.evidenceId}`)
      }
    }
  }

  const pack = await readOptionalJson(join(root, 'judge-evidence-pack.json'))
  if (pack) {
    validateCatalogedQualificationArtifact(pack)
    for (const reference of collectEvidenceReferences(pack.payload)) {
      const record = assertEvidenceReference(reference, evidenceIndex, indexRecords, 'judge_evidence_pack')
      if (record.safeForJudge !== true) {
        throw new Error(`Judge Pack cites evidence not marked safeForJudge: ${reference.evidenceId}`)
      }
    }
    if (!deferSafeProjectionChecks) assertSafeProjection(pack, forbiddenCanaries, 'Judge Pack')
  }

  const collaborationMessageEvidence = await readOptionalJson(
    join(root, 'collaboration-message-evidence.json')
  )
  if (collaborationMessageEvidence) {
    validateCollaborationMessageEvidence(collaborationMessageEvidence, {
      evidenceIndex,
      collaborationLedger
    })
    const immutablePath = await containedPath(root, join(
      'collaboration-message-evidence',
      artifactFileName(collaborationMessageEvidence.artifactId)
    ))
    const immutable = await readJson(immutablePath)
    if (canonicalJson(immutable) !== canonicalJson(collaborationMessageEvidence)) {
      throw new Error('Collaboration Message Evidence current projection differs from immutable artifact')
    }
    if (process.platform !== 'win32' && ((await stat(immutablePath)).mode & 0o077) !== 0) {
      throw new Error('Collaboration Message Evidence artifact is not current-user-only')
    }
  }

  const semanticReviewArtifact = artifacts.get('semantic_engineering_review')
  let verifiedJudgeViewPackDigests = null
  if (semanticReviewArtifact?.schemaId === JUDGE_VIEW_SUITE_SCHEMA_ID) {
    if (!pack) throw new Error('Semantic Judge View Suite requires its source Judge Pack')
    verifiedJudgeViewPackDigests = await verifySemanticJudgeViewArtifacts(
      root,
      semanticReviewArtifact,
      pack,
      evidenceIndex,
      indexRecords
    )
  }

  const result = await readJson(join(root, 'result.json'))
  await verifyFreshStateAttestation(root, result)
  const verifiedToolUse = await verifyToolUseArtifacts({
    root,
    result,
    evidenceIndex,
    qualificationCase: artifacts.get('qualification_case'),
    forbiddenCanaries,
    deferSafeProjectionChecks
  })
  const publicReport = artifacts.get('public_export')
  const trial = artifacts.get('qualification_trial')
  assertHardOutcome(result)
  if (publicReport) {
    const expected = {
      validity: result.validity,
      evaluationState: result.evaluationState,
      verifiedDelivery: result.verifiedDelivery,
      orchestrationConvergence: result.orchestrationConvergence,
      postDispatchHumanIntervention: result.postDispatchHumanIntervention,
      overall: result.overall
    }
    if (canonicalJson(publicReport.payload.layer1HardOutcome) !== canonicalJson(expected)) {
      throw new Error('Public Report Layer 1 differs from canonical Hard Outcome')
    }
    if (!deferSafeProjectionChecks) {
      assertSafeProjection(publicReport, forbiddenCanaries, 'Public Report')
    }
  }
  if (trial) {
    const payload = trial.payload
    if (payload.validity !== result.validity
        || payload.evaluationState !== result.evaluationState
        || payload.hardOutcome !== result.overall) {
      throw new Error('Normalized Trial differs from canonical Hard Outcome')
    }
  }

  const semanticMarker = await readOptionalJson(join(root, 'SEMANTIC_REVIEW_COMPLETE'))
  if (semanticReviewArtifact?.schemaId === JUDGE_VIEW_SUITE_SCHEMA_ID && !semanticMarker) {
    throw new Error('Semantic Judge View Suite is missing its completion marker')
  }
  if (semanticMarker) {
    if (semanticReviewArtifact?.schemaId === JUDGE_VIEW_SUITE_SCHEMA_ID) {
      const markerRevision = await readResultRevisionById(root, semanticMarker.resultRevisionId)
      if (semanticMarker.schemaVersion !== 2
          || semanticMarker.trialId !== result.trialId
          || markerRevision.trialId !== result.trialId
          || markerRevision.result?.semanticEngineeringReview?.artifactId
            !== semanticReviewArtifact.artifactId
          || semanticMarker.semanticReview?.artifactId !== semanticReviewArtifact.artifactId
          || semanticMarker.semanticReview?.payloadDigest !== semanticReviewArtifact.payloadDigest
          || semanticMarker.semanticReview?.state !== semanticReviewArtifact.payload.state
          || canonicalJson(semanticMarker.modelVisiblePackDigests)
            !== canonicalJson(verifiedJudgeViewPackDigests)) {
        throw new Error('Semantic Review completion marker binding is invalid')
      }
      const expectedViews = semanticReviewArtifact.payload.views.map((view) => ({
        view: view.view,
        state: view.state,
        reviewArtifact: view.reviewArtifact
      }))
      if (canonicalJson(semanticMarker.semanticReview.views) !== canonicalJson(expectedViews)) {
        throw new Error('Semantic Review completion marker View binding is invalid')
      }
    }
    const hardDigest = digestJson({
      validity: result.validity,
      evaluationState: result.evaluationState,
      verifiedDelivery: result.verifiedDelivery,
      orchestrationConvergence: result.orchestrationConvergence,
      postDispatchHumanIntervention: result.postDispatchHumanIntervention,
      overall: result.overall
    })
    if (semanticMarker.hardOutcomeDigest !== hardDigest) {
      throw new Error('Semantic Review completion marker does not preserve Hard Outcome')
    }
  }

  return {
    ok: true,
    trialId: result.trialId,
    bundleId: manifest.payload.bundleId,
    bundleKind: manifest.payload.bundleKind,
    hardOutcome: result.overall,
    semanticReview: result.semanticEngineeringReview?.status ?? 'unavailable',
    toolUseReview: verifiedToolUse.reviewState,
    presentArtifacts: artifacts.size,
    evidenceRecords: indexRecords.size,
    manifestDigest: marker.manifestDigest
  }
}

async function verifyFreshStateAttestation(root, result) {
  const reference = result.freshStateAttestation
  if (!reference) return
  const current = await readJson(join(root, 'fresh-state-attestation.json'))
  const immutable = await readPrivateArtifact(
    root,
    'fresh-state-attestations',
    artifactReference(current)
  )
  if (canonicalJson(current) !== canonicalJson(immutable)
      || current.artifactId !== reference.artifactId
      || current.schemaId !== 'rovai.benchmark.fresh-state-attestation'
      || current.schemaVersion !== '1.0.0'
      || current.payloadDigest !== `sha256:${digestJson(current.payload)}`
      || current.payloadDigest !== reference.payloadDigest
      || current.binding?.trialId !== result.trialId
      || current.binding?.treatment !== result.treatment
      || current.payload?.status !== reference.status
      || canonicalJson(current.payload?.identities) !== canonicalJson(reference.identities)) {
    throw new Error('Fresh State Attestation replay binding is invalid')
  }
}

async function verifyToolUseArtifacts({
  root,
  result,
  evidenceIndex,
  qualificationCase,
  forbiddenCanaries,
  deferSafeProjectionChecks
}) {
  const measurement = await readOptionalJson(join(root, 'tool-interaction-measurement.json'))
  const pack = await readOptionalJson(join(root, 'tool-use-judge-pack.json'))
  const expected = result.toolMeasurement?.status === 'measured'
  if (expected && (!measurement || !pack)) {
    throw new Error('Measured Trial is missing Tool Interaction artifacts')
  }
  if ((measurement === null) !== (pack === null)) {
    throw new Error('Tool Interaction Measurement and Judge Pack must be retained together')
  }
  if (!measurement) {
    return { reviewState: 'not_applicable' }
  }
  validateCatalogedQualificationArtifact(measurement)
  validateCatalogedQualificationArtifact(pack)
  validateToolInteractionArtifacts({ measurement, judgePack: pack, evidenceIndex })
  const disclosedTask = qualificationCase ? {
    title: qualificationCase.payload.title,
    requirements: qualificationCase.payload.requirements.map((requirement) => requirement.statement)
  } : null
  if (!disclosedTask
      || canonicalJson(pack.payload.modelInput.disclosedTask) !== canonicalJson(disclosedTask)) {
    throw new Error('Tool-Use Judge disclosed task differs from sealed Qualification Case')
  }
  const immutableMeasurement = await readPrivateArtifact(
    root,
    'tool-interaction-measurements',
    artifactReference(measurement)
  )
  const immutablePack = await readPrivateArtifact(
    root,
    'tool-use-judge-packs',
    artifactReference(pack)
  )
  if (canonicalJson(immutableMeasurement) !== canonicalJson(measurement)
      || canonicalJson(immutablePack) !== canonicalJson(pack)) {
    throw new Error('Tool Interaction current projection differs from immutable artifact')
  }
  const source = await readJson(join(root, 'tool-interaction-source.json'))
  const immutableSource = await readPrivateArtifact(
    root,
    'tool-interaction-sources',
    {
      artifactId: source.artifactId,
      schemaId: source.schemaId,
      schemaVersion: source.schemaVersion,
      payloadDigest: source.payloadDigest
    }
  )
  if (canonicalJson(source) !== canonicalJson(immutableSource)) {
    throw new Error('Tool Interaction private replay source differs from immutable artifact')
  }
  validateToolInteractionSourceArtifact(source, measurement)
  const preparedReference = source.payload.preparedFixtureArtifact
  const preparedPath = await containedPath(root, preparedReference.locator)
  const preparedFixture = await readJson(preparedPath)
  const { payloadDigest: _preparedDigest, ...preparedPayload } = preparedFixture
  if (preparedFixture.schemaId !== preparedReference.schemaId
      || preparedFixture.schemaVersion !== preparedReference.schemaVersion
      || preparedFixture.payloadDigest !== preparedReference.payloadDigest
      || preparedFixture.payloadDigest !== `sha256:${digestJson(preparedPayload)}`
      || preparedFixture.payloadDigest !== result.toolMeasurement?.preparedFixtureDigest
      || (process.platform !== 'win32' && ((await stat(preparedPath)).mode & 0o077) !== 0)) {
    throw new Error('Prepared Tool Fixture Manifest replay binding is invalid')
  }
  if (!deferSafeProjectionChecks) {
    assertSafeProjection(pack.payload.modelInput, forbiddenCanaries, 'Tool-Use Judge model input')
  }

  const review = await readOptionalJson(join(root, 'tool-use-review.json'))
  const marker = await readOptionalJson(join(root, 'TOOL_USE_REVIEW_COMPLETE'))
  if (!review) {
    if (marker) throw new Error('Tool-Use Review marker exists without a Review artifact')
    return { reviewState: 'unavailable' }
  }
  if (!marker) throw new Error('Tool-Use Review is missing its completion marker')
  const retainedReview = await readPrivateArtifact(
    root,
    'tool-use-reviews',
    artifactReference(review)
  )
  if (canonicalJson(retainedReview) !== canonicalJson(review)) {
    throw new Error('Tool-Use Review current projection differs from immutable artifact')
  }
  const configuration = await readPrivateArtifact(
    root,
    'tool-use-judge-configurations',
    review.payload.configurationArtifact
  )
  const currentConfiguration = await readJson(join(root, 'tool-use-judge-configuration.json'))
  if (canonicalJson(currentConfiguration) !== canonicalJson(configuration)) {
    throw new Error('Tool-Use Judge current Configuration differs from immutable artifact')
  }
  const replicas = []
  for (const reference of review.payload.replicaArtifacts) {
    replicas.push(await readPrivateArtifact(
      root,
      'tool-use-judge-replica-results',
      reference
    ))
  }
  validateCatalogedQualificationArtifact(configuration)
  validateToolUseJudgeConfiguration(configuration)
  for (const replica of replicas) {
    validateCatalogedQualificationArtifact(replica)
    validateToolUseJudgeReplicaResult(replica, { configuration, measurement, pack })
  }
  validateCatalogedQualificationArtifact(review)
  validateToolUseReviewArtifacts({ configuration, measurement, pack, replicas, review })
  const resultReview = result.toolMeasurement?.semanticReview
  if (resultReview?.artifactId !== review.artifactId
      || resultReview?.payloadDigest !== review.payloadDigest
      || resultReview?.status !== review.payload.state) {
    throw new Error('Trial Tool-Use Review projection differs from retained Review')
  }
  if (marker.schemaVersion !== 1
      || marker.trialId !== result.trialId
      || marker.modelInputDigest !== pack.payload.modelInputDigest
      || marker.reviewState !== review.payload.state
      || marker.judgeExecutionId !== review.payload.judgeExecutionId
      || canonicalJson(marker.measurementArtifact) !== canonicalJson(artifactReference(measurement))
      || canonicalJson(marker.reviewArtifact) !== canonicalJson(artifactReference(review))) {
    throw new Error('Tool-Use Review completion marker binding is invalid')
  }
  const markerRevision = await readResultRevisionById(root, marker.resultRevisionId)
  if (markerRevision.trialId !== result.trialId
      || markerRevision.result?.toolMeasurement?.semanticReview?.artifactId !== review.artifactId) {
    throw new Error('Tool-Use Review completion marker revision is invalid')
  }
  const hardDigest = digestJson({
    validity: result.validity,
    evaluationState: result.evaluationState,
    verifiedDelivery: result.verifiedDelivery,
    orchestrationConvergence: result.orchestrationConvergence,
    postDispatchHumanIntervention: result.postDispatchHumanIntervention,
    overall: result.overall
  })
  if (marker.hardOutcomeDigest !== hardDigest) {
    throw new Error('Tool-Use Review completion marker does not preserve Hard Outcome')
  }
  return { reviewState: review.payload.state }
}

async function verifySemanticJudgeViewArtifacts(
  root,
  suite,
  sourcePack,
  evidenceIndex,
  indexRecords
) {
  validateSemanticJudgeViewSuite(suite)
  const immutableSourcePack = await readPrivateArtifact(
    root,
    'judge-evidence-packs',
    artifactReference(sourcePack)
  )
  if (canonicalJson(immutableSourcePack) !== canonicalJson(sourcePack)) {
    throw new Error('Semantic source Judge Pack differs from retained immutable artifact')
  }
  const sourceConfiguration = await readPrivateArtifact(
    root,
    'semantic-judge-configurations',
    sourcePack.payload.configurationArtifact
  )
  validateSemanticJudgeConfiguration(sourceConfiguration)
  validateJudgeEvidencePack(sourcePack, {
    configuration: sourceConfiguration,
    evidenceIndex
  })
  const currentSuite = await readJson(join(root, 'semantic-judge-view-suite.json'))
  if (canonicalJson(currentSuite) !== canonicalJson(suite)) {
    throw new Error('Semantic Judge View current Suite differs from retained artifact')
  }
  const modelVisiblePackDigests = {}
  for (const view of suite.payload.views) {
    const configuration = await readPrivateArtifact(
      root,
      'semantic-judge-view-configurations',
      view.configurationArtifact
    )
    const pack = await readPrivateArtifact(
      root,
      'semantic-judge-view-packs',
      view.packArtifact
    )
    const replicas = []
    for (const reference of view.replicaArtifacts) {
      replicas.push(await readPrivateArtifact(
        root,
        'semantic-judge-view-replica-results',
        reference
      ))
    }
    const review = await readPrivateArtifact(
      root,
      'semantic-judge-view-reviews',
      view.reviewArtifact
    )
    validateJudgeViewConfiguration(configuration)
    validateJudgeViewPack(pack, { configuration, sourcePack })
    modelVisiblePackDigests[view.view] = pack.payload.modelInputDigest
    for (const replica of replicas) {
      validateJudgeViewReplicaResult(replica, { configuration, pack })
    }
    validateJudgeViewReview(review, { configuration, pack, replicas })
    if (view.state !== review.payload.state
        || canonicalJson(view.items) !== canonicalJson(review.payload.items)) {
      throw new Error(`Semantic ${view.view} Judge Suite projection differs from retained Review`)
    }
    const currentPack = await readJson(join(root, `semantic-${view.view}-judge-pack.json`))
    if (canonicalJson(currentPack) !== canonicalJson(pack)) {
      throw new Error(`Semantic ${view.view} Judge current Pack differs from retained artifact`)
    }
    for (const reference of collectEvidenceReferences(pack.payload)) {
      const record = assertEvidenceReference(
        reference,
        evidenceIndex,
        indexRecords,
        `semantic_${view.view}_judge_pack`
      )
      if (record.safeForJudge !== true) {
        throw new Error(
          `Semantic ${view.view} Judge Pack cites evidence not marked safeForJudge: ${reference.evidenceId}`
        )
      }
    }
  }
  return modelVisiblePackDigests
}

function artifactReference(artifact) {
  return {
    artifactId: artifact.artifactId,
    schemaId: artifact.schemaId,
    schemaVersion: artifact.schemaVersion,
    payloadDigest: artifact.payloadDigest
  }
}

async function readPrivateArtifact(root, directory, reference) {
  const path = await containedPath(root, join(directory, artifactFileName(reference.artifactId)))
  const artifact = await readJson(path)
  assertArtifactReference(reference, artifact, directory)
  if (process.platform !== 'win32' && ((await stat(path)).mode & 0o077) !== 0) {
    throw new Error(`Semantic Judge View artifact is not current-user-only: ${directory}`)
  }
  return artifact
}

function assertArtifactReference(reference, artifact, role) {
  for (const key of ['artifactId', 'schemaId', 'schemaVersion', 'payloadDigest']) {
    if (reference[key] !== artifact[key]) {
      throw new Error(`Evidence Bundle ${role} ${key} does not match retained artifact`)
    }
  }
}

function assertEvidenceReference(reference, evidenceIndex, indexRecords, role) {
  if (!evidenceIndex
      || reference.artifactId !== evidenceIndex.artifactId
      || !indexRecords.has(reference.evidenceId)) {
    throw new Error(`Evidence Bundle ${role} has an unresolved Evidence Reference`)
  }
  return indexRecords.get(reference.evidenceId)
}

function collectEvidenceReferences(value) {
  const references = new Map()
  visit(value)
  return [...references.values()]
  function visit(item) {
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (!item || typeof item !== 'object') return
    if (typeof item.artifactId === 'string' && typeof item.evidenceId === 'string') {
      const reference = {
        artifactId: item.artifactId,
        evidenceId: item.evidenceId,
        ...(typeof item.path === 'string' ? { path: item.path } : {})
      }
      references.set(`${reference.artifactId}\u0000${reference.evidenceId}\u0000${reference.path ?? ''}`, reference)
    }
    for (const child of Object.values(item)) visit(child)
  }
}

function assertHardOutcome(result) {
  const scorable = result.validity === 'valid' && result.evaluationState === 'complete'
  const expected = scorable
    ? result.verifiedDelivery === 'pass'
      && result.orchestrationConvergence === 'pass'
      && result.postDispatchHumanIntervention === 'absent'
      ? 'pass'
      : 'fail'
    : 'unavailable'
  if (result.overall !== expected || result.hardOutcome !== expected) {
    throw new Error('Canonical Hard Outcome formula is inconsistent')
  }
}

function assertSafeProjection(value, forbiddenCanaries, label) {
  const serialized = JSON.stringify(value)
  for (const canary of forbiddenCanaries) {
    if (canary && serialized.includes(canary)) throw new Error(`${label} contains a secret canary`)
  }
  if (/(?:\/Users|\/private|\/var\/folders|\/tmp)\//.test(serialized)
      || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(serialized)
      || /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/.test(serialized)
      || /\bAKIA[A-Z0-9]{16}\b/.test(serialized)) {
    throw new Error(`${label} contains a private locator or credential`)
  }
}

async function containedPath(root, locator) {
  const path = await realpath(join(root, locator))
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error('Evidence Bundle artifact locator escapes its root')
  }
  return path
}

async function readResultRevisionById(root, revisionId) {
  if (typeof revisionId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(revisionId)) {
    throw new Error('Review completion marker revision ID is invalid')
  }
  const directory = await containedPath(root, 'result-revisions')
  const matches = (await readdir(directory)).filter((name) => name.endsWith(`-${revisionId}.json`))
  if (matches.length !== 1) throw new Error('Review completion marker revision is unavailable')
  const record = await readJson(await containedPath(root, join('result-revisions', matches[0])))
  if (record.revisionId !== revisionId
      || record.result?.resultRevision?.revisionId !== revisionId
      || record.resultDigest !== digestJson(record.result)) {
    throw new Error('Review completion marker revision record is invalid')
  }
  return record
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function readOptionalJson(path) {
  try {
    return await readJson(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}
