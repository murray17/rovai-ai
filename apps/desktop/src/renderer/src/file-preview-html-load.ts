export type HtmlDocumentState = 'loading' | 'loaded' | 'unresponsive' | 'unconfirmed' | 'failed'
export interface HtmlPreviewLoadSnapshot {
  documentId: string | null
  document: HtmlDocumentState
  channel: 'waiting' | 'connected' | 'unavailable'
  serverDiagnostics: 'waiting' | 'connected' | 'unavailable' | 'not-applicable'
  serverDiagnosticsReason: 'policy' | null
  failure: string | null
  notice: string | null
}

const deadlineMs = 12_000
const unknownPage = '未收到预览响应，无法确认页面状态。已显示的内容会保留，你可以重试。'

/** The deadline belongs to a validated root document, independently of repeated
 * transport handshakes and the iframe element's non-authoritative load signal. */
export class HtmlPreviewLoadState {
  #documentId: string | null = null
  #document: HtmlDocumentState = 'loading'
  #failure: string | null = null
  #channel: HtmlPreviewLoadSnapshot['channel'] = 'waiting'
  #serverDiagnostics: HtmlPreviewLoadSnapshot['serverDiagnostics']
  #serverDiagnosticsReason: HtmlPreviewLoadSnapshot['serverDiagnosticsReason'] = null
  #awaitingLoadConfirmation = false
  #documentTimer: ReturnType<typeof setTimeout> | null = null
  #channelTimer: ReturnType<typeof setTimeout> | null = null
  #closed = false
  constructor(readonly publish: (snapshot: HtmlPreviewLoadSnapshot) => void, readonly hasServerDiagnostics = true) {
    this.#serverDiagnostics = hasServerDiagnostics ? 'waiting' : 'not-applicable'
  }

  #emit(): void {
    if (this.#closed) return
    const document = this.#awaitingLoadConfirmation ? this.#channel === 'unavailable' ? 'unconfirmed' : 'loading' : this.#document
    const notice = document === 'unconfirmed' ? unknownPage
      : document === 'unresponsive' ? '页面尚未完成加载。已显示的内容会保留，你可以重试。'
        : this.#channel === 'unavailable' ? '页面通信未响应，无法确认后续页面状态。已显示的内容会保留。' : null
    this.publish({ documentId: this.#awaitingLoadConfirmation ? null : this.#documentId, document, channel: this.#channel, serverDiagnostics: this.#serverDiagnostics, serverDiagnosticsReason: this.#serverDiagnosticsReason, failure: document === 'failed' ? this.#failure : null, notice })
  }
  connecting(): void {
    this.#channel = 'waiting'
    // Repeated hellos cannot postpone an outstanding handshake deadline.
    if (!this.#channelTimer) this.#channelTimer = setTimeout(() => {
      this.#channelTimer = null; this.unavailable()
    }, deadlineMs)
    this.#emit()
  }
  frameLoaded(): void {
    this.#awaitingLoadConfirmation = true
    this.connecting()
  }
  connected(documentId: string): boolean {
    const changed = documentId !== this.#documentId
    this.#channel = 'connected'; this.#awaitingLoadConfirmation = false
    this.#clearChannelTimer()
    if (changed) {
      this.#clearDocumentTimer()
      this.#documentId = documentId; this.#document = 'loading'; this.#failure = null
      this.#serverDiagnostics = this.hasServerDiagnostics ? 'waiting' : 'not-applicable'
      this.#serverDiagnosticsReason = null
      this.#documentTimer = setTimeout(() => {
        this.#documentTimer = null
        if (this.#document === 'loading') { this.#document = 'unresponsive'; this.#emit() }
      }, deadlineMs)
    }
    this.#emit()
    return changed
  }
  state(documentId: string, state: 'loading' | 'loaded' | 'failed', message?: string): void {
    if (documentId !== this.#documentId) return
    // Replaying a loading state during a handshake cannot revive a completed or
    // expired document deadline. A real completion can still recover a timeout.
    if (state === 'loading') return
    this.#clearDocumentTimer()
    this.#document = state; this.#failure = state === 'failed' ? message?.slice(0, 2000) ?? '无法加载页面。' : null
    this.#emit()
  }
  unavailable(): void {
    this.#clearChannelTimer(); this.#channel = 'unavailable'
    if (!this.#documentId) this.#document = 'unconfirmed'
    this.#emit()
  }
  serverDiagnostics(documentId: string, state: 'waiting' | 'connected' | 'unavailable', reason?: unknown): void {
    if (documentId !== this.#documentId || !this.hasServerDiagnostics) return
    this.#serverDiagnostics = state
    this.#serverDiagnosticsReason = state === 'unavailable' && reason === 'policy' ? 'policy' : null
    this.#emit()
  }
  failed(message: string): void {
    this.#clearDocumentTimer(); this.#clearChannelTimer()
    this.#awaitingLoadConfirmation = false; this.#document = 'failed'; this.#failure = message.slice(0, 2000)
    this.#emit()
  }
  #clearDocumentTimer(): void { if (this.#documentTimer) clearTimeout(this.#documentTimer); this.#documentTimer = null }
  #clearChannelTimer(): void { if (this.#channelTimer) clearTimeout(this.#channelTimer); this.#channelTimer = null }
  close(): void { this.#closed = true; this.#clearDocumentTimer(); this.#clearChannelTimer() }
}
