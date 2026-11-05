import type { AgentRunDiagnosticView, ThreadMessageChange, ThreadMessagePage, ThreadMessageView, ThreadOpenProjection } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import type { ThreadClient } from './camp-client'
import { samePublicMessageSegment } from './public-message-grouping'

export interface ConversationExportTarget { id: string; title: string }
export interface ConversationExportState {
  taskId: number
  target: ConversationExportTarget | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** The event watermark is not a database snapshot. This is a message-sequence bound. */
  upperSequence: number | null
  projection: ThreadOpenProjection | null
  messages: ThreadMessageView[] | null
}

/** Owns one export, independently of the browsing cache, navigation windows and scroll state. */
export class ConversationExportReader {
  #state: ConversationExportState = { taskId: 0, target: null, status: 'idle', upperSequence: null, projection: null, messages: null }
  #listeners = new Set<() => void>()
  #generation = 0
  #invalidationSequence = 0
  constructor(readonly client: ThreadClient) {}
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  getSnapshot = (): ConversationExportState => this.#state
  #set(state: ConversationExportState): void { this.#state = state; this.#listeners.forEach(listener => listener()) }
  start(): () => void {
    const stops = [
      this.client.onEvent?.(event => {
        if (event.method === 'thread.messages.changed') this.changed(event.params as ThreadMessageChange)
        if (event.method === 'runtime.state' && (event.params as { status?: string })?.status === 'ready') this.invalidate()
      }),
      this.client.onInvalidated?.(change => {
        if (!change || change.resync) this.invalidate()
        else change.messages?.forEach(message => this.changed(message))
      })
    ]
    return () => { stops.forEach(stop => stop?.()); this.close() }
  }
  open = (target: ConversationExportTarget): void => {
    this.#invalidationSequence = 0
    this.#begin(target, null)
  }
  close = (): void => {
    this.#generation++
    this.#set({ taskId: this.#generation, target: null, status: 'idle', upperSequence: null, projection: null, messages: null })
  }
  /** A user retry is a new task with a fresh tail and a fresh upper bound. */
  retry = (): void => { if (this.#state.target) this.open(this.#state.target) }
  changed(change: ThreadMessageChange): void {
    if (change.threadId !== this.#state.target?.id || !change.unavailableMessageIds?.length
      || change.throughGlobalSequence <= this.#invalidationSequence) return
    this.#invalidationSequence = change.throughGlobalSequence
    // A removal can arrive before its page response. Invalidate even if that ID is not collected yet.
    this.invalidate()
  }
  invalidate = (): void => {
    if (this.#state.target && this.#state.status !== 'error') this.#begin(this.#state.target, this.#state.upperSequence)
  }
  #begin(target: ConversationExportTarget, upperSequence: number | null): void {
    const generation = ++this.#generation
    // Hide stale content synchronously, including an already-open preview.
    this.#set({ taskId: generation, target, status: 'loading', upperSequence, projection: null, messages: null })
    void this.#read(target, generation, upperSequence)
  }
  async #read(target: ConversationExportTarget, generation: number, bound: number | null): Promise<void> {
    const current = () => generation === this.#generation
    try {
      const projection = await this.client.request<ThreadOpenProjection>('threads.open', { traceId: newCommandId(), threadId: target.id })
      if (!current()) return
      const coverage = projection?.coverage?.messages
      if (projection?.schemaVersion !== 9 || projection.thread.id !== target.id || !coverage || typeof coverage.hasEarlier !== 'boolean'
        || !Number.isSafeInteger(projection.throughGlobalSequence) || projection.throughGlobalSequence < 0
        || !orderedMessages(projection.messages)
        || (coverage.hasEarlier && !projection.messages.length)
        || coverage.oldestLoadedSequence !== (projection.messages[0]?.sequence ?? null)
        || coverage.newestLoadedSequence !== (projection.messages.at(-1)?.sequence ?? null)) throw new Error('Invalid export tail')
      const upperSequence = bound ?? coverage.newestLoadedSequence ?? 0
      this.#set({ ...this.#state, upperSequence })
      const messages = new Map<string, ThreadMessageView>()
      const collect = (page: ThreadMessageView[]) => page.forEach(message => {
        if (message.sequence <= upperSequence) messages.set(message.id, message)
      })
      collect(projection.messages)
      let before: number | null = coverage.oldestLoadedSequence
      let hasMore = coverage.hasEarlier
      while (hasMore) {
        if (!current() || before === null) return
        const page: ThreadMessagePage = await this.client.request<ThreadMessagePage>('thread.messages.page', {
          threadId: target.id, beforeSequence: before, throughGlobalSequence: projection.throughGlobalSequence, limit: 100
        })
        if (!current()) return
        if (page?.schemaVersion !== 1 || page.threadId !== target.id
          || page.throughGlobalSequence !== projection.throughGlobalSequence || page.requestedBeforeSequence !== before
          || !orderedMessages(page.messages) || page.messages.length > 100
          || page.messages.some(message => message.sequence >= before!)
          || page.hasMore !== (page.nextBeforeSequence !== null)
          || (page.hasMore && (page.nextBeforeSequence !== page.messages[0]?.sequence || page.nextBeforeSequence! >= before))) throw new Error('Invalid export page')
        collect(page.messages)
        hasMore = page.hasMore
        before = page.nextBeforeSequence
      }
      const ordered = [...messages.values()].sort((a, b) => a.sequence - b.sequence)
      const resolved = await resolveLegacyGroupTurns(this.client, projection, ordered, current)
      if (current()) this.#set({ taskId: generation, target, status: 'ready', upperSequence, projection, messages: resolved })
    } catch {
      if (current()) this.#set({ ...this.#state, status: 'error', projection: null, messages: null })
    }
  }
}

/** Modern messages carry their Turn. Read only missing legacy Run identities that could affect a group. */
async function resolveLegacyGroupTurns(client: ThreadClient, projection: ThreadOpenProjection, messages: ThreadMessageView[], current: () => boolean): Promise<ThreadMessageView[]> {
  const turns = new Map((projection.agentRuns ?? []).map(run => [run.id, run.threadTurnId]))
  const missing = new Set<string>()
  for (let index = 0; index < messages.length - 1; index++) {
    const left = messages[index], right = messages[index + 1]
    if (!left.sourceAgentRunId || !right.sourceAgentRunId || left.sourceAgentRunId === right.sourceAgentRunId
      || !samePublicMessageSegment({ ...left, threadTurnId: 'candidate' }, { ...right, threadTurnId: 'candidate' })) continue
    for (const message of [left, right]) if (!message.threadTurnId && !turns.has(message.sourceAgentRunId!)) missing.add(message.sourceAgentRunId!)
  }
  const queue = [...missing]
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (current() && queue.length) {
      const agentRunId = queue.shift()!
      try {
        const run = await client.request<AgentRunDiagnosticView | null>('agentRuns.diagnostic.get', { agentRunId })
        if (current() && run?.agentRunId === agentRunId && run.threadId === projection.thread.id) turns.set(agentRunId, run.threadTurnId)
      } catch { /* Missing old Run metadata keeps separate timestamps instead of guessing a group. */ }
    }
  }))
  return messages.map(message => !message.threadTurnId && message.sourceAgentRunId && turns.get(message.sourceAgentRunId)
    ? { ...message, threadTurnId: turns.get(message.sourceAgentRunId)! } : message)
}

function orderedMessages(messages: ThreadMessageView[]): boolean {
  return Array.isArray(messages) && messages.every((message, index) => message.id && Number.isSafeInteger(message.sequence)
    && message.sequence > 0 && (index === 0 || message.sequence > messages[index - 1].sequence))
}
