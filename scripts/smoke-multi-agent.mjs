import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureCodexRuntime } from './configure-codex-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-multi-agent-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
let core
let shuttingDown = false

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Multi-Agent fixture\n')
  await runCommand('git', ['init', '-b', 'main'], projectRoot)
  await runCommand('git', ['config', 'user.name', 'Rovai-ai Multi-Agent Smoke'], projectRoot)
  await runCommand('git', ['config', 'user.email', 'multi-agent@rovai.local'], projectRoot)
  await runCommand('git', ['add', 'README.md'], projectRoot)
  await runCommand('git', ['commit', '-m', 'fixture'], projectRoot)

  core = spawn(join(root, 'target', 'debug', 'rovai-core'), ['--data-dir', dataDir], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  core.stderr.pipe(process.stderr)
  const pending = new Map()
  const events = []
  let nextId = 1
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  core.once('error', rejectPending)
  core.once('close', (code, signal) => {
    if (!shuttingDown) rejectPending(new Error(`rovai-core exited early (code=${code}, signal=${signal})`))
  })
  const lines = createInterface({ input: core.stdout })
  lines.once('close', () => {
    if (!shuttingDown) rejectPending(new Error('rovai-core stdout closed early'))
  })
  lines.on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) {
      events.push(message)
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
    }, 70_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    core.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })

  const health = await request('health.check')
  const targetIds = ['agent-muwa', 'agent-luoke']
  const codexInstallation = await configureCodexRuntime(request, health, targetIds)
  const project = await request('repositories.inspect', { path: projectRoot })

  const result = await createConfiguredCampAndSend(request, {
    commandId: crypto.randomUUID(),
    project,
    body: 'Do not call tools or inspect files. Reply with MULTI_AGENT_OK followed by your own AgentProfile ID.',
    address: { mode: 'explicit', agentProfileIds: targetIds },
    purpose: 'Independently return a multi-Agent smoke token and your AgentProfile ID without tools',
    expectedOutput: 'A public answer containing MULTI_AGENT_OK and the executing AgentProfile ID'
  })
  const campId = result.payload?.campId
  if (result.status !== 'accepted' || !campId || result.payload.agentRunIds?.length !== 2) {
    throw new Error(`Two-Agent command was not atomically accepted: ${JSON.stringify(result)}`)
  }
  const commandResult = result
  const initial = await request('camps.snapshot', { campId })
  for (const targetId of targetIds) {
    if (!initial.members.some((member) => member.agentProfileId === targetId)) {
      throw new Error(`Camp is missing ${targetId}`)
    }
  }

  let snapshot
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    snapshot = await request('camps.snapshot', { campId })
    const runs = snapshot.agentRuns.filter((candidate) => commandResult.payload.agentRunIds.includes(candidate.id))
    if (runs.some((run) => run.status === 'failed' || run.status === 'cancelled')) {
      throw new Error(`One AgentRun failed: ${JSON.stringify(runs)}`)
    }
    if (runs.length === 2 && runs.every((run) => run.status === 'succeeded')) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  const runs = snapshot?.agentRuns.filter((candidate) => commandResult.payload.agentRunIds.includes(candidate.id)) ?? []
  if (runs.length !== 2 || !runs.every((run) => run.status === 'succeeded')) {
    throw new Error(`Two AgentRuns did not finish: ${JSON.stringify(runs)}`)
  }
  if (new Set(runs.map((run) => run.conversationId)).size !== 2) {
    throw new Error(`AgentRuns shared one Conversation: ${JSON.stringify(runs)}`)
  }
  const turn = snapshot.turns.find((candidate) => candidate.id === commandResult.payload.campTurnId)
  if (turn?.status !== 'completed') {
    throw new Error(`CampTurn did not complete: ${JSON.stringify(turn)}`)
  }
  const outputs = snapshot.messages.filter((message) => commandResult.payload.agentRunIds.includes(message.sourceAgentRunId))
  if (outputs.length !== 2 || outputs.some((output) => !output.body.includes('MULTI_AGENT_OK'))) {
    throw new Error(`Public Agent outputs are incomplete: ${JSON.stringify(outputs)}`)
  }
  const starts = events.filter((event) =>
    event.method === 'agent_run.started'
      && commandResult.payload.agentRunIds.includes(event.params?.agentRunId)
  )
  if (starts.length !== 2
      || new Set(starts.map((event) => event.params.hostInstanceId)).size !== 1
      || new Set(starts.map((event) => event.params.nativeThreadId)).size !== 2
      || new Set(starts.map((event) => event.params.nativeTurnId)).size !== 2) {
    throw new Error(`Native identities crossed or were missing: ${JSON.stringify(starts)}`)
  }
  const firstTerminalIndex = events.findIndex((event) =>
    event.method === 'agent_run.terminal'
      && commandResult.payload.agentRunIds.includes(event.params?.agentRunId)
  )
  const secondStartIndex = events.findIndex((event) =>
    event.method === 'agent_run.started'
      && event.params?.agentRunId === starts[1]?.params?.agentRunId
  )
  if (firstTerminalIndex !== -1 && secondStartIndex > firstTerminalIndex) {
    throw new Error('AgentRuns executed serially instead of overlapping')
  }
  if (events.some((event) => event.method === 'agent_run.request_rejected')) {
    throw new Error(`No-tool multi-Agent smoke requested a restricted action: ${JSON.stringify(events)}`)
  }
  const reasoningSummaryEvents = events.filter((event) =>
    event.method === 'agent.reasoning.summary.delta'
      && commandResult.payload.agentRunIds.includes(event.params?.agentRunId)
  )
  const completedReasoningItems = events.filter((event) =>
    event.method === 'activity.completed'
      && commandResult.payload.agentRunIds.includes(event.params?.agentRunId)
      && event.params?.payload?.item?.type === 'reasoning'
      && event.params.payload.item.summary?.some((part) => typeof part === 'string' && part.trim())
  )
  const progressNarrationEvents = events.filter((event) =>
    event.method === 'agent.text.delta'
      && commandResult.payload.agentRunIds.includes(event.params?.agentRunId)
      && typeof event.params?.payload?.delta === 'string'
  )
  if (progressNarrationEvents.length === 0) {
    throw new Error('Codex did not publish any live Agent progress narration events')
  }

  console.log(JSON.stringify({
    ok: true,
    runtime: codexInstallation.snapshot.reportedVersion,
    campTurnStatus: turn.status,
    agentRuns: runs.map((run) => ({
      id: run.id,
      agentProfileId: run.agentProfileId,
      conversationId: run.conversationId,
      executionEpoch: run.executionEpoch,
      status: run.status
    })),
    nativeThreads: starts.map((event) => event.params.nativeThreadId),
    hostInstanceId: starts[0].params.hostInstanceId,
    reasoningSummaryEvents: reasoningSummaryEvents.length,
    completedReasoningItems: completedReasoningItems.length,
    progressNarrationEvents: progressNarrationEvents.length,
    outputs: outputs.map((output) => output.body)
  }, null, 2))
} finally {
  if (core && !core.killed) {
    shuttingDown = true
    core.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => core.once('close', resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000))
    ])
    if (core.exitCode === null) core.kill('SIGTERM')
  }
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function runCommand(command, args, cwd) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stderr = []
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code) => code === 0
      ? resolveRun()
      : rejectRun(new Error(`${command} failed (${code}): ${stderr.join('')}`)))
  })
}
