import type { ForkThreadRequest, ForkThreadResult, StoredCommandResult } from '@contracts'
import type { ThreadClient } from './camp-client'

type SavedFork = ForkThreadRequest & { threadId?: string }
export type ThreadForkState = { phase: 'idle' | 'pending' | 'unknown' | 'ready' | 'rejected'; saved?: SavedFork; error?: string }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function browserStorage(): StoragePort | null {
  try { return window.localStorage } catch { return null }
}

/** One foreground command and its receipt, owned by the application rather than
 * a mounted workspace. Only request/result identifiers survive a refresh. */
export class ThreadForkOperation {
  private state: ThreadForkState = { phase: 'idle' }
  private listeners = new Set<() => void>()
  private inFlight = false
  private restored = false
  private key: string | null
  constructor(private client: Pick<ThreadClient, 'request'>, scope?: string,
    private storage: StoragePort | null = browserStorage()) {
    this.key = scope ? `rovai.thread-fork.v1:${encodeURIComponent(scope)}` : null
    try {
      const raw = this.key && storage?.getItem(this.key)
      const value = raw ? JSON.parse(raw) as SavedFork : null
      if (value && typeof value.commandId === 'string' && value.commandId
        && typeof value.sourceThreadId === 'string' && value.sourceThreadId
        && (value.sourceMessageId === undefined || typeof value.sourceMessageId === 'string')
        && (value.threadId === undefined || typeof value.threadId === 'string')) {
        const saved = { commandId: value.commandId, sourceThreadId: value.sourceThreadId,
          ...(value.sourceMessageId !== undefined ? { sourceMessageId: value.sourceMessageId } : {}),
          ...(value.threadId ? { threadId: value.threadId } : {}) }
        this.state = { phase: saved.threadId ? 'ready' : 'unknown', saved }
      }
    } catch { /* A malformed locator never becomes a request. */ }
  }
  getSnapshot = (): ThreadForkState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(state: ThreadForkState): void { this.state = state; for (const listener of this.listeners) listener() }
  private save(saved?: SavedFork): void {
    if (!this.key) return
    if (!this.storage) throw new Error('无法保存分叉请求，请检查本机存储后重试')
    if (saved) this.storage.setItem(this.key, JSON.stringify(saved))
    else this.storage.removeItem(this.key)
  }
  dismiss(): void {
    if (this.inFlight || this.state.phase === 'unknown') return
    try { this.save(); this.publish({ phase: 'idle' }) } catch (error) { this.publish({ ...this.state, error: String(error) }) }
  }
  private accept(result: StoredCommandResult, saved: SavedFork): string | null {
    if (result.status === 'rejected') {
      this.save()
      this.publish({ phase: 'rejected', error: result.code === 'camp.fork_anchor_unavailable'
        ? '这条消息已不可用，无法从这里分叉' : String(result.payload.message ?? result.code) })
      return null
    }
    const target = (result.payload as Partial<ForkThreadResult>).threadId
    if (typeof target !== 'string' || !target) throw new Error('分叉结果尚未确认')
    const ready = { ...saved, threadId: target }
    // Remember the target even if local storage fails; opening can never copy again.
    this.publish({ phase: 'ready', saved: ready })
    try { this.save(ready) } catch (error) { this.publish({ phase: 'ready', saved: ready, error: String(error) }); return null }
    return target
  }
  async start(request: ForkThreadRequest): Promise<string | null> {
    if (this.inFlight || ['pending', 'unknown'].includes(this.state.phase)) return null
    const saved = { ...request }
    try { this.save(saved) } catch (error) { this.publish({ phase: 'rejected', error: String(error) }); return null }
    this.publish({ phase: 'pending', saved })
    return this.execute(saved, false)
  }
  /** Refresh only looks up a receipt; explicit retry may resubmit the original request. */
  async recover(): Promise<void> {
    if (this.restored) return
    this.restored = true
    if (this.state.phase === 'unknown') await this.execute(this.state.saved!, true)
  }
  async retry(): Promise<string | null> {
    if (this.inFlight || this.state.phase !== 'unknown') return null
    return this.execute(this.state.saved!, false, true)
  }
  private async execute(saved: SavedFork, receiptOnly: boolean, checkReceipt = false): Promise<string | null> {
    if (this.inFlight || saved.threadId) return saved.threadId ?? null
    this.inFlight = true
    this.publish({ phase: 'pending', saved })
    try {
      if (receiptOnly || checkReceipt) {
        const receipt = await this.client.request<{ state: 'recorded' | 'unknown'; result?: StoredCommandResult }>(
          'commands.reconcile', { operation: 'threads.fork', params: saved })
        if (receipt.state === 'recorded' && receipt.result) return this.accept(receipt.result, saved)
        if (receiptOnly) { this.publish({ phase: 'unknown', saved }); return null }
      }
      return this.accept(await this.client.request<StoredCommandResult>('threads.fork', saved), saved)
    } catch (error) {
      if (this.state.saved?.threadId) this.publish({ ...this.state, error: String(error) })
      else this.publish({ phase: 'unknown', saved, error: String(error) })
      return null
    } finally { this.inFlight = false }
  }
  persistTarget(): string | null {
    const saved = this.state.saved
    if (!saved?.threadId) return null
    this.save(saved)
    return saved.threadId
  }
}
