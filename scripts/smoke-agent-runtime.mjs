import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureCodexRuntime } from './configure-codex-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'lumen-agent-runtime-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
let core
let shuttingDown = false

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Agent runtime fixture\n')
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Lumen Agent Runtime Smoke'], projectRoot)
  await run('git', ['config', 'user.email', 'agent-runtime@lumen.local'], projectRoot)
  await run('git', ['add', 'README.md'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  core = spawn(join(root, 'target', 'debug', 'lumen-core'), ['--data-dir', dataDir], {
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
  core.once('error', (error) => rejectPending(error))
  core.once('close', (code, signal) => {
    if (!shuttingDown) {
      rejectPending(new Error(`lumen-core exited early (code=${code}, signal=${signal})`))
    }
  })
  const lines = createInterface({ input: core.stdout })
  lines.once('close', () => {
    if (!shuttingDown) rejectPending(new Error('lumen-core stdout closed early'))
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
  if (health.codex.status !== 'ready') {
    throw new Error(`Codex health gate failed: ${JSON.stringify(health.codex)}`)
  }
  const project = await request('projects.open', { path: projectRoot })
  const camps = await request('camps.list')
  const camp = camps.find((candidate) => candidate.projectPath === project.rootPath)
  if (!camp?.defaultLeadAgentId) throw new Error('Project Camp has no Default Lead')
  const runtimeInstallation = await configureCodexRuntime(request, health, [camp.defaultLeadAgentId])
  const preflight = await request('execution.preflight', {
    campId: camp.id,
    address: { mode: 'explicit', agentProfileIds: [camp.defaultLeadAgentId] }
  })
  if (!preflight.admissible || !preflight.workspace) {
    throw new Error(`AgentRun preflight failed: ${JSON.stringify(preflight)}`)
  }

  const commandId = crypto.randomUUID()
  const intake = await request('tasks.createAndQueueExecution', {
    commandId,
    campId: camp.id,
    title: 'Real AgentRun smoke',
    objective: 'Do not call tools or inspect files. Reply with exactly LUMEN_AGENT_RUN_OK and nothing else.',
    acceptanceCriteria: [],
    assigneeAgentId: camp.defaultLeadAgentId,
    dedupKey: `agent-runtime-smoke:${commandId}`,
    purpose: 'Return the requested fixed smoke-test token without using tools',
    expectedOutput: 'Exactly LUMEN_AGENT_RUN_OK',
    workspace: preflight.workspace
  })
  if (intake.execution?.status !== 'accepted') {
    throw new Error(`AgentRun intake failed: ${JSON.stringify(intake)}`)
  }

  let snapshot
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    snapshot = await request('camps.snapshot', { campId: camp.id })
    const run = snapshot.agentRuns.find((candidate) => candidate.id === intake.execution.payload.agentRunId)
    if (run?.status === 'succeeded') break
    if (run?.status === 'failed' || run?.status === 'cancelled') {
      throw new Error(`AgentRun entered ${run.status}: ${JSON.stringify(snapshot.timeline.slice(-10))}`)
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  const agentRun = snapshot?.agentRuns.find((candidate) => candidate.id === intake.execution.payload.agentRunId)
  if (agentRun?.status !== 'succeeded') {
    throw new Error(`AgentRun did not finish before timeout: ${JSON.stringify(agentRun)}`)
  }
  const turn = snapshot.turns.find((candidate) => candidate.id === agentRun.campTurnId)
  if (turn?.status !== 'completed') {
    throw new Error(`CampTurn did not aggregate to completed: ${JSON.stringify(turn)}`)
  }
  const output = snapshot.messages.find((message) => message.sourceAgentRunId === agentRun.id)
  if (!output?.body.includes('LUMEN_AGENT_RUN_OK')) {
    throw new Error(`Final public Camp output is missing: ${JSON.stringify(output)}`)
  }
  if (snapshot.tasks[0]?.status !== 'in_progress') {
    throw new Error(`Agent self-report changed Task authority: ${JSON.stringify(snapshot.tasks[0])}`)
  }
  if (events.some((event) => event.method === 'agent_run.request_rejected')) {
    throw new Error(`No-tool smoke unexpectedly requested a restricted action: ${JSON.stringify(events)}`)
  }

  const profile = await request('agents.get', { agentProfileId: camp.defaultLeadAgentId })
  const changedPermissions = await request('agents.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentProfileId: camp.defaultLeadAgentId,
      expectedVersion: profile.version,
      runtime: {
        installationId: runtimeInstallation.id,
        model: { mode: 'runtime_default' },
        permissions: {
          adapterKind: 'codex-cli',
          schemaVersion: runtimeInstallation.snapshot.permissionSchemaVersion,
          values: {
            sandbox_mode: 'read-only',
            approval_policy: 'on-request'
          }
        }
      }
    }
  })
  if (changedPermissions.status !== 'applied') {
    throw new Error(`Session-scoped permission change failed: ${JSON.stringify(changedPermissions)}`)
  }
  const handoff = await request('camp.messages.send', {
    commandId: crypto.randomUUID(),
    campId: camp.id,
    body: 'Do not call tools. Reply with exactly LUMEN_HANDOFF_OK and nothing else.',
    address: { mode: 'explicit', agentProfileIds: [camp.defaultLeadAgentId] },
    replyToCampMessageId: null,
    execution: {
      taskId: null,
      purpose: 'Verify that a Session-scoped permission change creates a fresh Native Session',
      expectedOutput: 'Exactly LUMEN_HANDOFF_OK',
      completionRole: 'required'
    }
  })
  const handoffRunId = handoff.commandResult?.payload?.agentRunIds?.[0]
  if (handoff.commandResult?.status !== 'accepted' || !handoffRunId) {
    throw new Error(`Handoff AgentRun was not accepted: ${JSON.stringify(handoff)}`)
  }
  const handoffDeadline = Date.now() + 150_000
  while (Date.now() < handoffDeadline) {
    snapshot = await request('camps.snapshot', { campId: camp.id })
    const run = snapshot.agentRuns.find((candidate) => candidate.id === handoffRunId)
    if (run?.status === 'succeeded') break
    if (run?.status === 'failed' || run?.status === 'cancelled') {
      throw new Error(`Handoff AgentRun entered ${run.status}: ${JSON.stringify(run)}`)
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  const handoffRun = snapshot.agentRuns.find((candidate) => candidate.id === handoffRunId)
  const starts = events.filter((event) =>
    event.method === 'agent_run.started'
      && [agentRun.id, handoffRunId].includes(event.params?.agentRunId)
  )
  if (handoffRun?.status !== 'succeeded'
      || starts.length !== 2
      || starts[0].params.nativeThreadId === starts[1].params.nativeThreadId) {
    throw new Error(`Incompatible Session configuration did not hand off cleanly: ${JSON.stringify({ handoffRun, starts })}`)
  }

  console.log(JSON.stringify({
    ok: true,
    runtime: health.codex.reportedVersion,
    agentRunId: agentRun.id,
    executionEpoch: agentRun.executionEpoch,
    agentRunStatus: agentRun.status,
    campTurnStatus: turn.status,
    taskStatus: snapshot.tasks[0].status,
    publicOutput: output.body,
    handoffRunId,
    nativeSessionReplaced: true
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

async function run(command, args, cwd) {
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
