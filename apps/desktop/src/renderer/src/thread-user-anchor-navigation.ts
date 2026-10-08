import { uiAttribute } from './interface-language'
import type { ThreadMessageAroundSnapshot, ThreadMessageChange, ThreadMessageView,
  ThreadUserAnchor, ThreadUserAnchorIndex, ThreadUserAnchorPreview } from '@contracts'
import type { ThreadClient } from './camp-client'
import type { UserMessageAnchor } from './user-message-anchors'

export type AnchorPreviewState = { status: 'loading' | 'error' }
  | { status: 'ready'; value: ThreadUserAnchorPreview }
export interface UserAnchorState {
  index: ThreadUserAnchorIndex | null
  status: 'loading' | 'ready' | 'error'
  anchors: readonly UserMessageAnchor[]
  previews: ReadonlyMap<string, AnchorPreviewState>
  window: ThreadMessageAroundSnapshot | null
}

export const navigableUserMessage = (message: ThreadMessageView): boolean => !message.withdrawn
  && !message.missionStart && (message.authorType === 'user' || message.authorType === 'external_principal')

/** The same identity can arrive from a newer snapshot or an older navigation window. */
export function mergeNavigationMessages(...groups: readonly (readonly ThreadMessageView[])[]): ThreadMessageView[] {
  const messages = new Map<string, ThreadMessageView>()
  for (const group of groups) for (const message of group) {
    const previous = messages.get(message.id)
    if (!previous || message.version > previous.version
      || (message.version === previous.version && (!previous.withdrawn || message.withdrawn))) {
      messages.set(message.id, message)
    }
  }
  return [...messages.values()].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
}

/** One Thread's navigation state. No body pagination state or reply relationship inference lives here. */
export class ThreadUserAnchorNavigation {
  #state: UserAnchorState = { index: null, status: 'loading', anchors: [], previews: new Map(), window: null }
  #listeners = new Set<() => void>()
  #active = false
  #indexGeneration = 0
  #previewGeneration = 0
  #navigationGeneration = 0
  #indexWatermark = 0
  #previewWatermark = 0
  #refreshTimer: ReturnType<typeof setTimeout> | null = null
  #previewTimer: ReturnType<typeof setTimeout> | null = null
  #previewRequests = new Map<string, Promise<void>>()
  #indexedById = new Map<string, ThreadUserAnchor>()
  #indexTrusted = false
  #indexRequest: { generation: number; promise: Promise<void> } | null = null
  #known = new Map<string, ThreadMessageView>()
  #unavailable = new Set<string>()
  #confirmed: UserMessageAnchor[] = []
  #confirmedSequences = new Map<string, number>()
  #unsubscribers: (() => void)[] = []
  constructor(readonly threadId: string, readonly client: ThreadClient) {}
  getSnapshot = (): UserAnchorState => this.#state
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  #set(patch: Partial<UserAnchorState>): void {
    this.#state = { ...this.#state, ...patch }
    for (const listener of this.#listeners) listener()
  }
  start(): () => void {
    this.#indexTrusted = false
    this.#active = true
    this.#unsubscribers = [
      this.client.onEvent?.(event => {
        if (event.method === 'thread.messages.changed') this.changed(event.params as ThreadMessageChange)
        if (event.method === 'runtime.state' && (event.params as { status?: string })?.status === 'ready') this.resync()
      }),
      this.client.onInvalidated?.(change => {
        if (!change || change.resync) this.resync()
        else for (const message of change.messages ?? []) this.changed(message)
      })
    ].filter((value): value is () => void => Boolean(value))
    void this.refresh()
    return () => {
      this.#active = false
      this.#indexTrusted = false
      this.#indexGeneration++; this.#previewGeneration++; this.#navigationGeneration++
      for (const unsubscribe of this.#unsubscribers) unsubscribe()
      this.cancelPreview()
      if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
      this.#refreshTimer = null
      this.#previewRequests.clear()
      this.#known.clear()
      this.#set({ window: null, previews: new Map() })
    }
  }
  changed(change: ThreadMessageChange): void {
    if (change.threadId !== this.threadId) return
    for (const id of change.unavailableMessageIds ?? []) this.#unavailable.add(id)
    if (change.unavailableMessageIds?.length) {
      this.#rebuildAnchors()
      if (this.#state.window) this.#set({ window: { ...this.#state.window, messages: this.#state.window.messages.filter(message => !this.#unavailable.has(message.id)) } })
    }
    this.#previewWatermark = Math.max(this.#previewWatermark, change.throughGlobalSequence)
    this.invalidatePreviews()
    if (change.indexChanged) {
      this.#indexWatermark = Math.max(this.#indexWatermark, change.throughGlobalSequence)
      this.queueRefresh()
    }
  }
  resync(): void { this.invalidatePreviews(); this.queueRefresh() }
  invalidatePreviews(): void {
    this.#previewGeneration++
    this.#previewRequests.clear()
    if (this.#state.previews.size) this.#set({ previews: new Map() })
  }
  queueRefresh(): void {
    this.#indexTrusted = false
    this.#indexGeneration++ // reject an in-flight read immediately, before the coalescing timer
    if (!this.#active || this.#refreshTimer) return
    this.#refreshTimer = setTimeout(() => { this.#refreshTimer = null; void this.refresh() }, 100)
  }
  refresh = (): Promise<void> => {
    if (!this.#active) return Promise.resolve()
    if (this.#indexRequest?.generation === this.#indexGeneration) return this.#indexRequest.promise
    if (this.#refreshTimer) clearTimeout(this.#refreshTimer)
    this.#refreshTimer = null
    if (this.#indexTrusted) this.#indexGeneration++
    this.#indexTrusted = false
    const generation = this.#indexGeneration
    const promise = this.#readIndex(generation)
    this.#indexRequest = { generation, promise }
    void promise.finally(() => { if (this.#indexRequest?.promise === promise) this.#indexRequest = null })
    return promise
  }
  async #readIndex(generation: number): Promise<void> {
    this.#set({ status: 'loading' })
    try {
      const confirmedBeforeRead = new Set(this.#confirmedSequences.keys())
      const index = await this.client.request<ThreadUserAnchorIndex>('thread.messages.anchors', { threadId: this.threadId })
      if (!index) throw new Error('anchor index unavailable')
      if (!this.#active || generation !== this.#indexGeneration) return
      if (index.threadId !== this.threadId) throw new Error('anchor index identity mismatch')
      if (index.throughGlobalSequence < this.#indexWatermark) {
        throw new Error('anchor index watermark regressed')
      }
      const ids = new Set(index.items.map(item => item.messageId))
      for (const item of index.items) {
        const known = this.#known.get(item.messageId)
        if (!known || navigableUserMessage(known)) this.#unavailable.delete(item.messageId)
      }
      for (const item of this.#state.index?.items ?? []) if (!ids.has(item.messageId)) this.#unavailable.add(item.messageId)
      // This read can retire missing receipts only if they were public before it started.
      for (const id of confirmedBeforeRead) if (!ids.has(id)) this.#unavailable.add(id)
      this.#indexedById = new Map(index.items.map(item => [item.messageId, item]))
      this.#indexTrusted = true
      this.#set({ index, status: 'ready' })
      this.#rebuildAnchors()
    } catch {
      if (this.#active && generation === this.#indexGeneration) this.#set({ status: 'error' })
    }
  }
  #rebuildAnchors(): void {
    this.#confirmed = this.#confirmed.filter(item => {
      if (!this.#indexedById.has(item.id) && !this.#unavailable.has(item.id)) return true
      this.#confirmedSequences.delete(item.id)
      return false
    })
    const items = (this.#state.index?.items ?? []).filter(item => !this.#unavailable.has(item.messageId))
      .map(item => ({ id: item.messageId, title: item.title, sequence: item.sequence }))
    const ids = new Set(items.map(item => item.id))
    for (const item of this.#confirmed) if (!ids.has(item.id) && !this.#unavailable.has(item.id)) {
      items.push({ ...item, sequence: this.#confirmedSequences.get(item.id)! })
    }
    items.sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
    this.#set({ anchors: items })
  }
  /** Only confirmed public send receipts enter the optimistic list. Private pending inputs never do. */
  observe(messages: readonly ThreadMessageView[], confirmed: readonly ThreadMessageView[], text: (message: ThreadMessageView) => string): void {
    let indexChanged = false
    let previewsChanged = false
    let removed = false
    const index = this.#indexedById
    for (const message of messages) {
      const previous = this.#known.get(message.id)
      if (previous && (previous.version > message.version
        || (previous.version === message.version && previous.withdrawn && !message.withdrawn))) continue
      this.#known.set(message.id, message)
      if (!previous || previous.version !== message.version || previous.withdrawn !== message.withdrawn) {
        if (message.authorType === 'agent') previewsChanged = true
        const item = index.get(message.id)
        const titleChanged = !previous || previous.body !== message.body
          || JSON.stringify(previous.content) !== JSON.stringify(message.content)
          || JSON.stringify(previous.attachments.map(value => value.displayName)) !== JSON.stringify(message.attachments.map(value => value.displayName))
          || JSON.stringify(previous.quotes.map(value => value.text)) !== JSON.stringify(message.quotes.map(value => value.text))
        if (item && (!navigableUserMessage(message) || (item.messageVersion < message.version && titleChanged))) indexChanged = true
      }
      if (!navigableUserMessage(message) && (index.has(message.id) || this.#confirmedSequences.has(message.id))
        && !this.#unavailable.has(message.id)) {
        this.#unavailable.add(message.id); removed = true
      }
    }
    for (const message of confirmed) {
      const known = this.#known.get(message.id)
      if (!message.id || !navigableUserMessage(message) || index.has(message.id)
        || this.#confirmedSequences.has(message.id) || this.#unavailable.has(message.id)
        || (known && !navigableUserMessage(known))) continue
      this.#confirmed.push({ id: message.id, title: text(message).replace(/\s+/gu, ' ').trim() || '（无文本）' })
      this.#confirmedSequences.set(message.id, message.sequence)
      indexChanged = true; removed = true
    }
    if (removed) this.#rebuildAnchors()
    if (previewsChanged) this.invalidatePreviews()
    if (indexChanged) this.queueRefresh()
  }
  cancelPreview = (): void => {
    if (this.#previewTimer) clearTimeout(this.#previewTimer)
    this.#previewTimer = null
  }
  preview = (messageId: string | null): void => {
    this.cancelPreview()
    if (!messageId) return
    this.#previewTimer = setTimeout(() => { this.#previewTimer = null; void this.readPreview(messageId) }, 120)
  }
  readPreview(messageId: string): Promise<void> {
    const running = this.#previewRequests.get(messageId)
    if (running) return running
    if (this.#state.previews.get(messageId)?.status === 'ready') return Promise.resolve()
    const generation = this.#previewGeneration
    const setPreview = (value: AnchorPreviewState): void => {
      const previews = new Map(this.#state.previews)
      previews.set(messageId, value)
      this.#set({ previews })
    }
    setPreview({ status: 'loading' })
    const request = this.client.request<ThreadUserAnchorPreview>('thread.messages.anchorPreview', { threadId: this.threadId, messageId })
      .then(value => {
        if (!this.#active || generation !== this.#previewGeneration) return
        if (value.threadId !== this.threadId || value.messageId !== messageId || value.throughGlobalSequence < this.#previewWatermark) {
          setPreview({ status: 'error' }); return
        }
        setPreview({ status: 'ready', value })
        if (!value.sourceAvailable) { this.#unavailable.add(messageId); this.#rebuildAnchors(); this.queueRefresh() }
      }).catch(() => { if (this.#active && generation === this.#previewGeneration) setPreview({ status: 'error' }) })
      .finally(() => { if (this.#previewRequests.get(messageId) === request) this.#previewRequests.delete(messageId) })
    this.#previewRequests.set(messageId, request)
    return request
  }
  currentNavigation(ticket: number): boolean { return this.#active && ticket === this.#navigationGeneration }
  cancelNavigation(): void { this.#navigationGeneration++ }
  async locate(messageId: string, displayed: ReadonlyMap<string, ThreadMessageView>): Promise<number | null> {
    const ticket = ++this.#navigationGeneration
    const message = displayed.get(messageId)
    const unavailable = (): never => { throw new Error(uiAttribute('这条用户消息当前不可用。')) }
    if (this.#unavailable.has(messageId) || (message && !navigableUserMessage(message))) return unavailable()
    // Keep the visible directory while resyncing, but wait for an already valid read
    // before trusting it. A queued/failed refresh falls back to around for validation.
    if (!this.#indexTrusted && this.#indexRequest?.generation === this.#indexGeneration) {
      await this.#indexRequest.promise
      if (!this.currentNavigation(ticket)) return null
      if (this.#unavailable.has(messageId)) return unavailable()
    }
    const item = this.#indexedById.get(messageId)
    // A fresh index verifies identity/navigation state; cached body must be at least that version.
    if (this.#indexTrusted && message && item && message.version >= item.messageVersion
      && this.#state.index!.throughGlobalSequence >= this.#indexWatermark) {
      return ticket
    }
    const validationGeneration = this.#indexGeneration
    try {
      const window = await this.client.request<ThreadMessageAroundSnapshot>('thread.messages.around', { threadId: this.threadId, messageId })
      if (!this.currentNavigation(ticket)) return null
      if (window.threadId !== this.threadId || window.anchorMessageId !== messageId) return unavailable()
      const target = window.messages.find(message => message.id === messageId)
      if (validationGeneration !== this.#indexGeneration || window.throughGlobalSequence < this.#indexWatermark || (target && item && target.version < item.messageVersion)) {
        throw new Error(uiAttribute('消息已更新，请重试定位。'))
      }
      if (!window.sourceAvailable || !target || !navigableUserMessage(target) || this.#unavailable.has(messageId)) {
        this.#unavailable.add(messageId); this.#rebuildAnchors(); this.queueRefresh(); return unavailable()
      }
      const ids = new Set(window.messages.map(message => message.id))
      const messages = mergeNavigationMessages(window.messages, [...this.#known.values()].filter(message => ids.has(message.id)))
      if (!navigableUserMessage(messages.find(message => message.id === messageId)!)) return unavailable()
      this.#set({ window: { ...window, messages } }) // replace, never accumulate navigation bodies
      return ticket
    } catch (error) { if (!this.currentNavigation(ticket)) return null; throw error }
  }
  windowMessages(): readonly ThreadMessageView[] {
    return (this.#state.window?.messages ?? []).filter(message => !this.#unavailable.has(message.id))
  }
}
