import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/agent-run-context-v22.json'
import { isCampId, type ContextManifestView } from './index'

describe('AgentRun context contract', () => {
  it('uses the shared frozen v22 fixture', () => {
    const formatterVersion: ContextManifestView['formatterVersion'] = 22

    expect(fixture.agentRunContextFormatterVersion).toBe(formatterVersion)
    expect(fixture.contextManifestFormatterVersion).toBe(formatterVersion)
    expect(fixture.contextDeliveryProfileVersion).toBe(4)
    expect(fixture.contextManifestVersion).toBe(22)
    expect(fixture.messageProjectionAudience).toBe('agent_v1')
    expect(fixture.dynamicContextSectionOrder.slice(-2)).toEqual(['A2A_GUIDANCE?', 'CURRENT_INPUT'])
    expect(fixture.dynamicContextSectionOrder.at(-1)).toBe('CURRENT_INPUT')
    expect(fixture.a2aGuidance).toMatchObject({
      evidenceSchemaVersion: 1,
      omittedEvidence: { schemaVersion: 1, included: false },
    })
    expect(fixture.collaborationState).toEqual({
      schemaVersion: 2,
      peerFields: ['agentId', 'name', 'teamRole', 'professionalResponsibilities'],
    })
    expect(fixture.selfActiveTaskProjection).toMatchObject({
      section: 'SELF_ACTIVE_TASKS',
      maxTasks: 8,
      emptyCandidateProjection: { tasks: [] },
      allCandidatesBudgetOmitted: 'section_omitted',
    })
    expect(fixture.recentPublicCandidateSelection).toEqual({
      boundary: 'previousAcceptedSequence < sequence <= currentBoundarySequence',
      preLimitExclusions: ['tombstone', 'currentTrigger', 'authorType:agent+currentAgentId'],
      limit: 15,
      selectionOrdering: 'sequence DESC',
      projectionOrdering: 'sequence ASC',
      selfAuthoredRecentMessages: 'ineligible',
      selfAuthoredWholeHistoryOmission: 'excluded',
      referenceClosure: 'unchanged',
    })
    expect(fixture.currentInputSourceShapes).toEqual({
      user: { type: 'user' },
      externalPrincipal: {
        type: 'external_principal',
        provider: 'feishu',
        displayName: 'Alice',
      },
      memberCall: {
        type: 'member_call',
        senderAgentId: 'source-agent',
        senderName: 'Source Agent',
      },
      gatherCompletion: {
        schemaVersion: 3,
        messageProjectionAudience: 'agent_v1',
        source: { type: 'gather_completed' },
        gatherId: 'gather-id',
        commandId: 'command-id',
        requestMessageId: 'message-id',
        request: {
          messageId: 'message-id',
          body: 'Original Gather request',
          contentDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          projectedBodyDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
        items: [],
      },
    })
    expect(fixture.directUserCurrentInputOptionalFields.skills[0].path).toMatch(/\/SKILL\.md$/u)
    expect(fixture.skillSelectionSnapshot.empty).toEqual({schemaVersion: 1, entries: []})
    expect(fixture.currentInputSkillResolutionEvidence.outcomes).toEqual(['included', 'omitted'])
    expect(fixture.gatherCompletionManifestEvidence).toContain('completionInputDigest')
    expect(fixture.sharedConversationTopLevelFields).toEqual(['campId'])
    expect(isCampId(fixture.sharedConversationExample.campId)).toBe(true)
    expect(isCampId('01890f3d-e7c5-7cc3-98c4-dc0c0c07398f')).toBe(false)
    expect(isCampId('rvcamp_2n1t201rmv87aae5j4csam8000')).toBe(false)
    expect(isCampId('rvcamp_01h47kvsy5fk1hhh6w1g60eecf')).toBe(false)
    expect(fixture.modelCampMessageRequiredFields).toEqual([
      'messageId', 'sequence', 'senderType', 'senderId', 'body',
    ])
    expect(fixture.modelCampMessageOptionalFields).toContain('mentionsCurrentUser:true')
    expect(fixture.modelCampMessageRemovedFields).toEqual([
      'bodyLength', 'bodyTruncated', 'continuation', 'mentionsCurrentUser:false',
    ])
    expect(fixture.historicalAttachmentFields).toEqual(['name', 'mediaType', 'path'])
    expect(fixture.truncatedBodyContinuation).toEqual({
      field: 'nextBodyOffset',
      unit: 'unicode_scalar',
      campReadItemMapping: [
        'SHARED_CONVERSATION.campId', 'message.messageId', 'message.nextBodyOffset',
      ],
    })
    expect(fixture.omittedMessagesFields).toEqual(['count', 'sequenceStart', 'sequenceEnd'])
    expect(fixture.omittedMessagesRemovedFields).toEqual(['navigationHint'])
    expect(fixture.contextManifestSharedMessageEvidence).toContain('attachmentIdPathDigest')
    expect(fixture.contextManifestSharedMessageEvidence).toContain('mentionsCurrentUser')
    expect(fixture.contextManifestSharedMessageEvidence).toContain('projectedBodyDigest')
    expect(fixture.contextManifestOmissionEvidence.wholeHistory).not.toHaveProperty('messageIds')
    expect(fixture.contextManifestOmissionEvidence.boundedCandidate).toEqual({
      kind: 'public_history',
      messageIds: ['message-123'],
      reason: 'history_budget',
    })
    expect(fixture.runFacts).toMatchObject({
      schemaVersion: 2,
      requiredFields: ['campResources'],
      emptyOptionalProjection: 'camp_resources_only',
    })
    expect(fixture.contextManifestRunFactEvidence).toEqual([
      'typedFactReferences', 'typedTaskReference', 'exactCompactJsonBytes', 'digest',
    ])
    expect(fixture.bootstrapRedeliveryEnvelopeVersion).toBe(2)
    expect(fixture.bootstrapRedeliveryFormatterVersion).toBe(2)
  })
})
