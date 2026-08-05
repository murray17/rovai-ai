import { appendFile, chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import { arch, platform, release, type as osType } from 'node:os'
import { basename, join, resolve } from 'node:path'
import {
  QUALIFICATION_RUNNER_VERSION,
  acquireExclusiveFile,
  atomicWriteJson,
  canonicalJson,
  captureDeliveredWorkspaceSnapshot,
  copyFixture,
  digestFile,
  digestJson,
  dispatchQualificationPrompt,
  ensurePrivateDirectory,
  evaluateChangeBoundary,
  makeTemporaryDirectory,
  materializeJsonArtifact,
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
  runV3PublicChecks
} from './lib/qualification-case-v3.mjs'
import {
  QUALIFICATION_TRIAL_SCHEMA_VERSION,
  buildRunnerCheckResults,
  buildDeliveryLayer,
  collectCampEventPages,
  deriveConvergenceEvidence,
  deriveDeliveryEvidence,
  deriveHardOutcome,
  deriveHumanInterventionEvidence,
  inspectFrozenExecutionBudget,
  observedDurableMemberCallEffects
} from './lib/qualification-evaluation.mjs'
import {
  QUALIFICATION_VERIFIER_CONFIGURATION,
  appendEvaluationAttempt,
  appendResultRevision,
  buildEvaluationIdentity,
  computeQualificationEvaluatorDigest
} from './lib/qualification-recovery.mjs'
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
import {
  collectAgentRunExecutionEvidencePages,
  deriveToolEvidence
} from './lib/qualification-tool-evidence.mjs'
import {
  InterventionIsolationError,
  loadAndAdmitInterventionIsolationProfile,
  verifyInterventionIsolationContinuity
} from './lib/qualification-isolation.mjs'
import {
  bindToolEvidenceReferences,
  buildEvidenceIndex,
  retainEvidenceIndexArtifact
} from './lib/qualification-evidence-index.mjs'
import {
  buildCollaborationLedger,
  retainCollaborationLedgerArtifact
} from './lib/qualification-collaboration-ledger.mjs'
import {
  buildToolCallLedger,
  retainToolCallLedgerArtifact
} from './lib/qualification-tool-ledger.mjs'
import {
  buildWorkspaceMutationLedger,
  retainWorkspaceMutationLedgerArtifact
} from './lib/qualification-workspace-mutation-ledger.mjs'
import { publishQualificationEvidenceBundle } from './lib/qualification-bundle.mjs'

const root = resolve(import.meta.dirname, '..')
const arguments_ = parseArguments(process.argv.slice(2))
const QUALIFICATION_RUNTIME_EXIT_GRACE_MS = 60_000

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
  let deliveredSnapshot = null
  let verifier = null
  let publicCheckOutcomes = []
  let evaluationAttempt = null
  let evaluationIdentity = null
  let environmentManifest = null
  let caseRecord = null
  let budgetEvent = null
  let termination = null
  let dispatchBoundary = null
  let postDispatchError = null
  let competingProcesses = []
  let childPids = []
  let observationDigest = null
  let observationIntegrityIssues = []
  let budgetWatchdogEvent = null
  let executionEvidenceCoverage = null
  let isolationProfileAdmission = null
  let isolationProfileExpectedBinding = null
  let isolationContinuity = {
    state: 'not_applicable',
    reason: { code: 'intervention_isolation.non_formal' }
  }

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
    if (caseRecord.contract.manifest.visibility !== options.mode) {
      throw new Error(`${options.mode} mode requires a ${options.mode} Case`)
    }
    if (options.mode === 'formal') {
      if (!options.isolationProfilePath) {
        throw new InterventionIsolationError(
          'intervention_isolation.profile_required',
          'formal mode requires a private versioned Intervention Isolation Profile'
        )
      }
      isolationProfileExpectedBinding = {
        suiteId: options.suiteId,
        plannedSlotId: options.plannedSlotId ?? trialId,
        trialId,
        caseId: caseRecord.contract.manifest.id,
        caseSeal: `sha256:${caseRecord.seal}`
      }
      isolationProfileAdmission = await loadAndAdmitInterventionIsolationProfile(
        options.isolationProfilePath,
        isolationProfileExpectedBinding
      )
      await atomicWriteJson(
        join(evidenceDirectory, 'intervention-isolation-profile.json'),
        isolationProfileAdmission.artifact
      )
      await appendLifecycle('isolation_profile_admitted', {
        artifactId: isolationProfileAdmission.artifactId,
        artifactDigest: isolationProfileAdmission.artifactDigest,
        profileId: isolationProfileAdmission.profileId,
        profileVersion: isolationProfileAdmission.profileVersion
      })
    } else if (options.isolationProfilePath) {
      throw new InterventionIsolationError(
        'intervention_isolation.non_formal_profile_forbidden',
        `${options.mode} mode cannot claim a Formal Intervention Isolation Profile`
      )
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
    const antigravityTeamGeminiRoot = join(temporaryRoot, 'antigravity-gemini')
    runtimeCacheDirectory = join(temporaryRoot, 'runtime-cache')
    workspacePath = join(temporaryRoot, 'workspace')
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
    await mkdir(antigravityTeamGeminiRoot, { recursive: true, mode: 0o700 })
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
      antigravityTeamGeminiRoot: options.mode === 'formal' ? null : antigravityTeamGeminiRoot,
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
      workspacePath,
      isolationProfileAdmission
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
      defaultLeadAgentProfileId: 'agent_1',
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
    const preDispatchSnapshot = await core.request('camps.snapshot', { campId })
    const commandId = crypto.randomUUID()
    const runnerClockAnchor = {
      wallTimeMs: Date.now(),
      monotonicMs: performance.now()
    }
    const caseBudget = caseRecord.contract.manifest.budget
    const dispatchResponse = await dispatchQualificationPrompt(core.request, {
      commandId,
      campId,
      prompt: caseRecord.contract.prompt,
      execution: {
        taskId: null,
        purpose: 'Complete the user-requested change in the bound workspace.',
        expectedOutput: 'A verified implementation satisfying the stated acceptance constraints.',
        completionRole: 'required',
        budget: {
          elapsedSeconds: caseBudget.elapsedSeconds,
          maxAgentRunResponsibilities: caseBudget.maxAgentRuns,
          maxAcceptedA2a: caseBudget.maxAcceptedA2a
        }
      }
    })
    const commandResult = dispatchResponse.commandResult ?? dispatchResponse
    if (commandResult.status !== 'accepted') {
      throw new Error(`qualification dispatch was not accepted: ${JSON.stringify(commandResult)}`)
    }
    dispatchAccepted = true
    const frozenBudgetInspection = inspectFrozenExecutionBudget(
      commandResult.payload.executionBudget,
      caseBudget
    )
    observationIntegrityIssues.push(...frozenBudgetInspection.issues)
    dispatchBoundary = {
      schemaVersion: 1,
      commandId,
      acceptedAt: frozenBudgetInspection.budget?.acceptedAt ?? new Date().toISOString(),
      runnerObservedAcceptedAt: new Date().toISOString(),
      requestBodyDigest: sha256(caseRecord.contract.prompt),
      campId,
      campTurnId: commandResult.payload.campTurnId,
      rootCampMessageId: commandResult.payload.campMessageId ?? null,
      rootAgentRunId: commandResult.payload.agentRunIds?.[0] ?? null,
      rootAgentRunIds: [...(commandResult.payload.agentRunIds ?? [])].sort(),
      preDispatchThroughGlobalSequence: preDispatchSnapshot.throughGlobalSequence,
      executionBudget: frozenBudgetInspection.budget,
      executionBudgetDigest: frozenBudgetInspection.budget
        ? digestJson(frozenBudgetInspection.budget)
        : null,
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
      budget: caseBudget,
      frozenBudget: frozenBudgetInspection.budget,
      runnerClockAnchor,
      observationPath
    })
    finalSnapshot = observation.snapshot
    budgetEvent = observation.budgetEvent
    observationDigest = observation.observationDigest
    observationIntegrityIssues.push(...observation.integrityIssues)
    budgetWatchdogEvent = observation.watchdogEvent
    executionEvidenceCoverage = observation.executionEvidenceCoverage
    if (budgetEvent) await appendLifecycle('stopping', budgetEvent)
    else if (budgetWatchdogEvent) await appendLifecycle('stopping', budgetWatchdogEvent)
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
        await waitForProcessesToExit(childPids, QUALIFICATION_RUNTIME_EXIT_GRACE_MS)
          .catch(() => childPids)
      }
      await lock?.release()
      if (temporaryRoot) await removeTemporaryDirectory(temporaryRoot)
      return invalid
    }
  }

  try {
    // The immutable delivery snapshot is captured only after every Runtime writer
    // has exited. Runner-owned projections and baseline Git metadata are excluded
    // by construction, so Core cleanup cannot be mistaken for an Agent change.
    if (core) {
      const table = await processTable().catch(() => [])
      childPids = descendantsOf(table, core.pid)
      coreStop = await core.stop().catch((error) => ({ error: serializeError(error) }))
      const lingering = await waitForProcessesToExit(
        childPids,
        QUALIFICATION_RUNTIME_EXIT_GRACE_MS
      )
      termination = {
        schemaVersion: 1,
        core: sanitizeCoreStop(coreStop),
        observedChildPids: childPids,
        lingeringChildPids: lingering,
        converged: lingering.length === 0 && !coreStop?.error
      }
    }
    await appendLifecycle('runtimes_terminated', { converged: termination?.converged ?? false })
    if (termination?.converged) {
      deliveredSnapshot = await captureDeliveredWorkspaceSnapshot(workspacePath, evidenceDirectory)
      finalManifest = deliveredSnapshot.manifest
      finalDiff = treeDiff(baselineManifest, finalManifest)
      await atomicWriteJson(join(evidenceDirectory, 'delivered-workspace-manifest.json'), {
        schemaVersion: QUALIFICATION_TRIAL_SCHEMA_VERSION,
        digest: finalManifest.digest,
        entries: finalManifest.entries
      })
      evaluationIdentity = buildEvaluationIdentity({
        trialId,
        caseSeal: caseRecord.seal,
        deliveredWorkspaceDigest: finalManifest.digest,
        verifierDigest: caseRecord.contract.components.verifierDigest,
        verifierRuntimeDigest: await digestFile(process.execPath),
        verificationCatalogDigest: caseRecord.contract.components.verificationCatalogDigest,
        publicCheckContractDigest: caseRecord.contract.manifest.schemaVersion === 3
          ? digestJson(caseRecord.contract.manifest.publicChecks)
          : null,
        hermeticProfileDigest: caseRecord.contract.manifest.schemaVersion === 3
          ? caseRecord.admission.hermeticProfileDigest
          : null,
        verifierConfigurationDigest: caseRecord.contract.manifest.schemaVersion === 3
          ? caseRecord.admission.hermeticProfileDigest
          : null,
        environmentManifestDigest: environmentManifest ? digestJson(environmentManifest) : null
      })
      const verifierWorkspace = join(temporaryRoot, 'verifier-workspace')
      await copyFixture(deliveredSnapshot.path, verifierWorkspace)
      await appendLifecycle('verifying', { deliveredWorkspaceDigest: finalManifest.digest })
      const evaluationAttemptId = crypto.randomUUID()
      publicCheckOutcomes = await runV3PublicChecks(caseRecord.contract, verifierWorkspace)
      verifier = await runCaseVerifier(caseRecord.contract.verifierPath, verifierWorkspace, {
        verificationCatalog: caseRecord.contract.evaluationContract.verificationCatalog,
        hermetic: caseRecord.contract.manifest.schemaVersion === 3,
        timeoutMs: caseRecord.contract.manifest.schemaVersion === 3
          ? caseRecord.contract.manifest.toolchain.verifierTimeoutMs
          : QUALIFICATION_VERIFIER_CONFIGURATION.timeoutMs,
        maxOutputBytes: caseRecord.contract.manifest.schemaVersion === 3
          ? caseRecord.contract.manifest.toolchain.maxOutputBytes
          : QUALIFICATION_VERIFIER_CONFIGURATION.maxOutputBytes
      })
      evaluationAttempt = await appendEvaluationAttempt(evidenceDirectory, {
        attemptId: evaluationAttemptId,
        trialId,
        trigger: 'initial',
        evaluationIdentity,
        identityValidation: { status: 'passed', reasons: [] },
        observation: verifier,
        runnerObservation: { publicChecks: publicCheckOutcomes },
        derivation: { status: 'pending_result_revision' }
      })
      await rm(verifierWorkspace, { recursive: true, force: true })
    }
  } catch (error) {
    if (evaluationIdentity && !evaluationAttempt) {
      evaluationAttempt = await appendEvaluationAttempt(evidenceDirectory, {
        trialId,
        trigger: 'initial',
        evaluationIdentity,
        identityValidation: { status: 'passed', reasons: [] },
        observation: verifier,
        runnerObservation: { publicChecks: publicCheckOutcomes },
        derivation: {
          status: 'failed',
          reason: {
            code: 'initial.evaluation_execution_failed',
            detail: error?.name ?? 'Error'
          }
        }
      }).catch(() => null)
    }
    postDispatchError ??= serializeError(error)
  }

  if (options.mode === 'formal' && isolationProfileAdmission) {
    isolationContinuity = await verifyInterventionIsolationContinuity(
      options.isolationProfilePath,
      isolationProfileAdmission,
      isolationProfileExpectedBinding
    )
    await appendLifecycle(
      isolationContinuity.state === 'complete'
        ? 'isolation_continuity_verified'
        : 'isolation_continuity_lost',
      {
        artifactId: isolationProfileAdmission.artifactId,
        artifactDigest: isolationProfileAdmission.artifactDigest,
        reason: isolationContinuity.reason
      }
    )
  }

  const humanIntervention = deriveHumanInterventionEvidence(
    finalSnapshot,
    dispatchBoundary,
    {
      mode: options.mode,
      isolationProfileAdmission,
      continuityCoverage: isolationContinuity.state
    }
  )
  const convergence = deriveConvergenceEvidence({
    snapshot: finalSnapshot,
    dispatchBoundary,
    budgetEvent,
    termination,
    isolation: {
      mode: options.mode,
      profileAdmission: isolationProfileAdmission,
      continuityCoverage: isolationContinuity.state
    }
  })
  const boundary = evaluateChangeBoundary(caseRecord.contract.manifest, finalDiff)
  const runnerCheckResults = buildRunnerCheckResults(
    caseRecord.contract.evaluationContract.verificationCatalog,
    { changeBoundary: boundary, publicChecks: publicCheckOutcomes }
  )
  const verifierObservation = verifier ?? {
    validationState: 'invalid',
    validationErrors: [{
      code: termination?.converged
        ? 'verifier.observation_unavailable'
        : 'freeze_barrier.runtime_exit_incomplete'
    }],
    process: null,
    checkResults: []
  }
  const deliveryEvidence = deriveDeliveryEvidence(
    caseRecord.contract.evaluationContract,
    verifierObservation,
    runnerCheckResults
  )
  const evaluationIssues = [...deliveryEvidence.evaluationIssues]
  evaluationIssues.push(...observationIntegrityIssues)
  if (postDispatchError) {
    evaluationIssues.push({ code: 'runner.post_dispatch_error', detail: postDispatchError.name })
  }
  const hardOutcome = deriveHardOutcome({
    dispatchAccepted,
    validity: 'valid',
    verifiedDelivery: deliveryEvidence.verifiedDelivery,
    orchestrationConvergence: convergence.status,
    postDispatchHumanIntervention: humanIntervention.status,
    evaluationIssues
  })
  const collaboration = deriveCollaborationEvidence(finalSnapshot, dispatchBoundary)
  const collaborationAudit = evaluateCollaborationContract(
    caseRecord.contract.manifest.collaboration,
    collaboration
  )
  const rawToolEvidence = deriveToolEvidence(
    finalSnapshot,
    dispatchBoundary,
    executionEvidenceCoverage
  )
  const finalResponses = collectFinalResponseEvidence(finalSnapshot, dispatchBoundary)
  if (finalResponses.privateMessages.length > 0) {
    await atomicWriteJson(join(evidenceDirectory, 'final-response-evidence.json'), {
      schemaVersion: QUALIFICATION_TRIAL_SCHEMA_VERSION,
      trialId,
      messages: finalResponses.privateMessages
    })
  }
  const isolationProfileSummary = isolationProfileAdmission ? {
    status: isolationProfileAdmission.status,
    artifactId: isolationProfileAdmission.artifactId,
    artifactDigest: isolationProfileAdmission.artifactDigest,
    payloadDigest: isolationProfileAdmission.payloadDigest,
    profileId: isolationProfileAdmission.profileId,
    schemaVersion: isolationProfileAdmission.schemaVersion,
    profileVersion: isolationProfileAdmission.profileVersion,
    executionIsolation: isolationProfileAdmission.executionIsolation,
    overallCoverage: isolationProfileAdmission.overallCoverage,
    formalAdmissible: isolationProfileAdmission.formalAdmissible
  } : {
    status: 'not_applicable',
    reason: {
      code: options.mode === 'diagnostic'
        ? 'intervention_isolation.diagnostic_shared_host'
        : 'intervention_isolation.public_demo'
    }
  }
  const indexedDeliveryLayer = buildDeliveryLayer({
    deliveryEvidence,
    workspaceDiff: finalDiff,
    changeBoundary: boundary,
    verifierObservation,
    convergence,
    humanIntervention,
    budgetEvent,
    postDispatchError,
    finalResponseReferences: finalResponses.references
  })
  const evidenceIndexBuild = buildEvidenceIndex({
    trialId,
    evaluationAttemptId: evaluationAttempt?.attemptId ?? null,
    suiteId: options.suiteId ?? null,
    plannedSlotId: options.plannedSlotId ?? trialId,
    caseId: caseRecord.contract.manifest.id,
    caseSeal: caseRecord.seal,
    producerDigest: environmentManifest?.runnerDigest ?? await computeQualificationEvaluatorDigest(),
    snapshot: finalSnapshot ? normalizeSnapshot(finalSnapshot) : null,
    dispatchBoundary,
    environmentManifest,
    observationDigest,
    observationIntegrityIssues,
    executionEvidenceCoverage,
    verifierObservation,
    deliveredWorkspaceSnapshot: deliveredSnapshot ? {
      digest: finalManifest.digest,
      directory: basename(deliveredSnapshot.path),
      capturedAt: deliveredSnapshot.capturedAt,
      evaluationAttemptId: evaluationAttempt?.attemptId ?? null
    } : null,
    workspaceDiff: finalDiff,
    deliveryEvidence: indexedDeliveryLayer,
    convergence,
    humanIntervention,
    termination,
    isolationProfile: isolationProfileSummary,
    isolationContinuity,
    finalResponses: finalResponses.privateMessages
  })
  const evidenceIndex = await retainEvidenceIndexArtifact(
    evidenceDirectory,
    evidenceIndexBuild.artifact
  )
  const collaborationLedgerArtifact = buildCollaborationLedger({
    trialId,
    evaluationAttemptId: evaluationAttempt?.attemptId ?? null,
    plannedSlotId: options.plannedSlotId ?? trialId,
    suiteId: options.suiteId,
    caseId: caseRecord.contract.manifest.id,
    caseSeal: caseRecord.seal,
    producerDigest: environmentManifest?.runnerDigest ?? await computeQualificationEvaluatorDigest(),
    collaborationEvidence: collaboration,
    evidenceIndex: evidenceIndexBuild.artifact,
    evidenceReferences: evidenceIndexBuild.references
  })
  const collaborationLedger = await retainCollaborationLedgerArtifact(
    evidenceDirectory,
    collaborationLedgerArtifact,
    evidenceIndexBuild.artifact
  )
  const toolEvidence = bindToolEvidenceReferences(
    rawToolEvidence,
    evidenceIndexBuild.references.executionEvidence
  )
  const toolCallLedgerArtifact = buildToolCallLedger({
    trialId,
    evaluationAttemptId: evaluationAttempt?.attemptId ?? null,
    plannedSlotId: options.plannedSlotId ?? trialId,
    suiteId: options.suiteId,
    caseId: caseRecord.contract.manifest.id,
    caseSeal: caseRecord.seal,
    producerDigest: environmentManifest?.runnerDigest ?? await computeQualificationEvaluatorDigest(),
    toolEvidence,
    evidenceIndex: evidenceIndexBuild.artifact
  })
  const toolCallLedger = await retainToolCallLedgerArtifact(
    evidenceDirectory,
    toolCallLedgerArtifact,
    evidenceIndexBuild.artifact
  )
  const workspaceMutationLedgerArtifact = buildWorkspaceMutationLedger({
    trialId,
    evaluationAttemptId: evaluationAttempt?.attemptId ?? null,
    plannedSlotId: options.plannedSlotId ?? trialId,
    suiteId: options.suiteId,
    caseId: caseRecord.contract.manifest.id,
    caseSeal: caseRecord.seal,
    producerDigest: environmentManifest?.runnerDigest ?? await computeQualificationEvaluatorDigest(),
    workspaceDiff: finalDiff,
    observedAt: new Date().toISOString(),
    evidenceIndex: evidenceIndexBuild.artifact,
    evidenceReferences: evidenceIndexBuild.references,
    toolCallLedger: toolCallLedgerArtifact
  })
  const workspaceMutationLedger = await retainWorkspaceMutationLedgerArtifact(
    evidenceDirectory,
    workspaceMutationLedgerArtifact,
    evidenceIndexBuild.artifact,
    toolCallLedgerArtifact
  )
  const finalResponseReferences = finalResponses.references.map((message) => ({
    ...message,
    evidenceReference: evidenceIndexBuild.references.messages[message.messageId] ?? null
  }))
  const deliveryLayer = buildDeliveryLayer({
    deliveryEvidence,
    workspaceDiff: finalDiff,
    changeBoundary: boundary,
    verifierObservation,
    convergence,
    humanIntervention,
    budgetEvent,
    postDispatchError,
    finalResponseReferences
  })
  const resultBundle = {
    schemaVersion: QUALIFICATION_TRIAL_SCHEMA_VERSION,
    runnerVersion: QUALIFICATION_RUNNER_VERSION,
    trialId,
    suiteId: options.suiteId ?? null,
    plannedSlotId: options.plannedSlotId ?? trialId,
    mode: options.mode,
    case: {
      id: caseRecord.contract.manifest.id,
      version: caseRecord.contract.manifest.version,
      seal: caseRecord.seal,
      admissionDigest: caseRecord.admission.admissionDigest
    },
    startedAt,
    completedAt: new Date().toISOString(),
    dispatchAccepted,
    ...hardOutcome,
    stage: hardOutcome.evaluationState === 'complete'
      ? 'complete'
      : deliveredSnapshot
        ? 'verification'
        : 'freeze_barrier',
    hardLayer: {
      verifiedDelivery: hardOutcome.verifiedDelivery,
      orchestrationConvergence: hardOutcome.orchestrationConvergence,
      postDispatchHumanIntervention: hardOutcome.postDispatchHumanIntervention,
      overall: hardOutcome.overall,
      convergenceFacts: convergence.facts,
      failureRecoveryFacts: convergence.failureRecoveryFacts
    },
    deliveryLayer,
    dispatchBoundary,
    budget: {
      contract: caseRecord.contract.manifest.budget,
      frozen: dispatchBoundary?.executionBudget ?? null,
      event: budgetEvent,
      watchdogEvent: budgetWatchdogEvent,
      observedAgentRuns: finalSnapshot?.agentRuns?.filter(
        (run) => run.campTurnId === dispatchBoundary?.campTurnId
      ).length ?? 0,
      observedAcceptedA2a: finalSnapshot?.turns?.find(
        (turn) => turn.id === dispatchBoundary?.campTurnId
      )?.executionBudget?.acceptedA2a ?? null,
      observedDurableA2aEffects: observedDurableMemberCallEffects(
        finalSnapshot,
        dispatchBoundary?.campTurnId
      ).length,
      acceptedA2aAuthority: finalSnapshot?.turns?.find(
        (turn) => turn.id === dispatchBoundary?.campTurnId
      )?.executionBudget
        ? 'core_canonical_acceptance_receipt_counter'
        : 'unavailable'
    },
    environmentManifestDigest: environmentManifest ? digestJson(environmentManifest) : null,
    isolationProfile: isolationProfileSummary,
    interventionIsolationContinuity: isolationContinuity,
    ambientMcpIsolation: environmentManifest?.ambientMcpIsolation ?? 'unavailable',
    evidenceIndex,
    observationDigest,
    termination,
    baselineTreeDigest: baselineManifest?.digest ?? null,
    dispatchBaselineTreeDigest: dispatchBaselineManifest?.digest ?? null,
    managedProjectionDiff,
    finalTreeDigest: finalManifest?.digest ?? null,
    deliveredWorkspaceSnapshot: deliveredSnapshot ? {
      digest: finalManifest.digest,
      directory: basename(deliveredSnapshot.path),
      capturedAt: deliveredSnapshot.capturedAt,
      evaluationAttemptId: evaluationAttempt?.attemptId ?? null
    } : null,
    evaluationIdentity,
    workspaceDiff: finalDiff,
    verifier: verifierObservation,
    publicCheckOutcomes,
    changeBoundary: boundary,
    collaborationEvidence: collaboration,
    collaborationLedger,
    collaborationAudit,
    toolEvidence,
    toolCallLedger,
    workspaceMutationLedger,
    semanticEngineeringReview: {
      status: 'unavailable',
      reason: { code: 'semantic_judge.not_invoked' }
    },
    humanInterventionEvidence: humanIntervention,
    evaluationIssues,
    postDispatchError
  }
  const revision = await appendResultRevision(evidenceDirectory, resultBundle, {
    evaluationAttemptId: evaluationAttempt?.attemptId ?? null
  })
  const finalResultBundle = revision.resultBundle
  const redactedSummary = revision.redactedSummary
  await appendLifecycle(
    hardOutcome.overall === 'pass'
      ? 'passed'
      : hardOutcome.overall === 'fail'
        ? 'failed'
        : 'evaluation_pending'
  )
  const resultDigest = revision.record.resultDigest
  await writeFile(join(evidenceDirectory, 'CAPTURE_COMPLETE'), `${resultDigest}\n`, { mode: 0o600 })
  await writeFile(
    join(evidenceDirectory, hardOutcome.evaluationState === 'complete' ? 'COMPLETE' : 'EVALUATION_PENDING'),
    `${resultDigest}\n`,
    { mode: 0o600 }
  )
  const publication = await publishQualificationEvidenceBundle({
    evidenceDirectory,
    result: finalResultBundle,
    resultDigest,
    caseRecord,
    producerDigest: environmentManifest?.runnerDigest ?? await computeQualificationEvaluatorDigest(),
    evidenceIndex: evidenceIndexBuild.artifact,
    collaborationLedger: collaborationLedgerArtifact,
    toolCallLedger: toolCallLedgerArtifact,
    workspaceMutationLedger: workspaceMutationLedgerArtifact,
    evaluationAttempts: evaluationAttempt ? [evaluationAttempt] : []
  })
  await appendLifecycle('evidence_bundle_completed', {
    artifactId: publication.evidenceBundleManifest.artifactId,
    manifestDigest: publication.evidenceBundleManifest.manifestDigest
  })
  await lock?.release()
  if (temporaryRoot) await removeTemporaryDirectory(temporaryRoot)
  return { resultBundle: finalResultBundle, redactedSummary, evidenceDirectory, ...publication }
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

async function collectEnvironmentManifest({
  core,
  options,
  caseRecord,
  configured,
  isolationProfileAdmission
}) {
  const health = await core.request('health.check', {}, 120_000)
  const coreDigest = await digestFile(options.coreExecutable)
  const runnerDigest = await computeQualificationEvaluatorDigest()
  const gitHead = await runCaptured('git', ['rev-parse', 'HEAD'], { cwd: root })
  const gitStatus = await runCaptured('git', ['status', '--porcelain=v1'], { cwd: root })
  const toolchain = []
  if (caseRecord.contract.manifest.schemaVersion === 3) {
    const majorVersion = Number.parseInt(process.versions.node.split('.')[0], 10)
    if (majorVersion < caseRecord.contract.manifest.toolchain.minimumMajorVersion) {
      throw new Error('Case v3 requires a newer Node.js verifier runtime')
    }
    toolchain.push({
      name: 'node',
      outputDigest: await digestFile(process.execPath),
      version: process.version
    })
  } else {
    for (const item of caseRecord.contract.manifest.toolchain ?? []) {
      const run = await runCaptured(item.command[0], item.command.slice(1), { cwd: root, timeoutMs: 30_000 })
      if (run.code !== 0) throw new Error(`toolchain preflight failed: ${item.name}`)
      toolchain.push({ name: item.name, outputDigest: sha256(run.stdout), version: run.stdout.trim().split('\n')[0] })
    }
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
    releaseCore: {
      digest: coreDigest,
      packaged: isPackagedCore(options.coreExecutable),
      version: health.core.version,
      readModelSchema: health.core.readModelSchema,
      attestedTeamProtocol: health.core.attestedTeamProtocol
    },
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
    ambientMcpIsolation: isolationProfileAdmission
      ? isolationProfileAdmission.channels.externalMcpMutation.state
      : 'preserved_uncontrolled',
    interventionIsolationProfile: isolationProfileAdmission ? {
      artifactId: isolationProfileAdmission.artifactId,
      schemaId: isolationProfileAdmission.schemaId,
      schemaVersion: isolationProfileAdmission.schemaVersion,
      artifactDigest: isolationProfileAdmission.artifactDigest,
      payloadDigest: isolationProfileAdmission.payloadDigest,
      profileId: isolationProfileAdmission.profileId,
      profileVersion: isolationProfileAdmission.profileVersion,
      executionIsolation: isolationProfileAdmission.executionIsolation,
      dedicatedIdentityDigest: isolationProfileAdmission.dedicatedIdentityDigest,
      overallCoverage: isolationProfileAdmission.overallCoverage,
      formalAdmissible: isolationProfileAdmission.formalAdmissible
    } : {
      status: 'not_applicable',
      reason: {
        code: options.mode === 'diagnostic'
          ? 'intervention_isolation.diagnostic_shared_host'
          : 'intervention_isolation.public_demo'
      }
    },
    toolchain,
    usageObservation: { status: 'unavailable', reason: 'provider usage is not exposed consistently by all frozen Runtimes' }
  }
  manifest.teamRuntimeCompatibilityDigest = digestJson(materializeJsonArtifact({
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
    ambientMcpIsolation: manifest.ambientMcpIsolation,
    interventionIsolationProfile: manifest.interventionIsolationProfile
  }))
  return materializeJsonArtifact(manifest)
}

async function observeTrial({
  core,
  campId,
  campTurnId,
  rootAgentRunId,
  budget,
  frozenBudget,
  runnerClockAnchor,
  observationPath
}) {
  let budgetEvent = null
  let watchdogEvent = null
  let cancellationSent = false
  let terminalSince = null
  let lastDigest = null
  let observationHashInput = ''
  const integrityIssues = []
  const addIntegrityIssue = (code, detail) => {
    if (!integrityIssues.some((issue) => issue.code === code)) integrityIssues.push({ code, detail })
  }
  const clockToleranceMs = 2_000
  const fallbackDeadlineMonotonic = runnerClockAnchor.monotonicMs + budget.elapsedSeconds * 1000
  const frozenDeadlineMs = Date.parse(frozenBudget?.deadlineAt)
  const runnerDeadlineMonotonic = Number.isFinite(frozenDeadlineMs)
    ? runnerClockAnchor.monotonicMs + (frozenDeadlineMs - runnerClockAnchor.wallTimeMs)
    : fallbackDeadlineMonotonic
  const eventState = { afterGlobalSequence: 0, events: [], eventIds: new Set() }
  while (true) {
    const snapshot = await core.request('camps.snapshot', { campId }, 60_000)
    const eventCoverage = await collectCampEventPages(core.request, campId, eventState)
    if (!eventCoverage.complete) {
      addIntegrityIssue(eventCoverage.reason, 'Core event pagination could not establish complete coverage')
    }
    snapshot.timeline = eventState.events.filter(
      (event) => event.globalSequence <= snapshot.throughGlobalSequence
    )
    const normalized = normalizeSnapshot(snapshot)
    const digest = digestJson(normalized)
    if (digest !== lastDigest) {
      const record = { schemaVersion: 1, observedAt: new Date().toISOString(), digest, snapshot: normalized }
      const line = `${JSON.stringify(record)}\n`
      await appendFile(observationPath, line, { mode: 0o600 })
      observationHashInput += line
      lastDigest = digest
    }
    const observedMonotonic = performance.now()
    const elapsedSeconds = (observedMonotonic - runnerClockAnchor.monotonicMs) / 1000
    const runs = snapshot.agentRuns.filter((run) => run.campTurnId === campTurnId)
    const observedA2aEffects = observedDurableMemberCallEffects(snapshot, campTurnId).length
    const turn = snapshot.turns.find((candidate) => candidate.id === campTurnId)
    const coreBudget = turn?.executionBudget ?? null
    const deliveryUnknownRuns = runs.filter((run) => run.waitReason === 'delivery_unknown')
    const projectedWallTimeMs = runnerClockAnchor.wallTimeMs
      + (observedMonotonic - runnerClockAnchor.monotonicMs)
    if (Math.abs(Date.now() - projectedWallTimeMs) > clockToleranceMs) {
      addIntegrityIssue(
        'execution_budget.runner_clock_discontinuity',
        'Runner wall clock diverged from its monotonic projection beyond tolerance'
      )
    }
    if (frozenBudget && coreBudget) {
      const configurationMatches = coreBudget.schemaVersion === frozenBudget.schemaVersion
        && coreBudget.acceptedAt === frozenBudget.acceptedAt
        && coreBudget.deadlineAt === frozenBudget.deadlineAt
        && coreBudget.elapsedSeconds === frozenBudget.elapsedSeconds
        && coreBudget.maxAgentRunResponsibilities === frozenBudget.maxAgentRunResponsibilities
        && coreBudget.maxAcceptedA2a === frozenBudget.maxAcceptedA2a
        && coreBudget.allocatedAgentRunResponsibilities >= frozenBudget.rootAgentRunResponsibilities
      if (!configurationMatches) {
        addIntegrityIssue(
          'execution_budget.read_model_disagreement',
          'Core Read Model budget disagrees with the dispatch acceptance contract'
        )
      }
    } else if (!coreBudget) {
      addIntegrityIssue(
        'execution_budget.read_model_missing',
        'CampTurn Read Model omitted the authoritative execution budget'
      )
    }
    if (coreBudget
        && (coreBudget.acceptedA2a > coreBudget.maxAcceptedA2a
          || coreBudget.allocatedAgentRunResponsibilities > coreBudget.maxAgentRunResponsibilities)) {
      addIntegrityIssue(
        'execution_budget.authoritative_counter_overflow',
        'Core authoritative counters exceeded their frozen ceilings'
      )
    }
    if (!budgetEvent && coreBudget?.exhaustedAt) {
      budgetEvent = {
        authority: 'core_execution_budget',
        reason: coreBudget.exhaustionReason,
        exhaustedAt: coreBudget.exhaustedAt,
        exhaustionCommandId: coreBudget.exhaustionCommandId,
        deadlineAt: coreBudget.deadlineAt,
        elapsedSeconds,
        agentRuns: runs.length,
        acceptedA2a: coreBudget.acceptedA2a,
        allocatedAgentRunResponsibilities: coreBudget.allocatedAgentRunResponsibilities,
        observedA2aEffects
      }
    }
    if (!watchdogEvent && deliveryUnknownRuns.length > 0) {
      watchdogEvent = {
        reason: 'delivery_unknown',
        elapsedSeconds,
        agentRuns: runs.length,
        observedA2aEffects,
        affectedAgentRunIds: deliveryUnknownRuns.map((run) => run.id).sort()
      }
    } else if (!budgetEvent
        && !watchdogEvent
        && observedMonotonic > runnerDeadlineMonotonic + clockToleranceMs) {
      addIntegrityIssue(
        'execution_budget.core_runner_deadline_disagreement',
        'Runner monotonic watchdog passed the frozen deadline without Core exhaustion'
      )
      watchdogEvent = {
        reason: 'runner_elapsed_watchdog',
        elapsedSeconds,
        agentRuns: runs.length,
        observedA2aEffects,
        authority: 'runner_independent_watchdog'
      }
    }
    if (watchdogEvent && !cancellationSent && turn && !isTurnTerminal(turn.status)) {
      const cancelled = await core.request('campTurns.cancel', {
        commandId: crypto.randomUUID(),
        command: { campId, campTurnId, expectedVersion: turn.version }
      })
      cancellationSent = true
      watchdogEvent.cancellationResultDigest = digestJson(cancelled)
    }
    const allRunsTerminal = runs.length > 0 && runs.every((run) => isRunTerminal(run.status))
    if (turn && isTurnTerminal(turn.status) && allRunsTerminal) {
      const executionEvidenceCoverage = await collectAgentRunExecutionEvidencePages(
        core.request,
        campId,
        runs
      )
      snapshot.executionEvidence = executionEvidenceCoverage.evidence
      const finalObservation = normalizeSnapshot(snapshot)
      const finalObservationDigest = digestJson(finalObservation)
      if (finalObservationDigest !== lastDigest) {
        const record = {
          schemaVersion: 1,
          observedAt: new Date().toISOString(),
          digest: finalObservationDigest,
          snapshot: finalObservation
        }
        const line = `${JSON.stringify(record)}\n`
        await appendFile(observationPath, line, { mode: 0o600 })
        observationHashInput += line
        lastDigest = finalObservationDigest
      }
      return {
        snapshot,
        budgetEvent,
        watchdogEvent,
        integrityIssues,
        executionEvidenceCoverage,
        observationDigest: sha256(observationHashInput)
      }
    }
    if (budgetEvent || watchdogEvent) {
      terminalSince ??= performance.now()
      if (performance.now() - terminalSince > 60_000) {
        const terminationEvent = watchdogEvent ?? budgetEvent
        terminationEvent.cancellationConvergenceTimeout = true
        const executionEvidenceCoverage = await collectAgentRunExecutionEvidencePages(
          core.request,
          campId,
          runs
        )
        snapshot.executionEvidence = executionEvidenceCoverage.evidence
        executionEvidenceCoverage.coverage = {
          state: 'partial',
          reason: { code: 'tool_evidence.runtime_exit_incomplete' }
        }
        const finalObservation = normalizeSnapshot(snapshot)
        const finalObservationDigest = digestJson(finalObservation)
        if (finalObservationDigest !== lastDigest) {
          const record = {
            schemaVersion: 1,
            observedAt: new Date().toISOString(),
            digest: finalObservationDigest,
            snapshot: finalObservation
          }
          const line = `${JSON.stringify(record)}\n`
          await appendFile(observationPath, line, { mode: 0o600 })
          observationHashInput += line
          lastDigest = finalObservationDigest
        }
        return {
          snapshot,
          budgetEvent,
          watchdogEvent,
          integrityIssues,
          executionEvidenceCoverage,
          observationDigest: sha256(observationHashInput)
        }
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

function collectFinalResponseEvidence(snapshot, dispatchBoundary) {
  if (!snapshot || !dispatchBoundary) return { privateMessages: [], references: [] }
  const runIds = new Set(snapshot.agentRuns
    .filter((run) => run.campTurnId === dispatchBoundary.campTurnId)
    .map((run) => run.id))
  const candidates = snapshot.messages
    .filter((message) => (
      message.authorType === 'agent'
      && runIds.has(message.sourceAgentRunId)
    ))
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  const leadMessages = candidates.filter((message) => (
    message.sourceAgentRunId === dispatchBoundary.rootAgentRunId
  ))
  const selected = leadMessages.length > 0 ? leadMessages : candidates
  const privateMessages = selected.map((message, index) => ({
    messageId: message.id,
    agentProfileId: message.authorId,
    sourceAgentRunId: message.sourceAgentRunId,
    createdAt: message.createdAt,
    body: message.body,
    bodyDigest: sha256(message.body),
    bodyBytes: Buffer.byteLength(message.body),
    isFinal: index === selected.length - 1
  }))
  return {
    privateMessages,
    references: privateMessages.map(({ body, ...message }) => message)
  }
}

async function finishInvalid({ trialId, options, startedAt, error, evidenceDirectory, lifecyclePath, caseRecord, environmentManifest }) {
  const resultBundle = {
    schemaVersion: QUALIFICATION_TRIAL_SCHEMA_VERSION,
    runnerVersion: QUALIFICATION_RUNNER_VERSION,
    trialId,
    suiteId: options.suiteId ?? null,
    plannedSlotId: options.plannedSlotId ?? trialId,
    mode: options.mode,
    startedAt,
    completedAt: new Date().toISOString(),
    dispatchAccepted: false,
    validity: 'invalid',
    evaluationState: 'pending',
    verifiedDelivery: 'unavailable',
    orchestrationConvergence: 'unavailable',
    postDispatchHumanIntervention: 'indeterminate',
    hardOutcome: 'unavailable',
    overall: 'unavailable',
    stage: 'preflight',
    hardLayer: {
      verifiedDelivery: 'unavailable',
      orchestrationConvergence: 'unavailable',
      postDispatchHumanIntervention: 'indeterminate',
      overall: 'unavailable',
      convergenceFacts: {
        runTree: 'indeterminate',
        conversationInputs: 'indeterminate',
        approvals: 'indeterminate',
        budget: 'indeterminate',
        runtimeExit: 'indeterminate',
        externalEffects: 'indeterminate'
      },
      failureRecoveryFacts: []
    },
    case: caseRecord ? { id: caseRecord.contract.manifest.id, version: caseRecord.contract.manifest.version, seal: caseRecord.seal } : null,
    environmentManifestDigest: environmentManifest ? digestJson(environmentManifest) : null,
    preDispatchError: serializeError(error)
  }
  const revision = await appendResultRevision(evidenceDirectory, resultBundle)
  await appendPrivateLine(lifecyclePath, { schemaVersion: 1, state: 'invalid', occurredAt: new Date().toISOString(), errorCode: error.name ?? 'Error' })
  const resultDigest = revision.record.resultDigest
  await writeFile(join(evidenceDirectory, 'CAPTURE_COMPLETE'), `${resultDigest}\n`, { mode: 0o600 })
  await writeFile(join(evidenceDirectory, 'COMPLETE'), `${resultDigest}\n`, { mode: 0o600 })
  const publication = await publishQualificationEvidenceBundle({
    evidenceDirectory,
    result: revision.resultBundle,
    resultDigest,
    caseRecord,
    producerDigest: environmentManifest?.runnerDigest ?? await computeQualificationEvaluatorDigest(),
    evidenceIndex: null,
    collaborationLedger: null,
    toolCallLedger: null,
    workspaceMutationLedger: null,
    evaluationAttempts: []
  })
  return {
    resultBundle: revision.resultBundle,
    redactedSummary: revision.redactedSummary,
    evidenceDirectory,
    ...publication
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
  return {
    name: error?.name ?? 'Error',
    code: typeof error?.code === 'string' ? error.code : null,
    message: error?.message ?? String(error)
  }
}

function parseArguments(args) {
  const values = {}
  while (args.length > 0) {
    const argument = args.shift()
    if (!argument.startsWith('--')) usage()
    const key = argument.slice(2)
    if (![
      'mode',
      'core',
      'case',
      'expected-seal',
      'evidence-root',
      'team-private-dir',
      'trial-id',
      'planned-slot-id',
      'suite-id',
      'isolation-profile'
    ].includes(key)) usage()
    values[key] = args.shift()
    if (!values[key]) usage()
  }
  if (!['demo', 'diagnostic', 'formal'].includes(values.mode) || !values.core || !values.case || !values['evidence-root'] || !values['team-private-dir']) usage()
  return {
    mode: values.mode,
    coreExecutable: resolve(values.core),
    caseDirectory: resolve(values.case),
    expectedSeal: values['expected-seal'] ?? null,
    evidenceRoot: resolve(values['evidence-root']),
    antigravityTeamPrivateDirectory: resolve(values['team-private-dir']),
    isolationProfilePath: values['isolation-profile']
      ? resolve(values['isolation-profile'])
      : null,
    suiteId: values['suite-id'] ?? null,
    trialId: values['trial-id'] ?? null,
    plannedSlotId: values['planned-slot-id'] ?? null
  }
}

function usage() {
  console.error('Usage: node scripts/qualification-runner.mjs --mode <demo|diagnostic|formal> --core <path> --case <path> --evidence-root <path> --team-private-dir <path> [--expected-seal <sha256>] [--trial-id <id>] [--planned-slot-id <id>] [--suite-id <id>] [--isolation-profile <private-json>]')
  process.exit(2)
}

const FROZEN_TEAM = [
  {
    agentProfileId: 'agent_1',
    adapterKind: 'codex-cli',
    model: { mode: 'explicit', modelId: 'gpt-5.6-sol', options: { reasoning_effort: 'medium' } },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } }
  },
  {
    agentProfileId: 'agent_2',
    adapterKind: 'codex-cli',
    model: { mode: 'explicit', modelId: 'gpt-5.6-sol', options: { reasoning_effort: 'medium' } },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } }
  },
  {
    agentProfileId: 'agent_3',
    adapterKind: 'opencode-cli',
    model: { mode: 'explicit', modelId: 'opencode/big-pickle', options: {} },
    permissions: { adapterKind: 'opencode-cli', schemaVersion: 1, values: { permission: 'allow' } }
  },
  {
    agentProfileId: 'agent_4',
    adapterKind: 'antigravity-app',
    model: { mode: 'explicit', modelId: 'gemini-3.6-flash-high', options: {} },
    permissions: { adapterKind: 'antigravity-app', schemaVersion: 1, values: { mode: 'accept-edits', sandbox: 'on', dangerously_skip_permissions: 'on' } }
  }
]

const result = await runTrial(arguments_)
console.log(JSON.stringify(result.redactedSummary, null, 2))
if (result.redactedSummary.overall === 'unavailable') process.exitCode = 2
else if (result.redactedSummary.overall === 'fail') process.exitCode = 1
