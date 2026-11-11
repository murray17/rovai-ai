import { describe, expect, it, vi } from 'vitest'
import type { StoredCommandResult } from '@contracts'
import { ThreadForkOperation } from './thread-fork'
import type { ThreadClient } from './camp-client'

const request = { commandId: 'one', sourceThreadId: 'source', sourceMessageId: 'anchor' }
const result = (status: StoredCommandResult['status'] = 'applied'): StoredCommandResult => ({
  commandId: 'one', commandType: 'camp.fork', status, code: status === 'rejected' ? 'camp.fork_anchor_unavailable' : 'camp.forked',
  payload: status === 'rejected' ? {} : { threadId: 'copy' }, resultEntity: null, recordedAt: 'now'
})
function storage() {
  const items = new Map<string, string>()
  return { items, getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value) }, removeItem: (key: string) => { items.delete(key) } }
}
const client = (request: ReturnType<typeof vi.fn>) => ({ request }) as Pick<ThreadClient, 'request'>

describe('foreground Thread fork recovery', () => {
  it('shares in-flight state, freezes identifiers, and saves the target before returning success', async () => {
    let finish!: (value: StoredCommandResult) => void
    const dispatch = vi.fn(() => new Promise<StoredCommandResult>(resolve => { finish = resolve }))
    const store = storage(), operation = new ThreadForkOperation(client(dispatch), 'profile:host:owner', store)
    const first = operation.start(request)
    expect(operation.getSnapshot().phase).toBe('pending')
    expect(await operation.start({ commandId: 'other', sourceThreadId: 'other' })).toBeNull()
    expect([...store.items.values()].map(value => JSON.parse(value))).toEqual([request])
    finish(result())
    expect(await first).toBe('copy')
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('threads.fork', request)
    expect([...store.items.values()].map(value => JSON.parse(value))).toEqual([{ ...request, threadId: 'copy' }])
    operation.persistTarget(); operation.persistTarget()
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('refresh confirms the original receipt and never submits another copy', async () => {
    const store = storage()
    const failed = vi.fn().mockRejectedValue(new Error('timeout'))
    const original = new ThreadForkOperation(client(failed), 'same', store)
    await original.start(request)
    expect(original.getSnapshot().phase).toBe('unknown')
    const restoredRequest = vi.fn().mockResolvedValue({ state: 'recorded', result: result() })
    const restored = new ThreadForkOperation(client(restoredRequest), 'same', store)
    await restored.recover(); await restored.recover()
    expect(restoredRequest).toHaveBeenCalledExactlyOnceWith('commands.reconcile', { operation: 'threads.fork', params: request })
    expect(restored.persistTarget()).toBe('copy')
    const fresh = new ThreadForkOperation(client(restoredRequest), 'different-host', store)
    expect(fresh.getSnapshot().phase).toBe('idle')
  })

  it('unknown receipt requires explicit retry with identical input; rejection permits a fresh ID', async () => {
    const store = storage(), first = vi.fn().mockRejectedValue(new Error('timeout'))
    await new ThreadForkOperation(client(first), 'same', store).start(request)
    const dispatch = vi.fn().mockResolvedValueOnce({ state: 'unknown' })
      .mockResolvedValueOnce({ state: 'unknown' }).mockResolvedValueOnce(result('rejected')).mockResolvedValueOnce(result())
    const restored = new ThreadForkOperation(client(dispatch), 'same', store)
    await restored.recover()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(await restored.start({ commandId: 'accidental', sourceThreadId: 'different' })).toBeNull()
    await restored.retry()
    expect(dispatch.mock.calls[2]).toEqual(['threads.fork', request])
    expect(restored.getSnapshot().phase).toBe('rejected')
    expect(store.items.size).toBe(0)
    await restored.start({ ...request, commandId: 'fixed-condition' })
    expect(dispatch.mock.calls[3]).toEqual(['threads.fork', { ...request, commandId: 'fixed-condition' }])
  })

  it('storage failures stop initial submission and preserve a known target for opening retry', async () => {
    const store = storage(), dispatch = vi.fn().mockResolvedValue(result())
    const originalSet = store.setItem
    store.setItem = () => { throw new Error('storage unavailable') }
    const operation = new ThreadForkOperation(client(dispatch), 'same', store)
    await operation.start(request)
    expect(dispatch).not.toHaveBeenCalled()
    let writes = 0
    store.setItem = (key, value) => { if (++writes > 1) throw new Error('full'); originalSet(key, value) }
    expect(await operation.start(request)).toBeNull()
    expect(operation.getSnapshot().saved?.threadId).toBe('copy')
    expect(() => operation.persistTarget()).toThrow('full')
    expect(await operation.retry()).toBeNull()
    store.setItem = originalSet
    expect(operation.persistTarget()).toBe('copy')
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
