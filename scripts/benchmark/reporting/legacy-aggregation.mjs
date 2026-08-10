import { sha256 } from '../protocol/canonical.mjs'

export function aggregateLegacyProjectSummary({
  selection,
  selectionRaw,
  sourceSuite,
  sourceSuiteRaw,
  normalizedSource,
  priorCalibration,
  priorCalibrationRaw,
  trials,
  invalidatedAttempts
}) {
  const qualification = sourceSuite.resultClass === 'qualification'
  const passes = trials.filter((trial) => trial.result === 'pass').length
  const memberCalls = trials.reduce((sum, trial) => sum + (trial.observedMemberCalls ?? 0), 0)
  const agentRuns = trials.reduce((sum, trial) => sum + (trial.observedAgentRuns ?? 0), 0)
  const completedTasks = trials.reduce((sum, trial) => sum + (trial.collaborationMetrics.completedTasks ?? 0), 0)
  const members = [...new Set(trials.flatMap((trial) => trial.members))].sort()
  const memberRunDurations = {}
  for (const trial of trials) {
    for (const [member, seconds] of Object.entries(trial.memberRunDurations)) {
      memberRunDurations[member] = Math.round(((memberRunDurations[member] ?? 0) + seconds) * 10) / 10
    }
  }
  const calibrationSuite = qualification ? sourceSuite : priorCalibration
  const calibrationOutcome = calibrationSuite?.outcomes?.find((outcome) => outcome.phase === 'calibration') ?? null
  const perCase = Object.fromEntries([...new Set(trials.map((trial) => trial.caseId))].sort().map((caseId) => {
    const values = trials.filter((trial) => trial.caseId === caseId)
    return [caseId, {
      passes: values.filter((trial) => trial.result === 'pass').length,
      functionalPasses: values.filter((trial) => trial.functionalVerificationPassed).length,
      boundaryPasses: values.filter((trial) => trial.changeBoundaryPassed).length,
      collaborationPasses: values.filter((trial) => trial.collaborationAuditPassed).length,
      collaborationIndeterminate: values.filter((trial) => trial.collaborationAuditStatus === 'indeterminate').length,
      repeats: values.length,
      results: values.map((trial) => trial.result),
      stable: new Set(values.map((trial) => trial.result)).size === 1
    }]
  }))
  const failedVerifierCategories = countFacts(trials.flatMap((trial) => (
    trial.verifierCategories.filter((value) => value.status === 'failed').map((value) => value.name)
  )))
  const boundaryViolations = countFacts(trials.flatMap((trial) => (
    trial.changeBoundaryViolations.map((violation) => `${violation.path}:${violation.reason}`)
  )))
  const score = {
    validTrials: trials.length,
    passes,
    failures: trials.length - passes,
    outcomeRate: passes / trials.length,
    metric: 'raw_repeat_outcomes_not_pass_at_k',
    perCase
  }
  return {
    schemaVersion: normalizedSource.sourceSchemaVersion,
    benchmarkId: selection.benchmarkId,
    suiteId: selection.suiteId,
    suiteVersion: selection.suiteVersion,
    reviewedAt: selection.reviewedAt,
    resultClass: sourceSuite.resultClass,
    qualificationEligible: qualification,
    formalPassRate: qualification ? normalizedSource.publicationRate : null,
    calibration: {
      status: qualification ? 'passed' : 'failed_prior',
      suiteId: calibrationSuite?.suiteId ?? null,
      result: qualification ? sourceSuite.calibration : priorCalibration?.calibration,
      observedAgentRuns: calibrationOutcome?.observedAgentRuns ?? null,
      observedMemberCalls: calibrationOutcome?.observedAcceptedA2a
        ?? calibrationOutcome?.observedDurableA2aEffects
        ?? null,
      orchestrationConvergence: calibrationOutcome?.orchestrationConvergence ?? null,
      collaborationAuditPassed: calibrationOutcome?.collaborationAuditPassed ?? null
    },
    score,
    diagnostic: qualification ? null : score,
    collaboration: {
      observedAgentRuns: agentRuns,
      observedMemberCalls: memberCalls,
      completedTasks,
      memberRunDurations,
      members,
      onlyLeadRan: memberCalls === 0 && members.length === 1,
      teamCapabilityAssessed: memberCalls > 0 && members.length > 1,
      auditsPassed: trials.filter((trial) => trial.collaborationAuditPassed).length,
      auditsIndeterminate: trials.filter((trial) => trial.collaborationAuditStatus === 'indeterminate').length,
      pollingViolationTrials: trials.filter((trial) => trial.pollingViolations > 0).length,
      conclusion: trials.every((trial) => trial.collaborationAuditStatus === 'passed')
        ? 'All formal Trials satisfied the observed collaboration checks; functional delivery remains a separate outcome.'
        : trials.some((trial) => trial.collaborationAuditStatus === 'failed')
          ? 'At least one Trial had an adverse observed collaboration fact.'
          : 'Collaboration receipt coverage was insufficient for a complete deterministic audit.'
    },
    qualitySignals: {
      allOrchestrationsConverged: trials.every((trial) => trial.orchestrationConvergence === 'pass'),
      allBoundariesPassed: trials.every((trial) => trial.changeBoundaryPassed === true),
      noHumanIntervention: trials.every((trial) => trial.postDispatchHumanIntervention === 'absent'),
      noBudgetTrigger: trials.every((trial) => trial.budgetTriggered === null),
      allPublicChecksPassed: trials.every((trial) => trial.publicHardChecks.length > 0
        ? trial.publicHardChecks.every((check) => check.status === 'passed')
        : trial.verifierCategories.filter((category) => category.name === 'public')
          .every((category) => category.status === 'passed')),
      functionalVerificationPasses: trials.filter((trial) => trial.functionalVerificationPassed).length,
      boundaryPasses: trials.filter((trial) => trial.changeBoundaryPassed).length,
      modeOnlyBoundaryFailureTrials: trials.filter((trial) => !trial.changeBoundaryPassed
        && trial.changeBoundaryViolations.length > 0
        && trial.changeBoundaryViolations.every((violation) => trial.modeOnlyChangedPaths.includes(violation.path))).length,
      collaborationAuditPasses: trials.filter((trial) => trial.collaborationAuditPassed).length,
      collaborationAuditIndeterminate: trials.filter((trial) => trial.collaborationAuditStatus === 'indeterminate').length,
      singleSlotPasses: trials.filter((trial) => trial.sameMemberRunOverlaps.length === 0).length,
      pendingWhileBusyObservedTrials: trials.filter((trial) => trial.schedulingEvidence.pendingWhileBusy).length,
      failedVerifierCategories,
      boundaryViolations
    },
    trials,
    invalidatedAttempts,
    judge: 'not_included',
    ambientMcpIsolation: 'preserved_uncontrolled',
    limitations: qualification
      ? [
          'No LLM Judge or composite semantic score is included.',
          'Protocol compliance proves transport and workflow discipline, not the semantic value of each member contribution.',
          'Ambient user MCP remains preserved and is not strictly isolated.',
          'Private prompts, verifier implementation details, and final workspaces are not exported.'
        ]
      : [
          'A failed calibration means this benchmark has no formal Qualification Pass Rate.',
          'No LLM Judge or composite semantic score is included.',
          `The ${englishCount(trials.length)} selected Trials used only the default Lead and made no Member Calls.`,
          'Private prompts, verifier implementation details, and final workspaces are not exported.'
        ],
    integrity: {
      selectionDigest: sha256(selectionRaw),
      sourceSuiteSummaryDigest: sha256(sourceSuiteRaw),
      priorCalibrationSummaryDigest: priorCalibrationRaw ? sha256(priorCalibrationRaw) : null,
      sourceSuiteStatus: sourceSuite.status,
      sourceSuiteCompletedTrials: sourceSuite.formalTrialsCompleted,
      runnerVersions: [...new Set(trials.map((trial) => trial.runnerVersion))].sort()
    }
  }
}

function countFacts(values) {
  return values.reduce((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {})
}

function englishCount(value) {
  return new Map([[12, 'twelve']]).get(value) ?? String(value)
}
