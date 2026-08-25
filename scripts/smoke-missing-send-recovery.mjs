import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import { validateAcpRecoveryProtocolFixture } from './lib/missing-send-recovery-protocol.mjs'
import { querySqliteRows } from './lib/sqlite.mjs'
import {
  coreDataDirectoryArguments,
  removeEphemeralRuntimeCampFilesRoot
} from './lib/runtime-camp-files-root.mjs'

const root = resolve(import.meta.dirname, '..')
const coreExecutable = resolve(
  process.env.ROVAI_MISSING_SEND_RECOVERY_CORE_EXECUTABLE
    ?? join(root, 'target', 'debug', 'rovai-core')
)
const allSpecifications = [
  ['codex-cli', 'Codex'],
  ['pi', 'Pi'],
  ['opencode-cli', 'OpenCode'],
  ['copilot-cli', 'Copilot'],
  ['claude-code-cli', 'Claude'],
  ['antigravity-app', 'Antigravity'],
  ['kiro-cli', 'Kiro'],
  ['qoder-cli', 'Qoder'],
  ['codebuddy-cli', 'CodeBuddy'],
  ['qwen-code', 'Qwen'],
  ['trae-cn-cli', 'TRAE'],
  ['kimi-code-cli', 'Kimi Code'],
  ['grok-build', 'Grok Build']
].map(([adapterKind, label]) => ({
  adapterKind,
  label,
  slug: adapterKind.replaceAll('-', '_'),
  acp: !['codex-cli', 'pi', 'claude-code-cli', 'antigravity-app'].includes(adapterKind)
}))
const selected = selectedAdapters()
const specifications = allSpecifications.filter(({ adapterKind }) => selected.has(adapterKind))
const unknown = [...selected].filter((adapterKind) =>
  !allSpecifications.some((specification) => specification.adapterKind === adapterKind)
)
if (unknown.length) {
  throw new Error(`Unknown ROVAI_MISSING_SEND_RECOVERY_ADAPTERS: ${unknown.join(', ')}`)
}
if (!specifications.length) throw new Error('At least one Runtime must be selected')

const reportDirectory = resolve(
  process.env.ROVAI_MISSING_SEND_RECOVERY_REPORT_DIR
    ?? join(tmpdir(), `rovai-missing-send-recovery-report-${Date.now()}`)
)
await mkdir(reportDirectory, { recursive: true })
const reportPath = join(reportDirectory, 'report.json')
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  coreExecutable,
  selectedAdapters: specifications.map(({ adapterKind }) => adapterKind),
  results: []
}
await persistReport()

for (const specification of specifications) {
  process.stderr.write(`\n[missing-send-recovery] ${specification.adapterKind}: isolated real Runtime acceptance\n`)
  const fixtureRoot = await realpath(
    await mkdtemp(join(tmpdir(), `rovai-missing-send-${specification.slug}-`))
  )
  const projectRoot = join(fixtureRoot, 'project')
  const dataDir = join(fixtureRoot, 'data')
  const databasePath = join(dataDir, 'rovai.sqlite')
  let core = null
  let failed = true
  try {
    await mkdir(projectRoot)
    const toolFixtureToken = `ROVAI_RECOVERY_TOOL_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`
    const zeroMarker = `ROVAI_MISSING_SEND_ZERO_${specification.slug.toUpperCase()}`
    const progressMarker = `ROVAI_MISSING_SEND_PROGRESS_${specification.slug.toUpperCase()}`
    const privateFinalMarker = `ROVAI_MISSING_SEND_PRIVATE_FINAL_${specification.slug.toUpperCase()}`
    await writeFile(join(projectRoot, 'README.md'), `# ${specification.label} missing-send recovery fixture\n`)
    await writeFile(join(projectRoot, 'RECOVERY_TOOL_FIXTURE.txt'), `${toolFixtureToken}\n`)
    await gitFixture(projectRoot, specification.label)

    core = startCore(dataDir)
    await core.request('health.check')
    const workspace = await core.request('workspaces.inspect', { path: projectRoot })
    const agentId = 'agent_1'
    const installation = await configureProductRuntime(
      core.request,
      specification.adapterKind,
      [agentId]
    )
    if (installation?.snapshot?.probeStatus !== 'ready') {
      throw new Error(`${specification.adapterKind} is not ready: ${JSON.stringify(installation)}`)
    }
    const modelOverride = selectedModelOverride(specification)
    if (modelOverride) {
      await selectExplicitModel(
        core.request,
        agentId,
        specification.adapterKind,
        modelOverride
      )
    }

    const zeroStart = await createConfiguredCampAndSend(core.request, {
      commandId: crypto.randomUUID(),
      name: `${specification.label} missing-send recovery`,
      workspace,
      memberAgentIds: [agentId],
      defaultLeadAgentId: agentId,
      body: zeroSendPrompt(zeroMarker),
      purpose: 'Exercise the Core zero-send recovery boundary without an Agent send.'
    })
    const campId = acceptedRunId(zeroStart).campId
    const zeroRunId = acceptedRunId(zeroStart).agentRunId
    await waitForTerminalRun(core, campId, zeroRunId, `${specification.adapterKind} zero-send`)
    const zeroFacts = await readRunFacts(databasePath, zeroRunId)
    assertRecoveryPublication(zeroFacts, {
      adapterKind: specification.adapterKind,
      marker: zeroMarker,
      expectedAuthorId: agentId,
      expectedBoundary: expectedBoundary(specification)
    })
    process.stderr.write(`[missing-send-recovery] ${specification.adapterKind}: zero-send published\n`)

    const suppressionStart = await startFollowUpRun(
      core.request,
      campId,
      suppressionPrompt(specification.adapterKind, progressMarker, privateFinalMarker),
      'Exercise accepted-send suppression with a different private final.'
    )
    await waitForTerminalRun(
      core,
      campId,
      suppressionStart.agentRunId,
      `${specification.adapterKind} accepted-send suppression`
    )
    const suppressionFacts = await readRunFacts(databasePath, suppressionStart.agentRunId)
    assertAcceptedSendSuppression(suppressionFacts, {
      progressMarker,
      privateFinalMarker,
      expectedAuthorId: agentId
    })
    process.stderr.write(`[missing-send-recovery] ${specification.adapterKind}: accepted send suppressed fallback\n`)

    let acpProtocol = null
    if (specification.acp) {
      const toolStart = await startFollowUpRun(
        core.request,
        campId,
        toolThenFinalPrompt(),
        'Exercise a real ACP tool boundary followed by a zero-send final.'
      )
      await waitForTerminalRun(
        core,
        campId,
        toolStart.agentRunId,
        `${specification.adapterKind} tool-then-final`
      )
      const toolFacts = await readRunFacts(databasePath, toolStart.agentRunId)
      assertRecoveryPublication(toolFacts, {
        adapterKind: specification.adapterKind,
        marker: toolFixtureToken,
        expectedAuthorId: agentId,
        expectedBoundary: 'acp_end_turn_assistant_suffix'
      })
      if (toolFacts.runtimeActivities.length === 0) {
        throw new Error(`${specification.adapterKind} did not persist real tool activity`)
      }
      const protocolFixture = buildAcpProtocolFixture(
        core.events,
        specification.adapterKind,
        toolStart.agentRunId,
        toolFacts.messages[0]?.body,
        toolFacts
      )
      acpProtocol = validateAcpRecoveryProtocolFixture(protocolFixture)
      await writeFile(
        join(reportDirectory, `${specification.adapterKind}-protocol-fixture.json`),
        `${JSON.stringify(protocolFixture, null, 2)}\n`
      )
      process.stderr.write(`[missing-send-recovery] ${specification.adapterKind}: real tool→final protocol fixture passed\n`)
    }

    const result = {
      adapterKind: specification.adapterKind,
      reportedVersion: installation.snapshot.reportedVersion,
      selectedModel: core.events.find((event) =>
        event.method === 'agent_run.started' && event.params?.agentRunId === zeroRunId
      )?.params?.modelId ?? null,
      zeroSend: summarizeFacts(zeroFacts),
      acceptedSendSuppression: summarizeFacts(suppressionFacts),
      acpProtocol
    }
    report.results.push(result)
    await persistReport()
    failed = false
  } catch (error) {
    report.failure = {
      adapterKind: specification.adapterKind,
      message: error instanceof Error ? error.stack ?? error.message : String(error),
      fixtureRoot
    }
    await persistReport()
    throw error
  } finally {
    if (core) await core.stop()
    if (!failed && process.env.ROVAI_KEEP_MISSING_SEND_RECOVERY_FIXTURE !== '1') {
      await removeEphemeralRuntimeCampFilesRoot(dataDir)
      await rm(fixtureRoot, { recursive: true, force: true })
    } else {
      process.stderr.write(`[missing-send-recovery] retained fixture: ${fixtureRoot}\n`)
    }
  }
}

report.completedAt = new Date().toISOString()
report.ok = report.results.length === specifications.length
delete report.failure
await persistReport()
console.log(JSON.stringify({
  ok: report.ok,
  reportPath,
  adapters: report.results.map((result) => ({
    adapterKind: result.adapterKind,
    reportedVersion: result.reportedVersion,
    model: result.selectedModel,
    zeroSend: result.zeroSend.decision,
    suppression: result.acceptedSendSuppression.decision,
    acpToolEvents: result.acpProtocol?.toolEventCount ?? null
  }))
}, null, 2))

function selectedAdapters() {
  const raw = process.env.ROVAI_MISSING_SEND_RECOVERY_ADAPTERS ?? 'all'
  if (raw.trim() === 'all') return new Set(allSpecifications.map(({ adapterKind }) => adapterKind))
  return new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))
}

function selectedModelOverride(specification) {
  const key = `ROVAI_MISSING_SEND_RECOVERY_MODEL_${specification.slug.toUpperCase()}`
  const value = process.env[key]
  return value?.trim() || null
}

function zeroSendPrompt(marker) {
  return [
    'This is a controlled missing-send recovery acceptance case.',
    'Do not call rovai, rovai send, shell, MCP, or any other tool.',
    'This Runtime response is intentionally private execution output; Core recovery is the behavior under test.',
    `Return exactly ${marker} and no other text.`
  ].join(' ')
}

function suppressionPrompt(adapterKind, progressMarker, privateFinalMarker) {
  const sendCommand = process.platform === 'win32'
    ? ['qwen-code', 'trae-cn-cli'].includes(adapterKind)
      // Qwen and TRAE reliably expose direct cmd execution, while nested
      // PowerShell quoting can be treated as optional prose or rejected before
      // ACP permission projection. The qualification path is space-free.
      ? `cmd.exe /d /s /c %ROVAI_AGENT_CLI% send --body ${progressMarker}`
      // ACP Bash implementations must not expand PowerShell's `$env` before
      // powershell.exe receives it. The marker is generated from a closed
      // alphanumeric adapter slug and is safe inside the inner double quotes.
      : `powershell.exe -NoProfile -Command '& $env:ROVAI_AGENT_CLI send --body "${progressMarker}"'`
    : `"$ROVAI_AGENT_CLI" send --body ${shellQuote(progressMarker)}`
  return [
    'Publish one progress update to the current Camp, then report completion to me.',
    'The local Rovai Built-in CLI path is available in ROVAI_AGENT_CLI and its current-Run lease is available in ROVAI_CLI_CONTEXT.',
    'You must use your native terminal/shell tool exactly once to run this command. Do not simulate, skip, or answer before the tool completes:',
    sendCommand,
    'Do not call any other rovai command and do not send a second message.',
    `After that command succeeds, reply with exactly ${privateFinalMarker} and no other text. Do not publish that completion token.`
  ].join('\n')
}

function toolThenFinalPrompt() {
  return [
    'This is a controlled ACP tool-boundary acceptance case.',
    'Use your native file-reading tool (not shell) to read RECOVERY_TOOL_FIXTURE.txt from the current workspace.',
    'The file contains one unpredictable token that is not included in this request; do not guess it.',
    'Do not call rovai or rovai send.',
    'After the tool completes, return exactly the one-line token read from the file and no other text.'
  ].join(' ')
}

async function startFollowUpRun(request, campId, body, purpose) {
  const currentDraft = await request('camp.composerDraft.get', { campId })
  const savedDraft = await request('camp.composerDraft.save', {
    campId,
    expectedRevision: currentDraft.revision,
    content: [{ kind: 'text', text: body }]
  })
  const sent = await request('camp.messages.send', {
    commandId: crypto.randomUUID(),
    campId,
    draftRevision: savedDraft.revision,
    execution: { taskId: null, purpose, completionRole: 'required' }
  })
  return acceptedRunId(sent, campId)
}

async function selectExplicitModel(request, agentId, adapterKind, modelId) {
  const profile = await request('members.get', { agentId })
  const result = await request('members.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentId,
      expectedVersion: profile.version,
      adapterKind,
      model: {
        mode: 'explicit',
        modelId,
        options: {}
      },
      permissions: profile.runtimeConfiguration.permissions
    }
  })
  if (result.status !== 'applied') {
    throw new Error(`Explicit Runtime model was not selected: ${JSON.stringify(result)}`)
  }
  const resolved = await request('members.get', { agentId })
  if (resolved.runtimeReadiness?.status !== 'ready'
      || resolved.runtimeConfiguration?.model?.modelId !== modelId) {
    throw new Error(`Explicit Runtime model is not ready: ${JSON.stringify(resolved)}`)
  }
}

function acceptedRunId(sent, knownCampId = null) {
  const commandResult = sent.commandResult ?? sent
  const campId = knownCampId ?? commandResult.payload?.campId
  const agentRunId = commandResult.payload?.agentRunIds?.[0]
  if (commandResult.status !== 'accepted' || !campId || !agentRunId) {
    throw new Error(`AgentRun intake failed: ${JSON.stringify(sent)}`)
  }
  return { campId, agentRunId }
}

async function waitForTerminalRun(core, campId, agentRunId, label) {
  const deadline = Date.now() + Number(process.env.ROVAI_MISSING_SEND_RECOVERY_TIMEOUT_MS ?? 480_000)
  const resolvedApprovals = new Set()
  while (Date.now() < deadline) {
    const snapshot = await core.request('camps.snapshot', { campId })
    await resolvePendingApprovals(core.request, snapshot, agentRunId, resolvedApprovals)
    const run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    if (run?.status === 'succeeded') return { snapshot, run }
    if (['failed', 'cancelled'].includes(run?.status)) {
      throw new Error(`${label} entered ${run.status}: ${JSON.stringify({
        run,
        messages: snapshot.messages.filter((message) => message.sourceAgentRunId === agentRunId),
        timeline: snapshot.timeline.slice(-20),
        events: core.events.filter((event) => event.params?.agentRunId === agentRunId).slice(-30)
      })}`)
    }
    await delay(400)
  }
  throw new Error(`Timed out waiting for ${label} (${agentRunId})`)
}

async function resolvePendingApprovals(request, snapshot, agentRunId, resolvedApprovals) {
  const actionIds = new Set(snapshot.actions
    .filter((action) => action.agentRunId === agentRunId)
    .map((action) => action.id))
  for (const approval of snapshot.approvals.filter((candidate) =>
    candidate.status === 'pending'
      && actionIds.has(candidate.actionId)
      && !resolvedApprovals.has(candidate.id)
  )) {
    const option = approval.options.find((candidate) => candidate.kind === 'allow_once')
      ?? approval.options.find((candidate) => candidate.kind === 'allow_session')
    if (!option) throw new Error(`No bounded allow option for ${approval.id}`)
    const result = await request('action.approvals.resolve', {
      commandId: crypto.randomUUID(),
      campId: snapshot.camp.id,
      approvalId: approval.id,
      expectedVersion: approval.version,
      optionId: option.optionId,
      reason: 'Local missing-send recovery Runtime qualification'
    })
    if (result.status === 'rejected') {
      throw new Error(`Approval ${approval.id} was rejected: ${JSON.stringify(result)}`)
    }
    resolvedApprovals.add(approval.id)
  }
}

async function readRunFacts(databasePath, agentRunId) {
  const id = sqlLiteral(agentRunId)
  const [run] = await sqliteJson(databasePath, `
    SELECT id, status, invocation_kind AS invocationKind,
           final_camp_message_id AS finalCampMessageId
    FROM agent_run WHERE id = ${id};
  `)
  const messages = await sqliteJson(databasePath, `
    SELECT id, author_type AS authorType, author_id AS authorId,
           source_agent_run_id AS sourceAgentRunId, body,
           structured_content_json AS structuredContentJson,
           address_mode AS addressMode,
           addressed_agent_ids_json AS addressedAgentIdsJson,
           effective_recipient_ids_json AS effectiveRecipientIdsJson,
           recipient_presentation_json AS recipientPresentationJson,
           source_operation_id AS sourceOperationId,
           reply_to_camp_message_id AS replyToCampMessageId,
           (SELECT COUNT(*) FROM message_delivery WHERE message_id = camp_message.id) AS deliveryCount
    FROM camp_message WHERE source_agent_run_id = ${id}
    ORDER BY sequence, id;
  `)
  const eventRows = await sqliteJson(databasePath, `
    SELECT payload_json AS payloadJson
    FROM event_log
    WHERE event_type = 'agent_run.succeeded'
      AND entity_type = 'agent_run' AND entity_id = ${id}
    ORDER BY global_sequence DESC LIMIT 1;
  `)
  const runtimeActivities = await sqliteJson(databasePath, `
    SELECT operation_id AS operationId, activity_domain AS activityDomain,
           semantic_kind AS semanticKind, tool_name AS toolName,
           phase, outcome
    FROM canonical_runtime_activity
    WHERE agent_run_id = ${id}
      AND (tool_name IS NOT NULL OR activity_domain NOT IN ('runtime', 'unknown'))
    ORDER BY first_evidence_sequence;
  `)
  return {
    run,
    messages: messages.map((message) => ({
      ...message,
      structuredContent: JSON.parse(message.structuredContentJson),
      addressedAgentIds: JSON.parse(message.addressedAgentIdsJson),
      effectiveRecipientIds: JSON.parse(message.effectiveRecipientIdsJson),
      recipientPresentation: JSON.parse(message.recipientPresentationJson)
    })),
    terminalEvent: eventRows[0] ? JSON.parse(eventRows[0].payloadJson) : null,
    runtimeActivities
  }
}

function assertRecoveryPublication(facts, {
  adapterKind,
  marker,
  expectedAuthorId,
  expectedBoundary
}) {
  if (facts.run?.status !== 'succeeded') throw new Error(`${adapterKind} Run did not succeed`)
  if (facts.messages.length !== 1) {
    throw new Error(`${adapterKind} zero-send created ${facts.messages.length} source messages: ${JSON.stringify(facts.messages)}`)
  }
  const [message] = facts.messages
  const canonicalContent = JSON.stringify([{ kind: 'text', text: message.body }])
  const messageDigest = `sha256:${createHash('sha256').update(canonicalContent).digest('hex')}`
  if (message.id !== facts.run.finalCampMessageId
      || !message.body.includes(marker)
      || message.authorType !== 'agent'
      || message.authorId !== expectedAuthorId
      || message.sourceAgentRunId !== facts.run.id
      || message.sourceOperationId !== null
      || message.replyToCampMessageId !== null
      || message.addressMode !== 'default'
      || message.deliveryCount !== 0
      || JSON.stringify(message.addressedAgentIds) !== '[]'
      || JSON.stringify(message.effectiveRecipientIds) !== '[]'
      || JSON.stringify(message.recipientPresentation) !== '{}'
      || JSON.stringify(message.structuredContent) !== JSON.stringify([{ kind: 'text', text: message.body }])) {
    throw new Error(`${adapterKind} recovery message shape is invalid: ${JSON.stringify({ facts, marker })}`)
  }
  const recovery = facts.terminalEvent?.missingSendRecovery
  if (recovery?.decision !== 'published'
      || recovery.acceptedSendDetected !== false
      || recovery.candidateBoundary !== expectedBoundary
      || recovery.messageId !== message.id
      || recovery.candidateDigest !== messageDigest) {
    throw new Error(`${adapterKind} recovery decision is invalid: ${JSON.stringify(recovery)}`)
  }
}

function assertAcceptedSendSuppression(facts, {
  progressMarker,
  privateFinalMarker,
  expectedAuthorId
}) {
  if (facts.run?.status !== 'succeeded' || facts.run.finalCampMessageId !== null) {
    throw new Error(`Suppression Run terminal link is invalid: ${JSON.stringify(facts.run)}`)
  }
  if (facts.messages.length !== 1
      || facts.messages[0].body !== progressMarker
      || facts.messages[0].authorType !== 'agent'
      || facts.messages[0].authorId !== expectedAuthorId
      || facts.messages[0].sourceAgentRunId !== facts.run.id
      || typeof facts.messages[0].sourceOperationId !== 'string'
      || !facts.messages[0].sourceOperationId
      || facts.messages.some((message) => message.body.includes(privateFinalMarker))) {
    throw new Error(`Accepted-send suppression message facts are invalid: ${JSON.stringify(facts.messages)}`)
  }
  const recovery = facts.terminalEvent?.missingSendRecovery
  if (recovery?.decision !== 'suppressed_accepted_send'
      || recovery.acceptedSendDetected !== true
      || recovery.messageId !== null) {
    throw new Error(`Accepted-send suppression decision is invalid: ${JSON.stringify(recovery)}`)
  }
}

function buildAcpProtocolFixture(events, adapterKind, agentRunId, expectedFinal, facts) {
  const fixtureEvents = []
  for (const [sequence, event] of events.entries()) {
    if (event.params?.agentRunId !== agentRunId) continue
    const payload = event.params?.payload ?? {}
    if (event.method === 'runtime.action') {
      fixtureEvents.push({
        sequence,
        kind: 'tool',
        sessionUpdate: payload.sessionUpdate ?? null,
        toolCallIdPresent: typeof payload.toolCallId === 'string' && payload.toolCallId.length > 0,
        phase: event.params?.canonical?.phase ?? null
      })
    } else if (event.method === 'agent.text.delta') {
      fixtureEvents.push({
        sequence,
        kind: 'assistant',
        messageId: payload.messageId ?? null,
        messageIdSource: payload.messageIdSource ?? null,
        text: payload.delta ?? ''
      })
    } else if (event.method === 'runtime.turn.completed') {
      fixtureEvents.push({
        sequence,
        kind: 'turn_completed',
        stopReason: payload.result?.stopReason ?? null
      })
    }
  }
  return {
    schemaVersion: 1,
    adapterKind,
    agentRunId,
    expectedFinal,
    assistantStreamVisibility: 'public',
    publishedFinal: facts.messages[0]?.body ?? null,
    recovery: facts.terminalEvent?.missingSendRecovery ?? null,
    events: fixtureEvents
  }
}

function expectedBoundary(specification) {
  if (specification.acp) return 'acp_end_turn_assistant_suffix'
  if (specification.adapterKind === 'pi') return 'pi_agent_settled'
  if (specification.adapterKind === 'codex-cli') return 'codex_completed_turn'
  if (specification.adapterKind === 'claude-code-cli') return 'claude_success_result'
  return 'antigravity_print_stdout'
}

function summarizeFacts(facts) {
  return {
    status: facts.run.status,
    invocationKind: facts.run.invocationKind,
    messageCount: facts.messages.length,
    finalCampMessageId: facts.run.finalCampMessageId,
    decision: facts.terminalEvent.missingSendRecovery.decision,
    acceptedSendDetected: facts.terminalEvent.missingSendRecovery.acceptedSendDetected,
    candidateBoundary: facts.terminalEvent.missingSendRecovery.candidateBoundary,
    deliveryCount: facts.messages.reduce((total, message) => total + message.deliveryCount, 0)
  }
}

function startCore(dataDirectory) {
  const child = spawn(coreExecutable, [
    ...coreDataDirectoryArguments(dataDirectory),
    '--skill-library-root', join(dataDirectory, 'managed-skill-library')
  ], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const pending = new Map()
  const events = []
  const stderr = []
  let nextId = 1
  let stopping = false
  child.stderr.on('data', (chunk) => {
    const output = String(chunk)
    stderr.push(output)
    process.stderr.write(output)
  })
  const rejectPending = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }
  child.once('error', rejectPending)
  child.once('close', (code, signal) => {
    if (!stopping) {
      rejectPending(new Error(`rovai-core exited early (code=${code}, signal=${signal}): ${stderr.slice(-10).join('')}`))
    }
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) {
      events.push(message)
      return
    }
    const entry = pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(`${message.error.code}: ${message.error.message}`))
    else entry.resolve(message.result)
  })
  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`Timed out waiting for Core method ${method}`))
    }, 180_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
  const stop = async () => {
    if (child.exitCode !== null || child.killed) return
    stopping = true
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      delay(5_000)
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  return { request, stop, events }
}

async function sqliteJson(databasePath, sql) {
  return querySqliteRows(databasePath, sql)
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

async function gitFixture(projectRoot, label) {
  await runCapture('git', ['init', '-b', 'main'], { cwd: projectRoot })
  await runCapture('git', ['config', 'user.name', `Rovai ${label} Missing-Send Smoke`], { cwd: projectRoot })
  await runCapture('git', ['config', 'user.email', `${basename(projectRoot)}@rovai.local`], { cwd: projectRoot })
  await runCapture('git', ['add', 'README.md', 'RECOVERY_TOOL_FIXTURE.txt'], { cwd: projectRoot })
  await runCapture('git', ['commit', '-m', 'fixture'], { cwd: projectRoot })
}

async function runCapture(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code, signal) => {
      const result = { code, signal, stdout: stdout.join(''), stderr: stderr.join('') }
      if (code === 0) resolveRun(result)
      else rejectRun(new Error(`${command} exited ${code}: ${JSON.stringify(result)}`))
    })
  })
}

async function persistReport() {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
