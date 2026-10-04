import type { AgentRunView, RuntimeExecutionMetricsSnapshot } from '@contracts'

type Snapshot = RuntimeExecutionMetricsSnapshot
export type ExecutionMetricRun = Pick<AgentRunView, 'id' | 'executionEpoch' | 'status'>
export const EXECUTION_METRICS_POLL_MS = 4_000
const TERMINAL_TAIL_MS = [250, 1_000, 4_000] as const
const RETRY_MS = [1_000, 2_000, 5_000] as const
const MAX_RUNS = 500
const ACTIVE_STATUSES = new Set(['running', 'waiting'])

export function executionMetricRunActive(run: ExecutionMetricRun): boolean {
  return ACTIVE_STATUSES.has(run.status)
}

/** A finalized partial sum is still partial; cache is already included in Input. */
export function executionUsageTotal(run: ExecutionMetricRun, usage: Snapshot['runs'][number] | null): number | null {
  if (run.status !== 'succeeded' || usage?.finalizedAt == null || usage.inputOutputComplete !== true
    || usage.promptInputTotalTokens === null || usage.outputTokens === null) return null
  return usage.promptInputTotalTokens + usage.outputTokens
}

function sameFields<T extends object>(left: T, right: T, ignored?: keyof T): boolean {
  const keys = Object.keys(left) as Array<keyof T>
  return keys.length === Object.keys(right).length && keys.every(key => key === ignored || Object.is(left[key], right[key]))
}

/** Only requested Run rows are replaced/removed. Session rows are an authoritative current view. */
export function mergeExecutionMetrics(
  previous: Snapshot | null,
  incoming: Snapshot,
  requestedIds: readonly string[],
  ownedRuns: readonly ExecutionMetricRun[]
): Snapshot {
  const epochs = new Map(ownedRuns.map(run => [run.id, run.executionEpoch]))
  const requested = new Set(requestedIds)
  const priorRuns = new Map(previous?.runs.map(run => [run.agentRunId, run]) ?? [])
  const runs = new Map<string, Snapshot['runs'][number]>()
  for (const next of incoming.runs) {
    if (!requested.has(next.agentRunId) || epochs.get(next.agentRunId) !== next.executionEpoch) continue
    const old = priorRuns.get(next.agentRunId)
    runs.set(next.agentRunId, old && sameFields(old, next) ? old : next)
  }
  for (const old of previous?.runs ?? []) {
    if (runs.size >= MAX_RUNS) break
    if (!requested.has(old.agentRunId) && epochs.get(old.agentRunId) === old.executionEpoch) {
      runs.set(old.agentRunId, old)
    }
  }
  // Keep incumbent ordering so a different query order cannot invalidate stable objects.
  const mergedRuns = [...runs.values()].sort((a, b) => a.agentRunId.localeCompare(b.agentRunId))
  const priorSessions = new Map(previous?.sessions.map(session => [session.conversationId, session]) ?? [])
  const sessions = incoming.sessions.map(next => {
    const old = priorSessions.get(next.conversationId)
    // Freshness stays current in Core; it is not rendered by this reader.
    return old && sameFields(old, next, 'observedAt') ? old : next
  }).sort((a, b) => a.conversationId.localeCompare(b.conversationId))
  const sameRuns = previous && mergedRuns.length === previous.runs.length
    && mergedRuns.every((run, index) => run === previous.runs[index])
  const sameSessions = previous && sessions.length === previous.sessions.length
    && sessions.every((session, index) => session === previous.sessions[index])
  if (sameRuns && sameSessions) return previous
  return { schemaVersion: 1, runs: sameRuns ? previous.runs : mergedRuns, sessions: sameSessions ? previous.sessions : sessions }
}

export interface ExecutionMetricsScope {
  visible: boolean
  runs: readonly ExecutionMetricRun[]
  visibleRunIds: ReadonlySet<string>
  expandedRunIds: ReadonlySet<string>
}

/** One mounted Camp/agent reader: bounded cache, one request, coalesced invalidation and finite tails. */
export class ExecutionMetricsReader {
  private scope: ExecutionMetricsScope = { visible: false, runs: [], visibleRunIds: new Set(), expandedRunIds: new Set() }
  private scopeKey = ''
  private revision = 0
  private snapshot: Snapshot | null = null
  private pendingAll = false
  private pendingIds = new Set<string>()
  private inFlight = false
  private disposed = false
  private failures = 0
  private scheduled: ReturnType<typeof setTimeout> | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private tails = new Set<ReturnType<typeof setTimeout>>()

  constructor(
    private readonly read: (ids: string[]) => Promise<Snapshot>,
    private readonly publish: (snapshot: Snapshot) => void
  ) {}

  setScope(next: ExecutionMetricsScope): void {
    if (this.disposed) return
    const old = this.scope
    const key = JSON.stringify([next.visible, next.runs.map(run => [run.id, run.executionEpoch, run.status]),
      [...next.visibleRunIds].sort(), [...next.expandedRunIds].sort()])
    this.scope = next
    if (key === this.scopeKey) return
    this.scopeKey = key
    this.revision++
    const priorRuns = new Map(old.runs.map(run => [run.id, run]))
    for (const run of next.runs) {
      const prior = priorRuns.get(run.id)
      if (prior && executionMetricRunActive(prior) && !executionMetricRunActive(run)) {
        this.scheduleTail(run.id)
      }
    }
    for (const id of next.expandedRunIds) {
      if (!old.expandedRunIds.has(id)) this.pendingIds.add(id)
    }
    this.stopPoll()
    if (!next.visible) {
      this.clearScheduled()
      this.clearTails()
      this.pendingAll = true
      return
    }
    if (next.runs.some(executionMetricRunActive)) {
      this.poll = setInterval(() => {
        for (const run of this.scope.runs) if (executionMetricRunActive(run)) this.pendingIds.add(run.id)
        this.schedule(0)
      }, EXECUTION_METRICS_POLL_MS)
    }
    this.invalidate(true)
  }

  invalidate(immediate = false): void {
    if (this.disposed) return
    this.pendingAll = true
    this.failures = 0
    this.schedule(immediate ? 0 : 80)
  }

  dispose(): void {
    this.disposed = true
    this.clearScheduled()
    this.clearTails()
    this.stopPoll()
  }

  private selectedIds(): string[] {
    return this.scope.runs.filter(run => executionMetricRunActive(run) || this.scope.visibleRunIds.has(run.id))
      .map(run => run.id)
  }

  private schedule(delay: number): void {
    if (this.disposed || !this.scope.visible || this.inFlight) return
    if (delay === 0) this.clearScheduled()
    if (this.scheduled !== null) return
    this.scheduled = setTimeout(() => { this.scheduled = null; void this.drain() }, delay)
  }

  private async drain(): Promise<void> {
    if (this.disposed || !this.scope.visible || this.inFlight) return
    const owned = new Set(this.scope.runs.map(run => run.id))
    const ids = [...new Set([...(this.pendingAll ? this.selectedIds() : []), ...this.pendingIds])]
      .filter(id => owned.has(id)).slice(0, MAX_RUNS)
    const revision = this.revision
    this.pendingAll = false
    this.pendingIds.clear()
    this.inFlight = true
    let retryDelay = 0
    try {
      const next = await this.read(ids)
      if (this.disposed) return
      if (revision !== this.revision || !this.scope.visible) {
        this.pendingAll = true
      } else if (next.schemaVersion === 1) {
        const merged = mergeExecutionMetrics(this.snapshot, next, ids, this.scope.runs)
        if (merged !== this.snapshot) { this.snapshot = merged; this.publish(merged) }
        this.failures = 0
      }
    } catch {
      // A failed optional read retains known values and retries only a bounded number of times.
      retryDelay = RETRY_MS[this.failures++] ?? 0
      if (retryDelay) this.pendingAll = true
    } finally {
      this.inFlight = false
      if (this.pendingAll || this.pendingIds.size) this.schedule(retryDelay || 0)
    }
  }

  private scheduleTail(id: string): void {
    if (!this.scope.visible) return
    for (const delay of TERMINAL_TAIL_MS) {
      const timer = setTimeout(() => {
        this.tails.delete(timer)
        this.pendingIds.add(id)
        this.schedule(0)
      }, delay)
      this.tails.add(timer)
    }
  }

  private clearScheduled(): void { if (this.scheduled !== null) clearTimeout(this.scheduled); this.scheduled = null }
  private clearTails(): void { for (const timer of this.tails) clearTimeout(timer); this.tails.clear() }
  private stopPoll(): void { if (this.poll !== null) clearInterval(this.poll); this.poll = null }
}
