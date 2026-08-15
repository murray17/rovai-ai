import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  admitToolMeasurementPack,
  assertToolMeasurementRuntimeCompatibility,
  materializeMeasurementSpecForBuilder,
  materializeToolMeasurementFixtures,
  verifyToolMeasurementPack
} from './qualification-tool-measurement-spec.mjs'

test('measurement pack seals opportunities, fixture and oracle and materializes fresh symbolic identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-tool-measurement-pack-'))
  try {
    const caseRecord = fakeCaseRecord()
    await writePack(root, caseRecord)
    const admission = await admitToolMeasurementPack(root, caseRecord)
    assert.equal(admission.opportunityCount, 4)
    assert.equal(JSON.stringify(admission).includes('remember the blue kite'), false)

    const pack = await verifyToolMeasurementPack(root, caseRecord)
    assert.equal(assertToolMeasurementRuntimeCompatibility(pack, {
      builtinToolCatalogDigest: 'e'.repeat(64),
      builtinToolContractVersion: 1,
      builtinToolIpcProtocolVersion: 1,
      builtinToolEvidenceProjectionVersion: 2
    }), true)
    assert.throws(() => assertToolMeasurementRuntimeCompatibility(pack, {
      builtinToolCatalogDigest: 'f'.repeat(64),
      builtinToolContractVersion: 1,
      builtinToolIpcProtocolVersion: 1,
      builtinToolEvidenceProjectionVersion: 2
    }), /incompatible/)
    let draftRevision = 0
    let nextMessage = 1
    let nextMemoryRevision = 1
    const calls = []
    const request = async (method, input) => {
      calls.push({ method, input })
      if (method === 'camp.composerDraft.get') return { revision: draftRevision }
      if (method === 'camp.composerDraft.save') return { revision: ++draftRevision }
      if (method === 'camp.messages.send') {
        return { status: 'applied', payload: { campMessageId: `message-${nextMessage++}` } }
      }
      if (method === 'memory.create') {
        return {
          status: 'applied',
          payload: { memoryId: 'memory-1', revisionId: `revision-${nextMemoryRevision++}` }
        }
      }
      if (method === 'memory.revise') {
        return { status: 'applied', payload: { revisionId: `revision-${nextMemoryRevision++}` } }
      }
      if (method === 'tasks.create') {
        return { status: 'applied', payload: { taskId: 'task-1', version: 1 } }
      }
      throw new Error(`unexpected method ${method}`)
    }
    const prepared = await materializeToolMeasurementFixtures({
      request,
      campId: 'camp-arm-team',
      pack,
      armId: 'arm-team-1',
      treatment: 'team'
    })
    assert.deepEqual(prepared.entities.map((item) => item.symbol), [
      'memory:preference',
      'message:distractor',
      'message:relevant',
      'task:review'
    ])
    assert.equal(calls.filter((call) => call.method === 'camp.messages.send').length, 2)
    assert.equal(calls.some((call) => call.method === 'camp.messages.send'
      && call.input.execution !== null), false)

    const builderSpec = materializeMeasurementSpecForBuilder(pack, prepared)
    assert.deepEqual(builderSpec.opportunities[0].oracle.requiredMessageIds, ['message-1'])
    assert.equal(builderSpec.opportunities[1].oracle.expectedMemories[0].memoryId, 'memory-1')
    assert.equal(builderSpec.opportunities[1].oracle.expectedMemories[0].revisionId, 'revision-2')
    assert.equal(builderSpec.opportunities[3].oracle.requiredTaskIds[0], 'task-1')
    assert.deepEqual(builderSpec.opportunities[3].oracle.requiredVersions, [1])
    assert.equal(JSON.stringify(builderSpec).includes('$symbol:'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('measurement pack verification fails closed after private fixture drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-tool-measurement-tamper-'))
  try {
    const caseRecord = fakeCaseRecord()
    await writePack(root, caseRecord)
    await admitToolMeasurementPack(root, caseRecord)
    const fixture = JSON.parse(await readFile(join(root, 'fixture.json'), 'utf8'))
    fixture.campMessages[0].body = 'changed after admission'
    await writeJson(join(root, 'fixture.json'), fixture)
    await assert.rejects(
      verifyToolMeasurementPack(root, caseRecord),
      /admission does not match/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('measurement pack rejects post-hoc opportunities and unknown fixture symbols', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-tool-measurement-invalid-'))
  try {
    const caseRecord = fakeCaseRecord()
    await writePack(root, caseRecord)
    const oracle = JSON.parse(await readFile(join(root, 'oracle.json'), 'utf8'))
    oracle.opportunities[0].oracle.requiredMessageIds = ['$symbol:message:missing#entityId']
    await writeJson(join(root, 'oracle.json'), oracle)
    await assert.rejects(
      admitToolMeasurementPack(root, caseRecord),
      /unknown fixture symbol/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function fakeCaseRecord() {
  return {
    seal: 'a'.repeat(64),
    contract: { manifest: { id: 'DC-901' } }
  }
}

async function writePack(root, caseRecord) {
  await mkdir(root, { recursive: true })
  await writeJson(join(root, 'measurement-spec.json'), {
    schemaId: 'rovai.qualification.tool-measurement-spec',
    schemaVersion: '2.0.0',
    specificationId: 'tool-spec:DC-901:1',
    case: { caseId: 'DC-901', caseSeal: `sha256:${caseRecord.seal}` },
    partition: 'holdout',
    projectionPolicyId: 'qualification-tool-measurement-v2',
    runtimeCompatibility: {
      builtinToolCatalogDigest: `sha256:${'e'.repeat(64)}`,
      builtinToolContractVersion: 1,
      builtinToolIpcProtocolVersion: 1,
      operationProjectionSchemaVersion: 2
    },
    fixtureFile: 'fixture.json',
    oracleFile: 'oracle.json',
    opportunities: [
      {
        opportunityId: 'OP-CAMP-1',
        adapter: 'camp_history',
        mode: 'natural_use',
        allowedOperations: ['camp.search', 'camp.read'],
        semanticItems: ['SER.tool_use.selection_necessity', 'SER.tool_use.downstream_use']
      },
      {
        opportunityId: 'OP-MEMORY-1',
        adapter: 'memory_retrieval',
        mode: 'natural_use',
        allowedOperations: ['memory.search', 'memory.read'],
        semanticItems: ['SER.tool_use.input_strategy', 'SER.tool_use.result_interpretation']
      },
      {
        opportunityId: 'OP-NO-CALL-1',
        adapter: 'memory_mutation',
        mode: 'non_use_control',
        allowedOperations: ['memory.write'],
        semanticItems: ['SER.memory.retention_quality']
      },
      {
        opportunityId: 'OP-TASK-1',
        adapter: 'task_coordination',
        mode: 'natural_use',
        allowedOperations: ['team.get_task', 'team.update_task'],
        semanticItems: ['SER.tool_use.input_strategy', 'SER.tool_use.result_interpretation']
      }
    ]
  })
  await writeJson(join(root, 'fixture.json'), {
    schemaVersion: 2,
    specificationId: 'tool-spec:DC-901:1',
    campMessages: [
      { symbol: 'message:relevant', body: 'The release phrase is blue kite.' },
      { symbol: 'message:distractor', body: 'A later unrelated status message.' }
    ],
    memories: [{
      symbol: 'memory:preference',
      scope: 'hearth',
      kind: 'preference',
      body: 'Prefer the blue kite release path.',
      retrievalKeys: ['release preference', 'blue kite'],
      companionAgentId: null,
      relationshipAgentIds: [],
      direction: null,
      directedActorAgentId: null,
      reviewAfter: null,
      revisions: [{
        body: 'Prefer the current blue kite release path.',
        retrievalKeys: ['current release preference', 'blue kite'],
        reviewAfter: null
      }]
    }],
    tasks: [{
      symbol: 'task:review',
      title: 'Review the qualification evidence',
      description: 'Verify the exact receipt and current revision.',
      acceptanceCriteria: ['Cite the receipt', 'Reject stale revisions'],
      assigneeAgentId: null
    }]
  })
  await writeJson(join(root, 'oracle.json'), {
    schemaVersion: 2,
    specificationId: 'tool-spec:DC-901:1',
    opportunities: [
      {
        opportunityId: 'OP-CAMP-1',
        oracle: {
          requiredOperations: ['camp.search', 'camp.read'],
          requiredMessageIds: ['$symbol:message:relevant#entityId'],
          forbiddenMessageIds: ['$symbol:message:distractor#entityId'],
          requireCompletePagination: true
        }
      },
      {
        opportunityId: 'OP-MEMORY-1',
        oracle: {
          requiredOperations: ['memory.search', 'memory.read'],
          expectedMemories: [{
            memoryId: '$symbol:memory:preference#entityId',
            revisionId: '$symbol:memory:preference#revisionId',
            cacheState: 'current'
          }],
          forbiddenMemoryIds: [],
          staleRevisionIds: []
        }
      },
      {
        opportunityId: 'OP-NO-CALL-1',
        oracle: {}
      },
      {
        opportunityId: 'OP-TASK-1',
        oracle: {
          requiredOperations: ['team.get_task', 'team.update_task'],
          requiredTaskIds: ['$symbol:task:review#entityId'],
          forbiddenTaskIds: [],
          requiredStatuses: ['completed'],
          requiredAssigneeAgentIds: [],
          requireEffectBinding: true,
          requireMutationReceipt: true,
          requiredVersions: ['$symbol:task:review#version']
        }
      }
    ]
  })
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}
