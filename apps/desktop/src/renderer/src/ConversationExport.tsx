import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { CurrentUserProfile, ThreadMessageView, ThreadOpenProjection } from '@contracts'
import type { ThreadClient } from './camp-client'
import { useCurrentUserProfile } from './CurrentUserProfile'
import { MessageExportDialog } from './MessageExport'
import { ConversationExportReader, type ConversationExportState } from './conversation-export-reader'
import { createMessageExportEntry, exportableMessages } from './message-export'
import { samePublicMessageSegment } from './public-message-grouping'
import { AgentMessageMarkdownBody, TruncatedStructuredMessageBody, campConversationTimeline } from './ThreadWorkspace'
import { uiAttribute } from './interface-language'

export function useConversationExport(client: ThreadClient, navigationKey: string) {
  const reader = useMemo(() => new ConversationExportReader(client), [client])
  const state = useSyncExternalStore(reader.subscribe, reader.getSnapshot)
  useEffect(() => reader.start(), [reader])
  const previousNavigation = useRef(navigationKey)
  useLayoutEffect(() => {
    if (previousNavigation.current !== navigationKey) reader.close()
    previousNavigation.current = navigationKey
  }, [reader, navigationKey])
  return { reader, state }
}

/** Build every reference and image association from the collected source, never the browsing window. */
export function conversationExportEntries(projection: ThreadOpenProjection, messages: ThreadMessageView[], user: CurrentUserProfile) {
  const memberById = new Map(projection.members.map(member => [member.agentId, member]))
  const names = new Map(projection.members.map(member => [member.agentId, member.displayName]))
  const messageById = new Map(messages.map(message => [message.id, message]))
  const runById = new Map(projection.agentRuns.map(run => [run.id, run]))
  const grouping = (message: ThreadMessageView): ThreadMessageView => ({ ...message,
    threadTurnId: message.threadTurnId ?? (message.sourceAgentRunId ? runById.get(message.sourceAgentRunId)?.threadTurnId : null) ?? null })
  const timeline = campConversationTimeline(messages, projection.turns, projection.agentRuns, projection.tasks,
    projection.agentRunFileChanges, projection.agentRunImages, projection.memberCreations)
  const contexts = new Map(timeline.flatMap((item, index) => {
    if (item.kind !== 'camp_message') return []
    const next = timeline[index + 1]
    return [[item.message.id, {
      nextGroupedMessageId: next?.kind === 'camp_message' && samePublicMessageSegment(grouping(item.message), grouping(next.message)) ? next.message.id : null,
      runtimeImages: item.runtimeImageGroups.flatMap(group => group.images)
    }] as const]
  }))
  return exportableMessages(messages).map(message => createMessageExportEntry(message, {
    memberById, names, currentUserName: user.displayName.trim() || uiAttribute('你'), avatarDataUrl: user.avatarDataUrl,
    parent: message.replyToThreadMessageId ? messageById.get(message.replyToThreadMessageId) : null,
    ...(contexts.get(message.id) ?? { nextGroupedMessageId: null, runtimeImages: [] })
  }))
}

export function ConversationExportDialog({ state, reader }: { state: ConversationExportState; reader: ConversationExportReader }): React.JSX.Element | null {
  const { profile } = useCurrentUserProfile()
  const entries = useMemo(() => state.projection && state.messages ? conversationExportEntries(state.projection, state.messages, profile) : null,
    [state.projection, state.messages, profile])
  const projection = state.projection
  if (!state.target || state.status === 'idle') return null
  const renderBody = (message: ThreadMessageView) => message.authorType === 'agent' && !message.content?.some(segment => segment.kind === 'current_user_mention')
    ? <AgentMessageMarkdownBody body={message.body} content={message.content} members={projection?.members ?? []} onActivateMemberMention={() => undefined} />
    : <TruncatedStructuredMessageBody body={message.body} content={message.content} members={projection?.members ?? []}
        truncate={false} forceExpanded renderLeadingCurrentUserMarkdown={message.authorType === 'agent'} />
  return <MessageExportDialog key={state.target.id} threadId={state.target.id} title={projection?.thread.title ?? state.target.title}
    entries={entries} renderBody={renderBody} onClose={reader.close} conversation={{ status: state.status, onRetry: reader.retry }} />
}
