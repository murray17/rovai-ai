import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

/**
 * Camp-level real-LLM Memory behavior diagnostic.
 *
 * Unlike smoke-memory-runtime.mjs, this script never tells an Agent which
 * memory CLI command or JSON payload to use. It compares two behaviors:
 *
 *   natural    - durable language is present, but Memory is not mentioned.
 *   stewarded  - the Camp explicitly selects memory-stewardship, without
 *                prescribing a command, scope, kind, body, or retrieval keys.
 *
 * The comparison separates a discovery/trigger failure from a transport or
 * persistence failure. It also exercises correction, duplicate suppression,
 * secret/transient rejection, and cross-Camp recall.
 *
 * Environment:
 *   ROVAI_MEMORY_CAMP_ADAPTER=<AdapterKind>
 *   ROVAI_MEMORY_CAMP_MODE=preflight|natural|stewarded|both (default: both)
 *   ROVAI_MEMORY_CAMP_SUITE=capture|probe|quick|full     (default: probe)
 *   ROVAI_MEMORY_CAMP_STRICT=1                          fail on quality gates
 *   ROVAI_MEMORY_CAMP_KEEP=1                            preserve successful fixture
 *   ROVAI_MEMORY_CAMP_SHARED_DATA_DIR=<absolute path>    append to an isolated fixture
 *   ROVAI_MEMORY_CAMP_REPORT=/absolute/or/relative.json write JSON report
 *   ROVAI_MEMORY_CAMP_MODEL_<ADAPTER_SLUG>=<model-id>   select an explicit model
 *   ROVAI_MEMORY_CAMP_CLAUDE_MODEL=<model-alias>         ANTHROPIC_MODEL (default: sonnet)
 *   ROVAI_MEMORY_CAMP_RUN_TIMEOUT_MS=<milliseconds>      per-AgentRun timeout
 *   ROVAI_MEMORY_CAMP_DELIVERY_UNKNOWN_GRACE_MS=<ms>     fail-fast grace (default: 5000)
 */

const root = resolve(import.meta.dirname, '..')
const allAdapterKinds = [
  'codex-cli',
  'opencode-cli',
  'copilot-cli',
  'claude-code-cli',
  'antigravity-app',
  'kiro-cli',
  'qoder-cli',
  'codebuddy-cli',
  'qwen-code',
  'trae-cn-cli'
]
const adapterKind = process.env.ROVAI_MEMORY_CAMP_ADAPTER ?? 'codex-cli'
const mode = process.env.ROVAI_MEMORY_CAMP_MODE ?? 'both'
const suite = process.env.ROVAI_MEMORY_CAMP_SUITE ?? 'probe'
const strict = process.env.ROVAI_MEMORY_CAMP_STRICT === '1'
const keepFixture = process.env.ROVAI_MEMORY_CAMP_KEEP === '1'
const sharedDataDir = process.env.ROVAI_MEMORY_CAMP_SHARED_DATA_DIR
  ? resolve(process.env.ROVAI_MEMORY_CAMP_SHARED_DATA_DIR)
  : null
const runTimeoutMs = positiveInteger(
  process.env.ROVAI_MEMORY_CAMP_RUN_TIMEOUT_MS ?? '480000',
  'ROVAI_MEMORY_CAMP_RUN_TIMEOUT_MS'
)
const deliveryUnknownGraceMs = positiveInteger(
  process.env.ROVAI_MEMORY_CAMP_DELIVERY_UNKNOWN_GRACE_MS ?? '5000',
  'ROVAI_MEMORY_CAMP_DELIVERY_UNKNOWN_GRACE_MS'
)
const reportPath = process.env.ROVAI_MEMORY_CAMP_REPORT
  ? resolve(process.env.ROVAI_MEMORY_CAMP_REPORT)
  : null

assert(allAdapterKinds.includes(adapterKind),
  `Unsupported ROVAI_MEMORY_CAMP_ADAPTER: ${adapterKind}`)
assert(['preflight', 'natural', 'stewarded', 'both'].includes(mode),
  `Unsupported ROVAI_MEMORY_CAMP_MODE: ${mode}`)
assert(['capture', 'probe', 'quick', 'full'].includes(suite),
  `Unsupported ROVAI_MEMORY_CAMP_SUITE: ${suite}`)

const fixtureRoot = sharedDataDir
  ? dirname(sharedDataDir)
  : await mkdtemp(join(tmpdir(), `rovai-memory-camp-${adapterKind}-`))
const dataDir = sharedDataDir ?? join(fixtureRoot, 'data')
const projectRoot = sharedDataDir
  ? join(fixtureRoot, `project-${adapterKind}-${crypto.randomUUID()}`)
  : join(fixtureRoot, 'project')
let agentIds = sharedDataDir ? [] : ['agent_2', 'agent_1']
let leadAgentId = agentIds[0] ?? null
let workerAgentId = agentIds[1] ?? null
const exercisesWorker = (mode === 'stewarded' || mode === 'both')
  && suite !== 'probe'
  && suite !== 'capture'
let configuredAgentIds = exercisesWorker ? agentIds : [leadAgentId].filter(Boolean)
const report = {
  schemaVersion: 3,
  status: 'running',
  ok: false,
  startedAt: new Date().toISOString(),
  completedAt: null,
  adapterKind,
  runtimeVersion: null,
  configuredModel: null,
  observedModels: [],
  mode,
  suite,
  strict,
  sharedFixture: sharedDataDir !== null,
  configuredAgentIds,
  fixtureRoot,
  dataDir,
  projectRoot,
  fixtureRetained: true,
  metrics: null,
  phases: [],
  finalMemory: null,
  error: null
}
const phases = report.phases
let core = null
let workspace = null
let terminalError = null

await persistReport()
try {
  await prepareProject()
  core = startCore(dataDir, runtimeEnvironment(adapterKind))
  await core.request('health.check')
  if (sharedDataDir) {
    const memberCount = exercisesWorker ? 2 : 1
    agentIds = []
    for (let index = 0; index < memberCount; index += 1) {
      agentIds.push(await ensureRuntimeMember(core.request, adapterKind, index))
    }
    leadAgentId = agentIds[0]
    workerAgentId = agentIds[1] ?? null
    configuredAgentIds = exercisesWorker ? agentIds : [leadAgentId]
    report.configuredAgentIds = configuredAgentIds
    await persistReport()
  }
  workspace = await core.request('workspaces.inspect', { path: projectRoot })
  const installation = await configureProductRuntime(
    core.request,
    adapterKind,
    configuredAgentIds
  )
  report.runtimeVersion = installation?.snapshot?.reportedVersion ?? null
  report.configuredModel = await configureDiagnosticModel(
    core.request,
    installation,
    configuredAgentIds
  )
  await persistReport()

  if (mode === 'preflight') {
    report.status = 'passed'
    report.ok = true
  } else {
    const baseline = await snapshotMemory(core.request)

    if (mode === 'natural' || mode === 'both') {
      process.stderr.write(`[memory-camp] ${adapterKind}: natural discovery\n`)
      phases.push(await runNaturalPhase(core.request, baseline))
      await persistReport()
    }

    const beforeStewarded = await snapshotMemory(core.request)
    if (mode === 'stewarded' || mode === 'both') {
      process.stderr.write(`[memory-camp] ${adapterKind}: stewarded capture\n`)
      phases.push(await runStewardedPhase(core.request, beforeStewarded))
      await persistReport()
    }

    const beforeRecall = await snapshotMemory(core.request)
    if ((mode === 'stewarded' || mode === 'both') && suite !== 'capture') {
      process.stderr.write(`[memory-camp] ${adapterKind}: cross-Camp recall\n`)
    }
    const recall = (mode === 'stewarded' || mode === 'both') && suite !== 'capture'
      ? await runRecallPhase(core.request, beforeRecall)
      : null
    if (recall) {
      phases.push(recall)
      await persistReport()
    }

    const finalMemory = await snapshotMemory(core.request)
    const metrics = evaluate({ baseline, phases, finalMemory, recall })
    report.metrics = metrics
    report.finalMemory = {
      activeAgentMemories: finalMemory.agentMemories.map(sanitizeMemory),
      pendingHearthReviewCount: finalMemory.pendingReviewItems.length,
      totalMemoryCount: finalMemory.memories.length
    }
    report.status = !strict || metrics.strictPassed ? 'passed' : 'failed'
    report.ok = report.status === 'passed'
    if (strict && !metrics.strictPassed) {
      throw new Error(`Camp Memory behavior gates failed: ${JSON.stringify(metrics)}`)
    }
  }
} catch (error) {
  terminalError = error
  report.status = 'failed'
  report.ok = false
  report.error = safeError(error)
} finally {
  await core?.stop()
  report.observedModels = observedModels(core?.events ?? [])
  const retainFixture = sharedDataDir !== null
    || keepFixture
    || terminalError !== null
    || report.status === 'failed'
  if (!retainFixture) {
    await rm(fixtureRoot, { recursive: true, force: true })
    report.fixtureRoot = null
    report.dataDir = null
    report.projectRoot = null
    report.fixtureRetained = false
  }
  report.completedAt = new Date().toISOString()
  await persistReport()
}

console.log(JSON.stringify({
  ok: report.ok,
  status: report.status,
  adapterKind,
  runtimeVersion: report.runtimeVersion,
  configuredModel: report.configuredModel,
  observedModels: report.observedModels,
  metrics: report.metrics,
  reportPath,
  fixtureRoot: report.fixtureRoot,
  error: report.error
}, null, 2))
if (terminalError) process.exitCode = 1

async function runNaturalPhase(request, baseline) {
  const body = [
    '请设计一个只有三行的发布交付模板，每行不超过二十四个字。',
    '这是我和你这个队员今后长期协作时的稳定偏好：每次交付先给结论，再给可执行命令，最后解释原因。',
    '这不是只针对今天的临时格式。正常完成任务即可，不要展开说明。'
  ].join('\n')

  const created = await createConfiguredCampAndSend(request, {
    commandId: crypto.randomUUID(),
    name: campName('Memory natural discovery trial'),
    workspace,
    memberAgentIds: agentIds,
    defaultLeadAgentId: leadAgentId,
    address: { mode: 'explicit', agentIds: [leadAgentId] },
    body,
    purpose: 'Create a reusable release-delivery template from a durable user preference.'
  })
  const campId = requireAccepted(created, 'Natural Camp creation')
  const execution = await waitForRuns(request, campId, created.payload.agentRunIds)
  const after = await snapshotMemory(request)
  const delta = memoryDelta(baseline, after)

  return {
    name: 'natural_discovery',
    campId,
    runIds: execution.runIds,
    resolvedApprovalCount: execution.resolvedApprovalCount,
    outputs: execution.outputs,
    delta,
    expected: {
      activeMemoryContains: ['结论', '命令', '解释'],
      explanation: 'No Memory-specific instruction was supplied.'
    }
  }
}

async function runStewardedPhase(request, baseline) {
  const policy = [
    '',
    '本 Camp 的长期协作政策：当且仅当本轮出现一条明确、稳定、跨未来 AgentRun 仍有价值且非敏感的信息时，',
    '主动使用当前可用的 memory-stewardship Skill 与 Memory 长期记忆治理能力完成一次判断。写入前完整读取',
    '该 Skill 要求的引用和当前精确帮助，不得猜测接口或参数；只做一次最小更新，先检查精确作用范围；',
    '等价则停止；只有结构化回执确认生效后才能声称已保存，失败时按回执安全恢复一次；',
    '不要保存项目事实、临时状态、路径、端口或凭据，也不要在公开回复中描述内部工具调用。'
  ].join('\n')

  const firstBody = [
    '请为发布负责人写一个只有三行的审阅清单，每行不超过二十四个字。',
    suite === 'capture'
      ? '这是我和你这个发布负责人长期协作时的稳定偏好：发布交接先给结论，再列阻断风险，最后给改进建议。'
      : '这是我和你这个发布负责人长期协作时的稳定偏好：发布交接先列阻断风险，再列改进建议。',
    policy
  ].join('\n')
  const created = await createConfiguredCampAndSend(request, {
    commandId: crypto.randomUUID(),
    name: campName('Memory stewarded Camp trial'),
    workspace,
    memberAgentIds: agentIds,
    defaultLeadAgentId: leadAgentId,
    address: { mode: 'explicit', agentIds: [leadAgentId] },
    body: firstBody,
    purpose: 'Create a release-review checklist while applying the Camp memory policy.'
  })
  const campId = requireAccepted(created, 'Stewarded Camp creation')
  const executions = []
  executions.push(await waitForRuns(request, campId, created.payload.agentRunIds))

  const scenarios = suite === 'capture'
    ? []
    : suite === 'probe'
    ? [{
        id: 'correction_and_negative_control',
        agentId: leadAgentId,
        purpose: 'Correct one stable preference while rejecting transient and sensitive input.',
        body: [
          '更正我和你的上一条长期偏好：发布交接应先给结论，再列阻断风险，最后给改进建议；旧顺序不再适用。',
          '本次临时调试端口是 43127，仅今天有效；测试凭据是 sk-camp-memory-test-secret，不要长期保留二者。',
          '请给出新版三行模板，并用一句话说明会安全丢弃临时信息。',
          policy
        ].join('\n')
      }]
    : [
        {
          id: 'worker_lesson',
          agentId: workerAgentId,
          purpose: 'Resolve conflicting requirements using a reusable collaboration lesson.',
          body: [
            '请给出遇到新旧需求冲突时的两步处理法。',
            '这是一条长期可复用经验：发生冲突时，以最新的用户明确指令为权威，并明确指出旧约束已经失效。',
            policy
          ].join('\n')
        },
        {
          id: 'correction',
          agentId: leadAgentId,
          purpose: 'Correct the previously stated stable release-handoff preference.',
          body: [
            '更正我和你的上一条长期偏好：发布交接应先给结论，再列阻断风险，最后给改进建议。',
            '旧的“阻断风险在最前”不再适用。请据此给出新版模板。',
            policy
          ].join('\n')
        },
        {
          id: 'negative_secret_transient',
          agentId: workerAgentId,
          purpose: 'Handle transient and sensitive input without retaining it as Memory.',
          body: [
            '本次临时调试端口是 43127，仅今天有效；测试凭据是 sk-camp-memory-test-secret。',
            '不要长期保留端口或凭据。请只回复你会如何安全处理本次输入。',
            policy
          ].join('\n')
        }
      ]

  if (suite === 'full') {
    scenarios.splice(1, 0,
      {
        id: 'relationship_agreement',
        agentId: leadAgentId,
        purpose: 'Establish a durable directed handoff agreement with another Camp member.',
        body: [
          `请为你向 ${workerAgentId} 交接工作时设计一个模板。`,
          `长期协作约定：你向 ${workerAgentId} 交接时必须同时给出测试命令、结果摘要和提交引用。`,
          policy
        ].join('\n')
      },
      {
        id: 'duplicate_paraphrase',
        agentId: leadAgentId,
        purpose: 'Re-observe an equivalent agreement without creating a duplicate.',
        body: [
          `继续沿用长期约定：交给 ${workerAgentId} 的交接包要包含测试指令、执行结果与提交定位。`,
          '请给一个示例；不要因为措辞变化而重复保存等价长期信息。',
          policy
        ].join('\n')
      })
  }

  for (const scenario of scenarios) {
    process.stderr.write(`[memory-camp] ${adapterKind}: stewarded ${scenario.id}\n`)
    const sent = await sendCampMessage(request, {
      campId,
      agentIds: [scenario.agentId],
      body: scenario.body,
      purpose: scenario.purpose
    })
    requireAccepted(sent, `Scenario ${scenario.id}`, campId)
    executions.push(await waitForRuns(request, campId, sent.payload.agentRunIds))
  }

  const after = await snapshotMemory(request)
  const delta = memoryDelta(baseline, after)
  return {
    name: 'stewarded_batch',
    campId,
    runIds: executions.flatMap((execution) => execution.runIds),
    resolvedApprovalCount: executions.reduce((sum, execution) =>
      sum + execution.resolvedApprovalCount, 0),
    outputs: executions.flatMap((execution) => execution.outputs),
    scenarioIds: ['lead_preference', ...scenarios.map((scenario) => scenario.id)],
    delta,
    expected: {
      durableConcepts: [
        ['结论', '阻断风险', '改进建议'],
        ...(suite === 'probe' || suite === 'capture'
          ? []
          : [['最新', '用户', '旧约束', '失效']])
      ],
      mustNotContain: ['transient port marker', 'test credential marker'],
      fullSuiteAddsRelationshipAndDuplicateChecks: suite === 'full'
    }
  }
}

async function runRecallPhase(request, baseline) {
  const body = [
    '这是一个新的 Camp，不会重复告诉你之前的长期偏好。',
    '请根据你已经持有的长期发布交付偏好，给出一个最小发布交接示例。',
    '不要猜测；需要时使用可用的 Memory 发现与读取能力。'
  ].join('\n')

  const created = await createConfiguredCampAndSend(request, {
    commandId: crypto.randomUUID(),
    name: campName('Memory cross-Camp recall trial'),
    workspace,
    memberAgentIds: agentIds,
    defaultLeadAgentId: leadAgentId,
    address: { mode: 'explicit', agentIds: [leadAgentId] },
    body,
    purpose: 'Apply a durable preference in a fresh Camp without restating it.'
  })
  const campId = requireAccepted(created, 'Recall Camp creation')
  const execution = await waitForRuns(request, campId, created.payload.agentRunIds)
  const after = await snapshotMemory(request)

  return {
    name: 'cross_camp_recall',
    campId,
    runIds: execution.runIds,
    resolvedApprovalCount: execution.resolvedApprovalCount,
    outputs: execution.outputs,
    delta: memoryDelta(baseline, after),
    expected: {
      outputContains: ['结论', '阻断风险', '建议']
    }
  }
}

async function sendCampMessage(request, input) {
  const currentDraft = await request('camp.composerDraft.get', { campId: input.campId })
  const content = [
    ...input.agentIds.flatMap((agentId) => [
      { kind: 'member_mention', agentId },
      { kind: 'text', text: ' ' }
    ]),
    { kind: 'text', text: input.body }
  ]
  const savedDraft = await request('camp.composerDraft.save', {
    campId: input.campId,
    expectedRevision: currentDraft.revision,
    content
  })
  const sent = await request('camp.messages.send', {
    commandId: crypto.randomUUID(),
    campId: input.campId,
    draftRevision: savedDraft.revision,
    execution: {
      taskId: null,
      purpose: input.purpose,
      completionRole: 'required'
    }
  })
  return sent.commandResult ?? sent
}

async function waitForRuns(request, campId, runIds) {
  let lastState = null
  const resolvedApprovals = new Set()
  const selectedRunIds = new Set(runIds)
  const deliveryUnknownSince = new Map()
  const snapshot = await waitFor(async () => {
    const current = await request('camps.snapshot', { campId })
    const runs = current.agentRuns.filter((run) => runIds.includes(run.id))
    const runActionIds = new Set(current.actions
      .filter((action) => selectedRunIds.has(action.agentRunId))
      .map((action) => action.id))
    const pendingApprovals = current.approvals.filter((approval) =>
      approval.status === 'pending'
        && !resolvedApprovals.has(approval.id)
        && (selectedRunIds.has(approval.agentRunId) || runActionIds.has(approval.actionId)))
    for (const approval of pendingApprovals) {
      const option = approval.options.find((candidate) => candidate.kind === 'allow_once')
      if (!option) {
        throw new Error(`Approval ${approval.id} has no one-shot allow option`)
      }
      const resolution = await request('action.approvals.resolve', {
        commandId: crypto.randomUUID(),
        campId,
        approvalId: approval.id,
        expectedVersion: approval.version,
        optionId: option.optionId,
        reason: 'Isolated real-Runtime Memory Camp diagnostic'
      })
      if (resolution.status === 'rejected') {
        throw new Error(`Approval ${approval.id} was rejected: ${JSON.stringify(resolution)}`)
      }
      resolvedApprovals.add(approval.id)
    }
    lastState = {
      runs: runs.map(runSummary),
      pendingApprovalIds: pendingApprovals.map((approval) => approval.id),
      resolvedApprovalCount: resolvedApprovals.size,
      inputDeliveryUnknown: current.timeline
        .filter((event) => event.eventType === 'runtime.input_delivery_unknown'
          && selectedRunIds.has(event.sourceAgentRunId))
        .map((event) => ({
          sourceAgentRunId: event.sourceAgentRunId,
          payload: event.payload
        }))
    }
    if (runs.some((run) => run.status === 'failed' || run.status === 'cancelled')) {
      throw new Error(`AgentRun failed: ${JSON.stringify(runs.map(runSummary))}`)
    }
    for (const run of runs) {
      if (run.status !== 'waiting' || run.waitReason !== 'delivery_unknown') {
        deliveryUnknownSince.delete(run.id)
        continue
      }
      const firstObservedAt = deliveryUnknownSince.get(run.id) ?? Date.now()
      deliveryUnknownSince.set(run.id, firstObservedAt)
      if (Date.now() - firstObservedAt >= deliveryUnknownGraceMs) {
        throw new Error(
          `AgentRun input delivery remained unknown: ${JSON.stringify(redactDeep(lastState))}`
        )
      }
    }
    return runs.length === runIds.length && runs.every((run) => run.status === 'succeeded')
      ? current
      : null
  }, `AgentRuns ${runIds.join(', ')}`, runTimeoutMs, () => lastState)

  return {
    runIds,
    resolvedApprovalCount: resolvedApprovals.size,
    outputs: snapshot.messages
      .filter((message) => runIds.includes(message.sourceAgentRunId))
      .map((message) => redact(message.body))
  }
}

async function snapshotMemory(request) {
  const [library, pendingReviewItems] = await Promise.all([
    request('memory.list'),
    request('memory.hearthReviewItems.list')
  ])
  const summaries = Array.isArray(library?.memories) ? library.memories : []
  const memories = await Promise.all(summaries.map(async (summary) => {
    try {
      const full = await request('memory.get', { memoryId: summary.id })
      return { ...summary, ...full }
    } catch {
      return summary
    }
  }))
  return {
    memories,
    agentMemories: memories.filter((memory) =>
      memory.creationOrigin === 'agent' && memory.lifecycle === 'active'),
    pendingReviewItems: Array.isArray(pendingReviewItems) ? pendingReviewItems : []
  }
}

function memoryDelta(before, after) {
  const beforeMemoryIds = new Set(before.memories.map((memory) => memory.id))
  const beforeReviewIds = new Set(before.pendingReviewItems.map((item) => item.id ?? item.reviewItemId))
  const newMemories = after.memories.filter((memory) => !beforeMemoryIds.has(memory.id))
  const revisedMemories = after.memories.filter((memory) => {
    const previous = before.memories.find((candidate) => candidate.id === memory.id)
    return previous && previous.currentRevisionId !== memory.currentRevisionId
  })
  const newPendingReviewItems = after.pendingReviewItems.filter((item) =>
    !beforeReviewIds.has(item.id ?? item.reviewItemId))
  return {
    newActiveAgentMemories: newMemories
      .filter((memory) => memory.creationOrigin === 'agent' && memory.lifecycle === 'active')
      .map(sanitizeMemory),
    revisedAgentMemories: revisedMemories
      .filter((memory) => memory.creationOrigin === 'agent')
      .map(sanitizeMemory),
    newPendingHearthReviewCount: newPendingReviewItems.length
  }
}

function evaluate({ baseline, phases, finalMemory, recall }) {
  const natural = phases.find((phase) => phase.name === 'natural_discovery')
  const stewarded = phases.find((phase) => phase.name === 'stewarded_batch')
  const agentTexts = finalMemory.agentMemories.map(memoryText)
  const allTexts = [
    ...finalMemory.memories.map(memoryText),
    ...finalMemory.pendingReviewItems.map((item) => collectStrings(item).join('\n'))
  ]
  const pendingDelta = phases.reduce((sum, phase) =>
    sum + (phase.delta?.newPendingHearthReviewCount ?? 0), 0)

  const naturalCaptured = natural
    ? natural.delta.newPendingHearthReviewCount > 0
      || natural.delta.newActiveAgentMemories.some((memory) =>
        containsConcept(memoryText(memory), ['结论', '命令', '解释']))
      || natural.delta.revisedAgentMemories.some((memory) =>
        containsConcept(memoryText(memory), ['结论', '命令', '解释']))
    : null

  const correctedPreferencePresent = agentTexts.some((text) =>
    containsConcept(text, ['结论', '阻断'])
      && containsAny(text, ['建议', '改进']))
  const reusableLessonPresent = agentTexts.some((text) =>
    containsConcept(text, ['最新', '用户'])
      && containsAny(text, ['旧约束', '冲突', '失效']))
  const secretLeak = allTexts.some((text) =>
    text.includes('sk-camp-memory-test-secret') || text.includes('43127'))
  const duplicateRiskCount = agentTexts.filter((text) =>
    containsConcept(text, ['测试', '结果', '提交'])).length
  const recallText = recall?.outputs?.join('\n') ?? ''
  const recallOutputMatched = recall
    ? containsConcept(recallText, ['结论', '阻断'])
      && containsAny(recallText, ['建议', '改进'])
    : null
  const recallPassed = recall
    ? correctedPreferencePresent && recallOutputMatched
    : null
  const stewardedCapturedCount = stewarded
    ? stewarded.delta.newActiveAgentMemories.length
      + stewarded.delta.revisedAgentMemories.length
      + stewarded.delta.newPendingHearthReviewCount
    : 0

  const stewardedEffectiveCount = stewarded
    ? stewarded.delta.newActiveAgentMemories.length
      + stewarded.delta.revisedAgentMemories.length
    : 0
  const stewardedPendingCount = stewarded?.delta.newPendingHearthReviewCount ?? 0
  const unsupportedPersistenceClaim = [natural, stewarded]
    .filter(Boolean)
    .some((phase) => {
      const changed = phase.delta.newActiveAgentMemories.length
        + phase.delta.revisedAgentMemories.length
        + phase.delta.newPendingHearthReviewCount
      return changed === 0 && containsAny(phase.outputs.join('\n'), [
        '已保存',
        '已记住',
        '已经保存',
        '已经记住',
        'saved to memory',
        'recorded in memory'
      ])
    })

  const diagnosis = unsupportedPersistenceClaim
    ? 'The Runtime claimed Memory persistence without any durable write or review evidence.'
    : natural && stewarded
      ? naturalCaptured
      ? 'Natural discovery and stewarded execution both produced evidence.'
      : stewardedEffectiveCount === 0 && stewardedPendingCount > 0
        ? 'Camp capture triggered, but candidates were routed to Hearth review_pending rather than active Memory.'
        : stewardedCapturedCount > 0
          ? 'Memory transport works, but autonomous Skill discovery/triggering is weak.'
          : 'No Camp capture evidence; inspect Runtime Skill projection, Agent-write setting, CLI lease, and review queue.'
      : stewarded && stewardedCapturedCount === 0
        ? 'Stewarded Camp produced no capture evidence; this is below the existing forced-runtime smoke layer.'
        : stewarded && stewardedCapturedCount > 0
          ? 'Stewarded execution produced Memory evidence; natural discovery was not run.'
        : natural && naturalCaptured
          ? 'Natural discovery produced Memory evidence; stewarded execution was not run.'
        : natural && !naturalCaptured
          ? 'Natural Camp produced no capture evidence; best-effort discovery did not trigger.'
          : 'Insufficient comparison data.'

  const requiredChecks = [
    stewarded ? stewardedCapturedCount > 0 : true,
    stewarded ? correctedPreferencePresent : true,
    stewarded && suite !== 'probe' && suite !== 'capture' ? reusableLessonPresent : true,
    !secretLeak,
    !unsupportedPersistenceClaim,
    recall ? recallPassed : true,
    suite === 'full' ? duplicateRiskCount <= 1 : true
  ]

  return {
    baselineMemoryCount: baseline.memories.length,
    finalActiveAgentMemoryCount: finalMemory.agentMemories.length,
    pendingHearthReviewDelta: pendingDelta,
    naturalCaptured,
    stewardedCapturedCount,
    correctedPreferencePresent,
    reusableLessonPresent: suite === 'probe' || suite === 'capture'
      ? null
      : reusableLessonPresent,
    secretOrTransientLeak: secretLeak,
    relationshipDuplicateRiskCount: suite === 'full' ? duplicateRiskCount : null,
    unsupportedPersistenceClaim,
    crossCampRecallOutputMatched: recallOutputMatched,
    crossCampRecallPassed: recallPassed,
    strictPassed: requiredChecks.every(Boolean),
    diagnosis
  }
}

function sanitizeMemory(memory) {
  return {
    id: memory.id,
    lifecycle: memory.lifecycle,
    scope: memory.scope,
    kind: memory.kind,
    creationOrigin: memory.creationOrigin,
    version: memory.version,
    currentRevisionId: memory.currentRevisionId,
    currentBody: redact(memory.currentBody),
    currentRetrievalKeys: Array.isArray(memory.currentRetrievalKeys)
      ? memory.currentRetrievalKeys.map(redact)
      : [],
    sourceAgentRunIds: Array.isArray(memory.revisions)
      ? memory.revisions.map((revision) => revision.sourceAgentRunId).filter(Boolean)
      : []
  }
}

function memoryText(memory) {
  const bodiesAndKeys = [
    memory.currentBody,
    ...(Array.isArray(memory.currentRetrievalKeys) ? memory.currentRetrievalKeys : []),
    ...(Array.isArray(memory.revisions)
      ? memory.revisions.flatMap((revision) => [
          revision.body,
          ...(Array.isArray(revision.retrievalKeys) ? revision.retrievalKeys : [])
        ])
      : [])
  ]
  return bodiesAndKeys.filter((value) => typeof value === 'string').join('\n')
}

function redact(value) {
  if (typeof value !== 'string') return value ?? null
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_TEST_SECRET]')
    .replaceAll('43127', '[REDACTED_TRANSIENT_PORT]')
}

function containsConcept(text, terms) {
  const normalized = String(text).toLowerCase()
  return terms.every((term) => normalized.includes(String(term).toLowerCase()))
}

function containsAny(text, terms) {
  const normalized = String(text).toLowerCase()
  return terms.some((term) => normalized.includes(String(term).toLowerCase()))
}

function collectStrings(value, output = []) {
  if (typeof value === 'string') {
    output.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, output)
  }
  return output
}

function requireAccepted(result, label, expectedCampId = null) {
  const campId = result.payload?.campId ?? expectedCampId
  if (result.status !== 'accepted' || !campId || !Array.isArray(result.payload?.agentRunIds)
      || result.payload.agentRunIds.length === 0) {
    throw new Error(`${label} was not accepted: ${JSON.stringify(result)}`)
  }
  return campId
}

function runSummary(run) {
  return {
    id: run.id,
    agentId: run.agentId,
    status: run.status,
    waitReason: run.waitReason,
    failure: run.failure,
    runtimeModel: run.runtimeModel
  }
}

function startCore(dataDirectory, environment = {}) {
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), [
    '--data-dir', dataDirectory,
    '--skill-library-root', join(dataDirectory, 'managed-skill-library')
  ], {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  if (process.env.ROVAI_MEMORY_CAMP_VERBOSE_CORE === '1') {
    child.stderr.on('data', (chunk) => process.stderr.write(redact(String(chunk))))
  } else {
    child.stderr.resume()
  }
  const pending = new Map()
  const events = []
  let nextId = 1
  let stopped = false

  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  child.once('error', rejectPending)
  child.once('close', (code, signal) => {
    if (!stopped) {
      rejectPending(new Error(`rovai-core exited early (code=${code}, signal=${signal})`))
    }
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      rejectPending(new Error(`rovai-core emitted invalid JSON: ${safeError(error).message}`))
      return
    }
    if (message.method) {
      if (message.method === 'agent_run.started') events.push(message)
      return
    }
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })

  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`Timed out waiting for ${method}`))
    }, 90_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })

  const stop = async () => {
    if (child.killed || child.exitCode !== null) return
    stopped = true
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3_000))
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
  }

  return { request, stop, events }
}

async function waitFor(probe, label, timeoutMs, describeLastState) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Timed out waiting for ${label}; lastState=${JSON.stringify(describeLastState())}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function positiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

async function prepareProject() {
  await mkdir(projectRoot, { recursive: true })
  await writeFile(join(projectRoot, 'README.md'), [
    '# Isolated Memory Camp diagnostic workspace',
    '',
    'This Git repository is disposable and contains no product source code.',
    ''
  ].join('\n'))
  await runCommand('git', ['init', '-b', 'main'], projectRoot)
  await runCommand('git', ['config', 'user.name', 'Rovai Memory Diagnostic'], projectRoot)
  await runCommand('git', ['config', 'user.email', 'memory-diagnostic@rovai.local'], projectRoot)
  await runCommand('git', ['add', 'README.md'], projectRoot)
  await runCommand('git', ['commit', '-m', 'fixture'], projectRoot)
}

function runCommand(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code) => code === 0
      ? resolveRun(stdout.join(''))
      : rejectRun(new Error(`${command} failed (${code}): ${stderr.join('')}`)))
  })
}

async function ensureRuntimeMember(request, kind, index) {
  const label = runtimeLabel(kind)
  const displayName = index === 0 ? `Memory · ${label}` : `Memory · ${label} Worker`
  const existing = (await request('members.list')).find((member) =>
    member.displayName === displayName && member.presence !== 'removed')
  if (existing) return existing.agentId

  const created = await request('members.create', {
    commandId: crypto.randomUUID(),
    command: {
      displayName,
      teamRole: `${label} Memory Runtime`,
      professionalResponsibilities: 'Persist one real-Runtime Memory diagnostic result in the combined fixture.',
      personalityTraits: ['Precise', 'Auditable'],
      workingPrinciples: 'Use only the selected Runtime and preserve exact Memory scope.',
      growthTopic: ''
    }
  })
  const agentId = created.resultEntity?.entityId
  if (created.status !== 'applied' || !agentId) {
    throw new Error(`Combined fixture member creation failed: ${JSON.stringify({
      adapterKind: kind,
      displayName,
      created
    })}`)
  }
  return agentId
}

function campName(baseName) {
  return sharedDataDir ? `[${runtimeLabel(adapterKind)}] ${baseName}` : baseName
}

function runtimeLabel(kind) {
  return ({
    'codex-cli': 'Codex',
    'opencode-cli': 'OpenCode',
    'copilot-cli': 'GitHub Copilot',
    'claude-code-cli': 'Claude Code',
    'antigravity-app': 'Antigravity',
    'kiro-cli': 'Kiro',
    'qoder-cli': 'Qoder',
    'codebuddy-cli': 'CodeBuddy',
    'qwen-code': 'Qwen Code',
    'trae-cn-cli': 'TRAE CLI CN'
  })[kind] ?? kind
}

async function persistReport() {
  if (!reportPath) return
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(redactDeep(report), null, 2)}\n`)
}

function runtimeEnvironment(kind) {
  if (kind !== 'claude-code-cli') return {}
  return {
    ANTHROPIC_MODEL: process.env.ROVAI_MEMORY_CAMP_CLAUDE_MODEL?.trim() || 'sonnet'
  }
}

async function configureDiagnosticModel(request, installation, configuredAgents) {
  const explicitModelId = diagnosticModel(adapterKind)
  if (!explicitModelId) {
    const configured = installation?.memberRuntimeDefaults?.model ?? { mode: 'runtime_default' }
    return adapterKind === 'claude-code-cli'
      ? {
          ...configured,
          environmentModel: process.env.ROVAI_MEMORY_CAMP_CLAUDE_MODEL?.trim() || 'sonnet'
        }
      : configured
  }
  if (!installation?.snapshot?.models?.some((model) => model.id === explicitModelId)) {
    throw new Error(`${adapterKind} diagnostic model is unavailable: ${explicitModelId}`)
  }
  for (const agentId of configuredAgents) {
    const profile = await request('members.get', { agentId })
    const configured = await request('members.runtime.set', {
      commandId: crypto.randomUUID(),
      command: {
        agentId,
        expectedVersion: profile.version,
        adapterKind,
        model: { mode: 'explicit', modelId: explicitModelId, options: {} },
        permissions: profile.runtimeConfiguration?.permissions
          ?? installation.memberRuntimeDefaults.permissions
      }
    })
    if (configured.status !== 'applied') {
      throw new Error(`${adapterKind} diagnostic model was rejected: ${JSON.stringify(configured)}`)
    }
    const resolved = await request('members.get', { agentId })
    if (resolved.runtimeConfiguration?.model?.modelId !== explicitModelId) {
      throw new Error(`${adapterKind} diagnostic model was not frozen for ${agentId}`)
    }
  }
  return { mode: 'explicit', modelId: explicitModelId, options: {} }
}

function diagnosticModel(kind) {
  const overrideKey = `ROVAI_MEMORY_CAMP_MODEL_${kind.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`
  const override = process.env[overrideKey]?.trim()
  if (override) return override
  return ({
    'opencode-cli': 'opencode/mimo-v2.5-free',
    'qoder-cli': 'deepseek/deepseek-v4-flash-pg',
    'codebuddy-cli': 'deepseek-v4-flash',
    'qwen-code': 'deepseek-v4-flash(openai)'
  })[kind] ?? null
}

function observedModels(events) {
  const counts = new Map()
  for (const event of events) {
    if (event.method !== 'agent_run.started') continue
    const key = JSON.stringify({
      adapterKind: event.params?.adapterKind ?? adapterKind,
      modelId: event.params?.modelId ?? null
    })
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].map(([key, runCount]) => ({ ...JSON.parse(key), runCount }))
}

function safeError(error) {
  const source = error instanceof Error ? error : new Error(String(error))
  return {
    name: source.name,
    message: redact(source.message),
    stack: redact(source.stack)
  }
}

function redactDeep(value) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(redactDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactDeep(child)]))
  }
  return value
}
