import type {
  AgentProfile,
  DesktopStartupSnapshot,
  NavigationCampPage,
  NavigationSnapshot,
  RestorableLocation
} from '@contracts'

export function startupTargetFromSnapshot(snapshot: DesktopStartupSnapshot): RestorableLocation {
  if (snapshot.startupLocationMode === 'quick_chat') return { kind: 'quick_chat' }
  if (snapshot.restorableLocationStatus !== 'valid' || !snapshot.restorableLocation) {
    return { kind: 'quick_chat' }
  }
  return structuredClone(snapshot.restorableLocation)
}

export function firstManageableAgent(agents: AgentProfile[]): AgentProfile | null {
  return agents.find((agent) => agent.presence === 'present' && agent.removedAt === null)
    ?? agents.find((agent) => agent.presence === 'away' && agent.removedAt === null)
    ?? null
}

export function restoredMemberId(
  requestedAgentId: string | null,
  agents: AgentProfile[]
): string | null {
  if (
    requestedAgentId
    && agents.some((agent) =>
      agent.agentId === requestedAgentId
      && agent.presence !== 'removed'
      && agent.removedAt === null
    )
  ) return requestedAgentId
  return firstManageableAgent(agents)?.agentId ?? null
}

export async function campExistsInAuthoritativeNavigation(
  campId: string,
  navigation: NavigationSnapshot,
  loadPage: (projectPath: string | null, offset: number) => Promise<NavigationCampPage>
): Promise<boolean> {
  const recent = [
    ...navigation.quickChat.recentCamps,
    ...navigation.projects.flatMap((project) => project.recentCamps)
  ]
  if (recent.some((camp) => camp.id === campId)) return true

  const projectPaths: Array<string | null> = [
    null,
    ...navigation.projects.map((project) => project.projectPath)
  ]
  const results = await Promise.all(projectPaths.map(async (projectPath) => {
    let offset = 0
    for (;;) {
      const page = await loadPage(projectPath, offset)
      if (page.schemaVersion !== 2) throw new Error('Navigation group schema is incompatible')
      if (page.camps.some((camp) => camp.id === campId)) return true
      if (page.nextOffset === null) return false
      offset = page.nextOffset
    }
  }))
  return results.some(Boolean)
}
