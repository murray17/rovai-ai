import { validateMetricContract } from './context-metric-contract.mjs'
import { digestJson } from './qualification-common.mjs'
import { TASK_OUTCOME_IDS, TASK_PROCESS_IDS, taskJudgeProfile } from './context-judge-profile.mjs'

export const QUALITY_DIMENSIONS = Object.freeze({ goal: '目标达成', evidence: '证据一致性', boundary: '边界遵守' })
export const COLLABORATION_GROUPS = Object.freeze({
  coordination: { label: '协调必要性', items: [TASK_PROCESS_IDS[0]] },
  handoff: { label: '信息交接充分性', items: [TASK_PROCESS_IDS[1]] },
  integration: { label: '贡献整合有效性', items: TASK_PROCESS_IDS.slice(2) }
})
const values = { satisfied: 1, partially_satisfied: 0.5, not_satisfied: 0 }
const states = [...Object.keys(values), 'indeterminate', 'not_applicable']
const ratio = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null })
const unknown = (reason, raw = null) => ({ verdict: 'indeterminate', reasonCode: reason, raw })

export function validateScoring(scoring, cases) {
  if (scoring?.schemaVersion !== 1 || !['2.0.0', '2.1.0', '2.2.0', '2.3.0', '2.4.0', '2.5.0', '2.6.0', '2.7.0', '2.8.0', '2.9.0', '2.10.0'].includes(scoring.version) || scoring.id !== 'generic-task-quality'
      || scoring.aggregation !== 'repetitions_then_fixed_case_weights' || scoring.collaborationAggregation !== 'failure_unknown_partial_satisfied_v1'
      || scoring.gate?.minimumQuality !== null || scoring.gate?.maximumItemDowngrade !== 0
      || Object.keys(scoring.dimensions ?? {}).sort().join(',') !== 'boundary,evidence,goal'
      || Object.values(scoring.dimensions).some(n => !Number.isFinite(n) || n <= 0)
      || Object.values(scoring.dimensions).reduce((a, b) => a + b, 0) !== 100) throw new Error('Invalid versioned quality scoring policy')
  for (const spec of cases) {
    const config = scoring.cases?.[spec.id]
    if (['2.1.0', '2.2.0', '2.3.0', '2.4.0', '2.5.0', '2.6.0', '2.7.0', '2.8.0', '2.9.0', '2.10.0'].includes(scoring.version) && (config?.judgeProfile !== (scoring.version === '2.10.0' ? 'generic-task-v12' : scoring.version === '2.9.0' ? 'generic-task-v11' : scoring.version === '2.8.0' ? 'generic-task-v10' : scoring.version === '2.7.0' ? 'generic-task-v9' : scoring.version === '2.6.0' ? 'generic-task-v8' : scoring.version === '2.5.0' ? 'generic-task-v7' : scoring.version === '2.4.0' ? 'generic-task-v6' : scoring.version === '2.3.0' ? 'generic-task-v5' : scoring.version === '2.2.0' ? 'generic-task-v4' : 'generic-task-v3') || !Array.isArray(config.evidenceFiles)
        || config.evidenceFiles.length > 64 || new Set(config.evidenceFiles).size !== config.evidenceFiles.length
        || config.evidenceFiles.some(path => typeof path !== 'string' || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')))) throw new Error(`Invalid frozen task evidence scope: ${spec.id}`)
    if (!config || !Number.isFinite(config.weight) || config.weight <= 0 || !Array.isArray(config.quality)
        || new Set(config.quality.map(item => item.id)).size !== config.quality.length) throw new Error(`Missing or invalid frozen Case weight/checks: ${spec.id}`)
    for (const item of config.quality) {
      if (!/^[A-Za-z0-9._:-]+$/.test(item.id) || !Object.hasOwn(QUALITY_DIMENSIONS, item.dimension)
          || !Number.isFinite(item.weight) || item.weight <= 0 || typeof item.applicable !== 'boolean'
          || typeof item.criterion !== 'string' || !item.criterion.trim() || item.criterion.length > 4000
          || !['outcome', 'rule', 'check'].includes(item.source)
          || item.source === 'outcome' && !TASK_OUTCOME_IDS.includes(item.checklistItem)
          || item.source !== 'outcome' && (typeof item.ruleId !== 'string' || !item.ruleId)) throw new Error(`Invalid frozen quality item: ${spec.id}/${item.id}`)
    }
    const sources = config.quality.filter(item => item.applicable).map(item => `${item.source}:${item.checklistItem ?? item.ruleId}`)
    if (new Set(sources).size !== sources.length) throw new Error('One check cannot be scored twice')
    for (const dimension of Object.keys(QUALITY_DIMENSIONS)) if (!config.quality.some(item => item.dimension === dimension && item.applicable)) throw new Error('Every quality dimension needs predeclared applicable checks; never redistribute a dimension')
    if (['2.3.0', '2.4.0', '2.5.0', '2.6.0', '2.7.0', '2.8.0', '2.9.0', '2.10.0'].includes(scoring.version)) for (const item of [...config.quality, ...config.collaboration]) validateMetricContract(item)
    taskJudgeProfile(config, 'outcome'); taskJudgeProfile(config, 'process')
    for (const id of spec.criticalSemantic) {
      const found = [...config.quality, ...config.collaboration].find(item => item.checklistItem === id)
      if (!found?.applicable) throw new Error(`Critical check must be applicable: ${spec.id}/${id}`)
    }
    if ((spec.rules.minAcceptedA2a ?? 0) > 0 && !config.collaboration.some(item => item.applicable)) throw new Error('Required collaboration cannot be excluded')
  }
  return scoring
}

function slotIndex(plan, slots) {
  const map = new Map(), arms = plan.mode === 'gate' ? ['baseline', 'candidate'] : ['candidate']
  for (const slot of slots) {
    const key = `${slot.caseId}/${slot.repeat}/${slot.arm}`
    if (!plan.cases.some(item => item.id === slot.caseId) || !arms.includes(slot.arm)
        || !Number.isInteger(slot.repeat) || slot.repeat < 1 || slot.repeat > plan.repetitions || map.has(key)) throw new Error('Duplicate or unplanned Trial; attempts cannot be pooled')
    map.set(key, slot)
  }
  return (caseId, repeat, arm) => map.get(`${caseId}/${repeat}/${arm}`)
}

export function semanticVerdict(slot, checklistItem, applicable = true) {
  const matches = slot?.semanticItems?.filter(item => item.checklistItem === checklistItem) ?? []
  const raw = matches[0] ?? null
  if (!applicable) return { verdict: 'not_applicable', reasonCode: 'predeclared_not_applicable', raw }
  if (slot?.state === 'not_run' || !slot) return unknown('not_run', raw)
  if (checklistItem.startsWith('SER.collaboration.') && slot.collaborationObservation?.accepted === 0
      && slot.collaborationObservation?.complete === true) return { verdict: 'not_satisfied', reasonCode: 'required_collaboration_not_executed', source: 'rule', evidence: 'collaboration-ledger.json#/payload/metrics', raw }
  if (matches.length > 1) return unknown('duplicate_judge_item', raw)
  const view = checklistItem.startsWith('SER.collaboration.') ? 'process' : 'outcome'
  const evaluatorFailed = slot.failureDomain === 'evaluator' && (!slot.judgeFailures?.length || slot.judgeFailures.some(failure => !failure.view || failure.view === view))
  if (!raw) return unknown(slot.judgeStatus === 'not_run' ? 'judge_not_run' : evaluatorFailed ? 'judge_execution_failed' : slot.state !== 'complete' ? 'trial_evidence_incomplete' : 'judge_item_missing', raw)
  if (raw.verdict === 'indeterminate' && slot.judgeFailures?.some(failure => failure.checklistItems?.includes(checklistItem))) return unknown('judge_execution_failed', raw)
  if (raw.state === 'disagreed') return unknown('judge_disagreement', raw)
  if (!['agreed', 'adjudicated'].includes(raw.state) || raw.verdict === 'indeterminate') return unknown('judge_evidence_insufficient', raw)
  if (raw.verdict === 'not_applicable') return unknown('unexpected_not_applicable', raw)
  if (!Object.hasOwn(values, raw.verdict)) return unknown('invalid_judge_verdict', raw)
  return { verdict: raw.verdict, reasonCode: null, source: 'judge', raw }
}

function qualityItem(slot, item) {
  if (item.source === 'outcome') return { ...item, ...semanticVerdict(slot, item.checklistItem, item.applicable) }
  if (!item.applicable) return { ...item, verdict: 'not_applicable', reasonCode: 'predeclared_not_applicable' }
  const records = item.source === 'rule' ? slot?.rules : slot?.checks
  const raw = records?.find(check => (check.id ?? check.checkId) === item.ruleId) ?? null
  const verdict = { passed: 'satisfied', pass: 'satisfied', failed: 'not_satisfied', fail: 'not_satisfied' }[raw?.status] ?? 'indeterminate'
  return { ...item, verdict, reasonCode: verdict === 'indeterminate' ? !slot || slot.state === 'not_run' ? 'not_run' : 'rule_evidence_insufficient' : null, raw }
}

function dimensionScore(items) {
  const applicable = items.filter(item => item.applicable), known = applicable.filter(item => Object.hasOwn(values, item.verdict))
  const weight = applicable.reduce((n, item) => n + item.weight, 0), knownWeight = known.reduce((n, item) => n + item.weight, 0)
  const weightedValue = known.reduce((n, item) => n + item.weight * values[item.verdict], 0)
  return { score: weight && knownWeight === weight ? 100 * weightedValue / weight : null,
    coverage: ratio(knownWeight, weight), counts: { applicable: applicable.length, evaluated: known.length, unknown: applicable.length - known.length } }
}

function aggregateDimensions(entries, weights) {
  const denominator = entries.reduce((sum, entry) => sum + entry.weight, 0)
  const dimensions = Object.fromEntries(Object.keys(QUALITY_DIMENSIONS).map(id => {
    const complete = entries.every(entry => entry.dimensions[id].score !== null)
    const coverage = entries.reduce((n, entry) => n + entry.weight * (entry.dimensions[id].coverage.value ?? 0), 0)
    return [id, { score: complete && denominator ? entries.reduce((n, entry) => n + entry.weight * entry.dimensions[id].score, 0) / denominator : null, coverage: ratio(coverage, denominator) }]
  }))
  const total = Object.values(dimensions).every(item => item.score !== null) ? Object.entries(dimensions).reduce((sum, [id, item]) => sum + weights[id] * item.score / 100, 0) : null
  return { status: total === null ? 'incomplete' : 'complete', total, dimensions,
    coverage: ratio(Object.entries(dimensions).reduce((n, [id, item]) => n + weights[id] * (item.coverage.value ?? 0), 0), 100) }
}

export function collaborationGroupVerdict(items) {
  const applicable = items.filter(item => item.verdict !== 'not_applicable')
  if (!applicable.length) return 'not_applicable'
  return ['not_satisfied', 'indeterminate', 'partially_satisfied'].find(state => applicable.some(item => item.verdict === state)) ?? 'satisfied'
}

function distribution(rows) {
  const counts = Object.fromEntries(states.map(state => [state, rows.filter(row => row.verdict === state).length]))
  const applicable = rows.filter(row => row.verdict !== 'not_applicable')
  return { plannedTrials: rows.length, distinctCases: new Set(rows.map(row => row.caseId)).size,
    applicableTrials: applicable.length, applicableCases: new Set(applicable.map(row => row.caseId)).size,
    counts, rates: Object.fromEntries(states.filter(state => state !== 'not_applicable').map(state => [state, ratio(counts[state], applicable.length)])),
    unknownReasons: Object.fromEntries([...new Set(rows.flatMap(row => row.unknownReasons ?? (row.reasonCode && row.verdict === 'indeterminate' ? [row.reasonCode] : [])))].map(code => [code, rows.filter(row => row.unknownReasons?.includes(code) || row.reasonCode === code && row.verdict === 'indeterminate').length])),
    trialsWithEvidenceGaps: rows.filter(row => row.verdict === 'indeterminate' || row.unknownReasons?.length).length }
}

export function evaluateQualityAndCollaboration(plan, slots) {
  const scoring = validateScoring(plan.scoring, plan.cases), get = slotIndex(plan, slots)
  const arms = {}, qualityGaps = [], criticalFailures = [], changes = []
  for (const arm of plan.mode === 'gate' ? ['baseline', 'candidate'] : ['candidate']) {
    const trials = [], caseScores = []
    for (const spec of plan.cases) {
      const config = scoring.cases[spec.id], repetitions = []
      for (let repeat = 1; repeat <= plan.repetitions; repeat++) {
        const slot = get(spec.id, repeat, arm)
        const items = config.quality.map(item => qualityItem(slot, item))
        const dimensions = Object.fromEntries(Object.keys(QUALITY_DIMENSIONS).map(id => [id, dimensionScore(items.filter(item => item.dimension === id))]))
        const quality = { ...aggregateDimensions([{ dimensions, weight: 1 }], scoring.dimensions), items }
        repetitions.push({ repeat, dimensions, weight: 1 })
        const collaboration = config.collaboration.map(item => ({ ...item, ...semanticVerdict(slot, item.checklistItem, item.applicable) }))
        const groups = Object.fromEntries(Object.entries(COLLABORATION_GROUPS).map(([id, group]) => {
          const members = collaboration.filter(item => group.items.includes(item.checklistItem))
          return [id, { verdict: collaborationGroupVerdict(members), items: members.map(item => item.checklistItem), unknownReasons: [...new Set(members.filter(item => item.verdict === 'indeterminate').map(item => item.reasonCode))] }]
        }))
        const critical = collaboration.filter(item => spec.criticalSemantic.includes(item.checklistItem) && item.verdict !== 'satisfied')
        trials.push({ caseId: spec.id, repeat, executionState: slot?.state ?? 'not_run', environmentKey: slot?.environmentKey ?? null, locator: slot?.locator ?? null, quality, collaboration, groups, critical })
        if (quality.total === null) qualityGaps.push({ caseId: spec.id, repeat, arm, code: 'quality_evaluation_incomplete', items: items.filter(item => item.applicable && item.verdict === 'indeterminate').map(item => item.id), evaluatorItems: items.filter(item => item.applicable && item.reasonCode === 'judge_execution_failed').map(item => item.id) })
        for (const item of critical) criticalFailures.push({ caseId: spec.id, repeat, arm, checklistItem: item.checklistItem, verdict: item.verdict, reasonCode: item.reasonCode })
      }
      caseScores.push({ caseId: spec.id, weight: config.weight, ...aggregateDimensions(repetitions, scoring.dimensions), repetitions: repetitions.map(({ repeat, dimensions }) => ({ repeat, dimensions })) })
    }
    const withIdentity = (trial, item) => ({ caseId: trial.caseId, repeat: trial.repeat, ...item })
    const collaboration = {
      items: Object.fromEntries(TASK_PROCESS_IDS.map(id => [id, distribution(trials.map(trial => withIdentity(trial, trial.collaboration.find(item => item.checklistItem === id))))])),
      groups: Object.fromEntries(Object.keys(COLLABORATION_GROUPS).map(id => [id, distribution(trials.map(trial => withIdentity(trial, trial.groups[id])))])),
      criticalFailureTrials: trials.filter(trial => trial.critical.some(item => item.verdict === 'not_satisfied')).length,
      criticalPartialTrials: trials.filter(trial => trial.critical.some(item => item.verdict === 'partially_satisfied')).length,
      criticalUnknownTrials: trials.filter(trial => trial.critical.some(item => item.verdict === 'indeterminate')).length,
      criticalBlockedTrials: trials.filter(trial => trial.critical.length).length,
      plannedTrials: trials.length, distinctCases: plan.cases.length
    }
    arms[arm] = { quality: { ...aggregateDimensions(caseScores, scoring.dimensions), cases: caseScores }, collaboration, trials }
  }
  const comparison = { status: plan.mode === 'gate' ? 'comparable' : 'not_applicable', qualityDelta: null, groupChanges: {} }
  if (plan.mode === 'gate') {
    for (const before of arms.baseline.trials) {
      const after = arms.candidate.trials.find(trial => trial.caseId === before.caseId && trial.repeat === before.repeat)
      const environmentComparable = Boolean(before.environmentKey && before.environmentKey === after.environmentKey)
      if (!environmentComparable) comparison.status = 'incomparable'
      for (const left of [...before.quality.items, ...before.collaboration]) {
        const id = left.id ?? left.checklistItem
        const right = [...after.quality.items, ...after.collaboration].find(item => (item.id ?? item.checklistItem) === id)
        if (!left.applicable) continue
        const uncertain = !Object.hasOwn(values, left.verdict) || !Object.hasOwn(values, right.verdict)
        const kind = !environmentComparable ? 'incomparable' : uncertain ? 'evidence_change' : values[right.verdict] < values[left.verdict] ? 'regression' : values[right.verdict] > values[left.verdict] ? 'improvement' : right.verdict === 'not_satisfied' ? 'existing_failure' : 'unchanged'
        changes.push({ caseId: before.caseId, repeat: before.repeat, itemId: id, checklistItem: left.checklistItem ?? null, kind, before: left.verdict, after: right.verdict, beforeReason: left.reasonCode, afterReason: right.reasonCode, beforeLocator: before.locator, afterLocator: after.locator })
      }
    }
    if (comparison.status === 'comparable') {
      const before = arms.baseline.quality.total, after = arms.candidate.quality.total
      comparison.qualityDelta = before !== null && after !== null ? after - before : null
    }
    comparison.groupChanges = Object.fromEntries(Object.keys(COLLABORATION_GROUPS).map(id => {
      const before = arms.baseline.collaboration.groups[id].rates.satisfied, after = arms.candidate.collaboration.groups[id].rates.satisfied
      return [id, { before, after, deltaPercentagePoints: comparison.status === 'comparable' && before.value !== null && after.value !== null ? 100 * (after.value - before.value) : null }]
    }))
  }
  return { schemaVersion: 2, scoring: { id: scoring.id, version: scoring.version, digest: digestJson(scoring), dimensions: scoring.dimensions }, arms, comparison, changes, qualityGaps, criticalFailures }
}
