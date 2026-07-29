import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureCodexRuntime } from './configure-codex-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-camp-intake-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
let core = null

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Camp intake fixture\n')
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Rovai-ai Camp Intake Smoke'], projectRoot)
  await run('git', ['config', 'user.email', 'camp-intake@rovai.local'], projectRoot)
  await run('git', ['add', 'README.md'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  core = startCore(dataDir)
  const health = await core.request('health.check')

  const blocked = await core.request('camps.creationPreflight')
  if (blocked.admissible || blocked.blockers[0]?.code !== 'no_runtime_configured_members') {
    throw new Error(`Unconfigured members did not block Camp creation: ${JSON.stringify(blocked)}`)
  }

  const beforeSelection = await core.request('navigation.snapshot')
  const selectedProject = await core.request('repositories.inspect', { path: projectRoot })
  const afterSelection = await core.request('navigation.snapshot')
  if (JSON.stringify(afterSelection) !== JSON.stringify(beforeSelection)) {
    throw new Error(`Inspecting a repository changed persistent navigation state: ${JSON.stringify({ beforeSelection, afterSelection })}`)
  }

  const codexInstallation = await configureCodexRuntime(core.request, health, ['agent-luoke'])
  const ready = await core.request('camps.creationPreflight')
  if (!ready.admissible || ready.initialLeadAgentProfileId !== 'agent-luoke') {
    throw new Error(`Member order did not select Luoke as initial Lead: ${JSON.stringify(ready)}`)
  }

  const commandId = crypto.randomUUID()
  const firstRequest = {
    commandId,
    project: selectedProject,
    body: 'Reply with INTAKE_OK. Do not call tools.',
    purpose: 'Verify Camp-first atomic intake and public reply.',
    expectedOutput: 'A public reply containing INTAKE_OK.'
  }
  const first = await core.request('camps.createFromFirstMessage', firstRequest)
  const replay = await core.request('camps.createFromFirstMessage', firstRequest)
  if (first.status !== 'accepted' || first.code !== 'camp.created_and_queued') {
    throw new Error(`Camp intake was not accepted: ${JSON.stringify(first)}`)
  }
  if (replay.commandId !== first.commandId || replay.requestDigest !== first.requestDigest) {
    throw new Error(`Camp intake replay was not stable: ${JSON.stringify(replay)}`)
  }

  const campId = first.payload.campId
  let snapshot = await waitFor(core.request, async () => {
    const candidate = await core.request('camps.snapshot', { campId })
    return candidate.agentRuns[0]?.status === 'succeeded'
      && candidate.messages.some((message) => message.authorType === 'agent' && message.body.includes('INTAKE_OK'))
      ? candidate
      : null
  }, 'first Camp AgentRun')
  if (snapshot.camp.defaultLeadAgentId !== 'agent-luoke'
      || snapshot.members.length !== 4
      || snapshot.turns.length !== 1
      || snapshot.agentRuns.length !== 1) {
    throw new Error(`Camp intake produced the wrong domain cardinality: ${JSON.stringify(snapshot)}`)
  }

  const firstConversationId = snapshot.agentRuns[0].conversationId
  const followUp = await core.request('camp.messages.send', {
    commandId: crypto.randomUUID(),
    campId,
    body: 'Reply with CONTINUE_OK. Do not call tools.',
    address: { mode: 'default' },
    replyToCampMessageId: null,
    execution: {
      taskId: null,
      purpose: 'Verify continued Camp conversation.',
      expectedOutput: 'A public reply containing CONTINUE_OK.',
      completionRole: 'required'
    }
  })
  if (followUp.commandResult?.status !== 'accepted') {
    throw new Error(`Follow-up Camp message was not accepted: ${JSON.stringify(followUp)}`)
  }
  snapshot = await waitFor(core.request, async () => {
    const candidate = await core.request('camps.snapshot', { campId })
    return candidate.agentRuns.length === 2
      && candidate.agentRuns.every((agentRun) => agentRun.status === 'succeeded')
      && candidate.messages.some((message) => message.authorType === 'agent' && message.body.includes('CONTINUE_OK'))
      ? candidate
      : null
  }, 'follow-up Camp AgentRun')
  if (snapshot.agentRuns[1].conversationId !== firstConversationId) {
    throw new Error('The same Camp member did not retain one logical Conversation')
  }

  await core.stop()
  core = startCore(dataDir)
  const restoredNavigation = await core.request('navigation.snapshot')
  const restoredCamp = restoredNavigation.projects
    .flatMap((project) => project.recentCamps)
    .find((candidate) => candidate.id === campId)
  const restoredSnapshot = await core.request('camps.snapshot', { campId })
  if (!restoredCamp || restoredSnapshot.messages.length !== snapshot.messages.length
      || restoredSnapshot.agentRuns[1]?.conversationId !== firstConversationId) {
    throw new Error('Core restart did not restore the same Camp and Conversation')
  }

  const deletion = await core.request('camps.delete', {
    commandId: crypto.randomUUID(),
    command: {
      campId,
      expectedVersion: restoredSnapshot.camp.version
    }
  })
  if (deletion.status !== 'applied' || deletion.code !== 'camp.deleted') {
    throw new Error(`Quiescent Camp could not be permanently deleted: ${JSON.stringify(deletion)}`)
  }
  const afterDeletion = await core.request('navigation.snapshot')
  if (afterDeletion.lobby.totalCount !== 0 || afterDeletion.projects.length !== 0) {
    throw new Error(`Deleting the last Camp left a Project navigation group: ${JSON.stringify(afterDeletion)}`)
  }

  await core.stop()
  core = startCore(dataDir)
  const afterDeletionRestart = await core.request('navigation.snapshot')
  if (afterDeletionRestart.lobby.totalCount !== 0 || afterDeletionRestart.projects.length !== 0) {
    throw new Error(`Deleted Camp or Project group returned after restart: ${JSON.stringify(afterDeletionRestart)}`)
  }

  console.log(JSON.stringify({
    ok: true,
    runtime: codexInstallation.snapshot.reportedVersion,
    campId,
    defaultLeadAgentId: snapshot.camp.defaultLeadAgentId,
    memberCount: snapshot.members.length,
    messageCount: snapshot.messages.length,
    agentRunCount: snapshot.agentRuns.length,
    conversationId: firstConversationId,
    restored: true,
    deleted: true,
    projectGroupRemoved: true,
    deletionSurvivedRestart: true
  }, null, 2))
} finally {
  if (core) await core.stop()
  await rm(fixtureRoot, { recursive: true, force: true })
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), ['--data-dir', dataDirectory], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.pipe(process.stderr)
  const pending = new Map()
  let nextId = 1
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
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3_000))
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  return { request, stop }
}

async function waitFor(request, probe, label) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const result = await probe(request)
    if (result) return result
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error(`Timed out waiting for ${label}`)
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
