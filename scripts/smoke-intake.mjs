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
  await core.request('health.check')

  const structural = await core.request('camps.creationPreflight')
  if (!structural.admissible
      || !structural.initialLeadAgentId
      || structural.presentMembers.length === 0
      || structural.presentMembers.some((member) => member.runtimeConfigured)) {
    throw new Error(`Unconfigured present members could not create a Camp: ${JSON.stringify(structural)}`)
  }

  const beforeSelection = await core.request('navigation.snapshot')
  const selectedWorkspace = await core.request('workspaces.inspect', { path: projectRoot })
  const afterSelection = await core.request('navigation.snapshot')
  if (JSON.stringify(afterSelection) !== JSON.stringify(beforeSelection)) {
    throw new Error(`Inspecting a repository changed persistent navigation state: ${JSON.stringify({ beforeSelection, afterSelection })}`)
  }

  const createCommandId = crypto.randomUUID()
  const createRequest = {
    commandId: createCommandId,
    name: null,
    workspace: { projectPath: selectedWorkspace.projectPath },
    memberAgentIds: structural.presentMembers.map((member) => member.agentId),
    defaultLeadAgentId: structural.initialLeadAgentId,
    collaborationMode: 'peer'
  }
  const created = await core.request('camps.create', createRequest)
  const createReplay = await core.request('camps.create', createRequest)
  if (created.status !== 'applied' || created.code !== 'camp.created') {
    throw new Error(`Configured Camp creation was not applied: ${JSON.stringify(created)}`)
  }
  if (createReplay.commandId !== created.commandId
      || createReplay.requestDigest !== created.requestDigest
      || createReplay.payload?.campId !== created.payload?.campId) {
    throw new Error(`Configured Camp creation replay was not stable: ${JSON.stringify(createReplay)}`)
  }

  const campId = created.payload.campId
  let snapshot = await core.request('camps.snapshot', { campId })
  if (snapshot.camp.title !== '未命名对话'
      || snapshot.camp.projectBindingKind !== 'directory'
      || snapshot.camp.projectPath !== selectedWorkspace.projectPath
      || snapshot.camp.defaultLeadAgentId !== structural.initialLeadAgentId
      || snapshot.members.length !== structural.presentMembers.length
      || snapshot.messages.length !== 0
      || snapshot.turns.length !== 0
      || snapshot.agentRuns.length !== 0) {
    throw new Error(`Configured Camp was not empty at creation: ${JSON.stringify(snapshot)}`)
  }
  const navigationAfterCreation = await core.request('navigation.snapshot')
  if (!navigationAfterCreation.projects
    .flatMap((project) => project.recentCamps)
    .some((candidate) => candidate.id === campId && candidate.title === '未命名对话')) {
    throw new Error(`Empty Camp did not appear in navigation: ${JSON.stringify(navigationAfterCreation)}`)
  }

  await core.stop()
  core = startCore(dataDir)
  const restoredEmptySnapshot = await core.request('camps.snapshot', { campId })
  if (restoredEmptySnapshot.messages.length !== 0
      || restoredEmptySnapshot.turns.length !== 0
      || restoredEmptySnapshot.agentRuns.length !== 0) {
    throw new Error(`Empty Camp did not survive restart unchanged: ${JSON.stringify(restoredEmptySnapshot)}`)
  }

  const restoredHealth = await core.request('health.check')
  if (process.platform === 'win32'
      && process.env.ROVAI_WINDOWS_RUNTIME_QUALIFICATION_ADAPTER !== 'codex-cli') {
    let platformBlock = null
    try {
      await configureCodexRuntime(core.request, restoredHealth, ['agent_1'])
    } catch (error) {
      if (!String(error).includes('runtime_platform_not_qualified')) throw error
      platformBlock = 'runtime_platform_not_qualified'
    }
    if (!platformBlock) {
      throw new Error('Windows Runtime configuration did not fail closed at platform admission')
    }
    const deletion = await core.request('camps.delete', {
      commandId: crypto.randomUUID(),
      command: {
        campId,
        expectedVersion: restoredEmptySnapshot.camp.version
      }
    })
    if (deletion.status !== 'applied' || deletion.code !== 'camp.deleted') {
      throw new Error(`Quiescent Windows Camp could not be permanently deleted: ${JSON.stringify(deletion)}`)
    }
    await core.stop()
    core = startCore(dataDir)
    const afterDeletionRestart = await core.request('navigation.snapshot')
    if (afterDeletionRestart.quickChat.totalCount !== 0 || afterDeletionRestart.projects.length !== 0) {
      throw new Error(`Deleted Windows Camp or Project group returned after restart: ${JSON.stringify(afterDeletionRestart)}`)
    }
    console.log(JSON.stringify({
      ok: true,
      platform: 'windows-x64',
      campId,
      structuralIntake: true,
      emptyCampRestartStable: true,
      runtimeExecutionBlocked: platformBlock,
      deleted: true,
      deletionSurvivedRestart: true
    }, null, 2))
  } else {
  const codexInstallation = await configureCodexRuntime(core.request, restoredHealth, ['agent_1'])
  const ready = await core.request('camps.creationPreflight')
  if (!ready.admissible || ready.initialLeadAgentId !== 'agent_1') {
    throw new Error(`Ready-first Lead selection did not select Luoke: ${JSON.stringify(ready)}`)
  }

  const sendCommandId = crypto.randomUUID()
  const firstDraft = await saveComposerDraft(
    core.request,
    campId,
    'Reply with INTAKE_OK. Do not call tools.'
  )
  const firstRequest = {
    commandId: sendCommandId,
    campId,
    draftRevision: firstDraft.revision,
    execution: {
      taskId: null,
      purpose: 'Verify configured Camp intake and public reply.',
      completionRole: 'required'
    }
  }
  const firstResponse = await core.request('camp.messages.send', firstRequest)
  const replayResponse = await core.request('camp.messages.send', firstRequest)
  const first = firstResponse.commandResult
  const replay = replayResponse.commandResult
  if (first?.status !== 'accepted') {
    throw new Error(`Camp intake was not accepted: ${JSON.stringify(first)}`)
  }
  if (replay?.commandId !== first.commandId || replay.requestDigest !== first.requestDigest) {
    throw new Error(`Camp intake replay was not stable: ${JSON.stringify(replay)}`)
  }

  snapshot = await waitFor(core.request, async () => {
    const candidate = await core.request('camps.snapshot', { campId })
    return candidate.agentRuns[0]?.status === 'succeeded'
      && candidate.messages.some((message) => message.authorType === 'agent' && message.body.includes('INTAKE_OK'))
      ? candidate
      : null
  }, 'first Camp AgentRun')
  if (snapshot.camp.defaultLeadAgentId !== structural.initialLeadAgentId
      || snapshot.camp.title === '未命名对话'
      || snapshot.members.length !== 4
      || snapshot.turns.length !== 1
      || snapshot.agentRuns.length !== 1
      || snapshot.agentRuns[0].startingGitObservation?.state !== 'git_valid'
      || snapshot.agentRuns[0].endingGitObservation?.state !== 'git_valid') {
    throw new Error(`Camp intake produced the wrong domain cardinality: ${JSON.stringify(snapshot)}`)
  }

  const firstConversationId = snapshot.agentRuns[0].conversationId
  const followUpDraft = await saveComposerDraft(
    core.request,
    campId,
    'Reply with CONTINUE_OK. Do not call tools.'
  )
  const followUp = await core.request('camp.messages.send', {
    commandId: crypto.randomUUID(),
    campId,
    draftRevision: followUpDraft.revision,
    execution: {
      taskId: null,
      purpose: 'Verify continued Camp conversation.',
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
  if (afterDeletion.quickChat.totalCount !== 0 || afterDeletion.projects.length !== 0) {
    throw new Error(`Deleting the last Camp left a Project navigation group: ${JSON.stringify(afterDeletion)}`)
  }

  await core.stop()
  core = startCore(dataDir)
  const afterDeletionRestart = await core.request('navigation.snapshot')
  if (afterDeletionRestart.quickChat.totalCount !== 0 || afterDeletionRestart.projects.length !== 0) {
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
  }
} finally {
  if (core) await core.stop()
  if (process.env.ROVAI_KEEP_SMOKE_FIXTURE === '1') {
    console.error(`Preserved smoke fixture: ${fixtureRoot}`)
  } else {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), [
    '--data-dir', dataDirectory,
    '--skill-library-root', join(dataDirectory, 'managed-skill-library')
  ], {
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
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`))
    else request.resolve(message.result)
  })
  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`Timed out waiting for ${method}`))
    }, 90_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer, method })
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

async function saveComposerDraft(request, campId, body) {
  const current = await request('camp.composerDraft.get', { campId })
  return request('camp.composerDraft.save', {
    campId,
    expectedRevision: current.revision,
    content: [{ kind: 'text', text: body }]
  })
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
