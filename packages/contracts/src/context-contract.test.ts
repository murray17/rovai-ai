import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/agent-run-context-v18.json'
import type { ContextManifestView } from './index'

describe('AgentRun context contract', () => {
  it('uses the shared frozen v18 fixture', () => {
    const formatterVersion: ContextManifestView['formatterVersion'] = 18

    expect(fixture.agentRunContextFormatterVersion).toBe(formatterVersion)
    expect(fixture.contextManifestFormatterVersion).toBe(formatterVersion)
    expect(fixture.contextDeliveryProfileVersion).toBe(3)
    expect(fixture.contextManifestVersion).toBe(16)
    expect(fixture.dynamicContextSectionOrder.at(-1)).toBe('CURRENT_INPUT')
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
    expect(fixture.currentInputSourceShapes).toEqual({
      user: { type: 'user' },
      memberCall: {
        type: 'member_call',
        senderAgentId: 'source-agent',
        senderName: 'Source Agent',
      },
      gatherCompletion: {
        schemaVersion: 2,
        source: { type: 'gather_completed' },
        gatherId: 'gather-id',
        commandId: 'command-id',
        requestMessageId: 'message-id',
        request: {
          messageId: 'message-id',
          body: 'Original Gather request',
          contentDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        items: [],
      },
    })
    expect(fixture.directUserCurrentInputOptionalFields.skills[0].path).toMatch(/\/SKILL\.md$/u)
    expect(fixture.skillSelectionSnapshot.empty).toEqual({schemaVersion: 1, entries: []})
    expect(fixture.currentInputSkillResolutionEvidence.outcomes).toEqual(['included', 'omitted'])
    expect(fixture.gatherCompletionManifestEvidence).toContain('completionInputDigest')
    expect(fixture.sharedConversationTopLevelFields).toEqual(['campId'])
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
    expect(fixture.runFacts).toMatchObject({schemaVersion: 1, emptyProjection: 'section_omitted'})
    expect(fixture.contextManifestRunFactEvidence).toEqual([
      'typedFactReferences', 'typedTaskReference', 'exactCompactJsonBytes', 'digest',
    ])
    expect(fixture.bootstrapRedeliveryEnvelopeVersion).toBe(2)
    expect(fixture.bootstrapRedeliveryFormatterVersion).toBe(2)
  })
})
