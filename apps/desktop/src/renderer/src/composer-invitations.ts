import type { AgentProfile, ThreadMemberView } from '@contracts'

type Member = Pick<ThreadMemberView, 'agentId' | 'membershipStatus' | 'profilePresence'>
type Profile = Pick<AgentProfile, 'agentId' | 'presence'>

export interface ComposerInvitationTargets {
  inviteAgentIds: string[]
  unavailableAgentIds: string[]
}

/** Member atoms stay in the draft; this projection only decides send-time work. */
export function composerInvitationTargets(
  mentionedAgentIds: readonly string[],
  members: readonly Member[],
  profiles: readonly Profile[],
  canInvite: boolean
): ComposerInvitationTargets {
  const memberById = new Map(members.map((member) => [member.agentId, member]))
  const profileById = new Map(profiles.map((profile) => [profile.agentId, profile]))
  const inviteAgentIds: string[] = []
  const unavailableAgentIds: string[] = []
  for (const agentId of new Set(mentionedAgentIds)) {
    const member = memberById.get(agentId)
    if (member?.membershipStatus === 'active') {
      if (member.profilePresence !== 'present') unavailableAgentIds.push(agentId)
    } else if (canInvite && profileById.get(agentId)?.presence === 'present') {
      inviteAgentIds.push(agentId)
    } else {
      unavailableAgentIds.push(agentId)
    }
  }
  return { inviteAgentIds, unavailableAgentIds }
}
