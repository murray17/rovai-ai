export type MemberReturnSourceView = 'compose' | 'camp' | 'members' | 'memory' | 'settings'

export interface MemberConversationReturnTarget {
  kind: 'conversation'
  campId: string
  contextLabel: string
  title: string
}

export type MemberReturnTarget = MemberConversationReturnTarget | { kind: 'app' }

export function memberReturnTargetForSource(
  sourceView: MemberReturnSourceView,
  conversation: Omit<MemberConversationReturnTarget, 'kind' | 'title'> & {
    title: string | null
  } | null
): MemberReturnTarget {
  if (sourceView !== 'camp' || !conversation) return { kind: 'app' }
  return {
    kind: 'conversation',
    ...conversation,
    title: conversation.title?.trim() || '正在打开对话'
  }
}
