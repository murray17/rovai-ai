import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { aggregateLegacyProjectSummary } from './reporting/legacy-aggregation.mjs'
import { renderLegacyProjectReport } from './reporting/markdown.mjs'
import { digestJson, sha256 } from './protocol/canonical.mjs'
import { normalizeLegacyQualificationTrial } from './adapters/registry.mjs'

test('historical v0.31/v0.32/v0.34/v0.36 source digests remain unchanged', async () => {
  const expected = {
    'qualification/acceptance/v0.34/acceptance-registry.json': 'eee8533c14a56035ff8d1a7250befcb3bc975713e5fe05b0c2265ef14329d857',
    'qualification/demo/DEMO-001/manifest.json': '91dadf1eedb166a2cd093812c6499d8e37e9c77551f53f8e6c302a3320671a13',
    'qualification/diagnostic/v0.36/results/DCP-001-1.0.1.json': '76ce540f0f0c7cb5fcb3256f615920ca371d025a9d1e6888d5558064605b3758'
  }
  for (const [file, digest] of Object.entries(expected)) assert.equal(sha256(await readFile(file)), digest, file)
})

test('legacy aggregation and Markdown retain dynamic raw-repeat semantics', () => {
  const cases = ['alpha', 'beta', 'gamma', 'delta']
  const selection = {
    schemaVersion: 2, benchmarkId: 'legacy-review', suiteId: 'legacy', suiteVersion: 'v0.34',
    reviewedAt: '2026-08-10T00:00:00.000Z', trials: [], invalidatedAttempts: []
  }
  const trials = []
  for (let round = 1; round <= 3; round += 1) {
    for (const caseId of cases) {
      const trialId = `r${round}-${caseId}`
      selection.trials.push({ round, caseId, trialId })
      trials.push({
        round, caseId, trialId, runnerVersion: '0.36.0', result: 'pass',
        verifiedDelivery: 'pass', functionalVerificationPassed: true,
        orchestrationConvergence: 'pass', postDispatchHumanIntervention: 'absent',
        changeBoundaryPassed: true, budgetTriggered: null, observedAgentRuns: 1,
        observedMemberCalls: 0, members: ['agent_1'], collaborationAuditStatus: 'passed',
        collaborationAuditPassed: true, collaborationMetrics: { completedTasks: 0 },
        pollingViolations: 0, sameMemberRunOverlaps: [], memberRunDurations: {},
        schedulingEvidence: { pendingWhileBusy: false }, verifierCategories: [], publicHardChecks: [],
        changeBoundaryViolations: [], modeOnlyChangedPaths: [], changedPaths: [], durationSeconds: 1,
        evidenceDigest: sha256(trialId)
      })
    }
  }
  const sourceSuite = {
    schemaVersion: 2, suiteId: 'legacy', suiteVersion: 'v0.34', resultClass: 'qualification',
    status: 'completed', qualificationEligible: true, calibration: 'pass', formalTrialsCompleted: 12,
    finalPassRate: 1, outcomes: [{ phase: 'calibration', observedAgentRuns: 4 }]
  }
  const normalizedSource = {
    sourceSchemaVersion: 2,
    publicationRate: 1,
    suite: { plannedSlotCount: 12 },
  }
  const summary = aggregateLegacyProjectSummary({
    selection, selectionRaw: `${JSON.stringify(selection)}\n`, sourceSuite,
    sourceSuiteRaw: `${JSON.stringify(sourceSuite)}\n`, normalizedSource,
    priorCalibration: null, priorCalibrationRaw: null, trials, invalidatedAttempts: []
  })
  const report = renderLegacyProjectReport(summary)
  assert.equal(summary.score.validTrials, 12)
  assert.equal(summary.score.metric, 'raw_repeat_outcomes_not_pass_at_k')
  assert.match(report, /三轮结果/)
  assert.match(report, /12 个有效样本/)
  assert.equal(digestJson(summary).length, 64)
})

test('legacy Trial schema 1 and 2 normalization preserves recorded Hard Outcome semantics', () => {
  assert.deepEqual(normalizeLegacyQualificationTrial({
    schemaVersion: 1,
    validity: 'valid',
    overall: 'pass',
    verifiedDelivery: true,
    orchestrationConvergence: true,
    postDispatchHumanIntervention: false
  }, 'qualification-suite-v032'), {
    sourceSchemaVersion: 1,
    validity: 'valid',
    evaluationState: 'complete',
    hardOutcome: 'pass',
    verifiedDelivery: 'pass',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent'
  })

  assert.deepEqual(normalizeLegacyQualificationTrial({
    schemaVersion: 2,
    validity: 'valid',
    evaluationState: 'complete',
    overall: 'fail',
    hardOutcome: 'fail',
    hardLayer: { overall: 'fail' },
    verifiedDelivery: 'fail',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent'
  }, 'qualification-suite-v034'), {
    sourceSchemaVersion: 2,
    validity: 'valid',
    evaluationState: 'complete',
    hardOutcome: 'fail',
    verifiedDelivery: 'fail',
    orchestrationConvergence: 'pass',
    postDispatchHumanIntervention: 'absent'
  })
})
