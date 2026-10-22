import { chmod, mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import {
  coreDataDirectoryArguments,
  removeEphemeralRuntimeCampFilesRoot
} from './lib/runtime-camp-files-root.mjs'
import { prepareIsolatedPiAgentDir } from './lib/pi-smoke-config.mjs'

const root = resolve(import.meta.dirname, '..')
const builtinTransportSource = await readFile(
  join(root, 'crates', 'rovai-core', 'src', 'builtin_tool_transport.rs'),
  'utf8'
)
const builtinCliContractVersion = builtinTransportSource.match(
  /BUILTIN_TOOL_CONTRACT_VERSION: u32 = (\d+);/u
)?.[1]
const builtinCliIpcVersion = builtinTransportSource.match(
  /BUILTIN_TOOL_IPC_PROTOCOL_VERSION: u32 = (\d+);/u
)?.[1]
const builtinCliCapability = builtinTransportSource.match(
  /BUILTIN_TOOL_RUNTIME_CAPABILITY: &str = "([^"]+)";/u
)?.[1]
if (!builtinCliContractVersion || !builtinCliIpcVersion || !builtinCliCapability) {
  throw new Error('Current Built-in CLI transport constants were not found')
}
const coreExecutable = resolve(
  process.env.ROVAI_BUILTIN_CLI_CORE_EXECUTABLE ?? join(root, 'target', 'debug', process.platform === 'win32' ? 'rovai-core.exe' : 'rovai-core')
)
const cliExecutable = resolve(
  process.env.ROVAI_BUILTIN_CLI_EXECUTABLE ?? join(root, 'target', 'debug', process.platform === 'win32' ? 'rovai.exe' : 'rovai')
)
const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'rovai-builtin-cli-smoke-')))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = process.platform === 'win32'
  ? JSON.parse(execFileSync(coreExecutable, ['--prepare-windows-data-root', join(fixtureRoot, 'formal')], { encoding: 'utf8', windowsHide: true })).core
  : join(fixtureRoot, 'data')
const skillLibraryRoot = join(dataDir, 'managed-skill-library')
const bashExecutable = process.platform === 'win32'
  ? (process.env.ROVAI_BASH_BIN ?? 'C:\\Program Files\\Git\\bin\\bash.exe')
  : '/bin/bash'
const historyMarker = 'ROVAI_BUILTIN_HISTORY_V1'
const historyPublicA2aMarker = 'ROVAI_BUILTIN_HISTORY_PUBLIC_A2A_V1'
const historyAttachmentMarker = 'ROVAI_BUILTIN_HISTORY_ATTACHMENT_V1'
const historySeedCompletionMarker = 'ROVAI_BUILTIN_HISTORY_SEED_OK'
// Current public operation catalog, including member updates and Mission scope.
const expectedOperations = [
  'automation.close',
  'automation.create',
  'automation.delete',
  'automation.get',
  'automation.list',
  'automation.run',
  'automation.update',
  'thread.list',
  'thread.message.send',
  'thread.read',
  'thread.search',
  'thread.runs',
  'history.search',
  'member.create',
  'member.list',
  'member.get',
  'member.update',
  'mission.list',
  'mission.get',
  'mission.update',
  'mission.status',
  'memory.read',
  'memory.search',
  'memory.view',
  'memory.write',
  'team.create_task',
  'team.get_task',
  'team.list_tasks',
  'team.update_task'
].sort()
const allRuntimeSpecifications = [
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
  ['minimax-code-cli', 'MiniMax Code'],
  ['grok-build', 'Grok Build'],
  ['deepseek-harness', 'DeepSeek Harness'],
  ['zcode-app', 'ZCode']
].map(([adapterKind, label]) => ({ adapterKind, label, slug: adapterKind.replaceAll('-', '_') }))
// MiniMax is Preview: available for explicit qualification, outside the default matrix.
const defaultRuntimeSpecifications = allRuntimeSpecifications.filter((value) => value.adapterKind !== 'minimax-code-cli')
const selectedAdapters = new Set((process.env.ROVAI_BUILTIN_CLI_ADAPTERS
  ?? defaultRuntimeSpecifications.map((value) => value.adapterKind).join(','))
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
let piAgentDir = null

try {
  if (selectedAdapters.has('pi')) {
    piAgentDir = await prepareIsolatedPiAgentDir(fixtureRoot)
  }
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Built-in CLI Runtime Qualification\n')
  await runCapture('git', ['init', '-b', 'main'], { cwd: projectRoot, expectedCode: 0 })
  await runCapture('git', ['config', 'user.name', 'Rovai Built-in CLI Smoke'], { cwd: projectRoot, expectedCode: 0 })
  await runCapture('git', ['config', 'user.email', 'builtin-cli@rovai.local'], { cwd: projectRoot, expectedCode: 0 })
  await runCapture('git', ['add', 'README.md'], { cwd: projectRoot, expectedCode: 0 })
  await runCapture('git', ['commit', '-m', 'fixture'], { cwd: projectRoot, expectedCode: 0 })

  core = startCore(dataDir)
  await core.request('health.check')
  await core.request('preferences.tasks.set', { enabled: true })
  if (selectedAdapters.has('minimax-code-cli') && process.env.ROVAI_MINIMAX_CODE_BIN) {
    const startup = await core.request('runtime.startup.get', { runtimeKind: 'minimax-code-cli' })
    await core.request('runtime.startup.save', { runtimeKind: 'minimax-code-cli', expectedRevision: startup.revision,
      configuration: { programPath: process.env.ROVAI_MINIMAX_CODE_BIN, environment: [] } })
    await core.request('runtime.modelCatalog.open', { runtimeKind: 'minimax-code-cli', waitForRefresh: true })
  }
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
    const explicitModel = specification.adapterKind === 'codex-cli'
      ? process.env.ROVAI_BUILTIN_CLI_CODEX_MODEL?.trim()
      : specification.adapterKind === 'opencode-cli'
        ? process.env.ROVAI_BUILTIN_CLI_OPENCODE_MODEL?.trim()
      : specification.adapterKind === 'codebuddy-cli'
        ? process.env.ROVAI_BUILTIN_CLI_CODEBUDDY_MODEL?.trim()
      : specification.adapterKind === 'minimax-code-cli'
        ? process.env.ROVAI_BUILTIN_CLI_MINIMAX_MODEL?.trim()
        : null
    if (explicitModel) {
      for (const agentId of [
        specification.agentId,
        specification.recipientProfileId
      ]) {
        await selectExplicitModel(
          core.request,
          agentId,
          specification.adapterKind,
          explicitModel
        )
      }
    }
    assertBuiltinCliCapability(specification.adapterKind, specification.installation, true)
  }

  const historyCampId = await createThread(core.request, {
    name: 'Built-in CLI Shared History',
    projectPath: workspace.projectPath,
    memberAgentIds: runtimeSpecifications.flatMap((value) => [
      value.agentId,
      value.recipientProfileId
    ]),
    defaultLeadAgentId: runtimeSpecifications[0].agentId
  })
  await sendThreadMessage(core.request, {
    threadId: historyCampId,
    body: `${historyMarker}: shared historical evidence for all ${runtimeSpecifications.length} Runtime qualifications.`,
    execution: null
  })

  const historySeedSpecification = runtimeSpecifications[0]
  const historySeedScriptPath = join(projectRoot, 'seed-historical-public-a2a.sh')
  const historySeedEvidencePath = join(projectRoot, '.historical-public-a2a-message-id')
  await writeFile(
    historySeedScriptPath,
    historyPublicationScript({
      recipientProfileId: historySeedSpecification.recipientProfileId,
      marker: historyPublicA2aMarker,
      completionMarker: historySeedCompletionMarker,
      evidencePath: historySeedEvidencePath
    }),
    { mode: 0o755 }
  )
  await chmod(historySeedScriptPath, 0o755)
  const historicalPublicA2a = await seedHistoricalPublicA2a(core, {
    specification: historySeedSpecification,
    threadId: historyCampId,
    scriptPath: historySeedScriptPath,
    evidencePath: historySeedEvidencePath,
    marker: historyPublicA2aMarker,
    completionMarker: historySeedCompletionMarker
  })
  await waitForHistoricalDeliveryTerminal(
    core,
    historyCampId,
    historicalPublicA2a.deliveryId
  )

  const historyAttachmentSourcePath = join(projectRoot, 'historical-attachment.txt')
  await writeFile(
    historyAttachmentSourcePath,
    `${historyAttachmentMarker}: attachment content stays outside Agent output.\n`,
    { mode: 0o600 }
  )
  const historicalAttachment = await createHistoricalAttachmentMessage(core.request, {
    threadId: historyCampId,
    sourcePath: historyAttachmentSourcePath,
    marker: historyAttachmentMarker
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
    specification.memberCreationKey = crypto.randomUUID()
    specification.memberDisplayName = `${specification.label} Created Member`
    const mission = await core.request('missions.create', { commandId: crypto.randomUUID(), command: {
      title: `${specification.label} Built-in CLI`,
      description: 'Isolated qualification of the complete public CLI operation catalog.',
      projectPath: workspace.projectPath,
      projectBindingKind: 'directory',
      memberAgentIds: [specification.agentId, specification.recipientProfileId],
      defaultLeadAgentId: specification.agentId,
      tags: ['qualification']
    } })
    if (mission.status !== 'applied') throw new Error(`Mission fixture creation failed: ${JSON.stringify(mission)}`)
    specification.threadId = mission.payload.threadId
    specification.missionId = mission.payload.missionId
    await sendThreadMessage(core.request, {
      threadId: specification.threadId,
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
        historyPublicA2aMarker,
        historyPublicA2aMessageId: historicalPublicA2a.messageId,
        historyAttachmentMarker,
        historyAttachmentMessageId: historicalAttachment.messageId,
        historyAttachmentId: historicalAttachment.attachmentId,
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
    process.stderr.write(`\n[builtin-cli] ${specification.adapterKind}: ${expectedOperations.length}-operation catalog\n`)
    const source = await startVerificationRun(core, specification, false)
    const sourceSnapshot = await waitForRun(core, specification.threadId, source.agentRunId, {
      marker: specification.successMarker,
      timeoutMs: 720_000
    })
    const scriptDiagnostic = (await readFile(specification.diagnosticPath, 'utf8')).trim()
    if (scriptDiagnostic !== 'exit=0 step=complete') {
      throw new Error(`${specification.adapterKind} verification script failed: ${scriptDiagnostic}`)
    }
    const sourceManifest = sourceSnapshot.contextManifests.find((manifest) =>
      manifest.agentRunId === source.agentRunId
    )
    if (specification.threadId === historyCampId
        || !sourceManifest
        || sourceManifest.historyFenceVersion !== 1
        || !Number.isSafeInteger(sourceManifest.globalPublicMessageBoundary)
        || sourceManifest.globalPublicMessageBoundary < historicalPublicA2a.publicationSequence) {
      throw new Error(`${specification.adapterKind} did not capture the publication fence for live historical queries: ${JSON.stringify({
        queryingCampId: specification.threadId,
        historyCampId,
        sourceManifest
      })}`)
    }
    specification.installation = (await core.request('runtime.installations.list')).find((candidate) =>
      candidate.adapterKind === specification.adapterKind
        && candidate.installationClass === 'managed_default'
        && candidate.authScope === 'default'
    )
    assertBuiltinCliCapability(specification.adapterKind, specification.installation)
    const evidence = await builtinEvidence(
      core.request,
      specification.threadId,
      source.agentRunId
    )
    const terminalEvidence = evidence.filter((entry) =>
      entry.payload?.status === 'completed' || entry.payload?.status === 'failed'
    )
    const observedOperations = [...new Set(terminalEvidence.map((entry) => entry.payload?.canonicalTool))]
      .filter(Boolean)
      .sort()
    if (expectedOperations.some((operation) => !observedOperations.includes(operation))) {
      throw new Error(`${specification.adapterKind} did not commit all canonical operations: ${JSON.stringify({
        observedOperations,
        evidence
      })}`)
    }
    const invalidEnvelopeEvidence = terminalEvidence.find((entry) => {
      const envelope = entry.payload?.coreEnvelope
      return envelope?.contractVersion !== 2
        || envelope.operation !== entry.payload?.canonicalTool
        || !/^[0-9a-f-]{36}$/.test(envelope.requestId ?? '')
        || Object.hasOwn(envelope, 'result')
        || typeof envelope.ok !== 'boolean'
        || (envelope.ok === false && typeof envelope.error?.code !== 'string')
    })
    if (invalidEnvelopeEvidence) {
      throw new Error(`${specification.adapterKind} Evidence did not retain a valid Core Envelope: ${JSON.stringify(invalidEnvelopeEvidence)}`)
    }
    const taskPatch = terminalEvidence.find((entry) =>
      entry.payload?.canonicalTool === 'team.update_task'
        && entry.payload?.status === 'completed'
    )
    if (!taskPatch || terminalEvidence.some((entry) => entry.payload?.sourceAuthority !== 'core')) {
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
    const resumedSnapshot = await waitForRun(core, specification.threadId, resumed.agentRunId, {
      marker: specification.resumeMarker,
      completionFile: specification.resumeCompletionFile,
      timeoutMs: 480_000
    })
    const resumedEvidence = await builtinEvidence(
      core.request,
      specification.threadId,
      resumed.agentRunId
    )
    if (!resumedEvidence.some((entry) =>
      entry.payload?.canonicalTool === 'thread.list'
        && entry.payload?.status === 'completed'
        && entry.payload?.sourceAuthority === 'core'
    )) {
      throw new Error(`${specification.adapterKind} resumed lease did not execute camp.list`)
    }
    const sendEvidence = JSON.parse(await readFile(specification.sendEvidencePath, 'utf8'))
    const expectedSendMessageIds = new Set([
      sendEvidence.publicMessageId,
      sendEvidence.directUserOnlyMessageId,
      sendEvidence.fileUserOnlyMessageId
    ])
    const successorExactReads = resumedEvidence.filter((entry) =>
      entry.payload?.canonicalTool === 'thread.read'
        && entry.payload?.status === 'completed'
        && entry.payload?.sourceAuthority === 'core'
        && expectedSendMessageIds.has(
          entry.payload?.operationProjection?.canonicalInput?.messageId
        )
    )
    const verifiedSendMessageIds = new Set(successorExactReads.map((entry) =>
      entry.payload.operationProjection.canonicalInput.messageId
    ))
    if (verifiedSendMessageIds.size !== expectedSendMessageIds.size) {
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
    const createdMemberNotifications = core.events.filter((event) =>
      event.method === 'members.invalidated' && event.params?.reason === 'member.create'
    )
    if (createdMemberNotifications.length !== results.length + 1) {
      throw new Error(`${specification.adapterKind} did not emit one committed member roster notification`)
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
    const nativeSessionContinued = Boolean(
      sourceNativeSessionId
        && sourceNativeSessionId === resumedNativeSessionId
    )
    if (specification.adapterKind === 'kiro-cli' && !nativeSessionContinued) {
      throw new Error('kiro-cli did not resume the persisted Native Session')
    }

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
      legacySendFlagRejected: true,
      legacySendJsonRejected: true,
      sendInputSources: ['direct_flags', 'input_file'],
      exactAddressingVerifiedInSuccessorRun: true,
      crossCampManifestId: sourceManifest.id,
      historicalPublicA2aMessageId: historicalPublicA2a.messageId,
      historicalAttachmentMessageId: historicalAttachment.messageId,
      historicalAttachmentId: historicalAttachment.attachmentId,
      successorExactReadCount: successorExactReads.length,
      staleVersionConflict: true,
      initialLeaseFenced: true,
      resumedLeaseFenced: true,
      logicalConversationContinued: true,
      nativeSessionContinued
    })
  }

  console.log(JSON.stringify({
    ok: true,
    contractVersion: Number(builtinCliContractVersion),
    ipcProtocolVersion: Number(builtinCliIpcVersion),
    runtimeCount: results.length,
    operationCountPerRuntime: expectedOperations.length,
    expectedOperations,
    historyEvidence: {
      threadId: historyCampId,
      seedAdapterKind: historySeedSpecification.adapterKind,
      publicA2aMessageId: historicalPublicA2a.messageId,
      publicA2aDeliveryId: historicalPublicA2a.deliveryId,
      attachmentMessageId: historicalAttachment.messageId,
      attachmentId: historicalAttachment.attachmentId
    },
    results,
    fixtureRetained: keepFixture ? fixtureRoot : null
  }, null, 2))
} catch (error) {
  keepFixture = true
  process.stderr.write(`\n[builtin-cli] FAILED; fixture retained at ${fixtureRoot}\n`)
  throw error
} finally {
  if (core) await core.stop()
  if (!keepFixture) {
    await removeEphemeralRuntimeCampFilesRoot(dataDir)
    await makeAttachmentTreeRemovable(dataDir)
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}

function nativeSessionIdForRun(events, agentRunId, startedEvent) {
  const bound = events.find((event) =>
    event.method === 'agent_run.native_session_bound'
      && event.params?.agentRunId === agentRunId
  )
  return bound?.params?.nativeThreadId ?? startedEvent?.params?.nativeThreadId ?? null
}

function assertBuiltinCliCapability(label, installation, allowDeferred = false) {
  const snapshot = installation?.snapshot
  if (allowDeferred
      && label === 'trae-cn-cli'
      && snapshot?.probeStatus === 'installed_unverified') {
    return
  }
  if (snapshot?.probeStatus !== 'ready'
      || !snapshot.capabilities.includes(builtinCliCapability)
      || !snapshot.models.length) {
    throw new Error(`${label} is not ready for Built-in CLI v${builtinCliContractVersion}: ${JSON.stringify(snapshot)}`)
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
        options: adapterKind === 'codex-cli' ? { reasoning_effort: 'low' } : {}
      },
      permissions: profile.runtimeConfiguration.permissions
    }
  })
  if (result.status !== 'applied') {
    throw new Error(`Explicit Runtime model was not selected: ${JSON.stringify(result)}`)
  }
  const resolved = await request('members.get', { agentId })
  const allowedReadiness = adapterKind === 'minimax-code-cli'
    ? ['ready', 'installed_unverified'] : ['ready']
  if (!allowedReadiness.includes(resolved.runtimeReadiness?.status)
      || resolved.runtimeConfiguration?.model?.modelId !== modelId) {
    throw new Error(`Explicit Runtime model is not ready: ${JSON.stringify(resolved)}`)
  }
}

async function createThread(request, input) {
  const result = await request('threads.create', {
    commandId: crypto.randomUUID(),
    name: input.name,
    workspace: { projectPath: input.projectPath },
    memberAgentIds: input.memberAgentIds,
    defaultLeadAgentId: input.defaultLeadAgentId,
    collaborationMode: 'peer'
  })
  const threadId = result.payload?.threadId
  if (result.status !== 'applied' || !threadId) {
    throw new Error(`Camp creation failed: ${JSON.stringify(result)}`)
  }
  return threadId
}

async function sendThreadMessage(request, input) {
  const content = input.agentId
    ? [
        { kind: 'atom', atom: { type: 'member', agentId: input.agentId } },
        { kind: 'text', text: ` ${input.body}` }
      ]
    : [{ kind: 'text', text: input.body }]
  return request('thread.messages.send', {
    commandId: crypto.randomUUID(),
    threadId: input.threadId,
    content: { version: 2, segments: content },
    sourceAttachments: [],
    quotes: [],
    replyToThreadMessageId: null,
    execution: input.execution
  })
}

async function seedHistoricalPublicA2a(coreClient, input) {
  const sent = await sendThreadMessage(coreClient.request, {
    threadId: input.threadId,
    agentId: input.specification.agentId,
    body: [
      'Run the generated historical Public A2A seed script with your native shell tool.',
      'The Runtime process already has the real ROVAI_AGENT_CLI, ROVAI_CLI_CONTEXT, and ROVAI_RUN_TMP lease environment.',
      'Do not modify or replace the script.',
      runtimeShellCommand(input.scriptPath),
      `After it exits 0, reply with exactly ${input.completionMarker}.`
    ].join('\n'),
    execution: {
      taskId: null,
      purpose: 'Create one historical Public A2A through the real Built-in CLI and Message Delivery path.',
      completionRole: 'required'
    }
  })
  const commandResult = sent.commandResult ?? sent
  const agentRunId = await waitForMessageRun(coreClient.request, input.threadId, commandResult.payload?.threadMessageId)
  if (commandResult.status !== 'accepted' || !agentRunId) {
    throw new Error(`Historical Public A2A seed Run was not accepted: ${JSON.stringify(sent)}`)
  }
  const snapshot = await waitForRun(coreClient, input.threadId, agentRunId, {
    marker: input.completionMarker,
    timeoutMs: 480_000
  })
  const messageId = (await readFile(input.evidencePath, 'utf8')).trim()
  const message = snapshot.messages.find((candidate) => candidate.id === messageId)
  const delivery = snapshot.messageDeliveries.find((candidate) =>
    candidate.messageId === messageId
      && candidate.deliveryKind === 'public_a2a'
      && candidate.recipientAgentId === input.specification.recipientProfileId
  )
  const publication = snapshot.timeline.find((event) =>
    ['camp_message.sent', 'camp_message.public_a2a_sent'].includes(event.eventType)
      && event.entityId === messageId
  )
  if (message?.body !== input.marker
      || message.sourceAgentRunId !== agentRunId
      || !delivery
      || !publication
      || !Number.isSafeInteger(message.timelineGlobalSequence)) {
    throw new Error(`Historical Public A2A did not traverse Message Delivery and publication: ${JSON.stringify({
      agentRunId,
      messageId,
      message,
      delivery,
      publication
    })}`)
  }
  return {
    messageId,
    deliveryId: delivery.id,
    sourceAgentRunId: agentRunId,
    publicationSequence: message.timelineGlobalSequence
  }
}

async function createHistoricalAttachmentMessage(request, input) {
  const attachment = {
    id: crypto.randomUUID(),
    sourcePath: input.sourcePath,
    displayName: 'historical-attachment.txt',
    kind: 'file',
    mediaType: 'text/plain',
    observedByteSize: (await readFile(input.sourcePath)).length
  }
  const sent = await request('thread.messages.send', {
    commandId: crypto.randomUUID(),
    threadId: input.threadId,
    content: { version: 2, segments: [{ kind: 'text', text: input.marker }] },
    sourceAttachments: [attachment],
    quotes: [],
    replyToThreadMessageId: null,
    execution: null
  })
  const messageId = sent.commandResult?.payload?.threadMessageId
  const snapshot = await request('camps.snapshot', { threadId: input.threadId })
  const message = snapshot.messages.find((candidate) => candidate.id === messageId)
  const projectedAttachment = message?.attachments?.find((candidate) => candidate.id === attachment.id)
  if (!message
      || projectedAttachment?.availability !== 'unknown'
      || projectedAttachment?.kind !== 'file'
      || projectedAttachment.fileCount !== 1
      || JSON.stringify(message).includes(input.sourcePath)) {
    throw new Error(`Historical attachment message was not persisted with its public shape: ${JSON.stringify({
      attachment,
      message
    })}`)
  }
  return { messageId, attachmentId: attachment.id }
}

async function startVerificationRun(coreClient, specification, resumed) {
  const marker = resumed ? specification.resumeMarker : specification.successMarker
  const scriptPath = resumed ? specification.resumeScriptPath : specification.scriptPath
  const confirmedMemberCard = resumed
    ? []
    : [
        'For the member.create step, this is the complete final member card and I explicitly confirm it now:',
        `Name: ${specification.memberDisplayName}`,
        'Team role: Runtime-created verifier',
        'Professional responsibilities: Verify confirmed member creation through the local CLI.',
        'Personality traits: Precise',
        'Working principles: Use the exact confirmed card and stable creation key.',
        'Growth topic: Practice concise handoffs.',
        'Avatar: none (use the product default).',
        'I also authorize the fixture to update that newly created member role to Runtime-updated verifier, update this synthetic Mission title, and set this synthetic Mission status to needs_you.'
      ]
  const body = ['kimi-code-cli', 'grok-build', 'deepseek-harness'].includes(specification.adapterKind)
    ? [
        'This is an automated Built-in CLI qualification. Act immediately; do not plan, inspect files, or explain.',
        ...confirmedMemberCard,
        'Use the Bash tool exactly once to run:',
        runtimeShellCommand(scriptPath),
        'If it exits 0, reply with exactly its final output line. That line is intentionally absent from this request; do not guess it. Do not call any other tool.'
      ].join('\n')
    : [
        'Run the local repository Built-in CLI transport qualification.',
        'The script was generated by this test and the Runtime process already has ROVAI_AGENT_CLI, ROVAI_CLI_CONTEXT, and ROVAI_RUN_TMP injected.',
        ...confirmedMemberCard,
        'You may inspect the script if your Runtime requires that before execution; do not modify or replace it.',
        'Use your native bash/shell tool to run:',
        runtimeShellCommand(scriptPath),
        `If it exits 0 and prints ${marker}, reply with exactly ${marker}.`
      ].join('\n')
  const sent = await sendThreadMessage(coreClient.request, {
    threadId: specification.threadId,
    agentId: specification.agentId,
    body,
    execution: {
      taskId: null,
      purpose: resumed
        ? `Verify ${specification.adapterKind} resume/process reuse receives a new active CLI lease.`
        : `Verify ${specification.adapterKind} executes all ${expectedOperations.length} CLI-only built-in operations.`,
      completionRole: 'required'
    }
  })
  const commandResult = sent.commandResult ?? sent
  const agentRunId = await waitForMessageRun(coreClient.request, specification.threadId, commandResult.payload?.threadMessageId)
  if (commandResult.status !== 'accepted' || !agentRunId) {
    throw new Error(`${specification.adapterKind} AgentRun intake failed: ${JSON.stringify(sent)}`)
  }
  return { agentRunId }
}

async function waitForMessageRun(request, threadId, messageId) {
  if (!messageId) throw new Error('Message intake did not return its identity')
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const snapshot = await request('threads.snapshot', { threadId })
    const run = snapshot.agentRuns.find((candidate) =>
      candidate.inputMessageIds?.includes(messageId) || candidate.anchorMessageId === messageId)
    if (run) return run.id
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Message ${messageId} did not dispatch an AgentRun`)
}

async function waitForRun(coreClient, threadId, agentRunId, options) {
  const deadline = Date.now() + options.timeoutMs
  const resolvedApprovals = new Set()
  while (Date.now() < deadline) {
    const snapshot = await coreClient.request('camps.snapshot', { threadId })
    await resolvePendingApprovals(coreClient.request, snapshot, agentRunId, resolvedApprovals)
    const run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    if (run?.status === 'succeeded') {
      if (options.completionFile) {
        const completion = await readFile(options.completionFile, 'utf8').catch(() => '')
        if (completion.trim() !== options.marker) {
          throw new Error(`AgentRun ${agentRunId} ended without the script completion receipt`)
        }
      }
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

async function waitForHistoricalDeliveryTerminal(coreClient, threadId, deliveryId) {
  const deadline = Date.now() + 480_000
  let cancellationRequested = false
  while (Date.now() < deadline) {
    const snapshot = await coreClient.request('camps.snapshot', { threadId })
    const delivery = snapshot.messageDeliveries.find((candidate) => candidate.id === deliveryId)
    const targetRun = delivery?.targetAgentRunId
      ? snapshot.agentRuns.find((candidate) => candidate.id === delivery.targetAgentRunId)
      : null
    if (targetRun) {
      if (targetRun.status === 'succeeded') return
      if (targetRun.status === 'cancelled') return
      if (['failed', 'interrupted'].includes(targetRun.status)) {
        throw new Error(`Historical Public A2A target Run entered ${targetRun.status}: ${JSON.stringify(targetRun)}`)
      }
      // The historical fixture needs the committed Public A2A message and
      // Delivery, not concurrent recipient work. Quiesce that exact target
      // before publishing the attachment used by the cross-Camp read checks.
      if (!cancellationRequested) {
        const cancellation = await coreClient.request('agentRuns.cancel', {
          commandId: crypto.randomUUID(),
          command: {
            threadId,
            agentRunId: targetRun.id,
            expectedVersion: targetRun.version
          }
        })
        if (cancellation.status === 'rejected') {
          throw new Error(`Historical Public A2A target cancellation was rejected: ${JSON.stringify(cancellation)}`)
        }
        cancellationRequested = true
      }
    }
    if (delivery && ['failed', 'cancelled'].includes(delivery.status)) {
      throw new Error(`Historical Public A2A Delivery entered ${delivery.status}: ${JSON.stringify(delivery)}`)
    }
    await delay(400)
  }
  throw new Error(`Timed out waiting for historical Public A2A Delivery ${deliveryId}`)
}

async function waitForRecipientRun(coreClient, specification, recipientProfileId) {
  const deadline = Date.now() + 480_000
  const resolvedApprovals = new Set()
  while (Date.now() < deadline) {
    const snapshot = await coreClient.request('camps.snapshot', { threadId: specification.threadId })
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
      threadId: snapshot.thread.id,
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

async function builtinEvidence(request, threadId, agentRunId) {
  const collected = []
  let afterSequence = 0
  let throughSequence = null
  while (true) {
    const page = await request('agentRunEvidence.list', {
      threadId,
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

function historyPublicationScript(input) {
  return `#!/bin/bash
set -euo pipefail

${shellLeasePrelude(true)}
JQ="$(command -v jq)"
test -x "$CLI"
test -f "$CONTEXT_FILE"
test -d "$RUN_TMP"
${shellContextPrivacyAssertion()}

public_send="$("$CLI" send --to ${shellQuote(input.recipientProfileId)} --body ${shellQuote(input.marker)})"
printf '%s\n' "$public_send" | "$JQ" -e --arg recipient ${shellQuote(input.recipientProfileId)} '
  (keys | sort) == ["agentAddressingMode", "deliveryIds", "effectiveRecipients", "messageId"]
  and .agentAddressingMode == "automatic"
  and .effectiveRecipients == [$recipient]
  and (.deliveryIds | length) == 1
' >/dev/null
printf '%s\n' "$public_send" | "$JQ" -er '.messageId' > ${shellQuote(shellPath(input.evidencePath))}
printf '%s\n' ${shellQuote(input.completionMarker)}
`
}

function verificationScript(input) {
  const taskCreate = JSON.stringify({
    title: `CLI transport task ${input.adapterKind}`,
    description: 'Created through the canonical operation result contract.',
    assigneeAgentId: input.agentId
  })
  const campRead = (messageIdExpression) =>
    `jq -n --arg messageId "${messageIdExpression}" '{messageId:$messageId}'`
  const memoryWrite = JSON.stringify({
    action: 'add',
    scope: 'companion',
    kind: 'preference',
    body: `Remember that ${input.adapterKind} completed Built-in CLI transport v${builtinCliContractVersion} qualification.`,
    retrievalKeys: [`cli-${input.slug.slice(0, 18)}`]
  })
  const hearth = JSON.stringify({
    action: 'add',
    scope: 'hearth',
    kind: 'lesson',
    body: `The ${input.adapterKind} Runtime can invoke Rovai built-ins only through the local CLI.`,
    retrievalKeys: [`hearth-${input.slug.slice(0, 14)}`]
  })
  const publicSend = `Publish exactly one important-result notification with rovai send --public-only --to-user --body 'ROVAI_PUBLIC_A2A_${input.slug.toUpperCase()}_RESULT', then finish. Do not route to any Agent.`

  return `#!/bin/bash
set -euo pipefail

${shellLeasePrelude(true)}
JQ="$(command -v jq)"
DIAGNOSTIC=${shellQuote(shellPath(input.diagnosticPath))}
STEP=bootstrap
exec 2>"$DIAGNOSTIC.stderr"
trap 'code=$?; printf "exit=%s step=%s line=%s\n" "$code" "$STEP" "$LINENO" > "$DIAGNOSTIC"; exit "$code"' EXIT
test -x "$CLI"
test -f "$CONTEXT_FILE"
test -d "$RUN_TMP"
${shellContextPrivacyAssertion()}
printf '%s\n' "$CONTEXT" > ${shellQuote(shellPath(input.contextPathFile))}

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
    and (if $operation == "thread.message.send"
         then (.messageId | type) == "string"
           and (.agentAddressingMode == "automatic" or .agentAddressingMode == "public_only")
           and (.effectiveRecipients | type) == "array"
           and (.deliveryIds | type) == "array"
         elif $operation == "memory.write"
         then ((.outcome == "effective" and (.memoryId | type) == "string" and (.revisionId | type) == "string")
           or (.outcome == "review_pending" and (.reviewItemId | type) == "string"))
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
"$CLI" --version | grep -q 'contract-v${builtinCliContractVersion} ipc-v${builtinCliIpcVersion}'

STEP=exact_help
root_help="$("$CLI" --help)"
printf '%s\n' "$root_help" | grep -Fq ${shellQuote("Run an Agent operation's exact `--help` for its closed inputs.")}
send_help="$("$CLI" send --help)"
printf '%s\n' "$send_help" | grep -Fq -- '--public-only'
printf '%s\n' "$send_help" | grep -Fq -- '--to-user'
if printf '%s\n' "$send_help" | grep -Fq -- '--to-principal'; then
  exit 1
fi
printf '%s\n' "$send_help" | grep -Fq -- 'Ordinary public Thread messages are already visible to the User.'
printf '%s\n' "$send_help" | grep -Fq -- 'Guarantee that this public message wakes no Agent.'
printf '%s\n' "$send_help" | grep -Fq -- 'Agent addressing schedules concrete continuing work, not CC.'
printf '%s\n' "$send_help" | grep -Fq -- 'Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds.'
printf '%s\n' "$send_help" | grep -Fq -- 'User attention is message-local and is never inherited'
printf '%s\n' "$send_help" | grep -Fq -- ${shellQuote('Use --body for simple single-line text, including Markdown; \\n remains literal.')}
printf '%s\n' "$send_help" | grep -Fq -- ${shellQuote('For multiline or complex text, use a file-write tool to write the reply text itself, with real newlines, to a UTF-8 file.')}
printf '%s\n' "$send_help" | grep -Fq -- ${shellQuote('Input: direct flags, or --input-file <path> with send flags except --body.')}
printf '%s\n' "$send_help" | grep -Fq -- ${shellQuote('  Write a temporary body file (e.g. reply.md):')}
printf '%s\n' "$send_help" | grep -Fq -- ${shellQuote('  After the write succeeds:')}
printf '%s\n' "$send_help" | grep -Fq -- ${shellQuote('    rovai send --public-only --input-file reply.md')}
printf '%s\n' "$send_help" | grep -Fq -- "rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'"
printf '%s\n' "$send_help" | grep -Fq -- "rovai send --public-only --to-user --body 'Please choose whether to roll back the client or continue the token investigation.'"
member_help="$("$CLI" member create --help)"
printf '%s\n' "$member_help" | grep -Fq -- '--creation-key'
printf '%s\n' "$member_help" | grep -Fq -- '--avatar-file'
printf '%s\n' "$member_help" | grep -Fq -- 'complete card explicitly confirmed by the User'
camp_search_help="$("$CLI" camp search --help)"
printf '%s\n' "$camp_search_help" | grep -Fq -- "rovai thread search --query 'amount'"
printf '%s\n' "$camp_search_help" | grep -Fq -- "rovai thread search --thread-id '<thread-id>' --query 'amount'"
camp_read_help="$("$CLI" camp read --help)"
printf '%s\n' "$camp_read_help" | grep -Fq -- 'rovai thread read --after 123'
printf '%s\n' "$camp_read_help" | grep -Fq -- 'rovai thread read --before 123'
printf '%s\n' "$camp_read_help" | grep -Fq -- "rovai thread read --message-id '<message-id>'"
printf '%s\n' "$camp_read_help" | grep -Fq -- "rovai thread read --reply-chain '<message-id>' --limit 20"
! printf '%s\n' "$camp_read_help" | grep -Fq -- '--mode'
! printf '%s\n' "$camp_read_help" | grep -Fq -- '--direction'
history_search_help="$("$CLI" history search --help)"
printf '%s\n' "$history_search_help" | grep -Fq -- "rovai history search --query 'amount'"
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
legacy_json="$(printf '%s\n' '{"threadId":"camp-legacy","body":"rejected"}' | "$CLI" send 2>"$RUN_TMP/legacy-json.err")"
legacy_json_status=$?
set -e
test "$legacy_json_status" -eq 2
test ! -s "$RUN_TMP/legacy-json.err"
assert_fix_input "$legacy_json"

STEP=removed_memory_command
set +e
removed_memory_command="$("$CLI" memory propose-hearth 2>"$RUN_TMP/removed-memory-command.err")"
removed_memory_command_status=$?
set -e
test "$removed_memory_command_status" -eq 2
test ! -s "$RUN_TMP/removed-memory-command.err"
assert_fix_input "$removed_memory_command"

STEP=member_create
member_create="$("$CLI" member create \
  --creation-key ${shellQuote(input.memberCreationKey)} \
  --display-name ${shellQuote(input.memberDisplayName)} \
  --team-role 'Runtime-created verifier' \
  --professional-responsibilities 'Verify confirmed member creation through the local CLI.' \
  --personality-traits Precise \
  --working-principles 'Use the exact confirmed card and stable creation key.' \
  --growth-topic 'Practice concise handoffs.')"
assert_success "$member_create" 'member.create'
printf '%s\n' "$member_create" | "$JQ" -e '
  (.agentId | type) == "string"
  and .version == 1
  and .avatarRef == null
  and .avatarStatus == "not_requested"
' >/dev/null
created_agent_id="$(printf '%s\n' "$member_create" | "$JQ" -er '.agentId')"

STEP=member_list
member_list="$("$CLI" member list)"
assert_success "$member_list" 'member.list'
STEP=member_get
member_get="$("$CLI" member get --agent-id "$created_agent_id")"
assert_success "$member_get" 'member.get'
member_version="$(printf '%s\n' "$member_get" | "$JQ" -er '.version')"
STEP=member_update
member_update="$("$CLI" member update --agent-id "$created_agent_id" --expected-version "$member_version" --request-id ${shellQuote(crypto.randomUUID())} --team-role 'Runtime-updated verifier')"
assert_success "$member_update" 'member.update'

STEP=thread_runs
thread_runs="$("$CLI" thread runs --active)"
assert_success "$thread_runs" 'thread.runs'
STEP=mission_list
mission_list="$("$CLI" mission list)"
assert_success "$mission_list" 'mission.list'
STEP=mission_get
mission_get="$("$CLI" mission get)"
assert_success "$mission_get" 'mission.get'
printf '%s\n' "$mission_get" | "$JQ" -e --arg id ${shellQuote(input.missionId)} '.missionId == $id' >/dev/null
STEP=mission_update
mission_update="$("$CLI" mission update --title ${shellQuote(`Updated CLI Mission ${input.slug}`)})"
assert_success "$mission_update" 'mission.update'
STEP=mission_status
mission_status="$("$CLI" mission status --status needs_you)"
assert_success "$mission_status" 'mission.status'

STEP=automation_create
automation_create="$("$CLI" automation create \
  --name ${shellQuote(`CLI Automation ${input.slug}`)} \
  --prompt 'Return one short verification result.' \
  --member "$created_agent_id" \
  --project quick-chat \
  --repeat manual)"
assert_success "$automation_create" 'automation.create'
automation_id="$(printf '%s\n' "$automation_create" | "$JQ" -er '.automationId')"
automation_version="$(printf '%s\n' "$automation_create" | "$JQ" -er '.version')"
printf '%s\n' "$automation_create" | "$JQ" -e --arg automationId "$automation_id" '
  .automationId == $automationId and .enabled == true and .nextRunAt == null
' >/dev/null

STEP=automation_list
automation_list="$("$CLI" automation list --status enabled --query ${shellQuote(`CLI Automation ${input.slug}`)} --limit 10)"
assert_success "$automation_list" 'automation.list'
printf '%s\n' "$automation_list" | "$JQ" -e --arg automationId "$automation_id" '
  .automations | any(.automationId == $automationId)
' >/dev/null

STEP=automation_get
automation_get="$("$CLI" automation get --automation-id "$automation_id")"
assert_success "$automation_get" 'automation.get'
printf '%s\n' "$automation_get" | "$JQ" -e --arg automationId "$automation_id" '
  .automationId == $automationId and .version == 1
' >/dev/null

STEP=automation_update
automation_update="$("$CLI" automation update \
  --automation-id "$automation_id" \
  --expected-version "$automation_version" \
  --name ${shellQuote(`Updated CLI Automation ${input.slug}`)})"
assert_success "$automation_update" 'automation.update'
automation_version="$(printf '%s\n' "$automation_update" | "$JQ" -er '.version')"
printf '%s\n' "$automation_update" | "$JQ" -e '.version == 2' >/dev/null

STEP=automation_run
automation_run="$("$CLI" automation run --automation-id "$automation_id")"
assert_success "$automation_run" 'automation.run'
printf '%s\n' "$automation_run" | "$JQ" -e '
  .status == "started" and .reason == null and (.threadId | type) == "string"
' >/dev/null

STEP=automation_close
automation_close="$("$CLI" automation close \
  --automation-id "$automation_id" \
  --expected-version "$automation_version")"
assert_success "$automation_close" 'automation.close'
automation_version="$(printf '%s\n' "$automation_close" | "$JQ" -er '.version')"
printf '%s\n' "$automation_close" | "$JQ" -e '.enabled == false and .version == 3' >/dev/null

STEP=automation_delete
automation_delete="$("$CLI" automation delete \
  --automation-id "$automation_id" \
  --expected-version "$automation_version")"
assert_success "$automation_delete" 'automation.delete'
printf '%s\n' "$automation_delete" | "$JQ" -e --arg automationId "$automation_id" '
  .automationId == $automationId and .deleted == true
' >/dev/null

cat > "$RUN_TMP/task-create.json" <<'ROVAI_JSON'
${taskCreate}
ROVAI_JSON
STEP=task_create
task_create_status=1
for task_create_attempt in 1 2 3; do
  set +e
  task_create="$("$CLI" task create --input-file "$RUN_TMP_NATIVE/task-create.json")"
  task_create_status=$?
  set -e
  if [ "$task_create_status" -eq 0 ]; then
    break
  fi
  printf '%s\n' "$task_create" > "$RUN_TMP/task-create-error-$task_create_attempt.json"
  sleep 1
done
test "$task_create_status" -eq 0
assert_success "$task_create" 'team.create_task'
task_id="$(printf '%s\n' "$task_create" | "$JQ" -er '.taskId')"
printf '%s\n' "$task_create" | "$JQ" -e 'has("version") | not' >/dev/null

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
task_update="$("$CLI" task update --task-id "$task_id" --status in_progress)"
assert_success "$task_update" 'team.update_task'
printf '%s\n' "$task_update" | "$JQ" -e 'has("version") | not' >/dev/null

STEP=task_field_patch
title_update="$("$CLI" task update --task-id "$task_id" --title field-patch-title)"
assert_success "$title_update" 'team.update_task'
patched_task="$("$CLI" task get --task-id "$task_id")"
printf '%s\n' "$patched_task" | "$JQ" -e '.title == "field-patch-title" and .status == "in_progress" and (has("version") | not) and (has("availableActions") | not)' >/dev/null

STEP=camp_list
camp_list="$(printf '{}\n' | "$CLI" camp list)"
assert_success "$camp_list" 'thread.list'
printf '%s\n' "$camp_list" | "$JQ" -e --arg threadId ${shellQuote(input.historyCampId)} '.threads | any(.threadId == $threadId)' >/dev/null

STEP=camp_search
camp_search="$("$CLI" camp search --query ${shellQuote(input.currentMarker)} --limit 5)"
assert_success "$camp_search" 'thread.search'
message_id="$(printf '%s\n' "$camp_search" | "$JQ" -er '.results[0].messageId')"
STEP=camp_search_explicit_current
camp_search_explicit_current="$("$CLI" camp search --camp-id ${shellQuote(input.threadId)} --query ${shellQuote(input.currentMarker)} --limit 5)"
assert_success "$camp_search_explicit_current" 'thread.search'
test "$(printf '%s\n' "$camp_search_explicit_current" | "$JQ" -er '.results[0].messageId')" = "$message_id"
STEP=camp_read_default_current
camp_read_default_current="$("$CLI" camp read </dev/null)"
assert_success "$camp_read_default_current" 'thread.read'
printf '%s\n' "$camp_read_default_current" | "$JQ" -e --arg threadId ${shellQuote(input.threadId)} --arg messageId "$message_id" '
  .threadId == $threadId
  and .mode == "timeline"
  and .direction == "before"
  and (.items | any(.messageId == $messageId))
' >/dev/null
STEP=camp_read_default_explicit
camp_read_default_explicit="$("$CLI" camp read --camp-id ${shellQuote(input.threadId)})"
assert_success "$camp_read_default_explicit" 'thread.read'
printf '%s\n' "$camp_read_default_explicit" | "$JQ" -e --arg messageId "$message_id" '
  .mode == "timeline"
  and .direction == "before"
  and (.items | any(.messageId == $messageId))
' >/dev/null
STEP=camp_read_default_stdin
camp_read_default_stdin="$(printf '%s\n' ${shellQuote(JSON.stringify({ threadId: input.threadId, limit: 5 }))} | "$CLI" camp read)"
assert_success "$camp_read_default_stdin" 'thread.read'
printf '%s\n' "$camp_read_default_stdin" | "$JQ" -e '.mode == "timeline" and .direction == "before"' >/dev/null
cat > "$RUN_TMP/camp-read-default.json" <<'ROVAI_JSON'
${JSON.stringify({ threadId: input.threadId, limit: 5 })}
ROVAI_JSON
STEP=camp_read_default_input_file
camp_read_default_input_file="$("$CLI" camp read --input-file "$RUN_TMP_NATIVE/camp-read-default.json")"
assert_success "$camp_read_default_input_file" 'thread.read'
printf '%s\n' "$camp_read_default_input_file" | "$JQ" -e '.mode == "timeline" and .direction == "before"' >/dev/null
STEP=camp_read
${campRead('$message_id')} > "$RUN_TMP/camp-read.json"
camp_read="$("$CLI" camp read --input-file "$RUN_TMP_NATIVE/camp-read.json")"
assert_success "$camp_read" 'thread.read'
printf '%s\n' "$camp_read" | "$JQ" -e --arg threadId ${shellQuote(input.threadId)} --arg messageId "$message_id" '.threadId == $threadId and .items[0].messageId == $messageId' >/dev/null

STEP=history_search_public_a2a
history_search="$("$CLI" history search --query ${shellQuote(input.historyPublicA2aMarker)} --limit 5)"
assert_success "$history_search" 'history.search'
printf '%s\n' "$history_search" | "$JQ" -e \
  --arg threadId ${shellQuote(input.historyCampId)} \
  --arg messageId ${shellQuote(input.historyPublicA2aMessageId)} \
  '.results | any(.threadId == $threadId and .messageId == $messageId)' >/dev/null
STEP=camp_search_historical_public_a2a
camp_search_historical="$("$CLI" camp search --camp-id ${shellQuote(input.historyCampId)} --query ${shellQuote(input.historyPublicA2aMarker)} --limit 5)"
assert_success "$camp_search_historical" 'thread.search'
printf '%s\n' "$camp_search_historical" | "$JQ" -e --arg threadId ${shellQuote(input.historyCampId)} --arg messageId ${shellQuote(input.historyPublicA2aMessageId)} '
  .results | any(.threadId == $threadId and .messageId == $messageId and (has("threadTitle") | not))
' >/dev/null
STEP=camp_read_historical_public_a2a
camp_read_historical="$("$CLI" camp read --camp-id ${shellQuote(input.historyCampId)} --message-id ${shellQuote(input.historyPublicA2aMessageId)})"
assert_success "$camp_read_historical" 'thread.read'
printf '%s\n' "$camp_read_historical" | "$JQ" -e \
  --arg threadId ${shellQuote(input.historyCampId)} \
  --arg messageId ${shellQuote(input.historyPublicA2aMessageId)} \
  --arg body ${shellQuote(input.historyPublicA2aMarker)} '
  .threadId == $threadId
  and .items[0].messageId == $messageId
  and .items[0].senderType == "agent"
  and .items[0].body == $body
' >/dev/null

STEP=camp_search_historical_attachment
camp_search_historical_attachment="$("$CLI" camp search --camp-id ${shellQuote(input.historyCampId)} --query ${shellQuote(input.historyAttachmentMarker)} --limit 5)"
assert_success "$camp_search_historical_attachment" 'thread.search'
printf '%s\n' "$camp_search_historical_attachment" | "$JQ" -e --arg messageId ${shellQuote(input.historyAttachmentMessageId)} '
  .results | any(.messageId == $messageId and (has("threadTitle") | not))
' >/dev/null
STEP=camp_read_historical_attachment
camp_read_historical_attachment="$("$CLI" camp read --camp-id ${shellQuote(input.historyCampId)} --message-id ${shellQuote(input.historyAttachmentMessageId)})"
assert_success "$camp_read_historical_attachment" 'thread.read'
printf '%s\n' "$camp_read_historical_attachment" | "$JQ" -e \
  --arg threadId ${shellQuote(input.historyCampId)} \
  --arg messageId ${shellQuote(input.historyAttachmentMessageId)} \
  --arg attachmentId ${shellQuote(input.historyAttachmentId)} \
  --arg body ${shellQuote(input.historyAttachmentMarker)} '
  .threadId == $threadId
  and .items[0].messageId == $messageId
  and .items[0].body == $body
  and .items[0].attachmentCount == 1
  and .items[0].attachmentsTruncated == false
  and .items[0].attachmentOmittedCount == 0
  and (.items[0].attachments | length) == 1
  and .items[0].attachments[0].attachmentId == $attachmentId
  and .items[0].attachments[0].name == "historical-attachment.txt"
  and .items[0].attachments[0].kind == "file"
  and .items[0].attachments[0].fileCount == 1
  and .items[0].attachments[0].mediaType == "text/plain"
' >/dev/null

cat > "$RUN_TMP/public-send.json" <<'ROVAI_JSON'
${publicSend}
ROVAI_JSON
STEP=camp_message_send
public_send="$("$CLI" send --to ${shellQuote(input.recipientProfileId)} --input-file "$RUN_TMP_NATIVE/public-send.json")"
assert_success "$public_send" 'thread.message.send'
printf '%s\n' "$public_send" | "$JQ" -e --arg recipient ${shellQuote(input.recipientProfileId)} '
  (keys | sort) == ["agentAddressingMode", "deliveryIds", "effectiveRecipients", "messageId"]
  and .agentAddressingMode == "automatic"
  and .effectiveRecipients == [$recipient]
  and (.deliveryIds | length) == 1
' >/dev/null
public_message_id="$(printf '%s\n' "$public_send" | "$JQ" -er '.messageId')"

STEP=camp_message_send_direct_public_only_user
user_only="$("$CLI" send --public-only --to-user --body ${shellQuote(`Direct User decision ${input.adapterKind}`)})"
assert_success "$user_only" 'thread.message.send'
printf '%s\n' "$user_only" | "$JQ" -e '
  (keys | sort) == ["agentAddressingMode", "deliveryIds", "effectiveRecipients", "messageId"]
  and .agentAddressingMode == "public_only"
  and .effectiveRecipients == []
  and .deliveryIds == []
' >/dev/null
user_only_id="$(printf '%s\n' "$user_only" | "$JQ" -er '.messageId')"

STEP=camp_message_send_file_public_only_user
printf '%s\n' ${shellQuote(`File User decision ${input.adapterKind}`)} > "$RUN_TMP/user-only.txt"
file_user_only="$("$CLI" send --public-only --to-user --input-file "$RUN_TMP_NATIVE/user-only.txt")"
assert_success "$file_user_only" 'thread.message.send'
printf '%s\n' "$file_user_only" | "$JQ" -e '
  .agentAddressingMode == "public_only"
  and .effectiveRecipients == []
  and .deliveryIds == []
' >/dev/null
file_user_only_id="$(printf '%s\n' "$file_user_only" | "$JQ" -er '.messageId')"

STEP=freeze_send_locators
"$JQ" -n \
  --arg publicMessageId "$public_message_id" \
  --arg directUserOnlyMessageId "$user_only_id" \
  --arg fileUserOnlyMessageId "$file_user_only_id" \
  '{publicMessageId:$publicMessageId,directUserOnlyMessageId:$directUserOnlyMessageId,fileUserOnlyMessageId:$fileUserOnlyMessageId}' \
  > ${shellQuote(shellPath(input.sendEvidencePath))}

cat > "$RUN_TMP/memory-write.json" <<'ROVAI_JSON'
${memoryWrite}
ROVAI_JSON
STEP=memory_write
memory_write="$("$CLI" memory write --input-file "$RUN_TMP_NATIVE/memory-write.json")"
assert_success "$memory_write" 'memory.write'
printf '%s\n' "$memory_write" | "$JQ" -e '.outcome == "effective"' >/dev/null
memory_id="$(printf '%s\n' "$memory_write" | "$JQ" -er '.memoryId')"

STEP=memory_view
memory_view="$("$CLI" memory view --scope companion)"
assert_success "$memory_view" 'memory.view'
printf '%s\n' "$memory_view" | "$JQ" -e --arg memoryId "$memory_id" '
  .scope == "companion"
  and .complete == true
  and .itemCount == (.items | length)
  and (.totalBodyBytes | type) == "number"
  and (.items | any(
    .target.memoryId == $memoryId
    and .target.scope == "companion"
    and (.target.revisionId | type) == "string"
    and .agentCanRevise == true
  ))
' >/dev/null

STEP=memory_search
memory_search="$("$CLI" memory search --query ${shellQuote(`cli-${input.slug.slice(0, 18)}`)} --limit 6)"
assert_success "$memory_search" 'memory.search'
printf '%s\n' "$memory_search" | "$JQ" -e --arg memoryId "$memory_id" '
  .results | any(.memoryId == $memoryId and .scope == "companion"
    and (has("counterpartyAgentId") | not) and (has("direction") | not))
' >/dev/null

STEP=memory_read
memory_read_input="$("$JQ" -nc --arg memoryId "$memory_id" '{memoryIds:[$memoryId]}')"
memory_read="$(printf '%s\n' "$memory_read_input" | "$CLI" memory read)"
assert_success "$memory_read" 'memory.read'
printf '%s\n' "$memory_read" | "$JQ" -e --arg memoryId "$memory_id" '
  .memories | any(.memoryId == $memoryId and .cacheState == "current"
    and .target.memoryId == $memoryId and .target.scope == "companion"
    and (.target.revisionId | type) == "string"
    and .agentCanRevise == true)
' >/dev/null

cat > "$RUN_TMP/hearth.json" <<'ROVAI_JSON'
${hearth}
ROVAI_JSON
STEP=memory_write_hearth
hearth_result="$("$CLI" memory write --input-file "$RUN_TMP_NATIVE/hearth.json")"
assert_success "$hearth_result" 'memory.write'
printf '%s\n' "$hearth_result" | "$JQ" -e '
  (keys | sort) == ["outcome", "reviewItemId"]
  and .outcome == "review_pending"
  and (.reviewItemId | type) == "string"
' >/dev/null

STEP=complete
printf 'exit=0 step=complete\n' > "$DIAGNOSTIC"
trap - EXIT
printf '%s\n' ${shellQuote(JSON.stringify({
    ok: true,
    marker: input.successMarker,
    operationCount: expectedOperations.length,
    taskFieldPatch: 'last_successful_field_write'
  }))}
`
}

function resumeVerificationScript(input) {
  return `#!/bin/bash
set -euo pipefail
${shellLeasePrelude(false)}
JQ="$(command -v jq)"
  SEND_EVIDENCE=${shellQuote(process.platform === 'win32'
    ? input.sendEvidencePath.replace(/^\\\\\?\\/, '')
    : input.sendEvidencePath)}
printf '%s\n' "$CONTEXT" > ${shellQuote(shellPath(input.resumeContextPathFile))}
camp_list="$(printf '{}\n' | "$CLI" camp list)"
printf '%s\n' "$camp_list" | jq -e '((has("contractVersion") | not) and (.threads | type) == "array")' >/dev/null

read_item() {
  local message_id="$1"
  "$JQ" -n --arg threadId ${shellQuote(input.threadId)} --arg messageId "$message_id" \
    '{threadId:$threadId,messageId:$messageId}' | "$CLI" camp read
}

public_message_id="$("$JQ" -er '.publicMessageId' "$SEND_EVIDENCE")"
public_read="$(read_item "$public_message_id")"
printf '%s\n' "$public_read" | "$JQ" -e \
  --arg messageId "$public_message_id" \
  --arg recipient ${shellQuote(input.recipientProfileId)} '
    .items[0].messageId == $messageId
    and ([.items[0].mentions[].id] == [$recipient])
  ' >/dev/null

for key in directUserOnlyMessageId fileUserOnlyMessageId; do
  message_id="$("$JQ" -er --arg key "$key" '.[$key]' "$SEND_EVIDENCE")"
  item="$(read_item "$message_id")"
  printf '%s\n' "$item" | "$JQ" -e --arg messageId "$message_id" '
    .items[0].messageId == $messageId
    and .items[0].mentions == [{"id":"user"}]
  ' >/dev/null
done

printf '%s\n' ${shellQuote(input.resumeMarker)} > ${shellQuote(shellPath(input.resumeCompletionFile))}
printf '%s\n' ${shellQuote(JSON.stringify({ ok: true, marker: input.resumeMarker, newLease: true }))}
`
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function runtimeShellCommand(scriptPath) {
  if (process.platform === 'win32') {
    return `${windowsCommandPath(bashExecutable)} ${JSON.stringify(scriptPath.replaceAll('\\', '/'))}`
  }
  return `${bashExecutable} ${JSON.stringify(scriptPath)}`
}

function windowsCommandPath(value) {
  const command = String(value)
    .replace(/^\\\\\?\\/, '')
    .replace(/^([A-Za-z]):[\\/]Program Files \(x86\)[\\/]/i, '$1:/Progra~2/')
    .replace(/^([A-Za-z]):[\\/]Program Files[\\/]/i, '$1:/Progra~1/')
    .replaceAll('\\', '/')
  if (/\s/.test(command)) {
    throw new Error(`ROVAI_BASH_BIN must have a space-free Windows command path: ${command}`)
  }
  return command
}

function shellPath(value) {
  if (process.platform !== 'win32') return value
  return String(value)
    .replace(/^\\\\\?\\/, '')
    .replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`)
    .replaceAll('\\', '/')
}

function shellLeasePrelude(includeRunTmp) {
  const lines = [
    'CLI="\${ROVAI_AGENT_CLI:?ROVAI_AGENT_CLI is required}"',
    'CONTEXT="\${ROVAI_CLI_CONTEXT:?ROVAI_CLI_CONTEXT is required}"'
  ]
  if (includeRunTmp) lines.push('RUN_TMP="\${ROVAI_RUN_TMP:?ROVAI_RUN_TMP is required}"')
  if (process.platform === 'win32') {
    lines.push('CLI="$(cygpath -u "$CLI")"')
    lines.push('CONTEXT_FILE="$(cygpath -u "$CONTEXT")"')
    if (includeRunTmp) {
      lines.push('RUN_TMP="$(cygpath -u "$RUN_TMP")"')
      // Git Bash needs the POSIX path for redirection, while the native
      // rovai.exe must receive a Win32 --input-file path. CodeBuddy exports
      // MSYS2_ARG_CONV_EXCL=*, so relying on implicit MSYS argv conversion
      // makes every input-file operation fail after the first flag-only step.
      lines.push('RUN_TMP_NATIVE="$(cygpath -w "$RUN_TMP")"')
    }
    // Every executable used below (rovai.exe and jq.exe) is native Windows.
    // Pass the explicit Win32 paths above without ambient MSYS rewriting.
    lines.push("export MSYS2_ARG_CONV_EXCL='*'")
  } else {
    lines.push('CONTEXT_FILE="$CONTEXT"')
    if (includeRunTmp) lines.push('RUN_TMP_NATIVE="$RUN_TMP"')
  }
  return lines.join('\n')
}

function shellContextPrivacyAssertion() {
  if (process.platform === 'win32') {
    return ': Windows private-file DACL is verified by the Core platform acceptance suite.'
  }
  return process.platform === 'linux'
    ? 'test "$(stat -c \'%a\' "$CONTEXT")" = "600"'
    : 'test "$(stat -f \'%Lp\' "$CONTEXT")" = "600"'
}

function startCore(dataDirectory) {
  const child = spawn(coreExecutable, [
    ...coreDataDirectoryArguments(dataDirectory),
    '--skill-library-root', skillLibraryRoot,
    '--mcp-config-path', join(dataDirectory, 'mcp.json')
  ], {
    cwd: root,
    env: {
      ...process.env,
      ...(selectedAdapters.has('pi')
        ? {
            PI_CODING_AGENT_DIR: piAgentDir,
          }
        : {})
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
    if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.code}: ${message.error.message}`))
    else entry.resolve(message.result)
  })
  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`Timed out waiting for Core method ${method}`))
    }, 180_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer, method })
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

async function makeAttachmentTreeRemovable(dataDirectory) {
  await makeDirectoryTreeRemovable(join(dataDirectory, 'camp-attachments'))
}

async function makeDirectoryTreeRemovable(directory) {
  await chmod(directory, 0o700).catch(() => undefined)
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => makeDirectoryTreeRemovable(join(directory, entry.name))))
}
