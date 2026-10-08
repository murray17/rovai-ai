import { describe, expect, it } from 'vitest'
import { composerInvitationTargets } from './composer-invitations'

const profiles = [
  { agentId: 'active', presence: 'present' as const },
  { agentId: 'outside', presence: 'present' as const },
  { agentId: 'left', presence: 'present' as const },
  { agentId: 'away', presence: 'away' as const }
]

const members = [
  { agentId: 'active', membershipStatus: 'active' as const, profilePresence: 'present' as const },
  { agentId: 'left', membershipStatus: 'left' as const, profilePresence: 'present' as const },
  { agentId: 'away', membershipStatus: 'active' as const, profilePresence: 'away' as const }
]

describe('composerInvitationTargets', () => {
  it('deduplicates repeated mentions and includes former members for one send-time invite', () => {
    expect(composerInvitationTargets(
      ['outside', 'active', 'outside', 'left', 'left'], members, profiles, true
    )).toEqual({ inviteAgentIds: ['outside', 'left'], unavailableAgentIds: [] })
  })

  it('drops a pending invitation when its last mention is deleted', () => {
    expect(composerInvitationTargets(['outside', 'outside'], members, profiles, true).inviteAgentIds)
      .toEqual(['outside'])
    expect(composerInvitationTargets(['outside'], members, profiles, true).inviteAgentIds)
      .toEqual(['outside'])
    expect(composerInvitationTargets([], members, profiles, true).inviteAgentIds)
      .toEqual([])
  })

  it('blocks unavailable identities and outsiders when invitations are disabled', () => {
    expect(composerInvitationTargets(
      ['away', 'unknown', 'outside'], members, profiles, true
    )).toEqual({ inviteAgentIds: ['outside'], unavailableAgentIds: ['away', 'unknown'] })
    expect(composerInvitationTargets(['outside'], members, profiles, false))
      .toEqual({ inviteAgentIds: [], unavailableAgentIds: ['outside'] })
  })

  it('recognizes a successful invitation on retry without inviting twice', () => {
    const afterInvite = [...members, {
      agentId: 'outside', membershipStatus: 'active' as const, profilePresence: 'present' as const
    }]
    expect(composerInvitationTargets(['outside'], afterInvite, profiles, true))
      .toEqual({ inviteAgentIds: [], unavailableAgentIds: [] })
  })
})
