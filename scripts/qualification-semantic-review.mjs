import { readFile, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  atomicWriteJson,
  digestJson,
  validateRelativeLocator,
  verifyStoredCaseSeal
} from './lib/qualification-common.mjs'
import {
  appendResultRevision,
  computeQualificationEvaluatorDigest,
  loadQualificationResultHistory
} from './lib/qualification-recovery.mjs'
import { publishQualificationEvidenceBundle } from './lib/qualification-bundle.mjs'
import {
  attachSemanticEngineeringReview,
  buildJudgeEvidencePack,
  buildSemanticJudgeConfiguration,
  executeSemanticEngineeringReview,
  retainSemanticEngineeringReviewArtifacts
} from './lib/qualification-semantic-judge.mjs'

const options = parseArguments(process.argv.slice(2))
const evidenceDirectory = await realpath(options.evidenceDirectory)
const history = await loadQualificationResultHistory(evidenceDirectory, { repairProjections: true })
const result = history.current
if (result.validity !== 'valid' || result.evaluationState !== 'complete') {
  throw new Error('Semantic Review requires a valid complete Trial')
}
const caseRecord = await verifyStoredCaseSeal(options.caseDirectory, result.case?.seal)
const configurationInput = JSON.parse(await readFile(options.configurationPath, 'utf8'))
const adapter = await loadAdapter(options.adapterPath, result.mode)
const producerDigest = await computeQualificationEvaluatorDigest()
const configuration = buildSemanticJudgeConfiguration({
  provider: configurationInput.provider,
  snapshotId: configurationInput.snapshotId,
  snapshotDigest: configurationInput.snapshotDigest,
  producerDigest,
  configurationId: configurationInput.configurationId,
  decodingParameters: configurationInput.decodingParameters,
  retrySchedule: configurationInput.retrySchedule
})
const artifacts = await loadRetainedArtifacts(evidenceDirectory)
const untrustedEvidence = await buildUntrustedEvidence({
  evidenceDirectory,
  result,
  evidenceIndex: artifacts.evidenceIndex,
  workspaceMutationLedger: artifacts.workspaceMutationLedger
})
const pack = buildJudgeEvidencePack({
  result,
  caseTitle: caseRecord.contract.manifest.title ?? caseRecord.contract.manifest.id,
  configuration,
  producerDigest,
  ...artifacts,
  untrustedEvidence,
  forbiddenCanaries: configurationInput.forbiddenCanaries ?? []
})
const execution = await executeSemanticEngineeringReview({
  configuration,
  pack,
  evidenceIndex: artifacts.evidenceIndex,
  producerDigest,
  invokeReplica: adapter.invokeReplica,
  timeoutMilliseconds: configurationInput.timeoutMilliseconds
})
const reviewReference = await retainSemanticEngineeringReviewArtifacts(
  evidenceDirectory,
  { configuration, pack, ...execution },
  artifacts.evidenceIndex
)
const nextResult = attachSemanticEngineeringReview(result, reviewReference)
const revision = await appendResultRevision(evidenceDirectory, nextResult)
await publishQualificationEvidenceBundle({
  evidenceDirectory,
  result: revision.resultBundle,
  resultDigest: revision.record.resultDigest,
  caseRecord,
  producerDigest,
  ...artifacts
})
await atomicWriteJson(join(evidenceDirectory, 'SEMANTIC_REVIEW_COMPLETE'), {
  schemaVersion: 1,
  trialId: result.trialId,
  resultRevisionId: revision.resultBundle.resultRevision.revisionId,
  hardOutcomeDigest: digestJson({
    validity: result.validity,
    evaluationState: result.evaluationState,
    verifiedDelivery: result.verifiedDelivery,
    orchestrationConvergence: result.orchestrationConvergence,
    postDispatchHumanIntervention: result.postDispatchHumanIntervention,
    overall: result.overall
  }),
  semanticReview: {
    artifactId: reviewReference.artifactId,
    payloadDigest: reviewReference.payloadDigest,
    state: reviewReference.status
  }
})

console.log(JSON.stringify({
  ok: true,
  trialId: result.trialId,
  resultRevisionId: revision.resultBundle.resultRevision.revisionId,
  hardOutcome: revision.resultBundle.overall,
  semanticReviewState: reviewReference.status,
  reviewArtifactId: reviewReference.artifactId
}, null, 2))

async function loadAdapter(path, mode) {
  const module = await import(pathToFileURL(path).href)
  const invokeReplica = module.invokeReplica ?? module.default?.invokeReplica
  const capabilities = module.capabilities ?? module.default?.capabilities
  const assurance = module.assurance ?? module.default?.assurance
  if (typeof invokeReplica !== 'function'
      || JSON.stringify(capabilities) !== JSON.stringify({
        tools: 'none',
        network: 'none',
        workspace: 'none'
      })) {
    throw new Error('Semantic Judge adapter must attest exact tool-disabled capabilities')
  }
  if (mode === 'formal' && assurance !== 'tool_disabled_external_sandbox') {
    throw new Error('Formal Semantic Review requires a tool-disabled external sandbox assurance')
  }
  if (!['tool_disabled_external_sandbox', 'fixture'].includes(assurance)) {
    throw new Error('Semantic Judge adapter assurance is unsupported')
  }
  return { invokeReplica }
}

async function loadRetainedArtifacts(evidenceDirectory) {
  const read = async (name) => JSON.parse(await readFile(join(evidenceDirectory, name), 'utf8'))
  return {
    evidenceIndex: await read('evidence-index.json'),
    collaborationLedger: await read('collaboration-ledger.json'),
    toolCallLedger: await read('tool-call-ledger.json'),
    workspaceMutationLedger: await read('workspace-mutation-ledger.json')
  }
}

async function buildUntrustedEvidence({
  evidenceDirectory,
  result,
  evidenceIndex,
  workspaceMutationLedger
}) {
  const responseEvidence = JSON.parse(await readFile(
    join(evidenceDirectory, 'final-response-evidence.json'),
    'utf8'
  ))
  const finalMessages = responseEvidence.messages.filter((message) => message.isFinal === true)
  if (finalMessages.length !== 1) throw new Error('Semantic Review requires exactly one final response')
  const responseReference = result.deliveryLayer?.finalResponseEvidence?.find((message) => (
    message.messageId === finalMessages[0].messageId
  ))?.evidenceReference
  if (!responseReference) throw new Error('Final response has no Evidence Reference')
  const segments = [{
    segmentId: `final-response:${finalMessages[0].messageId}`,
    kind: 'final_response',
    authorAgentProfileId: finalMessages[0].agentProfileId,
    visibility: 'public_to_camp',
    content: finalMessages[0].body,
    evidenceReference: responseReference
  }]
  const indexRecords = new Map(
    evidenceIndex.payload.records.map((record) => [record.evidenceId, record])
  )
  const snapshotRoot = await containedRealpath(
    evidenceDirectory,
    validateRelativeLocator(
      result.deliveredWorkspaceSnapshot?.directory,
      'Delivered Workspace Snapshot directory'
    )
  )
  const seenPaths = new Set()
  for (const mutation of workspaceMutationLedger.payload.records) {
    const reference = mutation.evidenceReferences?.[0]
    if (!reference) continue
    const sourceRecord = indexRecords.get(reference.evidenceId)
    if (sourceRecord?.safeForJudge !== true) continue
    for (const path of mutation.paths) {
      if (seenPaths.has(path)) continue
      seenPaths.add(path)
      const changed = result.workspaceDiff?.changed?.find((entry) => entry.path === path)
      if (changed?.after?.type !== 'file') continue
      const absolute = await containedRealpath(snapshotRoot, validateRelativeLocator(path, 'Changed path'))
      const content = await readFile(absolute, 'utf8')
      if (content.length > 50_000) continue
      segments.push({
        segmentId: `code:${mutation.mutationId}:${digestJson(path).slice(0, 16)}`,
        kind: 'code',
        authorAgentProfileId: null,
        visibility: 'workspace',
        path,
        content,
        evidenceReference: reference
      })
    }
  }
  for (const segment of segments) {
    if (segment.evidenceReference.artifactId !== evidenceIndex.artifactId
        || !indexRecords.has(segment.evidenceReference.evidenceId)) {
      throw new Error('Semantic Review source segment has an unresolved Evidence Reference')
    }
  }
  return segments
}

async function containedRealpath(root, relativePath) {
  const absoluteRoot = await realpath(root)
  const absolute = await realpath(join(absoluteRoot, relativePath))
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error('Semantic Review source locator escapes the Evidence Bundle')
  }
  return absolute
}

function parseArguments(args) {
  const values = {}
  while (args.length > 0) {
    const argument = args.shift()
    if (!argument.startsWith('--')) usage()
    const key = argument.slice(2)
    if (!['evidence-dir', 'case', 'configuration', 'adapter'].includes(key)) usage()
    values[key] = args.shift()
    if (!values[key]) usage()
  }
  if (!values['evidence-dir'] || !values.case || !values.configuration || !values.adapter) usage()
  return {
    evidenceDirectory: resolve(values['evidence-dir']),
    caseDirectory: resolve(values.case),
    configurationPath: resolve(values.configuration),
    adapterPath: resolve(values.adapter)
  }
}

function usage() {
  console.error('Usage: node scripts/qualification-semantic-review.mjs --evidence-dir <trial> --case <case> --configuration <json> --adapter <module>')
  process.exit(2)
}
