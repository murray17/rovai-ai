import { buildSuiteProgress } from '../../lib/qualification-evaluation.mjs'
import {
  QUALIFICATION_RUNNER_VERSION,
  sha256
} from '../../lib/qualification-common.mjs'

export function buildLegacyV034Summary({ suite, suiteId, outcomes, compatibilityDigest, status,
  diagnostic, priorCalibration, plannedSlotIds }) {
  const formal = outcomes.filter((outcome) => outcome.phase !== 'calibration')
  const calibration = outcomes.find((outcome) => outcome.phase === 'calibration')
  const progress = buildSuiteProgress(plannedSlotIds, formal.map((outcome) => ({
    plannedSlotId: outcome.plannedSlotId,
    dispatchAccepted: outcome.summary.dispatchAccepted,
    validity: outcome.summary.validity,
    evaluationState: outcome.summary.evaluationState,
    hardOutcome: outcome.summary.hardOutcome
  })))
  const perCase = Object.fromEntries(suite.cases.map((entry) => {
    const results = formal.filter((outcome) => outcome.caseId === entry.id).map((outcome) => outcome.summary.overall)
    return [entry.id, { passes: results.filter((value) => value === 'pass').length, repeats: results.length, results }]
  }))
  return {
    schemaVersion: 2,
    runnerVersion: QUALIFICATION_RUNNER_VERSION,
    suiteId,
    suiteVersion: suite.version,
    seed: suite.seed,
    status,
    resultClass: diagnostic ? 'post_gate_diagnostic_benchmark' : 'qualification',
    qualificationEligible: !diagnostic && deriveCalibrationOutcome(calibration) === 'pass',
    calibration: calibration ? deriveCalibrationOutcome(calibration) : (priorCalibration ? 'failed_prior' : 'not_run'),
    priorCalibration,
    formalTrialsCompleted: formal.length,
    formalPasses: progress.counts.passes,
    totalPlanned: suite.rounds * suite.cases.length,
    plannedSlots: progress.plannedSlots,
    counts: progress.counts,
    publicationState: diagnostic ? 'unpublishable' : progress.publicationState,
    finalPassRate: diagnostic ? null : progress.finalPassRate,
    unpublishableReason: diagnostic
      ? { code: 'suite.calibration_not_passed' }
      : progress.unpublishableReason,
    perCase,
    outcomes: outcomes.map(publicOutcome),
    teamRuntimeCompatibilityDigest: compatibilityDigest,
    semanticEngineeringReview: { status: 'unavailable', reason: { code: 'semantic_judge.not_invoked' } },
    metric: 'raw_repeat_outcomes_not_pass_at_k',
    ambientMcpIsolation: summarizeAmbientMcpIsolation(outcomes)
  }
}

export function deriveCalibrationOutcome(calibration) {
  if (!calibration) return 'not_run'
  if (calibration.summary.evaluationState !== 'complete'
      || calibration.summary.overall === 'unavailable') return 'unavailable'
  return calibration.summary.overall === 'pass'
    && calibration.summary.calibrationAudit?.passed === true
    ? 'pass'
    : 'fail'
}

export async function readPriorCalibration(readFile, path, suite) {
  const raw = await readFile(path, 'utf8')
  const summary = JSON.parse(raw)
  if (summary?.suiteVersion !== suite.version
      || summary.calibration !== 'fail'
      || summary.formalTrialsCompleted !== 0
      || typeof summary.suiteId !== 'string') {
    throw new Error('diagnostic mode requires a failed same-version calibration suite summary')
  }
  return { suiteId: summary.suiteId, result: summary.calibration, summaryDigest: sha256(raw) }
}

function publicOutcome(outcome) {
  return {
    phase: outcome.phase,
    plannedSlotId: outcome.plannedSlotId,
    trialId: outcome.trialId,
    caseId: outcome.caseId,
    caseVersion: outcome.caseVersion,
    caseSeal: outcome.caseSeal,
    result: outcome.summary.overall,
    validity: outcome.summary.validity,
    evaluationState: outcome.summary.evaluationState,
    dispatchAccepted: outcome.summary.dispatchAccepted,
    hardOutcome: outcome.summary.hardOutcome,
    verifiedDelivery: outcome.summary.verifiedDelivery,
    orchestrationConvergence: outcome.summary.orchestrationConvergence,
    postDispatchHumanIntervention: outcome.summary.postDispatchHumanIntervention,
    observedAgentRuns: outcome.summary.budget?.observedAgentRuns ?? null,
    observedAcceptedA2a: outcome.summary.budget?.observedAcceptedA2a ?? null,
    observedDurableA2aEffects: outcome.summary.budget?.observedDurableA2aEffects ?? null,
    acceptedA2aAuthority: outcome.summary.budget?.acceptedA2aAuthority ?? null,
    collaborationAuditPassed: outcome.summary.collaborationAudit?.passed ?? null
  }
}

function summarizeAmbientMcpIsolation(trials) {
  const states = [...new Set(trials
    .map((trial) => trial.summary.ambientMcpIsolation)
    .filter((state) => typeof state === 'string' && state !== ''))]
  if (states.length === 0) return 'unavailable'
  return states.length === 1 ? states[0] : 'mixed'
}
