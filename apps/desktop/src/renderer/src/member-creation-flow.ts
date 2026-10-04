import type { NavigationSnapshot, NavigationThreadItem, ThreadComposerDraftView, ThreadCreationPreflight } from '@contracts'
import { isNewConversationMemberAvailable } from './new-conversation-availability'
import { uiAttribute } from './interface-language'
import { emptyLocalThreadComposerDraft } from './camp-composer-local-store'
import { composerDocumentFromText } from './composer-document'

export function memberCreationInitialDraft(threadId: string): ThreadComposerDraftView {
  const body = uiAttribute('帮我添加一位新队员。先聊聊我的需求，再一起确定角色、职责和性格。')
  return { ...emptyLocalThreadComposerDraft(threadId), body, content: composerDocumentFromText(body) }
}

export function memberCreationHelper(preflight: ThreadCreationPreflight, defaultLeadAgentId: string | null): string | null {
  const available = [...preflight.presentMembers].filter(isNewConversationMemberAvailable)
    .sort((left, right) => left.memberOrder - right.memberOrder)
  for (const id of [preflight.lastMemberCreationHelperAgentId, defaultLeadAgentId]) {
    if (id && available.some((member) => member.agentId === id)) return id
  }
  return available[0]?.agentId ?? null
}

export function memberCreationStarters() {
  return [
    { title: uiAttribute('从喜欢的角色开始'), prompt: uiAttribute('我想把喜欢的角色变成队友。角色是：\n希望保留的性格和特长是：\n请先和我讨论角色定位，再一起完善队员资料和形象。') },
    { title: uiAttribute('按工作需要找搭档'), prompt: uiAttribute('我想创建一位工作搭档，协助我处理：\n希望对方擅长：\n我偏好的合作方式是：\n请先帮我明确分工，再设计合适的身份、性格和形象。') },
    { title: uiAttribute('设计原创伙伴'), prompt: uiAttribute('我想设计一位原创伙伴。初步设想是：\n希望对方带来的感受或能力是：\n请和我一起探索名字、背景、性格和形象，并在创建前让我确认。') }
  ]
}

export interface MemberCreationDraft {
  navigation: NavigationThreadItem
  draft: ThreadComposerDraftView | null
}

export function hasMemberCreationInput(draft: ThreadComposerDraftView | null): boolean {
  return Boolean(draft && (draft.body.trim() || draft.attachments.length || draft.quotes.length || draft.replyIntent))
}

/** Window-local drafts augment display only. Core navigation and startup remain unchanged. */
export function navigationWithMemberCreationDrafts(navigation: NavigationSnapshot | null, drafts: ReadonlyMap<string, MemberCreationDraft>): NavigationSnapshot | null {
  if (!navigation) return null
  const existing = new Set([ ...navigation.quickChat.recentThreads, ...navigation.projects.flatMap((project) => project.recentThreads) ].map((thread) => thread.id))
  const rows = [...drafts.values()].filter((entry) => hasMemberCreationInput(entry.draft) && !existing.has(entry.navigation.id))
    .map(({ navigation: thread, draft }) => ({ ...thread, title: draft?.body.trim().split('\n')[0]?.slice(0, 60) || uiAttribute('新建队员') }))
  if (rows.length === 0) return navigation
  return { ...navigation, quickChat: { ...navigation.quickChat,
    totalCount: navigation.quickChat.totalCount + rows.length,
    recentThreads: [...rows.reverse(), ...navigation.quickChat.recentThreads] } }
}
