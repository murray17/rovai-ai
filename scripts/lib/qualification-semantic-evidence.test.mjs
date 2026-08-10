import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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
        contentDigest: sha256('Review the transition and list concrete defects.')
      }, {
        callId: 'delivery-2',
        deliveryId: 'delivery-2',
        messageId: 'message-1',
        senderAgentId: 'agent-lead',
        recipientAgentId: 'agent-tester',
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
    await mkdir(join(directory, 'delivered'))
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
