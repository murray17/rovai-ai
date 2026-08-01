import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
const dataDir = join(fixtureRoot, 'data')
const sourceAdapterKind = process.env.ROVAI_TEAM_SOURCE_ADAPTER ?? 'codex-cli'
const targetAdapterKind = process.env.ROVAI_TEAM_TARGET_ADAPTER ?? 'codex-cli'
const supportedAdapters = ['codex-cli', 'opencode-cli', 'copilot-cli', 'claude-code-cli', 'antigravity-app']
const targetCanContinueA2a = true
const repeatSourceCall = process.env.ROVAI_TEAM_REPEAT_SOURCE_CALL === '1'
const verifyTaskTools = process.env.ROVAI_TEAM_TASK_TOOL_DISCOVERY === '1'
const verifyTaskHandoff = process.env.ROVAI_TEAM_TASK_HANDOFF === '1'
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
          || installation.snapshot.capabilities.includes('team_tool.post_message'))
        ? installation
        : null
    }, `${runtimeKind} capability refresh`, 120_000)
  }
  const codexAgents = []
  if (sourceAdapterKind === 'codex-cli') codexAgents.push('agent-luoke')
  if (targetAdapterKind === 'codex-cli') codexAgents.push('agent-muwa')
  const codexInstallation = codexAgents.length > 0
    ? await configureCodexRuntime(core.request, health, codexAgents)
    : null
  const sourceInstallation = sourceAdapterKind === 'codex-cli'
    ? codexInstallation
    : await configureProductRuntime(core.request, sourceAdapterKind, ['agent-luoke'])
  const targetInstallation = targetAdapterKind === 'codex-cli'
    ? codexInstallation
    : await configureProductRuntime(core.request, targetAdapterKind, ['agent-muwa'])
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
        `1. team.create_task：title=${handoffTaskTitle}，description=durable handoff smoke，assigneeAgentId=agent-muwa。`,
        '2. 确认创建成功后调用一次 team.post_message；Task 分配本身不会唤醒接收者。',
        'team.post_message 的 recipient 使用 agent-muwa，body 使用下面完整内容：',
        `请执行 Task 交接验收。先调用 team.list_tasks 找到 title=${handoffTaskTitle} 的 Task并读取 id/version；再调用 team.update_task 将 status 更新为 in_progress；使用返回的新 version 再调用 team.update_task 将 status 更新为 completed。所有工具成功后只回复 B_TASK_DONE，不要发送其他消息。`,
        '两个源端工具成功后只回复 ROOT_QUEUED。'
      ].join('\n')
    : targetCanContinueA2a ? [
        '执行 A2A 验收协议。你必须且只能调用一次 team.post_message，不要调用其他工具。',
        'MCP Server 名为 rovai_team；如果工具被延迟加载，先使用你的原生工具发现能力查找它，不要在查找前声称工具不可用。',
        'recipient 使用 agent-muwa。',
        'body 使用下面完整内容：',
        '请执行 A2A 回信验收。你必须且只能调用一次 team.post_message，不要调用其他工具。recipient 使用 source；不要填写 inReplyToMessageId；body 必须逐字等于下面引号内的完整句子，不得只发送 marker："A2A_CHAIN_REPLY_OK；收到本消息后不要调用任何工具，只回复 A2A_CHAIN_COMPLETE。"工具成功后只回复 B_REPLIED。',
        '你的工具成功后只回复 ROOT_QUEUED。'
      ].join('\n')
      : [
        '执行 Antigravity A2A 接收验收。你必须且只能调用一次 team.post_message，不要调用其他工具。',
        'MCP Server 名为 rovai_team；如果工具被延迟加载，先使用你的原生工具发现能力查找它。',
        'recipient 使用 agent-muwa。',
        'body 必须是：不要调用任何工具，只回复 ANTIGRAVITY_A2A_RECEIVED。',
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
        throw new Error(`Root AgentRun completed without calling team.post_message: ${JSON.stringify(lastChainState)}`)
      }
      if (!verifyTaskHandoff && targetCanContinueA2a && candidate.inboxMessages.length === 1
          && chainRuns.some((run) => run.a2aDepth === 1 && run.status === 'succeeded')) {
        throw new Error(`Target AgentRun completed without replying through team.post_message: ${JSON.stringify(lastChainState)}`)
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

  if (snapshot.schemaVersion !== 12) {
    throw new Error(`Camp Snapshot did not use Read Model schema v11: ${snapshot.schemaVersion}`)
  }
  const [requestMessage, replyMessage] = snapshot.inboxMessages.slice().reverse()
  if (requestMessage.senderAgentId !== 'agent-luoke'
      || requestMessage.recipientAgentId !== 'agent-muwa') {
    throw new Error(`A2A request linkage is invalid: ${JSON.stringify(snapshot.inboxMessages)}`)
  }
  if (!verifyTaskHandoff && targetCanContinueA2a
      && (replyMessage.senderAgentId !== 'agent-muwa'
        || replyMessage.recipientAgentId !== 'agent-luoke'
        || replyMessage.inReplyToMessageId !== requestMessage.id
        || replyMessage.correlationId !== requestMessage.correlationId
        || replyMessage.body !== 'A2A_CHAIN_REPLY_OK；收到本消息后不要调用任何工具，只回复 A2A_CHAIN_COMPLETE。')) {
    throw new Error(`A2A reply linkage is invalid: ${JSON.stringify(snapshot.inboxMessages)}`)
  }

  const chainRuns = snapshot.agentRuns
    .filter((run) => run.id === rootRunId || run.a2aRootAgentRunId === rootRunId)
    .sort((left, right) => left.a2aDepth - right.a2aDepth)
  const expectedDepths = verifyTaskHandoff || !targetCanContinueA2a ? '0,1' : '0,1,2'
  if (chainRuns.map((run) => run.a2aDepth).join(',') !== expectedDepths
      || chainRuns[1].a2aParentAgentRunId !== rootRunId
      || (!verifyTaskHandoff && targetCanContinueA2a
        && chainRuns[2].a2aParentAgentRunId !== chainRuns[1].id)) {
    throw new Error(`A2A Run ancestry is invalid: ${JSON.stringify(chainRuns)}`)
  }
  if (!targetCanContinueA2a) {
    const targetMessage = snapshot.messages.find(
      (message) => message.sourceAgentRunId === chainRuns[1].id
    )
    if (targetMessage?.body.trim() !== 'ANTIGRAVITY_A2A_RECEIVED') {
      throw new Error(`Antigravity A2A target did not return the expected leaf result: ${JSON.stringify({
        targetRun: chainRuns[1],
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
        || handoffTask.assigneeAgentId !== 'agent-muwa'
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
    const repeated = await core.request('camp.messages.send', {
      commandId: crypto.randomUUID(),
      campId,
      body: [
        '再次执行 Team Tool 续接验收。你必须且只能调用一次 team.post_message，不要调用其他工具。',
        'recipient 使用 agent-muwa。',
        'body 必须是：只回复 SECOND_TARGET_DONE，不要调用任何工具。',
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
    if (repeatedRootRun?.conversationId !== chainRuns[0].conversationId) {
      throw new Error(`Repeated source call changed logical Conversation: ${JSON.stringify({
        original: chainRuns[0],
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
    const sent = await core.request('camp.messages.send', {
      commandId: crypto.randomUUID(),
      campId,
      body: [
        '执行 Rovai-ai Task Tool 发现验收。必须按顺序实际调用下面三个工具，不要调用 team.post_message 或其他工具：',
        `1. team.create_task：title=${discoveryTitle}，description=runtime discovery smoke，不传 assigneeAgentId，创建未分配 Task。`,
        '2. team.list_tasks：列出 pending Task，确认刚创建的 Task 并读取它的 id 与 version。',
        '3. team.update_task：使用刚才返回的 id 和 version；必须在同一次调用中传 assigneeAgentId=agent-muwa 且 status=completed，先认领再完成。',
        '三个工具都成功后只回复 TASK_TOOLS_OK。'
      ].join('\n'),
      address: { mode: 'explicit', agentProfileIds: ['agent-muwa'] },
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
        || task.assigneeAgentId !== 'agent-muwa'
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

  const durableIdentity = {
    runIds: snapshot.agentRuns.map((run) => run.id).sort(),
    inboxIds: snapshot.inboxMessages.map((message) => message.id).sort(),
    manifestIds: snapshot.contextManifests.map((manifest) => manifest.id).sort(),
    correlationId: requestMessage.correlationId
  }
  await core.stop()
  core = startCore(dataDir)
  const restored = await core.request('camps.snapshot', { campId })
  const restoredIdentity = {
    runIds: restored.agentRuns
      .map((run) => run.id)
      .sort(),
    inboxIds: restored.inboxMessages.map((message) => message.id).sort(),
    manifestIds: restored.contextManifests
      .map((manifest) => manifest.id)
      .sort(),
    correlationId: restored.inboxMessages.find((message) => message.id === requestMessage.id)?.correlationId
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
    correlationId: requestMessage.correlationId,
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
    unboundAntigravity,
    restoredWithoutDuplication: true
  }, null, 2))
} finally {
  if (core) await core.stop()
  if (antigravityConfigGuard) await antigravityConfigGuard.restore()
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function prepareAntigravityConfigGuard() {
  const pluginDir = join(homedir(), '.gemini', 'config', 'plugins', 'rovai-team')
  const settingsPath = join(homedir(), '.gemini', 'antigravity-cli', 'settings.json')
  const pluginExisted = await exists(pluginDir)
  if (pluginExisted) {
    throw new Error(`Refusing to replace an existing Antigravity Plugin during Smoke: ${pluginDir}`)
  }
  const settingsExisted = await exists(settingsPath)
  const originalSettings = settingsExisted
    ? JSON.parse(await readFile(settingsPath, 'utf8'))
    : {}
  const exactPermission = 'mcp(rovai_team/post_message)'
  const permissionAlreadyPresent = originalSettings?.permissions?.allow?.includes(exactPermission) === true
  return {
    async restore() {
      if (!pluginExisted && await exists(pluginDir)) {
        const config = JSON.parse(await readFile(join(pluginDir, 'mcp_config.json'), 'utf8'))
        const managed = config?.mcpServers?.rovai_team
        if (managed?.command !== coreExecutable
            || managed?.args?.[0] !== 'attested-team-mcp-bridge') {
          throw new Error(`Smoke Plugin ownership diverged; preserving it for manual inspection: ${pluginDir}`)
        }
        await rm(pluginDir, { recursive: true })
      }
      if (!permissionAlreadyPresent && await exists(settingsPath)) {
        const current = JSON.parse(await readFile(settingsPath, 'utf8'))
        const allow = current?.permissions?.allow
        if (Array.isArray(allow)) {
          current.permissions.allow = allow.filter((value) => value !== exactPermission)
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
    }
  }
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function startCore(dataDirectory) {
  const child = spawn(coreExecutable, ['--data-dir', dataDirectory], {
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
      'Try to call the MCP tool post_message on server rovai_team exactly once.',
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
  bridge.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'post_message',
      arguments: { recipient: 'agent-muwa', body: 'UNBOUND_MUST_NOT_WRITE' },
      _meta: {
        'antigravity.google/conversation_id': 'unbound-smoke',
        progressToken: 'unbound:1'
      }
    }
  })}\n`)
  bridge.stdin.end()
  await new Promise((resolveClose, rejectClose) => {
    bridge.once('error', rejectClose)
    bridge.once('close', (code) => code === 0
      ? resolveClose()
      : rejectClose(new Error(`unbound Bridge exited with ${code}`)))
  })
  if (responses[1]?.result?.tools?.length !== 0
      || responses[2]?.result?.structuredContent?.errorCode !== 'run_not_bound') {
    throw new Error(`Unbound Bridge did not fail closed: ${JSON.stringify(responses)}`)
  }
  const after = await capture('/usr/bin/sqlite3', [databasePath, countSql])
  if (after !== before) {
    throw new Error(`Unbound Bridge changed domain state: ${JSON.stringify({ before, after })}`)
  }
  return {
    toolsListEmpty: true,
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
