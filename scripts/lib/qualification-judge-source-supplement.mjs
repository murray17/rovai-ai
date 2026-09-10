import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { digestJson, sha256, writePrivateJsonExclusive, validateRelativeLocator } from './qualification-common.mjs'
import { captureNativeCommandWitnesses } from './qualification-native-witness.mjs'
import { supplementEvaluationContext } from './qualification-evaluation-context.mjs'
import { attachRecoveredEvidenceIndex } from './qualification-recovery.mjs'

// Supplement a retained Trial without altering its capture, workspace, hard
// verdicts, resource observations, or earlier result/Index/ledger revisions.
export async function prepareJudgeSourceSupplement({ evidenceDirectory, result, caseRecord, caseEvaluation, producerDigest }) {
  if (caseRecord.seal !== result.case?.seal) throw new Error('Supplement Case seal mismatch')
  const raw = await readFile(join(evidenceDirectory, 'observations.ndjson'), 'utf8')
  if (sha256(raw) !== result.observationDigest) throw new Error('Supplement observation digest mismatch')
  const observation = JSON.parse(raw.trim().split('\n').at(-1))
  if (digestJson(observation.snapshot) !== observation.digest) throw new Error('Supplement snapshot digest mismatch')
  const snapshot = structuredClone(observation.snapshot)
  const environment = JSON.parse(await readFile(join(evidenceDirectory, 'environment-manifest.json'), 'utf8'))
  if (digestJson(environment) !== result.environmentManifestDigest) throw new Error('Supplement environment digest mismatch')
  const configuration = JSON.parse(await readFile(join(evidenceDirectory, 'context-regression-configuration.json'), 'utf8'))
  const workspace = join(configuration.temporaryRoot, 'workspace')
  const installation = environment.runtimeInstallations.find(item => item.adapterKind === 'codex-cli')
  const capturedAt = new Date().toISOString()
  const capture = installation ? await captureNativeCommandWitnesses({ snapshot, workspace,
    executable: installation.executablePath, executableDigest: installation.executableFingerprint,
    startedAt: result.startedAt, completedAt: result.completedAt })
    : { state: 'unavailable', reason: 'native_read.adapter_not_supported', records: [], sources: [] }
  const initialFiles = []; let size = 0
  for (const path of caseEvaluation.evidenceFiles) {
    validateRelativeLocator(path, 'Initial task file')
    const entry = caseRecord.contract.fixture.entries.find(entry => entry.path === path && entry.type === 'file')
    if (!entry || entry.bytes > 24_000 || size + entry.bytes > 100_000) continue
    const file = join(caseRecord.contract.fixturePath, path)
    if (await realpath(file) !== file) throw new Error('Initial task file traversed a symlink')
    const bytes = await readFile(file)
    if (sha256(bytes) !== entry.digest) throw new Error('Initial task file differs from the sealed Case')
    let content; try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { continue }
    if (!content) continue
    initialFiles.push({ path, content, contentDigest: sha256(content), caseSeal: caseRecord.seal }); size += bytes.length
  }
  const payload = { policyId: 'judge-source-supplement-v1', trialId: result.trialId, observationDigest: result.observationDigest,
    caseSeal: caseRecord.seal, producerDigest, capturedAt, capture, initialFiles,
    newRuntimeExecutions: 0, newVerifierExecutions: 0 }
  const supplementDigest = digestJson(payload)
  const locator = `judge-source-supplement-${supplementDigest}.json`
  await writePrivateJsonExclusive(join(evidenceDirectory, locator), { ...payload, supplementDigest })
  snapshot.evaluationContext = supplementEvaluationContext(snapshot, capture, initialFiles, supplementDigest)
  const manifest = JSON.parse(await readFile(join(evidenceDirectory, 'delivered-workspace-manifest.json'), 'utf8'))
  if (manifest.digest !== result.deliveredWorkspaceSnapshot.digest) throw new Error('Supplement delivered manifest mismatch')
  const next = await attachRecoveredEvidenceIndex({ evidenceDirectory, prior: result,
    nextResult: { ...result, lastEvaluatedAt: capturedAt, semanticEngineeringReview: null,
      semanticSourceSupplement: { locator, supplementDigest, capturedAt, policyId: payload.policyId } },
    caseRecord, verifierObservation: result.verifier, evaluationAttemptId: randomUUID(), producerDigest,
    validation: { environmentManifest: environment, evidenceSnapshot: snapshot, workspaceDiff: result.workspaceDiff, snapshotManifest: manifest } })
  return { result: next, snapshot }
}
