import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { evaluateQualityAndCollaboration, validateScoring, collaborationGroupVerdict } from './context-quality.mjs'
import { compareResults } from './context-evaluation.mjs'
const suite = JSON.parse(await readFile(new URL('../../qualification/context-regression/suite.json', import.meta.url)))
const scoring = JSON.parse(await readFile(new URL('../../qualification/context-regression/scoring-v2.json', import.meta.url)))
const plan = (ids = ['DEMO-106'], repetitions = 1) => ({ mode: 'gate', cases: suite.cases.filter(item => ids.includes(item.id)), repetitions, scoring: structuredClone(scoring) })
function slot(p, arm, caseId = p.cases[0].id, repeat = 1) {
  const config = p.scoring.cases[caseId]
  return { caseId, repeat, arm, state: 'complete', hardOutcome: 'pass', environmentKey: 'fixture-environment', judgeStatus: 'complete',
    resources: { dispatchToTerminal: { valueMilliseconds: 1000, coverage: { state: 'complete' } } },
    checks: config.quality.filter(item => item.source === 'check').map(item => ({ checkId: item.ruleId, status: 'passed' })),
    rules: config.quality.filter(item => item.source === 'rule').map(item => ({ id: item.ruleId, status: 'passed' })),
    semanticItems: [...config.quality.filter(item => item.source === 'outcome'), ...config.collaboration].map(item => ({ checklistItem: item.checklistItem, state: 'agreed', verdict: item.applicable ? 'satisfied' : 'not_applicable', reason: 'Synthetic test fixture, not a real Judge result.', evidenceReferences: [{ artifactId: 'fixture', evidenceId: 'fixture' }] })) }
}
const contracts = { baseline: { status: 'passed' }, candidate: { status: 'passed' } }

test('new scoring rejects applicable metrics without a declared evidence owner', () => {
  const candidate = structuredClone(scoring)
  candidate.version = '2.3.0'
  assert.throws(() => validateScoring(candidate, suite.cases), /Metric evidence contract|task evidence scope/)
})

test('observable metric contracts and adjudication do not erase unknowns or hard failures', async () => {
  const current = JSON.parse(await readFile(new URL('../../qualification/context-regression/scoring-v2.3.json', import.meta.url)))
  validateScoring(current, suite.cases)
  const p = plan(['DEMO-102']); p.scoring = current
  const after = slot(p, 'candidate')
  Object.assign(after.semanticItems[0], { state:'adjudicated', verdict:'not_satisfied', adjudication:{ verdict:'not_satisfied', reason:'Fixture evidence contradicts delivery.' } })
  let result = compareResults(p, [slot(p, 'baseline'), after], contracts)
  assert.equal(result.assessment.arms.candidate.quality.total, 87.5)
  assert.equal(result.status, 'degraded')
  after.semanticItems[0].verdict = 'indeterminate'
  result = compareResults(p, [slot(p, 'baseline'), after], contracts)
  assert.equal(result.assessment.arms.candidate.quality.total, null)
  for (const mutate of [
    item => { delete item.verification },
    item => { item.verification.view = 'process' },
    item => { item.verification.sources = [] },
    item => { item.verification.scope = 'Prove no unobserved action occurred.' }
  ]) {
    const edited = structuredClone(current)
    mutate(edited.cases['DEMO-102'].quality[0])
    assert.throws(() => validateScoring(edited, suite.cases), /Metric evidence contract/)
  }
})

test('every existing Case has frozen task-neutral acceptance and no collaboration score', () => {
  validateScoring(scoring, suite.cases)
  const p = plan(['DEMO-102']), report = evaluateQualityAndCollaboration(p, [slot(p, 'baseline'), slot(p, 'candidate')])
  assert.equal(report.arms.candidate.quality.total, 100)
  assert.equal(report.arms.candidate.collaboration.groups.integration.rates.satisfied.value, null)
  assert.equal(Object.hasOwn(report.arms.candidate.collaboration, 'score'), false)
  assert.match(scoring.cases['DEMO-102'].quality.find(item => item.checklistItem === 'SER.testing.strategy').criterion, /不要求编写代码测试/)
})
test('unknown/disagreement/illegal N/A keep their weight and withhold a complete score', () => {
  for (const change of [{ state: 'disagreed', verdict: null }, { state: 'agreed', verdict: 'indeterminate' }, { state: 'agreed', verdict: 'not_applicable' }]) {
    const p = plan(), after = slot(p, 'candidate'); Object.assign(after.semanticItems[0], change)
    const r = evaluateQualityAndCollaboration(p, [slot(p, 'baseline'), after])
    assert.equal(r.arms.candidate.quality.total, null)
    assert.equal(r.arms.candidate.quality.dimensions.goal.score, null)
    assert.equal(r.arms.candidate.quality.dimensions.evidence.score, 100)
    assert.equal(r.arms.candidate.quality.coverage.value, 0.875)
  }
})
test('partial verdicts are half-value only in quality, never collaboration successes', () => {
  const p=plan(), after=slot(p,'candidate')
  after.semanticItems[0].verdict='partially_satisfied'
  after.semanticItems.find(item=>item.checklistItem.endsWith('delegation')).verdict='partially_satisfied'
  const r=evaluateQualityAndCollaboration(p,[slot(p,'baseline'),after])
  assert.equal(r.arms.candidate.quality.total,93.75)
  assert.equal(r.arms.candidate.collaboration.groups.coordination.rates.satisfied.value,0)
  assert.equal(r.arms.candidate.collaboration.groups.coordination.counts.partially_satisfied,1)
})
test('planned missing Trials remain unknown and repetitions are not distinct Cases', () => {
  const p=plan(['DEMO-106'],3)
  const r=evaluateQualityAndCollaboration(p,[slot(p,'candidate')])
  const d=r.arms.candidate.collaboration.groups.handoff
  assert.equal(d.distinctCases,1);assert.equal(d.applicableTrials,3)
  assert.equal(d.rates.satisfied.value,1/3);assert.equal(d.rates.indeterminate.value,2/3)
  assert.equal(r.arms.candidate.quality.total,null)
  assert.throws(()=>evaluateQualityAndCollaboration(p,[slot(p,'candidate'),slot(p,'candidate')]),/Duplicate/)
})
test('group failure precedes unknown but preserves gaps and every raw verdict', () => {
  const p=plan(), after=slot(p,'candidate')
  after.semanticItems.find(item=>item.checklistItem.endsWith('contribution_value')).verdict='not_satisfied'
  after.semanticItems.find(item=>item.checklistItem.endsWith('feedback_absorption')).state='disagreed'
  const r=evaluateQualityAndCollaboration(p,[slot(p,'baseline'),after])
  const d=r.arms.candidate.collaboration.groups.integration
  assert.equal(d.counts.not_satisfied,1);assert.equal(d.counts.indeterminate,0)
  assert.equal(d.trialsWithEvidenceGaps,1);assert.equal(d.unknownReasons.judge_disagreement,1)
  assert.equal(r.arms.candidate.trials[0].collaboration.length,5)
  assert.equal(collaborationGroupVerdict([{verdict:'not_applicable'}]),'not_applicable')
})
test('required collaboration with complete zero-observation fails; missing coverage stays unknown', () => {
  const p=plan(), after=slot(p,'candidate');after.semanticItems=[]
  after.collaborationObservation={accepted:0,complete:true}
  let r=evaluateQualityAndCollaboration(p,[after])
  assert.equal(r.arms.candidate.collaboration.criticalFailureTrials,1)
  assert.equal(r.arms.candidate.trials[0].critical.length,3)
  assert.equal(r.arms.candidate.collaboration.groups.handoff.counts.not_applicable,0)
  after.collaborationObservation.complete=false;r=evaluateQualityAndCollaboration(p,[after])
  assert.equal(r.arms.candidate.collaboration.criticalFailureTrials,0)
  assert.equal(r.arms.candidate.collaboration.criticalUnknownTrials,1)
})
test('high quality cannot compensate critical collaboration failure, partial, or unknown', () => {
  for(const [state,verdict,expected] of [['agreed','not_satisfied','degraded'],['agreed','partially_satisfied','degraded'],['disagreed',null,'insufficient']]){
    const p=plan(), after=slot(p,'candidate');Object.assign(after.semanticItems.find(item=>item.checklistItem.endsWith('handoff_clarity')),{state,verdict})
    const r=compareResults(p,[slot(p,'baseline'),after],contracts)
    assert.equal(r.assessment.arms.candidate.quality.total,100);assert.equal(r.status,expected)
  }
  const p=plan();assert.equal(compareResults(p,[slot(p,'baseline'),{...slot(p,'candidate'),hardOutcome:'fail'}],contracts).status,'degraded')
})
test('repetitions aggregate inside frozen Case weights, not checklist counts', () => {
  const p=plan(['DEMO-101','DEMO-102']);p.scoring.cases['DEMO-101'].weight=3
  const a=slot(p,'candidate','DEMO-101'),b=slot(p,'candidate','DEMO-102')
  for(const item of a.semanticItems) if(item.checklistItem.startsWith('SER.response.')) item.verdict='not_satisfied'
  const r=evaluateQualityAndCollaboration(p,[a,b]);assert.equal(r.arms.candidate.quality.total,81.25)
  const config=p.scoring.cases['DEMO-102'];config.quality[1].applicable=false
  const r2=evaluateQualityAndCollaboration(p,[a,b]);assert.equal(r2.arms.candidate.quality.total,81.25)
  assert.equal(r2.arms.candidate.quality.dimensions.boundary.score,100)
})
test('pair comparison distinguishes regression, existing failure, unknown and environment drift', () => {
  const p=plan(), before=slot(p,'baseline'),after=slot(p,'candidate')
  before.semanticItems[0].verdict='not_satisfied';after.semanticItems[0].verdict='not_satisfied'
  after.semanticItems[1].state='disagreed';after.semanticItems[2].verdict='partially_satisfied'
  let r=evaluateQualityAndCollaboration(p,[before,after])
  assert.equal(r.changes[0].kind,'existing_failure');assert.equal(r.changes[1].kind,'evidence_change');assert.equal(r.changes[2].kind,'regression')
  after.environmentKey='changed';r=evaluateQualityAndCollaboration(p,[before,after]);assert.equal(r.comparison.qualityDelta,null)
  assert.equal(r.comparison.groupChanges.handoff.deltaPercentagePoints,null)
  assert.ok(r.changes.every(item=>item.kind==='incomparable'))
})
test('freeze rejects critical exclusions, missing dimensions and duplicated scoring sources', () => {
  for(const mutate of [p=>p.scoring.cases['DEMO-106'].collaboration[1].applicable=false,p=>p.scoring.dimensions.goal=80,p=>p.scoring.cases['DEMO-106'].quality.push({...p.scoring.cases['DEMO-106'].quality[0],id:'duplicate'})]){
    const p=plan();mutate(p);assert.throws(()=>validateScoring(p.scoring,p.cases))
  }
})

test('weekly separates acceptance failure, missing evaluation and unmeasured regression', () => {
  const p = { ...plan(['DEMO-106']), mode: 'weekly' }, after = slot(p, 'candidate')
  after.hardOutcome = 'fail'
  after.semanticItems[0].verdict = 'not_satisfied'
  after.semanticItems[1].state = 'disagreed'
  const report = compareResults(p, [after], { candidate: { status: 'passed' } })
  assert.equal(report.status, 'degraded')
  assert.deepEqual(report.conclusions, { acceptance: 'failed', regression: 'not_compared', evaluation: 'incomplete', failedTrials: 1, evidenceGapTrials: 1, newRegressionTrials: 0, failureRecords: 2, evidenceGapRecords: 1 })
})
