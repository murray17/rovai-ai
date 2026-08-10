import { readFile, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import {
  QUALIFICATION_RUNNER_VERSION,
  atomicWriteJson,
  canonicalJson,
  digestJson,
  sha256,
  validateRelativeLocator,
  writePrivateJsonExclusive
} from './qualification-common.mjs'

export const SEMANTIC_JUDGE_CONTENT_POLICY_ID = 'semantic-judge-content-allowlist-v1'
export const COLLABORATION_MESSAGE_EVIDENCE_SCHEMA_ID =
  'rovai.qualification.collaboration-message-evidence'
export const COLLABORATION_MESSAGE_EVIDENCE_SCHEMA_VERSION = '1.0.0'

// This is an executable allowlist, not documentation about what the caller
// usually supplies.  buildSemanticJudgeUntrustedEvidence only projects the
// three enabled content classes below.  Everything else remains a digest or a
// deterministic fact outside untrustedEvidence.
export const SEMANTIC_JUDGE_CONTENT_ALLOWLIST = Object.freeze({
  participantMessages: Object.freeze({
    enabled: true,
    authority: 'core_public_message_delivery',
    maximumCharacters: 50_000
  }),
  changedWorkspaceCode: Object.freeze({
    enabled: true,
    authority: 'delivered_workspace_snapshot',
    maximumCharacters: 50_000
  }),
  finalResponse: Object.freeze({
    enabled: true,
    authority: 'core_final_response',
    maximumCharacters: 50_000
  }),
  testOutput: Object.freeze({ enabled: false }),
  workspaceComments: Object.freeze({ enabled: false }),
  contextManifest: Object.freeze({ enabled: false }),
  runtimePrivateLog: Object.freeze({ enabled: false }),
  rawToolPayload: Object.freeze({ enabled: false }),
  withheldVerifier: Object.freeze({ enabled: false }),
  referenceImplementation: Object.freeze({ enabled: false }),
  hiddenReasoning: Object.freeze({ enabled: false })
})

export function semanticJudgeContentKindAllowed(kind) {
  return (kind === 'participant_message'
      && SEMANTIC_JUDGE_CONTENT_ALLOWLIST.participantMessages.enabled)
    || (kind === 'code'
      && SEMANTIC_JUDGE_CONTENT_ALLOWLIST.changedWorkspaceCode.enabled)
    || (kind === 'final_response'
      && SEMANTIC_JUDGE_CONTENT_ALLOWLIST.finalResponse.enabled)
}

export function buildCollaborationMessageEvidence({
  trialId,
  snapshot,
  dispatchBoundary,
  collaborationEvidence,
  evidenceReferences,
  evidenceIndex,
  producerDigest
}) {
  const calls = collaborationEvidence?.sourceSurface === 'public_message_delivery_v1'
    ? collaborationEvidence.a2a ?? []
    : []
  const messageById = new Map((Array.isArray(snapshot?.messages) ? snapshot.messages : [])
    .map((message) => [message.id, message]))
  const deliveryById = new Map((Array.isArray(snapshot?.messageDeliveries)
    ? snapshot.messageDeliveries
    : []).map((delivery) => [delivery.id, delivery]))
  const projectedByMessageId = new Map()
  for (const call of calls) {
    const message = messageById.get(call.messageId)
    const evidenceReference = evidenceReferences?.messageContents?.[call.messageId] ?? null
    if (!message || typeof message.body !== 'string' || !evidenceReference) continue
    if (message.body.length
        > SEMANTIC_JUDGE_CONTENT_ALLOWLIST.participantMessages.maximumCharacters) continue
    const bodyDigest = sha256(message.body)
    if (call.contentDigest && call.contentDigest !== bodyDigest) {
      throw new Error(`Collaboration message ${call.messageId} content digest disagrees with Call evidence`)
    }
    if (!projectedByMessageId.has(message.id)) {
      projectedByMessageId.set(message.id, {
        messageId: message.id,
        authorAgentProfileId: message.authorId ?? call.senderAgentId,
        visibility: 'public_to_camp',
        createdAt: message.createdAt ?? call.acceptedAt,
        body: message.body,
        bodyDigest,
        bodyBytes: Buffer.byteLength(message.body),
        evidenceReference,
        metadataEvidenceReference: evidenceReferences?.messages?.[message.id] ?? null,
        sourceMessage: normalizedMessageMetadata(message),
        deliveries: []
      })
    }
    const projected = projectedByMessageId.get(message.id)
    if (projected.bodyDigest !== bodyDigest
        || projected.authorAgentProfileId !== (message.authorId ?? call.senderAgentId)) {
      throw new Error(`Collaboration message ${message.id} has inconsistent fanout content`)
    }
    projected.deliveries.push({
      callId: call.callId,
      deliveryId: call.deliveryId,
      recipientAgentProfileId: call.recipientAgentId,
      deliveryEvidenceReference: evidenceReferences?.messageDeliveries?.[call.deliveryId] ?? null,
      sourceDelivery: structuredClone(deliveryById.get(call.deliveryId) ?? null)
    })
  }
  const messages = [...projectedByMessageId.values()].map((message) => ({
    ...message,
    deliveries: message.deliveries.sort((left, right) => left.callId.localeCompare(right.callId))
  }))
  messages.sort((left, right) => (
    String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
      || left.messageId.localeCompare(right.messageId)
  ))
  const acceptedCalls = collaborationEvidence?.metrics?.acceptedMemberCalls
  const sourceCoverageComplete = collaborationEvidence?.metrics?.coverage
    === 'complete_with_message_delivery_receipts'
  const allCallsProjected = Number.isInteger(acceptedCalls)
    && acceptedCalls === calls.length
    && calls.length === messages.reduce((total, message) => total + message.deliveries.length, 0)
  const noCallsObserved = acceptedCalls === 0 && calls.length === 0
  const payload = {
    policyId: SEMANTIC_JUDGE_CONTENT_POLICY_ID,
    trialId,
    campTurnId: dispatchBoundary?.campTurnId ?? null,
    sourceSurface: collaborationEvidence?.sourceSurface ?? null,
    coverage: sourceCoverageComplete && allCallsProjected
      ? { state: 'complete', reason: null }
      : noCallsObserved
        ? {
            state: 'not_applicable',
            reason: { code: 'semantic_evidence.no_public_a2a_calls' }
          }
        : {
            state: 'partial',
            reason: { code: 'semantic_evidence.public_a2a_content_incomplete' }
    },
    messages
  }
  const payloadDigest = `sha256:${digestJson(payload)}`
  const artifact = {
    artifactId: `collaboration-message-evidence:${payloadDigest.slice(-32)}`,
    schemaId: COLLABORATION_MESSAGE_EVIDENCE_SCHEMA_ID,
    schemaVersion: COLLABORATION_MESSAGE_EVIDENCE_SCHEMA_VERSION,
    producer: {
      id: 'rovai-qualification-runner',
      version: QUALIFICATION_RUNNER_VERSION,
      digest: withSha256Prefix(producerDigest)
    },
    binding: {
      trialId,
      evidenceIndexArtifactId: evidenceIndex?.artifactId ?? null
    },
    sourceBoundaries: [{
      authorityClass: 'derived',
      sourceId: 'derived.collaboration-message-evidence',
      digest: payloadDigest,
      throughSequence: null,
      declaredTotal: calls.length,
      clockDomain: null,
      coverage: structuredClone(payload.coverage)
    }],
    payloadDigest,
    payload
  }
  validateCollaborationMessageEvidence(artifact, { evidenceIndex })
  return artifact
}

export async function retainCollaborationMessageEvidence(evidenceDirectory, artifact) {
  validateCollaborationMessageEvidence(artifact)
  const locator = join(
    'collaboration-message-evidence',
    `${artifact.artifactId}.json`
  )
  const immutablePath = join(evidenceDirectory, locator)
  try {
    await writePrivateJsonExclusive(immutablePath, artifact)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const existing = await readJson(immutablePath)
    if (canonicalJson(existing) !== canonicalJson(artifact)) {
      throw new Error('immutable Collaboration Message Evidence identity collision')
    }
  }
  await atomicWriteJson(join(evidenceDirectory, 'collaboration-message-evidence.json'), artifact)
  return {
    artifactId: artifact.artifactId,
    schemaId: artifact.schemaId,
    schemaVersion: artifact.schemaVersion,
    payloadDigest: artifact.payloadDigest,
    locator,
    policyId: artifact.payload.policyId,
    coverage: artifact.payload.coverage,
    messageCount: artifact.payload.messages.length
  }
}

export function validateCollaborationMessageEvidence(artifact, {
  result = null,
  evidenceIndex = null,
  collaborationLedger = null
} = {}) {
  if (artifact?.schemaId !== COLLABORATION_MESSAGE_EVIDENCE_SCHEMA_ID
      || artifact.schemaVersion !== COLLABORATION_MESSAGE_EVIDENCE_SCHEMA_VERSION
      || artifact.payloadDigest !== `sha256:${digestJson(artifact.payload)}`
      || artifact.artifactId !== `collaboration-message-evidence:${artifact.payloadDigest.slice(-32)}`
      || artifact.payload?.policyId !== SEMANTIC_JUDGE_CONTENT_POLICY_ID
      || artifact.binding?.trialId !== artifact.payload?.trialId) {
    throw new Error('Collaboration Message Evidence envelope identity is invalid')
  }
  if (result && artifact.binding.trialId !== result.trialId) {
    throw new Error('Collaboration Message Evidence is bound to another Trial')
  }
  if (evidenceIndex
      && artifact.binding.evidenceIndexArtifactId !== evidenceIndex.artifactId) {
    throw new Error('Collaboration Message Evidence is bound to another Evidence Index')
  }
  if (!Array.isArray(artifact.sourceBoundaries)
      || artifact.sourceBoundaries.length !== 1
      || artifact.sourceBoundaries[0].digest !== artifact.payloadDigest
      || canonicalJson(artifact.sourceBoundaries[0].coverage)
        !== canonicalJson(artifact.payload.coverage)
      || !['complete', 'partial', 'not_applicable'].includes(artifact.payload.coverage?.state)) {
    throw new Error('Collaboration Message Evidence source boundary is invalid')
  }
  if (collaborationLedger
      && collaborationLedger.binding?.trialId !== artifact.binding.trialId) {
    throw new Error('Collaboration Message Evidence and Ledger Trial bindings differ')
  }
  const indexRecords = new Map((evidenceIndex?.payload?.records ?? []).map((record) => [
    record.evidenceId,
    record
  ]))
  const ledgerCalls = new Map((collaborationLedger?.payload?.calls ?? []).map((call) => [
    call.callId,
    call
  ]))
  const seenMessages = new Set()
  const seenCalls = new Set()
  for (const message of artifact.payload.messages ?? []) {
    if (seenMessages.has(message.messageId)
        || !Array.isArray(message.deliveries)
        || message.deliveries.length === 0
        || message.visibility !== 'public_to_camp') {
      throw new Error('Collaboration Message Evidence message projection is invalid')
    }
    seenMessages.add(message.messageId)
    if (evidenceIndex) {
      assertContentReference({
        reference: message.evidenceReference,
        body: message.body,
        declaredDigest: message.bodyDigest,
        evidenceIndex,
        indexRecords,
        label: `Collaboration message ${message.messageId}`
      })
      const metadata = referencedRecord(
        message.metadataEvidenceReference,
        evidenceIndex,
        indexRecords,
        `Collaboration message ${message.messageId} metadata`
      )
      if (metadata.contentDigest !== `sha256:${digestJson(message.sourceMessage)}`
          || message.sourceMessage?.id !== message.messageId
          || message.sourceMessage?.bodyDigest !== message.bodyDigest
          || (message.sourceMessage?.authorId ?? null) !== message.authorAgentProfileId) {
        throw new Error(`Collaboration message ${message.messageId} metadata is not source-bound`)
      }
    }
    for (const delivery of message.deliveries) {
      if (seenCalls.has(delivery.callId)) {
        throw new Error('Collaboration Message Evidence repeats a Call association')
      }
      seenCalls.add(delivery.callId)
      if (evidenceIndex) {
        const deliveryRecord = referencedRecord(
          delivery.deliveryEvidenceReference,
          evidenceIndex,
          indexRecords,
          `Collaboration delivery ${delivery.deliveryId}`
        )
        if (deliveryRecord.contentDigest !== `sha256:${digestJson(delivery.sourceDelivery)}`
            || delivery.sourceDelivery?.id !== delivery.deliveryId
            || delivery.sourceDelivery?.messageId !== message.messageId
            || delivery.sourceDelivery?.recipientAgentId !== delivery.recipientAgentProfileId) {
          throw new Error(`Collaboration delivery ${delivery.deliveryId} is not source-bound`)
        }
      }
      if (collaborationLedger) {
        const call = ledgerCalls.get(delivery.callId)
        if (!call
            || call.senderMemberId !== message.authorAgentProfileId
            || call.recipientMemberId !== delivery.recipientAgentProfileId
            || canonicalJson(call.contentEvidenceReference)
              !== canonicalJson(message.evidenceReference)) {
          throw new Error(`Collaboration message ${message.messageId} attribution differs from Ledger`)
        }
      }
    }
  }
  return artifact
}

export async function buildSemanticJudgeUntrustedEvidence({
  evidenceDirectory,
  result,
  evidenceIndex,
  workspaceMutationLedger,
  collaborationLedger
}) {
  const indexRecords = new Map(
    evidenceIndex.payload.records.map((record) => [record.evidenceId, record])
  )
  const responseEvidence = await readJson(
    join(evidenceDirectory, 'final-response-evidence.json')
  )
  const finalMessages = responseEvidence.messages.filter((message) => message.isFinal === true)
  if (finalMessages.length !== 1) throw new Error('Semantic Review requires exactly one final response')
  const finalMessage = finalMessages[0]
  const responseReference = result.deliveryLayer?.finalResponseEvidence?.find((message) => (
    message.messageId === finalMessage.messageId
  ))?.evidenceReference
  if (!responseReference) throw new Error('Final response has no Evidence Reference')
  assertContentReference({
    reference: responseReference,
    body: finalMessage.body,
    evidenceIndex,
    indexRecords,
    label: 'Final response'
  })
  const segments = [{
    segmentId: `final-response:${finalMessage.messageId}`,
    kind: 'final_response',
    authorAgentProfileId: finalMessage.agentId,
    visibility: 'public_to_camp',
    content: finalMessage.body,
    evidenceReference: responseReference
  }]

  const collaborationArtifact = await readOptionalJson(
    join(evidenceDirectory, 'collaboration-message-evidence.json')
  )
  if (collaborationArtifact) {
    if ((collaborationArtifact.payload?.messages?.length ?? 0) > 0 && !collaborationLedger) {
      throw new Error('Collaboration Message Evidence requires its Collaboration Ledger')
    }
    validateCollaborationMessageEvidence(collaborationArtifact, {
      result,
      evidenceIndex,
      collaborationLedger
    })
    for (const message of collaborationArtifact.payload.messages ?? []) {
      segments.push({
        segmentId: `participant-message:${message.messageId ?? message.callId}`,
        kind: 'participant_message',
        callIds: message.deliveries.map((delivery) => delivery.callId),
        messageId: message.messageId ?? null,
        createdAt: message.createdAt ?? null,
        authorAgentProfileId: message.authorAgentProfileId,
        visibility: message.visibility,
        content: message.body,
        evidenceReference: message.evidenceReference
      })
    }
  }

  const snapshotRoot = await containedRealpath(
    evidenceDirectory,
    validateRelativeLocator(
      result.deliveredWorkspaceSnapshot?.directory,
      'Delivered Workspace Snapshot directory'
    )
  )
  const seenPaths = new Set()
  for (const mutation of workspaceMutationLedger.payload.records) {
    const reference = mutation.evidenceReferences?.find((candidate) => (
      candidate.evidenceId.startsWith('runner.workspace-content:')
    ))
    if (!reference) continue
    const sourceRecord = indexRecords.get(reference.evidenceId)
    if (sourceRecord?.safeForJudge !== true) continue
    for (const path of mutation.paths) {
      if (seenPaths.has(path)) continue
      seenPaths.add(path)
      const changed = result.workspaceDiff?.changed?.find((entry) => entry.path === path)
      if (changed?.after?.type !== 'file') continue
      const absolute = await containedRealpath(snapshotRoot, validateRelativeLocator(path, 'Changed path'))
      const bytes = await readFile(absolute)
      const expectedDigest = String(changed.after.digest ?? '').replace(/^sha256:/, '')
      if (!/^[a-f0-9]{64}$/.test(expectedDigest)
          || sha256(bytes) !== expectedDigest
          || sourceRecord.contentDigest !== `sha256:${expectedDigest}`) {
        throw new Error(`Changed workspace content ${path} does not match its captured digest`)
      }
      let content
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        continue
      }
      if (content.length > SEMANTIC_JUDGE_CONTENT_ALLOWLIST.changedWorkspaceCode.maximumCharacters) continue
      segments.push({
        segmentId: `code:${mutation.mutationId}:${digestJson(path).slice(0, 16)}`,
        kind: 'code',
        authorAgentProfileId: null,
        visibility: 'workspace',
        path,
        content,
        evidenceReference: reference
      })
    }
  }
  for (const segment of segments) {
    if (segment.evidenceReference.artifactId !== evidenceIndex.artifactId
        || !indexRecords.has(segment.evidenceReference.evidenceId)) {
      throw new Error('Semantic Review source segment has an unresolved Evidence Reference')
    }
  }
  return segments
}

function referencedRecord(reference, evidenceIndex, indexRecords, label) {
  if (reference?.artifactId !== evidenceIndex.artifactId) {
    throw new Error(`${label} has an unresolved Evidence Reference`)
  }
  const record = indexRecords.get(reference.evidenceId)
  if (!record) throw new Error(`${label} has an unresolved Evidence Reference`)
  return record
}

function normalizedMessageMetadata(message) {
  const { body, ...metadata } = message
  return {
    ...structuredClone(metadata),
    bodyDigest: String(message.bodyDigest ?? sha256(body)).replace(/^sha256:/, ''),
    bodyBytes: Number.isSafeInteger(message.bodyBytes)
      ? message.bodyBytes
      : Buffer.byteLength(body)
  }
}

function withSha256Prefix(value) {
  if (typeof value !== 'string') throw new Error('sha256 identity is required')
  return value.startsWith('sha256:') ? value : `sha256:${value}`
}

function assertContentReference({
  reference,
  body,
  declaredDigest = null,
  evidenceIndex,
  indexRecords,
  label
}) {
  if (typeof body !== 'string') throw new Error(`${label} body is unavailable`)
  if (reference?.artifactId !== evidenceIndex.artifactId) {
    throw new Error(`${label} has an unresolved Evidence Reference`)
  }
  const record = indexRecords.get(reference.evidenceId)
  if (!record || record.safeForJudge !== true) {
    throw new Error(`${label} Evidence Reference is not Judge-safe`)
  }
  const bodyDigest = sha256(body)
  if (declaredDigest && declaredDigest !== bodyDigest) {
    throw new Error(`${label} declared digest does not match its body`)
  }
  // v0.54 content records bind the exact body digest.  Historical final
  // response metadata records remain readable, but are never used for new
  // collaboration message projections.
  if (reference.evidenceId.startsWith('core.message-content:')
      && record.contentDigest !== `sha256:${bodyDigest}`) {
    throw new Error(`${label} body does not match its Evidence Index record`)
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function readOptionalJson(path) {
  try {
    return await readJson(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function containedRealpath(root, relativePath) {
  const absoluteRoot = await realpath(root)
  const absolute = await realpath(join(absoluteRoot, relativePath))
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error('Semantic Review source locator escapes the Evidence Bundle')
  }
  return absolute
}
