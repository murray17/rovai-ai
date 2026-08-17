import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureCodexRuntime } from './configure-codex-runtime.mjs'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-antigravity-runtime-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
let core
let shuttingDown = false

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Antigravity Runtime fixture\n')
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Rovai-ai Antigravity Runtime Smoke'], projectRoot)
  await run('git', ['config', 'user.email', 'antigravity-runtime@rovai.local'], projectRoot)
  await run('git', ['add', 'README.md'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  core = spawn(join(root, 'target', 'debug', 'rovai-core'), [
    '--data-dir', dataDir,
    '--skill-library-root', join(dataDir, 'managed-skill-library')
  ], {
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
  createInterface({ input: core.stdout }).on('line', (line) => {
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
    }, 120_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    core.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })

  const health = await request('health.check')
  const workspace = await request('workspaces.inspect', { path: projectRoot })

  const installation = await configureProductRuntime(
    request,
    'antigravity-app',
    ['agent_1']
  )
  const snapshot = installation?.snapshot
  const permissionKeys = snapshot?.permissionOptions.map((value) => value.key) ?? []
  if (snapshot?.probeStatus !== 'ready'
      || !snapshot.models.some((model) => model.id === 'gemini-3.6-flash-high')
      || !snapshot.models.some((model) => model.id === 'antigravity://runtime-default' && model.isDefault)
      || !['mode', 'sandbox', 'dangerously_skip_permissions'].every((key) => permissionKeys.includes(key))
      || !snapshot.capabilities.includes('output.stream_json')
      || snapshot.capabilities.includes('structured_permission_request')) {
    throw new Error(`Antigravity capability snapshot is invalid: ${JSON.stringify(snapshot)}`)
  }

  let profile = await request('members.get', { agentId: 'agent_1' })
  const permissionsConfigured = await request('members.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentId: profile.agentId,
      expectedVersion: profile.version,
      adapterKind: 'antigravity-app',
      model: profile.runtimeConfiguration.model,
      permissions: {
        adapterKind: 'antigravity-app',
        schemaVersion: 1,
        values: {
          mode: 'accept-edits',
          sandbox: 'on',
          dangerously_skip_permissions: 'on'
        }
      }
    }
  })
  if (permissionsConfigured.status !== 'applied') {
    throw new Error(`Antigravity smoke permissions were rejected: ${JSON.stringify(permissionsConfigured)}`)
  }
  profile = await request('members.get', { agentId: profile.agentId })
  if (profile.runtimeConfiguration?.permissions?.values?.dangerously_skip_permissions !== 'on') {
    throw new Error(`Antigravity smoke permissions drifted: ${JSON.stringify(profile.runtimeConfiguration)}`)
  }

  const first = await executeToken(
    request,
    null,
    profile.agentId,
    'ROVAI_ANTIGRAVITY_RUN_ONE',
    workspace
  )
  const camp = { id: first.campId, defaultLeadAgentId: profile.agentId }
  const firstBound = events.find((event) =>
    event.method === 'agent_run.native_session_bound' && event.params?.agentRunId === first.agentRunId
  )
  const nativeSessionId = firstBound?.params?.nativeThreadId
  if (!nativeSessionId || !isUuid(nativeSessionId)) {
    throw new Error(`Antigravity did not expose a verified Native Session: ${JSON.stringify(firstBound)}`)
  }

  const second = await executeToken(request, camp, profile.agentId, 'ROVAI_ANTIGRAVITY_RUN_TWO')
  const secondBound = events.find((event) =>
    event.method === 'agent_run.native_session_bound' && event.params?.agentRunId === second.agentRunId
  )
  if (secondBound?.params?.nativeThreadId !== nativeSessionId) {
    throw new Error(`Antigravity Conversation did not resume its Native Session: ${JSON.stringify({ firstBound, secondBound })}`)
  }
  const command = await executeCommandOutput(request, camp, profile.agentId, events)
  const commandBound = events.find((event) =>
    event.method === 'agent_run.native_session_bound' && event.params?.agentRunId === command.agentRunId
  )
  if (commandBound?.params?.nativeThreadId !== nativeSessionId
      || command.agentRun.conversationId !== first.agentRun.conversationId) {
    throw new Error(`Antigravity command output did not remain on the same Conversation: ${JSON.stringify({
      command: command.agentRun,
      commandBound,
      firstBound
    })}`)
  }
  await configureCodexRuntime(request, health, [profile.agentId])
  const handoff = await executeToken(request, camp, profile.agentId, 'ROVAI_ANTIGRAVITY_TO_CODEX_HANDOFF')
  const handoffStart = events.find((event) =>
    event.method === 'agent_run.started' && event.params?.agentRunId === handoff.agentRunId
  )
  if (!handoffStart?.params?.nativeThreadId
      || handoffStart.params.adapterKind !== 'codex-cli'
      || handoffStart.params.nativeThreadId === nativeSessionId
      || first.agentRun.conversationId !== second.agentRun.conversationId
      || second.agentRun.conversationId !== handoff.agentRun.conversationId) {
    throw new Error(`Cross-Adapter handoff did not preserve logical Conversation identity: ${JSON.stringify({
      first: first.agentRun,
      second: second.agentRun,
      handoff: handoff.agentRun,
      firstBound,
      secondBound,
      handoffStart
    })}`)
  }
  const privateLogFiles = await readdir(join(dataDir, 'runtime-private', 'antigravity'))
  if (privateLogFiles.length !== 0) {
    throw new Error(`Antigravity private logs were not cleaned: ${JSON.stringify(privateLogFiles)}`)
  }

  console.log(JSON.stringify({
    ok: true,
    runtime: snapshot.reportedVersion,
    discoveredModelCount: snapshot.models.length - 1,
    selectedModel: 'runtime_default',
    nativeSessionId,
    nativeSessionContinued: true,
    crossAdapterHandoff: {
      conversationId: handoff.agentRun.conversationId,
      from: 'antigravity-app',
      to: 'codex-cli',
      nativeSessionReplaced: true
    },
    firstOutput: first.output,
    secondOutput: second.output,
    commandOutput: {
      marker: command.marker,
      output: command.output,
      toolName: command.toolName,
      toolCallId: command.toolCallId
    },
    structuredApprovalClaimed: false,
    privateLogCleanup: true
  }, null, 2))
} finally {
  if (core && !core.killed) {
    shuttingDown = true
    core.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => core.once('close', resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 4_000))
    ])
    if (core.exitCode === null) core.kill('SIGTERM')
  }
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function executeToken(request, camp, agentId, token, workspace = null) {
  const body = `Do not call tools or inspect files. Reply with exactly ${token} and nothing else.`
  const purpose = 'Verify the Antigravity non-interactive CLI process integration without tools'
  const sent = camp
    ? await sendCampMessage(request, camp.id, agentId, body, purpose)
    : await createConfiguredCampAndSend(request, {
        commandId: crypto.randomUUID(),
        workspace,
        body,
        address: { mode: 'explicit', agentIds: [agentId] },
        purpose
      })
  const commandResult = sent.commandResult ?? sent
  const campId = camp?.id ?? commandResult.payload?.campId
  const agentRunId = commandResult.payload?.agentRunIds?.[0]
  if (commandResult.status !== 'accepted' || !campId || !agentRunId) {
    throw new Error(`Antigravity AgentRun intake failed: ${JSON.stringify(sent)}`)
  }
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const snapshot = await request('camps.snapshot', { campId })
    const agentRun = snapshot.agentRuns.find((value) => value.id === agentRunId)
    if (agentRun?.status === 'succeeded') {
      const output = snapshot.messages.find((message) => message.sourceAgentRunId === agentRunId)?.body
      if (!output?.includes(token)) throw new Error(`Antigravity output is missing ${token}: ${JSON.stringify(output)}`)
      return { campId, agentRunId, agentRun, output }
    }
    if (agentRun?.status === 'failed' || agentRun?.status === 'cancelled') {
      throw new Error(`Antigravity AgentRun entered ${agentRun.status}: ${JSON.stringify({ agentRun, timeline: snapshot.timeline.slice(-12) })}`)
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Antigravity AgentRun timed out: ${agentRunId}`)
}

async function executeCommandOutput(request, camp, agentId, events) {
  const marker = 'ROVAI_AGY_PRINTF_OK'
  const sent = await sendCampMessage(
    request,
    camp.id,
    agentId,
    `Use the run_command tool exactly once to run this command without changing files: printf '%s\\n' '${marker}'. Do not call any other tool. Then immediately reply exactly ROVAI_ANTIGRAVITY_COMMAND_OUTPUT_OK.`,
    'Verify Antigravity run_command output projection'
  )
  const commandResult = sent.commandResult ?? sent
  const agentRunId = commandResult.payload?.agentRunIds?.[0]
  if (commandResult.status !== 'accepted' || !agentRunId) {
    throw new Error(`Antigravity command-output intake failed: ${JSON.stringify(sent)}`)
  }
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const snapshot = await request('camps.snapshot', { campId: camp.id })
    const agentRun = snapshot.agentRuns.find((value) => value.id === agentRunId)
    if (agentRun?.status === 'succeeded') {
      const commandOutputEvent = events.find((event) =>
        event.method === 'runtime.action'
          && event.params?.agentRunId === agentRunId
          && String(event.params?.payload?.output ?? '').includes(marker)
      )
      if (!commandOutputEvent) {
        throw new Error(`Antigravity run_command output was not projected: ${JSON.stringify({
          agentRun,
          marker,
          runtimeActions: events.filter((event) =>
            event.method === 'runtime.action' && event.params?.agentRunId === agentRunId
          )
        })}`)
      }
      return {
        agentRunId,
        agentRun,
        marker,
        output: commandOutputEvent.params.payload.output,
        toolName: commandOutputEvent.params.payload.toolName,
        toolCallId: commandOutputEvent.params.payload.toolCallId
      }
    }
    if (agentRun?.status === 'failed' || agentRun?.status === 'cancelled') {
      throw new Error(`Antigravity command-output AgentRun entered ${agentRun.status}: ${JSON.stringify({
        agentRun,
        actions: snapshot.actions.filter((action) => action.agentRunId === agentRunId),
        events: events.filter((event) => event.params?.agentRunId === agentRunId).slice(-30)
      })}`)
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Antigravity command-output AgentRun timed out: ${agentRunId}`)
}

async function sendCampMessage(request, campId, agentId, body, purpose) {
  const draft = await request('camp.composerDraft.get', { campId })
  const saved = await request('camp.composerDraft.save', {
    campId,
    expectedRevision: draft.revision,
    content: [
      { kind: 'member_mention', agentId },
      { kind: 'text', text: ` ${body}` }
    ]
  })
  return request('camp.messages.send', {
    commandId: crypto.randomUUID(),
    campId,
    draftRevision: saved.revision,
    execution: {
      taskId: null,
      purpose,
      completionRole: 'required'
    }
  })
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
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
