import { describe, expect, it } from 'vitest'
import type {
  AgentProfile,
  GeneralPreferencesSnapshot,
  NavigationCampItem,
  NavigationSnapshot
} from '@contracts'
import {
  currentProjectAccessDecision,
  currentProjectForCamp,
  currentProjectWorkspace,
  defaultsNeedInvalidation,
  navigationIncludingCurrentWorkspace,
  navigationWithProjectAuthority,
  navigationWithProjectOrder,
  navigationWithoutRemovedProjects,
  parseCurrentProject,
  projectTargetKey,
  resolveNewConversationDefaults,
  shouldInvalidateNewConversationDefaults
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

  it('keeps a validated current workspace visible when it has no navigable Camps', () => {
    const navigation: NavigationSnapshot = {
      schemaVersion: 3,
      throughGlobalSequence: 7,
      quickChat: { totalCount: 0, recentCamps: [] },
      projects: []
    }
    const currentProject = { kind: 'directory', projectPath: '/repo/empty-project' } as const
    const displayed = navigationIncludingCurrentWorkspace(navigation, currentProject, {
      name: 'empty-project',
      projectPath: '/repo/empty-project'
    })

    expect(displayed).not.toBe(navigation)
    expect(displayed?.projects).toEqual([{
      projectKey: 'directory:/repo/empty-project',
      name: 'empty-project',
      projectPath: '/repo/empty-project',
      lastActivityAt: '',
      lastActivityGlobalSequence: 0,
      totalCount: 0,
      recentCamps: []
    }])
    expect(currentProjectWorkspace(displayed, currentProject)).toEqual({
      name: 'empty-project',
      projectPath: '/repo/empty-project'
    })
    expect(navigationIncludingCurrentWorkspace(navigation, currentProject, {
      name: 'other',
      projectPath: '/repo/other'
    })).toBe(navigation)
  })

  it('removes only explicitly hidden directory Projects from the Renderer navigation', () => {
    const navigation: NavigationSnapshot = {
      schemaVersion: 3,
      throughGlobalSequence: 7,
      quickChat: { totalCount: 1, recentCamps: [] },
      projects: [
        project('/repo/a'),
        project('/repo/b')
      ]
    }

    const displayed = navigationWithoutRemovedProjects(
      navigation,
      new Set([projectTargetKey('/repo/a')])
    )

    expect(displayed?.quickChat).toBe(navigation.quickChat)
    expect(displayed?.projects.map((candidate) => candidate.projectPath)).toEqual(['/repo/b'])
    expect(navigation.projects).toHaveLength(2)
  })

  it('projects the persisted Project order without mutating the activity-sorted snapshot', () => {
    const navigation: NavigationSnapshot = {
      schemaVersion: 3,
      throughGlobalSequence: 7,
      quickChat: { totalCount: 0, recentCamps: [] },
      projects: [project('/repo/c'), project('/repo/a'), project('/repo/b')]
    }

    const displayed = navigationWithProjectOrder(navigation, [
      projectTargetKey('/repo/b'),
      projectTargetKey('/repo/a')
    ])

    expect(displayed?.projects.map((candidate) => candidate.projectPath))
      .toEqual(['/repo/b', '/repo/a', '/repo/c'])
    expect(navigation.projects.map((candidate) => candidate.projectPath))
      .toEqual(['/repo/c', '/repo/a', '/repo/b'])
    expect(navigationWithProjectOrder(navigation, null)).toBe(navigation)
  })

  it('appends a newly selected empty Project after the existing Project order', () => {
    const navigation: NavigationSnapshot = {
      schemaVersion: 3,
      throughGlobalSequence: 7,
      quickChat: { totalCount: 0, recentCamps: [] },
      projects: [project('/repo/existing')]
    }
    const displayed = navigationIncludingCurrentWorkspace(
      navigation,
      { kind: 'directory', projectPath: '/repo/new' },
      { name: 'new', projectPath: '/repo/new' }
    )

    expect(displayed?.projects.map((candidate) => candidate.projectPath))
      .toEqual(['/repo/existing', '/repo/new'])
  })

  it('keeps Project navigation hidden until removed authority is ready', () => {
    const navigation: NavigationSnapshot = {
      schemaVersion: 3,
      throughGlobalSequence: 7,
      quickChat: { totalCount: 1, recentCamps: [] },
      projects: [project('/repo/a'), project('/repo/b')]
    }

    expect(navigationWithProjectAuthority(navigation, new Set(), false)?.projects).toEqual([])
    expect(navigationWithProjectAuthority(
      navigation,
      new Set([projectTargetKey('/repo/a')]),
      true
    )?.projects.map((candidate) => candidate.projectPath)).toEqual(['/repo/b'])
  })

  it('does not inspect a cached Project until removed-Project authority is ready', () => {
    const navigation: NavigationSnapshot = {
      schemaVersion: 3,
      throughGlobalSequence: 7,
      quickChat: { totalCount: 0, recentCamps: [] },
      projects: []
    }
    const currentProject = { kind: 'directory', projectPath: '/Users/person/Downloads' } as const

    expect(currentProjectAccessDecision({
      currentProject,
      currentWorkspaceHint: null,
      navigation,
      removedProjectKeys: new Set(),
      removedProjectAuthorityReady: false
    })).toBe('wait')
    expect(currentProjectAccessDecision({
      currentProject,
      currentWorkspaceHint: null,
      navigation,
      removedProjectKeys: new Set([projectTargetKey(currentProject.projectPath)]),
      removedProjectAuthorityReady: true
    })).toBe('fallback')
    expect(currentProjectAccessDecision({
      currentProject,
      currentWorkspaceHint: null,
      navigation,
      removedProjectKeys: new Set(),
      removedProjectAuthorityReady: true
    })).toBe('inspect')
    expect(currentProjectAccessDecision({
      currentProject,
      currentWorkspaceHint: { name: 'Downloads', projectPath: currentProject.projectPath },
      navigation,
      removedProjectKeys: new Set(),
      removedProjectAuthorityReady: true
    })).toBe('keep_hint')
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

  it('waits for the authoritative Member overview before invalidating saved defaults', () => {
    const preferences = configuredPreferences()
    expect(shouldInvalidateNewConversationDefaults(preferences, [], false)).toBe(false)
    expect(shouldInvalidateNewConversationDefaults(preferences, [], true)).toBe(true)
  })
})

function configuredPreferences(): GeneralPreferencesSnapshot {
  return {
    schemaVersion: 4,
    startupLocationMode: 'last_location',
    lastSettingsSection: 'general',
    executionConsolePlacement: 'bottom',
    newConversationDefaults: {
      memberAgentIds: ['agent-a', 'agent-b'],
      defaultLeadAgentId: 'agent-a'
    },
    newConversationDefaultsRequireConfirmation: false,
    oneClickNewConversationEnabled: true,
    worldMapEnabled: true
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

function project(projectPath: string): NavigationSnapshot['projects'][number] {
  return {
    projectKey: projectTargetKey(projectPath),
    name: projectPath.split('/').at(-1) ?? projectPath,
    projectPath,
    lastActivityAt: '2026-08-09T00:00:00Z',
    lastActivityGlobalSequence: 1,
    totalCount: 0,
    recentCamps: []
  }
}
