import { describe, expect, it, vi } from 'vitest'
import type { AgentRunExecutionWindowPage } from '@contracts'
import { ExecutionWindow, executionWindowPageSize, type ExecutionWindowRequest } from './execution-window'

function page(before: number | null, limit = 12): AgentRunExecutionWindowPage {
  const end = Math.min(100, (before ?? 101) - 1)
  const start = Math.max(1, end - limit + 1)
  return {
    schemaVersion: 1, campId: 'camp', agentRunId: 'run', requestedBeforeSequence: before,
    nextBeforeSequence: start > 1 ? start : null, throughSequence: 100, hasMore: start > 1,
    evidence: Array.from({ length: end - start + 1 }, (_, offset) => ({
      id: `e-${start + offset}`, agentRunId: 'run', executionEpoch: 1, sequence: start + offset,
      eventType: 'agent.text.block', kind: 'narration', phase: 'completed',
      payload: { text: `text ${start + offset}` }, contentBlobId: null, contentByteCount: 10,
      isTruncated: false, occurredAt: '2026-09-12T00:00:00Z'
    }))
  }
}

describe('bounded execution window', () => {
  it('loads a viewport page, prefetches exactly one neighbor and bounds both data and mounted pages across navigation', async () => {
    const request = vi.fn<ExecutionWindowRequest>(async params => page(params.beforeSequence, params.limit))
    const changed = vi.fn()
    const window = new ExecutionWindow('camp', 'run', 12, request, changed)
    await window.latest()
    await vi.waitFor(() => expect(window.pages.size).toBe(2))
    expect(request.mock.calls.map(([params]) => params.beforeSequence)).toEqual([null, 89])
    expect(window.evidence).toHaveLength(12)
    expect(window.visible).toEqual([0])
    await window.earlier()
    await vi.waitFor(() => expect(window.pages.size).toBe(3))
    expect(window.evidence).toHaveLength(24)
    await window.earlier()
    await vi.waitFor(() => expect(window.pages.has(3)).toBe(true))
    expect(window.visible).toEqual([1, 2])
    expect(window.pages.size).toBe(3)
    expect(window.hasNewer).toBe(true)
    expect(window.evidence[0].sequence).toBe(65)
    await window.newer()
    expect(window.visible).toEqual([0, 1])
    expect(window.evidence.at(-1)?.sequence).toBe(100)
    expect(window.pages.size).toBeLessThanOrEqual(3)
    expect(executionWindowPageSize(300)).toBeLessThan(executionWindowPageSize(900))
    expect(executionWindowPageSize(4000)).toBe(48)
  })

  it('keeps successful content after a page failure, retries on demand and rejects mixed Camp/cursor data', async () => {
    let fail = true
    const request = vi.fn<ExecutionWindowRequest>(async params => {
      if (params.beforeSequence !== null && fail) throw new Error('offline')
      return page(params.beforeSequence)
    })
    const window = new ExecutionWindow('camp', 'run', 12, request, () => {})
    await window.latest()
    await window.earlier()
    expect(window.error).toBe('offline')
    expect(window.evidence.at(-1)?.sequence).toBe(100)
    fail = false
    await window.retry()
    expect(window.error).toBeNull()
    expect(window.evidence).toHaveLength(24)
    const invalid = new ExecutionWindow('camp', 'run', 12, async () => ({ ...page(null), campId: 'another' }), () => {})
    await invalid.latest()
    expect(invalid.error).toContain('不兼容')
    expect(invalid.evidence).toEqual([])
  })

  it('retries in the failed direction and retains the reading window when returning to latest fails', async () => {
    let fail = false
    const request = vi.fn<ExecutionWindowRequest>(async params => {
      if (fail && params.beforeSequence === null) throw new Error('offline')
      return page(params.beforeSequence)
    })
    const window = new ExecutionWindow('camp', 'run', 12, request, () => {})
    await window.latest()
    await window.earlier()
    await window.earlier()
    const reading = window.evidence
    fail = true
    await window.newer()
    expect(window.evidence).toEqual(reading)
    fail = false
    await window.retry()
    expect(window.visible).toEqual([0, 1])
    await window.earlier()
    fail = true
    const previous = window.evidence
    await window.latest()
    expect(window.evidence).toEqual(previous)
    fail = false
    await window.retry()
    expect(window.visible).toEqual([0])
  })

  it('discards late responses after leaving a Run and refreshes only the latest window', async () => {
    let resolve!: (value: AgentRunExecutionWindowPage) => void
    const changed = vi.fn()
    const window = new ExecutionWindow('camp', 'run', 12, () => new Promise(done => { resolve = done }), changed)
    const loading = window.latest()
    window.dispose()
    changed.mockClear()
    resolve(page(null))
    await loading
    expect(window.evidence).toEqual([])
    expect(changed).not.toHaveBeenCalled()

    const request = vi.fn<ExecutionWindowRequest>(async params => page(params.beforeSequence))
    const current = new ExecutionWindow('camp', 'run', 12, request, () => {})
    await current.latest()
    await current.earlier()
    await current.earlier()
    const count = request.mock.calls.length
    await current.refresh()
    expect(request).toHaveBeenCalledTimes(count)
    await current.latest()
    expect(current.visible).toEqual([0])
    expect(current.hasNewer).toBe(false)
  })
})
