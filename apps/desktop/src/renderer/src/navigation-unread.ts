import type { ChatReadState, ChatReplyPosition, NavigationPreferencesApi, NavigationPreferencesSnapshot, NavigationThreadItem, NavigationThreadReadState } from '@contracts'

export function chatHasUnread(reply: ChatReplyPosition, state?: ChatReadState): boolean {
  return Boolean(state?.manualUnread) || reply.lastReplySequence > (state?.readThroughReplySequence ?? 0)
}

export function chatRailHasUnread(index: readonly ChatReplyPosition[], states: Record<string, ChatReadState>): boolean {
  return index.some(reply => chatHasUnread(reply, states[reply.chatId]))
}

/** Running and unread are separate facts, even though legacy marker picks one. */
export function navigationThreadHasUnread(thread: NavigationThreadItem, state?: NavigationThreadReadState): boolean {
  if (state?.manualUnread) return true
  const seen = Math.max(thread.lastSeenGlobalSequence
    ?? (thread.marker === 'unread_completed' ? 0 : thread.latestCompletionGlobalSequence),
    state?.readThroughGlobalSequence ?? 0)
  return thread.latestCompletionGlobalSequence > seen
    || (thread.marker === 'unread_completed' && !state && thread.lastSeenGlobalSequence === undefined)
}

export function navigationThreadReadState(
  thread: NavigationThreadItem,
  manualUnread: boolean,
  previous?: NavigationThreadReadState
): NavigationThreadReadState {
  return {
    manualUnread,
    readThroughGlobalSequence: manualUnread
      ? previous?.readThroughGlobalSequence ?? 0
      : Math.max(previous?.readThroughGlobalSequence ?? 0,
        thread.lastSeenGlobalSequence ?? 0, thread.latestCompletionGlobalSequence)
  }
}

/** A lost write receipt is not proof of failure. Read the local owner once,
 * without replaying a write that could clear a newer manual reminder. */
export async function saveNavigationThreadReadState(
  owner: Pick<NavigationPreferencesApi, 'setThreadReadState' | 'get'>,
  threadId: string,
  state: NavigationThreadReadState | null
): Promise<{ snapshot: NavigationPreferencesSnapshot | null; confirmed: boolean }> {
  try {
    return { snapshot: await owner.setThreadReadState(threadId, state), confirmed: true }
  } catch {
    try {
      const snapshot = await owner.get()
      const actual = snapshot.threadReadStates[threadId]
      const confirmed = !snapshot.readError && (state === null
        ? actual === undefined
        : actual?.manualUnread === state.manualUnread
          && actual.readThroughGlobalSequence >= state.readThroughGlobalSequence)
      return { snapshot, confirmed }
    } catch {
      return { snapshot: null, confirmed: false }
    }
  }
}
