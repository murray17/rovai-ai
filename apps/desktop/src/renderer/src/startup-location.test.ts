import { describe, expect, it } from 'vitest'
import type { AgentProfile } from '@contracts'
import {
  restoredMemberId,
  startupTargetFromSnapshot
} from './startup-location'

describe('startup location resolution', () => {
  it('applies Quick Chat mode without consulting the saved target', () => {
    expect(startupTargetFromSnapshot({
      schemaVersion: 1,
      sessionId: 'session-1',
      startupLocationMode: 'quick_chat',
      lastSettingsSection: 'general',
      restorableLocationStatus: 'valid',
      restorableLocation: { kind: 'camp', campId: 'camp-1' }
    })).toEqual({ kind: 'quick_chat' })
  })

  it('falls back from missing or damaged local targets but preserves a valid stable target', () => {
    expect(startupTargetFromSnapshot({
      schemaVersion: 1,
      sessionId: 'session-1',
      startupLocationMode: 'last_location',
      lastSettingsSection: 'general',
      restorableLocationStatus: 'invalid',
      restorableLocation: null
    })).toEqual({ kind: 'quick_chat' })
    expect(startupTargetFromSnapshot({
      schemaVersion: 1,
      sessionId: 'session-2',
      startupLocationMode: 'last_location',
      lastSettingsSection: 'runtime',
      restorableLocationStatus: 'valid',
      restorableLocation: { kind: 'members', agentId: 'agent-2', tab: 'runtime' }
    })).toEqual({ kind: 'members', agentId: 'agent-2', tab: 'runtime' })
  })

  it('keeps a manageable requested member or falls back in authoritative Member Order', () => {
    const agents = [
      profile('away-first', 'away', 1),
      profile('present-first', 'present', 2),
      profile('removed', 'removed', 0)
    ]
    expect(restoredMemberId('away-first', agents)).toBe('away-first')
    expect(restoredMemberId('removed', agents)).toBe('present-first')
    expect(restoredMemberId(null, agents)).toBe('present-first')
    expect(restoredMemberId(null, [])).toBeNull()
  })
})

function profile(agentId: string, presence: AgentProfile['presence'], memberOrder: number): AgentProfile {
  return {
    agentId,
    displayName: agentId,
    avatarRef: null,
    accent: null,
    teamRole: '',
    professionalResponsibilities: '',
    personalityTraits: [],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence,
    runtimeConfiguration: null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
    memberOrder,
    version: 1,
    createdAt: '2026-08-09T00:00:00Z',
    updatedAt: '2026-08-09T00:00:00Z',
    removedAt: presence === 'removed' ? '2026-08-09T00:00:00Z' : null
  }
}
