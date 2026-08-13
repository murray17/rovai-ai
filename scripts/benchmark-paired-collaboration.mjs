import { mkdir, readFile, realpath } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import {
  atomicWriteJson,
  canonicalJson,
  digestJson,
  runCaptured,
  verifyStoredCaseSeal
} from './lib/qualification-common.mjs'
import { verifyQualificationEvidenceBundle } from './lib/qualification-bundle-verifier.mjs'
import { verifyToolMeasurementPack } from './lib/qualification-tool-measurement-spec.mjs'
import {
  assertPreDispatchPairedDefinition,
  comparePairedTrial,
  createPairedTrialDefinition,
  deriveObservedPairedExecution,
  derivePreDispatchPairedContext,
  planPairedTrials,
  validatePairedComparison,
  validatePairedTrialDefinition,
  validatePairedTrialPlan
} from './benchmark/measurement/paired/index.mjs'
import {
  defaultResourceMeasurementProfile,
  measureTrialResources,
  validateResourceMeasurementProfile
} from './benchmark/measurement/resources/index.mjs'

const options = parseArguments(process.argv.slice(2))
if (options.command === 'plan') await planCommand(options)
else if (options.command === 'compare') await compareCommand(options)
else await runCommand(options)

async function planCommand(options) {
  const definition = await loadDefinition(options.definitionPath)
  const plan = planPairedTrials(definition)
  validatePairedTrialPlan(plan)
  await writeOutput(options.outputPath, plan)
  printSummary({ ok: true, command: 'plan', definitionId: definition.id, pairs: plan.pairs.length })
}

async function compareCommand(options) {
  const definition = await loadDefinition(options.definitionPath)
  const team = await loadArm(options.teamArmPath)
  const solo = await loadArm(options.soloArmPath)
  const qualityComparison = JSON.parse(await readFile(options.qualityComparisonPath, 'utf8'))
  const comparison = comparePairedTrial({ definition, team, solo, qualityComparison })
  validatePairedComparison(comparison)
  await writeOutput(options.outputPath, comparison)
  printSummary({
    ok: true,
    command: 'compare',
    validity: comparison.validity.status,
    outcomeStratum: comparison.outcomeStratum,
    resourceEligibility: comparison.resourceComparison.status,
    classification: comparison.classification
  })
}

async function runCommand(options) {
  const definition = await loadDefinition(options.definitionPath)
  const executionContext = await prepareExecutionContext(definition, options)
  const plan = planPairedTrials(definition)
  validatePairedTrialPlan(plan)
  const pair = plan.pairs.find((candidate) => candidate.replicateIndex === options.replicateIndex)
  if (!pair) throw new Error(`replicateIndex ${options.replicateIndex} is not planned`)
  const pairDirectory = join(options.outputDirectory, pair.pairSlotId.replaceAll(':', '_'))
  await mkdir(pairDirectory, { recursive: true, mode: 0o700 })
  const planPath = join(pairDirectory, 'paired-plan.json')
  await atomicWriteJson(planPath, plan)
  const planEvidenceReference = {
    artifactRole: 'paired-trial-plan',
    schemaId: plan.schemaId,
    schemaVersion: plan.schemaVersion,
    payloadDigest: plan.integrity.payloadDigest,
    disclosure: 'private'
  }
  const armArtifacts = {}
  for (const plannedArm of pair.arms) {
    const evidenceRoot = join(pairDirectory, plannedArm.treatment)
    const args = [
      'scripts/qualification-runner.mjs',
      '--mode', options.mode,
      '--core', options.coreExecutable,
      '--case', options.caseDirectory,
      '--expected-seal', definition.bindings.case.digest,
      '--evidence-root', evidenceRoot,
      '--trial-id', plannedArm.trialId,
      '--planned-slot-id', plannedArm.armPlanId,
      '--suite-id', definition.id,
      '--treatment', plannedArm.treatment,
      '--paired-experiment-id', definition.id,
      '--arm-id', plannedArm.armPlanId,
      '--paired-plan-digest', plan.integrity.payloadDigest,
      '--paired-pair-slot-id', pair.pairSlotId,
      '--paired-dispatch-ordinal', String(plannedArm.dispatchOrdinal),
      '--tool-measurement-pack', options.toolMeasurementPackDirectory
    ]
    if (options.isolationProfilePath) args.push('--isolation-profile', options.isolationProfilePath)
    const execution = await runCaptured(process.execPath, args, {
      cwd: resolve(import.meta.dirname, '..'),
      timeoutMs: options.armTimeoutMilliseconds,
      maxOutputBytes: 4 * 1024 * 1024
    })
    if (execution.timedOut || execution.signal || ![0, 1, 2].includes(execution.code)) {
      throw new Error(`paired ${plannedArm.treatment} arm runner did not terminate normally: ${execution.stderr}`)
    }
    const evidenceDirectory = join(evidenceRoot, plannedArm.trialId)
    const result = JSON.parse(await readFile(join(evidenceDirectory, 'result.json'), 'utf8'))
    const resources = measureTrialResources({
      profile: executionContext.resourceProfile,
      observation: resourceObservation(result, plannedArm.trialId)
    })
    await atomicWriteJson(join(evidenceDirectory, 'resource-measurement.json'), resources)
    await verifyQualificationEvidenceBundle(evidenceDirectory)
    const observedExecution = await deriveObservedExecutionContext({
      evidenceDirectory,
      toolMeasurementBinding: executionContext.toolMeasurementBinding
    })
    const arm = await buildArmArtifact({
      definition,
      plan,
      pair,
      plannedArm,
      result,
      resources,
      planEvidenceReference,
      evidenceDirectory,
      observedExecution
    })
    await atomicWriteJson(join(pairDirectory, `${plannedArm.treatment}-arm.json`), arm)
    armArtifacts[plannedArm.treatment] = arm
  }
  const executionRecord = {
    schemaId: 'rovai.benchmark.paired-execution',
    schemaVersion: '1.0.0',
    definition: { id: definition.id, digest: definition.definitionDigest },
    plan: { digest: plan.integrity.payloadDigest, pairSlotId: pair.pairSlotId },
    arms: {
      team: armReference(armArtifacts.team),
      solo: armReference(armArtifacts.solo)
    },
    comparison: {
      status: 'pending_blinded_outcome_quality',
      reason: { code: 'paired.blinded_outcome_quality_required' }
    }
  }
  executionRecord.integrity = { payloadDigest: digestJson(executionRecord) }
  await atomicWriteJson(join(pairDirectory, 'paired-execution.json'), executionRecord)
  printSummary({
    ok: true,
    command: 'run',
    pairSlotId: pair.pairSlotId,
    armOrder: pair.armOrder,
    outcome: {
      team: armArtifacts.team.outcome.status,
      solo: armArtifacts.solo.outcome.status
    },
    comparison: 'pending_blinded_outcome_quality',
    pairDirectory
  })
}

async function buildArmArtifact({
  definition,
  plan,
  pair,
  plannedArm,
  result,
  resources,
  planEvidenceReference,
  evidenceDirectory,
  observedExecution
}) {
  assertRunnerPlanBinding(result, plan, pair, plannedArm)
  const resultDigest = digestJson(result)
  const hardOutcomeReference = {
    artifactRole: 'qualification-trial',
    schemaId: 'rovai.qualification.trial-result',
    schemaVersion: String(result.schemaVersion ?? 1),
    payloadDigest: resultDigest,
    disclosure: 'private'
  }
  const freshStateArtifact = await loadFreshStateAttestation(evidenceDirectory, result)
  const freshState = freshStateArtifact?.payload ?? null
  const freshStateReference = freshStateArtifact ? {
    artifactRole: 'fresh-state-attestation',
    schemaId: freshStateArtifact.schemaId,
    schemaVersion: freshStateArtifact.schemaVersion,
    payloadDigest: freshStateArtifact.payloadDigest,
    disclosure: 'private'
  } : null
  return {
    treatment: plannedArm.treatment,
    runId: plannedArm.trialId,
    definitionBindings: structuredClone(observedExecution.bindings),
    resourceProfileDigest: definition.resourceProfileDigest,
    commonFactors: structuredClone(observedExecution.commonFactors),
    treatmentFactors: {
      coordinationMode: result.treatment === 'team' ? 'multi_agent' : 'single_agent'
    },
    planBinding: {
      planDigest: plan.integrity.payloadDigest,
      pairSlotId: pair.pairSlotId,
      armPlanId: plannedArm.armPlanId,
      trialId: plannedArm.trialId,
      dispatchOrdinal: plannedArm.dispatchOrdinal,
      evidenceReferences: [planEvidenceReference]
    },
    freshState: {
      status: freshState?.status === 'attested' ? 'attested' : 'unavailable',
      identities: structuredClone(freshState?.identities ?? {}),
      evidenceReferences: freshStateReference ? [freshStateReference] : []
    },
    outcome: {
      status: ['pass', 'fail'].includes(result.overall) ? result.overall : 'indeterminate',
      artifactDigest: resultDigest,
      evidenceReferences: [hardOutcomeReference]
    },
    resources
  }
}

async function prepareExecutionContext(definition, options) {
  const caseRecord = await verifyStoredCaseSeal(
    options.caseDirectory,
    definition.bindings.case.digest
  )
  const toolPack = await verifyToolMeasurementPack(
    options.toolMeasurementPackDirectory,
    caseRecord
  )
  const observed = derivePreDispatchPairedContext({ caseRecord, toolPack })
  assertPreDispatchPairedDefinition(definition, observed)
  const resourceProfile = options.resourceProfilePath
    ? JSON.parse(await readFile(options.resourceProfilePath, 'utf8'))
    : defaultResourceMeasurementProfile()
  validateResourceMeasurementProfile(resourceProfile)
  if (resourceProfile.profileDigest !== definition.resourceProfileDigest) {
    throw new Error('paired Definition resource profile differs before dispatch')
  }
  return {
    resourceProfile,
    toolMeasurementBinding: observed.bindings.toolMeasurement
  }
}

async function deriveObservedExecutionContext({ evidenceDirectory, toolMeasurementBinding }) {
  const artifacts = await loadNormalizedArtifacts(evidenceDirectory, [
    'qualification_case',
    'verifier_observation',
    'environment_manifest'
  ])
  const qualificationCase = artifacts.qualification_case
  const verifier = artifacts.verifier_observation
  const environment = artifacts.environment_manifest
  const lead = environment.payload.runtimes.find((runtime) => runtime.memberId === 'agent_1')
  if (!lead) throw new Error('paired arm has no normalized Lead Runtime evidence')
  return deriveObservedPairedExecution({
    qualificationCase,
    verifierObservation: verifier,
    environmentManifest: environment,
    toolMeasurementBinding
  })
}

async function loadNormalizedArtifacts(evidenceDirectory, roles) {
  const root = await realpath(evidenceDirectory)
  const manifest = JSON.parse(await readFile(join(root, 'evidence-bundle-manifest.json'), 'utf8'))
  const result = {}
  for (const role of roles) {
    const entry = manifest.payload?.artifacts?.find((candidate) => candidate.role === role)
    if (entry?.state !== 'present' || !entry.artifact?.artifactId) {
      throw new Error(`paired arm normalized artifact ${role} is unavailable`)
    }
    const candidatePath = await realpath(join(
      root,
      'normalized-artifacts',
      role,
      `${entry.artifact.artifactId}.json`
    ))
    if (candidatePath !== root && !candidatePath.startsWith(`${root}${sep}`)) {
      throw new Error(`paired arm normalized artifact ${role} escapes its Trial root`)
    }
    const artifact = JSON.parse(await readFile(candidatePath, 'utf8'))
    if (artifact.artifactId !== entry.artifact.artifactId
        || artifact.schemaId !== entry.artifact.schemaId
        || artifact.schemaVersion !== entry.artifact.schemaVersion
        || artifact.payloadDigest !== entry.artifact.payloadDigest) {
      throw new Error(`paired arm normalized artifact ${role} identity differs from the Bundle`)
    }
    result[role] = artifact
  }
  return result
}

function assertRunnerPlanBinding(result, plan, pair, plannedArm) {
  const expected = {
    planDigest: plan.integrity.payloadDigest,
    pairSlotId: pair.pairSlotId,
    armPlanId: plannedArm.armPlanId,
    dispatchOrdinal: plannedArm.dispatchOrdinal
  }
  if (result.trialId !== plannedArm.trialId
      || result.treatment !== plannedArm.treatment
      || result.pairedExperimentId !== plan.definition.id
      || result.pairedArmId !== plannedArm.armPlanId
      || canonicalJson(result.pairedPlanBinding) !== canonicalJson(expected)) {
    throw new Error('paired arm Runner result differs from its frozen plan binding')
  }
}

async function loadFreshStateAttestation(evidenceDirectory, result) {
  const reference = result.freshStateAttestation
  if (!reference?.artifactId || !reference.locator) return null
  const root = await realpath(evidenceDirectory)
  const currentPath = join(root, 'fresh-state-attestation.json')
  const immutablePath = await realpath(join(root, reference.locator))
  if (immutablePath !== root && !immutablePath.startsWith(`${root}${sep}`)) {
    throw new Error('Fresh State Attestation locator escapes its Trial root')
  }
  const [current, immutable] = await Promise.all([
    JSON.parse(await readFile(currentPath, 'utf8')),
    JSON.parse(await readFile(immutablePath, 'utf8'))
  ])
  if (canonicalJson(current) !== canonicalJson(immutable)
      || current.artifactId !== reference.artifactId
      || current.schemaId !== reference.schemaId
      || current.schemaVersion !== reference.schemaVersion
      || current.payloadDigest !== reference.payloadDigest
      || current.payloadDigest !== `sha256:${digestJson(current.payload)}`
      || current.binding?.trialId !== result.trialId
      || current.binding?.treatment !== result.treatment
      || canonicalJson(current.payload?.identities) !== canonicalJson(reference.identities)
      || current.payload?.status !== reference.status) {
    throw new Error('Fresh State Attestation binding or immutable retention is invalid')
  }
  return current
}

function resourceObservation(result, trialId) {
  const observedRuns = result.collaborationEvidence?.runGraph ?? []
  const runIntervals = observedRuns.flatMap((run) => {
    const startMs = Date.parse(run.startedAt)
    const endMs = Date.parse(run.endedAt)
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
      ? [{ startMs, endMs, evidenceReferences: [resourceReference(result, trialId)] }]
      : []
  })
  const completeRunCoverage = observedRuns.length > 0
    && runIntervals.length === observedRuns.length
  const makespan = result.resourceObservation?.dispatchToTerminal
  const completeMakespan = makespan?.coverage?.state === 'complete'
    && makespan.clockDomain === 'runner_monotonic'
    && makespan.authority === 'runner'
  const reference = resourceReference(result, trialId)
  return {
    trialInterval: {
      startMs: 0,
      endMs: completeMakespan ? makespan.valueMilliseconds : 0,
      coverage: completeMakespan
        ? { status: 'complete' }
        : { status: 'unavailable', reasonCode: 'resource.runner_monotonic_interval_unavailable' },
      clockDomain: 'runner_monotonic',
      authority: 'runner',
      evidenceReferences: completeMakespan ? [reference] : []
    },
    agentRuns: {
      coverage: completeRunCoverage
        ? { status: 'complete' }
        : {
            status: 'unavailable',
            reasonCode: 'resource.agent_run_interval_coverage_incomplete'
          },
      clockDomain: 'core_persisted_wall_clock',
      authority: 'core',
      intervals: runIntervals,
      evidenceReferences: completeRunCoverage ? [reference] : []
    },
    coordinationWaits: {
      coverage: { status: 'unavailable', reasonCode: 'resource.coordination_wait_not_derived' },
      clockDomain: 'core_persisted_wall_clock',
      authority: 'core',
      intervals: [],
      evidenceReferences: []
    },
    criticalPath: {
      coverage: { status: 'unavailable', reasonCode: 'resource.critical_path_not_derived' },
      clockDomain: 'core_persisted_wall_clock',
      authority: 'core',
      nodes: [],
      edges: [],
      evidenceReferences: []
    },
    usage: {
      coverage: { status: 'unavailable', reasonCode: 'resource.provider_receipt_unavailable' },
      clockDomain: 'provider_receipt',
      authority: 'provider',
      receipts: [],
      evidenceReferences: []
    }
  }
}

function resourceReference(result, trialId) {
  return {
    artifactRole: 'qualification-trial',
    schemaId: 'rovai.qualification.trial-result',
    schemaVersion: String(result.schemaVersion ?? 1),
    payloadDigest: digestJson(result),
    disclosure: 'private',
    trialId
  }
}

function armReference(arm) {
  return { treatment: arm.treatment, runId: arm.runId, digest: digestJson(arm) }
}

async function loadDefinition(path) {
  const input = JSON.parse(await readFile(path, 'utf8'))
  const definition = input.schemaId === 'rovai.benchmark.paired-trial-definition'
    ? input
    : createPairedTrialDefinition(input)
  validatePairedTrialDefinition(definition)
  return definition
}

async function loadArm(path) {
  const resolved = await realpath(path)
  return JSON.parse(await readFile(resolved, 'utf8'))
}

async function writeOutput(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await atomicWriteJson(path, value)
}

function parseArguments(args) {
  const command = args.shift()
  if (!['plan', 'run', 'compare'].includes(command)) usage()
  const values = {}
  while (args.length > 0) {
    const argument = args.shift()
    if (!argument?.startsWith('--')) usage()
    const key = argument.slice(2)
    if (![
      'definition', 'output', 'output-dir', 'replicate-index', 'mode', 'core', 'case',
      'tool-measurement-pack', 'resource-profile', 'isolation-profile', 'arm-timeout-ms',
      'team-arm', 'solo-arm', 'quality-comparison'
    ].includes(key)) usage()
    values[key] = args.shift()
    if (!values[key]) usage()
  }
  if (!values.definition) usage()
  const common = { command, definitionPath: resolve(values.definition) }
  if (command === 'plan') {
    if (!values.output) usage()
    return { ...common, outputPath: resolve(values.output) }
  }
  if (command === 'compare') {
    if (!values.output || !values['team-arm'] || !values['solo-arm'] || !values['quality-comparison']) usage()
    return {
      ...common,
      outputPath: resolve(values.output),
      teamArmPath: resolve(values['team-arm']),
      soloArmPath: resolve(values['solo-arm']),
      qualityComparisonPath: resolve(values['quality-comparison'])
    }
  }
  if (!['demo', 'diagnostic', 'formal'].includes(values.mode)
      || !values.core || !values.case || !values['tool-measurement-pack'] || !values['output-dir']) usage()
  const replicateIndex = Number(values['replicate-index'] ?? 0)
  if (!Number.isSafeInteger(replicateIndex) || replicateIndex < 0) usage()
  return {
    ...common,
    replicateIndex,
    mode: values.mode,
    coreExecutable: resolve(values.core),
    caseDirectory: resolve(values.case),
    toolMeasurementPackDirectory: resolve(values['tool-measurement-pack']),
    outputDirectory: resolve(values['output-dir']),
    resourceProfilePath: values['resource-profile'] ? resolve(values['resource-profile']) : null,
    isolationProfilePath: values['isolation-profile'] ? resolve(values['isolation-profile']) : null,
    armTimeoutMilliseconds: Number(values['arm-timeout-ms'] ?? 1_800_000)
  }
}

function printSummary(value) {
  console.log(JSON.stringify(value, null, 2))
}

function usage() {
  console.error('Usage: node scripts/benchmark-paired-collaboration.mjs <plan|run|compare> --definition <json> ...')
  process.exit(2)
}
