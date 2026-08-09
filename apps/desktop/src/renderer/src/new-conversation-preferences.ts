import type {
  AgentProfile,
  GeneralPreferencesSnapshot,
  NavigationCampItem,
  NavigationSnapshot,
  NewConversationDefaults,
  ProjectNavigationGroup,
  WorkspaceSelection
} from '@contracts'

export const CURRENT_PROJECT_STORAGE_KEY = 'rovai.current-project.v1'

export type CurrentProject =
  | { kind: 'quick_chat' }
  | { kind: 'directory'; projectPath: string }

export interface ResolvedNewConversationDefaults {
  defaults: NewConversationDefaults
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

export function currentProjectForCamp(camp: Pick<NavigationCampItem, 'projectBindingKind' | 'projectPath'>): CurrentProject {
  return camp.projectBindingKind === 'directory'
    ? { kind: 'directory', projectPath: camp.projectPath }
    : { kind: 'quick_chat' }
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
    projectKey: `directory:${currentWorkspace.projectPath}`,
    name: currentWorkspace.name,
    projectPath: currentWorkspace.projectPath,
    lastActivityAt: '',
    lastActivityGlobalSequence: 0,
    totalCount: 0,
    recentCamps: []
  }
  return {
    ...navigation,
    projects: [emptyProject, ...navigation.projects]
  }
}

export function resolveNewConversationDefaults(
  preferences: GeneralPreferencesSnapshot | null,
  agents: AgentProfile[]
): ResolvedNewConversationDefaults | null {
  const defaults = preferences?.newConversationDefaults
  if (!defaults || preferences.newConversationDefaultsRequireConfirmation) return null
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
  return { defaults, members, lead }
}

export function defaultsNeedInvalidation(
  preferences: GeneralPreferencesSnapshot | null,
  agents: AgentProfile[]
): boolean {
  return Boolean(
    preferences?.newConversationDefaults
    && !preferences.newConversationDefaultsRequireConfirmation
    && !resolveNewConversationDefaults(preferences, agents)
  )
}

export function shouldInvalidateNewConversationDefaults(
  preferences: GeneralPreferencesSnapshot | null,
  agents: AgentProfile[],
  overviewReady: boolean
): boolean {
  return overviewReady && defaultsNeedInvalidation(preferences, agents)
}
