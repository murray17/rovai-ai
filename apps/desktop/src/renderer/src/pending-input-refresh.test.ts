import { expect, it, vi } from 'vitest'
import type { CampPendingInputsView } from '@contracts'
import { createPendingInputsRefresh, shouldRefreshPendingInputs } from './pending-input-refresh'

const queue: CampPendingInputsView = { campId: 'camp', executionActive: true, items: [], editSession: null }

it('coalesces bursts, rereads invalidated in-flight data and commits only a changed authority', async () => {
  let release!: (value: CampPendingInputsView) => void
  const latest = { ...queue, executionActive: false }
  const load = vi.fn<() => Promise<CampPendingInputsView>>()
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    .mockResolvedValue(latest)
  const commit = vi.fn()
  const reader = createPendingInputsRefresh(load, commit)
  const first = reader.refresh()
  expect(reader.refresh()).toBe(first)
  await Promise.resolve()
  expect(load).toHaveBeenCalledTimes(1)
  expect(reader.refresh()).toBe(first)
  expect(reader.refresh()).toBe(first)
  release(queue)
  await first
  expect(load).toHaveBeenCalledTimes(2)
  expect(commit).toHaveBeenCalledExactlyOnceWith(latest)
  await reader.refresh()
  expect(commit).toHaveBeenCalledTimes(1)
  reader.dispose()
})

it('recovers on the next notification after an error and ignores reads from an unmounted Camp', async () => {
  let release!: (value: CampPendingInputsView) => void
  const load = vi.fn<() => Promise<CampPendingInputsView>>()
    .mockRejectedValueOnce(new Error('Core restarting'))
    .mockResolvedValueOnce(queue)
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const commit = vi.fn()
  const reader = createPendingInputsRefresh(load, commit)
  await expect(reader.refresh()).rejects.toThrow('Core restarting')
  await reader.refresh()
  const pending = reader.refresh()
  await Promise.resolve()
  reader.dispose()
  release({ ...queue, executionActive: false })
  await pending
  await reader.refresh()
  expect(commit).toHaveBeenCalledExactlyOnceWith(queue)
  expect(load).toHaveBeenCalledTimes(3)
})

it('reads only for this Camp’s queue and execution changes or a Core reconnection', () => {
  for (const reason of ['enqueued', 'edited', 'published', 'publication_failed']) {
    expect(shouldRefreshPendingInputs({ method: 'camp.pendingInputs.changed', params: { campId: 'camp', reason } }, 'camp')).toBe(true)
    expect(shouldRefreshPendingInputs({ method: 'camp.pendingInputs.changed', params: { campId: 'other', reason } }, 'camp')).toBe(false)
  }
  for (const reason of ['agent_run.terminal', 'agent_run.started', 'campTurns.cancel', 'agentRuns.cancel']) {
    expect(shouldRefreshPendingInputs({ method: 'navigation.invalidated', params: { campId: 'camp', reason } }, 'camp')).toBe(true)
  }
  expect(shouldRefreshPendingInputs({ method: 'navigation.invalidated', params: { campId: 'camp', reason: 'navigation.campViewed' } }, 'camp')).toBe(false)
  expect(shouldRefreshPendingInputs({ method: 'agent.thought.delta', params: { campId: 'camp' } }, 'camp')).toBe(false)
  expect(shouldRefreshPendingInputs({ method: 'runtime.state', params: { status: 'ready' } }, 'camp')).toBe(true)
  expect(shouldRefreshPendingInputs({ method: 'runtime.state', params: { status: 'restarting' } }, 'camp')).toBe(false)
})
