import type { CampMessageView } from '@contracts'

export const PUBLIC_MESSAGE_GROUP_HEIGHT = 320
export const PUBLIC_MESSAGE_GROUP_INTERVAL_MS = 5 * 60_000

type GroupMessage = Pick<CampMessageView,
  'authorType' | 'authorId' | 'campTurnId' | 'sourceAgentRunId' | 'createdAt'>

/** Call only for adjacent timeline messages; evidence and event rows break a group. */
export function samePublicMessageSegment(previous: GroupMessage, next: GroupMessage): boolean {
  if (previous.authorType !== 'agent' || next.authorType !== 'agent'
    || previous.authorId !== next.authorId) return false
  const sameTurn = previous.campTurnId || next.campTurnId
    ? Boolean(previous.campTurnId && previous.campTurnId === next.campTurnId)
    : Boolean(previous.sourceAgentRunId && previous.sourceAgentRunId === next.sourceAgentRunId)
  if (!sameTurn) return false
  const before = new Date(previous.createdAt)
  const after = new Date(next.createdAt)
  const interval = after.getTime() - before.getTime()
  return interval >= 0 && interval <= PUBLIC_MESSAGE_GROUP_INTERVAL_MS
    && before.toDateString() === after.toDateString()
}
