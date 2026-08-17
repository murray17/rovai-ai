import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-claude-runtime-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
let core = null

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Claude Code Runtime fixture\n')
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Rovai-ai Claude Runtime Smoke'], projectRoot)
  await run('git', ['config', 'user.email', 'claude-runtime@rovai.local'], projectRoot)
  await run('git', ['add', 'README.md'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  core = startCore(dataDir)
  await core.request('health.check')
  const installation = await configureProductRuntime(
    core.request,
    'claude-code-cli',
    ['agent_1']
  )
  const snapshot = installation?.snapshot
  if (snapshot?.probeStatus !== 'ready'
      || !snapshot.models.some((model) =>
        model.id === 'claude-code://runtime-default' && model.isDefault
      )
      || !snapshot.permissionOptions.some((option) =>
        option.key === 'permission_mode' && option.recommendedValue === 'acceptEdits'
      )
      || !snapshot.capabilities.includes('team_tool.mcp_config')
      || !snapshot.capabilities.includes('team_tool.allow')) {
    throw new Error(`Claude Code capability snapshot is invalid: ${JSON.stringify(snapshot)}`)
  }

  let profile = await core.request('members.get', { agentId: 'agent_1' })
  const permissionsConfigured = await core.request('members.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentId: profile.agentId,
      expectedVersion: profile.version,
      adapterKind: 'claude-code-cli',
      model: profile.runtimeConfiguration.model,
      permissions: {
        adapterKind: 'claude-code-cli',
        schemaVersion: 1,
        values: { permission_mode: 'bypassPermissions' }
      }
    }
  })
  if (permissionsConfigured.status !== 'applied') {
    throw new Error(`Claude Code smoke permissions were rejected: ${JSON.stringify(permissionsConfigured)}`)
  }
  profile = await core.request('members.get', { agentId: profile.agentId })
  if (profile.runtimeConfiguration?.permissions?.values?.permission_mode !== 'bypassPermissions') {
    throw new Error(`Claude Code smoke permissions drifted: ${JSON.stringify(profile.runtimeConfiguration)}`)
  }

  const workspace = await core.request('workspaces.inspect', { path: projectRoot })
  const first = await createConfiguredCampAndSend(core.request, {
    commandId: crypto.randomUUID(),
    workspace,
    body: 'Reply with exactly ROVAI_CLAUDE_RUN_ONE and nothing else. Do not call tools.',
    purpose: 'Verify Claude Code CLI execution.',
  })
  if (first.status !== 'accepted') {
    throw new Error(`Claude Code Camp intake failed: ${JSON.stringify(first)}`)
  }
  const campId = first.payload.campId
  let camp = await waitFor(async () => {
    const value = await core.request('camps.snapshot', { campId })
    const run = value.agentRuns[0]
    return run?.status === 'succeeded'
      && value.messages.some((message) =>
        message.sourceAgentRunId === run.id && message.body.includes('ROVAI_CLAUDE_RUN_ONE')
      )
      ? value
      : null
  }, 'first Claude Code AgentRun')
  const firstRun = camp.agentRuns[0]
  const firstNarration = runtimeNarration(core.events, firstRun.id)
  if (!firstNarration.includes('ROVAI_CLAUDE_RUN_ONE')) {
    throw new Error(`Claude Code first final text was not projected as narration: ${JSON.stringify({
      firstRun,
      firstNarration,
      events: core.events.filter((event) => event.params?.agentRunId === firstRun.id)
    })}`)
  }
  const firstBinding = core.events.find((event) =>
    event.method === 'agent_run.native_session_bound'
      && event.params?.agentRunId === firstRun.id
  )
  const nativeSessionId = firstBinding?.params?.nativeThreadId
  if (!isUuid(nativeSessionId)) {
    throw new Error(`Claude Code Native Session was not bound: ${JSON.stringify(firstBinding)}`)
  }

  const followUp = await sendCampMessage(
    core.request,
    campId,
    'Reply with exactly ROVAI_CLAUDE_RUN_TWO and nothing else. Do not call tools.',
    {
      taskId: null,
      purpose: 'Verify Claude Code Native Session resume.',
      completionRole: 'required'
    }
  )
  if (followUp.commandResult?.status !== 'accepted') {
    throw new Error(`Claude Code follow-up failed: ${JSON.stringify(followUp)}`)
  }
  camp = await waitFor(async () => {
    const value = await core.request('camps.snapshot', { campId })
    const response = value.messages.find((message) =>
      message.sourceAgentRunId
        && message.body.includes('ROVAI_CLAUDE_RUN_TWO')
    )
    return value.agentRuns.length === 2
      && value.agentRuns.every((agentRun) => agentRun.status === 'succeeded')
      && response
      ? value
      : null
  }, 'resumed Claude Code AgentRun')
  const secondResponse = camp.messages.find((message) =>
    message.sourceAgentRunId
      && message.body.includes('ROVAI_CLAUDE_RUN_TWO')
  )
  const secondRun = camp.agentRuns.find((agentRun) =>
    agentRun.id === secondResponse?.sourceAgentRunId
  )
  if (!secondRun) {
    throw new Error(`Claude Code follow-up AgentRun was not found: ${JSON.stringify(camp)}`)
  }
  const secondNarration = runtimeNarration(core.events, secondRun.id)
  if (!secondNarration.includes('ROVAI_CLAUDE_RUN_TWO')) {
    throw new Error(`Claude Code resumed final text was not projected as narration: ${JSON.stringify({
      secondRun,
      secondNarration,
      events: core.events.filter((event) => event.params?.agentRunId === secondRun.id)
    })}`)
  }
  const secondBinding = core.events.find((event) =>
    event.method === 'agent_run.native_session_bound'
      && event.params?.agentRunId === secondRun.id
  )
  if (secondBinding?.params?.nativeThreadId !== nativeSessionId
      || secondRun.conversationId !== firstRun.conversationId) {
    throw new Error(`Claude Code did not resume the same Conversation: ${JSON.stringify({
      firstRun,
      secondRun,
      firstBinding,
      secondBinding
    })}`)
  }

  const commandMarker = 'ROVAI_CLAUDE_PRINTF_OK'
  const commandRequest = await sendCampMessage(
    core.request,
    campId,
    `Use the Bash tool exactly once to run this command without changing files: printf '%s\\n' '${commandMarker}'. Do not call any other tool. Then immediately reply exactly ROVAI_CLAUDE_COMMAND_OUTPUT_OK.`,
    {
      taskId: null,
      purpose: 'Verify Claude Code Bash output projection.',
      completionRole: 'required'
    }
  )
  const commandRunId = commandRequest.commandResult?.payload?.agentRunIds?.[0]
  if (commandRequest.commandResult?.status !== 'accepted' || !commandRunId) {
    throw new Error(`Claude Code command-output intake failed: ${JSON.stringify(commandRequest)}`)
  }
  camp = await waitFor(async () => {
    const value = await core.request('camps.snapshot', { campId })
    const commandRun = value.agentRuns.find((agentRun) => agentRun.id === commandRunId)
    if (commandRun?.status === 'failed' || commandRun?.status === 'cancelled') {
      throw new Error(`Claude Code command-output AgentRun entered ${commandRun.status}: ${JSON.stringify({
        commandRun,
        actions: value.actions.filter((action) => action.agentRunId === commandRunId),
        events: core.events.filter((event) => event.params?.agentRunId === commandRunId).slice(-30)
      })}`)
    }
    return commandRun?.status === 'succeeded' ? value : null
  }, 'Claude Code Bash AgentRun')
  const commandRun = camp.agentRuns.find((agentRun) => agentRun.id === commandRunId)
  const commandOutputEvent = core.events.find((event) =>
    event.method === 'runtime.action'
      && event.params?.agentRunId === commandRunId
      && String(event.params?.payload?.output ?? '').includes(commandMarker)
  )
  const commandBinding = core.events.find((event) =>
    event.method === 'agent_run.native_session_bound'
      && event.params?.agentRunId === commandRunId
  )
  if (!commandRun
      || !commandOutputEvent
      || commandBinding?.params?.nativeThreadId !== nativeSessionId
      || commandRun.conversationId !== firstRun.conversationId) {
    throw new Error(`Claude Code Bash output was not projected on the resumed Conversation: ${JSON.stringify({
      commandRun,
      commandBinding,
      marker: commandMarker,
      runtimeActions: core.events.filter((event) =>
        event.method === 'runtime.action' && event.params?.agentRunId === commandRunId
      )
    })}`)
  }

  console.log(JSON.stringify({
    ok: true,
    runtime: snapshot.reportedVersion,
    modelAliases: snapshot.models
      .filter((model) => !model.id.endsWith('://runtime-default'))
      .map((model) => model.id),
    nativeSessionId,
    nativeSessionContinued: true,
    conversationId: firstRun.conversationId,
    narrationProjected: true,
    commandOutput: {
      marker: commandMarker,
      output: commandOutputEvent.params.payload.output,
      toolName: commandOutputEvent.params.payload.toolName,
      toolCallId: commandOutputEvent.params.payload.toolCallId
    },
    teamToolAdvertised: true
  }, null, 2))
} finally {
  if (core) await core.stop()
  await rm(fixtureRoot, { recursive: true, force: true })
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
  const events = []
  let nextId = 1
  createInterface({ input: child.stdout }).on('line', (line) => {
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
    }, 180_000)
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
  return { request, stop, events }
}

async function waitFor(probe, label) {
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function runtimeNarration(events, agentRunId) {
  return events
    .filter((event) =>
      event.method === 'agent.text.delta'
        && event.params?.agentRunId === agentRunId
    )
    .map((event) => String(event.params?.payload?.delta ?? ''))
    .join('')
}

async function sendCampMessage(request, campId, body, execution) {
  const draft = await request('camp.composerDraft.get', { campId })
  const saved = await request('camp.composerDraft.save', {
    campId,
    expectedRevision: draft.revision,
    content: [{ kind: 'text', text: body }]
  })
  return request('camp.messages.send', {
    commandId: crypto.randomUUID(),
    campId,
    draftRevision: saved.revision,
    execution
  })
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
