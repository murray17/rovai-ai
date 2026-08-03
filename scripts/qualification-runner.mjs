import { appendFile, chmod, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { arch, homedir, platform, release, tmpdir, type as osType } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  QUALIFICATION_RUNNER_VERSION,
  acquireExclusiveFile,
  atomicWriteJson,
  canonicalJson,
  copyFixture,
  digestFile,
  digestJson,
  ensurePrivateDirectory,
  makeTemporaryDirectory,
  readCaseContract,
  removeTemporaryDirectory,
  runCaptured,
  runCaseVerifier,
  sha256,
  treeDiff,
  treeManifest,
  verifyStoredCaseSeal
} from './lib/qualification-common.mjs'
import {
  assertExecutable,
  descendantsOf,
  findCompetingRovaiProcesses,
  processTable,
  startQualificationCore,
  waitForProcessesToExit
} from './lib/qualification-core.mjs'
import {
  deriveCollaborationEvidence,
  evaluateCollaborationContract,
  extractEvidenceIdentity
} from './lib/qualification-collaboration.mjs'

const root = resolve(import.meta.dirname, '..')
const arguments_ = parseArguments(process.argv.slice(2))

async function runTrial(options) {
  const trialId = options.trialId ?? crypto.randomUUID()
  const startedAt = new Date().toISOString()
  let dispatchAccepted = false
  let core = null
  let coreStop = null
  let lock = null
  let evidenceDirectory = null
  let temporaryRoot = null
  let workspacePath = null
  let runtimeCacheDirectory = null
  let baselineManifest = null
  let dispatchBaselineManifest = null
  let managedProjectionDiff = null
  let finalManifest = null
  let finalDiff = null
  let finalSnapshot = null
  let verifier = null
  let environmentManifest = null
  let caseRecord = null
  let budgetEvent = null
  let termination = null
  let dispatchBoundary = null
  let postDispatchError = null
  let competingProcesses = []
  let childPids = []
  let observationDigest = null

  const evidenceRoot = await ensurePrivateDirectory(options.evidenceRoot)
  evidenceDirectory = join(evidenceRoot, trialId)
  await mkdir(evidenceDirectory, { mode: 0o700 })
  await chmod(evidenceDirectory, 0o700)
  lock = await acquireExclusiveFile(join(evidenceDirectory, '.active'))
  const lifecyclePath = join(evidenceDirectory, 'lifecycle.ndjson')
  const observationPath = join(evidenceDirectory, 'observations.ndjson')
  const appendLifecycle = async (state, detail = {}) => {
    await appendPrivateLine(lifecyclePath, {
      schemaVersion: 1,
      state,
      occurredAt: new Date().toISOString(),
      ...detail
    })
  }
  await appendLifecycle('planned', { trialId, mode: options.mode })

  try {
    await appendLifecycle('preflighting')
    caseRecord = await verifyStoredCaseSeal(options.caseDirectory, options.expectedSeal)
    if (options.mode === 'formal' && caseRecord.contract.manifest.visibility !== 'formal') {
      throw new Error('formal mode requires a sealed private formal case')
    }
    if (options.mode === 'demo' && caseRecord.contract.manifest.visibility !== 'demo') {
      throw new Error('demo mode requires a public demo case')
    }
    await assertExecutable(options.coreExecutable)
    if (options.mode === 'formal' && !isPackagedCore(options.coreExecutable)) {
      throw new Error('formal mode requires the packaged Rovai-ai Release Core')
    }
    competingProcesses = await findCompetingRovaiProcesses()
    if (competingProcesses.length > 0) {
      throw new Error(`a Rovai App/Core is already running: ${competingProcesses.map((item) => item.pid).join(',')}`)
    }
    temporaryRoot = await makeTemporaryDirectory(`rovai-qualification-${caseRecord.contract.manifest.id}-`)
    const dataDirectory = join(temporaryRoot, 'data')
    runtimeCacheDirectory = join(temporaryRoot, 'runtime-cache')
    workspacePath = join(temporaryRoot, 'workspace')
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
    await mkdir(runtimeCacheDirectory, { recursive: true, mode: 0o700 })
    await copyFixture(caseRecord.contract.fixturePath, workspacePath)
    baselineManifest = await treeManifest(workspacePath)
    if (baselineManifest.digest !== caseRecord.contract.fixture.digest) {
      throw new Error('materialized fixture does not match the sealed baseline')
    }
    await initializeBaselineGit(workspacePath)
    await appendLifecycle('materialized', { baselineTreeDigest: baselineManifest.digest })

    core = startQualificationCore({
      coreExecutable: options.coreExecutable,
      dataDirectory,
      antigravityTeamPrivateDirectory: options.antigravityTeamPrivateDirectory,
      workingDirectory: root,
      runtimeCacheDirectory
    })
    await core.request('health.check', {}, 120_000)
    const configured = await configureFrozenTeam(core.request)
    environmentManifest = await collectEnvironmentManifest({
      core,
      options,
      caseRecord,
      configured,
      workspacePath
    })
    await atomicWriteJson(join(evidenceDirectory, 'environment-manifest.json'), environmentManifest)
    await appendLifecycle('preflight_ready', {
      environmentManifestDigest: digestJson(environmentManifest),
      caseSeal: caseRecord.seal
    })

    const createResult = await core.request('camps.create', {
      commandId: crypto.randomUUID(),
      name: `Qualification ${caseRecord.contract.manifest.id}`,
      workspace: { projectPath: workspacePath },
      memberAgentProfileIds: FROZEN_TEAM.map((member) => member.agentProfileId),
      defaultLeadAgentProfileId: 'agent-luoke',
      collaborationMode: 'peer'
    })
    const campId = createResult.payload?.campId
    if (createResult.status !== 'applied' || !campId) {
      throw new Error(`qualification Camp creation failed: ${JSON.stringify(createResult)}`)
    }
    const reconciliation = await core.request('skills.reconcile', {
      commandId: crypto.randomUUID(),
      command: {}
    })
    if (reconciliation.status !== 'applied') {
      throw new Error(`qualification skill projection failed: ${JSON.stringify(reconciliation)}`)
    }
    dispatchBaselineManifest = await treeManifest(workspacePath)
    managedProjectionDiff = treeDiff(baselineManifest, dispatchBaselineManifest)
    const unexpectedPredispatchChanges = managedProjectionDiff.changed.filter((change) => (
      change.path !== '.agent'
      && !change.path.startsWith('.agent/')
      && change.path !== '.agents'
      && !change.path.startsWith('.agents/')
      && change.path !== '.claude'
      && !change.path.startsWith('.claude/')
      && change.path !== '.gemini'
      && !change.path.startsWith('.gemini/')
    ))
    if (unexpectedPredispatchChanges.length > 0) {
      throw new Error(`pre-dispatch workspace changed outside managed Runtime projections: ${JSON.stringify(unexpectedPredispatchChanges)}`)
    }
    const commandId = crypto.randomUUID()
    const dispatchedAtMonotonic = performance.now()
    const dispatchResponse = await core.request('camp.messages.send', {
      commandId,
      body: caseRecord.contract.prompt,
      campId,
      address: { mode: 'default' },
      replyToCampMessageId: null,
      execution: {
        taskId: null,
        purpose: 'Complete the user-requested change in the bound workspace.',
        expectedOutput: 'A verified implementation satisfying the stated acceptance constraints.',
        completionRole: 'required'
      }
    })
    const commandResult = dispatchResponse.commandResult ?? dispatchResponse
    if (commandResult.status !== 'accepted') {
      throw new Error(`qualification dispatch was not accepted: ${JSON.stringify(commandResult)}`)
    }
    dispatchAccepted = true
    dispatchBoundary = {
      schemaVersion: 1,
      commandId,
      acceptedAt: new Date().toISOString(),
      requestBodyDigest: sha256(caseRecord.contract.prompt),
      campId,
      campTurnId: commandResult.payload.campTurnId,
      rootAgentRunId: commandResult.payload.agentRunIds?.[0] ?? null,
      commandResultDigest: digestJson(commandResult)
    }
    await atomicWriteJson(join(evidenceDirectory, 'dispatch-boundary.json'), dispatchBoundary)
    await appendLifecycle('dispatched', {
      campId: dispatchBoundary.campId,
      campTurnId: dispatchBoundary.campTurnId,
      rootAgentRunId: dispatchBoundary.rootAgentRunId
    })
    await appendLifecycle('observing')

    const observation = await observeTrial({
      core,
      campId: dispatchBoundary.campId,
      campTurnId: dispatchBoundary.campTurnId,
      rootAgentRunId: dispatchBoundary.rootAgentRunId,
      budget: caseRecord.contract.manifest.budget,
      startedAtMonotonic: dispatchedAtMonotonic,
      observationPath
    })
    finalSnapshot = observation.snapshot
    budgetEvent = observation.budgetEvent
    observationDigest = observation.observationDigest
    if (budgetEvent) await appendLifecycle('stopping', budgetEvent)
    await appendLifecycle('runtime_termination_requested')
  } catch (error) {
    if (dispatchAccepted) postDispatchError = serializeError(error)
    else {
      const invalid = await finishInvalid({
        trialId,
        options,
        startedAt,
        error,
        evidenceDirectory,
        lifecyclePath,
        caseRecord,
        environmentManifest
      })
      if (core) {
        const table = await processTable().catch(() => [])
        childPids = descendantsOf(table, core.pid)
        coreStop = await core.stop().catch((stopError) => ({ error: serializeError(stopError) }))
        await waitForProcessesToExit(childPids, 30_000).catch(() => childPids)
      }
      await lock?.release()
      if (temporaryRoot) await removeTemporaryDirectory(temporaryRoot)
      return invalid
    }
  }

  try {
    // Freeze the delivered workspace while the qualification Core still owns its
    // managed Runtime projections. Core shutdown intentionally removes those
    // projections; observing the tree afterwards can misattribute that cleanup
    // to the Agent and produce a false change-boundary failure.
    finalManifest = await treeManifest(workspacePath)
    if (core) {
      const table = await processTable().catch(() => [])
      childPids = descendantsOf(table, core.pid)
      coreStop = await core.stop().catch((error) => ({ error: serializeError(error) }))
      const lingering = await waitForProcessesToExit(childPids, 30_000)
      termination = {
        schemaVersion: 1,
        core: sanitizeCoreStop(coreStop),
        observedChildPids: childPids,
        lingeringChildPids: lingering,
        converged: lingering.length === 0 && !coreStop?.error
      }
      if (lingering.length > 0) postDispatchError ??= {
        name: 'RuntimeTerminationError',
        message: `runtime descendants did not terminate: ${lingering.join(',')}`
      }
    }
    await appendLifecycle('runtimes_terminated', { converged: termination?.converged ?? false })
    finalDiff = treeDiff(dispatchBaselineManifest ?? baselineManifest, finalManifest)
    const verifierWorkspace = join(temporaryRoot, 'verifier-workspace')
    await copyFixture(workspacePath, verifierWorkspace)
    await appendLifecycle('verifying', { finalTreeDigest: finalManifest.digest })
    verifier = await runCaseVerifier(caseRecord.contract.verifierPath, verifierWorkspace, {
      env: { ...process.env, ROVAI_QUALIFICATION_VERIFIER_OFFLINE: '1' }
    }).catch((error) => ({ error: serializeError(error) }))
    await rm(verifierWorkspace, { recursive: true, force: true })
  } catch (error) {
    postDispatchError ??= serializeError(error)
  }

  const humanIntervention = detectPostDispatchHumanIntervention(finalSnapshot, dispatchBoundary)
  const orchestrationConvergence = evaluateOrchestrationConvergence({
    snapshot: finalSnapshot,
    dispatchBoundary,
    budgetEvent,
    termination,
    postDispatchError
  })
  const boundary = evaluateChangeBoundary(caseRecord.contract.manifest, finalDiff)
  const collaboration = deriveCollaborationEvidence(finalSnapshot, dispatchBoundary)
  const collaborationAudit = evaluateCollaborationContract(
    caseRecord.contract.manifest.collaboration,
    collaboration
  )
  const verifiedDelivery = verifier?.output?.verifiedDelivery === true && boundary.passed
  const overall = verifiedDelivery
    && orchestrationConvergence
    && !humanIntervention
    && collaborationAudit.passed
    ? 'pass'
    : 'fail'
  const resultBundle = {
    schemaVersion: 1,
    runnerVersion: QUALIFICATION_RUNNER_VERSION,
    trialId,
    mode: options.mode,
    case: {
      id: caseRecord.contract.manifest.id,
      version: caseRecord.contract.manifest.version,
      seal: caseRecord.seal,
      admissionDigest: caseRecord.admission.admissionDigest
    },
    startedAt,
    completedAt: new Date().toISOString(),
    validity: 'valid',
    verifiedDelivery,
    orchestrationConvergence,
    postDispatchHumanIntervention: humanIntervention,
    overall,
    dispatchBoundary,
    budget: {
      contract: caseRecord.contract.manifest.budget,
      event: budgetEvent,
      observedAgentRuns: finalSnapshot?.agentRuns?.length ?? 0,
      observedAcceptedA2a: finalSnapshot?.conversationInputs?.filter((input) => (
        input.kind === 'member_call' && input.campTurnId === dispatchBoundary?.campTurnId
      )).length ?? 0
    },
    environmentManifestDigest: environmentManifest ? digestJson(environmentManifest) : null,
    observationDigest,
    termination,
    baselineTreeDigest: baselineManifest?.digest ?? null,
    dispatchBaselineTreeDigest: dispatchBaselineManifest?.digest ?? null,
    managedProjectionDiff,
    finalTreeDigest: finalManifest?.digest ?? null,
    workspaceDiff: finalDiff,
    verifier: verifier?.output ?? { unavailable: true, error: verifier?.error ?? null },
    verifierProcess: verifier?.process ?? null,
    changeBoundary: boundary,
    collaborationEvidence: collaboration,
    collaborationAudit,
    postDispatchError
  }
  const redactedSummary = redactResult(resultBundle)
  await atomicWriteJson(join(evidenceDirectory, 'result.json'), resultBundle)
  await atomicWriteJson(join(evidenceDirectory, 'redacted-summary.json'), redactedSummary)
  await appendLifecycle(overall === 'pass' ? 'passed' : 'failed')
  await writeFile(join(evidenceDirectory, 'COMPLETE'), `${digestJson(resultBundle)}\n`, { mode: 0o600 })
  await lock?.release()
  if (temporaryRoot) await removeTemporaryDirectory(temporaryRoot)
  return { resultBundle, redactedSummary, evidenceDirectory }
}

async function configureFrozenTeam(request) {
  const teamStatus = await request('runtime.antigravityTeam.grantPermission', {}, 120_000)
  if (teamStatus.managedConfig !== 'ready' || teamStatus.permission !== 'ready') {
    throw new Error(`Antigravity 13-tool bundle is not ready: ${JSON.stringify(teamStatus)}`)
  }
  for (const adapterKind of ['codex-cli', 'opencode-cli', 'antigravity-app']) {
    await request('runtime.product.check', { runtimeKind: adapterKind }, 120_000)
  }
  const installations = await waitFor(async () => {
    const values = await request('runtime.installations.list')
    const selected = Object.fromEntries(['codex-cli', 'opencode-cli', 'antigravity-app'].map((kind) => [
      kind,
      values.find((candidate) => candidate.adapterKind === kind
        && candidate.installationClass === 'managed_default'
        && candidate.authScope === 'default')
    ]))
    return Object.values(selected).every((value) => value?.snapshot?.probeStatus === 'ready')
      && selected['antigravity-app'].snapshot.capabilities.includes('built_in_mcp_tool_parity.complete')
      ? selected
      : null
  }, 'frozen Runtime installations', 180_000)
  for (const member of FROZEN_TEAM) {
    const before = await request('agents.get', { agentProfileId: member.agentProfileId })
    const applied = await request('agents.runtime.set', {
      commandId: crypto.randomUUID(),
      command: {
        agentProfileId: member.agentProfileId,
        expectedVersion: before.version,
        adapterKind: member.adapterKind,
        model: member.model,
        permissions: member.permissions
      }
    }, 120_000)
    if (applied.status !== 'applied') throw new Error(`could not configure ${member.agentProfileId}: ${JSON.stringify(applied)}`)
  }
  const profiles = await request('agents.list')
  for (const member of FROZEN_TEAM) {
    const profile = profiles.find((candidate) => candidate.id === member.agentProfileId)
    if (!profile || profile.runtimeReadiness?.status !== 'ready'
        || profile.runtimeSelection?.adapterKind !== member.adapterKind
        || canonicalJson(profile.runtimePreference?.model) !== canonicalJson(member.model)
        || canonicalJson(profile.runtimePreference?.permissions) !== canonicalJson(member.permissions)) {
      throw new Error(`frozen member Runtime drifted: ${member.agentProfileId}`)
    }
  }
  return { teamStatus, installations, profiles }
}

async function collectEnvironmentManifest({ core, options, caseRecord, configured }) {
  const coreDigest = await digestFile(options.coreExecutable)
  const runnerFiles = [
    fileURLToPath(import.meta.url),
    join(root, 'scripts', 'lib', 'qualification-common.mjs'),
    join(root, 'scripts', 'lib', 'qualification-collaboration.mjs'),
    join(root, 'scripts', 'lib', 'qualification-core.mjs')
  ]
  const runnerDigest = digestJson(await Promise.all(runnerFiles.map(async (path) => ({ path: path.slice(root.length + 1), digest: await digestFile(path) }))))
  const gitHead = await runCaptured('git', ['rev-parse', 'HEAD'], { cwd: root })
  const gitStatus = await runCaptured('git', ['status', '--porcelain=v1'], { cwd: root })
  const toolchain = []
  for (const item of caseRecord.contract.manifest.toolchain ?? []) {
    const run = await runCaptured(item.command[0], item.command.slice(1), { cwd: root, timeoutMs: 30_000 })
    if (run.code !== 0) throw new Error(`toolchain preflight failed: ${item.name}`)
    toolchain.push({ name: item.name, outputDigest: sha256(run.stdout), version: run.stdout.trim().split('\n')[0] })
  }
  const runtimeInstallations = Object.values(configured.installations).map((installation) => ({
    adapterKind: installation.adapterKind,
    executablePath: installation.executablePath,
    reportedVersion: installation.snapshot.reportedVersion,
    executableFingerprint: installation.snapshot.executableFingerprint,
    probeStatus: installation.snapshot.probeStatus,
    capabilitiesDigest: digestJson(installation.snapshot.capabilities)
  }))
  const manifest = {
    schemaVersion: 1,
    runnerVersion: QUALIFICATION_RUNNER_VERSION,
    runnerDigest,
    mode: options.mode,
    collectedAt: new Date().toISOString(),
    productGit: {
      commit: gitHead.stdout.trim(),
      dirty: gitStatus.stdout.trim() !== '',
      statusDigest: sha256(gitStatus.stdout)
    },
    releaseCore: { digest: coreDigest, packaged: isPackagedCore(options.coreExecutable) },
    host: { platform: platform(), type: osType(), release: release(), architecture: arch(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    case: { id: caseRecord.contract.manifest.id, version: caseRecord.contract.manifest.version, seal: caseRecord.seal },
    team: configured.profiles.map((profile) => ({
      id: profile.id,
      handle: profile.handle,
      displayName: profile.displayName,
      teamRole: profile.teamRole,
      responsibilitiesDigest: sha256(profile.professionalResponsibilities),
      personalityTraits: profile.personalityTraits,
      workingPrinciplesDigest: sha256(profile.workingPrinciples),
      growthTopicDigest: sha256(profile.growthTopic),
      defaultCapabilities: profile.defaultCapabilities,
      runtimeSelection: profile.runtimeSelection,
      runtimePreference: profile.runtimePreference,
      readiness: profile.runtimeReadiness
    })),
    runtimeInstallations,
    antigravityTeam: configured.teamStatus,
    ambientMcpIsolation: 'preserved_uncontrolled',
    toolchain,
    usageObservation: { status: 'unavailable', reason: 'provider usage is not exposed consistently by all frozen Runtimes' }
  }
  manifest.teamRuntimeCompatibilityDigest = digestJson({
    runnerVersion: manifest.runnerVersion,
    runnerDigest: manifest.runnerDigest,
    productGit: manifest.productGit,
    releaseCore: manifest.releaseCore,
    host: manifest.host,
    team: manifest.team.map(({ runtimePreference, ...profile }) => ({
      ...profile,
      runtimePreference: runtimePreference
        ? Object.fromEntries(Object.entries(runtimePreference).filter(([key]) => key !== 'installationId'))
        : runtimePreference
    })),
    runtimeInstallations: manifest.runtimeInstallations,
    antigravityTeam: manifest.antigravityTeam,
    ambientMcpIsolation: manifest.ambientMcpIsolation
  })
  return manifest
}

async function observeTrial({ core, campId, campTurnId, rootAgentRunId, budget, startedAtMonotonic, observationPath }) {
  let budgetEvent = null
  let cancellationSent = false
  let terminalSince = null
  let lastDigest = null
  let observationHashInput = ''
  while (true) {
    const snapshot = await core.request('camps.snapshot', { campId }, 60_000)
    const normalized = normalizeSnapshot(snapshot)
    const digest = digestJson(normalized)
    if (digest !== lastDigest) {
      const record = { schemaVersion: 1, observedAt: new Date().toISOString(), digest, snapshot: normalized }
      const line = `${JSON.stringify(record)}\n`
      await appendFile(observationPath, line, { mode: 0o600 })
      observationHashInput += line
      lastDigest = digest
    }
    const elapsedSeconds = (performance.now() - startedAtMonotonic) / 1000
    const runs = snapshot.agentRuns.filter((run) => run.campTurnId === campTurnId)
    const acceptedA2a = snapshot.conversationInputs.filter((input) => (
      input.campTurnId === campTurnId && input.kind === 'member_call'
    )).length
    const turn = snapshot.turns.find((candidate) => candidate.id === campTurnId)
    const deliveryUnknownRuns = runs.filter((run) => run.waitReason === 'delivery_unknown')
    if (!budgetEvent && deliveryUnknownRuns.length > 0) {
      budgetEvent = {
        reason: 'delivery_unknown',
        elapsedSeconds,
        agentRuns: runs.length,
        acceptedA2a,
        affectedAgentRunIds: deliveryUnknownRuns.map((run) => run.id).sort()
      }
    } else if (!budgetEvent && elapsedSeconds >= budget.elapsedSeconds) {
      budgetEvent = { reason: 'elapsed', elapsedSeconds, agentRuns: runs.length, acceptedA2a }
    } else if (!budgetEvent && runs.length > budget.maxAgentRuns) {
      budgetEvent = { reason: 'agent_runs', elapsedSeconds, agentRuns: runs.length, acceptedA2a }
    } else if (!budgetEvent && acceptedA2a > budget.maxAcceptedA2a) {
      budgetEvent = { reason: 'accepted_a2a', elapsedSeconds, agentRuns: runs.length, acceptedA2a }
    }
    if (budgetEvent && !cancellationSent && turn && !isTurnTerminal(turn.status)) {
      const cancelled = await core.request('campTurns.cancel', {
        commandId: crypto.randomUUID(),
        command: { campId, campTurnId, expectedVersion: turn.version }
      })
      cancellationSent = true
      budgetEvent.cancellationResultDigest = digestJson(cancelled)
    }
    const allRunsTerminal = runs.length > 0 && runs.every((run) => isRunTerminal(run.status))
    if (turn && isTurnTerminal(turn.status) && allRunsTerminal) {
      return { snapshot, budgetEvent, observationDigest: sha256(observationHashInput) }
    }
    if (budgetEvent && cancellationSent) {
      terminalSince ??= performance.now()
      if (performance.now() - terminalSince > 60_000) {
        budgetEvent.cancellationConvergenceTimeout = true
        return { snapshot, budgetEvent, observationDigest: sha256(observationHashInput) }
      }
    }
    if (!rootAgentRunId) throw new Error('dispatch returned no root AgentRun identity')
    await new Promise((resolveWait) => setTimeout(resolveWait, 750))
  }
}

function normalizeSnapshot(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    throughGlobalSequence: snapshot.throughGlobalSequence,
    camp: snapshot.camp,
    members: snapshot.members,
    turns: snapshot.turns,
    agentRuns: snapshot.agentRuns,
    tasks: snapshot.tasks.map(({ title, description, ...task }) => ({ ...task, titleDigest: sha256(title), descriptionDigest: sha256(description) })),
    messages: snapshot.messages.map(({ body, ...message }) => ({ ...message, bodyDigest: sha256(body), bodyBytes: Buffer.byteLength(body) })),
    inboxMessages: snapshot.inboxMessages.map(({ body, ...message }) => ({ ...message, bodyDigest: sha256(body), bodyBytes: Buffer.byteLength(body) })),
    conversationInputs: snapshot.conversationInputs,
    returnObligations: snapshot.returnObligations,
    approvals: snapshot.approvals.map(({ canonicalInput, ...approval }) => ({ ...approval, canonicalInputDigest: digestJson(canonicalInput) })),
    actions: snapshot.actions,
    executionEvidence: snapshot.executionEvidence.map((evidence) => ({
      id: evidence.id,
      agentRunId: evidence.agentRunId,
      executionEpoch: evidence.executionEpoch,
      sequence: evidence.sequence,
      eventType: evidence.eventType,
      kind: evidence.kind,
      phase: evidence.phase,
      payloadDigest: digestJson(evidence.payload),
      safeIdentity: extractEvidenceIdentity(evidence.payload),
      contentByteCount: evidence.contentByteCount,
      isTruncated: evidence.isTruncated,
      occurredAt: evidence.occurredAt
    })),
    timeline: snapshot.timeline.map(({ payload, ...event }) => ({ ...event, payloadDigest: digestJson(payload) }))
  }
}

function detectPostDispatchHumanIntervention(snapshot, dispatchBoundary) {
  if (!snapshot || !dispatchBoundary) return false
  const userMessages = snapshot.messages.filter((message) => message.authorType === 'user')
  const resolvedApproval = snapshot.approvals.some((approval) => ['approved', 'denied'].includes(approval.status))
  return userMessages.length !== 1 || resolvedApproval
}

function evaluateOrchestrationConvergence({ snapshot, dispatchBoundary, budgetEvent, termination, postDispatchError }) {
  if (!snapshot || !dispatchBoundary || budgetEvent || postDispatchError || !termination?.converged) return false
  const turn = snapshot.turns.find((candidate) => candidate.id === dispatchBoundary.campTurnId)
  const runs = snapshot.agentRuns.filter((run) => run.campTurnId === dispatchBoundary.campTurnId)
  const rootRun = runs.find((run) => run.id === dispatchBoundary.rootAgentRunId)
  return turn?.status === 'completed'
    && rootRun?.status === 'succeeded'
    && runs.length > 0
    && runs.every((run) => run.status === 'succeeded' && !run.hasUnsettledExternalEffects)
    && !snapshot.approvals.some((approval) => approval.status === 'pending')
}

function evaluateChangeBoundary(manifest, diff) {
  if (!diff) return { passed: false, violations: [{ path: null, reason: 'final workspace unavailable' }] }
  const violations = []
  for (const change of diff.changed) {
    const path = change.path
    if (matchesAny(path, manifest.forbiddenPaths)) violations.push({ path, reason: 'forbidden_path' })
    else if (change.after?.type !== 'directory' && !matchesAny(path, manifest.allowedPaths)) {
      violations.push({ path, reason: 'outside_allowed_paths' })
    }
  }
  return { passed: violations.length === 0, violations }
}

function matchesAny(path, patterns) {
  return patterns.some((pattern) => {
    if (pattern.endsWith('/**')) return path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2))
    return path === pattern
  })
}

async function finishInvalid({ trialId, options, startedAt, error, evidenceDirectory, lifecyclePath, caseRecord, environmentManifest }) {
  const resultBundle = {
    schemaVersion: 1,
    runnerVersion: QUALIFICATION_RUNNER_VERSION,
    trialId,
    mode: options.mode,
    startedAt,
    completedAt: new Date().toISOString(),
    validity: 'invalid',
    verifiedDelivery: 'unavailable',
    orchestrationConvergence: false,
    postDispatchHumanIntervention: false,
    overall: 'invalid',
    case: caseRecord ? { id: caseRecord.contract.manifest.id, version: caseRecord.contract.manifest.version, seal: caseRecord.seal } : null,
    environmentManifestDigest: environmentManifest ? digestJson(environmentManifest) : null,
    preDispatchError: serializeError(error)
  }
  const redactedSummary = redactResult(resultBundle)
  await atomicWriteJson(join(evidenceDirectory, 'result.json'), resultBundle)
  await atomicWriteJson(join(evidenceDirectory, 'redacted-summary.json'), redactedSummary)
  await appendPrivateLine(lifecyclePath, { schemaVersion: 1, state: 'invalid', occurredAt: new Date().toISOString(), errorCode: error.name ?? 'Error' })
  await writeFile(join(evidenceDirectory, 'COMPLETE'), `${digestJson(resultBundle)}\n`, { mode: 0o600 })
  return { resultBundle, redactedSummary, evidenceDirectory }
}

function redactResult(result) {
  return {
    schemaVersion: 1,
    runnerVersion: result.runnerVersion,
    trialId: result.trialId,
    mode: result.mode,
    case: result.case ? { id: result.case.id, version: result.case.version, seal: result.case.seal } : null,
    validity: result.validity,
    verifiedDelivery: result.verifiedDelivery,
    orchestrationConvergence: result.orchestrationConvergence,
    postDispatchHumanIntervention: result.postDispatchHumanIntervention,
    overall: result.overall,
    budget: result.budget ? {
      contract: result.budget.contract,
      triggered: result.budget.event?.reason ?? null,
      observedAgentRuns: result.budget.observedAgentRuns,
      observedAcceptedA2a: result.budget.observedAcceptedA2a
    } : null,
    collaboration: result.collaborationEvidence ? {
      status: result.collaborationEvidence.status,
      members: result.collaborationEvidence.members,
      runCount: result.collaborationEvidence.runGraph?.length,
      acceptedA2a: result.collaborationEvidence.a2a?.length,
      metrics: result.collaborationEvidence.metrics,
      pollingViolationCount: result.collaborationEvidence.pollingViolations?.length ?? null,
      semanticAttribution: result.collaborationEvidence.semanticAttribution
    } : null,
    collaborationAudit: result.collaborationAudit ?? null,
    environmentManifestDigest: result.environmentManifestDigest,
    ambientMcpIsolation: 'preserved_uncontrolled',
    limitations: ['No LLM Judge or composite score is used.', 'Withheld verifier details and private case locators are not exported.']
  }
}

async function initializeBaselineGit(workspacePath) {
  const commands = [
    ['init', '--initial-branch=main'],
    ['add', '--all'],
    ['-c', 'user.name=Rovai Qualification', '-c', 'user.email=qualification@invalid', 'commit', '-m', 'sealed baseline']
  ]
  for (const args of commands) {
    const result = await runCaptured('git', args, { cwd: workspacePath, timeoutMs: 60_000 })
    if (result.code !== 0) throw new Error(`could not initialize Trial baseline Git: ${result.stderr}`)
  }
  const remotes = await runCaptured('git', ['remote'], { cwd: workspacePath })
  if (remotes.stdout.trim() !== '') throw new Error('Trial baseline unexpectedly has a Git remote')
}

async function appendPrivateLine(path, value) {
  await appendFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
}

async function waitFor(probe, description, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await probe()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error(`timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`)
}

function isRunTerminal(status) {
  return ['succeeded', 'failed', 'cancelled'].includes(status)
}

function isTurnTerminal(status) {
  return ['completed', 'failed', 'cancelled'].includes(status)
}

function isPackagedCore(path) {
  return /\.app\/Contents\/Resources\/bin\/rovai-core$/.test(resolve(path))
}

function sanitizeCoreStop(value) {
  if (!value) return null
  return {
    code: value.code ?? null,
    signal: value.signal ?? null,
    stderrDigest: value.stderrDigest ?? null,
    stderrBytes: value.stderrBytes ?? null,
    error: value.error ?? null
  }
}

function serializeError(error) {
  return { name: error?.name ?? 'Error', message: error?.message ?? String(error) }
}

function parseArguments(args) {
  const values = {}
  while (args.length > 0) {
    const argument = args.shift()
    if (!argument.startsWith('--')) usage()
    const key = argument.slice(2)
    if (!['mode', 'core', 'case', 'expected-seal', 'evidence-root', 'team-private-dir', 'trial-id'].includes(key)) usage()
    values[key] = args.shift()
    if (!values[key]) usage()
  }
  if (!['demo', 'formal'].includes(values.mode) || !values.core || !values.case || !values['evidence-root'] || !values['team-private-dir']) usage()
  return {
    mode: values.mode,
    coreExecutable: resolve(values.core),
    caseDirectory: resolve(values.case),
    expectedSeal: values['expected-seal'] ?? null,
    evidenceRoot: resolve(values['evidence-root']),
    antigravityTeamPrivateDirectory: resolve(values['team-private-dir']),
    trialId: values['trial-id'] ?? null
  }
}

function usage() {
  console.error('Usage: node scripts/qualification-runner.mjs --mode <demo|formal> --core <path> --case <path> --evidence-root <path> --team-private-dir <path> [--expected-seal <sha256>] [--trial-id <id>]')
  process.exit(2)
}

const FROZEN_TEAM = [
  {
    agentProfileId: 'agent-luoke',
    adapterKind: 'codex-cli',
    model: { mode: 'explicit', modelId: 'gpt-5.6-sol', options: { reasoning_effort: 'medium' } },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } }
  },
  {
    agentProfileId: 'agent-muwa',
    adapterKind: 'codex-cli',
    model: { mode: 'explicit', modelId: 'gpt-5.6-sol', options: { reasoning_effort: 'medium' } },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } }
  },
  {
    agentProfileId: 'agent-mianzhi',
    adapterKind: 'opencode-cli',
    model: { mode: 'explicit', modelId: 'opencode/big-pickle', options: {} },
    permissions: { adapterKind: 'opencode-cli', schemaVersion: 1, values: { permission: 'allow' } }
  },
  {
    agentProfileId: 'agent-qilu',
    adapterKind: 'antigravity-app',
    model: { mode: 'explicit', modelId: 'gemini-3.6-flash-high', options: {} },
    permissions: { adapterKind: 'antigravity-app', schemaVersion: 1, values: { mode: 'accept-edits', sandbox: 'on', dangerously_skip_permissions: 'on' } }
  }
]

const result = await runTrial(arguments_)
console.log(JSON.stringify(result.redactedSummary, null, 2))
if (result.redactedSummary.overall === 'invalid') process.exitCode = 2
else if (result.redactedSummary.overall === 'fail') process.exitCode = 1
