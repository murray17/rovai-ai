import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectAgentRunExecutionEvidencePages,
  deriveToolEvidence
} from './qualification-tool-evidence.mjs'
import { digestJson } from './qualification-common.mjs'

test('execution evidence pagination proves sequence and declared-total coverage', async () => {
  const calls = []
  const request = async (method, params) => {
    calls.push({ method, params })
    assert.equal(method, 'agentRunEvidence.list')
    if (params.agentRunId === 'run-1' && params.afterSequence === 0) {
      return page('run-1', 0, 2, 3, true, [evidence('ev-1', 'run-1', 1), evidence('ev-2', 'run-1', 2)])
    }
    if (params.agentRunId === 'run-1' && params.afterSequence === 2) {
      return page('run-1', 2, 3, 3, false, [evidence('ev-3', 'run-1', 3)])
    }
    if (params.agentRunId === 'run-2') {
      return page('run-2', 0, 0, 0, false, [])
    }
    throw new Error(`unexpected request: ${JSON.stringify(params)}`)
  }
  const result = await collectAgentRunExecutionEvidencePages(request, 'camp-1', [
    { id: 'run-1', executionEvidenceCount: 3 },
    { id: 'run-2', executionEvidenceCount: 0 }
  ], { pageSize: 2 })

  assert.equal(result.coverage.state, 'complete')
  assert.equal(result.declaredTotal, 3)
  assert.deepEqual(result.evidence.map((item) => item.id), ['ev-1', 'ev-2', 'ev-3'])
  assert.equal(calls.length, 3)
})

test('execution evidence pagination fails closed on a sequence gap', async () => {
  const request = async () => page(
    'run-1',
    0,
    3,
    3,
    false,
    [evidence('ev-1', 'run-1', 1), evidence('ev-3', 'run-1', 3)]
  )
  const result = await collectAgentRunExecutionEvidencePages(request, 'camp-1', [
    { id: 'run-1', executionEvidenceCount: 3 }
  ])

  assert.equal(result.coverage.state, 'partial')
  assert.equal(result.coverage.reason.code, 'tool_evidence.sequence_gap')
  assert.equal(result.declaredTotal, null)
})

test('Tool ledger groups idempotent replay without inventing a duplicate effect', () => {
  const snapshot = toolSnapshot()
  const result = deriveToolEvidence(snapshot, { campTurnId: 'turn-1' }, {
    coverage: { state: 'complete', reason: null },
    declaredTotal: snapshot.executionEvidence.length
  })

  assert.equal(result.status, 'partial')
  assert.deepEqual(result.summary.observed, {
    logicalToolCalls: 4,
    succeeded: 3,
    failed: 1,
    denied: 0,
    retries: 0,
    idempotentReplays: 1,
    provenDuplicateEffects: 0
  })
  assert.equal(result.summary.authoritativeTotals.logicalToolCalls, null)

  const memberCall = result.ledger.find((record) => record.canonicalTool === 'team.call_member')
  assert.equal(memberCall.authorityClass, 'core')
  assert.equal(memberCall.lifecycle.state, 'succeeded')
  assert.equal(memberCall.authorization.decision, 'allowed')
  assert.equal(memberCall.retryRelation.kind, 'idempotent_replay_observed')
  assert.equal(memberCall.retryRelation.observationCount, 1)
  assert.equal(memberCall.receiptId, 'receipt-1')
  assert.equal(memberCall.sideEffectIdentity, 'receipt-1')
  assert.equal(memberCall.duplicateEffect, 'not_proven')

  const testCommand = result.ledger.find((record) => record.operationClass === 'test')
  assert.equal(testCommand.authorityClass, 'runtime')
  assert.equal(testCommand.nativeTool, 'commandExecution')
  assert.equal(testCommand.lifecycle.state, 'succeeded')
  assert.equal(testCommand.timing.latencyMilliseconds, null)

  const encoded = JSON.stringify(result)
  assert.equal(encoded.includes('pnpm test -- --runInBand'), false)
  assert.equal(encoded.includes('/private/workspace'), false)
  assert.equal(encoded.includes('provider-secret'), false)
})

test('Tool evidence remains unavailable when the authoritative run boundary is absent', () => {
  assert.deepEqual(deriveToolEvidence(null, null, null), {
    status: 'unavailable',
    coverage: {
      state: 'unavailable',
      reason: { code: 'tool_evidence.authoritative_snapshot_unavailable' }
    },
    ledger: [],
    summary: {
      observed: null,
      authoritativeTotals: null,
      latencyCoverage: {
        state: 'unavailable',
        reason: { code: 'tool_evidence.authoritative_snapshot_unavailable' }
      },
      mutationVerification: 'indeterminate',
      directToolFailureCausality: 'indeterminate'
    }
  })
})

test('current Camp send keeps only digest-bound bounded operation projection', () => {
  const validProjection = operationProjection()
  const snapshot = {
    agentRuns: [{ id: 'run-1', campTurnId: 'turn-1', executionEvidenceCount: 2 }],
    executionEvidence: [
      runtimeAction('send-valid', 1, {
        toolCallId: 'sha256:send-call',
        status: 'completed',
        kind: 'mcp_tool_call',
        sourceAuthority: 'core',
        canonicalTool: 'camp.message.send',
        authorizationDecision: 'allowed',
        rawInputDigest: 'sha256:input-send',
        rawOutputDigest: 'sha256:output-send',
        idempotentReplay: false,
        receiptId: 'receipt-send',
        operationProjection: validProjection
      }),
      runtimeAction('send-tampered', 2, {
        toolCallId: 'sha256:tampered-call',
        status: 'completed',
        kind: 'mcp_tool_call',
        sourceAuthority: 'core',
        canonicalTool: 'camp.message.send',
        authorizationDecision: 'allowed',
        rawInputDigest: 'sha256:different-input',
        rawOutputDigest: 'sha256:output-send',
        idempotentReplay: false,
        receiptId: 'receipt-tampered',
        operationProjection: validProjection
      })
    ]
  }
  const result = deriveToolEvidence(snapshot, { campTurnId: 'turn-1' }, {
    coverage: { state: 'complete', reason: null },
    declaredTotal: 2
  })
  const valid = result.ledger.find((record) => record.receiptId === 'receipt-send')
  const tampered = result.ledger.find((record) => record.receiptId === 'receipt-tampered')
  assert.deepEqual(valid.operationProjection, validProjection)
  assert.equal(valid.sideEffectIdentity, 'receipt-send')
  assert.equal(valid.mutationIntent, 'yes')
  assert.equal(tampered.operationProjection, null)
  assert.equal(JSON.stringify(result).includes('private A2A body'), false)
})

test('Core Built-in coverage is complete only with a durable pre-effect start fence', () => {
  const terminalProjection = operationProjection()
  const startProjection = startedOperationProjection(terminalProjection)
  const base = {
    toolCallId: 'sha256:fenced-call',
    kind: 'builtin_tool_invocation',
    sourceAuthority: 'core',
    canonicalTool: 'camp.message.send',
    authorizationDecision: 'allowed',
    rawInputDigest: 'sha256:input-send',
    idempotentReplay: false,
    receiptId: null
  }
  const snapshot = {
    agentRuns: [{ id: 'run-1', campTurnId: 'turn-1', executionEvidenceCount: 2 }],
    executionEvidence: [
      runtimeAction('send-started', 1, {
        ...base,
        status: 'started',
        rawOutputDigest: null,
        operationProjection: startProjection
      }),
      runtimeAction('send-completed', 2, {
        ...base,
        status: 'completed',
        rawOutputDigest: 'sha256:output-send',
        receiptId: 'receipt-send',
        operationProjection: terminalProjection
      })
    ]
  }
  const complete = deriveToolEvidence(snapshot, { campTurnId: 'turn-1' }, {
    coverage: { state: 'complete', reason: null },
    declaredTotal: 2
  })
  assert.deepEqual(complete.sourceBoundary.coreBuiltinInvocationCoverage, {
    state: 'complete', reason: null
  })
  assert.equal(complete.ledger[0].coreInvocationStartObserved, true)
  assert.deepEqual(complete.ledger[0].operationProjection, terminalProjection)

  const terminalOnly = deriveToolEvidence({
    ...snapshot,
    executionEvidence: [snapshot.executionEvidence[1]]
  }, { campTurnId: 'turn-1' }, {
    coverage: { state: 'complete', reason: null },
    declaredTotal: 1
  })
  assert.equal(terminalOnly.sourceBoundary.coreBuiltinInvocationCoverage.state, 'partial')
  assert.equal(
    terminalOnly.sourceBoundary.coreBuiltinInvocationCoverage.reason.code,
    'tool_evidence.core_builtin_start_fence_unattested'
  )
})

function toolSnapshot() {
  return {
    agentRuns: [
      { id: 'run-1', campTurnId: 'turn-1', executionEvidenceCount: 8 }
    ],
    executionEvidence: [
      nonToolActivity('user-message', 1, 'userMessage'),
      nonToolActivity('agent-message', 2, 'agentMessage'),
      runtimeAction('core-original', 3, {
        toolCallId: 'sha256:call-1',
        status: 'completed',
        kind: 'mcp_tool_call',
        title: 'team.call_member',
        sourceAuthority: 'core',
        canonicalTool: 'team.call_member',
        authorizationDecision: 'allowed',
        rawInputDigest: 'sha256:input-1',
        rawOutputDigest: 'sha256:output-1',
        errorCode: null,
        idempotentReplay: false,
        receiptId: 'receipt-1'
      }),
      runtimeAction('core-replay', 4, {
        toolCallId: 'sha256:call-1',
        status: 'completed',
        kind: 'mcp_tool_call',
        title: 'team.call_member',
        sourceAuthority: 'core',
        canonicalTool: 'team.call_member',
        authorizationDecision: 'allowed',
        rawInputDigest: 'sha256:input-1',
        rawOutputDigest: 'sha256:output-1',
        errorCode: null,
        idempotentReplay: true,
        receiptId: 'receipt-1'
      }),
      activity('command-started', 5, 'activity.started', 'started', {
        id: 'command-1',
        type: 'commandExecution',
        status: 'inProgress',
        command: 'pnpm test -- --runInBand',
        cwd: '/private/workspace'
      }),
      activity('command-completed', 6, 'activity.completed', 'completed', {
        id: 'command-1',
        type: 'commandExecution',
        status: 'completed',
        command: 'pnpm test -- --runInBand',
        cwd: '/private/workspace',
        durationMs: 1200,
        exitCode: 0,
        aggregatedOutput: 'provider-secret'
      }),
      activity('file-completed', 7, 'activity.completed', 'completed', {
        id: 'file-1',
        type: 'fileChange',
        status: 'completed',
        changes: [{ path: '/private/workspace/src/app.ts' }]
      }),
      runtimeAction('runtime-failed', 8, {
        toolCallId: 'runtime-tool-1',
        status: 'failed',
        kind: 'mcp_tool_call',
        title: 'Provider-specific action',
        output: 'provider-secret'
      })
    ]
  }
}

function operationProjection() {
  const projection = {
    schemaVersion: 1,
    operation: 'camp.message.send',
    canonicalInput: {
      recipientAgentIds: ['agent_2'],
      contentDigest: 'sha256:body',
      contentCharCount: 16,
      contentSecretDetected: false
    },
    canonicalResult: {
      messageId: 'message-1',
      deliveryIds: ['delivery-1'],
      effectiveRecipients: ['agent_2']
    },
    digestBinding: {
      input: { evidenceField: 'rawInputDigest', digest: 'sha256:input-send' },
      result: { evidenceField: 'rawOutputDigest', digest: 'sha256:output-send' }
    },
    inputDigest: 'sha256:input-send',
    resultDigest: 'sha256:output-send'
  }
  return { ...projection, projectionDigest: digestJson(projection) }
}

function startedOperationProjection(terminal) {
  const projection = {
    ...structuredClone(terminal),
    canonicalResult: null,
    digestBinding: { input: structuredClone(terminal.digestBinding.input), result: null },
    resultDigest: null
  }
  delete projection.projectionDigest
  return { ...projection, projectionDigest: digestJson(projection) }
}

function runtimeAction(id, sequence, payload) {
  return {
    id,
    agentRunId: 'run-1',
    executionEpoch: 1,
    sequence,
    eventType: 'runtime.action',
    kind: payload.status === 'started' ? 'tool_call' : 'tool_result',
    phase: payload.status === 'started'
      ? 'started'
      : payload.status === 'failed' ? 'failed' : 'completed',
    payload,
    isTruncated: false,
    occurredAt: `2026-08-03T00:00:0${sequence}Z`
  }
}

function activity(id, sequence, eventType, phase, item) {
  return {
    id,
    agentRunId: 'run-1',
    executionEpoch: 1,
    sequence,
    eventType,
    kind: item.type === 'commandExecution' ? 'command' : 'file_change',
    phase,
    payload: { item },
    isTruncated: false,
    occurredAt: `2026-08-03T00:00:0${sequence}Z`
  }
}

function nonToolActivity(id, sequence, itemType) {
  return {
    id,
    agentRunId: 'run-1',
    executionEpoch: 1,
    sequence,
    eventType: 'activity.completed',
    // Older Core versions classified unknown activity types as tool_call. The
    // Runner must still fail closed instead of turning messages into Tool calls.
    kind: 'tool_call',
    phase: 'completed',
    payload: { item: { id: `${id}-item`, type: itemType, text: 'private message' } },
    isTruncated: false,
    occurredAt: `2026-08-03T00:00:0${sequence}Z`
  }
}

function page(agentRunId, requestedAfterSequence, nextAfterSequence, throughSequence, hasMore, items) {
  return {
    schemaVersion: 1,
    agentRunId,
    requestedAfterSequence,
    nextAfterSequence,
    throughSequence,
    hasMore,
    evidence: items
  }
}

function evidence(id, agentRunId, sequence) {
  return {
    id,
    agentRunId,
    executionEpoch: 1,
    sequence,
    eventType: 'runtime.action',
    kind: 'tool_result',
    phase: 'completed',
    payload: {
      toolCallId: id,
      status: 'completed',
      kind: 'mcp_tool_call'
    },
    contentBlobId: null,
    contentByteCount: 2,
    isTruncated: false,
    occurredAt: '2026-08-03T00:00:00Z'
  }
}
