import assert from 'node:assert/strict'
import test from 'node:test'
import { digestJson } from '../qualification-common.mjs'
import {
  buildToolInteractionMeasurement,
  buildToolInteractionSourceArtifact,
  buildToolUseJudgePack,
  validateToolInteractionSourceArtifact,
  validateToolInteractionArtifacts
} from './index.mjs'

const PRODUCER_DIGEST = 'a'.repeat(64)

test('Camp History uses pre-registered opportunity denominator and deduplicates Core replay', () => {
  const measurement = buildToolInteractionMeasurement({
    caseId: 'case-camp',
    trialId: 'trial-camp',
    producerDigest: PRODUCER_DIGEST,
    measurementSpec: spec([{
      opportunityId: 'OP-CAMP-1',
      adapter: 'camp_history',
      mode: 'natural_use',
      allowedOperations: ['camp.search', 'camp.read'],
      oracle: {
        requiredOperations: ['camp.search', 'camp.read'],
        requiredMessageIds: ['message-relevant'],
        forbiddenMessageIds: ['message-distractor'],
        requireCompletePagination: true,
        canaries: ['WITHHELD_CAMP_ORACLE_CANARY']
      }
    }]),
    toolEvidence: completeEvidence([
      coreInteraction({
        toolCallId: 'tool-search-1',
        canonicalTool: 'camp.search',
        idempotencyIdentity: digestIdentity('1'),
        input: { query: 'handoff decision', queryCharCount: 16, queryTruncated: false, limit: 4 },
        result: {
          results: [{ campId: 'camp-1', messageId: 'message-relevant', sequence: 9 }],
          resultCount: 1,
          resultsTruncated: false,
          truncated: false,
          searchIncomplete: false
        },
        evidenceId: 'search-start'
      }),
      coreInteraction({
        toolCallId: 'tool-search-replay',
        canonicalTool: 'camp.search',
        idempotencyIdentity: digestIdentity('1'),
        idempotentReplay: true,
        input: { query: 'handoff decision', queryCharCount: 16, queryTruncated: false, limit: 4 },
        result: {
          results: [{ campId: 'camp-1', messageId: 'message-relevant', sequence: 9 }],
          resultCount: 1,
          resultsTruncated: false,
          truncated: false,
          searchIncomplete: false
        },
        evidenceId: 'search-replay'
      }),
      coreInteraction({
        toolCallId: 'tool-read-1',
        canonicalTool: 'camp.read',
        input: { campId: 'camp-1', mode: 'item', messageId: 'message-relevant' },
        result: {
          campId: 'camp-1',
          mode: 'item',
          items: [{ messageId: 'message-relevant', sequence: 9, bodyTruncated: false }],
          itemCount: 1,
          itemsTruncated: false,
          hasMore: false,
          nextCursor: null
        },
        evidenceId: 'read-complete'
      })
    ])
  })

  assert.equal(measurement.payload.denominator.basis, 'pre_registered_opportunities')
  assert.deepEqual(measurement.payload.denominator, {
    basis: 'pre_registered_opportunities',
    total: 1,
    pass: 1,
    fail: 0,
    indeterminate: 0
  })
  assert.equal(measurement.payload.interactions.length, 2)
  const search = measurement.payload.interactions.find((item) => item.canonicalTool === 'camp.search')
  assert.equal(search.replay.replayObservationCount, 1)
  assert.equal(search.replay.observationCount, 2)
  assert.equal(measurement.payload.opportunities[0].status, 'pass')
  assert.equal(JSON.stringify(measurement).includes('WITHHELD_CAMP_ORACLE_CANARY'), false)
  assert.equal(JSON.stringify(measurement).includes('message-distractor'), false)
  assert.equal('score' in measurement.payload, false)
})

test('Memory Retrieval deterministically rejects stale revision and cache state', () => {
  const measurement = buildToolInteractionMeasurement({
    caseId: 'case-memory',
    trialId: 'trial-memory',
    producerDigest: PRODUCER_DIGEST,
    measurementSpec: spec([{
      opportunityId: 'OP-MEMORY-1',
      adapter: 'memory_retrieval',
      mode: 'forced_use',
      allowedOperations: ['memory.read'],
      oracle: {
        expectedMemories: [{
          memoryId: 'memory-1',
          revisionId: 'revision-current',
          cacheState: 'current'
        }],
        staleRevisionIds: ['revision-stale']
      }
    }]),
    toolEvidence: completeEvidence([coreInteraction({
      toolCallId: 'tool-memory-read',
      canonicalTool: 'memory.read',
      input: { memoryIds: ['memory-1'] },
      result: {
        memories: [{
          memoryId: 'memory-1',
          revisionId: 'revision-stale',
          cacheState: 'revision_changed',
          kind: 'instruction'
        }],
        memoryCount: 1,
        memoriesTruncated: false
      },
      evidenceId: 'memory-read'
    })])
  })

  const opportunity = measurement.payload.opportunities[0]
  assert.equal(opportunity.status, 'fail')
  assert.equal(opportunity.deterministicAssessment.oracleMatch.status, 'fail')
  assert.ok(opportunity.deterministicAssessment.oracleMatch.reasonCodes.includes(
    'stale_memory_state_observed'
  ))
  assert.equal(opportunity.deterministicAssessment.oracleMatch.facts.observedRequiredFactCount, 0)
})

test('v2 adapters measure history.search, memory.view and Task lifecycle without rewarding call volume', () => {
  const measurement = buildToolInteractionMeasurement({
    caseId: 'case-v2-adapters',
    trialId: 'trial-v2-adapters',
    producerDigest: PRODUCER_DIGEST,
    measurementSpec: spec([
      {
        opportunityId: 'OP-HISTORY',
        adapter: 'camp_history',
        mode: 'natural_use',
        allowedOperations: ['history.search'],
        oracle: {
          requiredOperations: ['history.search'],
          requiredMessageIds: ['message-history']
        }
      },
      {
        opportunityId: 'OP-MEMORY-VIEW',
        adapter: 'memory_retrieval',
        mode: 'forced_use',
        allowedOperations: ['memory.view'],
        oracle: {
          requiredOperations: ['memory.view'],
          expectedMemories: [{
            memoryId: 'memory-v3',
            revisionId: 'revision-v3',
            cacheState: 'current'
          }]
        }
      },
      {
        opportunityId: 'OP-TASK',
        adapter: 'task_coordination',
        mode: 'forced_use',
        allowedOperations: ['team.create_task', 'team.update_task'],
        oracle: {
          requiredOperations: ['team.create_task', 'team.update_task'],
          requiredTaskIds: ['task-1'],
          requiredStatuses: ['completed'],
          requiredAssigneeAgentIds: ['agent-reviewer'],
          requiredVersions: [1, 2],
          requireEffectBinding: true,
          requireMutationReceipt: true
        }
      }
    ]),
    toolEvidence: completeEvidence([
      coreInteraction({
        schemaVersion: 2,
        toolCallId: 'history-search-1',
        canonicalTool: 'history.search',
        input: { query: 'prior decision', campIds: ['camp-older'], limit: 4 },
        result: {
          results: [{ messageId: 'message-history', sequence: 7 }],
          resultCount: 1,
          searchIncomplete: false
        },
        evidenceId: 'history-search-1'
      }),
      coreInteraction({
        schemaVersion: 2,
        toolCallId: 'memory-view-1',
        canonicalTool: 'memory.view',
        input: { scope: 'hearth' },
        result: {
          scope: 'hearth',
          complete: true,
          items: [{
            target: {
              memoryId: 'memory-v3',
              revisionId: 'revision-v3',
              scope: 'hearth'
            },
            kind: 'lesson',
            body: 'Use the sealed verifier before publishing.',
            retrievalKeys: ['sealed verifier'],
            agentCanRevise: true
          }],
          itemCount: 1,
          semanticBodiesTruncated: false
        },
        evidenceId: 'memory-view-1'
      }),
      coreInteraction({
        schemaVersion: 2,
        toolCallId: 'task-create-1',
        canonicalTool: 'team.create_task',
        input: {
          title: 'Review the verifier boundary',
          description: 'Check the sealed verifier and report evidence.',
          acceptanceCriteria: ['Cite the verifier receipt.'],
          assigneeAgentId: 'agent-reviewer'
        },
        result: { taskId: 'task-1', status: 'pending', assigneeAgentId: 'agent-reviewer', version: 1 },
        receiptId: 'receipt-task-create',
        evidenceId: 'task-create-1'
      }),
      coreInteraction({
        schemaVersion: 2,
        toolCallId: 'task-update-1',
        canonicalTool: 'team.update_task',
        input: {
          taskId: 'task-1',
          expectedVersion: 1,
          requestedStatus: 'completed',
          completionSummary: 'Verified the sealed boundary.'
        },
        result: { taskId: 'task-1', status: 'completed', assigneeAgentId: 'agent-reviewer', version: 2 },
        receiptId: 'receipt-task-update',
        evidenceId: 'task-update-1'
      })
    ]),
    effectEvidence: [
      {
        effectId: 'memory-view-content',
        kind: 'retrieved_content',
        content: 'Use the sealed verifier before publishing.',
        relatedToolCallIds: ['memory-view-1'],
        relatedResultIdentities: ['memory-v3', 'revision-v3'],
        evidenceReference: reference('memory-view-content')
      },
      {
        effectId: 'task-state-1',
        kind: 'task_state',
        content: '{"assigneeAgentId":"agent-reviewer","status":"completed","taskId":"task-1","version":2}',
        relatedResultIdentities: ['task-1'],
        evidenceReference: reference('task-state-1')
      }
    ]
  })

  assert.deepEqual(measurement.payload.denominator, {
    basis: 'pre_registered_opportunities',
    total: 3,
    pass: 3,
    fail: 0,
    indeterminate: 0
  })
  assert.equal(measurement.schemaVersion, '2.0.0')
  assert.equal(measurement.payload.interactions.length, 4)
  assert.equal(measurement.payload.opportunities.find((item) => item.adapter === 'task_coordination')
    .deterministicAssessment.effectBinding.status, 'pass')
  assert.equal(measurement.payload.opportunities.find((item) => item.adapter === 'task_coordination')
    .deterministicAssessment.oracleMatch.facts.observedRequiredVersionCount, 2)
})

test('Memory write effectiveness requires an exact authoritative readback when pre-registered', () => {
  const inputBody = 'Always compare the current revision before revising Memory.'
  const base = {
    caseId: 'case-memory-effective',
    trialId: 'trial-memory-effective',
    producerDigest: PRODUCER_DIGEST,
    measurementSpec: spec([{
      opportunityId: 'OP-MEMORY-EFFECTIVE',
      adapter: 'memory_mutation',
      mode: 'forced_use',
      allowedOperations: ['memory.write'],
      oracle: {
        requiredOperations: ['memory.write'],
        expectedMemoryId: 'memory-effective',
        expectedRevisionId: 'revision-effective',
        expectedAction: 'add',
        requireReceipt: true,
        requireEffectiveReadback: true
      }
    }]),
    toolEvidence: completeEvidence([coreInteraction({
      schemaVersion: 2,
      toolCallId: 'memory-write-effective',
      canonicalTool: 'memory.write',
      input: {
        action: 'add',
        scope: 'hearth',
        kind: 'lesson',
        body: inputBody,
        retrievalKeys: ['memory revision']
      },
      result: {
        outcome: 'applied',
        memoryId: 'memory-effective',
        revisionId: 'revision-effective'
      },
      receiptId: 'receipt-memory-effective',
      evidenceId: 'memory-write-effective'
    })])
  }
  const missing = buildToolInteractionMeasurement(base)
  assert.equal(missing.payload.opportunities[0].status, 'fail')
  assert.deepEqual(
    missing.payload.opportunities[0].deterministicAssessment.oracleMatch.reasonCodes,
    ['memory_effective_readback_missing']
  )

  const effective = buildToolInteractionMeasurement({
    ...base,
    effectEvidence: [{
      effectId: 'memory-effective-readback',
      kind: 'retrieved_content',
      content: inputBody,
      relatedResultIdentities: ['memory-effective', 'revision-effective'],
      evidenceReference: reference('memory-effective-readback')
    }]
  })
  assert.equal(effective.payload.opportunities[0].status, 'pass')
  assert.equal(
    effective.payload.opportunities[0].deterministicAssessment.oracleMatch.facts.matchingReadbackCount,
    1
  )
})

test('non-use control passes only with complete Core coverage; missing coverage is indeterminate', () => {
  const request = {
    caseId: 'case-non-use',
    trialId: 'trial-non-use',
    producerDigest: PRODUCER_DIGEST,
    measurementSpec: spec([{
      opportunityId: 'OP-NO-CAMP',
      adapter: 'camp_history',
      mode: 'non_use_control',
      oracle: {}
    }])
  }
  const complete = buildToolInteractionMeasurement({
    ...request,
    toolEvidence: completeEvidence([])
  })
  const partial = buildToolInteractionMeasurement({
    ...request,
    trialId: 'trial-non-use-partial',
    toolEvidence: {
      coverage: { state: 'partial', reason: { code: 'page_missing' } },
      interactions: []
    }
  })
  const runtimeOnly = buildToolInteractionMeasurement({
    ...request,
    trialId: 'trial-non-use-runtime-only',
    toolEvidence: completeEvidence([{
      ...coreInteraction({
        toolCallId: 'runtime-only',
        canonicalTool: 'camp.read',
        input: { mode: 'item', messageId: 'message-1' },
        result: { items: [{ messageId: 'message-1' }] },
        evidenceId: 'runtime-only'
      }),
      sourceAuthority: 'runtime'
    }])
  })

  assert.equal(complete.payload.opportunities[0].status, 'pass')
  assert.equal(partial.payload.opportunities[0].status, 'indeterminate')
  assert.equal(runtimeOnly.payload.opportunities[0].status, 'indeterminate')
  assert.equal(runtimeOnly.payload.sourceCoverage.reason.code, 'runtime_only_tool_observation_present')
})

test('current camp.message.send binds accepted Core result to Message effect and never uses legacy identity', () => {
  const interaction = coreInteraction({
    toolCallId: 'tool-send-1',
    canonicalTool: 'camp.message.send',
    receiptId: 'receipt-send-1',
    input: {
      recipientAgentIds: ['agent-reviewer'],
      recipientAgentIdsCount: 1,
      mentionsCurrentUser: false,
      taskId: 'task-1',
      contentCharCount: 24,
      contentDigest: digestIdentity('b'),
      contentSecretDetected: false
    },
    result: {
      status: 'accepted',
      messageId: 'message-send-1',
      campTurnId: 'turn-send-1',
      effectiveRecipients: ['agent-reviewer'],
      deliveryIds: ['delivery-send-1'],
      allocatedAgentRunResponsibilities: 1
    },
    evidenceId: 'send-action'
  })
  const measurement = buildToolInteractionMeasurement({
    caseId: 'case-send',
    trialId: 'trial-send',
    producerDigest: PRODUCER_DIGEST,
    measurementSpec: spec([{
      opportunityId: 'OP-SEND-1',
      adapter: 'camp_message_send',
      mode: 'natural_use',
      oracle: {
        requiredRecipientAgentIds: ['agent-reviewer'],
        requiredTaskIds: ['task-1'],
        forbiddenTaskIds: ['task-unrelated'],
        requireEffectBinding: true,
        requireReceipt: true
      }
    }]),
    toolEvidence: completeEvidence([interaction]),
    effectEvidence: [{
      effectId: 'message-effect-1',
      kind: 'message',
      content: 'Bounded public delegation content.',
      relatedResultIdentities: ['message-send-1'],
      evidenceReference: reference('core.message-content:message-send-1')
    }]
  })

  assert.equal(measurement.payload.opportunities[0].status, 'pass')
  assert.equal(
    measurement.payload.opportunities[0].deterministicAssessment.oracleMatch.facts
      .observedRequiredTaskCount,
    1
  )
  assert.equal(
    measurement.payload.opportunities[0].deterministicAssessment.effectBinding.status,
    'pass'
  )
  assert.equal(measurement.payload.opportunities[0].effectBindings[0].relation, 'core_result_identity')
  assert.equal(measurement.payload.interactions[0].canonicalTool, 'camp.message.send')
  assert.equal(JSON.stringify(measurement).includes('team.call_member'), false)

  const pack = buildToolUseJudgePack({
    measurement,
    disclosedTask: {
      title: 'Review a risky state transition',
      requirements: ['Deliver the verified implementation.']
    },
    producerDigest: PRODUCER_DIGEST
  })
  assert.ok(pack.payload.modelInput.opportunities[0].checklistCoverage.every((item) => (
    item.coverage.state === 'not_applicable'
  )))
})

test('Memory mutation validates receipt, action, and fresh revision identity without a semantic score', () => {
  const interaction = coreInteraction({
    toolCallId: 'tool-memory-write',
    canonicalTool: 'memory.write',
    receiptId: 'receipt-memory-write',
    input: {
      action: 'create',
      scope: 'hearth',
      kind: 'agreement',
      body: 'Use optimistic concurrency for durable updates.',
      retrievalKeys: ['optimistic concurrency', 'durable update']
    },
    result: {
      memoryId: 'memory-1',
      revisionId: 'revision-1',
      version: 1
    },
    evidenceId: 'memory-write'
  })
  const measurement = buildToolInteractionMeasurement({
    caseId: 'case-memory-write',
    trialId: 'trial-memory-write',
    producerDigest: PRODUCER_DIGEST,
    measurementSpec: spec([{
      opportunityId: 'OP-MEMORY-WRITE',
      adapter: 'memory_mutation',
      mode: 'natural_use',
      allowedOperations: ['memory.write'],
      oracle: {
        expectedMemoryId: 'memory-1',
        expectedRevisionId: 'revision-1',
        expectedAction: 'create',
        requireReceipt: true
      }
    }]),
    toolEvidence: completeEvidence([interaction])
  })
  assert.equal(measurement.payload.opportunities[0].status, 'pass')
  assert.equal(
    measurement.payload.opportunities[0].deterministicAssessment.oracleMatch.facts.receiptCount,
    1
  )
  assert.equal(JSON.stringify(measurement).includes('aggregateScore'), false)
})

test('A2A fanout is one deterministic interaction with exact recipient-set evidence, not a quality bonus', () => {
  const interaction = coreInteraction({
    toolCallId: 'tool-send-fanout',
    canonicalTool: 'camp.message.send',
    receiptId: 'receipt-send-fanout',
    input: {
      recipientAgentIds: ['agent-reviewer', 'agent-tester'],
      recipientAgentIdsCount: 2,
      contentDigest: digestIdentity('8')
    },
    result: {
      status: 'accepted',
      messageId: 'message-fanout',
      effectiveRecipients: ['agent-reviewer', 'agent-tester'],
      deliveryIds: ['delivery-reviewer', 'delivery-tester'],
      allocatedAgentRunResponsibilities: 2
    },
    evidenceId: 'send-fanout'
  })
  const measurement = buildToolInteractionMeasurement({
    caseId: 'case-send-fanout',
    trialId: 'trial-send-fanout',
    producerDigest: PRODUCER_DIGEST,
    measurementSpec: spec([{
      opportunityId: 'OP-SEND-FANOUT',
      adapter: 'camp_message_send',
      mode: 'natural_use',
      oracle: {
        requiredRecipientAgentIds: ['agent-reviewer', 'agent-tester'],
        requireEffectBinding: true,
        requireReceipt: true
      }
    }]),
    toolEvidence: completeEvidence([interaction]),
    effectEvidence: [{
      effectId: 'message-fanout-effect',
      kind: 'message',
      content: 'Review and test the same bounded change.',
      relatedResultIdentities: ['message-fanout'],
      evidenceReference: reference('message-fanout')
    }]
  })
  assert.equal(measurement.payload.interactions.length, 1)
  assert.equal(measurement.payload.denominator.total, 1)
  assert.equal(measurement.payload.opportunities[0].status, 'pass')
  assert.equal(
    measurement.payload.opportunities[0].deterministicAssessment.oracleMatch.facts.observedRequiredRecipientCount,
    2
  )
})

test('Judge Pack is oracle- and treatment-blind, exposes only local Evidence IDs and exact checklist', () => {
  const measurement = campMeasurement({ oracleCanary: 'HIDDEN_ORACLE_NEVER_VISIBLE' })
  const pack = buildToolUseJudgePack({
    measurement,
    disclosedTask: {
      title: 'Use prior context when necessary',
      requirements: ['Find the prior decision and apply it to the delivery.']
    },
    treatmentCanaries: ['TEAM_ARM_CANARY'],
    producerDigest: PRODUCER_DIGEST
  })

  assert.deepEqual(pack.payload.modelInput.checklist, [
    'SER.tool_use.selection_necessity',
    'SER.tool_use.input_strategy',
    'SER.tool_use.result_interpretation',
    'SER.tool_use.downstream_use',
    'SER.memory.retention_quality'
  ])
  const encodedModelInput = JSON.stringify(pack.payload.modelInput)
  assert.equal(encodedModelInput.includes('forced_use'), false)
  assert.equal(encodedModelInput.includes('natural_use'), false)
  assert.equal(encodedModelInput.includes('oracle'), false)
  assert.equal(encodedModelInput.includes('HIDDEN_ORACLE_NEVER_VISIBLE'), false)
  assert.equal(encodedModelInput.includes('artifact-core'), false)
  assert.match(encodedModelInput, /EV-0001/)
  assert.equal(pack.payload.evidenceMap[0].evidenceReference.artifactId, 'artifact-core')
  assert.equal('score' in pack.payload, false)
  assert.equal('aggregateScore' in pack.payload, false)
  assert.equal(validateToolInteractionArtifacts({ measurement, judgePack: pack }), true)

  assert.throws(() => buildToolUseJudgePack({
    measurement,
    disclosedTask: {
      title: 'TEAM_ARM_CANARY',
      requirements: ['This treatment marker must fail closed.']
    },
    treatmentCanaries: ['TEAM_ARM_CANARY'],
    producerDigest: PRODUCER_DIGEST
  }), /canary contamination/)
})

test('withheld oracle canary leakage, open Evidence Reference and score keys fail closed', () => {
  assert.throws(() => buildToolInteractionMeasurement({
    caseId: 'case-leak',
    trialId: 'trial-leak',
    producerDigest: PRODUCER_DIGEST,
    measurementSpec: spec([{
      opportunityId: 'OP-LEAK',
      adapter: 'camp_history',
      mode: 'natural_use',
      oracle: { canaries: ['ORACLE_LEAK_CANARY'] }
    }]),
    toolEvidence: completeEvidence([coreInteraction({
      toolCallId: 'tool-leak',
      canonicalTool: 'camp.search',
      input: { query: 'safe query' },
      result: { results: [] },
      evidenceId: 'tool-leak'
    })]),
    effectEvidence: [{
      effectId: 'effect-leak',
      kind: 'final_response',
      content: 'The model saw ORACLE_LEAK_CANARY.',
      relatedToolCallIds: ['tool-leak'],
      evidenceReference: reference('final-response')
    }]
  }), /canary contamination/)

  assert.throws(() => buildToolInteractionMeasurement({
    caseId: 'case-open-ref',
    trialId: 'trial-open-ref',
    producerDigest: PRODUCER_DIGEST,
    measurementSpec: spec([{
      opportunityId: 'OP-OPEN-REF',
      adapter: 'camp_history',
      mode: 'forced_use',
      oracle: {}
    }]),
    toolEvidence: completeEvidence([coreInteraction({
      toolCallId: 'tool-open-ref',
      canonicalTool: 'camp.search',
      input: { query: 'decision' },
      result: { results: [] },
      evidenceId: 'tool-open-ref',
      evidenceReference: {
        artifactId: 'artifact-core',
        evidenceId: 'tool-open-ref',
        privatePayload: 'must-not-be-accepted'
      }
    })])
  }), /keys are not closed/)

  const measurement = campMeasurement({ oracleCanary: 'SAFE_HIDDEN_CANARY' })
  const pack = buildToolUseJudgePack({
    measurement,
    disclosedTask: { title: 'Task', requirements: ['Use context.'] },
    producerDigest: PRODUCER_DIGEST
  })
  const tampered = structuredClone(pack)
  tampered.payload.modelInput.score = 100
  tampered.payload.modelInputDigest = `sha256:${digestJson(tampered.payload.modelInput)}`
  tampered.payloadDigest = `sha256:${digestJson(tampered.payload)}`
  tampered.artifactId = `tool-use-judge-pack:${tampered.payloadDigest.slice(7, 39)}`
  tampered.sourceBoundaries[0].digest = `sha256:${digestJson({
    binding: tampered.binding,
    sourceId: tampered.sourceBoundaries[0].sourceId,
    payload: tampered.payload
  })}`
  assert.throws(() => validateToolInteractionArtifacts({ measurement, judgePack: tampered }), /forbidden key/)
})

test('Core operation projection digest and raw digest binding are verified before admission', () => {
  const digestTampered = coreInteraction({
    toolCallId: 'tool-digest-tampered',
    canonicalTool: 'camp.search',
    input: { query: 'original query' },
    result: { results: [] },
    evidenceId: 'digest-tampered'
  })
  digestTampered.operationProjection.canonicalInput.query = 'changed after Core projection'

  const bindingTampered = coreInteraction({
    toolCallId: 'tool-binding-tampered',
    canonicalTool: 'camp.search',
    input: { query: 'query' },
    result: { results: [] },
    evidenceId: 'binding-tampered'
  })
  bindingTampered.operationProjection.digestBinding.input.digest = digestIdentity('f')
  const projectionWithoutDigest = Object.fromEntries(Object.entries(
    bindingTampered.operationProjection
  ).filter(([key]) => key !== 'projectionDigest'))
  bindingTampered.operationProjection.projectionDigest = `sha256:${digestJson(projectionWithoutDigest)}`

  const projectionMissing = coreInteraction({
    toolCallId: 'tool-projection-missing',
    canonicalTool: 'camp.search',
    input: { query: 'query' },
    result: { results: [] },
    evidenceId: 'projection-missing'
  })
  delete projectionMissing.operationProjection

  for (const [trialId, interaction] of [
    ['trial-projection-digest', digestTampered],
    ['trial-digest-binding', bindingTampered],
    ['trial-projection-missing', projectionMissing]
  ]) {
    const measurement = buildToolInteractionMeasurement({
      caseId: 'case-core-projection-integrity',
      trialId,
      producerDigest: PRODUCER_DIGEST,
      measurementSpec: spec([{
        opportunityId: 'OP-PROJECTION-INTEGRITY',
        adapter: 'camp_history',
        mode: 'forced_use',
        oracle: {}
      }]),
      toolEvidence: completeEvidence([interaction])
    })
    assert.equal(measurement.payload.interactions.length, 0)
    assert.equal(measurement.payload.sourceCoverage.state, 'partial')
    assert.equal(
      measurement.payload.sourceCoverage.reason.code,
      'core_tool_identity_or_projection_invalid'
    )
    assert.equal(measurement.payload.opportunities[0].status, 'indeterminate')
  }
})

test('Judge Pack replay recomputes model projection and Evidence Index content closure', () => {
  const measurement = campMeasurement({ oracleCanary: 'REPLAY_HIDDEN_CANARY' })
  const pack = buildToolUseJudgePack({
    measurement,
    disclosedTask: { title: 'Task', requirements: ['Use the prior decision.'] },
    producerDigest: PRODUCER_DIGEST
  })
  const finalBinding = measurement.payload.opportunities[0].effectBindings.find((binding) => (
    binding.kind === 'final_response'
  ))
  const evidenceIndex = {
    artifactId: 'artifact-core',
    payload: {
      records: [{
        evidenceId: 'tool-pack',
        safeForJudge: true,
        contentDigest: digestIdentity('e')
      }, {
        evidenceId: 'final-pack',
        safeForJudge: true,
        contentDigest: finalBinding.contentDigest
      }]
    }
  }
  assert.equal(validateToolInteractionArtifacts({ measurement, judgePack: pack, evidenceIndex }), true)

  const tampered = structuredClone(pack)
  tampered.payload.modelInput.opportunities[0].interactions[0]
    .operationProjection.input.messageId = 'invented-message'
  tampered.payload.modelInputDigest = `sha256:${digestJson(tampered.payload.modelInput)}`
  tampered.payloadDigest = `sha256:${digestJson(tampered.payload)}`
  tampered.artifactId = `tool-use-judge-pack:${tampered.payloadDigest.slice(7, 39)}`
  tampered.sourceBoundaries[0].digest = `sha256:${digestJson({
    binding: tampered.binding,
    sourceId: tampered.sourceBoundaries[0].sourceId,
    payload: tampered.payload
  })}`
  assert.throws(() => validateToolInteractionArtifacts({
    measurement,
    judgePack: tampered,
    evidenceIndex
  }), /deterministic Measurement projection/)

  const unsafeIndex = structuredClone(evidenceIndex)
  unsafeIndex.payload.records[1].safeForJudge = false
  assert.throws(() => validateToolInteractionArtifacts({
    measurement,
    judgePack: pack,
    evidenceIndex: unsafeIndex
  }), /not Judge-safe/)
})

test('private replay source reproduces deterministic oracle assessment without entering Judge Pack', () => {
  const measurementSpec = spec([{
    opportunityId: 'OP-SOURCE',
    adapter: 'camp_history',
    mode: 'forced_use',
    oracle: { requiredMessageIds: ['message-source'], canaries: ['PRIVATE_SOURCE_CANARY'] }
  }])
  const toolEvidence = completeEvidence([coreInteraction({
    toolCallId: 'tool-source',
    canonicalTool: 'camp.read',
    input: { mode: 'item', messageId: 'message-source' },
    result: { items: [{ messageId: 'message-source' }], itemCount: 1 },
    evidenceId: 'tool-source'
  })])
  const measurement = buildToolInteractionMeasurement({
    caseId: 'case-source',
    trialId: 'trial-source',
    measurementSpec,
    toolEvidence,
    producerDigest: PRODUCER_DIGEST
  })
  const source = buildToolInteractionSourceArtifact({
    measurement,
    measurementSpec,
    toolEvidence,
    preparedFixtureArtifact: {
      schemaId: 'rovai.qualification.prepared-tool-fixture-manifest',
      schemaVersion: '2.0.0',
      payloadDigest: digestIdentity('9'),
      locator: 'prepared/fixture.json'
    },
    producerDigest: PRODUCER_DIGEST
  })
  assert.equal(validateToolInteractionSourceArtifact(source, measurement), source)
  assert.equal(JSON.stringify(source).includes('PRIVATE_SOURCE_CANARY'), true)
  const pack = buildToolUseJudgePack({
    measurement,
    disclosedTask: { title: 'Task', requirements: ['Use context.'] },
    producerDigest: PRODUCER_DIGEST
  })
  assert.equal(JSON.stringify(pack).includes('PRIVATE_SOURCE_CANARY'), false)

  const tampered = structuredClone(source)
  tampered.payload.measurementSpec.opportunities[0].oracle.requiredMessageIds = ['other-message']
  tampered.payloadDigest = `sha256:${digestJson(tampered.payload)}`
  tampered.artifactId = `tool-interaction-source:${tampered.payloadDigest.slice(7, 39)}`
  assert.throws(() => validateToolInteractionSourceArtifact(tampered, measurement), /does not replay/)
})

function campMeasurement({ oracleCanary }) {
  return buildToolInteractionMeasurement({
    caseId: 'case-pack',
    trialId: 'trial-pack',
    producerDigest: PRODUCER_DIGEST,
    measurementSpec: spec([{
      opportunityId: 'OP-PACK',
      adapter: 'camp_history',
      mode: 'natural_use',
      oracle: {
        requiredMessageIds: ['message-pack'],
        canaries: [oracleCanary]
      }
    }]),
    toolEvidence: completeEvidence([coreInteraction({
      toolCallId: 'tool-pack',
      canonicalTool: 'camp.read',
      input: { mode: 'item', messageId: 'message-pack' },
      result: {
        items: [{ messageId: 'message-pack', bodyTruncated: false }],
        itemCount: 1,
        itemsTruncated: false,
        hasMore: false
      },
      evidenceId: 'tool-pack'
    })]),
    effectEvidence: [{
      effectId: 'final-pack',
      kind: 'final_response',
      content: 'Applied the retrieved decision to the implementation.',
      relatedToolCallIds: ['tool-pack'],
      evidenceReference: reference('final-pack')
    }]
  })
}

function spec(opportunities) {
  return {
    specificationId: 'tool-measurement-test-spec',
    runtimeCompatibility: {
      builtinToolCatalogDigest: digestIdentity('e'),
      builtinToolContractVersion: 1,
      builtinToolIpcProtocolVersion: 1,
      operationProjectionSchemaVersion: 2
    },
    opportunities
  }
}

function completeEvidence(interactions) {
  return { coverage: { state: 'complete', reason: null }, interactions }
}

function coreInteraction({
  schemaVersion = 1,
  toolCallId,
  canonicalTool,
  input,
  result,
  evidenceId,
  evidenceReference = null,
  idempotencyIdentity = null,
  idempotentReplay = false,
  receiptId = null
}) {
  const inputDigest = digestIdentity('c')
  const resultDigest = digestIdentity('d')
  const operationProjectionWithoutDigest = {
    schemaVersion,
    operation: canonicalTool,
    canonicalInput: input,
    canonicalResult: result,
    digestBinding: {
      input: { evidenceField: 'rawInputDigest', digest: inputDigest },
      result: { evidenceField: 'rawOutputDigest', digest: resultDigest }
    },
    inputDigest,
    resultDigest
  }
  return {
    sourceAuthority: 'core',
    toolCallId,
    canonicalTool,
    lifecycle: { state: 'succeeded' },
    authorization: { decision: 'allowed' },
    idempotencyIdentity,
    idempotentReplay,
    receiptId,
    operationProjection: {
      ...operationProjectionWithoutDigest,
      projectionDigest: `sha256:${digestJson(operationProjectionWithoutDigest)}`
    },
    evidenceReference: evidenceReference ?? reference(evidenceId)
  }
}

function reference(evidenceId) {
  return { artifactId: 'artifact-core', evidenceId }
}

function digestIdentity(character) {
  return `sha256:${character.repeat(64)}`
}
