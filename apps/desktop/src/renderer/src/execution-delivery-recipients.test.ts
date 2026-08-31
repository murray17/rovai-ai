import { describe, expect, it } from 'vitest'
import type { MessageDeliveryView } from '@contracts'
import { executionDeliveryRecipientIds, executionRecipientLayout } from './execution-delivery-recipients'

type PublicDelivery = Extract<MessageDeliveryView, { deliveryKind: 'public_a2a' }>
function delivery(overrides: Partial<PublicDelivery> = {}): PublicDelivery {
  return {
    id: 'delivery-1', messageId: 'message-1', campTurnId: 'turn', taskId: null,
    recipientAgentId: 'kyoko', recipientMembershipVersionAtAdmission: 1,
    deliveryKind: 'public_a2a', sourceAgentRunId: 'alice-run', dispatchDisposition: 'dispatch',
    completionRole: 'required', gatherId: null, gatherDispatchDeliveryId: null,
    recipientCanonicalPosition: 0, edgeKind: 'forward', targetParentAgentRunId: 'alice-run',
    returnToAgentRunId: null, status: 'pending', dispatchPhase: 'attempted_waiting',
    waitCondition: 'target_busy', dispatchAttemptCount: 1, retryGeneration: 0,
    contextManifestId: null, targetAgentRunId: null, manualInterventionRequired: false,
    failureCode: null, version: 1, createdAt: '2026-08-31T00:00:00Z',
    updatedAt: '2026-08-31T00:00:00Z', endedAt: null, ...overrides
  }
}

describe('execution delivery recipients', () => {
  it('attributes repeated pending and running deliveries only to the sending run', () => {
    const deliveries = ['kyoko', 'megumi'].flatMap((recipientAgentId, recipientCanonicalPosition) =>
      [0, 1, 2].map(attempt => delivery({
        id: `${recipientAgentId}-${attempt}`, messageId: `message-${attempt}`, recipientAgentId,
        recipientCanonicalPosition, status: attempt === 0 ? 'running' : 'pending',
        targetAgentRunId: attempt === 0 ? `${recipientAgentId}-run` : null
      }))
    )
    expect(executionDeliveryRecipientIds(deliveries, 'alice-run')).toEqual(['kyoko', 'megumi'])
    expect(executionDeliveryRecipientIds(deliveries, 'megumi-run')).toEqual([])
    expect(executionDeliveryRecipientIds(deliveries, 'kyoko-run')).toEqual([])
    expect(deliveries).toHaveLength(6)
  })

  it('keeps return and captured-return authors separate from parent and continuation runs', () => {
    const deliveries = ['dispatch', 'gather_captured'].map((dispatchDisposition, index) => delivery({
      id: `return-${index}`, sourceAgentRunId: 'child-run', recipientAgentId: 'caller',
      edgeKind: 'return', targetParentAgentRunId: 'ancestor-run', returnToAgentRunId: 'caller-run',
      targetAgentRunId: index === 0 ? 'continuation-run' : null, status: 'settled',
      dispatchDisposition: dispatchDisposition as PublicDelivery['dispatchDisposition']
    }))
    expect(executionDeliveryRecipientIds(deliveries, 'child-run')).toEqual(['caller'])
    for (const runId of ['ancestor-run', 'caller-run', 'continuation-run']) {
      expect(executionDeliveryRecipientIds(deliveries, runId)).toEqual([])
    }
  })

  it('preserves first-send order and identity through retries and terminal status changes', () => {
    const deliveries = [
      delivery({ id: 'later', recipientAgentId: 'new-recipient', messageId: 'message-2', createdAt: '2026-08-31T00:01:00Z' }),
      delivery({ id: 'second', recipientAgentId: 'megumi', recipientCanonicalPosition: 1 }),
      delivery({ id: 'first', recipientAgentId: 'kyoko' }),
      delivery({ id: 'retry', recipientAgentId: 'kyoko', messageId: 'message-3', retryGeneration: 3, status: 'failed' })
    ]
    const original = deliveries.map(item => item.id)
    expect(executionDeliveryRecipientIds(deliveries, 'alice-run')).toEqual(['kyoko', 'megumi', 'new-recipient'])
    expect(deliveries.map(item => item.id)).toEqual(original)
    for (const status of ['pending', 'running', 'settled', 'failed', 'cancelled', 'interrupted_before_dispatch']) {
      expect(executionDeliveryRecipientIds([delivery({ status })], 'alice-run')).toEqual(['kyoko'])
    }
  })

  it('does not infer missing legacy attribution or expose private completion deliveries', () => {
    const completion: MessageDeliveryView = {
      ...delivery(), deliveryKind: 'gather_completion', dispatchDisposition: 'dispatch',
      completionRole: 'required', gatherId: 'gather', targetConversationId: 'conversation'
    }
    expect(executionDeliveryRecipientIds([
      delivery({ sourceAgentRunId: undefined, targetAgentRunId: 'alice-run' }), completion
    ], 'alice-run')).toEqual([])
  })
})

describe('single-row recipient capacity', () => {
  it.each([
    [0, 0, 0, 0], [1, 28, 1, 0], [2, 60, 2, 0], [3, 92, 3, 0],
    [3, 91.99, 1, 2], [16, 323, 9, 7], [16, 308, 8, 8],
    [2, 28, 0, 2], [2, 0, 0, 2], [1000, 200, 5, 995]
  ])('fits %i recipients in %s px without partial avatars', (total, width, visibleCount, hiddenCount) => {
    const layout = executionRecipientLayout(total, width)
    expect(layout).toMatchObject({ visibleCount, hiddenCount })
    if (hiddenCount > 0 && width >= layout.overflowWidth) {
      expect(visibleCount * 32 + layout.overflowWidth).toBeLessThanOrEqual(width)
    }
  })
})
