import type { NavigationThreadItem, NavigationThreadReadState } from '@contracts'

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
