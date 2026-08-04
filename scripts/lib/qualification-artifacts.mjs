import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  QUALIFICATION_RUNNER_VERSION,
  canonicalJson,
  digestJson,
  sha256,
  writePrivateJsonExclusive
} from './qualification-common.mjs'
import { validateQualificationArtifactSchema } from './qualification-schema-validation.mjs'

const COMPLETE = Object.freeze({ state: 'complete', reason: null })

export async function buildAndRetainQualificationArtifacts({
  evidenceDirectory,
  result,
  caseRecord,
  producerDigest,
  evidenceIndex,
  collaborationLedger,
  toolCallLedger,
  workspaceMutationLedger,
  publicReport,
  semanticReview = null,
  evaluationAttempts = []
}) {
  const references = {}
  const locators = {}
  let isolationArtifact = null
  if (result.isolationProfile?.status === 'admitted') {
    isolationArtifact = await readOptionalJson(
      join(evidenceDirectory, 'intervention-isolation-profile.json')
    )
    if (isolationArtifact) {
      validateQualificationArtifactSchema(
        'intervention-isolation-profile.schema.json',
        isolationArtifact
      )
      addExisting('intervention_isolation_profile', isolationArtifact)
    }
  }

  let caseArtifact = null
  let catalogArtifact = null
  if (caseRecord) {
    caseArtifact = buildQualificationCaseArtifact({
      result,
      caseRecord,
      producerDigest
    })
    catalogArtifact = buildVerificationCatalogArtifact({
      result,
      caseRecord,
      producerDigest
    })
    await addRetained('qualification_case', caseArtifact)
    await addRetained('verification_catalog', catalogArtifact)
  }

  let snapshotArtifact = null
  if (result.deliveredWorkspaceSnapshot) {
    const retainedManifest = await readOptionalJson(
      join(evidenceDirectory, 'delivered-workspace-manifest.json')
    )
    if (retainedManifest && evidenceIndex) {
      snapshotArtifact = buildDeliveredWorkspaceSnapshotArtifact({
        result,
        retainedManifest,
        evidenceIndex,
        producerDigest
      })
      await addRetained('delivered_workspace_snapshot', snapshotArtifact)
    }
  }

  let verifierArtifact = null
  if (result.verifier && catalogArtifact && evidenceIndex) {
    verifierArtifact = buildVerifierObservationArtifact({
      result,
      catalogArtifact,
      evidenceIndex,
      producerDigest
    })
    await addRetained('verifier_observation', verifierArtifact)
  }

  let environmentArtifact = null
  const rawEnvironment = await readOptionalJson(join(evidenceDirectory, 'environment-manifest.json'))
  if (rawEnvironment) {
    environmentArtifact = buildQualificationEnvironmentArtifact({
      result,
      rawEnvironment,
      isolationArtifact,
      producerDigest
    })
    if (environmentArtifact) await addRetained('environment_manifest', environmentArtifact)
  }

  addExisting('evidence_index', evidenceIndex)
  addExisting('collaboration_ledger', collaborationLedger)
  addExisting('tool_call_ledger', toolCallLedger)
  addExisting('workspace_mutation_ledger', workspaceMutationLedger)
  addExisting('semantic_engineering_review', semanticReview)
  addExisting('public_export', publicReport)

  const trialArtifact = buildQualificationTrialArtifact({
    result,
    producerDigest,
    collaborationLedger,
    toolCallLedger,
    workspaceMutationLedger,
    semanticReview,
    evidenceIndex,
    evaluationAttempts
  })
  await addRetained('qualification_trial', trialArtifact)

  return { artifacts: references, locators }

  async function addRetained(role, artifact) {
    const locator = join('normalized-artifacts', role, `${artifact.artifactId}.json`)
    await writeImmutableOrVerify(join(evidenceDirectory, locator), artifact)
    references[role] = artifactReference(artifact)
    locators[role] = locator
  }

  function addExisting(role, artifact) {
    if (!artifact) return
    references[role] = artifactReference(artifact)
  }
}

export function buildQualificationCaseArtifact({ result, caseRecord, producerDigest }) {
  const manifest = caseRecord.contract.manifest
  const categories = [...new Set(manifest.verificationCatalog.map((check) => check.categoryId))]
    .sort()
    .map((categoryId) => ({ categoryId, label: categoryId.replaceAll('_', ' ') }))
  const isolationProfile = result.isolationProfile?.status === 'admitted'
    ? {
        profileId: stableId(result.isolationProfile.artifactId ?? 'formal-isolation-profile'),
        version: result.isolationProfile.profileVersion,
        digest: withSha256Prefix(
          result.isolationProfile.payloadDigest ?? result.isolationProfile.artifactDigest
        )
      }
    : {
        profileId: 'public-demo-no-formal-isolation',
        version: '1.0.0',
        digest: digest({ mode: 'demo', applicability: 'not_applicable' })
      }
  const payload = {
    caseId: manifest.id,
    caseVersion: manifest.version,
    caseSeal: withSha256Prefix(caseRecord.seal),
    visibility: manifest.visibility,
    title: manifest.title ?? manifest.id,
    requestDigest: withSha256Prefix(caseRecord.contract.components.promptDigest),
    fixtureDigest: withSha256Prefix(caseRecord.contract.fixture.digest),
    categories,
    requirements: structuredClone(manifest.requirements),
    changeBoundary: {
      allowed: [...manifest.allowedPaths],
      forbidden: [...manifest.forbiddenPaths]
    },
    executionBudget: {
      elapsedSeconds: manifest.budget.elapsedSeconds,
      maxAgentRunResponsibilities: manifest.budget.maxAgentRuns,
      maxAcceptedA2A: manifest.budget.maxAcceptedA2a
    },
    isolationProfile
  }
  const artifact = envelope({
    artifactId: `qualification-case:${manifest.id}:${manifest.version}`,
    schemaId: 'rovai.qualification.case',
    schemaVersion: '1.0.0',
    producer: producer(
      'qualification-case-admission',
      '1.0.0',
      caseRecord.contract.components.manifestDigest
    ),
    binding: { caseId: manifest.id, caseSeal: withSha256Prefix(caseRecord.seal) },
    sourceBoundaries: [boundary(
      'runner',
      'runner.sealed-qualification-case',
      { seal: caseRecord.seal, components: caseRecord.contract.components },
      COMPLETE
    )],
    payload
  })
  validateQualificationArtifactSchema('qualification-case.schema.json', artifact)
  return artifact
}

export function buildVerificationCatalogArtifact({ result, caseRecord, producerDigest }) {
  const manifest = caseRecord.contract.manifest
  const payload = {
    catalogId: `verification-catalog:${manifest.id}:${manifest.version}`,
    caseId: manifest.id,
    caseSeal: withSha256Prefix(caseRecord.seal),
    checks: structuredClone(manifest.verificationCatalog)
  }
  const artifact = envelope({
    artifactId: payload.catalogId,
    schemaId: 'rovai.qualification.verification-catalog',
    schemaVersion: '1.1.0',
    producer: runnerProducer(producerDigest),
    binding: resultBinding(result),
    sourceBoundaries: [boundary(
      'runner',
      'runner.verification-catalog',
      manifest.verificationCatalog,
      COMPLETE
    )],
    payload
  })
  validateQualificationArtifactSchema('verification-catalog.schema.json', artifact)
  return artifact
}

export function buildDeliveredWorkspaceSnapshotArtifact({
  result,
  retainedManifest,
  evidenceIndex,
  producerDigest
}) {
  const files = retainedManifest.entries.filter((entry) => entry.type === 'file')
  const managedProjectionExclusions = result.managedProjectionDiff?.changed?.length > 0
    ? [{
        projectionId: 'runner-managed-runtime-projections',
        digest: withSha256Prefix(result.managedProjectionDiff.digest),
        reason: { code: 'delivered_snapshot.runtime_projection_excluded' }
      }]
    : []
  const barrierReference = evidenceReference(
    evidenceIndex,
    'runner.delivered-workspace-boundary'
  )
  const payload = {
    snapshotId: `delivered-workspace-snapshot:${result.deliveredWorkspaceSnapshot.digest.slice(0, 32)}`,
    barrierId: `freeze-barrier:${result.trialId}`,
    caseSeal: withSha256Prefix(result.case.seal),
    capturedAt: result.deliveredWorkspaceSnapshot.capturedAt ?? result.completedAt,
    archiveDigest: withSha256Prefix(result.deliveredWorkspaceSnapshot.digest),
    manifestDigest: withSha256Prefix(retainedManifest.digest),
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    managedProjectionExclusions,
    barrierEvidenceReferences: [barrierReference],
    coverage: COMPLETE
  }
  const artifact = envelope({
    artifactId: payload.snapshotId,
    schemaId: 'rovai.qualification.delivered-workspace-snapshot',
    schemaVersion: '1.0.0',
    producer: runnerProducer(producerDigest),
    binding: resultBinding(result),
    sourceBoundaries: [boundary(
      'runner',
      'runner.workspace',
      retainedManifest,
      COMPLETE
    )],
    payload
  })
  validateQualificationArtifactSchema('delivered-workspace-snapshot.schema.json', artifact)
  return artifact
}

export function buildVerifierObservationArtifact({
  result,
  catalogArtifact,
  evidenceIndex,
  producerDigest
}) {
  const processState = result.verifier.process.timedOut
    ? 'timed_out'
    : result.verifier.process.signal
      ? 'signaled'
      : result.verifier.process.code === 0 ? 'succeeded' : 'nonzero_exit'
  const payload = {
    attemptId: result.deliveredWorkspaceSnapshot.evaluationAttemptId,
    caseSeal: withSha256Prefix(result.case.seal),
    catalogArtifact: artifactReference(catalogArtifact),
    deliveredWorkspaceDigest: withSha256Prefix(result.deliveredWorkspaceSnapshot.digest),
    verifierDigest: withSha256Prefix(result.evaluationIdentity.verifierDigest),
    verifierConfigurationDigest: withSha256Prefix(
      result.evaluationIdentity.verifierConfigurationDigest
    ),
    process: {
      state: processState,
      startedAt: null,
      endedAt: null,
      exitCode: result.verifier.process.code,
      signal: result.verifier.process.signal
    },
    validationState: result.verifier.validationState,
    validationErrors: (result.verifier.validationErrors ?? []).map((error) => ({
      code: stableId(error.code ?? 'verifier.invalid'),
      ...(error.detail ? { detail: String(error.detail).slice(0, 1_200) } : {})
    })),
    checkResults: result.verifier.checkResults.map((check) => ({
      checkId: check.checkId,
      kind: check.kind,
      categoryId: check.categoryId,
      requirementIds: [...check.requirementIds],
      status: check.status,
      evidenceReferences: [evidenceReference(evidenceIndex, `verifier.check:${check.checkId}`)]
    }))
  }
  const artifact = envelope({
    artifactId: `verifier-observation:${payload.attemptId}`,
    schemaId: 'rovai.qualification.verifier-observation',
    schemaVersion: '1.0.0',
    producer: producer(
      'withheld-verifier',
      '1.0.0',
      result.evaluationIdentity.verifierDigest
    ),
    binding: resultBinding(result),
    sourceBoundaries: [boundary(
      'verifier',
      'verifier.observation',
      result.verifier,
      COMPLETE
    )],
    payload
  })
  validateQualificationArtifactSchema('verifier-observation.schema.json', artifact)
  return artifact
}

export function buildQualificationEnvironmentArtifact({
  result,
  rawEnvironment,
  isolationArtifact,
  producerDigest
}) {
  const readModelSchema = rawEnvironment.releaseCore?.readModelSchema
  const attestedTeamProtocol = rawEnvironment.releaseCore?.attestedTeamProtocol
  const coreVersion = rawEnvironment.releaseCore?.version
  if (!Number.isInteger(readModelSchema)
      || !Number.isInteger(attestedTeamProtocol)
      || typeof coreVersion !== 'string') {
    return null
  }
  const installations = new Map(rawEnvironment.runtimeInstallations.map((item) => [
    item.adapterKind,
    item
  ]))
  const runtimes = rawEnvironment.team.map((member) => {
    const installation = installations.get(member.runtimeSelection.adapterKind)
    return {
      memberId: member.id,
      adapter: member.runtimeSelection.adapterKind,
      reportedVersion: installation?.reportedVersion ?? 'unavailable',
      executableDigest: withSha256Prefix(
        installation?.executableFingerprint ?? '0'.repeat(64)
      ),
      configurationDigest: digest(member.runtimePreference ?? null),
      capabilityDigest: withSha256Prefix(
        installation?.capabilitiesDigest ?? digestJson(null)
      ),
      modelSnapshotId: member.runtimePreference?.model?.modelId ?? 'unavailable',
      modelOptionsDigest: digest(member.runtimePreference?.model?.options ?? {}),
      readiness: member.readiness?.status === 'ready'
        ? 'ready'
        : member.readiness?.status === 'not_ready' ? 'not_ready' : 'indeterminate'
    }
  })
  const gitRemoteState = isolationArtifact?.payload?.channels?.gitRemoteMutation?.state
  const payload = {
    environmentId: `qualification-environment:${result.trialId}`,
    capturedAt: rawEnvironment.collectedAt,
    repository: {
      commit: rawEnvironment.productGit.commit,
      dirtyState: rawEnvironment.productGit.dirty ? 'dirty' : 'clean',
      dirtyDiffDigest: rawEnvironment.productGit.dirty
        ? withSha256Prefix(rawEnvironment.productGit.statusDigest)
        : null
    },
    runner: {
      version: rawEnvironment.runnerVersion,
      digest: withSha256Prefix(rawEnvironment.runnerDigest),
      configurationDigest: digest({
        mode: rawEnvironment.mode,
        case: rawEnvironment.case,
        runnerVersion: rawEnvironment.runnerVersion
      })
    },
    core: {
      version: coreVersion,
      executableDigest: withSha256Prefix(rawEnvironment.releaseCore.digest),
      readModelSchema,
      attestedTeamProtocol
    },
    host: {
      operatingSystem: rawEnvironment.host.type ?? rawEnvironment.host.platform,
      version: rawEnvironment.host.release,
      architecture: rawEnvironment.host.architecture,
      timezone: rawEnvironment.host.timezone
    },
    teamConfigurationDigest: withSha256Prefix(
      rawEnvironment.teamRuntimeCompatibilityDigest
    ),
    runtimes,
    toolchain: rawEnvironment.toolchain.map((tool) => ({
      tool: stableId(tool.name),
      version: tool.version,
      digest: withSha256Prefix(tool.outputDigest)
    })),
    networkPolicyDigest: digest(
      isolationArtifact?.payload?.channels?.networkMutation
        ?? rawEnvironment.interventionIsolationProfile
    ),
    gitRemoteMutationPolicy: gitRemoteState === 'disabled'
      ? 'disabled'
      : gitRemoteState ? 'ledgered' : 'indeterminate',
    isolationProfileArtifact: isolationArtifact ? artifactReference(isolationArtifact) : null,
    clockObservation: {
      wallClockSource: 'runner-system-wall-clock',
      monotonicClockSource: 'runner-performance-monotonic-clock',
      correlationDigest: digest({
        collectedAt: rawEnvironment.collectedAt,
        dispatchAcceptedAt: result.dispatchBoundary?.runnerObservedAcceptedAt ?? null,
        deadlineAt: result.dispatchBoundary?.executionBudget?.deadlineAt ?? null
      })
    }
  }
  const artifact = envelope({
    artifactId: payload.environmentId,
    schemaId: 'rovai.qualification.environment-manifest',
    schemaVersion: '1.1.0',
    producer: runnerProducer(producerDigest),
    binding: resultBinding(result),
    sourceBoundaries: [boundary(
      'runner',
      'runner.environment',
      rawEnvironment,
      COMPLETE
    )],
    payload
  })
  validateQualificationArtifactSchema(
    'qualification-environment-manifest-v1.1.schema.json',
    artifact
  )
  return artifact
}

export function buildQualificationTrialArtifact({
  result,
  producerDigest,
  collaborationLedger,
  toolCallLedger,
  workspaceMutationLedger,
  semanticReview,
  evidenceIndex,
  evaluationAttempts
}) {
  const deliveryLayer = result.deliveryLayer && evidenceIndex ? {
    requirements: result.deliveryLayer.requirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      criticality: requirement.criticality,
      status: requirement.status,
      checkIds: [...requirement.checkIds]
    })),
    categories: result.deliveryLayer.categories.map((category) => ({
      categoryId: category.categoryId,
      status: category.status,
      checkIds: [...category.checkIds]
    })),
    failedRequirementIds: [...result.deliveryLayer.failedRequirementIds],
    earliestFailureStage: result.deliveryLayer.primaryFailureStage,
    failureFacts: result.deliveryLayer.failureFacts.map((failure) => ({
      failureFactId: failure.failureFactId,
      stage: stableId(failure.stage),
      classification: stableId(failure.classification),
      evidenceReferences: [evidenceReference(
        evidenceIndex,
        `derived.failure:${failure.failureFactId}`
      )]
    })),
    workspaceChangeSummary: {
      coverage: result.deliveryLayer.workspaceChangeSummary.coverage === 'complete'
        ? COMPLETE
        : {
            state: 'partial',
            reason: { code: 'qualification_trial.workspace_change_summary_partial' }
          },
      created: result.deliveryLayer.workspaceChangeSummary.created,
      modified: result.deliveryLayer.workspaceChangeSummary.modified,
      deleted: result.deliveryLayer.workspaceChangeSummary.deleted,
      renamed: result.deliveryLayer.workspaceChangeSummary.renamed
    },
    finalResponseEvidence: result.deliveryLayer.finalResponseEvidence
      .map((message) => structuredClone(message.evidenceReference))
  } : null
  const payload = {
    trialId: result.trialId,
    plannedSlotId: result.plannedSlotId,
    validity: result.validity,
    evaluationState: result.evaluationState,
    dispatchAccepted: result.dispatchAccepted,
    stage: normalizeStage(result.stage),
    hardOutcome: result.hardOutcome,
    hardLayer: {
      verifiedDelivery: result.hardLayer.verifiedDelivery,
      orchestrationConvergence: result.hardLayer.orchestrationConvergence,
      postDispatchHumanIntervention: result.hardLayer.postDispatchHumanIntervention,
      overall: result.hardLayer.overall,
      convergenceFacts: structuredClone(result.hardLayer.convergenceFacts)
    },
    deliveryLayer,
    collaborationArtifact: nullableArtifactReference(collaborationLedger),
    toolArtifact: nullableArtifactReference(toolCallLedger),
    mutationArtifact: nullableArtifactReference(workspaceMutationLedger),
    semanticReviewArtifact: nullableArtifactReference(semanticReview),
    evidenceIndexArtifact: nullableArtifactReference(evidenceIndex),
    evaluationAttempts: evaluationAttempts.map((attempt) => ({
      artifactId: `evaluation-attempt:${stableId(attempt.attemptId)}`,
      schemaId: 'rovai.qualification.evaluation-attempt',
      schemaVersion: `${Number.isInteger(attempt.schemaVersion) ? attempt.schemaVersion : 1}.0.0`,
      payloadDigest: digest(attempt)
    }))
  }
  const identity = result.resultRevision?.revisionId ?? sha256(canonicalJson(payload)).slice(0, 32)
  const artifact = envelope({
    artifactId: `qualification-trial:${stableId(identity)}`,
    schemaId: 'rovai.qualification.trial',
    schemaVersion: '1.1.0',
    producer: runnerProducer(producerDigest),
    binding: resultBinding(result),
    sourceBoundaries: evidenceIndex?.sourceBoundaries?.length
      ? evidenceIndex.sourceBoundaries.map((item) => structuredClone(item))
      : [boundary('runner', 'runner.pre-dispatch-attempt', result, COMPLETE)],
    payload
  })
  validateQualificationArtifactSchema('qualification-trial-v1.1.schema.json', artifact)
  return artifact
}

function envelope({
  artifactId,
  schemaId,
  schemaVersion,
  producer,
  binding,
  sourceBoundaries,
  payload
}) {
  return {
    artifactId,
    schemaId,
    schemaVersion,
    producer,
    binding,
    sourceBoundaries,
    payloadDigest: digest(payload),
    payload
  }
}

function boundary(authorityClass, sourceId, value, coverage) {
  return {
    authorityClass,
    sourceId,
    digest: digest(value),
    throughSequence: null,
    declaredTotal: null,
    clockDomain: null,
    coverage
  }
}

function runnerProducer(producerDigest) {
  return producer('rovai-qualification-runner', QUALIFICATION_RUNNER_VERSION, producerDigest)
}

function producer(id, version, producerDigest) {
  return { id, version, digest: withSha256Prefix(producerDigest) }
}

function resultBinding(result) {
  return compactObject({
    suiteId: result.suiteId ?? null,
    plannedSlotId: result.plannedSlotId,
    trialId: result.trialId,
    caseId: result.case?.id ?? null,
    caseSeal: result.case?.seal ? withSha256Prefix(result.case.seal) : null
  })
}

function evidenceReference(index, evidenceId) {
  if (!index?.payload?.records?.some((record) => record.evidenceId === evidenceId)) {
    throw new Error(`Qualification artifact has unresolved Evidence Reference ${evidenceId}`)
  }
  return { artifactId: index.artifactId, evidenceId }
}

function artifactReference(artifact) {
  return {
    artifactId: artifact.artifactId,
    schemaId: artifact.schemaId,
    schemaVersion: artifact.schemaVersion,
    payloadDigest: artifact.payloadDigest
  }
}

function nullableArtifactReference(artifact) {
  return artifact ? artifactReference(artifact) : null
}

async function writeImmutableOrVerify(path, artifact) {
  try {
    await writePrivateJsonExclusive(path, artifact)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const retained = JSON.parse(await readFile(path, 'utf8'))
    if (canonicalJson(retained) !== canonicalJson(artifact)) {
      throw new Error('immutable normalized Qualification artifact identity collision')
    }
  }
}

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function normalizeStage(stage) {
  if ([
    'preflight',
    'execution',
    'freeze_barrier',
    'verification',
    'hard_derivation',
    'reporting',
    'complete'
  ].includes(stage)) return stage
  return stage === 'passed' || stage === 'failed' ? 'complete' : 'reporting'
}

function withSha256Prefix(value) {
  if (typeof value !== 'string') throw new Error('sha256 identity is required')
  return value.startsWith('sha256:') ? value : `sha256:${value}`
}

function digest(value) {
  return `sha256:${digestJson(value)}`
}

function stableId(value) {
  const text = String(value)
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(text)
    ? text
    : sha256(text).slice(0, 32)
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined))
}
