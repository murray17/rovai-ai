import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureCodexRuntime } from './configure-codex-runtime.mjs'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

const root = resolve(import.meta.dirname, '..')
const coreExecutable = process.env.ROVAI_CORE_EXECUTABLE
  ? resolve(process.env.ROVAI_CORE_EXECUTABLE)
  : join(root, 'target', 'debug', 'rovai-core')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-team-context-smoke-'))
const sourceAdapterKind = process.env.ROVAI_TEAM_SOURCE_ADAPTER ?? 'codex-cli'
const targetAdapterKind = process.env.ROVAI_TEAM_TARGET_ADAPTER ?? 'codex-cli'
const usesAntigravity = sourceAdapterKind === 'antigravity-app' || targetAdapterKind === 'antigravity-app'
const antigravityTeamPrivateDirectory = process.env.ROVAI_ANTIGRAVITY_TEAM_PRIVATE_DIR
  ? resolve(process.env.ROVAI_ANTIGRAVITY_TEAM_PRIVATE_DIR)
  : usesAntigravity ? null : join(fixtureRoot, 'antigravity-team-private')
const dataDir = join(fixtureRoot, 'data')
const runtimeToolName = (adapterKind, canonicalName) => adapterKind === 'antigravity-app'
  ? canonicalName.replace(/^team\./, '').replaceAll('.', '_')
  : canonicalName
const sourceCallMember = runtimeToolName(sourceAdapterKind, 'team.call_member')
const sourceCreateTask = runtimeToolName(sourceAdapterKind, 'team.create_task')
const targetCallMember = runtimeToolName(targetAdapterKind, 'team.call_member')
const targetCreateTask = runtimeToolName(targetAdapterKind, 'team.create_task')
const targetListTasks = runtimeToolName(targetAdapterKind, 'team.list_tasks')
const targetUpdateTask = runtimeToolName(targetAdapterKind, 'team.update_task')
const supportedAdapters = ['codex-cli', 'opencode-cli', 'copilot-cli', 'claude-code-cli', 'antigravity-app']
const targetCanContinueA2a = true
const repeatSourceCall = process.env.ROVAI_TEAM_REPEAT_SOURCE_CALL === '1'
const verifyTaskTools = process.env.ROVAI_TEAM_TASK_TOOL_DISCOVERY === '1'
const verifyTaskHandoff = process.env.ROVAI_TEAM_TASK_HANDOFF === '1'
const verifyBuiltInCatalog = process.env.ROVAI_TEAM_BUILTIN_CATALOG === '1'
const handoffTaskTitle = `TASK_HANDOFF_${sourceAdapterKind}_TO_${targetAdapterKind}`
let core = null
let antigravityConfigGuard = null

try {
  if (sourceAdapterKind === 'antigravity-app' || targetAdapterKind === 'antigravity-app') {
    antigravityConfigGuard = await prepareAntigravityConfigGuard()
  }
  core = startCore(dataDir)
  if (!supportedAdapters.includes(sourceAdapterKind)
      || !supportedAdapters.includes(targetAdapterKind)) {
    throw new Error(`Unsupported Rovai-ai Team Adapter pair: ${sourceAdapterKind} -> ${targetAdapterKind}`)
  }
  if (sourceAdapterKind === 'antigravity-app' || targetAdapterKind === 'antigravity-app') {
    const status = await core.request('runtime.antigravityTeam.grantPermission')
    if (status.managedConfig !== 'ready' || status.permission !== 'ready') {
      throw new Error(`Antigravity Team attachment could not be enabled: ${JSON.stringify(status)}`)
    }
  }
  const health = await core.request('health.check')
  for (const runtimeKind of new Set([sourceAdapterKind, targetAdapterKind])) {
    await core.request('runtime.product.check', { runtimeKind })
    await waitFor(async () => {
      const installation = (await core.request('runtime.installations.list')).find((candidate) =>
        candidate.adapterKind === runtimeKind
          && candidate.installationClass === 'managed_default'
          && candidate.authScope === 'default'
      )
      return installation?.snapshot?.probeStatus === 'ready'
        && (runtimeKind !== 'antigravity-app'
          || (installation.snapshot.capabilities.includes('team_tool.call_member')
            && installation.snapshot.capabilities.includes('built_in_mcp_tool_parity.complete')))
        ? installation
        : null
    }, `${runtimeKind} capability refresh`, 120_000)
  }
  const codexAgents = []
  if (sourceAdapterKind === 'codex-cli') codexAgents.push('agent_1')
  if (targetAdapterKind === 'codex-cli') codexAgents.push('agent_2')
  const codexInstallation = codexAgents.length > 0
    ? await configureCodexRuntime(core.request, health, codexAgents)
    : null
  const sourceInstallation = sourceAdapterKind === 'codex-cli'
    ? codexInstallation
    : await configureProductRuntime(core.request, sourceAdapterKind, ['agent_1'])
  const targetInstallation = targetAdapterKind === 'codex-cli'
    ? codexInstallation
    : await configureProductRuntime(core.request, targetAdapterKind, ['agent_2'])
  if (sourceAdapterKind === 'antigravity-app') {
    await configureAntigravityProductionRuntime(core.request, 'agent_1')
  }
  if (targetAdapterKind === 'antigravity-app') {
    await configureAntigravityProductionRuntime(core.request, 'agent_2')
  }
  const sourceRuntimeVersion = sourceInstallation.snapshot.reportedVersion
  const targetRuntimeVersion = targetInstallation.snapshot.reportedVersion
  let unboundAntigravity = null
  if (sourceAdapterKind === 'antigravity-app' || targetAdapterKind === 'antigravity-app') {
    const antigravityInstallation = sourceAdapterKind === 'antigravity-app'
      ? sourceInstallation
      : targetInstallation
    unboundAntigravity = await verifyUnboundBridgeLeavesDomainUntouched(
      dataDir,
      antigravityInstallation.executablePath
    )
  }
  const preflight = await core.request('camps.creationPreflight')
  if (!preflight.admissible
      || preflight.presentMembers.filter((member) => member.runtimeConfigured).length < 2) {
    throw new Error(`Two ready members were not available: ${JSON.stringify(preflight)}`)
  }

  const firstMessageBody = verifyTaskHandoff
    ? [
        '执行 Rovai-ai Task 分配与 A2A 唤醒验收。必须严格按顺序调用工具：',
        `1. ${sourceCreateTask}：title=${handoffTaskTitle}，description=durable handoff smoke，assigneeAgentId=agent_2。`,
        `2. 确认创建成功后调用一次 ${sourceCallMember}；Task 分配本身不会唤醒接收者。`,
        `${sourceCallMember} 的 recipient 使用 agent_2，content 使用下面完整内容，taskId 使用刚创建的真实 Task ID：`,
        `请执行 Task 交接验收。先调用 ${targetListTasks} 找到 title=${handoffTaskTitle} 的 Task并读取 id/version；Member Call 已把关联 Task 推进为 in_progress，直接使用读取到的当前 version 调用 ${targetUpdateTask} 将 status 更新为 completed。所有工具成功后只回复 B_TASK_DONE，不要发送其他消息。`,
        '两个源端工具成功后只回复 ROOT_QUEUED。'
      ].join('\n')
    : targetCanContinueA2a ? [
        `执行 A2A 独立双向调用验收。你必须且只能调用一次 ${sourceCallMember}，不要调用其他工具。`,
        'MCP Server 名为 rovai_team；如果工具被延迟加载，先使用你的原生工具发现能力查找它，不要在查找前声称工具不可用。',
        'recipient 使用 agent_2。',
        'content 使用下面完整内容：',
        `请完成分析并把集成方正在等待的必要结果交给 agent_1。完成分析后，你必须且只能调用一次 ${targetCallMember}，不要调用其他业务工具。MCP Server 名为 rovai_team；如果工具被延迟加载，先使用原生工具发现能力查找 ${targetCallMember}，不得在查找前声称不可用。recipient 使用 agent_1；content 必须逐字等于下面引号内的完整句子，不得只发送 marker："A2A_CHAIN_RESULT_OK；这是你继续集成决策所需的结果。收到后不要调用任何工具，只回复 A2A_CHAIN_COMPLETE。"工具成功后只回复 B_RESULT_SENT。`,
        '你的工具成功后只回复 ROOT_QUEUED。'
      ].join('\n')
      : [
        `执行 Antigravity A2A 接收验收。你必须且只能调用一次 ${sourceCallMember}，不要调用其他工具。`,
        'MCP Server 名为 rovai_team；如果工具被延迟加载，先使用你的原生工具发现能力查找它。',
        'recipient 使用 agent_2。',
        'content 必须是：不要调用任何工具，只回复 ANTIGRAVITY_A2A_RECEIVED。',
        '工具成功后只回复 ROOT_QUEUED。'
      ].join('\n')
  const firstResponse = await createConfiguredCampAndSend(core.request, {
    commandId: crypto.randomUUID(),
    workspace: null,
    body: firstMessageBody,
    purpose: verifyTaskHandoff
      ? 'Create one durable Task, explicitly wake its assignee, and let the assignee complete it.'
      : 'Use the Rovai-ai Team Tool to request one teammate action and then stop delegating.',
    expectedOutput: verifyTaskHandoff
      ? 'One completed assigned Task, one explicit A2A request, and ROOT_QUEUED.'
      : 'One queued teammate request followed by ROOT_QUEUED.'
  })
  const first = firstResponse.commandResult ?? firstResponse
  if (first.status !== 'accepted') {
    throw new Error(`Camp intake was not accepted: ${JSON.stringify(firstResponse)}`)
  }

  const campId = first.payload.campId
  const rootRunId = first.payload.agentRunIds?.[0]
  if (!rootRunId) throw new Error(`Camp intake returned no root AgentRun: ${JSON.stringify(first)}`)
  let lastChainState = null
  let snapshot
  try {
    snapshot = await waitFor(async () => {
      const candidate = await core.request('camps.snapshot', { campId })
      const turn = candidate.turns.find((item) => item.id === first.payload.campTurnId)
      const chainRuns = candidate.agentRuns.filter((run) =>
        run.id === rootRunId || run.a2aRootAgentRunId === rootRunId
      )
      lastChainState = {
        turn,
        chainRuns,
        inboxMessages: candidate.inboxMessages,
        tasks: candidate.tasks,
        messages: candidate.messages.slice(-8),
        timeline: candidate.timeline.slice(-12)
      }
      if (chainRuns.some((run) => run.status === 'failed' || run.status === 'cancelled')) {
        throw new Error(`A2A AgentRun failed: ${JSON.stringify(lastChainState)}`)
      }
      if (chainRuns.find((run) => run.id === rootRunId)?.status === 'succeeded'
          && candidate.inboxMessages.length === 0) {
        throw new Error(`Root AgentRun completed without calling team.call_member: ${JSON.stringify(lastChainState)}`)
      }
      if (!verifyTaskHandoff && targetCanContinueA2a && candidate.inboxMessages.length === 1
          && chainRuns.some((run) => run.a2aDepth === 1 && run.status === 'succeeded')) {
        throw new Error(`Target AgentRun completed without sending the integration result required by this scenario: ${JSON.stringify(lastChainState)}`)
      }
      const expectedInboxCount = verifyTaskHandoff || !targetCanContinueA2a ? 1 : 2
      const expectedRunCount = verifyTaskHandoff || !targetCanContinueA2a ? 2 : 3
      if (candidate.inboxMessages.length > expectedInboxCount || chainRuns.length > expectedRunCount) {
        throw new Error(`A2A chain exceeded its bounded hop count: ${JSON.stringify(lastChainState)}`)
      }
      return candidate.inboxMessages.length === expectedInboxCount
        && chainRuns.length === expectedRunCount
        && chainRuns.every((run) => run.status === 'succeeded')
        && turn?.status === 'completed'
        ? candidate
        : null
    }, verifyTaskHandoff
      ? 'Task assignment followed by explicit A→B wake'
      : targetCanContinueA2a ? 'A→B→A Team Tool chain' : 'A→Antigravity A2A receive',
    300_000)
  } catch (error) {
    throw new Error(`${error.message}; lastState=${JSON.stringify(lastChainState)}`)
  }

  if (snapshot.schemaVersion !== 19) {
    throw new Error(`Camp Snapshot did not use Read Model schema v19: ${snapshot.schemaVersion}`)
  }
  const [requestMessage, replyMessage] = snapshot.inboxMessages.slice().reverse()
  if (requestMessage.senderAgentId !== 'agent_1'
      || requestMessage.recipientAgentId !== 'agent_2') {
    throw new Error(`A2A request linkage is invalid: ${JSON.stringify(snapshot.inboxMessages)}`)
  }
  if (!verifyTaskHandoff && targetCanContinueA2a
      && (replyMessage.senderAgentId !== 'agent_2'
        || replyMessage.recipientAgentId !== 'agent_1'
        || replyMessage.body !== 'A2A_CHAIN_RESULT_OK；这是你继续集成决策所需的结果。收到后不要调用任何工具，只回复 A2A_CHAIN_COMPLETE。')) {
    throw new Error(`Independent reverse-call linkage is invalid: ${JSON.stringify(snapshot.inboxMessages)}`)
  }

  const chainRuns = snapshot.agentRuns
    .filter((run) => run.id === rootRunId || run.a2aRootAgentRunId === rootRunId)
  const rootChainRun = chainRuns.find((run) => run.id === rootRunId)
  const targetRun = chainRuns.find((run) => run.a2aDepth === 1)
  const integrationRun = chainRuns.find((run) => run.id !== rootRunId
    && run.conversationId === rootChainRun?.conversationId)
  if (!rootChainRun
      || !targetRun
      || targetRun.a2aParentAgentRunId !== rootRunId
      || ((!verifyTaskHandoff && targetCanContinueA2a)
        && (!integrationRun
          || integrationRun.a2aDepth !== 2
          || integrationRun.a2aParentAgentRunId !== targetRun.id
          || integrationRun.a2aRootAgentRunId !== rootRunId))) {
    throw new Error(`A2A Run ancestry is invalid: ${JSON.stringify(chainRuns)}`)
  }
  const requestInput = snapshot.conversationInputs.find(
    (input) => input.sourceInboxMessageId === requestMessage.id
  )
  const replyInput = replyMessage
    ? snapshot.conversationInputs.find((input) => input.sourceInboxMessageId === replyMessage.id)
    : null
  const expectedInputCount = verifyTaskHandoff || !targetCanContinueA2a ? 1 : 2
  if (snapshot.conversationInputs.length !== expectedInputCount
      || snapshot.conversationInputs.some((input) => (
        input.status !== 'materialized'
        || !input.consumingAgentRunId
      ))
      || requestInput?.consumingAgentRunId !== targetRun.id
      || ((!verifyTaskHandoff && targetCanContinueA2a)
        && replyInput?.consumingAgentRunId !== integrationRun?.id)) {
    throw new Error(`Durable Member Call state is invalid: ${JSON.stringify({
      conversationInputs: snapshot.conversationInputs,
      chainRuns
    })}`)
  }
  if (!targetCanContinueA2a) {
    const targetMessage = snapshot.messages.find(
      (message) => message.sourceAgentRunId === targetRun.id
    )
    if (targetMessage?.body.trim() !== 'ANTIGRAVITY_A2A_RECEIVED') {
      throw new Error(`Antigravity A2A target did not return the expected leaf result: ${JSON.stringify({
        targetRun,
        targetMessage
      })}`)
    }
  }

  const manifests = snapshot.contextManifests.filter((manifest) =>
    chainRuns.some((run) => run.id === manifest.agentRunId)
  )
  if (manifests.length !== (verifyTaskHandoff || !targetCanContinueA2a ? 2 : 3)
      || manifests.some((manifest) => manifest.delivery?.status !== 'accepted')) {
    throw new Error(`Frozen context was not accepted for every chain Run: ${JSON.stringify(manifests)}`)
  }
  if (snapshot.contextCompactions.length !== 0) {
    throw new Error(`Small context was compressed without a budget trigger: ${JSON.stringify(snapshot.contextCompactions)}`)
  }
  let taskHandoff = null
  if (verifyTaskHandoff) {
    const handoffTasks = snapshot.tasks.filter((task) => task.title === handoffTaskTitle)
    const handoffTask = handoffTasks[0]
    if (handoffTasks.length !== 1
        || handoffTask?.status !== 'completed'
        || handoffTask.assigneeAgentId !== 'agent_2'
        || handoffTask.sourceAgentRunId !== rootRunId
        || handoffTask.version !== 3
        || snapshot.agentRuns.length !== 2) {
      throw new Error(`Task handoff did not preserve explicit wake boundaries: ${JSON.stringify({
        handoffTasks,
        agentRuns: snapshot.agentRuns,
        inboxMessages: snapshot.inboxMessages
      })}`)
    }
    taskHandoff = {
      taskId: handoffTask.id,
      sourceAgentRunId: handoffTask.sourceAgentRunId,
      assigneeAgentId: handoffTask.assigneeAgentId,
      status: handoffTask.status,
      version: handoffTask.version,
      taskAssignmentCreatedNoExtraRun: true
    }
  }

  let repeatedSourceCall = null
  if (repeatSourceCall) {
    const repeated = await sendCampMessage(core, {
      commandId: crypto.randomUUID(),
      campId,
      body: [
        `再次执行 Team Tool 续接验收。你必须且只能调用一次 ${sourceCallMember}，不要调用其他工具。`,
        'recipient 使用 agent_2。',
        'content 必须是：只回复 SECOND_TARGET_DONE，不要调用任何工具。',
        '工具成功后只回复 SECOND_ROOT_QUEUED。'
      ].join('\n'),
      address: { mode: 'default' },
      replyToCampMessageId: null,
      execution: {
        taskId: null,
        purpose: 'Verify that a resumed Native Session can call Team Tool again.',
        expectedOutput: 'One queued teammate request followed by SECOND_ROOT_QUEUED.',
        completionRole: 'required'
      }
    })
    const repeatedRootRunId = repeated.commandResult?.payload?.agentRunIds?.[0]
    if (repeated.commandResult?.status !== 'accepted' || !repeatedRootRunId) {
      throw new Error(`Repeated source Team Tool call was not accepted: ${JSON.stringify(repeated)}`)
    }
    snapshot = await waitFor(async () => {
      const candidate = await core.request('camps.snapshot', { campId })
      const repeatedRuns = candidate.agentRuns.filter((run) =>
        run.id === repeatedRootRunId || run.a2aRootAgentRunId === repeatedRootRunId
      )
      if (repeatedRuns.some((run) => run.status === 'failed' || run.status === 'cancelled')) {
        throw new Error(`Repeated source Team Tool chain failed: ${JSON.stringify(repeatedRuns)}`)
      }
      return repeatedRuns.length === 2
        && repeatedRuns.every((run) => run.status === 'succeeded')
        && candidate.inboxMessages.length === 3
        ? candidate
        : null
    }, 'resumed source Team Tool call', 300_000)
    const repeatedRootRun = snapshot.agentRuns.find((run) => run.id === repeatedRootRunId)
    if (repeatedRootRun?.conversationId !== rootChainRun.conversationId) {
      throw new Error(`Repeated source call changed logical Conversation: ${JSON.stringify({
        original: rootChainRun,
        repeated: repeatedRootRun
      })}`)
    }
    repeatedSourceCall = {
      agentRunId: repeatedRootRunId,
      conversationId: repeatedRootRun.conversationId,
      acceptedOnResumedBinding: true
    }
  }

  let taskToolDiscovery = null
  if (verifyTaskTools) {
    const discoveryTitle = `TASK_TOOL_DISCOVERY_${targetAdapterKind}`
    const inboxCountBefore = snapshot.inboxMessages.length
    const sent = await sendCampMessage(core, {
      commandId: crypto.randomUUID(),
      campId,
      body: [
        `执行 Rovai-ai Task Tool 发现验收。必须按顺序实际调用下面三个工具，不要调用 ${targetCallMember} 或其他工具：`,
        `1. ${targetCreateTask}：title=${discoveryTitle}，description=runtime discovery smoke，不传 assigneeAgentId，创建未分配 Task。`,
        `2. ${targetListTasks}：列出 pending Task，确认刚创建的 Task 并读取它的 id 与 version。`,
        `3. ${targetUpdateTask}：使用刚才返回的 id 和 version；必须在同一次调用中传 assigneeAgentId=agent_2 且 status=completed，先认领再完成。`,
        '三个工具都成功后只回复 TASK_TOOLS_OK。'
      ].join('\n'),
      address: { mode: 'explicit', agentProfileIds: ['agent_2'] },
      replyToCampMessageId: null,
      execution: {
        taskId: null,
        purpose: `Verify ${targetAdapterKind} discovers and invokes all three Rovai-ai Task tools.`,
        expectedOutput: 'One completed smoke Task and TASK_TOOLS_OK.',
        completionRole: 'required'
      }
    })
    const discoveryRunId = sent.commandResult?.payload?.agentRunIds?.[0]
    if (sent.commandResult?.status !== 'accepted' || !discoveryRunId) {
      throw new Error(`Task Tool discovery Run was not accepted: ${JSON.stringify(sent)}`)
    }
    let lastDiscoveryState = null
    try {
      snapshot = await waitFor(async () => {
        const candidate = await core.request('camps.snapshot', { campId })
        const run = candidate.agentRuns.find((value) => value.id === discoveryRunId)
        const task = candidate.tasks.find((value) => value.title === discoveryTitle)
        lastDiscoveryState = {
          run,
          task,
          recentMessages: candidate.messages.slice(-4),
          recentEvents: candidate.timeline.slice(-8)
        }
        if (run?.status === 'failed' || run?.status === 'cancelled') {
          throw new Error(`${targetAdapterKind} Task Tool discovery failed: ${JSON.stringify(lastDiscoveryState)}`)
        }
        return run?.status === 'succeeded' && task?.status === 'completed'
          ? candidate
          : null
      }, `${targetAdapterKind} Task Tool discovery`, 300_000)
    } catch (error) {
      throw new Error(`${error.message}; lastState=${JSON.stringify(lastDiscoveryState)}`)
    }
    const task = snapshot.tasks.find((value) => value.title === discoveryTitle)
    const runManifest = snapshot.contextManifests.find((value) => value.agentRunId === discoveryRunId)
    if (!task
        || task.assigneeAgentId !== 'agent_2'
        || task.sourceAgentRunId !== discoveryRunId
        || task.version !== 2
        || snapshot.inboxMessages.length !== inboxCountBefore
        || runManifest?.formatterVersion !== 5
        || runManifest?.bootstrap?.contractVersion !== 'native_session_bootstrap_v1'
        || 'taskContextDigest' in runManifest) {
      throw new Error(`Task Tool discovery produced invalid state: ${JSON.stringify({
        task,
        inboxCountBefore,
        inboxCountAfter: snapshot.inboxMessages.length,
        runManifest
      })}`)
    }
    taskToolDiscovery = {
      adapterKind: targetAdapterKind,
      agentRunId: discoveryRunId,
      taskId: task.id,
      taskVersion: task.version,
      status: task.status,
      contextFormatterVersion: runManifest.formatterVersion,
      bootstrapEvidenceId: runManifest.bootstrap.id
    }
  }

  const builtInCatalog = verifyBuiltInCatalog
    ? await runBuiltInCatalogSmoke(core, campId, dataDir, snapshot)
    : null
  if (builtInCatalog) {
    snapshot = builtInCatalog.snapshot
  }

  const durableIdentity = {
    runIds: snapshot.agentRuns.map((run) => run.id).sort(),
    inboxIds: snapshot.inboxMessages.map((message) => message.id).sort(),
    conversationInputIds: snapshot.conversationInputs.map((input) => input.id).sort(),
    manifestIds: snapshot.contextManifests.map((manifest) => manifest.id).sort(),
  }
  await core.stop()
  core = startCore(dataDir)
  const restored = await core.request('camps.snapshot', { campId })
  const restoredIdentity = {
    runIds: restored.agentRuns
      .map((run) => run.id)
      .sort(),
    inboxIds: restored.inboxMessages.map((message) => message.id).sort(),
    conversationInputIds: restored.conversationInputs.map((input) => input.id).sort(),
    manifestIds: restored.contextManifests
      .map((manifest) => manifest.id)
      .sort(),
  }
  if (JSON.stringify(restoredIdentity) !== JSON.stringify(durableIdentity)
      || restored.agentRuns.some((run) => run.waitReason === 'delivery_unknown')) {
    throw new Error(`Restart changed or duplicated the completed chain: ${JSON.stringify({ durableIdentity, restoredIdentity })}`)
  }

  console.log(JSON.stringify({
    ok: true,
    sourceRuntime: `${sourceAdapterKind} ${sourceRuntimeVersion}`,
    targetRuntime: `${targetAdapterKind} ${targetRuntimeVersion}`,
    campId,
    campTurnId: first.payload.campTurnId,
    conversationInputCount: snapshot.conversationInputs.length,
    chain: chainRuns.map((run) => ({
      agentRunId: run.id,
      agentProfileId: run.agentProfileId,
      invocationKind: run.invocationKind,
      a2aDepth: run.a2aDepth,
      status: run.status
    })),
    contextManifestCount: manifests.length,
    conditionalCompactionCount: snapshot.contextCompactions.length,
    taskHandoff,
    repeatedSourceCall,
    taskToolDiscovery,
    builtInCatalog: builtInCatalog?.evidence ?? null,
    unboundAntigravity,
    restoredWithoutDuplication: true
  }, null, 2))
} finally {
  if (core) await core.stop()
  if (antigravityConfigGuard) await antigravityConfigGuard.restore()
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function runBuiltInCatalogSmoke(core, campId, dataDirectory, startingSnapshot) {
  const sourceTool = (canonicalName) => runtimeToolName(sourceAdapterKind, canonicalName)
  const contextAnchor = `BUILTIN_CONTEXT_ANCHOR_${crypto.randomUUID()}`
  const taskTitle = `BUILTIN_TASK_${crypto.randomUUID()}`
  const memoryKey = `m-${crypto.randomUUID().slice(0, 12)}`
  for (const segment of [1, 2]) {
    const seed = await sendCampMessage(core, {
      commandId: crypto.randomUUID(),
      campId,
      body: `${contextAnchor}_SEGMENT_${segment}\n${'summary-seed '.repeat(2_550)}`,
      address: { mode: 'default' },
      replyToCampMessageId: null,
      execution: null
    })
    const seedResult = seed.commandResult ?? seed
    if (seedResult.status !== 'applied') {
      throw new Error(`Context summary seed was not applied: ${JSON.stringify(seed)}`)
    }
  }

  const databasePath = join(dataDirectory, 'rovai.sqlite')

  if (sourceAdapterKind !== 'antigravity-app') {
    return runCredentialedSingleToolCatalogSmoke({
      core,
      campId,
      dataDirectory,
      startingSnapshot,
      contextAnchor,
      taskTitle,
      memoryKey,
      sourceTool
    })
  }

  const inboxCountBefore = startingSnapshot.inboxMessages.length
  const sent = await sendCampMessage(core, {
    commandId: crypto.randomUUID(),
    campId,
    body: [
      '执行完整 Rovai 内置 MCP 工具验收。不要运行 shell、不要读取或修改文件。必须按下面顺序实际调用工具，并使用前一步返回的真实 ID/version：',
      `1. ${sourceTool('camp.list')}：不传 query，发现当前 AgentRun 冻结的其他 Camp。`,
      `2. ${sourceTool('camp.search')}：query=${contextAnchor}；保存返回的 messageId。`,
      `3. ${sourceTool('history.search')}：query=${contextAnchor}；允许返回空 Top-K。`,
      `4. ${sourceTool('camp.read')}：campId=${campId}，mode=item，读取第 2 步的 messageId。`,
      `5. ${sourceTool('team.create_task')}：title=${taskTitle}，description=complete built-in catalog smoke，不传 assigneeAgentId。`,
      `6. ${sourceTool('team.list_tasks')}：列出 pending Task，找到刚创建的 Task并读取 id/version。`,
      `7. ${sourceTool('team.update_task')}：用该 id/version 将 status 设为 completed。`,
      `8. ${sourceTool('memory.write')}：action=add，scope=companion，kind=lesson，body="Complete built-in catalog memory ${memoryKey}"，retrievalKeys=["${memoryKey}"]。保存 memoryId。`,
      `9. ${sourceTool('memory.search')}：query=${memoryKey}，确认返回该 Memory。`,
      `10. ${sourceTool('memory.read')}：使用刚才返回的 memoryId 读取当前 Revision。`,
      `11. ${sourceTool('memory.propose_hearth')}：action=add，kind=lesson，body="Complete built-in Hearth proposal ${memoryKey}"，retrievalKeys=["${memoryKey}-hearth"]。`,
      `12. ${sourceTool('team.call_member')}：recipient=agent_2，content="不要调用任何工具，只回复 BUILTIN_LEAF_OK。"。`,
      '只有以上调用全部成功后才回复 BUILTIN_12_OK；任何一步失败都直接说明失败，不要伪造成功。'
    ].join('\n'),
    address: { mode: 'explicit', agentProfileIds: ['agent_1'] },
    replyToCampMessageId: null,
    execution: {
      taskId: null,
      purpose: 'Invoke every built-in Team, Context, and Memory operation through the source Runtime transport.',
      expectedOutput: 'Twelve distinct built-in tool identities completed with durable receipts and BUILTIN_12_OK.',
      completionRole: 'required'
    }
  })
  const result = sent.commandResult ?? sent
  const rootRunId = result.payload?.agentRunIds?.[0]
  if (result.status !== 'accepted' || !rootRunId) {
    throw new Error(`Built-in catalog Run was not accepted: ${JSON.stringify(sent)}`)
  }

  const expectedCanonicalTools = [
    'team.call_member', 'team.create_task', 'team.update_task', 'team.list_tasks',
    'camp.list', 'camp.search', 'history.search', 'camp.read',
    'memory.search', 'memory.read', 'memory.write', 'memory.propose_hearth'
  ]
  let lastState = null
  const snapshot = await waitFor(async () => {
    const candidate = await core.request('camps.snapshot', { campId })
    const rootRun = candidate.agentRuns.find((run) => run.id === rootRunId)
    const childRuns = candidate.agentRuns.filter((run) => run.a2aRootAgentRunId === rootRunId)
    const task = candidate.tasks.find((value) => value.title === taskTitle)
    const evidence = candidate.executionEvidence.filter((item) => (
      item.agentRunId === rootRunId
      && item.eventType === 'runtime.action'
      && item.phase === 'completed'
      && item.payload?.kind === 'mcp_tool_call'
    ))
    const observedTools = new Set(evidence.map((item) => item.payload?.title))
    lastState = {
      rootRun,
      childRuns,
      task,
      observedTools: [...observedTools],
      recentMessageCount: candidate.messages.length,
      recentTimelineTypes: candidate.timeline.slice(-12).map((event) => event.eventType)
    }
    if (rootRun?.status === 'failed' || rootRun?.status === 'cancelled'
        || childRuns.some((run) => run.status === 'failed' || run.status === 'cancelled')) {
      throw new Error(`Built-in catalog AgentRun failed: ${JSON.stringify(lastState)}`)
    }
    if (rootRun?.status === 'succeeded'
        && (!task || task.status !== 'completed'
          || !expectedCanonicalTools.every((tool) => observedTools.has(tool)))) {
      throw new Error(`Built-in catalog AgentRun ended before completing the catalog: ${JSON.stringify(lastState)}`)
    }
    return rootRun?.status === 'succeeded'
      && childRuns.length === 1
      && childRuns[0].status === 'succeeded'
      && task?.status === 'completed'
      && expectedCanonicalTools.every((tool) => observedTools.has(tool))
      ? candidate
      : null
  }, `real ${sourceAdapterKind} 12-tool catalog execution`, 600_000).catch((error) => {
    throw new Error(`${error.message}; lastState=${JSON.stringify(lastState)}`)
  })

  const rootOutput = snapshot.messages.find((message) => message.sourceAgentRunId === rootRunId)?.body ?? ''
  const childRun = snapshot.agentRuns.find((run) => run.a2aRootAgentRunId === rootRunId)
  const childOutput = snapshot.messages.find((message) => message.sourceAgentRunId === childRun?.id)?.body ?? ''
  const task = snapshot.tasks.find((value) => value.title === taskTitle)
  const manifest = snapshot.contextManifests.find((value) => value.agentRunId === rootRunId)
  const memoryEvidence = JSON.parse(await capture('/usr/bin/sqlite3', [
    '-json',
    databasePath,
    `SELECT
       (SELECT COUNT(*) FROM memory_revision WHERE source_agent_run_id = '${rootRunId.replaceAll("'", "''")}') AS memoryRevisions,
       (SELECT COUNT(*) FROM hearth_memory_proposal WHERE source_agent_run_id = '${rootRunId.replaceAll("'", "''")}' AND status = 'pending') AS hearthProposals;`
  ]))[0]
  if (!rootOutput.includes('BUILTIN_12_OK')
      || !childOutput.includes('BUILTIN_LEAF_OK')
      || task?.sourceAgentRunId !== rootRunId
      || task.version !== 2
      || snapshot.inboxMessages.length !== inboxCountBefore + 1
      || memoryEvidence?.memoryRevisions !== 1
      || memoryEvidence?.hearthProposals !== 1) {
    throw new Error(`Built-in catalog durable evidence is incomplete: ${JSON.stringify({
      rootOutput,
      childOutput,
      task,
      inboxCountBefore,
      inboxCountAfter: snapshot.inboxMessages.length,
      historyFenceVersion: manifest?.historyFenceVersion,
      memoryEvidence
    })}`)
  }
  return {
    snapshot,
    evidence: {
      agentRunId: rootRunId,
      catalogSize: expectedCanonicalTools.length,
      observedCanonicalTools: expectedCanonicalTools,
      taskId: task.id,
      memoryRevisions: memoryEvidence.memoryRevisions,
      hearthProposals: memoryEvidence.hearthProposals,
      a2aLeafRunId: childRun.id,
      modelAcknowledgement: 'BUILTIN_12_OK'
    }
  }
}

async function runCredentialedSingleToolCatalogSmoke({
  core,
  campId,
  dataDirectory,
  startingSnapshot,
  contextAnchor,
  taskTitle,
  memoryKey,
  sourceTool
}) {
  const runIds = []
  const observedCanonicalTools = new Set()
  let latestSnapshot = startingSnapshot
  const invoke = async (canonicalTool, instruction, marker) => {
    const sent = await sendCampMessage(core, {
      commandId: crypto.randomUUID(),
      campId,
      body: [
        '执行一个 credentialed Runtime 内置工具回归步骤。不要运行 shell、不要读取或修改文件。',
        `只调用一次 ${sourceTool(canonicalTool)}，不要调用其他工具。`,
        instruction,
        `工具成功后只回复 ${marker}；失败时说明失败，不得伪造成功。`
      ].join('\n'),
      address: { mode: 'explicit', agentProfileIds: ['agent_1'] },
      replyToCampMessageId: null,
      execution: {
        taskId: null,
        purpose: `Invoke ${canonicalTool} once through the credentialed Runtime transport.`,
        expectedOutput: `${marker} after the canonical tool succeeds.`,
        completionRole: 'required'
      }
    })
    const result = sent.commandResult ?? sent
    const runId = result.payload?.agentRunIds?.[0]
    if (result.status !== 'accepted' || !runId) {
      throw new Error(`Credentialed ${canonicalTool} Run was not accepted: ${JSON.stringify(sent)}`)
    }
    runIds.push(runId)
    latestSnapshot = await waitFor(async () => {
      const candidate = await core.request('camps.snapshot', { campId })
      const run = candidate.agentRuns.find((value) => value.id === runId)
      const tools = candidate.executionEvidence.filter((item) => (
        item.agentRunId === runId
        && item.eventType === 'runtime.action'
        && item.phase === 'completed'
        && item.payload?.kind === 'mcp_tool_call'
      )).map((item) => item.payload?.title)
      if (run?.status === 'failed' || run?.status === 'cancelled') {
        throw new Error(`Credentialed ${canonicalTool} Run failed: ${JSON.stringify({ run, tools })}`)
      }
      const output = candidate.messages.find((message) => message.sourceAgentRunId === runId)?.body ?? ''
      if (run?.status === 'succeeded' && (!tools.includes(canonicalTool) || !output.includes(marker))) {
        throw new Error(`Credentialed ${canonicalTool} Run ended early: ${JSON.stringify({ tools, output: output.slice(0, 500) })}`)
      }
      return run?.status === 'succeeded' && tools.includes(canonicalTool) && output.includes(marker)
        ? candidate
        : null
    }, `${sourceAdapterKind} ${canonicalTool}`, 300_000)
    observedCanonicalTools.add(canonicalTool)
    return { runId, snapshot: latestSnapshot }
  }

  await invoke('camp.list', '不传 query。', 'CREDENTIAL_CAMP_LIST_OK')
  const search = await invoke('camp.search', `query=${contextAnchor}。`, 'CREDENTIAL_CAMP_SEARCH_OK')
  const anchorMessage = search.snapshot.messages.find((message) => message.body.includes(contextAnchor))
  if (!anchorMessage) throw new Error('Credentialed context anchor message was not found in the authoritative snapshot')
  await invoke('history.search', `query=${contextAnchor}；允许返回空 Top-K。`, 'CREDENTIAL_HISTORY_SEARCH_OK')
  await invoke(
    'camp.read',
    `campId=${campId}，mode=item，messageId=${anchorMessage.id}。`,
    'CREDENTIAL_CAMP_READ_OK'
  )

  const created = await invoke(
    'team.create_task',
    `title=${taskTitle}，description=credentialed single-tool regression，assigneeAgentId=agent_1。`,
    'CREDENTIAL_TASK_CREATE_OK'
  )
  const task = created.snapshot.tasks.find((value) => value.title === taskTitle)
  if (!task) throw new Error('Credentialed create_task did not create the authoritative Task')
  await invoke('team.list_tasks', `statuses=["pending"]；确认列表包含 id=${task.id}。`, 'CREDENTIAL_TASK_LIST_OK')
  const updated = await invoke(
    'team.update_task',
    `taskId=${task.id}，expectedVersion=${task.version}，将 status 更新为 completed。`,
    'CREDENTIAL_TASK_UPDATE_OK'
  )

  const memoryWrite = await invoke(
    'memory.write',
    `action=add，scope=companion，kind=lesson，body="Credentialed single-tool memory ${memoryKey}"，retrievalKeys=["${memoryKey}"]。`,
    'CREDENTIAL_MEMORY_WRITE_OK'
  )
  const databasePath = join(dataDirectory, 'rovai.sqlite')
  const memoryId = await waitFor(async () => {
    const value = await capture('/usr/bin/sqlite3', [
      databasePath,
      `SELECT memory_id FROM memory_revision WHERE source_agent_run_id = '${memoryWrite.runId.replaceAll("'", "''")}' ORDER BY created_at DESC LIMIT 1;`
    ])
    return value || null
  }, 'credentialed Memory identity', 30_000)
  await invoke('memory.search', `query=${memoryKey}。`, 'CREDENTIAL_MEMORY_SEARCH_OK')
  await invoke('memory.read', `memoryIds=["${memoryId}"]。`, 'CREDENTIAL_MEMORY_READ_OK')
  const hearth = await invoke(
    'memory.propose_hearth',
    `action=add，kind=lesson，body="Credentialed single-tool Hearth ${memoryKey}"，retrievalKeys=["${memoryKey}-hearth"]。`,
    'CREDENTIAL_MEMORY_HEARTH_OK'
  )
  const post = await invoke(
    'team.call_member',
    'recipient=agent_2，content="不要调用任何工具，只回复 CREDENTIAL_LEAF_OK。"。',
    'CREDENTIAL_TEAM_CALL_OK'
  )
  latestSnapshot = await waitFor(async () => {
    const candidate = await core.request('camps.snapshot', { campId })
    const leaf = candidate.agentRuns.find((run) => run.a2aRootAgentRunId === post.runId)
    return leaf?.status === 'succeeded' ? candidate : null
  }, `${sourceAdapterKind} credentialed A2A leaf`, 300_000)

  const expectedCanonicalTools = [
    'team.call_member', 'team.create_task', 'team.update_task', 'team.list_tasks',
    'camp.list', 'camp.search', 'history.search', 'camp.read',
    'memory.search', 'memory.read', 'memory.write', 'memory.propose_hearth'
  ]
  const finalTask = updated.snapshot.tasks.find((value) => value.id === task.id)
  const memoryEvidence = JSON.parse(await capture('/usr/bin/sqlite3', [
    '-json',
    databasePath,
    `SELECT
       (SELECT COUNT(*) FROM memory_revision WHERE source_agent_run_id = '${memoryWrite.runId.replaceAll("'", "''")}') AS memoryRevisions,
       (SELECT COUNT(*) FROM hearth_memory_proposal WHERE source_agent_run_id = '${hearth.runId.replaceAll("'", "''")}' AND status = 'pending') AS hearthProposals;`
  ]))[0]
  const newInbox = latestSnapshot.inboxMessages.slice(startingSnapshot.inboxMessages.length)
  const leafRun = latestSnapshot.agentRuns.find((run) => run.a2aRootAgentRunId === post.runId)
  if (!expectedCanonicalTools.every((tool) => observedCanonicalTools.has(tool))
      || finalTask?.status !== 'completed'
      || memoryEvidence?.memoryRevisions !== 1
      || memoryEvidence?.hearthProposals !== 1
      || newInbox.length !== 1
      || leafRun?.status !== 'succeeded') {
    throw new Error(`Credentialed single-tool durable evidence is incomplete: ${JSON.stringify({
      observedCanonicalTools: [...observedCanonicalTools],
      taskStatus: finalTask?.status,
      memoryEvidence,
      newInboxCount: newInbox.length,
      leafRunStatus: leafRun?.status
    })}`)
  }
  return {
    snapshot: latestSnapshot,
    evidence: {
      agentRunIds: runIds,
      catalogSize: expectedCanonicalTools.length,
      observedCanonicalTools: expectedCanonicalTools,
      taskId: task.id,
      memoryRevisions: memoryEvidence.memoryRevisions,
      hearthProposals: memoryEvidence.hearthProposals,
      a2aLeafRunId: leafRun.id,
      modelAcknowledgement: 'CREDENTIAL_SINGLE_TOOL_12_OK'
    }
  }
}

async function runCredentialedCatalogSmoke({
  core,
  campId,
  dataDirectory,
  startingSnapshot,
  contextAnchor,
  taskTitle,
  memoryKey,
  sourceTool
}) {
  const groups = [
    {
      marker: 'CREDENTIAL_CONTEXT_OK',
      tools: ['camp.list', 'camp.search', 'history.search', 'camp.read'],
      instructions: [
        `${sourceTool('camp.list')}：不传 query。`,
        `${sourceTool('camp.search')}：query=${contextAnchor}，保存 messageId。`,
        `${sourceTool('history.search')}：query=${contextAnchor}，允许返回空 Top-K。`,
        `${sourceTool('camp.read')}：campId=${campId}，mode=item，读取刚才的 messageId。`
      ]
    },
    {
      marker: 'CREDENTIAL_TASK_OK',
      tools: ['team.create_task', 'team.list_tasks', 'team.update_task'],
      instructions: [
        `${sourceTool('team.create_task')}：title=${taskTitle}，description=credentialed catalog regression，不传 assigneeAgentId。`,
        `${sourceTool('team.list_tasks')}：列出 pending Task 并读取新 Task 的 id/version。`,
        `${sourceTool('team.update_task')}：使用真实 id/version 将 status 更新为 completed。`
      ]
    },
    {
      marker: 'CREDENTIAL_MEMORY_OK',
      tools: ['memory.write', 'memory.search', 'memory.read', 'memory.propose_hearth'],
      instructions: [
        `${sourceTool('memory.write')}：action=add，scope=companion，kind=lesson，body="Credentialed catalog memory ${memoryKey}"，retrievalKeys=["${memoryKey}"]，保存 memoryId。`,
        `${sourceTool('memory.search')}：query=${memoryKey} 并确认该 Memory。`,
        `${sourceTool('memory.read')}：读取该 memoryId 的当前 Revision。`,
        `${sourceTool('memory.propose_hearth')}：action=add，kind=lesson，body="Credentialed Hearth ${memoryKey}"，retrievalKeys=["${memoryKey}-hearth"]。`
      ]
    },
    {
      marker: 'CREDENTIAL_TEAM_OK',
      tools: ['team.call_member'],
      instructions: [
        `${sourceTool('team.call_member')}：recipient=agent_2，content="不要调用任何工具，只回复 CREDENTIAL_LEAF_OK。"。`
      ]
    }
  ]
  const runIds = []
  const observedCanonicalTools = new Set()
  let finalSnapshot = startingSnapshot
  for (const group of groups) {
    const sent = await sendCampMessage(core, {
      commandId: crypto.randomUUID(),
      campId,
      body: [
        '执行 credentialed Runtime 内置工具回归。不要运行 shell、不要读取或修改文件。严格按顺序调用：',
        ...group.instructions,
        `全部成功后只回复 ${group.marker}；失败时说明失败，不得伪造成功。`
      ].join('\n'),
      address: { mode: 'explicit', agentProfileIds: ['agent_1'] },
      replyToCampMessageId: null,
      execution: {
        taskId: null,
        purpose: `Run the ${group.marker} subset of the credentialed built-in MCP regression.`,
        expectedOutput: `${group.marker} after every requested canonical tool succeeds.`,
        completionRole: 'required'
      }
    })
    const result = sent.commandResult ?? sent
    const runId = result.payload?.agentRunIds?.[0]
    if (result.status !== 'accepted' || !runId) {
      throw new Error(`Credentialed catalog subset was not accepted: ${JSON.stringify(sent)}`)
    }
    runIds.push(runId)
    finalSnapshot = await waitFor(async () => {
      const candidate = await core.request('camps.snapshot', { campId })
      const run = candidate.agentRuns.find((value) => value.id === runId)
      const evidence = candidate.executionEvidence.filter((item) => (
        item.agentRunId === runId
        && item.eventType === 'runtime.action'
        && item.phase === 'completed'
        && item.payload?.kind === 'mcp_tool_call'
      ))
      const tools = new Set(evidence.map((item) => item.payload?.title))
      if (run?.status === 'failed' || run?.status === 'cancelled') {
        throw new Error(`Credentialed catalog subset failed: ${JSON.stringify({ marker: group.marker, run, tools: [...tools] })}`)
      }
      if (run?.status === 'succeeded' && !group.tools.every((tool) => tools.has(tool))) {
        throw new Error(`Credentialed catalog subset ended early: ${JSON.stringify({ marker: group.marker, tools: [...tools] })}`)
      }
      const output = candidate.messages.find((message) => message.sourceAgentRunId === runId)?.body ?? ''
      if (run?.status === 'succeeded' && group.tools.every((tool) => tools.has(tool)) && output.includes(group.marker)) {
        for (const tool of tools) observedCanonicalTools.add(tool)
        return candidate
      }
      return null
    }, `${sourceAdapterKind} ${group.marker}`, 300_000)
  }

  const databasePath = join(dataDirectory, 'rovai.sqlite')
  const task = finalSnapshot.tasks.find((value) => value.title === taskTitle)
  const contextManifest = finalSnapshot.contextManifests.find((value) => value.agentRunId === runIds[0])
  const memoryEvidence = JSON.parse(await capture('/usr/bin/sqlite3', [
    '-json',
    databasePath,
    `SELECT
       (SELECT COUNT(*) FROM memory_revision WHERE source_agent_run_id = '${runIds[2].replaceAll("'", "''")}') AS memoryRevisions,
       (SELECT COUNT(*) FROM hearth_memory_proposal WHERE source_agent_run_id = '${runIds[2].replaceAll("'", "''")}' AND status = 'pending') AS hearthProposals;`
  ]))[0]
  const expectedCanonicalTools = [
    'team.call_member', 'team.create_task', 'team.update_task', 'team.list_tasks',
    'camp.list', 'camp.search', 'history.search', 'camp.read',
    'memory.search', 'memory.read', 'memory.write', 'memory.propose_hearth'
  ]
  const newInbox = finalSnapshot.inboxMessages.slice(startingSnapshot.inboxMessages.length)
  const leafRun = finalSnapshot.agentRuns.find((run) => run.a2aRootAgentRunId === runIds[3])
  if (!expectedCanonicalTools.every((tool) => observedCanonicalTools.has(tool))
      || task?.status !== 'completed'
      || contextManifest?.historyFenceVersion !== 1
      || memoryEvidence?.memoryRevisions !== 1
      || memoryEvidence?.hearthProposals !== 1
      || newInbox.length !== 1
      || leafRun?.status !== 'succeeded') {
    throw new Error(`Credentialed catalog durable evidence is incomplete: ${JSON.stringify({
      observedCanonicalTools: [...observedCanonicalTools],
      taskStatus: task?.status,
      historyFenceVersion: contextManifest?.historyFenceVersion,
      memoryEvidence,
      newInboxCount: newInbox.length,
      leafRunStatus: leafRun?.status
    })}`)
  }
  return {
    snapshot: finalSnapshot,
    evidence: {
      agentRunIds: runIds,
      catalogSize: expectedCanonicalTools.length,
      observedCanonicalTools: expectedCanonicalTools,
      taskId: task.id,
      memoryRevisions: memoryEvidence.memoryRevisions,
      hearthProposals: memoryEvidence.hearthProposals,
      a2aLeafRunId: leafRun.id,
      modelAcknowledgement: groups.map((group) => group.marker)
    }
  }
}

async function prepareAntigravityConfigGuard() {
  const pluginDir = join(homedir(), '.gemini', 'config', 'plugins', 'rovai-team')
  const pluginManifestPath = join(pluginDir, 'plugin.json')
  const pluginConfigPath = join(pluginDir, 'mcp_config.json')
  const settingsPath = join(homedir(), '.gemini', 'antigravity-cli', 'settings.json')
  const pluginExisted = await exists(pluginDir)
  if (pluginExisted && !antigravityTeamPrivateDirectory) {
    throw new Error(`Refusing to replace an existing Antigravity Plugin during Smoke: ${pluginDir}`)
  }
  const originalPluginManifest = await readOptionalFile(pluginManifestPath)
  const originalPluginConfig = await readOptionalFile(pluginConfigPath)
  const ownershipPath = antigravityTeamPrivateDirectory
    ? join(antigravityTeamPrivateDirectory, 'ownership.json')
    : null
  const permissionJournalPath = antigravityTeamPrivateDirectory
    ? join(antigravityTeamPrivateDirectory, 'permission-journal.json')
    : null
  const originalOwnership = ownershipPath ? await readOptionalFile(ownershipPath) : null
  const originalPermissionJournal = permissionJournalPath
    ? await readOptionalFile(permissionJournalPath)
    : null
  const settingsExisted = await exists(settingsPath)
  const originalSettings = settingsExisted
    ? JSON.parse(await readFile(settingsPath, 'utf8'))
    : {}
  const exactPermissions = [
    'call_member', 'create_task', 'update_task', 'list_tasks',
    'camp_list', 'camp_search', 'history_search', 'camp_read',
    'memory_search', 'memory_read', 'memory_write', 'memory_propose_hearth'
  ].map((tool) => `mcp(rovai_team/${tool})`)
  const permissionsAlreadyPresent = new Set(
    exactPermissions.filter((permission) => originalSettings?.permissions?.allow?.includes(permission) === true)
  )
  return {
    async restore() {
      const currentPluginConfig = await readOptionalFile(pluginConfigPath)
      const pluginChanged = !sameOptionalBytes(currentPluginConfig, originalPluginConfig)
      if (pluginChanged) {
        let managed = null
        try {
          managed = currentPluginConfig
            ? JSON.parse(currentPluginConfig.toString('utf8'))?.mcpServers?.rovai_team
            : null
        } catch {
          // The ownership check below deliberately preserves an unrecognized concurrent edit.
        }
        if (managed?.command !== coreExecutable
            || managed?.args?.[0] !== 'attested-team-mcp-bridge') {
          throw new Error(`Smoke Plugin ownership diverged; preserving it for manual inspection: ${pluginDir}`)
        }
      }
      if (!pluginExisted && await exists(pluginDir)) {
        await rm(pluginDir, { recursive: true })
      } else if (pluginExisted) {
        await restoreOptionalFile(pluginManifestPath, originalPluginManifest)
        await restoreOptionalFile(pluginConfigPath, originalPluginConfig)
      }
      if (permissionsAlreadyPresent.size !== exactPermissions.length && await exists(settingsPath)) {
        const current = JSON.parse(await readFile(settingsPath, 'utf8'))
        const allow = current?.permissions?.allow
        if (Array.isArray(allow)) {
          current.permissions.allow = allow.filter((value) => (
            !exactPermissions.includes(value) || permissionsAlreadyPresent.has(value)
          ))
        }
        if (!settingsExisted && Object.keys(current).length === 1
            && Object.keys(current.permissions ?? {}).length === 1
            && current.permissions.allow?.length === 0) {
          await rm(settingsPath)
        } else {
          await mkdir(join(homedir(), '.gemini', 'antigravity-cli'), { recursive: true })
          await writeFile(settingsPath, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 })
        }
      }
      if (ownershipPath) await restoreOptionalFile(ownershipPath, originalOwnership)
      if (permissionJournalPath) {
        await restoreOptionalFile(permissionJournalPath, originalPermissionJournal)
      }
    }
  }
}

async function configureAntigravityProductionRuntime(request, agentProfileId) {
  const profile = await request('agents.get', { agentProfileId })
  const result = await request('agents.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentProfileId,
      expectedVersion: profile.version,
      adapterKind: 'antigravity-app',
      model: { mode: 'explicit', modelId: 'gemini-3.6-flash-high', options: {} },
      permissions: {
        adapterKind: 'antigravity-app',
        schemaVersion: 1,
        values: {
          mode: 'accept-edits',
          sandbox: 'on',
          dangerously_skip_permissions: 'off'
        }
      }
    }
  })
  if (result.status !== 'applied') {
    throw new Error(`Antigravity production Runtime parameters were not applied: ${JSON.stringify(result)}`)
  }
  const configured = await request('agents.get', { agentProfileId })
  if (configured.runtimeReadiness?.status !== 'ready'
      || configured.runtimePreference?.model?.modelId !== 'gemini-3.6-flash-high'
      || configured.runtimePreference?.permissions?.values?.sandbox !== 'on'
      || configured.runtimePreference?.permissions?.values?.dangerously_skip_permissions !== 'off') {
    throw new Error(`Antigravity production Runtime parameters are not ready: ${JSON.stringify(configured)}`)
  }
}

async function sendCampMessage(core, input) {
  const draft = await core.request('camp.composerDraft.get', { campId: input.campId })
  const address = input.address ?? { mode: 'default' }
  const content = address.mode === 'explicit'
    ? [
        ...address.agentProfileIds.flatMap((agentProfileId) => [
          { kind: 'member_mention', agentProfileId },
          { kind: 'text', text: ' ' }
        ]),
        { kind: 'text', text: input.body }
      ]
    : address.mode === 'broadcast'
      ? [{ kind: 'all_members_mention' }, { kind: 'text', text: ` ${input.body}` }]
      : [{ kind: 'text', text: input.body }]
  const saved = await core.request('camp.composerDraft.save', {
    campId: input.campId,
    expectedRevision: draft.revision,
    content
  })
  return core.request('camp.messages.send', {
    commandId: input.commandId,
    campId: input.campId,
    draftRevision: saved.revision,
    replyToCampMessageId: input.replyToCampMessageId,
    execution: input.execution
  })
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readOptionalFile(path) {
  return await exists(path) ? readFile(path) : null
}

function sameOptionalBytes(left, right) {
  if (left === null || right === null) return left === right
  return left.equals(right)
}

async function restoreOptionalFile(path, bytes) {
  if (bytes === null) {
    if (await exists(path)) await rm(path)
    return
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, bytes, { mode: 0o600 })
}

function startCore(dataDirectory) {
  const args = ['--data-dir', dataDirectory]
  if (antigravityTeamPrivateDirectory) {
    args.push('--antigravity-team-private-dir', antigravityTeamPrivateDirectory)
  }
  const child = spawn(coreExecutable, args, {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.pipe(process.stderr)
  const pending = new Map()
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
    if (!stopped) rejectPending(new Error(`rovai-core exited early (code=${code}, signal=${signal})`))
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) return
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
  return { request, stop }
}

async function waitFor(probe, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function verifyUnboundBridgeLeavesDomainUntouched(dataDirectory, antigravityExecutable) {
  const databasePath = join(dataDirectory, 'rovai.sqlite')
  const countSql = `
    SELECT json_object(
      'events', (SELECT COUNT(*) FROM event_log),
      'runs', (SELECT COUNT(*) FROM agent_run),
      'inbox', (SELECT COUNT(*) FROM inbox_message),
      'messages', (SELECT COUNT(*) FROM camp_message)
    );
  `
  const before = await capture('/usr/bin/sqlite3', [databasePath, countSql])
  const ordinaryOutput = await capture(antigravityExecutable, [
    '--print',
    [
      'This is an ordinary terminal Antigravity process, not a Rovai AgentRun.',
      'Try to call the MCP tool call_member on server rovai_team exactly once.',
      'If the tool is not available, call no other tool and reply exactly UNBOUND_NO_TOOL.'
    ].join(' '),
    '--print-timeout', '2m',
    '--mode', 'plan',
    '--sandbox',
    '--model', 'gemini-3.6-flash-low'
  ])
  if (!ordinaryOutput.includes('UNBOUND_NO_TOOL')) {
    throw new Error(`Ordinary Antigravity did not observe an empty Team tool surface: ${ordinaryOutput}`)
  }
  const bridge = spawn(coreExecutable, [
    'attested-team-mcp-bridge',
    '--rendezvous',
    `/tmp/rovai-attested-team-${process.getuid()}/core.sock`
  ], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
  const responses = []
  createInterface({ input: bridge.stdout }).on('line', (line) => responses.push(JSON.parse(line)))
  bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`)
  bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`)
  const unboundCalls = [
    ['call_member', { recipient: 'agent_2', content: 'UNBOUND_MUST_NOT_WRITE' }],
    ['create_task', { title: 'UNBOUND_MUST_NOT_WRITE' }],
    ['update_task', { taskId: '00000000-0000-4000-8000-000000000001', expectedVersion: 1, status: 'pending' }],
    ['list_tasks', {}],
    ['camp_list', {}],
    ['camp_search', { query: 'UNBOUND_MUST_NOT_READ' }],
    ['history_search', { query: 'UNBOUND_MUST_NOT_READ' }],
    ['camp_read', {
      campId: '00000000-0000-4000-8000-000000000001',
      mode: 'item',
      messageId: '00000000-0000-4000-8000-000000000002'
    }],
    ['memory_search', { query: 'UNBOUND_MUST_NOT_READ' }],
    ['memory_read', { memoryIds: ['00000000-0000-4000-8000-000000000001'] }],
    ['memory_write', { action: 'add', scope: 'companion', kind: 'lesson', body: 'UNBOUND_MUST_NOT_WRITE', retrievalKeys: ['unbound'] }],
    ['memory_propose_hearth', { action: 'add', kind: 'lesson', body: 'UNBOUND_MUST_NOT_WRITE', retrievalKeys: ['unbound'] }]
  ]
  unboundCalls.forEach(([name, args], index) => {
    bridge.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: index + 3,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
        _meta: {
          'antigravity.google/conversation_id': 'unbound-smoke',
          progressToken: `unbound:${index + 1}`
        }
      }
    })}\n`)
  })
  bridge.stdin.end()
  await new Promise((resolveClose, rejectClose) => {
    bridge.once('error', rejectClose)
    bridge.once('close', (code) => code === 0
      ? resolveClose()
      : rejectClose(new Error(`unbound Bridge exited with ${code}`)))
  })
  const callResponses = responses.slice(2)
  if (responses[1]?.result?.tools?.length !== 0
      || callResponses.length !== unboundCalls.length
      || callResponses.some((response) => response?.result?.structuredContent?.errorCode !== 'run_not_bound')) {
    throw new Error(`Unbound Bridge did not fail closed: ${JSON.stringify(responses)}`)
  }
  const after = await capture('/usr/bin/sqlite3', [databasePath, countSql])
  if (after !== before) {
    throw new Error(`Unbound Bridge changed domain state: ${JSON.stringify({ before, after })}`)
  }
  return {
    toolsListEmpty: true,
    directCallCount: unboundCalls.length,
    directCallError: 'run_not_bound',
    sqliteDomainWrites: 0,
    ordinaryAgyOutput: 'UNBOUND_NO_TOOL'
  }
}

async function capture(command, args) {
  return new Promise((resolveCapture, rejectCapture) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectCapture)
    child.once('close', (code) => code === 0
      ? resolveCapture(stdout.join('').trim())
      : rejectCapture(new Error(`${command} failed (${code}): ${stderr.join('')}`)))
  })
}
