import { chmod, copyFile, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import { executeSqlite, querySqliteRows, querySqliteScalar } from './lib/sqlite.mjs'
import {
  coreDataDirectoryArguments,
  removeEphemeralRuntimeCampFilesRoot
} from './lib/runtime-camp-files-root.mjs'

const root = resolve(import.meta.dirname, '..')
const adapterKind = process.env.ROVAI_COLD_RESUME_ADAPTER?.trim() || 'trae-cn-cli'
const runtime = {
  'trae-cn-cli': {
    label: 'TRAE',
    permissionMode: 'default',
    requireSilentHost: true,
    continuationName: 'HistoryRestore'
  },
  'grok-build': {
    label: 'Grok Build',
    permissionMode: 'default',
    requireSilentHost: false,
    continuationName: 'ACP session/resume'
  }
}[adapterKind]
if (!runtime) throw new Error(`Unsupported cold-continuation adapter: ${adapterKind}`)
const fixtureRoot = await realpath(
  await mkdtemp(join(tmpdir(), `rovai-${adapterKind}-cold-resume-`))
)
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
const grokHome = join(fixtureRoot, 'grok-home')
const grokSourceHome = process.env.GROK_HOME?.trim() || join(homedir(), '.grok')
const markerPath = join(projectRoot, 'native-session-marker.txt')
const writePath = join(projectRoot, 'COLD_RESUME_APPROVED_WRITE.txt')
const cancelPath = join(projectRoot, 'COLD_RESUME_CANCELLED_WRITE.txt')
const markerReadCommand = process.platform === 'win32'
  ? 'type native-session-marker.txt'
  : 'cat native-session-marker.txt'
const sessionMarker = `${adapterKind.replaceAll('-', '_').toUpperCase()}_SESSION_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`
let client

try {
  if (adapterKind === 'grok-build') {
    await mkdir(grokHome, { mode: 0o700 })
    for (const fileName of ['config.toml', 'managed_config.toml', 'requirements.toml', '.env']) {
      const source = join(grokSourceHome, fileName)
      const target = join(grokHome, fileName)
      try {
        await copyFile(source, target)
        await chmod(target, 0o600)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
  }
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), `# ${runtime.label} cold resume fixture\n`)
  await writeFile(markerPath, `${sessionMarker}\n`)
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', `Rovai-ai ${runtime.label} Cold Resume Smoke`], projectRoot)
  await run('git', ['config', 'user.email', `${adapterKind}-cold-resume@rovai.local`], projectRoot)
  await run('git', ['add', 'README.md', 'native-session-marker.txt'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  client = startCore(dataDir)
  await client.request('health.check')
  const workspace = await client.request('workspaces.inspect', { path: projectRoot })
  const agentId = 'agent_2'
  const installation = await configureProductRuntime(client.request, adapterKind, [agentId])
  if (!['ready', 'light_ready', 'installed_unverified'].includes(installation?.snapshot?.probeStatus)) {
    throw new Error(`${runtime.label} installation is unavailable: ${JSON.stringify(installation)}`)
  }
  let profile = await client.request('members.get', { agentId })
  const permissionsConfigured = await client.request('members.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentId: profile.agentId,
      expectedVersion: profile.version,
      adapterKind,
      model: profile.runtimeConfiguration.model,
      permissions: {
        adapterKind,
        schemaVersion: installation.snapshot.permissionSchemaVersion,
        values: { permission_mode: runtime.permissionMode }
      }
    }
  })
  if (permissionsConfigured.status !== 'applied') {
    throw new Error(`${runtime.label} permissions were rejected: ${JSON.stringify(permissionsConfigured)}`)
  }
  profile = await client.request('members.get', { agentId })

  const first = await createConfiguredCampAndSend(client.request, {
    commandId: crypto.randomUUID(),
    workspace,
    body: `You do not know the session marker. You must actually use the Bash or terminal tool exactly once to run this command without changing files: ${markerReadCommand}. Do not simulate or skip the tool call, and do not call any other tool. After the tool returns, remember its exact single-line output. Then reply with MARKER_STORED.`,
    address: { mode: 'explicit', agentIds: [profile.agentId] },
    purpose: `Store a session marker in the ${runtime.label} Native Session before Core restart`
  })
  const firstCommand = first.commandResult ?? first
  const campId = firstCommand.payload?.campId
  const firstRunId = firstCommand.payload?.agentRunIds?.[0]
  if (firstCommand.status !== 'accepted' || !campId || !firstRunId) {
    throw new Error(`Initial ${runtime.label} run was not accepted: ${JSON.stringify(first)}`)
  }
  const firstResult = await waitForRun(client, campId, firstRunId, { approve: true })
  const firstOutput = outputForRun(firstResult.snapshot, firstRunId)
  const firstStart = startForRun(client.events, firstRunId)
  const firstActions = firstResult.snapshot.actions.filter((action) => action.agentRunId === firstRunId)
  const firstRuntimeAction = client.events.find((event) =>
    event.method === 'runtime.action'
      && event.params?.agentRunId === firstRunId
      && String(event.params?.payload?.output ?? '').includes(sessionMarker)
  )
  if (firstResult.run.status !== 'succeeded'
      || !firstOutput?.body
      || (adapterKind !== 'grok-build' && firstOutput.body.includes(sessionMarker))
      || !firstRuntimeAction
      || !firstStart?.params?.nativeThreadId) {
    const runtimeEvents = client.events.filter((event) =>
      event.method === 'runtime.action' && event.params?.agentRunId === firstRunId
    )
    throw new Error(`Initial session-marker run failed: ${JSON.stringify({
      run: firstResult.run,
      output: firstOutput,
      actions: firstActions,
      firstRuntimeAction,
      runtimeEvents,
      start: firstStart
    })}`)
  }

  await rm(markerPath)
  await client.stop()
  client = startCore(dataDir)
  await client.request('health.check')

  const restoredRequest = await sendExistingCampMessage(
    client.request,
    campId,
    'Do not call tools or inspect files. Reply with exactly the session marker returned by the tool in the immediately preceding request, and nothing else.',
    'Recover the session marker after a Core and ACP Host restart'
  )
  const restoredCommand = restoredRequest.commandResult ?? restoredRequest
  const restoredRunId = restoredCommand.payload?.agentRunIds?.[0]
  if (restoredCommand.status !== 'accepted' || !restoredRunId) {
    throw new Error(`Cold continuation was not accepted: ${JSON.stringify(restoredRequest)}`)
  }
  const restoredResult = await waitForRun(client, campId, restoredRunId)
  const restoredOutput = outputForRun(restoredResult.snapshot, restoredRunId)
  const restoredStart = startForRun(client.events, restoredRunId)
  const restoredActions = restoredResult.snapshot.actions.filter((action) => action.agentRunId === restoredRunId)
  const restoredApprovals = restoredResult.snapshot.approvals.filter((approval) =>
    restoredActions.some((action) => action.id === approval.actionId)
  )
  const restoredHostLogs = client.events.filter((event) => event.method === 'runtime.host.log')
  if (restoredResult.run.status !== 'succeeded'
      || !restoredOutput?.body.includes(sessionMarker)
      || restoredStart?.params?.nativeThreadId !== firstStart.params.nativeThreadId
      || restoredStart?.params?.hostInstanceId === firstStart.params.hostInstanceId
      || restoredActions.length !== 0
      || restoredApprovals.length !== 0
      || (runtime.requireSilentHost && restoredHostLogs.length !== 0)
      || restoredHostLogs.some((event) => String(event.params?.text ?? '').includes(sessionMarker))) {
    throw new Error(`${runtime.label} cold ${runtime.continuationName} failed or replay leaked: ${JSON.stringify({
      run: restoredResult.run,
      output: restoredOutput,
      firstStart,
      restoredStart,
      restoredActions,
      restoredApprovals,
      hostLogs: restoredHostLogs,
      timeline: restoredResult.snapshot.timeline.filter((event) =>
        event.entityId === restoredRunId || event.sourceAgentRunId === restoredRunId
      ),
      runtimeEvents: client.events.filter((event) =>
        event.params?.agentRunId === restoredRunId
          || event.params?.sourceAgentRunId === restoredRunId
      ),
      runtimeSnapshots: querySqliteRows(
        join(dataDir, 'rovai.sqlite'),
        `SELECT installation_id, probe_status, authentication_status, stale_at, last_error
         FROM adapter_capability_snapshot`
      ),
      probeAttempts: querySqliteRows(
        join(dataDir, 'rovai.sqlite'),
        `SELECT installation_id, status, failure_class, diagnostic_code,
                attempted_at, public_runtime_failure_json
         FROM adapter_probe_attempt ORDER BY attempted_at DESC LIMIT 3`
      )
    })}`)
  }

  const writeRequest = await sendExistingCampMessage(
    client.request,
    campId,
    `Use the file editing tool exactly once to create ${writePath} with exactly COLD_RESUME_WRITE_OK and a trailing newline. Do not call any other tool. Then reply exactly WRITE_DONE.`,
    `Verify a new Tool and Approval after ${runtime.label} ${runtime.continuationName}`
  )
  const writeCommand = writeRequest.commandResult ?? writeRequest
  const writeRunId = writeCommand.payload?.agentRunIds?.[0]
  const writeResult = await waitForRun(client, campId, writeRunId, { approve: true })
  const written = await readFile(writePath, 'utf8').catch(() => null)
  const writeActions = writeResult.snapshot.actions.filter((action) => action.agentRunId === writeRunId)
  if (writeResult.run.status !== 'succeeded'
      || written?.trimEnd() !== 'COLD_RESUME_WRITE_OK'
      || !writeActions.some((action) => action.status === 'succeeded')) {
    throw new Error(`Post-restore Tool/Approval failed: ${JSON.stringify({
      run: writeResult.run,
      actions: writeActions,
      written
    })}`)
  }

  const cancelRequest = await sendExistingCampMessage(
    client.request,
    campId,
    `Use the Bash or terminal tool exactly once to run: sleep 30; printf 'SHOULD_NOT_EXIST\\n' > '${cancelPath}'. Do not call any other tool. After it completes, reply exactly CANCEL_TOOL_FINISHED.`,
    `Verify cancel after ${runtime.label} ${runtime.continuationName}`
  )
  const cancelCommand = cancelRequest.commandResult ?? cancelRequest
  const cancelRunId = cancelCommand.payload?.agentRunIds?.[0]
  const cancelResult = await cancelRunningTool(client, campId, cancelRunId)
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  const cancelledFile = await readFile(cancelPath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (!['cancelled', 'failed'].includes(cancelResult.run.status) || cancelledFile !== null) {
    throw new Error(`Post-restore cancel did not fail closed: ${JSON.stringify({
      run: cancelResult.run,
      cancelledFile
    })}`)
  }

  const invalidSessionId = `invalid-${crypto.randomUUID()}`
  await client.stop()
  executeSqlite(
    join(dataDir, 'rovai.sqlite'),
    `UPDATE conversation SET native_session_id = '${invalidSessionId}' WHERE id = '${restoredResult.run.conversationId}'`
  )
  client = startCore(dataDir)
  await client.request('health.check')
  const fallbackRequest = await sendExistingCampMessage(
    client.request,
    campId,
    'Reply exactly BAD_SESSION_FALLBACK_OK and do not call tools.',
    `Verify an invalid persisted ${runtime.label} Session ID safely falls back to a new Session`
  )
  const fallbackCommand = fallbackRequest.commandResult ?? fallbackRequest
  const fallbackRunId = fallbackCommand.payload?.agentRunIds?.[0]
  const fallbackResult = await waitForRun(client, campId, fallbackRunId)
  const fallbackOutput = outputForRun(fallbackResult.snapshot, fallbackRunId)
  const fallbackStart = startForRun(client.events, fallbackRunId)
  await client.stop()
  const continuityLostCount = Number(querySqliteScalar(
    join(dataDir, 'rovai.sqlite'),
    `SELECT COUNT(*) FROM event_log WHERE event_type = 'agent_run.native_session_continuity_lost' AND entity_id = '${fallbackRunId}'`
  ))
  if (fallbackResult.run.status !== 'succeeded'
      || !fallbackOutput?.body.includes('BAD_SESSION_FALLBACK_OK')
      || !fallbackStart?.params?.nativeThreadId
      || fallbackStart.params.nativeThreadId === invalidSessionId
      || fallbackStart.params.nativeThreadId === firstStart.params.nativeThreadId
      || continuityLostCount !== 1) {
    throw new Error(`Invalid Session fallback was not safe: ${JSON.stringify({
      run: fallbackResult.run,
      output: fallbackOutput,
      fallbackStart,
      invalidSessionId,
      previousSessionId: firstStart.params.nativeThreadId,
      continuityLostCount,
      timeline: fallbackResult.snapshot.timeline.filter((event) =>
        event.entityId === fallbackRunId || event.sourceAgentRunId === fallbackRunId
      ),
      runtimeEvents: client.events.filter((event) =>
        event.params?.agentRunId === fallbackRunId
          || event.params?.sourceAgentRunId === fallbackRunId
      ),
      runtimeSnapshots: querySqliteRows(
        join(dataDir, 'rovai.sqlite'),
        `SELECT installation_id, probe_status, authentication_status, stale_at, last_error
         FROM adapter_capability_snapshot`
      ),
      probeAttempts: querySqliteRows(
        join(dataDir, 'rovai.sqlite'),
        `SELECT installation_id, status, failure_class, diagnostic_code,
                attempted_at, public_runtime_failure_json
         FROM adapter_probe_attempt ORDER BY attempted_at DESC LIMIT 3`
      )
    })}`)
  }

  console.log(JSON.stringify({
    ok: true,
    adapterKind,
    continuation: runtime.continuationName,
    nativeSessionId: firstStart.params.nativeThreadId,
    firstHostInstanceId: firstStart.params.hostInstanceId,
    restoredHostInstanceId: restoredStart.params.hostInstanceId,
    sessionMarkerRecovered: true,
    replayActionsProjected: restoredActions.length,
    replayApprovalsProjected: restoredApprovals.length,
    restoredHostLogCount: restoredHostLogs.length,
    postRestoreWrite: written,
    cancelStatus: cancelResult.run.status,
    cancelledFileCreated: cancelledFile !== null,
    invalidSessionFallbackId: fallbackStart.params.nativeThreadId,
    continuityLostCount
  }, null, 2))
} finally {
  await client?.stop()
  await removeEphemeralRuntimeCampFilesRoot(dataDir)
  await rm(fixtureRoot, { recursive: true, force: true })
}

function startCore(dataDirectory) {
  const events = []
  const pending = new Map()
  let nextId = 1
  let stopping = false
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), [
    ...coreDataDirectoryArguments(dataDirectory),
    '--skill-library-root', join(dataDirectory, 'managed-skill-library')
  ], {
    cwd: root,
    env: {
      ...process.env,
      ...(adapterKind === 'grok-build' ? { GROK_HOME: grokHome } : {})
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.pipe(process.stderr)
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  child.once('error', rejectPending)
  child.once('close', (code, signal) => {
    if (!stopping) rejectPending(new Error(`rovai-core exited early (code=${code}, signal=${signal})`))
  })
  const lines = createInterface({ input: child.stdout })
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
    }, 90_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
  const stop = async () => {
    if (stopping || child.exitCode !== null) return
    stopping = true
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 10_000))
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
    lines.close()
  }
  return { events, request, stop }
}

async function sendExistingCampMessage(request, campId, body, purpose) {
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
    execution: { taskId: null, purpose, completionRole: 'required' }
  })
}

async function waitForRun(client, campId, agentRunId, options = {}) {
  if (!agentRunId) throw new Error('AgentRun was not accepted')
  const resolvedApprovals = new Set()
  const deadline = Date.now() + 240_000
  let snapshot
  let run
  while (Date.now() < deadline) {
    snapshot = await client.request('camps.snapshot', { campId })
    const actions = snapshot.actions.filter((action) => action.agentRunId === agentRunId)
    if (options.approve) {
      for (const approval of snapshot.approvals.filter((candidate) =>
        candidate.status === 'pending'
          && !resolvedApprovals.has(candidate.id)
          && actions.some((action) => action.id === candidate.actionId)
      )) {
        const option = approval.options.find((candidate) => candidate.kind === 'allow_once')
          ?? approval.options.find((candidate) => candidate.kind === 'allow_session')
        if (!option) throw new Error(`Approval has no exact allow option: ${JSON.stringify(approval)}`)
        const resolution = await client.request('action.approvals.resolve', {
          commandId: crypto.randomUUID(),
          campId,
          approvalId: approval.id,
          expectedVersion: approval.version,
          optionId: option.optionId,
          reason: `${runtime.label} cold resume smoke test`
        })
        if (resolution.status === 'rejected') {
          throw new Error(`Approval resolution was rejected: ${JSON.stringify(resolution)}`)
        }
        resolvedApprovals.add(approval.id)
      }
    }
    run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
      return { snapshot, run, resolvedApprovals }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Timed out waiting for AgentRun ${agentRunId}: ${JSON.stringify(run)}`)
}

async function cancelRunningTool(client, campId, agentRunId) {
  const resolvedApprovals = new Set()
  const deadline = Date.now() + 180_000
  let cancellationRequested = false
  let snapshot
  let run
  while (Date.now() < deadline) {
    snapshot = await client.request('camps.snapshot', { campId })
    const actions = snapshot.actions.filter((action) => action.agentRunId === agentRunId)
    for (const approval of snapshot.approvals.filter((candidate) =>
      candidate.status === 'pending'
        && !resolvedApprovals.has(candidate.id)
        && actions.some((action) => action.id === candidate.actionId)
    )) {
      const option = approval.options.find((candidate) => candidate.kind === 'allow_once')
        ?? approval.options.find((candidate) => candidate.kind === 'allow_session')
      if (!option) throw new Error(`Cancel smoke Approval has no allow option: ${JSON.stringify(approval)}`)
      const resolution = await client.request('action.approvals.resolve', {
        commandId: crypto.randomUUID(),
        campId,
        approvalId: approval.id,
        expectedVersion: approval.version,
        optionId: option.optionId,
        reason: 'Start the bounded command before cancel smoke'
      })
      if (resolution.status === 'rejected') throw new Error(`Cancel smoke Approval failed: ${JSON.stringify(resolution)}`)
      resolvedApprovals.add(approval.id)
    }
    run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    if (!cancellationRequested && resolvedApprovals.size > 0 && run) {
      const turn = snapshot.turns.find((candidate) => candidate.id === run.campTurnId)
      if (!turn) throw new Error(`Cancel smoke has no CampTurn: ${JSON.stringify(run)}`)
      const cancellation = await client.request('campTurns.cancel', {
        commandId: crypto.randomUUID(),
        command: { campId, campTurnId: turn.id, expectedVersion: turn.version }
      })
      if (cancellation.status === 'rejected') {
        throw new Error(`CampTurn cancellation was rejected: ${JSON.stringify(cancellation)}`)
      }
      cancellationRequested = true
    }
    if (cancellationRequested && run && ['cancelled', 'failed', 'succeeded'].includes(run.status)) {
      return { snapshot, run }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Timed out cancelling AgentRun ${agentRunId}: ${JSON.stringify(run)}`)
}

function outputForRun(snapshot, agentRunId) {
  return snapshot.messages.find((message) => message.sourceAgentRunId === agentRunId)
}

function startForRun(events, agentRunId) {
  return events.find((event) => event.method === 'agent_run.started' && event.params?.agentRunId === agentRunId)
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

async function runCapture(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code) => code === 0
      ? resolveRun(stdout.join('').trim())
      : rejectRun(new Error(`${command} failed (${code}): ${stderr.join('')}`)))
  })
}
