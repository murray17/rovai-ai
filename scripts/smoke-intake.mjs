import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'lumen-intake-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
let core

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Intake fixture\n')
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Lumen Intake Smoke'], projectRoot)
  await run('git', ['config', 'user.email', 'intake@lumen.local'], projectRoot)
  await run('git', ['add', 'README.md'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  core = spawn(join(root, 'target', 'debug', 'lumen-core'), ['--data-dir', dataDir], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  core.stderr.pipe(process.stderr)
  const pending = new Map()
  let nextId = 1
  createInterface({ input: core.stdout }).on('line', (line) => {
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
    }, 70_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    core.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })

  const health = await request('health.check')
  if (health.codex.status !== 'ready') {
    throw new Error(`Codex preflight dependency is unavailable: ${JSON.stringify(health.codex)}`)
  }
  const project = await request('projects.open', { path: projectRoot })
  const camps = await request('camps.list')
  const camp = camps.find((candidate) => candidate.projectPath === project.rootPath)
  if (!camp?.defaultLeadAgentId) throw new Error('Project Camp has no Default Lead')

  const unavailable = await request('execution.preflight', {
    campId: camp.id,
    address: { mode: 'explicit', agentProfileIds: ['missing-agent'] }
  })
  if (unavailable.admissible || unavailable.blockers[0]?.code !== 'agent_unavailable') {
    throw new Error(`Unavailable Agent was not returned as a blocker: ${JSON.stringify(unavailable)}`)
  }

  const preflight = await request('execution.preflight', {
    campId: camp.id,
    address: { mode: 'explicit', agentProfileIds: [camp.defaultLeadAgentId] }
  })
  if (!preflight.admissible || !preflight.workspace) {
    throw new Error(`Valid execution was not admissible: ${JSON.stringify(preflight)}`)
  }
  const staleWorkspaceResult = await request('tasks.createAndQueueExecution', {
    commandId: crypto.randomUUID(),
    campId: camp.id,
    title: 'Stale workspace must not persist',
    objective: 'This request must be rejected before the domain transaction.',
    acceptanceCriteria: [],
    assigneeAgentId: camp.defaultLeadAgentId,
    dedupKey: null,
    purpose: 'Exercise stale preflight handling',
    expectedOutput: 'No domain objects',
    workspace: {
      ...preflight.workspace,
      baseGitCommit: '0000000000000000000000000000000000000000'
    }
  })
  if (staleWorkspaceResult.execution !== null
      || staleWorkspaceResult.preflight?.blockers[0]?.code !== 'workspace_invalid') {
    throw new Error(`Stale Workspace was not rejected before intake: ${JSON.stringify(staleWorkspaceResult)}`)
  }
  const commandId = crypto.randomUUID()
  const params = {
    commandId,
    campId: camp.id,
    title: 'Atomic intake smoke',
    objective: 'Persist one Task, CampTurn and AgentRun without starting the Runtime.',
    acceptanceCriteria: [{ id: 'atomic', text: 'One queued AgentRun exists.' }],
    assigneeAgentId: camp.defaultLeadAgentId,
    dedupKey: `intake-smoke:${commandId}`,
    purpose: 'Verify atomic intake',
    expectedOutput: 'A durable queued AgentRun',
    workspace: preflight.workspace
  }
  const first = await request('tasks.createAndQueueExecution', params)
  const replay = await request('tasks.createAndQueueExecution', params)
  if (first.execution?.status !== 'accepted' || first.execution.code !== 'task.execution_queued') {
    throw new Error(`Atomic intake was not accepted: ${JSON.stringify(first)}`)
  }
  if (!replay.replayed || replay.execution?.commandId !== first.execution.commandId) {
    throw new Error(`Command replay was not stable: ${JSON.stringify(replay)}`)
  }
  const snapshot = await request('camps.snapshot', { campId: camp.id })
  if (snapshot.tasks.length !== 1 || snapshot.turns.length !== 1 || snapshot.agentRuns.length !== 1) {
    throw new Error(`Atomic intake created the wrong cardinality: ${JSON.stringify(snapshot)}`)
  }
  if (snapshot.tasks[0].status !== 'pending' || snapshot.agentRuns[0].status !== 'queued') {
    throw new Error(`Intake changed execution state too early: ${JSON.stringify(snapshot)}`)
  }

  console.log(JSON.stringify({
    ok: true,
    runtime: health.codex.reportedVersion,
    taskId: snapshot.tasks[0].id,
    taskStatus: snapshot.tasks[0].status,
    agentRunStatus: snapshot.agentRuns[0].status,
    replayed: replay.replayed
  }, null, 2))
} finally {
  if (core && !core.killed) {
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
