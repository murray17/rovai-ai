import type { MessageDeliveryView } from '@contracts'

type PublicDelivery = Extract<MessageDeliveryView, { deliveryKind: 'public_a2a' }>

export function executionDeliveryRecipientIds(
  deliveries: readonly MessageDeliveryView[],
  sourceAgentRunId: string
): string[] {
  const outgoing = deliveries.filter((delivery): delivery is PublicDelivery =>
    delivery.deliveryKind === 'public_a2a' && delivery.sourceAgentRunId === sourceAgentRunId
  ).sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
    || left.messageId.localeCompare(right.messageId)
    || left.recipientCanonicalPosition - right.recipientCanonicalPosition
    || left.id.localeCompare(right.id)
  )
  // A retry or a second message changes delivery state, not recipient identity.
  return [...new Set(outgoing.map(delivery => delivery.recipientAgentId))]
}

// Keep these dimensions in sync with the recipient slots in styles.css.
const AVATAR_SLOT = 28
const GAP = 4

export function executionRecipientLayout(total: number, availableWidth: number): {
  visibleCount: number
  hiddenCount: number
  overflowWidth: number
} {
  const width = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0
  const capacity = Math.max(0, Math.floor((width + GAP) / (AVATAR_SLOT + GAP)))
  // Large counts may need a wider pill; reserve it before choosing visible avatars.
  const overflowWidth = Math.max(AVATAR_SLOT, 12 + String(total).length * 7)
  const visibleCount = total <= capacity ? total
    : Math.min(total, Math.max(0, Math.floor((width - overflowWidth) / (AVATAR_SLOT + GAP))))
  return { visibleCount, hiddenCount: total - visibleCount, overflowWidth }
}
