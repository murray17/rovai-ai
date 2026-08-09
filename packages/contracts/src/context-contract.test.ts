import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/agent-run-context-v11.json'
import type { ContextManifestView } from './index'

describe('AgentRun context contract', () => {
  it('uses the shared frozen v11 fixture', () => {
    const formatterVersion: ContextManifestView['formatterVersion'] = 11

    expect(fixture.agentRunContextFormatterVersion).toBe(formatterVersion)
    expect(fixture.contextManifestFormatterVersion).toBe(formatterVersion)
    expect(fixture.contextDeliveryProfileVersion).toBe(2)
    expect(fixture.memberCallSenderIdentityField).toBe('senderAgentId')
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
