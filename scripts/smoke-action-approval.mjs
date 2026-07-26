import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureCodexRuntime } from './configure-codex-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-action-approval-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const approvedMarker = join(fixtureRoot, 'approved-by-rovai')
const dataDir = join(fixtureRoot, 'data')
let core
let shuttingDown = false

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Action Approval fixture\n')
  await runCommand('git', ['init', '-b', 'main'], projectRoot)
  await runCommand('git', ['config', 'user.name', 'Rovai-ai Action Smoke'], projectRoot)
  await runCommand('git', ['config', 'user.email', 'action-smoke@rovai.local'], projectRoot)
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

  const health = await request('health.check', { refreshRuntimeProbe: true })
  if (health.codex.status !== 'ready') {
    throw new Error(`Codex health gate failed: ${JSON.stringify(health.codex)}`)
  }
  await configureCodexRuntime(request, health, ['agent-muwa'])
  const project = await request('repositories.inspect', { path: projectRoot })

  const result = await request('camps.createFromFirstMessage', {
    commandId: crypto.randomUUID(),
    project,
    body: `Run exactly this command with the shell tool: /usr/bin/touch ${approvedMarker}. The target is intentionally outside the project. Request approval, then after it succeeds reply ACTION_APPROVAL_OK.`,
    address: { mode: 'explicit', agentProfileIds: ['agent-muwa'] },
    purpose: 'Exercise one exact Rovai-ai Action Approval and then report success',
    expectedOutput: 'ACTION_APPROVAL_OK after the approved marker is created'
  })
  const campId = result.payload?.campId
  const agentRunId = result.payload?.agentRunIds?.[0]
  if (result.status !== 'accepted' || !campId || !agentRunId) {
    throw new Error(`Action smoke was not accepted: ${JSON.stringify(result)}`)
  }

  const resolvedApprovals = new Set()
  let snapshot
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    snapshot = await request('camps.snapshot', { campId })
    for (const approval of snapshot.approvals.filter((candidate) =>
      candidate.status === 'pending'
        && !resolvedApprovals.has(candidate.id)
        && snapshot.actions.some((action) => action.id === candidate.actionId && action.agentRunId === agentRunId)
    )) {
      const resolution = await request('action.approvals.resolve', {
        commandId: crypto.randomUUID(),
        campId,
        approvalId: approval.id,
        expectedVersion: approval.version,
        decision: 'approve',
        reason: 'Real Action Approval smoke test'
      })
      if (resolution.status === 'rejected') {
        throw new Error(`Approval resolution was rejected: ${JSON.stringify(resolution)}`)
      }
      resolvedApprovals.add(approval.id)
    }
    const run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    const runActions = snapshot.actions.filter((action) => action.agentRunId === agentRunId)
    if (runActions.some((action) => ['failed', 'not_executed', 'unknown'].includes(action.status))) {
      throw new Error(`Action did not converge safely: ${JSON.stringify(runActions)}`)
    }
    if (run?.status === 'failed' || run?.status === 'cancelled') {
      throw new Error(`AgentRun failed: ${JSON.stringify(run)}`)
    }
    if (run?.status === 'succeeded') break
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }

  const run = snapshot?.agentRuns.find((candidate) => candidate.id === agentRunId)
  const runActions = snapshot?.actions.filter((action) => action.agentRunId === agentRunId) ?? []
  if (run?.status !== 'succeeded') {
    throw new Error(`AgentRun did not finish: ${JSON.stringify(run)}`)
  }
  if (resolvedApprovals.size === 0 || !runActions.some((action) => action.status === 'succeeded')) {
    throw new Error(`No approved Action reached succeeded: ${JSON.stringify(runActions)}`)
  }
  await access(approvedMarker)
  const output = snapshot.messages.find((message) => message.sourceAgentRunId === agentRunId)
  if (!output?.body.includes('ACTION_APPROVAL_OK')) {
    throw new Error(`Agent output did not confirm completion: ${JSON.stringify(output)}`)
  }
  if (events.some((event) =>
    event.method === 'agent_run.request_rejected'
      && event.params?.agentRunId === agentRunId
  )) {
    throw new Error(`A supported Action request was rejected: ${JSON.stringify(events)}`)
  }

  console.log(JSON.stringify({
    ok: true,
    runtime: health.codex.reportedVersion,
    agentRunId,
    approvalsResolved: resolvedApprovals.size,
    actions: runActions.map((action) => ({
      id: action.id,
      kind: action.actionKind,
      controlMode: action.controlMode,
      status: action.status,
      effectDisposition: action.effectDisposition
    })),
    output: output.body
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
