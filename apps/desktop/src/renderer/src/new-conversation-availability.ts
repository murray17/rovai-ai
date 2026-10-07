import type { ThreadCreationPreflight } from '@contracts'
import { uiAttribute } from './interface-language'

type ConversationCandidate = Pick<
  ThreadCreationPreflight['presentMembers'][number],
  'runtimeConfigured' | 'runtimeReadiness'
>

export function isNewConversationMemberAvailable(member: ConversationCandidate): boolean {
  return member.runtimeConfigured
    && (member.runtimeReadiness === 'ready' || member.runtimeReadiness === 'light_ready' || member.runtimeReadiness === 'installed_unverified')
}

export function newConversationMemberStatus(member: ConversationCandidate): string {
  if (!member.runtimeConfigured || member.runtimeReadiness === 'runtime_not_configured') {
    return uiAttribute('未配置智能体')
  }
  return isNewConversationMemberAvailable(member) ? uiAttribute('可用') : uiAttribute('智能体不可用')
}
