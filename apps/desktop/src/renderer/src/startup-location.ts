import type {
  AgentProfile,
  DesktopStartupSnapshot,
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
