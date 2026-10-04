import { ExecutionContentCache } from './execution-content-cache'
import type { AgentRunExecutionEvidenceView as Evidence, AgentRunExecutionBlock as Block, AgentRunExecutionBlockChanges, AgentRunExecutionBlockPage as Page } from '@contracts'

export type ExecutionWindowRequest = (params: {
  threadId: string; agentRunId: string; beforeSequence: number | null; afterSequence?: number; limit: number
}) => Promise<Page>
export type ExecutionChangesRequest = (params: {
  threadId: string; agentRunId: string; afterChangeSequence: number; refreshEvidenceIds: string[]; limit: number
}) => Promise<AgentRunExecutionBlockChanges>
type Direction = 'earlier' | 'newer' | 'latest'
type CacheBudget = { maxItems: number; maxBytes: number }
const DEFAULT_BUDGET: CacheBudget = { maxItems: 2048, maxBytes: 8 * 1024 * 1024 }
const HISTORY_LIMIT = 12

/** A contiguous loaded interval. Rendering and cache retention have independent budgets. */
export class ExecutionWindow {
  readonly content = new ExecutionContentCache()
  private projection: { input: Evidence[]; value: unknown } | null = null
  project<T>(input: Evidence[], build: () => T): T {
    if (this.projection?.input !== input) this.projection = { input, value: build() }
    return this.projection.value as T
  }
  blocks: Block[] = []
  private evidenceProjection: { blocks: Block[]; evidence: Evidence[] } | null = null
  get evidence(): Evidence[] {
    if (this.evidenceProjection?.blocks !== this.blocks) {
      this.evidenceProjection = { blocks: this.blocks, evidence: this.blocks.flatMap(block => block.evidence) }
    }
    return this.evidenceProjection.evidence
  }
  loaded = false
  loading = false
  error: string | null = null
  direction: Direction = 'latest'
  hasEarlier = false
  hasNewer = false
  runtimePhase: Page['runtimePhase'] = undefined
  private cursor = 0
  private before: number | null = null
  private neighbor: Page | null = null
  private latestPage: Page | null = null
  private latestDirty = false
  private active = true
  private generation = 0
  private refreshing = false
  private queuedRefresh: (() => boolean) | null = null
  private pending = new Map<string, Promise<Page>>()
  private sizes = new WeakMap<Block, number>()
  private viewport: [number, number] | null = null

  constructor(
    readonly threadId: string, readonly agentRunId: string, readonly limit: number,
    private readonly request: ExecutionWindowRequest,
    private readonly changed: () => void,
    private readonly changes: ExecutionChangesRequest,
    private readonly budget: CacheBudget = DEFAULT_BUDGET
  ) {}

  get byteSize(): number {
    return this.content.bytes + [...new Set([...this.blocks, ...(this.neighbor?.blocks ?? []), ...(this.latestPage?.blocks ?? [])])]
      .reduce((sum, item) => sum + this.size(item), 0)
  }
  setViewport(first: number, last: number): void { this.viewport = [first, last] }
  resume(): void { this.active = true }
  dispose(): void {
    this.active = false; this.generation++; this.queuedRefresh = null
    this.loading = false; this.refreshing = false; this.pending.clear()
  }
  private size(item: Block): number {
    let bytes = this.sizes.get(item)
    if (bytes === undefined) { bytes = JSON.stringify(item).length * 2; this.sizes.set(item, bytes) }
    return bytes
  }
  private merge(items: Block[]): void {
    const entries = new Map(this.blocks.map(item => [item.key, item]))
    let dirty = false
    for (const item of items) {
      const previous = entries.get(item.key)
      if (previous && (item.changeSequence) < (previous.changeSequence)) continue
      if (previous && JSON.stringify(previous) === JSON.stringify(item)) continue
      entries.set(item.key, item); dirty = true
    }
    if (!dirty) return
    this.blocks = [...entries.values()].sort((a, b) => a.sequence - b.sequence)
  }
  private valid(items: Block[], through: number): boolean {
    return items.every(item => (item.kind === 'item' || item.kind === 'toolGroup') && typeof item.key === 'string'
      && Number.isSafeInteger(item.changeSequence) && item.changeSequence >= 0
      && Number.isSafeInteger(item.lastSequence) && item.lastSequence >= item.sequence && item.lastSequence <= through
      && Number.isSafeInteger(item.toolCount) && item.toolCount >= 0 && item.evidence.length <= 4
      && Object.values(item.counts).every(count => Number.isSafeInteger(count) && count >= 0)
      && item.evidence.every(evidence => evidence.agentRunId === this.agentRunId
        && Number.isSafeInteger(evidence.sequence) && evidence.sequence >= item.sequence && evidence.sequence <= item.lastSequence)
      && Number.isSafeInteger(item.sequence)
      && item.sequence > 0 && item.sequence <= through)
  }
  private async fetch(before: number | null, after?: number): Promise<Page> {
    const key = after === undefined ? `before:${before}` : `after:${after}`
    const pending = this.pending.get(key)
    if (pending) return pending
    const limit = before === null && after === undefined ? this.limit : HISTORY_LIMIT
    const generation = this.generation
    const promise = this.request({ threadId: this.threadId, agentRunId: this.agentRunId, beforeSequence: before,
      ...(after === undefined ? {} : { afterSequence: after }), limit }).then(page => {
      const items = page.blocks
      if (page.schemaVersion !== 3 || page.threadId !== this.threadId || page.agentRunId !== this.agentRunId
        || page.requestedBeforeSequence !== before || (page.requestedAfterSequence ?? undefined) !== after
        || !Number.isSafeInteger(page.throughSequence) || page.throughSequence < 0 || items.length > limit
        || !Number.isSafeInteger(page.throughChangeSequence) || page.throughChangeSequence < 0
        || !this.valid([...items, ...(page.activeBlocks ?? [])], page.throughSequence)
        || items.some((item, i) => (i > 0 && item.sequence <= items[i - 1].sequence)
          || (before !== null && item.sequence >= before) || (after !== undefined && item.sequence <= after))
        || (after === undefined && (page.hasMore ? page.nextBeforeSequence !== items[0]?.sequence : page.nextBeforeSequence !== null))
        || (after !== undefined && (page.hasMore ? page.nextAfterSequence !== items.at(-1)?.sequence : page.nextAfterSequence != null))) {
        throw new Error('执行记录分页数据不兼容')
      }
      if (before !== null && before === this.before && generation === this.generation) this.neighbor = page
      return page
    })
    this.pending.set(key, promise)
    try { return await promise } finally { if (this.pending.get(key) === promise) this.pending.delete(key) }
  }
  async latest(): Promise<void> {
    if (this.loaded && !this.hasNewer && !this.latestDirty) { this.error = null; this.changed(); return }
    await this.read('latest')
  }
  async earlier(): Promise<void> { if (this.hasEarlier) await this.read('earlier') }
  async newer(): Promise<void> { if (this.hasNewer) await this.read('newer') }
  async retry(): Promise<void> { await this.read(this.direction) }

  private async read(direction: Direction): Promise<void> {
    if (this.loading || !this.active) return
    const generation = this.generation
    this.loading = true; this.direction = direction; this.error = null
    this.changed()
    try {
      const before = direction === 'earlier' ? this.before : null
      const after = direction === 'newer' ? this.blocks.at(-1)?.sequence : undefined
      const page = direction === 'earlier' && this.neighbor?.requestedBeforeSequence === before
        ? this.neighbor : direction === 'latest' && !this.latestDirty && this.latestPage
          ? this.latestPage : await this.fetch(before, after)
      if (generation !== this.generation) return
      if (direction === 'latest') {
        // A discontinuity can occur only after cache eviction or a long absence.
        const overlaps = page.blocks.some(item => this.blocks.some(old => old.sequence === item.sequence))
        if (!overlaps || this.hasNewer) {
          this.blocks = []; this.before = page.nextBeforeSequence; this.hasEarlier = page.hasMore
        }
        this.merge([...page.blocks, ...(page.activeBlocks ?? [])])
        this.latestPage = page; this.cursor = page.throughChangeSequence
        this.runtimePhase = page.runtimePhase
        this.latestDirty = false; this.hasNewer = false; this.viewport = null
      } else if (direction === 'earlier') {
        // A prefetched page may contain an older version of an already loaded operation.
        this.merge(page.blocks.filter(item => !this.blocks.some(old => old.sequence === item.sequence)))
        this.before = page.nextBeforeSequence; this.hasEarlier = page.hasMore; this.neighbor = null
      } else {
        this.merge(page.blocks); this.hasNewer = page.hasMore
        if (!page.hasMore) this.cursor = page.throughChangeSequence
      }
      this.loaded = true
      this.prune(direction === 'earlier')
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error ? error.message : '读取执行记录失败'
    } finally {
      if (generation === this.generation) {
        this.loading = false; this.changed(); this.afterRead()
      }
    }
  }

  async refresh(accept: () => boolean = () => true): Promise<void> {
    if (!this.active || !this.loaded) return
    if (this.hasNewer) { this.latestDirty = true; return }
    if (this.refreshing || this.loading) { this.queuedRefresh = accept; return }
    const generation = this.generation
    this.refreshing = true
    try {
      let more = true
      while (more && generation === this.generation && !this.hasNewer) {
        const after = this.cursor
        const refreshEvidenceIds = this.evidence.filter(item =>
          item.eventType === 'agent.text.block' && item.payload !== null && typeof item.payload === 'object'
            && 'status' in item.payload && item.payload.status === 'streaming'
          || item.revision == null && (item.phase === 'updated' || item.phase === 'started'))
          .slice(0, 256).map(item => item.id)
        const page = await this.changes({ threadId: this.threadId, agentRunId: this.agentRunId,
          afterChangeSequence: after, refreshEvidenceIds, limit: 96 })
        if (generation !== this.generation) return
        if (page.schemaVersion !== 3 || page.threadId !== this.threadId || page.agentRunId !== this.agentRunId
          || page.requestedAfterChangeSequence !== after || !Number.isSafeInteger(page.nextAfterChangeSequence)
          || !Number.isSafeInteger(page.throughChangeSequence) || page.nextAfterChangeSequence < after
          || page.nextAfterChangeSequence > page.throughChangeSequence || (page.hasMore && page.nextAfterChangeSequence <= after)
          || (!page.hasMore && page.nextAfterChangeSequence !== page.throughChangeSequence)
          || page.blocks.length > 96 || (page.refreshedBlocks?.length ?? 0) > 256
          || !this.valid([...page.blocks, ...(page.refreshedBlocks ?? [])], page.throughSequence)) {
          throw new Error('执行记录增量数据不兼容')
        }
        // Returning after a long absence must not replay an entire Run before reaching its tail.
        if (page.throughChangeSequence - after > this.budget.maxItems && accept()) {
          this.latestDirty = true
          await this.read('latest')
          return
        }
        this.cursor = page.nextAfterChangeSequence
        this.runtimePhase = page.runtimePhase
        // Ignore old operation updates outside the contiguous loaded interval.
        const first = this.before === null ? 0 : this.before
        this.merge([...page.blocks, ...(page.refreshedBlocks ?? [])].filter(item => item.sequence >= first
          || this.blocks.some(old => old.sequence === item.sequence)))
        this.latestPage = { schemaVersion: 3, threadId: this.threadId, agentRunId: this.agentRunId,
          requestedBeforeSequence: null, throughSequence: page.throughSequence,
          throughChangeSequence: this.cursor, runtimePhase: this.runtimePhase, blocks: this.blocks.slice(-this.limit),
          hasMore: this.hasEarlier || this.blocks.length > this.limit,
          nextBeforeSequence: this.hasEarlier || this.blocks.length > this.limit ? this.blocks.slice(-this.limit)[0]?.sequence ?? null : null }
        this.prune(!accept())
        this.changed()
        more = page.hasMore
        if (more) await new Promise<void>(resolve => setTimeout(resolve, 0))
      }
    } catch {
      // Preserve readable data; invalidation or explicit latest retries a bounded snapshot.
      this.latestDirty = true
    } finally {
      if (generation === this.generation) {
        this.refreshing = false
        const queued = this.queuedRefresh; this.queuedRefresh = null
        if (queued) void this.refresh(queued)
      }
    }
  }
  private afterRead(): void {
    const queued = this.queuedRefresh; this.queuedRefresh = null
    if (queued) void this.refresh(queued)
    else void this.prefetch()
  }
  private async prefetch(): Promise<void> {
    if (!this.active || !this.hasEarlier || this.before === null || this.neighbor || this.error) return
    const generation = this.generation, before = this.before
    try {
      const page = await this.fetch(before)
      if (generation === this.generation && before === this.before) this.neighbor = page
    } catch { /* Only explicit navigation presents errors. */ }
  }
  private prune(fromTail: boolean): void {
    let bytes = this.blocks.reduce((sum, item) => sum + this.size(item), 0)
    let start = 0, end = this.blocks.length
    while (end - start > 1 && (end - start > this.budget.maxItems || bytes > this.budget.maxBytes)) {
      const index = fromTail ? end - 1 : start
      const item = this.blocks[index]
      if (this.viewport && item.sequence >= this.viewport[0] && item.sequence <= this.viewport[1]) break
      bytes -= this.size(item)
      if (fromTail) end--; else start++
    }
    if (end < this.blocks.length) { this.hasNewer = true; this.latestDirty = true }
    if (start > 0) { this.hasEarlier = true; this.before = this.blocks[start].sequence; this.neighbor = null }
    if (start > 0 || end < this.blocks.length) {
      // Active operations can precede the historical cursor and must remain visible until settled.
      const active = (item: Block) => item.counts.running > 0 || item.counts.waiting > 0
      this.blocks = [...this.blocks.slice(0, start).filter(active), ...this.blocks.slice(start, end),
        ...this.blocks.slice(end).filter(active)]
    }
  }
}

/** Renderer session cache: inactive Runs are the first eviction candidates. */
export class ExecutionWindowCache {
  private entries = new Map<string, { window: ExecutionWindow; listeners: Set<() => void> }>()
  constructor(private maxRuns = 8, private maxBytes = 24 * 1024 * 1024) {}
  acquire(key: string, create: (changed: () => void) => ExecutionWindow, changed: () => void): { window: ExecutionWindow; release: () => void } {
    let entry = this.entries.get(key)
    if (!entry) {
      const listeners = new Set<() => void>()
      entry = { listeners, window: create(() => { for (const listener of listeners) listener(); this.prune() }) }
    }
    entry.window.content.onChange = () => this.prune()
    this.entries.delete(key); this.entries.set(key, entry)
    entry.listeners.add(changed); entry.window.resume(); this.prune()
    const retained = entry
    return { window: retained.window, release: () => {
      retained.listeners.delete(changed)
      if (retained.listeners.size === 0) retained.window.dispose()
      this.prune()
    } }
  }
  private prune(): void {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.window.byteSize, 0)
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maxRuns && bytes <= this.maxBytes) break
      if (entry.listeners.size) continue
      bytes -= entry.window.byteSize; entry.window.dispose(); this.entries.delete(key)
    }
  }
}
// Retain Thread history within one transport/Host connection. A replacement
// Web client must never revive a window whose fetchers hold an old credential.
const executionWindowCaches = new WeakMap<object, ExecutionWindowCache>()
export function executionWindowCacheFor(client: object): ExecutionWindowCache {
  let cache = executionWindowCaches.get(client)
  if (!cache) { cache = new ExecutionWindowCache(); executionWindowCaches.set(client, cache) }
  return cache
}
export function executionWindowPageSize(viewportHeight: number): number {
  return Math.max(4, Math.min(24, Math.ceil(viewportHeight / 112) + 2))
}
