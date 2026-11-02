import type { AgentRunView, AgentRunExecutionEvidenceView } from '@contracts'
import { liveRuntimeEventFromExecutionEvidence, type LiveRuntimeEvent } from './ui-model'

export function groupExecutionEventsByRunId(
  runs: readonly Pick<AgentRunView, 'id'>[],
  executionEvidence: readonly AgentRunExecutionEvidenceView[],
  liveRuntimeEvents: readonly LiveRuntimeEvent[]
): Map<string, LiveRuntimeEvent[]> {
  const currentRunIds = new Set(runs.map((run) => run.id))
  const grouped = new Map<string, Map<string, LiveRuntimeEvent>>()
  const blockState = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}

  const append = (event: LiveRuntimeEvent, authoritative: boolean): void => {
    if (!currentRunIds.has(event.agentRunId)) return

    let eventsById = grouped.get(event.agentRunId)
    if (!eventsById) {
      eventsById = new Map<string, LiveRuntimeEvent>()
      grouped.set(event.agentRunId, eventsById)
    }

    const previous = eventsById.get(event.id)
    const previousRevision = previous?.revision ?? 0
    const incomingRevision = event.revision ?? 0
    const previousChange = previous?.changeSequence ?? 0
    const incomingChange = event.changeSequence ?? 0
    const newer = Boolean(previous) && (incomingRevision > previousRevision
      || (incomingRevision === previousRevision && incomingChange > previousChange))
    const older = Boolean(previous) && (incomingRevision < previousRevision
      || (incomingRevision === previousRevision && incomingChange < previousChange))
    const blockUpdate = event.eventType === 'agent.text.block' && previous
      && (blockState(previous.payload).status === 'streaming')
      && (blockState(event.payload).status !== 'streaming'
        || Number(blockState(event.payload).textLength) >= Number(blockState(previous.payload).textLength))
    if (!previous || newer || (!older && blockUpdate) || (authoritative && !older)) {
      eventsById.set(event.id, {
        ...event,
        sequence: previous?.sequence ?? event.sequence,
        // Legacy live events do not carry a sequence. Even for those, result
        // updates must retain the invocation's first recorded position.
        createdAt: previous && previous.createdAt < event.createdAt ? previous.createdAt : event.createdAt
      })
    }
  }

  for (const evidence of executionEvidence) {
    append(liveRuntimeEventFromExecutionEvidence(evidence), true)
  }
  for (const event of liveRuntimeEvents) {
    append(event, false)
  }

  return new Map([...grouped.entries()].map(([runId, eventsById]) => {
    const sequence = (event: LiveRuntimeEvent): number | undefined => event.sequence ?? event.canonical?.firstEvidenceSequence
    const recorded = [...eventsById.values()].filter(event => sequence(event) != null)
      .sort((left, right) => sequence(left)! - sequence(right)!)
    const legacy = [...eventsById.values()].filter(event => sequence(event) == null)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    // Keep the durable order even when old, unsequenced notifications coexist.
    // Comparing some pairs by sequence and others by time is not transitive.
    const events: LiveRuntimeEvent[] = []
    let nextLegacy = 0
    for (const event of recorded) {
      while (nextLegacy < legacy.length && legacy[nextLegacy].createdAt < event.createdAt) {
        events.push(legacy[nextLegacy++])
      }
      events.push(event)
    }
    events.push(...legacy.slice(nextLegacy))
    return [runId, events]
  }))
}
