import { createHash } from 'node:crypto'
import { extractEvidenceIdentity } from './qualification-collaboration.mjs'
import { canonicalJson } from './qualification-common.mjs'

const TERMINAL_PHASES = new Set(['completed', 'failed'])
const TOOL_EVIDENCE_KINDS = new Set(['tool_call', 'tool_result', 'command', 'file_change'])
const RUNTIME_TOOL_ITEM_TYPES = new Set([
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'webSearch',
  'imageGeneration',
  'collabToolCall',
  'collabAgentToolCall'
])
const MUTATING_CORE_TOOLS = new Set([
  'team.call_member',
  'camp.message.send',
  'team.create_task',
  'team.update_task',
  'memory.write',
  'member.create'
])
const READ_ONLY_CORE_TOOLS = new Set([
  'team.get_task',
  'team.list_tasks',
  'camp.list',
  'camp.search',
  'history.search',
  'camp.read',
  'memory.view',
  'memory.search',
  'memory.read'
])

export async function collectAgentRunExecutionEvidencePages(
  request,
  campId,
  agentRuns,
  { pageSize = 500 } = {}
) {
  const collected = []
  const evidenceIds = new Set()
  let declaredTotal = 0
  const fail = (code) => ({
    coverage: { state: 'partial', reason: { code } },
    declaredTotal: null,
    evidence: collected
  })

  for (const run of [...agentRuns].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!Number.isInteger(run.executionEvidenceCount) || run.executionEvidenceCount < 0) {
      return fail('tool_evidence.declared_total_unavailable')
    }
    let afterSequence = 0
    let expectedSequence = 1
    let frozenThroughSequence = null
    let observedForRun = 0
    while (true) {
      let page
      try {
        page = await request('agentRunEvidence.list', {
          campId,
          agentRunId: run.id,
          afterSequence,
          limit: Math.max(1, Math.min(1_000, Math.trunc(pageSize)))
        })
      } catch {
        return fail('tool_evidence.page_request_failed')
      }
      if (!validPageEnvelope(page, run.id, afterSequence)) {
        return fail('tool_evidence.page_contract_invalid')
      }
      frozenThroughSequence ??= page.throughSequence
      if (page.throughSequence !== frozenThroughSequence) {
        return fail('tool_evidence.source_boundary_changed')
      }
      for (const item of page.evidence) {
        if (item.agentRunId !== run.id
            || item.sequence !== expectedSequence
            || item.sequence > page.throughSequence
            || typeof item.id !== 'string'
            || item.id.length === 0
            || evidenceIds.has(item.id)) {
          return fail('tool_evidence.sequence_gap')
        }
        evidenceIds.add(item.id)
        collected.push(item)
        observedForRun += 1
        expectedSequence += 1
      }
      const lastSequence = page.evidence.at(-1)?.sequence ?? page.throughSequence
      if (page.nextAfterSequence !== lastSequence) {
        return fail('tool_evidence.cursor_mismatch')
      }
      if (!page.hasMore) {
        if (page.nextAfterSequence !== page.throughSequence
            || observedForRun !== page.throughSequence
            || observedForRun !== run.executionEvidenceCount) {
          return fail('tool_evidence.declared_total_mismatch')
        }
        declaredTotal += observedForRun
        break
      }
      if (page.nextAfterSequence >= page.throughSequence) {
        return fail('tool_evidence.page_contract_invalid')
      }
      if (page.evidence.length === 0 || page.nextAfterSequence <= afterSequence) {
        return fail('tool_evidence.cursor_stalled')
      }
      afterSequence = page.nextAfterSequence
    }
  }

  return {
    coverage: { state: 'complete', reason: null },
    declaredTotal,
    evidence: collected
  }
}

export function deriveToolEvidence(snapshot, dispatchBoundary, sourceCoverage) {
  if (!snapshot || !dispatchBoundary) return unavailableToolEvidence()
  const runIds = new Set(snapshot.agentRuns
    .filter((run) => run.campTurnId === dispatchBoundary.campTurnId)
    .map((run) => run.id))
  const groups = new Map()
  for (const evidence of snapshot.executionEvidence ?? []) {
    if (!runIds.has(evidence.agentRunId) || !TOOL_EVIDENCE_KINDS.has(evidence.kind)) continue
    const payload = objectValue(evidence.payload)
    if (!isToolEvidenceCandidate(evidence, payload)) continue
    const nativeIdentity = stringValue(payload.toolCallId)
      ?? stringValue(payload.item?.id)
      ?? stringValue(payload.itemId)
    if (!nativeIdentity) continue
    const family = evidenceFamily(evidence.kind)
    const key = `${evidence.agentRunId}\u0000${family}\u0000${nativeIdentity}`
    const group = groups.get(key) ?? {
      agentRunId: evidence.agentRunId,
      family,
      nativeIdentity,
      observations: []
    }
    group.observations.push({ evidence, payload })
    groups.set(key, group)
  }

  const ledger = [...groups.values()]
    .map(buildToolCallRecord)
    .sort((left, right) => (
      left.agentRunId.localeCompare(right.agentRunId)
      || left.firstSequence - right.firstSequence
      || left.toolCallId.localeCompare(right.toolCallId)
    ))
  const observed = {
    logicalToolCalls: ledger.length,
    succeeded: ledger.filter((record) => record.lifecycle.state === 'succeeded').length,
    failed: ledger.filter((record) => record.lifecycle.state === 'failed').length,
    denied: ledger.filter((record) => record.lifecycle.state === 'denied').length,
    retries: ledger.filter((record) => record.retryRelation.kind === 'retry_observed').length,
    idempotentReplays: ledger.reduce(
      (total, record) => total + record.retryRelation.observationCount,
      0
    ),
    provenDuplicateEffects: ledger.filter(
      (record) => record.duplicateEffect === 'proven_duplicate'
    ).length
  }
  const sourceComplete = sourceCoverage?.coverage?.state === 'complete'
  const coreBuiltinStartFenceComplete = ledger
    .filter((record) => record.authorityClass === 'core' && record.canonicalTool !== null)
    .every((record) => record.coreInvocationStartObserved === true)
  const coverage = sourceComplete
    ? {
        state: 'partial',
        reason: { code: 'tool_evidence.runtime_telemetry_completeness_unattested' }
      }
    : sourceCoverage?.coverage ?? {
        state: 'partial',
        reason: { code: 'tool_evidence.complete_pagination_unavailable' }
      }
  const latencyCoverage = ledger.length === 0
    ? {
        state: 'unavailable',
        reason: { code: 'tool_evidence.no_observed_tool_calls' }
      }
    : {
        state: 'partial',
        reason: { code: 'tool_evidence.non_monotonic_timing_only' }
      }
  const hasMutationCandidate = ledger.some(
    (record) => record.mutationIntent !== 'no'
  )
  const hasFailure = ledger.some((record) => ['failed', 'denied'].includes(record.lifecycle.state))

  return {
    status: 'partial',
    coverage,
    sourceBoundary: {
      declaredExecutionEvidence: sourceComplete ? sourceCoverage.declaredTotal : null,
      observedExecutionEvidence: snapshot.executionEvidence?.length ?? 0,
      coverage: sourceCoverage?.coverage ?? {
        state: 'partial',
        reason: { code: 'tool_evidence.complete_pagination_unavailable' }
      },
      coreBuiltinInvocationCoverage: sourceComplete && coreBuiltinStartFenceComplete
        ? { state: 'complete', reason: null }
        : sourceComplete
          ? {
              state: 'partial',
              reason: { code: 'tool_evidence.core_builtin_start_fence_unattested' }
            }
          : sourceCoverage?.coverage ?? {
              state: 'partial',
              reason: { code: 'tool_evidence.complete_pagination_unavailable' }
            }
    },
    ledger,
    summary: {
      observed,
      authoritativeTotals: nullTotals(),
      latencyCoverage,
      mutationVerification: hasMutationCandidate ? 'none_observed' : 'indeterminate',
      directToolFailureCausality: hasFailure ? 'indeterminate' : 'not_applicable'
    }
  }
}

function buildToolCallRecord(group) {
  const observations = group.observations.sort((left, right) => (
    left.evidence.sequence - right.evidence.sequence
    || left.evidence.id.localeCompare(right.evidence.id)
  ))
  const coreObservations = observations.filter(
    ({ payload }) => payload.sourceAuthority === 'core'
  )
  const authorityClass = coreObservations.length > 0 ? 'core' : 'runtime'
  const canonicalTools = uniqueStrings(coreObservations.map(
    ({ payload }) => stableLabel(payload.canonicalTool)
  ))
  const canonicalTool = canonicalTools.length === 1 ? canonicalTools[0] : null
  const terminalCoreObservations = coreObservations.filter(
    ({ evidence }) => TERMINAL_PHASES.has(evidence.phase)
  )
  const projectionObservations = terminalCoreObservations.length > 0
    ? terminalCoreObservations
    : coreObservations
  const operationProjections = uniqueCanonicalValues(projectionObservations
    .map(({ payload }) => extractEvidenceIdentity(payload)?.operationProjection)
    .filter(Boolean))
  const operationProjection = operationProjections.length === 1
    && operationProjections[0].operation === canonicalTool
    ? operationProjections[0]
    : null
  const toolCallId = stableToolCallId(group.agentRunId, group.family, group.nativeIdentity)
  const authorization = deriveAuthorization(authorityClass, coreObservations)
  const lifecycle = deriveLifecycle(observations, authorization.decision)
  const replayObservations = coreObservations.filter(
    ({ payload }) => payload.idempotentReplay === true
  ).length
  const explicitOriginal = coreObservations.some(
    ({ payload }) => payload.idempotentReplay === false
  )
  const receiptIds = uniqueStrings(coreObservations.map(
    ({ payload }) => stringValue(payload.receiptId)
  ))
  const receiptId = receiptIds.length === 1 ? receiptIds[0] : null
  const operationClass = classifyOperation(group.family, canonicalTool, observations)
  const mutationIntent = classifyMutationIntent(operationClass, canonicalTool)
  const timing = deriveTiming(observations)
  const retryRelation = replayObservations > 0
    ? {
        kind: 'idempotent_replay_observed',
        originalToolCallId: toolCallId,
        idempotencyIdentity: stableDigestIdentity(group.nativeIdentity),
        observationCount: replayObservations
      }
    : explicitOriginal
      ? {
          kind: 'original',
          originalToolCallId: null,
          idempotencyIdentity: stableDigestIdentity(group.nativeIdentity),
          observationCount: 0
        }
      : {
          kind: 'indeterminate',
          originalToolCallId: null,
          idempotencyIdentity: null,
          observationCount: 0
        }
  const duplicateEffect = replayObservations > 0 && receiptId
    ? 'not_proven'
    : mutationIntent === 'no'
      ? 'not_applicable'
      : 'indeterminate'

  return {
    toolCallId,
    agentRunId: group.agentRunId,
    authorityClass,
    operationClass,
    canonicalTool,
    nativeTool: nativeToolName(group.family, observations, canonicalTool),
    lifecycle,
    authorization,
    timing,
    retryRelation,
    receiptId,
    sideEffectIdentity: ['team.call_member', 'camp.message.send'].includes(canonicalTool)
      ? receiptId
      : null,
    duplicateEffect,
    mutationIntent,
    verificationReferences: [],
    directFailureFactReference: null,
    fieldCoverage: fieldCoverage({
      authorityClass,
      canonicalTool,
      authorization,
      replayObservations,
      explicitOriginal,
      receiptId,
      mutationIntent
    }),
    sourceEvidenceIds: observations.map(({ evidence }) => evidence.id),
    operationProjection,
    inputDigest: operationProjection?.inputDigest ?? null,
    resultDigest: operationProjection?.resultDigest ?? null,
    coreInvocationStartObserved: coreObservations.some(
      ({ evidence }) => evidence.phase === 'started'
    ),
    firstSequence: observations[0].evidence.sequence
  }
}

function deriveAuthorization(authorityClass, observations) {
  if (authorityClass !== 'core') {
    return { decision: 'indeterminate', authority: 'runtime', evidenceId: null }
  }
  const decisions = uniqueStrings(observations.map(
    ({ payload }) => stableLabel(payload.authorizationDecision)
  ))
  const decision = decisions.length === 1
    && ['allowed', 'denied', 'indeterminate'].includes(decisions[0])
    ? decisions[0]
    : 'indeterminate'
  return {
    decision,
    authority: 'core',
    evidenceId: observations[0]?.evidence.id ?? null
  }
}

function deriveLifecycle(observations, authorizationDecision) {
  if (authorizationDecision === 'denied') {
    return {
      state: 'denied',
      error: deriveError(observations, 'authorization')
    }
  }
  const terminal = [...observations].reverse().find(
    ({ evidence }) => TERMINAL_PHASES.has(evidence.phase)
  )
  if (terminal?.evidence.phase === 'completed') return { state: 'succeeded', error: null }
  if (terminal?.evidence.phase === 'failed') {
    return { state: 'failed', error: deriveError(observations, 'unknown') }
  }
  if (observations.some(({ evidence }) => evidence.phase === 'started')) {
    return { state: 'started', error: null }
  }
  return { state: 'indeterminate', error: null }
}

function deriveError(observations, fallbackClass) {
  const explicitCodes = uniqueStrings(observations.map(
    ({ payload }) => stableLabel(payload.errorCode)
  ))
  const code = explicitCodes.length === 1 ? explicitCodes[0] : 'runtime.reported_tool_failure'
  return {
    class: errorClass(code, fallbackClass),
    code
  }
}

function errorClass(code, fallback) {
  if (code.includes('capability_denied')) return 'authorization'
  if (code.includes('invalid') || code.includes('conflict') || code.includes('self_send')) {
    return 'validation'
  }
  if (code.includes('timeout')) return 'timeout'
  if (code.includes('unavailable') || code.includes('transport')) return 'transport'
  if (code.includes('internal') || code.startsWith('runtime.')) return 'runtime'
  return fallback === 'authorization' ? 'authorization' : 'tool'
}

function deriveTiming(observations) {
  const startedAt = observations.find(
    ({ evidence }) => evidence.phase === 'started'
  )?.evidence.occurredAt ?? null
  const endedAt = [...observations].reverse().find(
    ({ evidence }) => TERMINAL_PHASES.has(evidence.phase)
  )?.evidence.occurredAt ?? null
  return {
    requestedAt: null,
    startedAt,
    endedAt,
    clockDomain: startedAt || endedAt ? 'core_persisted_wall_clock' : null,
    latencyMilliseconds: null
  }
}

function classifyOperation(family, canonicalTool, observations) {
  if (canonicalTool) return 'core_tool'
  if (family === 'file') return 'file'
  if (family === 'command') {
    const commands = uniqueStrings(observations.map(
      ({ payload }) => stringValue(payload.item?.command)
    ))
    return commands.length === 1 ? classifySimpleCommand(commands[0]) : 'shell'
  }
  const nativeKinds = uniqueStrings(observations.map(
    ({ payload }) => stringValue(payload.kind) ?? stringValue(payload.item?.type)
  ))
  return nativeKinds.some((kind) => /mcp/i.test(kind)) ? 'external_mcp' : 'other_runtime'
}

function classifySimpleCommand(command) {
  const normalized = command.trim()
  if (normalized.length === 0 || /[;&|><\n]/.test(normalized)) return 'shell'
  if (/^(?:\S+\/)?git(?:\s|$)/.test(normalized)) return 'git'
  if (/^(?:(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test|cargo\s+test|pytest(?:\s|$)|python\s+-m\s+pytest|go\s+test|mvn(?:\s+\S+)*\s+test|gradle(?:w)?\s+test|vitest(?:\s|$)|jest(?:\s|$))/.test(normalized)) {
    return 'test'
  }
  if (/^(?:(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?build|cargo\s+build|go\s+build|mvn(?:\s+\S+)*\s+package|gradle(?:w)?\s+build|tsc(?:\s|$))/.test(normalized)) {
    return 'build'
  }
  return 'shell'
}

function classifyMutationIntent(operationClass, canonicalTool) {
  if (canonicalTool && MUTATING_CORE_TOOLS.has(canonicalTool)) return 'yes'
  if (canonicalTool && READ_ONLY_CORE_TOOLS.has(canonicalTool)) return 'no'
  if (operationClass === 'file') return 'yes'
  if (['test', 'build'].includes(operationClass)) return 'indeterminate'
  return 'indeterminate'
}

function nativeToolName(family, observations, canonicalTool) {
  if (canonicalTool) return canonicalTool
  if (family === 'command') return 'commandExecution'
  if (family === 'file') return 'fileChange'
  const kinds = uniqueStrings(observations.map(
    ({ payload }) => stableLabel(payload.item?.type) ?? stableLabel(payload.kind)
  ))
  return kinds.length === 1 ? kinds[0] : 'runtimeToolCall'
}

function fieldCoverage({
  authorityClass,
  canonicalTool,
  authorization,
  replayObservations,
  explicitOriginal,
  receiptId,
  mutationIntent
}) {
  return {
    identity: completeCoverage(),
    lifecycle: completeCoverage(),
    authorization: authorization.decision === 'indeterminate'
      ? partialCoverage('tool_evidence.authorization_indeterminate')
      : completeCoverage(),
    timing: partialCoverage('tool_evidence.non_monotonic_timing_only'),
    retry: authorityClass === 'core' && (replayObservations > 0 || explicitOriginal)
      ? completeCoverage()
      : partialCoverage('tool_evidence.retry_relation_unavailable'),
    receipt: receiptId
      ? completeCoverage()
      : partialCoverage('tool_evidence.receipt_unavailable'),
    sideEffect: ['team.call_member', 'camp.message.send'].includes(canonicalTool) && receiptId
      ? completeCoverage()
      : partialCoverage('tool_evidence.side_effect_identity_unavailable'),
    mutation: mutationIntent === 'indeterminate'
      ? partialCoverage('tool_evidence.mutation_intent_indeterminate')
      : completeCoverage(),
    verification: partialCoverage('tool_evidence.verification_relation_not_implemented')
  }
}

function uniqueCanonicalValues(values) {
  const byDigest = new Map()
  for (const value of values) {
    const encoded = canonicalJson(value)
    byDigest.set(encoded, value)
  }
  return [...byDigest.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => structuredClone(value))
}

function validPageEnvelope(page, agentRunId, requestedAfterSequence) {
  return page?.schemaVersion === 1
    && page.agentRunId === agentRunId
    && page.requestedAfterSequence === requestedAfterSequence
    && Number.isInteger(page.nextAfterSequence)
    && Number.isInteger(page.throughSequence)
    && page.nextAfterSequence >= requestedAfterSequence
    && page.nextAfterSequence <= page.throughSequence
    && page.throughSequence >= requestedAfterSequence
    && typeof page.hasMore === 'boolean'
    && Array.isArray(page.evidence)
}

function isToolEvidenceCandidate(evidence, payload) {
  if (evidence.eventType === 'runtime.action') return true
  if (evidence.eventType === 'command.output.delta') return evidence.kind === 'command'
  if (evidence.eventType === 'file.change.updated') return evidence.kind === 'file_change'
  if (!['activity.started', 'activity.completed'].includes(evidence.eventType)) return false

  const itemType = stringValue(payload.item?.type)
  if (!itemType || !RUNTIME_TOOL_ITEM_TYPES.has(itemType)) return false
  if (evidence.kind === 'command') return itemType === 'commandExecution'
  if (evidence.kind === 'file_change') return itemType === 'fileChange'
  return !['commandExecution', 'fileChange'].includes(itemType)
}

function evidenceFamily(kind) {
  if (kind === 'command') return 'command'
  if (kind === 'file_change') return 'file'
  return 'tool'
}

function stableToolCallId(agentRunId, family, nativeIdentity) {
  const digest = createHash('sha256')
    .update(`${agentRunId}\u0000${family}\u0000${nativeIdentity}`)
    .digest('hex')
  return `tool-call:${digest}`
}

function stableDigestIdentity(value) {
  if (/^sha256:[a-f0-9]{64}$/.test(value)) return value
  return /^[a-f0-9]{64}$/.test(value) ? `sha256:${value}` : null
}

function stableLabel(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
    ? value
    : null
}

function stringValue(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))]
}

function completeCoverage() {
  return { state: 'complete', reason: null }
}

function partialCoverage(code) {
  return { state: 'partial', reason: { code } }
}

function nullTotals() {
  return {
    logicalToolCalls: null,
    succeeded: null,
    failed: null,
    denied: null,
    retries: null,
    idempotentReplays: null,
    provenDuplicateEffects: null
  }
}

function unavailableToolEvidence() {
  const coverage = {
    state: 'unavailable',
    reason: { code: 'tool_evidence.authoritative_snapshot_unavailable' }
  }
  return {
    status: 'unavailable',
    coverage,
    ledger: [],
    summary: {
      observed: null,
      authoritativeTotals: null,
      latencyCoverage: coverage,
      mutationVerification: 'indeterminate',
      directToolFailureCausality: 'indeterminate'
    }
  }
}
