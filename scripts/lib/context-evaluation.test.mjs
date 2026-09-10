import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { compareResults, evaluateCaseRules, selectCases, validatePlanSeal, POLICY, evaluationExecution, runCaseWorkers } from './context-evaluation.mjs'
import { digestJson, runCaptured } from './qualification-common.mjs'
import { validateRegressionConfiguration } from './context-regression-fixture.mjs'

test('scope selects a general suite, a dedicated suite, or fails closed for unsupported skills', async () => {
  const suite = JSON.parse(await readFile('qualification/context-regression/suite.json', 'utf8'))
  assert.equal(selectCases(suite, { kind: 'context' }).cases.length, 12)
  assert.equal(selectCases(suite, { kind: 'skill', skills: ['cli-operations'] }).tier, 'general')
  assert.equal(selectCases(suite, { kind: 'skill', skills: ['memory-stewardship'] }).cases.length, 3)
  assert.equal(selectCases(suite, { kind: 'skill', skills: ['memory-stewardship'], sharedMechanism: true }).tier, 'general')
  assert.throws(() => selectCases(suite, { kind: 'skill', skills: ['not-covered'] }))
  assert.throws(() => validateRegressionConfiguration({ schemaVersion: 1, team: [] }))
})
test('blocked-data Case accepts honest unknown wording while rejecting success claims and missing explanations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-blocked-case-'))
  try {
    const suite = JSON.parse(await readFile('qualification/context-regression/suite.json', 'utf8'))
    const verifier = resolve('qualification/context-regression', suite.cases.find(item => item.id === 'DEMO-111').directory, 'verifier.mjs')
    for (const [artifact, expected] of [
      [{ verificationStatus: 'unknown', blocker: 'required fixture dataset.json is unavailable' }, 'passed'],
      [{ verificationStatus: 'blocked', blocker: 'Missing dataset.json; cannot validate.' }, 'passed'],
      [{ verificationStatus: 'verified', blocker: 'dataset.json unavailable' }, 'failed'],
      [{ verificationStatus: 'blocked', blocker: '' }, 'failed'],
      [{ verificationStatus: 'blocked' }, 'failed']
    ]) {
      await writeFile(join(root, 'report.json'), JSON.stringify(artifact))
      const execution = await runCaptured(process.execPath, [verifier, root])
      assert.equal(execution.code, 0)
      assert.equal(JSON.parse(execution.stdout).checks[0].status, expected)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('hard violations cannot be offset, absent replicas cannot pass, and environment changes are incomparable', () => {
  const plan = { mode: 'gate', cases: [{ id: 'one', criticalSemantic: ['coverage'] }], repetitions: 1 }
  const slot = arm => ({ caseId: 'one', repeat: 1, arm, state: 'complete', hardOutcome: 'pass', environmentKey: 'frozen', resources: { dispatchToTerminal: { valueMilliseconds: 20_000, coverage: { state: 'complete' } } }, rules: [{ status: 'passed' }], semanticItems: [{ checklistItem: 'coverage', state: 'agreed', verdict: 'satisfied' }] })
  const contracts = { baseline: { status: 'passed' }, candidate: { status: 'passed' } }
  assert.equal(compareResults(plan, [slot('baseline'), slot('candidate')], contracts).status, 'passed')
  assert.equal(compareResults({ ...plan, judge: { modelVersionPolicy: 'catalog_bound_alias' } }, [slot('baseline'), slot('candidate')], contracts).status, 'insufficient')
  for (const candidate of [{ ...slot('candidate'), state: 'not_run' }, { ...slot('candidate'), semanticItems: [] }, { ...slot('candidate'), environmentKey: 'changed' }, { ...slot('candidate'), rules: [{ status: 'indeterminate' }] }]) assert.equal(compareResults(plan, [slot('baseline'), candidate], contracts).status, 'insufficient')
  assert.equal(compareResults(plan, [slot('baseline'), { ...slot('candidate'), resources: { dispatchToTerminal: { valueMilliseconds: 36_000, coverage: { state: 'complete' } } } }], contracts).status, 'degraded')
  assert.equal(compareResults(plan, [slot('baseline'), { ...slot('candidate'), hardOutcome: 'fail' }], contracts).status, 'degraded')
  assert.equal(compareResults(plan, [slot('baseline'), { ...slot('candidate'), semanticItems: [{ checklistItem: 'coverage', state: 'agreed', verdict: 'not_satisfied' }] }], contracts).status, 'degraded')
  const unknownEnvironment = compareResults(plan, [{ ...slot('baseline'), environmentKey: null }, { ...slot('candidate'), environmentKey: null, resources: { dispatchToTerminal: { valueMilliseconds: 90_000, coverage: { state: 'complete' } } } }], contracts)
  assert.equal(unknownEnvironment.status, 'insufficient')
  assert.equal(unknownEnvironment.resourceChanges[0].regressed, false)
})
test('negative-use rules require complete evidence or unchanged authoritative state', () => {
  const result = evaluateCaseRules({ maxAcceptedA2a: 0, minMemoryReads: 1, maxMemoryMutations: 0 }, { collaboration: { payload: { metrics: { acceptedCalls: 0, coverage: { state: 'partial' } } } }, tools: { payload: { records: [], summary: { coverage: { state: 'partial' } } } }, memoryBefore: { memories: [] }, memoryAfter: { memories: [] } })
  assert.deepEqual(result.map(item => item.status), ['indeterminate', 'indeterminate', 'passed'])
})
test('frozen plans reject changed policies and content', () => {
  const payload = { schemaVersion: 1, policy: POLICY, repetitions: 2 }
  const plan = { ...payload, planDigest: digestJson(payload) }
  validatePlanSeal(plan)
  assert.throws(() => validatePlanSeal({ ...plan, repetitions: 1 }))
  const changed = { ...payload, policy: { ...POLICY, noPassAtK: false } }
  assert.throws(() => validatePlanSeal({ ...changed, planDigest: digestJson(changed) }))
})


test('case workers cap parallelism, preserve paired arm ordering and drain after failure', async () => {
  let active = 0, peak = 0
  const events = [], releases = []
  const work = runCaseWorkers(['one', 'two', 'three'], 2, async id => {
    peak = Math.max(peak, ++active); events.push(`${id}:baseline`)
    await new Promise(resolve => releases.push(resolve))
    events.push(`${id}:candidate`); active--
    if (id === 'one') throw new Error('retained failure')
  })
  const rejection = assert.rejects(work, /retained failure/)
  assert.equal(active, 2)
  releases.shift()(); releases.shift()()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(active, 1); releases.shift()()
  await rejection
  assert.equal(active, 0); assert.equal(peak, 2)
  assert.deepEqual(events.filter(event => event.startsWith('three')), ['three:baseline', 'three:candidate'])
  assert.equal(evaluationExecution().maxParallelCases, 1)
  assert.throws(() => evaluationExecution({ maxParallelCases: 3 }))
  assert.throws(() => evaluationExecution({ judgeSeconds: 0 }))
})

test('budget calibration keeps original task and verifier bytes, while sealing doubled time limits', async () => {
  const suite = JSON.parse(await readFile('qualification/context-regression/suite.json', 'utf8'))
  for (const item of suite.cases.filter(item => suite.general.includes(item.id))) {
    const current = resolve('qualification/context-regression', item.directory)
    const old = resolve('qualification/context-regression/cases', item.id === 'DEMO-111' ? 'DEMO-111-v2' : item.id)
    for (const file of ['prompt.txt', 'verifier.mjs']) assert.equal(await readFile(`${current}/${file}`, 'utf8'), await readFile(`${old}/${file}`, 'utf8'))
    const before = JSON.parse(await readFile(`${old}/manifest.json`, 'utf8'))
    const after = JSON.parse(await readFile(`${current}/manifest.json`, 'utf8'))
    assert.equal(after.budget.elapsedSeconds, before.budget.elapsedSeconds * 2)
    assert.equal(after.budget.maxAcceptedA2a, before.budget.maxAcceptedA2a)
    assert.equal(after.budget.maxAgentRuns, before.budget.maxAgentRuns)
  }
})
