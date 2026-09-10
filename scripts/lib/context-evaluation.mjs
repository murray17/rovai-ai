import { copyFile, mkdir, readFile, writeFile, open, unlink, readdir } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { digestFile, digestJson, runCaptured, verifyStoredCaseSeal, writePrivateJsonExclusive } from './qualification-common.mjs'
import { loadQualificationResultHistory, computeQualificationEvaluatorDigest } from './qualification-recovery.mjs'
import { validateScoring, evaluateQualityAndCollaboration, semanticVerdict } from './context-quality.mjs'
import { renderGateHtml, renderReportIndex, sanitizeReportLinks } from '../../packages/evaluation/src/report-html.ts'
import { TASK_OUTCOME_RUBRIC, EVIDENCE_OUTCOME_RUBRIC, EVIDENCE_PROCESS_RUBRIC, RECEIPT_OUTCOME_RUBRIC, RECEIPT_PROCESS_RUBRIC } from './context-judge-profile.mjs'
import { PROCESS_JUDGE_RUBRIC, OUTCOME_JUDGE_RUBRIC } from './qualification-judge-views.mjs'
import { validateRegressionConfiguration } from './context-regression-fixture.mjs'
import { runCurrentContractConformance } from '../benchmark/execution/current-contract-runner.mjs'

const root = resolve(import.meta.dirname, '../..')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const terminal = status => ['passed', 'failed', 'indeterminate'].includes(status)
export const POLICY = Object.freeze({ version: 2, qualityScore: 'generic_task_v2', collaborationScore: 'none', scoreCompensation: 'forbidden', noPassAtK: true, hardFailuresBlock: true, missingEvidence: 'insufficient', maximumAttempts: 2, semanticCriticalVerdict: 'satisfied', counterbalancedReplicas: 2, latencyRegression: { relativeIncrease: 0.5, minimumIncreaseMilliseconds: 15_000 } })

export async function sourceFingerprint(repository) {
  const git = await runCaptured('git', ['rev-parse', 'HEAD'], { cwd: repository })
  const listing = await runCaptured('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repository, maxOutputBytes: 8 * 1024 * 1024 })
  if (git.code !== 0 || listing.code !== 0 || listing.outputOverflow) throw new Error('Cannot fingerprint the complete source checkout')
  const files = []
  for (const path of [...new Set(listing.stdout.split('\0').filter(Boolean))].sort()) {
    // Only production/build inputs belong to the product axis; evaluation code,
    // task packs and governance documents have their own frozen digests.
    if (!/^(crates\/|skills\/|Cargo\.(toml|lock)$|rust-toolchain|\.cargo\/)/.test(path)) continue
    try { files.push({ path, digest: await digestFile(join(repository, path)) }) }
    catch (error) { if (error.code === 'ENOENT') files.push({ path, digest: null }); else throw error }
  }
  return { commit: git.stdout.trim(), contentDigest: digestJson(files), files }
}

export async function buildProduct(repository, directory) {
  repository = resolve(repository); directory = resolve(directory)
  await mkdir(directory, { mode: 0o700 })
  const before = await sourceFingerprint(repository)
  const command = ['cargo', 'build', '--locked', '-p', 'rovai-core', '--bin', 'rovai-core', '--bin', 'rovai', '--target-dir', join(repository, 'target')]
  const execution = await runCaptured(command[0], command.slice(1), { cwd: repository, timeoutMs: 30 * 60_000, maxOutputBytes: 16 * 1024 * 1024 })
  await writePrivateJsonExclusive(join(directory, 'build-execution.json'), execution)
  if (execution.code !== 0 || execution.timedOut || execution.outputOverflow) throw new Error('Product build did not complete; build evidence retained')
  const after = await sourceFingerprint(repository)
  if (digestJson(before) !== digestJson(after)) throw new Error('Source changed while building')
  const extension = process.platform === 'win32' ? '.exe' : ''
  const core = join(directory, `rovai-core${extension}`), cli = join(directory, `rovai${extension}`)
  await copyFile(join(repository, 'target', 'debug', `rovai-core${extension}`), core)
  await copyFile(join(repository, 'target', 'debug', `rovai${extension}`), cli)
  const manifest = { schemaVersion: 1, repository, core, cli, source: after, coreDigest: await digestFile(core), cliDigest: await digestFile(cli), builtAt: new Date().toISOString(), command, profile: 'debug' }
  await writePrivateJsonExclusive(join(directory, 'product.json'), manifest)
  return manifest
}

export function selectCases(suite, change) {
  if (suite.schemaVersion !== 1 || !['regression', 'holdout'].includes(suite.partition) || !Array.isArray(suite.cases)) throw new Error('Invalid versioned regression suite')
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(suite.id) || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(suite.version) || new Set(suite.cases.map(item => item.id)).size !== suite.cases.length) throw new Error('Suite identities must be stable and unique')
  if (!['context', 'core_skill', 'skill'].includes(change.kind)) throw new Error('An explicit change kind is required')
  const core = change.kind !== 'skill' || change.sharedMechanism === true || (change.skills ?? []).some(skill => suite.coreSkills.includes(skill))
  const ids = core ? suite.general : [...new Set((change.skills ?? []).flatMap(skill => {
    if (!suite.skills[skill]?.length) throw new Error(`No dedicated case suite for ${skill}; author and seal cases before evaluating`)
    return suite.skills[skill]
  }))]
  if (core && (ids.length < 10 || ids.length > 15)) throw new Error('General Gate requires 10–15 distinct cases')
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Case selection is empty or duplicated')
  const cases = ids.map(id => { const item = suite.cases.find(item => item.id === id); if (!item) throw new Error(`Missing Case ${id}`); return item })
  return { tier: core ? 'general' : 'skill', cases }
}

export function evaluationExecution(value = {}) {
  const configuration = { version: 1, maxParallelCases: 1, judgeSeconds: 240, ...value }
  if (Object.keys(configuration).some(key => !['version', 'maxParallelCases', 'judgeSeconds'].includes(key)) || configuration.version !== 1 || ![1, 2].includes(configuration.maxParallelCases) || !Number.isInteger(configuration.judgeSeconds) || configuration.judgeSeconds < 240 || configuration.judgeSeconds > 600) throw new Error('Execution requires version 1, 1–2 parallel cases and a 240–600 second Judge budget')
  return configuration
}

// A worker owns the whole Case × repetition, including both paired arms.
// Result order stays frozen even when another worker finishes first. A failure
// drains every worker before the caller releases its campaign lock.
export async function runCaseWorkers(items, parallelism, run) {
  if (![1, 2].includes(parallelism)) throw new Error('Expected 1–2 case workers')
  let next = 0
  const workers = await Promise.allSettled(Array.from({ length: Math.min(parallelism, items.length) }, async () => {
    while (next < items.length) { const index = next++; await run(items[index], index) }
  }))
  const failure = workers.find(result => result.status === 'rejected')
  if (failure) throw failure.reason
}

export async function freezePlan(config, output) {
  if (config.schemaVersion !== 1 || !['gate', 'weekly'].includes(config.mode)) throw new Error('Expected Gate/weekly configuration schema 1')
  if (!Number.isInteger(config.repetitions) || config.repetitions < 1 || config.repetitions > 3) throw new Error('Freeze 1–3 repetitions before execution')
  if (!Number.isInteger(config.budget?.wallSeconds) || config.budget.wallSeconds < 60 || config.budget.wallSeconds > 86_400) throw new Error('An explicit 60–86400 second total budget is required')
  if (Object.keys(config.budget).some(key => key !== 'wallSeconds')) throw new Error('Only wallSeconds is supported at campaign level; per-case Run/A2A limits are sealed in Case budgets')
  const execution = evaluationExecution(config.execution)
  const suitePath = resolve(config.suite)
  const suite = await json(suitePath)
  if (suite.partition !== 'regression') throw new Error('Routine Gate/weekly runs use the regression partition; holdout is reserved for independent acceptance')
  if (config.mode === 'weekly') config = { ...config, change: { kind: 'context', document: join(resolve(suitePath, '..'), 'README.md'), revision: suite.version, before: 'current version', after: 'current version', invariants: 'Fixed weekly task set; no product change.', confirmation: { status: 'not_applicable', reason: 'weekly_regression' } } }
  const selected = selectCases(suite, config.change)
  if (typeof suite.scoring !== 'string') throw new Error('Suite requires a versioned scoring configuration')
  const scoringPath = resolve(suitePath, '..', suite.scoring)
  const scoring = validateScoring(await json(scoringPath), selected.cases)
  const products = {}
  for (const label of config.mode === 'gate' ? ['baseline', 'candidate'] : ['candidate']) {
    const product = await json(resolve(config[label]))
    await validateProduct(product)
    products[label] = product
  }
  const team = validateRegressionConfiguration({ schemaVersion: 1, team: config.team }).team
  const cases = []
  for (const item of selected.cases) {
    const knownRules = ['minAcceptedA2a', 'maxAcceptedA2a', 'minDistinctA2aRecipients', 'minMemoryReads', 'minHistoryReads', 'minFailedTools', 'maxMemoryMutations']
    if (!item.rules || Object.entries(item.rules).some(([name, value]) => !knownRules.includes(name) || !Number.isInteger(value) || value < 0 || value > 100 || name === 'maxMemoryMutations' && value !== 0)) throw new Error(`Invalid or unsupported rules in ${item.id}`)
    if (!Array.isArray(item.criticalSemantic) || !item.criticalSemantic.length || item.criticalSemantic.some(id => !Object.hasOwn({ ...PROCESS_JUDGE_RUBRIC, ...OUTCOME_JUDGE_RUBRIC }, id))) throw new Error(`Invalid critical semantic checklist in ${item.id}`)
    const directory = resolve(suitePath, '..', item.directory)
    const sealed = await verifyStoredCaseSeal(directory)
    if (sealed.contract.manifest.id !== item.id || sealed.contract.manifest.version !== item.version) throw new Error('Case manifest identity differs from the suite')
    const required = Math.max(item.rules.minAcceptedA2a ?? 0, 0)
    if (team.length < Math.max(required > 0 ? 2 : 1, (item.rules.minDistinctA2aRecipients ?? 0) + 1)) throw new Error(`${item.id} requires a team`)
    cases.push({ ...item, title: sealed.contract.manifest.title, directory, seal: sealed.seal, definitionDigest: digestJson(item), budget: sealed.contract.manifest.budget })
  }
  if (!config.change.document || !config.change.revision || !config.change.before || !config.change.after || !config.change.invariants || !config.change.confirmation) throw new Error('A reviewable change document, revision, before/after, invariants and confirmation record are required')
  if (config.mode === 'gate') {
    const confirmation = config.change.confirmation
    if (!['confirmed', 'delegated_by_user'].includes(confirmation.status) || confirmation.revision !== config.change.revision || typeof confirmation.by !== 'string' || !confirmation.by || !Number.isFinite(Date.parse(confirmation.at)) || Date.parse(confirmation.at) > Date.now() || typeof confirmation.evidence !== 'string' || !confirmation.evidence) throw new Error('Confirmation must bind the exact revision and cite the developer instruction; the CLI cannot confirm on their behalf')
  }
  const document = await readFile(resolve(config.change.document), 'utf8')
  const judge = config.judge ? { ...config.judge, adapter: resolve(config.judge.adapter), configuration: resolve(config.judge.configuration), adapterDigest: await digestFile(resolve(config.judge.adapter)), configurationDigest: await digestFile(resolve(config.judge.configuration)) } : null
  if (judge) {
    const adapter = await import(pathToFileURL(judge.adapter).href)
    const configuration = await json(judge.configuration)
    if (adapter.assurance === 'tool_disabled_cli') { adapter.createAdapter(configuration); judge.modelVersionPolicy = configuration.cli.modelVersionPolicy }
    if (!['tool_disabled_external_sandbox', 'tool_disabled_cli'].includes(adapter.assurance ?? adapter.default?.assurance)) throw new Error('Gate forbids fixture Judges; configure a real tool-disabled adapter or retain Judge as unavailable')
  }
  const plan = { schemaVersion: 1, createdAt: new Date().toISOString(), mode: config.mode, change: { ...config.change, document: resolve(config.change.document), documentDigest: digestJson(document) },
    scoring, scoringPath, scoringDigest: digestJson(scoring), tier: selected.tier, suite: { id: suite.id, version: suite.version, partition: suite.partition, digest: digestJson(suite), path: suitePath }, cases, products, team, repetitions: config.repetitions, budget: config.budget, execution, judge, policy: POLICY,
    rubricDigest: digestJson({ process: scoring.version === '2.2.0' ? RECEIPT_PROCESS_RUBRIC : scoring.version === '2.1.0' ? EVIDENCE_PROCESS_RUBRIC : PROCESS_JUDGE_RUBRIC, outcome: scoring.version === '2.2.0' ? RECEIPT_OUTCOME_RUBRIC : scoring.version === '2.1.0' ? EVIDENCE_OUTCOME_RUBRIC : TASK_OUTCOME_RUBRIC, scoring }), evaluatorDigest: await evaluatorDigest(),
    environment: { platform: process.platform, architecture: process.arch, node: process.version },
    holdout: { status: 'not_run', reason: 'Independent acceptance cases are separate from the regression suite.' } }
  const sealed = { ...plan, planDigest: digestJson(plan) }
  await writePrivateJsonExclusive(resolve(output), sealed)
  return sealed
}

async function validateProduct(product) {
  if (product.schemaVersion !== 1 || !isAbsolute(product.repository) || !isAbsolute(product.core) || !isAbsolute(product.cli)) throw new Error('Use eval-gate build to bind source and binaries')
  if (await digestFile(product.core) !== product.coreDigest || await digestFile(product.cli) !== product.cliDigest) throw new Error('A product binary changed after its build')
  if (digestJson(await sourceFingerprint(product.repository)) !== digestJson(product.source)) throw new Error('Product source changed after its build')
}
async function evaluatorDigest() {
  return digestJson({ qualification: await computeQualificationEvaluatorDigest(), files: await Promise.all(['scripts/lib/context-evaluation.mjs', 'scripts/lib/context-quality.mjs', 'packages/evaluation/src/report-html.ts', 'scripts/lib/context-judge-profile.mjs', 'scripts/lib/context-regression-fixture.mjs', 'scripts/benchmark/execution/contract-test-evidence.mjs', 'scripts/benchmark/execution/current-contract-runner.mjs', 'scripts/benchmark/profiles/current-contract-conformance.mjs'].map(async path => [path, await digestFile(join(root, path))])) })
}
export function validatePlanSeal(plan) {
  const { planDigest, ...payload } = plan
  if (planDigest !== digestJson(payload) || digestJson(plan.policy) !== digestJson(POLICY)) throw new Error('Plan or policy was modified after freezing')
}

export function evaluateCaseRules(spec, { collaboration, tools, memoryBefore, memoryAfter }) {
  const results = []
  const add = (id, value, limit, direction, complete, evidence) => {
    const known = Number.isInteger(value) && value >= 0
    const observedViolation = known && (direction === 'max' ? value > limit : value < limit && complete)
    const observedPass = known && (direction === 'min' ? value >= limit : value <= limit && complete)
    results.push({ id, status: observedViolation ? 'failed' : observedPass ? 'passed' : 'indeterminate', value: known ? value : null, limit, evidence })
  }
  const metrics = collaboration?.payload?.metrics
  const records = tools?.payload?.records ?? []
  const complete = tools?.payload?.summary?.coverage?.state === 'complete'
  // The ledger already groups a logical call with its replay observations.
  const succeeded = [...new Map(records.filter(record => record.lifecycle.state === 'succeeded').map(record => [record.toolCallId, record])).values()]
  for (const [id, direction] of [['minAcceptedA2a', 'min'], ['maxAcceptedA2a', 'max']]) if (spec[id] !== undefined) add(id, metrics?.acceptedCalls, spec[id], direction, metrics?.coverage?.state === 'complete', 'collaboration-ledger.json#/payload/metrics')
  if (spec.minDistinctA2aRecipients !== undefined) add('minDistinctA2aRecipients', collaboration?.payload?.calls ? new Set(collaboration.payload.calls.map(call => call.recipientMemberId).filter(Boolean)).size : null, spec.minDistinctA2aRecipients, 'min', metrics?.coverage?.state === 'complete', 'collaboration-ledger.json#/payload/calls')
  if (spec.minMemoryReads !== undefined) add('minMemoryReads', succeeded.filter(record => record.canonicalTool === 'memory.read').length, spec.minMemoryReads, 'min', complete, 'tool-call-ledger.json#/payload/records')
  if (spec.minHistoryReads !== undefined) add('minHistoryReads', succeeded.filter(record => ['camp.read', 'camp.search', 'history.search'].includes(record.canonicalTool)).length, spec.minHistoryReads, 'min', complete, 'tool-call-ledger.json#/payload/records')
  if (spec.minFailedTools !== undefined) add('minFailedTools', records.filter(record => record.lifecycle.state === 'failed').length, spec.minFailedTools, 'min', complete, 'tool-call-ledger.json#/payload/records')
  if (spec.maxMemoryMutations === 0) results.push({ id: 'memoryStateUnchanged', status: !memoryBefore || !memoryAfter ? 'indeterminate' : digestJson(memoryBefore) === digestJson(memoryAfter) ? 'passed' : 'failed', evidence: ['context-memory-before.json', 'context-memory-after.json'] })
  if (results.some(item => !terminal(item.status))) throw new Error('Invalid rule result')
  return results
}

export function compareResults(plan, slots, contracts) {
  const problems = [], regressions = [], changes = [], resourceChanges = []
  for (const label of plan.mode === 'gate' ? ['baseline', 'candidate'] : ['candidate']) {
    const contract = contracts[label] ?? { status: 'indeterminate' }
    if (label === 'candidate' && contract.status === 'failed') regressions.push({ code: 'candidate_contract_failure', newRegression: contracts.baseline?.status === 'passed' })
    if (contract.status !== 'passed') problems.push({ code: 'contract_checks_not_passed', label, status: contract.status })
  }
  for (const item of plan.cases) for (let repeat = 1; repeat <= plan.repetitions; repeat++) {
    const candidate = slots.find(slot => slot.caseId === item.id && slot.repeat === repeat && slot.arm === 'candidate')
    const baseline = slots.find(slot => slot.caseId === item.id && slot.repeat === repeat && slot.arm === 'baseline')
    const comparableEnvironment = Boolean(candidate?.environmentKey && candidate.environmentKey === baseline?.environmentKey)
    if (candidate?.hardOutcome === 'fail' || candidate?.rules?.some(rule => rule.status === 'failed')) regressions.push({ caseId: item.id, repeat, code: 'candidate_hard_failure', newRegression: plan.mode === 'gate' && comparableEnvironment && baseline?.hardOutcome === 'pass' && baseline.rules.every(rule => rule.status === 'passed') })
    if (!candidate || candidate.state !== 'complete' || plan.mode === 'gate' && (!baseline || baseline.state !== 'complete')) { problems.push({ caseId: item.id, repeat, code: 'missing_trial_evidence' }); continue }
    if (candidate.hardOutcome === 'unavailable' || candidate.rules.some(rule => rule.status === 'indeterminate') || plan.mode === 'gate' && (baseline.hardOutcome !== 'pass' || baseline.rules.some(rule => rule.status !== 'passed'))) problems.push({ caseId: item.id, repeat, code: 'hard_evidence_incomplete_or_baseline_failed' })
    if (!candidate.environmentKey || plan.mode === 'gate' && (!baseline.environmentKey || candidate.environmentKey !== baseline.environmentKey)) problems.push({ caseId: item.id, repeat, code: 'runtime_environment_drift_or_unknown' })
    const elapsed = slot => slot?.resources?.dispatchToTerminal?.coverage?.state === 'complete' && Number.isFinite(slot.resources.dispatchToTerminal.valueMilliseconds) ? slot.resources.dispatchToTerminal.valueMilliseconds : null
    const afterMs = elapsed(candidate), beforeMs = elapsed(baseline)
    if (afterMs === null || plan.mode === 'gate' && beforeMs === null) problems.push({ caseId: item.id, repeat, code: 'elapsed_time_evidence_unavailable' })
    if (beforeMs !== null && afterMs !== null) {
      const deltaMilliseconds = afterMs - beforeMs
      const limit = POLICY.latencyRegression
      const regressed = comparableEnvironment && deltaMilliseconds > limit.minimumIncreaseMilliseconds && deltaMilliseconds > beforeMs * limit.relativeIncrease
      resourceChanges.push({ caseId: item.id, repeat, beforeMilliseconds: beforeMs, afterMilliseconds: afterMs, deltaMilliseconds, regressed, limits: limit, providerUsage: 'unavailable' })
      if (regressed) regressions.push({ caseId: item.id, repeat, code: 'elapsed_time_regression', beforeMilliseconds: beforeMs, afterMilliseconds: afterMs })
    }
    for (const checklistItem of item.criticalSemantic) {
      const normalized = slot => { const item = semanticVerdict(slot, checklistItem); return { ...item, state: item.verdict === 'indeterminate' ? 'unavailable' : 'agreed' } }
      const after = plan.scoring ? normalized(candidate) : semanticItem(candidate, checklistItem), before = baseline ? plan.scoring ? normalized(baseline) : semanticItem(baseline, checklistItem) : null
      if (!after || after.verdict === 'indeterminate' || after.state !== 'agreed') problems.push({ caseId: item.id, repeat, code: 'semantic_evidence_insufficient', checklistItem })
      else if (after.verdict !== 'satisfied') regressions.push({ caseId: item.id, repeat, code: 'semantic_acceptance_failed', checklistItem, newRegression: comparableEnvironment && baseline?.hardOutcome === 'pass' && baseline.rules.every(rule => rule.status === 'passed') && before?.state === 'agreed' && before.verdict === 'satisfied' })
      if (plan.mode === 'gate' && (!before || before.state !== 'agreed' || before.verdict === 'indeterminate')) problems.push({ caseId: item.id, repeat, code: 'baseline_semantic_evidence_insufficient', checklistItem })
    }
    for (const after of plan.scoring ? [] : candidate.semanticItems ?? []) {
      const before = baseline ? semanticItem(baseline, after.checklistItem) : null
      if (before && digestJson({ state: before.state, verdict: before.verdict }) !== digestJson({ state: after.state, verdict: after.verdict })) changes.push({ caseId: item.id, repeat, checklistItem: after.checklistItem, before: before.verdict, after: after.verdict })
      const rank = { satisfied: 2, partially_satisfied: 1, not_satisfied: 0 }
      if (comparableEnvironment && before?.state === 'agreed' && after.state === 'agreed' && rank[after.verdict] < rank[before.verdict]) regressions.push({ caseId: item.id, repeat, code: 'semantic_regression', checklistItem: after.checklistItem, before: before.verdict, after: after.verdict })
    }
  }
  if (plan.mode === 'gate' && plan.judge?.modelVersionPolicy === 'catalog_bound_alias') problems.push({ code: 'judge_provider_snapshot_not_pinned' })
  const assessment = plan.scoring ? evaluateQualityAndCollaboration(plan, slots) : null
  if (assessment) {
    problems.push(...assessment.qualityGaps)
    for (const item of assessment.criticalFailures) {
      if (item.verdict === 'indeterminate') problems.push({ ...item, code: 'critical_collaboration_evidence_insufficient' })
      else if (item.arm === 'candidate' && !regressions.some(row => row.caseId === item.caseId && row.repeat === item.repeat && row.checklistItem === item.checklistItem)) regressions.push({ ...item, code: 'critical_collaboration_acceptance_failed', newRegression: false })
    }
    for (const change of assessment.changes) {
      if (change.kind === 'regression') {
        const before = slots.find(slot => slot.arm === 'baseline' && slot.caseId === change.caseId && slot.repeat === change.repeat)
        regressions.push({ ...change, code: 'quality_or_process_regression', newRegression: before?.state === 'complete' && before.hardOutcome === 'pass' && before.rules.every(rule => rule.status === 'passed') })
      }
      if (change.kind !== 'unchanged') changes.push(change)
    }
  }
  const trialCount = items => new Set(items.filter(item => item.caseId).map(item => `${item.caseId}/${item.repeat}`)).size
  const detected = regressions.filter(item => item.newRegression === true || ['elapsed_time_regression', 'semantic_regression'].includes(item.code))
  const conclusions = {
    acceptance: regressions.length ? 'failed' : problems.length ? 'incomplete' : 'passed',
    regression: plan.mode !== 'gate' ? 'not_compared' : detected.length ? 'detected' : problems.length ? 'inconclusive' : 'not_detected',
    evaluation: problems.length ? 'incomplete' : 'complete',
    failedTrials: trialCount(regressions), evidenceGapTrials: trialCount(problems), newRegressionTrials: trialCount(detected),
    failureRecords: regressions.length, evidenceGapRecords: problems.length
  }
  return { status: regressions.length ? 'degraded' : problems.length ? 'insufficient' : 'passed', conclusions, regressions, evidenceGaps: problems, semanticChanges: changes, resourceChanges, ...(assessment ? { assessment } : {}) }
}
function semanticItem(slot, id) { return slot.semanticItems?.find(item => item.checklistItem === id) }

export async function validatePlanInputs(plan, { products = true } = {}) {
  validatePlanSeal(plan)
  evaluationExecution(plan.execution)
  if (!plan.scoring || digestJson(plan.scoring) !== plan.scoringDigest || digestJson(await json(plan.scoringPath)) !== plan.scoringDigest) throw new Error('Scoring changed or is missing; freeze a new plan')
  validateScoring(plan.scoring, plan.cases)
  if (plan.evaluatorDigest !== await evaluatorDigest()) throw new Error('Evaluator changed after the plan was frozen')
  if (digestJson(await readFile(plan.change.document, 'utf8')) !== plan.change.documentDigest || digestJson(await json(plan.suite.path)) !== plan.suite.digest) throw new Error('Change document or suite changed after confirmation/freezing')
  if (plan.judge && (await digestFile(plan.judge.adapter) !== plan.judge.adapterDigest || await digestFile(plan.judge.configuration) !== plan.judge.configurationDigest)) throw new Error('Judge configuration changed after freezing')
  if (products) for (const product of Object.values(plan.products)) await validateProduct(product)
  for (const item of plan.cases) await verifyStoredCaseSeal(item.directory, item.seal)
}

export async function runPlan(planPath, outputRoot) {
  const plan = await json(resolve(planPath)); await validatePlanInputs(plan)
  const output = resolve(outputRoot); await mkdir(output, { recursive: true, mode: 0o700 })
  const lock = await open(join(output, '.gate.lock'), 'wx', 0o600)
  try {
    const attempts = (await readdir(output)).filter(name => /^attempt-\d+$/.test(name)).sort()
    if (attempts.length >= POLICY.maximumAttempts) throw new Error('The retained campaign has exhausted its two attempts; do not discard failures or change standards to pass')
    const campaignPath = join(output, 'campaign.json')
    const campaign = { scoringDigest: plan.scoringDigest, evaluatorDigest: plan.evaluatorDigest, rubricDigest: plan.rubricDigest, changeDocumentDigest: plan.change.documentDigest, tier: plan.tier, changeDocument: plan.change.document, revision: plan.change.revision, suiteDigest: plan.suite.digest, policy: plan.policy, repetitions: plan.repetitions, team: plan.team, budget: plan.budget, execution: evaluationExecution(plan.execution), judge: plan.judge, baseline: plan.products.baseline?.coreDigest ?? null }
    if (attempts.length && digestJson(await json(campaignPath)) !== digestJson(campaign)) throw new Error('Campaign scope, baseline, rubric or budget changed; update and reconfirm the plan instead of silently retrying')
    if (!attempts.length) await writePrivateJsonExclusive(campaignPath, campaign)
    const directory = join(output, `attempt-${String(attempts.length + 1).padStart(2, '0')}`)
    await mkdir(directory, { mode: 0o700 }); await writePrivateJsonExclusive(join(directory, 'plan.json'), plan)
    const deadline = Date.now() + plan.budget.wallSeconds * 1000
    const slots = [], contracts = {}
    for (const [arm, product] of Object.entries(plan.products)) {
      try {
        if (Date.now() >= deadline) throw new Error('Total budget exhausted')
        const result = await runCurrentContractConformance({ repositoryRoot: product.repository, coreExecutable: product.core, outputDirectory: join(directory, `contracts-${arm}`), runId: `contract-${arm}-${Date.now()}`, timeoutMs: Math.min(20 * 60_000, deadline - Date.now()) })
        contracts[arm] = { status: result.benchmarkRun.outcome.hardOutcome === 'pass' ? 'passed' : result.benchmarkRun.outcome.hardOutcome === 'fail' ? 'failed' : 'indeterminate', locator: `contracts-${arm}/benchmark-run.json` }
      } catch (error) { contracts[arm] = { status: 'indeterminate', reason: error.message } }
    }
    const executionConfiguration = evaluationExecution(plan.execution)
    const groups = plan.cases.flatMap(item => Array.from({ length: plan.repetitions }, (_, index) => ({ item, repeat: index + 1, slots: [] })))
    await runCaseWorkers(groups, executionConfiguration.maxParallelCases, async group => {
      const { item, repeat } = group
      const arms = plan.mode === 'weekly' ? ['candidate'] : (repeat + plan.cases.indexOf(item)) % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline']
      for (const arm of arms) {
        const slot = { caseId: item.id, caseTitle: item.title ?? item.id, repeat, arm, state: 'not_run', reason: null }
        group.slots.push(slot)
        const id = `${item.id}-${repeat}-${arm}`, trialDirectory = join(directory, 'trials', id)
        if (contracts[arm]?.status !== 'passed') { slot.reason = 'Contract checks did not pass'; continue }
        const remaining = deadline - Date.now()
        const reserved = (item.budget.elapsedSeconds + 240 + (plan.judge ? executionConfiguration.judgeSeconds : 0)) * 1000
        if (remaining < reserved) { slot.reason = 'Insufficient remaining campaign budget for a full trial and cleanup'; continue }
        try {
          const regressionConfig = join(directory, `${id}.json`)
          await writePrivateJsonExclusive(regressionConfig, { schemaVersion: 1, temporaryRoot: join(directory, `runtime-${id}`), team: plan.team, fixture: item.fixture, product: plan.products[arm] })
          const execution = await runCaptured(process.execPath, [join(root, 'scripts/qualification-runner.mjs'), '--mode', item.visibility, '--core', plan.products[arm].core, '--case', item.directory, '--expected-seal', item.seal, '--evidence-root', join(directory, 'trials'), '--trial-id', id, '--planned-slot-id', id, '--suite-id', `${plan.suite.id}:${plan.suite.version}`, '--regression-config', regressionConfig], { cwd: root, timeoutMs: Math.min(remaining, reserved), maxOutputBytes: 16 * 1024 * 1024 })
          await writePrivateJsonExclusive(join(directory, `${id}-execution.json`), execution)
          if (execution.timedOut || execution.outputOverflow) throw new Error('Trial process did not produce complete retained evidence')
          const history = await loadQualificationResultHistory(trialDirectory)
          const result = history.current
          slot.state = result.validity === 'valid' && result.evaluationState === 'complete' ? 'complete' : 'insufficient'
          slot.hardOutcome = result.hardOutcome ?? result.overall
          slot.locator = `trials/${id}`
          const read = async name => { try { return await json(join(trialDirectory, name)) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
          slot.rules = evaluateCaseRules(item.rules, { collaboration: await read('collaboration-ledger.json'), tools: await read('tool-call-ledger.json'), memoryBefore: await read('context-memory-before.json'), memoryAfter: await read('context-memory-after.json') })
          const environment = await read('environment-manifest.json')
          slot.environmentKey = environment ? digestJson({ host: environment.host, runtimeInstallations: environment.runtimeInstallations, team: environment.team.map(({ readiness, ...member }) => member), execution: executionConfiguration, ambientMcpIsolation: environment.ambientMcpIsolation }) : null
          slot.checks = result.deliveryLayer?.checkResults ?? []
          const ledger = await read('collaboration-ledger.json')
          slot.collaborationObservation = { accepted: ledger?.payload?.metrics?.acceptedCalls ?? null, complete: ledger?.payload?.metrics?.coverage?.state === 'complete' }
          slot.resources = result.resourceObservation ?? null
          slot.budget = result.budget ?? null
          if (result.budget?.event || result.budget?.watchdogEvent) slot.rules.push({ id: 'executionBudget', status: 'failed', evidence: 'result.json#/budget', reason: result.budget.event?.reason ?? result.budget.watchdogEvent?.reason ?? 'budget_exhausted' })
          const expectedExitCode = slot.hardOutcome === 'pass' ? 0 : slot.hardOutcome === 'fail' ? 1 : 2
          if (execution.code !== expectedExitCode || execution.signal) throw new Error('Runner exit does not match its retained result; publication or cleanup may be incomplete')
          if (plan.judge && slot.state === 'complete') {
            const caseEvaluation = join(directory, `${id}-evaluation.json`)
            await writePrivateJsonExclusive(caseEvaluation, plan.scoring.cases[item.id])
            slot.failureDomain = 'evaluator'
            const judged = await runCaptured(process.execPath, [join(root, 'scripts/qualification-semantic-review.mjs'), '--evidence-dir', trialDirectory, '--case', item.directory, '--configuration', plan.judge.configuration, '--adapter', plan.judge.adapter, '--case-evaluation', caseEvaluation], { cwd: root, timeoutMs: Math.min(executionConfiguration.judgeSeconds * 1000, deadline - Date.now()), maxOutputBytes: 4 * 1024 * 1024 })
            await writePrivateJsonExclusive(join(directory, `${id}-judge-execution.json`), judged)
            if (judged.code !== 0 || judged.timedOut || judged.outputOverflow || judged.signal) throw new Error('Judge process did not finish with complete retained evidence')
            const views = await read('semantic-judge-view-suite.json')
            slot.semanticItems = views?.payload?.views?.flatMap(view => view.items) ?? []
            slot.judgeStatus = views?.payload?.state ?? 'unavailable'
            slot.failureDomain = slot.judgeStatus === 'unavailable' ? 'evaluator' : null
          } else { slot.semanticItems = []; slot.judgeStatus = 'not_run' }
        } catch (error) { if (slot.failureDomain !== 'evaluator') slot.state = 'insufficient'; slot.failureDomain ??= 'runner_or_environment'; slot.judgeStatus ??= 'unavailable'; slot.reason = error.message }
        await writePrivateJsonExclusive(join(directory, `${id}-slot.json`), slot)
      }
    })
    slots.push(...groups.flatMap(group => group.slots))
    const report = { schemaVersion: 2, kind: plan.mode === 'weekly' ? 'weekly_regression' : 'context_change_gate', planDigest: plan.planDigest, change: plan.change, products: plan.products, suite: plan.suite, configuration: { scoringDigest: plan.scoringDigest, scoringVersion: plan.scoring.version, evaluatorDigest: plan.evaluatorDigest, rubricDigest: plan.rubricDigest, policy: plan.policy, team: plan.team, repetitions: plan.repetitions, budget: plan.budget, execution: executionConfiguration, judge: plan.judge }, completedAt: new Date().toISOString(), ...compareResults(plan, slots, contracts), contracts, slots, holdout: plan.holdout, earlierAttempts: attempts, limits: ['Diagnostic isolation uses fresh data/Skill/workspace/MCP paths on a shared host; not dedicated-host Formal qualification.', 'Small repeated samples cannot establish statistical non-inferiority.', 'No automatic user task replay or repair. All attempts must remain retained.', ...(plan.judge?.modelVersionPolicy === 'catalog_bound_alias' ? ['Judge uses a frozen CLI/catalog/model alias; immutable provider snapshot and weights are not observable. Diagnostic semantic results do not establish pinned-snapshot Gate acceptance.'] : [])] }
    await writePrivateJsonExclusive(join(directory, 'report.json'), report)
    await writeFile(join(directory, 'README.md'), renderGateReport(report), { mode: 0o600, flag: 'wx' })
    await writeFile(join(directory, 'report.html'), await sanitizeReportLinks(directory, renderGateHtml(report)), { mode: 0o600, flag: 'wx' })
    const entries = []
    for (const attempt of [...attempts, directory.split(/[\\/]/).at(-1)]) {
      let status = 'insufficient'
      try { status = (await json(join(output, attempt, 'report.json'))).status } catch (error) { if (error.code !== 'ENOENT') throw error }
      entries.push({ path: `${attempt}/report.html`, label: attempt, status })
    }
    const { rename } = await import('node:fs/promises')
    const indexTemporary = join(output, `.index-${Date.now()}.html`)
    await writeFile(indexTemporary, await sanitizeReportLinks(output, renderReportIndex('上下文评测尝试', entries)), { mode: 0o600, flag: 'wx' })
    await rename(indexTemporary, join(output, 'index.html'))
    return { directory, report }
  } finally { await lock.close(); await unlink(join(output, '.gate.lock')) }
}

export function renderGateReport(report) {
  const assessment = report.assessment
  const quality = assessment ? `\n通用质量：基线 ${assessment.arms.baseline?.quality.total ?? '评价未完成'} → 候选 ${assessment.arms.candidate.quality.total ?? '评价未完成'}；评分版本 ${assessment.scoring.version}。协作只保留分项状态，不计综合分。\n\n| 协作组 | 满足/适用计划 | 未知/适用计划 | 独立适用 Case |\n|---|---|---|---|\n${Object.entries(assessment.arms.candidate.collaboration.groups).map(([id, d]) => `| ${id} | ${d.counts.satisfied}/${d.applicableTrials} | ${d.counts.indeterminate}/${d.applicableTrials} | ${d.applicableCases} |`).join('\n')}\n` : '\n此历史报告未使用当前评分标准，不换算新分数。\n'
  const rows = report.slots.map(slot => `| ${slot.caseId} | ${slot.repeat} | ${slot.arm} | ${slot.state} | ${slot.hardOutcome ?? 'unknown'} | ${slot.rules?.length ? slot.rules.filter(rule => rule.status !== 'passed').map(rule => `${rule.id}: ${rule.status}`).join(', ') || 'passed' : 'unknown'} | ${slot.judgeStatus ?? 'not_run'} |`).join('\n')
  return `# ${report.kind === 'weekly_regression' ? '每周真实任务回归' : '上下文改动 Gate'}\n\n结论：**${report.status}**。仅对应计划 ${report.planDigest} 与报告中的实际版本。\n\n[交互报告](report.html) · [完整报告](report.json) · [冻结计划](plan.json)${quality}\n\n| Case | 重复 | 版本 | 执行证据 | HardOutcome | 专项规则 | 语义评价 |\n|---|---|---|---|---|---|---|\n${rows}\n\n验收：${report.conclusions?.acceptance ?? report.status}；新旧比较：${report.conclusions?.regression ?? "unknown"}；评价完整性：${report.conclusions?.evaluation ?? "unknown"}。失败涉及 ${report.conclusions?.failedTrials ?? "unknown"} 次 Trial，证据缺口涉及 ${report.conclusions?.evidenceGapTrials ?? "unknown"} 次 Trial；同一 Trial 可同时存在失败与未知。硬性错误不可由语义得分抵消。Judge 的缺失、分歧或不足不算通过。历史失败保留，不使用 pass@k。\n\n独立验收保留集：${report.holdout.status}。本报告不声称用户任务成功率或实际能力提升。\n`
}
