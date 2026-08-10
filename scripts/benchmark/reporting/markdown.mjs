export function renderBenchmarkReview(run, { criteria = [], comparison = null } = {}) {
  const passed = criteria.filter((entry) => entry.status === 'passed').length
  const failureRows = run.outcome.failureTaxonomy.length === 0
    ? '- 无'
    : run.outcome.failureTaxonomy.map((entry) => `- ${entry}`).join('\n')
  const criteriaRows = criteria.length === 0
    ? '| — | 未提供逐项公开结果 | — |'
    : criteria.map((entry) => `| ${entry.id} | ${escapeCell(entry.statement)} | ${entry.status} |`).join('\n')
  const comparisonSection = comparison
    ? renderComparisonEligibility(comparison.axes)
    : '未提供 baseline；所有 delta 均被抑制。'
  return `# Benchmark Review: ${run.profile.id}@${run.profile.version}

- Lane：${run.profile.lane}
- Protocol：${run.benchmarkProtocolVersion}
- Hard Outcome：${run.outcome.hardOutcome}
- Criteria：${passed}/${criteria.length}
- Product Contract Fingerprint：${run.productContract.fingerprintDigest}
- Content Identity：${run.integrity.contentIdentityDigest}

## Criteria

| ID | 合同断言 | 结果 |
| --- | --- | --- |
${criteriaRows}

## Comparison eligibility

${comparisonSection}

## Failure taxonomy

${failureRows}

## Authority boundary

Bundle/JSON 文件是唯一权威源。本 Review 是派生投影；Semantic Judge 不改变 Hard Outcome，且不生成混合总分或 Pass@k。
`
}

export function renderComparisonEligibility(axes) {
  return Object.entries(axes).map(([axis, value]) => (
    `- ${axis}: ${value.eligible ? 'eligible' : `ineligible (${value.reasonCodes.join(', ')})`}`
  )).join('\n')
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

export function renderLegacyProjectReport(summary) {
  const caseRows = Object.entries(summary.score.perCase).map(([caseId, value]) => (
    `| ${caseId} | ${value.results.map((result) => result.toUpperCase()).join(' / ')} | ${value.passes}/${value.repeats} | ${value.functionalPasses}/${value.repeats} | ${value.boundaryPasses}/${value.repeats} | ${value.collaborationPasses}/${value.repeats} | ${value.stable ? '是' : '否'} |`
  )).join('\n')
  const trialRows = summary.trials.map((trial) => (
    `| R${trial.round} | ${trial.caseId} | ${trial.result.toUpperCase()} | ${trial.functionalVerificationPassed ? 'PASS' : 'FAIL'} | ${trial.changeBoundaryPassed ? 'PASS' : 'FAIL'} | ${trial.collaborationAuditStatus.toUpperCase()} | ${trial.durationSeconds.toFixed(1)}s | ${trial.observedAgentRuns} | ${trial.observedMemberCalls} |`
  )).join('\n')
  if (!summary.qualificationEligible) return renderLegacyDiagnosticReport(summary, caseRows, trialRows)
  const failedCategories = renderCounts(summary.qualitySignals.failedVerifierCategories)
  const boundaryViolations = renderCounts(summary.qualitySignals.boundaryViolations)
  const samples = summary.score.validTrials
  const roundLabel = repeatLabel(summary.score.perCase)
  return `# Rovai ${summary.suiteVersion} Benchmark Review

本目录由 Rovai-ai Qualification 证据生成，项目名为 \`benchmark\`。它保存 ${samples} 个正式 Team Collaboration Trial 的脱敏结果，并通过公共 Core RPC 投影到本地 Rovai 应用。

## 结论

- CAL-001 通过，因此本轮产生正式 Qualification Pass Rate：**${summary.score.passes}/${samples}（${formatPercent(summary.formalPassRate)}）**。
- 协作客观检查通过：**${summary.qualitySignals.collaborationAuditPasses}/${samples}**，indeterminate：**${summary.qualitySignals.collaborationAuditIndeterminate}**；同队员单槽：**${summary.qualitySignals.singleSlotPasses}/${samples}**；功能 Verifier：**${summary.qualitySignals.functionalVerificationPasses}/${samples}**；变更边界：**${summary.qualitySignals.boundaryPasses}/${samples}**。
- ${summary.qualitySignals.pendingWhileBusyObservedTrials} 个 Trial 的权威快照直接捕获到“接收 Conversation 忙时 Input 保持 pending”，随后才物化为 recipient Run；其他 Trial 未形成可观察等待窗口。
- 边界失败中有 ${summary.qualitySignals.modeOnlyBoundaryFailureTrials} 次仅改变文件 mode、内容摘要未变；这类结果仍按密封规则计 FAIL，但应作为下一版 fixture/harness 修正项。
- 共观察到 ${summary.collaboration.observedAgentRuns} 个 AgentRun、${summary.collaboration.observedMemberCalls} 条 Member Call 和 ${summary.collaboration.completedTasks} 个 completed Task。
- 队员 Run 累计时长：${renderDurations(summary.collaboration.memberRunDurations)}。
- 轮询违规 Trial：${summary.collaboration.pollingViolationTrials}；失败 Verifier 分类：${failedCategories || '无'}；边界违规：${boundaryViolations || '无'}。
- ${summary.collaboration.conclusion}

## 按 Case 的重复结果

| Case | ${roundLabel}结果 | 严格通过 | 功能 | 边界 | 协作 | 稳定 |
|---|---|---:|---:|---:|---:|---|
${caseRows}

## ${samples} 个有效样本

| Round | Case | 总结果 | 功能 | 边界 | 协作 | 耗时 | Runs | Calls |
|---:|---|---|---|---|---|---:|---:|---:|
${trialRows}

## Review

1. Built-in CLI 协作调用是否可用应由协作审计回答，业务实现好坏由 Verifier 回答；不能再把任何总 FAIL 自动归因成运输失败。
2. ${summary.qualitySignals.collaborationAuditPasses}/${samples} 协作客观检查通过、${summary.qualitySignals.collaborationAuditIndeterminate} 个 indeterminate，${summary.collaboration.pollingViolationTrials} 次轮询违规；缺少 canonical receipt coverage 时不得把持久 Inbox 效果冒充 accepted-A2A 结论。
3. \`Cargo.lock\` 类边界失败需要单列：内容变化可能是 Agent 增加依赖，纯 mode 变化也可能来自私有 fixture 的 0600 权限被工具规范化；两者不应使用同一个模糊错误码。
4. 当前只有硬 Verifier 和协议审计，没有 Judge；因此可以确认完成度与协作纪律，不能量化每个队员贡献的语义价值。
5. Case 分项：${renderCaseFindings(summary.score.perCase)}。

## 下一版评测集优先级

1. 报表固定拆成三轴：功能交付、协作协议、变更边界；总分仍严格，但诊断不能丢失失败来源。
2. 物化 fixture 时规范化工作区文件 mode，或让边界比较把“内容未变、仅 0600→0644”记为独立 hygiene 信号，避免私有存储权限污染任务成绩。
3. 增加专门的忙时 FIFO Case：B、C 的独立必要结果先后到达时，验证 A 的两个后续 AgentRun 串行且无批处理；另加“callee 完成后不再联系任何队员”与 Core restart Case，证明不会合成额外 Input 或消息。
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

function renderLegacyDiagnosticReport(summary, caseRows, trialRows) {
  const samples = summary.score.validTrials
  return `# Rovai ${summary.suiteVersion} Benchmark Review

本目录保存 ${samples} 个 post-gate 诊断样本的脱敏结果。

## 结论

- 诊断结果：**${summary.score.passes}/${samples}（${formatPercent(summary.score.outcomeRate)}）**。
- 正式 Qualification Pass Rate 不存在：前置校准失败。
- 这批样本共 ${summary.collaboration.observedAgentRuns} 个 AgentRun、${summary.collaboration.observedMemberCalls} 条 Member Call；不能把诊断率包装成正式 Team Qualification 成绩。

## 按 Case 的重复结果

| Case | ${repeatLabel(summary.score.perCase)}结果 | 严格通过 | 功能 | 边界 | 协作 | 稳定 |
|---|---|---:|---:|---:|---:|---|
${caseRows}

## ${samples} 个有效样本

| Round | Case | 总结果 | 功能 | 边界 | 协作 | 耗时 | Runs | Calls |
|---:|---|---|---|---|---|---:|---:|---:|
${trialRows}

完整脱敏结构化结果见 [benchmark-summary.json](benchmark-summary.json)。
`
}

export function legacyReviewCampBody(summary, projectPath) {
  const cases = Object.entries(summary.score.perCase)
    .map(([caseId, value]) => `${caseId} 严格 ${value.passes}/${value.repeats}、功能 ${value.functionalPasses}/${value.repeats}、协作 ${value.collaborationPasses}/${value.repeats}（${value.results.join('/')}）`)
    .join('；')
  return `[Imported benchmark evidence — no AgentRun was created]\n\n`
    + `# Benchmark ${summary.suiteVersion} Review\n\n`
    + `${summary.qualificationEligible ? '正式 Qualification' : '诊断样本'}：${summary.score.passes} 通过 / ${summary.score.failures} 失败。\n\n`
    + `${cases}。\n\n`
    + `完整 Review：${projectPath}/README.md\n`
    + `结构化结果：${projectPath}/benchmark-summary.json`
}

export function legacyTrialCampBody(summary, trial) {
  return `[Imported benchmark evidence — no AgentRun was created]\n\n`
    + `# R${trial.round} · ${trial.caseId} · ${trial.result.toUpperCase()}\n\n`
    + `- 类型：${summary.resultClass}\n`
    + `- Hard Outcome：${trial.result}\n`
    + `- Evidence ID：${trial.trialId}\n`
    + `- Evidence SHA-256：${trial.evidenceDigest}`
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

function repeatLabel(perCase) {
  const count = Math.max(0, ...Object.values(perCase).map((entry) => entry.repeats))
  return new Map([[1, '单次'], [2, '两轮'], [3, '三轮']]).get(count) ?? `${count} 轮`
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`
}
