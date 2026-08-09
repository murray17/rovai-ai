import { describe, expect, it } from 'vitest'
import type { AgentProfile, GeneralPreferencesSnapshot, NavigationCampItem } from '@contracts'
import {
  currentProjectForCamp,
  defaultsNeedInvalidation,
  parseCurrentProject,
  resolveNewConversationDefaults
} from './new-conversation-preferences'

describe('new conversation preferences', () => {
  it('restores only exact current Project selections', () => {
    expect(parseCurrentProject(null)).toEqual({ kind: 'quick_chat' })
    expect(parseCurrentProject('{broken')).toEqual({ kind: 'quick_chat' })
    expect(parseCurrentProject(JSON.stringify({ kind: 'directory', projectPath: '/repo' })))
      .toEqual({ kind: 'directory', projectPath: '/repo' })
    expect(parseCurrentProject(JSON.stringify({ kind: 'directory', projectPath: '' })))
      .toEqual({ kind: 'quick_chat' })
  })

  it('derives the current Project from a Camp without coupling it to disclosure state', () => {
    expect(currentProjectForCamp(camp('directory', '/repo')))
      .toEqual({ kind: 'directory', projectPath: '/repo' })
    expect(currentProjectForCamp(camp('quick_chat', '/quick-chat')))
      .toEqual({ kind: 'quick_chat' })
  })

  it('ignores runtime readiness but latches missing, away, removed, and invalid Lead configurations', () => {
    const preferences = configuredPreferences()
    const present = profile('agent-a', 'present')
    const unready = profile('agent-b', 'present')
    unready.runtimeReadiness.status = 'needs_attention'
    expect(resolveNewConversationDefaults(preferences, [present, unready])?.lead.agentId).toBe('agent-a')
    expect(defaultsNeedInvalidation(preferences, [present, unready])).toBe(false)

    expect(defaultsNeedInvalidation(preferences, [present, profile('agent-b', 'away')])).toBe(true)
    expect(defaultsNeedInvalidation(preferences, [present])).toBe(true)
    expect(defaultsNeedInvalidation({
      ...preferences,
      newConversationDefaultsRequireConfirmation: true
    }, [present, unready])).toBe(false)
  })
})

function configuredPreferences(): GeneralPreferencesSnapshot {
  return {
    schemaVersion: 2,
    startupLocationMode: 'last_location',
    lastSettingsSection: 'general',
    newConversationDefaults: {
      memberAgentIds: ['agent-a', 'agent-b'],
      defaultLeadAgentId: 'agent-a'
    },
    newConversationDefaultsRequireConfirmation: false,
    oneClickNewConversationEnabled: true
  }
}

function profile(agentId: string, presence: AgentProfile['presence']): AgentProfile {
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
    memberOrder: 0,
    version: 1,
    createdAt: '2026-08-09T00:00:00Z',
    updatedAt: '2026-08-09T00:00:00Z',
    removedAt: presence === 'removed' ? '2026-08-09T00:00:00Z' : null
  }
}

function camp(
  projectBindingKind: NavigationCampItem['projectBindingKind'],
  projectPath: string
): Pick<NavigationCampItem, 'projectBindingKind' | 'projectPath'> {
  return { projectBindingKind, projectPath }
}
