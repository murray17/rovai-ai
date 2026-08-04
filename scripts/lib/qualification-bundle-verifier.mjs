import { readFile, realpath, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { canonicalJson, digestJson, sha256 } from './qualification-common.mjs'
import { validateEvidenceBundleManifest } from './qualification-bundle.mjs'
import { validateCatalogedQualificationArtifact } from './qualification-schema-validation.mjs'

const ROLE_LOCATORS = Object.freeze({
  qualification_case: (id) => join('normalized-artifacts', 'qualification_case', `${id}.json`),
  verification_catalog: (id) => join('normalized-artifacts', 'verification_catalog', `${id}.json`),
  qualification_trial: (id) => join('normalized-artifacts', 'qualification_trial', `${id}.json`),
  delivered_workspace_snapshot: (id) => join('normalized-artifacts', 'delivered_workspace_snapshot', `${id}.json`),
  verifier_observation: (id) => join('normalized-artifacts', 'verifier_observation', `${id}.json`),
  evidence_index: (id) => join('evidence-indexes', `${id}.json`),
  collaboration_ledger: (id) => join('collaboration-ledgers', `${id}.json`),
  tool_call_ledger: (id) => join('tool-call-ledgers', `${id}.json`),
  workspace_mutation_ledger: (id) => join('workspace-mutation-ledgers', `${id}.json`),
  semantic_engineering_review: (id) => join('semantic-engineering-reviews', `${id}.json`),
  environment_manifest: (id) => join('normalized-artifacts', 'environment_manifest', `${id}.json`),
  intervention_isolation_profile: () => 'intervention-isolation-profile.json',
  public_export: (id) => join('public-reports', `${id}.json`)
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
    join('evidence-bundle-manifests', `${manifest.artifactId}.json`)
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
    if (((await stat(path)).mode & 0o077) !== 0) {
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

  const result = await readJson(join(root, 'result.json'))
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
  if (semanticMarker) {
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
    presentArtifacts: artifacts.size,
    evidenceRecords: indexRecords.size,
    manifestDigest: marker.manifestDigest
  }
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
