import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/agent-run-context-v12.json'
import type { ContextManifestView } from './index'

describe('AgentRun context contract', () => {
  it('uses the shared frozen v12 fixture', () => {
    const formatterVersion: ContextManifestView['formatterVersion'] = 12

    expect(fixture.agentRunContextFormatterVersion).toBe(formatterVersion)
    expect(fixture.contextManifestFormatterVersion).toBe(formatterVersion)
    expect(fixture.contextDeliveryProfileVersion).toBe(3)
    expect(fixture.selfActiveTaskProjection).toMatchObject({
      section: 'SELF_ACTIVE_TASKS',
      maxTasks: 8,
    })
    expect(fixture.currentInputSourceShapes).toEqual({
      user: { type: 'user' },
      memberCall: {
        type: 'member_call',
        senderAgentId: 'source-agent',
        senderName: 'Source Agent',
      },
    })
    expect(fixture.historicalMessageIdentityFields).toEqual([
      'messageId',
      'sequence',
      'senderType',
      'senderId',
      'replyToMessageId',
    ])
    expect(fixture.historicalAttachmentFields).toEqual(['name', 'mediaType', 'path'])
    expect(fixture.truncatedBodyContinuation.operation).toBe('camp.read')
    expect(fixture.omissionRecoveryField).toBe('navigationHint')
    expect(fixture.contextManifestSharedMessageEvidence).toContain('attachmentIdPathDigest')
    expect(fixture.contextManifestOmissionEvidence.wholeHistory).not.toHaveProperty('messageIds')
    expect(fixture.contextManifestOmissionEvidence.boundedCandidate).toEqual({
      kind: 'public_history',
      messageIds: ['message-123'],
      reason: 'history_budget',
    })
    expect(fixture.contextManifestRunNoticeEvidence).toEqual([
      'typedTaskReference',
      'code',
      'exactCompactJsonBytes',
      'digest',
    ])
    expect(fixture.bootstrapRedeliveryEnvelopeVersion).toBe(2)
    expect(fixture.bootstrapRedeliveryFormatterVersion).toBe(2)
  })
})
