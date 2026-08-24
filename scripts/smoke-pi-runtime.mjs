import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import {
  coreDataDirectoryArguments,
  removeEphemeralRuntimeCampFilesRoot
} from './lib/runtime-camp-files-root.mjs'

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('Pi Runtime qualification is frozen to macOS arm64')
}

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'rovai-pi-runtime-')))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
const markerPath = join(projectRoot, 'native-session-marker.txt')
const approvedPath = join(projectRoot, 'PI_APPROVED_WRITE.txt')
const deniedPath = join(projectRoot, 'PI_DENIED_WRITE.txt')
const cancelledPath = join(projectRoot, 'PI_CANCELLED_WRITE.txt')
const privateMarker = `PI_PRIVATE_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`
let client = null

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Pi Runtime qualification fixture\n')
  await writeFile(markerPath, `${privateMarker}\n`)
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Rovai Pi Runtime Smoke'], projectRoot)
  await run('git', ['config', 'user.email', 'pi-runtime@rovai.local'], projectRoot)
  await run('git', ['add', 'README.md', 'native-session-marker.txt'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  client = startCore(dataDir)
  await client.request('health.check')
  const workspace = await client.request('workspaces.inspect', { path: projectRoot })
  const agentId = 'agent_2'
  const installation = await configureProductRuntime(client.request, 'pi', [agentId])
  assertCapabilitySnapshot(installation?.snapshot)

  const profile = await client.request('members.get', { agentId })
  if (profile.runtimeConfiguration?.adapterKind !== 'pi'
      || profile.runtimeConfiguration?.permissions?.values?.approval_mode !== 'managed') {
    throw new Error(`Pi managed permissions were not frozen: ${JSON.stringify(profile)}`)
  }

  const first = await createConfiguredCampAndSend(client.request, {
    commandId: crypto.randomUUID(),
    workspace,
    body: [
      'Use the Bash tool exactly once to run: cat native-session-marker.txt.',
      'Do not call another tool. Remember the exact single-line result.',
      'Do not reveal the marker in this answer, but reveal it when the immediately next user message asks.',
      'Reply exactly MARKER_STORED.'
    ].join(' '),
    address: { mode: 'explicit', agentIds: [agentId] },
    purpose: 'Freeze a private value in the Pi Native Session before Core restart.'
  })
  const firstAccepted = acceptedRun(first)
  const firstResult = await waitForRun(client, firstAccepted.campId, firstAccepted.agentRunId, {
    approval: 'allow_once'
  })
  const firstOutput = outputForRun(firstResult.snapshot, firstAccepted.agentRunId)
  const firstStart = startForRun(client.events, firstAccepted.agentRunId)
  const firstActions = actionsForRun(firstResult.snapshot, firstAccepted.agentRunId)
  const privateOutputEvent = client.events.find((event) =>
    event.method === 'runtime.action'
      && event.params?.agentRunId === firstAccepted.agentRunId
      && String(event.params?.payload?.output ?? '').includes(privateMarker)
  )
  if (firstResult.run.status !== 'succeeded'
      || !firstOutput?.body.includes('MARKER_STORED')
      || firstOutput.body.includes(privateMarker)
      || !privateOutputEvent
      || !firstActions.some((action) => action.status === 'succeeded')
      || !isUuid(firstStart?.params?.nativeThreadId)
      || !isUuid(firstStart?.params?.hostInstanceId)) {
    throw new Error(`Initial Pi run failed: ${diagnostics(client, firstResult, firstAccepted.agentRunId)}`)
  }

  await rm(markerPath)
  await client.stop()
  client = startCore(dataDir)
  await client.request('health.check')

  const restoredRequest = await sendExistingCampMessage(
    client.request,
    firstAccepted.campId,
    'Do not call tools or inspect files. Reveal the private marker saved in the immediately preceding turn. Reply with exactly that marker and nothing else.',
    'Verify Pi exact Session resume after Core and Host restart.'
  )
  const restoredAccepted = acceptedRun(restoredRequest, firstAccepted.campId)
  const restoredResult = await waitForRun(
    client,
    firstAccepted.campId,
    restoredAccepted.agentRunId
  )
  const restoredOutput = outputForRun(restoredResult.snapshot, restoredAccepted.agentRunId)
  const restoredStart = startForRun(client.events, restoredAccepted.agentRunId)
  const restoredActions = actionsForRun(restoredResult.snapshot, restoredAccepted.agentRunId)
  if (restoredResult.run.status !== 'succeeded'
      || restoredOutput?.body.trim() !== privateMarker
      || restoredStart?.params?.nativeThreadId !== firstStart.params.nativeThreadId
      || restoredStart?.params?.hostInstanceId === firstStart.params.hostInstanceId
      || restoredResult.run.conversationId !== firstResult.run.conversationId
      || restoredActions.length !== 0
      || client.events.some((event) => event.method === 'runtime.host.log')) {
    throw new Error(`Pi cold exact-resume failed: ${diagnostics(client, restoredResult, restoredAccepted.agentRunId)}`)
  }

  const approvedRequest = await sendExistingCampMessage(
    client.request,
    firstAccepted.campId,
    `Use the write tool exactly once to create ${approvedPath} with exactly PI_APPROVED_WRITE_OK and a trailing newline. Do not call another tool. Then reply exactly WRITE_DONE.`,
    'Verify Pi managed Approval allow_once after cold resume.'
  )
  const approvedAccepted = acceptedRun(approvedRequest, firstAccepted.campId)
  const approvedResult = await waitForRun(
    client,
    firstAccepted.campId,
    approvedAccepted.agentRunId,
    { approval: 'allow_once' }
  )
  const approvedStart = startForRun(client.events, approvedAccepted.agentRunId)
  const approvedActions = actionsForRun(approvedResult.snapshot, approvedAccepted.agentRunId)
  const approvedBody = await readFile(approvedPath, 'utf8').catch(() => null)
  if (approvedResult.run.status !== 'succeeded'
      || approvedBody !== 'PI_APPROVED_WRITE_OK\n'
      || !approvedActions.some((action) => action.status === 'succeeded')
      || approvedStart?.params?.hostInstanceId !== restoredStart.params.hostInstanceId
      || approvedStart?.params?.nativeThreadId !== restoredStart.params.nativeThreadId) {
    throw new Error(`Pi warm-LRU/approved-write failed: ${diagnostics(client, approvedResult, approvedAccepted.agentRunId)}`)
  }

  const deniedRequest = await sendExistingCampMessage(
    client.request,
    firstAccepted.campId,
    `Use the write tool exactly once to create ${deniedPath} with PI_DENIED_WRITE_SHOULD_NOT_EXIST. If the tool is denied, do not retry and reply exactly DENIED_OK.`,
    'Verify Pi managed Approval denial is fail-closed.'
  )
  const deniedAccepted = acceptedRun(deniedRequest, firstAccepted.campId)
  const deniedResult = await waitForRun(
    client,
    firstAccepted.campId,
    deniedAccepted.agentRunId,
    { approval: 'deny' }
  )
  const deniedActions = actionsForRun(deniedResult.snapshot, deniedAccepted.agentRunId)
  const deniedApprovals = approvalsForRun(deniedResult.snapshot, deniedAccepted.agentRunId)
  const deniedBody = await readFile(deniedPath, 'utf8').catch(() => null)
  if (deniedBody !== null
      || !deniedApprovals.some((approval) => approval.status === 'denied')
      || deniedActions.some((action) => action.status === 'succeeded')) {
    throw new Error(`Pi managed denial did not fail closed: ${diagnostics(client, deniedResult, deniedAccepted.agentRunId)}`)
  }

  const cancelRequest = await sendExistingCampMessage(
    client.request,
    firstAccepted.campId,
    `Use the Bash tool exactly once to run: sleep 30; printf 'SHOULD_NOT_EXIST\\n' > '${cancelledPath}'. Do not call another tool.`,
    'Verify Pi abort and descendant cleanup.'
  )
  const cancelAccepted = acceptedRun(cancelRequest, firstAccepted.campId)
  const cancelledResult = await cancelRunningTool(
    client,
    firstAccepted.campId,
    cancelAccepted.agentRunId
  )
  await delay(1_500)
  const cancelledBody = await readFile(cancelledPath, 'utf8').catch(() => null)
  if (!['cancelled', 'failed'].includes(cancelledResult.run.status) || cancelledBody !== null) {
    throw new Error(`Pi cancel did not stop the side effect: ${diagnostics(client, cancelledResult, cancelAccepted.agentRunId)}`)
  }

  const publicTrace = JSON.stringify({ events: client.events, stderr: client.stderr })
  for (const forbidden of ['ROVAI_PI_MINIMAX_API_KEY', 'ANTHROPIC_AUTH_TOKEN', '.claude/settings.json']) {
    if (publicTrace.includes(forbidden)) {
      throw new Error(`Pi public trace exposed private provider configuration: ${forbidden}`)
    }
  }
  if (client.stderr.some((line) => line.includes('interrupt timed out'))) {
    throw new Error(`Pi abort did not acknowledge within the Core interrupt window: ${JSON.stringify(client.stderr)}`)
  }

  console.log(JSON.stringify({
    ok: true,
    adapterKind: 'pi',
    protocol: 'pi-jsonl-rpc-v1',
    reportedVersion: installation.snapshot.reportedVersion,
    providerCompatibilityFingerprint: installation.snapshot.nativeSessionCompatibilityKey.slice(0, 12),
    nativeSessionId: firstStart.params.nativeThreadId,
    firstHostInstanceId: firstStart.params.hostInstanceId,
    restoredHostInstanceId: restoredStart.params.hostInstanceId,
    warmHostReused: approvedStart.params.hostInstanceId === restoredStart.params.hostInstanceId,
    coldSessionResumed: restoredStart.params.nativeThreadId === firstStart.params.nativeThreadId,
    approvedActionCount: approvedActions.filter((action) => action.status === 'succeeded').length,
    deniedActionCount: deniedApprovals.filter((approval) => approval.status === 'denied').length,
    cancelStatus: cancelledResult.run.status,
    cancelledFileCreated: cancelledBody !== null,
    externalMcpProjection: 'unsupported',
    managedSkillDelivery: '.pi/skills'
  }, null, 2))
} finally {
  await client?.stop()
  await removeEphemeralRuntimeCampFilesRoot(dataDir)
  await rm(fixtureRoot, { recursive: true, force: true })
}

function assertCapabilitySnapshot(snapshot) {
  const requiredCapabilities = [
    'pi.rpc.prompt',
    'pi.rpc.agent_settled',
    'pi.rpc.structured_tools',
    'pi.rpc.extension_approval',
    'conversation.exact_resume',
    'process.interrupt',
    'builtin_cli.transport.v20'
  ]
  const approval = snapshot?.permissionOptions?.find((option) => option.key === 'approval_mode')
  if (snapshot?.probeStatus !== 'ready'
      || !snapshot.protocols?.includes('pi-jsonl-rpc-v1')
      || !snapshot.models?.some((model) => model.id === 'pi://claude-minimax-default' && model.isDefault)
      || !requiredCapabilities.every((capability) => snapshot.capabilities?.includes(capability))
      || approval?.recommendedValue !== 'managed'
      || snapshot.nativeSessionCompatibilityKey?.length !== 64) {
    throw new Error(`Pi capability snapshot is invalid: ${JSON.stringify(snapshot)}`)
  }
}

function startCore(dataDirectory) {
  const events = []
  const stderr = []
  const pending = new Map()
  let nextId = 1
  let stopping = false
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), [
    ...coreDataDirectoryArguments(dataDirectory),
    '--skill-library-root', join(dataDirectory, 'managed-skill-library')
  ], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stderr.on('data', (chunk) => {
    stderr.push(String(chunk))
    process.stderr.write(chunk)
  })
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
    }, 120_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
  const stop = async () => {
    if (stopping || child.exitCode !== null) return
    stopping = true
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      delay(10_000)
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
    lines.close()
  }
  return { events, stderr, request, stop }
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

function acceptedRun(result, knownCampId = null) {
  const command = result.commandResult ?? result
  const campId = knownCampId ?? command.payload?.campId
  const agentRunId = command.payload?.agentRunIds?.[0]
  if (command.status !== 'accepted' || !campId || !agentRunId) {
    throw new Error(`Pi AgentRun intake failed: ${JSON.stringify(result)}`)
  }
  return { campId, agentRunId }
}

async function waitForRun(client, campId, agentRunId, options = {}) {
  const resolved = new Set()
  const deadline = Date.now() + 300_000
  let snapshot
  let run
  while (Date.now() < deadline) {
    snapshot = await client.request('camps.snapshot', { campId })
    const actions = actionsForRun(snapshot, agentRunId)
    for (const approval of approvalsForRun(snapshot, agentRunId).filter((candidate) =>
      candidate.status === 'pending' && !resolved.has(candidate.id)
    )) {
      if (!options.approval) continue
      const option = approval.options.find((candidate) => candidate.kind === options.approval)
      if (!option) throw new Error(`Pi Approval has no ${options.approval}: ${JSON.stringify(approval)}`)
      const resolution = await client.request('action.approvals.resolve', {
        commandId: crypto.randomUUID(),
        campId,
        approvalId: approval.id,
        expectedVersion: approval.version,
        optionId: option.optionId,
        reason: `Pi Runtime smoke ${options.approval}`
      })
      if (resolution.status === 'rejected') {
        throw new Error(`Pi Approval resolution failed: ${JSON.stringify(resolution)}`)
      }
      resolved.add(approval.id)
    }
    run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
      return { snapshot, run, actions, resolved }
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for Pi AgentRun ${agentRunId}: ${JSON.stringify(run)}`)
}

async function cancelRunningTool(client, campId, agentRunId) {
  const resolved = new Set()
  let cancellationRequested = false
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    const snapshot = await client.request('camps.snapshot', { campId })
    for (const approval of approvalsForRun(snapshot, agentRunId).filter((candidate) =>
      candidate.status === 'pending' && !resolved.has(candidate.id)
    )) {
      const option = approval.options.find((candidate) => candidate.kind === 'allow_once')
      if (!option) throw new Error(`Pi cancel Approval has no allow_once: ${JSON.stringify(approval)}`)
      const resolution = await client.request('action.approvals.resolve', {
        commandId: crypto.randomUUID(),
        campId,
        approvalId: approval.id,
        expectedVersion: approval.version,
        optionId: option.optionId,
        reason: 'Start bounded Pi command before cancellation.'
      })
      if (resolution.status === 'rejected') throw new Error(`Pi cancel Approval failed: ${JSON.stringify(resolution)}`)
      resolved.add(approval.id)
    }
    const run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    if (!cancellationRequested && resolved.size > 0 && run) {
      const turn = snapshot.turns.find((candidate) => candidate.id === run.campTurnId)
      const cancellation = await client.request('campTurns.cancel', {
        commandId: crypto.randomUUID(),
        command: { campId, campTurnId: turn.id, expectedVersion: turn.version }
      })
      if (cancellation.status === 'rejected') throw new Error(`Pi CampTurn cancel failed: ${JSON.stringify(cancellation)}`)
      cancellationRequested = true
    }
    if (cancellationRequested && run && ['cancelled', 'failed', 'succeeded'].includes(run.status)) {
      return { snapshot, run }
    }
    await delay(250)
  }
  throw new Error(`Timed out cancelling Pi AgentRun ${agentRunId}`)
}

function actionsForRun(snapshot, agentRunId) {
  return snapshot.actions.filter((action) => action.agentRunId === agentRunId)
}

function approvalsForRun(snapshot, agentRunId) {
  const actionIds = new Set(actionsForRun(snapshot, agentRunId).map((action) => action.id))
  return snapshot.approvals.filter((approval) => actionIds.has(approval.actionId))
}

function outputForRun(snapshot, agentRunId) {
  return snapshot.messages.find((message) => message.sourceAgentRunId === agentRunId)
}

function startForRun(events, agentRunId) {
  return events.find((event) => event.method === 'agent_run.started' && event.params?.agentRunId === agentRunId)
}

function diagnostics(client, result, agentRunId) {
  return JSON.stringify({
    run: result.run,
    output: outputForRun(result.snapshot, agentRunId),
    actions: actionsForRun(result.snapshot, agentRunId),
    approvals: approvalsForRun(result.snapshot, agentRunId),
    events: client.events.filter((event) => event.params?.agentRunId === agentRunId).slice(-40),
    stderr: client.stderr.slice(-20)
  })
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
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
