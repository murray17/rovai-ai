import { describe, expect, it, vi } from 'vitest'
import type { AgentRunExecutionBlock, AgentRunExecutionEvidenceView as Evidence, AgentRunExecutionGroupPage } from '@contracts'
import { ExecutionGroupWindow, type GroupChangesRequest, type GroupRequest } from './execution-group-window'

function source(count = 120) {
  const item = (sequence: number): Evidence => ({ id: `tool-${sequence}`, agentRunId: 'run', executionEpoch: 1,
    sequence, revision: 1, changeSequence: sequence, eventType: 'activity.completed', kind: 'command', phase: 'completed',
    payload: { item: { type: 'commandExecution', command: `echo ${sequence}`, status: 'completed' } },
    contentBlobId: null, contentByteCount: 100, isTruncated: true, occurredAt: '2026-10-02T00:00:00Z' })
  const state = { rows: Array.from({ length: count }, (_, index) => item(index + 10)), cursor: count + 9, fail: false }
  const request = vi.fn<GroupRequest>(async params => {
    if (state.fail) throw new Error('offline')
    const forward = params.afterSequence !== undefined
    let selected = state.rows.filter(item => params.beforeSequence === null || item.sequence < params.beforeSequence)
      .filter(item => params.afterSequence === undefined || item.sequence > params.afterSequence)
    if (!forward) selected.reverse()
    const hasMore = selected.length > params.limit
    selected = selected.slice(0, params.limit)
    const cursor = selected.at(-1)?.sequence ?? null
    return { schemaVersion: 3, threadId: 'thread', agentRunId: 'run', groupSequence: 10,
      requestedBeforeSequence: params.beforeSequence, requestedAfterSequence: params.afterSequence ?? null,
      nextBeforeSequence: !forward && hasMore ? cursor : null, nextAfterSequence: forward && hasMore ? cursor : null,
      throughChangeSequence: state.cursor, hasMore, evidence: selected.sort((a,b) => a.sequence-b.sequence) }
  })
  const changes = vi.fn<GroupChangesRequest>(async params => {
    if (state.fail) throw new Error('offline')
    const selected = state.rows.filter(item => item.sequence >= params.fromSequence
      && (params.toSequence === undefined || item.sequence <= params.toSequence)
      && item.changeSequence! > params.afterChangeSequence).sort((a,b) => a.changeSequence!-b.changeSequence!)
    const evidence = selected.slice(0, params.limit), hasMore = selected.length > params.limit
    return { schemaVersion: 2, threadId: 'thread', agentRunId: 'run', requestedAfterChangeSequence: params.afterChangeSequence,
      nextAfterChangeSequence: hasMore ? evidence.at(-1)!.changeSequence! : state.cursor, throughSequence: state.rows.at(-1)!.sequence,
      throughChangeSequence: state.cursor, hasMore, evidence, refreshedEvidence: [] }
  })
  const block = (): AgentRunExecutionBlock => ({ key: 'tools:10', kind: 'toolGroup', sequence: 10,
    lastSequence: state.rows.at(-1)!.sequence, changeSequence: state.cursor, toolCount: state.rows.length,
    counts: { completed: state.rows.length, failed: 0, stopped: 0, recorded: 0, running: 0, waiting: 0 },
    evidence: [state.rows.at(-1)!] })
  return { state, request, changes, block, item }
}

describe('independent command group window', () => {
  it('reads no children while closed, pages forward in 24s, and resumes cached rows without another read', async () => {
    const { request, changes } = source()
    const changed = vi.fn()
    const window = new ExecutionGroupWindow('thread', 'run', 10, () => false, request, changes, changed)
    expect(request).not.toHaveBeenCalled()
    await window.read()
    expect(window.state.evidence.map(item => item.sequence)).toEqual(Array.from({ length: 24 }, (_, i) => i + 10))
    expect(window.state.hasEarlier).toBe(false); expect(window.state.hasNewer).toBe(true)
    for (let page = 0; page < 4; page++) await window.read('newer')
    expect(window.state.evidence).toHaveLength(120); expect(window.state.hasNewer).toBe(false)
    expect(new Set(window.state.evidence.map(item => item.id)).size).toBe(120)
    const cached = window.state
    window.dispose()
    const resumed = new ExecutionGroupWindow('thread', 'run', 10, () => false, request, changes, changed, cached)
    await resumed.read()
    expect(request).toHaveBeenCalledTimes(5)
  })

  it('starts a live group at its tail and updates old children by changeSequence without reading unrelated ranges', async () => {
    const { state, request, changes, block, item } = source()
    const window = new ExecutionGroupWindow('thread', 'run', 10, () => true, request, changes, () => {})
    await window.read()
    expect(window.state.evidence[0].sequence).toBe(106)
    expect(window.state.hasEarlier).toBe(true); expect(window.state.hasNewer).toBe(false)
    await window.read('earlier')
    const first = window.state.evidence[0].sequence
    state.rows = state.rows.map(row => row.sequence === 110 ? { ...row, phase: 'failed', revision: 2, changeSequence: ++state.cursor } : row)
    const appended = { ...item(130), changeSequence: ++state.cursor }
    state.rows.push(appended)
    await window.refresh(block())
    expect(window.state.evidence[0].sequence).toBe(first)
    expect(window.state.evidence.find(row => row.sequence === 110)?.phase).toBe('failed')
    expect(window.state.evidence.at(-1)?.sequence).toBe(130)
    expect(changes.mock.calls[0][0].fromSequence).toBe(first)
    expect(changes.mock.calls[0][0].toSequence).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('preserves successful children on failed pages, retries the cursor, and fences responses after close', async () => {
    const { state, request, changes, block } = source()
    const window = new ExecutionGroupWindow('thread', 'run', 10, () => false, request, changes, () => {})
    await window.read()
    const before = window.state.evidence
    state.fail = true; await window.read('newer')
    expect(window.error).toBe('offline'); expect(window.state.evidence).toBe(before)
    state.fail = false; state.cursor++; await window.retry(block())
    expect(window.error).toBeNull(); expect(window.state.evidence).toHaveLength(48)
    expect(request.mock.calls[1][0].afterSequence).toBe(request.mock.calls[2][0].afterSequence)
    let resolve!: (page: AgentRunExecutionGroupPage) => void
    const notify = vi.fn()
    const late = new ExecutionGroupWindow('thread', 'run', 10, () => false, () => new Promise(done => { resolve = done }), changes, notify)
    const pending = late.read(); late.dispose(); notify.mockClear()
    resolve(await request({ threadId: 'thread', agentRunId: 'run', groupSequence: 10, beforeSequence: null, afterSequence: 9, limit: 24 }))
    await pending
    expect(late.state.evidence).toEqual([]); expect(notify).not.toHaveBeenCalled()
    const wrong = new ExecutionGroupWindow('thread', 'run', 10, () => false,
      async params => ({ ...await request(params), groupSequence: 100 }), changes, () => {})
    await wrong.read(); expect(wrong.error).toContain('不兼容')
  })

  it('bounds a very long expanded group and reloads evicted children through the same group cursor', async () => {
    const { request, changes } = source(1000)
    const window = new ExecutionGroupWindow('thread', 'run', 10, () => false, request, changes, () => {})
    await window.read()
    for (let page = 0; page < 23; page++) await window.read('newer')
    expect(window.state.evidence).toHaveLength(512)
    expect(window.state.hasEarlier).toBe(true)
    const first = window.state.evidence[0].sequence
    await window.read('earlier')
    expect(window.state.evidence[0].sequence).toBeLessThan(first)
    expect(window.state.evidence).toHaveLength(512)
    expect(request.mock.calls.at(-1)![0].groupSequence).toBe(10)
  })

  it('drains all changed rows in a retained historical interval before advancing the cursor', async () => {
    const { state, request, changes, block } = source(180)
    const window = new ExecutionGroupWindow('thread', 'run', 10, () => false, request, changes, () => {})
    await window.read()
    for (let page = 0; page < 4; page++) await window.read('newer')
    expect(window.state.hasNewer).toBe(true)
    state.rows = state.rows.map((row, index) => index < 120
      ? { ...row, phase: 'failed', revision: 2, changeSequence: ++state.cursor } : row)
    await window.refresh(block())
    expect(changes).toHaveBeenCalledTimes(2)
    expect(window.state.evidence.every(row => row.phase === 'failed')).toBe(true)
    expect(window.state.changeCursor).toBe(state.cursor)
    expect(window.state.evidence).toHaveLength(120)
  })
})
