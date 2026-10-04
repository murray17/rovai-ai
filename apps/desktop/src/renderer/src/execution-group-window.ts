import type { AgentRunExecutionBlock, AgentRunExecutionEvidenceView as Evidence, AgentRunExecutionGroupPage, AgentRunExecutionWindowChanges } from '@contracts'

export type GroupRequest = (params: {
  threadId: string; agentRunId: string; groupSequence: number; beforeSequence: number | null; afterSequence?: number; limit: number
}) => Promise<AgentRunExecutionGroupPage>
export type GroupChangesRequest = (params: {
  threadId: string; agentRunId: string; groupSequence: number; afterChangeSequence: number
  fromSequence: number; toSequence?: number; limit: number
}) => Promise<AgentRunExecutionWindowChanges>
export type GroupSnapshot = {
  evidence: Evidence[]; initialized: boolean; hasEarlier: boolean; hasNewer: boolean; changeCursor: number
}
type Direction = 'initial' | 'earlier' | 'newer'
const PAGE_SIZE = 24
const MAX_ITEMS = 512
const MAX_BYTES = 2 * 1024 * 1024

/** One contiguous child window, independent of the outer block count and output cache. */
export class ExecutionGroupWindow {
  state: GroupSnapshot
  loading = false
  error: string | null = null
  direction: Direction = 'initial'
  private generation = 0
  private active = true
  private refreshing = false
  private pendingRefresh: AgentRunExecutionBlock | null = null
  private viewport: [number, number] | null = null
  private failedOperation: Direction | 'refresh' | null = null
  constructor(
    readonly threadId: string, readonly runId: string, readonly groupSequence: number,
    private readonly liveTail: () => boolean, private readonly request: GroupRequest,
    private readonly changes: GroupChangesRequest, private readonly changed: () => void,
    initial?: GroupSnapshot
  ) {
    this.state = initial ?? { evidence: [], initialized: false, hasEarlier: false, hasNewer: false, changeCursor: 0 }
  }
  resume(): void { this.active = true }
  dispose(): void { this.active = false; this.generation++; this.loading = false; this.refreshing = false; this.pendingRefresh = null }
  setViewport(first: number, last: number): void { this.viewport = [first, last] }
  private merge(items: Evidence[]): Evidence[] {
    const merged = new Map(this.state.evidence.map(item => [item.id, item]))
    for (const item of items) {
      const prior = merged.get(item.id)
      if (prior && ((prior.revision ?? 0) > (item.revision ?? 0)
        || ((prior.revision ?? 0) === (item.revision ?? 0) && (prior.changeSequence ?? 0) > (item.changeSequence ?? 0)))) continue
      merged.set(item.id, item)
    }
    return [...merged.values()].sort((a, b) => a.sequence - b.sequence)
  }
  private valid(items: Evidence[]): boolean {
    return items.every(item => item.agentRunId === this.runId && Number.isSafeInteger(item.sequence) && item.sequence >= this.groupSequence)
  }
  async read(direction: Direction = 'initial'): Promise<void> {
    if (!this.active || this.loading || (direction === 'initial' && this.state.initialized)) return
    if ((direction === 'earlier' && !this.state.hasEarlier) || (direction === 'newer' && !this.state.hasNewer)) return
    this.loading = true; this.direction = direction; this.error = null; this.failedOperation = null; this.changed()
    const generation = this.generation
    const forward = direction === 'newer' || (direction === 'initial' && !this.liveTail())
    const after = forward ? (direction === 'initial' ? this.groupSequence - 1 : this.state.evidence.at(-1)!.sequence) : undefined
    const before = direction === 'earlier' ? this.state.evidence[0].sequence : null
    try {
      const page = await this.request({ threadId: this.threadId, agentRunId: this.runId, groupSequence: this.groupSequence,
        beforeSequence: before, ...(after === undefined ? {} : { afterSequence: after }), limit: PAGE_SIZE })
      if (generation !== this.generation) return
      if (page.schemaVersion !== 3 || page.threadId !== this.threadId || page.agentRunId !== this.runId
        || page.groupSequence !== this.groupSequence || page.requestedBeforeSequence !== before
        || (page.requestedAfterSequence ?? undefined) !== after || page.evidence.length > PAGE_SIZE
        || !Number.isSafeInteger(page.throughChangeSequence) || page.throughChangeSequence < 0 || !this.valid(page.evidence)
        || page.evidence.some((item, index) => (index > 0 && item.sequence <= page.evidence[index - 1].sequence)
          || (before !== null && item.sequence >= before) || (after !== undefined && item.sequence <= after))
        || (forward ? (page.hasMore ? page.nextAfterSequence !== page.evidence.at(-1)?.sequence : page.nextAfterSequence !== null)
          : (page.hasMore ? page.nextBeforeSequence !== page.evidence[0]?.sequence : page.nextBeforeSequence !== null))) {
        throw new Error('执行记录分页数据不兼容')
      }
      this.state = { ...this.state, evidence: this.merge(page.evidence), initialized: true,
        hasEarlier: forward ? this.state.hasEarlier : page.hasMore,
        hasNewer: forward ? page.hasMore : this.state.hasNewer,
        changeCursor: this.state.initialized ? Math.min(this.state.changeCursor, page.throughChangeSequence) : page.throughChangeSequence }
      this.prune(direction === 'earlier')
    } catch (error) {
      if (generation === this.generation) {
        this.failedOperation = direction
        this.error = error instanceof Error ? error.message : '读取执行记录失败'
      }
    } finally {
      if (generation === this.generation) {
        this.loading = false; this.changed()
        const pending = this.pendingRefresh; this.pendingRefresh = null
        if (pending && !this.error) void this.refresh(pending)
      }
    }
  }
  async refresh(block: AgentRunExecutionBlock): Promise<void> {
    if (!this.active || this.error || !this.state.initialized || block.changeSequence <= this.state.changeCursor) return
    if (this.loading || this.refreshing) { this.pendingRefresh = block; return }
    const generation = this.generation
    this.refreshing = true
    try {
      let more = true
      while (more && generation === this.generation) {
        const from = this.state.evidence[0]?.sequence ?? this.groupSequence
        const to = this.state.hasNewer ? this.state.evidence.at(-1)?.sequence : undefined
        const after = this.state.changeCursor
        const page = await this.changes({ threadId: this.threadId, agentRunId: this.runId, groupSequence: this.groupSequence,
          fromSequence: from, ...(to === undefined ? {} : { toSequence: to }), afterChangeSequence: after, limit: 96 })
        if (generation !== this.generation) return
        if (page.schemaVersion !== 2 || page.threadId !== this.threadId || page.agentRunId !== this.runId
          || page.requestedAfterChangeSequence !== after || page.nextAfterChangeSequence < after
          || !Number.isSafeInteger(page.nextAfterChangeSequence) || page.nextAfterChangeSequence > page.throughChangeSequence
          || (page.hasMore && page.nextAfterChangeSequence === after)
          || (!page.hasMore && page.nextAfterChangeSequence !== page.throughChangeSequence)
          || page.evidence.length > 96 || !this.valid(page.evidence)
          || page.evidence.some(item => item.sequence < from || (to !== undefined && item.sequence > to))) {
          throw new Error('执行记录增量数据不兼容')
        }
        this.state = { ...this.state, evidence: this.merge(page.evidence), changeCursor: page.nextAfterChangeSequence }
        this.prune(false); this.changed(); more = page.hasMore
        if (more) await new Promise<void>(resolve => setTimeout(resolve, 0))
      }
    } catch (error) {
      if (generation === this.generation) {
        this.failedOperation = 'refresh'
        this.error = error instanceof Error ? error.message : '读取执行记录失败'; this.changed()
      }
    } finally {
      if (generation === this.generation) {
        this.refreshing = false
        const pending = this.pendingRefresh; this.pendingRefresh = null
        if (pending && !this.error) void this.refresh(pending)
      }
    }
  }
  async retry(block: AgentRunExecutionBlock): Promise<void> {
    const failed = this.failedOperation
    this.error = null
    this.failedOperation = null
    if (failed === 'refresh') await this.refresh(block)
    else { await this.read(failed ?? this.direction); await this.refresh(block) }
  }
  private prune(fromTail: boolean): void {
    const items = this.state.evidence
    let bytes = items.reduce((sum, item) => sum + JSON.stringify(item).length * 2, 0)
    let start = 0, end = items.length
    while (end - start > 1 && (end - start > MAX_ITEMS || bytes > MAX_BYTES)) {
      const item = items[fromTail ? end - 1 : start]
      if (this.viewport && item.sequence >= this.viewport[0] && item.sequence <= this.viewport[1]) break
      bytes -= JSON.stringify(item).length * 2
      if (fromTail) end--; else start++
    }
    if (start || end < items.length) this.state = { ...this.state, evidence: items.slice(start, end),
      hasEarlier: this.state.hasEarlier || start > 0, hasNewer: this.state.hasNewer || end < items.length }
  }
}
