import { describe, expect, it, vi } from 'vitest'
import type { AgentProfile } from '@contracts'
import { createMemberRosterReader } from './member-roster-reader'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const roster = (id: string): AgentProfile[] => [{ agentId: id } as AgentProfile]

describe('member roster refresh', () => {
  it('retains the visible roster and drains an invalidation that arrives during a read', async () => {
    const first = deferred<AgentProfile[]>()
    const second = deferred<AgentProfile[]>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const commit = vi.fn()
    const reader = createMemberRosterReader(read, commit)

    const initial = reader.refresh()
    expect(read).toHaveBeenCalledTimes(1)
    const invalidated = reader.refresh()
    expect(invalidated).toBe(initial)
    first.resolve(roster('old'))
    await Promise.resolve()
    expect(commit).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(2)

    second.resolve(roster('new'))
    await invalidated
    expect(commit).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith(roster('new'))
  })

  it('coalesces rapid changes and retries after a superseded failure', async () => {
    const first = deferred<AgentProfile[]>()
    const second = deferred<AgentProfile[]>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const commit = vi.fn()
    const reader = createMemberRosterReader(read, commit)

    const refreshed = reader.refresh()
    reader.refresh()
    reader.refresh()
    first.reject(new Error('outdated read failed'))
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(2)
    expect(commit).not.toHaveBeenCalled()
    second.resolve(roster('latest'))
    await expect(refreshed).resolves.toEqual(roster('latest'))
    expect(commit).toHaveBeenCalledExactlyOnceWith(roster('latest'))
  })
})
