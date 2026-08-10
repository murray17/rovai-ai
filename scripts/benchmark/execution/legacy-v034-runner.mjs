import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  atomicWriteJson,
  ensurePrivateDirectory,
  validateRelativeLocator
} from '../../lib/qualification-common.mjs'
import { legacyV034Profile } from '../profiles/legacy-v034.mjs'
import { generatePlannedSlots } from './suite.mjs'
import {
  buildLegacyV034Summary,
  deriveCalibrationOutcome,
  readPriorCalibration
} from '../reporting/legacy-v034-summary.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../../..')

export async function runLegacyV034Suite(options) {
  const packRoot = resolve(options.pack)
  const suite = JSON.parse(await readFile(join(packRoot, 'suite.json'), 'utf8'))
  const profile = legacyV034Profile(suite)
  const suiteEvidenceRoot = await ensurePrivateDirectory(join(options.evidenceRoot, options.suiteId))
  const trialEvidenceRoot = await ensurePrivateDirectory(join(suiteEvidenceRoot, 'trials'))
  const outcomes = []
  let compatibilityDigest = null
  let priorCalibration = null
  const caseById = new Map(suite.cases.map((entry) => [entry.id, entry]))
  const formalOrder = generatePlannedSlots(profile).map((slot) => ({
    round: slot.roundOrdinal,
    caseEntry: caseById.get(slot.caseId),
    plannedSlotId: slot.plannedSlotId
  }))

  if (options.diagnosticNoCalibration) {
    priorCalibration = await readPriorCalibration(readFile, options.priorCalibrationSummary, suite)
    console.log(`[qualification] diagnostic mode after failed calibration ${priorCalibration.suiteId}`)
  } else {
    console.log(`[qualification] calibration ${suite.calibration.id}`)
    const calibration = await runOne(suite.calibration, 'calibration', 'calibration')
    outcomes.push(calibration)
    if (deriveCalibrationOutcome(calibration) !== 'pass') {
      await finish('calibration_failed')
      return 2
    }
  }

  for (const { round, caseEntry, plannedSlotId } of formalOrder) {
    console.log(`[qualification] round ${round}/${suite.rounds} ${caseEntry.id}`)
    const trial = await runOne(caseEntry, `r${round}`, plannedSlotId)
    outcomes.push(trial)
    if (trial.summary.validity === 'invalid' || trial.summary.evaluationState === 'pending') {
      await finish(trial.summary.validity === 'invalid'
        ? 'environment_drift_or_invalid'
        : 'evaluation_pending')
      return 2
    }
  }
  await finish(options.diagnosticNoCalibration ? 'diagnostic_completed' : 'completed')
  return 0

  async function runOne(caseEntry, phase, plannedSlotId) {
    const casePath = resolveInsidePack(packRoot, caseEntry.directory)
    const trialId = `${options.suiteId}-${phase}-${caseEntry.id}`
    const args = [
      join(repositoryRoot, 'scripts', 'qualification-runner.mjs'),
      '--mode', 'formal',
      '--core', options.core,
      '--case', casePath,
      '--expected-seal', caseEntry.seal,
      '--evidence-root', trialEvidenceRoot,
      '--suite-id', options.suiteId,
      '--isolation-profile', options.isolationProfilePath,
      '--trial-id', trialId,
      '--planned-slot-id', plannedSlotId
    ]
    const run = await spawnRunner(args)
    let summary
    try {
      summary = JSON.parse(run.stdout.trim())
    } catch (error) {
      throw new Error(`qualification Trial returned invalid summary: ${error.message}; stderr=${run.stderr.slice(-2000)}`)
    }
    const manifest = JSON.parse(await readFile(join(trialEvidenceRoot, trialId, 'environment-manifest.json'), 'utf8').catch(() => 'null'))
    if (summary.validity === 'valid') {
      if (!manifest?.teamRuntimeCompatibilityDigest) throw new Error('valid Trial has no environment compatibility digest')
      compatibilityDigest ??= manifest.teamRuntimeCompatibilityDigest
      if (manifest.teamRuntimeCompatibilityDigest !== compatibilityDigest) {
        summary = {
          ...summary,
          validity: 'invalid',
          evaluationState: 'pending',
          hardOutcome: 'unavailable',
          overall: 'unavailable',
          driftDetected: true
        }
      }
    }
    if (phase === 'calibration' && summary.validity === 'valid' && summary.evaluationState === 'complete') {
      summary = { ...summary, calibrationAudit: await auditCalibration(trialId) }
    } else if (phase === 'calibration') {
      summary = {
        ...summary,
        calibrationAudit: {
          passed: null,
          checks: {},
          reason: { code: 'calibration.trial_not_scorable' }
        }
      }
    }
    console.log(`[qualification] ${caseEntry.id} ${summary.overall}`)
    return {
      phase,
      plannedSlotId,
      trialId,
      caseId: caseEntry.id,
      caseVersion: caseEntry.version,
      caseSeal: caseEntry.seal,
      summary
    }
  }

  async function auditCalibration(trialId) {
    const result = JSON.parse(await readFile(join(trialEvidenceRoot, trialId, 'result.json'), 'utf8'))
    const observations = (await readFile(join(trialEvidenceRoot, trialId, 'observations.ndjson'), 'utf8'))
      .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    const finalObservation = observations.at(-1)?.snapshot
    const actualMembers = [...new Set(result.collaborationEvidence?.members ?? [])].sort()
    const rabbitRunIds = new Set((finalObservation?.agentRuns ?? [])
      .filter((run) => run.agentId === 'agent_4').map((run) => run.id))
    const rabbitToolTitles = (finalObservation?.executionEvidence ?? [])
      .filter((evidence) => rabbitRunIds.has(evidence.agentRunId))
      .flatMap((evidence) => Object.values(evidence.safeIdentity ?? {}))
      .filter((value) => typeof value === 'string')
    const checks = {
      allFourMembersRan: actualMembers.join(',') === ['agent_1', 'agent_2', 'agent_3', 'agent_4'].join(','),
      atLeastThreeDurableMemberCallEffects: (result.collaborationEvidence?.a2a?.length ?? 0) >= 3,
      canonicalReceiptCoverage: Number.isInteger(result.collaborationEvidence?.metrics?.acceptedMemberCalls),
      antigravityMemberCall: rabbitToolTitles.some((value) => value.includes('team.call_member')),
      antigravityContextOperation: rabbitToolTitles.some((value) => value.startsWith('context.')),
      antigravityMemoryOperation: rabbitToolTitles.some((value) => value.startsWith('memory.')),
      verifiedDelivery: result.verifiedDelivery === 'pass',
      converged: result.orchestrationConvergence === 'pass'
    }
    return { passed: Object.values(checks).every(Boolean), checks }
  }

  async function finish(status) {
    const summary = buildLegacyV034Summary({
      suite,
      suiteId: options.suiteId,
      outcomes,
      compatibilityDigest,
      status,
      diagnostic: options.diagnosticNoCalibration,
      priorCalibration,
      plannedSlotIds: formalOrder.map((entry) => entry.plannedSlotId)
    })
    await atomicWriteJson(join(suiteEvidenceRoot, 'suite-summary.json'), summary)
    console.log(JSON.stringify(summary, null, 2))
  }
}

export function parseLegacyV034Arguments(args) {
  const values = {}
  while (args.length > 0) {
    const argument = args.shift()
    if (!argument.startsWith('--')) return null
    const key = argument.slice(2)
    if (key === 'diagnostic-no-calibration') {
      values[key] = true
      continue
    }
    if (!['pack', 'core', 'evidence-root', 'suite-id', 'isolation-profile', 'prior-calibration-summary'].includes(key)) return null
    values[key] = args.shift()
  }
  if (!values.pack || !values.core || !values['evidence-root'] || !values['suite-id'] || !values['isolation-profile']) return null
  if (Boolean(values['diagnostic-no-calibration']) !== Boolean(values['prior-calibration-summary'])) return null
  return {
    pack: resolve(values.pack),
    core: resolve(values.core),
    evidenceRoot: resolve(values['evidence-root']),
    suiteId: values['suite-id'],
    isolationProfilePath: resolve(values['isolation-profile']),
    diagnosticNoCalibration: values['diagnostic-no-calibration'] === true,
    priorCalibrationSummary: values['prior-calibration-summary'] ? resolve(values['prior-calibration-summary']) : null
  }
}

function resolveInsidePack(packRoot, locator) {
  const normalized = validateRelativeLocator(locator, 'suite case directory')
  const target = resolve(packRoot, normalized)
  if (!target.startsWith(`${packRoot}${sep}`)) throw new Error('suite case directory escapes the pack')
  return target
}

function spawnRunner(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', rejectRun)
    child.once('close', (code, signal) => resolveRun({ code, signal, stdout, stderr }))
  })
}
