import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface as createLineInterface } from 'node:readline'
import { createInterface as createPromptInterface } from 'node:readline/promises'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { composerDocumentForAddress } from './lib/create-configured-camp.mjs'
import {
  coreDataDirectoryArguments,
  removeEphemeralRuntimeCampFilesRoot
} from './lib/runtime-camp-files-root.mjs'
import { querySqliteRows } from './lib/sqlite.mjs'

const usage = `Usage: pnpm accept:network-recovery

Runs the two interactive macOS qualification chains required by v1.53:
  1. Claude Code keeps ownership while its native API retry recovers.
  2. OpenCode returns an ACP not-accepted network terminal and Rovai retries
     the same AgentRun in a new execution epoch.

The script never changes network settings. It pauses twice for the operator to
disconnect Wi-Fi, and twice to reconnect it. If the script aborts while the
machine is offline, reconnect Wi-Fi manually.

Optional environment variables:
  ROVAI_NETWORK_RECOVERY_ACCEPT_FIXTURE_ROOT  isolated data/workspace root
  ROVAI_NETWORK_RECOVERY_ACCEPT_OUTPUT_DIR    report directory
  ROVAI_KEEP_NETWORK_RECOVERY_FIXTURE=1       keep a successful fixture
`

if (process.argv.includes('--help')) {
  process.stdout.write(usage)
  process.exit(0)
}

if (process.platform !== 'darwin') {
  throw new Error('Network interruption recovery acceptance currently requires macOS')
}
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error('Network interruption recovery acceptance requires an interactive terminal')
}

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await realpath(
  process.env.ROVAI_NETWORK_RECOVERY_ACCEPT_FIXTURE_ROOT
    ?? await mkdtemp(join(tmpdir(), 'rovai-network-recovery-accept-'))
)
const outputDir = await realpath(
  process.env.ROVAI_NETWORK_RECOVERY_ACCEPT_OUTPUT_DIR
    ?? await mkdtemp(join(tmpdir(), 'rovai-network-recovery-evidence-'))
)
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
const databasePath = join(dataDir, 'rovai.sqlite')
const reportPath = join(outputDir, 'network-interruption-recovery-acceptance.json')
const failurePath = join(outputDir, 'network-interruption-recovery-failure.json')
const claudeAgentId = 'agent_1'
const openCodeAgentId = 'agent_2'
const prompt = createPromptInterface({ input: process.stdin, output: process.stdout })

let core = null
let passed = false
let activeStep = 'fixture_setup'

try {
  await mkdir(projectRoot, { recursive: true })
  await mkdir(dataDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(projectRoot, 'README.md'), '# Network recovery acceptance fixture\n')
  await run('git', ['init', '-b', 'main'], projectRoot)
  await run('git', ['config', 'user.name', 'Rovai-ai Network Recovery Acceptance'], projectRoot)
  await run('git', ['config', 'user.email', 'network-recovery@rovai.local'], projectRoot)
  await run('git', ['add', 'README.md'], projectRoot)
  await run('git', ['commit', '-m', 'fixture'], projectRoot)

  core = startCore(dataDir)
  await core.request('health.check')
  const workspace = await core.request('workspaces.inspect', { path: projectRoot })

  activeStep = 'runtime_preflight'
  process.stdout.write('\nPreparing Claude Code and OpenCode while the network is online...\n')
  const claudeInstallation = await configureProductRuntime(
    core.request,
    'claude-code-cli',
    [claudeAgentId]
  )
  const openCodeInstallation = await configureProductRuntime(
    core.request,
    'opencode-cli',
    [openCodeAgentId]
  )
  assertReadyInstallation(claudeInstallation, 'claude-code-cli')
  assertReadyInstallation(openCodeInstallation, 'opencode-cli')

  const claudeCampId = await createCamp(core.request, {
    name: 'Native network retry acceptance',
    workspace,
    agentId: claudeAgentId
  })
  const openCodeCampId = await createCamp(core.request, {
    name: 'Rovai network recovery acceptance',
    workspace,
    agentId: openCodeAgentId
  })

  activeStep = 'online_baselines'
  const claudeBaseline = await sendAndWaitForSuccess(core, {
    campId: claudeCampId,
    agentId: claudeAgentId,
    body: 'Do not call tools or inspect files. Reply with exactly ROVAI_CLAUDE_NETWORK_BASELINE_OK and nothing else.',
    purpose: 'Establish the Claude Code session before native network retry acceptance.',
    marker: 'ROVAI_CLAUDE_NETWORK_BASELINE_OK'
  })
  const openCodeBaseline = await sendAndWaitForSuccess(core, {
    campId: openCodeCampId,
    agentId: openCodeAgentId,
    body: 'Do not call tools or inspect files. Reply with exactly ROVAI_OPENCODE_NETWORK_BASELINE_OK and nothing else.',
    purpose: 'Establish the OpenCode ACP session before Rovai network recovery acceptance.',
    marker: 'ROVAI_OPENCODE_NETWORK_BASELINE_OK'
  })
  const claudeBaselineStart = requiredStartEvent(core.events, claudeBaseline.run.id)
  const openCodeBaselineStart = requiredStartEvent(core.events, openCodeBaseline.run.id)

  process.stdout.write('\nOnline baselines passed. The script will not change Wi-Fi itself.\n')
  process.stdout.write('If any later step aborts while offline, reconnect Wi-Fi manually.\n')

  activeStep = 'claude_disconnect'
  await operatorCheckpoint(prompt, [
    'CHAIN 1/2 — Claude Code native retry',
    'Disconnect Wi-Fi now and wait until macOS shows the network is offline.',
    'Then return to this terminal and press Enter.'
  ])

  const claudeMarker = 'ROVAI_CLAUDE_NATIVE_NETWORK_RECOVERY_OK'
  const claudeRequest = await sendCampMessage(core.request, {
    campId: claudeCampId,
    body: `Do not call tools or inspect files. Reply with exactly ${claudeMarker} and nothing else.`,
    purpose: 'Prove Claude Code retains ownership across a native API retry.'
  })
  const claudeRunId = requiredAgentRunId(claudeRequest, 'Claude Code network recovery')
  const claudeInitialStart = await waitForEvent(
    core,
    (event) => event.method === 'agent_run.started'
      && event.params?.agentRunId === claudeRunId,
    'Claude Code recovery AgentRun start'
  )

  activeStep = 'claude_retry_wait'
  const nativeRetryDiagnostic = await waitForEvent(
    core,
    (event) => event.method === 'runtime.diagnostic'
      && event.params?.agentRunId === claudeRunId
      && event.params?.payload?.code === 'runtime_api_retrying'
      && event.params?.payload?.status === 'retrying',
    'Claude Code runtime_api_retrying evidence',
    { campId: claudeCampId, agentRunId: claudeRunId, timeoutMs: 180_000 }
  )

  activeStep = 'claude_reconnect'
  await operatorCheckpoint(prompt, [
    'Claude Code emitted runtime_api_retrying while the same AgentRun remained active.',
    'Reconnect Wi-Fi now and wait until macOS shows the network is online.',
    'Then return to this terminal and press Enter.'
  ])

  const claudeRecovered = await waitForRunSuccess(core, {
    campId: claudeCampId,
    agentRunId: claudeRunId,
    marker: claudeMarker,
    label: 'Claude Code native network recovery',
    timeoutMs: 360_000
  })
  const claudeStarts = core.events.filter((event) =>
    event.method === 'agent_run.started' && event.params?.agentRunId === claudeRunId
  )
  const claudeNetworkTakeovers = core.events.filter((event) =>
    event.params?.agentRunId === claudeRunId
      && (event.method === 'agent_run.network_recovery_waiting'
        || (event.method === 'agent_run.recovering'
          && event.params?.reason === 'network_recovery'))
  )
  assert(claudeStarts.length === 1,
    `Claude Code native retry unexpectedly restarted the AgentRun: ${JSON.stringify(claudeStarts)}`)
  assert(claudeInitialStart.params.executionEpoch === claudeRecovered.run.executionEpoch,
    'Claude Code native retry changed the execution epoch')
  assert(claudeInitialStart.params.nativeThreadId === claudeBaselineStart.params.nativeThreadId,
    'Claude Code native retry did not retain the established Native Session')
  assert(claudeNetworkTakeovers.length === 0,
    'Rovai incorrectly took ownership of Claude Code native API retry')

  activeStep = 'opencode_disconnect'
  await operatorCheckpoint(prompt, [
    'CHAIN 2/2 — ACP terminal followed by Rovai recovery',
    'Disconnect Wi-Fi again and wait until macOS shows the network is offline.',
    'Then return to this terminal and press Enter.'
  ])

  const openCodeMarker = 'ROVAI_OPENCODE_NEW_EPOCH_NETWORK_RECOVERY_OK'
  const openCodeRequest = await sendCampMessage(core.request, {
    campId: openCodeCampId,
    body: `Do not call tools or inspect files. Reply with exactly ${openCodeMarker} and nothing else.`,
    purpose: 'Prove Rovai recovers an ACP not-accepted network terminal in a new epoch.'
  })
  const openCodeRunId = requiredAgentRunId(openCodeRequest, 'OpenCode network recovery')
  const openCodeInitialStart = await waitForEvent(
    core,
    (event) => event.method === 'agent_run.started'
      && event.params?.agentRunId === openCodeRunId,
    'OpenCode recovery AgentRun start'
  )

  activeStep = 'opencode_waiting'
  const firstWaitingEvent = await waitForEvent(
    core,
    (event) => event.method === 'agent_run.network_recovery_waiting'
      && event.params?.agentRunId === openCodeRunId
      && event.params?.source === 'acp_prompt_terminal',
    'OpenCode ACP network terminal and Rovai waiting state',
    { campId: openCodeCampId, agentRunId: openCodeRunId, timeoutMs: 180_000 }
  )

  activeStep = 'opencode_reconnect'
  await operatorCheckpoint(prompt, [
    `Rovai recorded ${firstWaitingEvent.params.category} and queued a safe retry.`,
    'Reconnect Wi-Fi now and wait until macOS shows the network is online.',
    'Then return to this terminal and press Enter.'
  ])
  await core.request('runtime.networkRecovery.wake')

  const openCodeRecovered = await waitForRunSuccess(core, {
    campId: openCodeCampId,
    agentRunId: openCodeRunId,
    marker: openCodeMarker,
    label: 'Rovai ACP network recovery',
    timeoutMs: 360_000
  })
  const waitingEvents = core.events.filter((event) =>
    event.method === 'agent_run.network_recovery_waiting'
      && event.params?.agentRunId === openCodeRunId
  )
  const recoveringEvents = core.events.filter((event) =>
    event.method === 'agent_run.recovering'
      && event.params?.agentRunId === openCodeRunId
      && event.params?.reason === 'network_recovery'
  )
  const openCodeStarts = core.events.filter((event) =>
    event.method === 'agent_run.started' && event.params?.agentRunId === openCodeRunId
  )
  assert(waitingEvents.length >= 1, 'Rovai did not publish a network recovery waiting event')
  assert(recoveringEvents.length >= 1, 'Rovai did not admit a network recovery attempt')
  assert(openCodeStarts.length >= 2, 'OpenCode AgentRun was not restarted in a new execution epoch')
  assert(openCodeRecovered.run.executionEpoch > openCodeInitialStart.params.executionEpoch,
    'Rovai recovery did not advance the OpenCode execution epoch')
  assert(openCodeRecovered.run.waitReason === null && openCodeRecovered.run.failure === null,
    `Recovered OpenCode AgentRun retained a network failure: ${JSON.stringify(openCodeRecovered.run)}`)
  assert(openCodeInitialStart.params.nativeThreadId === openCodeBaselineStart.params.nativeThreadId,
    'The failed OpenCode attempt did not target the established Native Session')

  activeStep = 'workspace_verification'
  const workspaceStatus = await capture('git', ['status', '--porcelain=v1'], projectRoot)
  assert(workspaceStatus.trim() === '',
    `Network recovery acceptance changed the isolated workspace: ${workspaceStatus}`)

  const corePid = core.pid
  await core.stop()
  core = null

  activeStep = 'ledger_verification'
  const claudeLedger = readRunLedger(databasePath, claudeRunId)
  const openCodeLedger = readRunLedger(databasePath, openCodeRunId)
  assert(!claudeLedger.some((event) => event.eventType.startsWith('agent_run.network_recovery_')),
    'Claude Code native retry unexpectedly entered the Rovai network recovery ledger')
  assert(openCodeLedger.some((event) => event.eventType === 'runtime.input_not_accepted'),
    'OpenCode acceptance did not record a not-accepted input')
  assert(openCodeLedger.some((event) => event.eventType === 'agent_run.network_recovery_waiting'),
    'OpenCode acceptance did not persist the network waiting transition')
  assert(openCodeLedger.some((event) => event.eventType === 'agent_run.network_recovery_attempt_admitted'),
    'OpenCode acceptance did not persist recovery attempt admission')
  assert(openCodeLedger.some((event) =>
    event.eventType === 'runtime.input_accepted'
      && event.executionEpoch === openCodeRecovered.run.executionEpoch
  ), 'OpenCode recovered epoch did not persist input acceptance')
  assert(openCodeLedger.some((event) =>
    event.eventType === 'agent_run.network_recovery_progressed'
      && event.executionEpoch === openCodeRecovered.run.executionEpoch
  ), 'OpenCode recovered epoch did not clear the network recovery marker after acceptance')

  const report = {
    schemaVersion: 1,
    ok: true,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    core: {
      pid: corePid,
      generationContinuousAcrossBothChains: true
    },
    isolation: {
      dataDirectory: '<isolated-fixture>/data',
      workspace: '<isolated-fixture>/project',
      workspaceClean: true
    },
    nativeRuntimeRecovery: {
      adapterKind: 'claude-code-cli',
      runtimeVersion: claudeInstallation.snapshot.reportedVersion,
      agentRunId: claudeRunId,
      executionEpoch: claudeRecovered.run.executionEpoch,
      nativeSessionId: claudeInitialStart.params.nativeThreadId,
      diagnostic: selectDiagnostic(nativeRetryDiagnostic),
      rovaiTakeoverObserved: false,
      outputMarker: claudeMarker,
      ledger: claudeLedger
    },
    rovaiNetworkRecovery: {
      adapterKind: 'opencode-cli',
      runtimeVersion: openCodeInstallation.snapshot.reportedVersion,
      agentRunId: openCodeRunId,
      initialExecutionEpoch: openCodeInitialStart.params.executionEpoch,
      recoveredExecutionEpoch: openCodeRecovered.run.executionEpoch,
      waiting: waitingEvents.map(selectNetworkEvent),
      recovering: recoveringEvents.map(selectNetworkEvent),
      outputMarker: openCodeMarker,
      ledger: openCodeLedger
    }
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`\n${JSON.stringify({ ...report, reportPath }, null, 2)}\n`)
  passed = true
} catch (error) {
  const failure = {
    schemaVersion: 1,
    ok: false,
    failedAt: new Date().toISOString(),
    step: activeStep,
    error: error instanceof Error ? error.message : String(error),
    fixtureRoot,
    reportDirectory: outputDir
  }
  await writeFile(failurePath, `${JSON.stringify(failure, null, 2)}\n`).catch(() => undefined)
  throw error
} finally {
  prompt.close()
  if (core) {
    await core.stop().catch(() => undefined)
    if (core.stderr.length > 0) {
      await writeFile(join(outputDir, 'core-stderr.log'), core.stderr.join('')).catch(() => undefined)
    }
  }
  if (passed && process.env.ROVAI_KEEP_NETWORK_RECOVERY_FIXTURE !== '1') {
    await removeEphemeralRuntimeCampFilesRoot(dataDir).catch(() => undefined)
    await rm(fixtureRoot, { recursive: true, force: true })
  } else if (!passed) {
    process.stderr.write(`Preserved failed network recovery fixture: ${fixtureRoot}\n`)
    process.stderr.write(`Preserved network recovery evidence directory: ${outputDir}\n`)
  }
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), [
    ...coreDataDirectoryArguments(dataDirectory),
    '--skill-library-root', join(dataDirectory, 'managed-skill-library'),
    '--mcp-config-path', join(dataDirectory, 'mcp.json')
  ], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env
  })
  const pending = new Map()
  const events = []
  const stderr = []
  let nextId = 1
  let stopping = false

  child.stderr.on('data', (chunk) => {
    const text = String(chunk)
    stderr.push(text)
    process.stderr.write(text)
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
  createLineInterface({ input: child.stdout }).on('line', (line) => {
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
    stopping = true
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000))
    ])
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise((resolveClose) => child.once('close', resolveClose))
    }
  }
  return { request, stop, events, stderr, pid: child.pid }
}

async function createCamp(request, { name, workspace, agentId }) {
  const created = await request('camps.create', {
    commandId: crypto.randomUUID(),
    name,
    workspace: { projectPath: workspace.projectPath },
    memberAgentIds: [agentId],
    defaultLeadAgentId: agentId,
    collaborationMode: 'peer'
  })
  const campId = created.payload?.campId
  assert(created.status === 'applied' && campId,
    `Acceptance Camp creation failed: ${JSON.stringify(created)}`)
  return campId
}

async function sendCampMessage(request, { campId, agentId = null, body, purpose }) {
  const draft = await request('camp.composerDraft.get', { campId })
  const address = agentId
    ? { mode: 'explicit', agentIds: [agentId] }
    : { mode: 'default' }
  const saved = await request('camp.composerDraft.save', {
    campId,
    expectedRevision: draft.revision,
    content: composerDocumentForAddress(address, body)
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

async function sendAndWaitForSuccess(coreHandle, input) {
  const sent = await sendCampMessage(coreHandle.request, input)
  const agentRunId = requiredAgentRunId(sent, input.marker)
  return waitForRunSuccess(coreHandle, {
    campId: input.campId,
    agentRunId,
    marker: input.marker,
    label: `${input.marker} online baseline`,
    timeoutMs: 240_000
  })
}

function requiredAgentRunId(result, label) {
  const commandResult = result.commandResult ?? result
  const agentRunId = commandResult.payload?.agentRunIds?.[0]
  assert(commandResult.status === 'accepted' && agentRunId,
    `${label} AgentRun intake failed: ${JSON.stringify(result)}`)
  return agentRunId
}

async function waitForRunSuccess(coreHandle, {
  campId,
  agentRunId,
  marker,
  label,
  timeoutMs
}) {
  return waitFor(async () => {
    const snapshot = await coreHandle.request('camps.snapshot', { campId })
    const run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    if (run && ['failed', 'cancelled'].includes(run.status)) {
      throw new Error(`${label} entered ${run.status}: ${JSON.stringify({
        run,
        events: coreHandle.events
          .filter((event) => event.params?.agentRunId === agentRunId)
          .slice(-30)
      })}`)
    }
    const message = snapshot.messages.find((candidate) =>
      candidate.sourceAgentRunId === agentRunId && candidate.body.includes(marker)
    )
    return run?.status === 'succeeded' && message ? { snapshot, run, message } : null
  }, label, timeoutMs)
}

async function waitForEvent(coreHandle, predicate, label, options = {}) {
  return waitFor(async () => {
    const event = coreHandle.events.find(predicate)
    if (event) return event
    if (options.campId && options.agentRunId) {
      const snapshot = await coreHandle.request('camps.snapshot', { campId: options.campId })
      const run = snapshot.agentRuns.find((candidate) => candidate.id === options.agentRunId)
      if (run && ['failed', 'cancelled', 'succeeded'].includes(run.status)) {
        throw new Error(`${label} was not observed before the AgentRun entered ${run.status}: ${JSON.stringify(run)}`)
      }
    }
    return null
  }, label, options.timeoutMs ?? 120_000)
}

async function waitFor(probe, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function operatorCheckpoint(promptInterface, lines) {
  process.stdout.write(`\n${lines.join('\n')}\n`)
  await promptInterface.question('Press Enter to continue: ')
}

function requiredStartEvent(events, agentRunId) {
  const event = events.find((candidate) =>
    candidate.method === 'agent_run.started' && candidate.params?.agentRunId === agentRunId
  )
  assert(event, `AgentRun ${agentRunId} has no start event`)
  return event
}

function assertReadyInstallation(installation, adapterKind) {
  assert(installation?.snapshot?.probeStatus === 'ready'
    && installation.snapshot.models.length > 0,
  `${adapterKind} is not ready: ${JSON.stringify(installation)}`)
}

function readRunLedger(database, agentRunId) {
  const escapedRunId = agentRunId.replaceAll("'", "''")
  return querySqliteRows(database, `
    SELECT event_type AS eventType,
           execution_epoch AS executionEpoch,
           payload_json AS payloadJson,
           created_at AS createdAt
    FROM event_log
    WHERE (entity_id = '${escapedRunId}' OR source_agent_run_id = '${escapedRunId}')
      AND event_type IN (
        'runtime.input_not_accepted',
        'runtime.input_accepted',
        'agent_run.network_recovery_waiting',
        'agent_run.network_recovery_attempt_admitted',
        'agent_run.network_recovery_progressed'
      )
    ORDER BY global_sequence ASC
  `).map((row) => ({
    eventType: row.eventType,
    executionEpoch: Number(row.executionEpoch),
    createdAt: row.createdAt,
    payload: selectLedgerPayload(JSON.parse(row.payloadJson))
  }))
}

function selectLedgerPayload(payload) {
  return Object.fromEntries([
    'category',
    'source',
    'attempt',
    'progress',
    'boundarySequence',
    'nativeInputId'
  ].flatMap((key) => Object.hasOwn(payload, key) ? [[key, payload[key]]] : []))
}

function selectDiagnostic(event) {
  const payload = event.params?.payload ?? {}
  return {
    code: payload.code,
    status: payload.status,
    attempt: payload.attempt,
    maxAttempts: payload.maxAttempts,
    retryAfterSeconds: payload.retryAfterSeconds
  }
}

function selectNetworkEvent(event) {
  return {
    method: event.method,
    executionEpoch: event.params?.executionEpoch,
    category: event.params?.category,
    source: event.params?.source,
    attempt: event.params?.attempt,
    retryAfterSeconds: event.params?.retryAfterSeconds
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
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

async function capture(command, args, cwd) {
  return new Promise((resolveCapture, rejectCapture) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectCapture)
    child.once('close', (code) => code === 0
      ? resolveCapture(stdout.join(''))
      : rejectCapture(new Error(`${command} failed (${code}): ${stderr.join('')}`)))
  })
}
