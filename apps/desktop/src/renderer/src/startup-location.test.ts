import { describe, expect, it } from 'vitest'
import type { AgentProfile, NavigationCampItem, NavigationSnapshot } from '@contracts'
import {
  campExistsInAuthoritativeNavigation,
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

  it('uses complete current Navigation pages to distinguish a deleted Camp from a transient snapshot failure', async () => {
    const navigation = emptyNavigation()
    navigation.projects.push({
      projectKey: 'directory:/repo',
      name: 'repo',
      projectPath: '/repo',
      lastActivityAt: '2026-08-09T00:00:00Z',
      lastActivityGlobalSequence: 1,
      totalCount: 8,
      recentCamps: []
    })
    const calls: number[] = []
    const exists = await campExistsInAuthoritativeNavigation('camp-target', navigation, async (path, offset) => {
      calls.push(offset)
      return {
        schemaVersion: 2,
        throughGlobalSequence: 1,
        projectPath: path,
        totalCount: path === '/repo' ? 2 : 0,
        nextOffset: path === '/repo' && offset === 0 ? 1 : null,
        camps: path === '/repo' && offset === 1 ? [camp('camp-target')] : []
      }
    })
    expect(exists).toBe(true)
    expect(calls).toContain(1)
    await expect(campExistsInAuthoritativeNavigation('deleted', navigation, async (path) => ({
      schemaVersion: 2,
      throughGlobalSequence: 1,
      projectPath: path,
      totalCount: 0,
      nextOffset: null,
      camps: []
    }))).resolves.toBe(false)
  })
})

function emptyNavigation(): NavigationSnapshot {
  return {
    schemaVersion: 2,
    throughGlobalSequence: 1,
    quickChat: { totalCount: 0, recentCamps: [] },
    projects: []
  }
}

function camp(id: string): NavigationCampItem {
  return {
    id,
    title: id,
    projectBindingKind: 'quick_chat',
    projectPath: '',
    defaultLead: null,
    marker: 'none',
    lastActivityAt: '2026-08-09T00:00:00Z',
    lastActivityGlobalSequence: 1,
    latestCompletionGlobalSequence: 0,
    version: 1
  }
}

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
