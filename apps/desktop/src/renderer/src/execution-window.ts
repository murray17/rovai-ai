import type { AgentRunExecutionWindowPage } from '@contracts'

export type ExecutionWindowRequest = (params: {
  campId: string
  agentRunId: string
  beforeSequence: number | null
  limit: number
}) => Promise<AgentRunExecutionWindowPage>

/** Two displayed pages and one adjacent prefetched page, irrespective of Run length. */
export class ExecutionWindow {
  pages = new Map<number, AgentRunExecutionWindowPage>()
  visible: number[] = []
  loading = false
  error: string | null = null
  private generation = 0
  private cursors = new Map<number, number | null>([[0, null]])
  private pending = new Map<number, Promise<AgentRunExecutionWindowPage>>()
  private failedDirection: 'earlier' | 'newer' | 'latest' = 'latest'
  private queuedRefresh: (() => boolean) | null = null

  constructor(
    readonly campId: string,
    readonly agentRunId: string,
    readonly limit: number,
    private readonly request: ExecutionWindowRequest,
    private readonly changed: () => void
  ) {}

  get evidence(): AgentRunExecutionWindowPage['evidence'] {
    const entries = new Map<string, AgentRunExecutionWindowPage['evidence'][number]>()
    // The newer page wins if live updates overlap a previously visited boundary.
    for (const index of [...this.visible].sort((a, b) => b - a)) {
      for (const item of [...(this.pages.get(index)?.evidence ?? []), ...(this.pages.get(index)?.activeEvidence ?? [])]) {
        const key = item.canonical
          ? `${item.executionEpoch}:operation:${item.canonical.operationId}` : item.id
        entries.set(key, item)
      }
    }
    return [...entries.values()].sort((a, b) => a.sequence - b.sequence)
  }

  get hasEarlier(): boolean {
    const oldest = Math.max(...this.visible)
    return this.pages.get(oldest)?.hasMore ?? false
  }

  get hasNewer(): boolean { return this.visible.length > 0 && Math.min(...this.visible) > 0 }

  dispose(): void { this.generation += 1; this.queuedRefresh = null }

  async latest(): Promise<void> {
    if (this.loading) return
    this.generation += 1
    this.pending.clear()
    await this.show(0, 'latest')
  }

  async retry(): Promise<void> { await this[this.failedDirection]() }

  async earlier(): Promise<void> {
    if (this.hasEarlier) await this.show(Math.max(...this.visible) + 1, 'earlier')
  }

  async newer(): Promise<void> {
    if (this.hasNewer) await this.show(Math.min(...this.visible) - 1, 'newer')
  }

  /** Live refresh is explicit; callers suppress it while the user reads history. */
  async refresh(accept: () => boolean = () => true): Promise<void> {
    if (!accept() || this.hasNewer) return
    if (this.loading) { this.queuedRefresh = accept; return }
    if (this.visible.length === 0) return
    const generation = ++this.generation
    this.loading = true
    this.pending.clear()
    try {
      const page = await this.fetch(0)
      if (generation !== this.generation || !accept()) return
      this.pages = new Map([[0, page]])
      this.cursors = new Map([[0, null]])
      this.remember(0, page)
      this.visible = [0]
      this.error = null
    } catch {
      // Keep the last successful view. The next live invalidation or explicit
      // latest action can retry without replacing content with a spinner.
    } finally {
      if (generation === this.generation) {
        this.loading = false
        this.changed()
        this.afterRead()
      }
    }
  }

  private async show(index: number, direction: 'earlier' | 'newer' | 'latest'): Promise<void> {
    if (this.loading) return
    const generation = this.generation
    this.loading = true
    this.error = null
    this.changed()
    try {
      const page = (direction === 'latest' ? undefined : this.pages.get(index)) ?? await this.fetch(index)
      if (generation !== this.generation) return
      if (direction === 'latest') {
        this.pages.clear()
        this.cursors = new Map([[0, null]])
        this.visible = []
      }
      this.remember(index, page)
      this.visible = [...new Set([...this.visible, index])].sort((a, b) => a - b)
      this.visible = direction === 'earlier' ? this.visible.slice(-2) : this.visible.slice(0, 2)
      this.prune()
    } catch (error) {
      if (generation === this.generation) {
        this.failedDirection = direction
        this.error = error instanceof Error ? error.message : '读取执行记录失败'
      }
    } finally {
      if (generation === this.generation) {
        this.loading = false
        this.changed()
        this.afterRead()
      }
    }
  }

  private afterRead(): void {
    const refresh = this.queuedRefresh
    this.queuedRefresh = null
    if (refresh?.()) void this.refresh(refresh)
    else void this.prefetch()
  }

  private remember(index: number, page: AgentRunExecutionWindowPage): void {
    this.pages.set(index, page)
    if (page.nextBeforeSequence !== null) this.cursors.set(index + 1, page.nextBeforeSequence)
  }

  private async fetch(index: number): Promise<AgentRunExecutionWindowPage> {
    const existing = this.pending.get(index)
    if (existing) return existing
    const beforeSequence = this.cursors.get(index)
    if (beforeSequence === undefined) throw new Error('执行记录分页位置不可用')
    const promise = this.request({ campId: this.campId, agentRunId: this.agentRunId, beforeSequence, limit: this.limit })
      .then(page => {
        const sequences = page.evidence.map(item => item.sequence)
        if (page.schemaVersion !== 1 || page.campId !== this.campId || page.agentRunId !== this.agentRunId
          || page.requestedBeforeSequence !== beforeSequence
          || !Number.isSafeInteger(page.throughSequence) || page.throughSequence < 0
          || page.evidence.length > this.limit
          || page.activeEvidence?.some(item => item.agentRunId !== this.agentRunId
            || !Number.isSafeInteger(item.sequence) || item.sequence <= 0 || item.sequence > page.throughSequence)
          || page.evidence.some((item, position) => item.agentRunId !== this.agentRunId
            || !Number.isSafeInteger(item.sequence) || item.sequence <= 0 || item.sequence > page.throughSequence
            || (beforeSequence !== null && item.sequence >= beforeSequence)
            || (position > 0 && item.sequence <= sequences[position - 1]))
          || (page.hasMore && (page.nextBeforeSequence !== sequences[0] || sequences.length === 0))
          || (!page.hasMore && page.nextBeforeSequence !== null)) {
          throw new Error('执行记录分页数据不兼容')
        }
        return page
      })
    this.pending.set(index, promise)
    try { return await promise } finally {
      if (this.pending.get(index) === promise) this.pending.delete(index)
    }
  }

  private async prefetch(): Promise<void> {
    if (!this.hasEarlier || this.error) return
    const index = Math.max(...this.visible) + 1
    if (this.pages.has(index)) return
    const generation = this.generation
    try {
      const page = await this.fetch(index)
      if (generation !== this.generation) return
      this.remember(index, page)
      this.prune()
      // Prefetch is cached data only: no render, no recursive prefetch.
    } catch { /* Explicit navigation retries and reports a failure. */ }
  }

  private prune(): void {
    const adjacent = Math.max(...this.visible) + 1
    for (const index of this.pages.keys()) {
      if (!this.visible.includes(index) && index !== adjacent) this.pages.delete(index)
    }
  }
}

export function executionWindowPageSize(viewportHeight: number): number {
  return Math.max(12, Math.min(48, Math.ceil(viewportHeight / 36) + 8))
}
