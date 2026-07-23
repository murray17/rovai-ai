import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureCodexRuntime } from './configure-codex-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'lumen-team-context-smoke-'))
const dataDir = join(fixtureRoot, 'data')
const targetAdapterKind = process.env.LUMEN_TEAM_TARGET_ADAPTER ?? 'codex-cli'
const repeatSourceCall = process.env.LUMEN_TEAM_REPEAT_SOURCE_CALL === '1'
let core = null

try {
  core = startCore(dataDir)
  if (!['codex-cli', 'opencode-cli', 'copilot-cli', 'claude-code-cli'].includes(targetAdapterKind)) {
    throw new Error(`Unsupported LUMEN_TEAM_TARGET_ADAPTER: ${targetAdapterKind}`)
  }
  const health = await core.request('health.check', { refreshRuntimeProbe: true })
  if (health.codex.status !== 'ready') {
    throw new Error(`Codex health gate failed: ${JSON.stringify(health.codex)}`)
  }

  await configureCodexRuntime(
    core.request,
    health,
    targetAdapterKind === 'codex-cli' ? ['agent-luoke', 'agent-muwa'] : ['agent-luoke']
  )
  const targetRuntimeVersion = targetAdapterKind === 'codex-cli'
    ? health.codex.reportedVersion
    : await configureTargetRuntime(core.request, health, 'agent-muwa', targetAdapterKind)
  const preflight = await core.request('camps.creationPreflight')
  if (!preflight.admissible || preflight.readyMembers.length < 2) {
    throw new Error(`Two ready members were not available: ${JSON.stringify(preflight)}`)
  }

  const first = await core.request('camps.createFromFirstMessage', {
    commandId: crypto.randomUUID(),
    project: null,
    body: [
      '执行 A2A 验收协议。你必须且只能调用一次 team.post_message，不要调用其他工具。',
      'MCP Server 名为 lumen_team；如果工具被延迟加载，先使用你的原生工具发现能力查找它，不要在查找前声称工具不可用。',
      'recipientAgentId 使用 agent-muwa。',
      'body 使用下面完整内容：',
      '请执行 A2A 回信验收。你必须且只能调用一次 team.post_message，不要调用其他工具。recipientAgentId 使用 agent-luoke；inReplyToMessageId 使用 CURRENT_INPUT.sourceInboxMessageId；body 必须是 A2A_CHAIN_REPLY_OK。工具成功后只回复 B_REPLIED。',
      '你的工具成功后只回复 ROOT_QUEUED。'
    ].join('\n'),
    purpose: 'Use the Lumen Team Tool to request one teammate action and then stop delegating.',
    expectedOutput: 'One queued teammate request followed by ROOT_QUEUED.'
  })
  if (first.status !== 'accepted' || first.code !== 'camp.created_and_queued') {
    throw new Error(`Camp intake was not accepted: ${JSON.stringify(first)}`)
  }

  const campId = first.payload.campId
  const rootRunId = first.payload.agentRunIds?.[0]
  if (!rootRunId) throw new Error(`Camp intake returned no root AgentRun: ${JSON.stringify(first)}`)
  let snapshot = await waitFor(async () => {
    const candidate = await core.request('camps.snapshot', { campId })
    const turn = candidate.turns.find((item) => item.id === first.payload.campTurnId)
    const chainRuns = candidate.agentRuns.filter((run) =>
      run.id === rootRunId || run.a2aRootAgentRunId === rootRunId
    )
    if (chainRuns.some((run) => run.status === 'failed' || run.status === 'cancelled')) {
      throw new Error(`A2A AgentRun failed: ${JSON.stringify(chainRuns)}`)
    }
    if (chainRuns.find((run) => run.id === rootRunId)?.status === 'succeeded'
        && candidate.inboxMessages.length === 0) {
      throw new Error('Root AgentRun completed without calling team.post_message')
    }
    if (candidate.inboxMessages.length === 1
        && chainRuns.some((run) => run.a2aDepth === 1 && run.status === 'succeeded')) {
      throw new Error(`Target AgentRun completed without replying through team.post_message: ${JSON.stringify({
        chainRuns,
        messages: candidate.messages.slice(-8)
      })}`)
    }
    return candidate.inboxMessages.length === 2
      && chainRuns.length === 3
      && chainRuns.every((run) => run.status === 'succeeded')
      && turn?.status === 'completed'
      ? candidate
      : null
  }, 'A→B→A Team Tool chain', 300_000)

  if (snapshot.schemaVersion !== 3) {
    throw new Error(`Camp Snapshot did not use Read Model schema v3: ${snapshot.schemaVersion}`)
  }
  const [requestMessage, replyMessage] = snapshot.inboxMessages.slice().reverse()
  if (requestMessage.senderAgentId !== 'agent-luoke'
      || requestMessage.recipientAgentId !== 'agent-muwa'
      || replyMessage.senderAgentId !== 'agent-muwa'
      || replyMessage.recipientAgentId !== 'agent-luoke'
      || replyMessage.inReplyToMessageId !== requestMessage.id
      || replyMessage.correlationId !== requestMessage.correlationId
      || replyMessage.body !== 'A2A_CHAIN_REPLY_OK') {
    throw new Error(`A2A reply linkage is invalid: ${JSON.stringify(snapshot.inboxMessages)}`)
  }

  const chainRuns = snapshot.agentRuns
    .filter((run) => run.id === rootRunId || run.a2aRootAgentRunId === rootRunId)
    .sort((left, right) => left.a2aDepth - right.a2aDepth)
  if (chainRuns.map((run) => run.a2aDepth).join(',') !== '0,1,2'
      || chainRuns[1].a2aParentAgentRunId !== rootRunId
      || chainRuns[2].a2aParentAgentRunId !== chainRuns[1].id) {
    throw new Error(`A2A Run ancestry is invalid: ${JSON.stringify(chainRuns)}`)
  }

  const manifests = snapshot.contextManifests.filter((manifest) =>
    chainRuns.some((run) => run.id === manifest.agentRunId)
  )
  if (manifests.length !== 3
      || manifests.some((manifest) => manifest.delivery?.status !== 'accepted')) {
    throw new Error(`Frozen context was not accepted for every chain Run: ${JSON.stringify(manifests)}`)
  }
  if (snapshot.contextCompactions.length !== 0) {
    throw new Error(`Small context was compressed without a budget trigger: ${JSON.stringify(snapshot.contextCompactions)}`)
  }

  let repeatedSourceCall = null
  if (repeatSourceCall) {
    const repeated = await core.request('camp.messages.send', {
      commandId: crypto.randomUUID(),
      campId,
      body: [
        '再次执行 Team Tool 续接验收。你必须且只能调用一次 team.post_message，不要调用其他工具。',
        'recipientAgentId 使用 agent-muwa。',
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
    sourceRuntime: health.codex.reportedVersion,
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
    repeatedSourceCall,
    restoredWithoutDuplication: true
  }, null, 2))
} finally {
  if (core) await core.stop()
  await rm(fixtureRoot, { recursive: true, force: true })
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'target', 'debug', 'lumen-core'), ['--data-dir', dataDirectory], {
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
    if (!stopped) rejectPending(new Error(`lumen-core exited early (code=${code}, signal=${signal})`))
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

async function configureTargetRuntime(request, health, agentProfileId, adapterKind) {
  const candidate = health.runtimeCandidates.find((value) => value.runtimeKind === adapterKind)
  if (candidate?.status !== 'ready' || !candidate.executablePath) {
    throw new Error(`${adapterKind} health gate failed: ${JSON.stringify(candidate)}`)
  }
  let installations = await request('runtime.installations.list')
  let installation = installations.find((value) =>
    value.adapterKind === adapterKind
      && value.executablePath === candidate.executablePath
      && value.authScope === 'local-user'
  )
  if (!installation) {
    const created = await request('runtime.installations.create', {
      commandId: crypto.randomUUID(),
      command: {
        adapterKind,
        executablePath: candidate.executablePath,
        source: 'discovered',
        authScope: 'local-user'
      }
    })
    if (created.status !== 'applied') {
      throw new Error(`${adapterKind} installation was not created: ${JSON.stringify(created)}`)
    }
    installation = { id: created.resultEntity.entityId }
  }
  const refreshed = await request('runtime.installations.refresh', {
    commandId: crypto.randomUUID(),
    installationId: installation.id
  })
  if (refreshed.status !== 'applied') {
    throw new Error(`${adapterKind} installation was not refreshed: ${JSON.stringify(refreshed)}`)
  }
  installations = await request('runtime.installations.list')
  installation = installations.find((value) => value.id === installation.id)
  if (installation?.snapshot?.probeStatus !== 'ready') {
    throw new Error(`${adapterKind} installation is not ready: ${JSON.stringify(installation)}`)
  }
  const profile = await request('agents.get', { agentProfileId })
  const permissionValues = adapterKind === 'opencode-cli'
    ? { permission: process.env.LUMEN_OPENCODE_PERMISSION ?? 'ask' }
    : adapterKind === 'copilot-cli'
      ? { allow_all: process.env.LUMEN_COPILOT_ALLOW_ALL ?? 'off' }
      : { permission_mode: process.env.LUMEN_CLAUDE_CODE_PERMISSION_MODE ?? 'acceptEdits' }
  const configured = await request('agents.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentProfileId,
      expectedVersion: profile.version,
      runtime: {
        installationId: installation.id,
        model: { mode: 'runtime_default' },
        permissions: {
          adapterKind,
          schemaVersion: installation.snapshot.permissionSchemaVersion,
          values: permissionValues
        }
      }
    }
  })
  if (configured.status !== 'applied') {
    throw new Error(`${adapterKind} Agent Runtime was not configured: ${JSON.stringify(configured)}`)
  }
  return installation.snapshot.reportedVersion
}
