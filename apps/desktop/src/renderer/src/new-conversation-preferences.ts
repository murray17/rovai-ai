import { isNewConversationMemberAvailable } from './new-conversation-availability'
import type {
  AgentProfile,
  Team,
  TeamSelection,
  GeneralPreferencesSnapshot,
  NavigationThreadItem,
  NavigationSnapshot,
  NavigationPreferencesSnapshot,
  NewConversationDefaults,
  ProjectNavigationGroup,
  WorkspaceSelection
} from '@contracts'

export const CURRENT_PROJECT_STORAGE_KEY = 'rovai.current-project.v1'

export type CurrentProject =
  | { kind: 'quick_chat' }
  | { kind: 'directory'; projectPath: string }

export type CurrentProjectAccessDecision =
  | 'wait'
  | 'fallback'
  | 'clear_hint'
  | 'keep_hint'
  | 'inspect'

export interface CurrentProjectAccessInput {
  currentProject: CurrentProject
  currentWorkspaceHint: WorkspaceSelection | null
  navigation: NavigationSnapshot | null
  removedProjectKeys: ReadonlySet<string>
  removedProjectAuthorityReady: boolean
}

export interface ResolvedNewConversationDefaults {
  defaults: NewConversationDefaults
  team?: TeamSelection
  members: AgentProfile[]
  lead: AgentProfile
}

export function parseCurrentProject(value: string | null): CurrentProject {
  if (!value) return { kind: 'quick_chat' }
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { kind: 'quick_chat' }
    }
    const record = parsed as Record<string, unknown>
    if (record.kind === 'quick_chat' && Object.keys(record).length === 1) {
      return { kind: 'quick_chat' }
    }
    if (
      record.kind === 'directory'
      && typeof record.projectPath === 'string'
      && record.projectPath.length > 0
      && Object.keys(record).length === 2
    ) {
      return { kind: 'directory', projectPath: record.projectPath }
    }
  } catch {
    // A damaged renderer preference safely falls back to Quick Chat.
  }
  return { kind: 'quick_chat' }
}

export function readCurrentProject(): CurrentProject {
  try {
    return parseCurrentProject(window.localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY))
  } catch {
    return { kind: 'quick_chat' }
  }
}

export function persistCurrentProject(currentProject: CurrentProject): void {
  try {
    window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, JSON.stringify(currentProject))
  } catch {
    // The current window still keeps its in-memory selection when storage is blocked.
  }
}

export function currentProjectForThread(thread: Pick<NavigationThreadItem, 'projectBindingKind' | 'projectPath' | 'navigationGroupKey'>): CurrentProject {
  return thread.navigationGroupKey !== 'chat-bot' && thread.projectBindingKind === 'directory'
    ? { kind: 'directory', projectPath: thread.projectPath }
    : { kind: 'quick_chat' }
}

export function projectTargetKey(projectPath: string): string {
  return `directory:${projectPath}`
}

export function navigationWithProjectOrder(
  navigation: NavigationSnapshot | null,
  projectOrder: readonly string[] | null
): NavigationSnapshot | null {
  if (!navigation || projectOrder === null || navigation.projects.length < 2) return navigation
  const orderByProjectKey = new Map(
    projectOrder.map((projectKey, index) => [projectKey, index])
  )
  const originalIndexByProjectKey = new Map(
    navigation.projects.map((project, index) => [project.projectKey, index])
  )
  const projects = [...navigation.projects].sort((left, right) => {
    const leftOrder = orderByProjectKey.get(left.projectKey)
    const rightOrder = orderByProjectKey.get(right.projectKey)
    if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder
    if (leftOrder !== undefined) return -1
    if (rightOrder !== undefined) return 1
    return (originalIndexByProjectKey.get(left.projectKey) ?? 0)
      - (originalIndexByProjectKey.get(right.projectKey) ?? 0)
  })
  return projects.every((project, index) => project === navigation.projects[index])
    ? navigation
    : { ...navigation, projects }
}

// Display overrides never mutate Core snapshots, workspace bindings, or Thread identity.
export function navigationWithProjectNames(
  navigation: NavigationSnapshot | null,
  projectNames: Readonly<Record<string, string>>
): NavigationSnapshot | null {
  if (!navigation) return null
  const projects = navigation.projects.map((project) => {
    const name = projectNames[project.projectKey] ?? project.name
    return name === project.name ? project : { ...project, name }
  })
  return projects.every((project, index) => project === navigation.projects[index])
    ? navigation
    : { ...navigation, projects }
}

export function currentProjectGroup(
  navigation: NavigationSnapshot | null,
  currentProject: CurrentProject
): ProjectNavigationGroup | null {
  if (!navigation || currentProject.kind === 'quick_chat') return null
  return navigation.projects.find((project) => project.projectPath === currentProject.projectPath) ?? null
}

export function currentProjectExists(
  navigation: NavigationSnapshot | null,
  currentProject: CurrentProject
): boolean {
  return currentProject.kind === 'quick_chat'
    || currentProjectGroup(navigation, currentProject) !== null
}

export function currentProjectWorkspace(
  navigation: NavigationSnapshot | null,
  currentProject: CurrentProject
): WorkspaceSelection | null {
  const project = currentProjectGroup(navigation, currentProject)
  return project ? { name: project.name, projectPath: project.projectPath } : null
}

export function currentProjectAccessDecision({
  currentProject,
  currentWorkspaceHint,
  navigation,
  removedProjectKeys,
  removedProjectAuthorityReady
}: CurrentProjectAccessInput): CurrentProjectAccessDecision {
  if (!navigation || !removedProjectAuthorityReady) return 'wait'
  if (currentProject.kind === 'quick_chat') return 'clear_hint'
  if (removedProjectKeys.has(projectTargetKey(currentProject.projectPath))) return 'fallback'
  if (currentProjectGroup(navigation, currentProject)) return 'clear_hint'
  if (currentWorkspaceHint?.projectPath === currentProject.projectPath) return 'keep_hint'
  return 'inspect'
}

export function navigationIncludingCurrentWorkspace(
  navigation: NavigationSnapshot | null,
  currentProject: CurrentProject,
  currentWorkspace: WorkspaceSelection | null
): NavigationSnapshot | null {
  if (
    !navigation
    || currentProject.kind !== 'directory'
    || currentProjectGroup(navigation, currentProject)
    || currentWorkspace?.projectPath !== currentProject.projectPath
  ) return navigation

  const emptyProject: ProjectNavigationGroup = {
    projectKey: projectTargetKey(currentWorkspace.projectPath),
    name: currentWorkspace.name,
    projectPath: currentWorkspace.projectPath,
    lastActivityAt: '',
    lastActivityGlobalSequence: 0,
    totalCount: 0,
    recentThreads: []
  }
  return {
    ...navigation,
    projects: [...navigation.projects, emptyProject]
  }
}

export function resolveNewConversationDefaults(
  preferences: GeneralPreferencesSnapshot | null,
  agents: AgentProfile[],
  teams: Team[] = []
): ResolvedNewConversationDefaults | null {
  const team = preferences?.newConversationTeamId ? teams.find(team => team.id === preferences.newConversationTeamId) : undefined
  const defaults = preferences?.newConversationTeamId ? team : preferences?.newConversationDefaults
  if (!defaults || preferences?.newConversationDefaultsRequireConfirmation) return null
  const profileById = new Map(agents.map((agent) => [agent.agentId, agent]))
  const members = defaults.memberAgentIds.flatMap((agentId) => {
    const agent = profileById.get(agentId)
    return agent ? [agent] : []
  })
  if (
    members.length !== defaults.memberAgentIds.length
    || members.some((agent) => agent.presence !== 'present' || agent.removedAt !== null)
  ) return null
  const lead = profileById.get(defaults.defaultLeadAgentId)
  if (
    !lead
    || lead.presence !== 'present'
    || lead.removedAt !== null
    || !defaults.memberAgentIds.includes(lead.agentId)
  ) return null
  return { defaults, members, lead, ...(team ? { team: { teamId: team.id, expectedVersion: team.version } } : {}) }
}

// A temporary runtime outage blocks one-click creation without invalidating the saved team.
export function resolveAvailableNewConversationDefaults(
  preferences: GeneralPreferencesSnapshot | null,
  agents: AgentProfile[],
  teams: Team[] = []
): ResolvedNewConversationDefaults | null {
  const resolved = resolveNewConversationDefaults(preferences, agents, teams)
  return resolved?.members.every((agent) => isNewConversationMemberAvailable({
    runtimeConfigured: agent.runtimeConfiguration !== null,
    runtimeReadiness: agent.runtimeReadiness.status
  })) ? resolved : null
}

export function defaultsNeedInvalidation(
  preferences: GeneralPreferencesSnapshot | null,
  agents: AgentProfile[],
  teams: Team[] = []
): boolean {
  return Boolean(
    (preferences?.newConversationDefaults || preferences?.newConversationTeamId)
    && !preferences?.newConversationDefaultsRequireConfirmation
    && !resolveNewConversationDefaults(preferences, agents, teams)
  )
}

export function shouldInvalidateNewConversationDefaults(
  preferences: GeneralPreferencesSnapshot | null,
  agents: AgentProfile[],
  overviewReady: boolean,
  teams: Team[] = []
): boolean {
  return overviewReady && defaultsNeedInvalidation(preferences, agents, teams)
}

/** Saved directories own membership after the single legacy import. Before it,
 * ordinary Core groups remain visible. */
export function navigationWithProjectDirectories(
  navigation: NavigationSnapshot | null,
  preferences: NavigationPreferencesSnapshot | null
): NavigationSnapshot | null {
  if (!navigation && !preferences?.registeredProjects.length) return null
  const source = navigation ?? { schemaVersion: 3, throughGlobalSequence: 0, quickChat: { totalCount: 0, recentThreads: [] }, projects: [] }
  const groups = new Map(source.projects.map(project => [project.projectPath, project]))
  const removed = new Set(preferences?.removedProjects.map(project => project.targetKey) ?? [])
  const paths = new Set([
    ...(preferences?.registeredProjects ?? []),
    ...(!preferences?.legacyProjectsSynced || preferences.readError ? groups.keys() : [])
  ])
  return { ...source, projects: [...paths].filter(path => !removed.has(projectTargetKey(path))).map(projectPath => groups.get(projectPath) ?? {
    projectKey: projectTargetKey(projectPath), projectPath,
    name: projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? projectPath,
    totalCount: 0, recentThreads: [], lastActivityAt: '', lastActivityGlobalSequence: 0
  }) }
}
