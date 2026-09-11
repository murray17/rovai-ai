import { validateTaskSourceMaterial } from './qualification-task-source-materials.mjs'
import { readFile, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { stableEvidenceId } from './qualification-evidence-index.mjs'
import {
  QUALIFICATION_RUNNER_VERSION,
  artifactFileName,
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
export const COLLABORATION_MESSAGE_EVIDENCE_SCHEMA_VERSION = '2.0.0'

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
  evaluationAttemptId = null,
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
        sequence: Number.isSafeInteger(message.sequence) ? message.sequence : null,
        replyToMessageId: message.replyToCampMessageId ?? message.replyToMessageId ?? null,
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
      taskId: call.taskId ?? null,
      deliveryEvidenceReference: evidenceReferences?.messageDeliveries?.[call.deliveryId] ?? null,
      sourceDelivery: structuredClone(deliveryById.get(call.deliveryId) ?? null)
    })
  }
  const messages = [...projectedByMessageId.values()].map((message) => {
    const deliveries = message.deliveries.sort((left, right) => left.callId.localeCompare(right.callId))
    return {
      ...message,
      taskIds: [...new Set(deliveries.map((delivery) => delivery.taskId).filter(Boolean))].sort(),
      deliveries
    }
  })
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
    ...(evaluationAttemptId ? { evaluationRevision: { evaluationAttemptId, evidenceIndexArtifactId: evidenceIndex.artifactId, producerDigest } } : {}),
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
    artifactFileName(artifact.artifactId)
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
      || !['1.0.0', COLLABORATION_MESSAGE_EVIDENCE_SCHEMA_VERSION].includes(artifact.schemaVersion)
      || artifact.payloadDigest !== `sha256:${digestJson(artifact.payload)}`
      || artifact.artifactId !== `collaboration-message-evidence:${artifact.payloadDigest.slice(-32)}`
      || artifact.payload?.policyId !== SEMANTIC_JUDGE_CONTENT_POLICY_ID
      || artifact.binding?.trialId !== artifact.payload?.trialId) {
    throw new Error('Collaboration Message Evidence envelope identity is invalid')
  }
  if (artifact.payload.evaluationRevision && (artifact.payload.evaluationRevision.evidenceIndexArtifactId !== artifact.binding.evidenceIndexArtifactId
      || withSha256Prefix(artifact.payload.evaluationRevision.producerDigest) !== artifact.producer.digest
      || typeof artifact.payload.evaluationRevision.evaluationAttemptId !== 'string')) throw new Error('Collaboration Message Evidence revision binding is invalid')
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
          || (message.replyToMessageId ?? null)
            !== (message.sourceMessage?.replyToCampMessageId
              ?? message.sourceMessage?.replyToMessageId
              ?? null)
          || (message.sequence ?? null) !== (message.sourceMessage?.sequence ?? null)
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
            || (call.taskId ?? null) !== (delivery.taskId ?? null)
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
  collaborationLedger,
  caseEvaluation = null,
  evaluationSnapshot = null
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
        sequence: message.sequence ?? null,
        replyToMessageId: message.replyToMessageId ?? null,
        taskIds: Array.isArray(message.taskIds) ? [...message.taskIds] : [],
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
      // Empty-file creation remains in boundary facts, without an invalid text segment.
      if (!content.length || content.length > SEMANTIC_JUDGE_CONTENT_ALLOWLIST.changedWorkspaceCode.maximumCharacters) continue
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
  if (['generic-task-v3', 'generic-task-v4', 'generic-task-v5', 'generic-task-v6', 'generic-task-v7', 'generic-task-v8', 'generic-task-v9', 'generic-task-v10', 'generic-task-v11'].includes(caseEvaluation?.judgeProfile)) {
    const extra = await buildTaskJudgeSegments({ evidenceDirectory, result, evidenceIndex, evidenceFiles: caseEvaluation.evidenceFiles ?? [], requireDeliveryClosure: caseEvaluation.judgeProfile === 'generic-task-v11', evaluationSnapshot, includeEvaluationContext: ['generic-task-v4', 'generic-task-v5', 'generic-task-v6', 'generic-task-v7', 'generic-task-v8', 'generic-task-v9', 'generic-task-v10', 'generic-task-v11'].includes(caseEvaluation.judgeProfile) })
    const seen = new Set(segments.map(segment => segment.evidenceReference.evidenceId))
    for (const segment of extra) if (!seen.has(segment.evidenceReference.evidenceId)) {
      segments.push(segment)
      seen.add(segment.evidenceReference.evidenceId)
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

// Sources are retained public messages and frozen workspace files, not live
// workspaces, private Runtime logs or model reasoning. Every body is hash-bound.
export async function buildTaskJudgeSegments({ evidenceDirectory, result, evidenceIndex, evidenceFiles, includeEvaluationContext = false, evaluationSnapshot = null, requireDeliveryClosure = false }) {
  if (!Array.isArray(evidenceFiles) || evidenceFiles.length > 64 || new Set(evidenceFiles).size !== evidenceFiles.length) throw new Error('Invalid task evidence file allowlist')
  const indexRecords = new Map(evidenceIndex.payload.records.map(record => [record.evidenceId, record]))
  const segments = []
  const root = await containedRealpath(evidenceDirectory, validateRelativeLocator(result.deliveredWorkspaceSnapshot?.directory, 'Task snapshot'))
  let totalCharacters = 0
  for (const path of [...evidenceFiles].sort()) {
    validateRelativeLocator(path, 'Task evidence file')
    const evidenceReference = { artifactId: evidenceIndex.artifactId, evidenceId: stableEvidenceId('runner.workspace-content', path) }
    const record = indexRecords.get(evidenceReference.evidenceId)
    if (record?.safeForJudge !== true) continue
    const absolute = await containedRealpath(root, path)
    if (absolute !== join(root, path)) throw new Error('Task evidence file must not traverse a symlink')
    const bytes = await readFile(absolute)
    if (record.contentDigest !== `sha256:${sha256(bytes)}`) throw new Error('Task evidence file digest mismatch')
    let content
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { continue }
    if (!content || content.length > 50_000 || totalCharacters + content.length > 150_000) continue
    totalCharacters += content.length
    segments.push({ segmentId: `task-file-base64:${Buffer.from(path).toString('base64url')}`, kind: 'code', path, authorAgentProfileId: null, visibility: 'workspace', content, evidenceReference })
  }
  const raw = await readFile(join(evidenceDirectory, 'observations.ndjson'), 'utf8')
  if (sha256(raw) !== result.observationDigest) throw new Error('Task observation digest mismatch')
  const observation = JSON.parse(raw.trim().split('\n').at(-1))
  if (digestJson(observation.snapshot) !== observation.digest) throw new Error('Task snapshot digest mismatch')
  const snapshot = evaluationSnapshot ?? observation.snapshot
  const runs = new Set(snapshot.agentRuns.filter(run => run.campTurnId === result.dispatchBoundary.campTurnId).map(run => run.id))
  const context = includeEvaluationContext && ['bounded-evaluation-context-v1', 'bounded-evaluation-context-v2', 'bounded-evaluation-context-v3', 'bounded-evaluation-context-v4', 'bounded-evaluation-context-v5'].includes(snapshot.evaluationContext?.policyId) ? snapshot.evaluationContext : null
  if (context) {
    const events = new Map((snapshot.executionEvidence ?? []).filter(event => runs.has(event.agentRunId)).map(event => [event.id, event]))
    const tasks = new Map((snapshot.tasks ?? []).filter(task => runs.has(task.sourceAgentRunId)).map(task => [task.taskId ?? task.id, task]))
    for (const receipt of context.receipts) {
      if (events.get(receipt.sourceEvidenceId)?.payloadDigest !== receipt.sourcePayloadDigest || sha256(receipt.content) !== receipt.contentDigest) throw new Error('Evaluation receipt source digest mismatch')
      addContextSegment('runtime.command-receipt', receipt.sourceEvidenceId, 'test_output', 'verification-receipt', receipt.content)
    }
    for (const file of context.initialFiles ?? []) {
      const evidenceReference = { artifactId: evidenceIndex.artifactId, evidenceId: stableEvidenceId('runner.initial-workspace-content', file.path) }
      const record = indexRecords.get(evidenceReference.evidenceId)
      if (record?.contentDigest !== `sha256:${sha256(file.content)}` || sha256(file.content) !== file.contentDigest) throw new Error('Initial fixture content digest mismatch')
      if (!file.content || file.content.length > 50_000 || totalCharacters + file.content.length > 310_000) continue
      totalCharacters += file.content.length
      const path = `initial-fixture/${file.path}`
      segments.push({ segmentId: `task-file-base64:${Buffer.from(path).toString('base64url')}`, kind: 'code', path, authorAgentProfileId: null, visibility: 'workspace', content: file.content, evidenceReference })
    }
    if (context.policyId === 'bounded-evaluation-context-v5') {
      if (!context.sourceMaterials) throw new Error('task_source.inventory_missing')
      for (const source of context.sourceMaterials.records) {
        validateTaskSourceMaterial(source, snapshot, result.dispatchBoundary)
        if (totalCharacters + source.content.length > 310_000) throw new Error('task_source.pack_budget_exceeded')
        addContextSegment('core.task-source', source.sourceMessageId, 'comment', 'task-source', source.content)
      }
    }
    for (const task of context.tasks) {
      const source = tasks.get(task.taskId), body = JSON.parse(task.content)
      if (!source || source.titleDigest !== sha256(body.title) || source.descriptionDigest !== sha256(body.description)) throw new Error('Evaluation Task source digest mismatch')
      addContextSegment('core.task-description', task.taskId, 'comment', 'task-description', task.content)
    }
  }
  function addContextSegment(prefix, sourceId, kind, segmentPrefix, content) {
    const evidenceReference = { artifactId: evidenceIndex.artifactId, evidenceId: stableEvidenceId(prefix, sourceId) }
    const record = indexRecords.get(evidenceReference.evidenceId)
    if (record?.safeForJudge !== true || record.contentDigest !== `sha256:${sha256(content)}`) throw new Error('Evaluation context index digest mismatch')
    if (!content || content.length > 50_000 || totalCharacters + content.length > 310_000) return
    totalCharacters += content.length
    segments.push({ segmentId: `${segmentPrefix}:${sourceId}`, kind, authorAgentProfileId: null, visibility: 'public_to_camp', content, evidenceReference })
  }
  const leadRun = snapshot.agentRuns.find(run => run.id === result.dispatchBoundary.rootAgentRunId)
  const leadId = leadRun?.agentId ?? leadRun?.agentProfileId
  const deliveries = snapshot.messages.filter(message => context?.deliveryMessageIds.includes(message.id))
    .sort((a, b) => a.sequence - b.sequence)
  if (requireDeliveryClosure && (!context || deliveries.length !== context.deliveryMessageIds.length
      || !leadId || deliveries.some(message => message.authorType !== 'agent' || message.authorId !== leadId
        || !runs.has(message.sourceAgentRunId) || message.campTurnId !== result.dispatchBoundary.campTurnId
        || message.addressedAgentIds?.length || (!Number.isSafeInteger(message.sequence) || message.sequence < 1))
      || new Set(deliveries.map(message => message.sequence)).size !== deliveries.length)) throw new Error('delivery_history.inventory_incomplete')
  const deliveryOrder = new Map(deliveries.map((message, index) => [message.id, index + 1]))
  let deliveryCharacters = 0
  const retainedDeliveries = new Set()
  const currentDeliveryId = ['bounded-evaluation-context-v3', 'bounded-evaluation-context-v4', 'bounded-evaluation-context-v5'].includes(context?.policyId) ? snapshot.messages.filter(message => context.deliveryMessageIds.includes(message.id)).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)).at(-1)?.id : null
  for (const message of snapshot.messages) {
    if (message.authorType !== 'agent' || !runs.has(message.sourceAgentRunId) || message.campTurnId !== result.dispatchBoundary.campTurnId) continue
    const body = typeof message.body === 'string' ? message.body : (message.content ?? []).filter(part => part.kind === 'text').map(part => part.text).join('')
    const evidenceReference = { artifactId: evidenceIndex.artifactId, evidenceId: stableEvidenceId('core.message-content', message.id) }
    const record = indexRecords.get(evidenceReference.evidenceId)
    const requiredDelivery = requireDeliveryClosure && deliveryOrder.has(message.id)
    if (requiredDelivery) {
      deliveryCharacters += body.length
      if (deliveries.length > 64 || deliveryCharacters > 160_000) throw new Error('delivery_history.budget_exceeded')
    }
    if (record?.safeForJudge !== true || !body || body.length > 50_000 || totalCharacters + body.length > (includeEvaluationContext ? 310_000 : 150_000)) {
      if (requiredDelivery) throw new Error('delivery_history.content_unavailable_or_over_budget')
      continue
    }
    if (requiredDelivery) retainedDeliveries.add(message.id)
    if (record.contentDigest !== `sha256:${sha256(body)}`) throw new Error('Task public message digest mismatch')
    totalCharacters += body.length
    const delivery = context?.deliveryMessageIds.includes(message.id) && !(message.addressedAgentIds?.length)
    segments.push({ segmentId: `${delivery ? `delivery-message:${['bounded-evaluation-context-v3', 'bounded-evaluation-context-v4', 'bounded-evaluation-context-v5'].includes(context.policyId) ? currentDeliveryId === message.id ? 'current:' : requireDeliveryClosure ? `historical:ordered-${String(deliveryOrder.get(message.id)).padStart(4, '0')}:` : 'historical:' : ''}` : 'participant-message:'}${message.id}`, kind: delivery ? 'comment' : 'participant_message', messageId: message.id, sequence: message.sequence, replyToMessageId: message.replyToCampMessageId ?? null,
      callIds: [], taskIds: [], createdAt: message.createdAt, authorAgentProfileId: message.authorId, visibility: 'public_to_camp', content: body, evidenceReference })
  }
  if (requireDeliveryClosure && retainedDeliveries.size !== deliveries.length) throw new Error('delivery_history.inventory_incomplete')
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
