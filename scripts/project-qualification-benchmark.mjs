import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dispatchQualificationPrompt } from './lib/qualification-common.mjs'
import { findCompetingRovaiProcesses } from './lib/qualification-core.mjs'
import { normalizeQualificationTrialForImport } from './lib/qualification-evaluation.mjs'

const options = parseArguments(process.argv.slice(2))
const sourceSuiteRaw = await readFile(options.suiteSummary, 'utf8')
const sourceSuite = JSON.parse(sourceSuiteRaw)
const sourceSchemaVersion = sourceSuite.schemaVersion
const sourceIsV034 = sourceSchemaVersion === 2 && sourceSuite.suiteVersion === 'v0.34'
const formalQualification = sourceSuite.resultClass === 'qualification'
if (!formalQualification && (!options.selection || !options.priorCalibrationSummary)) {
  throw new Error('diagnostic benchmark import requires --selection and --prior-calibration-summary')
}
const selectionRaw = formalQualification
  ? `${JSON.stringify(selectionFromQualification(sourceSuite), null, 2)}\n`
  : await readFile(options.selection, 'utf8')
const selection = JSON.parse(selectionRaw)
validateSelection(selection)
const priorCalibrationRaw = formalQualification
  ? null
  : await readFile(options.priorCalibrationSummary, 'utf8')
const priorCalibration = priorCalibrationRaw ? JSON.parse(priorCalibrationRaw) : null
validateSourceSummaries(selection, sourceSuite, priorCalibration)

const trials = await Promise.all(selection.trials.map(async (entry) => {
  const trialPath = join(options.trialRoot, entry.trialId)
  const resultPath = join(trialPath, 'result.json')
  const raw = await readFile(resultPath, 'utf8')
  const observations = parseNdjson(await readFile(join(trialPath, 'observations.ndjson'), 'utf8'))
  const schedulingEvidence = deriveSchedulingEvidence(observations)
  const result = JSON.parse(raw)
  const normalizedResult = normalizeQualificationTrialForImport(result)
  if (result.trialId !== entry.trialId
      || result.case?.id !== entry.caseId
      || normalizedResult.validity !== 'valid'
      || normalizedResult.evaluationState !== 'complete'
      || !['pass', 'fail'].includes(normalizedResult.overall)) {
    throw new Error(`selected Trial is not one valid scored outcome: ${entry.trialId}`)
  }
  return {
    round: entry.round,
    caseId: entry.caseId,
    trialId: entry.trialId,
    runnerVersion: result.runnerVersion,
    result: normalizedResult.overall,
    verifiedDelivery: normalizedResult.verifiedDelivery,
    functionalVerificationPassed: result.schemaVersion === 1
      ? result.verifier?.verifiedDelivery === true
      : (result.deliveryLayer?.checkResults ?? [])
        .filter((check) => check.kind === 'hard' && check.observationAuthority === 'verifier')
        .every((check) => check.status === 'passed'),
    orchestrationConvergence: normalizedResult.orchestrationConvergence,
    postDispatchHumanIntervention: normalizedResult.postDispatchHumanIntervention,
    changeBoundaryPassed: result.changeBoundary?.passed === true,
    budgetTriggered: result.budget?.event ?? null,
    observedAgentRuns: result.budget?.observedAgentRuns ?? null,
    observedMemberCalls: result.budget?.observedAcceptedA2a
      ?? result.budget?.observedDurableA2aEffects
      ?? null,
    memberCallCountAuthority: result.budget?.observedAcceptedA2a !== null
      && result.budget?.observedAcceptedA2a !== undefined
      ? 'canonical_acceptance_receipt'
      : result.budget?.observedDurableA2aEffects !== undefined
        ? 'durable_effect_observation'
        : 'unavailable',
    members: result.collaborationEvidence?.members ?? [],
    collaborationAuditStatus: result.collaborationAudit?.status
      ?? (result.collaborationAudit?.passed === true
        ? 'passed'
        : result.collaborationAudit?.passed === false ? 'failed' : 'indeterminate'),
    collaborationAuditPassed: result.collaborationAudit?.passed === true,
    collaborationChecks: result.collaborationAudit?.checks ?? {},
    collaborationMetrics: result.collaborationEvidence?.metrics ?? {},
    pollingViolations: result.collaborationEvidence?.pollingViolations?.length ?? 0,
    sameMemberRunOverlaps: findRunOverlaps(result.collaborationEvidence?.runGraph ?? []),
    memberRunDurations: sumRunDurations(result.collaborationEvidence?.runGraph ?? []),
    schedulingEvidence,
    verifierCategories: (result.schemaVersion === 2
      ? result.deliveryLayer?.categories ?? []
      : result.verifier?.categories ?? []).map((category) => ({
      name: category.categoryId ?? category.name,
      status: category.status
    })),
    publicHardChecks: result.schemaVersion === 2
      ? (result.deliveryLayer?.checkResults ?? [])
        .filter((check) => check.kind === 'hard' && check.disclosure === 'public')
        .map((check) => ({ checkId: check.checkId, status: check.status }))
      : [],
    changeBoundaryViolations: result.changeBoundary?.violations ?? [],
    modeOnlyChangedPaths: (result.workspaceDiff?.changed ?? [])
      .filter((change) => change.before?.digest && change.before.digest === change.after?.digest
        && change.before.mode !== change.after?.mode)
      .map((change) => change.path),
    changedPaths: (result.workspaceDiff?.changed ?? [])
      .map((change) => change.path)
      .filter((path) => !isManagedProjectionPath(path)),
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationSeconds: durationSeconds(result.startedAt, result.completedAt),
    evidenceDigest: sha256(raw)
  }
}))

validateSelectedMatrix(trials)
trials.sort((left, right) => left.round - right.round || left.caseId.localeCompare(right.caseId))

const invalidatedAttempts = await Promise.all(selection.invalidatedAttempts.map(async (entry) => {
  const raw = await readFile(join(options.trialRoot, entry.trialId, 'result.json'), 'utf8')
  const result = JSON.parse(raw)
  return {
    trialId: entry.trialId,
    classification: entry.classification,
    reasonCode: entry.reasonCode,
    recordedValidity: result.validity,
    recordedResult: result.overall,
    evidenceDigest: sha256(raw)
  }
}))

const benchmarkSummary = buildSummary({
  selection,
  selectionRaw,
  sourceSuite,
  sourceSuiteRaw,
  priorCalibration,
  priorCalibrationRaw,
  trials,
  invalidatedAttempts
})
const report = renderReport(benchmarkSummary)
const evidenceSummaryPath = join(dirname(options.suiteSummary), 'benchmark-summary.json')
const evidenceSelectionPath = formalQualification
  ? join(dirname(options.suiteSummary), 'benchmark-selection.json')
  : options.selection

await mkdir(options.projectPath, { recursive: true, mode: 0o755 })
await preserveExistingReport(options.projectPath)
const reportDirectory = join(options.projectPath, 'reports', safePathSegment(benchmarkSummary.benchmarkId))
await mkdir(reportDirectory, { recursive: true, mode: 0o755 })
await writeJson(evidenceSummaryPath, benchmarkSummary, 0o600)
if (formalQualification) await writeFile(evidenceSelectionPath, selectionRaw, { mode: 0o600 })
await writeJson(join(options.projectPath, 'benchmark-summary.json'), benchmarkSummary, 0o644)
await writeFile(join(options.projectPath, 'README.md'), report, { mode: 0o644 })
await writeJson(join(reportDirectory, 'benchmark-summary.json'), benchmarkSummary, 0o644)
await writeFile(join(reportDirectory, 'README.md'), report, { mode: 0o644 })

const imported = options.noImport
  ? null
  : await importIntoRovai({
      benchmarkSummary,
      coreExecutable: options.core,
      dataDirectory: options.dataDir,
      projectPath: options.projectPath,
      syncDefaultTeamRuntimes: options.syncDefaultTeamRuntimes
    })

console.log(JSON.stringify({
  ok: true,
  benchmarkId: benchmarkSummary.benchmarkId,
  score: benchmarkSummary.score,
  projectPath: options.projectPath,
  reportDirectory,
  evidenceSummaryPath,
  evidenceSelectionPath,
  imported
}, null, 2))

function buildSummary({
  selection,
  selectionRaw,
  sourceSuite,
  sourceSuiteRaw,
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
      collaborationIndeterminate: values.filter((trial) => (
        trial.collaborationAuditStatus === 'indeterminate'
      )).length,
      repeats: values.length,
      results: values.map((trial) => trial.result),
      stable: new Set(values.map((trial) => trial.result)).size === 1
    }]
  }))
  const failedVerifierCategories = {}
  for (const trial of trials) {
    for (const category of trial.verifierCategories.filter((value) => value.status === 'failed')) {
      failedVerifierCategories[category.name] = (failedVerifierCategories[category.name] ?? 0) + 1
    }
  }
  const boundaryViolations = {}
  for (const trial of trials) {
    for (const violation of trial.changeBoundaryViolations) {
      const key = `${violation.path}:${violation.reason}`
      boundaryViolations[key] = (boundaryViolations[key] ?? 0) + 1
    }
  }
  const score = {
    validTrials: trials.length,
    passes,
    failures: trials.length - passes,
    outcomeRate: passes / trials.length,
    metric: 'raw_repeat_outcomes_not_pass_at_k',
    perCase
  }
  return {
    schemaVersion: sourceIsV034 ? 2 : 1,
    benchmarkId: selection.benchmarkId,
    suiteId: selection.suiteId,
    suiteVersion: selection.suiteVersion,
    reviewedAt: selection.reviewedAt,
    resultClass: sourceSuite.resultClass,
    qualificationEligible: qualification,
    formalPassRate: qualification
      ? (sourceIsV034 ? sourceSuite.finalPassRate : sourceSuite.passRate)
      : null,
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
        : trial.verifierCategories
          .filter((category) => category.name === 'public')
          .every((category) => category.status === 'passed')),
      functionalVerificationPasses: trials.filter((trial) => trial.functionalVerificationPassed).length,
      boundaryPasses: trials.filter((trial) => trial.changeBoundaryPassed).length,
      modeOnlyBoundaryFailureTrials: trials.filter((trial) => !trial.changeBoundaryPassed
        && trial.changeBoundaryViolations.length > 0
        && trial.changeBoundaryViolations.every((violation) => trial.modeOnlyChangedPaths.includes(violation.path))).length,
      collaborationAuditPasses: trials.filter((trial) => trial.collaborationAuditPassed).length,
      collaborationAuditIndeterminate: trials.filter((trial) => (
        trial.collaborationAuditStatus === 'indeterminate'
      )).length,
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
          'The twelve selected Trials used only the default Lead and made no Member Calls.',
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

function renderReport(summary) {
  const caseRows = Object.entries(summary.score.perCase).map(([caseId, value]) => (
    `| ${caseId} | ${value.results.map((result) => result.toUpperCase()).join(' / ')} | ${value.passes}/${value.repeats} | ${value.functionalPasses}/${value.repeats} | ${value.boundaryPasses}/${value.repeats} | ${value.collaborationPasses}/${value.repeats} | ${value.stable ? '是' : '否'} |`
  )).join('\n')
  const trialRows = summary.trials.map((trial) => (
    `| R${trial.round} | ${trial.caseId} | ${trial.result.toUpperCase()} | ${trial.functionalVerificationPassed ? 'PASS' : 'FAIL'} | ${trial.changeBoundaryPassed ? 'PASS' : 'FAIL'} | ${trial.collaborationAuditStatus.toUpperCase()} | ${trial.durationSeconds.toFixed(1)}s | ${trial.observedAgentRuns} | ${trial.observedMemberCalls} |`
  )).join('\n')
  if (!summary.qualificationEligible) return renderDiagnosticReport(summary, caseRows, trialRows)
  const failedCategories = renderCounts(summary.qualitySignals.failedVerifierCategories)
  const boundaryViolations = renderCounts(summary.qualitySignals.boundaryViolations)
  return `# Rovai ${summary.suiteVersion} Benchmark Review

本目录由 Rovai-ai Qualification 证据生成，项目名为 \`benchmark\`。它保存 12 个正式 Team Collaboration Trial 的脱敏结果，并通过公共 Core RPC 投影到本地 Rovai 应用。

## 结论

- CAL-001 通过，因此本轮产生正式 Qualification Pass Rate：**${summary.score.passes}/${summary.score.validTrials}（${formatPercent(summary.formalPassRate)}）**。
- 协作客观检查通过：**${summary.qualitySignals.collaborationAuditPasses}/${summary.score.validTrials}**，indeterminate：**${summary.qualitySignals.collaborationAuditIndeterminate}**；同队员单槽：**${summary.qualitySignals.singleSlotPasses}/${summary.score.validTrials}**；功能 Verifier：**${summary.qualitySignals.functionalVerificationPasses}/${summary.score.validTrials}**；变更边界：**${summary.qualitySignals.boundaryPasses}/${summary.score.validTrials}**。
- ${summary.qualitySignals.pendingWhileBusyObservedTrials} 个 Trial 的权威快照直接捕获到“接收 Conversation 忙时 Input 保持 pending”，随后才物化为 recipient Run；其他 Trial 未形成可观察等待窗口。
- 边界失败中有 ${summary.qualitySignals.modeOnlyBoundaryFailureTrials} 次仅改变文件 mode、内容摘要未变；这类结果仍按密封规则计 FAIL，但应作为下一版 fixture/harness 修正项。
- 共观察到 ${summary.collaboration.observedAgentRuns} 个 Agent Run、${summary.collaboration.observedMemberCalls} 条 Member Call 和 ${summary.collaboration.completedTasks} 个 completed Task。
- 队员 Run 累计时长：${renderDurations(summary.collaboration.memberRunDurations)}。
- 轮询违规 Trial：${summary.collaboration.pollingViolationTrials}；失败 Verifier 分类：${failedCategories || '无'}；边界违规：${boundaryViolations || '无'}。
- ${summary.collaboration.conclusion}

## 按 Case 的重复结果

| Case | 三轮结果 | 严格通过 | 功能 | 边界 | 协作 | 稳定 |
|---|---|---:|---:|---:|---:|---|
${caseRows}

## 12 个有效样本

| Round | Case | 总结果 | 功能 | 边界 | 协作 | 耗时 | Runs | Calls |
|---:|---|---|---|---|---|---:|---:|---:|
${trialRows}

## Review

1. Built-in CLI 协作调用是否可用应由协作审计回答，业务实现好坏由 Verifier 回答；不能再把任何总 FAIL 自动归因成运输失败。
2. ${summary.qualitySignals.collaborationAuditPasses}/${summary.score.validTrials} 协作客观检查通过、${summary.qualitySignals.collaborationAuditIndeterminate} 个 indeterminate，${summary.collaboration.pollingViolationTrials} 次轮询违规；缺少 canonical receipt coverage 时不得把持久 Inbox 效果冒充 accepted-A2A 结论。
3. \`Cargo.lock\` 类边界失败需要单列：内容变化可能是 Agent 增加依赖，纯 mode 变化也可能来自私有 fixture 的 0600 权限被工具规范化；两者不应使用同一个模糊错误码。
4. 当前只有硬 Verifier 和协议审计，没有 Judge；因此可以确认完成度与协作纪律，不能量化每个队员贡献的语义价值。
5. Case 分项：${renderCaseFindings(summary.score.perCase)}。

## 下一版评测集优先级

1. 报表固定拆成三轴：功能交付、协作协议、变更边界；总分仍严格，但诊断不能丢失失败来源。
2. 物化 fixture 时规范化工作区文件 mode，或让边界比较把“内容未变、仅 0600→0644”记为独立 hygiene 信号，避免私有存储权限污染任务成绩。
3. 增加专门的忙时 FIFO Case：B、C 的独立必要结果先后到达时，验证 A 的两个后续 Run 串行且无批处理；另加“callee 完成后不再联系任何队员”与 Core restart Case，证明不会合成额外 Input 或消息。
4. 为隐藏 Verifier 输出稳定、安全的失败码，并保留脱敏 patch/命令摘要，才能区分需求漏项、测试误判和队员整合覆盖。
5. 使用同题 Lead-only 对照组计算 collaboration lift；否则只能说明 Team 能协作，不能说明协作比单 Agent 更好。
6. Judge 暂不纳入本版本；未来若启用，应作为独立盲评维度，不能替代可执行 Verifier。

## 证据完整性

- Benchmark ID：\`${summary.benchmarkId}\`
- 选取清单摘要：\`${summary.integrity.selectionDigest}\`
- 原始 Suite 摘要：\`${summary.integrity.sourceSuiteSummaryDigest}\`
- Runner：${summary.integrity.runnerVersions.join(', ')}；未计分异常尝试：${summary.invalidatedAttempts.length}。

完整脱敏结构化结果见 [benchmark-summary.json](benchmark-summary.json)。
`
}

function renderDiagnosticReport(summary, caseRows, trialRows) {
  return `# Rovai ${summary.suiteVersion} Benchmark Review

本目录保存 12 个 post-gate 诊断样本的脱敏结果。

## 结论

- 诊断结果：**${summary.score.passes}/${summary.score.validTrials}（${formatPercent(summary.score.outcomeRate)}）**。
- 正式 Qualification Pass Rate 不存在：前置校准失败。
- 这批样本共 ${summary.collaboration.observedAgentRuns} 个 Agent Run、${summary.collaboration.observedMemberCalls} 条 Member Call；不能把诊断率包装成正式 Team Qualification 成绩。

## 按 Case 的重复结果

| Case | 三轮结果 | 严格通过 | 功能 | 边界 | 协作 | 稳定 |
|---|---|---:|---:|---:|---:|---|
${caseRows}

## 12 个有效样本

| Round | Case | 总结果 | 功能 | 边界 | 协作 | 耗时 | Runs | Calls |
|---:|---|---|---|---|---|---:|---:|---:|
${trialRows}

完整脱敏结构化结果见 [benchmark-summary.json](benchmark-summary.json)。
`
}

async function importIntoRovai({
  benchmarkSummary,
  coreExecutable,
  dataDirectory,
  projectPath,
  syncDefaultTeamRuntimes
}) {
  const competing = await findCompetingRovaiProcesses()
  if (competing.length > 0) {
    throw new Error(`Rovai App/Core must be stopped before import: ${competing.map((item) => item.pid).join(',')}`)
  }
  const core = startCore(coreExecutable, dataDirectory)
  try {
    await core.request('health.check', {}, 120_000)
    const runtimeConfiguration = syncDefaultTeamRuntimes
      ? await configureDefaultTeamRuntimes(core)
      : null
    const workspace = await core.request('workspaces.inspect', { path: projectPath })
    const preflight = await core.request('camps.creationPreflight')
    if (!preflight.admissible || !preflight.initialLeadAgentId || preflight.presentMembers.length === 0) {
      throw new Error(`local Rovai profile cannot create benchmark Camps: ${JSON.stringify(preflight)}`)
    }
    const frozenMembers = ['agent_1', 'agent_2', 'agent_3', 'agent_4']
    const present = new Set(preflight.presentMembers.map((member) => member.agentId))
    if (frozenMembers.some((member) => !present.has(member))) {
      throw new Error('local Rovai profile does not contain the complete frozen benchmark Team')
    }
    const members = frozenMembers
    const navigationBefore = await core.request('navigation.snapshot')
    const projectBefore = navigationBefore.projects.find((candidate) => candidate.projectPath === workspace.projectPath)
    const camps = []
    for (const trial of benchmarkSummary.trials) {
      const key = `r${trial.round}-${trial.caseId}`
      camps.push(await createEvidenceCamp({
        core,
        commandPrefix: `${benchmarkSummary.benchmarkId}:${key}`,
        name: `${benchmarkSummary.qualificationEligible ? 'Team ' : ''}R${trial.round} · ${trial.caseId} · ${trial.result.toUpperCase()}`,
        body: trialCampBody(benchmarkSummary, trial),
        projectPath: workspace.projectPath,
        members,
        defaultLead: 'agent_1'
      }))
    }
    const reviewCamp = await createEvidenceCamp({
      core,
      commandPrefix: `${benchmarkSummary.benchmarkId}:review`,
      name: benchmarkSummary.qualificationEligible
        ? `Team Benchmark ${benchmarkSummary.suiteVersion} · Review`
        : `Benchmark ${benchmarkSummary.suiteVersion} · Review`,
      body: reviewCampBody(benchmarkSummary, projectPath),
      projectPath: workspace.projectPath,
      members,
      defaultLead: 'agent_1'
    })
    const navigation = await core.request('navigation.snapshot')
    const project = navigation.projects.find((candidate) => candidate.projectPath === workspace.projectPath)
    if (!project || project.name !== basename(projectPath)
        || project.totalCount < (projectBefore?.totalCount ?? 0) + camps.length + 1) {
      throw new Error('benchmark Project was not visible in navigation after import')
    }
    return {
      projectName: project.name,
      projectPath: project.projectPath,
      resultCampCount: camps.length,
      reviewCampId: reviewCamp.campId,
      navigationCampCount: project.totalCount,
      runtimeConfiguration
    }
  } finally {
    await core.stop()
  }
}

async function createEvidenceCamp({ core, commandPrefix, name, body, projectPath, members, defaultLead }) {
  const created = await core.request('camps.create', {
    commandId: `${commandPrefix}:create`,
    name,
    workspace: { projectPath },
    memberAgentIds: members,
    defaultLeadAgentId: defaultLead,
    collaborationMode: 'peer'
  })
  const campId = created.payload?.campId
  if (created.status === 'rejected' || !campId) {
    throw new Error(`benchmark Camp creation failed: ${JSON.stringify(created)}`)
  }
  const sent = await dispatchQualificationPrompt(core.request, {
    commandId: `${commandPrefix}:message`,
    campId,
    prompt: body,
    execution: null
  })
  if (sent.commandResult?.status === 'rejected') {
    throw new Error(`benchmark evidence message failed: ${JSON.stringify(sent)}`)
  }
  const snapshot = await core.request('camps.snapshot', { campId })
  if (snapshot.messages.length !== 1 || snapshot.turns.length !== 0 || snapshot.agentRuns.length !== 0) {
    throw new Error(`benchmark evidence Camp unexpectedly created execution: ${campId}`)
  }
  return { campId, title: snapshot.camp.title }
}

function trialCampBody(summary, trial) {
  return `[Imported benchmark evidence — no AgentRun was created]\n\n` +
    `# R${trial.round} · ${trial.caseId} · ${trial.result.toUpperCase()}\n\n` +
    `- 类型：${summary.resultClass}${summary.qualificationEligible ? '（正式 Qualification）' : '（非正式 Qualification）'}\n` +
    `- 交付验证：${trial.verifiedDelivery === 'pass' ? '通过' : '失败'}\n` +
    `- 功能 Verifier：${trial.functionalVerificationPassed ? '通过' : '失败'}\n` +
    `- 变更边界：${trial.changeBoundaryPassed ? '通过' : `失败（${renderBoundaryViolations(trial.changeBoundaryViolations)}）`}\n` +
    `- 仅 mode 变化：${trial.modeOnlyChangedPaths.join(', ') || '无'}\n` +
    `- 协作客观检查：${trial.collaborationAuditStatus}\n` +
    `- 同队员 Run 重叠：${trial.sameMemberRunOverlaps.length === 0 ? '无' : trial.sameMemberRunOverlaps.join(', ')}\n` +
    `- 忙时 pending Input：${trial.schedulingEvidence.pendingWhileBusy ? `观察到（峰值 ${trial.schedulingEvidence.maxPendingWhileBusyInputs}）` : '未形成可观察窗口'}\n` +
    `- 编排收敛：${trial.orchestrationConvergence === 'pass' ? '是' : '否'}\n` +
    `- 耗时：${trial.durationSeconds.toFixed(1)} 秒\n` +
    `- Agent Runs：${trial.observedAgentRuns}\n` +
    `- Member Calls：${trial.observedMemberCalls}\n` +
    `- 完成 Task：${trial.collaborationMetrics.completedTasks ?? 0}\n` +
    `- 执行队员：${trial.members.join(', ') || '无'}\n` +
    `- 验证分类：${renderCategories(trial.verifierCategories)}\n` +
    `- 变更文件：${trial.changedPaths.join(', ') || '无'}\n` +
    `- Evidence ID：${trial.trialId}\n` +
    `- Evidence SHA-256：${trial.evidenceDigest}`
}

function reviewCampBody(summary, projectPath) {
  const cases = Object.entries(summary.score.perCase)
    .map(([caseId, value]) => `${caseId} 严格 ${value.passes}/${value.repeats}、功能 ${value.functionalPasses}/${value.repeats}、协作 ${value.collaborationPasses}/${value.repeats}（${value.results.join('/') }）`)
    .join('；')
  if (summary.qualificationEligible) {
    return `[Imported benchmark evidence — no AgentRun was created]\n\n` +
      `# Team Benchmark ${summary.suiteVersion} Review\n\n` +
      `正式 Qualification：${summary.score.passes} 通过 / ${summary.score.failures} 失败（${formatPercent(summary.formalPassRate)}）。CAL-001 已通过。\n\n` +
      `${cases}。\n\n` +
      `协作协议 ${summary.qualitySignals.collaborationAuditPasses}/${summary.score.validTrials}，同队员单槽 ${summary.qualitySignals.singleSlotPasses}/${summary.score.validTrials}，忙时 pending 快照 ${summary.qualitySignals.pendingWhileBusyObservedTrials} 个 Trial，功能 Verifier ${summary.qualitySignals.functionalVerificationPasses}/${summary.score.validTrials}，变更边界 ${summary.qualitySignals.boundaryPasses}/${summary.score.validTrials}。共 ${summary.collaboration.observedAgentRuns} Runs / ${summary.collaboration.observedMemberCalls} Calls，轮询违规 ${summary.collaboration.pollingViolationTrials}。\n\n` +
      `完整 Review：${join(projectPath, 'README.md')}\n` +
      `结构化结果：${join(projectPath, 'benchmark-summary.json')}`
  }
  return `[Imported benchmark evidence — no AgentRun was created]\n\n` +
    `# Benchmark ${summary.suiteVersion} Review\n\n` +
    `12 个有效诊断样本：${summary.score.passes} 通过 / ${summary.score.failures} 失败（${formatPercent(summary.score.outcomeRate)}）。\n\n` +
    `正式 Qualification Pass Rate 不存在：前置校准失败，本轮不具备资格成绩。\n\n` +
    `${cases}。\n\n` +
    `关键结论：12 次 Trial 全部只有默认 Lead，Member Call 为 0，因此只能评价 Lead 单体交付，不能评价 Team 协作能力。前置四队员校准虽证明消息可达，但以 ${summary.calibration.observedAgentRuns} 个 Run / ${summary.calibration.observedMemberCalls} 条 Member Call 未收敛。\n\n` +
    `完整 Review：${join(projectPath, 'README.md')}\n` +
    `结构化结果：${join(projectPath, 'benchmark-summary.json')}`
}

async function configureDefaultTeamRuntimes(core) {
  const team = [
    {
      agentId: 'agent_1',
      adapterKind: 'codex-cli',
      model: { mode: 'explicit', modelId: 'gpt-5.6-sol', options: { reasoning_effort: 'medium' } },
      permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } }
    },
    {
      agentId: 'agent_2',
      adapterKind: 'codex-cli',
      model: { mode: 'explicit', modelId: 'gpt-5.6-sol', options: { reasoning_effort: 'medium' } },
      permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } }
    },
    {
      agentId: 'agent_3',
      adapterKind: 'opencode-cli',
      model: { mode: 'explicit', modelId: 'opencode/big-pickle', options: {} },
      permissions: { adapterKind: 'opencode-cli', schemaVersion: 1, values: { permission: 'allow' } }
    },
    {
      agentId: 'agent_4',
      adapterKind: 'antigravity-app',
      model: { mode: 'explicit', modelId: 'gemini-3.6-flash-high', options: {} },
      permissions: { adapterKind: 'antigravity-app', schemaVersion: 1, values: { mode: 'accept-edits', sandbox: 'on', dangerously_skip_permissions: 'off' } }
    }
  ]
  for (const adapterKind of [...new Set(team.map((member) => member.adapterKind))]) {
    await core.request('runtime.product.check', { runtimeKind: adapterKind }, 120_000)
  }
  const configured = []
  for (const member of team) {
    const before = await core.request('members.get', { agentId: member.agentId })
    if (before.runtimeConfiguration?.adapterKind === member.adapterKind
        && canonicalJson(before.runtimeConfiguration?.model) === canonicalJson(member.model)
        && canonicalJson(before.runtimeConfiguration?.permissions) === canonicalJson(member.permissions)
        && before.runtimeReadiness?.status === 'ready') {
      configured.push({
        agentId: member.agentId,
        adapterKind: member.adapterKind,
        modelId: member.model.modelId,
        readiness: before.runtimeReadiness.status
      })
      continue
    }
    const result = await core.request('members.runtime.set', {
      commandId: crypto.randomUUID(),
      command: {
        agentId: member.agentId,
        expectedVersion: before.version,
        adapterKind: member.adapterKind,
        model: member.model,
        permissions: member.permissions
      }
    }, 120_000)
    if (result.status !== 'applied') {
      throw new Error(`default Team Runtime update failed: ${JSON.stringify({ member: member.agentId, result })}`)
    }
    const after = await core.request('members.get', { agentId: member.agentId })
    if (after.runtimeConfiguration?.adapterKind !== member.adapterKind
        || canonicalJson(after.runtimeConfiguration?.model) !== canonicalJson(member.model)
        || canonicalJson(after.runtimeConfiguration?.permissions) !== canonicalJson(member.permissions)
        || after.runtimeReadiness?.status !== 'ready') {
      throw new Error(`default Team Runtime verification failed: ${member.agentId}`)
    }
    configured.push({
      agentId: member.agentId,
      adapterKind: member.adapterKind,
      modelId: member.model.modelId,
      readiness: after.runtimeReadiness?.status ?? null
    })
  }
  return {
    builtinCli: {
      status: 'ready',
      contractVersion: 1,
      transport: 'private-local-ipc'
    },
    members: configured
  }
}

function startCore(executable, dataDirectory) {
  const child = spawn(executable, ['--data-dir', dataDirectory], {
    cwd: resolve(import.meta.dirname, '..'),
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const pending = new Map()
  let nextId = 1
  let stderrTail = ''
  let stopping = false
  let closeResult = null
  const closePromise = new Promise((resolveClose) => child.once('close', (code, signal) => {
    closeResult = { code, signal }
    resolveClose(closeResult)
    if (!stopping) rejectPending(new Error(`rovai-core exited early: ${stderrTail}`))
  }))
  child.stderr.on('data', (chunk) => { stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-16_384) })
  child.once('error', rejectPending)
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      rejectPending(error)
      return
    }
    if (message.method) return
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`))
    else request.resolve(message.result)
  })

  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }

  return {
    request(method, params = {}, timeoutMs = 60_000) {
      const id = nextId++
      return new Promise((resolveRequest, rejectRequest) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectRequest(new Error(`timed out waiting for ${method}`))
        }, timeoutMs)
        pending.set(id, { method, resolve: resolveRequest, reject: rejectRequest, timer })
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
      })
    },
    async stop() {
      stopping = true
      if (child.exitCode === null) child.stdin.end()
      await Promise.race([closePromise, delay(5_000)])
      if (child.exitCode === null) child.kill('SIGTERM')
      await Promise.race([closePromise, delay(5_000)])
      if (child.exitCode === null) child.kill('SIGKILL')
      await closePromise
      rejectPending(new Error('rovai-core stopped'))
      if (closeResult?.code !== 0) throw new Error(`rovai-core import shutdown failed: ${stderrTail}`)
    }
  }
}

function validateSelection(selection) {
  const supported = (selection?.schemaVersion === 1 && selection.suiteVersion === 'v0.32')
    || (selection?.schemaVersion === 2 && selection.suiteVersion === 'v0.34')
  if (!supported
      || typeof selection.benchmarkId !== 'string'
      || !Array.isArray(selection.trials)
      || selection.trials.length !== 12
      || !Array.isArray(selection.invalidatedAttempts)) {
    throw new Error('benchmark selection manifest is invalid')
  }
}

function selectionFromQualification(sourceSuite) {
  const supported = (sourceSuite?.schemaVersion === 1 && sourceSuite.suiteVersion === 'v0.32')
    || (sourceSuite?.schemaVersion === 2 && sourceSuite.suiteVersion === 'v0.34')
  if (!supported
      || !Array.isArray(sourceSuite.outcomes)) {
    throw new Error('qualification suite summary is invalid')
  }
  const trials = sourceSuite.outcomes
    .filter((outcome) => outcome.phase !== 'calibration')
    .map((outcome) => {
      const match = /^r([1-3])$/.exec(outcome.phase ?? '')
      if (!match) throw new Error(`qualification outcome has an invalid phase: ${outcome.phase}`)
      return {
        round: Number.parseInt(match[1], 10),
        caseId: outcome.caseId,
        trialId: outcome.trialId
      }
    })
  return {
    schemaVersion: sourceSuite.schemaVersion,
    benchmarkId: `${sourceSuite.suiteId}-formal-review`,
    suiteId: sourceSuite.suiteId,
    suiteVersion: sourceSuite.suiteVersion,
    reviewedAt: new Date().toISOString(),
    trials,
    invalidatedAttempts: []
  }
}

function validateSourceSummaries(selection, sourceSuite, priorCalibration) {
  if (sourceSuite.suiteId !== selection.suiteId || sourceSuite.suiteVersion !== selection.suiteVersion) {
    throw new Error('benchmark source summaries do not match the selection')
  }
  if (sourceSuite.resultClass === 'qualification') {
    const completeRate = sourceSuite.schemaVersion === 2
      ? sourceSuite.publicationState === 'complete' && typeof sourceSuite.finalPassRate === 'number'
      : typeof sourceSuite.passRate === 'number'
    if (sourceSuite.status !== 'completed'
        || sourceSuite.qualificationEligible !== true
        || sourceSuite.calibration !== 'pass'
        || sourceSuite.formalTrialsCompleted !== 12
        || !completeRate) {
      throw new Error('formal Qualification source is incomplete or ineligible')
    }
    return
  }
  if (sourceSuite.resultClass !== 'post_gate_diagnostic_benchmark'
      || sourceSuite.qualificationEligible !== false
      || priorCalibration?.suiteVersion !== selection.suiteVersion
      || priorCalibration.calibration !== 'fail'
      || priorCalibration.formalTrialsCompleted !== 0) {
    throw new Error('diagnostic benchmark source summaries do not match the selection')
  }
}

function validateSelectedMatrix(trials) {
  const keys = new Set(trials.map((trial) => `${trial.round}:${trial.caseId}`))
  const expected = new Set([1, 2, 3].flatMap((round) => ['TQ001', 'TQ002', 'TQ003', 'TQ004']
    .map((caseId) => `${round}:${caseId}`)))
  if (keys.size !== 12 || [...expected].some((key) => !keys.has(key))) {
    throw new Error('selected Trials are not one complete 3x4 matrix')
  }
}

function parseArguments(args) {
  const values = {}
  while (args.length > 0) {
    const argument = args.shift()
    if (!argument.startsWith('--')) usage()
    const key = argument.slice(2)
    if (['no-import', 'sync-default-team-runtimes'].includes(key)) {
      values[key] = true
      continue
    }
    if (!['selection', 'trial-root', 'suite-summary', 'prior-calibration-summary', 'project-path', 'core', 'data-dir'].includes(key)) usage()
    values[key] = args.shift()
  }
  for (const key of ['trial-root', 'suite-summary', 'project-path']) {
    if (!values[key]) usage()
  }
  if (Boolean(values.selection) !== Boolean(values['prior-calibration-summary'])) usage()
  if (!values['no-import'] && (!values.core || !values['data-dir'])) usage()
  return {
    selection: values.selection ? resolve(values.selection) : null,
    trialRoot: resolve(values['trial-root']),
    suiteSummary: resolve(values['suite-summary']),
    priorCalibrationSummary: values['prior-calibration-summary']
      ? resolve(values['prior-calibration-summary'])
      : null,
    projectPath: resolve(values['project-path']),
    core: values.core ? resolve(values.core) : null,
    dataDir: values['data-dir'] ? resolve(values['data-dir']) : null,
    noImport: values['no-import'] === true,
    syncDefaultTeamRuntimes: values['sync-default-team-runtimes'] === true
  }
}

function usage() {
  console.error('Usage: node scripts/project-qualification-benchmark.mjs --trial-root <path> --suite-summary <json> --project-path <path> [--selection <json> --prior-calibration-summary <json>] [--sync-default-team-runtimes] [--core <path> --data-dir <path> | --no-import]')
  process.exit(2)
}

function isManagedProjectionPath(path) {
  return ['.agent', '.agents', '.claude', '.gemini']
    .some((root) => path === root || path.startsWith(`${root}/`))
}

function renderCategories(categories) {
  return categories.map((category) => `${category.name}:${category.status}`).join(', ')
}

function renderBoundaryViolations(violations) {
  return violations.map((violation) => `${violation.path}:${violation.reason}`).join(', ') || '未知'
}

function renderCounts(values) {
  return Object.entries(values).map(([key, count]) => `${key} × ${count}`).join(', ')
}

function renderDurations(values) {
  return Object.entries(values).map(([member, seconds]) => `${member} ${seconds.toFixed(1)}s`).join(', ')
}

function renderCaseFindings(perCase) {
  return Object.entries(perCase).map(([caseId, value]) => (
    `${caseId} 严格 ${value.passes}/${value.repeats}、功能 ${value.functionalPasses}/${value.repeats}、边界 ${value.boundaryPasses}/${value.repeats}、协作 ${value.collaborationPasses}/${value.repeats}`
  )).join('；')
}

function findRunOverlaps(runGraph) {
  const overlaps = []
  for (let index = 0; index < runGraph.length; index += 1) {
    const left = runGraph[index]
    if (!left.startedAt || !left.endedAt) continue
    for (let otherIndex = index + 1; otherIndex < runGraph.length; otherIndex += 1) {
      const right = runGraph[otherIndex]
      if (left.agentId !== right.agentId || !right.startedAt || !right.endedAt) continue
      if (Date.parse(left.startedAt) < Date.parse(right.endedAt)
          && Date.parse(right.startedAt) < Date.parse(left.endedAt)) {
        if (!overlaps.includes(left.agentId)) overlaps.push(left.agentId)
      }
    }
  }
  return overlaps
}

function parseNdjson(raw) {
  return raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

function deriveSchedulingEvidence(observations) {
  let pendingWhileBusy = false
  let maxPendingWhileBusyInputs = 0
  for (const observation of observations) {
    const snapshot = observation.snapshot
    const pending = (snapshot?.conversationInputs ?? []).filter((input) => input.status === 'pending')
    const busyConversations = new Set((snapshot?.agentRuns ?? [])
      .filter((run) => ['queued', 'running', 'waiting'].includes(run.status))
      .map((run) => run.conversationId))
    const busyPending = pending.filter((input) => busyConversations.has(input.conversationId))
    maxPendingWhileBusyInputs = Math.max(maxPendingWhileBusyInputs, busyPending.length)
    if (busyPending.length > 0) pendingWhileBusy = true
  }
  return { pendingWhileBusy, maxPendingWhileBusyInputs }
}

function sumRunDurations(runGraph) {
  const values = {}
  for (const run of runGraph) {
    if (!run.startedAt || !run.endedAt) continue
    const seconds = (Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000
    if (!Number.isFinite(seconds) || seconds < 0) continue
    values[run.agentId] = Math.round(((values[run.agentId] ?? 0) + seconds) * 10) / 10
  }
  return values
}

function durationSeconds(startedAt, completedAt) {
  const value = (Date.parse(completedAt) - Date.parse(startedAt)) / 1000
  if (!Number.isFinite(value) || value < 0) throw new Error('Trial duration is invalid')
  return Math.round(value * 10) / 10
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function writeJson(path, value, mode) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode })
}

async function preserveExistingReport(projectPath) {
  const summaryPath = join(projectPath, 'benchmark-summary.json')
  const reportPath = join(projectPath, 'README.md')
  let rawSummary
  try {
    rawSummary = await readFile(summaryPath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  const existing = JSON.parse(rawSummary)
  if (typeof existing.benchmarkId !== 'string' || existing.benchmarkId === '') return
  const archive = join(projectPath, 'reports', safePathSegment(existing.benchmarkId))
  await mkdir(archive, { recursive: true, mode: 0o755 })
  await writeFile(join(archive, 'benchmark-summary.json'), rawSummary, { mode: 0o644 })
  try {
    const rawReport = await readFile(reportPath, 'utf8')
    await writeFile(join(archive, 'README.md'), rawReport, { mode: 0o644 })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function safePathSegment(value) {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error('benchmark ID is unsafe for a report directory')
  return value
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
