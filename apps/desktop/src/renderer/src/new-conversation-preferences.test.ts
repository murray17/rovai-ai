import { EMPTY_SNAPSHOT } from '../../shared/navigation-preferences-model'
import { describe, expect, it } from 'vitest'
import type {
  AgentProfile,
  GeneralPreferencesSnapshot,
  NavigationThreadItem,
  NavigationSnapshot
} from '@contracts'
import {
  currentProjectAccessDecision,
  currentProjectForThread,
  currentProjectWorkspace,
  defaultsNeedInvalidation,
  navigationIncludingCurrentWorkspace,
  navigationWithProjectDirectories,
  navigationWithProjectOrder,
  parseCurrentProject,
  projectTargetKey,
  resolveNewConversationDefaults,
  resolveAvailableNewConversationDefaults,
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

  it('derives the current Project from a Thread without coupling it to disclosure state', () => {
    expect(currentProjectForThread(thread('directory', '/repo')))
      .toEqual({ kind: 'directory', projectPath: '/repo' })
    expect(currentProjectForThread(thread('quick_chat', '/quick-chat')))
      .toEqual({ kind: 'quick_chat' })
    expect(currentProjectForThread({ ...thread('directory', '/repo'), navigationGroupKey: 'chat-bot' }))
      .toEqual({ kind: 'quick_chat' })
  })

  it('keeps a validated current workspace visible when it has no navigable Threads', () => {
    const navigation: NavigationSnapshot = {
      schemaVersion: 3,
      throughGlobalSequence: 7,
      quickChat: { totalCount: 0, recentThreads: [] },
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
      recentThreads: []
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
      quickChat: { totalCount: 1, recentThreads: [] },
      chatBot: { totalCount: 1, recentThreads: [{
        ...thread('directory', '/repo/a'), navigationGroupKey: 'chat-bot', id: 'bot', title: 'Bot',
        activationState: 'active', defaultLead: null, marker: 'none', lastActivityAt: '',
        lastActivityGlobalSequence: 0, latestCompletionGlobalSequence: 0, version: 1
      }] },
      projects: [
        project('/repo/a'),
        project('/repo/b')
      ]
    }

    const displayed = navigationWithProjectDirectories(
      navigation,
      { ...EMPTY_SNAPSHOT, removedProjects: [{ targetKey: projectTargetKey('/repo/a'), removedAt: '2026-10-01T00:00:00Z' }] }
    )

    expect(displayed?.quickChat).toBe(navigation.quickChat)
    expect(displayed?.chatBot).toBe(navigation.chatBot)
    expect(displayed?.projects.map((candidate) => candidate.projectPath)).toEqual(['/repo/b'])
    expect(navigation.projects).toHaveLength(2)
  })

  it('projects the persisted Project order without mutating the activity-sorted snapshot', () => {
    const navigation: NavigationSnapshot = {
      schemaVersion: 3,
      throughGlobalSequence: 7,
      quickChat: { totalCount: 0, recentThreads: [] },
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
      quickChat: { totalCount: 0, recentThreads: [] },
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

  it('keeps legacy projects visible until preferences load and honors known removals', () => {
    const navigation: NavigationSnapshot = {
      schemaVersion: 3,
      throughGlobalSequence: 7,
      quickChat: { totalCount: 1, recentThreads: [] },
      projects: [project('/repo/a'), project('/repo/b')]
    }

    expect(navigationWithProjectDirectories(navigation, null)?.projects).toEqual(navigation.projects)
    expect(navigationWithProjectDirectories(
      navigation,
      { ...EMPTY_SNAPSHOT, removedProjects: [{ targetKey: projectTargetKey('/repo/a'), removedAt: '2026-10-01T00:00:00Z' }] }
    )?.projects.map((candidate) => candidate.projectPath)).toEqual(['/repo/b'])
  })

  it('does not inspect a cached Project until removed-Project authority is ready', () => {
    const navigation: NavigationSnapshot = {
      schemaVersion: 3,
      throughGlobalSequence: 7,
      quickChat: { totalCount: 0, recentThreads: [] },
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

  it('blocks one-click for unsaved or unavailable runtimes and recovers without invalidating the team', () => {
    const preferences = configuredPreferences()
    const members = ['agent-a', 'agent-b'].map(id => profile(id, 'present'))
    for (const member of members) {
      member.runtimeConfiguration = {
        adapterKind: 'codex-cli', model: { mode: 'runtime_default' },
        permissions: { adapterKind: 'codex-cli', schemaVersion: 1,
          values: { sandbox_mode: 'workspace-write', approval_policy: 'on-request' } }
      }
      member.runtimeReadiness.status = 'light_ready'
    }
    members[1].runtimeReadiness.status = 'ready'
    expect(resolveAvailableNewConversationDefaults(preferences, members)?.lead.agentId).toBe('agent-a')
    members[1].runtimeReadiness.status = 'needs_attention'
    expect(resolveAvailableNewConversationDefaults(preferences, members)).toBeNull()
    expect(defaultsNeedInvalidation(preferences, members)).toBe(false)
    members[1].runtimeReadiness.status = 'light_ready'
    expect(resolveAvailableNewConversationDefaults(preferences, members)?.members).toHaveLength(2)
    members[1].runtimeConfiguration = null
    expect(resolveAvailableNewConversationDefaults(preferences, members)).toBeNull()
    expect(defaultsNeedInvalidation(preferences, members)).toBe(false)
  })

  it('waits for the authoritative Member overview before invalidating saved defaults', () => {
    const preferences = configuredPreferences()
    expect(shouldInvalidateNewConversationDefaults(preferences, [], false)).toBe(false)
    expect(shouldInvalidateNewConversationDefaults(preferences, [], true)).toBe(true)
  })
})

function configuredPreferences(): GeneralPreferencesSnapshot {
  return {
    schemaVersion: 7,
      newConversationTeamId: null,
      interfaceLanguagePreference: 'zh-CN', systemLanguage: 'en', languageRevision: 0, readError: null,
    interfaceLanguage: 'zh-CN',
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

function thread(
  projectBindingKind: NavigationThreadItem['projectBindingKind'],
  projectPath: string
): Pick<NavigationThreadItem, 'projectBindingKind' | 'projectPath'> {
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
    recentThreads: []
  }
}

it('uses the saved directory list after completion and legacy groups only before completion', () => {
  const group = (path: string) => ({ projectKey: `directory:${path}`, projectPath: path, name: path, totalCount: 0, recentThreads: [], lastActivityAt: '', lastActivityGlobalSequence: 0 })
  const navigation: NavigationSnapshot = { schemaVersion: 3, throughGlobalSequence: 0, quickChat: { totalCount: 0, recentThreads: [] }, projects: [group('/old'), group('/removed')] }
  const preferences = { ...EMPTY_SNAPSHOT, registeredProjects: ['/empty'], removedProjects: [{ targetKey: 'directory:/removed', removedAt: '2026-10-01T00:00:00Z' }] }
  expect(navigationWithProjectDirectories(navigation, preferences)?.projects.map(p => p.projectPath)).toEqual(['/empty', '/old'])
  preferences.legacyProjectsSynced = true
  expect(navigationWithProjectDirectories(navigation, preferences)?.projects.map(p => p.projectPath)).toEqual(['/empty'])
  expect(navigationWithProjectDirectories(navigation, { ...preferences, registeredProjects: [] })?.projects).toEqual([])
})
