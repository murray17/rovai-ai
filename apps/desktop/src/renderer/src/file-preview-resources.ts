import type { FilePreviewApi, FilePreviewRetentionState } from '@contracts'
import { filePreviewRetentionLimits } from '../../file-preview-retention'
import { createFilePreviewSession, type FilePreviewContent, type FilePreviewSession, type FilePreviewTabModel } from './file-preview-controller'
import { filePreviewSessionStore, restorableFilePreviewRequest } from './file-preview-session'

function bytes(content: FilePreviewContent | null): number {
  if (!content) return 0
  if (content.kind === 'image') return content.bytes
  if (content.kind === 'page') return content.page.text.length * 2
  return 'text' in content ? content.text.length * 2 : 0
}

/** Window-owned resource lifetime. React only subscribes and displays these sessions. */
export class FilePreviewResources {
  readonly sessions = new Map<string, FilePreviewSession>()
  readonly #listeners = new Set<() => void>()
  readonly #unsubscribe: (() => void)[] = []
  #connected = false
  #owners = 0
  readonly #empty: FilePreviewSession
  #sequence = 0
  #revision = 0
  #scheduled = false
  #disposed = false
  #htmlReservations = 0
  #syncTail = Promise.resolve()
  currentThreadId: string | null = null

  constructor(readonly api: FilePreviewApi, readonly limits: Readonly<Record<keyof typeof filePreviewRetentionLimits, number>> = filePreviewRetentionLimits) {
    this.#empty = createFilePreviewSession(api, '', this)
  }

  #connect(): void {
    if (this.#connected) return
    this.#connected = true
    const api = this.api
    this.#unsubscribe.push(api.onExternalUpdate(event => this.sessions.get(event.threadId)?.externalUpdate(event.previewKeys)),
      filePreviewSessionStore.onDiscard(threadId => this.discard(threadId)))
    const unsubscribe = api.onResourcesReleased?.(event => {
      const ids = new Set(event.handleIds)
      for (const session of this.sessions.values()) for (const tab of session.getSnapshot().tabs) {
        if (tab.kind === 'file' && tab.file && ids.has(tab.file.handleId)) session.evict(tab.id, true, true)
      }
    })
    if (unsubscribe) this.#unsubscribe.push(unsubscribe)
  }

  retainOwner(): () => void {
    this.#owners++
    return () => { this.#owners--; queueMicrotask(() => { if (this.#owners === 0) this.dispose() }) }
  }

  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  getSnapshot = (): number => this.#revision
  isCurrent = (threadId: string): boolean => this.currentThreadId === threadId

  session(threadId: string): FilePreviewSession {
    if (!threadId) return this.#empty
    let session = this.sessions.get(threadId)
    if (!session) {
      session = createFilePreviewSession(this.api, threadId, this)
      this.sessions.set(threadId, session)
    }
    return session
  }

  activate(threadId: string | null): void {
    this.#connect()
    if (this.currentThreadId === threadId) return
    this.currentThreadId = threadId
    const session = threadId ? this.session(threadId) : null
    if (session?.getSnapshot().tabs.length) this.touch(session, session.getSnapshot().activeTabId ?? undefined)
    // Admission precedes cold reads; cached display never waits on this promise.
    this.prune()
    const binding = this.sync().then(() => this.api.bindThread(threadId))
    session?.setBinding(binding)
    session?.ensureActive()
    this.changed()
  }

  touch = (session: FilePreviewSession, tabId?: string): void => {
    session.lastUsed = ++this.#sequence
    if (tabId) session.tabUsage.set(tabId, this.#sequence)
    filePreviewSessionStore.touch(session.threadId)
    this.changed()
  }

  changed = (): void => {
    if (this.#disposed) return
    this.#revision++
    for (const listener of this.#listeners) listener()
    if (this.#scheduled) return
    this.#scheduled = true
    queueMicrotask(() => {
      this.#scheduled = false
      if (this.#disposed) return
      this.prune()
      void this.sync().catch(() => undefined)
    })
  }

  visible(session: FilePreviewSession, tabId: string): boolean {
    const state = session.getSnapshot()
    return this.isCurrent(session.threadId) && state.paneVisible && state.activeTabId === tabId
  }

  #entries(): { session: FilePreviewSession; tab: FilePreviewTabModel; visible: boolean; usage: number; recoverable: boolean }[] {
    return [...this.sessions.values()].flatMap(session => session.getSnapshot().tabs.flatMap(tab => tab.kind === 'file'
      ? [{
        session, tab, visible: this.visible(session, tab.id), usage: session.tabUsage.get(tab.id) ?? session.lastUsed,
        recoverable: !!(tab.sourceRequest && restorableFilePreviewRequest(tab.sourceRequest))
      }] : []))
  }

  admit(session: FilePreviewSession): boolean {
    const hot = [...this.sessions.values()].filter(value => value.pendingOpens > 0 || value.getSnapshot().tabs.some(tab => tab.kind === 'file'
      ? !!(tab.content || tab.file || tab.candidate || tab.loadState === 'opening') : tab.kind === 'file_change' && (!!tab.detail || tab.detailStatus === 'loading')))
    if (hot.includes(session) || hot.length < this.limits.hotThreads) return true
    const victim = hot.filter(value => value !== session && !this.isCurrent(value.threadId)
      && value.getSnapshot().tabs.every(tab => tab.kind !== 'file' || !tab.content || !!(tab.sourceRequest && restorableFilePreviewRequest(tab.sourceRequest))))
      .sort((a, b) => a.lastUsed - b.lastUsed)[0]
    if (!victim) return false
    victim.cool()
    return true
  }

  sync = (): Promise<void> => {
    if (!this.api.updateRetention) return Promise.resolve()
    const state: FilePreviewRetentionState = {
      sessions: [...this.sessions.values()].filter(session => session.getSnapshot().tabs.length > 0 || session.pendingOpens > 0 || this.isCurrent(session.threadId)).map(session => ({ threadId: session.threadId, previewSessionId: session.id })),
      handles: this.#entries().flatMap(({ session, tab, usage, visible, recoverable }) => [
        ...(tab.file ? [{
          handleId: tab.file.handleId, previewSessionId: session.id, tabId: tab.id, lastUsed: usage,
          visible, busy: tab.loadState === 'opening' || tab.isRefreshing, recoverable
        }] : []),
        ...(tab.candidate ? [{
          handleId: tab.candidate.file.handleId, previewSessionId: session.id, tabId: tab.id,
          lastUsed: usage, visible: false, busy: true, recoverable
        }] : [])
      ])
    }
    const next = this.#syncTail.catch(() => undefined).then(() => this.api.updateRetention!(state))
    this.#syncTail = next
    return next
  }

  prune(): void {
    const hot = [...this.sessions.values()].filter(session => session.pendingOpens > 0 || session.getSnapshot().tabs.some(tab => tab.kind === 'file'
      && (tab.content || tab.file || tab.loadState === 'opening' || tab.candidate) || tab.kind === 'file_change' && (tab.detail || tab.detailStatus === 'loading')))
    for (const session of hot.sort((a, b) => a.lastUsed - b.lastUsed)) {
      if (hot.length <= this.limits.hotThreads) break
      if (this.isCurrent(session.threadId)) continue
      const tabs = session.getSnapshot().tabs.filter(tab => tab.kind === 'file') as FilePreviewTabModel[]
      if (tabs.some(tab => tab.content && (!tab.sourceRequest || !restorableFilePreviewRequest(tab.sourceRequest)))) continue
      session.cool()
      hot.splice(hot.indexOf(session), 1)
    }
    let entries = this.#entries()
    const estimated = (): number => {
      const seen = new Set<unknown>()
      let total = 0
      for (const { tab, visible } of entries) {
        if (visible) continue
        for (const content of [tab.content, tab.candidate?.loaded.content]) {
          if (!content || seen.has(content)) continue
          seen.add(content); total += bytes(content)
        }
        for (const page of Object.values(tab.pages ?? {})) {
          if (tab.content?.kind === 'page' && page === tab.content.page || seen.has(page)) continue
          seen.add(page); total += page.text.length * 2
        }
        if (tab.htmlSource) {
          const pages = Object.values(tab.htmlSource.pages ?? {})
          if (!pages.length) total += tab.htmlSource.text.length * 2
          for (const page of pages) if (!seen.has(page)) { seen.add(page); total += page.text.length * 2 }
        }
      }
      for (const session of this.sessions.values()) for (const tab of session.getSnapshot().tabs)
        if (tab.kind === 'file_change' && !this.visible(session, tab.id)) total += tab.detailBytes ?? 0
      return total
    }
    const candidates = [...entries, ...[...this.sessions.values()].flatMap(session => session.getSnapshot().tabs.flatMap(tab => tab.kind === 'file_change'
      ? [{ session, tab, usage: session.tabUsage.get(tab.id) ?? session.lastUsed, visible: this.visible(session, tab.id), recoverable: true }] : []))]
    for (const entry of candidates.sort((a, b) => a.usage - b.usage)) {
      if (estimated() <= this.limits.backgroundBytes) break
      if (entry.visible || !entry.recoverable || entry.tab.kind === 'file' && (entry.tab.isRefreshing || entry.tab.loadState === 'opening') || entry.tab.kind === 'file_change' && entry.tab.detailStatus === 'loading') continue
      entry.session.evictBytes(entry.tab.id)
      entries = this.#entries()
    }
    const protectedThreads = [...this.sessions.values()].filter(session => this.isCurrent(session.threadId)
      || session.pendingOpens > 0 || session.getSnapshot().tabs.some(tab => tab.kind === 'file' && (tab.content || tab.file || tab.loadState === 'opening') || tab.kind === 'file_change' && (tab.detail || tab.detailStatus === 'loading')))
    filePreviewSessionStore.protect(protectedThreads.map(session => session.threadId))
    const cold = [...this.sessions.values()].filter(session => !protectedThreads.includes(session)).sort((a, b) => a.lastUsed - b.lastUsed)
    for (const session of cold) {
      if (this.sessions.size <= this.limits.snapshots) break
      this.discard(session.threadId)
      filePreviewSessionStore.discard(session.threadId)
    }
  }

  reserveHtml = async (session: FilePreviewSession, tabId: string): Promise<(() => void) | null> => {
    const entries = this.#entries()
    let count = this.#htmlReservations + [...this.sessions.values()].reduce((n, session) => n + [...session.retired.values()].filter(value => value.content?.kind === 'html').length, 0) + entries.reduce((n, { tab }) => n + Number(tab.content?.kind === 'html') + Number(tab.candidate?.loaded.content.kind === 'html'), 0)
    for (const entry of entries.sort((a, b) => a.usage - b.usage)) {
      if (count < this.limits.htmlInstances) break
      if (entry.tab.content?.kind !== 'html' || entry.visible || !entry.recoverable || entry.tab.isRefreshing
        || entry.session === session && entry.tab.id === tabId) continue
      entry.session.evict(entry.tab.id, false, false, true)
      count--
    }
    if (count >= this.limits.htmlInstances) return null
    this.#htmlReservations++
    let released = false
    return () => { if (!released) { released = true; this.#htmlReservations-- } }
  }

  discard(threadId: string): void {
    const session = this.sessions.get(threadId)
    if (!session) return
    this.sessions.delete(threadId)
    session.dispose()
    this.changed()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const off of this.#unsubscribe) off()
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
    void this.sync().catch(() => undefined)
  }
}
