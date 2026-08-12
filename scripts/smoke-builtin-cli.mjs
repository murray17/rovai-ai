import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const coreExecutable = resolve(
  process.env.ROVAI_BUILTIN_CLI_CORE_EXECUTABLE ?? join(root, 'target', 'debug', 'rovai-core')
)
const cliExecutable = resolve(
  process.env.ROVAI_BUILTIN_CLI_EXECUTABLE ?? join(root, 'target', 'debug', 'rovai')
)
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-builtin-cli-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
const skillLibraryRoot = join(fixtureRoot, 'skill-library')
const historyMarker = 'ROVAI_BUILTIN_HISTORY_V1'
const expectedOperations = [
  'camp.list',
  'camp.message.send',
  'camp.read',
  'camp.search',
  'history.search',
  'memory.propose_hearth',
  'memory.read',
  'memory.search',
  'memory.write',
  'team.create_task',
  'team.get_task',
  'team.list_tasks',
  'team.update_task'
]
const allRuntimeSpecifications = [
  ['codex-cli', 'Codex'],
  ['opencode-cli', 'OpenCode'],
  ['copilot-cli', 'Copilot'],
  ['claude-code-cli', 'Claude'],
  ['antigravity-app', 'Antigravity'],
  ['kiro-cli', 'Kiro'],
  ['qoder-cli', 'Qoder'],
  ['codebuddy-cli', 'CodeBuddy'],
  ['qwen-code', 'Qwen']
].map(([adapterKind, label]) => ({ adapterKind, label, slug: adapterKind.replaceAll('-', '_') }))
const selectedAdapters = new Set((process.env.ROVAI_BUILTIN_CLI_ADAPTERS
  ?? allRuntimeSpecifications.map((value) => value.adapterKind).join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean))
const unknownAdapters = [...selectedAdapters].filter((adapterKind) =>
  !allRuntimeSpecifications.some((value) => value.adapterKind === adapterKind)
)
if (unknownAdapters.length) {
  throw new Error(`Unknown ROVAI_BUILTIN_CLI_ADAPTERS: ${unknownAdapters.join(', ')}`)
}
const runtimeSpecifications = allRuntimeSpecifications.filter((value) =>
  selectedAdapters.has(value.adapterKind)
)

let core = null
let keepFixture = process.env.ROVAI_KEEP_BUILTIN_CLI_FIXTURE === '1'

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Built-in CLI Runtime Qualification\n')
  await runCapture('git', ['init', '-b', 'main'], { cwd: projectRoot, expectedCode: 0 })
  await runCapture('git', ['config', 'user.name', 'Rovai Built-in CLI Smoke'], { cwd: projectRoot, expectedCode: 0 })
  await runCapture('git', ['config', 'user.email', 'builtin-cli@rovai.local'], { cwd: projectRoot, expectedCode: 0 })
  await runCapture('git', ['add', 'README.md'], { cwd: projectRoot, expectedCode: 0 })
  await runCapture('git', ['commit', '-m', 'fixture'], { cwd: projectRoot, expectedCode: 0 })

  core = startCore(dataDir)
  await core.request('health.check')
  const workspace = await core.request('workspaces.inspect', { path: projectRoot })

  for (const specification of runtimeSpecifications) {
    specification.agentId = await createProfile(
      core.request,
      `${specification.label} CLI Verifier`
    )
    specification.recipientProfileId = await createProfile(
      core.request,
      `${specification.label} CLI Receipt Worker`
    )
    specification.installation = await configureProductRuntime(
      core.request,
      specification.adapterKind,
      [specification.agentId, specification.recipientProfileId]
    )
    if (specification.adapterKind === 'codex-cli'
        && process.env.ROVAI_BUILTIN_CLI_CODEX_MODEL) {
      for (const agentId of [
        specification.agentId,
        specification.recipientProfileId
      ]) {
        await selectExplicitModel(
          core.request,
          agentId,
          specification.adapterKind,
          process.env.ROVAI_BUILTIN_CLI_CODEX_MODEL
        )
      }
    }
    assertBuiltinCliCapability(specification.adapterKind, specification.installation)
  }

  const historyCampId = await createCamp(core.request, {
    name: 'Built-in CLI Shared History',
    projectPath: workspace.projectPath,
    memberAgentIds: runtimeSpecifications.flatMap((value) => [
      value.agentId,
      value.recipientProfileId
    ]),
    defaultLeadAgentId: runtimeSpecifications[0].agentId
  })
  await sendCampMessage(core.request, {
    campId: historyCampId,
    body: `${historyMarker}: shared historical evidence for all nine Runtime qualifications.`,
    execution: null
  })

  for (const specification of runtimeSpecifications) {
    specification.currentMarker = `ROVAI_CURRENT_${specification.slug.toUpperCase()}_V1`
    specification.successMarker = `ROVAI_BUILTIN_CLI_${specification.slug.toUpperCase()}_OK`
    specification.resumeMarker = `ROVAI_BUILTIN_CLI_${specification.slug.toUpperCase()}_RESUME_OK`
    specification.contextPathFile = join(projectRoot, `.context-path-${specification.slug}`)
    specification.resumeContextPathFile = join(projectRoot, `.resume-context-path-${specification.slug}`)
    specification.resumeCompletionFile = join(projectRoot, `.resume-complete-${specification.slug}`)
    specification.sendEvidencePath = join(projectRoot, `.send-evidence-${specification.slug}.json`)
    specification.diagnosticPath = join(projectRoot, `.diagnostic-${specification.slug}`)
    specification.campId = await createCamp(core.request, {
      name: `${specification.label} Built-in CLI`,
      projectPath: workspace.projectPath,
      memberAgentIds: [specification.agentId, specification.recipientProfileId],
      defaultLeadAgentId: specification.agentId
    })
    await sendCampMessage(core.request, {
      campId: specification.campId,
      body: `${specification.currentMarker}: current-Camp evidence for ${specification.adapterKind}.`,
      execution: null
    })
    specification.scriptPath = join(projectRoot, `verify-${specification.slug}.sh`)
    await writeFile(
      specification.scriptPath,
      verificationScript({
        ...specification,
        historyCampId,
        historyMarker,
        recipientProfileId: specification.recipientProfileId
      }),
      { mode: 0o755 }
    )
    await chmod(specification.scriptPath, 0o755)
    specification.resumeScriptPath = join(projectRoot, `verify-${specification.slug}-resume.sh`)
    await writeFile(
      specification.resumeScriptPath,
      resumeVerificationScript(specification),
      { mode: 0o755 }
    )
    await chmod(specification.resumeScriptPath, 0o755)
  }

  const results = []
  for (const specification of runtimeSpecifications) {
    process.stderr.write(`\n[builtin-cli] ${specification.adapterKind}: full 13-operation Run\n`)
    const source = await startVerificationRun(core, specification, false)
    const sourceSnapshot = await waitForRun(core, specification.campId, source.agentRunId, {
      marker: specification.successMarker,
      timeoutMs: 720_000
    })
    const evidence = await builtinEvidence(
      core.request,
      specification.campId,
      source.agentRunId
    )
    const observedOperations = [...new Set(evidence.map((entry) => entry.payload?.canonicalTool))]
      .filter(Boolean)
      .sort()
    if (JSON.stringify(observedOperations) !== JSON.stringify(expectedOperations)) {
      throw new Error(`${specification.adapterKind} did not commit all canonical operations: ${JSON.stringify({
        observedOperations,
        evidence
      })}`)
    }
    const invalidEnvelopeEvidence = evidence.find((entry) => {
      const envelope = entry.payload?.coreEnvelope
      return envelope?.contractVersion !== 1
        || envelope.operation !== entry.payload?.canonicalTool
        || !/^[0-9a-f-]{36}$/.test(envelope.requestId ?? '')
        || !/^sha256:[0-9a-f]{64}$/.test(envelope.receipt ?? '')
        || (envelope.ok ? typeof envelope.result !== 'object' : typeof envelope.error !== 'object')
    })
    if (invalidEnvelopeEvidence) {
      throw new Error(`${specification.adapterKind} Evidence did not retain a valid Core Envelope: ${JSON.stringify(invalidEnvelopeEvidence)}`)
    }
    const staleConflict = evidence.find((entry) =>
      entry.payload?.canonicalTool === 'team.update_task'
        && entry.payload?.status === 'failed'
        && entry.payload?.errorCode === 'task.version_conflict'
    )
    if (!staleConflict || evidence.some((entry) => entry.payload?.sourceAuthority !== 'core')) {
      throw new Error(`${specification.adapterKind} evidence did not prove the Core Router boundary`)
    }

    const recipientSnapshot = await waitForRecipientRun(
      core,
      specification,
      specification.recipientProfileId
    )
    const firstContextPath = (await readFile(specification.contextPathFile, 'utf8')).trim()
    await assertFencedContext(firstContextPath, specification.adapterKind, 'initial')

    process.stderr.write(`[builtin-cli] ${specification.adapterKind}: resumed/new-lease Run\n`)
    const resumed = await startVerificationRun(core, specification, true)
    const resumedSnapshot = await waitForRun(core, specification.campId, resumed.agentRunId, {
      marker: specification.resumeMarker,
      completionFile: specification.resumeCompletionFile,
      timeoutMs: 480_000
    })
    const resumedEvidence = await builtinEvidence(
      core.request,
      specification.campId,
      resumed.agentRunId
    )
    if (!resumedEvidence.some((entry) =>
      entry.payload?.canonicalTool === 'camp.list'
        && entry.payload?.status === 'completed'
        && entry.payload?.sourceAuthority === 'core'
    )) {
      throw new Error(`${specification.adapterKind} resumed lease did not execute camp.list`)
    }
    const successorExactReads = resumedEvidence.filter((entry) =>
      entry.payload?.canonicalTool === 'camp.read'
        && entry.payload?.status === 'completed'
        && entry.payload?.sourceAuthority === 'core'
    )
    if (successorExactReads.length !== 3) {
      throw new Error(`${specification.adapterKind} successor Run did not verify all three stable Send locators: ${JSON.stringify(resumedEvidence)}`)
    }
    const resumedContextPath = (await readFile(specification.resumeContextPathFile, 'utf8')).trim()
    await assertFencedContext(resumedContextPath, specification.adapterKind, 'resumed')

    const sourceStart = core.events.find((event) =>
      event.method === 'agent_run.started' && event.params?.agentRunId === source.agentRunId
    )
    const resumedStart = core.events.find((event) =>
      event.method === 'agent_run.started' && event.params?.agentRunId === resumed.agentRunId
    )
    if (sourceStart?.params?.adapterKind !== specification.adapterKind
        || resumedStart?.params?.adapterKind !== specification.adapterKind) {
      throw new Error(`${specification.adapterKind} emitted the wrong Adapter identity`)
    }
    const firstRun = sourceSnapshot.agentRuns.find((run) => run.id === source.agentRunId)
    const secondRun = resumedSnapshot.agentRuns.find((run) => run.id === resumed.agentRunId)
    if (!firstRun || !secondRun || firstRun.conversationId !== secondRun.conversationId) {
      throw new Error(`${specification.adapterKind} did not preserve logical Conversation identity`)
    }
    const recipientRun = recipientSnapshot.agentRuns.find((run) =>
      run.agentId === specification.recipientProfileId
    )
    const sourceNativeSessionId = nativeSessionIdForRun(
      core.events,
      source.agentRunId,
      sourceStart
    )
    const resumedNativeSessionId = nativeSessionIdForRun(
      core.events,
      resumed.agentRunId,
      resumedStart
    )

    results.push({
      adapterKind: specification.adapterKind,
      reportedVersion: specification.installation.snapshot.reportedVersion,
      selectedModel: sourceStart.params.modelId,
      sourceAgentRunId: source.agentRunId,
      resumedAgentRunId: resumed.agentRunId,
      recipientAgentRunId: recipientRun?.id,
      recipientRunStatusAtObservation: recipientRun?.status,
      operations: observedOperations,
      fullRunEvidenceCount: evidence.length,
      agentOutputReduction: measureAgentOutputReduction(evidence),
      legacySendFlagRejected: true,
      legacySendJsonRejected: true,
      sendInputSources: ['direct_flags', 'stdin', 'input_file'],
      exactAddressingVerifiedInSuccessorRun: true,
      successorExactReadCount: successorExactReads.length,
      staleVersionConflict: true,
      initialLeaseFenced: true,
      resumedLeaseFenced: true,
      logicalConversationContinued: true,
      nativeSessionContinued: Boolean(
        sourceNativeSessionId
          && sourceNativeSessionId === resumedNativeSessionId
      )
    })
  }

  console.log(JSON.stringify({
    ok: true,
    contractVersion: 7,
    ipcProtocolVersion: 1,
    runtimeCount: results.length,
    operationCountPerRuntime: expectedOperations.length,
    expectedOperations,
    results,
    fixtureRetained: keepFixture ? fixtureRoot : null
  }, null, 2))
} catch (error) {
  keepFixture = true
  process.stderr.write(`\n[builtin-cli] FAILED; fixture retained at ${fixtureRoot}\n`)
  throw error
} finally {
  if (core) await core.stop()
  if (!keepFixture) await rm(fixtureRoot, { recursive: true, force: true })
}

function nativeSessionIdForRun(events, agentRunId, startedEvent) {
  const bound = events.find((event) =>
    event.method === 'agent_run.native_session_bound'
      && event.params?.agentRunId === agentRunId
  )
  return bound?.params?.nativeThreadId ?? startedEvent?.params?.nativeThreadId ?? null
}

function assertBuiltinCliCapability(label, installation) {
  const snapshot = installation?.snapshot
  if (snapshot?.probeStatus !== 'ready'
      || !snapshot.capabilities.includes('builtin_cli.transport.v7')
      || !snapshot.models.length) {
    throw new Error(`${label} is not ready for Built-in CLI v7: ${JSON.stringify(snapshot)}`)
  }
}

async function createProfile(request, displayName) {
  const result = await request('members.create', {
    commandId: crypto.randomUUID(),
    command: {
      displayName,
      teamRole: 'Runtime verifier',
      professionalResponsibilities: 'Execute the fixed local Built-in CLI qualification script.',
      personalityTraits: ['Precise', 'Direct'],
      workingPrinciples: 'Run only the explicit qualification command and report its marker.',
      growthTopic: ''
    }
  })
  const id = result.resultEntity?.entityId
  if (result.status !== 'applied' || !id) {
    throw new Error(`AgentProfile creation failed: ${JSON.stringify(result)}`)
  }
  return id
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
        options: { reasoning_effort: 'low' }
      },
      permissions: profile.runtimeConfiguration.permissions
    }
  })
  if (result.status !== 'applied') {
    throw new Error(`Explicit Runtime model was not selected: ${JSON.stringify(result)}`)
  }
  const resolved = await request('members.get', { agentId })
  if (resolved.runtimeReadiness?.status !== 'ready') {
    throw new Error(`Explicit Runtime model is not ready: ${JSON.stringify(resolved)}`)
  }
}

async function createCamp(request, input) {
  const result = await request('camps.create', {
    commandId: crypto.randomUUID(),
    name: input.name,
    workspace: { projectPath: input.projectPath },
    memberAgentIds: input.memberAgentIds,
    defaultLeadAgentId: input.defaultLeadAgentId,
    collaborationMode: 'peer'
  })
  const campId = result.payload?.campId
  if (result.status !== 'applied' || !campId) {
    throw new Error(`Camp creation failed: ${JSON.stringify(result)}`)
  }
  return campId
}

async function sendCampMessage(request, input) {
  const draft = await request('camp.composerDraft.get', { campId: input.campId })
  const content = input.agentId
    ? [
        { kind: 'member_mention', agentId: input.agentId },
        { kind: 'text', text: ` ${input.body}` }
      ]
    : [{ kind: 'text', text: input.body }]
  const saved = await request('camp.composerDraft.save', {
    campId: input.campId,
    expectedRevision: draft.revision,
    content
  })
  return request('camp.messages.send', {
    commandId: crypto.randomUUID(),
    campId: input.campId,
    draftRevision: saved.revision,
    replyToCampMessageId: null,
    execution: input.execution
  })
}

async function startVerificationRun(coreClient, specification, resumed) {
  const marker = resumed ? specification.resumeMarker : specification.successMarker
  const scriptPath = resumed ? specification.resumeScriptPath : specification.scriptPath
  const sent = await sendCampMessage(coreClient.request, {
    campId: specification.campId,
    agentId: specification.agentId,
    body: [
      'Run the local repository Built-in CLI transport qualification.',
      'The script was generated by this test and the Runtime process already has ROVAI_AGENT_CLI, ROVAI_CLI_CONTEXT, and ROVAI_RUN_TMP injected.',
      'You may inspect the script if your Runtime requires that before execution; do not modify or replace it.',
      'Use your native bash/shell tool to run:',
      `/bin/bash ${JSON.stringify(scriptPath)}`,
      `If it exits 0 and prints ${marker}, reply with exactly ${marker}.`
    ].join('\n'),
    execution: {
      taskId: null,
      purpose: resumed
        ? `Verify ${specification.adapterKind} resume/process reuse receives a new active CLI lease.`
        : `Verify ${specification.adapterKind} executes all 13 CLI-only built-in operations.`,
      completionRole: 'required'
    }
  })
  const commandResult = sent.commandResult ?? sent
  const agentRunId = commandResult.payload?.agentRunIds?.[0]
  if (commandResult.status !== 'accepted' || !agentRunId) {
    throw new Error(`${specification.adapterKind} AgentRun intake failed: ${JSON.stringify(sent)}`)
  }
  return { agentRunId }
}

async function waitForRun(coreClient, campId, agentRunId, options) {
  const deadline = Date.now() + options.timeoutMs
  const resolvedApprovals = new Set()
  while (Date.now() < deadline) {
    const snapshot = await coreClient.request('camps.snapshot', { campId })
    await resolvePendingApprovals(coreClient.request, snapshot, agentRunId, resolvedApprovals)
    const run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    if (run?.status === 'succeeded') {
      const output = snapshot.messages.find((message) =>
        message.sourceAgentRunId === agentRunId
      )?.body
      if (!output?.trim()) {
        if (options.completionFile) {
          const completion = await readFile(options.completionFile, 'utf8').catch(() => '')
          if (completion.includes(options.marker)) return snapshot
        }
        throw new Error(`AgentRun ${agentRunId} succeeded without output`)
      }
      return snapshot
    }
    if (run && ['failed', 'cancelled'].includes(run.status)) {
      throw new Error(`AgentRun ${agentRunId} entered ${run.status}: ${JSON.stringify({
        run,
        actions: snapshot.actions.filter((action) => action.agentRunId === agentRunId),
        timeline: snapshot.timeline.slice(-30)
      })}`)
    }
    await delay(400)
  }
  throw new Error(`Timed out waiting for AgentRun ${agentRunId}`)
}

async function waitForRecipientRun(coreClient, specification, recipientProfileId) {
  const deadline = Date.now() + 480_000
  const resolvedApprovals = new Set()
  while (Date.now() < deadline) {
    const snapshot = await coreClient.request('camps.snapshot', { campId: specification.campId })
    const candidates = snapshot.agentRuns.filter((run) => run.agentId === recipientProfileId)
    for (const candidate of candidates) {
      await resolvePendingApprovals(coreClient.request, snapshot, candidate.id, resolvedApprovals)
    }
    const run = candidates.at(-1)
    if (run) {
      return snapshot
    }
    await delay(400)
  }
  throw new Error(`${specification.adapterKind} recipient Run did not complete`)
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
    const option = approval.options.find((candidate) => candidate.kind === 'allow_session')
      ?? approval.options.find((candidate) => candidate.kind === 'allow_once')
    if (!option) throw new Error(`No bounded allow option for ${approval.id}`)
    const result = await request('action.approvals.resolve', {
      commandId: crypto.randomUUID(),
      campId: snapshot.camp.id,
      approvalId: approval.id,
      expectedVersion: approval.version,
      optionId: option.optionId,
      reason: 'Local Built-in CLI Runtime qualification'
    })
    if (result.status === 'rejected') {
      throw new Error(`Approval ${approval.id} was rejected: ${JSON.stringify(result)}`)
    }
    resolvedApprovals.add(approval.id)
  }
}

async function builtinEvidence(request, campId, agentRunId) {
  const collected = []
  let afterSequence = 0
  let throughSequence = null
  while (true) {
    const page = await request('agentRunEvidence.list', {
      campId,
      agentRunId,
      afterSequence,
      limit: 1_000
    })
    throughSequence ??= page.throughSequence
    if (page.throughSequence !== throughSequence
        || page.nextAfterSequence < afterSequence
        || (page.hasMore && page.nextAfterSequence === afterSequence)) {
      throw new Error(`Evidence pagination contract failed for ${agentRunId}`)
    }
    collected.push(...page.evidence)
    if (!page.hasMore) break
    afterSequence = page.nextAfterSequence
  }
  return collected.filter((entry) => entry.payload?.kind === 'builtin_tool_invocation')
}

function measureAgentOutputReduction(evidence) {
  const samples = evidence
    .map((entry) => entry.payload?.coreEnvelope)
    .filter(Boolean)
    .map((envelope) => ({
      envelope,
      projection: projectEnvelopeForMeasurement(envelope)
    }))
  const envelopeBytes = samples.reduce(
    (total, sample) => total + Buffer.byteLength(JSON.stringify(sample.envelope)),
    0
  )
  const projectionBytes = samples.reduce(
    (total, sample) => total + Buffer.byteLength(JSON.stringify(sample.projection)),
    0
  )
  return {
    sampleCount: samples.length,
    envelopeBytes,
    projectionBytes,
    reductionPercent: envelopeBytes === 0
      ? 0
      : Number((((envelopeBytes - projectionBytes) / envelopeBytes) * 100).toFixed(1))
  }
}

function projectEnvelopeForMeasurement(envelope) {
  if (!envelope.ok) {
    if (envelope.error?.code === 'builtin_tool.outcome_indeterminate') {
      return {
        error: {
          code: 'builtin_tool.outcome_indeterminate',
          message: 'Confirm current state before acting again.',
          recovery: 'confirm_outcome'
        }
      }
    }
    return { error: envelope.error }
  }
  switch (envelope.operation) {
    case 'camp.message.send':
      return {
        messageId: envelope.result.messageId,
        effectiveRecipients: envelope.result.effectiveRecipients
      }
    case 'memory.write':
      return {
        memoryId: envelope.result.memoryId,
        revisionId: envelope.result.revisionId
      }
    case 'team.create_task':
      return selectFields(envelope.result, ['taskId', 'title', 'status', 'assigneeAgentId', 'version', 'availableActions'])
    case 'team.update_task':
      return selectFields(envelope.result, ['taskId', 'title', 'status', 'assigneeAgentId', 'version', 'availableActions', 'changed'])
    case 'camp.list':
    case 'camp.read':
    case 'camp.search':
    case 'history.search':
    case 'memory.propose_hearth':
    case 'memory.read':
    case 'memory.search':
    case 'team.get_task':
    case 'team.list_tasks':
      return envelope.result
    default:
      throw new Error(`Missing Agent output measurement projection for ${envelope.operation}`)
  }
}

function selectFields(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]))
}

async function assertFencedContext(contextPath, adapterKind, phase) {
  if (!contextPath.startsWith(dataDir)) {
    throw new Error(`${adapterKind} exposed an unexpected CLI context path: ${contextPath}`)
  }
  let lastResult = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await runCapture(cliExecutable, ['camp', 'list'], {
      env: { ...process.env, ROVAI_CLI_CONTEXT: contextPath },
      expectedCodes: [0, 2]
    })
    lastResult = result
    if (result.code === 2
        && result.stderr === ''
        && result.stdout.includes('"builtin_tool.cli_error"')) return
    await delay(250)
  }
  throw new Error(`${adapterKind} ${phase} context did not fail closed: ${JSON.stringify(lastResult)}`)
}

function expectedExitCode(options) {
  return options.expectedCode ?? 0
}

function exitCodeAccepted(options, code) {
  return options.expectedCodes?.includes(code) ?? (code === expectedExitCode(options))
}

function verificationScript(input) {
  const taskCreate = JSON.stringify({
    title: `CLI transport task ${input.adapterKind}`,
    description: 'Created through the canonical operation result contract.',
    assigneeAgentId: input.agentId
  })
  const campRead = (messageIdExpression) =>
    `jq -n --arg campId ${shellQuote(input.campId)} --arg messageId "${messageIdExpression}" '{mode:"item",campId:$campId,messageId:$messageId}'`
  const memoryWrite = JSON.stringify({
    action: 'add',
    scope: 'companion',
    kind: 'preference',
    body: `Remember that ${input.adapterKind} completed Built-in CLI transport v7 qualification.`,
    retrievalKeys: [`cli-${input.slug.slice(0, 18)}`]
  })
  const hearth = JSON.stringify({
    action: 'add',
    kind: 'lesson',
    body: `The ${input.adapterKind} Runtime can invoke Rovai built-ins only through the local CLI.`,
    retrievalKeys: [`hearth-${input.slug.slice(0, 14)}`]
  })
  const publicSend = JSON.stringify({
    body: `Acknowledge the ${input.adapterKind} Built-in CLI qualification in one sentence.`,
    to: [input.recipientProfileId],
    mentionUser: true
  })
  return `#!/bin/bash
set -euo pipefail

CLI="\${ROVAI_AGENT_CLI:?ROVAI_AGENT_CLI is required}"
CONTEXT="\${ROVAI_CLI_CONTEXT:?ROVAI_CLI_CONTEXT is required}"
RUN_TMP="\${ROVAI_RUN_TMP:?ROVAI_RUN_TMP is required}"
JQ="$(command -v jq)"
DIAGNOSTIC=${shellQuote(input.diagnosticPath)}
STEP=bootstrap
exec 2>"$DIAGNOSTIC.stderr"
trap 'code=$?; printf "exit=%s step=%s line=%s\n" "$code" "$STEP" "$LINENO" > "$DIAGNOSTIC"; exit "$code"' EXIT
test -x "$CLI"
test -f "$CONTEXT"
test -d "$RUN_TMP"
test "$(stat -f '%Lp' "$CONTEXT")" = "600"
printf '%s\n' "$CONTEXT" > ${shellQuote(input.contextPathFile)}

assert_success() {
  local document="$1"
  local operation="$2"
  printf '%s\n' "$document" | "$JQ" -e --arg operation "$operation" '
    (has("contractVersion") | not)
    and (has("ok") | not)
    and (has("operation") | not)
    and (has("requestId") | not)
    and (has("receipt") | not)
    and (has("result") | not)
    and (has("error") | not)
    and (if $operation == "camp.message.send"
         then (.messageId | type) == "string" and (.effectiveRecipients | type) == "array"
         elif $operation == "memory.write"
         then (.memoryId | type) == "string" and (.revisionId | type) == "string"
         else type == "object"
         end)
  ' >/dev/null
}

assert_fix_input() {
  local document="$1"
  printf '%s\n' "$document" | "$JQ" -e '
    .error.code == "builtin_tool.invalid_input"
    and .error.recovery == "fix_input"
    and (has("contractVersion") | not)
    and (has("operation") | not)
    and (has("requestId") | not)
    and (has("receipt") | not)
    and (has("result") | not)
  ' >/dev/null
}

STEP=version
"$CLI" --version | grep -q 'contract-v7 ipc-v1'

STEP=exact_help
root_help="$("$CLI" --help)"
printf '%s\n' "$root_help" | grep -Fq ${shellQuote("Run `rovai --help` to choose an operation, then run that operation's exact `--help`. Do not assume that a command family has its own help entry.")}
send_help="$("$CLI" send --help)"
printf '%s\n' "$send_help" | grep -Fq -- '--to-user'
set +e
family_help="$("$CLI" camp --help 2>"$RUN_TMP/family-help.err")"
family_help_status=$?
set -e
test "$family_help_status" -eq 2
test ! -s "$RUN_TMP/family-help.err"
assert_fix_input "$family_help"

STEP=legacy_send_flag
set +e
legacy_flag="$("$CLI" send --camp-id camp-legacy --body rejected 2>"$RUN_TMP/legacy-flag.err")"
legacy_flag_status=$?
set -e
test "$legacy_flag_status" -eq 2
test ! -s "$RUN_TMP/legacy-flag.err"
assert_fix_input "$legacy_flag"

STEP=legacy_send_json
set +e
legacy_json="$(printf '%s\n' '{"campId":"camp-legacy","body":"rejected"}' | "$CLI" send 2>"$RUN_TMP/legacy-json.err")"
legacy_json_status=$?
set -e
test "$legacy_json_status" -eq 1
test ! -s "$RUN_TMP/legacy-json.err"
assert_fix_input "$legacy_json"

cat > "$RUN_TMP/task-create.json" <<'ROVAI_JSON'
${taskCreate}
ROVAI_JSON
STEP=task_create
task_create="$("$CLI" task create --input-file "$RUN_TMP/task-create.json")"
assert_success "$task_create" 'team.create_task'
task_id="$(printf '%s\n' "$task_create" | "$JQ" -er '.taskId')"
task_version="$(printf '%s\n' "$task_create" | "$JQ" -er '.version')"

STEP=task_get
task_get="$("$CLI" task get --task-id "$task_id")"
assert_success "$task_get" 'team.get_task'
printf '%s\n' "$task_get" | "$JQ" -e --arg taskId "$task_id" '.taskId == $taskId and .description != null' >/dev/null

STEP=task_list
task_list="$("$CLI" task list <<'ROVAI_JSON'
{"statuses":["pending"],"limit":10}
ROVAI_JSON
)"
assert_success "$task_list" 'team.list_tasks'
printf '%s\n' "$task_list" | "$JQ" -e --arg taskId "$task_id" '.tasks | any(.taskId == $taskId)' >/dev/null

STEP=task_update
task_update="$("$CLI" task update --task-id "$task_id" --expected-version "$task_version" --status in_progress)"
assert_success "$task_update" 'team.update_task'
current_version="$(printf '%s\n' "$task_update" | "$JQ" -er '.version')"

STEP=task_conflict
set +e
stale_update="$("$CLI" task update --task-id "$task_id" --expected-version "$task_version" --title stale-overwrite 2>"$RUN_TMP/stale.err")"
stale_status=$?
set -e
test "$stale_status" -eq 1
printf '%s\n' "$stale_update" | "$JQ" -e --arg taskId "$task_id" --argjson currentVersion "$current_version" '
  .error.code == "task.version_conflict"
  and .error.recovery == "refresh_then_decide"
  and .error.details.taskId == $taskId
  and .error.details.currentVersion == $currentVersion
  and (has("contractVersion") | not)
  and (has("requestId") | not)
  and (has("receipt") | not)
' >/dev/null

STEP=camp_list
camp_list="$(printf '{}\n' | "$CLI" camp list)"
assert_success "$camp_list" 'camp.list'
printf '%s\n' "$camp_list" | "$JQ" -e --arg campId ${shellQuote(input.historyCampId)} '.camps | any(.campId == $campId)' >/dev/null

STEP=camp_search
camp_search="$("$CLI" camp search --query ${shellQuote(input.currentMarker)} --limit 5)"
assert_success "$camp_search" 'camp.search'
message_id="$(printf '%s\n' "$camp_search" | "$JQ" -er '.results[0].messageId')"
STEP=camp_read
${campRead('$message_id')} > "$RUN_TMP/camp-read.json"
camp_read="$("$CLI" camp read --input-file "$RUN_TMP/camp-read.json")"
assert_success "$camp_read" 'camp.read'
printf '%s\n' "$camp_read" | "$JQ" -e --arg messageId "$message_id" '.items[0].messageId == $messageId' >/dev/null

STEP=history_search
history_search="$("$CLI" history search --query ${shellQuote(input.historyMarker)} --limit 5)"
assert_success "$history_search" 'history.search'
printf '%s\n' "$history_search" | "$JQ" -e --arg campId ${shellQuote(input.historyCampId)} '.results | any(.campId == $campId)' >/dev/null

cat > "$RUN_TMP/public-send.json" <<'ROVAI_JSON'
${publicSend}
ROVAI_JSON
STEP=camp_message_send
public_send="$("$CLI" send --input-file "$RUN_TMP/public-send.json")"
assert_success "$public_send" 'camp.message.send'
printf '%s\n' "$public_send" | "$JQ" -e '
  (keys | sort) == ["effectiveRecipients", "messageId"]
  and (.effectiveRecipients | type) == "array"
' >/dev/null
public_message_id="$(printf '%s\n' "$public_send" | "$JQ" -er '.messageId')"

STEP=camp_message_send_direct_user_only
user_only="$("$CLI" send --to-user --body ${shellQuote(`Direct user-only ${input.adapterKind}`)})"
assert_success "$user_only" 'camp.message.send'
printf '%s\n' "$user_only" | "$JQ" -e '
  (keys | sort) == ["effectiveRecipients", "messageId"]
  and .effectiveRecipients == []
' >/dev/null
user_only_id="$(printf '%s\n' "$user_only" | "$JQ" -er '.messageId')"

STEP=camp_message_send_stdin_user_only
stdin_user_only="$(printf '%s\n' ${shellQuote(JSON.stringify({ body: `Stdin user-only ${input.adapterKind}`, mentionUser: true }))} | "$CLI" send)"
assert_success "$stdin_user_only" 'camp.message.send'
stdin_user_only_id="$(printf '%s\n' "$stdin_user_only" | "$JQ" -er '.messageId')"

STEP=freeze_send_locators
"$JQ" -n \
  --arg publicMessageId "$public_message_id" \
  --arg directUserOnlyMessageId "$user_only_id" \
  --arg stdinUserOnlyMessageId "$stdin_user_only_id" \
  '{publicMessageId:$publicMessageId,directUserOnlyMessageId:$directUserOnlyMessageId,stdinUserOnlyMessageId:$stdinUserOnlyMessageId}' \
  > ${shellQuote(input.sendEvidencePath)}

cat > "$RUN_TMP/memory-write.json" <<'ROVAI_JSON'
${memoryWrite}
ROVAI_JSON
STEP=memory_write
memory_write="$("$CLI" memory write --input-file "$RUN_TMP/memory-write.json")"
assert_success "$memory_write" 'memory.write'
memory_id="$(printf '%s\n' "$memory_write" | "$JQ" -er '.memoryId')"

STEP=memory_search
memory_search="$("$CLI" memory search --query ${shellQuote(`cli-${input.slug.slice(0, 18)}`)} --limit 6)"
assert_success "$memory_search" 'memory.search'
printf '%s\n' "$memory_search" | "$JQ" -e --arg memoryId "$memory_id" '.results | any(.memoryId == $memoryId)' >/dev/null

STEP=memory_read
memory_read_input="$("$JQ" -nc --arg memoryId "$memory_id" '{memoryIds:[$memoryId]}')"
memory_read="$(printf '%s\n' "$memory_read_input" | "$CLI" memory read)"
assert_success "$memory_read" 'memory.read'
printf '%s\n' "$memory_read" | "$JQ" -e --arg memoryId "$memory_id" '.memories | any(.memoryId == $memoryId and .cacheState == "current")' >/dev/null

cat > "$RUN_TMP/hearth.json" <<'ROVAI_JSON'
${hearth}
ROVAI_JSON
STEP=memory_propose_hearth
hearth_result="$("$CLI" memory propose-hearth --input-file "$RUN_TMP/hearth.json")"
assert_success "$hearth_result" 'memory.propose_hearth'
printf '%s\n' "$hearth_result" | "$JQ" -e '.status == "pending" and .effective == false' >/dev/null

STEP=complete
trap - EXIT
printf '%s\n' ${shellQuote(JSON.stringify({
    ok: true,
    marker: input.successMarker,
    operationCount: 13,
    versionConflict: 'refresh_then_decide'
  }))}
`
}

function resumeVerificationScript(input) {
  return `#!/bin/bash
set -euo pipefail
CLI="\${ROVAI_AGENT_CLI:?ROVAI_AGENT_CLI is required}"
CONTEXT="\${ROVAI_CLI_CONTEXT:?ROVAI_CLI_CONTEXT is required}"
JQ="$(command -v jq)"
SEND_EVIDENCE=${shellQuote(input.sendEvidencePath)}
printf '%s\n' "$CONTEXT" > ${shellQuote(input.resumeContextPathFile)}
camp_list="$(printf '{}\n' | "$CLI" camp list)"
printf '%s\n' "$camp_list" | jq -e '((has("contractVersion") | not) and (.camps | type) == "array")' >/dev/null

read_item() {
  local message_id="$1"
  "$JQ" -n --arg campId ${shellQuote(input.campId)} --arg messageId "$message_id" \
    '{mode:"item",campId:$campId,messageId:$messageId}' | "$CLI" camp read
}

public_message_id="$("$JQ" -er '.publicMessageId' "$SEND_EVIDENCE")"
public_read="$(read_item "$public_message_id")"
printf '%s\n' "$public_read" | "$JQ" -e \
  --arg messageId "$public_message_id" \
  --arg recipient ${shellQuote(input.recipientProfileId)} '
    .items[0].messageId == $messageId
    and .items[0].addressing.effectiveAgentRecipients == [$recipient]
    and .items[0].addressing.mentionsCurrentUser == true
  ' >/dev/null

for key in directUserOnlyMessageId stdinUserOnlyMessageId; do
  message_id="$("$JQ" -er --arg key "$key" '.[$key]' "$SEND_EVIDENCE")"
  item="$(read_item "$message_id")"
  printf '%s\n' "$item" | "$JQ" -e --arg messageId "$message_id" '
    .items[0].messageId == $messageId
    and .items[0].addressing.effectiveAgentRecipients == []
    and .items[0].addressing.mentionsCurrentUser == true
  ' >/dev/null
done

printf '%s\n' ${shellQuote(input.resumeMarker)} > ${shellQuote(input.resumeCompletionFile)}
printf '%s\n' ${shellQuote(JSON.stringify({ ok: true, marker: input.resumeMarker, newLease: true }))}
`
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function startCore(dataDirectory) {
  const child = spawn(coreExecutable, ['--data-dir', dataDirectory], {
    cwd: root,
    env: {
      ...process.env,
      ROVAI_SKILL_LIBRARY_ROOT: skillLibraryRoot
    },
    stdio: ['pipe', 'pipe', 'pipe']
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
      if (exitCodeAccepted(options, code)) resolveRun(result)
      else rejectRun(new Error(`${command} exited ${code}: ${JSON.stringify(result)}`))
    })
  })
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
