import { chmod, mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import {
  coreDataDirectoryArguments,
  removeEphemeralRuntimeCampFilesRoot
} from './lib/runtime-camp-files-root.mjs'

const root = resolve(import.meta.dirname, '..')
const coreExecutable = resolve(
  process.env.ROVAI_BUILTIN_CLI_CORE_EXECUTABLE ?? join(root, 'target', 'debug', 'rovai-core')
)
const cliExecutable = resolve(
  process.env.ROVAI_BUILTIN_CLI_EXECUTABLE ?? join(root, 'target', 'debug', 'rovai')
)
const fixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'rovai-builtin-cli-smoke-')))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
const skillLibraryRoot = join(fixtureRoot, 'skill-library')
const historyMarker = 'ROVAI_BUILTIN_HISTORY_V1'
const historyPublicA2aMarker = 'ROVAI_BUILTIN_HISTORY_PUBLIC_A2A_V1'
const historyAttachmentMarker = 'ROVAI_BUILTIN_HISTORY_ATTACHMENT_V1'
const historySeedCompletionMarker = 'ROVAI_BUILTIN_HISTORY_SEED_OK'
const expectedOperations = [
  'camp.list',
  'camp.message.send',
  'camp.read',
  'camp.search',
  'history.search',
  'member.create',
  'memory.read',
  'memory.search',
  'memory.view',
  'memory.write',
  'team.create_task',
  'team.gather',
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
  ['qwen-code', 'Qwen'],
  ['trae-cn-cli', 'TRAE'],
  ['kimi-code-cli', 'Kimi Code']
].map(([adapterKind, label]) => ({ adapterKind, label, slug: adapterKind.replaceAll('-', '_') }))
const defaultRuntimeSpecifications = allRuntimeSpecifications.filter(
  (specification) => specification.adapterKind !== 'kimi-code-cli'
)
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
    assertBuiltinCliCapability(specification.adapterKind, specification.installation, true)
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
    campId: historyCampId,
    scriptPath: historySeedScriptPath,
    evidencePath: historySeedEvidencePath,
    marker: historyPublicA2aMarker,
    completionMarker: historySeedCompletionMarker
  })

  const historyAttachmentSourcePath = join(projectRoot, 'historical-attachment.txt')
  await writeFile(
    historyAttachmentSourcePath,
    `${historyAttachmentMarker}: attachment content stays outside Agent output.\n`,
    { mode: 0o600 }
  )
  const historicalAttachment = await createHistoricalAttachmentMessage(core.request, {
    campId: historyCampId,
    sourcePath: historyAttachmentSourcePath,
    marker: historyAttachmentMarker
  })

  for (const specification of runtimeSpecifications) {
    specification.currentMarker = `ROVAI_CURRENT_${specification.slug.toUpperCase()}_V1`
    specification.successMarker = `ROVAI_BUILTIN_CLI_${specification.slug.toUpperCase()}_OK`
    specification.resumeMarker = `ROVAI_BUILTIN_CLI_${specification.slug.toUpperCase()}_RESUME_OK`
    specification.gatherMarker = `ROVAI_GATHER_${specification.slug.toUpperCase()}_RETURN_OK`
    specification.contextPathFile = join(projectRoot, `.context-path-${specification.slug}`)
    specification.resumeContextPathFile = join(projectRoot, `.resume-context-path-${specification.slug}`)
    specification.resumeCompletionFile = join(projectRoot, `.resume-complete-${specification.slug}`)
    specification.sendEvidencePath = join(projectRoot, `.send-evidence-${specification.slug}.json`)
    specification.diagnosticPath = join(projectRoot, `.diagnostic-${specification.slug}`)
    specification.memberCreationKey = crypto.randomUUID()
    specification.memberDisplayName = `${specification.label} Created Member`
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
    process.stderr.write(`\n[builtin-cli] ${specification.adapterKind}: full 15-operation Run\n`)
    const source = await startVerificationRun(core, specification, false)
    const sourceSnapshot = await waitForRun(core, specification.campId, source.agentRunId, {
      marker: specification.successMarker,
      timeoutMs: 720_000
    })
    const sourceManifest = sourceSnapshot.contextManifests.find((manifest) =>
      manifest.agentRunId === source.agentRunId
    )
    if (specification.campId === historyCampId
        || !sourceManifest
        || !sourceManifest.historyCamps.some((camp) => camp.campId === historyCampId)) {
      throw new Error(`${specification.adapterKind} did not freeze the historical Camp in the querying Run Manifest: ${JSON.stringify({
        queryingCampId: specification.campId,
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
      specification.campId,
      source.agentRunId
    )
    const terminalEvidence = evidence.filter((entry) =>
      entry.payload?.status === 'completed' || entry.payload?.status === 'failed'
    )
    const observedOperations = [...new Set(terminalEvidence.map((entry) => entry.payload?.canonicalTool))]
      .filter(Boolean)
      .sort()
    if (JSON.stringify(observedOperations) !== JSON.stringify(expectedOperations)) {
      throw new Error(`${specification.adapterKind} did not commit all canonical operations: ${JSON.stringify({
        observedOperations,
        evidence
      })}`)
    }
    const invalidEnvelopeEvidence = terminalEvidence.find((entry) => {
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
    const staleConflict = terminalEvidence.find((entry) =>
      entry.payload?.canonicalTool === 'team.update_task'
        && entry.payload?.status === 'failed'
        && entry.payload?.errorCode === 'task.version_conflict'
    )
    if (!staleConflict || terminalEvidence.some((entry) => entry.payload?.sourceAuthority !== 'core')) {
      throw new Error(`${specification.adapterKind} evidence did not prove the Core Router boundary`)
    }

    const recipientSnapshot = await waitForRecipientRun(
      core,
      specification,
      specification.recipientProfileId
    )
    const gatherResult = terminalEvidence.find((entry) =>
      entry.payload?.canonicalTool === 'team.gather'
        && entry.payload?.status === 'completed'
    )?.payload?.coreEnvelope?.result
    if (!gatherResult?.gatherId) {
      throw new Error(`${specification.adapterKind} Gather acceptance did not retain a gatherId`)
    }
    const gatherCompletion = await waitForGatherCompletion(
      core,
      specification,
      gatherResult.gatherId,
      source.agentRunId
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
    const sendEvidence = JSON.parse(await readFile(specification.sendEvidencePath, 'utf8'))
    const expectedSendMessageIds = new Set([
      sendEvidence.publicMessageId,
      sendEvidence.directUserOnlyMessageId,
      sendEvidence.stdinUserOnlyMessageId
    ])
    const successorExactReads = resumedEvidence.filter((entry) =>
      entry.payload?.canonicalTool === 'camp.read'
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
      gatherId: gatherResult.gatherId,
      gatherCompletionDeliveryId: gatherCompletion.completionDelivery.id,
      gatherCompletionRunId: gatherCompletion.completionRun.id,
      gatherCapturedReturnVerified: true,
      operations: observedOperations,
      fullRunEvidenceCount: evidence.length,
      agentOutputReduction: measureAgentOutputReduction(evidence),
      legacySendFlagRejected: true,
      legacySendJsonRejected: true,
      sendInputSources: ['direct_flags', 'stdin', 'input_file'],
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
    contractVersion: 17,
    ipcProtocolVersion: 2,
    runtimeCount: results.length,
    operationCountPerRuntime: expectedOperations.length,
    expectedOperations,
    historyEvidence: {
      campId: historyCampId,
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
      || !snapshot.capabilities.includes('builtin_cli.transport.v20')
      || !snapshot.models.length) {
    throw new Error(`${label} is not ready for Built-in CLI v20: ${JSON.stringify(snapshot)}`)
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
    execution: input.execution
  })
}

async function seedHistoricalPublicA2a(coreClient, input) {
  const sent = await sendCampMessage(coreClient.request, {
    campId: input.campId,
    agentId: input.specification.agentId,
    body: [
      'Run the generated historical Public A2A seed script with your native shell tool.',
      'The Runtime process already has the real ROVAI_AGENT_CLI, ROVAI_CLI_CONTEXT, and ROVAI_RUN_TMP lease environment.',
      'Do not modify or replace the script.',
      `/bin/bash ${JSON.stringify(input.scriptPath)}`,
      `After it exits 0, reply with exactly ${input.completionMarker}.`
    ].join('\n'),
    execution: {
      taskId: null,
      purpose: 'Create one historical Public A2A through the real Built-in CLI and Message Delivery path.',
      completionRole: 'required'
    }
  })
  const commandResult = sent.commandResult ?? sent
  const agentRunId = commandResult.payload?.agentRunIds?.[0]
  if (commandResult.status !== 'accepted' || !agentRunId) {
    throw new Error(`Historical Public A2A seed Run was not accepted: ${JSON.stringify(sent)}`)
  }
  const snapshot = await waitForRun(coreClient, input.campId, agentRunId, {
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
    event.eventType === 'camp_message.public_a2a_sent'
      && event.entityId === messageId
  )
  if (message?.body !== input.marker
      || message.sourceAgentRunId !== agentRunId
      || !delivery
      || !publication) {
    throw new Error(`Historical Public A2A did not traverse Message Delivery and publication: ${JSON.stringify({
      agentRunId,
      messageId,
      message,
      delivery,
      publication
    })}`)
  }
  return { messageId, deliveryId: delivery.id, sourceAgentRunId: agentRunId }
}

async function createHistoricalAttachmentMessage(request, input) {
  const draft = await request('camp.composerDraft.get', { campId: input.campId })
  const prepared = await request('camp.attachments.prepareFromPath', {
    campId: input.campId,
    expectedRevision: draft.revision,
    sourcePath: input.sourcePath,
    displayName: 'historical-attachment.txt'
  })
  const attachment = prepared.attachments?.[0]
  if (prepared.attachments?.length !== 1
      || attachment?.state !== 'ready'
      || attachment?.previewKind !== 'none') {
    throw new Error(`Historical attachment preparation failed: ${JSON.stringify(prepared)}`)
  }
  const saved = await request('camp.composerDraft.save', {
    campId: input.campId,
    expectedRevision: prepared.revision,
    content: [{ kind: 'text', text: input.marker }]
  })
  await request('camp.messages.send', {
    commandId: crypto.randomUUID(),
    campId: input.campId,
    draftRevision: saved.revision,
    execution: null
  })
  const snapshot = await request('camps.snapshot', { campId: input.campId })
  const message = snapshot.messages.find((candidate) =>
    candidate.body === input.marker
      && candidate.attachments?.some((candidateAttachment) => candidateAttachment.id === attachment.id)
  )
  const projectedAttachment = message?.attachments?.find((candidate) => candidate.id === attachment.id)
  if (!message
      || projectedAttachment?.kind !== 'file'
      || projectedAttachment.fileCount !== 1) {
    throw new Error(`Historical attachment message was not persisted with its public shape: ${JSON.stringify({
      attachment,
      message
    })}`)
  }
  return { messageId: message.id, attachmentId: attachment.id }
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
        'Avatar: none (use the product default).'
      ]
  const body = specification.adapterKind === 'kimi-code-cli'
    ? [
        'This is an automated Built-in CLI qualification. Act immediately; do not plan, inspect files, or explain.',
        ...confirmedMemberCard,
        'Use the Bash tool exactly once to run:',
        `/bin/bash ${JSON.stringify(scriptPath)}`,
        'If it exits 0, reply with exactly its final output line. That line is intentionally absent from this request; do not guess it. Do not call any other tool.'
      ].join('\n')
    : [
        'Run the local repository Built-in CLI transport qualification.',
        'The script was generated by this test and the Runtime process already has ROVAI_AGENT_CLI, ROVAI_CLI_CONTEXT, and ROVAI_RUN_TMP injected.',
        ...confirmedMemberCard,
        'You may inspect the script if your Runtime requires that before execution; do not modify or replace it.',
        'Use your native bash/shell tool to run:',
        `/bin/bash ${JSON.stringify(scriptPath)}`,
        `If it exits 0 and prints ${marker}, reply with exactly ${marker}.`
      ].join('\n')
  const sent = await sendCampMessage(coreClient.request, {
    campId: specification.campId,
    agentId: specification.agentId,
    body,
    execution: {
      taskId: null,
      purpose: resumed
        ? `Verify ${specification.adapterKind} resume/process reuse receives a new active CLI lease.`
        : `Verify ${specification.adapterKind} executes all 15 CLI-only built-in operations.`,
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

async function waitForGatherCompletion(coreClient, specification, gatherId, sourceAgentRunId) {
  const deadline = Date.now() + 720_000
  const resolvedApprovals = new Set()
  while (Date.now() < deadline) {
    const snapshot = await coreClient.request('camps.snapshot', { campId: specification.campId })
    const gatherDeliveries = snapshot.messageDeliveries.filter((delivery) =>
      delivery.gatherId === gatherId
    )
    const completionDeliveries = gatherDeliveries.filter((delivery) =>
      delivery.deliveryKind === 'gather_completion'
    )
    if (completionDeliveries.length > 1) {
      throw new Error(`${specification.adapterKind} Gather created duplicate completion Deliveries`)
    }
    const completionDelivery = completionDeliveries[0]
    const completionRun = completionDelivery?.targetAgentRunId
      ? snapshot.agentRuns.find((run) => run.id === completionDelivery.targetAgentRunId)
      : null
    // A normal public A2A Delivery from the source verification can already occupy
    // the recipient FIFO before the Gather forward is materialized. Resolve that
    // recipient's bounded Runtime approvals too, otherwise the Gather Delivery can
    // remain queued behind a waiting Run that is not itself Gather-associated yet.
    for (const run of snapshot.agentRuns.filter((candidate) =>
      candidate.id === completionRun?.id
        || candidate.agentId === specification.recipientProfileId
        || gatherDeliveries.some((delivery) => delivery.targetAgentRunId === candidate.id)
    )) {
      await resolvePendingApprovals(coreClient.request, snapshot, run.id, resolvedApprovals)
    }
    if (completionRun && ['failed', 'cancelled', 'interrupted'].includes(completionRun.status)) {
      throw new Error(`${specification.adapterKind} Gather completion entered ${completionRun.status}`)
    }
    if (completionRun?.status === 'succeeded') {
      const completionRuns = snapshot.agentRuns.filter((run) =>
        run.invocationKind === 'gather_completion'
          && run.agentId === specification.agentId
          && run.conversationId === snapshot.agentRuns.find((candidate) => candidate.id === sourceAgentRunId)?.conversationId
      )
      const capturedReturns = gatherDeliveries.filter((delivery) =>
        delivery.deliveryKind === 'public_a2a'
          && delivery.dispatchDisposition === 'gather_captured'
      )
      const capturedMessages = capturedReturns.map((delivery) =>
        snapshot.messages.find((message) => message.id === delivery.messageId)
      )
      if (completionRuns.length !== 1
          || completionRun.invocationKind !== 'gather_completion'
          || capturedReturns.length < 1
          || !capturedMessages.some((message) => message?.body?.includes(specification.gatherMarker))) {
        throw new Error(`${specification.adapterKind} Gather did not prove captured return and one completion: ${JSON.stringify({
          gatherDeliveries,
          completionRuns,
          capturedMessages
        })}`)
      }
      return { snapshot, completionDelivery, completionRun }
    }
    await delay(400)
  }
  throw new Error(`${specification.adapterKind} Gather completion timed out`)
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
        agentAddressingMode: envelope.result.agentAddressingMode,
        effectiveRecipients: envelope.result.effectiveRecipients,
        deliveryIds: envelope.result.deliveryIds
      }
    case 'team.gather':
      return selectFields(envelope.result, [
        'gatherId',
        'requestMessageId',
        'effectiveRecipients',
        'completion'
      ])
    case 'memory.write':
      return envelope.result.outcome === 'effective'
        ? {
            outcome: 'effective',
            memoryId: envelope.result.memoryId,
            revisionId: envelope.result.revisionId
          }
        : {
            outcome: 'review_pending',
            reviewItemId: envelope.result.reviewItemId
          }
    case 'member.create':
      return envelope.result
    case 'team.create_task':
      return selectFields(envelope.result, ['taskId', 'title', 'status', 'assigneeAgentId', 'version', 'availableActions'])
    case 'team.update_task':
      return selectFields(envelope.result, ['taskId', 'title', 'status', 'assigneeAgentId', 'version', 'availableActions', 'changed'])
    case 'camp.list':
    case 'camp.read':
    case 'camp.search':
    case 'history.search':
    case 'memory.view':
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

function historyPublicationScript(input) {
  return `#!/bin/bash
set -euo pipefail

CLI="\${ROVAI_AGENT_CLI:?ROVAI_AGENT_CLI is required}"
CONTEXT="\${ROVAI_CLI_CONTEXT:?ROVAI_CLI_CONTEXT is required}"
RUN_TMP="\${ROVAI_RUN_TMP:?ROVAI_RUN_TMP is required}"
JQ="$(command -v jq)"
test -x "$CLI"
test -f "$CONTEXT"
test -d "$RUN_TMP"
test "$(stat -f '%Lp' "$CONTEXT")" = "600"

public_send="$("$CLI" send --to ${shellQuote(input.recipientProfileId)} --body ${shellQuote(input.marker)})"
printf '%s\n' "$public_send" | "$JQ" -e --arg recipient ${shellQuote(input.recipientProfileId)} '
  (keys | sort) == ["agentAddressingMode", "deliveryIds", "effectiveRecipients", "messageId"]
  and .agentAddressingMode == "automatic"
  and .effectiveRecipients == [$recipient]
  and (.deliveryIds | length) == 1
' >/dev/null
printf '%s\n' "$public_send" | "$JQ" -er '.messageId' > ${shellQuote(input.evidencePath)}
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
    `jq -n --arg messageId "${messageIdExpression}" '{mode:"item",messageId:$messageId}'`
  const memoryWrite = JSON.stringify({
    action: 'add',
    scope: 'companion',
    kind: 'preference',
    body: `Remember that ${input.adapterKind} completed Built-in CLI transport v17 qualification.`,
    retrievalKeys: [`cli-${input.slug.slice(0, 18)}`]
  })
  const hearth = JSON.stringify({
    action: 'add',
    scope: 'hearth',
    kind: 'lesson',
    body: `The ${input.adapterKind} Runtime can invoke Rovai built-ins only through the local CLI.`,
    retrievalKeys: [`hearth-${input.slug.slice(0, 14)}`]
  })
  const publicSend = JSON.stringify({
    body: `Publish exactly one important-result notification with rovai send --public-only --to-principal --body 'ROVAI_PUBLIC_A2A_${input.slug.toUpperCase()}_RESULT', then finish. Do not route to any Agent.`,
    to: [input.recipientProfileId]
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
"$CLI" --version | grep -q 'contract-v20 ipc-v2'

STEP=exact_help
root_help="$("$CLI" --help)"
printf '%s\n' "$root_help" | grep -Fq ${shellQuote("Run an Agent operation's exact `--help` for its closed inputs. Each Agent operation supports direct flags, JSON stdin/heredoc, or --input-file <path>.")}
send_help="$("$CLI" send --help)"
printf '%s\n' "$send_help" | grep -Fq -- '--public-only'
printf '%s\n' "$send_help" | grep -Fq -- '--to-principal'
if printf '%s\n' "$send_help" | grep -Fq -- '--to-user'; then
  exit 1
fi
printf '%s\n' "$send_help" | grep -Fq -- 'Ordinary public Camp messages are already visible to the Principal.'
printf '%s\n' "$send_help" | grep -Fq -- 'Guarantee that this public message wakes no Agent.'
printf '%s\n' "$send_help" | grep -Fq -- 'Agent addressing schedules concrete continuing work, not CC.'
printf '%s\n' "$send_help" | grep -Fq -- 'Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds.'
printf '%s\n' "$send_help" | grep -Fq -- 'Principal attention is message-local and is never inherited'
printf '%s\n' "$send_help" | grep -Fq -- "rovai send --public-only --body 'Final conclusion: the failure is a client-version regression.'"
printf '%s\n' "$send_help" | grep -Fq -- "rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'"
printf '%s\n' "$send_help" | grep -Fq -- "rovai send --public-only --to-principal --body 'Please choose whether to roll back the client or continue the token investigation.'"
gather_help="$("$CLI" gather --help)"
printf '%s\n' "$gather_help" | grep -Eq -- '--to[[:space:]]+field=to type=array repeatable'
printf '%s\n' "$gather_help" | grep -Fq -- 'Gather is asynchronous.'
printf '%s\n' "$gather_help" | grep -Fq -- 'Do not poll, repeat Gather, or wait synchronously'
member_help="$("$CLI" member create --help)"
printf '%s\n' "$member_help" | grep -Fq -- '--creation-key'
printf '%s\n' "$member_help" | grep -Fq -- '--avatar-file'
printf '%s\n' "$member_help" | grep -Fq -- 'user explicitly confirms'
camp_search_help="$("$CLI" camp search --help)"
printf '%s\n' "$camp_search_help" | grep -Fq -- "rovai camp search --query 'amount'"
printf '%s\n' "$camp_search_help" | grep -Fq -- "rovai camp search --camp-id '<camp-id>' --query 'amount'"
camp_read_help="$("$CLI" camp read --help)"
printf '%s\n' "$camp_read_help" | grep -Fq -- 'Default behavior:'
printf '%s\n' "$camp_read_help" | grep -Fq -- '--mode timeline --direction before --limit 20'
printf '%s\n' "$camp_read_help" | grep -Fq -- "rovai camp read --camp-id '<camp-id>'"
printf '%s\n' "$camp_read_help" | grep -Fq -- "rovai camp read --mode item --message-id '<message-id>'"
printf '%s\n' "$camp_read_help" | grep -Fq -- "rovai camp read --camp-id '<camp-id>' --mode item --message-id '<message-id>'"
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
legacy_json="$(printf '%s\n' '{"campId":"camp-legacy","body":"rejected"}' | "$CLI" send 2>"$RUN_TMP/legacy-json.err")"
legacy_json_status=$?
set -e
test "$legacy_json_status" -eq 1
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
STEP=camp_search_explicit_current
camp_search_explicit_current="$("$CLI" camp search --camp-id ${shellQuote(input.campId)} --query ${shellQuote(input.currentMarker)} --limit 5)"
assert_success "$camp_search_explicit_current" 'camp.search'
test "$(printf '%s\n' "$camp_search_explicit_current" | "$JQ" -er '.results[0].messageId')" = "$message_id"
STEP=camp_read_default_current
camp_read_default_current="$("$CLI" camp read </dev/null)"
assert_success "$camp_read_default_current" 'camp.read'
printf '%s\n' "$camp_read_default_current" | "$JQ" -e --arg campId ${shellQuote(input.campId)} --arg messageId "$message_id" '
  .campId == $campId
  and .mode == "timeline"
  and .direction == "before"
  and (.items | any(.messageId == $messageId))
' >/dev/null
STEP=camp_read_default_explicit
camp_read_default_explicit="$("$CLI" camp read --camp-id ${shellQuote(input.campId)})"
assert_success "$camp_read_default_explicit" 'camp.read'
printf '%s\n' "$camp_read_default_explicit" | "$JQ" -e --arg messageId "$message_id" '
  .mode == "timeline"
  and .direction == "before"
  and (.items | any(.messageId == $messageId))
' >/dev/null
STEP=camp_read_default_stdin
camp_read_default_stdin="$(printf '%s\n' ${shellQuote(JSON.stringify({ campId: input.campId, limit: 5 }))} | "$CLI" camp read)"
assert_success "$camp_read_default_stdin" 'camp.read'
printf '%s\n' "$camp_read_default_stdin" | "$JQ" -e '.mode == "timeline" and .direction == "before"' >/dev/null
cat > "$RUN_TMP/camp-read-default.json" <<'ROVAI_JSON'
${JSON.stringify({ campId: input.campId, direction: 'after', limit: 5 })}
ROVAI_JSON
STEP=camp_read_default_input_file
camp_read_default_input_file="$("$CLI" camp read --input-file "$RUN_TMP/camp-read-default.json")"
assert_success "$camp_read_default_input_file" 'camp.read'
printf '%s\n' "$camp_read_default_input_file" | "$JQ" -e '.mode == "timeline" and .direction == "after"' >/dev/null
STEP=camp_read
${campRead('$message_id')} > "$RUN_TMP/camp-read.json"
camp_read="$("$CLI" camp read --input-file "$RUN_TMP/camp-read.json")"
assert_success "$camp_read" 'camp.read'
printf '%s\n' "$camp_read" | "$JQ" -e --arg campId ${shellQuote(input.campId)} --arg messageId "$message_id" '.campId == $campId and .items[0].messageId == $messageId' >/dev/null

STEP=history_search_public_a2a
history_search="$("$CLI" history search --query ${shellQuote(input.historyPublicA2aMarker)} --limit 5)"
assert_success "$history_search" 'history.search'
printf '%s\n' "$history_search" | "$JQ" -e \
  --arg campId ${shellQuote(input.historyCampId)} \
  --arg messageId ${shellQuote(input.historyPublicA2aMessageId)} \
  '.results | any(.campId == $campId and .messageId == $messageId)' >/dev/null
STEP=camp_search_historical_public_a2a
camp_search_historical="$("$CLI" camp search --camp-id ${shellQuote(input.historyCampId)} --query ${shellQuote(input.historyPublicA2aMarker)} --limit 5)"
assert_success "$camp_search_historical" 'camp.search'
printf '%s\n' "$camp_search_historical" | "$JQ" -e --arg campId ${shellQuote(input.historyCampId)} --arg messageId ${shellQuote(input.historyPublicA2aMessageId)} '
  .results | any(.campId == $campId and .messageId == $messageId and (has("campTitle") | not))
' >/dev/null
STEP=camp_read_historical_public_a2a
camp_read_historical="$("$CLI" camp read --camp-id ${shellQuote(input.historyCampId)} --mode item --message-id ${shellQuote(input.historyPublicA2aMessageId)})"
assert_success "$camp_read_historical" 'camp.read'
printf '%s\n' "$camp_read_historical" | "$JQ" -e \
  --arg campId ${shellQuote(input.historyCampId)} \
  --arg messageId ${shellQuote(input.historyPublicA2aMessageId)} \
  --arg body ${shellQuote(input.historyPublicA2aMarker)} '
  .campId == $campId
  and .items[0].messageId == $messageId
  and .items[0].authorType == "agent"
  and .items[0].body == $body
' >/dev/null

STEP=camp_search_historical_attachment
camp_search_historical_attachment="$("$CLI" camp search --camp-id ${shellQuote(input.historyCampId)} --query ${shellQuote(input.historyAttachmentMarker)} --limit 5)"
assert_success "$camp_search_historical_attachment" 'camp.search'
printf '%s\n' "$camp_search_historical_attachment" | "$JQ" -e --arg messageId ${shellQuote(input.historyAttachmentMessageId)} '
  .results | any(.messageId == $messageId and (has("campTitle") | not))
' >/dev/null
STEP=camp_read_historical_attachment
camp_read_historical_attachment="$("$CLI" camp read --camp-id ${shellQuote(input.historyCampId)} --mode item --message-id ${shellQuote(input.historyAttachmentMessageId)})"
assert_success "$camp_read_historical_attachment" 'camp.read'
printf '%s\n' "$camp_read_historical_attachment" | "$JQ" -e \
  --arg campId ${shellQuote(input.historyCampId)} \
  --arg messageId ${shellQuote(input.historyAttachmentMessageId)} \
  --arg attachmentId ${shellQuote(input.historyAttachmentId)} \
  --arg body ${shellQuote(input.historyAttachmentMarker)} '
  .campId == $campId
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
  and (.items[0].attachments[0].mediaType | startswith("text/plain"))
' >/dev/null

cat > "$RUN_TMP/public-send.json" <<'ROVAI_JSON'
${publicSend}
ROVAI_JSON
STEP=camp_message_send
public_send="$("$CLI" send --input-file "$RUN_TMP/public-send.json")"
assert_success "$public_send" 'camp.message.send'
printf '%s\n' "$public_send" | "$JQ" -e --arg recipient ${shellQuote(input.recipientProfileId)} '
  (keys | sort) == ["agentAddressingMode", "deliveryIds", "effectiveRecipients", "messageId"]
  and .agentAddressingMode == "automatic"
  and .effectiveRecipients == [$recipient]
  and (.deliveryIds | length) == 1
' >/dev/null
public_message_id="$(printf '%s\n' "$public_send" | "$JQ" -er '.messageId')"

STEP=team_gather
gather_result="$("$CLI" gather \
  --to ${shellQuote(input.recipientProfileId)} \
  --body ${shellQuote(`Run rovai send --to ${input.agentId} --body '${input.gatherMarker}' exactly once, then finish.`)})"
assert_success "$gather_result" 'team.gather'
printf '%s\n' "$gather_result" | "$JQ" -e --arg recipient ${shellQuote(input.recipientProfileId)} '
  (keys | sort) == ["completion", "effectiveRecipients", "gatherId", "requestMessageId"]
  and .completion == "deferred"
  and .effectiveRecipients == [$recipient]
' >/dev/null
gather_id="$(printf '%s\n' "$gather_result" | "$JQ" -er '.gatherId')"

STEP=camp_message_send_direct_public_only_principal
user_only="$("$CLI" send --public-only --to-principal --body ${shellQuote(`Direct Principal decision ${input.adapterKind}`)})"
assert_success "$user_only" 'camp.message.send'
printf '%s\n' "$user_only" | "$JQ" -e '
  (keys | sort) == ["agentAddressingMode", "deliveryIds", "effectiveRecipients", "messageId"]
  and .agentAddressingMode == "public_only"
  and .effectiveRecipients == []
  and .deliveryIds == []
' >/dev/null
user_only_id="$(printf '%s\n' "$user_only" | "$JQ" -er '.messageId')"

STEP=camp_message_send_stdin_public_only_principal
stdin_user_only="$(printf '%s\n' ${shellQuote(JSON.stringify({ body: `Stdin Principal decision ${input.adapterKind}`, mentionUser: true, publicOnly: true }))} | "$CLI" send)"
assert_success "$stdin_user_only" 'camp.message.send'
printf '%s\n' "$stdin_user_only" | "$JQ" -e '
  .agentAddressingMode == "public_only"
  and .effectiveRecipients == []
  and .deliveryIds == []
' >/dev/null
stdin_user_only_id="$(printf '%s\n' "$stdin_user_only" | "$JQ" -er '.messageId')"

STEP=freeze_send_locators
"$JQ" -n \
  --arg publicMessageId "$public_message_id" \
  --arg directUserOnlyMessageId "$user_only_id" \
  --arg stdinUserOnlyMessageId "$stdin_user_only_id" \
  --arg gatherId "$gather_id" \
  '{publicMessageId:$publicMessageId,directUserOnlyMessageId:$directUserOnlyMessageId,stdinUserOnlyMessageId:$stdinUserOnlyMessageId,gatherId:$gatherId}' \
  > ${shellQuote(input.sendEvidencePath)}

cat > "$RUN_TMP/memory-write.json" <<'ROVAI_JSON'
${memoryWrite}
ROVAI_JSON
STEP=memory_write
memory_write="$("$CLI" memory write --input-file "$RUN_TMP/memory-write.json")"
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
hearth_result="$("$CLI" memory write --input-file "$RUN_TMP/hearth.json")"
assert_success "$hearth_result" 'memory.write'
printf '%s\n' "$hearth_result" | "$JQ" -e '
  (keys | sort) == ["outcome", "reviewItemId"]
  and .outcome == "review_pending"
  and (.reviewItemId | type) == "string"
' >/dev/null

STEP=complete
trap - EXIT
printf '%s\n' ${shellQuote(JSON.stringify({
    ok: true,
    marker: input.successMarker,
    operationCount: 15,
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
    and .items[0].addressing.mentionsCurrentUser == false
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
  const child = spawn(coreExecutable, [
    ...coreDataDirectoryArguments(dataDirectory),
    '--skill-library-root', skillLibraryRoot
  ], {
    cwd: root,
    env: process.env,
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
