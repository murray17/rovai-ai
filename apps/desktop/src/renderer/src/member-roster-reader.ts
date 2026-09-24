import type { AgentProfile } from '@contracts'

/** Serializes roster reads and commits only the result of the latest refresh intent. */
export function createMemberRosterReader(
  read: () => Promise<AgentProfile[]>,
  commit: (agents: AgentProfile[]) => void
): { refresh(): Promise<AgentProfile[]> } {
  let requestedGeneration = 0
  let inFlight: Promise<AgentProfile[]> | null = null

  return {
    refresh(): Promise<AgentProfile[]> {
      requestedGeneration += 1
      if (inFlight) return inFlight

      const request = (async (): Promise<AgentProfile[]> => {
        while (true) {
          const generation = requestedGeneration
          let agents: AgentProfile[]
          try {
            agents = await read()
          } catch (error) {
            // A later invalidation supersedes this failure and still needs a read.
            if (generation !== requestedGeneration) continue
            throw error
          }
          if (generation !== requestedGeneration) continue
          commit(agents)
          if (generation === requestedGeneration) return agents
        }
      })()
      inFlight = request
      void request.finally(() => {
        if (inFlight === request) inFlight = null
      }).catch(() => undefined)
      return request
    }
  }
}
