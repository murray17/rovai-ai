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
  buildJudgeEvidencePack,
  buildSemanticJudgeConfiguration
} from './lib/qualification-semantic-judge.mjs'
import { buildSemanticJudgeUntrustedEvidence } from './lib/qualification-semantic-evidence.mjs'
import {
  attachSemanticJudgeViewSuite,
  buildJudgeViewConfiguration,
  buildJudgeViewPack,
  buildSemanticJudgeViewSuite,
  executeJudgeView,
  retainSemanticJudgeViewArtifacts
} from './lib/qualification-judge-views.mjs'

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
const sourceConfiguration = buildSemanticJudgeConfiguration({
  provider: configurationInput.provider,
  snapshotId: configurationInput.snapshotId,
  snapshotDigest: configurationInput.snapshotDigest,
  producerDigest,
  configurationId: configurationInput.configurationId,
  decodingParameters: configurationInput.decodingParameters,
  retrySchedule: configurationInput.retrySchedule
})
const artifacts = await loadRetainedArtifacts(evidenceDirectory)
const untrustedEvidence = await buildSemanticJudgeUntrustedEvidence({
  evidenceDirectory,
  result,
  evidenceIndex: artifacts.evidenceIndex,
  workspaceMutationLedger: artifacts.workspaceMutationLedger,
  collaborationLedger: artifacts.collaborationLedger
})
const sourcePack = buildJudgeEvidencePack({
  result,
  caseTitle: caseRecord.contract.manifest.title ?? caseRecord.contract.manifest.id,
  configuration: sourceConfiguration,
  producerDigest,
  ...artifacts,
  untrustedEvidence,
  forbiddenCanaries: configurationInput.forbiddenCanaries ?? []
})
const viewCommon = {
  provider: configurationInput.provider,
  snapshotId: configurationInput.snapshotId,
  snapshotDigest: configurationInput.snapshotDigest,
  producerDigest,
  decodingParameters: configurationInput.decodingParameters,
  retrySchedule: configurationInput.retrySchedule
}
const judgeExecutionId = `judge-execution:${randomUUID()}`
const processConfiguration = buildJudgeViewConfiguration({
  view: 'process',
  ...viewCommon,
  configurationId: configurationInput.processConfigurationId
    ?? `${configurationInput.configurationId ?? 'semantic-judge-v1'}-process`
})
const outcomeConfiguration = buildJudgeViewConfiguration({
  view: 'outcome',
  ...viewCommon,
  outcomeTreatmentCanaries: configurationInput.outcomeTreatmentCanaries ?? [],
  configurationId: configurationInput.outcomeConfigurationId
    ?? `${configurationInput.configurationId ?? 'semantic-judge-v1'}-outcome`
})
const processPack = buildJudgeViewPack({
  view: 'process',
  sourcePack,
  configuration: processConfiguration,
  producerDigest
})
const outcomePack = buildJudgeViewPack({
  view: 'outcome',
  sourcePack,
  configuration: outcomeConfiguration,
  producerDigest
})
const [processExecution, outcomeExecution] = await Promise.all([
  executeJudgeView({
    configuration: processConfiguration,
    pack: processPack,
    producerDigest,
    judgeExecutionId,
    invokeReplica: adapter.invokeReplica,
    timeoutMilliseconds: configurationInput.timeoutMilliseconds
  }),
  executeJudgeView({
    configuration: outcomeConfiguration,
    pack: outcomePack,
    producerDigest,
    judgeExecutionId,
    invokeReplica: adapter.invokeReplica,
    timeoutMilliseconds: configurationInput.timeoutMilliseconds
  })
])
const process = {
  configuration: processConfiguration,
  pack: processPack,
  ...processExecution
}
const outcome = {
  configuration: outcomeConfiguration,
  pack: outcomePack,
  ...outcomeExecution
}
const suite = buildSemanticJudgeViewSuite({ process, outcome, producerDigest })
const retained = await retainSemanticJudgeViewArtifacts(evidenceDirectory, {
  sourceConfiguration,
  sourcePack,
  process,
  outcome,
  suite
})
const reviewReference = retained.resultReference
const nextResult = attachSemanticJudgeViewSuite(result, reviewReference)
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
  schemaVersion: 2,
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
    state: reviewReference.status,
    views: reviewReference.views.map((view) => ({
      view: view.view,
      state: view.state,
      reviewArtifact: view.reviewArtifact
    }))
  },
  modelVisiblePackDigests: {
    process: processPack.payload.modelInputDigest,
    outcome: outcomePack.payload.modelInputDigest
  }
})

console.log(JSON.stringify({
  ok: true,
  trialId: result.trialId,
  resultRevisionId: revision.resultBundle.resultRevision.revisionId,
  hardOutcome: revision.resultBundle.overall,
  semanticReviewState: reviewReference.status,
  reviewArtifactId: reviewReference.artifactId,
  judgeViews: Object.fromEntries(reviewReference.views.map((view) => [
    view.view,
    view.state
  ]))
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
