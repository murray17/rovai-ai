import { describe, expect, it, vi } from 'vitest'
import { ChannelRosterQueries } from './channel-roster'

describe('demanded group roster queries', () => {
  it('shares a pending read and backs off per group until there is new demand', async () => {
    let now = 10_000
    const wake = vi.fn()
    const queries = new ChannelRosterQueries(() => now, wake)
    const read = vi.fn(async () => false)
    const run = () => queries.run('tenant', 'group', read)
    expect(run()).toBe(run())
    await run()
    for (const [attempt, delay] of [5_000, 15_000, 60_000, 300_000, 300_000].entries()) {
      expect(wake).toHaveBeenLastCalledWith(delay)
      now += delay - 1
      expect(await run()).toBe(false)
      expect(read).toHaveBeenCalledTimes(attempt + 1)
      now++
      await run()
    }
    expect(await queries.run('tenant', 'another', async () => true)).toBe(true)
    queries.clear()
    expect(await queries.run('tenant', 'group', async () => true)).toBe(true)
  })
})
