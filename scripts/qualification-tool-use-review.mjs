import { randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  atomicWriteJson,
  digestJson,
  verifyStoredCaseSeal
} from './lib/qualification-common.mjs'
import {
  appendResultRevision,
  computeQualificationEvaluatorDigest,
  loadQualificationResultHistory
} from './lib/qualification-recovery.mjs'
import { publishQualificationEvidenceBundle } from './lib/qualification-bundle.mjs'
import {
  validateToolInteractionArtifacts
} from './lib/tool-interaction-measurement/index.mjs'
import {
  attachToolUseReview,
  buildToolUseJudgeConfiguration,
  executeToolUseReview,
  retainToolUseReviewArtifacts
} from './lib/qualification-tool-use-judge.mjs'

const options = parseArguments(process.argv.slice(2))
const evidenceDirectory = await realpath(options.evidenceDirectory)
const history = await loadQualificationResultHistory(evidenceDirectory, { repairProjections: true })
const result = history.current
if (result.validity !== 'valid' || result.evaluationState !== 'complete') {
  throw new Error('Tool-Use Review requires a valid, completely evaluated Trial')
}
if (result.toolMeasurement?.status !== 'measured') {
  throw new Error('Tool-Use Review requires a retained Tool Interaction Measurement')
}

const caseRecord = await verifyStoredCaseSeal(options.caseDirectory, result.case?.seal)
const configurationInput = JSON.parse(await readFile(options.configurationPath, 'utf8'))
const adapter = await loadAdapter(options.adapterPath, result.mode)
const producerDigest = await computeQualificationEvaluatorDigest()
const artifacts = await loadRetainedArtifacts(evidenceDirectory)
validateToolInteractionArtifacts({
  measurement: artifacts.measurement,
  judgePack: artifacts.pack,
  evidenceIndex: artifacts.evidenceIndex
})
const configuration = buildToolUseJudgeConfiguration({
  provider: configurationInput.provider,
  snapshotId: configurationInput.snapshotId,
  snapshotDigest: configurationInput.snapshotDigest,
  producerDigest,
  configurationId: configurationInput.configurationId,
  decodingParameters: configurationInput.decodingParameters,
  retrySchedule: configurationInput.retrySchedule
})
const execution = await executeToolUseReview({
  configuration,
  measurement: artifacts.measurement,
  pack: artifacts.pack,
  producerDigest,
  judgeExecutionId: `tool-use-judge-execution:${randomUUID()}`,
  treatmentCanaries: configurationInput.treatmentCanaries ?? [],
  timeoutMilliseconds: configurationInput.timeoutMilliseconds,
  invokeReplica: adapter.invokeReplica
})
const reviewReference = await retainToolUseReviewArtifacts(evidenceDirectory, {
  configuration,
  measurement: artifacts.measurement,
  pack: artifacts.pack,
  replicas: execution.replicas,
  review: execution.review
})
const nextResult = attachToolUseReview(result, reviewReference)
const revision = await appendResultRevision(evidenceDirectory, nextResult)
await publishQualificationEvidenceBundle({
  evidenceDirectory,
  result: revision.resultBundle,
  resultDigest: revision.record.resultDigest,
  caseRecord,
  producerDigest,
  evidenceIndex: artifacts.evidenceIndex,
  collaborationLedger: artifacts.collaborationLedger,
  toolCallLedger: artifacts.toolCallLedger,
  workspaceMutationLedger: artifacts.workspaceMutationLedger
})
await atomicWriteJson(join(evidenceDirectory, 'TOOL_USE_REVIEW_COMPLETE'), {
  schemaVersion: 1,
  trialId: result.trialId,
  resultRevisionId: revision.resultBundle.resultRevision.revisionId,
  hardOutcomeDigest: hardOutcomeDigest(result),
  measurementArtifact: artifactReference(artifacts.measurement),
  modelInputDigest: artifacts.pack.payload.modelInputDigest,
  reviewArtifact: artifactReference(execution.review),
  reviewState: execution.review.payload.state,
  judgeExecutionId: execution.judgeExecutionId
})

console.log(JSON.stringify({
  ok: true,
  trialId: result.trialId,
  resultRevisionId: revision.resultBundle.resultRevision.revisionId,
  hardOutcome: revision.resultBundle.overall,
  toolUseReviewState: reviewReference.status,
  reviewArtifactId: reviewReference.artifactId
}, null, 2))

async function loadAdapter(path, mode) {
  const module = await import(pathToFileURL(path).href)
  const invokeReplica = module.invokeReplica ?? module.default?.invokeReplica
  const capabilities = module.capabilities ?? module.default?.capabilities
  const assurance = module.assurance ?? module.default?.assurance
  if (typeof invokeReplica !== 'function'
      || JSON.stringify(capabilities) !== JSON.stringify({
        tools: 'none', network: 'none', workspace: 'none'
      })) {
    throw new Error('Tool-Use Judge adapter must attest exact tool-disabled capabilities')
  }
  if (mode === 'formal' && assurance !== 'tool_disabled_external_sandbox') {
    throw new Error('Formal Tool-Use Review requires a tool-disabled external sandbox')
  }
  if (!['tool_disabled_external_sandbox', 'fixture'].includes(assurance)) {
    throw new Error('Tool-Use Judge adapter assurance is unsupported')
  }
  return { invokeReplica }
}

async function loadRetainedArtifacts(evidenceDirectory) {
  const read = async (name) => JSON.parse(await readFile(join(evidenceDirectory, name), 'utf8'))
  return {
    evidenceIndex: await read('evidence-index.json'),
    collaborationLedger: await read('collaboration-ledger.json'),
    toolCallLedger: await read('tool-call-ledger.json'),
    workspaceMutationLedger: await read('workspace-mutation-ledger.json'),
    measurement: await read('tool-interaction-measurement.json'),
    pack: await read('tool-use-judge-pack.json')
  }
}

function artifactReference(artifact) {
  return {
    artifactId: artifact.artifactId,
    schemaId: artifact.schemaId,
    schemaVersion: artifact.schemaVersion,
    payloadDigest: artifact.payloadDigest
  }
}

function hardOutcomeDigest(result) {
  return digestJson({
    validity: result.validity,
    evaluationState: result.evaluationState,
    verifiedDelivery: result.verifiedDelivery,
    orchestrationConvergence: result.orchestrationConvergence,
    postDispatchHumanIntervention: result.postDispatchHumanIntervention,
    overall: result.overall
  })
}

function parseArguments(args) {
  const values = {}
  while (args.length > 0) {
    const argument = args.shift()
    if (!argument?.startsWith('--')) usage()
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
  console.error('Usage: node scripts/qualification-tool-use-review.mjs --evidence-dir <trial> --case <case> --configuration <json> --adapter <module>')
  process.exit(2)
}
