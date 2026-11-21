import { expect, it, vi } from 'vitest'
import type { StoredCommandResult } from '@contracts'
import { requestRunStop } from './run-stop'

const conflict = { status: 'rejected', code: 'command.version_conflict' } as StoredCommandResult
const terminal = { status: 'applied', code: 'agent_run.already_terminal' } as StoredCommandResult
const run = { id: 'run', version: 11 }

it('uses a fresh command ID and the refreshed version exactly once on a deterministic conflict', async () => {
  const request = vi.fn().mockResolvedValue(conflict)
  const refreshVersion = vi.fn().mockResolvedValue(12)
  await expect(requestRunStop({ request }, 'thread', run, refreshVersion)).resolves.toBe(conflict)
  expect(refreshVersion).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls.map(([method, input]) => [method, input.command])).toEqual([
    ['agentRuns.cancel', { threadId: 'thread', agentRunId: 'run', expectedVersion: 11 }],
    ['agentRuns.cancel', { threadId: 'thread', agentRunId: 'run', expectedVersion: 12 }]
  ])
  expect(request.mock.calls[0][1].commandId).not.toBe(request.mock.calls[1][1].commandId)
})

it('returns a terminal receipt and never resubmits after a read failure or an unknown write result', async () => {
  const request = vi.fn().mockResolvedValueOnce(conflict).mockResolvedValueOnce(terminal)
  await expect(requestRunStop({ request }, 'thread', run, async () => 12)).resolves.toBe(terminal)
  const unavailable = new Error('connection interrupted')
  request.mockReset().mockResolvedValueOnce(conflict).mockRejectedValueOnce(unavailable)
  await expect(requestRunStop({ request }, 'thread', run, async () => { throw unavailable })).resolves.toBe(conflict)
  const refresh = vi.fn().mockResolvedValue(12)
  await expect(requestRunStop({ request }, 'thread', run, refresh)).rejects.toBe(unavailable)
  expect(refresh).not.toHaveBeenCalled()
  expect(request).toHaveBeenCalledTimes(2)
})
