import { normalizeBenchmarkArtifact } from '../adapters/registry.mjs'

export function selectionFromLegacyQualification(sourceSuite, normalizedSource, reviewedAt = new Date().toISOString()) {
  if (sourceSuite.resultClass !== 'qualification') {
    throw new Error('automatic selection is only valid for a formal Qualification source')
  }
  return {
    schemaVersion: normalizedSource.sourceSchemaVersion,
    benchmarkId: `${sourceSuite.suiteId}-formal-review`,
    suiteId: sourceSuite.suiteId,
    suiteVersion: sourceSuite.suiteVersion,
    reviewedAt,
    trials: normalizedSource.slots.map(({ round, caseId, trialId }) => ({ round, caseId, trialId })),
    invalidatedAttempts: []
  }
}

export function validateLegacySelection(selection, normalizedSource) {
  if (selection?.schemaVersion !== normalizedSource.sourceSchemaVersion
      || selection.suiteId !== normalizedSource.suite.id
      || selection.suiteVersion !== normalizedSource.suite.version
      || typeof selection.benchmarkId !== 'string'
      || !Array.isArray(selection.trials)
      || !Array.isArray(selection.invalidatedAttempts)) {
    throw new Error('benchmark selection manifest is invalid')
  }
  const selected = new Set(selection.trials.map((entry) => `${entry.round}:${entry.caseId}`))
  const expected = new Set(normalizedSource.slots.map((entry) => `${entry.round}:${entry.caseId}`))
  if (selected.size !== expected.size || [...expected].some((key) => !selected.has(key))) {
    throw new Error('selected Trials do not match the Adapter-defined complete matrix')
  }
  return selection
}

export function validateLegacySourceSummaries({ sourceSuite, normalizedSource, priorCalibration }) {
  const qualification = sourceSuite.resultClass === 'qualification'
  if (qualification) {
    if (sourceSuite.status !== 'completed' || sourceSuite.qualificationEligible !== true
        || sourceSuite.calibration !== 'pass'
        || sourceSuite.formalTrialsCompleted !== normalizedSource.suite.plannedSlotCount
        || typeof normalizedSource.publicationRate !== 'number') {
      throw new Error('formal Qualification source is incomplete or ineligible')
    }
    return
  }
  if (sourceSuite.resultClass !== 'post_gate_diagnostic_benchmark'
      || sourceSuite.qualificationEligible !== false
      || priorCalibration?.suiteVersion !== normalizedSource.suite.version
      || priorCalibration.calibration !== 'fail'
      || priorCalibration.formalTrialsCompleted !== 0) {
    throw new Error('diagnostic benchmark source summaries do not match the selection')
  }
}

export function normalizeLegacySource(sourceSuite) {
  return normalizeBenchmarkArtifact(sourceSuite)
}
