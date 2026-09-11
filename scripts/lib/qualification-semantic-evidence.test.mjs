import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { digestJson, sha256 } from './qualification-common.mjs'
import {
  SEMANTIC_JUDGE_CONTENT_ALLOWLIST,
  buildCollaborationMessageEvidence,
  buildSemanticJudgeUntrustedEvidence,
  retainCollaborationMessageEvidence
} from './qualification-semantic-evidence.mjs'

test('Semantic Judge content policy allows bounded semantic content and excludes private authority surfaces', () => {
  assert.equal(SEMANTIC_JUDGE_CONTENT_ALLOWLIST.participantMessages.enabled, true)
  assert.equal(SEMANTIC_JUDGE_CONTENT_ALLOWLIST.changedWorkspaceCode.enabled, true)
  assert.equal(SEMANTIC_JUDGE_CONTENT_ALLOWLIST.finalResponse.enabled, true)
  for (const excluded of [
    'testOutput',
    'workspaceComments',
    'contextManifest',
    'runtimePrivateLog',
    'rawToolPayload',
    'withheldVerifier',
    'referenceImplementation',
    'hiddenReasoning'
  ]) {
    assert.equal(SEMANTIC_JUDGE_CONTENT_ALLOWLIST[excluded].enabled, false)
  }
})

test('Collaboration message evidence projects only delivered Public A2A bodies with exact Evidence References', () => {
  const artifact = buildCollaborationMessageEvidence({
    trialId: 'trial-1',
    snapshot: {
      messages: [{
        id: 'message-1',
        authorId: 'agent-lead',
        sequence: 11,
        replyToCampMessageId: 'message-parent',
        createdAt: '2026-08-04T00:00:01.000Z',
        body: 'Review the transition and list concrete defects.'
      }, {
        id: 'unrelated-message',
        authorId: 'agent-lead',
        body: 'This unrelated camp message must not be projected.'
      }],
      messageDeliveries: []
    },
    dispatchBoundary: { campTurnId: 'turn-1' },
    collaborationEvidence: {
      sourceSurface: 'public_message_delivery_v1',
      a2a: [{
        callId: 'delivery-1',
        deliveryId: 'delivery-1',
        messageId: 'message-1',
        senderAgentId: 'agent-lead',
        recipientAgentId: 'agent-reviewer',
        taskId: 'task-review',
        contentDigest: sha256('Review the transition and list concrete defects.')
      }, {
        callId: 'delivery-2',
        deliveryId: 'delivery-2',
        messageId: 'message-1',
        senderAgentId: 'agent-lead',
        recipientAgentId: 'agent-tester',
        taskId: 'task-review',
        contentDigest: sha256('Review the transition and list concrete defects.')
      }],
      metrics: {
        acceptedMemberCalls: 2,
        coverage: 'complete_with_message_delivery_receipts'
      }
    },
    evidenceReferences: {
      messageContents: {
        'message-1': ref('core.message-content:message-1')
      }
    },
    producerDigest: 'a'.repeat(64)
  })

  assert.equal(artifact.payload.coverage.state, 'complete')
  assert.equal(artifact.payload.messages.length, 1)
  assert.deepEqual(artifact.payload.messages[0].deliveries.map((delivery) => (
    delivery.callId
  )), ['delivery-1', 'delivery-2'])
  assert.equal(artifact.payload.messages[0].visibility, 'public_to_camp')
  assert.equal(artifact.payload.messages[0].sequence, 11)
  assert.equal(artifact.payload.messages[0].replyToMessageId, 'message-parent')
  assert.deepEqual(artifact.payload.messages[0].taskIds, ['task-review'])
  assert.equal(JSON.stringify(artifact).includes('unrelated camp message'), false)

  const oversizedBody = 'x'.repeat(50_001)
  const oversized = buildCollaborationMessageEvidence({
    trialId: 'trial-oversized',
    snapshot: { messages: [{ id: 'message-large', authorId: 'agent-lead', body: oversizedBody }] },
    dispatchBoundary: { campTurnId: 'turn-1' },
    collaborationEvidence: {
      sourceSurface: 'public_message_delivery_v1',
      a2a: [{
        callId: 'delivery-large',
        deliveryId: 'delivery-large',
        messageId: 'message-large',
        senderAgentId: 'agent-lead',
        recipientAgentId: 'agent-reviewer',
        contentDigest: sha256(oversizedBody)
      }],
      metrics: {
        acceptedMemberCalls: 1,
        coverage: 'complete_with_message_delivery_receipts'
      }
    },
    evidenceReferences: {
      messageContents: {
        'message-large': ref('core.message-content:message-large')
      }
    },
    producerDigest: 'a'.repeat(64)
  })
  assert.equal(oversized.payload.coverage.state, 'partial')
  assert.equal(oversized.payload.messages.length, 0)
})

test('Semantic untrusted evidence includes participant messages and final response but never ContextManifest or private logs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rovai-semantic-evidence-'))
  try {
    await mkdir(join(directory, 'delivered', 'src'), { recursive: true })
    const finalBody = 'Implemented the fix and verified the public checks.'
    const participantBody = 'Please inspect the state transition and report defects.'
    await writeFile(join(directory, 'final-response-evidence.json'), JSON.stringify({
      messages: [{
        messageId: 'final-message',
        agentId: 'agent-lead',
        body: finalBody,
        bodyDigest: sha256(finalBody),
        isFinal: true
      }]
    }))
    // These files deliberately contain canaries that must never be discovered
    // by the allowlist projection.
    await writeFile(join(directory, 'runtime-private-log.ndjson'), 'PRIVATE_RUNTIME_CANARY\n')
    await writeFile(join(directory, 'context-manifest.json'), 'CONTEXT_MANIFEST_CANARY\n')
    const sourceMessage = {
      id: 'participant-message',
      authorId: 'agent-reviewer',
      createdAt: '2026-08-04T00:00:01.000Z',
      body: participantBody
    }
    const sourceDelivery = {
      id: 'delivery-1',
      messageId: 'participant-message',
      recipientAgentId: 'agent-lead'
    }
    const sourceMessageMetadata = {
      id: sourceMessage.id,
      authorId: sourceMessage.authorId,
      createdAt: sourceMessage.createdAt,
      bodyDigest: sha256(participantBody),
      bodyBytes: Buffer.byteLength(participantBody)
    }
    const evidenceIndex = {
      artifactId: 'evidence-index:index-1',
      payload: {
        records: [
          contentRecord('core.message-content:final-message', finalBody),
          contentRecord('core.message-content:participant-message', participantBody),
          digestRecord('core.message:participant-message', sourceMessageMetadata),
          digestRecord('core.message-delivery:delivery-1', sourceDelivery)
        ]
      }
    }
    const collaborationLedger = {
      binding: { trialId: 'trial-1' },
      payload: {
        calls: [{
          callId: 'delivery-1',
          senderMemberId: 'agent-reviewer',
          recipientMemberId: 'agent-lead',
          contentEvidenceReference: ref('core.message-content:participant-message')
        }]
      }
    }
    const collaborationArtifact = buildCollaborationMessageEvidence({
      trialId: 'trial-1',
      snapshot: {
        messages: [sourceMessage],
        messageDeliveries: [sourceDelivery]
      },
      dispatchBoundary: { campTurnId: 'turn-1' },
      collaborationEvidence: {
        sourceSurface: 'public_message_delivery_v1',
        a2a: [{
          callId: 'delivery-1',
          deliveryId: 'delivery-1',
          messageId: 'participant-message',
          senderAgentId: 'agent-reviewer',
          recipientAgentId: 'agent-lead',
          contentDigest: sha256(participantBody)
        }],
        metrics: {
          acceptedMemberCalls: 1,
          coverage: 'complete_with_message_delivery_receipts'
        }
      },
      evidenceReferences: {
        messages: { 'participant-message': ref('core.message:participant-message') },
        messageContents: {
          'participant-message': ref('core.message-content:participant-message')
        },
        messageDeliveries: {
          'delivery-1': ref('core.message-delivery:delivery-1')
        }
      },
      evidenceIndex,
      producerDigest: 'a'.repeat(64)
    })
    await retainCollaborationMessageEvidence(directory, collaborationArtifact)
    const result = {
      trialId: 'trial-1',
      deliveredWorkspaceSnapshot: { directory: 'delivered' },
      workspaceDiff: { changed: [] },
      deliveryLayer: {
        finalResponseEvidence: [{
          messageId: 'final-message',
          evidenceReference: ref('core.message-content:final-message')
        }]
      }
    }
    const segments = await buildSemanticJudgeUntrustedEvidence({
      evidenceDirectory: directory,
      result,
      evidenceIndex,
      workspaceMutationLedger: { payload: { records: [] } },
      collaborationLedger
    })

    assert.deepEqual(segments.map((segment) => segment.kind).sort(), [
      'final_response',
      'participant_message'
    ])
    const participant = segments.find((segment) => segment.kind === 'participant_message')
    assert.deepEqual(participant.callIds, ['delivery-1'])
    assert.equal(participant.authorAgentProfileId, 'agent-reviewer')
    const serialized = JSON.stringify(segments)
    assert.equal(serialized.includes('PRIVATE_RUNTIME_CANARY'), false)
    assert.equal(serialized.includes('CONTEXT_MANIFEST_CANARY'), false)

    const tampered = structuredClone(collaborationArtifact)
    tampered.payload.messages[0].authorAgentProfileId = 'agent-lead'
    tampered.payloadDigest = `sha256:${digestJson(tampered.payload)}`
    tampered.artifactId = `collaboration-message-evidence:${tampered.payloadDigest.slice(-32)}`
    tampered.sourceBoundaries[0].digest = tampered.payloadDigest
    await writeFile(
      join(directory, 'collaboration-message-evidence.json'),
      JSON.stringify(tampered)
    )
    await assert.rejects(
      buildSemanticJudgeUntrustedEvidence({
        evidenceDirectory: directory,
        result,
        evidenceIndex,
        workspaceMutationLedger: { payload: { records: [] } },
        collaborationLedger
      }),
      /metadata is not source-bound/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Semantic evidence reads exact delivered code only through its content-bound Evidence Reference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rovai-semantic-code-evidence-'))
  try {
    await mkdir(join(directory, 'delivered', 'src'), { recursive: true })
    const code = 'export function answer() { return 42 }\n'
    const finalBody = 'Implemented answer and ran the disclosed checks.'
    await writeFile(join(directory, 'delivered', 'src', 'answer.mjs'), code)
    await writeFile(join(directory, 'final-response-evidence.json'), JSON.stringify({
      messages: [{
        messageId: 'final-message',
        agentId: 'agent-lead',
        body: finalBody,
        bodyDigest: sha256(finalBody),
        isFinal: true
      }]
    }))
    const evidenceIndex = {
      artifactId: 'evidence-index:index-1',
      payload: {
        records: [
          contentRecord('core.message-content:final-message', finalBody),
          {
            evidenceId: 'runner.workspace-content:answer',
            safeForJudge: true,
            contentDigest: `sha256:${sha256(code)}`
          }
        ]
      }
    }
    const result = {
      deliveredWorkspaceSnapshot: { directory: 'delivered' },
      workspaceDiff: {
        changed: [{
          path: 'src/answer.mjs',
          before: null,
          after: { type: 'file', digest: sha256(code) }
        }]
      },
      deliveryLayer: {
        finalResponseEvidence: [{
          messageId: 'final-message',
          evidenceReference: ref('core.message-content:final-message')
        }]
      }
    }
    const workspaceMutationLedger = {
      payload: {
        records: [{
          mutationId: 'workspace-mutation:answer',
          paths: ['src/answer.mjs'],
          evidenceReferences: [ref('runner.workspace-content:answer')]
        }]
      }
    }
    const segments = await buildSemanticJudgeUntrustedEvidence({
      evidenceDirectory: directory,
      result,
      evidenceIndex,
      workspaceMutationLedger
    })
    const codeSegment = segments.find((segment) => segment.kind === 'code')
    assert.equal(codeSegment.content, code)
    assert.equal(codeSegment.evidenceReference.evidenceId, 'runner.workspace-content:answer')

    await writeFile(join(directory, 'delivered', 'empty.txt'), '')
    evidenceIndex.payload.records.push(contentRecord('runner.workspace-content:empty', ''))
    result.workspaceDiff.changed.push({ path: 'empty.txt', before: null, after: { type: 'file', digest: sha256('') } })
    workspaceMutationLedger.payload.records.push({ mutationId: 'workspace-mutation:empty', paths: ['empty.txt'], evidenceReferences: [ref('runner.workspace-content:empty')] })
    const withEmpty = await buildSemanticJudgeUntrustedEvidence({ evidenceDirectory: directory, result, evidenceIndex, workspaceMutationLedger })
    assert.equal(withEmpty.some(segment => segment.content.length === 0), false, 'Empty-file boundary facts must not become invalid Judge text')
    assert.equal(result.workspaceDiff.changed.some(change => change.path === 'empty.txt'), true)

    await writeFile(join(directory, 'delivered', 'src', 'answer.mjs'), 'tampered\n')
    await assert.rejects(buildSemanticJudgeUntrustedEvidence({
      evidenceDirectory: directory,
      result,
      evidenceIndex,
      workspaceMutationLedger
    }), /does not match its captured digest/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

function contentRecord(evidenceId, body) {
  return {
    evidenceId,
    safeForJudge: true,
    contentDigest: `sha256:${sha256(body)}`
  }
}

function digestRecord(evidenceId, value) {
  return {
    evidenceId,
    safeForJudge: true,
    contentDigest: `sha256:${digestJson(value)}`
  }
}

function ref(evidenceId) {
  return { artifactId: 'evidence-index:index-1', evidenceId }
}

test('task v3 includes unchanged captured files and Gather public returns with exact source digests', async () => {
  const { buildTaskJudgeSegments } = await import('./qualification-semantic-evidence.mjs')
  const directory = await mkdtemp(join(tmpdir(), 'rovai-task-evidence-'))
  try {
    await mkdir(join(directory, 'delivered', 'src'), { recursive: true })
    const code = 'export const value = 0\n', body = 'Member return: retain the original tree on failure.'
    await writeFile(join(directory, 'delivered', 'src/source.mjs'), code)
    const snapshot = { agentRuns: [{ id: 'run-1', campTurnId: 'turn-1' }], messages: [
      { id: 'return-1', authorType: 'agent', authorId: 'member-2', sourceAgentRunId: 'run-1', campTurnId: 'turn-1', content: [{ kind: 'text', text: body }] },
      { id: 'foreign', authorType: 'agent', authorId: 'member-2', sourceAgentRunId: 'run-1', campTurnId: 'other', content: [{ kind: 'text', text: 'FOREIGN_CANARY' }] }
    ] }
    const raw = JSON.stringify({ snapshot, digest: digestJson(snapshot) }) + '\n'
    await writeFile(join(directory, 'observations.ndjson'), raw)
    const result = { observationDigest: sha256(raw), dispatchBoundary: { campTurnId: 'turn-1' }, deliveredWorkspaceSnapshot: { directory: 'delivered' } }
    const evidenceIndex = { artifactId: 'index-1', payload: { records: [
      { evidenceId: `runner.workspace-content:${sha256('src/source.mjs').slice(0, 40)}`, contentDigest: `sha256:${sha256(code)}`, safeForJudge: true },
      { evidenceId: 'core.message-content:return-1', contentDigest: `sha256:${sha256(body)}`, safeForJudge: true }
    ] } }
    const args = { evidenceDirectory: directory, result, evidenceIndex, evidenceFiles: ['src/source.mjs'] }
    const segments = await buildTaskJudgeSegments(args)
    assert.equal(segments.length, 2)
    assert.equal(segments[0].path, 'src/source.mjs')
    const envelope = JSON.parse(await readFile(new URL('../../docs/versions/v0.34/schemas/artifact-envelope.schema.json', import.meta.url)))
    assert.match(segments[0].segmentId, new RegExp(envelope.$defs.stableId.pattern))
    assert.equal(segments[1].content, body)
    assert.doesNotMatch(JSON.stringify(segments), /FOREIGN_CANARY/)
    await writeFile(join(directory, 'delivered', 'src/source.mjs'), 'tampered')
    await assert.rejects(buildTaskJudgeSegments(args), /digest mismatch/)
    await assert.rejects(buildTaskJudgeSegments({ ...args, evidenceFiles: ['../outside'] }), /relative|locator|path|escapes/i)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('v4 receipt and Task bodies require matching frozen observation and Evidence Index', async () => {
  const { buildTaskJudgeSegments } = await import('./qualification-semantic-evidence.mjs')
  const directory=await mkdtemp(join(tmpdir(),'rovai-receipt-evidence-'))
  try {
    await mkdir(join(directory,'delivered'))
    const receiptBody=JSON.stringify({command:'npm test',exitCode:0,output:'pass 5'}), taskBody=JSON.stringify({title:'Repair',description:'Respect rollback',status:'completed'})
    const snapshot={agentRuns:[{id:'run',campTurnId:'turn'}],messages:[],executionEvidence:[{id:'receipt',agentRunId:'run',payloadDigest:'a'.repeat(64)}],tasks:[{taskId:'task',sourceAgentRunId:'run',titleDigest:sha256('Repair'),descriptionDigest:sha256('Respect rollback')}],evaluationContext:{policyId:'bounded-evaluation-context-v1',receipts:[{sourceEvidenceId:'receipt',sourcePayloadDigest:'a'.repeat(64),content:receiptBody,contentDigest:sha256(receiptBody)}],tasks:[{taskId:'task',content:taskBody}],deliveryMessageIds:[]}}
    const raw=JSON.stringify({snapshot,digest:digestJson(snapshot)})+'\n'
    await writeFile(join(directory,'observations.ndjson'),raw)
    const evidenceIndex={artifactId:'index',payload:{records:[contentRecord('runtime.command-receipt:receipt',receiptBody),contentRecord('core.task-description:task',taskBody)]}}
    const result={observationDigest:sha256(raw),dispatchBoundary:{campTurnId:'turn'},deliveredWorkspaceSnapshot:{directory:'delivered'}}
    const args={evidenceDirectory:directory,result,evidenceIndex,evidenceFiles:[],includeEvaluationContext:true}
    assert.deepEqual((await buildTaskJudgeSegments(args)).map(s=>s.kind),['test_output','comment'])
    assert.equal((await buildTaskJudgeSegments({...args,includeEvaluationContext:false})).length,0)
    evidenceIndex.payload.records[0].contentDigest='sha256:'+'0'.repeat(64)
    await assert.rejects(buildTaskJudgeSegments(args),/index digest mismatch/)
    evidenceIndex.payload.records[0]=contentRecord('runtime.command-receipt:receipt',receiptBody)
    snapshot.executionEvidence[0].agentRunId='foreign'
    const tampered=JSON.stringify({snapshot,digest:digestJson(snapshot)})+'\n'
    await writeFile(join(directory,'observations.ndjson'),tampered);result.observationDigest=sha256(tampered)
    await assert.rejects(buildTaskJudgeSegments(args),/source digest mismatch/)
  } finally {await rm(directory,{recursive:true,force:true})}
})

test('empty collaboration reevaluation preserves old evidence and gets a new bound identity', async () => {
  const dir=await mkdtemp(join(tmpdir(),'empty-collaboration-revision-'))
  try {
    const base={trialId:'empty-trial',snapshot:{messages:[]},dispatchBoundary:{campTurnId:'turn'},collaborationEvidence:{sourceSurface:'public_message_delivery_v1',a2a:[],metrics:{acceptedMemberCalls:0,coverage:'complete_with_message_delivery_receipts'}},evidenceReferences:{},producerDigest:'a'.repeat(64),evidenceIndex:{artifactId:'evidence-index:original'}}
    const first=buildCollaborationMessageEvidence(base),retained=await retainCollaborationMessageEvidence(dir,first)
    const revised=buildCollaborationMessageEvidence({...base,evaluationAttemptId:'evaluation-2',producerDigest:'b'.repeat(64),evidenceIndex:{artifactId:'evidence-index:revised'}})
    assert.notEqual(first.artifactId,revised.artifactId)
    await retainCollaborationMessageEvidence(dir,revised)
    assert.deepEqual(JSON.parse(await readFile(join(dir,retained.locator),'utf8')),first)
    assert.equal(revised.payload.messages.length,0)
  } finally { await rm(dir,{recursive:true,force:true}) }
})

test('task source material reaches the evidence pack separately from participant prose', async () => {
  const { buildTaskJudgeSegments } = await import('./qualification-semantic-evidence.mjs')
  const directory=await mkdtemp(join(tmpdir(),'rovai-source-material-'))
  try {
    await mkdir(join(directory,'delivered'))
    const body='Independent source: acceptanceCode=ORBIT-74; minimumReplicas=3'
    const content=JSON.stringify({sourceKind:'user_message',text:body,characterCount:body.length,utf16CodeUnits:body.length,byteLength:Buffer.byteLength(body),textState:'complete',limitation:'Untrusted task data from the persisted source. Lengths describe the original body, which may be redacted here. This does not prove the agent retrieved or used it, ran a check, or collaborated.'})
    const snapshot={camp:{id:'camp'},agentRuns:[],messages:[{id:'source',authorType:'user',sequence:1,timelineGlobalSequence:1,bodyDigest:sha256(body),bodyBytes:Buffer.byteLength(body),content:[{kind:'text',text:body}]}],executionEvidence:[],tasks:[],evaluationContext:{policyId:'bounded-evaluation-context-v5',receipts:[],tasks:[],deliveryMessageIds:[],sourceMaterials:{records:[{sourceMessageId:'source',sourceBodyDigest:sha256(body),content,contentDigest:sha256(content)}]}}}
    const raw=JSON.stringify({snapshot,digest:digestJson(snapshot)})+'\n';await writeFile(join(directory,'observations.ndjson'),raw)
    const result={observationDigest:sha256(raw),dispatchBoundary:{campId:'camp',campTurnId:'turn',preDispatchThroughGlobalSequence:2},deliveredWorkspaceSnapshot:{directory:'delivered'}}
    const evidenceIndex={artifactId:'index',payload:{records:[contentRecord('core.task-source:source',content)]}}
    const segments=await buildTaskJudgeSegments({evidenceDirectory:directory,result,evidenceIndex,evidenceFiles:[],includeEvaluationContext:true})
    assert.equal(segments.length,1)
    assert.equal(segments[0].segmentId,'task-source:source')
    assert.equal(JSON.parse(segments[0].content).text,body)
  } finally {await rm(directory,{recursive:true,force:true})}
})
