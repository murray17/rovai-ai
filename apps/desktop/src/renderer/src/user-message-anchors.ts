import type { AgentRunView, ThreadMessageView, ThreadTurnView } from '@contracts'

export const USER_ANCHOR_MIN_COUNT = 4
export const USER_ANCHOR_MIN_WIDTH = 760
export const USER_ANCHOR_ROW_HEIGHT = 10
export const USER_ANCHOR_MAX_HEIGHT = 360

export interface UserMessageAnchor {
  id: string
  title: string
  firstReply: string | null
}

/** The index is a projection of loaded public history, never a second history reader. */
export function userMessageAnchors(
  messages: readonly ThreadMessageView[],
  runs: readonly Pick<AgentRunView, 'id' | 'inputMessageIds' | 'anchorMessageId' | 'threadTurnId'>[],
  turns: readonly Pick<ThreadTurnView, 'id' | 'triggerType' | 'triggerId'>[],
  text: (message: ThreadMessageView) => string = message => message.body
): UserMessageAnchor[] {
  const ordered = [...messages].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
  const users = ordered.filter(message => !message.withdrawn && !message.missionStart
    && (message.authorType === 'user' || message.authorType === 'external_principal'))
  const userSequence = new Map(users.map(message => [message.id, message.sequence]))
  const turnInputs = new Map(turns.filter(turn => turn.triggerType === 'camp_message')
    .map(turn => [turn.id, turn.triggerId]))
  const runInputs = new Map(runs.map(run => [run.id, [...new Set([
    ...(run.inputMessageIds ?? []), run.anchorMessageId,
    run.threadTurnId ? turnInputs.get(run.threadTurnId) : null
  ].filter((id): id is string => Boolean(id)))]]))
  const replies = new Map<string, string>()
  const summary = (message: ThreadMessageView): string =>
    (text(message).trim() || message.attachments.map(attachment => attachment.displayName).join('、')
      || (message.quotes ?? []).map(quote => quote.text).join(' '))
      .replace(/\s+/gu, ' ')

  for (const message of ordered) {
    if (message.authorType !== 'agent' || message.withdrawn || message.missionStart) continue
    // Explicit replies take precedence. Never infer a reply from chronological adjacency.
    const inputIds = message.replyToThreadMessageId
      ? [message.replyToThreadMessageId]
      : (message.sourceAgentRunId ? runInputs.get(message.sourceAgentRunId) : undefined)
        ?? (message.threadTurnId && turnInputs.has(message.threadTurnId)
          ? [turnInputs.get(message.threadTurnId)!] : [])
    for (const id of inputIds) {
      // A Run can accept more inputs after publishing output; earlier output cannot answer a future input.
      const sequence = userSequence.get(id)
      if (sequence !== undefined && message.sequence > sequence && !replies.has(id)) {
        replies.set(id, summary(message))
      }
    }
  }
  return users.map(message => ({ id: message.id, title: summary(message),
    firstReply: replies.get(message.id) || null }))
}

export function userAnchorStackHeight(count: number, stageHeight: number): number {
  const cap = Math.max(0, Math.min(USER_ANCHOR_MAX_HEIGHT, stageHeight * .7, stageHeight - 24))
  return Math.min(count, Math.floor(cap / USER_ANCHOR_ROW_HEIGHT)) * USER_ANCHOR_ROW_HEIGHT
}

export function userAnchorKeyIndex(key: string, index: number, count: number, height: number): number | null {
  const page = Math.max(1, Math.floor(height / USER_ANCHOR_ROW_HEIGHT) - 1)
  const next = key === 'ArrowDown' ? index + 1 : key === 'ArrowUp' ? index - 1
    : key === 'PageDown' ? index + page : key === 'PageUp' ? index - page
      : key === 'Home' ? 0 : key === 'End' ? count - 1 : null
  return next === null ? null : Math.max(0, Math.min(count - 1, next))
}
