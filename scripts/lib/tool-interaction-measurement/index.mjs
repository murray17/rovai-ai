import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  atomicWriteJson,
  canonicalJson,
  digestJson,
  sha256,
  validateRelativeLocator,
  writePrivateJsonExclusive
} from '../qualification-common.mjs'
import { validateQualificationContractArtifactSchema } from '../qualification-schema-validation.mjs'

export const TOOL_INTERACTION_MEASUREMENT_SCHEMA_VERSION = '1.0.0'
export const TOOL_INTERACTION_MEASUREMENT_SCHEMA_ID =
  'rovai.qualification.tool-interaction-measurement'
export const TOOL_USE_JUDGE_PACK_SCHEMA_ID = 'rovai.qualification.tool-use-judge-pack'
export const TOOL_INTERACTION_SOURCE_SCHEMA_ID = 'rovai.qualification.tool-interaction-source'
export const TOOL_INTERACTION_MEASUREMENT_POLICY_ID = 'tool-interaction-measurement-v1'
export const TOOL_USE_JUDGE_PACK_POLICY_ID = 'tool-use-judge-pack-treatment-blind-v1'

const SCHEMA_VERSION = TOOL_INTERACTION_MEASUREMENT_SCHEMA_VERSION
const MEASUREMENT_SCHEMA_ID = TOOL_INTERACTION_MEASUREMENT_SCHEMA_ID
const JUDGE_PACK_SCHEMA_ID = TOOL_USE_JUDGE_PACK_SCHEMA_ID
const MEASUREMENT_POLICY_ID = TOOL_INTERACTION_MEASUREMENT_POLICY_ID
const JUDGE_POLICY_ID = TOOL_USE_JUDGE_PACK_POLICY_ID
const MAX_TEXT_CHARACTERS = 20_000

const MODES = new Set(['forced_use', 'natural_use', 'non_use_control'])
const ADAPTER_OPERATIONS = Object.freeze({
  camp_history: Object.freeze(['camp.list', 'camp.search', 'camp.read']),
  memory_retrieval: Object.freeze(['memory.search', 'memory.read']),
  memory_mutation: Object.freeze(['memory.write']),
  camp_message_send: Object.freeze(['camp.message.send'])
})

export const TOOL_USE_JUDGE_CHECKLIST = Object.freeze([
  'SER.tool_use.selection_necessity',
  'SER.tool_use.input_strategy',
  'SER.tool_use.result_interpretation',
  'SER.tool_use.downstream_use',
  'SER.memory.retention_quality'
])
const TOOL_USE_CHECKLIST = TOOL_USE_JUDGE_CHECKLIST
const TOOL_USE_CHECKLIST_SET = new Set(TOOL_USE_CHECKLIST)

const MODEL_FORBIDDEN_KEYS = new Set([
  'arm',
  'artifactId',
  'binding',
  'caseId',
  'evidenceId',
  'evidenceMap',
  'evidenceReference',
  'evidenceReferences',
  'oracle',
  'oracleDigest',
  'payloadDigest',
  'solo',
  'sourceBoundaries',
  'team',
  'treatment',
  'trialId',
  'withheldOracle'
])

const SCORE_KEYS = new Set(['score', 'aggregateScore'])

/**
 * Build the deterministic, oracle-aware Tool Interaction Measurement.
 * The withheld oracle is consumed here and represented only by a digest and
 * categorical/count-based conclusions. It is never copied into an artifact.
 */
export function buildToolInteractionMeasurement({
  caseId,
  trialId,
  measurementSpec,
  toolEvidence,
  effectEvidence = [],
  producerDigest
}) {
  requireIdentifier(caseId, 'caseId')
  requireIdentifier(trialId, 'trialId')
  const specification = normalizeMeasurementSpec(measurementSpec)
  const effects = normalizeEffects(effectEvidence)
  const normalized = normalizeInteractions(toolEvidence)
  const sourceCoverage = effectiveCoverage(toolEvidence?.coverage, normalized)

  const opportunities = specification.opportunities.map((opportunity) => {
    const interactions = normalized.interactions.filter((interaction) => (
      opportunity.allowedOperations.includes(interaction.canonicalTool)
    ))
    const effectBindings = bindEffects(interactions, effects)
    const assessment = assessOpportunity({
      opportunity,
      interactions,
      effectBindings,
      sourceCoverage
    })
    const references = uniqueReferences([
      ...interactions.flatMap((interaction) => interaction.evidenceReferences),
      ...effectBindings.flatMap((binding) => binding.evidenceReferences)
    ])
    return {
      opportunityId: opportunity.opportunityId,
      adapter: opportunity.adapter,
      mode: opportunity.mode,
      allowedOperations: [...opportunity.allowedOperations],
      semanticItems: [...opportunity.semanticItems],
      oracleDigest: digest(opportunity.oracle),
      coverage: structuredClone(sourceCoverage),
      status: assessment.status,
      deterministicAssessment: assessment.deterministicAssessment,
      interactionIds: interactions.map((interaction) => interaction.interactionId),
      effectBindings,
      evidenceReferences: references
    }
  })

  const payload = {
    policyId: MEASUREMENT_POLICY_ID,
    specification: {
      specificationId: specification.specificationId,
      specificationDigest: digest(measurementSpec),
      opportunityCount: opportunities.length
    },
    sourceCoverage,
    interactions: normalized.interactions,
    opportunities,
    denominator: {
      basis: 'pre_registered_opportunities',
      total: opportunities.length,
      pass: opportunities.filter((item) => item.status === 'pass').length,
      fail: opportunities.filter((item) => item.status === 'fail').length,
      indeterminate: opportunities.filter((item) => item.status === 'indeterminate').length
    }
  }
  assertNoCanary(
    payload,
    uniqueStrings(specification.opportunities.flatMap((item) => item.oracle.canaries ?? []))
  )
  const artifact = envelope({
    artifactId: `tool-interaction-measurement:${digest(payload).slice(7, 39)}`,
    schemaId: MEASUREMENT_SCHEMA_ID,
    producerDigest,
    binding: { caseId, trialId },
    sourceId: 'core.tool-interaction-evidence',
    coverage: sourceCoverage,
    payload
  })
  validateMeasurementArtifact(artifact)
  return artifact
}

/**
 * Build the treatment-blind, oracle-blind Tool-Use Judge Pack. The caller must
 * pass only payload.modelInput to a model adapter; evidenceMap is audit-only.
 */
export function buildToolUseJudgePack({
  measurement,
  disclosedTask,
  treatmentCanaries = [],
  producerDigest
}) {
  validateMeasurementArtifact(measurement)
  const task = normalizeDisclosedTask(disclosedTask)
  const canaries = uniqueStrings(treatmentCanaries.map((canary) => (
    requireBoundedString(canary, 'treatment canary', 240)
  )))
  const payload = projectToolUseJudgePayload(measurement, task)
  assertNoCanary(payload.modelInput, canaries)
  const artifact = envelope({
    artifactId: `tool-use-judge-pack:${digest(payload).slice(7, 39)}`,
    schemaId: JUDGE_PACK_SCHEMA_ID,
    producerDigest,
    binding: structuredClone(measurement.binding),
    sourceId: 'derived.tool-use-judge-model-projection',
    coverage: measurement.payload.sourceCoverage,
    payload
  })
  validateJudgePackArtifact(artifact, measurement)
  return artifact
}

function projectToolUseJudgePayload(measurement, task) {
  const localEvidence = buildLocalEvidenceMap(measurement)
  const interactionsById = new Map(measurement.payload.interactions.map((item) => (
    [item.interactionId, item]
  )))

  const opportunities = measurement.payload.opportunities.map((opportunity) => {
    const interactions = opportunity.interactionIds.map((id) => interactionsById.get(id))
    const effectBindings = opportunity.effectBindings
    const interactionEvidenceIds = localIdsForReferences(
      interactions.flatMap((interaction) => interaction.evidenceReferences),
      localEvidence.byReference
    )
    const retrievedContentEvidenceIds = localIdsForReferences(
      effectBindings
        .filter((binding) => binding.kind === 'retrieved_content')
        .flatMap((binding) => binding.evidenceReferences),
      localEvidence.byReference
    )
    const downstreamEvidenceIds = localIdsForReferences(
      effectBindings
        .filter((binding) => binding.kind !== 'retrieved_content')
        .flatMap((binding) => binding.evidenceReferences),
      localEvidence.byReference
    )
    const checklistCoverage = buildChecklistCoverage({
      opportunity,
      interactions,
      effectBindings,
      interactionEvidenceIds,
      retrievedContentEvidenceIds,
      downstreamEvidenceIds
    })
    return {
      opportunityId: opportunity.opportunityId,
      adapter: opportunity.adapter,
      coverage: structuredClone(opportunity.coverage),
      interactions: interactions.map((interaction) => ({
        localInteractionId: interaction.interactionId,
        canonicalTool: interaction.canonicalTool,
        lifecycle: structuredClone(interaction.lifecycle),
        authorization: structuredClone(interaction.authorization),
        operationProjection: structuredClone(interaction.operationProjection),
        replay: structuredClone(interaction.replay),
        evidenceIds: localIdsForReferences(
          interaction.evidenceReferences,
          localEvidence.byReference
        )
      })),
      downstreamEffects: (opportunity.adapter === 'camp_message_send' ? [] : effectBindings)
        .map((binding) => ({
          localEffectId: binding.effectId,
          kind: binding.kind,
          content: binding.content,
          contentDigest: binding.contentDigest,
          relation: binding.relation,
          evidenceIds: localIdsForReferences(
            binding.evidenceReferences,
            localEvidence.byReference
          )
        })),
      checklistCoverage
    }
  })

  const modelInput = {
    policyId: JUDGE_POLICY_ID,
    disclosedTask: task,
    checklist: [...TOOL_USE_CHECKLIST],
    opportunities
  }
  assertNoForbiddenModelKeys(modelInput)
  return {
    policyId: JUDGE_POLICY_ID,
    measurementArtifact: artifactReference(measurement),
    modelInputDigest: digest(modelInput),
    modelInput,
    evidenceMap: localEvidence.evidenceMap
  }
}

/** Validate one Measurement and its optional derived Judge Pack. */
export function validateToolInteractionArtifacts({
  measurement,
  judgePack = null,
  evidenceIndex = null
}) {
  validateMeasurementArtifact(measurement)
  if (judgePack !== null) validateJudgePackArtifact(judgePack, measurement)
  if (evidenceIndex !== null) validateEvidenceClosure(measurement, judgePack, evidenceIndex)
  return true
}

export function buildToolInteractionSourceArtifact({
  measurement,
  measurementSpec,
  toolEvidence,
  effectEvidence = [],
  preparedFixtureArtifact,
  producerDigest
}) {
  validateMeasurementArtifact(measurement)
  if (!isObject(preparedFixtureArtifact)) {
    throw new Error('Tool Interaction source requires a Prepared Fixture reference')
  }
  const payload = {
    policyId: 'tool-interaction-private-replay-source-v1',
    measurementArtifact: artifactReference(measurement),
    preparedFixtureArtifact: structuredClone(preparedFixtureArtifact),
    measurementSpec: structuredClone(measurementSpec),
    toolEvidence: structuredClone(toolEvidence),
    effectEvidence: structuredClone(effectEvidence)
  }
  const artifact = {
    artifactId: `tool-interaction-source:${digest(payload).slice(7, 39)}`,
    schemaId: TOOL_INTERACTION_SOURCE_SCHEMA_ID,
    schemaVersion: SCHEMA_VERSION,
    producer: {
      id: 'rovai-benchmark-tool-interaction-private-source',
      version: SCHEMA_VERSION,
      digest: withSha256Prefix(producerDigest)
    },
    binding: structuredClone(measurement.binding),
    payloadDigest: digest(payload),
    payload
  }
  validateToolInteractionSourceArtifact(artifact, measurement)
  return artifact
}

export function validateToolInteractionSourceArtifact(artifact, measurement) {
  assertExactKeys(artifact, [
    'artifactId', 'schemaId', 'schemaVersion', 'producer', 'binding', 'payloadDigest', 'payload'
  ], 'Tool Interaction private source envelope')
  if (artifact.schemaId !== TOOL_INTERACTION_SOURCE_SCHEMA_ID
      || artifact.schemaVersion !== SCHEMA_VERSION
      || artifact.artifactId !== `tool-interaction-source:${digest(artifact.payload).slice(7, 39)}`
      || artifact.payloadDigest !== digest(artifact.payload)) {
    throw new Error('Tool Interaction private source identity is invalid')
  }
  assertExactKeys(artifact.producer, ['id', 'version', 'digest'], 'Tool Interaction source producer')
  assertExactKeys(artifact.binding, ['caseId', 'trialId'], 'Tool Interaction source binding')
  assertExactKeys(artifact.payload, [
    'policyId',
    'measurementArtifact',
    'preparedFixtureArtifact',
    'measurementSpec',
    'toolEvidence',
    'effectEvidence'
  ], 'Tool Interaction source payload')
  if (artifact.payload.policyId !== 'tool-interaction-private-replay-source-v1'
      || canonicalJson(artifact.payload.measurementArtifact) !== canonicalJson(
        artifactReference(measurement)
      )) {
    throw new Error('Tool Interaction private source Measurement binding is invalid')
  }
  assertExactKeys(
    artifact.payload.preparedFixtureArtifact,
    ['schemaId', 'schemaVersion', 'payloadDigest', 'locator'],
    'Prepared Tool Fixture reference'
  )
  if (artifact.payload.preparedFixtureArtifact.schemaId
        !== 'rovai.qualification.prepared-tool-fixture-manifest'
      || artifact.payload.preparedFixtureArtifact.schemaVersion !== '1.0.0'
      || !stableDigest(artifact.payload.preparedFixtureArtifact.payloadDigest)) {
    throw new Error('Prepared Tool Fixture reference identity is invalid')
  }
  validateRelativeLocator(
    artifact.payload.preparedFixtureArtifact.locator,
    'Prepared Tool Fixture locator'
  )
  const rebuilt = buildToolInteractionMeasurement({
    caseId: artifact.binding.caseId,
    trialId: artifact.binding.trialId,
    measurementSpec: artifact.payload.measurementSpec,
    toolEvidence: artifact.payload.toolEvidence,
    effectEvidence: artifact.payload.effectEvidence,
    producerDigest: artifact.producer.digest
  })
  if (canonicalJson(rebuilt) !== canonicalJson(measurement)) {
    throw new Error('Tool Interaction Measurement does not replay from its private source')
  }
  return artifact
}

export async function retainToolInteractionArtifacts(
  evidenceDirectory,
  { measurement, judgePack, source = null },
  evidenceIndex = null
) {
  validateToolInteractionArtifacts({ measurement, judgePack, evidenceIndex })
  const retained = {
    measurement: await retainImmutable(
      evidenceDirectory,
      'tool-interaction-measurements',
      measurement
    ),
    judgePack: await retainImmutable(
      evidenceDirectory,
      'tool-use-judge-packs',
      judgePack
    ),
    source: null
  }
  if (source !== null) {
    validateToolInteractionSourceArtifact(source, measurement)
    retained.source = await retainImmutable(
      evidenceDirectory,
      'tool-interaction-sources',
      source
    )
    await atomicWriteJson(join(evidenceDirectory, 'tool-interaction-source.json'), source)
  }
  await atomicWriteJson(join(evidenceDirectory, 'tool-interaction-measurement.json'), measurement)
  await atomicWriteJson(join(evidenceDirectory, 'tool-use-judge-pack.json'), judgePack)
  return retained
}

function normalizeMeasurementSpec(value) {
  assertExactKeys(value, ['specificationId', 'opportunities'], 'measurementSpec')
  requireIdentifier(value.specificationId, 'measurementSpec.specificationId')
  if (!Array.isArray(value.opportunities) || value.opportunities.length === 0) {
    throw new Error('measurementSpec.opportunities must be a non-empty array')
  }
  const opportunityIds = new Set()
  const opportunities = value.opportunities.map((item, index) => {
    assertExactKeys(
      item,
      ['opportunityId', 'adapter', 'mode', 'allowedOperations', 'semanticItems', 'oracle'],
      `measurementSpec.opportunities[${index}]`,
      { optional: ['allowedOperations', 'semanticItems'] }
    )
    requireIdentifier(item.opportunityId, `opportunity ${index} id`)
    if (opportunityIds.has(item.opportunityId)) throw new Error('opportunityId must be unique')
    opportunityIds.add(item.opportunityId)
    if (!Object.hasOwn(ADAPTER_OPERATIONS, item.adapter)) {
      throw new Error(`unsupported Tool Interaction adapter: ${item.adapter}`)
    }
    if (!MODES.has(item.mode)) throw new Error(`unsupported Tool Interaction mode: ${item.mode}`)
    const adapterOperations = ADAPTER_OPERATIONS[item.adapter]
    const allowedOperations = item.allowedOperations === undefined
      ? [...adapterOperations]
      : uniqueStrings(item.allowedOperations)
    if (allowedOperations.length === 0
        || allowedOperations.some((operation) => !adapterOperations.includes(operation))) {
      throw new Error('allowedOperations must be a non-empty adapter-local subset')
    }
    const semanticItems = item.semanticItems === undefined
      ? defaultSemanticItems(item.adapter)
      : uniqueStrings(item.semanticItems)
    if (semanticItems.some((checklistItem) => !TOOL_USE_CHECKLIST_SET.has(checklistItem))) {
      throw new Error('semanticItems contains an unknown Tool-Use checklist item')
    }
    if (item.adapter === 'camp_message_send' && semanticItems.length > 0) {
      throw new Error('camp_message_send semanticItems must be empty; Process Judge owns A2A semantics')
    }
    if (item.adapter !== 'memory_mutation'
        && semanticItems.includes('SER.memory.retention_quality')) {
      throw new Error('Memory retention quality is only valid for memory_mutation')
    }
    const oracle = normalizeOracle(item.adapter, item.oracle ?? {})
    return {
      opportunityId: item.opportunityId,
      adapter: item.adapter,
      mode: item.mode,
      allowedOperations,
      semanticItems,
      oracle
    }
  })
  return { specificationId: value.specificationId, opportunities }
}

function normalizeOracle(adapter, value) {
  if (!isObject(value)) throw new Error('opportunity oracle must be an object')
  const common = ['requiredOperations', 'canaries']
  const adapterKeys = {
    camp_history: ['requiredMessageIds', 'forbiddenMessageIds', 'requireCompletePagination'],
    memory_retrieval: ['expectedMemories', 'forbiddenMemoryIds', 'staleRevisionIds'],
    memory_mutation: ['expectedMemoryId', 'expectedRevisionId', 'expectedAction', 'requireReceipt'],
    camp_message_send: [
      'requiredRecipientAgentIds',
      'forbiddenRecipientAgentIds',
      'requireEffectBinding',
      'requireReceipt'
    ]
  }[adapter]
  assertExactKeys(value, [...common, ...adapterKeys], `${adapter} oracle`, {
    optional: [...common, ...adapterKeys]
  })
  const result = {}
  if (value.requiredOperations !== undefined) {
    result.requiredOperations = uniqueStrings(value.requiredOperations)
    if (result.requiredOperations.some((operation) => !ADAPTER_OPERATIONS[adapter].includes(operation))) {
      throw new Error('oracle requiredOperations contains an operation outside its adapter')
    }
  }
  if (value.canaries !== undefined) {
    result.canaries = uniqueStrings(value.canaries.map((item) => (
      requireBoundedString(item, 'oracle canary', 240)
    )))
  }
  if (adapter === 'camp_history') {
    result.requiredMessageIds = normalizedIdentifiers(value.requiredMessageIds)
    result.forbiddenMessageIds = normalizedIdentifiers(value.forbiddenMessageIds)
    result.requireCompletePagination = booleanDefault(value.requireCompletePagination, false)
  } else if (adapter === 'memory_retrieval') {
    result.expectedMemories = (value.expectedMemories ?? []).map((memory, index) => {
      assertExactKeys(memory, ['memoryId', 'revisionId', 'cacheState'], `expectedMemories[${index}]`, {
        optional: ['revisionId', 'cacheState']
      })
      requireIdentifier(memory.memoryId, 'expected memoryId')
      if (memory.revisionId !== undefined) requireIdentifier(memory.revisionId, 'expected revisionId')
      if (memory.cacheState !== undefined) requireIdentifier(memory.cacheState, 'expected cacheState')
      return {
        memoryId: memory.memoryId,
        revisionId: memory.revisionId ?? null,
        cacheState: memory.cacheState ?? 'current'
      }
    })
    result.forbiddenMemoryIds = normalizedIdentifiers(value.forbiddenMemoryIds)
    result.staleRevisionIds = normalizedIdentifiers(value.staleRevisionIds)
  } else if (adapter === 'memory_mutation') {
    result.expectedMemoryId = optionalIdentifier(value.expectedMemoryId, 'expectedMemoryId')
    result.expectedRevisionId = optionalIdentifier(value.expectedRevisionId, 'expectedRevisionId')
    result.expectedAction = optionalIdentifier(value.expectedAction, 'expectedAction')
    result.requireReceipt = booleanDefault(value.requireReceipt, true)
  } else {
    result.requiredRecipientAgentIds = normalizedIdentifiers(value.requiredRecipientAgentIds)
    result.forbiddenRecipientAgentIds = normalizedIdentifiers(value.forbiddenRecipientAgentIds)
    result.requireEffectBinding = booleanDefault(value.requireEffectBinding, true)
    result.requireReceipt = booleanDefault(value.requireReceipt, true)
  }
  return result
}

function normalizeInteractions(toolEvidence) {
  if (!isObject(toolEvidence) || !Array.isArray(toolEvidence.interactions)) {
    return { interactions: [], invalidCount: 0, untrustedCount: 0, missingReferenceCount: 0 }
  }
  const normalized = []
  let invalidCount = 0
  let untrustedCount = 0
  let missingReferenceCount = 0
  for (const raw of toolEvidence.interactions) {
    const sourceAuthority = raw?.sourceAuthority ?? raw?.authorityClass
    if (sourceAuthority !== 'core') {
      untrustedCount += 1
      continue
    }
    const canonicalTool = stableOperation(raw.canonicalTool)
    const toolCallId = stableIdentity(raw.toolCallId)
    if (!canonicalTool || !toolCallId || !knownOperation(canonicalTool)) {
      invalidCount += 1
      continue
    }
    const coreProjection = raw.operationProjection
    if (!coreProjection) {
      invalidCount += 1
      continue
    }
    try {
      validateCoreOperationProjection(coreProjection, canonicalTool)
    } catch {
      invalidCount += 1
      continue
    }
    const projectionSource = {
      schemaVersion: coreProjection.schemaVersion,
      operation: coreProjection.operation,
      input: coreProjection.input ?? coreProjection.canonicalInput ?? null,
      result: coreProjection.result ?? coreProjection.canonicalResult ?? null
    }
    let operationProjection
    try {
      operationProjection = projectOperation(canonicalTool, projectionSource)
    } catch {
      invalidCount += 1
      continue
    }
    const evidenceReferences = normalizeEvidenceReferences(
      raw.evidenceReferences ?? (raw.evidenceReference ? [raw.evidenceReference] : [])
    )
    if (evidenceReferences.length === 0) missingReferenceCount += 1
    const lifecycle = normalizeLifecycle(raw.lifecycle)
    const authorization = normalizeAuthorization(raw.authorization)
    const idempotencyIdentity = stableDigest(
      raw.idempotencyIdentity ?? raw.retryRelation?.idempotencyIdentity
    )
    const replayCount = Number.isInteger(raw.retryRelation?.observationCount)
      && raw.retryRelation.observationCount >= 0
      ? raw.retryRelation.observationCount
      : raw.idempotentReplay === true || raw.retryRelation?.kind === 'idempotent_replay_observed'
        ? 1
        : 0
    normalized.push({
      canonicalTool,
      toolCallId,
      idempotencyIdentity,
      lifecycle,
      authorization,
      receiptId: stableIdentity(raw.receiptId),
      operationProjection,
      inputDigest: stableDigest(
        raw.inputDigest
          ?? coreProjection?.inputDigest
          ?? coreProjection?.digestBinding?.input?.digest
          ?? raw.rawInputDigest
      )
        ?? digest(operationProjection.input),
      resultDigest: stableDigest(
        raw.resultDigest
          ?? coreProjection?.resultDigest
          ?? coreProjection?.digestBinding?.result?.digest
          ?? raw.rawOutputDigest
      )
        ?? (operationProjection.result === null ? null : digest(operationProjection.result)),
      replayCount,
      evidenceReferences
    })
  }
  const groups = new Map()
  for (const interaction of normalized) {
    const key = interaction.idempotencyIdentity
      ? `idempotency:${interaction.idempotencyIdentity}`
      : `tool-call:${interaction.toolCallId}`
    const group = groups.get(key) ?? []
    group.push(interaction)
    groups.set(key, group)
  }
  const interactions = [...groups.entries()].sort(([left], [right]) => (
    left.localeCompare(right)
  )).map(([identity, observations]) => mergeInteractionGroup(identity, observations))
  return { interactions, invalidCount, untrustedCount, missingReferenceCount }
}

function mergeInteractionGroup(identity, observations) {
  const ordered = [...observations].sort((left, right) => (
    canonicalJson(left).localeCompare(canonicalJson(right))
  ))
  const first = ordered[0]
  const canonicalTools = uniqueStrings(ordered.map((item) => item.canonicalTool))
  const projections = uniqueStrings(ordered.map((item) => canonicalJson(item.operationProjection)))
  const inputDigests = uniqueStrings(ordered.map((item) => item.inputDigest))
  const resultDigests = uniqueStrings(ordered.map((item) => item.resultDigest).filter(Boolean))
  const lifecycleStates = uniqueStrings(ordered.map((item) => item.lifecycle.state))
  const authorizationDecisions = uniqueStrings(ordered.map((item) => item.authorization.decision))
  const identityConflict = canonicalTools.length !== 1
    || projections.length !== 1
    || inputDigests.length !== 1
    || resultDigests.length > 1
  const sourceToolCallIds = uniqueStrings(ordered.map((item) => item.toolCallId))
  const explicitReplayObservations = ordered.reduce((total, item) => total + item.replayCount, 0)
  const replayObservationCount = Math.max(ordered.length - 1, explicitReplayObservations)
  const stableInteractionIdentity = identity.startsWith('idempotency:')
    ? identity.slice('idempotency:'.length)
    : identity.slice('tool-call:'.length)
  return {
    interactionId: `tool-interaction:${sha256(stableInteractionIdentity).slice(0, 32)}`,
    sourceAuthority: 'core',
    canonicalTool: canonicalTools.length === 1 ? canonicalTools[0] : first.canonicalTool,
    sourceToolCallIds,
    lifecycle: {
      state: lifecycleStates.length === 1 ? lifecycleStates[0] : 'indeterminate'
    },
    authorization: {
      decision: authorizationDecisions.length === 1
        ? authorizationDecisions[0]
        : 'indeterminate'
    },
    receiptId: uniqueNullable(ordered.map((item) => item.receiptId)),
    operationProjection: structuredClone(first.operationProjection),
    inputDigest: inputDigests.length === 1 ? inputDigests[0] : null,
    resultDigest: resultDigests.length === 1 ? resultDigests[0] : null,
    replay: {
      idempotencyIdentity: first.idempotencyIdentity,
      observationCount: 1 + replayObservationCount,
      replayObservationCount,
      identityConflict
    },
    evidenceReferences: uniqueReferences(ordered.flatMap((item) => item.evidenceReferences))
  }
}

function normalizeEffects(effectEvidence) {
  if (!Array.isArray(effectEvidence)) throw new Error('effectEvidence must be an array')
  const ids = new Set()
  return effectEvidence.map((effect, index) => {
    assertExactKeys(effect, [
      'effectId',
      'kind',
      'content',
      'contentDigest',
      'relatedToolCallIds',
      'relatedResultIdentities',
      'evidenceReference',
      'evidenceReferences'
    ], `effectEvidence[${index}]`, {
      optional: [
        'content',
        'contentDigest',
        'relatedToolCallIds',
        'relatedResultIdentities',
        'evidenceReference',
        'evidenceReferences'
      ]
    })
    requireIdentifier(effect.effectId, 'effectId')
    if (ids.has(effect.effectId)) throw new Error('effectId must be unique')
    ids.add(effect.effectId)
    if (![
      'retrieved_content',
      'message',
      'workspace_change',
      'verification',
      'final_response'
    ].includes(effect.kind)) {
      throw new Error('effectEvidence kind is not supported')
    }
    const content = effect.content === undefined
      ? null
      : requireBoundedString(effect.content, 'effect content', MAX_TEXT_CHARACTERS)
    if (effect.kind === 'retrieved_content' && content === null) {
      throw new Error('retrieved_content Evidence requires bounded exact content')
    }
    const computedDigest = content === null ? null : `sha256:${sha256(content)}`
    const suppliedDigest = stableDigest(effect.contentDigest)
    if (suppliedDigest && computedDigest && suppliedDigest !== computedDigest) {
      throw new Error('effect contentDigest does not match content')
    }
    const evidenceReferences = normalizeEvidenceReferences([
      ...(effect.evidenceReferences ?? []),
      ...(effect.evidenceReference ? [effect.evidenceReference] : [])
    ])
    if (evidenceReferences.length === 0) throw new Error('effectEvidence requires Evidence Reference')
    return {
      effectId: effect.effectId,
      kind: effect.kind,
      content,
      contentDigest: suppliedDigest ?? computedDigest,
      relatedToolCallIds: normalizedIdentifiers(effect.relatedToolCallIds),
      relatedResultIdentities: normalizedIdentifiers(effect.relatedResultIdentities),
      evidenceReferences
    }
  }).sort((left, right) => left.effectId.localeCompare(right.effectId))
}

function bindEffects(interactions, effects) {
  const bindings = []
  for (const effect of effects) {
    const matched = interactions.filter((interaction) => {
      const resultIdentities = extractResultIdentities(interaction.operationProjection.result)
      return intersects(effect.relatedToolCallIds, interaction.sourceToolCallIds)
        || intersects(effect.relatedResultIdentities, resultIdentities)
    })
    for (const interaction of matched) {
      bindings.push({
        effectId: effect.effectId,
        interactionId: interaction.interactionId,
        kind: effect.kind,
        content: effect.content,
        contentDigest: effect.contentDigest,
        relation: effect.relatedToolCallIds.some((id) => interaction.sourceToolCallIds.includes(id))
          ? ['workspace_change', 'verification', 'final_response'].includes(effect.kind)
              ? 'candidate_trial_delivery_no_causal_attribution'
              : 'core_tool_call_identity'
          : 'core_result_identity',
        evidenceReferences: structuredClone(effect.evidenceReferences)
      })
    }
  }
  return bindings.sort((left, right) => (
    left.effectId.localeCompare(right.effectId)
    || left.interactionId.localeCompare(right.interactionId)
  ))
}

function assessOpportunity({ opportunity, interactions, effectBindings, sourceCoverage }) {
  const common = assessCommon(opportunity, interactions, sourceCoverage)
  if (common.terminal) return common.result
  let oracleMatch
  let effectBinding = notApplicableAssessment()
  if (opportunity.adapter === 'camp_history') {
    oracleMatch = assessCampHistory(opportunity.oracle, interactions)
  } else if (opportunity.adapter === 'memory_retrieval') {
    oracleMatch = assessMemoryRetrieval(opportunity.oracle, interactions)
  } else if (opportunity.adapter === 'memory_mutation') {
    oracleMatch = assessMemoryMutation(opportunity.oracle, interactions)
  } else {
    oracleMatch = assessCampMessageSend(opportunity.oracle, interactions)
    effectBinding = assessEffectBinding(opportunity.oracle, effectBindings)
  }
  const statuses = [common.mechanicalIntegrity.status, oracleMatch.status, effectBinding.status]
    .filter((status) => status !== 'not_applicable')
  const status = statuses.includes('fail')
    ? 'fail'
    : statuses.includes('indeterminate')
      ? 'indeterminate'
      : 'pass'
  return {
    status,
    deterministicAssessment: {
      mechanicalIntegrity: common.mechanicalIntegrity,
      oracleMatch,
      effectBinding
    }
  }
}

function assessCommon(opportunity, interactions, sourceCoverage) {
  const replayObservations = interactions.reduce(
    (total, item) => total + item.replay.replayObservationCount,
    0
  )
  const facts = {
    observedLogicalInteractions: interactions.length,
    replayObservations
  }
  if (sourceCoverage.state !== 'complete') {
    return terminalAssessment('indeterminate', facts, ['tool_evidence_incomplete'])
  }
  if (opportunity.mode === 'non_use_control') {
    if (interactions.length === 0) {
      return terminalAssessment('pass', facts, ['non_use_observed_with_complete_coverage'])
    }
    return terminalAssessment('fail', facts, ['unexpected_tool_use'])
  }
  if (interactions.length === 0) {
    return terminalAssessment('fail', facts, ['required_tool_use_missing'])
  }
  const requiredOperations = opportunity.oracle.requiredOperations ?? []
  const observedOperations = new Set(interactions.map((item) => item.canonicalTool))
  const missingOperations = requiredOperations.filter((operation) => !observedOperations.has(operation))
  const badLifecycle = interactions.some((item) => item.lifecycle.state !== 'succeeded')
  const badAuthorization = interactions.some((item) => item.authorization.decision !== 'allowed')
  const identityConflict = interactions.some((item) => item.replay.identityConflict)
  const reasonCodes = []
  if (missingOperations.length > 0) reasonCodes.push('required_operation_missing')
  if (badLifecycle) reasonCodes.push('tool_lifecycle_not_succeeded')
  if (badAuthorization) reasonCodes.push('tool_authorization_not_allowed')
  if (identityConflict) reasonCodes.push('replay_identity_conflict')
  return {
    terminal: reasonCodes.length > 0,
    mechanicalIntegrity: assessment(
      reasonCodes.length > 0 ? 'fail' : 'pass',
      { ...facts, requiredOperationCount: requiredOperations.length, missingOperationCount: missingOperations.length },
      reasonCodes
    ),
    result: reasonCodes.length > 0
      ? resultWithAssessments('fail', assessment('fail', facts, reasonCodes))
      : null
  }
}

function terminalAssessment(status, facts, reasonCodes) {
  const mechanicalIntegrity = assessment(status, facts, reasonCodes)
  return {
    terminal: true,
    mechanicalIntegrity,
    result: resultWithAssessments(status, mechanicalIntegrity)
  }
}

function resultWithAssessments(status, mechanicalIntegrity) {
  return {
    status,
    deterministicAssessment: {
      mechanicalIntegrity,
      oracleMatch: status === 'indeterminate'
        ? assessment('indeterminate', emptyOracleFacts(), ['tool_evidence_incomplete'])
        : notApplicableAssessment(),
      effectBinding: status === 'indeterminate'
        ? assessment('indeterminate', { boundEffectCount: 0 }, ['tool_evidence_incomplete'])
        : notApplicableAssessment()
    }
  }
}

function assessCampHistory(oracle, interactions) {
  const observed = new Set(interactions.flatMap((item) => (
    extractMessageIds(item.operationProjection.input)
      .concat(extractMessageIds(item.operationProjection.result))
  )))
  const requiredObserved = oracle.requiredMessageIds.filter((id) => observed.has(id)).length
  const forbiddenObserved = oracle.forbiddenMessageIds.filter((id) => observed.has(id)).length
  const paginationIncomplete = oracle.requireCompletePagination
    && interactions.some((item) => projectionSignalsIncomplete(item.operationProjection.result))
  const reasons = []
  if (requiredObserved !== oracle.requiredMessageIds.length) reasons.push('required_history_identity_missing')
  if (forbiddenObserved > 0) reasons.push('forbidden_history_identity_used')
  if (paginationIncomplete) reasons.push('history_pagination_incomplete')
  return assessment(reasons.length > 0 ? 'fail' : 'pass', {
    requiredFactCount: oracle.requiredMessageIds.length,
    observedRequiredFactCount: requiredObserved,
    forbiddenFactCount: oracle.forbiddenMessageIds.length,
    observedForbiddenFactCount: forbiddenObserved,
    completePaginationRequired: oracle.requireCompletePagination,
    incompletePaginationObserved: paginationIncomplete
  }, reasons)
}

function assessMemoryRetrieval(oracle, interactions) {
  const readRecords = interactions
    .filter((item) => item.canonicalTool === 'memory.read')
    .flatMap((item) => extractMemoryRecords(item.operationProjection.result))
  const allRecords = interactions.flatMap((item) => extractMemoryRecords(item.operationProjection.result))
  const authoritativeRecords = readRecords.length > 0 ? readRecords : allRecords
  let expectedObserved = 0
  let staleObserved = 0
  for (const expected of oracle.expectedMemories) {
    const matching = authoritativeRecords.filter((record) => record.memoryId === expected.memoryId)
    if (matching.some((record) => (
      (expected.revisionId === null || record.revisionId === expected.revisionId)
      && (expected.cacheState === null || record.cacheState === expected.cacheState)
    ))) expectedObserved += 1
    if (matching.some((record) => (
      (expected.revisionId !== null && record.revisionId !== expected.revisionId)
      || (expected.cacheState !== null && record.cacheState !== expected.cacheState)
    ))) staleObserved += 1
  }
  staleObserved += authoritativeRecords.filter((record) => (
    oracle.staleRevisionIds.includes(record.revisionId)
  )).length
  const forbiddenObserved = new Set(authoritativeRecords
    .filter((record) => oracle.forbiddenMemoryIds.includes(record.memoryId))
    .map((record) => record.memoryId)).size
  const reasons = []
  if (expectedObserved !== oracle.expectedMemories.length) reasons.push('expected_memory_state_missing')
  if (staleObserved > 0) reasons.push('stale_memory_state_observed')
  if (forbiddenObserved > 0) reasons.push('forbidden_memory_used')
  return assessment(reasons.length > 0 ? 'fail' : 'pass', {
    requiredFactCount: oracle.expectedMemories.length,
    observedRequiredFactCount: expectedObserved,
    staleFactCount: staleObserved,
    observedForbiddenFactCount: forbiddenObserved
  }, reasons)
}

function assessMemoryMutation(oracle, interactions) {
  const identities = new Set(interactions.flatMap((item) => (
    extractResultIdentities(item.operationProjection.result)
  )))
  const actions = new Set(interactions.map((item) => item.operationProjection.input?.action).filter(Boolean))
  const reasons = []
  if (oracle.expectedMemoryId && !identities.has(oracle.expectedMemoryId)) {
    reasons.push('expected_memory_identity_missing')
  }
  if (oracle.expectedRevisionId && !identities.has(oracle.expectedRevisionId)) {
    reasons.push('expected_revision_identity_missing')
  }
  if (oracle.expectedAction && !actions.has(oracle.expectedAction)) {
    reasons.push('expected_memory_action_missing')
  }
  const receiptCount = interactions.filter((item) => item.receiptId).length
  if (oracle.requireReceipt && receiptCount !== interactions.length) reasons.push('mutation_receipt_missing')
  return assessment(reasons.length > 0 ? 'fail' : 'pass', {
    expectedMemoryIdentityObserved: oracle.expectedMemoryId ? identities.has(oracle.expectedMemoryId) : null,
    expectedRevisionIdentityObserved: oracle.expectedRevisionId
      ? identities.has(oracle.expectedRevisionId)
      : null,
    receiptRequired: oracle.requireReceipt,
    receiptCount
  }, reasons)
}

function assessCampMessageSend(oracle, interactions) {
  const recipients = new Set(interactions.flatMap((item) => (
    normalizedIdentifiers(item.operationProjection.result?.effectiveRecipients)
  )))
  const requiredObserved = oracle.requiredRecipientAgentIds.filter((id) => recipients.has(id)).length
  const forbiddenObserved = oracle.forbiddenRecipientAgentIds.filter((id) => recipients.has(id)).length
  const receiptCount = interactions.filter((item) => item.receiptId).length
  const reasons = []
  if (requiredObserved !== oracle.requiredRecipientAgentIds.length) reasons.push('required_recipient_missing')
  if (forbiddenObserved > 0) reasons.push('forbidden_recipient_observed')
  if (oracle.requireReceipt && receiptCount !== interactions.length) reasons.push('send_receipt_missing')
  return assessment(reasons.length > 0 ? 'fail' : 'pass', {
    requiredRecipientCount: oracle.requiredRecipientAgentIds.length,
    observedRequiredRecipientCount: requiredObserved,
    observedForbiddenRecipientCount: forbiddenObserved,
    receiptRequired: oracle.requireReceipt,
    receiptCount
  }, reasons)
}

function assessEffectBinding(oracle, effectBindings) {
  if (!oracle.requireEffectBinding) return notApplicableAssessment()
  const messageBindings = effectBindings.filter((binding) => binding.kind === 'message')
  return assessment(messageBindings.length > 0 ? 'pass' : 'fail', {
    boundEffectCount: messageBindings.length
  }, messageBindings.length > 0 ? [] : ['accepted_send_effect_unbound'])
}

function projectOperation(operation, source) {
  if (!isObject(source) || source.schemaVersion !== 1 || source.operation !== operation) {
    throw new Error('Core operation projection identity is invalid')
  }
  return {
    schemaVersion: 1,
    operation,
    input: source.input === null || source.input === undefined
      ? null
      : projectOperationInput(operation, source.input),
    result: source.result === null || source.result === undefined
      ? null
      : projectOperationResult(operation, source.result)
  }
}

function validateCoreOperationProjection(value, operation) {
  assertExactKeys(value, [
    'schemaVersion',
    'operation',
    'canonicalInput',
    'canonicalResult',
    'digestBinding',
    'inputDigest',
    'resultDigest',
    'projectionDigest'
  ], 'Core operationProjection')
  if (value.schemaVersion !== 1 || value.operation !== operation
      || !isObject(value.canonicalInput)
      || (value.canonicalResult !== null && !isObject(value.canonicalResult))) {
    throw new Error('Core operationProjection identity is invalid')
  }
  assertExactKeys(value.digestBinding, ['input', 'result'], 'Core digestBinding')
  assertExactKeys(value.digestBinding.input, ['evidenceField', 'digest'], 'Core input digest binding')
  if (value.digestBinding.input.evidenceField !== 'rawInputDigest') {
    throw new Error('Core input digest binding authority is invalid')
  }
  const inputDigest = stableDigest(value.inputDigest)
  const boundInputDigest = stableDigest(value.digestBinding.input.digest)
  if (!inputDigest || inputDigest !== boundInputDigest) {
    throw new Error('Core input digest binding is invalid')
  }
  if (value.canonicalResult === null) {
    if (value.resultDigest !== null || value.digestBinding.result !== null) {
      throw new Error('Core result digest presence is invalid')
    }
  } else {
    assertExactKeys(value.digestBinding.result, ['evidenceField', 'digest'], 'Core result digest binding')
    const resultDigest = stableDigest(value.resultDigest)
    const boundResultDigest = stableDigest(value.digestBinding.result.digest)
    if (value.digestBinding.result.evidenceField !== 'rawOutputDigest'
        || !resultDigest
        || resultDigest !== boundResultDigest) {
      throw new Error('Core result digest binding is invalid')
    }
  }
  const projectionWithoutDigest = Object.fromEntries(Object.entries(value).filter(([key]) => (
    key !== 'projectionDigest'
  )))
  if (stableDigest(value.projectionDigest) !== digest(projectionWithoutDigest)) {
    throw new Error('Core operationProjection digest is invalid')
  }
}

function projectOperationInput(operation, value) {
  if (!isObject(value)) throw new Error('Core operation input projection must be an object')
  if (operation === 'camp.list') return compactObject({
    query: boundedNullableString(value.query),
    queryCharCount: boundedInteger(value.queryCharCount),
    queryTruncated: booleanOrNull(value.queryTruncated),
    queryRedacted: booleanOrNull(value.queryRedacted),
    cursor: boundedNullableString(value.cursor),
    limit: boundedInteger(value.limit)
  })
  if (operation === 'camp.search') return compactObject({
    query: boundedNullableString(value.query),
    queryCharCount: boundedInteger(value.queryCharCount),
    queryTruncated: booleanOrNull(value.queryTruncated),
    queryRedacted: booleanOrNull(value.queryRedacted),
    limit: boundedInteger(value.limit),
    cursor: boundedNullableString(value.cursor),
    beforeSequence: boundedInteger(value.beforeSequence),
    afterSequence: boundedInteger(value.afterSequence)
  })
  if (operation === 'camp.read') return compactObject({
    mode: boundedNullableString(value.mode),
    campId: boundedNullableString(value.campId),
    messageId: boundedNullableString(value.messageId),
    messageIds: normalizedIdentifiers(value.messageIds),
    direction: boundedNullableString(value.direction),
    bodyOffset: boundedInteger(value.bodyOffset),
    bodyLimit: boundedInteger(value.bodyLimit),
    limit: boundedInteger(value.limit),
    cursor: boundedNullableString(value.cursor),
    before: boundedInteger(value.before),
    after: boundedInteger(value.after),
    beforeSequence: boundedInteger(value.beforeSequence),
    afterSequence: boundedInteger(value.afterSequence),
    aroundSequence: boundedInteger(value.aroundSequence)
  })
  if (operation === 'memory.search') return compactObject({
    query: boundedNullableString(value.query),
    queryCharCount: boundedInteger(value.queryCharCount),
    queryTruncated: booleanOrNull(value.queryTruncated),
    queryRedacted: booleanOrNull(value.queryRedacted),
    limit: boundedInteger(value.limit),
    cursor: boundedNullableString(value.cursor)
  })
  if (operation === 'memory.read') return {
    memoryIds: normalizedIdentifiers(value.memoryIds)
  }
  if (operation === 'memory.write') return compactObject({
    action: boundedNullableString(value.action),
    memoryId: boundedNullableString(value.memoryId),
    baseRevisionId: boundedNullableString(value.baseRevisionId ?? value.expectedRevisionId),
    kind: boundedNullableString(value.kind),
    scope: boundedNullableString(value.scope),
    body: boundedNullableString(value.body),
    bodyCharCount: boundedInteger(value.bodyCharCount),
    bodyTruncated: booleanOrNull(value.bodyTruncated),
    bodyRedacted: booleanOrNull(value.bodyRedacted),
    retrievalKeys: boundedStrings(value.retrievalKeys, 32),
    retrievalKeysCount: boundedInteger(value.retrievalKeysCount),
    retrievalKeysOmittedCount: boundedInteger(value.retrievalKeysOmittedCount),
    retrievalKeysTruncatedCount: boundedInteger(value.retrievalKeysTruncatedCount),
    counterpartyAgentId: boundedNullableString(value.counterpartyAgentId),
    direction: boundedNullableString(value.direction),
    contentDigest: stableDigest(value.contentDigest ?? value.bodyDigest)
  })
  return compactObject({
    recipientAgentIds: normalizedIdentifiers(
      value.recipientAgentIds ?? value.to ?? value.effectiveRecipients
    ),
    mentionsCurrentUser: typeof (value.mentionsCurrentUser ?? value.mentionUser) === 'boolean'
      ? (value.mentionsCurrentUser ?? value.mentionUser)
      : null,
    taskId: boundedNullableString(value.taskId),
    replyToMessageId: boundedNullableString(value.replyToMessageId),
    contentDigest: stableDigest(value.contentDigest ?? value.bodyDigest),
    contentCharCount: boundedInteger(value.contentCharCount),
    contentSecretDetected: booleanOrNull(value.contentSecretDetected),
    structuredContentDigest: stableDigest(value.structuredContentDigest)
  })
}

function projectOperationResult(operation, value) {
  if (!isObject(value)) throw new Error('Core operation result projection must be an object')
  if (operation === 'camp.list') return compactObject({
    campIds: normalizedIdentifiers(value.campIds ?? value.camps?.map((item) => item?.campId ?? item?.id)),
    campCount: boundedInteger(value.campCount),
    campsTruncated: booleanOrNull(value.campsTruncated),
    truncated: booleanOrNull(value.truncated),
    nextCursor: boundedNullableString(value.nextCursor)
  })
  if (operation === 'camp.search') return compactObject({
    messageIds: normalizedIdentifiers(
      value.messageIds ?? value.results?.map((item) => item?.messageId)
    ),
    resultCount: boundedInteger(value.resultCount),
    resultsTruncated: booleanOrNull(value.resultsTruncated),
    truncated: booleanOrNull(value.truncated),
    searchIncomplete: booleanOrNull(value.searchIncomplete),
    nextCursor: boundedNullableString(value.nextCursor)
  })
  if (operation === 'camp.read') return compactObject({
    messageIds: normalizedIdentifiers(
      value.messageIds ?? value.items?.map((item) => item?.messageId)
    ),
    mode: boundedNullableString(value.mode),
    anchorMessageId: boundedNullableString(value.anchorMessageId),
    threadRootMessageId: boundedNullableString(value.threadRootMessageId),
    direction: boundedNullableString(value.direction),
    itemCount: boundedInteger(value.itemCount),
    itemsTruncated: booleanOrNull(value.itemsTruncated),
    truncated: booleanOrNull(value.truncated),
    hasMore: booleanOrNull(value.hasMore),
    hasMoreBefore: booleanOrNull(value.hasMoreBefore),
    hasMoreAfter: booleanOrNull(value.hasMoreAfter),
    nextCursor: boundedCursor(value.nextCursor),
    bodyTruncated: booleanOrNull(value.bodyTruncated ?? value.items?.some((item) => item?.bodyTruncated)),
    nextBodyOffset: boundedInteger(value.nextBodyOffset)
  })
  if (operation === 'memory.search' || operation === 'memory.read') return compactObject({
    memories: normalizeMemoryRecords(value.memories ?? value.results),
    resultCount: boundedInteger(value.resultCount),
    memoryCount: boundedInteger(value.memoryCount),
    resultsTruncated: booleanOrNull(value.resultsTruncated),
    memoriesTruncated: booleanOrNull(value.memoriesTruncated),
    truncated: booleanOrNull(value.truncated),
    searchIncomplete: booleanOrNull(value.searchIncomplete),
    nextCursor: boundedNullableString(value.nextCursor)
  })
  if (operation === 'memory.write') return compactObject({
    outcome: boundedNullableString(value.outcome),
    memoryId: boundedNullableString(value.memoryId),
    revisionId: boundedNullableString(value.revisionId),
    reviewItemId: boundedNullableString(value.reviewItemId),
    action: boundedNullableString(value.action),
    version: boundedInteger(value.version)
  })
  return compactObject({
    status: boundedNullableString(value.status),
    messageId: boundedNullableString(value.messageId),
    visibility: boundedNullableString(value.visibility),
    campTurnId: boundedNullableString(value.campTurnId),
    effectiveRecipients: normalizedIdentifiers(value.effectiveRecipients),
    deliveryIds: normalizedIdentifiers(value.deliveryIds),
    recipientSetDigest: stableDigest(value.recipientSetDigest),
    allocatedAgentRunResponsibilities: boundedInteger(value.allocatedAgentRunResponsibilities)
  })
}

function normalizeMemoryRecords(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 64).map((record) => compactObject({
    memoryId: boundedNullableString(record?.memoryId),
    revisionId: boundedNullableString(record?.revisionId),
    cacheState: boundedNullableString(record?.cacheState),
    status: boundedNullableString(record?.status),
    kind: boundedNullableString(record?.kind)
  }))
}

function buildLocalEvidenceMap(measurement) {
  const references = uniqueReferences([
    ...measurement.payload.interactions.flatMap((item) => item.evidenceReferences),
    ...measurement.payload.opportunities
      .filter((item) => item.adapter !== 'camp_message_send')
      .flatMap((item) => item.effectBindings.flatMap((binding) => binding.evidenceReferences))
  ])
  const evidenceMap = references.map((evidenceReference, index) => ({
    localEvidenceId: `EV-${String(index + 1).padStart(4, '0')}`,
    evidenceReference: structuredClone(evidenceReference)
  }))
  return {
    evidenceMap,
    byReference: new Map(evidenceMap.map((entry) => (
      [referenceKey(entry.evidenceReference), entry.localEvidenceId]
    )))
  }
}

function buildChecklistCoverage({
  opportunity,
  interactions,
  effectBindings,
  interactionEvidenceIds,
  retrievedContentEvidenceIds,
  downstreamEvidenceIds
}) {
  return TOOL_USE_CHECKLIST.map((checklistItem) => {
    let coverage = structuredClone(opportunity.coverage)
    if (!opportunity.semanticItems.includes(checklistItem)) {
      coverage = { state: 'not_applicable', reason: null }
    } else if (opportunity.adapter === 'camp_message_send') {
      coverage = { state: 'not_applicable', reason: null }
    } else if ([
      'SER.tool_use.input_strategy',
      'SER.tool_use.result_interpretation'
    ].includes(checklistItem)
        && interactions.length === 0
        && opportunity.coverage.state === 'complete') {
      coverage = { state: 'unavailable', reason: { code: 'pre_registered_tool_interaction_missing' } }
    } else if (checklistItem === 'SER.tool_use.result_interpretation'
        && interactions.every((item) => item.operationProjection.result === null)) {
      coverage = { state: 'unavailable', reason: { code: 'tool_result_projection_unavailable' } }
    } else if (checklistItem === 'SER.tool_use.result_interpretation'
        && !effectBindings.some((binding) => binding.kind === 'retrieved_content')) {
      coverage = { state: 'unavailable', reason: { code: 'semantic_result_content_unavailable' } }
    } else if (checklistItem === 'SER.tool_use.downstream_use'
        && !effectBindings.some((binding) => binding.kind !== 'retrieved_content')) {
      coverage = { state: 'unavailable', reason: { code: 'downstream_semantic_relation_unbound' } }
    } else if (checklistItem === 'SER.tool_use.downstream_use'
        && effectBindings
          .filter((binding) => binding.kind !== 'retrieved_content')
          .every((binding) => binding.relation === 'candidate_trial_delivery_no_causal_attribution')) {
      coverage = {
        state: 'partial',
        reason: { code: 'downstream_candidate_has_no_causal_attribution' }
      }
    }
    const evidenceIds = checklistItem === 'SER.tool_use.result_interpretation'
      ? uniqueStrings([...interactionEvidenceIds, ...retrievedContentEvidenceIds])
      : checklistItem === 'SER.tool_use.downstream_use'
        ? uniqueStrings([...interactionEvidenceIds, ...downstreamEvidenceIds])
        : [...interactionEvidenceIds]
    return {
      checklistItem,
      coverage,
      evidenceIds: coverage.state === 'not_applicable' ? [] : [...evidenceIds]
    }
  })
}

function effectiveCoverage(value, normalized) {
  const supplied = normalizeCoverage(value)
  if (supplied.state !== 'complete') return supplied
  if (normalized.invalidCount > 0) {
    return { state: 'partial', reason: { code: 'core_tool_identity_or_projection_invalid' } }
  }
  if (normalized.untrustedCount > 0) {
    return { state: 'partial', reason: { code: 'runtime_only_tool_observation_present' } }
  }
  if (normalized.missingReferenceCount > 0) {
    return { state: 'partial', reason: { code: 'core_tool_evidence_reference_missing' } }
  }
  return supplied
}

function normalizeCoverage(value) {
  if (!isObject(value) || !['complete', 'partial', 'unavailable'].includes(value.state)) {
    return { state: 'unavailable', reason: { code: 'core_tool_source_coverage_unavailable' } }
  }
  if (value.state === 'complete') return { state: 'complete', reason: null }
  const code = stableOperation(value.reason?.code) ?? 'core_tool_source_coverage_incomplete'
  return { state: value.state, reason: { code } }
}

function defaultSemanticItems(adapter) {
  if (adapter === 'camp_message_send') return []
  if (adapter === 'memory_mutation') return [...TOOL_USE_CHECKLIST]
  return TOOL_USE_CHECKLIST.filter((item) => item !== 'SER.memory.retention_quality')
}

function validateMeasurementArtifact(artifact) {
  validateEnvelope(artifact, MEASUREMENT_SCHEMA_ID, 'Tool Interaction Measurement')
  validateQualificationContractArtifactSchema(
    'tool-interaction-measurement-v1.schema.json',
    artifact
  )
  assertNoScoreKeys(artifact)
  assertExactKeys(artifact.payload, [
    'policyId',
    'specification',
    'sourceCoverage',
    'interactions',
    'opportunities',
    'denominator'
  ], 'Tool Interaction Measurement payload')
  if (artifact.payload.policyId !== MEASUREMENT_POLICY_ID) throw new Error('measurement policy is invalid')
  assertExactKeys(artifact.payload.specification, [
    'specificationId', 'specificationDigest', 'opportunityCount'
  ], 'measurement specification reference')
  validateCoverage(artifact.payload.sourceCoverage)
  if (!Array.isArray(artifact.payload.interactions)
      || !Array.isArray(artifact.payload.opportunities)) {
    throw new Error('measurement collections are invalid')
  }
  const interactionIds = new Set()
  for (const interaction of artifact.payload.interactions) {
    validateInteraction(interaction)
    if (interactionIds.has(interaction.interactionId)) throw new Error('duplicate interactionId')
    interactionIds.add(interaction.interactionId)
  }
  const opportunityIds = new Set()
  for (const opportunity of artifact.payload.opportunities) {
    validateOpportunity(opportunity, interactionIds)
    if (opportunityIds.has(opportunity.opportunityId)) throw new Error('duplicate opportunityId')
    opportunityIds.add(opportunity.opportunityId)
  }
  if (artifact.payload.specification.opportunityCount !== artifact.payload.opportunities.length) {
    throw new Error('measurement opportunity count is invalid')
  }
  const expectedDenominator = {
    basis: 'pre_registered_opportunities',
    total: artifact.payload.opportunities.length,
    pass: artifact.payload.opportunities.filter((item) => item.status === 'pass').length,
    fail: artifact.payload.opportunities.filter((item) => item.status === 'fail').length,
    indeterminate: artifact.payload.opportunities.filter((item) => item.status === 'indeterminate').length
  }
  assertExactKeys(artifact.payload.denominator, Object.keys(expectedDenominator), 'measurement denominator')
  if (canonicalJson(artifact.payload.denominator) !== canonicalJson(expectedDenominator)) {
    throw new Error('measurement denominator is not derived from pre-registered opportunities')
  }
  return artifact
}

function validateJudgePackArtifact(artifact, measurement) {
  validateEnvelope(artifact, JUDGE_PACK_SCHEMA_ID, 'Tool-Use Judge Pack')
  validateQualificationContractArtifactSchema('tool-use-judge-pack-v1.schema.json', artifact)
  assertNoScoreKeys(artifact)
  assertExactKeys(artifact.payload, [
    'policyId', 'measurementArtifact', 'modelInputDigest', 'modelInput', 'evidenceMap'
  ], 'Tool-Use Judge Pack payload')
  if (artifact.payload.policyId !== JUDGE_POLICY_ID
      || canonicalJson(artifact.payload.measurementArtifact) !== canonicalJson(
        artifactReference(measurement)
      )
      || artifact.payload.modelInputDigest !== digest(artifact.payload.modelInput)) {
    throw new Error('Tool-Use Judge Pack binding or digest is invalid')
  }
  const expectedPayload = projectToolUseJudgePayload(
    measurement,
    normalizeDisclosedTask(artifact.payload.modelInput?.disclosedTask)
  )
  if (canonicalJson(artifact.payload) !== canonicalJson(expectedPayload)) {
    throw new Error('Tool-Use Judge Pack is not the deterministic Measurement projection')
  }
  assertNoForbiddenModelKeys(artifact.payload.modelInput)
  validateModelInput(artifact.payload.modelInput)
  if (!Array.isArray(artifact.payload.evidenceMap)) throw new Error('evidenceMap must be an array')
  const localIds = new Set()
  for (const entry of artifact.payload.evidenceMap) {
    assertExactKeys(entry, ['localEvidenceId', 'evidenceReference'], 'evidenceMap entry')
    if (!/^EV-\d{4}$/.test(entry.localEvidenceId) || localIds.has(entry.localEvidenceId)) {
      throw new Error('local Evidence ID is invalid or duplicated')
    }
    localIds.add(entry.localEvidenceId)
    validateEvidenceReference(entry.evidenceReference)
  }
  const usedIds = collectKeysAndValues(artifact.payload.modelInput, 'evidenceIds').flat()
  if (usedIds.some((id) => !localIds.has(id))) throw new Error('modelInput has unresolved local Evidence ID')
  return artifact
}

function validateEnvelope(artifact, schemaId, label) {
  assertExactKeys(artifact, [
    'artifactId',
    'schemaId',
    'schemaVersion',
    'producer',
    'binding',
    'sourceBoundaries',
    'payloadDigest',
    'payload'
  ], `${label} envelope`)
  if (artifact.schemaId !== schemaId
      || artifact.schemaVersion !== SCHEMA_VERSION
      || !stableIdentity(artifact.artifactId)
      || artifact.payloadDigest !== digest(artifact.payload)) {
    throw new Error(`${label} envelope identity is invalid`)
  }
  assertExactKeys(artifact.producer, ['id', 'version', 'digest'], `${label} producer`)
  assertExactKeys(artifact.binding, ['caseId', 'trialId'], `${label} binding`)
  requireIdentifier(artifact.binding.caseId, `${label} caseId`)
  requireIdentifier(artifact.binding.trialId, `${label} trialId`)
  if (!stableDigest(artifact.producer.digest)) throw new Error(`${label} producer digest is invalid`)
  const expectedArtifactId = schemaId === MEASUREMENT_SCHEMA_ID
    ? `tool-interaction-measurement:${digest(artifact.payload).slice(7, 39)}`
    : `tool-use-judge-pack:${digest(artifact.payload).slice(7, 39)}`
  if (artifact.artifactId !== expectedArtifactId) throw new Error(`${label} artifact identity is invalid`)
  if (!Array.isArray(artifact.sourceBoundaries) || artifact.sourceBoundaries.length !== 1) {
    throw new Error(`${label} source boundary is invalid`)
  }
  const boundary = artifact.sourceBoundaries[0]
  assertExactKeys(boundary, [
    'authorityClass', 'sourceId', 'digest', 'coverage'
  ], `${label} source boundary`)
  if (boundary.authorityClass !== 'core' && boundary.authorityClass !== 'derived') {
    throw new Error(`${label} source authority is invalid`)
  }
  if (boundary.digest !== digest({
    binding: artifact.binding,
    sourceId: boundary.sourceId,
    payload: artifact.payload
  })) throw new Error(`${label} source boundary digest is invalid`)
  validateCoverage(boundary.coverage)
}

function validateInteraction(value) {
  assertExactKeys(value, [
    'interactionId',
    'sourceAuthority',
    'canonicalTool',
    'sourceToolCallIds',
    'lifecycle',
    'authorization',
    'receiptId',
    'operationProjection',
    'inputDigest',
    'resultDigest',
    'replay',
    'evidenceReferences'
  ], 'Tool Interaction')
  if (value.sourceAuthority !== 'core' || !knownOperation(value.canonicalTool)) {
    throw new Error('Tool Interaction authority or operation is invalid')
  }
  assertExactKeys(value.lifecycle, ['state'], 'Tool Interaction lifecycle')
  assertExactKeys(value.authorization, ['decision'], 'Tool Interaction authorization')
  assertExactKeys(value.replay, [
    'idempotencyIdentity', 'observationCount', 'replayObservationCount', 'identityConflict'
  ], 'Tool Interaction replay')
  if (!Array.isArray(value.sourceToolCallIds) || value.sourceToolCallIds.length === 0
      || !Array.isArray(value.evidenceReferences) || value.evidenceReferences.length === 0) {
    throw new Error('Tool Interaction identity closure is invalid')
  }
  value.evidenceReferences.forEach(validateEvidenceReference)
  if (!stableDigest(value.inputDigest)
      || (value.operationProjection.result !== null && !stableDigest(value.resultDigest))
      || (value.operationProjection.result === null && value.resultDigest !== null)) {
    throw new Error('Tool Interaction digest closure is invalid')
  }
  validateOperationProjection(value.operationProjection, value.canonicalTool)
}

function validateOperationProjection(value, operation) {
  assertExactKeys(value, ['schemaVersion', 'operation', 'input', 'result'], 'operation projection')
  if (value.schemaVersion !== 1 || value.operation !== operation) {
    throw new Error('operation projection identity is invalid')
  }
  const rebuilt = projectOperation(operation, value)
  if (canonicalJson(rebuilt) !== canonicalJson(value)) {
    throw new Error('operation projection contains non-canonical or open fields')
  }
}

function validateOpportunity(value, interactionIds) {
  assertExactKeys(value, [
    'opportunityId',
    'adapter',
    'mode',
    'allowedOperations',
    'semanticItems',
    'oracleDigest',
    'coverage',
    'status',
    'deterministicAssessment',
    'interactionIds',
    'effectBindings',
    'evidenceReferences'
  ], 'Tool Interaction opportunity')
  if (!Object.hasOwn(ADAPTER_OPERATIONS, value.adapter) || !MODES.has(value.mode)
      || !['pass', 'fail', 'indeterminate'].includes(value.status)
      || !Array.isArray(value.allowedOperations)
      || value.allowedOperations.some((operation) => !ADAPTER_OPERATIONS[value.adapter].includes(operation))
      || !Array.isArray(value.semanticItems)
      || value.semanticItems.some((item) => !TOOL_USE_CHECKLIST_SET.has(item))
      || (value.adapter === 'camp_message_send' && value.semanticItems.length > 0)) {
    throw new Error('Tool Interaction opportunity identity is invalid')
  }
  validateCoverage(value.coverage)
  if (!Array.isArray(value.interactionIds)
      || value.interactionIds.some((id) => !interactionIds.has(id))) {
    throw new Error('opportunity references an unknown interaction')
  }
  assertExactKeys(value.deterministicAssessment, [
    'mechanicalIntegrity', 'oracleMatch', 'effectBinding'
  ], 'deterministic assessment')
  for (const item of Object.values(value.deterministicAssessment)) validateAssessment(item)
  if (!Array.isArray(value.effectBindings) || !Array.isArray(value.evidenceReferences)) {
    throw new Error('opportunity evidence closure is invalid')
  }
  for (const binding of value.effectBindings) validateEffectBinding(binding, interactionIds)
  value.evidenceReferences.forEach(validateEvidenceReference)
}

function validateAssessment(value) {
  assertExactKeys(value, ['status', 'facts', 'reasonCodes'], 'deterministic assessment item')
  if (!['pass', 'fail', 'indeterminate', 'not_applicable'].includes(value.status)
      || !isObject(value.facts)
      || !Array.isArray(value.reasonCodes)) {
    throw new Error('deterministic assessment item is invalid')
  }
  assertNoScoreKeys(value.facts)
}

function validateEffectBinding(value, interactionIds) {
  assertExactKeys(value, [
    'effectId', 'interactionId', 'kind', 'content', 'contentDigest', 'relation', 'evidenceReferences'
  ], 'effect binding')
  if (!interactionIds.has(value.interactionId)
      || ![
        'retrieved_content',
        'message',
        'workspace_change',
        'verification',
        'final_response'
      ].includes(value.kind)
      || ![
        'core_tool_call_identity',
        'core_result_identity',
        'candidate_trial_delivery_no_causal_attribution'
      ].includes(value.relation)) {
    throw new Error('effect binding identity is invalid')
  }
  value.evidenceReferences.forEach(validateEvidenceReference)
}

function validateModelInput(value) {
  assertExactKeys(value, ['policyId', 'disclosedTask', 'checklist', 'opportunities'], 'Judge modelInput')
  if (value.policyId !== JUDGE_POLICY_ID
      || canonicalJson(value.checklist) !== canonicalJson(TOOL_USE_CHECKLIST)
      || !Array.isArray(value.opportunities)) {
    throw new Error('Judge modelInput policy or checklist is invalid')
  }
  assertExactKeys(value.disclosedTask, ['title', 'requirements'], 'Judge disclosedTask')
  for (const opportunity of value.opportunities) {
    assertExactKeys(opportunity, [
      'opportunityId',
      'adapter',
      'coverage',
      'interactions',
      'downstreamEffects',
      'checklistCoverage'
    ], 'Judge opportunity')
    if (!Object.hasOwn(ADAPTER_OPERATIONS, opportunity.adapter)) throw new Error('Judge adapter is invalid')
    validateCoverage(opportunity.coverage)
    for (const interaction of opportunity.interactions) {
      assertExactKeys(interaction, [
        'localInteractionId',
        'canonicalTool',
        'lifecycle',
        'authorization',
        'operationProjection',
        'replay',
        'evidenceIds'
      ], 'Judge interaction')
      validateOperationProjection(interaction.operationProjection, interaction.canonicalTool)
      validateLocalEvidenceIds(interaction.evidenceIds)
    }
    for (const effect of opportunity.downstreamEffects) {
      assertExactKeys(effect, [
        'localEffectId', 'kind', 'content', 'contentDigest', 'relation', 'evidenceIds'
      ], 'Judge downstream effect')
      validateLocalEvidenceIds(effect.evidenceIds)
    }
    if (!Array.isArray(opportunity.checklistCoverage)
        || canonicalJson(opportunity.checklistCoverage.map((item) => item.checklistItem))
          !== canonicalJson(TOOL_USE_CHECKLIST)) {
      throw new Error('Judge checklist coverage is not exact')
    }
    for (const item of opportunity.checklistCoverage) {
      assertExactKeys(item, ['checklistItem', 'coverage', 'evidenceIds'], 'Judge checklist coverage item')
      validateCoverage(item.coverage, { allowNotApplicable: true })
      validateLocalEvidenceIds(item.evidenceIds)
    }
  }
}

function envelope({ artifactId, schemaId, producerDigest, binding, sourceId, coverage, payload }) {
  const authorityClass = sourceId.startsWith('derived.') ? 'derived' : 'core'
  return {
    artifactId,
    schemaId,
    schemaVersion: SCHEMA_VERSION,
    producer: {
      id: 'rovai-benchmark-tool-interaction-measurement',
      version: SCHEMA_VERSION,
      digest: withSha256Prefix(producerDigest)
    },
    binding,
    sourceBoundaries: [{
      authorityClass,
      sourceId,
      digest: digest({ binding, sourceId, payload }),
      coverage: structuredClone(coverage)
    }],
    payloadDigest: digest(payload),
    payload
  }
}

function normalizeDisclosedTask(value) {
  assertExactKeys(value, ['title', 'requirements'], 'disclosedTask')
  const title = requireBoundedString(value.title, 'disclosedTask.title', 500)
  if (!Array.isArray(value.requirements) || value.requirements.length === 0) {
    throw new Error('disclosedTask.requirements must be a non-empty array')
  }
  return {
    title,
    requirements: value.requirements.map((item) => (
      requireBoundedString(item, 'disclosed requirement', 5_000)
    ))
  }
}

function normalizeEvidenceReferences(values) {
  if (!Array.isArray(values)) throw new Error('Evidence References must be an array')
  values.forEach(validateEvidenceReference)
  return uniqueReferences(values)
}

function validateEvidenceReference(value) {
  assertExactKeys(value, ['artifactId', 'evidenceId', 'path'], 'Evidence Reference', {
    optional: ['path']
  })
  requireIdentifier(value.artifactId, 'Evidence Reference artifactId', 500)
  requireIdentifier(value.evidenceId, 'Evidence Reference evidenceId', 500)
  if (value.path !== undefined) requireBoundedString(value.path, 'Evidence Reference path', 1_000)
}

function artifactReference(artifact) {
  return {
    artifactId: artifact.artifactId,
    schemaId: artifact.schemaId,
    schemaVersion: artifact.schemaVersion,
    payloadDigest: artifact.payloadDigest
  }
}

function assessment(status, facts, reasonCodes) {
  return { status, facts, reasonCodes: uniqueStrings(reasonCodes) }
}

function notApplicableAssessment() {
  return assessment('not_applicable', {}, [])
}

function emptyOracleFacts() {
  return {
    requiredFactCount: null,
    observedRequiredFactCount: null,
    observedForbiddenFactCount: null
  }
}

function normalizeLifecycle(value) {
  const state = value?.state
  return { state: ['succeeded', 'failed', 'denied', 'started', 'indeterminate'].includes(state)
    ? state
    : 'indeterminate' }
}

function normalizeAuthorization(value) {
  const decision = value?.decision
  return { decision: ['allowed', 'denied', 'indeterminate'].includes(decision)
    ? decision
    : 'indeterminate' }
}

function normalizeMemoryRecordsForExtraction(value) {
  return Array.isArray(value) ? value.filter(isObject) : []
}

function extractMemoryRecords(value) {
  return normalizeMemoryRecordsForExtraction(value?.memories).map((item) => ({
    memoryId: item.memoryId ?? null,
    revisionId: item.revisionId ?? null,
    cacheState: item.cacheState ?? null
  }))
}

function extractMessageIds(value) {
  if (!isObject(value)) return []
  return normalizedIdentifiers([
    value.messageId,
    ...(value.messageIds ?? [])
  ])
}

function extractResultIdentities(value) {
  if (!isObject(value)) return []
  return normalizedIdentifiers([
    value.messageId,
    value.campTurnId,
    value.memoryId,
    value.revisionId,
    value.reviewItemId,
    ...(value.deliveryIds ?? []),
    ...(value.messageIds ?? []),
    ...(value.campIds ?? []),
    ...(value.effectiveRecipients ?? []),
    ...(value.memories ?? []).flatMap((item) => [item?.memoryId, item?.revisionId])
  ])
}

function projectionSignalsIncomplete(value) {
  return value?.truncated === true
    || value?.searchIncomplete === true
    || value?.hasMore === true
    || value?.bodyTruncated === true
    || value?.nextCursor !== null && value?.nextCursor !== undefined
    || value?.nextBodyOffset !== null && value?.nextBodyOffset !== undefined
}

function localIdsForReferences(references, byReference) {
  return uniqueStrings(references.map((reference) => byReference.get(referenceKey(reference))))
}

function validateLocalEvidenceIds(values) {
  if (!Array.isArray(values) || values.some((value) => !/^EV-\d{4}$/.test(value))) {
    throw new Error('local Evidence ID collection is invalid')
  }
}

function assertNoForbiddenModelKeys(value) {
  walk(value, (key) => {
    if (MODEL_FORBIDDEN_KEYS.has(key) || SCORE_KEYS.has(key)) {
      throw new Error(`Tool-Use Judge modelInput contains forbidden key: ${key}`)
    }
  })
}

function assertNoScoreKeys(value) {
  walk(value, (key) => {
    if (SCORE_KEYS.has(key)) throw new Error(`Tool Interaction artifact contains forbidden key: ${key}`)
  })
}

function assertNoCanary(value, canaries) {
  const strings = []
  walk(value, (_key, candidate) => {
    if (typeof candidate === 'string') strings.push(candidate)
  })
  for (const canary of canaries) {
    if (strings.some((candidate) => candidate.includes(canary))) {
      throw new Error('Tool-Use Judge Pack treatment canary contamination detected')
    }
  }
}

function validateEvidenceClosure(measurement, judgePack, evidenceIndex) {
  if (!isObject(evidenceIndex)
      || !stableIdentity(evidenceIndex.artifactId, 500)
      || !Array.isArray(evidenceIndex.payload?.records)) {
    throw new Error('Tool Interaction evidence closure requires an Evidence Index')
  }
  const records = new Map(evidenceIndex.payload.records.map((record) => [record.evidenceId, record]))
  const references = collectEvidenceReferences([
    measurement,
    ...(judgePack === null ? [] : [judgePack.payload.evidenceMap])
  ])
  for (const reference of references) {
    if (reference.artifactId !== evidenceIndex.artifactId) {
      throw new Error('Tool Interaction Evidence Reference targets another Evidence Index')
    }
    const record = records.get(reference.evidenceId)
    if (!record || record.safeForJudge !== true) {
      throw new Error('Tool Interaction Evidence Reference is unresolved or not Judge-safe')
    }
  }
  for (const opportunity of measurement.payload.opportunities) {
    for (const effect of opportunity.effectBindings) {
      if (effect.content === null) continue
      const boundRecords = effect.evidenceReferences.map((reference) => records.get(reference.evidenceId))
      if (!boundRecords.some((record) => record?.contentDigest === effect.contentDigest)) {
        throw new Error('Tool Interaction effect content is not digest-bound to Evidence Index')
      }
    }
  }
}

function collectEvidenceReferences(value) {
  const references = []
  const visit = (candidate) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit)
      return
    }
    if (!isObject(candidate)) return
    if (Object.hasOwn(candidate, 'artifactId') && Object.hasOwn(candidate, 'evidenceId')) {
      validateEvidenceReference(candidate)
      references.push(candidate)
      return
    }
    Object.values(candidate).forEach(visit)
  }
  visit(value)
  return uniqueReferences(references)
}

async function retainImmutable(evidenceDirectory, directory, artifact) {
  const locator = join(directory, `${artifact.artifactId}.json`)
  const path = join(evidenceDirectory, locator)
  try {
    await writePrivateJsonExclusive(path, artifact)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const existing = JSON.parse(await readFile(path, 'utf8'))
    if (canonicalJson(existing) !== canonicalJson(artifact)) {
      throw new Error('immutable Tool Interaction artifact identity collision')
    }
  }
  return { ...artifactReference(artifact), locator }
}

function walk(value, visitor) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor)
    return
  }
  if (!isObject(value)) return
  for (const [key, candidate] of Object.entries(value)) {
    visitor(key, candidate)
    walk(candidate, visitor)
  }
}

function collectKeysAndValues(value, targetKey) {
  const found = []
  walk(value, (key, candidate) => {
    if (key === targetKey) found.push(candidate)
  })
  return found
}

function assertExactKeys(value, allowed, label, { optional = [] } = {}) {
  if (!isObject(value)) throw new Error(`${label} must be an object`)
  const allowedSet = new Set(allowed)
  const optionalSet = new Set(optional)
  const actual = Object.keys(value)
  const unexpected = actual.filter((key) => !allowedSet.has(key))
  const missing = allowed.filter((key) => !optionalSet.has(key) && !Object.hasOwn(value, key))
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(`${label} keys are not closed (unexpected=${unexpected.join(',')}; missing=${missing.join(',')})`)
  }
}

function validateCoverage(value, { allowNotApplicable = false } = {}) {
  assertExactKeys(value, ['state', 'reason'], 'coverage')
  const states = allowNotApplicable
    ? ['complete', 'partial', 'unavailable', 'not_applicable']
    : ['complete', 'partial', 'unavailable']
  if (!states.includes(value.state)) throw new Error('coverage state is invalid')
  if (value.state === 'complete' || value.state === 'not_applicable') {
    if (value.reason !== null) throw new Error('complete/not_applicable coverage cannot have a reason')
  } else {
    assertExactKeys(value.reason, ['code'], 'coverage reason')
  }
}

function referenceKey(value) {
  return `${value.artifactId}\u0000${value.evidenceId}\u0000${value.path ?? ''}`
}

function uniqueReferences(values) {
  return [...new Map(values.map((value) => [referenceKey(value), structuredClone(value)])).values()]
    .sort((left, right) => referenceKey(left).localeCompare(referenceKey(right)))
}

function normalizedIdentifiers(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('identity collection must be an array')
  return uniqueStrings(value.map((item) => stableIdentity(item)).filter(Boolean))
}

function boundedStrings(value, maximumItems) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error('bounded string list is invalid')
  return uniqueStrings(value.map((item) => requireBoundedString(item, 'bounded string', 500)))
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) throw new Error('expected an array')
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))].sort()
}

function stableIdentity(value, maximum = 500) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
    ? value
    : null
}

function stableOperation(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
    ? value
    : null
}

function knownOperation(value) {
  return Object.values(ADAPTER_OPERATIONS).some((operations) => operations.includes(value))
}

function stableDigest(value) {
  if (typeof value !== 'string') return null
  if (/^sha256:[a-f0-9]{64}$/.test(value)) return value
  if (/^[a-f0-9]{64}$/.test(value)) return `sha256:${value}`
  return null
}

function withSha256Prefix(value) {
  const normalized = stableDigest(value)
  if (!normalized) throw new Error('producerDigest must be a SHA-256 digest')
  return normalized
}

function digest(value) {
  return `sha256:${digestJson(value)}`
}

function requireIdentifier(value, label, maximum = 240) {
  const normalized = stableIdentity(value, maximum)
  if (!normalized) throw new Error(`${label} must be a stable identity`)
  return normalized
}

function optionalIdentifier(value, label) {
  if (value === undefined || value === null) return null
  return requireIdentifier(value, label)
}

function requireBoundedString(value, label, maximum) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a non-empty bounded string`)
  }
  return value
}

function boundedNullableString(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length > 2_000) throw new Error('projected string is invalid')
  return value
}

function boundedInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null
}

function boundedCursor(value) {
  if (value === undefined || value === null) return null
  if (Number.isInteger(value) && value >= 0) return value
  return boundedNullableString(value)
}

function booleanOrNull(value) {
  return typeof value === 'boolean' ? value : null
}

function booleanDefault(value, fallback) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error('oracle boolean is invalid')
  return value
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function uniqueNullable(values) {
  const unique = uniqueStrings(values.filter(Boolean))
  return unique.length === 1 ? unique[0] : null
}

function intersects(left, right) {
  const rightSet = new Set(right)
  return left.some((item) => rightSet.has(item))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
