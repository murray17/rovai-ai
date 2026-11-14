import { useMemo, type ComponentProps } from 'react'
import type { ThreadSnapshot } from '@contracts'
import { ThreadWorldMap } from './ThreadWorldMap'
import { projectThreadWorldMap } from './camp-world-map-model'
import { useRunSetLiveEvents } from './useRunLiveEvents'
import { groupExecutionEventsByRunId } from './execution-events'
import { buildLiveExecutionProgress, type LiveRuntimeEvent } from './ui-model'

export function LiveThreadWorldMap({ snapshot, eventsByRunId, ...props }: Omit<ComponentProps<typeof ThreadWorldMap>,
  'threadId' | 'agents' | 'rendezvous'> & { snapshot: ThreadSnapshot; eventsByRunId: Map<string, LiveRuntimeEvent[]> }) {
  const live = useRunSetLiveEvents(snapshot.thread.id, snapshot.agentRuns, Boolean(props.active))
  const projection = useMemo(() => {
    const progress = new Map(snapshot.agentRuns.map(run => {
      const events = groupExecutionEventsByRunId([run], [], [...eventsByRunId.get(run.id) ?? [], ...live.get(run.id) ?? []]).get(run.id) ?? []
      return [run.id, buildLiveExecutionProgress(events.slice(-48), run.id, { includePublicResults: false })] as const
    }))
    return projectThreadWorldMap(snapshot.members, snapshot.agentRuns, progress)
  }, [snapshot.members, snapshot.agentRuns, eventsByRunId, live])
  return <ThreadWorldMap {...props} threadId={snapshot.thread.id} agents={projection.agents} rendezvous={projection.rendezvous} />
}
