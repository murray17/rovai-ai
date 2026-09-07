import type { CampCreationPreflight } from '@contracts'

type ConversationCandidate = Pick<
  CampCreationPreflight['presentMembers'][number],
  'runtimeConfigured' | 'runtimeReadiness'
>

export function isNewConversationMemberAvailable(member: ConversationCandidate): boolean {
  return member.runtimeConfigured
    && (member.runtimeReadiness === 'ready' || member.runtimeReadiness === 'light_ready')
}

export function newConversationMemberStatus(member: ConversationCandidate): string {
  if (!member.runtimeConfigured || member.runtimeReadiness === 'runtime_not_configured') {
    return '未配置运行时'
  }
  return isNewConversationMemberAvailable(member) ? '可用' : '运行时不可用'
}
