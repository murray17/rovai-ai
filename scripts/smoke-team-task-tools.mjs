import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureCodexRuntime } from './configure-codex-runtime.mjs'
import { configureProductRuntime } from './configure-product-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-team-task-tools-smoke-'))
const dataDir = join(fixtureRoot, 'data')
const adapterKind = process.env.ROVAI_TEAM_TARGET_ADAPTER ?? 'codex-cli'
const supportedAdapters = ['codex-cli', 'opencode-cli', 'copilot-cli', 'claude-code-cli']
let core = null

try {
  if (!supportedAdapters.includes(adapterKind)) {
    throw new Error(`Unsupported ROVAI_TEAM_TARGET_ADAPTER: ${adapterKind}`)
  }
  core = startCore(dataDir)
  const health = await core.request('health.check')
  const runtimeVersion = adapterKind === 'codex-cli'
    ? await configureCodexOnly(core.request, health)
    : await configureTargetRuntime(core.request, health, 'agent-muwa', adapterKind)
  const preflight = await core.request('camps.creationPreflight')
  const configuredMembers = preflight.presentMembers.filter((member) => member.runtimeConfigured)
  if (!preflight.admissible
      || configuredMembers.length !== 1
      || preflight.initialLeadAgentProfileId !== 'agent-muwa') {
    throw new Error(`Only the target member should have a configured Runtime: ${JSON.stringify(preflight)}`)
  }

  const title = `TASK_TOOL_DISCOVERY_${adapterKind}`
  const createdResponse = await core.request('camps.createFromFirstMessage', {
    commandId: crypto.randomUUID(),
    project: null,
    body: [
      '执行 Rovai-ai Task Tool 发现验收。必须按顺序实际调用下面三个工具，不要调用 team.post_message 或其他工具：',
      `1. team.create_task：title=${title}，description=runtime discovery smoke，不传 assigneeAgentId，创建未分配 Task。`,
      '2. team.list_tasks：列出 pending Task，确认刚创建的 Task并读取它的 id 与 version。',
      '3. team.update_task：使用刚才返回的 id 和 version；必须在同一次调用中传 assigneeAgentId=agent-muwa 且 status=completed，先认领再完成。',
      '三个工具都成功后只回复 TASK_TOOLS_OK。'
    ].join('\n'),
    purpose: `Verify ${adapterKind} discovers and invokes all three Rovai-ai Task tools.`,
    expectedOutput: 'One completed smoke Task and TASK_TOOLS_OK.'
  })
  const created = createdResponse.commandResult ?? createdResponse
  const campId = created.payload?.campId
  const agentRunId = created.payload?.agentRunIds?.[0]
  if (created.status !== 'accepted' || !campId || !agentRunId) {
    throw new Error(`Task Tool discovery Camp was not accepted: ${JSON.stringify(createdResponse)}`)
  }

  let lastState = null
  const snapshot = await waitFor(async () => {
    const candidate = await core.request('camps.snapshot', { campId })
    const run = candidate.agentRuns.find((value) => value.id === agentRunId)
    const task = candidate.tasks.find((value) => value.title === title)
    lastState = {
      run,
      task,
      recentMessages: candidate.messages.slice(-4),
      recentEvents: candidate.timeline.slice(-8),
      runtimeEvents: core.events.slice(-20)
    }
    if (run?.status === 'failed' || run?.status === 'cancelled') {
      throw new Error(`${adapterKind} Task Tool discovery failed: ${JSON.stringify(lastState)}`)
    }
    return run?.status === 'succeeded' && task?.status === 'completed'
      ? candidate
      : null
  }, `${adapterKind} Task Tool discovery`, 300_000, () => lastState)

  const task = snapshot.tasks.find((value) => value.title === title)
  const matchingTasks = snapshot.tasks.filter((value) => value.title === title)
  const manifest = snapshot.contextManifests.find((value) => value.agentRunId === agentRunId)
  if (snapshot.schemaVersion !== 9
      || snapshot.camp.defaultLeadAgentId !== 'agent-muwa'
      || !task
      || matchingTasks.length !== 1
      || task.assigneeAgentId !== 'agent-muwa'
      || task.sourceAgentRunId !== agentRunId
      || task.version !== 2
      || snapshot.inboxMessages.length !== 0
      || !manifest
      || manifest.formatterVersion !== 4
      || manifest.bootstrap?.contractVersion !== 'native_session_bootstrap_v1'
      || 'taskContextDigest' in manifest
      || manifest.delivery?.status !== 'accepted') {
    throw new Error(`Task Tool discovery produced invalid state: ${JSON.stringify({
      task,
      manifest,
      inboxMessages: snapshot.inboxMessages,
      camp: snapshot.camp
    })}`)
  }

  await core.stop()
  core = startCore(dataDir)
  const restored = await core.request('camps.snapshot', { campId })
  const restoredTask = restored.tasks.find((value) => value.id === task.id)
  if (restoredTask?.status !== 'completed'
      || restoredTask.version !== 2
      || restored.agentRuns.filter((value) => value.id === agentRunId).length !== 1) {
    throw new Error(`Restart changed Task Tool results: ${JSON.stringify(restoredTask)}`)
  }

  console.log(JSON.stringify({
    ok: true,
    adapterKind,
    runtimeVersion,
    campId,
    agentRunId,
    taskId: task.id,
    taskVersion: task.version,
    taskStatus: task.status,
    contextFormatterVersion: manifest.formatterVersion,
    bootstrapEvidenceId: manifest.bootstrap.id,
    inboxMessageCount: snapshot.inboxMessages.length,
    restoredWithoutDuplication: true
  }, null, 2))
} catch (error) {
  throw new Error(`${error.message}`)
} finally {
  if (core) await core.stop()
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function configureCodexOnly(request, health) {
  const installation = await configureCodexRuntime(request, health, ['agent-muwa'])
  return installation.snapshot.reportedVersion
}

async function configureTargetRuntime(request, _health, agentProfileId, targetAdapterKind) {
  const installation = await configureProductRuntime(
    request,
    targetAdapterKind,
    [agentProfileId]
  )
  return installation.snapshot.reportedVersion
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), ['--data-dir', dataDirectory], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.pipe(process.stderr)
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
    if (!stopped) rejectPending(new Error(`rovai-core exited early (code=${code}, signal=${signal})`))
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) {
      events.push(message)
      if (events.length > 100) events.shift()
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
  throw new Error(`Timed out waiting for ${label}; lastState=${JSON.stringify(describeLastState?.())}`)
}
