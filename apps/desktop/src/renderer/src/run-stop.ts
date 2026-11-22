import type { AgentRunView, StoredCommandResult } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import type { ThreadClient } from './camp-client'

/** A new ID is safe only after Core has explicitly rejected the previous stop. */
export async function requestRunStop(
  client: Pick<ThreadClient, 'request'>,
  threadId: string,
  run: Pick<AgentRunView, 'id' | 'version'>,
  refreshVersion: () => Promise<number | null>
): Promise<StoredCommandResult> {
  const stop = (expectedVersion: number): Promise<StoredCommandResult> =>
    client.request('agentRuns.cancel', {
      commandId: newCommandId(),
      command: { threadId, agentRunId: run.id, expectedVersion }
    })
  const result = await stop(run.version)
  if (result.status !== 'rejected' || result.code !== 'command.version_conflict') return result

  const currentVersion = await refreshVersion().catch(() => null)
  return currentVersion !== null && currentVersion > run.version ? stop(currentVersion) : result
}
